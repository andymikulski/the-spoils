// Clause tests — batch seed-06. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-06`. Expectations come from each
// card's PRINTED text and RULES.md / the Comprehensive Rules; engine data is
// only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  factionCard,
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
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { defaultFactionDefinition } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** The same, but already spent (attached to `owner`'s faction): they still count for thresholds, but not for "pay N". */
const spent = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  res(icons, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** Stats of a card as [strength, life, speed]. */
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): [number, number, number] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

/** Raw `activateAbility` WITHOUT draining the response window. */
function actRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

/** Both factions can develop; any extra build options go in `extra`. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Says yes to every mayPay, declines everything else. */
const payYes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Every card in play under `player`'s control with this definition name. */
function inPlayNamed(engine: SpoilsEngine, player: PlayerId, name: string): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === name)
    .map((c) => c.id);
}

// --- synthetic helper cards (all free tactics) -------------------------------------

/** A free tactic (id "dp", pick "t"): depletes one picked character. */
function depleteTactic(name = "Depleter"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dp",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "rs", pick "t"): restores one picked character. */
function restoreTactic(name = "Restorer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rs",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "h", pick "t"): deals `amount` (non-battle) damage to one picked character. */
function hitTactic(amount: number, name = `Hit ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "h",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "re", pick "t"): puts one picked card from its controller's discard pile into play. */
function reanimateTactic(name = "Reanimator"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "b", pick "t"): returns one picked card in play to its owner's hand. */
function bounceAnyTactic(name = "Bouncer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/** A free tactic (id "kp", pick "t"): destroys one picked card of any type in play (a character or an item). */
function destroyAnyTactic(name = "Destroyer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kp",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "mod", pick "t"): this turn the picked character gets `delta` strength. */
function strengthTactic(delta: number, name = `Strength ${delta}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mod",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: delta, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes one picked card in play from the game. */
function removerTactic(name = "Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "fd", pick "t"): turns one picked character face-down (it becomes a resource, CR 411.4). */
function flipDownTactic(name = "Flipper"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fd",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A faction whose restore rule does NOT restore non-resource permanents, so only a card's own text can restore anything. */
function noRestoreFaction(): CardDefinition {
  return factionCard({
    name: "No-Restore Faction",
    faction: defaultFactionDefinition({
      turn: {
        restore: { detachResources: true, restoreNonResources: false },
        develop: { choices: [{ type: "draw", count: 1 }] }
      }
    })
  });
}

/** `n` staple icons of one kind. */
const iconsOf = (icon: StapleIcon, n: number): Icons => ({ [icon]: n }) as Icons;

// =============================================================================
// Shared ATTACH TO CHARACTER checks (P3pp3r, Runic Armor, Unbearably Heavy Shoes):
// "ATTACH TO CHARACTER" — CR 507.2: picking a character is the first extra cost,
// the card enters play attached to it; if the host is gone when it would enter
// play it goes to its owner's discard pile (507.2c); if the host leaves play the
// card leaves play the same way (CR 301.4 / 301.4a); if the host stops being a
// character the card is destroyed (507.2e).
// =============================================================================

interface AttachSpec {
  id: string;
  cost: number;
  icon: StapleIcon;
}

function attachBoard(
  spec: AttachSpec,
  opts: { icons?: Icons; extras?: boolean; chars?: boolean; zone?: Zone; attached?: boolean; turn?: number; active?: PlayerId; more?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "card", def: printing(spec.id), owner: P1, zone: opts.zone ?? "hand", attachedToKey: opts.attached ? "host" : undefined },
      ...(opts.chars === false
        ? []
        : [
            { key: "host", def: character({ name: "Host", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "host2", def: character({ name: "Second Host", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" as const }
          ]),
      ...(opts.extras
        ? [
            { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" as const },
            { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" as const },
            { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" as const },
            { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play" as const, faceDown: true },
            { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" as const },
            { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" as const }
          ]
        : []),
      ...res(opts.icons ?? iconsOf(spec.icon, spec.cost)),
      ...(opts.more ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type AttachGame = ReturnType<typeof attachBoard>;
const attachedTo = (game: AttachGame, key = "card"): CardInstanceId | undefined => game.engine.state.cards[game.id(key)].attachedTo;

interface AttachCase {
  title: string;
  fn: () => void;
  /** The cases that leave play another way than "destroyed" are where the engine sends the attached card to the discard pile (SYS-4). */
  tag?: "host-hand" | "host-removed" | "put-into-play";
}

function attachCases(spec: AttachSpec): AttachCase[] {
  const cases: AttachCase[] = [];
  const add = (title: string, fn: () => void, tag?: AttachCase["tag"]) => cases.push({ title, fn, tag });

  add("picking my character is the first extra cost: the card pays exactly its cost and enters play attached to that character", () => {
    const g = attachBoard(spec);
    const before = ready(g.engine);
    play(g.engine, P1, g.id("card"), { selected: { attachTo: [g.id("host")] } });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("card")), "play");
    assert.equal(attachedTo(g), g.id("host"));
    assert.equal(before - ready(g.engine), spec.cost, "exactly the printed cost is paid");
  });

  add("it attaches to the character that was picked, not to another one", () => {
    const g = attachBoard(spec);
    play(g.engine, P1, g.id("card"), { selected: { attachTo: [g.id("host2")] } });
    assert.equal(attachedTo(g), g.id("host2"));
    assert.notEqual(attachedTo(g), g.id("host"));
  });

  add("any character may be picked, including the opponent's: the card is controlled by me but attached to their character", () => {
    const g = attachBoard(spec);
    play(g.engine, P1, g.id("card"), { selected: { attachTo: [g.id("foe")] } });
    assert.equal(zoneOf(g.engine, g.id("card")), "play");
    assert.equal(attachedTo(g), g.id("foe"));
    assert.equal(g.engine.state.cards[g.id("card")].controllerId, P1);
  });

  add("while it is being deployed (response window open) it is not attached or in play yet; the pick is paid as part of the cost", () => {
    const g = attachBoard(spec);
    playRaw(g.engine, P1, g.id("card"), { selected: { attachTo: [g.id("host")] } });
    assert.equal(zoneOf(g.engine, g.id("card")), "deploying");
    assert.equal(g.engine.state.priorityPlayerId, P2);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("card")), "play");
    assert.equal(attachedTo(g), g.id("host"));
  });

  add(`refused one resource short of its cost of ${spec.cost}; nothing is paid or attached`, () => {
    const bad = attachBoard(spec, { icons: iconsOf(spec.icon, spec.cost - 1) });
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id("host")] } }), "one resource short");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
    assert.equal(ready(bad.engine), spec.cost - 1);
    assert.equal(attachedTo(bad), undefined);
  });

  add("refused without its threshold, however many other resources there are", () => {
    const bad = attachBoard(spec, { icons: { rage: spec.cost + 4 } });
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id("host")] } }), "wrong icons");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
    assert.equal(ready(bad.engine), spec.cost + 4);
  });

  add("it can only be deployed on its controller's turn (an item is not a tactic)", () => {
    const bad = attachBoard(spec, { turn: 2, active: P2 });
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id("host")] } }), "the opponent's turn");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
  });

  const illegal: Array<[string, string]> = [
    ["thing", "an item"],
    ["place", "a location"],
    ["resCard", "a resource card"],
    ["fd", "a face-down card (only a resource, CR 411.1)"],
    ["inHand", "a character card in my hand (CR 402.3)"],
    ["inDiscard", "a character card in my discard pile (CR 402.3)"]
  ];
  for (const [key, why] of illegal) {
    add(`cannot attach to ${why}: the pick is refused and nothing is paid`, () => {
      const bad = attachBoard(spec, { extras: true });
      const before = ready(bad.engine);
      refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id(key)] } }), `attaching to ${why}`);
      assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
      assert.equal(ready(bad.engine), before, "nothing paid");
      const good = attachBoard(spec, { extras: true });
      play(good.engine, P1, good.id("card"), { selected: { attachTo: [good.id("host")] } });
      assert.equal(attachedTo(good), good.id("host"), "control: a character works");
    });
  }

  add("cannot attach to a faction (a faction can only be picked when an effect says so, CR 202.9a)", () => {
    const bad = attachBoard(spec);
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.engine.state.players[P2].factionId!] } }), "their faction");
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.engine.state.players[P1].factionId!] } }), "my faction");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
  });

  add("exactly one character must be picked: none and two are refused", () => {
    const bad = attachBoard(spec);
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [] } }), "no pick");
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: {} }), "no declaration");
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id("host"), bad.id("host2")] } }), "two picks");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
    assert.equal(ready(bad.engine), spec.cost);
  });

  add("with no character in play there is nothing to attach to: it cannot be deployed", () => {
    const bad = attachBoard(spec, { chars: false });
    refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: {} }), "no characters at all");
    assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
    assert.equal(ready(bad.engine), spec.cost);
  });

  add("if the host leaves play before the card resolves (destroyed in response) the card goes to its owner's discard pile instead of entering play (CR 507.2c)", () => {
    const g = attachBoard(spec, { more: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
    playRaw(g.engine, P1, g.id("card"), { selected: { attachTo: [g.id("host")] } });
    assert.equal(g.engine.state.priorityPlayerId, P2);
    playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("host")] } });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("host")), "discard");
    assert.equal(zoneOf(g.engine, g.id("card")), "discard", "not in play, not still being deployed");
    assert.ok(discardOf(g.engine, P1).includes(g.id("card")), "in its owner's discard pile");
  });

  add("when the host is destroyed the attached card leaves play the same way: it goes to its owner's discard pile (CR 301.4)", () => {
    const g = attachBoard(spec, { zone: "play", attached: true, more: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
    assert.equal(attachedTo(g), g.id("host"));
    play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
    assert.equal(zoneOf(g.engine, g.id("host")), "discard");
    assert.equal(zoneOf(g.engine, g.id("card")), "discard");
    assert.ok(discardOf(g.engine, P1).includes(g.id("card")), "discardOf(g.engine, P1).includes(g.id(\"card\"))");
    assert.equal(zoneOf(g.engine, g.id("host2")), "play", "other characters are untouched");
  });

  add("an attached card on the OPPONENT's character goes to MY discard pile (its owner's) when that character is destroyed", () => {
    const g = attachBoard(spec, {
      zone: "play",
      more: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]
    });
    g.engine.state.cards[g.id("card")].attachedTo = g.id("foe");
    play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
    assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
    assert.equal(zoneOf(g.engine, g.id("card")), "discard");
    assert.ok(discardOf(g.engine, P1).includes(g.id("card")), "my card, my discard pile");
    assert.equal(discardOf(g.engine, P2).includes(g.id("card")), false);
  });

  add("when the host is returned to its owner's hand the attached card leaves play the same way: into its OWNER's hand (CR 301.4 / 301.4a)", () => {
    const g = attachBoard(spec, { zone: "play", attached: true, more: [{ key: "bounce", def: bounceAnyTactic(), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("host")] } });
    assert.equal(zoneOf(g.engine, g.id("host")), "hand");
    assert.equal(zoneOf(g.engine, g.id("card")), "hand", "the attached card follows its host to the hand");
    assert.ok(handOf(g.engine, P1).includes(g.id("card")), "handOf(g.engine, P1).includes(g.id(\"card\"))");
  }, "host-hand");

  add("when the host is removed from the game the attached card is removed from the game too (CR 301.4a)", () => {
    const g = attachBoard(spec, { zone: "play", attached: true, more: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("host")] } });
    assert.equal(zoneOf(g.engine, g.id("host")), "removed");
    assert.equal(zoneOf(g.engine, g.id("card")), "removed", "it leaves play the same way as its host");
  }, "host-removed");

  add("put into play by an effect (not deployed), with no target specified, I pick a character as it enters and it enters play attached to it (CR 507.2b)", () => {
    const g = attachBoard(spec, { zone: "discard", more: [{ key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("re"), { selected: { t: [g.id("card")] } });
    // the engine may ask for the host; answer by picking my character
    drain(g.engine, (pc) =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { attachTo: [g.id("host")] } }
        : pc.kind === "chooserSelectsTarget"
          ? { kind: "chooserSelectsTarget", selected: [g.id("host")] }
          : declineAll(pc)
    );
    assert.equal(zoneOf(g.engine, g.id("card")), "play", "it entered play (it was not discarded again)");
    const host = attachedTo(g);
    assert.ok(host, "and it is attached to a character");
    assert.equal(g.engine.getDefinition(host!).type, "character");
  }, "put-into-play");

  add("put into play by an effect with no character in play to attach to, it goes to its owner's discard pile (CR 507.2c)", () => {
    const g = attachBoard(spec, { zone: "discard", chars: false, more: [{ key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("re"), { selected: { t: [g.id("card")] } });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("card")), "discard");
    assert.ok(discardOf(g.engine, P1).includes(g.id("card")), "discardOf(g.engine, P1).includes(g.id(\"card\"))");
  });

  add("if the host stops being a character (turned face-down, so only a resource) the attached card is flipped face-down with it", () => {
    const g = attachBoard(spec, { zone: "play", attached: true, more: [{ key: "flip", def: flipDownTactic(), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("flip"), { selected: { t: [g.id("host")] } });
    assert.equal(g.engine.state.cards[g.id("host")].faceDown, true);
    assert.equal(zoneOf(g.engine, g.id("card")), "play", "CR 301.4: the attachment stays in play...");
    assert.equal(g.engine.state.cards[g.id("card")].faceDown, true, "...and is flipped face-down along with its host");
    assert.equal(g.engine.state.cards[g.id("card")].attachedTo, undefined);
  });

  return cases;
}

// =============================================================================
// Oddment Collector
// This card enters play with 5 tokens on it.
// This card gains 1 strength and 1 life for each token on it.
// If this card becomes depleted, remove a token from it.
// GATHER -- COST: Pay 1. Remove an item or 2 cards in your discard pile from the game.
//           EFFECT: Put a token on this card.
// Character, gearsmith, cost 5, [E], 1 strength / 2 speed / 1 life, golem.
// =============================================================================

const OC = "90b08f5a-4e31-4d3a-b481-c4d4d51a93a4";

function ocBoard(
  opts: {
    zone?: Zone;
    tokens?: number;
    elitism?: number;
    rage?: number;
    depleted?: boolean;
    owner?: PlayerId;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "oc", def: printing(OC), owner, zone: opts.zone ?? "play", counters: opts.tokens === undefined ? undefined : { token: opts.tokens }, depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...res({ elitism: opts.elitism ?? 0, rage: opts.rage ?? 0 }, owner),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}

// --- 0:rule enters play with 5 tokens ------------------------------------------

clause(OC, "0:rule", "deployed from hand it enters play with exactly 5 tokens (and so is a 6/6/2)", () => {
  const { engine, id } = ocBoard({ zone: "hand", elitism: 5 });
  play(engine, P1, id("oc"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.deepEqual(stats(engine, id("oc")), [6, 6, 2]);
});

clause(OC, "0:rule", "the tokens arrive when it ENTERS play: while it is still being deployed (response window open) it has none", () => {
  const { engine, id } = ocBoard({ zone: "hand", elitism: 5 });
  playRaw(engine, P1, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "deploying");
  assert.equal(tokensOn(engine, id("oc")), 0, "no tokens while it is being deployed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(tokensOn(engine, id("oc")), 5);
});

clause(OC, "0:rule", "deploys for its printed cost of 5 with [E]: 5 resources are paid, and 4 are refused", () => {
  const ok = ocBoard({ zone: "hand", elitism: 5 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("oc"));
  assert.equal(before - ready(ok.engine), 5, "exactly 5 paid");
  const short = ocBoard({ zone: "hand", elitism: 4 });
  refused(() => playRaw(short.engine, P1, short.id("oc")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("oc")), "hand");
  const noThreshold = ocBoard({ zone: "hand", rage: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("oc")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("oc")), "hand");
});

clause(OC, "0:rule", "put into play by an effect (not deployed) it still enters play with 5 tokens", () => {
  const { engine, id } = ocBoard({
    zone: "discard",
    extra: [{ key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("re"), { selected: { t: [id("oc")] } });
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.deepEqual(stats(engine, id("oc")), [6, 6, 2]);
});

clause(OC, "0:rule", "the opponent's own Oddment Collector also enters play with 5 tokens (on their turn)", () => {
  const { engine, id } = ocBoard({ zone: "hand", elitism: 5, owner: P2, turn: 2, active: P2 });
  play(engine, P2, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.deepEqual(stats(engine, id("oc")), [6, 6, 2]);
});

clause(OC, "0:rule", "'This card' only: another card entering play gets no tokens and does not add any to the Collector already in play", () => {
  const { engine, id } = ocBoard({
    tokens: 2,
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }, ...res({ elitism: 1 })]
  });
  play(engine, P1, id("newbie"));
  assert.equal(zoneOf(engine, id("newbie")), "play");
  assert.equal(tokensOn(engine, id("newbie")), 0);
  assert.equal(tokensOn(engine, id("oc")), 2, "the Collector in play keeps exactly its own tokens");
});

clause(OC, "0:rule", "a second Oddment Collector entering play gets its own 5 tokens and the first one is unchanged", () => {
  const { engine, id } = ocBoard({
    tokens: 3,
    extra: [{ key: "oc2", def: printing(OC), owner: P1, zone: "hand" }, ...res({ elitism: 5 })]
  });
  play(engine, P1, id("oc2"));
  assert.equal(tokensOn(engine, id("oc2")), 5);
  assert.equal(tokensOn(engine, id("oc")), 3);
});

clause(OC, "0:rule", "every time it enters play it has exactly 5 tokens: bounced with 3 tokens and deployed again it has 5, not 8 (tokens vanish when a card leaves play, CR 409.2)", () => {
  const { engine, id } = ocBoard({
    tokens: 3,
    elitism: 5,
    extra: [{ key: "bounce", def: bounceAnyTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("oc")] } });
  assert.equal(zoneOf(engine, id("oc")), "hand");
  assert.equal(tokensOn(engine, id("oc")), 0, "tokens disappear when it leaves play (CR 409.2)");
  play(engine, P1, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(tokensOn(engine, id("oc")), 5, "the new entry brings exactly 5");
});

// --- 1:rule +1 strength and +1 life per token ------------------------------------

for (const n of [0, 1, 2, 5, 9]) {
  clause(OC, "1:rule", `with ${n} token${n === 1 ? "" : "s"} it is a ${1 + n}/${1 + n}/2 (1 strength and 1 life per token, speed untouched)`, () => {
    const { engine, id } = ocBoard({ tokens: n });
    assert.deepEqual(stats(engine, id("oc")), [1 + n, 1 + n, 2]);
  });
}

clause(OC, "1:rule", "only tokens on THIS card count: a different Collector's 5 tokens do not help a token-less one", () => {
  const { engine, id } = ocBoard({
    tokens: 0,
    extra: [{ key: "other", def: printing(OC), owner: P1, zone: "play", counters: { token: 5 } }]
  });
  assert.deepEqual(stats(engine, id("oc")), [1, 1, 2]);
  assert.deepEqual(stats(engine, id("other")), [6, 6, 2]);
});

clause(OC, "1:rule", "other characters never gain from the Collector's tokens", () => {
  const { engine, id } = ocBoard({ tokens: 5 });
  assert.deepEqual(stats(engine, id("ally")), [2, 4, 1]);
  assert.deepEqual(stats(engine, id("foe")), [1, 9, 1]);
});

clause(OC, "1:rule", "an opponent-controlled Collector gains from its own tokens too", () => {
  const { engine, id } = ocBoard({ tokens: 3, owner: P2 });
  assert.deepEqual(stats(engine, id("oc")), [4, 4, 2]);
});

clause(OC, "1:rule", "the life bonus is real: with 2 tokens (3 life) 2 damage leaves it alive and 3 damage destroys it", () => {
  const survive = ocBoard({ tokens: 2, extra: [{ key: "hit", def: hitTactic(2), owner: P1, zone: "hand" }] });
  play(survive.engine, P1, survive.id("hit"), { selected: { t: [survive.id("oc")] } });
  assert.equal(zoneOf(survive.engine, survive.id("oc")), "play");
  const die = ocBoard({ tokens: 2, extra: [{ key: "hit", def: hitTactic(3), owner: P1, zone: "hand" }] });
  play(die.engine, P1, die.id("hit"), { selected: { t: [die.id("oc")] } });
  assert.equal(zoneOf(die.engine, die.id("oc")), "discard");
});

clause(OC, "1:rule", "the strength bonus is real: it deals damage equal to its current strength to the faction (attacking depletes it, so a 5-token Collector hits for 5 with its 4 remaining tokens)", () => {
  const { engine, id } = ocBoard({ tokens: 5 });
  const start = influenceOf(engine, P2);
  fight(engine, P1, [id("oc")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), start - 5);
  const bigger = ocBoard({ tokens: 8 });
  fight(bigger.engine, P1, [bigger.id("oc")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(bigger.engine, P2), start - 8, "8 tokens, 7 after the attack declaration: 1 + 7");
});

// --- 2:rule depleted -> remove a token ---------------------------------------------

clause(OC, "2:rule", "attacking depletes it (CR 608.1b): it loses exactly one token, going 5 -> 4 (a 5/5/2)", () => {
  const { engine, id } = ocBoard({ tokens: 5 });
  declareAttackBy(engine, P1, [id("oc")]);
  assert.equal(isDepleted(engine, id("oc")), true);
  assert.equal(tokensOn(engine, id("oc")), 4);
  assert.deepEqual(stats(engine, id("oc")), [5, 5, 2]);
});

clause(OC, "2:rule", "an attack that finishes does not remove a second token (it is already depleted, CR 303.2)", () => {
  const { engine, id } = ocBoard({ tokens: 5 });
  fight(engine, P1, [id("oc")], { type: "faction", playerId: P2 }, []);
  assert.equal(tokensOn(engine, id("oc")), 4);
});

clause(OC, "2:rule", "blocking: a surviving blocker is depleted when the battle ends (CR 609.1h) and loses a token", () => {
  const { engine, id } = ocBoard({
    tokens: 5,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("oc")]);
  assert.equal(tokensOn(engine, id("oc")), 5, "declaring a block does not deplete");
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(isDepleted(engine, id("oc")), true, "depleted at the end of the battle");
  assert.equal(tokensOn(engine, id("oc")), 4);
});

clause(OC, "2:rule", "depleted by an effect (not an attack) it also loses a token", () => {
  const { engine, id } = ocBoard({ tokens: 5, extra: [{ key: "dp", def: depleteTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("dp"), { selected: { t: [id("oc")] } });
  assert.equal(isDepleted(engine, id("oc")), true);
  assert.equal(tokensOn(engine, id("oc")), 4);
});

clause(OC, "2:rule", "an opponent's effect that depletes it works the same way (on their turn, in response)", () => {
  const { engine, id } = ocBoard({
    tokens: 5,
    turn: 2,
    active: P2,
    extra: [{ key: "dp", def: depleteTactic(), owner: P2, zone: "hand" }]
  });
  play(engine, P2, id("dp"), { selected: { t: [id("oc")] } });
  assert.equal(isDepleted(engine, id("oc")), true);
  assert.equal(tokensOn(engine, id("oc")), 4);
});

clause(OC, "2:rule", "only when THIS card becomes depleted: depleting my other character or the opponent's does not touch its tokens", () => {
  const { engine, id } = ocBoard({
    tokens: 5,
    extra: [{ key: "dp1", def: depleteTactic("D1"), owner: P1, zone: "hand" }, { key: "dp2", def: depleteTactic("D2"), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("dp1"), { selected: { t: [id("ally")] } });
  play(engine, P1, id("dp2"), { selected: { t: [id("foe")] } });
  assert.equal(isDepleted(engine, id("ally")), true);
  assert.equal(isDepleted(engine, id("foe")), true);
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.equal(isDepleted(engine, id("oc")), false);
});

clause(OC, "2:rule", "an already depleted Collector cannot become depleted again: another deplete effect removes no token", () => {
  const { engine, id } = ocBoard({ tokens: 5, depleted: true, extra: [{ key: "dp", def: depleteTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("dp"), { selected: { t: [id("oc")] } });
  assert.equal(isDepleted(engine, id("oc")), true);
  assert.equal(tokensOn(engine, id("oc")), 5, "no token removed: it did not BECOME depleted");
});

clause(OC, "2:rule", "with no tokens left, becoming depleted removes nothing and leaves it at 0 tokens (a 1/1/2)", () => {
  const { engine, id } = ocBoard({ tokens: 0, extra: [{ key: "dp", def: depleteTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("dp"), { selected: { t: [id("oc")] } });
  assert.equal(isDepleted(engine, id("oc")), true);
  assert.equal(tokensOn(engine, id("oc")), 0);
  assert.deepEqual(stats(engine, id("oc")), [1, 1, 2]);
});

clause(OC, "2:rule", "restoring it does not give the token back, and each new depletion costs another one (5 -> 4 -> 3)", () => {
  const { engine, id } = ocBoard({
    tokens: 5,
    extra: [
      { key: "dp1", def: depleteTactic("D1"), owner: P1, zone: "hand" },
      { key: "rs", def: restoreTactic(), owner: P1, zone: "hand" },
      { key: "dp2", def: depleteTactic("D2"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("dp1"), { selected: { t: [id("oc")] } });
  assert.equal(tokensOn(engine, id("oc")), 4);
  play(engine, P1, id("rs"), { selected: { t: [id("oc")] } });
  assert.equal(isDepleted(engine, id("oc")), false);
  assert.equal(tokensOn(engine, id("oc")), 4, "restoring adds no token");
  play(engine, P1, id("dp2"), { selected: { t: [id("oc")] } });
  assert.equal(tokensOn(engine, id("oc")), 3);
  assert.deepEqual(stats(engine, id("oc")), [4, 4, 2]);
});

clause(OC, "2:rule", "attacking on two different turns costs a token each time (the turn-start restore runs in between)", () => {
  const { engine, id } = ocBoard({ tokens: 5 });
  fight(engine, P1, [id("oc")], { type: "faction", playerId: P2 }, []);
  assert.equal(tokensOn(engine, id("oc")), 4);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("oc")), false, "restored at the start of my turn");
  assert.equal(tokensOn(engine, id("oc")), 4, "the restore returns nothing");
  fight(engine, P1, [id("oc")], { type: "faction", playerId: P2 }, []);
  assert.equal(tokensOn(engine, id("oc")), 3);
});

// --- 3:ability:gather -------------------------------------------------------------

function gatherBoard(
  opts: {
    tokens?: number;
    resources?: number;
    discard?: Array<"item" | "character" | "tactic" | "location">;
    oppDiscard?: Array<"item" | "character">;
    ocZone?: Zone;
    depleted?: boolean;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const defOf = (type: string, i: number): CardDefinition =>
    type === "item" ? item({ name: `Junk Item ${i}` }) : type === "tactic" ? tactic({ name: `Junk Tactic ${i}` }) : type === "location" ? location({ name: `Junk Location ${i}` }) : character({ name: `Junk Char ${i}` });
  return ocBoard({
    zone: opts.ocZone,
    tokens: opts.tokens ?? 5,
    elitism: opts.resources ?? 3,
    depleted: opts.depleted,
    turn: opts.turn,
    active: opts.active,
    extra: [
      ...(opts.discard ?? []).map((type, i): CardPlacement => ({ key: `d${i}`, def: defOf(type, i), owner: P1, zone: "discard" })),
      ...(opts.oppDiscard ?? []).map((type, i): CardPlacement => ({ key: `o${i}`, def: defOf(type, i + 10), owner: P2, zone: "discard" })),
      { key: "inHand", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "inPlayItem", def: item({ name: "Board Item" }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(OC, "3:ability:gather", "paying 1 and removing an ITEM from my discard pile puts a token on the Collector", () => {
  const { engine, id } = gatherBoard({ discard: ["item"], tokens: 5 });
  const before = ready(engine);
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("oc")), 6);
  assert.equal(before - ready(engine), 1, "exactly 1 resource paid");
  assert.deepEqual(stats(engine, id("oc")), [7, 7, 2]);
});

clause(OC, "3:ability:gather", "the removed item is removed from the GAME: it is in the out-of-game area, not in the discard pile", () => {
  const { engine, id } = gatherBoard({ discard: ["item"] });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  assert.equal(zoneOf(engine, id("d0")), "removed");
  assert.ok(removedOf(engine, P1).includes(id("d0")), "removedOf(engine, P1).includes(id(\"d0\"))");
  assert.equal(discardOf(engine, P1).includes(id("d0")), false);
});

clause(OC, "3:ability:gather", "removing 2 cards (not items) from my discard pile works as well: both are removed from the game, 1 token, 1 paid", () => {
  const { engine, id } = gatherBoard({ discard: ["character", "tactic"], tokens: 2 });
  const before = ready(engine);
  activate(engine, P1, id("oc"), "gather", { selected: { g2: [id("d0"), id("d1")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("d0")), "removed");
  assert.equal(zoneOf(engine, id("d1")), "removed");
  assert.equal(tokensOn(engine, id("oc")), 3, "one token, not two");
  assert.equal(before - ready(engine), 1);
});

clause(OC, "3:ability:gather", "the 2-card option may include items: two items are removed for one token", () => {
  const { engine, id } = gatherBoard({ discard: ["item", "item"], tokens: 1 });
  activate(engine, P1, id("oc"), "gather", { selected: { g2: [id("d0"), id("d1")] } });
  assert.equal(zoneOf(engine, id("d0")), "removed");
  assert.equal(zoneOf(engine, id("d1")), "removed");
  assert.equal(tokensOn(engine, id("oc")), 2);
});

clause(OC, "3:ability:gather", "the single-item option removes only the chosen item: the other discard cards stay", () => {
  const { engine, id } = gatherBoard({ discard: ["item", "character", "item"] });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d2")] } });
  assert.equal(zoneOf(engine, id("d2")), "removed");
  assert.equal(zoneOf(engine, id("d0")), "discard");
  assert.equal(zoneOf(engine, id("d1")), "discard");
});

for (const type of ["character", "tactic", "location"] as const) {
  clause(OC, "3:ability:gather", `'an item': a ${type} card in my discard pile is refused for the single-card option (nothing paid, nothing removed)`, () => {
    const bad = gatherBoard({ discard: [type] });
    refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("d0")] }), `a ${type} is not an item`);
    assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
    assert.equal(ready(bad.engine), 3, "nothing paid");
    assert.equal(tokensOn(bad.engine, bad.id("oc")), 5);
    const good = gatherBoard({ discard: ["item"] });
    activate(good.engine, P1, good.id("oc"), "gather", { selected: { g1: [good.id("d0")] } });
    assert.equal(tokensOn(good.engine, good.id("oc")), 6, "control: an item works");
  });
}

clause(OC, "3:ability:gather", "a lone non-item card in the discard pile cannot pay GATHER: one card is not 'an item or 2 cards'", () => {
  const bad = gatherBoard({ discard: ["character"] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g2: [bad.id("d0")] }), "one card for the 2-card option");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
  assert.equal(ready(bad.engine), 3);
  assert.equal(tokensOn(bad.engine, bad.id("oc")), 5);
});

clause(OC, "3:ability:gather", "'2 cards' means exactly 2: three cards are refused", () => {
  const bad = gatherBoard({ discard: ["character", "character", "character"] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g2: [bad.id("d0"), bad.id("d1"), bad.id("d2")] }), "three cards");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
  assert.equal(ready(bad.engine), 3);
  const good = gatherBoard({ discard: ["character", "character", "character"] });
  activate(good.engine, P1, good.id("oc"), "gather", { selected: { g2: [good.id("d0"), good.id("d1")] } });
  assert.equal(zoneOf(good.engine, good.id("d2")), "discard", "control: two removed, the third stays");
});

clause(OC, "3:ability:gather", "'an item' means exactly one: two items for the single-item option are refused", () => {
  const bad = gatherBoard({ discard: ["item", "item"] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("d0"), bad.id("d1")] }), "two items for 'an item'");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
  assert.equal(zoneOf(bad.engine, bad.id("d1")), "discard");
  assert.equal(ready(bad.engine), 3);
});

clause(OC, "3:ability:gather", "'in your discard pile': cards in the OPPONENT's discard pile cannot be removed for either option", () => {
  const bad = gatherBoard({ discard: [], oppDiscard: ["item", "character", "character"] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("o0")] }), "their item");
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g2: [bad.id("o1"), bad.id("o2")] }), "their two cards");
  assert.equal(zoneOf(bad.engine, bad.id("o0")), "discard");
  assert.equal(ready(bad.engine), 3);
  assert.equal(tokensOn(bad.engine, bad.id("oc")), 5);
});

clause(OC, "3:ability:gather", "only cards in the discard PILE: an item in my hand, in play or on the board is refused", () => {
  const bad = gatherBoard({ discard: ["item"] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("inHand")] }), "an item in hand");
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("inPlayItem")] }), "an item in play");
  assert.equal(zoneOf(bad.engine, bad.id("inHand")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("inPlayItem")), "play");
  assert.equal(ready(bad.engine), 3);
});

clause(OC, "3:ability:gather", "with nothing in my discard pile it cannot be used at all (nothing paid)", () => {
  const bad = gatherBoard({ discard: [] });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", {}), "empty discard pile");
  assert.equal(ready(bad.engine), 3);
  assert.equal(tokensOn(bad.engine, bad.id("oc")), 5);
});

clause(OC, "3:ability:gather", "needs 1 resource to pay: with none it is refused (and the discard card stays), with exactly 1 it works", () => {
  const bad = gatherBoard({ discard: ["item"], resources: 0 });
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("d0")] }), "no resource to pay");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard", "the removal is part of the same cost, so it was undone / never made");
  assert.equal(tokensOn(bad.engine, bad.id("oc")), 5);
  const good = gatherBoard({ discard: ["item"], resources: 1 });
  activate(good.engine, P1, good.id("oc"), "gather", { selected: { g1: [good.id("d0")] } });
  assert.equal(tokensOn(good.engine, good.id("oc")), 6);
  assert.equal(ready(good.engine), 0);
});

clause(OC, "3:ability:gather", "a spent (attached) resource cannot pay for it: 'pay' needs a ready resource", () => {
  const bad = ocBoard({ tokens: 5, extra: [...spent({ elitism: 3 }), { key: "d0", def: item({ name: "Junk" }), owner: P1, zone: "discard" }] });
  assert.equal(ready(bad.engine), 0);
  refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("d0")] }), "only spent resources");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
});

clause(OC, "3:ability:gather", "GATHER has no threshold and no deplete: it works with non-[E] resources and while the Collector is depleted", () => {
  const { engine, id } = ocBoard({ tokens: 4, depleted: true, rage: 1, extra: [{ key: "d0", def: item({ name: "Junk" }), owner: P1, zone: "discard" }] });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.equal(isDepleted(engine, id("oc")), true, "still depleted: GATHER neither needs nor changes depletion");
});

clause(OC, "3:ability:gather", "GATHER can be used repeatedly: two uses add two tokens, with no cap (7 tokens is a 8/8/2)", () => {
  const { engine, id } = gatherBoard({ discard: ["item", "item"], tokens: 5, resources: 2 });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d1")] } });
  assert.equal(tokensOn(engine, id("oc")), 7);
  assert.deepEqual(stats(engine, id("oc")), [8, 8, 2]);
  assert.equal(ready(engine), 0);
});

clause(OC, "3:ability:gather", "the token goes on THIS card, not on another Collector", () => {
  const { engine, id } = gatherBoard({
    discard: ["item"],
    tokens: 2,
    extra: [{ key: "other", def: printing(OC), owner: P1, zone: "play", counters: { token: 4 } }]
  });
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  assert.equal(tokensOn(engine, id("oc")), 3);
  assert.equal(tokensOn(engine, id("other")), 4);
});

clause(OC, "3:ability:gather", "the cost is paid when GATHER is used, before the opponent can respond; the token comes when it resolves", () => {
  const { engine, id } = gatherBoard({ discard: ["item"], tokens: 5 });
  const before = ready(engine);
  actRaw(engine, P1, id("oc"), "gather", { g1: [id("d0")] });
  assert.equal(before - ready(engine), 1, "1 paid already");
  assert.equal(zoneOf(engine, id("d0")), "removed", "item already removed");
  assert.equal(tokensOn(engine, id("oc")), 5, "no token yet");
  assert.equal(engine.state.priorityPlayerId, P2, "the opponent can respond");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("oc")), 6);
});

clause(OC, "3:ability:gather", "if the Collector is destroyed in response the cost stays paid and no token appears anywhere", () => {
  const { engine, id } = gatherBoard({
    discard: ["item"],
    extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]
  });
  const before = ready(engine);
  actRaw(engine, P1, id("oc"), "gather", { g1: [id("d0")] });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("oc")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oc")), "discard");
  assert.equal(before - ready(engine), 1, "the payment is not refunded");
  assert.equal(zoneOf(engine, id("d0")), "removed");
});

clause(OC, "3:ability:gather", "can be used in response on the opponent's turn (CR 502.3)", () => {
  const { engine, id } = gatherBoard({
    discard: ["item"],
    tokens: 5,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  activate(engine, P1, id("oc"), "gather", { selected: { g1: [id("d0")] } });
  assert.equal(tokensOn(engine, id("oc")), 6);
});

clause(OC, "3:ability:gather", "only its controller can use it: the opponent cannot GATHER with my Collector", () => {
  const { engine, id } = gatherBoard({
    discard: ["item"],
    oppDiscard: ["item"],
    turn: 1,
    active: P1,
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ elitism: 3 }, P2)]
  });
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P2);
  refused(() => actRaw(engine, P2, id("oc"), "gather", { g1: [id("o0")] }), "the opponent using my Collector", /control|own|cannot|illegal|only|owner/i);
  assert.equal(tokensOn(engine, id("oc")), 5);
  assert.equal(zoneOf(engine, id("o0")), "discard");
});

clause(OC, "3:ability:gather", "it is an ability of a card in play: it cannot be used from my hand or my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = gatherBoard({ discard: ["item"], ocZone: zone });
    refused(() => actRaw(bad.engine, P1, bad.id("oc"), "gather", { g1: [bad.id("d0")] }), `GATHER from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
    assert.equal(ready(bad.engine), 3);
  }
});

clause(OC, "2:rule", "losing the token lowers its life at once: with 1 token and 1 damage (2 life) becoming depleted leaves 1 life, so it is destroyed", () => {
  const { engine, id } = ocBoard({
    tokens: 1,
    extra: [
      { key: "dp", def: depleteTactic(), owner: P1, zone: "hand" },
      { key: "hit", def: hitTactic(1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("hit"), { selected: { t: [id("oc")] } });
  assert.equal(zoneOf(engine, id("oc")), "play", "2 life, 1 damage");
  play(engine, P1, id("dp"), { selected: { t: [id("oc")] } });
  assert.equal(tokensOn(engine, id("oc")), 0);
  assert.equal(zoneOf(engine, id("oc")), "discard", "1 life, 1 damage: destroyed");
});

// =============================================================================
// P3pp3r 0f 1n54n17y
// ATTACH TO CHARACTER
// The attached character gains 3 strength and 3 life.
// At the start of your opponent's turn, restore the attached character.
// SPIT OUT -- COST: Destroy this card. Pick a character.
//             EFFECT: This turn, the character gains 3 strength and 3 life. Restore it.
// Item, gearsmith, cost 6, [E], gear.
// =============================================================================

const PEPPER = "85f2ffda-8d98-4da2-80c6-3d7f0d0b0a6b";
const PEPPER_SPEC: AttachSpec = { id: PEPPER, cost: 6, icon: "elitism" };

for (const c of attachCases(PEPPER_SPEC)) {
  if (c.tag === "put-into-play") clause(PEPPER, "0:attach", c.title, c.fn);
  else if (c.tag) clause(PEPPER, "0:attach", c.title, c.fn);
  else clause(PEPPER, "0:attach", c.title, c.fn);
}

/** Pepper (mine) attached to "host" (base 2/2/2); a free "ally" (1/3/3) and a foe (1/3/1). */
function ppBoard(
  opts: { noRestore?: boolean; hostOwner?: PlayerId; zone?: Zone; turn?: number; active?: PlayerId; hostDepleted?: boolean; allyDepleted?: boolean; extra?: CardPlacement[] } = {}
) {
  const hostOwner = opts.hostOwner ?? P1;
  const inPlay = (opts.zone ?? "play") === "play";
  return buildGame({
    playerA: { faction: opts.noRestore ? noRestoreFaction() : developFaction() },
    playerB: { faction: opts.noRestore ? noRestoreFaction() : developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: hostOwner, zone: "play", depleted: opts.hostDepleted },
      { key: "pp", def: printing(PEPPER), owner: P1, zone: opts.zone ?? "play", attachedToKey: inPlay ? "host" : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play", depleted: opts.allyDepleted },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

// --- 1:rule +3 strength and +3 life ------------------------------------------------

clause(PEPPER, "1:rule", "the attached character is 3 stronger and has 3 more life (2/2/2 -> 5/5/2), speed untouched", () => {
  const { engine, id } = ppBoard();
  assert.deepEqual(stats(engine, id("host")), [5, 5, 2]);
});

clause(PEPPER, "1:rule", "only the attached character gains: my other character and the opponent's are unchanged", () => {
  const { engine, id } = ppBoard();
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 3]);
  assert.deepEqual(stats(engine, id("foe")), [1, 3, 1]);
});

clause(PEPPER, "1:rule", "attached to the OPPONENT's character it is that character that gains 3/3", () => {
  const { engine, id } = ppBoard({ hostOwner: P2 });
  assert.deepEqual(stats(engine, id("host")), [5, 5, 2]);
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 3]);
});

clause(PEPPER, "1:rule", "two Peppers on the same character stack: +6/+6", () => {
  const { engine, id } = ppBoard({ extra: [{ key: "pp2", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [8, 8, 2]);
});

clause(PEPPER, "1:rule", "the bonus is on only while the Pepper is in play: destroyed, the character goes back to 2/2/2", () => {
  const { engine, id } = ppBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(engine, id("host")), [5, 5, 2]);
  play(engine, P1, id("kill"), { selected: { t: [id("pp")] } });
  assert.equal(zoneOf(engine, id("pp")), "discard");
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
});

clause(PEPPER, "1:rule", "a Pepper in my hand gives nothing to anybody", () => {
  const { engine, id } = ppBoard({ zone: "hand" });
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
});

clause(PEPPER, "1:rule", "the life bonus is real: the host (2 life) survives 4 damage and is destroyed by 5", () => {
  const survive = ppBoard({ extra: [{ key: "hit", def: hitTactic(4), owner: P1, zone: "hand" }] });
  play(survive.engine, P1, survive.id("hit"), { selected: { t: [survive.id("host")] } });
  assert.equal(zoneOf(survive.engine, survive.id("host")), "play");
  const die = ppBoard({ extra: [{ key: "hit", def: hitTactic(5), owner: P1, zone: "hand" }] });
  play(die.engine, P1, die.id("hit"), { selected: { t: [die.id("host")] } });
  assert.equal(zoneOf(die.engine, die.id("host")), "discard");
  assert.equal(zoneOf(die.engine, die.id("pp")), "discard", "and the Pepper goes with it");
});

clause(PEPPER, "1:rule", "the strength bonus is real: the host hits the faction for 5", () => {
  const { engine, id } = ppBoard();
  const start = influenceOf(engine, P2);
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), start - 5);
});

// --- 2:rule restore at the start of the opponent's turn ---------------------------------

clause(PEPPER, "2:rule", "at the start of my opponent's turn the depleted attached character is restored (even though the faction's own restore rule restores nothing)", () => {
  const { engine, id } = ppBoard({ noRestore: true });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(isDepleted(engine, id("host")), true, "it attacked, so it is depleted");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("host")), false, "restored at the start of the opponent's turn");
});

clause(PEPPER, "2:rule", "control: without the Pepper the same depleted character stays depleted through the opponent's turn start (the faction restores nothing)", () => {
  const { engine, id } = ppBoard({ noRestore: true, zone: "hand" });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("host")), true);
});

clause(PEPPER, "2:rule", "only the ATTACHED character is restored: another depleted character of mine stays depleted", () => {
  const { engine, id } = ppBoard({ noRestore: true, hostDepleted: true, allyDepleted: true });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("host")), false);
  assert.equal(isDepleted(engine, id("ally")), true);
});

/**
 * Ends `player`'s turn so that the OTHER original player's turn starts next. At a bigger table the seats between also
 * take turns, and each is an opponent's turn start that restores the attached character; this clause is about the
 * start of the Pepper controller's OWN turn, so play passes straight between the two original players.
 */
const endTurnBetweenOriginals = (engine: SpoilsEngine, player: PlayerId): void => {
  const seats = engine.state.turnOrder;
  engine.state.turnOrder = seats.filter((id) => id === P1 || id === P2);
  try {
    endTurn(engine, player);
  } finally {
    engine.state.turnOrder = seats;
  }
};

clause(PEPPER, "2:rule", "it is the OPPONENT's turn start only: at the start of my own turn the Pepper restores nothing", () => {
  const { engine, id } = ppBoard({ noRestore: true, turn: 2, active: P2, hostDepleted: true, extra: [{ key: "dp", def: depleteTactic(), owner: P2, zone: "hand" }] });
  endTurnBetweenOriginals(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("host")), true, "turn 3 starts as MY turn: the Pepper did not restore at my own turn start (only an opponent's turn start restores)");
});

clause(PEPPER, "2:rule", "it restores again at every opponent's turn start (turn after turn)", () => {
  const { engine, id } = ppBoard({ noRestore: true, hostDepleted: true, extra: [{ key: "dp", def: depleteTactic(), owner: P1, zone: "hand" }] });
  endTurn(engine, P1);
  assert.equal(isDepleted(engine, id("host")), false);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  play(engine, P1, id("dp"), { selected: { t: [id("host")] } });
  assert.equal(isDepleted(engine, id("host")), true);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("host")), false, "restored again");
});

clause(PEPPER, "2:rule", "'your opponent' is the Pepper's controller's opponent: on the opponent's character it restores at THEIR turn start, not mine", () => {
  const { engine, id } = ppBoard({ noRestore: true, hostOwner: P2, hostDepleted: true });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("host")), false, "their character is restored at the start of THEIR turn");
});

clause(PEPPER, "2:rule", "a Pepper that is no longer in play restores nothing at the opponent's turn start", () => {
  const { engine, id } = ppBoard({ noRestore: true, hostDepleted: true, extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("pp")] } });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("host")), true);
});

clause(PEPPER, "2:rule", "a host that is not depleted is simply left alone (nothing is asked, nothing changes)", () => {
  const { engine, id } = ppBoard({ noRestore: true });
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("host")), false);
  assert.equal(zoneOf(engine, id("pp")), "play");
});

// --- 3:ability:spit SPIT OUT --------------------------------------------------------------

clause(PEPPER, "3:ability:spit", "destroys the Pepper itself as a cost (to its owner's discard pile) and gives the picked character +3/+3 until the end of the turn, no resources paid", () => {
  const { engine, id } = ppBoard();
  const before = ready(engine);
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("ally")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pp")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("pp")), "discardOf(engine, P1).includes(id(\"pp\"))");
  assert.deepEqual(stats(engine, id("ally")), [4, 6, 3]);
  assert.equal(ready(engine), before, "no pay in the cost");
});

clause(PEPPER, "3:ability:spit", "picking the host: the Pepper's own bonus is gone (it was destroyed) and the host has exactly +3/+3 from the effect: 5/5/2, not 8/8/2 and not 2/2/2", () => {
  const { engine, id } = ppBoard();
  assert.deepEqual(stats(engine, id("host")), [5, 5, 2]);
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("host")] } });
  assert.equal(zoneOf(engine, id("pp")), "discard");
  assert.deepEqual(stats(engine, id("host")), [5, 5, 2]);
});

clause(PEPPER, "3:ability:spit", "any character may be picked, including the opponent's", () => {
  const { engine, id } = ppBoard();
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("foe")] } });
  assert.deepEqual(stats(engine, id("foe")), [4, 6, 1]);
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 3], "only the picked character");
});

clause(PEPPER, "3:ability:spit", "only the picked character gains: the host (now unburdened) and the others are unaffected", () => {
  const { engine, id } = ppBoard();
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("ally")] } });
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
  assert.deepEqual(stats(engine, id("foe")), [1, 3, 1]);
});

clause(PEPPER, "3:ability:spit", "'Restore it': a depleted picked character is restored", () => {
  const { engine, id } = ppBoard({ allyDepleted: true });
  assert.equal(isDepleted(engine, id("ally")), true);
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("ally")] } });
  assert.equal(isDepleted(engine, id("ally")), false);
});

clause(PEPPER, "3:ability:spit", "restoring a depleted OPPONENT's character works too, and an untouched character stays untapped", () => {
  const { engine, id } = ppBoard({ extra: [{ key: "dp", def: depleteTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("dp"), { selected: { t: [id("foe")] } });
  assert.equal(isDepleted(engine, id("foe")), true);
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("foe")] } });
  assert.equal(isDepleted(engine, id("foe")), false);
  assert.equal(isDepleted(engine, id("ally")), false);
});

clause(PEPPER, "3:ability:spit", "'This turn': the bonus is gone when the next turn starts", () => {
  const { engine, id } = ppBoard({ noRestore: true });
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("ally")] } });
  assert.deepEqual(stats(engine, id("ally")), [4, 6, 3]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 3]);
});

clause(PEPPER, "3:ability:spit", "the life bonus protects: a 3-life character with 2 damage gains 3 life and survives 3 more damage, but not 4", () => {
  const make = (extraDamage: number) =>
    ppBoard({
      extra: [
        { key: "h2", def: hitTactic(2, "Hit Two"), owner: P1, zone: "hand" },
        { key: "hx", def: hitTactic(extraDamage, "Hit X"), owner: P1, zone: "hand" }
      ]
    });
  const survive = make(3);
  play(survive.engine, P1, survive.id("h2"), { selected: { t: [survive.id("ally")] } });
  assert.equal(zoneOf(survive.engine, survive.id("ally")), "play", "3 life, 2 damage");
  activate(survive.engine, P1, survive.id("pp"), "spit", { selected: { c: [survive.id("ally")] } });
  play(survive.engine, P1, survive.id("hx"), { selected: { t: [survive.id("ally")] } });
  assert.equal(zoneOf(survive.engine, survive.id("ally")), "play", "6 life, 5 damage");
  const die = make(4);
  play(die.engine, P1, die.id("h2"), { selected: { t: [die.id("ally")] } });
  activate(die.engine, P1, die.id("pp"), "spit", { selected: { c: [die.id("ally")] } });
  play(die.engine, P1, die.id("hx"), { selected: { t: [die.id("ally")] } });
  assert.equal(zoneOf(die.engine, die.id("ally")), "discard", "6 life, 6 damage");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(PEPPER, "3:ability:spit", `cannot pick ${why}: the ability is refused and the Pepper is NOT destroyed`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = ppBoard({ extra: extras() });
    refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("pp")), "play", "the destroy cost was not paid");
    const good = ppBoard({ extra: extras() });
    activate(good.engine, P1, good.id("pp"), "spit", { selected: { c: [good.id("ally")] } });
    assert.equal(zoneOf(good.engine, good.id("pp")), "discard", "control: a character pick works");
  });
}

clause(PEPPER, "3:ability:spit", "cannot pick a faction, and needs exactly one character (none and two are refused)", () => {
  const bad = ppBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", { c: [bad.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", { c: [bad.id("ally"), bad.id("foe")] }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("pp")), "play");
  assert.deepEqual(stats(bad.engine, bad.id("ally")), [1, 3, 3]);
});

clause(PEPPER, "3:ability:spit", "the cost (destroy this card) is paid when the ability is used, before the opponent can respond; the bonus comes when it resolves", () => {
  const { engine, id } = ppBoard();
  actRaw(engine, P1, id("pp"), "spit", { c: [id("ally")] });
  assert.equal(zoneOf(engine, id("pp")), "discard", "destroyed already");
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 3], "the effect has not happened yet");
  assert.equal(engine.state.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.deepEqual(stats(engine, id("ally")), [4, 6, 3]);
});

clause(PEPPER, "3:ability:spit", "if the picked character is destroyed in response, the Pepper stays destroyed and nothing else happens", () => {
  const { engine, id } = ppBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  actRaw(engine, P1, id("pp"), "spit", { c: [id("ally")] });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("ally")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pp")), "discard");
  assert.equal(zoneOf(engine, id("ally")), "discard");
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
});

clause(PEPPER, "3:ability:spit", "can be used in response on the opponent's turn: the pick survives the attacker's damage, and the bonus lasts for that turn only", () => {
  const { engine, id } = ppBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  activate(engine, P1, id("pp"), "spit", { selected: { c: [id("ally")] } });
  assert.deepEqual(stats(engine, id("ally")), [4, 6, 3]);
  declareBlockers(engine, P1, [id("ally")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("ally")), "play", "a 6-life blocker survives 5 damage");
});

clause(PEPPER, "3:ability:spit", "only its controller can use it: the opponent cannot SPIT OUT with my Pepper", () => {
  const { engine, id } = ppBoard({ extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P2);
  refused(() => actRaw(engine, P2, id("pp"), "spit", { c: [id("foe")] }), "the opponent using my Pepper", /control|own|cannot|illegal|only|owner/i);
  assert.equal(zoneOf(engine, id("pp")), "play");
  assert.deepEqual(stats(engine, id("foe")), [1, 3, 1]);
});

clause(PEPPER, "3:ability:spit", "it is an ability of a card in play: a Pepper in my hand or discard pile cannot SPIT OUT", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = ppBoard({ zone });
    refused(() => actRaw(bad.engine, P1, bad.id("pp"), "spit", { c: [bad.id("ally")] }), `SPIT OUT from ${zone}`);
    assert.deepEqual(stats(bad.engine, bad.id("ally")), [1, 3, 3]);
  }
});

// =============================================================================
// Preponderant Craftsman
// CREATE -- COST: Pay 5. Deplete this card.
//           EFFECT: You may play a character for free. (You still need to meet its
//           threshold and satisfy its extra costs.)
// Character, gearsmith, cost 4, [E][E], 2 strength / 2 speed / 2 life, craftsman.
// =============================================================================

const CRAFTSMAN = "6e230ad3-7373-4c32-a098-26cbb1530b4c";

function crBoard(
  opts: {
    icons?: Icons;
    spentIcons?: Icons;
    depleted?: boolean;
    zone?: Zone;
    attackEligible?: boolean;
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
    extra?: CardPlacement[];
    handChars?: boolean;
  } = {}
) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "cr", def: printing(CRAFTSMAN), owner, zone: opts.zone ?? "play", depleted: opts.depleted, attackEligible: opts.attackEligible },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(opts.handChars === false
        ? []
        : [
            { key: "big", def: character({ name: "Big One", cost: 9, strength: 4, life: 4, speed: 2 }), owner, zone: "hand" as const },
            { key: "small", def: character({ name: "Small One", cost: 1 }), owner, zone: "hand" as const }
          ]),
      { key: "thing", def: item({ name: "Hand Item", cost: 1 }), owner, zone: "hand" },
      { key: "tac", def: tactic({ name: "Hand Tactic", cost: 0 }), owner, zone: "hand" },
      { key: "place", def: location({ name: "Hand Place", cost: 1 }), owner, zone: "hand" },
      { key: "resCard", def: resourceCard({ name: "Hand Resource" }), owner, zone: "hand" },
      { key: "oppChar", def: character({ name: "Their Hand Char", cost: 1 }), owner: owner === P1 ? P2 : P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "Discard Char", cost: 1 }), owner, zone: "discard" },
      { key: "inDeck", def: character({ name: "Deck Char", cost: 1 }), owner, zone: "deck" },
      ...res(opts.icons ?? { elitism: 5 }, owner),
      ...spent(opts.spentIcons ?? {}, owner),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type CrGame = ReturnType<typeof crBoard>;

/** Uses CREATE and stops at the "you may play a character for free" question. */
function crCreate(game: CrGame, player: PlayerId = P1): void {
  activate(game.engine, player, game.id("cr"), "create");
}

/** Answers the free-deploy question: with a card key, or (no key) by declining. */
function crAnswer(game: CrGame, key?: string, selected?: Record<string, CardInstanceId[]>, player: PlayerId = P1): void {
  game.engine.perform({
    type: "resolvePendingChoice",
    playerId: player,
    choice: key ? { kind: "deployForFree", cardId: game.id(key), ...(selected ? { selected } : {}) } : { kind: "deployForFree" }
  } as never);
  resolvePendingResponses(game.engine);
}

clause(CRAFTSMAN, "0:ability:create", "CREATE pays exactly 5 resources, depletes the Craftsman, and then asks which character to play for free", () => {
  const game = crBoard();
  const before = ready(game.engine);
  crCreate(game);
  assert.equal(before - ready(game.engine), 5, "Pay 5");
  assert.equal(isDepleted(game.engine, game.id("cr")), true, "Deplete this card");
  assert.equal(expectPending(game.engine, "deployForFree").playerId, P1);
});

clause(CRAFTSMAN, "0:ability:create", "a character is played for FREE: a cost-9 character comes into play with no resource paid beyond the 5 for CREATE", () => {
  const game = crBoard();
  crCreate(game);
  assert.equal(ready(game.engine), 0);
  crAnswer(game, "big");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
  assert.equal(game.engine.state.cards[game.id("big")].controllerId, P1);
  assert.deepEqual(stats(game.engine, game.id("big")), [4, 4, 2]);
  assert.equal(ready(game.engine), 0, "still 0: nothing more was paid");
});

clause(CRAFTSMAN, "0:ability:create", "a cost-1 character is played free too, and the other hand cards are untouched", () => {
  const game = crBoard();
  crCreate(game);
  crAnswer(game, "small");
  assert.equal(zoneOf(game.engine, game.id("small")), "play");
  assert.equal(zoneOf(game.engine, game.id("big")), "hand");
  assert.equal(zoneOf(game.engine, game.id("thing")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "'You may': I can decline to play anything; the cost stays paid and nothing is left pending", () => {
  const game = crBoard();
  crCreate(game);
  crAnswer(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("big")), "hand");
  assert.equal(zoneOf(game.engine, game.id("small")), "hand");
  assert.equal(ready(game.engine), 0, "the 5 stay paid");
  assert.equal(isDepleted(game.engine, game.id("cr")), true);
});

clause(CRAFTSMAN, "0:ability:create", "exactly one character: after one is played free there is no second question", () => {
  const game = crBoard();
  crCreate(game);
  crAnswer(game, "small");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("big")), "hand");
});

for (const [key, why] of [
  ["thing", "an item card in my hand"],
  ["tac", "a tactic card in my hand"],
  ["place", "a location card in my hand"],
  ["resCard", "a resource card in my hand"],
  ["oppChar", "a character card in my OPPONENT's hand"],
  ["inDiscard", "a character card in my discard pile (CR 402.3: no area named, so the hand)"],
  ["inDeck", "a character card in my deck"],
  ["ally", "a character already in play"]
] as const) {
  clause(CRAFTSMAN, "0:ability:create", `'a character': ${why} cannot be played this way`, () => {
    const bad = crBoard();
    crCreate(bad);
    refused(() => crAnswer(bad, key), `playing ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("big")), "hand", "nothing was played");
    assert.equal(zoneOf(bad.engine, bad.id("small")), "hand", "nothing was played");
    const good = crBoard();
    crCreate(good);
    crAnswer(good, "big");
    assert.equal(zoneOf(good.engine, good.id("big")), "play", "control: a character in my hand works");
  });
}

clause(CRAFTSMAN, "0:ability:create", "with no character in my hand there is nothing to play: CREATE still costs 5, and no question is left hanging", () => {
  const game = crBoard({ handChars: false });
  crCreate(game);
  assert.equal(ready(game.engine), 0);
  assert.equal(game.engine.state.pendingChoice, undefined, "no question when there is no legal character");
  assert.equal(isDepleted(game.engine, game.id("cr")), true);
  assert.equal(zoneOf(game.engine, game.id("thing")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "'You still need to meet its threshold': a character needing [R][R] cannot be played free without Rage; with Rage it can", () => {
  const rageChar = () => character({ name: "Rage Char", cost: 2, threshold: "rr" as never });
  const bad = crBoard({ extra: [{ key: "rageChar", def: rageChar(), owner: P1, zone: "hand" }] });
  crCreate(bad);
  refused(() => crAnswer(bad, "rageChar"), "[R][R] with only Elitism");
  assert.equal(zoneOf(bad.engine, bad.id("rageChar")), "hand");
  const good = crBoard({ icons: { elitism: 5, rage: 2 }, extra: [{ key: "rageChar", def: rageChar(), owner: P1, zone: "hand" }] });
  crCreate(good);
  crAnswer(good, "rageChar");
  assert.equal(zoneOf(good.engine, good.id("rageChar")), "play", "two Rage meet [R][R], even though some were spent on CREATE");
});

clause(CRAFTSMAN, "0:ability:create", "the threshold is judged on resources I control: the opponent's Rage does not count", () => {
  const rageChar = () => character({ name: "Rage Char", cost: 2, threshold: "rr" as never });
  const bad = crBoard({ extra: [{ key: "rageChar", def: rageChar(), owner: P1, zone: "hand" }, ...res({ rage: 3 }, P2)] });
  crCreate(bad);
  refused(() => crAnswer(bad, "rageChar"), "their Rage");
  assert.equal(zoneOf(bad.engine, bad.id("rageChar")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': a character whose extra cost is losing 2 influence still loses 2 influence", () => {
  const taxed = () => character({ name: "Taxed", cost: 3, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } });
  const game = crBoard({ extra: [{ key: "taxed", def: taxed(), owner: P1, zone: "hand" }] });
  const start = influenceOf(game.engine, P1);
  crCreate(game);
  crAnswer(game, "taxed");
  assert.equal(zoneOf(game.engine, game.id("taxed")), "play");
  assert.equal(influenceOf(game.engine, P1), start - 2, "the extra cost was paid");
});

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': a character whose extra cost is 'Pay 2' still pays those 2 resources when played free (CR 308.1a)", () => {
  const costly = () => character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const game = crBoard({ icons: { elitism: 7 }, extra: [{ key: "costly", def: costly(), owner: P1, zone: "hand" }] });
  crCreate(game);
  assert.equal(ready(game.engine), 2);
  crAnswer(game, "costly");
  assert.equal(zoneOf(game.engine, game.id("costly")), "play");
  assert.equal(ready(game.engine), 0, "the printed 'Pay 2' extra cost is still paid; only the cost number is free");
});

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': a character whose extra cost is 'Pay 2' cannot be played free when I have no resources left to pay it", () => {
  const costly = () => character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const game = crBoard({ icons: { elitism: 5 }, extra: [{ key: "costly", def: costly(), owner: P1, zone: "hand" }] });
  crCreate(game);
  assert.equal(ready(game.engine), 0);
  refused(() => crAnswer(game, "costly"), "'Pay 2' with no resources ready");
  assert.equal(zoneOf(game.engine, game.id("costly")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': a character whose extra cost is losing 5 influence cannot be played free when I have only 3 (CR 401.3b)", () => {
  const taxed = () => character({ name: "Taxed", cost: 3, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 5 }] } } });
  const bad = crBoard({ extra: [{ key: "taxed", def: taxed(), owner: P1, zone: "hand" }] });
  bad.engine.state.players[P1].influence = 3;
  crCreate(bad);
  refused(() => crAnswer(bad, "taxed"), "lose 5 influence with 3");
  assert.equal(zoneOf(bad.engine, bad.id("taxed")), "hand");
  assert.equal(influenceOf(bad.engine, P1), 3, "no influence lost");
});

const discarder = (): CardDefinition =>
  character({
    name: "Discarder",
    cost: 3,
    behavior: { onPlay: { costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand", owner: "self" }, count: 1 }] } }
  });

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': a character whose extra cost is discarding a card from my hand discards the card I choose when played free", () => {
  const game = crBoard({ extra: [{ key: "disc", def: discarder(), owner: P1, zone: "hand" }, { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" }] });
  crCreate(game);
  crAnswer(game, "disc", { dc: [game.id("fodder")] });
  assert.equal(zoneOf(game.engine, game.id("disc")), "play");
  assert.equal(zoneOf(game.engine, game.id("fodder")), "discard", "the extra cost was paid");
  assert.equal(zoneOf(game.engine, game.id("big")), "hand", "other hand cards are untouched");
});

clause(CRAFTSMAN, "0:ability:create", "'satisfy its extra costs': the discard cost still needs its pick: without one (or with a card not in my hand) the character is not played", () => {
  const make = () => crBoard({ extra: [{ key: "disc", def: discarder(), owner: P1, zone: "hand" }, { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" }] });
  const none = make();
  crCreate(none);
  refused(() => crAnswer(none, "disc"), "no card chosen for the discard cost");
  assert.equal(zoneOf(none.engine, none.id("disc")), "hand");
  assert.equal(zoneOf(none.engine, none.id("fodder")), "hand");
  const wrong = make();
  crCreate(wrong);
  refused(() => crAnswer(wrong, "disc", { dc: [wrong.id("ally")] }), "a card in play is not in my hand");
  assert.equal(zoneOf(wrong.engine, wrong.id("disc")), "hand");
  assert.equal(zoneOf(wrong.engine, wrong.id("ally")), "play");
});

clause(CRAFTSMAN, "0:ability:create", "the character is really put into play: its 'when this enters play' trigger fires", () => {
  const drawer = () =>
    character({
      name: "Etb Drawer",
      cost: 3,
      behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
  const game = crBoard({ extra: [{ key: "drawer", def: drawer(), owner: P1, zone: "hand" }, ...fillers("dk", 2, P1, "deck")] });
  const handBefore = handOf(game.engine, P1).length;
  crCreate(game);
  crAnswer(game, "drawer");
  assert.equal(zoneOf(game.engine, game.id("drawer")), "play");
  assert.equal(handOf(game.engine, P1).length, handBefore, "left the hand, drew one card");
  assert.ok(!handOf(game.engine, P1).includes(game.id("drawer")), "!handOf(game.engine, P1).includes(game.id(\"drawer\"))");
});

clause(CRAFTSMAN, "0:ability:create", "the free character is a new arrival: it cannot attack this turn", () => {
  const game = crBoard();
  crCreate(game);
  crAnswer(game, "big");
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("big")], target: { type: "faction", playerId: P2 } }),
    "a character that just entered play cannot attack",
  /did not start the turn in play/
  );
});

clause(CRAFTSMAN, "0:ability:create", "refused with 4 resources (one short of Pay 5), nothing depleted; with exactly 5 it works", () => {
  const bad = crBoard({ icons: { elitism: 4 } });
  refused(() => actRaw(bad.engine, P1, bad.id("cr"), "create"), "Pay 5 with 4 resources");
  assert.equal(isDepleted(bad.engine, bad.id("cr")), false);
  assert.equal(ready(bad.engine), 4);
  const good = crBoard({ icons: { elitism: 5 } });
  crCreate(good);
  assert.equal(expectPending(good.engine, "deployForFree").kind, "deployForFree");
});

clause(CRAFTSMAN, "0:ability:create", "spent (attached) resources cannot pay: 5 spent + 4 ready is refused, 5 ready + 3 spent works", () => {
  const bad = crBoard({ icons: { elitism: 4 }, spentIcons: { elitism: 5 } });
  assert.equal(ready(bad.engine), 4);
  refused(() => actRaw(bad.engine, P1, bad.id("cr"), "create"), "only 4 ready");
  assert.equal(isDepleted(bad.engine, bad.id("cr")), false);
  const good = crBoard({ icons: { elitism: 5 }, spentIcons: { elitism: 3 } });
  crCreate(good);
  assert.equal(ready(good.engine), 0);
});

clause(CRAFTSMAN, "0:ability:create", "an already depleted Craftsman cannot CREATE (Deplete this card is a cost), and nothing is paid", () => {
  const bad = crBoard({ depleted: true });
  refused(() => actRaw(bad.engine, P1, bad.id("cr"), "create"), "already depleted");
  assert.equal(ready(bad.engine), 5, "nothing paid");
  const good = crBoard();
  crCreate(good);
  assert.equal(isDepleted(good.engine, good.id("cr")), true, "control: undepleted works");
});

clause(CRAFTSMAN, "0:ability:create", "CREATE has no threshold of its own: five non-[E] resources are enough", () => {
  const game = crBoard({ icons: { rage: 5 } });
  crCreate(game);
  crAnswer(game, "big");
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
});

clause(CRAFTSMAN, "0:ability:create", "it can be used the turn the Craftsman enters play (a character may use its abilities at once, CR 204.3a)", () => {
  const game = crBoard({ attackEligible: false });
  crCreate(game);
  crAnswer(game, "big");
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
});

clause(CRAFTSMAN, "0:ability:create", "the cost is paid when CREATE is used, before the opponent can respond; the free play is asked when it resolves", () => {
  const game = crBoard();
  actRaw(game.engine, P1, game.id("cr"), "create");
  assert.equal(ready(game.engine), 0, "5 paid already");
  assert.equal(isDepleted(game.engine, game.id("cr")), true);
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent can respond");
  assert.equal(game.engine.state.pendingChoice, undefined, "no question yet");
  resolvePendingResponses(game.engine);
  assert.equal(expectPending(game.engine, "deployForFree").kind, "deployForFree");
});

clause(CRAFTSMAN, "0:ability:create", "if the Craftsman is destroyed in response, the ability still resolves as written (CR 502.4): I still may play a character free", () => {
  const game = crBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  actRaw(game.engine, P1, game.id("cr"), "create");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("cr")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("cr")), "discard");
  assert.equal(expectPending(game.engine, "deployForFree").kind, "deployForFree");
  crAnswer(game, "big");
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
});

clause(CRAFTSMAN, "0:ability:create", "usable in response on the opponent's turn: the character is played free right then (CR 204.1)", () => {
  const game = crBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  crCreate(game);
  crAnswer(game, "big");
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(CRAFTSMAN, "0:ability:create", "only its controller can use it: the opponent cannot CREATE with my Craftsman", () => {
  const game = crBoard({ extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ elitism: 5 }, P2)] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(game.engine, P2, game.id("cr"), "create"), "the opponent using my Craftsman", /control|own|cannot|illegal|only|owner/i);
  assert.equal(isDepleted(game.engine, game.id("cr")), false);
});

clause(CRAFTSMAN, "0:ability:create", "it is an ability of a card in play: not usable from my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = crBoard({ zone });
    refused(() => actRaw(bad.engine, P1, bad.id("cr"), "create"), `CREATE from ${zone}`);
    assert.equal(ready(bad.engine), 5);
  }
});

clause(CRAFTSMAN, "0:ability:create", "the opponent's own Craftsman works for them: they play a character from THEIR hand for free (never mine)", () => {
  const game = crBoard({ owner: P2, turn: 2, active: P2 });
  crCreate(game, P2);
  assert.equal(expectPending(game.engine, "deployForFree").playerId, P2);
  refused(() => crAnswer(game, "oppChar", undefined, P2), "a character in MY hand is not in their hand");
  crAnswer(game, "big", undefined, P2);
  assert.equal(zoneOf(game.engine, game.id("big")), "play");
  assert.equal(game.engine.state.cards[game.id("big")].controllerId, P2);
});

// --- more synthetic helpers -------------------------------------------------------------

/** A free tactic (id "sm", pick "t"): destroys one picked face-up resource in play. */
function smashResourceTactic(name = "Resource Smasher"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "sp", pick "t"): removes one token from one picked card in play. */
function stripTokenTactic(name = "Token Stripper"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sp",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
}

/** Phantom-data check: the printing must have no activated ability (its printed text has none). */
function hasNoActivatedAbility(printingId: string): boolean {
  return !(printing(printingId).behavior?.abilities ?? []).some((ability) => ability.type === "activated");
}

// =============================================================================
// Protractive Golem
// [E][E][E][E][E][E]: This card gains 3 strength, 3 life, and loses 1 speed.
// Character, gearsmith, cost 4, [E], 3 strength / 3 speed / 3 life, golem.
// =============================================================================

const GOLEM = "d71bb0f8-8a73-4b9e-9b2c-e6feb31345d8";

function golemBoard(
  opts: { icons?: Icons; spentIcons?: Icons; oppIcons?: Icons; fd?: number; zone?: Zone; owner?: PlayerId; controller?: PlayerId; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}
) {
  return devBoard(
    [
      { key: "g", def: printing(GOLEM), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.zone ?? "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? {}),
      ...spent(opts.spentIcons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...volition(opts.fd ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

for (const [n, expected] of [
  [6, [6, 6, 2]],
  [5, [3, 3, 3]],
  [0, [3, 3, 3]],
  [7, [6, 6, 2]],
  [12, [6, 6, 2]]
] as const) {
  clause(GOLEM, "0:rule@eeeeee", `with ${n} [E] it is a ${expected.join("/")} (3/3/3 base; with six [E]: +3 strength, +3 life, -1 speed, no more however many extra [E])`, () => {
    const { engine, id } = golemBoard({ icons: { elitism: n } });
    assert.deepEqual(stats(engine, id("g")), [...expected]);
  });
}

clause(GOLEM, "0:rule@eeeeee", "spent (attached) [E] still count towards the threshold (CR 405.6), including a mix of ready and spent", () => {
  const spentOnly = golemBoard({ spentIcons: { elitism: 6 } });
  assert.deepEqual(stats(spentOnly.engine, spentOnly.id("g")), [6, 6, 2]);
  const mixed = golemBoard({ icons: { elitism: 3 }, spentIcons: { elitism: 3 } });
  assert.deepEqual(stats(mixed.engine, mixed.id("g")), [6, 6, 2]);
  const short = golemBoard({ icons: { elitism: 3 }, spentIcons: { elitism: 2 } });
  assert.deepEqual(stats(short.engine, short.id("g")), [3, 3, 3]);
});

clause(GOLEM, "0:rule@eeeeee", "only [E] counts: five [E] plus plenty of other icons, or face-down resources (Volition), do not meet it", () => {
  const other = golemBoard({ icons: { elitism: 5, rage: 4, greed: 4 } });
  assert.deepEqual(stats(other.engine, other.id("g")), [3, 3, 3]);
  const faceDown = golemBoard({ icons: { elitism: 5 }, fd: 4 });
  assert.deepEqual(stats(faceDown.engine, faceDown.id("g")), [3, 3, 3]);
  const sixRage = golemBoard({ icons: { rage: 6 } });
  assert.deepEqual(stats(sixRage.engine, sixRage.id("g")), [3, 3, 3]);
});

clause(GOLEM, "0:rule@eeeeee", "only MY [E] count: the opponent's six [E] do nothing, and my five plus their six is still off", () => {
  const theirs = golemBoard({ oppIcons: { elitism: 6 } });
  assert.deepEqual(stats(theirs.engine, theirs.id("g")), [3, 3, 3]);
  const mixed = golemBoard({ icons: { elitism: 5 }, oppIcons: { elitism: 6 } });
  assert.deepEqual(stats(mixed.engine, mixed.id("g")), [3, 3, 3]);
});

clause(GOLEM, "0:rule@eeeeee", "the controller's resources decide: a Golem I own but my opponent controls follows THEIR [E], not mine", () => {
  const mineOnly = golemBoard({ owner: P1, controller: P2, icons: { elitism: 6 } });
  assert.deepEqual(stats(mineOnly.engine, mineOnly.id("g")), [3, 3, 3], "my six [E] do not help a Golem they control");
  const theirs = golemBoard({ owner: P1, controller: P2, oppIcons: { elitism: 6 } });
  assert.deepEqual(stats(theirs.engine, theirs.id("g")), [6, 6, 2], "their six [E] do");
});

clause(GOLEM, "0:rule@eeeeee", "it turns on the moment the sixth [E] arrives (playing a resource) and off again when one is destroyed", () => {
  const extra: CardPlacement[] = [
    { ...bank("elitism", 1, P1)[0], zone: "hand", key: "sixth" },
    { key: "smash", def: smashResourceTactic(), owner: P1, zone: "hand" }
  ];
  const { engine, id } = golemBoard({ icons: { elitism: 5 }, extra });
  assert.deepEqual(stats(engine, id("g")), [3, 3, 3]);
  developResource(engine, P1, id("sixth"), false);
  assert.deepEqual(stats(engine, id("g")), [6, 6, 2], "six [E]: on");
  play(engine, P1, id("smash"), { selected: { t: [id("sixth")] } });
  assert.deepEqual(stats(engine, id("g")), [3, 3, 3], "five [E] again: off");
});

clause(GOLEM, "0:rule@eeeeee", "only the Golem itself changes: my other character and the opponent's are unaffected, and a second Golem decides for itself", () => {
  const { engine, id } = golemBoard({ icons: { elitism: 6 }, extra: [{ key: "g2", def: printing(GOLEM), owner: P2, zone: "play" }] });
  assert.deepEqual(stats(engine, id("g")), [6, 6, 2]);
  assert.deepEqual(stats(engine, id("other")), [2, 2, 2]);
  assert.deepEqual(stats(engine, id("g2")), [3, 3, 3], "the opponent controls no [E]");
});

clause(GOLEM, "0:rule@eeeeee", "the paragraph is only active in play: a Golem in my hand shows its printed stats", () => {
  const { engine, id } = golemBoard({ icons: { elitism: 6 }, zone: "hand" });
  assert.deepEqual(stats(engine, id("g")), [3, 3, 3]);
});

clause(GOLEM, "0:rule@eeeeee", "the bonus is real in battle: with six [E] a 6-life Golem survives 5 damage as a blocker and deals 6; with five [E] a 5-damage attacker kills it", () => {
  const make = (e: number) =>
    golemBoard({
      icons: { elitism: e },
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 1 }), owner: P2, zone: "play" }]
    });
  const strong = make(6);
  declareAttackBy(strong.engine, P2, [strong.id("atk")]);
  declareBlockers(strong.engine, P1, [strong.id("g")]);
  autoResolveBattle(strong.engine);
  assert.equal(zoneOf(strong.engine, strong.id("g")), "play", "6 life vs 5 damage");
  assert.equal(strong.engine.state.cards[strong.id("atk")].damage, 6, "the Golem dealt its 6 strength");
  const weak = make(5);
  declareAttackBy(weak.engine, P2, [weak.id("atk")]);
  declareBlockers(weak.engine, P1, [weak.id("g")]);
  autoResolveBattle(weak.engine);
  assert.equal(zoneOf(weak.engine, weak.id("g")), "discard", "3 life vs 5 damage");
});

clause(GOLEM, "0:rule@eeeeee", "it is a static paragraph, not an ability: the card has nothing to activate", () => {
  assert.equal(hasNoActivatedAbility(GOLEM), true);
});

// =============================================================================
// Runic Armor
// ATTACH TO CHARACTER
// The attached character gains 1 strength and 2 life.
// [E][E][E][E][E]: The attached character gains an additional 2 strength and 1 life.
// Item, gearsmith, cost 3, [E], gear.
// =============================================================================

const ARMOR = "d41f7e5e-6a4e-433b-9ae5-c0f29b451865";
const ARMOR_SPEC: AttachSpec = { id: ARMOR, cost: 3, icon: "elitism" };

for (const c of attachCases(ARMOR_SPEC)) {
  if (c.tag === "put-into-play") clause(ARMOR, "0:attach", c.title, c.fn);
  else if (c.tag) clause(ARMOR, "0:attach", c.title, c.fn);
  else clause(ARMOR, "0:attach", c.title, c.fn);
}

/** Armor attached to "host" (base 2/3/2); optional extra Armor via `extra`. */
function armorBoard(
  opts: { icons?: Icons; spentIcons?: Icons; oppIcons?: Icons; fd?: number; hostOwner?: PlayerId; zone?: Zone; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}
) {
  const inPlay = (opts.zone ?? "play") === "play";
  return devBoard(
    [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "armor", def: printing(ARMOR), owner: P1, zone: opts.zone ?? "play", attachedToKey: inPlay ? "host" : undefined },
      { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? {}),
      ...spent(opts.spentIcons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...volition(opts.fd ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(ARMOR, "1:rule", "the attached character gains 1 strength and 2 life with no resources at all (2/3/2 -> 3/5/2), speed untouched", () => {
  const { engine, id } = armorBoard();
  assert.deepEqual(stats(engine, id("host")), [3, 5, 2]);
});

clause(ARMOR, "1:rule", "only the attached character gains: my other character and the opponent's are unchanged", () => {
  const { engine, id } = armorBoard();
  assert.deepEqual(stats(engine, id("other")), [2, 3, 2]);
});

clause(ARMOR, "1:rule", "on the opponent's character, that character gains 1 strength and 2 life", () => {
  const { engine, id } = armorBoard({ hostOwner: P2 });
  assert.deepEqual(stats(engine, id("host")), [3, 5, 2]);
  assert.deepEqual(stats(engine, id("other")), [2, 3, 2]);
});

clause(ARMOR, "1:rule", "the bonus ends when the Armor leaves play, and an Armor in my hand gives nothing", () => {
  const gone = armorBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("kill"), { selected: { t: [gone.id("armor")] } });
  assert.equal(zoneOf(gone.engine, gone.id("armor")), "discard");
  assert.deepEqual(stats(gone.engine, gone.id("host")), [2, 3, 2]);
  const inHand = armorBoard({ zone: "hand" });
  assert.deepEqual(stats(inHand.engine, inHand.id("host")), [2, 3, 2]);
});

clause(ARMOR, "1:rule", "two Armors on one character stack: +2 strength and +4 life", () => {
  const { engine, id } = armorBoard({ extra: [{ key: "armor2", def: printing(ARMOR), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [4, 7, 2]);
});

clause(ARMOR, "1:rule", "the life bonus is real: a 3-life host survives 4 damage with the Armor (5 life) but not 5", () => {
  const survive = armorBoard({ extra: [{ key: "hit", def: hitTactic(4), owner: P1, zone: "hand" }] });
  play(survive.engine, P1, survive.id("hit"), { selected: { t: [survive.id("host")] } });
  assert.equal(zoneOf(survive.engine, survive.id("host")), "play");
  const die = armorBoard({ extra: [{ key: "hit", def: hitTactic(5), owner: P1, zone: "hand" }] });
  play(die.engine, P1, die.id("hit"), { selected: { t: [die.id("host")] } });
  assert.equal(zoneOf(die.engine, die.id("host")), "discard");
});

for (const [n, expected] of [
  [5, [5, 6, 2]],
  [4, [3, 5, 2]],
  [0, [3, 5, 2]],
  [6, [5, 6, 2]],
  [11, [5, 6, 2]]
] as const) {
  clause(ARMOR, "2:rule@eeeee", `with ${n} [E] the host is a ${expected.join("/")} (3/5/2 from the plain bonus; with five [E] a further +2 strength and +1 life, never more)`, () => {
    const { engine, id } = armorBoard({ icons: { elitism: n } });
    assert.deepEqual(stats(engine, id("host")), [...expected]);
  });
}

clause(ARMOR, "2:rule@eeeee", "spent [E] count, a ready/spent mix counts, and four [E] are not enough", () => {
  const spentOnly = armorBoard({ spentIcons: { elitism: 5 } });
  assert.deepEqual(stats(spentOnly.engine, spentOnly.id("host")), [5, 6, 2]);
  const mixed = armorBoard({ icons: { elitism: 2 }, spentIcons: { elitism: 3 } });
  assert.deepEqual(stats(mixed.engine, mixed.id("host")), [5, 6, 2]);
  const four = armorBoard({ icons: { elitism: 2 }, spentIcons: { elitism: 2 } });
  assert.deepEqual(stats(four.engine, four.id("host")), [3, 5, 2]);
});

clause(ARMOR, "2:rule@eeeee", "only [E] counts: other icons and face-down resources (Volition) do not meet it", () => {
  const other = armorBoard({ icons: { elitism: 4, rage: 5, greed: 5 } });
  assert.deepEqual(stats(other.engine, other.id("host")), [3, 5, 2]);
  const faceDown = armorBoard({ icons: { elitism: 4 }, fd: 5 });
  assert.deepEqual(stats(faceDown.engine, faceDown.id("host")), [3, 5, 2]);
});

clause(ARMOR, "2:rule@eeeee", "the threshold is the ARMOR's controller's, not the host's: my Armor on their character needs MY [E]", () => {
  const mine = armorBoard({ hostOwner: P2, icons: { elitism: 5 } });
  assert.deepEqual(stats(mine.engine, mine.id("host")), [5, 6, 2], "my five [E] power my Armor on their character");
  const theirs = armorBoard({ hostOwner: P2, oppIcons: { elitism: 5 } });
  assert.deepEqual(stats(theirs.engine, theirs.id("host")), [3, 5, 2], "their five [E] do not (I control the Armor)");
});

clause(ARMOR, "2:rule@eeeee", "the opponent's [E] never count for my Armor", () => {
  const { engine, id } = armorBoard({ icons: { elitism: 4 }, oppIcons: { elitism: 6 } });
  assert.deepEqual(stats(engine, id("host")), [3, 5, 2]);
});

clause(ARMOR, "2:rule@eeeee", "it turns on with the fifth [E] and off when one is destroyed; the plain +1/+2 stays on throughout", () => {
  const extra: CardPlacement[] = [
    { ...bank("elitism", 1, P1)[0], zone: "hand", key: "fifth" },
    { key: "smash", def: smashResourceTactic(), owner: P1, zone: "hand" }
  ];
  const { engine, id } = armorBoard({ icons: { elitism: 4 }, extra });
  assert.deepEqual(stats(engine, id("host")), [3, 5, 2]);
  developResource(engine, P1, id("fifth"), false);
  assert.deepEqual(stats(engine, id("host")), [5, 6, 2]);
  play(engine, P1, id("smash"), { selected: { t: [id("fifth")] } });
  assert.deepEqual(stats(engine, id("host")), [3, 5, 2]);
});

clause(ARMOR, "2:rule@eeeee", "with five [E] each Armor applies both paragraphs: two Armors give +6 strength and +6 life", () => {
  const { engine, id } = armorBoard({ icons: { elitism: 5 }, extra: [{ key: "armor2", def: printing(ARMOR), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [8, 9, 2]);
});

clause(ARMOR, "2:rule@eeeee", "both paragraphs are static: the Armor has nothing to activate", () => {
  assert.equal(hasNoActivatedAbility(ARMOR), true);
});

// =============================================================================
// Runic Reinforcement
// COST: Pick a character. EFFECT: This turn, the character gains 3 strength and 3 life.
// Tactic, gearsmith, cost 2, [E].
// =============================================================================

const REINFORCEMENT = "0b06263c-3ef0-43d5-9b86-4ac5d1cb4d5f";

function rrBoard(opts: { icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId; zone?: Zone } = {}) {
  return devBoard(
    [
      { key: "rr", def: printing(REINFORCEMENT), owner: P1, zone: opts.zone ?? "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 3 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { elitism: 2 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(REINFORCEMENT, "0:ability", "the picked character gains 3 strength and 3 life (2/3/2 -> 5/6/2), speed untouched; the tactic goes to my discard pile", () => {
  const { engine, id } = rrBoard();
  const before = ready(engine);
  play(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(engine, id("mine")), [5, 6, 2]);
  assert.equal(zoneOf(engine, id("rr")), "discard");
  assert.equal(before - ready(engine), 2, "pays its cost of 2");
});

clause(REINFORCEMENT, "0:ability", "only the picked character gains: my other character and the opponent's are unchanged", () => {
  const { engine, id } = rrBoard();
  play(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine2")), [1, 1, 1]);
  assert.deepEqual(stats(engine, id("foe")), [3, 4, 3]);
});

clause(REINFORCEMENT, "0:ability", "the opponent's character can be picked", () => {
  const { engine, id } = rrBoard();
  play(engine, P1, id("rr"), { selected: { c: [id("foe")] } });
  assert.deepEqual(stats(engine, id("foe")), [6, 7, 3]);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2]);
});

clause(REINFORCEMENT, "0:ability", "the cost is paid when it is played, before the opponent can respond; the bonus comes when it resolves", () => {
  const { engine, id } = rrBoard();
  playRaw(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  assert.equal(ready(engine), 0, "2 paid already");
  assert.equal(zoneOf(engine, id("rr")), "deploying");
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2], "not yet");
  resolvePendingResponses(engine);
  assert.deepEqual(stats(engine, id("mine")), [5, 6, 2]);
});

clause(REINFORCEMENT, "0:ability", "costs exactly 2: one resource is refused, and it needs [E]: two Rage are refused", () => {
  const short = rrBoard({ icons: { elitism: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("rr"), { selected: { c: [short.id("mine")] } }), "one resource");
  assert.equal(zoneOf(short.engine, short.id("rr")), "hand");
  const wrong = rrBoard({ icons: { rage: 6 } });
  refused(() => playRaw(wrong.engine, P1, wrong.id("rr"), { selected: { c: [wrong.id("mine")] } }), "no [E]");
  assert.equal(ready(wrong.engine), 6);
  const many = rrBoard({ icons: { elitism: 1, rage: 5 } });
  play(many.engine, P1, many.id("rr"), { selected: { c: [many.id("mine")] } });
  assert.equal(ready(many.engine), 4, "exactly 2 of 6 paid; one [E] is enough for the threshold");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(REINFORCEMENT, "0:ability", `cannot pick ${why}: refused, tactic stays in hand, nothing paid`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = rrBoard({ extra: extras() });
    const before = ready(bad.engine);
    refused(() => playRaw(bad.engine, P1, bad.id("rr"), { selected: { c: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("rr")), "hand");
    assert.equal(ready(bad.engine), before);
    const good = rrBoard({ extra: extras() });
    play(good.engine, P1, good.id("rr"), { selected: { c: [good.id("mine")] } });
    assert.deepEqual(stats(good.engine, good.id("mine")), [5, 6, 2], "control: a character works");
  });
}

clause(REINFORCEMENT, "0:ability", "cannot pick a faction, and needs exactly one character", () => {
  const bad = rrBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("rr"), { selected: { c: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(bad.engine, P1, bad.id("rr"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("rr"), { selected: { c: [bad.id("mine"), bad.id("mine2")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("rr")), "hand");
});

clause(REINFORCEMENT, "0:ability", "'This turn': the bonus is gone when the next turn starts", () => {
  const { engine, id } = rrBoard();
  play(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [5, 6, 2]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2]);
});

clause(REINFORCEMENT, "0:ability", "two Reinforcements stack on one character: +6/+6", () => {
  const { engine, id } = rrBoard({ icons: { elitism: 4 }, extra: [{ key: "rr2", def: printing(REINFORCEMENT), owner: P1, zone: "hand" }] });
  play(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  play(engine, P1, id("rr2"), { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [8, 9, 2]);
});

clause(REINFORCEMENT, "0:ability", "the life is real: a 3-life character with 2 damage gains 3 life and survives 3 more damage but not 4", () => {
  const make = (extraDamage: number) =>
    rrBoard({
      extra: [
        { key: "h2", def: hitTactic(2, "Hit Two"), owner: P1, zone: "hand" },
        { key: "hx", def: hitTactic(extraDamage, "Hit X"), owner: P1, zone: "hand" }
      ]
    });
  const survive = make(3);
  play(survive.engine, P1, survive.id("h2"), { selected: { t: [survive.id("mine")] } });
  play(survive.engine, P1, survive.id("rr"), { selected: { c: [survive.id("mine")] } });
  play(survive.engine, P1, survive.id("hx"), { selected: { t: [survive.id("mine")] } });
  assert.equal(zoneOf(survive.engine, survive.id("mine")), "play", "6 life, 5 damage");
  const die = make(4);
  play(die.engine, P1, die.id("h2"), { selected: { t: [die.id("mine")] } });
  play(die.engine, P1, die.id("rr"), { selected: { c: [die.id("mine")] } });
  play(die.engine, P1, die.id("hx"), { selected: { t: [die.id("mine")] } });
  assert.equal(zoneOf(die.engine, die.id("mine")), "discard", "6 life, 6 damage");
});

clause(REINFORCEMENT, "0:ability", "as a tactic it works in response on the opponent's turn: a blocker survives an attacker it would otherwise lose to, and the bonus dies at the next turn start", () => {
  const { engine, id } = rrBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  play(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  declareBlockers(engine, P1, [id("mine")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("mine")), "play", "6 life vs 5 damage");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2]);
});

clause(REINFORCEMENT, "0:ability", "if the picked character is destroyed in response, the tactic still resolves to nothing and goes to the discard pile", () => {
  const { engine, id } = rrBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("rr"), { selected: { c: [id("mine")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("rr")), "discard");
  assert.deepEqual(stats(engine, id("mine2")), [1, 1, 1]);
});

// =============================================================================
// Runic Tattoo Artist
// MARK -- COST: Deplete this card. Pick a character.
//         EFFECT: This turn, the character gains 1 strength and 1 life.
// Character, gearsmith, cost 2, [E][E], 1 strength / 3 speed / 1 life, 31f.
// =============================================================================

const ARTIST = "268e8892-27bf-40dd-9ac0-11d95cd4e87c";

function artistBoard(
  opts: { zone?: Zone; depleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[]; owner?: PlayerId } = {}
) {
  return devBoard(
    [
      { key: "ta", def: printing(ARTIST), owner: opts.owner ?? P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 3 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(ARTIST, "0:ability:mark", "depletes the Artist as its cost and gives the picked character +1 strength and +1 life (2/3/2 -> 3/4/2), no resources paid", () => {
  const { engine, id } = artistBoard({ icons: { elitism: 3 } });
  const before = ready(engine);
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("ta")), true);
  assert.deepEqual(stats(engine, id("mine")), [3, 4, 2]);
  assert.equal(ready(engine), before, "MARK has no 'pay'");
});

clause(ARTIST, "0:ability:mark", "no threshold and no resources are needed at all", () => {
  const { engine, id } = artistBoard();
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [3, 4, 2]);
});

clause(ARTIST, "0:ability:mark", "the Artist may pick itself: it is depleted by the cost and still gains +1/+1 (1/1/3 -> 2/2/3)", () => {
  const { engine, id } = artistBoard();
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("ta")] } });
  assert.equal(isDepleted(engine, id("ta")), true);
  assert.deepEqual(stats(engine, id("ta")), [2, 2, 3]);
});

clause(ARTIST, "0:ability:mark", "the opponent's character can be picked", () => {
  const { engine, id } = artistBoard();
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("foe")] } });
  assert.deepEqual(stats(engine, id("foe")), [4, 5, 3]);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2]);
});

clause(ARTIST, "0:ability:mark", "only the picked character gains", () => {
  const { engine, id } = artistBoard();
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("foe")), [3, 4, 3]);
  assert.deepEqual(stats(engine, id("ta")), [1, 1, 3]);
});

clause(ARTIST, "0:ability:mark", "'Deplete this card' is a cost: an already depleted Artist cannot MARK, and nothing happens", () => {
  const bad = artistBoard({ depleted: true });
  refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [bad.id("mine")] }), "already depleted");
  assert.deepEqual(stats(bad.engine, bad.id("mine")), [2, 3, 2]);
  const good = artistBoard();
  activate(good.engine, P1, good.id("ta"), "mark", { selected: { c: [good.id("mine")] } });
  assert.deepEqual(stats(good.engine, good.id("mine")), [3, 4, 2], "control: an undepleted Artist works");
});

clause(ARTIST, "0:ability:mark", "after MARK the Artist is depleted and so cannot attack; without MARK it can", () => {
  const marked = artistBoard();
  activate(marked.engine, P1, marked.id("ta"), "mark", { selected: { c: [marked.id("mine")] } });
  refused(
    () => marked.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [marked.id("ta")], target: { type: "faction", playerId: P2 } }),
    "a depleted character cannot attack"
  );
  const fresh = artistBoard();
  declareAttackBy(fresh.engine, P1, [fresh.id("ta")]);
  assert.ok(battleOf(fresh.engine), "control: a ready Artist can attack");
});

clause(ARTIST, "0:ability:mark", "'This turn': the bonus is gone when the next turn starts", () => {
  const { engine, id } = artistBoard();
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [3, 4, 2]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2]);
});

clause(ARTIST, "0:ability:mark", "two uses on the same character stack (a restore in between): +2/+2", () => {
  const { engine, id } = artistBoard({ extra: [{ key: "rs", def: restoreTactic(), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  play(engine, P1, id("rs"), { selected: { t: [id("ta")] } });
  assert.equal(isDepleted(engine, id("ta")), false);
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [4, 5, 2]);
});

clause(ARTIST, "0:ability:mark", "two Artists marking the same character stack: +2/+2", () => {
  const { engine, id } = artistBoard({ extra: [{ key: "ta2", def: printing(ARTIST), owner: P1, zone: "play" }] });
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  activate(engine, P1, id("ta2"), "mark", { selected: { c: [id("mine")] } });
  assert.deepEqual(stats(engine, id("mine")), [4, 5, 2]);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(ARTIST, "0:ability:mark", `cannot pick ${why}: refused, and the Artist is NOT depleted`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = artistBoard({ extra: extras() });
    refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(isDepleted(bad.engine, bad.id("ta")), false, "the deplete cost was not paid");
    const good = artistBoard({ extra: extras() });
    activate(good.engine, P1, good.id("ta"), "mark", { selected: { c: [good.id("mine")] } });
    assert.deepEqual(stats(good.engine, good.id("mine")), [3, 4, 2], "control: a character works");
  });
}

clause(ARTIST, "0:ability:mark", "cannot pick a faction, and needs exactly one character (none and two are refused)", () => {
  const bad = artistBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [bad.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [bad.id("mine"), bad.id("foe")] }), "two picks");
  assert.equal(isDepleted(bad.engine, bad.id("ta")), false);
});

clause(ARTIST, "0:ability:mark", "the cost is paid when MARK is used, before the opponent can respond; the bonus comes when it resolves", () => {
  const { engine, id } = artistBoard();
  actRaw(engine, P1, id("ta"), "mark", { c: [id("mine")] });
  assert.equal(isDepleted(engine, id("ta")), true);
  assert.deepEqual(stats(engine, id("mine")), [2, 3, 2], "not yet");
  assert.equal(engine.state.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.deepEqual(stats(engine, id("mine")), [3, 4, 2]);
});

clause(ARTIST, "0:ability:mark", "if the picked character is destroyed in response the Artist stays depleted and nothing else changes", () => {
  const { engine, id } = artistBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  actRaw(engine, P1, id("ta"), "mark", { c: [id("mine")] });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(isDepleted(engine, id("ta")), true);
  assert.deepEqual(stats(engine, id("foe")), [3, 4, 3]);
});

clause(ARTIST, "0:ability:mark", "usable in response on the opponent's turn: a blocker with +1 life survives a hit that would kill it", () => {
  const { engine, id } = artistBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  activate(engine, P1, id("ta"), "mark", { selected: { c: [id("mine")] } });
  declareBlockers(engine, P1, [id("mine")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("mine")), "play", "4 life vs 3 damage");
});

clause(ARTIST, "0:ability:mark", "only its controller can use it: the opponent cannot MARK with my Artist", () => {
  const { engine, id } = artistBoard({ extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P2);
  refused(() => actRaw(engine, P2, id("ta"), "mark", { c: [id("foe")] }), "the opponent using my Artist", /control|own|cannot|illegal|only|owner/i);
  assert.equal(isDepleted(engine, id("ta")), false);
});

clause(ARTIST, "0:ability:mark", "an ability of a card in play: not usable from my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = artistBoard({ zone });
    refused(() => actRaw(bad.engine, P1, bad.id("ta"), "mark", { c: [bad.id("mine")] }), `MARK from ${zone}`);
    assert.deepEqual(stats(bad.engine, bad.id("mine")), [2, 3, 2]);
  }
});

clause(ARTIST, "0:ability:mark", "usable the turn the Artist enters play (a character may use its abilities at once, CR 204.3a)", () => {
  const game = devBoard([
    { key: "ta", def: printing(ARTIST), owner: P1, zone: "play", attackEligible: false },
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" }
  ]);
  activate(game.engine, P1, game.id("ta"), "mark", { selected: { c: [game.id("mine")] } });
  assert.deepEqual(stats(game.engine, game.id("mine")), [3, 4, 2]);
});

// =============================================================================
// Runic Whale
// When this card enters play, you may pay 3. If you do, put a token on it.
// While there is a token on this card, it gains 4 strength and 4 life.
// Character, gearsmith, cost 5, [E][E][E], 5 strength / 3 speed / 5 life, golem.
// =============================================================================

const WHALE = "0a66dd7a-c644-4cf1-a92f-1b297b2e3c3c";

function whaleBoard(
  opts: { zone?: Zone; tokens?: number; icons?: Icons; owner?: PlayerId; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "w", def: printing(WHALE), owner, zone: opts.zone ?? "play", counters: opts.tokens === undefined ? undefined : { token: opts.tokens } },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}, owner),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(WHALE, "0:rule", "entering play I may pay 3: I am asked (as its controller); paying attaches exactly 3 resources and puts exactly one token on it (9/9/3)", () => {
  const { engine, id } = whaleBoard({ zone: "hand", icons: { elitism: 8 } });
  play(engine, P1, id("w"));
  assert.equal(zoneOf(engine, id("w")), "play");
  assert.equal(tokensOn(engine, id("w")), 0, "no token before I pay");
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal(ready(engine), 3, "5 paid to deploy it");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 0, "exactly 3 more paid");
  assert.equal(tokensOn(engine, id("w")), 1);
  assert.deepEqual(stats(engine, id("w")), [9, 9, 3]);
});

clause(WHALE, "0:rule", "'you may': declining pays nothing and puts no token on it (5/5/3)", () => {
  const { engine, id } = whaleBoard({ zone: "hand", icons: { elitism: 8 } });
  play(engine, P1, id("w"));
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 3);
  assert.equal(tokensOn(engine, id("w")), 0);
  assert.deepEqual(stats(engine, id("w")), [5, 5, 3]);
});

clause(WHALE, "0:rule", "if I cannot pay 3 (only 2 resources left after deploying) I cannot get the token and am not stuck", () => {
  const { engine, id } = whaleBoard({ zone: "hand", icons: { elitism: 7 } });
  play(engine, P1, id("w"));
  if (engine.state.pendingChoice) {
    refused(() => answerPending(engine, "mayPay", { pay: true }), "paying 3 with only 2 resources");
  }
  assert.equal(tokensOn(engine, id("w")), 0);
  assert.equal(ready(engine), 2, "nothing was paid");
});

clause(WHALE, "0:rule", "paying exactly 3 is enough: with 9 resources 1 is left over after both payments", () => {
  const { engine, id } = whaleBoard({ zone: "hand", icons: { elitism: 9 } });
  play(engine, P1, id("w"));
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready(engine), 1);
});

clause(WHALE, "0:rule", "put into play by an effect (not deployed) I may still pay 3 for the token", () => {
  const { engine, id } = whaleBoard({
    zone: "discard",
    icons: { elitism: 3 },
    extra: [{ key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("re"), { selected: { t: [id("w")] } });
  assert.equal(zoneOf(engine, id("w")), "play");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(tokensOn(engine, id("w")), 1);
  assert.equal(ready(engine), 0);
});

clause(WHALE, "0:rule", "only when THIS card enters play: another character entering play asks nothing and the Whale already in play gets no token", () => {
  const { engine, id } = whaleBoard({
    icons: { elitism: 5 },
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("newbie"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("w")), 0);
  assert.equal(ready(engine), 4);
});

clause(WHALE, "0:rule", "the opponent's own Whale gives THEM the choice, paid from THEIR resources", () => {
  const { engine, id } = whaleBoard({ zone: "hand", owner: P2, icons: { elitism: 8 }, turn: 2, active: P2 });
  play(engine, P2, id("w"));
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(tokensOn(engine, id("w")), 1);
  assert.equal(ready(engine, P2), 0);
  assert.equal(ready(engine, P1), 0, "my resources are untouched (I have none anyway)");
});

clause(WHALE, "0:rule", "deploys for exactly its printed cost of 5 with [E][E][E]: 4 resources or no [E] are refused", () => {
  const short = whaleBoard({ zone: "hand", icons: { elitism: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("w")), "one short");
  assert.equal(zoneOf(short.engine, short.id("w")), "hand");
  const noThreshold = whaleBoard({ zone: "hand", icons: { rage: 9 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("w")), "no [E]");
  const twoE = whaleBoard({ zone: "hand", icons: { elitism: 2, rage: 6 } });
  refused(() => playRaw(twoE.engine, P1, twoE.id("w")), "only [E][E]");
  const ok = whaleBoard({ zone: "hand", icons: { elitism: 3, rage: 2 } });
  playRaw(ok.engine, P1, ok.id("w"));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("w")), "play");
});

for (const [tokens, expected] of [
  [0, [5, 5, 3]],
  [1, [9, 9, 3]],
  [2, [9, 9, 3]],
  [5, [9, 9, 3]]
] as const) {
  clause(WHALE, "1:rule", `with ${tokens} token${tokens === 1 ? "" : "s"} it is a ${expected.join("/")} (the +4/+4 is a flat bonus while there is a token, not per token)`, () => {
    const { engine, id } = whaleBoard({ tokens });
    assert.deepEqual(stats(engine, id("w")), [...expected]);
  });
}

clause(WHALE, "1:rule", "a token on ANOTHER card does not help the Whale", () => {
  const { engine, id } = whaleBoard({ tokens: 0, extra: [{ key: "w2", def: printing(WHALE), owner: P1, zone: "play", counters: { token: 1 } }] });
  assert.deepEqual(stats(engine, id("w")), [5, 5, 3]);
  assert.deepEqual(stats(engine, id("w2")), [9, 9, 3]);
});

clause(WHALE, "1:rule", "'While': the bonus ends the moment the last token is removed", () => {
  const { engine, id } = whaleBoard({ tokens: 1, extra: [{ key: "strip", def: stripTokenTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(engine, id("w")), [9, 9, 3]);
  play(engine, P1, id("strip"), { selected: { t: [id("w")] } });
  assert.equal(tokensOn(engine, id("w")), 0);
  assert.deepEqual(stats(engine, id("w")), [5, 5, 3]);
});

clause(WHALE, "1:rule", "with two tokens, removing one keeps the bonus", () => {
  const { engine, id } = whaleBoard({ tokens: 2, extra: [{ key: "strip", def: stripTokenTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("strip"), { selected: { t: [id("w")] } });
  assert.equal(tokensOn(engine, id("w")), 1);
  assert.deepEqual(stats(engine, id("w")), [9, 9, 3]);
});

clause(WHALE, "1:rule", "an opponent-controlled Whale with a token also gets the bonus", () => {
  const { engine, id } = whaleBoard({ tokens: 1, owner: P2 });
  assert.deepEqual(stats(engine, id("w")), [9, 9, 3]);
});

clause(WHALE, "1:rule", "the life bonus is real: with a token (9 life) 8 damage leaves it alive and 9 destroys it; without, 5 destroys it", () => {
  const make = (tokens: number, amount: number) => whaleBoard({ tokens, extra: [{ key: "hit", def: hitTactic(amount), owner: P1, zone: "hand" }] });
  const survive = make(1, 8);
  play(survive.engine, P1, survive.id("hit"), { selected: { t: [survive.id("w")] } });
  assert.equal(zoneOf(survive.engine, survive.id("w")), "play");
  const die = make(1, 9);
  play(die.engine, P1, die.id("hit"), { selected: { t: [die.id("w")] } });
  assert.equal(zoneOf(die.engine, die.id("w")), "discard");
  const bare = make(0, 5);
  play(bare.engine, P1, bare.id("hit"), { selected: { t: [bare.id("w")] } });
  assert.equal(zoneOf(bare.engine, bare.id("w")), "discard");
});

clause(WHALE, "1:rule", "the strength bonus is real: with a token the Whale hits the faction for 9", () => {
  const { engine, id } = whaleBoard({ tokens: 1 });
  const start = influenceOf(engine, P2);
  fight(engine, P1, [id("w")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), start - 9);
});

clause(WHALE, "1:rule", "tokens vanish when it leaves play (CR 409.2): a Whale with a token that is bounced and deployed again, declining the payment, is a plain 5/5/3", () => {
  const { engine, id } = whaleBoard({
    tokens: 1,
    icons: { elitism: 5 },
    extra: [{ key: "bounce", def: bounceAnyTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("w")] } });
  assert.equal(zoneOf(engine, id("w")), "hand");
  assert.equal(tokensOn(engine, id("w")), 0, "its token is gone");
  play(engine, P1, id("w"));
  assert.equal(zoneOf(engine, id("w")), "play");
  assert.equal(tokensOn(engine, id("w")), 0);
  assert.deepEqual(stats(engine, id("w")), [5, 5, 3]);
});

clause(WHALE, "1:rule", "the bonus is a static rule, not an ability: the Whale has nothing to activate", () => {
  assert.equal(hasNoActivatedAbility(WHALE), true);
});

// =============================================================================
// Surprising Nuisance
// Put 2 Micromajig tokens into play.
// Tactic, gearsmith, cost 3, [E].
// (CR 409.3c.1: Micromajig tokens are Gearsmith character cards with 1 strength,
//  1 life, 3 speed and the "majig" subtype; CR 409.3b: the token's owner is the
//  player who controlled the effect that created it.)
// =============================================================================

const NUISANCE = "0dfa9c30-242f-4663-bc0e-4fb59c368db6";

function nuisanceBoard(opts: { icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[]; chars?: boolean } = {}) {
  return devBoard(
    [
      { key: "sn", def: printing(NUISANCE), owner: P1, zone: "hand" },
      ...(opts.chars === false ? [] : [{ key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" as const }]),
      ...res(opts.icons ?? { elitism: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(NUISANCE, "0:rule", "puts exactly 2 Micromajig tokens into play under my control, pays exactly 3, and the tactic goes to my discard pile", () => {
  const { engine, id } = nuisanceBoard({ icons: { elitism: 5 } });
  const before = ready(engine);
  play(engine, P1, id("sn"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 3, "exactly its cost");
  const tokens = inPlayNamed(engine, P1, "Micromajig");
  assert.equal(tokens.length, 2, "two tokens, not one and not three");
  assert.notEqual(tokens[0], tokens[1]);
  assert.equal(zoneOf(engine, id("sn")), "discard");
  assert.deepEqual(inPlayNamed(engine, P2, "Micromajig"), [], "the opponent gets none");
});

clause(NUISANCE, "0:rule", "each token is a Micromajig character with 1 strength, 1 life, 3 speed and the 'majig' subtype (CR 409.3c.1)", () => {
  const { engine, id } = nuisanceBoard();
  play(engine, P1, id("sn"));
  const tokens = inPlayNamed(engine, P1, "Micromajig");
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.equal(engine.getDefinition(token).type, "character");
    assert.deepEqual(stats(engine, token), [1, 1, 3]);
    assert.ok(engine.getDefinition(token).subtype.includes("majig"), "subtype majig");
    assert.equal(zoneOf(engine, token), "play");
  }
});

clause(NUISANCE, "0:rule", "each token is a GEARSMITH character card (CR 409.3c.1), not a universal one", () => {
  const { engine, id } = nuisanceBoard();
  play(engine, P1, id("sn"));
  const tokens = inPlayNamed(engine, P1, "Micromajig");
  assert.equal(tokens.length, 2);
  for (const token of tokens) assert.equal(engine.getDefinition(token).trade, "gearsmith");
});

clause(NUISANCE, "0:rule", "the tokens are owned and controlled by the player who played the tactic (CR 409.3b), also when the opponent plays it", () => {
  const mine = nuisanceBoard();
  play(mine.engine, P1, mine.id("sn"));
  for (const token of inPlayNamed(mine.engine, P1, "Micromajig")) {
    assert.equal(mine.engine.state.cards[token].ownerId, P1);
    assert.equal(mine.engine.state.cards[token].controllerId, P1);
  }
  const theirs = devBoard(
    [{ key: "sn", def: printing(NUISANCE), owner: P2, zone: "hand" }, ...res({ elitism: 3 }, P2)],
    { turn: 2, activePlayerId: P2 }
  );
  play(theirs.engine, P2, theirs.id("sn"));
  const theirTokens = inPlayNamed(theirs.engine, P2, "Micromajig");
  assert.equal(theirTokens.length, 2);
  assert.deepEqual(inPlayNamed(theirs.engine, P1, "Micromajig"), []);
  for (const token of theirTokens) assert.equal(theirs.engine.state.cards[token].ownerId, P2);
});

clause(NUISANCE, "0:rule", "it needs no target: it works with no characters in play, and asks nothing", () => {
  const { engine, id } = nuisanceBoard({ chars: false });
  play(engine, P1, id("sn"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 2);
});

clause(NUISANCE, "0:rule", "played twice it makes 4 tokens in all", () => {
  const { engine, id } = nuisanceBoard({ icons: { elitism: 6 }, extra: [{ key: "sn2", def: printing(NUISANCE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sn"));
  play(engine, P1, id("sn2"));
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 4);
});

clause(NUISANCE, "0:rule", "costs exactly 3 with [E]: two resources, or three Rage, are refused (nothing paid, still in hand)", () => {
  const short = nuisanceBoard({ icons: { elitism: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("sn")), "one short");
  assert.equal(zoneOf(short.engine, short.id("sn")), "hand");
  assert.equal(ready(short.engine), 2);
  assert.equal(inPlayNamed(short.engine, P1, "Micromajig").length, 0);
  const noThreshold = nuisanceBoard({ icons: { rage: 5 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("sn")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("sn")), "hand");
  const mixed = nuisanceBoard({ icons: { elitism: 1, rage: 2 } });
  play(mixed.engine, P1, mixed.id("sn"));
  assert.equal(inPlayNamed(mixed.engine, P1, "Micromajig").length, 2, "one [E] plus any two resources is enough");
});

clause(NUISANCE, "0:rule", "the tokens arrive when the tactic resolves, not while it is still being deployed", () => {
  const { engine, id } = nuisanceBoard();
  playRaw(engine, P1, id("sn"));
  assert.equal(zoneOf(engine, id("sn")), "deploying");
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 0);
  resolvePendingResponses(engine);
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 2);
});

clause(NUISANCE, "0:rule", "as a tactic it can be played in response on the opponent's turn: the new tokens can block that very attack", () => {
  const { engine, id } = nuisanceBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  play(engine, P1, id("sn"));
  const tokens = inPlayNamed(engine, P1, "Micromajig");
  assert.equal(tokens.length, 2);
  declareBlockers(engine, P1, [tokens[0]]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [tokens[0]]);
});

clause(NUISANCE, "0:rule", "put into play is not 'started the turn in play': the tokens cannot attack this turn, but can on my next turn (CR 204.3)", () => {
  const { engine, id } = nuisanceBoard();
  play(engine, P1, id("sn"));
  const tokens = inPlayNamed(engine, P1, "Micromajig");
  refused(
    () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [tokens[0]], target: { type: "faction", playerId: P2 } }),
    "a token that just entered play cannot attack",
  /did not start the turn in play/
  );
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const start = influenceOf(engine, P2);
  fight(engine, P1, [tokens[0]], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), start - 1);
});

clause(NUISANCE, "0:rule", "a token that leaves play disappears (CR 409.3a): it is not in any discard pile", () => {
  const { engine, id } = nuisanceBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sn"));
  const [token] = inPlayNamed(engine, P1, "Micromajig");
  play(engine, P1, id("kill"), { selected: { t: [token] } });
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 1);
  assert.equal(discardOf(engine, P1).includes(token), false);
  assert.equal(discardOf(engine, P2).includes(token), false);
  assert.ok(!engine.state.cards[token] || engine.state.cards[token].zone === "removed", "the token no longer exists as a card in any ordinary area");
});

// =============================================================================
// Time Portal
// At the start of your turn, you may put a Micromajig token into play.
// Location, gearsmith, cost 4, [E][E][E], structure 4.
// =============================================================================

const PORTAL = "74fbda20-68db-4e19-91e9-d621f0bee9f7";

/** Portal(s) in play; by default it is the opponent's turn 2, so ending it starts MY turn 3. */
function portalBoard(
  opts: { zone?: Zone; owner?: PlayerId; portals?: number; turn?: number; active?: PlayerId; icons?: Icons; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  const count = opts.portals ?? 1;
  return devBoard(
    [
      ...Array.from({ length: count }, (_, i): CardPlacement => ({ key: i === 0 ? "tp" : `tp${i}`, def: printing(PORTAL), owner, zone: opts.zone ?? "play" })),
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}, owner),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

/** Ends `from`'s turn and, if the Portal asks, says yes (option 1) or no (option 0). */
function startTurnAnswer(game: ReturnType<typeof portalBoard>, from: PlayerId, make: boolean): void {
  endTurn(game.engine, from);
  if (pending(game.engine)?.kind === "chooserSelectsOption") answerPending(game.engine, "chooserSelectsOption", { index: make ? 1 : 0 });
}

clause(PORTAL, "0:rule", "at the start of my turn I am asked, and saying yes puts a Micromajig token (1/1/3 majig character) into play under my control", () => {
  const game = portalBoard();
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(game.engine.state.pendingChoice, undefined);
  const tokens = inPlayNamed(game.engine, P1, "Micromajig");
  assert.equal(tokens.length, 1, "exactly one token");
  assert.deepEqual(stats(game.engine, tokens[0]), [1, 1, 3]);
  assert.ok(game.engine.getDefinition(tokens[0]).subtype.includes("majig"), "game.engine.getDefinition(tokens[0]).subtype.includes(\"majig\")");
  assert.equal(game.engine.state.cards[tokens[0]].ownerId, P1);
  assert.deepEqual(inPlayNamed(game.engine, P2, "Micromajig"), []);
});

clause(PORTAL, "0:rule", "the token it puts into play is a GEARSMITH character card (CR 409.3c.1), not a universal one", () => {
  const game = portalBoard();
  startTurnAnswer(game, P2, true);
  const tokens = inPlayNamed(game.engine, P1, "Micromajig");
  assert.equal(tokens.length, 1);
  assert.equal(game.engine.getDefinition(tokens[0]).trade, "gearsmith");
});

clause(PORTAL, "0:rule", "'you may': saying no puts no token into play, and nothing is left pending", () => {
  const game = portalBoard();
  startTurnAnswer(game, P2, false);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
});

clause(PORTAL, "0:rule", "it is only MY turn: at the start of my opponent's turn I am not asked and nothing is made", () => {
  const game = portalBoard({ turn: 1, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
  assert.equal(inPlayNamed(game.engine, P2, "Micromajig").length, 0);
});

clause(PORTAL, "0:rule", "it happens every one of my turns: two turns, two tokens", () => {
  const game = portalBoard();
  startTurnAnswer(game, P2, true);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 1);
  endTurn(game.engine, P1);
  startTurnAnswer(game, P2, true);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 2);
});

clause(PORTAL, "0:rule", "each Time Portal is its own trigger: two Portals mean two questions and (saying yes to both) two tokens", () => {
  const game = portalBoard({ portals: 2 });
  endTurn(game.engine, P2);
  let questions = 0;
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 6) {
    const pc = pending(game.engine)!;
    if (pc.kind === "chooserSelectsOption") {
      questions += 1;
      answerPending(game.engine, "chooserSelectsOption", { index: 1 });
    } else {
      drain(game.engine, declineAll, 1);
    }
  }
  assert.equal(questions, 2);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 2);
});

clause(PORTAL, "0:rule", "a Portal that is no longer in play does nothing at my next turn start", () => {
  const game = portalBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P2, zone: "hand" }] });
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("tp")] } });
  assert.equal(zoneOf(game.engine, game.id("tp")), "discard");
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
});

clause(PORTAL, "0:rule", "a Portal in my hand does nothing at the start of my turn", () => {
  const game = portalBoard({ zone: "hand" });
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
});

clause(PORTAL, "0:rule", "the opponent's Time Portal works for THEM at the start of THEIR turn only: the token is theirs, and I am not asked", () => {
  const game = portalBoard({ owner: P2, turn: 1, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2);
  answerPending(game.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(inPlayNamed(game.engine, P2, "Micromajig").length, 1);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.state.pendingChoice, undefined, "not at the start of my turn");
});

clause(PORTAL, "0:rule", "a token put into play at the start of the turn cannot attack that turn (CR 204.3b), but a settled character can", () => {
  const game = portalBoard();
  startTurnAnswer(game, P2, true);
  const [token] = inPlayNamed(game.engine, P1, "Micromajig");
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [token], target: { type: "faction", playerId: P2 } }),
    "the token was not in play when the turn started"
  );
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  assert.ok(battleOf(game.engine), "control: my settled character can attack");
});

clause(PORTAL, "0:rule", "the Portal deploys for exactly its printed cost of 4 with [E][E][E] (structure 4): three resources, or no [E], are refused", () => {
  const make = (icons: Icons) => portalBoard({ zone: "hand", icons, turn: 1, active: P1 });
  const ok = make({ elitism: 4 });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("tp"));
  assert.equal(zoneOf(ok.engine, ok.id("tp")), "play");
  assert.equal(before - ready(ok.engine), 4);
  const short = make({ elitism: 3 });
  refused(() => playRaw(short.engine, P1, short.id("tp")), "one short");
  assert.equal(zoneOf(short.engine, short.id("tp")), "hand");
  const noThreshold = make({ rage: 8 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("tp")), "no [E]");
  const twoE = make({ elitism: 2, rage: 4 });
  refused(() => playRaw(twoE.engine, P1, twoE.id("tp")), "only two [E]");
});

clause(PORTAL, "0:rule", "the Portal is a location with structure 4: 3 damage leaves it, 4 destroys it", () => {
  const hit = (amount: number) => {
    const game = devBoard(
      [
        { key: "tp", def: printing(PORTAL), owner: P2, zone: "play" },
        { key: "atk", def: character({ name: "Attacker", strength: amount, life: 9, speed: 1 }), owner: P1, zone: "play" }
      ],
      { turn: 1, activePlayerId: P1 }
    );
    fight(game.engine, P1, [game.id("atk")], { type: "card", cardId: game.id("tp") }, []);
    return zoneOf(game.engine, game.id("tp"));
  };
  assert.equal(hit(3), "play");
  assert.equal(hit(4), "discard");
});

// =============================================================================
// Vanilla characters (no rules text): Terra Cotta Flagellator, Agile Highwayman
// =============================================================================

interface VanillaSpec {
  id: string;
  cost: number;
  icon: StapleIcon;
  n: number;
  str: number;
  life: number;
  speed: number;
  subtype: string[];
  trade: string;
}

function vanillaBoard(
  spec: VanillaSpec,
  opts: { zone?: Zone; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "v", def: printing(spec.id), owner: P1, zone: opts.zone ?? "hand" },
      ...res(opts.icons ?? iconsOf(spec.icon, spec.cost)),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

function vanillaCases(spec: VanillaSpec): Array<{ title: string; fn: () => void }> {
  const cases: Array<{ title: string; fn: () => void }> = [];
  const add = (title: string, fn: () => void) => cases.push({ title, fn });
  const otherIcon: StapleIcon = spec.icon === "rage" ? "greed" : "rage";

  add(`deploys for exactly its printed cost of ${spec.cost}: that many resources are paid, no more`, () => {
    const g = vanillaBoard(spec, { icons: iconsOf(spec.icon, spec.cost + 2) });
    const before = ready(g.engine);
    play(g.engine, P1, g.id("v"));
    assert.equal(zoneOf(g.engine, g.id("v")), "play");
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(before - ready(g.engine), spec.cost);
  });

  add(`is refused one resource short of its cost (${spec.cost - 1} of ${spec.cost}) with the threshold met; it stays in hand and nothing is paid`, () => {
    const g = vanillaBoard(spec, { icons: iconsOf(spec.icon, spec.cost - 1) });
    refused(() => playRaw(g.engine, P1, g.id("v")), "one short");
    assert.equal(zoneOf(g.engine, g.id("v")), "hand");
    assert.equal(ready(g.engine), spec.cost - 1);
  });

  add(`is refused without its threshold (${spec.n} of the matching icon) however many other resources there are`, () => {
    const none = vanillaBoard(spec, { icons: iconsOf(otherIcon, spec.cost + 5) });
    refused(() => playRaw(none.engine, P1, none.id("v")), "no matching icon");
    assert.equal(zoneOf(none.engine, none.id("v")), "hand");
    assert.equal(ready(none.engine), spec.cost + 5);
    if (spec.n > 1) {
      const fewer = vanillaBoard(spec, { icons: { ...iconsOf(spec.icon, spec.n - 1), ...iconsOf(otherIcon, spec.cost + 5) } });
      refused(() => playRaw(fewer.engine, P1, fewer.id("v")), "one matching icon short");
      assert.equal(zoneOf(fewer.engine, fewer.id("v")), "hand");
    }
  });

  add(`exactly the threshold (${spec.n} matching icon${spec.n === 1 ? "" : "s"}) plus other resources for the rest is enough`, () => {
    const g = vanillaBoard(spec, { icons: { ...iconsOf(spec.icon, spec.n), ...iconsOf(otherIcon, spec.cost - spec.n) } });
    play(g.engine, P1, g.id("v"));
    assert.equal(zoneOf(g.engine, g.id("v")), "play");
    assert.equal(ready(g.engine), 0);
  });

  add("the threshold is never spent (CR 405.6): two copies can be deployed in one turn off the same icons", () => {
    const g = vanillaBoard(spec, {
      icons: iconsOf(spec.icon, spec.cost * 2),
      extra: [{ key: "v2", def: printing(spec.id), owner: P1, zone: "hand" }]
    });
    play(g.engine, P1, g.id("v"));
    play(g.engine, P1, g.id("v2"));
    assert.equal(zoneOf(g.engine, g.id("v")), "play");
    assert.equal(zoneOf(g.engine, g.id("v2")), "play");
  });

  add(`has its printed stats in play: ${spec.str} strength, ${spec.life} life, ${spec.speed} speed; a ${spec.subtype.join(" ")} ${spec.trade} character`, () => {
    const g = vanillaBoard(spec, { icons: iconsOf(spec.icon, spec.cost) });
    play(g.engine, P1, g.id("v"));
    assert.deepEqual(stats(g.engine, g.id("v")), [spec.str, spec.life, spec.speed]);
    const def = g.engine.getDefinition(g.id("v"));
    assert.equal(def.type, "character");
    assert.deepEqual([...def.subtype].sort(), [...spec.subtype].sort());
    assert.equal(def.trade, spec.trade);
  });

  add("has no rules text: no keywords, no restrictions, no abilities, and nothing triggers or is asked when it enters play", () => {
    const g = vanillaBoard(spec, { icons: iconsOf(spec.icon, spec.cost) });
    play(g.engine, P1, g.id("v"));
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.deepEqual(g.engine.getKeywords(g.id("v")), []);
    assert.deepEqual(g.engine.getRestrictions(g.id("v")), []);
    assert.equal(hasNoActivatedAbility(spec.id), true);
    assert.equal(printing(spec.id).behavior?.abilities?.length ?? 0, 0, "no abilities at all");
  });

  add("as a character it can only be deployed on its controller's own turn", () => {
    const g = vanillaBoard(spec, { turn: 2, active: P2 });
    refused(() => playRaw(g.engine, P1, g.id("v")), "the opponent's turn");
    assert.equal(zoneOf(g.engine, g.id("v")), "hand");
  });

  add("it cannot attack the turn it enters play (no AGGRO), but can on its controller's next turn, hitting for its strength", () => {
    const g = vanillaBoard(spec, { icons: iconsOf(spec.icon, spec.cost) });
    play(g.engine, P1, g.id("v"));
    refused(
      () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("v")], target: { type: "faction", playerId: P2 } }),
      "a character that just entered play cannot attack",
    /did not start the turn in play/
    );
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P1);
    const start = influenceOf(g.engine, P2);
    fight(g.engine, P1, [g.id("v")], { type: "faction", playerId: P2 }, []);
    assert.equal(influenceOf(g.engine, P2), start - spec.str);
  });

  add(`dies at exactly its life of ${spec.life}: ${spec.life - 1} damage leaves it alive, ${spec.life} destroys it`, () => {
    for (const [amount, zone] of [
      [spec.life - 1, "play"],
      [spec.life, "discard"]
    ] as const) {
      const g = vanillaBoard(spec, { zone: "play", extra: [{ key: "hit", def: hitTactic(amount), owner: P1, zone: "hand" }] });
      play(g.engine, P1, g.id("hit"), { selected: { t: [g.id("v")] } });
      assert.equal(zoneOf(g.engine, g.id("v")), zone, `${amount} damage`);
    }
  });

  add(`its speed of ${spec.speed} orders its damage: a faster foe that can kill it strikes first, so it deals nothing`, () => {
    const g = vanillaBoard(spec, {
      zone: "play",
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Fast Attacker", strength: spec.life, life: 99, speed: spec.speed + 1 }), owner: P2, zone: "play" }]
    });
    declareAttackBy(g.engine, P2, [g.id("atk")]);
    declareBlockers(g.engine, P1, [g.id("v")]);
    autoResolveBattle(g.engine);
    assert.equal(zoneOf(g.engine, g.id("v")), "discard");
    assert.equal(g.engine.state.cards[g.id("atk")].damage, 0, "it never got to deal damage");
  });

  add(`its speed of ${spec.speed} orders its damage: against a slower blocker that it can kill it strikes first and takes nothing`, () => {
    const g = vanillaBoard(spec, {
      zone: "play",
      extra: [{ key: "blk", def: character({ name: "Slow Blocker", strength: spec.life, life: spec.str, speed: spec.speed - 1 }), owner: P2, zone: "play" }]
    });
    declareAttackBy(g.engine, P1, [g.id("v")]);
    declareBlockers(g.engine, P2, [g.id("blk")]);
    autoResolveBattle(g.engine);
    assert.equal(zoneOf(g.engine, g.id("blk")), "discard");
    assert.equal(zoneOf(g.engine, g.id("v")), "play");
    assert.equal(g.engine.state.cards[g.id("v")].damage, 0);
  });

  return cases;
}

const TERRA = "19aa978a-01ec-4ded-8425-fb59a7073caf";
for (const c of vanillaCases({ id: TERRA, cost: 5, icon: "elitism", n: 2, str: 5, life: 3, speed: 2, subtype: ["plant", "golem"], trade: "gearsmith" })) {
  clause(TERRA, "vanilla", c.title, c.fn);
}

const HIGHWAYMAN = "639b4566-af65-49ba-b3c7-1a310f5b1000";
for (const c of vanillaCases({ id: HIGHWAYMAN, cost: 3, icon: "deception", n: 1, str: 2, life: 1, speed: 4, subtype: ["outlaw"], trade: "rogue" })) {
  clause(HIGHWAYMAN, "vanilla", c.title, c.fn);
}

// =============================================================================
// Repurpose
// COST: Pick an item. EFFECT: Destroy the item. Draw a card.
// FLIP UP: 2 [E][E]
// Tactic, gearsmith, cost 4, [E][E].
// =============================================================================

const REPURPOSE = "00f518f0-44df-4963-b387-9db6782cfe69";

function rpBoard(
  opts: {
    zone?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    spentIcons?: Icons;
    deck?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const zone = opts.zone ?? "hand";
  return devBoard(
    [
      { key: "rp", def: printing(REPURPOSE), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "mine2", def: item({ name: "My Other Item" }), owner: P1, zone: "play" },
      { key: "theirs", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "plate", def: item({ name: "Plate", attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "foe" },
      ...fillers("dk", opts.deck ?? 3, P1, "deck"),
      ...res(opts.icons ?? { elitism: 4 }),
      ...spent(opts.spentIcons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type RpGame = ReturnType<typeof rpBoard>;

const rpExtras = (): CardPlacement[] => [
  { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
  { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
  { key: "fdItem", def: item({ name: "Face Down Item" }), owner: P1, zone: "play", faceDown: true },
  { key: "handItem", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
  { key: "discardItem", def: item({ name: "Discard Item" }), owner: P1, zone: "discard" }
];

clause(REPURPOSE, "0:ability", "destroys the picked item (to its owner's discard pile), draws exactly the top card, pays exactly 4, and the tactic goes to my discard pile", () => {
  const { engine, id } = rpBoard({ icons: { elitism: 6 } });
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  play(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("mine")), "discardOf(engine, P1).includes(id(\"mine\"))");
  assert.equal(zoneOf(engine, id("rp")), "discard");
  assert.equal(before - ready(engine), 4, "exactly its cost");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand, one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the TOP card of my deck was drawn");
  assert.equal(deckOf(engine, P1).length, 2);
});

clause(REPURPOSE, "0:ability", "the opponent's item can be picked: it goes to THEIR discard pile", () => {
  const { engine, id } = rpBoard();
  play(engine, P1, id("rp"), { selected: { it: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("theirs")), "discardOf(engine, P2).includes(id(\"theirs\"))");
  assert.equal(discardOf(engine, P1).includes(id("theirs")), false);
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(REPURPOSE, "0:ability", "an item attached to a character can be picked: it is destroyed and its host stays in play", () => {
  const { engine, id } = rpBoard();
  play(engine, P1, id("rp"), { selected: { it: [id("plate")] } });
  assert.equal(zoneOf(engine, id("plate")), "discard");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(REPURPOSE, "0:ability", "only the picked item is destroyed: every other item and character stays", () => {
  const { engine, id } = rpBoard();
  play(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  for (const key of ["mine2", "theirs", "plate", "ally", "foe"]) assert.equal(zoneOf(engine, id(key)), "play", key);
});

clause(REPURPOSE, "0:ability", "it draws ONE card (not two) and none for the opponent", () => {
  const { engine, id } = rpBoard({ deck: 5, extra: fillers("od", 3, P2, "deck") });
  const oppHand = handOf(engine, P2).length;
  const deckBefore = deckOf(engine, P1).length;
  play(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.equal(deckOf(engine, P2).length, 3);
});

clause(REPURPOSE, "0:ability", "with an empty deck the draw simply does not happen (CR 306.2), the item is still destroyed, and the game goes on", () => {
  const { engine, id } = rpBoard({ deck: 0 });
  assert.equal(deckOf(engine, P1).length, 0);
  play(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("rp")), "discard");
});

for (const [key, why] of [
  ["ally", "a character"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fdItem", "a face-down card (only a resource, CR 411.1)"],
  ["handItem", "an item card in my hand (CR 402.3)"],
  ["discardItem", "an item card in my discard pile (CR 402.3)"]
] as const) {
  clause(REPURPOSE, "0:ability", `cannot pick ${why}: refused, nothing paid, the tactic stays in hand`, () => {
    const bad = rpBoard({ extra: rpExtras() });
    const before = ready(bad.engine);
    refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: { it: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("rp")), "hand");
    assert.equal(ready(bad.engine), before, "nothing paid");
    const good = rpBoard({ extra: rpExtras() });
    play(good.engine, P1, good.id("rp"), { selected: { it: [good.id("mine")] } });
    assert.equal(zoneOf(good.engine, good.id("mine")), "discard", "control: an item works");
  });
}

clause(REPURPOSE, "0:ability", "cannot pick a faction, and needs exactly one item (none and two are refused)", () => {
  const bad = rpBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: { it: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: { it: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: {} }), "no declaration");
  refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: { it: [bad.id("mine"), bad.id("theirs")] } }), "two items");
  assert.equal(zoneOf(bad.engine, bad.id("rp")), "hand");
});

clause(REPURPOSE, "0:ability", "with no item in play there is nothing to pick: it cannot be played", () => {
  const bad = devBoard([
    { key: "rp", def: printing(REPURPOSE), owner: P1, zone: "hand" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    ...res({ elitism: 4 })
  ]);
  refused(() => playRaw(bad.engine, P1, bad.id("rp"), { selected: {} }), "no item anywhere");
  assert.equal(zoneOf(bad.engine, bad.id("rp")), "hand");
});

clause(REPURPOSE, "0:ability", "costs exactly 4 with [E][E]: three resources, four Rage, or one [E] plus three Rage are refused; [E][E] plus two others works", () => {
  const make = (icons: Icons) => rpBoard({ icons });
  const short = make({ elitism: 3 });
  refused(() => playRaw(short.engine, P1, short.id("rp"), { selected: { it: [short.id("mine")] } }), "three resources");
  assert.equal(zoneOf(short.engine, short.id("rp")), "hand");
  const rage = make({ rage: 6 });
  refused(() => playRaw(rage.engine, P1, rage.id("rp"), { selected: { it: [rage.id("mine")] } }), "no [E]");
  const oneE = make({ elitism: 1, rage: 5 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("rp"), { selected: { it: [oneE.id("mine")] } }), "only one [E]");
  const ok = make({ elitism: 2, rage: 2 });
  play(ok.engine, P1, ok.id("rp"), { selected: { it: [ok.id("mine")] } });
  assert.equal(zoneOf(ok.engine, ok.id("mine")), "discard");
  assert.equal(ready(ok.engine), 0);
});

clause(REPURPOSE, "0:ability", "spent [E] still meet the threshold: [E][E] already spent plus four ready Rage works", () => {
  const { engine, id } = rpBoard({ icons: { rage: 4 }, spentIcons: { elitism: 2 } });
  play(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(REPURPOSE, "0:ability", "the cost is paid when it is played, before the opponent can respond; the item is destroyed and the card drawn when it resolves", () => {
  const { engine, id } = rpBoard();
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  assert.equal(ready(engine), 0);
  assert.equal(zoneOf(engine, id("rp")), "deploying");
  assert.equal(zoneOf(engine, id("mine")), "play", "not yet destroyed");
  assert.equal(zoneOf(engine, top), "deck", "not yet drawn");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, top), "hand");
});

clause(REPURPOSE, "0:ability", "if the picked item has left play by the time it resolves (destroyed in response), I still draw (CR 402.5: do as much as possible)", () => {
  const { engine, id } = rpBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P2, zone: "hand" }] });
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("rp"), { selected: { it: [id("mine")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("rp")), "discard");
  assert.equal(zoneOf(engine, top), "hand", "the draw does not depend on the item being destroyed by Repurpose");
});

clause(REPURPOSE, "0:ability", "as a tactic it can be played in response on the opponent's turn", () => {
  const { engine, id } = rpBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("rp"), { selected: { it: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore, "the tactic left the hand and a card was drawn");
});

// --- FLIP UP: 2 [E][E] ---

const rpFlip = (game: RpGame, pickKey = "mine", player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("rp"), { it: [game.id(pickKey)] });

clause(REPURPOSE, "1:flipUp", "a face-down Repurpose flips up by paying 2 (it may help pay for itself), then destroys the item, draws a card and goes to the discard pile", () => {
  const game = rpBoard({ zone: "play", icons: { elitism: 2, rage: 3 } });
  const { engine, id } = game;
  const top = deckOf(engine, P1)[0];
  const before = ready(engine);
  assert.equal(before, 6, "five resources and the face-down Repurpose itself");
  rpFlip(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mine")), "discard", "the picked item was destroyed");
  assert.equal(zoneOf(engine, top), "hand", "and a card was drawn");
  assert.equal(zoneOf(engine, id("rp")), "discard", "a resolved tactic goes to its owner's discard pile");
  const paid = before - ready(engine);
  assert.ok(paid === 2 || paid === 3, `2 paid (plus the face-down card itself no longer being a resource), not ${paid} (its printed cost is 4)`);
});

clause(REPURPOSE, "1:flipUp", "FLIP UP costs 2, not the printed 4: a board with only [E][E] and the face-down card itself is enough", () => {
  const game = rpBoard({ zone: "play", icons: { elitism: 2 } });
  assert.equal(ready(game.engine), 3);
  rpFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rp")), "discard");
  const hand = rpBoard({ icons: { elitism: 2, rage: 0 } });
  refused(() => playRaw(hand.engine, P1, hand.id("rp"), { selected: { it: [hand.id("mine")] } }), "from hand the same two resources cannot pay its 4");
});

clause(REPURPOSE, "1:flipUp", "the Repurpose may pay for its own FLIP UP (CR 507.4b): spent [E][E] plus one ready resource and the face-down card (2 ready) is exactly enough", () => {
  const game = rpBoard({ zone: "play", icons: { rage: 1 }, spentIcons: { elitism: 2 } });
  assert.equal(ready(game.engine), 2);
  rpFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rp")), "discard");
  assert.equal(ready(game.engine), 0);
});

clause(REPURPOSE, "1:flipUp", "is refused one resource short of 2: spent [E][E] and only the face-down card itself (1 ready) cannot pay", () => {
  const game = rpBoard({ zone: "play", icons: {}, spentIcons: { elitism: 2 } });
  assert.equal(ready(game.engine), 1);
  // 1 ready resource is the card itself; that is one short of the FLIP UP cost of 2
  refused(() => rpFlip(game), "only 1 resource ready");
  assert.equal(game.engine.state.cards[game.id("rp")].faceDown, true, "still face-down");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
});

clause(REPURPOSE, "1:flipUp", "needs [E][E]: plenty of Rage, or a single [E], is refused; the opponent's [E] do not count", () => {
  const rage = rpBoard({ zone: "play", icons: { rage: 6 } });
  refused(() => rpFlip(rage), "no [E]");
  assert.equal(rage.engine.state.cards[rage.id("rp")].faceDown, true);
  assert.equal(ready(rage.engine), 7, "nothing paid");
  const one = rpBoard({ zone: "play", icons: { elitism: 1, rage: 5 } });
  refused(() => rpFlip(one), "one [E]");
  const theirs = rpBoard({ zone: "play", icons: { rage: 5 }, extra: res({ elitism: 4 }, P2) });
  refused(() => rpFlip(theirs), "their [E]");
  const volitionOnly = rpBoard({ zone: "play", icons: { elitism: 1 }, extra: volition(3, P1) });
  refused(() => rpFlip(volitionOnly), "Volition is not [E]");
});

clause(REPURPOSE, "1:flipUp", "the flipped-up tactic still needs its pick: none, two, a character or a faction is refused (nothing paid, still face-down)", () => {
  const make = () => rpBoard({ zone: "play", icons: { elitism: 2, rage: 2 } });
  const none = make();
  refused(() => flipUpRaw(none.engine, P1, none.id("rp"), { it: [] }), "no pick");
  assert.equal(none.engine.state.cards[none.id("rp")].faceDown, true);
  assert.equal(ready(none.engine), 5);
  const two = make();
  refused(() => flipUpRaw(two.engine, P1, two.id("rp"), { it: [two.id("mine"), two.id("theirs")] }), "two picks");
  const character = make();
  refused(() => rpFlip(character, "ally"), "a character");
  const faction = make();
  refused(() => flipUpRaw(faction.engine, P1, faction.id("rp"), { it: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const good = make();
  rpFlip(good, "theirs");
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("theirs")), "discard", "control: an item works");
});

clause(REPURPOSE, "1:flipUp", "FLIP UP works only on a face-down Repurpose I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = rpBoard({ zone: "play", faceDown: false, icons: { elitism: 4 } });
  refused(() => rpFlip(faceUp), "already face-up");
  const inHand = rpBoard({ icons: { elitism: 4 } });
  refused(() => rpFlip(inHand), "in hand");
  const theirs = rpBoard({ zone: "play", icons: { elitism: 4 } });
  refused(() => rpFlip(theirs, "mine", P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("rp")].faceDown, true);
});

clause(REPURPOSE, "1:flipUp", "FLIP UP does not change WHEN a tactic can be played: in response to the opponent's attack I can flip it up", () => {
  const game = rpBoard({
    zone: "play",
    icons: { elitism: 2 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  rpFlip(game, "theirs");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("theirs")), "discard");
});

// =============================================================================
// Tamper
// COST: Pick a character with an ability in its rules text. EFFECT: Destroy the character.
// FLIP UP: 1 [E][E]
// Tactic, gearsmith, cost 3, [E][E].
// (CR 502.1: an "ability" is a named entry with a cost and an effect; a "When ..." or
//  "While ..." paragraph is a trigger / conditional, CR 503 / 504, not an ability.)
// =============================================================================

const TAMPER = "881a5cfb-d643-4e75-9cab-a5d00d27c32c";

/** A synthetic character with a printed (named, activated) ability: it draws a card. */
const abilityChar = (name = "Has Ability"): CardDefinition =>
  character({
    name,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: { abilities: [{ id: "x", name: "Study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function tamperBoard(
  opts: {
    zone?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    spentIcons?: Icons;
    targets?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const zone = opts.zone ?? "hand";
  return devBoard(
    [
      { key: "tp", def: printing(TAMPER), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      { key: "mage", def: abilityChar("Mage"), owner: P1, zone: "play" },
      { key: "foeMage", def: abilityChar("Foe Mage"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { elitism: 3 }),
      ...spent(opts.spentIcons ?? {}),
      ...(opts.targets ?? []),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type TamperGame = ReturnType<typeof tamperBoard>;

clause(TAMPER, "0:ability", "destroys the picked character with an ability (to its owner's discard pile), pays exactly 3, and the tactic goes to my discard pile", () => {
  const { engine, id } = tamperBoard({ icons: { elitism: 5 } });
  const before = ready(engine);
  play(engine, P1, id("tp"), { selected: { c: [id("foeMage")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeMage")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("foeMage")), "discardOf(engine, P2).includes(id(\"foeMage\"))");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("plain")), "play");
  assert.equal(zoneOf(engine, id("mage")), "play");
});

clause(TAMPER, "0:ability", "my own character with an ability can be picked too: it goes to MY discard pile", () => {
  const { engine, id } = tamperBoard();
  play(engine, P1, id("tp"), { selected: { c: [id("mage")] } });
  assert.equal(zoneOf(engine, id("mage")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("mage")), "discardOf(engine, P1).includes(id(\"mage\"))");
  assert.equal(zoneOf(engine, id("foeMage")), "play");
});

// Real cards with a printed ability (named cost/effect entry) can be picked.
for (const [name, realId] of [
  ["Runic Tattoo Artist (MARK)", ARTIST],
  ["Preponderant Craftsman (CREATE)", CRAFTSMAN],
  ["Oddment Collector (GATHER)", OC],
  ["Booty Licker (CLAIM)", "00df2c7c-19b4-45c3-8a11-eab3ccf19052"]
] as const) {
  clause(TAMPER, "0:ability", `can pick a real character with an ability in its rules text: ${name}`, () => {
    const game = tamperBoard({ targets: [{ key: "real", def: printing(realId), owner: P2, zone: "play" }] });
    play(game.engine, P1, game.id("tp"), { selected: { c: [game.id("real")] } });
    assert.equal(zoneOf(game.engine, game.id("real")), "discard");
  });
}

// A character with no ability at all cannot be picked.
for (const [name, realId] of [
  ["Terra Cotta Flagellator (no rules text)", TERRA],
  ["Agile Highwayman (no rules text)", HIGHWAYMAN]
] as const) {
  clause(TAMPER, "0:ability", `cannot pick a character with no ability: ${name}`, () => {
    const bad = tamperBoard({ targets: [{ key: "real", def: printing(realId), owner: P2, zone: "play" }] });
    refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.id("real")] } }), name);
    assert.equal(zoneOf(bad.engine, bad.id("tp")), "hand");
    assert.equal(ready(bad.engine), 3, "nothing paid");
    const good = tamperBoard({ targets: [{ key: "real", def: printing(realId), owner: P2, zone: "play" }] });
    play(good.engine, P1, good.id("tp"), { selected: { c: [good.id("foeMage")] } });
    assert.equal(zoneOf(good.engine, good.id("foeMage")), "discard", "control: a character with an ability works");
  });
}

clause(TAMPER, "0:ability", "cannot pick a character whose only text is a keyword (COVERT is a keyword, not an ability)", () => {
  const covert = character({ name: "Covert Guy", behavior: { keywords: ["covert"] } });
  const bad = tamperBoard({ targets: [{ key: "kw", def: covert, owner: P2, zone: "play" }] });
  refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.id("kw")] } }), "keyword-only character");
  assert.equal(zoneOf(bad.engine, bad.id("tp")), "hand");
});

for (const [name, realId, why] of [
  ["Runic Whale", WHALE, "its only text is 'When this card enters play ...' and 'While there is a token ...' paragraphs"],
  ["Protractive Golem", GOLEM, "its only text is a threshold paragraph ([E]x6 ...)"],
  ["Velocious Golem", "738bcd83-9c42-4913-a000-2d8ccab2d78e", "its only text is a threshold paragraph ([E]x3 ...)"],
  ["Affectionate Dollkeeper", "bf855ca9-e1ed-47ae-8c79-b625f3d50ffe", "its only text is a threshold paragraph ([D]x3 ... destroy that character)"]
] as const) {
  clause(TAMPER, "0:ability", `cannot pick ${name}: ${why}; those are triggers / conditionals, not abilities (CR 502.1, 503, 504)`, () => {
    const bad = tamperBoard({ targets: [{ key: "real", def: printing(realId), owner: P2, zone: "play" }] });
    refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.id("real")] } }), `${name} has no ability`);
    assert.equal(zoneOf(bad.engine, bad.id("tp")), "hand");
    assert.equal(ready(bad.engine), 3, "nothing paid");
  });
}

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1, even if its front face has an ability)"],
  ["inHand", "a character card with an ability in my hand (CR 402.3)"],
  ["inDiscard", "a character card with an ability in my discard pile (CR 402.3)"]
] as const) {
  clause(TAMPER, "0:ability", `cannot pick ${why}: refused, nothing paid`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: abilityChar("Face Down Mage"), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: abilityChar("Hand Mage"), owner: P1, zone: "hand" },
      { key: "inDiscard", def: abilityChar("Discard Mage"), owner: P1, zone: "discard" }
    ];
    const bad = tamperBoard({ targets: extras() });
    const before = ready(bad.engine);
    refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("tp")), "hand");
    assert.equal(ready(bad.engine), before);
    const good = tamperBoard({ targets: extras() });
    play(good.engine, P1, good.id("tp"), { selected: { c: [good.id("mage")] } });
    assert.equal(zoneOf(good.engine, good.id("mage")), "discard", "control: a character with an ability works");
  });
}

clause(TAMPER, "0:ability", "cannot pick a faction, and needs exactly one character (none and two are refused)", () => {
  const bad = tamperBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("tp"), { selected: { c: [bad.id("mage"), bad.id("foeMage")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("tp")), "hand");
});

clause(TAMPER, "0:ability", "costs exactly 3 with [E][E]: two resources, or three Rage, or one [E] plus two Rage are refused; [E][E] plus one other works", () => {
  const make = (icons: Icons) => tamperBoard({ icons });
  const short = make({ elitism: 2 });
  refused(() => playRaw(short.engine, P1, short.id("tp"), { selected: { c: [short.id("foeMage")] } }), "two resources");
  assert.equal(zoneOf(short.engine, short.id("tp")), "hand");
  const rage = make({ rage: 5 });
  refused(() => playRaw(rage.engine, P1, rage.id("tp"), { selected: { c: [rage.id("foeMage")] } }), "no [E]");
  const oneE = make({ elitism: 1, rage: 4 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("tp"), { selected: { c: [oneE.id("foeMage")] } }), "only one [E]");
  const ok = make({ elitism: 2, rage: 1 });
  play(ok.engine, P1, ok.id("tp"), { selected: { c: [ok.id("foeMage")] } });
  assert.equal(zoneOf(ok.engine, ok.id("foeMage")), "discard");
  assert.equal(ready(ok.engine), 0);
});

clause(TAMPER, "0:ability", "the cost is paid when it is played, before the opponent can respond; the destruction happens when it resolves", () => {
  const { engine, id } = tamperBoard();
  playRaw(engine, P1, id("tp"), { selected: { c: [id("foeMage")] } });
  assert.equal(ready(engine), 0);
  assert.equal(zoneOf(engine, id("tp")), "deploying");
  assert.equal(zoneOf(engine, id("foeMage")), "play");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeMage")), "discard");
});

clause(TAMPER, "0:ability", "if the picked character is removed in response, nothing else is destroyed and the tactic goes to the discard pile", () => {
  const { engine, id } = tamperBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("tp"), { selected: { c: [id("foeMage")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("foeMage")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeMage")), "discard");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  assert.equal(zoneOf(engine, id("mage")), "play");
});

clause(TAMPER, "0:ability", "as a tactic it can be played in response on the opponent's turn", () => {
  const { engine, id } = tamperBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  play(engine, P1, id("tp"), { selected: { c: [id("foeMage")] } });
  assert.equal(zoneOf(engine, id("foeMage")), "discard");
});

// --- FLIP UP: 1 [E][E] ---

const tamperFlip = (game: TamperGame, pickKey = "foeMage", player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("tp"), { c: [game.id(pickKey)] });

clause(TAMPER, "1:flipUp", "a face-down Tamper flips up by paying 1 (and [E][E]), destroys the picked character and goes to the discard pile", () => {
  const game = tamperBoard({ zone: "play", icons: { elitism: 2, rage: 3 } });
  const { engine, id } = game;
  const before = ready(engine);
  assert.equal(before, 6, "five resources and the face-down Tamper itself");
  tamperFlip(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeMage")), "discard");
  assert.equal(zoneOf(engine, id("tp")), "discard");
  const paid = before - ready(engine);
  assert.ok(paid === 1 || paid === 2, `1 paid (plus the face-down card itself no longer being a resource), not ${paid} (its printed cost is 3)`);
});

clause(TAMPER, "1:flipUp", "the Tamper may pay for its own FLIP UP (CR 507.4b): [E][E] spent plus only the face-down card is enough", () => {
  const game = tamperBoard({ zone: "play", icons: {}, spentIcons: { elitism: 2 } });
  assert.equal(ready(game.engine), 1);
  tamperFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foeMage")), "discard");
});

clause(TAMPER, "1:flipUp", "needs [E][E]: lots of Rage, a single [E], the opponent's [E] or Volition are refused (nothing paid, still face-down)", () => {
  const rage = tamperBoard({ zone: "play", icons: { rage: 6 } });
  refused(() => tamperFlip(rage), "no [E]");
  assert.equal(rage.engine.state.cards[rage.id("tp")].faceDown, true);
  assert.equal(ready(rage.engine), 7);
  const one = tamperBoard({ zone: "play", icons: { elitism: 1, rage: 5 } });
  refused(() => tamperFlip(one), "one [E]");
  const theirs = tamperBoard({ zone: "play", icons: { rage: 5 }, extra: res({ elitism: 4 }, P2) });
  refused(() => tamperFlip(theirs), "their [E]");
  const volitionOnly = tamperBoard({ zone: "play", icons: { elitism: 1 }, extra: volition(3, P1) });
  refused(() => tamperFlip(volitionOnly), "Volition is not [E]");
});

clause(TAMPER, "1:flipUp", "the flipped-up tactic still needs a legal pick: a character with no ability, none, two, an item or a faction is refused", () => {
  const make = () => tamperBoard({ zone: "play", icons: { elitism: 2, rage: 1 }, extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }] });
  const vanilla = make();
  refused(() => tamperFlip(vanilla, "plain"), "a character with no ability");
  assert.equal(vanilla.engine.state.cards[vanilla.id("tp")].faceDown, true);
  const none = make();
  refused(() => flipUpRaw(none.engine, P1, none.id("tp"), { c: [] }), "no pick");
  const two = make();
  refused(() => flipUpRaw(two.engine, P1, two.id("tp"), { c: [two.id("mage"), two.id("foeMage")] }), "two picks");
  const itemPick = make();
  refused(() => tamperFlip(itemPick, "thing"), "an item");
  const faction = make();
  refused(() => flipUpRaw(faction.engine, P1, faction.id("tp"), { c: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const good = make();
  tamperFlip(good, "mage");
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("mage")), "discard", "control: a character with an ability works");
});

clause(TAMPER, "1:flipUp", "FLIP UP works only on a face-down Tamper I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = tamperBoard({ zone: "play", faceDown: false, icons: { elitism: 3 } });
  refused(() => tamperFlip(faceUp), "already face-up");
  const inHand = tamperBoard({ icons: { elitism: 3 } });
  refused(() => tamperFlip(inHand), "in hand");
  const theirs = tamperBoard({ zone: "play", icons: { elitism: 3 } });
  refused(() => tamperFlip(theirs, "mage", P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("tp")].faceDown, true);
});

clause(TAMPER, "1:flipUp", "FLIP UP does not change WHEN a tactic can be played: in response to the opponent's attack I can flip it up", () => {
  const game = tamperBoard({
    zone: "play",
    icons: { elitism: 2 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  tamperFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foeMage")), "discard");
});

clause(TAMPER, "1:flipUp", "FLIP UP is cheaper than casting it: [E][E] and the face-down card can flip it, but the same two [E] cannot cast it from hand for 3", () => {
  const flipped = tamperBoard({ zone: "play", icons: { elitism: 2 } });
  tamperFlip(flipped);
  resolvePendingResponses(flipped.engine);
  assert.equal(zoneOf(flipped.engine, flipped.id("foeMage")), "discard");
  const hand = tamperBoard({ icons: { elitism: 2 } });
  refused(() => playRaw(hand.engine, P1, hand.id("tp"), { selected: { c: [hand.id("foeMage")] } }), "two resources cannot cast the 3-cost tactic");
});

// =============================================================================
// Rune of Concealment
// PROTECT -- COST: Pay 2. Deplete this card. Pick a character.
//   EFFECT: The next time the character is destroyed by battle damage this turn, if
//   this card is in play you may destroy it instead. If you do, reduce the amount of
//   damage already inflicted to the character this turn to 0.
// FLIP UP: 0 [E][E]
// Item, gearsmith, cost 2, [E][E].
// =============================================================================

const RUNE = "6b1dcc23-68e3-42cc-aa7b-593437096cd9";

function runeBoard(
  opts: {
    zone?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    spentIcons?: Icons;
    depleted?: boolean;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "rune", def: printing(RUNE), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? false : undefined, depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { elitism: 2 }),
      ...spent(opts.spentIcons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type RuneGame = ReturnType<typeof runeBoard>;

const runeProtect = (game: RuneGame, pickKey: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("rune"), "protect", { selected: { c: [game.id(pickKey)] } });

/**
 * The defender scenario: it is the opponent's turn 2 and `foe` (5 strength, speed 2) attacks.
 * The attack's response window is left open so PROTECT can be used, then blockers are declared.
 */
function runeDefender(extra: CardPlacement[] = [], icons: Icons = { elitism: 2 }): RuneGame {
  return runeBoard({ icons, turn: 2, active: P2, extra });
}

function runeBlock(game: RuneGame, opts: { protect?: string; blockers?: string[] } = {}): void {
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  if (opts.protect) runeProtect(game, opts.protect);
  declareBlockers(game.engine, P1, (opts.blockers ?? ["mine"]).map((key) => game.id(key)));
  autoResolveBattle(game.engine);
}

// --- PROTECT: cost ---

clause(RUNE, "0:ability:protect", "PROTECT pays exactly 2 resources and depletes the Rune", () => {
  const game = runeBoard({ icons: { elitism: 3 } });
  const before = ready(game.engine);
  runeProtect(game, "mine");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(game.engine), 2, "Pay 2");
  assert.equal(isDepleted(game.engine, game.id("rune")), true, "Deplete this card");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
});

clause(RUNE, "0:ability:protect", "refused one resource short of Pay 2: nothing depleted, nothing paid", () => {
  const bad = runeBoard({ icons: { elitism: 1 } });
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id("mine")] }), "one resource");
  assert.equal(isDepleted(bad.engine, bad.id("rune")), false);
  assert.equal(ready(bad.engine), 1);
  const good = runeBoard({ icons: { elitism: 2 } });
  runeProtect(good, "mine");
  assert.equal(isDepleted(good.engine, good.id("rune")), true, "control: two resources work");
});

clause(RUNE, "0:ability:protect", "spent (attached) resources cannot pay for PROTECT", () => {
  const bad = runeBoard({ icons: { elitism: 1 }, spentIcons: { elitism: 3 } });
  assert.equal(ready(bad.engine), 1);
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id("mine")] }), "only 1 ready resource");
  assert.equal(isDepleted(bad.engine, bad.id("rune")), false);
});

clause(RUNE, "0:ability:protect", "'Deplete this card' is a cost: an already depleted Rune cannot PROTECT, and nothing is paid", () => {
  const bad = runeBoard({ icons: { elitism: 3 }, depleted: true });
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id("mine")] }), "already depleted");
  assert.equal(ready(bad.engine), 3);
});

clause(RUNE, "0:ability:protect", "PROTECT has no threshold of its own: two Rage can pay for it", () => {
  const game = runeBoard({ icons: { rage: 2 } });
  runeProtect(game, "mine");
  assert.equal(isDepleted(game.engine, game.id("rune")), true);
  assert.equal(ready(game.engine), 0);
});

clause(RUNE, "0:ability:protect", "the cost is paid when PROTECT is used, before the opponent can respond", () => {
  const game = runeBoard({ icons: { elitism: 2 } });
  actRaw(game.engine, P1, game.id("rune"), "protect", { c: [game.id("mine")] });
  assert.equal(ready(game.engine), 0);
  assert.equal(isDepleted(game.engine, game.id("rune")), true);
  assert.equal(game.engine.state.priorityPlayerId, P2);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(RUNE, "0:ability:protect", `cannot pick ${why}: refused, and the Rune is not depleted`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = runeBoard({ icons: { elitism: 4 }, extra: extras() });
    const before = ready(bad.engine);
    refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(isDepleted(bad.engine, bad.id("rune")), false);
    assert.equal(ready(bad.engine), before, "nothing paid");
    const good = runeBoard({ icons: { elitism: 4 }, extra: extras() });
    runeProtect(good, "mine");
    assert.equal(isDepleted(good.engine, good.id("rune")), true, "control: a character works");
  });
}

clause(RUNE, "0:ability:protect", "cannot pick a faction, and needs exactly one character (none and two are refused)", () => {
  const bad = runeBoard({ icons: { elitism: 4 } });
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id("mine"), bad.id("mine2")] }), "two picks");
  assert.equal(isDepleted(bad.engine, bad.id("rune")), false);
  assert.equal(ready(bad.engine), 4);
});

clause(RUNE, "0:ability:protect", "any character may be picked, including the opponent's and the Rune holder's own", () => {
  const theirs = runeBoard({ icons: { elitism: 2 } });
  runeProtect(theirs, "foe");
  assert.equal(isDepleted(theirs.engine, theirs.id("rune")), true);
  const mine = runeBoard({ icons: { elitism: 2 } });
  runeProtect(mine, "mine2");
  assert.equal(isDepleted(mine.engine, mine.id("rune")), true);
});

clause(RUNE, "0:ability:protect", "only its controller can use it: the opponent cannot PROTECT with my Rune", () => {
  const game = runeBoard({
    icons: { elitism: 2 },
    extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ elitism: 2 }, P2)]
  });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(game.engine, P2, game.id("rune"), "protect", { c: [game.id("foe")] }), "the opponent using my Rune", /control|own|cannot|illegal|only|owner/i);
  assert.equal(isDepleted(game.engine, game.id("rune")), false);
});

clause(RUNE, "0:ability:protect", "an ability of a card in play: not usable from my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = runeBoard({ zone, icons: { elitism: 2 } });
    refused(() => actRaw(bad.engine, P1, bad.id("rune"), "protect", { c: [bad.id("mine")] }), `PROTECT from ${zone}`);
    assert.equal(ready(bad.engine), 2);
  }
});

clause(RUNE, "0:ability:protect", "PROTECT can be used in response on the opponent's turn (CR 502.3), during their attack", () => {
  const game = runeDefender();
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  runeProtect(game, "mine");
  assert.equal(isDepleted(game.engine, game.id("rune")), true);
});

// --- PROTECT: effect ---

clause(RUNE, "0:ability:protect", "a protected blocker that would be destroyed by lethal battle damage: its controller is offered the choice, and accepting destroys the Rune instead and leaves the blocker alive with 0 damage", () => {
  const game = runeDefender();
  runeBlock(game, { protect: "mine" });
  const pc = expectPending(game.engine, "replacementChoice");
  assert.equal(pc.playerId, P1, "the Rune's controller decides ('you may')");
  answerPending(game.engine, "replacementChoice", { apply: true });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "the blocker is not destroyed");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 0, "the damage already inflicted this turn is reduced to 0");
  assert.equal(zoneOf(game.engine, game.id("rune")), "discard", "the Rune was destroyed instead");
  assert.ok(discardOf(game.engine, P1).includes(game.id("rune")), "discardOf(game.engine, P1).includes(game.id(\"rune\"))");
});

clause(RUNE, "0:ability:protect", "'you may': declining the choice lets the blocker be destroyed and the Rune stays in play (depleted)", () => {
  const game = runeDefender();
  runeBlock(game, { protect: "mine" });
  expectPending(game.engine, "replacementChoice");
  answerPending(game.engine, "replacementChoice", { apply: false });
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard", "destroyed as usual");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
  assert.equal(isDepleted(game.engine, game.id("rune")), true);
});

clause(RUNE, "0:ability:protect", "a protected ATTACKER that would be destroyed by lethal battle damage can be saved the same way (the Rune is destroyed, the attacker survives with 0 damage)", () => {
  const game = runeBoard({
    extra: [{ key: "big", def: character({ name: "Big Blocker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  runeProtect(game, "mine");
  declareAttackBy(game.engine, P1, [game.id("mine")]);
  declareBlockers(game.engine, P2, [game.id("big")]);
  autoResolveBattle(game.engine);
  const pc = expectPending(game.engine, "replacementChoice");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "replacementChoice", { apply: true });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 0);
  assert.equal(zoneOf(game.engine, game.id("rune")), "discard");
});

clause(RUNE, "0:ability:protect", "a protected character with damage already on it (1 from an earlier tactic this turn): saving it reduces ALL of the damage already inflicted this turn to 0", () => {
  const game = runeBoard({
    extra: [
      { key: "big", def: character({ name: "Big Blocker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "hit", def: hitTactic(1), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("hit"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 1);
  runeProtect(game, "mine");
  declareAttackBy(game.engine, P1, [game.id("mine")]);
  declareBlockers(game.engine, P2, [game.id("big")]);
  autoResolveBattle(game.engine);
  expectPending(game.engine, "replacementChoice");
  answerPending(game.engine, "replacementChoice", { apply: true });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 0, "1 earlier + 5 battle damage all reduced to 0");
});

clause(RUNE, "0:ability:protect", "'The next time ... destroyed': non-lethal battle damage does not use the protection up; a later lethal battle in the same turn is still saved", () => {
  const game = runeBoard({
    extra: [
      { key: "b1", def: character({ name: "Weak Blocker", strength: 2, life: 1, speed: 2 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Big Blocker", strength: 5, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "rs", def: restoreTactic(), owner: P1, zone: "hand" }
    ]
  });
  runeProtect(game, "mine");
  declareAttackBy(game.engine, P1, [game.id("mine")]);
  declareBlockers(game.engine, P2, [game.id("b1")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "2 damage on a 3-life character is not lethal: nothing is asked");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 2);
  play(game.engine, P1, game.id("rs"), { selected: { t: [game.id("mine")] } });
  assert.equal(isDepleted(game.engine, game.id("mine")), false);
  declareAttackBy(game.engine, P1, [game.id("mine")]);
  declareBlockers(game.engine, P2, [game.id("b2")]);
  autoResolveBattle(game.engine);
  expectPending(game.engine, "replacementChoice");
  answerPending(game.engine, "replacementChoice", { apply: true });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(game.engine.state.cards[game.id("mine")].damage, 0);
});

clause(RUNE, "0:ability:protect", "only BATTLE damage: lethal damage from a tactic destroys the protected character normally, with no question, and the Rune stays", () => {
  const game = runeBoard({ extra: [{ key: "hit", def: hitTactic(3), owner: P1, zone: "hand" }] });
  runeProtect(game, "mine");
  play(game.engine, P1, game.id("hit"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
});

clause(RUNE, "0:ability:protect", "only damage destruction: a 'destroy' tactic kills the protected character with no question", () => {
  const game = runeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  runeProtect(game, "mine");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
});

clause(RUNE, "0:ability:protect", "only the PICKED character: another character of mine destroyed by battle damage in the same battle gets no question and is destroyed", () => {
  const game = runeDefender();
  runeBlock(game, { protect: "mine", blockers: ["mine2"] });
  assert.equal(game.engine.state.pendingChoice, undefined, "the unprotected blocker is destroyed without any question");
  assert.equal(zoneOf(game.engine, game.id("mine2")), "discard");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
});

clause(RUNE, "0:ability:protect", "'this turn': the protection is over when the turn ends: on the opponent's next turn the character is destroyed by battle damage with no question", () => {
  const game = runeBoard({ extra: [] });
  runeProtect(game, "mine");
  resolvePendingResponses(game.engine);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  declareAttackBy(game.engine, P2, [game.id("foe")]);
  declareBlockers(game.engine, P1, [game.id("mine")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rune")), "play");
});

clause(RUNE, "0:ability:protect", "'if this card is in play': if the Rune was destroyed in response to PROTECT, nothing saves the character any more", () => {
  const game = runeBoard({
    extra: [
      { key: "big", def: character({ name: "Big Blocker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "kill", def: destroyAnyTactic(), owner: P2, zone: "hand" }
    ]
  });
  actRaw(game.engine, P1, game.id("rune"), "protect", { c: [game.id("mine")] });
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("rune")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rune")), "discard");
  declareAttackBy(game.engine, P1, [game.id("mine")]);
  declareBlockers(game.engine, P2, [game.id("big")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "no Rune in play: nothing to offer");
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
});

clause(RUNE, "0:ability:protect", "the pick may be the OPPONENT's character: when it would be destroyed by battle damage the Rune's controller (me) decides, and accepting saves THEIR character and destroys my Rune", () => {
  const game = runeBoard({
    extra: [{ key: "strong", def: character({ name: "Strong Attacker", strength: 9, life: 9, speed: 2 }), owner: P1, zone: "play" }]
  });
  runeProtect(game, "foe");
  declareAttackBy(game.engine, P1, [game.id("strong")]);
  declareBlockers(game.engine, P2, [game.id("foe")]);
  autoResolveBattle(game.engine);
  const pc = expectPending(game.engine, "replacementChoice");
  assert.equal(pc.playerId, P1, "'you may destroy it instead': you = the Rune's controller");
  answerPending(game.engine, "replacementChoice", { apply: true });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
  assert.equal(zoneOf(game.engine, game.id("rune")), "discard");
});

// --- FLIP UP: 0 [E][E] ---

const runeFlip = (game: RuneGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("rune"));

clause(RUNE, "1:flipUp", "a face-down Rune flips up for 0 with [E][E]: it becomes a face-up item in play and nothing is paid", () => {
  const game = runeBoard({ faceDown: true, icons: { elitism: 2 }, turn: 1, active: P1 });
  const { engine, id } = game;
  assert.equal(attachedCount(engine, P1), 0);
  const before = ready(engine);
  runeFlip(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("rune")].faceDown, false);
  assert.equal(zoneOf(engine, id("rune")), "play");
  assert.equal(engine.getDefinition(id("rune")).type, "item");
  assert.equal(isDepleted(engine, id("rune")), false);
  assert.equal(attachedCount(engine, P1), 0, "FLIP UP costs 0: no resource was spent");
  assert.equal(before - ready(engine), 1, "only the face-down card itself stopped being a resource");
});

clause(RUNE, "1:flipUp", "after flipping up, the Rune works: PROTECT pays 2 and depletes it", () => {
  const game = runeBoard({ faceDown: true, icons: { elitism: 4 }, turn: 1, active: P1 });
  runeFlip(game);
  resolvePendingResponses(game.engine);
  const before = ready(game.engine);
  runeProtect(game, "mine");
  assert.equal(before - ready(game.engine), 2);
  assert.equal(isDepleted(game.engine, game.id("rune")), true);
});

clause(RUNE, "1:flipUp", "needs [E][E]: none, one, lots of other icons, the opponent's [E] or Volition are refused (still face-down, nothing happens)", () => {
  const none = runeBoard({ faceDown: true, icons: {}, turn: 1, active: P1 });
  refused(() => runeFlip(none), "no resources");
  assert.equal(none.engine.state.cards[none.id("rune")].faceDown, true);
  const one = runeBoard({ faceDown: true, icons: { elitism: 1 }, turn: 1, active: P1 });
  refused(() => runeFlip(one), "one [E]");
  const rage = runeBoard({ faceDown: true, icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => runeFlip(rage), "no [E]");
  assert.equal(ready(rage.engine), 7);
  const theirs = runeBoard({ faceDown: true, icons: { rage: 3 }, turn: 1, active: P1, extra: res({ elitism: 3 }, P2) });
  refused(() => runeFlip(theirs), "their [E]");
  const volitionOnly = runeBoard({ faceDown: true, icons: { elitism: 1 }, turn: 1, active: P1, extra: volition(3, P1) });
  refused(() => runeFlip(volitionOnly), "Volition is not [E]");
});

clause(RUNE, "1:flipUp", "spent [E][E] still meet the threshold: the flip costs 0, so it works even with no ready resource but itself", () => {
  const game = runeBoard({ faceDown: true, icons: {}, spentIcons: { elitism: 2 }, turn: 1, active: P1 });
  runeFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("rune")].faceDown, false);
});

clause(RUNE, "1:flipUp", "FLIP UP works only on a face-down Rune I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = runeBoard({ faceDown: false, icons: { elitism: 2 }, turn: 1, active: P1 });
  refused(() => runeFlip(faceUp), "already face-up");
  const inHand = runeBoard({ zone: "hand", icons: { elitism: 2 }, turn: 1, active: P1 });
  refused(() => runeFlip(inHand), "in hand");
  const theirs = runeBoard({ faceDown: true, icons: { elitism: 2 }, turn: 1, active: P1 });
  refused(() => runeFlip(theirs, P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("rune")].faceDown, true);
});

clause(RUNE, "1:flipUp", "FLIP UP does not change WHEN an item can be deployed (CR 507.4d): on the opponent's turn it is refused, on mine it works", () => {
  const bad = runeBoard({ faceDown: true, icons: { elitism: 2 }, turn: 2, active: P2 });
  refused(() => runeFlip(bad), "an item on the opponent's turn");
  assert.equal(bad.engine.state.cards[bad.id("rune")].faceDown, true);
  const good = runeBoard({ faceDown: true, icons: { elitism: 2 }, turn: 1, active: P1 });
  runeFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("rune")].faceDown, false, "control: my own turn works");
});

clause(RUNE, "1:flipUp", "flipping up is cheaper than deploying: from hand the Rune costs its printed 2, flipped up it costs nothing", () => {
  const hand = runeBoard({ zone: "hand", icons: { elitism: 2 }, turn: 1, active: P1 });
  const before = ready(hand.engine);
  play(hand.engine, P1, hand.id("rune"));
  assert.equal(before - ready(hand.engine), 2, "deployed from hand: its printed cost of 2");
  const flipped = runeBoard({ faceDown: true, icons: { elitism: 2 }, turn: 1, active: P1 });
  runeFlip(flipped);
  resolvePendingResponses(flipped.engine);
  assert.equal(attachedCount(flipped.engine, P1), 0);
});

// =============================================================================
// Runic Battery
// When this card enters play, you may pay 3. If you do, put a token on it.
// DISCHARGE -- COST: If there is a token on this card X is 5, otherwise X is 2. Destroy this card.
//              EFFECT: Detach up to X resources from your faction. Draw a card.
// Item, gearsmith, cost 2, [E][E][E].
// =============================================================================

const BATTERY = "5b75b908-991f-417f-bed3-a4ab604b6372";

function batteryBoard(
  opts: {
    zone?: Zone;
    tokens?: number;
    icons?: Icons;
    spentN?: number;
    readyN?: number;
    oppSpentN?: number;
    faceDownSpentN?: number;
    deck?: number;
    owner?: PlayerId;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const owner = opts.owner ?? P1;
  const factionKey = owner === P1 ? "__factionA" : "__factionB";
  return devBoard(
    [
      { key: "rb", def: printing(BATTERY), owner, zone: opts.zone ?? "play", counters: opts.tokens === undefined ? undefined : { token: opts.tokens } },
      ...bank("elitism", opts.spentN ?? 0, owner).map((p, i): CardPlacement => ({ ...p, key: `sp${i}`, attachedToKey: factionKey })),
      ...bank("elitism", opts.readyN ?? 0, owner).map((p, i): CardPlacement => ({ ...p, key: `rd${i}` })),
      ...bank("elitism", opts.oppSpentN ?? 0, owner === P1 ? P2 : P1).map((p, i): CardPlacement => ({ ...p, key: `op${i}`, attachedToKey: owner === P1 ? "__factionB" : "__factionA" })),
      ...volition(opts.faceDownSpentN ?? 0, owner).map((p, i): CardPlacement => ({ ...p, key: `fs${i}`, attachedToKey: factionKey })),
      ...res(opts.icons ?? {}, owner),
      ...fillers("dk", opts.deck ?? 3, owner, "deck"),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type BatteryGame = ReturnType<typeof batteryBoard>;
const keys = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const discharge = (game: BatteryGame, pickKeys: string[], player: PlayerId = P1) =>
  activate(game.engine, player, game.id("rb"), "discharge", { selected: { rs: pickKeys.map((k) => game.id(k)) } });
const dischargeRaw = (game: BatteryGame, pickKeys: string[], player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("rb"), "discharge", { rs: pickKeys.map((k) => game.id(k)) });

// --- 0:rule enters play: may pay 3 for a token ---

clause(BATTERY, "0:rule", "entering play I am asked (as its controller) whether to pay 3; paying attaches exactly 3 resources and puts exactly one token on it", () => {
  const { engine, id } = batteryBoard({ zone: "hand", icons: { elitism: 5 } });
  play(engine, P1, id("rb"));
  assert.equal(zoneOf(engine, id("rb")), "play");
  assert.equal(tokensOn(engine, id("rb")), 0, "no token before I pay");
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal(ready(engine), 3, "2 paid to deploy it");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 0, "exactly 3 more paid");
  assert.equal(tokensOn(engine, id("rb")), 1, "exactly one token");
});

clause(BATTERY, "0:rule", "'you may': declining pays nothing and puts no token on it", () => {
  const { engine, id } = batteryBoard({ zone: "hand", icons: { elitism: 5 } });
  play(engine, P1, id("rb"));
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), 3);
  assert.equal(tokensOn(engine, id("rb")), 0);
});

clause(BATTERY, "0:rule", "paying is exactly 3: with 6 resources one is left over after the deploy (2) and the payment (3)", () => {
  const { engine, id } = batteryBoard({ zone: "hand", icons: { elitism: 6 } });
  play(engine, P1, id("rb"));
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready(engine), 1);
});

clause(BATTERY, "0:rule", "if I cannot pay 3 (only 2 resources left after deploying) there is no token and I am not stuck", () => {
  const { engine, id } = batteryBoard({ zone: "hand", icons: { elitism: 4 } });
  play(engine, P1, id("rb"));
  if (engine.state.pendingChoice) {
    refused(() => answerPending(engine, "mayPay", { pay: true }), "paying 3 with only 2 resources");
  }
  assert.equal(tokensOn(engine, id("rb")), 0);
  assert.equal(ready(engine), 2, "nothing was paid");
});

clause(BATTERY, "0:rule", "put into play by an effect (not deployed) I may still pay 3 for the token", () => {
  const { engine, id } = batteryBoard({ zone: "discard", icons: { elitism: 3 }, extra: [{ key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("re"), { selected: { t: [id("rb")] } });
  assert.equal(zoneOf(engine, id("rb")), "play");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(tokensOn(engine, id("rb")), 1);
  assert.equal(ready(engine), 0);
});

clause(BATTERY, "0:rule", "only when THIS card enters play: another item entering play asks nothing and the Battery in play gets no token", () => {
  const { engine, id } = batteryBoard({ icons: { elitism: 5 }, extra: [{ key: "newbie", def: item({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("newbie"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("rb")), 0);
  assert.equal(ready(engine), 4);
});

clause(BATTERY, "0:rule", "the opponent's own Battery gives THEM the question, paid from THEIR resources", () => {
  const { engine, id } = batteryBoard({ zone: "hand", owner: P2, icons: { elitism: 5 }, turn: 2, active: P2 });
  play(engine, P2, id("rb"));
  assert.equal(expectPending(engine, "mayPay").playerId, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(tokensOn(engine, id("rb")), 1);
  assert.equal(ready(engine, P2), 0);
});

clause(BATTERY, "0:rule", "deploys for exactly its printed cost of 2 with [E][E][E]: no [E] and only two [E] are refused", () => {
  const ok = batteryBoard({ zone: "hand", icons: { elitism: 3 } });
  const before = ready(ok.engine);
  playRaw(ok.engine, P1, ok.id("rb"));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("rb")), "play");
  assert.equal(before - ready(ok.engine), 2);
  const rage = batteryBoard({ zone: "hand", icons: { rage: 6 } });
  refused(() => playRaw(rage.engine, P1, rage.id("rb")), "no [E]");
  const twoE = batteryBoard({ zone: "hand", icons: { elitism: 2, rage: 4 } });
  refused(() => playRaw(twoE.engine, P1, twoE.id("rb")), "only two [E]");
  assert.equal(zoneOf(twoE.engine, twoE.id("rb")), "hand");
});

clause(BATTERY, "0:rule", "tokens vanish when it leaves play (CR 409.2): a Battery with a token that is bounced and deployed again, declining the payment, has no token", () => {
  const { engine, id } = batteryBoard({
    tokens: 1,
    icons: { elitism: 5 },
    extra: [{ key: "bounce", def: bounceAnyTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("rb")] } });
  assert.equal(zoneOf(engine, id("rb")), "hand");
  assert.equal(tokensOn(engine, id("rb")), 0, "its token is gone");
  play(engine, P1, id("rb"));
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(tokensOn(engine, id("rb")), 0);
});

// --- 1:ability:discharge ---

clause(BATTERY, "1:ability:discharge", "with NO token X is 2: it destroys the Battery (to its owner's discard pile), detaches the 2 picked resources (they are ready again) and draws a card", () => {
  const game = batteryBoard({ spentN: 3, readyN: 1 });
  const { engine, id } = game;
  const top = deckOf(engine, P1)[0];
  const before = ready(engine);
  discharge(game, keys("sp", 2));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rb")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("rb")), "discardOf(engine, P1).includes(id(\"rb\"))");
  assert.equal(ready(engine) - before, 2, "exactly two resources were detached");
  assert.equal(engine.state.cards[id("sp0")].attachedTo, undefined);
  assert.equal(engine.state.cards[id("sp1")].attachedTo, undefined);
  assert.notEqual(engine.state.cards[id("sp2")].attachedTo, undefined, "the third spent resource stays attached");
  assert.equal(zoneOf(engine, top), "hand", "and I drew the top card");
  assert.equal(deckOf(engine, P1).length, 2);
});

clause(BATTERY, "1:ability:discharge", "'up to X': with no token I may detach just 1, or none at all, and still draw a card", () => {
  const one = batteryBoard({ spentN: 3 });
  discharge(one, keys("sp", 1));
  assert.equal(ready(one.engine), 1);
  assert.equal(handOf(one.engine, P1).length, 1);
  assert.equal(zoneOf(one.engine, one.id("rb")), "discard");
  const none = batteryBoard({ spentN: 3 });
  discharge(none, []);
  assert.equal(ready(none.engine), 0);
  assert.equal(handOf(none.engine, P1).length, 1, "the card is drawn anyway");
  assert.equal(zoneOf(none.engine, none.id("rb")), "discard");
});

clause(BATTERY, "1:ability:discharge", "with no token X is only 2: three picks are refused, and nothing changes (the Battery stays, nothing drawn)", () => {
  const bad = batteryBoard({ spentN: 4 });
  refused(() => dischargeRaw(bad, keys("sp", 3)), "3 resources with X = 2");
  assert.equal(zoneOf(bad.engine, bad.id("rb")), "play");
  assert.equal(ready(bad.engine), 0);
  assert.equal(handOf(bad.engine, P1).length, 0);
});

clause(BATTERY, "1:ability:discharge", "WITH a token X is 5: up to five spent resources are detached", () => {
  const game = batteryBoard({ tokens: 1, spentN: 6 });
  discharge(game, keys("sp", 5));
  assert.equal(ready(game.engine), 5);
  assert.notEqual(game.engine.state.cards[game.id("sp5")].attachedTo, undefined);
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard");
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BATTERY, "1:ability:discharge", "with a token fewer than 5 is fine (3 picks), but 6 are refused", () => {
  const three = batteryBoard({ tokens: 1, spentN: 6 });
  discharge(three, keys("sp", 3));
  assert.equal(ready(three.engine), 3);
  const six = batteryBoard({ tokens: 1, spentN: 6 });
  refused(() => dischargeRaw(six, keys("sp", 6)), "6 resources with X = 5");
  assert.equal(zoneOf(six.engine, six.id("rb")), "play");
  assert.equal(ready(six.engine), 0);
});

clause(BATTERY, "1:ability:discharge", "'If there is a token': several tokens still make X exactly 5, not more", () => {
  const ok = batteryBoard({ tokens: 3, spentN: 7 });
  discharge(ok, keys("sp", 5));
  assert.equal(ready(ok.engine), 5);
  const bad = batteryBoard({ tokens: 3, spentN: 7 });
  refused(() => dischargeRaw(bad, keys("sp", 6)), "6 resources, X is 5 however many tokens");
  assert.equal(zoneOf(bad.engine, bad.id("rb")), "play");
});

clause(BATTERY, "1:ability:discharge", "a token put on it by the enters-play payment makes X = 5 for the real DISCHARGE", () => {
  const game = batteryBoard({ zone: "hand", icons: { elitism: 5 } });
  play(game.engine, P1, game.id("rb"));
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(tokensOn(game.engine, game.id("rb")), 1);
  const spentIds = Object.values(game.engine.state.cards)
    .filter((c) => c.attachedTo === game.engine.state.players[P1].factionId)
    .map((c) => c.id);
  assert.equal(spentIds.length, 5);
  activate(game.engine, P1, game.id("rb"), "discharge", { selected: { rs: spentIds } });
  assert.equal(ready(game.engine), 5, "all five spent resources detached");
});

clause(BATTERY, "1:ability:discharge", "only resources attached to my faction are detached: a ready (unspent) resource among the picks detaches nothing", () => {
  const game = batteryBoard({ spentN: 2, readyN: 2 });
  const before = ready(game.engine);
  discharge(game, ["sp0", "rd0"]);
  assert.equal(ready(game.engine) - before, 1, "only the spent one was detached; the ready one stays ready, nothing is gained for it");
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard");
});

clause(BATTERY, "1:ability:discharge", "'your faction': the opponent's spent resources cannot be picked, and stay attached to their faction", () => {
  const game = batteryBoard({ spentN: 1, oppSpentN: 2 });
  refused(() => dischargeRaw(game, ["op0"]), "the opponent's resource");
  assert.equal(zoneOf(game.engine, game.id("rb")), "play");
  assert.notEqual(game.engine.state.cards[game.id("op0")].attachedTo, undefined);
  const good = batteryBoard({ spentN: 1, oppSpentN: 2 });
  discharge(good, ["sp0"]);
  assert.notEqual(good.engine.state.cards[good.id("op0")].attachedTo, undefined, "control: mine is detached, theirs untouched");
  assert.equal(ready(good.engine, P1), 1);
});

clause(BATTERY, "1:ability:discharge", "face-down resources attached to my faction are resources too: they can be detached", () => {
  const game = batteryBoard({ spentN: 1, faceDownSpentN: 2 });
  const before = ready(game.engine);
  discharge(game, ["fs0", "fs1"]);
  assert.equal(ready(game.engine) - before, 2);
});

clause(BATTERY, "1:ability:discharge", "needs no resources: it is usable with nothing ready, and it draws exactly one card (the opponent draws none)", () => {
  const game = batteryBoard({ spentN: 2, deck: 3, extra: fillers("od", 2, P2, "deck") });
  assert.equal(ready(game.engine), 0);
  const oppHand = handOf(game.engine, P2).length;
  discharge(game, keys("sp", 2));
  assert.equal(handOf(game.engine, P1).length, 1);
  assert.equal(deckOf(game.engine, P1).length, 2);
  assert.equal(handOf(game.engine, P2).length, oppHand);
});

clause(BATTERY, "1:ability:discharge", "with an empty deck the draw does not happen (CR 306.2) but the resources are still detached", () => {
  const game = batteryBoard({ spentN: 2, deck: 0 });
  discharge(game, keys("sp", 2));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(ready(game.engine), 2);
  assert.equal(handOf(game.engine, P1).length, 0);
});

clause(BATTERY, "1:ability:discharge", "the Battery is destroyed as a cost when DISCHARGE is used, before the opponent can respond; the detaching and the draw happen when it resolves", () => {
  const game = batteryBoard({ spentN: 2 });
  dischargeRaw(game, keys("sp", 2));
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard");
  assert.equal(ready(game.engine), 0, "nothing detached yet");
  assert.equal(handOf(game.engine, P1).length, 0, "nothing drawn yet");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine), 2);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BATTERY, "1:ability:discharge", "usable in response on the opponent's turn (CR 502.3)", () => {
  const game = batteryBoard({ spentN: 2, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  discharge(game, keys("sp", 2));
  assert.equal(ready(game.engine), 2);
  assert.equal(handOf(game.engine, P1).length, 1);
});

clause(BATTERY, "1:ability:discharge", "only its controller can use it: the opponent cannot DISCHARGE my Battery", () => {
  const game = batteryBoard({ spentN: 1, oppSpentN: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(game.engine, P2, game.id("rb"), "discharge", { rs: [game.id("op0")] }), "the opponent using my Battery", /control|own|cannot|illegal|only|owner/i);
  assert.equal(zoneOf(game.engine, game.id("rb")), "play");
});

clause(BATTERY, "1:ability:discharge", "an ability of a card in play: not usable from my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = batteryBoard({ zone, spentN: 2 });
    refused(() => dischargeRaw(bad, keys("sp", 2)), `DISCHARGE from ${zone}`);
    assert.equal(ready(bad.engine), 0);
  }
});

// =============================================================================
// Runivoltaic Accumulator
// If your opponent attacks, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. EFFECT: Put a token on this card.
// DISCHARGE -- COST: Pick a character with numeric cost X or less, where X is the number of
//   tokens on this card. Destroy this card. EFFECT: Destroy the character.
// Item, gearsmith, cost 2, [E].
// =============================================================================

const ACCUMULATOR = "6f9876af-52c0-46e5-a06f-22e488ba54a8";

function accBoard(
  opts: { zone?: Zone; tokens?: number; icons?: Icons; spentIcons?: Icons; owner?: PlayerId; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "ra", def: printing(ACCUMULATOR), owner, zone: opts.zone ?? "play", counters: opts.tokens === undefined ? undefined : { token: opts.tokens } },
      ...res(opts.icons ?? {}, owner),
      ...spent(opts.spentIcons ?? {}, owner),
      { key: "mine0", def: character({ name: "My Free", cost: 0 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "My Two", cost: 2 }), owner: P1, zone: "play" },
      { key: "foe0", def: character({ name: "Their Free", cost: 0 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Their One", cost: 1 }), owner: P2, zone: "play" },
      { key: "foe3", def: character({ name: "Their Three", cost: 3 }), owner: P2, zone: "play" },
      { key: "foe4", def: character({ name: "Their Four", cost: 4 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}

type AccGame = ReturnType<typeof accBoard>;

/** The opponent (P2, turn 2) attacks my faction (or `target`) with `foe0`; the Accumulator asks (index 1 = charge, 0 = decline) if it is mine. */
function oppAttacks(game: AccGame, answer: 0 | 1 | undefined, target?: { type: "card"; cardId: CardInstanceId }): void {
  declareAttackBy(game.engine, P2, [game.id("foe0")], target);
  if (answer !== undefined) answerPending(game.engine, "chooserSelectsOption", { index: answer });
}

/** The opponent attacks and the Accumulator's question is answered WITHOUT draining the response window: the attacker passes, so I hold priority. */
function oppAttackOpenWindow(game: AccGame): void {
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("foe0")], target: { type: "faction", playerId: P1 } });
  const pc = expectPending(game.engine, "chooserSelectsOption");
  game.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
  game.engine.perform({ type: "passPriority", playerId: P2 });
}

clause(ACCUMULATOR, "0:rule", "when my opponent attacks I am asked, and saying yes puts exactly one token on the Accumulator", () => {
  const game = accBoard({ turn: 2, active: P2 });
  declareAttackBy(game.engine, P2, [game.id("foe0")]);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
  answerPending(game.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "0:rule", "'you may': saying no puts no token on it", () => {
  const game = accBoard({ turn: 2, active: P2 });
  oppAttacks(game, 0);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
});

clause(ACCUMULATOR, "0:rule", "an attack on my LOCATION is an attack by my opponent too: I am asked", () => {
  const game = accBoard({ turn: 2, active: P2, extra: [{ key: "loc", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" }] });
  oppAttacks(game, 1, { type: "card", cardId: game.id("loc") });
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "0:rule", "only when my OPPONENT attacks: when I attack nothing is asked and no token appears", () => {
  const game = accBoard({ turn: 1, active: P1, extra: [{ key: "myatk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("myatk")]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
});

clause(ACCUMULATOR, "0:rule", "every attack counts: attacks on two of their turns can put two tokens on it", () => {
  const game = accBoard({ turn: 2, active: P2 });
  oppAttacks(game, 1);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
  endTurn(game.engine, P2);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  oppAttacks(game, 1);
  assert.equal(tokensOn(game.engine, game.id("ra")), 2);
});

clause(ACCUMULATOR, "0:rule", "each Accumulator is its own trigger: two of them mean two questions and (yes to both) a token on each", () => {
  const game = accBoard({ turn: 2, active: P2, extra: [{ key: "ra2", def: printing(ACCUMULATOR), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P2, [game.id("foe0")]);
  let questions = 0;
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 6) {
    const pc = pending(game.engine)!;
    if (pc.kind === "chooserSelectsOption") {
      questions += 1;
      answerPending(game.engine, "chooserSelectsOption", { index: 1 });
    } else {
      drain(game.engine, declineAll, 1);
    }
  }
  assert.equal(questions, 2);
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
  assert.equal(tokensOn(game.engine, game.id("ra2")), 1);
});

clause(ACCUMULATOR, "0:rule", "the opponent's own Accumulator charges when I attack (their opponent), and asks THEM", () => {
  const game = accBoard({ owner: P2, turn: 1, active: P1, extra: [{ key: "myatk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P1, [game.id("myatk")]);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2);
  answerPending(game.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "0:rule", "an Accumulator in my hand does nothing when the opponent attacks", () => {
  const game = accBoard({ zone: "hand", turn: 2, active: P2 });
  declareAttackBy(game.engine, P2, [game.id("foe0")]);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
});

clause(ACCUMULATOR, "0:rule", "deploys for exactly its printed cost of 2 with [E]: one resource, or two Rage, are refused", () => {
  const ok = accBoard({ zone: "hand", icons: { elitism: 3 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ra"));
  assert.equal(zoneOf(ok.engine, ok.id("ra")), "play");
  assert.equal(before - ready(ok.engine), 2);
  const short = accBoard({ zone: "hand", icons: { elitism: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("ra")), "one resource");
  const rage = accBoard({ zone: "hand", icons: { rage: 5 } });
  refused(() => playRaw(rage.engine, P1, rage.id("ra")), "no [E]");
  assert.equal(zoneOf(rage.engine, rage.id("ra")), "hand");
});

// --- ENERGIZE ---

clause(ACCUMULATOR, "1:ability:energize", "ENERGIZE pays exactly 2 and puts a token on the Accumulator", () => {
  const game = accBoard({ icons: { elitism: 3 } });
  const before = ready(game.engine);
  activate(game.engine, P1, game.id("ra"), "energize");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(game.engine), 2);
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "1:ability:energize", "refused one resource short of Pay 2 (nothing paid, no token); spent resources cannot pay", () => {
  const bad = accBoard({ icons: { elitism: 1 } });
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "energize"), "one resource");
  assert.equal(ready(bad.engine), 1);
  assert.equal(tokensOn(bad.engine, bad.id("ra")), 0);
  const spentOnly = accBoard({ icons: { elitism: 1 }, spentIcons: { elitism: 3 } });
  refused(() => actRaw(spentOnly.engine, P1, spentOnly.id("ra"), "energize"), "only spent resources");
  assert.equal(tokensOn(spentOnly.engine, spentOnly.id("ra")), 0);
});

clause(ACCUMULATOR, "1:ability:energize", "ENERGIZE has no threshold, no deplete and no limit: Rage can pay and it can be used again and again", () => {
  const game = accBoard({ icons: { rage: 6 } });
  activate(game.engine, P1, game.id("ra"), "energize");
  activate(game.engine, P1, game.id("ra"), "energize");
  activate(game.engine, P1, game.id("ra"), "energize");
  assert.equal(tokensOn(game.engine, game.id("ra")), 3);
  assert.equal(ready(game.engine), 0);
});

clause(ACCUMULATOR, "1:ability:energize", "the token goes on THIS Accumulator, not on another one", () => {
  const game = accBoard({ icons: { elitism: 2 }, tokens: 1, extra: [{ key: "ra2", def: printing(ACCUMULATOR), owner: P1, zone: "play", counters: { token: 4 } }] });
  activate(game.engine, P1, game.id("ra"), "energize");
  assert.equal(tokensOn(game.engine, game.id("ra")), 2);
  assert.equal(tokensOn(game.engine, game.id("ra2")), 4);
});

clause(ACCUMULATOR, "1:ability:energize", "the cost is paid when it is used, before the opponent can respond; the token comes when it resolves", () => {
  const game = accBoard({ icons: { elitism: 2 } });
  actRaw(game.engine, P1, game.id("ra"), "energize");
  assert.equal(ready(game.engine), 0);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "1:ability:energize", "usable in response on the opponent's turn", () => {
  const game = accBoard({ icons: { elitism: 2 }, turn: 2, active: P2 });
  oppAttackOpenWindow(game);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  activate(game.engine, P1, game.id("ra"), "energize");
  assert.equal(tokensOn(game.engine, game.id("ra")), 1);
});

clause(ACCUMULATOR, "1:ability:energize", "only its controller can use it, and only from play", () => {
  const game = accBoard({ icons: { elitism: 2 }, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ elitism: 2 }, P2)] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  refused(() => actRaw(game.engine, P2, game.id("ra"), "energize"), "the opponent using my Accumulator", /control|own|cannot|illegal|only|owner/i);
  assert.equal(tokensOn(game.engine, game.id("ra")), 0);
  for (const zone of ["hand", "discard"] as const) {
    const bad = accBoard({ zone, icons: { elitism: 2 } });
    refused(() => actRaw(bad.engine, P1, bad.id("ra"), "energize"), `ENERGIZE from ${zone}`);
    assert.equal(ready(bad.engine), 2);
  }
});

// --- DISCHARGE ---

const accDischarge = (game: AccGame, pickKey: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("ra"), "discharge", { selected: { c: [game.id(pickKey)] } });

clause(ACCUMULATOR, "2:ability:discharge", "with 3 tokens it destroys the Accumulator (cost) and a cost-3 character (effect): both go to their owners' discard piles, nothing is paid", () => {
  const game = accBoard({ tokens: 3 });
  accDischarge(game, "foe3");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("ra")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("ra")), "discardOf(game.engine, P1).includes(game.id(\"ra\"))");
  assert.equal(zoneOf(game.engine, game.id("foe3")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("foe3")), "discardOf(game.engine, P2).includes(game.id(\"foe3\"))");
  assert.equal(zoneOf(game.engine, game.id("foe1")), "play");
  assert.equal(zoneOf(game.engine, game.id("foe4")), "play");
});

clause(ACCUMULATOR, "2:ability:discharge", "'numeric cost X or less': with 3 tokens costs 0, 1, 2 and 3 are legal and cost 4 is refused (Accumulator stays)", () => {
  for (const key of ["foe0", "foe1", "mine2", "foe3"]) {
    const game = accBoard({ tokens: 3 });
    accDischarge(game, key);
    assert.equal(zoneOf(game.engine, game.id(key)), "discard", `${key} (cost <= 3)`);
  }
  const bad = accBoard({ tokens: 3 });
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.id("foe4")] }), "cost 4 with 3 tokens");
  assert.equal(zoneOf(bad.engine, bad.id("foe4")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("ra")), "play", "the Accumulator was not destroyed");
});

clause(ACCUMULATOR, "2:ability:discharge", "with NO tokens X is 0: only a cost-0 character can be picked; cost 1 is refused", () => {
  const ok = accBoard({ tokens: 0 });
  accDischarge(ok, "foe0");
  assert.equal(zoneOf(ok.engine, ok.id("foe0")), "discard");
  assert.equal(zoneOf(ok.engine, ok.id("ra")), "discard");
  const bad = accBoard({});
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.id("foe1")] }), "cost 1 with 0 tokens");
  assert.equal(zoneOf(bad.engine, bad.id("foe1")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("ra")), "play");
});

clause(ACCUMULATOR, "2:ability:discharge", "X moves with the tokens: 4 tokens allow cost 4, 1 token allows cost 1 but not 2", () => {
  const four = accBoard({ tokens: 4 });
  accDischarge(four, "foe4");
  assert.equal(zoneOf(four.engine, four.id("foe4")), "discard");
  const one = accBoard({ tokens: 1 });
  accDischarge(one, "foe1");
  assert.equal(zoneOf(one.engine, one.id("foe1")), "discard");
  const oneBad = accBoard({ tokens: 1 });
  refused(() => actRaw(oneBad.engine, P1, oneBad.id("ra"), "discharge", { c: [oneBad.id("mine2")] }), "cost 2 with 1 token");
  assert.equal(zoneOf(oneBad.engine, oneBad.id("mine2")), "play");
});

clause(ACCUMULATOR, "2:ability:discharge", "my own character can be picked too (it is 'a character'), and goes to my discard pile", () => {
  const game = accBoard({ tokens: 2 });
  accDischarge(game, "mine2");
  assert.equal(zoneOf(game.engine, game.id("mine2")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("mine2")), "discardOf(game.engine, P1).includes(game.id(\"mine2\"))");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fd", "a face-down card (only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(ACCUMULATOR, "2:ability:discharge", `cannot pick ${why}: refused, and the Accumulator is NOT destroyed`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing", cost: 0 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res", cost: 0 }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down", cost: 0 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand", cost: 0 }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard", cost: 0 }), owner: P1, zone: "discard" }
    ];
    const bad = accBoard({ tokens: 5, extra: extras() });
    refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ra")), "play");
    const good = accBoard({ tokens: 5, extra: extras() });
    accDischarge(good, "foe3");
    assert.equal(zoneOf(good.engine, good.id("foe3")), "discard", "control: a character works");
  });
}

clause(ACCUMULATOR, "2:ability:discharge", "cannot pick a faction, and needs exactly one character (none and two are refused)", () => {
  const bad = accBoard({ tokens: 5 });
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.id("foe0"), bad.id("foe1")] }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("ra")), "play");
});

clause(ACCUMULATOR, "2:ability:discharge", "the Accumulator cannot be used when no character is cheap enough (every character costs more than its tokens)", () => {
  const game = devBoard([
    { key: "ra", def: printing(ACCUMULATOR), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "big", def: character({ name: "Big", cost: 5 }), owner: P2, zone: "play" }
  ]);
  refused(() => actRaw(game.engine, P1, game.id("ra"), "discharge", { c: [game.id("big")] }), "nothing cheap enough");
  assert.equal(zoneOf(game.engine, game.id("ra")), "play");
});

clause(ACCUMULATOR, "2:ability:discharge", "needs no resources: it works with nothing ready", () => {
  const game = accBoard({ tokens: 2 });
  assert.equal(ready(game.engine), 0);
  accDischarge(game, "foe1");
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard");
});

clause(ACCUMULATOR, "2:ability:discharge", "the Accumulator is destroyed as a cost when it is used (before responses); the character is destroyed when it resolves", () => {
  const game = accBoard({ tokens: 3 });
  actRaw(game.engine, P1, game.id("ra"), "discharge", { c: [game.id("foe3")] });
  assert.equal(zoneOf(game.engine, game.id("ra")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foe3")), "play");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe3")), "discard");
});

clause(ACCUMULATOR, "2:ability:discharge", "usable in response on the opponent's turn: it can destroy the attacker", () => {
  const game = accBoard({ tokens: 2, turn: 2, active: P2 });
  oppAttackOpenWindow(game);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  accDischarge(game, "foe0");
  assert.equal(zoneOf(game.engine, game.id("foe0")), "discard");
});

clause(ACCUMULATOR, "2:ability:discharge", "only its controller can use it, and only from play", () => {
  const game = accBoard({ tokens: 3, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  refused(() => actRaw(game.engine, P2, game.id("ra"), "discharge", { c: [game.id("mine0")] }), "the opponent using my Accumulator", /control|own|cannot|illegal|only|owner/i);
  assert.equal(zoneOf(game.engine, game.id("ra")), "play");
  for (const zone of ["hand", "discard"] as const) {
    const bad = accBoard({ zone, tokens: 3 });
    refused(() => actRaw(bad.engine, P1, bad.id("ra"), "discharge", { c: [bad.id("foe0")] }), `DISCHARGE from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("foe0")), "play");
  }
});

// =============================================================================
// Unbearably Heavy Shoes of Teleportation
// ATTACH TO CHARACTER
// The attached character loses 2 strength and cannot be blocked.
// FLIP UP: 5 [E][E][E]
// Item, gearsmith, cost 5, [E][E][E], gear.
// =============================================================================

const SHOES = "051b8a3c-3b1c-48e5-a288-1f699e6aae5c";
const SHOES_SPEC: AttachSpec = { id: SHOES, cost: 5, icon: "elitism" };

for (const c of attachCases(SHOES_SPEC)) {
  if (c.tag === "put-into-play") clause(SHOES, "0:attach", c.title, c.fn);
  else if (c.tag) clause(SHOES, "0:attach", c.title, c.fn);
  else clause(SHOES, "0:attach", c.title, c.fn);
}

clause(SHOES, "0:attach", "its threshold is [E][E][E]: five resources with only two [E] are refused, three [E] plus two others are enough", () => {
  const bad = attachBoard(SHOES_SPEC, { icons: { elitism: 2, rage: 3 } });
  refused(() => playRaw(bad.engine, P1, bad.id("card"), { selected: { attachTo: [bad.id("host")] } }), "only [E][E]");
  assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
  const good = attachBoard(SHOES_SPEC, { icons: { elitism: 3, rage: 2 } });
  play(good.engine, P1, good.id("card"), { selected: { attachTo: [good.id("host")] } });
  assert.equal(attachedTo(good), good.id("host"));
});

/** Shoes attached to "host" (base 4/4/2 by default); a plain ally (3/3/2) and a plain opposing blocker. */
function shoesBoard(
  opts: { hostStr?: number; hostOwner?: PlayerId; zone?: Zone; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  const inPlay = (opts.zone ?? "play") === "play";
  return devBoard(
    [
      { key: "host", def: character({ name: "Host", strength: opts.hostStr ?? 4, life: 4, speed: 2 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "shoes", def: printing(SHOES), owner: P1, zone: opts.zone ?? "play", attachedToKey: inPlay ? "host" : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ShoesGame = ReturnType<typeof shoesBoard>;

clause(SHOES, "1:rule", "the attached character loses 2 strength (4/4/2 -> 2/4/2): life and speed are untouched", () => {
  const { engine, id } = shoesBoard();
  assert.deepEqual(stats(engine, id("host")), [2, 4, 2]);
});

clause(SHOES, "1:rule", "only the attached character loses strength: others are unchanged", () => {
  const { engine, id } = shoesBoard();
  assert.deepEqual(stats(engine, id("ally")), [3, 3, 2]);
  assert.deepEqual(stats(engine, id("blk")), [1, 9, 1]);
});

clause(SHOES, "1:rule", "on the opponent's character, that character loses 2 strength", () => {
  const { engine, id } = shoesBoard({ hostOwner: P2 });
  assert.deepEqual(stats(engine, id("host")), [2, 4, 2]);
  assert.deepEqual(stats(engine, id("ally")), [3, 3, 2]);
});

clause(SHOES, "1:rule", "two pairs of Shoes stack: -4 strength", () => {
  const { engine, id } = shoesBoard({ extra: [{ key: "shoes2", def: printing(SHOES), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [0, 4, 2]);
});

clause(SHOES, "1:rule", "a character with 2 strength drops to exactly 0", () => {
  const { engine, id } = shoesBoard({ hostStr: 2 });
  assert.deepEqual(stats(engine, id("host")), [0, 4, 2]);
});

clause(SHOES, "1:rule", "a character with 1 strength that loses 2 has 0 strength, never -1 (CR 410.4)", () => {
  const { engine, id } = shoesBoard({ hostStr: 1 });
  assert.equal(engine.getStat(id("host"), "strength"), 0);
});

clause(SHOES, "1:rule", "a character with 0 strength that loses 2 stays at 0 strength (CR 410.4)", () => {
  const { engine, id } = shoesBoard({ hostStr: 0 });
  assert.equal(engine.getStat(id("host"), "strength"), 0);
});

clause(SHOES, "1:rule", "the strength loss is only while the Shoes are in play: destroyed, the host is a 4/4/2 again; Shoes in my hand do nothing", () => {
  const gone = shoesBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("kill"), { selected: { t: [gone.id("shoes")] } });
  assert.equal(zoneOf(gone.engine, gone.id("shoes")), "discard");
  assert.deepEqual(stats(gone.engine, gone.id("host")), [4, 4, 2]);
  const inHand = shoesBoard({ zone: "hand" });
  assert.deepEqual(stats(inHand.engine, inHand.id("host")), [4, 4, 2]);
});

clause(SHOES, "1:rule", "in battle the weakened host deals its reduced strength: an unblocked 4-strength host with Shoes hits the faction for 2", () => {
  const { engine, id } = shoesBoard();
  const start = influenceOf(engine, P2);
  declareAttackBy(engine, P1, [id("host")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), start - 2);
});

clause(SHOES, "1:rule", "'cannot be blocked': the attached character attacking alone cannot be blocked, and the refusal changes nothing", () => {
  const { engine, id } = shoesBoard();
  declareAttackBy(engine, P1, [id("host")]);
  refused(() => declareBlockers(engine, P2, [id("blk")]), "a blocker against an unblockable attacker", /block/i);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined);
});

clause(SHOES, "1:rule", "control: the same host WITHOUT the Shoes can be blocked by the same blocker", () => {
  const { engine, id } = shoesBoard({ zone: "hand" });
  declareAttackBy(engine, P1, [id("host")]);
  declareBlockers(engine, P2, [id("blk")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("blk")]);
});

clause(SHOES, "1:rule", "a party is only unblockable while EVERY member cannot be blocked (CR 412.1): host plus an ordinary ally can be blocked", () => {
  const { engine, id } = shoesBoard();
  declareAttackBy(engine, P1, [id("host"), id("ally")]);
  declareBlockers(engine, P2, [id("blk")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("blk")], "the party contains a blockable character");
});

clause(SHOES, "1:rule", "two attackers that both wear Shoes form an unblockable party", () => {
  const { engine, id } = shoesBoard({
    extra: [
      { key: "host2", def: character({ name: "Second Host", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "shoes2", def: printing(SHOES), owner: P1, zone: "play", attachedToKey: "host2" }
    ]
  });
  declareAttackBy(engine, P1, [id("host"), id("host2")]);
  refused(() => declareBlockers(engine, P2, [id("blk")]), "both attackers are unblockable", /block/i);
});

clause(SHOES, "1:rule", "once the Shoes are gone the host can be blocked again", () => {
  const { engine, id } = shoesBoard({ extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("shoes")] } });
  declareAttackBy(engine, P1, [id("host")]);
  declareBlockers(engine, P2, [id("blk")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("blk")]);
});

clause(SHOES, "1:rule", "the opponent's character wearing my Shoes cannot be blocked by my characters either", () => {
  const { engine, id } = shoesBoard({ hostOwner: P2, turn: 2, active: P2 });
  declareAttackBy(engine, P2, [id("host")]);
  refused(() => declareBlockers(engine, P1, [id("blk2")]), "their unblockable attacker", /block/i);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined);
});

clause(SHOES, "1:rule", "both effects are static rules, not abilities: the Shoes have nothing to activate", () => {
  assert.equal(hasNoActivatedAbility(SHOES), true);
});

// --- FLIP UP: 5 [E][E][E] ---

function shoesFlipBoard(opts: { icons?: Icons; spentIcons?: Icons; faceDown?: boolean; zone?: Zone; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "shoes", def: printing(SHOES), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      { key: "host", def: character({ name: "Host", strength: 4, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host Two", strength: 4, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...spent(opts.spentIcons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ShoesFlipGame = ReturnType<typeof shoesFlipBoard>;
const shoesFlip = (game: ShoesFlipGame, pickKey = "host", player: PlayerId = P1) =>
  flipUpRaw(game.engine, player, game.id("shoes"), { attachTo: [game.id(pickKey)] });

clause(SHOES, "2:flipUp", "a face-down pair of Shoes flips up by paying 5 (it may pay for itself), enters play attached to the picked character and takes effect (4/4/2 -> 2/4/2, unblockable)", () => {
  const game = shoesFlipBoard({ icons: { elitism: 4 } });
  const { engine, id } = game;
  assert.equal(ready(engine), 5, "four [E] and the face-down card itself");
  shoesFlip(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("shoes")].faceDown, false);
  assert.equal(zoneOf(engine, id("shoes")), "play");
  assert.equal(engine.state.cards[id("shoes")].attachedTo, id("host"));
  assert.deepEqual(stats(engine, id("host")), [2, 4, 2]);
  assert.ok(engine.getKeywords(id("host")).includes("cannotBeBlocked"), "engine.getKeywords(id(\"host\")).includes(\"cannotBeBlocked\")");
  assert.deepEqual(stats(engine, id("host2")), [4, 4, 2]);
});

clause(SHOES, "2:flipUp", "FLIP UP costs 5: with plenty of resources exactly 5 are used (the face-down card itself may be one of them)", () => {
  const game = shoesFlipBoard({ icons: { elitism: 8 } });
  const before = ready(game.engine);
  shoesFlip(game);
  resolvePendingResponses(game.engine);
  const paid = before - ready(game.engine);
  assert.ok(paid === 5 || paid === 6, `5 paid (plus the face-down card itself no longer being a resource), not ${paid}`);
  assert.equal(game.engine.state.cards[game.id("shoes")].attachedTo, game.id("host"));
});

clause(SHOES, "2:flipUp", "is refused one resource short: three [E] plus the face-down card is only 4", () => {
  const game = shoesFlipBoard({ icons: { elitism: 3 } });
  assert.equal(ready(game.engine), 4);
  refused(() => shoesFlip(game), "four resources for a cost of 5");
  assert.equal(game.engine.state.cards[game.id("shoes")].faceDown, true);
  assert.equal(ready(game.engine), 4, "nothing paid");
});

clause(SHOES, "2:flipUp", "needs [E][E][E]: two [E] plus three Rage, or six Rage, or the opponent's [E] or Volition are refused", () => {
  const twoE = shoesFlipBoard({ icons: { elitism: 2, rage: 3 } });
  refused(() => shoesFlip(twoE), "only [E][E]");
  assert.equal(twoE.engine.state.cards[twoE.id("shoes")].faceDown, true);
  const rage = shoesFlipBoard({ icons: { rage: 6 } });
  refused(() => shoesFlip(rage), "no [E]");
  const theirs = shoesFlipBoard({ icons: { rage: 5 }, extra: res({ elitism: 4 }, P2) });
  refused(() => shoesFlip(theirs), "their [E]");
  const volitionOnly = shoesFlipBoard({ icons: { elitism: 2 }, extra: volition(4, P1) });
  refused(() => shoesFlip(volitionOnly), "Volition is not [E]");
  const ok = shoesFlipBoard({ icons: { elitism: 3, rage: 1 } });
  shoesFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("shoes")].attachedTo, ok.id("host"), "control: [E][E][E] plus one more and the card itself is enough");
});

clause(SHOES, "2:flipUp", "spent [E][E][E] still meet the threshold: they count but cannot pay (three spent, two ready and the card itself is 3 ready, one short)", () => {
  const bad = shoesFlipBoard({ icons: { elitism: 2 }, spentIcons: { elitism: 3 } });
  assert.equal(ready(bad.engine), 3);
  refused(() => shoesFlip(bad), "3 ready resources for a cost of 5");
  const good = shoesFlipBoard({ icons: { elitism: 4 }, spentIcons: { elitism: 3 } });
  shoesFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("shoes")].attachedTo, good.id("host"));
});

clause(SHOES, "2:flipUp", "flipping up still needs the ATTACH TO pick: none, two, an item, or a faction is refused (still face-down, nothing paid)", () => {
  const make = () => shoesFlipBoard({ icons: { elitism: 4 }, extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }] });
  const none = make();
  refused(() => flipUpRaw(none.engine, P1, none.id("shoes"), { attachTo: [] }), "no pick");
  assert.equal(none.engine.state.cards[none.id("shoes")].faceDown, true);
  assert.equal(ready(none.engine), 5);
  const two = make();
  refused(() => flipUpRaw(two.engine, P1, two.id("shoes"), { attachTo: [two.id("host"), two.id("host2")] }), "two picks");
  const itemPick = make();
  refused(() => shoesFlip(itemPick, "thing"), "an item");
  const faction = make();
  refused(() => flipUpRaw(faction.engine, P1, faction.id("shoes"), { attachTo: [faction.engine.state.players[P2].factionId!] }), "a faction");
  const theirs = make();
  shoesFlip(theirs, "foe");
  resolvePendingResponses(theirs.engine);
  assert.equal(theirs.engine.state.cards[theirs.id("shoes")].attachedTo, theirs.id("foe"), "control: any character, including the opponent's, can be picked");
});

clause(SHOES, "2:flipUp", "FLIP UP works only on a face-down pair of Shoes I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = shoesFlipBoard({ faceDown: false, icons: { elitism: 5 } });
  refused(() => shoesFlip(faceUp), "already face-up");
  const inHand = shoesFlipBoard({ zone: "hand", icons: { elitism: 5 } });
  refused(() => shoesFlip(inHand), "in hand");
  const theirs = shoesFlipBoard({ icons: { elitism: 5 } });
  refused(() => shoesFlip(theirs, "host", P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("shoes")].faceDown, true);
});

clause(SHOES, "2:flipUp", "FLIP UP does not change WHEN an item can be deployed (CR 507.4d): on the opponent's turn it is refused, on mine it works", () => {
  const bad = shoesFlipBoard({ icons: { elitism: 5 }, turn: 2, active: P2 });
  refused(() => shoesFlip(bad), "an item on the opponent's turn");
  assert.equal(bad.engine.state.cards[bad.id("shoes")].faceDown, true);
  const good = shoesFlipBoard({ icons: { elitism: 5 }, turn: 1, active: P1 });
  shoesFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("shoes")].faceDown, false, "control: my own turn works");
});

// =============================================================================
// Velocious Golem
// [E][E][E]: This card can attack even if it has not been in play under your control
// since the start of the turn.
// Character, gearsmith, cost 5, [E], 4 strength / 3 speed / 3 life, golem.
// =============================================================================

const VELOCIOUS = "738bcd83-9c42-4913-a000-2d8ccab2d78e";

function velociousBoard(
  opts: {
    zone?: Zone;
    icons?: Icons;
    spentIcons?: Icons;
    oppIcons?: Icons;
    fd?: number;
    fresh?: boolean;
    depleted?: boolean;
    owner?: PlayerId;
    controller?: PlayerId;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      {
        key: "vg",
        def: printing(VELOCIOUS),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: opts.zone ?? "play",
        attackEligible: opts.fresh === false ? true : false,
        depleted: opts.depleted
      },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", attackEligible: false },
      ...res(opts.icons ?? {}),
      ...spent(opts.spentIcons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...volition(opts.fd ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type VelGame = ReturnType<typeof velociousBoard>;
const velAttack = (game: VelGame, key = "vg") =>
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id(key)], target: { type: "faction", playerId: P2 } });

clause(VELOCIOUS, "0:rule@eee", "with [E][E][E] a Golem that has not been in play since the start of the turn can attack, and its 4 strength hits the faction", () => {
  const game = velociousBoard({ icons: { elitism: 3 } });
  const start = influenceOf(game.engine, P2);
  velAttack(game);
  resolvePendingResponses(game.engine);
  assert.ok(battleOf(game.engine), "the attack was declared");
  assert.equal(isDepleted(game.engine, game.id("vg")), true, "attacking depletes it");
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), start - 4);
});

clause(VELOCIOUS, "0:rule@eee", "without [E][E][E] (only two) a Golem that just entered play cannot attack; with three it can", () => {
  const bad = velociousBoard({ icons: { elitism: 2 } });
  refused(() => velAttack(bad), "two [E]", /did not start the turn in play/);
  assert.equal(battleOf(bad.engine), undefined);
  assert.equal(isDepleted(bad.engine, bad.id("vg")), false);
  const good = velociousBoard({ icons: { elitism: 3 } });
  velAttack(good);
  resolvePendingResponses(good.engine);
  assert.ok(battleOf(good.engine), "battleOf(good.engine)");
});

clause(VELOCIOUS, "0:rule@eee", "only [E] counts: lots of other icons, Volition, or the opponent's [E][E][E] do not let it attack", () => {
  const rage = velociousBoard({ icons: { rage: 6 } });
  refused(() => velAttack(rage), "no [E]", /did not start the turn in play/);
  const faceDown = velociousBoard({ icons: { elitism: 2 }, fd: 4 });
  refused(() => velAttack(faceDown), "Volition is not [E]", /did not start the turn in play/);
  const theirs = velociousBoard({ icons: { elitism: 2 }, oppIcons: { elitism: 4 } });
  refused(() => velAttack(theirs), "their [E]", /did not start the turn in play/);
});

clause(VELOCIOUS, "0:rule@eee", "spent [E] still count (CR 405.6), alone or mixed with ready ones", () => {
  const spentOnly = velociousBoard({ spentIcons: { elitism: 3 } });
  velAttack(spentOnly);
  resolvePendingResponses(spentOnly.engine);
  assert.ok(battleOf(spentOnly.engine), "battleOf(spentOnly.engine)");
  const mixed = velociousBoard({ icons: { elitism: 1 }, spentIcons: { elitism: 2 } });
  velAttack(mixed);
  resolvePendingResponses(mixed.engine);
  assert.ok(battleOf(mixed.engine), "battleOf(mixed.engine)");
});

clause(VELOCIOUS, "0:rule@eee", "the paragraph only waives 'in play since the start of the turn': a settled Golem attacks normally without any [E]", () => {
  const game = velociousBoard({ fresh: false });
  velAttack(game);
  resolvePendingResponses(game.engine);
  assert.ok(battleOf(game.engine), "battleOf(game.engine)");
});

clause(VELOCIOUS, "0:rule@eee", "it does not waive being depleted: a depleted Golem cannot attack even with [E][E][E]", () => {
  const bad = velociousBoard({ icons: { elitism: 3 }, depleted: true });
  refused(() => velAttack(bad), "depleted");
  assert.equal(battleOf(bad.engine), undefined);
});

clause(VELOCIOUS, "0:rule@eee", "only THIS card: another character that just entered play still cannot attack, however many [E] I control", () => {
  const game = velociousBoard({ icons: { elitism: 3 } });
  refused(() => velAttack(game, "ally"), "the ally just entered play", /did not start the turn in play/);
  assert.equal(battleOf(game.engine), undefined);
});

clause(VELOCIOUS, "0:rule@eee", "deployed from my hand this turn with [E][E][E] it can attack at once", () => {
  const game = velociousBoard({ zone: "hand", icons: { elitism: 5 } });
  play(game.engine, P1, game.id("vg"));
  assert.equal(zoneOf(game.engine, game.id("vg")), "play");
  velAttack(game);
  resolvePendingResponses(game.engine);
  assert.ok(battleOf(game.engine), "the freshly deployed Golem attacked");
});

clause(VELOCIOUS, "0:rule@eee", "a Golem I own but my opponent controlled until now (control changed this turn) can attack with [E][E][E] for its new controller", () => {
  const game = velociousBoard({ owner: P2, controller: P1, icons: { elitism: 3 } });
  assert.equal(game.engine.state.cards[game.id("vg")].controllerId, P1);
  velAttack(game);
  resolvePendingResponses(game.engine);
  assert.ok(battleOf(game.engine), "battleOf(game.engine)");
  const bad = velociousBoard({ owner: P2, controller: P1, icons: { elitism: 2 } });
  refused(() => velAttack(bad), "only two [E]", /did not start the turn in play/);
});

clause(VELOCIOUS, "0:rule@eee", "the permission ends when the [E] go: with a third [E] destroyed it can no longer attack", () => {
  const game = velociousBoard({ icons: { elitism: 3 }, extra: [{ key: "smash", def: smashResourceTactic(), owner: P1, zone: "hand" }] });
  const resourceIds = Object.values(game.engine.state.cards).filter((c) => c.zone === "play" && game.engine.isResource(c.id) && c.controllerId === P1).map((c) => c.id);
  play(game.engine, P1, game.id("smash"), { selected: { t: [resourceIds[0]] } });
  refused(() => velAttack(game), "two [E] left", /did not start the turn in play/);
  assert.equal(battleOf(game.engine), undefined);
});

clause(VELOCIOUS, "0:rule@eee", "the paragraph is a static rule, not an ability: nothing to activate", () => {
  assert.equal(hasNoActivatedAbility(VELOCIOUS), true);
});

clause(VELOCIOUS, "0:rule@eee", "printed stats: a 4/3/3 golem (deploys for 5 with [E])", () => {
  const game = velociousBoard({ zone: "hand", icons: { elitism: 5 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("vg"));
  assert.equal(before - ready(game.engine), 5);
  assert.deepEqual(stats(game.engine, game.id("vg")), [4, 3, 3]);
  const short = velociousBoard({ zone: "hand", icons: { elitism: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("vg")), "one short");
});

// =============================================================================
// Affectionate Dollkeeper
// [D][D][D]: If this card inflicts damage to a character, destroy that character.
// Character, rogue, cost 4, [D], 2 strength / 4 speed / 2 life, hedonist.
// =============================================================================

const DOLLKEEPER = "bf855ca9-e1ed-47ae-8c79-b625f3d50ffe";

function dollBoard(
  opts: { icons?: Icons; spentIcons?: Icons; oppIcons?: Icons; fd?: number; zone?: Zone; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "ad", def: printing(DOLLKEEPER), owner: P1, zone: opts.zone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 4 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "Blocker One", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Blocker Two", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...spent(opts.spentIcons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...volition(opts.fd ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type DollGame = ReturnType<typeof dollBoard>;

/** The Dollkeeper attacks and `blocker` blocks it; the battle is played out. */
function dollAttackBlocked(game: DollGame, blocker = "b1"): void {
  declareAttackBy(game.engine, P1, [game.id("ad")]);
  declareBlockers(game.engine, P2, [game.id(blocker)]);
  autoResolveBattle(game.engine);
}

clause(DOLLKEEPER, "0:rule@ddd", "with [D][D][D], a blocker the Dollkeeper inflicts damage to is destroyed even though 2 damage is far below its 9 life (it goes to its owner's discard pile)", () => {
  const game = dollBoard({ icons: { deception: 3 } });
  dollAttackBlocked(game);
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("b1")), "discardOf(game.engine, P2).includes(game.id(\"b1\"))");
  assert.equal(zoneOf(game.engine, game.id("ad")), "play");
});

clause(DOLLKEEPER, "0:rule@ddd", "without [D][D][D] (only two) it is just 2 damage: the blocker survives with 2 damage", () => {
  const game = dollBoard({ icons: { deception: 2 } });
  dollAttackBlocked(game);
  assert.equal(zoneOf(game.engine, game.id("b1")), "play");
  assert.equal(game.engine.state.cards[game.id("b1")].damage, 2);
});

clause(DOLLKEEPER, "0:rule@ddd", "only [D] counts, and only mine: Rage, Volition, or the opponent's [D][D][D] do not turn it on", () => {
  for (const opts of [{ icons: { rage: 6 } }, { icons: { deception: 2 }, fd: 4 }, { icons: { deception: 2 }, oppIcons: { deception: 4 } }] as const) {
    const game = dollBoard(opts);
    dollAttackBlocked(game);
    assert.equal(zoneOf(game.engine, game.id("b1")), "play", JSON.stringify(opts));
  }
});

clause(DOLLKEEPER, "0:rule@ddd", "spent [D] still count (CR 405.6), alone or mixed with ready ones; five [D] do not do more", () => {
  for (const opts of [{ spentIcons: { deception: 3 } }, { icons: { deception: 1 }, spentIcons: { deception: 2 } }, { icons: { deception: 5 } }] as const) {
    const game = dollBoard(opts);
    dollAttackBlocked(game);
    assert.equal(zoneOf(game.engine, game.id("b1")), "discard", JSON.stringify(opts));
  }
});

clause(DOLLKEEPER, "0:rule@ddd", "as a BLOCKER it works too: the attacker it damages is destroyed", () => {
  const game = dollBoard({
    icons: { deception: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Big Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("ad")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
  assert.equal(zoneOf(game.engine, game.id("ad")), "play", "1 damage does not kill a 2-life Dollkeeper");
});

clause(DOLLKEEPER, "0:rule@ddd", "'that character': only the character it damaged dies; with two blockers and all its damage on one, the other is untouched", () => {
  const game = dollBoard({ icons: { deception: 3 } });
  declareAttackBy(game.engine, P1, [game.id("ad")]);
  declareBlockers(game.engine, P2, [game.id("b1"), game.id("b2")]);
  autoResolveBattle(game.engine, (source) =>
    source.legalTargets.length > 0 && source.strength > 0
      ? [{ sourceId: source.cardId, target: source.legalTargets.find((t) => t.type === "card" && t.cardId === game.id("b1")) ?? source.legalTargets[0], amount: source.strength }]
      : []
  );
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("b2")), "play");
  assert.equal(game.engine.state.cards[game.id("b2")].damage, 0, "the Dollkeeper dealt it nothing");
});

clause(DOLLKEEPER, "0:rule@ddd", "splitting its 2 damage 1 and 1 between two blockers inflicts damage to BOTH, so both are destroyed", () => {
  const game = dollBoard({ icons: { deception: 3 } });
  declareAttackBy(game.engine, P1, [game.id("ad")]);
  declareBlockers(game.engine, P2, [game.id("b1"), game.id("b2")]);
  autoResolveBattle(game.engine, (source) =>
    source.legalTargets.length > 0 && source.strength > 0
      ? source.legalTargets.slice(0, 2).map((target) => ({ sourceId: source.cardId, target, amount: 1 }))
      : []
  );
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("b2")), "discard");
});

clause(DOLLKEEPER, "0:rule@ddd", "'this card' inflicts the damage: another attacker's damage to a blocker destroys nothing (the Dollkeeper's damage goes elsewhere)", () => {
  const game = dollBoard({ icons: { deception: 3 } });
  declareAttackBy(game.engine, P1, [game.id("ad"), game.id("ally")]);
  declareBlockers(game.engine, P2, [game.id("b1"), game.id("b2")]);
  autoResolveBattle(game.engine, (source) => {
    const wanted = source.cardId === game.id("ad") ? game.id("b1") : game.id("b2");
    const target = source.legalTargets.find((t) => t.type === "card" && t.cardId === wanted) ?? source.legalTargets[0];
    return source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  });
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard", "damaged by the Dollkeeper");
  assert.equal(zoneOf(game.engine, game.id("b2")), "play", "damaged only by the ally (1 of 9 life)");
  assert.equal(game.engine.state.cards[game.id("b2")].damage, 1);
});

clause(DOLLKEEPER, "0:rule@ddd", "only damage to a CHARACTER: hitting the faction just costs influence, and hitting a location just damages it", () => {
  const faction = dollBoard({ icons: { deception: 3 } });
  const start = influenceOf(faction.engine, P2);
  declareAttackBy(faction.engine, P1, [faction.id("ad")]);
  faction.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(faction.engine);
  assert.equal(influenceOf(faction.engine, P2), start - 2);
  assert.equal(zoneOf(faction.engine, faction.id("b1")), "play");
  const loc = dollBoard({ icons: { deception: 3 }, extra: [{ key: "loc", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }] });
  fight(loc.engine, P1, [loc.id("ad")], { type: "card", cardId: loc.id("loc") }, []);
  assert.equal(zoneOf(loc.engine, loc.id("loc")), "play", "2 damage does not destroy a structure-5 location");
  assert.equal(loc.engine.state.cards[loc.id("loc")].damage, 2);
});

clause(DOLLKEEPER, "0:rule@ddd", "'inflicts damage': a Dollkeeper reduced to 0 strength inflicts nothing (CR 408.1), so the blocker survives undamaged", () => {
  const game = dollBoard({ icons: { deception: 3 }, extra: [{ key: "weaken", def: strengthTactic(-2), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("weaken"), { selected: { t: [game.id("ad")] } });
  assert.equal(game.engine.getStat(game.id("ad"), "strength"), 0);
  dollAttackBlocked(game);
  assert.equal(zoneOf(game.engine, game.id("b1")), "play");
  assert.equal(game.engine.state.cards[game.id("b1")].damage, 0);
});

clause(DOLLKEEPER, "0:rule@ddd", "a FASTER foe (speed 5) kills the Dollkeeper (speed 4) first, so it inflicts no damage and the foe survives", () => {
  const game = dollBoard({
    icons: { deception: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Fast Attacker", strength: 2, life: 9, speed: 5 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("ad")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ad")), "discard");
  assert.equal(zoneOf(game.engine, game.id("atk")), "play");
  assert.equal(game.engine.state.cards[game.id("atk")].damage, 0);
});

clause(DOLLKEEPER, "0:rule@ddd", "simultaneous damage (same speed): the Dollkeeper dies but its trigger still destroys the character it inflicted damage to (CR 503.1)", () => {
  const game = dollBoard({
    icons: { deception: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Equal Attacker", strength: 2, life: 9, speed: 4 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("ad")]);
  finishBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ad")), "discard", "2 damage kills the 2-life Dollkeeper");
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard", "its damage was inflicted at the same instant");
});

clause(DOLLKEEPER, "0:rule@ddd", "it is a static paragraph, not an ability: nothing to activate; and it deploys for 4 with [D]", () => {
  assert.equal(hasNoActivatedAbility(DOLLKEEPER), true);
  const game = dollBoard({ zone: "hand", icons: { deception: 4 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("ad"));
  assert.equal(before - ready(game.engine), 4);
  assert.deepEqual(stats(game.engine, game.id("ad")), [2, 2, 4]);
  const noD = dollBoard({ zone: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noD.engine, P1, noD.id("ad")), "no [D]");
});

// =============================================================================
// Workshop
// CONSTRUCT -- COST: Pay 3. Remove a card in your discard pile from the game.
//   EFFECT: You may search your deck for a card of the same type as the removed card and
//   reveal it. If you do, put it on the top of your deck.
// Location, gearsmith, cost 2, [E][E][E], structure 3.
// =============================================================================

const WORKSHOP = "3ef1aa24-c030-4c3f-8970-1c291e8c8a79";

type CardKind = "character" | "item" | "tactic" | "location" | "resource";
const kindDef = (kind: CardKind, name: string): CardDefinition =>
  kind === "item" ? item({ name }) : kind === "tactic" ? tactic({ name }) : kind === "location" ? location({ name }) : kind === "resource" ? resourceCard({ name }) : character({ name });

function wsBoard(
  opts: {
    zone?: Zone;
    icons?: Icons;
    spentIcons?: Icons;
    discard?: CardKind[];
    oppDiscard?: CardKind[];
    deck?: CardKind[];
    oppDeck?: CardKind[];
    random?: () => number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const deckKinds: CardKind[] = opts.deck ?? ["character", "character", "character", "character", "item", "item", "tactic", "location", "resource"];
  return devBoard(
    [
      { key: "ws", def: printing(WORKSHOP), owner: P1, zone: opts.zone ?? "play" },
      ...(opts.discard ?? ["character"]).map((kind, i): CardPlacement => ({ key: `d${i}`, def: kindDef(kind, `Discarded ${kind} ${i}`), owner: P1, zone: "discard" })),
      ...(opts.oppDiscard ?? []).map((kind, i): CardPlacement => ({ key: `o${i}`, def: kindDef(kind, `Their discarded ${kind} ${i}`), owner: P2, zone: "discard" })),
      ...deckKinds.map((kind, i): CardPlacement => ({ key: `k${i}`, def: kindDef(kind, `Deck ${kind} ${i}`), owner: P1, zone: "deck" })),
      ...(opts.oppDeck ?? ["character", "item"]).map((kind, i): CardPlacement => ({ key: `ok${i}`, def: kindDef(kind, `Their deck ${kind} ${i}`), owner: P2, zone: "deck" })),
      { key: "handItem", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "boardItem", def: item({ name: "Board Item" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { elitism: 3 }),
      ...spent(opts.spentIcons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: opts.random ?? (() => 0.3) }
  );
}

type WsGame = ReturnType<typeof wsBoard>;
const FIXED = () => 0.3;

const wsConstruct = (game: WsGame, removeKey = "d0", player: PlayerId = P1) =>
  activate(game.engine, player, game.id("ws"), "construct", { selected: { rem: [game.id(removeKey)] } });
const wsConstructRaw = (game: WsGame, removeKey = "d0", player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("ws"), "construct", { rem: [game.id(removeKey)] });
const revealedIds = (game: WsGame): string[] =>
  game.engine.state.gameLog.flatMap((entry) => (entry.event?.type === "cardsRevealed" ? (entry.event.cardIds as string[]) : []));

clause(WORKSHOP, "0:ability:construct", "CONSTRUCT pays exactly 3 and removes the picked discard-pile card from the GAME (out-of-game area, not the discard pile)", () => {
  const game = wsBoard({ icons: { elitism: 5 }, random: FIXED });
  const before = ready(game.engine);
  wsConstruct(game);
  expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(before - ready(game.engine), 3);
  assert.equal(zoneOf(game.engine, game.id("d0")), "removed");
  assert.ok(removedOf(game.engine, P1).includes(game.id("d0")), "removedOf(game.engine, P1).includes(game.id(\"d0\"))");
  assert.equal(discardOf(game.engine, P1).includes(game.id("d0")), false);
});

clause(WORKSHOP, "0:ability:construct", "only the picked card is removed: other discard-pile cards stay", () => {
  const game = wsBoard({ discard: ["character", "item", "tactic"], random: FIXED });
  wsConstruct(game, "d1");
  assert.equal(zoneOf(game.engine, game.id("d1")), "removed");
  assert.equal(zoneOf(game.engine, game.id("d0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("d2")), "discard");
});

clause(WORKSHOP, "0:ability:construct", "refused one resource short of Pay 3 (and the discard card stays); spent resources cannot pay", () => {
  const bad = wsBoard({ icons: { elitism: 2 } });
  refused(() => wsConstructRaw(bad), "two resources");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
  assert.equal(ready(bad.engine), 2);
  const spentOnly = wsBoard({ icons: { elitism: 1 }, spentIcons: { elitism: 4 } });
  refused(() => wsConstructRaw(spentOnly), "only spent resources");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("d0")), "discard");
});

clause(WORKSHOP, "0:ability:construct", "CONSTRUCT has no threshold of its own: three Rage can pay for it", () => {
  const game = wsBoard({ icons: { rage: 3 }, random: FIXED });
  wsConstruct(game);
  assert.equal(zoneOf(game.engine, game.id("d0")), "removed");
});

clause(WORKSHOP, "0:ability:construct", "'a card in your discard pile': with an empty discard pile it cannot be used, and nothing is paid", () => {
  const bad = wsBoard({ discard: [] });
  refused(() => actRaw(bad.engine, P1, bad.id("ws"), "construct", {}), "empty discard pile");
  assert.equal(ready(bad.engine), 3);
});

clause(WORKSHOP, "0:ability:construct", "cards outside my discard pile cannot be removed: the opponent's discard pile, my hand, my board and my deck are refused", () => {
  const make = () => wsBoard({ oppDiscard: ["character"] });
  for (const key of ["o0", "handItem", "boardItem", "k0"]) {
    const bad = make();
    refused(() => wsConstructRaw(bad, key), `removing ${key}`);
    assert.equal(ready(bad.engine), 3, "nothing paid");
    assert.notEqual(zoneOf(bad.engine, bad.id(key)), "removed");
  }
  const good = make();
  wsConstruct(good, "d0");
  assert.equal(zoneOf(good.engine, good.id("d0")), "removed", "control");
});

clause(WORKSHOP, "0:ability:construct", "exactly one card: none and two are refused", () => {
  const bad = wsBoard({ discard: ["character", "character"] });
  refused(() => actRaw(bad.engine, P1, bad.id("ws"), "construct", { rem: [] }), "no card");
  refused(() => actRaw(bad.engine, P1, bad.id("ws"), "construct", { rem: [bad.id("d0"), bad.id("d1")] }), "two cards");
  assert.equal(zoneOf(bad.engine, bad.id("d0")), "discard");
  assert.equal(zoneOf(bad.engine, bad.id("d1")), "discard");
  assert.equal(ready(bad.engine), 3);
});

clause(WORKSHOP, "0:ability:construct", "the cost is paid when CONSTRUCT is used, before the opponent can respond; the search happens when it resolves", () => {
  const game = wsBoard({ random: FIXED });
  wsConstructRaw(game);
  assert.equal(ready(game.engine), 0);
  assert.equal(zoneOf(game.engine, game.id("d0")), "removed");
  assert.equal(game.engine.state.pendingChoice, undefined, "no search yet");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  expectPending(game.engine, "chooserSelectsTarget");
});

for (const kind of ["character", "item", "tactic", "location", "resource"] as const) {
  clause(WORKSHOP, "0:ability:construct", `removing a ${kind}: I may search my deck only for a ${kind}, and any other type is refused`, () => {
    const deckKinds: CardKind[] = ["character", "item", "tactic", "location", "resource", "character", "item"];
    const make = () => wsBoard({ discard: [kind], deck: deckKinds, random: FIXED });
    const others = (["character", "item", "tactic", "location", "resource"] as const).filter((k) => k !== kind);
    const bad = make();
    wsConstruct(bad);
    expectPending(bad.engine, "chooserSelectsTarget");
    for (const other of others) {
      const wrongIndex = deckKinds.indexOf(other);
      refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(`k${wrongIndex}`)] }), `a ${other} when a ${kind} was removed`);
      expectPending(bad.engine, "chooserSelectsTarget");
    }
    const good = make();
    wsConstruct(good);
    const rightIndex = deckKinds.indexOf(kind);
    answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id(`k${rightIndex}`)] });
    assert.equal(good.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(good.engine, good.id(`k${rightIndex}`)), "deck", "the found card stays in the deck (it is put on top)");
    assert.ok(revealedIds(good).includes(good.id(`k${rightIndex}`)), "revealedIds(good).includes(good.id(`k${rightIndex}`))");
  });
}

clause(WORKSHOP, "0:ability:construct", "'your deck': only MY deck is searched: the opponent's cards of that type are refused", () => {
  const bad = wsBoard({ random: FIXED });
  wsConstruct(bad);
  refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id("ok0")] }), "the opponent's character");
  expectPending(bad.engine, "chooserSelectsTarget");
  const good = wsBoard({ random: FIXED });
  wsConstruct(good);
  answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id("k2")] });
  assert.equal(good.engine.state.pendingChoice, undefined);
});

clause(WORKSHOP, "0:ability:construct", "'a card': picking two cards is refused", () => {
  const bad = wsBoard({ random: FIXED });
  wsConstruct(bad);
  refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id("k0"), bad.id("k1")] }), "two cards");
  expectPending(bad.engine, "chooserSelectsTarget");
});

clause(WORKSHOP, "0:ability:construct", "'You may search': I can decline to take any card; the cost stays paid, the removed card stays removed, and no card moves to my hand", () => {
  const game = wsBoard({ random: FIXED });
  const handBefore = handOf(game.engine, P1).length;
  wsConstruct(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(ready(game.engine), 0);
  assert.equal(zoneOf(game.engine, game.id("d0")), "removed");
  assert.equal(handOf(game.engine, P1).length, handBefore, "nothing went to my hand");
  assert.equal(deckOf(game.engine, P1).length, 9);
  assert.deepEqual(revealedIds(game), [], "nothing was found, so nothing was revealed");
});

clause(WORKSHOP, "0:ability:construct", "the found card is REVEALED (a cardsRevealed event for exactly that card, visible to all)", () => {
  const game = wsBoard({ random: FIXED });
  wsConstruct(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  assert.deepEqual(revealedIds(game), [game.id("k2")]);
  const reveal = game.engine.state.gameLog.find((entry) => entry.event?.type === "cardsRevealed");
  assert.equal((reveal?.event as { viewerId?: string }).viewerId, "all");
});

clause(WORKSHOP, "0:ability:construct", "'put it on the top of your deck': the found card is the top card of my deck afterwards", () => {
  const game = wsBoard({ random: FIXED });
  wsConstruct(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  assert.equal(deckOf(game.engine, P1)[0], game.id("k2"), "the found card is on top");
  assert.equal(deckOf(game.engine, P1).length, 9, "no card left the deck");
});

clause(WORKSHOP, "0:ability:construct", "the found card stays in the deck (is not drawn): my hand does not change", () => {
  const game = wsBoard({ random: FIXED });
  const handBefore = handOf(game.engine, P1).length;
  wsConstruct(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  assert.equal(handOf(game.engine, P1).length, handBefore);
  assert.equal(zoneOf(game.engine, game.id("k2")), "deck");
});

clause(WORKSHOP, "0:ability:construct", "a searched deck is shuffled afterwards (CR 312.1): the rest of the deck is not left in its old order", () => {
  const game = wsBoard({ random: FIXED });
  const before = deckOf(game.engine, P1).filter((c) => c !== game.id("k2"));
  wsConstruct(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  const after = deckOf(game.engine, P1).filter((c) => c !== game.id("k2"));
  assert.deepEqual([...after].sort(), [...before].sort(), "the same cards");
  assert.notDeepEqual(after, before, "the other cards were shuffled");
});

clause(WORKSHOP, "0:ability:construct", "a search that finds nothing (no card of that type in the deck) still shuffles my deck (CR 312.1)", () => {
  const game = wsBoard({ discard: ["tactic"], deck: ["character", "character", "item", "item", "location", "resource", "character"], random: FIXED });
  const before = deckOf(game.engine, P1);
  wsConstruct(game);
  if (pending(game.engine)) answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(game.engine, P1).length, 7);
  assert.notDeepEqual(deckOf(game.engine, P1), before, "the deck was searched (and nothing matched), so it is shuffled");
});

clause(WORKSHOP, "0:ability:construct", "with no card of that type in my deck nothing can be found and nothing is stuck", () => {
  const game = wsBoard({ discard: ["tactic"], deck: ["character", "character", "item"], random: FIXED });
  wsConstruct(game);
  if (pending(game.engine)) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k0")] }), "a character when a tactic was removed");
    answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  }
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(ready(game.engine), 0);
  assert.equal(zoneOf(game.engine, game.id("d0")), "removed");
  assert.equal(handOf(game.engine, P1).length, 1, "only the card that was already in my hand");
});

clause(WORKSHOP, "0:ability:construct", "if the Workshop is destroyed in response the ability still resolves as written (CR 502.4): I still may search", () => {
  const game = wsBoard({ random: FIXED, extra: [{ key: "kill", def: destroyAnyTactic(), owner: P2, zone: "hand" }] });
  wsConstructRaw(game);
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("ws")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ws")), "discard");
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  assert.ok(revealedIds(game).includes(game.id("k2")), "revealedIds(game).includes(game.id(\"k2\"))");
});

clause(WORKSHOP, "0:ability:construct", "usable in response on the opponent's turn (CR 502.3)", () => {
  const game = wsBoard({ random: FIXED, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  wsConstruct(game);
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("k2")] });
  assert.ok(revealedIds(game).includes(game.id("k2")), "revealedIds(game).includes(game.id(\"k2\"))");
});

clause(WORKSHOP, "0:ability:construct", "only its controller can use it, and only from play", () => {
  const game = wsBoard({ icons: { elitism: 3 }, oppDiscard: ["character"], extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ elitism: 3 }, P2)] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  refused(() => actRaw(game.engine, P2, game.id("ws"), "construct", { rem: [game.id("o0")] }), "the opponent using my Workshop", /control|own|cannot|illegal|only|owner/i);
  assert.equal(zoneOf(game.engine, game.id("o0")), "discard");
  for (const zone of ["hand", "discard"] as const) {
    const bad = wsBoard({ zone });
    refused(() => wsConstructRaw(bad), `CONSTRUCT from ${zone}`);
    assert.equal(ready(bad.engine), 3);
  }
});

clause(WORKSHOP, "0:ability:construct", "the Workshop deploys for exactly its printed cost of 2 with [E][E][E] and is a structure-3 location: 2 damage leaves it, 3 destroys it", () => {
  const ok = wsBoard({ zone: "hand", icons: { elitism: 3 }, discard: [] });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("ws"));
  assert.equal(zoneOf(ok.engine, ok.id("ws")), "play");
  assert.equal(before - ready(ok.engine), 2);
  const rage = wsBoard({ zone: "hand", icons: { rage: 6 }, discard: [] });
  refused(() => playRaw(rage.engine, P1, rage.id("ws")), "no [E]");
  const hit = (amount: number) => {
    const game = devBoard(
      [
        { key: "ws", def: printing(WORKSHOP), owner: P2, zone: "play" },
        { key: "atk", def: character({ name: "Attacker", strength: amount, life: 9, speed: 1 }), owner: P1, zone: "play" }
      ],
      { turn: 1, activePlayerId: P1 }
    );
    fight(game.engine, P1, [game.id("atk")], { type: "card", cardId: game.id("ws") }, []);
    return zoneOf(game.engine, game.id("ws"));
  };
  assert.equal(hit(2), "play");
  assert.equal(hit(3), "discard");
});

// =============================================================================
// Booty Licker
// CLAIM -- COST: Deplete this card. Pick an item. X is its numeric cost. Pay X.
//          EFFECT: Take control of the item.
// FLIP UP: 2 [D][D][D]
// Character, rogue, cost 4, [D][D][D], 1 strength / 3 speed / 1 life, thief.
// =============================================================================

const LICKER = "00df2c7c-19b4-45c3-8a11-eab3ccf19052";

function blBoard(
  opts: {
    zone?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    spentIcons?: Icons;
    oppIcons?: Icons;
    depleted?: boolean;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const zone = opts.zone ?? "play";
  return devBoard(
    [
      { key: "bl", def: printing(LICKER), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? false : undefined, depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "free", def: item({ name: "Free Item", cost: 0 }), owner: P2, zone: "play" },
      { key: "mid", def: item({ name: "Mid Item", cost: 2 }), owner: P2, zone: "play" },
      { key: "dear", def: item({ name: "Dear Item", cost: 4 }), owner: P2, zone: "play" },
      { key: "mineItem", def: item({ name: "My Item", cost: 1 }), owner: P1, zone: "play" },
      { key: "plate", def: item({ name: "Plate", cost: 3, attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "foe" },
      ...res(opts.icons ?? {}),
      ...spent(opts.spentIcons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type BlGame = ReturnType<typeof blBoard>;

/** Uses CLAIM; if the engine asks a mayPay question the answer is yes. */
function claim(game: BlGame, pickKey: string, player: PlayerId = P1): void {
  activate(game.engine, player, game.id("bl"), "claim", { selected: { it: [game.id(pickKey)] } });
  drain(game.engine, payYes);
}
const claimRaw = (game: BlGame, pickKey: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("bl"), "claim", { it: [game.id(pickKey)] });
const controllerOf = (game: BlGame, key: string): PlayerId => game.engine.state.cards[game.id(key)].controllerId;

clause(LICKER, "0:ability:claim", "CLAIM depletes the Licker, pays the item's numeric cost (2) and takes control of the item: it stays in play, still owned by the opponent", () => {
  const game = blBoard({ icons: { rage: 5 } });
  const before = ready(game.engine);
  claim(game, "mid");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("bl")), true);
  assert.equal(controllerOf(game, "mid"), P1);
  assert.equal(game.engine.state.cards[game.id("mid")].ownerId, P2, "ownership never changes (CR 407.8)");
  assert.equal(zoneOf(game.engine, game.id("mid")), "play");
  assert.equal(before - ready(game.engine), 2, "X = 2 paid");
});

clause(LICKER, "0:ability:claim", "'X is its numeric cost': a cost-0 item is taken for free, a cost-4 item costs 4", () => {
  const free = blBoard({ icons: {} });
  claim(free, "free");
  assert.equal(controllerOf(free, "free"), P1);
  const dear = blBoard({ icons: { rage: 6 } });
  const before = ready(dear.engine);
  claim(dear, "dear");
  assert.equal(controllerOf(dear, "dear"), P1);
  assert.equal(before - ready(dear.engine), 4);
});

clause(LICKER, "0:ability:claim", "'Pay X' is part of the COST: with 1 resource for a cost-2 item the ability cannot be used at all (the Licker is not depleted, nothing changes)", () => {
  const bad = blBoard({ icons: { rage: 1 } });
  refused(() => claimRaw(bad, "mid"), "one resource for a cost-2 item");
  assert.equal(isDepleted(bad.engine, bad.id("bl")), false);
  assert.equal(controllerOf(bad, "mid"), P2);
  assert.equal(ready(bad.engine), 1);
});

clause(LICKER, "0:ability:claim", "a cost-4 item cannot be claimed with only 3 resources (the whole action is illegal: the Licker stays undepleted)", () => {
  const bad = blBoard({ icons: { rage: 3 } });
  refused(() => claimRaw(bad, "dear"), "three resources for a cost-4 item");
  assert.equal(isDepleted(bad.engine, bad.id("bl")), false);
  assert.equal(controllerOf(bad, "dear"), P2);
});

clause(LICKER, "0:ability:claim", "the payment is made when CLAIM is used, before the opponent can respond, and there is no way to decline it", () => {
  const game = blBoard({ icons: { rage: 5 } });
  const before = ready(game.engine);
  claimRaw(game, "mid");
  assert.equal(before - ready(game.engine), 2, "X is already paid");
  assert.equal(isDepleted(game.engine, game.id("bl")), true);
  assert.equal(game.engine.state.pendingChoice, undefined, "no 'may pay' question exists");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "no 'may pay' question after it resolves either");
  assert.equal(controllerOf(game, "mid"), P1);
});

clause(LICKER, "0:ability:claim", "spent (attached) resources cannot pay X: three spent and one ready cannot claim a cost-2 item (the ability is refused)", () => {
  const bad = blBoard({ icons: { rage: 1 }, spentIcons: { rage: 3 } });
  refused(() => claimRaw(bad, "mid"), "only one ready resource");
  assert.equal(controllerOf(bad, "mid"), P2);
  assert.equal(isDepleted(bad.engine, bad.id("bl")), false);
});

clause(LICKER, "0:ability:claim", "CLAIM has no threshold: Elitism can pay (the Licker's [D][D][D] is only for deploying it)", () => {
  const game = blBoard({ icons: { elitism: 2 } });
  claim(game, "mid");
  assert.equal(controllerOf(game, "mid"), P1);
});

clause(LICKER, "0:ability:claim", "an item I already control can be picked too (it is 'an item'): X is paid and nothing else changes", () => {
  const game = blBoard({ icons: { rage: 3 } });
  const before = ready(game.engine);
  claim(game, "mineItem");
  assert.equal(controllerOf(game, "mineItem"), P1);
  assert.equal(before - ready(game.engine), 1);
});

clause(LICKER, "0:ability:claim", "an item attached to a character can be claimed: its controller becomes me (X = 3), the host stays the opponent's", () => {
  const game = blBoard({ icons: { rage: 4 } });
  const before = ready(game.engine);
  claim(game, "plate");
  assert.equal(controllerOf(game, "plate"), P1);
  assert.equal(controllerOf(game, "foe"), P2);
  assert.equal(before - ready(game.engine), 3);
});

clause(LICKER, "0:ability:claim", "control is permanent (not just this turn): it is still mine on the next turns, and the item still belongs to its owner (it goes to THEIR discard pile if destroyed)", () => {
  const game = blBoard({ icons: { rage: 4 }, extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  claim(game, "mid");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(controllerOf(game, "mid"), P1, "still mine");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("mid")] } });
  assert.ok(discardOf(game.engine, P2).includes(game.id("mid")), "back to its owner's discard pile");
  assert.equal(discardOf(game.engine, P1).includes(game.id("mid")), false);
});

clause(LICKER, "0:ability:claim", "'Deplete this card' is a cost: an already depleted Licker cannot CLAIM (nothing paid), and after CLAIM it cannot attack", () => {
  const bad = blBoard({ icons: { rage: 5 }, depleted: true });
  refused(() => claimRaw(bad, "mid"), "already depleted");
  assert.equal(ready(bad.engine), 5);
  const used = blBoard({ icons: { rage: 5 } });
  claim(used, "mid");
  refused(
    () => used.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [used.id("bl")], target: { type: "faction", playerId: P2 } }),
    "a depleted character cannot attack"
  );
});

for (const [key, why] of [
  ["ally", "a character"],
  ["place", "a location"],
  ["resCard", "a resource card"],
  ["fdItem", "a face-down card (only a resource, CR 411.1)"],
  ["handItem", "an item card in my hand (CR 402.3)"],
  ["discardItem", "an item card in my discard pile (CR 402.3)"]
] as const) {
  clause(LICKER, "0:ability:claim", `cannot pick ${why}: refused, and the Licker is NOT depleted`, () => {
    const extras = (): CardPlacement[] => [
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" },
      { key: "resCard", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fdItem", def: item({ name: "Face Down Item", cost: 0 }), owner: P2, zone: "play", faceDown: true },
      { key: "handItem", def: item({ name: "Hand Item", cost: 0 }), owner: P1, zone: "hand" },
      { key: "discardItem", def: item({ name: "Discard Item", cost: 0 }), owner: P2, zone: "discard" }
    ];
    const bad = blBoard({ icons: { rage: 5 }, extra: extras() });
    refused(() => claimRaw(bad, key), `picking ${why}`);
    assert.equal(isDepleted(bad.engine, bad.id("bl")), false);
    assert.equal(ready(bad.engine), 5, "nothing paid");
    const good = blBoard({ icons: { rage: 5 }, extra: extras() });
    claim(good, "mid");
    assert.equal(controllerOf(good, "mid"), P1, "control: an item works");
  });
}

clause(LICKER, "0:ability:claim", "cannot pick a faction, and needs exactly one item (none and two are refused)", () => {
  const bad = blBoard({ icons: { rage: 6 } });
  refused(() => actRaw(bad.engine, P1, bad.id("bl"), "claim", { it: [bad.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(bad.engine, P1, bad.id("bl"), "claim", { it: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("bl"), "claim", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("bl"), "claim", { it: [bad.id("free"), bad.id("mid")] }), "two items");
  assert.equal(isDepleted(bad.engine, bad.id("bl")), false);
});

clause(LICKER, "0:ability:claim", "usable in response on the opponent's turn (CR 502.3)", () => {
  const game = blBoard({ icons: { rage: 3 }, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  claim(game, "mid");
  assert.equal(controllerOf(game, "mid"), P1);
});

clause(LICKER, "0:ability:claim", "only its controller can use it, and only from play", () => {
  const game = blBoard({ icons: { rage: 3 }, oppIcons: { rage: 3 }, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  refused(() => actRaw(game.engine, P2, game.id("bl"), "claim", { it: [game.id("mineItem")] }), "the opponent using my Licker", /control|own|cannot|illegal|only|owner/i);
  assert.equal(isDepleted(game.engine, game.id("bl")), false);
  for (const zone of ["hand", "discard"] as const) {
    const bad = blBoard({ zone, icons: { rage: 3 } });
    refused(() => claimRaw(bad, "mid"), `CLAIM from ${zone}`);
    assert.equal(controllerOf(bad, "mid"), P2);
  }
});

clause(LICKER, "0:ability:claim", "the claimed item works for me: an item with an ability can be used by its new controller", () => {
  const drawer = item({
    name: "Stolen Drawer",
    cost: 1,
    behavior: { abilities: [{ id: "dr", name: "Study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const game = blBoard({ icons: { rage: 3 }, extra: [{ key: "drawer", def: drawer, owner: P2, zone: "play" }, ...fillers("dk", 2, P1, "deck")] });
  claim(game, "drawer");
  assert.equal(controllerOf(game, "drawer"), P1);
  activate(game.engine, P1, game.id("drawer"), "dr");
  assert.equal(handOf(game.engine, P1).length, 1, "the new controller drew");
});

clause(LICKER, "0:ability:claim", "it deploys for exactly its printed cost of 4 with [D][D][D]: no [D] and two [D] are refused", () => {
  const ok = blBoard({ zone: "hand", icons: { deception: 4 } });
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("bl"));
  assert.equal(before - ready(ok.engine), 4);
  assert.deepEqual(stats(ok.engine, ok.id("bl")), [1, 1, 3]);
  const twoD = blBoard({ zone: "hand", icons: { deception: 2, rage: 4 } });
  refused(() => playRaw(twoD.engine, P1, twoD.id("bl")), "only two [D]");
  const rage = blBoard({ zone: "hand", icons: { rage: 6 } });
  refused(() => playRaw(rage.engine, P1, rage.id("bl")), "no [D]");
});

// --- FLIP UP: 2 [D][D][D] ---

const blFlip = (game: BlGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("bl"));

clause(LICKER, "1:flipUp", "a face-down Licker flips up by paying 2 (it may help pay for itself) and becomes a face-up 1/1/3 character in play", () => {
  const game = blBoard({ faceDown: true, icons: { deception: 3 } });
  const { engine, id } = game;
  const before = ready(engine);
  assert.equal(before, 4, "three [D] and the face-down Licker itself");
  blFlip(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("bl")].faceDown, false);
  assert.equal(zoneOf(engine, id("bl")), "play");
  assert.equal(engine.getDefinition(id("bl")).type, "character");
  assert.deepEqual(stats(engine, id("bl")), [1, 1, 3]);
  const paid = before - ready(engine);
  assert.ok(paid === 2 || paid === 3, `2 paid (plus the face-down card itself no longer being a resource), not ${paid} (its printed cost is 4)`);
});

clause(LICKER, "1:flipUp", "the Licker may pay for its own FLIP UP (CR 507.4b): [D][D][D] spent, one ready resource and the face-down card (2 ready) is exactly enough", () => {
  const game = blBoard({ faceDown: true, icons: { rage: 1 }, spentIcons: { deception: 3 } });
  assert.equal(ready(game.engine), 2);
  blFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("bl")].faceDown, false);
  assert.equal(ready(game.engine), 0);
});

clause(LICKER, "1:flipUp", "is refused one resource short: [D][D][D] spent and only the face-down card itself (1 ready) cannot pay 2", () => {
  const game = blBoard({ faceDown: true, icons: {}, spentIcons: { deception: 3 } });
  assert.equal(ready(game.engine), 1);
  refused(() => blFlip(game), "1 ready resource for a cost of 2");
  assert.equal(game.engine.state.cards[game.id("bl")].faceDown, true);
});

clause(LICKER, "1:flipUp", "needs [D][D][D]: two [D] with lots of others, plenty of Rage, the opponent's [D] or Volition are refused (still face-down, nothing paid)", () => {
  const twoD = blBoard({ faceDown: true, icons: { deception: 2, rage: 4 } });
  refused(() => blFlip(twoD), "only [D][D]");
  assert.equal(twoD.engine.state.cards[twoD.id("bl")].faceDown, true);
  assert.equal(ready(twoD.engine), 7);
  const rage = blBoard({ faceDown: true, icons: { rage: 6 } });
  refused(() => blFlip(rage), "no [D]");
  const theirs = blBoard({ faceDown: true, icons: { rage: 4 }, oppIcons: { deception: 4 } });
  refused(() => blFlip(theirs), "their [D]");
  const volitionOnly = blBoard({ faceDown: true, icons: { deception: 2 }, extra: volition(4, P1) });
  refused(() => blFlip(volitionOnly), "Volition is not [D]");
});

clause(LICKER, "1:flipUp", "FLIP UP works only on a face-down Licker I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = blBoard({ faceDown: false, icons: { deception: 3 } });
  refused(() => blFlip(faceUp), "already face-up");
  const inHand = blBoard({ zone: "hand", icons: { deception: 3 } });
  refused(() => blFlip(inHand), "in hand");
  const theirs = blBoard({ faceDown: true, icons: { deception: 3 } });
  refused(() => blFlip(theirs, P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("bl")].faceDown, true);
});

clause(LICKER, "1:flipUp", "FLIP UP does not change WHEN a character can be deployed (CR 507.4d): on the opponent's turn it is refused, on mine it works", () => {
  const bad = blBoard({ faceDown: true, icons: { deception: 3 }, turn: 2, active: P2 });
  refused(() => blFlip(bad), "a character on the opponent's turn");
  assert.equal(bad.engine.state.cards[bad.id("bl")].faceDown, true);
  const good = blBoard({ faceDown: true, icons: { deception: 3 }, turn: 1, active: P1 });
  blFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("bl")].faceDown, false, "control: my own turn works");
});

clause(LICKER, "1:flipUp", "a flipped-up Licker is a NEW card in play (CR 411.3): it cannot attack this turn, but can use CLAIM at once", () => {
  const game = blBoard({ faceDown: true, icons: { deception: 3, rage: 3 } });
  blFlip(game);
  resolvePendingResponses(game.engine);
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("bl")], target: { type: "faction", playerId: P2 } }),
    "it just entered play",
  /did not start the turn in play/
  );
  claim(game, "mid");
  assert.equal(controllerOf(game, "mid"), P1);
});

clause(LICKER, "1:flipUp", "FLIP UP is cheaper than deploying: from hand the Licker costs 4, flipped up it costs 2", () => {
  const hand = blBoard({ zone: "hand", icons: { deception: 3 } });
  refused(() => playRaw(hand.engine, P1, hand.id("bl")), "three resources cannot deploy a cost-4 card");
  const flipped = blBoard({ faceDown: true, icons: { deception: 3 } });
  blFlip(flipped);
  resolvePendingResponses(flipped.engine);
  assert.equal(flipped.engine.state.cards[flipped.id("bl")].faceDown, false);
});
