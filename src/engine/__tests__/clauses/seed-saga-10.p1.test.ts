import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  fightThrough,
  finishBattle,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";
import { printedStats } from "./_printed.js";

const RUSE = "488cd07e-0ca2-4a27-9719-c4f7f3dc6294"; // tactic rogue cost 3 "dd" -- EXTRA COST deploy only during a battle; this turn all characters in your party gain 1 speed; FLIP UP 4 [D][D]
const PICK = "7a6639a3-2105-4f95-841a-8ed0d7ea791a"; // item gear rogue cost 1 "d" -- ATTACH TO CHARACTER; +1 str +1 life; if destroyed flip face-down under owner's control; FLIP UP 1 [D]
const MUG = "eda064a7-e82c-4939-81f1-9cf4896327b3"; // character thief rogue cost 4 "d" 2/3/1 -- COVERT; ETB may search an opponent's deck for a card, if you do put it into their discard
const BAND = "321bdcf5-6e72-4c3b-a42e-17583263e0e3"; // character outlaw rogue cost 2 "d" 1/1/1 -- COVERT; inflicts damage to a faction: token; +1 str per token
const SMO = "6c49725e-d71b-43b3-a85f-38ec7396911d"; // tactic rogue cost 4 "dd" -- EXTRA COST pick opp character, both remove top card; X = opp cost - my cost; character loses X life this turn; draw a card

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const flipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  rawFlipUp(engine, player, cardId, selected);
  resolvePendingResponses(engine);
};
const spentOf = (icon: "deception" | "greed" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ============================================================================
// Rumply Ruse
// ============================================================================

interface RuseOpts {
  dec?: number;
  rage?: number;
  faceDown?: boolean;
  owner?: PlayerId;
  /** resources for the owner are spent (already attached) */
  spentDec?: number;
}
function ruseBoard(o: RuseOpts = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 1,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "a1", def: character({ name: "A1", strength: 2, speed: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, speed: 3, life: 9 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 2, speed: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 2, speed: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 2, speed: 2, life: 9 }), owner: P2, zone: "play" },
      o.faceDown
        ? { key: "ruse", def: printing(RUSE), owner, zone: "play" as const, faceDown: true }
        : { key: "ruse", def: printing(RUSE), owner, zone: "hand" as const },
      ...fillers("d1_", 3, P1, "deck"),
      ...fillers("d2_", 3, P2, "deck"),
      ...bank("deception", o.dec ?? 2, owner),
      ...bank("rage", o.rage ?? 1, owner),
      ...spentOf("deception", o.spentDec ?? 0, owner)
    ]
  });
}
type RuseGame = ReturnType<typeof ruseBoard>;
const spd = (g: RuseGame, k: string): number => g.engine.getStat(g.id(k), "speed");
/** P1 attacks with a1 + a2 (a party), P2 blocks with b1: waits in the before-damage window, P1 holding priority. */
function ruseBattle(g: RuseGame): void {
  declareAttackBy(g.engine, P1, [g.id("a1"), g.id("a2")]);
  declareBlockers(g.engine, P2, [g.id("b1")]);
}

clause(RUSE, "0:extraCost", "printed as a rogue tactic costing 3 with threshold [D][D]", () => {
  const c = printing(RUSE);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "rogue");
  assert.equal(c.cost, 3);
  assert.equal(c.threshold, "dd");
});

clause(RUSE, "0:extraCost", "deploys during a battle for exactly 3 resources with [D][D]; the tactic is spent", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  ruseBattle(g);
  assert.ok(g.engine.state.battle, "setup: a battle is under way");
  assert.equal(ready(g.engine), 3);
  play(g.engine, P1, g.id("ruse"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ruse")), "discard");
  assert.equal(ready(g.engine), 0, "paid 3");
});

clause(RUSE, "0:extraCost", "cost is 3: refused with only 2 resources even when both are [D]", () => {
  const short = ruseBoard({ dec: 2, rage: 0 });
  ruseBattle(short);
  assert.equal(ready(short.engine), 2);
  refused(() => play(short.engine, P1, short.id("ruse")), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("ruse")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was paid");
  assert.equal(spd(short, "a1"), 2);
  const more = ruseBoard({ dec: 2, rage: 3 });
  ruseBattle(more);
  play(more.engine, P1, more.id("ruse"));
  assert.equal(ready(more.engine), 2, "control: with 5 resources exactly 3 are paid");
});

clause(RUSE, "0:extraCost", "threshold [D][D]: three resources with only one [D] are refused", () => {
  const one = ruseBoard({ dec: 1, rage: 2 });
  ruseBattle(one);
  assert.equal(ready(one.engine), 3);
  refused(() => play(one.engine, P1, one.id("ruse")), "only one [D]");
  assert.equal(zoneOf(one.engine, one.id("ruse")), "hand");
  assert.equal(ready(one.engine), 3, "nothing was paid");
  const none = ruseBoard({ dec: 0, rage: 3 });
  ruseBattle(none);
  refused(() => play(none.engine, P1, none.id("ruse")), "no [D] at all");
  const spent = ruseBoard({ dec: 1, rage: 2, spentDec: 1 });
  ruseBattle(spent);
  play(spent.engine, P1, spent.id("ruse"));
  assert.equal(zoneOf(spent.engine, spent.id("ruse")), "discard", "control: a spent [D] counts toward the threshold; one ready [D] + 2 Rage pay");
});

clause(RUSE, "0:extraCost", "Deploy this only during a battle: refused with no battle under way, accepted once a battle starts", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  refused(() => play(g.engine, P1, g.id("ruse")), "no battle", /cannot be (deployed|flipped up) right now/);
  assert.equal(zoneOf(g.engine, g.id("ruse")), "hand");
  assert.equal(ready(g.engine), 3, "nothing paid");
  ruseBattle(g);
  play(g.engine, P1, g.id("ruse"));
  assert.equal(zoneOf(g.engine, g.id("ruse")), "discard", "control: during the battle it deploys");
});

clause(RUSE, "0:extraCost", "the battle ending ends the window: after the battle it is refused again", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  ruseBattle(g);
  finishBattle(g.engine);
  refused(() => play(g.engine, P1, g.id("ruse")), "the battle is over", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("ruse")), "hand");
});

clause(RUSE, "1:rule", "all characters in my attacking party gain 1 speed (stat +1); characters outside the party and the blocker do not", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  ruseBattle(g);
  assert.deepEqual([spd(g, "a1"), spd(g, "a2"), spd(g, "a3"), spd(g, "b1"), spd(g, "b2")], [2, 3, 2, 2, 2], "before");
  play(g.engine, P1, g.id("ruse"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(spd(g, "a1"), 3, "party member a1");
  assert.equal(spd(g, "a2"), 4, "party member a2");
  assert.equal(spd(g, "a3"), 2, "a3 is not in the party");
  assert.equal(spd(g, "b1"), 2, "the opposing blocker is not in my party");
  assert.equal(spd(g, "b2"), 2, "an opposing character that did not block");
});

clause(RUSE, "1:rule", "a party of one character gains 1 speed too", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  declareAttackBy(g.engine, P1, [g.id("a1")]);
  declareBlockers(g.engine, P2, [g.id("b1")]);
  play(g.engine, P1, g.id("ruse"));
  assert.equal(spd(g, "a1"), 3);
  assert.equal(spd(g, "a2"), 3, "a2 stayed home: unchanged");
});

clause(RUSE, "1:rule", "'this turn': the speed bonus lasts through the turn and is gone once the turn ends", () => {
  const g = ruseBoard({ dec: 2, rage: 1 });
  ruseBattle(g);
  play(g.engine, P1, g.id("ruse"));
  finishBattle(g.engine);
  assert.equal(spd(g, "a1"), 3, "still +1 after the battle, same turn");
  assert.equal(spd(g, "a2"), 4);
  endTurn(g.engine, P1);
  assert.equal(spd(g, "a1"), 2, "back to printed speed next turn");
  assert.equal(spd(g, "a2"), 3);
});

clause(RUSE, "1:rule", "the defender plays it too: 'your party' is the controller's characters in the battle (the blockers), not the attackers", () => {
  const g = ruseBoard({ owner: P2, dec: 2, rage: 1 });
  declareAttackBy(g.engine, P1, [g.id("a1"), g.id("a2")]);
  declareBlockers(g.engine, P2, [g.id("b1")]);
  g.engine.perform({ type: "passPriority", playerId: P1 });
  play(g.engine, P2, g.id("ruse"));
  assert.equal(zoneOf(g.engine, g.id("ruse")), "discard");
  assert.equal(spd(g, "b1"), 3, "blocking character gains 1");
  assert.equal(spd(g, "b2"), 2, "non-blocker unchanged");
  assert.equal(spd(g, "a1"), 2, "attackers are not in P2's party");
  assert.equal(spd(g, "a2"), 3);
});

/** A face-down Ruse in play (a Volition resource) with `dec` [D] + `rage` Rage resources. */
const flipBoard = (dec: number, rage: number, spentDec = 0) => ruseBoard({ faceDown: true, dec, rage, spentDec });

clause(RUSE, "2:flipUp", "FLIP UP 4 [D][D]: a face-down Ruse flips up in a battle, gives the party +1 speed and is spent", () => {
  const g = flipBoard(2, 2);
  ruseBattle(g);
  assert.equal(ready(g.engine), 5, "setup: face-down Ruse, 2 [D], 2 Rage");
  flipUp(g.engine, P1, g.id("ruse"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ruse")), "discard");
  assert.equal(spd(g, "a1"), 3);
  assert.equal(spd(g, "a2"), 4);
  assert.equal(spd(g, "a3"), 2);
  assert.equal(spd(g, "b1"), 2);
  const r = ready(g.engine);
  assert.ok(r === 0 || r === 1, `a cost of 4 was paid out of 5 (ready ${r})`);
});

clause(RUSE, "2:flipUp", "the FLIP UP cost is 4, not 3: Ruse + 2 [D] + 1 Rage works (Ruse pays for itself), Ruse + 2 [D] is one short", () => {
  const ok = flipBoard(2, 1);
  ruseBattle(ok);
  assert.equal(ready(ok.engine), 4);
  flipUp(ok.engine, P1, ok.id("ruse"));
  assert.equal(zoneOf(ok.engine, ok.id("ruse")), "discard", "the Ruse pays for itself (CR 507.4b)");
  assert.equal(spd(ok, "a1"), 3);
  const short = flipBoard(2, 0);
  ruseBattle(short);
  assert.equal(ready(short.engine), 3);
  refused(() => flipUp(short.engine, P1, short.id("ruse")), "3 resources for a FLIP UP cost of 4");
  assert.equal(short.engine.state.cards[short.id("ruse")].faceDown, true);
  assert.equal(ready(short.engine), 3, "nothing paid");
  assert.equal(spd(short, "a1"), 2);
});

clause(RUSE, "2:flipUp", "the FLIP UP cost is exactly 4: with 6 resources 4 are paid and the rest stay ready", () => {
  const g = flipBoard(2, 3);
  ruseBattle(g);
  assert.equal(ready(g.engine), 6);
  flipUp(g.engine, P1, g.id("ruse"));
  const r = ready(g.engine);
  assert.ok(r === 1 || r === 2, `4 paid, one of them possibly the Ruse (ready ${r})`);
});

clause(RUSE, "2:flipUp", "FLIP UP threshold [D][D]: the Ruse's own icon does not count, one [D] among the others or Rage alone is refused", () => {
  const one = flipBoard(1, 4);
  ruseBattle(one);
  refused(() => flipUp(one.engine, P1, one.id("ruse")), "one [D] only");
  assert.equal(one.engine.state.cards[one.id("ruse")].faceDown, true);
  assert.equal(ready(one.engine), 6, "nothing paid");
  const none = flipBoard(0, 5);
  ruseBattle(none);
  refused(() => flipUp(none.engine, P1, none.id("ruse")), "no [D]");
  assert.equal(none.engine.state.cards[none.id("ruse")].faceDown, true);
  const spent = flipBoard(1, 3, 1);
  ruseBattle(spent);
  flipUp(spent.engine, P1, spent.id("ruse"));
  assert.equal(zoneOf(spent.engine, spent.id("ruse")), "discard", "control: one ready + one spent [D] meet the threshold");
});

clause(RUSE, "2:flipUp", "still only during a battle: refused when no battle is under way", () => {
  const g = flipBoard(2, 3);
  refused(() => flipUp(g.engine, P1, g.id("ruse")), "no battle", /cannot be (deployed|flipped up) right now/);
  assert.equal(g.engine.state.cards[g.id("ruse")].faceDown, true);
  assert.equal(ready(g.engine), 6, "nothing paid");
  ruseBattle(g);
  flipUp(g.engine, P1, g.id("ruse"));
  assert.equal(zoneOf(g.engine, g.id("ruse")), "discard", "control: in the battle it flips");
});

// ============================================================================
// Rusty Pickaxe
// ============================================================================

const KILL_ITEM = tactic({
  name: "Smash",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "smash",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});
const KILL_CHAR = tactic({
  name: "Slay",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "slay",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});
const NOOP_TACTIC = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });

interface PickOpts {
  zone?: "hand" | "play";
  faceDown?: boolean;
  spentSelf?: boolean;
  attachedTo?: string;
  controller?: PlayerId;
  dec?: number;
  greed?: number;
  spentDec?: number;
}
function pickBoard(o: PickOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      {
        key: "pick",
        def: printing(PICK),
        owner: P1,
        zone: o.zone ?? "hand",
        faceDown: o.faceDown,
        ...(o.controller ? { controller: o.controller } : {}),
        ...(o.attachedTo ? { attachedToKey: o.attachedTo } : {}),
        ...(o.spentSelf ? { attachedToKey: "__factionA" } : {})
      },
      { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "noop", def: NOOP_TACTIC, owner: P2, zone: "hand" },
      { key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" },
      { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
      ...bank("deception", o.dec ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentOf("deception", o.spentDec ?? 0)
    ]
  });
}
type PickBoard = ReturnType<typeof pickBoard>;
const pstr = (b: PickBoard, k: string): number => b.engine.getStat(b.id(k), "strength");
const plife = (b: PickBoard, k: string): number => b.engine.getStat(b.id(k), "life");
const pickPlay = (b: PickBoard, host: string | undefined, player: PlayerId = P1) =>
  play(b.engine, player, b.id("pick"), { selected: host === undefined ? {} : { attachTo: [b.id(host)] } });
const hostOf = (b: PickBoard) => b.engine.state.cards[b.id("pick")].attachedTo;
const pflip = (b: PickBoard, host?: string, player: PlayerId = P1) => flipUp(b.engine, player, b.id("pick"), host ? { attachTo: [b.id(host)] } : {});
const smash = (b: PickBoard, target = "pick") => {
  // the target selector is any item in play
  const { engine } = b;
  play(engine, P1, b.id("smash"), { selected: { t: [b.id(target)] } });
};

clause(PICK, "0:attach", "printed card: a rogue gear item, cost 1, threshold [D]", () => {
  const p = printing(PICK);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "rogue");
  assert.deepEqual([...p.subtype], ["gear"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "d");
  assert.equal(p.attachTo, "character");
});

clause(PICK, "0:attach", "deploys attached to the picked character for exactly 1 resource with [D] (a spent [D] meets the threshold, a ready Greed pays)", () => {
  const b = pickBoard({ spentDec: 1, greed: 1 });
  assert.equal(ready(b.engine), 1);
  pickPlay(b, "a");
  assert.equal(pending(b.engine), undefined);
  const c = b.engine.state.cards[b.id("pick")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown ?? false, false);
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(ready(b.engine), 0, "paid exactly 1");
});

clause(PICK, "0:attach", "the cost is 1, not 0: with a spent [D] and nothing ready it is refused", () => {
  const b = pickBoard({ spentDec: 1 });
  assert.equal(ready(b.engine), 0);
  refused(() => pickPlay(b, "a"), "nothing ready to pay 1");
  assert.equal(zoneOf(b.engine, b.id("pick")), "hand");
});

clause(PICK, "0:attach", "the cost is not 2: a single ready [D] pays it, with the other resource staying ready", () => {
  const b = pickBoard({ dec: 1, greed: 1 });
  pickPlay(b, "a");
  assert.equal(zoneOf(b.engine, b.id("pick")), "play");
  assert.equal(ready(b.engine), 1, "only 1 paid");
});

clause(PICK, "0:attach", "threshold [D]: ready Greed alone is refused", () => {
  const b = pickBoard({ greed: 2 });
  refused(() => pickPlay(b, "a"), "no [D]");
  assert.equal(zoneOf(b.engine, b.id("pick")), "hand");
  assert.equal(ready(b.engine), 2, "nothing paid");
});

clause(PICK, "0:attach", "ATTACH TO CHARACTER: a character (mine or an opponent's) is a legal host; an item, a location, and a faction are refused", () => {
  const foe = pickBoard({ dec: 1 });
  pickPlay(foe, "foe");
  assert.equal(hostOf(foe), foe.id("foe"), "an opponent's character is a legal host");
  for (const bad of ["gear", "place"]) {
    const b = pickBoard({ dec: 1 });
    refused(() => pickPlay(b, bad), `host ${bad} is not a character`);
    assert.equal(zoneOf(b.engine, b.id("pick")), "hand");
    assert.equal(ready(b.engine), 1, "nothing paid");
  }
  const f = pickBoard({ dec: 1 });
  refused(
    () => play(f.engine, P1, f.id("pick"), { selected: { attachTo: [f.engine.state.players[P1].factionId!] } }),
    "a faction is not a character"
  );
  assert.equal(zoneOf(f.engine, f.id("pick")), "hand");
  const none = pickBoard({ dec: 1 });
  refused(() => pickPlay(none, undefined), "no host picked");
  assert.equal(zoneOf(none.engine, none.id("pick")), "hand");
});

clause(PICK, "1:rule", "the attached character gains 1 strength and 1 life; other characters are unchanged", () => {
  const b = pickBoard({ dec: 1 });
  assert.deepEqual([pstr(b, "a"), plife(b, "a")], [2, 4]);
  pickPlay(b, "a");
  assert.equal(pstr(b, "a"), 3, "+1 strength");
  assert.equal(plife(b, "a"), 5, "+1 life");
  assert.deepEqual([pstr(b, "b"), plife(b, "b")], [3, 4], "Bravo unchanged");
  assert.deepEqual([pstr(b, "foe"), plife(b, "foe")], [1, 4], "Foe unchanged");
  assert.equal(b.engine.getStat(b.id("a"), "speed"), 2, "speed is untouched");
});

clause(PICK, "1:rule", "on an opponent's character it buffs that character (the host), not the item's controller's", () => {
  const b = pickBoard({ dec: 1 });
  pickPlay(b, "foe");
  assert.deepEqual([pstr(b, "foe"), plife(b, "foe")], [2, 5]);
  assert.deepEqual([pstr(b, "a"), plife(b, "a")], [2, 4]);
});

clause(PICK, "1:rule", "the buff is gone when the item leaves play (the item is destroyed -> face-down; the host no longer buffed)", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a" });
  assert.deepEqual([pstr(b, "a"), plife(b, "a")], [3, 5]);
  smash(b);
  assert.deepEqual([pstr(b, "a"), plife(b, "a")], [2, 4], "no longer buffed");
});

clause(PICK, "1:rule", "the buff follows the item, not the character's damage: +1 life keeps a 4-damage... character at 4 damage on 5 life alive, lost on departure", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a" });
  b.engine.state.cards[b.id("a")].damage = 4;
  assert.equal(plife(b, "a"), 5);
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
});

clause(PICK, "2:rule", "if the Pickaxe would be destroyed it is flipped face-down in play instead (not in the discard pile)", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a" });
  smash(b);
  assert.equal(pending(b.engine), undefined);
  const c = b.engine.state.cards[b.id("pick")];
  assert.equal(c.zone, "play", "still in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("pick")), "not in the discard pile");
  assert.notEqual(hostOf(b), b.id("a"), "no longer attached to the host");
  assert.equal(zoneOf(b.engine, b.id("smash")), "discard", "the destroying tactic resolved");
});

clause(PICK, "2:rule", "the face-down Pickaxe is a resource under its owner's control", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a", dec: 1 });
  assert.equal(ready(b.engine), 1);
  smash(b);
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("pick")].controllerId, P1);
  assert.equal(ready(b.engine), 2, "a face-down card counts as a resource");
});

clause(PICK, "2:rule", "under its OWNER's control: a Pickaxe I own but an opponent controls comes back face-down under my control", () => {
  const b = pickBoard({ zone: "play", attachedTo: "foe", controller: P2 });
  assert.equal(b.engine.state.cards[b.id("pick")].controllerId, P2, "setup: P2 controls it");
  smash(b);
  const c = b.engine.state.cards[b.id("pick")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1, "under its owner's control");
  assert.equal(ready(b.engine, P2), 0, "not one of the opponent's resources");
  assert.deepEqual([pstr(b, "foe"), plife(b, "foe")], [1, 4], "the host lost the buff");
});

clause(PICK, "2:rule", "only the Pickaxe's own destruction is replaced: when its HOST is destroyed the Pickaxe is destroyed with it (CR 301.4a) and its own replacement flips it face-down (CR 301.4b)", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a" });
  play(b.engine, P1, b.id("slay"), { selected: { t: [b.id("a")] } });
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "the host died");
  assert.equal(zoneOf(b.engine, b.id("pick")), "play", "destroyed with its host, so its own replacement applies");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, true, "flipped face-down instead");
});

clause(PICK, "2:rule", "destroying a different item leaves the Pickaxe alone, and that item goes to the discard pile as usual", () => {
  const b = pickBoard({ zone: "play", attachedTo: "a" });
  smash(b, "gear");
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown ?? false, false);
  assert.equal(hostOf(b), b.id("a"));
});

clause(PICK, "3:flipUp", "FLIP UP 1 [D]: a face-down Pickaxe with a ready [D] flips up attached to the picked character (+1 strength +1 life)", () => {
  const b = pickBoard({ zone: "play", faceDown: true, dec: 1, greed: 1 });
  pflip(b, "a");
  const d = b.engine.state.cards[b.id("pick")];
  assert.equal(d.faceDown, false);
  assert.equal(d.zone, "play");
  assert.equal(d.attachedTo, b.id("a"));
  assert.deepEqual([pstr(b, "a"), plife(b, "a")], [3, 5]);
  assert.deepEqual([pstr(b, "b"), plife(b, "b")], [3, 4]);
  const r = ready(b.engine);
  assert.ok(r === 1 || r === 2, `a cost of 1 was paid (ready ${r})`);
});

clause(PICK, "3:flipUp", "the FLIP UP cost of 1 can be paid by the Pickaxe itself (CR 507.4b) when a spent [D] meets the threshold", () => {
  const b = pickBoard({ zone: "play", faceDown: true, spentDec: 1 });
  assert.equal(ready(b.engine), 1, "only the face-down Pickaxe is ready");
  pflip(b, "a");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, false);
  assert.equal(hostOf(b), b.id("a"));
});

clause(PICK, "3:flipUp", "the cost is 1, not 0: with every resource spent the flip is refused", () => {
  const b = pickBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1 });
  assert.equal(ready(b.engine), 0);
  refused(() => pflip(b, "a"), "nothing ready to pay 1");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, true);
});

clause(PICK, "3:flipUp", "a spent face-down Pickaxe can be flipped up when another resource is ready to pay the cost of 1", () => {
  const b = pickBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1, greed: 1 });
  assert.equal(ready(b.engine), 1);
  pflip(b, "a");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, false);
  assert.equal(ready(b.engine), 0, "the ready resource paid the cost of 1");
});

clause(PICK, "3:flipUp", "the cost is not 2: exactly one spent [D] and the Pickaxe flips", () => {
  const b = pickBoard({ zone: "play", faceDown: true, spentDec: 2 });
  assert.equal(ready(b.engine), 1);
  pflip(b, "a");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, false);
});

clause(PICK, "3:flipUp", "the [D] threshold: the Pickaxe's own icon does not count after flipping, and a non-[D] resource does not either", () => {
  const alone = pickBoard({ zone: "play", faceDown: true });
  refused(() => pflip(alone, "a"), "only itself");
  assert.equal(alone.engine.state.cards[alone.id("pick")].faceDown, true);
  const greed = pickBoard({ zone: "play", faceDown: true, greed: 2 });
  refused(() => pflip(greed, "a"), "no [D] among the other resources");
  assert.equal(greed.engine.state.cards[greed.id("pick")].faceDown, true);
  assert.equal(ready(greed.engine), 3, "nothing paid");
  const ok = pickBoard({ zone: "play", faceDown: true, dec: 1 });
  pflip(ok, "a");
  assert.equal(ok.engine.state.cards[ok.id("pick")].faceDown, false, "control: one other [D]");
});

clause(PICK, "3:flipUp", "ATTACH TO CHARACTER still applies on FLIP UP: a non-character host is refused", () => {
  const b = pickBoard({ zone: "play", faceDown: true, dec: 1 });
  refused(() => pflip(b, "gear"), "an item is not a character");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, true);
  assert.equal(ready(b.engine), 2, "nothing paid");
  refused(() => pflip(b, "place"), "a location is not a character");
  assert.equal(b.engine.state.cards[b.id("pick")].faceDown, true);
  pflip(b, "foe");
  assert.equal(hostOf(b), b.id("foe"), "control: an opponent's character is fine");
});

// ============================================================================
// Shadowy Mugger
// ============================================================================

interface MugOpts {
  dec?: number;
  rage?: number;
  oppDeck?: number;
  extra?: CardPlacement[];
}
function mugBoard(o: MugOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "mug", def: printing(MUG), owner: P1, zone: "hand" },
      { key: "mug2", def: printing(MUG), owner: P1, zone: "hand" },
      { key: "vanilla", def: character({ name: "Vanilla", cost: 0 }), owner: P1, zone: "hand" },
      ...fillers("o", o.oppDeck ?? 5, P2, "deck"),
      ...fillers("m", 3, P1, "deck"),
      { key: "ohand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "odisc", def: character({ name: "OppDisc" }), owner: P2, zone: "discard" },
      ...bank("deception", o.dec ?? 1, P1),
      ...bank("rage", o.rage ?? 3, P1),
      ...(o.extra ?? [])
    ]
  });
}
type MugBoard = ReturnType<typeof mugBoard>;
/** P2's discard pile minus the one card the board put there to begin with ("odisc"). */
const newDiscard = (b: MugBoard): string[] => discardOf(b.engine, P2).filter((c) => c !== b.id("odisc"));
const pickTarget = (engine: SpoilsEngine, selected: string[]): void => answerPending(engine, "chooserSelectsTarget", { selected });

clause(MUG, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(MUG));
clause(MUG, "0:kw:COVERT", "a covert party cannot be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(MUG));
clause(MUG, "0:kw:COVERT", "a covert party needs every member covert", () => covertPartyNeedsEveryMemberCovert(MUG));
clause(MUG, "0:kw:COVERT", "covert characters block only covert parties", () => covertBlocksOnlyCovertParties(MUG));

clause(MUG, "0:kw:COVERT", "printed card: a rogue thief character, cost 4, threshold [D], strength 2 / speed 3 / life 1", () => {
  const c = printing(MUG);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "rogue");
  assert.deepEqual([...c.subtype], ["thief"]);
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "d");
  assert.deepEqual([c.strength, c.speed, c.life], [2, 3, 1]);
});

clause(MUG, "0:kw:COVERT", "deploys for exactly 4 resources with [D]; refused one short (3 resources) and refused with 4 Rage (no [D])", () => {
  const ok = mugBoard({ dec: 1, rage: 3 });
  assert.equal(ready(ok.engine), 4);
  play(ok.engine, P1, ok.id("mug"));
  assert.equal(zoneOf(ok.engine, ok.id("mug")), "play");
  assert.equal(ready(ok.engine), 0, "paid 4");
  const short = mugBoard({ dec: 1, rage: 2 });
  refused(() => play(short.engine, P1, short.id("mug")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("mug")), "hand");
  assert.equal(ready(short.engine), 3, "nothing paid");
  const noD = mugBoard({ dec: 0, rage: 4 });
  refused(() => play(noD.engine, P1, noD.id("mug")), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("mug")), "hand");
  assert.equal(ready(noD.engine), 4);
  const spare = mugBoard({ dec: 1, rage: 4 });
  play(spare.engine, P1, spare.id("mug"));
  assert.equal(ready(spare.engine), 1, "cost is 4, not more");
});

clause(MUG, "1:rule", "accepting: the controller picks one card in the opponent's deck, which goes to THEIR discard pile; the deck is then shuffled", () => {
  const b = mugBoard();
  const deck = deckOf(b.engine, P2);
  const target = deck[3];
  play(b.engine, P1, b.id("mug"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the controller chooses");
  pickTarget(b.engine, [target]);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(newDiscard(b), [target], "in the opponent's discard pile");
  assert.equal(zoneOf(b.engine, target), "discard");
  assert.deepEqual(discardOf(b.engine, P1), [], "not my discard pile");
  assert.equal(b.engine.state.cards[target].ownerId, P2);
  const rest = deck.filter((c) => c !== target);
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...rest].sort(), "the other four cards stay in the deck");
  assert.deepEqual(deckOf(b.engine, P2), shuffledWithConstant(rest, 0.5), "the deck was shuffled (CR 312.1)");
});

clause(MUG, "1:rule", "any card in the deck can be chosen, not only the top one", () => {
  for (const idx of [0, 4]) {
    const b = mugBoard();
    const target = deckOf(b.engine, P2)[idx];
    play(b.engine, P1, b.id("mug"));
    pickTarget(b.engine, [target]);
    assert.deepEqual(newDiscard(b), [target]);
    assert.equal(deckOf(b.engine, P2).length, 4);
  }
});

clause(MUG, "1:rule", "a may: declining the search discards nothing, keeps every card in the opponent's deck, and the Mugger stays in play", () => {
  const b = mugBoard();
  const deck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("mug"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickTarget(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...deck].sort(), "same five cards");
  assert.deepEqual(newDiscard(b), [], "nothing discarded");
  assert.equal(zoneOf(b.engine, b.id("mug")), "play");
});

clause(MUG, "1:rule", "declining the search means no search happened, so the opponent's deck is NOT shuffled (same order)", () => {
  const b = mugBoard();
  const deck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("mug"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [], declined: true }); // "you may search": declined (Q2)
  assert.deepEqual(deckOf(b.engine, P2), deck, "same cards in the same order");
});

clause(MUG, "1:rule", "only the opponent's deck is searched: cards in my own deck, the opponent's hand and their discard pile are refused", () => {
  const b = mugBoard();
  play(b.engine, P1, b.id("mug"));
  const own = deckOf(b.engine, P1)[0];
  for (const bad of [own, b.id("ohand"), b.id("odisc")]) {
    refused(() => pickTarget(b.engine, [bad]), `${bad} is not in the opponent's deck`);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  }
  assert.deepEqual(deckOf(b.engine, P1).length, 3, "my deck untouched");
  pickTarget(b.engine, [deckOf(b.engine, P2)[0]]);
  assert.equal(newDiscard(b).length, 1, "control: a card from their deck works");
});

clause(MUG, "1:rule", "exactly one card: picking two is refused", () => {
  const b = mugBoard();
  play(b.engine, P1, b.id("mug"));
  const [x, y] = deckOf(b.engine, P2);
  refused(() => pickTarget(b.engine, [x, y]), "two cards for 'a card'");
  assert.equal(newDiscard(b).length, 0);
});

clause(MUG, "1:rule", "an empty opponent deck: nothing to find, nothing is lost and nothing is soft-locked", () => {
  const b = mugBoard({ oppDeck: 0 });
  play(b.engine, P1, b.id("mug"));
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: pc.kind, selected: [] } : declineAll(pc)));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mug")), "play");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("odisc")], "their discard pile is unchanged");
});

clause(MUG, "1:rule", "the trigger is only 'this card enters play': another character entering does not prompt", () => {
  const b = mugBoard({ dec: 1, rage: 3, extra: [] });
  play(b.engine, P1, b.id("mug"));
  pickTarget(b.engine, []);
  const deck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("vanilla"));
  assert.equal(pending(b.engine), undefined, "no prompt for the vanilla character");
  assert.deepEqual(deckOf(b.engine, P2), deck);
});

clause(MUG, "1:rule", "two Muggers: each fires its own search exactly once when it enters", () => {
  const b = mugBoard({ dec: 2, rage: 6 });
  play(b.engine, P1, b.id("mug"));
  const t1 = deckOf(b.engine, P2)[0];
  pickTarget(b.engine, [t1]);
  assert.equal(pending(b.engine), undefined);
  play(b.engine, P1, b.id("mug2"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the second Mugger's own prompt");
  const t2 = deckOf(b.engine, P2)[0];
  pickTarget(b.engine, [t2]);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual([...newDiscard(b)].sort(), [t1, t2].sort());
  assert.equal(deckOf(b.engine, P2).length, 3);
});

// ============================================================================
// Slinking Bandido
// ============================================================================

const COVERT_FOE = character({ name: "CovertFoe", strength: 0, life: 9, speed: 1, behavior: { keywords: ["covert"] } });
interface BandOpts {
  tokens?: number;
  other?: Record<string, number>;
  owner?: PlayerId;
  dec?: number;
  rage?: number;
}
function bandBoard(o: BandOpts = {}) {
  const owner = o.owner ?? P1;
  const foe = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: owner,
    random: () => 0.5,
    cards: [
      {
        key: "band",
        def: printing(BAND),
        owner,
        zone: "play",
        ...(o.tokens || o.other ? { counters: { ...(o.tokens ? { token: o.tokens } : {}), ...(o.other ?? {}) } } : {})
      },
      { key: "band2", def: printing(BAND), owner, zone: "play" },
      { key: "buddy", def: character({ name: "Buddy", strength: 2, life: 5, speed: 1, behavior: { keywords: ["covert"] } }), owner, zone: "play" },
      { key: "cfoe", def: COVERT_FOE, owner: foe, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: foe, zone: "play" },
      { key: "bandhand", def: printing(BAND), owner, zone: "hand" },
      ...bank("deception", o.dec ?? 0, owner),
      ...bank("rage", o.rage ?? 0, owner),
      ...fillers("d1_", 3, P1, "deck"),
      ...fillers("d2_", 3, P2, "deck")
    ]
  });
}
type BandBoard = ReturnType<typeof bandBoard>;
const tok = (b: BandBoard, k = "band"): number => b.engine.state.cards[b.id(k)].counters?.token ?? 0;
const bstr = (b: BandBoard, k = "band"): number => b.engine.getStat(b.id(k), "strength");
/** damage inflicted to a faction shows as lost influence (both start at 20) */
const factionDamage = (b: BandBoard, p: PlayerId): number => 20 - b.engine.state.players[p].influence;
const hitFaction = (b: BandBoard, attackers: string[], owner: PlayerId = P1) =>
  fightThrough(b.engine, owner, attackers.map((k) => b.id(k)), { type: "faction", playerId: owner === P1 ? P2 : P1 }, []);

clause(BAND, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(BAND));
clause(BAND, "0:kw:COVERT", "a covert party cannot be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(BAND));
clause(BAND, "0:kw:COVERT", "a covert party needs every member covert", () => covertPartyNeedsEveryMemberCovert(BAND));
clause(BAND, "0:kw:COVERT", "covert characters block only covert parties", () => covertBlocksOnlyCovertParties(BAND));

clause(BAND, "0:kw:COVERT", "printed card: a rogue outlaw character, cost 2, threshold [D], strength 1 / speed 1 / life 1", () => {
  const c = printing(BAND);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "rogue");
  assert.deepEqual([...c.subtype], ["outlaw"]);
  assert.equal(c.cost, 2);
  assert.equal(c.threshold, "d");
  assert.deepEqual([c.strength, c.speed, c.life], [1, 1, 1]);
});

clause(BAND, "0:kw:COVERT", "deploys for exactly 2 resources with [D]; refused with one resource, and with two Rage (no [D])", () => {
  const ok = bandBoard({ dec: 1, rage: 1 });
  play(ok.engine, P1, ok.id("bandhand"));
  assert.equal(zoneOf(ok.engine, ok.id("bandhand")), "play");
  assert.equal(ready(ok.engine), 0, "paid 2");
  const short = bandBoard({ dec: 1, rage: 0 });
  refused(() => play(short.engine, P1, short.id("bandhand")), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("bandhand")), "hand");
  assert.equal(ready(short.engine), 1);
  const noD = bandBoard({ dec: 0, rage: 2 });
  refused(() => play(noD.engine, P1, noD.id("bandhand")), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("bandhand")), "hand");
  const spare = bandBoard({ dec: 1, rage: 2 });
  play(spare.engine, P1, spare.id("bandhand"));
  assert.equal(ready(spare.engine), 1, "cost is 2, not more");
});

clause(BAND, "1:rule", "when it deals damage to the opposing faction it gets exactly one token; the faction takes its strength", () => {
  const b = bandBoard();
  assert.equal(tok(b), 0);
  hitFaction(b, ["band"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(factionDamage(b, P2), 1, "inflicted 1 damage (strength 1)");
  assert.equal(tok(b), 1, "one token");
  assert.equal(tok(b, "band2"), 0, "the other Bandido stays at zero");
  assert.equal(tok(b, "buddy"), 0);
});

clause(BAND, "1:rule", "tokens accumulate on each damaging hit: from 2 tokens a hit (damage 3) makes 3 tokens", () => {
  const b = bandBoard({ tokens: 2 });
  hitFaction(b, ["band"]);
  assert.equal(factionDamage(b, P2), 3, "inflicted 3 damage");
  assert.equal(tok(b), 3);
  assert.equal(bstr(b), 4);
});

clause(BAND, "1:rule", "the controller's faction attacked by the opponent's Bandido: works for either player", () => {
  const b = bandBoard({ owner: P2 });
  hitFaction(b, ["band"], P2);
  assert.equal(factionDamage(b, P1), 1);
  assert.equal(tok(b), 1);
});

clause(BAND, "1:rule", "no token when it is blocked: its damage goes to the blocking character, not a faction", () => {
  const b = bandBoard();
  fightThrough(b.engine, P1, [b.id("band")], { type: "faction", playerId: P2 }, [], undefined);
  assert.equal(tok(b), 1, "control: unblocked hit gives a token");
  const c = bandBoard();
  declareAttackBy(c.engine, P1, [c.id("band")]);
  declareBlockers(c.engine, P2, [c.id("cfoe")]);
  finishBattle(c.engine);
  assert.equal(c.engine.state.cards[c.id("cfoe")].damage ?? 0, 1, "the blocker took the damage");
  assert.equal(factionDamage(c, P2), 0);
  assert.equal(tok(c), 0, "no token for damaging a character");
});

clause(BAND, "1:rule", "no token when it attacks a location: damage to a non-faction", () => {
  const b = bandBoard();
  fightThrough(b.engine, P1, [b.id("band")], { type: "card", cardId: b.id("place") }, []);
  assert.equal(b.engine.state.cards[b.id("place")].damage ?? 0, 1, "the location took the damage");
  assert.equal(tok(b), 0, "no token for damaging a location");
});

clause(BAND, "1:rule", "only when THIS card inflicts the damage: a party-mate hitting the faction gives it a token, the Bandido staying home gets none, and an effect's faction damage gives none", () => {
  const b = bandBoard();
  hitFaction(b, ["buddy"]);
  assert.equal(factionDamage(b, P2), 2);
  assert.equal(tok(b), 0, "the Bandido did not attack");
  const c = bandBoard();
  hitFaction(c, ["band", "buddy"]);
  assert.equal(factionDamage(c, P2), 3, "1 + 2 damage");
  assert.equal(tok(c), 1, "one token for the Bandido");
  assert.equal(tok(c, "buddy"), 0);
});

clause(BAND, "1:rule", "two Bandidos hitting the faction together each get their own token", () => {
  const b = bandBoard();
  hitFaction(b, ["band", "band2"]);
  assert.equal(factionDamage(b, P2), 2);
  assert.equal(tok(b), 1);
  assert.equal(tok(b, "band2"), 1);
});

clause(BAND, "1:rule", "a Bandido that is not in play does not collect tokens (it stays in hand with none)", () => {
  const b = bandBoard();
  hitFaction(b, ["band"]);
  assert.equal(tok(b, "bandhand"), 0);
});

clause(BAND, "2:rule", "gains 1 strength for each token on it: 0 tokens -> 1, 1 -> 2, 3 -> 4", () => {
  for (const [t, expected] of [[0, 1], [1, 2], [3, 4]] as const) {
    const b = bandBoard({ tokens: t });
    assert.equal(bstr(b), expected, `${t} tokens`);
    assert.equal(bstr(b, "band2"), 1, "another Bandido has no tokens");
    assert.equal(b.engine.getStat(b.id("band"), "life"), 1, "life unchanged");
    assert.equal(b.engine.getStat(b.id("band"), "speed"), 1, "speed unchanged");
  }
});

clause(BAND, "2:rule", "only tokens count: other counters on it add no strength", () => {
  const b = bandBoard({ tokens: 1, other: { charm: 3 } });
  assert.equal(bstr(b), 2);
});

clause(BAND, "2:rule", "tokens on other cards do not pump it, and the strength is what it deals: a 3-token Bandido deals 4", () => {
  const b = bandBoard({ tokens: 3 });
  assert.equal(bstr(b, "buddy"), 2, "Buddy unaffected");
  hitFaction(b, ["band"]);
  assert.equal(factionDamage(b, P2), 4);
  assert.equal(tok(b), 4);
  assert.equal(bstr(b), 5);
});

// ============================================================================
// Smothering Corpulence
// ============================================================================

interface SmoOpts {
  /** cost of the top card of the opponent's deck (undefined = empty deck) */
  oppTop?: number | null;
  myTop?: number | null;
  dec?: number;
  rage?: number;
  foeLife?: number;
  foeDamage?: number;
  oppTopDef?: CardDefinition;
  myTopDef?: CardDefinition;
}
function smoBoard(o: SmoOpts = {}) {
  const oppTop = o.oppTop === undefined ? 5 : o.oppTop;
  const myTop = o.myTop === undefined ? 2 : o.myTop;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "smo", def: printing(SMO), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: o.foeLife ?? 5, speed: 1 }), owner: P2, zone: "play", ...(o.foeDamage ? { damage: o.foeDamage } : {}) },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "foeDead", def: character({ name: "FoeDead" }), owner: P2, zone: "discard" },
      ...(oppTop === null ? [] : [{ key: "ot", def: o.oppTopDef ?? character({ name: "OppTop", cost: oppTop }), owner: P2, zone: "deck" as const }]),
      ...(oppTop === null ? [] : fillers("o", 3, P2, "deck", (i) => character({ name: `O${i}`, cost: 9 }))),
      ...(myTop === null ? [] : [{ key: "mt", def: o.myTopDef ?? character({ name: "MyTop", cost: myTop }), owner: P1, zone: "deck" as const }]),
      ...fillers("m", 3, P1, "deck", (i) => character({ name: `M${i}`, cost: 7 })),
      ...bank("deception", o.dec ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1)
    ]
  });
}
type SmoBoard = ReturnType<typeof smoBoard>;
const slife = (b: SmoBoard, k = "foe"): number => b.engine.getStat(b.id(k), "life");
const smoPlay = (b: SmoBoard, target = "foe", player: PlayerId = P1) => play(b.engine, player, b.id("smo"), { selected: { c: [b.id(target)] } });
/** Puts the named card on top of its deck's front: the first card placed in a deck is index 0. */
const topOf = (b: SmoBoard, p: PlayerId): string | undefined => deckOf(b.engine, p)[0];

clause(SMO, "0:extraCost", "printed as a rogue tactic costing 4 with threshold [D][D]", () => {
  const c = printing(SMO);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "rogue");
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "dd");
});

clause(SMO, "0:extraCost", "setup check: the top of each deck is the card the board placed first", () => {
  const b = smoBoard();
  assert.equal(topOf(b, P2), b.id("ot"));
  assert.equal(topOf(b, P1), b.id("mt"));
});

clause(SMO, "0:extraCost", "deploys for exactly 4 resources with [D][D]; refused with 3 resources; refused with 4 resources holding only one [D]", () => {
  const ok = smoBoard({ dec: 2, rage: 2 });
  assert.equal(ready(ok.engine), 4);
  smoPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("smo")), "discard");
  assert.equal(ready(ok.engine), 0, "paid 4");
  const short = smoBoard({ dec: 2, rage: 1 });
  refused(() => smoPlay(short), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("smo")), "hand");
  assert.equal(ready(short.engine), 3, "nothing paid");
  assert.equal(zoneOf(short.engine, short.id("ot")), "deck", "nothing was removed");
  const oneD = smoBoard({ dec: 1, rage: 3 });
  refused(() => smoPlay(oneD), "only one [D]");
  assert.equal(zoneOf(oneD.engine, oneD.id("smo")), "hand");
  assert.equal(zoneOf(oneD.engine, oneD.id("ot")), "deck");
  const spare = smoBoard({ dec: 2, rage: 4 });
  smoPlay(spare);
  assert.equal(ready(spare.engine), 2, "cost is 4, not more");
});

clause(SMO, "0:extraCost", "the chosen character must be an opponent's character in play: my character, their item, location, a character in their discard and no pick are refused", () => {
  for (const bad of ["mine", "foeItem", "foeLoc", "foeDead"]) {
    const b = smoBoard();
    refused(() => smoPlay(b, bad), `${bad} is not an opponent's character in play`);
    assert.equal(zoneOf(b.engine, b.id("smo")), "hand");
    assert.equal(ready(b.engine), 4, "nothing paid");
    assert.equal(zoneOf(b.engine, b.id("ot")), "deck", "no card removed");
    assert.equal(zoneOf(b.engine, b.id("mt")), "deck", "no card removed");
  }
  const none = smoBoard();
  refused(() => play(none.engine, P1, none.id("smo"), { selected: {} }), "no character picked");
  assert.equal(zoneOf(none.engine, none.id("smo")), "hand");
  const good = smoBoard();
  smoPlay(good, "foe2");
  assert.equal(zoneOf(good.engine, good.id("smo")), "discard", "control: either opposing character works");
  assert.equal(slife(good, "foe2"), 2);
  assert.equal(slife(good, "foe"), 5, "the unchosen one is not affected");
});

clause(SMO, "0:extraCost", "both players remove the top card of their own decks from the game (not to a discard pile)", () => {
  const b = smoBoard();
  const oppRest = deckOf(b.engine, P2).slice(1);
  const myRest = deckOf(b.engine, P1).slice(1);
  smoPlay(b);
  assert.equal(zoneOf(b.engine, b.id("ot")), "removed", "the opponent's top card");
  assert.equal(zoneOf(b.engine, b.id("mt")), "removed", "my top card");
  assert.deepEqual(deckOf(b.engine, P2), oppRest, "opponent deck lost exactly its top card, order intact");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("foeDead")], "opponent's discard untouched");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("mt")), "!discardOf(b.engine, P1).includes(b.id(\"mt\"))");
  assert.deepEqual(deckOf(b.engine, P1), myRest.slice(1), "my deck lost its top card, then one more to the draw");
});

clause(SMO, "0:extraCost", "the removal is the cost: it has already happened while the tactic waits for responses", () => {
  const b = smoBoard();
  playRaw(b.engine, P1, b.id("smo"), { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("ot")), "removed", "opponent's top card removed at announcement");
  assert.equal(zoneOf(b.engine, b.id("mt")), "removed", "my top card removed at announcement");
  assert.equal(ready(b.engine), 0, "cost paid");
  resolvePendingResponses(b.engine);
  assert.equal(slife(b), 2);
});

clause(SMO, "0:extraCost", "X = the opponent's removed card's cost minus mine, read from the cards actually removed: 5 - 2 = 3, 2 - 1 = 1, 6 - 2 = 4", () => {
  for (const [opp, mine, x] of [[5, 2, 3], [2, 1, 1], [6, 2, 4]] as const) {
    const b = smoBoard({ oppTop: opp, myTop: mine, foeLife: 9 });
    smoPlay(b);
    assert.equal(slife(b), 9 - x, `${opp} - ${mine}`);
  }
});

clause(SMO, "0:extraCost", "the order of the subtraction matters: my card costing more than theirs does not shrink their card's loss (4 vs 7 never kills a life-5 character)", () => {
  const b = smoBoard({ oppTop: 7, myTop: 4, foeLife: 9 });
  smoPlay(b);
  assert.equal(slife(b), 6, "7 - 4 = 3");
});

clause(SMO, "0:extraCost", "the cost of any removed card counts, whatever its type: an item costing 6 against my tactic costing 1", () => {
  const b = smoBoard({
    oppTopDef: item({ name: "OppItemTop", cost: 6 }),
    myTopDef: tactic({ name: "MyTacticTop", cost: 1 }),
    foeLife: 9
  });
  smoPlay(b);
  assert.equal(slife(b), 4, "6 - 1 = 5");
});

clause(SMO, "0:extraCost", "only the top card is read: the cards below it do not matter", () => {
  const b = smoBoard({ oppTop: 4, myTop: 3, foeLife: 9 });
  smoPlay(b);
  assert.equal(slife(b), 8, "4 - 3 = 1, not the 9 / 7 cards underneath");
});

clause(SMO, "1:rule", "the chosen character loses X life this turn: life stat 5 -> 2 for X=3, and only that character", () => {
  const b = smoBoard({ oppTop: 5, myTop: 2 });
  assert.equal(slife(b), 5);
  smoPlay(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(slife(b), 2);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(slife(b, "foe2"), 5, "the other opposing character");
  assert.equal(slife(b, "mine"), 5, "my own character");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1, "only life is reduced");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 1);
});

clause(SMO, "1:rule", "'this turn': the life loss is gone after the turn ends", () => {
  const b = smoBoard({ oppTop: 5, myTop: 2 });
  smoPlay(b);
  assert.equal(slife(b), 2);
  endTurn(b.engine, P1);
  assert.equal(slife(b), 5, "back to the printed life");
});

clause(SMO, "1:rule", "X=0 (equal costs): the character loses nothing but the card is still drawn", () => {
  const b = smoBoard({ oppTop: 3, myTop: 3 });
  const draw = deckOf(b.engine, P1)[1];
  smoPlay(b);
  assert.equal(slife(b), 5);
  assert.ok(handOf(b.engine, P1).includes(draw), "drew a card");
});

clause(SMO, "1:rule", "a negative X (their card costs less than mine) is not a life GAIN: 'loses X life' with X below zero changes nothing", () => {
  const b = smoBoard({ oppTop: 1, myTop: 4 });
  smoPlay(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(slife(b), 5, "no life change for a negative X (X=-3 must not give +3 life)");
});

clause(SMO, "1:rule", "a negative X still draws the card", () => {
  const b = smoBoard({ oppTop: 1, myTop: 4 });
  const draw = deckOf(b.engine, P1)[1];
  smoPlay(b);
  assert.ok(handOf(b.engine, P1).includes(draw), "drew a card");
  assert.equal(zoneOf(b.engine, b.id("smo")), "discard");
});

clause(SMO, "1:rule", "draw a card: I draw exactly one card, from my deck AFTER the top card was removed, and the opponent draws nothing", () => {
  const b = smoBoard({ oppTop: 5, myTop: 2 });
  const myDeck = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  const oppHand = handOf(b.engine, P2);
  smoPlay(b);
  const hand = handOf(b.engine, P1);
  assert.equal(hand.length, handBefore.length, "-1 for the tactic, +1 for the draw");
  assert.ok(hand.includes(myDeck[1]), "the card under the removed top card");
  assert.ok(!hand.includes(myDeck[0]), "the removed card is not in hand");
  assert.deepEqual(handOf(b.engine, P2), oppHand, "the opponent drew nothing");
  assert.equal(deckOf(b.engine, P1).length, myDeck.length - 2);
});

clause(SMO, "1:rule", "the draw still happens when the character dies from the life loss", () => {
  const b = smoBoard({ oppTop: 8, myTop: 2, foeLife: 5 });
  const draw = deckOf(b.engine, P1)[1];
  smoPlay(b);
  assert.ok(handOf(b.engine, P1).includes(draw), "handOf(b.engine, P1).includes(draw)");
});

clause(SMO, "1:rule", "X equal to the character's life (life 3, X=3) destroys it: life 0 with 0 damage is lethal", () => {
  const dead = smoBoard({ oppTop: 5, myTop: 2, foeLife: 3 });
  smoPlay(dead);
  assert.equal(zoneOf(dead.engine, dead.id("foe")), "discard", "X=3 on a life-3 character");
});

clause(SMO, "1:rule", "X one less than the character's life (life 3, X=2) leaves it in play with 1 life", () => {
  const alive = smoBoard({ oppTop: 4, myTop: 2, foeLife: 3 });
  smoPlay(alive);
  assert.equal(zoneOf(alive.engine, alive.id("foe")), "play", "X=2 on a life-3 character");
  assert.equal(slife(alive), 1);
});

clause(SMO, "1:rule", "a character with damage dies when the reduced life no longer exceeds its damage", () => {
  const dead = smoBoard({ oppTop: 5, myTop: 2, foeLife: 5, foeDamage: 2 });
  smoPlay(dead);
  assert.equal(zoneOf(dead.engine, dead.id("foe")), "discard", "life 2 <= 2 damage");
  const alive = smoBoard({ oppTop: 4, myTop: 2, foeLife: 5, foeDamage: 2 });
  smoPlay(alive);
  assert.equal(zoneOf(alive.engine, alive.id("foe")), "play", "life 3 > 2 damage");
});

clause(SMO, "1:rule", "an empty opponent deck: only my card is removed, I still draw, and the character is not harmed", () => {
  const b = smoBoard({ oppTop: null, myTop: 0 });
  const draw = deckOf(b.engine, P1)[1];
  smoPlay(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mt")), "removed");
  assert.ok(handOf(b.engine, P1).includes(draw), "drew a card");
  assert.equal(slife(b), 5, `no life lost (life ${slife(b)})`);
});

// ---- T3c7 behavior-mutation pass ----

clause(RUSE, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: RUSE, type: "tactic", subtype: [] });
});

clause(SMO, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: SMO, type: "tactic", subtype: [] });
});
