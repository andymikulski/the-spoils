// Batch r10-card-types (docs/TESTING.md), part 2: CR 201.5-201.8 rules text, collector info, battle stats, structure.
// Written from the wording of the Comprehensive Rules, not from the engine.
// Printed layout (collector info) has no engine behavior and is exempted below.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import {
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

const resource = (name: string, icon: "rage" | "greed" | "deception" = "rage") =>
  resourceCard({ name, resource: { provides: [icon] } });

/** `n` face-up resources providing `icon`, controlled by `owner`. */
function bank(prefix: string, n: number, owner: string = P1, icon: "rage" | "greed" | "deception" = "rage"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: resource(`${prefix} ${i}`, icon), owner }));
}

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

/** Deploys a card and lets every response window close. */
function deploy(engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
  resolvePendingResponses(engine);
}

/** A tactic that destroys the picked card matching `selector`. */
const destroyer = (name: string, selector: Record<string, unknown> = { type: "character" }) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

describe("CR 201.5 — rules text", () => {
  ruleExempt(
    "CR 201.5a",
    "That rules text sits on the bottom half of the card is physical layout; that it does something is tested through every ability test in this batch and the abilities batch."
  );

  rule("CR 201.5b", "a continuous ability is only active in play: an aura item in hand or in the discard pile does nothing, in play it applies", () => {
    const banner = item({
      name: "Banner",
      behavior: {
        abilities: [
          {
            id: "rally",
            type: "continuous",
            modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });
    const strengthIn = (bannerZone: "hand" | "discard" | "play") => {
      const { engine, id } = buildGame({
        cards: [
          { key: "banner", def: banner, owner: P1, zone: bannerZone },
          { key: "fighter", def: character({ name: "Fighter", strength: 1 }), owner: P1 }
        ]
      });
      return engine.getStat(id("fighter"), "strength");
    };
    assert.equal(strengthIn("hand"), 1, "in hand the text is inactive");
    assert.equal(strengthIn("discard"), 1, "in the discard pile the text is inactive");
    assert.equal(strengthIn("play"), 3, "in play the text is active");
  });

  rule("CR 201.5b", "an activated ability cannot be used from hand or discard, only from play", () => {
    const zapper = character({
      name: "Zapper",
      behavior: { abilities: [{ id: "zap", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }] }
    });
    for (const where of ["hand", "discard"] as const) {
      const { engine, id } = buildGame({ cards: [{ key: "z", def: zapper, owner: P1, zone: where }] });
      refused(
        () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("z"), abilityId: "zap" }),
        `using an ability of a card in the ${where}`,
        /Source must be in zone/
      );
    }
    const { engine, id } = buildGame({ cards: [{ key: "z", def: zapper, owner: P1 }] });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("z"), abilityId: "zap" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 3, "control: in play the ability works");
  });

  rule("CR 201.5b", "a triggered ability only triggers in play", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "t", type: "triggered", event: "turnEnding", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }] }
    });
    const gained = (where: "hand" | "discard" | "play") => {
      const { engine } = buildGame({ cards: [{ key: "w", def: watcher, owner: P1, zone: where }] });
      const before = engine.state.players[P1].influence;
      const turn = engine.state.turn;
      engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(engine);
      // The trigger fires at the end of every turn; seats between P1 and P2 end turns of their own: count the gain per turn ended.
      return (engine.state.players[P1].influence - before) / (engine.state.turn - turn);
    };
    assert.equal(gained("hand"), 0, "in hand it does not trigger");
    assert.equal(gained("discard"), 0, "in the discard pile it does not trigger");
    assert.equal(gained("play"), 2, "in play it triggers");
  });

  rule("CR 201.5b", "'unless otherwise stated': a card that states another zone has active text there (ability from the discard pile, trigger in the discard pile)", () => {
    const recur = character({
      name: "Recur",
      behavior: {
        abilities: [
          { id: "recur", type: "activated", activationZone: "discard", effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }] },
          { id: "echo", type: "triggered", event: "turnEnding", triggerZone: "discard", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "r", def: recur, owner: P1, zone: "discard" }] });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("r"), abilityId: "recur" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 4, "the stated discard-pile ability is usable from the discard pile");
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    // One trigger per turn ended (seats between P1 and P2 end turns of their own).
    assert.equal(engine.state.players[P1].influence, before + 4 + (engine.state.turn - turn), "and the stated discard-pile trigger fires there");

    const inHand = buildGame({ cards: [{ key: "r", def: recur, owner: P1, zone: "hand" }] });
    refused(
      () => inHand.engine.perform({ type: "activateAbility", playerId: P1, cardId: inHand.id("r"), abilityId: "recur" }),
      "the discard-pile ability from the hand",
      /Source must be in zone/
    );
  });

  rule("CR 201.5c", "an ability has a cost section and an effect section: the cost is paid on use, the effect happens when it resolves", () => {
    const named = character({
      name: "Smith",
      behavior: {
        abilities: [
          {
            id: "forge",
            name: "FORGE",
            type: "activated",
            costs: [{ type: "loseInfluence", amount: 2 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "smith", def: named, owner: P1 },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });
    const influence = engine.state.players[P1].influence;
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("smith"), abilityId: "forge" });
    assert.equal(engine.state.players[P1].influence, influence - 2, "COST: paid as the ability is used");
    assert.equal(engine.state.players[P1].hand.length, hand, "EFFECT: not yet, the opponent may respond first");
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, hand + 1, "EFFECT: happens when the ability resolves");
    assert.equal(engine.getCardActivatedAbilities(id("smith"))[0]?.name, "FORGE", "the ability carries its name");
  });

  rule("CR 201.5d", "a paragraph that begins with threshold icons is active only while you meet that threshold", () => {
    const heated = character({
      name: "Heated",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "rage",
            type: "continuous",
            condition: { type: "meetsThreshold", threshold: "rr" },
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }]
          }
        ]
      }
    });
    const strengthWith = (rageCount: number, opponentRage = 0) => {
      const { engine, id } = buildGame({
        cards: [{ key: "h", def: heated, owner: P1 }, ...bank("mine", rageCount, P1), ...bank("theirs", opponentRage, P2)]
      });
      return engine.getStat(id("h"), "strength");
    };
    assert.equal(strengthWith(0), 1, "no icons: the paragraph is inactive");
    assert.equal(strengthWith(1), 1, "one icon short: inactive");
    assert.equal(strengthWith(2), 4, "exactly the threshold: active");
    assert.equal(strengthWith(3), 4, "more than the threshold: active");
    assert.equal(strengthWith(1, 5), 1, "the opponent's icons are not mine: inactive");
  });

  rule("CR 201.5d", "the paragraph stops being active the moment you stop meeting its threshold", () => {
    const heated = character({
      name: "Heated",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "rage",
            type: "continuous",
            condition: { type: "meetsThreshold", threshold: "rr" },
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "h", def: heated, owner: P1 },
        ...bank("mine", 2, P1),
        { key: "smash", def: destroyer("Smash", { type: "resource", controller: "opponent" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.equal(engine.getStat(id("h"), "strength"), 4, "while I meet the threshold");
    deploy(engine, P2, id("smash"), { selected: { t: [id("mine0")] } });
    assert.equal(zone(engine, id("mine0")), "discard", "a Rage resource is destroyed");
    assert.equal(engine.getStat(id("h"), "strength"), 1, "no longer meeting the threshold: inactive again");
  });

  rule("CR 201.5d", "an ability paragraph with a threshold is usable only while the threshold is met", () => {
    const gated = character({
      name: "Gated",
      behavior: {
        abilities: [{ id: "go", type: "activated", threshold: "gg", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }]
      }
    });
    const attempt = (greeds: number) => {
      const { engine, id } = buildGame({ cards: [{ key: "g", def: gated, owner: P1 }, ...bank("g", greeds, P1, "greed")] });
      const before = engine.state.players[P1].influence;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g"), abilityId: "go" });
      resolvePendingResponses(engine);
      return engine.state.players[P1].influence - before;
    };
    assert.equal(attempt(2), 2, "threshold met: it works");
    const { engine, id } = buildGame({ cards: [{ key: "g", def: gated, owner: P1 }, ...bank("g", 1, P1, "greed")] });
    refused(
      () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g"), abilityId: "go" }),
      "one Greed short of the paragraph's threshold",
      /threshold/i
    );
  });

  rule("CR 201.5e", "italic text (subtitle, flavor, reminders) is not rules text: it adds no abilities and does nothing when the card is played", () => {
    const italic = tactic({
      name: "Poem",
      cost: 0,
      subtitle: "Deal 5 damage to your opponent's faction",
      flavorText: "Draw three cards and destroy every character.",
      text: ""
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "poem", def: italic, owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const influence = engine.state.players[P2].influence;
    const hand = engine.state.players[P1].hand.length;
    deploy(engine, P1, id("poem"));
    assert.equal(zone(engine, id("poem")), "discard", "the card resolved");
    assert.equal(engine.state.players[P2].influence, influence, "the italic 'deal damage' did nothing");
    assert.equal(zone(engine, id("victim")), "play", "the italic 'destroy' did nothing");
    assert.equal(engine.state.players[P1].hand.length, hand - 1, "the italic 'draw' did nothing (only the tactic left the hand)");
    assert.deepEqual(engine.getCardActivatedAbilities(id("poem")), [], "no abilities exist");
  });
});

describe("CR 201.6 — collector info", () => {
  ruleExempt(
    ["CR 201.6a", "CR 201.6b", "CR 201.6d"],
    "Where the collector info sits, the set icon and the collector-number format and sort order are physical layout and catalog presentation with no in-game effect; the engine never reads them."
  );
  ruleExempt(
    "CR 201.6c",
    "Rarity defines how often a card appears in a pack: pack-opening policy outside the game engine. Rarity has no in-game rule."
  );
});

describe("CR 201.7 — battle stats", () => {
  rule("CR 201.7a", "only characters have battle stats: an item with stray stat values cannot attack, a character can", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gear", def: item({ name: "Gear", strength: 9, life: 1, speed: 9 }), owner: P1 },
        { key: "fighter", def: character({ name: "Fighter" }), owner: P1 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("gear")], target: { type: "faction", playerId: P2 } }),
      "an item attacking",
      /Only characters can attack/
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fighter")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: a character can attack");
  });

  rule("CR 201.7a", "only characters have battle stats: damage never destroys an item that carries a stray life value", () => {
    const zap = character({
      name: "Zap",
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "opponent", type: "item" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "zap", def: zap, owner: P1 },
        { key: "charm", def: item({ name: "Charm", life: 1 }), owner: P2 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("zap"), abilityId: "z", selected: { t: [id("charm")] } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("charm")), "play", "an item has no life, so damage cannot destroy it");
  });

  rule("CR 201.7b", "a character has strength, life and speed", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C", strength: 4, life: 5, speed: 2 }), owner: P1 }] });
    assert.equal(engine.getStat(id("c"), "strength"), 4, "STR");
    assert.equal(engine.getStat(id("c"), "life"), 5, "LIFE");
    assert.equal(engine.getStat(id("c"), "speed"), 2, "SPD");
  });

  rule("CR 201.7c", "gear adjusts the stats of the character it is attached to (+ and -), and only that character", () => {
    const gear = item({
      name: "Plate Mail",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "plate",
            type: "continuous",
            modifiers: [
              { target: "attachedTo", stat: "strength", operation: "add", value: 2 },
              { target: "attachedTo", stat: "life", operation: "add", value: 3 },
              { target: "attachedTo", stat: "speed", operation: "add", value: -1 }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 1, life: 2, speed: 3 }), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 2, speed: 3 }), owner: P1 },
        { key: "gear", def: gear, owner: P1, attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3, "+2 strength");
    assert.equal(engine.getStat(id("host"), "life"), 5, "+3 life");
    assert.equal(engine.getStat(id("host"), "speed"), 2, "-1 speed");
    assert.equal(engine.getStat(id("bystander"), "strength"), 1, "another character is not adjusted");
    assert.equal(engine.getStat(id("bystander"), "speed"), 3, "another character's speed is not adjusted");
  });
});

describe("CR 201.8 — structure", () => {
  rule("CR 201.8a", "only locations have structure: a location is destroyed by damage reaching its structure, ignoring any stray life value", () => {
    const zap = (amount: number) =>
      character({
        name: `Zap${amount}`,
        behavior: {
          abilities: [
            {
              id: "z",
              type: "activated",
              targets: [{ id: "t", selector: { controller: "opponent", type: "location" }, count: 1 }],
              effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
            }
          ]
        }
      });
    const { engine, id } = buildGame({
      cards: [
        { key: "zap", def: zap(2), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3, life: 1 }), owner: P2 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("zap"), abilityId: "z", selected: { t: [id("fort")] } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("fort")), "play", "2 damage is more than its stray life 1 but less than its structure 3");
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the damage is recorded on the location");
  });

  rule("CR 201.8b", "structure is the number of damage markers it takes to destroy the location: one short survives, exactly structure destroys", () => {
    const zap = (amount: number) =>
      character({
        name: "Zap",
        behavior: {
          abilities: [
            {
              id: "z",
              type: "activated",
              targets: [{ id: "t", selector: { controller: "opponent", type: "location" }, count: 1 }],
              effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
            }
          ]
        }
      });
    for (const [amount, survives] of [[2, true], [3, false], [4, false]] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "zap", def: zap(amount), owner: P1 },
          { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2 }
        ]
      });
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("zap"), abilityId: "z", selected: { t: [id("fort")] } });
      resolvePendingResponses(engine);
      assert.equal(zone(engine, id("fort")), survives ? "play" : "discard", `${amount} damage against structure 3`);
    }
  });
});
