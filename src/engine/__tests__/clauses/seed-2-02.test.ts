// Clause tests — batch seed-2-02. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-02`. Expectations come from each
// card's PRINTED text (markup); engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  bounceTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  autoResolveBattle,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, covertCannotBeBlockedByNonCovert, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 4, rage: 2 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const cardOf = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id];
const START = 30; // developFaction() starts at 30 influence

/** `n` plain characters `<prefix>0..n-1` for `owner` in `zone`. */
const chars = (prefix: string, n: number, owner: PlayerId, zone: Zone): CardPlacement[] =>
  fillers(prefix, n, owner, zone, (i) => character({ name: `${prefix} ${i}` }));

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
function flipUpRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
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

/** Accepts every `mayPay`, declines (or defaults) anything else. */
const acceptPay = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));
/** Declines every `mayPay`, defaults anything else. */
const refusePay = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc));

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A player responds to the open window by playing a tactic from hand; the chain is then drained. */
function respondWith(
  engine: SpoilsEngine,
  responder: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables } as never);
  resolvePendingResponses(engine);
}

/** A free tactic (id "pump", pick "t"): the picked character gets `amount` strength this turn. */
function pumpTactic(amount: number, name = `Pump ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "mv", pick "t"): moves one picked card in `from` to `to` (top of the deck when `to` is "deck"). */
function moverTactic(from: Zone, to: Zone, name = `Mover ${from} to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: from }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to, position: "top" }]
        }
      ]
    }
  });
}

/** A free tactic (id "dmg", pick "t"): inflicts `amount` damage on one picked character, location or faction. */
function damageTactic(amount: number, name = `Zap ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [
            {
              id: "t",
              selector: {
                zone: "play",
                conditions: [
                  {
                    type: "or",
                    conditions: [
                      { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
                      { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "location" },
                      { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" }
                    ]
                  }
                ]
              },
              count: 1
            }
          ],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "steal", pick "t"): permanently takes control of one picked card in play for its controller. */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A free tactic (id "fd", pick "t"): flips one picked character face-down under its owner's control. */
function flipDownTactic(name = "Flip Down"): CardDefinition {
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

/** A free tactic (id "tok", pick "t"): puts `amount` tokens on one picked card in play. */
function tokenTactic(amount: number, name = `Token ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tok",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount }]
        }
      ]
    }
  });
}

/** An item that attaches to a character and adds `amount` strength to it. */
function strengthGear(amount: number, name = `Gear ${amount}`): CardDefinition {
  return item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });
}

/** A staple resource card of one icon. */
const stapleCard = (name: string, icon: StapleIcon): CardDefinition => resourceCard({ name, resource: { provides: [icon], staple: true } });
/** A resource card that is NOT a staple. */
const oddResource = (name = "Odd Coin", icon: StapleIcon = "greed"): CardDefinition => resourceCard({ name, resource: { provides: [icon], staple: false } });

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Reveal events in the log (cardsRevealed). */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const revealedIds = (engine: SpoilsEngine): string[] =>
  revealEvents(engine).flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);

/** Events of one type in the log. */
const eventsOf = (engine: SpoilsEngine, type: string) => engine.getLog().filter((entry) => entry.event?.type === type);

// =================================================================================
// Alluring Quicksand
// COST: Pick a character. -- EFFECT: Flip the character face-down under its owner's control.
// RECUR: [G][G][G][G] -- COST: Use this only if this card is in your discard pile. Pay 2.
// Remove this card from the game. Pick a character. -- EFFECT: Flip the character face-down
// under its owner's control.
// Tactic (banker), cost 4, [G][G].
// =================================================================================

const QUICKSAND = "48ee8c98-eb09-4d02-b16f-4fc38f686d7a";

function qsBoard(
  opts: {
    qs?: Zone;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "qs", def: printing(QUICKSAND), owner: opts.owner ?? P1, zone: opts.qs ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type QsBoard = ReturnType<typeof qsBoard>;
const qsPlay = (g: QsBoard, target: string) => play(g.engine, P1, g.id("qs"), { selected: { t: [g.id(target)] } });
const qsPlayRaw = (g: QsBoard, target: string) => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [g.id(target)] } });
const qsRecurRaw = (g: QsBoard, target: string, player: PlayerId = P1) => actRaw(g.engine, player, g.id("qs"), "quicksand-recur", { rt: [g.id(target)] });
const qsRecur = (g: QsBoard, target: string, player: PlayerId = P1) => activate(g.engine, player, g.id("qs"), "quicksand-recur", { selected: { rt: [g.id(target)] } });

/** Things a "character" pick must refuse. Each is placed in play (or elsewhere) next to the legal characters. */
const NOT_CHARACTERS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "it", why: "an item", extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] },
  { key: "loc", why: "a location", extra: [{ key: "loc", def: location({ name: "Hovel" }), owner: P2, zone: "play" }] },
  { key: "rs", why: "a face-up resource", extra: [{ key: "rs", def: stapleCard("Rage", "rage"), owner: P2, zone: "play" }] },
  { key: "fd", why: "a face-down card (a resource, CR 411.1), even one that is really a character", extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] },
  { key: "hd", why: "a character card in a hand (not in play)", extra: [{ key: "hd", def: character({ name: "Handy" }), owner: P2, zone: "hand" }] },
  { key: "dk", why: "a character card in a deck", extra: [{ key: "dk", def: character({ name: "Deckard" }), owner: P2, zone: "deck" }] },
  { key: "dc", why: "a character card in a discard pile", extra: [{ key: "dc", def: character({ name: "Dusty" }), owner: P2, zone: "discard" }] }
];

clause(QUICKSAND, "0:ability", "flips my opponent's character face-down: it stays in play as a face-down resource under its owner's control", () => {
  const g = qsBoard();
  qsPlay(g, "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("foe"));
  assert.equal(card.zone, "play", "it is flipped, not destroyed or moved");
  assert.equal(card.faceDown, true, "it is face-down");
  assert.equal(card.controllerId, P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("foe")), "playOf(g.engine, P2).includes(g.id(\"foe\"))");
  assert.deepEqual(g.engine.getCardTypes(g.id("foe")), ["resource"], "a face-down card is only a resource (CR 411.1)");
});

clause(QUICKSAND, "0:ability", "flips MY OWN character face-down as well: 'a character', not 'an opponent's character'", () => {
  const g = qsBoard();
  qsPlay(g, "mine");
  const card = cardOf(g.engine, g.id("mine"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "control: the other character is untouched");
});

clause(QUICKSAND, "0:ability", "only the picked character is flipped: every other character, in either play area, is untouched", () => {
  const g = qsBoard({ extra: chars("pad", 2, P1, "play").concat(chars("opp", 2, P2, "play")) });
  qsPlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true, "control: the pick was flipped");
  for (const key of ["mine", "pad0", "pad1", "opp0", "opp1"]) {
    assert.equal(cardOf(g.engine, g.id(key)).faceDown, false, `${key} stays face-up`);
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
  }
});

clause(QUICKSAND, "0:ability", "the flipped character is a face-down resource that provides one Volition icon for its owner (CR 203.4a)", () => {
  const g = qsBoard();
  const volBefore = g.engine.getThresholds(P2).volition ?? 0;
  const readyBefore = ready(g.engine, P2);
  qsPlay(g, "foe");
  assert.equal(g.engine.getThresholds(P2).volition ?? 0, volBefore + 1, "one Volition icon appears under the owner's control");
  assert.equal(ready(g.engine, P2), readyBefore + 1, "and it is a resource the owner can pay with");
});

clause(QUICKSAND, "0:ability", "'under its OWNER's control': a character I stole is flipped face-down under its owner's control, not mine", () => {
  const g = qsBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  assert.equal(cardOf(g.engine, g.id("stolen")).controllerId, P1, "control: I control it first");
  qsPlay(g, "stolen");
  const card = cardOf(g.engine, g.id("stolen"));
  assert.equal(card.faceDown, true);
  assert.equal(card.ownerId, P2);
  assert.equal(card.controllerId, P2, "the flipped card is under its owner's control");
  assert.ok(playOf(g.engine, P2).includes(g.id("stolen")), "playOf(g.engine, P2).includes(g.id(\"stolen\"))");
  assert.equal(playOf(g.engine, P1).includes(g.id("stolen")), false, "and it is gone from my play area");
});

clause(QUICKSAND, "0:ability", "'under its owner's control' also covers my own card that my opponent stole: it comes back to me face-down", () => {
  const g = qsBoard({ extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }] });
  qsPlay(g, "lent");
  const card = cardOf(g.engine, g.id("lent"));
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1, "its owner (me) controls the face-down resource");
  assert.ok(playOf(g.engine, P1).includes(g.id("lent")), "playOf(g.engine, P1).includes(g.id(\"lent\"))");
});

clause(QUICKSAND, "0:ability", "the flipped card is a brand-new card: damage, depletion and tokens do not carry over (CR 411.3)", () => {
  const g = qsBoard({
    extra: [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P2, zone: "play", damage: 3, depleted: true, counters: { token: 2 } }]
  });
  assert.equal(cardOf(g.engine, g.id("hurt")).damage, 3, "control: it starts damaged");
  qsPlay(g, "hurt");
  const card = cardOf(g.engine, g.id("hurt"));
  assert.equal(card.faceDown, true);
  assert.equal(card.damage, 0, "no damage carries over");
  assert.equal(card.depleted, false, "no depletion carries over");
  assert.equal(card.counters?.token ?? 0, 0, "no tokens carry over");
});

clause(QUICKSAND, "0:ability", "the tactic costs exactly 4 and ends in its owner's discard pile", () => {
  const g = qsBoard({ icons: { greed: 6 } });
  const before = ready(g.engine);
  qsPlay(g, "foe");
  assert.equal(before - ready(g.engine), 4, "exactly the printed cost is paid");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("qs")), "discardOf(g.engine, P1).includes(g.id(\"qs\"))");
  assert.equal(removedOf(g.engine, P1).includes(g.id("qs")), false, "it is not removed from the game (only RECUR does that)");
});

clause(QUICKSAND, "0:ability", "the cost is paid when the tactic is played, before my opponent can respond; the flip waits for resolution", () => {
  const g = qsBoard({ icons: { greed: 6 } });
  const before = ready(g.engine);
  qsPlayRaw(g, "foe");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 4, "the cost is already paid");
  assert.equal(zoneOf(g.engine, g.id("qs")), "deploying", "the tactic is being deployed");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "the flip has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true, "after the responses it resolves");
});

clause(QUICKSAND, "0:ability", "costs 4: refused with 3 resources even though the [G][G] threshold is met, accepted with 4", () => {
  const short = qsBoard({ icons: { greed: 3 } });
  refused(() => qsPlayRaw(short, "foe"), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("qs")), "hand");
  assert.equal(cardOf(short.engine, short.id("foe")).faceDown, false);
  const enough = qsBoard({ icons: { greed: 4 } });
  qsPlay(enough, "foe");
  assert.equal(cardOf(enough.engine, enough.id("foe")).faceDown, true);
});

clause(QUICKSAND, "0:ability", "needs [G][G]: refused with only one Greed even when 4+ resources are ready, accepted with two", () => {
  const oneGreed = qsBoard({ icons: { greed: 1, rage: 4 } });
  assert.equal(ready(oneGreed.engine), 5);
  refused(() => qsPlayRaw(oneGreed, "foe"), "one [G] is short of [G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("qs")), "hand");
  const noGreed = qsBoard({ icons: { rage: 5 } });
  refused(() => qsPlayRaw(noGreed, "foe"), "no [G] at all");
  const twoGreed = qsBoard({ icons: { greed: 2, rage: 2 } });
  qsPlay(twoGreed, "foe");
  assert.equal(cardOf(twoGreed.engine, twoGreed.id("foe")).faceDown, true);
});

clause(QUICKSAND, "0:ability", "a resource already spent still counts for the [G][G] threshold, but cannot pay the cost", () => {
  const spentGreed: CardPlacement[] = bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = devBoard([
    { key: "qs", def: printing(QUICKSAND), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...spentGreed,
    ...res({ rage: 4 })
  ]);
  assert.equal(ready(g.engine), 4, "control: four resources are free to pay with");
  qsPlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true, "the two spent Greed met [G][G]; four free resources paid 4");
  const g2 = devBoard([
    { key: "qs", def: printing(QUICKSAND), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...res({ rage: 3 })
  ]);
  refused(() => qsPlayRaw(g2, "foe"), "only 3 free resources");
});

for (const bad of NOT_CHARACTERS) {
  clause(QUICKSAND, "0:ability", `cannot pick ${bad.why}`, () => {
    const g = qsBoard({ extra: bad.extra });
    refused(() => qsPlayRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("qs")), "hand", "nothing was paid or played");
    assert.equal(ready(g.engine), 4);
    const control = qsBoard({ extra: bad.extra });
    qsPlay(control, "foe");
    assert.equal(cardOf(control.engine, control.id("foe")).faceDown, true, "control: a character can be picked on the same board");
  });
}

clause(QUICKSAND, "0:ability", "cannot pick a faction (CR 202.9): neither mine nor my opponent's", () => {
  const g = qsBoard();
  const theirs = g.engine.state.players[P2].factionId!;
  const mine = g.engine.state.players[P1].factionId!;
  refused(() => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [theirs] } }), "their faction");
  const g2 = qsBoard();
  refused(() => playRaw(g2.engine, P1, g2.id("qs"), { selected: { t: [g2.engine.state.players[P1].factionId!] } }), "my faction");
  assert.ok(mine && theirs, "mine && theirs");
  assert.equal(zoneOf(g.engine, g.id("qs")), "hand");
});

clause(QUICKSAND, "0:ability", "needs a pick: with no target given it cannot be played", () => {
  const g = qsBoard();
  refused(() => playRaw(g.engine, P1, g.id("qs")), "no character picked");
  assert.equal(zoneOf(g.engine, g.id("qs")), "hand");
  const two = qsBoard();
  refused(() => playRaw(two.engine, P1, two.id("qs"), { selected: { t: [two.id("foe"), two.id("mine")] } }), "two characters picked for 'a character'");
  assert.equal(zoneOf(two.engine, two.id("qs")), "hand");
});

clause(QUICKSAND, "0:ability", "with no character in play at all there is nothing to pick, so it cannot be played", () => {
  const g = devBoard([{ key: "qs", def: printing(QUICKSAND), owner: P1, zone: "hand" }, ...res({ greed: 4 })]);
  refused(() => playRaw(g.engine, P1, g.id("qs")), "no characters in play");
  assert.equal(zoneOf(g.engine, g.id("qs")), "hand");
  assert.equal(ready(g.engine), 4);
});

clause(QUICKSAND, "0:ability", "the pick is resolved when the tactic resolves: a character destroyed in response is simply gone, nothing else is flipped", () => {
  const g = qsBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  qsPlayRaw(g, "foe");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "the picked character was destroyed in response");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "it is not pulled back out of the discard pile");
  assert.equal(cardOf(g.engine, g.id("mine")).faceDown, false, "no other character is flipped");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard", "the tactic still ends in the discard pile");
});

clause(QUICKSAND, "0:ability", "a character bounced to its owner's hand in response stays in the hand (it is not flipped in play)", () => {
  const g = qsBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  qsPlayRaw(g, "foe");
  respondWith(g.engine, P2, g.id("bounce"), { t: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
});

clause(QUICKSAND, "0:ability", "can be played in response on my opponent's turn, like any tactic", () => {
  const g = qsBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 4 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in the response window");
  respondWith(g.engine, P1, g.id("qs"), { t: [g.id("atk")] });
  assert.equal(cardOf(g.engine, g.id("atk")).faceDown, true, "the attacker was flipped face-down");
  assert.equal(cardOf(g.engine, g.id("atk")).controllerId, P2);
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
});

clause(QUICKSAND, "0:ability", "an attacker flipped face-down is no longer a character, so it drops out of the battle and deals no damage (CR 208.4)", () => {
  const g = qsBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 4 }), owner: P2, zone: "play" }] });
  const hurt = influenceOf(g.engine, P1);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("qs"), { t: [g.id("atk")] });
  assert.deepEqual(battleOf(g.engine)?.attackingParty ?? [], [], "the attacking party is empty: the face-down card left the battle");
  if (battleOf(g.engine)) finishBattle(g.engine);
  assert.equal(battleOf(g.engine), undefined, "the battle is over");
  assert.equal(influenceOf(g.engine, P1), hurt, "the face-down attacker dealt no battle damage to my faction");
  assert.equal(cardOf(g.engine, g.id("atk")).faceDown, true);
});

clause(QUICKSAND, "0:ability", "a character flipped face-down has left play: its 'leaves play' trigger fires (FAQ), and no 'enters play' trigger fires for the blank resource", () => {
  const watcher = character({
    name: "Watcher",
    behavior: {
      abilities: [
        {
          id: "w-leave",
          type: "triggered",
          event: "cardMoved",
          condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        },
        {
          id: "w-enter",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "draw", player: "controller", amount: 2 }]
        }
      ]
    }
  });
  const g = qsBoard({ extra: [{ key: "w", def: watcher, owner: P2, zone: "play" }, ...chars("d", 5, P2, "deck")] });
  const handBefore = handOf(g.engine, P2).length;
  qsPlay(g, "w");
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("w")).faceDown, true);
  assert.equal(handOf(g.engine, P2).length, handBefore + 1, "exactly the 'leaves play' draw happened (1 card), not the blank resource's 'enters play' draw (2)");
});

clause(QUICKSAND, "0:ability", "a gear item attached to the flipped character does not stay attached to a face-down resource: it is flipped face-down with it", () => {
  const g = qsBoard({ extra: [{ key: "gear", def: strengthGear(2), owner: P2, zone: "play", attachedToKey: "foe" }] });
  assert.equal(cardOf(g.engine, g.id("gear")).attachedTo, g.id("foe"), "control: attached first");
  qsPlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("gear")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(g.engine.state.cards[g.id("gear")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(QUICKSAND, "0:ability", "a blocker flipped face-down in the battle is no longer a character, so it drops out of the blocking party and deals no damage", () => {
  const g = qsBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 4, life: 6, speed: 3 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("blk")], "control: it is blocking");
  // the window before damage: the attacker's controller passes, then I respond
  let guard = 0;
  while (g.engine.state.responseWindow && g.engine.state.responseWindow.priorityPlayerId !== P1 && guard++ < 5) {
    g.engine.perform({ type: "passPriority", playerId: g.engine.state.responseWindow.priorityPlayerId });
  }
  respondWith(g.engine, P1, g.id("qs"), { t: [g.id("blk")] });
  assert.equal(cardOf(g.engine, g.id("blk")).faceDown, true);
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("blk")) ?? false, false, "it left the blocking party");
  if (battleOf(g.engine)) finishBattle(g.engine);
  assert.equal(cardOf(g.engine, g.id("atk")).damage, 0, "the face-down blocker dealt no battle damage");
});

// --- RECUR ---------------------------------------------------------------------

clause(QUICKSAND, "1:ability:quicksand-recur", "from my discard pile it flips a character face-down under its owner's control", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(g, "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("foe"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2);
  assert.deepEqual(g.engine.getCardTypes(g.id("foe")), ["resource"]);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR removes the Quicksand from the game and pays exactly 2", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  const before = ready(g.engine);
  qsRecur(g, "foe");
  assert.equal(before - ready(g.engine), 2, "Pay 2");
  assert.equal(zoneOf(g.engine, g.id("qs")), "removed", "Remove this card from the game");
  assert.ok(removedOf(g.engine, P1).includes(g.id("qs")), "removedOf(g.engine, P1).includes(g.id(\"qs\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("qs")), false);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR can flip my own character too, and a stolen one goes back under its owner's control", () => {
  const own = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(own, "mine");
  assert.equal(cardOf(own.engine, own.id("mine")).faceDown, true);
  assert.equal(cardOf(own.engine, own.id("mine")).controllerId, P1);
  const stolen = qsBoard({
    qs: "discard",
    icons: { greed: 6 },
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]
  });
  qsRecur(stolen, "stolen");
  assert.equal(cardOf(stolen.engine, stolen.id("stolen")).faceDown, true);
  assert.equal(cardOf(stolen.engine, stolen.id("stolen")).controllerId, P2, "under its owner's control");
});

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR is not playing a tactic: no cardPlayed event, and the tactic is not 'deployed' (FAQ)", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(g, "foe");
  assert.equal(
    eventsOf(g.engine, "cardPlayed").filter((e) => (e.event as unknown as { cardId: string }).cardId === g.id("qs")).length,
    0,
    "RECUR never plays the card"
  );
});

clause(QUICKSAND, "1:ability:quicksand-recur", "needs [G][G][G][G]: refused with three Greed and plenty of other resources, accepted with four", () => {
  const three = qsBoard({ qs: "discard", icons: { greed: 3, rage: 4 } });
  refused(() => qsRecurRaw(three, "foe"), "three [G] is short of [G][G][G][G]", /threshold|Threshold|cannot|requirement/i);
  assert.equal(zoneOf(three.engine, three.id("qs")), "discard");
  assert.equal(cardOf(three.engine, three.id("foe")).faceDown, false);
  const four = qsBoard({ qs: "discard", icons: { greed: 4, rage: 2 } });
  qsRecur(four, "foe");
  assert.equal(cardOf(four.engine, four.id("foe")).faceDown, true);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "Pay 2: refused with fewer than 2 free resources even with [G][G][G][G] controlled", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = qsBoard({ qs: "discard", icons: {}, extra: [...spent(3), ...res({ greed: 1 })] });
  assert.equal(ready(short.engine), 1);
  refused(() => qsRecurRaw(short, "foe"), "one free resource for Pay 2");
  assert.equal(zoneOf(short.engine, short.id("qs")), "discard", "nothing was removed");
  const exact = qsBoard({ qs: "discard", icons: {}, extra: [...spent(2), ...res({ greed: 2 })] });
  assert.equal(ready(exact.engine), 2);
  qsRecur(exact, "foe");
  assert.equal(cardOf(exact.engine, exact.id("foe")).faceDown, true);
  assert.equal(ready(exact.engine), 0);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "Use this only if this card is in your discard pile: refused from my hand, the deck, play and the removed zone", () => {
  for (const where of ["hand", "deck", "removed"] as const) {
    const g = qsBoard({ qs: where, icons: { greed: 6 } });
    refused(() => qsRecurRaw(g, "foe"), `Quicksand in ${where}`);
    assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
    assert.equal(zoneOf(g.engine, g.id("qs")), where);
  }
  const inPlay = qsBoard({ qs: "play", icons: { greed: 6 } });
  refused(() => qsRecurRaw(inPlay, "foe"), "Quicksand in play");
  const control = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(control, "foe");
  assert.equal(cardOf(control.engine, control.id("foe")).faceDown, true, "control: from the discard pile it works");
});

clause(QUICKSAND, "1:ability:quicksand-recur", "'your discard pile': a Quicksand in my OPPONENT's discard pile cannot be recurred by me", () => {
  const g = qsBoard({ qs: "discard", owner: P2, icons: { greed: 6 } });
  assert.ok(discardOf(g.engine, P2).includes(g.id("qs")), "discardOf(g.engine, P2).includes(g.id(\"qs\"))");
  refused(() => qsRecurRaw(g, "foe", P1), "their discard pile");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR is a one-shot: once removed from the game the card cannot be recurred again", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 8 } });
  qsRecur(g, "foe");
  refused(() => qsRecurRaw(g, "mine"), "the card has left the discard pile");
  assert.equal(cardOf(g.engine, g.id("mine")).faceDown, false);
});

for (const bad of NOT_CHARACTERS) {
  clause(QUICKSAND, "1:ability:quicksand-recur", `RECUR cannot pick ${bad.why}`, () => {
    const g = qsBoard({ qs: "discard", icons: { greed: 6 }, extra: bad.extra });
    refused(() => qsRecurRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("qs")), "discard", "nothing was paid or removed");
    assert.equal(ready(g.engine), 6);
    const control = qsBoard({ qs: "discard", icons: { greed: 6 }, extra: bad.extra });
    qsRecur(control, "foe");
    assert.equal(cardOf(control.engine, control.id("foe")).faceDown, true, "control: a character can be picked on the same board");
  });
}

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR cannot pick a faction (CR 202.9)", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  refused(() => actRaw(g.engine, P1, g.id("qs"), "quicksand-recur", { rt: [g.engine.state.players[P2].factionId!] }), "their faction");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
});

clause(QUICKSAND, "1:ability:quicksand-recur", "needs a pick: with no target given RECUR cannot be used, and nothing is paid", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  refused(() => actRaw(g.engine, P1, g.id("qs"), "quicksand-recur"), "no character picked");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(ready(g.engine), 6);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "the costs are paid at activation, before my opponent can respond", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  const before = ready(g.engine);
  qsRecurRaw(g, "foe");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 2, "Pay 2 is already paid");
  assert.equal(zoneOf(g.engine, g.id("qs")), "removed", "the card is already removed from the game");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "the flip waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
});

clause(QUICKSAND, "1:ability:quicksand-recur", "RECUR works as a response on my opponent's turn (it is an ability)", () => {
  const g = qsBoard({
    qs: "discard",
    icons: { greed: 6 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 4 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("qs"), "quicksand-recur", { rt: [g.id("atk")] });
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("atk")).faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("qs")), "removed");
});

clause(QUICKSAND, "1:ability:quicksand-recur", "the printed play ability is not available from the discard pile: the card cannot be played from there", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  refused(() => qsPlayRaw(g, "foe"), "playing a tactic from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
});

// =================================================================================
// Ceremonious Groomer
// If this card is destroyed, flip it face-down under its owner's control instead.
// Character (banker, mau), cost 3, [G][G], 2 / 3 / 3.
// =================================================================================

const GROOMER = "997b12c2-9e41-4c19-b4af-6c629c1aad42";

function groomerBoard(
  opts: {
    owner?: PlayerId;
    controller?: PlayerId;
    faceDown?: boolean;
    active?: PlayerId;
    extra?: CardPlacement[];
    damage?: number;
  } = {}
) {
  return devBoard(
    [
      { key: "gr", def: printing(GROOMER), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", faceDown: opts.faceDown, damage: opts.damage },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "kill1", def: killTactic({ name: "Kill P1" }), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill P2" }), owner: P2, zone: "hand" },
      { key: "kill3", def: killTactic({ name: "Kill P2 again" }), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ],
    { activePlayerId: opts.active ?? P2 }
  );
}

type GrBoard = ReturnType<typeof groomerBoard>;
/** The opponent (active player) destroys `target` with a Kill tactic. */
const grKill = (g: GrBoard, target: string, tactic = "kill2") => play(g.engine, P2, g.id(tactic), { selected: { t: [g.id(target)] } });

/** A free tactic that destroys ANY one picked card in play, including a face-down one. */
function killAnyTactic(name = "Kill Anything"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kany",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "resource" }, { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" }] }] }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic that destroys every character in play. */
function sweepTactic(name = "Sweep"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
}

clause(GROOMER, "0:rule", "destroyed by a destroy effect it is not destroyed: it stays in play, flipped face-down", () => {
  const g = groomerBoard();
  grKill(g, "gr");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("gr"));
  assert.equal(card.zone, "play", "still in play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(discardOf(g.engine, P1).includes(g.id("gr")), false, "not in the discard pile");
  assert.deepEqual(g.engine.getCardTypes(g.id("gr")), ["resource"], "a face-down card is only a resource");
  assert.ok(playOf(g.engine, P1).includes(g.id("gr")), "playOf(g.engine, P1).includes(g.id(\"gr\"))");
});

clause(GROOMER, "0:rule", "the flipped card is a face-down resource: one Volition icon, free to pay with, and its damage is gone", () => {
  const g = groomerBoard({ damage: 2 });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  const readyBefore = ready(g.engine);
  grKill(g, "gr");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(ready(g.engine), readyBefore + 1);
  assert.equal(cardOf(g.engine, g.id("gr")).damage, 0);
});

clause(GROOMER, "0:rule", "only this card is saved: another character destroyed by the same effect goes to the discard pile", () => {
  const g = groomerBoard();
  grKill(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "an ordinary character is destroyed");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, false, "the Groomer is untouched");
  assert.equal(zoneOf(g.engine, g.id("gr")), "play");
  grKill(g, "gr", "kill3");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, true, "control: when it is the Groomer it flips");
});

clause(GROOMER, "0:rule", "my opponent's Groomer is saved the same way (each Groomer protects itself, whoever controls it)", () => {
  const g = groomerBoard({ owner: P2, active: P1 });
  play(g.engine, P1, g.id("kill1"), { selected: { t: [g.id("gr")] } });
  const card = cardOf(g.engine, g.id("gr"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2);
  assert.equal(discardOf(g.engine, P2).includes(g.id("gr")), false);
});

clause(GROOMER, "0:rule", "'under its OWNER's control': a Groomer I stole is flipped face-down under its owner's control, not mine", () => {
  const g = groomerBoard({ owner: P2, controller: P1, active: P1 });
  assert.equal(cardOf(g.engine, g.id("gr")).controllerId, P1, "control: I control it");
  play(g.engine, P1, g.id("kill1"), { selected: { t: [g.id("gr")] } });
  const card = cardOf(g.engine, g.id("gr"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2, "its owner controls the face-down resource");
  assert.ok(playOf(g.engine, P2).includes(g.id("gr")), "playOf(g.engine, P2).includes(g.id(\"gr\"))");
  assert.equal(playOf(g.engine, P1).includes(g.id("gr")), false);
});

clause(GROOMER, "0:rule", "destroyed by lethal damage from an effect it is flipped instead; damage that is not lethal changes nothing", () => {
  const zap = (amount: number) => devBoard(
    [
      { key: "gr", def: printing(GROOMER), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(amount), owner: P2, zone: "hand" }
    ],
    { activePlayerId: P2 }
  );
  const small = zap(2);
  play(small.engine, P2, small.id("zap"), { selected: { t: [small.id("gr")] } });
  assert.equal(cardOf(small.engine, small.id("gr")).faceDown, false, "2 damage on a 3-life character is not lethal");
  assert.equal(cardOf(small.engine, small.id("gr")).damage, 2);
  const lethal = zap(3);
  play(lethal.engine, P2, lethal.id("zap"), { selected: { t: [lethal.id("gr")] } });
  const card = cardOf(lethal.engine, lethal.id("gr"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "3 damage on a 3-life character would destroy it: it flips instead");
  assert.equal(card.damage, 0, "and the new face-down card has no damage");
});

clause(GROOMER, "0:rule", "destroyed in battle as a blocker it is flipped face-down instead and the battle goes on without it", () => {
  const g = groomerBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Big Attacker", strength: 5, life: 8, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("gr")]);
  finishBattle(g.engine);
  const card = cardOf(g.engine, g.id("gr"));
  assert.equal(card.zone, "play", "the lethal battle damage did not destroy it");
  assert.equal(card.faceDown, true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("gr")), false);
  assert.equal(cardOf(g.engine, g.id("atk")).damage, 2, "control: it still dealt its own 2 battle damage (speed 3 beats speed 1)");
});

clause(GROOMER, "0:rule", "destroyed in battle as an attacker it is flipped face-down instead", () => {
  const g = groomerBoard({ active: P1 });
  declareAttackBy(g.engine, P1, [g.id("gr")]);
  declareBlockers(g.engine, P2, [g.id("foe")]);
  finishBattle(g.engine);
  const card = cardOf(g.engine, g.id("gr"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("gr")), false);
  assert.equal(cardOf(g.engine, g.id("foe")).damage, 2, "control: the blocker took the Groomer's 2 battle damage first (speed 3 vs 1)");
});

clause(GROOMER, "0:rule", "'instead': it is not destroyed, so a 'when a character is destroyed' trigger does not fire for it (but does for others)", () => {
  const watcher = item({
    name: "Mourner",
    behavior: { abilities: [{ id: "mourn", type: "triggered", event: "cardDestroyed", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = groomerBoard({ extra: [{ key: "w", def: watcher, owner: P1, zone: "play" }, ...chars("d", 4, P1, "deck")] });
  const hand = handOf(g.engine, P1).length;
  grKill(g, "mine");
  drain(g.engine, declineAll);
  assert.equal(handOf(g.engine, P1).length, hand + 1, "control: another character's destruction draws a card");
  grKill(g, "gr", "kill3");
  drain(g.engine, declineAll);
  assert.equal(handOf(g.engine, P1).length, hand + 1, "the Groomer was never destroyed: no second draw");
  assert.equal(eventsOf(g.engine, "cardDestroyed").filter((e) => (e.event as unknown as { cardId: string }).cardId === g.id("gr")).length, 0);
});

clause(GROOMER, "0:rule", "it is flipped only when DESTROYED: returned to its owner's hand it simply goes to the hand", () => {
  const g = groomerBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("bounce"), { selected: { t: [g.id("gr")] } });
  assert.equal(zoneOf(g.engine, g.id("gr")), "hand");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, false);
});

clause(GROOMER, "0:rule", "it is flipped only when DESTROYED: removed from the game it is removed", () => {
  const g = groomerBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("rm"), { selected: { t: [g.id("gr")] } });
  assert.equal(zoneOf(g.engine, g.id("gr")), "removed");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, false);
});

clause(GROOMER, "0:rule", "a replacement does not apply to a cost (CR 506.2): destroyed to pay for an ability it goes to the discard pile", () => {
  const sac = item({
    name: "Altar",
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "s", selector: { controller: "self", type: "character" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "s" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const g = groomerBoard({ active: P1, extra: [{ key: "altar", def: sac, owner: P1, zone: "play" }, ...chars("d", 2, P1, "deck")] });
  activate(g.engine, P1, g.id("altar"), "sac", { selected: { s: [g.id("gr")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("gr")), "discard", "destroying it as a cost is not replaced");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, false);
});

clause(GROOMER, "0:rule", "a face-down Groomer is only a blank resource (CR 411.1): destroyed, it goes to the discard pile", () => {
  const g = groomerBoard({ faceDown: true, extra: [{ key: "kany", def: killAnyTactic(), owner: P2, zone: "hand" }] });
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, true);
  play(g.engine, P2, g.id("kany"), { selected: { t: [g.id("gr")] } });
  assert.equal(zoneOf(g.engine, g.id("gr")), "discard", "no rules text while face-down, so nothing replaces its destruction");
});

clause(GROOMER, "0:rule", "two Groomers destroyed by one effect are each flipped; the ordinary characters die", () => {
  const g = groomerBoard({
    extra: [
      { key: "gr2", def: printing(GROOMER), owner: P2, zone: "play" },
      { key: "sweep", def: sweepTactic(), owner: P2, zone: "hand" }
    ]
  });
  play(g.engine, P2, g.id("sweep"));
  drain(g.engine, declineAll);
  for (const key of ["gr", "gr2"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays in play`);
    assert.equal(cardOf(g.engine, g.id(key)).faceDown, true, `${key} is face-down`);
  }
  for (const key of ["mine", "foe"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} is destroyed`);
});

clause(GROOMER, "0:rule", "a Groomer that was flipped can be destroyed again only as a blank resource, which is just a discard", () => {
  const g = groomerBoard({ extra: [{ key: "kany", def: killAnyTactic(), owner: P2, zone: "hand" }] });
  grKill(g, "gr");
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, true, "first destruction: flipped");
  play(g.engine, P2, g.id("kany"), { selected: { t: [g.id("gr")] } });
  assert.equal(zoneOf(g.engine, g.id("gr")), "discard", "second destruction (now a blank resource): discarded");
});

// =================================================================================
// Clam Hash
// COST: Pick a character. -- EFFECT: This turn, the character gains 2 life. If you played this
// card using FLIP UP, put this card into its owner's hand instead of their discard pile.
// FLIP UP: 2 [G][G]
// Tactic (banker), cost 1, [G][G].
// =================================================================================

const CLAM = "64ae29fe-f51d-4637-bfef-221d5ecbdf61";

function clamBoard(
  opts: {
    hash?: Zone;
    faceDown?: boolean;
    hashOwner?: PlayerId;
    hashController?: PlayerId;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "hash", def: printing(CLAM), owner: opts.hashOwner ?? P1, controller: opts.hashController, zone: opts.hash ?? "hand", faceDown: opts.faceDown },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ClamBoard = ReturnType<typeof clamBoard>;
const clamPlay = (g: ClamBoard, target: string) => play(g.engine, P1, g.id("hash"), { selected: { t: [g.id(target)] } });
const clamPlayRaw = (g: ClamBoard, target: string) => playRaw(g.engine, P1, g.id("hash"), { selected: { t: [g.id(target)] } });
const clamFlipRaw = (g: ClamBoard, target: string, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("hash"), { t: [g.id(target)] });
const clamFlip = (g: ClamBoard, target: string, player: PlayerId = P1) => {
  clamFlipRaw(g, target, player);
  resolvePendingResponses(g.engine);
};
const life = (g: ClamBoard, key: string) => g.engine.getStat(g.id(key), "life");

clause(CLAM, "0:ability", "this turn the picked character gains 2 life (mine: 3 -> 5)", () => {
  const g = clamBoard();
  assert.equal(life(g, "mine"), 3, "control: printed life");
  clamPlay(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "mine"), 5);
});

clause(CLAM, "0:ability", "any character can be picked: my opponent's character gains 2 life too (4 -> 6)", () => {
  const g = clamBoard();
  clamPlay(g, "foe");
  assert.equal(life(g, "foe"), 6);
  assert.equal(life(g, "mine"), 3, "control: my own character is untouched");
});

clause(CLAM, "0:ability", "only the picked character gains life: every other character is unchanged", () => {
  const g = clamBoard({ extra: chars("pad", 2, P1, "play").concat(chars("opp", 2, P2, "play")) });
  clamPlay(g, "mine");
  assert.equal(life(g, "mine"), 5);
  for (const key of ["foe", "pad0", "pad1", "opp0", "opp1"]) assert.equal(life(g, key), g.engine.getDefinition(g.id(key)).life, `${key} unchanged`);
});

clause(CLAM, "0:ability", "the life is a stat gain only: strength and speed are unchanged", () => {
  const g = clamBoard();
  clamPlay(g, "foe");
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("foe"), "speed"), 2);
});

clause(CLAM, "0:ability", "the +2 life lasts only this turn: it is gone once the turn ends", () => {
  const g = clamBoard();
  clamPlay(g, "mine");
  assert.equal(life(g, "mine"), 5, "control: it is on during the turn");
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(life(g, "mine"), 3, "back to the printed life at the start of the next turn");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(life(g, "mine"), 3, "and it does not come back");
});

clause(CLAM, "0:ability", "the extra life is real: a character with 3 life survives 4 damage this turn once it has gained 2 life", () => {
  const board = () => clamBoard({ icons: { greed: 4 }, extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  const withHash = board();
  clamPlay(withHash, "mine");
  play(withHash.engine, P1, withHash.id("zap"), { selected: { t: [withHash.id("mine")] } });
  assert.equal(zoneOf(withHash.engine, withHash.id("mine")), "play", "survives with 5 life");
  assert.equal(cardOf(withHash.engine, withHash.id("mine")).damage, 4);
  const without = board();
  play(without.engine, P1, without.id("zap"), { selected: { t: [without.id("mine")] } });
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control: without the Clam Hash the same 4 damage destroys it");
});

clause(CLAM, "0:ability", "gains stack: two Clam Hashes on one character give 4 life", () => {
  const g = clamBoard({ icons: { greed: 4 }, extra: [{ key: "hash2", def: printing(CLAM), owner: P1, zone: "hand" }] });
  clamPlay(g, "mine");
  play(g.engine, P1, g.id("hash2"), { selected: { t: [g.id("mine")] } });
  assert.equal(life(g, "mine"), 7);
});

clause(CLAM, "0:ability", "played from the hand it goes to its owner's DISCARD pile, not the hand (it was not played using FLIP UP)", () => {
  const g = clamBoard();
  clamPlay(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("hash")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("hash")), "discardOf(g.engine, P1).includes(g.id(\"hash\"))");
  assert.equal(handOf(g.engine, P1).includes(g.id("hash")), false);
});

clause(CLAM, "0:ability", "costs exactly 1: paid when played, refused with no free resource", () => {
  const g = clamBoard({ icons: { greed: 3 } });
  const before = ready(g.engine);
  clamPlayRaw(g, "mine");
  assert.equal(before - ready(g.engine), 1, "the printed cost of 1 is paid up front");
  assert.equal(life(g, "mine"), 3, "the life gain waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(life(g, "mine"), 5);
  const spent: CardPlacement[] = bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const none = clamBoard({ icons: {}, extra: spent });
  assert.equal(ready(none.engine), 0, "control: all three Greed are spent");
  refused(() => clamPlayRaw(none, "mine"), "no free resource for a cost of 1");
  assert.equal(zoneOf(none.engine, none.id("hash")), "hand");
});

clause(CLAM, "0:ability", "needs [G][G]: refused with a single Greed and plenty of other resources, accepted with two", () => {
  const one = clamBoard({ icons: { greed: 1, rage: 4 } });
  refused(() => clamPlayRaw(one, "mine"), "one [G] is short of [G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(one.engine, one.id("hash")), "hand");
  const two = clamBoard({ icons: { greed: 2 } });
  clamPlay(two, "mine");
  assert.equal(life(two, "mine"), 5);
});

for (const bad of NOT_CHARACTERS) {
  clause(CLAM, "0:ability", `cannot pick ${bad.why}`, () => {
    const g = clamBoard({ extra: bad.extra });
    refused(() => clamPlayRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("hash")), "hand", "nothing was played");
    assert.equal(ready(g.engine), 3, "nothing was paid");
    const control = clamBoard({ extra: bad.extra });
    clamPlay(control, "foe");
    assert.equal(life(control, "foe"), 6, "control: a character can be picked on the same board");
  });
}

clause(CLAM, "0:ability", "cannot pick a faction (CR 202.9), and needs exactly one pick", () => {
  const g = clamBoard();
  refused(() => playRaw(g.engine, P1, g.id("hash"), { selected: { t: [g.engine.state.players[P2].factionId!] } }), "their faction");
  const none = clamBoard();
  refused(() => playRaw(none.engine, P1, none.id("hash")), "no pick");
  const two = clamBoard();
  refused(() => playRaw(two.engine, P1, two.id("hash"), { selected: { t: [two.id("mine"), two.id("foe")] } }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("hash")), "hand");
});

clause(CLAM, "0:ability", "the pick is resolved when it resolves: a character destroyed in response is gone, the tactic still goes to the discard pile", () => {
  const g = clamBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  clamPlayRaw(g, "mine");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("mine")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("hash")), "discard");
});

clause(CLAM, "0:ability", "it is a tactic: it can be played in response on my opponent's turn, saving a blocker from lethal damage", () => {
  const g = clamBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in the response window");
  respondWith(g.engine, P1, g.id("hash"), { t: [g.id("mine")] });
  declareBlockers(g.engine, P1, [g.id("mine")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "3 life would die to 4 damage; with +2 life it survives");
  assert.equal(cardOf(g.engine, g.id("mine")).damage, 4);
});

// --- FLIP UP ---------------------------------------------------------------------

clause(CLAM, "1:flipUp", "FLIP UP: a face-down Clam Hash is played as though from the hand: the picked character gains 2 life", () => {
  const g = clamBoard({ hash: "play", faceDown: true, icons: { greed: 2 } });
  assert.equal(cardOf(g.engine, g.id("hash")).faceDown, true, "control: it starts face-down");
  clamFlip(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "mine"), 5);
});

clause(CLAM, "1:flipUp", "FLIP UP: played using FLIP UP it is put into its owner's HAND instead of their discard pile", () => {
  const g = clamBoard({ hash: "play", faceDown: true, icons: { greed: 2 } });
  clamFlip(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("hash")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("hash")), "handOf(g.engine, P1).includes(g.id(\"hash\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("hash")), false);
  assert.equal(cardOf(g.engine, g.id("hash")).faceDown, false);
});

clause(CLAM, "1:flipUp", "FLIP UP: costs exactly 2 (not its printed 1, not 3): refused with 1 free resource, accepted with 2", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = clamBoard({ hash: "play", faceDown: true, icons: {}, extra: spent(2) });
  assert.equal(ready(short.engine), 1, "control: only the face-down Hash itself is free");
  refused(() => clamFlipRaw(short, "mine"), "1 resource for FLIP UP 2");
  assert.equal(cardOf(short.engine, short.id("hash")).faceDown, true);
  assert.equal(life(short, "mine"), 3);
  const exact = clamBoard({ hash: "play", faceDown: true, icons: {}, extra: [...spent(2), ...res({ rage: 1 })] });
  assert.equal(ready(exact.engine), 2, "the Hash itself + 1 more");
  clamFlip(exact, "mine");
  assert.equal(life(exact, "mine"), 5, "2 free resources pay for the FLIP UP (the card may pay for itself, CR 507.4b)");
  assert.equal(ready(exact.engine), 0);
});

clause(CLAM, "1:flipUp", "FLIP UP: needs [G][G]: refused with one Greed even with enough resources, accepted with two", () => {
  const one = clamBoard({ hash: "play", faceDown: true, icons: { greed: 1, rage: 3 } });
  refused(() => clamFlipRaw(one, "mine"), "one [G] is short of [G][G]", /FLIP UP threshold requirements are not met/);
  assert.equal(cardOf(one.engine, one.id("hash")).faceDown, true);
  const none = clamBoard({ hash: "play", faceDown: true, icons: { rage: 4 } });
  refused(() => clamFlipRaw(none, "mine"), "no [G]");
  const two = clamBoard({ hash: "play", faceDown: true, icons: { greed: 2, rage: 1 } });
  clamFlip(two, "mine");
  assert.equal(life(two, "mine"), 5);
});

clause(CLAM, "1:flipUp", "FLIP UP: it still needs a pick (COST: Pick a character), and cannot pick a non-character", () => {
  const none = clamBoard({ hash: "play", faceDown: true, icons: { greed: 3 } });
  refused(() => flipUpRaw(none.engine, P1, none.id("hash")), "no character picked");
  assert.equal(cardOf(none.engine, none.id("hash")).faceDown, true);
  const item2 = clamBoard({ hash: "play", faceDown: true, icons: { greed: 3 }, extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] });
  refused(() => clamFlipRaw(item2, "it"), "an item is not a character");
  const ok = clamBoard({ hash: "play", faceDown: true, icons: { greed: 3 }, extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] });
  clamFlip(ok, "foe");
  assert.equal(life(ok, "foe"), 6, "control: a character works");
});

clause(CLAM, "1:flipUp", "FLIP UP is only for a face-down card I control: refused from the hand, and for a face-down Hash my opponent controls", () => {
  const inHand = clamBoard({ hash: "hand", icons: { greed: 3 } });
  refused(() => clamFlipRaw(inHand, "mine"), "in the hand");
  const theirs = clamBoard({ hash: "play", faceDown: true, hashOwner: P2, icons: { greed: 3 } });
  refused(() => clamFlipRaw(theirs, "mine", P1), "their face-down card");
  assert.equal(cardOf(theirs.engine, theirs.id("hash")).faceDown, true);
  const faceUp = clamBoard({ hash: "discard", icons: { greed: 3 } });
  refused(() => clamFlipRaw(faceUp, "mine"), "in the discard pile");
});

clause(CLAM, "1:flipUp", "FLIP UP of a tactic works as a response on my opponent's turn (it is a tactic)", () => {
  const g = clamBoard({
    hash: "play",
    faceDown: true,
    icons: { greed: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  clamFlip(g, "mine");
  assert.equal(life(g, "mine"), 5);
  assert.equal(zoneOf(g.engine, g.id("hash")), "hand");
});

clause(CLAM, "1:flipUp", "FLIP UP: a card I control but my opponent owns goes to its OWNER's hand, not mine", () => {
  const g = clamBoard({ hash: "play", faceDown: true, hashOwner: P2, hashController: P1, icons: { greed: 2 } });
  assert.equal(cardOf(g.engine, g.id("hash")).controllerId, P1, "control: I control the face-down card");
  clamFlip(g, "mine");
  assert.equal(life(g, "mine"), 5, "it resolved");
  assert.equal(zoneOf(g.engine, g.id("hash")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("hash")), "its owner's hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("hash")), false);
});

clause(CLAM, "1:flipUp", "FLIP UP: after it returns to the hand, playing it normally later goes to the discard pile as usual", () => {
  const g = clamBoard({ hash: "play", faceDown: true, icons: { greed: 4 } });
  clamFlip(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("hash")), "hand");
  play(g.engine, P1, g.id("hash"), { selected: { t: [g.id("foe")] } });
  assert.equal(life(g, "foe"), 6);
  assert.equal(zoneOf(g.engine, g.id("hash")), "discard", "this time it was not played using FLIP UP");
});

clause(CLAM, "1:flipUp", "FLIP UP: an unflipped Clam Hash is a blank resource: it provides Volition but no tactic effect", () => {
  const g = clamBoard({ hash: "play", faceDown: true, icons: {} });
  assert.deepEqual(g.engine.getCardTypes(g.id("hash")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition, 1);
});

// =================================================================================
// Delectable Boon
// COST: Choose a number for X. Pay X. Pick 2 characters, locations, and/or factions.
// EFFECT: The next X damage inflicted to the first picked card this turn is inflicted to
// the second picked card instead.
// Tactic (banker), cost 0, [G][G].
// =================================================================================

const BOON = "0239722a-85a6-46ab-ab23-dc85d11fd4b3";

function boonBoard(
  opts: {
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    zaps?: number[];
  } = {}
) {
  const zaps: CardPlacement[] = (opts.zaps ?? [2]).map((amount, i) => ({ key: `zap${i}`, def: damageTactic(amount, `Zap ${amount} #${i}`), owner: P1 as PlayerId, zone: "hand" as Zone }));
  return devBoard(
    [
      { key: "boon", def: printing(BOON), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "Alpha", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "Charlie", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "f", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Fort", structure: 8 }), owner: P1, zone: "play" },
      { key: "oloc", def: location({ name: "Their Fort", structure: 8 }), owner: P2, zone: "play" },
      ...zaps,
      ...res(opts.icons ?? { greed: 8 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type BoonBoard = ReturnType<typeof boonBoard>;
const factionOfP = (g: BoonBoard, p: PlayerId) => g.engine.state.players[p].factionId!;
/** A pick for the Boon: a board key or one of the faction cards ("faction1" / "faction2"). */
const pickId = (g: BoonBoard, key: string): CardInstanceId => (key === "faction1" ? factionOfP(g, P1) : key === "faction2" ? factionOfP(g, P2) : g.id(key));
const boonArgs = (g: BoonBoard, first: string, second: string, x: number) => ({ selected: { first: [pickId(g, first)], second: [pickId(g, second)] }, variables: { x } });
const boonPlay = (g: BoonBoard, first: string, second: string, x: number) => play(g.engine, P1, g.id("boon"), boonArgs(g, first, second, x));
const boonPlayRaw = (g: BoonBoard, first: string, second: string, x: number) => playRaw(g.engine, P1, g.id("boon"), boonArgs(g, first, second, x));
/** I zap `target` for the board's `n`th zap. */
const zapPlay = (g: BoonBoard, target: string, n = 0) => play(g.engine, P1, g.id(`zap${n}`), { selected: { t: [pickId(g, target)] } });
const dmg = (g: BoonBoard, key: string): number => cardOf(g.engine, pickId(g, key)).damage;

clause(BOON, "0:ability", "X = 2: the next 2 damage to the first card is inflicted to the second card instead", () => {
  const g = boonBoard();
  boonPlay(g, "a", "b", 2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 0, "the first card takes nothing");
  assert.equal(dmg(g, "b"), 2, "the second card takes the 2 damage instead");
});

clause(BOON, "0:ability", "X = 3 against 5 damage: only the next 3 are redirected, the remaining 2 hit the first card", () => {
  const g = boonBoard({ zaps: [5] });
  boonPlay(g, "a", "b", 3);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 2, "5 - 3 stays on the first card");
  assert.equal(dmg(g, "b"), 3, "exactly X is redirected");
});

clause(BOON, "0:ability", "X = 3 against 2 damage: all 2 are redirected, and 1 of the 3 is left to redirect", () => {
  const g = boonBoard({ zaps: [2, 2] });
  boonPlay(g, "a", "b", 3);
  zapPlay(g, "a", 0);
  assert.equal(dmg(g, "a"), 0);
  assert.equal(dmg(g, "b"), 2);
  zapPlay(g, "a", 1);
  assert.equal(dmg(g, "a"), 1, "'the next X damage' is X points in all: only 1 of the second hit is redirected");
  assert.equal(dmg(g, "b"), 3, "the remaining 1 of X was redirected, so the second card has 3 in total");
});

clause(BOON, "0:ability", "once X damage has been redirected, later damage to the first card is inflicted to it normally", () => {
  const g = boonBoard({ zaps: [2, 3] });
  boonPlay(g, "a", "b", 2);
  zapPlay(g, "a", 0);
  zapPlay(g, "a", 1);
  assert.equal(dmg(g, "b"), 2, "only the next 2 damage were redirected");
  assert.equal(dmg(g, "a"), 3, "the next hit lands on the first card");
});

clause(BOON, "0:ability", "X = 1 redirects exactly 1 of 3 damage", () => {
  const g = boonBoard({ zaps: [3] });
  boonPlay(g, "a", "b", 1);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 2);
  assert.equal(dmg(g, "b"), 1);
});

clause(BOON, "0:ability", "X = 0 is a legal number: nothing is redirected and nothing is paid", () => {
  const g = boonBoard({ zaps: [2] });
  const before = ready(g.engine);
  boonPlay(g, "a", "b", 0);
  assert.equal(before - ready(g.engine), 0, "Pay 0");
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 2, "no damage is redirected");
  assert.equal(dmg(g, "b"), 0);
  assert.equal(zoneOf(g.engine, g.id("boon")), "discard");
});

clause(BOON, "0:ability", "the cost is exactly X: 0, 1 and 3 resources for X = 0, 1, 3", () => {
  for (const x of [0, 1, 3]) {
    const g = boonBoard();
    const before = ready(g.engine);
    boonPlay(g, "a", "b", x);
    assert.equal(before - ready(g.engine), x, `X = ${x}`);
  }
});

clause(BOON, "0:ability", "the cost is paid when the tactic is played, before my opponent can respond", () => {
  const g = boonBoard();
  const before = ready(g.engine);
  boonPlayRaw(g, "a", "b", 3);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 3);
  assert.equal(zoneOf(g.engine, g.id("boon")), "deploying");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("boon")), "discard");
});

clause(BOON, "0:ability", "Pay X: refused when I have fewer than X free resources (X = 3 with 2 free), accepted with exactly X", () => {
  const spent: CardPlacement[] = bank("greed", 6, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = boonBoard({ icons: {}, extra: [...spent, ...res({ rage: 2 })] });
  assert.equal(ready(short.engine), 2);
  refused(() => boonPlayRaw(short, "a", "b", 3), "X = 3 with only 2 free resources");
  assert.equal(zoneOf(short.engine, short.id("boon")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was paid");
  const exact = boonBoard({ icons: {}, extra: [...bank("greed", 6, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...res({ rage: 3 })] });
  boonPlay(exact, "a", "b", 3);
  assert.equal(ready(exact.engine), 0);
});

clause(BOON, "0:ability", "needs [G][G]: refused with a single Greed no matter how much I can pay", () => {
  const one = boonBoard({ icons: { greed: 1, rage: 6 } });
  refused(() => boonPlayRaw(one, "a", "b", 1), "[G] is short of [G][G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(one.engine, one.id("boon")), "hand");
  const two = boonBoard({ icons: { greed: 2, rage: 1 } });
  boonPlay(two, "a", "b", 1);
  assert.equal(zoneOf(two.engine, two.id("boon")), "discard");
});

clause(BOON, "0:ability", "X is a number I choose: a negative X is refused", () => {
  const g = boonBoard();
  refused(() => boonPlayRaw(g, "a", "b", -1), "X = -1");
  assert.equal(zoneOf(g.engine, g.id("boon")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(BOON, "0:ability", "X is a whole number (CR 410.2): X = 1.5 is refused", () => {
  const g = boonBoard();
  refused(() => boonPlayRaw(g, "a", "b", 1.5), "X = 1.5");
  assert.equal(zoneOf(g.engine, g.id("boon")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(BOON, "0:ability", "damage to any OTHER card is inflicted normally and does not use up the redirect", () => {
  const g = boonBoard({ zaps: [2, 2, 2] });
  boonPlay(g, "a", "b", 2);
  zapPlay(g, "c", 0);
  assert.equal(dmg(g, "c"), 2, "a third card takes its own damage");
  zapPlay(g, "f", 1);
  assert.equal(dmg(g, "f"), 2, "so does an opposing card");
  assert.equal(dmg(g, "b"), 0, "nothing was redirected to the second card yet");
  zapPlay(g, "a", 2);
  assert.equal(dmg(g, "a"), 0, "the redirect was still waiting for damage to the first card");
  assert.equal(dmg(g, "b"), 2);
});

clause(BOON, "0:ability", "damage to the SECOND card is not redirected anywhere: it takes it as usual", () => {
  const g = boonBoard({ zaps: [2] });
  boonPlay(g, "a", "b", 2);
  zapPlay(g, "b");
  assert.equal(dmg(g, "b"), 2);
  assert.equal(dmg(g, "a"), 0);
});

clause(BOON, "0:ability", "the order of the picks matters: first = the card whose damage moves, second = the card that takes it", () => {
  const g = boonBoard({ zaps: [2] });
  boonPlay(g, "b", "a", 2);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 2, "'a' was picked second, so it is the one receiving damage");
  assert.equal(dmg(g, "b"), 0);
});

clause(BOON, "0:ability", "the redirect lasts only this turn: damage inflicted after the turn ends is not redirected", () => {
  const g = boonBoard({
    icons: { greed: 8 },
    zaps: [],
    extra: [{ key: "zapP2", def: damageTactic(2, "Their Zap"), owner: P2, zone: "hand" }, ...res({ rage: 2 }, P2)]
  });
  boonPlay(g, "a", "b", 5);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2);
  play(g.engine, P2, g.id("zapP2"), { selected: { t: [g.id("a")] } });
  assert.equal(dmg(g, "a"), 2, "the next turn's damage lands on the first card");
  assert.equal(dmg(g, "b"), 0);
});

clause(BOON, "0:ability", "the redirect also applies to damage my OPPONENT inflicts, in the same turn (their tactic, my Boon in response)", () => {
  const g = boonBoard({ zaps: [], extra: [{ key: "zapP2", def: damageTactic(3, "Their Zap"), owner: P2, zone: "hand" }], active: P2 });
  // it is their turn: they zap my Alpha; I respond with the Boon, which resolves first (LIFO)
  playRaw(g.engine, P2, g.id("zapP2"), { selected: { t: [g.id("a")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1, "I may respond");
  respondWith(g.engine, P1, g.id("boon"), { first: [g.id("a")], second: [g.id("b")] }, { x: 3 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(dmg(g, "a"), 0, "their damage to my first card is redirected");
  assert.equal(dmg(g, "b"), 3, "to my second card");
});

clause(BOON, "0:ability", "first and second can belong to different players: my opponent's character takes the damage meant for mine", () => {
  const g = boonBoard({ zaps: [2] });
  boonPlay(g, "a", "f", 2);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 0);
  assert.equal(dmg(g, "f"), 2);
});

clause(BOON, "0:ability", "first and second can both belong to my opponent", () => {
  const g = boonBoard({ zaps: [2], extra: [{ key: "f2", def: character({ name: "Foe Two", life: 6 }), owner: P2, zone: "play" }] });
  boonPlay(g, "f", "f2", 2);
  zapPlay(g, "f");
  assert.equal(dmg(g, "f"), 0);
  assert.equal(dmg(g, "f2"), 2);
});

clause(BOON, "0:ability", "a LOCATION can be the first card: damage to it is inflicted to a character instead", () => {
  const g = boonBoard({ zaps: [3] });
  boonPlay(g, "loc", "a", 3);
  zapPlay(g, "loc");
  assert.equal(dmg(g, "loc"), 0);
  assert.equal(dmg(g, "a"), 3);
});

clause(BOON, "0:ability", "a LOCATION can be the second card: it takes the damage meant for a character", () => {
  const g = boonBoard({ zaps: [3] });
  boonPlay(g, "a", "oloc", 3);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 0);
  assert.equal(dmg(g, "oloc"), 3);
});

clause(BOON, "0:ability", "two locations: one's damage moves to the other", () => {
  const g = boonBoard({ zaps: [2] });
  boonPlay(g, "oloc", "loc", 2);
  zapPlay(g, "oloc");
  assert.equal(dmg(g, "oloc"), 0);
  assert.equal(dmg(g, "loc"), 2);
});

clause(BOON, "0:ability", "a FACTION can be the first card: damage to my opponent's faction (influence loss) is inflicted to a character instead", () => {
  const g = boonBoard({ zaps: [3] });
  boonPlay(g, "faction2", "f", 3);
  zapPlay(g, "faction2");
  assert.equal(influenceOf(g.engine, P2), START, "their faction lost no influence");
  assert.equal(dmg(g, "f"), 3, "the character took the damage");
});

clause(BOON, "0:ability", "a FACTION can be the second card: it loses the influence that the first card was spared", () => {
  const g = boonBoard({ zaps: [3] });
  boonPlay(g, "a", "faction2", 3);
  zapPlay(g, "a");
  assert.equal(dmg(g, "a"), 0);
  assert.equal(influenceOf(g.engine, P2), START - 3, "damage inflicted to a faction is lost influence (CR 408.3)");
});

clause(BOON, "0:ability", "my own faction can be picked, first or second", () => {
  const first = boonBoard({ zaps: [2] });
  boonPlay(first, "faction1", "a", 2);
  zapPlay(first, "faction1");
  assert.equal(influenceOf(first.engine, P1), START, "my faction is spared");
  assert.equal(dmg(first, "a"), 2);
  const second = boonBoard({ zaps: [2] });
  boonPlay(second, "a", "faction1", 2);
  zapPlay(second, "a");
  assert.equal(influenceOf(second.engine, P1), START - 2);
  assert.equal(dmg(second, "a"), 0);
});

clause(BOON, "0:ability", "two factions: damage to one is inflicted to the other", () => {
  const g = boonBoard({ zaps: [4] });
  boonPlay(g, "faction2", "faction1", 4);
  zapPlay(g, "faction2");
  assert.equal(influenceOf(g.engine, P2), START);
  assert.equal(influenceOf(g.engine, P1), START - 4);
});

clause(BOON, "0:ability", "lethal redirected damage destroys the second card as damage does", () => {
  const g = boonBoard({ zaps: [6], extra: [{ key: "frail", def: character({ name: "Frail", life: 2 }), owner: P1, zone: "play" }] });
  boonPlay(g, "a", "frail", 6);
  zapPlay(g, "a");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard", "6 damage on a 2-life character");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(dmg(g, "a"), 0);
});

clause(BOON, "0:ability", "redirected combat damage: damage a battle assigns to the first card is inflicted to the second card instead", () => {
  const g = boonBoard({
    zaps: [],
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 6, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("boon"), { first: [g.id("a")], second: [g.id("b")] }, { x: 3 });
  declareBlockers(g.engine, P1, [g.id("a")]);
  finishBattle(g.engine);
  assert.equal(dmg(g, "a"), 0, "the blocker took no battle damage");
  assert.equal(dmg(g, "b"), 3, "the second card took the 3 battle damage instead");
});

clause(BOON, "0:ability", "redirected combat damage to a faction: an unblocked attacker's damage is inflicted to the second card, not lost as influence", () => {
  const g = boonBoard({
    zaps: [],
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 6, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("boon"), { first: [pickId(g, "faction1")], second: [g.id("b")] }, { x: 3 });
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(influenceOf(g.engine, P1), START, "my faction lost no influence");
  assert.equal(dmg(g, "b"), 3);
});

for (const bad of NOT_CHARACTERS.filter((n) => n.key !== "loc")) {
  clause(BOON, "0:ability", `cannot pick ${bad.why} as the first card`, () => {
    const g = boonBoard({ extra: bad.extra });
    refused(() => boonPlayRaw(g, bad.key, "b", 1), `${bad.why} as first`);
    assert.equal(zoneOf(g.engine, g.id("boon")), "hand");
    assert.equal(ready(g.engine), 8, "nothing was paid");
    const control = boonBoard({ extra: bad.extra });
    boonPlay(control, "a", "b", 1);
    assert.equal(zoneOf(control.engine, control.id("boon")), "discard", "control: the same board accepts legal picks");
  });
  clause(BOON, "0:ability", `cannot pick ${bad.why} as the second card`, () => {
    const g = boonBoard({ extra: bad.extra });
    refused(() => boonPlayRaw(g, "a", bad.key, 1), `${bad.why} as second`);
    assert.equal(zoneOf(g.engine, g.id("boon")), "hand");
    assert.equal(ready(g.engine), 8);
  });
}

clause(BOON, "0:ability", "needs 2 DIFFERENT cards: the same card as first and second is refused", () => {
  const g = boonBoard();
  refused(() => boonPlayRaw(g, "a", "a", 1), "the same card twice");
  assert.equal(zoneOf(g.engine, g.id("boon")), "hand");
  assert.equal(ready(g.engine), 8);
});

clause(BOON, "0:ability", "needs both picks: with only a first or only a second card it cannot be played", () => {
  const g = boonBoard();
  refused(() => playRaw(g.engine, P1, g.id("boon"), { selected: { first: [g.id("a")] }, variables: { x: 1 } }), "no second card");
  const g2 = boonBoard();
  refused(() => playRaw(g2.engine, P1, g2.id("boon"), { selected: { second: [g2.id("a")] }, variables: { x: 1 } }), "no first card");
  const g3 = boonBoard();
  refused(() => playRaw(g3.engine, P1, g3.id("boon"), { variables: { x: 1 } }), "no picks");
  assert.equal(zoneOf(g3.engine, g3.id("boon")), "hand");
});

clause(BOON, "0:ability", "redirected combat damage with X smaller than the hit: only the next X of a blocker's damage moves, the rest lands on it", () => {
  const g = boonBoard({
    zaps: [],
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("boon"), { first: [g.id("a")], second: [g.id("b")] }, { x: 3 });
  declareBlockers(g.engine, P1, [g.id("a")]);
  finishBattle(g.engine);
  assert.equal(dmg(g, "a"), 2, "5 battle damage minus the 3 that were redirected");
  assert.equal(dmg(g, "b"), 3);
});

clause(BOON, "0:ability", "redirected combat damage: a location being attacked passes its damage to the second card", () => {
  const g = boonBoard({
    zaps: [],
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("atk")], target: { type: "card", cardId: g.id("loc") } });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  respondWith(g.engine, P1, g.id("boon"), { first: [g.id("loc")], second: [g.id("b")] }, { x: 3 });
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(dmg(g, "loc"), 0, "the attacked location took nothing");
  assert.equal(dmg(g, "b"), 3);
});

clause(BOON, "0:ability", "redirected combat damage: the first card's own damage to the attacker is not redirected (only damage INFLICTED TO the first card)", () => {
  const g = boonBoard({
    zaps: [],
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  respondWith(g.engine, P1, g.id("boon"), { first: [g.id("a")], second: [g.id("b")] }, { x: 2 });
  declareBlockers(g.engine, P1, [g.id("a")]);
  finishBattle(g.engine);
  assert.equal(dmg(g, "atk"), 1, "the blocker (strength 1) still damaged the attacker");
  assert.equal(dmg(g, "b"), 2);
});

clause(BOON, "0:ability", "the Boon ends in its owner's discard pile after resolving", () => {
  const g = boonBoard();
  boonPlay(g, "a", "b", 1);
  assert.equal(zoneOf(g.engine, g.id("boon")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("boon")), "discardOf(g.engine, P1).includes(g.id(\"boon\"))");
});

// =================================================================================
// Derelict Seafarer
// When this card enters play, your faction loses 3 influence. Put a random card from your
// discard pile into your hand.
// RETIRE: [G][G][G] -- COST: Use this only while this card is not in a battle. Pay 2.
// EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 3 [G]
// Character (banker; pirate, mercenary, mau), cost 5, [G], 4 / 3 / 4.
// =================================================================================

const SEAFARER = "4600d164-3e6d-4799-a2d5-97ac92d5a5e3";

/** Five different cards in P1's discard pile: character, tactic, item, location, staple resource. */
const mixedDiscard = (owner: PlayerId = P1, prefix = "dc"): CardPlacement[] => [
  { key: `${prefix}0`, def: character({ name: `${prefix} Character` }), owner, zone: "discard" },
  { key: `${prefix}1`, def: tactic({ name: `${prefix} Tactic` }), owner, zone: "discard" },
  { key: `${prefix}2`, def: item({ name: `${prefix} Item` }), owner, zone: "discard" },
  { key: `${prefix}3`, def: location({ name: `${prefix} Location` }), owner, zone: "discard" },
  { key: `${prefix}4`, def: stapleCard(`${prefix} Rage`, "rage"), owner, zone: "discard" }
];

function seaBoard(
  opts: {
    sea?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    discard?: boolean | CardPlacement[];
    random?: () => number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    influence?: number;
    owner?: PlayerId;
    controller?: PlayerId;
  } = {}
) {
  const discard = opts.discard === false ? [] : Array.isArray(opts.discard) ? opts.discard : mixedDiscard();
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sea", def: printing(SEAFARER), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.sea ?? "hand", faceDown: opts.faceDown },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...discard,
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

type SeaBoard = ReturnType<typeof seaBoard>;
const seaDeploy = (g: SeaBoard) => {
  play(g.engine, P1, g.id("sea"));
  drain(g.engine, declineAll);
};
const seaRetireRaw = (g: SeaBoard, player: PlayerId = P1) => actRaw(g.engine, player, g.id("sea"), "seafarer-retire");
const seaRetire = (g: SeaBoard, player: PlayerId = P1) => {
  seaRetireRaw(g, player);
  resolvePendingResponses(g.engine);
};
/** Which of the discard keys went to the hand. */
const discardKeys = ["dc0", "dc1", "dc2", "dc3", "dc4"];
const inHandKeys = (g: SeaBoard, keys = discardKeys) => keys.filter((k) => zoneOf(g.engine, g.id(k)) === "hand");

clause(SEAFARER, "0:rule", "when it enters play my faction loses exactly 3 influence", () => {
  const g = seaBoard();
  assert.equal(influenceOf(g.engine, P1), START);
  seaDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("sea")), "play");
  assert.equal(influenceOf(g.engine, P1), START - 3);
  assert.equal(influenceOf(g.engine, P2), START, "control: the opponent's faction is untouched");
});

clause(SEAFARER, "0:rule", "it is 'your faction': the loss happens once, on entering, and only to its controller's faction", () => {
  const g = seaBoard();
  seaDeploy(g);
  assert.equal(g.engine.state.winner, undefined);
  assert.equal(influenceOf(g.engine, P1), START - 3);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(influenceOf(g.engine, P1), START - 3, "no repeat loss on later turns");
});

clause(SEAFARER, "0:rule", "it also puts exactly one random card from my discard pile into my hand", () => {
  const g = seaBoard({ random: () => 0 });
  const handBefore = handOf(g.engine, P1).length;
  const discardBefore = discardOf(g.engine, P1).length;
  seaDeploy(g);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "the Seafarer left the hand and exactly one card entered it");
  assert.equal(discardOf(g.engine, P1).length, discardBefore - 1);
  assert.equal(inHandKeys(g).length, 1, "exactly one of the five discard cards is now in my hand");
});

clause(SEAFARER, "0:rule", "the card is picked at random: four different random values over four cards pick four different cards", () => {
  const picked = new Set<string>();
  for (const r of [0, 0.26, 0.51, 0.76]) {
    const g = seaBoard({
      random: () => r,
      discard: [0, 1, 2, 3].map((i) => ({ key: `dc${i}`, def: character({ name: `Card ${i}` }), owner: P1, zone: "discard" as Zone }))
    });
    seaDeploy(g);
    const got = inHandKeys(g, ["dc0", "dc1", "dc2", "dc3"]);
    assert.equal(got.length, 1, `random ${r}: exactly one card returned`);
    picked.add(got[0]);
  }
  assert.equal(picked.size, 4, "each card is picked for exactly one quarter of the random range");
});

clause(SEAFARER, "0:rule", "'a random card': any type can come back: character, tactic, item, location and resource", () => {
  const picked = new Set<string>();
  for (const r of [0, 0.21, 0.41, 0.61, 0.81]) {
    const g = seaBoard({ random: () => r });
    seaDeploy(g);
    const got = inHandKeys(g);
    assert.equal(got.length, 1, `random ${r}`);
    picked.add(got[0]);
  }
  assert.equal(picked.size, 5, "all five card types are possible results");
});

clause(SEAFARER, "0:rule", "the pool is MY discard pile only: cards in my opponent's discard pile are never taken", () => {
  for (const r of [0, 0.5, 0.99]) {
    const g = seaBoard({
      random: () => r,
      discard: [{ key: "dc0", def: character({ name: "Mine Only" }), owner: P1, zone: "discard" }],
      extra: mixedDiscard(P2, "opp")
    });
    seaDeploy(g);
    assert.equal(zoneOf(g.engine, g.id("dc0")), "hand", `random ${r}: my only discard card comes back`);
    for (const key of ["opp0", "opp1", "opp2", "opp3", "opp4"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} stays in their discard pile`);
    assert.equal(handOf(g.engine, P2).length, 0);
  }
});

clause(SEAFARER, "0:rule", "the pool excludes my hand, deck and removed cards: only discard-pile cards are candidates", () => {
  const g = seaBoard({
    random: () => 0.5,
    discard: [{ key: "dc0", def: character({ name: "Only Discard" }), owner: P1, zone: "discard" }],
    extra: [
      { key: "h", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "k", def: character({ name: "In Deck" }), owner: P1, zone: "deck" },
      { key: "r", def: character({ name: "Removed" }), owner: P1, zone: "removed" }
    ]
  });
  seaDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("dc0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("k")), "deck");
  assert.equal(zoneOf(g.engine, g.id("r")), "removed");
});

clause(SEAFARER, "0:rule", "with an empty discard pile it still loses 3 influence and nothing else happens", () => {
  const g = seaBoard({ discard: false });
  const handBefore = handOf(g.engine, P1).length;
  seaDeploy(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P1), START - 3);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1, "only the Seafarer left the hand");
  assert.equal(zoneOf(g.engine, g.id("sea")), "play");
});

clause(SEAFARER, "0:rule", "the influence loss is not damage: it still happens while all damage is reduced to 0", () => {
  const shield = tactic({
    name: "Limited Shield",
    cost: 0,
    behavior: { abilities: [{ id: "shield", type: "activated", effects: [{ type: "preventAllDamage", duration: { type: "untilEndOfTurn" } }] }] }
  });
  const g = seaBoard({ extra: [{ key: "shield", def: shield, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("shield"));
  seaDeploy(g);
  assert.equal(influenceOf(g.engine, P1), START - 3, "CR 408.3b: loss of influence ignores damage modification");
});

clause(SEAFARER, "0:rule", "with exactly 3 influence the loss takes my faction to 0 and I lose the game", () => {
  const g = seaBoard({ influence: 3 });
  seaDeploy(g);
  assert.equal(influenceOf(g.engine, P1), 0);
  assert.equal(g.engine.state.winner, P2);
});

clause(SEAFARER, "0:rule", "with only 2 influence the loss stops at 0 (CR 410.4): influence is never below 0", () => {
  const g = seaBoard({ influence: 2 });
  seaDeploy(g);
  assert.equal(influenceOf(g.engine, P1), 0, "a number cannot go below 0");
});

clause(SEAFARER, "0:rule", "with only 2 influence the loss still ends the game: I lose", () => {
  const g = seaBoard({ influence: 2 });
  seaDeploy(g);
  assert.ok(influenceOf(g.engine, P1) <= 0, "influenceOf(g.engine, P1) <= 0");
  assert.equal(g.engine.state.winner, P2);
});

clause(SEAFARER, "0:rule", "it happens when the card ENTERS play, however it gets there: put into play from the deck by another card's effect", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "deck", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = seaBoard({ sea: "deck", extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("sea")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("sea")), "play", "control: it was put into play");
  assert.equal(influenceOf(g.engine, P1), START - 3);
  assert.equal(inHandKeys(g).length, 1);
});

clause(SEAFARER, "0:rule", "it does not trigger when ANOTHER character enters play, or when the Seafarer itself leaves play", () => {
  const other2 = character({ name: "Newcomer", cost: 0 });
  const g = seaBoard({
    sea: "play",
    extra: [
      { key: "newcomer", def: other2, owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("newcomer"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newcomer")), "play", "control: the other character entered");
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(inHandKeys(g).length, 0);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("sea")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("sea")), "discard", "control: the Seafarer left play");
  assert.equal(influenceOf(g.engine, P1), START, "leaving play costs no influence");
  assert.equal(inHandKeys(g).length, 0);
});

clause(SEAFARER, "0:rule", "played face-down as a resource it has no rules text: no influence loss, no card returned (CR 411.1)", () => {
  const g = seaBoard();
  developResource(g.engine, P1, g.id("sea"), true);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true, "control: it entered face-down");
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(inHandKeys(g).length, 0);
});

clause(SEAFARER, "0:rule", "each time it enters play it triggers: killed, returned to hand and deployed again it costs another 3 influence", () => {
  const g = seaBoard({
    icons: { greed: 12 },
    extra: [
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "back", def: moverTactic("discard", "hand"), owner: P1, zone: "hand" }
    ]
  });
  seaDeploy(g);
  assert.equal(influenceOf(g.engine, P1), START - 3);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("sea")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("sea")), "discard");
  play(g.engine, P1, g.id("back"), { selected: { t: [g.id("sea")] } });
  assert.equal(zoneOf(g.engine, g.id("sea")), "hand", "control: it came back to the hand");
  seaDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("sea")), "play");
  assert.equal(influenceOf(g.engine, P1), START - 6, "a second entering, a second 3 influence");
});

// --- RETIRE ---------------------------------------------------------------------

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE flips the Seafarer face-down under its owner's control: a face-down resource that stays in play", () => {
  const g = seaBoard({ sea: "play" });
  seaRetire(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("sea"));
  assert.equal(card.zone, "play", "still in play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.deepEqual(g.engine.getCardTypes(g.id("sea")), ["resource"]);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE costs exactly 2 and the flipped card is a new Volition resource", () => {
  const g = seaBoard({ sea: "play", icons: { greed: 6 } });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  const before = ready(g.engine);
  seaRetire(g);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(before - ready(g.engine), 1, "paid 2, gained the 1 free face-down resource: net -1 free");
  assert.equal(attachedCount(g.engine, P1), 2, "exactly two resources were spent on the faction");
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE: the cost is paid on activation, before my opponent can respond", () => {
  const g = seaBoard({ sea: "play", icons: { greed: 6 } });
  const before = ready(g.engine);
  seaRetireRaw(g);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 2);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false, "the flip waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE needs [G][G][G]: refused with two Greed and plenty of other resources, accepted with three", () => {
  const two = seaBoard({ sea: "play", icons: { greed: 2, rage: 5 } });
  refused(() => seaRetireRaw(two), "[G][G] is short of [G][G][G]", /threshold/i);
  assert.equal(cardOf(two.engine, two.id("sea")).faceDown, false);
  assert.equal(ready(two.engine), 7);
  const three = seaBoard({ sea: "play", icons: { greed: 3 } });
  seaRetire(three);
  assert.equal(cardOf(three.engine, three.id("sea")).faceDown, true);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE needs 2 free resources: refused with 1 free even when [G][G][G] is controlled", () => {
  const spent = bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = seaBoard({ sea: "play", icons: {}, extra: [...spent, ...res({ rage: 1 })] });
  assert.equal(ready(short.engine), 1);
  refused(() => seaRetireRaw(short), "1 free resource for Pay 2");
  assert.equal(cardOf(short.engine, short.id("sea")).faceDown, false);
  const exact = seaBoard({ sea: "play", icons: {}, extra: [...bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...res({ rage: 2 })] });
  seaRetire(exact);
  assert.equal(cardOf(exact.engine, exact.id("sea")).faceDown, true);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE is refused while the Seafarer is attacking (it is in a battle)", () => {
  const g = seaBoard({ sea: "play" });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("sea")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(g.engine), "control: a battle is under way");
  refused(() => seaRetireRaw(g), "the Seafarer is in a battle", /condition is not satisfied/i);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false);
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE is refused while the Seafarer is blocking (it is in a battle)", () => {
  const g = seaBoard({ sea: "play", turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [g.id("sea")]);
  assert.ok(battleOf(g.engine)?.blockingParty.includes(g.id("sea")), "control: it is blocking");
  // Pass until I hold priority in a battle window, if the engine offers one
  let tries = 0;
  while (g.engine.state.responseWindow && g.engine.state.responseWindow.priorityPlayerId !== P1 && tries++ < 5) {
    g.engine.perform({ type: "passPriority", playerId: g.engine.state.responseWindow.priorityPlayerId });
  }
  refused(() => seaRetireRaw(g), "the Seafarer is in a battle", /condition is not satisfied/i);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE is allowed while OTHER characters fight: the Seafarer itself is not in the battle", () => {
  const g = seaBoard({ sea: "play", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.ok(battleOf(g.engine), "control: a battle is under way");
  assert.equal(battleOf(g.engine)?.attackingParty.includes(g.id("sea")), false);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I have priority");
  seaRetireRaw(g);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true, "it flipped face-down mid-battle: it was never in that battle");
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE works again after the battle it was in is over", () => {
  const g = seaBoard({ sea: "play" });
  declareAttackBy(g.engine, P1, [g.id("sea")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(battleOf(g.engine), undefined);
  seaRetire(g);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE can be used as a response on my opponent's turn, outside any battle", () => {
  const g = seaBoard({ sea: "play", turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  seaRetireRaw(g);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE puts a Seafarer I stole back under its OWNER's control", () => {
  const g = seaBoard({ sea: "play", owner: P2, controller: P1 });
  assert.equal(cardOf(g.engine, g.id("sea")).controllerId, P1, "control: I control it first");
  seaRetire(g);
  const card = cardOf(g.engine, g.id("sea"));
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2, "under its owner's control");
  assert.ok(playOf(g.engine, P2).includes(g.id("sea")), "playOf(g.engine, P2).includes(g.id(\"sea\"))");
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE is the controller's: my opponent cannot use it on my Seafarer", () => {
  const g = seaBoard({ sea: "play", turn: 2, active: P2, icons: { greed: 6 }, extra: [...res({ greed: 6 }, P2), { key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  // P2's turn: P1 holds no priority; P2 trying to use P1's Seafarer's ability
  refused(() => seaRetireRaw(g, P2), "not their card");
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false);
});

clause(SEAFARER, "1:ability:seafarer-retire", "RETIRE only works from play: a Seafarer in my hand cannot Retire", () => {
  const g = seaBoard({ sea: "hand" });
  refused(() => seaRetireRaw(g), "in the hand");
  assert.equal(zoneOf(g.engine, g.id("sea")), "hand");
});

clause(SEAFARER, "1:ability:seafarer-retire", "after RETIRE the Seafarer can come back with FLIP UP, entering play again (and costing 3 influence again)", () => {
  const g = seaBoard({ sea: "play", icons: { greed: 8 } });
  seaRetire(g);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true);
  flipUpRaw(g.engine, P1, g.id("sea"));
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false);
  assert.equal(influenceOf(g.engine, P1), START - 3, "the enters-play trigger fired for the flipped-up card");
  assert.equal(inHandKeys(g).length, 1);
});

// --- FLIP UP ---------------------------------------------------------------------

clause(SEAFARER, "2:flipUp", "FLIP UP puts the Seafarer into play face-up: it enters play, losing 3 influence and returning a random discard card", () => {
  const g = seaBoard({ sea: "play", faceDown: true, icons: { greed: 4 }, random: () => 0 });
  flipUpRaw(g.engine, P1, g.id("sea"));
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  const card = cardOf(g.engine, g.id("sea"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("sea")), ["character"]);
  assert.equal(influenceOf(g.engine, P1), START - 3);
  assert.equal(inHandKeys(g).length, 1);
});

clause(SEAFARER, "2:flipUp", "FLIP UP costs exactly 3 (not its printed 5): refused with 2 free resources, accepted with 3", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = seaBoard({ sea: "play", faceDown: true, icons: {}, extra: [...spent(1), ...res({ rage: 1 })] });
  assert.equal(ready(short.engine), 2, "the face-down Seafarer + 1 more");
  refused(() => flipUpRaw(short.engine, P1, short.id("sea")), "2 free resources for FLIP UP 3");
  assert.equal(cardOf(short.engine, short.id("sea")).faceDown, true);
  const exact = seaBoard({ sea: "play", faceDown: true, icons: {}, extra: [...spent(1), ...res({ rage: 2 })] });
  assert.equal(ready(exact.engine), 3);
  flipUpRaw(exact.engine, P1, exact.id("sea"));
  resolvePendingResponses(exact.engine);
  drain(exact.engine, declineAll);
  assert.equal(cardOf(exact.engine, exact.id("sea")).faceDown, false);
  assert.equal(ready(exact.engine), 0);
});

clause(SEAFARER, "2:flipUp", "FLIP UP needs [G]: refused with plenty of resources but no Greed", () => {
  const none = seaBoard({ sea: "play", faceDown: true, icons: { rage: 5 } });
  refused(() => flipUpRaw(none.engine, P1, none.id("sea")), "no [G]", /threshold/i);
  assert.equal(cardOf(none.engine, none.id("sea")).faceDown, true);
  const one = seaBoard({ sea: "play", faceDown: true, icons: { greed: 1, rage: 3 } });
  flipUpRaw(one.engine, P1, one.id("sea"));
  resolvePendingResponses(one.engine);
  drain(one.engine, declineAll);
  assert.equal(cardOf(one.engine, one.id("sea")).faceDown, false);
});

clause(SEAFARER, "2:flipUp", "FLIP UP of a character does not change when it may be deployed (CR 507.4d): refused on my opponent's turn", () => {
  const g = seaBoard({
    sea: "play",
    faceDown: true,
    icons: { greed: 4 },
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1, "I may respond");
  refused(() => flipUpRaw(g.engine, P1, g.id("sea")), "a character cannot be deployed on my opponent's turn");
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, true);
});

clause(SEAFARER, "2:flipUp", "FLIP UP works on my own turn", () => {
  const g = seaBoard({ sea: "play", faceDown: true, icons: { greed: 4 } });
  flipUpRaw(g.engine, P1, g.id("sea"));
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("sea")).faceDown, false);
});

clause(SEAFARER, "2:flipUp", "a Seafarer cannot be flipped up from my hand or by my opponent", () => {
  const inHand = seaBoard({ sea: "hand", icons: { greed: 4 } });
  refused(() => flipUpRaw(inHand.engine, P1, inHand.id("sea")), "in the hand");
  const theirs = seaBoard({ sea: "play", faceDown: true, owner: P2, icons: { greed: 4 }, turn: 2, active: P2, extra: res({ greed: 4 }, P2) });
  refused(() => flipUpRaw(theirs.engine, P1, theirs.id("sea")), "their face-down card");
  assert.equal(cardOf(theirs.engine, theirs.id("sea")).faceDown, true);
});

// =================================================================================
// Dowsing Cleric
// When this card enters or leaves play, you may search your deck for a staple resource,
// reveal it, and put it into your hand.
// Character (banker; priest, mau), cost 4, [G], 1 / 3 / 2.
// =================================================================================

const CLERIC = "599db9fe-dcc4-4812-b91d-9957d2ce504d";

/**
 * A deck for `owner`, top to bottom: c0, g0 (staple Greed), odd (NON-staple resource), r0 (staple Rage),
 * it (item), g1 (staple Greed), c1. Keys get `prefix`.
 */
function stapleDeck(owner: PlayerId, prefix = ""): CardPlacement[] {
  return [
    { key: `${prefix}c0`, def: character({ name: `${prefix}C0` }), owner, zone: "deck" },
    { key: `${prefix}g0`, def: stapleCard("Greed", "greed"), owner, zone: "deck" },
    { key: `${prefix}odd`, def: oddResource(), owner, zone: "deck" },
    { key: `${prefix}r0`, def: stapleCard("Rage", "rage"), owner, zone: "deck" },
    { key: `${prefix}it`, def: item({ name: `${prefix}Item` }), owner, zone: "deck" },
    { key: `${prefix}g1`, def: stapleCard("Greed", "greed"), owner, zone: "deck" },
    { key: `${prefix}c1`, def: character({ name: `${prefix}C1` }), owner, zone: "deck" }
  ];
}

/** Staple-looking cards in the wrong places for "your deck": hand, discard pile, play, and the opponent's deck. */
const clericDecoys = (): CardPlacement[] => [
  { key: "hres", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" },
  { key: "dres", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" },
  ...stapleDeck(P2, "o")
];

function clericBoard(
  opts: {
    cleric?: Zone;
    faceDown?: boolean;
    owner?: PlayerId;
    controller?: PlayerId;
    deck?: CardPlacement[] | "none";
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    icons?: Icons;
  } = {}
) {
  const deck = opts.deck === "none" ? chars("n", 3, P1, "deck") : opts.deck ?? stapleDeck(P1);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cl", def: printing(CLERIC), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.cleric ?? "hand", faceDown: opts.faceDown },
      ...deck,
      ...clericDecoys(),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

type ClericBoard = ReturnType<typeof clericBoard>;
const clericDeploy = (g: ClericBoard) => play(g.engine, P1, g.id("cl"));
/** Answers the open search prompt (asserting it is `player`'s) with `keys`. */
function clericPick(g: ClericBoard, keys: string[], player: PlayerId = P1): void {
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, player, "the controller searches");
  answerPending(g.engine, "chooserSelectsTarget", { selected: keys.map((k) => g.id(k)) });
}
const clericKill = (g: ClericBoard, player: PlayerId = P1) => play(g.engine, player, g.id("kill"), { selected: { t: [g.id("cl")] } });
const killer = (): CardPlacement => ({ key: "kill", def: killTactic(), owner: P1, zone: "hand" });
const clericDeck = (g: ClericBoard, player: PlayerId = P1) => deckOf(g.engine, player);

clause(CLERIC, "0:rule", "on entering play I may search my deck: the staple resource I pick goes to my hand", () => {
  const g = clericBoard();
  clericDeploy(g);
  clericPick(g, ["g0"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("g0")), "handOf(g.engine, P1).includes(g.id(\"g0\"))");
  assert.equal(zoneOf(g.engine, g.id("cl")), "play");
});

clause(CLERIC, "0:rule", "the found card is revealed: exactly that card, once", () => {
  const g = clericBoard();
  clericDeploy(g);
  clericPick(g, ["r0"]);
  assert.deepEqual(revealedIds(g.engine), [g.id("r0")]);
  assert.equal(revealEvents(g.engine).length, 1);
});

for (const [icon, name] of [
  ["rage", "Rage"],
  ["greed", "Greed"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as Array<[StapleIcon, string]>) {
  clause(CLERIC, "0:rule", `any staple resource can be found: ${name}`, () => {
    const g = clericBoard({ deck: [...chars("pad", 2, P1, "deck"), { key: "st", def: stapleCard(name, icon), owner: P1, zone: "deck" }] });
    clericDeploy(g);
    clericPick(g, ["st"]);
    assert.equal(zoneOf(g.engine, g.id("st")), "hand");
  });
}

clause(CLERIC, "0:rule", "only the chosen card moves: the rest of the deck stays (the same cards, shuffled)", () => {
  const g = clericBoard();
  const before = clericDeck(g);
  clericDeploy(g);
  clericPick(g, ["g0"]);
  const expected = before.filter((c) => c !== g.id("g0"));
  assert.deepEqual([...clericDeck(g)].sort(), [...expected].sort(), "the same remaining cards");
  assert.equal(handOf(g.engine, P1).filter((c) => c !== g.id("g0")).includes(g.id("g1")), false, "the other Greed stays in the deck");
});

clause(CLERIC, "0:rule", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const g = clericBoard();
  const unshuffled = clericDeck(g).filter((c) => c !== g.id("g0"));
  clericDeploy(g);
  clericPick(g, ["g0"]);
  assert.deepEqual(clericDeck(g), shuffledWithConstant(unshuffled, 0), "the remaining cards were shuffled");
});

clause(CLERIC, "0:rule", "a NON-staple resource cannot be found: 'a staple resource'", () => {
  const g = clericBoard();
  clericDeploy(g);
  refused(() => clericPick(g, ["odd"]), "a resource that is not a staple");
  const ok = clericBoard();
  clericDeploy(ok);
  clericPick(ok, ["g0"]);
  assert.equal(zoneOf(ok.engine, ok.id("g0")), "hand", "control: a staple works on the same board");
});

clause(CLERIC, "0:rule", "a non-resource card cannot be found: a character or an item in the deck is refused", () => {
  for (const key of ["c0", "it", "c1"]) {
    const g = clericBoard();
    clericDeploy(g);
    refused(() => clericPick(g, [key]), `${key} is not a resource`);
  }
});

clause(CLERIC, "0:rule", "staples in the wrong place cannot be found: my hand, my discard pile and my opponent's deck", () => {
  for (const key of ["hres", "dres", "og0", "or0"]) {
    const g = clericBoard();
    clericDeploy(g);
    refused(() => clericPick(g, [key]), `${key} is not in my deck`);
  }
});

clause(CLERIC, "0:rule", "I find at most one card: picking both Greeds is refused", () => {
  const g = clericBoard();
  clericDeploy(g);
  refused(() => clericPick(g, ["g0", "g1"]), "two cards for 'a staple resource'");
  const ok = clericBoard();
  clericDeploy(ok);
  clericPick(ok, ["g1"]);
  assert.equal(zoneOf(ok.engine, ok.id("g1")), "hand");
  assert.equal(zoneOf(ok.engine, ok.id("g0")), "deck");
});

clause(CLERIC, "0:rule", "'you MAY search': declining takes nothing, reveals nothing, and the deck is left alone", () => {
  const g = clericBoard();
  const before = clericDeck(g);
  const handBefore = handOf(g.engine, P1).length;
  clericDeploy(g);
  clericPick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1, "only the Cleric left the hand");
  assert.equal(revealEvents(g.engine).length, 0, "nothing was revealed");
  assert.deepEqual(clericDeck(g), before, "a deck that was not searched is not shuffled");
});

clause(CLERIC, "0:rule", "with no staple resource in my deck it resolves cleanly: nothing is taken, no prompt is stuck", () => {
  const g = clericBoard({ deck: "none" });
  const handBefore = handOf(g.engine, P1).length;
  clericDeploy(g);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("cl")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1);
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(CLERIC, "0:rule", "a deck with no staple is still searched, so it is shuffled afterwards (CR 312.1)", () => {
  const g = clericBoard({ deck: "none" });
  const before = clericDeck(g);
  clericDeploy(g);
  drain(g.engine, declineAll);
  assert.deepEqual([...clericDeck(g)].sort(), [...before].sort());
  assert.deepEqual(clericDeck(g), shuffledWithConstant(before, 0));
});

clause(CLERIC, "0:rule", "the search is of MY deck: my opponent's deck, hand and discard pile are untouched", () => {
  const g = clericBoard();
  const oppDeck = clericDeck(g, P2);
  clericDeploy(g);
  clericPick(g, ["g0"]);
  assert.deepEqual(clericDeck(g, P2), oppDeck, "their deck is not searched or shuffled");
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(CLERIC, "0:rule", "it does not trigger for OTHER cards entering play", () => {
  const g = clericBoard({ cleric: "play", extra: [{ key: "newcomer", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newcomer"));
  assert.equal(zoneOf(g.engine, g.id("newcomer")), "play", "control: another character entered");
  assert.equal(g.engine.state.pendingChoice, undefined, "no search is offered");
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(CLERIC, "0:rule", "it triggers when put into play by an effect too (not only when deployed)", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = clericBoard({ cleric: "discard", extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("cl")] } });
  assert.equal(zoneOf(g.engine, g.id("cl")), "play", "control: it was put into play");
  clericPick(g, ["g0"]);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
});

clause(CLERIC, "0:rule", "played face-down as a resource it has no rules text: no search is offered (CR 411.1)", () => {
  const g = clericBoard();
  developResource(g.engine, P1, g.id("cl"), true);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("cl")).faceDown, true, "control: it entered face-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(CLERIC, "0:rule", "my opponent's Cleric searches THEIR deck, not mine", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cl", def: printing(CLERIC), owner: P2, zone: "hand" },
      ...stapleDeck(P1, "mine"),
      ...stapleDeck(P2, "their"),
      ...res({ greed: 6 }, P2)
    ]
  });
  play(g.engine, P2, g.id("cl"));
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Cleric's controller searches");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirg0")] });
  assert.equal(zoneOf(g.engine, g.id("theirg0")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("theirg0")), "handOf(g.engine, P2).includes(g.id(\"theirg0\"))");
  assert.equal(zoneOf(g.engine, g.id("mineg0")), "deck", "my deck is untouched");
});

// --- leaves play ---

clause(CLERIC, "0:rule", "on leaving play (destroyed) I may search my deck: the staple I pick goes to my hand", () => {
  const g = clericBoard({ cleric: "play", extra: [killer()] });
  clericKill(g);
  assert.equal(zoneOf(g.engine, g.id("cl")), "discard", "control: it was destroyed");
  clericPick(g, ["g0"]);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
  assert.deepEqual(revealedIds(g.engine), [g.id("g0")], "revealed");
});

clause(CLERIC, "0:rule", "on leaving play (returned to its owner's hand) the search is offered too", () => {
  const g = clericBoard({ cleric: "play", extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("cl")] } });
  assert.equal(zoneOf(g.engine, g.id("cl")), "hand", "control: it was bounced");
  clericPick(g, ["r0"]);
  assert.equal(zoneOf(g.engine, g.id("r0")), "hand");
});

clause(CLERIC, "0:rule", "on leaving play (removed from the game) the search is offered too", () => {
  const g = clericBoard({ cleric: "play", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("cl")] } });
  assert.equal(zoneOf(g.engine, g.id("cl")), "removed", "control: it was removed");
  clericPick(g, ["g0"]);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
});

clause(CLERIC, "0:rule", "on leaving play (flipped face-down) the search is offered too: a face-up card left play (FAQ)", () => {
  const g = clericBoard({ cleric: "play", extra: [{ key: "fd", def: flipDownTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fd"), { selected: { t: [g.id("cl")] } });
  assert.equal(cardOf(g.engine, g.id("cl")).faceDown, true, "control: it was flipped face-down");
  clericPick(g, ["g0"]);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
});

clause(CLERIC, "0:rule", "leaving play: I may decline, and then nothing is taken or shuffled", () => {
  const g = clericBoard({ cleric: "play", extra: [killer()] });
  const before = clericDeck(g);
  clericKill(g);
  clericPick(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).includes(g.id("g0")), false);
  assert.equal(revealEvents(g.engine).length, 0);
  assert.deepEqual(clericDeck(g), before, "an unsearched deck is not shuffled");
});

clause(CLERIC, "0:rule", "leaving play: the searched deck is shuffled afterwards (CR 312.1)", () => {
  const g = clericBoard({ cleric: "play", extra: [killer()] });
  const unshuffled = clericDeck(g).filter((c) => c !== g.id("g0"));
  clericKill(g);
  clericPick(g, ["g0"]);
  assert.deepEqual(clericDeck(g), shuffledWithConstant(unshuffled, 0));
});

clause(CLERIC, "0:rule", "leaving play: only a staple resource in my deck can be found", () => {
  for (const key of ["odd", "c0", "og0", "hres", "dres"]) {
    const g = clericBoard({ cleric: "play", extra: [killer()] });
    clericKill(g);
    refused(() => clericPick(g, [key]), `${key} cannot be found`);
  }
  const ok = clericBoard({ cleric: "play", extra: [killer()] });
  clericKill(ok);
  clericPick(ok, ["g1"]);
  assert.equal(zoneOf(ok.engine, ok.id("g1")), "hand", "control: a staple in my deck works");
});

clause(CLERIC, "0:rule", "leaving play with no staple in my deck: it resolves cleanly with nothing to take", () => {
  const g = clericBoard({ cleric: "play", deck: "none", extra: [killer()] });
  clericKill(g);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("cl")), "discard");
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(CLERIC, "0:rule", "another card leaving play does not trigger a search", () => {
  const g = clericBoard({ cleric: "play", extra: [killer()] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "control: another character left play");
  assert.equal(g.engine.state.pendingChoice, undefined, "no search is offered");
  assert.equal(zoneOf(g.engine, g.id("cl")), "play");
});

clause(CLERIC, "0:rule", "a face-down Cleric that leaves play has no rules text, so no search happens (CR 411.1)", () => {
  const g = clericBoard({ cleric: "play", faceDown: true, extra: [{ key: "kany", def: killAnyTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kany"), { selected: { t: [g.id("cl")] } });
  assert.equal(zoneOf(g.engine, g.id("cl")), "discard", "control: the face-down Cleric was destroyed");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(CLERIC, "0:rule", "entering AND leaving are separate triggers: deployed then destroyed, I can find a staple each time", () => {
  const g = clericBoard({ extra: [killer()] });
  clericDeploy(g);
  clericPick(g, ["g0"]);
  clericKill(g);
  clericPick(g, ["g1"]);
  assert.equal(zoneOf(g.engine, g.id("g0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("g1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("cl")), "discard");
});

clause(CLERIC, "0:rule", "'your deck' is its controller's: a Cleric I stole, destroyed, lets ME search MY deck", () => {
  const g = clericBoard({ cleric: "play", owner: P2, controller: P1, extra: [killer()] });
  clericKill(g);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I control it, so I search");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("g0")] });
  assert.ok(handOf(g.engine, P1).includes(g.id("g0")), "handOf(g.engine, P1).includes(g.id(\"g0\"))");
  assert.equal(zoneOf(g.engine, g.id("cl")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("cl")), "the Cleric goes to its owner's discard pile");
});

// =================================================================================
// Dwarvish Grimalkin
// [G][G]: When this card enters play, draw a card.
// [G][G][G][G][G]: When this card enters play, draw a card.
// [G][G][G][G][G][G][G][G][G]: When this card enters play, draw a card.
// FLIP UP: 2 [G]
// Character (banker; mau), cost 1, [G], 1 / 3 / 1.
// =================================================================================

const GRIMALKIN = "d39ed5bb-20a7-403c-99c5-1612f53abb4e";

function grimBoard(
  opts: {
    grim?: Zone;
    faceDown?: boolean;
    icons?: Icons;
    deck?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "grim", def: printing(GRIMALKIN), owner: P1, zone: opts.grim ?? "hand", faceDown: opts.faceDown },
      ...chars("d", opts.deck ?? 12, P1, "deck"),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 2 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type GrimBoard = ReturnType<typeof grimBoard>;
const grimDeploy = (g: GrimBoard) => {
  play(g.engine, P1, g.id("grim"));
  drain(g.engine, declineAll);
};
/** How many cards my hand gained, not counting the Grimalkin itself leaving it. */
const handGain = (g: GrimBoard, before: number): number => handOf(g.engine, P1).length - (before - 1);
/** Draws of a Grimalkin deployed with `icons`: the number of cards that entered my hand. */
function grimDraws(icons: Icons, opts: { deck?: number; extra?: CardPlacement[] } = {}): number {
  const g = grimBoard({ icons, ...opts });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("grim")), "play", "control: it was deployed");
  return handGain(g, before);
}

/** A character that adds 1 to every card drawn (Beatrix Winterbottom's shape): each draw INSTANCE draws one extra. */
const extraDrawer = (): CardDefinition =>
  character({ name: "Bookkeeper", behavior: { abilities: [{ id: "extra", type: "continuous", modifiers: [], drawModifiers: [{ player: "self", delta: 1 }] }] } });

// --- [G][G] ---

clause(GRIMALKIN, "0:rule@gg", "with only [G] (below [G][G]) it draws nothing", () => {
  assert.equal(grimDraws({ greed: 1 }), 0);
});

clause(GRIMALKIN, "0:rule@gg", "with [G][G] it draws exactly one card when it enters play", () => {
  assert.equal(grimDraws({ greed: 2 }), 1);
});

clause(GRIMALKIN, "0:rule@gg", "with [G][G][G][G] (still below [G]x5) it still draws exactly one card", () => {
  assert.equal(grimDraws({ greed: 4 }), 1);
});

clause(GRIMALKIN, "0:rule@gg", "the card drawn is the top card of my deck", () => {
  const g = grimBoard({ icons: { greed: 2 } });
  grimDeploy(g);
  assert.ok(handOf(g.engine, P1).includes(g.id("d0")), "d0 (the top card) was drawn");
  assert.equal(zoneOf(g.engine, g.id("d1")), "deck");
});

clause(GRIMALKIN, "0:rule@gg", "[G][G] needs Greed icons: two Rage do not count", () => {
  assert.equal(grimDraws({ greed: 1, rage: 6 }), 0, "one Greed and many Rage");
  assert.equal(grimDraws({ greed: 2, rage: 6 }), 1, "control: two Greed");
});

clause(GRIMALKIN, "0:rule@gg", "[G][G] is counted on all my Greed, including Greed already spent on the faction", () => {
  const spent: CardPlacement[] = bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = grimBoard({ icons: { rage: 1 }, extra: spent });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(handGain(g, before), 1, "two spent Greed still meet [G][G]");
});

clause(GRIMALKIN, "0:rule@gg", "face-down cards provide Volition, not Greed: [G] plus face-down resources is not [G][G]", () => {
  const g = grimBoard({ icons: { greed: 1 }, extra: volition(6, P1) });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(handGain(g, before), 0);
});

clause(GRIMALKIN, "0:rule@gg", "it fires only when the Grimalkin itself enters play: another character entering with [G][G] drew nothing", () => {
  const g = grimBoard({ grim: "play", icons: { greed: 2 }, extra: [{ key: "newcomer", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }] });
  const before = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("newcomer"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newcomer")), "play", "control: the other character entered");
  assert.equal(handOf(g.engine, P1).length, before - 1, "nothing was drawn");
});

clause(GRIMALKIN, "0:rule@gg", "it does not draw when the Grimalkin leaves play, and does not draw later when [G][G] is reached while it sits in play", () => {
  const g = grimBoard({ grim: "play", icons: { greed: 1 }, extra: [killer(), { key: "g2", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" }] });
  const before = handOf(g.engine, P1).length;
  developResource(g.engine, P1, g.id("g2"), false);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(g.engine.getThresholds(P1).greed, 2, "control: [G][G] is now met");
  assert.equal(handOf(g.engine, P1).length, before - 1, "the resource left the hand; nothing was drawn");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("grim")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("grim")), "discard");
  assert.equal(handOf(g.engine, P1).length, before - 2, "leaving play draws nothing either");
});

clause(GRIMALKIN, "0:rule@gg", "played face-down as a resource it has no rules text: it draws nothing (CR 411.1)", () => {
  const g = grimBoard({ icons: { greed: 9 } });
  const before = handOf(g.engine, P1).length;
  developResource(g.engine, P1, g.id("grim"), true);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("grim")).faceDown, true);
  assert.equal(handOf(g.engine, P1).length, before - 1);
});

clause(GRIMALKIN, "0:rule@gg", "when it enters play by another card's effect the draws happen as well", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = grimBoard({ grim: "discard", icons: { greed: 2 }, extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  const before = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("grim")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("grim")), "play", "control: it was put into play");
  assert.equal(handOf(g.engine, P1).length, before - 1 + 1, "the Raise left the hand and one card was drawn");
});

clause(GRIMALKIN, "0:rule@gg", "with an empty deck the draw does nothing and nothing breaks (CR 102.1a)", () => {
  const g = grimBoard({ icons: { greed: 2 }, deck: 0 });
  grimDeploy(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("grim")), "play");
  assert.equal(g.engine.state.winner, undefined, "running out of cards does not lose the game");
});

// --- [G]x5 ---

clause(GRIMALKIN, "1:rule@ggggg", "with [G]x4 (below five) the second paragraph does not draw: still just one card", () => {
  assert.equal(grimDraws({ greed: 4 }), 1);
});

clause(GRIMALKIN, "1:rule@ggggg", "with [G]x5 it draws a second card: two cards in all", () => {
  assert.equal(grimDraws({ greed: 5 }), 2);
});

clause(GRIMALKIN, "1:rule@ggggg", "with [G]x8 (below nine) it still draws just two cards", () => {
  assert.equal(grimDraws({ greed: 8 }), 2);
});

clause(GRIMALKIN, "1:rule@ggggg", "five icons must all be Greed: [G]x4 plus Rage does not reach [G]x5", () => {
  assert.equal(grimDraws({ greed: 4, rage: 4 }), 1);
  assert.equal(grimDraws({ greed: 5, rage: 4 }), 2, "control");
});

clause(GRIMALKIN, "1:rule@ggggg", "the second paragraph's draw is its own: the two cards drawn are the top two of the deck, in order", () => {
  const g = grimBoard({ icons: { greed: 5 } });
  grimDeploy(g);
  assert.ok(handOf(g.engine, P1).includes(g.id("d0")), "handOf(g.engine, P1).includes(g.id(\"d0\"))");
  assert.ok(handOf(g.engine, P1).includes(g.id("d1")), "handOf(g.engine, P1).includes(g.id(\"d1\"))");
  assert.equal(zoneOf(g.engine, g.id("d2")), "deck");
});

clause(GRIMALKIN, "1:rule@ggggg", "each paragraph is a separate draw instance (FAQ): with an extra-card effect that adds 1 per draw, [G]x5 draws 4 cards, not 3", () => {
  const g = grimBoard({ icons: { greed: 5 }, extra: [{ key: "bk", def: extraDrawer(), owner: P1, zone: "play" }] });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(handGain(g, before), 4, "two instances of drawing 1, each increased to 2");
});

clause(GRIMALKIN, "1:rule@ggggg", "with only the first paragraph on, an extra-card effect gives 2 cards (one instance)", () => {
  const g = grimBoard({ icons: { greed: 2 }, extra: [{ key: "bk", def: extraDrawer(), owner: P1, zone: "play" }] });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(handGain(g, before), 2);
});

clause(GRIMALKIN, "1:rule@ggggg", "with five Greed and fewer than two cards in the deck it draws what it can", () => {
  assert.equal(grimDraws({ greed: 5 }, { deck: 1 }), 1);
  assert.equal(grimDraws({ greed: 5 }, { deck: 0 }), 0);
});

// --- [G]x9 ---

clause(GRIMALKIN, "2:rule@ggggggggg", "with [G]x8 the third paragraph is off: two cards", () => {
  assert.equal(grimDraws({ greed: 8 }), 2);
});

clause(GRIMALKIN, "2:rule@ggggggggg", "with [G]x9 it draws a third card: three cards in all", () => {
  assert.equal(grimDraws({ greed: 9 }), 3);
});

clause(GRIMALKIN, "2:rule@ggggggggg", "with more than nine Greed it still draws just three cards", () => {
  assert.equal(grimDraws({ greed: 12 }), 3);
});

clause(GRIMALKIN, "2:rule@ggggggggg", "nine icons must all be Greed: [G]x8 plus Rage does not reach [G]x9", () => {
  assert.equal(grimDraws({ greed: 8, rage: 3 }), 2);
  assert.equal(grimDraws({ greed: 9, rage: 3 }), 3, "control");
});

clause(GRIMALKIN, "2:rule@ggggggggg", "three separate draws (FAQ): with a +1 per draw effect and 9 Greed it draws 6 cards, not 4", () => {
  const g = grimBoard({ icons: { greed: 9 }, extra: [{ key: "bk", def: extraDrawer(), owner: P1, zone: "play" }] });
  const before = handOf(g.engine, P1).length;
  grimDeploy(g);
  assert.equal(handGain(g, before), 6);
});

clause(GRIMALKIN, "2:rule@ggggggggg", "the three cards drawn are the top three of the deck", () => {
  const g = grimBoard({ icons: { greed: 9 } });
  grimDeploy(g);
  for (const k of ["d0", "d1", "d2"]) assert.equal(zoneOf(g.engine, g.id(k)), "hand", `${k} drawn`);
  assert.equal(zoneOf(g.engine, g.id("d3")), "deck");
});

clause(GRIMALKIN, "2:rule@ggggggggg", "the Grimalkin is on the table before it draws and the draws do not run it out of play: it stays in play", () => {
  const g = grimBoard({ icons: { greed: 9 } });
  grimDeploy(g);
  assert.equal(zoneOf(g.engine, g.id("grim")), "play");
  assert.equal(cardOf(g.engine, g.id("grim")).faceDown, false);
});

// --- FLIP UP ---

clause(GRIMALKIN, "3:flipUp", "FLIP UP puts the Grimalkin into play face-up, where it enters play and draws (here [G]x5: two cards)", () => {
  const g = grimBoard({ grim: "play", faceDown: true, icons: { greed: 5 } });
  const before = handOf(g.engine, P1).length;
  flipUpRaw(g.engine, P1, g.id("grim"));
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  const card = cardOf(g.engine, g.id("grim"));
  assert.equal(card.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("grim")), ["character"]);
  assert.equal(handOf(g.engine, P1).length, before + 2, "the enters-play draws happened for the flipped-up card");
});

clause(GRIMALKIN, "3:flipUp", "FLIP UP with only one Greed: it enters play but draws nothing", () => {
  const g = grimBoard({ grim: "play", faceDown: true, icons: { greed: 1, rage: 2 } });
  const before = handOf(g.engine, P1).length;
  flipUpRaw(g.engine, P1, g.id("grim"));
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("grim")).faceDown, false);
  assert.equal(handOf(g.engine, P1).length, before);
});

clause(GRIMALKIN, "3:flipUp", "FLIP UP costs exactly 2 (not its printed 1): refused with 1 free resource, accepted with 2", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = grimBoard({ grim: "play", faceDown: true, icons: {}, extra: spent(1) });
  assert.equal(ready(short.engine), 1, "control: only the face-down Grimalkin is free");
  refused(() => flipUpRaw(short.engine, P1, short.id("grim")), "1 free resource for FLIP UP 2");
  assert.equal(cardOf(short.engine, short.id("grim")).faceDown, true);
  const exact = grimBoard({ grim: "play", faceDown: true, icons: {}, extra: [...spent(1), ...res({ rage: 1 })] });
  assert.equal(ready(exact.engine), 2);
  flipUpRaw(exact.engine, P1, exact.id("grim"));
  resolvePendingResponses(exact.engine);
  assert.equal(cardOf(exact.engine, exact.id("grim")).faceDown, false);
  assert.equal(ready(exact.engine), 0);
});

clause(GRIMALKIN, "3:flipUp", "FLIP UP needs [G]: refused with plenty of resources but no Greed", () => {
  const none = grimBoard({ grim: "play", faceDown: true, icons: { rage: 5 } });
  refused(() => flipUpRaw(none.engine, P1, none.id("grim")), "no [G]", /threshold/i);
  assert.equal(cardOf(none.engine, none.id("grim")).faceDown, true);
  const one = grimBoard({ grim: "play", faceDown: true, icons: { greed: 1, rage: 2 } });
  flipUpRaw(one.engine, P1, one.id("grim"));
  resolvePendingResponses(one.engine);
  assert.equal(cardOf(one.engine, one.id("grim")).faceDown, false);
});

clause(GRIMALKIN, "3:flipUp", "FLIP UP of a character is refused on my opponent's turn (CR 507.4d)", () => {
  const g = grimBoard({
    grim: "play",
    faceDown: true,
    icons: { greed: 4 },
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => flipUpRaw(g.engine, P1, g.id("grim")), "a character cannot be deployed on my opponent's turn");
  assert.equal(cardOf(g.engine, g.id("grim")).faceDown, true);
});

clause(GRIMALKIN, "3:flipUp", "a face-down Grimalkin is a blank Volition resource; it cannot be flipped up from the hand or by my opponent", () => {
  const g = grimBoard({ grim: "play", faceDown: true, icons: { greed: 4 } });
  assert.deepEqual(g.engine.getCardTypes(g.id("grim")), ["resource"]);
  const inHand = grimBoard({ grim: "hand", icons: { greed: 4 } });
  refused(() => flipUpRaw(inHand.engine, P1, inHand.id("grim")), "in the hand");
});

// =================================================================================
// Emissary of Loot
// If a card that provides at least [G] enters play under your control, you may put a token on
// this card.
// DELIVER -- COST: Pay 1. Remove a token from this card. Pick a character.
//   EFFECT: This turn, the character gains 2 life.
// SHORTCUT -- COST: Pay 1. Remove a token from this card.
//   EFFECT: This turn, this card gains COVERT.
// Character (banker; mau), cost 5, [G], 3 / 3 / 4.
// =================================================================================

const EMISSARY = "2d1759ee-5b02-4642-a97f-3c44f8d3475b";

function emBoard(
  opts: {
    em?: Zone;
    faceDown?: boolean;
    tokens?: number;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
    controller?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "em", def: printing(EMISSARY), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.em ?? "play", faceDown: opts.faceDown, counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type EmBoard = ReturnType<typeof emBoard>;
const emTokens = (g: EmBoard) => tokensOn(g.engine, g.id("em"));
const emLife = (g: EmBoard, key: string) => g.engine.getStat(g.id(key), "life");
const emDeliverRaw = (g: EmBoard, target: string, player: PlayerId = P1) => actRaw(g.engine, player, g.id("em"), "emissary-deliver", { t: [g.id(target)] });
const emDeliver = (g: EmBoard, target: string) => activate(g.engine, P1, g.id("em"), "emissary-deliver", { selected: { t: [g.id(target)] } });
const emShortcutRaw = (g: EmBoard, player: PlayerId = P1) => actRaw(g.engine, player, g.id("em"), "emissary-shortcut");
const emShortcut = (g: EmBoard) => activate(g.engine, P1, g.id("em"), "emissary-shortcut");
/** A card of mine in hand that I play as a resource (`faceDown` picks the facing), for the gather trigger. */
const resCard = (key: string, def: CardDefinition, owner: PlayerId = P1): CardPlacement => ({ key, def, owner, zone: "hand" });
/** Plays resource `key` with the develop rule and answers the gather prompt (`pay` true = put a token). */
function emDevelop(g: EmBoard, key: string, faceDown: boolean, accept = true, player: PlayerId = P1): void {
  developResource(g.engine, player, g.id(key), faceDown);
  resolvePendingResponses(g.engine);
  drain(g.engine, accept ? acceptPay : refusePay);
}
/** A character carrying the PROVIDES: [icons] clause, deployable for free. */
const provider = (name: string, icons: StapleIcon[]): CardDefinition => character({ name, cost: 0, resource: { provides: icons } });

// --- the token rule ---

clause(EMISSARY, "0:rule", "a Greed resource entering play under my control: I may put a token on the Emissary (accepting puts exactly one)", () => {
  const g = emBoard({ extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  assert.equal(emTokens(g), 0);
  emDevelop(g, "gr", false, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 1);
  assert.equal(zoneOf(g.engine, g.id("gr")), "play", "control: the resource entered play");
});

clause(EMISSARY, "0:rule", "'you MAY': declining puts no token", () => {
  const g = emBoard({ extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  emDevelop(g, "gr", false, false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 0);
  assert.equal(zoneOf(g.engine, g.id("gr")), "play");
});

clause(EMISSARY, "0:rule", "the choice is offered to me (the Emissary's controller) and costs nothing", () => {
  const g = emBoard({ extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  const before = ready(g.engine);
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(emTokens(g), 1);
  assert.equal(ready(g.engine), before + 1, "no resource was paid; the new Greed itself is one more free resource");
});

clause(EMISSARY, "0:rule", "a card entering play is worth ONE token, not two (one choice for one card)", () => {
  const g = emBoard({ extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.pendingChoice, undefined, "no second prompt for the same card");
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "each qualifying card gives its own chance: two Greed resources entering give two tokens", () => {
  const g = emBoard({ extra: [resCard("gr1", stapleCard("Greed", "greed")), resCard("gr2", stapleCard("Greed", "greed"))] });
  emDevelop(g, "gr1", false, true);
  assert.equal(emTokens(g), 1);
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g2 = emBoard({ extra: [resCard("gr1", stapleCard("Greed", "greed")), resCard("gr2", stapleCard("Greed", "greed")), resCard("raise", raise)] });
  emDevelop(g2, "gr1", false, true);
  play(g2.engine, P1, g2.id("raise"), { selected: { t: [g2.id("gr2")] } });
  drain(g2.engine, acceptPay);
  assert.equal(zoneOf(g2.engine, g2.id("gr2")), "play", "control: the second resource was put into play");
  assert.equal(emTokens(g2), 2, "two Greed resources, two tokens");
});

for (const [icon, name] of [
  ["rage", "Rage"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as Array<[StapleIcon, string]>) {
  clause(EMISSARY, "0:rule", `a ${name} resource does not provide [G]: no token is offered`, () => {
    const g = emBoard({ extra: [resCard("r", stapleCard(name, icon))] });
    developResource(g.engine, P1, g.id("r"), false);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("r")), "play", "control: it entered play");
    assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
    assert.equal(emTokens(g), 0);
  });
}

clause(EMISSARY, "0:rule", "a Greed card played FACE-DOWN provides only Volition: no token", () => {
  const g = emBoard({ extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  developResource(g.engine, P1, g.id("gr"), true);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, true, "control: it entered face-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "any card that provides at least [G] counts, not only resources: a character with PROVIDES [G] entering play", () => {
  const g = emBoard({ extra: [resCard("pg", provider("Greedy Clerk", ["greed"]))] });
  play(g.engine, P1, g.id("pg"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("pg")), "play", "control: it entered play");
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "a character that provides only [R] does not count", () => {
  const g = emBoard({ extra: [resCard("pr", provider("Angry Clerk", ["rage"]))] });
  play(g.engine, P1, g.id("pr"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("pr")), "play");
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "'at least [G]': a card providing [G][G] counts", () => {
  const g = emBoard({ extra: [resCard("two", resourceCard({ name: "Double Greed", resource: { provides: ["greed", "greed"], staple: false } }))] });
  emDevelop(g, "two", false, true);
  assert.equal(emTokens(g), 1, "one token for one card, however many [G] it provides");
});

clause(EMISSARY, "0:rule", "'at least [G]': a card providing [G] and another icon counts", () => {
  const g = emBoard({ extra: [resCard("mix", provider("Mixed Clerk", ["rage", "greed"]))] });
  play(g.engine, P1, g.id("mix"));
  drain(g.engine, acceptPay);
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "a non-staple resource providing [G] counts as well", () => {
  const g = emBoard({ extra: [resCard("odd", oddResource("Odd Coin"))] });
  emDevelop(g, "odd", false, true);
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "a Greed resource put into play by an effect (not 'played') also enters play: a token is offered", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = emBoard({
    extra: [{ key: "gr", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" }, resCard("raise", raise)]
  });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("gr")] } });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("gr")), "play", "control: it entered play");
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "only cards entering under MY control count: my opponent's Greed resource gives me no token", () => {
  const g = emBoard({ turn: 2, active: P2, extra: [resCard("ogr", stapleCard("Greed", "greed"), P2)] });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play", "control: it entered play under their control");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "only cards entering under MY control count: a Greed resource my opponent puts into play with an effect gives me no token", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = emBoard({ turn: 2, active: P2, extra: [{ key: "ogr", def: stapleCard("Greed", "greed"), owner: P2, zone: "discard" }, resCard("raise", raise, P2)] });
  play(g.engine, P2, g.id("raise"), { selected: { t: [g.id("ogr")] } });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play", "control: it entered play under their control");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "only cards entering under MY control count: a character with PROVIDES [G] that my opponent deploys gives me no token", () => {
  const g = emBoard({ turn: 2, active: P2, extra: [resCard("opg", provider("Their Greedy Clerk", ["greed"]), P2)] });
  play(g.engine, P2, g.id("opg"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("opg")), "play", "control: it entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "'under your control': their Greed resource that enters play under MY control counts", () => {
  const steal = tactic({
    name: "Reanimate Theirs",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "reanimate",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "opponent" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = emBoard({ extra: [{ key: "ogr", def: stapleCard("Greed", "greed"), owner: P2, zone: "discard" }, resCard("steal", steal)] });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ogr")] } });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play", "control: it entered play");
  assert.equal(cardOf(g.engine, g.id("ogr")).controllerId, P1, "under my control");
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "0:rule", "the Emissary does not count itself: entering play it gets no token", () => {
  const g = emBoard({ em: "hand", icons: { greed: 6 } });
  play(g.engine, P1, g.id("em"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("em")), "play", "control: it entered play");
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "a face-down Emissary has no rules text: a Greed resource entering play gives it no token", () => {
  const g = emBoard({ faceDown: true, extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(emTokens(g), 0);
});

clause(EMISSARY, "0:rule", "tokens are not a limit: with three tokens already, another Greed resource still gives a fourth", () => {
  const g = emBoard({ tokens: 3, extra: [resCard("gr", stapleCard("Greed", "greed"))] });
  emDevelop(g, "gr", false, true);
  assert.equal(emTokens(g), 4);
});

clause(EMISSARY, "0:rule", "two Emissaries each get their own token from one Greed resource", () => {
  const g = emBoard({ extra: [{ key: "em2", def: printing(EMISSARY), owner: P1, zone: "play" }, resCard("gr", stapleCard("Greed", "greed"))] });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : acceptPay(pc)));
  assert.equal(tokensOn(g.engine, g.id("em")), 1);
  assert.equal(tokensOn(g.engine, g.id("em2")), 1);
});

clause(EMISSARY, "0:rule", "tokens disappear when the Emissary leaves play (CR 409.2): a returned and replayed Emissary has none", () => {
  const g = emBoard({ tokens: 2, icons: { greed: 8 }, extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("em")] } });
  assert.equal(zoneOf(g.engine, g.id("em")), "hand", "control: it went back to my hand");
  play(g.engine, P1, g.id("em"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("em")), "play");
  assert.equal(emTokens(g), 0, "a new Emissary has no tokens");
});

// --- DELIVER ---

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER: the picked character gains 2 life this turn (mine: 3 -> 5)", () => {
  const g = emBoard({ tokens: 1 });
  emDeliver(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(emLife(g, "mine"), 5);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER: any character can be picked: my opponent's gains 2 life too, mine are untouched", () => {
  const g = emBoard({ tokens: 1 });
  emDeliver(g, "foe");
  assert.equal(emLife(g, "foe"), 6);
  assert.equal(emLife(g, "mine"), 3);
  assert.equal(emLife(g, "em"), 4);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER: the Emissary itself is a character and can be picked", () => {
  const g = emBoard({ tokens: 1 });
  emDeliver(g, "em");
  assert.equal(emLife(g, "em"), 6);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER costs exactly 1 resource and exactly 1 token", () => {
  const g = emBoard({ tokens: 2, icons: { greed: 4 } });
  const before = ready(g.engine);
  emDeliver(g, "mine");
  assert.equal(before - ready(g.engine), 1, "Pay 1");
  assert.equal(emTokens(g), 1, "Remove a token from this card: one of the two is gone");
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER's costs are paid on activation, before my opponent can respond", () => {
  const g = emBoard({ tokens: 1, icons: { greed: 4 } });
  const before = ready(g.engine);
  emDeliverRaw(g, "mine");
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 1);
  assert.equal(emTokens(g), 0);
  assert.equal(emLife(g, "mine"), 3, "the life gain waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(emLife(g, "mine"), 5);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER needs a token: with none it is refused and nothing is paid", () => {
  const g = emBoard({ tokens: 0, icons: { greed: 4 } });
  refused(() => emDeliverRaw(g, "mine"), "no token to remove");
  assert.equal(ready(g.engine), 4, "nothing was paid");
  assert.equal(emLife(g, "mine"), 3);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER needs 1 free resource: refused when every resource is spent, even with a token", () => {
  const spent: CardPlacement[] = bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = emBoard({ tokens: 1, icons: {}, extra: spent });
  assert.equal(ready(g.engine), 0);
  refused(() => emDeliverRaw(g, "mine"), "no free resource for Pay 1");
  assert.equal(emTokens(g), 1, "the token was not removed");
  assert.equal(emLife(g, "mine"), 3);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER's life gain ends with the turn", () => {
  const g = emBoard({ tokens: 1 });
  emDeliver(g, "mine");
  assert.equal(emLife(g, "mine"), 5);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(emLife(g, "mine"), 3);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER used twice on one character gives +4 life (two tokens, two resources)", () => {
  const g = emBoard({ tokens: 2, icons: { greed: 4 } });
  emDeliver(g, "mine");
  emDeliver(g, "mine");
  assert.equal(emLife(g, "mine"), 7);
  assert.equal(emTokens(g), 0);
  assert.equal(ready(g.engine), 2);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER's extra life is real: the character survives damage that would have killed it", () => {
  const board = () => emBoard({ tokens: 1, extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  const withDeliver = board();
  emDeliver(withDeliver, "mine");
  play(withDeliver.engine, P1, withDeliver.id("zap"), { selected: { t: [withDeliver.id("mine")] } });
  assert.equal(zoneOf(withDeliver.engine, withDeliver.id("mine")), "play");
  const without = board();
  play(without.engine, P1, without.id("zap"), { selected: { t: [without.id("mine")] } });
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control: 4 damage kills a 3-life character");
});

for (const bad of NOT_CHARACTERS) {
  clause(EMISSARY, "1:ability:emissary-deliver", `DELIVER cannot pick ${bad.why}`, () => {
    const g = emBoard({ tokens: 1, extra: bad.extra });
    refused(() => emDeliverRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(emTokens(g), 1, "nothing was paid");
    assert.equal(ready(g.engine), 3);
    const control = emBoard({ tokens: 1, extra: bad.extra });
    emDeliver(control, "foe");
    assert.equal(emLife(control, "foe"), 6, "control: a character works on the same board");
  });
}

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER cannot pick a faction (CR 202.9), and needs exactly one pick", () => {
  const g = emBoard({ tokens: 1 });
  refused(() => actRaw(g.engine, P1, g.id("em"), "emissary-deliver", { t: [g.engine.state.players[P2].factionId!] }), "their faction");
  const none = emBoard({ tokens: 1 });
  refused(() => actRaw(none.engine, P1, none.id("em"), "emissary-deliver"), "no pick");
  assert.equal(tokensOn(none.engine, none.id("em")), 1);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER is an ability: it can be used in response on my opponent's turn", () => {
  const g = emBoard({
    tokens: 1,
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(3), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  emDeliverRaw(g, "mine");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the extra 2 life saved it from 3 damage");
  assert.equal(emLife(g, "mine"), 5);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER is not available from the hand, and not while the Emissary is face-down", () => {
  const inHand = emBoard({ em: "hand", tokens: 1 });
  refused(() => emDeliverRaw(inHand, "mine"), "in the hand");
  const faceDown = emBoard({ faceDown: true, tokens: 1 });
  refused(() => emDeliverRaw(faceDown, "mine"), "face-down", /face-down card.s abilities cannot be activated/);
});

clause(EMISSARY, "1:ability:emissary-deliver", "DELIVER is the controller's ability: my opponent cannot use it on my Emissary", () => {
  const g = emBoard({ tokens: 1, turn: 2, active: P2, extra: res({ greed: 3 }, P2) });
  refused(() => emDeliverRaw(g, "foe", P2), "not their card");
  assert.equal(emTokens(g), 1);
});

// --- SHORTCUT ---

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT: this turn the Emissary gains COVERT", () => {
  const g = emBoard({ tokens: 1 });
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), false, "control: it is not covert at first");
  emShortcut(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), true);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT: only this card gains COVERT, no other character", () => {
  const g = emBoard({ tokens: 1 });
  emShortcut(g);
  assert.equal(g.engine.getKeywords(g.id("mine")).includes("covert"), false);
  assert.equal(g.engine.getKeywords(g.id("foe")).includes("covert"), false);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT costs exactly 1 resource and exactly 1 token", () => {
  const g = emBoard({ tokens: 2, icons: { greed: 4 } });
  const before = ready(g.engine);
  emShortcut(g);
  assert.equal(before - ready(g.engine), 1, "Pay 1");
  assert.equal(emTokens(g), 1, "Remove a token from this card");
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT's costs are paid on activation, before my opponent can respond", () => {
  const g = emBoard({ tokens: 1, icons: { greed: 4 } });
  const before = ready(g.engine);
  emShortcutRaw(g);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 1);
  assert.equal(emTokens(g), 0);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), false, "the keyword waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), true);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT needs a token: with none it is refused and nothing is paid", () => {
  const g = emBoard({ tokens: 0, icons: { greed: 4 } });
  refused(() => emShortcutRaw(g), "no token to remove");
  assert.equal(ready(g.engine), 4);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), false);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT needs 1 free resource: refused when every resource is spent, even with a token", () => {
  const spent: CardPlacement[] = bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = emBoard({ tokens: 1, icons: {}, extra: spent });
  refused(() => emShortcutRaw(g), "no free resource for Pay 1");
  assert.equal(emTokens(g), 1);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT's COVERT lasts only this turn", () => {
  const g = emBoard({ tokens: 1 });
  emShortcut(g);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), true);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.getKeywords(g.id("em")).includes("covert"), false);
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT gives real COVERT: the Emissary cannot be blocked by a non-covert character, a covert one can block it", () => {
  const board = () =>
    emBoard({
      tokens: 1,
      extra: [
        { key: "plain", def: character({ name: "Plain Blocker" }), owner: P2, zone: "play" },
        { key: "covertB", def: character({ name: "Covert Blocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
      ]
    });
  const withShortcut = board();
  emShortcut(withShortcut);
  declareAttackBy(withShortcut.engine, P1, [withShortcut.id("em")]);
  refused(() => declareBlockers(withShortcut.engine, P2, [withShortcut.id("plain")]), "a non-covert character cannot block a covert party");
  declareBlockers(withShortcut.engine, P2, [withShortcut.id("covertB")]);
  assert.deepEqual(battleOf(withShortcut.engine)?.blockingParty, [withShortcut.id("covertB")], "a covert character may block it");
  const without = board();
  declareAttackBy(without.engine, P1, [without.id("em")]);
  declareBlockers(without.engine, P2, [without.id("plain")]);
  assert.deepEqual(battleOf(without.engine)?.blockingParty, [without.id("plain")], "control: without SHORTCUT a plain character may block");
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT twice: COVERT is held once, both tokens and both resources are paid", () => {
  const g = emBoard({ tokens: 2, icons: { greed: 4 } });
  emShortcut(g);
  emShortcut(g);
  assert.equal(emTokens(g), 0);
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.getKeywords(g.id("em")).filter((k) => k === "covert").length, 1, "COVERT cannot be held twice (CR 507.3e)");
});

clause(EMISSARY, "2:ability:emissary-shortcut", "SHORTCUT is not available from the hand or while the Emissary is face-down, and not to my opponent", () => {
  const inHand = emBoard({ em: "hand", tokens: 1 });
  refused(() => emShortcutRaw(inHand), "in the hand");
  const faceDown = emBoard({ faceDown: true, tokens: 1 });
  refused(() => emShortcutRaw(faceDown), "face-down", /face-down card.s abilities cannot be activated/);
  const theirs = emBoard({ tokens: 1, turn: 2, active: P2, extra: res({ greed: 3 }, P2) });
  refused(() => emShortcutRaw(theirs, P2), "not their card");
});

// =================================================================================
// Framptle Tromwibbler, Lord of Bling
// UNIQUE FRAMPTLE
// Characters cannot attack or be restored.
// At the start of your turn, put a token on this card.
// If this card has at least 2 tokens on it, destroy it.
// Character (banker; mau), cost 4, [G][G], 3 / 3 / 3.
// =================================================================================

const FRAMPTLE = "324900c1-ea19-480a-ab4f-6ac5528757b5";

function framBoard(
  opts: {
    fram?: Zone | "none";
    owner?: PlayerId;
    controller?: PlayerId;
    faceDown?: boolean;
    tokens?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    icons?: Icons;
    depleted?: boolean;
  } = {}
) {
  const fram: CardPlacement[] =
    opts.fram === "none"
      ? []
      : [{ key: "fr", def: printing(FRAMPTLE), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.fram ?? "play", faceDown: opts.faceDown, counters: opts.tokens ? { token: opts.tokens } : undefined }];
  return devBoard(
    [
      ...fram,
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play", depleted: opts.depleted },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "keep", def: location({ name: "Keep" }), owner: P2, zone: "play", depleted: opts.depleted },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type FramBoard = ReturnType<typeof framBoard>;
const frTokens = (g: FramBoard) => tokensOn(g.engine, g.id("fr"));
/** Ends P1's turn and P2's turn, so P1's next turn starts. */
function roundTrip(g: FramBoard): void {
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
}
const attackRaw = (g: FramBoard, player: PlayerId, ids: string[], target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId }) =>
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: ids.map((k) => g.id(k)), target: target ?? { type: "faction", playerId: other(player) } });

// --- UNIQUE FRAMPTLE ---

clause(FRAMPTLE, "0:unique", "deploying a second Framptle while I control one makes me choose one to keep: keeping the new one destroys the old one", () => {
  const g = framBoard({ extra: [{ key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fr2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "I choose");
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fr2") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fr2")), "play");
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
});

clause(FRAMPTLE, "0:unique", "...and I may keep the old one instead: the new one is destroyed", () => {
  const g = framBoard({ extra: [{ key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fr2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fr") });
  assert.equal(zoneOf(g.engine, g.id("fr")), "play");
  assert.equal(zoneOf(g.engine, g.id("fr2")), "discard");
});

clause(FRAMPTLE, "0:unique", "exactly one Framptle remains in play under my control afterwards", () => {
  const g = framBoard({ extra: [{ key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fr2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fr2") });
  const left = playOf(g.engine, P1).filter((id) => g.engine.getDefinition(id).name === printing(FRAMPTLE).name);
  assert.equal(left.length, 1);
});

clause(FRAMPTLE, "0:unique", "the restriction is per player: my opponent may control their own Framptle at the same time", () => {
  const g = framBoard({ turn: 2, active: P2, extra: [{ key: "ofr", def: printing(FRAMPTLE), owner: P2, zone: "hand" }, ...res({ greed: 4 }, P2)] });
  play(g.engine, P2, g.id("ofr"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no survivor choice");
  assert.equal(zoneOf(g.engine, g.id("ofr")), "play");
  assert.equal(zoneOf(g.engine, g.id("fr")), "play");
});

clause(FRAMPTLE, "0:unique", "taking control of my opponent's Framptle while I control one triggers the choice (FAQ), and I keep whichever I choose", () => {
  const g = framBoard({ extra: [{ key: "ofr", def: printing(FRAMPTLE), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ofr")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("ofr") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ofr")), "play");
  assert.equal(cardOf(g.engine, g.id("ofr")).controllerId, P1);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
});

clause(FRAMPTLE, "0:unique", "...and the game goes on: after the choice the survivor's rules still work (it cannot be stuck)", () => {
  const g = framBoard({ extra: [{ key: "ofr", def: printing(FRAMPTLE), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ofr")] } });
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fr") });
  assert.equal(zoneOf(g.engine, g.id("ofr")), "discard", "the stolen copy is destroyed and goes to its owner's discard pile");
  assert.ok(discardOf(g.engine, P2).includes(g.id("ofr")), "discardOf(g.engine, P2).includes(g.id(\"ofr\"))");
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2, "the turn passed normally");
});

clause(FRAMPTLE, "0:unique", "a different UNIQUE designation does not conflict with Framptle", () => {
  const other2 = character({ name: "Someone Else", cost: 0, unique: "someone-else" });
  const g = framBoard({ extra: [{ key: "o", def: other2, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("o"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o")), "play");
  assert.equal(zoneOf(g.engine, g.id("fr")), "play");
});

// --- Characters cannot attack or be restored ---

clause(FRAMPTLE, "1:rule", "my characters cannot attack while Framptle is in play (the same character can attack without it)", () => {
  const g = framBoard();
  refused(() => attackRaw(g, P1, ["mine"]), "a character cannot attack");
  assert.equal(battleOf(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, false, "it did not deplete");
  const without = framBoard({ fram: "none" });
  attackRaw(without, P1, ["mine"]);
  assert.ok(battleOf(without.engine), "control: with no Framptle in play the attack is legal");
});

clause(FRAMPTLE, "1:rule", "my opponent's characters cannot attack either", () => {
  const g = framBoard({ turn: 2, active: P2 });
  refused(() => attackRaw(g, P2, ["foe"]), "an opposing character cannot attack");
  const without = framBoard({ fram: "none", turn: 2, active: P2 });
  attackRaw(without, P2, ["foe"]);
  assert.ok(battleOf(without.engine), "control: without Framptle they can");
});

clause(FRAMPTLE, "1:rule", "'Characters' includes Framptle itself: it cannot attack", () => {
  const g = framBoard();
  refused(() => attackRaw(g, P1, ["fr"]), "Framptle cannot attack");
  const g2 = framBoard();
  refused(() => attackRaw(g2, P1, ["fr", "mine"]), "a party containing any character that cannot attack is refused");
  assert.equal(battleOf(g2.engine), undefined);
});

clause(FRAMPTLE, "1:rule", "it stops attacks on locations too", () => {
  const g = framBoard();
  refused(() => attackRaw(g, P1, ["mine"], { type: "card", cardId: g.id("keep") }), "attacking a location");
  const without = framBoard({ fram: "none" });
  attackRaw(without, P1, ["mine"], { type: "card", cardId: without.id("keep") });
  assert.ok(battleOf(without.engine), "control");
});

clause(FRAMPTLE, "1:rule", "a character entering play after Framptle cannot attack either (it applies to all characters)", () => {
  const g = framBoard({ extra: [{ key: "newcomer", def: character({ name: "Newcomer", cost: 0, behavior: { keywords: ["aggro"] } }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newcomer"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newcomer")), "play");
  refused(() => attackRaw(g, P1, ["newcomer"]), "an AGGRO newcomer could otherwise attack");
});

clause(FRAMPTLE, "1:rule", "'cannot attack' is a restriction on the characters: the engine reports it for my and their characters", () => {
  const g = framBoard();
  for (const key of ["mine", "foe", "fr"]) assert.ok(g.engine.getRestrictions(g.id(key)).includes("cannotAttack"), `${key} cannot attack`);
  const without = framBoard({ fram: "none" });
  assert.equal(without.engine.getRestrictions(without.id("mine")).includes("cannotAttack"), false, "control");
});

clause(FRAMPTLE, "1:rule", "when Framptle leaves play, characters can attack again", () => {
  const g = framBoard();
  refused(() => attackRaw(g, P1, ["mine"]), "blocked by Framptle");
  const g2 = framBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g2.engine, P1, g2.id("kill"), { selected: { t: [g2.id("fr")] } });
  assert.equal(zoneOf(g2.engine, g2.id("fr")), "discard", "control: Framptle was destroyed");
  attackRaw(g2, P1, ["mine"]);
  assert.ok(battleOf(g2.engine), "battleOf(g2.engine)");
});

clause(FRAMPTLE, "1:rule", "a face-down Framptle has no rules text (CR 411.1): characters can attack", () => {
  const g = framBoard({ faceDown: true });
  attackRaw(g, P1, ["mine"]);
  assert.ok(battleOf(g.engine), "battleOf(g.engine)");
});

clause(FRAMPTLE, "1:rule", "my characters are not restored at the start of my turn: a depleted character stays depleted", () => {
  const g = framBoard({ depleted: true, tokens: 0 });
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, true, "control: depleted at first");
  roundTrip(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, true, "not restored at the start of my turn");
});

clause(FRAMPTLE, "1:rule", "my opponent's characters are not restored at the start of their turn either", () => {
  const g = framBoard({ depleted: true });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(cardOf(g.engine, g.id("foe")).depleted, true);
});

clause(FRAMPTLE, "1:rule", "control: without Framptle the restore rule restores a depleted character (so the test above really tests Framptle)", () => {
  const g = framBoard({ fram: "none", depleted: true });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("foe")).depleted, false, "their character is restored at the start of their turn");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, false, "mine too");
});

clause(FRAMPTLE, "1:rule", "only CHARACTERS are held back: depleted items and locations are still restored", () => {
  const g = framBoard({ depleted: true });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("keep")).depleted, false, "their location is restored");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(cardOf(g.engine, g.id("gear")).depleted, false, "my item is restored");
});

clause(FRAMPTLE, "1:rule", "a 'restore' effect cannot restore a character either", () => {
  const restoreTactic = tactic({
    name: "Refresh",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "refresh",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const g = framBoard({ depleted: true, extra: [{ key: "ref1", def: restoreTactic, owner: P1, zone: "hand" }, { key: "ref2", def: restoreTactic, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ref1"), { selected: { t: [g.id("mine")] } });
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, true, "a character stays depleted");
  play(g.engine, P1, g.id("ref2"), { selected: { t: [g.id("gear")] } });
  assert.equal(cardOf(g.engine, g.id("gear")).depleted, false, "control: an item is restored by the same effect");
});

clause(FRAMPTLE, "1:rule", "when Framptle leaves play, characters can be restored again", () => {
  const g = framBoard({ depleted: true, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("fr")] } });
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
  roundTrip(g);
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, false);
});

// --- At the start of your turn, put a token on this card ---

clause(FRAMPTLE, "2:rule", "at the start of my turn a token is put on Framptle", () => {
  const g = framBoard();
  assert.equal(frTokens(g), 0);
  roundTrip(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(frTokens(g), 1);
});

clause(FRAMPTLE, "2:rule", "not at the start of my opponent's turn", () => {
  const g = framBoard();
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(frTokens(g), 0, "their turn started: no token");
});

clause(FRAMPTLE, "2:rule", "exactly one token per turn start", () => {
  const g = framBoard({ tokens: 0 });
  roundTrip(g);
  assert.equal(frTokens(g), 1, "one token, not two");
});

clause(FRAMPTLE, "2:rule", "'your turn' is its controller's: a Framptle I stole gets its token at the start of MY turn, not its owner's", () => {
  const g = framBoard({ owner: P2, controller: P1 });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(frTokens(g), 0, "their (the owner's) turn started: no token");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(frTokens(g), 1, "my turn started: a token");
});

clause(FRAMPTLE, "2:rule", "my opponent's Framptle gets its token at the start of THEIR turn", () => {
  const g = framBoard({ owner: P2 });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(frTokens(g), 1);
});

clause(FRAMPTLE, "2:rule", "a face-down Framptle has no rules text: no token is put on it", () => {
  const g = framBoard({ faceDown: true });
  roundTrip(g);
  assert.equal(frTokens(g), 0);
});

// --- If this card has at least 2 tokens on it, destroy it ---

clause(FRAMPTLE, "3:rule", "with one token it is not destroyed", () => {
  const g = framBoard();
  roundTrip(g);
  assert.equal(frTokens(g), 1);
  assert.equal(zoneOf(g.engine, g.id("fr")), "play");
});

clause(FRAMPTLE, "3:rule", "at the start of my second turn the second token arrives and it is destroyed", () => {
  const g = framBoard();
  roundTrip(g);
  assert.equal(zoneOf(g.engine, g.id("fr")), "play", "control: still there after one token");
  roundTrip(g);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard", "two tokens: destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("fr")), "discardOf(g.engine, P1).includes(g.id(\"fr\"))");
});

clause(FRAMPTLE, "3:rule", "a Framptle that is destroyed stops its effect: my characters can attack again", () => {
  const g = framBoard({ tokens: 1 });
  roundTrip(g);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
  attackRaw(g, P1, ["mine"]);
  assert.ok(battleOf(g.engine), "battleOf(g.engine)");
});

clause(FRAMPTLE, "3:rule", "a Framptle that already has 1 token is destroyed by the very next token", () => {
  const g = framBoard({ tokens: 1 });
  roundTrip(g);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
});

clause(FRAMPTLE, "3:rule", "a token put on it by another effect that makes two destroys it at once: 'if this card has at least 2 tokens on it, destroy it'", () => {
  const g = framBoard({ tokens: 1, extra: [{ key: "tok", def: tokenTactic(1), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("tok"), { selected: { t: [g.id("fr")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard", "1 + 1 = 2 tokens");
});

clause(FRAMPTLE, "3:rule", "two tokens put on it at once destroy it", () => {
  const g = framBoard({ extra: [{ key: "tok", def: tokenTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("tok"), { selected: { t: [g.id("fr")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
});

clause(FRAMPTLE, "3:rule", "one token put on it by another effect does not destroy it", () => {
  const g = framBoard({ extra: [{ key: "tok", def: tokenTactic(1), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("tok"), { selected: { t: [g.id("fr")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fr")), "play");
  assert.equal(frTokens(g), 1);
});

clause(FRAMPTLE, "3:rule", "my opponent's Framptle is destroyed at the start of THEIR second turn, going to their discard pile", () => {
  const g = framBoard({ owner: P2, tokens: 1 });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fr")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("fr")), "discardOf(g.engine, P2).includes(g.id(\"fr\"))");
});

// =================================================================================
// Gilded Yurt
// CHILLAX -- COST: Deplete this card. Pick a character you control.
// EFFECT: Remove the character from the game. At the start of your next turn, if this card is
// in play, put the removed character into play under your control.
// Location (banker), cost 1, [G][G], structure 3.
// =================================================================================

const YURT = "07df2997-8872-48c4-bbd6-3c03d2aaddc1";

function yurtBoard(
  opts: {
    yurt?: Zone;
    depleted?: boolean;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
    controller?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "yurt", def: printing(YURT), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.yurt ?? "play", depleted: opts.depleted },
      { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type YurtBoard = ReturnType<typeof yurtBoard>;
const yurtRaw = (g: YurtBoard, target: string, player: PlayerId = P1, yurt = "yurt") => actRaw(g.engine, player, g.id(yurt), "yurt-chillax", { v: [g.id(target)] });
const yurtUse = (g: YurtBoard, target: string, yurt = "yurt") => activate(g.engine, P1, g.id(yurt), "yurt-chillax", { selected: { v: [g.id(target)] } });
/** The active player ends their turn, then the other does: the next turn of the first player starts. */
function yurtRound(g: YurtBoard): void {
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
}
/** Just the turn change (the other player's turn starts). */
function yurtHalfRound(g: YurtBoard): void {
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
}

/** The card is off the board: not in play and not in a hand, deck or discard pile. */
function offStage(g: YurtBoard, key: string, why = `${key} is gone from the board`): void {
  const zone = zoneOf(g.engine, g.id(key));
  assert.ok(!["play", "hand", "discard", "deck", "deploying"].includes(zone), `${why} (it is in zone '${zone}')`);
}

const YURT_NOT_MINE: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "foe2", why: "my opponent's character", extra: [{ key: "foe2", def: character({ name: "Foe Two" }), owner: P2, zone: "play" }] },
  { key: "it", why: "my item", extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P1, zone: "play" }] },
  { key: "loc", why: "my other location", extra: [{ key: "loc", def: location({ name: "Hovel" }), owner: P1, zone: "play" }] },
  { key: "rs", why: "my face-up resource", extra: [{ key: "rs", def: stapleCard("Rage", "rage"), owner: P1, zone: "play" }] },
  { key: "fd", why: "my face-down card (a resource, even though it is really a character)", extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }] },
  { key: "hd", why: "a character card in my hand", extra: [{ key: "hd", def: character({ name: "Handy" }), owner: P1, zone: "hand" }] },
  { key: "dc", why: "a character card in my discard pile", extra: [{ key: "dc", def: character({ name: "Dusty" }), owner: P1, zone: "discard" }] }
];

clause(YURT, "0:ability:yurt-chillax", "CHILLAX takes the picked character out of play", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(playOf(g.engine, P1).includes(g.id("a")), false, "it is no longer in play");
  assert.equal(cardOf(g.engine, g.id("a")).faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("b")), "play", "control: my other character is untouched");
});

clause(YURT, "0:ability:yurt-chillax", "the character is REMOVED FROM THE GAME (not destroyed, not sent anywhere else)", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  assert.equal(zoneOf(g.engine, g.id("a")), "removed");
  assert.ok(removedOf(g.engine, P1).includes(g.id("a")), "removedOf(g.engine, P1).includes(g.id(\"a\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("a")), false, "not in the discard pile");
  assert.equal(handOf(g.engine, P1).includes(g.id("a")), false, "not in the hand");
});

clause(YURT, "0:ability:yurt-chillax", "Deplete this card: the Yurt is depleted, and the cost is paid on activation, before responses", () => {
  const g = yurtBoard();
  assert.equal(cardOf(g.engine, g.id("yurt")).depleted, false);
  yurtRaw(g, "a");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(cardOf(g.engine, g.id("yurt")).depleted, true, "depleted as a cost");
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "the removal waits for resolution");
  resolvePendingResponses(g.engine);
  offStage(g, "a");
});

clause(YURT, "0:ability:yurt-chillax", "CHILLAX has no resource cost: it works with no free resources", () => {
  const g = yurtBoard({ icons: {} });
  assert.equal(ready(g.engine), 0);
  yurtUse(g, "a");
  offStage(g, "a");
});

clause(YURT, "0:ability:yurt-chillax", "a depleted Yurt cannot CHILLAX again", () => {
  const g = yurtBoard({ depleted: true });
  refused(() => yurtRaw(g, "a"), "the Yurt is depleted");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  const fresh = yurtBoard();
  yurtUse(fresh, "a");
  refused(() => yurtRaw(fresh, "b"), "used up this turn");
  assert.equal(zoneOf(fresh.engine, fresh.id("b")), "play");
});

for (const bad of YURT_NOT_MINE) {
  clause(YURT, "0:ability:yurt-chillax", `cannot pick ${bad.why}`, () => {
    const g = yurtBoard({ extra: bad.extra });
    refused(() => yurtRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(cardOf(g.engine, g.id("yurt")).depleted, false, "nothing was paid");
    const control = yurtBoard({ extra: bad.extra });
    yurtUse(control, "a");
    offStage(control, "a", "control: my character works on the same board");
  });
}

clause(YURT, "0:ability:yurt-chillax", "cannot pick my own faction, and needs a pick", () => {
  const g = yurtBoard();
  refused(() => actRaw(g.engine, P1, g.id("yurt"), "yurt-chillax", { v: [g.engine.state.players[P1].factionId!] }), "my faction");
  const none = yurtBoard();
  refused(() => actRaw(none.engine, P1, none.id("yurt"), "yurt-chillax"), "no pick");
  assert.equal(cardOf(none.engine, none.id("yurt")).depleted, false);
});

clause(YURT, "0:ability:yurt-chillax", "with no character I control there is nothing to pick: it cannot be used", () => {
  const g = devBoard([{ key: "yurt", def: printing(YURT), owner: P1, zone: "play" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]);
  refused(() => actRaw(g.engine, P1, g.id("yurt"), "yurt-chillax", { v: [g.id("foe")] }), "only their character in play");
  assert.equal(cardOf(g.engine, g.id("yurt")).depleted, false);
});

clause(YURT, "0:ability:yurt-chillax", "a character I control but do not own can be picked ('a character you control')", () => {
  const g = yurtBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  yurtUse(g, "stolen");
  offStage(g, "stolen");
  assert.equal(cardOf(g.engine, g.id("stolen")).ownerId, P2, "ownership does not change");
});

clause(YURT, "0:ability:yurt-chillax", "the Yurt can only be used from play: not from the hand", () => {
  const g = yurtBoard({ yurt: "hand" });
  refused(() => yurtRaw(g, "a"), "the Yurt is in my hand");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
});

clause(YURT, "0:ability:yurt-chillax", "only the controller can use it: my opponent cannot CHILLAX my Yurt", () => {
  const g = yurtBoard({ turn: 2, active: P2 });
  refused(() => yurtRaw(g, "foe", P2), "their opponent's Yurt");
  assert.equal(cardOf(g.engine, g.id("yurt")).depleted, false);
});

clause(YURT, "0:ability:yurt-chillax", "a location has no summoning sickness: a Yurt deployed this turn can CHILLAX at once", () => {
  const g = yurtBoard({ yurt: "hand", icons: { greed: 3 } });
  play(g.engine, P1, g.id("yurt"));
  assert.equal(zoneOf(g.engine, g.id("yurt")), "play", "control: it was deployed (cost 1, [G][G])");
  yurtUse(g, "a");
  offStage(g, "a");
});

// --- the return ---

clause(YURT, "0:ability:yurt-chillax", "at the start of my next turn the removed character is put into play under my control", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  offStage(g, "a");
  yurtRound(g);
  assert.equal(g.engine.state.activePlayerId, P1, "my next turn has started");
  const card = cardOf(g.engine, g.id("a"));
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1);
  assert.equal(card.faceDown, false);
  assert.ok(playOf(g.engine, P1).includes(g.id("a")), "playOf(g.engine, P1).includes(g.id(\"a\"))");
});

clause(YURT, "0:ability:yurt-chillax", "it does not return at the start of my OPPONENT's turn in between", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  yurtHalfRound(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  offStage(g, "a", "still removed during their turn");
  yurtHalfRound(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "back at the start of my next turn");
});

clause(YURT, "0:ability:yurt-chillax", "it returns only once: later turns do not put it into play again, and it is not duplicated", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  yurtRound(g);
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  yurtRound(g);
  assert.equal(playOf(g.engine, P1).filter((id) => id === g.id("a")).length, 1);
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
});

clause(YURT, "0:ability:yurt-chillax", "the returned character is a new card: it has no damage, no tokens and is not depleted", () => {
  const g = yurtBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P1, zone: "play", damage: 3, depleted: true, counters: { token: 2 } }] });
  yurtUse(g, "hurt");
  yurtRound(g);
  const card = cardOf(g.engine, g.id("hurt"));
  assert.equal(card.zone, "play");
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.equal(card.counters?.token ?? 0, 0);
});

clause(YURT, "0:ability:yurt-chillax", "a character put into play at the start of the turn cannot attack that turn (CR 204.3b), but its sibling can", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  yurtRound(g);
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "control: it returned");
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("a")], target: { type: "faction", playerId: P2 } }), "it was not in play when the turn started");
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("b")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(g.engine), "control: Bravo, which stayed in play, can attack");
});

clause(YURT, "0:ability:yurt-chillax", "the returned character enters play: its 'enters play' trigger fires", () => {
  const drawer = character({
    name: "Newsie",
    life: 4,
    behavior: { abilities: [{ id: "news", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = yurtBoard({ extra: [{ key: "n", def: drawer, owner: P1, zone: "play" }, ...chars("d", 6, P1, "deck")] });
  yurtUse(g, "n");
  const handBefore = handOf(g.engine, P1).length;
  yurtRound(g);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "the returned character's enters-play trigger drew one card");
});

clause(YURT, "0:ability:yurt-chillax", "if the Yurt has left play (destroyed) by the start of my next turn, the character stays removed", () => {
  const breaker = tactic({
    name: "Wrecking Ball",
    cost: 0,
    behavior: { abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = yurtBoard({ extra: [{ key: "ball", def: breaker, owner: P1, zone: "hand" }] });
  yurtUse(g, "a");
  play(g.engine, P1, g.id("ball"), { selected: { t: [g.id("yurt")] } });
  assert.equal(zoneOf(g.engine, g.id("yurt")), "discard", "control: the Yurt was destroyed");
  yurtRound(g);
  offStage(g, "a", "it never returns");
});

clause(YURT, "0:ability:yurt-chillax", "if the Yurt has left play (returned to hand) by the start of my next turn, the character stays removed", () => {
  const lift = tactic({
    name: "Lift Location",
    cost: 0,
    behavior: { abilities: [{ id: "lift", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const g = yurtBoard({ extra: [{ key: "lift", def: lift, owner: P1, zone: "hand" }] });
  yurtUse(g, "a");
  play(g.engine, P1, g.id("lift"), { selected: { t: [g.id("yurt")] } });
  assert.equal(zoneOf(g.engine, g.id("yurt")), "hand");
  yurtRound(g);
  offStage(g, "a");
});

clause(YURT, "0:ability:yurt-chillax", "'this card': a different Yurt in play does not bring the character back when the Yurt that removed it is gone", () => {
  const breaker = tactic({
    name: "Wrecking Ball",
    cost: 0,
    behavior: { abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = yurtBoard({ icons: { greed: 8 }, extra: [{ key: "yurt2", def: printing(YURT), owner: P1, zone: "play" }, { key: "ball", def: breaker, owner: P1, zone: "hand" }] });
  yurtUse(g, "a");
  play(g.engine, P1, g.id("ball"), { selected: { t: [g.id("yurt")] } });
  assert.equal(zoneOf(g.engine, g.id("yurt")), "discard");
  assert.equal(zoneOf(g.engine, g.id("yurt2")), "play");
  yurtRound(g);
  offStage(g, "a", "only the Yurt that removed it can return it");
});

clause(YURT, "0:ability:yurt-chillax", "two Yurts each return their own character", () => {
  const g = yurtBoard({ extra: [{ key: "yurt2", def: printing(YURT), owner: P1, zone: "play" }] });
  yurtUse(g, "a", "yurt");
  yurtUse(g, "b", "yurt2");
  offStage(g, "a");
  offStage(g, "b");
  yurtRound(g);
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(zoneOf(g.engine, g.id("b")), "play");
});

clause(YURT, "0:ability:yurt-chillax", "the Yurt can CHILLAX again on the turn the character returns (it is restored at the start of the turn)", () => {
  const g = yurtBoard();
  yurtUse(g, "a");
  yurtRound(g);
  assert.equal(cardOf(g.engine, g.id("yurt")).depleted, false, "restored");
  yurtUse(g, "b");
  offStage(g, "b");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
});

clause(YURT, "0:ability:yurt-chillax", "used on my opponent's turn, 'my next turn' is the turn after theirs: the character returns then", () => {
  const g = yurtBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("a")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  yurtRaw(g, "a");
  resolvePendingResponses(g.engine);
  offStage(g, "a");
  yurtHalfRound(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "back at the start of my next turn");
});

clause(YURT, "0:ability:yurt-chillax", "a character removed from a battle's response window leaves the battle (it is no longer in play)", () => {
  const g = yurtBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  yurtRaw(g, "a");
  resolvePendingResponses(g.engine);
  offStage(g, "a");
  declareBlockers(g.engine, P1, [g.id("b")]);
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("a")), false);
});

clause(YURT, "0:ability:yurt-chillax", "cards attached to the removed character leave play with it, the same way (CR 301.4a): removed from the game", () => {
  const g = yurtBoard({ extra: [{ key: "gear", def: strengthGear(1), owner: P1, zone: "play", attachedToKey: "a" }] });
  yurtUse(g, "a");
  assert.equal(zoneOf(g.engine, g.id("gear")), "removed", "the attached item follows its host out of the game");
});

clause(YURT, "0:ability:yurt-chillax", "a character with the Yurt's pick destroyed in response means nothing returns", () => {
  const g = yurtBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  yurtRaw(g, "a");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("a")] });
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "destroyed in response, and not pulled out of the discard pile by the Yurt (CR 402.4)");
  yurtRound(g);
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "it is not pulled out of the discard pile later (CR 402.4)");
});

// =================================================================================
// Grandiose Resurrector
// RECUR: [G][G] -- COST: Use this only while this card is in your discard pile. Pay 5. Remove
// this card from the game. Pick up to 4 characters in your discard pile.
// EFFECT: Put the characters into your hand.
// Character (banker; mau), cost 8, [G][G], 6 / 3 / 6.
// =================================================================================

const RESURRECTOR = "145f40d1-97bb-4df3-a6df-84ad89d3537a";

function resBoard(
  opts: {
    rs?: Zone;
    owner?: PlayerId;
    icons?: Icons;
    chars?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "rs", def: printing(RESURRECTOR), owner: opts.owner ?? P1, zone: opts.rs ?? "discard" },
      ...chars("c", opts.chars ?? 6, P1, "discard"),
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 8 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ResBoard = ReturnType<typeof resBoard>;
const rsRaw = (g: ResBoard, picks: string[], player: PlayerId = P1) => actRaw(g.engine, player, g.id("rs"), "resurrector-recur", { picked: picks.map((k) => g.id(k)) });
const rsUse = (g: ResBoard, picks: string[]) => activate(g.engine, P1, g.id("rs"), "resurrector-recur", { selected: { picked: picks.map((k) => g.id(k)) } });

const RS_NOT_CHARACTERS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "tac", why: "a tactic in my discard pile", extra: [{ key: "tac", def: tactic({ name: "Old Tactic" }), owner: P1, zone: "discard" }] },
  { key: "it", why: "an item in my discard pile", extra: [{ key: "it", def: item({ name: "Old Item" }), owner: P1, zone: "discard" }] },
  { key: "loc", why: "a location in my discard pile", extra: [{ key: "loc", def: location({ name: "Old Place" }), owner: P1, zone: "discard" }] },
  { key: "rsc", why: "a resource in my discard pile", extra: [{ key: "rsc", def: stapleCard("Rage", "rage"), owner: P1, zone: "discard" }] },
  { key: "ochar", why: "a character in my OPPONENT's discard pile", extra: [{ key: "ochar", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" }] },
  { key: "hchar", why: "a character card in my hand", extra: [{ key: "hchar", def: character({ name: "Handy" }), owner: P1, zone: "hand" }] },
  { key: "dchar", why: "a character card in my deck", extra: [{ key: "dchar", def: character({ name: "Deckard" }), owner: P1, zone: "deck" }] },
  { key: "pchar", why: "a character in play", extra: [] },
  { key: "xchar", why: "a character removed from the game", extra: [{ key: "xchar", def: character({ name: "Gone" }), owner: P1, zone: "removed" }] }
];

clause(RESURRECTOR, "0:ability:resurrector-recur", "from my discard pile it puts one picked character into my hand", () => {
  const g = resBoard();
  rsUse(g, ["c0"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("c0")), "handOf(g.engine, P1).includes(g.id(\"c0\"))");
  for (const key of ["c1", "c2", "c3", "c4", "c5"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} (not picked) stays in the discard pile`);
});

for (const n of [2, 3, 4]) {
  clause(RESURRECTOR, "0:ability:resurrector-recur", `up to 4: ${n} picked characters all go into my hand`, () => {
    const g = resBoard();
    const picks = ["c0", "c1", "c2", "c3"].slice(0, n);
    rsUse(g, picks);
    for (const key of picks) assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} picked`);
    for (const key of ["c0", "c1", "c2", "c3", "c4", "c5"].slice(n)) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} not picked`);
    assert.equal(handOf(g.engine, P1).length, n);
  });
}

clause(RESURRECTOR, "0:ability:resurrector-recur", "'up to 4' includes 0: picking nobody still pays the costs and removes the Resurrector", () => {
  const g = resBoard();
  const before = ready(g.engine);
  rsUse(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0, "nothing came back");
  assert.equal(before - ready(g.engine), 5, "the 5 are paid");
  assert.equal(zoneOf(g.engine, g.id("rs")), "removed");
  for (const key of ["c0", "c1", "c2", "c3", "c4", "c5"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "5 characters are too many ('up to 4'): refused, nothing is paid", () => {
  const g = resBoard();
  refused(() => rsRaw(g, ["c0", "c1", "c2", "c3", "c4"]), "five picks");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.equal(ready(g.engine), 8);
  assert.equal(handOf(g.engine, P1).length, 0);
  const ok = resBoard();
  rsUse(ok, ["c0", "c1", "c2", "c3"]);
  assert.equal(handOf(ok.engine, P1).length, 4, "control: four is fine");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "the same card cannot be picked twice to fill the 'up to 4'", () => {
  const g = resBoard();
  refused(() => rsRaw(g, ["c0", "c0"]), "the same card twice");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "RECUR removes the Resurrector from the game", () => {
  const g = resBoard();
  rsUse(g, ["c0"]);
  assert.equal(zoneOf(g.engine, g.id("rs")), "removed");
  assert.ok(removedOf(g.engine, P1).includes(g.id("rs")), "removedOf(g.engine, P1).includes(g.id(\"rs\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("rs")), false);
  assert.equal(handOf(g.engine, P1).includes(g.id("rs")), false);
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "the Resurrector is removed BEFORE the picks: it cannot pick itself", () => {
  const g = resBoard();
  refused(() => rsRaw(g, ["rs"]), "itself");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "a SECOND Resurrector in the discard pile is just a character and can be picked", () => {
  const g = resBoard({ extra: [{ key: "rs2", def: printing(RESURRECTOR), owner: P1, zone: "discard" }] });
  rsUse(g, ["rs2", "c0"]);
  assert.equal(zoneOf(g.engine, g.id("rs2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("rs")), "removed");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "Pay 5: exactly 5 resources are paid up to the activation, before my opponent can respond", () => {
  const g = resBoard({ icons: { greed: 8 } });
  const before = ready(g.engine);
  rsRaw(g, ["c0"]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 5, "Pay 5");
  assert.equal(zoneOf(g.engine, g.id("rs")), "removed", "already removed from the game as a cost");
  assert.equal(zoneOf(g.engine, g.id("c0")), "discard", "the characters have not moved yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "Pay 5: refused with only 4 free resources even though [G][G] is controlled, accepted with exactly 5", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = resBoard({ icons: {}, extra: [...spent(2), ...res({ rage: 4 })] });
  assert.equal(ready(short.engine), 4);
  refused(() => rsRaw(short, ["c0"]), "4 free resources for Pay 5");
  assert.equal(zoneOf(short.engine, short.id("rs")), "discard", "nothing removed");
  assert.equal(ready(short.engine), 4, "nothing paid");
  const exact = resBoard({ icons: {}, extra: [...spent(2), ...res({ rage: 5 })] });
  rsUse(exact, ["c0"]);
  assert.equal(zoneOf(exact.engine, exact.id("c0")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "needs [G][G]: refused with one Greed and plenty of resources, accepted with two", () => {
  const one = resBoard({ icons: { greed: 1, rage: 8 } });
  refused(() => rsRaw(one, ["c0"]), "[G] is short of [G][G]", /threshold/i);
  assert.equal(zoneOf(one.engine, one.id("rs")), "discard");
  const none = resBoard({ icons: { rage: 8 } });
  refused(() => rsRaw(none, ["c0"]), "no [G]", /threshold/i);
  const two = resBoard({ icons: { greed: 2, rage: 6 } });
  rsUse(two, ["c0"]);
  assert.equal(zoneOf(two.engine, two.id("c0")), "hand");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "Use this only while this card is in your discard pile: refused from my hand, the deck, play and the removed zone", () => {
  for (const where of ["hand", "deck", "removed", "play"] as const) {
    const g = resBoard({ rs: where });
    refused(() => rsRaw(g, ["c0"]), `Resurrector in ${where}`);
    assert.equal(zoneOf(g.engine, g.id("c0")), "discard");
    assert.equal(zoneOf(g.engine, g.id("rs")), where);
  }
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "'your discard pile': a Resurrector in my opponent's discard pile cannot be recurred by me", () => {
  const g = resBoard({ owner: P2 });
  assert.ok(discardOf(g.engine, P2).includes(g.id("rs")), "discardOf(g.engine, P2).includes(g.id(\"rs\"))");
  refused(() => rsRaw(g, ["c0"]), "their discard pile");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c0")), "discard");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "RECUR is one-shot: once removed it cannot be used again", () => {
  const g = resBoard({ icons: { greed: 12 } });
  rsUse(g, ["c0"]);
  refused(() => rsRaw(g, ["c1"]), "no longer in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
});

for (const bad of RS_NOT_CHARACTERS) {
  clause(RESURRECTOR, "0:ability:resurrector-recur", `cannot pick ${bad.why}`, () => {
    const g = resBoard({ extra: bad.extra });
    const key = bad.key === "pchar" ? "mine" : bad.key;
    refused(() => rsRaw(g, [key]), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("rs")), "discard", "nothing was paid or removed");
    assert.equal(ready(g.engine), 8);
    const mixed = resBoard({ extra: bad.extra });
    refused(() => rsRaw(mixed, ["c0", key]), `picking a legal character together with ${bad.why}`);
    assert.equal(zoneOf(mixed.engine, mixed.id("c0")), "discard");
    const control = resBoard({ extra: bad.extra });
    rsUse(control, ["c0"]);
    assert.equal(zoneOf(control.engine, control.id("c0")), "hand", "control: a character from my discard pile works on the same board");
  });
}

clause(RESURRECTOR, "0:ability:resurrector-recur", "the characters go to MY hand: a character I own comes back to my hand even if it was destroyed under my opponent's control", () => {
  const g = resBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen Then Dead" }), owner: P1, zone: "discard" }] });
  rsUse(g, ["stolen"]);
  assert.ok(handOf(g.engine, P1).includes(g.id("stolen")), "handOf(g.engine, P1).includes(g.id(\"stolen\"))");
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "RECUR works as a response on my opponent's turn (it is an ability)", () => {
  const g = resBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  rsRaw(g, ["c0", "c1"]);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("rs")), "removed");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "RECUR cannot be used by my opponent on my Resurrector, and only with a legal pick list", () => {
  const g = resBoard({ turn: 2, active: P2, extra: res({ greed: 8 }, P2) });
  refused(() => rsRaw(g, ["c0"], P2), "not their card");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "a picked character that left the discard pile in response is not pulled back into my hand (CR 402.4)", () => {
  const g = resBoard({ extra: [{ key: "mv", def: moverTactic("discard", "deck"), owner: P2, zone: "hand" }] });
  rsRaw(g, ["c0", "c1"]);
  respondWith(g.engine, P2, g.id("mv"), { t: [g.id("c0")] });
  assert.equal(zoneOf(g.engine, g.id("c0")), "deck", "control: they moved c0 from the discard pile to my deck in response");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the other pick still comes back");
});

clause(RESURRECTOR, "0:ability:resurrector-recur", "with fewer than 4 characters in the discard pile 'up to 4' still lets me take them all", () => {
  const g = resBoard({ chars: 2 });
  rsUse(g, ["c0", "c1"]);
  assert.equal(handOf(g.engine, P1).length, 2);
});

// =================================================================================
// Gus VanBaymaven
// UNIQUE GUS
// ALL YOUR BAYS ARE BELONG TO GUS -- COST: Pay 2. Deplete this card. Pick a location.
// EFFECT: Take control of the location.
// FLIP UP: 2 [G][G][G]
// Character (banker; mau), cost 2, [G][G][G], 1 / 3 / 1.
// =================================================================================

const GUS = "fcb58c44-ffb6-4ac8-81de-3e95adfd7cb5";

function gusBoard(
  opts: {
    gus?: Zone;
    faceDown?: boolean;
    depleted?: boolean;
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "gus", def: printing(GUS), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.gus ?? "play", faceDown: opts.faceDown, depleted: opts.depleted },
      { key: "oloc", def: location({ name: "Their Keep", structure: 6 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type GusBoard = ReturnType<typeof gusBoard>;
const gusRaw = (g: GusBoard, target: string, player: PlayerId = P1) => actRaw(g.engine, player, g.id("gus"), "gus-bays", { loc: [g.id(target)] });
const gusUse = (g: GusBoard, target: string) => activate(g.engine, P1, g.id("gus"), "gus-bays", { selected: { loc: [g.id(target)] } });
function gusRound(g: GusBoard): void {
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, declineAll);
}

// --- UNIQUE GUS ---

clause(GUS, "0:unique", "deploying a second Gus while I control one makes me choose which to keep: keeping the new one destroys the old one", () => {
  const g = gusBoard({ extra: [{ key: "gus2", def: printing(GUS), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("gus2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("gus2") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gus2")), "play");
  assert.equal(zoneOf(g.engine, g.id("gus")), "discard");
});

clause(GUS, "0:unique", "...or I keep the old one and the new one is destroyed", () => {
  const g = gusBoard({ extra: [{ key: "gus2", def: printing(GUS), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("gus2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("gus") });
  assert.equal(zoneOf(g.engine, g.id("gus")), "play");
  assert.equal(zoneOf(g.engine, g.id("gus2")), "discard");
});

clause(GUS, "0:unique", "my opponent may control their own Gus at the same time (the restriction is per player)", () => {
  const g = gusBoard({ turn: 2, active: P2, extra: [{ key: "ogus", def: printing(GUS), owner: P2, zone: "hand" }, ...res({ greed: 4 }, P2)] });
  play(g.engine, P2, g.id("ogus"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ogus")), "play");
  assert.equal(zoneOf(g.engine, g.id("gus")), "play");
});

clause(GUS, "0:unique", "taking control of my opponent's Gus while I control one makes me choose (FAQ) and the game goes on", () => {
  const g = gusBoard({ extra: [{ key: "ogus", def: printing(GUS), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ogus")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("ogus") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ogus")), "play");
  assert.equal(cardOf(g.engine, g.id("ogus")).controllerId, P1);
  assert.equal(zoneOf(g.engine, g.id("gus")), "discard");
});

clause(GUS, "0:unique", "a different UNIQUE designation does not conflict with Gus", () => {
  const g = gusBoard({ extra: [{ key: "o", def: character({ name: "Someone Else", cost: 0, unique: "someone-else" }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("o"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o")), "play");
  assert.equal(zoneOf(g.engine, g.id("gus")), "play");
});

// --- ALL YOUR BAYS ARE BELONG TO GUS ---

clause(GUS, "1:ability:gus-bays", "I take control of the picked location (my opponent's)", () => {
  const g = gusBoard();
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P2, "control: they control it first");
  gusUse(g, "oloc");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("oloc")), "it is in my play area");
  assert.equal(playOf(g.engine, P2).includes(g.id("oloc")), false);
  assert.equal(zoneOf(g.engine, g.id("oloc")), "play");
});

clause(GUS, "1:ability:gus-bays", "only control changes: the location is still owned by its owner, and keeps its damage", () => {
  const g = gusBoard({ extra: [{ key: "dloc", def: location({ name: "Dented", structure: 6 }), owner: P2, zone: "play", damage: 2 }] });
  gusUse(g, "dloc");
  const card = cardOf(g.engine, g.id("dloc"));
  assert.equal(card.controllerId, P1);
  assert.equal(card.ownerId, P2, "ownership never changes (CR 407.8)");
  assert.equal(card.damage, 2, "its damage stays");
});

clause(GUS, "1:ability:gus-bays", "the control is permanent: it is still mine after a full round of turns", () => {
  const g = gusBoard();
  gusUse(g, "oloc");
  gusRound(g);
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
  gusRound(g);
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
});

clause(GUS, "1:ability:gus-bays", "the control stays when Gus leaves play: it lasts until the location leaves play", () => {
  const g = gusBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  gusUse(g, "oloc");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gus")] } });
  assert.equal(zoneOf(g.engine, g.id("gus")), "discard", "control: Gus was destroyed");
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1, "I keep the location");
});

clause(GUS, "1:ability:gus-bays", "the location goes to its OWNER's discard pile when it is destroyed, not mine", () => {
  const breaker = tactic({
    name: "Wrecking Ball",
    cost: 0,
    behavior: { abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = gusBoard({ extra: [{ key: "ball", def: breaker, owner: P1, zone: "hand" }] });
  gusUse(g, "oloc");
  play(g.engine, P1, g.id("ball"), { selected: { t: [g.id("oloc")] } });
  assert.ok(discardOf(g.engine, P2).includes(g.id("oloc")), "discardOf(g.engine, P2).includes(g.id(\"oloc\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("oloc")), false);
});

clause(GUS, "1:ability:gus-bays", "Pay 2 and Deplete this card: exactly 2 resources are spent and Gus is depleted, on activation", () => {
  const g = gusBoard({ icons: { greed: 5 } });
  const before = ready(g.engine);
  gusRaw(g, "oloc");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 2, "Pay 2");
  assert.equal(cardOf(g.engine, g.id("gus")).depleted, true, "Deplete this card");
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P2, "the control change waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
});

clause(GUS, "1:ability:gus-bays", "Pay 2: refused with only 1 free resource, accepted with exactly 2 (any icons: the ability has no threshold of its own)", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = gusBoard({ icons: {}, extra: [...spent(3), ...res({ rage: 1 })] });
  assert.equal(ready(short.engine), 1);
  refused(() => gusRaw(short, "oloc"), "1 free resource for Pay 2");
  assert.equal(cardOf(short.engine, short.id("gus")).depleted, false, "nothing was depleted");
  assert.equal(cardOf(short.engine, short.id("oloc")).controllerId, P2);
  const exact = gusBoard({ icons: {}, extra: res({ rage: 2 }) });
  gusUse(exact, "oloc");
  assert.equal(cardOf(exact.engine, exact.id("oloc")).controllerId, P1);
  assert.equal(ready(exact.engine), 0);
});

clause(GUS, "1:ability:gus-bays", "a depleted Gus cannot use it", () => {
  const g = gusBoard({ depleted: true });
  refused(() => gusRaw(g, "oloc"), "Gus is depleted");
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P2);
  assert.equal(ready(g.engine), 4);
});

clause(GUS, "1:ability:gus-bays", "once used this turn Gus is depleted: the ability cannot be used twice in a turn", () => {
  const g = gusBoard({ icons: { greed: 6 }, extra: [{ key: "oloc2", def: location({ name: "Their Other Keep" }), owner: P2, zone: "play" }] });
  gusUse(g, "oloc");
  refused(() => gusRaw(g, "oloc2"), "Gus is depleted by the first use");
  assert.equal(cardOf(g.engine, g.id("oloc2")).controllerId, P2);
});

clause(GUS, "1:ability:gus-bays", "Gus can use it the turn he enters play (characters may use abilities their first turn, CR 204.3a)", () => {
  const g = gusBoard({ gus: "hand", icons: { greed: 6 } });
  play(g.engine, P1, g.id("gus"));
  assert.equal(zoneOf(g.engine, g.id("gus")), "play", "control: he was deployed (cost 2, [G][G][G])");
  gusUse(g, "oloc");
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
});

clause(GUS, "1:ability:gus-bays", "I can pick a location I already control (no change of controller), and the costs are still paid", () => {
  const g = gusBoard({ extra: [{ key: "myloc", def: location({ name: "My Keep" }), owner: P1, zone: "play" }] });
  const before = ready(g.engine);
  gusUse(g, "myloc");
  assert.equal(cardOf(g.engine, g.id("myloc")).controllerId, P1);
  assert.equal(before - ready(g.engine), 2);
});

clause(GUS, "1:ability:gus-bays", "the location's abilities become mine to use, and no longer my opponent's", () => {
  const lookout = location({
    name: "Lookout",
    structure: 4,
    behavior: { abilities: [{ id: "peek", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = gusBoard({ extra: [{ key: "look", def: lookout, owner: P2, zone: "play" }, ...chars("d", 3, P1, "deck"), ...chars("od", 3, P2, "deck")] });
  gusUse(g, "look");
  const before = handOf(g.engine, P1).length;
  activate(g.engine, P1, g.id("look"), "peek");
  assert.equal(handOf(g.engine, P1).length, before + 1, "I can use it now");
  refused(() => actRaw(g.engine, P2, g.id("look"), "peek"), "they no longer control it");
});

clause(GUS, "1:ability:gus-bays", "can be used in response on my opponent's turn (it is an ability)", () => {
  const g = gusBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  gusRaw(g, "oloc");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
});

const GUS_NOT_LOCATIONS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "it", why: "an item", extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] },
  { key: "rs", why: "a face-up resource", extra: [{ key: "rs", def: stapleCard("Rage", "rage"), owner: P2, zone: "play" }] },
  { key: "fd", why: "a face-down card (a resource), even one that is really a location", extra: [{ key: "fd", def: location({ name: "Hidden Place" }), owner: P2, zone: "play", faceDown: true }] },
  { key: "hloc", why: "a location card in a hand", extra: [{ key: "hloc", def: location({ name: "Handy Place" }), owner: P2, zone: "hand" }] },
  { key: "dloc", why: "a location card in a discard pile", extra: [{ key: "dloc", def: location({ name: "Dusty Place" }), owner: P2, zone: "discard" }] },
  { key: "kloc", why: "a location card in a deck", extra: [{ key: "kloc", def: location({ name: "Deck Place" }), owner: P2, zone: "deck" }] }
];

for (const bad of GUS_NOT_LOCATIONS) {
  clause(GUS, "1:ability:gus-bays", `cannot pick ${bad.why}`, () => {
    const g = gusBoard({ extra: bad.extra });
    refused(() => gusRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(cardOf(g.engine, g.id("gus")).depleted, false, "nothing was paid");
    assert.equal(ready(g.engine), 4);
    const control = gusBoard({ extra: bad.extra });
    gusUse(control, "oloc");
    assert.equal(cardOf(control.engine, control.id("oloc")).controllerId, P1, "control: a real location works on the same board");
  });
}

clause(GUS, "1:ability:gus-bays", "cannot pick a character or a faction", () => {
  const g = gusBoard();
  refused(() => gusRaw(g, "foe"), "an opposing character");
  const g2 = gusBoard();
  refused(() => actRaw(g2.engine, P1, g2.id("gus"), "gus-bays", { loc: [g2.engine.state.players[P2].factionId!] }), "a faction");
  const g3 = gusBoard();
  refused(() => actRaw(g3.engine, P1, g3.id("gus"), "gus-bays"), "no pick");
  assert.equal(cardOf(g3.engine, g3.id("oloc")).controllerId, P2);
});

clause(GUS, "1:ability:gus-bays", "with no location in play at all there is nothing to pick, so it cannot be used", () => {
  const g = devBoard([{ key: "gus", def: printing(GUS), owner: P1, zone: "play" }, ...res({ greed: 4 })]);
  refused(() => actRaw(g.engine, P1, g.id("gus"), "gus-bays"), "no location");
  assert.equal(cardOf(g.engine, g.id("gus")).depleted, false);
});

clause(GUS, "1:ability:gus-bays", "a face-down Gus, or one in my hand, cannot use it; my opponent cannot use my Gus", () => {
  const faceDown = gusBoard({ faceDown: true });
  refused(() => gusRaw(faceDown, "oloc"), "face-down", /face-down card.s abilities cannot be activated/);
  const inHand = gusBoard({ gus: "hand" });
  refused(() => gusRaw(inHand, "oloc"), "in the hand");
  const theirs = gusBoard({ turn: 2, active: P2, extra: res({ greed: 4 }, P2) });
  refused(() => gusRaw(theirs, "oloc", P2), "not their card");
  assert.equal(cardOf(theirs.engine, theirs.id("oloc")).controllerId, P2);
});

clause(GUS, "1:ability:gus-bays", "taking control of a UNIQUE location of which I control a copy makes me choose, and the game goes on", () => {
  const florist = printing("8a4f4138-4326-4029-a0a1-132f879e5531");
  const g = gusBoard({
    icons: { greed: 4 },
    extra: [
      { key: "myf", def: florist, owner: P1, zone: "play" },
      { key: "theirf", def: florist, owner: P2, zone: "play" }
    ]
  });
  gusUse(g, "theirf");
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("theirf") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("myf")), "discard");
  assert.equal(cardOf(g.engine, g.id("theirf")).controllerId, P1);
});

// --- FLIP UP ---

clause(GUS, "2:flipUp", "FLIP UP puts Gus into play face-up as a character", () => {
  const g = gusBoard({ gus: "play", faceDown: true, icons: { greed: 3 } });
  assert.equal(cardOf(g.engine, g.id("gus")).faceDown, true);
  flipUpRaw(g.engine, P1, g.id("gus"));
  resolvePendingResponses(g.engine);
  const card = cardOf(g.engine, g.id("gus"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("gus")), ["character"]);
});

clause(GUS, "2:flipUp", "FLIP UP costs exactly 2: refused with 1 free resource, accepted with 2", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = gusBoard({ gus: "play", faceDown: true, icons: {}, extra: spent(3) });
  assert.equal(ready(short.engine), 1, "only the face-down Gus is free");
  refused(() => flipUpRaw(short.engine, P1, short.id("gus")), "1 free resource for FLIP UP 2");
  assert.equal(cardOf(short.engine, short.id("gus")).faceDown, true);
  const exact = gusBoard({ gus: "play", faceDown: true, icons: {}, extra: [...spent(3), ...res({ rage: 1 })] });
  assert.equal(ready(exact.engine), 2);
  flipUpRaw(exact.engine, P1, exact.id("gus"));
  resolvePendingResponses(exact.engine);
  assert.equal(cardOf(exact.engine, exact.id("gus")).faceDown, false);
  assert.equal(ready(exact.engine), 0);
});

clause(GUS, "2:flipUp", "FLIP UP needs [G][G][G]: refused with two Greed and plenty of other resources, accepted with three", () => {
  const two = gusBoard({ gus: "play", faceDown: true, icons: { greed: 2, rage: 5 } });
  refused(() => flipUpRaw(two.engine, P1, two.id("gus")), "[G][G] is short of [G][G][G]", /threshold/i);
  assert.equal(cardOf(two.engine, two.id("gus")).faceDown, true);
  const three = gusBoard({ gus: "play", faceDown: true, icons: { greed: 3 } });
  flipUpRaw(three.engine, P1, three.id("gus"));
  resolvePendingResponses(three.engine);
  assert.equal(cardOf(three.engine, three.id("gus")).faceDown, false);
});

clause(GUS, "2:flipUp", "FLIP UP of a character does not change when it may be deployed (CR 507.4d): refused on my opponent's turn", () => {
  const g = gusBoard({ gus: "play", faceDown: true, icons: { greed: 4 }, turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => flipUpRaw(g.engine, P1, g.id("gus")), "a character cannot be deployed on my opponent's turn");
  assert.equal(cardOf(g.engine, g.id("gus")).faceDown, true);
});

clause(GUS, "2:flipUp", "a flipped-up Gus is a normal Gus: it can use his ability that same turn", () => {
  const g = gusBoard({ gus: "play", faceDown: true, icons: { greed: 6 } });
  flipUpRaw(g.engine, P1, g.id("gus"));
  resolvePendingResponses(g.engine);
  gusUse(g, "oloc");
  assert.equal(cardOf(g.engine, g.id("oloc")).controllerId, P1);
});

clause(GUS, "2:flipUp", "Gus cannot be flipped up from my hand, or by my opponent; a face-down Gus is a blank resource", () => {
  const inHand = gusBoard({ gus: "hand", icons: { greed: 4 } });
  refused(() => flipUpRaw(inHand.engine, P1, inHand.id("gus")), "in the hand");
  const theirs = gusBoard({ gus: "play", faceDown: true, owner: P2, icons: { greed: 4 } });
  refused(() => flipUpRaw(theirs.engine, P1, theirs.id("gus")), "their face-down card");
  const g = gusBoard({ gus: "play", faceDown: true });
  assert.deepEqual(g.engine.getCardTypes(g.id("gus")), ["resource"]);
});

// =================================================================================
// Hidden Ruins
// COST: Reveal a face-down location you control. -- EFFECT: You may play the location. Draw a card.
// While this card is in your discard pile, if a card that provides at least [G] enters play
// under your control, you may pay 2. If you do, put this card into play under your control as a
// face-down resource.
// FLIP UP: 1 [G]
// Tactic (banker), cost 1, [G].
// =================================================================================

const RUINS = "6331bedf-cb85-42f9-a5b6-b84aee290627";

/** A location (cost 2, no threshold) of mine that is face-down in play, or another card kind face-down. */
function fdLocation(owner: PlayerId = P1, name = "Buried Hall", over: Partial<CardDefinition> = {}): CardDefinition {
  return location({ name, cost: 2, structure: 4, ...over });
}

function ruinsBoard(
  opts: {
    ruins?: Zone;
    ruinsFaceDown?: boolean;
    icons?: Icons;
    locDef?: CardDefinition;
    fdLoc?: boolean;
    /** The face-down location is spent (attached to my faction), so it never pays for anything. */
    fdSpent?: boolean;
    deck?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "ruins", def: printing(RUINS), owner: opts.owner ?? P1, zone: opts.ruins ?? "hand", faceDown: opts.ruinsFaceDown },
      ...(opts.fdLoc === false ? [] : [{ key: "fdloc", def: opts.locDef ?? fdLocation(), owner: P1, zone: "play" as Zone, faceDown: true, attachedToKey: opts.fdSpent ? "__factionA" : undefined }]),
      ...chars("d", opts.deck ?? 6, P1, "deck"),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type RuinsBoard = ReturnType<typeof ruinsBoard>;
const ruinsPlayRaw = (g: RuinsBoard, target = "fdloc") => playRaw(g.engine, P1, g.id("ruins"), { selected: { loc: [g.id(target)] } });
/** Plays the Ruins and answers the "play the location?" prompt: `accept` plays it. */
function ruinsPlay(g: RuinsBoard, accept: boolean, target = "fdloc"): void {
  play(g.engine, P1, g.id("ruins"), { selected: { loc: [g.id(target)] } });
  if (pending(g.engine)) {
    drain(g.engine, (pc) => (pc.kind === "deployForFree" && accept ? { kind: "deployForFree", cardId: g.id(target) } : declineAll(pc)));
  }
}
const ruinsFlipRaw = (g: RuinsBoard, target = "fdloc", player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("ruins"), { loc: [g.id(target)] });
function ruinsFlip(g: RuinsBoard, accept: boolean, target = "fdloc"): void {
  ruinsFlipRaw(g, target);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" && accept ? { kind: "deployForFree", cardId: g.id(target) } : declineAll(pc)));
}

// --- the tactic ---

clause(RUINS, "0:ability", "revealing a face-down location I control: I may play it, and it enters play face-up", () => {
  const g = ruinsBoard();
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, true, "control: it starts face-down");
  ruinsPlay(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("fdloc"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false, "it is now a face-up location");
  assert.equal(card.controllerId, P1);
  assert.deepEqual(g.engine.getCardTypes(g.id("fdloc")), ["location"]);
});

clause(RUINS, "0:ability", "'you MAY play': declining leaves the location face-down", () => {
  const g = ruinsBoard();
  ruinsPlay(g, false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, true);
  assert.deepEqual(g.engine.getCardTypes(g.id("fdloc")), ["resource"]);
});

clause(RUINS, "0:ability", "I draw a card whether or not I play the location (the draw is not part of the 'may')", () => {
  const accepted = ruinsBoard();
  const handBefore = handOf(accepted.engine, P1).length;
  ruinsPlay(accepted, true);
  assert.equal(handOf(accepted.engine, P1).length, handBefore - 1 + 1, "played: the Ruins left the hand, one card drawn");
  assert.ok(handOf(accepted.engine, P1).includes(accepted.id("d0")), "the top card");
  const declined = ruinsBoard();
  const handBefore2 = handOf(declined.engine, P1).length;
  ruinsPlay(declined, false);
  assert.equal(handOf(declined.engine, P1).length, handBefore2 - 1 + 1, "declined: still one card drawn");
});

clause(RUINS, "0:ability", "it draws exactly ONE card", () => {
  const g = ruinsBoard();
  const handBefore = handOf(g.engine, P1).length;
  ruinsPlay(g, true);
  assert.equal(zoneOf(g.engine, g.id("d1")), "deck");
  assert.equal(handOf(g.engine, P1).length - (handBefore - 1), 1);
});

clause(RUINS, "0:ability", "the card is revealed (a cardsRevealed event for the face-down location)", () => {
  const g = ruinsBoard();
  ruinsPlay(g, false);
  assert.ok(revealedIds(g.engine).includes(g.id("fdloc")), "the face-down location was revealed");
});

clause(RUINS, "0:ability", "'COST: Reveal a face-down location': the reveal is part of the cost, so it has happened by the time my opponent can respond", () => {
  const g = ruinsBoard();
  ruinsPlayRaw(g);
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.ok(revealedIds(g.engine).includes(g.id("fdloc")), "already revealed when the tactic was played");
});

clause(RUINS, "0:ability", "'You may play the location' (not 'for free'): playing it costs its numeric cost (2 here), on top of the tactic's 1", () => {
  const g = ruinsBoard({ icons: { greed: 5 }, fdSpent: true });
  const before = ready(g.engine);
  ruinsPlay(g, true);
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, false, "control: it was played");
  assert.equal(before - ready(g.engine), 1 + 2, "1 for the Ruins and 2 for playing the location");
});

clause(RUINS, "0:ability", "'You may play the location' (not 'for free'): its threshold is needed, a location needing [E][E] cannot be played without them", () => {
  const locDef = location({ name: "Elite Hall", cost: 0, threshold: "ee", structure: 4 });
  const bad = ruinsBoard({ locDef, icons: { greed: 4 } });
  play(bad.engine, P1, bad.id("ruins"), { selected: { loc: [bad.id("fdloc")] } });
  const pc = pending(bad.engine);
  if (pc) {
    refused(() => answerPending(bad.engine, "deployForFree", { cardId: bad.id("fdloc") }), "its threshold is not met");
  }
  assert.equal(cardOf(bad.engine, bad.id("fdloc")).faceDown, true, "still face-down: its threshold was not met");
  const ok = ruinsBoard({ locDef, icons: { greed: 4, elitism: 2 } });
  ruinsPlay(ok, true);
  assert.equal(cardOf(ok.engine, ok.id("fdloc")).faceDown, false, "control: with [E][E] it can be played");
});

clause(RUINS, "0:ability", "the location I play enters play: its 'enters play' trigger fires", () => {
  const watcher = location({
    name: "Watchtower",
    cost: 0,
    structure: 4,
    behavior: { abilities: [{ id: "tower", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }] }
  });
  const g = ruinsBoard({ locDef: watcher });
  ruinsPlay(g, true);
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, false, "control: it was played");
  assert.equal(influenceOf(g.engine, P1), START + 2);
  const declined = ruinsBoard({ locDef: watcher });
  ruinsPlay(declined, false);
  assert.equal(influenceOf(declined.engine, P1), START, "control: a face-down location is blank, nothing happens");
});

clause(RUINS, "0:ability", "the tactic costs exactly 1 (paid when played) and ends in my discard pile", () => {
  const g = ruinsBoard({ icons: { greed: 4 } });
  const before = ready(g.engine);
  ruinsPlayRaw(g);
  assert.equal(before - ready(g.engine), 1);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "deploying");
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "0:ability", "needs [G]: refused with plenty of resources but no Greed, accepted with one", () => {
  const none = ruinsBoard({ icons: { rage: 5 } });
  refused(() => ruinsPlayRaw(none), "no [G]", /threshold/i);
  assert.equal(zoneOf(none.engine, none.id("ruins")), "hand");
  const one = ruinsBoard({ icons: { greed: 1 } });
  ruinsPlay(one, false);
  assert.equal(zoneOf(one.engine, one.id("ruins")), "discard");
});

clause(RUINS, "0:ability", "costs 1: refused when every resource is spent", () => {
  const spent: CardPlacement[] = bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = ruinsBoard({ icons: {}, fdSpent: true, extra: spent });
  assert.equal(ready(g.engine), 0, "control: every resource is spent");
  refused(() => ruinsPlayRaw(g), "no free resource");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "hand");
});

const RUINS_BAD_PICKS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "up", why: "a FACE-UP location I control", extra: [{ key: "up", def: location({ name: "Open Hall" }), owner: P1, zone: "play" }] },
  { key: "ofd", why: "my OPPONENT's face-down location", extra: [{ key: "ofd", def: location({ name: "Their Hidden Hall" }), owner: P2, zone: "play", faceDown: true }] },
  { key: "fdc", why: "a face-down CHARACTER I control", extra: [{ key: "fdc", def: character({ name: "Hidden Man" }), owner: P1, zone: "play", faceDown: true }] },
  { key: "fdi", why: "a face-down ITEM I control", extra: [{ key: "fdi", def: item({ name: "Hidden Gear" }), owner: P1, zone: "play", faceDown: true }] },
  { key: "fdt", why: "a face-down TACTIC I control", extra: [{ key: "fdt", def: tactic({ name: "Hidden Trick" }), owner: P1, zone: "play", faceDown: true }] },
  { key: "hl", why: "a location card in my hand", extra: [{ key: "hl", def: location({ name: "Handy Hall" }), owner: P1, zone: "hand" }] },
  { key: "dl", why: "a location card in my discard pile", extra: [{ key: "dl", def: location({ name: "Dusty Hall" }), owner: P1, zone: "discard" }] },
  { key: "kl", why: "a location card in my deck", extra: [{ key: "kl", def: location({ name: "Deck Hall" }), owner: P1, zone: "deck" }] },
  { key: "mine", why: "a character", extra: [] }
];

for (const bad of RUINS_BAD_PICKS) {
  clause(RUINS, "0:ability", `cannot reveal ${bad.why}`, () => {
    const g = ruinsBoard({ extra: bad.extra });
    const freeBefore = ready(g.engine);
    refused(() => ruinsPlayRaw(g, bad.key), `revealing ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("ruins")), "hand", "nothing was played");
    assert.equal(ready(g.engine), freeBefore, "nothing was paid");
    const control = ruinsBoard({ extra: bad.extra });
    ruinsPlay(control, true);
    assert.equal(cardOf(control.engine, control.id("fdloc")).faceDown, false, "control: the face-down location works on the same board");
  });
}

clause(RUINS, "0:ability", "with no face-down location I control there is nothing to reveal: it cannot be played", () => {
  const g = ruinsBoard({ fdLoc: false });
  refused(() => playRaw(g.engine, P1, g.id("ruins")), "no pick");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "hand");
  const g2 = ruinsBoard({ fdLoc: false });
  refused(() => playRaw(g2.engine, P1, g2.id("ruins"), { selected: { loc: [g2.id("mine")] } }), "no face-down location");
});

clause(RUINS, "0:ability", "only the revealed location is played: another face-down location I control stays face-down", () => {
  const g = ruinsBoard({ extra: [{ key: "fd2", def: fdLocation(P1, "Second Hall"), owner: P1, zone: "play", faceDown: true }] });
  ruinsPlay(g, true);
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, false);
  assert.equal(cardOf(g.engine, g.id("fd2")).faceDown, true);
});

clause(RUINS, "0:ability", "it is a tactic: it can be played in response on my opponent's turn", () => {
  const g = ruinsBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  const handBefore = handOf(g.engine, P1).length;
  respondWith(g.engine, P1, g.id("ruins"), { loc: [g.id("fdloc")] });
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: g.id("fdloc") } : declineAll(pc)));
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "the card was drawn");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "0:ability", "the revealed location is resolved when the tactic resolves: one destroyed in response can't be played, but the card is still drawn", () => {
  const g = ruinsBoard({ extra: [{ key: "kany", def: killAnyTactic(), owner: P2, zone: "hand" }] });
  // killAny can pick resources; the face-down location is a resource
  ruinsPlayRaw(g);
  respondWith(g.engine, P2, g.id("kany"), { t: [g.id("fdloc")] });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fdloc")), "discard", "control: destroyed in response");
  assert.equal(handOf(g.engine, P1).includes(g.id("d0")), true, "the draw still happens");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

// --- recycling from the discard pile ---

/** A staple Greed in my hand, to play with the develop rule. */
const greedInHand = (key = "gr"): CardPlacement => ({ key, def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" });

function ruinsRecycleBoard(opts: { ruins?: Zone; icons?: Icons; extra?: CardPlacement[]; owner?: PlayerId; turn?: number; active?: PlayerId } = {}) {
  return ruinsBoard({ ruins: opts.ruins ?? "discard", owner: opts.owner, fdLoc: false, icons: opts.icons ?? { rage: 4 }, turn: opts.turn, active: opts.active, extra: [greedInHand(), ...(opts.extra ?? [])] });
}

function playGreed(g: RuinsBoard, answerPay: boolean | "none", key = "gr", faceDown = false): void {
  developResource(g.engine, P1, g.id(key), faceDown);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "mayPay" && answerPay !== "none" ? { kind: "mayPay", pay: answerPay } : declineAll(pc)));
}

clause(RUINS, "1:rule", "in my discard pile, when a Greed resource enters play under my control I may pay 2: the Ruins is put into play face-down", () => {
  const g = ruinsRecycleBoard();
  playGreed(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("ruins"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "as a face-down resource");
  assert.equal(card.controllerId, P1, "under my control");
  assert.deepEqual(g.engine.getCardTypes(g.id("ruins")), ["resource"]);
});

clause(RUINS, "1:rule", "'you MAY pay 2': declining leaves it in the discard pile and spends nothing", () => {
  const g = ruinsRecycleBoard();
  const before = ready(g.engine);
  playGreed(g, false);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
  assert.equal(ready(g.engine), before + 1, "no payment: the only change is the new Greed resource");
});

clause(RUINS, "1:rule", "the choice is offered to me and costs exactly 2 resources", () => {
  const g = ruinsRecycleBoard();
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  const before = ready(g.engine);
  answerPending(g.engine, "mayPay", { pay: true });
  // 2 paid, and the Ruins arrives as one more free (face-down, Volition) resource
  assert.equal(before - ready(g.engine), 2 - 1, "Pay 2, then the face-down Ruins itself is a new free resource");
  assert.equal(attachedCount(g.engine, P1), 2, "exactly two resources were spent");
});

clause(RUINS, "1:rule", "'If you do': with fewer than 2 free resources I cannot pay, so it cannot come back", () => {
  const spent: CardPlacement[] = bank("rage", 4, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = ruinsRecycleBoard({ icons: {}, extra: spent });
  assert.equal(ready(g.engine), 0, "control: every resource is spent");
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(ready(g.engine), 1, "only the Greed I just played is free: 1 is short of 2");
  const readyAfterPlay = ready(g.engine);
  if (pending(g.engine)) {
    try {
      answerPending(g.engine, "mayPay", { pay: true });
    } catch {
      /* refusing to pay what I cannot afford is correct */
    }
    drain(g.engine, declineAll);
  }
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard", "it stays in the discard pile");
  assert.equal(ready(g.engine), readyAfterPlay, "no resources were spent");
});

clause(RUINS, "1:rule", "'enters play' is wider than 'is played': a Greed resource put into play by an effect also offers it", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = ruinsRecycleBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("gr")] } });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("gr")), "play", "control: the Greed entered play");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "play");
  assert.equal(cardOf(g.engine, g.id("ruins")).faceDown, true);
  assert.equal(attachedCount(g.engine, P1), 2, "exactly 2 resources were paid");
});

clause(RUINS, "1:rule", "any card providing at least [G] counts, not only resources: a character with PROVIDES [G] entering play", () => {
  const g = ruinsRecycleBoard({ extra: [{ key: "pg", def: character({ name: "Greedy Clerk", cost: 0, resource: { provides: ["greed"] } }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pg"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("pg")), "play", "control: it entered play");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "play");
  assert.equal(attachedCount(g.engine, P1), 2, "exactly 2 resources were paid");
});

for (const [icon, name] of [
  ["rage", "Rage"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as Array<[StapleIcon, string]>) {
  clause(RUINS, "1:rule", `a ${name} resource does not provide [G]: no offer`, () => {
    const g = ruinsRecycleBoard({ extra: [{ key: "other", def: stapleCard(name, icon), owner: P1, zone: "hand" }] });
    developResource(g.engine, P1, g.id("other"), false);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("other")), "play", "control: it entered play");
    assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
    assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
  });
}

clause(RUINS, "1:rule", "a Greed card played FACE-DOWN provides only Volition: no offer", () => {
  const g = ruinsRecycleBoard();
  developResource(g.engine, P1, g.id("gr"), true);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("gr")).faceDown, true, "control: it entered face-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "1:rule", "only a card entering under MY control counts: my opponent's Greed resource gives no offer", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ruins", def: printing(RUINS), owner: P1, zone: "discard" },
      { key: "ogr", def: stapleCard("Greed", "greed"), owner: P2, zone: "hand" },
      ...res({ rage: 4 })
    ]
  });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play", "control: their Greed entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "1:rule", "only a card entering under MY control counts: a Greed resource my opponent puts into play with an effect gives me no offer", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const g = ruinsRecycleBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "ogr", def: stapleCard("Greed", "greed"), owner: P2, zone: "discard" },
      { key: "raise", def: raise, owner: P2, zone: "hand" }
    ]
  });
  play(g.engine, P2, g.id("raise"), { selected: { t: [g.id("ogr")] } });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play", "control: it entered play under their control");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "1:rule", "...and a character with PROVIDES [G] that my opponent deploys gives me no offer either", () => {
  const g = ruinsRecycleBoard({ turn: 2, active: P2, extra: [{ key: "opg", def: character({ name: "Their Greedy Clerk", cost: 0, resource: { provides: ["greed"] } }), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("opg"));
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("opg")), "play", "control: it entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

for (const where of ["hand", "deck", "removed"] as const) {
  clause(RUINS, "1:rule", `only while it is in my discard pile: a Ruins in my ${where} gets no offer`, () => {
    const g = ruinsRecycleBoard({ ruins: where });
    developResource(g.engine, P1, g.id("gr"), false);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("gr")), "play", "control: the Greed entered play");
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("ruins")), where);
  });
}

clause(RUINS, "1:rule", "'your discard pile': a Ruins in my OPPONENT's discard pile gives me no offer", () => {
  const g = ruinsRecycleBoard({ owner: P2 });
  assert.ok(discardOf(g.engine, P2).includes(g.id("ruins")), "discardOf(g.engine, P2).includes(g.id(\"ruins\"))");
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

clause(RUINS, "1:rule", "a Ruins in play (face-up or face-down) has no such offer: it only works from the discard pile", () => {
  const g = ruinsRecycleBoard({ ruins: "play" });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(RUINS, "1:rule", "two Ruins in my discard pile are each offered, and both can come back", () => {
  const g = ruinsRecycleBoard({ icons: { rage: 6 }, extra: [{ key: "ruins2", def: printing(RUINS), owner: P1, zone: "discard" }] });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : acceptPay(pc)));
  assert.equal(zoneOf(g.engine, g.id("ruins")), "play");
  assert.equal(zoneOf(g.engine, g.id("ruins2")), "play");
  assert.equal(attachedCount(g.engine, P1), 4, "2 + 2 resources spent");
});

clause(RUINS, "1:rule", "the recycled Ruins is a blank face-down resource that provides Volition", () => {
  const g = ruinsRecycleBoard();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  playGreed(g, true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
});

clause(RUINS, "1:rule", "the Ruins entering play face-down is not itself a [G] card: no further offer arises", () => {
  const g = ruinsRecycleBoard({ extra: [{ key: "ruins2", def: printing(RUINS), owner: P1, zone: "discard" }], icons: { rage: 8 } });
  developResource(g.engine, P1, g.id("gr"), false);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : declineAll(pc)));
  assert.equal(g.engine.state.pendingChoice, undefined);
});

// --- FLIP UP ---

clause(RUINS, "2:flipUp", "FLIP UP plays the tactic from the face-down resource: the revealed location can be played and a card is drawn", () => {
  const g = ruinsBoard({ ruins: "play", ruinsFaceDown: true, icons: { greed: 3 } });
  assert.equal(cardOf(g.engine, g.id("ruins")).faceDown, true);
  const handBefore = handOf(g.engine, P1).length;
  ruinsFlip(g, true);
  assert.equal(cardOf(g.engine, g.id("fdloc")).faceDown, false, "the location was played");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard", "a resolved tactic goes to its owner's discard pile");
});

clause(RUINS, "2:flipUp", "FLIP UP still needs a face-down location to reveal", () => {
  const g = ruinsBoard({ ruins: "play", ruinsFaceDown: true, fdLoc: false, icons: { greed: 3 } });
  refused(() => flipUpRaw(g.engine, P1, g.id("ruins")), "nothing to reveal");
  assert.equal(cardOf(g.engine, g.id("ruins")).faceDown, true);
});

clause(RUINS, "2:flipUp", "FLIP UP costs 1, and the face-down Ruins can pay for itself (CR 507.4b): it works with no other free resource", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = devBoard([
    { key: "ruins", def: printing(RUINS), owner: P1, zone: "play", faceDown: true },
    { key: "fdloc", def: fdLocation(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...chars("d", 3, P1, "deck"),
    ...spent(2)
  ]);
  assert.equal(ready(g.engine), 1, "control: only the face-down Ruins is free");
  ruinsFlipRaw(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard", "it paid for its own FLIP UP");
});

clause(RUINS, "2:flipUp", "FLIP UP spends no more than 1 resource", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = devBoard([
    { key: "ruins", def: printing(RUINS), owner: P1, zone: "play", faceDown: true },
    { key: "fdloc", def: fdLocation(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...chars("d", 3, P1, "deck"),
    ...spent(2),
    ...res({ rage: 3 })
  ]);
  const spentBefore = attachedCount(g.engine, P1);
  ruinsFlipRaw(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.ok(attachedCount(g.engine, P1) - spentBefore <= 1, "at most 1 more resource was spent");
});

clause(RUINS, "2:flipUp", "FLIP UP needs [G]: refused with plenty of resources but no Greed", () => {
  const none = ruinsBoard({ ruins: "play", ruinsFaceDown: true, icons: { rage: 4 } });
  refused(() => ruinsFlipRaw(none), "no [G]", /threshold/i);
  assert.equal(cardOf(none.engine, none.id("ruins")).faceDown, true);
  const one = ruinsBoard({ ruins: "play", ruinsFaceDown: true, icons: { greed: 1 } });
  ruinsFlip(one, false);
  assert.equal(zoneOf(one.engine, one.id("ruins")), "discard");
});

clause(RUINS, "2:flipUp", "FLIP UP of a tactic works as a response on my opponent's turn", () => {
  const g = ruinsBoard({
    ruins: "play",
    ruinsFaceDown: true,
    icons: { greed: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  const handBefore = handOf(g.engine, P1).length;
  ruinsFlip(g, false);
  assert.equal(handOf(g.engine, P1).length, handBefore + 1);
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
});

// =================================================================================
// Lodge Dock Florist
// UNIQUE LODGE DOCK FLORIST
// All characters gain the rules text "At the start of your turn, you may pay 1. If you don't,
// destroy this card."
// Location (banker), cost 3, [G], structure 2.
// =================================================================================

const FLORIST = "8a4f4138-4326-4029-a0a1-132f879e5531";

function floristBoard(
  opts: {
    florist?: Zone | "none";
    owner?: PlayerId;
    faceDown?: boolean;
    icons?: Icons;
    oppIcons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    spent?: number;
  } = {}
) {
  const spent: CardPlacement[] = opts.spent ? bank("greed", opts.spent, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) : [];
  return devBoard(
    [
      ...(opts.florist === "none" ? [] : [{ key: "fl", def: printing(FLORIST), owner: opts.owner ?? P1, zone: (opts.florist ?? "play") as Zone, faceDown: opts.faceDown }]),
      { key: "a", def: character({ name: "Alpha", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "f", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "keep", def: location({ name: "Keep" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...res(opts.oppIcons ?? { rage: 3 }, P2),
      ...spent,
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type FloristBoard = ReturnType<typeof floristBoard>;

/** Records every upkeep offer: which card is being offered, who is asked, and what they answer. */
interface Offers {
  asked: Array<{ source: string; player: string }>;
}

/** Answer function: pays for exactly the sources in `payFor` (null = pay for all, "none" = pay for none). */
function upkeep(g: FloristBoard, payFor: string[] | "all" | "none", offers: Offers = { asked: [] }) {
  const wanted = payFor === "all" || payFor === "none" ? payFor : new Set(payFor.map((k) => g.id(k)));
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "mayPay") {
      const source = (pc.context as unknown as { sourceId: string }).sourceId;
      offers.asked.push({ source, player: pc.playerId });
      const pay = wanted === "all" ? true : wanted === "none" ? false : wanted.has(source);
      return { kind: "mayPay", pay };
    }
    return declineAll(pc);
  };
}

/** The active player ends their turn; the next turn starts and its start-of-turn offers are answered. */
function nextTurn(g: FloristBoard, answer: (pc: PendingChoiceLike) => unknown): void {
  endTurn(g.engine, g.engine.state.activePlayerId);
  drain(g.engine, answer);
}

// --- UNIQUE ---

clause(FLORIST, "0:unique", "deploying a second Lodge Dock Florist while I control one makes me choose which to keep", () => {
  const g = floristBoard({ icons: { greed: 4 }, extra: [{ key: "fl2", def: printing(FLORIST), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fl2"));
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fl2") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fl2")), "play");
  assert.equal(zoneOf(g.engine, g.id("fl")), "discard");
});

clause(FLORIST, "0:unique", "...and I may keep the old one instead", () => {
  const g = floristBoard({ icons: { greed: 4 }, extra: [{ key: "fl2", def: printing(FLORIST), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fl2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("fl") });
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
  assert.equal(zoneOf(g.engine, g.id("fl2")), "discard");
});

clause(FLORIST, "0:unique", "my opponent may control their own Florist at the same time", () => {
  const g = floristBoard({ turn: 2, active: P2, oppIcons: { rage: 2, greed: 3 }, extra: [{ key: "ofl", def: printing(FLORIST), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("ofl"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ofl")), "play");
  assert.equal(zoneOf(g.engine, g.id("fl")), "play");
});

clause(FLORIST, "0:unique", "taking control of my opponent's Florist while I control one makes me choose, and the game goes on", () => {
  const g = floristBoard({ extra: [{ key: "ofl", def: printing(FLORIST), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("steal"), { selected: { t: [g.id("ofl")] } });
  const pc = expectPending(g.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("ofl") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fl")), "discard");
  assert.equal(cardOf(g.engine, g.id("ofl")).controllerId, P1);
});

clause(FLORIST, "0:unique", "a different UNIQUE designation does not conflict with the Florist", () => {
  const g = floristBoard({ extra: [{ key: "o", def: location({ name: "Other Unique", cost: 0, unique: "other-unique" }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("o"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o")), "play");
});

// --- the granted upkeep ---

clause(FLORIST, "1:rule", "at the start of MY turn each of my characters is offered 'pay 1': paying keeps it, and costs exactly 1 each", () => {
  const g = floristBoard({ icons: { greed: 3 }, oppIcons: {} });
  const offers: Offers = { asked: [] };
  endTurn(g.engine, P1);
  drain(g.engine, upkeep(g, "all", offers)); // their turn: only their character
  const asked = offers.asked.filter((o) => o.player === P1).length;
  assert.equal(asked, 0, "control: my characters are not asked at the start of THEIR turn");
  const mine: Offers = { asked: [] };
  endTurn(g.engine, P2);
  drain(g.engine, upkeep(g, "all", mine));
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.deepEqual(mine.asked.map((o) => o.player), [P1, P1], "I am asked once per character");
  assert.equal(new Set(mine.asked.map((o) => o.source)).size, 2, "for two different characters");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(zoneOf(g.engine, g.id("b")), "play");
  assert.equal(attachedCount(g.engine, P1), 2, "exactly 1 resource per character");
});

clause(FLORIST, "1:rule", "'If you don't, destroy this card': declining destroys that character, which goes to its owner's discard pile", () => {
  const g = floristBoard({ oppIcons: {} });
  nextTurn(g, upkeep(g, "none"));
  nextTurn(g, upkeep(g, "none"));
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(g.engine, g.id("a")), "discard");
  assert.equal(zoneOf(g.engine, g.id("b")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("a")), "discardOf(g.engine, P1).includes(g.id(\"a\"))");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
});

clause(FLORIST, "1:rule", "each character decides on its own: pay for Alpha, let Bravo die", () => {
  const g = floristBoard({ oppIcons: {} });
  nextTurn(g, upkeep(g, "none"));
  nextTurn(g, upkeep(g, ["a"]));
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "Alpha was paid for");
  assert.equal(zoneOf(g.engine, g.id("b")), "discard", "Bravo was not");
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(FLORIST, "1:rule", "the destroyed character is the one that gained the text, no other: items, locations and my opponent's characters survive my upkeep", () => {
  const g = floristBoard({ oppIcons: { rage: 3 } });
  nextTurn(g, upkeep(g, "all")); // their turn: their character pays and stays alive
  nextTurn(g, upkeep(g, "none")); // my turn: I refuse for both
  assert.equal(zoneOf(g.engine, g.id("gear")), "play", "my item is not destroyed");
  assert.equal(zoneOf(g.engine, g.id("keep")), "play", "their location is not destroyed");
  assert.equal(zoneOf(g.engine, g.id("f")), "play", "their character was only offered at the start of THEIR turn");
});

clause(FLORIST, "1:rule", "with no free resource to pay with, the character is destroyed", () => {
  const g = floristBoard({ icons: {}, oppIcons: {} });
  nextTurn(g, upkeep(g, "all"));
  nextTurn(g, upkeep(g, "all"));
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(g.engine, g.id("a")), "discard");
  assert.equal(zoneOf(g.engine, g.id("b")), "discard");
});

clause(FLORIST, "1:rule", "with one free resource for two characters, one is paid for and the other is destroyed", () => {
  const g = floristBoard({ icons: { greed: 1 }, oppIcons: {} });
  nextTurn(g, upkeep(g, "all"));
  nextTurn(g, upkeep(g, "all"));
  const alive = ["a", "b"].filter((k) => zoneOf(g.engine, g.id(k)) === "play");
  assert.equal(alive.length, 1, "only one character could be paid for");
  assert.equal(attachedCount(g.engine, P1), 1);
});

clause(FLORIST, "1:rule", "the upkeep comes after the restore rule: resources I spent last turn are free again to pay with", () => {
  const g = floristBoard({ icons: {}, oppIcons: {}, spent: 2 });
  assert.equal(ready(g.engine), 0, "control: all my resources are spent now");
  nextTurn(g, upkeep(g, "all"));
  nextTurn(g, upkeep(g, "all"));
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "paid with a restored resource");
  assert.equal(zoneOf(g.engine, g.id("b")), "play");
});

clause(FLORIST, "1:rule", "it is not 'at the start of every turn': nothing is asked at the start of my OPPONENT's turn about my characters, and none are destroyed", () => {
  const g = floristBoard({ oppIcons: {} });
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "none", offers));
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(offers.asked.filter((o) => o.player === P1).length, 0, "I was asked nothing");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(zoneOf(g.engine, g.id("b")), "play");
});

clause(FLORIST, "1:rule", "'All characters': my OPPONENT's characters gain it too, and THEY are asked at the start of THEIR turn", () => {
  const g = floristBoard({ oppIcons: { rage: 3 } });
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "all", offers));
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(offers.asked.map((o) => o.player), [P2], "their one character, asked of them");
  assert.equal(offers.asked[0].source, g.id("f"));
  assert.equal(zoneOf(g.engine, g.id("f")), "play");
  assert.equal(attachedCount(g.engine, P2), 1, "they paid 1");
});

clause(FLORIST, "1:rule", "my opponent's character is destroyed if THEY decline, going to their discard pile", () => {
  const g = floristBoard({ oppIcons: { rage: 3 } });
  nextTurn(g, upkeep(g, "none"));
  assert.equal(zoneOf(g.engine, g.id("f")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("f")), "discardOf(g.engine, P2).includes(g.id(\"f\"))");
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "mine are not asked now");
});

clause(FLORIST, "1:rule", "an opposing Florist makes MY characters pay at the start of MY turn too", () => {
  const g = floristBoard({ florist: "none", owner: P2, extra: [{ key: "ofl", def: printing(FLORIST), owner: P2, zone: "play" }] });
  nextTurn(g, upkeep(g, "all"));
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "all", offers));
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(offers.asked.filter((o) => o.player === P1).length, 2, "both of mine are asked");
});

clause(FLORIST, "1:rule", "a character that enters play after the Florist gains the text as well", () => {
  const g = floristBoard({ oppIcons: {}, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play", "control: it entered play");
  nextTurn(g, upkeep(g, "none"));
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "none", offers));
  assert.equal(offers.asked.length, 3, "Alpha, Bravo and the newcomer are all asked");
  assert.equal(zoneOf(g.engine, g.id("newbie")), "discard");
});

clause(FLORIST, "1:rule", "a character I control but do not own: I am asked at the start of MY turn, and it goes to its owner's discard pile if I refuse", () => {
  const g = floristBoard({ oppIcons: {}, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  nextTurn(g, upkeep(g, "none"));
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, ["a", "b"], offers));
  const stolenOffers = offers.asked.filter((o) => o.source === g.id("stolen"));
  assert.equal(stolenOffers.length, 1);
  assert.equal(stolenOffers[0].player, P1, "its controller is asked");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("stolen")), "its owner's discard pile");
});

clause(FLORIST, "1:rule", "face-down cards are not characters and have no rules text: they gain nothing and are never asked", () => {
  const g = floristBoard({ oppIcons: {}, extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }] });
  nextTurn(g, upkeep(g, "none"));
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "none", offers));
  assert.equal(offers.asked.length, 2, "only Alpha and Bravo");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
});

clause(FLORIST, "1:rule", "when the Florist leaves play the characters lose the text: nobody is asked any more", () => {
  const wrecker = tactic({
    name: "Wrecking Ball",
    cost: 0,
    behavior: { abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g2 = floristBoard({ oppIcons: {}, extra: [{ key: "ball", def: wrecker, owner: P1, zone: "hand" }] });
  play(g2.engine, P1, g2.id("ball"), { selected: { t: [g2.id("fl")] } });
  assert.equal(zoneOf(g2.engine, g2.id("fl")), "discard", "control: the Florist was destroyed");
  const offers: Offers = { asked: [] };
  nextTurn(g2, upkeep(g2, "none", offers));
  nextTurn(g2, upkeep(g2, "none", offers));
  assert.equal(offers.asked.length, 0, "no offers");
  assert.equal(zoneOf(g2.engine, g2.id("a")), "play");
  assert.equal(zoneOf(g2.engine, g2.id("b")), "play");
  assert.equal(zoneOf(g2.engine, g2.id("f")), "play");
});

clause(FLORIST, "1:rule", "a face-down Florist has no rules text (CR 411.1): characters gain nothing", () => {
  const g = floristBoard({ faceDown: true, oppIcons: {} });
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "none", offers));
  nextTurn(g, upkeep(g, "none", offers));
  assert.equal(offers.asked.length, 0);
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
});

clause(FLORIST, "1:rule", "each Florist grants the text once: with both players' Florists in play every character gains it twice and is offered the upkeep twice", () => {
  const g = floristBoard({ oppIcons: { rage: 3 }, extra: [{ key: "ofl", def: printing(FLORIST), owner: P2, zone: "play" }], icons: { greed: 4 } });
  nextTurn(g, upkeep(g, "all"));
  const offers: Offers = { asked: [] };
  nextTurn(g, upkeep(g, "all", offers));
  assert.equal(g.engine.state.activePlayerId, P1);
  const forAlpha = offers.asked.filter((o) => o.source === g.id("a")).length;
  assert.equal(forAlpha, 2, "two copies of the text on Alpha: two offers");
});

clause(FLORIST, "1:rule", "'pay 1' means attaching a free resource to my faction", () => {
  const g = floristBoard({ icons: { greed: 3 }, oppIcons: {} });
  nextTurn(g, upkeep(g, "all"));
  nextTurn(g, upkeep(g, ["a"]));
  assert.equal(attachedCount(g.engine, P1), 1);
  assert.equal(ready(g.engine), 2);
});

// =================================================================================
// Melty Cheese
// ATTACH TO CHARACTER
// The attached character gains 2 life and cannot attack.
// FLIP UP: 2 [G] and your faction gains 4 influence.
// Item (banker; gear), cost 2, [G].
// =================================================================================

const CHEESE = "b3a12b5c-893f-40bc-8967-8ce2eb2cd9af";

function cheeseBoard(
  opts: {
    cheese?: Zone | "attached";
    host?: string;
    faceDown?: boolean;
    icons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    owner?: PlayerId;
    controller?: PlayerId;
  } = {}
) {
  const where = opts.cheese ?? "hand";
  return devBoard(
    [
      {
        key: "ch",
        def: printing(CHEESE),
        owner: opts.owner ?? P1,
        controller: opts.controller,
        zone: where === "attached" ? "play" : where,
        faceDown: opts.faceDown,
        attachedToKey: where === "attached" ? opts.host ?? "mine" : undefined
      },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type CheeseBoard = ReturnType<typeof cheeseBoard>;
const cheesePlayRaw = (g: CheeseBoard, host: string) => playRaw(g.engine, P1, g.id("ch"), { selected: { attachTo: [g.id(host)] } });
const cheesePlay = (g: CheeseBoard, host: string) => play(g.engine, P1, g.id("ch"), { selected: { attachTo: [g.id(host)] } });
const cheeseFlipRaw = (g: CheeseBoard, host: string, player: PlayerId = P1) => flipUpRaw(g.engine, player, g.id("ch"), { attachTo: [g.id(host)] });
const cheeseFlip = (g: CheeseBoard, host: string) => {
  cheeseFlipRaw(g, host);
  resolvePendingResponses(g.engine);
};
const cheeseLife = (g: CheeseBoard, key: string) => g.engine.getStat(g.id(key), "life");
const attackWith = (g: CheeseBoard, player: PlayerId, keys: string[]) =>
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: keys.map((k) => g.id(k)), target: { type: "faction", playerId: other(player) } });

const CHEESE_BAD_HOSTS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "it", why: "an item", extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] },
  { key: "loc", why: "a location", extra: [{ key: "loc", def: location({ name: "Hovel" }), owner: P2, zone: "play" }] },
  { key: "rs", why: "a face-up resource", extra: [{ key: "rs", def: stapleCard("Rage", "rage"), owner: P2, zone: "play" }] },
  { key: "fd", why: "a face-down card (a resource, even a really-a-character one)", extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] },
  { key: "hd", why: "a character card in a hand", extra: [{ key: "hd", def: character({ name: "Handy" }), owner: P2, zone: "hand" }] },
  { key: "dc", why: "a character card in a discard pile", extra: [{ key: "dc", def: character({ name: "Dusty" }), owner: P2, zone: "discard" }] }
];

// --- ATTACH TO CHARACTER ---

clause(CHEESE, "0:attach", "deployed, the Cheese enters play attached to the character I picked", () => {
  const g = cheeseBoard();
  cheesePlay(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("ch"));
  assert.equal(card.zone, "play");
  assert.equal(card.attachedTo, g.id("mine"));
  assert.deepEqual(g.engine.getCardTypes(g.id("ch")), ["item"]);
  assert.equal(cardOf(g.engine, g.id("ally")).attachedTo, undefined, "control: no other character got it");
});

clause(CHEESE, "0:attach", "it can attach to any character: my opponent's too", () => {
  const g = cheeseBoard();
  cheesePlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("ch")).attachedTo, g.id("foe"));
  assert.equal(cardOf(g.engine, g.id("ch")).controllerId, P1, "I still control the Cheese");
});

for (const bad of CHEESE_BAD_HOSTS) {
  clause(CHEESE, "0:attach", `cannot attach to ${bad.why}`, () => {
    const g = cheeseBoard({ extra: bad.extra });
    refused(() => cheesePlayRaw(g, bad.key), `attaching to ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("ch")), "hand", "nothing was played");
    assert.equal(ready(g.engine), 3, "nothing was paid");
    const control = cheeseBoard({ extra: bad.extra });
    cheesePlay(control, "foe");
    assert.equal(cardOf(control.engine, control.id("ch")).attachedTo, control.id("foe"), "control: a character host works on the same board");
  });
}

clause(CHEESE, "0:attach", "cannot attach to a faction", () => {
  const g = cheeseBoard();
  refused(() => playRaw(g.engine, P1, g.id("ch"), { selected: { attachTo: [g.engine.state.players[P2].factionId!] } }), "their faction");
  const mine = cheeseBoard();
  refused(() => playRaw(mine.engine, P1, mine.id("ch"), { selected: { attachTo: [mine.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand");
});

clause(CHEESE, "0:attach", "picking the host is part of playing it: with no pick it cannot be played", () => {
  const g = cheeseBoard();
  refused(() => playRaw(g.engine, P1, g.id("ch")), "no host picked");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand");
});

clause(CHEESE, "0:attach", "with no character in play there is no legal target: it cannot be played", () => {
  const g = devBoard([{ key: "ch", def: printing(CHEESE), owner: P1, zone: "hand" }, ...res({ greed: 3 })]);
  refused(() => playRaw(g.engine, P1, g.id("ch")), "no characters in play");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand");
});

clause(CHEESE, "0:attach", "costs exactly 2 and needs [G]: refused one resource short or without Greed", () => {
  const short = cheeseBoard({ icons: { greed: 1 } });
  refused(() => cheesePlayRaw(short, "mine"), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("ch")), "hand");
  const noGreed = cheeseBoard({ icons: { rage: 4 } });
  refused(() => cheesePlayRaw(noGreed, "mine"), "no [G]", /threshold/i);
  const ok = cheeseBoard({ icons: { greed: 4 } });
  const before = ready(ok.engine);
  cheesePlay(ok, "mine");
  assert.equal(before - ready(ok.engine), 2);
});

clause(CHEESE, "0:attach", "an item is deployed on my turn only: refused in a response on my opponent's turn", () => {
  const g = cheeseBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => cheesePlayRaw(g, "mine"), "an item cannot be deployed on their turn");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand");
});

clause(CHEESE, "0:attach", "if the host is gone when the Cheese would enter play, it is put into its owner's discard pile (CR 507.2c)", () => {
  const g = cheeseBoard({ icons: { greed: 3 }, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  cheesePlayRaw(g, "foe");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "control: the host was destroyed in response");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "the Cheese goes to its owner's discard pile");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(CHEESE, "0:attach", "when the host is destroyed the Cheese leaves play with it: into its owner's discard pile (CR 301.4)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ch")), "my Cheese is in MY discard pile");
});

clause(CHEESE, "0:attach", "when the host is put into its owner's hand the Cheese leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe", extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand", "the Cheese follows its host to a hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("ch")), "its owner's hand (mine)");
});

clause(CHEESE, "0:attach", "when the host is removed from the game the Cheese leaves play the same way: removed from the game (CR 301.4a)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "removed");
  assert.equal(zoneOf(g.engine, g.id("ch")), "removed", "the Cheese follows its host out of the game");
});

clause(CHEESE, "0:attach", "if the host stops being a character (flipped face-down) the Cheese is flipped face-down with it", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe", extra: [{ key: "fd", def: flipDownTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fd"), { selected: { t: [g.id("foe")] } });
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true, "control: the host is a face-down resource now");
  assert.equal(zoneOf(g.engine, g.id("ch")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, true, "...and is flipped face-down along with its host");
});

// --- The attached character gains 2 life and cannot attack ---

clause(CHEESE, "1:rule", "the attached character gains 2 life (mine: 3 -> 5)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine" });
  assert.equal(cheeseLife(g, "mine"), 5);
});

clause(CHEESE, "1:rule", "...and an opposing host too (4 -> 6)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe" });
  assert.equal(cheeseLife(g, "foe"), 6);
});

clause(CHEESE, "1:rule", "only the attached character is affected: other characters keep their life and can attack", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine" });
  assert.equal(cheeseLife(g, "ally"), 3);
  assert.equal(cheeseLife(g, "foe"), 4);
  assert.equal(g.engine.getRestrictions(g.id("ally")).includes("cannotAttack"), false);
  attackWith(g, P1, ["ally"]);
  assert.ok(battleOf(g.engine), "control: the unattached sibling attacks");
});

clause(CHEESE, "1:rule", "the attached character cannot attack (and the same character can without the Cheese)", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine" });
  assert.ok(g.engine.getRestrictions(g.id("mine")).includes("cannotAttack"), "g.engine.getRestrictions(g.id(\"mine\")).includes(\"cannotAttack\")");
  refused(() => attackWith(g, P1, ["mine"]), "the attached character cannot attack");
  assert.equal(battleOf(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("mine")).depleted, false);
  const without = cheeseBoard({ cheese: "hand" });
  attackWith(without, P1, ["mine"]);
  assert.ok(battleOf(without.engine), "control: without the Cheese it attacks");
});

clause(CHEESE, "1:rule", "a party containing the attached character cannot attack", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine" });
  refused(() => attackWith(g, P1, ["mine", "ally"]), "a party with a character that cannot attack");
  assert.equal(battleOf(g.engine), undefined);
});

clause(CHEESE, "1:rule", "an opposing character with my Cheese cannot attack on their turn", () => {
  const g = cheeseBoard({ cheese: "attached", host: "foe", turn: 2, active: P2 });
  refused(() => attackWith(g, P2, ["foe"]), "their attached character cannot attack");
  const without = cheeseBoard({ cheese: "hand", turn: 2, active: P2 });
  attackWith(without, P2, ["foe"]);
  assert.ok(battleOf(without.engine), "control");
});

clause(CHEESE, "1:rule", "it only stops ATTACKING: the attached character can still block", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine", turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  declareBlockers(g.engine, P1, [g.id("mine")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("mine")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "2 damage against 5 life");
  assert.equal(cardOf(g.engine, g.id("mine")).damage, 2);
});

clause(CHEESE, "1:rule", "the extra 2 life is real: it survives damage that would have destroyed it", () => {
  const board = () => cheeseBoard({ cheese: "attached", host: "mine", extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  const g = board();
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "4 damage against 5 life");
  const without = cheeseBoard({ cheese: "hand", extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("zap"), { selected: { t: [without.id("mine")] } });
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control: 4 damage against 3 life");
});

clause(CHEESE, "1:rule", "two Cheeses on one character give +4 life", () => {
  const g = cheeseBoard({ cheese: "attached", host: "mine", extra: [{ key: "ch2", def: printing(CHEESE), owner: P1, zone: "play", attachedToKey: "mine" }] });
  assert.equal(cheeseLife(g, "mine"), 7);
  assert.ok(g.engine.getRestrictions(g.id("mine")).includes("cannotAttack"), "g.engine.getRestrictions(g.id(\"mine\")).includes(\"cannotAttack\")");
});

clause(CHEESE, "1:rule", "when the Cheese leaves play the host loses the 2 life and can attack again", () => {
  const smash = tactic({
    name: "Smash Item",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = cheeseBoard({ cheese: "attached", host: "mine", extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("ch")] } });
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "control: the Cheese was destroyed");
  assert.equal(cheeseLife(g, "mine"), 3);
  attackWith(g, P1, ["mine"]);
  assert.ok(battleOf(g.engine), "battleOf(g.engine)");
});

clause(CHEESE, "1:rule", "the +2 life ends with the Cheese: a host with 4 damage is destroyed when it is removed", () => {
  const smash = tactic({
    name: "Smash Item",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = cheeseBoard({ cheese: "attached", host: "mine", extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  g.engine.state.cards[g.id("mine")].damage = 4;
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("ch")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "4 damage on a 3-life character");
});

clause(CHEESE, "1:rule", "a face-down Cheese in play is a blank resource: it gives its neighbours nothing", () => {
  const g = cheeseBoard({ cheese: "play", faceDown: true });
  assert.equal(cheeseLife(g, "mine"), 3);
  assert.equal(g.engine.getRestrictions(g.id("mine")).includes("cannotAttack"), false);
});

// --- FLIP UP ---

clause(CHEESE, "2:flipUp", "FLIP UP: the face-down Cheese is played attached to the character I pick and stays in play", () => {
  const g = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 3 } });
  cheeseFlip(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("ch"));
  assert.equal(card.zone, "play", "an item that resolves is put into play");
  assert.equal(card.faceDown, false);
  assert.equal(card.attachedTo, g.id("mine"));
  assert.equal(cheeseLife(g, "mine"), 5, "its rule works");
  assert.ok(g.engine.getRestrictions(g.id("mine")).includes("cannotAttack"), "g.engine.getRestrictions(g.id(\"mine\")).includes(\"cannotAttack\")");
});

clause(CHEESE, "2:flipUp", "FLIP UP: 'and your faction gains 4 influence': my faction goes up by exactly 4", () => {
  const g = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 3 } });
  const before = influenceOf(g.engine, P1);
  cheeseFlip(g, "mine");
  assert.equal(influenceOf(g.engine, P1), before + 4);
  assert.equal(influenceOf(g.engine, P2), START, "control: their faction is untouched");
});

clause(CHEESE, "2:flipUp", "FLIP UP: the 4 influence only comes with FLIP UP: deploying the Cheese from the hand gains nothing", () => {
  const g = cheeseBoard();
  cheesePlay(g, "mine");
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(CHEESE, "2:flipUp", "FLIP UP can attach to my opponent's character too, and I still gain the influence", () => {
  const g = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 3 } });
  cheeseFlip(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("ch")), "play", "the Cheese is in play");
  assert.equal(cardOf(g.engine, g.id("ch")).attachedTo, g.id("foe"));
  assert.equal(influenceOf(g.engine, P1), START + 4);
});

clause(CHEESE, "2:flipUp", "FLIP UP costs exactly 2: refused with 1 free resource, accepted with 2", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = cheeseBoard({ cheese: "play", faceDown: true, icons: {}, extra: spent(2) });
  assert.equal(ready(short.engine), 1, "control: only the face-down Cheese is free");
  refused(() => cheeseFlipRaw(short, "mine"), "1 free resource for FLIP UP 2");
  assert.equal(cardOf(short.engine, short.id("ch")).faceDown, true);
  assert.equal(influenceOf(short.engine, P1), START);
  const exact = cheeseBoard({ cheese: "play", faceDown: true, icons: {}, extra: [...spent(2), ...res({ rage: 1 })] });
  assert.equal(ready(exact.engine), 2);
  cheeseFlip(exact, "mine");
  assert.equal(cardOf(exact.engine, exact.id("ch")).faceDown, false);
  assert.equal(ready(exact.engine), 0);
});

clause(CHEESE, "2:flipUp", "FLIP UP needs [G]: refused with plenty of resources but no Greed", () => {
  const none = cheeseBoard({ cheese: "play", faceDown: true, icons: { rage: 4 } });
  refused(() => cheeseFlipRaw(none, "mine"), "no [G]", /threshold/i);
  assert.equal(cardOf(none.engine, none.id("ch")).faceDown, true);
  assert.equal(influenceOf(none.engine, P1), START);
  const one = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 1, rage: 2 } });
  cheeseFlip(one, "mine");
  assert.equal(cardOf(one.engine, one.id("ch")).faceDown, false);
});

clause(CHEESE, "2:flipUp", "FLIP UP still needs a host to attach to (a character)", () => {
  const none = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 3 } });
  refused(() => flipUpRaw(none.engine, P1, none.id("ch")), "no host picked");
  assert.equal(cardOf(none.engine, none.id("ch")).faceDown, true);
  assert.equal(influenceOf(none.engine, P1), START, "no influence without a successful FLIP UP");
  const loc = cheeseBoard({ cheese: "play", faceDown: true, icons: { greed: 3 }, extra: [{ key: "loc", def: location({ name: "Hovel" }), owner: P2, zone: "play" }] });
  refused(() => cheeseFlipRaw(loc, "loc"), "a location is not a character");
});

clause(CHEESE, "2:flipUp", "FLIP UP of an item does not change when it may be deployed (CR 507.4d): refused on my opponent's turn", () => {
  const g = cheeseBoard({
    cheese: "play",
    faceDown: true,
    icons: { greed: 3 },
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  refused(() => cheeseFlipRaw(g, "mine"), "an item cannot be deployed on my opponent's turn");
  assert.equal(cardOf(g.engine, g.id("ch")).faceDown, true);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(CHEESE, "2:flipUp", "FLIP UP is only for my own face-down card: not from the hand, not my opponent's", () => {
  const inHand = cheeseBoard({ cheese: "hand", icons: { greed: 3 } });
  refused(() => cheeseFlipRaw(inHand, "mine"), "in the hand");
  const theirs = cheeseBoard({ cheese: "play", faceDown: true, owner: P2, icons: { greed: 3 } });
  refused(() => cheeseFlipRaw(theirs, "mine"), "their face-down card");
  assert.equal(influenceOf(theirs.engine, P1), START);
});

// =================================================================================
// Miraculous Regeneration
// COST: Pick 2 characters in your discard pile.
// EFFECT: Put 1 of the characters into play under your control as a face-down resource. Put the
// other character into your hand.
// Tactic (banker), cost 3, [G].
// =================================================================================

const REGEN = "5df56b56-1925-4958-ba48-67ab47781ff1";

function regenBoard(
  opts: {
    regen?: Zone;
    icons?: Icons;
    chars?: number;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  return devBoard(
    [
      { key: "rg", def: printing(REGEN), owner: P1, zone: opts.regen ?? "hand" },
      ...chars("c", opts.chars ?? 4, P1, "discard"),
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type RegenBoard = ReturnType<typeof regenBoard>;
const regenArgs = (g: RegenBoard, a: string, b: string) => ({ selected: { toPlay: [g.id(a)], toHand: [g.id(b)] } });
const regenPlay = (g: RegenBoard, a: string, b: string) => play(g.engine, P1, g.id("rg"), regenArgs(g, a, b));
const regenRaw = (g: RegenBoard, a: string, b: string) => playRaw(g.engine, P1, g.id("rg"), regenArgs(g, a, b));

const REGEN_BAD: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "tac", why: "a tactic in my discard pile", extra: [{ key: "tac", def: tactic({ name: "Old Tactic" }), owner: P1, zone: "discard" }] },
  { key: "it", why: "an item in my discard pile", extra: [{ key: "it", def: item({ name: "Old Item" }), owner: P1, zone: "discard" }] },
  { key: "loc", why: "a location in my discard pile", extra: [{ key: "loc", def: location({ name: "Old Place" }), owner: P1, zone: "discard" }] },
  { key: "rsc", why: "a resource in my discard pile", extra: [{ key: "rsc", def: stapleCard("Rage", "rage"), owner: P1, zone: "discard" }] },
  { key: "ochar", why: "a character in my OPPONENT's discard pile", extra: [{ key: "ochar", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" }] },
  { key: "hchar", why: "a character card in my hand", extra: [{ key: "hchar", def: character({ name: "Handy" }), owner: P1, zone: "hand" }] },
  { key: "dchar", why: "a character card in my deck", extra: [{ key: "dchar", def: character({ name: "Deckard" }), owner: P1, zone: "deck" }] },
  { key: "mine", why: "a character in play", extra: [] },
  { key: "xchar", why: "a character removed from the game", extra: [{ key: "xchar", def: character({ name: "Gone" }), owner: P1, zone: "removed" }] }
];

clause(REGEN, "0:ability", "one picked character is put into play under my control as a face-down resource", () => {
  const g = regenBoard();
  regenPlay(g, "c0", "c1");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("c0"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.deepEqual(g.engine.getCardTypes(g.id("c0")), ["resource"]);
  assert.ok(playOf(g.engine, P1).includes(g.id("c0")), "playOf(g.engine, P1).includes(g.id(\"c0\"))");
});

clause(REGEN, "0:ability", "the other picked character is put into my hand (face-up, in the hand)", () => {
  const g = regenBoard();
  regenPlay(g, "c0", "c1");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("c1")), "handOf(g.engine, P1).includes(g.id(\"c1\"))");
  assert.equal(cardOf(g.engine, g.id("c1")).faceDown, false);
});

clause(REGEN, "0:ability", "'1 of the characters ... the other': exactly one goes into play and exactly one into the hand, whichever way round I pick", () => {
  for (const [a, b] of [["c0", "c1"], ["c1", "c0"], ["c2", "c3"]] as const) {
    const g = regenBoard();
    regenPlay(g, a, b);
    const zones = [zoneOf(g.engine, g.id(a)), zoneOf(g.engine, g.id(b))].sort();
    assert.deepEqual(zones, ["hand", "play"], `${a},${b}: one in play and one in hand`);
    const inPlay = zoneOf(g.engine, g.id(a)) === "play" ? a : b;
    assert.equal(cardOf(g.engine, g.id(inPlay)).faceDown, true, "the one in play is face-down");
    const inHand = inPlay === a ? b : a;
    assert.equal(zoneOf(g.engine, g.id(inHand)), "hand");
  }
});

clause(REGEN, "0:ability", "no other card moves: the rest of my discard pile stays, and my opponent's cards are untouched", () => {
  const g = regenBoard({ extra: [{ key: "ochar", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" }] });
  regenPlay(g, "c0", "c1");
  for (const key of ["c2", "c3"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} stays`);
  assert.equal(zoneOf(g.engine, g.id("ochar")), "discard");
  assert.equal(handOf(g.engine, P1).length, 1, "only one card entered my hand");
});

clause(REGEN, "0:ability", "the face-down character is a new Volition resource that I can pay with", () => {
  const g = regenBoard();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  const readyBefore = ready(g.engine);
  regenPlay(g, "c0", "c1");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
  assert.equal(readyBefore - ready(g.engine), 3 - 1, "paid 3, and gained one free face-down resource");
});

clause(REGEN, "0:ability", "a face-down character has no rules text: its 'enters play' trigger does not fire", () => {
  const newsie = character({
    name: "Newsie",
    behavior: { abilities: [{ id: "news", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
  });
  const g = regenBoard({ extra: [{ key: "news", def: newsie, owner: P1, zone: "discard" }] });
  regenPlay(g, "news", "c0");
  assert.equal(cardOf(g.engine, g.id("news")).faceDown, true, "control: it entered play face-down");
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(REGEN, "0:ability", "the tactic costs exactly 3 and ends in my discard pile", () => {
  const g = regenBoard({ icons: { greed: 6 } });
  const before = ready(g.engine);
  regenRaw(g, "c0", "c1");
  assert.equal(before - ready(g.engine), 3, "paid on playing, before responses");
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("c0")), "discard", "nothing has moved yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
});

clause(REGEN, "0:ability", "costs 3: refused with 2 resources even with [G]; accepted with exactly 3", () => {
  const short = regenBoard({ icons: { greed: 2 } });
  refused(() => regenRaw(short, "c0", "c1"), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("rg")), "hand");
  assert.equal(zoneOf(short.engine, short.id("c0")), "discard");
  const ok = regenBoard({ icons: { greed: 3 } });
  regenPlay(ok, "c0", "c1");
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "hand");
});

clause(REGEN, "0:ability", "needs [G]: refused with plenty of resources but no Greed", () => {
  const g = regenBoard({ icons: { rage: 5 } });
  refused(() => regenRaw(g, "c0", "c1"), "no [G]", /threshold/i);
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  const ok = regenBoard({ icons: { greed: 1, rage: 2 } });
  regenPlay(ok, "c0", "c1");
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "hand");
});

clause(REGEN, "0:ability", "needs two picks: one pick alone is refused", () => {
  const g = regenBoard();
  refused(() => playRaw(g.engine, P1, g.id("rg"), { selected: { toPlay: [g.id("c0")] } }), "only one character");
  const g2 = regenBoard();
  refused(() => playRaw(g2.engine, P1, g2.id("rg"), { selected: { toHand: [g2.id("c0")] } }), "only one character");
  const g3 = regenBoard();
  refused(() => playRaw(g3.engine, P1, g3.id("rg")), "no picks");
  assert.equal(zoneOf(g3.engine, g3.id("rg")), "hand");
  assert.equal(ready(g3.engine), 4);
});

clause(REGEN, "0:ability", "'2 characters': the same card cannot be picked twice", () => {
  const g = regenBoard();
  refused(() => regenRaw(g, "c0", "c0"), "the same character twice");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  assert.equal(ready(g.engine), 4);
});

clause(REGEN, "0:ability", "more than two characters cannot be picked", () => {
  const g = regenBoard();
  refused(() => playRaw(g.engine, P1, g.id("rg"), { selected: { toPlay: [g.id("c0"), g.id("c1")], toHand: [g.id("c2")] } }), "three characters");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
});

clause(REGEN, "0:ability", "with fewer than two characters in my discard pile it cannot be played", () => {
  const g = regenBoard({ chars: 1 });
  refused(() => regenRaw(g, "c0", "mine"), "only one character in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  const none = regenBoard({ chars: 0 });
  refused(() => playRaw(none.engine, P1, none.id("rg")), "none");
});

for (const bad of REGEN_BAD) {
  clause(REGEN, "0:ability", `cannot pick ${bad.why} (as either pick)`, () => {
    const as1 = regenBoard({ extra: bad.extra });
    refused(() => regenRaw(as1, bad.key, "c1"), `${bad.why} as the first pick`);
    assert.equal(zoneOf(as1.engine, as1.id("rg")), "hand");
    assert.equal(ready(as1.engine), 4, "nothing was paid");
    const as2 = regenBoard({ extra: bad.extra });
    refused(() => regenRaw(as2, "c0", bad.key), `${bad.why} as the second pick`);
    assert.equal(zoneOf(as2.engine, as2.id("rg")), "hand");
    const control = regenBoard({ extra: bad.extra });
    regenPlay(control, "c0", "c1");
    assert.equal(zoneOf(control.engine, control.id("c1")), "hand", "control: legal picks work on the same board");
  });
}

clause(REGEN, "0:ability", "a stolen-and-destroyed character that I own can be picked from MY discard pile (discard piles are the owner's)", () => {
  const g = regenBoard({ extra: [{ key: "mineDead", def: character({ name: "Mine Dead" }), owner: P1, zone: "discard" }] });
  regenPlay(g, "mineDead", "c0");
  assert.equal(zoneOf(g.engine, g.id("mineDead")), "play");
  assert.equal(cardOf(g.engine, g.id("mineDead")).faceDown, true);
});

clause(REGEN, "0:ability", "it is a tactic: it can be played in response on my opponent's turn", () => {
  const g = regenBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("rg"), { toPlay: [g.id("c0")], toHand: [g.id("c1")] });
  assert.equal(zoneOf(g.engine, g.id("c0")), "play");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
});

clause(REGEN, "0:ability", "a picked character that left the discard pile in response is not pulled back (CR 402.4): the other pick still resolves", () => {
  const g = regenBoard({ extra: [{ key: "mv", def: moverTactic("discard", "deck"), owner: P2, zone: "hand" }] });
  regenRaw(g, "c0", "c1");
  respondWith(g.engine, P2, g.id("mv"), { t: [g.id("c0")] });
  assert.equal(zoneOf(g.engine, g.id("c0")), "deck", "control: c0 was moved to my deck in response");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the other pick still goes to my hand");
});

clause(REGEN, "0:ability", "the second pick leaving the discard pile in response: the first pick still enters play face-down", () => {
  const g = regenBoard({ extra: [{ key: "mv", def: moverTactic("discard", "hand"), owner: P2, zone: "hand" }] });
  regenRaw(g, "c0", "c1");
  respondWith(g.engine, P2, g.id("mv"), { t: [g.id("c1")] });
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "control: c1 was moved to its owner's hand in response");
  assert.equal(zoneOf(g.engine, g.id("c0")), "play");
  assert.equal(cardOf(g.engine, g.id("c0")).faceDown, true);
});

// =================================================================================
// Overzealous Excavation
// Put the top 8 cards of your deck into your discard pile. Draw a card.
// RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card
// from the game. Pick a card in your discard pile.
// EFFECT: Put the card into play under your control as a face-down resource.
// Tactic (banker), cost 3, [G].
// =================================================================================

const EXCAVATION = "65d782aa-becf-4d04-8be1-2da121a27c7e";

function exBoard(
  opts: {
    ex?: Zone;
    owner?: PlayerId;
    icons?: Icons;
    deck?: number;
    discard?: boolean;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const discard: CardPlacement[] = opts.discard === false ? [] : [
    { key: "dc0", def: character({ name: "Dead Character" }), owner: P1, zone: "discard" },
    { key: "dc1", def: tactic({ name: "Dead Tactic" }), owner: P1, zone: "discard" },
    { key: "dc2", def: item({ name: "Dead Item" }), owner: P1, zone: "discard" },
    { key: "dc3", def: location({ name: "Dead Place" }), owner: P1, zone: "discard" },
    { key: "dc4", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" }
  ];
  return devBoard(
    [
      { key: "ex", def: printing(EXCAVATION), owner: opts.owner ?? P1, zone: opts.ex ?? "hand" },
      ...chars("d", opts.deck ?? 12, P1, "deck"),
      ...chars("od", 5, P2, "deck"),
      ...discard,
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ExBoard = ReturnType<typeof exBoard>;
const exPlay = (g: ExBoard) => play(g.engine, P1, g.id("ex"));
const exRecurRaw = (g: ExBoard, pick: string, player: PlayerId = P1) => actRaw(g.engine, player, g.id("ex"), "excavation-recur", { pick: [g.id(pick)] });
const exRecur = (g: ExBoard, pick: string) => activate(g.engine, P1, g.id("ex"), "excavation-recur", { selected: { pick: [g.id(pick)] } });
const DECK_KEYS = Array.from({ length: 12 }, (_, i) => `d${i}`);

clause(EXCAVATION, "0:rule", "the top 8 cards of my deck are put into my discard pile", () => {
  const g = exBoard();
  exPlay(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of DECK_KEYS.slice(0, 8)) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} (one of the top 8)`);
});

clause(EXCAVATION, "0:rule", "exactly 8: the 9th and later cards are not milled", () => {
  const g = exBoard();
  exPlay(g);
  for (const key of DECK_KEYS.slice(9)) assert.equal(zoneOf(g.engine, g.id(key)), "deck", `${key} stays in the deck`);
});

clause(EXCAVATION, "0:rule", "then I draw a card: the card drawn is the one that was 9th from the top, not one of the milled cards", () => {
  const g = exBoard();
  exPlay(g);
  assert.equal(zoneOf(g.engine, g.id("d8")), "hand", "the 9th card is drawn after the mill");
  assert.deepEqual(handOf(g.engine, P1), [g.id("d8")], "and nothing else");
});

clause(EXCAVATION, "0:rule", "the Excavation itself ends in my discard pile (9 new cards there: 8 milled and the tactic)", () => {
  const g = exBoard({ discard: false });
  exPlay(g);
  assert.equal(discardOf(g.engine, P1).length, 9);
  assert.ok(discardOf(g.engine, P1).includes(g.id("ex")), "discardOf(g.engine, P1).includes(g.id(\"ex\"))");
});

clause(EXCAVATION, "0:rule", "it only affects MY deck: my opponent's deck, hand and discard pile are untouched", () => {
  const g = exBoard();
  const oppDeck = deckOf(g.engine, P2);
  exPlay(g);
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  assert.equal(discardOf(g.engine, P2).length, 0);
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(EXCAVATION, "0:rule", "my hand and the rest of my discard pile are untouched", () => {
  const g = exBoard({ extra: [{ key: "keep", def: character({ name: "Kept" }), owner: P1, zone: "hand" }] });
  exPlay(g);
  assert.ok(handOf(g.engine, P1).includes(g.id("keep")), "handOf(g.engine, P1).includes(g.id(\"keep\"))");
  for (const key of ["dc0", "dc1", "dc2", "dc3", "dc4"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard");
});

clause(EXCAVATION, "0:rule", "a deck of exactly 8 is milled completely and the draw finds nothing (no loss, CR 102.1a)", () => {
  const g = exBoard({ deck: 8 });
  exPlay(g);
  for (const key of DECK_KEYS.slice(0, 8)) assert.equal(zoneOf(g.engine, g.id(key)), "discard");
  assert.equal(deckOf(g.engine, P1).length, 0);
  assert.equal(handOf(g.engine, P1).length, 0, "nothing to draw");
  assert.equal(g.engine.state.winner, undefined);
});

clause(EXCAVATION, "0:rule", "a deck of 9: the 8 are milled and the last card is drawn", () => {
  const g = exBoard({ deck: 9 });
  exPlay(g);
  assert.equal(zoneOf(g.engine, g.id("d8")), "hand");
  assert.equal(deckOf(g.engine, P1).length, 0);
});

clause(EXCAVATION, "0:rule", "a deck of fewer than 8: it mills what there is and draws nothing", () => {
  const g = exBoard({ deck: 5 });
  exPlay(g);
  for (const key of DECK_KEYS.slice(0, 5)) assert.equal(zoneOf(g.engine, g.id(key)), "discard");
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(EXCAVATION, "0:rule", "an empty deck: nothing happens and nothing breaks", () => {
  const g = exBoard({ deck: 0 });
  exPlay(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(EXCAVATION, "0:rule", "the milled cards go face-up into their OWNER's discard pile", () => {
  const g = exBoard();
  exPlay(g);
  for (const key of DECK_KEYS.slice(0, 8)) {
    assert.ok(discardOf(g.engine, P1).includes(g.id(key)), `${key} in my discard pile`);
    assert.equal(cardOf(g.engine, g.id(key)).faceDown, false);
  }
});

clause(EXCAVATION, "0:rule", "it costs exactly 3 and ends in the discard pile; the cost is paid before responses", () => {
  const g = exBoard({ icons: { greed: 6 } });
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("ex"));
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 3);
  assert.equal(zoneOf(g.engine, g.id("d0")), "deck", "the mill waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
});

clause(EXCAVATION, "0:rule", "costs 3: refused with 2 resources, needs [G]: refused without Greed", () => {
  const short = exBoard({ icons: { greed: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("ex")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("ex")), "hand");
  assert.equal(zoneOf(short.engine, short.id("d0")), "deck");
  const noGreed = exBoard({ icons: { rage: 5 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("ex")), "no [G]", /threshold/i);
  assert.equal(zoneOf(noGreed.engine, noGreed.id("ex")), "hand");
  const ok = exBoard({ icons: { greed: 1, rage: 2 } });
  exPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("d0")), "discard");
});

clause(EXCAVATION, "0:rule", "it is a tactic: it can be played in response on my opponent's turn", () => {
  const g = exBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("ex"));
  assert.equal(zoneOf(g.engine, g.id("d0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("d8")), "hand");
});

// --- RECUR ---

clause(EXCAVATION, "1:ability:excavation-recur", "from my discard pile it puts the picked card into play under my control as a face-down resource", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 6 } });
  exRecur(g, "dc0");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("dc0"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.deepEqual(g.engine.getCardTypes(g.id("dc0")), ["resource"]);
  assert.ok(playOf(g.engine, P1).includes(g.id("dc0")), "playOf(g.engine, P1).includes(g.id(\"dc0\"))");
});

for (const [key, what] of [
  ["dc0", "a character"],
  ["dc1", "a tactic"],
  ["dc2", "an item"],
  ["dc3", "a location"],
  ["dc4", "a staple resource (it still comes in face-down, providing Volition)"]
] as const) {
  clause(EXCAVATION, "1:ability:excavation-recur", `'a card in your discard pile': it can pick ${what}`, () => {
    const g = exBoard({ ex: "discard", icons: { greed: 6 } });
    exRecur(g, key);
    const card = cardOf(g.engine, g.id(key));
    assert.equal(card.zone, "play");
    assert.equal(card.faceDown, true);
    assert.deepEqual(g.engine.getCardTypes(g.id(key)), ["resource"]);
  });
}

clause(EXCAVATION, "1:ability:excavation-recur", "a staple Greed picked this way provides Volition, not Greed", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 1, rage: 6 } });
  const greedBefore = g.engine.getThresholds(P1).greed ?? 0;
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  exRecur(g, "dc4");
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, greedBefore);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
});

clause(EXCAVATION, "1:ability:excavation-recur", "RECUR removes the Excavation from the game and pays exactly 4", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 7 } });
  const before = ready(g.engine);
  exRecur(g, "dc0");
  assert.equal(zoneOf(g.engine, g.id("ex")), "removed");
  assert.ok(removedOf(g.engine, P1).includes(g.id("ex")), "removedOf(g.engine, P1).includes(g.id(\"ex\"))");
  assert.equal(discardOf(g.engine, P1).includes(g.id("ex")), false);
  assert.equal(before - ready(g.engine), 4 - 1, "paid 4; the new face-down resource is one more free resource");
  assert.equal(attachedCount(g.engine, P1), 4);
});

clause(EXCAVATION, "1:ability:excavation-recur", "the costs are paid on activation: the Excavation is removed and the 4 paid before my opponent can respond", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 7 } });
  const before = ready(g.engine);
  exRecurRaw(g, "dc0");
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 4);
  assert.equal(zoneOf(g.engine, g.id("ex")), "removed");
  assert.equal(zoneOf(g.engine, g.id("dc0")), "discard", "the pick has not moved yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dc0")), "play");
});

clause(EXCAVATION, "1:ability:excavation-recur", "Pay 4: refused with 3 free resources even with [G]; accepted with exactly 4", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = exBoard({ ex: "discard", icons: {}, extra: [...spent(1), ...res({ rage: 3 })] });
  assert.equal(ready(short.engine), 3);
  refused(() => exRecurRaw(short, "dc0"), "3 free resources for Pay 4");
  assert.equal(zoneOf(short.engine, short.id("ex")), "discard");
  const exact = exBoard({ ex: "discard", icons: {}, extra: [...spent(1), ...res({ rage: 4 })] });
  exRecur(exact, "dc0");
  assert.equal(zoneOf(exact.engine, exact.id("dc0")), "play");
});

clause(EXCAVATION, "1:ability:excavation-recur", "RECUR needs [G]: refused with plenty of resources but no Greed", () => {
  const g = exBoard({ ex: "discard", icons: { rage: 8 } });
  refused(() => exRecurRaw(g, "dc0"), "no [G]", /threshold/i);
  assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
  const ok = exBoard({ ex: "discard", icons: { greed: 1, rage: 4 } });
  exRecur(ok, "dc0");
  assert.equal(zoneOf(ok.engine, ok.id("dc0")), "play");
});

clause(EXCAVATION, "1:ability:excavation-recur", "Use this only if this card is in your discard pile: refused from my hand, the deck and the removed zone", () => {
  for (const where of ["hand", "deck", "removed", "play"] as const) {
    const g = exBoard({ ex: where, icons: { greed: 8 } });
    refused(() => exRecurRaw(g, "dc0"), `Excavation in ${where}`);
    assert.equal(zoneOf(g.engine, g.id("dc0")), "discard");
  }
});

clause(EXCAVATION, "1:ability:excavation-recur", "'your discard pile': an Excavation in my opponent's discard pile cannot be recurred by me", () => {
  const g = exBoard({ ex: "discard", owner: P2, icons: { greed: 8 } });
  assert.ok(discardOf(g.engine, P2).includes(g.id("ex")), "discardOf(g.engine, P2).includes(g.id(\"ex\"))");
  refused(() => exRecurRaw(g, "dc0"), "their discard pile");
  assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
});

clause(EXCAVATION, "1:ability:excavation-recur", "RECUR is one-shot: once removed from the game it cannot be used again", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 12 } });
  exRecur(g, "dc0");
  refused(() => exRecurRaw(g, "dc1"), "no longer in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("dc1")), "discard");
});

clause(EXCAVATION, "1:ability:excavation-recur", "the Excavation is removed BEFORE the pick: it cannot pick itself", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 8 } });
  refused(() => exRecurRaw(g, "ex"), "itself");
  assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

const EX_BAD: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "ocard", why: "a card in my OPPONENT's discard pile", extra: [{ key: "ocard", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" }] },
  { key: "hcard", why: "a card in my hand", extra: [{ key: "hcard", def: character({ name: "Handy" }), owner: P1, zone: "hand" }] },
  { key: "kcard", why: "a card in my deck", extra: [{ key: "kcard", def: character({ name: "Deckard" }), owner: P1, zone: "deck" }] },
  { key: "mine", why: "a character in play", extra: [] },
  { key: "xcard", why: "a card removed from the game", extra: [{ key: "xcard", def: character({ name: "Gone" }), owner: P1, zone: "removed" }] }
];

for (const bad of EX_BAD) {
  clause(EXCAVATION, "1:ability:excavation-recur", `cannot pick ${bad.why}`, () => {
    const g = exBoard({ ex: "discard", icons: { greed: 8 }, extra: bad.extra });
    refused(() => exRecurRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("ex")), "discard", "nothing was paid or removed");
    assert.equal(ready(g.engine), 8);
    const control = exBoard({ ex: "discard", icons: { greed: 8 }, extra: bad.extra });
    exRecur(control, "dc0");
    assert.equal(zoneOf(control.engine, control.id("dc0")), "play", "control: a card from my discard pile works on the same board");
  });
}

clause(EXCAVATION, "1:ability:excavation-recur", "needs exactly one pick: none, or two, is refused", () => {
  const none = exBoard({ ex: "discard", icons: { greed: 8 } });
  refused(() => actRaw(none.engine, P1, none.id("ex"), "excavation-recur"), "no pick");
  const two = exBoard({ ex: "discard", icons: { greed: 8 } });
  refused(() => actRaw(two.engine, P1, two.id("ex"), "excavation-recur", { pick: [two.id("dc0"), two.id("dc1")] }), "two picks");
  assert.equal(zoneOf(two.engine, two.id("ex")), "discard");
});

clause(EXCAVATION, "1:ability:excavation-recur", "with nothing else in my discard pile there is nothing to pick, so RECUR cannot be used", () => {
  const g = exBoard({ ex: "discard", discard: false, icons: { greed: 8 } });
  refused(() => actRaw(g.engine, P1, g.id("ex"), "excavation-recur"), "no other card in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
});

clause(EXCAVATION, "1:ability:excavation-recur", "the card put into play is a new blank resource: a character with an enters-play trigger does not trigger", () => {
  const newsie = character({
    name: "Newsie",
    behavior: { abilities: [{ id: "news", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
  });
  const g = exBoard({ ex: "discard", icons: { greed: 6 }, extra: [{ key: "news", def: newsie, owner: P1, zone: "discard" }] });
  exRecur(g, "news");
  assert.equal(cardOf(g.engine, g.id("news")).faceDown, true);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(EXCAVATION, "1:ability:excavation-recur", "a picked card that left the discard pile in response is not pulled into play (CR 402.4)", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 8 }, extra: [{ key: "mv", def: moverTactic("discard", "hand"), owner: P2, zone: "hand" }] });
  exRecurRaw(g, "dc0");
  respondWith(g.engine, P2, g.id("mv"), { t: [g.id("dc0")] });
  assert.equal(zoneOf(g.engine, g.id("dc0")), "hand", "control: it was moved to my hand in response");
  assert.equal(cardOf(g.engine, g.id("dc0")).faceDown, false);
});

clause(EXCAVATION, "1:ability:excavation-recur", "RECUR works as a response on my opponent's turn (it is an ability)", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 8 }, turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.state.priorityPlayerId, P1);
  exRecurRaw(g, "dc0");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dc0")), "play");
  assert.equal(cardOf(g.engine, g.id("dc0")).faceDown, true);
});

clause(EXCAVATION, "1:ability:excavation-recur", "the printed play ability is not available from the discard pile", () => {
  const g = exBoard({ ex: "discard", icons: { greed: 8 } });
  refused(() => playRaw(g.engine, P1, g.id("ex")), "playing a tactic from the discard pile");
  assert.equal(zoneOf(g.engine, g.id("d0")), "deck");
});

// =================================================================================
// Prophetic Assistant
// At the end of your turn, you may reveal the top card of your deck. If you do and it is a staple
// resource, put it into your hand.
// Character (banker; mau), cost 2, [G][G], 1 / 3 / 2.
// =================================================================================

const ASSISTANT = "a9d9be90-b1ba-4cea-9abb-1b570317441d";

/** A deck with `top` as its top card, then nine filler characters. */
function topDeck(owner: PlayerId, top: CardDefinition[]): CardPlacement[] {
  return [
    ...top.map((def, i) => ({ key: `t${i}`, def, owner, zone: "deck" as Zone })),
    ...chars("f", 9, owner, "deck")
  ];
}

function paBoard(
  opts: {
    pa?: Zone;
    faceDown?: boolean;
    owner?: PlayerId;
    controller?: PlayerId;
    top?: CardDefinition[];
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    deck?: boolean;
  } = {}
) {
  return devBoard(
    [
      { key: "pa", def: printing(ASSISTANT), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.pa ?? "play", faceDown: opts.faceDown },
      ...(opts.deck === false ? [] : topDeck(P1, opts.top ?? [stapleCard("Greed", "greed")])),
      ...topDeck(P2, [stapleCard("Rage", "rage")]).map((p) => ({ ...p, key: `o${p.key}` })),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 3 }),
      ...res({ rage: 3 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PaBoard = ReturnType<typeof paBoard>;
/** P1 ends the turn; the end-of-turn prompt, if any, is answered with `accept` (null = decline everything). */
function paEnd(g: PaBoard, accept: boolean, player: PlayerId = P1): void {
  endTurn(g.engine, player);
  drain(g.engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: accept } : pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : declineAll(pc)));
}

clause(ASSISTANT, "0:rule", "at the end of my turn, if I reveal and the top card is a staple resource, it goes into my hand", () => {
  const g = paBoard();
  paEnd(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("t0")), "handOf(g.engine, P1).includes(g.id(\"t0\"))");
});

clause(ASSISTANT, "0:rule", "the top card is revealed (a cardsRevealed event for exactly that card)", () => {
  const g = paBoard();
  paEnd(g, true);
  assert.deepEqual(revealedIds(g.engine), [g.id("t0")]);
  assert.equal(revealEvents(g.engine).length, 1);
});

for (const [icon, name] of [
  ["rage", "Rage"],
  ["greed", "Greed"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as Array<[StapleIcon, string]>) {
  clause(ASSISTANT, "0:rule", `a staple ${name} on top goes into my hand`, () => {
    const g = paBoard({ top: [stapleCard(name, icon)] });
    paEnd(g, true);
    assert.equal(zoneOf(g.engine, g.id("t0")), "hand");
  });
}

clause(ASSISTANT, "0:rule", "a NON-staple resource on top is revealed but stays on top of my deck", () => {
  const g = paBoard({ top: [oddResource("Odd Coin")] });
  paEnd(g, true);
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
  assert.equal(deckOf(g.engine, P1)[0], g.id("t0"), "still the top card");
  assert.deepEqual(revealedIds(g.engine), [g.id("t0")], "but it was revealed");
  assert.equal(handOf(g.engine, P1).length, 0);
});

for (const [def, what] of [
  [character({ name: "Top Character" }), "a character"],
  [tactic({ name: "Top Tactic" }), "a tactic"],
  [item({ name: "Top Item" }), "an item"],
  [location({ name: "Top Place" }), "a location"]
] as Array<[CardDefinition, string]>) {
  clause(ASSISTANT, "0:rule", `${what} on top is revealed but not taken: it stays on top`, () => {
    const g = paBoard({ top: [def] });
    paEnd(g, true);
    assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
    assert.equal(deckOf(g.engine, P1)[0], g.id("t0"));
    assert.deepEqual(revealedIds(g.engine), [g.id("t0")]);
    assert.equal(handOf(g.engine, P1).length, 0);
  });
}

clause(ASSISTANT, "0:rule", "'you MAY reveal': declining reveals nothing and takes nothing, even with a staple on top", () => {
  const g = paBoard();
  paEnd(g, false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
  assert.equal(revealEvents(g.engine).length, 0, "nothing was revealed");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(ASSISTANT, "0:rule", "the choice is offered to me, costs nothing", () => {
  const g = paBoard();
  const before = ready(g.engine);
  endTurn(g.engine, P1);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(ready(g.engine), before, "no resource was paid");
});

clause(ASSISTANT, "0:rule", "only the TOP card: a staple second from the top is not taken", () => {
  const g = paBoard({ top: [character({ name: "Top Character" }), stapleCard("Greed", "greed")] });
  paEnd(g, true);
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck", "the staple under it stays");
  assert.deepEqual(revealedIds(g.engine), [g.id("t0")]);
});

clause(ASSISTANT, "0:rule", "it takes exactly one card even when the next card is a staple too", () => {
  const g = paBoard({ top: [stapleCard("Greed", "greed"), stapleCard("Rage", "rage")] });
  paEnd(g, true);
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck");
  assert.equal(deckOf(g.engine, P1)[0], g.id("t1"), "the next card is the new top");
});

clause(ASSISTANT, "0:rule", "with an empty deck there is nothing to reveal and nothing breaks", () => {
  const g = paBoard({ deck: false });
  paEnd(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.state.winner, undefined);
});

clause(ASSISTANT, "0:rule", "it triggers at the end of MY turn only: my opponent's end of turn offers me nothing", () => {
  const g = paBoard({ turn: 2, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt at the end of their turn");
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(ASSISTANT, "0:rule", "it does not trigger when the Assistant enters play or leaves play, or in the middle of my turn", () => {
  const g = paBoard({ pa: "hand", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("pa"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("pa")), "play", "control: it was deployed");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(g.engine).length, 0, "entering play reveals nothing");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("pa")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("pa")), "discard", "control: it left play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(g.engine).length, 0, "leaving play reveals nothing");
});

clause(ASSISTANT, "0:rule", "a face-down Assistant has no rules text: nothing happens at the end of my turn", () => {
  const g = paBoard({ faceDown: true });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(g.engine).length, 0);
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck");
});

clause(ASSISTANT, "0:rule", "'your turn' is its controller's: an Assistant I stole triggers at the end of MY turn, not its owner's", () => {
  const g = paBoard({ owner: P2, controller: P1 });
  paEnd(g, true);
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand", "my deck's top card, my turn's end");
  assert.ok(handOf(g.engine, P1).includes(g.id("t0")), "handOf(g.engine, P1).includes(g.id(\"t0\"))");
});

clause(ASSISTANT, "0:rule", "my opponent's Assistant works on THEIR deck at the end of THEIR turn", () => {
  const g = paBoard({ pa: "play", owner: P2, turn: 2, active: P2 });
  endTurn(g.engine, P2);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P2, "its controller decides");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("ot0")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("ot0")), "handOf(g.engine, P2).includes(g.id(\"ot0\"))");
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck", "my deck is untouched");
});

clause(ASSISTANT, "0:rule", "two Assistants each get their own reveal: the second sees the card under the first one's", () => {
  const g = paBoard({ top: [stapleCard("Greed", "greed"), stapleCard("Rage", "rage")], extra: [{ key: "pa2", def: printing(ASSISTANT), owner: P1, zone: "play" }] });
  paEnd(g, true);
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t1")), "hand");
  assert.equal(revealEvents(g.engine).length, 2, "two reveals");
});

clause(ASSISTANT, "0:rule", "it happens when the turn actually ends (CR 610.1a): nothing is offered when the end of the turn is only announced, and an Assistant destroyed in response reveals nothing", () => {
  const g = paBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(pending(g.engine), undefined, "the trigger has not fired yet: the turn has not ended");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond to my announcing the end of the turn");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("pa")] });
  drain(g.engine, acceptPay);
  assert.equal(zoneOf(g.engine, g.id("pa")), "discard", "control: the Assistant was destroyed in response");
  assert.equal(zoneOf(g.engine, g.id("t0")), "deck", "it was no longer in play when the turn ended: nothing to reveal");
  assert.equal(revealEvents(g.engine).length, 0);
});

clause(ASSISTANT, "0:rule", "a turn that ends normally still has no extra effects: after the reveal the turn passes to my opponent", () => {
  const g = paBoard();
  paEnd(g, true);
  assert.equal(g.engine.state.activePlayerId, P2);
});

// =================================================================================
// Swinish Elder
// If your opponent plays a resource, you may pay 1. If you do, attach that resource to your
// opponent's faction.
// Character (banker; priest, mau), cost 6, [G][G], 4 / 3 / 4.
// =================================================================================

const ELDER = "414bcffa-7213-40f1-810f-9563a33cc619";

function elderBoard(
  opts: {
    elder?: Zone;
    faceDown?: boolean;
    owner?: PlayerId;
    controller?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    extra?: CardPlacement[];
    turn?: number;
    active?: PlayerId;
    spentMine?: number;
  } = {}
) {
  const spent: CardPlacement[] = opts.spentMine ? bank("greed", opts.spentMine, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) : [];
  return devBoard(
    [
      { key: "el", def: printing(ELDER), owner: opts.owner ?? P1, controller: opts.controller, zone: opts.elder ?? "play", faceDown: opts.faceDown },
      { key: "ogr", def: stapleCard("Greed", "greed"), owner: P2, zone: "hand" },
      { key: "orage", def: stapleCard("Rage", "rage"), owner: P2, zone: "hand" },
      { key: "ochar", def: character({ name: "Their Spare Character" }), owner: P2, zone: "hand" },
      { key: "mgr", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...res(opts.oppIcons ?? { rage: 3 }, P2),
      ...spent,
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type ElderBoard = ReturnType<typeof elderBoard>;
const factionIdOf = (g: ElderBoard, p: PlayerId) => g.engine.state.players[p].factionId!;

/** My opponent (P2, the active player) plays `key` with their develop rule, then the Elder's prompt is answered by `answer`. */
function theyPlay(g: ElderBoard, key: string, faceDown: boolean, answer: (pc: PendingChoiceLike) => unknown = acceptPay): void {
  developResource(g.engine, P2, g.id(key), faceDown);
  resolvePendingResponses(g.engine);
  drain(g.engine, answer);
}

clause(ELDER, "0:rule", "when my opponent plays a resource I may pay 1: their resource is attached to their faction", () => {
  const g = elderBoard();
  theyPlay(g, "ogr", false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("ogr"));
  assert.equal(card.zone, "play", "control: it was played");
  assert.equal(card.attachedTo, factionIdOf(g, P2), "attached to THEIR faction");
  assert.equal(card.controllerId, P2, "they still control it");
});

clause(ELDER, "0:rule", "the choice is mine (the Elder's controller), and it costs exactly 1 of my resources", () => {
  const g = elderBoard();
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1, "I decide");
  const before = ready(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(before - ready(g.engine, P1), 1, "Pay 1");
  assert.equal(attachedCount(g.engine, P1), 1, "one of MY resources was attached to MY faction");
});

clause(ELDER, "0:rule", "'you MAY pay 1': declining leaves their resource free and costs me nothing", () => {
  const g = elderBoard();
  const before = ready(g.engine, P1);
  theyPlay(g, "ogr", false, refusePay);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, undefined);
  assert.equal(ready(g.engine, P1), before);
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(ELDER, "0:rule", "'attach THAT resource': their other resources are not attached", () => {
  const g = elderBoard();
  const theirs = playOf(g.engine, P2).filter((id) => g.engine.isResource(id) && id !== g.id("ogr"));
  theyPlay(g, "ogr", false);
  for (const id of theirs) assert.equal(cardOf(g.engine, id).attachedTo, undefined, "an older resource is untouched");
  assert.equal(attachedCount(g.engine, P2), 1, "exactly one of their resources is attached");
});

clause(ELDER, "0:rule", "an attached resource is spent: it cannot pay for their costs (the played Greed adds no free resource for them)", () => {
  const g = elderBoard();
  const before = ready(g.engine, P2);
  theyPlay(g, "ogr", false);
  assert.equal(ready(g.engine, P2), before, "the new Greed is attached, so it is not free");
  const g2 = elderBoard();
  const before2 = ready(g2.engine, P2);
  theyPlay(g2, "ogr", false, refusePay);
  assert.equal(ready(g2.engine, P2), before2 + 1, "control: without paying the new Greed is free to use");
});

clause(ELDER, "0:rule", "a spent resource still counts for thresholds: their Greed icon is still controlled", () => {
  const g = elderBoard();
  const before = g.engine.getThresholds(P2).greed ?? 0;
  theyPlay(g, "ogr", false);
  assert.equal(g.engine.getThresholds(P2).greed ?? 0, before + 1);
});

clause(ELDER, "0:rule", "it works for any resource they play face-up: a Rage as well", () => {
  const g = elderBoard();
  theyPlay(g, "orage", false);
  assert.equal(cardOf(g.engine, g.id("orage")).attachedTo, factionIdOf(g, P2));
});

clause(ELDER, "0:rule", "a card they play FACE-DOWN as a resource is a played resource too", () => {
  const g = elderBoard();
  theyPlay(g, "ochar", true);
  const card = cardOf(g.engine, g.id("ochar"));
  assert.equal(card.faceDown, true, "control: it was played face-down");
  assert.equal(card.attachedTo, factionIdOf(g, P2), "and attached");
});

clause(ELDER, "0:rule", "paying needs a free resource: with none free I cannot attach their resource", () => {
  const g = elderBoard({ icons: {}, spentMine: 3 });
  assert.equal(ready(g.engine, P1), 0);
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) {
    try {
      answerPending(g.engine, "mayPay", { pay: true });
    } catch {
      /* refusing what I cannot afford is correct */
    }
    drain(g.engine, declineAll);
  }
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, undefined, "it is not attached");
  assert.equal(attachedCount(g.engine, P1), 3, "I spent nothing more");
});

clause(ELDER, "0:rule", "with exactly one free resource I can pay for it", () => {
  const g = elderBoard({ icons: { greed: 1 } });
  theyPlay(g, "ogr", false);
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, factionIdOf(g, P2));
  assert.equal(ready(g.engine, P1), 0);
});

clause(ELDER, "0:rule", "it only reacts to my OPPONENT: when I play a resource myself, nothing is offered", () => {
  const g = elderBoard({ turn: 1, active: P1 });
  developResource(g.engine, P1, g.id("mgr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("mgr")).zone, "play", "control: my resource entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("mgr")).attachedTo, undefined);
});

clause(ELDER, "0:rule", "'plays a resource' is not 'puts into play': a card their effect puts into play as a face-down resource is not offered", () => {
  const bury = tactic({
    name: "Bury",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bury",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", faceDown: true }]
        }
      ]
    }
  });
  const g = elderBoard({
    extra: [
      { key: "bury", def: bury, owner: P2, zone: "hand" },
      { key: "dead", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P2, g.id("bury"), { selected: { t: [g.id("dead")] } });
  assert.equal(cardOf(g.engine, g.id("dead")).faceDown, true, "control: it was put into play face-down");
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer");
  assert.equal(cardOf(g.engine, g.id("dead")).attachedTo, undefined);
});

clause(ELDER, "0:rule", "...with the real Miraculous Regeneration (it puts a character into play as a face-down resource): not offered either", () => {
  const regen = printing("5df56b56-1925-4958-ba48-67ab47781ff1");
  const g = elderBoard({
    oppIcons: { greed: 4 },
    extra: [
      { key: "rg", def: regen, owner: P2, zone: "hand" },
      { key: "d0", def: character({ name: "Dead One" }), owner: P2, zone: "discard" },
      { key: "d1", def: character({ name: "Dead Two" }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P2, g.id("rg"), { selected: { toPlay: [g.id("d0")], toHand: [g.id("d1")] } });
  assert.equal(zoneOf(g.engine, g.id("d0")), "play", "control: it came into play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("d0")).attachedTo, undefined);
});

clause(ELDER, "0:rule", "a resource a card of mine plays for ME is not theirs: my Greed played on my turn is not attached by anyone", () => {
  const g = elderBoard({ turn: 1, active: P1 });
  developResource(g.engine, P1, g.id("mgr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(ELDER, "0:rule", "a face-down Elder has no rules text: nothing is offered", () => {
  const g = elderBoard({ faceDown: true });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, undefined);
});

clause(ELDER, "0:rule", "an Elder in my hand does nothing", () => {
  const g = elderBoard({ elder: "hand" });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, undefined);
});

clause(ELDER, "0:rule", "'your opponent' is relative to the Elder's controller: an Elder I stole (owner P2) reacts to resources played by P2, and the choice is mine", () => {
  const g = elderBoard({ owner: P2, controller: P1 });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P1, "the controller decides");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, factionIdOf(g, P2));
});

clause(ELDER, "0:rule", "my opponent's own Elder reacts to MY resources, not theirs", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "el", def: printing(ELDER), owner: P2, zone: "play" },
      { key: "mgr", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" },
      ...res({ rage: 3 }, P2)
    ]
  });
  developResource(g.engine, P1, g.id("mgr"), false);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "mayPay");
  assert.equal(pc.playerId, P2, "their Elder's controller (they) decides");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(cardOf(g.engine, g.id("mgr")).attachedTo, g.engine.state.players[P1].factionId, "my resource is attached to MY faction");
});

clause(ELDER, "0:rule", "two Elders each offer: each prompt is a separate 'you may pay 1', and accepting both costs 2", () => {
  const g = elderBoard({ extra: [{ key: "el2", def: printing(ELDER), owner: P1, zone: "play" }] });
  developResource(g.engine, P2, g.id("ogr"), false);
  resolvePendingResponses(g.engine);
  const before = ready(g.engine, P1);
  let prompts = 0;
  drain(g.engine, (pc) => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "mayPay") prompts++;
    return acceptPay(pc);
  });
  assert.equal(prompts, 2, "one offer per Elder");
  assert.equal(cardOf(g.engine, g.id("ogr")).attachedTo, factionIdOf(g, P2));
  assert.equal(before - ready(g.engine, P1), 2, "1 for each Elder");
});

