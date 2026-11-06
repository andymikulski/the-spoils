import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, bank, buildGame, character, developFaction, item, P1, P2, play, volition } from "./per-card/_harness.js";
import type { ActivatedAbility, CardDefinition, ContinuousAbility, Effect, TriggeredAbility } from "../../engine.js";

// Synthetic fixtures for two continuous-ability forms:
//   ContinuousAbility.providesGrants   ("Each resource you control that doesn't have PROVIDES: [D], gains PROVIDES: [D]")
//   ContinuousAbility.ignoresTriggers  ("ignore all triggers that begin with "when this card enters / leaves play"")

const sel = (id: string) => ({ type: "selected", id });
const ownPick = { id: "t", selector: { zone: "play", controller: "any" }, count: 1 };

/** A character that grants PROVIDES [D] to each resource its controller controls that lacks it. */
const broker = (name = "Broker", over: Partial<ContinuousAbility> = {}): CardDefinition =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "grant",
          type: "continuous",
          modifiers: [],
          providesGrants: [{ selector: { type: "resource", controller: "self" }, icon: "deception", onlyIfLacking: true }],
          ...over
        } as ContinuousAbility
      ]
    }
  });

/** A helper whose abilities act on a picked card: flip it face-down / face-up, take control of it, destroy it. */
const operator = (): CardDefinition =>
  character({
    name: "Operator",
    life: 9,
    behavior: {
      abilities: (
        [
          ["down", { type: "flipFaceDown", target: sel("t") }],
          ["up", { type: "flipFaceUp", target: sel("t") }],
          ["steal", { type: "takeControl", target: sel("t"), controller: "controller" }],
          ["kill", { type: "destroy", target: sel("t") }]
        ] as Array<[string, Effect]>
      ).map(([id, effect]) => ({ id, type: "activated", targets: [ownPick], effects: [effect] }) as unknown as ActivatedAbility)
    }
  });

const dec = (b: { engine: { getThresholds(p: string): { deception?: number } } }, p = P1) => b.engine.getThresholds(p).deception ?? 0;

describe("ContinuousAbility.providesGrants (continuous PROVIDES grant)", () => {
  test("every resource its controller controls that lacks the icon gains it; one that has it does not gain a second", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, ...bank("rage", 2), ...bank("deception", 1), ...volition(1)]
    });
    // 2 rage + 1 face-down gain [D]; the deception resource already has it (no double).
    assert.equal(dec(b), 4);
    assert.equal(b.engine.getThresholds(P1).rage, 2, "their own icons stay");
    assert.equal(b.engine.getThresholds(P1).volition, 1);
  });

  test("a face-down resource gains it (it is a resource and lacks [D])", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, ...volition(2)]
    });
    assert.equal(dec(b), 2);
    assert.equal(b.engine.getThresholds(P1).volition, 2);
  });

  test("the opponent's resources and the source's controller's non-resources are not reached", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, ...bank("rage", 2, P2), { key: "ch", def: character({ name: "Plain" }), owner: P1 }]
    });
    assert.equal(dec(b, P2), 0);
    assert.equal(dec(b, P1), 0, "the Broker itself and a plain character are not resources");
  });

  test("it does nothing while the source is not in play, and it stops when the source leaves play", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "br", def: broker(), owner: P1, zone: "hand" },
        { key: "op", def: operator(), owner: P1 },
        ...bank("rage", 1)
      ]
    });
    assert.equal(dec(b), 0, "in hand");
    b.engine.state.cards[b.id("br")].zone = "play";
    b.engine.state.players[P1].hand = b.engine.state.players[P1].hand.filter(c => c !== b.id("br"));
    b.engine.state.players[P1].play.push(b.id("br"));
    assert.equal(dec(b), 1, "in play");
    activate(b.engine, P1, b.id("op"), "kill", { selected: { t: [b.id("br")] } });
    assert.equal(dec(b), 0, "destroyed");
  });

  test("a resource that enters later is reached; one flipped face-up stops being a resource and loses it", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "br", def: broker(), owner: P1 },
        { key: "op", def: operator(), owner: P1 },
        { key: "ch", def: character({ name: "Soon A Resource", life: 4 }), owner: P1 },
        ...bank("rage", 1)
      ]
    });
    assert.equal(dec(b), 1);
    activate(b.engine, P1, b.id("op"), "down", { selected: { t: [b.id("ch")] } });
    assert.equal(dec(b), 2, "the flipped-down character is now a face-down resource");
    activate(b.engine, P1, b.id("op"), "up", { selected: { t: [b.id("ch")] } });
    assert.equal(dec(b), 1, "face-up again: a character, not a resource");
  });

  test("it follows control: a resource taken by the opponent no longer gets it, the Broker's new controller's resources do", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "br", def: broker(), owner: P1 },
        { key: "op2", def: operator(), owner: P2 },
        { key: "mine", def: bank("rage", 1)[0].def, owner: P1 },
        { key: "theirs", def: bank("rage", 1, P2)[0].def, owner: P2 }
      ]
    });
    assert.equal(dec(b, P1), 1);
    assert.equal(dec(b, P2), 0);
    // P2 takes P1's resource: it is no longer a resource P1 controls (and P2 has no Broker).
    b.engine.state.activePlayerId = P2;
    b.engine.state.priorityPlayerId = P2;
    activate(b.engine, P2, b.id("op2"), "steal", { selected: { t: [b.id("mine")] } });
    assert.equal(dec(b, P1), 0);
    assert.equal(dec(b, P2), 0, "P2's resources are not the Broker's controller's");
    // P2 takes the Broker: now P2's resources (both) gain it.
    activate(b.engine, P2, b.id("op2"), "steal", { selected: { t: [b.id("br")] } });
    assert.equal(dec(b, P2), 2);
    assert.equal(dec(b, P1), 0);
  });

  test("two sources give a lacking resource one icon with onlyIfLacking, two without", () => {
    const lacking = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "a", def: broker("A"), owner: P1 }, { key: "b", def: broker("B"), owner: P1 }, ...bank("rage", 1)]
    });
    assert.equal(dec(lacking), 1);

    const stacking = (name: string) => broker(name, { providesGrants: [{ selector: { type: "resource", controller: "self" }, icon: "deception" }] });
    const plain = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "a", def: stacking("A"), owner: P1 }, { key: "b", def: stacking("B"), owner: P1 }, ...bank("rage", 1)]
    });
    assert.equal(dec(plain), 2);
  });

  test("amount, and the ability's condition and suppression, are honoured", () => {
    const three = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "br", def: broker("Triple", { providesGrants: [{ selector: { type: "resource", controller: "self" }, icon: "greed", amount: 3 }] }), owner: P1 },
        ...bank("rage", 1)
      ]
    });
    assert.equal(three.engine.getThresholds(P1).greed, 3);

    const gated = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        {
          key: "br",
          def: broker("Gated", { condition: { type: "cardDepleted", target: "source" } }),
          owner: P1
        },
        ...bank("rage", 1)
      ]
    });
    assert.equal(dec(gated), 0, "condition false");
    gated.engine.state.cards[gated.id("br")].depleted = true;
    assert.equal(dec(gated), 1, "condition true");
  });

  test("a face-down source grants nothing (no rules text)", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1, faceDown: true }, ...bank("rage", 1)]
    });
    assert.equal(dec(b), 0, "a face-down Broker is just a Volition resource");
  });

  test("the cardProvides condition and the resourceIcons expression see the granted icon", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, ...bank("rage", 1)]
    });
    const rage = b.engine.state.players[P1].play.find(c => c !== b.id("br") && b.engine.state.cards[c].definitionId.startsWith("pc-res-"))!;
    const ctx = { sourceId: b.id("br"), controllerId: P1, abilityId: "grant", selected: {} };
    assert.equal(b.engine.evaluateCondition({ type: "cardProvides", target: { type: "selected", id: "x" }, icon: "deception", min: 1 } as never, { ...ctx, selected: { x: [rage] } }), true);
    assert.equal(b.engine.evaluateNumber({ type: "resourceIcons", player: "controller", icon: "deception" } as never, ctx), 1);
  });

  test("it opens a threshold: a character needing [D] cannot be deployed without the grant and can with it", () => {
    const needsD = character({ name: "Needs D", cost: 0, threshold: "d" });
    const without = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "c", def: needsD, owner: P1, zone: "hand" }, ...bank("rage", 1)]
    });
    assert.throws(() => play(without.engine, P1, without.id("c")), /threshold/i);

    const withBroker = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, { key: "c", def: needsD, owner: P1, zone: "hand" }, ...bank("rage", 1)]
    });
    play(withBroker.engine, P1, withBroker.id("c"));
    assert.equal(withBroker.engine.state.cards[withBroker.id("c")].zone, "play");
  });

  test("the read-only queries agree: getCardPlayability and getFlipUpPlayability count the granted icon (the flipping card's own icons do not count)", () => {
    const needsD = character({ name: "Needs D Q", cost: 0, threshold: "d" });
    const fd = {
      ...character({ name: "Flipper", cost: 0, threshold: "r", flipUp: { cost: 0, threshold: "d" } } as never),
      id: "flipper-d"
    } as CardDefinition;
    const cards = (withBroker: boolean) => [
      ...(withBroker ? [{ key: "br", def: broker(), owner: P1 }] : []),
      { key: "c", def: needsD, owner: P1, zone: "hand" as const },
      { key: "fd", def: fd, owner: P1, faceDown: true },
      ...bank("rage", 1)
    ];
    const off = buildGame({ playerA: { faction: developFaction() }, cards: cards(false) });
    assert.equal(off.engine.getCardPlayability(P1, off.id("c")).thresholdMet, false);
    assert.equal(off.engine.getFlipUpPlayability(P1, off.id("fd")).thresholdMet, false);

    const on = buildGame({ playerA: { faction: developFaction() }, cards: cards(true) });
    assert.equal(on.engine.getCardPlayability(P1, on.id("c")).thresholdMet, true);
    // The rage bank gains [D]; the face-down Flipper's own [D] is not counted (it will no longer be a resource).
    assert.equal(on.engine.getFlipUpPlayability(P1, on.id("fd")).thresholdMet, true);

    const alone = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, { key: "fd", def: fd, owner: P1, faceDown: true }]
    });
    assert.equal(alone.engine.getFlipUpPlayability(P1, alone.id("fd")).thresholdMet, false, "its own granted icon does not pay for its own FLIP UP");
  });

  test("a non-resource card that prints PROVIDES (an item) is not a resource and gets nothing", () => {
    const crest = item({ name: "Crest", resource: { provides: ["rage"] } } as never);
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: broker(), owner: P1 }, { key: "crest", def: crest, owner: P1 }]
    });
    assert.equal(b.engine.getThresholds(P1).rage, 1);
    assert.equal(dec(b), 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** Loses its controller 1 influence when it enters play ("When this card enters play, ..."). */
const etb = (name: string): CardDefinition =>
  character({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
        } as TriggeredAbility
      ]
    }
  });

/** Loses its controller 1 influence when it leaves play; and a separate loss of 2 when it is destroyed. */
const ltp = (name: string): CardDefinition =>
  character({
    name,
    cost: 0,
    life: 5,
    behavior: {
      abilities: [
        {
          id: "ltp",
          type: "triggered",
          event: "cardMoved",
          condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
          effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
        } as TriggeredAbility,
        {
          id: "dies",
          type: "triggered",
          event: "cardDestroyed",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: -2 }]
        } as TriggeredAbility
      ]
    }
  });

/** "When another card enters play" (no `sourceIsEventCard`): not a "this card" trigger. */
const watcher = (): CardDefinition =>
  character({
    name: "Watcher",
    behavior: {
      abilities: [
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
        } as TriggeredAbility
      ]
    }
  });

const hero = (over: Partial<ContinuousAbility> = {}): CardDefinition =>
  character({
    name: "Hero",
    behavior: {
      abilities: [
        { id: "ignore", type: "continuous", modifiers: [], ignoresTriggers: ["thisCardEntersPlay", "thisCardLeavesPlay"], ...over } as ContinuousAbility
      ]
    }
  });

const influence = (b: { engine: { state: { players: Record<string, { influence: number }> } } }, p: string) => b.engine.state.players[p].influence;

function boardWith(cards: Array<{ key: string; def: CardDefinition; owner: string; zone?: string; faceDown?: boolean }>) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    cards: cards as never
  });
}

describe("ContinuousAbility.ignoresTriggers (ignore the 'when this card enters / leaves play' triggers)", () => {
  test("baseline: without the source, an enters-play and a leaves-play trigger fire", () => {
    const b = boardWith([
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" },
      { key: "l", def: ltp("Ltp"), owner: P1 },
      { key: "op", def: operator(), owner: P1 }
    ]);
    const start = influence(b, P1);
    play(b.engine, P1, b.id("e"));
    assert.equal(influence(b, P1), start - 1);
    activate(b.engine, P1, b.id("op"), "kill", { selected: { t: [b.id("l")] } });
    assert.equal(influence(b, P1), start - 1 - 1 - 2, "leaves play (-1) and destroyed (-2)");
  });

  test("while it is in play, a card's own enters-play trigger is ignored, for either player", () => {
    const b = boardWith([
      { key: "hero", def: hero(), owner: P2 },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" }
    ]);
    const start = influence(b, P1);
    play(b.engine, P1, b.id("e"));
    assert.equal(b.engine.state.cards[b.id("e")].zone, "play");
    assert.equal(influence(b, P1), start, "no trigger");
  });

  test("a leaves-play trigger is ignored, but a separate 'when this card is destroyed' trigger still fires", () => {
    const b = boardWith([
      { key: "hero", def: hero(), owner: P1 },
      { key: "l", def: ltp("Ltp"), owner: P2 },
      { key: "op", def: operator(), owner: P1 }
    ]);
    const start = influence(b, P2);
    activate(b.engine, P1, b.id("op"), "kill", { selected: { t: [b.id("l")] } });
    assert.equal(influence(b, P2), start - 2, "only the destroyed trigger fired");
  });

  test("triggers that are not 'this card' triggers are unaffected", () => {
    const b = boardWith([
      { key: "hero", def: hero(), owner: P2 },
      { key: "w", def: watcher(), owner: P1 },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" }
    ]);
    const start = influence(b, P1);
    play(b.engine, P1, b.id("e"));
    assert.equal(influence(b, P1), start - 1, "the watcher saw another card enter; the entering card's own trigger was ignored");
  });

  test("only the listed kinds are ignored", () => {
    const b = boardWith([
      { key: "hero", def: hero({ ignoresTriggers: ["thisCardLeavesPlay"] }), owner: P2 },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" }
    ]);
    const start = influence(b, P1);
    play(b.engine, P1, b.id("e"));
    assert.equal(influence(b, P1), start - 1, "enters-play trigger fires");
  });

  test("it ends when the source leaves play, and it does not apply while the source is face-down or its ability is gated off", () => {
    const b = boardWith([
      { key: "hero", def: hero(), owner: P1 },
      { key: "op", def: operator(), owner: P1 },
      { key: "e1", def: etb("Etb1"), owner: P1, zone: "hand" },
      { key: "e2", def: etb("Etb2"), owner: P1, zone: "hand" }
    ]);
    const start = influence(b, P1);
    play(b.engine, P1, b.id("e1"));
    assert.equal(influence(b, P1), start);
    activate(b.engine, P1, b.id("op"), "kill", { selected: { t: [b.id("hero")] } });
    play(b.engine, P1, b.id("e2"));
    assert.equal(influence(b, P1), start - 1, "the Hero is gone: the trigger fires again");

    const down = boardWith([
      { key: "hero", def: hero(), owner: P1, faceDown: true },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" }
    ]);
    const s2 = influence(down, P1);
    play(down.engine, P1, down.id("e"));
    assert.equal(influence(down, P1), s2 - 1, "a face-down card has no rules text");

    const gated = boardWith([
      { key: "hero", def: hero({ condition: { type: "cardDepleted", target: "source" } }), owner: P1 },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" }
    ]);
    const s3 = influence(gated, P1);
    play(gated.engine, P1, gated.id("e"));
    assert.equal(influence(gated, P1), s3 - 1, "condition not met");
  });
});
