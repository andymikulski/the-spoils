import assert from "node:assert/strict";
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
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  type StapleIcon
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
type Game = ReturnType<typeof buildGame>;
type Engine = Game["engine"];

const PRIDE = "e56986ee-eb4e-4e7d-99af-4c8df775e238"; // RESIST -- COST: Pay 1. Your faction loses 1 influence. -- EFFECT: Reduce the next damage inflicted to this card this turn by 1. -- DISAPPEAR -- COST: Pay 2. -- EFFECT: This turn, this card gains covert.
const REGROUP = "d67e94e7-a40d-409b-b845-d6b1478458f0"; // Draw 2 cards. If you control an attacking party of at least 2 members, draw 2 more cards, then discard a card. -- FLIP UP: 5 [G]
const HOTTIE = "59c7f2ec-2f3e-4260-b819-b90e859bdef9"; // When this card enters play, your faction loses 2 influence. -- [V][V][V][V]: This card gains COVERT.
const VISION = "866cd820-dd86-4410-9c0e-0c0541e81e08"; // Search your deck for up to 2 different types of staple resources, not named "Greed", and reveal them. Put them into your hand. Your faction gains 1 influence.
const GLUTTON = "a0243e83-005c-4bec-8454-0bbb86489d3c"; // [G][G][V][V]: When this card is destroyed, draw a card. When this card attacks, you may pick a card in a discard pile. If you do, remove it from the game. -- FLIP UP: 2 [V][V][V][V]
const INSPECT = "cd2dd0f0-9a3a-4dd7-bafb-0464a3749a27"; // EXTRA COST: Pick a non-resource card. -- If the card has a [V] icon in its rules text, destroy the card. Otherwise your faction loses influence equal to the card's numeric cost and flip the card face-down under its owner's control. -- FLIP UP: 2 [G][G]
const HUNTER = "3612bd61-eb06-4ea1-9739-1088e1eedf13"; // (no rules text)

// ---------------------------------------------------------------- shared helpers

const inf = (engine: Engine, p: string) => engine.state.players[p].influence;
const handOf = (engine: Engine, p: string) => [...engine.state.players[p].hand];
const deckOf = (engine: Engine, p: string) => [...engine.state.players[p].deck];
const discardOf = (engine: Engine, p: string) => [...engine.state.players[p].discard];
const ready = (engine: Engine) => readyResources(engine, P1);
const damageOn = (engine: Engine, cardId: string) => engine.state.cards[cardId].damage ?? 0;
const staple = (name: string, icon: StapleIcon) => resourceCard({ name, resource: { provides: [icon], staple: true } });
const FACTION_P2 = { type: "faction", playerId: P2 } as const;
const FACTION_P1 = { type: "faction", playerId: P1 } as const;

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const flipUpRaw = (engine: Engine, player: string, cardId: string, selected: Record<string, string[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const flipUp = (engine: Engine, player: string, cardId: string, selected: Record<string, string[]> = {}) => {
  flipUpRaw(engine, player, cardId, selected);
  resolvePendingResponses(engine);
};

/** Answers the open chooserSelectsTarget choice (and drains responses). */
const pick = (engine: Engine, selected: string[], player: string = P1) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
};
const tryPick = (engine: Engine, selected: string[], player: string = P1) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);

const killTactic = () =>
  tactic({
    name: "Kill",
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

// ---------------------------------------------------------------- deploy battery (printed cost / threshold)

interface Dep {
  id: string;
  cost: number;
  icon: StapleIcon;
  n: number;
  ends: "play" | "discard";
  extra?: Cards;
  selected?: (id: (k: string) => string) => Record<string, string[]>;
}

function depBoard(spec: Dep, main: number, others: number, spentIcons = 0) {
  const otherIcon: StapleIcon = spec.icon === "greed" ? "rage" : "greed";
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(spec.id), owner: P1, zone: "hand" },
      ...(spec.extra ?? []),
      ...bank(spec.icon, main, P1),
      ...bank(otherIcon, others, P1),
      ...bank(spec.icon, spentIcons, P1).map((p) => ({ ...p, key: `sp_${p.key}`, attachedToKey: "__factionA" }))
    ]
  });
}
const depSel = (spec: Dep, id: (k: string) => string) => spec.selected?.(id) ?? {};

function depExact(spec: Dep) {
  const { engine, id } = depBoard(spec, Math.max(spec.cost, spec.n), 0);
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, true, "playable with exactly enough resources and icons");
  const before = ready(engine);
  play(engine, P1, id("card"), { selected: depSel(spec, id) });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("card")), spec.ends);
  assert.equal(before - ready(engine), spec.cost, `the printed cost of ${spec.cost} is paid`);
}
function depShort(spec: Dep) {
  // one ready resource short of the cost; spent icons top the threshold up so only the cost can refuse
  const { engine, id } = depBoard(spec, spec.cost - 1, 0, Math.max(0, spec.n - (spec.cost - 1)));
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, false, "one resource short: not playable");
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("card"), { selected: depSel(spec, id) }), "one ready resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(engine, id("card")), "hand");
  assert.equal(ready(engine), before, "nothing was paid");
}
function depWrongIcons(spec: Dep) {
  const { engine, id } = depBoard(spec, 0, spec.cost + spec.n + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "no matching icons");
  refused(() => playRaw(engine, P1, id("card"), { selected: depSel(spec, id) }), "plenty of resources of the wrong icon");
  assert.equal(zoneOf(engine, id("card")), "hand");
}
function depIconShort(spec: Dep) {
  const { engine, id } = depBoard(spec, spec.n - 1, spec.cost + spec.n + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "one icon short of the threshold");
  refused(() => playRaw(engine, P1, id("card"), { selected: depSel(spec, id) }), "one icon short, with plenty of other resources");
  assert.equal(zoneOf(engine, id("card")), "hand");
}
function depGate(spec: Dep) {
  const { engine, id } = depBoard(spec, spec.n + spec.cost, 0);
  play(engine, P1, id("card"), { selected: depSel(spec, id) });
  drain(engine, declineAll);
  assert.equal(ready(engine), spec.n, "only the numeric cost is spent; the threshold icons are a gate");
}

const PRIDE_DEP: Dep = { id: PRIDE, cost: 5, icon: "greed", n: 4, ends: "play" };
const REGROUP_DEP: Dep = {
  id: REGROUP,
  cost: 2,
  icon: "greed",
  n: 3,
  ends: "discard",
  extra: Array.from({ length: 6 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `DK${i}` }), owner: P1, zone: "deck" as const }))
};
const HOTTIE_DEP: Dep = { id: HOTTIE, cost: 4, icon: "greed", n: 1, ends: "play" };
const VISION_DEP: Dep = { id: VISION, cost: 3, icon: "greed", n: 1, ends: "discard" };
const GLUTTON_DEP: Dep = { id: GLUTTON, cost: 3, icon: "greed", n: 1, ends: "play" };
const INSPECT_DEP: Dep = {
  id: INSPECT,
  cost: 3,
  icon: "greed",
  n: 2,
  ends: "discard",
  extra: [{ key: "tgt", def: character({ name: "Tgt", cost: 1, text: "no icons" }), owner: P2, zone: "play" }],
  selected: (id) => ({ c: [id("tgt")] })
};
const HUNTER_DEP: Dep = { id: HUNTER, cost: 4, icon: "greed", n: 1, ends: "play" };

// =================================================================== PRIDE OF GORU-GORU GIDEA

const prideBoard = (o: { greed?: number; extra?: Cards; turn?: number; active?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "pride", def: printing(PRIDE), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 6, P1),
      ...(o.extra ?? [])
    ]
  });
const bx = (key: string, over: Record<string, unknown>) => ({ key, def: character({ name: key, life: 9, ...over }), owner: P2, zone: "play" as const });

clause(PRIDE, "0:ability:resist", "printed card: character, Banker, ghost/vehicle, 4 strength / 3 speed / 2 life, cost 5 with threshold [G][G][G][G]", () => {
  const { engine, id } = prideBoard();
  assert.equal(engine.getStat(id("pride"), "strength"), 4);
  assert.equal(engine.getStat(id("pride"), "speed"), 3);
  assert.equal(engine.getStat(id("pride"), "life"), 2);
  assert.equal(printing(PRIDE).type, "character");
  assert.equal(printing(PRIDE).trade, "banker");
  assert.deepEqual([...(printing(PRIDE).subtype ?? [])].sort(), ["ghost", "vehicle"]);
  assert.equal(printing(PRIDE).cost, 5);
  assert.equal(printing(PRIDE).threshold, "gggg");
});
clause(PRIDE, "0:ability:resist", "deploys for exactly 5 resources with four [G]", () => depExact(PRIDE_DEP));
clause(PRIDE, "0:ability:resist", "one resource short of the cost is refused", () => depShort(PRIDE_DEP));
clause(PRIDE, "0:ability:resist", "no [G] icons at all is refused", () => depWrongIcons(PRIDE_DEP));
clause(PRIDE, "0:ability:resist", "one [G] short of the threshold is refused", () => depIconShort(PRIDE_DEP));
clause(PRIDE, "0:ability:resist", "the threshold icons are a gate, only the 5 cost is spent", () => depGate(PRIDE_DEP));

clause(PRIDE, "0:ability:resist", "COST: pays 1 resource and the faction loses 1 influence", () => {
  const { engine, id } = prideBoard();
  const r = ready(engine);
  const i = inf(engine, P1);
  activate(engine, P1, id("pride"), "resist");
  assert.equal(r - ready(engine), 1, "pay 1");
  assert.equal(i - inf(engine, P1), 1, "your faction loses 1 influence");
});
clause(PRIDE, "0:ability:resist", "it is the controller's faction that loses the influence, not the opponent's", () => {
  const { engine, id } = prideBoard();
  const o = inf(engine, P2);
  activate(engine, P1, id("pride"), "resist");
  assert.equal(inf(engine, P2), o);
});
clause(PRIDE, "0:ability:resist", "cannot be used with no resource to pay (positive control with one)", () => {
  const none = prideBoard({ greed: 0 });
  refused(() => activate(none.engine, P1, none.id("pride"), "resist"), "no resource to pay 1");
  assert.equal(inf(none.engine, P1), 20, "no influence lost");
  const one = prideBoard({ greed: 1 });
  activate(one.engine, P1, one.id("pride"), "resist");
  assert.equal(inf(one.engine, P1), 19);
});
clause(PRIDE, "0:ability:resist", "the opponent cannot use it", () => {
  const { engine, id } = prideBoard({ extra: bank("greed", 3, P2) });
  refused(() => activate(engine, P2, id("pride"), "resist"), "not the controller");
  assert.equal(inf(engine, P1), 20);
});

const prideAttacks = (b: Game, blockers: string[]) => fightThrough(b.engine, P1, [b.id("pride")], FACTION_P2, blockers.map((k) => b.id(k)));

clause(PRIDE, "0:ability:resist", "reduces the next damage dealt to it by 1: a 2-damage hit leaves 1 damage and it survives", () => {
  const b = prideBoard({ extra: [bx("hit", { strength: 2, speed: 1 })] });
  activate(b.engine, P1, b.id("pride"), "resist");
  prideAttacks(b, ["hit"]);
  assert.equal(zoneOf(b.engine, b.id("pride")), "play");
  assert.equal(damageOn(b.engine, b.id("pride")), 1);
});
clause(PRIDE, "0:ability:resist", "without RESIST the same 2-damage hit destroys it (control)", () => {
  const b = prideBoard({ extra: [bx("hit", { strength: 2, speed: 1 })] });
  prideAttacks(b, ["hit"]);
  assert.equal(zoneOf(b.engine, b.id("pride")), "discard");
});
clause(PRIDE, "0:ability:resist", "a 1-damage hit is reduced to 0, not below", () => {
  const b = prideBoard({ extra: [bx("hit", { strength: 1, speed: 1 })] });
  activate(b.engine, P1, b.id("pride"), "resist");
  prideAttacks(b, ["hit"]);
  assert.equal(damageOn(b.engine, b.id("pride")), 0);
  assert.equal(zoneOf(b.engine, b.id("pride")), "play");
});
clause(PRIDE, "0:ability:resist", "only the NEXT damage is reduced: a second hit in the same battle is not", () => {
  const b = prideBoard({ extra: [bx("first", { strength: 2, speed: 5 }), bx("second", { strength: 1, speed: 1 })] });
  activate(b.engine, P1, b.id("pride"), "resist");
  prideAttacks(b, ["first", "second"]);
  assert.equal(zoneOf(b.engine, b.id("pride")), "discard", "2 - 1 = 1 from the first hit, then 1 more from the second = 2 life gone");
});
clause(PRIDE, "0:ability:resist", "two activations reduce the next damage by 2 in total", () => {
  const b = prideBoard({ extra: [bx("hit", { strength: 2, speed: 1 })] });
  activate(b.engine, P1, b.id("pride"), "resist");
  activate(b.engine, P1, b.id("pride"), "resist");
  prideAttacks(b, ["hit"]);
  assert.equal(damageOn(b.engine, b.id("pride")), 0, "2 reduced by 1 and by 1 again");
  assert.equal(zoneOf(b.engine, b.id("pride")), "play");
});
clause(PRIDE, "0:ability:resist", "lasts only this turn: unused on the next turn, a 2-damage hit destroys it", () => {
  const b = prideBoard({ extra: [bx("oa", { strength: 2, speed: 1 })] });
  activate(b.engine, P1, b.id("pride"), "resist");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "it is the opponent's turn");
  fightThrough(b.engine, P2, [b.id("oa")], FACTION_P1, [b.id("pride")]);
  assert.equal(zoneOf(b.engine, b.id("pride")), "discard");
});
clause(PRIDE, "0:ability:resist", "usable in response on the opponent's turn, and it works for the damage that turn", () => {
  const b = prideBoard({ turn: 3, active: P2, extra: [bx("oa", { strength: 2, speed: 1 })] });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  activate(b.engine, P1, b.id("pride"), "resist");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pride")] });
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("pride")), "play");
  assert.equal(damageOn(b.engine, b.id("pride")), 1);
});
clause(PRIDE, "0:ability:resist", "only reduces damage to this card: another character taking the same hit takes all of it", () => {
  const b = prideBoard({
    turn: 3,
    active: P2,
    extra: [bx("oa", { strength: 2, speed: 1 }), { key: "ally", def: character({ name: "Ally", life: 5, strength: 1 }), owner: P1, zone: "play" as const }]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  activate(b.engine, P1, b.id("pride"), "resist");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("ally")] });
  finishBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("ally")), 2, "Ally takes the full 2");
});

clause(PRIDE, "1:ability:disappear", "COST: pays 2 resources; this turn it gains covert", () => {
  const { engine, id } = prideBoard({ greed: 2 });
  assert.equal(engine.getKeywords(id("pride")).includes("covert"), false, "no covert before");
  const r = ready(engine);
  activate(engine, P1, id("pride"), "disappear");
  assert.equal(r - ready(engine), 2, "pay 2");
  assert.equal(engine.getKeywords(id("pride")).includes("covert"), true);
  assert.equal(inf(engine, P1), 20, "no influence cost");
});
clause(PRIDE, "1:ability:disappear", "one resource short of the cost is refused", () => {
  const { engine, id } = prideBoard({ greed: 1 });
  refused(() => activate(engine, P1, id("pride"), "disappear"), "pay 2 with 1 resource");
  assert.equal(engine.getKeywords(id("pride")).includes("covert"), false);
  assert.equal(ready(engine), 1, "nothing paid");
});
clause(PRIDE, "1:ability:disappear", "only this card gains covert, and the opponent cannot use it", () => {
  const { engine, id } = prideBoard({
    greed: 4,
    extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }, ...bank("greed", 3, P2)]
  });
  refused(() => activate(engine, P2, id("pride"), "disappear"), "not the controller");
  activate(engine, P1, id("pride"), "disappear");
  assert.equal(engine.getKeywords(id("ally")).includes("covert"), false);
});
clause(PRIDE, "1:ability:disappear", "the covert lasts only this turn", () => {
  const { engine, id } = prideBoard({ greed: 2 });
  activate(engine, P1, id("pride"), "disappear");
  assert.equal(engine.getKeywords(id("pride")).includes("covert"), true);
  endTurn(engine, P1);
  assert.equal(engine.getKeywords(id("pride")).includes("covert"), false, "gone on the next turn");
});
clause(PRIDE, "1:ability:disappear", "while covert, a non-covert character cannot block it; without DISAPPEAR it can", () => {
  const b = prideBoard({ greed: 2, extra: [bx("plain", {})] });
  declareAttackBy(b.engine, P1, [b.id("pride")], FACTION_P2);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plain")] });
  assert.ok(b.engine.state.battle, "control: the plain character blocked");
  const c = prideBoard({ greed: 2, extra: [bx("plain", {})] });
  activate(c.engine, P1, c.id("pride"), "disappear");
  declareAttackBy(c.engine, P1, [c.id("pride")], FACTION_P2);
  refused(() => c.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [c.id("plain")] }), "a non-covert character cannot block a covert one", /covert/i);
});

// =================================================================== REGROUP & REASSESS

const regroupBoard = (o: { greed?: number; faceDown?: boolean; extra?: Cards; turn?: number; active?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      o.faceDown
        ? { key: "rr", def: printing(REGROUP), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "rr", def: printing(REGROUP), owner: P1, zone: "hand" as const },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      ...Array.from({ length: 8 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `DK${i}` }), owner: P1, zone: "deck" as const })),
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2" }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3" }), owner: P1, zone: "play" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "play" },
      { key: "e2", def: character({ name: "E2" }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 3, P1),
      ...(o.extra ?? [])
    ]
  });
const attackWith = (b: Game, player: string, keys: string[], target: typeof FACTION_P1 | typeof FACTION_P2) =>
  b.engine.perform({ type: "declareAttack", playerId: player, attackerIds: keys.map((k) => b.id(k)), target });

clause(REGROUP, "0:rule", "printed card: tactic, Banker, cost 2 with threshold [G][G][G]", () => {
  assert.equal(printing(REGROUP).type, "tactic");
  assert.equal(printing(REGROUP).trade, "banker");
  assert.equal(printing(REGROUP).cost, 2);
  assert.equal(printing(REGROUP).threshold, "ggg");
});
clause(REGROUP, "0:rule", "deploys for exactly 2 resources with three [G]", () => depExact(REGROUP_DEP));
clause(REGROUP, "0:rule", "one resource short of the cost is refused", () => depShort(REGROUP_DEP));
clause(REGROUP, "0:rule", "no [G] icons at all is refused", () => depWrongIcons(REGROUP_DEP));
clause(REGROUP, "0:rule", "one [G] short of the threshold is refused", () => depIconShort(REGROUP_DEP));
clause(REGROUP, "0:rule", "the threshold icons are a gate, only the 2 cost is spent", () => depGate(REGROUP_DEP));

clause(REGROUP, "0:rule", "with no battle: draws exactly 2 cards (the top two), no discard", () => {
  const b = regroupBoard();
  const top = deckOf(b.engine, P1);
  play(b.engine, P1, b.id("rr"));
  assert.equal(pending(b.engine), undefined, "no discard prompt");
  assert.deepEqual(handOf(b.engine, P1).sort(), [b.id("keep"), top[0], top[1]].sort());
  assert.equal(deckOf(b.engine, P1).length, 6);
  assert.equal(zoneOf(b.engine, b.id("rr")), "discard");
});
clause(REGROUP, "0:rule", "attacking with only 1 member: draws 2 only", () => {
  const b = regroupBoard();
  attackWith(b, P1, ["a1"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  assert.equal(pending(b.engine), undefined, "no discard prompt");
  assert.equal(handOf(b.engine, P1).length, 3, "keep + 2 drawn");
  assert.equal(deckOf(b.engine, P1).length, 6);
});
clause(REGROUP, "0:rule", "my attacking party of exactly 2: draws 2 more (4 total), then must discard a card", () => {
  const b = regroupBoard();
  const top = deckOf(b.engine, P1);
  attackWith(b, P1, ["a1", "a2"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  assert.equal(deckOf(b.engine, P1).length, 4, "4 cards drawn");
  assert.equal(handOf(b.engine, P1).length, 5, "keep + 4 drawn, before the discard");
  const pc = pending(b.engine);
  assert.ok(pc, "a discard choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pick(b.engine, [top[3]]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, top[3]), "discard", "a card drawn this turn can be the discarded one");
  assert.equal(handOf(b.engine, P1).length, 4);
  assert.deepEqual(handOf(b.engine, P1).sort(), [b.id("keep"), top[0], top[1], top[2]].sort());
});
clause(REGROUP, "0:rule", "the discarded card may be any card in hand", () => {
  const b = regroupBoard();
  attackWith(b, P1, ["a1", "a2"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  pick(b.engine, [b.id("keep")]);
  assert.equal(zoneOf(b.engine, b.id("keep")), "discard");
  assert.equal(handOf(b.engine, P1).length, 4);
});
clause(REGROUP, "0:rule", "a party of 3 draws exactly 2 more (not more), then discards 1", () => {
  const b = regroupBoard();
  attackWith(b, P1, ["a1", "a2", "a3"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  assert.equal(deckOf(b.engine, P1).length, 4, "4 cards drawn");
  pick(b.engine, [b.id("keep")]);
  assert.equal(discardOf(b.engine, P1).filter((c) => c !== b.id("rr")).length, 1, "exactly one card discarded");
});
clause(REGROUP, "0:rule", "the discard is mandatory: it cannot be declined", () => {
  const b = regroupBoard();
  attackWith(b, P1, ["a1", "a2"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(tryPick(b.engine, []), "discard a card is not optional");
  assert.equal(handOf(b.engine, P1).length, 5, "nothing discarded yet");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for the discard");
  pick(b.engine, [b.id("keep")]);
  assert.equal(handOf(b.engine, P1).length, 4);
});
clause(REGROUP, "0:rule", "only a card from my own hand can be discarded", () => {
  const b = regroupBoard({ extra: [{ key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" }] });
  attackWith(b, P1, ["a1", "a2"], FACTION_P2);
  play(b.engine, P1, b.id("rr"));
  refused(tryPick(b.engine, [b.id("oppHand")]), "the opponent's hand");
  refused(tryPick(b.engine, [b.id("a3")]), "a card in play");
  refused(tryPick(b.engine, [deckOf(b.engine, P1)[0]]), "a card in the deck");
  pick(b.engine, [b.id("keep")]);
  assert.equal(zoneOf(b.engine, b.id("oppHand")), "hand");
});
clause(REGROUP, "0:rule", "an attacking party the OPPONENT controls does not count: draws 2 only", () => {
  const b = regroupBoard({ turn: 3, active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("e1"), b.id("e2")], FACTION_P1);
  play(b.engine, P1, b.id("rr"));
  assert.equal(pending(b.engine), undefined, "no discard prompt");
  assert.equal(handOf(b.engine, P1).length, 3, "keep + 2 drawn");
});
clause(REGROUP, "0:rule", "a 2-member party I control but that is not attacking (own turn, no attack) draws 2 only", () => {
  const b = regroupBoard();
  play(b.engine, P1, b.id("rr"));
  assert.equal(handOf(b.engine, P1).length, 3);
  assert.equal(pending(b.engine), undefined);
});

clause(REGROUP, "1:flipUp", "FLIP UP 5 [G]: 4 other resources plus the card itself pay the 5, and the effect resolves (draws 2)", () => {
  const b = regroupBoard({ faceDown: true, greed: 4 });
  const top = deckOf(b.engine, P1);
  assert.equal(ready(b.engine), 5, "4 greed + the face-down card");
  flipUp(b.engine, P1, b.id("rr"));
  assert.equal(ready(b.engine), 0, "all 5 spent");
  assert.deepEqual(handOf(b.engine, P1).sort(), [b.id("keep"), top[0], top[1]].sort());
  assert.equal(zoneOf(b.engine, b.id("rr")), "discard");
});
clause(REGROUP, "1:flipUp", "one resource short of 5 (itself included) is refused", () => {
  const b = regroupBoard({ faceDown: true, greed: 3 });
  refused(() => flipUpRaw(b.engine, P1, b.id("rr")), "3 greed + itself = 4 < 5");
  assert.equal(b.engine.state.cards[b.id("rr")].faceDown, true);
  assert.equal(handOf(b.engine, P1).length, 1, "nothing drawn");
  assert.equal(ready(b.engine), 4, "nothing paid");
});
clause(REGROUP, "1:flipUp", "needs a [G] icon: 5 resources with none is refused; with exactly one [G] it works", () => {
  const none = regroupBoard({ faceDown: true, greed: 0, extra: volition(4, P1) });
  assert.equal(ready(none.engine), 5);
  refused(() => flipUpRaw(none.engine, P1, none.id("rr")), "no [G] icon among the resources");
  assert.equal(none.engine.state.cards[none.id("rr")].faceDown, true);
  const one = regroupBoard({ faceDown: true, greed: 1, extra: volition(3, P1) });
  flipUp(one.engine, P1, one.id("rr"));
  assert.equal(zoneOf(one.engine, one.id("rr")), "discard", "one [G] meets the threshold");
});
clause(REGROUP, "1:flipUp", "flipped up while my party of 2 is attacking: draws 4 and discards 1", () => {
  const b = regroupBoard({ faceDown: true, greed: 4 });
  attackWith(b, P1, ["a1", "a2"], FACTION_P2);
  flipUp(b.engine, P1, b.id("rr"));
  assert.equal(handOf(b.engine, P1).length, 5, "keep + 4 drawn");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the discard choice");
  pick(b.engine, [b.id("keep")]);
  assert.equal(handOf(b.engine, P1).length, 4);
});

// =================================================================== SMOKIN' HOTTIE

const hottieBoard = (o: { vol?: number; volOwner?: string; extra?: Cards; zone?: "play" | "hand"; turn?: number; active?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "h", def: printing(HOTTIE), owner: P1, zone: o.zone ?? "play" },
      ...volition(o.vol ?? 0, o.volOwner ?? P1),
      ...(o.extra ?? [])
    ]
  });

clause(HOTTIE, "0:rule", "printed card: character, Banker, ghost, 3 strength / 3 speed / 2 life, cost 4 with threshold [G]", () => {
  const { engine, id } = hottieBoard();
  assert.equal(engine.getStat(id("h"), "strength"), 3);
  assert.equal(engine.getStat(id("h"), "speed"), 3);
  assert.equal(engine.getStat(id("h"), "life"), 2);
  assert.equal(printing(HOTTIE).type, "character");
  assert.equal(printing(HOTTIE).trade, "banker");
  assert.deepEqual([...(printing(HOTTIE).subtype ?? [])], ["ghost"]);
  assert.equal(printing(HOTTIE).cost, 4);
  assert.equal(printing(HOTTIE).threshold, "g");
});
clause(HOTTIE, "0:rule", "deploys for exactly 4 resources with one [G]", () => depExact(HOTTIE_DEP));
clause(HOTTIE, "0:rule", "one resource short of the cost is refused", () => depShort(HOTTIE_DEP));
clause(HOTTIE, "0:rule", "no [G] icons at all is refused", () => depWrongIcons(HOTTIE_DEP));
clause(HOTTIE, "0:rule", "the threshold icon is a gate, only the 4 cost is spent", () => depGate(HOTTIE_DEP));

clause(HOTTIE, "0:rule", "when it enters play, its controller's faction loses exactly 2 influence (the opponent's does not)", () => {
  const b = hottieBoard({ zone: "hand", extra: bank("greed", 4, P1) });
  play(b.engine, P1, b.id("h"));
  assert.equal(zoneOf(b.engine, b.id("h")), "play");
  assert.equal(inf(b.engine, P1), 18);
  assert.equal(inf(b.engine, P2), 20);
});
clause(HOTTIE, "0:rule", "another character entering play does not cost influence", () => {
  const b = hottieBoard({ extra: [{ key: "ally", def: character({ name: "Ally", cost: 1 }), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  play(b.engine, P1, b.id("ally"));
  assert.equal(zoneOf(b.engine, b.id("ally")), "play");
  assert.equal(pending(b.engine), undefined);
  assert.equal(inf(b.engine, P1), 20);
});
clause(HOTTIE, "0:rule", "a second Hottie entering costs only the entering one's 2 influence", () => {
  const b = hottieBoard({ extra: [{ key: "h2", def: printing(HOTTIE), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  play(b.engine, P1, b.id("h2"));
  assert.equal(inf(b.engine, P1), 18, "2, not 4");
});
clause(HOTTIE, "0:rule", "an opponent's character entering play costs me nothing", () => {
  const b = hottieBoard({
    turn: 3,
    active: P2,
    extra: [{ key: "oc", def: character({ name: "OC", cost: 1 }), owner: P2, zone: "hand" }, ...bank("greed", 2, P2)]
  });
  play(b.engine, P2, b.id("oc"));
  assert.equal(inf(b.engine, P1), 20);
  assert.equal(inf(b.engine, P2), 20);
});

const coverts = (b: Game) => b.engine.getKeywords(b.id("h")).includes("covert");
clause(HOTTIE, "1:rule@vvvv", "with four [V] it has COVERT", () => {
  assert.equal(coverts(hottieBoard({ vol: 4 })), true);
  assert.equal(coverts(hottieBoard({ vol: 6 })), true, "more than four also works");
});
clause(HOTTIE, "1:rule@vvvv", "with only three [V] it does not (near miss)", () => {
  assert.equal(coverts(hottieBoard({ vol: 3 })), false);
  assert.equal(coverts(hottieBoard({ vol: 0 })), false);
});
clause(HOTTIE, "1:rule@vvvv", "face-up resources are not [V]: three [V] plus five face-up [G] is not enough", () => {
  assert.equal(coverts(hottieBoard({ vol: 3, extra: bank("greed", 5, P1) })), false);
  assert.equal(coverts(hottieBoard({ vol: 4, extra: bank("greed", 5, P1) })), true, "control: with the fourth [V] it is");
});
clause(HOTTIE, "1:rule@vvvv", "only MY face-down resources count, not the opponent's", () => {
  assert.equal(coverts(hottieBoard({ vol: 4, volOwner: P2 })), false);
  assert.equal(coverts(hottieBoard({ vol: 3, extra: volition(1, P2) })), false);
});
clause(HOTTIE, "1:rule@vvvv", "turns on and off as the [V] count changes", () => {
  const b = hottieBoard({ vol: 4 });
  assert.equal(coverts(b), true);
  const vols = Object.values(b.engine.state.cards).filter((c) => c.faceDown && c.zone === "play");
  vols[0].faceDown = false;
  assert.equal(coverts(b), false, "one flipped face-up: three [V] left");
  vols[0].faceDown = true;
  assert.equal(coverts(b), true, "and on again");
});
clause(HOTTIE, "1:rule@vvvv", "a Hottie in hand does not have it", () => {
  assert.equal(coverts(hottieBoard({ vol: 4, zone: "hand" })), false);
});
clause(HOTTIE, "1:rule@vvvv", "a covert Hottie cannot be blocked by a non-covert character; with three [V] it can", () => {
  const plain = { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" as const };
  const on = hottieBoard({ vol: 4, extra: [plain] });
  declareAttackBy(on.engine, P1, [on.id("h")], FACTION_P2);
  refused(() => on.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [on.id("plain")] }), "covert party", /covert/i);
  const off = hottieBoard({ vol: 3, extra: [{ ...plain }] });
  declareAttackBy(off.engine, P1, [off.id("h")], FACTION_P2);
  off.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [off.id("plain")] });
  assert.ok(off.engine.state.battle, "control: blocked");
});

// =================================================================== STRATEGIC VISION

const visionBoard = (o: { seed?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: lcg(o.seed ?? 7),
    cards: [
      { key: "sv", def: printing(VISION), owner: P1, zone: "hand" },
      { key: "rage", def: staple("Rage", "rage"), owner: P1, zone: "deck" },
      { key: "rage2", def: staple("Rage", "rage"), owner: P1, zone: "deck" },
      { key: "elit", def: staple("Elitism", "elitism"), owner: P1, zone: "deck" },
      { key: "dec", def: staple("Deception", "deception"), owner: P1, zone: "deck" },
      { key: "obs", def: staple("Obsession", "obsession"), owner: P1, zone: "deck" },
      { key: "greed", def: staple("Greed", "greed"), owner: P1, zone: "deck" },
      { key: "fancy", def: resourceCard({ name: "Fancy", resource: { provides: ["rage"], staple: false } }), owner: P1, zone: "deck" },
      { key: "ch1", def: character({ name: "Ch1" }), owner: P1, zone: "deck" },
      { key: "ch2", def: character({ name: "Ch2" }), owner: P1, zone: "deck" },
      { key: "ch3", def: character({ name: "Ch3" }), owner: P1, zone: "deck" },
      { key: "oppRage", def: staple("Rage", "rage"), owner: P2, zone: "deck" },
      { key: "handRage", def: staple("Rage", "rage"), owner: P1, zone: "hand" },
      { key: "discRage", def: staple("Rage", "rage"), owner: P1, zone: "discard" },
      { key: "playRage", def: staple("Rage", "rage"), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
const cast = (b: Game) => {
  play(b.engine, P1, b.id("sv"));
  const pc = pending(b.engine);
  assert.ok(pc, "the search opens a pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search my own deck");
};
const revealed = (b: Game) =>
  b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);

clause(VISION, "0:rule", "printed card: tactic, Banker, cost 3 with threshold [G]", () => {
  assert.equal(printing(VISION).type, "tactic");
  assert.equal(printing(VISION).trade, "banker");
  assert.equal(printing(VISION).cost, 3);
  assert.equal(printing(VISION).threshold, "g");
});
clause(VISION, "0:rule", "deploys for exactly 3 resources with one [G]", () => depExact(VISION_DEP));
clause(VISION, "0:rule", "one resource short of the cost is refused", () => depShort(VISION_DEP));
clause(VISION, "0:rule", "no [G] icons at all is refused", () => depWrongIcons(VISION_DEP));
clause(VISION, "0:rule", "the threshold icon is a gate, only the 3 cost is spent", () => depGate(VISION_DEP));

clause(VISION, "0:rule", "two different staple types (Rage + Elitism): both go to my hand, I gain 1 influence, the tactic is discarded", () => {
  const b = visionBoard();
  const i = inf(b.engine, P1);
  const handBefore = handOf(b.engine, P1).length;
  cast(b);
  pick(b.engine, [b.id("rage"), b.id("elit")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("rage")), "hand");
  assert.equal(zoneOf(b.engine, b.id("elit")), "hand");
  assert.equal(inf(b.engine, P1), i + 1);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 2, "tactic left, two staples arrived");
  assert.equal(zoneOf(b.engine, b.id("sv")), "discard");
  for (const k of ["rage2", "dec", "obs", "greed", "fancy", "ch1", "ch2", "ch3"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", `${k} stays in the deck`);
});
clause(VISION, "0:rule", "both found cards are revealed", () => {
  const b = visionBoard();
  cast(b);
  pick(b.engine, [b.id("dec"), b.id("obs")]);
  const r = revealed(b);
  assert.ok(r.includes(b.id("dec")), "Deception revealed");
  assert.ok(r.includes(b.id("obs")), "Obsession revealed");
  assert.ok(!r.includes(b.id("rage")), "nothing else revealed");
});
clause(VISION, "0:rule", "up to 2: finding just one is fine, and I still gain 1 influence", () => {
  const b = visionBoard();
  const i = inf(b.engine, P1);
  cast(b);
  pick(b.engine, [b.id("dec")]);
  assert.equal(zoneOf(b.engine, b.id("dec")), "hand");
  assert.equal(inf(b.engine, P1), i + 1);
  assert.equal(handOf(b.engine, P1).length, 2, "the other cards stay: handRage + the one found");
  assert.deepEqual(revealed(b), [b.id("dec")]);
});
clause(VISION, "0:rule", "finding nothing is allowed: nothing revealed, no card taken, and I still gain 1 influence", () => {
  const b = visionBoard();
  const i = inf(b.engine, P1);
  const deckBefore = deckOf(b.engine, P1).length;
  cast(b);
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(deckOf(b.engine, P1).length, deckBefore);
  assert.equal(revealed(b).length, 0);
  assert.equal(inf(b.engine, P1), i + 1);
  assert.equal(zoneOf(b.engine, b.id("sv")), "discard");
});
clause(VISION, "0:rule", "two cards of the same type (Rage + Rage) are refused; one of them alone, or Rage + another type, is accepted", () => {
  const b = visionBoard();
  cast(b);
  refused(tryPick(b.engine, [b.id("rage"), b.id("rage2")]), "same type twice");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  pick(b.engine, [b.id("rage2"), b.id("obs")]);
  assert.equal(zoneOf(b.engine, b.id("rage2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("obs")), "hand");
});
clause(VISION, "0:rule", "a staple named Greed is refused, alone or with another type", () => {
  const b = visionBoard();
  cast(b);
  refused(tryPick(b.engine, [b.id("greed")]), "Greed alone");
  refused(tryPick(b.engine, [b.id("greed"), b.id("rage")]), "Greed with Rage");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("rage")]);
  assert.equal(zoneOf(b.engine, b.id("greed")), "deck");
});
clause(VISION, "0:rule", "only staple resources: a non-staple resource and ordinary cards are refused", () => {
  const b = visionBoard();
  cast(b);
  refused(tryPick(b.engine, [b.id("fancy")]), "a resource that is not a staple");
  refused(tryPick(b.engine, [b.id("ch1")]), "a character");
  refused(tryPick(b.engine, [b.id("rage"), b.id("ch2")]), "a staple plus a character");
  pick(b.engine, [b.id("rage")]);
  assert.equal(zoneOf(b.engine, b.id("rage")), "hand");
});
clause(VISION, "0:rule", "searches only MY deck: the opponent's deck, my hand, discard and play are refused", () => {
  const b = visionBoard();
  cast(b);
  refused(tryPick(b.engine, [b.id("oppRage")]), "the opponent's deck");
  refused(tryPick(b.engine, [b.id("handRage")]), "my hand");
  refused(tryPick(b.engine, [b.id("discRage")]), "my discard pile");
  refused(tryPick(b.engine, [b.id("playRage")]), "in play");
  pick(b.engine, [b.id("elit")]);
  assert.equal(zoneOf(b.engine, b.id("oppRage")), "deck");
});
clause(VISION, "0:rule", "at most 2: three different types are refused", () => {
  const b = visionBoard();
  cast(b);
  refused(tryPick(b.engine, [b.id("rage"), b.id("elit"), b.id("dec")]), "three cards");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("rage"), b.id("elit")]);
  assert.equal(zoneOf(b.engine, b.id("dec")), "deck");
});
clause(VISION, "0:rule", "the searched deck is shuffled afterwards (members unchanged, order changed)", () => {
  const b = visionBoard();
  const before = deckOf(b.engine, P1).filter((c) => c !== b.id("rage") && c !== b.id("elit"));
  cast(b);
  pick(b.engine, [b.id("rage"), b.id("elit")]);
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "reshuffled");
});
clause(VISION, "0:rule", "the deck is shuffled even when nothing is found", () => {
  const b = visionBoard();
  const before = deckOf(b.engine, P1);
  cast(b);
  pick(b.engine, []);
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "reshuffled after a failed search");
});

// =================================================================== THABBASHITE GLUTTON

const gluttonBoard = (o: { greed?: number; vol?: number; rage?: number; extra?: Cards; turn?: number; active?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "tg", def: printing(GLUTTON), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...volition(o.vol ?? 2, P1),
      ...(o.extra ?? [])
    ]
  });
const killTg = (b: Game, target = "tg") => {
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(target)] } });
  drain(b.engine, declineAll);
};

clause(GLUTTON, "0:rule@ggvv", "printed card: character, Banker, fighter, 1 strength / 3 speed / 4 life, cost 3 with threshold [G]", () => {
  const { engine, id } = gluttonBoard();
  assert.equal(engine.getStat(id("tg"), "strength"), 1);
  assert.equal(engine.getStat(id("tg"), "speed"), 3);
  assert.equal(engine.getStat(id("tg"), "life"), 4);
  assert.equal(printing(GLUTTON).type, "character");
  assert.equal(printing(GLUTTON).trade, "banker");
  assert.deepEqual([...(printing(GLUTTON).subtype ?? [])], ["fighter"]);
  assert.equal(printing(GLUTTON).cost, 3);
  assert.equal(printing(GLUTTON).threshold, "g");
});
clause(GLUTTON, "0:rule@ggvv", "deploys for exactly 3 resources with one [G]", () => depExact(GLUTTON_DEP));
clause(GLUTTON, "0:rule@ggvv", "one resource short of the cost is refused", () => depShort(GLUTTON_DEP));
clause(GLUTTON, "0:rule@ggvv", "no [G] icons at all is refused", () => depWrongIcons(GLUTTON_DEP));
clause(GLUTTON, "0:rule@ggvv", "the threshold icon is a gate, only the 3 cost is spent", () => depGate(GLUTTON_DEP));

clause(GLUTTON, "0:rule@ggvv", "with [G][G][V][V]: when destroyed, its controller draws exactly 1 card (the top one)", () => {
  const b = gluttonBoard();
  const top = deckOf(b.engine, P1)[0];
  killTg(b);
  assert.equal(zoneOf(b.engine, b.id("tg")), "discard");
  assert.deepEqual(handOf(b.engine, P1), [top], "kill left the hand, one card drawn");
  assert.equal(pending(b.engine), undefined);
});
clause(GLUTTON, "0:rule@ggvv", "with more than [G][G][V][V] it still draws exactly 1", () => {
  const b = gluttonBoard({ greed: 4, vol: 4 });
  killTg(b);
  assert.equal(handOf(b.engine, P1).length, 1);
});
clause(GLUTTON, "0:rule@ggvv", "destroyed in battle it draws too", () => {
  const b = gluttonBoard({
    turn: 3,
    active: P2,
    extra: [{ key: "big", def: character({ name: "Big", strength: 9, life: 9 }), owner: P2, zone: "play" }]
  });
  fightThrough(b.engine, P2, [b.id("big")], FACTION_P1, [b.id("tg")]);
  assert.equal(zoneOf(b.engine, b.id("tg")), "discard");
  assert.equal(handOf(b.engine, P1).length, 2, "kill + 1 drawn");
});
clause(GLUTTON, "0:rule@ggvv", "one [G] short: destroyed, no draw", () => {
  const b = gluttonBoard({ greed: 1, vol: 2 });
  killTg(b);
  assert.equal(zoneOf(b.engine, b.id("tg")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});
clause(GLUTTON, "0:rule@ggvv", "one [V] short: destroyed, no draw", () => {
  const b = gluttonBoard({ greed: 2, vol: 1 });
  killTg(b);
  assert.equal(handOf(b.engine, P1).length, 0);
});
clause(GLUTTON, "0:rule@ggvv", "wrong icons ([R][R][V][V] and [G][G] with no [V]): no draw", () => {
  const a = gluttonBoard({ greed: 0, rage: 2, vol: 2 });
  killTg(a);
  assert.equal(handOf(a.engine, P1).length, 0, "rage is not greed");
  const c = gluttonBoard({ greed: 2, vol: 0, rage: 2 });
  killTg(c);
  assert.equal(handOf(c.engine, P1).length, 0, "no face-down resources");
});
clause(GLUTTON, "0:rule@ggvv", "another character of mine being destroyed does not draw (threshold met)", () => {
  const b = gluttonBoard();
  killTg(b, "ally");
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});

const gDiscards: Cards = [
  { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "discard" },
  { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "discard" },
  { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
  { key: "op", def: character({ name: "OP" }), owner: P2, zone: "play" }
];
const gAttack = (b: Game, key = "tg") => b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id(key)], target: FACTION_P2 });

clause(GLUTTON, "0:rule@ggvv", "with [G][G][V][V]: when it attacks I may pick a card in my own discard pile and it is removed from the game", () => {
  const b = gluttonBoard({ extra: gDiscards });
  gAttack(b);
  const pc = pending(b.engine);
  assert.ok(pc, "a pick opens");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pick(b.engine, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard", "only the picked card is removed");
});
clause(GLUTTON, "0:rule@ggvv", "it may pick a card in the OPPONENT's discard pile (a discard pile, either)", () => {
  const b = gluttonBoard({ extra: gDiscards });
  gAttack(b);
  pick(b.engine, [b.id("theirs")]);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});
clause(GLUTTON, "0:rule@ggvv", "'may': declining removes nothing", () => {
  const b = gluttonBoard({ extra: gDiscards });
  gAttack(b);
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
});
clause(GLUTTON, "0:rule@ggvv", "exactly one card, and only from a discard pile (not hand, play or deck)", () => {
  const b = gluttonBoard({ extra: gDiscards });
  gAttack(b);
  refused(tryPick(b.engine, [b.id("mine"), b.id("theirs")]), "two cards");
  refused(tryPick(b.engine, [b.id("oh")]), "the opponent's hand");
  refused(tryPick(b.engine, [b.id("op")]), "a card in play");
  refused(tryPick(b.engine, [b.id("d0")]), "my deck");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open");
  pick(b.engine, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed", "control: a discard-pile card is accepted");
});
clause(GLUTTON, "0:rule@ggvv", "one [G] short: attacking offers no pick", () => {
  const b = gluttonBoard({ greed: 1, extra: gDiscards });
  gAttack(b);
  assert.equal(pending(b.engine), undefined);
});
clause(GLUTTON, "0:rule@ggvv", "one [V] short: attacking offers no pick", () => {
  const b = gluttonBoard({ vol: 1, extra: gDiscards });
  gAttack(b);
  assert.equal(pending(b.engine), undefined);
});
clause(GLUTTON, "0:rule@ggvv", "another character attacking does not offer the pick (threshold met)", () => {
  const b = gluttonBoard({ extra: gDiscards });
  gAttack(b, "ally");
  assert.equal(pending(b.engine), undefined);
});
clause(GLUTTON, "0:rule@ggvv", "when it BLOCKS (does not attack) no pick is offered", () => {
  const b = gluttonBoard({
    turn: 3,
    active: P2,
    extra: [...gDiscards, { key: "oa", def: character({ name: "OA", life: 9 }), owner: P2, zone: "play" as const }]
  });
  declareAttackBy(b.engine, P2, [b.id("oa")], FACTION_P1);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("tg")] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

// FLIP UP 2 [V][V][V][V]
const gFlipBoard = (o: { others?: number; depleted?: number; greed?: number; active?: string; turn?: number } = {}) => {
  const total = o.others ?? 4;
  const cards: Cards = [
    { key: "tg", def: printing(GLUTTON), owner: P1, zone: "play", faceDown: true },
    ...Array.from({ length: total }, (_, i) => ({
      key: `v${i}`,
      def: staple("Obsession", "obsession"),
      owner: P1,
      zone: "play" as const,
      faceDown: true,
      ...(i < (o.depleted ?? 0) ? { attachedToKey: "__factionA" } : {})
    })),
    ...bank("greed", o.greed ?? 0, P1)
  ];
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: o.turn ?? 2, activePlayerId: o.active ?? P1, cards });
};

clause(GLUTTON, "1:flipUp", "FLIP UP 2 [V][V][V][V]: with four other face-down resources it enters play face-up, paying 2", () => {
  const b = gFlipBoard();
  const r = ready(b.engine);
  flipUp(b.engine, P1, b.id("tg"));
  assert.equal(zoneOf(b.engine, b.id("tg")), "play");
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, false, "face-up");
  assert.equal(b.engine.state.cards[b.id("tg")].controllerId, P1);
  assert.equal(r - ready(b.engine), 2 + 1, "2 spent; the flipped card itself is no longer a ready resource");
});
clause(GLUTTON, "1:flipUp", "the card may pay part of its own FLIP UP cost (cost paid before flipping)", () => {
  const b = gFlipBoard({ others: 4, depleted: 3 });
  assert.equal(ready(b.engine), 2, "one other + itself ready");
  flipUp(b.engine, P1, b.id("tg"));
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, false);
});
clause(GLUTTON, "1:flipUp", "a cost of 2 with only 1 ready resource (itself) is refused", () => {
  const b = gFlipBoard({ others: 4, depleted: 4 });
  assert.equal(ready(b.engine), 1);
  refused(() => flipUpRaw(b.engine, P1, b.id("tg")), "cost 2 with one ready resource");
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, true);
});
clause(GLUTTON, "1:flipUp", "needs four [V] OTHER than itself: three other face-down resources are refused even with plenty to pay", () => {
  const b = gFlipBoard({ others: 3, greed: 3 });
  assert.ok(ready(b.engine) >= 2, "ready(b.engine) >= 2");
  refused(() => flipUpRaw(b.engine, P1, b.id("tg")), "its own [V] does not count toward the threshold");
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, true);
});
clause(GLUTTON, "1:flipUp", "two other face-down resources are refused under any reading", () => {
  const b = gFlipBoard({ others: 2, greed: 3 });
  assert.ok(ready(b.engine) >= 2, "ready(b.engine) >= 2");
  refused(() => flipUpRaw(b.engine, P1, b.id("tg")), "two other [V] is two short even counting itself", /FLIP UP threshold requirements are not met/);
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, true);
});
clause(GLUTTON, "1:flipUp", "face-up resources are not [V]: four [G] and no other face-down resources is refused", () => {
  const b = gFlipBoard({ others: 0, greed: 5 });
  refused(() => flipUpRaw(b.engine, P1, b.id("tg")), "no [V]");
});
clause(GLUTTON, "1:flipUp", "a non-tactic cannot be flipped up in the opponent's response window", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P2,
    cards: [
      { key: "tg", def: printing(GLUTTON), owner: P1, zone: "play", faceDown: true },
      ...volition(4, P1),
      { key: "oa", def: character({ name: "OA" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  refused(() => flipUpRaw(b.engine, P1, b.id("tg")), "not allowed in an opponent's response window");
  assert.equal(b.engine.state.cards[b.id("tg")].faceDown, true);
});

// =================================================================== UNACCUSTOMED INSPECTION

const VGUY = () => character({ name: "V Guy", cost: 4, text: "[V][V]: This card gets +1/+1." });
const inspBoard = (o: { faceDown?: boolean; extra?: Cards; greed?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P1,
    cards: [
      o.faceDown
        ? { key: "ui", def: printing(INSPECT), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "ui", def: printing(INSPECT), owner: P1, zone: "hand" as const },
      { key: "pride", def: printing(PRIDE), owner: P2, zone: "play" },
      { key: "hottie", def: printing(HOTTIE), owner: P2, zone: "play" },
      { key: "vguy", def: VGUY(), owner: P2, zone: "play" },
      { key: "vitem", def: item({ name: "V Item", cost: 2, text: "[V]: This item does a thing." }), owner: P2, zone: "play" },
      { key: "vloc", def: location({ name: "V Loc", cost: 2, text: "[V]: This location does a thing." }), owner: P2, zone: "play" },
      { key: "noicon", def: character({ name: "No Icon", cost: 3, text: "Vanilla rules text." }), owner: P2, zone: "play" },
      { key: "gicon", def: character({ name: "G Icon", cost: 2, text: "[G][R]: This gets +1/+1." }), owner: P2, zone: "play" },
      { key: "free", def: character({ name: "Free", cost: 0, text: "none" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", cost: 2, text: "none" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 3, text: "none" }), owner: P2, controller: P1, zone: "play" },
      { key: "taken", def: character({ name: "Taken", cost: 1, text: "none" }), owner: P1, controller: P2, zone: "play" },
      { key: "res", def: staple("Rage", "rage"), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown", cost: 2, text: "none" }), owner: P2, zone: "play", faceDown: true },
      { key: "hc", def: character({ name: "HandC", cost: 2, text: "none" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DeckC", cost: 2, text: "none" }), owner: P2, zone: "deck" },
      { key: "dsc", def: character({ name: "DiscC", cost: 2, text: "none" }), owner: P2, zone: "discard" },
      ...bank("greed", o.greed ?? 6, P1),
      ...(o.extra ?? [])
    ]
  });
const inspect = (b: Game, target: string) => play(b.engine, P1, b.id("ui"), { selected: { c: [b.id(target)] } });
const inspectRaw = (b: Game, target?: string) => () =>
  playRaw(b.engine, P1, b.id("ui"), { selected: target ? { c: [b.id(target)] } : {} });

clause(INSPECT, "0:extraCost", "printed card: tactic, Banker, cost 3 with threshold [G][G]", () => {
  assert.equal(printing(INSPECT).type, "tactic");
  assert.equal(printing(INSPECT).trade, "banker");
  assert.equal(printing(INSPECT).cost, 3);
  assert.equal(printing(INSPECT).threshold, "gg");
});
clause(INSPECT, "0:extraCost", "deploys for exactly 3 resources with two [G]", () => depExact(INSPECT_DEP));
clause(INSPECT, "0:extraCost", "one resource short of the cost is refused", () => depShort(INSPECT_DEP));
clause(INSPECT, "0:extraCost", "no [G] icons at all is refused", () => depWrongIcons(INSPECT_DEP));
clause(INSPECT, "0:extraCost", "one [G] short of the threshold is refused", () => depIconShort(INSPECT_DEP));
clause(INSPECT, "0:extraCost", "the threshold icons are a gate, only the 3 cost is spent", () => depGate(INSPECT_DEP));

clause(INSPECT, "0:extraCost", "a non-resource card must be picked: playing without a pick is refused (positive control with one)", () => {
  const b = inspBoard();
  refused(inspectRaw(b), "no card picked");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
  inspect(b, "noicon");
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard");
});
clause(INSPECT, "0:extraCost", "any non-resource card in play can be picked: characters, items, locations, mine or the opponent's", () => {
  for (const k of ["noicon", "vguy", "vitem", "vloc", "mine", "stolen", "taken"]) {
    const b = inspBoard();
    inspect(b, k);
    assert.equal(zoneOf(b.engine, b.id("ui")), "discard", `${k} was a legal pick`);
  }
});
clause(INSPECT, "0:extraCost", "a resource cannot be picked", () => {
  const b = inspBoard();
  refused(inspectRaw(b, "res"), "a face-up resource card");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
  assert.equal(inf(b.engine, P1), 20);
});
clause(INSPECT, "0:extraCost", "a face-down card (it is a resource) cannot be picked", () => {
  const b = inspBoard();
  refused(inspectRaw(b, "fd"), "a face-down card is a resource");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
});
clause(INSPECT, "0:extraCost", "a faction card cannot be picked (CR 202.9: factions are excluded unless named)", () => {
  const b = inspBoard();
  const fac = b.engine.state.players[P2].factionId as string;
  refused(() => playRaw(b.engine, P1, b.id("ui"), { selected: { c: [fac] } }), "a faction card");
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
});
clause(INSPECT, "0:extraCost", "the pick must be in play: cards in hand, deck or discard pile are refused", () => {
  const b = inspBoard();
  for (const k of ["hc", "dc", "dsc"]) refused(inspectRaw(b, k), `${k} is not in play`);
  assert.equal(zoneOf(b.engine, b.id("ui")), "hand");
});

clause(INSPECT, "1:rule", "a card with a [V] icon in its rules text is destroyed (real card Smokin' Hottie), and no influence is lost", () => {
  const b = inspBoard();
  inspect(b, "hottie");
  assert.equal(zoneOf(b.engine, b.id("hottie")), "discard");
  assert.equal(inf(b.engine, P1), 20);
  assert.equal(inf(b.engine, P2), 20);
});
clause(INSPECT, "1:rule", "[V] in the text of a character, an item and a location: each is destroyed, not flipped", () => {
  for (const k of ["vguy", "vitem", "vloc"]) {
    const b = inspBoard();
    inspect(b, k);
    assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} destroyed`);
    assert.equal(inf(b.engine, P1), 20, `${k}: no influence lost`);
    assert.notEqual(b.engine.state.cards[b.id(k)].faceDown, true);
  }
});
clause(INSPECT, "1:rule", "a card without [V] (real card Pride of Goru-Goru Gidea, cost 5): flipped face-down, my faction loses 5 influence", () => {
  const b = inspBoard();
  inspect(b, "pride");
  assert.equal(b.engine.state.cards[b.id("pride")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("pride")), "play", "not destroyed");
  assert.equal(inf(b.engine, P1), 15);
  assert.equal(inf(b.engine, P2), 20, "the opponent loses nothing");
});
clause(INSPECT, "1:rule", "influence lost equals the numeric cost: cost 3 loses 3, cost 2 loses 2, cost 0 loses 0", () => {
  const a = inspBoard();
  inspect(a, "noicon");
  assert.equal(inf(a.engine, P1), 17);
  const c = inspBoard();
  inspect(c, "mine");
  assert.equal(inf(c.engine, P1), 18);
  assert.equal(c.engine.state.cards[c.id("mine")].faceDown, true, "my own card is flipped too");
  const z = inspBoard();
  inspect(z, "free");
  assert.equal(inf(z.engine, P1), 20);
  assert.equal(z.engine.state.cards[z.id("free")].faceDown, true);
});
clause(INSPECT, "1:rule", "only a [V] icon counts: a card with [G] and [R] icons is flipped, not destroyed", () => {
  const b = inspBoard();
  inspect(b, "gicon");
  assert.equal(zoneOf(b.engine, b.id("gicon")), "play");
  assert.equal(b.engine.state.cards[b.id("gicon")].faceDown, true);
  assert.equal(inf(b.engine, P1), 18);
});
clause(INSPECT, "1:rule", "flipped face-down under its OWNER's control: a card I control but the opponent owns goes back to its owner", () => {
  const b = inspBoard();
  inspect(b, "stolen");
  assert.equal(b.engine.state.cards[b.id("stolen")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("stolen")].ownerId, P2);
  assert.equal(b.engine.state.cards[b.id("stolen")].controllerId, P2, "controlled by its owner now");
  assert.equal(inf(b.engine, P1), 17);
});
clause(INSPECT, "1:rule", "a card the opponent controls but I own is controlled by me once flipped", () => {
  const b = inspBoard();
  inspect(b, "taken");
  assert.equal(b.engine.state.cards[b.id("taken")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("taken")].controllerId, P1);
  assert.equal(inf(b.engine, P1), 19);
});
clause(INSPECT, "1:rule", "the opponent's card flipped face-down stays under the opponent (owner = controller)", () => {
  const b = inspBoard();
  inspect(b, "noicon");
  assert.equal(b.engine.state.cards[b.id("noicon")].controllerId, P2);
  assert.equal(b.engine.state.cards[b.id("noicon")].ownerId, P2);
});

clause(INSPECT, "2:flipUp", "FLIP UP 2 [G][G]: two greed resources plus the card itself work; it picks, resolves and is discarded", () => {
  const b = inspBoard({ faceDown: true, greed: 2 });
  assert.equal(ready(b.engine), 3, "2 greed + the face-down card");
  flipUp(b.engine, P1, b.id("ui"), { c: [b.id("noicon")] });
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard");
  assert.equal(b.engine.state.cards[b.id("noicon")].faceDown, true, "the effect resolved");
  assert.equal(inf(b.engine, P1), 17);
});
clause(INSPECT, "2:flipUp", "exactly 2 ready resources (itself + one [G]) pay the cost; a spent [G] still counts toward the threshold", () => {
  const b = inspBoard({ faceDown: true, greed: 1, extra: bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(b.engine), 2);
  flipUp(b.engine, P1, b.id("ui"), { c: [b.id("noicon")] });
  assert.equal(zoneOf(b.engine, b.id("ui")), "discard");
  assert.equal(b.engine.state.cards[b.id("noicon")].faceDown, true);
});
clause(INSPECT, "2:flipUp", "FLIP UP still destroys a [V] card", () => {
  const b = inspBoard({ faceDown: true, greed: 2 });
  flipUp(b.engine, P1, b.id("ui"), { c: [b.id("hottie")] });
  assert.equal(zoneOf(b.engine, b.id("hottie")), "discard");
});
clause(INSPECT, "2:flipUp", "a cost of 2 with only 1 ready resource is refused", () => {
  const b = inspBoard({ faceDown: true, greed: 0, extra: bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(b.engine), 1, "only the face-down card itself is ready; the two [G] are spent");
  refused(() => flipUpRaw(b.engine, P1, b.id("ui"), { c: [b.id("noicon")] }), "cost 2 with one ready resource");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
});
clause(INSPECT, "2:flipUp", "needs two [G]: one [G] among plenty of resources is refused", () => {
  const b = inspBoard({ faceDown: true, greed: 1, extra: bank("rage", 4, P1) });
  refused(() => flipUpRaw(b.engine, P1, b.id("ui"), { c: [b.id("noicon")] }), "only one [G]");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
  assert.equal(inf(b.engine, P1), 20);
});
clause(INSPECT, "2:flipUp", "FLIP UP still requires the picked non-resource card", () => {
  const b = inspBoard({ faceDown: true, greed: 2 });
  refused(() => flipUpRaw(b.engine, P1, b.id("ui"), {}), "no card picked");
  refused(() => flipUpRaw(b.engine, P1, b.id("ui"), { c: [b.id("res")] }), "a resource picked");
  assert.equal(b.engine.state.cards[b.id("ui")].faceDown, true);
});

// =================================================================== UNFORTUNATE FORTUNE HUNTER (vanilla)

clause(HUNTER, "vanilla", "printed card: character, Banker, mau/mercenary/hunter, 3 strength / 3 speed / 4 life, cost 4 with threshold [G]", () => {
  const { engine, id } = buildGame({ cards: [{ key: "u", def: printing(HUNTER), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("u"), "strength"), 3);
  assert.equal(engine.getStat(id("u"), "speed"), 3);
  assert.equal(engine.getStat(id("u"), "life"), 4);
  assert.equal(printing(HUNTER).type, "character");
  assert.equal(printing(HUNTER).trade, "banker");
  assert.deepEqual([...(printing(HUNTER).subtype ?? [])].sort(), ["hunter", "mau", "mercenary"]);
  assert.equal(printing(HUNTER).cost, 4);
  assert.equal(printing(HUNTER).threshold, "g");
});
clause(HUNTER, "vanilla", "no rules text: no keywords, abilities, or triggers", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "u", def: printing(HUNTER), owner: P1, zone: "play" }, ...bank("greed", 8, P1)] });
  assert.deepEqual(engine.getKeywords(id("u")), []);
  assert.equal((engine.getDefinition(id("u")).behavior?.abilities ?? []).length, 0);
  assert.equal(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("u")).length, 0);
});
clause(HUNTER, "vanilla", "deploys for exactly 4 resources with one [G]", () => depExact(HUNTER_DEP));
clause(HUNTER, "vanilla", "one resource short of the cost is refused", () => depShort(HUNTER_DEP));
clause(HUNTER, "vanilla", "no [G] icons at all is refused", () => depWrongIcons(HUNTER_DEP));
clause(HUNTER, "vanilla", "the threshold icon is a gate, only the 4 cost is spent", () => depGate(HUNTER_DEP));
clause(HUNTER, "vanilla", "entering play has no side effects (no influence change, no prompt)", () => {
  const b = depBoard(HUNTER_DEP, 4, 0);
  const i = inf(b.engine, P1);
  play(b.engine, P1, b.id("card"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(inf(b.engine, P1), i);
});

void answerPending;

