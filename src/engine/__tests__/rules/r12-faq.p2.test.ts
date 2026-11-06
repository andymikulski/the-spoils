// Batch r12-faq (docs/TESTING.md), part 2: Rules FAQ 2.0 rulings 7-12.
// Each ruling is reproduced with synthetic cards; expectations come from the
// FAQ's question and answer text, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const ACTIVATED = (effects: unknown[], extra: Record<string, unknown> = {}) =>
  ({ abilities: [{ id: "go", type: "activated", effects, ...extra }] }) as CardDefinition["behavior"];

const blank = (name: string) => tactic({ name });
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const gain = (amount: number) => ({ type: "modifyInfluence" as const, player: "controller" as const, amount });
const loggedEvents = (engine: SpoilsEngine, type: string) => engine.getLog().flatMap(entry => (entry.event?.type === type ? [entry.event] : []));

describe("FAQ 7 — flipping a card face-down as a resource", () => {
  /** A tactic that flips the picked character face-down ("put it into play as a face-down resource"). */
  const flipper = () =>
    tactic({
      name: "Flipper",
      behavior: ACTIVATED([{ type: "flipFaceDown", target: { type: "selected", id: "t" } }], {
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }]
      })
    });
  const watcher = () =>
    character({
      name: "Watcher",
      behavior: {
        abilities: [
          { id: "entered", type: "triggered", event: "cardEnteredPlay", effects: [gain(1)] },
          {
            id: "left",
            type: "triggered",
            event: "cardMoved",
            condition: { type: "cardMovedFromZone", zone: "play" },
            effects: [gain(10)]
          }
        ]
      }
    });
  const subject = () =>
    character({
      name: "Subject",
      strength: 2,
      life: 5,
      behavior: {
        abilities: [
          { id: "self-left", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, effects: [gain(100)] },
          { id: "buff", type: "continuous", modifiers: [] }
        ]
      }
    });

  function flipSubject() {
    const g = buildGame({
      cards: [
        { key: "flipper", def: flipper(), owner: P1, zone: "hand" },
        { key: "subject", def: subject(), owner: P1, damage: 2, counters: { token: 2 }, depleted: true },
        { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1, attachedToKey: "subject" }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("flipper"), selected: { t: [g.id("subject")] } });
    resolvePendingResponses(g.engine);
    return g;
  }

  rule("FAQ 7", "a card flipped face-down as a resource is a new card: damage, tokens and depleted status are gone and it is a face-down resource", () => {
    const { engine, id } = flipSubject();
    const card = engine.state.cards[id("subject")]!;
    assert.equal(card.zone, "play", "it is still in play, as a resource");
    assert.equal(card.faceDown, true, "face-down");
    assert.equal(card.damage, 0, "the damage did not carry over");
    assert.deepEqual(card.counters, {}, "the tokens did not carry over");
    assert.equal(card.depleted, false, "the depleted status did not carry over");
  });

  rule("FAQ 7", "it is considered to have left play: its own 'leaves play' trigger fires", () => {
    const { engine } = flipSubject();
    assert.equal(engine.state.players[P1].influence, 25 + 100, "the Subject's own leaves-play trigger resolved");
    assert.equal(loggedEvents(engine, "cardMoved").length >= 1, true, "a leaves-play event was reported");
  });

  rule("FAQ 7", "and reentered play as an entirely new card: an 'enters play' trigger sees the face-down card come in", () => {
    const g = buildGame({
      cards: [
        { key: "flipper", def: flipper(), owner: P1, zone: "hand" },
        { key: "subject", def: character({ name: "Plain Subject" }), owner: P1 },
        { key: "watcher", def: watcher(), owner: P1 }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("flipper"), selected: { t: [g.id("subject")] } });
    resolvePendingResponses(g.engine);
    const entered = loggedEvents(g.engine, "cardEnteredPlay").filter(e => e.type === "cardEnteredPlay" && e.cardId === g.id("subject"));
    assert.equal(entered.length, 1, "one enters-play event for the flipped card");
    assert.equal(g.engine.state.players[P1].influence, 25 + 10 + 1, "the watcher saw it leave (+10) and enter (+1)");
  });

  rule("FAQ 7", "a card attached to the flipped card is no longer attached to it: the flipped card is a new card with nothing on it", () => {
    const { engine, id } = flipSubject();
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, undefined, "the gear is no longer attached to the Subject");
  });

  rule("FAQ 7", "control: a card that is not flipped keeps its damage and tokens", () => {
    const g = buildGame({
      cards: [
        { key: "other", def: blank("Other"), owner: P1, zone: "hand" },
        { key: "subject", def: subject(), owner: P1, damage: 2, counters: { token: 2 } }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("other") });
    resolvePendingResponses(g.engine);
    const card = g.engine.state.cards[g.id("subject")]!;
    assert.equal(card.damage, 2);
    assert.equal(card.counters.token, 2);
  });

  rule("FAQ 7", "flipping up from the resource row is also leaving and re-entering play: an 'enters play' trigger fires and the card cannot attack this turn", () => {
    const flippable = character({ name: "Flippable", strength: 2, life: 3, flipUp: { cost: 0, threshold: 0 } });
    const g = buildGame({
      cards: [
        { key: "down", def: flippable, owner: P1, faceDown: true },
        { key: "veteran", def: character({ name: "Veteran" }), owner: P1 },
        { key: "watcher", def: watcher(), owner: P1 }
      ]
    });
    g.engine.perform({ type: "flipUp", playerId: P1, cardId: g.id("down") });
    resolvePendingResponses(g.engine);
    const card = g.engine.state.cards[g.id("down")]!;
    assert.equal(card.faceDown, false, "flipped up");
    assert.equal(card.zone, "play");
    const entered = loggedEvents(g.engine, "cardEnteredPlay").filter(e => e.type === "cardEnteredPlay" && e.cardId === g.id("down"));
    assert.equal(entered.length, 1, "it entered play as a new card");
    assert.ok(g.engine.state.players[P1].influence >= 26, "the 'enters play' watcher triggered");
    refused(
      () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("down")], target: { type: "faction", playerId: P2 } }),
      "attacking with a card that just entered play",
      /started|turn|eligible|cannot attack/i
    );
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("veteran")], target: { type: "faction", playerId: P2 } });
    assert.ok(g.engine.state.battle, "control: a character that was already in play can attack");
  });
});

describe("FAQ 8 — Recur is an ability, not a tactic", () => {
  /** A tactic with a printed RECUR (named, costs 1 and removes the card from the game, gain 3). */
  const fit = () =>
    tactic({
      name: "Fit For A King",
      behavior: {
        abilities: [
          { id: "body", type: "activated", effects: [gain(1)] },
          {
            id: "recur",
            name: "Recur",
            type: "activated",
            activationZone: "discard",
            costs: [{ type: "payResources", amount: 1 }, { type: "removeFromGame", target: "source" }],
            effects: [gain(3)]
          }
        ]
      }
    });
  /** "This turn, tactics cannot be deployed" (the Tactician Vacation shape). */
  const noTactics = () =>
    tactic({
      name: "No Tactics",
      behavior: ACTIVATED([{ type: "forEachPlayer", effects: [{ type: "restrictPlay", player: "controller", kind: "cardType", cardType: "tactic", duration: { type: "untilEndOfTurn" } }] }])
    });
  const tacticWatcher = () =>
    character({
      name: "Tactic Watcher",
      behavior: { abilities: [{ id: "seen", type: "triggered", event: "cardPlayed", effects: [gain(20)] }] }
    });

  const board = (extra: NonNullable<Parameters<typeof buildGame>[0]>["cards"] = []) =>
    buildGame({
      cards: [
        { key: "fit", def: fit(), owner: P1, zone: "discard" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1 },
        ...(extra ?? [])
      ]
    });

  rule("FAQ 8", "using Recur from the discard pile is using an ability: it resolves its effect, and the card is removed from the game as the cost", () => {
    const { engine, id } = board();
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fit"), abilityId: "recur" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 28, "the Recur effect (+3) resolved");
    assert.equal(zone(engine, id("fit")), "removed", "removed from the game as part of the cost");
    assert.equal(loggedEvents(engine, "abilityActivated").some(e => e.type === "abilityActivated" && e.abilityId === "recur"), true, "reported as an ability activation");
  });

  rule("FAQ 8", "using Recur is not playing a tactic: no card-played event, so a 'whenever a card is played' watcher does not fire (control: playing the tactic from hand does)", () => {
    const withWatcher = board([{ key: "watcher", def: tacticWatcher(), owner: P1 }]);
    withWatcher.engine.perform({ type: "activateAbility", playerId: P1, cardId: withWatcher.id("fit"), abilityId: "recur" });
    resolvePendingResponses(withWatcher.engine);
    assert.equal(loggedEvents(withWatcher.engine, "cardPlayed").length, 0, "no card was played");
    assert.equal(withWatcher.engine.state.players[P1].influence, 28, "only the Recur effect: the watcher did not fire");

    const control = buildGame({
      cards: [
        { key: "fit", def: fit(), owner: P1, zone: "hand" },
        { key: "watcher", def: tacticWatcher(), owner: P1 }
      ]
    });
    control.engine.perform({ type: "playCard", playerId: P1, cardId: control.id("fit") });
    resolvePendingResponses(control.engine);
    assert.equal(control.engine.state.players[P1].influence, 25 + 1 + 20, "control: playing it as a tactic does fire the watcher");
  });

  rule("FAQ 8", "Recur is not affected by 'tactics cannot be deployed': the restriction refuses a tactic from hand but not the ability", () => {
    const g = board([
      { key: "stop", def: noTactics(), owner: P1, zone: "hand" },
      { key: "spare", def: blank("Spare"), owner: P1, zone: "hand" }
    ]);
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("stop") });
    resolvePendingResponses(g.engine);
    refused(() => g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("spare") }), "deploying a tactic after the restriction", /deployed right now|cannot/i);
    g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("fit"), abilityId: "recur" });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.players[P1].influence, 28, "the Recur still worked");
  });

  rule("FAQ 8", "Recur follows ability timing: it can be used in response on the opponent's turn", () => {
    const poker = character({ name: "Poker", behavior: ACTIVATED([gain(1)]) });
    const g = buildGame({
      cards: [
        { key: "poker", def: poker, owner: P2 },
        { key: "fit", def: fit(), owner: P1, zone: "discard" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1 }
      ],
      activePlayerId: P2,
      turn: 2
    });
    g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("poker"), abilityId: "go" });
    g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("fit"), abilityId: "recur" });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.players[P1].influence, 28, "recurred in response");
  });

  rule("FAQ 8", "Recur has a cost: without a resource to pay it the ability is refused and the card stays in the discard pile", () => {
    const g = buildGame({ cards: [{ key: "fit", def: fit(), owner: P1, zone: "discard" }] });
    refused(() => g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("fit"), abilityId: "recur" }), "Recur with nothing to pay", /resource|pay|afford|cost/i);
    assert.equal(zone(g.engine, g.id("fit")), "discard");
  });
});

describe("FAQ 9 — a character with 0 life", () => {
  rule("FAQ 9", "a character with 0 life is destroyed: its 0 damage is equal to its 0 life", () => {
    const { engine, id } = buildGame({ cards: [{ key: "wisp", def: character({ name: "Wisp", life: 0 }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("wisp") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wisp")]!.damage, 0, "it has no damage");
    assert.equal(zone(engine, id("wisp")), "discard", "yet it is destroyed because 0 damage >= 0 life");
  });

  rule("FAQ 9", "a character that is reduced to 0 life by an effect is destroyed with no damage on it; at 1 life it survives (boundary)", () => {
    const shrink = (amount: number) =>
      tactic({
        name: `Shrink ${amount}`,
        behavior: ACTIVATED(
          [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: -amount, duration: { type: "untilEndOfTurn" } }],
          { targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }] }
        )
      });
    const one = buildGame({
      cards: [
        { key: "shrink", def: shrink(1), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 2 }), owner: P2 }
      ]
    });
    one.engine.perform({ type: "playCard", playerId: P1, cardId: one.id("shrink"), selected: { t: [one.id("victim")] } });
    resolvePendingResponses(one.engine);
    assert.equal(one.engine.getStat(one.id("victim"), "life"), 1);
    assert.equal(zone(one.engine, one.id("victim")), "play", "1 life, 0 damage: alive");

    const two = buildGame({
      cards: [
        { key: "shrink", def: shrink(2), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 2 }), owner: P2 }
      ]
    });
    two.engine.perform({ type: "playCard", playerId: P1, cardId: two.id("shrink"), selected: { t: [two.id("victim")] } });
    resolvePendingResponses(two.engine);
    assert.equal(zone(two.engine, two.id("victim")), "discard", "0 life, 0 damage: destroyed");
  });
});

describe("FAQ 10 — damage does not reduce life", () => {
  rule("FAQ 10", "a 5-life character with 2 damage still has 5 life (and 2 damage)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "tough", def: character({ name: "Tough", life: 5 }), owner: P1, damage: 2 }] });
    assert.equal(engine.getStat(id("tough"), "life"), 5, "life is the printed value");
    assert.equal(engine.state.cards[id("tough")]!.damage, 2, "the damage is tracked separately");
    assert.equal(zone(engine, id("tough")), "play");
  });

  rule("FAQ 10", "life is the printed stat plus or minus modifications from other effects, never reduced by damage", () => {
    const aura = item({
      name: "Aura Gear",
      attachTo: "character",
      behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 2 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "tough", def: character({ name: "Tough", life: 5 }), owner: P1, damage: 2 },
        { key: "aura", def: aura, owner: P1, attachedToKey: "tough" }
      ]
    });
    assert.equal(engine.getStat(id("tough"), "life"), 7, "5 printed + 2 from the item; the 2 damage is not subtracted");
  });

  rule("FAQ 10", "the character is destroyed when damage reaches its life: 4 damage on 5 life survives, 5 destroys", () => {
    const hit = (amount: number) =>
      tactic({
        name: `Hit ${amount}`,
        behavior: ACTIVATED([{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }], {
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }]
        })
      });
    const four = buildGame({
      cards: [
        { key: "hit", def: hit(2), owner: P1, zone: "hand" },
        { key: "tough", def: character({ name: "Tough", life: 5 }), owner: P2, damage: 2 }
      ]
    });
    four.engine.perform({ type: "playCard", playerId: P1, cardId: four.id("hit"), selected: { t: [four.id("tough")] } });
    resolvePendingResponses(four.engine);
    assert.equal(four.engine.state.cards[four.id("tough")]!.damage, 4);
    assert.equal(zone(four.engine, four.id("tough")), "play", "4 damage on 5 life: alive");

    const five = buildGame({
      cards: [
        { key: "hit", def: hit(3), owner: P1, zone: "hand" },
        { key: "tough", def: character({ name: "Tough", life: 5 }), owner: P2, damage: 2 }
      ]
    });
    five.engine.perform({ type: "playCard", playerId: P1, cardId: five.id("hit"), selected: { t: [five.id("tough")] } });
    resolvePendingResponses(five.engine);
    assert.equal(zone(five.engine, five.id("tough")), "discard", "5 damage on 5 life: destroyed");
  });
});

describe("FAQ 11 / 12 — Unique", () => {
  const rudo = (name = "Rudo", unique = "rudolphus") => character({ name, unique, strength: 1, life: 3 });
  const take = () =>
    tactic({
      name: "Take",
      behavior: ACTIVATED([{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }], {
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }]
      })
    });

  rule("FAQ 11", "the same Unique card can be in play for both players: neither is destroyed and nobody is asked to choose", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: rudo(), owner: P1 },
        { key: "poke", def: character({ name: "Poker", behavior: ACTIVATED([gain(1)]) }), owner: P1 },
        { key: "theirs", def: rudo(), owner: P2 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poke"), abilityId: "go" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "no Unique choice is raised");
    assert.equal(zone(engine, id("mine")), "play");
    assert.equal(zone(engine, id("theirs")), "play");
  });

  rule("FAQ 11", "taking control of the opponent's copy puts two under one controller: one must go (the controller is asked)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: rudo(), owner: P1 },
        { key: "theirs", def: rudo(), owner: P2 },
        { key: "take", def: take(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("take"), selected: { t: [id("theirs")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "uniqueSurvivor", "two copies under one player's control");
    assert.equal(pending?.playerId, P1, "the controller of both decides");
    if (pending?.kind !== "uniqueSurvivor") return;
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("theirs") } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("theirs")), "play", "the stolen copy stayed");
    assert.equal(zone(engine, id("mine")), "discard", "the other copy was destroyed");
  });

  rule("FAQ 11", "a different Unique designation is not a conflict even with the same name", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: rudo("Rudo", "alpha"), owner: P1 },
        { key: "b", def: rudo("Rudo", "beta"), owner: P1 },
        { key: "poke", def: character({ name: "Poker", behavior: ACTIVATED([gain(1)]) }), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poke"), abilityId: "go" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zone(engine, id("a")), "play");
    assert.equal(zone(engine, id("b")), "play");
  });

  const deployTwin = (keepKey: "first" | "second") => {
    const g = buildGame({
      cards: [
        { key: "first", def: rudo(), owner: P1 },
        { key: "second", def: rudo(), owner: P1, zone: "hand" }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("second") });
    resolvePendingResponses(g.engine);
    const pending = g.engine.state.pendingChoice;
    assert.equal(pending?.kind, "uniqueSurvivor", "the second copy raises the Unique choice");
    assert.equal(pending?.playerId, P1);
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id(keepKey) } });
    resolvePendingResponses(g.engine);
    return g;
  };

  rule("FAQ 12", "two copies of the same Unique card under one player: one is destroyed immediately and the controller keeps either one (keep the old copy)", () => {
    const g = deployTwin("first");
    assert.equal(zone(g.engine, g.id("first")), "play", "the chosen copy stays");
    assert.equal(zone(g.engine, g.id("second")), "discard", "the other is destroyed");
    assert.equal(g.engine.state.pendingChoice, undefined);
  });

  rule("FAQ 12", "the controller may equally keep the newly deployed copy (keep the new copy)", () => {
    const g = deployTwin("second");
    assert.equal(zone(g.engine, g.id("second")), "play");
    assert.equal(zone(g.engine, g.id("first")), "discard");
  });

  rule("FAQ 12", "'immediately': nothing else can happen until the controller has chosen, and the choice cannot be made by the opponent", () => {
    const g = buildGame({
      cards: [
        { key: "first", def: rudo(), owner: P1 },
        { key: "second", def: rudo(), owner: P1, zone: "hand" }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("second") });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.pendingChoice?.kind, "uniqueSurvivor");
    refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "uniqueSurvivor", keep: g.id("first") } }), "the opponent choosing which copy survives", /not your/i);
    refused(() => g.engine.perform({ type: "endTurn", playerId: P1 }), "ending the turn with a Unique choice open", /pending|choice|decision|resolve/i);
    assert.equal(zone(g.engine, g.id("first")), "play", "both still in play until chosen");
    assert.equal(zone(g.engine, g.id("second")), "play");
  });

  rule("FAQ 12", "three copies of the same Unique card: only one survives", () => {
    const g = buildGame({
      cards: [
        { key: "a", def: rudo(), owner: P1 },
        { key: "b", def: rudo(), owner: P1 },
        { key: "c", def: rudo(), owner: P1, zone: "hand" }
      ]
    });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("c") });
    resolvePendingResponses(g.engine);
    for (let guard = 0; guard < 5 && g.engine.state.pendingChoice?.kind === "uniqueSurvivor"; guard++) {
      const pending = g.engine.state.pendingChoice;
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: pending.candidates[0]! } });
      resolvePendingResponses(g.engine);
    }
    const inPlay = ["a", "b", "c"].filter(key => zone(g.engine, g.id(key)) === "play");
    assert.equal(inPlay.length, 1, "exactly one copy remains in play");
  });
});
