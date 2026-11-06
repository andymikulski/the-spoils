// Clause tests - batch seed-saga-10, part p3 (groups 13-15, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-saga-10 --groups 13-15 --missing`. Expectations come from each card's PRINTED
// text and RULES.md / the CR; engine data (ability ids, declaration ids, choice kinds) is only used to drive the engine.

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
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";
import { printedStats } from "./_printed.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

/** A small deterministic PRNG (mulberry32). */
function seededRandom(seed = 20261020): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Always wins / always loses a coin flip (`random() < 0.5`). */
const WIN = () => 0.1;
const LOSE = () => 0.9;

type Ids = (key: string) => CardInstanceId;
type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";

/** Two-player board with the generic Develop-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seededRandom(),
    cards
  });
}

/** `n` resources of `icon` for `owner`, already attached to (spent on) their faction. */
const spent = (icon: Icon, n: number, owner: PlayerId): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const stat3 = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const influence = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => {
      const ev = entry.event as unknown as { playerId: string; won: boolean };
      return { playerId: ev.playerId, won: ev.won };
    });
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

function pickRaw(engine: SpoilsEngine, selected: CardInstanceId[], player?: PlayerId): void {
  const who = player ?? (pending(engine)!.playerId as PlayerId);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

// =====================================================================================
// Waylay Blade - item (gear), rogue, cost 2, threshold [D][D][D]
// TACTICAL, UNIQUE WAYLAY BLADE -- At the start of your turn, flip a coin. If you win, draw a card. -- The attached
// character gains 1 strength and 1 life. -- EQUIP: Pick a character. If it is a UNIQUE IOHANE then X is 0, otherwise
// X is 3. Pay X. Attach this card to the character.
// =====================================================================================

const WB = "cd88520e-51e0-414e-a10b-ebb6bfae2cdc";

/** P1 has a 2/3/2 "host"; the Blade is in play attached to it (default) or in hand. */
function wbBoard(extra: CardPlacement[] = [], o: { wb?: "play" | "hand"; attached?: boolean; active?: PlayerId; random?: () => number } = {}) {
  const zone = o.wb ?? "play";
  return duo(
    [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "wb", def: printing(WB), owner: P1, zone, ...(zone === "play" && o.attached !== false ? { attachedToKey: "host" } : {}) },
      ...extra
    ],
    { active: o.active, random: o.random }
  );
}

/** Deploys the Blade from hand. No ATTACH TO is printed (R2), so no host is picked; EQUIP attaches it later. */
function deployWB(engine: SpoilsEngine, id: Ids, _hostKey = "host"): void {
  play(engine, P1, id("wb"));
}

/** EQUIP onto `hostKey`; answers a "pay?" prompt with yes if the engine raises one. */
function equip(engine: SpoilsEngine, id: Ids, hostKey: string, player: PlayerId = P1): void {
  activate(engine, player, id("wb"), "equip", { selected: { host: [id(hostKey)] } });
  for (let guard = 0; guard < 4 && pending(engine)?.kind === "mayPay"; guard++) answerPending(engine, "mayPay", { pay: true });
  assert.equal(pending(engine), undefined, "no pick left open");
}

const smashItem = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
  });

// ---- TACTICAL ----

clause(WB, "0:kw:TACTICAL", "the Blade has TACTICAL; it is a rogue gear item with printed cost 2 and threshold [D][D][D] (a plain item has no TACTICAL)", () => {
  const { engine, id } = wbBoard([{ key: "plain", def: item({ name: "Plain" }), owner: P1, zone: "play" }]);
  assert.ok(engine.getKeywords(id("wb")).includes("tactical"), "engine.getKeywords(id(\"wb\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary item is not TACTICAL");
  const def = printing(WB);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "rogue");
  assert.deepEqual([...(def.subtype ?? [])], ["gear"]);
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "ddd");
});

clause(WB, "0:kw:TACTICAL", "deploys for exactly its cost 2 with three [D]; refused one resource short of the cost, and refused with an icon short of the threshold", () => {
  const ok = wbBoard([...bank("deception", 3, P1)], { wb: "hand" });
  assert.equal(readyResources(ok.engine, P1), 3);
  deployWB(ok.engine, ok.id);
  assert.equal(zoneOf(ok.engine, ok.id("wb")), "play");
  assert.equal(readyResources(ok.engine, P1), 1, "the printed cost 2 was paid (one of the three [D] is left)");

  // cost short: threshold met (2 spent + 1 ready [D]) but only ONE resource is ready to pay for a cost of 2
  const costShort = wbBoard([...bank("deception", 1, P1), ...spent("deception", 2, P1)], { wb: "hand" });
  assert.equal(readyResources(costShort.engine, P1), 1);
  refused(() => deployWB(costShort.engine, costShort.id), "1 ready resource for a cost of 2");
  assert.equal(zoneOf(costShort.engine, costShort.id("wb")), "hand");

  // threshold short: plenty to pay, only two [D]
  const thrShort = wbBoard([...bank("deception", 2, P1), ...bank("rage", 3, P1)], { wb: "hand" });
  refused(() => deployWB(thrShort.engine, thrShort.id), "[D][D] and [R] is not [D][D][D]", /threshold/i);
  assert.equal(zoneOf(thrShort.engine, thrShort.id("wb")), "hand");
});

clause(WB, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be: in the opponent's attack window (paying cost 2)", () => {
  const { engine, id } = wbBoard(
    [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }, ...bank("deception", 3, P1)],
    { wb: "hand", active: P2 }
  );
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  deployWB(engine, id);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("wb")), "play", "deployed on the opponent's turn");
  assert.equal(readyResources(engine, P1), 1, "cost 2 paid");
});

clause(WB, "0:kw:TACTICAL", "an ordinary item cannot be deployed in that window, nor can the TACTICAL Blade on the opponent's turn with no window open", () => {
  const { engine, id } = wbBoard(
    [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: item({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      ...bank("deception", 3, P1)
    ],
    { wb: "hand", active: P2 }
  );
  refused(() => deployWB(engine, id), "no response window is open on the opponent's turn");
  assert.equal(zoneOf(engine, id("wb")), "hand");
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => play(engine, P1, id("plain")), "a non-tactical item can't be deployed on the opponent's turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  deployWB(engine, id);
  assert.equal(zoneOf(engine, id("wb")), "play", "control: the TACTICAL Blade can");
});

clause(WB, "0:kw:TACTICAL", "TACTICAL changes timing only: in the opponent's window the [D][D][D] threshold and the cost are still required", () => {
  const mk = (cards: CardPlacement[]) => {
    const b = wbBoard([{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }, ...cards], { wb: "hand", active: P2 });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const thr = mk([...bank("deception", 2, P1), ...bank("rage", 3, P1)]);
  refused(() => deployWB(thr.engine, thr.id), "only two [D]", /threshold/i);
  const cost = mk([...bank("deception", 1, P1), ...spent("deception", 2, P1)]);
  refused(() => deployWB(cost.engine, cost.id), "one ready resource for cost 2");
  const ok = mk([...bank("deception", 3, P1)]);
  deployWB(ok.engine, ok.id);
  assert.equal(zoneOf(ok.engine, ok.id("wb")), "play");
});

// ---- UNIQUE ----

/** P1 has a Blade (u1) in play on "host" and another (u2) in hand; the opponent has a Blade (o1) in hand and a character "ohost". */
function wbUniqueBoard(opts: { active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "ohost", def: character({ name: "OHost", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "u1", def: printing(WB), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "u2", def: printing(WB), owner: P1, zone: "hand" },
      { key: "o1", def: printing(WB), owner: P2, zone: "hand" },
      ...bank("deception", 6, P1),
      ...bank("deception", 6, P2),
      ...(opts.extra ?? [])
    ],
    { active: opts.active }
  );
}
const keepUnique = (engine: SpoilsEngine, keep: CardInstanceId) => answerPending(engine, "uniqueSurvivor", { keep });

clause(WB, "0:unique", "deploying a second Waylay Blade forces the controller to choose which copy to keep; keeping the NEW one destroys the old one", () => {
  const { engine, id } = wbUniqueBoard();
  play(engine, P1, id("u2"), { selected: { attachTo: [id("host")] } });
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [id("u1"), id("u2")].sort());
  keepUnique(engine, id("u2"));
  assert.equal(zoneOf(engine, id("u2")), "play");
  assert.equal(zoneOf(engine, id("u1")), "discard", "the other copy is destroyed");
  assert.ok(engine.state.players[P1].discard.includes(id("u1")), "engine.state.players[P1].discard.includes(id(\"u1\"))");
  assert.equal(pending(engine), undefined);
});

clause(WB, "0:unique", "...and keeping the OLD copy destroys the new one", () => {
  const { engine, id } = wbUniqueBoard();
  play(engine, P1, id("u2"), { selected: { attachTo: [id("host")] } });
  keepUnique(engine, id("u1"));
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("u2")), "discard", "keeping the old copy destroys the new one");
  assert.equal(pending(engine), undefined);
});

clause(WB, "0:unique", "the restriction is per player: the opponent may control their own Waylay Blade at the same time, with no choice and no destruction", () => {
  const { engine, id } = wbUniqueBoard({ active: P2 });
  play(engine, P2, id("o1"), { selected: { attachTo: [id("ohost")] } });
  assert.equal(pending(engine), undefined, "no choice for either player");
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("o1")), "play");
});

clause(WB, "0:unique", "other UNIQUE designations and plain items are not duplicates of it", () => {
  const { engine, id } = wbUniqueBoard({
    extra: [
      { key: "other", def: item({ name: "OtherUnique", unique: "somebody-else", cost: 0 }), owner: P1, zone: "play" },
      { key: "plain", def: item({ name: "Waylay Blade", cost: 0 }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("u1")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(zoneOf(engine, id("plain")), "play");
  // control: an actual second Waylay Blade does trigger the choice
  play(engine, P1, id("u2"), { selected: { attachTo: [id("host")] } });
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
});

// ---- 1:rule  coin at the start of your turn ----

/** P1 and P2 both get a filled deck so a draw is visible. */
const decks = (): CardPlacement[] => [...fillers("pd", 6, P1, "deck"), ...fillers("od", 6, P2, "deck")];

clause(WB, "1:rule", "at the start of its controller's turn a coin is flipped by the controller: on a win they draw exactly one card (the top card)", () => {
  const { engine, id } = wbBoard(decks(), { random: WIN });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(coinFlips(engine).length, 0, "not at the opponent's turn start");
  assert.equal(handOf(engine, P1).length, 0);
  const top = deckOf(engine, P1)[0];
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }], "exactly one flip, by the controller");
  assert.deepEqual(handOf(engine, P1), [top], "drew exactly one card: the top one");
  assert.equal(deckOf(engine, P1).length, 5);
  assert.equal(zoneOf(engine, id("wb")), "play");
});

clause(WB, "1:rule", "on a lost flip nothing is drawn", () => {
  const { engine } = wbBoard(decks(), { random: LOSE });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(deckOf(engine, P1).length, 6);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(WB, "1:rule", "'your turn' is the Blade's controller's: with a Blade each, only the active player's Blade flips and only that player draws", () => {
  const { engine, id } = wbBoard(
    [...decks(), { key: "ohost", def: character({ name: "OHost" }), owner: P2, zone: "play" }, { key: "wb2", def: printing(WB), owner: P2, zone: "play", attachedToKey: "ohost" }],
    { random: WIN }
  );
  endTurn(engine, P1);
  assert.deepEqual(coinFlips(engine), [{ playerId: P2, won: true }], "P2's Blade flips at the start of P2's turn");
  assert.equal(handOf(engine, P2).length, 1);
  assert.equal(handOf(engine, P1).length, 0, "P1's Blade did not flip on P2's turn");
  endTurn(engine, P2);
  assert.deepEqual(coinFlips(engine), [{ playerId: P2, won: true }, { playerId: P1, won: true }]);
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(handOf(engine, P2).length, 1, "P2 drew nothing more");
  assert.equal(zoneOf(engine, id("wb")), "play");
});

clause(WB, "1:rule", "an unattached Blade in play stays in play and still flips its coin at the start of its controller's turn", () => {
  const unattached = wbBoard(decks(), { random: WIN, attached: false });
  assert.equal(zoneOf(unattached.engine, unattached.id("wb")), "play");
  endTurn(unattached.engine, P1);
  endTurn(unattached.engine, P2);
  assert.equal(zoneOf(unattached.engine, unattached.id("wb")), "play", "nothing printed destroys an unattached Blade");
  assert.equal(coinFlips(unattached.engine).length, 1, "unattached Blade in play still flips");
  assert.equal(handOf(unattached.engine, P1).length, 1);
});

clause(WB, "1:rule", "a Blade in hand does not flip", () => {
  const inHand = wbBoard(decks(), { random: WIN, wb: "hand" });
  endTurn(inHand.engine, P1);
  endTurn(inHand.engine, P2);
  assert.equal(coinFlips(inHand.engine).length, 0, "a Blade in hand does nothing");
  assert.deepEqual(handOf(inHand.engine, P1), [inHand.id("wb")], "no card drawn: the hand is still just the Blade");
});

clause(WB, "1:rule", "a Blade that has been destroyed no longer flips", () => {
  const { engine, id } = wbBoard([...decks(), { key: "smash", def: smashItem(), owner: P1, zone: "hand" }], { random: WIN });
  play(engine, P1, id("smash"), { selected: { t: [id("wb")] } });
  assert.equal(zoneOf(engine, id("wb")), "discard");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(handOf(engine, P1).length, 0);
});

// ---- 2:rule  +1/+1 to the attached character ----

clause(WB, "2:rule", "the attached character gains 1 strength and 1 life (speed untouched); other characters and an unattached Blade give nothing", () => {
  const { engine, id } = wbBoard([{ key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" }]);
  assert.deepEqual(stat3(engine, id("host")), [3, 4, 2]);
  assert.deepEqual(stat3(engine, id("other")), [2, 3, 2], "control: another character is unaffected");
  const loose = wbBoard([], { attached: false });
  assert.deepEqual(stat3(loose.engine, loose.id("host")), [2, 3, 2], "an unattached Blade gives nothing");
});

clause(WB, "2:rule", "it works on an opponent's character too ('the attached character'), and only on that one", () => {
  const { engine, id } = wbBoard(
    [
      { key: "oc", def: character({ name: "OC", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "wb2", def: printing(WB), owner: P2, zone: "play", attachedToKey: "oc" }
    ]
  );
  assert.deepEqual(stat3(engine, id("oc")), [3, 4, 2]);
  assert.deepEqual(stat3(engine, id("host")), [3, 4, 2], "P1's own Blade boosts P1's host");
});

clause(WB, "2:rule", "the bonus ends when the Blade leaves play", () => {
  const { engine, id } = wbBoard([{ key: "smash", def: smashItem(), owner: P1, zone: "hand" }]);
  assert.deepEqual(stat3(engine, id("host")), [3, 4, 2]);
  play(engine, P1, id("smash"), { selected: { t: [id("wb")] } });
  assert.equal(zoneOf(engine, id("wb")), "discard");
  assert.deepEqual(stat3(engine, id("host")), [2, 3, 2], "off after the Blade left");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(WB, "2:rule", "the extra strength is real damage: an unblocked 3-strength attack hits for 3 with the Blade and for 2 without", () => {
  const withBlade = wbBoard();
  const before = influence(withBlade.engine, P2);
  fight(withBlade.engine, P1, [withBlade.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(withBlade.engine, P2), 3);
  const without = wbBoard([], { attached: false });
  const b2 = influence(without.engine, P2);
  fight(without.engine, P1, [without.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(b2 - influence(without.engine, P2), 2, "control: no Blade, 2 damage");
});

clause(WB, "2:rule", "the extra life is real: the host (life 3+1) survives 3 battle damage and dies to 4; without the Blade 3 kills it", () => {
  const mk = (atkStr: number, attached: boolean) => {
    const b = wbBoard([{ key: "atk", def: character({ name: "Atk", strength: atkStr, life: 9, speed: 2 }), owner: P2, zone: "play" }], { active: P2, attached });
    fight(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("host")]);
    return b;
  };
  const survives = mk(3, true);
  assert.equal(zoneOf(survives.engine, survives.id("host")), "play", "3 damage < life 4");
  assert.equal(survives.engine.state.cards[survives.id("host")].damage, 3);
  const dies = mk(4, true);
  assert.equal(zoneOf(dies.engine, dies.id("host")), "discard", "4 damage kills a life-4 host");
  const noBlade = mk(3, false);
  assert.equal(zoneOf(noBlade.engine, noBlade.id("host")), "discard", "control: life 3 without the Blade dies to 3");
});

// ---- 3:ability:equip ----

clause(WB, "3:ability:equip", "pays 3 for an ordinary character: with exactly three resources (any icons) the Blade moves onto it and its stats change", () => {
  const { engine, id } = wbBoard([{ key: "h2", def: character({ name: "H2", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }, ...bank("rage", 3, P1)]);
  equip(engine, id, "h2");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("h2"));
  assert.equal(readyResources(engine, P1), 0, "X = 3 was paid");
  assert.deepEqual(stat3(engine, id("h2")), [2, 3, 1]);
  assert.deepEqual(stat3(engine, id("host")), [2, 3, 2], "re-equipping moves the bonus off the old host");
});

clause(WB, "3:ability:equip", "a UNIQUE IOHANE host makes X = 0: equipping costs nothing, even with no resources at all", () => {
  const { engine, id } = wbBoard([{ key: "ioh", def: character({ name: "Somebody", unique: "iohane", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  equip(engine, id, "ioh");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("ioh"));
  assert.deepEqual(stat3(engine, id("ioh")), [2, 3, 1]);
  const rich = wbBoard([{ key: "ioh", def: character({ name: "Somebody", unique: "iohane", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }, ...bank("rage", 5, P1)]);
  equip(rich.engine, rich.id, "ioh");
  assert.equal(readyResources(rich.engine, P1), 5, "nothing paid for Iohane");
});

clause(WB, "3:ability:equip", "X = 0 is about the UNIQUE designation, not the name: a character merely named Iohane, or UNIQUE something else, still costs 3", () => {
  for (const def of [character({ name: "Iohane", strength: 1, life: 2, speed: 1 }), character({ name: "Iohane", unique: "somebody-else", strength: 1, life: 2, speed: 1 })]) {
    const { engine, id } = wbBoard([{ key: "h2", def, owner: P1, zone: "play" }, ...bank("rage", 4, P1)]);
    equip(engine, id, "h2");
    assert.equal(engine.state.cards[id("wb")].attachedTo, id("h2"));
    assert.equal(readyResources(engine, P1), 1, "3 of 4 were paid");
  }
});

clause(WB, "3:ability:equip", "an unaffordable X is refused: with only 2 ready resources (or 3 where one is spent) a non-Iohane equip cannot be activated", () => {
  const two = wbBoard([{ key: "h2", def: character({ name: "H2" }), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]);
  refused(() => equip(two.engine, two.id, "h2"), "X = 3 with 2 resources");
  assert.equal(two.engine.state.cards[two.id("wb")].attachedTo, two.id("host"), "the Blade stays put");
  assert.equal(readyResources(two.engine, P1), 2, "nothing paid");
  const withSpent = wbBoard([{ key: "h2", def: character({ name: "H2" }), owner: P1, zone: "play" }, ...bank("rage", 2, P1), ...spent("rage", 1, P1)]);
  refused(() => equip(withSpent.engine, withSpent.id, "h2"), "a spent resource cannot pay");
  assert.equal(withSpent.engine.state.cards[withSpent.id("wb")].attachedTo, withSpent.id("host"));
});

clause(WB, "3:ability:equip", "face-down (Volition) resources pay X as well", () => {
  const { engine, id } = wbBoard([{ key: "h2", def: character({ name: "H2" }), owner: P1, zone: "play" }, ...volition(3, P1)]);
  equip(engine, id, "h2");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("h2"));
  assert.equal(readyResources(engine, P1), 0);
});

clause(WB, "3:ability:equip", "any character can be picked, including an opponent's: the Blade goes onto it (still controlled by its controller) and X = 3", () => {
  const { engine, id } = wbBoard([{ key: "oc", def: character({ name: "OC", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" }, ...bank("rage", 4, P1)]);
  equip(engine, id, "oc");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("oc"));
  assert.equal(engine.state.cards[id("wb")].controllerId, P1);
  assert.deepEqual(stat3(engine, id("oc")), [2, 3, 1]);
  assert.equal(readyResources(engine, P1), 1);
});

clause(WB, "3:ability:equip", "only a character in play can be picked: items, locations, the faction, and characters in hand or discard are refused", () => {
  const { engine, id } = wbBoard(
    [
      { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "ingrave", def: character({ name: "InGrave" }), owner: P1, zone: "discard" },
      ...bank("rage", 12, P1)
    ]
  );
  for (const bad of ["it", "loc", "inhand", "ingrave"]) {
    refused(() => equip(engine, id, bad), `${bad} is not a character in play`);
    assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"), `${bad}: nothing moved`);
  }
  equip(engine, id, "h2");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("h2"), "control: a character in play works");
  assert.equal(readyResources(engine, P1), 9);
});

clause(WB, "3:ability:equip", "re-equipping an attached Blade onto another character works repeatedly (3 each time)", () => {
  const { engine, id } = wbBoard([{ key: "h2", def: character({ name: "H2", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }, ...bank("rage", 6, P1)]);
  equip(engine, id, "h2");
  equip(engine, id, "host");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"));
  assert.deepEqual(stat3(engine, id("host")), [3, 4, 2]);
  assert.deepEqual(stat3(engine, id("h2")), [1, 2, 1]);
  assert.equal(readyResources(engine, P1), 0);
});

clause(WB, "3:ability:equip", "only the Blade's controller can use EQUIP (the opponent cannot, even on their own turn)", () => {
  const { engine, id } = wbBoard([{ key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }, ...bank("rage", 4, P1), ...bank("rage", 4, P2)]);
  refused(() => equip(engine, id, "oc", P2), "the opponent has no priority / does not control the Blade");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"));
  equip(engine, id, "oc");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("oc"), "control: the controller can");
});

clause(WB, "3:ability:equip", "no ATTACH TO is printed: the Blade deploys from hand unattached (no host needed) and is attached later with EQUIP", () => {
  const { engine, id } = wbBoard([...bank("deception", 3, P1), ...bank("rage", 3, P1)], { wb: "hand" });
  play(engine, P1, id("wb"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("wb")), "play");
  assert.equal(engine.state.cards[id("wb")].attachedTo, undefined, "it sits in play unattached");
  equip(engine, id, "host");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"));
});

clause(WB, "3:ability:equip", "a deployed Blade with a host can still be moved by EQUIP afterwards", () => {
  const { engine, id } = wbBoard([{ key: "h2", def: character({ name: "H2", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }, ...bank("deception", 3, P1), ...bank("rage", 6, P1)], { wb: "hand" });
  deployWB(engine, id, "host");
  assert.equal(engine.state.cards[id("wb")].attachedTo, undefined, "deployed unattached (no ATTACH TO printed)");
  equip(engine, id, "host");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"));
  equip(engine, id, "h2");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("h2"));
});

// =====================================================================================
// Well Laid Plans - tactic, rogue, cost 4, threshold [D]
// EXTRA COST: Pick an opponent. -- Search that player's deck for a card and reveal it. Put it into play under its
// owner's control as a face-down resource. -- Search your deck for a character and reveal it. Put it into play under
// its owner's control as a face-down resource.
// =====================================================================================

const WLP = "5989ea37-35f7-443c-9b79-64ce0475309c";

/** P1 holds the tactic with four [D]; P2's deck: char o1, item o2, location o3, char o4 + padding; P1's deck: char m1, item m2, char m3 + padding. */
function wlpBoard(o: { extra?: CardPlacement[]; random?: () => number; res?: CardPlacement[]; myDeck?: "mixed" | "noChars"; theirDeck?: boolean } = {}) {
  const pad = (owner: PlayerId, n: number) => fillers(owner === P1 ? "mp" : "op", n, owner, "deck", (i) => item({ name: `Pad${i}` }));
  return duo(
    [
      { key: "t", def: printing(WLP), owner: P1, zone: "hand" },
      ...(o.theirDeck === false
        ? []
        : [
            { key: "o1", def: character({ name: "O1", strength: 2, life: 2 }), owner: P2, zone: "deck" as const },
            { key: "o2", def: item({ name: "O2" }), owner: P2, zone: "deck" as const },
            { key: "o3", def: location({ name: "O3" }), owner: P2, zone: "deck" as const },
            { key: "o4", def: character({ name: "O4" }), owner: P2, zone: "deck" as const },
            ...pad(P2, 6)
          ]),
      ...(o.myDeck === "noChars"
        ? [{ key: "m2", def: item({ name: "M2" }), owner: P1, zone: "deck" as const }, ...pad(P1, 6)]
        : [
            { key: "m1", def: character({ name: "M1", strength: 2, life: 2 }), owner: P1, zone: "deck" as const },
            { key: "m2", def: item({ name: "M2" }), owner: P1, zone: "deck" as const },
            { key: "m3", def: character({ name: "M3" }), owner: P1, zone: "deck" as const },
            ...pad(P1, 6)
          ]),
      ...(o.res ?? bank("deception", 4, P1)),
      ...(o.extra ?? [])
    ],
    { random: o.random }
  );
}

/** The id of the declaration the open pick belongs to ("theirs" / "mine"). */
const openDecl = (engine: SpoilsEngine): string | undefined => (pending(engine) as unknown as { declaration?: { id: string } } | undefined)?.declaration?.id;

/** Plays the tactic, then answers the two picks (`theirs`, `mine`; undefined = pick nothing). */
function runWlp(b: ReturnType<typeof wlpBoard>, theirs?: string, mine?: string): void {
  const { engine, id } = b;
  play(engine, P1, id("t"));
  assert.equal(openDecl(engine), "theirs", "first the search of the other player's deck");
  answerPending(engine, "chooserSelectsTarget", { selected: theirs ? [id(theirs)] : [] });
  if (pending(engine)) {
    assert.equal(openDecl(engine), "mine", "then the search of my own deck");
    answerPending(engine, "chooserSelectsTarget", { selected: mine ? [id(mine)] : [] });
  }
  assert.equal(pending(engine), undefined);
}

clause(WLP, "0:extraCost", "Well Laid Plans is a rogue tactic with printed cost 4 and threshold [D]: pays 4 (not more), refused one resource short, refused without a [D]", () => {
  const def = printing(WLP);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "d");

  const ok = wlpBoard({ res: [...bank("deception", 1, P1), ...bank("rage", 4, P1)] });
  assert.equal(readyResources(ok.engine, P1), 5);
  runWlp(ok, "o1", "m1");
  assert.equal(zoneOf(ok.engine, ok.id("t")), "discard", "the tactic resolved");
  // 5 ready - cost 4 + my own new face-down resource (the opponent's goes to the opponent)
  assert.equal(readyResources(ok.engine, P1), 2, "cost 4 paid exactly (5 - 4 + the new resource)");

  const costShort = wlpBoard({ res: [...bank("deception", 3, P1)] });
  refused(() => play(costShort.engine, P1, costShort.id("t")), "3 resources for cost 4");
  assert.equal(zoneOf(costShort.engine, costShort.id("t")), "hand");
  assert.equal(readyResources(costShort.engine, P1), 3);

  const costShortSpent = wlpBoard({ res: [...bank("deception", 3, P1), ...spent("deception", 1, P1)] });
  refused(() => play(costShortSpent.engine, P1, costShortSpent.id("t")), "a spent resource cannot pay");

  const thrShort = wlpBoard({ res: [...bank("rage", 4, P1)] });
  refused(() => play(thrShort.engine, P1, thrShort.id("t")), "four [R] but no [D]", /threshold/i);
  assert.equal(zoneOf(thrShort.engine, thrShort.id("t")), "hand");
});

clause(WLP, "0:extraCost", "the opponent is the one searched: the first pick draws on the opponent's deck only, never my own deck (their deck is not shuffled or touched by a refused pick)", () => {
  const b = wlpBoard();
  play(b.engine, P1, b.id("t"));
  assert.equal(openDecl(b.engine), "theirs");
  refused(() => pickRaw(b.engine, [b.id("m1")]), "my own deck is not the opponent's deck", undefined);
  assert.equal(b.engine.state.cards[b.id("m1")].zone, "deck");
  pickRaw(b.engine, [b.id("o1")]);
  assert.equal(zoneOf(b.engine, b.id("o1")), "play", "control: a card of the opponent's deck is accepted");
});

clause(WLP, "1:rule", "any card of the opponent's deck can be found (character, item, location): it goes into play face-down under its OWNER's control as a resource, and is revealed", () => {
  for (const [key, type] of [["o1", "character"], ["o2", "item"], ["o3", "location"]] as const) {
    const b = wlpBoard();
    const before = readyResources(b.engine, P2);
    const mineBefore = [...deckOf(b.engine, P1)];
    runWlp(b, key, undefined);
    const st = b.engine.state.cards[b.id(key)];
    assert.equal(st.zone, "play", `${type} is put into play`);
    assert.equal(st.faceDown, true, `${type} enters face-down`);
    assert.equal(st.controllerId, P2, "the opponent (its owner) controls it");
    assert.equal(st.ownerId, P2);
    assert.ok(b.engine.state.players[P2].play.includes(b.id(key)), "b.engine.state.players[P2].play.includes(b.id(key))");
    assert.equal(readyResources(b.engine, P2), before + 1, "it works as a (Volition) resource for its owner");
    assert.equal(deckOf(b.engine, P2).includes(b.id(key)), false);
    assert.equal(b.engine.state.players[P1].play.includes(b.id(key)), false, "not under my control");
    const reveals = revealEvents(b.engine);
    assert.ok(reveals.some((ev) => ((ev.event as unknown as { cardIds: string[] }).cardIds).includes(b.id(key))), "the found card is revealed");
    assert.equal(deckOf(b.engine, P1).length, mineBefore.length, "nothing taken from my deck when I decline the second search");
  }
});

clause(WLP, "1:rule", "only cards in the opponent's deck can be picked: cards in their hand / play / discard and in my own zones are refused", () => {
  const b = wlpBoard({
    extra: [
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      { key: "op", def: character({ name: "OP" }), owner: P2, zone: "play" },
      { key: "od", def: character({ name: "OD" }), owner: P2, zone: "discard" }
    ]
  });
  play(b.engine, P1, b.id("t"));
  for (const bad of ["oh", "op", "od", "m1", "t"]) {
    refused(() => pickRaw(b.engine, [b.id(bad)]), `${bad} is not in the opponent's deck`);
    assert.equal(openDecl(b.engine), "theirs", "the pick is still open");
  }
  pickRaw(b.engine, [b.id("o4")]);
  assert.equal(zoneOf(b.engine, b.id("o4")), "play", "control");
});

clause(WLP, "1:rule", "exactly one card is found, and the opponent's deck is shuffled afterwards (CR 312.1)", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const b = wlpBoard({ random: seededRandom(seed * 7919) });
    const startSize = deckOf(b.engine, P2).length;
    runWlp(b, "o1", undefined);
    assert.equal(deckOf(b.engine, P2).length, startSize - 1, "exactly one card left their deck");
    orders.add(deckOf(b.engine, P2).join(","));
  }
  assert.ok(orders.size > 3, `their deck came out in ${orders.size} different orders`);
});

clause(WLP, "1:rule", "with the opponent's deck empty there is nothing to find and the tactic still resolves its second sentence", () => {
  const b = wlpBoard({ theirDeck: false });
  play(b.engine, P1, b.id("t"));
  // either the empty search is skipped, or the pick is answered with nothing
  if (openDecl(b.engine) === "theirs") answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(openDecl(b.engine), "mine", "my own search still happens");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("m1")] });
  assert.equal(zoneOf(b.engine, b.id("m1")), "play");
  assert.equal(b.engine.state.cards[b.id("m1")].faceDown, true);
});

clause(WLP, "2:rule", "my own search finds a CHARACTER: it goes into play face-down under my control as a resource, revealed", () => {
  for (const key of ["m1", "m3"]) {
    const b = wlpBoard();
    const before = readyResources(b.engine, P1);
    runWlp(b, "o1", key);
    const st = b.engine.state.cards[b.id(key)];
    assert.equal(st.zone, "play");
    assert.equal(st.faceDown, true);
    assert.equal(st.controllerId, P1);
    assert.ok(b.engine.state.players[P1].play.includes(b.id(key)), "b.engine.state.players[P1].play.includes(b.id(key))");
    assert.equal(readyResources(b.engine, P1), before - 4 + 1, "cost 4, plus the new face-down resource");
    assert.ok(revealEvents(b.engine).some((ev) => ((ev.event as unknown as { cardIds: string[] }).cardIds).includes(b.id(key))), "revealed");
    assert.equal(zoneOf(b.engine, b.id("o1")), "play", "the first search also happened");
  }
});

clause(WLP, "2:rule", "only characters of MY deck can be picked: my items, the opponent's deck cards and my other zones are refused", () => {
  const b = wlpBoard({ extra: [{ key: "mh", def: character({ name: "MH" }), owner: P1, zone: "discard" }] });
  play(b.engine, P1, b.id("t"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1")] });
  assert.equal(openDecl(b.engine), "mine");
  for (const bad of ["m2", "o4", "o2", "mh"]) {
    refused(() => pickRaw(b.engine, [b.id(bad)]), `${bad} is not a character in my deck`);
    assert.equal(openDecl(b.engine), "mine");
  }
  pickRaw(b.engine, [b.id("m3")]);
  assert.equal(zoneOf(b.engine, b.id("m3")), "play", "control");
});

clause(WLP, "2:rule", "my deck is shuffled afterwards (CR 312.1)", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const b = wlpBoard({ random: seededRandom(seed * 104729) });
    const startSize = deckOf(b.engine, P1).length;
    runWlp(b, "o1", "m1");
    assert.equal(deckOf(b.engine, P1).length, startSize - 1);
    orders.add(deckOf(b.engine, P1).join(","));
  }
  assert.ok(orders.size > 3, `my deck came out in ${orders.size} different orders`);
});

clause(WLP, "2:rule", "a search can fail: with no character in my deck nothing is put into play, and the deck is still shuffled", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const b = wlpBoard({ random: seededRandom(seed * 15485863), myDeck: "noChars" });
    const startDeck = [...deckOf(b.engine, P1)];
    play(b.engine, P1, b.id("t"));
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1")] });
    if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
    assert.equal(pending(b.engine), undefined);
    assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...startDeck].sort(), "nothing left my deck");
    assert.equal(b.engine.state.players[P1].play.filter((c) => b.engine.state.cards[c].faceDown).length, 0, "no face-down resource of mine");
    orders.add(deckOf(b.engine, P1).join(","));
  }
  assert.ok(orders.size > 3, `a failed search still shuffles: ${orders.size} different orders`);
});

clause(WLP, "2:rule", "I may decline to take a character even when one is available (a search may find nothing); the deck is shuffled anyway", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const b = wlpBoard({ random: seededRandom(seed * 2750159) });
    runWlp(b, "o1", undefined);
    assert.equal(zoneOf(b.engine, b.id("m1")), "deck");
    assert.equal(zoneOf(b.engine, b.id("m3")), "deck");
    orders.add(deckOf(b.engine, P1).join(","));
  }
  assert.ok(orders.size > 3, `shuffled: ${orders.size} different orders`);
});

// =====================================================================================
// Banner of Avarice - item (banner), universal, cost 2, no threshold
// PROVIDES: [G] -- When a card that provides at least [G] enters play under your control, you may pay 1. If you do,
// pick a card in a discard pile and remove it from the game. If you do, you may pick a character. That character
// gains 1 life this turn. -- BURN IT: Pay 2. Destroy this card. Draw 2 cards.
// =====================================================================================

const BA = "590fa44a-e514-4d7d-b604-19edd6ab913d";

const greedRes = () => resourceCard({ name: "GreedRes", resource: { provides: ["greed"], staple: true } as never });
const rageRes = () => resourceCard({ name: "RageRes", resource: { provides: ["rage"], staple: true } as never });

/**
 * Answers every open prompt: "pay?" with `plan.pay`, the discard pick with `plan.rfg`, the character pick with `plan.heal`.
 * Returns how many "pay 1?" prompts and which picks were asked.
 */
function settle(engine: SpoilsEngine, plan: { pay?: boolean; rfg?: CardInstanceId[]; heal?: CardInstanceId[] } = {}): { mayPays: number; picks: string[] } {
  let mayPays = 0;
  const picks: string[] = [];
  for (let guard = 0; guard < 16; guard++) {
    const pc = pending(engine) as unknown as { kind: string; playerId: string; declaration?: { id: string } } | undefined;
    if (!pc) break;
    if (pc.kind === "mayPay") {
      mayPays++;
      answerPending(engine, "mayPay", { pay: plan.pay ?? false });
    } else if (pc.kind === "chooserSelectsTarget") {
      const d = pc.declaration!.id;
      picks.push(d);
      answerPending(engine, "chooserSelectsTarget", { selected: d === "rfg" ? plan.rfg ?? [] : d === "heal" ? plan.heal ?? [] : [] });
    } else if (pc.kind === "orderTriggers") {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc as never) } as never);
      resolvePendingResponses(engine);
    } else {
      throw new Error(`unexpected prompt ${pc.kind}`);
    }
  }
  assert.equal(pending(engine), undefined, "all prompts answered");
  return { mayPays, picks };
}

/** P1 has the Banner in play, a greed resource in hand to develop, two rage resources, and discard piles for both players. */
function baBoard(extra: CardPlacement[] = [], o: { active?: PlayerId; rage?: number; random?: () => number; noDiscard?: boolean } = {}) {
  return duo(
    [
      { key: "ba", def: printing(BA), owner: P1, zone: "play" },
      { key: "gres", def: greedRes(), owner: P1, zone: "hand" },
      ...(o.noDiscard
        ? []
        : [
            { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "discard" as const },
            { key: "d2", def: item({ name: "D2" }), owner: P2, zone: "discard" as const }
          ]),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 2, P1),
      ...extra
    ],
    { active: o.active, random: o.random }
  );
}

clause(BA, "0:provides", "Banner of Avarice is a universal banner item of printed cost 2 and no threshold: deploys for exactly 2 of any resources, refused one short", () => {
  const def = printing(BA);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "universal");
  assert.deepEqual([...(def.subtype ?? [])], ["banner"]);
  assert.equal(def.cost, 2);
  const ok = duo([{ key: "ba", def: printing(BA), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)]);
  play(ok.engine, P1, ok.id("ba"));
  settle(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("ba")), "play");
  const short = duo([{ key: "ba", def: printing(BA), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...spent("rage", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("ba")), "1 ready resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("ba")), "hand");
});

clause(BA, "0:provides", "in play it provides exactly one [G]: a [G] threshold is met by it alone, [G][G] or another icon is not, and it can pay a cost of 1", () => {
  const mk = (threshold: string, cost: number, o: { ba?: "play" | "hand"; owner?: PlayerId } = {}) =>
    duo([
      { key: "ba", def: printing(BA), owner: o.owner ?? P1, zone: o.ba ?? "play" },
      { key: "c", def: character({ name: "C", cost, threshold: threshold as never }), owner: P1, zone: "hand" }
    ]);
  const g = mk("g", 0);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "[G] threshold met by the Banner alone");
  const gg = mk("gg", 0);
  refused(() => play(gg.engine, P1, gg.id("c")), "one [G] is not [G][G]", /threshold/i);
  const d = mk("d", 0);
  refused(() => play(d.engine, P1, d.id("c")), "[G] is not [D]", /threshold/i);
  const inHand = mk("g", 0, { ba: "hand" });
  refused(() => play(inHand.engine, P1, inHand.id("c")), "a Banner in hand provides nothing", /threshold/i);
  const theirs = mk("g", 0, { owner: P2 });
  refused(() => play(theirs.engine, P1, theirs.id("c")), "the opponent's Banner does not provide for me", /threshold/i);
  // CR 311.1: provided icons count towards THRESHOLDS; they are not resources that pay a numeric cost
  const alone = mk("g", 1);
  refused(() => play(alone.engine, P1, alone.id("c")), "the Banner's icon meets the threshold but cannot pay a cost of 1");
  assert.equal(zoneOf(alone.engine, alone.id("c")), "hand");
  const withRage = duo([
    { key: "ba", def: printing(BA), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "C", cost: 1, threshold: "g" as never }), owner: P1, zone: "hand" },
    ...bank("rage", 1, P1)
  ]);
  play(withRage.engine, P1, withRage.id("c"));
  assert.equal(zoneOf(withRage.engine, withRage.id("c")), "play", "a [R] resource pays the cost while the Banner meets the threshold");
  assert.equal(readyResources(withRage.engine, P1), 0);
});

// ---- 1:rule  trigger ----

clause(BA, "1:rule", "a [G] resource entering play under my control triggers exactly one 'pay 1?' prompt; declining pays nothing and removes nothing", () => {
  const { engine, id } = baBoard();
  developResource(engine, P1, id("gres"), false);
  const ready = readyResources(engine, P1);
  const r = settle(engine, { pay: false });
  assert.equal(r.mayPays, 1, "one prompt for one entering card");
  assert.deepEqual(r.picks, [], "declined: no discard pick");
  assert.equal(readyResources(engine, P1), ready, "nothing paid");
  assert.equal(zoneOf(engine, id("d1")), "discard");
  assert.equal(zoneOf(engine, id("d2")), "discard");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
});

clause(BA, "1:rule", "accepting pays exactly 1 resource, then I pick a card in a discard pile (either player's, any type) and it is removed from the game", () => {
  for (const [pick, other] of [["d1", "d2"], ["d2", "d1"]] as const) {
    const { engine, id } = baBoard();
    developResource(engine, P1, id("gres"), false);
    const before = readyResources(engine, P1);
    const r = settle(engine, { pay: true, rfg: [id(pick)], heal: [] });
    assert.equal(r.mayPays, 1);
    assert.deepEqual(r.picks, ["rfg", "heal"]);
    assert.equal(readyResources(engine, P1), before - 1, "exactly 1 paid");
    assert.equal(zoneOf(engine, id(pick)), "removed", "removed from the game");
    assert.equal(zoneOf(engine, id(other)), "discard", "the other pile card is untouched");
    assert.equal(engine.state.players[P1].discard.includes(id(pick)) || engine.state.players[P2].discard.includes(id(pick)), false);
  }
});

clause(BA, "1:rule", "the discard pick must be a card in a discard pile: cards in hands, decks and play are refused", () => {
  const { engine, id } = baBoard([{ key: "deckc", def: character({ name: "DeckC" }), owner: P1, zone: "deck" }, { key: "ohand", def: character({ name: "OHand" }), owner: P2, zone: "hand" }]);
  developResource(engine, P1, id("gres"), false);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal((pending(engine) as unknown as { declaration: { id: string } }).declaration.id, "rfg");
  for (const bad of ["deckc", "ohand", "mine", "theirs", "ba"]) {
    refused(() => pickRaw(engine, [id(bad)]), `${bad} is not in a discard pile`);
    assert.equal((pending(engine) as unknown as { declaration: { id: string } }).declaration.id, "rfg");
  }
  pickRaw(engine, [id("d2")]);
  assert.equal(zoneOf(engine, id("d2")), "removed", "control");
});

clause(BA, "1:rule", "after removing a card I may pick a character in play (mine or an opponent's): it gets +1 life this turn only", () => {
  for (const key of ["mine", "theirs"]) {
    const { engine, id } = baBoard();
    developResource(engine, P1, id("gres"), false);
    settle(engine, { pay: true, rfg: [id("d1")], heal: [id(key)] });
    assert.deepEqual(stat3(engine, id(key)), [2, 4, 2], "+1 life");
    const other = key === "mine" ? "theirs" : "mine";
    assert.deepEqual(stat3(engine, id(other)), [2, 3, 2], "only the picked character");
    endTurn(engine, P1);
    endTurn(engine, P2);
    assert.deepEqual(stat3(engine, id(key)), [2, 3, 2], "the bonus lasted this turn only");
  }
});

clause(BA, "1:rule", "the +1 life is real: a blocker (life 3) with the bonus survives 3 battle damage this turn, without it it dies", () => {
  const run = (heal: boolean) => {
    const b = baBoard([{ key: "atk", def: character({ name: "Atk", strength: 3, life: 9, speed: 2 }), owner: P1, zone: "play" }]);
    developResource(b.engine, P1, b.id("gres"), false);
    settle(b.engine, { pay: true, rfg: [b.id("d1")], heal: heal ? [b.id("theirs")] : [] });
    fight(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("theirs")]);
    return b;
  };
  const healed = run(true);
  assert.equal(zoneOf(healed.engine, healed.id("theirs")), "play", "life 3+1 survives 3 damage");
  assert.equal(healed.engine.state.cards[healed.id("theirs")].damage, 3);
  const plain = run(false);
  assert.equal(zoneOf(plain.engine, plain.id("theirs")), "discard", "control: without the bonus 3 damage kills it");
});

clause(BA, "1:rule", "the character pick is optional ('you may'): picking nothing changes no life; a non-character is refused", () => {
  const { engine, id } = baBoard();
  developResource(engine, P1, id("gres"), false);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("d1")] });
  assert.equal((pending(engine) as unknown as { declaration: { id: string } }).declaration.id, "heal");
  refused(() => pickRaw(engine, [id("ba")]), "the Banner is an item, not a character");
  refused(() => pickRaw(engine, [id("d2")]), "a removed/discarded card is not a character in play");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  assert.deepEqual(stat3(engine, id("mine")), [2, 3, 2]);
  assert.deepEqual(stat3(engine, id("theirs")), [2, 3, 2]);
});

clause(BA, "1:rule", "'if you do' chains: with both discard piles empty the payment is still made but no character pick is offered and no life changes", () => {
  const { engine, id } = baBoard([], { noDiscard: true });
  developResource(engine, P1, id("gres"), false);
  const before = readyResources(engine, P1);
  const r = settle(engine, { pay: true });
  assert.equal(r.mayPays, 1);
  assert.ok(!r.picks.includes("heal"), "no character pick without a removed card");
  assert.equal(readyResources(engine, P1), before - 1);
  assert.deepEqual(stat3(engine, id("mine")), [2, 3, 2]);
});

clause(BA, "1:rule", "a non-[G] resource, a face-down resource and an opponent's [G] resource do not trigger it", () => {
  const rageHand = baBoard([{ key: "rres", def: rageRes(), owner: P1, zone: "hand" }]);
  developResource(rageHand.engine, P1, rageHand.id("rres"), false);
  assert.equal(pending(rageHand.engine), undefined, "a [R] resource does not trigger it");

  const down = baBoard();
  developResource(down.engine, P1, down.id("gres"), true);
  assert.equal(pending(down.engine), undefined, "face-down it provides Volition, not [G]");

  const theirs = baBoard([{ key: "ogres", def: greedRes(), owner: P2, zone: "hand" }], { active: P2 });
  developResource(theirs.engine, P2, theirs.id("ogres"), false);
  assert.equal(pending(theirs.engine), undefined, "enters under the opponent's control");

  const mine = baBoard();
  developResource(mine.engine, P1, mine.id("gres"), false);
  assert.equal(pending(mine.engine)?.kind, "mayPay", "control: my own [G] resource triggers it");
});

clause(BA, "1:rule", "'at least [G]': a resource providing [G]+[R] or [G][G] triggers once; one providing only another icon does not", () => {
  const two = baBoard([{ key: "gr", def: resourceCard({ name: "GR", resource: { provides: ["greed", "rage"], staple: true } as never }), owner: P1, zone: "hand" }]);
  developResource(two.engine, P1, two.id("gr"), false);
  assert.equal(settle(two.engine).mayPays, 1, "[G][R] provides at least [G]");
  const gg = baBoard([{ key: "gg", def: resourceCard({ name: "GG", resource: { provides: ["greed", "greed"], staple: true } as never }), owner: P1, zone: "hand" }]);
  developResource(gg.engine, P1, gg.id("gg"), false);
  assert.equal(settle(gg.engine).mayPays, 1, "[G][G] provides at least [G]");
  const d = baBoard([{ key: "dd", def: resourceCard({ name: "DD", resource: { provides: ["deception"], staple: true } as never }), owner: P1, zone: "hand" }]);
  developResource(d.engine, P1, d.id("dd"), false);
  assert.equal(pending(d.engine), undefined);
});

clause(BA, "1:rule", "'a card that provides': a non-resource card (an item with PROVIDES [G]) entering play under my control triggers it too, once; one providing nothing does not", () => {
  const withG = baBoard([{ key: "gi", def: item({ name: "GI", cost: 0, resource: { provides: ["greed"] } as never }), owner: P1, zone: "hand" }]);
  play(withG.engine, P1, withG.id("gi"));
  assert.equal(settle(withG.engine).mayPays, 1, "an item providing [G] triggers once");
  const plain = baBoard([{ key: "pi", def: item({ name: "PI", cost: 0 }), owner: P1, zone: "hand" }]);
  play(plain.engine, P1, plain.id("pi"));
  assert.equal(pending(plain.engine), undefined, "control: an item providing nothing does not");
  const theirs = baBoard([{ key: "gi", def: item({ name: "GI", cost: 0, resource: { provides: ["greed"] } as never }), owner: P2, zone: "hand" }], { active: P2 });
  play(theirs.engine, P2, theirs.id("gi"));
  assert.equal(pending(theirs.engine), undefined, "an opponent's [G] item does not trigger my Banner");
});

clause(BA, "1:rule", "with no resource able to pay (the entering [G] item can't pay: provided icons are not resources) the optional payment can't be made and nothing is removed", () => {
  const { engine, id } = baBoard([{ key: "gi", def: item({ name: "GI", cost: 0, resource: { provides: ["greed"] } as never }), owner: P1, zone: "hand" }], { rage: 0 });
  assert.equal(readyResources(engine, P1), 0);
  play(engine, P1, id("gi"));
  assert.equal(pending(engine), undefined, "the trigger offers no payment when 1 can't be paid");
  assert.equal(zoneOf(engine, id("d1")), "discard");
  assert.equal(zoneOf(engine, id("d2")), "discard");
});

clause(BA, "1:rule", "a [G] item entering play: the payment is exactly 1 (one ready resource is enough, and exactly 1 is spent)", () => {
  const { engine, id } = baBoard([{ key: "gi", def: item({ name: "GI", cost: 0, resource: { provides: ["greed"] } as never }), owner: P1, zone: "hand" }], { rage: 1 });
  assert.equal(readyResources(engine, P1), 1);
  play(engine, P1, id("gi"));
  const pc = pending(engine) as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "mayPay", "with 1 ready resource the payment of 1 is offered");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(readyResources(engine, P1), 0, "exactly 1 was paid");
});

clause(BA, "1:rule", "the Banner itself provides [G]: a second Banner of Avarice entering play triggers the first one (once)", () => {
  const { engine, id } = baBoard([{ key: "ba2", def: printing(BA), owner: P1, zone: "hand" }], { rage: 4 });
  play(engine, P1, id("ba2"));
  const r = settle(engine, { pay: false });
  assert.ok(r.mayPays >= 1, "the first Banner sees the second one enter");
});

clause(BA, "1:rule", "two Banners each trigger once for one entering [G] card, and each removes its own picked card", () => {
  const { engine, id } = baBoard([{ key: "ba2", def: printing(BA), owner: P1, zone: "play" }, { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "discard" }], { rage: 4 });
  developResource(engine, P1, id("gres"), false);
  const before = readyResources(engine, P1);
  const removed: CardInstanceId[] = [];
  let mayPays = 0;
  for (let guard = 0; guard < 20 && pending(engine); guard++) {
    const pc = pending(engine) as unknown as { kind: string; playerId: string; declaration?: { id: string } };
    if (pc.kind === "mayPay") {
      mayPays++;
      answerPending(engine, "mayPay", { pay: true });
    } else if (pc.kind === "chooserSelectsTarget" && pc.declaration!.id === "rfg") {
      const pile = [...engine.state.players[P1].discard, ...engine.state.players[P2].discard];
      const target = pile.find((c) => !removed.includes(c))!;
      removed.push(target);
      answerPending(engine, "chooserSelectsTarget", { selected: [target] });
    } else if (pc.kind === "chooserSelectsTarget") {
      answerPending(engine, "chooserSelectsTarget", { selected: [] });
    } else {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc as never) } as never);
      resolvePendingResponses(engine);
    }
  }
  assert.equal(mayPays, 2, "one prompt per Banner");
  assert.equal(removed.length, 2);
  assert.equal(readyResources(engine, P1), before - 2, "1 paid per Banner");
  for (const c of removed) assert.equal(zoneOf(engine, c), "removed");
});

// ---- 2:ability:burn ----

/** The Banner plus `ready` other ready rage resources (and optionally a depleted Banner), a deck to draw from. */
function burnBoard(o: { ready?: number; baDepleted?: boolean; deck?: number } = {}) {
  return duo([
    { key: "ba", def: printing(BA), owner: P1, zone: "play", depleted: o.baDepleted },
    ...bank("rage", o.ready ?? 2, P1),
    ...fillers("pd", o.deck ?? 6, P1, "deck"),
    ...fillers("od", 6, P2, "deck")
  ]);
}

clause(BA, "2:ability:burn", "BURN IT: pays 2, destroys the Banner and draws exactly 2 cards (the top two of my deck); the opponent draws nothing", () => {
  const { engine, id } = burnBoard({ ready: 2, baDepleted: true });
  const top2 = deckOf(engine, P1).slice(0, 2);
  const oppDeck = [...deckOf(engine, P2)];
  activate(engine, P1, id("ba"), "burn");
  assert.equal(pending(engine), undefined);
  assert.equal(readyResources(engine, P1), 0, "2 paid");
  assert.equal(zoneOf(engine, id("ba")), "discard", "destroyed as a cost");
  assert.deepEqual(handOf(engine, P1), top2, "drew the top two cards");
  assert.equal(deckOf(engine, P1).length, 4);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BA, "2:ability:burn", "refused one resource short of the cost 2 (a spent one does not count), and the Banner stays", () => {
  const short = burnBoard({ ready: 1, baDepleted: true });
  refused(() => activate(short.engine, P1, short.id("ba"), "burn"), "1 ready resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("ba")), "play");
  assert.equal(handOf(short.engine, P1).length, 0);
  assert.equal(readyResources(short.engine, P1), 1);
  const spentShort = duo([{ key: "ba", def: printing(BA), owner: P1, zone: "play", depleted: true }, ...bank("rage", 1, P1), ...spent("rage", 3, P1), ...fillers("pd", 4, P1, "deck")]);
  refused(() => activate(spentShort.engine, P1, spentShort.id("ba"), "burn"), "spent resources can't pay");
  assert.equal(zoneOf(spentShort.engine, spentShort.id("ba")), "play");
  const lone = burnBoard({ ready: 0 });
  refused(() => activate(lone.engine, P1, lone.id("ba"), "burn"), "the Banner alone is one resource for a cost of 2");
  assert.equal(zoneOf(lone.engine, lone.id("ba")), "play");
});

clause(BA, "2:ability:burn", "with a ready (not depleted) Banner and three resources it works; exactly 2 are paid (not 3), and the Banner's own icon is not a resource that can pay", () => {
  const { engine, id } = burnBoard({ ready: 3 });
  assert.equal(readyResources(engine, P1), 3, "three ready resource cards besides the Banner");
  activate(engine, P1, id("ba"), "burn");
  assert.equal(zoneOf(engine, id("ba")), "discard");
  assert.equal(readyResources(engine, P1), 1, "exactly 2 of the 3 were paid");
  assert.equal(handOf(engine, P1).length, 2);
});

clause(BA, "2:ability:burn", "only the Banner's controller can use it, and not from the hand", () => {
  const { engine, id } = burnBoard({ ready: 2, baDepleted: true });
  refused(() => activate(engine, P2, id("ba"), "burn"), "the opponent can't use it");
  assert.equal(zoneOf(engine, id("ba")), "play");
  const inHand = duo([{ key: "ba", def: printing(BA), owner: P1, zone: "hand" }, ...bank("rage", 4, P1), ...fillers("pd", 4, P1, "deck")]);
  refused(() => activate(inHand.engine, P1, inHand.id("ba"), "burn"), "a Banner in hand has no active ability");
  assert.equal(handOf(inHand.engine, P1).length, 1);
});

clause(WB, "0:unique", "UNIQUE WAYLAY BLADE is the designation: a different card carrying the UNIQUE WAYLAY BLADE designation is a duplicate too", () => {
  const b = duo([
    { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
    { key: "imp", def: item({ name: "Impostor", unique: "waylay blade", cost: 0 }), owner: P1, zone: "play" },
    { key: "u2", def: printing(WB), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1)
  ]);
  play(b.engine, P1, b.id("u2"), { selected: { attachTo: [b.id("host")] } });
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [b.id("imp"), b.id("u2")].sort());
});

clause(WLP, "1:rule", "the search for 'a card' must find one when the opponent's deck has cards: an empty pick is refused (the pick stays open)", () => {
  const b = wlpBoard();
  play(b.engine, P1, b.id("t"));
  assert.equal(openDecl(b.engine), "theirs");
  refused(() => pickRaw(b.engine, []), "finding nothing is not allowed when the deck has cards");
  assert.equal(openDecl(b.engine), "theirs");
  refused(() => pickRaw(b.engine, [b.id("o1"), b.id("o4")]), "only one card");
  assert.equal(openDecl(b.engine), "theirs");
});

clause(WLP, "2:rule", "'a character': exactly one (not two) is found from my deck", () => {
  const b = wlpBoard();
  play(b.engine, P1, b.id("t"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1")] });
  assert.equal(openDecl(b.engine), "mine");
  refused(() => pickRaw(b.engine, [b.id("m1"), b.id("m3")]), "two characters are too many");
  assert.equal(openDecl(b.engine), "mine");
  assert.equal(zoneOf(b.engine, b.id("m1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("m3")), "deck");
});

clause(BA, "2:ability:burn", "does not need the Banner to be ready: a depleted Banner can still be burned (there is no deplete cost)", () => {
  const { engine, id } = burnBoard({ ready: 2, baDepleted: true });
  assert.equal(engine.state.cards[id("ba")].depleted, true);
  activate(engine, P1, id("ba"), "burn");
  assert.equal(zoneOf(engine, id("ba")), "discard");
  assert.equal(handOf(engine, P1).length, 2);
});


// ---- T3c7 behavior-mutation pass ----

clause(WLP, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: WLP, type: "tactic", subtype: [] });
});

clause(WLP, "1:rule", "both searches are made by the tactic's controller: each pick prompt belongs to me, never to the opponent", () => {
  const b = wlpBoard();
  const { engine, id } = b;
  play(engine, P1, id("t"));
  assert.equal(openDecl(engine), "theirs", "first the search of the other player's deck");
  assert.equal((pending(engine) as unknown as { playerId: PlayerId }).playerId, P1, "I search the opponent's deck");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("o1")] });
  assert.equal(openDecl(engine), "mine", "then the search of my own deck");
  assert.equal((pending(engine) as unknown as { playerId: PlayerId }).playerId, P1, "I search my own deck");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("m1")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("o1")), "play", "the opponent's card was put into play");
  assert.equal(zoneOf(engine, id("m1")), "play", "my character was put into play");
});

clause(WB, "3:ability:equip", "the host pick is required: EQUIP with nobody picked is refused, nothing is paid and the Blade stays unattached", () => {
  const { engine, id } = wbBoard([...bank("rage", 3, P1)], { attached: false });
  const before = readyResources(engine, P1);
  refused(() => activate(engine, P1, id("wb"), "equip", { selected: { host: [] } }), "no character picked");
  assert.equal(readyResources(engine, P1), before, "nothing was paid");
  assert.equal(engine.state.cards[id("wb")].attachedTo, undefined, "still unattached");
  equip(engine, id, "host");
  assert.equal(engine.state.cards[id("wb")].attachedTo, id("host"), "control: with a host picked it attaches");
});
