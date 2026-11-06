// Batch r06-keywords (docs/TESTING.md): CR 507 Keywords. Part 1: keywords in general, Attach to [Type].
// Written from the wording of the Comprehensive Rules, not from the engine.
// (Covert: .p3; Flip Up: .p2; Unique and Tactical: .p4.)

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, TriggeredAbility } from "../../../engine.js";
import { buildGame, character, item, location, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";


const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

/** "When this card enters play, its controller gains 1 influence." */
const ON_ENTER: TriggeredAbility = {
  id: "on-enter",
  type: "triggered",
  event: "cardEnteredPlay",
  condition: { type: "sourceIsEventCard" },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

/** "When this card is destroyed, its controller gains 1 influence." */
const ON_DESTROYED: TriggeredAbility = {
  id: "on-destroyed",
  type: "triggered",
  event: "cardDestroyed",
  condition: { type: "sourceIsEventCard" },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

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

/** Plays `cardId` for `playerId` and settles every response window. */
function playAndSettle(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, selected?: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "playCard", playerId, cardId, ...(selected ? { selected } : {}) });
  resolvePendingResponses(engine);
}


const COVERT = { keywords: ["covert" as const] };

describe("CR 507.1 — keywords in general", () => {
  rule("CR 507.1", "a keyword listed on the card is active with no activation: the card has it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "plain", def: character({ name: "Plain" }), owner: P1 },
        { key: "sneak", def: character({ name: "Sneak", behavior: COVERT }), owner: P1 }
      ]
    });
    assert.equal(engine.hasKeyword(id("sneak"), "covert"), true, "the listed keyword is active");
    assert.deepEqual(engine.getKeywords(id("sneak")), ["covert"], "it has exactly the listed keyword");
    assert.equal(engine.hasKeyword(id("plain"), "covert"), false, "control: a card without it does not have it");
  });

  rule("CR 507.1", "a keyword listed on the card is active for either player's card", () => {
    const { engine, id } = buildGame({ cards: [{ key: "theirs", def: character({ name: "Theirs", behavior: COVERT }), owner: P2 }] });
    assert.equal(engine.hasKeyword(id("theirs"), "covert"), true);
  });

  rule("CR 507.1", "a card has a keyword when it gains it through an effect", () => {
    const granter = character({
      name: "Granter",
      behavior: {
        abilities: [
          {
            id: "give",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "granter", def: granter, owner: P1 },
        { key: "friend", def: character({ name: "Friend" }), owner: P1 }
      ]
    });
    assert.equal(engine.hasKeyword(id("friend"), "covert"), false, "before the effect");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("granter"), abilityId: "give", selected: { t: [id("friend")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("friend"), "covert"), true, "after the effect");
  });

  rule("CR 507.1", "a card has a keyword when it gains it through rules text (a continuous ability of an attached card)", () => {
    const cloak = item({
      name: "Cloak",
      attachTo: "character",
      behavior: {
        abilities: [{ id: "grant", type: "continuous", modifiers: [], keywords: [{ target: "attachedTo", keyword: "covert" }] }]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1 },
        { key: "cloak", def: cloak, owner: P1, attachedToKey: "host" }
      ]
    });
    assert.equal(engine.hasKeyword(id("host"), "covert"), true, "the attached character has the keyword");
    assert.equal(engine.hasKeyword(id("other"), "covert"), false, "control: another character does not");
  });

  rule("CR 507.1", "a keyword mentioned in an effect does not give the card that keyword", () => {
    const granter = character({
      name: "Granter",
      behavior: {
        abilities: [
          {
            id: "give",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "granter", def: granter, owner: P1 },
        { key: "friend", def: character({ name: "Friend" }), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("granter"), abilityId: "give", selected: { t: [id("friend")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("friend"), "covert"), true, "control: the recipient has it");
    assert.equal(engine.hasKeyword(id("granter"), "covert"), false, "the card whose text mentions the keyword does not");
    assert.deepEqual(engine.getKeywords(id("granter")), [], "and has no keyword at all");
  });

  rule("CR 507.1", "a keyword mentioned in a condition of the card's rules text does not give the card that keyword", () => {
    const watcher = character({
      name: "Watcher",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            condition: { type: "hasKeyword", target: "source", keyword: "covert" },
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "watcher", def: watcher, owner: P1 }] });
    assert.equal(engine.hasKeyword(id("watcher"), "covert"), false, "mentioning covert in a condition is not having covert");
    assert.equal(engine.getStat(id("watcher"), "strength"), 1, "so the conditional bonus is off");
  });

  rule("CR 507.1", "a keyword mentioned in a continuous grant to other cards leaves the granting card without it", () => {
    const lord = character({
      name: "Lord",
      behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [], keywords: [{ selector: { controller: "self", type: "character", name: "Friend" }, keyword: "covert" }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "lord", def: lord, owner: P1 },
        { key: "friend", def: character({ name: "Friend" }), owner: P1 }
      ]
    });
    assert.equal(engine.hasKeyword(id("friend"), "covert"), true, "control: the granted card has it");
    assert.equal(engine.hasKeyword(id("lord"), "covert"), false, "the card whose text mentions the keyword does not");
  });
});

describe("CR 507.2 — attach to [type]", () => {
  const gearDef = (extra: Partial<CardDefinition> = {}) => item({ name: "Gear", attachTo: "character", ...extra });

  const board = (extra: Partial<CardDefinition> = {}) =>
    buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "spare", def: character({ name: "Spare" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "gear", def: gearDef(extra), owner: P1, zone: "hand" }
      ]
    });

  rule("CR 507.2a", "playing an attaching card with a picked target card: it enters play attached to that card when it resolves", () => {
    const { engine, id } = board();
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("host")] } });
    assert.notEqual(zoneOf(engine, id("gear")), "play", "while it is on the stack it is not yet in play");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, undefined, "and not yet attached");
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("gear")), "play");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("host"), "it entered play attached to the picked card");
    assert.equal(engine.state.cards[id("spare")]!.attachedTo, undefined, "nothing else became attached");
  });

  rule("CR 507.2a", "the target is a required pick: playing the card without picking one is refused (control: with a pick it works)", () => {
    const { engine, id } = board();
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("gear") }), "attaching card played with no target", /selection|target|deploy/i);
    assert.equal(zoneOf(engine, id("gear")), "hand", "nothing happened");
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("host")] });
    assert.equal(zoneOf(engine, id("gear")), "play", "control: with a pick it is played");
  });

  rule("CR 507.2a", "the target must be of the appropriate type: an item cannot host an 'attach to character' card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "wrong", def: item({ name: "Wrong" }), owner: P1 },
        { key: "gear", def: gearDef(), owner: P1, zone: "hand" }
      ]
    });
    refused(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("wrong")] } }),
      "attach to character, picking an item",
      /selection|target|deploy|legal/i
    );
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("host")] });
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("host"), "control: a character host works");
  });

  rule("CR 507.2a", "an 'attach to item' card takes an item and refuses a character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: item({ name: "Host Item" }), owner: P1 },
        { key: "chara", def: character({ name: "Chara" }), owner: P1 },
        { key: "mod", def: item({ name: "Mod", attachTo: "item" }), owner: P1, zone: "hand" }
      ]
    });
    refused(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("mod"), selected: { attachTo: [id("chara")] } }),
      "attach to item, picking a character",
      /selection|target|deploy|legal/i
    );
    playAndSettle(engine, P1, id("mod"), { attachTo: [id("host")] });
    assert.equal(engine.state.cards[id("mod")]!.attachedTo, id("host"), "control: an item host works");
  });

  rule("CR 507.2a", "the target must be in play: a character in the hand or discard pile is not a legal target", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
        { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: gearDef(), owner: P1, zone: "hand" }
      ]
    });
    for (const key of ["inHand", "inDiscard"]) {
      refused(
        () => engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id(key)] } }),
        `attach target ${key}`,
        /selection|target|deploy|legal/i
      );
    }
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("host")] });
    assert.equal(zoneOf(engine, id("gear")), "play", "control: a character in play works");
  });

  rule("CR 507.2a", "an unrestricted 'attach to character' may be attached to an opponent's character", () => {
    const { engine, id } = board();
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("foe")] });
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("foe"), "attached to the opponent's character");
    assert.equal(engine.state.cards[id("gear")]!.controllerId, P1, "the player who deployed it still controls it");
  });

  rule("CR 507.2a", "'attach to a character you control' refuses the opponent's character (control: your own works)", () => {
    const { engine, id } = board({ attachToController: "self" });
    refused(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("foe")] } }),
      "host controlled by the opponent",
      /selection|target|deploy|legal/i
    );
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("host")] });
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("host"), "control: your own character works");
  });

  rule("CR 507.2a", "the target is picked as the first extra cost: a card a later extra cost destroys is still a legal target to pick", () => {
    // Extra cost 2: "destroy a character you control" (the pick `sac`). Target and sacrifice are the same card.
    const costly = gearDef({
      behavior: {
        onPlay: {
          targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "sac" } }]
        }
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: { ...costly, id: "costly-gear" }, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("host")], sac: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("host")), "discard", "the later extra cost destroyed the card the attach pick named");
    assert.equal(zoneOf(engine, id("gear")), "discard", "so the attaching card had no target left when it tried to enter play");
  });

  rule("CR 507.2b", "put into play by an effect that names no target: the controller picks a target card as it enters play", () => {
    const summoner = tactic({
      name: "Summoner",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "g", selector: { zone: "hand", name: "Gear" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "g" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "spare", def: character({ name: "Spare" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "gear", def: gearDef(), owner: P1, zone: "hand" },
        { key: "summoner", def: summoner, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("summoner"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.ok(pending, "the player is asked to pick a target card");
    assert.equal(pending?.playerId, P1, "the controller makes the pick");
    assert.equal(zoneOf(engine, id("gear")) === "play" && engine.state.cards[id("gear")]!.attachedTo === undefined, false, "it is not left in play unattached");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("spare")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("gear")), "play");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("spare"), "attached to the card that was picked");
  });

  rule("CR 507.2b", "the pick as it enters play must be of the appropriate type", () => {
    const summoner = tactic({
      name: "Summoner",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "g", selector: { zone: "hand", name: "Gear" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "g" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "wrong", def: item({ name: "Wrong" }), owner: P1 },
        { key: "gear", def: gearDef(), owner: P1, zone: "hand" },
        { key: "summoner", def: summoner, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("summoner"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("wrong")] } }),
      "pick an item for an attach-to-character card",
      /selection|target|legal|pick/i
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("host"), "control: a character pick works");
  });

  const putter = () =>
    tactic({
      name: "Putter",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "g", selector: { zone: ["hand", "discard", "deck"], name: "Gear" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "g" }, controller: "controller" }]
          }
        ]
      }
    });

  rule("CR 507.2c", "with no valid target card to pick, the attaching card goes to its owner's discard pile instead of entering play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "putter", def: putter(), owner: P1, zone: "hand" },
        { key: "gear", def: gearDef({ behavior: { abilities: [ON_ENTER] } }), owner: P1, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("putter"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "there is nothing to pick, so nothing is asked");
    assert.equal(zoneOf(engine, id("gear")), "discard", "it is put into its owner's discard pile");
    assert.ok(engine.state.players[P1].discard.includes(id("gear")), "in the owner's discard pile list");
    assert.equal(engine.state.players[P1].influence, before, "it never entered play, so its enters-play trigger did not happen");
  });

  rule("CR 507.2c", "no valid target and the card is put into play from the deck: it goes to its owner's discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "putter", def: putter(), owner: P1, zone: "hand" },
        { key: "gear", def: gearDef(), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("putter"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("gear")), "discard");
  });

  rule("CR 507.2c", "no valid target and the card was already in the discard pile: it just stays there", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "putter", def: putter(), owner: P1, zone: "hand" },
        { key: "gear", def: gearDef({ behavior: { abilities: [ON_DESTROYED] } }), owner: P1, zone: "discard" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("putter"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("gear")), "discard", "still in the discard pile");
    assert.equal(engine.state.players[P1].discard.filter(c => c === id("gear")).length, 1, "listed once");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].influence, before);
  });

  rule("CR 507.2c", "put into play under the opponent's control with no valid target: it goes to its owner's (not controller's) discard pile", () => {
    const thief = tactic({
      name: "Thief",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "g", selector: { zone: "discard", owner: "opponent", name: "Gear" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "g" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: thief, owner: P1, zone: "hand" },
        { key: "gear", def: gearDef(), owner: P2, zone: "discard" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("thief"), selected: { g: [id("gear")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("gear")), "discard", "it did not enter play");
    assert.ok(engine.state.players[P2].discard.includes(id("gear")), "it is in its owner's discard pile");
    assert.ok(!engine.state.players[P1].discard.includes(id("gear")), "and not in the other player's");
  });

  rule("CR 507.2c", "the target is no longer in play when the attaching card tries to enter play: it goes to its owner's discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: gearDef({ behavior: { abilities: [ON_ENTER] } }), owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("host")] } });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("host")), "discard", "the response destroyed the target");
    assert.equal(zoneOf(engine, id("gear")), "discard", "the attaching card goes to its owner's discard pile");
    assert.equal(engine.state.players[P1].influence, before, "it never entered play, so its enters-play trigger did not happen");
  });

  rule("CR 507.2c", "control: when the target is still in play at resolution the attaching card does enter play and its trigger happens", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: gearDef({ behavior: { abilities: [ON_ENTER] } }), owner: P1, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("host")] });
    assert.equal(zoneOf(engine, id("gear")), "play");
    assert.equal(engine.state.players[P1].influence, before + 1, "its enters-play trigger happened");
  });

  rule("CR 507.2d", "put into play at the same time as another card: the other card can be selected as the target", () => {
    // One effect puts every card in the discard pile into play at once (a character and an attaching card).
    // The attaching card is listed first, so the character is not yet in play when it is considered.
    const reviver = tactic({
      name: "Reviver",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: { zone: "discard", owner: "self", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "tactic" } }] },
                effects: [{ type: "putIntoPlay", target: { type: "selected", id: "__candidate" }, controller: "controller" }]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "gear", def: gearDef(), owner: P1, zone: "discard" },
        { key: "body", def: character({ name: "Body" }), owner: P1, zone: "discard" },
        { key: "reviver", def: reviver, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("reviver") });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice) {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("body")] } });
      resolvePendingResponses(engine);
    }
    assert.equal(zoneOf(engine, id("body")), "play", "the character entered play");
    assert.equal(zoneOf(engine, id("gear")), "play", "the attaching card entered play too");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("body"), "attached to the card that entered at the same time");
  });

  rule("CR 507.2e", "the target stops being the appropriate type: the attaching card is destroyed immediately", () => {
    // An item animated into a character hosts an 'attach to character' card; when the item stops being a character the card is destroyed.
    const animate = tactic({
      name: "Animate",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "item" }, count: 1 }],
            effects: [
              {
                type: "setCardType",
                target: { type: "selected", id: "t" },
                cardType: "character",
                grantStats: { strength: 1, life: 3, speed: 1 },
                duration: { type: "permanent" }
              }
            ]
          }
        ]
      }
    });
    const unanimate = tactic({
      name: "Unanimate",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "removeCardType", target: { type: "selected", id: "t" }, cardType: "character" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "box", def: item({ name: "Box" }), owner: P1 },
        { key: "animate", def: animate, owner: P1, zone: "hand" },
        { key: "unanimate", def: unanimate, owner: P1, zone: "hand" },
        { key: "gear", def: gearDef({ behavior: { abilities: [ON_DESTROYED] } }), owner: P1, zone: "hand" }
      ]
    });
    playAndSettle(engine, P1, id("animate"), { t: [id("box")] });
    assert.equal(engine.hasCardType(id("box"), "character"), true, "the box is a character");
    playAndSettle(engine, P1, id("gear"), { attachTo: [id("box")] });
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("box"), "the gear is attached to the animated item");
    const before = engine.state.players[P1].influence;
    playAndSettle(engine, P1, id("unanimate"), { t: [id("box")] });
    assert.equal(zoneOf(engine, id("box")), "play", "the host itself is still in play");
    assert.equal(engine.hasCardType(id("box"), "character"), false, "but it is no longer a character");
    assert.equal(zoneOf(engine, id("gear")), "discard", "so the attaching card is gone");
    assert.equal(engine.state.players[P1].influence, before + 1, "destroyed (its when-destroyed trigger happened), not merely moved");
  });

  rule("CR 507.2e", "control: a host that is still the appropriate type keeps the attaching card in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: gearDef({ behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }), owner: P1, attachedToKey: "host" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gear"), abilityId: "noop" });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("gear")), "play");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, id("host"));
  });

  rule("CR 507.2a", "an attaching tactic is also played with a target card and enters play attached to it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "aura", def: tactic({ name: "Aura", attachTo: "character" }), owner: P1, zone: "hand" }
      ]
    });
    playAndSettle(engine, P1, id("aura"), { attachTo: [id("host")] });
    assert.equal(zoneOf(engine, id("aura")), "play", "the tactic stays in play");
    assert.equal(engine.state.cards[id("aura")]!.attachedTo, id("host"));
  });

  rule("CR 507.2a", "an attaching location is also played with a target card (location type, attach to character)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "place", def: location({ name: "Place", attachTo: "character" }), owner: P1, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("place") }), "attaching location without a target", /selection|target|deploy/i);
    playAndSettle(engine, P1, id("place"), { attachTo: [id("host")] });
    assert.equal(engine.state.cards[id("place")]!.attachedTo, id("host"), "control: with a target it attaches");
  });
});

