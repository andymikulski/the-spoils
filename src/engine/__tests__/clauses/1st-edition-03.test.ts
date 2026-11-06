// Clause tests — batch 1st-edition-03. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-03`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate as activateBase,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, holdResourceFace } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { endTurn, developOffers, developDrawLeft, developPlay } from "./_turn.js";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);

/** Raw `activateAbility` without draining the response window (use `activate` from the harness to drain it). */
function activateRaw(engine: SpoilsEngine, player: Pid, cardId: string, abilityId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Tokens (markers) on a card. */
const tokensOn = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]?.counters?.token ?? 0;

type Pending = { kind: string; playerId: string; [key: string]: unknown };
const pendingOf = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as Pending | undefined;

/**
 * "Up to N less" (Runic Circuitry's POWER-UP): the controller is asked how much to reduce (a chooseNumber 0..N). Answers with
 * `value` (the full N when omitted) and drains the response windows; does nothing when no such choice is open.
 */
function answerUpTo(engine: SpoilsEngine, player: Pid = P1, value?: number) {
  const pc = pendingOf(engine);
  if (pc?.kind !== "chooseNumber") return;
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooseNumber", value: value ?? (pc.max as number) } } as never);
  resolvePendingResponses(engine);
}

/** The harness `activate`, then answers an "up to N less" prompt with the full N (use `activateBase` + `answerUpTo` to drive the prompt itself). */
function activate(...args: Parameters<typeof activateBase>) {
  activateBase(...args);
  answerUpTo(args[0], args[1] as Pid);
}

/** Answers the open `chooserSelectsTarget` with `selected` and lets the game continue. */
function pick(engine: SpoilsEngine, player: Pid, selected: string[]) {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

const hand = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deck = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discard = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const zoneOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]?.zone;
const stat = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const typesOf = (engine: SpoilsEngine, cardId: string) => [...engine.getCardTypes(cardId)].sort();
const isCharacter = (engine: SpoilsEngine, cardId: string) => engine.getCardTypes(cardId).includes("character");
const sameCards = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort());

/** The cardsRevealed events in the log. */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

/** Answers a "you may ..." prompt: accept or decline, whatever shape the engine gives it. */
function answerMay(engine: SpoilsEngine, player: Pid, accept: boolean) {
  const pc = pendingOf(engine);
  assert.ok(pc, "a 'you may' prompt is open");
  assert.equal(pc.playerId, player, "the prompt goes to the right player");
  if (pc.kind === "mayPay") {
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "mayPay", pay: accept } } as never);
  } else if (pc.kind === "chooserSelectsOption") {
    const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
    const index = options.findIndex((o) => (accept ? !/decline|no\b|nothing/i.test(o.label ?? "") : /decline|no\b|nothing/i.test(o.label ?? "")));
    assert.ok(index >= 0, "the prompt has an accept and a decline option");
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
  } else {
    assert.fail(`unexpected prompt kind ${pc.kind}`);
  }
  resolvePendingResponses(engine);
}

/** A free tactic that sends one chosen card (of `type`, in play) to `to` (ability id `s`, declaration `t`). */
function sendTactic(to: "discard" | "hand" | "deck" | "void" | "destroy" | "remove", type: "character" | "item" | "resource" = "character", subtype: string[] = []): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({
    name: `Send-${to}-${type}`,
    cost: 0,
    subtype,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [effect] }]
    }
  });
}

/** A free tactic that deals `amount` damage to one chosen character (ability id `d`, declaration `t`). */
function zapTactic(amount: number): CardDefinition {
  return tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    }
  });
}

/** A deterministic random stream (mulberry32), so shuffle assertions cannot depend on a random seed. */
function seededRandom(seed = 12345): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` filler characters for `owner`'s deck (top to bottom in placement order). */
function deckFiller(owner: Pid, n: number, prefix = "fill"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${owner}${i}`, def: character({ name: `${prefix}-${owner}-${i}` }), owner, zone: "deck" as const }));
}

// ===============================================================================
// Lugubrious Node — Item (gearsmith), cost 4, threshold [E][E][E].
// This card cannot be destroyed by other "node" cards.
// RECONSTRUCT -- COST: Pay 1. Deplete this card. Pick a "node" card in your discard
// pile. -- EFFECT: Shuffle the card into your deck.
// ===============================================================================

const NODE = "eff724e3-e824-45ed-a8a3-43d8379e75b3";

/** A card carrying the "node" subtype whose activated ability (id `k`, declaration `t`) destroys an item. */
function nodeDestroyer(kind: "tactic" | "character" | "item", subtype: string[] = ["node"], name = `Node${kind}`): CardDefinition {
  const behavior = {
    abilities: [
      {
        id: "k",
        type: "activated" as const,
        targets: [{ id: "t", selector: { zone: "play" as const, type: "item" as const }, count: 1 }],
        effects: [{ type: "destroy" as const, target: { type: "selected" as const, id: "t" } }]
      }
    ]
  };
  if (kind === "tactic") return tactic({ name, cost: 0, subtype, behavior });
  if (kind === "item") return item({ name, subtype, behavior });
  return character({ name, subtype, behavior });
}

/** A node card whose tactic destroys EVERY item in play (ability id `k`). */
function nodeSweeper(subtype: string[] = ["node"]): CardDefinition {
  return tactic({
    name: "NodeSweeper",
    cost: 0,
    subtype,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "item" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
}

/** A node character whose TRIGGERED ability destroys every item in play when it enters play. */
function nodeTriggerer(): CardDefinition {
  return character({
    name: "NodeTriggerer",
    subtype: ["node"],
    behavior: {
      abilities: [
        {
          id: "trig",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "forEach", selector: { zone: "play", type: "item" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
}

function nodeBoard(opts: { elitism?: number; greed?: number; nodeZone?: "play" | "hand" | "discard"; nodeOwner?: Pid; active?: Pid } = {}) {
  const owner = opts.nodeOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: seededRandom(),
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ln", def: printing(NODE), owner, zone: opts.nodeZone ?? "play" },
      { key: "plainItem", def: item({ name: "PlainItem" }), owner, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: owner === P1 ? P2 : P1, zone: "play" },
      // destroyers
      { key: "nodeTac", def: nodeDestroyer("tactic"), owner: P1, zone: "hand" },
      { key: "nodeTac2", def: nodeDestroyer("tactic", ["node", "gear"], "NodeGearTactic"), owner: P1, zone: "hand" },
      { key: "plainTac", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "sweeper", def: nodeSweeper(), owner: P1, zone: "hand" },
      { key: "nodeChar", def: nodeDestroyer("character"), owner: P1, zone: "play" },
      { key: "nodeItem", def: nodeDestroyer("item"), owner: P1, zone: "play" },
      { key: "nodeFoeChar", def: nodeDestroyer("character", ["node"], "FoeNodeChar"), owner: P2, zone: "play" },
      { key: "trigChar", def: nodeTriggerer(), owner: P1, zone: "hand" },
      // RECONSTRUCT material
      { key: "dNodeChar", def: character({ name: "DiscardNodeChar", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "dNodeItem", def: item({ name: "DiscardNodeItem", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "dNodeTac", def: tactic({ name: "DiscardNodeTactic", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "dMulti", def: character({ name: "DiscardNodeMulti", subtype: ["node", "gear"] }), owner: P1, zone: "discard" },
      { key: "dPlain", def: character({ name: "DiscardPlain", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "dNoSub", def: item({ name: "DiscardNoSubtype" }), owner: P1, zone: "discard" },
      { key: "oNode", def: character({ name: "OppDiscardNode", subtype: ["node"] }), owner: P2, zone: "discard" },
      { key: "hNode", def: character({ name: "HandNode", subtype: ["node"] }), owner: P1, zone: "hand" },
      { key: "kNode", def: character({ name: "DeckNode", subtype: ["node"] }), owner: P1, zone: "deck" },
      { key: "pNode", def: character({ name: "PlayNode", subtype: ["node"] }), owner: P1, zone: "play" },
      ...deckFiller(P1, 7),
      ...deckFiller(P2, 6),
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

// --- 0:rule  "This card cannot be destroyed by other "node" cards."

clause(NODE, "0:rule", "a tactic with the node subtype cannot destroy it, while it destroys an ordinary item", () => {
  const { engine, id } = nodeBoard();
  play(engine, P1, id("nodeTac"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play", "the node tactic could not destroy the Node");
  assert.equal(zoneOf(engine, id("nodeTac")), "discard", "the tactic still resolved and went to the discard pile");
  const control = nodeBoard();
  play(control.engine, P1, control.id("nodeTac"), { selected: { t: [control.id("plainItem")] } });
  assert.equal(zoneOf(control.engine, control.id("plainItem")), "discard", "control: the same tactic does destroy another item");
});

clause(NODE, "0:rule", "a node character's ability cannot destroy it", () => {
  const { engine, id } = nodeBoard();
  activate(engine, P1, id("nodeChar"), "k", { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
  activate(engine, P1, id("nodeChar"), "k", { selected: { t: [id("plainItem")] } });
  assert.equal(zoneOf(engine, id("plainItem")), "discard", "control: the same ability destroys another item");
});

clause(NODE, "0:rule", "a node item's ability cannot destroy it", () => {
  const { engine, id } = nodeBoard();
  activate(engine, P1, id("nodeItem"), "k", { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
  activate(engine, P1, id("nodeItem"), "k", { selected: { t: [id("plainItem")] } });
  assert.equal(zoneOf(engine, id("plainItem")), "discard", "control: the same ability destroys another item");
});

clause(NODE, "0:rule", "a node card controlled by the OPPONENT cannot destroy it either", () => {
  const { engine, id } = nodeBoard({ active: P2 });
  activate(engine, P2, id("nodeFoeChar"), "k", { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
  activate(engine, P2, id("nodeFoeChar"), "k", { selected: { t: [id("plainItem")] } });
  assert.equal(zoneOf(engine, id("plainItem")), "discard", "control: the opponent's node does destroy my other item");
});

clause(NODE, "0:rule", "a node card whose subtypes include node (node + gear) cannot destroy it", () => {
  const { engine, id } = nodeBoard();
  play(engine, P1, id("nodeTac2"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
});

clause(NODE, "0:rule", "a node card's mass destruction destroys every other item but not the Node", () => {
  const { engine, id } = nodeBoard();
  play(engine, P1, id("sweeper"), { selected: {} });
  assert.equal(zoneOf(engine, id("ln")), "play", "the Node survives");
  for (const key of ["plainItem", "theirItem", "nodeItem"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} was destroyed`);
});

clause(NODE, "0:rule", "a node card's TRIGGERED ability cannot destroy it", () => {
  const { engine, id } = nodeBoard({ elitism: 6 });
  play(engine, P1, id("trigChar"), {});
  assert.equal(zoneOf(engine, id("trigChar")), "play", "the node character entered play");
  assert.equal(zoneOf(engine, id("plainItem")), "discard", "its trigger destroyed an ordinary item");
  assert.equal(zoneOf(engine, id("ln")), "play", "but not the Node");
});

clause(NODE, "0:rule", "a card WITHOUT the node subtype can destroy it (ordinary tactic, or a card with another subtype)", () => {
  const plain = nodeBoard();
  play(plain.engine, P1, plain.id("plainTac"), { selected: { t: [plain.id("ln")] } });
  assert.equal(zoneOf(plain.engine, plain.id("ln")), "discard", "an ordinary tactic destroys the Node");
  const gear = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "gearTac", def: nodeDestroyer("tactic", ["gear"], "GearTactic"), owner: P1, zone: "hand" }
    ]
  });
  play(gear.engine, P1, gear.id("gearTac"), { selected: { t: [gear.id("ln")] } });
  assert.equal(zoneOf(gear.engine, gear.id("ln")), "discard", "a gear (not node) card destroys the Node");
  const nodeLike = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "nodeishTac", def: nodeDestroyer("tactic", ["nodes"], "NodesTactic"), owner: P1, zone: "hand" }
    ]
  });
  play(nodeLike.engine, P1, nodeLike.id("nodeishTac"), { selected: { t: [nodeLike.id("ln")] } });
  assert.equal(zoneOf(nodeLike.engine, nodeLike.id("ln")), "discard", "a 'nodes' subtype is not the 'node' subtype");
});

clause(NODE, "0:rule", "the protection is only against node cards: an opponent's ordinary tactic destroys it too", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "foeTac", def: sendTactic("destroy", "item"), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P2, id("foeTac"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "discard");
});

clause(NODE, "0:rule", "it only prevents DESTRUCTION: a node card can still return it to its owner's hand", () => {
  const bounceNode = tactic({
    name: "NodeBounce",
    cost: 0,
    subtype: ["node"],
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "bounce", def: bounceNode, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "hand", "a node card's bounce is not destruction");
});

clause(NODE, "0:rule", "the protection is the Node's own: other items next to it are still destroyed by an ordinary card, and the Node stays protected afterwards", () => {
  const { engine, id } = nodeBoard();
  play(engine, P1, id("plainTac"), { selected: { t: [id("plainItem")] } });
  assert.equal(zoneOf(engine, id("plainItem")), "discard");
  assert.equal(zoneOf(engine, id("ln")), "play");
  play(engine, P1, id("nodeTac"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play", "still protected");
});

clause(NODE, "0:rule", "the protection does not depend on the Node being ready: a depleted Node is protected too", () => {
  const { engine, id } = nodeBoard();
  engine.state.cards[id("ln")].depleted = true;
  play(engine, P1, id("nodeTac"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
});

clause(NODE, "0:rule", "it has no protection while it is not in play: a Node in the hand is not a target at all", () => {
  const { engine, id } = nodeBoard({ nodeZone: "hand" });
  assert.throws(() => playRaw(engine, P1, id("nodeTac"), { selected: { t: [id("ln")] } }), "an item in hand cannot be picked by a 'pick an item' effect");
  assert.equal(zoneOf(engine, id("ln")), "hand");
});

clause(NODE, "0:rule", "deploys for its printed cost of 4 with [E][E][E] (one short or one [E] short is refused) and is a plain item with no stats", () => {
  const { engine, id } = nodeBoard({ nodeZone: "hand", elitism: 3, greed: 1 });
  const before = ready(engine);
  play(engine, P1, id("ln"), {});
  assert.equal(zoneOf(engine, id("ln")), "play");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.deepEqual(typesOf(engine, id("ln")), ["item"]);
  const short = nodeBoard({ nodeZone: "hand", elitism: 3, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ln")), "3 resources is one short of 4");
  assert.equal(zoneOf(short.engine, short.id("ln")), "hand");
  const twoE = nodeBoard({ nodeZone: "hand", elitism: 2, greed: 5 });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("ln")), "two [E] is one short of [E][E][E]");
  const noE = nodeBoard({ nodeZone: "hand", elitism: 0, greed: 6 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("ln")), "no [E] at all");
});

// --- 1:ability:reconstruct

clause(NODE, "1:ability:reconstruct", "pays exactly 1 and depletes the Node as the cost, before the effect resolves", () => {
  const { engine, id } = nodeBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(before - ready(engine), 1, "COST: Pay 1");
  assert.equal(engine.state.cards[id("ln")].depleted, true, "COST: Deplete this card");
  assert.equal(zoneOf(engine, id("dNodeChar")), "discard", "the card has not moved yet: the effect is still waiting for responses");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("dNodeChar")), "deck", "...and it moves once the ability resolves");
});

clause(NODE, "1:ability:reconstruct", "shuffles the picked card into my deck: deck grows by one, contains the card, and is in a new order", () => {
  const { engine, id } = nodeBoard();
  const deckBefore = [...deck(engine, P1)];
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(deck(engine, P1).length, deckBefore.length + 1, "one card added");
  sameCards(deck(engine, P1), [...deckBefore, id("dNodeChar")]);
  assert.notDeepEqual(deck(engine, P1), [...deckBefore, id("dNodeChar")], "the deck was shuffled (not simply placed on the bottom)");
  assert.notDeepEqual(deck(engine, P1), [id("dNodeChar"), ...deckBefore], "the deck was shuffled (not simply placed on top)");
  assert.deepEqual(discard(engine, P1).includes(id("dNodeChar")), false, "it left the discard pile");
  assert.equal(engine.state.cards[id("dNodeChar")].ownerId, P1);
});

clause(NODE, "1:ability:reconstruct", "the shuffle is real: different random streams give different decks", () => {
  const orders = new Set<string>();
  for (const seed of [0.1, 0.35, 0.6, 0.85]) {
    let n = 0;
    const rng = () => {
      n += 1;
      return (seed * n * 7.919) % 1;
    };
    const board = buildGame({
      playerA: { faction: developFaction() },
      random: rng,
      cards: [
        { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
        { key: "d", def: character({ name: "D", subtype: ["node"] }), owner: P1, zone: "discard" },
        ...deckFiller(P1, 8),
        ...bank("elitism", 2, P1)
      ]
    });
    activate(board.engine, P1, board.id("ln"), "reconstruct", { selected: { n: [board.id("d")] } });
    orders.add(deck(board.engine, P1).map((c) => board.engine.state.cards[c].definitionId).join(","));
  }
  assert.ok(orders.size > 1, "the placement of the card depends on the random stream");
});

clause(NODE, "1:ability:reconstruct", "any type of node card can be picked: a character, an item, a tactic, or one with several subtypes", () => {
  for (const key of ["dNodeChar", "dNodeItem", "dNodeTac", "dMulti"]) {
    const { engine, id } = nodeBoard();
    activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id(key)] } });
    assert.equal(zoneOf(engine, id(key)), "deck", `${key} was shuffled into the deck`);
    for (const other of ["dNodeChar", "dNodeItem", "dNodeTac", "dMulti"].filter((k) => k !== key)) assert.equal(zoneOf(engine, id(other)), "discard", `${other} (not picked) stays in the discard pile`);
  }
});

clause(NODE, "1:ability:reconstruct", "only a card with the node subtype can be picked: non-node cards in the discard pile are refused", () => {
  const { engine, id } = nodeBoard();
  for (const key of ["dPlain", "dNoSub"]) {
    assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id(key)] } }), `${key} is not a node card`);
  }
  assert.equal(engine.state.cards[id("ln")].depleted, false, "refused attempts left no partial cost");
  assert.equal(ready(engine), 6);
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(zoneOf(engine, id("dNodeChar")), "deck", "control: a node card is accepted");
});

clause(NODE, "1:ability:reconstruct", "only a card in MY discard pile: a node card in the opponent's discard pile, my hand, my deck or in play is refused", () => {
  const { engine, id } = nodeBoard();
  const attempt = (key: string) => () => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id(key)] } });
  assert.throws(attempt("oNode"), "opponent's discard pile");
  assert.throws(attempt("hNode"), "my hand");
  assert.throws(attempt("kNode"), "my deck");
  assert.throws(attempt("pNode"), "in play");
  assert.throws(attempt("nodeChar"), "in play (node character)");
  assert.equal(engine.state.cards[id("ln")].depleted, false);
  assert.equal(ready(engine), 6);
  attempt("dNodeItem")();
  assert.ok(engine.state.responseWindow, "control: my own discard pile is accepted");
});

clause(NODE, "1:ability:reconstruct", "exactly one card is picked: none, or two, is refused", () => {
  const { engine, id } = nodeBoard();
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [] } }), "no card picked");
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: {} }), "nothing picked");
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar"), id("dNodeItem")] } }), "two cards");
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar"), id("dNodeChar")] } }), "the same card twice");
  assert.equal(engine.state.cards[id("ln")].depleted, false);
  assert.equal(zoneOf(engine, id("dNodeChar")), "discard");
});

clause(NODE, "1:ability:reconstruct", "with no node card in my discard pile it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "discard" },
      ...deckFiller(P1, 3),
      ...bank("elitism", 3, P1)
    ]
  });
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: {} }));
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("plain")] } }));
  assert.equal(engine.state.cards[id("ln")].depleted, false);
  assert.equal(ready(engine), 3);
});

clause(NODE, "1:ability:reconstruct", "is refused with no resources, and works with exactly 1", () => {
  const none = nodeBoard({ elitism: 0 });
  assert.throws(() => activateRaw(none.engine, P1, none.id("ln"), "reconstruct", { selected: { n: [none.id("dNodeChar")] } }));
  assert.equal(none.engine.state.cards[none.id("ln")].depleted, false, "a failed payment does not deplete");
  assert.equal(zoneOf(none.engine, none.id("dNodeChar")), "discard");
  const spent = nodeBoard({ elitism: 2 });
  // spend one of the two resources first so only 1 is left ready
  activate(spent.engine, P1, spent.id("ln"), "reconstruct", { selected: { n: [spent.id("dNodeChar")] } });
  assert.equal(ready(spent.engine), 1);
  const exact = nodeBoard({ elitism: 1 });
  activate(exact.engine, P1, exact.id("ln"), "reconstruct", { selected: { n: [exact.id("dNodeChar")] } });
  assert.equal(zoneOf(exact.engine, exact.id("dNodeChar")), "deck");
  assert.equal(ready(exact.engine), 0, "all of the single resource was spent");
});

clause(NODE, "1:ability:reconstruct", "the ability has no threshold of its own: 1 resource of any kind pays for it", () => {
  const { engine, id } = nodeBoard({ elitism: 0, greed: 1 });
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(zoneOf(engine, id("dNodeChar")), "deck");
});

clause(NODE, "1:ability:reconstruct", "cannot be used while the Node is depleted; works again once it is restored next turn", () => {
  const { engine, id } = nodeBoard();
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(engine.state.cards[id("ln")].depleted, true);
  const readyAfter = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeItem")] } }), "already depleted: a second use is refused");
  assert.equal(ready(engine), readyAfter, "the refused attempt cost nothing");
  assert.equal(zoneOf(engine, id("dNodeItem")), "discard");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("ln")].depleted, false, "restored at the start of my turn");
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeItem")] } });
  assert.equal(zoneOf(engine, id("dNodeItem")), "deck", "usable again");
});

clause(NODE, "1:ability:reconstruct", "only its controller can use it", () => {
  const { engine, id } = nodeBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("ln"), "reconstruct", { selected: { n: [id("oNode")] } }), "the opponent cannot use my Node, even on a node card of their own discard pile");
  assert.throws(() => activateRaw(engine, P2, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } }));
  assert.equal(engine.state.cards[id("ln")].depleted, false);
});

clause(NODE, "1:ability:reconstruct", "cannot be used from the hand or the discard pile (the Node must be in play)", () => {
  const inHand = nodeBoard({ nodeZone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("ln"), "reconstruct", { selected: { n: [inHand.id("dNodeChar")] } }));
  const inDiscard = nodeBoard({ nodeZone: "discard" });
  assert.throws(() => activateRaw(inDiscard.engine, P1, inDiscard.id("ln"), "reconstruct", { selected: { n: [inDiscard.id("dNodeChar")] } }));
});

clause(NODE, "1:ability:reconstruct", "my deck is the one shuffled: the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = nodeBoard();
  const oppDeck = [...deck(engine, P2)];
  const oppDiscard = [...discard(engine, P2)];
  const oppHand = [...hand(engine, P2)];
  const myDiscard = discard(engine, P1).filter((c) => c !== id("dNodeChar"));
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.deepEqual(deck(engine, P2), oppDeck, "their deck keeps its exact order");
  assert.deepEqual(discard(engine, P2), oppDiscard);
  assert.deepEqual(hand(engine, P2), oppHand);
  assert.deepEqual(discard(engine, P1), myDiscard, "my discard pile only lost the picked card");
});

clause(NODE, "1:ability:reconstruct", "does not draw or put the card into my hand", () => {
  const { engine, id } = nodeBoard();
  const handBefore = [...hand(engine, P1)];
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.deepEqual(hand(engine, P1), handBefore);
});

clause(NODE, "1:ability:reconstruct", "the Node stays in play after RECONSTRUCT (it is only depleted)", () => {
  const { engine, id } = nodeBoard();
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("dNodeChar")] } });
  assert.equal(zoneOf(engine, id("ln")), "play");
});

clause(NODE, "1:ability:reconstruct", "it can be used on the opponent's turn in a response window (an ability may be used in response)", () => {
  // the opponent plays a tactic; I respond with RECONSTRUCT
  const foeTac = tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } });
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "ln", def: printing(NODE), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "D", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "opener", def: foeTac, owner: P2, zone: "hand" },
      ...deckFiller(P1, 4),
      ...bank("elitism", 3, P1)
    ]
  });
  playRaw(board.engine, P2, board.id("opener"));
  activateRaw(board.engine, P1, board.id("ln"), "reconstruct", { selected: { n: [board.id("d")] } });
  resolvePendingResponses(board.engine);
  assert.equal(zoneOf(board.engine, board.id("d")), "deck");
  assert.equal(board.engine.state.cards[board.id("ln")].depleted, true);
});

// ===============================================================================
// Makeshift Contrivance — Item (gearsmith), cost 6, threshold [E][E][E].
// DEPLOY -- COST: Pay 1. Deplete this card. -- EFFECT: Put a resource into play.
// ===============================================================================

const CONTRIVANCE = "f5d12db2-7bfa-41ae-a99d-0994027c4584";

function contrivanceBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; active?: Pid; noHand?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "mc", def: printing(CONTRIVANCE), owner: P1, zone: opts.zone ?? "play" },
      ...(opts.noHand
        ? []
        : [
            { key: "handRage", def: resourceCard({ name: "HandRage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "handGreed", def: resourceCard({ name: "HandGreed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" as const },
            { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "oppHandRes", def: resourceCard({ name: "OppHandRes" }), owner: P2, zone: "hand" },
      { key: "deckRes", def: resourceCard({ name: "DeckRes" }), owner: P1, zone: "deck" },
      { key: "discRes", def: resourceCard({ name: "DiscRes" }), owner: P1, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Uses DEPLOY and picks `cardKey` from the hand. */
function deployAndPick(board: ReturnType<typeof contrivanceBoard>, cardKey: string) {
  activate(board.engine, P1, board.id("mc"), "deploy");
  pick(board.engine, P1, [board.id(cardKey)]);
}

clause(CONTRIVANCE, "0:ability:deploy", "pays exactly 1 and depletes the Contrivance as the cost, before the effect resolves", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  const before = ready(engine);
  activateRaw(engine, P1, id("mc"), "deploy");
  assert.equal(before - ready(engine), 1, "COST: Pay 1");
  assert.equal(engine.state.cards[id("mc")].depleted, true, "COST: Deplete this card");
  assert.equal(zoneOf(engine, id("handRage")), "hand", "no resource has been put into play yet");
  resolvePendingResponses(engine);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "then I choose the resource");
  assert.equal(pendingOf(engine)?.playerId, P1);
});

clause(CONTRIVANCE, "0:ability:deploy", "puts a resource card from my hand into play face-up: it provides its own icon and is available to pay with", () => {
  const board = contrivanceBoard({ elitism: 4 });
  const { engine, id } = board;
  const thresholdBefore = engine.getThresholds(P1);
  assert.equal(thresholdBefore.rage ?? 0, 0, "no rage before");
  const before = ready(engine);
  deployAndPick(board, "handRage");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("handRage")), "play", "it is in play");
  assert.equal(engine.state.cards[id("handRage")].faceDown, false, "an actual resource goes in face-up");
  assert.equal(engine.state.cards[id("handRage")].controllerId, P1);
  assert.equal(engine.state.cards[id("handRage")].depleted, false);
  assert.equal(engine.getThresholds(P1).rage, 1, "it provides its [R] icon");
  assert.equal(ready(engine), before - 1 + 1, "one resource paid, one new unspent resource gained");
  assert.equal(engine.state.cards[id("handRage")].attachedTo, undefined, "the new resource is not attached to the faction (not spent)");
  assert.equal(zoneOf(engine, id("handGreed")), "hand", "the other resource card stays in hand");
});

clause(CONTRIVANCE, "0:ability:deploy", "a card that is not a resource goes into play face-down as a resource (Volition)", () => {
  for (const key of ["handChar", "handItem"]) {
    const board = contrivanceBoard();
    const { engine, id } = board;
    const before = ready(engine);
    deployAndPick(board, key);
    assert.equal(zoneOf(engine, id(key)), "play", `${key} is in play`);
    assert.equal(engine.state.cards[id(key)].faceDown, true, `${key} is face-down`);
    assert.equal(engine.getThresholds(P1).volition, 1, "a face-down card provides Volition");
    assert.deepEqual(typesOf(engine, id(key)), ["resource"], "a face-down card is only a resource");
    assert.equal(ready(engine), before, "paid 1, gained 1 resource");
  }
});

clause(CONTRIVANCE, "0:ability:deploy", "exactly one card is put into play: the rest of the hand is untouched", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  const handBefore = [...hand(engine, P1)];
  deployAndPick(board, "handGreed");
  assert.deepEqual(hand(engine, P1), handBefore.filter((c) => c !== id("handGreed")), "only the chosen card left my hand");
  assert.equal(deck(engine, P1).length, 1, "my deck is untouched");
  assert.equal(zoneOf(engine, id("deckRes")), "deck");
  assert.equal(zoneOf(engine, id("discRes")), "discard");
});

clause(CONTRIVANCE, "0:ability:deploy", "only one card can be picked: two cards, or the same card twice, is refused", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  activate(engine, P1, id("mc"), "deploy");
  assert.throws(() => pick(engine, P1, [id("handRage"), id("handGreed")]), "two cards");
  assert.throws(() => pick(engine, P1, [id("handRage"), id("handRage")]), "the same card twice");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(engine, P1, [id("handRage")]);
  assert.equal(zoneOf(engine, id("handRage")), "play", "control: one card is accepted");
});

clause(CONTRIVANCE, "0:ability:deploy", "the card comes from MY hand: the opponent's hand, my deck and my discard pile are refused", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  activate(engine, P1, id("mc"), "deploy");
  for (const key of ["oppHandRes", "deckRes", "discRes", "mc"]) assert.throws(() => pick(engine, P1, [id(key)]), key);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(engine, id("oppHandRes")), "hand");
  pick(engine, P1, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play", "control: my hand is accepted");
});

clause(CONTRIVANCE, "0:ability:deploy", "only I choose: the opponent cannot answer the choice", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  activate(engine, P1, id("mc"), "deploy");
  assert.throws(() => pick(engine, P2, [id("oppHandRes")]));
  assert.equal(zoneOf(engine, id("oppHandRes")), "hand", "their card did not move");
});

clause(CONTRIVANCE, "0:ability:deploy", "'put into play' is not 'play a resource': the Develop Rule is still available afterwards and no 'resource played' event happens", () => {
  const board = contrivanceBoard();
  const { engine } = board;
  assert.ok(developOffers(engine, P1).length > 0, "control: I can develop before");
  deployAndPick(board, "handRage");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule is not used up by DEPLOY");
  const played = engine.getLog().filter((entry) => entry.event?.type === "resourcePlayed");
  assert.equal(played.length, 0, "no resourcePlayed event: the resource was put into play, not played");
});

clause(CONTRIVANCE, "0:ability:deploy", "the Develop Rule is not needed and not consumed: I can still play a resource with it after DEPLOY", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  deployAndPick(board, "handRage");
  developPlay(engine, P1, id("handGreed"));
  assert.equal(zoneOf(engine, id("handRage")), "play");
  assert.equal(zoneOf(engine, id("handGreed")), "play", "and the Develop Rule still plays its own resource");
  assert.equal(engine.getLog().filter((entry) => entry.event?.type === "resourcePlayed").length, 1, "control: the Develop Rule's play IS a resourcePlayed event (the log works), DEPLOY's is not");
});

clause(CONTRIVANCE, "0:ability:deploy", "an actual resource card can also be put into play face-down (any card may be a face-down resource, CR 203.2)", () => holdResourceFace(() => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  activate(engine, P1, id("mc"), "deploy");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("handRage")] } } as never);
  resolvePendingResponses(engine);
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRage")) === "hand";
  const faceDown = zoneOf(engine, id("handRage")) === "play" && engine.state.cards[id("handRage")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to choose face-up or face-down; the engine put it in play face-up without asking");
}));

clause(CONTRIVANCE, "0:ability:deploy", "'Put a resource into play' is an instruction, not a 'may': with cards in my hand I cannot decline to put one into play", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  activate(engine, P1, id("mc"), "deploy");
  assert.throws(() => pick(engine, P1, []), "taking no card at all");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  assert.equal(hand(engine, P1).length, 4, "my hand is intact");
});

clause(CONTRIVANCE, "0:ability:deploy", "with an empty hand the cost is still paid and nothing is put into play", () => {
  const { engine, id } = contrivanceBoard({ noHand: true });
  const before = ready(engine);
  const playBefore = [...engine.state.players[P1].play];
  activate(engine, P1, id("mc"), "deploy");
  assert.equal(engine.state.pendingChoice, undefined, "nothing to choose");
  assert.equal(before - ready(engine), 1, "the 1 was paid");
  assert.equal(engine.state.cards[id("mc")].depleted, true);
  assert.deepEqual(engine.state.players[P1].play, playBefore, "nothing entered play");
});

clause(CONTRIVANCE, "0:ability:deploy", "is refused with no resources; works with exactly 1", () => {
  const none = contrivanceBoard({ elitism: 0 });
  assert.throws(() => activateRaw(none.engine, P1, none.id("mc"), "deploy"));
  assert.equal(none.engine.state.cards[none.id("mc")].depleted, false, "a failed payment does not deplete");
  const exact = contrivanceBoard({ elitism: 1 });
  deployAndPick(exact, "handRage");
  assert.equal(zoneOf(exact.engine, exact.id("handRage")), "play");
  assert.equal(ready(exact.engine), 1, "1 spent, 1 gained");
});

clause(CONTRIVANCE, "0:ability:deploy", "the ability has no threshold of its own: any resource pays the 1", () => {
  const { engine, id } = contrivanceBoard({ elitism: 0, greed: 1 });
  activate(engine, P1, id("mc"), "deploy");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
});

clause(CONTRIVANCE, "0:ability:deploy", "cannot be used while the Contrivance is depleted; usable again after it is restored next turn", () => {
  const board = contrivanceBoard();
  const { engine, id } = board;
  deployAndPick(board, "handRage");
  assert.equal(engine.state.cards[id("mc")].depleted, true);
  const readyAfter = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("mc"), "deploy"), "already depleted");
  assert.equal(ready(engine), readyAfter, "the refused attempt cost nothing");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("mc")].depleted, false, "restored");
  activate(engine, P1, id("mc"), "deploy");
  pick(engine, P1, [id("handGreed")]);
  assert.equal(zoneOf(engine, id("handGreed")), "play");
});

clause(CONTRIVANCE, "0:ability:deploy", "only its controller can use it, and only from play", () => {
  const { engine, id } = contrivanceBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("mc"), "deploy"));
  assert.equal(engine.state.cards[id("mc")].depleted, false);
  const inHand = contrivanceBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("mc"), "deploy"));
});

clause(CONTRIVANCE, "0:ability:deploy", "the newly put resource is available to pay for something else straight away", () => {
  const board = contrivanceBoard({ elitism: 1 });
  const { engine, id } = board;
  deployAndPick(board, "handChar");
  assert.equal(ready(engine), 1, "paid 1 of 1, gained one");
  assert.equal(engine.getAvailableResourceIds(P1).includes(id("handChar")), true, "the new resource is among the ready ones");
});

clause(CONTRIVANCE, "0:ability:deploy", "deploys for its printed cost of 6 with [E][E][E] (one short or one [E] short is refused) and is a plain item", () => {
  const { engine, id } = contrivanceBoard({ zone: "hand", elitism: 3, greed: 3 });
  const before = ready(engine);
  play(engine, P1, id("mc"), {});
  assert.equal(zoneOf(engine, id("mc")), "play");
  assert.equal(before - ready(engine), 6, "the printed cost of 6 is paid");
  assert.deepEqual(typesOf(engine, id("mc")), ["item"]);
  const short = contrivanceBoard({ zone: "hand", elitism: 3, greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("mc")), "5 resources is one short of 6");
  const twoE = contrivanceBoard({ zone: "hand", elitism: 2, greed: 6 });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("mc")), "two [E] is one short of [E][E][E]");
});

// ===============================================================================
// Manifold Quasi-Modal Steamwork — vanilla. Character (majig), cost 7, threshold
// [E][E], 8 strength / 3 speed / 6 life. (No rules text.)
// ===============================================================================

const MANIFOLD = "56242b62-c144-44c5-804f-c01bcc8abefa";

function manifoldBoard(opts: { elitism?: number; greed?: number; active?: Pid; zone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "mq", def: printing(MANIFOLD), owner: P1, zone: opts.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 7, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MANIFOLD, "vanilla", "deploys for exactly its printed cost of 7: seven resources are spent, none more", () => {
  const { engine, id } = manifoldBoard({ elitism: 9 });
  const before = ready(engine);
  play(engine, P1, id("mq"), {});
  assert.equal(zoneOf(engine, id("mq")), "play", "it is in play");
  assert.equal(engine.state.cards[id("mq")].controllerId, P1);
  assert.equal(before - ready(engine), 7, "the printed cost of 7 is paid");
});

clause(MANIFOLD, "vanilla", "is refused one resource short of its cost (6 of 7) and stays in hand", () => {
  const { engine, id } = manifoldBoard({ elitism: 6 });
  assert.throws(() => playRaw(engine, P1, id("mq")));
  assert.equal(zoneOf(engine, id("mq")), "hand");
  assert.equal(ready(engine), 6, "nothing was spent");
});

clause(MANIFOLD, "vanilla", "needs [E][E]: one [E] with many other resources is refused, two [E] plus five others works", () => {
  const oneE = manifoldBoard({ elitism: 1, greed: 9 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("mq")), "one [E] is one short of [E][E]");
  assert.equal(zoneOf(oneE.engine, oneE.id("mq")), "hand");
  const noE = manifoldBoard({ elitism: 0, greed: 10 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("mq")), "no [E] at all");
  const ok = manifoldBoard({ elitism: 2, greed: 5 });
  play(ok.engine, P1, ok.id("mq"), {});
  assert.equal(zoneOf(ok.engine, ok.id("mq")), "play", "[E][E] plus five other resources pays for it");
  assert.equal(ready(ok.engine), 0);
});

clause(MANIFOLD, "vanilla", "has its printed stats in play: 8 strength, 6 life, 3 speed", () => {
  const { engine, id } = manifoldBoard();
  play(engine, P1, id("mq"), {});
  assert.deepEqual(stat(engine, id("mq")), [8, 6, 3]);
  assert.equal(engine.getStat(id("mq"), "strength"), 8);
  assert.equal(engine.getStat(id("mq"), "life"), 6);
  assert.equal(engine.getStat(id("mq"), "speed"), 3);
});

clause(MANIFOLD, "vanilla", "is a Gearsmith character with the majig subtype, and has no abilities or keywords", () => {
  const { engine, id } = manifoldBoard();
  play(engine, P1, id("mq"), {});
  assert.deepEqual(typesOf(engine, id("mq")), ["character"]);
  assert.deepEqual(engine.getSubtypes(id("mq")), ["majig"]);
  assert.equal(engine.getDefinition(id("mq")).trade, "gearsmith");
  assert.deepEqual(engine.getKeywords(id("mq")), [], "no keywords");
  assert.equal(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("mq")).length, 0, "no activated abilities");
  assert.equal(engine.state.cards[id("mq")].depleted, false);
  assert.equal(engine.state.pendingChoice, undefined, "no trigger or prompt on entering play");
});

clause(MANIFOLD, "vanilla", "6 damage destroys it and 5 does not (life 6)", () => {
  const damaged = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mq", def: printing(MANIFOLD), owner: P1, zone: "play" },
      { key: "z5", def: zapTactic(5), owner: P2, zone: "hand" },
      { key: "z1", def: zapTactic(1), owner: P2, zone: "hand" }
    ]
  });
  const { engine, id } = damaged;
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  play(engine, P2, id("z5"), { selected: { t: [id("mq")] } });
  assert.equal(zoneOf(engine, id("mq")), "play", "5 damage < 6 life");
  play(engine, P2, id("z1"), { selected: { t: [id("mq")] } });
  assert.equal(zoneOf(engine, id("mq")), "discard", "6 damage >= 6 life");
});

clause(MANIFOLD, "vanilla", "in battle it deals 8 damage at speed 3 (it can attack from a settled board)", () => {
  const { engine, id } = manifoldBoard({ zone: "play" });
  fight(engine, P1, [id("mq")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.players[P2].influence, 30 - 8, "8 strength of battle damage to the unblocked faction");
});

clause(MANIFOLD, "vanilla", "just deployed, it cannot attack that turn but can block", () => {
  const { engine, id } = manifoldBoard();
  play(engine, P1, id("mq"), {});
  assert.throws(() => declareAttackBy(engine, P1, [id("mq")]), "a character that entered play this turn cannot attack");
  endTurn(engine, P1);
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mq")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mq")]);
});

// ===============================================================================
// Meager Research — Tactic (gearsmith), cost 1, threshold [E].
// Reveal the top card of your opponent's deck and put it into their hand. You may
// search your deck for a card of the same type as that card, reveal it, and put it
// into your hand.
// ===============================================================================

const MEAGER = "300b1274-898a-4769-8422-ab07c00ca51e";

type Kind = "character" | "item" | "tactic" | "location" | "resource";
const KINDS: Kind[] = ["character", "item", "tactic", "location", "resource"];

function cardOfKind(kind: Kind, name: string): CardDefinition {
  switch (kind) {
    case "character":
      return character({ name });
    case "item":
      return item({ name });
    case "tactic":
      return tactic({ name });
    case "location":
      return location({ name });
    default:
      return resourceCard({ name });
  }
}

/** Meager Research in P1's hand; P2's deck top is a card of `oppTop` (or an empty deck when null). Each type has two cards in P1's deck. */
function meagerBoard(opts: { oppTop: Kind | null; elitism?: number; greed?: number; myKinds?: Kind[] } = { oppTop: "character" }) {
  const myKinds = opts.myKinds ?? KINDS;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: seededRandom(),
    cards: [
      { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
      ...(opts.oppTop ? [{ key: "top", def: cardOfKind(opts.oppTop, "OppTop"), owner: P2, zone: "deck" as const }] : []),
      ...(opts.oppTop
        ? [
            { key: "o2", def: cardOfKind("character", "Opp2"), owner: P2, zone: "deck" as const },
            { key: "o3", def: cardOfKind("item", "Opp3"), owner: P2, zone: "deck" as const },
            { key: "o4", def: cardOfKind("character", "Opp4"), owner: P2, zone: "deck" as const }
          ]
        : []),
      ...myKinds.flatMap((kind) => [
        { key: `m-${kind}-1`, def: cardOfKind(kind, `Mine-${kind}-1`), owner: P1, zone: "deck" as const },
        { key: `m-${kind}-2`, def: cardOfKind(kind, `Mine-${kind}-2`), owner: P1, zone: "deck" as const }
      ]),
      { key: "hChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "oppHandChar", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      { key: "oppDiscChar", def: character({ name: "OppDiscChar" }), owner: P2, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MEAGER, "0:rule", "pays exactly 1; the opponent's top card is revealed to everyone and put into THEIR hand", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  const before = ready(engine);
  const oppHandBefore = [...hand(engine, P2)];
  const oppDeckBefore = [...deck(engine, P2)];
  const myHandBefore = [...hand(engine, P1)];
  play(engine, P1, id("mr"), {});
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  const reveals = revealEvents(engine);
  assert.ok(reveals.length >= 1, "a card is revealed");
  const first = reveals[0].event as unknown as { cardIds: string[]; viewerId: string; zone: string; ownerId: string };
  assert.deepEqual(first.cardIds, [id("top")], "exactly the top card of the opponent's deck is revealed");
  assert.equal(first.viewerId, "all", "revealed to everyone");
  assert.equal(first.zone, "deck");
  assert.equal(first.ownerId, P2);
  assert.equal(zoneOf(engine, id("top")), "hand", "it was put into a hand");
  assert.deepEqual(hand(engine, P2), [...oppHandBefore, id("top")], "THEIR hand got it (not mine)");
  assert.deepEqual(deck(engine, P2), oppDeckBefore.slice(1), "their deck lost exactly the top card; the rest keep their order");
  assert.equal(engine.state.cards[id("top")].ownerId, P2);
  assert.equal(engine.state.cards[id("top")].controllerId, P2);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "then my search is offered");
  assert.equal(hand(engine, P1).includes(id("top")), false, "the revealed card is not in MY hand");
  assert.equal(myHandBefore.includes(id("mr")), true);
});

clause(MEAGER, "0:rule", "the cost of 1 is paid when the tactic is played, before responses; nothing is revealed until it resolves", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  const before = ready(engine);
  playRaw(engine, P1, id("mr"));
  assert.equal(before - ready(engine), 1, "COST 1 paid up front");
  assert.equal(revealEvents(engine).length, 0, "nothing revealed yet");
  assert.equal(zoneOf(engine, id("top")), "deck", "their top card has not moved yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("top")), "hand");
});

clause(MEAGER, "0:rule", "the revealed card goes to the opponent's hand whatever its type (character, item, tactic, location or resource)", () => {
  for (const kind of KINDS) {
    const { engine, id } = meagerBoard({ oppTop: kind });
    play(engine, P1, id("mr"), {});
    assert.equal(zoneOf(engine, id("top")), "hand", `${kind}: moved to a hand`);
    assert.equal(hand(engine, P2).includes(id("top")), true, `${kind}: their hand`);
    assert.equal(hand(engine, P1).includes(id("top")), false, `${kind}: not mine`);
  }
});

clause(MEAGER, "0:rule", "after the reveal I get to search my deck for a card of the SAME TYPE: only those are offered (character case)", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  play(engine, P1, id("mr"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
  assert.equal(zoneOf(engine, id("top")), "hand", "the reveal already happened");
  for (const kind of KINDS.filter((k) => k !== "character")) {
    assert.throws(() => pick(engine, P1, [id(`m-${kind}-1`)]), `a ${kind} is not the same type as a character`);
  }
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(engine, P1, [id("m-character-2")]);
  assert.equal(zoneOf(engine, id("m-character-2")), "hand", "control: a character is accepted");
});

for (const kind of KINDS) {
  clause(MEAGER, "0:rule", `the revealed card is a ${kind}: I may find a ${kind} from my deck, reveal it and put it into my hand; other types are refused`, () => {
    const { engine, id } = meagerBoard({ oppTop: kind });
    play(engine, P1, id("mr"), {});
    for (const other of KINDS.filter((k) => k !== kind)) {
      assert.throws(() => pick(engine, P1, [id(`m-${other}-1`)]), `${other} is refused`);
    }
    const handBefore = [...hand(engine, P1)];
    pick(engine, P1, [id(`m-${kind}-2`)]);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id(`m-${kind}-2`)), "hand");
    assert.deepEqual(hand(engine, P1), [...handBefore, id(`m-${kind}-2`)], "exactly the found card joined my hand");
    assert.equal(zoneOf(engine, id(`m-${kind}-1`)), "deck", "the other same-type card stays in the deck");
    const reveals = revealEvents(engine);
    assert.equal(reveals.length, 2, "two reveals: the opponent's top card, then the card I found");
    const found = reveals[1].event as unknown as { cardIds: string[]; viewerId: string; ownerId: string };
    assert.deepEqual(found.cardIds, [id(`m-${kind}-2`)], "the card I found is revealed");
    assert.equal(found.viewerId, "all", "to everyone");
    assert.equal(found.ownerId, P1);
  });
}

clause(MEAGER, "0:rule", "the search covers MY deck only: the opponent's deck, my hand and both discard piles are refused", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  play(engine, P1, id("mr"), {});
  for (const key of ["o2", "o4", "oppHandChar", "oppDiscChar", "hChar", "dChar", "top"]) assert.throws(() => pick(engine, P1, [key === "top" ? id("top") : id(key)]), key);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
  pick(engine, P1, [id("m-character-1")]);
  assert.equal(zoneOf(engine, id("m-character-1")), "hand");
  assert.equal(zoneOf(engine, id("o2")), "deck", "the opponent's deck keeps its cards");
});

clause(MEAGER, "0:rule", "only one card can be found: two cards are refused", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  play(engine, P1, id("mr"), {});
  assert.throws(() => pick(engine, P1, [id("m-character-1"), id("m-character-2")]));
  assert.throws(() => pick(engine, P1, [id("m-character-1"), id("m-character-1")]));
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
});

clause(MEAGER, "0:rule", "the search is a 'may': I can decline, and then no card of mine moves (the opponent still gets the revealed card)", () => {
  const { engine, id } = meagerBoard({ oppTop: "item" });
  const myHandBefore = [...hand(engine, P1)];
  const myDeckBefore = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  pick(engine, P1, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(hand(engine, P1), myHandBefore.filter((c) => c !== id("mr")), "my hand only lost the tactic");
  sameCards(deck(engine, P1), myDeckBefore);
  assert.equal(zoneOf(engine, id("top")), "hand", "the opponent still got their card");
  assert.equal(revealEvents(engine).length, 1, "only the opponent's card was revealed");
  assert.equal(zoneOf(engine, id("mr")), "discard", "the tactic ends in my discard pile");
});

clause(MEAGER, "0:rule", "my deck is shuffled after I search it; the opponent's deck is not shuffled", () => {
  const { engine, id } = meagerBoard({ oppTop: "location" });
  const myDeckBefore = [...deck(engine, P1)];
  const oppDeckAfterTop = deck(engine, P2).slice(1);
  play(engine, P1, id("mr"), {});
  pick(engine, P1, [id("m-location-1")]);
  const after = deck(engine, P1);
  sameCards(after, myDeckBefore.filter((c) => c !== id("m-location-1")));
  assert.notDeepEqual(after, myDeckBefore.filter((c) => c !== id("m-location-1")), "my deck was shuffled (CR 312.1)");
  assert.deepEqual(deck(engine, P2), oppDeckAfterTop, "their deck keeps its order");
});

clause(MEAGER, "0:rule", "when my deck has no card of that type there is nothing to find: the opponent still gets the card, and the tactic resolves", () => {
  const { engine, id } = meagerBoard({ oppTop: "location", myKinds: ["character", "item", "tactic", "resource"] });
  const myDeckBefore = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("top")), "hand");
  assert.equal(zoneOf(engine, id("mr")), "discard");
  sameCards(deck(engine, P1), myDeckBefore);
  assert.equal(hand(engine, P1).filter((c) => myDeckBefore.includes(c)).length, 0, "no card of mine moved to my hand");
});

clause(MEAGER, "0:rule", "a search that finds nothing still shuffles my deck (CR 312.1: searched decks are shuffled)", () => {
  const { engine, id } = meagerBoard({ oppTop: "location", myKinds: ["character", "item", "tactic", "resource"] });
  const myDeckBefore = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.notDeepEqual(deck(engine, P1), myDeckBefore, "the deck was searched, so it is shuffled afterwards");
});

clause(MEAGER, "0:rule", "if the opponent's deck is empty nothing is revealed, nothing moves, and the tactic still resolves", () => {
  const { engine, id } = meagerBoard({ oppTop: null });
  const myDeckBefore = [...deck(engine, P1)];
  const oppHandBefore = [...hand(engine, P2)];
  const before = ready(engine);
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 1, "the cost was paid");
  assert.equal(revealEvents(engine).length, 0, "no card to reveal");
  assert.deepEqual(hand(engine, P2), oppHandBefore);
  sameCards(deck(engine, P1), myDeckBefore);
  assert.equal(zoneOf(engine, id("mr")), "discard");
});

clause(MEAGER, "0:rule", "only the TOP card is revealed and moved: the second card of their deck is not", () => {
  const { engine, id } = meagerBoard({ oppTop: "character" });
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("o2")), "deck");
  assert.equal(deck(engine, P2)[0], id("o2"), "the old second card is now on top");
  assert.equal(hand(engine, P2).filter((c) => [id("o2"), id("o3"), id("o4")].includes(c)).length, 0);
});

clause(MEAGER, "0:rule", "the card is revealed AFTER being chosen for the match: a second Meager Research reveals the new top card", () => {
  const second = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
      { key: "mr2", def: printing(MEAGER), owner: P1, zone: "hand" },
      { key: "t1", def: item({ name: "T1" }), owner: P2, zone: "deck" },
      { key: "t2", def: tactic({ name: "T2" }), owner: P2, zone: "deck" },
      { key: "mi", def: item({ name: "MI" }), owner: P1, zone: "deck" },
      { key: "mt", def: tactic({ name: "MT" }), owner: P1, zone: "deck" },
      ...bank("elitism", 3, P1)
    ]
  });
  const { engine, id } = second;
  play(engine, P1, id("mr"), {});
  pick(engine, P1, [id("mi")]);
  play(engine, P1, id("mr2"), {});
  pick(engine, P1, [id("mt")]);
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(zoneOf(engine, id("t2")), "hand");
  assert.equal(zoneOf(engine, id("mi")), "hand", "item for the revealed item");
  assert.equal(zoneOf(engine, id("mt")), "hand", "tactic for the revealed tactic");
});

clause(MEAGER, "0:rule", "is refused with no resources, and without [E] even with plenty of other resources; one [E] is exactly enough", () => {
  const none = meagerBoard({ oppTop: "character", elitism: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("mr")));
  assert.equal(zoneOf(none.engine, none.id("mr")), "hand");
  const noE = meagerBoard({ oppTop: "character", elitism: 0, greed: 5 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("mr")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("top")), "deck", "nothing was revealed by the refused play");
  const exact = meagerBoard({ oppTop: "character", elitism: 1 });
  play(exact.engine, P1, exact.id("mr"), {});
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("top")), "hand", "one [E] and exactly one resource is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(MEAGER, "0:rule", "can be played in response to the opponent's action (a tactic may respond)", () => {
  const opener = tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
      { key: "opener", def: opener, owner: P2, zone: "hand" },
      { key: "top", def: item({ name: "Top" }), owner: P2, zone: "deck" },
      { key: "mine", def: item({ name: "Mine" }), owner: P1, zone: "deck" },
      ...bank("elitism", 2, P1)
    ]
  });
  playRaw(engine, P2, id("opener"));
  engine.perform({ type: "playCard", playerId: P1, cardId: id("mr"), selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("top")), "hand", "the response resolved");
  assert.equal(hand(engine, P2).includes(id("top")), true);
});

// ===============================================================================
// Micromajig tokens (shared by Avalanche, Factory, Maker and Master).
// "(Treat Micromajig tokens as Gearsmith character cards with 1 strength, 1 life,
// and 3 speed. If a Micromajig token would leave play, remove it from the game
// instead.)"
// ===============================================================================

/** The Micromajig tokens `player` controls in play. */
function micromajigs(engine: SpoilsEngine, player: Pid = P1): string[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);
}

/** Every Micromajig token in play, whoever controls it. */
const allMicromajigs = (engine: SpoilsEngine): string[] => micromajigs(engine, P1).concat(micromajigs(engine, P2));

/** A token that left play no longer exists in any zone ("remove it from the game"). */
function assertGone(engine: SpoilsEngine, cardId: string, label: string) {
  const card = engine.state.cards[cardId];
  assert.ok(card === undefined || card.zone === "removed", `${label}: the token is out of the game (zone ${card?.zone})`);
  for (const player of [P1, P2] as const) {
    assert.equal(engine.state.players[player].discard.includes(cardId), false, `${label}: not in ${player}'s discard pile`);
    assert.equal(engine.state.players[player].hand.includes(cardId), false, `${label}: not in ${player}'s hand`);
    assert.equal(engine.state.players[player].deck.includes(cardId), false, `${label}: not in ${player}'s deck`);
    assert.equal(engine.state.players[player].play.includes(cardId), false, `${label}: not in ${player}'s play area`);
  }
}

/** Free tactics (and a damage dealer for locations) the Micromajig boards use to make tokens leave play. */
function microExtras(): CardPlacement[] {
  const zapLoc = tactic({
    name: "ZapLoc",
    cost: 0,
    behavior: {
      abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }]
    }
  });
  return [
    { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
    { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
    { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
    { key: "sendDiscard", def: sendTactic("discard"), owner: P1, zone: "hand" },
    { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
    { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
    { key: "zap1", def: zapTactic(1), owner: P1, zone: "hand" },
    { key: "zap2", def: zapTactic(2), owner: P1, zone: "hand" },
    { key: "zapLoc", def: zapLoc, owner: P1, zone: "hand" },
    { key: "fillA", def: character({ name: "FillA" }), owner: P1, zone: "deck" },
    { key: "fillB", def: character({ name: "FillB" }), owner: P1, zone: "deck" },
    { key: "fillC", def: character({ name: "FillC" }), owner: P1, zone: "deck" },
    { key: "fillD", def: item({ name: "FillD" }), owner: P1, zone: "deck" },
    { key: "fillE", def: tactic({ name: "FillE" }), owner: P1, zone: "deck" },
    { key: "fillF", def: character({ name: "FillF" }), owner: P1, zone: "deck" },
    { key: "oppFill", def: character({ name: "OppFill" }), owner: P2, zone: "deck" }
  ];
}

/** Every token is a character card named Micromajig with exactly 1 strength, 1 life and 3 speed. */
function assertMicromajigBody(engine: SpoilsEngine, tokens: string[]) {
  assert.ok(tokens.length > 0, "there is at least one token to look at");
  for (const token of tokens) {
    const def = engine.getDefinition(token);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character", "a character card");
    assert.deepEqual(engine.getCardTypes(token), ["character"]);
    assert.deepEqual(stat(engine, token), [1, 1, 3], "1 strength, 1 life, 3 speed");
    assert.equal(engine.state.cards[token].damage, 0);
    assert.equal(engine.state.cards[token].depleted, false);
    assert.equal(engine.state.cards[token].faceDown, false);
    assert.equal(engine.state.cards[token].isToken, true, "it is a token");
  }
}

/** "Gearsmith character cards" — the tokens' trade is Gearsmith. */
function assertTokensAreGearsmith(engine: SpoilsEngine, tokens: string[]) {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.equal(engine.getDefinition(token).trade, "gearsmith");
}

/** CR 409.3c (RULES.md 13): a Micromajig is a Gearsmith character with the "majig" subtype. */
function assertTokensAreMajigs(engine: SpoilsEngine, tokens: string[]) {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.deepEqual(engine.getSubtypes(token), ["majig"]);
}

type MicroBoard = { engine: SpoilsEngine; id: (key: string) => string };

/** "If a Micromajig token would leave play, remove it from the game instead": however a token leaves play, it ceases to exist — it never reaches a hand, deck or discard pile. */
function assertTokenLeavesTheGame(board: MicroBoard, tokens: string[]) {
  const { engine, id } = board;
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendDiscard", "put into the discard pile"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  assert.ok(tokens.length >= sends.length, "enough tokens for every way of leaving play");
  const handBefore = [...hand(engine, P1)];
  const deckBefore = [...deck(engine, P1)];
  const discardBefore = [...discard(engine, P1)];
  sends.forEach(([key, label], i) => {
    const victim = tokens[i];
    assert.equal(zoneOf(engine, victim), "play", `${label}: the token is in play to begin with`);
    play(engine, P1, id(key), { selected: { t: [victim] } });
    drain(engine, declineAll);
    assertGone(engine, victim, label);
  });
  const added = discard(engine, P1).filter((c) => !discardBefore.includes(c) && !sends.some(([k]) => id(k) === c));
  assert.deepEqual(added, [], "no token card entered a discard pile");
  assert.deepEqual(
    hand(engine, P1).filter((c) => !handBefore.includes(c)),
    [],
    "no token card entered the hand"
  );
  assert.deepEqual(
    deck(engine, P1).filter((c) => !deckBefore.includes(c)),
    [],
    "no token card entered the deck"
  );
}

/** A token destroyed by damage: 1 life, so 1 damage kills it, and it vanishes (not in the discard pile). */
function assertTokenDiesOfDamage(board: MicroBoard, token: string) {
  const { engine, id } = board;
  const discardBefore = [...discard(engine, P1)];
  play(engine, P1, id("zap1"), { selected: { t: [token] } });
  assertGone(engine, token, "killed by 1 damage");
  assert.deepEqual(
    discard(engine, P1).filter((c) => !discardBefore.includes(c)),
    [id("zap1")],
    "only the tactic itself went to the discard pile"
  );
}

/** A freshly made token can block but cannot attack on the turn it entered play (it is a character, CR 204.3). */
function assertTokenCanBlockButNotAttack(board: MicroBoard, token: string) {
  const { engine, id } = board;
  assert.throws(() => declareAttackBy(engine, P1, [token]), "a token put into play this turn cannot attack");
  assert.equal(engine.state.battle, undefined);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [token] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [token], "the token blocks");
}

/** A token that survived a turn can attack on the next one (it is a character like any other). */
function assertTokenCanAttackNextTurn(board: MicroBoard, token: string) {
  const { engine, id } = board;
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  declareAttackBy(engine, P1, [token]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, 30 - 1, "the 1-strength token hit the faction for 1");
  void id;
}

/** A gear-like item attached to a token leaves play with it (CR 409.3). */
function attachableGear(): CardDefinition {
  return item({ name: "TokenGear", attachTo: "character", subtype: ["gear"] });
}

/** A watcher whose triggered ability counts characters entering play (on itself, as `token` counters). */
function entryWatcher(): CardDefinition {
  return item({
    name: "EntryWatcher",
    behavior: {
      abilities: [
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "cardTypeIs", target: "eventCard", cardType: "character" },
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
        }
      ]
    }
  });
}

// ===============================================================================
// Micromajig Avalanche — Tactic (gearsmith), cost 0, threshold [E][E][E][E].
// COST: Pick a number for X. Pay twice X. -- EFFECT: Put X Micromajig tokens into play.
// ===============================================================================

const AVALANCHE = "f81f97e9-1583-438a-9afd-216644040796";

function avalancheBoard(opts: { elitism?: number; greed?: number; active?: Pid; zone?: "hand" | "discard" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "av", def: printing(AVALANCHE), owner: P1, zone: opts.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "watch", def: entryWatcher(), owner: P1, zone: "play" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

for (const x of [0, 1, 2, 3, 5]) {
  clause(AVALANCHE, "0:ability", `X=${x}: pays twice X (${2 * x} resources) and puts exactly ${x} Micromajig token(s) into play under my control`, () => {
    const { engine, id } = avalancheBoard();
    const before = ready(engine);
    play(engine, P1, id("av"), { variables: { x } });
    assert.equal(before - ready(engine), 2 * x, `the cost is twice X = ${2 * x}`);
    const tokens = micromajigs(engine, P1);
    assert.equal(tokens.length, x, `${x} token(s) are mine`);
    assert.equal(micromajigs(engine, P2).length, 0, "none for the opponent");
    for (const t of tokens) {
      assert.equal(engine.state.cards[t].ownerId, P1);
      assert.equal(engine.state.cards[t].controllerId, P1);
      assert.equal(zoneOf(engine, t), "play");
    }
    assert.equal(zoneOf(engine, id("av")), "discard", "the tactic ends in my discard pile");
    assert.equal(zoneOf(engine, id("mine")), "play", "my other character is untouched");
    assert.equal(zoneOf(engine, id("foe")), "play", "the opponent's character is untouched");
  });
}

clause(AVALANCHE, "0:ability", "the cost (twice X) is paid when the tactic is played, before responses; the tokens only arrive once it resolves", () => {
  const { engine, id } = avalancheBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("av"), { variables: { x: 3 } });
  assert.equal(before - ready(engine), 6, "6 resources are already paid while the opponent may still respond");
  assert.equal(allMicromajigs(engine).length, 0, "no token yet");
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(AVALANCHE, "0:ability", "X is my choice and may be 0: it is playable for no resources at all (but still needs [E][E][E][E])", () => {
  const free = avalancheBoard({ elitism: 4 });
  const before = ready(free.engine);
  play(free.engine, P1, free.id("av"), { variables: { x: 0 } });
  assert.equal(before - ready(free.engine), 0, "X=0 costs nothing");
  assert.equal(zoneOf(free.engine, free.id("av")), "discard", "X=0 is a legal value: the tactic resolves");
  assert.equal(allMicromajigs(free.engine).length, 0);
});

clause(AVALANCHE, "0:ability", "the cost is 'twice X', not X: 4 resources buy X=2 but not X=3, and an odd count never buys the extra token", () => {
  const four = avalancheBoard({ elitism: 4 });
  assert.throws(() => playRaw(four.engine, P1, four.id("av"), { variables: { x: 3 } }), "X=3 needs 6");
  assert.equal(zoneOf(four.engine, four.id("av")), "hand");
  assert.equal(ready(four.engine), 4, "nothing was spent");
  play(four.engine, P1, four.id("av"), { variables: { x: 2 } });
  assert.equal(micromajigs(four.engine, P1).length, 2, "exactly 4 resources is enough for X=2");
  assert.equal(ready(four.engine), 0);
  const five = avalancheBoard({ elitism: 5 });
  assert.throws(() => playRaw(five.engine, P1, five.id("av"), { variables: { x: 3 } }), "5 resources are one short of the 6 that X=3 costs");
  play(five.engine, P1, five.id("av"), { variables: { x: 2 } });
  assert.equal(ready(five.engine), 1, "X=2 with 5 resources leaves 1");
});

clause(AVALANCHE, "0:ability", "X can be as large as I can pay for: 12 resources buy X=6, 13 is refused", () => {
  const { engine, id } = avalancheBoard({ elitism: 12 });
  assert.throws(() => playRaw(engine, P1, id("av"), { variables: { x: 7 } }), "X=7 needs 14");
  play(engine, P1, id("av"), { variables: { x: 6 } });
  assert.equal(micromajigs(engine, P1).length, 6);
  assert.equal(ready(engine), 0);
});

clause(AVALANCHE, "0:ability", "X is a number of at least 0: a negative X is refused", () => {
  const { engine, id } = avalancheBoard();
  assert.throws(() => playRaw(engine, P1, id("av"), { variables: { x: -1 } }));
  assert.equal(zoneOf(engine, id("av")), "hand");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(ready(engine), 12, "nothing was spent");
});

clause(AVALANCHE, "0:ability", "X must be a whole number (CR 410.2): a fractional X such as 1.5 is refused", () => {
  const { engine, id } = avalancheBoard();
  assert.throws(() => playRaw(engine, P1, id("av"), { variables: { x: 1.5 } }), "a fractional X");
  assert.equal(zoneOf(engine, id("av")), "hand");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(ready(engine), 12, "nothing was spent");
});

clause(AVALANCHE, "0:ability", "needs [E][E][E][E]: three [E] with plenty of other resources is refused, four [E] and six others buys X=5", () => {
  const three = avalancheBoard({ elitism: 3, greed: 9 });
  assert.throws(() => playRaw(three.engine, P1, three.id("av"), { variables: { x: 1 } }));
  assert.throws(() => playRaw(three.engine, P1, three.id("av"), { variables: { x: 0 } }), "even X=0 needs the threshold");
  assert.equal(zoneOf(three.engine, three.id("av")), "hand");
  const noE = avalancheBoard({ elitism: 0, greed: 12 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("av")), "no [E] at all");
  const four = avalancheBoard({ elitism: 4, greed: 6 });
  play(four.engine, P1, four.id("av"), { variables: { x: 5 } });
  assert.equal(micromajigs(four.engine, P1).length, 5, "the icons are a gate, not spent: 10 resources pay for X=5");
  assert.equal(ready(four.engine), 0);
});

clause(AVALANCHE, "0:ability", "its numeric cost of 0 means the twice-X pay is the whole cost: no extra resource is taken", () => {
  const { engine, id } = avalancheBoard({ elitism: 5 });
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assert.equal(ready(engine), 1, "5 - 4 = 1: only twice X was paid");
});

clause(AVALANCHE, "0:ability", "tokens are put into play, not deployed: the tactic resolves with no further choice and no card is drawn or discarded", () => {
  const { engine, id } = avalancheBoard();
  const handBefore = hand(engine, P1).filter((c) => c !== id("av"));
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(hand(engine, P1), handBefore, "my hand lost only the tactic");
});

clause(AVALANCHE, "0:ability", "every token enters play: an 'enters play' watcher sees one entry per token", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 3 } });
  assert.equal(tokensOn(engine, id("watch")), 3, "three characters entered play");
});

clause(AVALANCHE, "0:ability", "can be played in response on the opponent's turn: the tokens are still mine", () => {
  const opener = tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "av", def: printing(AVALANCHE), owner: P1, zone: "hand" },
      { key: "opener", def: opener, owner: P2, zone: "hand" },
      ...bank("elitism", 6, P1)
    ]
  });
  playRaw(engine, P2, id("opener"));
  engine.perform({ type: "playCard", playerId: P1, cardId: id("av"), selected: {}, variables: { x: 2 } } as never);
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 0);
});

clause(AVALANCHE, "1:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 3 } });
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "the tokens carry the majig subtype (CR 409.3c / RULES.md 13)", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "if a token would leave play (destroyed, bounced, decked, discarded, voided, removed) it is removed from the game instead: never in a hand, deck or discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 6 } });
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(AVALANCHE, "1:rule", "a token dies to 1 damage and is removed from the game, not put into the discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 2 } });
  const [token, other] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, other), "play", "the other token is untouched");
});

clause(AVALANCHE, "1:rule", "a token has exactly 1 life: 1 damage kills it and the 4-life Foe survives 1; 2 damage on a token also kills it", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 1 } });
  const [token] = micromajigs(engine, P1);
  play(engine, P1, id("zap1"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play");
  play(engine, P1, id("zap2"), { selected: { t: [token] } });
  assertGone(engine, token, "2 damage on a 1-life token");
});

clause(AVALANCHE, "1:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 1 } });
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

clause(AVALANCHE, "1:rule", "a token that has been in play since the start of my next turn can attack, with 1 strength", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 1 } });
  assertTokenCanAttackNextTurn(board, micromajigs(board.engine, P1)[0]);
});

clause(AVALANCHE, "1:rule", "a token blocking deals its 1 strength at speed 3 and dies to a 1-strength attacker, leaving no card behind", () => {
  const board = avalancheBoard();
  const { engine, id } = board;
  play(engine, P1, id("av"), { variables: { x: 1 } });
  const [token] = micromajigs(engine, P1);
  endTurn(engine, P1);
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, [token]);
  assert.equal(engine.state.cards[id("foe")].damage, 1, "the token dealt its 1 strength");
  assertGone(engine, token, "token killed in battle");
});

clause(AVALANCHE, "1:rule", "an item attached to a token leaves play with it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "av", def: printing(AVALANCHE), owner: P1, zone: "hand" },
      { key: "gear", def: attachableGear(), owner: P1, zone: "hand" },
      { key: "zap", def: zapTactic(1), owner: P1, zone: "hand" },
      ...bank("elitism", 12, P1)
    ]
  });
  play(engine, P1, id("av"), { variables: { x: 1 } });
  const [token] = micromajigs(engine, P1);
  play(engine, P1, id("gear"), { selected: { attachTo: [token] } });
  assert.equal(engine.state.cards[id("gear")].attachedTo, token, "the gear is attached to the token");
  play(engine, P1, id("zap"), { selected: { t: [token] } });
  assertGone(engine, token, "token");
  assert.notEqual(zoneOf(engine, id("gear")), "play", "the attached card left play with the token (CR 409.3)");
});

// ===============================================================================
// Micromajig Factory — Location (gearsmith), cost 1, threshold [E][E][E], structure 5.
// WIND UP -- COST: Pay 4. -- EFFECT: Put a Micromajig token into play.
// ===============================================================================

const FACTORY = "bba8a718-d685-4731-bf6e-3acdc92f7a75";

function factoryBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mf", def: printing(FACTORY), owner: P1, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "watch", def: entryWatcher(), owner: P1, zone: "play" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(FACTORY, "0:ability:windup", "WIND UP pays exactly 4 and puts exactly one Micromajig token into play under my control", () => {
  const { engine, id } = factoryBoard();
  const before = ready(engine);
  activate(engine, P1, id("mf"), "windup");
  assert.equal(before - ready(engine), 4, "COST: Pay 4");
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 1, "exactly one token");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(engine.state.cards[tokens[0]].ownerId, P1);
  assert.equal(zoneOf(engine, id("mf")), "play", "the Factory stays in play");
  assert.equal(engine.state.cards[id("mf")].depleted, false, "using WIND UP does not deplete the Factory");
  assert.equal(tokensOn(engine, id("watch")), 1, "the token entered play");
});

clause(FACTORY, "0:ability:windup", "the 4 are paid as the cost, before responses; the token only arrives once the ability resolves", () => {
  const { engine, id } = factoryBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("mf"), "windup");
  assert.equal(before - ready(engine), 4);
  assert.equal(allMicromajigs(engine).length, 0, "no token yet");
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(FACTORY, "0:ability:windup", "is refused with only 3 resources (one short); with exactly 4 it works", () => {
  const short = factoryBoard({ elitism: 3 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("mf"), "windup"));
  assert.equal(allMicromajigs(short.engine).length, 0);
  assert.equal(ready(short.engine), 3, "nothing was spent");
  const exact = factoryBoard({ elitism: 4 });
  activate(exact.engine, P1, exact.id("mf"), "windup");
  assert.equal(micromajigs(exact.engine, P1).length, 1);
  assert.equal(ready(exact.engine), 0);
});

clause(FACTORY, "0:ability:windup", "can be used again and again: 8 resources make two tokens, 12 make three", () => {
  const { engine, id } = factoryBoard({ elitism: 12 });
  activate(engine, P1, id("mf"), "windup");
  activate(engine, P1, id("mf"), "windup");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(ready(engine), 4);
  activate(engine, P1, id("mf"), "windup");
  assert.equal(micromajigs(engine, P1).length, 3);
  assert.equal(ready(engine), 0);
  assert.throws(() => activateRaw(engine, P1, id("mf"), "windup"), "a fourth use cannot be paid");
});

clause(FACTORY, "0:ability:windup", "the ability has no threshold of its own: 4 resources of any kind pay for it (no [E] needed once the Factory is in play)", () => {
  const { engine, id } = factoryBoard({ elitism: 0, greed: 4 });
  activate(engine, P1, id("mf"), "windup");
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(FACTORY, "0:ability:windup", "only the Factory's controller can use WIND UP", () => {
  const { engine, id } = factoryBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("mf"), "windup"));
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(FACTORY, "0:ability:windup", "a Factory controlled by the opponent puts the token under THEIR control and spends THEIR resources", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [{ key: "mf", def: printing(FACTORY), owner: P2, zone: "play" }, ...bank("elitism", 4, P2), ...bank("elitism", 4, P1)]
  });
  const mine = ready(engine, P1);
  activate(engine, P2, id("mf"), "windup");
  assert.equal(micromajigs(engine, P2).length, 1);
  assert.equal(micromajigs(engine, P1).length, 0);
  assert.equal(ready(engine, P1), mine, "I spent nothing");
  assert.equal(ready(engine, P2), 0);
});

clause(FACTORY, "0:ability:windup", "cannot be used from the hand (the Factory must be in play)", () => {
  const { engine, id } = factoryBoard({ zone: "hand" });
  assert.throws(() => activateRaw(engine, P1, id("mf"), "windup"));
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(FACTORY, "0:ability:windup", "can be used on the opponent's turn in response to their action", () => {
  const opener = tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "mf", def: printing(FACTORY), owner: P1, zone: "play" },
      { key: "opener", def: opener, owner: P2, zone: "hand" },
      ...bank("elitism", 4, P1)
    ]
  });
  playRaw(engine, P2, id("opener"));
  activateRaw(engine, P1, id("mf"), "windup");
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(FACTORY, "0:ability:windup", "deploys for its printed cost of 1 with [E][E][E], is refused without them, and is a location with structure 5", () => {
  const { engine, id } = factoryBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mf"), {});
  assert.equal(zoneOf(engine, id("mf")), "play");
  assert.equal(before - ready(engine), 1, "cost 1");
  assert.deepEqual(typesOf(engine, id("mf")), ["location"]);
  assert.equal(engine.getDefinition(id("mf")).structure, 5);
  const noThreshold = factoryBoard({ zone: "hand", elitism: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("mf")), "two [E] is one short of [E][E][E]");
  const none = factoryBoard({ zone: "hand", elitism: 0, greed: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("mf")), "no resources at all");
});

clause(FACTORY, "0:ability:windup", "the Factory has structure 5: 4 damage leaves it standing, 5 destroys it", () => {
  const { engine, id } = factoryBoard();
  play(engine, P1, id("zapLoc"), { selected: { t: [id("mf")] } });
  assert.equal(zoneOf(engine, id("mf")), "play", "4 damage < 5 structure");
  assert.equal(engine.state.cards[id("mf")].damage, 4);
  engine.state.cards[id("mf")].damage = 5;
  play(engine, P1, id("zap1"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("mf")), "discard", "5 damage >= 5 structure");
});

clause(FACTORY, "1:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = factoryBoard();
  activate(engine, P1, id("mf"), "windup");
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(FACTORY, "1:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = factoryBoard();
  activate(engine, P1, id("mf"), "windup");
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(FACTORY, "1:rule", "the tokens carry the majig subtype (CR 409.3c / RULES.md 13)", () => {
  const { engine, id } = factoryBoard();
  activate(engine, P1, id("mf"), "windup");
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(FACTORY, "1:rule", "if a token would leave play (destroyed, bounced, decked, discarded, voided, removed) it is removed from the game instead: never in a hand, deck or discard pile", () => {
  const board = factoryBoard({ elitism: 24 });
  for (let i = 0; i < 6; i++) activate(board.engine, P1, board.id("mf"), "windup");
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(FACTORY, "1:rule", "a token dies to 1 damage and is removed from the game, not put into the discard pile", () => {
  const board = factoryBoard({ elitism: 8 });
  activate(board.engine, P1, board.id("mf"), "windup");
  activate(board.engine, P1, board.id("mf"), "windup");
  const [token, other] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, other), "play");
});

clause(FACTORY, "1:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = factoryBoard();
  activate(board.engine, P1, board.id("mf"), "windup");
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

clause(FACTORY, "1:rule", "a token that has been in play since the start of my next turn can attack", () => {
  const board = factoryBoard();
  activate(board.engine, P1, board.id("mf"), "windup");
  assertTokenCanAttackNextTurn(board, micromajigs(board.engine, P1)[0]);
});

clause(FACTORY, "1:rule", "when the Factory itself leaves play, the tokens it made stay (they are independent cards)", () => {
  const board = factoryBoard();
  activate(board.engine, P1, board.id("mf"), "windup");
  board.engine.state.cards[board.id("mf")].damage = 5;
  play(board.engine, P1, board.id("zap1"), { selected: { t: [board.id("foe")] } });
  assert.equal(zoneOf(board.engine, board.id("mf")), "discard");
  assert.equal(micromajigs(board.engine, P1).length, 1, "the token is still in play");
});

// ===============================================================================
// Micromajig Maker — Character (inventor), cost 2, threshold [E][E], 1 strength /
// 3 speed / 1 life.
// When this card enters play, you may put a Micromajig token into play.
// ===============================================================================

const MAKER = "81afa3d9-1060-46cc-8986-e992f8277ebe";

/** A free tactic that puts `count` Micromajig tokens into play under `who`'s control (id `m`). */
function makeTokensTactic(count: number, who: "controller" | "opponent"): CardDefinition {
  return tactic({
    name: `MakeTokens-${who}-${count}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "m",
          type: "activated",
          effects: [{ type: "createTokens", controller: who, count, token: { name: "Micromajig", cardType: "character", subtype: [], strength: 1, life: 1, speed: 3 } }]
        }
      ]
    }
  });
}

function makerBoard(opts: { zone?: "hand" | "play" | "discard"; elitism?: number; greed?: number; owner?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  const revive = tactic({
    name: "Revive",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MAKER), owner, zone: opts.zone ?? "hand" },
      { key: "mm2", def: printing(MAKER), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner, zone: "hand" },
      { key: "revive", def: revive, owner, zone: "hand" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

clause(MAKER, "0:rule", "when it enters play I am offered a token: accepting puts exactly one Micromajig token into play under my control", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a prompt is offered");
  assert.equal(pc.playerId, P1, "to the Maker's controller");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1, "exactly one token");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play", "the Maker itself stays in play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAKER, "0:rule", "it is a 'may': declining puts no token into play and the Maker still enters play", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAKER, "0:rule", "the choice is the Maker's controller's: the opponent cannot answer it", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never));
  assert.equal(allMicromajigs(engine).length, 0);
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MAKER, "0:rule", "a Maker controlled by the opponent offers THEM the token, and it enters under their control", () => {
  const { engine, id } = makerBoard({ owner: P2 });
  play(engine, P2, id("mm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(micromajigs(engine, P2).length, 1);
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(MAKER, "0:rule", "it triggers off the Maker entering play, not off another card entering play afterwards", () => {
  const { engine, id } = makerBoard({ zone: "play" });
  play(engine, P1, id("plain"), {});
  assert.equal(engine.state.pendingChoice, undefined, "no prompt when another character enters");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(MAKER, "0:rule", "it also triggers when the Maker is put into play by an effect rather than deployed", () => {
  const { engine, id } = makerBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("mm")] } });
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.ok(pendingOf(engine), "'enters play' includes being put into play");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MAKER, "0:rule", "each Maker triggers separately: two Makers make two tokens (one each)", () => {
  const { engine, id } = makerBoard({ elitism: 8 });
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  play(engine, P1, id("mm2"), {});
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAKER, "0:rule", "leaving play does not trigger it", () => {
  const { engine, id } = makerBoard({ zone: "play" });
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("mm")] } });
  assert.equal(zoneOf(engine, id("mm")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(MAKER, "0:rule", "a Maker already on the board does not make tokens at the start of later turns", () => {
  const { engine } = makerBoard({ zone: "play" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(MAKER, "0:rule", "the cost is paid when the Maker is played, before responses; the prompt comes only once it enters play", () => {
  const { engine, id } = makerBoard({ elitism: 4 });
  const before = ready(engine);
  playRaw(engine, P1, id("mm"));
  assert.equal(before - ready(engine), 2, "cost 2 is paid up front");
  assert.equal(pendingOf(engine), undefined, "no prompt while the Maker is still being deployed");
  assert.equal(zoneOf(engine, id("mm")), "deploying");
  resolvePendingResponses(engine);
  assert.ok(pendingOf(engine), "the prompt appears when it enters play");
});

clause(MAKER, "0:rule", "deploys for its printed cost of 2 with [E][E] (one resource short or one [E] short is refused) and has its printed 1/1/3 stats", () => {
  const { engine, id } = makerBoard({ elitism: 2 });
  const before = ready(engine);
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 2, "cost 2");
  assert.deepEqual(stat(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["inventor"]);
  assert.equal(engine.getDefinition(id("mm")).trade, "gearsmith");
  const short = makerBoard({ elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("mm")), "one resource short");
  const oneE = makerBoard({ elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]");
  const twoE = makerBoard({ elitism: 2, greed: 0 });
  play(twoE.engine, P1, twoE.id("mm"), {});
  assert.equal(zoneOf(twoE.engine, twoE.id("mm")), "play");
});

clause(MAKER, "1:rule", "the token is a character card named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "the token is a GEARSMITH character card", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "the token carries the majig subtype (CR 409.3c / RULES.md 13)", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "if the token would leave play (destroyed, bounced, decked, discarded, voided, removed) it is removed from the game instead", () => {
  for (const key of ["sendDestroy", "sendHand", "sendDeck", "sendDiscard", "sendVoid", "sendRemove"]) {
    const board = makerBoard();
    play(board.engine, P1, board.id("mm"), {});
    answerMay(board.engine, P1, true);
    const [token] = micromajigs(board.engine, P1);
    play(board.engine, P1, board.id(key), { selected: { t: [token] } });
    drain(board.engine, declineAll);
    assertGone(board.engine, token, key);
    assert.equal(zoneOf(board.engine, board.id("mm")), "play", "the Maker is not the one that left");
  }
});

clause(MAKER, "1:rule", "the token dies to 1 damage and is removed from the game, not put into the discard pile", () => {
  const board = makerBoard();
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
  assertTokenDiesOfDamage(board, micromajigs(board.engine, P1)[0]);
  assert.equal(zoneOf(board.engine, board.id("mm")), "play", "the Maker (1 life) is untouched");
});

clause(MAKER, "1:rule", "the token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = makerBoard();
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// ===============================================================================
// Micromajig Master — Character (manager), cost 3, threshold [E][E], 1 strength /
// 3 speed / 1 life.
// When this card enters play, you may put 2 Micromajig tokens into play.
// TINY SACRIFICES -- COST: Destroy 3 Micromajig tokens you control. -- EFFECT: Search
// your deck for a card and put it into your hand.
// ===============================================================================

const MASTER = "d0ce5f33-bb41-40c1-9b4e-36677c5ef390";

/** Puts a used tactic back into its owner's hand so a board can make several tokens with it. */
function regive(engine: SpoilsEngine, cardId: string, owner: Pid) {
  const card = engine.state.cards[cardId];
  const state = engine.state.players[owner];
  state.discard = state.discard.filter((c) => c !== cardId);
  state.hand.push(cardId);
  card.zone = "hand";
}

function masterBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; mine?: number; theirs?: number; emptyDeck?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: seededRandom(),
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MASTER), owner, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "mkMine", def: makeTokensTactic(1, "controller"), owner, zone: "hand" },
      { key: "mkTheirs", def: makeTokensTactic(1, "opponent"), owner, zone: "hand" },
      ...microExtras().filter((placement) => !(opts.emptyDeck && placement.zone === "deck" && placement.owner === P1)),
      { key: "myHandCard", def: character({ name: "MyHandCard" }), owner, zone: "hand" },
      { key: "myDiscardCard", def: character({ name: "MyDiscardCard" }), owner, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
  // the helper tactics make the tokens through the engine, the way the real cards do
  for (let i = 0; i < (opts.mine ?? 0); i++) {
    play(board.engine, owner, board.id("mkMine"), {});
    regive(board.engine, board.id("mkMine"), owner);
  }
  for (let i = 0; i < (opts.theirs ?? 0); i++) {
    play(board.engine, owner, board.id("mkTheirs"), {});
    regive(board.engine, board.id("mkTheirs"), owner);
  }
  return board;
}

clause(MASTER, "0:rule", "when it enters play I am offered 2 tokens: accepting puts exactly two Micromajig tokens into play under my control", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a prompt is offered");
  assert.equal(pc.playerId, P1, "to the Master's controller");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2, "exactly two tokens");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MASTER, "0:rule", "it is a 'may': declining puts no token into play and the Master still enters play", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MASTER, "0:rule", "the choice is the Master's controller's: the opponent cannot answer it", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never));
  assert.equal(allMicromajigs(engine).length, 0);
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "0:rule", "a Master controlled by the opponent offers THEM the tokens, and they enter under their control", () => {
  const { engine, id } = masterBoard({ zone: "hand", owner: P2 });
  play(engine, P2, id("mm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(micromajigs(engine, P2).length, 2);
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(MASTER, "0:rule", "it triggers when the Master is put into play by an effect, but not when another card enters play or when the Master leaves play", () => {
  const near = masterBoard({ zone: "play" });
  play(near.engine, P1, near.id("mkMine"), {});
  assert.equal(near.engine.state.pendingChoice, undefined, "another card entering play (a token) does not trigger the Master");
  assert.equal(micromajigs(near.engine, P1).length, 1, "only the token the tactic made");
  play(near.engine, P1, near.id("sendDestroy"), { selected: { t: [near.id("mm")] } });
  assert.equal(zoneOf(near.engine, near.id("mm")), "discard");
  assert.equal(near.engine.state.pendingChoice, undefined, "leaving play does not trigger it");
  assert.equal(micromajigs(near.engine, P1).length, 1);
});

clause(MASTER, "0:rule", "a Master already on the board does not make tokens at the start of later turns", () => {
  const { engine } = masterBoard({ zone: "play" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(MASTER, "0:rule", "deploys for its printed cost of 3 with [E][E] (one resource short or one [E] short is refused) and has its printed 1/1/3 stats", () => {
  const { engine, id } = masterBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 3, "cost 3");
  assert.deepEqual(stat(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["manager"]);
  assert.equal(engine.getDefinition(id("mm")).trade, "gearsmith");
  const short = masterBoard({ zone: "hand", elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("mm")), "one resource short");
  const oneE = masterBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]");
});

// --- TINY SACRIFICES

/** Uses TINY SACRIFICES, destroying the given tokens. */
function tinySacrifices(engine: SpoilsEngine, id: (k: string) => string, tokens: string[], player: Pid = P1) {
  activateRaw(engine, player, id("mm"), "tiny", { selected: { toks: tokens } });
  resolvePendingResponses(engine);
}

clause(MASTER, "1:ability:tiny", "destroys exactly 3 of my Micromajig tokens as its cost, then I search my deck and put the chosen card into my hand", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 3);
  const before = ready(engine);
  const handBefore = [...hand(engine, P1)];
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertGone(engine, t, "TINY SACRIFICES cost");
  const pc = pendingOf(engine);
  assert.ok(pc, "the search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
  pick(engine, P1, [id("fillD")]);
  assert.equal(zoneOf(engine, id("fillD")), "hand");
  assert.deepEqual(hand(engine, P1).filter((c) => !handBefore.includes(c)), [id("fillD")], "exactly one card joined my hand");
  assert.equal(ready(engine), before, "no resources are spent");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.cards[id("mm")].depleted, false, "the Master is not depleted by its own ability");
});

clause(MASTER, "1:ability:tiny", "the 3 tokens are destroyed as a COST, before responses; the search only happens once the ability resolves", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  activateRaw(engine, P1, id("mm"), "tiny", { selected: { toks: tokens } });
  for (const t of tokens) assertGone(engine, t, "already destroyed while the ability waits for responses");
  assert.equal(pendingOf(engine), undefined, "no search yet");
  resolvePendingResponses(engine);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
});

clause(MASTER, "1:ability:tiny", "with more than 3 tokens only the 3 chosen are destroyed; the others stay in play", () => {
  const { engine, id } = masterBoard({ mine: 5 });
  const tokens = micromajigs(engine, P1);
  const chosen = [tokens[1], tokens[3], tokens[4]];
  tinySacrifices(engine, id, chosen);
  for (const t of chosen) assertGone(engine, t, "chosen");
  for (const t of [tokens[0], tokens[2]]) assert.equal(zoneOf(engine, t), "play", "an unchosen token stays");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "any search result is possible: a character, an item or a tactic", () => {
  for (const key of ["fillA", "fillD", "fillE"]) {
    const { engine, id } = masterBoard({ mine: 3 });
    tinySacrifices(engine, id, micromajigs(engine, P1));
    pick(engine, P1, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(MASTER, "1:ability:tiny", "only a card from MY deck can be found: the opponent's deck, my hand and my discard pile are refused, and only one card", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  for (const key of ["oppFill", "myHandCard", "myDiscardCard", "ally", "foe"]) assert.throws(() => pick(engine, P1, [id(key)]), key);
  assert.throws(() => pick(engine, P1, [id("fillA"), id("fillB")]), "one card");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(engine, P1, [id("fillB")]);
  assert.equal(zoneOf(engine, id("fillB")), "hand");
  assert.equal(zoneOf(engine, id("oppFill")), "deck");
});

clause(MASTER, "1:ability:tiny", "'Search your deck for a card' is not optional (CR 312.2): with cards in the deck I must find one, so taking nothing is refused", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const handBefore = [...hand(engine, P1)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  assert.throws(() => pick(engine, P1, []), "an unconditional search for a card must find one when the deck has any");
  assert.deepEqual(hand(engine, P1), handBefore);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "the search is still open");
});

clause(MASTER, "1:ability:tiny", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const before = deck(engine, P1).filter((c) => c !== id("fillC"));
  const theirs = [...deck(engine, P2)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pick(engine, P1, [id("fillC")]);
  sameCards(deck(engine, P1), before);
  assert.notDeepEqual(deck(engine, P1), before, "in a new order");
  assert.deepEqual(deck(engine, P2), theirs);
});

clause(MASTER, "1:ability:tiny", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pick(engine, P1, [id("fillA")]);
  assert.equal(revealEvents(engine).length, 0);
});

clause(MASTER, "1:ability:tiny", "with an empty deck the cost is still paid and there is simply nothing to find", () => {
  const { engine, id } = masterBoard({ mine: 3, emptyDeck: true });
  assert.equal(deck(engine, P1).length, 0, "my deck is empty");
  tinySacrifices(engine, id, micromajigs(engine, P1));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(micromajigs(engine, P1).length, 0, "the three tokens were destroyed");
});

clause(MASTER, "1:ability:tiny", "is refused with only 2 tokens (one short), and nothing is destroyed or searched", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => tinySacrifices(engine, id, tokens), "2 tokens < 3");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.throws(() => tinySacrifices(engine, id, []), "no tokens chosen");
  const none = masterBoard({ mine: 0 });
  assert.throws(() => tinySacrifices(none.engine, none.id, []), "no tokens at all");
});

clause(MASTER, "1:ability:tiny", "needs exactly 3 chosen: 2 or 4 chosen tokens are refused even with 4 on the board", () => {
  const { engine, id } = masterBoard({ mine: 4 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => tinySacrifices(engine, id, tokens.slice(0, 2)), "two chosen");
  assert.throws(() => tinySacrifices(engine, id, tokens), "four chosen");
  assert.equal(micromajigs(engine, P1).length, 4, "nothing was destroyed by the refused attempts");
  tinySacrifices(engine, id, tokens.slice(0, 3));
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MASTER, "1:ability:tiny", "the same token cannot be chosen three times", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const [t] = micromajigs(engine, P1);
  assert.throws(() => tinySacrifices(engine, id, [t, t, t]));
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "only tokens I CONTROL can be destroyed: the opponent's Micromajig tokens are refused", () => {
  const { engine, id } = masterBoard({ mine: 2, theirs: 2 });
  const mine = micromajigs(engine, P1);
  const theirs = micromajigs(engine, P2);
  assert.equal(mine.length, 2);
  assert.equal(theirs.length, 2);
  assert.throws(() => tinySacrifices(engine, id, [...mine, theirs[0]]), "two of mine and one of theirs");
  assert.throws(() => tinySacrifices(engine, id, [mine[0], theirs[0], theirs[1]]), "one of mine and two of theirs");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 2);
});

clause(MASTER, "1:ability:tiny", "only Micromajig tokens count: other characters (mine or theirs), the Master itself and non-characters are refused", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => tinySacrifices(engine, id, [...tokens, id("ally")]), "my other character");
  assert.throws(() => tinySacrifices(engine, id, [...tokens, id("foe")]), "their character");
  assert.throws(() => tinySacrifices(engine, id, [...tokens, id("mm")]), "the Master itself");
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "a depleted token can still be destroyed for the cost", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.cards[tokens[0]].depleted = true;
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertGone(engine, t, "cost");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
});

clause(MASTER, "1:ability:tiny", "can be used again: 6 tokens pay for it twice", () => {
  const { engine, id } = masterBoard({ mine: 6 });
  const tokens = micromajigs(engine, P1);
  tinySacrifices(engine, id, tokens.slice(0, 3));
  pick(engine, P1, [id("fillA")]);
  tinySacrifices(engine, id, tokens.slice(3, 6));
  pick(engine, P1, [id("fillB")]);
  assert.equal(micromajigs(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("fillA")), "hand");
  assert.equal(zoneOf(engine, id("fillB")), "hand");
});

clause(MASTER, "1:ability:tiny", "only the Master's controller can use it, and only while it is in play", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => tinySacrifices(engine, id, tokens, P2));
  assert.equal(micromajigs(engine, P1).length, 3);
  const inHand = masterBoard({ zone: "hand", mine: 3 });
  assert.throws(() => tinySacrifices(inHand.engine, inHand.id, micromajigs(inHand.engine, P1)), "the Master is in hand");
  assert.equal(micromajigs(inHand.engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "a token destroyed as the cost is removed from the game (not put into my discard pile)", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const discardBefore = [...discard(engine, P1)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pick(engine, P1, [id("fillA")]);
  assert.deepEqual(discard(engine, P1), discardBefore, "no token entered my discard pile");
});

clause(MASTER, "2:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "the tokens carry the majig subtype (CR 409.3c / RULES.md 13)", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, true);
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "if a token would leave play (destroyed, bounced, decked, discarded, voided, removed) it is removed from the game instead: never in a hand, deck or discard pile", () => {
  const board = masterBoard({ zone: "hand", elitism: 6 });
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
  for (let i = 0; i < 4; i++) {
    play(board.engine, P1, board.id("mkMine"), {});
    regive(board.engine, board.id("mkMine"), P1);
  }
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(MASTER, "2:rule", "a token dies to 1 damage and is removed from the game, not put into the discard pile", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
  const [token, other] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, other), "play");
});

clause(MASTER, "2:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// ===============================================================================
// One-Legged Hopping Pogo-Bear — Item, cost 0, threshold [E][E][E].
// RAAR! -- COST: Pay 2. -- EFFECT: This turn, this card gains the character type and
// has 3 strength, 3 life, and 3 speed.
// SCHPROING! -- COST: Use this only during your turn. Pay 2. -- EFFECT: If this card
// is a character, it gains COVERT.
// HIDE! -- COST: Pay 1. -- EFFECT: If this card is a character, it loses the
// character type. Deplete this card.
// ===============================================================================

const POGO = "73adba55-6f92-4da9-b1ae-b74dae05d8ac";

function pogoBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; active?: Pid; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: opts.turn ?? 1,
    cards: [
      { key: "pb", def: printing(POGO), owner: P1, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "z1", def: zapTactic(1), owner: P1, zone: "hand" },
      { key: "z2", def: zapTactic(2), owner: P1, zone: "hand" },
      { key: "z3", def: zapTactic(3), owner: P1, zone: "hand" },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** The opponent (P2) attacks with `foe` and passes: I (P1) now hold priority in the battle's response window — the only moment an ability can be used on the opponent's turn. */
function inTheirAttackWindow(board: ReturnType<typeof pogoBoard>) {
  const { engine, id } = board;
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
}

/** After I activated something in a response window: the opponent declines to respond, it resolves, and priority comes back to me. */
function letMyResponseResolve(engine: SpoilsEngine) {
  let guard = 0;
  while (engine.state.responseWindow && !engine.state.pendingChoice && guard++ < 10) {
    const w = engine.state.responseWindow;
    if (w.phase === "acceptingResponses" && w.priorityPlayerId === P1) return;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

clause(POGO, "0:ability:raar", "RAAR! pays exactly 2; this turn the item also becomes a character with 3 strength, 3 life and 3 speed", () => {
  const { engine, id } = pogoBoard();
  assert.deepEqual(typesOf(engine, id("pb")), ["item"], "control: a plain item before RAAR!");
  const before = ready(engine);
  activate(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.deepEqual(stat(engine, id("pb")), [3, 3, 3]);
  assert.ok(isCharacter(engine, id("pb")), "it is a character");
});

clause(POGO, "0:ability:raar", "the cost is paid when the ability is used, before responses", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 2);
  assert.equal(isCharacter(engine, id("pb")), false, "it only becomes a character when the ability resolves");
  resolvePendingResponses(engine);
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
});

clause(POGO, "0:ability:raar", "'gains the character type': it keeps the item type, and an item-targeting card can still pick it", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  assert.deepEqual(typesOf(engine, id("pb")), ["character", "item"]);
  play(engine, P1, id("smashItem"), { selected: { t: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "discard", "destroyed as an item");
});

clause(POGO, "0:ability:raar", "while it is a character a card that picks a character can pick it; before RAAR! it cannot", () => {
  const { engine, id } = pogoBoard();
  assert.throws(() => playRaw(engine, P1, id("z1"), { selected: { t: [id("pb")] } }), "an item is not a legal character pick");
  assert.equal(zoneOf(engine, id("z1")), "hand");
  activate(engine, P1, id("pb"), "raar");
  play(engine, P1, id("z1"), { selected: { t: [id("pb")] } });
  assert.equal(engine.state.cards[id("pb")].damage, 1, "it took the damage as a character");
});

clause(POGO, "0:ability:raar", "it has exactly 3 life as a character: 2 damage leaves it in play, the 3rd destroys it", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  play(engine, P1, id("z2"), { selected: { t: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "play", "2 damage < 3 life");
  play(engine, P1, id("z1"), { selected: { t: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "discard", "3 damage >= 3 life");
});

clause(POGO, "0:ability:raar", "it lasts this turn only: after the turn passes it is a plain item again", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(typesOf(engine, id("pb")), ["item"], "back to a plain item on the opponent's turn");
  endTurn(engine, P2);
  assert.deepEqual(typesOf(engine, id("pb")), ["item"], "and still on my next turn");
  assert.throws(() => playRaw(engine, P1, id("z1"), { selected: { t: [id("pb")] } }), "no longer a character pick");
});

clause(POGO, "0:ability:raar", "it can be used on the opponent's turn: in response to an attack it becomes a 3/3/3 blocker and blocks", () => {
  const { engine, id } = pogoBoard({ active: P2, turn: 2 });
  inTheirAttackWindow({ engine, id } as never);
  activateRaw(engine, P1, id("pb"), "raar");
  resolvePendingResponses(engine);
  assert.equal(battleOf(engine)?.phase, "blocking");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pb")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("pb")], "the animated item blocks");
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("foe")].damage, 3, "it dealt 3 battle damage (3 strength)");
  assert.equal(zoneOf(engine, id("pb")), "play", "1 damage < 3 life");
  assert.equal(engine.state.cards[id("pb")].damage, 1);
});

clause(POGO, "0:ability:raar", "an item that is not animated cannot block", () => {
  const { engine, id } = pogoBoard({ active: P2, turn: 2 });
  declareAttackBy(engine, P2, [id("foe")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pb")] }), "an item is not a character");
});

clause(POGO, "0:ability:raar", "using it twice in a turn costs 4 in all and the stats do not stack (still 3/3/3)", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("pb")), [3, 3, 3]);
  assert.deepEqual(typesOf(engine, id("pb")), ["character", "item"]);
});

clause(POGO, "0:ability:raar", "is refused with only 1 resource (one short); exactly 2 works", () => {
  const short = pogoBoard({ elitism: 1 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("pb"), "raar"));
  assert.deepEqual(typesOf(short.engine, short.id("pb")), ["item"]);
  assert.equal(ready(short.engine), 1, "nothing was spent");
  const exact = pogoBoard({ elitism: 2 });
  activate(exact.engine, P1, exact.id("pb"), "raar");
  assert.ok(isCharacter(exact.engine, exact.id("pb")), "isCharacter(exact.engine, exact.id(\"pb\"))");
});

clause(POGO, "0:ability:raar", "only its controller can use it, and only from play", () => {
  const { engine, id } = pogoBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("pb"), "raar"));
  assert.deepEqual(typesOf(engine, id("pb")), ["item"]);
  const inHand = pogoBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("pb"), "raar"));
});

clause(POGO, "0:ability:raar", "the Pogo-Bear is an item that deploys for 0 with [E][E][E] and is refused with only two [E]", () => {
  const { engine, id } = pogoBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("pb"), {});
  assert.equal(zoneOf(engine, id("pb")), "play");
  assert.equal(before - ready(engine), 0, "cost 0");
  assert.deepEqual(typesOf(engine, id("pb")), ["item"], "an item, not a character");
  const two = pogoBoard({ zone: "hand", elitism: 2, greed: 6 });
  assert.throws(() => playRaw(two.engine, P1, two.id("pb")), "two [E] is one short of [E][E][E]");
  const none = pogoBoard({ zone: "hand", elitism: 0, greed: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("pb")), "no resources");
});

clause(POGO, "1:ability:schproing", "as a character it gains COVERT for 2 resources, and only it (no other card)", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "no COVERT before SCHPROING!");
  const before = ready(engine);
  activate(engine, P1, id("pb"), "schproing");
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.ok(engine.getKeywords(id("pb")).includes("covert"), "engine.getKeywords(id(\"pb\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("ally")).includes("covert"), false);
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false);
});

clause(POGO, "1:ability:schproing", "the 2 are paid as the cost, before responses; COVERT arrives when it resolves", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  const before = ready(engine);
  activateRaw(engine, P1, id("pb"), "schproing");
  assert.equal(before - ready(engine), 2);
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "not yet");
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("pb")).includes("covert"), "engine.getKeywords(id(\"pb\")).includes(\"covert\")");
});

clause(POGO, "1:ability:schproing", "if the Pogo-Bear is not a character the cost is paid but it gains nothing", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activate(engine, P1, id("pb"), "schproing");
  assert.equal(before - ready(engine), 2, "the 2 resources were paid");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "an item gains no keyword from 'if this card is a character'");
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "and the earlier use did not store COVERT for later");
});

clause(POGO, "1:ability:schproing", "'use this only during your turn': refused on the opponent's turn (even in a response window where other abilities work), allowed on mine", () => {
  const theirs = pogoBoard({ active: P2, turn: 2 });
  inTheirAttackWindow(theirs);
  activateRaw(theirs.engine, P1, theirs.id("pb"), "raar");
  letMyResponseResolve(theirs.engine);
  assert.ok(isCharacter(theirs.engine, theirs.id("pb")), "isCharacter(theirs.engine, theirs.id(\"pb\"))");
  const readyBefore = ready(theirs.engine);
  assert.throws(() => activateRaw(theirs.engine, P1, theirs.id("pb"), "schproing"), "not my turn");
  assert.equal(theirs.engine.getKeywords(theirs.id("pb")).includes("covert"), false);
  assert.equal(ready(theirs.engine), readyBefore, "no resources spent by the refused use");
  activateRaw(theirs.engine, P1, theirs.id("pb"), "hide");
  letMyResponseResolve(theirs.engine);
  assert.equal(isCharacter(theirs.engine, theirs.id("pb")), false, "control: in the same window HIDE! is allowed, so it is the 'only during your turn' restriction that refused SCHPROING!");
  const mine = pogoBoard();
  activate(mine.engine, P1, mine.id("pb"), "raar");
  activate(mine.engine, P1, mine.id("pb"), "schproing");
  assert.ok(mine.engine.getKeywords(mine.id("pb")).includes("covert"), "my own turn");
});

clause(POGO, "1:ability:schproing", "is refused with only 1 resource (one short); exactly 2 works", () => {
  const short = pogoBoard({ elitism: 3 });
  activate(short.engine, P1, short.id("pb"), "raar");
  assert.equal(ready(short.engine), 1);
  assert.throws(() => activateRaw(short.engine, P1, short.id("pb"), "schproing"));
  assert.equal(short.engine.getKeywords(short.id("pb")).includes("covert"), false);
  const exact = pogoBoard({ elitism: 4 });
  activate(exact.engine, P1, exact.id("pb"), "raar");
  activate(exact.engine, P1, exact.id("pb"), "schproing");
  assert.ok(exact.engine.getKeywords(exact.id("pb")).includes("covert"), "exact.engine.getKeywords(exact.id(\"pb\")).includes(\"covert\")");
});

clause(POGO, "1:ability:schproing", "using it twice gives only one COVERT (a card cannot hold two instances, CR 507.3e)", () => {
  const { engine, id } = pogoBoard({ elitism: 8 });
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "schproing");
  activate(engine, P1, id("pb"), "schproing");
  assert.equal(engine.getKeywords(id("pb")).filter((k) => k === "covert").length, 1);
});

clause(POGO, "1:ability:schproing", "the COVERT is gone by the next turn (it ends with the character type)", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "schproing");
  assert.ok(engine.getKeywords(id("pb")).includes("covert"), "engine.getKeywords(id(\"pb\")).includes(\"covert\")");
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "a character again next turn, but without the old COVERT");
});

clause(POGO, "1:ability:schproing", "temporary rules text gained while a character is removed when it loses the character type (CR 508.3): after HIDE! and RAAR! again it has no COVERT", () => {
  const { engine, id } = pogoBoard({ elitism: 8 });
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "schproing");
  assert.ok(engine.getKeywords(id("pb")).includes("covert"), "engine.getKeywords(id(\"pb\")).includes(\"covert\")");
  activate(engine, P1, id("pb"), "hide");
  assert.equal(isCharacter(engine, id("pb")), false);
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "not a character: no COVERT");
  activate(engine, P1, id("pb"), "raar");
  assert.ok(isCharacter(engine, id("pb")), "a character again");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "the COVERT gained during the first stint as a character was removed when it stopped being one (CR 508.3)");
});

clause(POGO, "1:ability:schproing", "COVERT is real: the Pogo-Bear as a covert blocker can block only covert parties", () => {
  // SCHPROING! can only be used on my turn, so check the keyword itself is the genuine COVERT keyword (CR 507.3d).
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "schproing");
  assert.deepEqual(engine.getKeywords(id("pb")).filter((k) => k === "covert"), ["covert"]);
  assert.equal(engine.hasKeyword(id("pb"), "covert"), true);
});

clause(POGO, "2:ability:hide", "HIDE! pays exactly 1; the character is no longer a character and is depleted", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  const before = ready(engine);
  activate(engine, P1, id("pb"), "hide");
  assert.equal(before - ready(engine), 1, "COST: Pay 1");
  assert.equal(isCharacter(engine, id("pb")), false, "no longer a character");
  assert.deepEqual(typesOf(engine, id("pb")), ["item"]);
  assert.equal(engine.state.cards[id("pb")].depleted, true, "depleted");
  assert.throws(() => playRaw(engine, P1, id("z1"), { selected: { t: [id("pb")] } }), "not a legal character pick any more");
});

clause(POGO, "2:ability:hide", "the 1 is paid as the cost, before responses", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  const before = ready(engine);
  activateRaw(engine, P1, id("pb"), "hide");
  assert.equal(before - ready(engine), 1);
  assert.ok(isCharacter(engine, id("pb")), "still a character while the ability waits for responses");
  resolvePendingResponses(engine);
  assert.equal(isCharacter(engine, id("pb")), false);
});

clause(POGO, "2:ability:hide", "when it is not a character the Pogo-Bear is still depleted and the 1 resource is paid", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activate(engine, P1, id("pb"), "hide");
  assert.equal(before - ready(engine), 1);
  assert.equal(engine.state.cards[id("pb")].depleted, true, "'Deplete this card' is unconditional");
  assert.deepEqual(typesOf(engine, id("pb")), ["item"]);
});

clause(POGO, "2:ability:hide", "a card that stops being a character forgets the damage it took this turn (CR 208.3)", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  play(engine, P1, id("z2"), { selected: { t: [id("pb")] } });
  assert.equal(engine.state.cards[id("pb")].damage, 2);
  activate(engine, P1, id("pb"), "hide");
  assert.equal(engine.state.cards[id("pb")].damage, 0, "damage is forgotten");
});

clause(POGO, "2:ability:hide", "becoming a character again does not bring the forgotten damage back: after HIDE! and RAAR! it is a fresh 3-life character", () => {
  const { engine, id } = pogoBoard({ elitism: 8 });
  activate(engine, P1, id("pb"), "raar");
  play(engine, P1, id("z2"), { selected: { t: [id("pb")] } });
  activate(engine, P1, id("pb"), "hide");
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.state.cards[id("pb")].damage, 0, "no damage on the new character");
  play(engine, P1, id("z1"), { selected: { t: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "play", "1 damage < 3 life on the fresh character (the 2 forgotten + 1 would have destroyed it)");
});

clause(POGO, "2:ability:hide", "a blocking Pogo-Bear that hides is removed from the battle immediately (CR 208.4)", () => {
  const { engine, id } = pogoBoard({ active: P2, turn: 2 });
  inTheirAttackWindow({ engine, id } as never);
  activateRaw(engine, P1, id("pb"), "raar");
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pb")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("pb")]);
  // the battle's first response window: the attacker passes, then I respond
  const window = engine.state.responseWindow;
  if (window && window.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  activateRaw(engine, P1, id("pb"), "hide");
  resolvePendingResponses(engine);
  assert.equal(isCharacter(engine, id("pb")), false);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "it left the blocking party");
});

clause(POGO, "2:ability:hide", "it can become a character again the same turn: RAAR! after HIDE! works and costs 2 more", () => {
  const { engine, id } = pogoBoard({ elitism: 8 });
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "hide");
  assert.equal(isCharacter(engine, id("pb")), false);
  const before = ready(engine);
  activate(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 2);
  assert.ok(isCharacter(engine, id("pb")), "a character again");
  assert.deepEqual(stat(engine, id("pb")), [3, 3, 3]);
});

clause(POGO, "2:ability:hide", "is refused with no resources (needs 1)", () => {
  const { engine, id } = pogoBoard({ elitism: 0 });
  assert.throws(() => activateRaw(engine, P1, id("pb"), "hide"));
  assert.equal(engine.state.cards[id("pb")].depleted, false);
});

clause(POGO, "2:ability:hide", "it can be used on the opponent's turn too (in a response window)", () => {
  const board = pogoBoard({ active: P2, turn: 2 });
  const { engine, id } = board;
  inTheirAttackWindow(board);
  activateRaw(engine, P1, id("pb"), "raar");
  letMyResponseResolve(engine);
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
  activateRaw(engine, P1, id("pb"), "hide");
  letMyResponseResolve(engine);
  assert.equal(isCharacter(engine, id("pb")), false);
  assert.equal(engine.state.cards[id("pb")].depleted, true);
});

clause(POGO, "2:ability:hide", "it can be used again later: a depleted Pogo-Bear can still HIDE! (its cost is 1 resource, not a deplete) and RAAR! still works while depleted", () => {
  const { engine, id } = pogoBoard({ elitism: 8 });
  activate(engine, P1, id("pb"), "hide");
  assert.equal(engine.state.cards[id("pb")].depleted, true);
  activate(engine, P1, id("pb"), "hide");
  activate(engine, P1, id("pb"), "raar");
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
});

// ===============================================================================
// Research Investment — Tactic (gearsmith), cost 0, threshold [E]x6.
// Both players may search their deck for up to 3 staple resources and put them into
// play.
// ===============================================================================

const INVESTMENT = "ec646752-561a-4ba7-9c0c-69eb41457d56";

const stapleDef = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", name: string) => resourceCard({ name, resource: { provides: [icon], staple: true } });

function investmentBoard(opts: { elitism?: number; greed?: number; active?: Pid; myStaples?: boolean; theirStaples?: boolean } = {}) {
  const withStaples = (owner: Pid, tag: string, on: boolean): CardPlacement[] => [
    ...(on
      ? [
          { key: `${tag}Rage`, def: stapleDef("rage", `${tag}Rage`), owner, zone: "deck" as const },
          { key: `${tag}Greed`, def: stapleDef("greed", `${tag}Greed`), owner, zone: "deck" as const },
          { key: `${tag}Elitism`, def: stapleDef("elitism", `${tag}Elitism`), owner, zone: "deck" as const },
          { key: `${tag}Deception`, def: stapleDef("deception", `${tag}Deception`), owner, zone: "deck" as const },
          { key: `${tag}Obsession`, def: stapleDef("obsession", `${tag}Obsession`), owner, zone: "deck" as const }
        ]
      : []),
    { key: `${tag}Fancy`, def: resourceCard({ name: `${tag}Fancy`, resource: { provides: ["rage"], staple: false } }), owner, zone: "deck" },
    { key: `${tag}Char`, def: character({ name: `${tag}Char` }), owner, zone: "deck" },
    { key: `${tag}Item`, def: item({ name: `${tag}Item` }), owner, zone: "deck" },
    { key: `${tag}HandRes`, def: stapleDef("rage", `${tag}HandRes`), owner, zone: "hand" },
    { key: `${tag}DiscRes`, def: stapleDef("rage", `${tag}DiscRes`), owner, zone: "discard" }
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: seededRandom(),
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ri", def: printing(INVESTMENT), owner: P1, zone: "hand" },
      { key: "opener", def: tactic({ name: "Opener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      ...withStaples(P1, "a", opts.myStaples ?? true),
      ...withStaples(P2, "b", opts.theirStaples ?? true),
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const STAPLE_KEYS = (tag: string) => ["Rage", "Greed", "Elitism", "Deception", "Obsession"].map((n) => `${tag}${n}`);

clause(INVESTMENT, "0:rule", "I search first (the active player), choosing up to 3 staple resources, which go into play face-up under my control", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the active player searches first");
  pick(engine, P1, [id("aRage"), id("aGreed"), id("aObsession")]);
  for (const key of ["aRage", "aGreed", "aObsession"]) {
    assert.equal(zoneOf(engine, id(key)), "play", `${key} is in play`);
    assert.equal(engine.state.cards[id(key)].faceDown, false, `${key} is face-up`);
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
    assert.equal(engine.state.cards[id(key)].attachedTo, undefined, "not spent");
  }
  assert.equal(zoneOf(engine, id("aElitism")), "deck", "an unpicked staple stays in the deck");
  assert.equal(engine.getThresholds(P1).obsession, 1, "it provides its icon");
});

clause(INVESTMENT, "0:rule", "then the opponent searches THEIR deck for up to 3 staple resources, which go into play under THEIR control", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  pick(engine, P1, []);
  const pc = pendingOf(engine);
  assert.ok(pc, "the opponent's search is offered even though I took nothing");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent searches");
  pick(engine, P2, [id("bRage"), id("bDeception")]);
  for (const key of ["bRage", "bDeception"]) {
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(engine.state.cards[id(key)].controllerId, P2);
    assert.equal(engine.state.cards[id(key)].faceDown, false);
  }
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.players[P2].play.includes(id("bRage")), true, "in their play area");
  assert.equal(zoneOf(engine, id("aRage")), "deck", "I took nothing");
  assert.equal(zoneOf(engine, id("ri")), "discard", "the tactic ends in my discard pile");
});

for (const n of [0, 1, 2, 3]) {
  clause(INVESTMENT, "0:rule", `'up to 3': each player may take ${n} staple resource(s)`, () => {
    const { engine, id } = investmentBoard();
    const myPick = STAPLE_KEYS("a").slice(0, n).map(id);
    const theirPick = STAPLE_KEYS("b").slice(2, 2 + n).map(id);
    const myPlayBefore = engine.state.players[P1].play.length;
    const theirPlayBefore = engine.state.players[P2].play.length;
    play(engine, P1, id("ri"), {});
    pick(engine, P1, myPick);
    pick(engine, P2, theirPick);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].play.length, myPlayBefore + n, `I gained exactly ${n}`);
    assert.equal(engine.state.players[P2].play.length, theirPlayBefore + n, `they gained exactly ${n}`);
    for (const c of myPick) assert.equal(zoneOf(engine, c), "play");
    for (const c of theirPick) assert.equal(zoneOf(engine, c), "play");
    assert.equal(STAPLE_KEYS("a").filter((k) => zoneOf(engine, id(k)) === "deck").length, 5 - n, "the rest of my staples stay in my deck");
    assert.equal(STAPLE_KEYS("b").filter((k) => zoneOf(engine, id(k)) === "deck").length, 5 - n, "the rest of their staples stay in their deck");
  });
}

clause(INVESTMENT, "0:rule", "more than 3 is refused for either player (4 staples), while 3 is accepted", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  assert.throws(() => pick(engine, P1, STAPLE_KEYS("a").slice(0, 4).map(id)), "4 staples for me");
  assert.throws(() => pick(engine, P1, STAPLE_KEYS("a").map(id)), "5 staples for me");
  assert.equal(pendingOf(engine)?.playerId, P1, "still my search");
  pick(engine, P1, STAPLE_KEYS("a").slice(0, 3).map(id));
  assert.throws(() => pick(engine, P2, STAPLE_KEYS("b").slice(0, 4).map(id)), "4 staples for them");
  assert.equal(pendingOf(engine)?.playerId, P2, "still their search");
  pick(engine, P2, STAPLE_KEYS("b").slice(0, 3).map(id));
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(INVESTMENT, "0:rule", "only STAPLE resources: a non-staple resource card, a character and an item are refused", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  for (const key of ["aFancy", "aChar", "aItem"]) assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not a staple resource`);
  assert.throws(() => pick(engine, P1, [id("aRage"), id("aFancy")]), "a staple together with a non-staple");
  assert.equal(pendingOf(engine)?.playerId, P1);
  pick(engine, P1, [id("aRage")]);
  for (const key of ["bFancy", "bChar", "bItem"]) assert.throws(() => pick(engine, P2, [id(key)]), `${key} is not a staple resource`);
  pick(engine, P2, [id("bGreed")]);
  assert.equal(zoneOf(engine, id("aFancy")), "deck");
  assert.equal(zoneOf(engine, id("bFancy")), "deck");
});

clause(INVESTMENT, "0:rule", "each player searches only THEIR OWN deck: the other deck, hands and discard piles are refused", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  for (const key of ["bRage", "bGreed", "aHandRes", "bHandRes", "aDiscRes", "bDiscRes"]) assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not in my deck`);
  pick(engine, P1, [id("aRage")]);
  for (const key of ["aGreed", "aHandRes", "bHandRes", "aDiscRes", "bDiscRes"]) assert.throws(() => pick(engine, P2, [id(key)]), `${key} is not in their deck`);
  pick(engine, P2, [id("bRage")]);
  assert.equal(zoneOf(engine, id("aHandRes")), "hand");
  assert.equal(zoneOf(engine, id("aDiscRes")), "discard");
});

clause(INVESTMENT, "0:rule", "each player answers their own search: I cannot answer the opponent's", () => {
  const { engine, id } = investmentBoard();
  play(engine, P1, id("ri"), {});
  assert.throws(() => pick(engine, P2, [id("bRage")]), "it is not their search yet");
  pick(engine, P1, [id("aRage")]);
  assert.throws(() => pick(engine, P1, [id("bRage")]), "I cannot take cards from their deck for them");
  assert.equal(zoneOf(engine, id("bRage")), "deck");
  pick(engine, P2, [id("bRage")]);
  assert.equal(zoneOf(engine, id("bRage")), "play");
});

clause(INVESTMENT, "0:rule", "it costs no resources: only the [E][E][E][E][E][E] threshold gates it", () => {
  const { engine, id } = investmentBoard({ elitism: 6 });
  const before = ready(engine);
  play(engine, P1, id("ri"), {});
  pick(engine, P1, [id("aRage"), id("aGreed")]);
  pick(engine, P2, []);
  assert.equal(ready(engine), before + 2, "nothing was paid, and my two new staples are available to spend");
  assert.equal(engine.state.players[P1].play.filter((c) => engine.state.cards[c].attachedTo !== undefined && engine.isResource(c)).length, 0, "no resource was attached (spent)");
});

clause(INVESTMENT, "0:rule", "needs six [E]: five [E] with plenty of other resources is refused; exactly six works", () => {
  const five = investmentBoard({ elitism: 5, greed: 8 });
  assert.throws(() => playRaw(five.engine, P1, five.id("ri")), "five [E] is one short");
  assert.equal(zoneOf(five.engine, five.id("ri")), "hand");
  const noE = investmentBoard({ elitism: 0, greed: 9 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("ri")), "no [E]");
  const six = investmentBoard({ elitism: 6 });
  play(six.engine, P1, six.id("ri"), {});
  assert.equal(pendingOf(six.engine)?.playerId, P1);
});

clause(INVESTMENT, "0:rule", "the staples are put into play, not played: no 'resource played' event, and the Develop Rule is still available", () => {
  const { engine, id } = investmentBoard();
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  play(engine, P1, id("ri"), {});
  pick(engine, P1, [id("aRage"), id("aGreed"), id("aElitism")]);
  pick(engine, P2, [id("bRage")]);
  assert.equal(engine.getLog().filter((entry) => entry.event?.type === "resourcePlayed").length, 0);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule is not consumed");
});

clause(INVESTMENT, "0:rule", "each player's deck is shuffled after they search it; the other player's deck is untouched by their search", () => {
  const { engine, id } = investmentBoard();
  const myDeck = [...deck(engine, P1)];
  const theirDeck = [...deck(engine, P2)];
  play(engine, P1, id("ri"), {});
  pick(engine, P1, [id("aRage")]);
  const myAfterMine = [...deck(engine, P1)];
  assert.deepEqual(deck(engine, P2), theirDeck, "their deck is untouched by my search");
  sameCards(myAfterMine, myDeck.filter((c) => c !== id("aRage")));
  assert.notDeepEqual(myAfterMine, myDeck.filter((c) => c !== id("aRage")), "my deck was shuffled");
  pick(engine, P2, [id("bGreed")]);
  assert.deepEqual(deck(engine, P1), myAfterMine, "my deck is untouched by their search");
  sameCards(deck(engine, P2), theirDeck.filter((c) => c !== id("bGreed")));
  assert.notDeepEqual(deck(engine, P2), theirDeck.filter((c) => c !== id("bGreed")), "their deck was shuffled");
});

clause(INVESTMENT, "0:rule", "a player with no staple resource in their deck is not offered a search, but the other player still searches", () => {
  const noMine = investmentBoard({ myStaples: false });
  play(noMine.engine, P1, noMine.id("ri"), {});
  assert.equal(pendingOf(noMine.engine)?.playerId, P2, "straight to the opponent's search");
  pick(noMine.engine, P2, [noMine.id("bRage")]);
  assert.equal(zoneOf(noMine.engine, noMine.id("bRage")), "play");
  const noTheirs = investmentBoard({ theirStaples: false });
  play(noTheirs.engine, P1, noTheirs.id("ri"), {});
  assert.equal(pendingOf(noTheirs.engine)?.playerId, P1);
  pick(noTheirs.engine, P1, [noTheirs.id("aRage")]);
  assert.equal(noTheirs.engine.state.pendingChoice, undefined, "no search for them");
  assert.equal(zoneOf(noTheirs.engine, noTheirs.id("aRage")), "play");
});

clause(INVESTMENT, "0:rule", "with fewer than 3 staples in a deck the player can take them all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ri", def: printing(INVESTMENT), owner: P1, zone: "hand" },
      { key: "a1", def: stapleDef("rage", "a1"), owner: P1, zone: "deck" },
      { key: "a2", def: stapleDef("greed", "a2"), owner: P1, zone: "deck" },
      { key: "b1", def: stapleDef("rage", "b1"), owner: P2, zone: "deck" },
      ...bank("elitism", 6, P1)
    ]
  });
  play(engine, P1, id("ri"), {});
  pick(engine, P1, [id("a1"), id("a2")]);
  pick(engine, P2, [id("b1")]);
  assert.equal(zoneOf(engine, id("a1")), "play");
  assert.equal(zoneOf(engine, id("a2")), "play");
  assert.equal(zoneOf(engine, id("b1")), "play");
});

clause(INVESTMENT, "0:rule", "the staples can be of different kinds or the same kind", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ri", def: printing(INVESTMENT), owner: P1, zone: "hand" },
      { key: "a1", def: stapleDef("rage", "a1"), owner: P1, zone: "deck" },
      { key: "a2", def: stapleDef("rage", "a2"), owner: P1, zone: "deck" },
      { key: "a3", def: stapleDef("rage", "a3"), owner: P1, zone: "deck" },
      ...bank("elitism", 6, P1)
    ]
  });
  play(engine, P1, id("ri"), {});
  pick(engine, P1, [id("a1"), id("a2"), id("a3")]);
  assert.equal(engine.getThresholds(P1).rage, 3, "three [R]");
});

clause(INVESTMENT, "0:rule", "played in response on the opponent's turn: both players still search, the active player (the opponent) first", () => {
  const { engine, id } = investmentBoard({ active: P2 });
  playRaw(engine, P2, id("opener"));
  engine.perform({ type: "playCard", playerId: P1, cardId: id("ri"), selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  const pc = pendingOf(engine);
  assert.ok(pc, "a search is offered");
  assert.equal(pc.playerId, P2, "the active player acts first");
  pick(engine, P2, [id("bRage")]);
  assert.equal(pendingOf(engine)?.playerId, P1, "then me");
  pick(engine, P1, [id("aRage")]);
  assert.equal(zoneOf(engine, id("aRage")), "play");
  assert.equal(zoneOf(engine, id("bRage")), "play");
});

// ===============================================================================
// Rudimentary Lathe — Item (gearsmith), cost 2, threshold [E][E].
// The numeric cost of your items is reduced by 1, to a minimum of 1.
// ===============================================================================

const LATHE = "1e353dbb-3717-43f7-85a1-0ab5797a16c9";

/** An item whose activated ability (id `a`) costs `cost` resources. */
function payItem(cost: number, name = "PayItem"): CardDefinition {
  return item({
    name,
    behavior: { abilities: [{ id: "a", type: "activated", costs: [{ type: "payResources", amount: cost }], effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
  });
}

function latheBoard(opts: { lathes?: number; latheOwner?: Pid; latheZone?: "play" | "hand" | "discard"; latheFaceDown?: boolean; active?: Pid } = {}) {
  const lathes = opts.lathes ?? 1;
  const latheOwner = opts.latheOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      ...Array.from({ length: lathes }, (_, i) => ({ key: `lathe${i}`, def: printing(LATHE), owner: latheOwner, zone: opts.latheZone ?? ("play" as const), faceDown: opts.latheFaceDown })),
      { key: "i0", def: item({ name: "Item0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "Item1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "i2", def: item({ name: "Item2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "i3", def: item({ name: "Item3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "Item5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "Char3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "t3", def: tactic({ name: "Tactic3", cost: 3, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "l3", def: location({ name: "Loc3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "pay3", def: payItem(3), owner: P1, zone: "play" },
      { key: "kill", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "o3", def: item({ name: "OppItem3", cost: 3 }), owner: P2, zone: "hand" },
      { key: "o1", def: item({ name: "OppItem1", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("elitism", 14, P1),
      ...bank("elitism", 14, P2)
    ]
  });
}

/** Resources `player` spends deploying `key`. */
function costOf(board: ReturnType<typeof latheBoard>, key: string, player: Pid = P1): number {
  const { engine, id } = board;
  const before = ready(engine, player);
  play(engine, player, id(key), {});
  assert.equal(zoneOf(engine, id(key)) === "hand", false, `${key} was deployed`);
  return before - ready(engine, player);
}

clause(LATHE, "0:rule", "with a Lathe in play my items cost 1 less: cost 5 pays 4, cost 3 pays 2, cost 2 pays 1", () => {
  assert.equal(costOf(latheBoard(), "i5"), 4);
  assert.equal(costOf(latheBoard(), "i3"), 2);
  assert.equal(costOf(latheBoard(), "i2"), 1);
});

clause(LATHE, "0:rule", "control: without a Lathe the same items cost their printed number", () => {
  assert.equal(costOf(latheBoard({ lathes: 0 }), "i5"), 5);
  assert.equal(costOf(latheBoard({ lathes: 0 }), "i3"), 3);
  assert.equal(costOf(latheBoard({ lathes: 0 }), "i2"), 2);
});

clause(LATHE, "0:rule", "'to a minimum of 1': a cost-1 item still costs 1", () => {
  assert.equal(costOf(latheBoard(), "i1"), 1);
});

clause(LATHE, "0:rule", "'to a minimum of 1' does not raise a cost that was already below 1: a cost-0 item still costs 0 (CR 410.5)", () => {
  assert.equal(costOf(latheBoard(), "i0"), 0);
});

clause(LATHE, "0:rule", "only ITEMS are cheaper: a character, a tactic and a location cost their printed 3", () => {
  assert.equal(costOf(latheBoard(), "c3"), 3, "character");
  assert.equal(costOf(latheBoard(), "t3"), 3, "tactic");
  assert.equal(costOf(latheBoard(), "l3"), 3, "location");
});

clause(LATHE, "0:rule", "only MY items: with my Lathe the opponent's items cost their printed number", () => {
  const board = latheBoard({ active: P2 });
  assert.equal(costOf(board, "o3", P2), 3);
  const board2 = latheBoard({ active: P2 });
  assert.equal(costOf(board2, "o1", P2), 1);
});

clause(LATHE, "0:rule", "it is the Lathe's controller who benefits: the opponent's Lathe makes THEIR items cheaper and not mine", () => {
  const theirs = latheBoard({ latheOwner: P2, active: P2 });
  assert.equal(costOf(theirs, "o3", P2), 2, "the opponent's item costs 1 less with their Lathe");
  const mine = latheBoard({ latheOwner: P2 });
  assert.equal(costOf(mine, "i3"), 3, "my item costs its printed 3 against their Lathe");
});

clause(LATHE, "0:rule", "two Lathes reduce by 2 (cost 5 pays 3), still to a minimum of 1 (cost 2 pays 1)", () => {
  assert.equal(costOf(latheBoard({ lathes: 2 }), "i5"), 3);
  assert.equal(costOf(latheBoard({ lathes: 2 }), "i3"), 1);
  assert.equal(costOf(latheBoard({ lathes: 2 }), "i2"), 1);
  assert.equal(costOf(latheBoard({ lathes: 2 }), "i1"), 1);
});

clause(LATHE, "0:rule", "two Lathes still leave a cost-0 item at 0 (CR 410.5)", () => {
  assert.equal(costOf(latheBoard({ lathes: 2 }), "i0"), 0);
});

clause(LATHE, "0:rule", "it only works while the Lathe is in play: not from my hand, my discard pile, or face-down as a resource", () => {
  assert.equal(costOf(latheBoard({ latheZone: "hand" }), "i3"), 3, "in hand");
  assert.equal(costOf(latheBoard({ latheZone: "discard" }), "i3"), 3, "in the discard pile");
  assert.equal(costOf(latheBoard({ latheFaceDown: true }), "i3"), 3, "face-down it is only a resource");
});

clause(LATHE, "0:rule", "it stops when the Lathe leaves play", () => {
  const board = latheBoard();
  assert.equal(costOf(board, "i2"), 1, "with the Lathe");
  const { engine, id } = board;
  play(engine, P1, id("kill"), { selected: { t: [id("lathe0")] } });
  assert.equal(zoneOf(engine, id("lathe0")), "discard");
  assert.equal(costOf(board, "i3"), 3, "after it is destroyed an item costs its printed 3");
});

clause(LATHE, "0:rule", "the reduction is on deploy only: an item's own 'pay 3' ability still costs 3 (CR 406.5b)", () => {
  const { engine, id } = latheBoard();
  const before = ready(engine);
  activate(engine, P1, id("pay3"), "a");
  assert.equal(before - ready(engine), 3);
});

clause(LATHE, "0:rule", "it applies every time: two items in a row each get the reduction", () => {
  const board = latheBoard();
  assert.equal(costOf(board, "i3"), 2);
  assert.equal(costOf(board, "i5"), 4);
});

clause(LATHE, "0:rule", "an item I could not afford at its printed cost becomes affordable: cost 3 with exactly 2 resources", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "lathe", def: printing(LATHE), owner: P1, zone: "play" },
      { key: "i3", def: item({ name: "Item3", cost: 3 }), owner: P1, zone: "hand" },
      ...bank("elitism", 2, P1)
    ]
  });
  play(engine, P1, id("i3"), {});
  assert.equal(zoneOf(engine, id("i3")), "play");
  const control = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "i3", def: item({ name: "Item3", cost: 3 }), owner: P1, zone: "hand" },
      ...bank("elitism", 2, P1)
    ]
  });
  assert.throws(() => playRaw(control.engine, P1, control.id("i3")), "control: without the Lathe two resources are one short");
});

clause(LATHE, "0:rule", "deploys for its own printed cost of 2 with [E][E] (one short or one [E] short is refused) and is a plain item", () => {
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "lathe", def: printing(LATHE), owner: P1, zone: "hand" }, ...bank("elitism", 2, P1)]
  });
  play(ok.engine, P1, ok.id("lathe"), {});
  assert.equal(zoneOf(ok.engine, ok.id("lathe")), "play");
  assert.equal(ready(ok.engine), 0, "cost 2 paid in full: it does not discount itself");
  assert.deepEqual(typesOf(ok.engine, ok.id("lathe")), ["item"]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "lathe", def: printing(LATHE), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1)]
  });
  assert.throws(() => playRaw(short.engine, P1, short.id("lathe")), "one resource short");
  const oneE = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "lathe", def: printing(LATHE), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("greed", 5, P1)]
  });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("lathe")), "one [E] is not [E][E]");
});

// ===============================================================================
// Runic Cannon — Item (gearsmith), cost 2, threshold [E][E].
// LOAD -- COST: Pay 3. -- EFFECT: Put a token on this card.
// FIRE -- COST: Deplete this card. Pick a character. -- EFFECT: Inflict X damage to
// the character, where X is the number of tokens on this card. Remove all tokens
// from this card.
// ===============================================================================

const CANNON = "1504816d-ab35-4bc2-8123-405001e5ce24";

function cannonBoard(opts: { tokens?: number; elitism?: number; greed?: number; zone?: "play" | "hand"; targetLife?: number; active?: Pid; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rc", def: printing(CANNON), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : {}, depleted: opts.depleted },
      { key: "rc2", def: printing(CANNON), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: opts.targetLife ?? 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", life: 6 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "killer", def: sendTactic("destroy"), owner: P2, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(CANNON, "0:ability:load", "LOAD pays exactly 3 and puts exactly one token on the Cannon", () => {
  const { engine, id } = cannonBoard();
  const before = ready(engine);
  activate(engine, P1, id("rc"), "load");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(tokensOn(engine, id("rc")), 1, "exactly one token");
  assert.equal(tokensOn(engine, id("rc2")), 4, "another Cannon's tokens are untouched");
  assert.equal(engine.state.cards[id("rc")].depleted, false, "LOAD does not deplete");
});

clause(CANNON, "0:ability:load", "the 3 are paid as the cost, before responses; the token arrives when it resolves", () => {
  const { engine, id } = cannonBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("rc"), "load");
  assert.equal(before - ready(engine), 3);
  assert.equal(tokensOn(engine, id("rc")), 0, "no token yet");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("rc")), 1);
});

clause(CANNON, "0:ability:load", "each use adds one more token: three uses make three tokens for 9 resources", () => {
  const { engine, id } = cannonBoard({ elitism: 9 });
  for (let i = 1; i <= 3; i++) {
    activate(engine, P1, id("rc"), "load");
    assert.equal(tokensOn(engine, id("rc")), i);
  }
  assert.equal(ready(engine), 0);
  assert.throws(() => activateRaw(engine, P1, id("rc"), "load"), "a fourth use cannot be paid");
});

clause(CANNON, "0:ability:load", "adds to existing tokens (starting from 2 gives 3)", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  activate(engine, P1, id("rc"), "load");
  assert.equal(tokensOn(engine, id("rc")), 3);
});

clause(CANNON, "0:ability:load", "is refused with only 2 resources (one short); exactly 3 works", () => {
  const short = cannonBoard({ elitism: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("rc"), "load"));
  assert.equal(tokensOn(short.engine, short.id("rc")), 0);
  assert.equal(ready(short.engine), 2, "nothing was spent");
  const exact = cannonBoard({ elitism: 3 });
  activate(exact.engine, P1, exact.id("rc"), "load");
  assert.equal(tokensOn(exact.engine, exact.id("rc")), 1);
  assert.equal(ready(exact.engine), 0);
});

clause(CANNON, "0:ability:load", "no threshold of its own: 3 resources of any kind pay for it", () => {
  const { engine, id } = cannonBoard({ elitism: 0, greed: 3 });
  activate(engine, P1, id("rc"), "load");
  assert.equal(tokensOn(engine, id("rc")), 1);
});

clause(CANNON, "0:ability:load", "a depleted Cannon can still be loaded (LOAD's cost is only paying)", () => {
  const { engine, id } = cannonBoard({ depleted: true });
  activate(engine, P1, id("rc"), "load");
  assert.equal(tokensOn(engine, id("rc")), 1);
  assert.equal(engine.state.cards[id("rc")].depleted, true, "and it stays depleted");
});

clause(CANNON, "0:ability:load", "only its controller can use it, and only from play", () => {
  const { engine, id } = cannonBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "load"));
  assert.equal(tokensOn(engine, id("rc")), 0);
  const inHand = cannonBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("rc"), "load"));
});

clause(CANNON, "0:ability:load", "a Cannon starts with no tokens; deploys for its printed cost of 2 with [E][E] (one short or one [E] short is refused)", () => {
  const ok = cannonBoard({ zone: "hand", elitism: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("rc"), {});
  assert.equal(zoneOf(ok.engine, ok.id("rc")), "play");
  assert.equal(before - ready(ok.engine), 2);
  assert.equal(tokensOn(ok.engine, ok.id("rc")), 0, "it enters with no tokens");
  assert.deepEqual(typesOf(ok.engine, ok.id("rc")), ["item"]);
  const short = cannonBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rc")), "one resource short");
  const oneE = cannonBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("rc")), "one [E] is not [E][E]");
});

for (const x of [1, 2, 3, 5]) {
  clause(CANNON, "1:ability:fire", `with ${x} token(s) FIRE inflicts ${x} damage to the picked character and removes all ${x} token(s)`, () => {
    const { engine, id } = cannonBoard({ tokens: x, targetLife: 9 });
    const before = ready(engine);
    activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
    assert.equal(engine.state.cards[id("foe")].damage, x, `X = ${x}`);
    assert.equal(tokensOn(engine, id("rc")), 0, "all tokens removed");
    assert.equal(engine.state.cards[id("rc")].depleted, true, "COST: Deplete this card");
    assert.equal(ready(engine), before, "FIRE costs no resources");
    assert.equal(engine.state.cards[id("bystander")].damage, 0, "another character is untouched");
    assert.equal(engine.state.cards[id("mine")].damage, 0);
    assert.equal(tokensOn(engine, id("rc2")), 4, "another Cannon keeps its tokens");
  });
}

clause(CANNON, "1:ability:fire", "the character is destroyed when X reaches its life, and survives when X is one short", () => {
  const dies = cannonBoard({ tokens: 3, targetLife: 3 });
  activate(dies.engine, P1, dies.id("rc"), "fire", { selected: { c: [dies.id("foe")] } });
  assert.equal(zoneOf(dies.engine, dies.id("foe")), "discard", "3 damage >= 3 life");
  assert.equal(tokensOn(dies.engine, dies.id("rc")), 0, "tokens are removed even though the target died");
  const lives = cannonBoard({ tokens: 2, targetLife: 3 });
  activate(lives.engine, P1, lives.id("rc"), "fire", { selected: { c: [lives.id("foe")] } });
  assert.equal(zoneOf(lives.engine, lives.id("foe")), "play", "2 damage < 3 life");
  assert.equal(lives.engine.state.cards[lives.id("foe")].damage, 2);
});

clause(CANNON, "1:ability:fire", "the cost (deplete, pick) is paid up front; the damage and the token removal happen when it resolves", () => {
  const { engine, id } = cannonBoard({ tokens: 2, targetLife: 9 });
  activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("rc")].depleted, true, "depleted as a cost");
  assert.equal(engine.state.cards[id("foe")].damage, 0, "no damage yet");
  assert.equal(tokensOn(engine, id("rc")), 2, "tokens still there");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("foe")].damage, 2);
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CANNON, "1:ability:fire", "with no tokens it is still a legal activation: the cost is paid, 0 damage is inflicted", () => {
  const { engine, id } = cannonBoard({ tokens: 0, targetLife: 9 });
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("rc")].depleted, true);
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CANNON, "1:ability:fire", "any character can be picked: the opponent's, or one of my own", () => {
  const theirs = cannonBoard({ tokens: 2 });
  activate(theirs.engine, P1, theirs.id("rc"), "fire", { selected: { c: [theirs.id("bystander")] } });
  assert.equal(theirs.engine.state.cards[theirs.id("bystander")].damage, 2);
  const mine = cannonBoard({ tokens: 2 });
  activate(mine.engine, P1, mine.id("rc"), "fire", { selected: { c: [mine.id("mine")] } });
  assert.equal(mine.engine.state.cards[mine.id("mine")].damage, 2, "my own character takes it");
});

clause(CANNON, "1:ability:fire", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "a face-down card is only a resource");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("rc")), "the Cannon itself (an item)");
  assert.equal(engine.state.cards[id("rc")].depleted, false, "refused attempts did not deplete it");
  assert.equal(tokensOn(engine, id("rc")), 2);
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(CANNON, "1:ability:fire", "exactly one character is picked: none or two is refused", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [] } }), "none");
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: {} }), "nothing");
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe"), id("bystander")] } }), "two");
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(tokensOn(engine, id("rc")), 2);
});

clause(CANNON, "1:ability:fire", "cannot be used while the Cannon is depleted; usable again once restored next turn (tokens kept meanwhile)", () => {
  const { engine, id } = cannonBoard({ tokens: 2, targetLife: 9 });
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  activate(engine, P1, id("rc"), "load");
  assert.equal(tokensOn(engine, id("rc")), 1);
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } }), "depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("rc")].depleted, false);
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("bystander")] } });
  assert.equal(engine.state.cards[id("bystander")].damage, 1, "the one token loaded earlier");
});

clause(CANNON, "1:ability:fire", "if the picked character leaves play in response, the cost is still paid and the tokens are still removed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rc", def: printing(CANNON), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "killer", def: sendTactic("destroy"), owner: P2, zone: "hand" }
    ]
  });
  activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("killer"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(tokensOn(engine, id("rc")), 0, "all tokens were removed all the same");
  assert.equal(engine.state.cards[id("rc")].depleted, true);
});

clause(CANNON, "1:ability:fire", "only its controller can use it, and only from play", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "fire", { selected: { c: [id("mine")] } }));
  const inHand = cannonBoard({ zone: "hand", tokens: 2 });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("rc"), "fire", { selected: { c: [inHand.id("foe")] } }));
});

clause(CANNON, "1:ability:fire", "it can be used on the opponent's turn in response to an attack, damaging the attacker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rc", def: printing(CANNON), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  letMyResponseResolve(engine);
  assert.equal(engine.state.cards[id("foe")].damage, 2);
  assert.equal(tokensOn(engine, id("rc")), 0);
});

// ===============================================================================
// Runic Circuitry — Item (gearsmith), cost 1, threshold [E][E].
// This card enters play with 2 tokens on it.
// CONSTRUCT -- COST: Pay 3. Deplete this card. -- EFFECT: Remove a token from this card.
// POWER-UP -- COST: Use this only if there are no tokens on this card. Deplete this
// card. -- EFFECT: The next numeric cost you pay this turn costs up to 3 less.
// ===============================================================================

const CIRCUITRY = "0384d364-6144-4bfa-bde2-2d8e62ba94ac";

function circuitryBoard(opts: { zone?: "hand" | "play" | "discard"; tokens?: number; elitism?: number; greed?: number; depleted?: boolean; owner?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  const revive = tactic({
    name: "ReviveItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "item" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "ci", def: printing(CIRCUITRY), owner, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : {}, depleted: opts.depleted },
      { key: "ci2", def: printing(CIRCUITRY), owner, zone: "play", counters: { token: 0 } },
      { key: "i5", def: item({ name: "Item5", cost: 5 }), owner, zone: "hand" },
      { key: "i5b", def: item({ name: "Item5b", cost: 5 }), owner, zone: "hand" },
      { key: "i2", def: item({ name: "Item2", cost: 2 }), owner, zone: "hand" },
      { key: "i3", def: item({ name: "Item3", cost: 3 }), owner, zone: "hand" },
      { key: "c4", def: character({ name: "Char4", cost: 4 }), owner, zone: "hand" },
      { key: "payItem", def: payItem(3), owner, zone: "play" },
      { key: "revive", def: revive, owner, zone: "hand" },
      { key: "oppItem", def: item({ name: "OppItem", cost: 4 }), owner: owner === P1 ? P2 : P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 12, owner),
      ...bank("elitism", 12, owner === P1 ? P2 : P1),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

clause(CIRCUITRY, "0:rule", "it enters play with exactly 2 tokens on it (deployed from hand)", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  assert.equal(tokensOn(engine, id("ci")), 0, "none in hand");
  play(engine, P1, id("ci"), {});
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2);
});

clause(CIRCUITRY, "0:rule", "it enters play with 2 tokens when put into play by an effect too", () => {
  const { engine, id } = circuitryBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("ci")] } });
  assert.equal(zoneOf(engine, id("ci")), "play");
  assert.equal(tokensOn(engine, id("ci")), 2);
});

clause(CIRCUITRY, "0:rule", "each Circuitry gets its own 2 tokens (a second copy entering does not change the first)", () => {
  const { engine, id } = circuitryBoard({ zone: "hand", tokens: 0 });
  play(engine, P1, id("ci"), {});
  assert.equal(tokensOn(engine, id("ci")), 2);
  assert.equal(tokensOn(engine, id("ci2")), 0, "the copy already in play keeps its own count");
});

clause(CIRCUITRY, "0:rule", "the tokens are not given again later: a Circuitry already in play does not gain tokens at the start of a turn", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 1 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("ci")), 1);
});

clause(CIRCUITRY, "0:rule", "deploys for its printed cost of 1 with [E][E] (one short or one [E] short is refused) and is a plain item", () => {
  const ok = circuitryBoard({ zone: "hand", elitism: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ci"), {});
  assert.equal(before - ready(ok.engine), 1);
  assert.deepEqual(typesOf(ok.engine, ok.id("ci")), ["item"]);
  const none = circuitryBoard({ zone: "hand", elitism: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("ci")), "no resources");
  const oneE = circuitryBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("ci")), "one [E] is not [E][E]");
});

clause(CIRCUITRY, "1:ability:construct", "CONSTRUCT pays exactly 3, depletes the Circuitry, and removes exactly one token", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(engine.state.cards[id("ci")].depleted, true, "COST: Deplete this card");
  assert.equal(tokensOn(engine, id("ci")), 1, "one of the two tokens was removed");
});

clause(CIRCUITRY, "1:ability:construct", "the 3 and the deplete are paid up front; the token is removed when it resolves", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  const before = ready(engine);
  activateRaw(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3);
  assert.equal(engine.state.cards[id("ci")].depleted, true);
  assert.equal(tokensOn(engine, id("ci")), 2, "not yet");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("ci")), 1);
});

clause(CIRCUITRY, "1:ability:construct", "one use per turn (it depletes): two turns of CONSTRUCT take both tokens", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  activate(engine, P1, id("ci"), "construct");
  assert.throws(() => activateRaw(engine, P1, id("ci"), "construct"), "depleted: not twice in a turn");
  assert.equal(tokensOn(engine, id("ci")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 0);
});

clause(CIRCUITRY, "1:ability:construct", "with no tokens left the cost is still payable and nothing goes negative", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "construct");
  assert.equal(before - ready(engine), 3);
  assert.equal(tokensOn(engine, id("ci")), 0);
});

clause(CIRCUITRY, "1:ability:construct", "is refused with 2 resources (one short); exactly 3 works", () => {
  const short = circuitryBoard({ tokens: 2, elitism: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("ci"), "construct"));
  assert.equal(short.engine.state.cards[short.id("ci")].depleted, false, "a failed payment does not deplete");
  assert.equal(tokensOn(short.engine, short.id("ci")), 2);
  const exact = circuitryBoard({ tokens: 2, elitism: 3 });
  activate(exact.engine, P1, exact.id("ci"), "construct");
  assert.equal(tokensOn(exact.engine, exact.id("ci")), 1);
  assert.equal(ready(exact.engine), 0);
});

clause(CIRCUITRY, "1:ability:construct", "no threshold of its own: 3 resources of any kind pay for it", () => {
  const { engine, id } = circuitryBoard({ tokens: 2, elitism: 0, greed: 3 });
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 1);
});

clause(CIRCUITRY, "1:ability:construct", "only its controller can use it, and only from play", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("ci"), "construct"));
  const inHand = circuitryBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("ci"), "construct"));
});

clause(CIRCUITRY, "2:ability:powerup", "POWER-UP is refused while there are tokens on the Circuitry (1 or 2), allowed with none", () => {
  for (const tokens of [1, 2]) {
    const { engine, id } = circuitryBoard({ tokens });
    assert.throws(() => activateRaw(engine, P1, id("ci"), "powerup"), `${tokens} token(s)`);
    assert.equal(engine.state.cards[id("ci")].depleted, false, "a refused use does not deplete");
  }
  const none = circuitryBoard({ tokens: 0 });
  activate(none.engine, P1, none.id("ci"), "powerup");
  assert.equal(none.engine.state.cards[none.id("ci")].depleted, true, "COST: Deplete this card");
});

clause(CIRCUITRY, "2:ability:powerup", "it costs no resources, only the deplete", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("ci"), "powerup");
  assert.equal(ready(engine), before);
  const free = circuitryBoard({ tokens: 0, elitism: 0 });
  activate(free.engine, P1, free.id("ci"), "powerup");
  assert.equal(free.engine.state.cards[free.id("ci")].depleted, true, "usable with no resources at all");
});

clause(CIRCUITRY, "2:ability:powerup", "after the tokens are constructed away, POWER-UP becomes available", () => {
  const { engine, id } = circuitryBoard({ tokens: 1 });
  assert.throws(() => activateRaw(engine, P1, id("ci"), "powerup"));
  activate(engine, P1, id("ci"), "construct");
  assert.equal(tokensOn(engine, id("ci")), 0);
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("ci"), "powerup");
  assert.equal(engine.state.cards[id("ci")].depleted, true);
});

clause(CIRCUITRY, "2:ability:powerup", "the next numeric cost I pay this turn is up to 3 less: cost 5 pays 2", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  const before = ready(engine);
  play(engine, P1, id("i5"), {});
  assert.equal(zoneOf(engine, id("i5")), "play");
  assert.equal(before - ready(engine), 2, "5 - 3 = 2");
});

clause(CIRCUITRY, "2:ability:powerup", "'up to 3': a cost-2 card is free, a cost-3 card is free, a cost-4 card pays 1", () => {
  for (const [key, paid] of [["i2", 0], ["i3", 0], ["c4", 1]] as const) {
    const { engine, id } = circuitryBoard({ tokens: 0 });
    activate(engine, P1, id("ci"), "powerup");
    const before = ready(engine);
    play(engine, P1, id(key), {});
    assert.equal(before - ready(engine), paid, `${key} pays ${paid}`);
    assert.ok(ready(engine) <= before, "no resource appeared");
  }
});

clause(CIRCUITRY, "2:ability:powerup", "'up to 3 less': POWER-UP asks its controller how much to reduce, a number from 0 to 3, after depleting the card", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("ci"), "powerup");
  assert.equal(engine.state.cards[id("ci")].depleted, true, "COST: Deplete this card");
  const pc = pendingOf(engine);
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
  clause(CIRCUITRY, "2:ability:powerup", `choosing ${value} reduces the next numeric cost by exactly ${value}: a 5-cost item pays ${paid}`, () => {
    const { engine, id } = circuitryBoard({ tokens: 0 });
    activateBase(engine, P1, id("ci"), "powerup");
    answerUpTo(engine, P1, value);
    assert.equal(pendingOf(engine), undefined, "the choice is answered");
    const before = ready(engine);
    play(engine, P1, id("i5"), {});
    assert.equal(zoneOf(engine, id("i5")), "play");
    assert.equal(before - ready(engine), paid);
  });
}

clause(CIRCUITRY, "2:ability:powerup", "the chosen amount also applies to a numeric ability cost I pay: choosing 2 turns 'pay 3' into pay 1", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("ci"), "powerup");
  answerUpTo(engine, P1, 2);
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 1);
});

clause(CIRCUITRY, "2:ability:powerup", "more than 3 (or a negative number) is refused: the choice stays open, and 3 is still accepted", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("ci"), "powerup");
  for (const value of [4, -1]) {
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never),
      /Choose an integer/,
      `${value} is outside 0 to 3`
    );
    assert.equal(pendingOf(engine)?.kind, "chooseNumber", "the choice is still open");
  }
  answerUpTo(engine, P1, 3);
  const before = ready(engine);
  play(engine, P1, id("i5"), {});
  assert.equal(before - ready(engine), 2);
});

clause(CIRCUITRY, "2:ability:powerup", "only the NEXT cost: the second cost-5 item pays the full 5", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  play(engine, P1, id("i5"), {});
  const before = ready(engine);
  play(engine, P1, id("i5b"), {});
  assert.equal(before - ready(engine), 5);
});

clause(CIRCUITRY, "2:ability:powerup", "it does not last past this turn: unused, the reduction is gone on my next turn", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const before = ready(engine);
  play(engine, P1, id("i5"), {});
  assert.equal(before - ready(engine), 5, "no reduction left over");
});

clause(CIRCUITRY, "2:ability:powerup", "it reduces only MY next cost: the opponent's next numeric cost is unchanged", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const before = ready(engine, P2);
  play(engine, P2, id("oppItem"), {});
  assert.equal(before - ready(engine, P2), 4);
});

clause(CIRCUITRY, "2:ability:powerup", "the reduction also applies to a numeric ability cost I pay (pay 3 becomes pay 0; CR 406.5)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("ci"), "powerup");
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 0, "a 'pay 3' ability costs nothing after POWER-UP");
  const next = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(next - ready(engine), 3, "and the next use pays in full");
});

clause(CIRCUITRY, "2:ability:powerup", "cannot be used while depleted; only its controller can use it, and only from play", () => {
  const depleted = circuitryBoard({ tokens: 0, depleted: true });
  assert.throws(() => activateRaw(depleted.engine, P1, depleted.id("ci"), "powerup"));
  const { engine, id } = circuitryBoard({ tokens: 0 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("ci"), "powerup"));
  const inHand = circuitryBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("ci"), "powerup"));
});

// ===============================================================================
// Scavengemajig — Character (majig), cost 4, threshold [E][E][E], 2 strength / 3 speed
// / 1 life.
// When this card enters or leaves play, you may pick an item in your discard pile. If
// you do, put that item into your hand.
// ===============================================================================

const SCAVENGER = "d82edc8c-2381-40fa-bb15-8700a3462775";

function scavengerBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; faceDown?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const other: Pid = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner, zone: opts.zone ?? "hand", faceDown: opts.faceDown },
      { key: "sm2", def: printing(SCAVENGER), owner, zone: "hand" },
      { key: "dItem1", def: item({ name: "DiscItem1" }), owner, zone: "discard" },
      { key: "dItem2", def: item({ name: "DiscItem2", subtype: ["gear"] }), owner, zone: "discard" },
      { key: "dChar", def: character({ name: "DiscChar" }), owner, zone: "discard" },
      { key: "dTac", def: tactic({ name: "DiscTac" }), owner, zone: "discard" },
      { key: "dLoc", def: location({ name: "DiscLoc" }), owner, zone: "discard" },
      { key: "oItem", def: item({ name: "OppDiscItem" }), owner: other, zone: "discard" },
      { key: "hItem", def: item({ name: "HandItem" }), owner, zone: "hand" },
      { key: "kItem", def: item({ name: "DeckItem" }), owner, zone: "deck" },
      { key: "pItem", def: item({ name: "PlayItem" }), owner, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: other, zone: "play" },
      { key: "killRes", def: sendTactic("destroy", "resource"), owner, zone: "hand" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

clause(SCAVENGER, "0:rule", "entering play: I am offered a pick of an item in my discard pile; picking one puts it into my hand", () => {
  const { engine, id } = scavengerBoard();
  const handBefore = [...hand(engine, P1)];
  play(engine, P1, id("sm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Scavengemajig's controller picks");
  pick(engine, P1, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.deepEqual(hand(engine, P1), [...handBefore.filter((c) => c !== id("sm")), id("dItem1")], "exactly that item joined my hand");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SCAVENGER, "0:rule", "entering play: it is a 'may': I can pick nothing and the discard pile is untouched", () => {
  const { engine, id } = scavengerBoard();
  const discardBefore = [...discard(engine, P1)];
  play(engine, P1, id("sm"), {});
  pick(engine, P1, []);
  assert.deepEqual(discard(engine, P1), discardBefore);
  assert.equal(zoneOf(engine, id("sm")), "play", "it still enters play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SCAVENGER, "0:rule", "only an ITEM can be picked: a character, a tactic and a location in the discard pile are refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  for (const key of ["dChar", "dTac", "dLoc"]) assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not an item`);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting");
  pick(engine, P1, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem2")), "hand", "control: an item (any subtype) is accepted");
});

clause(SCAVENGER, "0:rule", "only MY discard pile: the opponent's discard pile, my hand, my deck and items in play are refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  for (const key of ["oItem", "hItem", "kItem", "pItem"]) assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not in my discard pile`);
  pick(engine, P1, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("oItem")), "discard", "their discard pile is untouched");
});

clause(SCAVENGER, "0:rule", "only one item: picking two is refused", () => {
  const { engine, id } = scavengerBoard();
  play(engine, P1, id("sm"), {});
  assert.throws(() => pick(engine, P1, [id("dItem1"), id("dItem2")]));
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
  pick(engine, P1, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem1")), "discard", "the other item stays");
});

clause(SCAVENGER, "0:rule", "with no item in my discard pile nothing happens on entering (no other card moves)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "hand" },
      { key: "dChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "oItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("sm"), {});
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(zoneOf(engine, id("dChar")), "discard");
  assert.equal(zoneOf(engine, id("oItem")), "discard");
});

clause(SCAVENGER, "0:rule", "leaving play (destroyed): I am offered the same pick and the item goes to my hand", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  const handBefore = [...hand(engine, P1)];
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard");
  const pc = pendingOf(engine);
  assert.ok(pc, "a pick is offered when it leaves play");
  assert.equal(pc.playerId, P1);
  assert.throws(() => pick(engine, P1, [id("dChar")]), "not an item");
  pick(engine, P1, [id("dItem1")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.deepEqual(hand(engine, P1), [...handBefore.filter((c) => c !== id("sendDestroy")), id("dItem1")]);
});

clause(SCAVENGER, "0:rule", "leaving play: it is a 'may' too, and I can pick nothing", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("sm")] } });
  pick(engine, P1, []);
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
  assert.equal(zoneOf(engine, id("dItem2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

for (const [key, label] of [
  ["sendDestroy", "destroyed"],
  ["sendHand", "returned to hand"],
  ["sendDeck", "put into the deck"],
  ["sendDiscard", "put into the discard pile"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(SCAVENGER, "0:rule", `leaving play by being ${label} triggers the pick`, () => {
    const { engine, id } = scavengerBoard({ zone: "play" });
    play(engine, P1, id(key), { selected: { t: [id("sm")] } });
    assert.notEqual(zoneOf(engine, id("sm")), "play");
    assert.ok(pendingOf(engine), `a pick is offered when it is ${label}`);
    pick(engine, P1, [id("dItem1")]);
    assert.equal(zoneOf(engine, id("dItem1")), "hand");
  });
}

/** Battle auto-resolution stops on a pending choice; answer a 'pick' by taking nothing and keep going. */
function drainBattleWithPick(engine: SpoilsEngine, selected: string[] = []) {
  let guard = 0;
  while ((engine.state.pendingChoice || engine.state.battle) && guard++ < 10) {
    if (engine.state.pendingChoice) {
      engine.perform({ type: "resolvePendingChoice", playerId: engine.state.pendingChoice.playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
      resolvePendingResponses(engine);
    } else {
      autoResolveBattle(engine);
    }
  }
}

clause(SCAVENGER, "0:rule", "dying in battle also triggers the leaves-play pick", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "dItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" }
    ]
  });
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("sm")] });
  autoResolveBattle(engine);
  assert.equal(pendingOf(engine)?.playerId, P1, "I am offered the pick when it dies");
  drainBattleWithPick(engine, [id("dItem")]);
  assert.equal(zoneOf(engine, id("sm")), "discard", "3 damage kills the 1-life Scavengemajig");
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(SCAVENGER, "0:rule", "it does not trigger for other cards: another character entering or leaving play gives no prompt", () => {
  const { engine, id } = scavengerBoard({ zone: "play" });
  play(engine, P1, id("plain"), {});
  assert.equal(engine.state.pendingChoice, undefined, "another character entering play");
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("plain")] } });
  assert.equal(engine.state.pendingChoice, undefined, "another character leaving play");
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
});

clause(SCAVENGER, "0:rule", "each Scavengemajig triggers on its own: two entering give two picks", () => {
  const { engine, id } = scavengerBoard({ elitism: 8 });
  play(engine, P1, id("sm"), {});
  pick(engine, P1, [id("dItem1")]);
  play(engine, P1, id("sm2"), {});
  pick(engine, P1, [id("dItem2")]);
  assert.equal(zoneOf(engine, id("dItem1")), "hand");
  assert.equal(zoneOf(engine, id("dItem2")), "hand");
});

clause(SCAVENGER, "0:rule", "a face-down Scavengemajig is only a resource: it gives no prompt when it leaves play", () => {
  const { engine, id } = scavengerBoard({ zone: "play", faceDown: true });
  play(engine, P1, id("killRes"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard", "the face-down card was destroyed");
  assert.equal(engine.state.pendingChoice, undefined, "a face-down card has no triggered ability (RULES.md 2)");
  assert.equal(zoneOf(engine, id("dItem1")), "discard");
});

clause(SCAVENGER, "0:rule", "an opponent-controlled Scavengemajig lets THEM pick an item from THEIR discard pile", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P2, zone: "hand" },
      { key: "mine", def: item({ name: "MyDisc" }), owner: P1, zone: "discard" },
      { key: "theirs", def: item({ name: "TheirDisc" }), owner: P2, zone: "discard" },
      ...bank("elitism", 4, P2)
    ]
  });
  play(engine, P2, id("sm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  assert.throws(() => pick(engine, P2, [id("mine")]), "not their discard pile");
  pick(engine, P2, [id("theirs")]);
  assert.equal(zoneOf(engine, id("theirs")), "hand");
  assert.equal(hand(engine, P2).includes(id("theirs")), true);
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(SCAVENGER, "0:rule", "it also triggers when put into play by an effect rather than deployed", () => {
  const revive = tactic({
    name: "ReviveChar",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SCAVENGER), owner: P1, zone: "discard" },
      { key: "revive", def: revive, owner: P1, zone: "hand" },
      { key: "dItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" }
    ]
  });
  play(engine, P1, id("revive"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.ok(pendingOf(engine), "'enters play' includes being put into play");
  pick(engine, P1, [id("dItem")]);
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(SCAVENGER, "0:rule", "deploys for its printed cost of 4 with [E][E][E] (one short or one [E] short is refused) and has its printed 2/1/3 stats", () => {
  const { engine, id } = scavengerBoard({ elitism: 3, greed: 1 });
  const before = ready(engine);
  play(engine, P1, id("sm"), {});
  pick(engine, P1, []);
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("sm")), [2, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("sm")), ["majig"]);
  assert.equal(engine.getDefinition(id("sm")).trade, "gearsmith");
  const short = scavengerBoard({ elitism: 3, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sm")), "3 resources is one short of 4");
  const twoE = scavengerBoard({ elitism: 2, greed: 5 });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("sm")), "two [E] is one short of [E][E][E]");
});

// ===============================================================================
// Slingerang — Item (gearsmith), cost 2, threshold [E][E].
// This card enters play with 3 tokens on it.
// If your opponent plays a character, you may remove a token from this card.
// CHEAP SHOT -- COST: Use this only if no tokens are on this card and only if your
// opponent played a character this turn. Destroy this card. Pick a character. --
// EFFECT: Destroy the character.
// ===============================================================================

const SLINGERANG = "1760cfe7-261b-4f7a-a5c8-b37ff52099a1";

function slingBoard(opts: { zone?: "hand" | "play" | "discard"; tokens?: number; elitism?: number; greed?: number; active?: Pid; owner?: Pid; turn?: number } = {}) {
  const owner = opts.owner ?? P1;
  const other: Pid = owner === P1 ? P2 : P1;
  const revive = tactic({
    name: "ReviveItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "item" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const putChar = tactic({
    name: "PutCharacter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? other,
    turn: opts.turn ?? 2,
    cards: [
      { key: "sg", def: printing(SLINGERANG), owner, zone: opts.zone ?? "play", counters: opts.tokens !== undefined && opts.tokens > 0 ? { token: opts.tokens } : {} },
      { key: "revive", def: revive, owner, zone: "hand" },
      { key: "dSling", def: printing(SLINGERANG), owner, zone: "discard" },
      // the player on the other side (usually the active one)
      { key: "foeChar", def: character({ name: "FoeChar", cost: 0, strength: 1, life: 5 }), owner: other, zone: "hand" },
      { key: "foeChar2", def: character({ name: "FoeChar2", cost: 0, strength: 1, life: 5 }), owner: other, zone: "hand" },
      { key: "foeItem", def: item({ name: "FoeItem", cost: 0 }), owner: other, zone: "hand" },
      { key: "foeTac", def: tactic({ name: "FoeTac", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: other, zone: "hand" },
      { key: "foeOpener", def: tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: other, zone: "hand" },
      { key: "foeRevivable", def: character({ name: "FoeRevivable" }), owner: other, zone: "discard" },
      { key: "foeRevive", def: putChar, owner: other, zone: "hand" },
      { key: "foeInPlay", def: character({ name: "FoeInPlay", life: 5 }), owner: other, zone: "play" },
      { key: "mineInPlay", def: character({ name: "MineInPlay", life: 5 }), owner, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar", cost: 0 }), owner, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: other, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...bank("elitism", 4, other)
    ]
  });
}

clause(SLINGERANG, "0:rule", "it enters play with exactly 3 tokens (deployed from hand)", () => {
  const { engine, id } = slingBoard({ zone: "hand", active: P1, turn: 1 });
  assert.equal(tokensOn(engine, id("sg")), 0);
  play(engine, P1, id("sg"), {});
  assert.equal(zoneOf(engine, id("sg")), "play");
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "0:rule", "it enters play with 3 tokens when put into play by an effect too", () => {
  const { engine, id } = slingBoard({ zone: "discard", active: P1, turn: 1 });
  play(engine, P1, id("revive"), { selected: { t: [id("sg")] } });
  assert.equal(zoneOf(engine, id("sg")), "play");
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "0:rule", "each Slingerang gets its own 3 tokens: a second one entering does not touch the first", () => {
  const { engine, id } = slingBoard({ zone: "play", tokens: 1, active: P1, turn: 1 });
  play(engine, P1, id("revive"), { selected: { t: [id("dSling")] } });
  assert.equal(tokensOn(engine, id("dSling")), 3);
  assert.equal(tokensOn(engine, id("sg")), 1, "the first keeps its own count");
});

clause(SLINGERANG, "0:rule", "deploys for its printed cost of 2 with [E][E] (one short or one [E] short is refused) and is a plain item", () => {
  const ok = slingBoard({ zone: "hand", active: P1, turn: 1, elitism: 2 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("sg"), {});
  assert.equal(before - ready(ok.engine), 2);
  assert.deepEqual(typesOf(ok.engine, ok.id("sg")), ["item"]);
  const short = slingBoard({ zone: "hand", active: P1, turn: 1, elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sg")), "one resource short");
  const oneE = slingBoard({ zone: "hand", active: P1, turn: 1, elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("sg")), "one [E] is not [E][E]");
});

clause(SLINGERANG, "1:rule", "when my opponent plays a character I am offered the choice; accepting removes exactly one token", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  play(engine, P2, id("foeChar"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a choice is offered");
  assert.equal(pc.playerId, P1, "to the Slingerang's controller");
  answerMay(engine, P1, true);
  assert.equal(tokensOn(engine, id("sg")), 2, "one token removed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SLINGERANG, "1:rule", "it is a 'may': declining leaves all the tokens", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  play(engine, P2, id("foeChar"), {});
  answerMay(engine, P1, false);
  assert.equal(tokensOn(engine, id("sg")), 3);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeChar")), "play", "the character still entered play");
});

clause(SLINGERANG, "1:rule", "each opponent character played is another chance: two plays can take two tokens", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  play(engine, P2, id("foeChar"), {});
  answerMay(engine, P1, true);
  play(engine, P2, id("foeChar2"), {});
  answerMay(engine, P1, true);
  assert.equal(tokensOn(engine, id("sg")), 1);
});

clause(SLINGERANG, "1:rule", "with no tokens left nothing goes negative", () => {
  const { engine, id } = slingBoard({ tokens: 0 });
  play(engine, P2, id("foeChar"), {});
  if (engine.state.pendingChoice) answerMay(engine, P1, true);
  assert.equal(tokensOn(engine, id("sg")), 0);
});

clause(SLINGERANG, "1:rule", "only when the OPPONENT plays a character: my own character gives no prompt", () => {
  const { engine, id } = slingBoard({ tokens: 3, active: P1, turn: 1 });
  play(engine, P1, id("myChar"), {});
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "1:rule", "only a CHARACTER: the opponent playing an item or a tactic gives no prompt", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  play(engine, P2, id("foeItem"), {});
  assert.equal(engine.state.pendingChoice, undefined, "an item");
  play(engine, P2, id("foeTac"), {});
  assert.equal(engine.state.pendingChoice, undefined, "a tactic");
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "1:rule", "'plays' is not 'puts into play': a character the opponent puts into play with an effect gives no prompt", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  play(engine, P2, id("foeRevive"), { selected: { t: [id("foeRevivable")] } });
  assert.equal(zoneOf(engine, id("foeRevivable")), "play", "the effect did put the character into play");
  assert.equal(engine.state.pendingChoice, undefined, "it was never played, so Slingerang's trigger does not fire");
});

clause(SLINGERANG, "1:rule", "a token the opponent creates is not a played character either", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "sg", def: printing(SLINGERANG), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "mk", def: makeTokensTactic(1, "controller"), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P2, id("mk"), {});
  assert.equal(micromajigs(engine, P2).length, 1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "1:rule", "a card the opponent puts face-down as a resource is not a played character", () => {
  const { engine, id } = slingBoard({ tokens: 3 });
  developPlay(engine, P2, id("foeChar"), true);
  assert.equal(zoneOf(engine, id("foeChar")), "play");
  assert.equal(engine.state.cards[id("foeChar")].faceDown, true);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("sg")), 3);
});

clause(SLINGERANG, "1:rule", "it needs the Slingerang in play: a Slingerang in my hand or discard pile gives no prompt", () => {
  const inHand = slingBoard({ zone: "hand" });
  play(inHand.engine, P2, inHand.id("foeChar"), {});
  assert.equal(inHand.engine.state.pendingChoice, undefined);
  const inDiscard = slingBoard({ zone: "discard" });
  play(inDiscard.engine, P2, inDiscard.id("foeChar"), {});
  assert.equal(inDiscard.engine.state.pendingChoice, undefined);
});

clause(SLINGERANG, "1:rule", "an opponent-controlled Slingerang watches MY characters: it prompts THEM when I play one", () => {
  const { engine, id } = slingBoard({ owner: P2, tokens: 3, active: P1, turn: 1 });
  play(engine, P1, id("foeChar"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "their Slingerang prompts its controller");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(tokensOn(engine, id("sg")), 2);
});

// --- CHEAP SHOT

/** The opponent (P2, active) plays a character, and then starts an action that I may respond to. Slingerang has `tokens` tokens. */
function cheapShotSetup(opts: { tokens?: number; elitism?: number } = {}) {
  const board = slingBoard({ tokens: opts.tokens ?? 0, elitism: opts.elitism });
  const { engine, id } = board;
  play(engine, P2, id("foeChar"), {});
  if (engine.state.pendingChoice) answerMay(engine, P1, false);
  playRaw(engine, P2, id("foeOpener"));
  return board;
}

clause(SLINGERANG, "2:ability:cheapshot", "with no tokens, after my opponent played a character this turn: destroys itself as a cost, then destroys the picked character", () => {
  const { engine, id } = cheapShotSetup();
  activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } });
  assert.equal(zoneOf(engine, id("sg")), "discard", "COST: Destroy this card (already, while the ability waits)");
  assert.equal(zoneOf(engine, id("foeChar")), "play", "the character is destroyed only when the ability resolves");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeChar")), "discard", "EFFECT: Destroy the character");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeInPlay")), "play", "no other character is destroyed");
  assert.equal(zoneOf(engine, id("mineInPlay")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "the character can be any character, not only the one that was played: theirs already in play, or even my own", () => {
  const theirs = cheapShotSetup();
  activateRaw(theirs.engine, P1, theirs.id("sg"), "cheapshot", { selected: { c: [theirs.id("foeInPlay")] } });
  resolvePendingResponses(theirs.engine);
  assert.equal(zoneOf(theirs.engine, theirs.id("foeInPlay")), "discard");
  assert.equal(zoneOf(theirs.engine, theirs.id("foeChar")), "play", "the one they played is untouched");
  const mine = cheapShotSetup();
  activateRaw(mine.engine, P1, mine.id("sg"), "cheapshot", { selected: { c: [mine.id("mineInPlay")] } });
  resolvePendingResponses(mine.engine);
  assert.equal(zoneOf(mine.engine, mine.id("mineInPlay")), "discard", "my own character is a legal pick");
});

clause(SLINGERANG, "2:ability:cheapshot", "only a character can be picked: an item, a faction and a card in hand are refused", () => {
  const { engine, id } = cheapShotSetup();
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("foeChar2")), "a character in their hand");
  assert.throws(attempt(id("sg")), "the Slingerang itself");
  assert.equal(zoneOf(engine, id("sg")), "play", "refused attempts did not destroy it");
  attempt(id("foeChar"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(SLINGERANG, "2:ability:cheapshot", "exactly one character: none or two is refused", () => {
  const { engine, id } = cheapShotSetup();
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [] } }));
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar"), id("foeInPlay")] } }));
  assert.equal(zoneOf(engine, id("sg")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "refused while ANY token is on it (1 or 3), even though the opponent played a character", () => {
  for (const tokens of [1, 3]) {
    const { engine, id } = cheapShotSetup({ tokens });
    assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } }), `${tokens} token(s)`);
    assert.equal(zoneOf(engine, id("sg")), "play");
    assert.equal(zoneOf(engine, id("foeChar")), "play");
  }
});

clause(SLINGERANG, "2:ability:cheapshot", "refused when my opponent has not played a character this turn, even with no tokens", () => {
  const { engine, id } = slingBoard({ tokens: 0 });
  playRaw(engine, P2, id("foeOpener"));
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeInPlay")] } }));
  assert.equal(zoneOf(engine, id("sg")), "play");
  assert.equal(zoneOf(engine, id("foeInPlay")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "an opponent's item or tactic is not a character: playing those does not enable it", () => {
  const { engine, id } = slingBoard({ tokens: 0 });
  play(engine, P2, id("foeItem"), {});
  play(engine, P2, id("foeTac"), {});
  playRaw(engine, P2, id("foeOpener"));
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeInPlay")] } }));
});

clause(SLINGERANG, "2:ability:cheapshot", "MY playing a character does not enable it: it has to be my opponent's", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 1,
    cards: [
      { key: "sg", def: printing(SLINGERANG), owner: P1, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("myChar"), {});
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foe")] } }), "I played a character, not my opponent");
  assert.equal(zoneOf(engine, id("sg")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "'this turn': a character played on the opponent's last turn does not count on their next turn", () => {
  const { engine, id } = slingBoard({ tokens: 0 });
  play(engine, P2, id("foeChar"), {});
  if (engine.state.pendingChoice) answerMay(engine, P1, false);
  endTurn(engine, P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  playRaw(engine, P2, id("foeOpener"));
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } }), "they played nothing this turn");
  assert.equal(zoneOf(engine, id("sg")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "'this turn': on my own turn it does not work off the opponent's earlier character", () => {
  const { engine, id } = slingBoard({ tokens: 0 });
  play(engine, P2, id("foeChar"), {});
  if (engine.state.pendingChoice) answerMay(engine, P1, false);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.throws(() => activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } }), "it was their turn, not this one");
  assert.equal(zoneOf(engine, id("sg")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "it costs no resources", () => {
  const { engine, id } = cheapShotSetup();
  const before = ready(engine);
  activateRaw(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } });
  assert.equal(ready(engine), before);
  const none = cheapShotSetup({ elitism: 0 });
  assert.equal(ready(none.engine), 0, "no resources at all");
  activateRaw(none.engine, P1, none.id("sg"), "cheapshot", { selected: { c: [none.id("foeChar")] } });
  resolvePendingResponses(none.engine);
  assert.equal(zoneOf(none.engine, none.id("foeChar")), "discard", "usable with no resources at all");
});

clause(SLINGERANG, "2:ability:cheapshot", "only its controller can use it, and only from play", () => {
  const { engine, id } = cheapShotSetup();
  assert.throws(() => activateRaw(engine, P2, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } }), "the opponent cannot use my Slingerang");
  assert.equal(zoneOf(engine, id("sg")), "play");
  const inHand = slingBoard({ zone: "hand", tokens: 0 });
  play(inHand.engine, P2, inHand.id("foeChar"), {});
  playRaw(inHand.engine, P2, inHand.id("foeOpener"));
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("sg"), "cheapshot", { selected: { c: [inHand.id("foeChar")] } }));
});

clause(SLINGERANG, "2:ability:cheapshot", "the destroyed Slingerang goes to its owner's discard pile", () => {
  const { engine, id } = cheapShotSetup();
  activate(engine, P1, id("sg"), "cheapshot", { selected: { c: [id("foeChar")] } });
  assert.equal(discard(engine, P1).includes(id("sg")), true);
});

// ===============================================================================
// Spiky Atlasphere — Item (gear), cost 2, threshold [E][E]. ATTACH TO CHARACTER.
// The attached character gains 1 strength.
// When an attacking party is formed that includes the attached character, it must
// have only 1 member.
// If the attached character is blocked, destroy all members of the blocking party.
// The attached character inflicts no damage this battle.
// ===============================================================================

const SPIKY = "9ea55dc6-c610-42f3-b680-ab2d0e24bb99";

/** A free tactic that restores one chosen character (ability id `r`, declaration `t`). */
function restoreTactic(): CardDefinition {
  return tactic({
    name: "Restore",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });
}

function spikyBoard(opts: { zone?: "hand" | "play"; attachedTo?: string; elitism?: number; greed?: number; owner?: Pid; active?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "sp", def: printing(SPIKY), owner, zone: opts.zone ?? "hand", attachedToKey: opts.zone === "play" ? opts.attachedTo ?? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate2", def: character({ name: "Mate2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeA", def: character({ name: "FoeA", strength: 1, life: 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeB", def: character({ name: "FoeB", strength: 1, life: 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeC", def: character({ name: "FoeC", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "restore", def: restoreTactic(), owner: P1, zone: "hand" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "killItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "remove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "toDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const attachedTo = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]?.attachedTo;

clause(SPIKY, "0:attach", "deploys for 2 with [E][E], picking a character as the first extra cost: it enters play attached to that character", () => {
  const { engine, id } = spikyBoard();
  const before = ready(engine);
  play(engine, P1, id("sp"), { selected: { attachTo: [id("host")] } });
  assert.equal(zoneOf(engine, id("sp")), "play");
  assert.equal(attachedTo(engine, id("sp")), id("host"), "attached to the chosen character");
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(attachedTo(engine, id("mate")), undefined);
});

clause(SPIKY, "0:attach", "it can attach to an opponent's character too", () => {
  const { engine, id } = spikyBoard();
  play(engine, P1, id("sp"), { selected: { attachTo: [id("foeA")] } });
  assert.equal(attachedTo(engine, id("sp")), id("foeA"));
  assert.equal(engine.state.cards[id("sp")].controllerId, P1, "I still control it");
});

clause(SPIKY, "0:attach", "only a character can be the host: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = spikyBoard();
  const attempt = (picked: string) => () => playRaw(engine, P1, id("sp"), { selected: { attachTo: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "face-down");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.equal(zoneOf(engine, id("sp")), "hand");
  assert.equal(ready(engine), 6, "nothing was spent");
  attempt(id("host"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(SPIKY, "0:attach", "exactly one host: none or two is refused; with no character in play it cannot be played", () => {
  const { engine, id } = spikyBoard();
  assert.throws(() => playRaw(engine, P1, id("sp"), { selected: { attachTo: [] } }));
  assert.throws(() => playRaw(engine, P1, id("sp"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("sp"), { selected: { attachTo: [id("host"), id("mate")] } }));
  const empty = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sp", def: printing(SPIKY), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
  });
  assert.throws(() => playRaw(empty.engine, P1, empty.id("sp"), { selected: {} }), "no character in play to attach to");
  assert.equal(zoneOf(empty.engine, empty.id("sp")), "hand");
});

clause(SPIKY, "0:attach", "is refused one resource short (1 of 2) and without [E][E]", () => {
  const short = spikyBoard({ elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sp"), { selected: { attachTo: [short.id("host")] } }));
  const oneE = spikyBoard({ elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("sp"), { selected: { attachTo: [oneE.id("host")] } }), "one [E] is not [E][E]");
  const exact = spikyBoard({ elitism: 2 });
  play(exact.engine, P1, exact.id("sp"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(attachedTo(exact.engine, exact.id("sp")), exact.id("host"));
});

clause(SPIKY, "0:attach", "is a gear item with no stats of its own", () => {
  const { engine, id } = spikyBoard();
  play(engine, P1, id("sp"), { selected: { attachTo: [id("host")] } });
  assert.deepEqual(typesOf(engine, id("sp")), ["item"]);
  assert.deepEqual(engine.getSubtypes(id("sp")), ["gear"]);
});

clause(SPIKY, "0:attach", "when the host is destroyed the Spiky Atlasphere is destroyed with it (CR 301.4)", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("sp")), "discard", "it leaves play the same way");
});

clause(SPIKY, "0:attach", "when the host is returned to its owner's hand the Spiky Atlasphere leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("sp")), "hand", "put into its owner's hand like the host");
});

clause(SPIKY, "0:attach", "when the host is removed from the game the Spiky Atlasphere is removed from the game the same way (CR 301.4a)", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  play(engine, P1, id("remove"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "removed");
  assert.equal(zoneOf(engine, id("sp")), "removed", "removed from the game with the host");
});

clause(SPIKY, "0:attach", "when the host is put into its owner's deck the Spiky Atlasphere is put into its owner's deck the same way (CR 301.4a)", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  play(engine, P1, id("toDeck"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "deck");
  assert.equal(zoneOf(engine, id("sp")), "deck", "put into the deck with the host");
});

clause(SPIKY, "0:attach", "if the host stops being a character the Spiky Atlasphere is flipped face-down with it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pb", def: printing(POGO), owner: P1, zone: "play" },
      { key: "sp", def: printing(SPIKY), owner: P1, zone: "hand" },
      ...bank("elitism", 6, P1)
    ]
  });
  activate(engine, P1, id("pb"), "raar");
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
  // Spiky can only be on a character, so it is deployed once the Pogo-Bunny is one (an unattached ATTACH TO card is not a legal state).
  play(engine, P1, id("sp"), { selected: { attachTo: [id("pb")] } });
  assert.equal(zoneOf(engine, id("sp")), "play", "attached to the animated Pogo-Bear");
  activate(engine, P1, id("pb"), "hide");
  assert.equal(isCharacter(engine, id("pb")), false);
  assert.equal(zoneOf(engine, id("sp")), "discard", "no longer attached to a character: destroyed");
});

clause(SPIKY, "1:rule", "the attached character gains exactly 1 strength (and nothing else)", () => {
  const { engine, id } = spikyBoard();
  assert.deepEqual(stat(engine, id("host")), [2, 4, 2]);
  play(engine, P1, id("sp"), { selected: { attachTo: [id("host")] } });
  assert.deepEqual(stat(engine, id("host")), [3, 4, 2], "+1 strength only");
  assert.deepEqual(stat(engine, id("mate")), [1, 3, 2], "another character is unchanged");
  assert.deepEqual(stat(engine, id("foeA")), [1, 10, 2], "an opponent's character is unchanged");
});

clause(SPIKY, "1:rule", "an opponent's character it is attached to gains the strength", () => {
  const { engine, id } = spikyBoard();
  play(engine, P1, id("sp"), { selected: { attachTo: [id("foeA")] } });
  assert.deepEqual(stat(engine, id("foeA")), [2, 10, 2]);
  assert.deepEqual(stat(engine, id("host")), [2, 4, 2]);
});

clause(SPIKY, "1:rule", "the strength goes away when the Spiky Atlasphere leaves play", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  assert.equal(engine.getStat(id("host"), "strength"), 3);
  play(engine, P1, id("killItem"), { selected: { t: [id("sp")] } });
  assert.equal(engine.getStat(id("host"), "strength"), 2);
});

clause(SPIKY, "1:rule", "two Spiky Atlaspheres on one character stack: +2 strength", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sp1", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "sp2", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  assert.equal(engine.getStat(id("host"), "strength"), 4);
});

clause(SPIKY, "2:rule", "an attacking party that includes the attached character must have only 1 member: host + another is refused", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  assert.throws(() => declareAttackBy(engine, P1, [id("host"), id("mate")]), "two members");
  assert.throws(() => declareAttackBy(engine, P1, [id("host"), id("mate"), id("mate2")]), "three members");
  assert.equal(battleOf(engine), undefined, "no battle was started");
  declareAttackBy(engine, P1, [id("host")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("host")], "control: the host alone may attack");
});

clause(SPIKY, "2:rule", "a party WITHOUT the attached character can have any number of members", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  declareAttackBy(engine, P1, [id("mate"), id("mate2")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(SPIKY, "2:rule", "without the Spiky Atlasphere the host can attack in a party (control)", () => {
  const { engine, id } = spikyBoard({ zone: "hand" });
  declareAttackBy(engine, P1, [id("host"), id("mate")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(SPIKY, "2:rule", "the restriction is on ATTACKING parties: the attached character may be part of a blocking party of several", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "sp", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 10, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("host"), id("mate")] });
  assert.equal(battleOf(engine)?.blockingParty.length, 2, "a blocking party of 2 that includes the host");
});

clause(SPIKY, "2:rule", "the restriction follows the attached character, whoever controls the Spiky: an opponent's host must attack alone", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "foeHost", def: character({ name: "FoeHost", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeMate", def: character({ name: "FoeMate", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "sp", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "foeHost" }
    ]
  });
  assert.throws(() => declareAttackBy(engine, P2, [id("foeHost"), id("foeMate")]));
  declareAttackBy(engine, P2, [id("foeHost")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("foeHost")]);
});

clause(SPIKY, "3:rule", "blocked by one character: that blocker is destroyed (however much life it has) and the host inflicts no damage", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("foeA")]);
  assert.equal(zoneOf(engine, id("foeA")), "discard", "the 10-life blocker was destroyed");
  assert.equal(engine.state.players[P2].influence, 30, "the host inflicted no damage to the faction either");
  assert.equal(engine.state.cards[id("host")].damage, 0, "the host took no damage");
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(zoneOf(engine, id("foeB")), "play", "a character that did not block is untouched");
});

clause(SPIKY, "3:rule", "blocked by several characters: ALL members of the blocking party are destroyed", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("foeA"), id("foeB")]);
  assert.equal(zoneOf(engine, id("foeA")), "discard");
  assert.equal(zoneOf(engine, id("foeB")), "discard");
  assert.equal(zoneOf(engine, id("foeC")), "play", "the character that did not block survives");
  assert.equal(engine.state.players[P2].influence, 30);
});

clause(SPIKY, "3:rule", "the destroyed blockers go to their owner's discard pile", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("foeA")]);
  assert.equal(discard(engine, P2).includes(id("foeA")), true);
});

clause(SPIKY, "3:rule", "the host inflicts no damage to a BLOCKER either (the blocker is destroyed, not damaged)", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  declareAttackBy(engine, P1, [id("host")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeA")] });
  assert.equal(zoneOf(engine, id("foeA")), "discard", "destroyed as soon as it blocks");
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("foeA")]?.damage ?? 0, 0);
});

clause(SPIKY, "3:rule", "if the host is NOT blocked it deals its damage normally: 3 (2 + 1) to the faction", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.players[P2].influence, 30 - 3);
  assert.equal(zoneOf(engine, id("foeA")), "play");
});

clause(SPIKY, "3:rule", "an attacker WITHOUT the Spiky Atlasphere that is blocked behaves normally: the blocker is not destroyed", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("mate")], { type: "faction", playerId: P2 }, [id("foeA")]);
  assert.equal(zoneOf(engine, id("foeA")), "play");
  assert.equal(engine.state.cards[id("foeA")].damage, 1, "the Mate dealt its 1 damage to the blocker");
});

clause(SPIKY, "3:rule", "when the attached character BLOCKS, nothing special happens: it deals its 3 damage and the attacker is not destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sp", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 10, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, [id("host")]);
  assert.equal(zoneOf(engine, id("foe")), "play", "the attacker is not destroyed by the Spiky Atlasphere");
  assert.equal(engine.state.cards[id("foe")].damage, 3, "the blocking host dealt 3 damage");
});

clause(SPIKY, "3:rule", "an opponent's attached character that I block: MY blockers are destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "foeHost", def: character({ name: "FoeHost", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "sp", def: printing(SPIKY), owner: P1, zone: "play", attachedToKey: "foeHost" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 10, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foeHost")], { type: "faction", playerId: P1 }, [id("blocker")]);
  assert.equal(zoneOf(engine, id("blocker")), "discard", "the blocker of the attached character is destroyed");
  assert.equal(engine.state.players[P1].influence, 30);
});

clause(SPIKY, "3:rule", "'this battle' only: after the host is restored, an unblocked second attack deals its damage normally", () => {
  const { engine, id } = spikyBoard({ zone: "play" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("foeA")]);
  assert.equal(engine.state.players[P2].influence, 30);
  play(engine, P1, id("restore"), { selected: { t: [id("host")] } });
  assert.equal(engine.state.cards[id("host")].depleted, false, "restored");
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.players[P2].influence, 30 - 3, "it inflicts its damage in a later battle");
});

// ===============================================================================
// Subversion Matrix — Item (gear), cost 2, threshold [E].
// Treat the attached character as though it has no rules text. (This includes
// abilities.)
// MOVE -- COST: Pay 2. Pick a character. -- EFFECT: Attach this card to the character.
// ===============================================================================

const MATRIX = "66044076-6088-4eba-ab7d-5319ee1db663";

/** A character with a keyword, an activated ability (`act`: +3 influence), a self-stat continuous rule, and a triggered rule (+2 influence whenever another character enters play). */
function rulefulCharacter(name: string): CardDefinition {
  return character({
    name,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "act", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] },
        { id: "bulk", type: "continuous", modifiers: [{ target: "source", stat: "life", operation: "add", value: 2 }] },
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "not", condition: { type: "sourceIsEventCard" } },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
        }
      ]
    }
  });
}

function matrixBoard(opts: { zone?: "hand" | "play"; attachedTo?: string; elitism?: number; greed?: number; owner?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "mx", def: printing(MATRIX), owner, zone: opts.zone ?? "play", attachedToKey: opts.zone === "hand" ? undefined : opts.attachedTo },
      { key: "ruleA", def: rulefulCharacter("RulefulA"), owner: P1, zone: "play" },
      { key: "ruleB", def: rulefulCharacter("RulefulB"), owner: P1, zone: "play" },
      { key: "foeRule", def: rulefulCharacter("FoeRuleful"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "killItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const influence = (engine: SpoilsEngine, player: Pid = P1) => engine.state.players[player].influence;

clause(MATRIX, "0:rule", "control: a character with no Matrix on it uses its rules text: keyword, ability, extra life, trigger", () => {
  const { engine, id } = matrixBoard();
  assert.ok(engine.getKeywords(id("ruleA")).includes("covert"), "engine.getKeywords(id(\"ruleA\")).includes(\"covert\")");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "its own continuous rule: +2 life");
  const before = influence(engine);
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(influence(engine) - before, 3, "its activated ability works");
  const beforeTrig = influence(engine);
  play(engine, P1, id("plain"), {});
  drain(engine, declineAll);
  assert.equal(influence(engine) - beforeTrig, 4, "both of my Ruleful characters' triggers fire for the newcomer (+2 each)");
});

clause(MATRIX, "0:rule", "an unattached Matrix (just deployed) changes nothing: no host, no suppression", () => {
  const { engine, id } = matrixBoard({ zone: "hand" });
  play(engine, P1, id("mx"), {});
  assert.equal(zoneOf(engine, id("mx")), "play");
  assert.equal(attachedTo(engine, id("mx")), undefined, "it has no ATTACH TO: it enters unattached");
  assert.ok(engine.getKeywords(id("ruleA")).includes("covert"), "engine.getKeywords(id(\"ruleA\")).includes(\"covert\")");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5);
});

clause(MATRIX, "0:rule", "the attached character loses its keywords (a keyword is printed rules text)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.ok(engine.getKeywords(id("ruleB")).includes("covert"), "control: another character keeps its keyword");
  assert.equal(engine.getKeywords(id("ruleA")).includes("covert"), false, "no COVERT");
});

clause(MATRIX, "0:rule", "the attached character cannot use its activated abilities (the rule text includes abilities)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  const before = influence(engine);
  assert.throws(() => activateRaw(engine, P1, id("ruleA"), "act"), "the ability is gone");
  assert.equal(influence(engine), before);
  activate(engine, P1, id("ruleB"), "act");
  assert.equal(influence(engine) - before, 3, "control: another character's ability works");
});

clause(MATRIX, "0:rule", "the attached character loses its continuous rules (the +2 life)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "printed life only");
  assert.equal(engine.getStat(id("ruleB"), "life"), 5, "another character keeps its +2 life");
});

clause(MATRIX, "0:rule", "the attached character loses its triggered rules", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  const before = influence(engine);
  play(engine, P1, id("plain"), {});
  drain(engine, declineAll);
  assert.equal(influence(engine) - before, 2, "only RulefulB's trigger fires for me (+2), RulefulA's does not");
});

clause(MATRIX, "0:rule", "only rules text goes: the printed stats (strength, speed, life), name and type stay", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.deepEqual(stat(engine, id("ruleA")), [2, 3, 2]);
  assert.deepEqual(typesOf(engine, id("ruleA")), ["character"]);
  assert.equal(engine.getDefinition(id("ruleA")).name, "RulefulA");
});

clause(MATRIX, "0:rule", "it only affects its own host: other characters, and the opponent's, keep their text", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.ok(engine.getKeywords(id("foeRule")).includes("covert"), "engine.getKeywords(id(\"foeRule\")).includes(\"covert\")");
  assert.equal(engine.getStat(id("foeRule"), "life"), 5);
});

clause(MATRIX, "0:rule", "it works on an opponent's character too", () => {
  const { engine, id } = matrixBoard({ attachedTo: "foeRule" });
  assert.equal(engine.getStat(id("foeRule"), "life"), 3, "its continuous rule is off");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "mine keep theirs");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("foeRule"), "act"), "and its ability is gone");
});

clause(MATRIX, "0:rule", "when the Matrix leaves play the host has its rules text again", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "silenced while the Matrix is on it");
  play(engine, P1, id("killItem"), { selected: { t: [id("mx")] } });
  assert.equal(zoneOf(engine, id("mx")), "discard");
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "its +2 life rule is back");
  const before = influence(engine);
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(influence(engine) - before, 3, "and its ability works again");
});

clause(MATRIX, "0:rule", "when the host leaves play the Matrix leaves with it (CR 301.4)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  play(engine, P1, id("kill"), { selected: { t: [id("ruleA")] } });
  assert.equal(zoneOf(engine, id("ruleA")), "discard");
  assert.equal(zoneOf(engine, id("mx")), "discard", "destroyed with its host");
});

clause(MATRIX, "0:rule", "when the host returns to hand the Matrix leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  play(engine, P1, id("bounce"), { selected: { t: [id("ruleA")] } });
  assert.equal(zoneOf(engine, id("ruleA")), "hand");
  assert.equal(zoneOf(engine, id("mx")), "hand", "put into its owner's hand with the host");
});

clause(MATRIX, "1:ability:move", "MOVE pays exactly 2 and attaches the Matrix to the picked character", () => {
  const { engine, id } = matrixBoard();
  const before = ready(engine);
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.equal(attachedTo(engine, id("mx")), id("ruleA"));
  assert.equal(engine.getStat(id("ruleA"), "life"), 3, "and it silences the host straight away");
  assert.equal(engine.state.cards[id("mx")].depleted, false, "MOVE does not deplete");
  assert.equal(zoneOf(engine, id("mx")), "play");
});

clause(MATRIX, "1:ability:move", "the 2 are paid as the cost, before responses; it attaches when it resolves", () => {
  const { engine, id } = matrixBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(before - ready(engine), 2);
  assert.equal(attachedTo(engine, id("mx")), undefined, "not attached yet");
  resolvePendingResponses(engine);
  assert.equal(attachedTo(engine, id("mx")), id("ruleA"));
});

clause(MATRIX, "1:ability:move", "moving it detaches it from the old character (CR 301.2): the old host regains its text, the new one loses it", () => {
  const { engine, id } = matrixBoard({ attachedTo: "ruleA" });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  assert.equal(attachedTo(engine, id("mx")), id("ruleB"));
  assert.equal(engine.getStat(id("ruleA"), "life"), 5, "the old host has its rules text again");
  activate(engine, P1, id("ruleA"), "act");
  assert.equal(engine.getStat(id("ruleB"), "life"), 3, "the new host lost its text");
  assert.throws(() => activateRaw(engine, P1, id("ruleB"), "act"), "...including its ability");
});

clause(MATRIX, "1:ability:move", "it can move onto an opponent's character, and back", () => {
  const { engine, id } = matrixBoard();
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("foeRule")] } });
  assert.equal(attachedTo(engine, id("mx")), id("foeRule"));
  assert.equal(engine.state.cards[id("mx")].controllerId, P1, "I still control the Matrix");
  assert.equal(engine.getStat(id("foeRule"), "life"), 3);
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  assert.equal(attachedTo(engine, id("mx")), id("ruleB"));
  assert.equal(engine.getStat(id("foeRule"), "life"), 5, "their character has its text again");
});

clause(MATRIX, "1:ability:move", "it can be used again and again: each use costs 2", () => {
  const { engine, id } = matrixBoard({ elitism: 6 });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleB")] } });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("foeRule")] } });
  assert.equal(ready(engine), 0);
  assert.equal(attachedTo(engine, id("mx")), id("foeRule"));
  assert.throws(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } }), "a fourth use cannot be paid");
});

clause(MATRIX, "1:ability:move", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = matrixBoard();
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "face-down");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("mx")), "the Matrix itself");
  assert.equal(ready(engine), 8, "nothing was spent");
  attempt(id("ruleA"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(MATRIX, "1:ability:move", "exactly one character: none or two is refused", () => {
  const { engine, id } = matrixBoard();
  assert.throws(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [] } }));
  assert.throws(() => activateRaw(engine, P1, id("mx"), "move", { selected: {} }));
  assert.throws(() => activateRaw(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA"), id("ruleB")] } }));
  assert.equal(attachedTo(engine, id("mx")), undefined);
});

clause(MATRIX, "1:ability:move", "is refused with only 1 resource (one short); exactly 2 works", () => {
  const short = matrixBoard({ elitism: 1 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("mx"), "move", { selected: { c: [short.id("ruleA")] } }));
  assert.equal(attachedTo(short.engine, short.id("mx")), undefined);
  assert.equal(ready(short.engine), 1, "nothing was spent");
  const exact = matrixBoard({ elitism: 2 });
  activate(exact.engine, P1, exact.id("mx"), "move", { selected: { c: [exact.id("ruleA")] } });
  assert.equal(attachedTo(exact.engine, exact.id("mx")), exact.id("ruleA"));
});

clause(MATRIX, "1:ability:move", "no threshold of its own: 2 resources of any kind pay for it", () => {
  const { engine, id } = matrixBoard({ elitism: 0, greed: 2 });
  activate(engine, P1, id("mx"), "move", { selected: { c: [id("ruleA")] } });
  assert.equal(attachedTo(engine, id("mx")), id("ruleA"));
});

clause(MATRIX, "1:ability:move", "only its controller can use it, and only from play", () => {
  const { engine, id } = matrixBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("mx"), "move", { selected: { c: [id("foeRule")] } }));
  const inHand = matrixBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("mx"), "move", { selected: { c: [inHand.id("ruleA")] } }));
});

clause(MATRIX, "1:ability:move", "deploys for its printed cost of 2 with [E] (one short or no [E] is refused) and is a gear item", () => {
  const ok = matrixBoard({ zone: "hand", elitism: 1, greed: 1 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("mx"), {});
  assert.equal(before - ready(ok.engine), 2);
  assert.deepEqual(typesOf(ok.engine, ok.id("mx")), ["item"]);
  assert.deepEqual(ok.engine.getSubtypes(ok.id("mx")), ["gear"]);
  const short = matrixBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("mx")), "one resource short");
  const noE = matrixBoard({ zone: "hand", elitism: 0, greed: 5 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("mx")), "no [E]");
});

// ===============================================================================
// Topplemajig — Character (majig), cost 5, threshold [E], 4 strength / 1 speed / 4 life.
// While this card is in a battle, all characters in the opposing party lose 1 speed.
// ===============================================================================

const TOPPLE = "bd83a9e3-337b-4957-ae8b-e0b697bbc5f0";

function toppleBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "tm", def: printing(TOPPLE), owner: P1, zone: opts.zone ?? "play" },
      { key: "tm2", def: printing(TOPPLE), owner: P2, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "idleMine", def: character({ name: "IdleMine", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foeA", def: character({ name: "FoeA", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "foeB", def: character({ name: "FoeB", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "idleFoe", def: character({ name: "IdleFoe", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 1, life: 6, speed: 0 }), owner: P2, zone: "play" },
      { key: "zapper", def: zapTactic(1), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const speedOf = (engine: SpoilsEngine, cardId: string) => engine.getStat(cardId, "speed");

clause(TOPPLE, "0:rule", "while attacking, every blocker in the opposing (blocking) party loses 1 speed", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeA"), id("foeB")] });
  assert.equal(speedOf(engine, id("foeA")), 2, "3 - 1");
  assert.equal(speedOf(engine, id("foeB")), 1, "2 - 1");
  assert.equal(speedOf(engine, id("idleFoe")), 3, "a character not in the battle is unchanged");
});

clause(TOPPLE, "0:rule", "while blocking, every attacker in the opposing (attacking) party loses 1 speed", () => {
  const { engine, id } = toppleBoard({ active: P2 });
  declareAttackBy(engine, P2, [id("foeA"), id("foeB")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("tm")] });
  assert.equal(speedOf(engine, id("foeA")), 2);
  assert.equal(speedOf(engine, id("foeB")), 1);
  assert.equal(speedOf(engine, id("idleFoe")), 3);
});

clause(TOPPLE, "0:rule", "its own party is not slowed: the Topplemajig itself and a partner in its party keep their speed", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm"), id("mate")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeA")] });
  assert.equal(speedOf(engine, id("tm")), 1, "the Topplemajig keeps its 1 speed");
  assert.equal(speedOf(engine, id("mate")), 3, "its partner keeps its speed");
  assert.equal(speedOf(engine, id("foeA")), 2, "the blocker is slowed");
  assert.equal(speedOf(engine, id("idleMine")), 3);
});

clause(TOPPLE, "0:rule", "a blocking partner of the opponent's party is slowed, but the blockers' side partner of the Topplemajig is not (blocking side)", () => {
  const { engine, id } = toppleBoard({ active: P2 });
  declareAttackBy(engine, P2, [id("foeA")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("tm"), id("mate")] });
  assert.equal(speedOf(engine, id("foeA")), 2, "the attacker is slowed");
  assert.equal(speedOf(engine, id("mate")), 3, "my other blocker is not");
  assert.equal(speedOf(engine, id("tm")), 1);
});

clause(TOPPLE, "0:rule", "it only applies while the Topplemajig is in a battle: before the attack and after the battle nobody is slowed", () => {
  const { engine, id } = toppleBoard();
  assert.equal(speedOf(engine, id("foeA")), 3, "before");
  fight(engine, P1, [id("tm")], { type: "faction", playerId: P2 }, [id("foeA")]);
  assert.equal(battleOf(engine), undefined, "the battle is over");
  assert.equal(speedOf(engine, id("foeA")), 3, "after the battle the blocker has its printed speed again");
});

clause(TOPPLE, "0:rule", "a Topplemajig that is in play but NOT in the battle slows nobody", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("mate")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeA")] });
  assert.equal(speedOf(engine, id("foeA")), 3, "the Topplemajig stayed home");
  assert.equal(speedOf(engine, id("mate")), 3);
});

clause(TOPPLE, "0:rule", "before blockers are declared nobody is slowed: the opposing party only exists once the blocking party is formed", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm")]);
  assert.equal(speedOf(engine, id("foeA")), 3, "no blocking party yet: the blockers are not in the battle");
  assert.equal(speedOf(engine, id("tm")), 1);
});

clause(TOPPLE, "0:rule", "speed never goes below 0 (CR 410.4): a 0-speed blocker stays at 0", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("slow")] });
  assert.equal(speedOf(engine, id("slow")), 0);
});

clause(TOPPLE, "0:rule", "the slowdown changes who deals damage first: a 2-speed attacker that would kill the 1-speed Topplemajig first now strikes at the same time and dies too", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "tm", def: printing(TOPPLE), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 4, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, [id("tm")]);
  assert.equal(zoneOf(engine, id("foe")), "discard", "the Topplemajig (4 strength) struck at the same time and killed it");
  assert.equal(zoneOf(engine, id("tm")), "discard", "and the 5-strength attacker killed it too");
});

clause(TOPPLE, "0:rule", "control: without the slowdown (a plain 4/4/1 blocker) the 2-speed 5-strength attacker kills it first and survives", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "blocker", def: character({ name: "PlainTopple", strength: 4, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 4, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, [id("blocker")]);
  assert.equal(zoneOf(engine, id("blocker")), "discard");
  assert.equal(zoneOf(engine, id("foe")), "play", "the faster attacker killed it before it could strike");
});

clause(TOPPLE, "0:rule", "an opponent's Topplemajig slows MY characters in a battle with it", () => {
  const { engine, id } = toppleBoard({ active: P2 });
  declareAttackBy(engine, P2, [id("tm2")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mate")] });
  assert.equal(speedOf(engine, id("mate")), 2, "my blocker is slowed by their Topplemajig");
  assert.equal(speedOf(engine, id("tm2")), 1);
});

clause(TOPPLE, "0:rule", "two Topplemajigs facing each other each slow the other (speed 1 becomes 0)", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("tm2")] });
  assert.equal(speedOf(engine, id("tm")), 0);
  assert.equal(speedOf(engine, id("tm2")), 0);
});

clause(TOPPLE, "0:rule", "it slows only characters in the opposing PARTY: the blocked-away target faction and characters outside the battle are untouched", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeB")] });
  for (const key of ["foeA", "idleFoe", "slow"]) assert.equal(speedOf(engine, id(key)), key === "slow" ? 0 : 3, `${key} is untouched`);
  assert.equal(speedOf(engine, id("foeB")), 1);
});

clause(TOPPLE, "0:rule", "it stops when the Topplemajig leaves the battle (destroyed mid-battle): the blockers' speed returns", () => {
  const { engine, id } = toppleBoard();
  declareAttackBy(engine, P1, [id("tm"), id("mate")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foeA")] });
  assert.equal(speedOf(engine, id("foeA")), 2);
  engine.state.cards[id("tm")].damage = 99;
  play(engine, P1, id("zapper"), { selected: { t: [id("idleFoe")] } });
  assert.equal(zoneOf(engine, id("tm")), "discard");
  assert.equal(speedOf(engine, id("foeA")), 3, "no Topplemajig in the battle any more");
});

clause(TOPPLE, "0:rule", "deploys for its printed cost of 5 with [E] (one short or no [E] is refused) and has its printed 4/4/1 stats", () => {
  const { engine, id } = toppleBoard({ zone: "hand", elitism: 1, greed: 4 });
  const before = ready(engine);
  play(engine, P1, id("tm"), {});
  assert.equal(before - ready(engine), 5);
  assert.deepEqual(stat(engine, id("tm")), [4, 4, 1]);
  assert.deepEqual(engine.getSubtypes(id("tm")), ["majig"]);
  assert.equal(engine.getDefinition(id("tm")).trade, "gearsmith");
  const short = toppleBoard({ zone: "hand", elitism: 1, greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tm")), "4 resources is one short of 5");
  const noE = toppleBoard({ zone: "hand", elitism: 0, greed: 6 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("tm")), "no [E]");
});

// ===============================================================================
// Tri-Pole Magnet — Item (gear), cost 2, threshold [E]. ATTACH TO CHARACTER.
// GRAPPLE -- COST: Pick a "gear" card in your discard pile. Destroy this card. --
// EFFECT: If the attached character is still in play, put the "gear" card into play
// attached to the character.
// ===============================================================================

const MAGNET = "790b1c64-e1b4-4bc4-b1b2-261272b75953";

function magnetBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; hostKey?: string; active?: Pid } = {}) {
  const hostKey = opts.hostKey ?? "host";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "tp", def: printing(MAGNET), owner: P1, zone: opts.zone ?? "play", attachedToKey: opts.zone === "hand" ? undefined : hostKey },
      { key: "tp2", def: printing(MAGNET), owner: P1, zone: "play", attachedToKey: "host2" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeHost", def: character({ name: "FoeHost", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      // gear (subtype) cards
      { key: "gearPlain", def: item({ name: "PlainGear", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "gearSpiky", def: printing(SPIKY), owner: P1, zone: "discard" },
      { key: "gearMulti", def: item({ name: "MultiGear", subtype: ["gear", "node"] }), owner: P1, zone: "discard" },
      { key: "notGear", def: item({ name: "NotGear", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "noSubtype", def: item({ name: "NoSubtype" }), owner: P1, zone: "discard" },
      { key: "gearChar", def: character({ name: "GearChar", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "oGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "discard" },
      { key: "hGear", def: item({ name: "HandGear", subtype: ["gear"] }), owner: P1, zone: "hand" },
      { key: "kGear", def: item({ name: "DeckGear", subtype: ["gear"] }), owner: P1, zone: "deck" },
      { key: "pGear", def: item({ name: "PlayGear", subtype: ["gear"] }), owner: P1, zone: "play" },
      { key: "killHost", def: sendTactic("destroy"), owner: P2, zone: "hand" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MAGNET, "0:attach", "deploys for 2 with [E], picking a character as the first extra cost: it enters play attached to that character", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  const before = ready(engine);
  play(engine, P1, id("tp"), { selected: { attachTo: [id("host")] } });
  assert.equal(zoneOf(engine, id("tp")), "play");
  assert.equal(attachedTo(engine, id("tp")), id("host"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.deepEqual(typesOf(engine, id("tp")), ["item"]);
  assert.deepEqual(engine.getSubtypes(id("tp")), ["gear"]);
});

clause(MAGNET, "0:attach", "it can attach to an opponent's character too", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  play(engine, P1, id("tp"), { selected: { attachTo: [id("foeHost")] } });
  assert.equal(attachedTo(engine, id("tp")), id("foeHost"));
  assert.equal(engine.state.cards[id("tp")].controllerId, P1);
});

clause(MAGNET, "0:attach", "only a character can be the host: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  const attempt = (picked: string) => () => playRaw(engine, P1, id("tp"), { selected: { attachTo: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "face-down");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.equal(zoneOf(engine, id("tp")), "hand");
  assert.equal(ready(engine), 6, "nothing was spent");
  attempt(id("host"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(MAGNET, "0:attach", "exactly one host: none or two is refused", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { attachTo: [] } }));
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { attachTo: [id("host"), id("host2")] } }));
});

clause(MAGNET, "0:attach", "is refused one resource short (1 of 2) and without [E]", () => {
  const short = magnetBoard({ zone: "hand", elitism: 1, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tp"), { selected: { attachTo: [short.id("host")] } }));
  const noE = magnetBoard({ zone: "hand", elitism: 0, greed: 5 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("tp"), { selected: { attachTo: [noE.id("host")] } }), "no [E]");
  const exact = magnetBoard({ zone: "hand", elitism: 1, greed: 1 });
  play(exact.engine, P1, exact.id("tp"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(attachedTo(exact.engine, exact.id("tp")), exact.id("host"));
});

clause(MAGNET, "0:attach", "when the host is destroyed the Magnet is destroyed with it (CR 301.4)", () => {
  const { engine, id } = magnetBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("tp")), "discard");
});

clause(MAGNET, "0:attach", "when the host is returned to its owner's hand the Magnet leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = magnetBoard();
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("tp")), "hand");
});

// --- GRAPPLE

/** Uses GRAPPLE (declarations `g` and `host`). */
function grapple(engine: SpoilsEngine, id: (k: string) => string, gearKey: string, hostKey = "host", magnetKey = "tp") {
  activate(engine, P1, id(magnetKey), "grapple", { selected: { g: [id(gearKey)], host: [id(hostKey)] } });
}

clause(MAGNET, "1:ability:grapple", "destroys the Magnet as a cost and puts the picked gear card from my discard pile into play attached to the host", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("tp")), "discard", "COST: Destroy this card");
  assert.equal(zoneOf(engine, id("gearPlain")), "play", "the gear card is in play");
  assert.equal(attachedTo(engine, id("gearPlain")), id("host"), "attached to the character the Magnet was attached to");
  assert.equal(engine.state.cards[id("gearPlain")].controllerId, P1);
  assert.equal(discard(engine, P1).includes(id("gearPlain")), false);
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(MAGNET, "1:ability:grapple", "the cost is paid when the ability is used, before responses: the Magnet is already destroyed while the gear waits in the discard pile", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  assert.equal(zoneOf(engine, id("tp")), "discard", "destroyed as a cost");
  assert.equal(zoneOf(engine, id("gearPlain")), "discard", "the gear is not in play yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gearPlain")), "play");
});

clause(MAGNET, "1:ability:grapple", "it costs no resources", () => {
  const { engine, id } = magnetBoard({ elitism: 0 });
  assert.equal(ready(engine), 0);
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("gearPlain")), "play", "usable with no resources at all");
});

clause(MAGNET, "1:ability:grapple", "the gear card's own rules apply once attached: a Spiky Atlasphere gives the host +1 strength", () => {
  const { engine, id } = magnetBoard();
  assert.equal(engine.getStat(id("host"), "strength"), 2);
  grapple(engine, id, "gearSpiky");
  assert.equal(attachedTo(engine, id("gearSpiky")), id("host"));
  assert.equal(engine.getStat(id("host"), "strength"), 3);
  assert.equal(engine.getStat(id("host2"), "strength"), 2, "another character is untouched");
});

clause(MAGNET, "1:ability:grapple", "a card with several subtypes including gear can be picked", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearMulti");
  assert.equal(attachedTo(engine, id("gearMulti")), id("host"));
});

clause(MAGNET, "1:ability:grapple", "the host may be an opponent's character: the gear goes onto it, still under my control", () => {
  const { engine, id } = magnetBoard({ hostKey: "foeHost" });
  grapple(engine, id, "gearSpiky", "foeHost");
  assert.equal(attachedTo(engine, id("gearSpiky")), id("foeHost"));
  assert.equal(engine.state.cards[id("gearSpiky")].controllerId, P1);
  assert.equal(engine.getStat(id("foeHost"), "strength"), 3);
});

clause(MAGNET, "1:ability:grapple", "only a card with the gear subtype can be picked: a non-gear item, a card without a subtype are refused", () => {
  const { engine, id } = magnetBoard();
  const attempt = (key: string) => () => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id(key)], host: [id("host")] } });
  assert.throws(attempt("notGear"), "an item with a different subtype");
  assert.throws(attempt("noSubtype"), "an item with no subtype");
  assert.equal(zoneOf(engine, id("tp")), "play", "refused attempts did not destroy the Magnet");
  attempt("gearPlain")();
  assert.equal(zoneOf(engine, id("tp")), "discard", "control: a gear card is accepted");
});

clause(MAGNET, "1:ability:grapple", "'a gear card' is any card with the subtype, not only items", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearChar");
  assert.equal(zoneOf(engine, id("gearChar")), "play", "a gear character card is accepted and put into play");
});

clause(MAGNET, "1:ability:grapple", "only a card in MY discard pile: the opponent's discard pile, my hand, my deck and gear in play are refused", () => {
  const { engine, id } = magnetBoard();
  const attempt = (key: string) => () => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id(key)], host: [id("host")] } });
  assert.throws(attempt("oGear"), "opponent's discard pile");
  assert.throws(attempt("hGear"), "my hand");
  assert.throws(attempt("kGear"), "my deck");
  assert.throws(attempt("pGear"), "in play");
  assert.throws(attempt("tp"), "the Magnet itself (in play)");
  assert.equal(zoneOf(engine, id("tp")), "play");
  attempt("gearPlain")();
  assert.equal(zoneOf(engine, id("tp")), "discard");
});

clause(MAGNET, "1:ability:grapple", "exactly one gear card: none or two is refused", () => {
  const { engine, id } = magnetBoard();
  assert.throws(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [], host: [id("host")] } }));
  assert.throws(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { host: [id("host")] } }));
  assert.throws(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain"), id("gearSpiky")], host: [id("host")] } }));
  assert.equal(zoneOf(engine, id("tp")), "play");
});

clause(MAGNET, "1:ability:grapple", "with no gear card in my discard pile it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "tp", def: printing(MAGNET), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "notGear", def: item({ name: "NotGear" }), owner: P1, zone: "discard" },
      { key: "oGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "discard" }
    ]
  });
  assert.throws(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: {} }));
  assert.throws(() => activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("oGear")], host: [id("host")] } }));
  assert.equal(zoneOf(engine, id("tp")), "play");
});

clause(MAGNET, "1:ability:grapple", "if the attached character is no longer in play when it resolves, the gear card stays in the discard pile (the Magnet is still destroyed)", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  engine.state.activePlayerId = P1;
  // the opponent responds by destroying the host
  engine.perform({ type: "playCard", playerId: P2, cardId: id("killHost"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  assert.equal(zoneOf(engine, id("gearPlain")), "discard", "'if the attached character is still in play': it is not, so the gear stays put");
  assert.equal(attachedTo(engine, id("gearPlain")), undefined);
});

clause(MAGNET, "1:ability:grapple", "if the host is still in play the gear is put into play even if the opponent responds with something else", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  resolvePendingResponses(engine);
  assert.equal(attachedTo(engine, id("gearPlain")), id("host"));
});

clause(MAGNET, "1:ability:grapple", "a destroyed Magnet is itself a gear card in my discard pile: a second Magnet can GRAPPLE it back onto its own host", () => {
  const { engine, id } = magnetBoard();
  grapple(engine, id, "gearPlain");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  activate(engine, P1, id("tp2"), "grapple", { selected: { g: [id("tp")], host: [id("host2")] } });
  assert.equal(zoneOf(engine, id("tp")), "play", "the first Magnet is back in play");
  assert.equal(attachedTo(engine, id("tp")), id("host2"), "attached to the second Magnet's host");
  assert.equal(zoneOf(engine, id("tp2")), "discard");
});

clause(MAGNET, "1:ability:grapple", "only its controller can use it, and only from play", () => {
  const { engine, id } = magnetBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("tp"), "grapple", { selected: { g: [id("oGear")], host: [id("host")] } }));
  assert.equal(zoneOf(engine, id("tp")), "play");
  const inHand = magnetBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("tp"), "grapple", { selected: { g: [inHand.id("gearPlain")], host: [inHand.id("host")] } }));
});

clause(MAGNET, "1:ability:grapple", "it can be used on the opponent's turn in response to their action", () => {
  const { engine, id } = magnetBoard({ active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foeHost")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  activateRaw(engine, P1, id("tp"), "grapple", { selected: { g: [id("gearPlain")], host: [id("host")] } });
  letMyResponseResolve(engine);
  assert.equal(attachedTo(engine, id("gearPlain")), id("host"));
});

// ===============================================================================
// Ambuscade — Tactic (rogue), cost 3, threshold [D].
// COST: Play this only when you are being attacked. Destroy a character you control.
// X is twice that character's strength. -- EFFECT: Inflict X damage divided however
// you want to the attacking party.
// ===============================================================================

const AMBUSH = "31bc5956-fbe8-4747-b561-41c6b3c2c1ec";

function ambushBoard(opts: { deception?: number; greed?: number; elitism?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sac0", def: character({ name: "Sac0", strength: 0, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "sac1", def: character({ name: "Sac1", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "keep", def: character({ name: "Keep", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "sacDep", def: character({ name: "SacDepleted", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 9 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "atkA", def: character({ name: "AtkA", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "atkB", def: character({ name: "AtkB", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "atkC", def: character({ name: "AtkC", strength: 1, life: 8, speed: 2 }), owner: P2, zone: "play" },
      { key: "idleFoe", def: character({ name: "IdleFoe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeOpener", def: tactic({ name: "FoeOpener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      { key: "spiky", def: printing(SPIKY), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("elitism", opts.elitism ?? 0, P1)
    ]
  });
}

type AmbushBoard = ReturnType<typeof ambushBoard>;

/** The opponent attacks my faction (or `location`) with the given attackers and passes: I now hold priority in the attack's response window. */
function beAttacked(board: AmbushBoard, attackerKeys: string[], target: "faction" | "myLoc" = "faction") {
  const { engine, id } = board;
  engine.perform({
    type: "declareAttack",
    playerId: P2,
    attackerIds: attackerKeys.map(id),
    target: target === "faction" ? { type: "faction", playerId: P1 } : { type: "card", cardId: id("myLoc") }
  });
  engine.perform({ type: "passPriority", playerId: P2 });
}

/** Plays Ambuscade with `sacKey` as the destroyed character and `atkKeys` as the attacking party. Does NOT drain the response window. */
function castAmbush(board: AmbushBoard, sacKey: string, atkKeys: string[]) {
  const { engine, id } = board;
  engine.perform({ type: "playCard", playerId: P1, cardId: id("amb"), selected: { c: [id(sacKey)], atk: atkKeys.map(id) }, variables: {} } as never);
}

/** Lets the opponent decline to respond so the tactic resolves, up to the division prompt. */
function resolveAmbush(engine: SpoilsEngine) {
  resolvePendingResponses(engine);
}

function divide(engine: SpoilsEngine, shares: Record<string, number>) {
  const pc = pendingOf(engine);
  assert.ok(pc, "a division prompt is open");
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.playerId, P1, "I divide the damage");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  resolvePendingResponses(engine);
}

clause(AMBUSH, "0:ability", "when I am attacked: pays 3, destroys the character I chose, and inflicts X = twice its strength to the lone attacker", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  const before = ready(engine);
  castAmbush(board, "sac3", ["atkA"]);
  resolveAmbush(engine);
  const pc = pendingOf(engine);
  assert.ok(pc, "I am asked how to divide the damage");
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.amount, 6, "X = 2 x 3 strength = 6");
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(engine, id("sac3")), "discard", "the character was destroyed");
  assert.equal(zoneOf(engine, id("atkA")), "discard", "6 damage destroys the 5-life attacker");
  assert.equal(zoneOf(engine, id("amb")), "discard", "the tactic ends in my discard pile");
  assert.equal(zoneOf(engine, id("keep")), "play", "my other characters are untouched");
});

clause(AMBUSH, "0:ability", "destroying the character is a COST: it is paid when the tactic is played, before responses", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  castAmbush(board, "sac3", ["atkA"]);
  assert.ok(engine.state.responseWindow, "the tactic is waiting for the opponent's response");
  assert.equal(zoneOf(engine, id("sac3")), "discard", "the character was already destroyed when the tactic was played");
});

for (const [sac, x] of [["sac1", 2], ["sac3", 6], ["sac0", 0]] as const) {
  clause(AMBUSH, "0:ability", `X is twice the destroyed character's strength: strength ${x / 2} gives X=${x}`, () => {
    const board = ambushBoard();
    const { engine, id } = board;
    beAttacked(board, ["atkC"]);
    castAmbush(board, sac, ["atkC"]);
    resolveAmbush(engine);
    if (x === 0) {
      assert.equal(pendingOf(engine), undefined, "X = 0: nothing to divide");
    } else {
      assert.equal(pendingOf(engine)?.amount, x);
      divide(engine, { [id("atkC")]: x });
    }
    assert.equal(zoneOf(engine, id(sac)), "discard", "the character was destroyed all the same");
    assert.equal(engine.state.cards[id("atkC")].damage, x, `the attacker took ${x}`);
  });
}

clause(AMBUSH, "0:ability", "X uses the character's CURRENT strength, not its printed one: a Spiky Atlasphere on a 3-strength character makes X = 8", () => {
  const board = ambushBoard({ elitism: 2 });
  const { engine, id } = board;
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  play(engine, P1, id("spiky"), { selected: { attachTo: [id("sac3")] } });
  assert.equal(engine.getStat(id("sac3"), "strength"), 4);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  beAttacked(board, ["atkC"]);
  castAmbush(board, "sac3", ["atkC"]);
  resolveAmbush(engine);
  assert.equal(pendingOf(engine)?.amount, 8);
  divide(engine, { [id("atkC")]: 8 });
  assert.equal(zoneOf(engine, id("atkC")), "discard");
});

clause(AMBUSH, "0:ability", "the damage is divided however I want among the attacking party: all on one, or split", () => {
  for (const [shares, label] of [
    [{ atkA: 6, atkB: 0 }, "all 6 on atkA"],
    [{ atkA: 0, atkB: 6 }, "all 6 on atkB"],
    [{ atkA: 4, atkB: 2 }, "4 and 2"],
    [{ atkA: 3, atkB: 3 }, "3 and 3"],
    [{ atkA: 5, atkB: 1 }, "5 and 1"]
  ] as const) {
    const board = ambushBoard();
    const { engine, id } = board;
    beAttacked(board, ["atkA", "atkB"]);
    castAmbush(board, "sac3", ["atkA", "atkB"]);
    resolveAmbush(engine);
    divide(engine, { [id("atkA")]: shares.atkA, [id("atkB")]: shares.atkB });
    if (zoneOf(engine, id("atkA")) === "play") assert.equal(engine.state.cards[id("atkA")].damage, shares.atkA, `${label}: damage on atkA`);
    if (zoneOf(engine, id("atkB")) === "play") assert.equal(engine.state.cards[id("atkB")].damage, shares.atkB, `${label}: damage on atkB`);
    assert.equal(zoneOf(engine, id("atkA")), shares.atkA >= 5 ? "discard" : "play", `${label}: atkA (5 life)`);
    assert.equal(zoneOf(engine, id("atkB")), shares.atkB >= 2 ? "discard" : "play", `${label}: atkB (2 life)`);
    assert.equal(zoneOf(engine, id("idleFoe")), "play", "a character not in the attacking party is untouched");
  }
});

clause(AMBUSH, "0:ability", "the whole X must be assigned: dividing less or more than X is refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac3", ["atkA", "atkB"]);
  resolveAmbush(engine);
  const attempt = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  assert.throws(attempt({ [id("atkA")]: 4, [id("atkB")]: 4 }), "8 of 6");
  assert.throws(attempt({ [id("atkA")]: 5, [id("idleFoe")]: 1 }), "a character outside the attacking party");
  assert.throws(attempt({ [id("atkA")]: 5, [id("sac1")]: 1 }), "one of my own characters");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong", "still waiting for a legal division");
  divide(engine, { [id("atkA")]: 4, [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard", "control: an exact division is accepted");
});

clause(AMBUSH, "0:ability", "the whole X must be assigned: dividing less than X (5 of 6, or nothing at all) is refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac3", ["atkA", "atkB"]);
  resolveAmbush(engine);
  const attempt = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  assert.throws(attempt({ [id("atkA")]: 3, [id("atkB")]: 2 }), "5 of 6");
  assert.throws(attempt({}), "no damage at all");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong", "still waiting for a division that adds up to X");
});

clause(AMBUSH, "0:ability", "the damage goes to the attacking party only: my own characters and the idle opponent character take none", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  castAmbush(board, "sac3", ["atkA"]);
  resolveAmbush(engine);
  divide(engine, { [id("atkA")]: 6 });
  for (const key of ["keep", "sac1", "sac0", "idleFoe", "atkB", "atkC"]) assert.equal(engine.state.cards[id(key)].damage, 0, `${key} took nothing`);
});

clause(AMBUSH, "0:ability", "attackers whose damage reaches their life are destroyed and leave the battle; the others stay in it", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  castAmbush(board, "sac1", ["atkA", "atkB"]);
  resolveAmbush(engine);
  divide(engine, { [id("atkA")]: 0, [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atkA")], "only atkA is still attacking");
});

clause(AMBUSH, "0:ability", "killing the whole attacking party ends the battle", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkB"]);
  castAmbush(board, "sac1", ["atkB"]);
  resolveAmbush(engine);
  divide(engine, { [id("atkB")]: 2 });
  assert.equal(zoneOf(engine, id("atkB")), "discard");
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined, "no battle left");
  assert.equal(engine.state.players[P1].influence, 30, "my faction took no damage");
});

clause(AMBUSH, "0:ability", "playable only when I am being attacked: refused on my own turn with no battle, and during the opponent's turn with no attack", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  assert.throws(() => castAmbush(board, "sac3", ["atkA"]), "the opponent's turn but no attack has been declared");
  assert.equal(zoneOf(engine, id("sac3")), "play", "nothing was destroyed by the refused play");
  assert.equal(ready(engine), 5, "nothing was spent");
  assert.equal(zoneOf(engine, id("amb")), "hand");
  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  assert.throws(() => playRaw(mine.engine, P1, mine.id("amb"), { selected: { c: [mine.id("sac3")], atk: [mine.id("foe")] } }), "my own turn, no battle");
  assert.equal(mine.engine.getCardPlayability(P1, mine.id("amb")).playable, false);
});

clause(AMBUSH, "0:ability", "refused when I am the one attacking (I am not being attacked)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "sac3", def: character({ name: "Sac3", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  assert.throws(() => playRaw(engine, P1, id("amb"), { selected: { c: [id("sac3")], atk: [id("atk")] } }), "I am attacking, not being attacked");
  assert.equal(zoneOf(engine, id("sac3")), "play");
});

clause(AMBUSH, "0:ability", "'being attacked' includes an attack on a location I control", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"], "myLoc");
  castAmbush(board, "sac3", ["atkA"]);
  resolveAmbush(engine);
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(zoneOf(engine, id("atkA")), "discard");
});

clause(AMBUSH, "0:ability", "can also be played later in the battle, in a response window after blockers were declared", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("keep")] });
  assert.ok(engine.state.responseWindow, "the first battle-resolution response window is open");
  const window = engine.state.responseWindow;
  if (window && window.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  castAmbush(board, "sac3", ["atkA"]);
  resolveAmbush(engine);
  divide(engine, { [id("atkA")]: 6 });
  assert.equal(zoneOf(engine, id("atkA")), "discard");
});

clause(AMBUSH, "0:ability", "the destroyed character must be one I control: an opponent's character, an item, a location, and a card in hand are refused", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA"]);
  const attempt = (picked: string) => () => castAmbush(board, picked, ["atkA"]);
  assert.throws(attempt("atkB"), "their character");
  assert.throws(attempt("idleFoe"), "their idle character");
  assert.throws(attempt("myItem"), "my item");
  assert.throws(attempt("myLoc"), "my location");
  assert.throws(attempt("amb"), "the tactic itself in hand");
  assert.equal(zoneOf(engine, id("sac3")), "play");
  assert.equal(ready(engine), 5, "nothing was spent");
  attempt("sac3")();
  assert.ok(engine.state.responseWindow, "control: my character is accepted");
});

clause(AMBUSH, "0:ability", "a depleted character of mine can be the one destroyed", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkC"]);
  castAmbush(board, "sacDep", ["atkC"]);
  resolveAmbush(engine);
  assert.equal(pendingOf(engine)?.amount, 4, "2 strength: X = 4");
  divide(engine, { [id("atkC")]: 4 });
  assert.equal(zoneOf(engine, id("sacDep")), "discard");
});

clause(AMBUSH, "0:ability", "needs a character of mine to destroy: with none, it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", life: 5 }), owner: P2, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.throws(() => playRaw(engine, P1, id("amb"), { selected: { c: [], atk: [id("atk")] } }));
  assert.equal(zoneOf(engine, id("amb")), "hand");
});

clause(AMBUSH, "0:ability", "is refused one resource short of its cost of 3, and without [D] even with plenty of other resources", () => {
  const short = ambushBoard({ deception: 2 });
  beAttacked(short, ["atkA"]);
  assert.throws(() => castAmbush(short, "sac3", ["atkA"]));
  assert.equal(zoneOf(short.engine, short.id("sac3")), "play");
  const noD = ambushBoard({ deception: 0, greed: 6 });
  beAttacked(noD, ["atkA"]);
  assert.throws(() => castAmbush(noD, "sac3", ["atkA"]), "no [D]");
  const exact = ambushBoard({ deception: 3 });
  beAttacked(exact, ["atkA"]);
  castAmbush(exact, "sac3", ["atkA"]);
  resolveAmbush(exact.engine);
  divide(exact.engine, { [exact.id("atkA")]: 6 });
  assert.equal(zoneOf(exact.engine, exact.id("atkA")), "discard", "one [D] and exactly 3 resources is enough");
});

clause(AMBUSH, "0:ability", "the attacking party chosen must be the actual attackers: a non-attacker cannot be named", () => {
  const board = ambushBoard();
  const { engine, id } = board;
  beAttacked(board, ["atkA", "atkB"]);
  assert.throws(() => castAmbush(board, "sac3", ["atkA", "idleFoe"]), "idleFoe is not attacking");
  assert.throws(() => castAmbush(board, "sac3", ["idleFoe", "atkC"]), "neither is attacking");
  assert.equal(zoneOf(engine, id("sac3")), "play");
});

// ===============================================================================
// Befuddling Beggar — Character (outcast), cost 2, threshold [D][D], 1 strength /
// 4 speed / 1 life.
// PANHANDLE -- COST: Deplete this card. Pick a character. -- EFFECT: This turn, the
// character either gains or loses 1 speed.
// ===============================================================================

const BEGGAR = "d62f897a-2ea8-4bbb-afb1-c653a7978a1d";

function beggarBoard(opts: { zone?: "hand" | "play"; deception?: number; greed?: number; active?: Pid; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "bg", def: printing(BEGGAR), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "bg2", def: printing(BEGGAR), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 2, life: 5, speed: 0 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Picks the +1 / -1 option of an open `chooserSelectsOption`. */
function panhandleChoice(engine: SpoilsEngine, sign: "+" | "-") {
  const pc = pendingOf(engine) as unknown as { kind: string; playerId: string; options: Array<{ label?: string }> };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Beggar's controller chooses");
  const index = pc.options.findIndex((o) => (sign === "+" ? /\+\s*1|gain/i.test(o.label ?? "") : /-\s*1|−1|lose/i.test(o.label ?? "")));
  assert.ok(index >= 0, `an option for ${sign}1 speed (${pc.options.map((o) => o.label).join(" / ")})`);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
}

clause(BEGGAR, "0:ability:panhandle", "depletes the Beggar as the cost, before the effect resolves", () => {
  const { engine, id } = beggarBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } });
  assert.equal(engine.state.cards[id("bg")].depleted, true, "COST: Deplete this card");
  assert.equal(ready(engine), before, "it costs no resources");
  assert.equal(speedOf(engine, id("mine")), 2, "no change yet");
  resolvePendingResponses(engine);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsOption", "then the choice is offered");
});

clause(BEGGAR, "0:ability:panhandle", "choosing 'gains': the picked character gets +1 speed this turn, and nothing else changes", () => {
  const { engine, id } = beggarBoard();
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("foe")] } });
  panhandleChoice(engine, "+");
  assert.equal(speedOf(engine, id("foe")), 4, "3 + 1");
  assert.deepEqual(stat(engine, id("foe")).slice(0, 2), [2, 5], "strength and life unchanged");
  assert.equal(speedOf(engine, id("mine")), 2, "another character is untouched");
  assert.equal(speedOf(engine, id("bg")), 4, "the Beggar itself is untouched");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BEGGAR, "0:ability:panhandle", "choosing 'loses': the picked character gets -1 speed this turn", () => {
  const { engine, id } = beggarBoard();
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("foe")] } });
  panhandleChoice(engine, "-");
  assert.equal(speedOf(engine, id("foe")), 2, "3 - 1");
  assert.equal(speedOf(engine, id("mine")), 2);
});

clause(BEGGAR, "0:ability:panhandle", "the choice is the Beggar's controller's: the opponent cannot answer it", () => {
  const { engine, id } = beggarBoard();
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } });
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 0 } } as never));
  assert.equal(speedOf(engine, id("mine")), 2);
  panhandleChoice(engine, "+");
  assert.equal(speedOf(engine, id("mine")), 3);
});

clause(BEGGAR, "0:ability:panhandle", "it works on my own characters, on the opponent's, and on the Beggar itself", () => {
  const own = beggarBoard();
  activate(own.engine, P1, own.id("bg"), "panhandle", { selected: { c: [own.id("mine")] } });
  panhandleChoice(own.engine, "+");
  assert.equal(speedOf(own.engine, own.id("mine")), 3);
  const self = beggarBoard();
  activate(self.engine, P1, self.id("bg"), "panhandle", { selected: { c: [self.id("bg")] } });
  panhandleChoice(self.engine, "-");
  assert.equal(speedOf(self.engine, self.id("bg")), 3, "the Beggar slowed itself: 4 - 1");
  assert.equal(self.engine.state.cards[self.id("bg")].depleted, true);
});

clause(BEGGAR, "0:ability:panhandle", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = beggarBoard();
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "face-down");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.equal(engine.state.cards[id("bg")].depleted, false, "refused attempts did not deplete it");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(BEGGAR, "0:ability:panhandle", "exactly one character: none or two is refused", () => {
  const { engine, id } = beggarBoard();
  assert.throws(() => activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [] } }));
  assert.throws(() => activateRaw(engine, P1, id("bg"), "panhandle", { selected: {} }));
  assert.throws(() => activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine"), id("foe")] } }));
  assert.equal(engine.state.cards[id("bg")].depleted, false);
});

clause(BEGGAR, "0:ability:panhandle", "'this turn': the change ends when the turn ends (both a gain and a loss)", () => {
  const up = beggarBoard();
  activate(up.engine, P1, up.id("bg"), "panhandle", { selected: { c: [up.id("mine")] } });
  panhandleChoice(up.engine, "+");
  assert.equal(speedOf(up.engine, up.id("mine")), 3);
  endTurn(up.engine, P1);
  assert.equal(speedOf(up.engine, up.id("mine")), 2, "gone by the opponent's turn");
  const down = beggarBoard();
  activate(down.engine, P1, down.id("bg"), "panhandle", { selected: { c: [down.id("foe")] } });
  panhandleChoice(down.engine, "-");
  assert.equal(speedOf(down.engine, down.id("foe")), 2);
  endTurn(down.engine, P1);
  assert.equal(speedOf(down.engine, down.id("foe")), 3, "restored when the turn ends");
});

clause(BEGGAR, "0:ability:panhandle", "two Beggars on the same character: +1 and -1 cancel, two +1 make +2", () => {
  const cancel = beggarBoard();
  activate(cancel.engine, P1, cancel.id("bg"), "panhandle", { selected: { c: [cancel.id("foe")] } });
  panhandleChoice(cancel.engine, "+");
  activate(cancel.engine, P1, cancel.id("bg2"), "panhandle", { selected: { c: [cancel.id("foe")] } });
  panhandleChoice(cancel.engine, "-");
  assert.equal(speedOf(cancel.engine, cancel.id("foe")), 3);
  const both = beggarBoard();
  activate(both.engine, P1, both.id("bg"), "panhandle", { selected: { c: [both.id("foe")] } });
  panhandleChoice(both.engine, "+");
  activate(both.engine, P1, both.id("bg2"), "panhandle", { selected: { c: [both.id("foe")] } });
  panhandleChoice(both.engine, "+");
  assert.equal(speedOf(both.engine, both.id("foe")), 5);
});

clause(BEGGAR, "0:ability:panhandle", "losing 1 speed never takes a character below 0 (CR 410.4): a 0-speed character stays at 0", () => {
  const { engine, id } = beggarBoard();
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("slow")] } });
  panhandleChoice(engine, "-");
  assert.equal(speedOf(engine, id("slow")), 0);
});

clause(BEGGAR, "0:ability:panhandle", "cannot be used while the Beggar is depleted; usable again once restored next turn", () => {
  const { engine, id } = beggarBoard();
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } });
  panhandleChoice(engine, "+");
  assert.throws(() => activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } }), "already depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("bg")].depleted, false, "restored");
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } });
  panhandleChoice(engine, "-");
  assert.equal(speedOf(engine, id("mine")), 1);
  const depleted = beggarBoard({ depleted: true });
  assert.throws(() => activateRaw(depleted.engine, P1, depleted.id("bg"), "panhandle", { selected: { c: [depleted.id("mine")] } }));
});

clause(BEGGAR, "0:ability:panhandle", "usable the turn it enters play (a character may use its abilities at once, CR 204.3a)", () => {
  const { engine, id } = beggarBoard({ zone: "hand", deception: 2 });
  play(engine, P1, id("bg"), {});
  activate(engine, P1, id("bg"), "panhandle", { selected: { c: [id("mine")] } });
  panhandleChoice(engine, "+");
  assert.equal(speedOf(engine, id("mine")), 3);
});

clause(BEGGAR, "0:ability:panhandle", "only its controller can use it, and only from play", () => {
  const { engine, id } = beggarBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("bg"), "panhandle", { selected: { c: [id("foe")] } }));
  const inHand = beggarBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("bg"), "panhandle", { selected: { c: [inHand.id("mine")] } }));
});

clause(BEGGAR, "0:ability:panhandle", "used in a battle response window it changes who strikes first: slowing a 3-speed attacker below the 2-speed blocker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bg", def: printing(BEGGAR), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 4, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 4, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("atk")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blocker")] });
  const window = engine.state.responseWindow;
  if (window && window.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  activateRaw(engine, P1, id("bg"), "panhandle", { selected: { c: [id("atk")] } });
  letMyResponseResolve(engine);
  panhandleChoice(engine, "-");
  assert.equal(speedOf(engine, id("atk")), 2, "now as slow as the blocker");
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("atk")), "discard", "both strike together: the 4-strength blocker kills the attacker");
  assert.equal(zoneOf(engine, id("blocker")), "discard", "...and the attacker kills the blocker");
});

clause(BEGGAR, "0:ability:panhandle", "deploys for its printed cost of 2 with [D][D] (one short or one [D] short is refused) and has its printed 1/1/4 stats", () => {
  const { engine, id } = beggarBoard({ zone: "hand", deception: 2 });
  const before = ready(engine);
  play(engine, P1, id("bg"), {});
  assert.equal(before - ready(engine), 2);
  assert.deepEqual(stat(engine, id("bg")), [1, 1, 4]);
  assert.deepEqual(engine.getSubtypes(id("bg")), ["outcast"]);
  assert.equal(engine.getDefinition(id("bg")).trade, "rogue");
  const short = beggarBoard({ zone: "hand", deception: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bg")), "one resource short");
  const oneD = beggarBoard({ zone: "hand", deception: 1, greed: 5 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("bg")), "one [D] is not [D][D]");
});

// ===============================================================================
// Carnival King — Character (outcast), cost 3, threshold [D][D], 2 strength / 3 speed
// / 1 life.
// CONGA LINE -- COST: Pay 3. Deplete this card. Pick a character. -- EFFECT: This
// turn, all characters able to block the character must do so. When an attacking
// party is formed that includes the character, it must have only 1 member.
// ===============================================================================

const KING = "7912c829-843d-4982-b5c5-a17477afdc90";

function kingBoard(opts: { zone?: "hand" | "play"; deception?: number; greed?: number; depleted?: boolean; covertDefender?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "kg", def: printing(KING), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "D1", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "d2", def: character({ name: "D2", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "d3", def: character({ name: "D3", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "dDep", def: character({ name: "DDepleted", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play", depleted: true },
      ...(opts.covertDefender ? [{ key: "dCovert", def: character({ name: "DCovert", strength: 1, life: 6, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" as const }] : []),
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

type KingBoard = ReturnType<typeof kingBoard>;

/** Conga Line on `key`, then the attack by `attackers`, up to the blocker declaration. */
function congaThenAttack(board: KingBoard, picked: string, attackers: string[]) {
  const { engine, id } = board;
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id(picked)] } });
  declareAttackBy(engine, P1, attackers.map(id));
}

const declareBlock = (engine: SpoilsEngine, ids: string[]) => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: ids });

clause(KING, "0:ability:conga", "pays exactly 3 and depletes the King as the cost, before the effect resolves", () => {
  const { engine, id } = kingBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(engine.state.cards[id("kg")].depleted, true, "COST: Deplete this card");
  assert.equal(engine.state.cards[id("atk")].depleted, false, "the picked character is not depleted");
});

clause(KING, "0:ability:conga", "all characters able to block the picked character must do so: leaving one out is refused, blocking with all of them works", () => {
  const board = kingBoard();
  const { engine, id } = board;
  congaThenAttack(board, "atk", ["atk"]);
  for (const partial of [["d1"], ["d1", "d2"], ["d2", "d3"], []]) {
    assert.throws(() => declareBlock(engine, partial.map(id)), `blocking with only [${partial.join(", ")}] leaves a able character out`);
  }
  assert.equal(battleOf(engine)?.phase, "blocking", "still waiting for a legal block");
  declareBlock(engine, ["d1", "d2", "d3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.length, 3, "all three able characters block");
});

clause(KING, "0:ability:conga", "a character that is NOT able to block is not forced: a depleted defender need not (and cannot) block", () => {
  const board = kingBoard();
  const { engine, id } = board;
  congaThenAttack(board, "atk", ["atk"]);
  assert.throws(() => declareBlock(engine, ["d1", "d2", "d3", "dDep"].map(id)), "a depleted character cannot block");
  declareBlock(engine, ["d1", "d2", "d3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.length, 3, "the depleted one is simply not part of it");
});

clause(KING, "0:ability:conga", "a face-down card, an item and a location are not characters able to block: nothing is demanded of them", () => {
  const board = kingBoard();
  const { engine, id } = board;
  congaThenAttack(board, "atk", ["atk"]);
  declareBlock(engine, ["d1", "d2", "d3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.includes(id("fd")), false);
});

clause(KING, "0:ability:conga", "COVERT is respected: a covert picked attacker can be blocked only by covert characters, so only those are forced", () => {
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "kg", def: printing(KING), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "CovertAtk", strength: 2, life: 5, speed: 2, behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 6 }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "Cov", life: 6, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1)
    ]
  });
  const { engine, id } = board;
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] }), "the covert blocker is able to block, so it must");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("cov")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("cov")], "only the covert character is forced (and the plain one could not block anyway)");
});

clause(KING, "0:ability:conga", "with no character able to block, no block is demanded", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "kg", def: printing(KING), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "dDep", def: character({ name: "DDepleted", life: 6 }), owner: P2, zone: "play", depleted: true },
      ...bank("deception", 4, P1)
    ]
  });
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(KING, "0:ability:conga", "a covert defender cannot block a non-covert attacker (CR 507.3c), so it is not 'able to block' and is not forced: the other defenders can still make a legal block", () => {
  const board = kingBoard({ covertDefender: true });
  const { engine, id } = board;
  congaThenAttack(board, "atk", ["atk"]);
  declareBlock(engine, ["d1", "d2", "d3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.length, 3, "the three plain defenders block; the covert one could not have");
});

clause(KING, "0:ability:conga", "only the PICKED character is affected: another of my attackers is not forced to be blocked by everyone", () => {
  const board = kingBoard();
  const { engine, id } = board;
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  declareAttackBy(engine, P1, [id("atk2")]);
  declareBlock(engine, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "atk2 was not picked, so the defenders are free to block it or not");
});

clause(KING, "0:ability:conga", "the attacking party that includes the picked character must have only 1 member: picked + another is refused, alone is fine", () => {
  const { engine, id } = kingBoard();
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  assert.throws(() => declareAttackBy(engine, P1, [id("atk"), id("atk2")]), "two members");
  assert.equal(battleOf(engine), undefined);
  declareAttackBy(engine, P1, [id("atk")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atk")], "control: the picked character alone may attack");
});

clause(KING, "0:ability:conga", "a party that does NOT include the picked character can have any number of members", () => {
  const { engine, id } = kingBoard();
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("kg")] } });
  declareAttackBy(engine, P1, [id("atk"), id("atk2")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(KING, "0:ability:conga", "the King itself can be the picked character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "kg", def: printing(KING), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "D1", life: 6 }), owner: P2, zone: "play" },
      ...bank("deception", 3, P1)
    ]
  });
  activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [id("kg")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("kg")].depleted, true, "the King depleted itself as the cost, so it cannot attack this turn");
  assert.throws(() => declareAttackBy(engine, P1, [id("kg")]), "a depleted character cannot attack");
  declareAttackBy(engine, P1, [id("mate")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 1);
});

clause(KING, "0:ability:conga", "a character that is already attacking can be picked (nothing in the text excludes it): the defenders must then block it", () => {
  const { engine, id } = kingBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in my attack's response window");
  // CONGA LINE on the attacker, before the blockers are declared.
  assert.doesNotThrow(() => activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } }), "an attacking character is a legal pick");
  resolvePendingResponses(engine);
  assert.equal(battleOf(engine)?.phase, "blocking");
  assert.throws(() => declareBlock(engine, []), "the defenders must block the attacker");
  declareBlock(engine, ["d1", "d2", "d3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.length, 3);
});

clause(KING, "0:ability:conga", "any character can be picked: mine, or the opponent's", () => {
  const mine = kingBoard();
  activate(mine.engine, P1, mine.id("kg"), "conga", { selected: { c: [mine.id("atk")] } });
  assert.equal(mine.engine.state.cards[mine.id("kg")].depleted, true);
  const theirs = kingBoard();
  activate(theirs.engine, P1, theirs.id("kg"), "conga", { selected: { c: [theirs.id("d1")] } });
  assert.equal(theirs.engine.state.cards[theirs.id("kg")].depleted, true, "an opponent's character is a legal pick");
});

clause(KING, "0:ability:conga", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const { engine, id } = kingBoard();
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(attempt(id("fd")), "face-down");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.equal(ready(engine), 4, "nothing was spent");
  assert.equal(engine.state.cards[id("kg")].depleted, false);
  attempt(id("atk"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(KING, "0:ability:conga", "exactly one character: none or two is refused", () => {
  const { engine, id } = kingBoard();
  assert.throws(() => activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [] } }));
  assert.throws(() => activateRaw(engine, P1, id("kg"), "conga", { selected: {} }));
  assert.throws(() => activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [id("atk"), id("atk2")] } }));
  assert.equal(engine.state.cards[id("kg")].depleted, false);
});

clause(KING, "0:ability:conga", "'this turn': next turn nobody is forced to block and the party size is free again", () => {
  const board = kingBoard();
  const { engine, id } = board;
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  declareAttackBy(engine, P1, [id("atk"), id("atk2")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2, "a party of 2 with the old pick is fine again");
  declareBlock(engine, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "and the defenders may decline to block");
});

clause(KING, "0:ability:conga", "is refused with only 2 resources (one short); exactly 3 works", () => {
  const short = kingBoard({ deception: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("kg"), "conga", { selected: { c: [short.id("atk")] } }));
  assert.equal(short.engine.state.cards[short.id("kg")].depleted, false, "a failed payment does not deplete");
  assert.equal(ready(short.engine), 2);
  const exact = kingBoard({ deception: 3 });
  activate(exact.engine, P1, exact.id("kg"), "conga", { selected: { c: [exact.id("atk")] } });
  assert.equal(ready(exact.engine), 0);
});

clause(KING, "0:ability:conga", "no threshold of its own: 3 resources of any kind pay for it", () => {
  const { engine, id } = kingBoard({ deception: 0, greed: 3 });
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  assert.equal(engine.state.cards[id("kg")].depleted, true);
});

clause(KING, "0:ability:conga", "cannot be used while the King is depleted; works again once restored next turn", () => {
  const { engine, id } = kingBoard();
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } });
  assert.throws(() => activateRaw(engine, P1, id("kg"), "conga", { selected: { c: [id("atk")] } }), "already depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("kg")].depleted, false);
  activate(engine, P1, id("kg"), "conga", { selected: { c: [id("atk2")] } });
  assert.equal(engine.state.cards[id("kg")].depleted, true);
  const depleted = kingBoard({ depleted: true });
  assert.throws(() => activateRaw(depleted.engine, P1, depleted.id("kg"), "conga", { selected: { c: [depleted.id("atk")] } }));
});

clause(KING, "0:ability:conga", "only its controller can use it, and only from play; usable the turn it enters play", () => {
  const { engine, id } = kingBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("kg"), "conga", { selected: { c: [id("d1")] } }));
  const inHand = kingBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("kg"), "conga", { selected: { c: [inHand.id("atk")] } }));
  const fresh = kingBoard({ zone: "hand", deception: 6 });
  play(fresh.engine, P1, fresh.id("kg"), {});
  activate(fresh.engine, P1, fresh.id("kg"), "conga", { selected: { c: [fresh.id("atk")] } });
  assert.equal(fresh.engine.state.cards[fresh.id("kg")].depleted, true);
});

clause(KING, "0:ability:conga", "deploys for its printed cost of 3 with [D][D] (one short or one [D] short is refused) and has its printed 2/1/3 stats", () => {
  const { engine, id } = kingBoard({ zone: "hand", deception: 2, greed: 1 });
  const before = ready(engine);
  play(engine, P1, id("kg"), {});
  assert.equal(before - ready(engine), 3);
  assert.deepEqual(stat(engine, id("kg")), [2, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("kg")), ["outcast"]);
  assert.equal(engine.getDefinition(id("kg")).trade, "rogue");
  const short = kingBoard({ zone: "hand", deception: 2, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("kg")), "2 resources is one short");
  const oneD = kingBoard({ zone: "hand", deception: 1, greed: 5 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("kg")), "one [D] is not [D][D]");
});

