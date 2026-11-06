// Batch r05-abilities (docs/TESTING.md): CR 504 Conditionals, 505 Requirements.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, item, location, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

type Placement = NonNullable<BuildGameOptions["cards"]>[number];

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

/** Face-up rage resources owned by `owner`, keys `<tag>0`, `<tag>1`, ... */
function rageBank(count: number, tag = "bank", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));
}

/** How many resources `playerId` has spent: cards attached to their faction. */
function spent(engine: SpoilsEngine, playerId: PlayerId): number {
  const factionId = engine.state.players[playerId].factionId;
  return Object.values(engine.state.cards).filter(card => card.attachedTo === factionId && card.zone === "play").length;
}

/** A tactic that destroys the card picked for target `t`. */
const destroyer = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: {}, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** "While your opponent controls a character" as a condition of the source's controller. */
const OPPONENT_HAS_CHARACTER = {
  type: "numberCompare" as const,
  left: { type: "count" as const, selector: { type: "character" as const, controller: "opponent" as const } },
  operator: ">=" as const,
  right: 1
};

describe("CR 504 — conditionals", () => {
  /** "While your opponent controls a character, this card gains 1 strength and 1 life." (the printed example) */
  const bold = () =>
    character({
      name: "Bold",
      strength: 1,
      life: 3,
      behavior: {
        abilities: [
          {
            id: "bold",
            type: "continuous",
            condition: OPPONENT_HAS_CHARACTER,
            modifiers: [
              { target: "source", stat: "strength", operation: "add", value: 1 },
              { target: "source", stat: "life", operation: "add", value: 1 }
            ]
          }
        ]
      }
    });

  rule("CR 504.1", "example: while your opponent controls a character, the card gains 1 strength and 1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 2, "strength 1 + 1");
    assert.equal(engine.getStat(id("bold"), "life"), 4, "life 3 + 1");
  });

  rule("CR 504.1", "the text is not active while the condition is false: with no opposing character the card has its printed stats", () => {
    const { engine, id } = buildGame({ cards: [{ key: "bold", def: bold(), owner: P1 }] });
    assert.equal(engine.getStat(id("bold"), "strength"), 1);
    assert.equal(engine.getStat(id("bold"), "life"), 3);
  });

  rule("CR 504.1", "the effect immediately ceases if the opponent ever stops controlling a character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 2, "active while the opponent has a character");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("foe")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("foe")), "discard", "the opposing character is gone");
    assert.equal(engine.getStat(id("bold"), "strength"), 1, "the bonus ceased at once");
    assert.equal(engine.getStat(id("bold"), "life"), 3);
  });

  rule("CR 504.1", "the condition can become true again: a new opposing character turns the text back on", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "hand" }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 1, "off before the opponent has a character");
    engine.state.cards[id("foe")]!.zone = "play";
    engine.state.players[P2].hand = engine.state.players[P2].hand.filter(c => c !== id("foe"));
    engine.state.players[P2].play.push(id("foe"));
    assert.equal(engine.getStat(id("bold"), "strength"), 2, "on once the opponent controls a character");
  });

  rule("CR 504.1", "'your opponent controls': a character you control does not satisfy the condition", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 1, "my own character does not count");
  });

  rule("CR 504.1", "'your opponent controls': the opponent's card taken under my control no longer satisfies it, and my card taken by them does", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1 }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 1, "owned by the opponent but controlled by me: not 'controlled by my opponent'");
    const other = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2 }
      ]
    });
    assert.equal(other.engine.getStat(other.id("bold"), "strength"), 2, "owned by me but controlled by the opponent: counts");
  });

  rule("CR 504.1", "a face-down card is a resource, not a character: it does not satisfy 'controls a character'", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "hidden", def: character({ name: "Hidden" }), owner: P2, faceDown: true }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 1);
  });

  rule("CR 504.1", "the count is a threshold, not a multiplier: two opposing characters give the bonus once", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "foe1", def: character({ name: "Foe 1" }), owner: P2 },
        { key: "foe2", def: character({ name: "Foe 2" }), owner: P2 }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 2);
  });

  rule("CR 504.1", "it works the same for the other player's card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P2 },
        { key: "foe", def: character({ name: "Foe" }), owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 2);
  });

  rule("CR 504.1", "a conditional keyword is only active while the condition is true (while the opponent controls a character, this card has covert)", () => {
    const sneaky = character({
      name: "Sneaky",
      behavior: { abilities: [{ id: "cov", type: "continuous", condition: OPPONENT_HAS_CHARACTER, modifiers: [], keywords: [{ target: "source", keyword: "covert" }] }] }
    });
    const off = buildGame({ cards: [{ key: "s", def: sneaky, owner: P1 }] });
    assert.equal(off.engine.hasKeyword(off.id("s"), "covert"), false, "condition false: no keyword");
    const on = buildGame({
      cards: [
        { key: "s", def: { ...sneaky, id: "sneaky2" }, owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 }
      ]
    });
    assert.equal(on.engine.hasKeyword(on.id("s"), "covert"), true, "condition true: keyword");
  });

  rule("CR 504.1", "a conditional reacts at once when a card moves out of the condition: an opposing character returned to its owner's hand turns the text off", () => {
    const bounceFoe = tactic({
      name: "Bounce",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bold", def: bold(), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "bounce", def: bounceFoe, owner: P1, zone: "hand" }
      ]
    });
    assert.equal(engine.getStat(id("bold"), "strength"), 2);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bounce"), selected: { t: [id("foe")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("foe")), "hand", "the opposing character went back to its owner's hand");
    assert.equal(engine.getStat(id("bold"), "strength"), 1, "the conditional ceased when the condition stopped being true");
  });
});

describe("CR 505 — requirements", () => {
  /** "Your opponents must pay N to attack": a requirement on the opponent's attack. */
  const toll = (name: string, amount = 2) =>
    item({ name, behavior: { abilities: [{ id: "toll", type: "continuous", modifiers: [], attackTax: { player: "opponent", amount } }] } });

  /** P2 (active) attacks with `attackers`, having `resources` rage resources, against P1's board with `tolls` toll items. */
  const tollBoard = (resources: number, tolls = 1, attackers = 1) =>
    buildGame({
      activePlayerId: P2,
      cards: [
        ...Array.from({ length: tolls }, (_, i) => ({ key: `toll${i}`, def: toll(`Toll ${i}`), owner: P1 })),
        ...Array.from({ length: attackers }, (_, i) => ({ key: `att${i}`, def: character({ name: `Attacker ${i}` }), owner: P2 })),
        ...rageBank(resources, "pay", P2)
      ]
    });

  const attackWith = (engine: SpoilsEngine, ids: CardInstanceId[]) =>
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: ids, target: { type: "faction", playerId: P1 } });

  rule("CR 505.1", "example: 'must pay 2 for each attacking party': a party can be formed by paying 2 (exactly enough)", () => {
    const { engine, id } = tollBoard(2);
    attackWith(engine, [id("att0")]);
    assert.equal(spent(engine, P2), 2, "the 2 was paid");
    assert.ok(engine.state.battle, "the attack was declared");
  });

  rule("CR 505.1", "example: with only 1 resource the requirement of 2 cannot be met, so the party cannot be formed (and nothing is paid)", () => {
    const { engine, id } = tollBoard(1);
    refused(() => attackWith(engine, [id("att0")]), "attack with 1 resource against a toll of 2", /pay|resource|enough|tax|attack/i);
    assert.equal(engine.state.battle, undefined, "no attack was declared");
    assert.equal(spent(engine, P2), 0, "nothing was paid");
    assert.equal(engine.state.cards[id("att0")]!.depleted, false, "the character did not attack");
  });

  rule("CR 505.1", "a requirement is met by paying exactly its amount: with 3 resources only 2 are paid", () => {
    const { engine, id } = tollBoard(3);
    attackWith(engine, [id("att0")]);
    assert.equal(spent(engine, P2), 2);
  });

  rule("CR 505.1", "the requirement applies to the player it names only: the source's controller attacks for free", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "toll", def: toll("Toll"), owner: P1 },
        { key: "att", def: character({ name: "Attacker" }), owner: P1 }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("att")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "attack declared with no payment");
    assert.equal(spent(engine, P1), 0);
  });

  rule("CR 505.1", "'for each attacking party': a second party formed the same turn costs 2 again", () => {
    const { engine, id } = tollBoard(4, 1, 2);
    attackWith(engine, [id("att0")]);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(spent(engine, P2), 2, "the first party cost 2");
    attackWith(engine, [id("att1")]);
    assert.equal(spent(engine, P2), 4, "the second party cost another 2");
  });

  rule("CR 505.1", "'for each attacking party': the second party cannot be formed when only 3 of the 4 needed are available", () => {
    const { engine, id } = tollBoard(3, 1, 2);
    attackWith(engine, [id("att0")]);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(spent(engine, P2), 2);
    refused(() => attackWith(engine, [id("att1")]), "second party with 1 resource left for a toll of 2", /pay|resource|enough|tax|attack/i);
    assert.equal(engine.state.battle, undefined);
  });

  rule("CR 505.1", "a requirement on the party itself: 'must have at least 2 members' refuses a smaller party (control: a big enough one is fine)", () => {
    const oaf = character({
      name: "Oaf",
      behavior: { abilities: [{ id: "oaf", type: "continuous", modifiers: [], partyRestriction: { role: "attacking", minMembers: 2 } }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "oaf", def: oaf, owner: P1 },
        { key: "friend", def: character({ name: "Friend" }), owner: P1 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("oaf")], target: { type: "faction", playerId: P2 } }),
      "attack with the oaf alone",
      /member|party|attack/i
    );
    assert.equal(engine.state.battle, undefined, "no attack");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("oaf"), id("friend")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: with a second member the party can be formed");
  });

  rule("CR 505.1", "a 'must attack' requirement: if its controller attacks at all, the character must be among the attackers", () => {
    const berserker = character({
      name: "Berserker",
      behavior: { abilities: [{ id: "must", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "mustAttack" }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "berserker", def: berserker, owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("other")], target: { type: "faction", playerId: P2 } }),
      "attack without the character that must attack",
      /must|attack/i
    );
    assert.equal(engine.state.battle, undefined);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("berserker"), id("other")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: including it works");
  });

  const forced = (name: string) =>
    character({
      name,
      behavior: { abilities: [{ id: "forced", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "mustBePicked" }] }] }
    });

  /** A tactic that picks `count` opposing characters and depletes them. */
  const depleter = (count: number) =>
    tactic({
      name: "Deplete",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count }],
            effects: [{ type: "forEach", selected: "t", effects: [{ type: "deplete", target: { type: "selected", id: "__candidate" } }] }]
          }
        ]
      }
    });

  const pickBoard = (count: number, forcedNames: string[], plain: string[]) =>
    buildGame({
      cards: [
        { key: "tac", def: depleter(count), owner: P1, zone: "hand" },
        ...forcedNames.map(name => ({ key: name, def: forced(name), owner: P2 })),
        ...plain.map(name => ({ key: name, def: character({ name }), owner: P2 }))
      ]
    });

  const pick = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, keys: string[]) =>
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tac"), selected: { t: keys.map(k => id(k)) } });

  rule("CR 505.1", "'must be picked': anything that could pick the card must pick it; picking a different card is refused", () => {
    const { engine, id } = pickBoard(1, ["X"], ["Z"]);
    refused(() => pick(engine, id, ["Z"]), "pick the other card while X must be picked", /pick|target|selection/i);
    pick(engine, id, ["X"]);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("X")]!.depleted, true, "control: the forced card can be picked");
    assert.equal(engine.state.cards[id("Z")]!.depleted, false);
  });

  rule("CR 505.2b", "example: two copies of 'must be picked' cards: you decide which of the two you must pick (either is allowed)", () => {
    const first = pickBoard(1, ["X", "Y"], ["Z"]);
    pick(first.engine, first.id, ["X"]);
    resolvePendingResponses(first.engine);
    assert.equal(first.engine.state.cards[first.id("X")]!.depleted, true, "picking the first is allowed");
    const second = pickBoard(1, ["X", "Y"], ["Z"]);
    pick(second.engine, second.id, ["Y"]);
    resolvePendingResponses(second.engine);
    assert.equal(second.engine.state.cards[second.id("Y")]!.depleted, true, "picking the second is allowed");
    const third = pickBoard(1, ["X", "Y"], ["Z"]);
    refused(() => pick(third.engine, third.id, ["Z"]), "pick a card that is neither of the two forced cards", /pick|target|selection/i);
  });

  rule("CR 505.2", "several requirements for the same action: you satisfy as many as you can (a two-card pick must include both forced cards)", () => {
    const { engine, id } = pickBoard(2, ["X", "Y"], ["Z"]);
    refused(() => pick(engine, id, ["X", "Z"]), "pick one forced card and a plain one when both forced cards could be picked", /pick|target|selection|include/i);
    pick(engine, id, ["X", "Y"]);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("X")]!.depleted, true, "control: picking both forced cards works");
    assert.equal(engine.state.cards[id("Y")]!.depleted, true);
  });

  rule("CR 505.2", "if only some of the requirements can be met you meet as many as possible: two forced cards but a one-card pick takes one of them", () => {
    const { engine, id } = pickBoard(1, ["X", "Y"], []);
    pick(engine, id, ["Y"]);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("Y")]!.depleted, true, "one of the two requirements was satisfied");
    assert.equal(engine.state.cards[id("X")]!.depleted, false);
  });

  rule("CR 505.2", "one forced card in a two-card pick: it must be among the cards picked, the other pick is free", () => {
    const { engine, id } = pickBoard(2, ["X"], ["Z", "W"]);
    refused(() => pick(engine, id, ["Z", "W"]), "two-card pick leaving out the forced card", /pick|target|selection|include/i);
    pick(engine, id, ["X", "W"]);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("X")]!.depleted, true, "control: the forced card plus a free pick works");
    assert.equal(engine.state.cards[id("W")]!.depleted, true);
  });

  rule("CR 505.2c", "it is invalid to reason that not taking the action satisfies the requirements: the action is still available and satisfies at least one", () => {
    const { engine, id } = pickBoard(1, ["X", "Y"], ["Z"]);
    assert.equal(engine.getCardPlayability(P1, id("tac")).playable, true, "the card is playable although the two requirements cannot both be met");
    pick(engine, id, ["X"]);
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("tac")), "discard", "the action was taken");
  });

  rule("CR 505.2", "two copies of a payment requirement: both must be fulfilled, to attack you must pay 4 (the printed example)", () => {
    const { engine, id } = tollBoard(4, 2);
    attackWith(engine, [id("att0")]);
    assert.equal(spent(engine, P2), 4, "both copies were paid: 2 + 2");
  });

  rule("CR 505.2a", "not having enough resources to pay a requirement cost is not 'impossible': with 3 of the 4 needed you cannot pay just one copy and attack", () => {
    const { engine, id } = tollBoard(3, 2);
    refused(() => attackWith(engine, [id("att0")]), "attack with 3 resources against two tolls of 2", /pay|resource|enough|tax|attack/i);
    assert.equal(engine.state.battle, undefined, "no attack");
    assert.equal(spent(engine, P2), 0, "nothing was paid toward either requirement");
  });

  rule("CR 505.2a", "a single requirement cost one resource short is likewise unmet, not waived", () => {
    const { engine, id } = tollBoard(1);
    refused(() => attackWith(engine, [id("att0")]), "attack with 1 resource against a toll of 2", /pay|resource|enough|tax|attack/i);
    const ok = tollBoard(2);
    attackWith(ok.engine, [ok.id("att0")]);
    assert.ok(ok.engine.state.battle, "control: with 2 it is met");
  });

  rule("CR 505.2c", "with several attack requirements (toll and 'must attack') the attack must satisfy all it can: paying and including the berserker", () => {
    const berserker = character({
      name: "Berserker",
      behavior: { abilities: [{ id: "must", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "mustAttack" }] }] }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "toll", def: toll("Toll"), owner: P1 },
        { key: "berserker", def: berserker, owner: P2 },
        { key: "other", def: character({ name: "Other" }), owner: P2 },
        ...rageBank(2, "pay", P2)
      ]
    });
    refused(() => attackWith(engine, [id("other")]), "attack without the berserker", /must|attack/i);
    assert.equal(spent(engine, P2), 0, "the refused attack cost nothing");
    attackWith(engine, [id("berserker"), id("other")]);
    assert.equal(spent(engine, P2), 2, "control: both requirements met, toll paid once for the one party");
  });

  rule("CR 505.2", "two 'must attack' requirements that cannot both be met (only one-member parties allowed): satisfy as many as possible, so either may attack alone", () => {
    const berserker = (name: string) =>
      character({
        name,
        behavior: { abilities: [{ id: "must", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "mustAttack" }] }] }
      });
    const alley = location({
      name: "Narrow Alley",
      behavior: { abilities: [{ id: "alley", type: "continuous", modifiers: [], partyRestriction: { role: "attacking", minMembers: 1, maxMembers: 1, scope: "allParties" } }] }
    });
    const build = () =>
      buildGame({
        cards: [
          { key: "alley", def: alley, owner: P2 },
          { key: "a", def: berserker("Berserker A"), owner: P1 },
          { key: "b", def: berserker("Berserker B"), owner: P1 },
          { key: "c", def: character({ name: "Plain" }), owner: P1 }
        ]
      });
    const viaA = build();
    viaA.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [viaA.id("a")], target: { type: "faction", playerId: P2 } });
    assert.ok(viaA.engine.state.battle, "attacking with the first must-attack character satisfies one of the two");
    const viaB = build();
    viaB.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [viaB.id("b")], target: { type: "faction", playerId: P2 } });
    assert.ok(viaB.engine.state.battle, "attacking with the second satisfies one of the two as well");
    const viaC = build();
    refused(
      () => viaC.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [viaC.id("c")], target: { type: "faction", playerId: P2 } }),
      "attacking with a plain character satisfies none of the requirements",
      /must|attack/i
    );
  });
});
