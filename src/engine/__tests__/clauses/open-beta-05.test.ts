// Clause tests — batch open-beta-05. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-05`. Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

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
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { endTurn, developDrawLeft } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardDefinition } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: Pid, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Raw `activateAbility` without draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Pid, cardId: string, abilityId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Tokens (markers) on a card. */
const tokensOn = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]?.counters?.token ?? 0;

type Pending = { kind: string; playerId: string; [key: string]: unknown };
const pendingOf = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as Pending | undefined;

/**
 * "Up to N less" (Research Assistant, Runic Circuitry, Towering Researchmajig): the controller is asked how much to reduce
 * (a chooseNumber 0..N). Answers with `value` (the full N when omitted) and drains the response windows; does nothing when no
 * such choice is open.
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

/** Answers the open `chooserSelectsOption` by option label pattern. */
function chooseOption(engine: SpoilsEngine, player: Pid, label: RegExp) {
  const pc = pendingOf(engine) as unknown as { kind: string; options: Array<{ label?: string }> };
  assert.equal(pc.kind, "chooserSelectsOption");
  const index = pc.options.findIndex((o) => label.test(o.label ?? ""));
  assert.ok(index >= 0, `an option matching ${label}`);
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
}

const hand = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deck = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discard = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const zoneOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]?.zone;
const stat = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** The Micromajig tokens `player` controls in play. */
function micromajigs(engine: SpoilsEngine, player: Pid = P1): string[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);
}

/** Every Micromajig token in play, whoever controls it. */
const allMicromajigs = (engine: SpoilsEngine): string[] => micromajigs(engine, P1).concat(micromajigs(engine, P2));

/** A token that left play no longer exists in any zone ("remove them from the game"). */
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

/** A free tactic that sends one chosen card (any type, in play) to `to` (id `s`, declaration `t`). */
function sendTactic(to: "discard" | "hand" | "deck" | "void" | "destroy" | "remove", type: "character" | "item" = "character"): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({
    name: `Send-${to}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [effect] }]
    }
  });
}

/** A free tactic that deals `amount` damage to one chosen character (id `d`, declaration `t`). */
function zapTactic(amount: number): CardDefinition {
  return tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    }
  });
}

/** Does `ids` (a deck snapshot) contain the same cards as `other`, in any order? */
const sameCards = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort());

/** The cardsRevealed events in the log. */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

/** The current battle, read through a function so TypeScript does not narrow it after an earlier assertion. */
const battleOf = (engine: SpoilsEngine) => engine.state.battle;

/** Send attack from `player` against the other faction and drain the response window. */
function declareAttackBy(engine: SpoilsEngine, player: Pid, attackerIds: string[]) {
  const defender = player === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: defender } });
  resolvePendingResponses(engine);
}

// ===============================================================================
// Manifold Quasi-Modal Steamwork — vanilla. Character (majig), cost 8, threshold
// [E][E], 8 strength / 3 speed / 6 life.
// ===============================================================================

const MANIFOLD = "7df6578a-4cbd-4460-a7fc-991c7c36eb21";

function manifoldBoard(opts: { elitism?: number; greed?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "mq", def: printing(MANIFOLD), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MANIFOLD, "vanilla", "deploys for exactly its printed cost of 8: eight resources are spent, none more", () => {
  const { engine, id } = manifoldBoard({ elitism: 10 });
  const before = ready(engine);
  play(engine, P1, id("mq"), {});
  assert.equal(zoneOf(engine, id("mq")), "play", "it is in play");
  assert.equal(engine.state.cards[id("mq")].controllerId, P1);
  assert.equal(before - ready(engine), 8, "the printed cost of 8 is paid");
});

clause(MANIFOLD, "vanilla", "is refused one resource short of its cost (7 of 8) and stays in hand", () => {
  const { engine, id } = manifoldBoard({ elitism: 7 });
  assert.throws(() => playRaw(engine, P1, id("mq")));
  assert.equal(zoneOf(engine, id("mq")), "hand");
  assert.equal(ready(engine), 7, "nothing was spent");
  const exact = manifoldBoard({ elitism: 8 });
  play(exact.engine, P1, exact.id("mq"), {});
  assert.equal(zoneOf(exact.engine, exact.id("mq")), "play", "exactly 8 is enough");
});

clause(MANIFOLD, "vanilla", "is refused without the printed threshold [E][E]: one [E] plus plenty of other resources is not enough", () => {
  const oneE = manifoldBoard({ elitism: 1, greed: 9 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("mq")));
  assert.equal(zoneOf(oneE.engine, oneE.id("mq")), "hand");
  const noE = manifoldBoard({ elitism: 0, greed: 10 });
  assert.throws(() => playRaw(noE.engine, P1, noE.id("mq")));
  const twoE = manifoldBoard({ elitism: 2, greed: 6 });
  play(twoE.engine, P1, twoE.id("mq"), {});
  assert.equal(zoneOf(twoE.engine, twoE.id("mq")), "play", "two [E] and six other resources (8 in all) is enough");
  assert.equal(ready(twoE.engine), 0);
});

clause(MANIFOLD, "vanilla", "has its printed stats in play: 8 strength, 6 life, 3 speed; it is a Gearsmith majig character", () => {
  const { engine, id } = manifoldBoard();
  play(engine, P1, id("mq"), {});
  assert.deepEqual(stat(engine, id("mq")), [8, 6, 3]);
  const def = engine.getDefinition(id("mq"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(engine.getSubtypes(id("mq")), ["majig"]);
  assert.equal(engine.state.cards[id("mq")].damage, 0);
});

clause(MANIFOLD, "vanilla", "has no rules text: no keywords, no activated abilities, no restrictions", () => {
  const { engine, id } = manifoldBoard();
  play(engine, P1, id("mq"), {});
  assert.deepEqual(engine.getKeywords(id("mq")), []);
  assert.deepEqual(
    engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("mq")),
    []
  );
  assert.deepEqual(engine.getRestrictions(id("mq")), []);
});

clause(MANIFOLD, "vanilla", "as a character it can only be deployed on its controller's own turn", () => {
  const { engine, id } = manifoldBoard({ active: P2 });
  assert.throws(() => playRaw(engine, P1, id("mq")));
  assert.equal(zoneOf(engine, id("mq")), "hand");
});

clause(MANIFOLD, "vanilla", "damage is destroyed at exactly its life of 6: 5 damage leaves it alive, 6 destroys it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mq", def: printing(MANIFOLD), owner: P1, zone: "play" },
      { key: "z5", def: zapTactic(5), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic(1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z5"), { selected: { t: [id("mq")] } });
  assert.equal(zoneOf(engine, id("mq")), "play", "5 damage < 6 life");
  play(engine, P1, id("z1"), { selected: { t: [id("mq")] } });
  assert.equal(zoneOf(engine, id("mq")), "discard", "6 damage >= 6 life");
});

clause(MANIFOLD, "vanilla", "deals its printed 8 strength as battle damage to the faction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "mq", def: printing(MANIFOLD), owner: P1, zone: "play" }]
  });
  const influence = engine.state.players[P2].influence;
  declareAttackBy(engine, P1, [id("mq")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, influence - 8, "8 strength = 8 influence lost");
});

// ===============================================================================
// Luteoderm Prototype — ATTACH TO CHARACTER. The attached character gains 1
// strength and 1 life. When the attached character leaves play, you may search
// your deck for a card and put it into your hand.
// Item (gear), cost 2, threshold [E].
// ===============================================================================

const LUTEODERM = "591b62d8-1c20-4756-9dc0-6603d7662c83";

function luteodermBoard(
  opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; hostOwner?: Pid; protoOwner?: Pid; protoDeck?: number; extraCards?: CardPlacement[]; random?: () => number } = {}
) {
  const zone = opts.zone ?? "hand";
  const protoOwner = opts.protoOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "lp", def: printing(LUTEODERM), owner: protoOwner, zone, attachedToKey: zone === "play" ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      // The prototype controller's deck: a mix of types, so "a card" really means any card.
      { key: "dChar", def: character({ name: "DChar" }), owner: protoOwner, zone: "deck" },
      { key: "dItem", def: item({ name: "DItem" }), owner: protoOwner, zone: "deck" },
      { key: "dTac", def: tactic({ name: "DTac" }), owner: protoOwner, zone: "deck" },
      { key: "dLoc", def: location({ name: "DLoc" }), owner: protoOwner, zone: "deck" },
      { key: "dRes", def: resourceCard({ name: "DRes" }), owner: protoOwner, zone: "deck" },
      ...Array.from({ length: opts.protoDeck ?? 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: protoOwner, zone: "deck" as const })),
      // The other player's deck, hand and discard pile must never be searched.
      ...["oChar", "oItem"].map((key) => ({ key, def: (key === "oItem" ? item : character)({ name: key }), owner: protoOwner === P1 ? P2 : P1, zone: "deck" as const })),
      { key: "inHand", def: character({ name: "InHand" }), owner: protoOwner, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: protoOwner, zone: "discard" },
      { key: "sendDiscard", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      ...(opts.extraCards ?? []),
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

// --- 0:attach

clause(LUTEODERM, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays its cost of 2 and stays under its player's control", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = luteodermBoard();
    const before = ready(engine);
    play(engine, P1, id("lp"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(engine.state.cards[id("lp")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("lp")].controllerId, P1, "its controller is the player who played it, whoever owns the host");
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  }
});

clause(LUTEODERM, "0:attach", "is refused for a host that is not a character (item, location, faction, face-down card) or for no host at all", () => {
  const { engine, id } = luteodermBoard();
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("lp"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(attempt(id("dChar")), "a character in the deck is not in play");
  assert.throws(attempt(id("inHand")), "a character in hand is not in play");
  assert.throws(() => playRaw(engine, P1, id("lp"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(engine, id("lp")), "hand");
  assert.equal(ready(engine), 4, "nothing was spent by the refused attempts");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "a character host is accepted");
});

clause(LUTEODERM, "0:attach", "is refused one resource short of 2, and without [E] even with plenty of other resources", () => {
  const short = luteodermBoard({ elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("lp"), { selected: { attachTo: [short.id("host")] } }));
  assert.equal(zoneOf(short.engine, short.id("lp")), "hand");
  const noThreshold = luteodermBoard({ elitism: 0, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("lp"), { selected: { attachTo: [noThreshold.id("host")] } }));
  const exact = luteodermBoard({ elitism: 2 });
  play(exact.engine, P1, exact.id("lp"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(zoneOf(exact.engine, exact.id("lp")), "play", "[E] and exactly 2 resources is enough");
  const oneE = luteodermBoard({ elitism: 1, greed: 1 });
  play(oneE.engine, P1, oneE.id("lp"), { selected: { attachTo: [oneE.id("host")] } });
  assert.equal(zoneOf(oneE.engine, oneE.id("lp")), "play", "one [E] plus one other resource is enough");
});

clause(LUTEODERM, "0:attach", "when its host leaves play the Prototype leaves play with it, into its owner's discard pile (CR 301.4)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  drain(engine, (pc) => ({ kind: "chooserSelectsTarget", selected: [] }));
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the attached card went with it");
  assert.equal(engine.state.cards[id("lp")].attachedTo, undefined);
});

clause(LUTEODERM, "0:attach", "if the host is gone before the Prototype resolves it goes to its owner's discard pile instead of entering play (CR 507.2c)", () => {
  const { engine, id } = luteodermBoard({
    extraCards: [{ key: "opKill", def: tactic({ name: "OpKill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("lp"), { selected: { attachTo: [id("host")] } });
  assert.ok(engine.state.responseWindow, "the Prototype is being deployed; P2 may respond");
  engine.perform({ type: "playCard", playerId: P2, cardId: id("opKill"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the Prototype could not attach, so it went to the discard pile");
  assert.equal(discard(engine, P1).includes(id("lp")), true);
});

// --- 1:rule

clause(LUTEODERM, "1:rule", "the attached character gains exactly 1 strength and 1 life (and no speed) — on your own character and on an opponent's", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = luteodermBoard({ zone: "play", hostOwner: hostKey === "foe" ? P2 : P1 });
    assert.deepEqual(stat(engine, id("host")), [3, 3, 2], `host owned by ${hostKey === "foe" ? P2 : P1}`);
  }
});

clause(LUTEODERM, "1:rule", "no other character is affected, and the Prototype gives its host nothing before it is attached", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stat(engine, id("mate")), [2, 2, 2], "another of my characters");
  assert.deepEqual(stat(engine, id("foe")), [2, 2, 2], "an opponent's character");
  const bare = luteodermBoard({ zone: "hand" });
  assert.deepEqual(stat(bare.engine, bare.id("host")), [2, 2, 2], "control: unattached host has its printed stats");
  play(bare.engine, P1, bare.id("lp"), { selected: { attachTo: [bare.id("host")] } });
  assert.deepEqual(stat(bare.engine, bare.id("host")), [3, 3, 2], "attaching it gives +1/+1");
  assert.deepEqual(stat(bare.engine, bare.id("mate")), [2, 2, 2]);
});

clause(LUTEODERM, "1:rule", "the extra life is real: a 2-life host survives 2 damage with the Prototype and dies on the 3rd, and dies on the 2nd without it", () => {
  const withProto = luteodermBoard({ zone: "play", extraCards: [{ key: "z2", def: zapTactic(2), owner: P1, zone: "hand" }, { key: "z1", def: zapTactic(1), owner: P1, zone: "hand" }] });
  play(withProto.engine, P1, withProto.id("z2"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "play", "2 damage < 3 life");
  play(withProto.engine, P1, withProto.id("z1"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "discard", "3 damage >= 3 life");
  const without = luteodermBoard({ zone: "hand", extraCards: [{ key: "z2", def: zapTactic(2), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("z2"), { selected: { t: [without.id("host")] } });
  assert.equal(zoneOf(without.engine, without.id("host")), "discard", "control: 2 damage kills the bare 2-life host");
});

clause(LUTEODERM, "1:rule", "the extra strength is real in battle: the host deals 3 battle damage to the faction", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  engine.state.turn = 2;
  const influence = engine.state.players[P2].influence;
  // the host must be eligible to attack this turn
  engine.state.cards[id("host")].attackEligibleTurn = 2;
  declareAttackBy(engine, P1, [id("host")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, influence - 3, "2 printed + 1 = 3 strength");
});

clause(LUTEODERM, "1:rule", "two Prototypes on one host stack (+2 strength, +2 life)", () => {
  const { engine, id } = luteodermBoard({
    zone: "play",
    extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }]
  });
  assert.deepEqual(stat(engine, id("host")), [4, 4, 2]);
});

clause(LUTEODERM, "1:rule", "the bonus ends when the Prototype leaves play", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stat(engine, id("host")), [3, 3, 2]);
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  drain(engine, () => ({ kind: "chooserSelectsTarget", selected: [] }));
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play", "the host itself is not harmed");
  assert.deepEqual(stat(engine, id("host")), [2, 2, 2]);
});

// --- 2:rule

/** Opens the search by destroying the host, then returns the pending choice. */
function leaveAndSearch(board: ReturnType<typeof luteodermBoard>, how: "sendDiscard" | "sendHand" | "sendDeck" | "sendVoid" | "sendRemove" = "sendDiscard") {
  const { engine, id } = board;
  play(engine, P1, id(how), { selected: { t: [id("host")] } });
  return pendingOf(engine);
}

clause(LUTEODERM, "2:rule", "when the host is destroyed its controller is offered a deck search; the chosen card goes to hand and nothing else moves", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  const handBefore = [...hand(engine, P1)];
  const deckBefore = [...deck(engine, P1)];
  const oppDeck = [...deck(engine, P2)];
  const pc = leaveAndSearch(board)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Prototype's controller searches");
  pick(engine, P1, [id("dItem")]);
  assert.equal(zoneOf(engine, id("dItem")), "hand");
  assert.deepEqual(hand(engine, P1).filter((c) => !handBefore.includes(c) && c !== id("dItem")), [], "exactly one card was added to the hand");
  assert.equal(hand(engine, P1).length, handBefore.length - 1 + 1, "(the Send tactic left the hand, the found card joined it)");
  sameCards(deck(engine, P1), deckBefore.filter((c) => c !== id("dItem")));
  assert.deepEqual(deck(engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(LUTEODERM, "2:rule", "any card can be found — character, item, tactic, location or resource", () => {
  for (const key of ["dChar", "dItem", "dTac", "dLoc", "dRes"]) {
    const board = luteodermBoard({ zone: "play" });
    leaveAndSearch(board);
    pick(board.engine, P1, [board.id(key)]);
    assert.equal(zoneOf(board.engine, board.id(key)), "hand", key);
  }
});

clause(LUTEODERM, "2:rule", "only a card from YOUR deck can be found: the opponent's deck, your hand and your discard pile are refused", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  leaveAndSearch(board);
  for (const key of ["oChar", "oItem", "inHand", "inDiscard", "mate", "foe", "thing"]) {
    assert.throws(() => pick(engine, P1, [id(key)]), key);
  }
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("oChar")), "deck");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard");
  assert.throws(() => pick(engine, P1, [id("dChar"), id("dItem")]), "it finds ONE card");
  pick(engine, P1, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
});

clause(LUTEODERM, "2:rule", "it is a 'may': I can search and decline to take a card — then my hand is unchanged and the deck keeps all its cards", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine } = board;
  const handBefore = [...hand(engine, P1)];
  const deckBefore = [...deck(engine, P1)];
  leaveAndSearch(board);
  pick(engine, P1, []);
  assert.deepEqual(hand(engine, P1), handBefore.filter((c) => c !== board.id("sendDiscard")), "no card was added");
  sameCards(deck(engine, P1), deckBefore);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(LUTEODERM, "2:rule", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const board = luteodermBoard({ zone: "play", protoDeck: 8 });
  const { engine, id } = board;
  const before = deck(engine, P1).filter((c) => c !== id("dChar"));
  leaveAndSearch(board);
  pick(engine, P1, [id("dChar")]);
  const after = deck(engine, P1);
  sameCards(after, before);
  assert.notDeepEqual(after, before, "in a new order");
});

clause(LUTEODERM, "2:rule", "declining the 'may search' (rules answer Q2: no search happened) leaves the deck exactly as it was, unshuffled", () => {
  const board = luteodermBoard({ zone: "play", protoDeck: 8 });
  const { engine } = board;
  const before = [...deck(engine, P1)];
  leaveAndSearch(board);
  pick(engine, P1, []);
  sameCards(deck(engine, P1), before);
  assert.deepEqual(deck(engine, P1), before, "declined: nothing was searched, so nothing is shuffled");
});

clause(LUTEODERM, "2:rule", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const board = luteodermBoard({ zone: "play" });
  leaveAndSearch(board);
  pick(board.engine, P1, [board.id("dTac")]);
  assert.equal(revealEvents(board.engine).length, 0);
});

for (const [how, label] of [
  ["sendDiscard", "destroyed"],
  ["sendHand", "returned to its owner's hand"],
  ["sendDeck", "put into its owner's deck"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(LUTEODERM, "2:rule", `fires however the host leaves play: ${label}`, () => {
    const board = luteodermBoard({ zone: "play" });
    const pc = leaveAndSearch(board, how);
    assert.ok(pc, `a search is offered when the host is ${label}`);
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    pick(board.engine, P1, [board.id("dItem")]);
    assert.equal(zoneOf(board.engine, board.id("dItem")), "hand");
    assert.notEqual(zoneOf(board.engine, board.id("host")), "play");
  });
}

clause(LUTEODERM, "2:rule", "fires when the host dies of damage", () => {
  const board = luteodermBoard({ zone: "play", extraCards: [{ key: "z3", def: zapTactic(3), owner: P1, zone: "hand" }] });
  play(board.engine, P1, board.id("z3"), { selected: { t: [board.id("host")] } });
  assert.equal(zoneOf(board.engine, board.id("host")), "discard");
  assert.equal(pendingOf(board.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pendingOf(board.engine)?.playerId, P1);
});

clause(LUTEODERM, "2:rule", "does not fire when some other character leaves play", () => {
  for (const other of ["mate", "foe"]) {
    const { engine, id } = luteodermBoard({ zone: "play" });
    play(engine, P1, id("sendDiscard"), { selected: { t: [id(other)] } });
    assert.equal(zoneOf(engine, id(other)), "discard");
    assert.equal(engine.state.pendingChoice, undefined, `no search when ${other} leaves`);
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(zoneOf(engine, id("dItem")), "deck");
  }
});

clause(LUTEODERM, "2:rule", "does not fire when only the Prototype itself leaves play (the host stays)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "the attached character did not leave play");
});

clause(LUTEODERM, "2:rule", "'you' is the Prototype's controller: one I attached to an opponent's character searches MY deck when that character leaves", () => {
  const board = luteodermBoard({ zone: "play", hostOwner: P2 });
  const { engine, id } = board;
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P1, "the controller of the Prototype, not the host's owner");
  assert.throws(() => pick(engine, P1, [id("oChar")]), "the host's owner's deck is not searched");
  pick(engine, P1, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.equal(hand(engine, P1).includes(id("dChar")), true);
});

clause(LUTEODERM, "2:rule", "an opponent's Prototype on my character searches THEIR deck, not mine", () => {
  const board = luteodermBoard({ zone: "play", protoOwner: P2, hostOwner: P1 });
  const { engine, id } = board;
  const myDeck = [...deck(engine, P1)];
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Prototype's controller searches");
  assert.throws(() => pick(engine, P2, [id("oChar")]), "my deck (the host owner's) is not theirs to search");
  pick(engine, P2, [id("dChar")]);
  assert.equal(hand(engine, P2).includes(id("dChar")), true);
  assert.deepEqual(deck(engine, P1), myDeck.filter((c) => deck(engine, P1).includes(c)), "my deck was not touched");
  sameCards(deck(engine, P1), myDeck);
});

clause(LUTEODERM, "2:rule", "a Prototype that is not attached to the leaving character gives nothing: another host's Prototype stays quiet", () => {
  const { engine, id } = luteodermBoard({
    zone: "play",
    extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "mate" }]
  });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  const pc = pendingOf(engine);
  assert.ok(pc, "the host's own Prototype fires");
  pick(engine, P1, [id("dChar")]);
  assert.equal(engine.state.pendingChoice, undefined, "the other Prototype (on Mate) did not fire");
  assert.equal(zoneOf(engine, id("lp2")), "play");
});

clause(LUTEODERM, "2:rule", "two Prototypes on the same host each search when it leaves play", () => {
  const { engine, id } = luteodermBoard({
    zone: "play",
    extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }]
  });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  let searches = 0;
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      searches++;
      return { kind: "chooserSelectsTarget", selected: [id(searches === 1 ? "dChar" : "dItem")] };
    }
    return declineAll(pc);
  });
  assert.equal(searches, 2, "one search per Prototype");
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(LUTEODERM, "2:rule", "with an empty deck nothing is found and nothing breaks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "lp", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  drain(engine, () => ({ kind: "chooserSelectsTarget", selected: [] }));
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(hand(engine, P1).length, 0);
});

// ===============================================================================
// Meager Research — Reveal the top card of your opponent's deck and put it into
// his hand. You may search your deck for a card of the same type as the that
// card, reveal it, and put it into your hand.
// Tactic, cost 1, threshold [E].
// ===============================================================================

const MEAGER = "d25a15e6-3f64-484a-bc42-5121528329c7";

type CardKind = "character" | "item" | "tactic" | "location" | "resource";
const KINDS: CardKind[] = ["character", "item", "tactic", "location", "resource"];

function defOfKind(kind: CardKind, name: string): CardDefinition {
  switch (kind) {
    case "character":
      return character({ name });
    case "item":
      return item({ name });
    case "tactic":
      return tactic({ name });
    case "location":
      return location({ name });
    case "resource":
      return resourceCard({ name });
  }
}

function meagerBoard(opts: { top?: CardKind; elitism?: number; greed?: number; oppDeckSize?: number; myKinds?: CardKind[]; faceDownTop?: boolean } = {}) {
  const top = opts.top ?? "character";
  const myKinds = opts.myKinds ?? KINDS;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      ...(opts.oppDeckSize === 0
        ? []
        : [
            { key: "top", def: defOfKind(top, "Top"), owner: P2, zone: "deck" as const },
            ...Array.from({ length: (opts.oppDeckSize ?? 5) - 1 }, (_, i) => ({ key: `o${i}`, def: i % 2 ? item({ name: `O${i}` }) : character({ name: `O${i}` }), owner: P2, zone: "deck" as const }))
          ]),
      { key: "oppHandCard", def: character({ name: "OppHandCard" }), owner: P2, zone: "hand" },
      // my deck: two cards of each kind, so every type has a legal and an illegal pick
      ...myKinds.flatMap((kind) => [1, 2].map((n) => ({ key: `m_${kind}${n}`, def: defOfKind(kind, `M_${kind}${n}`), owner: P1, zone: "deck" as const }))),
      { key: "myDiscardChar", def: character({ name: "MyDiscardChar" }), owner: P1, zone: "discard" },
      { key: "myHandChar", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(MEAGER, "0:rule", "pays its cost of 1 and ends in its owner's discard pile", () => {
  const { engine, id } = meagerBoard();
  const before = ready(engine);
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  assert.equal(zoneOf(engine, id("mr")), "discard");
  assert.equal(discard(engine, P1).includes(id("mr")), true);
});

clause(MEAGER, "0:rule", "is refused with no resources, and without [E] even with plenty of other resources", () => {
  const none = meagerBoard({ elitism: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("mr")));
  const noThreshold = meagerBoard({ elitism: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("mr")));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mr")), "hand");
  const oneE = meagerBoard({ elitism: 1 });
  play(oneE.engine, P1, oneE.id("mr"), {});
  drain(oneE.engine, declineAll);
  assert.equal(zoneOf(oneE.engine, oneE.id("mr")), "discard", "one [E] and exactly 1 resource is enough");
});

clause(MEAGER, "0:rule", "reveals the top card of the opponent's deck (to everyone) and puts exactly that card into the opponent's hand", () => {
  const { engine, id } = meagerBoard();
  const oppDeck = [...deck(engine, P2)];
  const oppHand = [...hand(engine, P2)];
  assert.equal(oppDeck[0], id("top"));
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  const reveals = revealEvents(engine);
  assert.ok(reveals.length >= 1, "a reveal happened");
  const first = reveals[0].event as unknown as { cardIds: string[]; ownerId: string; viewerId: string };
  assert.deepEqual(first.cardIds, [id("top")], "exactly the top card is revealed");
  assert.equal(first.ownerId, P2, "from the opponent's deck");
  assert.equal(first.viewerId, "all", "to everyone");
  assert.equal(zoneOf(engine, id("top")), "hand");
  assert.deepEqual(hand(engine, P2), [...oppHand, id("top")], "it joined the OPPONENT's hand");
  assert.equal(hand(engine, P1).includes(id("top")), false, "not mine");
  assert.deepEqual(deck(engine, P2), oppDeck.slice(1), "the rest of the opponent's deck is untouched and in the same order");
});

clause(MEAGER, "0:rule", "only the top card moves: with several cards in the opponent's deck the second card stays", () => {
  const { engine, id } = meagerBoard({ oppDeckSize: 8 });
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(hand(engine, P2).length, 2, "one oppHandCard plus the revealed card");
  assert.equal(deck(engine, P2).length, 7);
  assert.equal(zoneOf(engine, id("o0")), "deck");
});

for (const kind of KINDS) {
  clause(MEAGER, "0:rule", `top card is a ${kind}: I may search my deck for a ${kind} only — other types are refused, and the opponent's deck, my hand and discard are not searched`, () => {
    const { engine, id } = meagerBoard({ top: kind });
    play(engine, P1, id("mr"), {});
    const pc = pendingOf(engine);
    assert.ok(pc, "a search is offered");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "I search my own deck");
    for (const other of KINDS.filter((k) => k !== kind)) {
      for (const n of [1, 2]) assert.throws(() => pick(engine, P1, [id(`m_${other}${n}`)]), `a ${other} is not the same type as a ${kind}`);
    }
    for (const key of ["myDiscardChar", "myHandChar", "oppHandCard", "o0", "o1", "keep"]) {
      assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not in my deck`);
    }
    assert.throws(() => pick(engine, P1, [id(`m_${kind}1`), id(`m_${kind}2`)]), "only one card");
    assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
    pick(engine, P1, [id(`m_${kind}2`)]);
    assert.equal(zoneOf(engine, id(`m_${kind}2`)), "hand", `the ${kind} is in my hand`);
    assert.equal(zoneOf(engine, id(`m_${kind}1`)), "deck", "the other one stays in the deck");
    assert.equal(hand(engine, P1).includes(id(`m_${kind}2`)), true);
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(MEAGER, "0:rule", "the found card is revealed (to everyone) before it goes to my hand", () => {
  const { engine, id } = meagerBoard({ top: "item" });
  play(engine, P1, id("mr"), {});
  pick(engine, P1, [id("m_item1")]);
  const reveals = revealEvents(engine);
  const found = reveals.filter((entry) => ((entry.event as unknown as { cardIds: string[] }).cardIds ?? []).includes(id("m_item1")));
  assert.equal(found.length, 1, "the searched card was revealed once");
  const ev = found[0].event as unknown as { cardIds: string[]; viewerId: string; ownerId: string };
  assert.deepEqual(ev.cardIds, [id("m_item1")]);
  assert.equal(ev.viewerId, "all");
  assert.equal(ev.ownerId, P1, "from my deck");
  assert.equal(reveals.length, 2, "two reveals in all: the opponent's top card and my found card");
});

clause(MEAGER, "0:rule", "the search is a 'may': I can take nothing — the opponent still gets the revealed card and my hand and deck are unchanged", () => {
  const { engine, id } = meagerBoard({ top: "character" });
  const myHand = hand(engine, P1).filter((c) => c !== id("mr"));
  const myDeck = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  pick(engine, P1, []);
  assert.equal(zoneOf(engine, id("top")), "hand", "the opponent still gets their revealed card");
  assert.equal(hand(engine, P2).includes(id("top")), true);
  assert.deepEqual(hand(engine, P1), myHand, "I took nothing");
  sameCards(deck(engine, P1), myDeck);
  assert.equal(revealEvents(engine).length, 1, "only the opponent's top card was revealed");
});

clause(MEAGER, "0:rule", "my searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not", () => {
  const { engine, id } = meagerBoard({ top: "character", oppDeckSize: 8 });
  const mine = deck(engine, P1).filter((c) => c !== id("m_character1"));
  const theirs = deck(engine, P2).slice(1);
  play(engine, P1, id("mr"), {});
  pick(engine, P1, [id("m_character1")]);
  sameCards(deck(engine, P1), mine);
  assert.notDeepEqual(deck(engine, P1), mine, "my deck is in a new order");
  assert.deepEqual(deck(engine, P2), theirs, "the opponent's deck keeps its order");
});

clause(MEAGER, "0:rule", "a search where I take nothing also shuffles my deck", () => {
  const { engine, id } = meagerBoard({ top: "character" });
  const mine = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  pick(engine, P1, []);
  sameCards(deck(engine, P1), mine);
  assert.notDeepEqual(deck(engine, P1), mine, "a searched deck is shuffled even when nothing was taken");
});

clause(MEAGER, "0:rule", "when my deck has no card of the revealed type the search finds nothing — and my deck is still shuffled (CR 312.1)", () => {
  const { engine, id } = meagerBoard({ top: "location", myKinds: ["character", "item", "tactic", "resource"] });
  const mine = [...deck(engine, P1)];
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("top")), "hand", "the opponent still gets the revealed card");
  sameCards(deck(engine, P1), mine);
  assert.notDeepEqual(deck(engine, P1), mine, "the deck was searched (and nothing matched), so it is shuffled");
});

clause(MEAGER, "0:rule", "when my deck has no card of the revealed type nothing can be taken, and the other cards stay in the deck", () => {
  const { engine, id } = meagerBoard({ top: "location", myKinds: ["character", "item", "tactic", "resource"] });
  const myHand = hand(engine, P1).filter((c) => c !== id("mr"));
  play(engine, P1, id("mr"), {});
  const pc = pendingOf(engine);
  if (pc) {
    for (const key of ["m_character1", "m_item1", "m_tactic1", "m_resource1"]) assert.throws(() => pick(engine, P1, [id(key)]), `${key} is not a location`);
    pick(engine, P1, []);
  }
  assert.deepEqual(hand(engine, P1), myHand, "my hand did not change");
  assert.equal(zoneOf(engine, id("m_character1")), "deck");
});

clause(MEAGER, "0:rule", "the revealed type is judged by the card actually revealed: a different top card gives a different legal set (resource vs character)", () => {
  const res = meagerBoard({ top: "resource" });
  play(res.engine, P1, res.id("mr"), {});
  assert.throws(() => pick(res.engine, P1, [res.id("m_character1")]));
  pick(res.engine, P1, [res.id("m_resource1")]);
  assert.equal(zoneOf(res.engine, res.id("m_resource1")), "hand");
  const chr = meagerBoard({ top: "character" });
  play(chr.engine, P1, chr.id("mr"), {});
  assert.throws(() => pick(chr.engine, P1, [chr.id("m_resource1")]));
  pick(chr.engine, P1, [chr.id("m_character1")]);
  assert.equal(zoneOf(chr.engine, chr.id("m_character1")), "hand");
});

clause(MEAGER, "0:rule", "with the opponent's deck empty there is no revealed card: nothing is put into any hand and no card of mine moves", () => {
  const { engine, id } = meagerBoard({ oppDeckSize: 0 });
  const oppHand = [...hand(engine, P2)];
  const myHand = hand(engine, P1).filter((c) => c !== id("mr"));
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.deepEqual(hand(engine, P2), oppHand, "the opponent's hand did not change");
  assert.deepEqual(hand(engine, P1), myHand, "no type was revealed, so nothing of mine was found");
  assert.equal(zoneOf(engine, id("mr")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MEAGER, "0:rule", "my own deck's top card is never the one revealed — only the opponent's", () => {
  const { engine, id } = meagerBoard({ top: "character" });
  const myTop = deck(engine, P1)[0];
  play(engine, P1, id("mr"), {});
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, myTop), "deck", "my top card stayed in my deck");
  assert.equal(zoneOf(engine, id("top")), "hand");
});

// ===============================================================================
// Micromajig tokens (shared by Avalanche, Factory, Maker and Master).
// "(Treat Micromajig tokens as Gearsmith character cards with 1 strength, 1 life,
// and 3 speed. When they leave play, remove them from the game.)"
// ===============================================================================

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

/** "When they leave play, remove them from the game": however a token leaves play, it ceases to exist — it never reaches a hand, deck or discard pile. */
function assertTokenLeavesTheGame(board: MicroBoard, tokens: string[]) {
  const { engine, id } = board;
  const [first, second, third] = tokens;
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  const victims = [first, second, third].filter(Boolean);
  const handBefore = [...hand(engine, P1)];
  const deckBefore = [...deck(engine, P1)];
  const discardBefore = [...discard(engine, P1)];
  let i = 0;
  for (const [key, label] of sends) {
    if (!zoneOf(engine, id(key))) continue;
    const victim = victims[i % victims.length];
    if (zoneOf(engine, victim) !== "play") continue;
    play(engine, P1, id(key), { selected: { t: [victim] } });
    drain(engine, declineAll);
    assertGone(engine, victim, label);
    i++;
  }
  assert.ok(i >= 1, "at least one token left play");
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
  assert.equal(battleOf(engine), undefined);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  declareAttackBy(engine, P2, [id("foe")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [token] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [token], "the token blocks");
}

// ===============================================================================
// Micromajig Avalanche — COST: Pick a value for X. Pay twice X. EFFECT: Put X
// Micromajig tokens into play. (token reminder)
// Tactic, cost 0, threshold [E][E][E][E].
// ===============================================================================

const AVALANCHE = "b6aa3573-a252-4bbf-9237-906d2cdde193";

function avalancheBoard(opts: { elitism?: number; greed?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "av", def: printing(AVALANCHE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
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
  });
}

clause(AVALANCHE, "0:ability", "X is my choice and may be 0: it is playable for no resources at all (but still needs [E][E][E][E])", () => {
  const free = avalancheBoard({ elitism: 4 });
  const before = ready(free.engine);
  play(free.engine, P1, free.id("av"), { variables: { x: 0 } });
  assert.equal(before - ready(free.engine), 0, "X=0 costs nothing");
  assert.equal(zoneOf(free.engine, free.id("av")), "discard", "X=0 is a legal value: the tactic resolves");
  assert.equal(allMicromajigs(free.engine).length, 0);
});

clause(AVALANCHE, "0:ability", "the printed cost is 'twice X', not X: 4 resources buy X=2 but not X=3, and an odd count never buys the extra token", () => {
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
  assert.throws(() => playRaw(noE.engine, P1, noE.id("av"), { variables: { x: 1 } }));
  const four = avalancheBoard({ elitism: 4, greed: 6 });
  play(four.engine, P1, four.id("av"), { variables: { x: 5 } });
  assert.equal(micromajigs(four.engine, P1).length, 5, "the icons are a gate, not spent: 10 resources pay for X=5");
  assert.equal(ready(four.engine), 0);
});

clause(AVALANCHE, "0:ability", "tokens are put into play, not deployed: the tactic resolves with no further choice and no card is drawn or discarded", () => {
  const { engine, id } = avalancheBoard();
  const handBefore = hand(engine, P1).filter((c) => c !== id("av"));
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(hand(engine, P1), handBefore, "my hand lost only the tactic");
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

clause(AVALANCHE, "1:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they are removed from the game: never in a hand, deck or discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 3 } });
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(AVALANCHE, "1:rule", "a token dies to 1 damage and is removed from the game, not put into the discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 2 } });
  const [token, other] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, other), "play", "the other token is untouched");
});

clause(AVALANCHE, "1:rule", "a token has exactly 1 life: 1 damage kills it; no more and no less is needed (the 4-life Foe survives 1)", () => {
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

// ===============================================================================
// Micromajig Factory — WIND UP: COST: Pay 4. EFFECT: Put a Micromajig token into
// play. (token reminder)
// Location, cost 1, threshold [E][E][E], structure 5.
// ===============================================================================

const FACTORY = "040f72fb-1b6a-4b7b-aa30-904f1199fc66";

function factoryBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mf", def: printing(FACTORY), owner: P1, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
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

clause(FACTORY, "0:ability:windup", "deploys for its printed cost of 1 with [E][E][E], is refused without them, and has structure 5", () => {
  const { engine, id } = factoryBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mf"), {});
  assert.equal(zoneOf(engine, id("mf")), "play");
  assert.equal(before - ready(engine), 1, "cost 1");
  const noThreshold = factoryBoard({ zone: "hand", elitism: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("mf")), "two [E] is one short of [E][E][E]");
  const none = factoryBoard({ zone: "hand", elitism: 0, greed: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("mf")), "no resources at all");
});

clause(FACTORY, "0:ability:windup", "the Factory is a location with structure 5: 4 damage leaves it standing, 5 destroys it", () => {
  const board = factoryBoard();
  const { engine, id } = board;
  play(engine, P1, id("zapLoc"), { selected: { t: [id("mf")] } });
  assert.equal(zoneOf(engine, id("mf")), "play", "4 damage < 5 structure");
  assert.equal(engine.state.cards[id("mf")].damage, 4);
  engine.state.cards[id("mf")].damage = 5;
  assert.equal(engine.getDefinition(id("mf")).structure, 5);
  // the state-based check runs after the next action
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

clause(FACTORY, "1:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they are removed from the game: never in a hand, deck or discard pile", () => {
  const board = factoryBoard({ elitism: 12 });
  for (let i = 0; i < 3; i++) activate(board.engine, P1, board.id("mf"), "windup");
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

// ===============================================================================
// Micromajig Maker — When this card enters play, you may put a Micromajig token
// into play. (token reminder)
// Character (inventor), cost 2, threshold [E][E], 1 strength / 3 speed / 1 life.
// ===============================================================================

const MAKER = "497ffcb2-6a2e-40ee-a91d-1d608ecd7225";

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

/** Answers every "you may ..." option prompt (and any trigger-ordering prompt) the same way: accept or decline. */
function mayAnswerer(accept: boolean) {
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind === "chooserSelectsOption") {
      const options = pc.options as Array<{ label?: string }>;
      const index = options.findIndex((o) => (accept ? !/decline|no|nothing/i.test(o.label ?? "") : /decline|no|nothing/i.test(o.label ?? "")));
      return { kind: "chooserSelectsOption", index };
    }
    return declineAll(pc);
  };
}

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

clause(MAKER, "0:rule", "deploys for its printed cost of 2 with [E][E] (one resource short or one [E] short is refused) and has its printed 1/1/3 stats", () => {
  const { engine, id } = makerBoard({ elitism: 2 });
  const before = ready(engine);
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 2, "cost 2");
  assert.deepEqual(stat(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["inventor"]);
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

clause(MAKER, "1:rule", "when the token leaves play (destroyed, bounced, decked, voided, removed) it is removed from the game: never in a hand, deck or discard pile", () => {
  for (const key of ["sendDestroy", "sendHand", "sendDeck", "sendVoid", "sendRemove"]) {
    const board = makerBoard();
    play(board.engine, P1, board.id("mm"), {});
    answerMay(board.engine, P1, true);
    const [token] = micromajigs(board.engine, P1);
    play(board.engine, P1, board.id(key), { selected: { t: [token] } });
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
// Micromajig Master — When this card enters play, you may put 2 Micromajig tokens
// into play. OVERWORK -- COST: Destroy 3 Micromajig tokens you control. --
// EFFECT: Search your deck for a card and put it into your hand. (token reminder)
// Character (manager), cost 3, threshold [E][E], 1 strength / 3 speed / 1 life.
// ===============================================================================

const MASTER = "71148cc0-f98a-4636-a0ed-2c5c0b206cae";

function masterBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; mine?: number; theirs?: number } = {}) {
  const owner = opts.owner ?? P1;
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MASTER), owner, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "mkMine", def: makeTokensTactic(1, "controller"), owner, zone: "hand" },
      { key: "mkTheirs", def: makeTokensTactic(1, "opponent"), owner, zone: "hand" },
      ...microExtras(),
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

/** Puts a used tactic back into its owner's hand so a board can make several tokens with it. */
function regive(engine: SpoilsEngine, cardId: string, owner: Pid) {
  const card = engine.state.cards[cardId];
  const state = engine.state.players[owner];
  state.discard = state.discard.filter((c) => c !== cardId);
  state.hand.push(cardId);
  card.zone = "hand";
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

clause(MASTER, "0:rule", "deploys for its printed cost of 3 with [E][E] (one resource short or one [E] short is refused) and has its printed 1/1/3 stats", () => {
  const { engine, id } = masterBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mm"), {});
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 3, "cost 3");
  assert.deepEqual(stat(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["manager"]);
  const short = masterBoard({ zone: "hand", elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("mm")), "one resource short");
  const oneE = masterBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]");
});

// --- OVERWORK

/** Uses OVERWORK, destroying the given tokens. */
function overwork(engine: SpoilsEngine, id: (k: string) => string, tokens: string[], player: Pid = P1) {
  activateRaw(engine, player, id("mm"), "tiny", { selected: { toks: tokens } });
  resolvePendingResponses(engine);
}

clause(MASTER, "1:ability:tiny", "destroys exactly 3 of my Micromajig tokens as its cost, then I search my deck and put the chosen card into my hand", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 3);
  const before = ready(engine);
  const handBefore = [...hand(engine, P1)];
  overwork(engine, id, tokens);
  for (const t of tokens) assertGone(engine, t, "OVERWORK cost");
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

clause(MASTER, "1:ability:tiny", "with more than 3 tokens only the 3 chosen are destroyed; the others stay in play", () => {
  const { engine, id } = masterBoard({ mine: 5 });
  const tokens = micromajigs(engine, P1);
  const chosen = [tokens[1], tokens[3], tokens[4]];
  overwork(engine, id, chosen);
  for (const t of chosen) assertGone(engine, t, "chosen");
  for (const t of [tokens[0], tokens[2]]) assert.equal(zoneOf(engine, t), "play", "an unchosen token stays");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "any search result is possible: a character, an item or a tactic", () => {
  for (const key of ["fillA", "fillD", "fillE"]) {
    const { engine, id } = masterBoard({ mine: 3 });
    overwork(engine, id, micromajigs(engine, P1));
    pick(engine, P1, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(MASTER, "1:ability:tiny", "only a card from MY deck can be found: the opponent's deck, my hand and my discard pile are refused, and only one card", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  overwork(engine, id, micromajigs(engine, P1));
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
  overwork(engine, id, micromajigs(engine, P1));
  assert.throws(() => pick(engine, P1, []), "an unconditional search for a card must find one when the deck has any");
  assert.deepEqual(hand(engine, P1), handBefore);
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "the search is still open");
});

clause(MASTER, "1:ability:tiny", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const before = deck(engine, P1).filter((c) => c !== id("fillC"));
  const theirs = [...deck(engine, P2)];
  overwork(engine, id, micromajigs(engine, P1));
  pick(engine, P1, [id("fillC")]);
  sameCards(deck(engine, P1), before);
  assert.notDeepEqual(deck(engine, P1), before, "in a new order");
  assert.deepEqual(deck(engine, P2), theirs);
});

clause(MASTER, "1:ability:tiny", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  overwork(engine, id, micromajigs(engine, P1));
  pick(engine, P1, [id("fillA")]);
  assert.equal(revealEvents(engine).length, 0);
});

clause(MASTER, "1:ability:tiny", "is refused with only 2 tokens (one short), and nothing is destroyed or searched", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => overwork(engine, id, tokens), "2 tokens < 3");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.throws(() => overwork(engine, id, []), "no tokens chosen");
  const none = masterBoard({ mine: 0 });
  assert.throws(() => overwork(none.engine, none.id, []), "no tokens at all");
});

clause(MASTER, "1:ability:tiny", "needs exactly 3 chosen: 2 or 4 chosen tokens are refused even with 4 on the board", () => {
  const { engine, id } = masterBoard({ mine: 4 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => overwork(engine, id, tokens.slice(0, 2)), "two chosen");
  assert.throws(() => overwork(engine, id, tokens), "four chosen");
  assert.equal(micromajigs(engine, P1).length, 4, "nothing was destroyed by the refused attempts");
  overwork(engine, id, tokens.slice(0, 3));
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MASTER, "1:ability:tiny", "the same token cannot be chosen three times", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const [t] = micromajigs(engine, P1);
  assert.throws(() => overwork(engine, id, [t, t, t]));
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "only tokens I CONTROL can be destroyed: the opponent's Micromajig tokens are refused", () => {
  const { engine, id } = masterBoard({ mine: 2, theirs: 2 });
  const mine = micromajigs(engine, P1);
  const theirs = micromajigs(engine, P2);
  assert.equal(mine.length, 2);
  assert.equal(theirs.length, 2);
  assert.throws(() => overwork(engine, id, [...mine, theirs[0]]), "two of mine and one of theirs");
  assert.throws(() => overwork(engine, id, [mine[0], theirs[0], theirs[1]]), "one of mine and two of theirs");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 2);
});

clause(MASTER, "1:ability:tiny", "only Micromajig tokens count: other characters (mine or theirs), the Master itself and non-characters are refused", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  assert.throws(() => overwork(engine, id, [...tokens, id("ally")]), "my other character");
  assert.throws(() => overwork(engine, id, [...tokens, id("foe")]), "their character");
  assert.throws(() => overwork(engine, id, [...tokens, id("mm")]), "the Master itself");
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "a depleted token can still be destroyed for the cost", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.cards[tokens[0]].depleted = true;
  overwork(engine, id, tokens);
  for (const t of tokens) assertGone(engine, t, "cost");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
});

clause(MASTER, "1:ability:tiny", "can be used again: 6 tokens pay for it twice", () => {
  const { engine, id } = masterBoard({ mine: 6 });
  const tokens = micromajigs(engine, P1);
  overwork(engine, id, tokens.slice(0, 3));
  pick(engine, P1, [id("fillA")]);
  overwork(engine, id, tokens.slice(3, 6));
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
  assert.throws(() => overwork(engine, id, tokens, P2));
  assert.equal(micromajigs(engine, P1).length, 3);
  const inHand = masterBoard({ zone: "hand", mine: 3 });
  assert.throws(() => overwork(inHand.engine, inHand.id, micromajigs(inHand.engine, P1)), "the Master is in hand");
  assert.equal(micromajigs(inHand.engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "a token that is destroyed is removed from the game (not put into my discard pile) when paid as the cost", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const discardBefore = [...discard(engine, P1)];
  overwork(engine, id, micromajigs(engine, P1));
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

clause(MASTER, "2:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they are removed from the game: never in a hand, deck or discard pile", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"), {});
  answerMay(board.engine, P1, true);
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
// RAAR! -- COST: Pay 2. -- EFFECT: This turn, this card becomes a character with 3
// strength, 3 life, and 3 speed. (It is still an item.)
// SCHPROING! -- COST: Use this only during your turn. Pay 2. -- EFFECT: If this
// card is a character, it gains COVERT.
// HIDE! -- COST: Pay 1. -- EFFECT: This card is no longer a character. Deplete this card.
// ===============================================================================

const POGO = "d01ff5fd-a355-4307-9acd-0f9087f671ed";

function pogoBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; active?: Pid; turn?: number; pogoOwner?: Pid } = {}) {
  const owner = opts.pogoOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: opts.turn ?? 1,
    cards: [
      { key: "pb", def: printing(POGO), owner, zone: opts.zone ?? "play" },
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

const typesOf = (engine: SpoilsEngine, cardId: string) => [...engine.getCardTypes(cardId)].sort();
const isCharacter = (engine: SpoilsEngine, cardId: string) => engine.getCardTypes(cardId).includes("character");

clause(POGO, "0:ability:raar", "RAAR! pays exactly 2; this turn the item is also a character with 3 strength, 3 life and 3 speed", () => {
  const { engine, id } = pogoBoard();
  assert.deepEqual(typesOf(engine, id("pb")), ["item"], "control: a plain item before RAAR!");
  const before = ready(engine);
  activate(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.deepEqual(stat(engine, id("pb")), [3, 3, 3]);
  assert.ok(isCharacter(engine, id("pb")), "it is a character");
});

clause(POGO, "0:ability:raar", "'It is still an item': it keeps the item type and an item-targeting card can still pick it", () => {
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
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "raar", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.battle?.phase, "blocking");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pb")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("pb")], "the animated item blocks");
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("foe")].damage, 3, "it dealt 3 battle damage (3 strength)");
  assert.equal(zoneOf(engine, id("pb")), "play", "1 damage < 3 life");
  assert.equal(engine.state.cards[id("pb")].damage, 1);
});

clause(POGO, "0:ability:raar", "using it twice in a turn costs 4 in all and the stats do not stack (still 3/3/3)", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "raar");
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("pb")), [3, 3, 3]);
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

clause(POGO, "1:ability:schproing", "if the Pogo-Bear is not a character the cost is paid but it gains nothing", () => {
  const { engine, id } = pogoBoard();
  const before = ready(engine);
  activate(engine, P1, id("pb"), "schproing");
  assert.equal(before - ready(engine), 2, "the 2 resources were paid");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "an item gains no keyword from 'if this card is a character'");
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "and the earlier use did not store COVERT for later");
});

/**
 * The opponent (P2) attacks with `foe` and passes: I (P1) now hold priority in the battle's response window
 * — the only moment an ability can be used on the opponent's turn.
 */
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

clause(POGO, "1:ability:schproing", "'use this only during your turn': refused on the opponent's turn (even in a response window where I may use other abilities), allowed on mine", () => {
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

clause(POGO, "1:ability:schproing", "the COVERT granted is gone by the next turn", () => {
  const { engine, id } = pogoBoard();
  activate(engine, P1, id("pb"), "raar");
  activate(engine, P1, id("pb"), "schproing");
  assert.ok(engine.getKeywords(id("pb")).includes("covert"), "engine.getKeywords(id(\"pb\")).includes(\"covert\")");
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("pb"), "raar");
  assert.equal(engine.getKeywords(id("pb")).includes("covert"), false, "a character again next turn, but without the old COVERT");
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
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "raar", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pb")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("pb")]);
  // the battle's first response window: the attacker passes, then I respond
  const window = engine.state.responseWindow;
  if (window && window.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "hide", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(isCharacter(engine, id("pb")), false);
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], [], "it left the blocking party");
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

// ===============================================================================
// Precise Sabotage — COST: Pick an item. EFFECT: Destroy the item.
// Tactic, cost 3, threshold [E].
// ===============================================================================

const SABOTAGE = "5c255291-fcc3-4da2-bb84-963d3b7ca378";

function sabotageBoard(opts: { elitism?: number; greed?: number; noItems?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ps", def: printing(SABOTAGE), owner: P1, zone: "hand" },
      ...(opts.noItems
        ? []
        : [
            { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" as const },
            { key: "theirItem", def: item({ name: "TheirItem", subtype: ["gear"] }), owner: P2, zone: "play" as const },
            { key: "otherItem", def: item({ name: "OtherItem" }), owner: P2, zone: "play" as const }
          ]),
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: item({ name: "FaceDownItem" }), owner: P2, zone: "play", faceDown: true },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P2, zone: "hand" },
      { key: "deckItem", def: item({ name: "DeckItem" }), owner: P2, zone: "deck" },
      { key: "discardItem", def: item({ name: "DiscardItem" }), owner: P2, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(SABOTAGE, "0:ability", "pays exactly 3, destroys the picked item (mine or theirs) into its owner's discard pile, and no other item", () => {
  for (const [key, owner] of [["theirItem", P2], ["myItem", P1]] as const) {
    const { engine, id } = sabotageBoard();
    const before = ready(engine);
    play(engine, P1, id("ps"), { selected: { i: [id(key)] } });
    assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} is destroyed`);
    assert.equal(discard(engine, owner).includes(id(key)), true, "into its owner's discard pile");
    for (const other of ["myItem", "theirItem", "otherItem"].filter((k) => k !== key)) assert.equal(zoneOf(engine, id(other)), "play", `${other} is untouched`);
    assert.equal(zoneOf(engine, id("myChar")), "play");
    assert.equal(zoneOf(engine, id("foe")), "play");
    assert.equal(zoneOf(engine, id("place")), "play");
    assert.equal(zoneOf(engine, id("ps")), "discard", "the tactic ends in my discard pile");
  }
});

clause(SABOTAGE, "0:ability", "only an item in play can be picked: characters, locations, factions, face-down cards and items in hand / deck / discard are refused", () => {
  const { engine, id } = sabotageBoard();
  const attempt = (picked: string) => () => playRaw(engine, P1, id("ps"), { selected: { i: [picked] } });
  assert.throws(attempt(id("myChar")), "a character");
  assert.throws(attempt(id("foe")), "an opponent's character");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my own faction");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(id("handItem")), "an item in a hand");
  assert.throws(attempt(id("deckItem")), "an item in a deck");
  assert.throws(attempt(id("discardItem")), "an item in a discard pile");
  assert.equal(zoneOf(engine, id("ps")), "hand");
  assert.equal(ready(engine), 5, "nothing was spent");
  attempt(id("otherItem"))();
  assert.ok(engine.state.responseWindow, "an item in play is accepted");
});

clause(SABOTAGE, "0:ability", "exactly one item is picked: none, or two, is refused", () => {
  const { engine, id } = sabotageBoard();
  assert.throws(() => playRaw(engine, P1, id("ps"), { selected: { i: [] } }), "no item picked");
  assert.throws(() => playRaw(engine, P1, id("ps"), { selected: {} }), "nothing picked");
  assert.throws(() => playRaw(engine, P1, id("ps"), { selected: { i: [id("myItem"), id("theirItem")] } }), "two items");
  assert.equal(zoneOf(engine, id("myItem")), "play");
  assert.equal(zoneOf(engine, id("theirItem")), "play");
});

clause(SABOTAGE, "0:ability", "with no item in play there is nothing to pick, so it cannot be played", () => {
  const { engine, id } = sabotageBoard({ noItems: true });
  assert.throws(() => playRaw(engine, P1, id("ps"), { selected: {} }));
  assert.equal(zoneOf(engine, id("ps")), "hand");
  assert.equal(ready(engine), 5);
});

clause(SABOTAGE, "0:ability", "an item that is also a character (an animated Pogo-Bear) is still an item and can be picked", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ps", def: printing(SABOTAGE), owner: P1, zone: "hand" },
      { key: "pb", def: printing(POGO), owner: P1, zone: "play" },
      ...bank("elitism", 7, P1)
    ]
  });
  activate(engine, P1, id("pb"), "raar");
  assert.ok(isCharacter(engine, id("pb")), "isCharacter(engine, id(\"pb\"))");
  play(engine, P1, id("ps"), { selected: { i: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "discard");
});

clause(SABOTAGE, "0:ability", "destroying an item takes away what it gave: an attached Luteoderm Prototype stops buffing its host", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ps", def: printing(SABOTAGE), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "lp", def: printing(LUTEODERM), owner: P2, zone: "play", attachedToKey: "host" },
      ...bank("elitism", 3, P1)
    ]
  });
  assert.deepEqual(stat(engine, id("host")), [3, 3, 1]);
  play(engine, P1, id("ps"), { selected: { i: [id("lp")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.deepEqual(stat(engine, id("host")), [2, 2, 1]);
});

clause(SABOTAGE, "0:ability", "if the picked item is gone before the tactic resolves nothing else is destroyed", () => {
  const killItem = tactic({ name: "OppKillItem", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ps", def: printing(SABOTAGE), owner: P1, zone: "hand" },
      { key: "k", def: killItem, owner: P2, zone: "hand" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "otherItem", def: item({ name: "OtherItem" }), owner: P2, zone: "play" },
      ...bank("elitism", 3, P1)
    ]
  });
  playRaw(engine, P1, id("ps"), { selected: { i: [id("theirItem")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("k"), selected: { t: [id("theirItem")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("theirItem")), "discard");
  assert.equal(zoneOf(engine, id("otherItem")), "play", "no other item was destroyed in its place");
  assert.equal(zoneOf(engine, id("ps")), "discard", "the tactic still ends in the discard pile");
});

clause(SABOTAGE, "0:ability", "is refused with only 2 resources (one short), and without [E] even with plenty of other resources", () => {
  const short = sabotageBoard({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ps"), { selected: { i: [short.id("theirItem")] } }));
  assert.equal(zoneOf(short.engine, short.id("theirItem")), "play");
  const noThreshold = sabotageBoard({ elitism: 0, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ps"), { selected: { i: [noThreshold.id("theirItem")] } }));
  const exact = sabotageBoard({ elitism: 1, greed: 2 });
  play(exact.engine, P1, exact.id("ps"), { selected: { i: [exact.id("theirItem")] } });
  assert.equal(zoneOf(exact.engine, exact.id("theirItem")), "discard", "one [E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// ===============================================================================
// Research Assistant — RESEARCH -- COST: Deplete this card. -- EFFECT: The next
// numeric cost you pay this turn costs up to 1 less.
// Character (31f), cost 2, threshold [E][E], 1 strength / 2 speed / 1 life.
// ===============================================================================

const ASSISTANT = "871550db-572a-4046-a301-b42e2e89d137";

/** An item with a numeric ability cost: ABILITY pays `cost` (id `a`), gives nothing. */
function payItem(cost: number, name = "PayItem"): CardDefinition {
  return item({
    name,
    behavior: { abilities: [{ id: "a", type: "activated", costs: [{ type: "payResources", amount: cost }], effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
  });
}

function assistantBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(ASSISTANT), owner: P1, zone: opts.zone ?? "play" },
      { key: "ra2", def: printing(ASSISTANT), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "c3b", def: character({ name: "Cost3b", cost: 3 }), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Cost1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "Cost0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "payItem", def: payItem(3), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(ASSISTANT, "0:ability:research", "RESEARCH depletes the Assistant as its cost", () => {
  const { engine, id } = assistantBoard();
  assert.equal(engine.state.cards[id("ra")].depleted, false);
  const before = ready(engine);
  activate(engine, P1, id("ra"), "research");
  assert.equal(engine.state.cards[id("ra")].depleted, true, "COST: Deplete this card");
  assert.equal(before - ready(engine), 0, "it costs no resources");
  assert.equal(engine.state.cards[id("ra2")].depleted, false, "another Assistant is not depleted");
});

clause(ASSISTANT, "0:ability:research", "the next numeric cost I pay this turn is 1 less: a 3-cost character costs 2", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(zoneOf(engine, id("c3")), "play");
  assert.equal(before - ready(engine), 2, "3 - 1 = 2 resources paid");
});

clause(ASSISTANT, "0:ability:research", "only the NEXT cost: the second 3-cost character pays the full 3", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  play(engine, P1, id("c3"), {});
  const before = ready(engine);
  play(engine, P1, id("c3b"), {});
  assert.equal(before - ready(engine), 3, "the reduction was used up by the first");
});

clause(ASSISTANT, "0:ability:research", "'up to 1 less': a 1-cost card is free after RESEARCH, and the reduction never makes a cost negative", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  const before = ready(engine);
  play(engine, P1, id("c1"), {});
  assert.equal(before - ready(engine), 0, "1 - 1 = 0");
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.ok(ready(engine) <= before, "no resource appeared");
});

clause(ASSISTANT, "0:ability:research", "the reduction also applies to a numeric ability cost I pay (pay 3 becomes pay 2; CR 406.5)", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 2, "a 'pay 3' ability costs 2 after RESEARCH");
  const next = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(next - ready(engine), 3, "and the next use pays in full");
});

clause(ASSISTANT, "0:ability:research", "an ability's numeric cost is the next numeric cost: it uses the reduction up, so the following card then costs full", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  activate(engine, P1, id("payItem"), "a");
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 3);
});

clause(ASSISTANT, "0:ability:research", "'up to 1 less': RESEARCH asks its controller how much to reduce, 0 or 1, after depleting the Assistant", () => {
  const { engine, id } = assistantBoard();
  activateBase(engine, P1, id("ra"), "research");
  assert.equal(engine.state.cards[id("ra")].depleted, true, "COST: Deplete this card");
  const pc = pendingOf(engine);
  assert.ok(pc, "the controller is asked how much to reduce");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 1);
});

for (const [value, paid] of [
  [1, 2],
  [0, 3]
] as const) {
  clause(ASSISTANT, "0:ability:research", `choosing ${value} reduces the next numeric cost by exactly ${value}: a 3-cost character pays ${paid}`, () => {
    const { engine, id } = assistantBoard();
    activateBase(engine, P1, id("ra"), "research");
    answerUpTo(engine, P1, value);
    assert.equal(pendingOf(engine), undefined, "the choice is answered");
    const before = ready(engine);
    play(engine, P1, id("c3"), {});
    assert.equal(zoneOf(engine, id("c3")), "play");
    assert.equal(before - ready(engine), paid);
  });
}

clause(ASSISTANT, "0:ability:research", "more than 1 (or a negative number) is refused: the choice stays open, and 1 is still accepted", () => {
  const { engine, id } = assistantBoard();
  activateBase(engine, P1, id("ra"), "research");
  for (const value of [2, -1]) {
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never),
      /Choose an integer/,
      `${value} is outside 0 to 1`
    );
    assert.equal(pendingOf(engine)?.kind, "chooseNumber", "the choice is still open");
  }
  answerUpTo(engine, P1, 1);
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 2);
});

clause(ASSISTANT, "0:ability:research", "two RESEARCHes (two Assistants) save 2 resources in all across the next numeric costs", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  activate(engine, P1, id("ra2"), "research");
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  const spentFirst = before - ready(engine);
  const mid = ready(engine);
  play(engine, P1, id("c3b"), {});
  const spentSecond = mid - ready(engine);
  assert.equal(spentFirst + spentSecond, 6 - 2, "two RESEARCHes save 2 resources in all across the next numeric costs");
});

clause(ASSISTANT, "0:ability:research", "it does not last past this turn: unused, the reduction is gone on my next turn", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 3, "no reduction left over");
});

clause(ASSISTANT, "0:ability:research", "it reduces only MY cost: the opponent's Assistant reduces their next cost, not mine", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(ASSISTANT), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "opener", def: tactic({ name: "Opener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      ...bank("elitism", 8, P1),
      ...bank("elitism", 8, P2)
    ]
  });
  // my turn: I play a free tactic, the opponent responds by using their Assistant
  playRaw(engine, P1, id("opener"), {});
  activateRaw(engine, P2, id("ra"), "research");
  resolvePendingResponses(engine);
  answerUpTo(engine, P2);
  assert.equal(engine.state.cards[id("ra")].depleted, true);
  const mine = ready(engine, P1);
  play(engine, P1, id("c3"), {});
  assert.equal(mine - ready(engine, P1), 3, "my character costs the full 3");
});

clause(ASSISTANT, "0:ability:research", "cannot be used again while depleted; works again once restored on my next turn", () => {
  const { engine, id } = assistantBoard();
  activate(engine, P1, id("ra"), "research");
  assert.throws(() => activateRaw(engine, P1, id("ra"), "research"), "already depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("ra")].depleted, false, "restored at the start of my turn");
  activate(engine, P1, id("ra"), "research");
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 2);
});

clause(ASSISTANT, "0:ability:research", "usable the turn it enters play (a character may use its abilities the turn it arrives, CR 204.3a), and from play only", () => {
  const { engine, id } = assistantBoard({ zone: "hand" });
  assert.throws(() => activateRaw(engine, P1, id("ra"), "research"), "in hand it has no abilities to use");
  play(engine, P1, id("ra"), {});
  activate(engine, P1, id("ra"), "research");
  assert.equal(engine.state.cards[id("ra")].depleted, true);
});

clause(ASSISTANT, "0:ability:research", "only its controller can use it", () => {
  const { engine, id } = assistantBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("ra"), "research"));
  assert.equal(engine.state.cards[id("ra")].depleted, false);
});

clause(ASSISTANT, "0:ability:research", "deploys for its printed cost of 2 with [E][E]; one resource short or one [E] short is refused; it has its printed 1/1/2 stats", () => {
  const { engine, id } = assistantBoard({ zone: "hand", elitism: 2 });
  const before = ready(engine);
  play(engine, P1, id("ra"), {});
  assert.equal(before - ready(engine), 2);
  assert.deepEqual(stat(engine, id("ra")), [1, 1, 2]);
  assert.deepEqual(engine.getSubtypes(id("ra")), ["31f"]);
  const short = assistantBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ra")));
  const oneE = assistantBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("ra")), "one [E] is not [E][E]");
});

// ===============================================================================
// Research Investment — Both players may search their deck for up to 5 staple
// resources and put them into play.
// Tactic, cost 0, threshold [E][E][E][E].
// ===============================================================================

const INVESTMENT = "828a6b95-9e5f-4035-b348-6258c1937c87";

const STAPLE_ICONS = ["rage", "greed", "deception", "elitism", "obsession"] as const;

function investmentBoard(opts: { elitism?: number; greed?: number; stapleCount?: number; oppStapleCount?: number; active?: Pid } = {}) {
  const staple = (name: string, icon: (typeof STAPLE_ICONS)[number]) => resourceCard({ name, resource: { provides: [icon], staple: true } });
  const mk = (owner: Pid, prefix: string, count: number): CardPlacement[] => [
    ...Array.from({ length: count }, (_, i) => ({ key: `${prefix}s${i}`, def: staple(`${prefix}Staple${i}`, STAPLE_ICONS[i % 5]), owner, zone: "deck" as const })),
    { key: `${prefix}nonStaple`, def: resourceCard({ name: `${prefix}NonStaple`, resource: { provides: ["rage"], staple: false } }), owner, zone: "deck" },
    { key: `${prefix}char`, def: character({ name: `${prefix}Char` }), owner, zone: "deck" },
    { key: `${prefix}item`, def: item({ name: `${prefix}Item` }), owner, zone: "deck" },
    { key: `${prefix}tac`, def: tactic({ name: `${prefix}Tac` }), owner, zone: "deck" },
    { key: `${prefix}loc`, def: location({ name: `${prefix}Loc` }), owner, zone: "deck" },
    { key: `${prefix}fill1`, def: character({ name: `${prefix}Fill1` }), owner, zone: "deck" },
    { key: `${prefix}fill2`, def: character({ name: `${prefix}Fill2` }), owner, zone: "deck" },
    { key: `${prefix}inHand`, def: staple(`${prefix}HandStaple`, "rage"), owner, zone: "hand" },
    { key: `${prefix}inDiscard`, def: staple(`${prefix}DiscardStaple`, "rage"), owner, zone: "discard" }
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ri", def: printing(INVESTMENT), owner: P1, zone: "hand" },
      { key: "opener", def: tactic({ name: "Opener", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      ...mk(P1, "a", opts.stapleCount ?? 7),
      ...mk(P2, "b", opts.oppStapleCount ?? 7),
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** The staple resources (from the deck lists above) a player has in play. */
const staplesIn = (engine: SpoilsEngine, player: Pid) =>
  Object.values(engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === player && /Staple\d/.test(engine.getDefinition(c.id).name));

/** Plays Research Investment and answers each player's search with `picks` (a list of keys per player); returns who was asked, in order. */
function investmentRun(board: ReturnType<typeof investmentBoard>, picks: Record<Pid, string[]>) {
  const { engine, id } = board;
  play(engine, P1, id("ri"), {});
  const asked: string[] = [];
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      asked.push(pc.playerId);
      return { kind: "chooserSelectsTarget", selected: (picks[pc.playerId as Pid] ?? []).map(id) };
    }
    return declineAll(pc);
  });
  return asked;
}

clause(INVESTMENT, "0:rule", "each player may search their own deck: both are asked once, and each takes up to 5 staple resources into play", () => {
  const board = investmentBoard();
  const { engine, id } = board;
  const mineBefore = ready(engine, P1);
  const theirsBefore = ready(engine, P2);
  const asked = investmentRun(board, { [P1]: ["as0", "as1", "as2", "as3", "as4"], [P2]: ["bs2", "bs3", "bs4", "bs5", "bs6"] } as Record<Pid, string[]>);
  assert.deepEqual([...asked].sort(), [P1, P2], "each player is asked exactly once");
  for (const key of ["as0", "as1", "as2", "as3", "as4"]) {
    assert.equal(zoneOf(engine, id(key)), "play", key);
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
    assert.equal(engine.state.cards[id(key)].faceDown, false, "face-up");
  }
  for (const key of ["bs2", "bs3", "bs4", "bs5", "bs6"]) {
    assert.equal(zoneOf(engine, id(key)), "play", key);
    assert.equal(engine.state.cards[id(key)].controllerId, P2);
    assert.equal(engine.state.cards[id(key)].faceDown, false, "face-up");
  }
  assert.equal(zoneOf(engine, id("as5")), "deck", "a sixth staple is not taken");
  assert.equal(zoneOf(engine, id("bs0")), "deck", "the opponent's unpicked staples stay");
  assert.equal(ready(engine, P1) - mineBefore, 5, "five new usable resources for me");
  assert.equal(ready(engine, P2) - theirsBefore, 5, "five new usable resources for the opponent");
  assert.equal(zoneOf(engine, id("ri")), "discard", "the tactic ends in my discard pile");
});

clause(INVESTMENT, "0:rule", "'up to 5' is a maximum: 3 cards, 1 card, or none at all are fine", () => {
  for (const [mine, theirs] of [[3, 0], [1, 5], [0, 2]] as const) {
    const board = investmentBoard();
    const { engine } = board;
    const m0 = ready(engine, P1);
    const t0 = ready(engine, P2);
    investmentRun(board, { [P1]: ["as0", "as1", "as2", "as3", "as4"].slice(0, mine), [P2]: ["bs0", "bs1", "bs2", "bs3", "bs4"].slice(0, theirs) } as Record<Pid, string[]>);
    assert.equal(ready(engine, P1) - m0, mine, `I took ${mine}`);
    assert.equal(ready(engine, P2) - t0, theirs, `they took ${theirs}`);
    assert.equal(deck(engine, P1).length, 7 + 7 - mine, "my deck lost exactly what I took");
    assert.equal(engine.state.pendingChoice, undefined);
  }
});

clause(INVESTMENT, "0:rule", "more than 5 is refused for each player", () => {
  const board = investmentBoard({ stapleCount: 7, oppStapleCount: 7 });
  const { engine, id } = board;
  play(engine, P1, id("ri"), {});
  const first = pendingOf(engine)!;
  assert.equal(first.kind, "chooserSelectsTarget");
  const six = ["as0", "as1", "as2", "as3", "as4", "as5"];
  const sixTheirs = ["bs0", "bs1", "bs2", "bs3", "bs4", "bs5"];
  const mineFirst = first.playerId === P1;
  assert.throws(() => pick(engine, first.playerId as Pid, (mineFirst ? six : sixTheirs).map(id)), "six staples");
  assert.equal(pendingOf(engine)?.playerId, first.playerId, "still waiting for a legal pick");
  pick(engine, first.playerId as Pid, (mineFirst ? six : sixTheirs).slice(0, 5).map(id));
  const second = pendingOf(engine)!;
  assert.equal(second.playerId, mineFirst ? P2 : P1);
  assert.throws(() => pick(engine, second.playerId as Pid, (mineFirst ? sixTheirs : six).map(id)), "six staples for the other player");
  pick(engine, second.playerId as Pid, (mineFirst ? sixTheirs : six).slice(0, 5).map(id));
  assert.equal(staplesIn(engine, P1).length, 5);
  assert.equal(staplesIn(engine, P2).length, 5);
});

clause(INVESTMENT, "0:rule", "only STAPLE resources from your own deck can be found: a non-staple resource, other card types, cards in hand / discard and the other player's deck are refused", () => {
  const board = investmentBoard();
  const { engine, id } = board;
  play(engine, P1, id("ri"), {});
  for (let n = 0; n < 2; n++) {
    const pc = pendingOf(engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    const me = pc.playerId as Pid;
    const mine = me === P1 ? "a" : "b";
    const other = me === P1 ? "b" : "a";
    for (const key of [`${mine}nonStaple`, `${mine}char`, `${mine}item`, `${mine}tac`, `${mine}loc`, `${mine}inHand`, `${mine}inDiscard`, `${other}s0`, `${other}nonStaple`]) {
      assert.throws(() => pick(engine, me, [id(key)]), `${me} cannot take ${key}`);
    }
    assert.throws(() => pick(engine, me, [id(`${mine}s0`), id(`${mine}s0`)]), "the same card twice");
    assert.equal(pendingOf(engine)?.playerId, me, "still waiting for a legal pick");
    pick(engine, me, [id(`${mine}s0`)]);
  }
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("anonStaple")), "deck");
  assert.equal(zoneOf(engine, id("bnonStaple")), "deck");
});

clause(INVESTMENT, "0:rule", "every kind of staple can be found (Rage, Greed, Deception, Elitism, Obsession) and provides its icon once in play", () => {
  const board = investmentBoard();
  const { engine } = board;
  const before = { ...engine.getThresholds(P1) };
  investmentRun(board, { [P1]: ["as0", "as1", "as2", "as3", "as4"], [P2]: [] } as Record<Pid, string[]>);
  const after = engine.getThresholds(P1);
  for (const icon of STAPLE_ICONS) assert.equal((after[icon] ?? 0) - (before[icon] ?? 0), 1, icon);
});

clause(INVESTMENT, "0:rule", "a player with fewer than 5 staples left can take as many as they have; a player with none is not forced to do anything", () => {
  const board = investmentBoard({ stapleCount: 2, oppStapleCount: 0 });
  const { engine, id } = board;
  const t0 = ready(engine, P2);
  investmentRun(board, { [P1]: ["as0", "as1"], [P2]: [] } as Record<Pid, string[]>);
  assert.equal(staplesIn(engine, P1).length, 2);
  assert.equal(ready(engine, P2), t0, "the opponent had no staple to find");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ri")), "discard");
});

clause(INVESTMENT, "0:rule", "each searched deck is shuffled afterwards (CR 312.1)", () => {
  const board = investmentBoard({ stapleCount: 9, oppStapleCount: 9 });
  const { engine, id } = board;
  const mineLeft = deck(engine, P1).filter((c) => !["as0", "as1"].map(id).includes(c));
  const theirsLeft = deck(engine, P2).filter((c) => !["bs0", "bs1"].map(id).includes(c));
  investmentRun(board, { [P1]: ["as0", "as1"], [P2]: ["bs0", "bs1"] } as Record<Pid, string[]>);
  sameCards(deck(engine, P1), mineLeft);
  sameCards(deck(engine, P2), theirsLeft);
  assert.notDeepEqual(deck(engine, P1), mineLeft, "my deck is in a new order");
  assert.notDeepEqual(deck(engine, P2), theirsLeft, "the opponent's deck is in a new order");
});

clause(INVESTMENT, "0:rule", "a search where a player takes nothing also shuffles their deck", () => {
  const board = investmentBoard({ stapleCount: 9, oppStapleCount: 9 });
  const { engine } = board;
  const mine = [...deck(engine, P1)];
  const theirs = [...deck(engine, P2)];
  investmentRun(board, { [P1]: [], [P2]: [] } as Record<Pid, string[]>);
  sameCards(deck(engine, P1), mine);
  sameCards(deck(engine, P2), theirs);
  assert.notDeepEqual(deck(engine, P1), mine);
  assert.notDeepEqual(deck(engine, P2), theirs);
});

clause(INVESTMENT, "0:rule", "a player whose deck has no staple resource still searches, so their deck is shuffled (CR 312.1)", () => {
  const board = investmentBoard({ stapleCount: 0, oppStapleCount: 0 });
  const { engine } = board;
  const mine = [...deck(engine, P1)];
  const theirs = [...deck(engine, P2)];
  investmentRun(board, { [P1]: [], [P2]: [] } as Record<Pid, string[]>);
  sameCards(deck(engine, P1), mine);
  sameCards(deck(engine, P2), theirs);
  assert.notDeepEqual(deck(engine, P1), mine, "my deck was searched (and held no staple), so it is shuffled");
  assert.notDeepEqual(deck(engine, P2), theirs, "so was the opponent's");
});

clause(INVESTMENT, "0:rule", "no card is revealed: the printed text says search and put into play, not reveal", () => {
  const board = investmentBoard();
  investmentRun(board, { [P1]: ["as0"], [P2]: ["bs0"] } as Record<Pid, string[]>);
  assert.equal(revealEvents(board.engine).length, 0);
});

clause(INVESTMENT, "0:rule", "the active player makes their search first (CR 402.2): played on my turn I go first, played in response on the opponent's turn they go first", () => {
  const mine = investmentBoard();
  assert.deepEqual(investmentRun(mine, { [P1]: ["as0"], [P2]: ["bs0"] } as Record<Pid, string[]>), [P1, P2], "my turn: me, then the opponent");
  const { engine, id } = investmentBoard({ active: P2 });
  playRaw(engine, P2, id("opener"), {});
  playRaw(engine, P1, id("ri"), {});
  resolvePendingResponses(engine);
  const asked: string[] = [];
  drain(engine, (pc) => {
    asked.push(pc.playerId);
    return declineAll(pc);
  });
  assert.deepEqual(asked, [P2, P1], "the opponent's turn: the active player (them) first");
});

clause(INVESTMENT, "0:rule", "it costs no resources: I pay nothing for the tactic itself", () => {
  const board = investmentBoard();
  const before = ready(board.engine, P1);
  investmentRun(board, { [P1]: [], [P2]: [] } as Record<Pid, string[]>);
  assert.equal(ready(board.engine, P1), before, "cost 0");
});

clause(INVESTMENT, "0:rule", "needs [E][E][E][E]: three [E] with plenty of other resources is refused; four [E] works and the icons are not spent", () => {
  const three = investmentBoard({ elitism: 3, greed: 8 });
  assert.throws(() => playRaw(three.engine, P1, three.id("ri")));
  assert.equal(zoneOf(three.engine, three.id("ri")), "hand");
  const none = investmentBoard({ elitism: 0, greed: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("ri")), "even though it costs 0 it needs the icons");
  const four = investmentBoard({ elitism: 4 });
  const before = ready(four.engine, P1);
  investmentRun(four, { [P1]: [], [P2]: [] } as Record<Pid, string[]>);
  assert.equal(zoneOf(four.engine, four.id("ri")), "discard");
  assert.equal(ready(four.engine, P1), before);
});

clause(INVESTMENT, "0:rule", "the opponent needs no icons to benefit: they have no resources at all and still get their staples", () => {
  const board = investmentBoard();
  assert.equal(ready(board.engine, P2), 0);
  investmentRun(board, { [P1]: [], [P2]: ["bs0", "bs1"] } as Record<Pid, string[]>);
  assert.equal(ready(board.engine, P2), 2);
});

// ===============================================================================
// Rudimentary Lathe — Your items cost 1 less to play, to a minimum cost of 1.
// Item, cost 2, threshold [E][E].
// ===============================================================================

const LATHE = "fa7f460c-f5a8-4b96-bcaf-7f130e853b73";

function latheBoard(opts: { latheZone?: "hand" | "play"; latheOwner?: Pid; active?: Pid; elitism?: number } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "lathe", def: printing(LATHE), owner: opts.latheOwner ?? P1, zone: opts.latheZone ?? "play" },
      ...[0, 1, 2, 3, 4].map((n) => ({ key: `i${n}`, def: item({ name: `Item${n}`, cost: n }), owner: P1, zone: "hand" as const })),
      ...[0, 1, 2, 3, 4].map((n) => ({ key: `t${n}`, def: item({ name: `TheirItem${n}`, cost: n }), owner: P2, zone: "hand" as const })),
      { key: "char3", def: character({ name: "Char3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "tac3", def: tactic({ name: "Tac3", cost: 3, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "loc3", def: location({ name: "Loc3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "lathe2", def: printing(LATHE), owner: P1, zone: "hand" },
      { key: "payItem", def: payItem(3), owner: P1, zone: "play" },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("elitism", 12, P2)
    ]
  });
}

for (const [cost, paid] of [
  [4, 3],
  [3, 2],
  [2, 1]
] as const) {
  clause(LATHE, "0:rule", `an item with cost ${cost} costs ${paid} to play`, () => {
    const { engine, id } = latheBoard();
    const before = ready(engine);
    play(engine, P1, id(`i${cost}`), {});
    assert.equal(zoneOf(engine, id(`i${cost}`)), "play");
    assert.equal(before - ready(engine), paid);
  });
}

clause(LATHE, "0:rule", "'to a minimum cost of 1': a cost-1 item still costs 1 (it never becomes free)", () => {
  const { engine, id } = latheBoard();
  const before = ready(engine);
  play(engine, P1, id("i1"), {});
  assert.equal(zoneOf(engine, id("i1")), "play");
  assert.equal(before - ready(engine), 1, "1 - 1 = 0 would be below the minimum of 1");
});

clause(LATHE, "0:rule", "a cost-0 item stays at 0: the minimum of 1 does not raise a cost that was already below it (CR 410.5)", () => {
  const { engine, id } = latheBoard();
  const before = ready(engine);
  play(engine, P1, id("i0"), {});
  assert.equal(zoneOf(engine, id("i0")), "play");
  assert.equal(before - ready(engine), 0);
});

clause(LATHE, "0:rule", "without the Lathe the same items cost full price (control)", () => {
  const { engine, id } = latheBoard({ latheZone: "hand" });
  for (const n of [3, 2, 1]) {
    const before = ready(engine);
    play(engine, P1, id(`i${n}`), {});
    assert.equal(before - ready(engine), n, `cost ${n}`);
  }
});

clause(LATHE, "0:rule", "only ITEMS: a character, a tactic and a location cost full price", () => {
  const { engine, id } = latheBoard();
  for (const key of ["char3", "tac3", "loc3"]) {
    const before = ready(engine);
    play(engine, P1, id(key), {});
    assert.equal(before - ready(engine), 3, `${key} costs its full 3`);
  }
});

clause(LATHE, "0:rule", "only YOUR items: the opponent's items cost them full price while I control the Lathe", () => {
  const { engine, id } = latheBoard({ active: P2 });
  for (const n of [4, 2]) {
    const before = ready(engine, P2);
    play(engine, P2, id(`t${n}`), {});
    assert.equal(zoneOf(engine, id(`t${n}`)), "play");
    assert.equal(before - ready(engine, P2), n, `their cost-${n} item costs ${n}`);
  }
});

clause(LATHE, "0:rule", "a Lathe the opponent controls reduces THEIR items and not mine", () => {
  const theirs = latheBoard({ latheOwner: P2, active: P2 });
  const before = ready(theirs.engine, P2);
  play(theirs.engine, P2, theirs.id("t4"), {});
  assert.equal(before - ready(theirs.engine, P2), 3, "their item gets the reduction");
  const mine = latheBoard({ latheOwner: P2 });
  const m0 = ready(mine.engine, P1);
  play(mine.engine, P1, mine.id("i4"), {});
  assert.equal(m0 - ready(mine.engine, P1), 4, "my item costs full price");
});

clause(LATHE, "0:rule", "it ends when the Lathe leaves play", () => {
  const { engine, id } = latheBoard();
  const a = ready(engine);
  play(engine, P1, id("i3"), {});
  assert.equal(a - ready(engine), 2, "while the Lathe is in play");
  play(engine, P1, id("smashItem"), { selected: { t: [id("lathe")] } });
  assert.equal(zoneOf(engine, id("lathe")), "discard");
  const b = ready(engine);
  play(engine, P1, id("i4"), {});
  assert.equal(b - ready(engine), 4, "gone with the Lathe");
});

clause(LATHE, "0:rule", "it only reduces what it costs to PLAY the item: an item's ability cost (pay 3) is not reduced (CR 406.5b)", () => {
  const { engine, id } = latheBoard();
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 3);
});

clause(LATHE, "0:rule", "two Lathes each take 1 off: a cost-4 item costs 2, a cost-2 item still costs 1", () => {
  const { engine, id } = latheBoard();
  play(engine, P1, id("lathe2"), {});
  assert.equal(zoneOf(engine, id("lathe2")), "play");
  const a = ready(engine);
  play(engine, P1, id("i4"), {});
  assert.equal(a - ready(engine), 2, "4 - 1 - 1 = 2");
  const b = ready(engine);
  play(engine, P1, id("i2"), {});
  assert.equal(b - ready(engine), 1, "never below the minimum of 1");
});

clause(LATHE, "0:rule", "the second Lathe is itself an item, so it costs 1 with the first in play; the first pays its printed 2 and needs [E][E]", () => {
  const { engine, id } = latheBoard();
  const before = ready(engine);
  play(engine, P1, id("lathe2"), {});
  assert.equal(before - ready(engine), 1, "cost 2 reduced to 1");
  const bare = latheBoard({ latheZone: "hand" });
  const b0 = ready(bare.engine);
  play(bare.engine, P1, bare.id("lathe"), {});
  assert.equal(b0 - ready(bare.engine), 2, "the first Lathe pays its printed 2");
  const short = latheBoard({ latheZone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("lathe")), "one short of 2");
});

// ===============================================================================
// Runic Cannon — LOAD -- COST: Pay 3. -- EFFECT: Put a token on this card.
// FIRE -- COST: Deplete this card, pick a character. -- EFFECT: Inflict X damage
// to the character, where X is the number of tokens on this card. Then, remove
// all tokens from this card.
// Item, cost 2, threshold [E][E].
// ===============================================================================

const CANNON = "51072a53-30d2-4f56-9bec-0e143225d209";

function cannonBoard(opts: { tokens?: number; elitism?: number; zone?: "hand" | "play"; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rc", def: printing(CANNON), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : undefined, depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "hand" },
      { key: "rc2", def: printing(CANNON), owner: P1, zone: "play", counters: { token: 4 } },
      ...bank("elitism", opts.elitism ?? 12, P1)
    ]
  });
}

clause(CANNON, "0:ability:load", "LOAD pays exactly 3 and puts exactly one token on the Cannon", () => {
  const { engine, id } = cannonBoard();
  assert.equal(tokensOn(engine, id("rc")), 0);
  const before = ready(engine);
  activate(engine, P1, id("rc"), "load");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(tokensOn(engine, id("rc")), 1, "one token");
  assert.equal(engine.state.cards[id("rc")].depleted, false, "LOAD does not deplete the Cannon");
  assert.equal(tokensOn(engine, id("rc2")), 4, "another Cannon's tokens are untouched");
});

clause(CANNON, "0:ability:load", "LOAD can be repeated: three uses cost 9 and leave 3 tokens", () => {
  const { engine, id } = cannonBoard();
  const before = ready(engine);
  for (let i = 1; i <= 3; i++) {
    activate(engine, P1, id("rc"), "load");
    assert.equal(tokensOn(engine, id("rc")), i);
  }
  assert.equal(before - ready(engine), 9);
});

clause(CANNON, "0:ability:load", "LOAD is refused with only 2 resources (one short); exactly 3 works", () => {
  const short = cannonBoard({ elitism: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("rc"), "load"));
  assert.equal(tokensOn(short.engine, short.id("rc")), 0);
  assert.equal(ready(short.engine), 2, "nothing was spent");
  const exact = cannonBoard({ elitism: 3 });
  activate(exact.engine, P1, exact.id("rc"), "load");
  assert.equal(tokensOn(exact.engine, exact.id("rc")), 1);
});

clause(CANNON, "0:ability:load", "LOAD works while the Cannon is depleted (its cost is only resources)", () => {
  const { engine, id } = cannonBoard({ depleted: true });
  activate(engine, P1, id("rc"), "load");
  assert.equal(tokensOn(engine, id("rc")), 1);
  assert.equal(engine.state.cards[id("rc")].depleted, true, "still depleted");
});

clause(CANNON, "0:ability:load", "only its controller can LOAD it, and only from play", () => {
  const { engine, id } = cannonBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "load"));
  assert.equal(tokensOn(engine, id("rc")), 0);
  const inHand = cannonBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("rc"), "load"));
});

clause(CANNON, "0:ability:load", "the Cannon deploys for its printed cost of 2 with [E][E] and starts with no tokens; one short or one [E] short is refused", () => {
  const { engine, id } = cannonBoard({ zone: "hand", elitism: 2 });
  const before = ready(engine);
  play(engine, P1, id("rc"), {});
  assert.equal(before - ready(engine), 2);
  assert.equal(tokensOn(engine, id("rc")), 0, "no tokens on entering play");
  const short = cannonBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rc")));
});

for (const x of [1, 2, 3, 5]) {
  clause(CANNON, "1:ability:fire", `FIRE with ${x} token(s): ${x} damage to the picked character, all tokens removed, the Cannon depleted`, () => {
    const { engine, id } = cannonBoard({ tokens: x });
    activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
    if (x >= 5) assert.equal(zoneOf(engine, id("foe")), "discard", "5 damage destroys the 5-life Foe");
    else assert.equal(engine.state.cards[id("foe")].damage, x, "X damage");
    assert.equal(tokensOn(engine, id("rc")), 0, "all tokens are removed");
    assert.equal(engine.state.cards[id("rc")].depleted, true, "COST: Deplete this card");
    assert.equal(engine.state.cards[id("mine")].damage, 0, "no other character takes damage");
    assert.equal(tokensOn(engine, id("rc2")), 4, "another Cannon keeps its tokens");
  });
}

clause(CANNON, "1:ability:fire", "X counts the tokens right now: a Cannon loaded 3 times (via LOAD) deals 3", () => {
  const { engine, id } = cannonBoard();
  activate(engine, P1, id("rc"), "load");
  activate(engine, P1, id("rc"), "load");
  activate(engine, P1, id("rc"), "load");
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 3);
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CANNON, "1:ability:fire", "damage equal to the character's life destroys it; one less does not", () => {
  const exact = cannonBoard({ tokens: 2 });
  activate(exact.engine, P1, exact.id("rc"), "fire", { selected: { c: [exact.id("weak")] } });
  assert.equal(zoneOf(exact.engine, exact.id("weak")), "discard", "2 damage kills the 2-life character");
  const short = cannonBoard({ tokens: 1 });
  activate(short.engine, P1, short.id("rc"), "fire", { selected: { c: [short.id("weak")] } });
  assert.equal(zoneOf(short.engine, short.id("weak")), "play", "1 damage does not");
  assert.equal(short.engine.state.cards[short.id("weak")].damage, 1);
});

clause(CANNON, "1:ability:fire", "with 0 tokens X is 0: FIRE can still be used (Cannon depleted) but inflicts no damage", () => {
  const { engine, id } = cannonBoard({ tokens: 0 });
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(engine.state.cards[id("rc")].depleted, true);
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CANNON, "1:ability:fire", "the picked character can be mine or theirs", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].damage, 2);
  assert.equal(engine.state.cards[id("foe")].damage, 0);
});

clause(CANNON, "1:ability:fire", "only a character can be picked: an item, a location, a faction and a face-down card are refused", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  const attempt = (picked: string) => () => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(id("ally")), "a character in hand");
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: {} }), "no character picked");
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe"), id("mine")] } }), "two characters");
  assert.equal(engine.state.cards[id("rc")].depleted, false, "the refused attempts did not deplete it");
  assert.equal(tokensOn(engine, id("rc")), 2);
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(CANNON, "1:ability:fire", "cannot FIRE while depleted; works again after it is restored at the start of my next turn", () => {
  const { engine, id } = cannonBoard({ tokens: 2, depleted: true });
  assert.throws(() => activateRaw(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } }));
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(tokensOn(engine, id("rc")), 2, "tokens kept");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("rc")].depleted, false, "restored");
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 2);
});

clause(CANNON, "1:ability:fire", "FIRE costs no resources", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  const before = ready(engine);
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(ready(engine), before);
});

clause(CANNON, "1:ability:fire", "damage adds to damage the character already has", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  engine.state.cards[id("foe")].damage = 2;
  activate(engine, P1, id("rc"), "fire", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 4);
  assert.equal(zoneOf(engine, id("foe")), "play", "4 < 5 life");
});

clause(CANNON, "1:ability:fire", "only its controller can FIRE it", () => {
  const { engine, id } = cannonBoard({ tokens: 2 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "fire", { selected: { c: [id("mine")] } }));
  assert.equal(tokensOn(engine, id("rc")), 2);
});

clause(CANNON, "1:ability:fire", "it can be used on the opponent's turn in a response window", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "rc", def: printing(CANNON), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("rc"), abilityId: "fire", selected: { c: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("foe")].damage, 3, "3 damage to the attacker");
  assert.equal(tokensOn(engine, id("rc")), 0);
});

// ===============================================================================
// Runic Circuitry — This card enters play with 2 tokens on it.
// CONSTRUCT -- COST: Pay 3, deplete this card. -- EFFECT: Remove a token from this card.
// POWER-UP -- COST: Use this only if there are no tokens on this card. Deplete
// this card. -- EFFECT: The next numeric cost you pay this turn costs up to 3 less.
// Item, cost 1, threshold [E][E].
// ===============================================================================

const CIRCUITRY = "f8e50a76-21e1-4d48-a150-af73c07be2fb";

/** A free tactic that puts one chosen card from my discard pile into play (id `r`, declaration `t`). */
function reviveFromDiscard(type: "item" | "character"): CardDefinition {
  return tactic({
    name: `Revive-${type}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

function circuitryBoard(opts: { zone?: "hand" | "play" | "discard"; tokens?: number; elitism?: number; greed?: number; depleted?: boolean } = {}) {
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rc", def: printing(CIRCUITRY), owner: P1, zone, counters: zone === "play" && opts.tokens ? { token: opts.tokens } : undefined, depleted: opts.depleted },
      { key: "other", def: printing(CIRCUITRY), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "c5", def: character({ name: "Cost5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c5b", def: character({ name: "Cost5b", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Cost2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Cost1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "payItem", def: payItem(3), owner: P1, zone: "play" },
      { key: "revive", def: reviveFromDiscard("item"), owner: P1, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "item"), owner: P1, zone: "hand" },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(CIRCUITRY, "0:rule", "deployed from my hand it enters play with exactly 2 tokens, and pays its printed cost of 1", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  const before = ready(engine);
  play(engine, P1, id("rc"), {});
  assert.equal(zoneOf(engine, id("rc")), "play");
  assert.equal(tokensOn(engine, id("rc")), 2, "2 tokens");
  assert.equal(before - ready(engine), 1, "cost 1");
  assert.equal(tokensOn(engine, id("other")), 1, "another Circuitry's tokens are untouched");
});

clause(CIRCUITRY, "0:rule", "put into play by an effect (not deployed) it also enters with exactly 2 tokens", () => {
  const { engine, id } = circuitryBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("rc")] } });
  assert.equal(zoneOf(engine, id("rc")), "play");
  assert.equal(tokensOn(engine, id("rc")), 2);
});

clause(CIRCUITRY, "0:rule", "it is deployed untapped: enters play not depleted", () => {
  const { engine, id } = circuitryBoard({ zone: "hand" });
  play(engine, P1, id("rc"), {});
  assert.equal(engine.state.cards[id("rc")].depleted, false);
});

clause(CIRCUITRY, "0:rule", "its tokens disappear when it leaves play (CR 409.2): back in hand it carries none", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 2 });
  play(engine, P1, id("bounce"), { selected: { t: [id("rc")] } });
  assert.equal(zoneOf(engine, id("rc")), "hand");
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CIRCUITRY, "0:rule", "a Circuitry that left play and is deployed again enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("rc")] } });
  assert.equal(zoneOf(engine, id("rc")), "hand");
  play(engine, P1, id("rc"), {});
  assert.equal(zoneOf(engine, id("rc")), "play");
  assert.equal(tokensOn(engine, id("rc")), 2, "exactly 2: the old token disappeared when it left play");
});

clause(CIRCUITRY, "0:rule", "a destroyed Circuitry revived from the discard pile (put into play by an effect) enters with exactly 2 tokens, not its old tokens plus 2", () => {
  const { engine, id } = circuitryBoard({ zone: "play", tokens: 2 });
  play(engine, P1, id("smashItem"), { selected: { t: [id("rc")] } });
  assert.equal(zoneOf(engine, id("rc")), "discard");
  play(engine, P1, id("revive"), { selected: { t: [id("rc")] } });
  assert.equal(zoneOf(engine, id("rc")), "play");
  assert.equal(tokensOn(engine, id("rc")), 2, "exactly 2, not 4");
});

clause(CIRCUITRY, "0:rule", "deploys for 1 with [E][E]: one resource short or one [E] short is refused", () => {
  const short = circuitryBoard({ zone: "hand", elitism: 0, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rc")), "no resources");
  const oneE = circuitryBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("rc")), "one [E] is not [E][E]");
  const twoE = circuitryBoard({ zone: "hand", elitism: 2 });
  play(twoE.engine, P1, twoE.id("rc"), {});
  assert.equal(zoneOf(twoE.engine, twoE.id("rc")), "play");
});

clause(CIRCUITRY, "1:ability:construct", "CONSTRUCT pays exactly 3, depletes the Circuitry and removes exactly one token", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  const before = ready(engine);
  activate(engine, P1, id("rc"), "construct");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(engine.state.cards[id("rc")].depleted, true, "COST: deplete this card");
  assert.equal(tokensOn(engine, id("rc")), 1, "2 - 1");
  assert.equal(tokensOn(engine, id("other")), 1, "another Circuitry's token is untouched");
});

clause(CIRCUITRY, "1:ability:construct", "it can be used once per untap: depleted, it is refused; next turn it removes the last token", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  activate(engine, P1, id("rc"), "construct");
  assert.throws(() => activateRaw(engine, P1, id("rc"), "construct"), "already depleted");
  assert.equal(tokensOn(engine, id("rc")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("rc")].depleted, false);
  activate(engine, P1, id("rc"), "construct");
  assert.equal(tokensOn(engine, id("rc")), 0);
});

clause(CIRCUITRY, "1:ability:construct", "is refused with only 2 resources (one short) — nothing is depleted or removed; exactly 3 works", () => {
  const short = circuitryBoard({ tokens: 2, elitism: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("rc"), "construct"));
  assert.equal(short.engine.state.cards[short.id("rc")].depleted, false);
  assert.equal(tokensOn(short.engine, short.id("rc")), 2);
  assert.equal(ready(short.engine), 2);
  const exact = circuitryBoard({ tokens: 2, elitism: 3 });
  activate(exact.engine, P1, exact.id("rc"), "construct");
  assert.equal(tokensOn(exact.engine, exact.id("rc")), 1);
});

clause(CIRCUITRY, "1:ability:construct", "with no tokens left CONSTRUCT can still be used (cost paid) and the token count stays at 0", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("rc"), "construct");
  assert.equal(before - ready(engine), 3);
  assert.equal(tokensOn(engine, id("rc")), 0, "no negative tokens");
  assert.equal(engine.state.cards[id("rc")].depleted, true);
});

clause(CIRCUITRY, "1:ability:construct", "only its controller can use it, and only from play", () => {
  const { engine, id } = circuitryBoard({ tokens: 2 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "construct"));
  assert.equal(tokensOn(engine, id("rc")), 2);
  const inHand = circuitryBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("rc"), "construct"));
});

clause(CIRCUITRY, "2:ability:powerup", "POWER-UP is refused while there are tokens on the card (2, then 1)", () => {
  for (const tokens of [2, 1]) {
    const { engine, id } = circuitryBoard({ tokens });
    assert.throws(() => activateRaw(engine, P1, id("rc"), "powerup"), `${tokens} token(s)`);
    assert.equal(engine.state.cards[id("rc")].depleted, false);
    const before = ready(engine);
    play(engine, P1, id("c5"), {});
    assert.equal(before - ready(engine), 5, "nothing was reduced");
  }
});

clause(CIRCUITRY, "2:ability:powerup", "with no tokens POWER-UP depletes the card for no resources, and the next numeric cost I pay is 3 less (a 5-cost character costs 2)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  const a = ready(engine);
  activate(engine, P1, id("rc"), "powerup");
  assert.equal(a - ready(engine), 0, "no resources paid");
  assert.equal(engine.state.cards[id("rc")].depleted, true, "COST: Deplete this card");
  const before = ready(engine);
  play(engine, P1, id("c5"), {});
  assert.equal(zoneOf(engine, id("c5")), "play");
  assert.equal(before - ready(engine), 2, "5 - 3 = 2");
});

clause(CIRCUITRY, "2:ability:powerup", "'up to 3 less' never goes below 0: a 2-cost character is free", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("rc"), "powerup");
  const before = ready(engine);
  play(engine, P1, id("c2"), {});
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(before - ready(engine), 0);
});

clause(CIRCUITRY, "2:ability:powerup", "only the NEXT cost: the second 5-cost character pays in full", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("rc"), "powerup");
  play(engine, P1, id("c5"), {});
  const before = ready(engine);
  play(engine, P1, id("c5b"), {});
  assert.equal(before - ready(engine), 5);
});

clause(CIRCUITRY, "2:ability:powerup", "the reduction ends with the turn: unused, it is gone on my next turn", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("rc"), "powerup");
  endTurn(engine, P1);
  endTurn(engine, P2);
  const before = ready(engine);
  play(engine, P1, id("c5"), {});
  assert.equal(before - ready(engine), 5);
});

clause(CIRCUITRY, "2:ability:powerup", "the reduction also applies to a numeric ability cost I pay (pay 3 becomes free; CR 406.5)", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activate(engine, P1, id("rc"), "powerup");
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 0, "a 'pay 3' ability costs 3 - 3 = 0 after POWER-UP");
});

clause(CIRCUITRY, "2:ability:powerup", "'up to 3 less': POWER-UP asks its controller how much to reduce, a number from 0 to 3, after depleting the card", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("rc"), "powerup");
  assert.equal(engine.state.cards[id("rc")].depleted, true, "COST: Deplete this card");
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
  clause(CIRCUITRY, "2:ability:powerup", `choosing ${value} reduces the next numeric cost by exactly ${value}: a 5-cost character pays ${paid}`, () => {
    const { engine, id } = circuitryBoard({ tokens: 0 });
    activateBase(engine, P1, id("rc"), "powerup");
    answerUpTo(engine, P1, value);
    assert.equal(pendingOf(engine), undefined, "the choice is answered");
    const before = ready(engine);
    play(engine, P1, id("c5"), {});
    assert.equal(zoneOf(engine, id("c5")), "play");
    assert.equal(before - ready(engine), paid);
  });
}

clause(CIRCUITRY, "2:ability:powerup", "the chosen amount also applies to a numeric ability cost I pay: choosing 2 turns 'pay 3' into pay 1", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("rc"), "powerup");
  answerUpTo(engine, P1, 2);
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 1);
});

clause(CIRCUITRY, "2:ability:powerup", "more than 3 (or a negative number) is refused: the choice stays open, and 3 is still accepted", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  activateBase(engine, P1, id("rc"), "powerup");
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
  play(engine, P1, id("c5"), {});
  assert.equal(before - ready(engine), 2);
});

clause(CIRCUITRY, "2:ability:powerup", "cannot be used while depleted: after CONSTRUCT (which depletes) POWER-UP is refused until the card is restored", () => {
  const { engine, id } = circuitryBoard({ tokens: 1 });
  activate(engine, P1, id("rc"), "construct");
  assert.equal(tokensOn(engine, id("rc")), 0);
  assert.throws(() => activateRaw(engine, P1, id("rc"), "powerup"), "the card is depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("rc"), "powerup");
  const before = ready(engine);
  play(engine, P1, id("c5"), {});
  assert.equal(before - ready(engine), 2);
});

clause(CIRCUITRY, "2:ability:powerup", "only its controller can use it", () => {
  const { engine, id } = circuitryBoard({ tokens: 0 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("rc"), "powerup"));
  assert.equal(engine.state.cards[id("rc")].depleted, false);
});

// ===============================================================================
// Scavengemajig — When this card enters or leaves play, you may choose an item in
// your discard pile. If you do, put that item into play under your control.
// Character (majig), cost 4, threshold [E][E][E][E], 2 strength / 3 speed / 1 life.
// ===============================================================================

const SCAVENGE = "acf84206-ef48-4274-8d7d-fd3b38e6152a";

/** An item that gets a token when it enters play, so we can tell it really "entered play". */
function tokenItem(name: string): CardDefinition {
  return item({
    name,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] }
  });
}

function scavengeBoard(opts: { zone?: "hand" | "play" | "discard"; owner?: Pid; elitism?: number; noItems?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const other = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "sm", def: printing(SCAVENGE), owner, zone: opts.zone ?? "hand" },
      { key: "sm2", def: printing(SCAVENGE), owner, zone: "hand" },
      ...(opts.noItems
        ? []
        : [
            { key: "itemA", def: tokenItem("ItemA"), owner, zone: "discard" as const },
            { key: "itemB", def: item({ name: "ItemB" }), owner, zone: "discard" as const }
          ]),
      { key: "charD", def: character({ name: "CharD" }), owner, zone: "discard" },
      { key: "tacD", def: tactic({ name: "TacD" }), owner, zone: "discard" },
      { key: "theirItemD", def: item({ name: "TheirItemD" }), owner: other, zone: "discard" },
      { key: "handItem", def: item({ name: "HandItem" }), owner, zone: "hand" },
      { key: "deckItem", def: item({ name: "DeckItem" }), owner, zone: "deck" },
      { key: "foe", def: character({ name: "Foe" }), owner: other, zone: "play" },
      { key: "revive", def: reviveFromDiscard("character"), owner, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner, zone: "hand" },
      { key: "zap", def: zapTactic(1), owner, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, owner)
    ]
  });
}

clause(SCAVENGE, "0:rule", "when it enters play I may choose an item in my discard pile: it is put into play under my control, and it really enters play", () => {
  const { engine, id } = scavengeBoard();
  play(engine, P1, id("sm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "a choice is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pick(engine, P1, [id("itemA")]);
  assert.equal(zoneOf(engine, id("itemA")), "play");
  assert.equal(engine.state.cards[id("itemA")].controllerId, P1);
  assert.equal(tokensOn(engine, id("itemA")), 1, "'enters play' triggers fired on the recovered item");
  assert.equal(zoneOf(engine, id("itemB")), "discard", "the other item stays in the discard pile");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(discard(engine, P1).includes(id("itemA")), false);
});

clause(SCAVENGE, "0:rule", "it is a 'may': choosing nothing leaves both items in the discard pile", () => {
  const { engine, id } = scavengeBoard();
  play(engine, P1, id("sm"), {});
  pick(engine, P1, []);
  assert.equal(zoneOf(engine, id("itemA")), "discard");
  assert.equal(zoneOf(engine, id("itemB")), "discard");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SCAVENGE, "0:rule", "only an ITEM in MY discard pile can be chosen: characters, tactics, the opponent's discarded item and items in hand or deck are refused; and only one", () => {
  const { engine, id } = scavengeBoard();
  play(engine, P1, id("sm"), {});
  for (const key of ["charD", "tacD", "theirItemD", "handItem", "deckItem", "foe", "sm"]) assert.throws(() => pick(engine, P1, [id(key)]), key);
  assert.throws(() => pick(engine, P1, [id("itemA"), id("itemB")]), "one item only");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(engine, P1, [id("itemB")]);
  assert.equal(zoneOf(engine, id("itemB")), "play");
  assert.equal(zoneOf(engine, id("itemA")), "discard");
  assert.equal(zoneOf(engine, id("theirItemD")), "discard");
});

clause(SCAVENGE, "0:rule", "with no item in my discard pile nothing is offered and nothing else is affected", () => {
  const { engine, id } = scavengeBoard({ noItems: true });
  play(engine, P1, id("sm"), {});
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(zoneOf(engine, id("charD")), "discard");
  assert.equal(zoneOf(engine, id("theirItemD")), "discard");
});

clause(SCAVENGE, "0:rule", "it triggers when it is put into play by an effect, not only when deployed", () => {
  const { engine, id } = scavengeBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
  pick(engine, P1, [id("itemA")]);
  assert.equal(zoneOf(engine, id("itemA")), "play");
});

clause(SCAVENGE, "0:rule", "it does not trigger when some other card enters play", () => {
  const { engine, id } = scavengeBoard({ zone: "play" });
  play(engine, P1, id("revive"), { selected: { t: [id("charD")] } });
  assert.equal(zoneOf(engine, id("charD")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("itemA")), "discard");
});

for (const [how, label] of [
  ["sendDestroy", "destroyed"],
  ["sendHand", "returned to hand"],
  ["sendDeck", "put into its owner's deck"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(SCAVENGE, "0:rule", `when it leaves play (${label}) I may choose an item in my discard pile and it is put into play under my control`, () => {
    const { engine, id } = scavengeBoard({ zone: "play" });
    play(engine, P1, id(how), { selected: { t: [id("sm")] } });
    assert.notEqual(zoneOf(engine, id("sm")), "play");
    const pc = pendingOf(engine);
    assert.ok(pc, `a choice is offered when it is ${label}`);
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    assert.throws(() => pick(engine, P1, [id("sm")]), "the Scavengemajig itself is not an item");
    assert.throws(() => pick(engine, P1, [id("charD")]), "not a character");
    pick(engine, P1, [id("itemA")]);
    assert.equal(zoneOf(engine, id("itemA")), "play");
    assert.equal(engine.state.cards[id("itemA")].controllerId, P1);
    assert.equal(tokensOn(engine, id("itemA")), 1, "it entered play");
  });
}

clause(SCAVENGE, "0:rule", "leaving play: choosing nothing is allowed ('may'); and with no item in the discard pile nothing is offered", () => {
  const declines = scavengeBoard({ zone: "play" });
  play(declines.engine, P1, declines.id("sendDestroy"), { selected: { t: [declines.id("sm")] } });
  pick(declines.engine, P1, []);
  assert.equal(zoneOf(declines.engine, declines.id("itemA")), "discard");
  const none = scavengeBoard({ zone: "play", noItems: true });
  play(none.engine, P1, none.id("sendDestroy"), { selected: { t: [none.id("sm")] } });
  assert.equal(none.engine.state.pendingChoice, undefined);
});

clause(SCAVENGE, "0:rule", "dying of damage triggers it too", () => {
  const { engine, id } = scavengeBoard({ zone: "play" });
  play(engine, P1, id("zap"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard");
  assert.equal(pendingOf(engine)?.kind, "chooserSelectsTarget");
  pick(engine, P1, [id("itemA")]);
  assert.equal(zoneOf(engine, id("itemA")), "play");
});

clause(SCAVENGE, "0:rule", "entering AND leaving are separate uses: it can recover one item on entering and another on leaving", () => {
  const { engine, id } = scavengeBoard();
  play(engine, P1, id("sm"), {});
  pick(engine, P1, [id("itemA")]);
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("sm")] } });
  pick(engine, P1, [id("itemB")]);
  assert.equal(zoneOf(engine, id("itemA")), "play");
  assert.equal(zoneOf(engine, id("itemB")), "play");
});

clause(SCAVENGE, "0:rule", "a Scavengemajig controlled by the opponent recovers from THEIR discard pile, under THEIR control", () => {
  const { engine, id } = scavengeBoard({ owner: P2 });
  play(engine, P2, id("sm"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  assert.throws(() => pick(engine, P2, [id("theirItemD")]), "the other player's discard pile is not theirs");
  pick(engine, P2, [id("itemA")]);
  assert.equal(engine.state.cards[id("itemA")].controllerId, P2);
  assert.equal(zoneOf(engine, id("itemA")), "play");
});

clause(SCAVENGE, "0:rule", "two Scavengemajigs each trigger on entering: two recoveries", () => {
  const { engine, id } = scavengeBoard({ elitism: 8 });
  play(engine, P1, id("sm"), {});
  pick(engine, P1, [id("itemA")]);
  play(engine, P1, id("sm2"), {});
  pick(engine, P1, [id("itemB")]);
  assert.equal(zoneOf(engine, id("itemA")), "play");
  assert.equal(zoneOf(engine, id("itemB")), "play");
});

clause(SCAVENGE, "0:rule", "an item that says ATTACH TO CHARACTER (a Luteoderm Prototype in the discard pile) is put into play attached to a character, not sent back to the discard pile (CR 507.2b)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SCAVENGE), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "proto", def: printing(LUTEODERM), owner: P1, zone: "discard" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("sm"), {});
  pick(engine, P1, [id("proto")]);
  // if the engine asks which character to attach it to, I pick my Host (the only character other than the Scavengemajig)
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 5) {
    const pc = pendingOf(engine)!;
    if (pc.kind === "chooserSelectsTarget") pick(engine, P1, [id("host")]);
    else if (pc.kind === "selectTargets") {
      const decls = (pc.declarations as Array<{ id: string }>) ?? [];
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: Object.fromEntries(decls.map((d) => [d.id, [id("host")]])) } } as never);
      resolvePendingResponses(engine);
    } else break;
  }
  assert.equal(zoneOf(engine, id("proto")), "play", "the item is in play");
  const hostOfProto = engine.state.cards[id("proto")].attachedTo;
  assert.ok(hostOfProto, "attached to a character");
  assert.equal(engine.getCardTypes(hostOfProto!).includes("character"), true);
  assert.equal(discard(engine, P1).includes(id("proto")), false, "not back in the discard pile");
});

clause(SCAVENGE, "0:rule", "deploys for its printed cost of 4 with [E][E][E][E] and has its printed 2/1/3 stats; three [E] or one resource short is refused", () => {
  const { engine, id } = scavengeBoard({ noItems: true, elitism: 4 });
  const before = ready(engine);
  play(engine, P1, id("sm"), {});
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("sm")), [2, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("sm")), ["majig"]);
  const three = scavengeBoard({ elitism: 3 });
  assert.throws(() => playRaw(three.engine, P1, three.id("sm")), "three resources");
  const wrongIcons = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sm", def: printing(SCAVENGE), owner: P1, zone: "hand" }, ...bank("elitism", 3, P1), ...bank("greed", 5, P1)]
  });
  assert.throws(() => playRaw(wrongIcons.engine, P1, wrongIcons.id("sm")), "three [E] is one short of [E][E][E][E]");
});

// ===============================================================================
// Securitymajig — This card can block COVERT parties. If this card blocks a COVERT
// party, it gains 3 strength this turn.
// Character (majig), cost 4, threshold [E], 1 strength / 3 speed / 4 life.
// ===============================================================================

const SECURITY = "c59b13a2-cea4-4689-8ee8-0d27bcc19562";

function securityBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sec", def: printing(SECURITY), owner: P1, zone: "play" },
      { key: "sec2", def: printing(SECURITY), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "PlainDefender", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "covertAtk", def: character({ name: "CovertAttacker", strength: 2, life: 4, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "covertAtk2", def: character({ name: "CovertAttacker2", strength: 2, life: 4, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "plainAtk", def: character({ name: "PlainAttacker", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "zap", def: zapTactic(1), owner: P1, zone: "hand" },
      ...bank("elitism", 1, P1)
    ]
  });
}

const block = (engine: SpoilsEngine, blockers: string[]) => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers });

clause(SECURITY, "0:rule", "it can block a covert party, while an ordinary character cannot", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  assert.throws(() => block(engine, [id("plain")]), "a non-covert character cannot block a covert party");
  block(engine, [id("sec")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("sec")]);
});

clause(SECURITY, "0:rule", "it can block a party of several covert attackers", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk"), id("covertAtk2")]);
  block(engine, [id("sec")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("sec")]);
});

clause(SECURITY, "0:rule", "it can help block a covert party only alongside other legal blockers: with an ordinary character in the party the block is refused; two Securitymajigs together are fine", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  assert.throws(() => block(engine, [id("sec"), id("plain")]), "the ordinary character cannot join");
  block(engine, [id("sec"), id("sec2")]);
  assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [id("sec"), id("sec2")].sort());
});

clause(SECURITY, "0:rule", "it can still block a party that is not covert", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("plainAtk")]);
  block(engine, [id("sec")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("sec")]);
});

clause(SECURITY, "0:rule", "a party with a non-covert member is not a covert party, so anyone can block it", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk"), id("plainAtk")]);
  block(engine, [id("plain")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")]);
});

clause(SECURITY, "0:rule", "it does not itself have COVERT (it can block covert parties, which is not the keyword)", () => {
  const { engine, id } = securityBoard();
  assert.equal(engine.getKeywords(id("sec")).includes("covert"), false);
  assert.equal(engine.getKeywords(id("plain")).includes("covert"), false);
});

clause(SECURITY, "0:rule", "deploys for 4 with [E]; one resource short or no [E] is refused; printed 1/4/3 stats", () => {
  const mk = (elitism: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sec", def: printing(SECURITY), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("greed", greed, P1)]
    });
  const ok = mk(1, 3);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("sec"), {});
  assert.equal(before - ready(ok.engine), 4);
  assert.deepEqual(stat(ok.engine, ok.id("sec")), [1, 4, 3]);
  assert.deepEqual(ok.engine.getSubtypes(ok.id("sec")), ["majig"]);
  const short = mk(1, 2);
  assert.throws(() => playRaw(short.engine, P1, short.id("sec")), "3 resources");
  const noE = mk(0, 6);
  assert.throws(() => playRaw(noE.engine, P1, noE.id("sec")), "no [E]");
});

clause(SECURITY, "1:rule", "blocking a covert party it gains 3 strength (1 becomes 4) and deals that much battle damage", () => {
  const { engine, id } = securityBoard();
  assert.equal(engine.getStat(id("sec"), "strength"), 1);
  declareAttackBy(engine, P2, [id("covertAtk")]);
  block(engine, [id("sec")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 4, "1 + 3");
  assert.equal(engine.getStat(id("sec"), "life"), 4, "life is unchanged");
  assert.equal(engine.getStat(id("sec"), "speed"), 3, "speed is unchanged");
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("covertAtk")), "discard", "4 damage kills the 4-life attacker");
});

clause(SECURITY, "1:rule", "the +3 lasts this turn only", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  block(engine, [id("sec")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 4);
  autoResolveBattle(engine);
  assert.equal(engine.getStat(id("sec"), "strength"), 4, "still this turn after the battle");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("sec"), "strength"), 1, "back to 1 once the turn is over");
});

clause(SECURITY, "1:rule", "blocking a party that is NOT covert gives no bonus: it stays at 1 strength", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("plainAtk")]);
  block(engine, [id("sec")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 1);
});

clause(SECURITY, "1:rule", "blocking a party with one covert and one non-covert attacker (not a covert party) gives no bonus", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk"), id("plainAtk")]);
  block(engine, [id("sec")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 1);
});

clause(SECURITY, "1:rule", "every Securitymajig that blocks the covert party gains the strength; a character that is not blocking does not", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  block(engine, [id("sec"), id("sec2")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 4);
  assert.equal(engine.getStat(id("sec2"), "strength"), 4, "the second Securitymajig also blocks a covert party, so it gains too");
  assert.equal(engine.getStat(id("plain"), "strength"), 1, "a character that is not blocking is unchanged");
});

clause(SECURITY, "1:rule", "a Securitymajig that does not block gets nothing, even though a covert party is attacking", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  block(engine, [id("sec2")]);
  assert.equal(engine.getStat(id("sec"), "strength"), 1, "the idle Securitymajig");
  assert.equal(engine.getStat(id("sec2"), "strength"), 4);
});

clause(SECURITY, "1:rule", "declining to block (no blockers) gives no bonus", () => {
  const { engine, id } = securityBoard();
  declareAttackBy(engine, P2, [id("covertAtk")]);
  block(engine, []);
  assert.equal(engine.getStat(id("sec"), "strength"), 1);
});

// ===============================================================================
// Slingerang — This card enters play with 3 tokens on it. If your opponent plays a
// character, you may remove a token from this card.
// CHEAP SHOT -- COST: Use this only if no tokens are on this card and only if your
// opponent played a character this turn. Destroy this card, pick a character. --
// EFFECT: Destroy the character.
// Item, cost 2, threshold [E][E].
// ===============================================================================

const SLINGERANG = "93ebda5d-c273-4c97-a5c2-29202057b6e0";

function slingerangBoard(opts: { zone?: "hand" | "play" | "discard"; tokens?: number; owner?: Pid; elitism?: number; greed?: number; second?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const other = owner === P1 ? P2 : P1;
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sl", def: printing(SLINGERANG), owner, zone, counters: zone === "play" && opts.tokens !== undefined ? { token: opts.tokens } : undefined },
      ...(opts.second ? [{ key: "sl2", def: printing(SLINGERANG), owner, zone: "play" as const, counters: { token: 3 } }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: other, zone: "play" },
      { key: "oppCard", def: character({ name: "OppCard", cost: 0 }), owner: other, zone: "hand" },
      { key: "oppCard2", def: character({ name: "OppCard2", cost: 0 }), owner: other, zone: "hand" },
      { key: "oppItem", def: item({ name: "OppItem", cost: 0 }), owner: other, zone: "hand" },
      { key: "oppTac", def: tactic({ name: "OppTac", cost: 0, behavior: { abilities: [{ id: "o", type: "activated", effects: [] }] } }), owner: other, zone: "hand" },
      { key: "oppLoc", def: location({ name: "OppLoc", cost: 0 }), owner: other, zone: "hand" },
      { key: "oppRevive", def: reviveFromDiscard("character"), owner: other, zone: "hand" },
      { key: "oppDead", def: character({ name: "OppDead" }), owner: other, zone: "discard" },
      { key: "oppMake", def: makeTokensTactic(1, "controller"), owner: other, zone: "hand" },
      { key: "myCard", def: character({ name: "MyCard", cost: 0 }), owner, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: other, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: other, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: other, zone: "play", faceDown: true },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner, zone: "hand" },
      { key: "bounce", def: sendTactic("hand", "item"), owner, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

/** Ends P1's turn so the opponent (P2) is active. */
function toTheirTurn(board: { engine: SpoilsEngine }) {
  endTurn(board.engine, P1);
  assert.equal(board.engine.state.activePlayerId, P2);
}

clause(SLINGERANG, "0:rule", "deployed from my hand it enters play with exactly 3 tokens, and pays its printed cost of 2", () => {
  const { engine, id } = slingerangBoard({ zone: "hand", second: true });
  const before = ready(engine);
  play(engine, P1, id("sl"), {});
  assert.equal(zoneOf(engine, id("sl")), "play");
  assert.equal(tokensOn(engine, id("sl")), 3);
  assert.equal(before - ready(engine), 2, "cost 2");
  assert.equal(tokensOn(engine, id("sl2")), 3, "another Slingerang is untouched");
});

clause(SLINGERANG, "0:rule", "put into play by an effect it also enters with exactly 3 tokens", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sl", def: printing(SLINGERANG), owner: P1, zone: "discard" },
      { key: "revive", def: reviveFromDiscard("item"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("revive"), { selected: { t: [id("sl")] } });
  assert.equal(zoneOf(engine, id("sl")), "play");
  assert.equal(tokensOn(engine, id("sl")), 3);
});

clause(SLINGERANG, "0:rule", "a Slingerang that left play and is deployed again enters with exactly 3 tokens, not its old tokens plus 3", () => {
  const { engine, id } = slingerangBoard({ zone: "play", tokens: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("sl")] } });
  assert.equal(zoneOf(engine, id("sl")), "hand");
  play(engine, P1, id("sl"), {});
  assert.equal(tokensOn(engine, id("sl")), 3, "exactly 3: the old token disappeared when it left play");
});

clause(SLINGERANG, "0:rule", "deploys for 2 with [E][E]: one resource short or one [E] short is refused", () => {
  const short = slingerangBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sl")), "one resource");
  const oneE = slingerangBoard({ zone: "hand", elitism: 1, greed: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("sl")), "one [E] is not [E][E]");
  const ok = slingerangBoard({ zone: "hand", elitism: 2 });
  play(ok.engine, P1, ok.id("sl"), {});
  assert.equal(zoneOf(ok.engine, ok.id("sl")), "play");
});

clause(SLINGERANG, "1:rule", "when my opponent plays a character I may remove a token: accepting removes exactly one", () => {
  const board = slingerangBoard({ tokens: 3 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  // the trigger is on being PLAYED (deployed): the choice interrupts the deploy, the card enters play once it is answered
  const pc = pendingOf(engine);
  assert.ok(pc, "I am offered the choice");
  assert.equal(pc.playerId, P1, "the Slingerang's controller decides");
  answerMay(engine, P1, true);
  assert.equal(zoneOf(engine, id("oppCard")), "play");
  assert.equal(tokensOn(engine, id("sl")), 2);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SLINGERANG, "1:rule", "every Slingerang I control watches separately: with two, each may remove one of its own tokens", () => {
  const board = slingerangBoard({ tokens: 3, second: true });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  drain(engine, mayAnswerer(true));
  assert.equal(tokensOn(engine, id("sl")), 2);
  assert.equal(tokensOn(engine, id("sl2")), 2);
  const declined = slingerangBoard({ tokens: 3, second: true });
  toTheirTurn(declined);
  play(declined.engine, P2, declined.id("oppCard"), {});
  drain(declined.engine, mayAnswerer(false));
  assert.equal(tokensOn(declined.engine, declined.id("sl")), 3);
  assert.equal(tokensOn(declined.engine, declined.id("sl2")), 3);
});

clause(SLINGERANG, "1:rule", "it is a 'may': declining keeps the token", () => {
  const board = slingerangBoard({ tokens: 3 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  answerMay(engine, P1, false);
  assert.equal(tokensOn(engine, id("sl")), 3);
});

clause(SLINGERANG, "1:rule", "each character the opponent plays is a separate chance: two characters, two tokens", () => {
  const board = slingerangBoard({ tokens: 3 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  drain(engine, mayAnswerer(true));
  const afterOne = tokensOn(engine, id("sl"));
  play(engine, P2, id("oppCard2"), {});
  drain(engine, mayAnswerer(true));
  assert.equal(afterOne, 2);
  assert.equal(tokensOn(engine, id("sl")), 1);
});

clause(SLINGERANG, "1:rule", "my own characters do not trigger it", () => {
  const { engine, id } = slingerangBoard({ tokens: 3 });
  play(engine, P1, id("myCard"), {});
  assert.equal(zoneOf(engine, id("myCard")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("sl")), 3);
});

clause(SLINGERANG, "1:rule", "the opponent playing an item, a tactic or a location does not trigger it (only characters)", () => {
  for (const key of ["oppItem", "oppTac", "oppLoc"]) {
    const board = slingerangBoard({ tokens: 3 });
    toTheirTurn(board);
    playRaw(board.engine, P2, board.id(key), {});
    resolvePendingResponses(board.engine);
    assert.equal(board.engine.state.pendingChoice, undefined, `${key}: no prompt`);
    assert.equal(tokensOn(board.engine, board.id("sl")), 3, key);
  }
});

clause(SLINGERANG, "1:rule", "a character the opponent merely PUTS into play (not plays) does not trigger it", () => {
  const board = slingerangBoard({ tokens: 3 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppRevive"), { selected: { t: [id("oppDead")] } });
  assert.equal(zoneOf(engine, id("oppDead")), "play", "the character was put into play by an effect");
  assert.equal(engine.state.pendingChoice, undefined, "it was not played, so I am not asked");
  assert.equal(tokensOn(engine, id("sl")), 3);
});

clause(SLINGERANG, "1:rule", "a Micromajig-style token the opponent puts into play (not plays) does not trigger it", () => {
  const board = slingerangBoard({ tokens: 3 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppMake"), {});
  assert.equal(micromajigs(engine, P2).length, 1);
  assert.equal(engine.state.pendingChoice, undefined, "tokens are put into play, not played");
  assert.equal(tokensOn(engine, id("sl")), 3);
});

clause(SLINGERANG, "1:rule", "a Slingerang that is not in play (in my hand) does nothing when the opponent plays a character", () => {
  const board = slingerangBoard({ zone: "hand" });
  toTheirTurn(board);
  play(board.engine, P2, board.id("oppCard"), {});
  assert.equal(board.engine.state.pendingChoice, undefined);
});

clause(SLINGERANG, "1:rule", "a Slingerang the OPPONENT controls watches MY characters", () => {
  const { engine, id } = slingerangBoard({ owner: P2, tokens: 3 });
  // P1 (the Slingerang's opponent) is the active player; "oppCard" is a free character in P1's hand
  assert.equal(engine.state.cards[id("oppCard")].ownerId, P1);
  play(engine, P1, id("oppCard"), {});
  const pc = pendingOf(engine);
  assert.ok(pc, "the Slingerang's controller is offered the choice");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(tokensOn(engine, id("sl")), 2);
});

clause(SLINGERANG, "1:rule", "with no tokens left accepting leaves it at 0 (no negative tokens)", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  drain(engine, mayAnswerer(true));
  assert.equal(tokensOn(engine, id("sl")), 0);
});

// --- CHEAP SHOT

/** P2's turn: P2 plays `oppCard`, answers my token prompt `accept`, then attacks with Foe so I get a response window. */
function cheapShotWindow(board: ReturnType<typeof slingerangBoard>, opts: { playCharacter: boolean }) {
  const { engine, id } = board;
  toTheirTurn(board);
  if (opts.playCharacter) {
    play(engine, P2, id("oppCard"), {});
    drain(engine, mayAnswerer(false));
  }
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
}

const cheapShot = (engine: SpoilsEngine, id: (k: string) => string, target: string) =>
  activateRaw(engine, P1, id("sl"), "cheapshot", { selected: { c: [target] } });

clause(SLINGERANG, "2:ability:cheapshot", "with no tokens, after the opponent played a character this turn: destroys this card as the cost and the picked character", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  cheapShotWindow(board, { playCharacter: true });
  cheapShot(engine, id, id("oppCard"));
  letMyResponseResolve(engine);
  assert.equal(zoneOf(engine, id("sl")), "discard", "COST: Destroy this card");
  assert.equal(zoneOf(engine, id("oppCard")), "discard", "EFFECT: the character is destroyed");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "only THIS Slingerang is destroyed as the cost: a second Slingerang stays in play", () => {
  const board = slingerangBoard({ tokens: 0, second: true });
  const { engine, id } = board;
  cheapShotWindow(board, { playCharacter: true });
  cheapShot(engine, id, id("foe"));
  letMyResponseResolve(engine);
  assert.equal(zoneOf(engine, id("sl")), "discard");
  assert.equal(zoneOf(engine, id("sl2")), "play");
  assert.equal(tokensOn(engine, id("sl2")), 3, "its tokens are untouched");
});

clause(SLINGERANG, "2:ability:cheapshot", "any character can be picked — mine, theirs, or the one they just played", () => {
  for (const key of ["mine", "foe", "oppCard"]) {
    const board = slingerangBoard({ tokens: 0 });
    cheapShotWindow(board, { playCharacter: true });
    cheapShot(board.engine, board.id, board.id(key));
    letMyResponseResolve(board.engine);
    assert.equal(zoneOf(board.engine, board.id(key)), "discard", `${key} destroyed`);
    assert.equal(zoneOf(board.engine, board.id("sl")), "discard");
  }
});

clause(SLINGERANG, "2:ability:cheapshot", "only a character can be picked: an item, a location, a faction and a face-down card are refused", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  cheapShotWindow(board, { playCharacter: true });
  for (const target of [id("thing"), id("place"), engine.state.players[P2].factionId!, engine.state.players[P1].factionId!, id("faceDown"), id("myCard")]) {
    assert.throws(() => cheapShot(engine, id, target), target);
  }
  assert.throws(() => activateRaw(engine, P1, id("sl"), "cheapshot", { selected: {} }), "no character picked");
  assert.equal(zoneOf(engine, id("sl")), "play", "the refused attempts did not destroy it");
  cheapShot(engine, id, id("foe"));
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(SLINGERANG, "2:ability:cheapshot", "refused while there is even ONE token on the card, though the opponent played a character", () => {
  for (const tokens of [1, 2, 3]) {
    const board = slingerangBoard({ tokens });
    cheapShotWindow(board, { playCharacter: true });
    assert.throws(() => cheapShot(board.engine, board.id, board.id("foe")), `${tokens} token(s)`);
    assert.equal(zoneOf(board.engine, board.id("sl")), "play");
    assert.equal(zoneOf(board.engine, board.id("foe")), "play");
  }
});

clause(SLINGERANG, "2:ability:cheapshot", "refused when the opponent has not played a character this turn (no tokens left, but no character played)", () => {
  const board = slingerangBoard({ tokens: 0 });
  cheapShotWindow(board, { playCharacter: false });
  assert.throws(() => cheapShot(board.engine, board.id, board.id("foe")));
  assert.equal(zoneOf(board.engine, board.id("sl")), "play");
  assert.equal(zoneOf(board.engine, board.id("foe")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "the opponent playing an item, a tactic or a location this turn does not count", () => {
  for (const key of ["oppItem", "oppTac", "oppLoc"]) {
    const board = slingerangBoard({ tokens: 0 });
    const { engine, id } = board;
    toTheirTurn(board);
    playRaw(engine, P2, id(key), {});
    resolvePendingResponses(engine);
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    assert.throws(() => cheapShot(engine, id, id("foe")), key);
  }
});

clause(SLINGERANG, "2:ability:cheapshot", "a character that was only put into play (not played) by the opponent does not count either", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppRevive"), { selected: { t: [id("oppDead")] } });
  drain(engine, mayAnswerer(false));
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.throws(() => cheapShot(engine, id, id("foe")));
});

clause(SLINGERANG, "2:ability:cheapshot", "it must be the OPPONENT who played the character: my own character played this turn does not allow it", () => {
  const { engine, id } = slingerangBoard({ tokens: 0 });
  play(engine, P1, id("myCard"), {});
  assert.throws(() => activateRaw(engine, P1, id("sl"), "cheapshot", { selected: { c: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("sl")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "'this turn' only: a character the opponent played on an earlier turn does not allow it", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  drain(engine, mayAnswerer(false));
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.throws(() => activateRaw(engine, P1, id("sl"), "cheapshot", { selected: { c: [id("oppCard")] } }), "my turn, they played it last turn");
  assert.equal(zoneOf(engine, id("sl")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "it can be used later in the same turn the character was played, not only when it is played", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  cheapShotWindow(board, { playCharacter: true });
  cheapShot(engine, id, id("oppCard"));
  letMyResponseResolve(engine);
  assert.equal(zoneOf(engine, id("oppCard")), "discard");
});

clause(SLINGERANG, "2:ability:cheapshot", "only its controller can use it", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  toTheirTurn(board);
  play(engine, P2, id("oppCard"), {});
  drain(engine, mayAnswerer(false));
  assert.throws(() => activateRaw(engine, P2, id("sl"), "cheapshot", { selected: { c: [id("mine")] } }));
  assert.equal(zoneOf(engine, id("sl")), "play");
});

clause(SLINGERANG, "2:ability:cheapshot", "no resources are paid", () => {
  const board = slingerangBoard({ tokens: 0 });
  const { engine, id } = board;
  cheapShotWindow(board, { playCharacter: true });
  const before = ready(engine);
  cheapShot(engine, id, id("foe"));
  letMyResponseResolve(engine);
  assert.equal(ready(engine), before);
});

// ===============================================================================
// TigerKaiser — TIGER ROAR -- COST: Pay 2. Deplete this card. Pick a character. --
// EFFECT: This turn, the character gains 3 strength.
// Character (kaiser), cost 4, threshold [E][E], 3 strength / 4 speed / 1 life.
// ===============================================================================

const TIGER = "e30bca98-3cba-40df-9ec3-dd6f99d78807";

function tigerBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tk", def: printing(TIGER), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "tk2", def: printing(TIGER), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(TIGER, "0:ability:roar", "TIGER ROAR pays exactly 2, depletes the TigerKaiser, and the picked character gains 3 strength (and nothing else)", () => {
  const { engine, id } = tigerBoard();
  const before = ready(engine);
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.equal(engine.state.cards[id("tk")].depleted, true, "COST: Deplete this card");
  assert.deepEqual(stat(engine, id("mine")), [4, 6, 2], "1 + 3 strength; life and speed unchanged");
  assert.deepEqual(stat(engine, id("foe")), [2, 6, 1], "no other character is affected");
  assert.deepEqual(stat(engine, id("tk2")), [3, 1, 4]);
  assert.equal(engine.state.cards[id("tk2")].depleted, false, "another TigerKaiser is not depleted");
});

clause(TIGER, "0:ability:roar", "the character can be an opponent's", () => {
  const { engine, id } = tigerBoard();
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("foe")] } });
  assert.deepEqual(stat(engine, id("foe")), [5, 6, 1]);
  assert.deepEqual(stat(engine, id("mine")), [1, 6, 2]);
});

clause(TIGER, "0:ability:roar", "the TigerKaiser can pick itself (it is a character even though it is depleted by the cost)", () => {
  const { engine, id } = tigerBoard();
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("tk")] } });
  assert.equal(engine.getStat(id("tk"), "strength"), 6, "3 + 3");
  assert.equal(engine.state.cards[id("tk")].depleted, true);
});

clause(TIGER, "0:ability:roar", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused; exactly one", () => {
  const { engine, id } = tigerBoard();
  const attempt = (picked: string[]) => () => activateRaw(engine, P1, id("tk"), "roar", { selected: { c: picked } });
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("place")]), "a location");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([id("inHand")]), "a character in hand");
  assert.throws(attempt([]), "nothing picked");
  assert.throws(attempt([id("mine"), id("foe")]), "two characters");
  assert.equal(engine.state.cards[id("tk")].depleted, false, "refused attempts did not deplete it");
  assert.equal(ready(engine), 8, "nothing was spent");
  attempt([id("mine")])();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(TIGER, "0:ability:roar", "the +3 lasts this turn only", () => {
  const { engine, id } = tigerBoard();
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("mine"), "strength"), 1, "gone when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 1);
});

clause(TIGER, "0:ability:roar", "the extra strength is real: the buffed attacker deals 4 battle damage to the faction", () => {
  const { engine, id } = tigerBoard();
  engine.state.turn = 2;
  engine.state.cards[id("mine")].attackEligibleTurn = 2;
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  const influence = engine.state.players[P2].influence;
  declareAttackBy(engine, P1, [id("mine")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, influence - 4);
});

clause(TIGER, "0:ability:roar", "two TigerKaisers stack on one character (+6)", () => {
  const { engine, id } = tigerBoard();
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  activate(engine, P1, id("tk2"), "roar", { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 7);
});

clause(TIGER, "0:ability:roar", "cannot be used while depleted; works again once restored at the start of my next turn", () => {
  const { engine, id } = tigerBoard();
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  assert.throws(() => activateRaw(engine, P1, id("tk"), "roar", { selected: { c: [id("foe")] } }), "already depleted");
  assert.deepEqual(stat(engine, id("foe")), [2, 6, 1]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("tk")].depleted, false);
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("foe")] } });
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(TIGER, "0:ability:roar", "is refused with only 1 resource (one short); exactly 2 works", () => {
  const short = tigerBoard({ elitism: 1 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("tk"), "roar", { selected: { c: [short.id("mine")] } }));
  assert.equal(short.engine.state.cards[short.id("tk")].depleted, false);
  assert.equal(ready(short.engine), 1);
  const exact = tigerBoard({ elitism: 2 });
  activate(exact.engine, P1, exact.id("tk"), "roar", { selected: { c: [exact.id("mine")] } });
  assert.equal(exact.engine.getStat(exact.id("mine"), "strength"), 4);
});

clause(TIGER, "0:ability:roar", "the ability has no threshold of its own: 2 resources of any kind pay for it", () => {
  const { engine, id } = tigerBoard({ elitism: 0, greed: 2 });
  activate(engine, P1, id("tk"), "roar", { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
});

clause(TIGER, "0:ability:roar", "usable the turn it enters play (CR 204.3a), and only from play and only by its controller", () => {
  const inHand = tigerBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("tk"), "roar", { selected: { c: [inHand.id("mine")] } }), "in hand");
  play(inHand.engine, P1, inHand.id("tk"), {});
  activate(inHand.engine, P1, inHand.id("tk"), "roar", { selected: { c: [inHand.id("mine")] } });
  assert.equal(inHand.engine.getStat(inHand.id("mine"), "strength"), 4);
  const { engine, id } = tigerBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("tk"), "roar", { selected: { c: [id("foe")] } }));
});

clause(TIGER, "0:ability:roar", "it can be used on the opponent's turn in a response window", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "tk", def: printing(TIGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", 2, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tk"), abilityId: "roar", selected: { c: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 4);
});

clause(TIGER, "0:ability:roar", "deploys for its printed cost of 4 with [E][E] and has its printed 3/1/4 stats; three resources or one [E] is refused", () => {
  const { engine, id } = tigerBoard({ zone: "hand", elitism: 4 });
  const before = ready(engine);
  play(engine, P1, id("tk"), {});
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("tk")), [3, 1, 4]);
  assert.deepEqual(engine.getSubtypes(id("tk")), ["kaiser"]);
  const short = tigerBoard({ zone: "hand", elitism: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tk")));
  const oneE = tigerBoard({ zone: "hand", elitism: 1, greed: 6 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("tk")), "one [E] is not [E][E]");
});

// ===============================================================================
// Towering Researchmajig — At the start of your turn, you may put a token on this
// card. RESEARCH -- COST: Remove a token from this card. -- EFFECT: The next
// numeric cost you pay this turn costs up to 1 less.
// Character (majig), cost 7, threshold [E][E], 4 strength / 2 speed / 5 life.
// ===============================================================================

const RESEARCHMAJIG = "9592c990-445a-441d-a4f9-f9a243511fc4";

function researchmajigBoard(opts: { zone?: "hand" | "play"; tokens?: number; elitism?: number; greed?: number; owner?: Pid; second?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "tr", def: printing(RESEARCHMAJIG), owner, zone, counters: zone === "play" && opts.tokens ? { token: opts.tokens } : undefined },
      ...(opts.second ? [{ key: "tr2", def: printing(RESEARCHMAJIG), owner, zone: "play" as const, counters: { token: 1 } }] : []),
      { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner, zone: "hand" },
      { key: "c3b", def: character({ name: "Cost3b", cost: 3 }), owner, zone: "hand" },
      { key: "payItem", def: payItem(3), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: owner === P1 ? P2 : P1, zone: "play" },
      ...bank("elitism", opts.elitism ?? 10, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

clause(RESEARCHMAJIG, "0:rule", "at the start of my turn I am offered a token: accepting puts exactly one on the card", () => {
  const { engine, id } = researchmajigBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "nothing at the start of the OPPONENT's turn");
  assert.equal(tokensOn(engine, id("tr")), 0);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const pc = pendingOf(engine);
  assert.ok(pc, "offered at the start of my turn");
  assert.equal(pc.playerId, P1);
  answerMay(engine, P1, true);
  assert.equal(tokensOn(engine, id("tr")), 1);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RESEARCHMAJIG, "0:rule", "each Researchmajig is offered its own token: with two, each may add one to itself", () => {
  const { engine, id } = researchmajigBoard({ second: true });
  endTurn(engine, P1);
  endTurn(engine, P2);
  drain(engine, mayAnswerer(true));
  assert.equal(tokensOn(engine, id("tr")), 1);
  assert.equal(tokensOn(engine, id("tr2")), 2, "(it already had 1)");
});

clause(RESEARCHMAJIG, "0:rule", "it is a 'may': declining adds no token", () => {
  const { engine, id } = researchmajigBoard({ tokens: 1 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.ok(pendingOf(engine), "pendingOf(engine)");
  answerMay(engine, P1, false);
  assert.equal(tokensOn(engine, id("tr")), 1);
});

clause(RESEARCHMAJIG, "0:rule", "tokens accumulate over turns: accepting on two turns gives two tokens", () => {
  const { engine, id } = researchmajigBoard();
  for (let turn = 0; turn < 2; turn++) {
    endTurn(engine, P1);
    endTurn(engine, P2);
    drain(engine, mayAnswerer(true));
  }
  assert.equal(tokensOn(engine, id("tr")), 2);
});

clause(RESEARCHMAJIG, "0:rule", "'your turn' is its controller's: a Researchmajig the opponent controls is offered to THEM at the start of THEIR turn only", () => {
  const { engine, id } = researchmajigBoard({ owner: P2 });
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const pc = pendingOf(engine);
  assert.ok(pc, "offered at the start of P2's turn");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(tokensOn(engine, id("tr")), 1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined, "not at the start of my turn");
});

clause(RESEARCHMAJIG, "0:rule", "it is offered only while the Researchmajig is in play: nothing happens at the start of a turn with it in my hand", () => {
  const { engine } = researchmajigBoard({ zone: "hand" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RESEARCHMAJIG, "1:ability:research", "RESEARCH removes exactly one token from the card as its cost and the next numeric cost I pay is 1 less (a 3-cost character costs 2)", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2, second: true });
  const before = ready(engine);
  activate(engine, P1, id("tr"), "research");
  assert.equal(tokensOn(engine, id("tr")), 1, "COST: remove a token");
  assert.equal(tokensOn(engine, id("tr2")), 1, "the other card keeps its token");
  assert.equal(before - ready(engine), 0, "no resources paid");
  assert.equal(engine.state.cards[id("tr")].depleted, false, "not depleted");
  const b2 = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(b2 - ready(engine), 2, "3 - 1");
});

clause(RESEARCHMAJIG, "1:ability:research", "'up to 1 less': RESEARCH asks its controller how much to reduce, 0 or 1, after removing the token", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2 });
  activateBase(engine, P1, id("tr"), "research");
  assert.equal(tokensOn(engine, id("tr")), 1, "COST: remove a token");
  const pc = pendingOf(engine);
  assert.ok(pc, "the controller is asked how much to reduce");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 1);
});

for (const [value, paid] of [
  [1, 2],
  [0, 3]
] as const) {
  clause(RESEARCHMAJIG, "1:ability:research", `choosing ${value} reduces the next numeric cost by exactly ${value}: a 3-cost character pays ${paid}`, () => {
    const { engine, id } = researchmajigBoard({ tokens: 2 });
    activateBase(engine, P1, id("tr"), "research");
    answerUpTo(engine, P1, value);
    assert.equal(pendingOf(engine), undefined, "the choice is answered");
    assert.equal(tokensOn(engine, id("tr")), 1, "the token is gone whatever is chosen");
    const before = ready(engine);
    play(engine, P1, id("c3"), {});
    assert.equal(zoneOf(engine, id("c3")), "play");
    assert.equal(before - ready(engine), paid);
  });
}

clause(RESEARCHMAJIG, "1:ability:research", "more than 1 (or a negative number) is refused: the choice stays open, and 1 is still accepted", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2 });
  activateBase(engine, P1, id("tr"), "research");
  for (const value of [2, -1]) {
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never),
      /Choose an integer/,
      `${value} is outside 0 to 1`
    );
    assert.equal(pendingOf(engine)?.kind, "chooseNumber", "the choice is still open");
  }
  answerUpTo(engine, P1, 1);
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 2);
});

clause(RESEARCHMAJIG, "1:ability:research", "only the NEXT cost: the second 3-cost character pays in full", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2 });
  activate(engine, P1, id("tr"), "research");
  play(engine, P1, id("c3"), {});
  const before = ready(engine);
  play(engine, P1, id("c3b"), {});
  assert.equal(before - ready(engine), 3);
});

clause(RESEARCHMAJIG, "1:ability:research", "each token is one use: two tokens, two RESEARCHes in one turn, then it is refused with none left", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2 });
  activate(engine, P1, id("tr"), "research");
  activate(engine, P1, id("tr"), "research");
  assert.equal(tokensOn(engine, id("tr")), 0);
  assert.throws(() => activateRaw(engine, P1, id("tr"), "research"), "no token to remove");
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  const spent1 = before - ready(engine);
  const mid = ready(engine);
  play(engine, P1, id("c3b"), {});
  const spent2 = mid - ready(engine);
  assert.equal(spent1 + spent2, 6 - 2, "two RESEARCHes saved 2 resources across the next costs");
});

clause(RESEARCHMAJIG, "1:ability:research", "is refused with no tokens, and then nothing is reduced", () => {
  const { engine, id } = researchmajigBoard({ tokens: 0 });
  assert.throws(() => activateRaw(engine, P1, id("tr"), "research"));
  assert.equal(tokensOn(engine, id("tr")), 0);
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 3);
});

clause(RESEARCHMAJIG, "1:ability:research", "the reduction ends with the turn: unused, it is gone on my next turn", () => {
  const { engine, id } = researchmajigBoard({ tokens: 1 });
  activate(engine, P1, id("tr"), "research");
  endTurn(engine, P1);
  endTurn(engine, P2);
  drain(engine, mayAnswerer(false));
  const before = ready(engine);
  play(engine, P1, id("c3"), {});
  assert.equal(before - ready(engine), 3);
});

clause(RESEARCHMAJIG, "1:ability:research", "the reduction also applies to a numeric ability cost I pay (pay 3 becomes pay 2; CR 406.5)", () => {
  const { engine, id } = researchmajigBoard({ tokens: 1 });
  activate(engine, P1, id("tr"), "research");
  const before = ready(engine);
  activate(engine, P1, id("payItem"), "a");
  assert.equal(before - ready(engine), 2, "a 'pay 3' ability costs 2 after RESEARCH");
});

clause(RESEARCHMAJIG, "1:ability:research", "only its controller can use it, and only from play", () => {
  const { engine, id } = researchmajigBoard({ tokens: 2 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("tr"), "research"));
  assert.equal(tokensOn(engine, id("tr")), 2);
  const inHand = researchmajigBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("tr"), "research"));
});

clause(RESEARCHMAJIG, "1:ability:research", "deploys for its printed cost of 7 with [E][E], has its printed 4/5/2 stats and enters with no tokens; six resources or one [E] is refused", () => {
  const { engine, id } = researchmajigBoard({ zone: "hand", elitism: 7 });
  const before = ready(engine);
  play(engine, P1, id("tr"), {});
  assert.equal(before - ready(engine), 7);
  assert.deepEqual(stat(engine, id("tr")), [4, 5, 2]);
  assert.deepEqual(engine.getSubtypes(id("tr")), ["majig"]);
  assert.equal(tokensOn(engine, id("tr")), 0, "no tokens on entering play");
  const short = researchmajigBoard({ zone: "hand", elitism: 6 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tr")));
  const oneE = researchmajigBoard({ zone: "hand", elitism: 1, greed: 9 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("tr")), "one [E] is not [E][E]");
});

// ===============================================================================
// Tri-Pole Magnet — ATTACH TO CHARACTER. GRAPPLE -- COST: Destroy this card, pick a
// "gear" card in your discard pile. -- EFFECT: If the attached character is still in
// play, put the "gear" card into play attached to that character.
// Item (gear), cost 2, threshold [E].
// ===============================================================================

const MAGNET = "a4d88aa2-42b4-454d-9964-bb55c6927142";

/** A gear that attaches to a character and gives it +2 strength. */
function gearItem(name: string): CardDefinition {
  return item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: {
      abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }]
    }
  });
}

/** A real gear card (ATTACH TO CHARACTER) that enters play with a token on it: Napiform Protuberance. */
const NAPIFORM_GEAR = "37093105-be92-4b4d-86bb-d994eaf0fff0";

function magnetBoard(opts: { zone?: "hand" | "play"; hostOwner?: Pid; elitism?: number; greed?: number; noGear?: boolean } = {}) {
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tm", def: printing(MAGNET), owner: P1, zone, attachedToKey: zone === "play" ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 1, life: 4, speed: 1 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...(opts.noGear
        ? []
        : [
            { key: "gearA", def: gearItem("GearA"), owner: P1, zone: "discard" as const },
            { key: "gearB", def: gearItem("GearB"), owner: P1, zone: "discard" as const }
          ]),
      { key: "plainItem", def: item({ name: "PlainItem" }), owner: P1, zone: "discard" },
      ...(opts.noGear ? [] : [{ key: "napiform", def: printing(NAPIFORM_GEAR), owner: P1, zone: "discard" as const }]),
      { key: "theirGear", def: gearItem("TheirGear"), owner: P2, zone: "discard" },
      { key: "handGear", def: gearItem("HandGear"), owner: P1, zone: "hand" },
      { key: "deckGear", def: gearItem("DeckGear"), owner: P1, zone: "deck" },
      { key: "playGear", def: gearItem("PlayGear"), owner: P1, zone: "play", attachedToKey: "mate" },
      { key: "opKill", def: tactic({ name: "OpKill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" },
      { key: "smashItem", def: sendTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const grapple = (engine: SpoilsEngine, id: (k: string) => string, gear: string, host: string = id("host")) =>
  activate(engine, P1, id("tm"), "grapple", { selected: { g: [gear], host: [host] } });

clause(MAGNET, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays its cost of 2 and stays under its player's control", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = magnetBoard({ zone: "hand" });
    const before = ready(engine);
    play(engine, P1, id("tm"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(zoneOf(engine, id("tm")), "play");
    assert.equal(engine.state.cards[id("tm")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("tm")].controllerId, P1);
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  }
});

clause(MAGNET, "0:attach", "is refused for a host that is not a character (item, location, faction, face-down card) or for no host at all", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("tm"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(attempt(id("handGear")), "a card in hand");
  assert.throws(() => playRaw(engine, P1, id("tm"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(engine, id("tm")), "hand");
  assert.equal(ready(engine), 6, "nothing was spent");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(MAGNET, "0:attach", "is refused one resource short of 2, and without [E] even with plenty of other resources", () => {
  const short = magnetBoard({ zone: "hand", elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tm"), { selected: { attachTo: [short.id("host")] } }));
  const noThreshold = magnetBoard({ zone: "hand", elitism: 0, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("tm"), { selected: { attachTo: [noThreshold.id("host")] } }));
  const exact = magnetBoard({ zone: "hand", elitism: 1, greed: 1 });
  play(exact.engine, P1, exact.id("tm"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(zoneOf(exact.engine, exact.id("tm")), "play", "one [E] and exactly 2 resources is enough");
});

clause(MAGNET, "0:attach", "when its host leaves play the Magnet leaves play with it, into its owner's discard pile (CR 301.4)", () => {
  const { engine, id } = magnetBoard();
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("tm")), "discard");
});

clause(MAGNET, "0:attach", "if the host is gone before the Magnet resolves it goes to its owner's discard pile instead of entering play (CR 507.2c)", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  playRaw(engine, P1, id("tm"), { selected: { attachTo: [id("host")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("opKill"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("tm")), "discard");
});

clause(MAGNET, "1:ability:grapple", "destroys the Magnet as its cost and puts the picked gear card from my discard pile into play under my control, attached to the character the Magnet was attached to", () => {
  const { engine, id } = magnetBoard();
  const before = ready(engine);
  grapple(engine, id, id("gearA"));
  assert.equal(zoneOf(engine, id("tm")), "discard", "COST: Destroy this card");
  assert.equal(zoneOf(engine, id("gearA")), "play");
  assert.equal(engine.state.cards[id("gearA")].attachedTo, id("host"), "attached to the Magnet's character");
  assert.equal(engine.state.cards[id("gearA")].controllerId, P1);
  assert.equal(engine.getStat(id("host"), "strength"), 3, "the gear's +2 strength applies to the host");
  assert.equal(zoneOf(engine, id("gearB")), "discard", "the other gear stays in the discard pile");
  assert.equal(ready(engine), before, "GRAPPLE costs no resources");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(MAGNET, "1:ability:grapple", "when the Magnet is on an opponent's character my gear attaches to THAT character", () => {
  const { engine, id } = magnetBoard({ hostOwner: P2 });
  grapple(engine, id, id("gearB"));
  assert.equal(engine.state.cards[id("gearB")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("gearB")].controllerId, P1, "I control the gear");
  assert.equal(engine.getStat(id("host"), "strength"), 3);
});

clause(MAGNET, "1:ability:grapple", "a real gear card that has an enters-play effect (Napiform Protuberance) is put into play attached to the character, not into the discard pile", () => {
  const { engine, id } = magnetBoard({ hostOwner: P1 });
  grapple(engine, id, id("napiform"));
  assert.equal(zoneOf(engine, id("napiform")), "play", "the gear card is in play");
  assert.equal(engine.state.cards[id("napiform")].attachedTo, id("host"), "attached to the Magnet's character");
  assert.equal(tokensOn(engine, id("napiform")), 1, "it entered play, so it got its token");
  assert.equal(discard(engine, P1).includes(id("napiform")), false, "and it is not in the discard pile");
});

clause(MAGNET, "1:ability:grapple", "only a 'gear' card in MY discard pile can be picked: a plain item, the opponent's discarded gear, gear in hand, deck or play are refused", () => {
  const { engine, id } = magnetBoard();
  for (const key of ["plainItem", "theirGear", "handGear", "deckGear", "playGear", "mate", "host"]) {
    assert.throws(() => grapple(engine, id, id(key)), key);
  }
  assert.throws(() => activateRaw(engine, P1, id("tm"), "grapple", { selected: { g: [], host: [id("host")] } }), "no gear picked");
  assert.throws(() => activateRaw(engine, P1, id("tm"), "grapple", { selected: { g: [id("gearA"), id("gearB")], host: [id("host")] } }), "two gear cards");
  assert.equal(zoneOf(engine, id("tm")), "play", "the refused attempts did not destroy it");
  grapple(engine, id, id("gearA"));
  assert.equal(zoneOf(engine, id("gearA")), "play");
});

clause(MAGNET, "1:ability:grapple", "if the attached character is no longer in play when GRAPPLE resolves, the gear is NOT put into play (it stays in the discard pile) but the Magnet is still destroyed", () => {
  const { engine, id } = magnetBoard();
  activateRaw(engine, P1, id("tm"), "grapple", { selected: { g: [id("gearA")], host: [id("host")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("opKill"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the character was destroyed in response");
  assert.equal(zoneOf(engine, id("tm")), "discard", "the cost was paid");
  assert.equal(zoneOf(engine, id("gearA")), "discard", "the gear stays where it was");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAGNET, "1:ability:grapple", "the cost is paid in printed order, so once the Magnet is destroyed it is a gear card in my discard pile and can itself be picked", () => {
  const { engine, id } = magnetBoard({ noGear: true });
  // the only gear card in my discard pile (plain items, characters and the opponent's gear do not count) is the Magnet itself, once destroyed
  grapple(engine, id, id("tm"));
  assert.equal(zoneOf(engine, id("tm")), "play", "the Magnet was destroyed, picked and put back into play");
  assert.equal(engine.state.cards[id("tm")].attachedTo, id("host"), "attached to the same character");
});

clause(MAGNET, "1:ability:grapple", "a plain item in my discard pile or the opponent's discarded gear are not 'gear cards in your discard pile'", () => {
  const { engine, id } = magnetBoard({ noGear: true });
  assert.throws(() => grapple(engine, id, id("plainItem")), "a plain item is not a gear card");
  assert.throws(() => grapple(engine, id, id("theirGear")), "the opponent's gear is not in my discard pile");
  assert.equal(zoneOf(engine, id("tm")), "play");
});

clause(MAGNET, "1:ability:grapple", "the host must be the character the Magnet is attached to: another character cannot be named", () => {
  const { engine, id } = magnetBoard();
  assert.throws(() => grapple(engine, id, id("gearA"), id("mate")), "not the attached character");
  assert.throws(() => grapple(engine, id, id("gearA"), id("foe")), "not the attached character");
  assert.equal(zoneOf(engine, id("tm")), "play");
  assert.equal(zoneOf(engine, id("gearA")), "discard");
});

clause(MAGNET, "1:ability:grapple", "only its controller can use it, and only while it is in play", () => {
  const { engine, id } = magnetBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("tm"), "grapple", { selected: { g: [id("theirGear")], host: [id("host")] } }));
  assert.equal(zoneOf(engine, id("tm")), "play");
  const inHand = magnetBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("tm"), "grapple", { selected: { g: [inHand.id("gearA")], host: [inHand.id("host")] } }));
});

clause(MAGNET, "1:ability:grapple", "the Magnet deploys for 2 and its ability can be used the same turn", () => {
  const { engine, id } = magnetBoard({ zone: "hand" });
  play(engine, P1, id("tm"), { selected: { attachTo: [id("mate")] } });
  grapple(engine, id, id("gearA"), id("mate"));
  assert.equal(engine.state.cards[id("gearA")].attachedTo, id("mate"));
  assert.equal(zoneOf(engine, id("tm")), "discard");
});

// ===============================================================================
// Adroit Marauder — While your opponent has at least 10 cards in their discard pile,
// this card gains 3 strength and 3 life.
// Character (pirate), cost 4, threshold [D][D][D], 2 strength / 3 speed / 2 life.
// ===============================================================================

const MARAUDER = "936d6c91-46c0-4f03-a48e-e64e20e1194b";

function marauderBoard(opts: { oppDiscard?: number; myDiscard?: number; zone?: "hand" | "play"; owner?: Pid; deception?: number; greed?: number } = {}) {
  const owner = opts.owner ?? P1;
  const other = owner === P1 ? P2 : P1;
  const kinds: Array<(n: number) => CardDefinition> = [
    (n) => character({ name: `OC${n}` }),
    (n) => item({ name: `OI${n}` }),
    (n) => tactic({ name: `OT${n}` }),
    (n) => location({ name: `OL${n}` }),
    (n) => resourceCard({ name: `OR${n}` })
  ];
  const retrieve = tactic({
    name: "Retrieve",
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "opponent" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    cards: [
      { key: "am", def: printing(MARAUDER), owner, zone: opts.zone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 3 }), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: other, zone: "play" },
      ...Array.from({ length: opts.oppDiscard ?? 0 }, (_, i) => ({ key: `od${i}`, def: kinds[i % 5](i), owner: other, zone: "discard" as const })),
      ...Array.from({ length: opts.myDiscard ?? 0 }, (_, i) => ({ key: `md${i}`, def: kinds[i % 5](i + 100), owner, zone: "discard" as const })),
      { key: "retrieve", def: retrieve, owner, zone: "hand" },
      { key: "zap1", def: zapTactic(1), owner, zone: "hand" },
      { key: "zap3", def: zapTactic(3), owner, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner, zone: "hand" },
      ...bank("deception", opts.deception ?? 4, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

for (const [n, bonus] of [
  [0, false],
  [9, false],
  [10, true],
  [11, true],
  [15, true]
] as const) {
  clause(MARAUDER, "0:rule", `with ${n} cards in my opponent's discard pile it ${bonus ? "has 5 strength and 5 life (+3/+3, no speed change)" : "has its printed 2 strength and 2 life"}`, () => {
    const { engine, id } = marauderBoard({ oppDiscard: n });
    assert.deepEqual(stat(engine, id("am")), bonus ? [5, 5, 3] : [2, 2, 3]);
    assert.deepEqual(stat(engine, id("ally")), [2, 2, 3], "another of my characters is never affected");
    assert.deepEqual(stat(engine, id("foe")), [1, 6, 1]);
  });
}

clause(MARAUDER, "0:rule", "only the OPPONENT's discard pile counts: 12 cards in my own discard pile and 9 in theirs gives no bonus", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 9, myDiscard: 12 });
  assert.deepEqual(stat(engine, id("am")), [2, 2, 3]);
});

clause(MARAUDER, "0:rule", "the cards in the opponent's discard pile can be of any type", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 10 });
  const types = new Set(discard(engine, P2).map((c) => engine.getDefinition(c).type));
  assert.equal(types.size, 5, "the discard pile holds all five card types");
  assert.deepEqual(stat(engine, id("am")), [5, 5, 3]);
});

clause(MARAUDER, "0:rule", "it turns ON when the opponent's discard pile reaches 10: a destroyed opponent character is the 10th card", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 9 });
  assert.deepEqual(stat(engine, id("am")), [2, 2, 3]);
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("foe")] } });
  assert.equal(discard(engine, P2).length, 10);
  assert.deepEqual(stat(engine, id("am")), [5, 5, 3]);
});

clause(MARAUDER, "0:rule", "it turns OFF when the pile drops below 10 again: a card taken out of the opponent's discard pile", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 10 });
  assert.deepEqual(stat(engine, id("am")), [5, 5, 3]);
  play(engine, P1, id("retrieve"), { selected: { t: [id("od0")] } });
  assert.equal(discard(engine, P2).length, 9);
  assert.deepEqual(stat(engine, id("am")), [2, 2, 3]);
});

clause(MARAUDER, "0:rule", "when it turns off, damage it already took can destroy it: 3 damage on a 5-life Marauder is survivable, on a 2-life one it is lethal", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 10 });
  play(engine, P1, id("zap3"), { selected: { t: [id("am")] } });
  assert.equal(zoneOf(engine, id("am")), "play", "3 damage < 5 life while the bonus is on");
  play(engine, P1, id("retrieve"), { selected: { t: [id("od0")] } });
  assert.equal(zoneOf(engine, id("am")), "discard", "the bonus ended: 3 damage >= 2 life");
});

clause(MARAUDER, "0:rule", "the bonus is real in damage terms: 4 damage kills a bare Marauder but not one with the bonus", () => {
  const bare = marauderBoard({ oppDiscard: 0 });
  play(bare.engine, P1, bare.id("zap3"), { selected: { t: [bare.id("am")] } });
  assert.equal(zoneOf(bare.engine, bare.id("am")), "discard", "3 damage kills the 2-life bare Marauder");
  const buffed = marauderBoard({ oppDiscard: 10 });
  play(buffed.engine, P1, buffed.id("zap3"), { selected: { t: [buffed.id("am")] } });
  play(buffed.engine, P1, buffed.id("zap1"), { selected: { t: [buffed.id("am")] } });
  assert.equal(zoneOf(buffed.engine, buffed.id("am")), "play", "4 damage < 5 life");
});

clause(MARAUDER, "0:rule", "'your opponent' is relative to the controller: a Marauder the opponent controls looks at MY discard pile", () => {
  const { engine, id } = marauderBoard({ owner: P2, oppDiscard: 0, myDiscard: 10 });
  // owner = P2, so "other" = P1: the 'oppDiscard' cards belong to P1 and 'myDiscard' to P2
  assert.deepEqual(stat(engine, id("am")), [2, 2, 3], "its own controller's discard pile does not count");
  const flipped = marauderBoard({ owner: P2, oppDiscard: 10, myDiscard: 0 });
  assert.deepEqual(stat(flipped.engine, flipped.id("am")), [5, 5, 3], "P1's (its opponent's) discard pile does");
});

clause(MARAUDER, "0:rule", "it applies on both players' turns", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 10 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(stat(engine, id("am")), [5, 5, 3]);
});

clause(MARAUDER, "0:rule", "it does nothing in hand and the bonus appears only once it is in play", () => {
  const { engine, id } = marauderBoard({ zone: "hand", oppDiscard: 10 });
  play(engine, P1, id("am"), {});
  assert.equal(zoneOf(engine, id("am")), "play");
  assert.deepEqual(stat(engine, id("am")), [5, 5, 3]);
});

clause(MARAUDER, "0:rule", "the bonus is gone once the Marauder leaves play", () => {
  const { engine, id } = marauderBoard({ oppDiscard: 10 });
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("am")] } });
  assert.equal(zoneOf(engine, id("am")), "discard");
  assert.deepEqual(stat(engine, id("ally")), [2, 2, 3], "nothing else got the bonus");
});

clause(MARAUDER, "0:rule", "deploys for its printed cost of 4 with [D][D][D]; three resources or only two [D] is refused", () => {
  const { engine, id } = marauderBoard({ zone: "hand", deception: 3, greed: 1 });
  const before = ready(engine);
  play(engine, P1, id("am"), {});
  assert.equal(before - ready(engine), 4);
  assert.deepEqual(stat(engine, id("am")), [2, 2, 3]);
  assert.deepEqual(engine.getSubtypes(id("am")), ["pirate"]);
  const short = marauderBoard({ zone: "hand", deception: 3, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("am")), "3 resources");
  const twoD = marauderBoard({ zone: "hand", deception: 2, greed: 6 });
  assert.throws(() => playRaw(twoD.engine, P1, twoD.id("am")), "two [D] is one short of [D][D][D]");
});

// ===============================================================================
// Ambuscade — COST: Play this only when your are being attacked. Destroy a
// character you control. X is twice that character's strength. -- EFFECT: Inflict X
// damage divided however you want to the attacking party.
// Tactic, cost 3, threshold [D].
// ===============================================================================

const AMBUSCADE = "264958e0-0bc6-44cf-b35d-2b648c292e7b";

function ambuscadeBoard(opts: { deception?: number; greed?: number; sacStrength?: number; tough?: boolean } = {}) {
  const boost = item({
    name: "Booster",
    attachTo: "character",
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "amb", def: printing(AMBUSCADE), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sac", strength: opts.sacStrength ?? 2, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "sac2", def: character({ name: "Sac2", strength: 3, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "booster", def: boost, owner: P1, zone: "play", attachedToKey: "sac2" },
      { key: "atkA", def: character({ name: "AtkA", strength: 1, life: opts.tough ? 10 : 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "atkB", def: character({ name: "AtkB", strength: 1, life: opts.tough ? 10 : 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 9 }), owner: P1, zone: "play" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

type AmbuscadeBoard = ReturnType<typeof ambuscadeBoard>;

/** P2 attacks P1's faction with `attackers`; priority passes to me in the response window. */
function beingAttacked(board: AmbuscadeBoard, attackers: string[], target: "faction" | "location" = "faction") {
  const { engine, id } = board;
  const tgt = target === "faction" ? ({ type: "faction", playerId: P1 } as const) : ({ type: "location", cardId: id("myLoc") } as never);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: attackers.map(id), target: tgt } as never);
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the attack");
}

/** Plays Ambuscade sacrificing `sac`, aiming at `party`, then divides the damage as `shares` (keys) says; returns the pending distribution prompt if it was shown. */
function ambuscade(board: AmbuscadeBoard, sac: string, party: string[], shares: Record<string, number>) {
  const { engine, id } = board;
  playRaw(engine, P1, id("amb"), { selected: { c: [id(sac)], atk: party.map(id) } });
  let prompted: Pending | undefined;
  const byId: Record<string, number> = {};
  for (const [key, n] of Object.entries(shares)) byId[id(key)] = n;
  // the opponent does not respond; the tactic resolves and I divide the damage
  let guard = 0;
  while ((engine.state.responseWindow || engine.state.pendingChoice) && guard++ < 20) {
    if (engine.state.pendingChoice) {
      const pc = pendingOf(engine)!;
      if (pc.kind === "distributeAmong") {
        prompted = pc;
        engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId as Pid, choice: { kind: "distributeAmong", shares: byId } } as never);
      } else {
        engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId as Pid, choice: declineAll(pc) } as never);
      }
      continue;
    }
    const w = engine.state.responseWindow!;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  return prompted;
}

clause(AMBUSCADE, "0:ability", "when I am being attacked: pays 3, destroys the character I sacrifice, and inflicts X = twice its strength (2 x 2 = 4) on the attacker", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  beingAttacked(board, ["atkA"]);
  const before = ready(engine);
  ambuscade(board, "sac", ["atkA"], { atkA: 4 });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(engine, id("sac")), "discard", "the sacrificed character is destroyed");
  assert.equal(zoneOf(engine, id("atkA")), "discard", "4 damage kills the 4-life attacker");
  assert.equal(zoneOf(engine, id("amb")), "discard", "the tactic ends in my discard pile");
  assert.equal(zoneOf(engine, id("blocker")), "play", "my other characters are untouched");
  assert.equal(zoneOf(engine, id("sac2")), "play");
});

for (const [strength, x] of [
  [1, 2],
  [2, 4],
  [3, 6]
] as const) {
  clause(AMBUSCADE, "0:ability", `X is twice the sacrificed character's strength: strength ${strength} gives X=${x}`, () => {
    const board = ambuscadeBoard({ sacStrength: strength, tough: true });
    const { engine, id } = board;
    beingAttacked(board, ["atkA", "atkB"]);
    const prompt = ambuscade(board, "sac", ["atkA", "atkB"], { atkA: x - 1, atkB: 1 });
    assert.ok(prompt, "I am asked how to divide the damage");
    assert.equal(prompt!.amount, x, `X = 2 x ${strength}`);
    assert.equal(zoneOf(engine, id("sac")), "discard");
    assert.equal(engine.state.cards[id("atkA")].damage, x - 1, "attacker A took its share");
    assert.equal(engine.state.cards[id("atkB")].damage, 1, "attacker B took its share");
  });
}

clause(AMBUSCADE, "0:ability", "X uses the sacrificed character's CURRENT strength: an attached +1 strength item makes strength 3 into 4, so X=8", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  assert.equal(engine.getStat(id("sac2"), "strength"), 4);
  beingAttacked(board, ["atkA", "atkB"]);
  const prompt = ambuscade(board, "sac2", ["atkA", "atkB"], { atkA: 5, atkB: 3 });
  assert.ok(prompt, "I am asked how to divide the damage");
  assert.equal(prompt!.amount, 8, "X = 2 x 4");
  assert.equal(zoneOf(engine, id("sac2")), "discard");
  assert.equal(zoneOf(engine, id("atkA")), "discard");
  assert.equal(zoneOf(engine, id("atkB")), "discard");
});

clause(AMBUSCADE, "0:ability", "I divide the damage however I want: all on one attacker, with nothing on the other", () => {
  const board = ambuscadeBoard({ sacStrength: 2 });
  const { engine, id } = board;
  beingAttacked(board, ["atkA", "atkB"]);
  ambuscade(board, "sac", ["atkA", "atkB"], { atkA: 0, atkB: 4 });
  assert.equal(zoneOf(engine, id("atkB")), "discard", "4 damage kills the 3-life attacker B");
  assert.equal(zoneOf(engine, id("atkA")), "play");
  assert.equal(engine.state.cards[id("atkA")].damage, 0, "A took nothing");
});

clause(AMBUSCADE, "0:ability", "I (the tactic's controller) choose the division, not the attacker's player", () => {
  const board = ambuscadeBoard();
  beingAttacked(board, ["atkA", "atkB"]);
  const prompt = ambuscade(board, "sac", ["atkA", "atkB"], { atkA: 2, atkB: 2 });
  assert.ok(prompt, "prompt");
  assert.equal(prompt!.playerId, P1);
});

/** Plays Ambuscade (X = 4) against a two-character party and stops at the "divide the damage" prompt. */
function divisionPrompt() {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  beingAttacked(board, ["atkA", "atkB"]);
  playRaw(engine, P1, id("amb"), { selected: { c: [id("sac")], atk: [id("atkA"), id("atkB")] } });
  let guard = 0;
  while (!(engine.state.pendingChoice && pendingOf(engine)!.kind === "distributeAmong") && engine.state.responseWindow && guard++ < 10) {
    const w = engine.state.responseWindow;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  assert.equal(pendingOf(engine)?.kind, "distributeAmong");
  const answer = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares } } as never);
  return { engine, id, answer };
}

clause(AMBUSCADE, "0:ability", "a legal division (2 and 2 of X=4) is accepted and applied", () => {
  const { engine, id, answer } = divisionPrompt();
  answer({ [id("atkA")]: 2, [id("atkB")]: 2 })();
  assert.equal(engine.state.cards[id("atkA")].damage, 2);
  assert.equal(engine.state.cards[id("atkB")].damage, 2);
});

clause(AMBUSCADE, "0:ability", "the whole of X must be divided: dividing only 2 of 4 damage is refused", () => {
  const { engine, id, answer } = divisionPrompt();
  assert.throws(answer({ [id("atkA")]: 1, [id("atkB")]: 1 }), "2 of 4");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong", "still waiting for a legal division");
});

clause(AMBUSCADE, "0:ability", "dividing more than X (6 of 4) is refused", () => {
  const { engine, id, answer } = divisionPrompt();
  assert.throws(answer({ [id("atkA")]: 3, [id("atkB")]: 3 }), "6 of 4");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong");
  assert.equal(engine.state.cards[id("atkA")].damage, 0);
});

clause(AMBUSCADE, "0:ability", "a negative share is refused (it cannot be used to heal or to hide damage)", () => {
  const { engine, id, answer } = divisionPrompt();
  assert.throws(answer({ [id("atkA")]: 5, [id("atkB")]: -1 }), "a negative share");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong");
  assert.equal(engine.state.cards[id("atkB")].damage, 0);
});

clause(AMBUSCADE, "0:ability", "a share to a character that is not in the attacking party (an idle opponent's character or my own) is refused", () => {
  const { engine, id, answer } = divisionPrompt();
  assert.throws(answer({ [id("atkA")]: 2, [id("idle")]: 2 }), "a character that is not attacking");
  assert.throws(answer({ [id("atkA")]: 2, [id("blocker")]: 2 }), "my own character");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong", "still waiting for a legal division");
  assert.equal(engine.state.cards[id("idle")].damage, 0);
  assert.equal(engine.state.cards[id("blocker")].damage, 0);
});

clause(AMBUSCADE, "0:ability", "a fractional share is refused", () => {
  const { engine, id, answer } = divisionPrompt();
  assert.throws(answer({ [id("atkA")]: 1.5, [id("atkB")]: 2.5 }), "1.5 + 2.5");
  assert.equal(pendingOf(engine)?.kind, "distributeAmong");
});

clause(AMBUSCADE, "0:ability", "damage only goes to the attacking party: an idle opponent's character, my blocker and the faction take nothing", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  const influence = engine.state.players[P1].influence;
  beingAttacked(board, ["atkA"]);
  ambuscade(board, "sac", ["atkA"], { atkA: 4 });
  assert.equal(engine.state.cards[id("idle")].damage, 0);
  assert.equal(engine.state.cards[id("blocker")].damage, 0);
  assert.equal(engine.state.players[P1].influence, influence);
});

clause(AMBUSCADE, "0:ability", "an attacker destroyed by the damage leaves the battle; destroying the whole party ends the battle", () => {
  const board = ambuscadeBoard({ sacStrength: 3 });
  const { engine, id } = board;
  beingAttacked(board, ["atkB"]);
  ambuscade(board, "sac", ["atkB"], { atkB: 6 });
  assert.equal(zoneOf(engine, id("atkB")), "discard");
  assert.deepEqual(engine.state.battle?.attackingParty ?? [], [], "no attacker left in the battle");
});

clause(AMBUSCADE, "0:ability", "it can be played later in the same attack too: after blockers have been declared", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  beingAttacked(board, ["atkA"]);
  // I pass, then block with my blocker; the next battle response window is mine too
  engine.perform({ type: "passPriority", playerId: P1 });
  resolvePendingResponses(engine);
  assert.equal(engine.state.battle?.phase, "blocking");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blocker")] });
  const w = engine.state.responseWindow;
  if (w && w.priorityPlayerId === P2) engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  ambuscade(board, "blocker", ["atkA"], { atkA: 2 });
  assert.equal(zoneOf(engine, id("blocker")), "discard", "the sacrificed character may be one of my blockers");
  assert.equal(engine.state.cards[id("atkA")].damage, 2);
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], [], "the destroyed blocker left the blocking party");
});

clause(AMBUSCADE, "0:ability", "an attack on my LOCATION is also an attack on me", () => {
  const board = ambuscadeBoard();
  beingAttacked(board, ["atkA"], "location");
  ambuscade(board, "sac", ["atkA"], { atkA: 4 });
  assert.equal(zoneOf(board.engine, board.id("sac")), "discard");
  assert.equal(zoneOf(board.engine, board.id("atkA")), "discard");
});

clause(AMBUSCADE, "0:ability", "only a character I control can be sacrificed: the opponent's attacker, an item, a location and a faction are refused", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  beingAttacked(board, ["atkA"]);
  const attempt = (sac: string) => () => playRaw(engine, P1, id("amb"), { selected: { c: [sac], atk: [id("atkA")] } });
  assert.throws(attempt(id("atkA")), "the attacker (the opponent's)");
  assert.throws(attempt(id("idle")), "an opponent's character");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("myLoc")), "a location");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(() => playRaw(engine, P1, id("amb"), { selected: { atk: [id("atkA")] } }), "nothing sacrificed");
  assert.throws(() => playRaw(engine, P1, id("amb"), { selected: { c: [id("sac"), id("sac2")], atk: [id("atkA")] } }), "two sacrificed");
  assert.equal(zoneOf(engine, id("amb")), "hand");
  assert.equal(ready(engine), 4);
  attempt(id("sac"))();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(AMBUSCADE, "0:ability", "the damage can only be aimed at the attacking party: an idle character, a blocker of mine or a faction cannot be picked", () => {
  const board = ambuscadeBoard();
  const { engine, id } = board;
  beingAttacked(board, ["atkA", "atkB"]);
  const attempt = (atk: string[]) => () => playRaw(engine, P1, id("amb"), { selected: { c: [id("sac")], atk } });
  assert.throws(attempt([id("idle"), id("atkB")]), "a character that is not attacking");
  assert.throws(attempt([id("blocker"), id("atkB")]), "my own character");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.equal(zoneOf(engine, id("amb")), "hand");
});

clause(AMBUSCADE, "0:ability", "cannot be played when I am not being attacked: on my own turn, on the opponent's turn before any attack, or when I am the attacker", () => {
  // my own turn, no attack
  const mine = ambuscadeBoard();
  mine.engine.state.activePlayerId = P1;
  mine.engine.state.priorityPlayerId = P1;
  assert.throws(() => playRaw(mine.engine, P1, mine.id("amb"), { selected: { c: [mine.id("sac")], atk: [mine.id("atkA")] } }), "my turn, no battle");
  assert.equal(zoneOf(mine.engine, mine.id("amb")), "hand");
  // the opponent's end-of-turn window: no attack was made
  const theirs = ambuscadeBoard();
  theirs.engine.perform({ type: "endTurn", playerId: P2 });
  assert.ok(theirs.engine.state.responseWindow, "I get a window to respond to them ending their turn");
  assert.throws(() => playRaw(theirs.engine, P1, theirs.id("amb"), { selected: { c: [theirs.id("sac")], atk: [theirs.id("atkA")] } }), "no attack has been made");
  assert.equal(zoneOf(theirs.engine, theirs.id("amb")), "hand");
  // I am the attacker
  const attacker = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "amb", def: printing(AMBUSCADE), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sac", strength: 2, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1)
    ]
  });
  attacker.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [attacker.id("mine")], target: { type: "faction", playerId: P2 } });
  assert.equal(attacker.engine.state.responseWindow?.priorityPlayerId, P1, "I (the attacker) hold priority in my own battle window");
  assert.throws(() => playRaw(attacker.engine, P1, attacker.id("amb"), { selected: { c: [attacker.id("sac")], atk: [attacker.id("mine")] } }), "I am the one attacking");
  assert.equal(zoneOf(attacker.engine, attacker.id("amb")), "hand");
});

clause(AMBUSCADE, "0:ability", "with no character of mine to sacrifice it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "amb", def: printing(AMBUSCADE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.throws(() => playRaw(engine, P1, id("amb"), { selected: { atk: [id("atk")] } }));
  assert.equal(zoneOf(engine, id("amb")), "hand");
});

clause(AMBUSCADE, "0:ability", "is refused one resource short of its cost of 3, and without [D] even with plenty of other resources", () => {
  const short = ambuscadeBoard({ deception: 2 });
  beingAttacked(short, ["atkA"]);
  assert.throws(() => playRaw(short.engine, P1, short.id("amb"), { selected: { c: [short.id("sac")], atk: [short.id("atkA")] } }));
  assert.equal(zoneOf(short.engine, short.id("sac")), "play");
  assert.equal(zoneOf(short.engine, short.id("amb")), "hand");
  const noD = ambuscadeBoard({ deception: 0, greed: 6 });
  beingAttacked(noD, ["atkA"]);
  assert.throws(() => playRaw(noD.engine, P1, noD.id("amb"), { selected: { c: [noD.id("sac")], atk: [noD.id("atkA")] } }));
  const exact = ambuscadeBoard({ deception: 1, greed: 2 });
  beingAttacked(exact, ["atkA"]);
  ambuscade(exact, "sac", ["atkA"], { atkA: 4 });
  assert.equal(zoneOf(exact.engine, exact.id("sac")), "discard", "one [D] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(AMBUSCADE, "0:ability", "a sacrificed character with 0 strength makes X=0: it is still destroyed and nothing is dealt", () => {
  const board = ambuscadeBoard({ sacStrength: 0 });
  const { engine, id } = board;
  beingAttacked(board, ["atkA"]);
  ambuscade(board, "sac", ["atkA"], { atkA: 0 });
  assert.equal(zoneOf(engine, id("sac")), "discard");
  assert.equal(engine.state.cards[id("atkA")].damage, 0);
  assert.equal(zoneOf(engine, id("atkA")), "play");
});

// ===============================================================================
// Befuddling Beggar — PANHANDLE -- COST: Deplete this card, pick a character. --
// EFFECT: The character either gains or loses 1 speed.
// Character (outcast), cost 2, threshold [D][D], 1 strength / 4 speed / 1 life.
// ===============================================================================

const BEGGAR = "a68bfa26-c188-47b6-bdc3-a39cb829f5c2";

function beggarBoard(opts: { zone?: "hand" | "play"; deception?: number; greed?: number; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BEGGAR), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 1, life: 3, speed: 0 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 2, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Uses PANHANDLE on `target` and answers the gain-or-lose choice. */
function panhandle(board: ReturnType<typeof beggarBoard>, target: string, gain: boolean) {
  const { engine, id } = board;
  activateRaw(engine, P1, id("bb"), "panhandle", { selected: { c: [id(target)] } });
  resolvePendingResponses(engine);
  const pc = pendingOf(engine);
  assert.ok(pc, "I am asked whether the character gains or loses speed");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Beggar's controller chooses");
  const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
  assert.equal(options.length, 2, "exactly two outcomes: gain 1 speed or lose 1 speed");
  const index = options.findIndex((o) => (gain ? /\+|gain/i.test(o.label ?? "") : /-|lose/i.test(o.label ?? "")));
  assert.ok(index >= 0, "index >= 0");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
}

clause(BEGGAR, "0:ability:panhandle", "PANHANDLE depletes the Beggar as its cost; choosing 'gains' gives the picked character exactly +1 speed (and no other stat)", () => {
  const board = beggarBoard();
  const { engine, id } = board;
  const before = ready(engine);
  panhandle(board, "mine", true);
  assert.equal(engine.state.cards[id("bb")].depleted, true, "COST: Deplete this card");
  assert.equal(before - ready(engine), 0, "no resources are paid");
  assert.deepEqual(stat(engine, id("mine")), [1, 3, 3], "speed 2 -> 3");
  assert.deepEqual(stat(engine, id("foe")), [2, 3, 3], "another character is unchanged");
});

clause(BEGGAR, "0:ability:panhandle", "choosing 'loses' takes exactly 1 speed away", () => {
  const board = beggarBoard();
  const { engine, id } = board;
  panhandle(board, "foe", false);
  assert.deepEqual(stat(engine, id("foe")), [2, 3, 2], "speed 3 -> 2");
  assert.deepEqual(stat(engine, id("mine")), [1, 3, 2]);
});

clause(BEGGAR, "0:ability:panhandle", "it can pick my own character, an opponent's, or the Beggar itself", () => {
  for (const [target, expected] of [["mine", 3], ["foe", 4], ["bb", 5]] as const) {
    const board = beggarBoard();
    panhandle(board, target, true);
    assert.equal(board.engine.getStat(board.id(target), "speed"), expected, target);
  }
});

clause(BEGGAR, "0:ability:panhandle", "speed cannot go below 0: a speed-0 character that loses 1 speed stays at 0 (CR 410.4)", () => {
  const board = beggarBoard();
  panhandle(board, "slow", false);
  assert.equal(board.engine.getStat(board.id("slow"), "speed"), 0);
  assert.equal(zoneOf(board.engine, board.id("slow")), "play");
});

clause(BEGGAR, "0:ability:panhandle", "the printed text gives no duration, so the change stays: it is still there on the next turn", () => {
  const board = beggarBoard();
  const { engine, id } = board;
  panhandle(board, "mine", true);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "speed"), 3);
});

clause(BEGGAR, "0:ability:panhandle", "only a character can be picked: an item, a location, a faction, a face-down card and a card in hand are refused; exactly one", () => {
  const { engine, id } = beggarBoard();
  const attempt = (picked: string[]) => () => activateRaw(engine, P1, id("bb"), "panhandle", { selected: { c: picked } });
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("place")]), "a location");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([id("inHand")]), "a card in hand");
  assert.throws(attempt([]), "nothing picked");
  assert.throws(attempt([id("mine"), id("foe")]), "two characters");
  assert.equal(engine.state.cards[id("bb")].depleted, false, "refused attempts did not deplete it");
  attempt([id("mine")])();
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(BEGGAR, "0:ability:panhandle", "cannot be used while depleted; works again once restored at the start of my next turn", () => {
  const board = beggarBoard();
  const { engine, id } = board;
  panhandle(board, "mine", true);
  assert.throws(() => activateRaw(engine, P1, id("bb"), "panhandle", { selected: { c: [id("foe")] } }), "already depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("bb")].depleted, false);
  panhandle(board, "mine", false);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "+1 then -1");
});

/** A battle between my 4-strength 1-life speed-2 attacker and their 4-strength 4-life speed-2 blocker; `adjust` runs in my first response window. */
function speedDuel(adjust?: "gain" | "lose") {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "bb", def: printing(BEGGAR), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 4, life: 1, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 4, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...bank("deception", 2, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  if (adjust) {
    // I am the attacker, so I hold priority first in my own response window
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bb"), abilityId: "panhandle", selected: { c: [id(adjust === "gain" ? "atk" : "blk")] }, variables: {} } as never);
    letMyResponseResolve(engine);
    const pc = pendingOf(engine)!;
    const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: options.findIndex((o) => (adjust === "gain" ? /\+|gain/i : /-|lose/i).test(o.label ?? "")) } } as never);
  }
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  autoResolveBattle(engine);
  return { engine, id };
}

clause(BEGGAR, "0:ability:panhandle", "control: with equal speed 2 the attacker and the blocker strike at the same time and both die", () => {
  const { engine, id } = speedDuel();
  assert.equal(zoneOf(engine, id("atk")), "discard");
  assert.equal(zoneOf(engine, id("blk")), "discard");
});

clause(BEGGAR, "0:ability:panhandle", "the speed change really matters in battle: +1 speed makes my attacker strike first and kill the blocker before it can hit back", () => {
  const { engine, id } = speedDuel("gain");
  assert.equal(zoneOf(engine, id("blk")), "discard", "the slower blocker is destroyed");
  assert.equal(zoneOf(engine, id("atk")), "play", "the faster attacker survived");
});

clause(BEGGAR, "0:ability:panhandle", "-1 speed on the blocker has the same effect: the faster attacker kills it first", () => {
  const { engine, id } = speedDuel("lose");
  assert.equal(zoneOf(engine, id("blk")), "discard");
  assert.equal(zoneOf(engine, id("atk")), "play");
});

clause(BEGGAR, "0:ability:panhandle", "usable the turn it enters play (CR 204.3a), only from play, and only by its controller", () => {
  const inHand = beggarBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("bb"), "panhandle", { selected: { c: [inHand.id("mine")] } }), "in hand");
  play(inHand.engine, P1, inHand.id("bb"), {});
  panhandle(inHand, "mine", true);
  assert.equal(inHand.engine.getStat(inHand.id("mine"), "speed"), 3);
  const { engine, id } = beggarBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => activateRaw(engine, P2, id("bb"), "panhandle", { selected: { c: [id("foe")] } }));
});

clause(BEGGAR, "0:ability:panhandle", "it can be used on the opponent's turn in a response window", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "bb", def: printing(BEGGAR), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bb"), abilityId: "panhandle", selected: { c: [id("foe")] }, variables: {} } as never);
  letMyResponseResolve(engine);
  const pc = pendingOf(engine);
  assert.ok(pc, "I choose gain or lose");
  const options = (pc as unknown as { options: Array<{ label?: string }> }).options;
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: options.findIndex((o) => /-|lose/i.test(o.label ?? "")) } } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "speed"), 2);
});

clause(BEGGAR, "0:ability:panhandle", "deploys for its printed cost of 2 with [D][D] and has its printed 1/1/4 stats; one resource short or one [D] short is refused", () => {
  const { engine, id } = beggarBoard({ zone: "hand", deception: 2 });
  const before = ready(engine);
  play(engine, P1, id("bb"), {});
  assert.equal(before - ready(engine), 2);
  assert.deepEqual(stat(engine, id("bb")), [1, 1, 4]);
  assert.deepEqual(engine.getSubtypes(id("bb")), ["outcast"]);
  const short = beggarBoard({ zone: "hand", deception: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bb")));
  const oneD = beggarBoard({ zone: "hand", deception: 1, greed: 5 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("bb")), "one [D] is not [D][D]");
});

// @@END@@
