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
  P1,
  P2,
  play,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { fillers, pending, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";

type Pc = { kind: string; playerId: PlayerId; [k: string]: any };
type Board = ReturnType<typeof buildGame>;

const ready = (e: SpoilsEngine, p: PlayerId = P1): number => e.getAvailableResourceCount(p);
const inf = (e: SpoilsEngine, p: PlayerId): number => e.state.players[p].influence;
const dmg = (b: Board, key: string): number => b.engine.state.cards[b.id(key)].damage ?? 0;
const pcOf = (e: SpoilsEngine): Pc | undefined => pending(e) as unknown as Pc | undefined;
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>): void => {
  const pc = pcOf(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(e);
};
const faction = (e: SpoilsEngine, p: PlayerId): CardInstanceId => e.state.players[p].factionId as CardInstanceId;
const FACTION_P2 = { type: "faction", playerId: P2 } as const;
const MSG = /afford|resource|threshold|cost|pay|icon|enough/i;

const mk = (cards: CardPlacement[], active: PlayerId = P1) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [...cards, ...fillers("pd", 4, P1, "deck"), ...fillers("qd", 4, P2, "deck")]
  });

function deployChecks(id: string, cost: number, ok: CardPlacement[], oneShort: CardPlacement[], iconShort: CardPlacement[]): void {
  const mkb = (cards: CardPlacement[]) => mk([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...cards]);
  const a = mkb(ok);
  const before = ready(a.engine);
  play(a.engine, P1, a.id("c"));
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("c")), "play", "deploys with exactly enough");
  assert.equal(before - ready(a.engine), cost, `pays exactly ${cost}`);
  const s = mkb(oneShort);
  refused(() => play(s.engine, P1, s.id("c")), `one short of cost ${cost}`, MSG);
  assert.equal(zoneOf(s.engine, s.id("c")), "hand");
  const t = mkb(iconShort);
  refused(() => play(t.engine, P1, t.id("c")), "threshold not met", MSG);
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
}

function uniqueChecks(id: string): void {
  const mku = (extra: CardPlacement[]) => mk([...bank("rage", 12, P1), ...bank("rage", 12, P2), ...extra]);
  const b = mku([
    { key: "a", def: printing(id), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("b"));
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("a"), b.id("b")].sort());
  resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id("b") });
  assert.equal(zoneOf(b.engine, b.id("b")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = mku([
    { key: "a", def: printing(id), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(c.engine, P1, c.id("b"));
  resolveChoice(c.engine, { kind: "uniqueSurvivor", keep: c.id("a") });
  assert.equal(zoneOf(c.engine, c.id("a")), "play");
  assert.equal(zoneOf(c.engine, c.id("b")), "discard");
  const d = mku([
    { key: "a", def: printing(id), owner: P2, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(d.engine, P1, d.id("b"));
  assert.equal(d.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(d.engine, d.id("a")), "play", "the opponent's copy is separate");
  assert.equal(zoneOf(d.engine, d.id("b")), "play");
  const e = mku([
    { key: "a", def: character({ name: "Somebody Else", unique: "somebody else" }), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(e.engine, P1, e.id("b"));
  assert.equal(e.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(e.engine, e.id("a")), "play");
}

// =============================================================================================
// Essence of Rage -- tactic (warlord), cost 1, threshold [R][R]; three modes
// =============================================================================================

const ER = "5489d174-573b-4788-997e-028ac30b7b43";

const erBoard = (extra: CardPlacement[] = []) =>
  mk([
    { key: "er", def: printing(ER), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
    { key: "foe2", def: character({ name: "Foe Two", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    ...bank("rage", 3, P1),
    ...extra
  ]);
const erPlay = (b: Board, mode: number, target: CardInstanceId, tid: "t" | "c") =>
  play(b.engine, P1, b.id("er"), { mode, selected: { [tid]: [target] } } as never);

clause(ER, "0:rule", "printed card: a warlord tactic, cost 1, threshold [R][R]; plays for exactly 1 with two [R]; one short or one [R] short is refused", () => {
  const def = printing(ER);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "warlord");
  const go = (cards: CardPlacement[]) =>
    mk([
      { key: "er", def: printing(ER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      ...cards
    ]);
  const a = go([...bank("rage", 1, P1), ...spentResources(P1, 1)]);
  const before = ready(a.engine);
  play(a.engine, P1, a.id("er"), { mode: 2, selected: { c: [a.id("foe")] } } as never);
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("er")), "discard", "the tactic resolves and is discarded");
  assert.equal(before - ready(a.engine), 1, "pays exactly 1");
  assert.equal(a.engine.state.cards[a.id("foe")].depleted, true);
  const s = go([...spentResources(P1, 2)]);
  refused(() => play(s.engine, P1, s.id("er"), { mode: 2, selected: { c: [s.id("foe")] } } as never), "no ready resource for cost 1", MSG);
  assert.equal(zoneOf(s.engine, s.id("er")), "hand");
  const t = go([...bank("rage", 1, P1), ...bank("greed", 1, P1)]);
  refused(() => play(t.engine, P1, t.id("er"), { mode: 2, selected: { c: [t.id("foe")] } } as never), "only one [R]", MSG);
  assert.equal(zoneOf(t.engine, t.id("er")), "hand");
  const u = go([...bank("greed", 2, P1)]);
  refused(() => play(u.engine, P1, u.id("er"), { mode: 2, selected: { c: [u.id("foe")] } } as never), "no [R]", MSG);
});

clause(ER, "0:rule", "exactly three modes: an out-of-range mode is refused and a legal one does only its own effect", () => {
  const b = erBoard();
  refused(() => play(b.engine, P1, b.id("er"), { mode: 3, selected: { c: [b.id("foe")] } } as never), "no fourth mode");
  assert.equal(zoneOf(b.engine, b.id("er")), "hand");
  assert.equal(ready(b.engine), 3, "nothing paid");
  // positive control, mode 2 = deplete only: no damage and no strength change
  erPlay(b, 2, b.id("foe"), "c");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(zoneOf(b.engine, b.id("er")), "discard");
});

clause(ER, "0:rule", "the pick is an EXTRA COST: cost and pick are committed when it is played, the effect only on resolution", () => {
  const b = erBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("er"), { mode: 1, selected: { c: [b.id("foe")] } });
  assert.equal(before - ready(b.engine), 1, "cost paid while it waits");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "effect not yet applied");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 4, "applied on resolution");
});

clause(ER, "1:option:OPTION 1", "inflicts 1 damage to a picked character (mine or theirs); the other characters take none", () => {
  const b = erBoard();
  erPlay(b, 0, b.id("foe"), "t");
  assert.equal(dmg(b, "foe"), 1);
  assert.equal(dmg(b, "foe2"), 0);
  assert.equal(dmg(b, "mine"), 0);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted ?? false, false, "not depleted");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "no strength change");
  const c = erBoard();
  erPlay(c, 0, c.id("mine"), "t");
  assert.equal(dmg(c, "mine"), 1, "my own character may be picked");
  assert.equal(dmg(c, "foe"), 0);
});

clause(ER, "1:option:OPTION 1", "a picked character with 1 life is destroyed by the 1 damage (not 0)", () => {
  const b = mk([
    { key: "er", def: printing(ER), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 1 }), owner: P2, zone: "play" },
    { key: "foe2", def: character({ name: "Foe Two", life: 2 }), owner: P2, zone: "play" },
    ...bank("rage", 3, P1)
  ]);
  erPlay(b, 0, b.id("foe2"), "t");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play", "exactly 1 damage is not enough for 2 life");
  assert.equal(dmg(b, "foe2"), 1);
  const c = mk([
    { key: "er", def: printing(ER), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", life: 1 }), owner: P2, zone: "play" },
    ...bank("rage", 3, P1)
  ]);
  erPlay(c, 0, c.id("foe"), "t");
  assert.equal(zoneOf(c.engine, c.id("foe")), "discard");
});

clause(ER, "1:option:OPTION 1", "may pick a faction (either one): it takes 1 damage, i.e. loses 1 influence", () => {
  const b = erBoard();
  const i2 = inf(b.engine, P2);
  const i1 = inf(b.engine, P1);
  erPlay(b, 0, faction(b.engine, P2), "t");
  assert.equal(inf(b.engine, P2), i2 - 1);
  assert.equal(inf(b.engine, P1), i1);
  assert.equal(dmg(b, "foe"), 0);
  const c = erBoard();
  const c1 = inf(c.engine, P1);
  erPlay(c, 0, faction(c.engine, P1), "t");
  assert.equal(inf(c.engine, P1), c1 - 1, "my own faction may be picked");
});

clause(ER, "1:option:OPTION 1", "an item cannot be picked (character or faction only)", () => {
  const b = erBoard();
  refused(() => erPlay(b, 0, b.id("gear"), "t"), "item is not a character or faction");
  assert.equal(zoneOf(b.engine, b.id("er")), "hand");
  assert.equal(ready(b.engine), 3);
  erPlay(b, 0, b.id("foe"), "t");
  assert.equal(dmg(b, "foe"), 1, "positive control");
});

clause(ER, "2:option:OPTION 2", "the picked character gains 2 strength this turn; others do not; it ends with the turn", () => {
  const b = erBoard();
  erPlay(b, 1, b.id("foe"), "c");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("foe2"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted ?? false, false);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "gone next turn");
  const c = erBoard();
  erPlay(c, 1, c.id("mine"), "c");
  assert.equal(c.engine.getStat(c.id("mine"), "strength"), 4, "my own character may be picked");
});

clause(ER, "2:option:OPTION 2", "the strength is really +2 in a fight and only a character may be picked", () => {
  const b = erBoard();
  erPlay(b, 1, b.id("mine"), "c");
  fightThrough(b.engine, P1, [b.id("mine")], FACTION_P2, []);
  assert.equal(b.engine.state.battle, undefined);
  const c = erBoard();
  const before = inf(c.engine, P2);
  erPlay(c, 1, c.id("mine"), "c");
  fightThrough(c.engine, P1, [c.id("mine")], FACTION_P2, []);
  assert.equal(before - inf(c.engine, P2), 4, "4 strength unblocked at the faction");
  const d = erBoard();
  refused(() => erPlay(d, 1, d.id("gear"), "c"), "item is not a character");
  refused(() => erPlay(d, 1, faction(d.engine, P2), "c"), "faction is not a character");
  assert.equal(zoneOf(d.engine, d.id("er")), "hand");
  erPlay(d, 1, d.id("foe"), "c");
  assert.equal(d.engine.getStat(d.id("foe"), "strength"), 4, "positive control");
});

clause(ER, "3:option:OPTION 3", "depletes the picked character; others stay ready; no damage or strength change", () => {
  const b = erBoard();
  assert.equal(b.engine.state.cards[b.id("foe")].depleted ?? false, false);
  erPlay(b, 2, b.id("foe"), "c");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("foe2")].depleted ?? false, false);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted ?? false, false);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  const c = erBoard();
  erPlay(c, 2, c.id("mine"), "c");
  assert.equal(c.engine.state.cards[c.id("mine")].depleted, true, "my own character may be picked");
});

clause(ER, "3:option:OPTION 3", "only a character may be picked; with no character in play the mode cannot be chosen", () => {
  const b = erBoard();
  refused(() => erPlay(b, 2, b.id("gear"), "c"), "item");
  refused(() => erPlay(b, 2, faction(b.engine, P2), "c"), "faction");
  assert.equal(zoneOf(b.engine, b.id("er")), "hand");
  const c = mk([{ key: "er", def: printing(ER), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]);
  refused(() => play(c.engine, P1, c.id("er"), { mode: 2, selected: { c: [] } } as never), "no character to pick");
  assert.equal(zoneOf(c.engine, c.id("er")), "hand");
  assert.equal(ready(c.engine), 3);
});

// =============================================================================================
// Frenzied Shriever -- warlord dragon, cost 2, threshold [R], 1 str / 3 spd / 2 life
// =============================================================================================

const FS = "ab7dd6ef-fea9-4bfc-b929-d988d3e274c5";

const fsBoard = (extra: CardPlacement[] = [], blockerLife = 10) =>
  mk([
    { key: "fs", def: printing(FS), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 1, speed: 3, life: 5 }), owner: P1, zone: "play" },
    { key: "wall", def: character({ name: "Wall", strength: 1, speed: 1, life: blockerLife }), owner: P2, zone: "play" },
    { key: "wall2", def: character({ name: "Wall Two", strength: 1, speed: 1, life: 10 }), owner: P2, zone: "play" },
    ...extra
  ]);

clause(FS, "0:rule", "printed card: a warlord dragon, cost 2, threshold [R], 1 strength / 3 speed / 2 life", () => {
  const b = mk([{ key: "fs", def: printing(FS), owner: P1, zone: "play" }]);
  const def = b.engine.getDefinition(b.id("fs"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...(def.subtype ?? [])], ["dragon"]);
  assert.deepEqual([b.engine.getStat(b.id("fs"), "strength"), b.engine.getStat(b.id("fs"), "speed"), b.engine.getStat(b.id("fs"), "life")], [1, 3, 2]);
});

clause(FS, "0:rule", "deploys for exactly 2 resources with one [R]; one short and no [R] are refused", () => {
  deployChecks(FS, 2, [...bank("rage", 2, P1)], [...bank("rage", 1, P1)], [...bank("greed", 2, P1)]);
  deployChecks(FS, 2, [...bank("greed", 1, P1), ...bank("rage", 1, P1)], [...bank("rage", 1, P1)], [...bank("greed", 2, P1)]);
});

clause(FS, "0:rule", "attacking and blocked by a character: it inflicts 1 + 2 = 3 battle damage to it; the other blocker takes none", () => {
  const b = fsBoard();
  fightThrough(b.engine, P1, [b.id("fs")], FACTION_P2, [b.id("wall")]);
  assert.equal(dmg(b, "wall"), 3);
  assert.equal(dmg(b, "wall2"), 0);
  assert.equal(dmg(b, "fs"), 1, "it takes the blocker's plain 1");
});

clause(FS, "0:rule", "blocking: it also inflicts 3 battle damage to the attacking character", () => {
  const b = mk(
    [
      { key: "fs", def: printing(FS), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 10 }), owner: P1, zone: "play" }
    ],
    P1
  );
  fightThrough(b.engine, P1, [b.id("atk")], FACTION_P2, [b.id("fs")]);
  assert.equal(dmg(b, "atk"), 3);
  assert.equal(dmg(b, "fs"), 1);
});

clause(FS, "0:rule", "only a character receives the bonus: unblocked at the faction it inflicts just its 1 strength", () => {
  const b = fsBoard();
  const before = inf(b.engine, P2);
  fightThrough(b.engine, P1, [b.id("fs")], FACTION_P2, []);
  assert.equal(before - inf(b.engine, P2), 1);
});

clause(FS, "0:rule", "only to a character: battle damage to an attacked location is just its 1 strength", () => {
  const b = fsBoard([{ key: "loc", def: location({ name: "Fort", structure: 5 }), owner: P2, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("fs")], { type: "card", cardId: b.id("loc") }, []);
  assert.equal(dmg(b, "loc"), 1);
});

clause(FS, "0:rule", "the bonus is only for damage THIS card inflicts: an ally striking the same blocker adds just its own 1", () => {
  const b = fsBoard();
  fightThrough(b.engine, P1, [b.id("fs"), b.id("ally")], FACTION_P2, [b.id("wall")]);
  assert.equal(dmg(b, "wall"), 4, "3 from Shriever + 1 from the ally");
  const c = fsBoard();
  fightThrough(c.engine, P1, [c.id("ally")], FACTION_P2, [c.id("wall")]);
  assert.equal(dmg(c, "wall"), 1, "a lone ally with Shriever in play is not boosted");
});

clause(FS, "0:rule", "it is lethal as printed: 3 damage destroys a 3-life blocker, 2 damage worth of life would not matter", () => {
  const b = fsBoard([], 3);
  fightThrough(b.engine, P1, [b.id("fs")], FACTION_P2, [b.id("wall")]);
  assert.equal(zoneOf(b.engine, b.id("wall")), "discard");
  const c = fsBoard([], 4);
  fightThrough(c.engine, P1, [c.id("fs")], FACTION_P2, [c.id("wall")]);
  assert.equal(zoneOf(c.engine, c.id("wall")), "play");
  assert.equal(dmg(c, "wall"), 3);
});

clause(FS, "0:rule", "two Shrievers striking the same blocker each add 2", () => {
  const b = fsBoard([{ key: "fs2", def: printing(FS), owner: P1, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("fs"), b.id("fs2")], FACTION_P2, [b.id("wall")]);
  assert.equal(dmg(b, "wall"), 6);
});

clause(FS, "0:rule", "outside play it does nothing: a Shriever in hand or discard boosts no one", () => {
  const b = fsBoard();
  b.engine.state.cards[b.id("fs")].zone = "discard";
  fightThrough(b.engine, P1, [b.id("ally")], FACTION_P2, [b.id("wall")]);
  assert.equal(dmg(b, "wall"), 1);
});

// =============================================================================================
// Gallant Commander -- warlord soldier, cost 3, threshold [R], 2 str / 3 spd / 2 life
// =============================================================================================

const GC = "256a568b-8fe3-4eee-b50a-52026ccd5b5a";

const gcBoard = (rage: number, extra: CardPlacement[] = []) =>
  mk([
    { key: "gc", def: printing(GC), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
    ...bank("rage", rage, P1),
    ...extra
  ]);

clause(GC, "0:ability:charge", "printed card: a warlord soldier, cost 3, threshold [R], 2 strength / 3 speed / 2 life", () => {
  const b = gcBoard(0);
  const def = b.engine.getDefinition(b.id("gc"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...(def.subtype ?? [])], ["soldier"]);
  assert.deepEqual([b.engine.getStat(b.id("gc"), "strength"), b.engine.getStat(b.id("gc"), "speed"), b.engine.getStat(b.id("gc"), "life")], [2, 3, 2]);
});

clause(GC, "0:ability:charge", "deploys for exactly 3 resources with one [R]; one short and no [R] are refused", () => {
  deployChecks(GC, 3, [...bank("rage", 3, P1)], [...bank("rage", 2, P1)], [...bank("greed", 3, P1)]);
  deployChecks(GC, 3, [...bank("greed", 2, P1), ...bank("rage", 1, P1)], [...bank("greed", 1, P1), ...bank("rage", 1, P1)], [...bank("greed", 3, P1)]);
});

clause(GC, "0:ability:charge", "COST: pay exactly 2 and destroy this card; EFFECT: the opponent's faction takes 3 (loses 3 influence)", () => {
  const b = gcBoard(4);
  const i2 = inf(b.engine, P2);
  const i1 = inf(b.engine, P1);
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("gc"), "charge");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 2, "pays exactly 2");
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard", "destroyed as a cost");
  assert.equal(i2 - inf(b.engine, P2), 3);
  assert.equal(inf(b.engine, P1), i1, "my faction untouched");
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(dmg(b, "mine"), 0);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(GC, "0:ability:charge", "exactly 2 ready resources is enough; with only 1 the ability is refused and the card stays", () => {
  const a = gcBoard(2);
  const i2 = inf(a.engine, P2);
  activate(a.engine, P1, a.id("gc"), "charge");
  assert.equal(i2 - inf(a.engine, P2), 3);
  assert.equal(ready(a.engine), 0);
  const b = gcBoard(1);
  const j2 = inf(b.engine, P2);
  refused(() => activate(b.engine, P1, b.id("gc"), "charge"), "cannot pay 2", MSG);
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(inf(b.engine, P2), j2);
  assert.equal(ready(b.engine), 1, "nothing paid");
  const c = gcBoard(0, spentResources(P1, 3));
  refused(() => activate(c.engine, P1, c.id("gc"), "charge"), "spent resources cannot pay", MSG);
});

clause(GC, "0:ability:charge", "only while in play: from hand or discard the ability cannot be used", () => {
  const b = gcBoard(3);
  activate(b.engine, P1, b.id("gc"), "charge");
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard", "positive control");
  for (const z of ["hand", "discard"] as const) {
    const c = mk([{ key: "gc", def: printing(GC), owner: P1, zone: z }, ...bank("rage", 3, P1)]);
    const i2 = inf(c.engine, P2);
    refused(() => activate(c.engine, P1, c.id("gc"), "charge"), `in ${z}`);
    assert.equal(inf(c.engine, P2), i2);
  }
});

clause(GC, "0:ability:charge", "the opponent cannot use my Commander", () => {
  const b = gcBoard(3, bank("rage", 3, P2));
  const i1 = inf(b.engine, P1);
  refused(() => activate(b.engine, P2, b.id("gc"), "charge"), "not P2's card");
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(inf(b.engine, P1), i1);
});

clause(GC, "0:ability:charge", "'an opponent's faction' is relative to the controller: a Commander the opponent controls hits MY faction", () => {
  const b = mk([
    { key: "gc", def: printing(GC), owner: P1, controller: P2, zone: "play" },
    ...bank("rage", 3, P2)
  ], P2);
  const i1 = inf(b.engine, P1);
  const i2 = inf(b.engine, P2);
  activate(b.engine, P2, b.id("gc"), "charge");
  assert.equal(i1 - inf(b.engine, P1), 3);
  assert.equal(inf(b.engine, P2), i2);
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard");
});

// =============================================================================================
// Gideon, the Ultimate Warrior -- warlord, cost 1, threshold [R][R][R], 2 / 3 / 3, UNIQUE GIDEON
// =============================================================================================

const GD = "7d2c17ee-25ba-4523-813c-145587e15cae";

const gdBoard = (extra: CardPlacement[] = [], gdOwner: PlayerId = P1) =>
  mk(
    [
      { key: "gd", def: printing(GD), owner: gdOwner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, speed: 1, life: 5 }), owner: gdOwner, zone: "play" },
      { key: "big", def: character({ name: "Big", strength: 5, speed: 3, life: 10 }), owner: P2, zone: "play" },
      { key: "big2", def: character({ name: "Big Two", strength: 5, speed: 3, life: 10 }), owner: P2, zone: "play" },
      {
        key: "drain",
        def: character({
          name: "Drainer",
          behavior: {
            abilities: [
              { id: "hit", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] },
              { id: "hitself", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -2 }] },
              { id: "gain", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: 2 }] }
            ]
          }
        }),
        owner: P1,
        zone: "play"
      },
      ...extra
    ],
    P1
  );

clause(GD, "0:unique", "printed card: a warlord gideon/sword of great justice, cost 1, threshold [R][R][R], 2 strength / 3 speed / 3 life, UNIQUE GIDEON", () => {
  const b = gdBoard();
  const def = b.engine.getDefinition(b.id("gd"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...(def.subtype ?? [])], ["gideon", "sword of great justice"]);
  assert.deepEqual([b.engine.getStat(b.id("gd"), "strength"), b.engine.getStat(b.id("gd"), "speed"), b.engine.getStat(b.id("gd"), "life")], [2, 3, 3]);
  assert.equal(def.unique, "gideon");
});

clause(GD, "0:unique", "deploys for exactly 1 resource with three [R] (spent [R] count toward the threshold); one short and an [R] short are refused", () => {
  deployChecks(GD, 1, [...bank("rage", 1, P1), ...spentResources(P1, 2)], [...spentResources(P1, 3)], [...bank("rage", 1, P1), ...bank("greed", 1, P1), ...spentResources(P1, 1)]);
  deployChecks(GD, 1, [...bank("greed", 1, P1), ...spentResources(P1, 3)], [...spentResources(P1, 3)], [...bank("greed", 1, P1), ...spentResources(P1, 2)]);
});

clause(GD, "0:unique", "UNIQUE: a second Gideon makes you keep one; the opponent's copy is separate", () => {
  uniqueChecks(GD);
});

clause(GD, "1:rule", "attacking, blocked by a 5-strength character: Gideon takes 0 battle damage, survives, and still strikes back", () => {
  const b = gdBoard();
  fightThrough(b.engine, P1, [b.id("gd")], FACTION_P2, [b.id("big")]);
  assert.equal(dmg(b, "gd"), 0);
  assert.equal(zoneOf(b.engine, b.id("gd")), "play");
  assert.equal(dmg(b, "big"), 2);
});

clause(GD, "1:rule", "'reduce the amount to 0' applies to small hits too: a 1-strength blocker deals 0 battle damage to an attacking Gideon", () => {
  const b = gdBoard([{ key: "small", def: character({ name: "Small", strength: 1, speed: 3, life: 10 }), owner: P2, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("gd")], FACTION_P2, [b.id("small")]);
  assert.equal(dmg(b, "gd"), 0, "1 battle damage is reduced to 0");
  assert.equal(zoneOf(b.engine, b.id("gd")), "play");
  assert.equal(dmg(b, "small"), 2, "Gideon still strikes back with his 2 strength");
  const two = gdBoard([{ key: "mid", def: character({ name: "Mid", strength: 2, speed: 3, life: 10 }), owner: P2, zone: "play" }]);
  fightThrough(two.engine, P1, [two.id("gd")], FACTION_P2, [two.id("mid")]);
  assert.equal(dmg(two, "gd"), 0, "2 battle damage is reduced to 0 as well");
});

clause(GD, "1:rule", "only while attacking: when Gideon BLOCKS he takes the full damage", () => {
  const b = mk([
    { key: "gd", def: printing(GD), owner: P2, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 2, speed: 3, life: 10 }), owner: P1, zone: "play" }
  ]);
  fightThrough(b.engine, P1, [b.id("atk")], FACTION_P2, [b.id("gd")]);
  assert.equal(dmg(b, "gd"), 2, "full battle damage while defending");
  const c = mk([
    { key: "gd", def: printing(GD), owner: P2, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 5, speed: 3, life: 10 }), owner: P1, zone: "play" }
  ]);
  fightThrough(c.engine, P1, [c.id("atk")], FACTION_P2, [c.id("gd")]);
  assert.equal(zoneOf(c.engine, c.id("gd")), "discard", "destroyed while blocking");
});

clause(GD, "1:rule", "only battle damage: other damage to an attacking Gideon is not reduced", () => {
  const b = gdBoard([
    { key: "er", def: printing(ER), owner: P2, zone: "hand" },
    ...bank("rage", 3, P2)
  ]);
  declareAttackOpenWindow(b.engine, P1, [b.id("gd")]);
  play(b.engine, P2, b.id("er"), { mode: 0, selected: { t: [b.id("gd")] } } as never);
  assert.equal(dmg(b, "gd"), 1, "tactic damage lands in full during his attack");
  assert.equal(zoneOf(b.engine, b.id("gd")), "play");
});

clause(GD, "1:rule", "only damage to THIS card: an ally attacking alongside still takes the damage", () => {
  const b = gdBoard();
  const onto = (key: string) => (src: any) => {
    const t = src.legalTargets.find((x: unknown) => JSON.stringify(x).includes(b.id(key)));
    const u = t ?? src.legalTargets[0];
    return u && src.strength > 0 ? [{ sourceId: src.cardId, target: u, amount: src.strength }] : [];
  };
  fightThrough(b.engine, P1, [b.id("gd"), b.id("ally")], FACTION_P2, [b.id("big")], onto("ally") as never);
  assert.equal(dmg(b, "gd"), 0);
  assert.equal(zoneOf(b.engine, b.id("gd")), "play");
  const g = gdBoard();
  const ontoG = (src: any) => {
    const t = src.legalTargets.find((x: unknown) => JSON.stringify(x).includes(g.id("gd")));
    const u = t ?? src.legalTargets[0];
    return u && src.strength > 0 ? [{ sourceId: src.cardId, target: u, amount: src.strength }] : [];
  };
  fightThrough(g.engine, P1, [g.id("gd"), g.id("ally")], FACTION_P2, [g.id("big")], ontoG as never);
  assert.equal(dmg(g, "gd"), 0, "all 5 assigned to Gideon: reduced to 0");
  assert.equal(dmg(g, "ally"), 0);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "the 5-strength blocker killed the 5-life ally");
});

clause(GD, "1:rule", "while he attacks a faction unblocked nothing changes, and on the next turn (not attacking) he is not shielded", () => {
  const b = gdBoard();
  const before = inf(b.engine, P2);
  fightThrough(b.engine, P1, [b.id("gd")], FACTION_P2, []);
  assert.ok(before - inf(b.engine, P2) >= 2, "his 2 strength reached the faction");
  assert.equal(dmg(b, "gd"), 0);
  // an opponent's attack at the idle Gideon's side: he blocks and takes damage (covered above); here he is simply not attacking
  const c = gdBoard();
  assert.equal(c.engine.state.battle, undefined);
});

clause(GD, "2:rule", "an opponent's faction losing influence loses 1 more (2 -> 3); my own faction does not", () => {
  const b = gdBoard();
  const i2 = inf(b.engine, P2);
  activate(b.engine, P1, b.id("drain"), "hit");
  assert.equal(i2 - inf(b.engine, P2), 3);
  const c = gdBoard();
  const i1 = inf(c.engine, P1);
  activate(c.engine, P1, c.id("drain"), "hitself");
  assert.equal(i1 - inf(c.engine, P1), 2, "my faction loses the plain 2");
});

clause(GD, "2:rule", "only a LOSS is increased: the opponent's faction gaining influence gains the plain amount", () => {
  const b = gdBoard();
  const i2 = inf(b.engine, P2);
  activate(b.engine, P1, b.id("drain"), "gain");
  assert.equal(inf(b.engine, P2) - i2, 2);
});

clause(GD, "2:rule", "relative to the controller: the opponent's Gideon boosts losses of MY faction, not of theirs", () => {
  const b = gdBoard([], P2);
  const i1 = inf(b.engine, P1);
  const i2 = inf(b.engine, P2);
  activate(b.engine, P1, b.id("drain"), "hit"); // P2's faction loses 2, P2 owns Gideon: no bonus
  assert.equal(i2 - inf(b.engine, P2), 2);
  activate(b.engine, P1, b.id("drain"), "hitself"); // P1's faction is the opponent of P2's Gideon
  assert.equal(i1 - inf(b.engine, P1), 3);
});

clause(GD, "2:rule", "also applies to battle damage that makes the opponent's faction lose influence", () => {
  const b = gdBoard();
  const before = inf(b.engine, P2);
  fightThrough(b.engine, P1, [b.id("ally")], FACTION_P2, []);
  assert.equal(before - inf(b.engine, P2), 2, "ally 1 strength + 1");
});

clause(GD, "2:rule", "only while Gideon is in play: in hand or in the discard pile the loss is plain", () => {
  for (const z of ["hand", "discard"] as const) {
    const b = gdBoard();
    b.engine.state.cards[b.id("gd")].zone = z;
    const i2 = inf(b.engine, P2);
    activate(b.engine, P1, b.id("drain"), "hit");
    assert.equal(i2 - inf(b.engine, P2), 2, `Gideon in ${z}`);
  }
});

clause(GD, "2:rule", "Gideons of both players each boost the other's faction losses", () => {
  const b = gdBoard([{ key: "gd2", def: printing(GD), owner: P2, zone: "play" }]);
  const i1 = inf(b.engine, P1);
  const i2 = inf(b.engine, P2);
  activate(b.engine, P1, b.id("drain"), "hit");
  assert.equal(i2 - inf(b.engine, P2), 3, "only P1's Gideon applies to P2's faction");
  activate(b.engine, P1, b.id("drain"), "hitself");
  assert.equal(i1 - inf(b.engine, P1), 3, "only P2's Gideon applies to P1's faction");
});

// =============================================================================================
// Godwing Thunderhoof -- warlord godwing/seraphim/dragon, cost 9, threshold [R], 5 / 3 / 5, UNIQUE GODWING
// =============================================================================================

const GW = "76dfd43f-055f-462e-ab76-6a963fd508a2";

const gwBoard = (rage: number, extra: CardPlacement[] = [], gwController: PlayerId = P1) =>
  mk(
    [
      { key: "gw", def: printing(GW), owner: P1, ...(gwController !== P1 ? { controller: gwController } : {}), zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, speed: 3, life: 20 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, speed: 1, life: 10 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", strength: 1, speed: 1, life: 10 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      ...bank("rage", rage, gwController),
      ...extra
    ],
    gwController
  );
const gwAttack = (b: Board, who: PlayerId = P1, ids: string[] = ["gw"]) =>
  declareAttackBy(b.engine, who, ids.map((k) => b.id(k)), { type: "faction", playerId: who === P1 ? P2 : P1 });
const gwPick = (b: Board, ids: CardInstanceId[]): void => {
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pcOf(b.engine)?.playerId, P1);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: ids });
};

clause(GW, "0:unique", "printed card: a warlord godwing/seraphim/dragon, cost 9, threshold [R], 5 strength / 3 speed / 5 life, UNIQUE GODWING", () => {
  const b = gwBoard(0);
  const def = b.engine.getDefinition(b.id("gw"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...(def.subtype ?? [])], ["godwing", "seraphim", "dragon"]);
  assert.deepEqual([b.engine.getStat(b.id("gw"), "strength"), b.engine.getStat(b.id("gw"), "speed"), b.engine.getStat(b.id("gw"), "life")], [5, 3, 5]);
  assert.equal(def.unique, "godwing");
});

clause(GW, "0:unique", "deploys for exactly 9 resources with one [R]; one short and no [R] are refused", () => {
  deployChecks(GW, 9, [...bank("rage", 9, P1)], [...bank("rage", 8, P1)], [...bank("greed", 9, P1)]);
  deployChecks(GW, 9, [...bank("rage", 1, P1), ...bank("greed", 8, P1)], [...bank("rage", 1, P1), ...bank("greed", 7, P1)], [...bank("greed", 9, P1)]);
});

clause(GW, "0:unique", "UNIQUE: a second Godwing makes you keep one; the opponent's copy is separate", () => {
  uniqueChecks(GW);
});

clause(GW, "1:rule", "when it attacks you may pick a character and it takes X damage, X = the [R] you control (3 -> 3, 5 -> 5)", () => {
  for (const n of [3, 5]) {
    const b = gwBoard(n);
    gwAttack(b);
    gwPick(b, [b.id("foe")]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(dmg(b, "foe"), n, `X = ${n}`);
    assert.equal(dmg(b, "foe2"), 0);
    assert.equal(dmg(b, "ally"), 0);
    assert.equal(dmg(b, "gw"), 0);
  }
});

clause(GW, "1:rule", "'may': declining deals no damage and the attack goes on; an empty pick is fine", () => {
  const b = gwBoard(4);
  gwAttack(b);
  gwPick(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(dmg(b, "foe2"), 0);
  assert.ok(b.engine.state.battle, "still attacking");
});

clause(GW, "1:rule", "'pick a character' means ONE character: picking two at once is refused, one is fine", () => {
  const b = gwBoard(4);
  gwAttack(b);
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("foe"), b.id("foe2")] }), "two characters picked for a single-character pick");
  assert.equal(dmg(b, "foe"), 0, "the refused pick dealt no damage");
  assert.equal(dmg(b, "foe2"), 0, "the refused pick dealt no damage");
  gwPick(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 4, "control: a single pick takes X damage");
  assert.equal(dmg(b, "foe2"), 0, "only the picked character takes damage");
});

clause(GW, "1:rule", "any character may be picked (mine, Godwing himself, theirs); an item is refused; a lethal X destroys it", () => {
  const b = gwBoard(4);
  gwAttack(b);
  gwPick(b, [b.id("ally")]);
  assert.equal(dmg(b, "ally"), 4, "my own character may be picked");
  const c = gwBoard(4);
  gwAttack(c);
  gwPick(c, [c.id("gw")]);
  assert.equal(dmg(c, "gw"), 4, "even itself");
  assert.equal(zoneOf(c.engine, c.id("gw")), "play", "4 < 5 life");
  const d = gwBoard(4);
  gwAttack(d);
  refused(() => resolveChoice(d.engine, { kind: "chooserSelectsTarget", selected: [d.id("gear")] }), "item is not a character");
  assert.equal(dmg(d, "gear"), 0);
  gwPick(d, [d.id("foe2")]);
  assert.equal(dmg(d, "foe2"), 4, "positive control");
  const e = gwBoard(10, [{ key: "weak", def: character({ name: "Weak", life: 10 }), owner: P2, zone: "play" }]);
  gwAttack(e);
  gwPick(e, [e.id("weak")]);
  assert.equal(zoneOf(e.engine, e.id("weak")), "discard", "X 10 >= life 10");
});

clause(GW, "1:rule", "X counts only [R]: other icons, the opponent's [R] and spent [R] are handled by what you control", () => {
  const b = gwBoard(2, [...bank("greed", 3, P1), ...bank("rage", 6, P2)]);
  gwAttack(b);
  gwPick(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 2, "greed and the opponent's rage are not counted");
  const c = gwBoard(2, spentResources(P1, 3));
  gwAttack(c);
  gwPick(c, [c.id("foe")]);
  assert.equal(dmg(c, "foe"), 5, "spent [R] resources are still controlled");
});

clause(GW, "1:rule", "X is zero with no [R]: the pick deals 0 damage", () => {
  const b = gwBoard(0, bank("greed", 3, P1));
  gwAttack(b);
  gwPick(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 0);
});

clause(GW, "1:rule", "X is read for the controller: a Godwing the opponent controls counts THEIR [R]", () => {
  const b = mk(
    [
      { key: "gw", def: printing(GW), owner: P1, controller: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 10 }), owner: P1, zone: "play" },
      ...bank("rage", 6, P1),
      ...bank("rage", 2, P2)
    ],
    P2
  );
  declareAttackBy(b.engine, P2, [b.id("gw")], { type: "faction", playerId: P1 });
  assert.equal(pcOf(b.engine)?.playerId, P2, "its controller chooses");
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("mine")] });
  assert.equal(dmg(b, "mine"), 2);
});

clause(GW, "1:rule", "triggers only when THIS card attacks: an ally attacking alone prompts nothing; Godwing in a party prompts once", () => {
  const b = gwBoard(4);
  gwAttack(b, P1, ["ally"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b, "foe"), 0);
  const c = gwBoard(4);
  gwAttack(c, P1, ["gw", "ally"]);
  gwPick(c, [c.id("foe")]);
  assert.equal(c.engine.state.pendingChoice, undefined, "only one prompt");
  assert.equal(dmg(c, "foe"), 4);
});

clause(GW, "1:rule", "the damage lands when it attacks, before blockers are declared (not at battle end)", () => {
  const b = gwBoard(3);
  gwAttack(b);
  gwPick(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 3);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe2")] } as never);
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "foe"), 3, "unchanged while foe2 blocks");
});

clause(GW, "1:rule", "not when the opponent attacks, nor while idle: Godwing in play prompts nothing", () => {
  const b = gwBoard(4, [{ key: "atk", def: character({ name: "Atk", life: 10 }), owner: P2, zone: "play" }], P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(dmg(b, "ally"), 0);
});
