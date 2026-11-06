// Batch r10-card-types (docs/TESTING.md), part 4: CR 207 Locations, CR 208 Changing Card Types.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";
import { settleTurnStart } from "../support/develop.js";

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

/** `n` face-up Rage resources controlled by `owner`. */
function bank(prefix: string, n: number, owner: string = P1): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: resourceCard({ name: `${prefix} ${i}`, resource: { provides: ["rage"] } }), owner }));
}

/** Deploys a card and lets every response window close. */
function deploy(engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
  resolvePendingResponses(engine);
}

/** The player ends their turn and the opponent passes: the next turn starts. */
function passTurn(engine: SpoilsEngine, player: string): void {
  engine.perform({ type: "endTurn", playerId: player });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
}

/** A character whose ability deals `amount` damage to the picked card matching `selector`. */
const zapper = (name: string, amount: number, selector: Record<string, unknown> = { controller: "opponent", type: "character" }) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

function zap(engine: SpoilsEngine, by: string, victim: string, player: string = P1): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId: by, abilityId: "z", selected: { t: [victim] } });
  resolvePendingResponses(engine);
}

/** Attacks with `attackers`, closes the declaration window, declares `blockers` and fights the battle out. */
function fight(
  engine: SpoilsEngine,
  attackers: string[],
  target: { type: "faction"; playerId: string } | { type: "card"; cardId: string },
  blockers: string[] = []
): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
  autoResolveBattle(engine);
}

/** P1 attacks the opposing faction and passes priority, so P2 holds priority in the declaration window. */
function attackAndPass(engine: SpoilsEngine, attackers: string[]): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target: { type: "faction", playerId: P2 } });
  engine.perform({ type: "passPriority", playerId: P1 });
}

/** A tactic that grants the picked item the character type this turn, with stats 2/3/1. */
const animate = (name = "Animate", duration: { type: "untilEndOfTurn" } | { type: "permanent" } = { type: "untilEndOfTurn" }) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { type: "item", controller: "any" }, count: 1 }],
          effects: [
            { type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 2, life: 3, speed: 1 }, duration }
          ]
        }
      ]
    }
  });

/** A tactic that removes the character type from the picked card. */
const strip = (name = "Strip") =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character", controller: "any" }, count: 1 }],
          effects: [{ type: "removeCardType", target: { type: "selected", id: "t" }, cardType: "character" }]
        }
      ]
    }
  });

describe("CR 207 — locations", () => {
  ruleExempt(
    "CR 207.5a",
    "Advice on how players track damage markers on paper or with a die is physical play practice; the engine tracks the marker count itself (tested under CR 207.4 to 207.6)."
  );

  rule("CR 207.3", "your opponent can attack your locations; you cannot attack your own", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 2 }), owner: P1 },
        { key: "mine", def: location({ name: "Mine", structure: 5 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "card", cardId: id("mine") } }),
      "attacking my own location",
      /cannot attack your own location/
    );
    fight(engine, [id("atk")], { type: "card", cardId: id("fort") });
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the opponent's location took the battle damage");
  });

  rule("CR 207.3", "a location is attacked, it does not attack: a location cannot be declared as an attacker", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fort", def: location({ name: "Fort", structure: 5, strength: 3 }), owner: P1 },
        { key: "ok", def: character({ name: "Ok" }), owner: P1 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fort")], target: { type: "faction", playerId: P2 } }),
      "a location attacking",
      /Only characters can attack/
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ok")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: a character attacks");
  });

  rule("CR 207.4", "a location's structure is how many damage markers it takes to destroy it", () => {
    for (const structure of [1, 4]) {
      const small = buildGame({
        cards: [
          { key: "z", def: zapper("Z", structure - 1, { controller: "opponent", type: "location" }), owner: P1 },
          { key: "z2", def: zapper("Z2", structure, { controller: "opponent", type: "location" }), owner: P1 },
          { key: "fort", def: location({ name: "Fort", structure }), owner: P2 }
        ]
      });
      if (structure > 1) {
        zap(small.engine, small.id("z"), small.id("fort"));
        assert.equal(zone(small.engine, small.id("fort")), "play", `${structure - 1} markers do not destroy structure ${structure}`);
      }
      zap(small.engine, small.id("z2"), small.id("fort"));
      assert.equal(zone(small.engine, small.id("fort")), "discard", `${structure} markers destroy structure ${structure}`);
    }
  });

  rule("CR 207.5", "a location is destroyed at once when its damage markers reach its structure: exactly equal destroys, one less does not, more destroys", () => {
    for (const [amount, survives] of [[2, true], [3, false], [6, false]] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "z", def: zapper("Z", amount, { controller: "opponent", type: "location" }), owner: P1 },
          { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2 }
        ]
      });
      zap(engine, id("z"), id("fort"));
      assert.equal(zone(engine, id("fort")), survives ? "play" : "discard", `${amount} markers against structure 3`);
    }
  });

  rule("CR 207.5", "a location's damage markers accumulate across hits and across turns (they are not cleared at the start of a turn)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Z", 2, { controller: "opponent", type: "location" }), owner: P1 },
        { key: "z1", def: zapper("Z1", 1, { controller: "opponent", type: "location" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2 }
      ]
    });
    zap(engine, id("z"), id("fort"));
    passTurn(engine, P1);
    passTurn(engine, P2);
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the markers are still there on the next turn");
    zap(engine, id("z1"), id("fort"));
    assert.equal(zone(engine, id("fort")), "discard", "2 + 1 markers reach structure 3");
  });

  rule("CR 207.5", "a location is destroyed immediately when its structure is lowered to the markers it already has", () => {
    const quake = item({
      name: "Quake",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "q",
            type: "continuous",
            modifiers: [{ selector: { controller: "opponent", type: "location" }, stat: "structure", operation: "add", value: -1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "quake", def: quake, owner: P1, zone: "hand" },
        { key: "cracked", def: location({ name: "Cracked", structure: 3 }), owner: P2, damage: 2 },
        { key: "sound", def: location({ name: "Sound", structure: 3 }), owner: P2 }
      ]
    });
    deploy(engine, P1, id("quake"));
    assert.equal(zone(engine, id("cracked")), "discard", "2 markers against structure 2: destroyed");
    assert.equal(zone(engine, id("sound")), "play", "an undamaged location survives");
    assert.equal(engine.getStat(id("sound"), "structure"), 2, "the quake really did lower structure by 1");
  });

  rule("CR 207.5b", "when a location leaves play its damage markers disappear: replayed from hand it is undamaged", () => {
    const bounce = tactic({
      name: "Bounce",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "location", controller: "any" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        ...bank("r", 3),
        { key: "bounce", def: bounce, owner: P1, zone: "hand" },
        { key: "fort", def: location({ name: "Fort", structure: 3, cost: 0 }), owner: P1, damage: 2 }
      ]
    });
    deploy(engine, P1, id("bounce"), { selected: { t: [id("fort")] } });
    assert.equal(zone(engine, id("fort")), "hand", "the location left play");
    assert.equal(engine.state.cards[id("fort")]!.damage, 0, "its damage markers are gone");
    deploy(engine, P1, id("fort"));
    assert.equal(zone(engine, id("fort")), "play", "deployed again");
    assert.equal(engine.state.cards[id("fort")]!.damage, 0, "with a clean slate");
  });

  rule("CR 207.5b", "a destroyed location's damage markers disappear with it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Z", 5, { controller: "opponent", type: "location" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2 }
      ]
    });
    zap(engine, id("z"), id("fort"));
    assert.equal(zone(engine, id("fort")), "discard", "destroyed");
    assert.equal(engine.state.cards[id("fort")]!.damage, 0, "no markers remain on a card that left play");
  });

  rule("CR 207.6", "when an effect removes damage markers the location's total is adjusted accordingly", () => {
    const repair = tactic({
      name: "Repair",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            targets: [{ id: "t", selector: { type: "location", controller: "any" }, count: 1 }],
            effects: [{ type: "healDamage", target: { type: "selected", id: "t" }, amount: 2 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "repair", def: repair, owner: P1, zone: "hand" },
        { key: "z", def: zapper("Z", 2, { controller: "opponent", type: "location" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2, damage: 2 }
      ]
    });
    deploy(engine, P1, id("repair"), { selected: { t: [id("fort")] } });
    assert.equal(engine.state.cards[id("fort")]!.damage, 0, "2 markers removed from 2");
    zap(engine, id("z"), id("fort"));
    assert.equal(zone(engine, id("fort")), "play", "the removed markers no longer count: 2 new markers against structure 3");
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the total is the 2 new markers");
  });

  rule("CR 207.6", "removing more markers than the location has leaves it at 0, not below", () => {
    const repair = tactic({
      name: "Repair",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            targets: [{ id: "t", selector: { type: "location", controller: "any" }, count: 1 }],
            effects: [{ type: "healDamage", target: { type: "selected", id: "t" }, amount: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "repair", def: repair, owner: P1, zone: "hand" },
        { key: "z", def: zapper("Z", 3, { controller: "opponent", type: "location" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 4 }), owner: P2, damage: 1 }
      ]
    });
    deploy(engine, P1, id("repair"), { selected: { t: [id("fort")] } });
    assert.equal(engine.state.cards[id("fort")]!.damage, 0, "floored at 0");
    zap(engine, id("z"), id("fort"));
    assert.equal(zone(engine, id("fort")), "play", "3 markers against structure 4: a negative total would have hidden extra room");
    assert.equal(engine.state.cards[id("fort")]!.damage, 3, "exactly the 3 new markers");
  });
});

describe("CR 208 — changing card types", () => {
  rule("CR 208.1", "a card can have more than one type at the same time and each type still counts for effects that name it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "animate", def: animate("Animate"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P1 }
      ]
    });
    deploy(engine, P1, id("animate"), { selected: { t: [id("gear")] } });
    assert.deepEqual([...engine.getCardTypes(id("gear"))].sort(), ["character", "item"], "item and character at once");
    for (const type of ["item", "character"] as const) {
      const found = engine.queryCards({ type, controller: "self" }, { sourceId: id("gear"), controllerId: P1, selected: {} }).map(card => card.id);
      assert.ok(found.includes(id("gear")), `an effect that names ${type}s sees it`);
    }
    const locations = engine.queryCards({ type: "location" }, { sourceId: id("gear"), controllerId: P1, selected: {} });
    assert.equal(locations.length, 0, "but it is not a location");
  });

  rule("CR 208.1a", "gaining a type keeps the other types: a character that gains item still is a character and fights as one", () => {
    const addItem = tactic({
      name: "Gadgetize",
      behavior: {
        abilities: [
          {
            id: "g",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", controller: "any" }, count: 1 }],
            effects: [{ type: "setCardType", target: { type: "selected", id: "t" }, cardType: "item", duration: { type: "permanent" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "gadgetize", def: addItem, owner: P1, zone: "hand" },
        { key: "fighter", def: character({ name: "Fighter", strength: 2, life: 3, speed: 1 }), owner: P1 }
      ]
    });
    deploy(engine, P1, id("gadgetize"), { selected: { t: [id("fighter")] } });
    assert.deepEqual([...engine.getCardTypes(id("fighter"))].sort(), ["character", "item"], "it gained item and kept character");
    assert.equal(engine.getStat(id("fighter"), "strength"), 2, "its battle stats are intact");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fighter")], target: { type: "faction", playerId: P2 } });
    assert.deepEqual(engine.state.battle?.attackingParty, [id("fighter")], "it can still attack as a character");
  });

  /** P1 animates P2's item, aims `effect` at "a character" (the item), and P2 strips the character type in response (unless `respond` is false). */
  const typeLostBeforeResolution = (effect: "destroy" | "dealDamage", respond: boolean) => {
    const aimed = tactic({
      name: "Aimed",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", controller: "any" }, count: 1 }],
            effects: [
              effect === "destroy"
                ? { type: "destroy", target: { type: "selected", id: "t" } }
                : { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "animate", def: animate("Animate"), owner: P1, zone: "hand" },
        { key: "aimed", def: aimed, owner: P1, zone: "hand" },
        { key: "strip", def: strip("Strip"), owner: P2, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P2 }
      ]
    });
    deploy(engine, P1, id("animate"), { selected: { t: [id("gear")] } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("aimed"), selected: { t: [id("gear")] } });
    if (respond) engine.perform({ type: "playCard", playerId: P2, cardId: id("strip"), selected: { t: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("gear"), "character"), !respond, respond ? "the response removed the character type" : "still a character");
    assert.equal(zone(engine, id("aimed")), "discard", "the tactic resolved");
    return { engine, id };
  };

  rule("CR 208.2", "control: an effect aimed at 'a character' does affect an item that is still a character when it resolves", () => {
    const destroyed = typeLostBeforeResolution("destroy", false);
    assert.equal(zone(destroyed.engine, destroyed.id("gear")), "discard", "destroyed as a character");
    const damaged = typeLostBeforeResolution("dealDamage", false);
    assert.equal(damaged.engine.state.cards[damaged.id("gear")]!.damage, 2, "damaged as a character (2 of life 3)");
  });

  rule("CR 208.2", "a 'destroy a character' effect does not affect a card that is no longer a character when it resolves", () => {
    const { engine, id } = typeLostBeforeResolution("destroy", true);
    assert.equal(zone(engine, id("gear")), "play", "the card is no longer a character, so the effect does not affect it");
  });

  rule("CR 208.2", "a 'deal damage to a character' effect does not affect a card that is no longer a character when it resolves", () => {
    const { engine, id } = typeLostBeforeResolution("dealDamage", true);
    assert.equal(engine.state.cards[id("gear")]!.damage, 0, "no damage is dealt to a card that is no longer a character");
  });

  rule("CR 208.3", "a card that loses the character type forgets the damage it received this turn (example: item becomes a character, is damaged, stops, becomes a character again)", () => {
    const sequence = tactic({
      name: "Sequence",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { type: "item", controller: "any" }, count: 1 }],
            effects: [
              { type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 1, life: 3, speed: 1 }, duration: { type: "untilEndOfTurn" } },
              { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 },
              { type: "removeCardType", target: { type: "selected", id: "t" }, cardType: "character" },
              { type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 1, life: 3, speed: 1 }, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sequence", def: sequence, owner: P1, zone: "hand" },
        { key: "z", def: zapper("Z", 2, { controller: "any", type: "character" }), owner: P1 },
        { key: "gear", def: item({ name: "Gear" }), owner: P2 }
      ]
    });
    deploy(engine, P1, id("sequence"), { selected: { t: [id("gear")] } });
    assert.equal(engine.hasCardType(id("gear"), "character"), true, "a character again");
    assert.equal(zone(engine, id("gear")), "play", "still in play");
    assert.equal(engine.state.cards[id("gear")]!.damage, 0, "the 2 damage received while it was a character is not remembered");
    zap(engine, id("z"), id("gear"));
    assert.equal(zone(engine, id("gear")), "play", "2 new damage against life 3 (a remembered 2 would have made 4 and destroyed it)");
    assert.equal(engine.state.cards[id("gear")]!.damage, 2, "only the new damage counts");
  });

  rule("CR 208.3", "a card that loses the character type because the effect ends also forgets its damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "animate", def: animate("Animate"), owner: P1, zone: "hand" },
        { key: "z", def: zapper("Z", 2, { controller: "any", type: "character" }), owner: P1 },
        { key: "gear", def: item({ name: "Gear" }), owner: P2 }
      ]
    });
    deploy(engine, P1, id("animate"), { selected: { t: [id("gear")] } });
    zap(engine, id("z"), id("gear"));
    assert.equal(engine.state.cards[id("gear")]!.damage, 2, "damaged while a character");
    passTurn(engine, P1);
    assert.equal(engine.hasCardType(id("gear"), "character"), false, "the 'this turn' effect ended");
    assert.equal(engine.state.cards[id("gear")]!.damage, 0, "its damage is forgotten");
  });

  rule("CR 208.4", "a card that loses the character type during a battle is removed from the battle immediately (attacker)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "animate", def: animate("Animate"), owner: P1, zone: "hand" },
        { key: "strip", def: strip("Strip"), owner: P2, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P1 },
        { key: "buddy", def: character({ name: "Buddy" }), owner: P1 }
      ]
    });
    deploy(engine, P1, id("animate"), { selected: { t: [id("gear")] } });
    attackAndPass(engine, [id("gear"), id("buddy")]);
    assert.deepEqual([...engine.state.battle!.attackingParty].sort(), [id("buddy"), id("gear")].sort(), "both are in the attacking party");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("strip"), selected: { t: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("gear"), "character"), false, "the gear lost the character type");
    assert.ok(!engine.state.battle?.attackingParty.includes(id("gear")), "so it is no longer in the attacking party");
    assert.ok(engine.state.battle?.attackingParty.includes(id("buddy")), "while the real character remains in the battle");
  });

  rule("CR 208.4", "a card that loses the character type during a battle is removed from the battle immediately (blocker)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 1 }), owner: P1 },
        { key: "animate", def: animate("Animate"), owner: P2, zone: "hand" },
        { key: "strip", def: strip("Strip"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P2 }
      ]
    });
    attackAndPass(engine, [id("atk")]);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("animate"), selected: { t: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("gear"), "character"), true, "the gear is a character for this turn");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("gear")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("gear")], "it blocks");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker may respond to the blockers");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("strip"), selected: { t: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("gear"), "character"), false, "the gear lost the character type");
    assert.ok(!engine.state.battle?.blockingParty.includes(id("gear")), "so it is no longer in the blocking party");
  });
});
