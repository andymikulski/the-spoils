// Clause tests — batch ungodly-mess-03, part p3 (groups 9-15, missing clauses).
// Expectations come from each card's PRINTED text and RULES.md; engine data only drives the engine.

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
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { fightThrough, playRaw } from "./_battle.js";
import { zoneOf } from "./_board.js";
import { endTurn, factionOf, developPlay } from "./_turn.js";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const GENERAL = "49e65515-97cf-44e3-90f8-7cf79c9aa0ae"; // Great Mau General
const HAUNT = "f7cab292-794f-408f-ab81-99fb8000955e"; // Haunting Execution
const KEY = "cabcf2b8-f2c4-4dd8-ba1b-2d239b26f3da"; // Key to the City
const MITTONS = "37c92e02-fbd4-4a62-8e27-5beab0a0cb36"; // Kitten Mittons
const CULTISTS = "a26e61de-884b-4f9a-a20b-e2d2fad9bada"; // Padamose Cultists
const POLITICIAN = "c8648c98-330b-4803-906c-98c146af63f9"; // Pandering Politician
const PPE = "29b3dc24-5f90-4a14-adab-030bb2f8b771"; // PP&E

type Pid = typeof P1 | typeof P2;
const ready = (engine: SpoilsEngine, p: Pid = P1) => engine.getAvailableResourceCount(p);
const inf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].influence;
const handOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].hand;

function activateRaw(engine: SpoilsEngine, player: Pid, cardId: string, abilityId: string, selected: Record<string, string[]> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

/** A free tactic that destroys / bounces one picked card of `type` (declaration `t`). */
function removalTactic(effect: "destroy" | "bounce", type: "character" | "item" = "character"): CardDefinition {
  return tactic({
    name: `Remove-${effect}-${type}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [
            effect === "destroy"
              ? { type: "destroy", target: { type: "selected", id: "t" } }
              : { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }
          ]
        }
      ]
    }
  } as Partial<CardDefinition>);
}

function hitTactic(amount: number): CardDefinition {
  return tactic({
    name: `Hit${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  } as Partial<CardDefinition>);
}

/**
 * Printed cost / threshold of a hand card: exactly enough deploys, one short is refused,
 * one icon short (enough total resources but one fewer [G]) is refused.
 */
function costChecks(id: string, cost: number, icons: number, extra: (c: CardPlacement[]) => CardPlacement[], sel: (id: (k: string) => string) => Record<string, string[]>) {
  const mk = (res: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "c", def: printing(id), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
        ...extra([]),
        ...res
      ],
      turn: 2
    });
  const attempt = (b: ReturnType<typeof mk>) => () => playRaw(b.engine, P1, b.id("c"), { selected: sel(b.id) });
  const ok = mk(bank("greed", Math.max(cost, icons)));
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("c"), { selected: sel(ok.id) });
  assert.notEqual(zoneOf(ok.engine, ok.id("c")), "hand", "deployed with exactly enough");
  assert.equal(before - ready(ok.engine), cost, `printed cost ${cost} is paid`);
  if (cost > 0) {
    const short = mk(bank("greed", cost - 1));
    refused(attempt(short), `one resource short of cost ${cost}`);
    assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  }
  const exact = mk([...bank("greed", icons), ...volition(Math.max(cost - icons, 0))]);
  play(exact.engine, P1, exact.id("c"), { selected: sel(exact.id) });
  assert.notEqual(zoneOf(exact.engine, exact.id("c")), "hand", `exactly ${icons} [G] plus other resources deploys`);
  const iconShort = mk([...bank("greed", icons - 1), ...volition(cost + 1)]);
  refused(attempt(iconShort), `${icons - 1} [G] is short of the threshold of ${icons}`);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("c")), "hand");
}

// ===================================================================================
// Great Mau General — When this card inflicts damage, if your faction has 10 influence
// or less, your faction gains 2 influence.
// ===================================================================================

function generalBoard(opts: { a?: number; b?: number; blockerKey?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.a ?? 8 },
    playerB: { faction: developFaction(), influence: opts.b ?? 8 },
    cards: [
      { key: "gmg", def: printing(GENERAL), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 3, speed: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 1, speed: 1, life: 10 }), owner: P2, zone: "play" },
      { key: "fast", def: character({ name: "Fast", strength: 5, speed: 4, life: 5 }), owner: P2, zone: "play" }
    ],
    turn: 2
  });
}
const toFaction = (p: Pid) => ({ type: "faction", playerId: p }) as const;

clause(GENERAL, "0:rule", "printed cost 6, threshold [G][G], character mau soldier, 4 / 3 / 5", () => {
  costChecks(GENERAL, 6, 2, (c) => c, () => ({}));
  const { engine, id } = generalBoard();
  assert.equal(engine.getStat(id("gmg"), "strength"), 4);
  assert.equal(engine.getStat(id("gmg"), "speed"), 3);
  assert.equal(engine.getStat(id("gmg"), "life"), 5);
  assert.deepEqual([...printing(GENERAL).subtype!], ["mau", "soldier"]);
  assert.equal(printing(GENERAL).type, "character");
});

clause(GENERAL, "0:rule", "unblocked, it inflicts damage on the faction: influence 8 becomes 10", () => {
  const { engine, id } = generalBoard({ a: 8 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 10);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GENERAL, "0:rule", "the threshold is 'or less': exactly 10 influence still gains 2", () => {
  const { engine, id } = generalBoard({ a: 10 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 12);
});

clause(GENERAL, "0:rule", "with 11 influence (more than 10) nothing is gained", () => {
  const { engine, id } = generalBoard({ a: 11 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 11);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GENERAL, "0:rule", "the gain is exactly 2, not the damage dealt (4 strength)", () => {
  const { engine, id } = generalBoard({ a: 0 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 2);
  assert.equal(inf(engine, P2), 4, "the opponent's faction took the 4 damage (8 - 4)");
});

clause(GENERAL, "0:rule", "damage it inflicts on a blocking character also counts", () => {
  const { engine, id } = generalBoard({ a: 5 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), [id("wall")]);
  assert.equal(engine.state.cards[id("wall")].damage, 4, "the blocker took 4");
  assert.equal(inf(engine, P1), 7);
  assert.equal(inf(engine, P2), 8, "the opponent gains nothing");
});

clause(GENERAL, "0:rule", "damage inflicted by another of your characters does not trigger it", () => {
  const { engine, id } = generalBoard({ a: 8 });
  fightThrough(engine, P1, [id("other")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 8, "Other inflicted the damage, not the General");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GENERAL, "0:rule", "damage dealt TO the General (it inflicts none: destroyed first) does not trigger it", () => {
  const { engine, id } = generalBoard({ a: 8 });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), [id("fast")]);
  assert.notEqual(zoneOf(engine, id("gmg")), "play", "the faster 5-strength blocker destroyed the General first");
  assert.equal(engine.state.cards[id("fast")].damage ?? 0, 0, "the General never struck");
  assert.equal(inf(engine, P1), 8);
});

clause(GENERAL, "0:rule", "'your faction' is its controller's: a General controlled by the opponent pays the opponent", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 8 },
    playerB: { faction: developFaction(), influence: 6 },
    cards: [
      { key: "gmg", def: printing(GENERAL), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 10 }), owner: P1, zone: "play" }
    ],
    turn: 2
  });
  fightThrough(engine, P1, [id("atk")], toFaction(P2), [id("gmg")]);
  assert.equal(inf(engine, P2), 8, "its controller's faction gained 2");
  assert.equal(inf(engine, P1), 8, "the attacker's faction did not");
});

clause(GENERAL, "0:rule", "a General you control but do not own pays you (controller, not owner)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 8 },
    playerB: { faction: developFaction(), influence: 8 },
    cards: [{ key: "gmg", def: printing(GENERAL), owner: P2, controller: P1, zone: "play" }],
    turn: 2
  });
  fightThrough(engine, P1, [id("gmg")], toFaction(P2), []);
  assert.equal(inf(engine, P1), 10);
  assert.equal(inf(engine, P2), 4 /* 8 - 4 damage */);
});

// ===================================================================================
// Haunting Execution — EXTRA COST: if at least 4 characters in your discard pile, reduce
// numeric cost by 3. Pick a character. / Destroy the character. / RECUR.
// ===================================================================================

function hauntBoard(o: { mineDiscard?: number; itemsDiscard?: number; foeDiscard?: number; res?: CardPlacement[]; zone?: "hand" | "discard" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "he", def: printing(HAUNT), owner: P1, zone: o.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "foeDead", def: character({ name: "FoeDead" }), owner: P2, zone: "discard" },
      { key: "dItem", def: item({ name: "DItem" }), owner: P1, zone: "discard" },
      ...Array.from({ length: o.mineDiscard ?? 0 }, (_, i) => ({ key: `dead${i}`, def: character({ name: `Dead${i}` }), owner: P1, zone: "discard" as const })),
      ...Array.from({ length: o.itemsDiscard ?? 0 }, (_, i) => ({ key: `ditem${i}`, def: item({ name: `DI${i}` }), owner: P1, zone: "discard" as const })),
      ...Array.from({ length: o.foeDiscard ?? 0 }, (_, i) => ({ key: `fdead${i}`, def: character({ name: `FDead${i}` }), owner: P2, zone: "discard" as const })),
      ...(o.res ?? [])
    ],
    turn: 2
  });
}

clause(HAUNT, "0:extraCost", "printed cost 6, threshold [G], tactic; one short and one icon short are refused", () => {
  costChecks(HAUNT, 6, 1, (c) => c, (id) => ({ c: [id("host")] }));
  assert.equal(printing(HAUNT).type, "tactic");
});

clause(HAUNT, "0:extraCost", "with 4 characters in your discard pile the cost is reduced by 3 (deploys for exactly 3)", () => {
  const b = hauntBoard({ mineDiscard: 4, res: bank("greed", 3) });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(before - ready(b.engine), 3, "paid 3, not 6");
});

clause(HAUNT, "0:extraCost", "with 4 characters in your discard pile, 2 resources are still not enough", () => {
  const b = hauntBoard({ mineDiscard: 4, res: bank("greed", 2) });
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } }), "cost 3 needs 3");
  assert.equal(zoneOf(b.engine, b.id("he")), "hand");
});

clause(HAUNT, "0:extraCost", "with 3 characters in your discard pile there is no reduction (6 needed, 5 refused)", () => {
  const short = hauntBoard({ mineDiscard: 3, res: bank("greed", 5) });
  refused(() => playRaw(short.engine, P1, short.id("he"), { selected: { c: [short.id("foe")] } }), "cost stays 6");
  const ok = hauntBoard({ mineDiscard: 3, res: bank("greed", 6) });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("he"), { selected: { c: [ok.id("foe")] } });
  assert.equal(before - ready(ok.engine), 6);
});

clause(HAUNT, "0:extraCost", "non-character cards in your discard pile and the opponent's discard characters do not count toward the 4", () => {
  const b = hauntBoard({ mineDiscard: 3, itemsDiscard: 3, foeDiscard: 4, res: bank("greed", 5) });
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } }), "3 own characters (+ items, + 5 opposing) is still cost 6");
  assert.equal(zoneOf(b.engine, b.id("he")), "hand");
});

clause(HAUNT, "0:extraCost", "5 or more characters in the discard pile still reduce by only 3", () => {
  const b = hauntBoard({ mineDiscard: 7, res: bank("greed", 3) });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } });
  assert.equal(before - ready(b.engine), 3);
});

clause(HAUNT, "0:extraCost", "the threshold [G] still applies with the reduced cost", () => {
  const b = hauntBoard({ mineDiscard: 4, res: volition(3) });
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } }), "3 volition, no [G]");
  assert.equal(zoneOf(b.engine, b.id("he")), "hand");
});

clause(HAUNT, "0:extraCost", "pick a character: any character in play (yours or the opponent's) can be picked", () => {
  const a = hauntBoard({ res: bank("greed", 6) });
  play(a.engine, P1, a.id("he"), { selected: { c: [a.id("mine")] } });
  assert.equal(zoneOf(a.engine, a.id("mine")), "discard", "your own character");
  const b = hauntBoard({ res: bank("greed", 6) });
  play(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the opponent's character");
});

clause(HAUNT, "0:extraCost", "the pick must be a character in play: items, locations, factions, face-down cards, hand and discard characters are refused", () => {
  const b = hauntBoard({ res: bank("greed", 6) });
  const attempt = (k: string) => () => playRaw(b.engine, P1, b.id("he"), { selected: { c: [k] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P2)), "a faction");
  refused(attempt(b.id("hidden")), "a face-down card is a resource");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("foeDead")), "a character in a discard pile");
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe"), b.id("mine")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("he")), "hand", "nothing was played");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "a character in play is accepted");
});

clause(HAUNT, "1:rule", "destroys the picked character (to its owner's discard pile) and only that one", () => {
  const b = hauntBoard({ res: bank("greed", 6) });
  play(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("foe")), "owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "your other character is untouched");
  assert.equal(zoneOf(b.engine, b.id("thing")), "play");
  assert.equal(zoneOf(b.engine, b.id("he")), "discard", "the tactic goes to the discard pile afterwards");
});

const RECUR_SEL = (b: ReturnType<typeof hauntBoard>) => ({ c: [b.id("dead0")] });

clause(HAUNT, "2:ability:recur", "from the discard pile: pays 2, removes itself from the game, and puts the picked character into your hand", () => {
  const b = hauntBoard({ zone: "discard", mineDiscard: 2, res: bank("greed", 2) });
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("he"), "recur", { selected: RECUR_SEL(b) });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 2, "Pay 2");
  assert.equal(zoneOf(b.engine, b.id("he")), "removed", "removed from the game");
  assert.equal(zoneOf(b.engine, b.id("dead0")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("dead0")), "handOf(b.engine, P1).includes(b.id(\"dead0\"))");
  assert.equal(zoneOf(b.engine, b.id("dead1")), "discard", "the other discarded character stays");
});

clause(HAUNT, "2:ability:recur", "Pay 2: one resource is refused, and threshold [G] is required", () => {
  const short = hauntBoard({ zone: "discard", mineDiscard: 1, res: bank("greed", 1) });
  refused(() => activateRaw(short.engine, P1, short.id("he"), "recur", RECUR_SEL(short)), "1 resource for Pay 2");
  assert.equal(zoneOf(short.engine, short.id("he")), "discard");
  const noIcon = hauntBoard({ zone: "discard", mineDiscard: 1, res: volition(3) });
  refused(() => activateRaw(noIcon.engine, P1, noIcon.id("he"), "recur", RECUR_SEL(noIcon)), "no [G]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("he")), "discard");
  const ok = hauntBoard({ zone: "discard", mineDiscard: 1, res: [...bank("greed", 1), ...volition(1)] });
  activate(ok.engine, P1, ok.id("he"), "recur", { selected: RECUR_SEL(ok) });
  assert.equal(zoneOf(ok.engine, ok.id("dead0")), "hand", "one [G] plus one more resource is enough");
});

clause(HAUNT, "2:ability:recur", "can only be used while the card is in your discard pile (not from hand or in play)", () => {
  const inHand = hauntBoard({ zone: "hand", mineDiscard: 1, res: bank("greed", 4) });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("he"), "recur", RECUR_SEL(inHand)), "in hand", /not found|zone|discard/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("dead0")), "discard");
  const ok = hauntBoard({ zone: "discard", mineDiscard: 1, res: bank("greed", 4) });
  activate(ok.engine, P1, ok.id("he"), "recur", { selected: RECUR_SEL(ok) });
  assert.equal(zoneOf(ok.engine, ok.id("dead0")), "hand");
});

clause(HAUNT, "2:ability:recur", "pick a character in YOUR discard pile: opponent's discard, play, hand and non-characters are refused", () => {
  const b = hauntBoard({ zone: "discard", mineDiscard: 1, res: bank("greed", 4) });
  const attempt = (k: string) => () => activateRaw(b.engine, P1, b.id("he"), "recur", { c: [k] });
  refused(attempt(b.id("foeDead")), "a character in the opponent's discard pile");
  refused(attempt(b.id("mine")), "a character in play");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("dItem")), "an item in your discard pile");
  refused(() => activateRaw(b.engine, P1, b.id("he"), "recur", { c: [] }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("he")), "discard", "refused attempts did not remove it");
  assert.equal(ready(b.engine), 4, "refused attempts cost nothing");
  activate(b.engine, P1, b.id("he"), "recur", { selected: { c: [b.id("dead0")] } });
  assert.equal(zoneOf(b.engine, b.id("dead0")), "hand");
});

clause(HAUNT, "2:ability:recur", "the card in the discard pile cannot be cast for its tactic effect from there", () => {
  const b = hauntBoard({ zone: "discard", res: bank("greed", 6) });
  refused(() => playRaw(b.engine, P1, b.id("he"), { selected: { c: [b.id("foe")] } }), "cast from the discard pile");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

// ===================================================================================
// Key to the City
// ===================================================================================

function keyBoard(o: { keyZone?: "hand" | "play"; res?: CardPlacement[]; hostOwner?: Pid; random?: () => number } = {}) {
  const inPlay = o.keyZone === "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "key", def: printing(KEY), owner: P1, zone: inPlay ? "play" : "hand", ...(inPlay ? { attachedToKey: "host" } : {}) },
      { key: "host", def: character({ name: "Host" }), owner: o.hostOwner ?? P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "rm", def: removalTactic("destroy"), owner: P1, zone: "hand" },
      { key: "bounce", def: removalTactic("bounce"), owner: P1, zone: "hand" },
      { key: "rmItem", def: removalTactic("destroy", "item"), owner: P1, zone: "hand" },
      { key: "rEl", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "deck" },
      { key: "rGr", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "deck" },
      { key: "rOb", def: resourceCard({ name: "Obsession", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "deck" },
      { key: "dChar", def: character({ name: "DeckChar" }), owner: P1, zone: "deck" },
      { key: "dItem", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
      { key: "foeRes", def: resourceCard({ name: "Deception", resource: { provides: ["deception"], staple: true } }), owner: P2, zone: "deck" },
      { key: "dscRes", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "discard" },
      ...(o.res ?? bank("greed", 3))
    ],
    turn: 2,
    ...(o.random ? { random: o.random } : {})
  });
}

clause(KEY, "0:attach", "printed cost 0, threshold [G], item gear: deploys attached to a character", () => {
  costChecks(KEY, 0, 1, (c) => c, (id) => ({ attachTo: [id("host")] }));
  const b = keyBoard();
  const sel = (k: string) => ({ attachTo: [b.id(k)] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("key"), { selected: sel("host") });
  assert.equal(zoneOf(b.engine, b.id("key")), "play");
  assert.equal(b.engine.state.cards[b.id("key")].attachedTo, b.id("host"));
  assert.equal(before - ready(b.engine), 0, "cost 0");
  assert.equal(printing(KEY).type, "item");
  assert.deepEqual([...printing(KEY).subtype!], ["gear"]);
  assert.equal(b.engine.state.cards[b.id("bystander")].attachedTo, undefined);
  const noIcon = keyBoard({ res: volition(5) });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("key"), { selected: { attachTo: [noIcon.id("host")] } }), "no [G]: threshold not met");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("key")), "hand");
});

clause(KEY, "0:attach", "attaches to an opponent's character too; is refused for items, locations, factions, hand and discard characters", () => {
  const b = keyBoard();
  const attempt = (k: string) => () => playRaw(b.engine, P1, b.id("key"), { selected: { attachTo: [k] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "a faction");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  refused(() => playRaw(b.engine, P1, b.id("key"), { selected: { attachTo: [] } }), "no host");
  assert.equal(zoneOf(b.engine, b.id("key")), "hand");
  const foe = keyBoard({ hostOwner: P2 });
  play(foe.engine, P1, foe.id("key"), { selected: { attachTo: [foe.id("host")] } });
  assert.equal(foe.engine.state.cards[foe.id("key")].attachedTo, foe.id("host"));
  assert.equal(foe.engine.state.cards[foe.id("key")].controllerId, P1);
});

const pickRes = (...ids: string[]) => (pc: { kind: string; [k: string]: unknown }) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);

clause(KEY, "1:rule", "when the attached character is destroyed you may search for a resource: it is revealed and put into your hand", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget", "you are asked");
  assert.equal(pc?.playerId, P1);
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
  assert.equal(zoneOf(b.engine, b.id("rGr")), "deck", "only the one resource is taken");
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("rEl")]);
  assert.equal(ev.viewerId, "all");
});

clause(KEY, "1:rule", "'a resource': the search finds ONE card, picking two resources is refused (control: one is accepted)", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  assert.equal((b.engine.state.pendingChoice as unknown as { kind: string }).kind, "chooserSelectsTarget", "the search is open");
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("rEl"), b.id("rOb")] } } as never),
    "two resources picked"
  );
  assert.equal(zoneOf(b.engine, b.id("rEl")), "deck", "nothing was taken by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("rOb")), "deck", "nothing was taken by the refused pick");
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand", "control: one resource is found");
  assert.equal(zoneOf(b.engine, b.id("rOb")), "deck", "the other stays");
});

clause(KEY, "1:rule", "'may': declining the search leaves every resource in the deck", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  assert.equal((b.engine.state.pendingChoice as unknown as { kind: string }).kind, "chooserSelectsTarget");
  drain(b.engine, pickRes());
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["rEl", "rGr", "rOb"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", k);
  assert.equal(handOf(b.engine, P1).filter((c) => [b.id("rEl"), b.id("rGr"), b.id("rOb")].includes(c)).length, 0);
});

clause(KEY, "1:rule", "only resources from your deck can be found: not characters, items, the opponent's deck, or your discard pile", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  const bad = (k: string) => () => {
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id(k)] } } as never);
    // a refusal must leave the question open
  };
  for (const k of ["dChar", "dItem", "foeRes", "dscRes"]) {
    let threw = false;
    try {
      bad(k)();
    } catch {
      threw = true;
    }
    const open = (b.engine.state.pendingChoice as unknown as { kind: string } | undefined)?.kind === "chooserSelectsTarget";
    assert.ok(threw || open, `${k} must not be accepted as the found resource`);
    assert.notEqual(zoneOf(b.engine, b.id(k)), "hand", `${k} did not go to hand`);
  }
  drain(b.engine, pickRes(b.id("rOb")));
  assert.equal(zoneOf(b.engine, b.id("rOb")), "hand");
});

clause(KEY, "1:rule", "the deck is shuffled afterwards", () => {
  const b = keyBoard({ keyZone: "play", random: () => 0 });
  const before = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  drain(b.engine, pickRes(b.id("rEl")));
  const unshuffled = before.filter((c) => c !== b.id("rEl"));
  assert.deepEqual([...b.engine.state.players[P1].deck].sort(), [...unshuffled].sort());
  assert.notDeepEqual(b.engine.state.players[P1].deck, unshuffled, "the order changed");
});

clause(KEY, "1:rule", "triggers when the attached character leaves play by any route (returned to hand)", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal((b.engine.state.pendingChoice as unknown as { kind: string } | undefined)?.kind, "chooserSelectsTarget");
  drain(b.engine, pickRes(b.id("rGr")));
  assert.equal(zoneOf(b.engine, b.id("rGr")), "hand");
});

clause(KEY, "1:rule", "does not trigger when a different character leaves play, or when the Key itself leaves", () => {
  const b = keyBoard({ keyZone: "play" });
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("bystander")] } });
  assert.equal(zoneOf(b.engine, b.id("bystander")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "bystander left, no search");
  play(b.engine, P1, b.id("rmItem"), { selected: { t: [b.id("key")] } });
  assert.equal(zoneOf(b.engine, b.id("key")), "discard");
  assert.equal(zoneOf(b.engine, b.id("host")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "the Key left, host still here, no search");
  assert.equal(zoneOf(b.engine, b.id("rEl")), "deck");
});

clause(KEY, "1:rule", "the Key's controller searches, even when the host is the opponent's character", () => {
  const b = keyBoard({ keyZone: "play", hostOwner: P2 });
  b.engine.state.cards[b.id("key")].controllerId = P1;
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("host")] } });
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foeRes")), "deck");
});

clause(KEY, "2:ability:unlock-potential", "from hand: discards itself, pays 2, searches for a resource, reveals it, puts it into your hand", () => {
  const b = keyBoard({ res: bank("greed", 2) });
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("key")), "discard", "discarded from hand");
  assert.equal(before - ready(b.engine), 2, "Pay 2");
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
  assert.equal(zoneOf(b.engine, b.id("rOb")), "deck");
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1);
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [b.id("rEl")]);
});

clause(KEY, "2:ability:unlock-potential", "the search may be failed (CR 312.2: it has specific criteria, a resource with a name you do not control), and a found resource goes to hand with the deck shuffled", () => {
  // W2.4 (SYS-35): this test used to assert the empty pick was refused; the search has criteria, so failing it is legal.
  const failed = keyBoard({ res: bank("greed", 2), random: () => 0 });
  activate(failed.engine, P1, failed.id("key"), "unlock-potential");
  failed.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  assert.equal(failed.engine.state.pendingChoice, undefined, "an empty pick ends the search");
  assert.equal(zoneOf(failed.engine, failed.id("rEl")), "deck", "nothing was found");
  const b = keyBoard({ res: bank("greed", 2), random: () => 0 });
  const before = [...b.engine.state.players[P1].deck];
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
  const unshuffled = before.filter((c) => c !== b.id("rEl"));
  assert.deepEqual([...b.engine.state.players[P1].deck].sort(), [...unshuffled].sort());
  assert.notDeepEqual(b.engine.state.players[P1].deck, unshuffled, "the order changed");
});

clause(KEY, "2:ability:unlock-potential", "'a resource': the search finds ONE card, picking two resources is refused (control: one is accepted)", () => {
  const b = keyBoard({ res: bank("greed", 2) });
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  assert.equal((b.engine.state.pendingChoice as unknown as { kind: string }).kind, "chooserSelectsTarget", "the search is open");
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("rEl"), b.id("rOb")] } } as never),
    "two resources picked"
  );
  assert.equal(zoneOf(b.engine, b.id("rEl")), "deck", "nothing was taken by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("rOb")), "deck", "nothing was taken by the refused pick");
  drain(b.engine, pickRes(b.id("rOb")));
  assert.equal(zoneOf(b.engine, b.id("rOb")), "hand", "control: one resource is found");
  assert.equal(zoneOf(b.engine, b.id("rEl")), "deck", "the other stays");
});

clause(KEY, "2:ability:unlock-potential", "a search that finds nothing still shuffles the deck (CR 312.1)", () => {
  const b = keyBoard({ res: bank("greed", 2), random: () => 0 });
  const before = [...b.engine.state.players[P1].deck];
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  assert.equal(b.engine.state.pendingChoice, undefined, "the empty pick ends the search");
  assert.equal(zoneOf(b.engine, b.id("rEl")), "deck", "nothing was found");
  assert.deepEqual([...b.engine.state.players[P1].deck].sort(), [...before].sort(), "same cards in the deck");
  assert.notDeepEqual(b.engine.state.players[P1].deck, before, "the deck was shuffled although nothing was found");
});

clause(KEY, "2:ability:unlock-potential", "needs 2 resources and threshold [G]; usable only from hand", () => {
  const short = keyBoard({ res: bank("greed", 1) });
  refused(() => activateRaw(short.engine, P1, short.id("key"), "unlock-potential"), "1 resource for Pay 2");
  assert.equal(zoneOf(short.engine, short.id("key")), "hand");
  const noIcon = keyBoard({ res: volition(3) });
  refused(() => activateRaw(noIcon.engine, P1, noIcon.id("key"), "unlock-potential"), "no [G]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("key")), "hand");
  const inPlay = keyBoard({ keyZone: "play", res: bank("greed", 3) });
  refused(() => activateRaw(inPlay.engine, P1, inPlay.id("key"), "unlock-potential"), "in play, not in hand", /not found|zone|hand/i);
  const ok = keyBoard({ res: [...bank("greed", 1), ...volition(1)] });
  activate(ok.engine, P1, ok.id("key"), "unlock-potential");
  drain(ok.engine, pickRes(ok.id("rEl")));
  assert.equal(zoneOf(ok.engine, ok.id("rEl")), "hand");
});

clause(KEY, "2:ability:unlock-potential", "the found resource must be a resource of your own deck (not characters, items, opponent's deck, discard); non-resources and other zones are not offered", () => {
  // The bank holds a resource named "Greed" that you control, so the deck's "Greed" is excluded.
  const b = keyBoard({ res: bank("greed", 2) });
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  const tryPick = (k: string): boolean => {
    try {
      b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id(k)] } } as never);
    } catch {
      return false;
    }
    return (b.engine.state.pendingChoice as unknown as { kind: string } | undefined)?.kind !== "chooserSelectsTarget";
  };
  assert.equal((b.engine.state.pendingChoice as unknown as { kind: string }).kind, "chooserSelectsTarget");
  for (const k of ["dChar", "dItem", "foeRes", "dscRes"]) {
    assert.equal(tryPick(k), false, `${k} cannot be found`);
    assert.notEqual(zoneOf(b.engine, b.id(k)), "hand", k);
  }
  assert.equal(tryPick("rEl"), true, "Elitism is a resource with a name you don't control");
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
});

clause(KEY, "2:ability:unlock-potential", "a resource of the same name controlled only by the OPPONENT is still findable", () => {
  const b = keyBoard({
    res: [...bank("greed", 2), { key: "oppGreed", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P2, zone: "play" }]
  });
  activate(b.engine, P1, b.id("key"), "unlock-potential");
  drain(b.engine, pickRes(b.id("rEl")));
  assert.equal(zoneOf(b.engine, b.id("rEl")), "hand");
});

clause(KEY, "2:ability:unlock-potential", "a resource whose name you already control (Greed in play) cannot be found; with no legal resource the search still costs and discards", () => {
  const deckless = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "key", def: printing(KEY), owner: P1, zone: "hand" },
      { key: "rGr", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "deck" },
      ...bank("greed", 2)
    ],
    turn: 2
  });
  const before = ready(deckless.engine);
  activate(deckless.engine, P1, deckless.id("key"), "unlock-potential");
  drain(deckless.engine, pickRes(deckless.id("rGr")));
  assert.equal(zoneOf(deckless.engine, deckless.id("rGr")), "deck", "the only resource shares a name you control");
  assert.equal(zoneOf(deckless.engine, deckless.id("key")), "discard");
  assert.equal(before - ready(deckless.engine), 2);
  assert.equal(deckless.engine.state.pendingChoice, undefined);
});

// ===================================================================================
// Kitten Mittons — When the attached character is inflicted damage your faction gains
// that much influence.
// ===================================================================================

function mittonsBoard(o: { hostOwner?: Pid; hostLife?: number; a?: number; b?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.a ?? 5 },
    playerB: { faction: developFaction(), influence: o.b ?? 5 },
    cards: [
      { key: "host", def: character({ name: "Host", life: o.hostLife ?? 10, strength: 3, speed: 2 }), owner: o.hostOwner ?? P1, zone: "play" },
      { key: "km", def: printing(MITTONS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "other", def: character({ name: "Other", life: 10 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 10, strength: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "h2", def: hitTactic(2), owner: P1, zone: "hand" },
      { key: "h3", def: hitTactic(3), owner: P1, zone: "hand" },
      { key: "h5", def: hitTactic(5), owner: P1, zone: "hand" },
      { key: "kmHand", def: printing(MITTONS), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("greed", 6)
    ],
    turn: 2
  });
}

clause(MITTONS, "0:attach", "printed cost 0, threshold [G][G][G][G], item gear; attaches to any character, refused for non-characters", () => {
  costChecks(MITTONS, 0, 4, (c) => c, (id) => ({ attachTo: [id("host")] }));
  const b = mittonsBoard();
  const sel = (k: string) => ({ attachTo: [b.id(k)] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("kmHand"), { selected: sel("mine") });
  assert.equal(b.engine.state.cards[b.id("kmHand")].attachedTo, b.id("mine"));
  assert.equal(before - ready(b.engine), 0, "cost 0");
  assert.equal(printing(MITTONS).type, "item");
  assert.deepEqual([...printing(MITTONS).subtype!], ["gear"]);
  const attempt = (k: string) => () => playRaw(b.engine, P1, b.id("km"), { selected: { attachTo: [k] } });
  // a second copy: use a fresh board for the refusal checks
  const c = mittonsBoard();
  const tryHost = (k: string) => () => playRaw(c.engine, P1, c.id("kmHand"), { selected: { attachTo: [k] } });
  refused(tryHost(factionOf(c.engine, P1)), "a faction");
  refused(tryHost(c.id("h2")), "a card in hand");
  refused(() => playRaw(c.engine, P1, c.id("kmHand"), { selected: { attachTo: [] } }), "no host");
  assert.equal(zoneOf(c.engine, c.id("kmHand")), "hand");
  tryHost(c.id("foe"))();
  assert.ok(c.engine.state.responseWindow, "an opponent's character is accepted");
  void attempt;
  const three = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "kmHand", def: printing(MITTONS), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...bank("greed", 3), ...volition(4)],
    turn: 2
  });
  refused(() => playRaw(three.engine, P1, three.id("kmHand"), { selected: { attachTo: [three.id("mine")] } }), "3 [G] is short of [G][G][G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(three.engine, three.id("kmHand")), "hand");
});

clause(MITTONS, "1:rule", "when the attached character is inflicted damage, its controller's faction gains that much (3 then 5)", () => {
  const b = mittonsBoard({ a: 5 });
  play(b.engine, P1, b.id("h3"), { selected: { t: [b.id("host")] } });
  assert.equal(inf(b.engine, P1), 8);
  play(b.engine, P1, b.id("h5"), { selected: { t: [b.id("host")] } });
  assert.equal(inf(b.engine, P1), 13, "each event gains again, by its own amount");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(inf(b.engine, P2), 5);
});

clause(MITTONS, "1:rule", "damage to a different character does not trigger it", () => {
  const b = mittonsBoard({ a: 5 });
  play(b.engine, P1, b.id("h3"), { selected: { t: [b.id("other")] } });
  assert.equal(inf(b.engine, P1), 5);
  play(b.engine, P1, b.id("h2"), { selected: { t: [b.id("foe")] } });
  assert.equal(inf(b.engine, P1), 5);
  assert.equal(inf(b.engine, P2), 5);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(MITTONS, "1:rule", "battle damage inflicted to the attached character counts (4 damage from a blocker)", () => {
  const b = mittonsBoard({ a: 5 });
  fightThrough(b.engine, P1, [b.id("host")], toFaction(P2), [b.id("foe")]);
  assert.equal(b.engine.state.cards[b.id("host")].damage, 4);
  assert.equal(inf(b.engine, P1), 9);
});

clause(MITTONS, "1:rule", "your faction gains: Mittons on an opponent's character pays its controller (you), not the host's owner", () => {
  const b = mittonsBoard({ hostOwner: P2, a: 5, b: 5 });
  b.engine.state.cards[b.id("km")].controllerId = P1;
  play(b.engine, P1, b.id("h3"), { selected: { t: [b.id("host")] } });
  assert.equal(inf(b.engine, P1), 8);
  assert.equal(inf(b.engine, P2), 5);
});

clause(MITTONS, "1:rule", "'that much': damage beyond the host's remaining life (5 damage to a 2-life host) still gains the full 5", () => {
  const b = mittonsBoard({ a: 5, hostLife: 2 });
  play(b.engine, P1, b.id("h5"), { selected: { t: [b.id("host")] } });
  assert.equal(inf(b.engine, P1), 10);
});

clause(MITTONS, "1:rule", "once the Mittons are gone the host's damage gains nothing", () => {
  const b = mittonsBoard({ a: 5 });
  b.engine.state.cards[b.id("km")].attachedTo = undefined;
  b.engine.state.cards[b.id("km")].zone = "discard";
  b.engine.state.players[P1].play = b.engine.state.players[P1].play.filter((c) => c !== b.id("km"));
  b.engine.state.players[P1].discard.push(b.id("km"));
  play(b.engine, P1, b.id("h3"), { selected: { t: [b.id("host")] } });
  assert.equal(inf(b.engine, P1), 5);
});

// ===================================================================================
// Padamose Cultists — When this card enters play, if you have deployed a non-character
// card this turn, draw 2 cards.
// ===================================================================================

function cultBoard(o: { extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pc", def: printing(CULTISTS), owner: P1, zone: "hand" },
      { key: "pc2", def: printing(CULTISTS), owner: P1, zone: "hand" },
      { key: "trinket", def: item({ name: "Trinket", cost: 0 }), owner: P1, zone: "hand" },
      { key: "spell", def: tactic({ name: "Spell", cost: 0 }), owner: P1, zone: "hand" },
      { key: "spot", def: location({ name: "Spot", cost: 0 }), owner: P1, zone: "hand" },
      { key: "buddy", def: character({ name: "Buddy", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foeTrinket", def: item({ name: "FoeTrinket", cost: 0 }), owner: P2, zone: "hand" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("greed", 6),
      ...(o.extra ?? [])
    ],
    turn: 2
  });
}

clause(CULTISTS, "0:rule", "printed cost 2, threshold [G], character cultist, 2 / 3 / 1", () => {
  costChecks(CULTISTS, 2, 1, (c) => c, () => ({}));
  const b = cultBoard();
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(b.engine.getStat(b.id("pc"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("pc"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("pc"), "life"), 1);
  assert.deepEqual([...printing(CULTISTS).subtype!], ["cultist"]);
  assert.equal(printing(CULTISTS).type, "character");
});

clause(CULTISTS, "0:rule", "draws nothing when no non-character card was deployed this turn", () => {
  const b = cultBoard();
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(zoneOf(b.engine, b.id("pc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, hand - 1);
});

for (const [what, key] of [["an item", "trinket"], ["a tactic", "spell"], ["a location", "spot"]] as const) {
  clause(CULTISTS, "0:rule", `draws exactly 2 cards after you deployed ${what} this turn`, () => {
    const b = cultBoard();
    play(b.engine, P1, b.id(key), {});
    const hand = handOf(b.engine, P1).length;
    const deck = b.engine.state.players[P1].deck.length;
    play(b.engine, P1, b.id("pc"), {});
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(handOf(b.engine, P1).length, hand - 1 + 2);
    assert.equal(b.engine.state.players[P1].deck.length, deck - 2);
    assert.equal(b.engine.state.players[P2].hand.length, 1, "the opponent drew nothing");
  });
}

clause(CULTISTS, "0:rule", "deploying only characters does not count (a Buddy first, then the Cultists)", () => {
  const b = cultBoard();
  play(b.engine, P1, b.id("buddy"), {});
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1);
});

clause(CULTISTS, "0:rule", "a non-character deployed AFTER the Cultists entered play does not draw retroactively", () => {
  const b = cultBoard();
  play(b.engine, P1, b.id("pc"), {});
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("trinket"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1);
});

clause(CULTISTS, "0:rule", "a second Cultists also draws 2 once a non-character was deployed (each is checked on its own entry)", () => {
  const b = cultBoard();
  play(b.engine, P1, b.id("pc"), {});
  play(b.engine, P1, b.id("trinket"), {});
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("pc2"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2);
});

clause(CULTISTS, "0:rule", "a non-character deployed on a previous turn does not count", () => {
  const b = cultBoard();
  play(b.engine, P1, b.id("trinket"), {});
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1, "no draw");
});

clause(CULTISTS, "0:rule", "a non-character the opponent deployed (on their turn) does not count as one YOU deployed", () => {
  const b = cultBoard();
  endTurn(b.engine, P1);
  play(b.engine, P2, b.id("foeTrinket"), {});
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1);
});

clause(CULTISTS, "0:rule", "playing a resource (develop) is not deploying a non-character card", () => {
  const b = cultBoard();
  const hand0 = handOf(b.engine, P1).length;
  engineDevelop(b.engine, b.id("res"));
  const hand = handOf(b.engine, P1).length;
  assert.equal(hand, hand0 - 1, "the resource left the hand");
  play(b.engine, P1, b.id("pc"), {});
  assert.equal(handOf(b.engine, P1).length, hand - 1, "no draw");
});

function engineDevelop(engine: SpoilsEngine, cardId: string) {
  developPlay(engine, P1, cardId, true);
}

// ===================================================================================
// Pandering Politician — PANDER: Deplete this character. Pick a character or item.
// Remove a token from the picked card.
// ===================================================================================

function panderBoard(o: { depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pp", def: printing(POLITICIAN), owner: P1, zone: "play", ...(o.depleted ? { depleted: true } : {}) },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", counters: { token: 3 } },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "bare", def: character({ name: "Bare" }), owner: P2, zone: "play" },
      { key: "multi", def: character({ name: "Multi" }), owner: P2, zone: "play", counters: { token: 2, wound: 4 } },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "spell", def: tactic({ name: "Spell" }), owner: P2, zone: "hand", counters: { token: 2 } },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand", counters: { token: 2 } },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard", counters: { token: 2 } }
    ],
    turn: 2
  });
}
const toks = (b: ReturnType<typeof panderBoard>, k: string) => b.engine.state.cards[b.id(k)].counters?.token ?? 0;

clause(POLITICIAN, "0:ability:pander", "printed cost 3, threshold [G][G], character mau politician, 1 / 3 / 3", () => {
  costChecks(POLITICIAN, 3, 2, (c) => c, () => ({}));
  const b = panderBoard();
  assert.equal(b.engine.getStat(b.id("pp"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("pp"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("pp"), "life"), 3);
  assert.equal(b.engine.getDefinition(b.id("pp")).type, "character", "a character card");
  assert.deepEqual([...printing(POLITICIAN).subtype!], ["mau", "politician"]);
});

clause(POLITICIAN, "0:ability:pander", "depletes the Politician (no resources) and removes exactly one token from an opponent's character", () => {
  const b = panderBoard();
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("pp"), "pander", { selected: { c: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("pp")].depleted, true, "COST: deplete");
  assert.equal(before, ready(b.engine), "no resources paid");
  assert.equal(toks(b, "foe"), 2, "3 -> 2");
  assert.equal(toks(b, "mine"), 1, "other cards keep their tokens");
  assert.equal(toks(b, "thing"), 2);
});

clause(POLITICIAN, "0:ability:pander", "can pick your own character, an item, and removes only 'token' counters", () => {
  const b = panderBoard();
  activate(b.engine, P1, b.id("pp"), "pander", { selected: { c: [b.id("thing")] } });
  assert.equal(toks(b, "thing"), 1, "an item");
  const c = panderBoard();
  activate(c.engine, P1, c.id("pp"), "pander", { selected: { c: [c.id("mine")] } });
  assert.equal(toks(c, "mine"), 0, "your own character");
  const d = panderBoard();
  activate(d.engine, P1, d.id("pp"), "pander", { selected: { c: [d.id("multi")] } });
  assert.equal(toks(d, "multi"), 1);
  assert.equal(d.engine.state.cards[d.id("multi")].counters?.wound, 4, "other counters untouched");
});

clause(POLITICIAN, "0:ability:pander", "the Politician itself may be picked", () => {
  const b = panderBoard();
  b.engine.state.cards[b.id("pp")].counters = { token: 2 };
  activate(b.engine, P1, b.id("pp"), "pander", { selected: { c: [b.id("pp")] } });
  assert.equal(toks(b, "pp"), 1);
  assert.equal(b.engine.state.cards[b.id("pp")].depleted, true);
});

clause(POLITICIAN, "0:ability:pander", "a card with no tokens: the ability resolves and nothing goes negative", () => {
  const b = panderBoard();
  activate(b.engine, P1, b.id("pp"), "pander", { selected: { c: [b.id("bare")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("pp")].depleted, true);
  assert.ok((b.engine.state.cards[b.id("bare")].counters?.token ?? 0) >= 0, "(b.engine.state.cards[b.id(\"bare\")].counters?.token ?? 0) >= 0");
  assert.equal(toks(b, "bare"), 0);
});

clause(POLITICIAN, "0:ability:pander", "cannot be used while depleted", () => {
  const b = panderBoard({ depleted: true });
  refused(() => activateRaw(b.engine, P1, b.id("pp"), "pander", { c: [b.id("foe")] }), "depleted");
  assert.equal(toks(b, "foe"), 3);
  const ok = panderBoard();
  activate(ok.engine, P1, ok.id("pp"), "pander", { selected: { c: [ok.id("foe")] } });
  assert.equal(toks(ok, "foe"), 2);
});

clause(POLITICIAN, "0:ability:pander", "a second use the same turn is refused (already depleted by the first)", () => {
  const b = panderBoard();
  activate(b.engine, P1, b.id("pp"), "pander", { selected: { c: [b.id("foe")] } });
  refused(() => activateRaw(b.engine, P1, b.id("pp"), "pander", { c: [b.id("foe")] }), "second use");
  assert.equal(toks(b, "foe"), 2);
});

clause(POLITICIAN, "0:ability:pander", "the pick must be a character or item: locations, factions, hand and discard cards are refused", () => {
  const b = panderBoard();
  const attempt = (k: string) => () => activateRaw(b.engine, P1, b.id("pp"), "pander", { c: [k] });
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P2)), "a faction");
  refused(attempt(b.id("spell")), "a tactic in hand");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  refused(() => activateRaw(b.engine, P1, b.id("pp"), "pander", { c: [] }), "no pick");
  refused(() => activateRaw(b.engine, P1, b.id("pp"), "pander", { c: [b.id("foe"), b.id("thing")] }), "two picks");
  assert.equal(b.engine.state.cards[b.id("pp")].depleted, false, "refusals did not deplete it");
  assert.equal(toks(b, "place"), 2);
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow || b.engine.state.cards[b.id("pp")].depleted, "a character is accepted");
});

// ===================================================================================
// PP&E — PAY OFF: Use this only in response to a character being deployed. Deplete this
// card. Pay 1. Destroy this card. Terminate the character.
// ===================================================================================

function ppeBoard(o: { ppeDepleted?: boolean; res?: number; deploy?: "guy" | "trinket" | "cultist"; foeDeploys?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ppe", def: printing(PPE), owner: P1, zone: "play", ...(o.ppeDepleted ? { depleted: true } : {}) },
      { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P2, zone: "hand" },
      { key: "trinket", def: item({ name: "Trinket", cost: 1 }), owner: P2, zone: "hand" },
      { key: "pre", def: item({ name: "Pre", cost: 0 }), owner: P2, zone: "hand" },
      { key: "cult", def: printing(CULTISTS), owner: P2, zone: "hand" },
      { key: "vet", def: character({ name: "Vet" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("greed", o.res ?? 3, P1),
      ...bank("greed", 5, P2)
    ],
    activePlayerId: P2,
    turn: 2
  });
}

clause(PPE, "0:ability:pay-off", "printed cost 2, threshold [G], location with structure 3", () => {
  costChecks(PPE, 2, 1, (c) => c, () => ({}));
  const b = ppeBoard();
  assert.equal(b.engine.getStat(b.id("ppe"), "structure"), 3);
  assert.equal(printing(PPE).type, "location");
});

clause(PPE, "0:ability:pay-off", "in response to a character being deployed: pays 1, depletes and destroys itself, terminates the character", () => {
  const b = ppeBoard();
  const mine = ready(b.engine, P1);
  const theirs = ready(b.engine, P2);
  playRaw(b.engine, P2, b.id("guy"), {});
  assert.equal(b.engine.state.cards[b.id("guy")].zone !== "play", true, "the character is still on the stack");
  activateRaw(b.engine, P1, b.id("ppe"), "pay-off");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("guy")), "discard", "terminated");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "discard", "Destroy this card");
  assert.equal(mine - ready(b.engine, P1), 1, "Pay 1");
  assert.equal(theirs - ready(b.engine, P2), 2, "the deploy cost stays paid");
  assert.equal(zoneOf(b.engine, b.id("vet")), "play", "other characters are untouched");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(PPE, "0:ability:pay-off", "'Pay 1': with no resources the ability is refused and the character deploys", () => {
  const b = ppeBoard({ res: 0 });
  playRaw(b.engine, P2, b.id("guy"), {});
  refused(() => activateRaw(b.engine, P1, b.id("ppe"), "pay-off"), "no resource for Pay 1");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("guy")), "play");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "play");
  const ok = ppeBoard({ res: 1 });
  playRaw(ok.engine, P2, ok.id("guy"), {});
  activateRaw(ok.engine, P1, ok.id("ppe"), "pay-off");
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("guy")), "discard", "exactly 1 resource is enough");
});

clause(PPE, "0:ability:pay-off", "'Deplete this card': a depleted PP&E cannot Pay Off", () => {
  const b = ppeBoard({ ppeDepleted: true });
  playRaw(b.engine, P2, b.id("guy"), {});
  refused(() => activateRaw(b.engine, P1, b.id("ppe"), "pay-off"), "depleted");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("guy")), "play");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "play");
});

clause(PPE, "0:ability:pay-off", "'only in response to a character being deployed': refused with nothing on the stack", () => {
  const b = ppeBoard();
  refused(() => activateRaw(b.engine, P1, b.id("ppe"), "pay-off"), "no deploy to respond to");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "play");
  assert.equal(zoneOf(b.engine, b.id("guy")), "hand");
});

clause(PPE, "0:ability:pay-off", "refused in response to a non-character being deployed (an item)", () => {
  const b = ppeBoard();
  playRaw(b.engine, P2, b.id("trinket"), {});
  refused(() => activateRaw(b.engine, P1, b.id("ppe"), "pay-off"), "responding to an item");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("trinket")), "play", "the item was not terminated");
  assert.equal(ready(b.engine, P1), 3, "nothing was paid");
});

clause(PPE, "0:ability:pay-off", "refused in response to an ability being activated (not a deploy)", () => {
  const b = ppeBoard();
  b.engine.state.cards[b.id("vet")].zone = "play";
  const cb = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ppe", def: printing(PPE), owner: P1, zone: "play" },
      {
        key: "ping",
        def: character({
          name: "Ping",
          behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
        } as Partial<CardDefinition>),
        owner: P2,
        zone: "play"
      },
      ...bank("greed", 3, P1)
    ],
    activePlayerId: P2,
    turn: 2
  });
  activateRaw(cb.engine, P2, cb.id("ping"), "ping");
  refused(() => activateRaw(cb.engine, P1, cb.id("ppe"), "pay-off"), "responding to an ability, not a deployed character");
  assert.equal(zoneOf(cb.engine, cb.id("ppe")), "play");
  assert.equal(zoneOf(cb.engine, cb.id("ping")), "play");
});

clause(PPE, "0:ability:pay-off", "terminated before it enters play: its enter-play trigger never happens (Padamose Cultists draws nothing)", () => {
  const b = ppeBoard();
  play(b.engine, P2, b.id("pre"), {});
  const hand = b.engine.state.players[P2].hand.length;
  playRaw(b.engine, P2, b.id("cult"), {});
  activateRaw(b.engine, P1, b.id("ppe"), "pay-off");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("cult")), "discard");
  assert.equal(b.engine.state.players[P2].hand.length, hand - 1, "Cultists left the hand and nothing was drawn");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(PPE, "0:ability:pay-off", "also works against a character deployed by its own controller's opponent turn flip: P2's PP&E answers P1's deploy", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ppe", def: printing(PPE), owner: P2, zone: "play" },
      { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1),
      ...bank("greed", 3, P2)
    ],
    turn: 2
  });
  playRaw(b.engine, P1, b.id("guy"), {});
  activateRaw(b.engine, P2, b.id("ppe"), "pay-off");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("guy")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ppe")), "discard");
});
