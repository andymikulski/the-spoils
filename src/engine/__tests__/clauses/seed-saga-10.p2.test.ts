import assert from "node:assert/strict";
import {
  buildGame,
  activate, bank, character, developFaction, item, location, play, resourceCard, tactic, P1, P2
} from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, battleOf, finishBattle } from "./_battle.js";
import { answerPending, declareBlockers, tokensOn, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";
import { printedStats } from "./_printed.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const ready = (engine: SpoilsEngine, p: PlayerId) => engine.getAvailableResourceCount(p);
const spentD = (owner: PlayerId, n: number): CardPlacement[] =>
  bank("deception", n, owner).map((b) => ({ ...b, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const flip = (engine: SpoilsEngine, p: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: p, cardId, selected, variables: {} });

// ---------------------------------------------------------------- Sprint
const SPRINT = "69aa735d-4136-4e2c-8706-a1963f877ace"; // tactic rogue cost 3 [D]
const sprintBoard = (res: CardPlacement[], active: PlayerId = P1) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2, activePlayerId: active, random: () => 0.3,
    cards: [
      { key: "sp", def: printing(SPRINT), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally", speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", speed: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "handc", def: character({ name: "HandC" }), owner: P1, zone: "hand" },
      { key: "discc", def: character({ name: "DiscC" }), owner: P1, zone: "discard" },
      ...res
    ]
  });
const sprintRes = () => [...bank("deception", 1, P1), ...bank("rage", 3, P1)];

clause(SPRINT, "0:extraCost", "printed cost 3, threshold [D], tactic, rogue, no stats; cost is paid", () => {
  const p = printing(SPRINT);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "rogue", 3, "d"]);
  const { engine, id } = sprintBoard(sprintRes());
  assert.equal(ready(engine, P1), 4);
  play(engine, P1, id("sp"), { selected: { c: [id("ally")] } });
  assert.equal(ready(engine, P1), 2, "3 paid, +1 for the new face-down resource");
});
clause(SPRINT, "0:extraCost", "exactly 3 resources with one [D] is enough; 2 resources is one short; no [D] icon is refused", () => {
  const exact = sprintBoard([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  play(exact.engine, P1, exact.id("sp"), { selected: { c: [exact.id("ally")] } });
  assert.equal(exact.engine.getStat(exact.id("ally"), "speed"), 3, "played at exactly 3");
  const short = sprintBoard([...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(short.engine, P1, short.id("sp"), { selected: { c: [short.id("ally")] } }), "one short on cost", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("sp")), "hand");
  const noIcon = sprintBoard(bank("rage", 4, P1));
  refused(() => play(noIcon.engine, P1, noIcon.id("sp"), { selected: { c: [noIcon.id("ally")] } }), "no [D] icon", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sp")), "hand");
});
clause(SPRINT, "0:extraCost", "the picked card must be a character in play: items, hand and discard cards are refused; own and opposing characters both work", () => {
  for (const bad of ["gear", "handc", "discc"]) {
    const { engine, id } = sprintBoard(sprintRes());
    refused(() => play(engine, P1, id("sp"), { selected: { c: [id(bad)] } }), `${bad} is not a character in play`);
    assert.equal(zoneOf(engine, id("sp")), "hand");
  }
  const noPick = sprintBoard(sprintRes());
  refused(() => play(noPick.engine, P1, noPick.id("sp"), { selected: {} }), "no pick at all");
  assert.equal(zoneOf(noPick.engine, noPick.id("sp")), "hand");
  const own = sprintBoard(sprintRes());
  play(own.engine, P1, own.id("sp"), { selected: { c: [own.id("ally")] } });
  assert.equal(own.engine.getStat(own.id("ally"), "speed"), 3);
  const opp = sprintBoard(sprintRes());
  play(opp.engine, P1, opp.id("sp"), { selected: { c: [opp.id("foe")] } });
  assert.equal(opp.engine.getStat(opp.id("foe"), "speed"), 4);
});
clause(SPRINT, "0:extraCost", "no character in play: nothing can be picked, so the tactic is refused", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() }, turn: 1, activePlayerId: P1,
    cards: [{ key: "sp", def: printing(SPRINT), owner: P1, zone: "hand" }, ...sprintRes()]
  });
  refused(() => play(engine, P1, id("sp"), { selected: {} }), "no characters in play");
  assert.equal(zoneOf(engine, id("sp")), "hand");
});
clause(SPRINT, "1:rule", "the picked character gains exactly 1 speed (only that one) and strength/life are unchanged", () => {
  const { engine, id } = sprintBoard(sprintRes());
  play(engine, P1, id("sp"), { selected: { c: [id("ally")] } });
  assert.equal(engine.getStat(id("ally"), "speed"), 3, "2 + 1");
  assert.equal(engine.getStat(id("ally"), "strength"), 1);
  assert.equal(engine.getStat(id("ally"), "life"), 3);
  assert.equal(engine.getStat(id("foe"), "speed"), 3, "the other character is untouched");
});
clause(SPRINT, "1:rule", "the speed bonus lasts this turn and is gone after the turn ends", () => {
  const { engine, id } = sprintBoard(sprintRes());
  play(engine, P1, id("sp"), { selected: { c: [id("ally")] } });
  assert.equal(engine.getStat(id("ally"), "speed"), 3);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("ally"), "speed"), 2, "back to printed after the turn");
});
clause(SPRINT, "1:rule", "afterwards Sprint is a face-down resource in play under its owner's control, not in the discard pile", () => {
  const { engine, id } = sprintBoard(sprintRes());
  play(engine, P1, id("sp"), { selected: { c: [id("ally")] } });
  const c = engine.state.cards[id("sp")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(engine.isResource(id("sp")), true);
  assert.equal(c.controllerId, P1);
  assert.equal(engine.state.players[P1].discard.includes(id("sp")), false);
  assert.ok(engine.state.players[P1].play.includes(id("sp")), "engine.state.players[P1].play.includes(id(\"sp\"))");
  assert.deepEqual(engine.getCardTypes(id("sp")), ["resource"]);
});
clause(SPRINT, "1:rule", "the new face-down resource counts toward the owner's ready resources and the opponent gets nothing", () => {
  const { engine, id } = sprintBoard(sprintRes());
  const oppBefore = ready(engine, P2);
  play(engine, P1, id("sp"), { selected: { c: [id("foe")] } });
  assert.equal(ready(engine, P1), 2);
  assert.equal(ready(engine, P2), oppBefore);
  assert.equal(engine.state.cards[id("sp")].ownerId, P1);
});

// ---------------------------------------------------------------- Strangulate
const STRANGULATE = "453ca442-9e36-4bb3-9817-8cd3e9fc3505"; // tactic rogue cost 4 [D], FLIP UP 2 [D]
const strBoard = (res: CardPlacement[], extra: CardPlacement[] = [], opts: { faceDown?: boolean } = {}) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      opts.faceDown
        ? { key: "st", def: printing(STRANGULATE), owner: P1, zone: "play", faceDown: true }
        : { key: "st", def: printing(STRANGULATE), owner: P1, zone: "hand" },
      { key: "l3", def: character({ name: "L3", life: 3 }), owner: P2, zone: "play" },
      { key: "l4", def: character({ name: "L4", life: 4 }), owner: P2, zone: "play" },
      { key: "l5", def: character({ name: "L5", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "handc", def: character({ name: "HandC", life: 1 }), owner: P1, zone: "hand" },
      ...res, ...extra
    ]
  });
const strRes = () => [...bank("deception", 1, P1), ...bank("rage", 3, P1)];
const cast = (g: ReturnType<typeof strBoard>, target: string) => play(g.engine, P1, g.id("st"), { selected: { c: [g.id(target)] } });

clause(STRANGULATE, "0:extraCost", "printed cost 4, threshold [D], tactic, rogue; cost 4 paid, one short refused, no [D] icon refused", () => {
  const p = printing(STRANGULATE);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "rogue", 4, "d"]);
  const g = strBoard([...strRes(), ...bank("rage", 2, P1)]);
  cast(g, "l3");
  assert.equal(ready(g.engine, P1), 2, "exactly 4 of 6 paid");
  assert.equal(zoneOf(g.engine, g.id("l3")), "discard");
  const exact = strBoard(strRes());
  cast(exact, "l3");
  assert.equal(ready(exact.engine, P1), 0);
  const short = strBoard([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => cast(short, "l3"), "one short", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("st")), "hand");
  assert.equal(zoneOf(short.engine, short.id("l3")), "play");
  const noIcon = strBoard(bank("rage", 5, P1));
  refused(() => cast(noIcon, "l3"), "no [D]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("st")), "hand");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("l3")), "play");
});
clause(STRANGULATE, "0:extraCost", "any character in play can be picked (own or opposing); items, hand cards and no pick are refused", () => {
  for (const ok of ["l5", "mine"]) {
    const g = strBoard(strRes());
    cast(g, ok);
    assert.equal(zoneOf(g.engine, g.id("st")), "discard", `${ok} accepted: Strangulate resolved`);
  }
  for (const bad of ["gear", "handc"]) {
    const g = strBoard(strRes());
    refused(() => cast(g, bad), `${bad} not a character in play`);
    assert.equal(zoneOf(g.engine, g.id("st")), "hand");
  }
  const g = strBoard(strRes());
  refused(() => play(g.engine, P1, g.id("st"), { selected: {} }), "no pick");
  assert.equal(zoneOf(g.engine, g.id("st")), "hand");
});
clause(STRANGULATE, "1:rule", "a character with 3 life or 4 life is destroyed", () => {
  for (const t of ["l3", "l4"]) {
    const g = strBoard(strRes());
    cast(g, t);
    assert.equal(zoneOf(g.engine, g.id(t)), "discard", `${t} destroyed`);
    for (const other of ["l3", "l4", "l5", "mine"].filter((k) => k !== t)) assert.equal(zoneOf(g.engine, g.id(other)), "play", `${other} untouched`);
  }
});
clause(STRANGULATE, "1:rule", "a character with 5 life is not destroyed (the tactic is still spent)", () => {
  const g = strBoard(strRes());
  cast(g, "l5");
  assert.equal(zoneOf(g.engine, g.id("l5")), "play");
  assert.equal(g.engine.state.cards[g.id("l5")].damage ?? 0, 0);
  assert.equal(zoneOf(g.engine, g.id("st")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});
clause(STRANGULATE, "1:rule", "the test uses the character's life stat, not remaining life: a damaged 5-life character survives, a 2-life one destroyed", () => {
  const g = strBoard(strRes(), [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P2, zone: "play", damage: 3 }]);
  cast(g, "hurt");
  assert.equal(zoneOf(g.engine, g.id("hurt")), "play", "life 6 (3 remaining) is not 4 or less");
  const g2 = strBoard(strRes());
  cast(g2, "mine");
  assert.equal(zoneOf(g2.engine, g2.id("mine")), "discard", "own 2-life character destroyed too");
});
const lifeBuffer = () =>
  character({
    name: "Buffer",
    behavior: {
      abilities: [
        {
          id: "buff", type: "activated",
          targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "c" }, stat: "life", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }]
        },
        {
          id: "nerf", type: "activated",
          targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "c" }, stat: "life", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    } as never
  });
clause(STRANGULATE, "1:rule", "modified life counts: +2 life makes a 3-life character safe; -1 life makes a 5-life one lethal", () => {
  const up = strBoard(strRes(), [{ key: "buf", def: lifeBuffer(), owner: P1, zone: "play" }]);
  activate(up.engine, P1, up.id("buf"), "buff", { selected: { c: [up.id("l3")] } });
  assert.equal(up.engine.getStat(up.id("l3"), "life"), 5);
  cast(up, "l3");
  assert.equal(zoneOf(up.engine, up.id("l3")), "play", "life 5 now: not destroyed");
  const down = strBoard(strRes(), [{ key: "buf", def: lifeBuffer(), owner: P1, zone: "play" }]);
  activate(down.engine, P1, down.id("buf"), "nerf", { selected: { c: [down.id("l5")] } });
  assert.equal(down.engine.getStat(down.id("l5"), "life"), 4);
  cast(down, "l5");
  assert.equal(zoneOf(down.engine, down.id("l5")), "discard", "life 4 now: destroyed");
});
const flipBoard = (res: CardPlacement[], extra: CardPlacement[] = []) => strBoard(res, extra, { faceDown: true });
clause(STRANGULATE, "2:flipUp", "a face-down Strangulate in play can be flipped up: it resolves (destroys a 4-life character) and goes to the discard pile", () => {
  const g = flipBoard([...bank("deception", 1, P1), ...bank("rage", 3, P1)]);
  assert.equal(g.engine.state.cards[g.id("st")].faceDown, true);
  flip(g.engine, P1, g.id("st"), { c: [g.id("l4")] });
  assert.equal(zoneOf(g.engine, g.id("l4")), "discard");
  assert.equal(zoneOf(g.engine, g.id("l3")), "play");
  assert.equal(zoneOf(g.engine, g.id("st")), "discard", "a spent tactic goes to the discard pile");
  const g2 = flipBoard([...bank("deception", 1, P1), ...bank("rage", 3, P1)]);
  flip(g2.engine, P1, g2.id("st"), { c: [g2.id("l5")] });
  assert.equal(zoneOf(g2.engine, g2.id("l5")), "play", "a 5-life character survives the flipped-up rule too");
});
clause(STRANGULATE, "2:flipUp", "costs exactly 2 (not its normal 4): st + one rage with a spent [D] bank is enough, st alone is one short", () => {
  const ok = flipBoard([...spentD(P1, 1), ...bank("rage", 1, P1)]);
  flip(ok.engine, P1, ok.id("st"), { c: [ok.id("l3")] });
  assert.equal(zoneOf(ok.engine, ok.id("l3")), "discard");
  assert.equal(ready(ok.engine, P1), 0, "both ready resources used or gone");
  const short = flipBoard([...spentD(P1, 1)]);
  refused(() => flip(short.engine, P1, short.id("st"), { c: [short.id("l3")] }), "only 1 ready resource for a cost of 2", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("l3")), "play");
  assert.equal(short.engine.state.cards[short.id("st")].faceDown, true);
});
clause(STRANGULATE, "2:flipUp", "FLIP UP threshold [D]: a [D] icon is needed (a spent one counts); with only [R] icons it is refused", () => {
  const ok = flipBoard([...spentD(P1, 1), ...bank("rage", 2, P1)]);
  flip(ok.engine, P1, ok.id("st"), { c: [ok.id("l3")] });
  assert.equal(zoneOf(ok.engine, ok.id("l3")), "discard");
  const bad = flipBoard(bank("rage", 4, P1));
  refused(() => flip(bad.engine, P1, bad.id("st"), { c: [bad.id("l3")] }), "no [D] icon", /threshold|icon/i);
  assert.equal(zoneOf(bad.engine, bad.id("l3")), "play");
  assert.equal(bad.engine.state.cards[bad.id("st")].faceDown, true);
});
clause(STRANGULATE, "2:flipUp", "the card may pay for its own FLIP UP: st + one [D] bank (2 resources total) is enough", () => {
  const g = flipBoard(bank("deception", 1, P1));
  flip(g.engine, P1, g.id("st"), { c: [g.id("l3")] });
  assert.equal(zoneOf(g.engine, g.id("l3")), "discard");
  assert.equal(ready(g.engine, P1), 0);
});
clause(STRANGULATE, "2:flipUp", "the threshold is met AFTER flipping: its own [D] icon does not count (st + 3 rage banks, no [D] elsewhere, is refused)", () => {
  const g = flipBoard(bank("rage", 3, P1));
  refused(() => flip(g.engine, P1, g.id("st"), { c: [g.id("l3")] }), "own icon must not satisfy the threshold", /threshold|icon/i);
  assert.equal(zoneOf(g.engine, g.id("l3")), "play");
});
clause(STRANGULATE, "2:flipUp", "a flipped-up Strangulate still needs its character pick (item and no pick refused); only a face-down card in play can be flipped", () => {
  const res = () => [...bank("deception", 1, P1), ...bank("rage", 3, P1)];
  const a = flipBoard(res());
  refused(() => flip(a.engine, P1, a.id("st"), { c: [a.id("gear")] }), "item is not a character");
  assert.equal(a.engine.state.cards[a.id("st")].faceDown, true);
  const b = flipBoard(res());
  refused(() => flip(b.engine, P1, b.id("st"), {}), "no pick");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, true);
  const c = strBoard(res());
  refused(() => flip(c.engine, P1, c.id("st"), { c: [c.id("l3")] }), "a card in hand cannot be flipped up");
  assert.equal(zoneOf(c.engine, c.id("l3")), "play");
});

// ---------------------------------------------------------------- Surprise!
const SURPRISE = "82f7c006-8b9f-4668-b3db-9507ce0bd479"; // tactic rogue cost 2 [D][D][D]
type SurOpts = { res?: CardPlacement[]; atkCost?: number; deck?: Array<ReturnType<typeof character>>; active?: PlayerId };
const surBoard = (o: SurOpts = {}) => {
  const calls = { n: 0 };
  const deck = o.deck ?? [];
  const g = buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: o.active === P2 ? 2 : 1, activePlayerId: o.active ?? P1, random: () => { calls.n++; return 0.3; },
    cards: [
      { key: "sur", def: printing(SURPRISE), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", cost: o.atkCost ?? 3, strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", cost: 3 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", cost: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P2, zone: "play" },
      ...(o.res ?? bank("deception", 3, P2)),
      ...deck.map((def, i) => ({ key: `d${i}`, def, owner: P2, zone: "deck" as const }))
    ]
  });
  return { ...g, calls };
};
type SurGame = ReturnType<typeof surBoard>;
const attack = (g: SurGame, target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId }) =>
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")], target);
const surCast = (g: SurGame, pick = "atk") => play(g.engine, P2, g.id("sur"), { selected: { k: [g.id(pick)] } });
const mk = (name: string, cost: number, extra: Record<string, unknown> = {}) => character({ name, cost, life: 4, strength: 1, ...extra });
const deckOf = () => [
  tactic({ name: "TacT" }), item({ name: "ItemI" }), mk("Big5", 5), mk("Big4", 4), mk("Hit", 3), mk("Cheap1", 1), mk("Tail", 2)
];
const deckSet = (g: SurGame) => [...g.engine.state.players[P2].deck].sort();
const charCount = (g: SurGame) => g.engine.state.players[P2].play.filter((c) => g.engine.getCardTypes(c).includes("character")).length;

clause(SURPRISE, "0:extraCost", "printed cost 2, threshold [D][D][D], tactic, rogue; costs exactly 2 and requires three [D] icons", () => {
  const p = printing(SURPRISE);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "rogue", 2, "ddd"]);
  const ok = surBoard({ deck: deckOf() });
  attack(ok);
  surCast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("sur")), "discard");
  assert.equal(ready(ok.engine, P2), 1, "2 of 3 paid");
  const unaff = surBoard({ res: [...spentD(P2, 2), ...bank("deception", 1, P2)], deck: deckOf() });
  attack(unaff);
  refused(() => surCast(unaff), "3 icons but only 1 ready resource for cost 2", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(unaff.engine, unaff.id("sur")), "hand");
  const noIcon = surBoard({ res: [...bank("deception", 2, P2), ...bank("rage", 1, P2)], deck: deckOf() });
  attack(noIcon);
  refused(() => surCast(noIcon), "only 2 [D] icons", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sur")), "hand");
  const two = surBoard({ res: bank("deception", 2, P2), deck: deckOf() });
  attack(two);
  refused(() => surCast(two), "2 [D] banks", /threshold|icon/i);
});
clause(SURPRISE, "0:extraCost", "the pick can be a character attacking your faction", () => {
  const g = surBoard({ deck: deckOf() });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("sur")), "discard");
});
clause(SURPRISE, "0:extraCost", "the pick can be a character attacking a location you control", () => {
  const g = surBoard({ deck: deckOf() });
  attack(g, { type: "card", cardId: g.id("loc") });
  assert.equal(battleOf(g.engine)?.target.type, "card");
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("sur")), "discard");
  assert.equal(zoneOf(g.engine, g.id("d4")), "play", "Hit entered play");
});
clause(SURPRISE, "0:extraCost", "a character that is not attacking (idle opposing character), or one of your own, cannot be picked", () => {
  for (const bad of ["idle", "mine"]) {
    const g = surBoard({ deck: deckOf() });
    attack(g);
    refused(() => surCast(g, bad), `${bad} is not an attacker of the opponent`);
    assert.equal(zoneOf(g.engine, g.id("sur")), "hand");
    assert.equal(zoneOf(g.engine, g.id("d4")), "deck");
  }
});
clause(SURPRISE, "0:extraCost", "with no battle (nobody attacking) it cannot be played", () => {
  // P2 is the active player with its own main phase, so timing cannot be what refuses: there is just no attacker to pick
  const g = surBoard({ deck: deckOf(), active: P2 });
  refused(() => surCast(g), "no attacker to pick", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("sur")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d4")), "deck");
});
clause(SURPRISE, "0:extraCost", "you cannot pick your own attacking character (it must be attacking YOUR faction or location)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 2, activePlayerId: P2, random: () => 0.3,
    cards: [
      { key: "sur", def: printing(SURPRISE), owner: P2, zone: "hand" },
      { key: "matk", def: character({ name: "MAtk", cost: 3 }), owner: P2, zone: "play" },
      { key: "p1c", def: character({ name: "P1C", cost: 3 }), owner: P1, zone: "play" },
      ...bank("deception", 3, P2),
      { key: "d0", def: mk("Hit", 3), owner: P2, zone: "deck" }
    ]
  });
  // declare without passing priority: the attacker holds priority first, so P2 may respond and only the pick can refuse
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("matk")], target: { type: "faction", playerId: P1 } });
  refused(() => play(g.engine, P2, g.id("sur"), { selected: { k: [g.id("matk")] } }), "own attacker", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("d0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("sur")), "hand");
});
clause(SURPRISE, "0:extraCost", "X is the picked character's numeric cost: cost 3 admits a cost-3 character but not a cost-4 one", () => {
  const g = surBoard({ deck: deckOf(), atkCost: 3 });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("d4")), "play", "Hit (cost 3 = X) revealed and played");
  assert.equal(zoneOf(g.engine, g.id("d3")), "deck", "Big4 (cost 4 > X) skipped");
  assert.equal(zoneOf(g.engine, g.id("d2")), "deck", "Big5 skipped");
});
clause(SURPRISE, "0:extraCost", "X follows the picked character: cost-1 attacker plays the first cost-1-or-less character; X=0 only admits cost 0; X=6 admits a cost-6 first card", () => {
  const g = surBoard({ deck: [mk("Two", 2), mk("Three", 3), mk("One", 1), mk("Zero", 0)], atkCost: 1 });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("d2")), "play", "One played");
  assert.equal(zoneOf(g.engine, g.id("d0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("d3")), "deck");
  const z = surBoard({ deck: [mk("One", 1), mk("Zero", 0), mk("Three", 3)], atkCost: 0 });
  attack(z);
  surCast(z);
  assert.equal(zoneOf(z.engine, z.id("d1")), "play", "X=0 only admits cost 0: Zero");
  assert.equal(zoneOf(z.engine, z.id("d0")), "deck");
  const big = surBoard({ deck: [mk("Six", 6), mk("Hit", 3), mk("Two", 2)], atkCost: 6 });
  attack(big);
  surCast(big);
  assert.equal(zoneOf(big.engine, big.id("d0")), "play", "X=6: the very first card (cost 6) qualifies");
});
clause(SURPRISE, "1:rule", "reveals from the top until a character of cost X or less: non-characters (tactic, item) are skipped even though their cost fits", () => {
  const g = surBoard({ deck: [tactic({ name: "CheapT", cost: 0 }), item({ name: "CheapI", cost: 0 }), mk("Hit", 2)] as never, atkCost: 3 });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("d2")), "play");
  assert.equal(zoneOf(g.engine, g.id("d0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("d1")), "deck");
});
clause(SURPRISE, "1:rule", "only the first qualifying character is put into play; the rest of the deck stays in the deck", () => {
  const g = surBoard({ deck: deckOf() as never });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("d4")), "play");
  assert.equal(zoneOf(g.engine, g.id("d5")), "deck", "Cheap1 also qualifies but was never reached");
  assert.equal(zoneOf(g.engine, g.id("d6")), "deck");
  assert.equal(g.engine.state.players[P2].deck.length, 6, "7 deck cards - 1 played");
  assert.equal(charCount(g), 2, "Mine + Hit");
});
clause(SURPRISE, "1:rule", "the character enters play under your control, as a member of the blocking party", () => {
  const g = surBoard({ deck: deckOf() as never });
  attack(g);
  surCast(g);
  const hit = g.engine.state.cards[g.id("d4")];
  assert.equal(hit.zone, "play");
  assert.equal(hit.controllerId, P2);
  assert.equal(hit.ownerId, P2);
  assert.ok(battleOf(g.engine)!.blockingParty.includes(g.id("d4")), "in the blocking party");
  assert.ok(battleOf(g.engine)!.attackingParty.includes(g.id("atk")), "battleOf(g.engine)!.attackingParty.includes(g.id(\"atk\"))");
  assert.equal(battleOf(g.engine)!.blockingParty.includes(g.id("mine")), false, "Mine did not join");
});
clause(SURPRISE, "1:rule", "the new blocker takes the attacker's damage instead of the faction", () => {
  const g = surBoard({ deck: [mk("Hit", 3, { life: 4 })] });
  attack(g);
  const infl = g.engine.state.players[P2].influence;
  surCast(g);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, infl, "faction not damaged");
  assert.equal(g.engine.state.cards[g.id("d0")].damage, 2, "Hit took Atk's 2 strength");
});
clause(SURPRISE, "1:rule", "other revealed cards are shuffled into the deck: they return (the matched card does not) and the deck is shuffled", () => {
  const g = surBoard({ deck: deckOf() as never });
  attack(g);
  const before = deckSet(g);
  const callsBefore = g.calls.n;
  surCast(g);
  assert.ok(g.calls.n > callsBefore, "the deck was shuffled (random consumed)");
  const after = deckSet(g);
  assert.deepEqual(after, before.filter((c) => c !== g.id("d4")), "all revealed non-matches back in the deck, matched one gone");
  for (const k of ["d0", "d1", "d2", "d3"]) assert.equal(zoneOf(g.engine, g.id(k)), "deck");
});
clause(SURPRISE, "1:rule", "the shuffle really permutes: across seeds the deck order is not always the original order", () => {
  const orders = [0, 0.3, 0.99].map((r) => {
    const g = buildGame({
      playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
      turn: 1, activePlayerId: P1, random: () => r,
      cards: [
        { key: "sur", def: printing(SURPRISE), owner: P2, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", cost: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 3, P2),
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: i === 5 ? mk("Hit", 3) : tactic({ name: `T${i}` }), owner: P2, zone: "deck" as const }))
      ]
    });
    declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
    const orig = [...g.engine.state.players[P2].deck];
    play(g.engine, P2, g.id("sur"), { selected: { k: [g.id("atk")] } });
    return { orig: orig.filter((c) => c !== g.id("d5")), after: [...g.engine.state.players[P2].deck] };
  });
  assert.ok(orders.some((o) => o.orig.join() !== o.after.join()), "some seed reorders the 5 returned cards");
});
clause(SURPRISE, "1:rule", "no qualifying character: every card is revealed, none enters play, and all cards are shuffled back into the deck", () => {
  const g = surBoard({ deck: [tactic({ name: "TacT" }), item({ name: "ItemI" }), mk("Big5", 5), mk("Big4", 4)] as never, atkCost: 3 });
  attack(g);
  const before = deckSet(g);
  const callsBefore = g.calls.n;
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("sur")), "discard");
  assert.deepEqual(deckSet(g), before, "all four back in the deck");
  assert.ok(g.calls.n > callsBefore, "shuffled even though nothing was found");
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [], "no one joined the blocking party");
  assert.equal(charCount(g), 1, "only Mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
});
clause(SURPRISE, "1:rule", "an empty deck does nothing (no crash, no one joins)", () => {
  const g = surBoard({ deck: [] });
  attack(g);
  surCast(g);
  assert.equal(zoneOf(g.engine, g.id("sur")), "discard");
  assert.equal(g.engine.state.players[P2].deck.length, 0);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, []);
});
clause(SURPRISE, "1:rule", "the opponent's deck and the other cards are not touched", () => {
  const g = surBoard({ deck: deckOf() as never });
  attack(g);
  const oppDeck = [...g.engine.state.players[P1].deck];
  surCast(g);
  assert.deepEqual(g.engine.state.players[P1].deck, oppDeck);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
});
clause(SURPRISE, "1:rule", "the Surprise! character is only a member of the blocking party: the defender can still declare an extra blocker alongside it", () => {
  const g = surBoard({ deck: [mk("Hit", 3, { life: 4 })] });
  attack(g);
  surCast(g);
  declareBlockers(g.engine, P2, [g.id("mine")]);
  assert.ok(battleOf(g.engine)!.blockingParty.includes(g.id("d0")), "the Surprise! character is still in the blocking party");
  assert.ok(battleOf(g.engine)!.blockingParty.includes(g.id("mine")), "the extra blocker joined the blocking party");
});

// ---------------------------------------------------------------- Swollen Ostrich
const OSTRICH = "1d3f8057-5911-4f72-92b0-f42e653c0035"; // character rogue beast cost 3 [D][D] 2/3/2, TACTICAL, FLIP UP 1 [D][D]
const answerSel = (engine: SpoilsEngine, selected: CardInstanceId[]) => answerPending(engine, "chooserSelectsTarget", { selected });
const ostBoard = (res: CardPlacement[], o: { zone?: "hand" | "play"; faceDown?: boolean; extra?: CardPlacement[]; active?: PlayerId; owner?: PlayerId } = {}) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: (o.active ?? P1) === P1 ? 1 : 2, activePlayerId: o.active ?? P1, random: () => 0.3,
    cards: [
      { key: "o", def: printing(OSTRICH), owner: o.owner ?? P1, zone: o.zone ?? "hand", ...(o.faceDown ? { faceDown: true } : {}) },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "handc", def: character({ name: "HandC" }), owner: P1, zone: "hand" },
      ...res, ...(o.extra ?? [])
    ]
  });
type OstGame = ReturnType<typeof ostBoard>;
const stats = (g: OstGame, key: string) => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "speed"), g.engine.getStat(g.id(key), "life")];
const ostRes = () => [...bank("deception", 2, P1), ...bank("rage", 2, P1)];

clause(OSTRICH, "0:kw:TACTICAL", "has TACTICAL and printed cost 3, threshold [D][D], character, rogue, beast, 2 strength / 3 speed / 2 life", () => {
  const p = printing(OSTRICH);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "rogue", ["beast"], 3, "dd"]);
  const g = ostBoard(ostRes(), { zone: "play" });
  assert.ok(g.engine.getKeywords(g.id("o")).includes("tactical"), "g.engine.getKeywords(g.id(\"o\")).includes(\"tactical\")");
  assert.deepEqual(stats(g, "o"), [2, 3, 2]);
  assert.equal(g.engine.getKeywords(g.id("ally")).includes("tactical"), false, "control: an ordinary character is not tactical");
  const exact = ostBoard([...bank("deception", 2, P1), ...bank("rage", 1, P1)]);
  play(exact.engine, P1, exact.id("o"));
  answerSel(exact.engine, []);
  assert.equal(zoneOf(exact.engine, exact.id("o")), "play");
  assert.equal(ready(exact.engine, P1), 0, "exactly 3 paid");
  const short = ostBoard(bank("deception", 2, P1));
  refused(() => play(short.engine, P1, short.id("o")), "2 resources, cost 3", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("o")), "hand");
  const noIcon = ostBoard([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("o")), "one [D] icon short", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("o")), "hand");
});
clause(OSTRICH, "0:kw:TACTICAL", "TACTICAL: can be deployed in the opponent's response window (an ordinary character cannot)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      { key: "o", def: printing(OSTRICH), owner: P2, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" },
      ...bank("deception", 2, P2), ...bank("rage", 2, P2)
    ]
  });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  refused(() => play(g.engine, P2, g.id("plain")), "non-tactical character in a response window", /tactic|window|turn|priority|timing/i);
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  play(g.engine, P2, g.id("o"));
  assert.equal(zoneOf(g.engine, g.id("o")), "play", "tactical Ostrich deployed on the opponent's turn");
});
clause(OSTRICH, "1:rule", "on entering play the controller may pick a character; the pick gains 1 strength and 1 life (speed unchanged)", () => {
  const g = ostBoard(ostRes());
  play(g.engine, P1, g.id("o"));
  const pc = g.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Ostrich's controller makes the pick");
  refused(() => answerSel(g.engine, [g.id("ally"), g.id("foe")]), "only ONE character may be picked");
  answerSel(g.engine, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(g, "ally"), [2, 1, 4], "1+1 strength, speed 1, 3+1 life");
  assert.deepEqual(stats(g, "foe"), [1, 1, 3], "others untouched");
  assert.deepEqual(stats(g, "o"), [2, 3, 2], "the Ostrich itself untouched");
});
clause(OSTRICH, "1:rule", "any character can be picked: an opposing one, or the Ostrich itself", () => {
  const a = ostBoard(ostRes());
  play(a.engine, P1, a.id("o"));
  answerSel(a.engine, [a.id("foe")]);
  assert.deepEqual(stats(a, "foe"), [2, 1, 4]);
  assert.deepEqual(stats(a, "ally"), [1, 1, 3]);
  const b = ostBoard(ostRes());
  play(b.engine, P1, b.id("o"));
  answerSel(b.engine, [b.id("o")]);
  assert.deepEqual(stats(b, "o"), [3, 3, 3]);
});
clause(OSTRICH, "1:rule", "declining the pick (it is a \"may\") changes nothing", () => {
  const g = ostBoard(ostRes());
  play(g.engine, P1, g.id("o"));
  answerSel(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(g, "ally"), [1, 1, 3]);
  assert.deepEqual(stats(g, "foe"), [1, 1, 3]);
  assert.deepEqual(stats(g, "o"), [2, 3, 2]);
  assert.equal(zoneOf(g.engine, g.id("o")), "play");
});
clause(OSTRICH, "1:rule", "the pick must be a character: an item, or a character in hand, is refused", () => {
  for (const bad of ["gear", "handc"]) {
    const g = ostBoard(ostRes());
    play(g.engine, P1, g.id("o"));
    refused(() => answerSel(g.engine, [g.id(bad)]), `${bad} is not a character in play`);
    answerSel(g.engine, [g.id("ally")]);
    assert.deepEqual(stats(g, "ally"), [2, 1, 4], "positive control: a character is accepted");
  }
});
clause(OSTRICH, "1:rule", "the +1/+1 lasts this turn only", () => {
  const g = ostBoard(ostRes());
  play(g.engine, P1, g.id("o"));
  answerSel(g.engine, [g.id("ally")]);
  assert.deepEqual(stats(g, "ally"), [2, 1, 4]);
  endTurn(g.engine, P1);
  assert.deepEqual(stats(g, "ally"), [1, 1, 3], "gone after the turn");
});
clause(OSTRICH, "1:rule", "only when THIS card enters play: another character entering later does not prompt", () => {
  const g = ostBoard(ostRes(), { zone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(g.engine.state.pendingChoice, undefined, "the Ostrich in play does not trigger on someone else's arrival");
  assert.deepEqual(stats(g, "ally"), [1, 1, 3]);
});
clause(OSTRICH, "1:rule", "two Ostriches: each prompts once, on its own entry, and buffs only its own pick", () => {
  const g = ostBoard([...bank("deception", 2, P1), ...bank("rage", 4, P1)], {
    extra: [{ key: "o2", def: printing(OSTRICH), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("o"));
  answerSel(g.engine, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined, "no second prompt from the first one");
  play(g.engine, P1, g.id("o2"));
  answerSel(g.engine, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(g, "ally"), [3, 1, 5], "two buffs of +1/+1 stack");
});
clause(OSTRICH, "1:rule", "a flipped-up Ostrich also enters play, so its trigger fires", () => {
  const g = ostBoard([...bank("deception", 2, P1), ...bank("rage", 1, P1)], { zone: "play", faceDown: true });
  flip(g.engine, P1, g.id("o"));
  assert.equal(g.engine.state.cards[g.id("o")].faceDown, false);
  answerSel(g.engine, [g.id("ally")]);
  assert.deepEqual(stats(g, "ally"), [2, 1, 4]);
});
clause(OSTRICH, "2:flipUp", "FLIP UP costs 1, not its normal 3: Ostrich + two spent [D] banks flips with 0 other ready resources; with extra ready rage the payment is exactly 1 resource", () => {
  const solo = ostBoard([...spentD(P1, 2)], { zone: "play", faceDown: true });
  assert.equal(ready(solo.engine, P1), 1, "just the face-down Ostrich is ready");
  flip(solo.engine, P1, solo.id("o"));
  answerSel(solo.engine, []);
  assert.equal(solo.engine.state.cards[solo.id("o")].faceDown, false, "cost 1 paid by the Ostrich itself (CR 507.4b)");
  assert.equal(ready(solo.engine, P1), 0);
  const many = ostBoard([...spentD(P1, 2), ...bank("rage", 4, P1)], { zone: "play", faceDown: true });
  assert.equal(ready(many.engine, P1), 5);
  flip(many.engine, P1, many.id("o"));
  answerSel(many.engine, []);
  const left = ready(many.engine, P1);
  assert.ok(left === 3 || left === 4, `5 ready - 1 paid - (1 if the Ostrich was not the payer) = 3 or 4, got ${left}`);
});
clause(OSTRICH, "2:flipUp", "FLIP UP threshold [D][D]: two [D] icons work, one [D] is refused", () => {
  const ok = ostBoard([...bank("deception", 2, P1)], { zone: "play", faceDown: true });
  flip(ok.engine, P1, ok.id("o"));
  answerSel(ok.engine, []);
  assert.equal(ok.engine.state.cards[ok.id("o")].faceDown, false);
  const bad = ostBoard([...bank("deception", 1, P1), ...bank("rage", 2, P1)], { zone: "play", faceDown: true });
  refused(() => flip(bad.engine, P1, bad.id("o")), "one [D] icon", /threshold|icon/i);
  assert.equal(bad.engine.state.cards[bad.id("o")].faceDown, true);
});
clause(OSTRICH, "2:flipUp", "the Ostrich's own [D] icons do not count toward its FLIP UP threshold (own + one [D] bank is refused)", () => {
  const g = ostBoard([...bank("deception", 1, P1), ...bank("rage", 2, P1)], { zone: "play", faceDown: true });
  refused(() => flip(g.engine, P1, g.id("o")), "own icon cannot count", /threshold|icon/i);
  assert.equal(g.engine.state.cards[g.id("o")].faceDown, true);
});
clause(OSTRICH, "2:flipUp", "the Ostrich may help pay for its own FLIP UP (Ostrich + two [D] banks only)", () => {
  const g = ostBoard(bank("deception", 2, P1), { zone: "play", faceDown: true });
  flip(g.engine, P1, g.id("o"));
  answerSel(g.engine, []);
  assert.equal(g.engine.state.cards[g.id("o")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("o")].faceDown, false);
});
clause(OSTRICH, "2:flipUp", "a flipped-up Ostrich is a face-up character with its printed stats, no longer a resource", () => {
  const g = ostBoard(ostRes(), { zone: "play", faceDown: true });
  flip(g.engine, P1, g.id("o"));
  answerSel(g.engine, []);
  assert.deepEqual(g.engine.getCardTypes(g.id("o")), ["character"]);
  assert.deepEqual(stats(g, "o"), [2, 3, 2]);
  assert.equal(g.engine.isResource(g.id("o")), false);
});

// ---------------------------------------------------------------- Titillating Contortionist
const CONTORT = "52f7eb09-edd2-416f-aceb-3740219bff75"; // character rogue performer cost 4 [D][D] 2/4/3
const conBoard = (o: { res?: CardPlacement[]; aDepleted?: boolean; zone?: "hand" | "play" } = {}) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      { key: "con", def: printing(CONTORT), owner: P1, zone: o.zone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "ally2", def: character({ name: "Ally2", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "A", def: character({ name: "A", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play", depleted: o.aDepleted },
      { key: "B", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...(o.res ?? [])
    ]
  });
type ConGame = ReturnType<typeof conBoard>;
const conAttack = (g: ConGame, party = ["con"]) => declareAttackBy(g.engine, P1, party.map((k) => g.id(k)));

clause(CONTORT, "0:rule", "printed cost 4, threshold [D][D], character, rogue, performer, 2 strength / 4 speed / 3 life; cost and icons enforced", () => {
  const p = printing(CONTORT);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "rogue", ["performer"], 4, "dd"]);
  const g = conBoard({ zone: "play" });
  assert.deepEqual([g.engine.getStat(g.id("con"), "strength"), g.engine.getStat(g.id("con"), "speed"), g.engine.getStat(g.id("con"), "life")], [2, 4, 3]);
  const ok = conBoard({ zone: "hand", res: [...bank("deception", 2, P1), ...bank("rage", 3, P1)] });
  play(ok.engine, P1, ok.id("con"));
  assert.equal(zoneOf(ok.engine, ok.id("con")), "play");
  assert.equal(ready(ok.engine, P1), 1, "exactly 4 of 5 paid");
  const short = conBoard({ zone: "hand", res: [...bank("deception", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => play(short.engine, P1, short.id("con")), "3 resources, cost 4", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("con")), "hand");
  const noIcon = conBoard({ zone: "hand", res: [...bank("deception", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("con")), "one [D] short", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("con")), "hand");
});
clause(CONTORT, "0:rule", "when it attacks, its controller may pick a character; the picked character must block it if it can: blocking with only another character is refused", () => {
  const g = conBoard();
  conAttack(g);
  const pc = g.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Contortionist's controller makes the pick");
  refused(() => answerSel(g.engine, [g.id("A"), g.id("B")]), "only ONE character may be picked");
  answerSel(g.engine, [g.id("A")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("B")]), "A must block, B alone is not enough", /must block|forced|required|block/i);
  declareBlockers(g.engine, P2, [g.id("A")]);
  assert.ok(battleOf(g.engine)!.blockingParty.includes(g.id("A")), "battleOf(g.engine)!.blockingParty.includes(g.id(\"A\"))");
});
clause(CONTORT, "0:rule", "the picked character blocking together with another is fine; declaring no blockers is refused", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("A"), g.id("B")]);
  assert.deepEqual([...battleOf(g.engine)!.blockingParty].sort(), [g.id("A"), g.id("B")].sort());
  const h = conBoard();
  conAttack(h);
  answerSel(h.engine, [h.id("A")]);
  refused(() => declareBlockers(h.engine, P2, []), "A must block: declaring no blockers is refused", /must block|forced|required|block/i);
});
clause(CONTORT, "0:rule", "declining the pick: nothing is forced, the defender may block with anyone or no one", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  declareBlockers(g.engine, P2, [g.id("B")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("B")]);
  const h = conBoard();
  conAttack(h);
  answerSel(h.engine, []);
  declareBlockers(h.engine, P2, []);
  assert.deepEqual(battleOf(h.engine)!.blockingParty, []);
});
clause(CONTORT, "0:rule", "\"if it can\": a picked character that cannot block (depleted) is not required to; others may block instead", () => {
  const g = conBoard({ aDepleted: true });
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("B")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("B")]);
  const h = conBoard({ aDepleted: true });
  conAttack(h);
  answerSel(h.engine, [h.id("A")]);
  declareBlockers(h.engine, P2, []);
  assert.deepEqual(battleOf(h.engine)!.blockingParty, []);
});
clause(CONTORT, "0:rule", "any character can be picked, including one of your own (which then simply isn't a blocker); an item cannot be picked", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("ally")]);
  declareBlockers(g.engine, P2, [g.id("B")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("B")], "the opponent is unconstrained");
  const h = conBoard();
  conAttack(h);
  refused(() => answerSel(h.engine, [h.id("gear")]), "an item is not a character");
  answerSel(h.engine, [h.id("A")]);
  refused(() => declareBlockers(h.engine, P2, [h.id("B")]), "positive control: picking A forces A");
});
clause(CONTORT, "0:rule", "only when THIS card attacks: another character attacking alone (Contortionist idle) does not prompt", () => {
  const g = conBoard();
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  declareBlockers(g.engine, P2, [g.id("B")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("B")]);
});
clause(CONTORT, "0:rule", "it also triggers when the Contortionist attacks as part of a party; the picked character must block that party", () => {
  const g = conBoard();
  conAttack(g, ["con", "ally"]);
  answerSel(g.engine, [g.id("A")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("B")]), "A must block the party", /must block|forced|required|block/i);
  declareBlockers(g.engine, P2, [g.id("A")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("A")]);
});
clause(CONTORT, "0:rule", "\"this turn\": the requirement is gone on the next turn (the picked character may skip blocking another attacker)", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("A")]);
  finishBattle(g.engine);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  declareBlockers(g.engine, P2, []);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [], "A no longer must block");
});
clause(CONTORT, "0:rule", "the requirement is about THIS card: a later battle by another attacker the same turn does not force the picked character", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("A")]);
  finishBattle(g.engine);
  g.engine.state.cards[g.id("A")].depleted = false;
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  declareBlockers(g.engine, P2, []);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [], "A is free to ignore Ally's attack");
});

// ---------------------------------------------------------------- Underhanded Gamer
const GAMER = "8bed01de-3627-4ae9-92dc-fc065e9e5de7"; // character rogue gambler cost 5 [D] 3/3/3; OUTSMART
const gamBoard = (o: { oppChars?: number; myExtra?: number; res?: CardPlacement[]; zone?: "hand" | "play"; oppItems?: number; oppFaceDown?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      { key: "g", def: printing(GAMER), owner: P1, zone: o.zone ?? "play" },
      ...Array.from({ length: o.myExtra ?? 0 }, (_, i) => ({ key: `my${i}`, def: character({ name: `My${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: o.oppChars ?? 0 }, (_, i) => ({ key: `op${i}`, def: character({ name: `Op${i}`, life: 9 }), owner: P2, zone: "play" as const })),
      ...Array.from({ length: o.oppItems ?? 0 }, (_, i) => ({ key: `it${i}`, def: item({ name: `It${i}` }), owner: P2, zone: "play" as const })),
      ...Array.from({ length: o.oppFaceDown ?? 0 }, (_, i) => ({ key: `fd${i}`, def: character({ name: `Fd${i}` }), owner: P2, zone: "play" as const, faceDown: true })),
      ...(o.res ?? bank("rage", 3, P1))
    ]
  });
const outsmart = (g: ReturnType<typeof gamBoard>) => activate(g.engine, P1, g.id("g"), "outsmart");
const NOT_USABLE = /condition|only if|more|requirement|cannot|unavailable|not found|usable/i;

clause(GAMER, "0:ability:outsmart", "printed cost 5, threshold [D], character, rogue, gambler, 3 strength / 3 speed / 3 life; cost and icon enforced", () => {
  const p = printing(GAMER);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "rogue", ["gambler"], 5, "d"]);
  const g = gamBoard();
  assert.deepEqual([g.engine.getStat(g.id("g"), "strength"), g.engine.getStat(g.id("g"), "speed"), g.engine.getStat(g.id("g"), "life")], [3, 3, 3]);
  const ok = gamBoard({ zone: "hand", res: [...bank("deception", 1, P1), ...bank("rage", 4, P1)] });
  play(ok.engine, P1, ok.id("g"));
  assert.equal(zoneOf(ok.engine, ok.id("g")), "play");
  assert.equal(ready(ok.engine, P1), 0, "exactly 5 paid");
  const short = gamBoard({ zone: "hand", res: [...bank("deception", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => play(short.engine, P1, short.id("g")), "4 resources, cost 5", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("g")), "hand");
  const noIcon = gamBoard({ zone: "hand", res: bank("rage", 5, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("g")), "no [D]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("g")), "hand");
});
clause(GAMER, "0:ability:outsmart", "use only if an opponent controls MORE characters than you: 2 vs 1 works; 1 vs 1 and 0 vs 1 are refused", () => {
  const more = gamBoard({ oppChars: 2 });
  outsmart(more);
  assert.equal(ready(more.engine, P1), 0, "paid 3");
  const eq = gamBoard({ oppChars: 1 });
  refused(() => outsmart(eq), "equal character counts", NOT_USABLE);
  assert.equal(ready(eq.engine, P1), 3, "nothing paid");
  const fewer = gamBoard({ oppChars: 0 });
  refused(() => outsmart(fewer), "opponent controls fewer", NOT_USABLE);
});
clause(GAMER, "0:ability:outsmart", "the count is of characters: your other characters offset it (2 vs 2 refused), opposing items and face-down resources do not add", () => {
  const offset = gamBoard({ oppChars: 2, myExtra: 1 });
  refused(() => outsmart(offset), "2 vs 2", NOT_USABLE);
  const items = gamBoard({ oppChars: 1, oppItems: 3, oppFaceDown: 2 });
  refused(() => outsmart(items), "1 character vs 1 (items and face-down cards are not characters)", NOT_USABLE);
  const edge = gamBoard({ oppChars: 3, myExtra: 1 });
  outsmart(edge);
  assert.equal(ready(edge.engine, P1), 0, "3 vs 2 works and pays 3");
});
clause(GAMER, "0:ability:outsmart", "costs exactly 3: 5 resources leave 2; 3 resources are all spent; 2 resources are refused", () => {
  const g = gamBoard({ oppChars: 2, res: bank("rage", 5, P1) });
  outsmart(g);
  assert.equal(ready(g.engine, P1), 2, "3 of 5 paid");
  const short = gamBoard({ oppChars: 2, res: bank("rage", 2, P1) });
  refused(() => outsmart(short), "cannot pay 3", /resource|afford|pay|cost/i);
  assert.equal(ready(short.engine, P1), 2);
});
clause(GAMER, "0:ability:outsmart", "this turn the Gamer cannot be blocked by the opponent: a block against it is refused and it hits the faction", () => {
  const g = gamBoard({ oppChars: 2 });
  outsmart(g);
  declareAttackBy(g.engine, P1, [g.id("g")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("op0")]), "unblockable", /block/i);
  declareBlockers(g.engine, P2, []);
  const infl = g.engine.state.players[P2].influence;
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, infl - 3, "unblocked: 3 damage to the faction");
});
clause(GAMER, "0:ability:outsmart", "cannot be blocked at all: not even a COVERT opposing character can block it", () => {
  const g = buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      { key: "g", def: printing(GAMER), owner: P1, zone: "play" },
      { key: "cov", def: character({ name: "Cov", life: 9, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "op1", def: character({ name: "Op1", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  activate(g.engine, P1, g.id("g"), "outsmart");
  declareAttackBy(g.engine, P1, [g.id("g")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("cov")]), "covert blocker still cannot block an unblockable Gamer", /block/i);
  refused(() => declareBlockers(g.engine, P2, [g.id("op1")]), "plain blocker cannot either", /block/i);
});
clause(GAMER, "0:ability:outsmart", "without OUTSMART the same attack can be blocked (control)", () => {
  const g = gamBoard({ oppChars: 2 });
  declareAttackBy(g.engine, P1, [g.id("g")]);
  declareBlockers(g.engine, P2, [g.id("op0")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("op0")]);
});
clause(GAMER, "0:ability:outsmart", "only the Gamer is unblockable: a party with another (blockable) character can still be blocked", () => {
  const g = gamBoard({ oppChars: 3, myExtra: 1 });
  outsmart(g);
  declareAttackBy(g.engine, P1, [g.id("g"), g.id("my0")]);
  declareBlockers(g.engine, P2, [g.id("op0")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("op0")]);
});
clause(GAMER, "0:ability:outsmart", "the effect ends with the turn: next turn the Gamer can be blocked again", () => {
  const g = gamBoard({ oppChars: 2 });
  outsmart(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  declareAttackBy(g.engine, P1, [g.id("g")]);
  declareBlockers(g.engine, P2, [g.id("op0")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("op0")]);
});

// ---------------------------------------------------------------- Vast Mastabatorium
const MAST = "6f8bd62f-fdaa-49b6-8de8-d66c0ec28437"; // location rogue cost 2 [D][D] structure 4
type MastOpts = { res?: CardPlacement[]; tokens?: number; zone?: "hand" | "play"; extra?: CardPlacement[]; p2res?: number };
const mastBoard = (o: MastOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
    turn: 1, activePlayerId: P1, random: () => 0.3,
    cards: [
      { key: "loc", def: printing(MAST), owner: P1, zone: o.zone ?? "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      ...Array.from({ length: 8 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `ek${i}`, def: character({ name: `Ek${i}` }), owner: P2, zone: "deck" as const })),
      ...(o.res ?? bank("rage", 6, P1)),
      ...bank("rage", o.p2res ?? 3, P2),
      ...(o.extra ?? [])
    ]
  });
type MastGame = ReturnType<typeof mastBoard>;
const ykywtw = (g: MastGame, p: PlayerId = P1) => activate(g.engine, p, g.id("loc"), "you-know-you-want-to");
const sweet = (g: MastGame, p: PlayerId = P1) => activate(g.engine, p, g.id("loc"), "sweet-release");
const infl = (g: MastGame, p: PlayerId) => g.engine.state.players[p].influence;
const resCard = (name = "Res") => resourceCard({ name, cost: 0 });
const LIMIT = /can be used only|each turn/i;
const NOT_MINE = /control|not found|owner|usable|unavailable/i;

clause(MAST, "0:ability:you-know-you-want-to", "printed cost 2, threshold [D][D], location, rogue, structure 4; cost and icons enforced", () => {
  const p = printing(MAST);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["location", "rogue", 2, "dd"]);
  const s = mastBoard();
  assert.equal(s.engine.getStat(s.id("loc"), "structure"), 4);
  const g = mastBoard({ zone: "hand", res: [...spentD(P1, 2), ...bank("rage", 2, P1)] });
  play(g.engine, P1, g.id("loc"));
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(ready(g.engine, P1), 0, "exactly 2 paid");
  const short = mastBoard({ zone: "hand", res: [...spentD(P1, 2), ...bank("rage", 1, P1)] });
  refused(() => play(short.engine, P1, short.id("loc")), "1 ready resource, cost 2", /resource|afford|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("loc")), "hand");
  const noIcon = mastBoard({ zone: "hand", res: [...spentD(P1, 1), ...bank("rage", 3, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("loc")), "one [D] icon short", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("loc")), "hand");
});
clause(MAST, "0:ability:you-know-you-want-to", "pays exactly 1 resource, inflicts 1 damage to your own faction only, and draws exactly the top card", () => {
  const g = mastBoard();
  const top = g.engine.state.players[P1].deck[0];
  const oppInfl = infl(g, P2);
  const hand = g.engine.state.players[P1].hand.length;
  ykywtw(g);
  assert.equal(ready(g.engine, P1), 5, "1 of 6 paid");
  assert.equal(infl(g, P1), 29, "1 damage to my faction");
  assert.equal(infl(g, P2), oppInfl, "opponent faction untouched");
  assert.equal(g.engine.state.players[P1].hand.length, hand + 1);
  assert.ok(g.engine.state.players[P1].hand.includes(top), "the top card was drawn");
  assert.equal(g.engine.state.players[P2].hand.length, 0);
});
clause(MAST, "0:ability:you-know-you-want-to", "needs a resource to pay: with none ready it is refused and nothing else happens", () => {
  const g = mastBoard({ res: [] });
  refused(() => ykywtw(g), "no resource for Pay 1", /resource|afford|pay|cost/i);
  assert.equal(infl(g, P1), 30);
  assert.equal(g.engine.state.players[P1].hand.length, 0);
  const ok = mastBoard({ res: bank("rage", 1, P1) });
  ykywtw(ok);
  assert.equal(ok.engine.state.players[P1].hand.length, 1);
});
clause(MAST, "0:ability:you-know-you-want-to", "usable 5 times each turn: five uses work (5 cards, 5 damage), the sixth is refused", () => {
  const g = mastBoard();
  for (let i = 0; i < 5; i++) ykywtw(g);
  assert.equal(g.engine.state.players[P1].hand.length, 5);
  assert.equal(infl(g, P1), 25);
  assert.equal(ready(g.engine, P1), 1);
  refused(() => ykywtw(g), "sixth use this turn", LIMIT);
  assert.equal(g.engine.state.players[P1].hand.length, 5);
  assert.equal(infl(g, P1), 25);
  assert.equal(ready(g.engine, P1), 1, "the refused use paid nothing");
});
clause(MAST, "0:ability:you-know-you-want-to", "at the end of the turn it gets a token and the opponent takes control; not before", () => {
  const g = mastBoard();
  ykywtw(g);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P1, "still mine during the turn");
  assert.equal(tokensOn(g.engine, g.id("loc")), 0);
  endTurn(g.engine, P1);
  assert.equal(tokensOn(g.engine, g.id("loc")), 1);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P2, "the opponent controls it");
  assert.equal(g.engine.state.cards[g.id("loc")].ownerId, P1, "ownership unchanged");
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
});
clause(MAST, "0:ability:you-know-you-want-to", "without using it nothing happens at the end of the turn", () => {
  const g = mastBoard();
  endTurn(g.engine, P1);
  assert.equal(tokensOn(g.engine, g.id("loc")), 0);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P1);
});
clause(MAST, "0:ability:you-know-you-want-to", "each use puts its own token: three uses leave three tokens", () => {
  const g = mastBoard();
  for (let i = 0; i < 3; i++) ykywtw(g);
  endTurn(g.engine, P1);
  assert.equal(tokensOn(g.engine, g.id("loc")), 3);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P2);
});
clause(MAST, "0:ability:you-know-you-want-to", "the new controller can use it (the old one cannot); the limit is per turn and the location comes back at the end of their turn", () => {
  const g = mastBoard();
  ykywtw(g);
  endTurn(g.engine, P1);
  refused(() => ykywtw(g, P1), "P1 no longer controls it", NOT_MINE);
  const p2Hand = g.engine.state.players[P2].hand.length;
  const p2Infl = infl(g, P2);
  ykywtw(g, P2);
  assert.equal(g.engine.state.players[P2].hand.length, p2Hand + 1, "P2 drew");
  assert.equal(infl(g, P2), p2Infl - 1, "P2's faction took the damage");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P1, "back with P1 (the opponent of P2)");
  assert.equal(tokensOn(g.engine, g.id("loc")), 2);
  for (let i = 0; i < 5; i++) ykywtw(g, P1);
  refused(() => ykywtw(g, P1), "limit is 5 per turn again, then refused", LIMIT);
});

clause(MAST, "1:ability:sweet-release", "pays exactly 2 and removes one token (2 tokens -> 1)", () => {
  const g = mastBoard({ tokens: 2, res: bank("rage", 4, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  sweet(g);
  answerSel(g.engine, []);
  assert.equal(ready(g.engine, P1), 2, "2 of 4 paid");
  assert.equal(tokensOn(g.engine, g.id("loc")), 1);
  assert.equal(g.engine.state.cards[g.id("loc")].zone, "play");
});
clause(MAST, "1:ability:sweet-release", "needs a token: with none it is refused (nothing paid), with one it works and leaves none", () => {
  const none = mastBoard({ tokens: 0, res: bank("rage", 4, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  refused(() => sweet(none), "no token to remove", /token|counter|cost|pay/i);
  assert.equal(ready(none.engine, P1), 4);
  const one = mastBoard({ tokens: 1, res: bank("rage", 4, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  sweet(one);
  answerSel(one.engine, []);
  assert.equal(tokensOn(one.engine, one.id("loc")), 0);
});
clause(MAST, "1:ability:sweet-release", "needs 2 resources: one ready resource is refused and the token stays", () => {
  const short = mastBoard({ tokens: 1, res: bank("rage", 1, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  refused(() => sweet(short), "only 1 ready resource", /resource|afford|pay|cost/i);
  assert.equal(tokensOn(short.engine, short.id("loc")), 1);
  assert.equal(ready(short.engine, P1), 1);
});
clause(MAST, "1:ability:sweet-release", "you may play a resource from hand: it enters play as a resource under your control; the rest of the hand stays", () => {
  const g = mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [
    { key: "r1", def: resCard("Res1"), owner: P1, zone: "hand" },
    { key: "r2", def: resCard("Res2"), owner: P1, zone: "hand" }
  ] });
  sweet(g);
  assert.equal((g.engine.state.pendingChoice as unknown as { playerId: PlayerId }).playerId, P1, "the controller chooses");
  refused(() => answerSel(g.engine, [g.id("r1"), g.id("r2")]), "only ONE resource may be played");
  answerSel(g.engine, [g.id("r1")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
  assert.equal(g.engine.isResource(g.id("r1")), true);
  assert.equal(g.engine.state.cards[g.id("r1")].controllerId, P1);
  assert.equal(zoneOf(g.engine, g.id("r2")), "hand", "only one resource is played");
  assert.equal(ready(g.engine, P1), 2, "3 - 2 paid + 1 new ready resource");
});
clause(MAST, "1:ability:sweet-release", "declining the \"may\" plays nothing, but the costs are still paid", () => {
  const g = mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  sweet(g);
  answerSel(g.engine, []);
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand");
  assert.equal(ready(g.engine, P1), 1);
  assert.equal(tokensOn(g.engine, g.id("loc")), 0);
});
const sweetBoard = () => mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [
  { key: "r1", def: resCard(), owner: P1, zone: "hand" },
  { key: "chr", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
  { key: "rdeck", def: resCard("DeckRes"), owner: P1, zone: "deck" },
  { key: "orr", def: resCard("OppRes"), owner: P2, zone: "hand" }
] });
clause(MAST, "1:ability:sweet-release", "only your own hand resource can be played: a resource in the deck or in the opponent's hand is refused", () => {
  for (const bad of ["rdeck", "orr"]) {
    const g = sweetBoard();
    sweet(g);
    refused(() => answerSel(g.engine, [g.id(bad)]), `${bad} is not a resource in your hand`);
    answerSel(g.engine, [g.id("r1")]);
    assert.equal(zoneOf(g.engine, g.id("r1")), "play", "control: the hand resource works");
    assert.notEqual(zoneOf(g.engine, g.id(bad)), "play");
  }
});
clause(MAST, "1:ability:sweet-release", "any card in hand may be played as a resource, face-down (CR 203.2): a character card is accepted and ends in play face-down", () => {
  const g = sweetBoard();
  sweet(g);
  answerSel(g.engine, [g.id("chr")]);
  assert.equal(zoneOf(g.engine, g.id("chr")), "play", "the character card was played as a resource");
  assert.equal(g.engine.state.cards[g.id("chr")].faceDown, true, "only a face-down resource: it is a Volition resource, not a character");
});
clause(MAST, "1:ability:sweet-release", "the player can choose to play the resource face-down (like any resource play)", () => holdResourceFace(() => {
  const g = mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  sweet(g);
  const pc = g.engine.state.pendingChoice as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  answerSel(g.engine, [g.id("r1")]);
  const after = g.engine.state.pendingChoice as unknown as { kind: string } | undefined;
  // A real resource can be played face-up or face-down; the engine must offer the face-down choice.
  assert.ok(after !== undefined || g.engine.state.cards[g.id("r1")].faceDown === true, "face-down must be a choosable outcome");
}));
clause(MAST, "1:ability:sweet-release", "usable by the new controller after the opponent took it (full flow), using their own hand", () => {
  const g = mastBoard({ extra: [{ key: "r2", def: resCard("P2Res"), owner: P2, zone: "hand" }, { key: "r1", def: resCard("P1Res"), owner: P1, zone: "hand" }] });
  ykywtw(g);
  endTurn(g.engine, P1);
  refused(() => sweet(g, P1), "P1 no longer controls it", NOT_MINE);
  sweet(g, P2);
  answerSel(g.engine, [g.id("r2")]);
  assert.equal(zoneOf(g.engine, g.id("r2")), "play");
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand");
  assert.equal(tokensOn(g.engine, g.id("loc")), 0);
  assert.equal(g.engine.state.cards[g.id("loc")].controllerId, P2, "control does not change from Sweet Release");
});

// ---------------------------------------------------------------- T3c7 behavior-mutation pass
clause(SPRINT, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: SPRINT, type: "tactic", subtype: [] });
});
clause(STRANGULATE, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: STRANGULATE, type: "tactic", subtype: [] });
});
clause(SURPRISE, "0:extraCost", "printed subtype: a tactic with no subtype", () => {
  printedStats({ id: SURPRISE, type: "tactic", subtype: [] });
});
clause(MAST, "0:ability:you-know-you-want-to", "printed subtype and structure: a location with no subtype and 4 structure", () => {
  printedStats({ id: MAST, type: "location", subtype: [], structure: 4 });
});

clause(SURPRISE, "0:extraCost", "the attacker pick is required: casting with nobody picked while a character attacks is refused (nothing paid, nothing revealed)", () => {
  const g = surBoard({ deck: deckOf() });
  attack(g);
  const before = ready(g.engine, P2);
  const deck = [...g.engine.state.players[P2].deck];
  refused(() => play(g.engine, P2, g.id("sur"), { selected: { k: [] } }), "no attacker picked");
  assert.equal(zoneOf(g.engine, g.id("sur")), "hand", "Surprise! stays in hand");
  assert.equal(ready(g.engine, P2), before, "nothing was paid");
  assert.deepEqual(g.engine.state.players[P2].deck, deck, "nothing was revealed from the deck");
  surCast(g);
  assert.notEqual(zoneOf(g.engine, g.id("sur")), "hand", "control: with the attacker picked it is cast");
});

clause(CONTORT, "0:rule", "\"this turn\": the requirement survives the battle - when it attacks again the same turn (and declines the new pick) the first pick must still block it", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("A")]);
  finishBattle(g.engine);
  g.engine.state.cards[g.id("con")].depleted = false;
  g.engine.state.cards[g.id("A")].depleted = false;
  conAttack(g);
  answerSel(g.engine, []);
  refused(() => declareBlockers(g.engine, P2, []), "A is still required to block this card this turn");
  declareBlockers(g.engine, P2, [g.id("A")]);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [g.id("A")], "control: blocking with A is fine");
});

clause(CONTORT, "0:rule", "\"this turn\": on the next turn the picked character is no longer bound to block the Contortionist (it declines the new pick)", () => {
  const g = conBoard();
  conAttack(g);
  answerSel(g.engine, [g.id("A")]);
  declareBlockers(g.engine, P2, [g.id("A")]);
  finishBattle(g.engine);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  conAttack(g);
  answerSel(g.engine, []);
  declareBlockers(g.engine, P2, []);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [], "A no longer must block the Contortionist");
});

clause(GAMER, "0:ability:outsmart", "\"this turn\": it stays unblockable in a second battle the same turn, not only until the end of the first battle", () => {
  const g = gamBoard({ oppChars: 2 });
  outsmart(g);
  declareAttackBy(g.engine, P1, [g.id("g")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  g.engine.state.cards[g.id("g")].depleted = false;
  declareAttackBy(g.engine, P1, [g.id("g")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("op0")]), "still unblockable this turn", /block/i);
  declareBlockers(g.engine, P2, []);
  assert.deepEqual(battleOf(g.engine)!.blockingParty, [], "no blockers");
});

clause(MAST, "1:ability:sweet-release", "the resource is played face-up by default (a real resource card keeps its face), and face-down when I choose that", () => {
  const faceUp = mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
  sweet(faceUp);
  answerSel(faceUp.engine, [faceUp.id("r1")]);
  assert.equal(zoneOf(faceUp.engine, faceUp.id("r1")), "play");
  assert.equal(faceUp.engine.state.cards[faceUp.id("r1")].faceDown, false, "played face-up");
  holdResourceFace(() => {
    const g = mastBoard({ tokens: 1, res: bank("rage", 3, P1), extra: [{ key: "r1", def: resCard(), owner: P1, zone: "hand" }] });
    sweet(g);
    answerSel(g.engine, [g.id("r1")]);
    const pc = g.engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
    assert.equal(pc?.kind, "playResource", "I am asked whether to play it face-up or face-down");
    assert.equal(pc?.playerId, P1, "I choose");
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: true } } as never);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(g.engine.state.cards[g.id("r1")].faceDown, true, "played face-down when chosen");
  });
});
