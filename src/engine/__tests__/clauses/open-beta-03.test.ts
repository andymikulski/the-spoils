// Clause tests — batch open-beta-03. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-03`. Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

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
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, holdResourceFace } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  fight,
  playRaw
} from "./_battle.js";
import { endTurn, isDevelopPrompt, developDrawLeft, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw, settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const factionOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].factionId!;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (so deck order is top = 0). */
function fillers(prefix: string, n: number, owner: Pid, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));
}

/** The pending choice, loosely typed. */
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string; [k: string]: unknown } | undefined;

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pick(engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** A free tactic that destroys one chosen ITEM (id `k`, declaration `t`). */
function itemKiller(): CardDefinition {
  return tactic({
    name: "ItemKiller",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic that deals `amount` damage to one chosen character (id `d`, declaration `t`). */
function shooter(amount: number): CardDefinition {
  return tactic({
    name: `Shooter${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A character with a free ability that restores itself (id `refresh`). */
function refresher(name = "Refresher"): CardDefinition {
  return character({
    name,
    behavior: { abilities: [{ id: "refresh", type: "activated", costs: [], effects: [{ type: "restore", target: "source" }] }] }
  });
}

// --- Brummagem Jewelry -------------------------------------------------------
// ATTACH TO CHARACTER. When this card enters play, deplete the attached
// character. The attached character cannot be restored by its faction's
// RESTORE ABILITY. Item (gear), cost 3, threshold [G][G].

const JEWELRY = "829d6fb1-4067-435e-a3c7-56f4d8410c5d";

function jewelryBoard(opts: { greed?: number; other?: string } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", 4, P1)
    ]
  });
}

const attachPlay = (b: ReturnType<typeof jewelryBoard>, hostKey: string) => play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id(hostKey)] } });

clause(JEWELRY, "0:attach", "attaches to a character you control: it enters play attached to that character and the printed cost of 3 is paid", () => {
  const b = jewelryBoard();
  const before = ready(b.engine);
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined, "no other character gets it");
});

clause(JEWELRY, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller)", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("jew")].controllerId, P1, "you still control the Jewelry");
});

clause(JEWELRY, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card, a resource", () => {
  const b = jewelryBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(b.id("thing")), "an item");
  assert.throws(attempt(b.id("place")), "a location");
  assert.throws(attempt(factionOf(b.engine, P1)), "your faction");
  assert.throws(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  assert.throws(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  assert.throws(attempt(b.id("res")), "a resource");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(JEWELRY, "0:attach", "is refused for a character that is not in play (in your hand or in a discard pile)", () => {
  const b = jewelryBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const b = jewelryBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [] } }), "no host picked");
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), {}), "no selection at all");
  assert.throws(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "is refused one resource short of its cost of 3, and without [G][G] even with enough other resources", () => {
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  assert.throws(() => playRaw(short.engine, P1, short.id("jew"), { selected: { attachTo: [short.id("mine")] } }), "2 resources for a cost of 3");

  const noThreshold = jewelryBoard({ greed: 1 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("jew"), { selected: { attachTo: [noThreshold.id("mine")] } }), "one [G] is not [G][G]");

  const exact = jewelryBoard({ greed: 2 });
  attachPlay(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("jew")), "play", "[G][G] plus other resources is enough");
});

clause(JEWELRY, "0:attach", "when the host is destroyed the Jewelry leaves play with it (to its owner's discard pile)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard", "the attached card follows its host out of play (CR 507.2 / 301.4)");
});

clause(JEWELRY, "0:attach", "when the host returns to its owner's hand the Jewelry leaves play too", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "bounce", def: bounce, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.notEqual(zoneOf(b.engine, b.id("jew")), "play", "the Jewelry does not stay in play without a host");
});

clause(JEWELRY, "0:attach", "when the host is put into its owner's hand the attached Jewelry leaves play the same way (into its owner's hand)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "bounce", def: bounce, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "control: the host went to its owner's hand");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand", "CR 301.4a: an attached card leaves play the same way its host does (here: to hand)");
  assert.ok(handOf(b.engine, P1).includes(b.id("jew")), "to its owner's hand");
});

clause(JEWELRY, "1:rule", "when it enters play the attached character of yours is depleted, and no other character is", () => {
  const b = jewelryBoard();
  attachPlay(b, "mine");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character is depleted");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "another of your characters is not");
  assert.equal(isDepleted(b.engine, b.id("foe")), false, "an opponent's character is not");
});

clause(JEWELRY, "1:rule", "it depletes an opponent's character just as well when that is the attached character", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  assert.equal(isDepleted(b.engine, b.id("mine2")), false);
});

clause(JEWELRY, "1:rule", "the depletion happens when it ENTERS play, not while it is still waiting for responses", () => {
  const b = jewelryBoard();
  playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "deploying", "still being deployed, the opponent may respond");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "not depleted yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "depleted once it has entered play");
});

clause(JEWELRY, "1:rule", "an already depleted attached character simply stays depleted", () => {
  const b = jewelryBoard();
  b.engine.state.cards[b.id("mine")].depleted = true;
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "1:rule", "it only fires for the Jewelry entering play: a second Jewelry going on another character does not deplete the first one's host again", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew1", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "jew2", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: false },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "control: a Jewelry placed directly into play has not triggered");
  play(b.engine, P1, b.id("jew2"), { selected: { attachTo: [b.id("mine2")] } });
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "the new Jewelry depletes its own host");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "the first Jewelry's host is unaffected by the second Jewelry entering play");
});

clause(JEWELRY, "1:rule", "a depleted character cannot be declared as an attacker (so the deplete is real)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("mine")]), "the depleted host cannot attack");
  declareAttackBy(b.engine, P1, [b.id("mine2")]);
  assert.ok(battleOf(b.engine), "the other character still can");
});

/** P1's character `mine` carries the Jewelry and is depleted; `plain` is depleted with no Jewelry. P1 and P2 each also own a depleted character. */
function restoreBoard(jewelryController: Pid = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: jewelryController, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "foePlain", def: character({ name: "FoePlain" }), owner: P2, zone: "play", depleted: true },
      { key: "foeJew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" }
    ]
  });
}

clause(JEWELRY, "2:rule", "the attached character is not restored by its controller's faction at the start of that player's turn, while an ordinary depleted character is", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character stays depleted through its restore");
  assert.equal(isDepleted(b.engine, b.id("plain")), false, "control: the ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "an opponent's attached character is not restored at its controller's turn either", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "the attached opponent character stays depleted");
  assert.equal(isDepleted(b.engine, b.id("foePlain")), false, "control: the opponent's ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "it makes no difference who controls the Jewelry: an opponent's Jewelry on my character blocks my restore too", () => {
  const b = restoreBoard(P2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
});

clause(JEWELRY, "2:rule", "it stays depleted turn after turn while the Jewelry is attached", () => {
  const b = restoreBoard();
  for (let i = 0; i < 2; i++) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
  }
  assert.equal(b.engine.state.turn, 1 + 2 * b.engine.state.turnOrder.length, "two rounds of the table later");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "2:rule", "only the faction's RESTORE ABILITY is blocked: a restore from another source still restores the attached character", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: refresher("Mine"), owner: P1, zone: "play", depleted: true }
    ]
  });
  activate(b.engine, P1, b.id("mine"), "refresh");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "restored by its own effect while the Jewelry is attached");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
});

clause(JEWELRY, "2:rule", "once the Jewelry has left play the character is restored by the next restore rule again", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "killer", def: itemKiller(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("jew")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "still depleted right after");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "no Jewelry, no lock: the restore rule restores it");
});

clause(JEWELRY, "2:rule", "the lock does not carry over to the Jewelry's controller's other characters", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  // the Jewelry on the opponent's character is a different lock: it does not matter for P1's turn
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
});

// --- shared "when this card enters play" bodies --------------------------------
// Used by every character here whose only trigger is an enters-play effect on
// the controller's faction (and optionally a draw). `delta` is the signed
// influence change for the controller's faction.

interface EtbOptions {
  owner?: Pid;
  influence?: number;
  deck?: number;
  zone?: "hand" | "discard" | "play";
  greed?: number;
}

/** The subject card (`subject`) with a bank of greed for its owner, a free filler character in hand (`freebie`), and the opposing side. Both factions start at 20 influence. */
function etbBoard(printingId: string, o: EtbOptions = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  const def = printing(printingId);
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: owner,
    cards: [
      { key: "subject", def, owner, zone: o.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: foe, zone: "play" },
      { key: "bounce", def: bouncer(), owner, zone: "hand" },
      { key: "raise", def: raiser(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...fillers("d", o.deck ?? 4, owner, "deck"),
      ...fillers("e", 4, foe, "deck"),
      ...bank("greed", o.greed ?? def.cost + 1, owner)
    ]
  });
  if (o.influence !== undefined) b.engine.state.players[owner].influence = o.influence;
  return b;
}

/** A free tactic that returns one chosen character to its owner's hand (id `b`, declaration `t`). */
function bouncer(): CardDefinition {
  return tactic({
    name: "Bouncer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/** A free tactic that puts a character from your discard pile into play (id `r`, declaration `t`) — "put into play", not "deployed". */
function raiser(): CardDefinition {
  return tactic({
    name: "Raiser",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** Deploying it pays exactly its printed cost, gives it its printed stats, and applies the influence change (and draws) to the controller's faction only. */
function etbDeploys(printingId: string, delta: number, draws = 0): void {
  const def = printing(printingId);
  const b = etbBoard(printingId);
  const readyBefore = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  const drawn = deckOf(b.engine, P1).slice(0, draws);
  play(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(readyBefore - ready(b.engine), def.cost, "the printed cost is paid");
  assert.equal(b.engine.getStat(b.id("subject"), "strength"), def.strength);
  assert.equal(b.engine.getStat(b.id("subject"), "life"), def.life);
  assert.equal(b.engine.getStat(b.id("subject"), "speed"), def.speed);
  assert.equal(influence(b.engine, P1), 20 + delta, "your faction's influence changes by exactly the printed amount");
  assert.equal(influence(b.engine, P2), 20, "the opponent's faction is untouched");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + draws, `the card leaves your hand and ${draws} card(s) are drawn`);
  for (const cardId of drawn) assert.equal(zoneOf(b.engine, cardId), "hand", "the cards drawn are the top of your deck");
  assert.equal(deckOf(b.engine, P1).length, 4 - draws);
  assert.equal(deckOf(b.engine, P2).length, 4, "the opponent's deck is untouched");
}

/** Nothing happens while the card is still being deployed (the opponent may respond); it happens when the card enters play. */
function etbWaitsForEntering(printingId: string, delta: number): void {
  const b = etbBoard(printingId);
  playRaw(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "deploying");
  assert.equal(influence(b.engine, P1), 20, "not yet: the card has not entered play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influence(b.engine, P1), 20 + delta, "applied once it has entered play");
}

/** A different character entering play, the card sitting in hand or already in play, or the card leaving play: none of these trigger it. */
function etbNearMisses(printingId: string): void {
  const inHand = etbBoard(printingId);
  play(inHand.engine, P1, inHand.id("freebie"));
  assert.equal(zoneOf(inHand.engine, inHand.id("freebie")), "play", "control: another character really entered play");
  assert.equal(influence(inHand.engine, P1), 20, "another character entering play does not trigger it (card in hand)");
  assert.equal(handOf(inHand.engine, P1).includes(inHand.id("subject")), true);

  const inPlay = etbBoard(printingId, { zone: "play" });
  assert.equal(influence(inPlay.engine, P1), 20, "a card already in play has not triggered");
  play(inPlay.engine, P1, inPlay.id("freebie"));
  assert.equal(influence(inPlay.engine, P1), 20, "another character entering play does not trigger it (card in play)");
  play(inPlay.engine, P1, inPlay.id("kill"), { selected: { t: [inPlay.id("subject")] } });
  assert.equal(zoneOf(inPlay.engine, inPlay.id("subject")), "discard", "control: it left play");
  assert.equal(influence(inPlay.engine, P1), 20, "leaving play does not trigger it");
}

/** It triggers every time it enters play: deploy, bounce, deploy again. */
function etbEveryEntry(printingId: string, delta: number): void {
  const b = etbBoard(printingId, { greed: 20 });
  play(b.engine, P1, b.id("subject"));
  assert.equal(influence(b.engine, P1), 20 + delta);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("subject")] } });
  assert.equal(zoneOf(b.engine, b.id("subject")), "hand", "control: it returned to hand");
  assert.equal(influence(b.engine, P1), 20 + delta, "returning to hand changes nothing");
  play(b.engine, P1, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influence(b.engine, P1), 20 + 2 * delta, "entering play a second time triggers it again");
}

/** Put into play by an effect (never deployed) it still "enters play". */
function etbPutIntoPlay(printingId: string, delta: number, draws = 0): void {
  const b = etbBoard(printingId, { zone: "discard" });
  const handBefore = handOf(b.engine, P1).length;
  const drawn = deckOf(b.engine, P1).slice(0, draws);
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("subject")] } });
  assert.equal(zoneOf(b.engine, b.id("subject")), "play", "control: it was put into play");
  assert.equal(influence(b.engine, P1), 20 + delta, "entering play by an effect triggers it");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + draws, "the Raiser left the hand; the draws (if any) came in");
  for (const cardId of drawn) assert.equal(zoneOf(b.engine, cardId), "hand");
}

/** "Your faction": when the opponent controls the card it is THEIR faction that is affected. */
function etbOpponentControlled(printingId: string, delta: number, draws = 0): void {
  const b = etbBoard(printingId, { owner: P2 });
  const drawn = deckOf(b.engine, P2).slice(0, draws);
  play(b.engine, P2, b.id("subject"));
  assert.equal(zoneOf(b.engine, b.id("subject")), "play");
  assert.equal(influence(b.engine, P2), 20 + delta, "the controller's faction changes");
  assert.equal(influence(b.engine, P1), 20, "the other player's faction does not");
  for (const cardId of drawn) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 4, "the other player draws nothing");
}

/** Losing influence: with exactly that much influence the faction hits 0 and its owner loses; with one more it survives on 1. */
function etbInfluenceLoss(printingId: string, loss: number): void {
  const exact = etbBoard(printingId, { influence: loss });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(influence(exact.engine, P1), 0);
  assert.deepEqual(exact.engine.state.result, { outcome: "victory", winners: [P2] }, "a faction at 0 influence loses (CR 102)");

  const spare = etbBoard(printingId, { influence: loss + 1 });
  play(spare.engine, P1, spare.id("subject"));
  assert.equal(influence(spare.engine, P1), 1);
  assert.equal(spare.engine.state.result, undefined, "one influence left: still in the game");
}

// --- Cash Out ---------------------------------------------------------------
// COST: Pick a value for X. Pay twice X. (X can be 0.) -- EFFECT: Draw X+1
// cards. Tactic, cost 0, threshold [G][G][G].

const CASH_OUT = "530a37e6-77d0-4953-bce0-02b08d5f83b7";

function cashOutBoard(o: { greed?: number; rage?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...fillers("d", o.deck ?? 8, P1, "deck"),
      ...fillers("e", 5, P2, "deck"),
      ...bank("greed", o.greed ?? 6, P1),
      ...bank("rage", o.rage ?? 3, P1)
    ]
  });
}

for (const x of [0, 1, 2, 3, 4]) {
  clause(CASH_OUT, "0:ability", `X=${x}: pays twice X (${2 * x}) and draws X+1 (${x + 1}) cards from the top of your deck`, () => {
    const b = cashOutBoard();
    const before = ready(b.engine);
    const topCards = deckOf(b.engine, P1).slice(0, x + 1);
    const handBefore = [...handOf(b.engine, P1)];
    const oppHand = [...handOf(b.engine, P2)];
    const oppDeck = [...deckOf(b.engine, P2)];
    play(b.engine, P1, b.id("co"), { variables: { x } });

    assert.equal(before - ready(b.engine), 2 * x, `pays exactly twice X (${2 * x}), on top of the printed cost of 0`);
    assert.deepEqual([...handOf(b.engine, P1)].sort(), [...handBefore.filter((c) => c !== b.id("co")), ...topCards].sort(), "the hand gains exactly the top X+1 cards of the deck");
    for (const cardId of topCards) assert.equal(zoneOf(b.engine, cardId), "hand");
    assert.equal(deckOf(b.engine, P1).length, 8 - (x + 1));
    assert.equal(zoneOf(b.engine, b.id("co")), "discard", "the tactic ends in its owner's discard pile");
    assert.deepEqual(handOf(b.engine, P2), oppHand, "the opponent's hand is untouched");
    assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
  });
}

clause(CASH_OUT, "0:ability", "X can be 0: it is legal with no spare resources at all, pays nothing and draws exactly one card", () => {
  const b = cashOutBoard({ greed: 3, rage: 0 });
  const top = deckOf(b.engine, P1)[0];
  const before = ready(b.engine);
  play(b.engine, P1, b.id("co"), { variables: { x: 0 } });
  assert.equal(ready(b.engine), before, "nothing is paid for X=0");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 7, "exactly one card drawn");
  assert.equal(zoneOf(b.engine, b.id("co")), "discard");
});

clause(CASH_OUT, "0:ability", "X cannot be negative", () => {
  const b = cashOutBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: -1 } }));
  assert.equal(zoneOf(b.engine, b.id("co")), "hand", "nothing was played");
  assert.equal(deckOf(b.engine, P1).length, 8, "nothing was drawn");
});

clause(CASH_OUT, "0:ability", "is refused when twice X cannot be paid, and allowed at exactly twice X", () => {
  const short = cashOutBoard({ greed: 3, rage: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("co"), { variables: { x: 2 } }), "X=2 needs 4 resources, only 3");
  assert.throws(() => playRaw(short.engine, P1, short.id("co"), { variables: { x: 3 } }), "X=3 needs 6 resources");
  assert.equal(zoneOf(short.engine, short.id("co")), "hand");
  assert.equal(deckOf(short.engine, P1).length, 8, "nothing was drawn by the refused plays");

  const odd = cashOutBoard({ greed: 3, rage: 0 });
  play(odd.engine, P1, odd.id("co"), { variables: { x: 1 } });
  assert.equal(ready(odd.engine), 1, "X=1 costs 2 of the 3");
  assert.equal(deckOf(odd.engine, P1).length, 6);

  const exact = cashOutBoard({ greed: 3, rage: 1 });
  play(exact.engine, P1, exact.id("co"), { variables: { x: 2 } });
  assert.equal(ready(exact.engine), 0, "X=2 uses exactly 4 resources");
  assert.equal(deckOf(exact.engine, P1).length, 5, "and draws 3 cards");
});

clause(CASH_OUT, "0:ability", "is refused without [G][G][G] even with plenty of other resources", () => {
  const noThreshold = cashOutBoard({ greed: 2, rage: 10 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("co"), { variables: { x: 0 } }));
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("co"), { variables: { x: 2 } }));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("co")), "hand");

  const exact = cashOutBoard({ greed: 3, rage: 0 });
  play(exact.engine, P1, exact.id("co"), { variables: { x: 0 } });
  assert.equal(zoneOf(exact.engine, exact.id("co")), "discard", "exactly [G][G][G] is enough");
});

clause(CASH_OUT, "0:ability", "with fewer than X+1 cards in the deck you draw all that are left and still pay for X", () => {
  const b = cashOutBoard({ deck: 2 });
  const before = ready(b.engine);
  const deck = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("co"), { variables: { x: 3 } });
  assert.equal(before - ready(b.engine), 6, "X=3 is still paid for in full");
  assert.equal(deckOf(b.engine, P1).length, 0);
  for (const cardId of deck) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(zoneOf(b.engine, b.id("co")), "discard");
  assert.equal(b.engine.state.result, undefined, "running out of cards does not lose the game (CR 102.1a)");
});

clause(CASH_OUT, "0:ability", "the player who plays it is the one who draws: played by the opponent it draws for the opponent", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", 5, P2)
    ]
  });
  play(b.engine, P2, b.id("co"), { variables: { x: 2 } });
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(handOf(b.engine, P1).length, 0, "the other player draws nothing");
  assert.equal(ready(b.engine, P2), 1);
});

// --- Concealed Goon ----------------------------------------------------------
// COVERT. When this card enters play, your faction loses 5 influence.
// Character (mercenary), cost 6, threshold [G][G], 5/3/5.

const GOON = "44531e60-9db8-47a9-be4b-2f77e0bf984c";

clause(GOON, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(GOON));
clause(GOON, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(GOON));
clause(GOON, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(GOON));
clause(GOON, "0:kw:COVERT", "as a blocker it can block only covert parties; it can block a covert party", () => covertBlocksOnlyCovertParties(GOON));
clause(GOON, "0:kw:COVERT", "an unblocked covert attack hits the faction for the Goon's strength of 5", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "goon", def: printing(GOON), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("goon")]);
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blocker")] }));
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), 20 - 5, "5 strength to the faction");
});

clause(GOON, "1:rule", "deploying it pays 6 and costs your faction exactly 5 influence (the opponent's is untouched)", () => etbDeploys(GOON, -5));
clause(GOON, "1:rule", "the influence is lost when it enters play, not while it is still being deployed", () => etbWaitsForEntering(GOON, -5));
clause(GOON, "1:rule", "another character entering play, or the Goon leaving play, loses no influence", () => etbNearMisses(GOON));
clause(GOON, "1:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 10 in total)", () => etbEveryEntry(GOON, -5));
clause(GOON, "1:rule", "put into play by an effect it still costs 5 influence", () => etbPutIntoPlay(GOON, -5));
clause(GOON, "1:rule", "'your faction' is the controller's: the opponent's Goon costs the opponent 5, not me", () => etbOpponentControlled(GOON, -5));
clause(GOON, "1:rule", "with exactly 5 influence you hit 0 and lose; with 6 you survive on 1", () => etbInfluenceLoss(GOON, 5));
clause(GOON, "1:rule", "is refused one resource short of 6, and without [G][G]", () => {
  const short = etbBoard(GOON, { greed: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("subject")));
  assert.equal(influence(short.engine, P1), 20, "nothing happened");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "subject", def: printing(GOON), owner: P1, zone: "hand" },
      ...bank("greed", 1, P1),
      ...bank("rage", 8, P1)
    ]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "one [G] is not [G][G]");
  const exact = etbBoard(GOON, { greed: 6 });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play", "exactly 6 resources with [G][G] is enough");
});

// --- Dandy Day-Trader --------------------------------------------------------
// (no rules text) Character (mau), cost 4, threshold [G], 1/4/6 (str/spd/life).

const DANDY = "b6d0ca94-12b3-468a-8a9b-ffbaa3ee0610";

function dandyBoard(o: { greed?: number; rage?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "dandy", def: printing(DANDY), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

clause(DANDY, "vanilla", "deploys for exactly its printed cost of 4 with [G]: the 4 resources are paid and it enters play", () => {
  const b = dandyBoard({ greed: 4 });
  play(b.engine, P1, b.id("dandy"));
  assert.equal(zoneOf(b.engine, b.id("dandy")), "play");
  assert.equal(ready(b.engine), 0, "all 4 resources were spent");
  assert.equal(b.engine.state.cards[b.id("dandy")].controllerId, P1);
});

clause(DANDY, "vanilla", "has its printed stats in play: strength 1, speed 4, life 6", () => {
  const b = dandyBoard();
  play(b.engine, P1, b.id("dandy"));
  assert.equal(b.engine.getStat(b.id("dandy"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("dandy"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("dandy"), "life"), 6);
  assert.deepEqual(b.engine.getKeywords(b.id("dandy")), [], "no keywords");
  assert.deepEqual(b.engine.getSubtypes(b.id("dandy")), ["mau"]);
});

clause(DANDY, "vanilla", "is refused one resource short of its cost of 4", () => {
  const b = dandyBoard({ greed: 3 });
  assert.throws(() => playRaw(b.engine, P1, b.id("dandy")));
  assert.equal(zoneOf(b.engine, b.id("dandy")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
});

clause(DANDY, "vanilla", "is refused without its [G] threshold even with 4 other resources, and allowed with a single [G] plus other resources", () => {
  const none = dandyBoard({ greed: 0, rage: 6 });
  assert.throws(() => playRaw(none.engine, P1, none.id("dandy")));
  assert.equal(zoneOf(none.engine, none.id("dandy")), "hand");

  const one = dandyBoard({ greed: 1, rage: 3 });
  play(one.engine, P1, one.id("dandy"));
  assert.equal(zoneOf(one.engine, one.id("dandy")), "play", "one [G] is the whole threshold");
  assert.equal(ready(one.engine), 0);
});

clause(DANDY, "vanilla", "a character can only be deployed on its controller's own turn", () => {
  const b = dandyBoard({ active: P2 });
  assert.throws(() => playRaw(b.engine, P1, b.id("dandy")));
  assert.equal(zoneOf(b.engine, b.id("dandy")), "hand");
});

clause(DANDY, "vanilla", "has no abilities of its own: nothing to activate and no printed behavior", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "dandy", def: printing(DANDY), owner: P1, zone: "play" }]
  });
  assert.deepEqual(
    b.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === b.id("dandy")),
    [],
    "no activated ability"
  );
  assert.equal(printing(DANDY).behavior, undefined, "no engine data for a card with no rules text (rule 4: phantom data)");
});

// --- Defense Attorney --------------------------------------------------------
// If you are attacked, this card must block if it can. Character (lawyer),
// cost 3, threshold [G], 1/3/4.

const ATTORNEY = "ec1472c0-f3d8-4674-a145-11fef301d906";

/** P2 is the active player and will attack P1, who has the Attorney and two ordinary characters. */
function attorneyBoard(extra: CardPlacement[] = [], attackerDef: CardDefinition = character({ name: "Attacker", strength: 2, life: 3 })) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "da", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "ally2", def: character({ name: "Ally2" }), owner: P1, zone: "play" },
      { key: "atk", def: attackerDef, owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 2 }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}

const declareBlock = (engine: SpoilsEngine, blockers: CardInstanceId[], player: Pid = P1) =>
  engine.perform({ type: "declareBlockers", playerId: player, blockerIds: blockers });

clause(ATTORNEY, "0:rule", "when its controller's faction is attacked, declaring no blockers is refused", () => {
  const b = attorneyBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, []));
  assert.equal(battleOf(b.engine)?.phase, "blocking", "the battle is still waiting for blockers");
});

clause(ATTORNEY, "0:rule", "it must be among the blockers: blocking with only another character is refused", () => {
  const b = attorneyBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("ally")]));
  assert.throws(() => declareBlock(b.engine, [b.id("ally"), b.id("ally2")]));
  assert.equal(battleOf(b.engine)?.phase, "blocking");
});

clause(ATTORNEY, "0:rule", "blocking with the Attorney alone is accepted, and the Attorney takes the blow instead of the faction", () => {
  const b = attorneyBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, [b.id("da")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("da")]);
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P1), 20, "the blocked attacker does not reach the faction");
  assert.equal(b.engine.state.cards[b.id("da")].damage, 2, "the Attorney took the attacker's 2 strength");
  assert.equal(b.engine.state.cards[b.id("atk")].damage, 1, "and dealt its own 1 strength back");
});

clause(ATTORNEY, "0:rule", "it only has to be one of the blockers: the Attorney plus other characters is fine", () => {
  const b = attorneyBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, [b.id("da"), b.id("ally"), b.id("ally2")]);
  assert.deepEqual([...(battleOf(b.engine)?.blockingParty ?? [])].sort(), [b.id("da"), b.id("ally"), b.id("ally2")].sort());
});

clause(ATTORNEY, "0:rule", "the obligation covers a bigger attacking party as well", () => {
  const b = attorneyBoard();
  declareAttackBy(b.engine, P2, [b.id("atk"), b.id("atk2")]);
  assert.throws(() => declareBlock(b.engine, []));
  assert.throws(() => declareBlock(b.engine, [b.id("ally")]));
  declareBlock(b.engine, [b.id("da")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("da")]);
});

clause(ATTORNEY, "0:rule", "'if it can': a depleted Attorney cannot block, so it is not forced to (no blockers, or another character, are fine)", () => {
  const none = attorneyBoard();
  none.engine.state.cards[none.id("da")].depleted = true;
  declareAttackBy(none.engine, P2, [none.id("atk")]);
  declareBlock(none.engine, []);
  assert.deepEqual(battleOf(none.engine)?.blockingParty ?? [], []);

  const ally = attorneyBoard();
  ally.engine.state.cards[ally.id("da")].depleted = true;
  declareAttackBy(ally.engine, P2, [ally.id("atk")]);
  declareBlock(ally.engine, [ally.id("ally")]);
  assert.deepEqual(battleOf(ally.engine)?.blockingParty, [ally.id("ally")]);
});

clause(ATTORNEY, "0:rule", "'if it can': it cannot block a covert party (it has no COVERT), so it is not forced to block one", () => {
  const b = attorneyBoard([], character({ name: "Sneak", strength: 2, behavior: { keywords: ["covert"] } }));
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("da")]), "control: it cannot block the covert party");
  declareBlock(b.engine, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], [], "no blockers is fine: it could not have blocked");
});

clause(ATTORNEY, "0:rule", "'if it can': an attacking party that cannot be blocked leaves nothing to block", () => {
  const b = attorneyBoard([], character({ name: "Ghost", strength: 2, behavior: { keywords: ["cannotBeBlocked"] } }));
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("da")]), "control: it cannot block an unblockable party");
  declareBlock(b.engine, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "every Attorney must block: with two of them leaving one out is refused", () => {
  const b = attorneyBoard([{ key: "da2", def: printing(ATTORNEY), owner: P1, zone: "play" }]);
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("da")]), "the second Attorney was left out");
  assert.throws(() => declareBlock(b.engine, [b.id("da2")]), "the first Attorney was left out");
  assert.throws(() => declareBlock(b.engine, []));
  declareBlock(b.engine, [b.id("da"), b.id("da2")]);
  assert.deepEqual([...(battleOf(b.engine)?.blockingParty ?? [])].sort(), [b.id("da"), b.id("da2")].sort());
});

clause(ATTORNEY, "0:rule", "it only binds its own controller: an Attorney on the attacking side makes the defender's blocking free", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "da", def: printing(ATTORNEY), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], [], "the defender (who has no Attorney) may decline to block");
});

clause(ATTORNEY, "0:rule", "when the Attorney's controller is the attacker the Attorney is not forced into anything: the defender decides, and it may attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "da", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("da")]);
  declareBlock(b.engine, [], P2);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("da")], "the Attorney attacked freely");
});

clause(ATTORNEY, "0:rule", "a face-down Attorney is just a resource: it is not forced to block", () => {
  const b = attorneyBoard();
  b.engine.state.cards[b.id("da")].faceDown = true;
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "an Attorney in hand or in a discard pile forces nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "daHand", def: printing(ATTORNEY), owner: P1, zone: "hand" },
      { key: "daDiscard", def: printing(ATTORNEY), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "the Attorney must block no matter what else the defender could block with, even when it entered play this turn", () => {
  const b = attorneyBoard();
  b.engine.state.cards[b.id("da")].attackEligibleTurn = undefined;
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("ally")]));
  declareBlock(b.engine, [b.id("da")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("da")]);
});

// --- Downsizing --------------------------------------------------------------
// Destroy all characters. Your opponent's faction gains X influence, where X
// is the number of characters destroyed. Tactic, cost 10, threshold [G][G][G][G].

const DOWNSIZING = "43425eec-287e-44b7-8bff-60c2b58feb9f";

function downsizingBoard(o: { mine?: number; theirs?: number; greed?: number; rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
      ...fillers("m", o.mine ?? 2, P1, "play"),
      ...fillers("t", o.theirs ?? 3, P2, "play"),
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "theirPlace", def: location({ name: "TheirPlace" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "myHidden", def: character({ name: "MyHidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "oppRes", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...bank("greed", o.greed ?? 10, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

clause(DOWNSIZING, "0:rule", "destroys every character: yours and your opponent's, ready and depleted, damaged or not", () => {
  const b = downsizingBoard();
  b.engine.state.cards[b.id("m0")].depleted = true;
  b.engine.state.cards[b.id("t1")].damage = 1;
  play(b.engine, P1, b.id("ds"));
  for (const key of ["m0", "m1", "t0", "t1", "t2"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
});

clause(DOWNSIZING, "0:rule", "it destroys only characters: items, locations, face-down cards, resources and cards in hand or discard are untouched", () => {
  const b = downsizingBoard();
  play(b.engine, P1, b.id("ds"));
  for (const key of ["myItem", "theirItem", "myPlace", "theirPlace", "hidden", "myHidden", "oppRes"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays in play`);
  assert.equal(zoneOf(b.engine, b.id("inHand")), "hand");
  assert.equal(zoneOf(b.engine, b.id("inDiscard")), "discard");
  assert.equal(b.engine.state.cards[b.id("hidden")].faceDown, true, "face-down cards stay face-down");
  assert.equal(zoneOf(b.engine, factionOf(b.engine, P1)), "play");
  assert.equal(zoneOf(b.engine, factionOf(b.engine, P2)), "play");
});

for (const [mine, theirs] of [
  [2, 3],
  [0, 4],
  [3, 0],
  [1, 1]
] as const) {
  clause(DOWNSIZING, "0:rule", `${mine} of your characters and ${theirs} of theirs: your opponent's faction gains ${mine + theirs} (the number destroyed), yours gains nothing`, () => {
    const b = downsizingBoard({ mine, theirs });
    play(b.engine, P1, b.id("ds"));
    assert.equal(influence(b.engine, P2), 20 + mine + theirs, "X counts every destroyed character, whoever controlled it");
    assert.equal(influence(b.engine, P1), 20, "your own faction gains nothing");
    assert.equal(zoneOf(b.engine, b.id("ds")), "discard", "the tactic ends in your discard pile");
  });
}

clause(DOWNSIZING, "0:rule", "with no characters in play nothing is destroyed and X is 0", () => {
  const b = downsizingBoard({ mine: 0, theirs: 0 });
  play(b.engine, P1, b.id("ds"));
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
});

clause(DOWNSIZING, "0:rule", "face-down cards are not characters and do not count towards X", () => {
  const b = downsizingBoard({ mine: 1, theirs: 1 });
  play(b.engine, P1, b.id("ds"));
  assert.equal(influence(b.engine, P2), 22, "2 characters destroyed; the 2 face-down cards do not count");
});

clause(DOWNSIZING, "0:rule", "X is the number of characters actually destroyed: if nothing can be destroyed this turn, the opponent gains nothing", () => {
  const noDestroy = tactic({
    name: "NoDestroy",
    cost: 0,
    behavior: { abilities: [{ id: "nd", type: "activated", effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
      { key: "nd", def: noDestroy, owner: P1, zone: "hand" },
      ...fillers("m", 2, P1, "play"),
      ...fillers("t", 3, P2, "play"),
      ...bank("greed", 10, P1)
    ]
  });
  play(b.engine, P1, b.id("nd"));
  play(b.engine, P1, b.id("ds"));
  for (const key of ["m0", "m1", "t0", "t1", "t2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} could not be destroyed`);
  assert.equal(influence(b.engine, P2), 20, "no characters were destroyed, so X is 0");
});

clause(DOWNSIZING, "0:rule", "pays the printed cost of 10", () => {
  const b = downsizingBoard({ greed: 12 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("ds"));
  assert.equal(before - ready(b.engine), 10, "exactly the printed cost is paid, no more");
});

clause(DOWNSIZING, "0:rule", "is refused one resource short of its cost of 10", () => {
  // (your face-down card "myHidden" is a Volition resource too, so 8 [G] + it = 9 resources)
  const b = downsizingBoard({ greed: 8 });
  assert.equal(ready(b.engine), 9);
  assert.throws(() => playRaw(b.engine, P1, b.id("ds")));
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play", "nothing was destroyed");
  const exact = downsizingBoard({ greed: 9 });
  assert.equal(ready(exact.engine), 10);
  play(exact.engine, P1, exact.id("ds"));
  assert.equal(zoneOf(exact.engine, exact.id("t0")), "discard", "exactly 10 is enough");
});

clause(DOWNSIZING, "0:rule", "is refused without [G][G][G][G] even with enough other resources", () => {
  const b = downsizingBoard({ greed: 3, rage: 10 });
  assert.throws(() => playRaw(b.engine, P1, b.id("ds")));
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
  const four = downsizingBoard({ greed: 4, rage: 6 });
  play(four.engine, P1, four.id("ds"));
  assert.equal(zoneOf(four.engine, four.id("ds")), "discard", "four [G] plus six other resources is enough");
});

// --- Erotic Assassin ---------------------------------------------------------
// This card cannot be restored by your faction's RESTORE ABILITY. This card can
// attack only once each turn. RESTORE -- COST: Pay 2. -- EFFECT: Restore this
// card. Character (mercenary, assassin), cost 0, threshold [G][G], 3/3/3.

const ASSASSIN = "375df0d1-3259-41c6-b70a-7fea51496abd";

function assassinBoard(o: { resources?: number; turn?: number; owner?: Pid; depleted?: boolean } = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 3,
    activePlayerId: owner,
    cards: [
      { key: "ea", def: printing(ASSASSIN), owner, zone: "play", depleted: o.depleted ?? false },
      { key: "plain", def: character({ name: "Plain", strength: 1 }), owner, zone: "play", depleted: o.depleted ?? false },
      { key: "refresher", def: refresher(), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: other(owner), zone: "play" },
      ...bank("greed", o.resources ?? 4, owner)
    ]
  });
}

clause(ASSASSIN, "0:rule", "after attacking it stays depleted through its controller's next restore, while an ordinary attacker is restored", () => {
  const b = assassinBoard();
  fight(b.engine, P1, [b.id("ea"), b.id("plain")], { type: "faction", playerId: P2 }, []);
  assert.equal(isDepleted(b.engine, b.id("ea")), true, "control: attacking depleted it");
  assert.equal(isDepleted(b.engine, b.id("plain")), true);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("ea")), true, "your faction's RESTORE ABILITY does not restore it");
  assert.equal(isDepleted(b.engine, b.id("plain")), false, "an ordinary character is restored");
});

clause(ASSASSIN, "0:rule", "it stays depleted for any number of turns", () => {
  const b = assassinBoard({ depleted: true });
  for (let i = 0; i < 3; i++) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
  }
  assert.equal(b.engine.state.turn, 3 + 3 * b.engine.state.turnOrder.length, "three rounds of the table after the board's turn 3");
  assert.equal(isDepleted(b.engine, b.id("ea")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
});

clause(ASSASSIN, "0:rule", "the opponent's Assassin is not restored by its controller's faction either", () => {
  const b = assassinBoard({ owner: P2, depleted: true });
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("ea")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
});

clause(ASSASSIN, "0:rule", "only the faction's rule is blocked: a restore from another card still restores it", () => {
  const restorer = tactic({
    name: "Restorer",
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
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(ASSASSIN), owner: P1, zone: "play", depleted: true },
      { key: "restorer", def: restorer, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("restorer"), { selected: { t: [b.id("ea")] } });
  assert.equal(isDepleted(b.engine, b.id("ea")), false);
});

clause(ASSASSIN, "1:rule", "after it has attacked it cannot attack again this turn, even once restored with RESTORE", () => {
  const b = assassinBoard();
  fight(b.engine, P1, [b.id("ea")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 17, "control: the first attack hit for 3");
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.equal(isDepleted(b.engine, b.id("ea")), false, "control: restored");
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("ea")]), "a second attack this turn is refused");
  assert.equal(battleOf(b.engine), undefined);
});

clause(ASSASSIN, "1:rule", "an attack in a party with other characters counts as its attack for the turn", () => {
  const b = assassinBoard();
  fight(b.engine, P1, [b.id("ea"), b.id("plain")], { type: "faction", playerId: P2 }, []);
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("ea"), b.id("foe")]));
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("ea")]));
});

clause(ASSASSIN, "1:rule", "only the Assassin is limited: any other character restored mid-turn can attack again", () => {
  const b = assassinBoard();
  fight(b.engine, P1, [b.id("refresher")], { type: "faction", playerId: P2 }, []);
  activate(b.engine, P1, b.id("refresher"), "refresh");
  declareAttackBy(b.engine, P1, [b.id("refresher")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("refresher")], "an ordinary character may attack a second time");
});

clause(ASSASSIN, "1:rule", "the limit is per turn: next turn, restored with RESTORE, it can attack again (once)", () => {
  const b = assassinBoard();
  fight(b.engine, P1, [b.id("ea")], { type: "faction", playerId: P2 }, []);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("ea")]), "control: it is still depleted at the start of the turn");
  activate(b.engine, P1, b.id("ea"), "restore");
  const life = influence(b.engine, P2);
  fight(b.engine, P1, [b.id("ea")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), life - 3, "it attacked again on the new turn");
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("ea")]), "but only once on that turn too");
});

clause(ASSASSIN, "1:rule", "a ready Assassin that has not attacked yet can attack (the limit is not zero)", () => {
  const b = assassinBoard();
  declareAttackBy(b.engine, P1, [b.id("ea")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("ea")]);
});

clause(ASSASSIN, "2:ability:restore", "pays 2 resources and restores the Assassin", () => {
  const b = assassinBoard({ depleted: true });
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.equal(before - ready(b.engine), 2, "the cost of 2 is paid");
  assert.equal(isDepleted(b.engine, b.id("ea")), false, "the Assassin is restored");
});

clause(ASSASSIN, "2:ability:restore", "restores only the Assassin: another depleted character stays depleted", () => {
  const b = assassinBoard({ depleted: true });
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.equal(isDepleted(b.engine, b.id("ea")), false);
  assert.equal(isDepleted(b.engine, b.id("plain")), true, "the other depleted character is untouched");
});

clause(ASSASSIN, "2:ability:restore", "is refused with only 1 resource available, and works with exactly 2", () => {
  const short = assassinBoard({ depleted: true, resources: 1 });
  assert.throws(() => activate(short.engine, P1, short.id("ea"), "restore"));
  assert.equal(isDepleted(short.engine, short.id("ea")), true);
  assert.equal(ready(short.engine), 1, "nothing was paid");

  const exact = assassinBoard({ depleted: true, resources: 2 });
  activate(exact.engine, P1, exact.id("ea"), "restore");
  assert.equal(isDepleted(exact.engine, exact.id("ea")), false);
  assert.equal(ready(exact.engine), 0);
});

clause(ASSASSIN, "2:ability:restore", "can be used the turn the Assassin enters play (abilities are not subject to summoning sickness)", () => {
  const b = assassinBoard({ depleted: true });
  b.engine.state.cards[b.id("ea")].attackEligibleTurn = undefined;
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.equal(isDepleted(b.engine, b.id("ea")), false);
});

clause(ASSASSIN, "2:ability:restore", "only its controller can use it: the opponent cannot restore my Assassin", () => {
  const b = assassinBoard({ depleted: true });
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  assert.throws(() => activate(b.engine, P2, b.id("ea"), "restore"));
  assert.equal(isDepleted(b.engine, b.id("ea")), true);
});

clause(ASSASSIN, "2:ability:restore", "a restored Assassin that is then depleted by attacking can be restored again, paying 2 each time", () => {
  const b = assassinBoard({ resources: 4 });
  fight(b.engine, P1, [b.id("plain")], { type: "faction", playerId: P2 }, []);
  b.engine.state.cards[b.id("ea")].depleted = true;
  activate(b.engine, P1, b.id("ea"), "restore");
  b.engine.state.cards[b.id("ea")].depleted = true;
  activate(b.engine, P1, b.id("ea"), "restore");
  assert.equal(ready(b.engine), 0, "two uses cost 4 in total");
  assert.equal(isDepleted(b.engine, b.id("ea")), false);
});

// --- Executive Poaching ------------------------------------------------------
// Destroy the character your opponent controls with the highest cost. If there
// is a tie, you pick which character is destroyed. Tactic, cost 5, threshold [G][G].

const POACHING = "1d851c52-991f-4c24-9a1d-b56575677bfb";

/** Opponent characters keyed t0.. with the given printed costs; your own characters m0.. get `mineCosts`. */
function poachingBoard(theirCosts: number[], mineCosts: number[] = [], o: { greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      ...theirCosts.map((cost, i) => ({ key: `t${i}`, def: character({ name: `T${i}`, cost }), owner: P2, zone: "play" as const })),
      ...mineCosts.map((cost, i) => ({ key: `m${i}`, def: character({ name: `M${i}`, cost }), owner: P1, zone: "play" as const })),
      ...(o.extra ?? []),
      ...bank("greed", o.greed ?? 5, P1)
    ]
  });
}

/**
 * Plays Executive Poaching. The engine asks its controller to pick the victim even when there is only
 * one legal choice (see open-beta-03-3); this answers that prompt with `target`, which must be legal.
 */
function poachPlay(b: ReturnType<typeof poachingBoard>, target?: string): void {
  play(b.engine, P1, b.id("ep"));
  if (target !== undefined && pending(b.engine)?.kind === "chooserSelectsTarget") pick(b.engine, P1, [b.id(target)]);
}

clause(POACHING, "0:rule", "destroys the opponent's single highest-cost character and nothing else", () => {
  const b = poachingBoard([2, 7, 4]);
  poachPlay(b, "t1");
  assert.equal(zoneOf(b.engine, b.id("t1")), "discard", "the cost-7 character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ep")), "discard");
});

clause(POACHING, "0:rule", "it does not matter where the highest-cost character sits in the board order", () => {
  for (const costs of [
    [9, 1, 2],
    [1, 9, 2],
    [1, 2, 9]
  ]) {
    const b = poachingBoard(costs);
    poachPlay(b, `t${costs.indexOf(9)}`);
    const destroyed = costs.map((_, i) => `t${i}`).filter((key) => zoneOf(b.engine, b.id(key)) === "discard");
    assert.deepEqual(destroyed, [`t${costs.indexOf(9)}`], `costs ${costs}: only the cost-9 character`);
  }
});

clause(POACHING, "0:rule", "the victim must be the highest-cost one: a cheaper opponent character cannot be picked instead", () => {
  const b = poachingBoard([2, 7, 4]);
  play(b.engine, P1, b.id("ep"));
  if (pending(b.engine)) {
    assert.throws(() => pick(b.engine, P1, [b.id("t0")]), "the cost-2 character");
    assert.throws(() => pick(b.engine, P1, [b.id("t2")]), "the cost-4 character");
  }
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(POACHING, "0:rule", "your own characters are never destroyed, even when they cost more than anything the opponent controls", () => {
  const b = poachingBoard([3, 2], [9, 8]);
  poachPlay(b, "t0");
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard", "the opponent's highest-cost character (3) is destroyed");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play", "your cost-9 character is safe");
  assert.equal(zoneOf(b.engine, b.id("m1")), "play");
});

clause(POACHING, "0:rule", "a character of yours with the same cost as their best makes no tie, and cannot be picked", () => {
  const b = poachingBoard([5, 2], [5]);
  play(b.engine, P1, b.id("ep"));
  if (pending(b.engine)) {
    assert.throws(() => pick(b.engine, P1, [b.id("m0")]), "your own cost-5 character is not a legal pick");
    pick(b.engine, P1, [b.id("t0")]);
  }
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
});

clause(POACHING, "0:rule", "a tie for highest cost: YOU pick which of the tied characters is destroyed (either one can be picked)", () => {
  for (const choice of ["t0", "t2"]) {
    const b = poachingBoard([6, 3, 6]);
    play(b.engine, P1, b.id("ep"));
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget", "a tie needs a pick");
    assert.equal(pc?.playerId, P1, "the tactic's controller picks, not the opponent");
    assert.equal(zoneOf(b.engine, b.id("t0")), "play", "nothing is destroyed before the pick");
    assert.equal(zoneOf(b.engine, b.id("t2")), "play");
    pick(b.engine, P1, [b.id(choice)]);
    const survivor = choice === "t0" ? "t2" : "t0";
    assert.equal(zoneOf(b.engine, b.id(choice)), "discard", `${choice} was picked and destroyed`);
    assert.equal(zoneOf(b.engine, b.id(survivor)), "play", "the other tied character survives");
    assert.equal(zoneOf(b.engine, b.id("t1")), "play", "the cheaper character is untouched");
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(POACHING, "0:rule", "in a tie only the tied characters can be picked: a cheaper character, your own character, nothing or two are refused", () => {
  const b = poachingBoard([6, 3, 6], [6]);
  play(b.engine, P1, b.id("ep"));
  const attempt = (selected: string[]) => () => pick(b.engine, P1, selected);
  assert.throws(attempt([b.id("t1")]), "a cheaper opponent character");
  assert.throws(attempt([b.id("m0")]), "your own cost-6 character");
  assert.throws(attempt([]), "you must pick one");
  assert.throws(attempt([b.id("t0"), b.id("t2")]), "only one is destroyed");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still waiting");
  pick(b.engine, P1, [b.id("t0")]);
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
});

clause(POACHING, "0:rule", "the opponent cannot make the tie pick for you", () => {
  const b = poachingBoard([4, 4]);
  play(b.engine, P1, b.id("ep"));
  assert.throws(() => pick(b.engine, P2, [b.id("t0")]));
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
});

clause(POACHING, "0:rule", "a three-way tie: any of the three can be picked, exactly one is destroyed", () => {
  const b = poachingBoard([4, 4, 4, 1]);
  play(b.engine, P1, b.id("ep"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, P1, [b.id("t1")]);
  assert.deepEqual(["t0", "t1", "t2", "t3"].map((key) => zoneOf(b.engine, b.id(key))), ["play", "discard", "play", "play"]);
});

clause(POACHING, "0:rule", "a tie lower down (two cheaper characters with equal cost) does not matter", () => {
  const b = poachingBoard([8, 2, 2]);
  poachPlay(b, "t0");
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(POACHING, "0:rule", "cost 0 is a cost too: a board of cost-0 characters is a full tie and you pick", () => {
  const b = poachingBoard([0, 0, 0]);
  play(b.engine, P1, b.id("ep"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, P1, [b.id("t2")]);
  assert.deepEqual(["t0", "t1", "t2"].map((key) => zoneOf(b.engine, b.id(key))), ["play", "play", "discard"]);
});

clause(POACHING, "0:rule", "with no tie there is no pick: the single highest-cost character is simply destroyed", () => {
  const b = poachingBoard([2, 7, 4]);
  play(b.engine, P1, b.id("ep"));
  assert.equal(b.engine.state.pendingChoice, undefined, "only a TIE lets you pick; with one highest-cost character nothing is asked");
  assert.equal(zoneOf(b.engine, b.id("t1")), "discard", "the cost-7 character was destroyed without a pick");
});

clause(POACHING, "0:rule", "compares printed cost, not strength or life: the expensive weakling is the one destroyed", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "weak", def: character({ name: "Weak", cost: 6, strength: 1, life: 1 }), owner: P2, zone: "play" },
      { key: "strong", def: character({ name: "Strong", cost: 2, strength: 9, life: 9 }), owner: P2, zone: "play" },
      ...bank("greed", 5, P1)
    ]
  });
  play(b.engine, P1, b.id("ep"));
  if (pending(b.engine)) pick(b.engine, P1, [b.id("weak")]);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  assert.equal(zoneOf(b.engine, b.id("strong")), "play");
});

clause(POACHING, "0:rule", "only characters count: a pricier item, location or face-down card does not shield (or replace) the best character", () => {
  const b = poachingBoard([3, 1], [], {
    extra: [
      { key: "bigItem", def: item({ name: "BigItem", cost: 9 }), owner: P2, zone: "play" },
      { key: "bigPlace", def: location({ name: "BigPlace", cost: 9 }), owner: P2, zone: "play" },
      { key: "hiddenBig", def: character({ name: "HiddenBig", cost: 9 }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  poachPlay(b, "t0");
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard", "the cost-3 character is the highest-cost CHARACTER");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
  assert.equal(zoneOf(b.engine, b.id("bigItem")), "play");
  assert.equal(zoneOf(b.engine, b.id("bigPlace")), "play");
  assert.equal(zoneOf(b.engine, b.id("hiddenBig")), "play", "a face-down card is a resource, not a character (CR 411.1)");
  assert.equal(b.engine.state.cards[b.id("hiddenBig")].faceDown, true);
});

clause(POACHING, "0:rule", "a depleted or damaged highest-cost character is still the one destroyed", () => {
  const b = poachingBoard([2, 7]);
  b.engine.state.cards[b.id("t1")].depleted = true;
  b.engine.state.cards[b.id("t1")].damage = 1;
  poachPlay(b, "t1");
  assert.equal(zoneOf(b.engine, b.id("t1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
});

clause(POACHING, "0:rule", "the destroyed character goes to its owner's discard pile", () => {
  const b = poachingBoard([7]);
  poachPlay(b, "t0");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("t0")), "b.engine.state.players[P2].discard.includes(b.id(\"t0\"))");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("t0")), false);
});

clause(POACHING, "0:rule", "with a single opposing character it is destroyed (it is trivially the highest)", () => {
  const b = poachingBoard([0]);
  poachPlay(b, "t0");
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
});

clause(POACHING, "0:rule", "the opponent controls no character: nothing is destroyed and your characters are safe", () => {
  const b = poachingBoard([], [4, 1]);
  play(b.engine, P1, b.id("ep"));
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to pick");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play");
  assert.equal(zoneOf(b.engine, b.id("m1")), "play");
  assert.equal(zoneOf(b.engine, b.id("ep")), "discard", "the tactic is still used up");
});

clause(POACHING, "0:rule", "a character the opponent controls but you own counts as theirs ('the character your opponent controls')", () => {
  const b = poachingBoard([2], [], {
    extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 8 }), owner: P1, controller: P2, zone: "play" }]
  });
  poachPlay(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard", "controlled by the opponent: it is the highest-cost character they control");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("stolen")), "it goes to its owner's discard pile");
});

clause(POACHING, "0:rule", "pays the printed cost of 5 and needs [G][G]", () => {
  const b = poachingBoard([3], [], { greed: 7 });
  const before = ready(b.engine);
  poachPlay(b, "t0");
  assert.equal(before - ready(b.engine), 5);

  const short = poachingBoard([3], [], { greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ep")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("t0")), "play");

  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "t0", def: character({ name: "T0", cost: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 1, P1),
      ...bank("rage", 8, P1)
    ]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ep")), "one [G] is not [G][G]");
});

// --- Free Trade Agreement ----------------------------------------------------
// At the start of each player's turn, that player must pick one of the following:
// OPTION 1: That player may draw a card and their opponent may play a resource.
// OPTION 2: That player may play a resource and their opponent may draw a card.
// OPTION 3: Both players may draw up to 2 cards.
// OPTION 4: Both players may play up to 2 resources.
// Item, cost 2, threshold [G][G].

const FTA = "234559f8-329c-4c05-bc09-c34e087a4182";

/**
 * FTA (controlled by P1 unless `controller` says otherwise) in play. Each side holds two real
 * resource cards (`<p>res0`, `<p>res1`) and a character (`<p>chr`) in hand and 6 cards in its deck
 * (`<p>d0..5`, top first). `starting` is the player whose turn is about to begin: the board is built
 * on the other player's turn, so `startTurnOf(engine, starting)` ends it.
 */
function ftaBoard(o: { starting?: Pid; controller?: Pid; ftaInPlay?: boolean } = {}) {
  const starting = o.starting ?? P2;
  const side = (p: Pid): CardPlacement[] => [
    { key: `${p}res0`, def: resourceCard({ name: `${p}Rage0` }), owner: p, zone: "hand" },
    { key: `${p}res1`, def: resourceCard({ name: `${p}Rage1` }), owner: p, zone: "hand" },
    { key: `${p}chr`, def: character({ name: `${p}Chr` }), owner: p, zone: "hand" },
    ...fillers(`${p}d`, 6, p, "deck")
  ];
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: other(starting),
    cards: [...(o.ftaInPlay === false ? [] : [{ key: "fta", def: printing(FTA), owner: o.controller ?? P1, zone: "play" as const }]), ...side(P1), ...side(P2)]
  });
}

/** Ends the previous player's turn: `player`'s turn starts (the engine stops at FTA's pick, if any). */
function startTurnOf(engine: SpoilsEngine, player: Pid): void {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has passed to the player");
}

/** Picks FTA's option `index` (the active player decides) and returns the follow-up pending choice. */
function ftaPick(engine: SpoilsEngine, index: number) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "FTA asks the active player to pick an option");
  engine.perform({ type: "resolvePendingChoice", playerId: pc!.playerId, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
  return pending(engine);
}

interface FtaPlan {
  /** How many of a player's "may draw" prompts they accept (they decline the rest). */
  draws?: Partial<Record<Pid, number>>;
  /** The cards a player puts into play when asked to pick resources. */
  plays?: Partial<Record<Pid, CardInstanceId[]>>;
}

/** Answers every follow-up prompt from `plan`; returns the prompts seen in order, e.g. "mayPay:p1". */
function ftaDrive(engine: SpoilsEngine, plan: FtaPlan): string[] {
  const draws = { ...(plan.draws ?? {}) } as Record<string, number>;
  const seen: string[] = [];
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 20) {
    const pc = pending(engine)!;
    if (pc.kind === "orderTriggers" || isDevelopPrompt(engine)) {
      settleTurnStart(engine); // the turn's other start-of-turn triggers are not what this drives
      continue;
    }
    seen.push(`${pc.kind}:${pc.playerId}`);
    let choice: unknown;
    if (pc.kind === "mayPay") {
      const left = draws[pc.playerId] ?? 0;
      draws[pc.playerId] = left - 1;
      choice = { kind: "mayPay", pay: left > 0 };
    } else if (pc.kind === "chooserSelectsTarget") {
      choice = { kind: "chooserSelectsTarget", selected: plan.plays?.[pc.playerId as Pid] ?? [] };
    } else {
      throw new Error(`unexpected prompt ${pc.kind}`);
    }
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return seen;
}

/** Answers prompts that are NOT a resource pick with "no", until the next `chooserSelectsTarget` (or nothing) is pending. */
function declineDrawPrompts(engine: SpoilsEngine): void {
  let guard = 0;
  while (pending(engine)?.kind === "mayPay" && guard++ < 5) {
    engine.perform({ type: "resolvePendingChoice", playerId: pending(engine)!.playerId, choice: { kind: "mayPay", pay: false } } as never);
    resolvePendingResponses(engine);
  }
}

const nCards = (engine: SpoilsEngine, player: Pid, zone: string) => Object.values(engine.state.cards).filter((c) => c.ownerId === player && c.zone === zone).length;
const res = (p: Pid, n: 0 | 1) => `${p}res${n}`;
const chr = (p: Pid) => `${p}chr`;
const turnOf = (p: Pid) => `${p === P1 ? "P1" : "P2"}'s turn`;

clause(FTA, "0:rule", "at the start of the opponent's turn that player (not the Agreement's controller) must pick one of the four options", () => {
  const b = ftaBoard({ starting: P2 });
  startTurnOf(b.engine, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P2, "the player whose turn is starting picks, not the Agreement's controller");
  assert.equal(pc?.optionCount, 4, "four options");
});

clause(FTA, "0:rule", "at the start of its controller's own turn the controller picks one of the four options", () => {
  const b = ftaBoard({ starting: P1 });
  startTurnOf(b.engine, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  assert.equal(pc?.optionCount, 4);
});

clause(FTA, "0:rule", "it makes no difference who controls it: if the opponent controls the Agreement, each player still picks at the start of their own turn", () => {
  for (const starting of [P1, P2] as const) {
    const b = ftaBoard({ starting, controller: P2 });
    startTurnOf(b.engine, starting);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
    assert.equal(pending(b.engine)?.playerId, starting, `${turnOf(starting)}: the active player picks`);
  }
});

clause(FTA, "0:rule", "the pick is mandatory: nothing else can be done until an option is picked", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  assert.throws(() => b.engine.perform({ type: "endTurn", playerId: P2 }), "cannot end the turn");
  assert.equal(isDevelopPrompt(b.engine), false, "cannot develop: the Develop Rule's own prompt waits behind the open choice");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the pick is still pending");
});

clause(FTA, "0:rule", "only the active player can make the pick; an index outside the four options is refused", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  assert.throws(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } } as never), "the other player cannot pick");
  assert.throws(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 4 } } as never), "there is no fifth option");
  assert.throws(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: -1 } } as never));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(FTA, "0:rule", "it happens at the start of EVERY turn, for both players, turn after turn", () => {
  const b = ftaBoard({ starting: P2 });
  const askedOf: string[] = [];
  let active: Pid = P1;
  for (let i = 0; i < 4; i++) {
    endTurn(b.engine, active);
    active = other(active);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsOption", `turn ${i + 2}`);
    askedOf.push(pc!.playerId);
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, {});
  }
  assert.deepEqual(askedOf, [P2, P1, P2, P1]);
});

clause(FTA, "0:rule", "it asks only at the start of the turn: nothing more is asked while the turn is played", () => {
  const b = ftaBoard();
  startTurnOf(b.engine, P2);
  ftaPick(b.engine, 0);
  ftaDrive(b.engine, {});
  assert.equal(b.engine.state.pendingChoice, undefined, "the turn proceeds normally");
  developDraw(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "developing asks nothing");
  assert.equal(b.engine.state.activePlayerId, P2, "still the same turn");
});

clause(FTA, "0:rule", "without the Agreement in play nothing is asked at the start of a turn", () => {
  const b = ftaBoard({ ftaInPlay: false });
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "once the Agreement has been destroyed nothing is asked any more", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fta", def: printing(FTA), owner: P1, zone: "play" },
      { key: "killer", def: itemKiller(), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck")
    ]
  });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("fta")] } });
  assert.equal(zoneOf(b.engine, b.id("fta")), "discard");
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "a face-down Agreement is just a resource and asks nothing", () => {
  const b = ftaBoard();
  b.engine.state.cards[b.id("fta")].faceDown = true;
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FTA, "0:rule", "pays the printed cost of 2 and needs [G][G]", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("fta"));
  assert.equal(zoneOf(b.engine, b.id("fta")), "play");
  assert.equal(before - ready(b.engine), 2);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("fta")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fta", def: printing(FTA), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 5, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("fta")), "one [G] is not [G][G]");
});

// For every option, both turns are covered: the Agreement's controller (P1) can be the active player or the other player.

for (const active of [P1, P2] as const) {
  const opp = other(active);

  // OPTION 1 -- That player may draw a card and their opponent may play a resource.

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: that player may draw a card; accepting draws exactly the top card of their own deck`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    const top = deckOf(b.engine, active)[0];
    const handBefore = nCards(b.engine, active, "hand");
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 1 } });
    assert.ok(seen.includes(`mayPay:${active}`), "the active player is asked whether to draw");
    assert.equal(zoneOf(b.engine, top), "hand", "the top card of their deck");
    assert.equal(nCards(b.engine, active, "hand"), handBefore + 1, "exactly one card");
    assert.equal(deckOf(b.engine, active).length, 5);
    assert.equal(deckOf(b.engine, opp).length, 6, "the other deck is untouched");
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: that player may decline to draw`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    const handBefore = nCards(b.engine, active, "hand");
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, { draws: { [active]: 0 } });
    assert.equal(nCards(b.engine, active, "hand"), handBefore, "no card drawn");
    assert.equal(deckOf(b.engine, active).length, 6);
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: that player draws only ONE card, and the opponent is not offered a draw`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 5, [opp]: 5 } });
    assert.equal(seen.filter((s) => s.startsWith("mayPay")).length, 1, "a single 'may draw' prompt");
    assert.equal(seen.filter((s) => s === `mayPay:${opp}`).length, 0, "the opponent is not offered a draw");
    assert.equal(deckOf(b.engine, active).length, 5);
    assert.equal(deckOf(b.engine, opp).length, 6);
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: their opponent may play a resource: a real resource card from the opponent's own hand goes into play face-up and provides its icon`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 1 }, plays: { [opp]: [b.id(res(opp, 0))] } });
    assert.ok(seen.includes(`chooserSelectsTarget:${opp}`), "the opponent (not the active player) is asked");
    const card = b.engine.state.cards[b.id(res(opp, 0))];
    assert.equal(card.zone, "play");
    assert.equal(card.controllerId, opp);
    assert.equal(card.faceDown, false, "a real resource card is played face-up");
    assert.equal(b.engine.getThresholds(opp).rage, 1);
    assert.equal(zoneOf(b.engine, b.id(res(opp, 1))), "hand", "only one resource is played");
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: their opponent may play ANY card as a resource: a character from hand goes into play face-down (providing Volition)`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, { plays: { [opp]: [b.id(chr(opp))] } });
    const card = b.engine.state.cards[b.id(chr(opp))];
    assert.equal(card.zone, "play");
    assert.equal(card.faceDown, true, "a non-resource card can only be played face-down");
    assert.equal(b.engine.getThresholds(opp).volition, 1);
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: their opponent may decline to play a resource`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    ftaDrive(b.engine, { plays: { [opp]: [] } });
    for (const key of [res(opp, 0), res(opp, 1), chr(opp)]) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: their opponent plays at most ONE resource, from their own hand only`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    declineDrawPrompts(b.engine);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, opp);
    assert.throws(() => pick(b.engine, opp, [b.id(res(opp, 0)), b.id(res(opp, 1))]), "two resources");
    assert.equal(zoneOf(b.engine, b.id(res(opp, 0))), "hand");
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: the resource must come from the opponent's own hand, not the active player's hand or a deck`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    declineDrawPrompts(b.engine);
    assert.throws(() => pick(b.engine, opp, [b.id(res(active, 0))]), "the active player's hand card");
    assert.equal(zoneOf(b.engine, b.id(res(active, 0))), "hand");
    assert.equal(zoneOf(b.engine, b.id(res(opp, 0))), "hand");
  });

  clause(FTA, "1:option:OPTION 1", `${turnOf(active)}: the active player does NOT get to play a resource in option 1`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 0);
    const seen = ftaDrive(b.engine, { draws: { [active]: 1 }, plays: { [opp]: [b.id(res(opp, 0))], [active]: [b.id(res(active, 0))] } });
    assert.equal(seen.filter((s) => s === `chooserSelectsTarget:${active}`).length, 0, "the active player is never asked to pick a resource");
    assert.equal(zoneOf(b.engine, b.id(res(active, 0))), "hand");
  });

  // OPTION 2 -- That player may play a resource and their opponent may draw a card.

  clause(FTA, "2:option:OPTION 2", `${turnOf(active)}: their opponent may draw a card: accepting draws exactly the top card of THEIR deck`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    const top = deckOf(b.engine, opp)[0];
    const handBefore = nCards(b.engine, opp, "hand");
    ftaPick(b.engine, 1);
    const seen = ftaDrive(b.engine, { draws: { [opp]: 1 } });
    assert.ok(seen.includes(`mayPay:${opp}`), "the opponent is asked whether to draw");
    assert.equal(zoneOf(b.engine, top), "hand");
    assert.equal(nCards(b.engine, opp, "hand"), handBefore + 1);
    assert.equal(deckOf(b.engine, opp).length, 5);
    assert.equal(deckOf(b.engine, active).length, 6, "the active player's deck is untouched");
  });

  clause(FTA, "2:option:OPTION 2", `${turnOf(active)}: their opponent may decline to draw, and draws only one card (the active player is not offered a draw)`, () => {
    const declined = ftaBoard({ starting: active });
    startTurnOf(declined.engine, active);
    ftaPick(declined.engine, 1);
    ftaDrive(declined.engine, { draws: { [opp]: 0 } });
    assert.equal(deckOf(declined.engine, opp).length, 6);

    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 1);
    const seen = ftaDrive(b.engine, { draws: { [opp]: 5, [active]: 5 } });
    assert.equal(seen.filter((s) => s.startsWith("mayPay")).length, 1, "a single 'may draw' prompt");
    assert.equal(seen.filter((s) => s === `mayPay:${active}`).length, 0, "the active player is not offered a draw");
    assert.equal(deckOf(b.engine, opp).length, 5);
    assert.equal(deckOf(b.engine, active).length, 6);
  });

  // OPTION 3 -- Both players may draw up to 2 cards.

  for (const [activeDraws, otherDraws] of [
    [2, 2],
    [1, 2],
    [2, 1],
    [0, 2],
    [2, 0],
    [1, 1],
    [0, 0]
  ] as const) {
    clause(FTA, "3:option:OPTION 3", `${turnOf(active)}: the active player draws ${activeDraws} and the other player draws ${otherDraws} (up to 2 each, each decides)`, () => {
      const b = ftaBoard({ starting: active });
      startTurnOf(b.engine, active);
      const topActive = deckOf(b.engine, active).slice(0, activeDraws);
      const topOpp = deckOf(b.engine, opp).slice(0, otherDraws);
      const hand = { [active]: nCards(b.engine, active, "hand"), [opp]: nCards(b.engine, opp, "hand") };
      ftaPick(b.engine, 2);
      ftaDrive(b.engine, { draws: { [active]: activeDraws, [opp]: otherDraws } });
      assert.equal(nCards(b.engine, active, "hand"), hand[active] + activeDraws);
      assert.equal(nCards(b.engine, opp, "hand"), hand[opp] + otherDraws);
      for (const cardId of [...topActive, ...topOpp]) assert.equal(zoneOf(b.engine, cardId), "hand", "the top cards of their own decks");
      assert.equal(deckOf(b.engine, active).length, 6 - activeDraws);
      assert.equal(deckOf(b.engine, opp).length, 6 - otherDraws);
    });
  }

  clause(FTA, "3:option:OPTION 3", `${turnOf(active)}: nobody can draw more than 2 (each player is offered at most two draws), and nothing enters play`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    const playBefore = [nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")];
    ftaPick(b.engine, 2);
    const seen = ftaDrive(b.engine, { draws: { [active]: 9, [opp]: 9 }, plays: { [P1]: [b.id(res(P1, 0))], [P2]: [b.id(res(P2, 0))] } });
    assert.equal(seen.filter((s) => s === `mayPay:${active}`).length, 2, "two prompts for the active player");
    assert.equal(seen.filter((s) => s === `mayPay:${opp}`).length, 2, "two prompts for the other player");
    assert.equal(seen.filter((s) => s.startsWith("chooserSelectsTarget")).length, 0, "no resource prompts: this option is about drawing");
    assert.equal(deckOf(b.engine, active).length, 4);
    assert.equal(deckOf(b.engine, opp).length, 4);
    assert.deepEqual([nCards(b.engine, P1, "play"), nCards(b.engine, P2, "play")], playBefore);
  });

  clause(FTA, "3:option:OPTION 3", `${turnOf(active)}: with a nearly empty deck a player draws what is there and the game goes on`, () => {
    const b = ftaBoard({ starting: active });
    b.engine.state.players[active].deck = b.engine.state.players[active].deck.slice(0, 1);
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 2);
    ftaDrive(b.engine, { draws: { [active]: 2, [opp]: 2 } });
    assert.equal(deckOf(b.engine, active).length, 0);
    assert.equal(deckOf(b.engine, opp).length, 4);
    assert.equal(b.engine.state.result, undefined);
  });

  // OPTION 4 -- Both players may play up to 2 resources.

  for (const [activeN, otherN] of [
    [2, 2],
    [1, 2],
    [2, 1],
    [0, 2],
    [2, 0],
    [1, 1],
    [0, 0]
  ] as const) {
    clause(FTA, "4:option:OPTION 4", `${turnOf(active)}: the active player plays ${activeN} resource(s) and the other player plays ${otherN} (up to 2 each)`, () => {
      const b = ftaBoard({ starting: active });
      startTurnOf(b.engine, active);
      const activeCards = [b.id(res(active, 0)), b.id(res(active, 1))].slice(0, activeN);
      const oppCards = [b.id(res(opp, 0)), b.id(res(opp, 1))].slice(0, otherN);
      ftaPick(b.engine, 3);
      const seen = ftaDrive(b.engine, { plays: { [active]: activeCards, [opp]: oppCards } });
      assert.ok(seen.includes(`chooserSelectsTarget:${active}`) && seen.includes(`chooserSelectsTarget:${opp}`), "both players are asked");
      for (const cardId of [...activeCards, ...oppCards]) assert.equal(zoneOf(b.engine, cardId), "play");
      for (const key of [res(active, 0), res(active, 1)].slice(activeN)) assert.equal(zoneOf(b.engine, b.id(key)), "hand", "the ones not picked stay in hand");
      for (const key of [res(opp, 0), res(opp, 1)].slice(otherN)) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
      assert.equal(b.engine.getThresholds(active).rage ?? 0, activeN);
      assert.equal(b.engine.getThresholds(opp).rage ?? 0, otherN);
      assert.equal(deckOf(b.engine, P1).length, 6, "no one draws");
      assert.equal(deckOf(b.engine, P2).length, 6);
    });
  }

  clause(FTA, "4:option:OPTION 4", `${turnOf(active)}: no one can play more than 2: picking three cards is refused for either player`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 3);
    for (let i = 0; i < 2; i++) {
      const pc = pending(b.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      const who = pc.playerId as Pid;
      const hand = [b.id(res(who, 0)), b.id(res(who, 1)), b.id(chr(who))];
      assert.throws(() => pick(b.engine, who, hand), `three cards for ${who}`);
    }
  });

  clause(FTA, "4:option:OPTION 4", `${turnOf(active)}: each player plays only cards from their own hand`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 3);
    const who = pending(b.engine)!.playerId as Pid;
    assert.throws(() => pick(b.engine, who, [b.id(res(other(who), 0))]), "the other player's hand card");
    assert.equal(zoneOf(b.engine, b.id(res(other(who), 0))), "hand");
  });

  clause(FTA, "4:option:OPTION 4", `${turnOf(active)}: any card can be one of the two resources: a character goes in face-down next to a real resource card`, () => {
    const b = ftaBoard({ starting: active });
    startTurnOf(b.engine, active);
    ftaPick(b.engine, 3);
    ftaDrive(b.engine, {
      plays: { [active]: [b.id(res(active, 0)), b.id(chr(active))], [opp]: [b.id(chr(opp)), b.id(res(opp, 0))] }
    });
    for (const p of [active, opp]) {
      assert.equal(b.engine.state.cards[b.id(chr(p))].faceDown, true, `${p}'s character is a face-down resource`);
      assert.equal(b.engine.state.cards[b.id(res(p, 0))].faceDown, false, `${p}'s real resource is face-up`);
      assert.equal(b.engine.getThresholds(p).volition, 1);
    }
  });
}

// OPTION 2, the active player's resource: works for the Agreement's controller...

function ftaOption2ActivePlays(active: Pid, kind: "real" | "any" | "decline" | "limit" | "foreign"): void {
  const b = ftaBoard({ starting: active });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, 1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the active player is asked to pick a resource");
  assert.equal(pc?.playerId, active);
  if (kind === "decline") {
    pick(b.engine, active, []);
    ftaDrive(b.engine, {});
    for (const key of [res(active, 0), res(active, 1), chr(active)]) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
    return;
  }
  if (kind === "limit") assert.throws(() => pick(b.engine, active, [b.id(res(active, 0)), b.id(res(active, 1))]), "two resources are too many");
  if (kind === "foreign") assert.throws(() => pick(b.engine, active, [b.id(res(other(active), 0))]), "the opponent's hand card is not a legal pick");
  const key = kind === "any" ? chr(active) : res(active, 0);
  pick(b.engine, active, [b.id(key)]);
  ftaDrive(b.engine, {});
  const card = b.engine.state.cards[b.id(key)];
  assert.equal(card.zone, "play", "a card from the active player's own hand can be played as the resource");
  assert.equal(card.controllerId, active);
  assert.equal(card.faceDown, kind === "any", kind === "any" ? "any other card is played face-down" : "a real resource card is played face-up");
  if (kind === "any") assert.equal(b.engine.getThresholds(active).volition, 1);
  else assert.equal(b.engine.getThresholds(active).rage, 1);
  assert.equal(zoneOf(b.engine, b.id(res(active, 1))), "hand", "only one resource is played");
  assert.equal(zoneOf(b.engine, b.id(res(other(active), 0))), "hand", "the other player's hand is untouched");
}

clause(FTA, "2:option:OPTION 2", "P1's turn (the Agreement's controller): that player may play a resource, a real resource card goes into play face-up", () => ftaOption2ActivePlays(P1, "real"));
clause(FTA, "2:option:OPTION 2", "P1's turn (the Agreement's controller): that player may play ANY card as a face-down resource", () => ftaOption2ActivePlays(P1, "any"));
clause(FTA, "2:option:OPTION 2", "P1's turn (the Agreement's controller): that player may decline to play a resource", () => ftaOption2ActivePlays(P1, "decline"));
clause(FTA, "2:option:OPTION 2", "P1's turn (the Agreement's controller): at most ONE resource (two are refused)", () => ftaOption2ActivePlays(P1, "limit"));
clause(FTA, "2:option:OPTION 2", "P1's turn (the Agreement's controller): the resource comes from their own hand only", () => ftaOption2ActivePlays(P1, "foreign"));

// ...but not for the other player: the pick is judged against the Agreement controller's hand.

clause(FTA, "2:option:OPTION 2", "P2's turn (not the Agreement's controller): that player may play a resource, a real resource card goes into play face-up", () => ftaOption2ActivePlays(P2, "real"));
clause(FTA, "2:option:OPTION 2", "P2's turn (not the Agreement's controller): that player may play ANY card as a face-down resource", () => ftaOption2ActivePlays(P2, "any"));
clause(FTA, "2:option:OPTION 2", "P2's turn (not the Agreement's controller): that player may decline to play a resource", () => ftaOption2ActivePlays(P2, "decline"));
clause(FTA, "2:option:OPTION 2", "P2's turn (not the Agreement's controller): at most ONE resource (two are refused) and one can be played", () => ftaOption2ActivePlays(P2, "limit"));
clause(FTA, "2:option:OPTION 2", "P2's turn (not the Agreement's controller): the resource comes from their own hand only, and one can be played from it", () => ftaOption2ActivePlays(P2, "foreign"));

// 'play a resource' / 'play up to 2 resources' lets the player choose face-up or face-down (CR 203.2).

function ftaFaceChoice(option: number, active: Pid, who: Pid, realKey: string): void {
  holdResourceFace(() => {
  const b = ftaBoard({ starting: active });
  startTurnOf(b.engine, active);
  ftaPick(b.engine, option);
  declineDrawPrompts(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, who, "the player who plays the resource is asked");
  pick(b.engine, who, [b.id(realKey)]);
  const asked = pending(b.engine) !== undefined && zoneOf(b.engine, b.id(realKey)) === "hand";
  const faceDown = zoneOf(b.engine, b.id(realKey)) === "play" && b.engine.state.cards[b.id(realKey)].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
  });
}

clause(FTA, "1:option:OPTION 1", "'play a resource' lets the opponent choose face-up or face-down for an actual resource card", () => ftaFaceChoice(0, P2, P1, res(P1, 0)));
clause(FTA, "2:option:OPTION 2", "'play a resource' lets that player choose face-up or face-down for an actual resource card", () => ftaFaceChoice(1, P1, P1, res(P1, 0)));
clause(FTA, "4:option:OPTION 4", "'play up to 2 resources' lets each player choose face-up or face-down for an actual resource card", () => ftaFaceChoice(3, P2, P2, res(P2, 0)));

// --- Ghostly Auditor ---------------------------------------------------------
// While you control only 1 character, this card gains COVERT. If this card
// inflicts damage to a faction, draw 2 cards. Character (lackey, ghost), cost 4,
// threshold [G][G], 2/3/2.

const AUDITOR = "7efcb6ee-1e46-41c4-a123-8f75cfd95719";

function auditorBoard(o: { allies?: number; foeChars?: number; extra?: CardPlacement[]; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "ga", def: printing(AUDITOR), owner: P1, zone: "play" },
      ...fillers("ally", o.allies ?? 0, P1, "play"),
      ...fillers("foe", o.foeChars ?? 1, P2, "play"),
      { key: "covertFoe", def: character({ name: "CovertFoe", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...(o.extra ?? []),
      ...fillers("d", o.deck ?? 5, P1, "deck"),
      ...fillers("e", 5, P2, "deck")
    ]
  });
}

clause(AUDITOR, "0:rule", "gains COVERT while it is the only character you control", () => {
  const b = auditorBoard();
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), true);
});

clause(AUDITOR, "0:rule", "does not have COVERT while you control a second character", () => {
  for (const allies of [1, 2, 3]) {
    const b = auditorBoard({ allies });
    assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), false, `${allies} other character(s)`);
  }
});

clause(AUDITOR, "0:rule", "the opponent's characters do not count: it is covert however many characters they control", () => {
  const b = auditorBoard({ foeChars: 5 });
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), true);
});

clause(AUDITOR, "0:rule", "only characters count: face-down cards, items, locations and a character you own but do not control do not", () => {
  const b = auditorBoard({
    extra: [
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), true);
});

clause(AUDITOR, "0:rule", "a character you do not own but control does count", () => {
  const b = auditorBoard({ extra: [{ key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" }] });
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), false);
});

clause(AUDITOR, "0:rule", "the keyword turns on and off as characters enter and leave play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ga", def: printing(AUDITOR), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), true, "alone: covert");
  play(b.engine, P1, b.id("ally"));
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), false, "a second character entered play: no longer covert");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ally")] } });
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), true, "alone again: covert again");
});

clause(AUDITOR, "0:rule", "while alone it is a covert party: a non-covert character cannot block it, a covert one can", () => {
  const b = auditorBoard();
  declareAttackBy(b.engine, P1, [b.id("ga")]);
  assert.throws(() => declareBlock(b.engine, [b.id("foe0")], P2), "a plain character cannot block a covert party");
  declareBlock(b.engine, [b.id("covertFoe")], P2);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertFoe")]);
});

clause(AUDITOR, "0:rule", "with a second character it is not covert: a plain character can block it", () => {
  const b = auditorBoard({ allies: 1 });
  declareAttackBy(b.engine, P1, [b.id("ga")]);
  declareBlock(b.engine, [b.id("foe0")], P2);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe0")]);
});

clause(AUDITOR, "0:rule", "gaining COVERT is real in both directions: alone, it can block only covert parties", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ga", def: printing(AUDITOR), owner: P1, zone: "play" },
      { key: "plainAtk", def: character({ name: "PlainAtk" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("plainAtk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("ga")], P1), "a covert character may block only a covert party");
});

clause(AUDITOR, "0:rule", "it has no COVERT of its own: with company the printed card carries no keyword", () => {
  const b = auditorBoard({ allies: 1 });
  assert.equal(hasKeyword(b.engine, b.id("ga"), "covert"), false);
  assert.deepEqual(printing(AUDITOR).behavior?.keywords ?? [], [], "no printed keyword (rule 4: phantom data)");
});

clause(AUDITOR, "1:rule", "an unblocked attack on the faction inflicts damage to it: the controller draws exactly 2 cards (the top of their deck)", () => {
  const b = auditorBoard({ allies: 1 });
  const top2 = deckOf(b.engine, P1).slice(0, 2);
  const handBefore = handOf(b.engine, P1).length;
  fight(b.engine, P1, [b.id("ga")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 18, "the Auditor's 2 strength hit the faction");
  assert.equal(handOf(b.engine, P1).length, handBefore + 2, "draws 2 cards");
  for (const cardId of top2) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 3);
  assert.equal(handOf(b.engine, P2).length, 0, "the opponent draws nothing");
  assert.equal(deckOf(b.engine, P2).length, 5);
});

clause(AUDITOR, "1:rule", "when it is blocked its damage goes to the blocker, not the faction: no cards are drawn", () => {
  const b = auditorBoard({ allies: 1 });
  fight(b.engine, P1, [b.id("ga")], { type: "faction", playerId: P2 }, [b.id("foe0")]);
  assert.equal(influence(b.engine, P2), 20, "the faction took no damage");
  assert.equal(b.engine.state.cards[b.id("foe0")].damage, 2, "the blocker took the 2 damage");
  assert.equal(handOf(b.engine, P1).length, 0, "no cards drawn");
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(AUDITOR, "1:rule", "damage to a location is not damage to a faction: no cards are drawn", () => {
  const b = auditorBoard({ allies: 1, extra: [{ key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }] });
  fight(b.engine, P1, [b.id("ga")], { type: "card", cardId: b.id("place") }, []);
  assert.equal(b.engine.state.cards[b.id("place")].damage, 2, "control: the location took 2");
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(AUDITOR, "1:rule", "it is this card's damage that counts: another character hitting the faction draws nothing", () => {
  const b = auditorBoard({ allies: 1 });
  fight(b.engine, P1, [b.id("ally0")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 19, "control: the ally's 1 strength hit the faction");
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(AUDITOR, "1:rule", "attacking in a party with another character: the Auditor's own unblocked hit still draws 2 (once)", () => {
  const b = auditorBoard({ allies: 1 });
  fight(b.engine, P1, [b.id("ga"), b.id("ally0")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 17, "2 + 1 damage to the faction");
  assert.equal(handOf(b.engine, P1).length, 2, "drew 2 for the Auditor's hit (and nothing for the ally's)");
});

clause(AUDITOR, "1:rule", "alone and covert, a plain blocker cannot stop it: it hits the faction and draws 2", () => {
  const b = auditorBoard();
  declareAttackBy(b.engine, P1, [b.id("ga")]);
  assert.throws(() => declareBlock(b.engine, [b.id("foe0")], P2));
  declareBlock(b.engine, [], P2);
  autoResolveBattle(b.engine);
  assert.equal(influence(b.engine, P2), 18);
  assert.equal(handOf(b.engine, P1).length, 2);
});

clause(AUDITOR, "1:rule", "an attempt to inflict 0 damage inflicts nothing: with 0 strength no cards are drawn", () => {
  const weaken = item({
    name: "Weakener",
    attachTo: "character",
    behavior: { abilities: [{ id: "w", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -2 }] }] }
  });
  const b = auditorBoard({ allies: 1, extra: [{ key: "weaken", def: weaken, owner: P2, zone: "play", attachedToKey: "ga" }] });
  assert.equal(b.engine.getStat(b.id("ga"), "strength"), 0, "control: strength is 0");
  fight(b.engine, P1, [b.id("ga")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 20, "no damage");
  assert.equal(handOf(b.engine, P1).length, 0, "no cards drawn");
});

clause(AUDITOR, "1:rule", "with only one card left in the deck it draws that card and the game goes on", () => {
  const b = auditorBoard({ allies: 1, deck: 1 });
  fight(b.engine, P1, [b.id("ga")], { type: "faction", playerId: P2 }, []);
  assert.equal(handOf(b.engine, P1).length, 1);
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.result, undefined);
});

clause(AUDITOR, "1:rule", "an opponent's Auditor that hits my faction draws for the opponent, not for me", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ga", def: printing(AUDITOR), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck")
    ]
  });
  fight(b.engine, P2, [b.id("ga")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 18);
  assert.equal(handOf(b.engine, P2).length, 2);
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(AUDITOR, "1:rule", "as a blocker it never inflicts damage to a faction, so it draws nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ga", def: printing(AUDITOR), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5 }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck")
    ]
  });
  fight(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ga")]);
  assert.equal(b.engine.state.cards[b.id("atk")].damage, 2, "control: the Auditor hit the attacker");
  assert.equal(handOf(b.engine, P1).length, 0);
});

// --- Gold Summit -------------------------------------------------------------
// If you draw a card, your faction gains 1 influence. Location, cost 3,
// threshold [G][G][G], structure 5.

const SUMMIT = "1a988e25-bd1f-47e0-995e-1a7a72306961";

/** A free tactic that draws `n` cards for its controller. */
function drawTactic(n: number): CardDefinition {
  return tactic({ name: `Draw${n}`, cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] } });
}

function summitBoard(o: { summitOwner?: Pid; deck?: number; oppDeck?: number } = {}) {
  const owner = o.summitOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "gs", def: printing(SUMMIT), owner, zone: "play" },
      { key: "draw1", def: drawTactic(1), owner: P1, zone: "hand" },
      { key: "draw2", def: drawTactic(2), owner: P1, zone: "hand" },
      { key: "oppDraw1", def: drawTactic(1), owner: P2, zone: "hand" },
      { key: "bounce", def: bouncer(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("d", o.deck ?? 6, P1, "deck"),
      ...fillers("e", o.oppDeck ?? 6, P2, "deck")
    ]
  });
}

clause(SUMMIT, "0:rule", "drawing a card (a card effect) gains your faction 1 influence", () => {
  const b = summitBoard();
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("draw1"));
  assert.equal(zoneOf(b.engine, top), "hand", "control: the card was drawn");
  assert.equal(influence(b.engine, P1), 21);
  assert.equal(influence(b.engine, P2), 20, "the opponent's faction is untouched");
});

clause(SUMMIT, "0:rule", "drawing with the Develop Rule gains 1 influence", () => {
  const b = summitBoard();
  const top = deckOf(b.engine, P1)[0];
  developDraw(b.engine, P1);
  assert.equal(zoneOf(b.engine, top), "hand", "control: the card was drawn");
  assert.equal(influence(b.engine, P1), 21);
});

clause(SUMMIT, "0:rule", "each card drawn gains 1: drawing 2 cards at once gains 2", () => {
  const b = summitBoard();
  play(b.engine, P1, b.id("draw2"));
  assert.equal(deckOf(b.engine, P1).length, 4, "control: two cards were drawn");
  assert.equal(influence(b.engine, P1), 22);
});

clause(SUMMIT, "0:rule", "drawing several times gains each time", () => {
  const b = summitBoard();
  play(b.engine, P1, b.id("draw1"));
  developDraw(b.engine, P1);
  play(b.engine, P1, b.id("draw2"));
  assert.equal(influence(b.engine, P1), 24, "1 + 1 + 2");
});

clause(SUMMIT, "0:rule", "if no card is actually drawn (empty deck) nothing is gained", () => {
  const b = summitBoard({ deck: 0 });
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influence(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "if only some of the cards can be drawn, only those gain influence", () => {
  const b = summitBoard({ deck: 1 });
  play(b.engine, P1, b.id("draw2"));
  assert.equal(deckOf(b.engine, P1).length, 0, "control: the one card was drawn");
  assert.equal(influence(b.engine, P1), 21, "only 1 card was actually drawn");
});

clause(SUMMIT, "0:rule", "the opponent drawing does not gain you influence (and gains them nothing either)", () => {
  const b = summitBoard();
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  const top = deckOf(b.engine, P2)[0];
  play(b.engine, P2, b.id("oppDraw1"));
  assert.equal(zoneOf(b.engine, top), "hand", "control: the opponent drew");
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(influence(b.engine, P2), 20);
});

clause(SUMMIT, "0:rule", "a card put into your hand without drawing it (returned from play) gains nothing", () => {
  const b = summitBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "control: it went to hand");
  assert.equal(influence(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "the Summit's controller is the one who gains: an opponent-controlled Summit gains them influence when THEY draw, not me", () => {
  const b = summitBoard({ summitOwner: P2 });
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influence(b.engine, P1), 20, "my draw gains me nothing: it is not my Summit");
  assert.equal(influence(b.engine, P2), 20);
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  play(b.engine, P2, b.id("oppDraw1"));
  assert.equal(influence(b.engine, P2), 21, "their draw gains them influence");
  assert.equal(influence(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "once the Summit has left play, drawing gains nothing", () => {
  const b = summitBoard();
  b.engine.state.cards[b.id("gs")].zone = "discard";
  b.engine.state.players[P1].play = b.engine.state.players[P1].play.filter((c) => c !== b.id("gs"));
  b.engine.state.players[P1].discard.push(b.id("gs"));
  play(b.engine, P1, b.id("draw1"));
  assert.equal(influence(b.engine, P1), 20);
});

clause(SUMMIT, "0:rule", "pays the printed cost of 3, needs [G][G][G], and enters play as a location", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("gs"));
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  assert.equal(before - ready(b.engine), 3);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("gs")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gs", def: printing(SUMMIT), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 5, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("gs")), "two [G] is not [G][G][G]");
});

// --- Index of Natural Forces -------------------------------------------------
// CAPITALIZE -- COST: Pay 1. Deplete this card. -- EFFECT: Draw a card.
// Item, cost 5, threshold [G][G][G].

const INDEX = "f3dfbded-b1d6-4f2d-accc-70839e0edfdd";

function indexBoard(o: { resources?: number; deck?: number; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "idx", def: printing(INDEX), owner: P1, zone: "play", depleted: o.depleted ?? false },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("d", o.deck ?? 5, P1, "deck"),
      ...fillers("e", 5, P2, "deck"),
      ...bank("greed", o.resources ?? 3, P1)
    ]
  });
}

clause(INDEX, "0:ability:capitalize", "pays 1, depletes the Index and draws exactly one card (the top of your deck)", () => {
  const b = indexBoard();
  const top = deckOf(b.engine, P1)[0];
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("idx"), "capitalize");
  assert.equal(before - ready(b.engine), 1, "the cost of 1 is paid");
  assert.equal(isDepleted(b.engine, b.id("idx")), true, "the Index is depleted");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "exactly one card");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 4);
  assert.equal(deckOf(b.engine, P2).length, 5, "the opponent's deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("idx")), "play", "the Index stays in play");
});

clause(INDEX, "0:ability:capitalize", "it cannot be used while the Index is depleted (so once per turn), and nothing is paid by the refusal", () => {
  const b = indexBoard();
  activate(b.engine, P1, b.id("idx"), "capitalize");
  const before = ready(b.engine);
  assert.throws(() => activate(b.engine, P1, b.id("idx"), "capitalize"));
  assert.equal(ready(b.engine), before, "no resource was paid");
  assert.equal(deckOf(b.engine, P1).length, 4, "no second card drawn");
});

clause(INDEX, "0:ability:capitalize", "a depleted Index cannot be used even with plenty of resources", () => {
  const b = indexBoard({ depleted: true, resources: 5 });
  assert.throws(() => activate(b.engine, P1, b.id("idx"), "capitalize"));
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(INDEX, "0:ability:capitalize", "it needs 1 resource: refused with none, fine with exactly 1", () => {
  const none = indexBoard({ resources: 0 });
  assert.throws(() => activate(none.engine, P1, none.id("idx"), "capitalize"));
  assert.equal(isDepleted(none.engine, none.id("idx")), false, "not depleted by the refused attempt");
  assert.equal(deckOf(none.engine, P1).length, 5);

  const one = indexBoard({ resources: 1 });
  activate(one.engine, P1, one.id("idx"), "capitalize");
  assert.equal(ready(one.engine), 0);
  assert.equal(deckOf(one.engine, P1).length, 4);
});

clause(INDEX, "0:ability:capitalize", "the Index is restored at the start of your next turn, so it can be used again", () => {
  const b = indexBoard();
  activate(b.engine, P1, b.id("idx"), "capitalize");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("idx")), false, "restored by the restore rule");
  activate(b.engine, P1, b.id("idx"), "capitalize");
  assert.equal(deckOf(b.engine, P1).length, 3, "drew again");
});

clause(INDEX, "0:ability:capitalize", "it can be used the turn it enters play (an item has no summoning sickness)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "idx", def: printing(INDEX), owner: P1, zone: "hand" }, ...fillers("d", 3, P1, "deck"), ...bank("greed", 6, P1)]
  });
  play(b.engine, P1, b.id("idx"));
  assert.equal(zoneOf(b.engine, b.id("idx")), "play");
  activate(b.engine, P1, b.id("idx"), "capitalize");
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(INDEX, "0:ability:capitalize", "only its controller can use it", () => {
  const b = indexBoard();
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  assert.throws(() => activate(b.engine, P2, b.id("idx"), "capitalize"));
  assert.equal(isDepleted(b.engine, b.id("idx")), false);
  assert.equal(deckOf(b.engine, P2).length, 5);
});

clause(INDEX, "0:ability:capitalize", "with an empty deck the cost is still paid and nothing is drawn", () => {
  const b = indexBoard({ deck: 0 });
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("idx"), "capitalize");
  assert.equal(before - ready(b.engine), 1);
  assert.equal(isDepleted(b.engine, b.id("idx")), true);
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.result, undefined);
});

clause(INDEX, "0:ability:capitalize", "a face-down Index is just a resource and has no CAPITALIZE", () => {
  const b = indexBoard();
  b.engine.state.cards[b.id("idx")].faceDown = true;
  assert.throws(() => activate(b.engine, P1, b.id("idx"), "capitalize"));
});

clause(INDEX, "0:ability:capitalize", "pays the printed cost of 5 and needs [G][G][G] to put into play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "idx", def: printing(INDEX), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("idx"));
  assert.equal(before - ready(b.engine), 5);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "idx", def: printing(INDEX), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("idx")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "idx", def: printing(INDEX), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("idx")), "two [G] is not [G][G][G]");
});

// --- Intermittently Sneaky Lawyer --------------------------------------------
// While you have at least 6 cards in your hand, this card gains 1 strength and
// COVERT. Character (lawyer, mau), cost 3, threshold [G], 1/3/1 (str/spd/life).

const SNEAKY = "407c0aa1-fc27-4190-930d-cdffb0468606";

function sneakyBoard(handSize: number, o: { oppHand?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "isl", def: printing(SNEAKY), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...fillers("h", handSize, P1, "hand"),
      ...fillers("oh", o.oppHand ?? 0, P2, "hand"),
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "covertFoe", def: character({ name: "CovertFoe", life: 9, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...fillers("d", 5, P1, "deck")
    ]
  });
}

for (const handSize of [6, 7, 10]) {
  clause(SNEAKY, "0:rule", `with ${handSize} cards in hand it gains exactly 1 strength (2) and COVERT, and nothing else changes`, () => {
    const b = sneakyBoard(handSize);
    assert.equal(b.engine.getStat(b.id("isl"), "strength"), 2);
    assert.equal(b.engine.getStat(b.id("isl"), "life"), 1, "life is unchanged");
    assert.equal(b.engine.getStat(b.id("isl"), "speed"), 3, "speed is unchanged");
    assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), true);
  });
}

for (const handSize of [0, 1, 5]) {
  clause(SNEAKY, "0:rule", `with only ${handSize} cards in hand it has its printed 1 strength and no COVERT`, () => {
    const b = sneakyBoard(handSize);
    assert.equal(b.engine.getStat(b.id("isl"), "strength"), 1);
    assert.equal(b.engine.getStat(b.id("isl"), "life"), 1);
    assert.equal(b.engine.getStat(b.id("isl"), "speed"), 3);
    assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), false);
  });
}

clause(SNEAKY, "0:rule", "only YOUR hand counts: the opponent holding 8 cards does nothing", () => {
  const b = sneakyBoard(2, { oppHand: 8 });
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 1);
  assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), false);
});

clause(SNEAKY, "0:rule", "the bonus tracks the hand live: playing cards from a hand of 7 turns it off below 6", () => {
  const b = sneakyBoard(7);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 2, "7 cards");
  play(b.engine, P1, b.id("h0"));
  assert.equal(handOf(b.engine, P1).length, 6);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 2, "6 cards: still on");
  assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), true);
  play(b.engine, P1, b.id("h1"));
  assert.equal(handOf(b.engine, P1).length, 5);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 1, "5 cards: off");
  assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), false);
});

clause(SNEAKY, "0:rule", "the bonus turns on when the hand grows to 6 (drawing a card)", () => {
  const b = sneakyBoard(5);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 1);
  developDraw(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 6);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 2);
  assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), true);
});

clause(SNEAKY, "0:rule", "the bonus is a flat +1 however big the hand is (no stacking)", () => {
  const b = sneakyBoard(12);
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 2);
});

clause(SNEAKY, "0:rule", "it gives the bonus to itself only: another character of yours keeps its stats", () => {
  const b = sneakyBoard(6);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1);
  assert.equal(hasKeyword(b.engine, b.id("ally"), "covert"), false);
});

clause(SNEAKY, "0:rule", "gaining COVERT is real: with 6 cards a plain blocker cannot block it, a covert one can", () => {
  const b = sneakyBoard(6);
  declareAttackBy(b.engine, P1, [b.id("isl")]);
  assert.throws(() => declareBlock(b.engine, [b.id("foe")], P2), "a non-covert character cannot block a covert party");
  declareBlock(b.engine, [b.id("covertFoe")], P2);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertFoe")]);
});

clause(SNEAKY, "0:rule", "with 5 cards it is a plain attacker: a plain blocker can block it", () => {
  const b = sneakyBoard(5);
  declareAttackBy(b.engine, P1, [b.id("isl")]);
  declareBlock(b.engine, [b.id("foe")], P2);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe")]);
});

clause(SNEAKY, "0:rule", "the extra strength is real damage: 2 to the faction with 6 cards, 1 with 5", () => {
  for (const [handSize, expected] of [
    [6, 2],
    [5, 1]
  ] as const) {
    const b = sneakyBoard(handSize);
    fight(b.engine, P1, [b.id("isl")], { type: "faction", playerId: P2 }, []);
    assert.equal(influence(b.engine, P2), 20 - expected, `hand ${handSize}`);
  }
});

clause(SNEAKY, "0:rule", "as a blocker with 6 cards it is covert, so it can block only covert parties", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "isl", def: printing(SNEAKY), owner: P1, zone: "play" },
      ...fillers("h", 6, P1, "hand"),
      { key: "plainAtk", def: character({ name: "PlainAtk" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("plainAtk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("isl")], P1), "covert may block only covert");
});

clause(SNEAKY, "0:rule", "on the opponent's side it counts the controller's hand, not mine", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "isl", def: printing(SNEAKY), owner: P2, zone: "play" },
      ...fillers("h", 7, P1, "hand"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  assert.equal(b.engine.getStat(b.id("isl"), "strength"), 1, "its controller holds only 2 cards");
  assert.equal(hasKeyword(b.engine, b.id("isl"), "covert"), false);
});

// --- Irresistible Bribe ------------------------------------------------------
// COST: Pick a character. X is that character's strength. -- EFFECT: Destroy the
// character. Your opponent's faction gains X influence. Tactic, cost 3, threshold [G][G].

const BRIBE = "8e36b4a0-419d-413d-9512-b539e37681aa";

/** A free tactic giving the picked character -`amount` strength this turn (id `d`, declaration `t`). */
function debuffTactic(amount: number): CardDefinition {
  return tactic({
    name: `Debuff${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

function bribeBoard(o: { greed?: number; rage?: number; active?: Pid } = {}) {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const nerf = item({
    name: "Nerf",
    attachTo: "character",
    behavior: { abilities: [{ id: "n", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -3 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2 }), owner: P1, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther", strength: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4 }), owner: P2, zone: "play" },
      { key: "foeZero", def: character({ name: "FoeZero", strength: 0 }), owner: P2, zone: "play" },
      { key: "foeBuffed", def: character({ name: "FoeBuffed", strength: 3 }), owner: P2, zone: "play" },
      { key: "buff", def: buff, owner: P2, zone: "play", attachedToKey: "foeBuffed" },
      { key: "foeNerfed", def: character({ name: "FoeNerfed", strength: 1 }), owner: P2, zone: "play" },
      { key: "nerf", def: nerf, owner: P2, zone: "play", attachedToKey: "foeNerfed" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", strength: 6 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", strength: 6 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", strength: 6 }), owner: P2, zone: "discard" },
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

const bribePlay = (b: ReturnType<typeof bribeBoard>, key: string) => play(b.engine, P1, b.id("br"), { selected: { c: [b.id(key)] } });

clause(BRIBE, "0:ability", "destroys the picked opponent character and your opponent's faction gains X = its strength (4)", () => {
  const b = bribeBoard();
  const before = ready(b.engine);
  bribePlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(influence(b.engine, P2), 24, "the opponent's faction gains 4");
  assert.equal(influence(b.engine, P1), 20, "yours is untouched");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(b.engine, b.id("br")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeZero")), "play", "no other character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(BRIBE, "0:ability", "you can pick your own character: it is destroyed and the OPPONENT's faction still gains X (its strength 2)", () => {
  const b = bribeBoard();
  bribePlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(influence(b.engine, P2), 22, "'your opponent's faction' gains 2");
  assert.equal(influence(b.engine, P1), 20);
});

clause(BRIBE, "0:ability", "a character with 0 strength is destroyed and the opponent gains nothing", () => {
  const b = bribeBoard();
  bribePlay(b, "foeZero");
  assert.equal(zoneOf(b.engine, b.id("foeZero")), "discard");
  assert.equal(influence(b.engine, P2), 20);
});

clause(BRIBE, "0:ability", "X is the character's current strength including bonuses: base 3 plus an attached +2 gives 5", () => {
  const b = bribeBoard();
  assert.equal(b.engine.getStat(b.id("foeBuffed"), "strength"), 5, "control");
  bribePlay(b, "foeBuffed");
  assert.equal(zoneOf(b.engine, b.id("foeBuffed")), "discard");
  assert.equal(influence(b.engine, P2), 25);
});

clause(BRIBE, "0:ability", "X is never negative: a character pushed below 0 strength gives X = 0 (the opponent loses nothing)", () => {
  const b = bribeBoard();
  assert.ok(b.engine.getStat(b.id("foeNerfed"), "strength") <= 0, "control: strength 1 - 3 is 0 or below");
  bribePlay(b, "foeNerfed");
  assert.equal(zoneOf(b.engine, b.id("foeNerfed")), "discard");
  assert.equal(influence(b.engine, P2), 20, "CR 410.4: a number pushed below 0 stays at 0");
});

clause(BRIBE, "0:ability", "the pick must be a character in play: not a faction, item, location, face-down card, or a card in hand or discard", () => {
  const b = bribeBoard();
  const attempt = (id: string) => () => playRaw(b.engine, P1, b.id("br"), { selected: { c: [id] } });
  assert.throws(attempt(factionOf(b.engine, P1)), "your faction (CR 202.9)");
  assert.throws(attempt(factionOf(b.engine, P2)), "their faction (CR 202.9)");
  assert.throws(attempt(b.id("thing")), "an item");
  assert.throws(attempt(b.id("place")), "a location");
  assert.throws(attempt(b.id("hidden")), "a face-down card is only a resource");
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("br")), "hand", "nothing was played");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(BRIBE, "0:ability", "exactly one character: none and two are refused", () => {
  const b = bribeBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("br"), { selected: { c: [] } }));
  assert.throws(() => playRaw(b.engine, P1, b.id("br"), {}));
  assert.throws(() => playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe"), b.id("mine")] } }));
  assert.equal(zoneOf(b.engine, b.id("br")), "hand");
});

clause(BRIBE, "0:ability", "is refused one resource short of its cost of 3, and without [G][G] even with enough other resources", () => {
  const short = bribeBoard({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("br"), { selected: { c: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");

  const noThreshold = bribeBoard({ greed: 1, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("br"), { selected: { c: [noThreshold.id("foe")] } }), "one [G] is not [G][G]");

  const exact = bribeBoard({ greed: 2, rage: 1 });
  bribePlay(exact, "foe");
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "[G][G] plus one other resource is enough");
});

clause(BRIBE, "0:ability", "X is fixed when the character is picked (a cost): weakening it in response does not lower what the opponent gains", () => {
  const b = bribeBoard({ active: P1 });
  b.engine.state.cards[b.id("br")].zone = "hand";
  const responder = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "debuff", def: debuffTactic(3), owner: P2, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  playRaw(responder.engine, P1, responder.id("br"), { selected: { c: [responder.id("foe")] } });
  playRaw(responder.engine, P2, responder.id("debuff"), { selected: { t: [responder.id("foe")] } });
  resolvePendingResponses(responder.engine);
  assert.equal(zoneOf(responder.engine, responder.id("foe")), "discard", "control: the Bribe resolved");
  assert.equal(influence(responder.engine, P2), 24, "X was 4 when the character was picked, not 1 after the response");
});

clause(BRIBE, "0:ability", "if the picked character is destroyed in response, the opponent still gains X (the instruction does not fizzle)", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "br", def: printing(BRIBE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: it was destroyed by the response");
  assert.equal(influence(b.engine, P2), 24, "the Bribe still resolves: X was fixed at 4 (CR 402.5a)");
});

// --- Limited Liability -------------------------------------------------------
// This turn, no damage can be inflicted and no cards can be destroyed. This does
// not affect paying costs; if a cost requires you to destroy a card, it is still
// destroyed. Tactic, cost 2, threshold [G].

const LIABILITY = "61a6b51d-fd2d-459f-acef-261b08962694";

/** A free tactic dealing `amount` damage to a chosen card matching `type` (id `d`, declaration `t`). */
function damageTactic(type: "character" | "location" | "faction", amount: number): CardDefinition {
  return tactic({
    name: `Damage${type}${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic making the controller's faction lose `amount` influence (not damage). */
function drainTactic(amount: number): CardDefinition {
  return tactic({ name: `Drain${amount}`, cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -amount }] }] } });
}

function liabilityBoard(o: { turn?: number; active?: Pid; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "itemKill", def: itemKiller(), owner: P1, zone: "hand" },
      { key: "shoot", def: damageTactic("character", 5), owner: P1, zone: "hand" },
      { key: "shootPlace", def: damageTactic("location", 5), owner: P1, zone: "hand" },
      { key: "shootFaction", def: damageTactic("faction", 5), owner: P1, zone: "hand" },
      { key: "drain", def: drainTactic(3), owner: P1, zone: "hand" },
      { key: "bounce", def: bouncer(), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 2, P1)
    ]
  });
}

const llPlay = (b: ReturnType<typeof liabilityBoard>) => play(b.engine, P1, b.id("ll"));

clause(LIABILITY, "0:rule", "pays the printed cost of 2 and needs [G]", () => {
  const b = liabilityBoard({ greed: 3 });
  const before = ready(b.engine);
  llPlay(b);
  assert.equal(before - ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("ll")), "discard");

  const short = liabilityBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ll")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ll")), "no [G]");
});

clause(LIABILITY, "0:rule", "no damage can be inflicted: a damaging effect on a character does nothing", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0, "no damage marked");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "a 5-damage hit on a 3-life character does not kill it");
});

clause(LIABILITY, "0:rule", "no damage can be inflicted on your own characters either", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(LIABILITY, "0:rule", "no damage can be inflicted on a location", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shootPlace"), { selected: { t: [b.id("place")] } });
  assert.equal(b.engine.state.cards[b.id("place")].damage, 0);
  assert.equal(zoneOf(b.engine, b.id("place")), "play");
});

clause(LIABILITY, "0:rule", "no damage can be inflicted on a faction: damage to a faction normally costs influence, now it costs none", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("shootFaction"), { selected: { t: [factionOf(b.engine, P2)] } });
  assert.equal(influence(b.engine, P2), 20);
  const control = liabilityBoard();
  play(control.engine, P1, control.id("shootFaction"), { selected: { t: [factionOf(control.engine, P2)] } });
  assert.equal(influence(control.engine, P2), 15, "control: without Limited Liability the same hit costs 5 influence");
});

clause(LIABILITY, "0:rule", "no cards can be destroyed: a destroy effect on a character does nothing", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  play(b.engine, P1, b.id("itemKill"), { selected: { t: [b.id("thing")] } });
  assert.equal(zoneOf(b.engine, b.id("thing")), "play", "nor can an item be destroyed");
  const control = liabilityBoard();
  play(control.engine, P1, control.id("kill"), { selected: { t: [control.id("foe")] } });
  assert.equal(zoneOf(control.engine, control.id("foe")), "discard", "control: without Limited Liability the kill works");
});

clause(LIABILITY, "0:rule", "it protects both players' cards: my own character cannot be destroyed either", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(LIABILITY, "0:rule", "no damage in battle: an unblocked attack on the faction costs it no influence", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 20, "3 strength inflicted nothing");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "control: the battle did happen (the attacker is depleted)");
});

clause(LIABILITY, "0:rule", "no damage in battle: a blocked attack leaves both the attacker and the blocker undamaged and alive", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, [b.id("foe"), b.id("foe2")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "3 + 1 damage would have killed my 3-life attacker");
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0);
  assert.equal(b.engine.state.cards[b.id("foe2")].damage, 0);
  assert.equal(battleOf(b.engine), undefined, "control: the battle finished");
});

clause(LIABILITY, "0:rule", "no damage in battle: an attack on a location leaves it undamaged", () => {
  const b = liabilityBoard();
  llPlay(b);
  fight(b.engine, P1, [b.id("mine")], { type: "card", cardId: b.id("place") }, []);
  assert.equal(b.engine.state.cards[b.id("place")].damage, 0);
  assert.equal(zoneOf(b.engine, b.id("place")), "play", "3 damage would have destroyed the 2-structure location");
});

clause(LIABILITY, "0:rule", "the opponent can attack into it too: on their turn after Limited Liability (played in response) nothing is hurt", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  assert.equal(b.engine.state.responseWindow?.phase, "acceptingResponses");
  // the attacker passes, then the defender plays Limited Liability in the response window
  while (b.engine.state.responseWindow?.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow!.priorityPlayerId });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the blocker survived 4 damage");
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
  assert.equal(b.engine.state.cards[b.id("atk")].damage, 0);
  assert.equal(influence(b.engine, P1), 20);
});

clause(LIABILITY, "0:rule", "played in response to a damaging tactic, it stops that tactic's damage", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "shoot", def: damageTactic("character", 5), owner: P2, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("shoot")), "discard", "control: the shot resolved");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the 5 damage inflicted nothing");
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
});

clause(LIABILITY, "0:rule", "losing influence is not damage: a 'loses influence' effect still works", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("drain"));
  assert.equal(influence(b.engine, P2), 17, "the opponent's faction lost 3 influence (CR 408.3b)");
});

clause(LIABILITY, "0:rule", "it only stops destroying and damage: moving a card to a hand is not affected", () => {
  const b = liabilityBoard();
  llPlay(b);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(LIABILITY, "0:rule", "this does not affect paying costs: a cost that destroys a card still destroys it", () => {
  const sacItem = item({
    name: "SacItem",
    behavior: { abilities: [{ id: "sac", type: "activated", costs: [{ type: "destroy", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "sac", def: sacItem, owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  activate(b.engine, P1, b.id("sac"), "sac");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the cost destroyed the item even under Limited Liability");
  assert.equal(deckOf(b.engine, P1).length, 2, "and the ability's effect resolved");
});

clause(LIABILITY, "0:rule", "this does not affect paying costs: damage inflicted as a cost is still inflicted", () => {
  const siphon = location({
    name: "Siphon",
    structure: 3,
    behavior: { abilities: [{ id: "sip", type: "activated", costs: [{ type: "dealDamage", target: "source", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "sip", def: siphon, owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  activate(b.engine, P1, b.id("sip"), "sip");
  assert.equal(deckOf(b.engine, P1).length, 2, "control: the ability resolved");
  assert.equal(b.engine.state.cards[b.id("sip")].damage, 1, "the damage that was a COST of the ability is still inflicted");
});

clause(LIABILITY, "0:rule", "damage already on a card before Limited Liability stays on it (it is not healed)", () => {
  const b = liabilityBoard();
  b.engine.state.cards[b.id("foe")].damage = 2;
  llPlay(b);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 2);
});

clause(LIABILITY, "0:rule", "no card can be destroyed: a character that would die because its life drops below its damage survives", () => {
  const shrink = tactic({
    name: "Shrink",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: -2, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "shrink", def: shrink, owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play", damage: 2 },
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("ll"));
  play(b.engine, P1, b.id("shrink"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 1, "control: its life is now 1 with 2 damage on it");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "but no card can be destroyed this turn");
});

clause(LIABILITY, "0:rule", "it lasts this turn only: on the next turn damage and destruction work again", () => {
  const b = liabilityBoard({ turn: 1 });
  llPlay(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "protected this turn");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const second = tactic({
    name: "Kill2",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const spare = b.engine.state.cards[b.id("shoot")];
  assert.equal(spare.zone, "hand");
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "damage works again on the next turn");
  void second;
});

clause(LIABILITY, "0:rule", "it also lasts through the opponent's turn when played on the opponent's turn (this turn = the turn it was played)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ll", def: printing(LIABILITY), owner: P1, zone: "hand" },
      { key: "shoot", def: damageTactic("character", 5), owner: P2, zone: "hand" },
      { key: "shoot2", def: damageTactic("character", 5), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P2, b.id("shoot"), { selected: { t: [b.id("mine")] } });
  playRaw(b.engine, P1, b.id("ll"));
  resolvePendingResponses(b.engine);
  play(b.engine, P2, b.id("shoot2"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "still protected for the rest of that turn");
});

// --- Mafia Lawyer ------------------------------------------------------------
// When this card enters play, your faction loses 2 influence. If this card is
// destroyed in a battle your faction gains X influence, where X is the total
// strength of the opposing party. Character (mercenary, lawyer, mau), cost 4,
// threshold [G][G][G], 3/3/3.

const MAFIA = "3ffd38c8-6661-4ff5-9c61-fc03031ca469";

clause(MAFIA, "0:rule", "deploying it pays 4 and costs your faction exactly 2 influence (the opponent's is untouched)", () => etbDeploys(MAFIA, -2));
clause(MAFIA, "0:rule", "the influence is lost when it enters play, not while it is still being deployed", () => etbWaitsForEntering(MAFIA, -2));
clause(MAFIA, "0:rule", "another character entering play, or the Lawyer leaving play, loses no influence", () => etbNearMisses(MAFIA));
clause(MAFIA, "0:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 4 in total)", () => etbEveryEntry(MAFIA, -2));
clause(MAFIA, "0:rule", "put into play by an effect it still costs 2 influence", () => etbPutIntoPlay(MAFIA, -2));
clause(MAFIA, "0:rule", "'your faction' is the controller's: the opponent's Lawyer costs the opponent 2, not me", () => etbOpponentControlled(MAFIA, -2));
clause(MAFIA, "0:rule", "with exactly 2 influence you hit 0 and lose; with 3 you survive on 1", () => etbInfluenceLoss(MAFIA, 2));
clause(MAFIA, "0:rule", "is refused one resource short of 4, and without [G][G][G]", () => {
  const short = etbBoard(MAFIA, { greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("subject")));
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "subject", def: printing(MAFIA), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "two [G] is not [G][G][G]");
  const exact = etbBoard(MAFIA, { greed: 4 });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play");
});

/** P2 attacks P1's faction (or location) with `atkStr`; the Lawyer (P1, 3/3/3) blocks. Attackers are tough so they survive the Lawyer's 3 damage. */
function mafiaBlockBoard(atkStrengths: number[], o: { buffFirst?: number } = {}) {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: o.buffFirst ?? 0 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      ...atkStrengths.map((strength, i) => ({ key: `atk${i}`, def: character({ name: `Atk${i}`, strength, life: 9 }), owner: P2, zone: "play" as const })),
      ...(o.buffFirst ? [{ key: "buff", def: buff, owner: P2, zone: "play" as const, attachedToKey: "atk0" }] : []),
      { key: "place", def: location({ name: "Place", structure: 20 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
}

clause(MAFIA, "1:rule", "destroyed while blocking: its controller's faction gains the opposing (attacking) party's strength (a single attacker of 4)", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: it was destroyed by 4 damage");
  assert.equal(influence(b.engine, P1), 24, "gains X = 4");
  assert.equal(influence(b.engine, P2), 20, "the opponent's faction is untouched");
});

clause(MAFIA, "1:rule", "X is the TOTAL strength of the opposing party: a party of 4 + 2 gives 6", () => {
  const b = mafiaBlockBoard([4, 2]);
  fight(b.engine, P2, [b.id("atk0"), b.id("atk1")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influence(b.engine, P1), 26, "gains X = 4 + 2");
});

clause(MAFIA, "1:rule", "X counts only the OPPOSING party: allies fighting beside the Lawyer are not added", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml"), b.id("ally")]);
  // the attacker assigns all 4 to the first legal target, the Lawyer is destroyed; the ally (strength 1) is on its own side
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer died");
  assert.equal(influence(b.engine, P1), 24, "X = 4, not 4 + the ally's 1");
});

clause(MAFIA, "1:rule", "X is the opposing party's current strength, bonuses included", () => {
  const b = mafiaBlockBoard([4], { buffFirst: 2 });
  assert.equal(b.engine.getStat(b.id("atk0"), "strength"), 6, "control");
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influence(b.engine, P1), 26, "X = 6");
});

clause(MAFIA, "1:rule", "also works when the attack is on a location and the Lawyer blocks", () => {
  const b = mafiaBlockBoard([4]);
  fight(b.engine, P2, [b.id("atk0")], { type: "card", cardId: b.id("place") }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influence(b.engine, P1), 24);
});

clause(MAFIA, "1:rule", "destroyed while ATTACKING: X is the strength of the blocking party (4 + 2)", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "b0", def: character({ name: "B0", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 2, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("ml"), b.id("ally")], { type: "faction", playerId: P2 }, [b.id("b0"), b.id("b1")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: the Lawyer was destroyed in the battle");
  assert.equal(influence(b.engine, P1), 26, "X = 4 + 2, the blocking party's strength; the ally's 1 is not counted");
  assert.equal(influence(b.engine, P2), 20);
});

clause(MAFIA, "1:rule", "if it survives the battle nothing is gained", () => {
  const b = mafiaBlockBoard([2]);
  fight(b.engine, P2, [b.id("atk0")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "play", "control: 2 damage does not kill a 3-life Lawyer");
  assert.equal(influence(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "destroyed outside a battle (a destroy effect in your main phase) it gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ml")] } });
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control");
  assert.equal(influence(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "the influence goes to the Lawyer's controller: an opponent's Lawyer destroyed in battle gains its controller, not me", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P1, zone: "play" },
      { key: "ml", def: printing(MAFIA), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard");
  assert.equal(influence(b.engine, P2), 24, "its controller gains 4");
  assert.equal(influence(b.engine, P1), 20);
});

clause(MAFIA, "1:rule", "a Lawyer that is not in the battle is not 'destroyed in a battle': destroying it with a tactic during someone else's battle gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: it was destroyed during the battle's response window");
  assert.equal(influence(b.engine, P1), 20, "it was not part of the battle, so there is no opposing party and nothing is gained");
});

clause(MAFIA, "1:rule", "X is the opposing party's strength even when the attackers die in the same damage step", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ml")]);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "the Lawyer took 4");
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "and the attacker took 3: both died together");
  assert.equal(influence(b.engine, P1), 24, "the opposing party's total strength was 4 when the Lawyer was destroyed");
});

// --- Magic Vault -------------------------------------------------------------
// At the start of your turn, you may pick a faction. If you do, that faction
// gains 2 influence. Item, cost 6, threshold [G].

const VAULT = "d95acacb-9666-4421-96ff-b7303886ba22";

/** `vaults` Magic Vault(s) controlled by `controller`; `starting` is the player whose turn is about to begin (default: the controller). */
function vaultBoard(o: { controller?: Pid; starting?: Pid; vaults?: number; faceDown?: boolean; inPlay?: boolean } = {}) {
  const controller = o.controller ?? P1;
  const starting = o.starting ?? controller;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: other(starting),
    cards: [
      ...Array.from({ length: o.vaults ?? 1 }, (_, i) => ({
        key: `v${i}`,
        def: printing(VAULT),
        owner: controller,
        zone: o.inPlay === false ? ("discard" as const) : ("play" as const),
        faceDown: o.faceDown ?? false
      })),
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck")
    ]
  });
}

/** Answers FTA-style prompts for the Vault: order any triggers, and make each faction pick from `picks` in turn. */
function driveVaults(engine: SpoilsEngine, picks: CardInstanceId[][]): string[] {
  const seen: string[] = [];
  let next = 0;
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(engine)!;
    if (isDevelopPrompt(engine)) {
      developDrawLeft(engine, pc.playerId as Pid); // the turn's Develop Rule is not what this drives
      continue;
    }
    seen.push(`${pc.kind}:${pc.playerId}`);
    const choice =
      pc.kind === "orderTriggers"
        ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] }
        : { kind: "chooserSelectsTarget", selected: picks[next++] ?? [] };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return seen;
}

clause(VAULT, "0:rule", "at the start of your turn you are asked to pick a faction (you may also pick none)", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Vault's controller picks");
});

clause(VAULT, "0:rule", "picking your own faction gains it exactly 2 influence, and the opponent's faction nothing", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  pick(b.engine, P1, [factionOf(b.engine, P1)]);
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VAULT, "0:rule", "picking the opponent's faction gains THAT faction 2 influence, and yours nothing", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  pick(b.engine, P1, [factionOf(b.engine, P2)]);
  assert.equal(influence(b.engine, P2), 22);
  assert.equal(influence(b.engine, P1), 20);
});

clause(VAULT, "0:rule", "'you may': picking no faction changes nothing", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  pick(b.engine, P1, []);
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VAULT, "0:rule", "only a faction can be picked: a character, an item or two factions are refused", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  assert.throws(() => pick(b.engine, P1, [b.id("myChar")]), "a character");
  assert.throws(() => pick(b.engine, P1, [b.id("foeChar")]), "an opponent's character");
  assert.throws(() => pick(b.engine, P1, [b.id("thing")]), "an item");
  assert.throws(() => pick(b.engine, P1, [factionOf(b.engine, P1), factionOf(b.engine, P2)]), "only one faction");
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
});

clause(VAULT, "0:rule", "only the Vault's controller makes the pick", () => {
  const b = vaultBoard();
  startTurnOf(b.engine, P1);
  assert.throws(() => pick(b.engine, P2, [factionOf(b.engine, P2)]));
  assert.equal(influence(b.engine, P2), 20);
});

clause(VAULT, "0:rule", "it is at the start of YOUR turn only: nothing happens at the start of the opponent's turn", () => {
  const b = vaultBoard({ starting: P2 });
  startTurnOf(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick on the opponent's turn");
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(influence(b.engine, P2), 20);
});

clause(VAULT, "0:rule", "it triggers at the start of each of your turns, and not on the opponent's turns in between", () => {
  const b = vaultBoard({ starting: P1 });
  let gains = 0;
  let active: Pid = P2;
  for (let i = 0; i < 4; i++) {
    endTurn(b.engine, active);
    active = other(active);
    if (active === P1) {
      assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `turn ${i + 2}: my turn`);
      pick(b.engine, P1, [factionOf(b.engine, P1)]);
      gains += 2;
    } else {
      assert.equal(b.engine.state.pendingChoice, undefined, `turn ${i + 2}: the opponent's turn`);
    }
  }
  assert.equal(influence(b.engine, P1), 20 + gains);
  assert.equal(gains, 4, "two of my turns passed");
});

clause(VAULT, "0:rule", "'your turn' is the controller's: an opponent-controlled Vault asks the opponent on THEIR turn and nobody on mine", () => {
  const mine = vaultBoard({ controller: P2, starting: P1 });
  startTurnOf(mine.engine, P1);
  assert.equal(mine.engine.state.pendingChoice, undefined, "it is not my Vault: my turn start asks nothing");

  const theirs = vaultBoard({ controller: P2, starting: P2 });
  startTurnOf(theirs.engine, P2);
  assert.equal(pending(theirs.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(theirs.engine)?.playerId, P2, "the Vault's controller picks");
  pick(theirs.engine, P2, [factionOf(theirs.engine, P2)]);
  assert.equal(influence(theirs.engine, P2), 22);
});

clause(VAULT, "0:rule", "two Vaults give two picks: +2 each time", () => {
  const b = vaultBoard({ vaults: 2 });
  startTurnOf(b.engine, P1);
  const seen = driveVaults(b.engine, [[factionOf(b.engine, P1)], [factionOf(b.engine, P1)]]);
  assert.equal(seen.filter((s) => s.startsWith("chooserSelectsTarget")).length, 2, "two faction picks");
  assert.equal(influence(b.engine, P1), 24);
});

clause(VAULT, "0:rule", "two Vaults can gain different factions: +2 for each faction", () => {
  const b = vaultBoard({ vaults: 2 });
  startTurnOf(b.engine, P1);
  driveVaults(b.engine, [[factionOf(b.engine, P1)], [factionOf(b.engine, P2)]]);
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(influence(b.engine, P2), 22);
});

clause(VAULT, "0:rule", "a Vault that is not in play does nothing", () => {
  const b = vaultBoard({ inPlay: false });
  startTurnOf(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VAULT, "0:rule", "a face-down Vault is just a resource and does nothing", () => {
  const b = vaultBoard({ faceDown: true });
  startTurnOf(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VAULT, "0:rule", "pays the printed cost of 6 and needs [G]", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "v", def: printing(VAULT), owner: P1, zone: "hand" }, ...bank("greed", 7, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("v"));
  assert.equal(zoneOf(b.engine, b.id("v")), "play");
  assert.equal(before - ready(b.engine), 6);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "v", def: printing(VAULT), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("v")), "one resource short");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "v", def: printing(VAULT), owner: P1, zone: "hand" }, ...bank("rage", 8, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("v")), "no [G]");
});

// --- Mau "Consultant" --------------------------------------------------------
// When this card enters play, draw a card and your faction loses 2 influence.
// Character (mercenary, mau), cost 4, threshold [G], 2/2/2.

const CONSULTANT = "91af3988-3b58-4d90-bdd9-4f11ffa25d29";

clause(CONSULTANT, "0:rule", "deploying it pays 4, draws exactly one card (the top of your deck) and costs your faction 2 influence", () => etbDeploys(CONSULTANT, -2, 1));
clause(CONSULTANT, "0:rule", "both halves happen when it enters play, not while it is still being deployed", () => {
  const b = etbBoard(CONSULTANT);
  const top = deckOf(b.engine, P1)[0];
  playRaw(b.engine, P1, b.id("subject"));
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(zoneOf(b.engine, top), "deck", "no draw yet");
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P1), 18);
  assert.equal(zoneOf(b.engine, top), "hand");
});
clause(CONSULTANT, "0:rule", "another character entering play, or the Consultant leaving play, draws nothing and loses nothing", () => {
  etbNearMisses(CONSULTANT);
  const b = etbBoard(CONSULTANT, { zone: "play" });
  const deck = deckOf(b.engine, P1).length;
  play(b.engine, P1, b.id("freebie"));
  assert.equal(deckOf(b.engine, P1).length, deck, "no draw");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("subject")] } });
  assert.equal(deckOf(b.engine, P1).length, deck, "no draw when it leaves play");
});
clause(CONSULTANT, "0:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 2 cards, 4 influence)", () => {
  const b = etbBoard(CONSULTANT, { greed: 20 });
  play(b.engine, P1, b.id("subject"));
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("subject")] } });
  play(b.engine, P1, b.id("subject"));
  assert.equal(influence(b.engine, P1), 16);
  assert.equal(deckOf(b.engine, P1).length, 2, "drew two cards in total");
});
clause(CONSULTANT, "0:rule", "put into play by an effect it still draws a card and costs 2 influence", () => etbPutIntoPlay(CONSULTANT, -2, 1));
clause(CONSULTANT, "0:rule", "'your faction' and 'draw' are the controller's: the opponent's Consultant draws for and costs the opponent", () => etbOpponentControlled(CONSULTANT, -2, 1));
clause(CONSULTANT, "0:rule", "with an empty deck nothing is drawn but the 2 influence is still lost", () => {
  const b = etbBoard(CONSULTANT, { deck: 0 });
  play(b.engine, P1, b.id("subject"));
  assert.equal(influence(b.engine, P1), 18);
  assert.equal(b.engine.state.result, undefined);
});
clause(CONSULTANT, "0:rule", "with exactly 2 influence you hit 0 and lose; with 3 you survive on 1", () => etbInfluenceLoss(CONSULTANT, 2));
clause(CONSULTANT, "0:rule", "is refused one resource short of 4, and without [G]", () => {
  const short = etbBoard(CONSULTANT, { greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("subject")));
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "subject", def: printing(CONSULTANT), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "no [G]");
  const exact = etbBoard(CONSULTANT, { greed: 4 });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play");
});

// --- Mau Tough ---------------------------------------------------------------
// When this card enters play, your faction loses 4 influence. Character
// (mercenary, mau), cost 4, threshold [G][G], 4/3/5.

const TOUGH = "0b918764-9433-4dd1-96ae-6c2aa3d01d92";

clause(TOUGH, "0:rule", "deploying it pays 4 and costs your faction exactly 4 influence (the opponent's is untouched)", () => etbDeploys(TOUGH, -4));
clause(TOUGH, "0:rule", "the influence is lost when it enters play, not while it is still being deployed", () => etbWaitsForEntering(TOUGH, -4));
clause(TOUGH, "0:rule", "another character entering play, or the Tough leaving play, loses no influence", () => etbNearMisses(TOUGH));
clause(TOUGH, "0:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 8 in total)", () => etbEveryEntry(TOUGH, -4));
clause(TOUGH, "0:rule", "put into play by an effect it still costs 4 influence", () => etbPutIntoPlay(TOUGH, -4));
clause(TOUGH, "0:rule", "'your faction' is the controller's: the opponent's Tough costs the opponent 4, not me", () => etbOpponentControlled(TOUGH, -4));
clause(TOUGH, "0:rule", "with exactly 4 influence you hit 0 and lose; with 5 you survive on 1", () => etbInfluenceLoss(TOUGH, 4));
clause(TOUGH, "0:rule", "is refused one resource short of 4, and without [G][G]", () => {
  const short = etbBoard(TOUGH, { greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("subject")));
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "subject", def: printing(TOUGH), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "one [G] is not [G][G]");
  const exact = etbBoard(TOUGH, { greed: 4 });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play");
});

// --- Nasty Butler ------------------------------------------------------------
// When this card enters play, your faction gains 4 influence. Character
// (lackey), cost 5, threshold [G][G], 2/2/4.

const BUTLER = "5757025e-cbfd-42a3-bf53-72947bc0a169";

clause(BUTLER, "0:rule", "deploying it pays 5 and gains your faction exactly 4 influence (the opponent's is untouched)", () => etbDeploys(BUTLER, 4));
clause(BUTLER, "0:rule", "the influence is gained when it enters play, not while it is still being deployed", () => etbWaitsForEntering(BUTLER, 4));
clause(BUTLER, "0:rule", "another character entering play, or the Butler leaving play, gains no influence", () => etbNearMisses(BUTLER));
clause(BUTLER, "0:rule", "it triggers each time it enters play (deploy, return to hand, deploy again: 8 in total)", () => etbEveryEntry(BUTLER, 4));
clause(BUTLER, "0:rule", "put into play by an effect it still gains 4 influence", () => etbPutIntoPlay(BUTLER, 4));
clause(BUTLER, "0:rule", "'your faction' is the controller's: the opponent's Butler gains the opponent 4, not me", () => etbOpponentControlled(BUTLER, 4));
clause(BUTLER, "0:rule", "it gains from any influence total, including a faction on 1", () => {
  const b = etbBoard(BUTLER, { influence: 1 });
  play(b.engine, P1, b.id("subject"));
  assert.equal(influence(b.engine, P1), 5);
  assert.equal(b.engine.state.result, undefined);
});
clause(BUTLER, "0:rule", "is refused one resource short of 5, and without [G][G]", () => {
  const short = etbBoard(BUTLER, { greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("subject")));
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "subject", def: printing(BUTLER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 8, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "one [G] is not [G][G]");
  const exact = etbBoard(BUTLER, { greed: 5 });
  play(exact.engine, P1, exact.id("subject"));
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play");
});

// --- Necromorph Bureaucrat ---------------------------------------------------
// SUBJUGATE -- COST: Deplete this card, pick up to 2 characters. -- EFFECT:
// Deplete the characters. Character (lackey, necromorph), cost 9, threshold
// [G][G], 1/3/1.

const BUREAUCRAT = "69676be7-99c3-4e06-908b-406a76439ce2";

function bureaucratBoard(o: { depleted?: boolean; resources?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "play", depleted: o.depleted ?? false },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "C3" }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1" }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...bank("greed", o.resources ?? 0, P1)
    ]
  });
}

const subjugate = (b: ReturnType<typeof bureaucratBoard>, keys: string[]) => activate(b.engine, P1, b.id("nb"), "subjugate", { selected: { cs: keys.map(b.id) } });

clause(BUREAUCRAT, "0:ability:subjugate", "picking 2 of your characters depletes the Bureaucrat and both of them, and no other character", () => {
  const b = bureaucratBoard();
  subjugate(b, ["c1", "c2"]);
  assert.equal(isDepleted(b.engine, b.id("nb")), true, "COST: deplete this card");
  assert.equal(isDepleted(b.engine, b.id("c1")), true);
  assert.equal(isDepleted(b.engine, b.id("c2")), true);
  assert.equal(isDepleted(b.engine, b.id("c3")), false, "an unpicked character is untouched");
  assert.equal(isDepleted(b.engine, b.id("f1")), false);
  assert.equal(isDepleted(b.engine, b.id("f2")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "it depletes the opponent's characters too (any characters can be picked)", () => {
  const b = bureaucratBoard();
  subjugate(b, ["f1", "f2"]);
  assert.equal(isDepleted(b.engine, b.id("f1")), true);
  assert.equal(isDepleted(b.engine, b.id("f2")), true);
  assert.equal(isDepleted(b.engine, b.id("c1")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "one of each side: your character and theirs", () => {
  const b = bureaucratBoard();
  subjugate(b, ["c1", "f1"]);
  assert.deepEqual(["c1", "c2", "f1", "f2"].map((key) => isDepleted(b.engine, b.id(key))), [true, false, true, false]);
});

clause(BUREAUCRAT, "0:ability:subjugate", "'up to 2': picking just one character works", () => {
  const b = bureaucratBoard();
  subjugate(b, ["f1"]);
  assert.equal(isDepleted(b.engine, b.id("nb")), true);
  assert.equal(isDepleted(b.engine, b.id("f1")), true);
  assert.deepEqual(["c1", "c2", "c3", "f2"].map((key) => isDepleted(b.engine, b.id(key))), [false, false, false, false]);
});

clause(BUREAUCRAT, "0:ability:subjugate", "'up to 2': picking nobody is allowed; the Bureaucrat is still depleted as the cost", () => {
  const b = bureaucratBoard();
  subjugate(b, []);
  assert.equal(isDepleted(b.engine, b.id("nb")), true);
  for (const key of ["c1", "c2", "c3", "f1", "f2"]) assert.equal(isDepleted(b.engine, b.id(key)), false, key);
});

clause(BUREAUCRAT, "0:ability:subjugate", "'up to 2': three characters are refused, and nothing is depleted by the refusal", () => {
  const b = bureaucratBoard();
  assert.throws(() => subjugate(b, ["c1", "c2", "f1"]));
  assert.equal(isDepleted(b.engine, b.id("nb")), false);
  for (const key of ["c1", "c2", "c3", "f1", "f2"]) assert.equal(isDepleted(b.engine, b.id(key)), false, key);
});

clause(BUREAUCRAT, "0:ability:subjugate", "only characters in play can be picked: an item, a location, a faction, a face-down card, or a card in hand or discard", () => {
  const b = bureaucratBoard();
  assert.throws(() => subjugate(b, ["thing"]), "an item");
  assert.throws(() => subjugate(b, ["place"]), "a location");
  assert.throws(() => subjugate(b, ["hidden"]), "a face-down card");
  assert.throws(() => subjugate(b, ["inHand"]), "a character in hand");
  assert.throws(() => subjugate(b, ["inDiscard"]), "a character in a discard pile");
  assert.throws(() => activate(b.engine, P1, b.id("nb"), "subjugate", { selected: { cs: [factionOf(b.engine, P2)] } }), "a faction (CR 202.9)");
  assert.equal(isDepleted(b.engine, b.id("nb")), false, "nothing was paid by the refused attempts");
  subjugate(b, ["c1"]);
  assert.equal(isDepleted(b.engine, b.id("c1")), true, "a character is accepted");
});

clause(BUREAUCRAT, "0:ability:subjugate", "the same character cannot be picked twice", () => {
  const b = bureaucratBoard();
  assert.throws(() => subjugate(b, ["c1", "c1"]));
  assert.equal(isDepleted(b.engine, b.id("nb")), false);
  assert.equal(isDepleted(b.engine, b.id("c1")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "an already depleted character can be picked (it simply stays depleted)", () => {
  const b = bureaucratBoard();
  b.engine.state.cards[b.id("c1")].depleted = true;
  subjugate(b, ["c1", "c2"]);
  assert.equal(isDepleted(b.engine, b.id("c1")), true);
  assert.equal(isDepleted(b.engine, b.id("c2")), true);
  assert.equal(isDepleted(b.engine, b.id("nb")), true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the Bureaucrat itself is a character and may be one of the picks", () => {
  const b = bureaucratBoard();
  subjugate(b, ["nb", "f1"]);
  assert.equal(isDepleted(b.engine, b.id("nb")), true);
  assert.equal(isDepleted(b.engine, b.id("f1")), true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "a depleted Bureaucrat cannot use it (the cost is depleting itself), and nothing else is depleted", () => {
  const b = bureaucratBoard({ depleted: true });
  assert.throws(() => subjugate(b, ["c1", "f1"]));
  assert.equal(isDepleted(b.engine, b.id("c1")), false);
  assert.equal(isDepleted(b.engine, b.id("f1")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "it costs no resources", () => {
  const b = bureaucratBoard({ resources: 3 });
  const before = ready(b.engine);
  subjugate(b, ["c1", "f1"]);
  assert.equal(ready(b.engine), before);
  const none = bureaucratBoard({ resources: 0 });
  subjugate(none, ["f1"]);
  assert.equal(isDepleted(none.engine, none.id("f1")), true, "usable with no resources at all");
});

clause(BUREAUCRAT, "0:ability:subjugate", "it can be used the turn the Bureaucrat enters play (abilities ignore summoning sickness)", () => {
  const b = bureaucratBoard();
  b.engine.state.cards[b.id("nb")].attackEligibleTurn = undefined;
  subjugate(b, ["f1"]);
  assert.equal(isDepleted(b.engine, b.id("f1")), true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "only its controller can use it", () => {
  const b = bureaucratBoard();
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  assert.throws(() => activate(b.engine, P2, b.id("nb"), "subjugate", { selected: { cs: [b.id("c1")] } }));
  assert.equal(isDepleted(b.engine, b.id("nb")), false);
  assert.equal(isDepleted(b.engine, b.id("c1")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the Bureaucrat is restored on its controller's next turn and can subjugate again", () => {
  const b = bureaucratBoard();
  subjugate(b, ["f1"]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("nb")), false);
  assert.equal(isDepleted(b.engine, b.id("c1")), false, "the depleted character of mine... was not depleted");
  subjugate(b, ["f2"]);
  assert.equal(isDepleted(b.engine, b.id("f2")), true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "depleted characters cannot attack or block until restored (so the depletion is real)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk" }), owner: P2, zone: "play" }
    ]
  });
  activate(b.engine, P1, b.id("nb"), "subjugate", { selected: { cs: [b.id("atk"), b.id("blk")] } });
  assert.throws(() => declareAttackBy(b.engine, P1, [b.id("atk")]), "a depleted attacker");
  b.engine.state.cards[b.id("atk")].depleted = false;
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.throws(() => declareBlock(b.engine, [b.id("blk")], P2), "a depleted blocker");
});

clause(BUREAUCRAT, "0:ability:subjugate", "a face-down Bureaucrat is just a resource and cannot subjugate", () => {
  const b = bureaucratBoard();
  b.engine.state.cards[b.id("nb")].faceDown = true;
  assert.throws(() => subjugate(b, ["c1"]));
});

clause(BUREAUCRAT, "0:ability:subjugate", "deploying it pays 9 and needs [G][G] (and it enters play as 1/3/1)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "hand" }, ...bank("greed", 10, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("nb"));
  assert.equal(zoneOf(b.engine, b.id("nb")), "play");
  assert.equal(before - ready(b.engine), 9);
  assert.equal(b.engine.getStat(b.id("nb"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("nb"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("nb"), "life"), 1);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "hand" }, ...bank("greed", 8, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("nb")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 10, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("nb")), "one [G] is not [G][G]");
});

// --- Paralegal Prodigy -------------------------------------------------------
// All your other lawyer characters gain 1 strength and 1 life. Character
// (lawyer, mau), cost 5, threshold [G][G][G], 3/3/3.

const PRODIGY = "75c3e5c5-5a6c-4314-b978-97a25cfcc51b";

function prodigyBoard(o: { prodigies?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...Array.from({ length: o.prodigies ?? 1 }, (_, i) => ({ key: `pp${i}`, def: printing(PRODIGY), owner: P1, zone: "play" as const })),
      { key: "lawyer", def: character({ name: "Lawyer", subtype: ["lawyer"], strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "lawyerMau", def: character({ name: "LawyerMau", subtype: ["lawyer", "mau"], strength: 1, life: 1, speed: 4 }), owner: P1, zone: "play" },
      { key: "mau", def: character({ name: "Mau", subtype: ["mau"], strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeLawyer", def: character({ name: "FoeLawyer", subtype: ["lawyer"], strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "lawyerItem", def: item({ name: "LawyerItem", subtype: ["lawyer"] }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

clause(PRODIGY, "0:rule", "your other lawyers gain exactly +1 strength and +1 life (speed unchanged)", () => {
  const b = prodigyBoard();
  assert.deepEqual(stats(b.engine, b.id("lawyer")), [3, 4, 2]);
  assert.deepEqual(stats(b.engine, b.id("lawyerMau")), [2, 2, 4], "a lawyer with another subtype too");
});

clause(PRODIGY, "0:rule", "the Prodigy does not buff itself ('other')", () => {
  const b = prodigyBoard();
  assert.deepEqual(stats(b.engine, b.id("pp0")), [3, 3, 3], "its printed 3/3 with speed 3");
});

clause(PRODIGY, "0:rule", "non-lawyers of yours are not affected (a mau, a plain character)", () => {
  const b = prodigyBoard();
  assert.deepEqual(stats(b.engine, b.id("mau")), [2, 2, 2]);
  assert.deepEqual(stats(b.engine, b.id("plain")), [2, 2, 2]);
});

clause(PRODIGY, "0:rule", "an opponent's lawyer is not affected ('your')", () => {
  const b = prodigyBoard();
  assert.deepEqual(stats(b.engine, b.id("foeLawyer")), [2, 3, 2]);
});

clause(PRODIGY, "0:rule", "it only affects characters: an item with the lawyer subtype gains nothing", () => {
  const b = prodigyBoard();
  assert.equal(b.engine.getStat(b.id("lawyerItem"), "strength") ?? 0, 0);
  assert.equal(b.engine.getStat(b.id("lawyerItem"), "life") ?? 0, 0);
});

clause(PRODIGY, "0:rule", "two Prodigies each count as the other's 'other lawyer': +1 each, and a third lawyer gets +2", () => {
  const b = prodigyBoard({ prodigies: 2 });
  assert.deepEqual(stats(b.engine, b.id("pp0")), [4, 4, 3], "buffed by the other Prodigy only");
  assert.deepEqual(stats(b.engine, b.id("pp1")), [4, 4, 3]);
  assert.deepEqual(stats(b.engine, b.id("lawyer")), [4, 5, 2], "+1/+1 from each Prodigy");
});

clause(PRODIGY, "0:rule", "a lawyer that enters play later is buffed at once", () => {
  const lawyerCard = character({ name: "Newcomer", subtype: ["lawyer"], strength: 1, life: 1, speed: 1 });
  const b = prodigyBoard({ extra: [{ key: "newcomer", def: lawyerCard, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("newcomer"));
  assert.equal(zoneOf(b.engine, b.id("newcomer")), "play");
  assert.deepEqual(stats(b.engine, b.id("newcomer")), [2, 2, 1]);
});

clause(PRODIGY, "0:rule", "the bonus is real in battle: a buffed lawyer deals 1 extra damage and survives 1 extra", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "pp0", def: printing(PRODIGY), owner: P1, zone: "play" },
      { key: "lawyer", def: character({ name: "Lawyer", subtype: ["lawyer"], strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("lawyer")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(b.engine.state.cards[b.id("blk")].damage, 3, "2 + 1 strength");
  assert.equal(zoneOf(b.engine, b.id("lawyer")), "play", "2 damage does not kill a 2 + 1 = 3 life lawyer");
});

clause(PRODIGY, "0:rule", "the buff ends when the Prodigy leaves play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pp0", def: printing(PRODIGY), owner: P1, zone: "play" },
      { key: "lawyer", def: character({ name: "Lawyer", subtype: ["lawyer"], strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stats(b.engine, b.id("lawyer")).slice(0, 2), [3, 4]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("pp0")] } });
  assert.equal(zoneOf(b.engine, b.id("pp0")), "discard");
  assert.deepEqual(stats(b.engine, b.id("lawyer")).slice(0, 2), [2, 3]);
});

clause(PRODIGY, "0:rule", "a face-down Prodigy is just a resource and buffs nothing", () => {
  const b = prodigyBoard();
  b.engine.state.cards[b.id("pp0")].faceDown = true;
  assert.deepEqual(stats(b.engine, b.id("lawyer")), [2, 3, 2]);
});

clause(PRODIGY, "0:rule", "an opponent-controlled Prodigy buffs THEIR lawyers, not mine", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pp0", def: printing(PRODIGY), owner: P2, zone: "play" },
      { key: "mineLawyer", def: character({ name: "MineLawyer", subtype: ["lawyer"], strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "theirLawyer", def: character({ name: "TheirLawyer", subtype: ["lawyer"], strength: 2, life: 3 }), owner: P2, zone: "play" }
    ]
  });
  assert.deepEqual(stats(b.engine, b.id("mineLawyer")).slice(0, 2), [2, 3]);
  assert.deepEqual(stats(b.engine, b.id("theirLawyer")).slice(0, 2), [3, 4]);
});

clause(PRODIGY, "0:rule", "pays the printed cost of 5 and needs [G][G][G]", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pp", def: printing(PRODIGY), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("pp"));
  assert.equal(zoneOf(b.engine, b.id("pp")), "play");
  assert.equal(before - ready(b.engine), 5);
  assert.deepEqual(stats(b.engine, b.id("pp")), [3, 3, 3]);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pp", def: printing(PRODIGY), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("pp")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pp", def: printing(PRODIGY), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pp")), "two [G] is not [G][G][G]");
});

// --- Pettifogger -------------------------------------------------------------
// If this card blocks, destroy it and all members of the attacking party.
// Character (lawyer, mau), cost 3, threshold [G], 1/3/1.

const PETTIFOGGER = "80e8609e-a1a2-4f0f-8d77-d455fcb1a9aa";

/** P2 (active) attacks P1's faction. P1 has the Pettifogger `pf`, a sturdy `ally`, and `atk0..n-1` (strength 2, life 9) are P2's attackers; `home` is a P2 character that stays out of the attack. */
function pettiBoard(attackers = 1, o: { pettifoggers?: number; attackerTarget?: "faction" | "location" } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "play" },
      ...(o.pettifoggers === 2 ? [{ key: "pf2", def: printing(PETTIFOGGER), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      ...Array.from({ length: attackers }, (_, i) => ({ key: `atk${i}`, def: character({ name: `Atk${i}`, strength: 2, life: 9 }), owner: P2, zone: "play" as const })),
      { key: "home", def: character({ name: "Home", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" }
    ]
  });
}

const pettiFight = (b: ReturnType<typeof pettiBoard>, attackers: string[], blockers: string[], target: Parameters<typeof fight>[3] = { type: "faction", playerId: P1 }) =>
  fight(b.engine, P2, attackers.map(b.id), target, blockers.map(b.id));

clause(PETTIFOGGER, "0:rule", "blocking a lone attacker destroys the Pettifogger and the attacker", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard", "it destroys itself");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard", "and the attacker");
  assert.equal(influence(b.engine, P1), 20, "the attacker never gets to hit the faction");
  assert.equal(battleOf(b.engine), undefined, "the battle is over");
});

clause(PETTIFOGGER, "0:rule", "blocking a party destroys ALL members of the attacking party", () => {
  const b = pettiBoard(3);
  pettiFight(b, ["atk0", "atk1", "atk2"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  for (const key of ["atk0", "atk1", "atk2"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was in the attacking party`);
  assert.equal(influence(b.engine, P1), 20);
});

clause(PETTIFOGGER, "0:rule", "only the attacking party dies: a character of theirs that did not attack is untouched", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("home")), "play");
  assert.equal(b.engine.state.cards[b.id("home")].damage, 0);
});

clause(PETTIFOGGER, "0:rule", "blocking together with another character: the Pettifogger and the whole attacking party die, the other blocker survives unharmed", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf", "ally"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ally")), "play", "the other blocker is not destroyed");
  assert.equal(b.engine.state.cards[b.id("ally")].damage, 0, "and takes no damage: the attackers are gone before damage");
});

clause(PETTIFOGGER, "0:rule", "it triggers when it blocks, so it is already destroyed before any battle damage is dealt", () => {
  const b = pettiBoard(1);
  declareAttackBy(b.engine, P2, [b.id("atk0")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pf")] });
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard", "destroyed as soon as it blocks");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(b.engine.state.cards[b.id("pf")].damage, 0);
  assert.equal(b.engine.state.cards[b.id("atk0")].damage, 0, "no damage was needed");
});

clause(PETTIFOGGER, "0:rule", "if another character blocks instead, the Pettifogger does nothing and the attackers live", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["ally"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "play");
});

clause(PETTIFOGGER, "0:rule", "if nobody blocks it does nothing", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], []);
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "play");
  assert.equal(influence(b.engine, P1), 18, "the attacker hit the faction");
});

clause(PETTIFOGGER, "0:rule", "'if this card blocks': when the Pettifogger ATTACKS and is blocked, nothing special happens", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("pf")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "the blocker is not destroyed by the Pettifogger's attack");
  assert.equal(b.engine.state.cards[b.id("blk")].damage, 1, "the Pettifogger just dealt its 1 strength");
});

clause(PETTIFOGGER, "0:rule", "it is symmetric: the opponent's Pettifogger blocking my attack destroys itself and my whole party", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "a0", def: character({ name: "A0", life: 9 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", life: 9 }), owner: P1, zone: "play" },
      { key: "pf", def: printing(PETTIFOGGER), owner: P2, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("a0"), b.id("a1")], { type: "faction", playerId: P2 }, [b.id("pf")]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
});

clause(PETTIFOGGER, "0:rule", "it works for an attack on a location as well", () => {
  const b = pettiBoard(2);
  pettiFight(b, ["atk0", "atk1"], ["pf"], { type: "card", cardId: b.id("place") });
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
  assert.equal(b.engine.state.cards[b.id("place")].damage, 0);
});

clause(PETTIFOGGER, "0:rule", "destroyed cards go to their owners' discard piles", () => {
  const b = pettiBoard(1);
  pettiFight(b, ["atk0"], ["pf"]);
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("pf")), "b.engine.state.players[P1].discard.includes(b.id(\"pf\"))");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("atk0")), "b.engine.state.players[P2].discard.includes(b.id(\"atk0\"))");
});

clause(PETTIFOGGER, "0:rule", "two Pettifoggers blocking together: both are destroyed and so is the attacking party", () => {
  const b = pettiBoard(2, { pettifoggers: 2 });
  pettiFight(b, ["atk0", "atk1"], ["pf", "pf2"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pf2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "discard");
});

clause(PETTIFOGGER, "0:rule", "a Pettifogger that does not block is unaffected by another Pettifogger blocking", () => {
  const b = pettiBoard(1, { pettifoggers: 2 });
  pettiFight(b, ["atk0"], ["pf"]);
  assert.equal(zoneOf(b.engine, b.id("pf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pf2")), "play", "the second Pettifogger did not block");
});

clause(PETTIFOGGER, "0:rule", "pays the printed cost of 3 and needs [G]", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  play(b.engine, P1, b.id("pf"));
  assert.equal(zoneOf(b.engine, b.id("pf")), "play");
  assert.equal(ready(b.engine), 0);
  assert.deepEqual(stats(b.engine, b.id("pf")), [1, 1, 3]);

  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("pf")), "one resource short");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pf", def: printing(PETTIFOGGER), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pf")), "no [G]");
});

// --- Postmortem Debenture ----------------------------------------------------
// COST: Pick a character in your discard pile. -- EFFECT: Put the character into
// your hand. Tactic, cost 0, threshold [G].

const DEBENTURE = "fc374879-4a9a-44a8-a694-15c4f51d82cc";

function debentureBoard(o: { greed?: number; rage?: number; discard?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pd", def: printing(DEBENTURE), owner: P1, zone: "hand" },
      ...(o.discard === false
        ? []
        : [
            { key: "dc1", def: character({ name: "Dc1" }), owner: P1, zone: "discard" as const },
            { key: "dc2", def: character({ name: "Dc2" }), owner: P1, zone: "discard" as const }
          ]),
      { key: "dItem", def: item({ name: "DItem" }), owner: P1, zone: "discard" },
      { key: "dTactic", def: tactic({ name: "DTactic" }), owner: P1, zone: "discard" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      { key: "foePlay", def: character({ name: "FoePlay" }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 1, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

clause(DEBENTURE, "0:ability", "puts the picked character from your discard pile into your hand, and nothing else", () => {
  const b = debentureBoard();
  play(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc1")] } });
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc1")), "handOf(b.engine, P1).includes(b.id(\"dc1\"))");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard", "the other character stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("dItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pd")), "discard", "the tactic ends in your discard pile");
});

clause(DEBENTURE, "0:ability", "either character in the discard pile can be picked", () => {
  const b = debentureBoard();
  play(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc2")] } });
  assert.equal(zoneOf(b.engine, b.id("dc2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(DEBENTURE, "0:ability", "its cost is 0: no resources are paid", () => {
  const b = debentureBoard({ greed: 1 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc1")] } });
  assert.equal(ready(b.engine), before);
});

clause(DEBENTURE, "0:ability", "the pick must be a character in YOUR discard pile: an opponent's discarded character, an item or tactic of yours there, or a character elsewhere are refused", () => {
  const b = debentureBoard();
  const attempt = (id: string) => () => playRaw(b.engine, P1, b.id("pd"), { selected: { c: [id] } });
  assert.throws(attempt(b.id("foeDiscard")), "the opponent's discard pile");
  assert.throws(attempt(b.id("dItem")), "an item in your discard pile");
  assert.throws(attempt(b.id("dTactic")), "a tactic in your discard pile");
  assert.throws(attempt(b.id("inPlay")), "a character in play");
  assert.throws(attempt(b.id("foePlay")), "an opponent's character in play");
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDeck")), "a character in the deck");
  assert.throws(attempt(factionOf(b.engine, P1)), "a faction");
  assert.equal(zoneOf(b.engine, b.id("pd")), "hand", "nothing was played");
  attempt(b.id("dc1"))();
  assert.ok(b.engine.state.responseWindow, "a character in your discard pile is accepted");
});

clause(DEBENTURE, "0:ability", "exactly one character: none and two are refused", () => {
  const b = debentureBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), { selected: { c: [] } }));
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), {}));
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc1"), b.id("dc2")] } }));
  assert.equal(zoneOf(b.engine, b.id("pd")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(DEBENTURE, "0:ability", "with no character in your discard pile it cannot be played", () => {
  const b = debentureBoard({ discard: false });
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), { selected: { c: [b.id("foeDiscard")] } }));
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dItem")] } }));
  assert.throws(() => playRaw(b.engine, P1, b.id("pd"), {}));
  assert.equal(zoneOf(b.engine, b.id("pd")), "hand");
});

clause(DEBENTURE, "0:ability", "needs [G] even though it costs nothing", () => {
  const none = debentureBoard({ greed: 0, rage: 5 });
  assert.throws(() => playRaw(none.engine, P1, none.id("pd"), { selected: { c: [none.id("dc1")] } }));
  assert.equal(zoneOf(none.engine, none.id("pd")), "hand");
  const one = debentureBoard({ greed: 1 });
  play(one.engine, P1, one.id("pd"), { selected: { c: [one.id("dc1")] } });
  assert.equal(zoneOf(one.engine, one.id("dc1")), "hand", "a single [G] is enough");
});

clause(DEBENTURE, "0:ability", "the character returns to its owner's hand, which can then deploy it", () => {
  const b = debentureBoard({ greed: 3 });
  play(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc1")] } });
  play(b.engine, P1, b.id("dc1"));
  assert.equal(zoneOf(b.engine, b.id("dc1")), "play", "the retrieved character can be deployed");
});

// --- Pyramid Scheme ----------------------------------------------------------
// COST: Flip a coin. If you win, X is 3 otherwise X is 2. -- EFFECT: Draw X cards.
// Tactic, cost 4, threshold [G][G].

const PYRAMID = "649b8392-cacc-410d-9f4f-87902111a923";
const WIN = () => 0.1;
const LOSE = () => 0.9;

function pyramidBoard(o: { random?: () => number; greed?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random ?? WIN,
    cards: [
      { key: "ps", def: printing(PYRAMID), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      ...fillers("d", o.deck ?? 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...bank("greed", o.greed ?? 4, P1)
    ]
  });
}

const coinFlips = (engine: SpoilsEngine) => engine.getLog().filter((entry) => (entry.event as { type?: string } | undefined)?.type === "coinFlipped").map((entry) => entry.event as unknown as { playerId: string; won: boolean });

clause(PYRAMID, "0:ability", "if you win the coin flip, X is 3: you draw exactly 3 cards (the top of your deck)", () => {
  const b = pyramidBoard({ random: WIN });
  const top3 = deckOf(b.engine, P1).slice(0, 3);
  play(b.engine, P1, b.id("ps"));
  assert.deepEqual(coinFlips(b.engine).map((f) => f.won), [true], "one coin was flipped, and won");
  for (const cardId of top3) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 3, "exactly 3 cards drawn");
  assert.equal(handOf(b.engine, P1).length, 1 + 3, "the hand: the filler card plus the 3 drawn");
});

clause(PYRAMID, "0:ability", "if you lose the coin flip, X is 2: you draw exactly 2 cards", () => {
  const b = pyramidBoard({ random: LOSE });
  const top2 = deckOf(b.engine, P1).slice(0, 2);
  play(b.engine, P1, b.id("ps"));
  assert.deepEqual(coinFlips(b.engine).map((f) => f.won), [false], "one coin was flipped, and lost");
  for (const cardId of top2) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 4, "exactly 2 cards drawn");
  assert.equal(handOf(b.engine, P1).length, 1 + 2);
});

clause(PYRAMID, "0:ability", "the coin is flipped by you (the player who plays it) and exactly once", () => {
  for (const random of [WIN, LOSE]) {
    const b = pyramidBoard({ random });
    play(b.engine, P1, b.id("ps"));
    const flips = coinFlips(b.engine);
    assert.equal(flips.length, 1);
    assert.equal(flips[0].playerId, P1);
  }
});

clause(PYRAMID, "0:ability", "the cards go to the player who played it; the opponent draws nothing", () => {
  const b = pyramidBoard({ random: WIN });
  play(b.engine, P1, b.id("ps"));
  assert.equal(deckOf(b.engine, P2).length, 6);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(PYRAMID, "0:ability", "it pays the printed cost of 4 whichever way the coin falls, and the tactic goes to the discard pile", () => {
  for (const random of [WIN, LOSE]) {
    const b = pyramidBoard({ random, greed: 6 });
    const before = ready(b.engine);
    play(b.engine, P1, b.id("ps"));
    assert.equal(before - ready(b.engine), 4);
    assert.equal(zoneOf(b.engine, b.id("ps")), "discard");
  }
});

clause(PYRAMID, "0:ability", "with a deck too short for X it draws what is left", () => {
  const win = pyramidBoard({ random: WIN, deck: 2 });
  play(win.engine, P1, win.id("ps"));
  assert.equal(deckOf(win.engine, P1).length, 0);
  assert.equal(handOf(win.engine, P1).length, 1 + 2);
  assert.equal(win.engine.state.result, undefined);
  const lose = pyramidBoard({ random: LOSE, deck: 1 });
  play(lose.engine, P1, lose.id("ps"));
  assert.equal(deckOf(lose.engine, P1).length, 0);
  assert.equal(handOf(lose.engine, P1).length, 1 + 1);
});

clause(PYRAMID, "0:ability", "'Flip a coin' is a COST: the coin is flipped when the tactic is played, before the opponent can respond", () => {
  const b = pyramidBoard({ random: WIN });
  playRaw(b.engine, P1, b.id("ps"));
  assert.ok(b.engine.state.responseWindow, "the opponent may now respond");
  assert.equal(coinFlips(b.engine).length, 1, "the coin was already flipped while paying the cost, so the opponent knows X when responding");
});

clause(PYRAMID, "0:ability", "is refused one resource short of its cost of 4, and without [G][G] even with enough other resources", () => {
  const short = pyramidBoard({ greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ps")));
  assert.equal(coinFlips(short.engine).length, 0, "no coin is flipped for an unaffordable play");
  assert.equal(zoneOf(short.engine, short.id("ps")), "hand");

  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    random: WIN,
    cards: [{ key: "ps", def: printing(PYRAMID), owner: P1, zone: "hand" }, ...fillers("d", 4, P1, "deck"), ...bank("greed", 1, P1), ...bank("rage", 6, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ps")), "one [G] is not [G][G]");

  const exact = pyramidBoard({ greed: 4 });
  play(exact.engine, P1, exact.id("ps"));
  assert.equal(zoneOf(exact.engine, exact.id("ps")), "discard");
});

// --- Rate Hike ---------------------------------------------------------------
// Your faction gains 2 influence. Then, draw a card. Tactic, cost 3, threshold [G].

const RATE_HIKE = "69d7cd35-3c28-4d48-ae5e-529de29aab92";

function rateHikeBoard(o: { greed?: number; rage?: number; deck?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "rh", def: printing(RATE_HIKE), owner: o.active ?? P1, zone: "hand" },
      ...fillers("d", o.deck ?? 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 3, o.active ?? P1),
      ...bank("rage", o.rage ?? 0, o.active ?? P1)
    ]
  });
}

clause(RATE_HIKE, "0:rule", "your faction gains exactly 2 influence and you draw exactly one card (the top of your deck)", () => {
  const b = rateHikeBoard();
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("rh"));
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 3, "exactly one card drawn");
  assert.equal(zoneOf(b.engine, b.id("rh")), "discard");
});

clause(RATE_HIKE, "0:rule", "the opponent's faction and deck are untouched", () => {
  const b = rateHikeBoard();
  play(b.engine, P1, b.id("rh"));
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(RATE_HIKE, "0:rule", "the influence is gained first, then the card is drawn ('Then, draw a card')", () => {
  const b = rateHikeBoard();
  play(b.engine, P1, b.id("rh"));
  const types = b.engine.getLog().map((entry) => (entry.event as { type?: string } | undefined)?.type);
  const gain = types.indexOf("influenceChanged");
  const draw = types.indexOf("cardsDrawn");
  assert.ok(gain >= 0 && draw >= 0, "both events happened");
  assert.ok(gain < draw, "influence first, then the draw");
});

clause(RATE_HIKE, "0:rule", "with an empty deck the influence is still gained", () => {
  const b = rateHikeBoard({ deck: 0 });
  play(b.engine, P1, b.id("rh"));
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(b.engine.state.result, undefined);
});

clause(RATE_HIKE, "0:rule", "it works for the opponent too: played by P2 it gains P2's faction 2 and draws for P2", () => {
  const b = rateHikeBoard({ active: P2 });
  const top = deckOf(b.engine, P2)[0];
  play(b.engine, P2, b.id("rh"));
  assert.equal(influence(b.engine, P2), 22);
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 4);
});

clause(RATE_HIKE, "0:rule", "pays the printed cost of 3 and needs [G]", () => {
  const b = rateHikeBoard({ greed: 4 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rh"));
  assert.equal(before - ready(b.engine), 3);

  const short = rateHikeBoard({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rh")), "one resource short");
  assert.equal(influence(short.engine, P1), 20);
  const noThreshold = rateHikeBoard({ greed: 0, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rh")), "no [G]");
  const exact = rateHikeBoard({ greed: 1, rage: 2 });
  play(exact.engine, P1, exact.id("rh"));
  assert.equal(influence(exact.engine, P1), 22, "one [G] plus two other resources is enough");
});

// --- Red Tape ----------------------------------------------------------------
// COST: Pick a character. -- EFFECT: This turn, the character loses 3 strength.
// Then, draw a card. Tactic, cost 2, threshold [G][G].

const RED_TAPE = "a8907a4c-da9b-43c0-acab-f190beaa3c07";

function redTapeBoard(o: { greed?: number; rage?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rt", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      { key: "rt2", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 5, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 4 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", strength: 6 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", strength: 6 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", strength: 6 }), owner: P2, zone: "discard" },
      ...fillers("d", o.deck ?? 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

const tapePlay = (b: ReturnType<typeof redTapeBoard>, key: string, card = "rt") => play(b.engine, P1, b.id(card), { selected: { c: [b.id(key)] } });

clause(RED_TAPE, "0:ability", "the picked opponent character loses exactly 3 strength this turn (6 becomes 3), and only its strength", () => {
  const b = redTapeBoard();
  tapePlay(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 4, "life is unchanged");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "speed is unchanged");
});

clause(RED_TAPE, "0:ability", "you can pick your own character too (5 becomes 2)", () => {
  const b = redTapeBoard();
  tapePlay(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});

clause(RED_TAPE, "0:ability", "only the picked character is weakened", () => {
  const b = redTapeBoard();
  tapePlay(b, "foe");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("weak"), "strength"), 1);
});

clause(RED_TAPE, "0:ability", "then you draw exactly one card (the top of your deck); the opponent draws nothing", () => {
  const b = redTapeBoard();
  const top = deckOf(b.engine, P1)[0];
  tapePlay(b, "foe");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 3, "exactly one card drawn");
  assert.equal(deckOf(b.engine, P2).length, 4);
  assert.equal(zoneOf(b.engine, b.id("rt")), "discard");
});

clause(RED_TAPE, "0:ability", "the strength loss happens first, then the draw ('Then, draw a card')", () => {
  const b = redTapeBoard();
  tapePlay(b, "foe");
  const types = b.engine.getLog().map((entry) => (entry.event as { type?: string } | undefined)?.type);
  const loss = types.indexOf("statModified");
  const draw = types.indexOf("cardsDrawn");
  assert.ok(loss >= 0 && draw >= 0, "both events happened");
  assert.ok(loss < draw, "strength loss first, then the draw");
});

clause(RED_TAPE, "0:ability", "a character with less than 3 strength is left with no strength at all", () => {
  const b = redTapeBoard();
  tapePlay(b, "weak");
  assert.equal(Math.max(0, b.engine.getStat(b.id("weak"), "strength")), 0, "1 - 3 stays at 0 (CR 410.4)");
});

clause(RED_TAPE, "0:ability", "the weakened character really deals less battle damage: 6 strength attacks for 3, a 1-strength one for 0", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    cards: [
      { key: "rt", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      { key: "big", def: character({ name: "Big", strength: 6 }), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("rt"), { selected: { c: [b.id("big")] } });
  fight(b.engine, P1, [b.id("big")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 17, "3 damage to the faction instead of 6");
});

clause(RED_TAPE, "0:ability", "'this turn': the strength comes back when the turn ends", () => {
  const b = redTapeBoard();
  tapePlay(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5, "back to its printed strength on the opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5);
});

clause(RED_TAPE, "0:ability", "two Red Tapes on the same character stack: 6 - 3 - 3 = 0", () => {
  const b = redTapeBoard();
  tapePlay(b, "foe", "rt");
  tapePlay(b, "foe", "rt2");
  assert.equal(Math.max(0, b.engine.getStat(b.id("foe"), "strength")), 0);
  assert.ok(b.engine.getStat(b.id("foe"), "strength") <= 0, "b.engine.getStat(b.id(\"foe\"), \"strength\") <= 0");
});

clause(RED_TAPE, "0:ability", "the pick must be a character in play: not a faction, item, location, face-down card, or a card in hand or discard", () => {
  const b = redTapeBoard();
  const attempt = (id: string) => () => playRaw(b.engine, P1, b.id("rt"), { selected: { c: [id] } });
  assert.throws(attempt(factionOf(b.engine, P1)), "your faction (CR 202.9)");
  assert.throws(attempt(factionOf(b.engine, P2)), "their faction");
  assert.throws(attempt(b.id("thing")), "an item");
  assert.throws(attempt(b.id("place")), "a location");
  assert.throws(attempt(b.id("hidden")), "a face-down card");
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("rt")), "hand", "nothing was played");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(RED_TAPE, "0:ability", "exactly one character: none and two are refused", () => {
  const b = redTapeBoard();
  assert.throws(() => playRaw(b.engine, P1, b.id("rt"), { selected: { c: [] } }));
  assert.throws(() => playRaw(b.engine, P1, b.id("rt"), {}));
  assert.throws(() => playRaw(b.engine, P1, b.id("rt"), { selected: { c: [b.id("foe"), b.id("mine")] } }));
  assert.equal(zoneOf(b.engine, b.id("rt")), "hand");
});

clause(RED_TAPE, "0:ability", "with an empty deck the strength is still lost and nothing is drawn", () => {
  const b = redTapeBoard({ deck: 0 });
  tapePlay(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  assert.equal(b.engine.state.result, undefined);
});

clause(RED_TAPE, "0:ability", "pays the printed cost of 2 and needs [G][G]", () => {
  const b = redTapeBoard({ greed: 3 });
  const before = ready(b.engine);
  tapePlay(b, "foe");
  assert.equal(before - ready(b.engine), 2);

  const short = redTapeBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rt"), { selected: { c: [short.id("foe")] } }), "one resource short");
  const noThreshold = redTapeBoard({ greed: 1, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rt"), { selected: { c: [noThreshold.id("foe")] } }), "one [G] is not [G][G]");
  const exact = redTapeBoard({ greed: 2 });
  tapePlay(exact, "foe");
  assert.equal(exact.engine.getStat(exact.id("foe"), "strength"), 3);
});

// --- Repo Man ----------------------------------------------------------------
// When this card enters play, you may pick a location. If you do, destroy that
// location. Character (lackey, mau), cost 5, threshold [G], 3/3/3.

const REPO = "39ff5045-7189-4d1e-ae1b-0b63a3326ba5";

function repoBoard(o: { owner?: Pid; locations?: boolean; greed?: number; zone?: "hand" | "discard" } = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "rm", def: printing(REPO), owner, zone: o.zone ?? "hand" },
      ...(o.locations === false
        ? []
        : [
            { key: "myPlace", def: location({ name: "MyPlace", structure: 3 }), owner, zone: "play" as const },
            { key: "foePlace", def: location({ name: "FoePlace", structure: 3 }), owner: foe, zone: "play" as const },
            { key: "foePlace2", def: location({ name: "FoePlace2", structure: 3 }), owner: foe, zone: "play" as const }
          ]),
      { key: "thing", def: item({ name: "Thing" }), owner: foe, zone: "play" },
      { key: "mineChar", def: character({ name: "MineChar" }), owner, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: foe, zone: "play" },
      { key: "hidden", def: location({ name: "HiddenPlace" }), owner: foe, zone: "play", faceDown: true },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "bounce", def: bouncer(), owner, zone: "hand" },
      { key: "raise", def: raiser(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...bank("greed", o.greed ?? 6, owner)
    ]
  });
}

clause(REPO, "0:rule", "when it enters play its controller is asked to pick a location (optional)", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Repo Man's controller picks");
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "the Repo Man is in play");
});

clause(REPO, "0:rule", "picking an opponent's location destroys it (to its owner's discard pile), and only it", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("foePlace")), "to its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "play", "another opposing location is untouched");
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "play", "so is yours");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
});

clause(REPO, "0:rule", "'a location' means any location: you may pick your own", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, [b.id("myPlace")]);
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
});

clause(REPO, "0:rule", "'you may': declining the pick destroys nothing", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, []);
  for (const key of ["myPlace", "foePlace", "foePlace2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "the Repo Man stays in play");
});

clause(REPO, "0:rule", "only a location can be picked: an item, a character or a faction is refused", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  assert.throws(() => pick(b.engine, P1, [b.id("thing")]), "an item");
  assert.throws(() => pick(b.engine, P1, [b.id("foeChar")]), "an opponent's character");
  assert.throws(() => pick(b.engine, P1, [b.id("mineChar")]), "my character");
  assert.throws(() => pick(b.engine, P1, [factionOf(b.engine, P2)]), "a faction");
  assert.throws(() => pick(b.engine, P1, [b.id("hidden")]), "a face-down card is only a resource");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
});

clause(REPO, "0:rule", "a location in a discard pile, hand or deck cannot be picked (only locations in play)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rm", def: printing(REPO), owner: P1, zone: "hand" },
      { key: "play1", def: location({ name: "Play1" }), owner: P2, zone: "play" },
      { key: "disc", def: location({ name: "Disc" }), owner: P2, zone: "discard" },
      { key: "hand1", def: location({ name: "Hand1" }), owner: P2, zone: "hand" },
      ...bank("greed", 5, P1)
    ]
  });
  play(b.engine, P1, b.id("rm"));
  assert.throws(() => pick(b.engine, P1, [b.id("disc")]));
  assert.throws(() => pick(b.engine, P1, [b.id("hand1")]));
  pick(b.engine, P1, [b.id("play1")]);
  assert.equal(zoneOf(b.engine, b.id("play1")), "discard");
});

clause(REPO, "0:rule", "only ONE location: picking two is refused", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  assert.throws(() => pick(b.engine, P1, [b.id("foePlace"), b.id("foePlace2")]));
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "play");
});

clause(REPO, "0:rule", "only the controller answers", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("rm"));
  assert.throws(() => pick(b.engine, P2, [b.id("foePlace")]));
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
});

clause(REPO, "0:rule", "with no location in play there is nothing to pick: no prompt, nothing happens", () => {
  const b = repoBoard({ locations: false });
  play(b.engine, P1, b.id("rm"));
  assert.equal(zoneOf(b.engine, b.id("rm")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(zoneOf(b.engine, b.id("foeChar")), "play");
});

clause(REPO, "0:rule", "a damaged location is destroyed just the same", () => {
  const b = repoBoard();
  b.engine.state.cards[b.id("foePlace")].damage = 2;
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.equal(b.engine.state.cards[b.id("foePlace")].damage, 0, "damage clears when it leaves play");
});

clause(REPO, "0:rule", "the location is destroyed when the Repo Man ENTERS play, not while it is still being deployed", () => {
  const b = repoBoard();
  playRaw(b.engine, P1, b.id("rm"));
  assert.equal(zoneOf(b.engine, b.id("rm")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked before it enters play");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "asked once it has entered play");
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "play");
});

clause(REPO, "0:rule", "put into play by an effect it still asks for a location and destroys it", () => {
  const b = repoBoard({ zone: "discard" });
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("rm")] } });
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "control: it was put into play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, P1, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
});

clause(REPO, "0:rule", "another character entering play, or the Repo Man leaving play, asks nothing", () => {
  const b = repoBoard();
  play(b.engine, P1, b.id("freebie"));
  assert.equal(b.engine.state.pendingChoice, undefined, "another character entering play (Repo Man in hand)");
  const inPlay = repoBoard({ zone: "hand" });
  inPlay.engine.state.cards[inPlay.id("rm")].zone = "hand";
  const placed = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rm", def: printing(REPO), owner: P1, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
    ]
  });
  play(placed.engine, P1, placed.id("freebie"));
  assert.equal(placed.engine.state.pendingChoice, undefined, "another character entering play (Repo Man in play)");
  play(placed.engine, P1, placed.id("kill"), { selected: { t: [placed.id("rm")] } });
  assert.equal(zoneOf(placed.engine, placed.id("rm")), "discard");
  assert.equal(placed.engine.state.pendingChoice, undefined, "leaving play asks nothing");
  assert.equal(zoneOf(placed.engine, placed.id("place")), "play");
});

clause(REPO, "0:rule", "it triggers each time it enters play: returned to hand and deployed again it destroys another location", () => {
  const b = repoBoard({ greed: 12 });
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, [b.id("foePlace")]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("rm")] } });
  assert.equal(zoneOf(b.engine, b.id("rm")), "hand");
  play(b.engine, P1, b.id("rm"));
  pick(b.engine, P1, [b.id("foePlace2")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foePlace2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("myPlace")), "play");
});

clause(REPO, "0:rule", "an opponent's Repo Man is picked by the opponent: they choose, they can destroy a location of mine", () => {
  const b = repoBoard({ owner: P2 });
  play(b.engine, P2, b.id("rm"));
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P2);
  assert.throws(() => pick(b.engine, P1, [b.id("myPlace")]), "I cannot answer for them");
  pick(b.engine, P2, [b.id("foePlace")]);
  assert.equal(zoneOf(b.engine, b.id("foePlace")), "discard", "'foePlace' is owned by P1 from the opponent's point of view");
});

clause(REPO, "0:rule", "enters play with its printed stats 3/3/3 and pays 5 with [G]", () => {
  const b = repoBoard({ locations: false, greed: 5 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rm"));
  assert.equal(before - ready(b.engine), 5);
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 3, 3]);

  const short = repoBoard({ greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rm")), "one resource short");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "rm", def: printing(REPO), owner: P1, zone: "hand" }, ...bank("rage", 7, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rm")), "no [G]");
});

// --- Resurrection Technician -------------------------------------------------
// When this card enters play, you may pick a character in your discard pile. If
// you do, put that character into your hand. Character (lackey), cost 5,
// threshold [G][G], 2/2/3.

const TECHNICIAN = "f8c93f53-39d6-4488-936f-5a4b4a7f028b";

function technicianBoard(o: { owner?: Pid; discard?: boolean; greed?: number; zone?: "hand" | "discard" } = {}) {
  const owner = o.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "rt", def: printing(TECHNICIAN), owner, zone: o.zone ?? "hand" },
      ...(o.discard === false
        ? []
        : [
            { key: "dc1", def: character({ name: "Dc1" }), owner, zone: "discard" as const },
            { key: "dc2", def: character({ name: "Dc2" }), owner, zone: "discard" as const }
          ]),
      { key: "dItem", def: item({ name: "DItem" }), owner, zone: "discard" },
      { key: "dTactic", def: tactic({ name: "DTactic" }), owner, zone: "discard" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: foe, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner, zone: "deck" },
      { key: "foePlay", def: character({ name: "FoePlay" }), owner: foe, zone: "play" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner, zone: "hand" },
      { key: "bounce", def: bouncer(), owner, zone: "hand" },
      { key: "raise", def: raiser(), owner, zone: "hand" },
      { key: "kill", def: killTactic(), owner, zone: "hand" },
      ...bank("greed", o.greed ?? 6, owner)
    ]
  });
}

clause(TECHNICIAN, "0:rule", "when it enters play its controller is asked to pick a character in their discard pile (optional)", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(b.engine, b.id("rt")), "play");
});

clause(TECHNICIAN, "0:rule", "picking a character puts it into your hand, and nothing else moves", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  pick(b.engine, P1, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc1")), "handOf(b.engine, P1).includes(b.id(\"dc1\"))");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard", "the other character stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("dItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeDiscard")), "discard");
  assert.equal(zoneOf(b.engine, b.id("rt")), "play", "the Technician stays in play");
});

clause(TECHNICIAN, "0:rule", "either character in the discard pile can be picked", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  pick(b.engine, P1, [b.id("dc2")]);
  assert.equal(zoneOf(b.engine, b.id("dc2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "'you may': declining leaves the discard pile as it was", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  pick(b.engine, P1, []);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TECHNICIAN, "0:rule", "the pick must be a character in YOUR discard pile: an opponent's, an item or tactic there, or a character elsewhere are refused", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  const attempt = (id: string) => () => pick(b.engine, P1, [id]);
  assert.throws(attempt(b.id("foeDiscard")), "the opponent's discard pile");
  assert.throws(attempt(b.id("dItem")), "an item in your discard pile");
  assert.throws(attempt(b.id("dTactic")), "a tactic in your discard pile");
  assert.throws(attempt(b.id("inPlay")), "a character in play");
  assert.throws(attempt(b.id("foePlay")), "an opponent's character in play");
  assert.throws(attempt(b.id("inHand")), "a character in hand");
  assert.throws(attempt(b.id("inDeck")), "a character in your deck");
  assert.throws(attempt(b.id("rt")), "the Technician itself, which is in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  attempt(b.id("dc1"))();
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
});

clause(TECHNICIAN, "0:rule", "only ONE character: picking two is refused", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  assert.throws(() => pick(b.engine, P1, [b.id("dc1"), b.id("dc2")]));
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
});

clause(TECHNICIAN, "0:rule", "only the controller answers", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("rt"));
  assert.throws(() => pick(b.engine, P2, [b.id("dc1")]));
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "with no character in your discard pile there is nothing to pick: no prompt, nothing moves", () => {
  const b = technicianBoard({ discard: false });
  play(b.engine, P1, b.id("rt"));
  assert.equal(zoneOf(b.engine, b.id("rt")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foeDiscard")), "discard");
});

clause(TECHNICIAN, "0:rule", "the character is returned when the Technician ENTERS play, not while it is still being deployed", () => {
  const b = technicianBoard();
  playRaw(b.engine, P1, b.id("rt"));
  assert.equal(zoneOf(b.engine, b.id("rt")), "deploying");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked before it enters play");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "put into play by an effect it still returns a character", () => {
  const b = technicianBoard({ zone: "discard" });
  play(b.engine, P1, b.id("raise"), { selected: { t: [b.id("rt")] } });
  assert.equal(zoneOf(b.engine, b.id("rt")), "play", "control: it was put into play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, P1, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
});

clause(TECHNICIAN, "0:rule", "another character entering play, or the Technician leaving play, asks nothing", () => {
  const b = technicianBoard();
  play(b.engine, P1, b.id("freebie"));
  assert.equal(b.engine.state.pendingChoice, undefined, "another character entering play (Technician in hand)");

  const placed = technicianBoard({ zone: "hand" });
  const inPlay = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rt", def: printing(TECHNICIAN), owner: P1, zone: "play" },
      { key: "dc1", def: character({ name: "Dc1" }), owner: P1, zone: "discard" },
      { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  void placed;
  play(inPlay.engine, P1, inPlay.id("freebie"));
  assert.equal(inPlay.engine.state.pendingChoice, undefined, "another character entering play (Technician in play)");
  play(inPlay.engine, P1, inPlay.id("kill"), { selected: { t: [inPlay.id("rt")] } });
  assert.equal(zoneOf(inPlay.engine, inPlay.id("rt")), "discard");
  assert.equal(inPlay.engine.state.pendingChoice, undefined, "leaving play asks nothing");
  assert.equal(zoneOf(inPlay.engine, inPlay.id("dc1")), "discard");
});

clause(TECHNICIAN, "0:rule", "it triggers each time it enters play: returned to hand and deployed again it returns another character", () => {
  const b = technicianBoard({ greed: 12 });
  play(b.engine, P1, b.id("rt"));
  pick(b.engine, P1, [b.id("dc1")]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("rt")] } });
  play(b.engine, P1, b.id("rt"));
  pick(b.engine, P1, [b.id("dc2")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "hand");
});

clause(TECHNICIAN, "0:rule", "an opponent's Technician returns a character from THEIR discard pile to THEIR hand, picked by them", () => {
  const b = technicianBoard({ owner: P2 });
  play(b.engine, P2, b.id("rt"));
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P2);
  assert.throws(() => pick(b.engine, P1, [b.id("foeDiscard")]), "I cannot answer for them");
  assert.throws(() => pick(b.engine, P2, [b.id("foeDiscard")]), "the character in MY discard pile is not in their discard pile");
});

clause(TECHNICIAN, "0:rule", "the Technician's controller takes a card from their own pile: P2 picks Dc1 and it lands in P2's hand", () => {
  const b = technicianBoard({ owner: P2 });
  play(b.engine, P2, b.id("rt"));
  pick(b.engine, P2, [b.id("dc1")]);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("dc1")), "handOf(b.engine, P2).includes(b.id(\"dc1\"))");
  assert.equal(handOf(b.engine, P1).includes(b.id("dc1")), false);
});

clause(TECHNICIAN, "0:rule", "enters play with its printed stats 2/2/3 and pays 5 with [G][G]", () => {
  const b = technicianBoard({ discard: false, greed: 5 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rt"));
  assert.equal(before - ready(b.engine), 5);
  assert.deepEqual(stats(b.engine, b.id("rt")), [2, 3, 2], "strength 2, life 3, speed 2");

  const short = technicianBoard({ greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rt")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rt", def: printing(TECHNICIAN), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 7, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rt")), "one [G] is not [G][G]");
});

// --- Face-down: a face-down card is only a resource, so its "enters play" text is dormant (CR 411.1 / 411.4) ---

/** Played face-down as a resource (the Develop Rule), the card has no rules text: its enters-play effect does not happen. */
function etbFaceDown(printingId: string): void {
  const b = etbBoard(printingId);
  const deckBefore = deckOf(b.engine, P1).length;
  developPlay(b.engine, P1, b.id("subject"), true);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("subject")), "play", "control: it is in play");
  assert.equal(b.engine.state.cards[b.id("subject")].faceDown, true, "face-down");
  assert.equal(b.engine.getThresholds(P1).volition, 1, "as a resource it provides Volition");
  assert.equal(influence(b.engine, P1), 20, "its enters-play effect did not happen");
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(deckOf(b.engine, P1).length, deckBefore, "nothing was drawn");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked");
}

clause(GOON, "1:rule", "played face-down as a resource it is not a character and loses no influence", () => etbFaceDown(GOON));
clause(MAFIA, "0:rule", "played face-down as a resource it is not a character and loses no influence", () => etbFaceDown(MAFIA));
clause(CONSULTANT, "0:rule", "played face-down as a resource it is not a character: no draw and no influence lost", () => etbFaceDown(CONSULTANT));
clause(TOUGH, "0:rule", "played face-down as a resource it is not a character and loses no influence", () => etbFaceDown(TOUGH));
clause(BUTLER, "0:rule", "played face-down as a resource it is not a character and gains no influence", () => etbFaceDown(BUTLER));

clause(REPO, "0:rule", "played face-down as a resource it asks for nothing and destroys no location", () => {
  const b = repoBoard();
  developPlay(b.engine, P1, b.id("rm"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("rm")].faceDown, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["myPlace", "foePlace", "foePlace2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
});

clause(TECHNICIAN, "0:rule", "played face-down as a resource it asks for nothing and returns no character", () => {
  const b = technicianBoard();
  developPlay(b.engine, P1, b.id("rt"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("rt")].faceDown, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

// --- Costs are paid when the card is played; effects happen when it resolves (after the opponent may respond) ---

clause(CASH_OUT, "0:ability", "the cost is paid when it is played; the cards are drawn only when it resolves", () => {
  const b = cashOutBoard();
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.ok(b.engine.state.responseWindow, "the opponent may respond");
  assert.equal(before - ready(b.engine), 4, "twice X is already paid");
  assert.equal(zoneOf(b.engine, b.id("co")), "deploying");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "nothing has been drawn yet");
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 3, "X+1 = 3 cards drawn on resolution");
});

clause(DOWNSIZING, "0:rule", "the cost is paid when it is played; the characters are destroyed only when it resolves", () => {
  const b = downsizingBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("ds"));
  assert.equal(before - ready(b.engine), 10);
  for (const key of ["m0", "m1", "t0", "t1", "t2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} is still alive while the tactic waits for responses`);
  assert.equal(influence(b.engine, P2), 20);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
  assert.equal(influence(b.engine, P2), 25);
});

clause(POACHING, "0:rule", "nothing is destroyed (and no tie pick is asked) until the tactic resolves", () => {
  const b = poachingBoard([6, 6]);
  playRaw(b.engine, P1, b.id("ep"));
  assert.equal(b.engine.state.pendingChoice, undefined, "the pick comes with the resolution, not with playing the card");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "now the tie is resolved by a pick");
});

clause(BRIBE, "0:ability", "the cost (resources and the picked character) is committed when it is played; the destruction and the gain happen only when it resolves", () => {
  const b = bribeBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("br"), { selected: { c: [b.id("foe")] } });
  assert.equal(before - ready(b.engine), 3);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "still alive while the opponent can respond");
  assert.equal(influence(b.engine, P2), 20, "nothing gained yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(influence(b.engine, P2), 24);
});

clause(RED_TAPE, "0:ability", "the strength loss and the draw happen only when it resolves", () => {
  const b = redTapeBoard();
  const deck = deckOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("rt"), { selected: { c: [b.id("foe")] } });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 6, "not weakened yet");
  assert.equal(deckOf(b.engine, P1).length, deck, "nothing drawn yet");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  assert.equal(deckOf(b.engine, P1).length, deck - 1);
});

clause(RED_TAPE, "0:ability", "the opponent can respond to it: a character destroyed in response is simply gone, but the draw still happens", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rt", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 4 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 2, P1)
    ]
  });
  playRaw(b.engine, P1, b.id("rt"), { selected: { c: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("foe")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: destroyed in response");
  assert.equal(deckOf(b.engine, P1).length, 2, "the draw still happens (CR 402.5a: the effect does not fizzle)");
});

clause(RATE_HIKE, "0:rule", "the cost is paid when it is played; the influence and the draw come when it resolves", () => {
  const b = rateHikeBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("rh"));
  assert.equal(before - ready(b.engine), 3);
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(deckOf(b.engine, P1).length, 4);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(deckOf(b.engine, P1).length, 3);
});

clause(DEBENTURE, "0:ability", "the character stays in the discard pile until the tactic resolves", () => {
  const b = debentureBoard();
  playRaw(b.engine, P1, b.id("pd"), { selected: { c: [b.id("dc1")] } });
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard", "still in the discard pile while the opponent may respond");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "hand");
});

clause(INDEX, "0:ability:capitalize", "the cost (1 resource, depleting the Index) is paid when it is used; the card is drawn when it resolves", () => {
  const b = indexBoard();
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("idx"), abilityId: "capitalize", selected: {}, variables: {} });
  assert.ok(b.engine.state.responseWindow, "the opponent may respond");
  assert.equal(before - ready(b.engine), 1, "already paid");
  assert.equal(isDepleted(b.engine, b.id("idx")), true, "already depleted");
  assert.equal(handOf(b.engine, P1).length, handBefore, "nothing drawn yet");
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handBefore + 1);
});

clause(ASSASSIN, "2:ability:restore", "the 2 resources are paid when it is used; the Assassin is restored when it resolves", () => {
  const b = assassinBoard({ depleted: true });
  const before = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("ea"), abilityId: "restore", selected: {}, variables: {} });
  assert.equal(before - ready(b.engine), 2, "already paid");
  assert.equal(isDepleted(b.engine, b.id("ea")), true, "still depleted until it resolves");
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("ea")), false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the Bureaucrat is depleted and the characters are picked as the cost; the picked characters are depleted when it resolves", () => {
  const b = bureaucratBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("nb"), abilityId: "subjugate", selected: { cs: [b.id("c1"), b.id("f1")] }, variables: {} });
  assert.equal(isDepleted(b.engine, b.id("nb")), true, "COST: deplete this card");
  assert.equal(isDepleted(b.engine, b.id("c1")), false, "not yet: that is the EFFECT");
  assert.equal(isDepleted(b.engine, b.id("f1")), false);
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("c1")), true);
  assert.equal(isDepleted(b.engine, b.id("f1")), true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "a character that leaves play before it resolves is simply not depleted; the rest are", () => {
  const kill = tactic({
    name: "Zap",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const zap = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "nb", def: printing(BUREAUCRAT), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1" }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2" }), owner: P2, zone: "play" },
      { key: "zap", def: kill, owner: P2, zone: "hand" }
    ]
  });
  zap.engine.perform({ type: "activateAbility", playerId: P1, cardId: zap.id("nb"), abilityId: "subjugate", selected: { cs: [zap.id("f1"), zap.id("f2")] }, variables: {} });
  playRaw(zap.engine, P2, zap.id("zap"), { selected: { t: [zap.id("f1")] } });
  resolvePendingResponses(zap.engine);
  assert.equal(zoneOf(zap.engine, zap.id("f1")), "discard", "control: destroyed in response");
  assert.equal(isDepleted(zap.engine, zap.id("f2")), true, "the other picked character is still depleted");
});

// --- The same cards played by the OTHER player: "your opponent", "you" and "your faction" follow the player who plays them ---

clause(DOWNSIZING, "0:rule", "played by P2, P2's opponent (P1) gains X and P2 gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: P2,
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P2, zone: "hand" },
      ...fillers("m", 2, P1, "play"),
      ...fillers("t", 1, P2, "play"),
      ...bank("greed", 10, P2)
    ]
  });
  play(b.engine, P2, b.id("ds"));
  for (const key of ["m0", "m1", "t0"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
  assert.equal(influence(b.engine, P1), 23, "P2's opponent gains the 3 destroyed characters");
  assert.equal(influence(b.engine, P2), 20);
});

clause(BRIBE, "0:ability", "played by P2 on P1's character, P2's opponent (P1) gains X, and P2 gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: P2,
    cards: [
      { key: "br", def: printing(BRIBE), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3 }), owner: P1, zone: "play" },
      ...bank("greed", 3, P2)
    ]
  });
  play(b.engine, P2, b.id("br"), { selected: { c: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(influence(b.engine, P1), 23, "'your opponent's faction' is P1's");
  assert.equal(influence(b.engine, P2), 20);
});

clause(POACHING, "0:rule", "played by P2, it destroys P1's highest-cost character and spares P2's own", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "ep", def: printing(POACHING), owner: P2, zone: "hand" },
      { key: "m0", def: character({ name: "M0", cost: 2 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "M1", cost: 6 }), owner: P1, zone: "play" },
      { key: "own", def: character({ name: "Own", cost: 9 }), owner: P2, zone: "play" },
      ...bank("greed", 5, P2)
    ]
  });
  play(b.engine, P2, b.id("ep"));
  if (pending(b.engine)) pick(b.engine, P2, [b.id("m1")]);
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play");
  assert.equal(zoneOf(b.engine, b.id("own")), "play");
});

clause(RED_TAPE, "0:ability", "played by P2, the draw is P2's", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "rt", def: printing(RED_TAPE), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 5 }), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("greed", 2, P2)
    ]
  });
  play(b.engine, P2, b.id("rt"), { selected: { c: [b.id("mine")] } });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(deckOf(b.engine, P2).length, 2, "P2 drew");
  assert.equal(deckOf(b.engine, P1).length, 3, "P1 did not");
});

clause(DEBENTURE, "0:ability", "played by P2, the character comes from P2's discard pile into P2's hand", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "pd", def: printing(DEBENTURE), owner: P2, zone: "hand" },
      { key: "mineDiscard", def: character({ name: "MineDiscard" }), owner: P1, zone: "discard" },
      { key: "theirDiscard", def: character({ name: "TheirDiscard" }), owner: P2, zone: "discard" },
      ...bank("greed", 1, P2)
    ]
  });
  assert.throws(() => playRaw(b.engine, P2, b.id("pd"), { selected: { c: [b.id("mineDiscard")] } }), "P1's discard pile is not P2's");
  play(b.engine, P2, b.id("pd"), { selected: { c: [b.id("theirDiscard")] } });
  assert.ok(handOf(b.engine, P2).includes(b.id("theirDiscard")), "handOf(b.engine, P2).includes(b.id(\"theirDiscard\"))");
  assert.equal(zoneOf(b.engine, b.id("mineDiscard")), "discard");
});

clause(PYRAMID, "0:ability", "played by P2, the coin is P2's flip and the cards are P2's draw", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    random: WIN,
    cards: [
      { key: "ps", def: printing(PYRAMID), owner: P2, zone: "hand" },
      ...fillers("d", 5, P1, "deck"),
      ...fillers("e", 5, P2, "deck"),
      ...bank("greed", 4, P2)
    ]
  });
  play(b.engine, P2, b.id("ps"));
  assert.deepEqual(coinFlips(b.engine).map((f) => f.playerId), [P2]);
  assert.equal(deckOf(b.engine, P2).length, 2, "3 cards drawn by P2");
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(SUMMIT, "0:rule", "a card the OPPONENT makes me draw still counts as 'you draw a card'", () => {
  const forceDraw = tactic({ name: "ForceDraw", cost: 0, behavior: { abilities: [{ id: "f", type: "activated", effects: [{ type: "draw", player: "opponent", amount: 1 }] }] } });
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    activePlayerId: P2,
    cards: [
      { key: "gs", def: printing(SUMMIT), owner: P1, zone: "play" },
      { key: "force", def: forceDraw, owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  play(b.engine, P2, b.id("force"));
  assert.equal(deckOf(b.engine, P1).length, 2, "control: I drew");
  assert.equal(influence(b.engine, P1), 21, "I gain 1 influence for the card I drew");
  assert.equal(influence(b.engine, P2), 20);
});

clause(MAFIA, "1:rule", "destroyed by a tactic while blocking (the Lawyer IS in the battle): its controller gains the opposing party's strength", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ml", def: printing(MAFIA), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlock(b.engine, [b.id("ml")], P1);
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ml")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ml")), "discard", "control: destroyed in the battle");
  assert.equal(influence(b.engine, P1), 24, "it was destroyed in a battle, against a party of total strength 4");
});

// @@END@@
