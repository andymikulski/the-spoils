// Clause tests, batch ungodly-mess-06, part p1 (groups 1-5, missing clauses only).
// Symmetrical Scimitar, Thabbashite Convert, Undesirable Intrusion, Zenobia Artificer, Zenobia's Intervention.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, settleState, flipUpNow } from "./_clause.js";
import { declareAttackBy, fightThrough, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";

type Pl = CardPlacement;

/** Staple resources of one icon that are already SPENT (attached to the owner's faction): they count toward thresholds but cannot pay. */
const spentBank = (icon: Parameters<typeof bank>[0], n: number, owner: PlayerId): Pl[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const spentVolition = (n: number, owner: PlayerId): Pl[] =>
  volition(n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** [strength, speed, life] */
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): number[] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "speed"),
  engine.getStat(cardId, "life")
];

const factions = { playerA: { faction: developFaction() }, playerB: { faction: developFaction() } };

/** A free tactic taking control of a chosen character in play for its caster. */
const stealTactic = (): ReturnType<typeof tactic> =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

/** A free tactic destroying a chosen item in play. */
const smashItemTactic = (): ReturnType<typeof tactic> =>
  tactic({
    name: "SmashItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A free tactic destroying a chosen character in play. */
const killTacticLocal = (): ReturnType<typeof tactic> =>
  tactic({
    name: "KillChar",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// ============================================================================
// Symmetrical Scimitar -- item (gear), cost 1 [E]
// ATTACH TO CHARACTER. Attached to a character you control: +1 strength and +1 life.
// Attached to a character you don't control: -1 strength and -1 life.
// ============================================================================

const SCIM = "a3323452-3932-4a8a-a3d3-2583fdc7035e";

function scimBoard(
  o: { res?: Pl[]; extra?: Pl[]; attach?: string; scOwner?: PlayerId; scController?: PlayerId; active?: PlayerId } = {}
) {
  const sc: Pl = o.attach
    ? { key: "sc", def: printing(SCIM), owner: o.scOwner ?? P1, controller: o.scController, zone: "play", attachedToKey: o.attach }
    : { key: "sc", def: printing(SCIM), owner: P1, zone: "hand" };
  return buildGame({
    ...factions,
    turn: o.active === P2 ? 2 : 1,
    activePlayerId: o.active ?? P1,
    cards: [
      sc,
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...(o.res ?? bank("elitism", 1, P1)),
      ...(o.extra ?? [])
    ]
  });
}

const scimPlay = (b: ReturnType<typeof scimBoard>, hostKey: string) =>
  play(b.engine, P1, b.id("sc"), { selected: { attachTo: [b.id(hostKey)] } });

clause(SCIM, "0:attach", "is a gearsmith item (gear) costing 1 [E]: deploys with exactly one [E] resource and pays 1", () => {
  assert.equal(printing(SCIM).type, "item");
  assert.equal(printing(SCIM).trade, "gearsmith");
  assert.deepEqual(printing(SCIM).subtype, ["gear"]);
  const b = scimBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("sc")), ["item"]);
  assert.equal(readyResources(b.engine, P1), 1);
  scimPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("sc")), "play");
  assert.equal(readyResources(b.engine, P1), 0, "the printed cost of 1 is paid");
});

clause(SCIM, "0:attach", "cost is exactly 1: with the [E] already spent, one more ready resource pays; with none it is refused", () => {
  const short = scimBoard({ res: spentBank("elitism", 1, P1) });
  assert.equal(readyResources(short.engine, P1), 0);
  refused(() => playRaw(short.engine, P1, short.id("sc"), { selected: { attachTo: [short.id("mine")] } }), "threshold met by the spent [E] but nothing left to pay the 1", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("sc")), "hand");
  const ok = scimBoard({ res: [...spentBank("elitism", 1, P1), ...bank("rage", 1, P1)] });
  scimPlay(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("sc")), "play", "control: the spent [E] satisfies the threshold, the ready Rage pays the cost");
  assert.equal(readyResources(ok.engine, P1), 0);
  const none = scimBoard({ res: [] });
  refused(() => playRaw(none.engine, P1, none.id("sc"), { selected: { attachTo: [none.id("mine")] } }), "no resources at all");
});

clause(SCIM, "0:attach", "threshold [E]: refused with plenty of non-[E] resources, and the opponent's [E] does not count", () => {
  const rageOnly = scimBoard({ res: bank("rage", 3, P1) });
  refused(() => playRaw(rageOnly.engine, P1, rageOnly.id("sc"), { selected: { attachTo: [rageOnly.id("mine")] } }), "no [E] among the resources");
  assert.equal(zoneOf(rageOnly.engine, rageOnly.id("sc")), "hand");
  const theirs = scimBoard({ res: [...bank("rage", 3, P1), ...bank("elitism", 3, P2)] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("sc"), { selected: { attachTo: [theirs.id("mine")] } }), "the opponent's [E] does not count");
  const ok = scimBoard({ res: [...bank("rage", 2, P1), ...bank("elitism", 1, P1)] });
  scimPlay(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("sc")), "play", "control: one [E] among three resources is enough");
  assert.equal(readyResources(ok.engine, P1), 2, "only 1 paid");
});

clause(SCIM, "0:attach", "attaches to a character you control: it enters play attached to the picked character only", () => {
  const b = scimBoard();
  scimPlay(b, "mine");
  assert.equal(b.engine.state.cards[b.id("sc")].attachedTo, b.id("mine"));
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined);
  assert.equal(b.engine.state.cards[b.id("sc")].controllerId, P1);
});

clause(SCIM, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller); you still control the Scimitar", () => {
  const b = scimBoard();
  scimPlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("sc")), "play");
  assert.equal(b.engine.state.cards[b.id("sc")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("sc")].controllerId, P1);
});

clause(SCIM, "0:attach", "is refused for a host that is not a character in play: an item, a location, a faction, a face-down card, a resource, a card in hand or discard", () => {
  const b = scimBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("sc"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "your faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource");
  refused(attempt(b.id("res")), "a resource");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("sc")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character in play is accepted");
});

clause(SCIM, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const b = scimBoard();
  refused(() => playRaw(b.engine, P1, b.id("sc"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("sc"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("sc"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("sc")), "hand");
});

clause(SCIM, "0:attach", "as an item it can only be deployed on your own turn", () => {
  const b = scimBoard({ active: P2 });
  refused(() => playRaw(b.engine, P1, b.id("sc"), { selected: { attachTo: [b.id("mine")] } }), "an item on the opponent's turn");
  assert.equal(zoneOf(b.engine, b.id("sc")), "hand");
  assert.equal(readyResources(b.engine, P1), 1, "nothing was paid");
});

clause(SCIM, "1:rule", "attached to a character you control: +1 strength and +1 life (speed unchanged), only that character", () => {
  const b = scimBoard({ attach: "mine" });
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
  assert.deepEqual(stats(b.engine, b.id("mine2")), [2, 2, 3], "another of my characters is unaffected");
  assert.deepEqual(stats(b.engine, b.id("foe")), [2, 2, 3], "the opponent's character is unaffected");
});

clause(SCIM, "1:rule", "deploying it onto your own character applies the bonus right away", () => {
  const b = scimBoard();
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3]);
  scimPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(SCIM, "1:rule", "two Scimitars on one of your characters stack: +2/+2", () => {
  const b = scimBoard({
    attach: "mine",
    extra: [{ key: "sc2", def: printing(SCIM), owner: P1, zone: "play", attachedToKey: "mine" }]
  });
  assert.deepEqual(stats(b.engine, b.id("mine")), [4, 2, 5]);
});

clause(SCIM, "1:rule", "the bonus ends when the Scimitar leaves play (and stays ended)", () => {
  const b = scimBoard({ attach: "mine", extra: [{ key: "smash", def: smashItemTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("sc")] } });
  assert.equal(zoneOf(b.engine, b.id("sc")), "discard");
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3], "back to printed values");
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3], "and stays there");
});

clause(SCIM, "1:rule", "'you control' is the Scimitar's controller: a host you control but do not own still gets +1/+1", () => {
  const b = scimBoard({
    attach: "stolen",
    extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 3, speed: 2 }), owner: P2, controller: P1, zone: "play" }]
  });
  assert.deepEqual(stats(b.engine, b.id("stolen")), [3, 2, 4]);
});

clause(SCIM, "1:rule", "if the host changes sides the Scimitar's controller takes the opponent's character: -1/-1 turns into +1/+1", () => {
  const b = scimBoard({ attach: "foe", extra: [{ key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(b.engine, b.id("foe")), [1, 2, 2], "before: -1/-1");
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("foe")].controllerId, P1);
  assert.deepEqual(stats(b.engine, b.id("foe")), [3, 2, 4], "after taking control: +1/+1");
});

clause(SCIM, "2:rule", "attached to a character you don't control: -1 strength and -1 life (speed unchanged), only that character", () => {
  const b = scimBoard({ attach: "foe" });
  assert.deepEqual(stats(b.engine, b.id("foe")), [1, 2, 2]);
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3], "my character is unaffected");
});

clause(SCIM, "2:rule", "deploying it onto the opponent's character applies the penalty right away", () => {
  const b = scimBoard();
  scimPlay(b, "foe");
  assert.deepEqual(stats(b.engine, b.id("foe")), [1, 2, 2]);
});

clause(SCIM, "2:rule", "two Scimitars on an opponent's character stack: -2/-2", () => {
  const b = scimBoard({
    attach: "foe",
    extra: [{ key: "sc2", def: printing(SCIM), owner: P1, zone: "play", attachedToKey: "foe" }]
  });
  assert.deepEqual(stats(b.engine, b.id("foe")), [0, 2, 1]);
});

clause(SCIM, "2:rule", "the penalty ends when the Scimitar leaves play", () => {
  const b = scimBoard({ attach: "foe", extra: [{ key: "smash", def: smashItemTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("sc")] } });
  assert.equal(zoneOf(b.engine, b.id("sc")), "discard");
  assert.deepEqual(stats(b.engine, b.id("foe")), [2, 2, 3]);
  assert.deepEqual(stats(b.engine, b.id("foe")), [2, 2, 3]);
});

clause(SCIM, "2:rule", "'you' is the Scimitar's controller: if the opponent takes control of your host, it becomes -1/-1", () => {
  const b = scimBoard({
    active: P2,
    attach: "mine",
    extra: [{ key: "steal", def: stealTactic(), owner: P2, zone: "hand" }]
  });
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4], "before: +1/+1");
  play(b.engine, P2, b.id("steal"), { selected: { t: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("mine")].controllerId, P2);
  assert.deepEqual(stats(b.engine, b.id("mine")), [1, 2, 2], "now the host is a character its Scimitar's controller does not control");
});

clause(SCIM, "2:rule", "a Scimitar you control but do not own, on its owner's character, is a penalty (judged by controller, not owner)", () => {
  const b = scimBoard({ attach: "mine", scOwner: P1, scController: P2 });
  assert.deepEqual(stats(b.engine, b.id("mine")), [1, 2, 2]);
});

clause(SCIM, "2:rule", "a penalty that takes life to 0 destroys the character", () => {
  const b = scimBoard({
    attach: "frail",
    extra: [{ key: "frail", def: character({ name: "Frail", strength: 3, life: 1, speed: 2 }), owner: P2, zone: "play" }]
  });
  assert.equal(b.engine.getStat(b.id("frail"), "life"), 0);
  settleState(b.engine);
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "0 life means destroyed");
});

clause(SCIM, "2:rule", "the penalty never takes strength below 0", () => {
  const b = scimBoard({
    attach: "weak",
    extra: [{ key: "weak", def: character({ name: "Weak", strength: 0, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  assert.equal(b.engine.getStat(b.id("weak"), "strength"), 0);
});

// ============================================================================
// Thabbashite Convert -- character (31f, fighter), cost 5 [E], 4 str / 2 spd / 4 life
// [E][E][V][V]: gains 1 strength and 1 life. When it attacks, you may pick a face-up resource you control;
// if you do, flip it face-down under its owner's control.   FLIP UP: 4 [V][V][V][V]
// ============================================================================

const TC = "c3c8d704-54ad-480b-98f5-6e4c5f621bf9";

function tcBoard(o: { ee?: number; vv?: number; res?: Pl[]; extra?: Pl[]; hand?: boolean; active?: PlayerId } = {}) {
  return buildGame({
    ...factions,
    turn: o.active === P2 ? 2 : 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "tc", def: printing(TC), owner: P1, zone: o.hand ? "hand" : "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...bank("elitism", o.ee ?? 0, P1),
      ...volition(o.vv ?? 0, P1),
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ]
  });
}

clause(TC, "0:rule@eevv", "printed 4 strength / 2 speed / 4 life gearsmith character (31f, fighter) with no icons", () => {
  assert.equal(printing(TC).type, "character");
  assert.equal(printing(TC).trade, "gearsmith");
  assert.deepEqual(printing(TC).subtype, ["31f", "fighter"]);
  const b = tcBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("tc")), ["character"]);
  assert.deepEqual(stats(b.engine, b.id("tc")), [4, 2, 4]);
});

clause(TC, "0:rule@eevv", "deploys for 5 with an [E]: exactly 5 resources works, 4 is refused, and 5 without [E] is refused", () => {
  const ok = tcBoard({ hand: true, res: [...bank("elitism", 1, P1), ...bank("rage", 4, P1)] });
  assert.equal(readyResources(ok.engine, P1), 5);
  play(ok.engine, P1, ok.id("tc"));
  assert.equal(zoneOf(ok.engine, ok.id("tc")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "5 paid");
  const short = tcBoard({ hand: true, res: [...bank("elitism", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("tc")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("tc")), "hand");
  const noIcon = tcBoard({ hand: true, res: bank("rage", 5, P1) });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("tc")), "enough resources but no [E]");
  const theirs = tcBoard({ hand: true, res: [...bank("rage", 5, P1), ...bank("elitism", 2, P2)] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("tc")), "the opponent's [E] does not count");
  const costIsolated = tcBoard({ hand: true, res: [...spentBank("elitism", 1, P1), ...bank("rage", 4, P1)] });
  refused(() => playRaw(costIsolated.engine, P1, costIsolated.id("tc")), "the spent [E] meets the threshold but only 4 are ready", /Costs cannot be paid/);
});

clause(TC, "0:rule@eevv", "with [E][E][V][V]: +1 strength and +1 life (speed unchanged)", () => {
  const b = tcBoard({ ee: 2, vv: 2 });
  assert.deepEqual(stats(b.engine, b.id("tc")), [5, 2, 5]);
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3], "other characters are unaffected");
});

clause(TC, "0:rule@eevv", "the bonus is +1/+1 once, not per extra icon (3 [E] and 3 [V] is still 5/2/5)", () => {
  const b = tcBoard({ ee: 3, vv: 3 });
  assert.deepEqual(stats(b.engine, b.id("tc")), [5, 2, 5]);
});

clause(TC, "0:rule@eevv", "no bonus when any one icon is missing: [E][V][V], [E][E][V]", () => {
  const b2 = tcBoard({ ee: 2, vv: 1 });
  assert.deepEqual(stats(b2.engine, b2.id("tc")), [4, 2, 4], "one [V] short");
  const b3 = tcBoard({ ee: 1, vv: 2 });
  assert.deepEqual(stats(b3.engine, b3.id("tc")), [4, 2, 4], "one [E] short");
  const b4 = tcBoard({ ee: 2, vv: 2 });
  assert.deepEqual(stats(b4.engine, b4.id("tc")), [5, 2, 5], "control");
});

clause(TC, "0:rule@eevv", "[V] must come from face-down cards: face-up Rage does not provide Volition", () => {
  const b = tcBoard({ ee: 2, res: bank("rage", 2, P1) });
  assert.deepEqual(stats(b.engine, b.id("tc")), [4, 2, 4]);
  const ok = tcBoard({ ee: 2, vv: 2, res: bank("rage", 2, P1) });
  assert.deepEqual(stats(ok.engine, ok.id("tc")), [5, 2, 5], "control: face-down cards do provide [V]");
});

clause(TC, "0:rule@eevv", "the opponent's resources do not count toward [E][E][V][V]", () => {
  const theirE = tcBoard({ vv: 2, res: bank("elitism", 2, P2) });
  assert.deepEqual(stats(theirE.engine, theirE.id("tc")), [4, 2, 4], "the opponent's [E]");
  const theirV = tcBoard({ ee: 2, res: volition(2, P2) });
  assert.deepEqual(stats(theirV.engine, theirV.id("tc")), [4, 2, 4], "the opponent's [V]");
});

clause(TC, "0:rule@eevv", "spent (attached) resources still count toward the threshold", () => {
  const b = tcBoard({ res: [...spentBank("elitism", 2, P1), ...spentVolition(2, P1)] });
  assert.deepEqual(stats(b.engine, b.id("tc")), [5, 2, 5]);
  assert.equal(readyResources(b.engine, P1), 0);
});

/** Attack with the Convert; returns the board. */
const tcAttack = (b: ReturnType<typeof tcBoard>, attackers: string[] = ["tc"]) =>
  declareAttackBy(b.engine, P1, attackers.map((key) => b.id(key)));

clause(TC, "0:rule@eevv", "when it attacks with [E][E][V][V], you may pick a face-up resource you control and it is flipped face-down", () => {
  const b = tcBoard({ ee: 2, vv: 2, res: [{ key: "r1", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "play" }] });
  tcAttack(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the controller is asked");
  assert.equal(pc?.playerId, P1);
  assert.equal(b.engine.state.cards[b.id("r1")].faceDown ?? false, false);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("r1")] });
  assert.equal(b.engine.state.cards[b.id("r1")].faceDown, true, "flipped face-down");
  assert.equal(b.engine.state.cards[b.id("r1")].controllerId, P1);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play", "still a (Volition) resource in play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TC, "0:rule@eevv", "declining the pick flips nothing (it is a 'may')", () => {
  const b = tcBoard({ ee: 2, vv: 2, res: bank("rage", 2, P1) });
  const faceUpBefore = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && !b.engine.state.cards[c].faceDown);
  tcAttack(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  const faceUpAfter = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && !b.engine.state.cards[c].faceDown);
  assert.deepEqual(faceUpAfter, faceUpBefore);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TC, "0:rule@eevv", "only one resource is flipped per attack (two picks are refused)", () => {
  const b = tcBoard({ ee: 2, vv: 2, res: bank("rage", 2, P1) });
  tcAttack(b);
  const rages = b.engine.state.players[P1].play.filter((c) => b.engine.getDefinition(c)?.name === "Rage");
  assert.equal(rages.length, 2);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: rages }), "two picks");
});

clause(TC, "0:rule@eevv", "pickable: only face-up resources YOU control (not the opponent's, not already face-down, not non-resources)", () => {
  const make = () =>
    tcBoard({
      ee: 2,
      vv: 2,
      res: [
        { key: "mineUp", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "play" },
        { key: "theirUp", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "play" },
        { key: "theirDown", def: character({ name: "TheirDown" }), owner: P2, zone: "play", faceDown: true },
        { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }
      ]
    });
  const b = make();
  tcAttack(b);
  const downMine = b.engine.state.players[P1].play.find((c) => b.engine.state.cards[c].faceDown)!;
  for (const [pick, why] of [
    [b.id("theirUp"), "the opponent's face-up resource"],
    [b.id("theirDown"), "the opponent's face-down card"],
    [downMine, "my own already face-down resource"],
    [b.id("thing"), "my item (not a resource)"],
    [b.id("tc"), "the Convert itself (a character)"],
    [b.id("mine"), "another character"]
  ] as const) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [pick] }), why);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `still waiting after the refused pick: ${why}`);
  }
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mineUp")] });
  assert.equal(b.engine.state.cards[b.id("mineUp")].faceDown, true, "control: my face-up resource is accepted");
  assert.equal(b.engine.state.cards[b.id("theirUp")].faceDown ?? false, false);
});

clause(TC, "0:rule@eevv", "a face-up resource I control but do not own is flipped face-down under its OWNER's control", () => {
  const b = tcBoard({
    ee: 2,
    vv: 2,
    res: [{ key: "lent", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, controller: P1, zone: "play" }]
  });
  assert.equal(b.engine.state.cards[b.id("lent")].controllerId, P1);
  tcAttack(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("lent")] });
  assert.equal(b.engine.state.cards[b.id("lent")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("lent")].controllerId, P2, "under its owner's control");
});

clause(TC, "0:rule@eevv", "flipping one of the [E] resources face-down turns it into a [V], which ends the +1/+1 (E count drops to 1)", () => {
  const b = tcBoard({ ee: 2, vv: 2 });
  assert.deepEqual(stats(b.engine, b.id("tc")), [5, 2, 5]);
  tcAttack(b);
  const elit = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c)?.name === "Elitism")!;
  answerPending(b.engine, "chooserSelectsTarget", { selected: [elit] });
  assert.equal(b.engine.state.cards[elit].faceDown, true);
  assert.deepEqual(stats(b.engine, b.id("tc")), [4, 2, 4], "only one [E] left");
});

clause(TC, "0:rule@eevv", "no trigger without the full threshold: [E][E][V] only", () => {
  const b = tcBoard({ ee: 2, vv: 1, res: bank("rage", 2, P1) });
  tcAttack(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(b.engine.state.battle, "the attack itself went ahead");
});

clause(TC, "0:rule@eevv", "no trigger without the full threshold: [E][V][V] only", () => {
  const b = tcBoard({ ee: 1, vv: 2, res: bank("rage", 2, P1) });
  tcAttack(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TC, "0:rule@eevv", "only when THIS card attacks: another character attacking alone does not trigger it", () => {
  const b = tcBoard({ ee: 2, vv: 2, res: bank("rage", 2, P1) });
  tcAttack(b, ["mine"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
});

clause(TC, "0:rule@eevv", "attacking in a party with another character still triggers it (once)", () => {
  const b = tcBoard({ ee: 2, vv: 2, res: bank("rage", 2, P1) });
  tcAttack(b, ["tc", "mine"]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined, "asked only once");
});

clause(TC, "0:rule@eevv", "the pick is optional even when there is nothing to pick (no face-up resource): no soft-lock", () => {
  const b = tcBoard({ ee: 2, vv: 2 });
  const elit = b.engine.state.players[P1].play.filter((c) => b.engine.getDefinition(c)?.name === "Elitism");
  assert.equal(elit.length, 2);
  tcAttack(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// -- FLIP UP: 4 [V][V][V][V] ---------------------------------------------------

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });

function tcFlipBoard(o: { ready?: number; spentV?: number; extra?: Pl[]; active?: PlayerId }) {
  return buildGame({
    ...factions,
    turn: o.active === P2 ? 2 : 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "tc", def: printing(TC), owner: P1, zone: "play", faceDown: true },
      ...volition(o.ready ?? 0, P1),
      ...spentVolition(o.spentV ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(TC, "1:flipUp", "flips up into a face-up character with the printed 4/2/4 and stops being a resource", () => {
  const b = tcFlipBoard({ ready: 4 });
  assert.equal(readyResources(b.engine, P1), 5, "setup: itself + 4 face-down resources");
  rawFlipUp(b.engine, P1, b.id("tc"));
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  const card = b.engine.state.cards[b.id("tc")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  assert.deepEqual(b.engine.getCardTypes(b.id("tc")), ["character"]);
  assert.equal(b.engine.isResource(b.id("tc")), false);
  assert.deepEqual(stats(b.engine, b.id("tc")), [4, 2, 4]);
});

clause(TC, "1:flipUp", "costs exactly 4: itself plus 3 others (with a 4th [V] already spent) is enough", () => {
  const b = tcFlipBoard({ ready: 3, spentV: 1 });
  assert.equal(readyResources(b.engine, P1), 4, "itself + 3 others ready");
  rawFlipUp(b.engine, P1, b.id("tc"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, false, "the card may help pay its own FLIP UP cost (CR 507.4b)");
  assert.equal(readyResources(b.engine, P1), 0, "all four were paid");
});

clause(TC, "1:flipUp", "is refused one resource short (cost 4 with only 3 ready, though 4 [V] are on the table)", () => {
  const b = tcFlipBoard({ ready: 2, spentV: 2 });
  assert.equal(readyResources(b.engine, P1), 3, "itself + 2 ready others");
  refused(() => rawFlipUp(b.engine, P1, b.id("tc")), "cost short");
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, true, "still face-down");
  assert.equal(readyResources(b.engine, P1), 3, "nothing was paid");
});

clause(TC, "1:flipUp", "the threshold [V][V][V][V] is met AFTER flipping, so the card's own [V] does not count: itself + 3 others is refused", () => {
  const b = tcFlipBoard({ ready: 3 });
  assert.equal(readyResources(b.engine, P1), 4, "4 ready resources pay the cost, but only 3 other face-down cards remain");
  refused(() => rawFlipUp(b.engine, P1, b.id("tc")), "only 3 [V] once it is face-up");
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 4, "nothing was paid");
});

clause(TC, "1:flipUp", "with 4 other face-down cards the threshold is met after flipping", () => {
  const b = tcFlipBoard({ ready: 4 });
  rawFlipUp(b.engine, P1, b.id("tc"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, false);
});

clause(TC, "1:flipUp", "needs [V]: face-up Rage resources do not provide the threshold", () => {
  const b = tcFlipBoard({ ready: 0, extra: bank("rage", 6, P1) });
  assert.equal(readyResources(b.engine, P1), 7);
  refused(() => rawFlipUp(b.engine, P1, b.id("tc")), "plenty of resources but no [V]");
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 7);
  const mixed = tcFlipBoard({ ready: 2, extra: bank("rage", 3, P1) });
  refused(() => rawFlipUp(mixed.engine, P1, mixed.id("tc")), "only 2 face-down others plus itself, Rage adds no [V]");
});

clause(TC, "1:flipUp", "the opponent's [V] do not count for the threshold", () => {
  const b = tcFlipBoard({ ready: 2, extra: volition(4, P2) });
  refused(() => rawFlipUp(b.engine, P1, b.id("tc")), "only my own face-down cards count");
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, true);
});

clause(TC, "1:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn", () => {
  const b = tcFlipBoard({ ready: 4, active: P2 });
  refused(() => rawFlipUp(b.engine, P1, b.id("tc")), "a character on the opponent's turn");
  assert.equal(b.engine.state.cards[b.id("tc")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 5, "nothing was paid");
});

// ============================================================================
// Undesirable Intrusion -- tactic, cost 0 [E][E][E]
// EXTRA COST: Your opponents cannot respond to this card. Deploy this only in response to a character's ability.
// Terminate the ability. Destroy the character. Its controller puts a micromajig token into play under their control.
// FLIP UP: 2 [E]
// ============================================================================

const UI = "cbffb937-448e-425e-ac37-fa1d856a07c8";

const mageAbility = (name: string) =>
  character({
    name,
    strength: 2,
    life: 3,
    behavior: { abilities: [{ id: "draw1", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

/** P2's turn: P2 owns a mage (draws on use), an item and a location with the same ability. P1 holds the Intrusion. */
function uiBoard(o: { res?: Pl[]; uiFaceDown?: boolean; extra?: Pl[]; active?: PlayerId } = {}) {
  const drawAbility = { abilities: [{ id: "draw1", type: "activated" as const, effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }] }] };
  return buildGame({
    ...factions,
    turn: o.active === P1 ? 1 : 2,
    activePlayerId: o.active ?? P2,
    cards: [
      { key: "ui", def: printing(UI), owner: P1, zone: o.uiFaceDown ? "play" : "hand", faceDown: o.uiFaceDown },
      { key: "mage", def: mageAbility("Mage"), owner: P2, zone: "play" },
      { key: "mage2", def: mageAbility("Mage2"), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget", behavior: drawAbility }), owner: P2, zone: "play" },
      { key: "spot", def: location({ name: "Spot", behavior: drawAbility }), owner: P2, zone: "play" },
      ...fillers("pd", 4, P2, "deck"),
      ...fillers("md", 4, P1, "deck"),
      ...(o.res ?? bank("elitism", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}

const useAbility = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void =>
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId: "draw1", selected: {}, variables: {} } as never);

const micromajigsOf = (engine: SpoilsEngine, owner: PlayerId): CardInstanceId[] =>
  Object.keys(engine.state.cards).filter(
    (c) => engine.getDefinition(c as CardInstanceId)?.name === "Micromajig" && engine.state.cards[c as CardInstanceId].zone === "play" && engine.state.cards[c as CardInstanceId].controllerId === owner
  ) as CardInstanceId[];

clause(UI, "0:extraCost", "is a free tactic needing [E][E][E]: with 3 [E] it deploys and spends nothing", () => {
  assert.equal(printing(UI).type, "tactic");
  assert.equal(printing(UI).trade, "gearsmith");
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("mage"));
  assert.equal(readyResources(b.engine, P1), 3);
  playRaw(b.engine, P1, b.id("ui"));
  assert.equal(readyResources(b.engine, P1), 3, "cost 0: no resource is spent");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard");
});

clause(UI, "0:extraCost", "threshold [E][E][E]: refused with only 2 [E] (plus plenty of other resources), and the opponent's [E] do not count", () => {
  const two = uiBoard({ res: [...bank("elitism", 2, P1), ...bank("rage", 5, P1)] });
  useAbility(two.engine, P2, two.id("mage"));
  refused(() => playRaw(two.engine, P1, two.id("ui")), "only two [E]");
  assert.equal(zoneOf(two.engine, two.id("ui")), "hand");
  const theirs = uiBoard({ res: [...bank("elitism", 2, P1), ...bank("elitism", 3, P2)] });
  useAbility(theirs.engine, P2, theirs.id("mage"));
  refused(() => playRaw(theirs.engine, P1, theirs.id("ui")), "the opponent's [E] do not count");
  const spent = uiBoard({ res: [...spentBank("elitism", 2, P1), ...bank("elitism", 1, P1)] });
  useAbility(spent.engine, P2, spent.id("mage"));
  playRaw(spent.engine, P1, spent.id("ui"));
  resolvePendingResponses(spent.engine);
  assert.equal(zoneOf(spent.engine, spent.id("ui")), "discard", "control: spent [E] count toward the threshold");
});

clause(UI, "0:extraCost", "may only be deployed in response to an ability: refused when nothing is on the stack", () => {
  const b = uiBoard({ active: P1 });
  refused(() => playRaw(b.engine, P1, b.id("ui")), "no ability to respond to, even on my own turn", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
  const ctl = uiBoard();
  useAbility(ctl.engine, P2, ctl.id("mage"));
  playRaw(ctl.engine, P1, ctl.id("ui"));
  resolvePendingResponses(ctl.engine);
  assert.equal(zoneOf(ctl.engine, ctl.id("ui")), "discard", "control: with an ability to answer it deploys");
});

clause(UI, "0:extraCost", "may only be deployed in response to an ability OF A CHARACTER: refused against an item's ability", () => {
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("gadget"));
  refused(() => playRaw(b.engine, P1, b.id("ui")), "an item's ability is not a character's ability");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gadget")), "play");
});

clause(UI, "0:extraCost", "may only be deployed in response to an ability OF A CHARACTER: refused against a location's ability", () => {
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("spot"));
  refused(() => playRaw(b.engine, P1, b.id("ui")), "a location's ability is not a character's ability");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
  assert.equal(zoneOf(b.engine, b.id("spot")), "play");
});

clause(UI, "0:extraCost", "may only be deployed in response to an ability: refused against a tactic being deployed", () => {
  const b = uiBoard({ extra: [{ key: "cheap", def: tactic({ name: "Cheap", cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("cheap"));
  refused(() => playRaw(b.engine, P1, b.id("ui")), "a tactic is not a character's ability", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
});

clause(UI, "0:extraCost", "(T3c9) may only be deployed in response to an ability: refused against a character CARD being deployed (a character, but no ability)", () => {
  const b = uiBoard({ extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("newbie"));
  refused(() => playRaw(b.engine, P1, b.id("ui")), "a character being deployed is not a character's ability", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand", "the Intrusion stays in hand");
});

clause(UI, "0:extraCost", "your opponents cannot respond to it: the opponent's own free tactic is refused while it is on the stack (a plain tactic allows the response)", () => {
  const free = (name: string) =>
    tactic({ name, cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const plainBoard = uiBoard({
    extra: [
      { key: "plain", def: free("Plain"), owner: P1, zone: "hand" },
      { key: "answer", def: free("Answer"), owner: P2, zone: "hand" }
    ]
  });
  useAbility(plainBoard.engine, P2, plainBoard.id("mage"));
  playRaw(plainBoard.engine, P1, plainBoard.id("plain"));
  playRaw(plainBoard.engine, P2, plainBoard.id("answer"));
  assert.equal(zoneOf(plainBoard.engine, plainBoard.id("answer")) !== "hand", true, "control: the opponent can respond to an ordinary tactic");
  const b = uiBoard({ extra: [{ key: "answer", def: free("Answer"), owner: P2, zone: "hand" }] });
  useAbility(b.engine, P2, b.id("mage"));
  playRaw(b.engine, P1, b.id("ui"));
  // Nobody may respond to it: it resolved at once, ended the ability beneath, and the window closed on the empty stack.
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard", "it resolved without the opponent being offered a response");
  assert.equal(b.engine.state.responseWindow, undefined, "nothing is left to respond to: the window closed");
  assert.equal(zoneOf(b.engine, b.id("answer")), "hand");
});

clause(UI, "0:extraCost", "CR 607.1: you can never respond to your OWN ability: refused against my own character's ability on my turn (control: the same ability by the opponent's mage is answered)", () => {
  const own = uiBoard({ active: P1, extra: [{ key: "mine", def: mageAbility("Mine"), owner: P1, zone: "play" }] });
  useAbility(own.engine, P1, own.id("mine"));
  refused(() => playRaw(own.engine, P1, own.id("ui")), "responding to my own ability is not allowed", /not your priority/i);
  assert.equal(zoneOf(own.engine, own.id("ui")), "hand");
  assert.equal(readyResources(own.engine, P1), 3, "nothing was paid");
  const foe = uiBoard({ extra: [{ key: "mine", def: mageAbility("Mine"), owner: P1, zone: "play" }] });
  useAbility(foe.engine, P2, foe.id("mage"));
  playRaw(foe.engine, P1, foe.id("ui"));
  resolvePendingResponses(foe.engine);
  assert.equal(zoneOf(foe.engine, foe.id("ui")), "discard", "control: the opponent's character ability can be answered");
});

clause(UI, "1:rule", "terminates the ability: the targeted ability's effect does not happen (no card drawn)", () => {
  const b = uiBoard();
  const handBefore = b.engine.state.players[P2].hand.length;
  const deckBefore = b.engine.state.players[P2].deck.length;
  useAbility(b.engine, P2, b.id("mage"));
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.players[P2].hand.length, handBefore, "no draw");
  assert.equal(b.engine.state.players[P2].deck.length, deckBefore);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UI, "1:rule", "without the Intrusion the ability does resolve (control for the draw check)", () => {
  const b = uiBoard();
  const handBefore = b.engine.state.players[P2].hand.length;
  useAbility(b.engine, P2, b.id("mage"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.players[P2].hand.length, handBefore + 1);
});

clause(UI, "1:rule", "destroys the character: it goes to its owner's discard pile; its cost (deplete) was already paid; other characters are untouched", () => {
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("mage"));
  assert.equal(b.engine.state.cards[b.id("mage")].depleted, true, "setup: the ability's cost was paid");
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mage")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mage2")), "play");
  assert.equal(zoneOf(b.engine, b.id("gadget")), "play");
});

clause(UI, "1:rule", "its controller puts exactly one Micromajig token (a 1/3/1 gearsmith majig character) into play under their control", () => {
  const b = uiBoard();
  assert.equal(micromajigsOf(b.engine, P2).length, 0);
  useAbility(b.engine, P2, b.id("mage"));
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  const tokens = micromajigsOf(b.engine, P2);
  assert.equal(tokens.length, 1, "exactly one token under the destroyed character's controller");
  assert.equal(micromajigsOf(b.engine, P1).length, 0, "not under the Intrusion's controller");
  const tok = tokens[0];
  assert.deepEqual(stats(b.engine, tok), [1, 3, 1]);
  assert.ok(b.engine.getDefinition(tok)?.subtype?.includes("majig"), "b.engine.getDefinition(tok)?.subtype?.includes(\"majig\")");
  assert.equal(b.engine.state.cards[tok].controllerId, P2);
});

clause(UI, "1:rule", "the Micromajig token is a Gearsmith character card (CR 409.3c)", () => {
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("mage"));
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  const tok = micromajigsOf(b.engine, P2)[0];
  assert.deepEqual(b.engine.getCardTypes(tok), ["character"]);
  assert.equal(b.engine.getDefinition(tok)?.trade, "gearsmith");
});

clause(UI, "1:rule", "the token goes to the destroyed character's CONTROLLER, not its owner (a stolen character)", () => {
  const b = uiBoard({
    extra: [{ key: "lent", def: mageAbility("Lent"), owner: P1, controller: P2, zone: "play" }]
  });
  useAbility(b.engine, P2, b.id("lent"));
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("lent")), "discard");
  assert.equal(micromajigsOf(b.engine, P2).length, 1, "its controller (P2) gets the token");
  assert.equal(micromajigsOf(b.engine, P1).length, 0, "not its owner");
});

clause(UI, "1:rule", "answering a second character's ability destroys that character, not the first", () => {
  const b = uiBoard();
  useAbility(b.engine, P2, b.id("mage2"));
  playRaw(b.engine, P1, b.id("ui"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mage2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mage")), "play");
  assert.equal(b.engine.state.players[P2].hand.length, 0);
});

const uiFlip = (b: ReturnType<typeof uiBoard>) => rawFlipUp(b.engine, P1, b.id("ui"));

clause(UI, "2:flipUp", "a face-down Intrusion flips up for 2 with an [E], terminating the ability and destroying the character", () => {
  const b = uiBoard({ uiFaceDown: true, res: bank("elitism", 1, P1) });
  assert.equal(readyResources(b.engine, P1), 2, "setup: itself + one [E]");
  useAbility(b.engine, P2, b.id("mage"));
  const handBefore = b.engine.state.players[P2].hand.length;
  uiFlip(b);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mage")), "discard");
  assert.equal(b.engine.state.players[P2].hand.length, handBefore, "ability terminated");
  assert.equal(micromajigsOf(b.engine, P2).length, 1);
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard", "the tactic was used up");
  assert.equal(readyResources(b.engine, P1), 0, "2 paid");
});

clause(UI, "2:flipUp", "costs exactly 2: refused with only itself ready (the [E] already spent)", () => {
  const b = uiBoard({ uiFaceDown: true, res: spentBank("elitism", 1, P1) });
  assert.equal(readyResources(b.engine, P1), 1);
  useAbility(b.engine, P2, b.id("mage"));
  refused(() => uiFlip(b), "cost 2 with one ready resource");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("mage")), "play");
  const ok = uiBoard({ uiFaceDown: true, res: [...spentBank("elitism", 1, P1), ...bank("rage", 1, P1)] });
  useAbility(ok.engine, P2, ok.id("mage"));
  uiFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("mage")), "discard", "control: itself + a ready Rage pays 2, the spent [E] is the threshold");
});

clause(UI, "2:flipUp", "needs [E]: refused with enough resources but no [E] (the face-down card's own Volition is not [E])", () => {
  const b = uiBoard({ uiFaceDown: true, res: bank("rage", 4, P1) });
  useAbility(b.engine, P2, b.id("mage"));
  refused(() => uiFlip(b), "no [E]");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 5, "nothing was paid");
  const theirs = uiBoard({ uiFaceDown: true, res: [...bank("rage", 4, P1), ...bank("elitism", 2, P2)] });
  useAbility(theirs.engine, P2, theirs.id("mage"));
  refused(() => uiFlip(theirs), "the opponent's [E] do not count");
});

clause(UI, "2:flipUp", "FLIP UP keeps the extra cost: refused when it is not in response to a character's ability", () => {
  const b = uiBoard({ uiFaceDown: true, res: bank("elitism", 3, P1) });
  refused(() => uiFlip(b), "nothing to respond to");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 4, "nothing was paid");
  assert.equal(zoneOf(b.engine, b.id("mage")), "play");
});

// ============================================================================
// Zenobia, Artificer -- character (sorceress), cost 2 [E][E], 1 str / 3 spd / 3 life
// UNIQUE ZENOBIA
// DISENCHANT: Deplete this card. Discard an item. X is its numeric cost. -> Put X tokens on this card.
// CLAIRVOYANCE: Deplete this card. Choose X > 0. Remove X tokens from this card.
//   -> Search your deck for a card with numeric cost X or less, reveal it, and put it into your hand.
// ============================================================================

const ZEN = "6d5dffbe-9724-4ed6-89f7-58189567f5af";
const ZEN_B = "2df3c789-ac84-4aba-9652-968cefb669f4";

function zenBoard(o: { tokens?: number; hand?: Pl[]; deck?: Pl[]; res?: Pl[]; extra?: Pl[]; id?: string; zenDepleted?: boolean } = {}) {
  return buildGame({
    ...factions,
    random: () => 0.3,
    cards: [
      { key: "za", def: printing(o.id ?? ZEN), owner: P1, zone: "play", counters: o.tokens ? { token: o.tokens } : undefined, depleted: o.zenDepleted },
      ...(o.hand ?? []),
      ...(o.deck ?? []),
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ]
  });
}

clause(ZEN, "0:unique", "printed as a 1 strength / 3 speed / 3 life gearsmith sorceress costing 2 [E][E]: deploys with exactly two [E]", () => {
  assert.equal(printing(ZEN).type, "character");
  assert.equal(printing(ZEN).trade, "gearsmith");
  assert.deepEqual(printing(ZEN).subtype, ["sorceress"]);
  const g = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }, ...bank("elitism", 2, P1)] });
  assert.equal(readyResources(g.engine, P1), 2);
  play(g.engine, P1, g.id("zh"));
  assert.equal(zoneOf(g.engine, g.id("zh")), "play");
  assert.equal(readyResources(g.engine, P1), 0, "cost 2 paid");
  assert.deepEqual(stats(g.engine, g.id("zh")), [1, 3, 3]);
  assert.deepEqual(g.engine.getCardTypes(g.id("zh")), ["character"]);
});

clause(ZEN, "0:unique", "cost 2 is isolated from the threshold: two spent [E] plus one ready Rage is one short; plus two Rage works", () => {
  const short = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }, ...spentBank("elitism", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("zh")), "only one ready resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("zh")), "hand");
  const ok = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }, ...spentBank("elitism", 2, P1), ...bank("rage", 2, P1)] });
  play(ok.engine, P1, ok.id("zh"));
  assert.equal(zoneOf(ok.engine, ok.id("zh")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(ZEN, "0:unique", "threshold [E][E]: one [E] is not enough, and the opponent's [E] do not count", () => {
  const one = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("rage", 4, P1)] });
  refused(() => playRaw(one.engine, P1, one.id("zh")), "one icon short");
  const theirs = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("rage", 4, P1), ...bank("elitism", 3, P2)] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("zh")), "the opponent's [E]");
  assert.equal(zoneOf(theirs.engine, theirs.id("zh")), "hand");
  const none = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN), owner: P1, zone: "hand" }] });
  refused(() => playRaw(none.engine, P1, none.id("zh")), "no resources");
});

const uniqueBoard = (inPlayId: string, handId: string, o: { handOwner?: PlayerId; active?: PlayerId } = {}) =>
  buildGame({
    ...factions,
    turn: o.active === P2 ? 2 : 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "z1", def: printing(inPlayId), owner: P1, zone: "play" },
      { key: "z2", def: printing(handId), owner: o.handOwner ?? P1, zone: "hand" },
      ...bank("elitism", 2, o.handOwner ?? P1)
    ]
  });

clause(ZEN, "0:unique", "controlling a second Zenobia makes you keep one: keeping the new one destroys the old one", () => {
  const b = uniqueBoard(ZEN, ZEN);
  play(b.engine, P1, b.id("z2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("z1"), b.id("z2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("z2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("z2")), "play");
  assert.equal(zoneOf(b.engine, b.id("z1")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ZEN, "0:unique", "keeping the old Zenobia destroys the new one", () => {
  const b = uniqueBoard(ZEN, ZEN);
  play(b.engine, P1, b.id("z2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("z1") } } as never);
  assert.equal(zoneOf(b.engine, b.id("z1")), "play");
  assert.equal(zoneOf(b.engine, b.id("z2")), "discard");
});

clause(ZEN_B, "0:unique", "the other printing of Zenobia shares the UNIQUE designation: it conflicts with the first printing", () => {
  const b = uniqueBoard(ZEN, ZEN_B);
  play(b.engine, P1, b.id("z2"));
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("z1") } } as never);
  assert.equal(zoneOf(b.engine, b.id("z1")), "play");
  assert.equal(zoneOf(b.engine, b.id("z2")), "discard");
});

clause(ZEN_B, "0:unique", "the second printing is a gearsmith sorceress 1/3/3 costing 2 [E][E] like the first", () => {
  assert.equal(printing(ZEN_B).type, "character");
  assert.equal(printing(ZEN_B).trade, "gearsmith");
  assert.deepEqual(printing(ZEN_B).subtype, ["sorceress"]);
  const g = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN_B), owner: P1, zone: "hand" }, ...bank("elitism", 2, P1)] });
  play(g.engine, P1, g.id("zh"));
  assert.equal(zoneOf(g.engine, g.id("zh")), "play");
  assert.equal(readyResources(g.engine, P1), 0);
  assert.deepEqual(stats(g.engine, g.id("zh")), [1, 3, 3]);
  const short = buildGame({ ...factions, cards: [{ key: "zh", def: printing(ZEN_B), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("zh")), "one [E] short", /Threshold requirements are not met/);
});

clause(ZEN, "0:unique", "the restriction is per player: the opponent may control their own Zenobia, with no choice and no destruction", () => {
  const b = uniqueBoard(ZEN, ZEN, { handOwner: P2, active: P2 });
  play(b.engine, P2, b.id("z2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("z1")), "play");
  assert.equal(zoneOf(b.engine, b.id("z2")), "play");
});

clause(ZEN, "0:unique", "taking control of the opponent's Zenobia while you have your own is a duplicate: you must keep one", () => {
  const b = buildGame({
    ...factions,
    cards: [
      { key: "z1", def: printing(ZEN), owner: P1, zone: "play" },
      { key: "z2", def: printing(ZEN), owner: P2, zone: "play" },
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(b.engine.state.pendingChoice, undefined, "one each is fine");
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("z2")] } });
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(ZEN, "0:unique", "a character with a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = buildGame({
    ...factions,
    cards: [
      { key: "z1", def: printing(ZEN), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "Other", unique: "someone-else" } as never), owner: P1, zone: "play" },
      { key: "o2", def: character({ name: "Plain" }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("z1")), "play");
  assert.equal(zoneOf(b.engine, b.id("o1")), "play");
});

// -- DISENCHANT ------------------------------------------------------------------

const items = (): Pl[] => [
  { key: "i3", def: item({ name: "Item3", cost: 3 }), owner: P1, zone: "hand" },
  { key: "i1", def: item({ name: "Item1", cost: 1 }), owner: P1, zone: "hand" },
  { key: "i0", def: item({ name: "Item0", cost: 0 }), owner: P1, zone: "hand" },
  { key: "ch", def: character({ name: "HandChar", cost: 4 }), owner: P1, zone: "hand" },
  { key: "tac", def: tactic({ name: "HandTactic", cost: 5 }), owner: P1, zone: "hand" },
  { key: "ip", def: item({ name: "InPlayItem", cost: 6 }), owner: P1, zone: "play" },
  { key: "oi", def: item({ name: "TheirItem", cost: 7 }), owner: P2, zone: "hand" }
];

/** Activate DISENCHANT and answer whatever discard choice opens with `key`. */
function disenchant(b: ReturnType<typeof zenBoard>, key: string): void {
  activate(b.engine, P1, b.id("za"), "disenchant", { selected: { discard: [b.id(key)] }, variables: {} });
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget" || pc.kind === "chooserSelectsCost" || /discard/i.test(pc.kind)) {
      return { kind: pc.kind, selected: [b.id(key)] };
    }
    return declineAll(pc);
  });
}

clause(ZEN, "1:ability:disenchant", "discarding an item with numeric cost 3 puts 3 tokens on Zenobia, depletes her and discards the item", () => {
  const b = zenBoard({ hand: items() });
  disenchant(b, "i3");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i3")), "discard", "COST: the item is discarded");
  assert.equal(b.engine.state.cards[b.id("za")].depleted, true, "COST: deplete this card");
  assert.equal(tokensOn(b.engine, b.id("za")), 3, "X = the item's numeric cost");
});

clause(ZEN, "1:ability:disenchant", "X follows the discarded item's cost: cost 1 gives 1 token, cost 0 gives none", () => {
  const b = zenBoard({ hand: items() });
  disenchant(b, "i1");
  assert.equal(tokensOn(b.engine, b.id("za")), 1);
  const z = zenBoard({ hand: items() });
  disenchant(z, "i0");
  assert.equal(zoneOf(z.engine, z.id("i0")), "discard");
  assert.equal(tokensOn(z.engine, z.id("za")), 0);
  assert.equal(z.engine.state.cards[z.id("za")].depleted, true);
});

clause(ZEN, "1:ability:disenchant", "tokens accumulate on top of the ones already there", () => {
  const b = zenBoard({ hand: items(), tokens: 2 });
  disenchant(b, "i3");
  assert.equal(tokensOn(b.engine, b.id("za")), 5);
});

clause(ZEN, "1:ability:disenchant", "only an item may be discarded: a character, a tactic, an item in play and the opponent's item are refused", () => {
  const b = zenBoard({ hand: items() });
  for (const [key, why] of [
    ["ch", "a character card in hand"],
    ["tac", "a tactic card in hand"],
    ["ip", "an item already in play"],
    ["oi", "the opponent's item"]
  ] as const) {
    refused(() => disenchant(b, key), why);
    assert.equal(tokensOn(b.engine, b.id("za")), 0, `no tokens: ${why}`);
    assert.equal(b.engine.state.cards[b.id("za")].depleted ?? false, false, `not depleted: ${why}`);
  }
  assert.equal(zoneOf(b.engine, b.id("ch")), "hand");
  assert.equal(zoneOf(b.engine, b.id("ip")), "play");
  disenchant(b, "i3");
  assert.equal(tokensOn(b.engine, b.id("za")), 3, "control: an item in hand works");
});

clause(ZEN, "1:ability:disenchant", "refused with no item in hand (the cost cannot be paid), works with one", () => {
  const ctl = zenBoard({ hand: items() });
  disenchant(ctl, "i3");
  assert.equal(tokensOn(ctl.engine, ctl.id("za")), 3, "control: with an item in hand it works");
  const b = zenBoard({ hand: items().filter((c) => !["i3", "i1", "i0"].includes(c.key)) });
  refused(() => activate(b.engine, P1, b.id("za"), "disenchant", { selected: {}, variables: {} }), "no item to discard");
  assert.equal(b.engine.state.cards[b.id("za")].depleted ?? false, false);
  assert.equal(tokensOn(b.engine, b.id("za")), 0);
});

clause(ZEN, "1:ability:disenchant", "cannot be used while Zenobia is depleted (and the item stays in hand)", () => {
  const ctl = zenBoard({ hand: items() });
  disenchant(ctl, "i3");
  assert.equal(tokensOn(ctl.engine, ctl.id("za")), 3, "control: not depleted, it works");
  const b = zenBoard({ hand: items(), zenDepleted: true });
  refused(() => disenchant(b, "i3"), "already depleted");
  assert.equal(zoneOf(b.engine, b.id("i3")), "hand");
  assert.equal(tokensOn(b.engine, b.id("za")), 0);
});

// -- CLAIRVOYANCE ------------------------------------------------------------------

const deckCards = (): Pl[] => [
  { key: "c0", def: character({ name: "Cost0", cost: 0 }), owner: P1, zone: "deck" },
  { key: "c1", def: character({ name: "Cost1", cost: 1 }), owner: P1, zone: "deck" },
  { key: "c2", def: item({ name: "Cost2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "c3", def: tactic({ name: "Cost3", cost: 3 }), owner: P1, zone: "deck" },
  { key: "c5", def: character({ name: "Cost5", cost: 5 }), owner: P1, zone: "deck" },
  { key: "c6", def: character({ name: "Cost6", cost: 6 }), owner: P1, zone: "deck" },
  { key: "oc1", def: character({ name: "TheirCost1", cost: 1 }), owner: P2, zone: "deck" },
  { key: "oc2", def: character({ name: "TheirCost2", cost: 2 }), owner: P2, zone: "deck" }
];

/** Activate CLAIRVOYANCE with X and answer the search pick with `pick` (undefined = decline). */
function clairvoyance(b: ReturnType<typeof zenBoard>, x: number, pick?: string): void {
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x } });
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: pick ? [b.id(pick)] : [] } : declineAll(pc)));
}

clause(ZEN, "2:ability:clairvoyance", "X=2 removes 2 of 3 tokens, depletes Zenobia and tutors a cost-2 card into hand (revealed)", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  clairvoyance(b, 2, "c2");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("za")), 1, "COST: remove X tokens");
  assert.equal(b.engine.state.cards[b.id("za")].depleted, true, "COST: deplete this card");
  assert.equal(zoneOf(b.engine, b.id("c2")), "hand", "the card goes to the hand");
  assert.equal(b.engine.state.players[P1].hand.length, 1);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "the card is revealed");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("c2")]);
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(ZEN, "2:ability:clairvoyance", "cost X or less: any card of cost 0, 1 or 2 is findable with X=2 (any card type)", () => {
  for (const key of ["c0", "c1", "c2"]) {
    const b = zenBoard({ tokens: 3, deck: deckCards() });
    clairvoyance(b, 2, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} (cost <= 2) can be found`);
  }
});

clause(ZEN, "2:ability:clairvoyance", "a card costing more than X cannot be picked: X=2 refuses the cost-3 card, X=3 accepts it", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 2 } });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c3")] }), "cost 3 > X=2");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c5")] }), "cost 5 > X=2");
  assert.equal(zoneOf(b.engine, b.id("c3")), "deck");
  const ok = zenBoard({ tokens: 3, deck: deckCards() });
  clairvoyance(ok, 3, "c3");
  assert.equal(zoneOf(ok.engine, ok.id("c3")), "hand", "control: X=3 reaches cost 3");
  assert.equal(tokensOn(ok.engine, ok.id("za")), 0);
});

clause(ZEN, "2:ability:clairvoyance", "X=1 reaches cost 1 but not cost 2", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 1 } });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c2")] }), "cost 2 > X=1");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c1")] });
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
  assert.equal(tokensOn(b.engine, b.id("za")), 2);
});

clause(ZEN, "2:ability:clairvoyance", "searches only YOUR deck: the opponent's cheap cards cannot be picked", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 2 } });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc1")] }), "the opponent's deck");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c1")] });
  assert.equal(zoneOf(b.engine, b.id("oc1")), "deck");
  assert.equal(b.engine.state.players[P2].hand.length, 0);
});

clause(ZEN, "2:ability:clairvoyance", "only a card in the deck can be found: a cheap card in hand or discard is not a candidate", () => {
  const b = zenBoard({
    tokens: 3,
    deck: deckCards(),
    extra: [
      { key: "hc", def: character({ name: "HandCheap", cost: 1 }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscardCheap", cost: 1 }), owner: P1, zone: "discard" }
    ]
  });
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 2 } });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dc")] }), "a card in the discard pile");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("hc")] }), "a card already in hand");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c0")] });
  assert.equal(zoneOf(b.engine, b.id("dc")), "discard");
});

clause(ZEN, "2:ability:clairvoyance", "picks exactly one card (two picks are refused)", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 2 } });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c1"), b.id("c2")] }), "two picks");
});

clause(ZEN, "2:ability:clairvoyance", "searching shuffles the deck afterwards (CR 312.1): the remaining cards end up in a different order", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  const before = [...b.engine.state.players[P1].deck];
  clairvoyance(b, 2, "c2");
  const after = b.engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), before.filter((c) => c !== b.id("c2")).sort(), "the same cards, minus the found one");
  assert.notDeepEqual(after, before.filter((c) => c !== b.id("c2")), "reshuffled");
});

clause(ZEN, "2:ability:clairvoyance", "the search may find nothing: declining leaves the card in the deck, but the cost (tokens, deplete) is still paid", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  clairvoyance(b, 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c2")), "deck");
  assert.equal(b.engine.state.players[P1].hand.length, 0);
  assert.equal(tokensOn(b.engine, b.id("za")), 1);
  assert.equal(b.engine.state.cards[b.id("za")].depleted, true);
});

clause(ZEN, "2:ability:clairvoyance", "a failed search (no card costs X or less) still shuffles the deck (CR 312.1)", () => {
  const deck: Pl[] = [5, 6, 7, 8, 9, 10].map((cost) => ({ key: `e${cost}`, def: character({ name: `Exp${cost}`, cost }), owner: P1, zone: "deck" as const }));
  const b = zenBoard({ tokens: 3, deck });
  const before = [...b.engine.state.players[P1].deck];
  clairvoyance(b, 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.players[P1].hand.length, 0);
  assert.equal(tokensOn(b.engine, b.id("za")), 2, "the cost was still paid");
  const after = b.engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "reshuffled even though nothing was found");
});

clause(ZEN, "2:ability:clairvoyance", "X must be greater than 0: X=0 is refused and nothing is paid", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  refused(() => activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 0 } }), "X=0");
  assert.equal(tokensOn(b.engine, b.id("za")), 3);
  assert.equal(b.engine.state.cards[b.id("za")].depleted ?? false, false);
});

clause(ZEN, "2:ability:clairvoyance", "X cannot exceed the tokens on Zenobia: X=4 with 3 tokens is refused, X=3 (all of them) works", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards() });
  refused(() => activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 4 } }), "X=4 > 3 tokens");
  assert.equal(tokensOn(b.engine, b.id("za")), 3);
  assert.equal(b.engine.state.cards[b.id("za")].depleted ?? false, false);
  clairvoyance(b, 3, "c3");
  assert.equal(tokensOn(b.engine, b.id("za")), 0);
  assert.equal(zoneOf(b.engine, b.id("c3")), "hand");
});

clause(ZEN, "2:ability:clairvoyance", "needs tokens: refused with none on the card", () => {
  const b = zenBoard({ deck: deckCards() });
  refused(() => activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 1 } }), "no tokens to remove");
  assert.equal(b.engine.state.cards[b.id("za")].depleted ?? false, false);
});

clause(ZEN, "2:ability:clairvoyance", "cannot be used while Zenobia is depleted (tokens stay)", () => {
  const b = zenBoard({ tokens: 3, deck: deckCards(), zenDepleted: true });
  refused(() => activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 1 } }), "depleted");
  assert.equal(tokensOn(b.engine, b.id("za")), 3);
});

clause(ZEN, ["1:ability:disenchant", "2:ability:clairvoyance"], "Zenobia is depleted by either ability, so only one can be used per restore; both abilities work off the same token pool", () => {
  const b = zenBoard({ hand: items(), deck: deckCards() });
  disenchant(b, "i3");
  assert.equal(tokensOn(b.engine, b.id("za")), 3);
  refused(() => activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x: 1 } }), "depleted by DISENCHANT");
  b.engine.state.cards[b.id("za")].depleted = false;
  clairvoyance(b, 3, "c3");
  assert.equal(zoneOf(b.engine, b.id("c3")), "hand", "tokens from DISENCHANT feed CLAIRVOYANCE");
  assert.equal(tokensOn(b.engine, b.id("za")), 0);
});

// -- T3c9 mutation pass: the second printing's abilities, and who picks the CLAIRVOYANCE card ----------------

const zenDisenchantBody = (zid: string) => () => {
  const b = zenBoard({ id: zid, hand: items() });
  disenchant(b, "i3");
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice left open");
  assert.equal(zoneOf(b.engine, b.id("i3")), "discard", "COST: the item is discarded");
  assert.equal(zoneOf(b.engine, b.id("i1")), "hand", "exactly one item is discarded");
  assert.equal(b.engine.state.cards[b.id("za")].depleted, true, "COST: deplete this card");
  assert.equal(tokensOn(b.engine, b.id("za")), 3, "X = the item's numeric cost");
  const one = zenBoard({ id: zid, hand: items(), tokens: 2 });
  disenchant(one, "i1");
  assert.equal(tokensOn(one.engine, one.id("za")), 3, "a cost-1 item adds 1 token to the 2 already there");
  const zero = zenBoard({ id: zid, hand: items() });
  disenchant(zero, "i0");
  assert.equal(zoneOf(zero.engine, zero.id("i0")), "discard", "a cost-0 item is discarded");
  assert.equal(tokensOn(zero.engine, zero.id("za")), 0, "cost 0 gives no tokens");
  assert.equal(zero.engine.state.cards[zero.id("za")].depleted, true, "still depleted");
  const bad = zenBoard({ id: zid, hand: items() });
  for (const [key, why] of [
    ["ch", "a character card in hand"],
    ["tac", "a tactic card in hand"],
    ["ip", "an item already in play"],
    ["oi", "the opponent's item"]
  ] as const) {
    refused(() => disenchant(bad, key), why);
    assert.equal(tokensOn(bad.engine, bad.id("za")), 0, `no tokens: ${why}`);
    assert.equal(bad.engine.state.cards[bad.id("za")].depleted ?? false, false, `not depleted: ${why}`);
  }
  disenchant(bad, "i3");
  assert.equal(tokensOn(bad.engine, bad.id("za")), 3, "control: an item in hand works");
  const none = zenBoard({ id: zid, hand: items().filter((c) => !["i3", "i1", "i0"].includes(c.key)) });
  refused(() => activate(none.engine, P1, none.id("za"), "disenchant", { selected: {}, variables: {} }), "no item to discard");
  assert.equal(none.engine.state.cards[none.id("za")].depleted ?? false, false, "nothing paid with no item");
  const dep = zenBoard({ id: zid, hand: items(), zenDepleted: true });
  refused(() => disenchant(dep, "i3"), "already depleted");
  assert.equal(zoneOf(dep.engine, dep.id("i3")), "hand", "the item stays in hand");
};
clause(ZEN, "1:ability:disenchant", "(T3c9) first printing: items only, X = cost, one item, deplete cost, refusals", zenDisenchantBody(ZEN));
clause(ZEN_B, "1:ability:disenchant", "second printing: discarding one item from hand puts X = its cost in tokens and depletes; only an item of mine in hand; refused depleted or with no item", zenDisenchantBody(ZEN_B));

const zenClairvoyanceBody = (zid: string) => () => {
  const b = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
  const pcOpen = (x: number) => {
    activate(b.engine, P1, b.id("za"), "clairvoyance", { variables: { x } });
    return pending(b.engine) as unknown as { kind: string; playerId: string; optional?: boolean; cardIds?: string[] } | undefined;
  };
  const pc = pcOpen(2);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the search opens a pick");
  assert.equal(pc?.playerId, P1, "the Zenobia controller chooses the card, not the opponent");
  assert.equal(tokensOn(b.engine, b.id("za")), 1, "COST: remove X = 2 tokens");
  assert.equal(b.engine.state.cards[b.id("za")].depleted, true, "COST: deplete this card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c3")] }), "cost 3 > X=2");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc1")] }), "the opponent's deck");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c1"), b.id("c2")] }), "two picks");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c2")] });
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice left open");
  assert.equal(zoneOf(b.engine, b.id("c2")), "hand", "the found card goes to the hand");
  assert.equal(b.engine.state.players[P1].hand.length, 1, "exactly one card");
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "the card is revealed");
  for (const key of ["c0", "c1"]) {
    const g = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
    clairvoyance(g, 2, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} (cost <= 2) can be found`);
  }
  const one = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
  activate(one.engine, P1, one.id("za"), "clairvoyance", { variables: { x: 1 } });
  refused(() => answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("c2")] }), "cost 2 > X=1");
  answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("c1")] });
  assert.equal(tokensOn(one.engine, one.id("za")), 2, "X=1 removes exactly 1 token");
  const hc = zenBoard({
    id: zid,
    tokens: 3,
    deck: deckCards(),
    extra: [
      { key: "hc", def: character({ name: "HandCheap", cost: 1 }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscardCheap", cost: 1 }), owner: P1, zone: "discard" }
    ]
  });
  activate(hc.engine, P1, hc.id("za"), "clairvoyance", { variables: { x: 2 } });
  refused(() => answerPending(hc.engine, "chooserSelectsTarget", { selected: [hc.id("dc")] }), "a card in the discard pile");
  refused(() => answerPending(hc.engine, "chooserSelectsTarget", { selected: [hc.id("hc")] }), "a card already in hand");
  const dec = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
  clairvoyance(dec, 2);
  assert.equal(dec.engine.state.pendingChoice, undefined, "declining closes the search");
  assert.equal(dec.engine.state.players[P1].hand.length, 0, "nothing found");
  assert.equal(tokensOn(dec.engine, dec.id("za")), 1, "the cost is still paid");
  const x0 = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
  refused(() => activate(x0.engine, P1, x0.id("za"), "clairvoyance", { variables: { x: 0 } }), "X=0");
  assert.equal(tokensOn(x0.engine, x0.id("za")), 3, "X=0 pays nothing");
  const x4 = zenBoard({ id: zid, tokens: 3, deck: deckCards() });
  refused(() => activate(x4.engine, P1, x4.id("za"), "clairvoyance", { variables: { x: 4 } }), "X=4 > 3 tokens");
  clairvoyance(x4, 3, "c3");
  assert.equal(tokensOn(x4.engine, x4.id("za")), 0, "X=3 uses all the tokens");
  assert.equal(zoneOf(x4.engine, x4.id("c3")), "hand", "X=3 reaches cost 3");
  const nt = zenBoard({ id: zid, deck: deckCards() });
  refused(() => activate(nt.engine, P1, nt.id("za"), "clairvoyance", { variables: { x: 1 } }), "no tokens to remove");
  const dep = zenBoard({ id: zid, tokens: 3, deck: deckCards(), zenDepleted: true });
  refused(() => activate(dep.engine, P1, dep.id("za"), "clairvoyance", { variables: { x: 1 } }), "depleted");
  assert.equal(tokensOn(dep.engine, dep.id("za")), 3, "tokens stay");
};
clause(ZEN, "2:ability:clairvoyance", "(T3c9) first printing: the controller picks; one card of cost X or less from my deck; X bounds and cost", zenClairvoyanceBody(ZEN));
clause(ZEN_B, "2:ability:clairvoyance", "second printing: the controller picks one card of cost X or less from my own deck into hand; X from 1 to the tokens; depletes", zenClairvoyanceBody(ZEN_B));

clause(ZEN_B, "2:ability:clairvoyance", "second printing: searching shuffles the deck afterwards (CR 312.1), even when nothing is found", () => {
  const b = zenBoard({ id: ZEN_B, tokens: 3, deck: deckCards() });
  const before = [...b.engine.state.players[P1].deck];
  clairvoyance(b, 2, "c2");
  const after = b.engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), before.filter((c) => c !== b.id("c2")).sort(), "the same cards, minus the found one");
  assert.notDeepEqual(after, before.filter((c) => c !== b.id("c2")), "reshuffled");
  const deck: Pl[] = [5, 6, 7, 8, 9, 10].map((cost) => ({ key: `e${cost}`, def: character({ name: `Exp${cost}`, cost }), owner: P1, zone: "deck" as const }));
  const f = zenBoard({ id: ZEN_B, tokens: 3, deck });
  const fb = [...f.engine.state.players[P1].deck];
  clairvoyance(f, 1);
  assert.deepEqual([...f.engine.state.players[P1].deck].sort(), [...fb].sort(), "same cards");
  assert.notDeepEqual(f.engine.state.players[P1].deck, fb, "reshuffled even though nothing was found");
});

// ============================================================================
// Zenobia's Intervention -- tactic, cost 2 [E]
// EXTRA COST: Pick a character.
// This turn, the character gains 1 strength and 1 life for each different staple resource you control.
// ============================================================================

const ZI = "bbc53a75-6d0b-48fe-b1cc-0334cb0f478d";

function ziBoard(o: { res?: Pl[]; extra?: Pl[]; active?: PlayerId } = {}) {
  return buildGame({
    ...factions,
    turn: o.active === P2 ? 2 : 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "zi", def: printing(ZI), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...(o.res ?? [...bank("elitism", 2, P1)]),
      ...(o.extra ?? [])
    ]
  });
}

const ziPlay = (b: ReturnType<typeof ziBoard>, pick: string) => play(b.engine, P1, b.id("zi"), { selected: { c: [b.id(pick)] } });

clause(ZI, "0:extraCost", "is a gearsmith tactic costing 2 [E]: deploys with 2 resources incl. an [E] and pays exactly 2", () => {
  assert.equal(printing(ZI).type, "tactic");
  assert.equal(printing(ZI).trade, "gearsmith");
  const b = ziBoard({ res: [...bank("elitism", 1, P1), ...bank("rage", 3, P1)] });
  assert.equal(readyResources(b.engine, P1), 4);
  ziPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("zi")), "discard");
  assert.equal(readyResources(b.engine, P1), 2, "exactly 2 paid");
});

clause(ZI, "0:extraCost", "cost 2 isolated from the threshold: a spent [E] plus one ready Rage is one short; plus two Rage works", () => {
  const short = ziBoard({ res: [...spentBank("elitism", 1, P1), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("zi"), { selected: { c: [short.id("mine")] } }), "only one ready resource");
  assert.equal(zoneOf(short.engine, short.id("zi")), "hand");
  const ok = ziBoard({ res: [...spentBank("elitism", 1, P1), ...bank("rage", 2, P1)] });
  ziPlay(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("zi")), "discard");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(ZI, "0:extraCost", "threshold [E]: refused with plenty of other resources, and the opponent's [E] do not count", () => {
  const rage = ziBoard({ res: bank("rage", 4, P1) });
  refused(() => playRaw(rage.engine, P1, rage.id("zi"), { selected: { c: [rage.id("mine")] } }), "no [E]");
  const theirs = ziBoard({ res: [...bank("rage", 4, P1), ...bank("elitism", 2, P2)] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("zi"), { selected: { c: [theirs.id("mine")] } }), "the opponent's [E]");
  assert.equal(zoneOf(theirs.engine, theirs.id("zi")), "hand");
  const none = ziBoard({ res: [] });
  refused(() => playRaw(none.engine, P1, none.id("zi"), { selected: { c: [none.id("mine")] } }), "no resources");
});

clause(ZI, "0:extraCost", "you must pick a character: no pick and two picks are refused", () => {
  const b = ziBoard();
  refused(() => playRaw(b.engine, P1, b.id("zi"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("zi")), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("zi"), { selected: { c: [b.id("mine"), b.id("mine2")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("zi")), "hand");
  assert.equal(readyResources(b.engine, P1), 2, "nothing was paid");
});

clause(ZI, "0:extraCost", "any character in play can be picked, yours or the opponent's", () => {
  const mine = ziBoard();
  ziPlay(mine, "mine");
  assert.equal(zoneOf(mine.engine, mine.id("zi")), "discard");
  const theirs = ziBoard();
  ziPlay(theirs, "foe");
  assert.equal(zoneOf(theirs.engine, theirs.id("zi")), "discard");
});

clause(ZI, "0:extraCost", "only characters in play can be picked: not an item, a location, a faction, a face-down card, or a card in hand", () => {
  const b = ziBoard();
  const attempt = (pick: string) => () => playRaw(b.engine, P1, b.id("zi"), { selected: { c: [pick] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card");
  refused(attempt(b.id("inHand")), "a character in hand");
  assert.equal(zoneOf(b.engine, b.id("zi")), "hand");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character in play is accepted");
});

clause(ZI, "0:extraCost", "as a tactic it can be deployed on the opponent's turn, in response to something", () => {
  const b = ziBoard({
    active: P2,
    extra: [{ key: "mage", def: character({ name: "OppMage", behavior: { abilities: [{ id: "draw1", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P2, zone: "play" }]
  });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("mage"), abilityId: "draw1", selected: {}, variables: {} } as never);
  playRaw(b.engine, P1, b.id("zi"), { selected: { c: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("zi")), "discard");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

const staple = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", n: number, owner: PlayerId = P1): Pl[] => bank(icon, n, owner);

clause(ZI, "1:rule", "+1 strength and +1 life per DIFFERENT staple resource: 1 kind (two [E] paid for it) gives +1/+1, speed unchanged", () => {
  const b = ziBoard({ res: staple("elitism", 2) });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(ZI, "1:rule", "three kinds give +3/+3", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [5, 2, 6]);
});

clause(ZI, "1:rule", "five kinds give +5/+5", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1), ...staple("deception", 1), ...staple("obsession", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [7, 2, 8]);
});

clause(ZI, "1:rule", "copies of the same staple count once: 4 [E] and 3 Rage is only 2 different", () => {
  const b = ziBoard({ res: [...staple("elitism", 4), ...staple("rage", 3)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [4, 2, 5]);
});

clause(ZI, "1:rule", "spent (paid) resources are still resources you control: they count", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...spentBank("rage", 2, P1), ...staple("greed", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [5, 2, 6], "elitism + rage + greed");
});

clause(ZI, "1:rule", "only staples YOU control count: the opponent's staple kinds do not", () => {
  const b = ziBoard({ res: [...staple("elitism", 2), ...staple("rage", 1, P2), ...staple("greed", 1, P2)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(ZI, "1:rule", "only STAPLE resources count: a non-staple face-up resource is not counted", () => {
  const b = ziBoard({
    res: [
      ...staple("elitism", 2),
      { key: "ns", def: resourceCard({ name: "OddResource", resource: { provides: ["rage"] } }), owner: P1, zone: "play" }
    ]
  });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(ZI, "1:rule", "a face-down non-staple card is only a Volition resource: it does not count as a staple kind", () => {
  const b = ziBoard({ res: [...staple("elitism", 2), { key: "fd", def: character({ name: "FaceDownChar" }), owner: P1, zone: "play", faceDown: true }] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(ZI, "1:rule", "a face-down card is hidden, only a Volition resource (CR 411.1): even a staple card played face-down does not count as a staple kind", () => {
  const b = ziBoard({ res: [...staple("elitism", 2), ...volition(1, P1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 2, 4]);
});

clause(ZI, "1:rule", "the picked character gets it, nobody else (my other character, the opponent's)", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine2")), [2, 2, 3]);
  assert.deepEqual(stats(b.engine, b.id("foe")), [4, 1, 5]);
});

clause(ZI, "1:rule", "an opponent's character can be the one boosted (with MY staples counted)", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1), ...staple("deception", 1, P2)] });
  ziPlay(b, "foe");
  assert.deepEqual(stats(b.engine, b.id("foe")), [7, 1, 8], "+3/+3 from my three kinds");
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3]);
});

clause(ZI, "1:rule", "'this turn': the bonus is gone after the turn ends", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [5, 2, 6]);
  endTurn(b.engine, P1);
  assert.deepEqual(stats(b.engine, b.id("mine")), [2, 2, 3], "back to printed values next turn");
});

clause(ZI, "1:rule", "'this turn': the bonus is still there later in the same turn", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1), ...staple("greed", 1)] });
  ziPlay(b, "mine");
  resolvePendingResponses(b.engine);
  assert.deepEqual(stats(b.engine, b.id("mine")), [5, 2, 6]);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ZI, "1:rule", "(T3c9) 'this turn' lasts the whole turn, not just one battle: the bonus is still there after the character fought", () => {
  const b = ziBoard({ res: [...staple("elitism", 1), ...staple("rage", 1)] });
  ziPlay(b, "mine");
  assert.deepEqual(stats(b.engine, b.id("mine")), [4, 2, 5], "+2/+2 for two different staples");
  fightThrough(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.deepEqual(stats(b.engine, b.id("mine")), [4, 2, 5], "the bonus outlasts the battle");
});

clause(ZI, "1:rule", "two Interventions on one character stack", () => {
  const b = ziBoard({
    res: [...staple("elitism", 2), ...staple("rage", 2)],
    extra: [{ key: "zi2", def: printing(ZI), owner: P1, zone: "hand" }]
  });
  ziPlay(b, "mine");
  play(b.engine, P1, b.id("zi2"), { selected: { c: [b.id("mine")] } });
  assert.deepEqual(stats(b.engine, b.id("mine")), [6, 2, 7], "+2/+2 each (elitism, rage) twice");
});
