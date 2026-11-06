// Batch r09-resources-thresholds, part 2 (docs/TESTING.md): CR 203 Resources, CR 405 Threshold.
// Written from the wording of the Comprehensive Rules, not from the engine.

import assert from "node:assert/strict";
import {
  findDeckConstructionIssues,
  getMaxCopies,
  isStapleResourceDefinition,
  type CardDefinition,
  type PlayerId,
  type ResourceIcon,
  type SpoilsEngine
} from "../../../engine.js";
import { logMessageFor } from "../../../types/log.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic,
  type CardPlacement
} from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";
import { developPlay, openDevelop, settleTurnStart } from "../support/develop.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ICON_LETTER: Record<ResourceIcon, string> = {
  rage: "r",
  greed: "g",
  deception: "d",
  elitism: "e",
  obsession: "o",
  volition: "v"
};
const STAPLES = [
  { name: "Obsession", icon: "obsession" },
  { name: "Greed", icon: "greed" },
  { name: "Elitism", icon: "elitism" },
  { name: "Deception", icon: "deception" },
  { name: "Rage", icon: "rage" }
] as const satisfies ReadonlyArray<{ name: string; icon: ResourceIcon }>;

/** A resource card providing exactly `icons`. */
const resourceOf = (name: string, ...icons: ResourceIcon[]): CardDefinition =>
  resourceCard({ name, resource: { provides: icons, staple: false } });

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } });
const GREED = resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } });

/** `count` placements of `def` in play under `owner` (keys `${prefix}0`, `${prefix}1`, ...). */
const bank = (prefix: string, def: CardDefinition, count: number, owner: PlayerId = P1): CardPlacement[] =>
  Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, def, owner }));

/** `count` face-down cards in play under `owner`. */
const faceDowns = (prefix: string, count: number, owner: PlayerId = P1): CardPlacement[] =>
  Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, def: character({ name: `Hidden ${prefix}${index}` }), owner, faceDown: true }));

const factionIdOf = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].factionId!;

const cast = (engine: SpoilsEngine, playerId: PlayerId, cardId: string) => {
  engine.perform({ type: "playCard", playerId, cardId });
  resolvePendingResponses(engine);
};

/** A faction whose Develop Rule can play a resource. */
const planter = () =>
  factionCard({
    name: "Planter",
    faction: defaultFactionDefinition({
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] } }
    })
  });

/** Plays `cardId` through the Develop Rule's "Play a resource" option (a start-of-turn trigger) on a board built mid-turn. */
const developResource = (engine: SpoilsEngine, playerId: PlayerId, cardId: string, faceDown: boolean): void =>
  developPlay(engine, playerId, cardId, faceDown);

const thresholdMet = (engine: SpoilsEngine, playerId: PlayerId, cardId: string) => engine.getCardPlayability(playerId, cardId).thresholdMet;

const attachedTo = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.attachedTo;

// ---------------------------------------------------------------------------
// CR 203.1 / 203.1a Playing a resource needs an effect
// ---------------------------------------------------------------------------

rule("CR 203.1", "a resource cannot be played just by playing it from hand; an effect (the Develop Rule) can put it into play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: planter() },
    cards: [{ key: "res", def: RAGE, owner: P1, zone: "hand" }]
  });
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("res") }), "playing a resource card from hand", /effect instructs/);
  assert.equal(engine.state.cards[id("res")]!.zone, "hand", "it stayed in hand");
  developResource(engine, P1, id("res"), false);
  assert.equal(engine.state.cards[id("res")]!.zone, "play", "control: an effect that instructs you to play a resource puts it into play");
});

rule("CR 203.1", "the same holds for a resource card on the opponent's turn: it cannot be played in response either", () => {
  const { engine, id } = buildGame({ cards: [{ key: "res", def: RAGE, owner: P2, zone: "hand" }] });
  engine.perform({ type: "endTurn", playerId: P1 });
  refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("res") }), "playing a resource card in a response window", /effect instructs/);
  assert.equal(engine.state.cards[id("res")]!.zone, "hand");
});

rule("CR 203.1a", "effects that play resources are not limited to the faction: a tactic that says to play a resource does so", () => {
  const plant = tactic({ name: "Plant", behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "playResource" }] }] } });
  const { engine, id } = buildGame({
    cards: [
      { key: "plant", def: plant, owner: P1, zone: "hand" },
      { key: "res", def: RAGE, owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other Hand Card" }), owner: P1, zone: "hand" }
    ]
  });
  cast(engine, P1, id("plant"));
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "chooserSelectsTarget", "the player picks the card to play");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("res")] } });
  assert.equal(engine.state.pendingChoice?.kind, "playResource", "an actual resource asks which side up");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: false } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("res")]!.zone, "play");
  assert.equal(engine.state.cards[id("res")]!.faceDown, false);
});

rule("CR 203.1a", "the faction's Develop Rule is an effect that plays resources: it puts the chosen resource into play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: planter() },
    cards: [{ key: "res", def: GREED, owner: P1, zone: "hand" }]
  });
  developResource(engine, P1, id("res"), false);
  assert.equal(engine.getThresholds(P1).greed, 1);
});

// ---------------------------------------------------------------------------
// CR 203.2 / 203.2a Face-up or face-down
// ---------------------------------------------------------------------------

const planting = (extra: CardPlacement[]) => buildGame({ playerA: { faction: planter() }, cards: extra });

rule("CR 203.2", "an actual resource card can be played face-up, and then provides its own icon", () => {
  const { engine, id } = planting([{ key: "res", def: RAGE, owner: P1, zone: "hand" }]);
  developResource(engine, P1, id("res"), false);
  assert.equal(engine.state.cards[id("res")]!.faceDown, false);
  assert.deepEqual(engine.getThresholds(P1), { rage: 1 });
});

rule("CR 203.2", "an actual resource card can also be played face-down, and then provides only Volition", () => {
  const { engine, id } = planting([{ key: "res", def: RAGE, owner: P1, zone: "hand" }]);
  developResource(engine, P1, id("res"), true);
  assert.equal(engine.state.cards[id("res")]!.faceDown, true);
  assert.deepEqual(engine.getThresholds(P1), { volition: 1 });
});

rule("CR 203.2", "any card can be played face-down: a character, an item, a tactic and a location each become a resource", () => {
  for (const [label, def] of [
    ["character", character({ name: "A Character" })],
    ["item", item({ name: "An Item" })],
    ["tactic", tactic({ name: "A Tactic" })]
  ] as const) {
    const { engine, id } = planting([{ key: "card", def, owner: P1, zone: "hand" }]);
    developResource(engine, P1, id("card"), true);
    assert.equal(engine.state.cards[id("card")]!.zone, "play", `${label} is in play`);
    assert.equal(engine.state.cards[id("card")]!.faceDown, true, `${label} is face-down`);
    assert.equal(engine.isResource(id("card")), true, `${label} is a resource`);
  }
});

rule("CR 203.2", "only actual resource cards can be played face-up: a character cannot", () => {
  const { engine, id } = planting([
    { key: "chr", def: character({ name: "Not A Resource" }), owner: P1, zone: "hand" },
    { key: "res", def: RAGE, owner: P1, zone: "hand" }
  ]);
  const faces = engine.getResourcePlayFaces(P1, id("chr"));
  assert.equal(faces.canFaceUp, false, "the query says a character cannot go face-up");
  assert.equal(faces.canFaceDown, true, "and that it can go face-down");
  assert.equal(engine.getResourcePlayFaces(P1, id("res")).canFaceUp, true, "control: an actual resource can go face-up");
  openDevelop(engine, P1);
  const option = engine.state.pendingChoice;
  assert.equal(option?.kind, "chooserSelectsOption", "the Develop Rule's options are open");
  if (option?.kind !== "chooserSelectsOption") return;
  engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: { kind: "chooserSelectsOption", index: option.options.findIndex((entry) => /^Play /.test(entry.label ?? "")) }
  });
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the Develop Rule asks which card to play");
  // The Develop Rule is a start-of-turn trigger (user ruling 2026-10-27) that plays the resource through the ordinary
  // `playResource` effect prompts: a card that cannot go face-up is never asked which side, and asking for face-up
  // gets it no further than face-down (the engine no longer raises a refusal for it, as the old `chooseDevelop` did).
  // ENGINE?: asking for face-up on a character is coerced to face-down instead of refused; the rule (never face-up) holds.
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("chr")], faceDown: false } });
  assert.equal(engine.state.pendingChoice, undefined, "a character is not asked which side: it can only go face-down");
  assert.equal(engine.state.cards[id("chr")]!.zone, "play", "it was played as a resource");
  assert.equal(engine.state.cards[id("chr")]!.faceDown, true, "and it is face-down: a character cannot be played face-up");
  assert.equal(engine.isResource(id("chr")), true);
  const control = planting([{ key: "res", def: RAGE, owner: P1, zone: "hand" }]);
  developResource(control.engine, P1, control.id("res"), false);
  assert.equal(control.engine.state.cards[control.id("res")]!.faceDown, false, "control: the same Develop takes an actual resource face-up");
});

rule("CR 203.2", "the player decides: playing a resource through an effect asks which side, and both answers are honoured", () => {
  for (const faceDown of [false, true]) {
    const plant = tactic({ name: "Plant", behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "playResource" }] }] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "plant", def: plant, owner: P1, zone: "hand" },
        { key: "res", def: RAGE, owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other Hand Card" }), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, P1, id("plant"));
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the player picks the card to play");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("res")] } });
    assert.equal(engine.state.pendingChoice?.kind, "playResource");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("res")]!.faceDown, faceDown, `faceDown=${faceDown}`);
  }
});

rule("CR 203.2a", "a face-down card's controller can look at its front face: their log names it, the opponent's does not", () => {
  const secret = tactic({ name: "Secret Plan" });
  const { engine, id } = planting([{ key: "card", def: secret, owner: P1, zone: "hand" }]);
  developResource(engine, P1, id("card"), true);
  const entry = engine.getLog().find((line) => line.event?.type === "resourcePlayed");
  assert.ok(entry, "the play was logged");
  assert.match(logMessageFor(entry, P1), /Secret Plan/, "the controller sees the front face");
  assert.doesNotMatch(logMessageFor(entry, P2), /Secret Plan/, "the opponent does not");
  assert.doesNotMatch(logMessageFor(entry, null), /Secret Plan/, "nor does a public reader");
});

rule("CR 203.2a", "it stays visible to the controller (and hidden from the opponent) on later turns", () => {
  const secret = tactic({ name: "Secret Plan" });
  const { engine, id } = planting([{ key: "card", def: secret, owner: P1, zone: "hand" }]);
  developResource(engine, P1, id("card"), true);
  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
  assert.equal(engine.state.cards[id("card")]!.faceDown, true, "still face-down");
  assert.equal(engine.getDefinition(id("card")).name, "Secret Plan", "the front face is still there to look at");
  const entry = engine.getLog().find((line) => line.event?.type === "resourcePlayed")!;
  assert.match(logMessageFor(entry, P1), /Secret Plan/);
  assert.doesNotMatch(logMessageFor(entry, P2), /Secret Plan/);
});

// ---------------------------------------------------------------------------
// CR 203.3 / 203.3a Paying a number
// ---------------------------------------------------------------------------

const costItem = (cost: number) => item({ name: `Cost ${cost} Item`, cost });

rule("CR 203.3", "paying a number attaches that many resources to your faction", () => {
  const { engine, id } = buildGame({
    cards: [...bank("r", RAGE, 4), { key: "it", def: costItem(3), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("it"));
  const spent = [0, 1, 2, 3].filter((index) => attachedTo(engine, id(`r${index}`)) === factionIdOf(engine, P1));
  assert.equal(spent.length, 3, "exactly three resources are attached to the faction");
  assert.equal(engine.getAvailableResourceCount(P1), 1, "the fourth is still free");
});

rule("CR 203.3", "paying 0 attaches nothing; paying exactly what you have attaches them all", () => {
  const free = buildGame({ cards: [...bank("r", RAGE, 2), { key: "it", def: costItem(0), owner: P1, zone: "hand" }] });
  cast(free.engine, P1, free.id("it"));
  assert.equal(free.engine.getAvailableResourceCount(P1), 2, "a cost of 0 attaches nothing");
  const exact = buildGame({ cards: [...bank("r", RAGE, 2), { key: "it", def: costItem(2), owner: P1, zone: "hand" }] });
  cast(exact.engine, P1, exact.id("it"));
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0, "a cost of exactly 2 attaches both");
  assert.equal(exact.engine.state.cards[exact.id("it")]!.zone, "play");
});

rule("CR 203.3", "the resources go onto the paying player's own faction, and an opponent's faction gets none", () => {
  const { engine, id } = buildGame({
    cards: [...bank("r", RAGE, 1), ...bank("o", RAGE, 1, P2), { key: "it", def: costItem(1), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("it"));
  assert.equal(attachedTo(engine, id("r0")), factionIdOf(engine, P1));
  assert.equal(attachedTo(engine, id("o0")), undefined, "the opponent's resource is untouched");
});

rule("CR 203.3", "the player can say which resources are attached", () => {
  const { engine, id } = buildGame({
    cards: [...bank("r", RAGE, 3), { key: "it", def: costItem(1), owner: P1, zone: "hand" }]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("it"), payWith: [id("r2")] });
  resolvePendingResponses(engine);
  assert.equal(attachedTo(engine, id("r2")), factionIdOf(engine, P1), "the named resource was attached");
  assert.equal(attachedTo(engine, id("r0")), undefined);
  assert.equal(attachedTo(engine, id("r1")), undefined);
});

rule("CR 203.3", "an ability that says to pay a number attaches that many resources too", () => {
  const worker = character({
    name: "Paid Worker",
    behavior: { abilities: [{ id: "work", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [] }] }
  });
  const { engine, id } = buildGame({ cards: [{ key: "w", def: worker, owner: P1 }, ...bank("r", RAGE, 3)] });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("w"), abilityId: "work" });
  resolvePendingResponses(engine);
  assert.equal(engine.getAvailableResourceCount(P1), 1, "two of three were attached");
});

rule("CR 203.3", "face-down cards are resources and can be attached to pay", () => {
  const { engine, id } = buildGame({ cards: [...faceDowns("f", 2), { key: "it", def: costItem(2), owner: P1, zone: "hand" }] });
  cast(engine, P1, id("it"));
  assert.equal(attachedTo(engine, id("f0")), factionIdOf(engine, P1));
  assert.equal(attachedTo(engine, id("f1")), factionIdOf(engine, P1));
});

rule("CR 203.3a", "you can only attach resources that are not already attached: one short is refused", () => {
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 3), { key: "it", def: costItem(3), owner: P1, zone: "hand" }] });
  engine.state.cards[id("r0")]!.attachedTo = factionIdOf(engine, P1);
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("it") }), "paying 3 with only 2 unattached resources");
  assert.equal(engine.state.cards[id("it")]!.zone, "hand", "nothing was played");
  assert.equal(attachedTo(engine, id("r1")), undefined, "nothing was attached");
});

rule("CR 203.3a", "with enough unattached resources the same payment works and leaves the already-attached one alone", () => {
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 3), { key: "it", def: costItem(2), owner: P1, zone: "hand" }] });
  engine.state.cards[id("r0")]!.attachedTo = factionIdOf(engine, P1);
  cast(engine, P1, id("it"));
  assert.equal(engine.state.cards[id("it")]!.zone, "play");
  assert.equal(engine.getAvailableResourceCount(P1), 0, "both free resources were attached");
});

rule("CR 203.3a", "naming an already-attached resource as the payment is refused", () => {
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 2), { key: "it", def: costItem(1), owner: P1, zone: "hand" }] });
  engine.state.cards[id("r0")]!.attachedTo = factionIdOf(engine, P1);
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("it"), payWith: [id("r0")] }), "paying with an attached resource", /resource/i);
  engine.perform({ type: "playCard", playerId: P1, cardId: id("it"), payWith: [id("r1")] });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("it")]!.zone, "play", "control: naming the free resource works");
});

rule("CR 203.3a", "a resource spent on one card cannot pay for a second card until it is detached", () => {
  const { engine, id } = buildGame({
    cards: [...bank("r", RAGE, 2), { key: "a", def: costItem(2), owner: P1, zone: "hand" }, { key: "b", def: costItem(1), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("a"));
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("b") }), "paying again with spent resources");
  assert.equal(engine.state.cards[id("b")]!.zone, "hand");
});

// ---------------------------------------------------------------------------
// CR 203.4 / 203.4a Resource icons
// ---------------------------------------------------------------------------

/** A tactic with no cost that needs `threshold`. */
const gated = (name: string, threshold: string) => tactic({ name, threshold });

rule("CR 203.4", "a resource card provides the resource icon printed on it, and that icon corresponds to the same threshold icon", () => {
  for (const [icon, letter] of Object.entries(ICON_LETTER) as Array<[ResourceIcon, string]>) {
    if (icon === "volition") continue;
    const { engine, id } = buildGame({
      cards: [
        { key: "res", def: resourceOf(`Icon ${icon}`, icon), owner: P1 },
        { key: "match", def: gated(`Needs ${letter}`, letter), owner: P1, zone: "hand" },
        ...Object.values(ICON_LETTER)
          .filter((other) => other !== letter)
          .map((other) => ({ key: `other${other}`, def: gated(`Needs ${other}`, other), owner: P1, zone: "hand" as const }))
      ]
    });
    assert.deepEqual(engine.getThresholds(P1), { [icon]: 1 }, `${icon} resource provides ${icon}`);
    assert.equal(thresholdMet(engine, P1, id("match")), true, `threshold ${letter} is met`);
    for (const other of Object.values(ICON_LETTER).filter((candidate) => candidate !== letter)) {
      assert.equal(thresholdMet(engine, P1, id(`other${other}`)), false, `threshold ${other} is not met by ${icon}`);
    }
  }
});

rule("CR 203.4", "a resource card can provide more than one icon", () => {
  const dual = resourceOf("Dual", "rage", "greed");
  const { engine, id } = buildGame({
    cards: [
      { key: "dual", def: dual, owner: P1 },
      { key: "both", def: gated("Needs rg", "rg"), owner: P1, zone: "hand" },
      { key: "twice", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(engine.getThresholds(P1), { rage: 1, greed: 1 });
  assert.equal(thresholdMet(engine, P1, id("both")), true);
  assert.equal(thresholdMet(engine, P1, id("twice")), false, "one Rage icon is not two");
});

rule("CR 203.4", "only most resource cards provide icons: a resource that prints none provides none, but is still a resource that can pay", () => {
  const blank = resourceCard({ name: "Blank Stone", resource: { provides: [], staple: false } });
  const { engine, id } = buildGame({
    cards: [
      { key: "stone", def: blank, owner: P1 },
      { key: "it", def: costItem(1), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(engine.getThresholds(P1), {});
  assert.equal(engine.isResource(id("stone")), true);
  cast(engine, P1, id("it"));
  assert.equal(attachedTo(engine, id("stone")), factionIdOf(engine, P1), "it paid for the item");
});

rule("CR 203.4a", "each face-down card provides one Volition icon", () => {
  for (const count of [1, 2, 3]) {
    const { engine } = buildGame({ cards: faceDowns("f", count) });
    assert.deepEqual(engine.getThresholds(P1), { volition: count }, `${count} face-down cards`);
  }
});

rule("CR 203.4a", "a face-down card provides Volition whatever it is, and none of its own icons", () => {
  const { engine } = buildGame({
    cards: [
      { key: "downRes", def: RAGE, owner: P1, faceDown: true },
      { key: "downChar", def: character({ name: "Hidden Char" }), owner: P1, faceDown: true },
      { key: "downTac", def: tactic({ name: "Hidden Tactic" }), owner: P1, faceDown: true }
    ]
  });
  assert.deepEqual(engine.getThresholds(P1), { volition: 3 });
});

rule("CR 203.4a", "Volition meets a Volition threshold exactly: vv with two face-down cards, not with one", () => {
  const two = buildGame({ cards: [...faceDowns("f", 2), { key: "need", def: gated("Needs vv", "vv"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(two.engine, P1, two.id("need")), true);
  const one = buildGame({ cards: [...faceDowns("f", 1), { key: "need", def: gated("Needs vv", "vv"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(one.engine, P1, one.id("need")), false);
});

// ---------------------------------------------------------------------------
// CR 203.5 Staple resources
// ---------------------------------------------------------------------------

rule("CR 203.5", "a resource labeled staple is a staple resource; an unlabeled resource and a non-resource are not", () => {
  assert.equal(isStapleResourceDefinition(resourceCard({ name: "Custom", resource: { provides: ["rage"], staple: true } })), true);
  assert.equal(isStapleResourceDefinition(resourceCard({ name: "Custom Two", resource: { provides: ["rage"], staple: false } })), false);
  assert.equal(isStapleResourceDefinition(character({ name: "Custom Three" })), false, "a character is not a staple resource");
});

rule("CR 203.5a", "the five staple resources are Obsession, Greed, Elitism, Deception and Rage, each a staple", () => {
  for (const { name } of STAPLES) {
    const def = resourceCard({ name, resource: { provides: [], staple: true } });
    assert.equal(isStapleResourceDefinition(def), true, `${name} is a staple`);
  }
  assert.equal(isStapleResourceDefinition(resourceCard({ name: "Volition", resource: { provides: [], staple: false } })), false, "a resource with another name is not");
});

rule("CR 203.5a", "each staple provides the icon of its own name", () => {
  for (const { name, icon } of STAPLES) {
    const { engine } = buildGame({ cards: [{ key: "s", def: resourceCard({ name, resource: { staple: true } }), owner: P1 }] });
    assert.deepEqual(engine.getThresholds(P1), { [icon]: 1 }, `${name} provides ${icon}`);
  }
});

rule("CR 203.5b", "any number of staple resource cards may be in a constructed deck", () => {
  const faction = factionCard({ name: "Deck Faction" });
  for (const { name } of STAPLES) {
    const staple = resourceCard({ name, resource: { provides: [], staple: true } });
    assert.equal(getMaxCopies(staple), null, `${name} has no copy limit`);
    const deck = [faction, ...Array.from({ length: 30 }, () => staple)];
    const issues = findDeckConstructionIssues(deck, { minimumSize: false, factionRules: false });
    assert.deepEqual(issues, [], `30 copies of ${name} are fine`);
  }
});

rule("CR 203.5b", "the exception is exactly the staples: a non-staple card is held to the four-copy limit", () => {
  const faction = factionCard({ name: "Deck Faction" });
  const normal = character({ name: "Ordinary" });
  const fancy = resourceOf("Fancy Resource", "rage");
  const options = { minimumSize: false, factionRules: false } as const;
  assert.deepEqual(findDeckConstructionIssues([faction, ...Array.from({ length: 4 }, () => normal)], options), [], "four copies are fine");
  assert.deepEqual(findDeckConstructionIssues([faction, ...Array.from({ length: 5 }, () => normal)], options).map((issue) => issue.kind), ["copyLimit"]);
  assert.deepEqual(findDeckConstructionIssues([faction, ...Array.from({ length: 5 }, () => fancy)], options).map((issue) => issue.kind), ["copyLimit"], "a non-staple resource is limited too");
});

rule("CR 203.5c", "each staple provides exactly one icon of its type, however many are in play", () => {
  const { engine } = buildGame({ cards: [...bank("r", RAGE, 3), ...bank("g", GREED, 1)] });
  assert.deepEqual(engine.getThresholds(P1), { rage: 3, greed: 1 });
});

rule("CR 203.5c", "all face-down cards provide the Volition icon, even a staple resource turned face-down", () => {
  const { engine } = buildGame({
    cards: [
      { key: "up", def: RAGE, owner: P1 },
      { key: "down", def: GREED, owner: P1, faceDown: true },
      ...faceDowns("f", 1)
    ]
  });
  assert.deepEqual(engine.getThresholds(P1), { rage: 1, volition: 2 });
});

// ---------------------------------------------------------------------------
// CR 203.6 / 203.7
// ---------------------------------------------------------------------------

ruleExempt("CR 203.6", "Physical card orientation (resources lie sideways on the table). The engine has no orientation state; a resource's status is carried by its zone, faceDown and attachedTo.");

rule("CR 203.7", "when a resource is used it is attached to the faction, not depleted", () => {
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 2), { key: "it", def: costItem(2), owner: P1, zone: "hand" }] });
  cast(engine, P1, id("it"));
  for (const key of ["r0", "r1"]) {
    assert.equal(attachedTo(engine, id(key)), factionIdOf(engine, P1), `${key} is attached`);
    assert.equal(engine.state.cards[id(key)]!.depleted, false, `${key} is not depleted`);
  }
});

rule("CR 203.7", "a used face-down resource is attached, not depleted, too", () => {
  const { engine, id } = buildGame({ cards: [...faceDowns("f", 1), { key: "it", def: costItem(1), owner: P1, zone: "hand" }] });
  cast(engine, P1, id("it"));
  assert.equal(attachedTo(engine, id("f0")), factionIdOf(engine, P1));
  assert.equal(engine.state.cards[id("f0")]!.depleted, false);
});

const depleter = (selector: object) =>
  tactic({
    name: "Depleter",
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

rule("CR 203.7", "control: an effect that depletes a character does deplete it", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "dep", def: depleter({ zone: "play", controller: "any" }), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Depletable" }), owner: P1 }
    ]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("dep"), selected: { t: [id("chr")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("chr")]!.depleted, true);
});

rule("CR 203.7", "resources never deplete: an effect that depletes a resource leaves it undepleted", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "dep", def: depleter({ zone: "play", controller: "any", type: "resource" }), owner: P1, zone: "hand" },
      { key: "res", def: RAGE, owner: P1 }
    ]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("dep"), selected: { t: [id("res")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("res")]!.depleted, false, "a resource never depletes");
});

rule("CR 203.7", "resources never deplete: a face-down resource is not depleted by an effect either", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "dep", def: depleter({ zone: "play", controller: "any" }), owner: P1, zone: "hand" },
      ...faceDowns("f", 1)
    ]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("dep"), selected: { t: [id("f0")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("f0")]!.depleted, false, "a face-down card is a resource and never depletes");
});

// ---------------------------------------------------------------------------
// CR 405.1 / 405.2 Thresholds on cards
// ---------------------------------------------------------------------------

rule("CR 405.1", "a threshold is met by controlling cards that provide the icons: exact amount meets it, one fewer does not", () => {
  const exact = buildGame({ cards: [...bank("r", RAGE, 2), { key: "need", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(exact.engine, P1, exact.id("need")), true);
  const short = buildGame({ cards: [...bank("r", RAGE, 1), { key: "need", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(short.engine, P1, short.id("need")), false);
  const more = buildGame({ cards: [...bank("r", RAGE, 5), { key: "need", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(more.engine, P1, more.id("need")), true, "more than enough also meets it");
});

rule("CR 405.1", "only cards you control count: the opponent's resources do not meet your threshold", () => {
  const { engine, id } = buildGame({
    cards: [...bank("o", RAGE, 3, P2), { key: "need", def: gated("Needs r", "r"), owner: P1, zone: "hand" }, { key: "theirs", def: gated("Their R", "r"), owner: P2, zone: "hand" }]
  });
  assert.equal(thresholdMet(engine, P1, id("need")), false, "the opponent's icons do not count for me");
  assert.equal(thresholdMet(engine, P2, id("theirs")), true, "control: they count for the opponent");
});

rule("CR 405.1", "control, not ownership, decides: an opponent's resource under my control counts for me, not for them", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "stolen", def: RAGE, owner: P2, controller: P1 },
      { key: "mine", def: gated("My R", "r"), owner: P1, zone: "hand" },
      { key: "theirs", def: gated("Their R", "r"), owner: P2, zone: "hand" }
    ]
  });
  assert.equal(thresholdMet(engine, P1, id("mine")), true);
  assert.equal(thresholdMet(engine, P2, id("theirs")), false);
});

rule("CR 405.1", "resources in hand, deck or discard are not controlled in play and do not meet a threshold", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "inHand", def: RAGE, owner: P1, zone: "hand" },
      { key: "inDeck", def: RAGE, owner: P1, zone: "deck" },
      { key: "inDiscard", def: RAGE, owner: P1, zone: "discard" },
      { key: "need", def: gated("Needs r", "r"), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(thresholdMet(engine, P1, id("need")), false);
});

rule("CR 405.2", "if you cannot meet a card's threshold you cannot play it; meeting it, you can", () => {
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 1), { key: "need", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(engine, P1, id("need")), false);
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("need") }), "playing rr with one Rage");
  assert.equal(engine.state.cards[id("need")]!.zone, "hand");

  const ok = buildGame({ cards: [...bank("r", RAGE, 2), { key: "need", def: gated("Needs rr", "rr"), owner: P1, zone: "hand" }] });
  cast(ok.engine, P1, ok.id("need"));
  assert.equal(ok.engine.state.cards[ok.id("need")]!.zone, "discard", "control: with two Rage the tactic resolves");
});

rule("CR 405.2", "the icons must be the right ones: a mixed threshold needs each icon, and the wrong icons do not help", () => {
  const rg = (cards: CardPlacement[]) => buildGame({ cards: [...cards, { key: "need", def: gated("Needs rg", "rg"), owner: P1, zone: "hand" }] });
  const both = rg([...bank("r", RAGE, 1), ...bank("g", GREED, 1)]);
  assert.equal(thresholdMet(both.engine, P1, both.id("need")), true, "one of each meets rg");
  const wrong = rg(bank("r", RAGE, 5));
  assert.equal(thresholdMet(wrong.engine, P1, wrong.id("need")), false, "five Rage is not Rage and Greed");
  refused(() => wrong.engine.perform({ type: "playCard", playerId: P1, cardId: wrong.id("need") }), "playing rg with only Rage");
  const unrelated = rg([...bank("r", RAGE, 1), ...bank("d", resourceOf("Deceit", "deception"), 3)]);
  assert.equal(thresholdMet(unrelated.engine, P1, unrelated.id("need")), false, "Rage plus Deception is not Rage plus Greed");
});

rule("CR 405.2", "face-down cards meet only Volition thresholds, not the icon of the card they are", () => {
  const down = buildGame({
    cards: [{ key: "rageDown", def: RAGE, owner: P1, faceDown: true }, { key: "needR", def: gated("Needs r", "r"), owner: P1, zone: "hand" }, { key: "needV", def: gated("Needs v", "v"), owner: P1, zone: "hand" }]
  });
  assert.equal(thresholdMet(down.engine, P1, down.id("needR")), false);
  assert.equal(thresholdMet(down.engine, P1, down.id("needV")), true);
});

rule("CR 405.2", "a threshold also gates a character: it cannot be deployed without the icons", () => {
  const knight = character({ name: "Gated Knight", threshold: "gg" });
  const short = buildGame({ cards: [...bank("g", GREED, 1), { key: "k", def: knight, owner: P1, zone: "hand" }] });
  refused(() => short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("k") }), "deploying a gg character with one Greed");
  assert.equal(short.engine.state.cards[short.id("k")]!.zone, "hand");
  const ok = buildGame({ cards: [...bank("g", GREED, 2), { key: "k", def: knight, owner: P1, zone: "hand" }] });
  cast(ok.engine, P1, ok.id("k"));
  assert.equal(ok.engine.state.cards[ok.id("k")]!.zone, "play", "control: with two Greed it is deployed");
});

rule("CR 405.2", "a card with no threshold needs no icons", () => {
  const { engine, id } = buildGame({ cards: [{ key: "free", def: tactic({ name: "No Threshold" }), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(engine, P1, id("free")), true);
  cast(engine, P1, id("free"));
  assert.equal(engine.state.cards[id("free")]!.zone, "discard");
});

// ---------------------------------------------------------------------------
// CR 405.3 Ability thresholds
// ---------------------------------------------------------------------------

const thresholdAbilityCard = () =>
  character({
    name: "Gated Caster",
    behavior: {
      abilities: [
        { id: "gated", type: "activated", threshold: "rr", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { id: "plain", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });

rule("CR 405.3", "if you cannot meet an ability's threshold you cannot use that ability", () => {
  const { engine, id } = buildGame({ cards: [{ key: "c", def: thresholdAbilityCard(), owner: P1 }, ...bank("r", RAGE, 1)] });
  refused(
    () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("c"), abilityId: "gated" }),
    "using an rr ability with one Rage",
    /threshold/i
  );
  const status = engine.getActivatedAbilityStatuses(P1).find((entry) => entry.cardId === id("c") && entry.ability.id === "gated");
  assert.equal(status?.unavailableBecause, "threshold", "the ability is listed as blocked by its threshold");
  assert.equal(engine.state.responseStack.length, 0, "nothing was put on the stack");
});

rule("CR 405.3", "meeting the ability's threshold lets you use it", () => {
  const { engine, id } = buildGame({ cards: [{ key: "c", def: thresholdAbilityCard(), owner: P1 }, ...bank("r", RAGE, 2)] });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("c"), abilityId: "gated" });
  assert.equal(engine.state.responseStack.length, 1, "the ability is on the stack");
});

rule("CR 405.3", "only that ability is gated: the card's other ability needs no icons, and the wrong icons do not meet the threshold", () => {
  const { engine, id } = buildGame({ cards: [{ key: "c", def: thresholdAbilityCard(), owner: P1 }, ...bank("g", GREED, 3)] });
  refused(
    () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("c"), abilityId: "gated" }),
    "using an rr ability with only Greed",
    /threshold/i
  );
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("c"), abilityId: "plain" });
  assert.equal(engine.state.responseStack.length, 1, "control: the ungated ability is usable");
});

// ---------------------------------------------------------------------------
// CR 405.4 Threshold paragraphs
// ---------------------------------------------------------------------------

const paragraphCard = (threshold: string) =>
  character({
    name: `Paragraph ${threshold}`,
    strength: 1,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "para",
          type: "continuous",
          condition: { type: "meetsThreshold", threshold },
          modifiers: [{ target: "source", stat: "life", operation: "add", value: 3 }]
        }
      ]
    }
  });

const lifeOf = (engine: SpoilsEngine, cardId: string) => engine.getStat(cardId, "life");

rule("CR 405.4", "a paragraph with a threshold is active while its controller meets it, and not otherwise", () => {
  const off = buildGame({ cards: [{ key: "c", def: paragraphCard("rr"), owner: P1 }, ...bank("r", RAGE, 1)] });
  assert.equal(lifeOf(off.engine, off.id("c")), 3, "one Rage: inactive");
  const on = buildGame({ cards: [{ key: "c", def: paragraphCard("rr"), owner: P1 }, ...bank("r", RAGE, 2)] });
  assert.equal(lifeOf(on.engine, on.id("c")), 6, "two Rage: active");
});

rule("CR 405.4", "it is only active while the threshold is currently met: it turns off when a resource leaves and on again when one is played", () => {
  const scrap = tactic({
    name: "Scrap",
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: planter() },
    cards: [
      { key: "c", def: paragraphCard("rr"), owner: P1 },
      { key: "scrap", def: scrap, owner: P1, zone: "hand" },
      { key: "spare", def: RAGE, owner: P1, zone: "hand" },
      ...bank("r", RAGE, 2)
    ]
  });
  assert.equal(lifeOf(engine, id("c")), 6, "active at the start");
  engine.perform({ type: "playCard", playerId: P1, cardId: id("scrap"), selected: { t: [id("r0")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("r0")]!.zone, "discard", "a resource left play");
  assert.equal(lifeOf(engine, id("c")), 3, "no longer met: inactive again");
  developResource(engine, P1, id("spare"), false);
  assert.equal(lifeOf(engine, id("c")), 6, "met again: active again");
});

rule("CR 405.4", "the controller's icons are what count: the opponent's icons do not turn a paragraph on", () => {
  const { engine, id } = buildGame({ cards: [{ key: "c", def: paragraphCard("rr"), owner: P1 }, ...bank("o", RAGE, 4, P2)] });
  assert.equal(lifeOf(engine, id("c")), 3);
});

rule("CR 405.4", "a card under another player's control uses its controller's icons, not its owner's", () => {
  const { engine, id } = buildGame({
    cards: [{ key: "c", def: paragraphCard("rr"), owner: P1, controller: P2 }, ...bank("mine", RAGE, 2, P1), ...bank("theirs", RAGE, 2, P2)]
  });
  assert.equal(lifeOf(engine, id("c")), 6, "the controller (P2) meets rr");
  const noController = buildGame({
    cards: [{ key: "c", def: paragraphCard("rr"), owner: P1, controller: P2 }, ...bank("mine", RAGE, 2, P1)]
  });
  assert.equal(lifeOf(noController.engine, noController.id("c")), 3, "the owner's icons do not help");
});

rule("CR 405.4", "the paragraph does not need to be used: it is a standing condition, so there is no ability to activate", () => {
  const { engine, id } = buildGame({ cards: [{ key: "c", def: paragraphCard("rr"), owner: P1 }, ...bank("r", RAGE, 2)] });
  assert.deepEqual(
    engine.getActivatedAbilityStatuses(P1).filter((entry) => entry.cardId === id("c")),
    [],
    "a threshold paragraph is not an activated ability"
  );
});

// ---------------------------------------------------------------------------
// CR 405.5 The six icons
// ---------------------------------------------------------------------------

rule("CR 405.5", "there are six resource icons, and each staple provides its corresponding icon", () => {
  const icons = Object.keys(ICON_LETTER) as ResourceIcon[];
  assert.equal(icons.length, 6, "obsession, greed, elitism, deception, rage and volition");
  for (const { name, icon } of STAPLES) {
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: resourceCard({ name, resource: { staple: true } }), owner: P1 },
        ...STAPLES.map((other) => ({ key: `need${other.icon}`, def: gated(`Needs ${other.icon}`, ICON_LETTER[other.icon]), owner: P1, zone: "hand" as const }))
      ]
    });
    for (const other of STAPLES) {
      assert.equal(thresholdMet(engine, P1, id(`need${other.icon}`)), other.icon === icon, `${name} ${other.icon === icon ? "meets" : "does not meet"} ${other.icon}`);
    }
  }
});

rule("CR 405.5", "all face-down cards provide the Volition icon, and only Volition meets a v threshold", () => {
  const down = buildGame({ cards: [...faceDowns("f", 1), { key: "need", def: gated("Needs v", "v"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(down.engine, P1, down.id("need")), true);
  const staple = buildGame({ cards: [...bank("r", RAGE, 3), { key: "need", def: gated("Needs v", "v"), owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(staple.engine, P1, staple.id("need")), false, "no staple provides Volition face-up");
});

rule("CR 405.5", "a threshold can ask for all six icons at once", () => {
  const all = buildGame({
    cards: [
      ...bank("o", resourceOf("O", "obsession"), 1),
      ...bank("g", GREED, 1),
      ...bank("e", resourceOf("E", "elitism"), 1),
      ...bank("d", resourceOf("D", "deception"), 1),
      ...bank("r", RAGE, 1),
      ...faceDowns("v", 1),
      { key: "need", def: gated("Needs all", "ogedrv"), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(thresholdMet(all.engine, P1, all.id("need")), true);
  const missing = buildGame({
    cards: [
      ...bank("g", GREED, 1),
      ...bank("e", resourceOf("E", "elitism"), 1),
      ...bank("d", resourceOf("D", "deception"), 1),
      ...bank("r", RAGE, 1),
      ...faceDowns("v", 1),
      { key: "need", def: gated("Needs all", "ogedrv"), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(thresholdMet(missing.engine, P1, missing.id("need")), false, "one icon short of the six");
});

// ---------------------------------------------------------------------------
// CR 405.6 Icons are never spent
// ---------------------------------------------------------------------------

rule("CR 405.6", "icons are not spent to meet a threshold: two cards with the same threshold are played off the same resources", () => {
  const { engine, id } = buildGame({
    cards: [...bank("r", RAGE, 2), { key: "a", def: gated("A rr", "rr"), owner: P1, zone: "hand" }, { key: "b", def: gated("B rr", "rr"), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("a"));
  assert.deepEqual(engine.getThresholds(P1), { rage: 2 }, "the icons are all still there");
  cast(engine, P1, id("b"));
  assert.equal(engine.state.cards[id("a")]!.zone, "discard");
  assert.equal(engine.state.cards[id("b")]!.zone, "discard");
  assert.equal(engine.getAvailableResourceCount(P1), 2, "meeting a threshold attached nothing");
});

rule("CR 405.6", "resources spent on a numeric cost still provide their icons for thresholds", () => {
  const { engine, id } = buildGame({
    cards: [
      ...bank("r", RAGE, 2),
      { key: "pay", def: costItem(2), owner: P1, zone: "hand" },
      { key: "gate", def: gated("Gate rr", "rr"), owner: P1, zone: "hand" }
    ]
  });
  cast(engine, P1, id("pay"));
  assert.equal(engine.getAvailableResourceCount(P1), 0, "both Rage were attached to pay for the item");
  assert.deepEqual(engine.getThresholds(P1), { rage: 2 }, "attached resources still provide their icons");
  assert.equal(thresholdMet(engine, P1, id("gate")), true);
  cast(engine, P1, id("gate"));
  assert.equal(engine.state.cards[id("gate")]!.zone, "discard", "the threshold card is played off the spent resources");
});

rule("CR 405.6", "paying the same resources for both the numeric cost and the threshold of one card works", () => {
  const knight = character({ name: "Costly Knight", cost: 2, threshold: "rr" });
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 2), { key: "k", def: knight, owner: P1, zone: "hand" }] });
  cast(engine, P1, id("k"));
  assert.equal(engine.state.cards[id("k")]!.zone, "play", "two Rage cover a cost of 2 and a threshold of rr together");
  assert.equal(engine.getAvailableResourceCount(P1), 0);
});

rule("CR 405.6", "one short on the numeric cost is still refused even though the threshold is met: the threshold is not a second payment", () => {
  const knight = character({ name: "Costly Knight", cost: 3, threshold: "rr" });
  const { engine, id } = buildGame({ cards: [...bank("r", RAGE, 2), { key: "k", def: knight, owner: P1, zone: "hand" }] });
  assert.equal(thresholdMet(engine, P1, id("k")), true, "the threshold is met");
  refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("k") }), "a cost of 3 with only 2 resources");
  assert.equal(engine.state.cards[id("k")]!.zone, "hand");
});
