// Clause tests — batch holy-heist-08, part p1 (groups 1-4: Everlasting Blade of Light,
// Fire Tail Kamikaze, Fire Tail Kocktail, Horns of Thabbash). Expectations come from the
// PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
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
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { declareBlockers, pending, zoneOf } from "./_board.js";
import { factionOf } from "./_turn.js";
import type { CardDefinition } from "../../../engine.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
type Eng = ReturnType<typeof buildGame>["engine"];
type Pc = Parameters<typeof declineAll>[0];

const BLADE = "f83fd73a-13b6-46b8-a933-a46db57df8f7"; // Everlasting Blade of Light
const KAMIKAZE = "6ca40ab8-482e-4340-80f1-5c63fba1f8fd"; // Fire Tail Kamikaze
const KOCKTAIL = "6261ae53-c180-4ae6-8027-c2ad3ab8ebea"; // Fire Tail Kocktail
const HORNS = "7e5943c6-1683-4ba0-a762-e0ac3dbdd6b8"; // Horns of Thabbash

const ready = (engine: Eng, player: string = P1) => engine.getAvailableResourceCount(player);
const dmg = (engine: Eng, cardId: string) => engine.state.cards[cardId].damage ?? 0;
const infl = (engine: Eng, player: string) => engine.state.players[player].influence;
const keepUnique = (engine: Eng, player: string, keep: string) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep } } as never);
  resolvePendingResponses(engine);
};
const mover = (to: "hand" | "discard"): CardDefinition =>
  tactic({
    name: "Mover",
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }] }] }
  } as Partial<CardDefinition>);
const burn3 = (): CardDefinition =>
  tactic({
    name: "Burn3",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] }
  } as Partial<CardDefinition>);
const itemKill = (): CardDefinition =>
  tactic({
    name: "ItemKill",
    cost: 0,
    behavior: { abilities: [{ id: "ik", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as Partial<CardDefinition>);

// ───────────────────────── Everlasting Blade of Light ─────────────────────────

const DRACO = "Vexillarius Dacian-Draco";
function bladeBoard(opts: { extra?: Cards; attachedTo?: string; rage?: number; turn?: number; active?: string } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ebol", def: printing(BLADE), owner: P1, zone: "play", ...(opts.attachedTo ? { attachedToKey: opts.attachedTo } : {}) },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "rud", def: character({ name: "Rudolphus", unique: "rudolphus", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "rud2", def: character({ name: "Rudolphus Two", unique: "rudolphus", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "oth", def: character({ name: "OtherUnique", unique: "dacian", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}
const equip = (b: ReturnType<typeof bladeBoard>, hostKey: string) => activate(b.engine, P1, b.id("ebol"), "ebol-equip", { selected: { c: [b.id(hostKey)] } });

clause(BLADE, "0:unique", "deploying a second UNIQUE BLADE OF LIGHT while controlling one makes me choose: keeping the old one destroys the new one", () => {
  const b = bladeBoard({ rage: 5, extra: [{ key: "ebol2", def: printing(BLADE), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] });
  play(b.engine, P1, b.id("ebol2"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("ebol"), b.id("ebol2")].sort());
  keepUnique(b.engine, P1, b.id("ebol"));
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(zoneOf(b.engine, b.id("ebol2")), "discard");
});

clause(BLADE, "0:unique", "keeping the new copy destroys the old one", () => {
  const b = bladeBoard({ rage: 5, extra: [{ key: "ebol2", def: printing(BLADE), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] });
  play(b.engine, P1, b.id("ebol2"));
  keepUnique(b.engine, P1, b.id("ebol2"));
  assert.equal(zoneOf(b.engine, b.id("ebol2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "discard");
});

clause(BLADE, "0:unique", "the designation is BLADE OF LIGHT: another card carrying it conflicts too", () => {
  const b = bladeBoard({ extra: [{ key: "other", def: character({ name: "Other Bladebearer", unique: "blade of light", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
});

clause(BLADE, "0:unique", "a card with a different UNIQUE designation does not conflict", () => {
  const b = bladeBoard({ extra: [{ key: "other", def: character({ name: "Other Unique", unique: "something else", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
});

clause(BLADE, "0:unique", "only my own copies count: the opponent may control their own Blade with no choice", () => {
  const b = bladeBoard({ turn: 2, active: P2, extra: [{ key: "ebolB", def: printing(BLADE), owner: P2, zone: "hand" }, ...bank("rage", 5, P2)] });
  play(b.engine, P2, b.id("ebolB"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ebolB")), "play");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
});

clause(BLADE, "1:rule", "the attached character gains exactly +3 strength and +3 life (2/2 becomes 5/5, speed unchanged)", () => {
  const b = bladeBoard({ attachedTo: "host" });
  assert.deepEqual([b.engine.getStat(b.id("host"), "strength"), b.engine.getStat(b.id("host"), "life"), b.engine.getStat(b.id("host"), "speed")], [5, 5, 2]);
});

clause(BLADE, "1:rule", "the extra life is real: the host survives damage up to its new life", () => {
  const b = bladeBoard({ attachedTo: "host" });
  b.engine.state.cards[b.id("host")].damage = 4;
  assert.equal(b.engine.getStat(b.id("host"), "life"), 5);
  assert.equal(zoneOf(b.engine, b.id("host")), "play");
});

clause(BLADE, "1:rule", "no other character is affected (not a second own character, not an opponent's, not the Blade itself)", () => {
  const b = bladeBoard({ attachedTo: "host" });
  assert.deepEqual([b.engine.getStat(b.id("host2"), "strength"), b.engine.getStat(b.id("host2"), "life")], [1, 1]);
  assert.deepEqual([b.engine.getStat(b.id("foe"), "strength"), b.engine.getStat(b.id("foe"), "life")], [2, 2]);
});

clause(BLADE, "1:rule", "an unattached Blade grants nothing", () => {
  const b = bladeBoard();
  for (const k of ["host", "host2", "rud", "foe"]) {
    assert.notEqual(b.engine.getStat(b.id(k), "strength"), 5);
  }
  assert.deepEqual([b.engine.getStat(b.id("host"), "strength"), b.engine.getStat(b.id("host"), "life")], [2, 2]);
});

clause(BLADE, "1:rule", "attached to an opponent's character it buffs that character (the attached character, whoever controls it)", () => {
  const b = bladeBoard({ attachedTo: "foe" });
  assert.deepEqual([b.engine.getStat(b.id("foe"), "strength"), b.engine.getStat(b.id("foe"), "life")], [5, 5]);
  assert.deepEqual([b.engine.getStat(b.id("host"), "strength"), b.engine.getStat(b.id("host"), "life")], [2, 2]);
});

clause(BLADE, "1:rule", "the buff goes away when the Blade is destroyed", () => {
  const b = bladeBoard({ attachedTo: "host", extra: [{ key: "ik", def: itemKill(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("ebol")] } });
  assert.equal(zoneOf(b.engine, b.id("ebol")), "discard");
  assert.deepEqual([b.engine.getStat(b.id("host"), "strength"), b.engine.getStat(b.id("host"), "life")], [2, 2]);
});

clause(BLADE, "2:rule", "when the attached character is destroyed the Blade stays in play, unattached and granting nothing", () => {
  const b = bladeBoard({ attachedTo: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
  assert.equal(b.engine.state.cards[b.id("ebol")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("host2"), "strength"), 1);
});

clause(BLADE, "2:rule", "the same when the attached character is returned to its owner's hand", () => {
  const b = bladeBoard({ attachedTo: "host", extra: [{ key: "mv", def: mover("hand"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("mv"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
});

clause(BLADE, "2:rule", "the same when the attached character is moved to the discard pile by another effect", () => {
  const b = bladeBoard({ attachedTo: "host", extra: [{ key: "mv", def: mover("discard"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("mv"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
});

clause(BLADE, "2:rule", "the same when the attached character dies in battle; the Blade can then be re-equipped", () => {
  const b = bladeBoard({
    attachedTo: "foe",
    extra: [{ key: "big", def: character({ name: "Big", strength: 9, life: 9, speed: 1 }), owner: P1, zone: "play" }]
  });
  // the foe (P2) is blocked and killed by "big"; the Blade (still P1's) stays
  fightThrough(b.engine, P1, [b.id("big")], { type: "faction", playerId: P2 }, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "Foe 5/5 takes 9 and dies");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
  equip(b, "host");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host"));
});

clause(BLADE, "2:rule", "a Blade attached to a different character is not moved by an unrelated character leaving play", () => {
  const b = bladeBoard({ attachedTo: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host2")] } });
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host"));
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 5);
});

clause(BLADE, "3:ability:ebol-equip", "pick a non-Rudolphus character: X is 2, I pay 2 and the Blade attaches to it", () => {
  const b = bladeBoard();
  const before = ready(b.engine);
  equip(b, "host");
  assert.equal(before - ready(b.engine), 2, "COST: pay X = 2");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host"));
  assert.equal(b.engine.state.cards[b.id("host2")].attachedTo, undefined);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 5);
});

clause(BLADE, "3:ability:ebol-equip", "pick a UNIQUE RUDOLPHUS: X is 0, so it costs nothing and works with no resources at all", () => {
  const b = bladeBoard({ rage: 0 });
  assert.equal(ready(b.engine), 0);
  equip(b, "rud");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("rud"));
});

clause(BLADE, "3:ability:ebol-equip", "a Rudolphus keeps the other resources untouched (pays exactly 0)", () => {
  const b = bladeBoard();
  const before = ready(b.engine);
  equip(b, "rud");
  assert.equal(before - ready(b.engine), 0);
});

clause(BLADE, "3:ability:ebol-equip", "the Rudolphus discount reads the picked character, whoever controls it (an opponent's Rudolphus is X = 0)", () => {
  const b = bladeBoard({ rage: 0 });
  equip(b, "rud2");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("rud2"));
  assert.equal(b.engine.state.cards[b.id("ebol")].controllerId, P1, "I still control the Blade");
});

clause(BLADE, "3:ability:ebol-equip", "a character with another UNIQUE designation gets no discount: X is 2", () => {
  const b = bladeBoard();
  const before = ready(b.engine);
  equip(b, "oth");
  assert.equal(before - ready(b.engine), 2);
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("oth"));
});

clause(BLADE, "3:ability:ebol-equip", "a non-unique character named like Rudolphus gets no discount", () => {
  const b = bladeBoard({ rage: 1, extra: [{ key: "fake", def: character({ name: "Rudolphus" }), owner: P1, zone: "play" }] });
  refused(() => equip(b, "fake"), "not unique Rudolphus: X = 2 and I have 1");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
});

clause(BLADE, "3:ability:ebol-equip", "with only 1 resource a non-Rudolphus pick is refused (X is 2); a Rudolphus pick is accepted with the same resources", () => {
  const b = bladeBoard({ rage: 1 });
  refused(() => equip(b, "host"), "cannot pay 2");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
  assert.equal(ready(b.engine), 1, "nothing was paid");
  equip(b, "rud");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("rud"));
});

clause(BLADE, "3:ability:ebol-equip", "with exactly 2 resources a non-Rudolphus pick works", () => {
  const b = bladeBoard({ rage: 2 });
  equip(b, "host");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host"));
  assert.equal(ready(b.engine), 0);
});

clause(BLADE, "3:ability:ebol-equip", "can pick an opponent's character, and the Blade stays mine", () => {
  const b = bladeBoard();
  equip(b, "foe");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("ebol")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 5);
});

clause(BLADE, "3:ability:ebol-equip", "only a character in play can be picked: an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const attempt = (key: string | "f1" | "f2") => {
    const b = bladeBoard();
    const target = key === "f1" ? factionOf(b.engine, P1) : key === "f2" ? factionOf(b.engine, P2) : b.id(key);
    return () => activate(b.engine, P1, b.id("ebol"), "ebol-equip", { selected: { c: [target] } });
  };
  refused(attempt("thing"), "an item");
  refused(attempt("place"), "a location");
  refused(attempt("f1"), "my faction");
  refused(attempt("f2"), "the opponent's faction");
  refused(attempt("hidden"), "a face-down card is a resource");
  refused(attempt("inHand"), "a character in hand");
  attempt("host")();
});

clause(BLADE, "3:ability:ebol-equip", "it needs exactly one pick: no pick is refused", () => {
  const b = bladeBoard();
  refused(() => activate(b.engine, P1, b.id("ebol"), "ebol-equip", { selected: { c: [] } }), "no character picked");
  equip(b, "host");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host"));
});

clause(BLADE, "3:ability:ebol-equip", "an already attached Blade moves to the newly picked character", () => {
  const b = bladeBoard({ attachedTo: "host" });
  equip(b, "host2");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, b.id("host2"));
  assert.deepEqual([b.engine.getStat(b.id("host"), "strength"), b.engine.getStat(b.id("host2"), "strength")], [2, 4]);
});

clause(BLADE, "3:ability:ebol-equip", "'if you can': if the picked character leaves play in response, the cost stays paid, nothing attaches and nothing breaks", () => {
  const b = bladeBoard({ extra: [{ key: "k", def: killTactic(), owner: P2, zone: "hand" }] });
  const before = ready(b.engine);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("ebol"), abilityId: "ebol-equip", selected: { c: [b.id("host")] }, variables: {} } as never);
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("k"), selected: { t: [b.id("host")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("host")), "discard", "the response killed the host");
  assert.equal(before - ready(b.engine), 2, "the cost was already paid");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(b.engine.state.cards[b.id("ebol")].attachedTo, undefined);
});

function fusionBoard(opts: { attachedTo?: string | null; rage?: number; deck?: Cards } = {}) {
  const attachedTo = opts.attachedTo === undefined ? "rud" : opts.attachedTo;
  return bladeBoard({
    attachedTo: attachedTo ?? undefined,
    rage: opts.rage ?? 3,
    extra: [
      { key: "draco", def: character({ name: DRACO, strength: 6, life: 6, speed: 3 }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
      { key: "d4", def: character({ name: "D4" }), owner: P1, zone: "deck" },
      { key: "d5", def: character({ name: "D5" }), owner: P1, zone: "deck" },
      ...(opts.deck ?? [])
    ]
  });
}
const fuse = (b: ReturnType<typeof bladeBoard>, pick: string[] = ["draco"]) => activate(b.engine, P1, b.id("ebol"), "ebol-fusion", { selected: { tut: pick.map(k => b.id(k)) } });

clause(BLADE, "4:ability:ebol-fusion", "attached to a UNIQUE RUDOLPHUS: pay 1, destroy the Blade, and Vexillarius Dacian-Draco comes from my deck into play under my control", () => {
  const b = fusionBoard();
  const before = ready(b.engine);
  fuse(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1, "COST: pay exactly 1");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "discard", "COST: the Blade is destroyed");
  assert.equal(zoneOf(b.engine, b.id("draco")), "play");
  assert.equal(b.engine.state.cards[b.id("draco")].controllerId, P1);
  assert.equal(b.engine.state.players[P1].deck.includes(b.id("draco")), false, "it left the deck");
  assert.equal(zoneOf(b.engine, b.id("rud")), "play", "the Rudolphus itself stays");
  for (const k of ["d1", "d2", "d3", "d4", "d5"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", `${k} stays in the deck`);
});

clause(BLADE, "4:ability:ebol-fusion", "the Draco enters play as a normal character (printed 6/6/3) and the Rudolphus loses the Blade's buff", () => {
  const b = fusionBoard();
  assert.equal(b.engine.getStat(b.id("rud"), "strength"), 5);
  fuse(b);
  assert.deepEqual([b.engine.getStat(b.id("draco"), "strength"), b.engine.getStat(b.id("draco"), "life")], [6, 6]);
  assert.equal(b.engine.getStat(b.id("rud"), "strength"), 2, "the Blade is destroyed, so the buff is gone");
});

clause(BLADE, "4:ability:ebol-fusion", "usable with just 1 resource", () => {
  const b = fusionBoard({ rage: 1 });
  fuse(b);
  assert.equal(zoneOf(b.engine, b.id("draco")), "play");
  assert.equal(ready(b.engine), 0);
});

clause(BLADE, "4:ability:ebol-fusion", "refused with no resources to pay 1; nothing is destroyed or searched", () => {
  const b = fusionBoard({ rage: 0 });
  refused(() => fuse(b), "cannot pay 1");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
  assert.equal(zoneOf(b.engine, b.id("draco")), "deck");
});

clause(BLADE, "4:ability:ebol-fusion", "use only if attached to a UNIQUE RUDOLPHUS: refused when attached to another character, accepted with the same board on a Rudolphus", () => {
  const bad = fusionBoard({ attachedTo: "host" });
  refused(() => fuse(bad), "attached to a non-Rudolphus");
  assert.equal(zoneOf(bad.engine, bad.id("ebol")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("draco")), "deck");
  const good = fusionBoard({ attachedTo: "rud" });
  fuse(good);
  assert.equal(zoneOf(good.engine, good.id("draco")), "play");
});

clause(BLADE, "4:ability:ebol-fusion", "refused when attached to a character with another UNIQUE designation, or a non-unique one named Rudolphus", () => {
  const other = fusionBoard({ attachedTo: "oth" });
  refused(() => fuse(other), "unique but not Rudolphus");
  const fake = fusionBoard({ attachedTo: "fake", deck: [{ key: "fake", def: character({ name: "Rudolphus" }), owner: P1, zone: "play" }] });
  refused(() => fuse(fake), "named Rudolphus but not unique");
  assert.equal(zoneOf(other.engine, other.id("ebol")), "play");
  assert.equal(zoneOf(fake.engine, fake.id("ebol")), "play");
});

clause(BLADE, "4:ability:ebol-fusion", "refused while the Blade is not attached to anything", () => {
  const b = fusionBoard({ attachedTo: null });
  refused(() => fuse(b), "unattached");
  assert.equal(zoneOf(b.engine, b.id("ebol")), "play");
});

clause(BLADE, "4:ability:ebol-fusion", "works when attached to an opponent's UNIQUE RUDOLPHUS too (the text only asks that it is attached to one)", () => {
  const b = fusionBoard({ attachedTo: "rud2" });
  fuse(b);
  assert.equal(zoneOf(b.engine, b.id("draco")), "play");
  assert.equal(b.engine.state.cards[b.id("draco")].controllerId, P1);
});

clause(BLADE, "4:ability:ebol-fusion", "only a card named exactly Vexillarius Dacian-Draco can be picked: a similar name, a Draco in my hand/discard and the opponent's Draco are refused", () => {
  const ctrl = fusionBoard();
  fuse(ctrl);
  const near = fusionBoard({ deck: [{ key: "near", def: character({ name: "Vexillarius Dacian" }), owner: P1, zone: "deck" }] });
  refused(() => fuse(near, ["near"]), "different name");
  const hand = fusionBoard({ deck: [{ key: "dh", def: character({ name: DRACO }), owner: P1, zone: "hand" }] });
  refused(() => fuse(hand, ["dh"]), "in hand, not deck");
  const disc = fusionBoard({ deck: [{ key: "dd", def: character({ name: DRACO }), owner: P1, zone: "discard" }] });
  refused(() => fuse(disc, ["dd"]), "in discard, not deck");
  const foe = fusionBoard({ deck: [{ key: "df", def: character({ name: DRACO }), owner: P2, zone: "deck" }] });
  refused(() => fuse(foe, ["df"]), "opponent's deck");
  const filler = fusionBoard();
  refused(() => fuse(filler, ["d1"]), "a differently named card from my deck");
});

clause(BLADE, "4:ability:ebol-fusion", "with two Dracos in my deck exactly one comes into play", () => {
  const b = fusionBoard({ deck: [{ key: "draco2", def: character({ name: DRACO }), owner: P1, zone: "deck" }] });
  fuse(b);
  const inPlay = ["draco", "draco2"].filter(k => zoneOf(b.engine, b.id(k)) === "play");
  assert.equal(inPlay.length, 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BLADE, "4:ability:ebol-fusion", "a search may find nothing: with no Draco in my deck the cost is still paid and the Blade destroyed", () => {
  const b = fusionBoard();
  b.engine.state.players[P1].deck = b.engine.state.players[P1].deck.filter(c => c !== b.id("draco"));
  b.engine.state.cards[b.id("draco")].zone = "discard";
  const before = ready(b.engine);
  fuse(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1);
  assert.equal(zoneOf(b.engine, b.id("ebol")), "discard");
  assert.equal(zoneOf(b.engine, b.id("draco")), "discard", "the discard-pile Draco is not fetched");
});

clause(BLADE, "4:ability:ebol-fusion", "the search may decline to find a Draco that is in the deck (search is optional to find)", () => {
  const b = fusionBoard();
  fuse(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ebol")), "discard");
  assert.equal(zoneOf(b.engine, b.id("draco")), "deck");
});

clause(BLADE, "4:ability:ebol-fusion", "searching my deck shuffles it afterwards (CR 312.1)", () => {
  const ids = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"];
  const b = fusionBoard({ deck: ids.slice(5).map(k => ({ key: k, def: character({ name: k.toUpperCase() }), owner: P1, zone: "deck" as const })) });
  const before = b.engine.state.players[P1].deck.filter(c => c !== b.id("draco"));
  fuse(b);
  const after = [...b.engine.state.players[P1].deck];
  assert.equal(after.length, before.length);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the remaining deck order changed");
});

clause(BLADE, "4:ability:ebol-fusion", "a failed search still shuffles my deck", () => {
  const ids = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"];
  const b = fusionBoard({ deck: ids.slice(5).map(k => ({ key: k, def: character({ name: k.toUpperCase() }), owner: P1, zone: "deck" as const })) });
  const before = [...b.engine.state.players[P1].deck];
  fuse(b, []);
  const after = [...b.engine.state.players[P1].deck];
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the deck order changed");
});

// ───────────────────────── Fire Tail Kamikaze ─────────────────────────

function ftkBoard(opts: { inPlay?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ftk", def: printing(KAMIKAZE), owner: P1, zone: opts.inPlay ? "play" : "hand" },
      { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "small", def: character({ name: "Small", life: 3, strength: 1 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 8 } as Partial<CardDefinition>), owner: P2, zone: "play" },
      { key: "myplace", def: location({ name: "MyPlace", structure: 8 } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 5 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", life: 5 }), owner: P2, zone: "hand" },
      { key: "k", def: killTactic(), owner: P1, zone: "hand" },
      { key: "burn", def: burn3(), owner: P1, zone: "hand" },
      ...bank("rage", 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}
const pickT = (pick: string | null, slot = "t") => (pc: Pc) =>
  (pc as unknown as { kind: string }).kind === "selectTargets" ? { kind: "selectTargets", selected: { [slot]: pick ? [pick] : [] } } : declineAll(pc);

clause(KAMIKAZE, "0:rule", "entering play: I pick an opponent's character and it takes exactly 3 damage", () => {
  const b = ftkBoard();
  play(b.engine, P1, b.id("ftk"));
  drain(b.engine, pickT(b.id("oc")));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ftk")), "play");
  assert.equal(dmg(b.engine, b.id("oc")), 3);
  assert.equal(dmg(b.engine, b.id("mine")), 0);
  assert.equal(dmg(b.engine, b.id("small")), 0);
});

clause(KAMIKAZE, "0:rule", "the character picked may be my own", () => {
  const b = ftkBoard();
  play(b.engine, P1, b.id("ftk"));
  drain(b.engine, pickT(b.id("mine")));
  assert.equal(dmg(b.engine, b.id("mine")), 3);
  assert.equal(dmg(b.engine, b.id("oc")), 0);
});

clause(KAMIKAZE, "0:rule", "3 damage kills a 3-life character", () => {
  const b = ftkBoard();
  play(b.engine, P1, b.id("ftk"));
  drain(b.engine, pickT(b.id("small")));
  assert.equal(zoneOf(b.engine, b.id("small")), "discard");
});

clause(KAMIKAZE, "0:rule", "'may': declining the pick (and so the 'if you do') inflicts no damage to anything", () => {
  const b = ftkBoard();
  play(b.engine, P1, b.id("ftk"));
  drain(b.engine, pickT(null));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ftk")), "play");
  for (const k of ["oc", "mine", "small", "ftk"]) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} undamaged`);
});

clause(KAMIKAZE, "0:rule", "only characters can be picked: locations, items, factions, face-down cards and cards in hand are refused", () => {
  const attempt = (key: string) => {
    const b = ftkBoard();
    play(b.engine, P1, b.id("ftk"));
    const target = key === "f1" ? factionOf(b.engine, P1) : key === "f2" ? factionOf(b.engine, P2) : b.id(key);
    return () => drain(b.engine, pickT(target));
  };
  refused(attempt("place"), "an opponent's location");
  refused(attempt("myplace"), "my location");
  refused(attempt("thing"), "an item");
  refused(attempt("f1"), "my faction");
  refused(attempt("f2"), "the opponent's faction");
  refused(attempt("hidden"), "a face-down card is a resource");
  refused(attempt("inHand"), "a character in hand");
  const ok = ftkBoard();
  play(ok.engine, P1, ok.id("ftk"));
  drain(ok.engine, pickT(ok.id("oc")));
  assert.equal(dmg(ok.engine, ok.id("oc")), 3);
});

clause(KAMIKAZE, "0:rule", "the Kamikaze itself is a character in play when the trigger resolves, so it can be picked (literal reading); it takes 3 and dies (life 3)", () => {
  const b = ftkBoard();
  play(b.engine, P1, b.id("ftk"));
  let n = 0;
  drain(b.engine, pc => ((pc as unknown as { kind: string }).kind === "selectTargets" && n++ === 0 ? { kind: "selectTargets", selected: { t: [b.id("ftk")] } } : pickT(null, "d")(pc)));
  assert.equal(zoneOf(b.engine, b.id("ftk")), "discard");
});

clause(KAMIKAZE, "0:rule", "another character entering play does not trigger it", () => {
  const b = ftkBoard({ inPlay: true, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("newbie"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["oc", "mine", "small", "newbie"]) assert.equal(dmg(b.engine, b.id(k)), 0);
});

clause(KAMIKAZE, "0:rule", "the trigger needs the Kamikaze to be deployed: with it only in my hand nothing else happens (deploy costs 6 and pays it)", () => {
  const b = ftkBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("ftk"));
  drain(b.engine, pickT(null));
  assert.equal(before - ready(b.engine), 6);
  assert.deepEqual([b.engine.getStat(b.id("ftk"), "strength"), b.engine.getStat(b.id("ftk"), "life"), b.engine.getStat(b.id("ftk"), "speed")], [4, 3, 3]);
});

clause(KAMIKAZE, "0:rule", "deploying needs cost 6 and threshold [R][R][R]: 5 resources, or 6 resources with only two Rage icons, are refused", () => {
  const mk = (rage: number, vol: number) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ftk", def: printing(KAMIKAZE), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...volition(vol, P1)] });
  const five = mk(5, 0);
  refused(() => play(five.engine, P1, five.id("ftk")), "one short of 6");
  const twoIcons = mk(2, 4);
  refused(() => play(twoIcons.engine, P1, twoIcons.id("ftk")), "only [R][R]");
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("ftk")), "hand");
  const ok = mk(3, 3);
  play(ok.engine, P1, ok.id("ftk"));
  assert.equal(zoneOf(ok.engine, ok.id("ftk")), "play");
});

clause(KAMIKAZE, "1:rule", "destroyed: I pick the opponent's faction and it takes exactly 3 damage", () => {
  const b = ftkBoard({ inPlay: true });
  const [i1, i2] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("ftk")] } });
  drain(b.engine, pickT(factionOf(b.engine, P2), "d"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ftk")), "discard");
  assert.equal(i2 - infl(b.engine, P2), 3, "damage to a faction is influence loss (CR 408.3)");
  assert.equal(i1 - infl(b.engine, P1), 0);
});

clause(KAMIKAZE, "1:rule", "destroyed: I may pick my own faction", () => {
  const b = ftkBoard({ inPlay: true });
  const [i1, i2] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("ftk")] } });
  drain(b.engine, pickT(factionOf(b.engine, P1), "d"));
  assert.equal(i1 - infl(b.engine, P1), 3);
  assert.equal(i2 - infl(b.engine, P2), 0);
});

clause(KAMIKAZE, "1:rule", "destroyed: I pick a location (the opponent's, or my own) and it takes exactly 3 damage", () => {
  const b = ftkBoard({ inPlay: true });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("ftk")] } });
  drain(b.engine, pickT(b.id("place"), "d"));
  assert.equal(dmg(b.engine, b.id("place")), 3);
  assert.equal(dmg(b.engine, b.id("myplace")), 0);
  const c = ftkBoard({ inPlay: true });
  play(c.engine, P1, c.id("k"), { selected: { t: [c.id("ftk")] } });
  drain(c.engine, pickT(c.id("myplace"), "d"));
  assert.equal(dmg(c.engine, c.id("myplace")), 3);
  assert.equal(dmg(c.engine, c.id("place")), 0);
});

clause(KAMIKAZE, "1:rule", "destroyed: 'may' — declining inflicts no damage to any faction or location", () => {
  const b = ftkBoard({ inPlay: true });
  const [i1, i2] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("ftk")] } });
  drain(b.engine, pickT(null, "d"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ftk")), "discard");
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], [i1, i2]);
  for (const c of [b.id("place"), b.id("myplace")]) assert.equal(dmg(b.engine, c), 0);
});

clause(KAMIKAZE, "1:rule", "destroyed: characters, items, face-down cards and cards in hand cannot be picked (faction or location only)", () => {
  const attempt = (key: string) => {
    const b = ftkBoard({ inPlay: true });
    play(b.engine, P1, b.id("k"), { selected: { t: [b.id("ftk")] } });
    return () => drain(b.engine, pickT(b.id(key), "d"));
  };
  refused(attempt("oc"), "an opponent's character");
  refused(attempt("mine"), "my own character");
  refused(attempt("thing"), "an item");
  refused(attempt("hidden"), "a face-down card");
  refused(attempt("inHand"), "a card in hand");
});

clause(KAMIKAZE, "1:rule", "triggers when destroyed by damage as well (3 damage kills the 3-life Kamikaze)", () => {
  const b = ftkBoard({ inPlay: true });
  const i2 = infl(b.engine, P2);
  play(b.engine, P1, b.id("burn"), { selected: { t: [b.id("ftk")] } });
  drain(b.engine, pickT(factionOf(b.engine, P2), "d"));
  assert.equal(zoneOf(b.engine, b.id("ftk")), "discard");
  assert.equal(i2 - infl(b.engine, P2), 3);
});

clause(KAMIKAZE, "1:rule", "triggers when destroyed in battle", () => {
  const b = ftkBoard({ inPlay: true, extra: [{ key: "big", def: character({ name: "Big", strength: 5, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  fightThrough(b.engine, P1, [b.id("ftk")], { type: "faction", playerId: P2 }, [b.id("big")], undefined, pickT(b.id("place"), "d"));
  assert.equal(zoneOf(b.engine, b.id("ftk")), "discard");
  assert.equal(dmg(b.engine, b.id("place")), 3);
});

clause(KAMIKAZE, "1:rule", "does not trigger when it leaves play without being destroyed (returned to hand)", () => {
  const b = ftkBoard({ inPlay: true, extra: [{ key: "mv", def: mover("hand"), owner: P1, zone: "hand" }] });
  const i2 = infl(b.engine, P2);
  play(b.engine, P1, b.id("mv"), { selected: { t: [b.id("ftk")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ftk")), "hand");
  assert.equal(infl(b.engine, P2), i2);
});

clause(KAMIKAZE, "1:rule", "does not trigger when another character is destroyed", () => {
  const b = ftkBoard({ inPlay: true });
  const i2 = infl(b.engine, P2);
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("oc")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ftk")), "play");
  assert.equal(infl(b.engine, P2), i2);
});

// ───────────────────────── Fire Tail Kocktail ─────────────────────────

function kockBoard(opts: { rage?: number; vol?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "kt", def: printing(KOCKTAIL), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 8 } as Partial<CardDefinition>), owner: P2, zone: "play" },
      { key: "myplace", def: location({ name: "MyPlace", structure: 8 } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 5 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", life: 5 }), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
      ...bank("rage", opts.rage ?? 5, P1),
      ...(opts.vol ? volition(opts.vol, P1) : []),
      ...(opts.extra ?? [])
    ]
  });
}
const kt = (b: ReturnType<typeof kockBoard>, key: string) => play(b.engine, P1, b.id("kt"), { selected: { c: [b.id(key)] } });

clause(KOCKTAIL, "0:extraCost", "outside a battle I pick a character or location and the cost 3 is paid", () => {
  const b = kockBoard();
  const before = ready(b.engine);
  kt(b, "oc");
  assert.equal(before - ready(b.engine), 3, "printed cost 3");
  assert.equal(zoneOf(b.engine, b.id("kt")), "discard", "a tactic goes to the discard pile");
  assert.equal(dmg(b.engine, b.id("oc")), 2);
});

clause(KOCKTAIL, "0:extraCost", "the pick can be a character of either controller or a location of either controller", () => {
  for (const key of ["mine", "place", "myplace"]) {
    const b = kockBoard();
    kt(b, key);
    assert.equal(dmg(b.engine, b.id(key)), 2, `${key} takes 2`);
  }
});

clause(KOCKTAIL, "0:extraCost", "refused during a battle (after attackers are declared), accepted again once the battle is over", () => {
  const b = kockBoard();
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "a battle is in progress");
  refused(() => kt(b, "oc"), "not during a battle", /battle|cannot be deployed right now/i);
  assert.equal(zoneOf(b.engine, b.id("kt")), "hand");
  declareBlockers(b.engine, P2, []);
  assert.ok(b.engine.state.battle, "still in battle after blockers are declared");
  refused(() => kt(b, "oc"), "not during a battle (after blockers)", /battle|cannot be deployed right now/i);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined);
  kt(b, "oc");
  assert.equal(dmg(b.engine, b.id("oc")), 2);
});

clause(KOCKTAIL, "0:extraCost", "refused in the defender's response during a battle, accepted in a response window outside a battle", () => {
  const mk = () => kockBoard({ extra: [{ key: "kt2", def: printing(KOCKTAIL), owner: P2, zone: "hand" }, { key: "ik", def: itemKill(), owner: P1, zone: "hand" }, ...bank("rage", 3, P2)] });
  const ctrl = mk();
  ctrl.engine.perform({ type: "playCard", playerId: P1, cardId: ctrl.id("ik"), selected: { t: [ctrl.id("thing")] }, variables: {} } as never);
  playRaw(ctrl.engine, P2, ctrl.id("kt2"), { selected: { c: [ctrl.id("atk")] } });
  resolvePendingResponses(ctrl.engine);
  assert.equal(dmg(ctrl.engine, ctrl.id("atk")), 2, "outside a battle the opponent may respond with it");
  const b = mk();
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  refused(() => playRaw(b.engine, P2, b.id("kt2"), { selected: { c: [b.id("atk")] } }), "not during a battle", /battle|cannot be deployed right now/i);
  assert.equal(zoneOf(b.engine, b.id("kt2")), "hand");
});

clause(KOCKTAIL, "0:extraCost", "only a character or location can be picked: an item, a faction, a face-down card and a card in hand are refused", () => {
  const attempt = (key: string) => {
    const b = kockBoard();
    const target = key === "f1" ? factionOf(b.engine, P1) : key === "f2" ? factionOf(b.engine, P2) : b.id(key);
    return () => playRaw(b.engine, P1, b.id("kt"), { selected: { c: [target] } });
  };
  refused(attempt("thing"), "an item");
  refused(attempt("f1"), "my faction");
  refused(attempt("f2"), "the opponent's faction");
  refused(attempt("hidden"), "a face-down card");
  refused(attempt("inHand"), "a card in hand");
  const ok = kockBoard();
  kt(ok, "oc");
  assert.equal(dmg(ok.engine, ok.id("oc")), 2);
});

clause(KOCKTAIL, "0:extraCost", "needs exactly one pick: none is refused", () => {
  const b = kockBoard();
  refused(() => playRaw(b.engine, P1, b.id("kt"), { selected: { c: [] } }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("kt")), "hand");
});

clause(KOCKTAIL, "0:extraCost", "cost 3 and threshold [R]: 2 resources is refused, and 3 resources with no Rage icon is refused", () => {
  const short = kockBoard({ rage: 2 });
  refused(() => kt(short, "oc"), "one short of the cost");
  const noIcon = kockBoard({ rage: 0, vol: 3 });
  refused(() => kt(noIcon, "oc"), "no [R] in my resources");
  assert.equal(dmg(noIcon.engine, noIcon.id("oc")), 0);
  const ok = kockBoard({ rage: 1, vol: 2 });
  kt(ok, "oc");
  assert.equal(dmg(ok.engine, ok.id("oc")), 2, "3 resources including one Rage is enough");
});

clause(KOCKTAIL, "1:rule", "inflicts exactly 2 damage to the picked character (not 1, not 3) and no one else", () => {
  const b = kockBoard();
  kt(b, "oc");
  assert.equal(dmg(b.engine, b.id("oc")), 2);
  assert.equal(zoneOf(b.engine, b.id("oc")), "play");
  for (const k of ["mine", "weak", "place", "myplace"]) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} untouched`);
});

clause(KOCKTAIL, "1:rule", "2 damage kills a 2-life character", () => {
  const b = kockBoard();
  kt(b, "weak");
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
});

clause(KOCKTAIL, "1:rule", "draws exactly one card for me (the top card), the opponent draws nothing", () => {
  const b = kockBoard();
  const handBefore = b.engine.state.players[P1].hand.length;
  const deckBefore = [...b.engine.state.players[P1].deck];
  const oppHand = b.engine.state.players[P2].hand.length;
  const oppDeck = b.engine.state.players[P2].deck.length;
  kt(b, "oc");
  const hand = b.engine.state.players[P1].hand;
  assert.equal(hand.length, handBefore - 1 + 1, "Kocktail leaves the hand, one card drawn");
  assert.ok(hand.includes(deckBefore[0]), "the top card was drawn");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore.length - 1);
  assert.equal(b.engine.state.players[P2].hand.length, oppHand);
  assert.equal(b.engine.state.players[P2].deck.length, oppDeck);
});

clause(KOCKTAIL, "1:rule", "the draw happens even when the card was a location", () => {
  const b = kockBoard();
  const deckBefore = [...b.engine.state.players[P1].deck];
  kt(b, "place");
  assert.equal(dmg(b.engine, b.id("place")), 2);
  assert.ok(b.engine.state.players[P1].hand.includes(deckBefore[0]), "b.engine.state.players[P1].hand.includes(deckBefore[0])");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore.length - 1);
});

// ───────────────────────── Horns of Thabbash ─────────────────────────

function hornsBoard(opts: { attached?: string; owner?: string; rage?: number; vol?: number; volOwner?: string; extra?: Cards } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hot", def: printing(HORNS), owner, zone: opts.attached ? "play" : "hand", ...(opts.attached ? { attachedToKey: opts.attached } : {}) },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.vol ? volition(opts.vol, opts.volOwner ?? P1) : []),
      ...(opts.extra ?? [])
    ]
  });
}
const stats = (b: ReturnType<typeof hornsBoard>, key: string) => [b.engine.getStat(b.id(key), "strength"), b.engine.getStat(b.id(key), "life"), b.engine.getStat(b.id(key), "speed")];

clause(HORNS, "0:attach", "attaches to a character: it enters play attached to the picked character and the printed cost 2 is paid", () => {
  const b = hornsBoard({ rage: 3 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("hot"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("hot")), "play");
  assert.equal(b.engine.state.cards[b.id("hot")].attachedTo, b.id("host"));
  assert.equal(before - ready(b.engine), 2);
  assert.equal(b.engine.state.cards[b.id("other")].attachedTo, undefined);
});

clause(HORNS, "0:attach", "may attach to an opponent's character too (it names no controller)", () => {
  const b = hornsBoard({ rage: 2 });
  play(b.engine, P1, b.id("hot"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("hot")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("hot")].controllerId, P1);
});

clause(HORNS, "0:attach", "refused for a non-character host: an item, a location, a faction, a face-down card, a card in hand", () => {
  const b = hornsBoard({ rage: 2 });
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("hot"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card");
  refused(attempt(b.id("inHand")), "a card in hand");
  assert.equal(zoneOf(b.engine, b.id("hot")), "hand");
  attempt(b.id("host"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(HORNS, "0:attach", "needs a host: no pick is refused", () => {
  const b = hornsBoard({ rage: 2 });
  refused(() => playRaw(b.engine, P1, b.id("hot"), { selected: { attachTo: [] } }), "no host");
  assert.equal(zoneOf(b.engine, b.id("hot")), "hand");
});

clause(HORNS, "0:attach", "costs 2 with a [R] threshold: 1 resource is refused and 2 resources without a Rage icon are refused", () => {
  const short = hornsBoard({ rage: 1 });
  refused(() => play(short.engine, P1, short.id("hot"), { selected: { attachTo: [short.id("host")] } }), "one short");
  const noIcon = hornsBoard({ vol: 2 });
  refused(() => play(noIcon.engine, P1, noIcon.id("hot"), { selected: { attachTo: [noIcon.id("host")] } }), "no [R]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("hot")), "hand");
  const ok = hornsBoard({ rage: 1, vol: 1 });
  play(ok.engine, P1, ok.id("hot"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(ok.engine.state.cards[ok.id("hot")].attachedTo, ok.id("host"));
});

clause(HORNS, "1:rule", "the attached character gains exactly +1 strength and +1 life (2/2 becomes 3/3, speed unchanged)", () => {
  const b = hornsBoard({ attached: "host" });
  assert.deepEqual(stats(b, "host"), [3, 3, 2]);
});

clause(HORNS, "1:rule", "the +1 life is real: 2 damage doesn't kill a 3-life host", () => {
  const b = hornsBoard({ attached: "host" });
  b.engine.state.cards[b.id("host")].damage = 2;
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3);
  assert.equal(zoneOf(b.engine, b.id("host")), "play");
});

clause(HORNS, "1:rule", "other characters (mine and the opponent's) are unaffected", () => {
  const b = hornsBoard({ attached: "host" });
  assert.deepEqual(stats(b, "other"), [2, 2, 2]);
  assert.deepEqual(stats(b, "foe"), [2, 2, 2]);
  assert.deepEqual(b.engine.getRestrictions(b.id("other")).includes("cannotBlock"), false);
});

clause(HORNS, "1:rule", "attached to an opponent's character it buffs that character", () => {
  const b = hornsBoard({ attached: "foe" });
  assert.deepEqual(stats(b, "foe"), [3, 3, 2]);
  assert.deepEqual(stats(b, "host"), [2, 2, 2]);
});

clause(HORNS, "1:rule", "the attached character cannot block (restriction present; others can)", () => {
  const b = hornsBoard({ attached: "host" });
  assert.ok(b.engine.getRestrictions(b.id("host")).includes("cannotBlock"), "b.engine.getRestrictions(b.id(\"host\")).includes(\"cannotBlock\")");
});

clause(HORNS, "1:rule", "in an actual battle the attached character cannot be declared as a blocker, while another character can", () => {
  // The opponent's Foe carries the Horns; the opponent has Foe2 as a legal blocker
  const horned = hornsBoard({ attached: "foe", extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }] });
  declareAttackBy(horned.engine, P1, [horned.id("atk")]);
  refused(() => declareBlockers(horned.engine, P2, [horned.id("foe")]), "the horned character cannot block", /block/i);
  declareBlockers(horned.engine, P2, [horned.id("foe2")]);
  assert.ok(horned.engine.state.battle, "Foe2 blocked");
  // control: the same character without the Horns can block
  const plain = hornsBoard({ extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }] });
  declareAttackBy(plain.engine, P1, [plain.id("atk")]);
  declareBlockers(plain.engine, P2, [plain.id("foe")]);
});

clause(HORNS, "1:rule", "all of it ends when the Horns leave play: stats back to printed and the host can block again", () => {
  const b = hornsBoard({
    attached: "foe",
    extra: [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "ik", def: itemKill(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("hot")] } });
  assert.equal(zoneOf(b.engine, b.id("hot")), "discard");
  assert.deepEqual(stats(b, "foe"), [2, 2, 2]);
  assert.equal(b.engine.getRestrictions(b.id("foe")).includes("cannotBlock"), false);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
});

clause(HORNS, "1:rule", "when the host is destroyed the Horns go to the discard pile with it", () => {
  const b = hornsBoard({ attached: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("hot")), "discard");
});

clause(HORNS, "2:rule@vvv", "with [V][V][V] the attached character gains 3 more strength (+1 +3 = 6 strength) and life stays +1", () => {
  const b = hornsBoard({ attached: "host", vol: 3 });
  assert.deepEqual(stats(b, "host"), [6, 3, 2]);
  assert.equal(b.engine.getRestrictions(b.id("host")).includes("cannotBlock"), true);
});

clause(HORNS, "2:rule@vvv", "with only [V][V] (one short) the +3 strength is off: 3 strength", () => {
  const b = hornsBoard({ attached: "host", vol: 2 });
  assert.deepEqual(stats(b, "host"), [3, 3, 2]);
});

clause(HORNS, "2:rule@vvv", "with no resources the +3 strength is off", () => {
  const b = hornsBoard({ attached: "host" });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
});

clause(HORNS, "2:rule@vvv", "three other-icon resources (Rage) are not [V][V][V]", () => {
  const b = hornsBoard({ attached: "host", rage: 3 });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
});

clause(HORNS, "2:rule@vvv", "more than three Volition still gives +3 once (not stacking)", () => {
  const b = hornsBoard({ attached: "host", vol: 6 });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 6);
});

clause(HORNS, "2:rule@vvv", "the threshold is the Horns' controller's: my [V][V][V] pump an opponent's host I attached it to; their [V][V][V] alone do not", () => {
  const mine = hornsBoard({ attached: "foe", vol: 3, volOwner: P1 });
  assert.equal(mine.engine.getStat(mine.id("foe"), "strength"), 6);
  const theirs = hornsBoard({ attached: "foe", vol: 3, volOwner: P2 });
  assert.equal(theirs.engine.getStat(theirs.id("foe"), "strength"), 3);
});

clause(HORNS, "2:rule@vvv", "the bonus only goes to the attached character, and is off again when the Volition is gone or the Horns leave play", () => {
  const b = hornsBoard({ attached: "host", vol: 3, extra: [{ key: "ik", def: itemKill(), owner: P1, zone: "hand" }] });
  assert.equal(b.engine.getStat(b.id("other"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("hot")] } });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 2, "Horns gone: back to the printed 2");
});
