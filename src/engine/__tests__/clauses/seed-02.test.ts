// Clause tests — batch seed-02. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-02`. Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
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
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { developResource, endTurn, developOffers } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;

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
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** A battle-capable P1 faction; both factions can develop. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to` (top of the deck when `to` is "deck"). */
function moverTactic(to: Zone, name = `Mover to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to, position: "top" }]
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

/** A free tactic (id "sw"): destroys every character named `victim` (all at once). */
function sweeperTactic(victim: string): CardDefinition {
  return tactic({
    name: `Sweep ${victim}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [
            {
              type: "forEach",
              selector: { type: "character", name: victim },
              effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
            }
          ]
        }
      ]
    }
  });
}

// --- Lingamite Torture Monk ----------------------------------------------------
// TORTURE -- COST: Pick a character you own. Destroy this card. -- EFFECT: Put
// the character into its owner's hand.
// RECUR: [O][O] -- COST: Use this only if this card is in your discard pile. Pay
// 2. Remove this card from the game. Pick a character you own. -- EFFECT: Put
// the character into its owner's hand.
// Character, cost 2, [O][O], 1 strength / 3 speed / 1 life.

const MONK = "50589b1c-62b6-4eaf-a098-6680ffb520c3";

function monkBoard(
  opts: { monkZone?: "play" | "hand" | "discard"; monkOwner?: PlayerId; obsession?: number; greed?: number; spentObsession?: number; resources?: boolean } = {}
) {
  return devBoard([
    { key: "monk", def: printing(MONK), owner: opts.monkOwner ?? P1, zone: opts.monkZone ?? "play" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "ally2", def: character({ name: "Ally Two" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    // owned by P1 but controlled by P2 (a stolen character)
    { key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" },
    // owned by P2 but controlled by P1 (a captured character)
    { key: "captured", def: character({ name: "Captured" }), owner: P2, controller: P1, zone: "play" },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    // (these two each count as a resource, so only boards that pick them carry them)
    ...(opts.resources
      ? [
          { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" as const },
          { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play" as const, faceDown: true }
        ]
      : []),
    { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
    ...bank("obsession", opts.obsession ?? 0, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.spentObsession ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
}

clause(MONK, "0:ability:torture", "TORTURE destroys this card (to its owner's discard pile) and puts the picked character into its owner's hand, with no resources paid", () => {
  const { engine, id } = monkBoard({ obsession: 3 });
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("ally")] } });

  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("monk")), "discard", "COST: Destroy this card");
  assert.ok(discardOf(engine, P1).includes(id("monk")), "it is in its owner's discard pile");
  assert.equal(zoneOf(engine, id("ally")), "hand", "EFFECT: the picked character goes to its owner's hand");
  assert.deepEqual(handOf(engine, P1).sort(), [...new Set([...handOf(engine, P1).slice(0, handBefore), id("ally")])].sort());
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card was added to the hand");
  assert.equal(ready(engine), before, "TORTURE has no 'pay' in its cost");
});

clause(MONK, "0:ability:torture", "TORTURE has no threshold: it works with no resources at all", () => {
  const { engine, id } = monkBoard();
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("ally")] } });
  assert.equal(zoneOf(engine, id("ally")), "hand");
  assert.equal(zoneOf(engine, id("monk")), "discard");
});

clause(MONK, "0:ability:torture", "only the picked character is affected: other characters (mine and theirs) stay in play", () => {
  const { engine, id } = monkBoard();
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("ally")] } });
  assert.equal(zoneOf(engine, id("ally2")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("stolen")), "play");
  assert.equal(zoneOf(engine, id("captured")), "play");
  assert.equal(zoneOf(engine, id("thing")), "play");
  assert.equal(handOf(engine, P2).length, 0, "the opponent's hand is untouched");
});

clause(MONK, "0:ability:torture", "'a character you own': a character I own but my opponent controls can be picked, and goes to MY hand", () => {
  const { engine, id } = monkBoard();
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "hand");
  assert.ok(handOf(engine, P1).includes(id("stolen")), "it goes to its owner's hand (mine)");
  assert.equal(handOf(engine, P2).includes(id("stolen")), false);
  assert.equal(zoneOf(engine, id("monk")), "discard", "the cost was paid");
});

for (const [key, why] of [
  ["foe", "a character the opponent owns and controls"],
  ["captured", "a character I control but the opponent OWNS ('a character you own', not 'control')"],
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (it is only a resource, CR 411.1)"],
  ["inHand", "a character card in my hand (nothing outside play can be picked, CR 402.3)"],
  ["inDiscard", "a character card in my discard pile (CR 402.3)"]
] as const) {
  clause(MONK, "0:ability:torture", `cannot pick ${why}; nothing is paid`, () => {
    const bad = monkBoard({ resources: true });
    refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("monk")), "play", "the Monk was not destroyed by the refused action");
    assert.equal(zoneOf(bad.engine, bad.id(key)), key === "inHand" ? "hand" : key === "inDiscard" ? "discard" : "play");
    // positive control on the same board shape: a legal pick works
    const good = monkBoard({ resources: true });
    activate(good.engine, P1, good.id("monk"), "torture", { selected: { c: [good.id("ally")] } });
    assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: picking an ordinary character I own works");
  });
}

clause(MONK, "0:ability:torture", "cannot pick my own faction card", () => {
  const bad = monkBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", { c: [bad.engine.state.players[P1].factionId!] }), "picking my faction");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "play");
  const good = monkBoard();
  activate(good.engine, P1, good.id("monk"), "torture", { selected: { c: [good.id("ally")] } });
  assert.equal(zoneOf(good.engine, good.id("ally")), "hand");
});

clause(MONK, "0:ability:torture", "needs a pick: with no character selected the ability cannot be used and the Monk stays in play", () => {
  const bad = monkBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", { c: [] }), "no pick");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "play");
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", {}), "no declaration at all");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "play");
});

clause(MONK, "0:ability:torture", "'a character': exactly one is picked; two picks are refused", () => {
  const bad = monkBoard();
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", { c: [bad.id("ally"), bad.id("ally2")] }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("ally")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("ally2")), "play");
});

clause(MONK, "0:ability:torture", "the Monk may pick itself (it is a character I own when picked): it is destroyed and, having left play, is not then put into my hand (CR 402.4)", () => {
  const { engine, id } = monkBoard();
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("monk")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("monk")), "discard", "destroyed by its own cost; the effect loses track of it in the discard pile");
  assert.equal(handOf(engine, P1).includes(id("monk")), false);
  assert.ok(discardOf(engine, P1).includes(id("monk")), "discardOf(engine, P1).includes(id(\"monk\"))");
});

clause(MONK, "0:ability:torture", "can only be used from play: refused from my hand and from my discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = monkBoard({ monkZone: zone });
    refused(() => actRaw(bad.engine, P1, bad.id("monk"), "torture", { c: [bad.id("ally")] }), `TORTURE from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("monk")), zone);
    assert.equal(zoneOf(bad.engine, bad.id("ally")), "play");
  }
  const good = monkBoard();
  activate(good.engine, P1, good.id("monk"), "torture", { selected: { c: [good.id("ally")] } });
  assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: from play it works");
});

clause(MONK, "0:ability:torture", "can be used in response on the opponent's turn (CR 502.3): during their attack I bounce my own character", () => {
  const { engine, id } = devBoard(
    [
      { key: "monk", def: printing(MONK), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1, "the defender now holds priority");
  activate(engine, P1, id("monk"), "torture", { selected: { c: [id("ally")] } });
  assert.equal(zoneOf(engine, id("ally")), "hand");
  assert.equal(zoneOf(engine, id("monk")), "discard");
});

clause(MONK, "0:ability:torture", "only its controller can use it: the opponent cannot activate my Monk", () => {
  const { engine, id } = devBoard(
    [
      { key: "monk", def: printing(MONK), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ],
    { turn: 1 }
  );
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P2, "the opponent holds priority");
  refused(() => actRaw(engine, P2, id("monk"), "torture", { c: [id("foe")] }), "the opponent using my Monk's TORTURE", /control|own|cannot|illegal|only/i);
  assert.equal(zoneOf(engine, id("monk")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

// RECUR

clause(MONK, "1:ability:recur", "RECUR from my discard pile pays exactly 2, removes the Monk from the game, and puts the picked character into its owner's hand", () => {
  const { engine, id } = monkBoard({ monkZone: "discard", obsession: 3, greed: 2 });
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  actRaw(engine, P1, id("monk"), "recur", { rc: [id("ally")] });
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.equal(zoneOf(engine, id("monk")), "removed", "COST: Remove this card from the game");
  assert.ok(removedOf(engine, P1).includes(id("monk")), "removedOf(engine, P1).includes(id(\"monk\"))");
  assert.equal(discardOf(engine, P1).includes(id("monk")), false, "it is no longer in the discard pile");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ally")), "hand", "EFFECT: put the character into its owner's hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.equal(zoneOf(engine, id("ally2")), "play", "the other character stays");
});

clause(MONK, "1:ability:recur", "RECUR is the same pay-2 whether I have exactly 2 or many resources: with exactly [O][O] it spends both", () => {
  const { engine, id } = monkBoard({ monkZone: "discard", obsession: 2 });
  assert.equal(ready(engine), 2);
  activate(engine, P1, id("monk"), "recur", { selected: { rc: [id("ally")] } });
  assert.equal(ready(engine), 0);
  assert.equal(zoneOf(engine, id("ally")), "hand");
  assert.equal(zoneOf(engine, id("monk")), "removed");
});

clause(MONK, "1:ability:recur", "RECUR needs [O][O]: one Obsession (with plenty of other resources) is refused", () => {
  const bad = monkBoard({ monkZone: "discard", obsession: 1, greed: 6 });
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "one [O] is not [O][O]");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard", "the Monk was not removed");
  assert.equal(ready(bad.engine), 7, "nothing was paid");
  const good = monkBoard({ monkZone: "discard", obsession: 2, greed: 6 });
  activate(good.engine, P1, good.id("monk"), "recur", { selected: { rc: [good.id("ally")] } });
  assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: [O][O] plus other resources works");
  assert.equal(zoneOf(good.engine, good.id("monk")), "removed");
});

clause(MONK, "1:ability:recur", "RECUR needs [O][O]: eight Greed and no Obsession is refused", () => {
  const bad = monkBoard({ monkZone: "discard", greed: 8 });
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "no [O]");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
  assert.equal(ready(bad.engine), 8);
});

clause(MONK, "1:ability:recur", "face-down resources (Volition) do not meet the [O][O] threshold", () => {
  const bad = devBoard([
    { key: "monk", def: printing(MONK), owner: P1, zone: "discard" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    ...volition(6, P1)
  ]);
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "only Volition");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
});

clause(MONK, "1:ability:recur", "my opponent's Obsession does not meet my threshold", () => {
  const bad = devBoard([
    { key: "monk", def: printing(MONK), owner: P1, zone: "discard" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    ...bank("greed", 4, P1),
    ...bank("obsession", 4, P2)
  ]);
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "their [O] is not mine");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
});

clause(MONK, "1:ability:recur", "RECUR is refused one resource short of its pay-2 even with the threshold met (spent [O][O] still count for the threshold)", () => {
  const bad = monkBoard({ monkZone: "discard", spentObsession: 2, greed: 1 });
  assert.equal(ready(bad.engine), 1);
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "only 1 ready resource");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
  assert.equal(ready(bad.engine), 1, "nothing was paid");
  const good = monkBoard({ monkZone: "discard", spentObsession: 2, greed: 2 });
  activate(good.engine, P1, good.id("monk"), "recur", { selected: { rc: [good.id("ally")] } });
  assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: 2 ready resources is enough");
  assert.equal(ready(good.engine), 0);
});

for (const zone of ["play", "hand"] as const) {
  clause(MONK, "1:ability:recur", `'Use this only if this card is in your discard pile': refused while it is in ${zone === "play" ? "play" : "my hand"}`, () => {
    const bad = monkBoard({ monkZone: zone, obsession: 4 });
    refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), `RECUR from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("monk")), zone);
    assert.equal(ready(bad.engine), 4, "nothing was paid");
    const good = monkBoard({ monkZone: "discard", obsession: 4 });
    activate(good.engine, P1, good.id("monk"), "recur", { selected: { rc: [good.id("ally")] } });
    assert.equal(zoneOf(good.engine, good.id("monk")), "removed", "control: from the discard pile it works");
  });
}

clause(MONK, "1:ability:recur", "'your discard pile': a Monk in MY OPPONENT's discard pile cannot be recurred by me", () => {
  const bad = devBoard([
    { key: "monk", def: printing(MONK), owner: P2, zone: "discard" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    ...bank("obsession", 4, P1)
  ]);
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id("ally")] }), "using the opponent's Monk");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
  assert.equal(ready(bad.engine), 4);
});

clause(MONK, "1:ability:recur", "'Pick a character you own' (last cost step): can pick a character I own but the opponent controls", () => {
  const { engine, id } = monkBoard({ monkZone: "discard", obsession: 2 });
  activate(engine, P1, id("monk"), "recur", { selected: { rc: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "hand");
  assert.ok(handOf(engine, P1).includes(id("stolen")), "to its owner's hand");
  assert.equal(zoneOf(engine, id("monk")), "removed");
});

for (const [key, why] of [
  ["foe", "a character the opponent owns and controls"],
  ["captured", "a character I control but the opponent owns"],
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(MONK, "1:ability:recur", `cannot pick ${why}; the whole action is illegal, so nothing is paid and the Monk stays in the discard pile`, () => {
    const bad = monkBoard({ monkZone: "discard", obsession: 3, resources: true });
    const before = ready(bad.engine);
    refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [bad.id(key)] }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard", "the Monk was not removed from the game (CR 606.1d: undo everything)");
    assert.equal(ready(bad.engine), before, "no resources were paid");
    const good = monkBoard({ monkZone: "discard", obsession: 3, resources: true });
    activate(good.engine, P1, good.id("monk"), "recur", { selected: { rc: [good.id("ally")] } });
    assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: an ordinary character I own works");
  });
}

clause(MONK, "1:ability:recur", "needs a pick: with no character selected RECUR is refused and nothing is paid or removed", () => {
  const bad = monkBoard({ monkZone: "discard", obsession: 3 });
  refused(() => actRaw(bad.engine, P1, bad.id("monk"), "recur", { rc: [] }), "no pick");
  assert.equal(zoneOf(bad.engine, bad.id("monk")), "discard");
  assert.equal(ready(bad.engine), 3);
});

clause(MONK, "1:ability:recur", "RECUR is an ability, not a deploy: the Monk is not put into play and the other cards are untouched", () => {
  const { engine, id } = monkBoard({ monkZone: "discard", obsession: 2 });
  const playBefore = playOf(engine, P1).length;
  activate(engine, P1, id("monk"), "recur", { selected: { rc: [id("ally")] } });
  assert.equal(zoneOf(engine, id("monk")), "removed");
  assert.equal(playOf(engine, P1).length, playBefore - 1, "only the picked character left play");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard", "other discard-pile cards stay");
});

/** P1 activates `abilityId` of the Monk with the pick `ally`, then P2 answers by killing the picked `ally`; returns the resolved board. */
function monkPickedKilledInResponse(abilityId: "torture" | "recur") {
  const game = devBoard([
    { key: "monk", def: printing(MONK), owner: P1, zone: abilityId === "torture" ? "play" : "discard" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
    ...bank("obsession", 2, P1)
  ]);
  actRaw(game.engine, P1, game.id("monk"), abilityId, { [abilityId === "torture" ? "c" : "rc"]: [game.id("ally")] });
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent may respond to my ability");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("ally")] } });
  resolvePendingResponses(game.engine);
  return game;
}

clause(MONK, "0:ability:torture", "if the picked character is destroyed in response, it is not fetched out of the discard pile (CR 402.4); the cost stays paid", () => {
  const { engine, id } = monkPickedKilledInResponse("torture");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("monk")), "discard", "the cost (destroy this card) was paid");
  assert.equal(zoneOf(engine, id("ally")), "discard", "destroyed in response: the effect loses track of it and it stays in the discard pile");
  assert.equal(handOf(engine, P1).includes(id("ally")), false);
});

clause(MONK, "1:ability:recur", "if the picked character is destroyed in response, it is not fetched out of the discard pile (CR 402.4); the cost stays paid", () => {
  const { engine, id } = monkPickedKilledInResponse("recur");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("monk")), "removed", "the cost (remove this card from the game) was paid");
  assert.equal(ready(engine), 0, "the cost (pay 2) was paid");
  assert.equal(zoneOf(engine, id("ally")), "discard", "destroyed in response: the effect loses track of it and it stays in the discard pile");
  assert.equal(handOf(engine, P1).includes(id("ally")), false);
});

// --- Living God of Thabbash ----------------------------------------------------
// When a character you control leaves play, your opponent discards a card.
// HIGHER CALLING -- COST: Pay 2. Pick a character you control. -- EFFECT: Put
// the character into its owner's hand.
// Character, cost 10, [O][O], 7 strength / 3 speed / 7 life.

const LG = "bc206d76-e136-4096-8ebb-a3abe1288b83";

function lgBoard(extra: CardPlacement[] = [], opts: { lgZone?: "play" | "hand"; obsession?: number; oppHand?: number } = {}) {
  return devBoard([
    { key: "lg", def: printing(LG), owner: P1, zone: opts.lgZone ?? "play" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    // owned by P1 but controlled by P2
    { key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" },
    // owned by P2 but controlled by P1
    { key: "captured", def: character({ name: "Captured" }), owner: P2, controller: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
    ...bank("obsession", opts.obsession ?? 0, P1),
    ...extra
  ]);
}

type LgGame = ReturnType<typeof lgBoard>;

/** P1 plays the tactic `tacticKey` (declaration "t") on `targetKey`; stops at the first pending choice. */
function useOn(game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, tacticKey: string, targetKey: string, player: PlayerId = P1): void {
  play(game.engine, player, game.id(tacticKey), { selected: { t: [game.id(targetKey)] } });
}

/** Asserts my opponent now has to discard (their choice), picks `cardId` for them, and returns once the choice is gone. */
function opponentDiscards(engine: SpoilsEngine, cardId: CardInstanceId): void {
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses which card they discard");
  answerPending(engine, "chooserSelectsTarget", { selected: [cardId] });
  assert.equal(engine.state.pendingChoice, undefined);
}

/** Asserts that no discard was demanded: no choice open and the opponent's hand is as before. */
function noDiscard(game: LgGame, handBefore: CardInstanceId[]): void {
  assert.equal(game.engine.state.pendingChoice, undefined, "the opponent is not asked to discard");
  assert.deepEqual(handOf(game.engine, P2), handBefore, "the opponent's hand is untouched");
}

clause(LG, "0:rule", "when a character I control is destroyed, my opponent chooses a card from their hand and discards exactly that card", () => {
  const game = lgBoard();
  const { engine, id } = game;
  const hand = handOf(engine, P2);
  assert.equal(hand.length, 3);
  const myHand = handOf(engine, P1);
  useOn(game, "kill", "ally");
  assert.equal(zoneOf(engine, id("ally")), "discard", "control: the Ally was destroyed");
  opponentDiscards(engine, id("oh1"));
  assert.deepEqual(handOf(engine, P2), [id("oh0"), id("oh2")], "exactly the chosen card left their hand");
  assert.ok(discardOf(engine, P2).includes(id("oh1")), "...and is in their discard pile");
  assert.equal(discardOf(engine, P2).length, 1, "only one card was discarded");
  assert.deepEqual(handOf(engine, P1), myHand.filter((c) => c !== id("kill")), "my own hand is untouched (apart from the tactic I played)");
});

clause(LG, "0:rule", "the opponent may choose any card in their hand (not only the first)", () => {
  const game = lgBoard();
  useOn(game, "kill", "ally");
  opponentDiscards(game.engine, game.id("oh2"));
  assert.deepEqual(handOf(game.engine, P2), [game.id("oh0"), game.id("oh1")]);
  assert.deepEqual(discardOf(game.engine, P2), [game.id("oh2")]);
});

clause(LG, "0:rule", "the discard is mandatory: the opponent cannot decline by picking nothing", () => {
  const game = lgBoard();
  useOn(game, "kill", "ally");
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [] }), "declining the discard");
  // the demand is still standing (or has been carried out): either way the opponent must end up a card down
  if (game.engine.state.pendingChoice) opponentDiscards(game.engine, game.id("oh0"));
  assert.equal(handOf(game.engine, P2).length, 2, "the opponent discarded exactly one card");
});

clause(LG, "0:rule", "the opponent can only discard cards from THEIR hand: my hand cards and cards in play are refused", () => {
  const game = lgBoard();
  useOn(game, "kill", "ally");
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] }), "discarding a card in play");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("oh0"), game.id("oh1")] }), "discarding two cards");
  if (!game.engine.state.pendingChoice) assert.fail("a refused answer must leave the demand standing");
  opponentDiscards(game.engine, game.id("oh0"));
  assert.equal(handOf(game.engine, P2).length, 2);
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

for (const [how, tacticKey, make] of [
  ["destroyed", "kill", () => killTactic()],
  ["put into its owner's hand", "mover", () => moverTactic("hand")],
  ["put on top of its owner's deck", "mover", () => moverTactic("deck")],
  ["put into the void", "mover", () => moverTactic("void")],
  ["removed from the game", "mover", () => removerTactic()]
] as const) {
  clause(LG, "0:rule", `triggers however the character leaves play: ${how}`, () => {
    const game = lgBoard([{ key: "mover", def: make(), owner: P1, zone: "hand" }]);
    useOn(game, tacticKey, "ally");
    assert.notEqual(zoneOf(game.engine, game.id("ally")), "play", "control: the Ally left play");
    opponentDiscards(game.engine, game.id("oh0"));
    assert.deepEqual(handOf(game.engine, P2), [game.id("oh1"), game.id("oh2")]);
  });
}

clause(LG, "0:rule", "the Living God itself is a character I control: when it leaves play, my opponent discards a card", () => {
  const game = lgBoard();
  useOn(game, "kill", "lg");
  assert.equal(zoneOf(game.engine, game.id("lg")), "discard", "control: it was destroyed");
  opponentDiscards(game.engine, game.id("oh0"));
  assert.equal(handOf(game.engine, P2).length, 2);
});

clause(LG, "0:rule", "a character I control but my opponent owns also counts ('a character you control')", () => {
  const game = lgBoard();
  useOn(game, "kill", "captured");
  assert.equal(zoneOf(game.engine, game.id("captured")), "discard");
  opponentDiscards(game.engine, game.id("oh0"));
  assert.equal(handOf(game.engine, P2).length, 2);
});

clause(LG, "0:rule", "a character I OWN but my opponent controls does not count", () => {
  const game = lgBoard();
  const before = handOf(game.engine, P2);
  useOn(game, "kill", "stolen");
  assert.equal(zoneOf(game.engine, game.id("stolen")), "discard", "control: it left play");
  noDiscard(game, before);
});

clause(LG, "0:rule", "my opponent's own characters leaving play do not trigger it", () => {
  const game = lgBoard();
  const before = handOf(game.engine, P2);
  useOn(game, "kill", "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "control: it was destroyed");
  noDiscard(game, before);
});

for (const [key, def, faceDown, why] of [
  ["thing", item({ name: "Thing" }), false, "an item"],
  ["place", location({ name: "Place" }), false, "a location"],
  ["res", resourceCard({ name: "Res" }), false, "a resource"]
] as const) {
  clause(LG, "0:rule", `${why} leaving play is not 'a character': no discard`, () => {
    const game = lgBoard([{ key, def, owner: P1, zone: "play", faceDown }, { key: "mover", def: moverTactic("hand"), owner: P1, zone: "hand" }]);
    const before = handOf(game.engine, P2);
    useOn(game, "mover", key);
    assert.equal(zoneOf(game.engine, game.id(key)), "hand", "control: it left play");
    noDiscard(game, before);
  });
}

clause(LG, "0:rule", "a face-down card (only a resource, CR 411.1) leaving play is not 'a character': no discard", () => {
  const game = lgBoard([
    { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
    { key: "mover", def: moverTactic("hand"), owner: P1, zone: "hand" }
  ]);
  const before = handOf(game.engine, P2);
  useOn(game, "mover", "fd");
  assert.equal(zoneOf(game.engine, game.id("fd")), "hand", "control: it left play");
  noDiscard(game, before);
});

clause(LG, "0:rule", "a character card leaving MY HAND (discarded) is not leaving play", () => {
  // a tactic aimed at a character card in my hand, to move it to my discard pile
  const handDiscarder = tactic({
    name: "Hand Discarder",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hd",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
  const game = lgBoard([
    { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
    { key: "hd", def: handDiscarder, owner: P1, zone: "hand" }
  ]);
  const before = handOf(game.engine, P2);
  useOn(game, "hd", "inHand");
  assert.equal(zoneOf(game.engine, game.id("inHand")), "discard", "control: the character card went from my hand to the discard pile");
  noDiscard(game, before);
});

clause(LG, "0:rule", "it is only active while the Living God is in play: with it in my hand a departing character costs the opponent nothing", () => {
  const game = lgBoard([], { lgZone: "hand" });
  const before = handOf(game.engine, P2);
  useOn(game, "kill", "ally");
  assert.equal(zoneOf(game.engine, game.id("ally")), "discard");
  noDiscard(game, before);
});

clause(LG, "0:rule", "it stops once the Living God has left play", () => {
  const game = lgBoard([{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }]);
  useOn(game, "kill", "lg");
  opponentDiscards(game.engine, game.id("oh0"));
  assert.equal(zoneOf(game.engine, game.id("lg")), "discard");
  const before = handOf(game.engine, P2);
  useOn(game, "kill2", "ally");
  assert.equal(zoneOf(game.engine, game.id("ally")), "discard", "control: the Ally was destroyed afterwards");
  noDiscard(game, before);
});

/** Answers every open choice: the opponent discards the first card in their hand, everything else is declined. */
const opponentDiscardsFirst = (engine: SpoilsEngine) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [handOf(engine, P2)[0]] } : declineAll(pc);

clause(LG, "0:rule", "with an empty hand the opponent simply has nothing to discard (no prompt, no stall)", () => {
  const game = lgBoard([], { oppHand: 0 });
  useOn(game, "kill", "ally");
  assert.equal(zoneOf(game.engine, game.id("ally")), "discard", "control: the Ally left play");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.equal(discardOf(game.engine, P2).length, 0);
});

clause(LG, "0:rule", "with a single card in hand the opponent discards that card", () => {
  const game = lgBoard([], { oppHand: 1 });
  useOn(game, "kill", "ally");
  drain(game.engine, opponentDiscardsFirst(game.engine));
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.deepEqual(discardOf(game.engine, P2), [game.id("oh0")]);
});

clause(LG, "0:rule", "each departure discards one card: two of my characters destroyed together make the opponent discard two", () => {
  const sweepee = (key: string): CardPlacement => ({ key, def: character({ name: "Sweepee" }), owner: P1, zone: "play" });
  const game = lgBoard([sweepee("s1"), sweepee("s2"), { key: "sweep", def: sweeperTactic("Sweepee"), owner: P1, zone: "hand" }], { oppHand: 4 });
  play(game.engine, P1, game.id("sweep"));
  assert.equal(zoneOf(game.engine, game.id("s1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("s2")), "discard");
  drain(game.engine, opponentDiscardsFirst(game.engine));
  assert.equal(handOf(game.engine, P2).length, 2, "two discards for two departures");
  assert.equal(discardOf(game.engine, P2).length, 2);
  assert.equal(zoneOf(game.engine, game.id("ally")), "play", "an unrelated character is untouched");
});

clause(LG, "0:rule", "two Living Gods each trigger: one departing character makes the opponent discard two cards", () => {
  const game = lgBoard([{ key: "lg2", def: printing(LG), owner: P1, zone: "play" }], { oppHand: 4 });
  useOn(game, "kill", "ally");
  drain(game.engine, opponentDiscardsFirst(game.engine));
  assert.equal(handOf(game.engine, P2).length, 2, "two triggers, two discards");
  assert.equal(discardOf(game.engine, P2).length, 2);
});

clause(LG, "0:rule", "a character of mine destroyed in battle damage also triggers it (the opponent attacks, my blocker dies)", () => {
  const game = devBoard(
    [
      { key: "lg", def: printing(LG), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 0, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("oh", 3, P2, "hand")
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("blocker")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("blocker")), "discard", "control: the blocker was destroyed by battle damage");
  drain(game.engine, opponentDiscardsFirst(game.engine));
  assert.equal(handOf(game.engine, P2).length, 2);
});

// HIGHER CALLING

/** HIGHER CALLING on `pickKey`, with the response window drained; stops at the first pending choice (the Living God's discard demand). */
function higherCalling(game: LgGame, pickKey: string, player: PlayerId = P1): void {
  actRaw(game.engine, player, game.id("lg"), "higher-calling", { c: [game.id(pickKey)] });
  resolvePendingResponses(game.engine);
}

clause(LG, "1:ability:higher-calling", "pays exactly 2 and puts the picked character into its owner's hand (and, because a character I control left play, my opponent then discards a card)", () => {
  const game = lgBoard([], { obsession: 5 });
  const { engine, id } = game;
  const before = ready(engine);
  actRaw(engine, P1, id("lg"), "higher-calling", { c: [id("ally")] });
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "hand");
  assert.ok(handOf(engine, P1).includes(id("ally")), "to its owner's hand");
  assert.equal(zoneOf(engine, id("lg")), "play", "the Living God stays");
  opponentDiscards(engine, id("oh0"));
  assert.equal(handOf(engine, P2).length, 2, "exactly one discard for one departure");
});

clause(LG, "1:ability:higher-calling", "has no threshold: two resources of any one icon are enough", () => {
  const game = devBoard([
    { key: "lg", def: printing(LG), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    ...bank("rage", 2, P1)
  ]);
  activate(game.engine, P1, game.id("lg"), "higher-calling", { selected: { c: [game.id("ally")] } });
  assert.equal(zoneOf(game.engine, game.id("ally")), "hand");
  assert.equal(ready(game.engine), 0);
});

clause(LG, "1:ability:higher-calling", "is refused one resource short of its pay-2 (nothing is paid or moved)", () => {
  const bad = lgBoard([], { obsession: 1 });
  refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [bad.id("ally")] }), "1 resource");
  assert.equal(zoneOf(bad.engine, bad.id("ally")), "play");
  assert.equal(ready(bad.engine), 1);
  const good = lgBoard([], { obsession: 2 });
  higherCalling(good, "ally");
  assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: exactly 2 is enough");
  assert.equal(ready(good.engine), 0);
});

clause(LG, "1:ability:higher-calling", "'a character you control': can pick a character I control but my opponent owns; it goes to ITS OWNER's hand", () => {
  const game = lgBoard([], { obsession: 2 });
  higherCalling(game, "captured");
  assert.equal(zoneOf(game.engine, game.id("captured")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("captured")), "to its owner's (my opponent's) hand");
  assert.equal(handOf(game.engine, P1).includes(game.id("captured")), false);
});

clause(LG, "1:ability:higher-calling", "can pick the Living God itself", () => {
  const game = lgBoard([], { obsession: 2 });
  higherCalling(game, "lg");
  assert.equal(zoneOf(game.engine, game.id("lg")), "hand");
  assert.equal(ready(game.engine), 0, "the 2 were paid");
});

for (const [key, why] of [
  ["foe", "a character my opponent controls (and owns)"],
  ["stolen", "a character I own but my opponent controls ('you control')"],
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card (only a resource)"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(LG, "1:ability:higher-calling", `cannot pick ${why}; nothing is paid`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = lgBoard(extras(), { obsession: 4 });
    const before = ready(bad.engine);
    refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(ready(bad.engine), before, "nothing was paid");
    assert.equal(bad.engine.state.pendingChoice, undefined);
    const good = lgBoard(extras(), { obsession: 4 });
    higherCalling(good, "ally");
    assert.equal(zoneOf(good.engine, good.id("ally")), "hand", "control: an ordinary character I control works");
  });
}

clause(LG, "1:ability:higher-calling", "cannot pick my own faction card", () => {
  const bad = lgBoard([], { obsession: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [bad.engine.state.players[P1].factionId!] }), "picking my faction");
  assert.equal(ready(bad.engine), 4);
});

clause(LG, "1:ability:higher-calling", "needs exactly one pick: none and two are refused", () => {
  const bad = lgBoard([], { obsession: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [bad.id("ally"), bad.id("lg")] }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("ally")), "play");
  assert.equal(zoneOf(bad.engine, bad.id("lg")), "play");
  assert.equal(ready(bad.engine), 4);
});

clause(LG, "1:ability:higher-calling", "can only be used while the Living God is in play (refused from my hand)", () => {
  const bad = lgBoard([], { lgZone: "hand", obsession: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("lg"), "higher-calling", { c: [bad.id("ally")] }), "from my hand");
  assert.equal(zoneOf(bad.engine, bad.id("ally")), "play");
  assert.equal(ready(bad.engine), 4);
});

clause(LG, "1:ability:higher-calling", "can be used in response on the opponent's turn (CR 502.3)", () => {
  const game = devBoard(
    [
      { key: "lg", def: printing(LG), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...fillers("oh", 2, P2, "hand"),
      ...bank("obsession", 2, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  actRaw(game.engine, P1, game.id("lg"), "higher-calling", { c: [game.id("ally")] });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ally")), "hand");
  opponentDiscards(game.engine, game.id("oh0"));
});

// --- Mesmerizing Enchantress ---------------------------------------------------
// COST: You may pick 4 or fewer characters.
// When this card enters play, if you picked characters as part of its cost,
// they cannot attack until the start of your next turn.
// Character, cost 5, [O][O], 2 strength / 3 speed / 4 life.

const ENCH = "21b1e122-c3d4-4364-9aed-863cab62ee53";

function enchBoard(opts: { obsession?: number; greed?: number } = {}) {
  return devBoard([
    { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
    { key: "a1", def: character({ name: "Ally One", life: 5 }), owner: P1, zone: "play" },
    { key: "a2", def: character({ name: "Ally Two", life: 5 }), owner: P1, zone: "play" },
    { key: "a3", def: character({ name: "Ally Three", life: 5 }), owner: P1, zone: "play" },
    { key: "f1", def: character({ name: "Foe One", life: 5 }), owner: P2, zone: "play" },
    { key: "f2", def: character({ name: "Foe Two", life: 5 }), owner: P2, zone: "play" },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" },
    ...bank("obsession", opts.obsession ?? 5, P1),
    ...bank("greed", opts.greed ?? 0, P1)
  ]);
}

type EnchGame = ReturnType<typeof enchBoard>;

/** Deploys the Enchantress with `picks` as its optional extra cost and lets it resolve. */
function deployEnchantress(game: EnchGame, picks: string[]): void {
  play(game.engine, P1, game.id("ench"), { selected: { cs: picks.map(game.id) } });
}

/** Does `player` get to attack their opponent's faction with `key`? Leaves the battle open when it works. */
function canAttack(game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, player: PlayerId, key: string): boolean {
  try {
    game.engine.perform({ type: "declareAttack", playerId: player, attackerIds: [game.id(key)], target: { type: "faction", playerId: player === P1 ? P2 : P1 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(!(error instanceof TypeError) && !/priority|not found|unknown|undefined/i.test(message), `attack refused for the wrong reason: ${message}`);
    return false;
  }
  return true;
}

clause(ENCH, "0:ability", "deploys for exactly 5 with no characters picked, and nobody is restricted", () => {
  const game = enchBoard({ obsession: 7 });
  const before = ready(game.engine);
  playRaw(game.engine, P1, game.id("ench"), { selected: { cs: [] } });
  assert.equal(before - ready(game.engine), 5, "the printed cost of 5 is paid");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ench")), "play");
  for (const key of ["a1", "a2", "a3"]) assert.equal(game.engine.getRestrictions(game.id(key)).includes("cannotAttack"), false, `${key} is free to attack`);
  for (const key of ["f1", "f2"]) assert.equal(game.engine.getRestrictions(game.id(key)).includes("cannotAttack"), false, `${key} is free to attack`);
});

for (const n of [1, 2, 3, 4]) {
  clause(ENCH, "0:ability", `may pick ${n} character${n === 1 ? "" : "s"} (4 or fewer): accepted, and the 5 is still paid`, () => {
    const game = enchBoard({ obsession: 7 });
    const picks = ["a1", "a2", "f1", "f2"].slice(0, n);
    const before = ready(game.engine);
    playRaw(game.engine, P1, game.id("ench"), { selected: { cs: picks.map(game.id) } });
    assert.equal(before - ready(game.engine), 5);
    resolvePendingResponses(game.engine);
    assert.equal(zoneOf(game.engine, game.id("ench")), "play");
  });
}

clause(ENCH, "0:ability", "picking 5 characters is refused: '4 or fewer'", () => {
  const extra = devBoard([
    { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
    ...["a1", "a2", "a3", "a4", "a5"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "play" as const })),
    ...bank("obsession", 7, P1)
  ]);
  refused(
    () => playRaw(extra.engine, P1, extra.id("ench"), { selected: { cs: ["a1", "a2", "a3", "a4", "a5"].map(extra.id) } }),
    "five picks"
  );
  assert.equal(zoneOf(extra.engine, extra.id("ench")), "hand");
  assert.equal(ready(extra.engine), 7, "nothing was paid");
  const four = devBoard([
    { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
    ...["a1", "a2", "a3", "a4", "a5"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "play" as const })),
    ...bank("obsession", 7, P1)
  ]);
  playRaw(four.engine, P1, four.id("ench"), { selected: { cs: ["a1", "a2", "a3", "a4"].map(four.id) } });
  assert.equal(four.engine.state.cards[four.id("ench")].zone, "deploying", "control: four picks is accepted");
});

clause(ENCH, "0:ability", "the picks can be any characters, mine and my opponent's in any mix", () => {
  const game = enchBoard();
  deployEnchantress(game, ["a1", "f1", "f2", "a3"]);
  assert.equal(zoneOf(game.engine, game.id("ench")), "play");
  for (const key of ["a1", "a3", "f1", "f2"]) assert.ok(game.engine.getRestrictions(game.id(key)).includes("cannotAttack"), `${key} was picked`);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(ENCH, "0:ability", `cannot pick ${why}`, () => {
    const bad = enchBoard();
    refused(() => playRaw(bad.engine, P1, bad.id("ench"), { selected: { cs: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ench")), "hand");
    assert.equal(ready(bad.engine), 5, "nothing was paid");
    const good = enchBoard();
    playRaw(good.engine, P1, good.id("ench"), { selected: { cs: [good.id("a1")] } });
    assert.equal(zoneOf(good.engine, good.id("ench")), "deploying", "control: a character pick is accepted");
  });
}

clause(ENCH, "0:ability", "cannot pick a face-down card (it is only a resource) or either faction card", () => {
  const make = () =>
    devBoard([
      { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "Ally One" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      ...bank("obsession", 5, P1)
    ]);
  const fd = make();
  refused(() => playRaw(fd.engine, P1, fd.id("ench"), { selected: { cs: [fd.id("fd")] } }), "a face-down card");
  const mine = make();
  refused(() => playRaw(mine.engine, P1, mine.id("ench"), { selected: { cs: [mine.engine.state.players[P1].factionId!] } }), "my faction");
  const theirs = make();
  refused(() => playRaw(theirs.engine, P1, theirs.id("ench"), { selected: { cs: [theirs.engine.state.players[P2].factionId!] } }), "their faction");
  const good = make();
  playRaw(good.engine, P1, good.id("ench"), { selected: { cs: [good.id("a1")] } });
  assert.equal(good.engine.state.cards[good.id("ench")].zone, "deploying", "control: a plain character is accepted");
});

clause(ENCH, "0:ability", "the same character cannot be picked twice", () => {
  const bad = enchBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("ench"), { selected: { cs: [bad.id("a1"), bad.id("a1")] } }), "the same character twice");
  assert.equal(zoneOf(bad.engine, bad.id("ench")), "hand");
  assert.equal(ready(bad.engine), 5);
});

clause(ENCH, "0:ability", "costs 5: one resource short is refused", () => {
  const bad = enchBoard({ obsession: 4 });
  refused(() => playRaw(bad.engine, P1, bad.id("ench"), { selected: { cs: [] } }), "4 resources");
  assert.equal(zoneOf(bad.engine, bad.id("ench")), "hand");
  assert.equal(ready(bad.engine), 4);
  const good = enchBoard({ obsession: 5 });
  deployEnchantress(good, []);
  assert.equal(zoneOf(good.engine, good.id("ench")), "play", "control: exactly 5 is enough");
  assert.equal(ready(good.engine), 0);
});

clause(ENCH, "0:ability", "needs [O][O]: one Obsession among enough resources is refused", () => {
  const bad = enchBoard({ obsession: 1, greed: 6 });
  refused(() => playRaw(bad.engine, P1, bad.id("ench"), { selected: { cs: [] } }), "one [O]");
  assert.equal(zoneOf(bad.engine, bad.id("ench")), "hand");
  const none = enchBoard({ obsession: 0, greed: 8 });
  refused(() => playRaw(none.engine, P1, none.id("ench"), { selected: { cs: [] } }), "no [O]");
  const good = enchBoard({ obsession: 2, greed: 4 });
  deployEnchantress(good, []);
  assert.equal(zoneOf(good.engine, good.id("ench")), "play", "control: [O][O] plus enough resources works");
});

clause(ENCH, "0:ability", "the picks are made as part of the cost: the same pick works once the Enchantress is played (it is a cost, so it is already locked in while the opponent can respond)", () => {
  const game = enchBoard();
  playRaw(game.engine, P1, game.id("ench"), { selected: { cs: [game.id("a1")] } });
  assert.equal(game.engine.state.pendingChoice, undefined, "no further question is asked when it resolves");
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent can respond with the pick already made");
  resolvePendingResponses(game.engine);
  assert.ok(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), "game.engine.getRestrictions(game.id(\"a1\")).includes(\"cannotAttack\")");
});

clause(ENCH, "1:rule", "my picked character cannot attack this turn, but my other characters can", () => {
  const game = enchBoard();
  deployEnchantress(game, ["a1", "a2"]);
  assert.equal(canAttack(game, P1, "a1"), false, "a1 was picked");
  assert.equal(canAttack(game, P1, "a2"), false, "a2 was picked");
  assert.equal(canAttack(game, P1, "a3"), true, "control: a3 was not picked");
});

clause(ENCH, "1:rule", "with no characters picked nobody is stopped from attacking", () => {
  const game = enchBoard();
  deployEnchantress(game, []);
  assert.equal(canAttack(game, P1, "a1"), true);
});

clause(ENCH, "1:rule", "it does not apply before the Enchantress enters play (the restriction starts on resolution, not when the pick is paid)", () => {
  const game = enchBoard();
  playRaw(game.engine, P1, game.id("ench"), { selected: { cs: [game.id("a1")] } });
  assert.equal(zoneOf(game.engine, game.id("ench")), "deploying");
  assert.equal(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), false, "not yet restricted while the Enchantress is still being deployed");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), true, "restricted once it enters play");
});

clause(ENCH, "1:rule", "it lasts until the start of MY next turn: my picked character is still restricted through the opponent's turn, then free again", () => {
  const game = enchBoard();
  deployEnchantress(game, ["a1"]);
  assert.ok(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), "game.engine.getRestrictions(game.id(\"a1\")).includes(\"cannotAttack\")");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.ok(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), "still restricted during the opponent's turn (it has not reached the start of my next turn)");
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1, "my next turn has started");
  assert.equal(game.engine.getRestrictions(game.id("a1")).includes("cannotAttack"), false, "the restriction ended at the start of my next turn");
  assert.equal(canAttack(game, P1, "a1"), true, "so it can attack again");
});

clause(ENCH, "1:rule", "a picked OPPONENT character cannot attack on the opponent's turn that follows (it lasts until the start of MY next turn)", () => {
  const game = enchBoard();
  deployEnchantress(game, ["f1"]);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(canAttack(game, P2, "f1"), false, "the picked Foe cannot attack");
  assert.equal(canAttack(game, P2, "f2"), true, "control: the unpicked Foe can");
});

clause(ENCH, "1:rule", "a picked opponent character can attack again once my next turn has started and their following turn comes", () => {
  const game = enchBoard();
  deployEnchantress(game, ["f1"]);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.getRestrictions(game.id("f1")).includes("cannotAttack"), false, "the restriction is over");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(canAttack(game, P2, "f1"), true, "on their turn after that it can attack");
});

clause(ENCH, "1:rule", "'cannot attack' only: a picked opponent character can still block", () => {
  const game = enchBoard();
  deployEnchantress(game, ["f1"]);
  assert.equal(canAttack(game, P1, "a3"), true);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P2, [game.id("f1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("f1")], "the picked Foe blocks");
});

clause(ENCH, "1:rule", "all four picked characters are stopped", () => {
  const game2 = devBoard([
    { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
    ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key }), owner: P1, zone: "play" as const })),
    { key: "a5", def: character({ name: "a5" }), owner: P1, zone: "play" },
    ...bank("obsession", 5, P1)
  ]);
  play(game2.engine, P1, game2.id("ench"), { selected: { cs: ["a1", "a2", "a3", "a4"].map(game2.id) } });
  for (const key of ["a1", "a2", "a3", "a4"]) assert.equal(canAttack(game2, P1, key), false, `${key} was picked`);
  assert.equal(canAttack(game2, P1, "a5"), true, "control: a5 was not");
});

clause(ENCH, "1:rule", "a picked character that left play in response does not stall the Enchantress: it still enters and the other picks are restricted", () => {
  const game = devBoard([
    { key: "ench", def: printing(ENCH), owner: P1, zone: "hand" },
    { key: "a1", def: character({ name: "Ally One" }), owner: P1, zone: "play" },
    { key: "a2", def: character({ name: "Ally Two" }), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
    ...bank("obsession", 5, P1)
  ]);
  playRaw(game.engine, P1, game.id("ench"), { selected: { cs: [game.id("a1"), game.id("a2")] } });
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("a1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("a1")), "discard", "control: a1 was destroyed in response");
  assert.equal(zoneOf(game.engine, game.id("ench")), "play");
  assert.equal(canAttack(game, P1, "a2"), false, "the surviving pick is still restricted");
});

// --- Mirthless Altar -----------------------------------------------------------
// At the start of each player's turn, you may pick a character. If you do, it
// loses 1 strength this turn.
// Location, cost 2, [O][O], structure 3.

const ALTAR = "9e0f839e-f482-42b1-b6d4-4c19dbdcd70a";

function altarBoard(extra: CardPlacement[] = [], opts: { altarOwner?: PlayerId; altarZone?: "play" | "hand" } = {}) {
  return devBoard([
    { key: "altar", def: printing(ALTAR), owner: opts.altarOwner ?? P1, zone: opts.altarZone ?? "play" },
    { key: "c1", def: character({ name: "Mine One", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
    { key: "c2", def: character({ name: "Mine Two", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
    { key: "f1", def: character({ name: "Foe One", strength: 3, life: 6, speed: 2 }), owner: P2, zone: "play" },
    ...extra
  ]);
}

type AltarGame = ReturnType<typeof altarBoard>;
const strengthOf = (game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, key: string): number => game.engine.getStat(game.id(key), "strength");

/** Ends the turn of `from`; the next player's turn starts and the Altar's trigger (if any) raises its pick. */
const startNextTurn = (game: AltarGame, from: PlayerId): void => endTurn(game.engine, from);

clause(ALTAR, "0:rule", "at the start of MY turn I may pick a character: it loses exactly 1 strength this turn", () => {
  const game = altarBoard();
  startNextTurn(game, P1); // P2's turn
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  startNextTurn(game, P2); // my turn
  assert.equal(game.engine.state.activePlayerId, P1);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(strengthOf(game, "c1"), 2, "3 - 1");
  assert.equal(game.engine.getStat(game.id("c1"), "life"), 6, "life is untouched");
  assert.equal(game.engine.getStat(game.id("c1"), "speed"), 2, "speed is untouched");
  assert.equal(strengthOf(game, "c2"), 3, "another of my characters is untouched");
  assert.equal(strengthOf(game, "f1"), 3, "the opponent's character is untouched");
});

clause(ALTAR, "0:rule", "at the start of the OPPONENT's turn it also triggers, and I (the Altar's controller), not the opponent, pick", () => {
  const game = altarBoard();
  startNextTurn(game, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Altar's controller makes the pick on every player's turn");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("f1")] });
  assert.equal(strengthOf(game, "f1"), 2);
  assert.equal(strengthOf(game, "c1"), 3);
});

clause(ALTAR, "0:rule", "'you may': on either turn I can decline, and then nothing loses strength", () => {
  const game = altarBoard();
  startNextTurn(game, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["c1", "c2", "f1"]) assert.equal(strengthOf(game, key), 3, `${key} (opponent's turn)`);
  startNextTurn(game, P2);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["c1", "c2", "f1"]) assert.equal(strengthOf(game, key), 3, `${key} (my turn)`);
});

clause(ALTAR, "0:rule", "the pick may be any character: mine or my opponent's, and the Altar's controller can pick their own", () => {
  const mine = altarBoard();
  startNextTurn(mine, P1);
  answerPending(mine.engine, "chooserSelectsTarget", { selected: [mine.id("c2")] });
  assert.equal(strengthOf(mine, "c2"), 2);
  const theirs = altarBoard();
  startNextTurn(theirs, P1);
  answerPending(theirs.engine, "chooserSelectsTarget", { selected: [theirs.id("f1")] });
  assert.equal(strengthOf(theirs, "f1"), 2);
});

clause(ALTAR, "0:rule", "the pick may be a character the other player owns but I control", () => {
  const game = altarBoard([{ key: "captured", def: character({ name: "Captured", strength: 3, life: 6 }), owner: P2, controller: P1, zone: "play" }]);
  startNextTurn(game, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("captured")] });
  assert.equal(strengthOf(game, "captured"), 2);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "another location"],
  ["res", "a resource"],
  ["inHand", "a character card in a hand"],
  ["inDiscard", "a character card in a discard pile"]
] as const) {
  clause(ALTAR, "0:rule", `cannot pick ${why}`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", strength: 3 }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard", strength: 3 }), owner: P1, zone: "discard" }
    ];
    const bad = altarBoard(extras());
    startNextTurn(bad, P1);
    expectPending(bad.engine, "chooserSelectsTarget");
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    if (!bad.engine.state.pendingChoice) assert.fail("the refused pick must leave the question standing");
    answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id("c1")] });
    assert.equal(strengthOf(bad, "c1"), 2, "control: a character pick works on the same board");
  });
}

clause(ALTAR, "0:rule", "cannot pick a face-down card (it is only a resource) or a faction", () => {
  const game = altarBoard([{ key: "fd", def: character({ name: "Face Down", strength: 3 }), owner: P2, zone: "play", faceDown: true }]);
  startNextTurn(game, P1);
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("fd")] }), "a face-down card");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.engine.state.players[P2].factionId!] }), "a faction");
  if (!game.engine.state.pendingChoice) assert.fail("the refused picks must leave the question standing");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("f1")] });
  assert.equal(strengthOf(game, "f1"), 2, "control");
});

clause(ALTAR, "0:rule", "'a character': only one is picked; two picks are refused", () => {
  const game = altarBoard();
  startNextTurn(game, P1);
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1"), game.id("c2")] }), "two characters");
  if (!game.engine.state.pendingChoice) assert.fail("the refused pick must leave the question standing");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1")] });
  assert.equal(strengthOf(game, "c1"), 2);
  assert.equal(strengthOf(game, "c2"), 3);
});

clause(ALTAR, "0:rule", "'this turn': the strength loss ends when the turn ends, and a new one starts next turn only if I pick again", () => {
  const game = altarBoard();
  startNextTurn(game, P1); // P2's turn: weaken c1
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1")] });
  assert.equal(strengthOf(game, "c1"), 2);
  startNextTurn(game, P2); // my turn
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(strengthOf(game, "c1"), 3, "the loss lasted only through the previous turn");
});

clause(ALTAR, "0:rule", "the loss lasts through its whole turn, including in battle (an attacker with 3 strength deals only 2)", () => {
  const game = altarBoard([{ key: "target", def: character({ name: "Target", strength: 0, life: 9 }), owner: P1, zone: "play" }]);
  startNextTurn(game, P1); // P2's turn: weaken their own f1? I pick f1
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("f1")] });
  declareAttackBy(game.engine, P2, [game.id("f1")], { type: "card", cardId: game.id("altar") });
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("altar")].damage, 2, "3 strength - 1 = 2 damage to the Altar");
});

clause(ALTAR, "0:rule", "two Altars each trigger on each turn: two picks, and the same character can lose 2 strength", () => {
  const game = altarBoard([{ key: "altar2", def: printing(ALTAR), owner: P1, zone: "play" }]);
  startNextTurn(game, P1);
  drain(game.engine, pickTargets([game.id("f1")]));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(strengthOf(game, "f1"), 1, "3 - 1 - 1");
});

clause(ALTAR, "0:rule", "an Altar controlled by my OPPONENT is theirs to use: on my turn it is they who pick", () => {
  const game = altarBoard([], { altarOwner: P2 });
  startNextTurn(game, P1); // P2's turn
  let pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Altar's controller picks");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1")] });
  assert.equal(strengthOf(game, "c1"), 2);
  startNextTurn(game, P2); // my turn
  pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "even on my turn, its controller (my opponent) picks");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c2")] });
  assert.equal(strengthOf(game, "c2"), 2);
});

clause(ALTAR, "0:rule", "'you' is the Altar's current controller: an Altar I own but my opponent controls is used by them", () => {
  const game = devBoard([
    { key: "altar", def: printing(ALTAR), owner: P1, controller: P2, zone: "play" },
    { key: "c1", def: character({ name: "Mine One", strength: 3 }), owner: P1, zone: "play" }
  ]);
  startNextTurn(game, P1);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Altar's controller (P2) picks");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("c1")] });
  assert.equal(strengthOf(game, "c1"), 2);
});

clause(ALTAR, "0:rule", "does nothing while the Altar is not in play (in my hand)", () => {
  const game = altarBoard([], { altarZone: "hand" });
  startNextTurn(game, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(strengthOf(game, "f1"), 3);
});

clause(ALTAR, "0:rule", "stops once the Altar has left play (destroyed)", () => {
  // the Altar is a location: move it out of play with the all-purpose mover tactic (the kill tactic only hits characters)
  const game = devBoard([
    { key: "altar", def: printing(ALTAR), owner: P1, zone: "play" },
    { key: "mv", def: moverTactic("discard"), owner: P1, zone: "hand" },
    { key: "c1", def: character({ name: "Mine One", strength: 3 }), owner: P1, zone: "play" }
  ]);
  useOn(game, "mv", "altar");
  assert.equal(zoneOf(game.engine, game.id("altar")), "discard", "control: the Altar left play");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.pendingChoice, undefined, "no pick is raised any more");
  assert.equal(game.engine.getStat(game.id("c1"), "strength"), 3);
});

clause(ALTAR, "0:rule", "with no character in play at all nothing is asked and nothing breaks", () => {
  const game = devBoard([{ key: "altar", def: printing(ALTAR), owner: P1, zone: "play" }]);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.activePlayerId, P2);
});

clause(ALTAR, "0:rule", "a character with 1 strength goes down to 0 strength", () => {
  const one = altarBoard([{ key: "one", def: character({ name: "One", strength: 1 }), owner: P1, zone: "play" }]);
  startNextTurn(one, P1);
  answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("one")] });
  assert.equal(strengthOf(one, "one"), 0, "1 - 1 = 0");
});

clause(ALTAR, "0:rule", "a character that already has 0 strength stays at 0 strength (CR 410.4), not -1", () => {
  const zero = altarBoard([{ key: "zero", def: character({ name: "Zero", strength: 0 }), owner: P1, zone: "play" }]);
  startNextTurn(zero, P1);
  answerPending(zero.engine, "chooserSelectsTarget", { selected: [zero.id("zero")] });
  assert.equal(strengthOf(zero, "zero"), 0, "0 stays 0");
});

// --- Nefarious Horror ----------------------------------------------------------
// COVERT
// While your opponent controls more characters than you, this card gains 2
// strength, 2 life, and loses COVERT.
// Character, cost 4, [O], 2 strength / 3 speed / 2 life.

const HORROR = "287fad39-5bc3-499b-9099-f95294af36e6";

/** The Horror (P1) plus `mine` more characters of mine and `theirs` characters of my opponent's. */
function horrorBoard(mine: number, theirs: number, extra: CardPlacement[] = [], extraOpts: Parameters<typeof buildGame>[0] = {}) {
  return devBoard(
    [
      { key: "horror", def: printing(HORROR), owner: P1, zone: "play" },
      ...Array.from({ length: mine }, (_, i) => ({ key: `ally${i}`, def: character({ name: `Ally ${i}`, life: 4 }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: theirs }, (_, i) => ({ key: `foe${i}`, def: character({ name: `Foe ${i}`, life: 4 }), owner: P2, zone: "play" as const })),
      ...extra
    ],
    extraOpts
  );
}

const hasCovert = (game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, key: string): boolean => game.engine.getKeywords(game.id(key)).includes("covert");

clause(HORROR, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(HORROR));
clause(HORROR, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(HORROR));
clause(HORROR, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(HORROR));
clause(HORROR, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(HORROR));

clause(HORROR, "1:rule", "with the opponent controlling MORE characters it gains 2 strength and 2 life (4/4), keeps its speed, and loses COVERT", () => {
  const game = horrorBoard(0, 2);
  const printed = printing(HORROR);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength! + 2);
  assert.equal(game.engine.getStat(game.id("horror"), "life"), printed.life! + 2);
  assert.equal(game.engine.getStat(game.id("horror"), "speed"), printed.speed, "speed is untouched");
  assert.equal(hasCovert(game, "horror"), false, "loses COVERT");
});

clause(HORROR, "1:rule", "with equal character counts it has its printed stats and COVERT (it counts itself on my side)", () => {
  for (const [mine, theirs] of [
    [0, 1],
    [1, 2],
    [2, 3]
  ] as const) {
    const game = horrorBoard(mine, theirs);
    const printed = printing(HORROR);
    assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength, `${mine + 1} v ${theirs}`);
    assert.equal(game.engine.getStat(game.id("horror"), "life"), printed.life);
    assert.equal(hasCovert(game, "horror"), true);
  }
});

clause(HORROR, "1:rule", "with the opponent controlling FEWER characters it has its printed stats and COVERT", () => {
  const game = horrorBoard(2, 1);
  const printed = printing(HORROR);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("horror"), "life"), printed.life);
  assert.equal(hasCovert(game, "horror"), true);
  const none = horrorBoard(0, 0);
  assert.equal(none.engine.getStat(none.id("horror"), "strength"), printed.strength, "no opposing characters");
  assert.equal(hasCovert(none, "horror"), true);
});

clause(HORROR, "1:rule", "'more' is strictly more: one more character is enough, however many I have", () => {
  const game = horrorBoard(3, 5);
  const printed = printing(HORROR);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength! + 2, "4 vs 5");
  assert.equal(hasCovert(game, "horror"), false);
});

clause(HORROR, "1:rule", "only characters are counted: my opponent's items, locations, resources and face-down cards do not tip the balance", () => {
  const game = horrorBoard(0, 1, [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
    { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true }
  ]);
  const printed = printing(HORROR);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength, "1 character vs 1 character");
  assert.equal(hasCovert(game, "horror"), true);
});

clause(HORROR, "1:rule", "only characters are counted on my side too: my items, locations and resources do not help me", () => {
  const game = horrorBoard(0, 2, [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
    { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true }
  ]);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printing(HORROR).strength! + 2, "1 character vs 2: still outnumbered");
  assert.equal(hasCovert(game, "horror"), false);
});

clause(HORROR, "1:rule", "'controls': a character my opponent controls but I own counts for them, and one I control but they own counts for me", () => {
  const stolen = horrorBoard(0, 1, [{ key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" }]);
  assert.equal(stolen.engine.getStat(stolen.id("horror"), "strength"), printing(HORROR).strength! + 2, "they control 2, I control 1");
  const captured = horrorBoard(0, 2, [{ key: "captured", def: character({ name: "Captured" }), owner: P2, controller: P1, zone: "play" }]);
  assert.equal(captured.engine.getStat(captured.id("horror"), "strength"), printing(HORROR).strength, "I control 2, they control 2");
  assert.equal(hasCovert(captured, "horror"), true);
});

clause(HORROR, "1:rule", "it turns on and off as characters leave play: killing an opposing character ends it, killing one of mine starts it", () => {
  const game = horrorBoard(1, 2, [
    { key: "kill1", def: killTactic(), owner: P1, zone: "hand" },
    { key: "kill2", def: killTactic(), owner: P1, zone: "hand" }
  ]);
  const printed = printing(HORROR);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength, "2 v 2: off");
  useOn(game, "kill1", "ally0");
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength! + 2, "1 v 2: on");
  assert.equal(hasCovert(game, "horror"), false);
  useOn(game, "kill2", "foe0");
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printed.strength, "1 v 1: off again");
  assert.equal(game.engine.getStat(game.id("horror"), "life"), printed.life);
  assert.equal(hasCovert(game, "horror"), true, "COVERT is back");
});

clause(HORROR, "1:rule", "the bonus is not permanent: a Horror bounced while outnumbered comes back with printed stats once the counts are level", () => {
  const game = horrorBoard(0, 2, [
    { key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...bank("obsession", 4, P1)
  ]);
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printing(HORROR).strength! + 2);
  useOn(game, "bounce", "horror");
  assert.equal(zoneOf(game.engine, game.id("horror")), "hand");
  useOn(game, "kill", "foe0");
  play(game.engine, P1, game.id("horror"));
  assert.equal(zoneOf(game.engine, game.id("horror")), "play", "control: deployed again for 4");
  assert.equal(game.engine.getStat(game.id("horror"), "strength"), printing(HORROR).strength, "1 v 1: printed stats");
  assert.equal(game.engine.getStat(game.id("horror"), "life"), printing(HORROR).life);
  assert.equal(hasCovert(game, "horror"), true);
});

clause(HORROR, "1:rule", "damage is judged against the changing life: with 3 damage it survives at 4 life, and is destroyed when the bonus ends (life back to 2)", () => {
  const game = horrorBoard(0, 2, [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  game.engine.state.cards[game.id("horror")].damage = 3;
  assert.equal(game.engine.getStat(game.id("horror"), "life"), 4);
  assert.equal(zoneOf(game.engine, game.id("horror")), "play", "3 damage on 4 life: alive");
  useOn(game, "kill", "foe0");
  assert.equal(zoneOf(game.engine, game.id("foe0")), "discard", "control: the opposing character was destroyed");
  assert.equal(game.engine.getStat(game.id("horror"), "life"), 2, "the bonus is gone");
  assert.equal(zoneOf(game.engine, game.id("horror")), "discard", "3 damage on 2 life: destroyed");
});

clause(HORROR, "1:rule", "it loses COVERT even when something grants it COVERT this turn (a 'lose' beats a 'gain', CR 402.6)", () => {
  const granter = tactic({
    name: "Granter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "g",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
          effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const game = horrorBoard(0, 2, [{ key: "granter", def: granter, owner: P1, zone: "hand" }]);
  assert.equal(hasCovert(game, "horror"), false);
  useOn(game, "granter", "horror");
  assert.equal(hasCovert(game, "horror"), false, "still no COVERT while outnumbered");
});

clause(HORROR, "1:rule", "when it has lost COVERT, a plain opposing character CAN block it (and a covert one cannot)", () => {
  const game = horrorBoard(
    0,
    2,
    [{ key: "cov", def: character({ name: "Covert Foe", life: 4, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }],
    { turn: 2 }
  );
  declareAttackBy(game.engine, P1, [game.id("horror")]);
  refused(() => declareBlockers(game.engine, P2, [game.id("cov")]), "a covert character may block only a covert party");
  declareBlockers(game.engine, P2, [game.id("foe0")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("foe0")], "a plain character blocks the (no longer covert) Horror");
});

clause(HORROR, "1:rule", "when it has NOT lost COVERT (not outnumbered) a plain opposing character cannot block it", () => {
  const game = horrorBoard(1, 2, [], { turn: 2 });
  declareAttackBy(game.engine, P1, [game.id("horror")]);
  refused(() => declareBlockers(game.engine, P2, [game.id("foe0")]), "a plain character cannot block a covert party");
});

clause(HORROR, "1:rule", "as a blocker: outnumbered (COVERT lost) it can block a plain attacker", () => {
  const game = devBoard(
    [
      { key: "horror", def: printing(HORROR), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", life: 9 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("horror")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("horror")]);
});

clause(HORROR, "1:rule", "the bonus works in battle: outnumbered, it deals 4 damage and survives 3 damage", () => {
  const game = devBoard(
    [
      { key: "horror", def: printing(HORROR), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", life: 9 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("horror")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("atk")].damage, 4, "strength 2 + 2");
  assert.equal(zoneOf(game.engine, game.id("horror")), "play", "3 damage on 4 life");
});

// --- Neurosis ------------------------------------------------------------------
// This card provides - [O][O]
// When this card enters play, your faction loses 1 influence.
// Resource (arcanist), cost 0.

const NEUROSIS = "1e8e86ba-3643-4a1f-911f-91ea29b00d42";

/** A cost-0 character of mine in hand that needs `threshold`, plus whatever else is on the board. */
function neurosisBoard(extra: CardPlacement[] = [], opts: { influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    cards: extra
  });
}

const needs = (key: string, threshold: string, cost = 0): CardPlacement => ({
  key,
  def: character({ name: `Needs ${key}`, threshold: threshold as never, cost }),
  owner: P1,
  zone: "hand"
});

clause(NEUROSIS, "0:rule", "face-up in play it provides exactly two Obsession icons ([O][O]) and nothing else", () => {
  const { engine } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" }]);
  assert.deepEqual(engine.getThresholds(P1), { obsession: 2 });
  assert.deepEqual(engine.getThresholds(P2), {}, "my opponent gets nothing from it");
});

clause(NEUROSIS, "0:rule", "its two icons meet an [O][O] threshold on their own, but not [O][O][O]", () => {
  const { engine, id } = neurosisBoard([
    { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" },
    needs("two", "oo"),
    needs("three", "ooo"),
    needs("one", "o")
  ]);
  assert.equal(engine.getCardPlayability(P1, id("one")).thresholdMet, true);
  assert.equal(engine.getCardPlayability(P1, id("two")).thresholdMet, true, "[O][O] from one Neurosis");
  assert.equal(engine.getCardPlayability(P1, id("three")).thresholdMet, false, "only two icons");
});

clause(NEUROSIS, "0:rule", "it adds to other Obsession: Neurosis plus one Obsession meets [O][O][O]; two Neurosis make four", () => {
  const withOne = neurosisBoard([
    { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" },
    ...bank("obsession", 1, P1),
    needs("three", "ooo"),
    needs("four", "oooo")
  ]);
  assert.equal(withOne.engine.getCardPlayability(P1, withOne.id("three")).thresholdMet, true);
  assert.equal(withOne.engine.getCardPlayability(P1, withOne.id("four")).thresholdMet, false);
  const twice = neurosisBoard([
    { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" },
    { key: "n2", def: printing(NEUROSIS), owner: P1, zone: "play" },
    needs("four", "oooo"),
    needs("five", "ooooo")
  ]);
  assert.deepEqual(twice.engine.getThresholds(P1), { obsession: 4 });
  assert.equal(twice.engine.getCardPlayability(P1, twice.id("four")).thresholdMet, true);
  assert.equal(twice.engine.getCardPlayability(P1, twice.id("five")).thresholdMet, false);
});

clause(NEUROSIS, "0:rule", "the two icons do not satisfy other icons (not [G], not [R])", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" }, needs("greed", "g"), needs("rage", "r")]);
  assert.equal(engine.getCardPlayability(P1, id("greed")).thresholdMet, false);
  assert.equal(engine.getCardPlayability(P1, id("rage")).thresholdMet, false);
});

clause(NEUROSIS, "0:rule", "it is still only ONE resource when paying: Neurosis alone cannot pay a numeric cost of 2, but can pay 1", () => {
  const { engine, id } = neurosisBoard([
    { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" },
    needs("pay1", "", 1),
    needs("pay2", "", 2)
  ]);
  assert.equal(readyResources(engine, P1), 1);
  assert.equal(engine.getCardPlayability(P1, id("pay1")).playable, true);
  assert.equal(engine.getCardPlayability(P1, id("pay2")).playable, false, "one resource card, even though it provides two icons");
});

clause(NEUROSIS, "0:rule", "my opponent's Neurosis provides icons to them only", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P2, zone: "play" }, needs("two", "oo")]);
  assert.deepEqual(engine.getThresholds(P2), { obsession: 2 });
  assert.deepEqual(engine.getThresholds(P1), {});
  assert.equal(engine.getCardPlayability(P1, id("two")).thresholdMet, false);
});

clause(NEUROSIS, "0:rule", "face-down it is only a resource with no rules text: one Volition, not [O][O]", () => {
  const { engine, id } = neurosisBoard([
    { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play", faceDown: true },
    needs("two", "oo"),
    needs("vol", "v")
  ]);
  assert.deepEqual(engine.getThresholds(P1), { volition: 1 });
  assert.equal(engine.getCardPlayability(P1, id("two")).thresholdMet, false);
  assert.equal(engine.getCardPlayability(P1, id("vol")).thresholdMet, true);
});

clause(NEUROSIS, "1:rule", "played face-up as a resource, my faction loses exactly 1 influence (once), and it provides [O][O] afterwards", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" }], { influence: 20 });
  assert.equal(influenceOf(engine, P1), 20);
  developResource(engine, P1, id("n"), false);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(engine.state.cards[id("n")].faceDown, false);
  assert.equal(influenceOf(engine, P1), 19, "exactly 1 influence lost");
  assert.equal(influenceOf(engine, P2), 30, "the opponent's faction is untouched");
  assert.deepEqual(engine.getThresholds(P1), { obsession: 2 });
});

clause(NEUROSIS, "1:rule", "played FACE-DOWN it has no rules text, so my faction loses no influence", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" }], { influence: 20 });
  developResource(engine, P1, id("n"), true);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(engine.state.cards[id("n")].faceDown, true);
  assert.equal(influenceOf(engine, P1), 20, "no influence lost for a face-down resource (CR 411.1)");
  assert.deepEqual(engine.getThresholds(P1), { volition: 1 });
});

clause(NEUROSIS, "1:rule", "every Neurosis that enters play costs 1 influence: a second one costs another 1", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" }, { key: "n2", def: printing(NEUROSIS), owner: P1, zone: "hand" }], {
    influence: 20
  });
  developResource(engine, P1, id("n"), false);
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P1), 19);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  developResource(engine, P1, id("n2"), false);
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P1), 18, "the second Neurosis cost another 1");
});

clause(NEUROSIS, "1:rule", "a Neurosis put into play by an effect (not by the develop rule) also costs 1 influence", () => {
  const putter = tactic({
    name: "Put Resource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pr",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = neurosisBoard(
    [
      { key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" },
      { key: "put", def: putter, owner: P1, zone: "hand" }
    ],
    { influence: 20 }
  );
  play(engine, P1, id("put"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "play", "control: it is in play");
  assert.equal(engine.state.cards[id("n")].faceDown, false);
  assert.equal(influenceOf(engine, P1), 19, "exactly 1 influence lost");
});

clause(NEUROSIS, "1:rule", "it is 'your faction': a Neurosis that enters play under MY control costs MY faction, not my opponent's", () => {
  const putter = tactic({
    name: "Put Resource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pr",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "any", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = neurosisBoard(
    [
      { key: "n", def: printing(NEUROSIS), owner: P2, zone: "hand" },
      { key: "put", def: putter, owner: P1, zone: "hand" }
    ],
    { influence: 20 }
  );
  assert.equal(influenceOf(engine, P2), 30);
  play(engine, P1, id("put"), { selected: { t: [id("n")] } });
  if (zoneOf(engine, id("n")) === "play") {
    assert.equal(engine.state.cards[id("n")].controllerId, P1, "control: I control it");
    assert.equal(influenceOf(engine, P1), 19, "the controller's faction pays");
    assert.equal(influenceOf(engine, P2), 30, "its owner's faction is untouched");
  } else {
    assert.fail("the test's tactic did not put the opponent's Neurosis into play");
  }
});

clause(NEUROSIS, "1:rule", "other resources entering play, or Neurosis leaving play, cost no influence", () => {
  const { engine, id } = neurosisBoard(
    [
      { key: "n", def: printing(NEUROSIS), owner: P1, zone: "play" },
      { key: "other", def: resourceCard({ name: "Other" }), owner: P1, zone: "hand" },
      { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }
    ],
    { influence: 20 }
  );
  developResource(engine, P1, id("other"), false);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(influenceOf(engine, P1), 20, "another resource entering play");
  useOn({ engine, id }, "mv", "n");
  assert.equal(zoneOf(engine, id("n")), "hand", "control: Neurosis left play");
  assert.equal(influenceOf(engine, P1), 20, "leaving play");
});

clause(NEUROSIS, "1:rule", "at 1 influence the loss takes my faction to 0 and I lose the game", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" }], { influence: 1 });
  developResource(engine, P1, id("n"), false);
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P1), 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "my faction is at 0 influence");
});

clause(NEUROSIS, "1:rule", "it has no threshold, and as a resource it cannot be deployed from hand with playCard (CR 203.1): only the develop rule plays it", () => {
  const { engine, id } = neurosisBoard([{ key: "n", def: printing(NEUROSIS), owner: P1, zone: "hand" }], { influence: 20 });
  const playability = engine.getCardPlayability(P1, id("n"));
  assert.equal(playability.thresholdMet, true, "no threshold");
  refused(() => playRaw(engine, P1, id("n")), "a resource cannot be deployed with playCard (CR 203.1)");
  assert.equal(zoneOf(engine, id("n")), "hand");
  assert.equal(influenceOf(engine, P1), 20);
});

// --- Obscene Communion ---------------------------------------------------------
// At the start of each player's turn, that player chooses one of the following:
// OPTION 1 -- Both players draw a card. Both players put a card from their hand
//   on the bottom of their deck.
// OPTION 2 -- Both players put a resource they control into its owner's hand.
//   Both players may play a resource.
// OPTION 3 -- Both players discard a card.
// OPTION 4 -- Both players put a card from their hand on the top of their deck.
// Item, cost 2, [O][O].

const COMMUNION = "604a992d-9d16-41db-b9f7-7face9e9a3da";

interface CommunionOpts {
  /** Whose turn is about to start: the other player ends theirs. */
  starter?: PlayerId;
  controller?: PlayerId;
  zone?: "play" | "hand";
  hand?: [number, number];
  deck?: [number, number];
  resources?: boolean;
  extra?: CardPlacement[];
}

const res = (key: string, owner: PlayerId, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: resourceCard({ name: `Resource ${key}` }),
  owner,
  zone: "play",
  ...extra
});

/** The Communion in play (P1's by default) with hands/decks for both players, stopped just before `starter`'s turn begins. */
function communionBoard(opts: CommunionOpts = {}) {
  const starter = opts.starter ?? P2;
  const [aHand, bHand] = opts.hand ?? [3, 3];
  const [aDeck, bDeck] = opts.deck ?? [4, 4];
  const game = devBoard(
    [
      { key: "comm", def: printing(COMMUNION), owner: opts.controller ?? P1, zone: opts.zone ?? "play" },
      ...fillers("ah", aHand, P1, "hand"),
      ...fillers("bh", bHand, P2, "hand"),
      ...fillers("ad", aDeck, P1, "deck"),
      ...fillers("bd", bDeck, P2, "deck"),
      ...(opts.resources
        ? [
            res("ar1", P1),
            res("ar2", P1),
            res("br1", P2),
            res("br2", P2),
            { key: "ares", def: resourceCard({ name: "AHandRes" }), owner: P1, zone: "hand" as const },
            { key: "bres", def: resourceCard({ name: "BHandRes" }), owner: P2, zone: "hand" as const }
          ]
        : []),
      ...(opts.extra ?? [])
    ],
    starter === P2 ? {} : { turn: 2, activePlayerId: P2 }
  );
  // The Communion triggers at EVERY seat's turn start and "both players" binds the opponent the turn start is about, so at
  // a bigger table the extra seats' own turns (which the two-player game never has) would each raise a four-option prompt
  // for the controller too. These clauses are about the options between the two original players: the extra seats sit out
  // of the turn rotation (multiplayer-tables-saga.test.ts plays it at a real bigger table).
  game.engine.state.turnOrder = game.engine.state.turnOrder.filter((id) => id === P1 || id === P2);
  return game;
}

type CommGame = ReturnType<typeof communionBoard>;

/** Ends the previous player's turn, so `starter`'s turn begins and the Communion raises its choice. */
function beginTurn(game: CommGame, starter: PlayerId = P2): void {
  endTurn(game.engine, starter === P2 ? P1 : P2);
  assert.equal(game.engine.state.activePlayerId, starter, "the turn passed to the starter");
}

/** Asserts the open choice is `kind` and asked of `player`, then answers it. */
function step(game: CommGame, kind: string, player: PlayerId, choice: Record<string, unknown>): void {
  const pc = expectPending(game.engine, kind);
  assert.equal(pc.playerId, player, `${kind} is asked of ${player}`);
  answerPending(game.engine, kind, choice);
}

/** Starts `starter`'s turn and answers the Communion with option `index` (0-3). */
function chooseOption(game: CommGame, index: number, starter: PlayerId = P2): void {
  beginTurn(game, starter);
  step(game, "chooserSelectsOption", starter, { index });
}

const handIds = (game: CommGame, player: PlayerId, prefix: string, n: number): CardInstanceId[] =>
  Array.from({ length: n }, (_, i) => game.id(`${prefix}${i}`));

clause(COMMUNION, "0:rule", "at the start of the OPPONENT's turn, the opponent (the player whose turn it is), not the Communion's controller, chooses among 4 options", () => {
  const game = communionBoard();
  beginTurn(game, P2);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "that player chooses");
  assert.equal(pc.optionCount, 4);
});

clause(COMMUNION, "0:rule", "at the start of MY turn I choose among 4 options", () => {
  const game = communionBoard({ starter: P1 });
  beginTurn(game, P1);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.optionCount, 4);
});

clause(COMMUNION, "0:rule", "a Communion controlled by my opponent still lets ME choose on my own turn ('that player')", () => {
  const game = communionBoard({ starter: P1, controller: P2 });
  beginTurn(game, P1);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the active player chooses, whoever controls the Communion");
  const own = communionBoard({ starter: P2, controller: P2 });
  beginTurn(own, P2);
  assert.equal(expectPending(own.engine, "chooserSelectsOption").playerId, P2);
});

clause(COMMUNION, "0:rule", "there are exactly four options: a fifth (or negative) index is refused, and the choice stays open", () => {
  const game = communionBoard();
  beginTurn(game, P2);
  refused(() => answerPending(game.engine, "chooserSelectsOption", { index: 4 }), "option 5");
  refused(() => answerPending(game.engine, "chooserSelectsOption", { index: -1 }), "option -1");
  if (!game.engine.state.pendingChoice) assert.fail("a refused answer must leave the choice open");
  answerPending(game.engine, "chooserSelectsOption", { index: 3 });
  assert.ok(pending(game.engine), "control: option 4 is accepted (it asks the active player which card)");
});

clause(COMMUNION, "0:rule", "it triggers at the start of every turn, not just the first", () => {
  const game = communionBoard({ hand: [0, 0], deck: [0, 0] });
  beginTurn(game, P2);
  step(game, "chooserSelectsOption", P2, { index: 2 });
  assert.equal(game.engine.state.pendingChoice, undefined);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  step(game, "chooserSelectsOption", P1, { index: 2 });
});

clause(COMMUNION, "0:rule", "it does nothing while the Communion is not in play (in my hand)", () => {
  const game = communionBoard({ zone: "hand" });
  beginTurn(game, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(COMMUNION, "0:rule", "it stops once the Communion has left play", () => {
  const game = communionBoard({ extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  useOn(game, "mv", "comm");
  assert.equal(zoneOf(game.engine, game.id("comm")), "hand", "control: it left play");
  beginTurn(game, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(COMMUNION, "0:rule", "two Communions each ask: the active player makes two choices", () => {
  const game = communionBoard({ extra: [{ key: "comm2", def: printing(COMMUNION), owner: P1, zone: "play" }] });
  beginTurn(game, P2);
  const seen: string[] = [];
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 20) {
    const pc = pending(game.engine)!;
    if (pc.kind === "orderTriggers") {
      // two triggers from the same player: any order will do
      answerPending(game.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    } else if (pc.kind === "chooserSelectsOption") {
      seen.push(pc.playerId);
      answerPending(game.engine, "chooserSelectsOption", { index: 2 }); // OPTION 3: both discard
    } else {
      // each player is asked which card to discard: their own first card
      answerPending(game.engine, "chooserSelectsTarget", { selected: [handOf(game.engine, pc.playerId as PlayerId)[0]] });
    }
  }
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.deepEqual(seen, [P2, P2], "the active player chose twice, once per Communion");
  assert.equal(handOf(game.engine, P1).length, 1, "two rounds of 'both discard': 3 - 2");
  assert.equal(handOf(game.engine, P2).length, 1);
});

// OPTION 1

clause(COMMUNION, "1:option:OPTION 1", "both players draw the top card of their deck and then put a chosen card from their hand on the bottom of their deck (active player first)", () => {
  const game = communionBoard();
  const { engine, id } = game;
  const aTop = deckOf(engine, P1)[0];
  const bTop = deckOf(engine, P2)[0];
  chooseOption(game, 0);
  // the active player (P2) is asked first
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the active player acts first (CR 402.2)");
  assert.equal(handOf(engine, P2).length, 4, "P2 has drawn");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bh1")] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ah2")] });
  assert.equal(engine.state.pendingChoice, undefined);

  assert.equal(handOf(engine, P1).length, 3, "drew one, bottomed one");
  assert.equal(handOf(engine, P2).length, 3);
  assert.ok(handOf(engine, P1).includes(aTop), "P1's hand holds the card from the top of P1's deck");
  assert.ok(handOf(engine, P2).includes(bTop), "P2's hand holds the card from the top of P2's deck");
  assert.equal(handOf(engine, P1).includes(id("ah2")), false);
  assert.equal(handOf(engine, P2).includes(id("bh1")), false);
  assert.equal(deckOf(engine, P1).length, 4, "decks are back to their old size");
  assert.equal(deckOf(engine, P2).length, 4);
  assert.equal(deckOf(engine, P1)[3], id("ah2"), "bottom of P1's deck");
  assert.equal(deckOf(engine, P2)[3], id("bh1"), "bottom of P2's deck");
  assert.equal(discardOf(engine, P1).length + discardOf(engine, P2).length, 0, "nothing was discarded");
});

clause(COMMUNION, "1:option:OPTION 1", "on my own turn, I (active) draw and bottom first", () => {
  const game = communionBoard({ starter: P1 });
  const { engine, id } = game;
  chooseOption(game, 0, P1);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the active player acts first");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("ah0")] });
  step(game, "chooserSelectsTarget", P2, { selected: [id("bh0")] });
  assert.equal(deckOf(engine, P1)[3], id("ah0"));
  assert.equal(deckOf(engine, P2)[3], id("bh0"));
});

clause(COMMUNION, "1:option:OPTION 1", "the card put on the bottom can be the card just drawn", () => {
  const game = communionBoard();
  const { engine, id } = game;
  const bTop = deckOf(engine, P2)[0];
  const aTop = deckOf(engine, P1)[0];
  chooseOption(game, 0);
  step(game, "chooserSelectsTarget", P2, { selected: [bTop] });
  step(game, "chooserSelectsTarget", P1, { selected: [aTop] });
  assert.deepEqual(handOf(engine, P2), handIds(game, P2, "bh", 3), "P2's hand is exactly as before");
  assert.deepEqual(handOf(engine, P1), handIds(game, P1, "ah", 3), "P1's hand is exactly as before");
  assert.equal(deckOf(engine, P2)[3], bTop, "the drawn card went straight to the bottom");
  assert.equal(deckOf(engine, P1)[3], aTop);
  assert.deepEqual(handOf(engine, P1).includes(id("ad0")), false);
});

clause(COMMUNION, "1:option:OPTION 1", "each player puts a card from THEIR OWN hand: the other player's hand card is refused", () => {
  const game = communionBoard();
  const { engine, id } = game;
  chooseOption(game, 0);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ah0")] }), "the other player's hand card");
  if (!engine.state.pendingChoice) assert.fail("the refused answer must leave the choice standing");
  assert.equal(zoneOf(engine, id("ah0")), "hand", "P1's hand card was not touched");
});

clause(COMMUNION, "1:option:OPTION 1", "each player puts a card from THEIR OWN hand: cards in play are refused, and the put is mandatory", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 0);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("br1")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "putting nothing");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("bh0"), id("bh1")] }), "putting two cards");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the choice standing");
  assert.equal(handOf(engine, P2).length, 5, "nothing moved while answers were refused (3 + resource + drawn)");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bh0")] });
  assert.equal(deckOf(engine, P2)[deckOf(engine, P2).length - 1], id("bh0"), "control: a card from my own hand is accepted");
});

clause(COMMUNION, "1:option:OPTION 1", "with an empty deck a player draws nothing but still has to put a card on the bottom", () => {
  const game = communionBoard({ deck: [0, 0] });
  const { engine, id } = game;
  chooseOption(game, 0);
  step(game, "chooserSelectsTarget", P2, { selected: [id("bh0")] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ah0")] });
  assert.equal(handOf(engine, P2).length, 2, "no draw, one card put away");
  assert.equal(handOf(engine, P1).length, 2);
  assert.deepEqual(deckOf(engine, P2), [id("bh0")]);
  assert.deepEqual(deckOf(engine, P1), [id("ah0")]);
});

clause(COMMUNION, "1:option:OPTION 1", "a player with an empty hand and empty deck has nothing to draw or put: no prompt for them", () => {
  const game = communionBoard({ hand: [0, 3], deck: [0, 4] });
  const { engine, id } = game;
  chooseOption(game, 0);
  step(game, "chooserSelectsTarget", P2, { selected: [id("bh0")] });
  assert.equal(engine.state.pendingChoice, undefined, "P1 has no cards to put away: nothing is asked of them");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(handOf(engine, P2).length, 3);
});

clause(COMMUNION, "1:option:OPTION 1", "an empty hand but a stocked deck: the player draws and then must put that card (or any card) away", () => {
  const game = communionBoard({ hand: [0, 3], deck: [4, 4] });
  const { engine, id } = game;
  const aTop = deckOf(engine, P1)[0];
  chooseOption(game, 0);
  step(game, "chooserSelectsTarget", P2, { selected: [id("bh0")] });
  step(game, "chooserSelectsTarget", P1, { selected: [aTop] });
  assert.equal(handOf(engine, P1).length, 0, "drew the top card and put it on the bottom");
  assert.equal(deckOf(engine, P1)[3], aTop);
});

// OPTION 2

clause(COMMUNION, "2:option:OPTION 2", "both players put a resource they control into its owner's hand (active player first); the other resources stay", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 1);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the active player puts first");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("br1")] });
  // the "may play a resource" question for P2, then P1's own put
  step(game, "chooserSelectsTarget", P2, { selected: [] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ar2")] });
  step(game, "chooserSelectsTarget", P1, { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);

  assert.equal(zoneOf(engine, id("br1")), "hand");
  assert.ok(handOf(engine, P2).includes(id("br1")), "to its owner's hand");
  assert.equal(zoneOf(engine, id("ar2")), "hand");
  assert.ok(handOf(engine, P1).includes(id("ar2")), "handOf(engine, P1).includes(id(\"ar2\"))");
  assert.equal(zoneOf(engine, id("br2")), "play", "the other resources stay");
  assert.equal(zoneOf(engine, id("ar1")), "play");
});

clause(COMMUNION, "2:option:OPTION 2", "each player picks only a resource THEY control: the other player's resource is refused", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 1);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ar1")] }), "the other player's resource");
  if (!engine.state.pendingChoice) assert.fail("the refused answer must leave the choice standing");
  assert.equal(zoneOf(engine, id("ar1")), "play", "P1's resource was not touched");
});

clause(COMMUNION, "2:option:OPTION 2", "each player picks only a resource: a non-resource, a card in hand and two resources are refused", () => {
  const game = communionBoard({
    resources: true,
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  const { engine, id } = game;
  chooseOption(game, 1);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("thing")] }), "an item");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] }), "a character");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("bres")] }), "a resource card in hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("br1"), id("br2")] }), "two resources");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the choice standing");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("br2")] });
  assert.equal(zoneOf(engine, id("br2")), "hand", "control: my own resource is accepted");
});

clause(COMMUNION, "2:option:OPTION 2", "a face-down card is a resource, so it can be the one put into its owner's hand", () => {
  const game = communionBoard({
    resources: false,
    extra: [{ key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true }]
  });
  chooseOption(game, 1);
  step(game, "chooserSelectsTarget", P2, { selected: [game.id("fd")] });
  assert.equal(zoneOf(game.engine, game.id("fd")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("fd")), "handOf(game.engine, P2).includes(game.id(\"fd\"))");
});

clause(COMMUNION, "2:option:OPTION 2", "'put a resource they control into its owner's hand' is not a 'may': a player who controls a resource cannot decline to put one", () => {
  const game = communionBoard({ resources: true });
  chooseOption(game, 1);
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [] }), "putting no resource into hand when I control resources");
  assert.ok(game.engine.state.pendingChoice, "the instruction stands");
});

clause(COMMUNION, "2:option:OPTION 2", "a resource I control but my opponent owns goes to ITS OWNER's hand; one I own but they control can be picked by them and comes back to my hand", () => {
  const game = communionBoard({
    resources: false,
    extra: [
      res("capturedByP2", P1, { controller: P2 }), // P1 owns it, P2 controls it
      res("capturedByP1", P2, { controller: P1 }) // P2 owns it, P1 controls it
    ]
  });
  chooseOption(game, 1);
  step(game, "chooserSelectsTarget", P2, { selected: [game.id("capturedByP2")] });
  step(game, "chooserSelectsTarget", P2, { selected: [] });
  step(game, "chooserSelectsTarget", P1, { selected: [game.id("capturedByP1")] });
  step(game, "chooserSelectsTarget", P1, { selected: [] });
  assert.ok(handOf(game.engine, P1).includes(game.id("capturedByP2")), "back to its owner, P1");
  assert.ok(handOf(game.engine, P2).includes(game.id("capturedByP1")), "back to its owner, P2");
});

clause(COMMUNION, "2:option:OPTION 2", "a player who controls no resource has nothing to put into hand (no pick is asked of them) but is still offered the play", () => {
  const game = communionBoard({ resources: false, extra: [{ key: "bres", def: resourceCard({ name: "BHandRes" }), owner: P2, zone: "hand" }] });
  chooseOption(game, 1);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "straight to the 'may play a resource' question (an optional pick from hand): there was nothing to put into hand");
});

/** Answers whatever the engine asks for 'play a resource': say yes, pick the first resource card in hand, face-up when asked. */
const playTheResource = (game: CommGame) => (pc: PendingChoiceLike): unknown => {
  if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
  if (pc.kind === "chooserSelectsTarget") {
    const owner = pc.playerId as PlayerId;
    const resource = handOf(game.engine, owner).find((c) => game.engine.getDefinition(c).type === "resource");
    return { kind: "chooserSelectsTarget", selected: resource ? [resource] : [] };
  }
  return declineAll(pc);
};

clause(COMMUNION, "2:option:OPTION 2", "'Both players may play a resource': a player who says yes actually plays a resource from their hand into play", () => {
  const game = communionBoard({ resources: false, extra: [{ key: "bres", def: resourceCard({ name: "BHandRes" }), owner: P2, zone: "hand" }] });
  chooseOption(game, 1);
  // P2 controls no resource, so the first question is "may you play a resource?"
  drain(game.engine, playTheResource(game));
  assert.equal(zoneOf(game.engine, game.id("bres")), "play", "the resource card from P2's hand is now in play");
  assert.equal(game.engine.state.cards[game.id("bres")].controllerId, P2);
});

clause(COMMUNION, "2:option:OPTION 2", "'Both players may play a resource': the resource just put into hand can be played again, and playing it does not use up the Develop Rule", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 1);
  step(game, "chooserSelectsTarget", P2, { selected: [id("br1")] });
  // yes, play a resource: pick one of the resource cards in P2's hand ("bres" or the freshly bounced one)
  drain(
    engine,
    (pc) => {
      if (pc.playerId === P2) return playTheResource(game)(pc);
      // P1's mandatory "put a resource into hand" needs a real pick; P1's later optional play is declined
      const declId = (pc as unknown as { declaration?: { id?: string } }).declaration?.id;
      if (pc.kind === "chooserSelectsTarget" && declId === "r") return { kind: "chooserSelectsTarget", selected: [id("ar1")] };
      return declineAll(pc);
    },
    6
  );
  const played = [id("br1"), id("bres")].filter((c) => zoneOf(engine, c) === "play");
  assert.equal(played.length, 1, "P2 played exactly one resource card from hand into play");
  assert.ok(developOffers(engine, P2).length > 0, "playing a resource with an effect does not use the Develop Rule");
});

clause(COMMUNION, "2:option:OPTION 2", "'may': each player can decline to play a resource, and then nothing enters play", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 1);
  step(game, "chooserSelectsTarget", P2, { selected: [id("br1")] });
  step(game, "chooserSelectsTarget", P2, { selected: [] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ar1")] });
  step(game, "chooserSelectsTarget", P1, { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  for (const key of ["br1", "bres", "ar1", "ares"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
});

// OPTION 3

clause(COMMUNION, "3:option:OPTION 3", "both players discard a card of their own choice from their hand (active player first), exactly one each", () => {
  const game = communionBoard();
  const { engine, id } = game;
  chooseOption(game, 2);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the active player discards first");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bh2")] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ah1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(engine, P2), [id("bh2")]);
  assert.deepEqual(discardOf(engine, P1), [id("ah1")]);
  assert.deepEqual(handOf(engine, P2), [id("bh0"), id("bh1")]);
  assert.deepEqual(handOf(engine, P1), [id("ah0"), id("ah2")]);
  assert.equal(deckOf(engine, P1).length + deckOf(engine, P2).length, 8, "decks untouched");
});

clause(COMMUNION, "3:option:OPTION 3", "each discards only from their own hand: the other player's hand card is refused", () => {
  const game = communionBoard();
  const { engine, id } = game;
  chooseOption(game, 2);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ah0")] }), "the other player's hand card");
  if (!engine.state.pendingChoice) assert.fail("the refused answer must leave the choice standing");
  assert.equal(zoneOf(engine, id("ah0")), "hand", "P1's hand card was not discarded");
});

clause(COMMUNION, "3:option:OPTION 3", "each discards only from their own hand: cards in play are refused, and the discard is mandatory", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 2);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("br1")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "discarding nothing");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("bh0"), id("bh1")] }), "discarding two");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the choice standing");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bres")] });
  assert.equal(zoneOf(engine, id("bres")), "discard", "control: a card from my own hand is accepted");
});

clause(COMMUNION, "3:option:OPTION 3", "a player with an empty hand discards nothing and is not asked; the other still discards", () => {
  const game = communionBoard({ hand: [0, 3] });
  chooseOption(game, 2);
  step(game, "chooserSelectsTarget", P2, { selected: [game.id("bh0")] });
  assert.equal(game.engine.state.pendingChoice, undefined, "P1 has no hand: nothing is asked of them");
  assert.equal(discardOf(game.engine, P1).length, 0);
  assert.equal(discardOf(game.engine, P2).length, 1);
});

clause(COMMUNION, "3:option:OPTION 3", "when the ACTIVE player has an empty hand, they are not asked and only the other player discards", () => {
  const game = communionBoard({ hand: [3, 0] });
  chooseOption(game, 2);
  step(game, "chooserSelectsTarget", P1, { selected: [game.id("ah0")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(discardOf(game.engine, P1).length, 1);
  assert.equal(discardOf(game.engine, P2).length, 0);
});

// OPTION 4

clause(COMMUNION, "4:option:OPTION 4", "both players put a chosen card from their hand on TOP of their deck (active player first)", () => {
  const game = communionBoard();
  const { engine, id } = game;
  const aDeck = deckOf(engine, P1);
  const bDeck = deckOf(engine, P2);
  chooseOption(game, 3);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the active player puts first");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bh1")] });
  step(game, "chooserSelectsTarget", P1, { selected: [id("ah2")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P2), [id("bh1"), ...bDeck], "on top of P2's deck, rest in order");
  assert.deepEqual(deckOf(engine, P1), [id("ah2"), ...aDeck], "on top of P1's deck");
  assert.deepEqual(handOf(engine, P2), [id("bh0"), id("bh2")]);
  assert.deepEqual(handOf(engine, P1), [id("ah0"), id("ah1")]);
  assert.equal(discardOf(engine, P1).length + discardOf(engine, P2).length, 0);
});

clause(COMMUNION, "4:option:OPTION 4", "each puts only a card from THEIR OWN hand: the other player's hand card is refused", () => {
  const game = communionBoard();
  const { engine, id } = game;
  chooseOption(game, 3);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ah0")] }), "the other player's hand card");
  if (!engine.state.pendingChoice) assert.fail("the refused answer must leave the choice standing");
  assert.equal(zoneOf(engine, id("ah0")), "hand", "P1's hand card was not touched");
});

clause(COMMUNION, "4:option:OPTION 4", "each puts only a card from THEIR OWN hand: cards in play are refused, and it is mandatory", () => {
  const game = communionBoard({ resources: true });
  const { engine, id } = game;
  chooseOption(game, 3);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("br1")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "putting nothing");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("bh0"), id("bh1")] }), "putting two");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the choice standing");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("bres")] });
  assert.equal(deckOf(engine, P2)[0], id("bres"), "control: a card from my own hand is accepted");
});

clause(COMMUNION, "4:option:OPTION 4", "a player with an empty hand puts nothing and is not asked", () => {
  const game = communionBoard({ hand: [0, 3] });
  chooseOption(game, 3);
  step(game, "chooserSelectsTarget", P2, { selected: [game.id("bh0")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(game.engine, P1).length, 4, "P1's deck is unchanged");
  assert.equal(deckOf(game.engine, P2).length, 5);
});

clause(COMMUNION, "4:option:OPTION 4", "the put-back card is drawn next: it is the top card of the deck", () => {
  const game = communionBoard({ starter: P1 });
  const { engine, id } = game;
  chooseOption(game, 3, P1);
  step(game, "chooserSelectsTarget", P1, { selected: [id("ah1")] });
  step(game, "chooserSelectsTarget", P2, { selected: [id("bh2")] });
  assert.equal(deckOf(engine, P1)[0], id("ah1"));
  assert.equal(deckOf(engine, P2)[0], id("bh2"));
});

clause(COMMUNION, "2:option:OPTION 2", "a resource that is spent (attached to the faction) can still be the one put into hand", () => {
  const game = communionBoard({
    resources: false,
    extra: [res("spent", P2, { attachedToKey: "__factionB" }), res("free", P2)]
  });
  chooseOption(game, 1);
  step(game, "chooserSelectsTarget", P2, { selected: [game.id("spent")] });
  assert.equal(zoneOf(game.engine, game.id("spent")), "hand");
  assert.equal(game.engine.state.cards[game.id("spent")].attachedTo, undefined, "it left play, so it is no longer attached");
});

// --- Obscure -------------------------------------------------------------------
// COST: Pick a character. -- EFFECT: This turn, the character gains COVERT.
// FLIP UP: 2 [O]
// Tactic, cost 0, [O].

const OBSCURE = "a71e2b60-e5b7-4c2a-ad73-027bc4ece93d";

function obscureBoard(opts: { obsession?: number; greed?: number; turn?: number; zone?: "hand" | "play"; faceDown?: boolean; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "ob", def: printing(OBSCURE), owner: P1, zone: opts.zone ?? "hand", faceDown: opts.faceDown },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 1, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1 }
  );
}

clause(OBSCURE, "0:ability", "costs nothing but [O]: the picked character gains COVERT, no other character does, and the tactic ends in my discard pile", () => {
  const { engine, id } = obscureBoard({ obsession: 1 });
  const before = ready(engine);
  play(engine, P1, id("ob"), { selected: { c: [id("mine")] } });
  assert.equal(ready(engine), before, "printed cost 0: nothing is paid");
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "the picked character gains COVERT");
  assert.equal(engine.getKeywords(id("other")).includes("covert"), false, "another of my characters does not");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false, "an opponent's character does not");
  assert.equal(zoneOf(engine, id("ob")), "discard");
});

clause(OBSCURE, "0:ability", "'a character': it can pick an opponent's character, which gains COVERT", () => {
  const { engine, id } = obscureBoard();
  play(engine, P1, id("ob"), { selected: { c: [id("foe")] } });
  assert.ok(engine.getKeywords(id("foe")).includes("covert"), "engine.getKeywords(id(\"foe\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false);
});

clause(OBSCURE, "0:ability", "a character that already has COVERT still has exactly one COVERT (CR 507.3e)", () => {
  const { engine, id } = obscureBoard({ extra: [{ key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }] });
  play(engine, P1, id("ob"), { selected: { c: [id("sneak")] } });
  assert.equal(engine.getKeywords(id("sneak")).filter((k) => k === "covert").length, 1);
});

clause(OBSCURE, "0:ability", "the granted COVERT is real: a party of only the picked character cannot be blocked by a non-covert character", () => {
  const plain = obscureBoard({ turn: 2 });
  declareAttackBy(plain.engine, P1, [plain.id("mine")]);
  declareBlockers(plain.engine, P2, [plain.id("foe")]);
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("foe")], "control: without Obscure a plain character can block");

  const { engine, id } = obscureBoard({ turn: 2 });
  play(engine, P1, id("ob"), { selected: { c: [id("mine")] } });
  declareAttackBy(engine, P1, [id("mine")]);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "a non-covert character cannot block a covert party");
});

clause(OBSCURE, "0:ability", "COVERT lasts this turn only: it is gone once the turn ends", () => {
  const { engine, id } = obscureBoard();
  play(engine, P1, id("ob"), { selected: { c: [id("mine")] } });
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false, "gone when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getKeywords(id("mine")).includes("covert"), false, "and it does not come back on my next turn");
});

clause(OBSCURE, "0:ability", "a covert character may block only covert parties (CR 507.3c): played in response to a plain attack, the gained COVERT stops my character from blocking it", () => {
  const { engine, id } = devBoard(
    [
      { key: "ob", def: printing(OBSCURE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", life: 3 }), owner: P2, zone: "play" },
      ...bank("obsession", 1, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1, "I may respond to the attack");
  playRaw(engine, P1, id("ob"), { selected: { c: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "control: it gained COVERT in response");
  refused(() => declareBlockers(engine, P1, [id("mine")]), "a covert character cannot block a plain attacker");
});

clause(OBSCURE, "0:ability", "needs [O] as its threshold: five Greed and no Obsession is refused; one Obsession is enough", () => {
  const bad = obscureBoard({ obsession: 0, greed: 5 });
  refused(() => playRaw(bad.engine, P1, bad.id("ob"), { selected: { c: [bad.id("mine")] } }), "no [O]");
  assert.equal(zoneOf(bad.engine, bad.id("ob")), "hand");
  const good = obscureBoard({ obsession: 1, greed: 0 });
  play(good.engine, P1, good.id("ob"), { selected: { c: [good.id("mine")] } });
  assert.ok(good.engine.getKeywords(good.id("mine")).includes("covert"), "good.engine.getKeywords(good.id(\"mine\")).includes(\"covert\")");
  const noResources = obscureBoard({ obsession: 0, greed: 0 });
  refused(() => playRaw(noResources.engine, P1, noResources.id("ob"), { selected: { c: [noResources.id("mine")] } }), "no resources at all");
});

clause(OBSCURE, "0:ability", "a face-down resource's Volition does not meet [O], and my opponent's Obsession does not either", () => {
  const faceDownOnly = obscureBoard({ obsession: 0, extra: [...volition(4, P1)] });
  refused(() => playRaw(faceDownOnly.engine, P1, faceDownOnly.id("ob"), { selected: { c: [faceDownOnly.id("mine")] } }), "only Volition");
  const theirs = obscureBoard({ obsession: 0, extra: [...bank("obsession", 3, P2)] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("ob"), { selected: { c: [theirs.id("mine")] } }), "their [O]");
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(OBSCURE, "0:ability", `cannot pick ${why}`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = obscureBoard({ extra: extras() });
    refused(() => playRaw(bad.engine, P1, bad.id("ob"), { selected: { c: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("ob")), "hand", "the tactic was not played");
    const good = obscureBoard({ extra: extras() });
    play(good.engine, P1, good.id("ob"), { selected: { c: [good.id("mine")] } });
    assert.ok(good.engine.getKeywords(good.id("mine")).includes("covert"), "control: a character pick works");
  });
}

clause(OBSCURE, "0:ability", "cannot pick a faction, and needs exactly one pick", () => {
  const bad = obscureBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("ob"), { selected: { c: [bad.engine.state.players[P2].factionId!] } }), "a faction");
  refused(() => playRaw(bad.engine, P1, bad.id("ob"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("ob"), { selected: { c: [bad.id("mine"), bad.id("other")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("ob")), "hand");
});

// FLIP UP

const flipUpBoard = (opts: { obsession?: number; rage?: number; faceDown?: boolean; zone?: "hand" | "play"; turn?: number; active?: PlayerId; oppObsession?: number } = {}) =>
  devBoard(
    [
      { key: "ob", def: printing(OBSCURE), owner: P1, zone: opts.zone ?? "play", faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown ?? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("obsession", opts.oppObsession ?? 0, P2)
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );

function flipUpWithPick(game: ReturnType<typeof flipUpBoard>, pickKey = "mine", player: PlayerId = P1): void {
  flipUpNow(game.engine, { type: "flipUp", playerId: player, cardId: game.id("ob"), selected: { c: [game.id(pickKey)] }, variables: {} });
}

clause(OBSCURE, "1:flipUp", "flipping up a face-down Obscure pays exactly 2, then it does its text: the picked character gains COVERT and the tactic goes to my discard pile", () => {
  const game = flipUpBoard({ obsession: 1, rage: 3 });
  const { engine, id } = game;
  assert.equal(ready(engine), 5, "4 banks and the face-down Obscure itself");
  flipUpWithPick(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.ok(engine.getKeywords(id("mine")).includes("covert"), "the picked character gained COVERT");
  assert.equal(engine.getKeywords(id("foe")).includes("covert"), false);
  assert.equal(zoneOf(engine, id("ob")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.equal(ready(engine), 2, "5 resources: 2 paid, and the face-down card is no longer one (5 - 2 - 1)");
});

clause(OBSCURE, "1:flipUp", "the Obscure may pay for its own FLIP UP (CR 507.4b): one [O] bank plus the face-down card itself is exactly enough", () => {
  const game = flipUpBoard({ obsession: 1 });
  flipUpWithPick(game);
  resolvePendingResponses(game.engine);
  assert.ok(game.engine.getKeywords(game.id("mine")).includes("covert"), "game.engine.getKeywords(game.id(\"mine\")).includes(\"covert\")");
  assert.equal(zoneOf(game.engine, game.id("ob")), "discard");
  assert.equal(ready(game.engine), 0);
});

clause(OBSCURE, "1:flipUp", "is refused one resource short: the face-down Obscure alone cannot pay 2", () => {
  const game = flipUpBoard({ obsession: 0 });
  assert.equal(ready(game.engine), 1);
  refused(() => flipUpWithPick(game), "only 1 resource");
  assert.equal(game.engine.state.cards[game.id("ob")].faceDown, true, "still face-down");
  assert.equal(zoneOf(game.engine, game.id("ob")), "play");
});

clause(OBSCURE, "1:flipUp", "needs [O]: plenty of Rage and no Obsession is refused", () => {
  const game = flipUpBoard({ obsession: 0, rage: 6 });
  refused(() => flipUpWithPick(game), "no [O]");
  assert.equal(game.engine.state.cards[game.id("ob")].faceDown, true);
  assert.equal(ready(game.engine), 7, "nothing was paid");
});

clause(OBSCURE, "1:flipUp", "my opponent's Obsession does not meet [O]", () => {
  const game = flipUpBoard({ obsession: 0, rage: 3, oppObsession: 4 });
  refused(() => flipUpWithPick(game), "their [O]");
  assert.equal(game.engine.state.cards[game.id("ob")].faceDown, true);
});

clause(OBSCURE, "1:flipUp", "a face-down Obscure's own Volition is not [O]", () => {
  const game = flipUpBoard({ obsession: 0, rage: 1 });
  refused(() => flipUpWithPick(game), "Volition only");
  assert.equal(game.engine.state.cards[game.id("ob")].faceDown, true);
});

clause(OBSCURE, "1:flipUp", "the flip-up still needs the card's pick ('Pick a character'): none, two, an item or a faction is refused", () => {
  const make = () => flipUpBoard({ obsession: 1, rage: 1, });
  const none = make();
  refused(() => flipUpNow(none.engine, { type: "flipUp", playerId: P1, cardId: none.id("ob"), selected: { c: [] }, variables: {} }), "no pick");
  assert.equal(none.engine.state.cards[none.id("ob")].faceDown, true);
  assert.equal(ready(none.engine), 3, "nothing was paid");
  const two = make();
  refused(
    () => flipUpNow(two.engine, { type: "flipUp", playerId: P1, cardId: two.id("ob"), selected: { c: [two.id("mine"), two.id("foe")] }, variables: {} }),
    "two picks"
  );
  const faction = make();
  refused(
    () => flipUpNow(faction.engine, { type: "flipUp", playerId: P1, cardId: faction.id("ob"), selected: { c: [faction.engine.state.players[P2].factionId!] }, variables: {} }),
    "a faction"
  );
  const good = make();
  flipUpWithPick(good);
  resolvePendingResponses(good.engine);
  assert.ok(good.engine.getKeywords(good.id("mine")).includes("covert"), "control: a character pick works");
});

clause(OBSCURE, "1:flipUp", "it is not deployed from the hand: FLIP UP works only on a face-down Obscure I control in play (not face-up, not in hand, not the opponent's)", () => {
  const faceUp = flipUpBoard({ obsession: 2, faceDown: false });
  refused(() => flipUpWithPick(faceUp), "already face-up");
  const inHand = flipUpBoard({ obsession: 2, zone: "hand" });
  refused(() => flipUpWithPick(inHand), "in hand");
  const theirs = flipUpBoard({ obsession: 2 });
  refused(() => flipUpWithPick(theirs, "mine", P2), "only its controller");
  assert.equal(theirs.engine.state.cards[theirs.id("ob")].faceDown, true);
});

clause(OBSCURE, "1:flipUp", "FLIP UP does not change WHEN a tactic can be played: in response to the opponent's attack I can flip it up", () => {
  const full = devBoard(
    [
      { key: "ob", def: printing(OBSCURE), owner: P1, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", life: 3 }), owner: P2, zone: "play" },
      ...bank("obsession", 1, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(full.engine, P2, [full.id("atk")]);
  assert.equal(full.engine.state.priorityPlayerId, P1);
  flipUpNow(full.engine, { type: "flipUp", playerId: P1, cardId: full.id("ob"), selected: { c: [full.id("mine")] }, variables: {} });
  resolvePendingResponses(full.engine);
  assert.ok(full.engine.getKeywords(full.id("mine")).includes("covert"), "the flipped-up tactic resolved on the opponent's turn");
});

clause(OBSCURE, "1:flipUp", "FLIP UP is an alternative way to play it: from the hand Obscure costs its printed 0 (only [O] needed), flipped up it costs 2", () => {
  const hand = obscureBoard({ obsession: 1 });
  const before = ready(hand.engine);
  play(hand.engine, P1, hand.id("ob"), { selected: { c: [hand.id("mine")] } });
  assert.equal(before - ready(hand.engine), 0, "no resources paid when played from hand");
  const flipped = flipUpBoard({ obsession: 1, rage: 3 });
  const readyBefore = ready(flipped.engine);
  flipUpWithPick(flipped);
  resolvePendingResponses(flipped.engine);
  assert.equal(readyBefore - ready(flipped.engine), 3, "2 paid, plus the face-down card itself stops being a resource");
});

// --- Perturbatious Warlock -----------------------------------------------------
// When this card enters play, your opponent puts a card from their hand on the
// top of their deck.
// Character, cost 2, [O][O], 1 strength / 3 speed / 2 life.

const WARLOCK = "7d385558-dd68-4c00-9c20-0a60daf86d86";

function warlockBoard(opts: { oppHand?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "wl", def: printing(WARLOCK), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...fillers("mh", 2, P1, "hand"),
    ...fillers("md", 2, P1, "deck"),
    ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
    ...fillers("od", 3, P2, "deck"),
    ...bank("obsession", opts.obsession ?? 2, P1),
    ...(opts.extra ?? [])
  ]);
}

clause(WARLOCK, "0:rule", "when it enters play my opponent chooses a card from their hand and puts it on top of their deck", () => {
  const { engine, id } = warlockBoard();
  const myHand = handOf(engine, P1).filter((c) => c !== id("wl"));
  const deck = deckOf(engine, P2);
  const myDeck = deckOf(engine, P1);
  play(engine, P1, id("wl"));
  assert.equal(zoneOf(engine, id("wl")), "play", "control: it entered play");
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses which card");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P2), [id("oh1"), ...deck], "on top of their deck, the rest of the deck in order");
  assert.deepEqual(handOf(engine, P2), [id("oh0"), id("oh2")]);
  assert.deepEqual(handOf(engine, P1), myHand, "my hand is untouched");
  assert.deepEqual(deckOf(engine, P1), myDeck, "my deck is untouched");
  assert.equal(discardOf(engine, P2).length, 0, "it is not a discard");
});

clause(WARLOCK, "0:rule", "the opponent can pick any card of their hand (the last one too)", () => {
  const { engine, id } = warlockBoard();
  play(engine, P1, id("wl"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh2")] });
  assert.equal(deckOf(engine, P2)[0], id("oh2"));
  assert.deepEqual(handOf(engine, P2), [id("oh0"), id("oh1")]);
});

clause(WARLOCK, "0:rule", "exactly one card, from THEIR hand: my hand cards, cards in play and two cards are refused; they cannot decline", () => {
  const { engine, id } = warlockBoard({ extra: [res("br1", P2)] });
  play(engine, P1, id("wl"));
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] }), "a card in MY hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("br1")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mine")] }), "my character");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0"), id("oh1")] }), "two cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "declining");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the instruction standing");
  assert.equal(handOf(engine, P2).length, 3, "nothing moved while answers were refused");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] });
  assert.equal(deckOf(engine, P2)[0], id("oh0"), "control: a legal pick is carried out");
});

clause(WARLOCK, "0:rule", "with a single card in hand they put that card on top of their deck", () => {
  const { engine, id } = warlockBoard({ oppHand: 1 });
  play(engine, P1, id("wl"));
  drain(engine, pickTargets([id("oh0")]));
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(deckOf(engine, P2)[0], id("oh0"));
});

clause(WARLOCK, "0:rule", "with an empty hand nothing happens and nobody is asked", () => {
  const { engine, id } = warlockBoard({ oppHand: 0 });
  const deck = deckOf(engine, P2);
  play(engine, P1, id("wl"));
  assert.equal(zoneOf(engine, id("wl")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P2), deck);
});

clause(WARLOCK, "0:rule", "the put-back card is what they draw next (it is on TOP)", () => {
  const { engine, id } = warlockBoard();
  play(engine, P1, id("wl"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh1")] });
  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);
  developDraw(engine, P2);
  assert.ok(handOf(engine, P2).includes(id("oh1")), "their Develop draw takes the card they put back");
});

clause(WARLOCK, "0:rule", "it triggers when the Warlock is put into play by an effect too (not only when deployed)", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = warlockBoard({ extra: [{ key: "put", def: putter, owner: P1, zone: "hand" }] });
  play(engine, P1, id("put"), { selected: { t: [id("wl")] } });
  assert.equal(zoneOf(engine, id("wl")), "play", "control: it was put into play");
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] });
  assert.equal(deckOf(engine, P2)[0], id("oh0"));
});

clause(WARLOCK, "0:rule", "it is only an enters-play trigger: it does not fire when the Warlock leaves play, nor when another character enters", () => {
  const { engine, id } = warlockBoard({
    extra: [
      { key: "inplay", def: printing(WARLOCK), owner: P1, zone: "play" },
      { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other Newcomer", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  const hand = handOf(engine, P2);
  useOn({ engine, id }, "mv", "inplay");
  assert.equal(zoneOf(engine, id("inplay")), "hand", "control: the Warlock left play");
  assert.equal(engine.state.pendingChoice, undefined, "leaving play asks nothing");
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play", "control: another character entered");
  assert.equal(engine.state.pendingChoice, undefined, "another character entering asks nothing");
  assert.deepEqual(handOf(engine, P2), hand);
});

clause(WARLOCK, "0:rule", "played as a face-down resource it has no rules text, so nothing happens", () => {
  const { engine, id } = warlockBoard();
  developResource(engine, P1, id("wl"), true);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("wl")), "play");
  assert.equal(engine.state.cards[id("wl")].faceDown, true);
  assert.equal(engine.state.pendingChoice, undefined, "no discard-to-deck demand for a face-down resource");
  assert.equal(handOf(engine, P2).length, 3);
});

clause(WARLOCK, "0:rule", "each Warlock that enters asks again: a second one makes them put a second card on top, in order", () => {
  const { engine, id } = warlockBoard({ extra: [{ key: "wl2", def: printing(WARLOCK), owner: P1, zone: "hand" }], obsession: 6 });
  play(engine, P1, id("wl"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] });
  play(engine, P1, id("wl2"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh1")] });
  assert.deepEqual(deckOf(engine, P2).slice(0, 2), [id("oh1"), id("oh0")], "the later card is on top");
  assert.deepEqual(handOf(engine, P2), [id("oh2")]);
});

clause(WARLOCK, "0:rule", "it costs its printed 2 and needs [O][O] (one short, or one [O] only, is refused)", () => {
  const { engine, id } = warlockBoard({ obsession: 2 });
  const before = ready(engine);
  playRaw(engine, P1, id("wl"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  const short = warlockBoard({ obsession: 1 });
  refused(() => playRaw(short.engine, P1, short.id("wl")), "one [O] only");
  assert.equal(zoneOf(short.engine, short.id("wl")), "hand");
  const greed = warlockBoard({ obsession: 1, extra: bank("greed", 5, P1) });
  refused(() => playRaw(greed.engine, P1, greed.id("wl")), "one [O] plus other resources");
});

// --- Reality Shift -------------------------------------------------------------
// X is the total numeric cost of all non-resource cards you control. Put those
// cards into their owner's hand. You may play any number of cards for free with
// total numeric cost X or less. (You still need to meet their threshold and
// satisfy their extra costs.)
// Tactic, cost 7, [O][O][O][O][O].

const RS = "f0a05c35-7828-49ac-8a59-131b8287e02d";

/**
 * Mine in play: Char3 (cost 3), Char4 (cost 4), Item2 (cost 2), Loc1 (cost 1): X = 10.
 * The opponent has Foe5 (cost 5) in play. `obsession` / `greed` are my resources.
 */
function rsBoard(opts: { obsession?: number; greed?: number; withMine?: boolean; extra?: CardPlacement[]; influence?: number; turn?: number; active?: PlayerId } = {}) {
  const mine = opts.withMine ?? true;
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rs", def: printing(RS), owner: P1, zone: "hand" },
      ...(mine
        ? [
            { key: "c3", def: character({ name: "Char3", cost: 3 }), owner: P1, zone: "play" as const },
            { key: "c4", def: character({ name: "Char4", cost: 4 }), owner: P1, zone: "play" as const },
            { key: "i2", def: item({ name: "Item2", cost: 2 }), owner: P1, zone: "play" as const },
            { key: "l1", def: location({ name: "Loc1", cost: 1 }), owner: P1, zone: "play" as const }
          ]
        : []),
      { key: "f5", def: character({ name: "Foe5", cost: 5 }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type RsGame = ReturnType<typeof rsBoard>;

/** Casts Reality Shift (nothing to pick) and lets everything but the free-deploy question resolve. */
function castRS(game: RsGame): void {
  play(game.engine, P1, game.id("rs"));
}

/** Answers the open free-deploy question with `cardId` (omit to decline). */
function deployFree(game: RsGame, cardId?: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  const pc = expectPending(game.engine, "deployForFree");
  game.engine.perform({
    type: "resolvePendingChoice",
    playerId: pc.playerId,
    choice: { kind: "deployForFree", ...(cardId ? { cardId, selected } : {}) }
  } as never);
  resolvePendingResponses(game.engine);
}

/** Casts Reality Shift and declines the free play: just the "put those cards into their owner's hand" part. */
function castAndDecline(game: RsGame): void {
  castRS(game);
  if (pending(game.engine)?.kind === "deployForFree") deployFree(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
}

clause(RS, "0:rule", "casting pays exactly 7 and the tactic ends in my discard pile", () => {
  const game = rsBoard({ obsession: 5, greed: 3 });
  const before = ready(game.engine);
  playRaw(game.engine, P1, game.id("rs"));
  assert.equal(before - ready(game.engine), 7, "the printed cost of 7 is paid");
  resolvePendingResponses(game.engine);
  if (pending(game.engine)?.kind === "deployForFree") deployFree(game);
  assert.equal(zoneOf(game.engine, game.id("rs")), "discard");
});

clause(RS, "0:rule", "is refused one resource short of 7 (six resources, with [O][O][O][O][O] met)", () => {
  const bad = rsBoard({ obsession: 5, greed: 1 });
  assert.equal(ready(bad.engine), 6);
  refused(() => playRaw(bad.engine, P1, bad.id("rs")), "six resources");
  assert.equal(zoneOf(bad.engine, bad.id("rs")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("c3")), "play", "nothing was returned");
  const good = rsBoard({ obsession: 5, greed: 2 });
  castAndDecline(good);
  assert.equal(zoneOf(good.engine, good.id("rs")), "discard", "control: seven resources is enough");
});

clause(RS, "0:rule", "needs [O][O][O][O][O]: four Obsession and plenty of Greed is refused", () => {
  const bad = rsBoard({ obsession: 4, greed: 6 });
  refused(() => playRaw(bad.engine, P1, bad.id("rs")), "four [O]");
  assert.equal(zoneOf(bad.engine, bad.id("rs")), "hand");
  const none = rsBoard({ obsession: 0, greed: 9 });
  refused(() => playRaw(none.engine, P1, none.id("rs")), "no [O]");
});

clause(RS, "0:rule", "face-down resources (Volition) and my opponent's Obsession do not meet the threshold", () => {
  const faceDown = rsBoard({ obsession: 3, greed: 0, extra: volition(6, P1) });
  refused(() => playRaw(faceDown.engine, P1, faceDown.id("rs")), "three [O] plus Volition");
  const theirs = rsBoard({ obsession: 3, greed: 4, extra: bank("obsession", 5, P2) });
  refused(() => playRaw(theirs.engine, P1, theirs.id("rs")), "their [O]");
});

clause(RS, "0:rule", "puts ALL my non-resource cards (characters, items, locations) into their owner's hand", () => {
  const game = rsBoard();
  castAndDecline(game);
  for (const key of ["c3", "c4", "i2", "l1"]) {
    assert.equal(zoneOf(game.engine, game.id(key)), "hand", `${key} returned to hand`);
    assert.ok(handOf(game.engine, P1).includes(game.id(key)), `${key} is in MY hand`);
  }
});

clause(RS, "0:rule", "my resources, face-down cards and my faction stay in play", () => {
  const game = rsBoard({
    extra: [res("keepRes", P1), { key: "fd", def: character({ name: "Face Down", cost: 6 }), owner: P1, zone: "play", faceDown: true }]
  });
  const factionId = game.engine.state.players[P1].factionId!;
  const resourcesBefore = playOf(game.engine, P1).filter((c) => game.engine.isResource(c));
  assert.equal(resourcesBefore.length, 10, "8 banks, the resource and the face-down card");
  castAndDecline(game);
  assert.equal(zoneOf(game.engine, game.id("keepRes")), "play");
  assert.equal(zoneOf(game.engine, game.id("fd")), "play", "a face-down card is a resource");
  assert.equal(game.engine.state.cards[game.id("fd")].faceDown, true);
  assert.equal(zoneOf(game.engine, factionId), "play");
  assert.deepEqual(
    playOf(game.engine, P1).filter((c) => game.engine.isResource(c)).sort(),
    [...resourcesBefore].sort(),
    "every resource is still in play"
  );
});

clause(RS, "0:rule", "my opponent's cards are untouched", () => {
  const game = rsBoard({ extra: [{ key: "foeItem", def: item({ name: "Foe Item", cost: 2 }), owner: P2, zone: "play" }] });
  castAndDecline(game);
  assert.equal(zoneOf(game.engine, game.id("f5")), "play");
  assert.equal(zoneOf(game.engine, game.id("foeItem")), "play");
  assert.equal(handOf(game.engine, P2).length, 0);
});

clause(RS, "0:rule", "'cards you control': a card I control but my opponent owns goes to ITS OWNER's hand; one I own but they control is left alone", () => {
  const game = rsBoard({
    extra: [
      { key: "captured", def: character({ name: "Captured", cost: 2 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 6 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  castAndDecline(game);
  assert.equal(zoneOf(game.engine, game.id("captured")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("captured")), "back to its owner (my opponent)");
  assert.equal(handOf(game.engine, P1).includes(game.id("captured")), false);
  assert.equal(zoneOf(game.engine, game.id("stolen")), "play", "I do not control it");
});

clause(RS, "0:rule", "damage and depletion do not survive the trip: a returned damaged, depleted character comes back clean", () => {
  const game = rsBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", cost: 1, life: 5 }), owner: P1, zone: "play", damage: 2, depleted: true }] });
  castRS(game);
  deployFree(game, game.id("hurt"));
  assert.equal(zoneOf(game.engine, game.id("hurt")), "play", "control: redeployed");
  assert.equal(game.engine.state.cards[game.id("hurt")].damage, 0);
  assert.equal(game.engine.state.cards[game.id("hurt")].depleted, false);
  if (pending(game.engine)) deployFree(game);
});

clause(RS, "0:rule", "X is the total numeric cost of my non-resource cards (10 here): a hand card costing exactly X can be played, one costing X+1 cannot", () => {
  const make = () => rsBoard({ extra: [{ key: "big", def: character({ name: "Big", cost: 10 }), owner: P1, zone: "hand" }, { key: "huge", def: character({ name: "Huge", cost: 11 }), owner: P1, zone: "hand" }] });
  const tooBig = make();
  castRS(tooBig);
  refused(() => deployFree(tooBig, tooBig.id("huge")), "cost 11 > X = 10");
  const exact = make();
  castRS(exact);
  deployFree(exact, exact.id("big"));
  assert.equal(zoneOf(exact.engine, exact.id("big")), "play", "cost 10 <= X = 10");
});

clause(RS, "0:rule", "X counts only MY non-resource cards: not the opponent's (5), not my face-down card (6), not my resources", () => {
  const game = rsBoard({
    withMine: false,
    extra: [
      { key: "only", def: character({ name: "Only", cost: 3 }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down", cost: 6 }), owner: P1, zone: "play", faceDown: true },
      { key: "h4", def: character({ name: "Hand4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "h3", def: character({ name: "Hand3", cost: 3 }), owner: P1, zone: "hand" }
    ]
  });
  castRS(game);
  const tooMuch = rsBoard({
    withMine: false,
    extra: [
      { key: "only", def: character({ name: "Only", cost: 3 }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Face Down", cost: 6 }), owner: P1, zone: "play", faceDown: true },
      { key: "h4", def: character({ name: "Hand4", cost: 4 }), owner: P1, zone: "hand" }
    ]
  });
  castRS(tooMuch);
  refused(() => deployFree(tooMuch, tooMuch.id("h4")), "cost 4 > X = 3");
  deployFree(game, game.id("h3"));
  assert.equal(zoneOf(game.engine, game.id("h3")), "play", "cost 3 <= X = 3");
});

clause(RS, "0:rule", "a card I control but the opponent owns counts toward X (I control it); one I own but they control does not", () => {
  const game = rsBoard({
    withMine: false,
    extra: [
      { key: "captured", def: character({ name: "Captured", cost: 2 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 6 }), owner: P1, controller: P2, zone: "play" },
      { key: "h2", def: character({ name: "Hand2", cost: 2 }), owner: P1, zone: "hand" }
    ]
  });
  castRS(game);
  const over = rsBoard({
    withMine: false,
    extra: [
      { key: "captured", def: character({ name: "Captured", cost: 2 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 6 }), owner: P1, controller: P2, zone: "play" },
      { key: "h3", def: character({ name: "Hand3", cost: 3 }), owner: P1, zone: "hand" }
    ]
  });
  castRS(over);
  refused(() => deployFree(over, over.id("h3")), "cost 3 > X = 2");
  deployFree(game, game.id("h2"));
  assert.equal(zoneOf(game.engine, game.id("h2")), "play", "cost 2 <= X = 2");
});

clause(RS, "0:rule", "the cards just returned can be played again: all four (4+3+2+1 = X = 10) in any order, all free", () => {
  const game = rsBoard({ obsession: 5, greed: 3 });
  castRS(game);
  const readyAfterCast = ready(game.engine);
  for (const key of ["c4", "l1", "c3", "i2"]) deployFree(game, game.id(key));
  for (const key of ["c3", "c4", "i2", "l1"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} is back in play`);
  assert.equal(ready(game.engine), readyAfterCast, "playing them cost nothing");
  assert.equal(game.engine.state.pendingChoice, undefined, "the budget is spent: nothing more is offered");
});

clause(RS, "0:rule", "the budget is shared: after a cost-7 card only X-7 = 3 is left, so a cost-3 card works and a cost-4 card does not", () => {
  const make = () => rsBoard({ extra: [{ key: "seven", def: character({ name: "Seven", cost: 7 }), owner: P1, zone: "hand" }] });
  const over = make();
  castRS(over);
  deployFree(over, over.id("seven"));
  refused(() => deployFree(over, over.id("c4")), "4 > the 3 left");
  const under = make();
  castRS(under);
  deployFree(under, under.id("seven"));
  deployFree(under, under.id("c3"));
  assert.equal(zoneOf(under.engine, under.id("seven")), "play");
  assert.equal(zoneOf(under.engine, under.id("c3")), "play");
  assert.equal(under.engine.state.pendingChoice, undefined, "3 + 7 = 10 = X: nothing is left");
});

clause(RS, "0:rule", "the budget is total cost X OR LESS: you may stop early, and decline entirely", () => {
  const stop = rsBoard();
  castRS(stop);
  deployFree(stop, stop.id("c4"));
  deployFree(stop); // decline the rest
  assert.equal(stop.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(stop.engine, stop.id("c4")), "play");
  assert.equal(zoneOf(stop.engine, stop.id("c3")), "hand", "the others stay in hand");
  const none = rsBoard();
  castRS(none);
  deployFree(none);
  assert.equal(none.engine.state.pendingChoice, undefined);
  for (const key of ["c3", "c4", "i2", "l1"]) assert.equal(zoneOf(none.engine, none.id(key)), "hand", `${key} stays in hand`);
});

clause(RS, "0:rule", "any card in my hand can be played, not only the returned ones; and a tactic works too (its effect resolves)", () => {
  const killer = tactic({
    name: "Costly Kill",
    cost: 3,
    behavior: {
      abilities: [
        {
          id: "ck",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const game = rsBoard({
    extra: [
      { key: "hc", def: character({ name: "Hand Char", cost: 2 }), owner: P1, zone: "hand" },
      { key: "kt", def: killer, owner: P1, zone: "hand" }
    ]
  });
  castRS(game);
  deployFree(game, game.id("hc"));
  assert.equal(zoneOf(game.engine, game.id("hc")), "play", "a character that was already in my hand");
  deployFree(game, game.id("kt"), { t: [game.id("f5")] });
  assert.equal(zoneOf(game.engine, game.id("f5")), "discard", "the tactic resolved against the Foe");
  assert.equal(zoneOf(game.engine, game.id("kt")), "discard");
});

clause(RS, "0:rule", "'for free' really is free: with 1 resource left, a cost-4 character still comes in without paying", () => {
  const game = rsBoard({ obsession: 5, greed: 2 });
  assert.equal(ready(game.engine), 7);
  castRS(game);
  assert.equal(ready(game.engine), 0, "7 paid for Reality Shift, none left");
  deployFree(game, game.id("c4"));
  assert.equal(zoneOf(game.engine, game.id("c4")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(RS, "0:rule", "'You still need to meet their threshold': a returned card whose threshold I do not meet cannot be played; one I do meet can", () => {
  const make = () =>
    rsBoard({
      extra: [
        { key: "rage", def: character({ name: "Needs Rage", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" },
        { key: "greedy", def: character({ name: "Needs Greed", cost: 1, threshold: "ggg" as never }), owner: P1, zone: "hand" }
      ]
    });
  const bad = make();
  castRS(bad);
  refused(() => deployFree(bad, bad.id("rage")), "[R][R] with no Rage");
  assert.equal(zoneOf(bad.engine, bad.id("rage")), "hand");
  const good = make();
  castRS(good);
  deployFree(good, good.id("greedy"));
  assert.equal(zoneOf(good.engine, good.id("greedy")), "play", "[G][G][G] is met by my three Greed");
});

clause(RS, "0:rule", "'satisfy their extra costs': a card with an EXTRA COST of losing 2 influence still costs 2 influence when played free", () => {
  const taxed = () =>
    character({ name: "Taxed", cost: 1, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } });
  const game = rsBoard({ influence: 10, extra: [{ key: "taxed", def: taxed(), owner: P1, zone: "hand" }] });
  castRS(game);
  deployFree(game, game.id("taxed"));
  assert.equal(zoneOf(game.engine, game.id("taxed")), "play");
  assert.equal(influenceOf(game.engine, P1), 8, "the EXTRA COST was paid");
});

clause(RS, "0:rule", "'satisfy their extra costs': a card with an EXTRA COST of 'Pay 2' that I cannot afford (1 resource left) cannot be played free", () => {
  const costly = () =>
    character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const game = rsBoard({ obsession: 5, greed: 3, extra: [{ key: "costly", def: costly(), owner: P1, zone: "hand" }] });
  castRS(game);
  assert.equal(ready(game.engine), 1, "7 of 8 resources were spent on Reality Shift");
  refused(() => deployFree(game, game.id("costly")), "'Pay 2' with only 1 resource ready");
  assert.equal(zoneOf(game.engine, game.id("costly")), "hand");
  assert.equal(ready(game.engine), 1);
});

clause(RS, "0:rule", "'satisfy their extra costs': a card with an EXTRA COST of 'Pay 2' still has to pay those 2 resources when played free (CR 308.1a)", () => {
  const costly = () =>
    character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const game = rsBoard({ obsession: 5, greed: 6, extra: [{ key: "costly", def: costly(), owner: P1, zone: "hand" }] });
  castRS(game);
  const afterCast = ready(game.engine);
  deployFree(game, game.id("costly"));
  assert.equal(zoneOf(game.engine, game.id("costly")), "play");
  assert.equal(afterCast - ready(game.engine), 2, "the printed 'Pay 2' extra cost is still paid; only the card's own cost number is free");
});

clause(RS, "0:rule", "a card played with it is a new arrival: it cannot attack this turn", () => {
  const game = rsBoard();
  castRS(game);
  deployFree(game, game.id("c3"));
  assert.equal(zoneOf(game.engine, game.id("c3")), "play");
  if (pending(game.engine)) deployFree(game);
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("c3")], target: { type: "faction", playerId: P2 } }),
    "a character that just entered play cannot attack",
    /did not start the turn in play/
  );
});

clause(RS, "0:rule", "with no non-resource cards of mine, X is 0: nothing returns, a cost-0 card can be played free, a cost-1 card cannot", () => {
  const make = () =>
    rsBoard({
      withMine: false,
      extra: [
        { key: "zero", def: character({ name: "Zero", cost: 0 }), owner: P1, zone: "hand" },
        { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "hand" }
      ]
    });
  const bad = make();
  castRS(bad);
  refused(() => deployFree(bad, bad.id("one")), "cost 1 > X = 0");
  const good = make();
  castRS(good);
  deployFree(good, good.id("zero"));
  assert.equal(zoneOf(good.engine, good.id("zero")), "play");
  assert.equal(zoneOf(good.engine, good.id("one")), "hand");
});

clause(RS, "0:rule", "it can be cast in response on the opponent's turn: my characters return and I may play cards free right then", () => {
  const game = rsBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", life: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  playRaw(game.engine, P1, game.id("rs"));
  resolvePendingResponses(game.engine);
  for (const key of ["c3", "c4"]) assert.equal(zoneOf(game.engine, game.id(key)), "hand", `${key} returned`);
  deployFree(game, game.id("c4"));
  assert.equal(zoneOf(game.engine, game.id("c4")), "play", "deployed free during the opponent's turn");
});

// --- Rouse ---------------------------------------------------------------------
// COST: Pick a tactic in your discard pile. -- EFFECT: Put the tactic on the top
// of your deck.
// RECUR: [O][O][O] -- COST: Use this only if this card is in your discard pile.
// Pay 1. Remove this card from the game. Pick a tactic in your discard pile. --
// EFFECT: Put the tactic on the top of your deck.
// Tactic, cost 1, [O][O][O].

const ROUSE = "bcd07cb8-7eea-49cf-a528-2efeba8bd486";

function rouseBoard(opts: { rouseZone?: "hand" | "discard" | "play"; rouseOwner?: PlayerId; obsession?: number; greed?: number; spentObsession?: number; extra?: CardPlacement[]; withPast?: boolean } = {}) {
  return devBoard([
    { key: "rouse", def: printing(ROUSE), owner: opts.rouseOwner ?? P1, zone: opts.rouseZone ?? "hand" },
    ...(opts.withPast === false
      ? []
      : [
          { key: "past", def: tactic({ name: "Past Tactic" }), owner: P1, zone: "discard" as const },
          { key: "past2", def: tactic({ name: "Past Tactic Two" }), owner: P1, zone: "discard" as const }
        ]),
    { key: "theirPast", def: tactic({ name: "Their Past Tactic" }), owner: P2, zone: "discard" },
    { key: "handTactic", def: tactic({ name: "Hand Tactic" }), owner: P1, zone: "hand" },
    { key: "deckTactic", def: tactic({ name: "Deck Tactic" }), owner: P1, zone: "deck" },
    { key: "pastChar", def: character({ name: "Past Character" }), owner: P1, zone: "discard" },
    { key: "pastItem", def: item({ name: "Past Item" }), owner: P1, zone: "discard" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...fillers("md", 3, P1, "deck"),
    ...bank("obsession", opts.obsession ?? 3, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.spentObsession ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...(opts.extra ?? [])
  ]);
}

clause(ROUSE, "0:ability", "pays exactly 1, puts the picked tactic from my discard pile on TOP of my deck, and Rouse itself ends in my discard pile", () => {
  const { engine, id } = rouseBoard({ obsession: 3, greed: 2 });
  const deck = deckOf(engine, P1);
  const before = ready(engine);
  playRaw(engine, P1, id("rouse"), { selected: { t: [id("past")] } });
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), [id("past"), ...deck], "on top, the rest of the deck in order");
  assert.equal(zoneOf(engine, id("past")), "deck");
  assert.equal(discardOf(engine, P1).includes(id("past")), false, "it left the discard pile");
  assert.equal(zoneOf(engine, id("rouse")), "discard", "the resolved tactic goes to its owner's discard pile");
  assert.equal(zoneOf(engine, id("past2")), "discard", "the other tactic in the discard pile stays");
});

clause(ROUSE, "0:ability", "the recovered tactic is the next card I draw", () => {
  const { engine, id } = rouseBoard();
  play(engine, P1, id("rouse"), { selected: { t: [id("past2")] } });
  developDraw(engine, P1);
  assert.ok(handOf(engine, P1).includes(id("past2")), "drawn");
});

for (const [key, why] of [
  ["theirPast", "a tactic in MY OPPONENT's discard pile"],
  ["handTactic", "a tactic in my hand"],
  ["deckTactic", "a tactic in my deck"],
  ["pastChar", "a character in my discard pile (not a tactic)"],
  ["pastItem", "an item in my discard pile (not a tactic)"],
  ["mine", "a character in play"]
] as const) {
  clause(ROUSE, "0:ability", `cannot pick ${why}; the card is not played`, () => {
    const bad = rouseBoard();
    const before = ready(bad.engine);
    refused(() => playRaw(bad.engine, P1, bad.id("rouse"), { selected: { t: [bad.id(key)] } }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("rouse")), "hand");
    assert.equal(ready(bad.engine), before, "nothing was paid");
    const good = rouseBoard();
    play(good.engine, P1, good.id("rouse"), { selected: { t: [good.id("past")] } });
    assert.equal(zoneOf(good.engine, good.id("past")), "deck", "control: a tactic in my discard pile works");
  });
}

clause(ROUSE, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const bad = rouseBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("rouse"), { selected: { t: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("rouse"), { selected: { t: [bad.id("past"), bad.id("past2")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "hand");
  assert.equal(zoneOf(bad.engine, bad.id("past")), "discard");
});

clause(ROUSE, "0:ability", "with no tactic in my discard pile it cannot be played at all (the pick is a cost)", () => {
  const bad = rouseBoard({ withPast: false });
  refused(() => playRaw(bad.engine, P1, bad.id("rouse"), { selected: { t: [] } }), "no tactic to pick");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "hand");
  assert.equal(ready(bad.engine), 3);
});

clause(ROUSE, "0:ability", "a second Rouse already in my discard pile is a tactic I can pick", () => {
  const { engine, id } = rouseBoard({ extra: [{ key: "rouse2", def: printing(ROUSE), owner: P1, zone: "discard" }] });
  play(engine, P1, id("rouse"), { selected: { t: [id("rouse2")] } });
  assert.equal(zoneOf(engine, id("rouse2")), "deck");
  assert.equal(deckOf(engine, P1)[0], id("rouse2"));
});

clause(ROUSE, "0:ability", "costs 1: refused with nothing to pay with; and needs [O][O][O] (two [O] plus other resources is refused)", () => {
  const none = rouseBoard({ obsession: 0 });
  refused(() => playRaw(none.engine, P1, none.id("rouse"), { selected: { t: [none.id("past")] } }), "no resources");
  const two = rouseBoard({ obsession: 2, greed: 5 });
  refused(() => playRaw(two.engine, P1, two.id("rouse"), { selected: { t: [two.id("past")] } }), "[O][O] only");
  const noneO = rouseBoard({ obsession: 0, greed: 8 });
  refused(() => playRaw(noneO.engine, P1, noneO.id("rouse"), { selected: { t: [noneO.id("past")] } }), "no [O]");
  const three = rouseBoard({ obsession: 3 });
  play(three.engine, P1, three.id("rouse"), { selected: { t: [three.id("past")] } });
  assert.equal(zoneOf(three.engine, three.id("past")), "deck", "control: [O][O][O] is enough");
});

clause(ROUSE, "0:ability", "one resource short of its cost of 1 (threshold met by spent Obsession) is refused", () => {
  const bad = rouseBoard({ obsession: 0, spentObsession: 3 });
  assert.equal(ready(bad.engine), 0);
  refused(() => playRaw(bad.engine, P1, bad.id("rouse"), { selected: { t: [bad.id("past")] } }), "no ready resource");
  const good = rouseBoard({ obsession: 0, spentObsession: 3, greed: 1 });
  play(good.engine, P1, good.id("rouse"), { selected: { t: [good.id("past")] } });
  assert.equal(zoneOf(good.engine, good.id("past")), "deck", "control: one ready resource is enough");
});

clause(ROUSE, "0:ability", "can be played in response on the opponent's turn (CR 205.1)", () => {
  const game = devBoard(
    [
      { key: "rouse", def: printing(ROUSE), owner: P1, zone: "hand" },
      { key: "past", def: tactic({ name: "Past Tactic" }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...fillers("md", 2, P1, "deck"),
      ...bank("obsession", 3, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playRaw(game.engine, P1, game.id("rouse"), { selected: { t: [game.id("past")] } });
  resolvePendingResponses(game.engine);
  assert.equal(deckOf(game.engine, P1)[0], game.id("past"));
});

// RECUR

clause(ROUSE, "1:ability:recur", "RECUR from my discard pile pays exactly 1, removes Rouse from the game, and puts the picked tactic on top of my deck", () => {
  const { engine, id } = rouseBoard({ rouseZone: "discard", obsession: 3, greed: 2 });
  const deck = deckOf(engine, P1);
  const before = ready(engine);
  actRaw(engine, P1, id("rouse"), "recur", { rt: [id("past")] });
  assert.equal(before - ready(engine), 1, "COST: Pay 1");
  assert.equal(zoneOf(engine, id("rouse")), "removed", "COST: Remove this card from the game");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), [id("past"), ...deck]);
  assert.equal(zoneOf(engine, id("past2")), "discard", "the other tactic stays");
  assert.ok(removedOf(engine, P1).includes(id("rouse")), "removedOf(engine, P1).includes(id(\"rouse\"))");
});

clause(ROUSE, "1:ability:recur", "RECUR needs [O][O][O]: two [O] plus many other resources is refused, as is none", () => {
  const two = rouseBoard({ rouseZone: "discard", obsession: 2, greed: 6 });
  refused(() => actRaw(two.engine, P1, two.id("rouse"), "recur", { rt: [two.id("past")] }), "[O][O] only");
  assert.equal(zoneOf(two.engine, two.id("rouse")), "discard");
  assert.equal(ready(two.engine), 8, "nothing was paid");
  const none = rouseBoard({ rouseZone: "discard", obsession: 0, greed: 8 });
  refused(() => actRaw(none.engine, P1, none.id("rouse"), "recur", { rt: [none.id("past")] }), "no [O]");
  const three = rouseBoard({ rouseZone: "discard", obsession: 3 });
  activate(three.engine, P1, three.id("rouse"), "recur", { selected: { rt: [three.id("past")] } });
  assert.equal(zoneOf(three.engine, three.id("past")), "deck", "control: [O][O][O] works");
});

clause(ROUSE, "1:ability:recur", "RECUR is refused one resource short of its pay-1 (threshold met by spent [O][O][O])", () => {
  const bad = rouseBoard({ rouseZone: "discard", obsession: 0, spentObsession: 3 });
  assert.equal(ready(bad.engine), 0);
  refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id("past")] }), "nothing ready to pay with");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "discard");
  const good = rouseBoard({ rouseZone: "discard", obsession: 0, spentObsession: 3, greed: 1 });
  activate(good.engine, P1, good.id("rouse"), "recur", { selected: { rt: [good.id("past")] } });
  assert.equal(zoneOf(good.engine, good.id("past")), "deck", "control: one ready resource is enough");
  assert.equal(ready(good.engine), 0);
});

for (const zone of ["hand", "play"] as const) {
  clause(ROUSE, "1:ability:recur", `'Use this only if this card is in your discard pile': refused while it is in ${zone === "play" ? "play" : "my hand"}`, () => {
    const bad = rouseBoard({ rouseZone: zone, obsession: 4 });
    refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id("past")] }), `RECUR from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("rouse")), zone);
    assert.equal(ready(bad.engine), 4);
  });
}

clause(ROUSE, "1:ability:recur", "'your discard pile': a Rouse in MY OPPONENT's discard pile cannot be recurred by me", () => {
  const bad = rouseBoard({ rouseZone: "discard", rouseOwner: P2, obsession: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id("past")] }), "using their Rouse");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "discard");
  assert.equal(ready(bad.engine), 4);
});

for (const [key, why] of [
  ["theirPast", "a tactic in my opponent's discard pile"],
  ["handTactic", "a tactic in my hand"],
  ["deckTactic", "a tactic in my deck"],
  ["pastChar", "a character in my discard pile"],
  ["pastItem", "an item in my discard pile"],
  ["mine", "a character in play"]
] as const) {
  clause(ROUSE, "1:ability:recur", `cannot pick ${why}; nothing is paid and Rouse stays in the discard pile`, () => {
    const bad = rouseBoard({ rouseZone: "discard", obsession: 3 });
    refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id(key)] }), `picking ${why}`);
    assert.equal(zoneOf(bad.engine, bad.id("rouse")), "discard", "not removed from the game");
    assert.equal(ready(bad.engine), 3, "nothing paid");
  });
}

clause(ROUSE, "1:ability:recur", "needs a pick: with none selected it is refused and nothing happens", () => {
  const bad = rouseBoard({ rouseZone: "discard", obsession: 3 });
  refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [] }), "no pick");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "discard");
  assert.equal(ready(bad.engine), 3);
});

clause(ROUSE, "1:ability:recur", "RECUR cannot pick Rouse itself: the cost removes it from the game BEFORE the pick, so it is no longer a tactic in my discard pile", () => {
  const bad = rouseBoard({ rouseZone: "discard", obsession: 3, withPast: false });
  refused(() => actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id("rouse")] }), "picking itself after removing itself");
  assert.equal(zoneOf(bad.engine, bad.id("rouse")), "discard", "the refused action changed nothing");
  assert.equal(ready(bad.engine), 3);
});

clause(ROUSE, "1:ability:recur", "a Rouse that RECUR removed from the game never comes back: it cannot end up on top of the deck", () => {
  const bad = rouseBoard({ rouseZone: "discard", obsession: 3, withPast: false });
  try {
    actRaw(bad.engine, P1, bad.id("rouse"), "recur", { rt: [bad.id("rouse")] });
    resolvePendingResponses(bad.engine);
  } catch {
    // refusing the pick is the right outcome
  }
  assert.notEqual(zoneOf(bad.engine, bad.id("rouse")), "deck", "a card removed from the game stays out of the game");
});

/** A free tactic (id "yk", pick "t") that takes a picked tactic out of a discard pile and puts it into its owner's hand. */
function discardYanker(): CardDefinition {
  return tactic({
    name: "Discard Yanker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "yk",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "any", type: "tactic" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

clause(ROUSE, "1:ability:recur", "if the picked tactic leaves my discard pile in response, the effect loses track of it (CR 402.4) and does not fetch it back from my hand", () => {
  const game = devBoard([
    { key: "rouse", def: printing(ROUSE), owner: P1, zone: "discard" },
    { key: "past", def: tactic({ name: "Past Tactic" }), owner: P1, zone: "discard" },
    { key: "yank", def: discardYanker(), owner: P2, zone: "hand" },
    ...fillers("md", 2, P1, "deck"),
    ...bank("obsession", 3, P1)
  ]);
  actRaw(game.engine, P1, game.id("rouse"), "recur", { rt: [game.id("past")] });
  playRaw(game.engine, P2, game.id("yank"), { selected: { t: [game.id("past")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("past")), "hand", "the response put it into my hand and RECUR lost track of it there");
  assert.equal(deckOf(game.engine, P1).includes(game.id("past")), false, "RECUR could not find it any more");
});

clause(ROUSE, "0:ability", "if the picked tactic leaves my discard pile in response, the effect loses track of it (CR 402.4) and does not fetch it back from my hand", () => {
  const game = devBoard([
    { key: "rouse", def: printing(ROUSE), owner: P1, zone: "hand" },
    { key: "past", def: tactic({ name: "Past Tactic" }), owner: P1, zone: "discard" },
    { key: "yank", def: discardYanker(), owner: P2, zone: "hand" },
    ...fillers("md", 2, P1, "deck"),
    ...bank("obsession", 3, P1)
  ]);
  playRaw(game.engine, P1, game.id("rouse"), { selected: { t: [game.id("past")] } });
  playRaw(game.engine, P2, game.id("yank"), { selected: { t: [game.id("past")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("past")), "hand", "the response put it into my hand and Rouse lost track of it there");
  assert.equal(deckOf(game.engine, P1).includes(game.id("past")), false, "Rouse could not find it any more");
});

// --- Sequestered Hellion -------------------------------------------------------
// COVERT
// FLIP UP: 7 [O][O]
// Character, cost 8, [O][O], 5 strength / 3 speed / 5 life.

const HELLION = "c5c02126-09fd-41ef-aa76-7f936b202d29";

function hellionBoard(opts: { obsession?: number; rage?: number; oppObsession?: number; faceDown?: boolean; zone?: "play" | "hand"; active?: PlayerId; turn?: number } = {}) {
  const active = opts.active ?? P1;
  return devBoard(
    [
      { key: "hell", def: printing(HELLION), owner: P1, zone: opts.zone ?? "play", faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown ?? true : undefined },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("obsession", opts.oppObsession ?? 0, P2),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ],
    { activePlayerId: active, turn: opts.turn ?? (active === P1 ? 1 : 2) }
  );
}

type HellionGame = ReturnType<typeof hellionBoard>;
const flipHellion = (game: HellionGame, player: PlayerId = P1): void => flipUpRaw(game.engine, player, game.id("hell"));

clause(HELLION, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(HELLION));
clause(HELLION, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(HELLION));
clause(HELLION, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(HELLION));
clause(HELLION, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(HELLION));

clause(HELLION, "1:flipUp", "a face-down Hellion flips up into a face-up character with its printed 5/3/5 stats and COVERT", () => {
  const game = hellionBoard({ obsession: 7 });
  const printed = printing(HELLION);
  assert.equal(game.engine.state.cards[game.id("hell")].faceDown, true);
  assert.deepEqual(game.engine.getCardTypes(game.id("hell")), ["resource"], "face-down it is only a resource");
  flipHellion(game);
  resolvePendingResponses(game.engine);
  const hell = game.engine.state.cards[game.id("hell")];
  assert.equal(hell.zone, "play");
  assert.equal(hell.faceDown, false);
  assert.deepEqual(game.engine.getCardTypes(game.id("hell")), ["character"]);
  assert.equal(game.engine.getStat(game.id("hell"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("hell"), "life"), printed.life);
  assert.equal(game.engine.getStat(game.id("hell"), "speed"), printed.speed);
  assert.ok(game.engine.getKeywords(game.id("hell")).includes("covert"), "game.engine.getKeywords(game.id(\"hell\")).includes(\"covert\")");
  assert.equal(game.engine.isResource(game.id("hell")), false, "no longer a resource");
});

clause(HELLION, "1:flipUp", "pays exactly 7 (not its cost of 8, not 7 + 8)", () => {
  const game = hellionBoard({ obsession: 9 });
  assert.equal(ready(game.engine), 10, "9 banks and the face-down Hellion");
  flipHellion(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hell")].faceDown, false);
  assert.equal(ready(game.engine), 2, "10 - 7 paid - 1 (the Hellion stopped being a resource)");
});

clause(HELLION, "1:flipUp", "the Hellion may help pay for its own FLIP UP (CR 507.4b): six other resources plus itself are exactly enough", () => {
  const game = hellionBoard({ obsession: 2, rage: 4 });
  flipHellion(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("hell")].faceDown, false);
  assert.equal(ready(game.engine), 0);
});

clause(HELLION, "1:flipUp", "is refused one resource short: five other resources plus itself is only six", () => {
  const game = hellionBoard({ obsession: 2, rage: 3 });
  refused(() => flipHellion(game), "6 resources");
  assert.equal(game.engine.state.cards[game.id("hell")].faceDown, true);
  assert.equal(ready(game.engine), 6, "nothing was paid");
});

clause(HELLION, "1:flipUp", "needs [O][O]: seven resources with no Obsession are refused, and so is a single [O]", () => {
  const none = hellionBoard({ rage: 8 });
  refused(() => flipHellion(none), "no [O]");
  assert.equal(none.engine.state.cards[none.id("hell")].faceDown, true);
  assert.equal(ready(none.engine), 9);
  const one = hellionBoard({ obsession: 1, rage: 7 });
  refused(() => flipHellion(one), "one [O]");
  assert.equal(one.engine.state.cards[one.id("hell")].faceDown, true);
  const two = hellionBoard({ obsession: 2, rage: 7 });
  flipHellion(two);
  assert.equal(two.engine.state.cards[two.id("hell")].faceDown, false, "control: [O][O] among enough resources works");
});

clause(HELLION, "1:flipUp", "its own face-down Volition is not [O], and my opponent's Obsession does not count", () => {
  const faceDownOnly = hellionBoard({ rage: 6 });
  refused(() => flipHellion(faceDownOnly), "Volition only");
  const theirs = hellionBoard({ rage: 8, oppObsession: 4 });
  refused(() => flipHellion(theirs), "their [O]");
  assert.equal(theirs.engine.state.cards[theirs.id("hell")].faceDown, true);
});

clause(HELLION, "1:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn", () => {
  const game = hellionBoard({ obsession: 8, active: P2 });
  refused(() => flipHellion(game), "the opponent's turn");
  assert.equal(game.engine.state.cards[game.id("hell")].faceDown, true);
  assert.equal(ready(game.engine), 9, "nothing was paid");
});

clause(HELLION, "1:flipUp", "the flipped-up Hellion is a new arrival: it cannot attack the turn it was flipped", () => {
  const game = hellionBoard({ obsession: 7 });
  flipHellion(game);
  resolvePendingResponses(game.engine);
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("hell")], target: { type: "faction", playerId: P2 } }),
    "a character that just flipped up cannot attack",
    /did not start the turn in play/
  );
});

clause(HELLION, "1:flipUp", "cannot be flipped up when already face-up, from the hand, or by the opponent", () => {
  const faceUp = hellionBoard({ obsession: 8, faceDown: false });
  refused(() => flipHellion(faceUp), "already face-up");
  const inHand = hellionBoard({ obsession: 8, zone: "hand" });
  refused(() => flipHellion(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("hell")), "hand");
  const theirs = hellionBoard({ obsession: 8 });
  refused(() => flipHellion(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("hell")].faceDown, true);
});

clause(HELLION, "1:flipUp", "FLIP UP is an alternative: deployed from the hand the Hellion costs its printed 8 (seven resources are one short)", () => {
  const eight = hellionBoard({ obsession: 8, zone: "hand" });
  playRaw(eight.engine, P1, eight.id("hell"));
  assert.equal(ready(eight.engine), 0, "8 paid");
  const seven = hellionBoard({ obsession: 7, zone: "hand" });
  refused(() => playRaw(seven.engine, P1, seven.id("hell")), "seven resources");
  assert.equal(zoneOf(seven.engine, seven.id("hell")), "hand");
});

// --- Shrouded Demon ------------------------------------------------------------
// COVERT
// [O][O][O]: This card gains 2 life.
// Character, cost 3, [O], 2 strength / 3 speed / 1 life.

const DEMON = "db0e93b4-a1e1-41ef-b564-261d2b81085a";

function demonBoard(opts: { obsession?: number; greed?: number; oppObsession?: number; spent?: number; faceDown?: number; extra?: CardPlacement[]; damage?: number } = {}) {
  return devBoard([
    { key: "demon", def: printing(DEMON), owner: P1, zone: "play", damage: opts.damage },
    { key: "other", def: character({ name: "Other", life: 1 }), owner: P1, zone: "play" },
    ...bank("obsession", opts.obsession ?? 0, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.oppObsession ?? 0, P2),
    ...bank("obsession", opts.spent ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...volition(opts.faceDown ?? 0, P1),
    ...(opts.extra ?? [])
  ]);
}

clause(DEMON, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(DEMON));
clause(DEMON, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(DEMON));
clause(DEMON, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(DEMON));
clause(DEMON, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(DEMON));

clause(DEMON, "1:rule@ooo", "with [O][O][O] it gains 2 life (1 -> 3); strength and speed are unchanged", () => {
  const game = demonBoard({ obsession: 3 });
  const printed = printing(DEMON);
  assert.equal(game.engine.getStat(game.id("demon"), "life"), printed.life! + 2);
  assert.equal(game.engine.getStat(game.id("demon"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("demon"), "speed"), printed.speed);
  assert.ok(game.engine.getKeywords(game.id("demon")).includes("covert"), "COVERT is unaffected");
});

clause(DEMON, "1:rule@ooo", "with only [O][O] (or none) it has its printed life", () => {
  for (const obsession of [0, 1, 2]) {
    const game = demonBoard({ obsession, greed: 4 });
    assert.equal(game.engine.getStat(game.id("demon"), "life"), printing(DEMON).life, `${obsession} Obsession`);
  }
});

clause(DEMON, "1:rule@ooo", "it is not cumulative: with six or nine [O] the life bonus is still exactly +2", () => {
  for (const obsession of [4, 6, 9]) {
    const game = demonBoard({ obsession });
    assert.equal(game.engine.getStat(game.id("demon"), "life"), printing(DEMON).life! + 2, `${obsession} Obsession`);
  }
});

clause(DEMON, "1:rule@ooo", "icons count, not cards: one Neurosis ([O][O]) is not enough, Neurosis plus one Obsession is", () => {
  const two = demonBoard({ extra: [{ key: "neuro", def: printing(NEUROSIS), owner: P1, zone: "play" }] });
  assert.equal(two.engine.getStat(two.id("demon"), "life"), printing(DEMON).life, "two icons");
  const three = demonBoard({ obsession: 1, extra: [{ key: "neuro", def: printing(NEUROSIS), owner: P1, zone: "play" }] });
  assert.equal(three.engine.getStat(three.id("demon"), "life"), printing(DEMON).life! + 2, "three icons");
});

clause(DEMON, "1:rule@ooo", "other icons do not count: three Greed, and face-down Volition, are not [O][O][O]", () => {
  const greed = demonBoard({ greed: 3 });
  assert.equal(greed.engine.getStat(greed.id("demon"), "life"), printing(DEMON).life);
  const volition = demonBoard({ faceDown: 5 });
  assert.equal(volition.engine.getStat(volition.id("demon"), "life"), printing(DEMON).life);
  const mixed = demonBoard({ obsession: 2, greed: 4, faceDown: 3 });
  assert.equal(mixed.engine.getStat(mixed.id("demon"), "life"), printing(DEMON).life);
});

clause(DEMON, "1:rule@ooo", "my opponent's Obsession does not count", () => {
  const game = demonBoard({ oppObsession: 5 });
  assert.equal(game.engine.getStat(game.id("demon"), "life"), printing(DEMON).life);
});

clause(DEMON, "1:rule@ooo", "spent (attached) Obsession still counts: icons are never spent (CR 405.6)", () => {
  const game = demonBoard({ spent: 3 });
  assert.equal(ready(game.engine), 0);
  assert.equal(game.engine.getStat(game.id("demon"), "life"), printing(DEMON).life! + 2);
});

clause(DEMON, "1:rule@ooo", "it affects only the Demon: another character of mine gains nothing", () => {
  const game = demonBoard({ obsession: 3 });
  assert.equal(game.engine.getStat(game.id("other"), "life"), 1);
});

clause(DEMON, "1:rule@ooo", "it turns off again when the icons go: a Demon with 2 damage lives at 3 life and dies when I drop below [O][O][O]", () => {
  const game = demonBoard({ obsession: 3, damage: 2, extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(game.engine.getStat(game.id("demon"), "life"), 3);
  assert.equal(zoneOf(game.engine, game.id("demon")), "play", "2 damage on 3 life");
  const bank0 = playOf(game.engine, P1).find((c) => game.engine.isResource(c))!;
  game.engine.state.cards[game.id("mv")].zone = "hand";
  play(game.engine, P1, game.id("mv"), { selected: { t: [bank0] } });
  assert.equal(zoneOf(game.engine, bank0), "hand", "control: an Obsession left play");
  assert.equal(game.engine.getStat(game.id("demon"), "life"), 1, "back to 1 life");
  assert.equal(zoneOf(game.engine, game.id("demon")), "discard", "2 damage on 1 life: destroyed");
});

clause(DEMON, "1:rule@ooo", "the threshold is its controller's: a Demon I control but my opponent owns uses MY icons", () => {
  const game = devBoard([
    { key: "demon", def: printing(DEMON), owner: P2, controller: P1, zone: "play" },
    ...bank("obsession", 3, P1)
  ]);
  assert.equal(game.engine.getStat(game.id("demon"), "life"), printing(DEMON).life! + 2);
  const theirs = devBoard([
    { key: "demon", def: printing(DEMON), owner: P2, controller: P1, zone: "play" },
    ...bank("obsession", 3, P2)
  ]);
  assert.equal(theirs.engine.getStat(theirs.id("demon"), "life"), printing(DEMON).life, "the owner's icons do not count");
});

clause(DEMON, "1:rule@ooo", "a face-down Demon is only a Volition resource (CR 411.1): not a character, and it provides one Volition", () => {
  const game = devBoard([
    { key: "demon", def: printing(DEMON), owner: P1, zone: "play", faceDown: true },
    ...bank("obsession", 3, P1)
  ]);
  assert.deepEqual(game.engine.getCardTypes(game.id("demon")), ["resource"]);
  assert.equal(game.engine.getThresholds(P1).volition, 1, "it provides one Volition");
});

/** A face-down card has no rules text (CR 411.1), so none of its printed keywords is active while it is face-down. */
function faceDownHasNoCovert(printingId: string): void {
  const game = devBoard([
    { key: "fd", def: printing(printingId), owner: P1, zone: "play", faceDown: true },
    { key: "up", def: printing(printingId), owner: P1, zone: "play" }
  ]);
  assert.ok(game.engine.getKeywords(game.id("up")).includes("covert"), "control: the face-up copy has COVERT");
  assert.equal(game.engine.getKeywords(game.id("fd")).includes("covert"), false, "the face-down copy has no rules text, so no COVERT");
}

clause(DEMON, "0:kw:COVERT", "a face-down Shrouded Demon has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(DEMON));

/** `n` explicitly keyed face-up Obsession resources `<prefix>0..n-1` (so a test can move a particular one). */
function obsRes(prefix: string, n: number, owner: PlayerId): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `Obsession ${prefix}${i}`, resource: { provides: ["obsession"], staple: true } }),
    owner,
    zone: "play" as const
  }));
}

// --- The Abominable Hamster ----------------------------------------------------
// COVERT
// [O][O][O][O][O]: This card gains 2 strength.
// Character, cost 5, [O], 3 strength / 3 speed / 3 life.

const HAMSTER = "c6b5109e-0a98-45c3-907f-b15bd97c7a1b";

function hamsterBoard(opts: { obsession?: number; greed?: number; oppObsession?: number; spent?: number; faceDown?: number; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "ham", def: printing(HAMSTER), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", strength: 1 }), owner: P1, zone: "play" },
    ...bank("obsession", opts.obsession ?? 0, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.oppObsession ?? 0, P2),
    ...bank("obsession", opts.spent ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...volition(opts.faceDown ?? 0, P1),
    ...(opts.extra ?? [])
  ]);
}

clause(HAMSTER, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(HAMSTER));
clause(HAMSTER, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(HAMSTER));
clause(HAMSTER, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(HAMSTER));
clause(HAMSTER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(HAMSTER));
clause(HAMSTER, "0:kw:COVERT", "a face-down Abominable Hamster has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(HAMSTER));

clause(HAMSTER, "1:rule@ooooo", "with [O][O][O][O][O] it gains 2 strength (3 -> 5); life and speed are unchanged", () => {
  const game = hamsterBoard({ obsession: 5 });
  const printed = printing(HAMSTER);
  assert.equal(game.engine.getStat(game.id("ham"), "strength"), printed.strength! + 2);
  assert.equal(game.engine.getStat(game.id("ham"), "life"), printed.life);
  assert.equal(game.engine.getStat(game.id("ham"), "speed"), printed.speed);
  assert.ok(game.engine.getKeywords(game.id("ham")).includes("covert"), "COVERT is unaffected");
});

clause(HAMSTER, "1:rule@ooooo", "with fewer than five [O] it has its printed strength (zero to four, with plenty of other resources)", () => {
  for (const obsession of [0, 1, 3, 4]) {
    const game = hamsterBoard({ obsession, greed: 6 });
    assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength, `${obsession} Obsession`);
  }
});

clause(HAMSTER, "1:rule@ooooo", "it is not cumulative: with ten [O] the bonus is still exactly +2", () => {
  for (const obsession of [6, 10]) {
    const game = hamsterBoard({ obsession });
    assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength! + 2, `${obsession} Obsession`);
  }
});

clause(HAMSTER, "1:rule@ooooo", "icons count, not cards: two Neurosis ([O]x4) plus one Obsession make five; two Neurosis alone do not", () => {
  const neuro = (key: string): CardPlacement => ({ key, def: printing(NEUROSIS), owner: P1, zone: "play" });
  const four = hamsterBoard({ extra: [neuro("n1"), neuro("n2")] });
  assert.equal(four.engine.getStat(four.id("ham"), "strength"), printing(HAMSTER).strength, "four icons");
  const five = hamsterBoard({ obsession: 1, extra: [neuro("n1"), neuro("n2")] });
  assert.equal(five.engine.getStat(five.id("ham"), "strength"), printing(HAMSTER).strength! + 2, "five icons");
});

clause(HAMSTER, "1:rule@ooooo", "other icons do not count: five Greed, face-down Volition, or a mixed pile with four [O] are not [O]x5", () => {
  const greed = hamsterBoard({ greed: 5 });
  assert.equal(greed.engine.getStat(greed.id("ham"), "strength"), printing(HAMSTER).strength);
  const fd = hamsterBoard({ faceDown: 6 });
  assert.equal(fd.engine.getStat(fd.id("ham"), "strength"), printing(HAMSTER).strength);
  const mixed = hamsterBoard({ obsession: 4, greed: 3, faceDown: 3 });
  assert.equal(mixed.engine.getStat(mixed.id("ham"), "strength"), printing(HAMSTER).strength);
});

clause(HAMSTER, "1:rule@ooooo", "my opponent's Obsession does not count", () => {
  const game = hamsterBoard({ obsession: 2, oppObsession: 6 });
  assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength);
});

clause(HAMSTER, "1:rule@ooooo", "spent (attached) Obsession still counts (icons are never spent)", () => {
  const game = hamsterBoard({ spent: 5 });
  assert.equal(ready(game.engine), 0);
  assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength! + 2);
});

clause(HAMSTER, "1:rule@ooooo", "it affects only the Hamster", () => {
  const game = hamsterBoard({ obsession: 5 });
  assert.equal(game.engine.getStat(game.id("other"), "strength"), 1);
});

clause(HAMSTER, "1:rule@ooooo", "it turns off the moment an [O] goes away: back to its printed strength with four [O]", () => {
  const game = hamsterBoard({ extra: [...obsRes("o", 5, P1), { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength! + 2, "five [O]");
  useOn(game, "mv", "o0");
  assert.equal(zoneOf(game.engine, game.id("o0")), "hand", "control: an Obsession left play");
  assert.equal(game.engine.getStat(game.id("ham"), "strength"), printing(HAMSTER).strength, "four [O]");
});

clause(HAMSTER, "1:rule@ooooo", "the threshold is its controller's: a Hamster I control but my opponent owns uses MY icons", () => {
  const mine = devBoard([{ key: "ham", def: printing(HAMSTER), owner: P2, controller: P1, zone: "play" }, ...bank("obsession", 5, P1)]);
  assert.equal(mine.engine.getStat(mine.id("ham"), "strength"), printing(HAMSTER).strength! + 2);
  const theirs = devBoard([{ key: "ham", def: printing(HAMSTER), owner: P2, controller: P1, zone: "play" }, ...bank("obsession", 5, P2)]);
  assert.equal(theirs.engine.getStat(theirs.id("ham"), "strength"), printing(HAMSTER).strength, "its owner's icons do not count");
});

// --- Wrinkly Rabbit ------------------------------------------------------------
// COVERT
// This card gains 1 strength and 1 life for each [O] you control.
// Character, cost 6, [O], 0 strength / 3 speed / 0 life.

const RABBIT = "a7bd787b-336f-43b4-9a0e-13a1f547c9bf";

function rabbitBoard(opts: { obsession?: number; greed?: number; oppObsession?: number; spent?: number; faceDown?: number; extra?: CardPlacement[]; damage?: number } = {}) {
  return devBoard([
    { key: "rab", def: printing(RABBIT), owner: P1, zone: "play", damage: opts.damage },
    ...bank("obsession", opts.obsession ?? 0, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.oppObsession ?? 0, P2),
    ...bank("obsession", opts.spent ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...volition(opts.faceDown ?? 0, P1),
    ...(opts.extra ?? [])
  ]);
}

// COVERT, with Obsession on the board so the 0/0 Rabbit has life (RULES.md 3.1; FAQ: 0 life is destroyed)
function rabbitCovertBoard(attacker: PlayerId, mates: CardPlacement[] = []) {
  const defender = attacker === P1 ? P2 : P1;
  return devBoard(
    [
      { key: "subject", def: printing(RABBIT), owner: attacker, zone: "play" },
      ...bank("obsession", 2, attacker),
      ...mates.map((m) => ({ ...m, owner: attacker })),
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: defender, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" }
    ],
    { turn: 2, activePlayerId: attacker }
  );
}

clause(RABBIT, "0:kw:COVERT", "has the COVERT keyword; an ordinary character does not", () => {
  const game = rabbitBoard({ obsession: 2, extra: [{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }] });
  assert.ok(game.engine.getKeywords(game.id("rab")).includes("covert"), "game.engine.getKeywords(game.id(\"rab\")).includes(\"covert\")");
  assert.equal(game.engine.getKeywords(game.id("plain")).includes("covert"), false, "control: an ordinary character is not covert");
});

clause(RABBIT, "0:kw:COVERT", "cannot be blocked by non-covert characters (alone or with a covert one); a covert character can block it", () => {
  const game = rabbitCovertBoard(P1);
  declareAttackBy(game.engine, P1, [game.id("subject")]);
  refused(() => declareBlockers(game.engine, P2, [game.id("plainBlocker")]), "a non-covert character cannot block a covert party");
  refused(() => declareBlockers(game.engine, P2, [game.id("plainBlocker"), game.id("covertBlocker")]), "nor join a covert blocker");
  declareBlockers(game.engine, P2, [game.id("covertBlocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("covertBlocker")]);
});

clause(RABBIT, "0:kw:COVERT", "a party with a non-covert member is not a covert party, so anyone may block it", () => {
  const game = rabbitCovertBoard(P1, [{ key: "plainAlly", def: character({ name: "PlainAlly" }), owner: P1, zone: "play" }]);
  declareAttackBy(game.engine, P1, [game.id("subject"), game.id("plainAlly")]);
  declareBlockers(game.engine, P2, [game.id("plainBlocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plainBlocker")]);
});

clause(RABBIT, "0:kw:COVERT", "as a blocker it can block only covert parties", () => {
  const plain = devBoard(
    [
      { key: "subject", def: printing(RABBIT), owner: P1, zone: "play" },
      ...bank("obsession", 2, P1),
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P1, zone: "play" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(plain.engine, P2, [plain.id("plainAttacker")]);
  refused(() => declareBlockers(plain.engine, P1, [plain.id("subject")]), "a covert character may block only a covert party");
  declareBlockers(plain.engine, P1, [plain.id("plainBlocker")]);
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("plainBlocker")], "control: a plain character can block the plain attacker");
  const covert = devBoard(
    [
      { key: "subject", def: printing(RABBIT), owner: P1, zone: "play" },
      ...bank("obsession", 2, P1),
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(covert.engine, P2, [covert.id("covertAttacker")]);
  declareBlockers(covert.engine, P1, [covert.id("subject")]);
  assert.deepEqual(battleOf(covert.engine)?.blockingParty, [covert.id("subject")], "it can block a covert party");
});

clause(RABBIT, "0:kw:COVERT", "a face-down Wrinkly Rabbit has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(RABBIT));
clause(HORROR, "0:kw:COVERT", "a face-down Nefarious Horror has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(HORROR));
clause(HELLION, "0:kw:COVERT", "a face-down Sequestered Hellion has no COVERT (a face-down card has no rules text, CR 411.1)", () => faceDownHasNoCovert(HELLION));

for (const n of [1, 2, 3, 5, 8]) {
  clause(RABBIT, "1:rule", `with ${n} [O] it gains ${n} strength and ${n} life (printed 0/0), keeping speed 3`, () => {
    const game = rabbitBoard({ obsession: n });
    assert.equal(game.engine.getStat(game.id("rab"), "strength"), n);
    assert.equal(game.engine.getStat(game.id("rab"), "life"), n);
    assert.equal(game.engine.getStat(game.id("rab"), "speed"), printing(RABBIT).speed);
    assert.equal(zoneOf(game.engine, game.id("rab")), "play");
  });
}

clause(RABBIT, "1:rule", "icons count, not cards: a Neurosis ([O][O]) is two, and Neurosis plus three Obsession is five", () => {
  const neuro = (key: string): CardPlacement => ({ key, def: printing(NEUROSIS), owner: P1, zone: "play" });
  const one = rabbitBoard({ extra: [neuro("n1")] });
  assert.equal(one.engine.getStat(one.id("rab"), "strength"), 2);
  assert.equal(one.engine.getStat(one.id("rab"), "life"), 2);
  const five = rabbitBoard({ obsession: 3, extra: [neuro("n1")] });
  assert.equal(five.engine.getStat(five.id("rab"), "strength"), 5);
  assert.equal(five.engine.getStat(five.id("rab"), "life"), 5);
});

clause(RABBIT, "1:rule", "only [O] counts: Greed and face-down Volition add nothing", () => {
  const game = rabbitBoard({ obsession: 2, greed: 4, faceDown: 3 });
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 2);
});

clause(RABBIT, "1:rule", "'you control': my opponent's Obsession adds nothing", () => {
  const game = rabbitBoard({ obsession: 2, oppObsession: 5 });
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 2);
});

clause(RABBIT, "1:rule", "spent (attached) Obsession still counts", () => {
  const game = rabbitBoard({ spent: 4 });
  assert.equal(ready(game.engine), 0);
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 4);
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 4);
});

clause(RABBIT, "1:rule", "a Rabbit I control but my opponent owns uses MY Obsession, not its owner's", () => {
  const game = devBoard([
    { key: "rab", def: printing(RABBIT), owner: P2, controller: P1, zone: "play" },
    ...bank("obsession", 3, P1),
    ...bank("obsession", 6, P2)
  ]);
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 3);
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 3);
});

clause(RABBIT, "1:rule", "it follows the icons as they change: with 2 damage it lives at 4 and 3 life, and is destroyed when it drops to 2 life", () => {
  const game = rabbitBoard({
    damage: 2,
    extra: [...obsRes("o", 4, P1), { key: "mv1", def: moverTactic("hand"), owner: P1, zone: "hand" }, { key: "mv2", def: moverTactic("hand"), owner: P1, zone: "hand" }]
  });
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 4);
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 4);
  assert.equal(zoneOf(game.engine, game.id("rab")), "play", "2 damage on 4 life");
  useOn(game, "mv1", "o0");
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 3, "3 [O]");
  assert.equal(game.engine.getStat(game.id("rab"), "strength"), 3);
  assert.equal(zoneOf(game.engine, game.id("rab")), "play", "2 damage on 3 life");
  useOn(game, "mv2", "o1");
  assert.equal(zoneOf(game.engine, game.id("o1")), "hand", "control: a second Obsession left play (2 [O] remain)");
  assert.equal(zoneOf(game.engine, game.id("rab")), "discard", "2 [O] = 2 life, 2 damage: destroyed");
});

clause(RABBIT, "1:rule", "a Rabbit left with no [O] is a 0/0 character and is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const game = rabbitBoard({ obsession: 1, extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 1);
  const theBank = playOf(game.engine, P1).find((c) => game.engine.isResource(c))!;
  play(game.engine, P1, game.id("mv"), { selected: { t: [theBank] } });
  assert.equal(zoneOf(game.engine, theBank), "hand", "control: the only Obsession left play");
  assert.equal(game.engine.getStat(game.id("rab"), "life"), 0);
  assert.equal(zoneOf(game.engine, game.id("rab")), "discard", "0 damage is equal to 0 life: destroyed");
});

// --- Sin Against Nature --------------------------------------------------------
// When this card enters play, pick a resource you control. Put it into its
// owner's hand. (You may pick face-down resources.)
// Character, cost 1, [O][O], 3 strength / 3 speed / 3 life.

const SIN = "3a2d3843-d810-445d-84be-07069fbd5cd6";

function sinBoard(opts: { obsession?: number; extra?: CardPlacement[]; sinZone?: "hand" | "play" } = {}) {
  return devBoard([
    { key: "sin", def: printing(SIN), owner: P1, zone: opts.sinZone ?? "hand" },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "handCard", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" },
    ...obsRes("o", opts.obsession ?? 3, P1),
    ...(opts.extra ?? [])
  ]);
}

/** Answers the Sin's pick (declaration "r") with `picks`; the pick is a `selectTargets` question for its controller. */
function sinPick(engine: SpoilsEngine, picks: CardInstanceId[]): void {
  const pc = expectPending(engine, "selectTargets");
  assert.equal(pc.playerId, P1, "I (the Sin's controller) make the pick");
  answerPending(engine, "selectTargets", { selected: { r: picks } });
}

clause(SIN, "0:rule", "when it enters play I pick a resource I control and it goes into its owner's hand (the other resources stay)", () => {
  const { engine, id } = sinBoard({ obsession: 3 });
  play(engine, P1, id("sin"));
  assert.equal(zoneOf(engine, id("sin")), "play", "control: it entered play");
  sinPick(engine, [id("o2")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("o2")), "hand");
  assert.ok(handOf(engine, P1).includes(id("o2")), "to its owner's hand");
  assert.equal(zoneOf(engine, id("o0")), "play");
  assert.equal(zoneOf(engine, id("o1")), "play");
  assert.equal(zoneOf(engine, id("sin")), "play", "the Sin stays");
});

clause(SIN, "0:rule", "its printed cost 1 is paid; the resource that paid for it is still a resource I control and can be the pick", () => {
  const { engine, id } = sinBoard({ obsession: 2 });
  const before = ready(engine);
  playRaw(engine, P1, id("sin"));
  assert.equal(before - ready(engine), 1, "cost 1");
  resolvePendingResponses(engine);
  const spent = playOf(engine, P1).filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo !== undefined);
  assert.equal(spent.length, 1, "one resource is attached to my faction (spent)");
  sinPick(engine, [spent[0]]);
  assert.equal(zoneOf(engine, spent[0]), "hand", "a spent resource can be the one picked");
});

clause(SIN, "0:rule", "a face-down resource can be picked (the reminder), and it goes to its owner's hand", () => {
  const { engine, id } = sinBoard({ obsession: 2, extra: [{ key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play", faceDown: true }] });
  play(engine, P1, id("sin"));
  sinPick(engine, [id("fd")]);
  assert.equal(zoneOf(engine, id("fd")), "hand");
  assert.equal(engine.state.cards[id("fd")].faceDown, false, "in the hand it is just a card again");
  assert.ok(handOf(engine, P1).includes(id("fd")), "handOf(engine, P1).includes(id(\"fd\"))");
});

for (const [key, why] of [
  ["foeRes", "my opponent's resource"],
  ["thing", "an item"],
  ["mine", "a character"],
  ["handCard", "a resource card in my hand"]
] as const) {
  clause(SIN, "0:rule", `cannot pick ${why}`, () => {
    const make = () => sinBoard({ obsession: 2, extra: [{ key: "foeRes", def: resourceCard({ name: "Foe Res" }), owner: P2, zone: "play" }] });
    const bad = make();
    play(bad.engine, P1, bad.id("sin"));
    expectPending(bad.engine, "selectTargets");
    refused(() => answerPending(bad.engine, "selectTargets", { selected: { r: [bad.id(key)] } }), `picking ${why}`);
    if (!bad.engine.state.pendingChoice) assert.fail("the refused pick must leave the question standing");
    sinPick(bad.engine, [bad.id("o0")]);
    assert.equal(zoneOf(bad.engine, bad.id("o0")), "hand", "control: my own resource is accepted");
    assert.equal(zoneOf(bad.engine, bad.id(key)), key === "handCard" ? "hand" : "play", "the refused pick did not move anything");
  });
}

clause(SIN, "0:rule", "the Sin itself and my faction are not resources, so cannot be picked", () => {
  const game = sinBoard({ obsession: 2 });
  play(game.engine, P1, game.id("sin"));
  expectPending(game.engine, "selectTargets");
  refused(() => answerPending(game.engine, "selectTargets", { selected: { r: [game.id("sin")] } }), "the Sin itself");
  refused(() => answerPending(game.engine, "selectTargets", { selected: { r: [game.engine.state.players[P1].factionId!] } }), "my faction");
  sinPick(game.engine, [game.id("o1")]);
  assert.equal(zoneOf(game.engine, game.id("sin")), "play");
});

clause(SIN, "0:rule", "the pick is mandatory and single: none or two resources are refused", () => {
  const game = sinBoard({ obsession: 3 });
  play(game.engine, P1, game.id("sin"));
  expectPending(game.engine, "selectTargets");
  refused(() => answerPending(game.engine, "selectTargets", { selected: { r: [] } }), "declining");
  refused(() => answerPending(game.engine, "selectTargets", { selected: { r: [game.id("o0"), game.id("o1")] } }), "two resources");
  if (!game.engine.state.pendingChoice) assert.fail("refused answers must leave the question standing");
  sinPick(game.engine, [game.id("o0")]);
  assert.equal(zoneOf(game.engine, game.id("o0")), "hand");
  assert.equal(zoneOf(game.engine, game.id("o1")), "play");
});

clause(SIN, "0:rule", "'its owner's hand': a resource I control but my opponent owns goes to THEIR hand", () => {
  const { engine, id } = sinBoard({ obsession: 2, extra: [res("captured", P2, { controller: P1 })] });
  play(engine, P1, id("sin"));
  sinPick(engine, [id("captured")]);
  assert.equal(zoneOf(engine, id("captured")), "hand");
  assert.ok(handOf(engine, P2).includes(id("captured")), "to its owner's (my opponent's) hand");
  assert.equal(handOf(engine, P1).includes(id("captured")), false);
});

clause(SIN, "0:rule", "a resource I own but my opponent controls cannot be picked ('you control')", () => {
  const game = sinBoard({ obsession: 2, extra: [res("stolen", P1, { controller: P2 })] });
  play(game.engine, P1, game.id("sin"));
  expectPending(game.engine, "selectTargets");
  refused(() => answerPending(game.engine, "selectTargets", { selected: { r: [game.id("stolen")] } }), "a resource they control");
  sinPick(game.engine, [game.id("o0")]);
});

clause(SIN, "0:rule", "it triggers when the Sin is put into play by an effect too", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = sinBoard({ obsession: 2, extra: [{ key: "put", def: putter, owner: P1, zone: "hand" }] });
  play(engine, P1, id("put"), { selected: { t: [id("sin")] } });
  assert.equal(zoneOf(engine, id("sin")), "play", "control: it was put into play");
  sinPick(engine, [id("o0")]);
  assert.equal(zoneOf(engine, id("o0")), "hand");
});

clause(SIN, "0:rule", "put into play while I control no resource at all, nothing happens and nothing stalls (CR 402.5: do as much as you can)", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = devBoard([
    { key: "sin", def: printing(SIN), owner: P1, zone: "hand" },
    { key: "put", def: putter, owner: P1, zone: "hand" },
    { key: "foeRes", def: resourceCard({ name: "Foe Res" }), owner: P2, zone: "play" }
  ]);
  play(game.engine, P1, game.id("put"), { selected: { t: [game.id("sin")] } });
  assert.equal(zoneOf(game.engine, game.id("sin")), "play");
  assert.equal(game.engine.state.pendingChoice, undefined, "no resource to pick, so nothing is asked");
  assert.equal(zoneOf(game.engine, game.id("foeRes")), "play", "my opponent's resource is untouched");
});

clause(SIN, "0:rule", "it is only an enters-play trigger: the Sin leaving play asks nothing, and a face-down Sin has no rules text", () => {
  const leaves = sinBoard({ obsession: 2, sinZone: "play", extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  useOn(leaves, "mv", "sin");
  assert.equal(zoneOf(leaves.engine, leaves.id("sin")), "hand", "control: it left play");
  assert.equal(leaves.engine.state.pendingChoice, undefined);

  const faceDown = sinBoard({ obsession: 2 });
  developResource(faceDown.engine, P1, faceDown.id("sin"), true);
  resolvePendingResponses(faceDown.engine);
  assert.equal(zoneOf(faceDown.engine, faceDown.id("sin")), "play");
  assert.equal(faceDown.engine.state.cards[faceDown.id("sin")].faceDown, true);
  assert.equal(faceDown.engine.state.pendingChoice, undefined, "a face-down Sin asks nothing");
});

clause(SIN, "0:rule", "it costs its printed 1 and needs [O][O]: one [O] (with other resources) is refused", () => {
  const bad = sinBoard({ obsession: 1, extra: bank("greed", 4, P1) });
  refused(() => playRaw(bad.engine, P1, bad.id("sin")), "one [O]");
  assert.equal(zoneOf(bad.engine, bad.id("sin")), "hand");
  const none = devBoard([{ key: "sin", def: printing(SIN), owner: P1, zone: "hand" }]);
  refused(() => playRaw(none.engine, P1, none.id("sin")), "no resources");
  const good = sinBoard({ obsession: 2 });
  play(good.engine, P1, good.id("sin"));
  assert.equal(zoneOf(good.engine, good.id("sin")), "play", "control: [O][O] and one to pay");
});

// --- Stupidify -----------------------------------------------------------------
// Your opponent discards 2 cards.
// RECUR: [O] -- COST: Use this only if this card is in your discard pile. Pay 2.
// Remove this card from the game. -- EFFECT: Your opponent discards a card.
// Tactic, cost 3, [O].

const STUPIDIFY = "baef7715-05a4-4082-b546-c458ce97eeb2";

function stupidifyBoard(opts: { zone?: "hand" | "discard" | "play"; owner?: PlayerId; obsession?: number; greed?: number; spentObsession?: number; oppHand?: number } = {}) {
  return devBoard([
    { key: "st", def: printing(STUPIDIFY), owner: opts.owner ?? P1, zone: opts.zone ?? "hand" },
    ...fillers("oh", opts.oppHand ?? 4, P2, "hand"),
    ...fillers("mh", 2, P1, "hand"),
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...bank("obsession", opts.obsession ?? 3, P1),
    ...bank("greed", opts.greed ?? 0, P1),
    ...bank("obsession", opts.spentObsession ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
}

clause(STUPIDIFY, "0:rule", "my opponent chooses 2 cards from their hand and discards them; it costs 3 and ends in my discard pile", () => {
  const { engine, id } = stupidifyBoard({ obsession: 4 });
  const myHand = handOf(engine, P1).filter((c) => c !== id("st"));
  const before = ready(engine);
  playRaw(engine, P1, id("st"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  resolvePendingResponses(engine);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses which cards");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh1"), id("oh3")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P2), [id("oh0"), id("oh2")], "exactly the two chosen cards left their hand");
  assert.deepEqual(discardOf(engine, P2).sort(), [id("oh1"), id("oh3")].sort(), "...and are in their discard pile");
  assert.deepEqual(handOf(engine, P1), myHand, "my hand is untouched");
  assert.equal(zoneOf(engine, id("st")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("st")), "Stupidify is in MY discard pile");
});

clause(STUPIDIFY, "0:rule", "exactly 2: one card, three cards, or the same card twice are refused (they must discard two)", () => {
  const { engine, id } = stupidifyBoard({ obsession: 4 });
  play(engine, P1, id("st"));
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] }), "only one card");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "no cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0"), id("oh1"), id("oh2")] }), "three cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0"), id("oh0")] }), "the same card twice");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the instruction standing");
  assert.equal(handOf(engine, P2).length, 4, "nothing moved while answers were refused");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0"), id("oh1")] });
  assert.equal(handOf(engine, P2).length, 2, "control: two cards is accepted");
});

clause(STUPIDIFY, "0:rule", "they may only discard from THEIR hand: my hand cards and cards in play are refused", () => {
  const { engine, id } = stupidifyBoard({ obsession: 4 });
  play(engine, P1, id("st"));
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0"), id("oh0")] }), "a card from MY hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mine"), id("oh0")] }), "a card in play");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh2"), id("oh3")] });
  assert.equal(zoneOf(engine, id("mh0")), "hand");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(STUPIDIFY, "0:rule", "with exactly 2 cards in hand they discard both; with 1 card they discard that card; with 0 nothing is asked", () => {
  const two = stupidifyBoard({ obsession: 4, oppHand: 2 });
  play(two.engine, P1, two.id("st"));
  drain(two.engine, pickTargets([two.id("oh0"), two.id("oh1")]));
  assert.equal(handOf(two.engine, P2).length, 0);
  assert.equal(discardOf(two.engine, P2).length, 2);

  const one = stupidifyBoard({ obsession: 4, oppHand: 1 });
  play(one.engine, P1, one.id("st"));
  drain(one.engine, pickTargets([one.id("oh0")]));
  assert.equal(handOf(one.engine, P2).length, 0);
  assert.deepEqual(discardOf(one.engine, P2), [one.id("oh0")]);

  const zero = stupidifyBoard({ obsession: 4, oppHand: 0 });
  play(zero.engine, P1, zero.id("st"));
  assert.equal(zero.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(zero.engine, zero.id("st")), "discard", "it resolved and went to my discard pile");
});

clause(STUPIDIFY, "0:rule", "it costs 3 and needs [O]: two resources are refused, and so are three resources with no [O]", () => {
  const two = stupidifyBoard({ obsession: 2 });
  refused(() => playRaw(two.engine, P1, two.id("st")), "two resources");
  assert.equal(zoneOf(two.engine, two.id("st")), "hand");
  const noO = stupidifyBoard({ obsession: 0, greed: 5 });
  refused(() => playRaw(noO.engine, P1, noO.id("st")), "no [O]");
  const good = stupidifyBoard({ obsession: 1, greed: 2 });
  play(good.engine, P1, good.id("st"));
  drain(good.engine, pickTargets([good.id("oh0"), good.id("oh1")]));
  assert.equal(zoneOf(good.engine, good.id("st")), "discard", "control: one [O] and 3 resources works");
  assert.equal(handOf(good.engine, P2).length, 2);
});

clause(STUPIDIFY, "0:rule", "it can be played in response on the opponent's turn", () => {
  const game = devBoard(
    [
      { key: "st", def: printing(STUPIDIFY), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...fillers("oh", 3, P2, "hand"),
      ...bank("obsession", 3, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playRaw(game.engine, P1, game.id("st"));
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
});

// RECUR

clause(STUPIDIFY, "1:ability:recur", "RECUR from my discard pile pays exactly 2, removes Stupidify from the game, and my opponent chooses 1 card to discard", () => {
  const { engine, id } = stupidifyBoard({ zone: "discard", obsession: 3 });
  const before = ready(engine);
  actRaw(engine, P1, id("st"), "recur");
  assert.equal(before - ready(engine), 2, "COST: Pay 2");
  assert.equal(zoneOf(engine, id("st")), "removed", "COST: Remove this card from the game");
  resolvePendingResponses(engine);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "my opponent chooses which card");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh2")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P2), [id("oh0"), id("oh1"), id("oh3")]);
  assert.deepEqual(discardOf(engine, P2), [id("oh2")]);
});

clause(STUPIDIFY, "1:ability:recur", "RECUR makes them discard exactly 1: two cards (or none) are refused", () => {
  const { engine, id } = stupidifyBoard({ zone: "discard", obsession: 3 });
  actRaw(engine, P1, id("st"), "recur");
  resolvePendingResponses(engine);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0"), id("oh1")] }), "two cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "no card");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] }), "a card from MY hand");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the instruction standing");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] });
  assert.equal(handOf(engine, P2).length, 3);
});

clause(STUPIDIFY, "1:ability:recur", "RECUR needs [O]: Greed alone is refused; and it pays 2 (one resource short is refused, spent [O] still meets the threshold)", () => {
  const greed = stupidifyBoard({ zone: "discard", obsession: 0, greed: 6 });
  refused(() => actRaw(greed.engine, P1, greed.id("st"), "recur"), "no [O]");
  assert.equal(zoneOf(greed.engine, greed.id("st")), "discard");
  assert.equal(ready(greed.engine), 6);

  const short = stupidifyBoard({ zone: "discard", obsession: 0, spentObsession: 1, greed: 1 });
  assert.equal(ready(short.engine), 1);
  refused(() => actRaw(short.engine, P1, short.id("st"), "recur"), "one resource short of pay 2");
  assert.equal(zoneOf(short.engine, short.id("st")), "discard");
  assert.equal(ready(short.engine), 1, "nothing was paid");

  const exact = stupidifyBoard({ zone: "discard", obsession: 1, greed: 1 });
  activate(exact.engine, P1, exact.id("st"), "recur");
  assert.equal(zoneOf(exact.engine, exact.id("st")), "removed", "control: one [O] and two resources works");
  assert.equal(ready(exact.engine), 0);
});

for (const zone of ["hand", "play"] as const) {
  clause(STUPIDIFY, "1:ability:recur", `'Use this only if this card is in your discard pile': refused while it is in ${zone === "play" ? "play" : "my hand"}`, () => {
    const bad = stupidifyBoard({ zone, obsession: 4 });
    refused(() => actRaw(bad.engine, P1, bad.id("st"), "recur"), `RECUR from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("st")), zone);
    assert.equal(ready(bad.engine), 4);
  });
}

clause(STUPIDIFY, "1:ability:recur", "'your discard pile': a Stupidify in MY OPPONENT's discard pile cannot be recurred by me", () => {
  const bad = stupidifyBoard({ zone: "discard", owner: P2, obsession: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("st"), "recur"), "using their Stupidify");
  assert.equal(zoneOf(bad.engine, bad.id("st")), "discard");
  assert.equal(ready(bad.engine), 4);
});

clause(STUPIDIFY, "1:ability:recur", "with an empty opposing hand RECUR can still be used: the costs are paid and nothing is discarded", () => {
  const { engine, id } = stupidifyBoard({ zone: "discard", obsession: 3, oppHand: 0 });
  activate(engine, P1, id("st"), "recur");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("st")), "removed");
  assert.equal(ready(engine), 1);
});

clause(STUPIDIFY, "1:ability:recur", "RECUR with a single card in their hand discards it", () => {
  const { engine, id } = stupidifyBoard({ zone: "discard", obsession: 3, oppHand: 1 });
  actRaw(engine, P1, id("st"), "recur");
  resolvePendingResponses(engine);
  drain(engine, pickTargets([id("oh0")]));
  assert.deepEqual(discardOf(engine, P2), [id("oh0")]);
});

// --- Thabbashite Haruspex ------------------------------------------------------
// When this card enters or leaves play, you may draw a card. If you do, put a
// card from your hand on the bottom of your deck.
// Character, cost 1, [O][O], 1 strength / 3 speed / 1 life.

const HARUSPEX = "f811f0b1-ff21-411d-9429-c12c7a2d4c7d";

function haruBoard(opts: { zone?: "hand" | "play"; deck?: number; hand?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "haru", def: printing(HARUSPEX), owner: P1, zone: opts.zone ?? "hand" },
    ...fillers("mh", opts.hand ?? 2, P1, "hand"),
    ...fillers("md", opts.deck ?? 4, P1, "deck"),
    ...fillers("oh", 2, P2, "hand"),
    ...fillers("od", 3, P2, "deck"),
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...bank("obsession", opts.obsession ?? 2, P1),
    ...(opts.extra ?? [])
  ]);
}

type HaruGame = ReturnType<typeof haruBoard>;

/** The Haruspex's "you may draw" question: asked of its controller; `yes` says yes. */
function haruAnswer(game: HaruGame, yes: boolean): void {
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "I (its controller) decide whether to draw");
  answerPending(game.engine, "chooserSelectsOption", { index: yes ? 1 : 0 });
}

clause(HARUSPEX, "0:rule", "entering play: I may draw the top card of my deck and then must put a chosen card from my hand on the bottom of my deck", () => {
  const game = haruBoard();
  const { engine, id } = game;
  const deck = deckOf(engine, P1);
  const handBefore = handOf(engine, P1).filter((c) => c !== id("haru"));
  playRaw(engine, P1, id("haru"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("haru")), "play", "control: it entered play");
  haruAnswer(game, true);
  assert.equal(handOf(engine, P1).length, handBefore.length + 1, "drew one card");
  assert.ok(handOf(engine, P1).includes(deck[0]), "the card drawn is the top card of my deck");
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mh1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1).sort(), [...handBefore.filter((c) => c !== id("mh1")), deck[0]].sort(), "net: the drawn card replaces the put-away one");
  assert.deepEqual(deckOf(engine, P1), [...deck.slice(1), id("mh1")], "the chosen card is on the bottom of my deck");
});

clause(HARUSPEX, "0:rule", "'you may': declining draws nothing and puts nothing on the bottom", () => {
  const game = haruBoard();
  const { engine, id } = game;
  const deck = deckOf(engine, P1);
  const hand = handOf(engine, P1).filter((c) => c !== id("haru"));
  play(engine, P1, id("haru"));
  haruAnswer(game, false);
  assert.equal(engine.state.pendingChoice, undefined, "nothing more is asked");
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.deepEqual(handOf(engine, P1), hand);
});

clause(HARUSPEX, "0:rule", "the card put on the bottom can be the card I just drew", () => {
  const game = haruBoard();
  const { engine, id } = game;
  const deck = deckOf(engine, P1);
  play(engine, P1, id("haru"));
  haruAnswer(game, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [deck[0]] });
  assert.deepEqual(deckOf(engine, P1), [...deck.slice(1), deck[0]], "the drawn card went straight to the bottom");
  assert.equal(handOf(engine, P1).includes(deck[0]), false);
});

clause(HARUSPEX, "0:rule", "the put is from MY hand only and is mandatory once I drew: my opponent's hand cards, cards in play, none and two are refused", () => {
  const game = haruBoard();
  const { engine, id } = game;
  play(engine, P1, id("haru"));
  haruAnswer(game, true);
  expectPending(engine, "chooserSelectsTarget");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oh0")] }), "the opponent's hand card");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mine")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "putting nothing");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0"), id("mh1")] }), "putting two");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the instruction standing");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] });
  assert.equal(deckOf(engine, P1)[deckOf(engine, P1).length - 1], id("mh0"));
});

clause(HARUSPEX, "0:rule", "my opponent's cards are not touched (hand and deck)", () => {
  const game = haruBoard();
  const { engine, id } = game;
  const oppHand = handOf(engine, P2);
  const oppDeck = deckOf(engine, P2);
  play(engine, P1, id("haru"));
  haruAnswer(game, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] });
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(HARUSPEX, "0:rule", "'If you do': when my deck is empty I cannot draw, so I do not put a card from my hand on the bottom (CR 402.5b)", () => {
  const game = haruBoard({ deck: 0 });
  const { engine, id } = game;
  const hand = handOf(engine, P1).filter((c) => c !== id("haru"));
  play(engine, P1, id("haru"));
  if (pending(engine)?.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(engine.state.pendingChoice, undefined, "no draw happened, so the dependent instruction is skipped: nothing is asked");
  assert.deepEqual(handOf(engine, P1), hand, "my hand is untouched");
  assert.equal(deckOf(engine, P1).length, 0);
});

for (const [how, make] of [
  ["destroyed", () => killTactic()],
  ["put into its owner's hand", () => moverTactic("hand")],
  ["put on top of its owner's deck", () => moverTactic("deck")],
  ["removed from the game", () => removerTactic()]
] as const) {
  clause(HARUSPEX, "0:rule", `leaving play (${how}): I may draw, and if I do I put a card from my hand on the bottom of my deck`, () => {
    const game = haruBoard({ zone: "play", extra: [{ key: "leaver", def: make(), owner: P1, zone: "hand" }] });
    const { engine, id } = game;
    useOn(game, "leaver", "haru");
    assert.notEqual(zoneOf(engine, id("haru")), "play", "control: it left play");
    const deckNow = deckOf(engine, P1);
    const handNow = handOf(engine, P1);
    haruAnswer(game, true);
    assert.deepEqual(handOf(engine, P1).sort(), [...handNow, deckNow[0]].sort(), "I drew the top card of my deck");
    const pc = expectPending(engine, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.deepEqual(deckOf(engine, P1), [...deckNow.slice(1), id("mh0")], "the chosen card is on the bottom of my deck");
  });
}

clause(HARUSPEX, "0:rule", "leaving play: I may decline, and then nothing is drawn", () => {
  const game = haruBoard({ zone: "play" });
  const { engine, id } = game;
  const deck = deckOf(engine, P1);
  useOn(game, "kill", "haru");
  assert.equal(zoneOf(engine, id("haru")), "discard", "control: it was destroyed");
  haruAnswer(game, false);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(HARUSPEX, "0:rule", "it triggers on BOTH entering and leaving: a full round trip offers the draw twice", () => {
  const game = haruBoard({ extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }], obsession: 4 });
  const { engine, id } = game;
  play(engine, P1, id("haru"));
  haruAnswer(game, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mh0")] });
  useOn(game, "kill", "haru");
  haruAnswer(game, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mh1")] });
  assert.equal(deckOf(engine, P1).length, 4, "two draws and two put-backs: the deck is the same size");
});

clause(HARUSPEX, "0:rule", "another character entering or leaving play asks nothing", () => {
  const game = haruBoard({ zone: "play", extra: [{ key: "newcomer", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("newcomer"));
  assert.equal(zoneOf(game.engine, game.id("newcomer")), "play", "control: another character entered");
  assert.equal(game.engine.state.pendingChoice, undefined, "entering: nothing asked");
  useOn(game, "kill", "newcomer");
  assert.equal(zoneOf(game.engine, game.id("newcomer")), "discard", "control: another character left");
  assert.equal(game.engine.state.pendingChoice, undefined, "leaving: nothing asked");
});

clause(HARUSPEX, "0:rule", "played as a face-down resource it has no rules text: no draw offer, and none when that resource leaves play", () => {
  const game = haruBoard({ extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("haru"), true);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("haru")].faceDown, true);
  assert.equal(game.engine.state.pendingChoice, undefined, "entering face-down asks nothing");
  useOn(game, "mv", "haru");
  assert.equal(zoneOf(game.engine, game.id("haru")), "hand", "control: it left play");
  assert.equal(game.engine.state.pendingChoice, undefined, "leaving face-down asks nothing");
});

clause(HARUSPEX, "0:rule", "it costs its printed 1 and needs [O][O]", () => {
  const good = haruBoard({ obsession: 2 });
  const before = ready(good.engine);
  playRaw(good.engine, P1, good.id("haru"));
  assert.equal(before - ready(good.engine), 1);
  const short = haruBoard({ obsession: 1, extra: bank("greed", 3, P1) });
  refused(() => playRaw(short.engine, P1, short.id("haru")), "one [O]");
  assert.equal(zoneOf(short.engine, short.id("haru")), "hand");
});

// --- Thabbashite Wizard --------------------------------------------------------
// When this card enters play, both players may draw up to 2 cards.
// Character, cost 3, [O][O], 2 strength / 3 speed / 2 life.

const TWIZARD = "2c419c3a-cd05-4d6c-b6c4-6d2e64655218";

function twizardBoard(opts: { myDeck?: number; oppDeck?: number; zone?: "hand" | "play"; obsession?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return devBoard(
    [
      { key: "tw", def: printing(TWIZARD), owner: P1, zone: opts.zone ?? "hand" },
      ...fillers("mh", 1, P1, "hand"),
      ...fillers("oh", 1, P2, "hand"),
      ...fillers("md", opts.myDeck ?? 5, P1, "deck"),
      ...fillers("od", opts.oppDeck ?? 5, P2, "deck"),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...(opts.extra ?? [])
    ],
    { activePlayerId: active, turn: active === P1 ? 1 : 2 }
  );
}

type TWGame = ReturnType<typeof twizardBoard>;

function chooseNumber(game: TWGame, player: PlayerId, value: number): void {
  const pc = expectPending(game.engine, "chooseNumber");
  assert.equal(pc.playerId, player, `${player} chooses how many to draw`);
  answerPending(game.engine, "chooseNumber", { value });
}

clause(TWIZARD, "0:rule", "when it enters play each player chooses how many cards (0 to 2) to draw, the active player first, and draws that many from their own deck", () => {
  const game = twizardBoard();
  const { engine, id } = game;
  const myDeck = deckOf(engine, P1);
  const oppDeck = deckOf(engine, P2);
  play(engine, P1, id("tw"));
  assert.equal(zoneOf(engine, id("tw")), "play", "control: it entered play");
  const first = expectPending(engine, "chooseNumber");
  assert.equal(first.playerId, P1, "the active player (me) decides first");
  assert.equal(first.min, 0);
  assert.equal(first.max, 2);
  answerPending(engine, "chooseNumber", { value: 2 });
  chooseNumber(game, P2, 1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), [id("mh0"), ...myDeck.slice(0, 2)], "I drew the top 2 of my deck, in order");
  assert.deepEqual(handOf(engine, P2), [id("oh0"), ...oppDeck.slice(0, 1)], "my opponent drew the top card of their deck");
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(2));
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(1));
});

for (const [mine, theirs] of [
  [0, 0],
  [0, 2],
  [2, 0],
  [1, 1],
  [2, 2]
] as const) {
  clause(TWIZARD, "0:rule", `each player picks their own number: I draw ${mine}, my opponent draws ${theirs}`, () => {
    const game = twizardBoard();
    const { engine, id } = game;
    play(engine, P1, id("tw"));
    chooseNumber(game, P1, mine);
    chooseNumber(game, P2, theirs);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(handOf(engine, P1).length, 1 + mine);
    assert.equal(handOf(engine, P2).length, 1 + theirs);
    assert.equal(deckOf(engine, P1).length, 5 - mine);
    assert.equal(deckOf(engine, P2).length, 5 - theirs);
  });
}

clause(TWIZARD, "0:rule", "'up to 2': 3 and negative numbers are refused for either player, and the question stays open", () => {
  const game = twizardBoard();
  const { engine, id } = game;
  play(engine, P1, id("tw"));
  expectPending(engine, "chooseNumber");
  refused(() => answerPending(engine, "chooseNumber", { value: 3 }), "drawing 3");
  refused(() => answerPending(engine, "chooseNumber", { value: -1 }), "drawing -1");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the question standing");
  chooseNumber(game, P1, 2);
  expectPending(engine, "chooseNumber");
  refused(() => answerPending(engine, "chooseNumber", { value: 3 }), "the opponent drawing 3");
  if (!engine.state.pendingChoice) assert.fail("refused answers must leave the question standing");
  chooseNumber(game, P2, 0);
  assert.equal(handOf(engine, P2).length, 1);
});

clause(TWIZARD, "0:rule", "the number of cards is a whole number (CR 410.2): 1.5 is refused", () => {
  const game = twizardBoard();
  play(game.engine, P1, game.id("tw"));
  expectPending(game.engine, "chooseNumber");
  refused(() => answerPending(game.engine, "chooseNumber", { value: 1.5 }), "drawing 1.5 cards");
  if (!game.engine.state.pendingChoice) assert.fail("the refused answer must leave the question standing");
  assert.equal(handOf(game.engine, P1).length, 1, "no card was drawn for 1.5");
});

clause(TWIZARD, "0:rule", "a deck with fewer cards than chosen: draw what is there (1 card left, choose 2)", () => {
  const game = twizardBoard({ myDeck: 1, oppDeck: 0 });
  const { engine, id } = game;
  play(engine, P1, id("tw"));
  chooseNumber(game, P1, 2);
  chooseNumber(game, P2, 2);
  assert.equal(handOf(engine, P1).length, 2, "drew the one card there was");
  assert.equal(handOf(engine, P2).length, 1, "an empty deck draws nothing");
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game (CR 102.1a)");
});

clause(TWIZARD, "0:rule", "on my opponent's turn the opponent (the active player) decides first (put into play during their turn)", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = twizardBoard({
    active: P2,
    extra: [
      { key: "put", def: putter, owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }
    ]
  });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  playRaw(engine, P1, id("put"), { selected: { t: [id("tw")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("tw")), "play", "control: the Wizard entered play during my opponent's turn");
  const first = expectPending(engine, "chooseNumber");
  assert.equal(first.playerId, P2, "the active player (my opponent) decides first");
  answerPending(engine, "chooseNumber", { value: 1 });
  chooseNumber(game, P1, 1);
  assert.equal(handOf(engine, P2).length, 2);
  assert.equal(handOf(engine, P1).length, 2);
});

clause(TWIZARD, "0:rule", "it triggers when put into play by an effect too, and only on entering (not on leaving)", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = twizardBoard({ extra: [{ key: "put", def: putter, owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("put"), { selected: { t: [id("tw")] } });
  assert.equal(zoneOf(engine, id("tw")), "play", "control: put into play");
  chooseNumber(game, P1, 0);
  chooseNumber(game, P2, 0);
  useOn(game, "mv", "tw");
  assert.equal(zoneOf(engine, id("tw")), "hand", "control: it left play");
  assert.equal(engine.state.pendingChoice, undefined, "leaving play asks nothing");
});

clause(TWIZARD, "0:rule", "played as a face-down resource it has no rules text: nobody draws", () => {
  const game = twizardBoard();
  developResource(game.engine, P1, game.id("tw"), true);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("tw")].faceDown, true);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(handOf(game.engine, P2).length, 1);
});

clause(TWIZARD, "0:rule", "it costs its printed 3 and needs [O][O]", () => {
  const good = twizardBoard({ obsession: 3 });
  const before = ready(good.engine);
  playRaw(good.engine, P1, good.id("tw"));
  assert.equal(before - ready(good.engine), 3);
  const short = twizardBoard({ obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("tw")), "two resources");
  const noO = twizardBoard({ obsession: 1, extra: bank("greed", 4, P1) });
  refused(() => playRaw(noO.engine, P1, noO.id("tw")), "one [O]");
});

// --- Unimportant Wizard --------------------------------------------------------
// FLIP UP: 0 [O]
// Character, cost 1, [O], 1 strength / 3 speed / 2 life.

const UWIZARD = "8637871a-630c-4b97-b96e-625906231092";

function uwizardBoard(opts: { obsession?: number; rage?: number; oppObsession?: number; faceDown?: boolean; zone?: "play" | "hand"; active?: PlayerId } = {}) {
  const active = opts.active ?? P1;
  return devBoard(
    [
      { key: "uw", def: printing(UWIZARD), owner: P1, zone: opts.zone ?? "play", faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown ?? true : undefined },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("obsession", opts.oppObsession ?? 0, P2),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ],
    { activePlayerId: active, turn: active === P1 ? 1 : 2 }
  );
}

type UWGame = ReturnType<typeof uwizardBoard>;
const flipUW = (game: UWGame, player: PlayerId = P1): void => flipUpRaw(game.engine, player, game.id("uw"));

clause(UWIZARD, "0:flipUp", "a face-down Unimportant Wizard flips up for 0 into a face-up character with its printed 1/3/2 stats", () => {
  const game = uwizardBoard({ obsession: 1 });
  const printed = printing(UWIZARD);
  assert.deepEqual(game.engine.getCardTypes(game.id("uw")), ["resource"]);
  flipUW(game);
  resolvePendingResponses(game.engine);
  const uw = game.engine.state.cards[game.id("uw")];
  assert.equal(uw.zone, "play");
  assert.equal(uw.faceDown, false);
  assert.deepEqual(game.engine.getCardTypes(game.id("uw")), ["character"]);
  assert.equal(game.engine.getStat(game.id("uw"), "strength"), printed.strength);
  assert.equal(game.engine.getStat(game.id("uw"), "speed"), printed.speed);
  assert.equal(game.engine.getStat(game.id("uw"), "life"), printed.life);
  assert.equal(game.engine.isResource(game.id("uw")), false);
});

clause(UWIZARD, "0:flipUp", "pays nothing (cost 0): with plenty of resources none are attached, and only the face-down card itself leaves the pool", () => {
  const game = uwizardBoard({ obsession: 1, rage: 4 });
  assert.equal(ready(game.engine), 6, "5 banks and the face-down Wizard");
  flipUW(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, false);
  assert.equal(ready(game.engine), 5, "all 5 banks are still ready; nothing was paid (not even its printed cost of 1)");
});

clause(UWIZARD, "0:flipUp", "needs [O]: with no Obsession (only Rage and its own Volition) it is refused", () => {
  const game = uwizardBoard({ obsession: 0, rage: 6 });
  refused(() => flipUW(game), "no [O]");
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, true);
  assert.equal(ready(game.engine), 7);
});

clause(UWIZARD, "0:flipUp", "its own Volition is not [O]: alone on the board it cannot flip up", () => {
  const game = uwizardBoard();
  refused(() => flipUW(game), "only its own Volition");
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, true);
});

clause(UWIZARD, "0:flipUp", "my opponent's Obsession does not meet the threshold", () => {
  const game = uwizardBoard({ rage: 2, oppObsession: 3 });
  refused(() => flipUW(game), "their [O]");
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, true);
});

clause(UWIZARD, "0:flipUp", "a single [O] is all it takes", () => {
  const game = uwizardBoard({ obsession: 1 });
  flipUW(game);
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, false);
});

clause(UWIZARD, "0:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn", () => {
  const game = uwizardBoard({ obsession: 2, active: P2 });
  refused(() => flipUW(game), "the opponent's turn");
  assert.equal(game.engine.state.cards[game.id("uw")].faceDown, true);
});

clause(UWIZARD, "0:flipUp", "the flipped-up Wizard is a new arrival: it cannot attack the turn it was flipped", () => {
  const game = uwizardBoard({ obsession: 1 });
  flipUW(game);
  resolvePendingResponses(game.engine);
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("uw")], target: { type: "faction", playerId: P2 } }),
    "a character that just flipped up cannot attack",
    /did not start the turn in play/
  );
});

clause(UWIZARD, "0:flipUp", "cannot be flipped up when already face-up, from the hand, or by the opponent", () => {
  const faceUp = uwizardBoard({ obsession: 2, faceDown: false });
  refused(() => flipUW(faceUp), "already face-up");
  const inHand = uwizardBoard({ obsession: 2, zone: "hand" });
  refused(() => flipUW(inHand), "in hand");
  const theirs = uwizardBoard({ obsession: 2 });
  refused(() => flipUW(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("uw")].faceDown, true);
});

clause(UWIZARD, "0:flipUp", "FLIP UP is an alternative: deployed from the hand the Wizard costs its printed 1 and needs [O]", () => {
  const good = uwizardBoard({ zone: "hand", obsession: 1 });
  const before = ready(good.engine);
  playRaw(good.engine, P1, good.id("uw"));
  assert.equal(before - ready(good.engine), 1, "the printed cost of 1");
  const noResources = uwizardBoard({ zone: "hand" });
  refused(() => playRaw(noResources.engine, P1, noResources.id("uw")), "no resources");
  const noO = uwizardBoard({ zone: "hand", rage: 3 });
  refused(() => playRaw(noO.engine, P1, noO.id("uw")), "no [O]");
});

// --- Virulent Dogmatist --------------------------------------------------------
// BERATE -- COST: Pay 2. Deplete this card. Pick a character. -- EFFECT: This
// turn, the character loses 2 strength or 1 speed.
// Character, cost 2, [O], 1 strength / 3 speed / 1 life.

const DOGMATIST = "aa714d4f-ff39-49a0-bd14-56abc772cbea";

function dogBoard(opts: { rage?: number; dogZone?: "play" | "hand"; depleted?: boolean; fresh?: boolean; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  const active = opts.active ?? P1;
  return devBoard(
    [
      { key: "dog", def: printing(DOGMATIST), owner: P1, zone: opts.dogZone ?? "play", depleted: opts.depleted, attackEligible: opts.fresh ? false : undefined },
      { key: "big", def: character({ name: "Big", strength: 4, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 6, speed: 0 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 2, P1),
      ...(opts.extra ?? [])
    ],
    { activePlayerId: active, turn: active === P1 ? 1 : 2 }
  );
}

type DogGame = ReturnType<typeof dogBoard>;

/** BERATE on `key`, then the controller's "2 strength or 1 speed" choice (0 = strength, 1 = speed). */
function berate(game: DogGame, key: string, option: 0 | 1): void {
  activate(game.engine, P1, game.id("dog"), "berate", { selected: { c: [game.id(key)] } });
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Dogmatist's controller chooses between 2 strength and 1 speed");
  answerPending(game.engine, "chooserSelectsOption", { index: option });
  assert.equal(game.engine.state.pendingChoice, undefined);
}

const statsOf = (game: DogGame, key: string) => ({
  strength: game.engine.getStat(game.id(key), "strength"),
  life: game.engine.getStat(game.id(key), "life"),
  speed: game.engine.getStat(game.id(key), "speed")
});

clause(DOGMATIST, "0:ability:berate", "pays exactly 2, depletes the Dogmatist, and (option 'strength') the picked character loses exactly 2 strength this turn", () => {
  const game = dogBoard({ rage: 4 });
  const before = ready(game.engine);
  actRaw(game.engine, P1, game.id("dog"), "berate", { c: [game.id("foe")] });
  assert.equal(before - ready(game.engine), 2, "COST: Pay 2");
  assert.equal(game.engine.state.cards[game.id("dog")].depleted, true, "COST: Deplete this card");
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  assert.deepEqual(statsOf(game, "foe"), { strength: 2, life: 6, speed: 3 }, "2 strength lost, nothing else");
  assert.deepEqual(statsOf(game, "big"), { strength: 4, life: 6, speed: 3 }, "another character is untouched");
});

clause(DOGMATIST, "0:ability:berate", "(option 'speed') the picked character loses exactly 1 speed this turn and keeps its strength", () => {
  const game = dogBoard();
  berate(game, "foe", 1);
  assert.deepEqual(statsOf(game, "foe"), { strength: 4, life: 6, speed: 2 }, "1 speed lost, nothing else");
  assert.deepEqual(statsOf(game, "big"), { strength: 4, life: 6, speed: 3 });
});

clause(DOGMATIST, "0:ability:berate", "it may pick my own character, or the Dogmatist itself", () => {
  const mine = dogBoard();
  berate(mine, "big", 0);
  assert.equal(mine.engine.getStat(mine.id("big"), "strength"), 2);
  const itself = dogBoard();
  berate(itself, "dog", 1);
  assert.equal(itself.engine.getStat(itself.id("dog"), "speed"), printing(DOGMATIST).speed! - 1, "the Dogmatist lost 1 speed");
  assert.equal(itself.engine.state.cards[itself.id("dog")].depleted, true);
});

clause(DOGMATIST, "0:ability:berate", "the loss lasts this turn only: it is gone when the turn ends", () => {
  const game = dogBoard();
  berate(game, "foe", 0);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 2);
  endTurn(game.engine, P1);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 4, "back to normal in the opponent's turn");
  const speed = dogBoard();
  berate(speed, "foe", 1);
  assert.equal(speed.engine.getStat(speed.id("foe"), "speed"), 2);
  endTurn(speed.engine, P1);
  assert.equal(speed.engine.getStat(speed.id("foe"), "speed"), 3);
});

clause(DOGMATIST, "0:ability:berate", "a character cannot lose more strength than it has (CR 410.4): a 1-strength character that loses 2 has 0 strength, not -1", () => {
  const game = dogBoard();
  berate(game, "weak", 0);
  assert.equal(game.engine.getStat(game.id("weak"), "strength"), 0);
});

clause(DOGMATIST, "0:ability:berate", "a 0-speed character that loses 1 speed stays at 0 speed (CR 410.4), not -1", () => {
  const game = dogBoard();
  berate(game, "weak", 1);
  assert.equal(game.engine.getStat(game.id("weak"), "speed"), 0);
});

clause(DOGMATIST, "0:ability:berate", "it has no threshold of its own: two Rage resources and no Obsession are enough", () => {
  const game = dogBoard({ rage: 2 });
  assert.deepEqual(game.engine.getThresholds(P1), { rage: 2 });
  berate(game, "foe", 0);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 2);
  assert.equal(ready(game.engine), 0);
});

clause(DOGMATIST, "0:ability:berate", "is refused one resource short of its pay-2 (nothing is depleted or paid)", () => {
  const bad = dogBoard({ rage: 1 });
  refused(() => actRaw(bad.engine, P1, bad.id("dog"), "berate", { c: [bad.id("foe")] }), "1 resource");
  assert.equal(bad.engine.state.cards[bad.id("dog")].depleted, false, "the Dogmatist was not depleted");
  assert.equal(ready(bad.engine), 1);
  const none = dogBoard({ rage: 0 });
  refused(() => actRaw(none.engine, P1, none.id("dog"), "berate", { c: [none.id("foe")] }), "no resources");
});

clause(DOGMATIST, "0:ability:berate", "cannot be used while the Dogmatist is depleted, and then only once per restore (the second use the same turn is refused)", () => {
  const depleted = dogBoard({ rage: 4, depleted: true });
  refused(() => actRaw(depleted.engine, P1, depleted.id("dog"), "berate", { c: [depleted.id("foe")] }), "already depleted");
  assert.equal(ready(depleted.engine), 4, "nothing was paid");
  const twice = dogBoard({ rage: 4 });
  berate(twice, "foe", 0);
  refused(() => actRaw(twice.engine, P1, twice.id("dog"), "berate", { c: [twice.id("big")] }), "second use while depleted");
  assert.equal(ready(twice.engine), 2);
});

clause(DOGMATIST, "0:ability:berate", "it is restored at the start of my next turn and can be used again", () => {
  const game = dogBoard({ rage: 2 });
  berate(game, "foe", 0);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.state.cards[game.id("dog")].depleted, false, "restored");
  assert.equal(ready(game.engine), 2, "resources detached again");
  berate(game, "foe", 1);
  assert.equal(game.engine.getStat(game.id("foe"), "speed"), 2);
});

clause(DOGMATIST, "0:ability:berate", "a character may use its abilities the turn it enters play (CR 204.3a), though it cannot attack", () => {
  const game = dogBoard({ fresh: true, rage: 2 });
  berate(game, "foe", 0);
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), 2);
});

for (const [key, why] of [
  ["thing", "an item"],
  ["place", "a location"],
  ["res", "a resource"],
  ["fd", "a face-down card"],
  ["inHand", "a character card in my hand"],
  ["inDiscard", "a character card in my discard pile"]
] as const) {
  clause(DOGMATIST, "0:ability:berate", `cannot pick ${why}; nothing is paid or depleted`, () => {
    const extras = (): CardPlacement[] => [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Face Down" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }
    ];
    const bad = dogBoard({ rage: 2, extra: extras() });
    refused(() => actRaw(bad.engine, P1, bad.id("dog"), "berate", { c: [bad.id(key)] }), `picking ${why}`);
    assert.equal(bad.engine.state.cards[bad.id("dog")].depleted, false);
    assert.equal(ready(bad.engine), 2);
    const good = dogBoard({ rage: 2, extra: extras() });
    berate(good, "foe", 0);
    assert.equal(good.engine.getStat(good.id("foe"), "strength"), 2, "control: a character pick works");
  });
}

clause(DOGMATIST, "0:ability:berate", "cannot pick a faction, and needs exactly one pick", () => {
  const bad = dogBoard({ rage: 4 });
  refused(() => actRaw(bad.engine, P1, bad.id("dog"), "berate", { c: [bad.engine.state.players[P2].factionId!] }), "a faction");
  refused(() => actRaw(bad.engine, P1, bad.id("dog"), "berate", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("dog"), "berate", { c: [bad.id("foe"), bad.id("big")] }), "two picks");
  assert.equal(bad.engine.state.cards[bad.id("dog")].depleted, false);
  assert.equal(ready(bad.engine), 4);
});

clause(DOGMATIST, "0:ability:berate", "can only be used from play (refused from my hand) and only by its controller", () => {
  const inHand = dogBoard({ dogZone: "hand", rage: 2 });
  refused(() => actRaw(inHand.engine, P1, inHand.id("dog"), "berate", { c: [inHand.id("foe")] }), "from my hand");
  assert.equal(ready(inHand.engine), 2);
  const game = dogBoard({ rage: 2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(game.engine, P2, game.id("dog"), "berate", { c: [game.id("foe")] }), "my opponent using my Dogmatist", /control|own|cannot|illegal|only/i);
  assert.equal(game.engine.state.cards[game.id("dog")].depleted, false);
});

clause(DOGMATIST, "0:ability:berate", "can be used in response on the opponent's turn (CR 502.3)", () => {
  const game = dogBoard({ rage: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1);
  actRaw(game.engine, P1, game.id("dog"), "berate", { c: [game.id("atk")] });
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(game.engine.getStat(game.id("atk"), "strength"), 1, "the attacker lost 2 strength");
});

clause(DOGMATIST, "0:ability:berate", "the loss is real in battle: a 4-strength attacker that lost 2 strength deals only 2 damage", () => {
  const game = dogBoard({ rage: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  actRaw(game.engine, P1, game.id("dog"), "berate", { c: [game.id("atk")] });
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, [game.id("big")]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("big")].damage, 2, "4 - 2 = 2 damage to the blocker");
});

// --- Wand of Possession --------------------------------------------------------
// POSSESS -- COST: Pay 2. Deplete this card. -- EFFECT: Put a Micromajig token
// with COVERT into play.
// Item, cost 2, [O][O][O].

const WAND = "377f9b57-2c1d-4009-8e3a-8e9739e1d0c4";

function wandBoard(opts: { rage?: number; zone?: "play" | "hand"; depleted?: boolean; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return devBoard(
    [
      { key: "wand", def: printing(WAND), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 2, P1),
      ...(opts.extra ?? [])
    ],
    { activePlayerId: active, turn: opts.turn ?? (active === P1 ? 1 : 2) }
  );
}

type WandGame = ReturnType<typeof wandBoard>;

/** Every Micromajig token in play under `player`'s control. */
const micromajigs = (game: { engine: SpoilsEngine }, player: PlayerId = P1): CardInstanceId[] =>
  playOf(game.engine, player).filter((c) => game.engine.getDefinition(c).name === "Micromajig");

clause(WAND, "0:ability:possess", "pays exactly 2, depletes the Wand, and puts exactly one Micromajig token into play under my control", () => {
  const game = wandBoard({ rage: 4 });
  const before = ready(game.engine);
  actRaw(game.engine, P1, game.id("wand"), "possess");
  assert.equal(before - ready(game.engine), 2, "COST: Pay 2");
  assert.equal(game.engine.state.cards[game.id("wand")].depleted, true, "COST: Deplete this card");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  const tokens = micromajigs(game);
  assert.equal(tokens.length, 1, "exactly one token");
  assert.equal(game.engine.state.cards[tokens[0]].controllerId, P1);
  assert.equal(game.engine.state.cards[tokens[0]].ownerId, P1);
  assert.equal(micromajigs(game, P2).length, 0);
});

clause(WAND, "0:ability:possess", "the token is a Micromajig character: 1 strength, 3 speed, 1 life, subtype majig (CR 409.3c.1)", () => {
  const game = wandBoard();
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  assert.ok(token, "a token exists");
  assert.deepEqual(game.engine.getCardTypes(token), ["character"]);
  assert.equal(game.engine.getStat(token, "strength"), 1);
  assert.equal(game.engine.getStat(token, "speed"), 3);
  assert.equal(game.engine.getStat(token, "life"), 1);
  assert.deepEqual(game.engine.getSubtypes(token), ["majig"]);
  assert.equal(game.engine.getDefinition(token).name, "Micromajig");
});

clause(WAND, "0:ability:possess","the Micromajig token is a Gearsmith character (CR 409.3c.1), not a universal one", () => {
  const game = wandBoard();
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  assert.ok(token, "a token exists");
  assert.equal(game.engine.getDefinition(token).trade, "gearsmith");
});

clause(WAND, "0:ability:possess", "the token has COVERT, so a party of only the token cannot be blocked by a non-covert character", () => {
  const game = wandBoard({ turn: 2, extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  assert.ok(game.engine.getKeywords(token).includes("covert"), "the token has COVERT");
  assert.equal(game.engine.getKeywords(game.id("mine")).includes("covert"), false, "another character does not");
});

clause(WAND, "0:ability:possess", "the COVERT is real in battle: the token cannot be blocked by a plain character (token attacks the next turn)", () => {
  const game = wandBoard({ extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.ok(game.engine.getKeywords(token).includes("covert"), "COVERT is permanent, not this-turn-only");
  declareAttackBy(game.engine, P1, [token]);
  refused(() => declareBlockers(game.engine, P2, [game.id("foe")]), "a plain character cannot block a covert party");
});

clause(WAND, "0:ability:possess", "the token is a new arrival: it cannot attack the turn it is created", () => {
  const game = wandBoard();
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  refused(
    () => game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [token], target: { type: "faction", playerId: P2 } }),
    "a token that just entered play cannot attack",
    /did not start the turn in play/
  );
});

clause(WAND, "0:ability:possess", "the ability has no threshold of its own: two Rage resources and no Obsession are enough", () => {
  const game = wandBoard({ rage: 2 });
  assert.deepEqual(game.engine.getThresholds(P1), { rage: 2 });
  activate(game.engine, P1, game.id("wand"), "possess");
  assert.equal(micromajigs(game).length, 1);
  assert.equal(ready(game.engine), 0);
});

clause(WAND, "0:ability:possess", "is refused one resource short of its pay-2 (nothing is depleted, no token)", () => {
  const bad = wandBoard({ rage: 1 });
  refused(() => actRaw(bad.engine, P1, bad.id("wand"), "possess"), "1 resource");
  assert.equal(bad.engine.state.cards[bad.id("wand")].depleted, false);
  assert.equal(ready(bad.engine), 1);
  assert.equal(micromajigs(bad).length, 0);
});

clause(WAND, "0:ability:possess", "cannot be used while the Wand is depleted: a second use the same turn is refused, and no second token appears", () => {
  const depleted = wandBoard({ rage: 4, depleted: true });
  refused(() => actRaw(depleted.engine, P1, depleted.id("wand"), "possess"), "already depleted");
  assert.equal(micromajigs(depleted).length, 0);
  assert.equal(ready(depleted.engine), 4);
  const twice = wandBoard({ rage: 4 });
  activate(twice.engine, P1, twice.id("wand"), "possess");
  refused(() => actRaw(twice.engine, P1, twice.id("wand"), "possess"), "second use");
  assert.equal(micromajigs(twice).length, 1);
  assert.equal(ready(twice.engine), 2);
});

clause(WAND, "0:ability:possess", "once restored (next turn) it makes a second token", () => {
  const game = wandBoard({ rage: 2 });
  activate(game.engine, P1, game.id("wand"), "possess");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.cards[game.id("wand")].depleted, false, "restored");
  activate(game.engine, P1, game.id("wand"), "possess");
  assert.equal(micromajigs(game).length, 2);
});

clause(WAND, "0:ability:possess", "can only be used from play and only by its controller", () => {
  const inHand = wandBoard({ zone: "hand", rage: 2 });
  refused(() => actRaw(inHand.engine, P1, inHand.id("wand"), "possess"), "from my hand");
  const game = wandBoard({ rage: 2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P1, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(game.engine, P2, game.id("wand"), "possess"), "my opponent using my Wand", /control|own|cannot|illegal|only/i);
  assert.equal(micromajigs(game, P2).length, 0);
  assert.equal(micromajigs(game, P1).length, 0);
});

clause(WAND, "0:ability:possess", "can be used in response on the opponent's turn: the token comes in under my control", () => {
  const game = wandBoard({ rage: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  actRaw(game.engine, P1, game.id("wand"), "possess");
  resolvePendingResponses(game.engine);
  assert.equal(micromajigs(game, P1).length, 1);
  assert.equal(micromajigs(game, P2).length, 0);
});

clause(WAND, "0:ability:possess", "the token is a real character: a tactic can destroy it, and it then vanishes (a token does not go to the discard pile or hand)", () => {
  const game = wandBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }, ...bank("rage", 0, P1)] });
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  assert.ok(token, "token");
  const discardBefore = discardOf(game.engine, P1).length;
  const handBefore = handOf(game.engine, P1).length;
  play(game.engine, P1, game.id("kill"), { selected: { t: [token] } });
  const gone = game.engine.state.cards[token];
  assert.ok(!gone || gone.zone !== "play", "control: the token was destroyed");
  assert.equal(micromajigs(game).length, 0);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "(only the tactic left my hand) the token did not go to my hand");
  assert.equal(discardOf(game.engine, P1).includes(token), false, "a token is not put into the discard pile");
  assert.equal(discardOf(game.engine, P1).length, discardBefore + 1, "only the tactic joined the discard pile");
});

clause(WAND, "0:ability:possess", "a token sent to its owner's hand disappears; it is not a card in my hand", () => {
  const game = wandBoard({ extra: [{ key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  activate(game.engine, P1, game.id("wand"), "possess");
  const [token] = micromajigs(game);
  assert.ok(token, "token");
  const handBefore = handOf(game.engine, P1).length;
  play(game.engine, P1, game.id("mv"), { selected: { t: [token] } });
  assert.equal(micromajigs(game).length, 0, "no longer in play");
  assert.equal(handOf(game.engine, P1).includes(token), false, "a token does not go to a hand");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1);
});

// --- Wanton Wizard -------------------------------------------------------------
// When this card enters play, you may pick a tactic in your discard pile. If
// you do, put it into play as a face-down resource under your control.
// Character, cost 3, [O], 1 strength / 3 speed / 1 life.

const WANTON = "6158af7e-bebf-4eff-8b76-d5d6f33fff36";

function wantonBoard(opts: { obsession?: number; zone?: "hand" | "play"; withTactics?: boolean; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "ww", def: printing(WANTON), owner: P1, zone: opts.zone ?? "hand" },
    ...(opts.withTactics === false
      ? []
      : [
          { key: "past", def: tactic({ name: "Past Tactic" }), owner: P1, zone: "discard" as const },
          { key: "past2", def: tactic({ name: "Past Tactic Two" }), owner: P1, zone: "discard" as const }
        ]),
    { key: "theirPast", def: tactic({ name: "Their Past Tactic" }), owner: P2, zone: "discard" },
    { key: "pastChar", def: character({ name: "Past Character" }), owner: P1, zone: "discard" },
    { key: "pastItem", def: item({ name: "Past Item" }), owner: P1, zone: "discard" },
    { key: "handTactic", def: tactic({ name: "Hand Tactic" }), owner: P1, zone: "hand" },
    { key: "deckTactic", def: tactic({ name: "Deck Tactic" }), owner: P1, zone: "deck" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...bank("obsession", opts.obsession ?? 3, P1),
    ...(opts.extra ?? [])
  ]);
}

type WantonGame = ReturnType<typeof wantonBoard>;

/** Enter play and arrive at the optional pick (a `chooserSelectsTarget` for my controller). */
function wantonEnter(game: WantonGame): void {
  play(game.engine, P1, game.id("ww"));
  assert.equal(zoneOf(game.engine, game.id("ww")), "play", "control: it entered play");
}

clause(WANTON, "0:rule", "I may pick a tactic in my discard pile and it is put into play face-down as a resource under my control", () => {
  const game = wantonBoard();
  const { engine, id } = game;
  const readyBefore = ready(engine);
  const volitionBefore = engine.getThresholds(P1).volition ?? 0;
  wantonEnter(game);
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I make the pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("past")] });
  assert.equal(engine.state.pendingChoice, undefined);
  const card = engine.state.cards[id("past")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.controllerId, P1, "under my control");
  assert.equal(card.ownerId, P1);
  assert.equal(engine.isResource(id("past")), true, "a face-down card is a resource");
  assert.equal(discardOf(engine, P1).includes(id("past")), false, "it left the discard pile");
  assert.equal(engine.getThresholds(P1).volition, volitionBefore + 1, "it provides one Volition");
  assert.equal(ready(engine), readyBefore - 3 + 1, "3 paid for the Wizard, and the new resource is ready to pay with");
  assert.equal(zoneOf(engine, id("past2")), "discard", "the other tactic stays");
});

clause(WANTON, "0:rule", "'you may': I can decline the pick and nothing changes", () => {
  const game = wantonBoard();
  const { engine, id } = game;
  wantonEnter(game);
  expectPending(engine, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("past")), "discard");
  assert.equal(zoneOf(engine, id("past2")), "discard");
  assert.equal(engine.getThresholds(P1).volition, undefined, "no new resource");
});

for (const [key, why] of [
  ["theirPast", "a tactic in MY OPPONENT's discard pile"],
  ["handTactic", "a tactic in my hand"],
  ["deckTactic", "a tactic in my deck"],
  ["pastChar", "a character in my discard pile"],
  ["pastItem", "an item in my discard pile"],
  ["mine", "a character in play"]
] as const) {
  clause(WANTON, "0:rule", `cannot pick ${why}`, () => {
    const bad = wantonBoard();
    wantonEnter(bad);
    expectPending(bad.engine, "chooserSelectsTarget");
    refused(() => answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id(key)] }), `picking ${why}`);
    if (!bad.engine.state.pendingChoice) assert.fail("the refused pick must leave the question standing");
    answerPending(bad.engine, "chooserSelectsTarget", { selected: [bad.id("past")] });
    assert.equal(bad.engine.state.cards[bad.id("past")].faceDown, true, "control: a tactic in my discard pile is accepted");
  });
}

clause(WANTON, "0:rule", "only ONE tactic: two picks are refused", () => {
  const game = wantonBoard();
  wantonEnter(game);
  expectPending(game.engine, "chooserSelectsTarget");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("past"), game.id("past2")] }), "two tactics");
  if (!game.engine.state.pendingChoice) assert.fail("the refused pick must leave the question standing");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("past2")] });
  assert.equal(game.engine.state.cards[game.id("past2")].zone, "play");
  assert.equal(game.engine.state.cards[game.id("past")].zone, "discard");
});

clause(WANTON, "0:rule", "with no tactic in my discard pile nothing is asked", () => {
  const game = wantonBoard({ withTactics: false });
  wantonEnter(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(WANTON, "0:rule", "the face-down tactic really is a usable resource: it pays for the next card", () => {
  const game = wantonBoard({ obsession: 3, extra: [{ key: "five", def: character({ name: "Cost One", cost: 1 }), owner: P1, zone: "hand" }] });
  wantonEnter(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("past")] });
  assert.equal(ready(game.engine), 1, "only the new face-down resource is left to pay with");
  playRaw(game.engine, P1, game.id("five"));
  assert.equal(ready(game.engine), 0, "it paid the 1");
  assert.equal(game.engine.state.cards[game.id("past")].attachedTo, game.engine.state.players[P1].factionId, "...by attaching to my faction");
});

clause(WANTON, "0:rule", "it triggers when the Wizard is put into play by an effect too, but not when it leaves play", () => {
  const putter = tactic({
    name: "Put Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = wantonBoard({ extra: [{ key: "put", def: putter, owner: P1, zone: "hand" }, { key: "mv", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("put"), { selected: { t: [game.id("ww")] } });
  assert.equal(zoneOf(game.engine, game.id("ww")), "play", "control: put into play");
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("past")] });
  useOn(game, "mv", "ww");
  assert.equal(zoneOf(game.engine, game.id("ww")), "hand", "control: it left play");
  assert.equal(game.engine.state.pendingChoice, undefined, "leaving play asks nothing");
});

clause(WANTON, "0:rule", "played as a face-down resource it has no rules text: nothing is asked", () => {
  const game = wantonBoard();
  developResource(game.engine, P1, game.id("ww"), true);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("ww")].faceDown, true);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("past")), "discard");
});

clause(WANTON, "0:rule", "it costs its printed 3 and needs [O]", () => {
  const good = wantonBoard({ obsession: 3 });
  const before = ready(good.engine);
  playRaw(good.engine, P1, good.id("ww"));
  assert.equal(before - ready(good.engine), 3);
  const short = wantonBoard({ obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("ww")), "two resources");
  const noO = wantonBoard({ obsession: 0, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noO.engine, P1, noO.id("ww")), "no [O]");
});

// @@END@@
