// Clause tests: seed-saga-14 part p1 (groups 1-4, missing clauses).
// Vorpal Sword, Watchtower, Defenders of Marduun, Legions of Chaos (Seed Saga).

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../per-card/_harness.js";
import { clause, drain, printing, refused, holdResourceFace } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, spentResources, developOffers, endTurnRaw } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

type Player = typeof P1 | typeof P2;

const SWORD = "2bcf9af1-212c-4b0b-84d9-1f0e9d2e79e5"; // item gear warlord cost 4 [R][R]
const TOWER = "59b277a8-0b23-4bc6-8325-eca973a06a2e"; // location warlord cost 1 [R] structure 4
const DEFENDERS = "127ff677-bc48-408c-bd7e-0772aac3e0f7";
const LEGIONS = "d1e103cf-9aed-466c-abdf-f856469e5ffa";
const RAGE = "fe913bf8-b4eb-411a-a8b8-dcaf0095c90e";
const GREED = "1b675619-bee8-41ed-8562-d4d9c763ad05";
const DECEPTION = "e93094ca-311a-4302-bdc5-798905a0f809";
const ELITISM = "5a5250c1-a651-43e4-ac75-f2403860446d";
const OBSESSION = "dab6e897-b5be-4760-95c0-20c2795a9ae3";

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const influence = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const spentOf = (icon: "rage" | "greed", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const trade = (t: string) => ({ trade: t as never });

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const reveals = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

// =============================================================================
// Vorpal Sword
// ATTACH TO CHARACTER. The attached character gains 2 strength and 1 life.
// If this card would be destroyed, flip it face-down under its owner's control instead.
// SNICKER SNACK -- COST: Use this only while this card is a face-down resource. Reveal this card.
//   Pay 3. Discard a card. Pick a character. EFFECT: Inflict 2 damage to the character.
//   Inflict 1 damage to your faction.
// =============================================================================

const KILL_ITEM = tactic({
  name: "Smash",
  cost: 0,
  behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
const KILL_CHAR = tactic({
  name: "Slay",
  cost: 0,
  behavior: { abilities: [{ id: "slay", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});

interface SwordOpts {
  zone?: "hand" | "play" | "discard";
  faceDown?: boolean;
  attachedTo?: string;
  controller?: PlayerId;
  rage?: number;
  greed?: number;
  spentRage?: number;
  hand?: number;
  noChars?: boolean;
}
function swordBoard(o: SwordOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      {
        key: "sw",
        def: printing(SWORD),
        owner: P1,
        zone: o.zone ?? "hand",
        faceDown: o.faceDown,
        ...(o.controller ? { controller: o.controller } : {}),
        ...(o.attachedTo ? { attachedToKey: o.attachedTo } : {})
      },
      ...(o.noChars
        ? []
        : ([
            { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2, ...trade("rogue") }), owner: P1, zone: "play" },
            { key: "b", def: character({ name: "Bravo", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
            { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
            { key: "frail", def: character({ name: "Frail", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }
          ] as CardPlacement[])),
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" },
      { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
      ...Array.from({ length: o.hand ?? 0 }, (_, i) => ({ key: `h${i + 1}`, def: character({ name: `Hand ${i + 1}` }), owner: P1, zone: "hand" as const })),
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentOf("rage", o.spentRage ?? 0)
    ]
  });
}
type SwordBoard = ReturnType<typeof swordBoard>;
const sstr = (b: SwordBoard, k: string): number => b.engine.getStat(b.id(k), "strength");
const slife = (b: SwordBoard, k: string): number => b.engine.getStat(b.id(k), "life");
const equipTo = (b: SwordBoard, host: string | undefined) => play(b.engine, P1, b.id("sw"), { selected: host === undefined ? {} : { attachTo: [b.id(host)] } });
const hostOf = (b: SwordBoard) => b.engine.state.cards[b.id("sw")].attachedTo;
const smash = (b: SwordBoard, target = "sw") => play(b.engine, P1, b.id("smash"), { selected: { t: [b.id(target)] } });
const snack = (b: SwordBoard, victim: string, discard = "h1", player: PlayerId = P1) =>
  activate(b.engine, player, b.id("sw"), "snicker-snack", { selected: { victim: [b.id(victim)], snickDisc: [b.id(discard)] } });
const downBoard = (o: SwordOpts = {}) => swordBoard({ zone: "play", faceDown: true, greed: 3, hand: 2, ...o });

clause(SWORD, "0:attach", "printed card: a warlord gear item, cost 4, threshold [R][R]", () => {
  const b = swordBoard({ rage: 2, greed: 2 });
  const def = b.engine.getDefinition(b.id("sw"));
  assert.equal(def.type, "item");
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "rr");
  assert.deepEqual(def.subtype, ["gear"]);
  assert.equal(def.trade, "warlord");
  assert.equal((def as unknown as { attachTo?: string }).attachTo, "character");
});

clause(SWORD, "0:attach", "deploys attached to the picked character for exactly 4 with [R][R]", () => {
  const b = swordBoard({ rage: 2, greed: 2 });
  assert.equal(ready(b.engine), 4);
  equipTo(b, "a");
  assert.equal(zoneOf(b.engine, b.id("sw")), "play");
  assert.equal(hostOf(b), b.id("a"), "attached to the picked character");
  assert.equal(ready(b.engine), 0, "exactly 4 paid");
  assert.equal(attachedCount(b.engine, P1), 4);
});

clause(SWORD, "0:attach", "the cost is 4, not 3: one resource short (threshold met) is refused, with a positive control of exactly 4", () => {
  const short = swordBoard({ rage: 2, greed: 1 });
  refused(() => equipTo(short, "a"), "3 ready resources with [R][R]");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
  assert.equal(ready(short.engine), 3, "nothing was paid");
  const ok = swordBoard({ rage: 2, greed: 2 });
  equipTo(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("sw")), "play");
});

clause(SWORD, "0:attach", "the cost is not 5: a spare resource stays unspent after deploying for 4", () => {
  const b = swordBoard({ rage: 2, greed: 3 });
  equipTo(b, "a");
  assert.equal(ready(b.engine), 1);
});

clause(SWORD, "0:attach", "threshold [R][R]: one [R] short (4 ready resources: 1 Rage + 3 Greed) is refused, two Rage and two other is accepted", () => {
  const short = swordBoard({ rage: 1, greed: 3 });
  assert.equal(ready(short.engine), 4);
  refused(() => equipTo(short, "a"), "only one [R]");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
  const none = swordBoard({ greed: 4 });
  refused(() => equipTo(none, "a"), "no [R]");
  const ok = swordBoard({ rage: 2, greed: 2 });
  equipTo(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("sw")), "play");
});

clause(SWORD, "0:attach", "spent [R][R] still meet the threshold, but cannot pay: 2 spent Rage + 4 ready Greed deploys, 2 spent Rage + 3 ready is refused", () => {
  const ok = swordBoard({ spentRage: 2, greed: 4 });
  equipTo(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("sw")), "play");
  assert.equal(ready(ok.engine), 0);
  const short = swordBoard({ spentRage: 2, greed: 3 });
  refused(() => equipTo(short, "a"), "only 3 ready to pay 4");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
});

clause(SWORD, "0:attach", "ATTACH TO CHARACTER: any character (mine or an opponent's) is a legal host; an item, a location, and a faction are refused", () => {
  const mine = swordBoard({ rage: 2, greed: 2 });
  equipTo(mine, "b");
  assert.equal(hostOf(mine), mine.id("b"));
  const theirs = swordBoard({ rage: 2, greed: 2 });
  equipTo(theirs, "foe");
  assert.equal(hostOf(theirs), theirs.id("foe"), "an opponent's character is a legal host");
  for (const [key, why] of [["gear", "an item"], ["place", "a location"]] as const) {
    const b = swordBoard({ rage: 2, greed: 2 });
    refused(() => equipTo(b, key), why);
    assert.equal(zoneOf(b.engine, b.id("sw")), "hand");
    assert.equal(ready(b.engine), 4, "nothing was paid");
  }
  const f = swordBoard({ rage: 2, greed: 2 });
  refused(() => play(f.engine, P1, f.id("sw"), { selected: { attachTo: [factionOf(f.engine, P1)] } }), "my own faction");
  refused(() => play(f.engine, P1, f.id("sw"), { selected: { attachTo: [factionOf(f.engine, P2)] } }), "the opponent's faction");
  assert.equal(zoneOf(f.engine, f.id("sw")), "hand");
  refused(() => equipTo(f, undefined), "no host picked");
});

clause(SWORD, "0:attach", "it cannot be deployed with no character in play to attach to", () => {
  const b = swordBoard({ rage: 2, greed: 2, noChars: true });
  refused(() => equipTo(b, undefined), "no characters in play");
  assert.equal(zoneOf(b.engine, b.id("sw")), "hand");
  assert.equal(ready(b.engine), 4);
});

clause(SWORD, "1:rule", "the attached character gains exactly 2 strength and 1 life (speed unchanged); other characters are unchanged", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a" });
  assert.deepEqual([sstr(b, "a"), slife(b, "a"), b.engine.getStat(b.id("a"), "speed")], [4, 5, 2]);
  assert.deepEqual([sstr(b, "b"), slife(b, "b")], [3, 4], "another of my characters is unchanged");
  assert.deepEqual([sstr(b, "foe"), slife(b, "foe")], [1, 4], "an opponent's character is unchanged");
});

clause(SWORD, "1:rule", "before it is deployed the character has its printed stats, and deploying raises them", () => {
  const b = swordBoard({ rage: 2, greed: 2 });
  assert.deepEqual([sstr(b, "a"), slife(b, "a")], [2, 4]);
  equipTo(b, "a");
  assert.deepEqual([sstr(b, "a"), slife(b, "a")], [4, 5]);
});

clause(SWORD, "1:rule", "on an opponent's character it buffs that character (the host), not the sword's controller's", () => {
  const b = swordBoard({ zone: "play", attachedTo: "foe" });
  assert.deepEqual([sstr(b, "foe"), slife(b, "foe")], [3, 5]);
  assert.deepEqual([sstr(b, "a"), slife(b, "a")], [2, 4]);
});

clause(SWORD, "1:rule", "two Vorpal Swords on one host stack: +4 strength and +2 life", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a", rage: 2, greed: 2 });
  assert.deepEqual([sstr(b, "a"), slife(b, "a")], [4, 5]);
  const second = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "s1", def: printing(SWORD), owner: P1, zone: "play", attachedToKey: "a" },
      { key: "s2", def: printing(SWORD), owner: P1, zone: "play", attachedToKey: "a" },
      { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual([second.engine.getStat(second.id("a"), "strength"), second.engine.getStat(second.id("a"), "life")], [6, 6]);
});

clause(SWORD, "1:rule", "the buff is gone when the sword leaves play (replaced by flipping face-down), and the extra life is real while attached", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a" });
  b.engine.state.cards[b.id("a")].damage = 4;
  assert.equal(slife(b, "a"), 5);
  assert.equal(zoneOf(b.engine, b.id("a")), "play", "4 damage on 5 life survives");
  b.engine.state.cards[b.id("a")].damage = 0;
  smash(b);
  assert.deepEqual([sstr(b, "a"), slife(b, "a")], [2, 4], "no longer buffed");
});

clause(SWORD, "2:rule", "if the Sword would be destroyed it is flipped face-down in play instead (not in the discard pile)", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a" });
  smash(b);
  assert.equal(pending(b.engine), undefined);
  const c = b.engine.state.cards[b.id("sw")];
  assert.equal(c.zone, "play", "still in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("sw")), "not in the discard pile");
  assert.notEqual(hostOf(b), b.id("a"), "no longer attached to the host");
  assert.equal(zoneOf(b.engine, b.id("smash")), "discard", "the destroying tactic resolved");
});

clause(SWORD, "2:rule", "the face-down Sword is a resource under its owner's control", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a", greed: 1 });
  assert.equal(ready(b.engine), 1);
  smash(b);
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("sw")].controllerId, P1);
  assert.equal(ready(b.engine), 2, "a face-down card counts as a resource");
  assert.equal(b.engine.getThresholds(P1).volition, 1);
});

clause(SWORD, "2:rule", "under its OWNER's control: a Sword I own but an opponent controls comes back face-down under my control", () => {
  const b = swordBoard({ zone: "play", attachedTo: "foe", controller: P2 });
  assert.equal(b.engine.state.cards[b.id("sw")].controllerId, P2, "setup: P2 controls it");
  smash(b);
  const c = b.engine.state.cards[b.id("sw")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1, "under its owner's control");
  assert.equal(ready(b.engine, P2), 0, "not one of the opponent's resources");
  assert.deepEqual([sstr(b, "foe"), slife(b, "foe")], [1, 4], "the host lost the buff");
});

clause(SWORD, "2:rule", "only the Sword's own destruction is replaced: when its HOST is destroyed the Sword is destroyed with it (CR 301.4a) and its own replacement flips it face-down (CR 301.4b)", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a" });
  play(b.engine, P1, b.id("slay"), { selected: { t: [b.id("a")] } });
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "the host died");
  assert.equal(zoneOf(b.engine, b.id("sw")), "play", "destroyed with its host, so its own replacement applies");
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown, true, "flipped face-down instead");
});

clause(SWORD, "2:rule", "destroying a different item leaves the Sword alone, and that item goes to the discard pile as usual", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a" });
  smash(b, "gear");
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard");
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown ?? false, false);
  assert.equal(hostOf(b), b.id("a"));
});

clause(SWORD, "2:rule", "the replacement applies to a Sword on an opponent's character as well (the opponent's host is not destroyed)", () => {
  const b = swordBoard({ zone: "play", attachedTo: "foe" });
  smash(b);
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

// --- SNICKER SNACK

clause(SWORD, "3:ability:snicker-snack", "from a face-down resource: pays 3, reveals itself, discards the chosen card, deals 2 to the character and 1 to my faction", () => {
  const b = downBoard({ greed: 4 });
  const infMe = influence(b.engine, P1);
  const infOpp = influence(b.engine, P2);
  snack(b, "foe", "h2");
  assert.equal(pending(b.engine), undefined);
  assert.equal(damageOn(b.engine, b.id("foe")), 2, "exactly 2 damage to the picked character");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "4 life survives 2 damage");
  assert.equal(influence(b.engine, P1), infMe - 1, "exactly 1 damage to MY faction");
  assert.equal(influence(b.engine, P2), infOpp, "the opponent's faction is untouched");
  assert.equal(zoneOf(b.engine, b.id("h2")), "discard", "the chosen card was discarded");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand", "the other hand card stays");
  assert.equal(ready(b.engine), 2, "4 Greed + the Sword = 5 resources, 3 paid");
  assert.equal(attachedCount(b.engine, P1), 3);
  assert.equal(damageOn(b.engine, b.id("a")), 0, "no other character is damaged");
});

clause(SWORD, "3:ability:snicker-snack", "'Reveal this card': the Sword is revealed to everyone as part of the cost, and stays a face-down resource in play", () => {
  const b = downBoard();
  const before = reveals(b.engine).length;
  snack(b, "foe");
  const shown = reveals(b.engine).slice(before).filter((e) => (e.event as unknown as { cardIds: string[] }).cardIds.includes(b.id("sw")));
  assert.ok(shown.length >= 1, "a reveal event names the Sword");
  assert.equal((shown[0].event as unknown as { viewerId: string }).viewerId, "all", "revealed to all players");
  assert.equal(zoneOf(b.engine, b.id("sw")), "play");
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown, true, "revealing does not flip it");
});

clause(SWORD, "3:ability:snicker-snack", "'Pick a character': my own character or the opponent's can be picked (the faction still takes 1)", () => {
  const mine = downBoard();
  const infMe = influence(mine.engine, P1);
  snack(mine, "a");
  assert.equal(damageOn(mine.engine, mine.id("a")), 2);
  assert.equal(influence(mine.engine, P1), infMe - 1);
  const theirs = downBoard();
  snack(theirs, "foe");
  assert.equal(damageOn(theirs.engine, theirs.id("foe")), 2);
});

clause(SWORD, "3:ability:snicker-snack", "the damage can destroy: a 2-life character dies, a 4-life one survives with 2 damage", () => {
  const b = downBoard({ greed: 6 });
  snack(b, "frail", "h1");
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "2 damage kills a 2-life character");
  snack(b, "foe", "h2");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(damageOn(b.engine, b.id("foe")), 2);
});

clause(SWORD, "3:ability:snicker-snack", "the picked card must be a character: an item, a location and a faction are refused", () => {
  for (const [key, why] of [["gear", "an item"], ["place", "a location"]] as const) {
    const b = downBoard();
    refused(() => snack(b, key), why);
    assert.equal(ready(b.engine), 4, "nothing was paid");
    assert.equal(zoneOf(b.engine, b.id("h1")), "hand", "nothing was discarded");
  }
  const f = downBoard();
  refused(() => activate(f.engine, P1, f.id("sw"), "snicker-snack", { selected: { victim: [factionOf(f.engine, P2)], snickDisc: [f.id("h1")] } }), "a faction");
  refused(() => activate(f.engine, P1, f.id("sw"), "snicker-snack", { selected: { snickDisc: [f.id("h1")] } }), "no character picked");
  assert.equal(influence(f.engine, P1), influence(buildGame({ playerA: { faction: developFaction() } }).engine, P1), "no damage dealt");
  snack(f, "a"); // control
  assert.equal(damageOn(f.engine, f.id("a")), 2);
});

clause(SWORD, "3:ability:snicker-snack", "Pay 3: exactly 3 other resources works, a total of 2 resources (Sword + 1) is refused with nothing paid", () => {
  const short = downBoard({ greed: 1 });
  assert.equal(ready(short.engine), 2);
  refused(() => snack(short, "foe"), "two resources, one of them the Sword");
  assert.equal(zoneOf(short.engine, short.id("h1")), "hand", "nothing discarded");
  assert.equal(damageOn(short.engine, short.id("foe")), 0);
  assert.equal(attachedCount(short.engine, P1), 0);
  const exact = downBoard({ greed: 3 });
  snack(exact, "foe");
  assert.equal(damageOn(exact.engine, exact.id("foe")), 2);
  assert.equal(attachedCount(exact.engine, P1), 3);
});

clause(SWORD, "3:ability:snicker-snack", "Pay 3: spent resources do not count (3 spent + 1 ready + the Sword is only 2 available)", () => {
  const b = downBoard({ greed: 1, spentRage: 3 });
  refused(() => snack(b, "foe"), "3 spent resources cannot pay");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
});

clause(SWORD, "3:ability:snicker-snack", "Discard a card: refused with an empty hand (nothing paid), and the discarded card must come from my hand", () => {
  const none = downBoard({ hand: 0 });
  refused(() => activate(none.engine, P1, none.id("sw"), "snicker-snack", { selected: { victim: [none.id("foe")] } }), "empty hand");
  assert.equal(damageOn(none.engine, none.id("foe")), 0);
  assert.equal(attachedCount(none.engine, P1), 0);
  const b = downBoard({ hand: 1 });
  refused(() => snack(b, "foe", "theirHand"), "the opponent's hand card");
  refused(() => snack(b, "foe", "gear"), "a card in play");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing was paid by the refused attempts");
  snack(b, "foe", "h1"); // control
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirHand")), "hand");
});

clause(SWORD, "3:ability:snicker-snack", "any card in hand may be the discard (a different one each time)", () => {
  for (const k of ["h1", "h2"]) {
    const b = downBoard();
    snack(b, "foe", k);
    assert.equal(zoneOf(b.engine, b.id(k)), "discard");
    assert.equal(zoneOf(b.engine, b.id(k === "h1" ? "h2" : "h1")), "hand");
  }
});

clause(SWORD, "3:ability:snicker-snack", "'Use this only while this card is a face-down resource': refused from hand, face-up in play (attached), and from the discard pile; allowed face-down", () => {
  const inHand = swordBoard({ zone: "hand", greed: 3, hand: 2 });
  refused(() => snack(inHand, "foe"), "in hand");
  const faceUp = swordBoard({ zone: "play", attachedTo: "a", greed: 3, hand: 2 });
  refused(() => snack(faceUp, "foe"), "face-up attached to a character");
  assert.equal(damageOn(faceUp.engine, faceUp.id("foe")), 0);
  assert.equal(ready(faceUp.engine), 3);
  const discarded = swordBoard({ zone: "discard", greed: 3, hand: 2 });
  refused(() => snack(discarded, "foe"), "in the discard pile");
  const ok = downBoard();
  snack(ok, "foe"); // control
  assert.equal(damageOn(ok.engine, ok.id("foe")), 2);
});

clause(SWORD, "3:ability:snicker-snack", "works for a Sword that was flipped face-down by its own replacement effect", () => {
  const b = swordBoard({ zone: "play", attachedTo: "a", greed: 3, hand: 2 });
  smash(b);
  assert.equal(b.engine.state.cards[b.id("sw")].faceDown, true);
  snack(b, "foe");
  assert.equal(damageOn(b.engine, b.id("foe")), 2);
});

clause(SWORD, "3:ability:snicker-snack", "only its controller may use it (the opponent cannot activate my face-down Sword)", () => {
  const b = downBoard();
  refused(() => snack(b, "a", "h1", P2), "the opponent activating it");
  assert.equal(damageOn(b.engine, b.id("a")), 0);
  assert.equal(attachedCount(b.engine, P1), 0);
});

clause(SWORD, "3:ability:snicker-snack", "no once-per-turn limit: it can be used twice in a turn, 2 damage and 1 faction damage each time", () => {
  const b = downBoard({ greed: 6 });
  const inf = influence(b.engine, P1);
  snack(b, "foe", "h1");
  snack(b, "foe", "h2");
  assert.equal(damageOn(b.engine, b.id("foe")) + (zoneOf(b.engine, b.id("foe")) === "discard" ? 4 : 0), 4);
  assert.equal(influence(b.engine, P1), inf - 2);
  assert.equal(attachedCount(b.engine, P1), 6);
});

clause(SWORD, "3:ability:snicker-snack", "the Sword is not depleted or consumed by using it: it stays in play", () => {
  const b = downBoard();
  snack(b, "foe");
  assert.equal(b.engine.state.cards[b.id("sw")].depleted ?? false, false);
  assert.equal(zoneOf(b.engine, b.id("sw")), "play");
});

// =============================================================================
// Watchtower
// UNIQUE WATCHTOWER. When a character enters play under an opponent's control, inflict 1 damage to it.
// =============================================================================

interface TowerOpts {
  towerZone?: "hand" | "play";
  towerController?: PlayerId;
  active?: Player;
  extra?: CardPlacement[];
}
function towerBoard(o: TowerOpts = {}) {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [
      { key: "wt", def: printing(TOWER), owner: P1, zone: o.towerZone ?? "play", ...(o.towerController ? { controller: o.towerController } : {}) },
      { key: "theirChar", def: character({ name: "Their Char", strength: 1, life: 3, speed: 1, cost: 1 }), owner: P2, zone: "hand" },
      { key: "theirOne", def: character({ name: "Their One-Life", strength: 1, life: 1, speed: 1, cost: 1 }), owner: P2, zone: "hand" },
      { key: "theirItem", def: item({ name: "Their Item", cost: 1 }), owner: P2, zone: "hand" },
      { key: "theirLoc", def: location({ name: "Their Place", cost: 1 }), owner: P2, zone: "hand" },
      { key: "myChar", def: character({ name: "My Char", strength: 1, life: 3, speed: 1, cost: 1 }), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1),
      ...bank("greed", 4, P2),
      ...(o.extra ?? [])
    ]
  });
}
const PUT = tactic({
  name: "Put",
  cost: 0,
  behavior: { abilities: [{ id: "put", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
});

clause(TOWER, "0:unique", "printed card: a warlord location, cost 1, threshold [R], structure 4", () => {
  const b = towerBoard({ towerZone: "hand", active: P1 });
  const def = b.engine.getDefinition(b.id("wt"));
  assert.equal(def.type, "location");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "r");
  assert.equal(def.trade, "warlord");
  assert.equal(b.engine.getStat(b.id("wt"), "structure"), 4);
});

const towerHandBoard = (rage: number, greed: number, spent = 0) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "wt", def: printing(TOWER), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1), ...spentOf("rage", spent)]
  });

clause(TOWER, "0:unique", "deploys for exactly 1 with [R]; no resources, or only a non-[R] resource, is refused", () => {
  const ok = towerHandBoard(1, 0);
  play(ok.engine, P1, ok.id("wt"));
  assert.equal(zoneOf(ok.engine, ok.id("wt")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 1 paid");
  const none = towerHandBoard(0, 0);
  refused(() => play(none.engine, P1, none.id("wt")), "no resources");
  const wrong = towerHandBoard(0, 3);
  refused(() => play(wrong.engine, P1, wrong.id("wt")), "Greed only: the threshold [R] is not met");
  assert.equal(zoneOf(wrong.engine, wrong.id("wt")), "hand");
  const spare = towerHandBoard(3, 0);
  play(spare.engine, P1, spare.id("wt"));
  assert.equal(ready(spare.engine), 2, "the cost is 1, not 2 or 3");
});

clause(TOWER, "0:unique", "the cost is isolated from the threshold: a spent [R] meets [R] but cannot pay, a ready Greed pays", () => {
  const ok = towerHandBoard(0, 1, 1);
  play(ok.engine, P1, ok.id("wt"));
  assert.equal(zoneOf(ok.engine, ok.id("wt")), "play");
  assert.equal(ready(ok.engine), 0);
  const noPay = towerHandBoard(0, 0, 1);
  refused(() => play(noPay.engine, P1, noPay.id("wt")), "a spent [R] alone cannot pay the cost of 1");
  assert.equal(zoneOf(noPay.engine, noPay.id("wt")), "hand");
});

clause(TOWER, "0:unique", "controlling a second WATCHTOWER makes you keep one: choosing the new one destroys the old one", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "wt", def: printing(TOWER), owner: P1, zone: "play" },
      { key: "wt2", def: printing(TOWER), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("wt2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("wt"), b.id("wt2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("wt2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("wt2")), "play");
  assert.equal(zoneOf(b.engine, b.id("wt")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TOWER, "0:unique", "choosing the old Watchtower keeps it and destroys the new one", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "wt", def: printing(TOWER), owner: P1, zone: "play" },
      { key: "wt2", def: printing(TOWER), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("wt2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("wt") } } as never);
  assert.equal(zoneOf(b.engine, b.id("wt")), "play");
  assert.equal(zoneOf(b.engine, b.id("wt2")), "discard");
});

clause(TOWER, "0:unique", "the restriction is per player: the opponent may control their own Watchtower, with no choice and no destruction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "wt", def: printing(TOWER), owner: P1, zone: "play" },
      { key: "wt2", def: printing(TOWER), owner: P2, zone: "hand" },
      ...bank("rage", 2, P2)
    ]
  });
  play(b.engine, P2, b.id("wt2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("wt")), "play");
  assert.equal(zoneOf(b.engine, b.id("wt2")), "play");
});

clause(TOWER, "0:unique", "a card with a different UNIQUE designation is not a duplicate", () => {
  const b = towerBoard({ active: P1, extra: [{ key: "other", def: location({ name: "OtherLoc", unique: "other loc" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("wt")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(TOWER, "0:unique", "the designation is 'watchtower': ANOTHER card carrying that UNIQUE designation is a duplicate too", () => {
  const b = towerBoard({ active: P1, extra: [{ key: "twin", def: location({ name: "Other Tower", unique: "watchtower" } as Partial<CardDefinition>), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)] });
  play(b.engine, P1, b.id("twin"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [b.id("wt"), b.id("twin")].sort());
});

clause(TOWER, "0:unique", "taking control of the opponent's Watchtower while I have mine is a duplicate: I must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "wt", def: printing(TOWER), owner: P1, zone: "play" },
      { key: "theirs", def: printing(TOWER), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "two Watchtowers under one player's control");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(TOWER, "1:rule", "an opponent's character deployed from hand takes exactly 1 damage as it enters, and stays in play", () => {
  const b = towerBoard();
  play(b.engine, P2, b.id("theirChar"));
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "play");
  assert.equal(damageOn(b.engine, b.id("theirChar")), 1);
  assert.equal(pending(b.engine), undefined);
});

clause(TOWER, "1:rule", "the damage is real: a 1-life character is destroyed, a 3-life one has 2 life left", () => {
  const b = towerBoard();
  play(b.engine, P2, b.id("theirOne"));
  assert.equal(zoneOf(b.engine, b.id("theirOne")), "discard", "1 damage kills a 1-life character");
  play(b.engine, P2, b.id("theirChar"));
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "play");
  assert.equal(b.engine.getStat(b.id("theirChar"), "life") - damageOn(b.engine, b.id("theirChar")), 2);
});

clause(TOWER, "1:rule", "each opposing character entering takes its own 1 damage (two characters, 1 each, not stacked)", () => {
  const b = towerBoard();
  play(b.engine, P2, b.id("theirChar"));
  play(b.engine, P2, b.id("theirOne"));
  assert.equal(damageOn(b.engine, b.id("theirChar")), 1, "the first stays at 1");
});

clause(TOWER, "1:rule", "'a character' under 'an opponent's control' only: my own character entering takes no damage", () => {
  const b = towerBoard({ active: P1 });
  play(b.engine, P1, b.id("myChar"));
  assert.equal(zoneOf(b.engine, b.id("myChar")), "play");
  assert.equal(damageOn(b.engine, b.id("myChar")), 0);
});

clause(TOWER, "1:rule", "a non-character entering under the opponent's control (item, location) takes no damage", () => {
  const b = towerBoard();
  play(b.engine, P2, b.id("theirItem"));
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "play");
  assert.equal(damageOn(b.engine, b.id("theirItem")), 0, "an item is not a character");
  play(b.engine, P2, b.id("theirLoc"), {});
  assert.equal(zoneOf(b.engine, b.id("theirLoc")), "play");
  assert.equal(damageOn(b.engine, b.id("theirLoc")), 0, "a location is not a character");
});

clause(TOWER, "1:rule", "a card played face-down as a resource is not a character entering play: no damage", () => {
  const b = towerBoard();
  developResource(b.engine, P2, b.id("theirChar"), true);
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "play");
  assert.equal(b.engine.state.cards[b.id("theirChar")].faceDown, true);
  assert.equal(damageOn(b.engine, b.id("theirChar")), 0);
});

clause(TOWER, "1:rule", "also triggers when an effect puts the opponent's character into play (not only deploying)", () => {
  const b = towerBoard({ extra: [{ key: "put", def: PUT, owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("put"), { selected: { t: [b.id("theirChar")] } });
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "play");
  assert.equal(damageOn(b.engine, b.id("theirChar")), 1);
});

clause(TOWER, "1:rule", "control, not ownership, decides: a character I own that enters under the opponent's control takes damage, and a character they own entering under MY control does not", () => {
  const stolenIn = towerBoard({ extra: [{ key: "put", def: PUT, owner: P2, zone: "hand" }] });
  // P2 puts MY hand character into play under P2's control.
  play(stolenIn.engine, P2, stolenIn.id("put"), { selected: { t: [stolenIn.id("myChar")] } });
  assert.equal(stolenIn.engine.state.cards[stolenIn.id("myChar")].controllerId, P2);
  assert.equal(damageOn(stolenIn.engine, stolenIn.id("myChar")), 1, "entered under an opponent's control");
  const mine = towerBoard({ active: P1, extra: [{ key: "put", def: PUT, owner: P1, zone: "hand" }] });
  play(mine.engine, P1, mine.id("put"), { selected: { t: [mine.id("theirChar")] } });
  assert.equal(mine.engine.state.cards[mine.id("theirChar")].controllerId, P1);
  assert.equal(damageOn(mine.engine, mine.id("theirChar")), 0, "it entered under MY control");
});

clause(TOWER, "1:rule", "'an opponent' is relative to the Watchtower's controller: when the opponent controls it, MY characters take the damage and theirs do not", () => {
  const b = towerBoard({ towerController: P2, active: P1 });
  play(b.engine, P1, b.id("myChar"));
  assert.equal(damageOn(b.engine, b.id("myChar")), 1, "I am the opponent of the Watchtower's controller");
  const c = towerBoard({ towerController: P2, active: P2 });
  play(c.engine, P2, c.id("theirChar"));
  assert.equal(damageOn(c.engine, c.id("theirChar")), 0, "their own character is not damaged by their own Watchtower");
});

clause(TOWER, "1:rule", "only works while in play: with the Watchtower in my hand, the opponent's character takes no damage", () => {
  const b = towerBoard({ towerZone: "hand" });
  play(b.engine, P2, b.id("theirChar"));
  assert.equal(damageOn(b.engine, b.id("theirChar")), 0);
});

clause(TOWER, "1:rule", "stops once the Watchtower leaves play", () => {
  const b = towerBoard({ extra: [{ key: "razeLoc", def: tactic({ name: "Raze", cost: 0, behavior: { abilities: [{ id: "raze", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("razeLoc"), { selected: { t: [b.id("wt")] } });
  assert.equal(zoneOf(b.engine, b.id("wt")), "discard");
  play(b.engine, P2, b.id("theirChar"));
  assert.equal(damageOn(b.engine, b.id("theirChar")), 0);
});

clause(TOWER, "1:rule", "triggers every time: a second opposing character entering later in the same turn also takes its own 1 damage", () => {
  const b = towerBoard({ extra: [{ key: "theirChar2", def: character({ name: "Their Char 2", strength: 1, life: 3, speed: 1, cost: 1 }), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("theirChar"));
  assert.equal(damageOn(b.engine, b.id("theirChar")), 1);
  play(b.engine, P2, b.id("theirChar2"));
  assert.equal(damageOn(b.engine, b.id("theirChar2")), 1, "the second one is damaged too");
  assert.equal(damageOn(b.engine, b.id("theirChar")), 1, "and the first is not damaged twice");
});

// =============================================================================
// Defenders of Marduun / Legions of Chaos: shared faction rules
// =============================================================================

const STAPLE_RAGE = printing(RAGE);
const STAPLE_GREED = printing(GREED);
const STAPLE_DECEPTION = printing(DECEPTION);
const STAPLE_ELITISM = printing(ELITISM);
const STAPLE_OBSESSION = printing(OBSESSION);
const ODD_RESOURCE = resourceCard({ id: "ss14p1-odd-resource", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "ss14p1-filler", name: "Filler" });
const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

const PLAIN_OPP = factionCard({
  id: "ss14p1-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)];
const seat = (fid: string, deck?: CardDefinition[]) => ({ faction: printing(fid), deck: deck ?? [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)] });
const handSize = (engine: SpoilsEngine, player: Player): number => engine.state.players[player].hand.length;
const playCards = (engine: SpoilsEngine, player: Player): string[] => engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: string[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();
const STAPLE_NAMES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"];
const opp = (deck?: CardDefinition[]) => ({ faction: PLAIN_OPP, deck: deck ?? plainOppDeck() });

// --- STARTING RESOURCES

const srStaples = (fid: string) => () => {
  const engine = setupGame(
    seat(fid, [ODD_RESOURCE, FILLER, STAPLE_GREED, STAPLE_RAGE, STAPLE_DECEPTION, STAPLE_ELITISM, STAPLE_OBSESSION, ...repeat(FILLER, 40)]),
    opp()
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const cardId of mine) {
    assert.ok(STAPLE_NAMES.includes(engine.getDefinition(cardId).name), `${engine.getDefinition(cardId).name} is a staple`);
    assert.equal(engine.state.cards[cardId].faceDown, false, "flipped face-up after setup");
  }
  const total = Object.values(engine.getThresholds(P1)).reduce((sum: number, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
  assert.equal(readyCount(engine, P1), 2, "both are resources I can pay with");
};
const srNotOdd = (fid: string) => () => {
  const engine = setupGame(seat(fid, [ODD_RESOURCE, ODD_RESOURCE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), opp());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"], "a non-staple resource is never a starting resource");
};
const srFromDeck = (fid: string) => () => {
  const engine = setupGame(seat(fid, [STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), opp([STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)]));
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 8, "starting resources come out of my deck");
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"], "the opponent starts with their own resources");
};
const srChoose = (fid: string) => () => {
  const engine = setupGame(
    seat(fid, [ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_DECEPTION, ...repeat(FILLER, 40)]),
    opp(),
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "I am offered the choice");
  assert.equal(choice.count, 2);
  const deckStaples = deckOf(engine, P1).filter((cardId) => ["Rage", "Greed", "Deception"].includes(engine.getDefinition(cardId).name));
  assert.deepEqual([...choice.candidateCardIds].sort(), [...deckStaples].sort(), "exactly the 7 staples in my deck");
  const picked = [choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Deception")!, choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Greed")!];
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: picked });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Greed"], "exactly the staples I picked are in play");
};
const srBadChoice = (fid: string) => () => {
  const engine = setupGame(
    seat(fid, [ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    opp([STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)]),
    { choose: true }
  );
  const cands = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const rage = cands.find((c) => engine.getDefinition(c).name === "Rage")!;
  const greed = cands.find((c) => engine.getDefinition(c).name === "Greed")!;
  const rage2 = cands.filter((c) => engine.getDefinition(c).name === "Rage")[1];
  const odd = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  const filler = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Filler")!;
  const theirs = deckOf(engine, P2).find((c) => engine.getDefinition(c).name === "Elitism")!;
  const choose = (cardIds: string[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  assert.throws(choose([rage]), "one is too few");
  assert.throws(choose([rage, greed, rage2]), "three is too many");
  assert.throws(choose([rage, odd]), "a non-staple resource");
  assert.throws(choose([rage, filler]), "a character");
  assert.throws(choose([rage, rage]), "the same card twice");
  assert.throws(choose([rage, theirs]), "the opponent's staple");
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0, "nothing was put into play");
};
const srHandAfter = (fid: string) => () => {
  const engine = setupGame(
    seat(fid, [STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    opp(),
    { choose: true }
  );
  assert.equal(handSize(engine, P1), 0, "nothing is drawn while the choice is pending");
  const candidates = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  assert.equal(candidates.length, 7, "all seven staples I own are still in the deck");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [candidates.find((c) => engine.getDefinition(c).name === "Rage")!, candidates.find((c) => engine.getDefinition(c).name === "Greed")!] });
  while (engine.state.setup.phase === "chooseStartingResources") {
    const setup = engine.state.setup as unknown as { order: Player[]; currentIndex: number };
    const s = setup.order[setup.currentIndex];
    engine.perform({ type: "chooseStartingResources", playerId: s, cardIds: engine.getStartingResourceChoice(s)!.candidateCardIds.slice(0, 2) });
  }
  assert.equal(handSize(engine, P1), 8);
};

// The faction's printed INFLUENCE (card title bar): Defenders of Marduun 20, Legions of Chaos 21.
const startingInfluence = (fid: string, printed: number) => () => {
  const engine = setupGame(seat(fid), opp());
  assert.equal(engine.state.players[P1].influence, printed, `starts with the printed influence ${printed}`);
  assert.equal(engine.state.players[P2].influence, 20, "control: the opponent's own faction influence is separate");
  const second = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, seat(fid), { first: P1 });
  assert.equal(second.state.players[P2].influence, printed, "same influence going second");
};
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "starts the game with its printed influence of 20", startingInfluence(DEFENDERS, 20));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "starts the game with its printed influence of 21", startingInfluence(LEGIONS, 21));

clause(DEFENDERS, "0:rule:STARTING RESOURCES", "starts with exactly 2 staple resources in play, face-up", srStaples(DEFENDERS));
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "a non-staple resource is never taken, the resources come from my deck, the opponent has their own", srNotOdd(DEFENDERS));
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "the starting resources come out of my deck and the opponent starts with their own", srFromDeck(DEFENDERS));
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "'different': with Rage and Greed available (Rage first, three copies) the two starting resources are two DIFFERENT staples", () => {
  const engine = setupGame(seat(DEFENDERS, [STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), opp());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 1);
  assert.equal(engine.getThresholds(P1).greed, 1);
});
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "'different' (rules answer Q45): a deck with only one staple kind is an unplayable deck (flagged by the deck check); as a safety the engine falls back to two of the same staple", () => {
  const engine = setupGame(seat(DEFENDERS, [STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), opp());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"], "safety fallback: two of the only staple kind");
  assert.equal(engine.getThresholds(P1).rage, 2, "both count toward the Rage threshold");
});
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "'Any 2 different': with choosing on, I pick 2 staples from my deck", srChoose(DEFENDERS));
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "'different': choosing two of the same kind is refused, two different kinds is accepted", () => {
  const engine = setupGame(seat(DEFENDERS, [STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]), opp(), { choose: true });
  const cands = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const rages = cands.filter((c) => engine.getDefinition(c).name === "Rage");
  const greeds = cands.filter((c) => engine.getDefinition(c).name === "Greed");
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: rages }), "two Rage are not different");
  assert.equal(playCards(engine, P1).length, 0, "nothing was put into play");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rages[0], greeds[0]] });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
});
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staples from my own deck", srBadChoice(DEFENDERS));
clause(DEFENDERS, "0:rule:STARTING RESOURCES", "the opening hand is drawn after the starting resources are chosen", srHandAfter(DEFENDERS));

clause(LEGIONS, "0:rule:STARTING RESOURCES", "starts with exactly 2 staple resources in play, face-up", srStaples(LEGIONS));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "a non-staple resource is never taken as a starting resource", srNotOdd(LEGIONS));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "the starting resources come out of my deck and the opponent starts with their own", srFromDeck(LEGIONS));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "'Any 2 staple resources': the two may be of the same kind (not 'different')", () => {
  const engine = setupGame(seat(LEGIONS, [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), opp());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});
clause(LEGIONS, "0:rule:STARTING RESOURCES", "with choosing on, I pick which 2 staples from my deck", srChoose(LEGIONS));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "with choosing on, two of the same kind may be picked", () => {
  const engine = setupGame(seat(LEGIONS, [STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]), opp(), { choose: true });
  const greeds = engine.getStartingResourceChoice(P1)!.candidateCardIds.filter((c) => engine.getDefinition(c).name === "Greed");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"]);
  assert.equal(engine.getThresholds(P1).greed, 2);
});
clause(LEGIONS, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staples from my own deck", srBadChoice(LEGIONS));
clause(LEGIONS, "0:rule:STARTING RESOURCES", "the opening hand is drawn after the starting resources are chosen", srHandAfter(LEGIONS));

// --- STARTING DRAW

const sdFirst = (fid: string) => () => assert.equal(handSize(setupGame(seat(fid), opp(), { first: P1 }), P1), 8);
const sdSecond = (fid: string) => () => assert.equal(handSize(setupGame(seat(fid), opp(), { first: P2 }), P1), 9);
const sdSeatB = (fid: string) => () => {
  assert.equal(handSize(setupGame(opp(), seat(fid), { first: P2 }) as never, P2), 8);
  assert.equal(handSize(setupGame(opp(), seat(fid), { first: P1 }), P2), 9);
};
const sdOpp = (fid: string) => () => {
  assert.equal(handSize(setupGame(seat(fid), opp(), { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(seat(fid), opp(), { first: P2 }), P2), 7, "opponent going first");
};
const sdDeck = (fid: string) => () => {
  const engine = setupGame(seat(fid), opp(), { first: P1 });
  for (const cardId of engine.state.players[P1].hand) assert.notEqual(engine.state.cards[cardId].zone, "play");
  assert.equal(handOf(engine, P1).length + deckOf(engine, P1).length + playCards(engine, P1).length, 42, "no card appeared or vanished");
};
clause(DEFENDERS, "1:rule:STARTING DRAW", "draws 8 cards going first", sdFirst(DEFENDERS));
clause(DEFENDERS, "1:rule:STARTING DRAW", "draws 9 cards going second", sdSecond(DEFENDERS));
clause(DEFENDERS, "1:rule:STARTING DRAW", "also applies from the second seat (P2): 8 first, 9 second", sdSeatB(DEFENDERS));
clause(DEFENDERS, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps 7 first / 8 second)", sdOpp(DEFENDERS));
clause(DEFENDERS, "1:rule:STARTING DRAW", "the cards come from my deck and the starting resources are not part of the hand", sdDeck(DEFENDERS));
clause(LEGIONS, "1:rule:STARTING DRAW", "draws 8 cards going first", sdFirst(LEGIONS));
clause(LEGIONS, "1:rule:STARTING DRAW", "draws 9 cards going second", sdSecond(LEGIONS));
clause(LEGIONS, "1:rule:STARTING DRAW", "also applies from the second seat (P2): 8 first, 9 second", sdSeatB(LEGIONS));
clause(LEGIONS, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps 7 first / 8 second)", sdOpp(LEGIONS));
clause(LEGIONS, "1:rule:STARTING DRAW", "the cards come from my deck and the starting resources are not part of the hand", sdDeck(LEGIONS));

// --- RESTORE RULE

const topOfDeck = (label: string, owner: Player): CardPlacement[] =>
  Array.from({ length: 4 }, (_, i) => ({ key: `${label}${i}`, def: character({ name: `${label} ${i}` }), owner, zone: "deck" as const }));

function restoreBoard(fid: string, active: Player) {
  return buildGame({
    playerA: { faction: printing(fid) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1),
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}
const rrChars = (fid: string) => () => {
  const { engine, id } = restoreBoard(fid, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (the opponent owns it) is mine to restore");
};
const rrDetach = (fid: string) => () => {
  const { engine } = restoreBoard(fid, P2);
  assert.equal(attachedCount(engine, P1), 4, "3 spent resources + 1 attached Greed before my turn");
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
};
const rrOpp = (fid: string) => () => {
  const { engine, id } = restoreBoard(fid, P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "the opponent's resources stay attached");
};
const rrNotTheirTurn = (fid: string) => () => {
  const { engine, id } = restoreBoard(fid, P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true);
};
clause(DEFENDERS, "2:rule:RESTORE RULE", "at the start of my turn my depleted characters and items are restored", rrChars(DEFENDERS));
clause(DEFENDERS, "2:rule:RESTORE RULE", "at the start of my turn every resource is detached from my faction and all my resources are ready", rrDetach(DEFENDERS));
clause(DEFENDERS, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", rrOpp(DEFENDERS));
clause(DEFENDERS, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", rrNotTheirTurn(DEFENDERS));
clause(LEGIONS, "2:rule:RESTORE RULE", "at the start of my turn my depleted characters and items are restored", rrChars(LEGIONS));
clause(LEGIONS, "2:rule:RESTORE RULE", "at the start of my turn every resource is detached from my faction and all my resources are ready", rrDetach(LEGIONS));
clause(LEGIONS, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", rrOpp(LEGIONS));
clause(LEGIONS, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", rrNotTheirTurn(LEGIONS));

// --- DEVELOP RULE

function developBoard(fid: string, active: Player = P1) {
  return buildGame({
    playerA: { faction: printing(fid) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}
const drDraw = (fid: string) => () => {
  const { engine, id } = developBoard(fid);
  const handBefore = handSize(engine, P1);
  const deckBefore = deckOf(engine, P1);
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
};
const drPlayUp = (fid: string) => () => {
  const { engine, id } = developBoard(fid);
  const handBefore = handSize(engine, P1);
  const deckBefore = deckOf(engine, P1);
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1, "it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(engine, P1), deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
};
const drPlayDown = (fid: string) => () => {
  const { engine, id } = developBoard(fid);
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  const real = developBoard(fid);
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down it no longer provides its Greed");
};
const drNonResource = (fid: string) => () => {
  const { engine, id } = developBoard(fid);
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource card cannot be played face-up: it enters face-down");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
};
const drOneOrOther = (fid: string) => () => {
  const a = developBoard(fid);
  developDraw(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "the draw was the Develop Rule: no resource play is offered");
  assert.equal(zoneOf(a.engine, a.id("handRes")), "hand");
  const b = developBoard(fid);
  const deckBefore = deckOf(b.engine, P1);
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "the resource play was the Develop Rule: no draw is offered");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
};
const drOnce = (fid: string) => () => {
  const a = developBoard(fid);
  developDraw(a.engine, P1);
  const hand = handSize(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(a.engine, P1), hand);
  const b = developBoard(fid);
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(b.engine, b.id("handRes2")), "hand");
};
const drOwnTurn = (fid: string) => () => {
  const { engine, id } = developBoard(fid);
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
};
const drAgain = (fid: string) => () => {
  const { engine } = developBoard(fid);
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  assert.equal(handSize(engine, P1), hand, "skipping it gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
};
clause(DEFENDERS, "3:rule:DEVELOP RULE", "I may draw a card (the top of my deck)", drDraw(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "I may play a resource card face-up from my hand", drPlayUp(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "I may play any card face-down as a resource (Volition), including an actual resource card", drPlayDown(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", drNonResource(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "'draw a card or play a resource': one OR the other each turn, not both", drOneOrOther(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "it can be used only once per turn", drOnce(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "it can be used only on my own turn", drOwnTurn(DEFENDERS));
clause(DEFENDERS, "3:rule:DEVELOP RULE", "it is available again every turn, and skipping it costs nothing", drAgain(DEFENDERS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "I may draw a card (the top of my deck)", drDraw(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "I may play a resource card face-up from my hand", drPlayUp(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "I may play any card face-down as a resource (Volition), including an actual resource card", drPlayDown(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", drNonResource(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "'draw a card or play a resource': one OR the other each turn, not both", drOneOrOther(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "it can be used only once per turn", drOnce(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "it can be used only on my own turn", drOwnTurn(LEGIONS));
clause(LEGIONS, "3:rule:DEVELOP RULE", "it is available again every turn, and skipping it costs nothing", drAgain(LEGIONS));

// --- DRAW and RESOURCE abilities

function abilityBoard(fid: string, resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(fid) },
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
function activateFaction(engine: SpoilsEngine, pid: Player, abilityId: string, owner: Player = pid, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected, variables: {} });
  resolvePendingResponses(engine);
}
/** Activates RESOURCE and answers its "pick a card from your hand" prompt with `picks`. */
function useResource(engine: SpoilsEngine, pid: Player, abilityId: string, picks: CardInstanceId[], owner: Player = pid): void {
  activateFaction(engine, pid, abilityId, owner);
  answerPending(engine, "chooserSelectsTarget", { selected: picks });
}

const abDraw = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 5);
  const handBefore = handSize(engine, P1);
  const deckBefore = deckOf(engine, P1);
  assert.equal(readyCount(engine, P1), 5);
  activateFaction(engine, P1, ab);
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted ?? false, false, "the faction isn't depleted by it");
};
const abDrawRefused = (fid: string, ab: string) => () => {
  const two = abilityBoard(fid, 2);
  refused(() => activateFaction(two.engine, P1, ab), "2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), 2, "nothing is drawn");
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  const spent = abilityBoard(fid, 4);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  assert.equal(readyCount(spent.engine, P1), 2);
  refused(() => activateFaction(spent.engine, P1, ab), "4 resources, 2 already spent", /cannot be paid/);
  const exact = abilityBoard(fid, 3);
  activateFaction(exact.engine, P1, ab); // control
  assert.equal(handSize(exact.engine, P1), 3);
};
const abDrawTwice = (fid: string, ab: string) => () => {
  const { engine } = abilityBoard(fid, 7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, ab);
  activateFaction(engine, P1, ab);
  assert.equal(handSize(engine, P1), handBefore + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
};
const abDrawSeparate = (fid: string, ab: string) => () => {
  const first = abilityBoard(fid, 3);
  const base = handSize(first.engine, P1);
  activateFaction(first.engine, P1, ab);
  assert.ok(developOffers(first.engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(first.engine, P1);
  assert.equal(handSize(first.engine, P1), base + 2);
  const second = abilityBoard(fid, 3);
  developDraw(second.engine, P1);
  activateFaction(second.engine, P1, ab);
  assert.equal(handSize(second.engine, P1), base + 2);
};
const abOnlyController = (fid: string, ab: string) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fid) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirHand = handSize(engine, P2);
  refused(() => activateFaction(engine, P2, ab, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
};
const abRes = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 6);
  const handBefore = handSize(engine, P1);
  const deckBefore = deckOf(engine, P1);
  useResource(engine, P1, ab, [id("handRes")]);
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource was played");
  assert.equal(engine.getThresholds(P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(engine, P1), deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
};
const abResDown = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 4);
  useResource(engine, P1, ab, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play", "any card can be played as a resource");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
};
const abResChoice = (fid: string, ab: string) => () => {
  holdResourceFace(() => {
  const { engine, id } = abilityBoard(fid, 4);
  useResource(engine, P1, ab, [id("handRes")]);
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
  });
};
const abResOwnHand = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 4);
  activateFaction(engine, P1, ab);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  const pick = (k: string) => () => answerPending(engine, "chooserSelectsTarget", { selected: [id(k)] });
  refused(pick("theirHand"), "the opponent's hand card");
  refused(pick("mydeck0"), "a card in my deck");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  pick("handChar")(); // control
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
};
const abResOne = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 4);
  activateFaction(engine, P1, ab);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("handRes"), id("handChar")] }), "two cards: 'a resource' is one card");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("handRes")] });
  assert.equal(zoneOf(engine, id("handChar")), "hand");
};
const abResCost = (fid: string, ab: string) => () => {
  const short = abilityBoard(fid, 3);
  refused(() => useResource(short.engine, P1, ab, [short.id("handRes")]), "3 resources", /cannot be paid/);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("handRes")), "hand", "no resource was played");
  assert.equal(attachedCount(short.engine, P1), 0);
  assert.equal(readyCount(short.engine, P1), 3);
  const spent = abilityBoard(fid, 6);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 3)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  refused(() => useResource(spent.engine, P1, ab, [spent.id("handRes")]), "6 resources, 3 already spent", /cannot be paid/);
  const exact = abilityBoard(fid, 4);
  useResource(exact.engine, P1, ab, [exact.id("handRes")]); // control
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "with exactly 4 it works");
};
const abResTwice = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 8);
  useResource(engine, P1, ab, [id("handRes")]);
  useResource(engine, P1, ab, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8, "no once-per-turn limit is printed");
};
const abResSeparate = (fid: string, ab: string) => () => {
  const { engine, id } = abilityBoard(fid, 4);
  useResource(engine, P1, ab, [id("handRes")]);
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
};
const abResController = (fid: string, ab: string) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(fid) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 8, P2), { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
  });
  refused(() => activateFaction(engine, P2, ab, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
};

clause(DEFENDERS, "4:ability", "DRAW pays exactly 3 resources and draws one card", abDraw(DEFENDERS, "defenders-draw"));
clause(DEFENDERS, "4:ability", "DRAW is refused when the 3 can't be paid (2 resources, 2 ready of 4, none)", abDrawRefused(DEFENDERS, "defenders-draw"));
clause(DEFENDERS, "4:ability", "DRAW can be used again the same turn", abDrawTwice(DEFENDERS, "defenders-draw"));
clause(DEFENDERS, "4:ability", "DRAW is separate from the Develop Rule (either order)", abDrawSeparate(DEFENDERS, "defenders-draw"));
clause(DEFENDERS, "4:ability", "DRAW: only its controller can use it", abOnlyController(DEFENDERS, "defenders-draw"));
clause(DEFENDERS, "5:ability", "RESOURCE pays exactly 4 resources and plays a resource card from my hand", abRes(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE plays a non-resource card face-down as a resource", abResDown(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", abResChoice(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE: the card must come from my own hand", abResOwnHand(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE plays only one card", abResOne(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE is refused when the 4 can't be paid", abResCost(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE can be used again the same turn", abResTwice(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE is separate from the Develop Rule", abResSeparate(DEFENDERS, "defenders-resource"));
clause(DEFENDERS, "5:ability", "RESOURCE: only its controller can use it", abResController(DEFENDERS, "defenders-resource"));

clause(LEGIONS, "4:ability", "DRAW pays exactly 3 resources and draws one card", abDraw(LEGIONS, "legions-draw"));
clause(LEGIONS, "4:ability", "DRAW is refused when the 3 can't be paid (2 resources, 2 ready of 4, none)", abDrawRefused(LEGIONS, "legions-draw"));
clause(LEGIONS, "4:ability", "DRAW can be used again the same turn", abDrawTwice(LEGIONS, "legions-draw"));
clause(LEGIONS, "4:ability", "DRAW is separate from the Develop Rule (either order)", abDrawSeparate(LEGIONS, "legions-draw"));
clause(LEGIONS, "4:ability", "DRAW: only its controller can use it", abOnlyController(LEGIONS, "legions-draw"));
clause(LEGIONS, "5:ability", "RESOURCE pays exactly 4 resources and plays a resource card from my hand", abRes(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE plays a non-resource card face-down as a resource", abResDown(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", abResChoice(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE: the card must come from my own hand", abResOwnHand(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE plays only one card", abResOne(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE is refused when the 4 can't be paid", abResCost(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE can be used again the same turn", abResTwice(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE is separate from the Develop Rule", abResSeparate(LEGIONS, "legions-resource"));
clause(LEGIONS, "5:ability", "RESOURCE: only its controller can use it", abResController(LEGIONS, "legions-resource"));

// --- Defenders RALLY: Use this only not during a battle. Pay 5. Pick 3 characters you control that don't share a trade.
//     This turn, the characters gain 2 strength and 2 life.

function rallyBoard(resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(DEFENDERS) },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "c1", def: character({ name: "Warlord One", strength: 2, life: 3, speed: 2, ...trade("warlord") }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Rogue Two", strength: 1, life: 3, speed: 2, ...trade("rogue") }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Gearsmith Three", strength: 3, life: 4, speed: 2, ...trade("gearsmith") }), owner: P1, zone: "play" },
      { key: "c4", def: character({ name: "Rogue Four", strength: 2, life: 2, speed: 2, ...trade("rogue") }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2, ...trade("greed") }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...bank("greed", resources, P1),
      ...extra
    ]
  });
}
type RallyBoard = ReturnType<typeof rallyBoard>;
const rally = (b: RallyBoard, picks: string[], player: Player = P1) => activateFaction(b.engine, player, "defenders-rally", P1, { c: picks.map((k) => b.id(k)) });
const rs = (b: RallyBoard, k: string): [number, number] => [b.engine.getStat(b.id(k), "strength"), b.engine.getStat(b.id(k), "life")];

clause(DEFENDERS, "6:ability", "pays exactly 5 and gives each of the 3 picked characters +2 strength and +2 life (speed unchanged)", () => {
  const b = rallyBoard(6);
  rally(b, ["c1", "c2", "c3"]);
  assert.deepEqual(rs(b, "c1"), [4, 5]);
  assert.deepEqual(rs(b, "c2"), [3, 5]);
  assert.deepEqual(rs(b, "c3"), [5, 6]);
  assert.equal(b.engine.getStat(b.id("c1"), "speed"), 2);
  assert.equal(attachedCount(b.engine, P1), 5, "exactly 5 paid");
  assert.equal(ready(b.engine), 1);
});

clause(DEFENDERS, "6:ability", "only the picked characters are affected: the unpicked character, the opponent's character and an item are unchanged", () => {
  const b = rallyBoard(5);
  rally(b, ["c1", "c2", "c3"]);
  assert.deepEqual(rs(b, "c4"), [2, 2], "the fourth character of mine is not picked");
  assert.deepEqual(rs(b, "foe"), [1, 4]);
});

clause(DEFENDERS, "6:ability", "the picks are free among my characters: any 3 with different trades (here c4 instead of c2)", () => {
  const b = rallyBoard(5);
  rally(b, ["c4", "c1", "c3"]);
  assert.deepEqual(rs(b, "c4"), [4, 4]);
  assert.deepEqual(rs(b, "c2"), [1, 3]);
});

clause(DEFENDERS, "6:ability", "Pay 5: 4 ready resources is refused with nothing picked or paid, 5 works; spent resources don't count", () => {
  const short = rallyBoard(4);
  refused(() => rally(short, ["c1", "c2", "c3"]), "4 resources", /cannot be paid/);
  assert.deepEqual(rs(short, "c1"), [2, 3]);
  assert.equal(attachedCount(short.engine, P1), 0);
  const spent = rallyBoard(7);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 3)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  refused(() => rally(spent, ["c1", "c2", "c3"]), "7 resources, 3 spent", /cannot be paid/);
  const exact = rallyBoard(5);
  rally(exact, ["c1", "c2", "c3"]);
  assert.deepEqual(rs(exact, "c1"), [4, 5]);
});

clause(DEFENDERS, "6:ability", "'don't share a trade': two picks of the same trade (both Rogues) are refused", () => {
  const b = rallyBoard(5);
  refused(() => rally(b, ["c2", "c4", "c1"]), "two Rogues");
  assert.deepEqual(rs(b, "c2"), [1, 3]);
  assert.equal(attachedCount(b.engine, P1), 0, "nothing paid");
  refused(() => rally(b, ["c2", "c4", "c3"]), "two Rogues with Gearsmith");
  rally(b, ["c2", "c1", "c3"]); // control
  assert.deepEqual(rs(b, "c2"), [3, 5]);
});

clause(DEFENDERS, "6:ability", "'Pick 3': fewer than 3 (2 or 1 or none) is refused, and so are 4 picks", () => {
  const b = rallyBoard(10);
  refused(() => rally(b, ["c1", "c2"]), "only 2 characters");
  refused(() => rally(b, ["c1"]), "only 1 character");
  refused(() => rally(b, []), "no characters");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing paid");
  rally(b, ["c1", "c2", "c3"]); // control
  assert.deepEqual(rs(b, "c1"), [4, 5]);
});

clause(DEFENDERS, "6:ability", "the same character cannot be picked twice", () => {
  const b = rallyBoard(5);
  refused(() => rally(b, ["c1", "c1", "c2"]), "c1 twice");
  assert.deepEqual(rs(b, "c1"), [2, 3]);
});

clause(DEFENDERS, "6:ability", "the picks must be characters I control: the opponent's character and an item are refused", () => {
  const b = rallyBoard(5);
  refused(() => rally(b, ["c1", "c2", "foe"]), "the opponent's character");
  refused(() => rally(b, ["c1", "c2", "gear"]), "an item");
  assert.deepEqual(rs(b, "foe"), [1, 4]);
  assert.equal(attachedCount(b.engine, P1), 0);
});

clause(DEFENDERS, "6:ability", "control, not ownership: a character I own but the opponent controls is refused; one I control but they own is allowed", () => {
  const b = rallyBoard(5, [
    { key: "stolenOut", def: character({ name: "Stolen Out", strength: 1, life: 1, speed: 1, ...trade("elitism") }), owner: P1, controller: P2, zone: "play" },
    { key: "stolenIn", def: character({ name: "Stolen In", strength: 1, life: 1, speed: 1, ...trade("obsession") }), owner: P2, controller: P1, zone: "play" }
  ]);
  refused(() => rally(b, ["c1", "c2", "stolenOut"]), "owned by me, controlled by the opponent");
  rally(b, ["c1", "c2", "stolenIn"]);
  assert.deepEqual(rs(b, "stolenIn"), [3, 3]);
});

clause(DEFENDERS, "6:ability", "'Use this only not during a battle': refused while a battle is on, allowed before it and after it ends", () => {
  const b = rallyBoard(10);
  rally(b, ["c1", "c2", "c3"]); // before a battle (control)
  declareAttackBy(b.engine, P1, [b.id("c4")]);
  assert.ok(b.engine.state.battle, "a battle is on");
  refused(() => rally(b, ["c1", "c2", "c3"]), "during a battle", /current timing/);
  assert.equal(attachedCount(b.engine, P1), 5, "only the first Rally was paid");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined);
  rally(b, ["c1", "c2", "c3"]);
  assert.equal(attachedCount(b.engine, P1), 10);
});

clause(DEFENDERS, "6:ability", "'not during a battle' is the card's own restriction: the defender, holding priority in the declaration window, is refused too, while the same response outside a battle works", () => {
  const NOOP = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });
  const board = (withBattle: boolean) => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: printing(DEFENDERS) },
      cards: [
        { key: "att", def: character({ name: "Attacker", strength: 1, life: 9 }), owner: P1, zone: "play" },
        { key: "noop", def: NOOP, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D One", ...trade("warlord") }), owner: P2, zone: "play" },
        { key: "d2", def: character({ name: "D Two", ...trade("rogue") }), owner: P2, zone: "play" },
        { key: "d3", def: character({ name: "D Three", ...trade("gearsmith") }), owner: P2, zone: "play" },
        ...bank("greed", 5, P2)
      ]
    });
    if (withBattle) declareAttackOpenWindow(g.engine, P1, [g.id("att")]);
    else playRaw(g.engine, P1, g.id("noop"));
    return g;
  };
  const rallyBy = (g: ReturnType<typeof board>) =>
    g.engine.perform({ type: "activateAbility", playerId: P2, cardId: factionOf(g.engine, P2), abilityId: "defenders-rally", selected: { c: [g.id("d1"), g.id("d2"), g.id("d3")] }, variables: {} } as never);
  const ctl = board(false);
  assert.equal(ctl.engine.state.battle, undefined, "no battle");
  assert.ok(ctl.engine.state.responseWindow, "the opponent may respond");
  rallyBy(ctl);
  resolvePendingResponses(ctl.engine);
  assert.equal(ctl.engine.getStat(ctl.id("d1"), "strength"), ctl.engine.getDefinition(ctl.id("d1")).strength! + 2, "positive control: usable in a response outside a battle");
  const b = board(true);
  assert.ok(b.engine.state.battle, "a battle is on");
  assert.ok(b.engine.state.responseWindow, "the defender holds priority");
  refused(() => rallyBy(b), "during a battle", /current timing|battle|condition/i);
  assert.equal(attachedCount(b.engine, P2), 0, "nothing was paid");
});

clause(DEFENDERS, "6:ability", "'This turn': the bonus is gone after the turn ends", () => {
  const b = rallyBoard(5);
  rally(b, ["c1", "c2", "c3"]);
  assert.deepEqual(rs(b, "c1"), [4, 5]);
  endTurn(b.engine, P1);
  assert.deepEqual(rs(b, "c1"), [2, 3], "back to printed stats in the opponent's turn");
  assert.deepEqual(rs(b, "c3"), [3, 4]);
  endTurn(b.engine, P2);
  assert.deepEqual(rs(b, "c1"), [2, 3], "and it doesn't come back next turn");
});

clause(DEFENDERS, "6:ability", "two Rallies in one turn stack on the same characters: +4 strength and +4 life", () => {
  const b = rallyBoard(10);
  rally(b, ["c1", "c2", "c3"]);
  rally(b, ["c1", "c2", "c3"]);
  assert.deepEqual(rs(b, "c1"), [6, 7]);
});

clause(DEFENDERS, "6:ability", "the bonus is on the characters, not tied to the faction: it makes extra life real (4 damage on a 3-life character survives)", () => {
  const b = rallyBoard(5);
  rally(b, ["c1", "c2", "c3"]);
  b.engine.state.cards[b.id("c1")].damage = 4;
  assert.equal(b.engine.getStat(b.id("c1"), "life"), 5);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
});

clause(DEFENDERS, "6:ability", "only its controller can use it", () => {
  const b = rallyBoard(5, bank("greed", 5, P2));
  refused(() => rally(b, ["c1", "c2", "c3"], P2), "the opponent cannot Rally for me", /do not control/i);
  assert.deepEqual(rs(b, "c1"), [2, 3]);
});

// --- Legions of Chaos: when a character enters play under your control, you may pay 3. If you do, search
//     your deck for a character that does not share a trade with any characters you control, reveal it
//     and put it into your hand.

interface LegOpts {
  greed?: number;
  extra?: CardPlacement[];
  enterTrade?: string;
}
function legBoard(o: LegOpts = {}) {
  return buildGame({
    playerA: { faction: printing(LEGIONS) },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "ch", def: character({ name: "Entering", cost: 1, ...trade(o.enterTrade ?? "warlord") }), owner: P1, zone: "hand" },
      { key: "pl", def: character({ name: "In Play", ...trade("rogue") }), owner: P1, zone: "play" },
      { key: "foePl", def: character({ name: "Foe In Play", ...trade("gearsmith") }), owner: P2, zone: "play" },
      { key: "dW", def: character({ name: "Deck Warlord", ...trade("warlord") }), owner: P1, zone: "deck" },
      { key: "dR", def: character({ name: "Deck Rogue", ...trade("rogue") }), owner: P1, zone: "deck" },
      { key: "dG", def: character({ name: "Deck Gearsmith", ...trade("gearsmith") }), owner: P1, zone: "deck" },
      { key: "dE", def: character({ name: "Deck Elitism", ...trade("elitism") }), owner: P1, zone: "deck" },
      { key: "dI", def: item({ name: "Deck Item", ...trade("obsession") }), owner: P1, zone: "deck" },
      { key: "oG", def: character({ name: "Their Deck Gearsmith", ...trade("gearsmith") }), owner: P2, zone: "deck" },
      { key: "oHand", def: character({ name: "Their Hand", ...trade("obsession") }), owner: P2, zone: "hand" },
      ...bank("greed", o.greed ?? 4, P1),
      ...(o.extra ?? [])
    ]
  });
}
type LegBoard = ReturnType<typeof legBoard>;
const mayPay = (b: LegBoard, pay: boolean) => answerPending(b.engine, "mayPay", { pay });
const searchPick = (b: LegBoard, keys: string[]) => answerPending(b.engine, "chooserSelectsTarget", { selected: keys.map((k) => b.id(k)) });
const deploy = (b: LegBoard) => play(b.engine, P1, b.id("ch"));

clause(LEGIONS, "6:rule", "a character entering under my control offers 'you may pay 3'; paying 3 then lets me search for a character", () => {
  const b = legBoard();
  deploy(b);
  assert.equal(zoneOf(b.engine, b.id("ch")), "play");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  assert.equal(ready(b.engine), 3, "the optional 3 is not paid until I accept");
  mayPay(b, true);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "I choose the card");
  assert.equal(pending(b.engine)?.playerId, P1);
  assert.equal(attachedCount(b.engine, P1), 4, "1 for the character + exactly 3 paid");
  assert.equal(ready(b.engine), 0);
});

clause(LEGIONS, "6:rule", "the found character goes to my hand, is revealed to everyone, and the deck is then shuffled", () => {
  const b = legBoard();
  deploy(b);
  const deckBefore = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  const before = reveals(b.engine).length;
  mayPay(b, true);
  searchPick(b, ["dG"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dG")), "hand");
  assert.deepEqual(handOf(b.engine, P1), [...handBefore, b.id("dG")], "exactly that one card was added to my hand");
  const rest = deckBefore.filter((c) => c !== b.id("dG"));
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(rest, 0.5), "the deck was shuffled (CR 312.1)");
  const shown = reveals(b.engine).slice(before).filter((e) => (e.event as unknown as { cardIds: string[] }).cardIds.includes(b.id("dG")));
  assert.ok(shown.length >= 1, "the found card was revealed");
  assert.equal((shown[0].event as unknown as { viewerId: string }).viewerId, "all");
});

clause(LEGIONS, "6:rule", "'you may': declining the payment spends nothing, searches nothing and does not shuffle the deck", () => {
  const b = legBoard();
  deploy(b);
  const deckBefore = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  mayPay(b, false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine), 3, "nothing was paid");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore, "same order, no shuffle");
  assert.deepEqual(handOf(b.engine, P1), handBefore);
});

clause(LEGIONS, "6:rule", "'pay 3': with only 2 resources left after deploying, I cannot pay and nothing is searched", () => {
  const b = legBoard({ greed: 3 });
  deploy(b);
  assert.equal(ready(b.engine), 2);
  const stillAsked = pending(b.engine)?.kind === "mayPay";
  if (stillAsked) refused(() => mayPay(b, true), "2 resources cannot pay 3");
  const deckBefore = deckOf(b.engine, P1);
  assert.equal(pending(b.engine)?.kind === "chooserSelectsTarget", false, "no search");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
  assert.equal(attachedCount(b.engine, P1), 1, "only the character's own cost was paid");
});

clause(LEGIONS, "6:rule", "the payment is exactly 3, not 4: a spare resource stays unspent", () => {
  const b = legBoard({ greed: 5 });
  deploy(b);
  mayPay(b, true);
  searchPick(b, ["dG"]);
  assert.equal(ready(b.engine), 1);
});

clause(LEGIONS, "6:rule", "'does not share a trade with any characters you control': the entering character's trade (Warlord) and another of my characters' trade (Rogue) are both excluded", () => {
  const b = legBoard();
  deploy(b);
  mayPay(b, true);
  const deckBefore = deckOf(b.engine, P1);
  for (const [k, why] of [["dW", "shares Warlord with the entering character"], ["dR", "shares Rogue with a character I control"]] as const) {
    refused(() => searchPick(b, [k]), why);
  }
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still choosing");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore, "nothing moved");
  searchPick(b, ["dE"]); // control: Elitism shares with nobody
  assert.equal(zoneOf(b.engine, b.id("dE")), "hand");
});

clause(LEGIONS, "6:rule", "a trade only the OPPONENT's characters have does not exclude it (Gearsmith: only the opponent controls one)", () => {
  const b = legBoard();
  deploy(b);
  mayPay(b, true);
  searchPick(b, ["dG"]);
  assert.equal(zoneOf(b.engine, b.id("dG")), "hand");
});

clause(LEGIONS, "6:rule", "the pick must be a character in MY deck: an item, the opponent's deck, hand and my own in-play characters are refused", () => {
  const b = legBoard();
  deploy(b);
  mayPay(b, true);
  refused(() => searchPick(b, ["dI"]), "an item in my deck");
  refused(() => searchPick(b, ["oG"]), "a character in the opponent's deck");
  refused(() => searchPick(b, ["oHand"]), "a card in the opponent's hand");
  refused(() => searchPick(b, ["pl"]), "a character in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  searchPick(b, ["dG"]);
  assert.equal(zoneOf(b.engine, b.id("dG")), "hand");
  assert.equal(zoneOf(b.engine, b.id("oG")), "deck");
});

clause(LEGIONS, "6:rule", "only one card is found: picking two is refused", () => {
  const b = legBoard();
  deploy(b);
  mayPay(b, true);
  refused(() => searchPick(b, ["dG", "dE"]), "two cards");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  searchPick(b, ["dE"]);
  assert.equal(zoneOf(b.engine, b.id("dG")), "deck");
});

clause(LEGIONS, "6:rule", "the search may find nothing: the payment is spent, nothing goes to my hand, and the deck is still shuffled", () => {
  const b = legBoard();
  deploy(b);
  const deckBefore = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  mayPay(b, true);
  searchPick(b, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(attachedCount(b.engine, P1), 4, "the 3 stay paid");
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(deckBefore, 0.5), "a failed search still shuffles (CR 312.1)");
});

clause(LEGIONS, "6:rule", "with no legal character in the deck (every deck character shares a trade) the search finds nothing and still shuffles", () => {
  const b = buildGame({
    playerA: { faction: printing(LEGIONS) },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "ch", def: character({ name: "Entering", cost: 1, ...trade("warlord") }), owner: P1, zone: "hand" },
      { key: "dW", def: character({ name: "Deck Warlord", ...trade("warlord") }), owner: P1, zone: "deck" },
      { key: "dW2", def: character({ name: "Deck Warlord 2", ...trade("warlord") }), owner: P1, zone: "deck" },
      { key: "dW3", def: character({ name: "Deck Warlord 3", ...trade("warlord") }), owner: P1, zone: "deck" },
      ...bank("greed", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("ch"));
  const deckBefore = deckOf(b.engine, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  if (pending(b.engine)?.kind === "chooserSelectsTarget") answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(deckBefore, 0.5), "shuffled even though nothing could be found");
});

clause(LEGIONS, "6:rule", "the entering character's own trade matters: when it is a different trade (Elitism), a Warlord in the deck becomes legal and Elitism is not", () => {
  const b = legBoard({ enterTrade: "elitism" });
  deploy(b);
  mayPay(b, true);
  refused(() => searchPick(b, ["dE"]), "shares Elitism with the entering character");
  searchPick(b, ["dW"]);
  assert.equal(zoneOf(b.engine, b.id("dW")), "hand");
});

clause(LEGIONS, "6:rule", "'under your control': the opponent's character entering play does not trigger my Legions", () => {
  const b = legBoard({ extra: [{ key: "theirChar", def: character({ name: "Their Entering", cost: 1, ...trade("obsession") }), owner: P2, zone: "hand" }, ...bank("greed", 4, P2)] });
  const b2 = buildGame({
    playerA: { faction: printing(LEGIONS) },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "theirChar", def: character({ name: "Their Entering", cost: 1, ...trade("obsession") }), owner: P2, zone: "hand" },
      { key: "dG", def: character({ name: "Deck Gearsmith", ...trade("gearsmith") }), owner: P1, zone: "deck" },
      ...bank("greed", 4, P2),
      ...bank("greed", 4, P1)
    ]
  });
  void b;
  play(b2.engine, P2, b2.id("theirChar"));
  assert.equal(zoneOf(b2.engine, b2.id("theirChar")), "play");
  assert.equal(b2.engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(b2.engine, P1), 0);
});

clause(LEGIONS, "6:rule", "'a character': an item entering play under my control does not trigger it", () => {
  const b = legBoard({ extra: [{ key: "myItem", def: item({ name: "My Item", cost: 1 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("myItem"));
  assert.equal(zoneOf(b.engine, b.id("myItem")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(LEGIONS, "6:rule", "a card played face-down as a resource is not a character entering play: no trigger", () => {
  const b = legBoard();
  developResource(b.engine, P1, b.id("ch"), true);
  assert.equal(zoneOf(b.engine, b.id("ch")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(b.engine, P1), 0);
});

clause(LEGIONS, "6:rule", "also triggers when an effect puts a character into play under my control (even one the opponent owns); that character's trade counts too", () => {
  const b = legBoard({ extra: [{ key: "put", def: PUT, owner: P1, zone: "hand" }, { key: "dO", def: character({ name: "Deck Obsession", ...trade("obsession") }), owner: P1, zone: "deck" }] });
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("oHand")] } });
  assert.equal(b.engine.state.cards[b.id("oHand")].controllerId, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay", "entered under my control");
  mayPay(b, true);
  refused(() => searchPick(b, ["dO"]), "shares Obsession with the character that was put into play");
  refused(() => searchPick(b, ["dR"]), "shares Rogue with a character I control");
  searchPick(b, ["dW"]);
  assert.equal(zoneOf(b.engine, b.id("dW")), "hand");
});

clause(LEGIONS, "6:rule", "each character entering gives its own offer: two characters, two separate searches", () => {
  const b = legBoard({ greed: 8, extra: [{ key: "ch2", def: character({ name: "Entering Two", cost: 1, ...trade("obsession") }), owner: P1, zone: "hand" }] });
  deploy(b);
  mayPay(b, true);
  searchPick(b, ["dG"]);
  play(b.engine, P1, b.id("ch2"));
  assert.equal(pending(b.engine)?.kind, "mayPay", "a second offer for the second character");
  mayPay(b, true);
  searchPick(b, ["dE"]);
  assert.equal(zoneOf(b.engine, b.id("dG")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dE")), "hand");
  assert.equal(attachedCount(b.engine, P1), 1 + 3 + 1 + 3);
});

clause(LEGIONS, "6:rule", "a trade is shared with 'any characters you control': a character that entered earlier and sits in play also excludes its trade", () => {
  const b = legBoard({ extra: [{ key: "ch2", def: character({ name: "Entering Two", cost: 1, ...trade("obsession") }), owner: P1, zone: "hand" }, { key: "dO", def: character({ name: "Deck Obsession", ...trade("obsession") }), owner: P1, zone: "deck" }], greed: 8 });
  deploy(b);
  mayPay(b, false);
  play(b.engine, P1, b.id("ch2"));
  mayPay(b, true);
  refused(() => searchPick(b, ["dO"]), "shares Obsession with the entering character");
  refused(() => searchPick(b, ["dW"]), "shares Warlord with the first character that entered earlier");
  searchPick(b, ["dE"]);
  assert.equal(zoneOf(b.engine, b.id("dE")), "hand");
});

clause(LEGIONS, "6:rule", "works only while the Legions faction is mine: the opponent controlling the same faction trigger isn't mine (their Legions does not search my deck)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: printing(LEGIONS) },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ch", def: character({ name: "Entering", cost: 1, ...trade("warlord") }), owner: P1, zone: "hand" },
      { key: "dG", def: character({ name: "Deck Gearsmith", ...trade("gearsmith") }), owner: P2, zone: "deck" },
      ...bank("greed", 4, P1),
      ...bank("greed", 4, P2)
    ]
  });
  play(b.engine, P1, b.id("ch"));
  assert.equal(b.engine.state.pendingChoice, undefined, "a character entering under MY control doesn't offer the opponent's Legions search");
  assert.equal(zoneOf(b.engine, b.id("dG")), "deck");
});

void drain;
void discardOf;
void declareAttackBy;
void fillers;
