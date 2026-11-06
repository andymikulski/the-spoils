// Clause tests, batch seed-saga-05, part p1 (groups 1-8, missing clauses only).
// Inconvenient Roadblock, Mau Caravan, Miraculous Regeneration, Mutineer's Hiatus,
// Portly Tradesmau, Prehensile Pirate, Property Condemner, Purifying Priest.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  tactic,
  activate,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";

const ROADBLOCK = "ad57aa42-d10a-4fd6-bb9e-d44c9eb00133"; // tactic banker cost 3 "g" -- EXTRA COST: deploy only during a battle; reduce all battle damage this battle to 0, draw a card; FLIP UP 1 [G]
const CARAVAN = "37c490de-cadf-4e68-91a4-4444f2df1eed"; // location banker cost 2 "ggg" structure 1 -- start of your turn: may destroy this; if you do search deck for a location, reveal, to hand
const REGEN = "80557cb9-ed59-4ba2-99cc-6aa189906c06"; // tactic banker cost 3 "g" -- EXTRA COST pick 2 characters in your discard; 1 into play face-down resource, other to hand
const HIATUS = "2593fbec-2c97-4f78-892d-42ca47b85cca"; // tactic banker cost 1 "g" -- EXTRA COST destroy a character you own; draw 2; RECUR [G]
const TRADESMAU = "448a5dbc-7944-4705-bad4-fba07bf6e0db"; // character banker cost 2 "gg" 0/3/4 -- when this blocks draw X (attacking party size)
const PIRATE = "d6a2dd90-5790-4560-9201-b585001b3aa0"; // character banker cost 4 "gg" 3/3/5 -- EXTRA COST remove 4 cards in your discard from the game
const CONDEMNER = "8cc9262b-5f64-410f-ad0a-3b705dbbb453"; // character banker cost 4 "gg" 2/4/2 -- ETB may pick a location, destroy it; FLIP UP 2 [G][G]
const PRIEST = "e85052be-12f3-4516-9a2f-2b0b455b2527"; // character banker cost 4 "g" 2/3/4 -- BANISH: pick a location; next 1 damage to your faction this turn goes to it instead

const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);
const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const mayPayAnswer = (pay: boolean) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc);
const dmg = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].damage ?? 0;

/** A free tactic: deal `amount` damage to one chosen card in play (character or location). */
const factionHitTactic = (name: string, amount: number, who: "controller" | "opponent") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        { id: "fh", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }] }
      ]
    }
  });

const zapTactic = (name: string, amount: number) =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

// ============================================================================
// Inconvenient Roadblock
// ============================================================================

interface RoadOpts {
  greed?: number;
  rage?: number;
  owner?: PlayerId;
  faceDown?: boolean;
  extra?: CardPlacement[];
}
function roadBoard(o: RoadOpts = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 1,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 3, speed: 2, life: 8 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, speed: 2, life: 8 }), owner: P2, zone: "play" },
      o.faceDown
        ? { key: "rb", def: printing(ROADBLOCK), owner, zone: "play" as const, faceDown: true }
        : { key: "rb", def: printing(ROADBLOCK), owner, zone: "hand" as const },
      { key: "zap", def: zapTactic("Zap", 3), owner: P1, zone: "hand" },
      ...fillers("d1_", 4, P1, "deck"),
      ...fillers("d2_", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 3, owner),
      ...bank("rage", o.rage ?? 0, owner),
      ...(o.extra ?? [])
    ]
  });
}
type RoadGame = ReturnType<typeof roadBoard>;
const handOf = (g: RoadGame, p: PlayerId) => g.engine.state.players[p].hand.length;


/** P1 attacks, P2 blocks with `blockers`: the battle waits in the before-damage response window with P1 holding priority. */
function roadBattle(g: RoadGame, blockers: string[] = ["blk"]): void {
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, blockers.map((k) => g.id(k)));
}

clause(ROADBLOCK, "0:extraCost", "printed as a banker tactic costing 3 with threshold [G]", () => {
  const c = printing(ROADBLOCK);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 3);
  assert.equal(c.threshold, "g");
});

clause(ROADBLOCK, "0:extraCost", "can be deployed during a battle for exactly 3 resources with [G]; the tactic is spent", () => {
  const g = roadBoard({ greed: 3 });
  roadBattle(g);
  assert.ok(g.engine.state.battle, "setup: a battle is under way");
  assert.equal(ready(g.engine, P1), 3);
  play(g.engine, P1, g.id("rb"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard");
  assert.equal(ready(g.engine, P1), 0, "paid 3");
});

clause(ROADBLOCK, "0:extraCost", "cost is exactly 3: refused with 2 resources, accepted with 1 [G] plus 2 other resources (the threshold is only [G])", () => {
  const short = roadBoard({ greed: 2 });
  roadBattle(short);
  refused(() => play(short.engine, P1, short.id("rb")), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("rb")), "hand");
  assert.equal(ready(short.engine, P1), 2, "nothing was paid");
  const mixed = roadBoard({ greed: 1, rage: 2 });
  roadBattle(mixed);
  play(mixed.engine, P1, mixed.id("rb"));
  assert.equal(zoneOf(mixed.engine, mixed.id("rb")), "discard");
  assert.equal(ready(mixed.engine, P1), 0);
});

clause(ROADBLOCK, "0:extraCost", "threshold [G]: three Rage resources are enough resources but no [G], so it is refused", () => {
  const g = roadBoard({ greed: 0, rage: 3 });
  roadBattle(g);
  refused(() => play(g.engine, P1, g.id("rb")), "no [G] among the resources");
  assert.equal(zoneOf(g.engine, g.id("rb")), "hand");
  assert.equal(ready(g.engine, P1), 3, "nothing was paid");
  const control = roadBoard({ greed: 1, rage: 2 });
  roadBattle(control);
  play(control.engine, P1, control.id("rb"));
  assert.equal(zoneOf(control.engine, control.id("rb")), "discard", "control: one [G] satisfies the threshold");
});

clause(ROADBLOCK, "0:extraCost", "cannot be deployed when no battle is under way (even with plenty of resources)", () => {
  const g = roadBoard({ greed: 5 });
  assert.equal(g.engine.state.battle, undefined);
  refused(() => play(g.engine, P1, g.id("rb")), "no battle", /deployed/i);
  assert.equal(zoneOf(g.engine, g.id("rb")), "hand");
  assert.equal(ready(g.engine, P1), 5, "nothing was paid");
  roadBattle(g);
  play(g.engine, P1, g.id("rb"));
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard", "control: the same deploy works in a battle");
});

clause(ROADBLOCK, "0:extraCost", "cannot be deployed once the battle is over", () => {
  const g = roadBoard({ greed: 5 });
  roadBattle(g);
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined);
  refused(() => play(g.engine, P1, g.id("rb")), "battle already over", /deployed/i);
  assert.equal(zoneOf(g.engine, g.id("rb")), "hand");
  assert.equal(ready(g.engine, P1), 5);
});

clause(ROADBLOCK, "0:extraCost", "the defending player can deploy it too, in the response window before blockers are declared", () => {
  const g = roadBoard({ greed: 3, owner: P2 });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
  play(g.engine, P2, g.id("rb"));
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard");
  assert.equal(ready(g.engine, P2), 0);
});

clause(ROADBLOCK, "0:extraCost", "the defending player can deploy it in the before-damage window once the attacker passes priority", () => {
  const g = roadBoard({ greed: 3, owner: P2 });
  roadBattle(g);
  g.engine.perform({ type: "passPriority", playerId: P1 });
  play(g.engine, P2, g.id("rb"));
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard");
  assert.equal(ready(g.engine, P2), 0);
});

// -- Reduce all battle damage inflicted during this battle to 0. Draw a card. -

clause(ROADBLOCK, "1:rule", "control: without it a blocked battle deals 3 to the blocker and 2 to the attacker", () => {
  const g = roadBoard();
  roadBattle(g);
  finishBattle(g.engine);
  assert.equal(dmg(g.engine, g.id("blk")), 3);
  assert.equal(dmg(g.engine, g.id("atk")), 2);
});

clause(ROADBLOCK, "1:rule", "all battle damage in a blocked battle is reduced to 0: neither the blocker nor the attacker is damaged", () => {
  const g = roadBoard();
  roadBattle(g);
  play(g.engine, P1, g.id("rb"));
  finishBattle(g.engine);
  assert.equal(dmg(g.engine, g.id("blk")), 0, "the attacker's damage to the blocker is 0");
  assert.equal(dmg(g.engine, g.id("atk")), 0, "the blocker's damage to the attacker is 0");
  assert.equal(g.engine.state.players[P2].influence, 20);
  assert.equal(g.engine.state.players[P1].influence, 20);
});

clause(ROADBLOCK, "1:rule", "an unblocked attack deals 3 to the faction without it (control) and 0 with it", () => {
  const control = roadBoard();
  roadBattle(control, []);
  finishBattle(control.engine);
  assert.equal(control.engine.state.players[P2].influence, 17, "control: 3 strength unblocked");
  const g = roadBoard();
  roadBattle(g, []);
  play(g.engine, P1, g.id("rb"));
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, 20, "no damage to the faction");
});

clause(ROADBLOCK, "1:rule", "played by the defender before blockers are declared it still zeroes all of the battle's damage", () => {
  const g = roadBoard({ greed: 3, owner: P2 });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  play(g.engine, P2, g.id("rb"));
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  finishBattle(g.engine);
  assert.equal(dmg(g.engine, g.id("blk")), 0);
  assert.equal(dmg(g.engine, g.id("atk")), 0);
});

clause(ROADBLOCK, "1:rule", "also zeroes damage when several characters fight: every blocker and attacker is undamaged", () => {
  const g = roadBoard({
    extra: [
      { key: "atk2", def: character({ name: "Atk2", strength: 2, speed: 2, life: 8 }), owner: P1, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 4, speed: 2, life: 8 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("atk"), g.id("atk2")]);
  declareBlockers(g.engine, P2, [g.id("blk"), g.id("blk2")]);
  play(g.engine, P1, g.id("rb"));
  finishBattle(g.engine);
  for (const k of ["atk", "atk2", "blk", "blk2"]) assert.equal(dmg(g.engine, g.id(k)), 0, k);
});

clause(ROADBLOCK, "1:rule", "draw a card: its controller draws exactly 1 (the top card) and the opponent draws none", () => {
  const g = roadBoard();
  roadBattle(g);
  const top = g.engine.state.players[P1].deck[0];
  const deckBefore = g.engine.state.players[P1].deck.length;
  const oppHand = handOf(g, P2);
  const oppDeck = g.engine.state.players[P2].deck.length;
  assert.equal(handOf(g, P1), 2, "setup: Roadblock and Zap");
  play(g.engine, P1, g.id("rb"));
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore - 1);
  assert.equal(handOf(g, P1), 2, "Roadblock left, one card drawn");
  assert.ok(g.engine.state.players[P1].hand.includes(top), "the top card was drawn");
  assert.equal(handOf(g, P2), oppHand);
  assert.equal(g.engine.state.players[P2].deck.length, oppDeck);
});

clause(ROADBLOCK, "1:rule", "when the defender plays it, the defender (its controller) draws, not the attacker", () => {
  const g = roadBoard({ greed: 3, owner: P2 });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  const top = g.engine.state.players[P2].deck[0];
  const p1Hand = handOf(g, P1);
  const p1Deck = g.engine.state.players[P1].deck.length;
  play(g.engine, P2, g.id("rb"));
  assert.ok(g.engine.state.players[P2].hand.includes(top), "P2 drew its top card");
  assert.equal(handOf(g, P1), p1Hand);
  assert.equal(g.engine.state.players[P1].deck.length, p1Deck);
});

clause(ROADBLOCK, "1:rule", "only this battle: damage dealt by a later effect on the same turn after the battle is NOT reduced", () => {
  const g = roadBoard({ extra: [{ key: "bys", def: character({ name: "Bystander", life: 8 }), owner: P2, zone: "play" }] });
  roadBattle(g);
  play(g.engine, P1, g.id("rb"));
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("bys")] } });
  assert.equal(dmg(g.engine, g.id("bys")), 3, "the battle is over, so the prevention is over");
});

clause(ROADBLOCK, "1:rule", "only this battle: a second battle later in the same turn deals its damage normally", () => {
  const g = roadBoard({
    extra: [
      { key: "atk2", def: character({ name: "Atk2", strength: 2, speed: 2, life: 8 }), owner: P1, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, speed: 2, life: 8 }), owner: P2, zone: "play" }
    ]
  });
  roadBattle(g);
  play(g.engine, P1, g.id("rb"));
  finishBattle(g.engine);
  declareAttackBy(g.engine, P1, [g.id("atk2")]);
  declareBlockers(g.engine, P2, [g.id("blk2")]);
  finishBattle(g.engine);
  assert.equal(dmg(g.engine, g.id("blk2")), 2, "second battle: the attacker deals 2");
  assert.equal(dmg(g.engine, g.id("atk2")), 1, "second battle: the blocker deals 1");
});

clause(ROADBLOCK, "1:rule", "only BATTLE damage is reduced: damage from another effect during the same battle is still dealt", () => {
  const g = roadBoard({ greed: 3, owner: P2 });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  play(g.engine, P2, g.id("rb"));
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("blk")] } });
  assert.equal(dmg(g.engine, g.id("blk")), 3, "Zap's 3 damage is not battle damage");
});

// -- FLIP UP: 1 [G] ------------------------------------------------------------

clause(ROADBLOCK, "2:flipUp", "a face-down Roadblock flips up for 1 (not 3) with [G] in a battle: damage is zeroed, a card is drawn, the tactic is spent", () => {
  const g = roadBoard({ faceDown: true, greed: 1, rage: 2 });
  roadBattle(g);
  const top = g.engine.state.players[P1].deck[0];
  assert.equal(ready(g.engine, P1), 4, "setup: face-down Roadblock, Greed, 2 Rage");
  rawFlipUp(g.engine, P1, g.id("rb"));
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard");
  assert.ok(g.engine.state.players[P1].hand.includes(top), "drew a card");
  const r = ready(g.engine, P1);
  assert.ok(r === 2 || r === 3, `paid exactly 1 (the Roadblock may pay for itself), ready ${r}`);
  finishBattle(g.engine);
  assert.equal(dmg(g.engine, g.id("blk")), 0);
  assert.equal(dmg(g.engine, g.id("atk")), 0);
});

clause(ROADBLOCK, "2:flipUp", "needs [G] among the OTHER resources: Rage alone, or the Roadblock's own Volition, cannot flip it", () => {
  const noGreed = roadBoard({ faceDown: true, greed: 0, rage: 5 });
  roadBattle(noGreed);
  refused(() => rawFlipUp(noGreed.engine, P1, noGreed.id("rb")), "no [G]");
  assert.equal(noGreed.engine.state.cards[noGreed.id("rb")].faceDown, true);
  assert.equal(ready(noGreed.engine, P1), 6, "nothing paid");
  const alone = roadBoard({ faceDown: true, greed: 0, rage: 0 });
  roadBattle(alone);
  refused(() => rawFlipUp(alone.engine, P1, alone.id("rb")), "alone: its own face-down Volition is not [G]");
  assert.equal(alone.engine.state.cards[alone.id("rb")].faceDown, true);
  const one = roadBoard({ faceDown: true, greed: 1, rage: 0 });
  roadBattle(one);
  rawFlipUp(one.engine, P1, one.id("rb"));
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("rb")), "discard", "control: a single [G] plus the card itself is enough");
});

clause(ROADBLOCK, "2:flipUp", "still only during a battle: refused when no battle is under way", () => {
  const g = roadBoard({ faceDown: true, greed: 3 });
  refused(() => rawFlipUp(g.engine, P1, g.id("rb")), "no battle");
  assert.equal(g.engine.state.cards[g.id("rb")].faceDown, true);
  assert.equal(ready(g.engine, P1), 4, "nothing paid");
  roadBattle(g);
  rawFlipUp(g.engine, P1, g.id("rb"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("rb")), "discard", "control: in the battle it flips");
});

// ============================================================================
// Mau Caravan
// ============================================================================

const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const handOfP = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const revealsOf = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface CarOpts {
  /** whose turn it is (default P2, so ending it starts P1's turn) */
  active?: PlayerId;
  noLocations?: boolean;
  carController?: PlayerId;
  extra?: CardPlacement[];
}
function caravanBoard(o: CarOpts = {}) {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0,
    cards: [
      { key: "car", def: printing(CARAVAN), owner: P1, zone: "play", ...(o.carController ? { controller: o.carController } : {}) },
      { key: "p1c0", def: character({ name: "P1 C0" }), owner: P1, zone: "deck" },
      ...(o.noLocations ? [] : [{ key: "locA", def: location({ name: "Loc A" }), owner: P1, zone: "deck" as const }]),
      { key: "p1c1", def: character({ name: "P1 C1" }), owner: P1, zone: "deck" },
      ...(o.noLocations ? [] : [{ key: "locB", def: location({ name: "Loc B" }), owner: P1, zone: "deck" as const }]),
      { key: "p1c2", def: character({ name: "P1 C2" }), owner: P1, zone: "deck" },
      { key: "p1c3", def: character({ name: "P1 C3" }), owner: P1, zone: "deck" },
      { key: "p1disc", def: location({ name: "Discarded Loc" }), owner: P1, zone: "discard" },
      { key: "p2c0", def: character({ name: "P2 C0" }), owner: P2, zone: "deck" },
      { key: "p2loc", def: location({ name: "P2 Loc" }), owner: P2, zone: "deck" },
      { key: "p2c1", def: character({ name: "P2 C1" }), owner: P2, zone: "deck" },
      { key: "p2c2", def: character({ name: "P2 C2" }), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}
type CarGame = ReturnType<typeof caravanBoard>;

/** The turn passes to P1; the Caravan's trigger is waiting on the may-pay prompt. */
function toP1Turn(g: CarGame): void {
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
}

clause(CARAVAN, "0:rule", "printed as a banker location costing 2 with threshold [G][G][G] and structure 1", () => {
  const c = printing(CARAVAN);
  assert.equal(c.type, "location");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 2);
  assert.equal(c.threshold, "ggg");
  const g = caravanBoard();
  assert.equal(g.engine.getStat(g.id("car"), "structure"), 1);
});

function caravanDeploy(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0,
    cards: [{ key: "car", def: printing(CARAVAN), owner: P1, zone: "hand" }, ...resources]
  });
}
const spentGreed = (n: number): CardPlacement[] =>
  bank("greed", n, P1).map((p) => ({ ...p, key: `s${p.key}`, attachedToKey: "__factionA" }));

clause(CARAVAN, "0:rule", "deploys for exactly 2 resources when the threshold [G][G][G] is met", () => {
  const g = caravanDeploy(bank("greed", 3, P1));
  play(g.engine, P1, g.id("car"));
  assert.equal(zoneOf(g.engine, g.id("car")), "play");
  assert.equal(ready(g.engine, P1), 1, "paid 2 of 3");
});

clause(CARAVAN, "0:rule", "threshold [G][G][G]: two Greed plus a Rage is 3 resources but only 2 [G], refused", () => {
  const g = caravanDeploy([...bank("greed", 2, P1), ...bank("rage", 3, P1)]);
  refused(() => play(g.engine, P1, g.id("car")), "only 2 [G]");
  assert.equal(zoneOf(g.engine, g.id("car")), "hand");
  assert.equal(ready(g.engine, P1), 5, "nothing paid");
});

clause(CARAVAN, "0:rule", "cost 2 is separate from the threshold: 3 Greed of which 2 are already spent leaves 1 ready resource, refused; 1 spent leaves 2, accepted", () => {
  const short = caravanDeploy([...bank("greed", 1, P1), ...spentGreed(2)]);
  assert.equal(ready(short.engine, P1), 1);
  refused(() => play(short.engine, P1, short.id("car")), "only 1 ready resource for cost 2 (threshold met by spent [G])", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("car")), "hand");
  const ok = caravanDeploy([...bank("greed", 2, P1), ...spentGreed(1)]);
  assert.equal(ready(ok.engine, P1), 2);
  play(ok.engine, P1, ok.id("car"));
  assert.equal(zoneOf(ok.engine, ok.id("car")), "play");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(CARAVAN, "0:rule", "at the start of your turn the controller is asked whether to destroy it (a may-pay prompt) and nothing has happened yet", () => {
  const g = caravanBoard();
  toP1Turn(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(g.engine, g.id("car")), "play", "still in play until the player accepts");
  assert.deepEqual(handOfP(g.engine, P1).filter((c) => c === g.id("locA") || c === g.id("locB")), []);
});

clause(CARAVAN, "0:rule", "accepting destroys the Caravan and searches the deck: the chosen location is revealed and put into hand, the other location stays in the deck", () => {
  const g = caravanBoard();
  toP1Turn(g);
  const handBefore = handOfP(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("car")), "discard", "destroyed (as the cost)");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(g.engine)?.playerId, P1, "the controller chooses");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locB")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("locB")), "hand");
  assert.ok(handOfP(g.engine, P1).includes(g.id("locB")), "handOfP(g.engine, P1).includes(g.id(\"locB\"))");
  assert.equal(handOfP(g.engine, P1).length, handBefore.length + 1, "exactly one card entered the hand");
  assert.equal(zoneOf(g.engine, g.id("locA")), "deck", "the other location stays");
  const reveals = revealsOf(g.engine);
  assert.equal(reveals.length, 1, "revealed once");
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [g.id("locB")], "the found location is revealed");
});

clause(CARAVAN, "0:rule", "either location can be chosen (the first, too)", () => {
  const g = caravanBoard();
  toP1Turn(g);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA")] });
  assert.equal(zoneOf(g.engine, g.id("locA")), "hand");
  assert.equal(zoneOf(g.engine, g.id("locB")), "deck");
});

clause(CARAVAN, "0:rule", "after the search the deck is shuffled (CR 312.1): the same remaining cards in a shuffled order", () => {
  const g = caravanBoard();
  toP1Turn(g);
  const remaining = deckOf(g.engine, P1).filter((c) => c !== g.id("locA"));
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA")] });
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...remaining].sort());
  assert.deepEqual(deckOf(g.engine, P1), shuffledWithConstant(remaining, 0), "shuffled");
});

clause(CARAVAN, "0:rule", "only a location can be found: a character in the deck, the opponent's location and a location in my discard are all refused", () => {
  for (const bad of ["p1c0", "p2loc", "p1disc", "car"]) {
    const g = caravanBoard();
    toP1Turn(g);
    answerPending(g.engine, "mayPay", { pay: true });
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `${bad} is not a location in my deck`);
    assert.equal(zoneOf(g.engine, g.id(bad)), bad === "p1c0" || bad === "p2loc" ? "deck" : bad === "p1disc" ? "discard" : "discard");
    assert.equal(handOfP(g.engine, P1).includes(g.id(bad)), false);
  }
  const control = caravanBoard();
  toP1Turn(control);
  answerPending(control.engine, "mayPay", { pay: true });
  answerPending(control.engine, "chooserSelectsTarget", { selected: [control.id("locA")] });
  assert.equal(zoneOf(control.engine, control.id("locA")), "hand", "control: a location in my deck is accepted");
});

clause(CARAVAN, "0:rule", "declining the may-pay leaves the Caravan in play and does not search: no prompt, no reveal, deck order and hand unchanged", () => {
  const g = caravanBoard();
  toP1Turn(g);
  const deckBefore = deckOf(g.engine, P1);
  const handBefore = handOfP(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "play");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore);
  assert.deepEqual(handOfP(g.engine, P1), handBefore);
  assert.equal(revealsOf(g.engine).length, 0);
});

clause(CARAVAN, "0:rule", "if you do: choosing no card (a failed search) still destroys the Caravan, finds nothing and shuffles the deck (CR 312.1/312.2)", () => {
  const g = caravanBoard();
  toP1Turn(g);
  const deckBefore = deckOf(g.engine, P1);
  const handBefore = handOfP(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "discard");
  assert.deepEqual(handOfP(g.engine, P1), handBefore);
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...deckBefore].sort());
  assert.notDeepEqual(deckOf(g.engine, P1), deckBefore, "the deck was shuffled");
  assert.equal(revealsOf(g.engine).length, 0, "nothing to reveal");
});

clause(CARAVAN, "0:rule", "with no location in the deck the Caravan can still be destroyed: nothing is found and nothing is revealed", () => {
  const g = caravanBoard({ noLocations: true });
  toP1Turn(g);
  const handBefore = handOfP(g.engine, P1);
  drain(g.engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "discard");
  assert.deepEqual(handOfP(g.engine, P1), handBefore);
  assert.equal(revealsOf(g.engine).length, 0);
});

clause(CARAVAN, "0:rule", "does not trigger at the start of the OPPONENT's turn: no prompt, the Caravan stays, deck untouched", () => {
  const g = caravanBoard({ active: P1 });
  const deckBefore = deckOf(g.engine, P1);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "play");
  assert.deepEqual(deckOf(g.engine, P1), deckBefore);
});

clause(CARAVAN, "0:rule", "it is its CONTROLLER's turn that triggers it, and the controller's own deck is searched: a Caravan P1 owns but P2 controls prompts P2 at P2's turn start", () => {
  const g = caravanBoard({ active: P1, carController: P2 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the controller is asked");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine)?.playerId, P2);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA")] }), "P1's deck is not the controller's deck");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("p2loc")] });
  assert.equal(zoneOf(g.engine, g.id("p2loc")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("p2loc")), "g.engine.state.players[P2].hand.includes(g.id(\"p2loc\"))");
  assert.equal(zoneOf(g.engine, g.id("car")), "discard", "destroyed (goes to its owner's discard)");
  assert.equal(zoneOf(g.engine, g.id("locA")), "deck");
});

clause(CARAVAN, "0:rule", "a Caravan controlled by the opponent does not trigger on MY turn start", () => {
  const g = caravanBoard({ active: P2, carController: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "play");
});

clause(CARAVAN, "0:rule", "it triggers every turn: declining one turn leaves it, and it asks again on my next turn start", () => {
  const g = caravanBoard();
  toP1Turn(g);
  answerPending(g.engine, "mayPay", { pay: false });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined, "not on the opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA")] });
  assert.equal(zoneOf(g.engine, g.id("locA")), "hand");
  assert.equal(zoneOf(g.engine, g.id("car")), "discard");
});

clause(CARAVAN, "0:rule", "two Caravans each trigger: both can be destroyed, fetching two different locations", () => {
  const g = caravanBoard({ extra: [{ key: "car2", def: printing(CARAVAN), owner: P1, zone: "play" }] });
  endTurn(g.engine, P2);
  drain(g.engine, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    if (pc.kind === "chooserSelectsTarget") {
      const next = [g.id("locA"), g.id("locB")].find((c) => g.engine.state.cards[c].zone === "deck")!;
      return { kind: "chooserSelectsTarget", selected: [next] };
    }
    return declineAll(pc);
  });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("car")), "discard");
  assert.equal(zoneOf(g.engine, g.id("car2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("locA")), "hand");
  assert.equal(zoneOf(g.engine, g.id("locB")), "hand");
});

// ============================================================================
// Miraculous Regeneration
// ============================================================================

const etbDrawer = (name: string) =>
  character({
    name,
    behavior: {
      abilities: [
        { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });

interface RegenOpts {
  greed?: number;
  rage?: number;
  discard?: CardPlacement[];
  extra?: CardPlacement[];
}
function regenBoard(o: RegenOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0,
    cards: [
      { key: "rg", def: printing(REGEN), owner: P1, zone: "hand" },
      ...(o.discard ?? [
        { key: "ca", def: character({ name: "Char A" }), owner: P1, zone: "discard" as const },
        { key: "cb", def: character({ name: "Char B" }), owner: P1, zone: "discard" as const }
      ]),
      { key: "oppd", def: character({ name: "Opp Dead" }), owner: P2, zone: "discard" },
      ...fillers("d1_", 3, P1, "deck"),
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type RegenGame = ReturnType<typeof regenBoard>;
const regenPlay = (g: RegenGame, toPlay: string, toHand: string) =>
  play(g.engine, P1, g.id("rg"), { selected: { toPlay: [g.id(toPlay)], toHand: [g.id(toHand)] } });

clause(REGEN, "0:extraCost", "printed as a banker tactic costing 3 with threshold [G]; deploys for exactly 3 with [G]", () => {
  const c = printing(REGEN);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 3);
  assert.equal(c.threshold, "g");
  const g = regenBoard({ greed: 3 });
  regenPlay(g, "ca", "cb");
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), 1, "paid 3 of 4 after the new face-down resource came in (3 greed + 1 new) -> 1 left");
});

clause(REGEN, "0:extraCost", "cost is exactly 3: refused with 2 resources, accepted with 1 [G] and 2 other resources", () => {
  const short = regenBoard({ greed: 2 });
  refused(() => regenPlay(short, "ca", "cb"), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("rg")), "hand");
  assert.equal(zoneOf(short.engine, short.id("ca")), "discard");
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
  const mixed = regenBoard({ greed: 1, rage: 2 });
  regenPlay(mixed, "ca", "cb");
  assert.equal(zoneOf(mixed.engine, mixed.id("rg")), "discard");
});

clause(REGEN, "0:extraCost", "threshold [G]: three Rage resources have no [G], refused", () => {
  const g = regenBoard({ greed: 0, rage: 3 });
  refused(() => regenPlay(g, "ca", "cb"), "no [G]");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  assert.equal(ready(g.engine, P1), 3, "nothing paid");
});

clause(REGEN, "0:extraCost", "two characters are picked from my discard pile: with only one character there, it is refused", () => {
  const g = regenBoard({ discard: [{ key: "ca", def: character({ name: "Char A" }), owner: P1, zone: "discard" }] });
  refused(() => play(g.engine, P1, g.id("rg"), { selected: { toPlay: [g.id("ca")], toHand: [] } }), "only 1 character picked");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  assert.equal(zoneOf(g.engine, g.id("ca")), "discard");
  assert.equal(ready(g.engine, P1), 3, "nothing paid");
});

clause(REGEN, "0:extraCost", "the two picks must be distinct characters: picking one card for both is refused, picking two is accepted", () => {
  const g = regenBoard();
  refused(() => regenPlay(g, "ca", "ca"), "the same card twice");
  assert.equal(zoneOf(g.engine, g.id("ca")), "discard");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  regenPlay(g, "ca", "cb");
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard", "control: two distinct characters work");
});

clause(REGEN, "0:extraCost", "only characters count: an item and a location in my discard cannot be picked", () => {
  const g = regenBoard({
    discard: [
      { key: "ca", def: character({ name: "Char A" }), owner: P1, zone: "discard" },
      { key: "it", def: item({ name: "Some Item" }), owner: P1, zone: "discard" },
      { key: "lc", def: location({ name: "Some Loc" }), owner: P1, zone: "discard" }
    ]
  });
  refused(() => regenPlay(g, "ca", "it"), "an item is not a character");
  refused(() => regenPlay(g, "lc", "ca"), "a location is not a character");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  assert.equal(ready(g.engine, P1), 3, "nothing paid");
});

clause(REGEN, "0:extraCost", "only MY discard pile: the opponent's discarded character cannot be picked, and one of mine is still needed", () => {
  const g = regenBoard();
  refused(() => regenPlay(g, "ca", "oppd"), "the opponent's discard");
  refused(() => regenPlay(g, "oppd", "cb"), "the opponent's discard (other slot)");
  assert.equal(zoneOf(g.engine, g.id("oppd")), "discard");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  assert.equal(g.engine.state.players[P2].discard.length, 1);
});

clause(REGEN, "0:extraCost", "only the discard pile: a character in play or in hand cannot be picked", () => {
  const g = regenBoard({
    extra: [
      { key: "inplay", def: character({ name: "In Play" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" }
    ]
  });
  refused(() => regenPlay(g, "ca", "inplay"), "a character in play");
  refused(() => regenPlay(g, "inhand", "cb"), "a character in hand");
  assert.equal(zoneOf(g.engine, g.id("inplay")), "play");
  assert.equal(zoneOf(g.engine, g.id("inhand")), "hand");
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
});

clause(REGEN, "0:extraCost", "any two of three characters in the discard can be picked; the unpicked one stays in the discard", () => {
  const g = regenBoard({
    discard: [
      { key: "ca", def: character({ name: "Char A" }), owner: P1, zone: "discard" },
      { key: "cb", def: character({ name: "Char B" }), owner: P1, zone: "discard" },
      { key: "cc", def: character({ name: "Char C" }), owner: P1, zone: "discard" }
    ]
  });
  regenPlay(g, "cc", "ca");
  assert.equal(zoneOf(g.engine, g.id("cc")), "play");
  assert.equal(zoneOf(g.engine, g.id("ca")), "hand");
  assert.equal(zoneOf(g.engine, g.id("cb")), "discard", "the unpicked character stays");
});

clause(REGEN, "1:rule", "one picked character enters play face-down as a resource under my control; the other goes to my hand; the tactic is spent", () => {
  const g = regenBoard();
  const handBefore = g.engine.state.players[P1].hand.length;
  assert.equal(ready(g.engine, P1), 3);
  regenPlay(g, "ca", "cb");
  assert.equal(pending(g.engine), undefined);
  const a = g.engine.state.cards[g.id("ca")];
  assert.equal(a.zone, "play");
  assert.equal(a.faceDown, true, "face-down");
  assert.equal(a.controllerId, P1, "under my control");
  assert.equal(g.engine.isResource(g.id("ca")), true, "a resource");
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
  assert.equal(g.engine.state.players[P1].hand.length, handBefore, "Regeneration left the hand, the other character joined it");
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
  assert.equal(ready(g.engine, P1), 1, "3 spent, +1 for the new face-down resource");
  assert.equal(g.engine.state.cards[g.id("cb")].faceDown, false, "the hand card is a normal card");
});

clause(REGEN, "1:rule", "which character does which is my choice: swapping the two picks swaps the outcome", () => {
  const g = regenBoard();
  regenPlay(g, "cb", "ca");
  assert.equal(zoneOf(g.engine, g.id("cb")), "play");
  assert.equal(g.engine.state.cards[g.id("cb")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("ca")), "hand");
});

clause(REGEN, "1:rule", "the face-down resource is not a character any more and does not trigger its enters-play ability; the card put into hand does not either", () => {
  const g = regenBoard({
    discard: [
      { key: "ca", def: etbDrawer("Drawer A"), owner: P1, zone: "discard" },
      { key: "cb", def: etbDrawer("Drawer B"), owner: P1, zone: "discard" }
    ]
  });
  const deckBefore = g.engine.state.players[P1].deck.length;
  regenPlay(g, "ca", "cb");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("ca")].faceDown, true);
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore, "no enters-play draw from a face-down card");
});

clause(REGEN, "1:rule", "the new resource can be spent: it helps pay for a later deploy this turn", () => {
  const g = regenBoard({
    greed: 3,
    extra: [{ key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "hand" }]
  });
  regenPlay(g, "ca", "cb");
  assert.equal(ready(g.engine, P1), 1);
  play(g.engine, P1, g.id("cheap"));
  assert.equal(zoneOf(g.engine, g.id("cheap")), "play");
  assert.equal(ready(g.engine, P1), 0, "the face-down resource paid for it");
});

clause(REGEN, "1:rule", "nothing else is affected: the opponent's discard and hand are unchanged and the deck is not drawn from", () => {
  const g = regenBoard();
  const oppHand = g.engine.state.players[P2].hand.length;
  const deck = [...g.engine.state.players[P1].deck];
  regenPlay(g, "ca", "cb");
  assert.deepEqual(g.engine.state.players[P2].discard, [g.id("oppd")]);
  assert.equal(g.engine.state.players[P2].hand.length, oppHand);
  assert.deepEqual(g.engine.state.players[P1].deck, deck);
});

// ============================================================================
// Mutineer's Hiatus
// ============================================================================

interface HiOpts {
  greed?: number;
  rage?: number;
  hiatusZone?: "hand" | "discard" | "play";
  extra?: CardPlacement[];
  noChars?: boolean;
  bare?: boolean;
}
function hiatusBoard(o: HiOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0,
    cards: [
      { key: "hi", def: printing(HIATUS), owner: P1, zone: o.hiatusZone ?? "hand" },
      ...(o.noChars
        ? []
        : [
            { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" as const },
            { key: "mine2", def: character({ name: "Mine Two" }), owner: P1, zone: "play" as const }
          ]),
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      ...(o.bare ? [] : [{ key: "stolen", def: character({ name: "Stolen" }), owner: P1, zone: "play" as const, controller: P2 }]),
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, zone: "play", controller: P1 },
      { key: "handc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "mineItem", def: item({ name: "Mine Item" }), owner: P1, zone: "play" },
      ...fillers("d1_", 4, P1, "deck"),
      ...fillers("d2_", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 1, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type HiGame = ReturnType<typeof hiatusBoard>;
const hiPlay = (g: HiGame, victim: string) => play(g.engine, P1, g.id("hi"), { selected: { c: [g.id(victim)] } });
const recur = (g: HiGame, victim: string) => activate(g.engine, P1, g.id("hi"), "recur", { selected: { rc: [g.id(victim)] } });

clause(HIATUS, "0:extraCost", "printed as a banker tactic costing 1 with threshold [G]; deploys for exactly 1 [G]", () => {
  const c = printing(HIATUS);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 1);
  assert.equal(c.threshold, "g");
  const g = hiatusBoard({ greed: 1 });
  hiPlay(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(ready(g.engine, P1), 0, "paid 1");
});

clause(HIATUS, "0:extraCost", "needs [G]: Rage resources alone are refused (nothing paid, nothing destroyed), one [G] among them is enough", () => {
  const g = hiatusBoard({ greed: 0, rage: 3 });
  refused(() => hiPlay(g, "mine"), "no [G]");
  assert.equal(zoneOf(g.engine, g.id("hi")), "hand");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the cost (a destroy) was not paid either");
  assert.equal(ready(g.engine, P1), 3);
  const ok = hiatusBoard({ greed: 1, rage: 2 });
  hiPlay(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("hi")), "discard");
  assert.equal(ready(ok.engine, P1), 2, "only 1 paid");
});

clause(HIATUS, "0:extraCost", "no resources at all: refused", () => {
  const g = hiatusBoard({ greed: 0, extra: bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) }); // threshold [G] met by a spent [G]
  refused(() => hiPlay(g, "mine"), "no ready resource to pay 1 (threshold met by a spent [G])", /Costs cannot be paid/);
  assert.equal(zoneOf(g.engine, g.id("hi")), "hand");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(HIATUS, "0:extraCost", "a character I own is destroyed as the cost (goes to my discard pile)", () => {
  const g = hiatusBoard();
  hiPlay(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("mine")), "g.engine.state.players[P1].discard.includes(g.id(\"mine\"))");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play", "only the picked one");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
});

clause(HIATUS, "0:extraCost", "the character must be one I OWN: the opponent's character is refused, a character they control but I own is allowed", () => {
  const g = hiatusBoard();
  refused(() => hiPlay(g, "theirs"), "opponent-owned, opponent-controlled");
  refused(() => hiPlay(g, "borrowed"), "I control it but the opponent owns it");
  assert.equal(zoneOf(g.engine, g.id("hi")), "hand");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("borrowed")), "play");
  assert.equal(ready(g.engine, P1), 1, "nothing paid");
  hiPlay(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard", "control: owned by me, controlled by the opponent: allowed");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
});

clause(HIATUS, "0:extraCost", "it must be a character in play: an item I own and a character in my hand are refused", () => {
  const g = hiatusBoard();
  refused(() => hiPlay(g, "mineItem"), "an item");
  refused(() => hiPlay(g, "handc"), "a character in hand");
  assert.equal(zoneOf(g.engine, g.id("hi")), "hand");
  assert.equal(zoneOf(g.engine, g.id("mineItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("handc")), "hand");
  assert.equal(ready(g.engine, P1), 1);
});

clause(HIATUS, "0:extraCost", "with no character I own in play it cannot be played: no pick, or only opponent-owned characters, are refused", () => {
  const g = hiatusBoard({ noChars: true, bare: true });
  refused(() => play(g.engine, P1, g.id("hi"), { selected: { c: [] } }), "no character picked");
  refused(() => hiPlay(g, "theirs"), "only an opponent-owned character");
  refused(() => hiPlay(g, "borrowed"), "only a borrowed character");
  assert.equal(zoneOf(g.engine, g.id("hi")), "hand");
  assert.equal(ready(g.engine, P1), 1);
  assert.equal(g.engine.state.players[P1].deck.length, 4, "nothing drawn");
});

clause(HIATUS, "1:rule", "draws exactly 2 cards (the top two) for the controller; the opponent draws nothing", () => {
  const g = hiatusBoard();
  const [t1, t2] = g.engine.state.players[P1].deck;
  const deckBefore = g.engine.state.players[P1].deck.length;
  const handBefore = g.engine.state.players[P1].hand.length;
  const oppHand = g.engine.state.players[P2].hand.length;
  const oppDeck = g.engine.state.players[P2].deck.length;
  hiPlay(g, "mine");
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore - 2);
  assert.equal(g.engine.state.players[P1].hand.length, handBefore - 1 + 2, "Hiatus left, two cards drawn");
  assert.ok(g.engine.state.players[P1].hand.includes(t1) && g.engine.state.players[P1].hand.includes(t2), "g.engine.state.players[P1].hand.includes(t1) && g.engine.state.players[P1].hand.includes(t2)");
  assert.equal(g.engine.state.players[P2].hand.length, oppHand);
  assert.equal(g.engine.state.players[P2].deck.length, oppDeck);
});

// -- RECUR [G] ------------------------------------------------------------------

clause(HIATUS, "2:ability:recur", "from the discard pile: pay 2 (with [G]), remove it from the game, destroy the picked character I own and draw 1 card", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 1, rage: 1 });
  const top = g.engine.state.players[P1].deck[0];
  const handBefore = g.engine.state.players[P1].hand.length;
  recur(g, "mine");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), 0, "paid 2");
  assert.equal(zoneOf(g.engine, g.id("hi")), "removed", "removed from the game");
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("hi")), "!g.engine.state.players[P1].discard.includes(g.id(\"hi\"))");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "destroyed");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play", "only the picked character");
  assert.equal(g.engine.state.players[P1].hand.length, handBefore + 1, "draw exactly 1 (not 2)");
  assert.ok(g.engine.state.players[P1].hand.includes(top), "g.engine.state.players[P1].hand.includes(top)");
});

clause(HIATUS, "2:ability:recur", "only if this card is in my discard pile: refused from the hand and from play, and nothing is paid", () => {
  for (const zone of ["hand", "play"] as const) {
    const g = hiatusBoard({ hiatusZone: zone, greed: 1, rage: 1 });
    refused(() => recur(g, "mine"), `Hiatus in ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("mine")), "play");
    assert.equal(ready(g.engine, P1), 2, "nothing paid");
    assert.equal(zoneOf(g.engine, g.id("hi")), zone);
  }
  const control = hiatusBoard({ hiatusZone: "discard", greed: 1, rage: 1 });
  recur(control, "mine");
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: from the discard it works");
});

clause(HIATUS, "2:ability:recur", "it is not in the opponent's discard pile: while sitting in MY discard but the opponent cannot use it", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 1, rage: 1 });
  refused(() => activate(g.engine, P2, g.id("hi"), "recur", { selected: { rc: [g.id("theirs")] } }), "the opponent cannot activate my card");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
});

clause(HIATUS, "2:ability:recur", "Pay 2: one resource is not enough (nothing paid, nothing removed), two are", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 1, rage: 0 });
  refused(() => recur(g, "mine"), "only 1 resource for pay 2");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(ready(g.engine, P1), 1);
  const ok = hiatusBoard({ hiatusZone: "discard", greed: 2 });
  recur(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("hi")), "removed");
});

clause(HIATUS, "2:ability:recur", "threshold [G]: two Rage resources are enough to pay but have no [G], refused", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 0, rage: 3 });
  refused(() => recur(g, "mine"), "no [G]");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(ready(g.engine, P1), 3);
  const one = hiatusBoard({ hiatusZone: "discard", greed: 1, rage: 1 });
  recur(one, "mine");
  assert.equal(zoneOf(one.engine, one.id("mine")), "discard", "control: one [G] + one Rage works");
});

clause(HIATUS, "2:ability:recur", "the picked character must be one I own: opponent-owned refused (even if I control it), owned-but-opponent-controlled allowed", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 2 });
  refused(() => recur(g, "theirs"), "opponent's character");
  refused(() => recur(g, "borrowed"), "I control it but do not own it");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(ready(g.engine, P1), 2, "nothing paid");
  recur(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.equal(zoneOf(g.engine, g.id("hi")), "removed");
});

clause(HIATUS, "2:ability:recur", "the picked card must be a character in play: an item or a hand character is refused", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 2 });
  refused(() => recur(g, "mineItem"), "an item");
  refused(() => recur(g, "handc"), "a character in hand");
  assert.equal(zoneOf(g.engine, g.id("hi")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mineItem")), "play");
  assert.equal(ready(g.engine, P1), 2);
});

clause(HIATUS, "2:ability:recur", "only once: the card is removed from the game, so RECUR cannot be used a second time", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 4 });
  recur(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("hi")), "removed");
  refused(() => recur(g, "mine2"), "the card has left the game");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play");
  assert.equal(ready(g.engine, P1), 2, "only the first use was paid");
});

clause(HIATUS, "2:ability:recur", "the opponent draws nothing and the destroyed character goes to its owner's discard pile", () => {
  const g = hiatusBoard({ hiatusZone: "discard", greed: 2 });
  const oppHand = g.engine.state.players[P2].hand.length;
  recur(g, "stolen");
  assert.equal(g.engine.state.players[P2].hand.length, oppHand);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("stolen")), "owner's discard");
  assert.ok(!g.engine.state.players[P2].discard.includes(g.id("stolen")), "!g.engine.state.players[P2].discard.includes(g.id(\"stolen\"))");
});

// ============================================================================
// Portly Tradesmau
// ============================================================================

interface TradeOpts {
  attackers?: number;
  extraBlocker?: boolean;
  resources?: CardPlacement[];
  hand?: boolean;
  active?: PlayerId;
}
function tradeBoard(o: TradeOpts = {}) {
  const n = o.attackers ?? 1;
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0,
    cards: [
      { key: "tm", def: printing(TRADESMAU), owner: P2, zone: o.hand ? "hand" : "play" },
      ...Array.from({ length: n }, (_, i) => ({ key: `at${i}`, def: character({ name: `Attacker ${i}`, strength: 1, life: 9 }), owner: P1, zone: "play" as const })),
      ...(o.extraBlocker ? [{ key: "ob", def: character({ name: "Other Blocker", strength: 1, life: 9 }), owner: P2, zone: "play" as const }] : []),
      { key: "idle", def: character({ name: "Idle Attacker", strength: 1, life: 9 }), owner: P1, zone: "play" },
      ...fillers("d2_", 6, P2, "deck"),
      ...fillers("d1_", 6, P1, "deck"),
      ...(o.resources ?? [])
    ]
  });
}
type TradeGame = ReturnType<typeof tradeBoard>;
const atkKeys = (n: number) => Array.from({ length: n }, (_, i) => `at${i}`);
const p2Hand = (g: TradeGame) => g.engine.state.players[P2].hand.length;

clause(TRADESMAU, "0:rule", "printed as a banker merchant mau character costing 2 with threshold [G][G] and 0 strength / 3 speed / 4 life", () => {
  const c = printing(TRADESMAU);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 2);
  assert.equal(c.threshold, "gg");
  assert.deepEqual([...(c.subtype ?? [])].sort(), ["mau", "merchant"]);
  const g = tradeBoard();
  assert.equal(g.engine.getStat(g.id("tm"), "strength"), 0);
  assert.equal(g.engine.getStat(g.id("tm"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("tm"), "life"), 4);
});

function tradeDeploy(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0,
    cards: [{ key: "tm", def: printing(TRADESMAU), owner: P2, zone: "hand" }, ...resources]
  });
}
const p2Spent = (icon: "greed" | "rage", n: number): CardPlacement[] =>
  bank(icon, n, P2).map((p) => ({ ...p, key: `s${p.key}`, attachedToKey: "__factionB" }));

clause(TRADESMAU, "0:rule", "deploys for exactly 2 with [G][G]; refused with 1 resource, with only one [G], and when the 2 [G] are already spent (cost 2 stays unpaid)", () => {
  const ok = tradeDeploy(bank("greed", 2, P2));
  play(ok.engine, P2, ok.id("tm"));
  assert.equal(zoneOf(ok.engine, ok.id("tm")), "play");
  assert.equal(ready(ok.engine, P2), 0, "paid 2");
  const oneG = tradeDeploy([...bank("greed", 1, P2), ...bank("rage", 3, P2)]);
  refused(() => play(oneG.engine, P2, oneG.id("tm")), "only one [G]");
  assert.equal(zoneOf(oneG.engine, oneG.id("tm")), "hand");
  assert.equal(ready(oneG.engine, P2), 4, "nothing paid");
  const short = tradeDeploy(bank("greed", 1, P2));
  refused(() => play(short.engine, P2, short.id("tm")), "one resource for cost 2");
  const spent = tradeDeploy(p2Spent("greed", 2));
  refused(() => play(spent.engine, P2, spent.id("tm")), "threshold met by spent [G][G], but nothing left to pay the cost", /Costs cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("tm")), "hand");
  const spentOk = tradeDeploy([...p2Spent("greed", 2), ...bank("rage", 2, P2)]);
  play(spentOk.engine, P2, spentOk.id("tm"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("tm")), "play", "control: spent [G][G] meet the threshold and 2 ready Rage pay the cost");
  assert.equal(ready(spentOk.engine, P2), 0);
});

function tmBlock(g: TradeGame, attackers: number, blockers: string[] = ["tm"]): void {
  declareAttackBy(g.engine, P1, atkKeys(attackers).map((k) => g.id(k)));
  declareBlockers(g.engine, P2, blockers.map((k) => g.id(k)));
}

clause(TRADESMAU, "0:rule", "blocking a lone attacker draws 1 card (the top card) for its controller", () => {
  const g = tradeBoard({ attackers: 1 });
  const top = g.engine.state.players[P2].deck[0];
  const handBefore = p2Hand(g);
  tmBlock(g, 1);
  assert.equal(pending(g.engine), undefined);
  assert.equal(p2Hand(g), handBefore + 1);
  assert.ok(g.engine.state.players[P2].hand.includes(top), "the top card was drawn");
});

clause(TRADESMAU, "0:rule", "X is the number of characters in the attacking party: 3 attackers draw 3 (the top three), 2 attackers draw 2", () => {
  const three = tradeBoard({ attackers: 3 });
  const tops = three.engine.state.players[P2].deck.slice(0, 3);
  const before = p2Hand(three);
  tmBlock(three, 3);
  assert.equal(p2Hand(three), before + 3);
  for (const t of tops) assert.ok(three.engine.state.players[P2].hand.includes(t), "three.engine.state.players[P2].hand.includes(t)");
  assert.equal(three.engine.state.players[P2].deck.length, 3);
  const two = tradeBoard({ attackers: 2 });
  const beforeTwo = p2Hand(two);
  tmBlock(two, 2);
  assert.equal(p2Hand(two), beforeTwo + 2);
});

clause(TRADESMAU, "0:rule", "only the attacking party counts: the number of blockers and the attacker's idle teammates do not change X", () => {
  const g = tradeBoard({ attackers: 2, extraBlocker: true });
  const before = p2Hand(g);
  tmBlock(g, 2, ["tm", "ob"]);
  assert.equal(p2Hand(g), before + 2, "2 attackers (the 2 blockers and the idle character are not counted)");
});

clause(TRADESMAU, "0:rule", "draws once per block, for the blocker's controller only: the attacker draws nothing", () => {
  const g = tradeBoard({ attackers: 2 });
  const p1Before = g.engine.state.players[P1].hand.length;
  const p1Deck = g.engine.state.players[P1].deck.length;
  tmBlock(g, 2);
  assert.equal(g.engine.state.players[P1].hand.length, p1Before);
  assert.equal(g.engine.state.players[P1].deck.length, p1Deck);
  finishBattle(g.engine);
  assert.equal(p2Hand(g), 2, "no further draw when the battle resolves");
});

clause(TRADESMAU, "0:rule", "only when THIS card blocks: another character blocking alone, or no block at all, draws nothing", () => {
  const other = tradeBoard({ attackers: 2, extraBlocker: true });
  const before = p2Hand(other);
  tmBlock(other, 2, ["ob"]);
  assert.equal(p2Hand(other), before, "Other Blocker blocked, Tradesmau stayed out");
  assert.equal(pending(other.engine), undefined);
  const none = tradeBoard({ attackers: 2 });
  tmBlock(none, 2, []);
  assert.equal(p2Hand(none), 0, "no blockers");
  const control = tradeBoard({ attackers: 2 });
  tmBlock(control, 2);
  assert.equal(p2Hand(control), 2, "control: when it blocks it draws");
});

clause(TRADESMAU, "0:rule", "it does not draw merely by entering play or by attacking", () => {
  const g = tradeBoard({ attackers: 1, active: P2 });
  const before = p2Hand(g);
  declareAttackBy(g.engine, P2, [g.id("tm")]);
  assert.equal(p2Hand(g), before, "attacking with Tradesmau does not draw");
  assert.equal(pending(g.engine), undefined);
});

clause(TRADESMAU, "0:rule", "it draws when it blocks in a later battle too (each block triggers)", () => {
  const g = tradeBoard({ attackers: 1, extraBlocker: false });
  tmBlock(g, 1);
  finishBattle(g.engine);
  const after = p2Hand(g);
  assert.equal(after, 1);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  const before2 = p2Hand(g);
  declareAttackBy(g.engine, P1, [g.id("at0"), g.id("idle")]);
  declareBlockers(g.engine, P2, [g.id("tm")]);
  assert.equal(p2Hand(g), before2 + 2, "second block: 2 attackers, 2 cards");
});

// ============================================================================
// Prehensile Pirate
// ============================================================================

interface PirOpts {
  greed?: number;
  rage?: number;
  discard?: number;
  oppDiscard?: number;
  extra?: CardPlacement[];
}
function pirateBoard(o: PirOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0,
    cards: [
      { key: "pr", def: printing(PIRATE), owner: P1, zone: "hand" },
      ...fillers("dc", o.discard ?? 4, P1, "discard"),
      ...fillers("od", o.oppDiscard ?? 4, P2, "discard"),
      ...fillers("dk", 3, P1, "deck"),
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...(o.extra ?? [])
    ]
  });
}
type PirGame = ReturnType<typeof pirateBoard>;
const pirPlay = (g: PirGame, picks: string[]) => play(g.engine, P1, g.id("pr"), { selected: { exile4: picks.map((k) => g.id(k)) } });
const removedOf = (g: PirGame) => Object.keys(g.engine.state.cards).filter((c) => g.engine.state.cards[c].zone === "removed");

clause(PIRATE, "0:extraCost", "printed as a banker pirate mau character costing 4 with threshold [G][G] and 3 strength / 3 speed / 5 life", () => {
  const c = printing(PIRATE);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "gg");
  assert.deepEqual([...(c.subtype ?? [])].sort(), ["mau", "pirate"]);
  const g = pirateBoard();
  assert.equal(g.engine.getStat(g.id("pr"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("pr"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("pr"), "life"), 5);
});

clause(PIRATE, "0:extraCost", "deploys for exactly 4 with [G][G], removing exactly 4 cards of my discard pile from the game", () => {
  const g = pirateBoard({ discard: 4 });
  pirPlay(g, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("pr")), "play");
  assert.equal(ready(g.engine, P1), 0, "paid 4");
  for (const k of ["dc0", "dc1", "dc2", "dc3"]) assert.equal(zoneOf(g.engine, g.id(k)), "removed", k);
  assert.equal(g.engine.state.players[P1].discard.length, 0);
});

clause(PIRATE, "0:extraCost", "with 5 cards in the discard the player picks which 4: the picked 4 leave the game and the 5th stays", () => {
  const g = pirateBoard({ discard: 5 });
  pirPlay(g, ["dc4", "dc2", "dc1", "dc0"]);
  assert.deepEqual(removedOf(g).sort(), ["dc0", "dc1", "dc2", "dc4"].map((k) => g.id(k)).sort());
  assert.equal(zoneOf(g.engine, g.id("dc3")), "discard", "the unpicked card stays");
});

clause(PIRATE, "0:extraCost", "needs 4 cards: with 3 in my discard it is refused, nothing is paid or removed", () => {
  const g = pirateBoard({ discard: 3 });
  refused(() => pirPlay(g, ["dc0", "dc1", "dc2"]), "only 3 cards to remove");
  assert.equal(zoneOf(g.engine, g.id("pr")), "hand");
  assert.equal(ready(g.engine, P1), 4, "nothing paid");
  assert.equal(removedOf(g).length, 0);
  assert.equal(g.engine.state.players[P1].discard.length, 3);
});

clause(PIRATE, "0:extraCost", "picking fewer than 4 (or more than 4) from a big enough discard pile is refused", () => {
  const g = pirateBoard({ discard: 6 });
  refused(() => pirPlay(g, ["dc0", "dc1", "dc2"]), "only 3 picked");
  refused(() => pirPlay(g, ["dc0", "dc1", "dc2", "dc3", "dc4"]), "5 picked");
  assert.equal(zoneOf(g.engine, g.id("pr")), "hand");
  assert.equal(removedOf(g).length, 0);
  assert.equal(ready(g.engine, P1), 4);
});

clause(PIRATE, "0:extraCost", "only MY discard pile: the opponent's discarded cards cannot be removed, even to reach 4", () => {
  const g = pirateBoard({ discard: 2, oppDiscard: 4 });
  refused(() => pirPlay(g, ["dc0", "dc1", "od0", "od1"]), "two of the picks are the opponent's cards");
  assert.equal(zoneOf(g.engine, g.id("pr")), "hand");
  assert.equal(removedOf(g).length, 0);
  assert.equal(g.engine.state.players[P2].discard.length, 4);
});

clause(PIRATE, "0:extraCost", "any 4 cards count, whatever their type, and cards not in the discard pile cannot be picked", () => {
  const g = pirateBoard({
    discard: 0,
    extra: [
      { key: "ci", def: item({ name: "Dead Item" }), owner: P1, zone: "discard" },
      { key: "cl", def: location({ name: "Dead Loc" }), owner: P1, zone: "discard" },
      { key: "ct", def: tactic({ name: "Dead Tactic" }), owner: P1, zone: "discard" },
      { key: "cc", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "inplay", def: character({ name: "In Play" }), owner: P1, zone: "play" }
    ]
  });
  refused(() => pirPlay(g, ["ci", "cl", "ct", "inhand"]), "a card from the hand");
  refused(() => pirPlay(g, ["ci", "cl", "ct", "inplay"]), "a card in play");
  assert.equal(zoneOf(g.engine, g.id("pr")), "hand");
  pirPlay(g, ["ci", "cl", "ct", "cc"]);
  assert.equal(zoneOf(g.engine, g.id("pr")), "play", "control: an item, location, tactic and character are fine");
  assert.deepEqual(removedOf(g).sort(), ["ci", "cl", "ct", "cc"].map((k) => g.id(k)).sort());
});

clause(PIRATE, "0:extraCost", "the resource cost still applies: 3 resources, or no [G][G], is refused even with 4 cards to remove", () => {
  const short = pirateBoard({ greed: 2, rage: 1 });
  refused(() => pirPlay(short, ["dc0", "dc1", "dc2", "dc3"]), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("pr")), "hand");
  assert.equal(removedOf(short).length, 0, "cards not removed either");
  const oneG = pirateBoard({ greed: 1, rage: 3 });
  refused(() => pirPlay(oneG, ["dc0", "dc1", "dc2", "dc3"]), "only one [G]");
  assert.equal(removedOf(oneG).length, 0);
  assert.equal(ready(oneG.engine, P1), 4);
});

// ============================================================================
// Property Condemner
// ============================================================================

interface CondOpts {
  hand?: boolean;
  faceDown?: boolean;
  active?: PlayerId;
  resources?: CardPlacement[];
  extra?: CardPlacement[];
}
function condemnerBoard(o: CondOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0,
    cards: [
      o.faceDown
        ? { key: "pc", def: printing(CONDEMNER), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "pc", def: printing(CONDEMNER), owner: P1, zone: "hand" as const },
      { key: "myloc", def: location({ name: "My Loc" }), owner: P1, zone: "play" },
      { key: "oppLoc", def: location({ name: "Opp Loc" }), owner: P2, zone: "play" },
      { key: "inDisc", def: location({ name: "Discard Loc" }), owner: P2, zone: "discard" },
      { key: "inHand", def: location({ name: "Hand Loc" }), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Bystander Item" }), owner: P2, zone: "play" },
      ...fillers("d1_", 3, P1, "deck"),
      ...(o.resources ?? [...bank("greed", 2, P1), ...bank("rage", 2, P1)]),
      ...(o.extra ?? [])
    ]
  });
}
type CondGame = ReturnType<typeof condemnerBoard>;
/** Deploys the Condemner and leaves its enter-play prompt open. */
const condemnerEnters = (g: CondGame) => play(g.engine, P1, g.id("pc"));

clause(CONDEMNER, "0:rule", "printed as a banker priest mau character costing 4 with threshold [G][G] and 2 strength / 4 speed / 2 life", () => {
  const c = printing(CONDEMNER);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "gg");
  assert.deepEqual([...(c.subtype ?? [])].sort(), ["mau", "priest"]);
  const g = condemnerBoard();
  assert.equal(g.engine.getStat(g.id("pc"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("pc"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("pc"), "life"), 2);
});

clause(CONDEMNER, "0:rule", "deploys for exactly 4 with [G][G]; refused with 3 resources and with only one [G]", () => {
  const ok = condemnerBoard();
  condemnerEnters(ok);
  assert.equal(zoneOf(ok.engine, ok.id("pc")), "play");
  assert.equal(ready(ok.engine, P1), 0, "paid 4");
  const short = condemnerBoard({ resources: [...bank("greed", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => condemnerEnters(short), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("pc")), "hand");
  assert.equal(ready(short.engine, P1), 3);
  const oneG = condemnerBoard({ resources: [...bank("greed", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => condemnerEnters(oneG), "only one [G]");
  assert.equal(zoneOf(oneG.engine, oneG.id("pc")), "hand");
  assert.equal(ready(oneG.engine, P1), 4);
});

clause(CONDEMNER, "0:rule", "when it enters play its controller may pick a location, and that location is destroyed", () => {
  const g = condemnerBoard();
  condemnerEnters(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oppLoc")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "discard", "destroyed");
  assert.equal(zoneOf(g.engine, g.id("myloc")), "play", "only the picked location");
  assert.equal(zoneOf(g.engine, g.id("pc")), "play");
});

clause(CONDEMNER, "0:rule", "the location may be one of my own, too", () => {
  const g = condemnerBoard();
  condemnerEnters(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("myloc")] });
  assert.equal(zoneOf(g.engine, g.id("myloc")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "play");
});

clause(CONDEMNER, "0:rule", "it is a may: declining the pick (no location) destroys nothing and the Condemner stays in play", () => {
  const g = condemnerBoard();
  condemnerEnters(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("myloc")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "play");
  assert.equal(zoneOf(g.engine, g.id("pc")), "play");
});

clause(CONDEMNER, "0:rule", "only a location in play can be picked: a character, an item, a location in the discard pile or in my hand are refused", () => {
  for (const bad of ["chr", "itm", "inDisc", "inHand"]) {
    const g = condemnerBoard();
    condemnerEnters(g);
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `${bad} is not a location in play`);
    assert.equal(zoneOf(g.engine, g.id(bad)), { chr: "play", itm: "play", inDisc: "discard", inHand: "hand" }[bad], `${bad} untouched`);
    assert.equal(zoneOf(g.engine, g.id("pc")), "play");
  }
  const g = condemnerBoard();
  condemnerEnters(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(zoneOf(g.engine, g.id("chr")), "play", "control: the bystander character was never touched");
  assert.equal(zoneOf(g.engine, g.id("itm")), "play");
});

clause(CONDEMNER, "0:rule", "the pick destroys exactly one location: with two locations in play only the chosen one goes", () => {
  const g = condemnerBoard({ extra: [{ key: "loc3", def: location({ name: "Third Loc" }), owner: P2, zone: "play" }] });
  condemnerEnters(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("loc3")] });
  assert.equal(zoneOf(g.engine, g.id("loc3")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "play");
  assert.equal(zoneOf(g.engine, g.id("myloc")), "play");
});

clause(CONDEMNER, "0:rule", "with no location in play there is nothing to pick: it still enters play and nothing breaks", () => {
  const g = condemnerBoard();
  g.engine.state.cards[g.id("myloc")].zone = "discard";
  g.engine.state.cards[g.id("oppLoc")].zone = "discard";
  g.engine.state.players[P1].play = g.engine.state.players[P1].play.filter((c) => c !== g.id("myloc"));
  g.engine.state.players[P2].play = g.engine.state.players[P2].play.filter((c) => c !== g.id("oppLoc"));
  condemnerEnters(g);
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("pc")), "play");
});

clause(CONDEMNER, "0:rule", "developed face-down as a resource it has no abilities: no pick, no location destroyed", () => {
  const g = condemnerBoard({ resources: [] });
  developResource(g.engine, P1, g.id("pc"), true);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, true);
  assert.equal(pending(g.engine), undefined, "no enters-play prompt");
  assert.equal(zoneOf(g.engine, g.id("myloc")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "play");
});

// -- FLIP UP: 2 [G][G] -----------------------------------------------------------

const flipCond = (g: CondGame) => rawFlipUp(g.engine, P1, g.id("pc"));

clause(CONDEMNER, "1:flipUp", "a face-down Condemner flips up for 2 (not 4) with [G][G]: it enters play face-up and its enters-play pick destroys a location", () => {
  const g = condemnerBoard({ faceDown: true, resources: [...bank("greed", 2, P1), ...bank("rage", 2, P1)] });
  assert.equal(ready(g.engine, P1), 5);
  flipCond(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("pc")), "play");
  assert.equal(g.engine.isResource(g.id("pc")), false);
  const r = ready(g.engine, P1);
  assert.ok(r === 2 || r === 3, `paid exactly 2 (the Condemner may help pay), ready ${r}`);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oppLoc")] });
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "discard");
});

clause(CONDEMNER, "1:flipUp", "the Condemner may pay for its own FLIP UP: itself plus 1 other resource is exactly 2, with the [G][G] threshold met by two other Greed (spent)", () => {
  const g = condemnerBoard({ faceDown: true, resources: [...p2SpentFor(P1, "greed", 2), ...bank("rage", 1, P1)] });
  assert.equal(ready(g.engine, P1), 2, "setup: the Condemner and one Rage are ready; two Greed are spent");
  flipCond(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, false);
  assert.equal(ready(g.engine, P1), 0);
});

clause(CONDEMNER, "1:flipUp", "cost is exactly 2: with the threshold met by spent Greed but only the Condemner itself ready, it is refused", () => {
  const g = condemnerBoard({ faceDown: true, resources: p2SpentFor(P1, "greed", 2) });
  assert.equal(ready(g.engine, P1), 1);
  refused(() => flipCond(g), "1 ready resource for a FLIP UP cost of 2");
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, true);
  assert.equal(ready(g.engine, P1), 1, "nothing paid");
});

clause(CONDEMNER, "1:flipUp", "needs [G][G]: one Greed among plenty of Rage is refused, two Greed are enough", () => {
  const one = condemnerBoard({ faceDown: true, resources: [...bank("greed", 1, P1), ...bank("rage", 4, P1)] });
  refused(() => flipCond(one), "only one [G]");
  assert.equal(one.engine.state.cards[one.id("pc")].faceDown, true);
  assert.equal(ready(one.engine, P1), 6, "nothing paid");
  const none = condemnerBoard({ faceDown: true, resources: bank("rage", 5, P1) });
  refused(() => flipCond(none), "no [G]");
  const two = condemnerBoard({ faceDown: true, resources: [...bank("greed", 2, P1), ...bank("rage", 1, P1)] });
  flipCond(two);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("pc")].faceDown, false, "control: two [G] work");
});

clause(CONDEMNER, "1:flipUp", "the Condemner's own Volition icon does not meet the threshold: alone with one Greed it is refused", () => {
  const g = condemnerBoard({ faceDown: true, resources: bank("greed", 1, P1) });
  refused(() => flipCond(g), "one Greed + the face-down Condemner: only one [G]");
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, true);
  assert.equal(ready(g.engine, P1), 2);
});

clause(CONDEMNER, "1:flipUp", "a character can only be flipped up on its controller's own turn: refused on the opponent's turn", () => {
  const g = condemnerBoard({ faceDown: true, active: P2, resources: [...bank("greed", 2, P1), ...bank("rage", 2, P1)] });
  refused(() => flipCond(g), "a character on the opponent's turn");
  assert.equal(g.engine.state.cards[g.id("pc")].faceDown, true);
  assert.equal(ready(g.engine, P1), 5, "nothing paid");
});

// ============================================================================
// Purifying Priest
// ============================================================================

const p2SpentFor = (owner: PlayerId, icon: "greed" | "rage", n: number): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, key: `sp${p.key}`, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

interface PriestOpts {
  locStructure?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}
function priestBoard(o: PriestOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0,
    cards: [
      { key: "pp", def: printing(PRIEST), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Shrine", structure: o.locStructure ?? 5 }), owner: P1, zone: "play" },
      { key: "oloc", def: location({ name: "Opp Shrine", structure: 5 }), owner: P2, zone: "play" },
      { key: "chr", def: character({ name: "Bystander", life: 9 }), owner: P2, zone: "play" },
      { key: "inHandLoc", def: location({ name: "Hand Shrine", structure: 5 }), owner: P1, zone: "hand" },
      { key: "z1", def: factionHitTactic("Zap1", 1, "controller"), owner: P1, zone: "hand" },
      { key: "z1b", def: factionHitTactic("Zap1b", 1, "controller"), owner: P1, zone: "hand" },
      { key: "z2", def: factionHitTactic("Zap2", 2, "controller"), owner: P1, zone: "hand" },
      { key: "zo", def: factionHitTactic("ZapOpp", 1, "opponent"), owner: P1, zone: "hand" },
      { key: "zc", def: zapTactic("ZapChar", 1), owner: P1, zone: "hand" },
      { key: "p1atk", def: character({ name: "P1 Attacker", strength: 3, life: 9 }), owner: P1, zone: "play" },
      { key: "p2atk", def: character({ name: "P2 Attacker", strength: 3, life: 9 }), owner: P2, zone: "play" },
      ...fillers("d1_", 3, P1, "deck"),
      ...bank("rage", 4, P1),
      ...bank("rage", 4, P2),
      ...(o.extra ?? [])
    ]
  });
}
type PriestGame = ReturnType<typeof priestBoard>;
const banish = (g: PriestGame, locKey: string, who: PlayerId = P1) =>
  activate(g.engine, who, g.id("pp"), "banish", { selected: { l: [g.id(locKey)] } });
const zapFaction = (g: PriestGame, key: string, _faction: PlayerId) => play(g.engine, P1, g.id(key));
const infl = (g: PriestGame, p: PlayerId) => g.engine.state.players[p].influence;

clause(PRIEST, "0:ability:banish", "printed as a banker priest mau character costing 4 with threshold [G] and 2 strength / 3 speed / 4 life", () => {
  const c = printing(PRIEST);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "g");
  assert.deepEqual([...(c.subtype ?? [])].sort(), ["mau", "priest"]);
  const g = priestBoard();
  assert.equal(g.engine.getStat(g.id("pp"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("pp"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("pp"), "life"), 4);
});

function priestDeploy(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0,
    cards: [{ key: "pp", def: printing(PRIEST), owner: P1, zone: "hand" }, ...resources]
  });
}

clause(PRIEST, "0:ability:banish", "deploys for exactly 4 with [G]; refused with 3 resources and with 4 Rage (no [G])", () => {
  const ok = priestDeploy([...bank("greed", 1, P1), ...bank("rage", 3, P1)]);
  play(ok.engine, P1, ok.id("pp"));
  assert.equal(zoneOf(ok.engine, ok.id("pp")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = priestDeploy([...bank("greed", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => play(short.engine, P1, short.id("pp")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("pp")), "hand");
  const noG = priestDeploy(bank("rage", 4, P1));
  refused(() => play(noG.engine, P1, noG.id("pp")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("pp")), "hand");
  assert.equal(ready(noG.engine, P1), 4);
});

clause(PRIEST, "0:ability:banish", "BANISH has no cost besides the pick: it costs no resources and does not deplete the Priest", () => {
  const g = priestBoard();
  const r = ready(g.engine, P1);
  banish(g, "loc");
  assert.equal(ready(g.engine, P1), r, "no resources paid");
  assert.equal(g.engine.state.cards[g.id("pp")].depleted, false);
  assert.equal(pending(g.engine), undefined);
});

clause(PRIEST, "0:ability:banish", "the next 1 damage to my faction this turn is inflicted to the picked location instead: a 1-damage hit leaves my faction untouched", () => {
  const g = priestBoard();
  banish(g, "loc");
  zapFaction(g, "z1", P1);
  assert.equal(infl(g, P1), 20, "my faction took no damage");
  assert.equal(dmg(g.engine, g.id("loc")), 1, "the location took it instead");
});

clause(PRIEST, "0:ability:banish", "control: without BANISH the same 1 damage hits my faction", () => {
  const g = priestBoard();
  zapFaction(g, "z1", P1);
  assert.equal(infl(g, P1), 19);
  assert.equal(dmg(g.engine, g.id("loc")), 0);
});

clause(PRIEST, "0:ability:banish", "only the next 1 damage is redirected: a 2-damage hit sends 1 to the location and 1 to my faction", () => {
  const g = priestBoard();
  banish(g, "loc");
  zapFaction(g, "z2", P1);
  assert.equal(infl(g, P1), 19, "1 of the 2 damage still reached my faction");
  assert.equal(dmg(g.engine, g.id("loc")), 1, "1 damage redirected");
});

clause(PRIEST, "0:ability:banish", "it is used up by the first damage: a second 1-damage hit goes to my faction", () => {
  const g = priestBoard();
  banish(g, "loc");
  zapFaction(g, "z1", P1);
  zapFaction(g, "z1b", P1);
  assert.equal(infl(g, P1), 19, "the second damage was not redirected");
  assert.equal(dmg(g.engine, g.id("loc")), 1, "only one damage went to the location");
});

clause(PRIEST, "0:ability:banish", "two activations stack: two redirects, so two 1-damage hits are both inflicted to the location", () => {
  const g = priestBoard();
  banish(g, "loc");
  banish(g, "loc");
  zapFaction(g, "z1", P1);
  zapFaction(g, "z1b", P1);
  assert.equal(infl(g, P1), 20);
  assert.equal(dmg(g.engine, g.id("loc")), 2);
});

clause(PRIEST, "0:ability:banish", "only damage to MY faction: damage to the opponent's faction, or to a character, is not redirected and does not use it up", () => {
  const g = priestBoard();
  banish(g, "loc");
  zapFaction(g, "zo", P2);
  assert.equal(infl(g, P2), 19, "the opponent's faction took its damage");
  assert.equal(dmg(g.engine, g.id("loc")), 0);
  play(g.engine, P1, g.id("zc"), { selected: { t: [g.id("chr")] } });
  assert.equal(dmg(g.engine, g.id("chr")), 1, "a character takes its damage");
  assert.equal(dmg(g.engine, g.id("loc")), 0);
  zapFaction(g, "z2", P1);
  assert.equal(dmg(g.engine, g.id("loc")), 1, "the redirect was still waiting for my faction's damage");
  assert.equal(infl(g, P1), 19);
});

clause(PRIEST, "0:ability:banish", "the redirect goes to the location picked at activation (the opponent's location can be picked too)", () => {
  const g = priestBoard();
  banish(g, "oloc");
  zapFaction(g, "z1", P1);
  assert.equal(dmg(g.engine, g.id("oloc")), 1);
  assert.equal(dmg(g.engine, g.id("loc")), 0);
  assert.equal(infl(g, P1), 20);
});

clause(PRIEST, "0:ability:banish", "the redirected damage can destroy the location (structure 1)", () => {
  const g = priestBoard({ locStructure: 1 });
  banish(g, "loc");
  zapFaction(g, "z1", P1);
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard", "1 damage destroys a structure-1 location");
  assert.equal(infl(g, P1), 20);
});

clause(PRIEST, "0:ability:banish", "also redirects battle damage: an unblocked 3-strength attack on my faction costs 2 influence and puts 1 damage on the location", () => {
  const g = priestBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("p2atk")]);
  banish(g, "loc", P1);
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(infl(g, P1), 18, "3 damage minus the 1 redirected");
  assert.equal(dmg(g.engine, g.id("loc")), 1);
});

clause(PRIEST, "0:ability:banish", "control: the same unblocked attack without BANISH costs 3 influence", () => {
  const g = priestBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("p2atk")]);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(infl(g, P1), 17);
});

clause(PRIEST, "0:ability:banish", "this turn only: a BANISH from my turn does not protect my faction on the opponent's next turn", () => {
  const g = priestBoard();
  banish(g, "loc");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  declareAttackBy(g.engine, P2, [g.id("p2atk")]);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(infl(g, P1), 17, "full 3 damage: the redirect expired at end of turn");
  assert.equal(dmg(g.engine, g.id("loc")), 0);
});

clause(PRIEST, "0:ability:banish", "the pick must be a location in play: a character, a faction and a location in hand are refused", () => {
  const g = priestBoard();
  refused(() => banish(g, "chr"), "a character");
  refused(() => banish(g, "inHandLoc"), "a location in hand");
  refused(() => activate(g.engine, P1, g.id("pp"), "banish", { selected: { l: [g.engine.state.players[P1].factionId!] } }), "a faction");
  refused(() => activate(g.engine, P1, g.id("pp"), "banish", { selected: { l: [] } }), "no pick at all");
  zapFaction(g, "z1", P1);
  assert.equal(infl(g, P1), 19, "no redirect was set up by the refused attempts");
  assert.equal(dmg(g.engine, g.id("loc")), 0);
});

clause(PRIEST, "0:ability:banish", "with no location in play BANISH cannot be used", () => {
  const g = priestBoard();
  g.engine.state.cards[g.id("loc")].zone = "discard";
  g.engine.state.cards[g.id("oloc")].zone = "discard";
  g.engine.state.players[P1].play = g.engine.state.players[P1].play.filter((c) => c !== g.id("loc"));
  g.engine.state.players[P2].play = g.engine.state.players[P2].play.filter((c) => c !== g.id("oloc"));
  refused(() => activate(g.engine, P1, g.id("pp"), "banish", { selected: { l: [] } }), "no location to pick");
});

clause(PRIEST, "0:ability:banish", "also redirects battle damage when used in the before-damage window", () => {
  const g = priestBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("p2atk")]);
  declareBlockers(g.engine, P1, []);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  banish(g, "loc", P1);
  finishBattle(g.engine);
  assert.equal(infl(g, P1), 18, "3 damage minus the 1 redirected");
  assert.equal(dmg(g.engine, g.id("loc")), 1);
});

clause(CARAVAN, "0:rule", "the search finds ONE location: picking both locations at once is refused", () => {
  const g = caravanBoard();
  toP1Turn(g);
  answerPending(g.engine, "mayPay", { pay: true });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA"), g.id("locB")] }), "two locations");
  assert.equal(zoneOf(g.engine, g.id("locA")), "deck");
  assert.equal(zoneOf(g.engine, g.id("locB")), "deck");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("locA")] });
  assert.equal(zoneOf(g.engine, g.id("locA")), "hand", "control: one location is fine");
});

clause(CONDEMNER, "0:rule", "only when THIS card enters play: another card entering play (mine or the opponent's) while a Condemner is out prompts nothing", () => {
  const g = condemnerBoard({
    extra: [
      { key: "other", def: character({ name: "Other Char" }), owner: P1, zone: "hand" },
      { key: "pc2", def: printing(CONDEMNER), owner: P1, zone: "play" },
      ...bank("rage", 2, P1)
    ]
  });
  play(g.engine, P1, g.id("other"));
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(pending(g.engine), undefined, "a vanilla character entering play triggers nothing");
  assert.equal(zoneOf(g.engine, g.id("myloc")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppLoc")), "play");
});
