// Clause tests, batch seed-saga-03, part p3 (groups 14-18, missing clauses only).
// Avuncular Merlion, Because God Said So!, Caboodling Gladhander, Caracal Morphnus, Ceremonious Groomer.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, play, tactic, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, finishBattle } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { developDraw, endTurn } from "./_turn.js";

const MERLION = "2e3ae3f8-e4a0-412e-94be-b9e74cf547a7"; // character banker merlion cost 9 "gg" 7/3/7 -- ETB 2 tokens; my char put into my discard from play: may pay 1 + remove token: put into play, deplete
const BGSS = "bcff21ed-8229-42ea-9492-7f2224c72892"; // tactic banker cost 2 "gg" -- EXTRA COST pick a blocking character; this turn +5 str +5 life
const GLAD = "32655b89-00e6-4a06-a187-3e987dd11954"; // character banker mau cost 7 "gg" 3/3/4 -- EXTRA COST may pick a character; ETB destroy it, its controller's faction gains influence = its strength
const CARACAL = "f5eefb68-b475-45a8-a615-4219a82f6e76"; // character banker seraphim,dragon cost 6 "g" 0/3/0 -- UNIQUE CARACAL; ETB 5 tokens; +1/+1 per token; draw N -> N tokens; MORPH remove 3 tokens: draw
const GROOMER = "8c2d6ec1-1920-4579-b25f-93828fe2f89e"; // character banker mau cost 3 "gg" 2/3/3 -- if destroyed, flip face-down under owner's control instead

const mk = (cards: CardPlacement[], active: PlayerId = P1, turn = 1) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 10 },
    playerB: { faction: developFaction(), influence: 10 },
    activePlayerId: active,
    turn,
    random: () => 0.5,
    cards
  });
type G = ReturnType<typeof mk>;
const ready = (engine: SpoilsEngine, p: PlayerId): number => readyResources(engine, p);
const spentG = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("greed", n, owner).map(p => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const influence = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const tokens = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].counters?.token ?? 0;
const discardOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].discard];

/** Printed cost / threshold as a body for a character: exact works (spent [G] help only the threshold), one short, one icon short, spent-only. */
function costBody(id: string, cost: number, thresh: number, extra: CardPlacement[] = []): () => void {
  return () => {
    const readyG = Math.min(cost, thresh);
    const readyR = cost - readyG;
    const spentGreed = thresh - readyG;
    const board = (g: number, r: number, s: number) =>
      mk([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...extra, ...bank("greed", g, P1), ...bank("rage", r, P1), ...spentG(s, P1)]);
    const go = (b: G) => {
      play(b.engine, P1, b.id("c"));
      drain(b.engine, declineAll);
    };
    const exact = board(readyG, readyR, spentGreed);
    assert.equal(exact.engine.getCardPlayability(P1, exact.id("c")).numericCost, cost, "printed cost");
    assert.equal(ready(exact.engine, P1), cost);
    go(exact);
    assert.equal(zoneOf(exact.engine, exact.id("c")), "play", "deployed");
    assert.equal(ready(exact.engine, P1), 0, `exactly ${cost} spent`);
    const short = readyR > 0 ? board(readyG, readyR - 1, spentGreed) : board(readyG - 1, 0, spentGreed + 1);
    refused(() => go(short), `one short of cost ${cost}`);
    assert.equal(zoneOf(short.engine, short.id("c")), "hand");
    assert.equal(ready(short.engine, P1), cost - 1, "nothing paid");
    const iconShort = board(readyG - 1, readyR + 1, spentGreed);
    refused(() => go(iconShort), `threshold needs ${thresh} [G]; one icon short`);
    assert.equal(zoneOf(iconShort.engine, iconShort.id("c")), "hand");
    const spentOnly = board(0, cost - 1, thresh);
    refused(() => go(spentOnly), "spent icons meet the threshold but cannot pay the cost");
    assert.equal(zoneOf(spentOnly.engine, spentOnly.id("c")), "hand");
  };
}

const statsBody = (id: string, subtype: string[], str: number, spd: number, life: number): (() => void) => () => {
  const g = mk([{ key: "c", def: printing(id), owner: P1, zone: "play" }]);
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["character"]);
  assert.deepEqual([...(g.engine.getDefinition(g.id("c")).subtype ?? [])], subtype);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), str);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), spd);
  assert.equal(g.engine.getStat(g.id("c"), "life"), life);
  const theirTurn = mk([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...bank("greed", 9, P1)], P2, 2);
  refused(() => play(theirTurn.engine, P1, theirTurn.id("c")), "a character on the opponent's turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("c")), "hand");
};

/** An item that destroys / moves a picked card of `type` when activated (ability "k"). */
const tool = (key: string, owner: PlayerId, kind: "destroy" | "hand" | "discard", from: "play" | "hand" = "play", type: "character" | "item" = "character"): CardPlacement => ({
  key,
  owner,
  zone: "play",
  def: item({
    name: `Tool ${key}`,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: from, type }, count: 1 }],
          effects: [kind === "destroy" ? { type: "destroy", target: { type: "selected", id: "t" } } : { type: "moveCard", target: { type: "selected", id: "t" }, to: kind }]
        }
      ]
    }
  } as never)
});
const use = (g: G, toolKey: string, target: string, p: PlayerId = P1): void => activate(g.engine, p, g.id(toolKey), "k", { selected: { t: [g.id(target)] } });
const cantrip = (key: string, owner: PlayerId, n: number): CardPlacement => ({
  key,
  owner,
  zone: "hand",
  def: tactic({ name: `Cantrip ${key}`, cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] } } as never)
});

// ============================================================================
// Avuncular Merlion
// ============================================================================
clause(MERLION, "0:rule", "costs 9 with [G][G]: exact works, one short / one icon short / spent-only refused", costBody(MERLION, 9, 2));
clause(MERLION, "0:rule", "is a 7/3/7 banker merlion character", statsBody(MERLION, ["merlion"], 7, 3, 7));
clause(MERLION, "0:rule", "enters play with exactly 2 tokens on it; another Merlion entering gets its own 2 and gives the first none", () => {
  const g = mk([
    { key: "m", def: printing(MERLION), owner: P1, zone: "hand" },
    { key: "m2", def: printing(MERLION), owner: P1, zone: "hand" },
    { key: "o", def: character({ name: "Other" }), owner: P1, zone: "hand" },
    ...bank("greed", 20, P1)
  ]);
  play(g.engine, P1, g.id("m"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("m")), "play");
  assert.equal(tokens(g.engine, g.id("m")), 2, "2 tokens");
  play(g.engine, P1, g.id("o"));
  drain(g.engine, declineAll);
  assert.equal(tokens(g.engine, g.id("m")), 2, "another character entering adds nothing to Merlion");
  assert.equal(tokens(g.engine, g.id("o")), 0, "and gets none itself");
  play(g.engine, P1, g.id("m2"));
  drain(g.engine, declineAll);
  assert.equal(tokens(g.engine, g.id("m2")), 2, "second Merlion has its own 2");
  assert.equal(tokens(g.engine, g.id("m")), 2, "first Merlion still has 2");
});

const merl = (extra: CardPlacement[] = [], banksN = 3, tok = 2): G =>
  mk([
    { key: "m", def: printing(MERLION), owner: P1, zone: "play", counters: { token: tok } },
    { key: "x", def: character({ name: "X", strength: 2, life: 3 }), owner: P1, zone: "play" },
    tool("k", P1, "destroy"),
    ...bank("greed", banksN, P1),
    ...extra
  ]);
/** Tries to pay; a refusal or no-op is fine, then declines whatever is still pending. */
const tryPay = (g: G): void => {
  try {
    answerPending(g.engine, "mayPay", { pay: true });
  } catch {
    /* refused */
  }
  if (pending(g.engine)?.kind === "mayPay") answerPending(g.engine, "mayPay", { pay: false });
};

clause(MERLION, "1:rule", "my character destroyed: its controller is offered the choice; paying 1 and a token puts it back into play under my control, depleted", () => {
  const g = merl();
  use(g, "k", "x");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "it is in the discard pile while the choice waits");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("x")), "play", "back in play");
  assert.equal(g.engine.state.cards[g.id("x")].controllerId, P1);
  assert.equal(g.engine.state.cards[g.id("x")].depleted, true, "Deplete it");
  assert.equal(ready(g.engine, P1), 2, "paid exactly 1");
  assert.equal(tokens(g.engine, g.id("m")), 1, "removed exactly one token from Merlion");
  assert.equal(tokens(g.engine, g.id("x")), 0);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("x")), "no longer in the discard pile");
  assert.equal(g.engine.getStat(g.id("x"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("x"), "life"), 3);
});
clause(MERLION, "1:rule", "declining the payment: nothing is paid, no token is removed, the character stays in the discard pile", () => {
  const g = merl();
  use(g, "k", "x");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(ready(g.engine, P1), 3);
  assert.equal(tokens(g.engine, g.id("m")), 2);
});
clause(MERLION, "1:rule", "declining the payment has no other consequence: nobody draws, hands, decks and influence stay as they were", () => {
  const g = merl(fillers("dk", 3, P1, "deck"));
  const snap = () => ({
    hands: [P1, P2].map((p) => g.engine.state.players[p].hand.length),
    decks: [P1, P2].map((p) => g.engine.state.players[p].deck.length),
    influence: [P1, P2].map((p) => g.engine.state.players[p].influence)
  });
  use(g, "k", "x");
  const before = snap();
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(snap(), before, "declining draws no card and changes nothing else");
});

clause(MERLION, "1:rule", "an unpayable cost (no resource, or no token) has no other consequence either: nobody draws, hands, decks and influence stay as they were", () => {
  for (const g of [merl(fillers("dk", 3, P1, "deck"), 0), merl(fillers("dk", 3, P1, "deck"), 3, 0)]) {
    const snap = () => ({
      hands: [P1, P2].map((p) => g.engine.state.players[p].hand.length),
      decks: [P1, P2].map((p) => g.engine.state.players[p].deck.length),
      influence: [P1, P2].map((p) => g.engine.state.players[p].influence)
    });
    use(g, "k", "x");
    const before = snap();
    tryPay(g);
    assert.equal(pending(g.engine), undefined);
    assert.deepEqual(snap(), before, "an unpaid trigger draws no card and changes nothing else");
  }
});

clause(MERLION, "1:rule", "with no resource to pay, the character is not returned and no token is removed", () => {
  const g = merl([], 0);
  use(g, "k", "x");
  tryPay(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(tokens(g.engine, g.id("m")), 2, "token cost not paid without the resource");
});
clause(MERLION, "1:rule", "with no token left, the character is not returned and the resource is not spent", () => {
  const g = merl([], 3, 0);
  use(g, "k", "x");
  tryPay(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(ready(g.engine, P1), 3, "resource not spent without the token");
  assert.equal(tokens(g.engine, g.id("m")), 0);
});
clause(MERLION, "1:rule", "each rescue costs one token: two rescues empty the 2 tokens and use 2 resources, a third cannot be paid", () => {
  const g = merl(
    [
      { key: "y", def: character({ name: "Y", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "z", def: character({ name: "Z", strength: 1, life: 1 }), owner: P1, zone: "play" }
    ],
    3
  );
  use(g, "k", "x");
  answerPending(g.engine, "mayPay", { pay: true });
  use(g, "k", "y");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(tokens(g.engine, g.id("m")), 0);
  assert.equal(ready(g.engine, P1), 1);
  assert.deepEqual([zoneOf(g.engine, g.id("x")), zoneOf(g.engine, g.id("y"))], ["play", "play"]);
  use(g, "k", "z");
  tryPay(g);
  assert.equal(zoneOf(g.engine, g.id("z")), "discard", "no token left for a third");
  assert.equal(ready(g.engine, P1), 1);
});
clause(MERLION, "1:rule", "the returned character enters play (its enters-play trigger fires)", () => {
  const etb = character({
    name: "Etb",
    strength: 1,
    life: 1,
    behavior: { abilities: [{ id: "e", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);
  const g = merl([{ key: "e", def: etb, owner: P1, zone: "play" }, ...fillers("dk", 5, P1, "deck")]);
  use(g, "k", "e");
  const handBefore = g.engine.state.players[P1].hand.length;
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("e")), "play");
  assert.equal(g.engine.state.players[P1].hand.length, handBefore + 1, "it entered play, so its enters-play trigger drew a card");
});
clause(MERLION, "1:rule", "an opponent's character destroyed does not trigger it", () => {
  const g = merl([{ key: "y", def: character({ name: "Y" }), owner: P2, zone: "play" }]);
  use(g, "k", "y");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("y")), "discard");
  assert.equal(tokens(g.engine, g.id("m")), 2);
  assert.equal(ready(g.engine, P1), 3);
});
clause(MERLION, "1:rule", "a destroyed item is not a character and does not trigger it", () => {
  const g = merl([{ key: "i", def: item({ name: "Gizmo" }), owner: P1, zone: "play" }, tool("ki", P1, "destroy", "play", "item")]);
  use(g, "ki", "i");
  assert.equal(zoneOf(g.engine, g.id("i")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("m")), 2);
});
clause(MERLION, "1:rule", "a character leaving play for my hand (not the discard pile) does not trigger it", () => {
  const g = merl([tool("kh", P1, "hand")]);
  use(g, "kh", "x");
  assert.equal(zoneOf(g.engine, g.id("x")), "hand");
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("m")), 2);
});
clause(MERLION, "1:rule", "a character put into the discard pile from my hand (not from play) does not trigger it", () => {
  const g = merl([tool("kd", P1, "discard", "hand"), { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" }]);
  use(g, "kd", "h");
  assert.equal(zoneOf(g.engine, g.id("h")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("m")), 2);
});
clause(MERLION, "1:rule", "a character moved from play to the discard pile by a non-destroy effect still triggers it (any move from play to the discard pile)", () => {
  const g = merl([tool("kd", P1, "discard", "play")]);
  use(g, "kd", "x");
  assert.equal(pending(g.engine)?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("x")), "play");
});
clause(MERLION, "1:rule", "a character I control but the opponent owns goes to THEIR discard pile, not mine: no trigger", () => {
  const g = merl([{ key: "s", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]);
  use(g, "k", "s");
  assert.equal(zoneOf(g.engine, g.id("s")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("s")), "in the opponent's discard pile");
  assert.equal(pending(g.engine), undefined, "not put into MY discard pile");
});
clause(MERLION, "1:rule", "my character controlled by the opponent is not 'a character you control': no trigger", () => {
  const g = merl([{ key: "s", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }]);
  use(g, "k", "s");
  assert.equal(zoneOf(g.engine, g.id("s")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("m")), 2);
});
clause(MERLION, "1:rule", "a character dying to lethal battle damage is offered to the controller and can be rescued", () => {
  const g = mk(
    [
      { key: "m", def: printing(MERLION), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "x", def: character({ name: "X", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A", strength: 4, life: 5 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ],
    P2,
    2
  );
  declareAttackBy(g.engine, P2, [g.id("a")]);
  declareBlockers(g.engine, P1, [g.id("x")]);
  finishBattle(g.engine, undefined, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("x")), "play", "rescued");
  assert.equal(tokens(g.engine, g.id("m")), 1);
  assert.equal(ready(g.engine, P1), 2);
});

// ============================================================================
// Because God Said So!
// ============================================================================
const bgBoard = (greed: number, rage: number, spent: number, over: { aLife?: number; attacker?: PlayerId; tOwner?: PlayerId } = {}): G => {
  const atk = over.attacker ?? P1;
  const def = atk === P1 ? P2 : P1;
  const to = over.tOwner ?? P1;
  const g = mk(
    [
      { key: "t", def: printing(BGSS), owner: to, zone: "hand" },
      { key: "a", def: character({ name: "Attacker", strength: 4, life: over.aLife ?? 9 }), owner: atk, zone: "play" },
      { key: "b1", def: character({ name: "Blocker One", strength: 1, life: 1 }), owner: def, zone: "play" },
      { key: "b2", def: character({ name: "Blocker Two", strength: 1, life: 1 }), owner: def, zone: "play" },
      { key: "z", def: character({ name: "Bystander", strength: 1, life: 1 }), owner: P2, zone: "play" },
      ...bank("greed", greed, to),
      ...bank("rage", rage, to),
      ...spentG(spent, to)
    ],
    atk,
    atk === P1 ? 1 : 2
  );
  declareAttackBy(g.engine, atk, [g.id("a")]);
  declareBlockers(g.engine, def, [g.id("b1")]);
  return g;
};
const bgPlay = (g: G, pick: string, p: PlayerId = P1): void => {
  play(g.engine, p, g.id("t"), { selected: { c: [g.id(pick)] } });
  finishBattle(g.engine);
};

clause(BGSS, "0:extraCost", "costs 2 with [G][G]: exact works (and is a tactic), one short / one icon short / spent-only refused", () => {
  const exact = bgBoard(2, 0, 0);
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("t")).numericCost, 2, "printed cost");
  assert.deepEqual(exact.engine.getCardTypes(exact.id("t")), ["tactic"]);
  bgPlay(exact, "b1");
  assert.equal(zoneOf(exact.engine, exact.id("t")), "discard");
  assert.equal(ready(exact.engine, P1), 0, "exactly 2 spent");
  assert.equal(exact.engine.getStat(exact.id("b1"), "strength"), 6, "it resolved");
  const short = bgBoard(1, 0, 1);
  refused(() => bgPlay(short, "b1"), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("t")), "hand");
  assert.equal(ready(short.engine, P1), 1, "nothing paid");
  const iconShort = bgBoard(1, 1, 0);
  refused(() => bgPlay(iconShort, "b1"), "needs [G][G]: one icon short");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("t")), "hand");
  const spentOnly = bgBoard(0, 1, 2);
  refused(() => bgPlay(spentOnly, "b1"), "spent icons give the threshold but cannot pay");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("t")), "hand");
});
clause(BGSS, "0:extraCost", "the pick must be a blocking character: the attacker, a bystander, no pick, no battle, or a blocker-to-be that has not blocked are refused; a blocker is fine", () => {
  const ok = bgBoard(2, 0, 0);
  bgPlay(ok, "b1");
  assert.equal(ok.engine.getStat(ok.id("b1"), "life"), 6, "a blocker is a legal pick");
  const atk = bgBoard(2, 0, 0);
  refused(() => bgPlay(atk, "a"), "the attacking character is not blocking");
  assert.equal(zoneOf(atk.engine, atk.id("t")), "hand");
  assert.equal(ready(atk.engine, P1), 2, "nothing paid");
  const idle = bgBoard(2, 0, 0);
  refused(() => bgPlay(idle, "b2"), "a character in play that did not block");
  assert.equal(zoneOf(idle.engine, idle.id("t")), "hand");
  const bystander = bgBoard(2, 0, 0);
  refused(() => bgPlay(bystander, "z"), "a character not in the battle");
  assert.equal(zoneOf(bystander.engine, bystander.id("t")), "hand");
  const unpicked = bgBoard(2, 0, 0);
  refused(() => play(unpicked.engine, P1, unpicked.id("t"), { selected: {} }), "no pick");
  assert.equal(zoneOf(unpicked.engine, unpicked.id("t")), "hand");
  const noBattle = mk([
    { key: "t", def: printing(BGSS), owner: P1, zone: "hand" },
    { key: "b1", def: character({ name: "B" }), owner: P2, zone: "play" },
    ...bank("greed", 2, P1)
  ]);
  refused(() => play(noBattle.engine, P1, noBattle.id("t"), { selected: { c: [noBattle.id("b1")] } }), "no battle, nobody is blocking");
  assert.equal(zoneOf(noBattle.engine, noBattle.id("t")), "hand");
  const unblocked = mk([
    { key: "t", def: printing(BGSS), owner: P1, zone: "hand" },
    { key: "a", def: character({ name: "A", strength: 4, life: 9 }), owner: P1, zone: "play" },
    { key: "b1", def: character({ name: "B" }), owner: P2, zone: "play" },
    ...bank("greed", 2, P1)
  ]);
  declareAttackBy(unblocked.engine, P1, [unblocked.id("a")]);
  refused(() => play(unblocked.engine, P1, unblocked.id("t"), { selected: { c: [unblocked.id("b1")] } }), "blockers not yet declared");
  assert.equal(zoneOf(unblocked.engine, unblocked.id("t")), "hand");
});
clause(BGSS, "0:extraCost", "either side's blocker can be picked: the attacker picks the opponent's blocker, the defender (after priority passes) picks their own", () => {
  const g = bgBoard(2, 0, 0, { tOwner: P2 });
  g.engine.perform({ type: "passPriority", playerId: P1 });
  bgPlay(g, "b1", P2);
  assert.equal(g.engine.getStat(g.id("b1"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("b1"), "life"), 6);
  assert.equal(ready(g.engine, P2), 0);
  const p2atk = bgBoard(2, 0, 0, { attacker: P2, tOwner: P2 });
  bgPlay(p2atk, "b1", P2);
  assert.equal(p2atk.engine.getStat(p2atk.id("b1"), "life"), 6, "attacker picks the defender's blocker");
  const p1def = bgBoard(2, 0, 0, { attacker: P2, tOwner: P1 });
  p1def.engine.perform({ type: "passPriority", playerId: P2 });
  bgPlay(p1def, "b1", P1);
  assert.equal(p1def.engine.getStat(p1def.id("b1"), "life"), 6, "defender picks their own blocker");
});

clause(BGSS, "1:rule", "the picked blocker gets +5 strength and +5 life this turn: survives lethal damage and its extra strength is dealt; unpicked blocker and the attacker are unchanged", () => {
  const g = bgBoard(2, 0, 0);
  const speed = g.engine.getStat(g.id("b1"), "speed");
  bgPlay(g, "b1");
  assert.equal(g.engine.getStat(g.id("b1"), "strength"), 6, "1 + 5");
  assert.equal(g.engine.getStat(g.id("b1"), "life"), 6, "1 + 5");
  assert.equal(g.engine.getStat(g.id("b1"), "speed"), speed, "speed unchanged");
  assert.equal(g.engine.getStat(g.id("a"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("a"), "life"), 9);
  assert.equal(g.engine.getStat(g.id("b2"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("b2"), "life"), 1);
  assert.equal(g.engine.getStat(g.id("z"), "strength"), 1);
  assert.equal(zoneOf(g.engine, g.id("b1")), "play", "4 damage < 6 life: it survives");
  assert.equal(g.engine.state.cards[g.id("b1")].damage, 4);
  assert.equal(g.engine.state.cards[g.id("a")].damage, 6, "it struck for 1 + 5");
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "6 < 9");
  const without = bgBoard(2, 0, 0);
  finishBattle(without.engine);
  assert.equal(zoneOf(without.engine, without.id("b1")), "discard", "control: without the tactic the 1-life blocker dies");
  assert.equal(without.engine.state.cards[without.id("a")].damage, 1, "control: it struck for 1");
});
clause(BGSS, "1:rule", "the strength bonus is exactly 5: a 6-life attacker dies to the blocker's 6, a 7-life attacker survives", () => {
  const g = bgBoard(2, 0, 0, { aLife: 6 });
  bgPlay(g, "b1");
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "6 damage >= 6 life");
  const g2 = bgBoard(2, 0, 0, { aLife: 7 });
  bgPlay(g2, "b1");
  assert.equal(zoneOf(g2.engine, g2.id("a")), "play", "6 damage < 7 life");
});
clause(BGSS, "1:rule", "with two blockers only the picked one gets the bonus", () => {
  const h = mk(
    [
      { key: "t", def: printing(BGSS), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "Attacker", strength: 4, life: 9 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "Blocker One", strength: 1, life: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Blocker Two", strength: 1, life: 1 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ],
    P1,
    1
  );
  declareAttackBy(h.engine, P1, [h.id("a")]);
  declareBlockers(h.engine, P2, [h.id("b1"), h.id("b2")]);
  bgPlay(h, "b2");
  assert.equal(h.engine.getStat(h.id("b2"), "strength"), 6);
  assert.equal(h.engine.getStat(h.id("b2"), "life"), 6);
  assert.equal(h.engine.getStat(h.id("b1"), "strength"), 1);
  assert.equal(h.engine.getStat(h.id("b1"), "life"), 1);
});
clause(BGSS, "1:rule", "the bonus lasts this turn only: still there at the end of the battle, gone once the turn is over", () => {
  const g = bgBoard(2, 0, 0);
  bgPlay(g, "b1");
  assert.equal(g.engine.getStat(g.id("b1"), "strength"), 6, "still this turn");
  assert.equal(g.engine.getStat(g.id("b1"), "life"), 6);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("b1"), "strength"), 1, "ended");
  assert.equal(g.engine.getStat(g.id("b1"), "life"), 1, "ended");
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("b1"), "strength"), 1, "and stays ended");
});

// ============================================================================
// Caboodling Gladhander
// ============================================================================
clause(GLAD, "0:extraCost", "costs 7 with [G][G]: exact works, one short / one icon short / spent-only refused", costBody(GLAD, 7, 2));
clause(GLAD, "0:extraCost", "is a 3/3/4 banker mau character", statsBody(GLAD, ["mau"], 3, 3, 4));

const glad = (extra: CardPlacement[] = [], banksN = 7): G =>
  mk([{ key: "g", def: printing(GLAD), owner: P1, zone: "hand" }, ...bank("greed", banksN, P1), ...extra]);
const gladPlay = (g: G, pick?: string[]): void => {
  play(g.engine, P1, g.id("g"), { selected: pick ? { c: pick.map(k => g.id(k)) } : {} });
  drain(g.engine, declineAll);
};
const buffed = (name: string, base: number, bonus: number) =>
  character({
    name,
    strength: base,
    life: 5,
    behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: bonus }] }] }
  } as never);

clause(GLAD, "0:extraCost", "the character pick is optional: with none, Gladhander enters, nothing is destroyed and nobody gains influence", () => {
  const g = glad([
    { key: "mine", def: character({ name: "Mine", strength: 4 }), owner: P1, zone: "play" },
    { key: "theirs", def: character({ name: "Theirs", strength: 6 }), owner: P2, zone: "play" }
  ]);
  gladPlay(g);
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(influence(g.engine, P1), 10);
  assert.equal(influence(g.engine, P2), 10);
  assert.equal(pending(g.engine), undefined);
});
clause(GLAD, "0:extraCost", "any character in play can be picked (either controller's); items, hand and discard cards, and two picks are refused with nothing paid", () => {
  const board = () =>
    glad([
      { key: "mine", def: character({ name: "Mine", strength: 4 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 6 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "indisc", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]);
  const a = board();
  gladPlay(a, ["theirs"]);
  assert.equal(zoneOf(a.engine, a.id("g")), "play", "opponent's character is a legal pick");
  const b = board();
  gladPlay(b, ["mine"]);
  assert.equal(zoneOf(b.engine, b.id("g")), "play", "my own character is a legal pick");
  for (const bad of [["it"], ["inhand"], ["indisc"], ["mine", "theirs"]]) {
    const c = board();
    refused(() => gladPlay(c, bad), `illegal pick ${bad.join("+")}`);
    assert.equal(zoneOf(c.engine, c.id("g")), "hand", "not played");
    assert.equal(ready(c.engine, P1), 7, "nothing paid");
  }
});
clause(GLAD, "1:rule", "picked an opponent's character: it is destroyed and the opponent's faction (not mine) gains its strength as influence; others are untouched", () => {
  const g = glad([
    { key: "theirs", def: character({ name: "Theirs", strength: 6, life: 2 }), owner: P2, zone: "play" },
    { key: "bystander", def: character({ name: "By", strength: 3 }), owner: P2, zone: "play" }
  ]);
  gladPlay(g, ["theirs"]);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard", "destroyed");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play", "only the picked one");
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
  assert.equal(influence(g.engine, P2), 16, "X = 6");
  assert.equal(influence(g.engine, P1), 10, "I gain nothing");
});
clause(GLAD, "1:rule", "picked my own character: it is destroyed and MY faction gains X (the picked character's controller)", () => {
  const g = glad([{ key: "mine", def: character({ name: "Mine", strength: 4 }), owner: P1, zone: "play" }]);
  gladPlay(g, ["mine"]);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(influence(g.engine, P1), 14);
  assert.equal(influence(g.engine, P2), 10);
});
clause(GLAD, "1:rule", "X is the picked character's current strength (printed + modifiers), read before it is destroyed; 0 strength gains 0", () => {
  const g = glad([{ key: "t", def: buffed("Buffed", 1, 2), owner: P2, zone: "play" }]);
  gladPlay(g, ["t"]);
  assert.equal(zoneOf(g.engine, g.id("t")), "discard");
  assert.equal(influence(g.engine, P2), 13, "1 + 2 = 3, not the printed 1");
  const z = glad([{ key: "t", def: character({ name: "Weak", strength: 0, life: 2 }), owner: P2, zone: "play" }]);
  gladPlay(z, ["t"]);
  assert.equal(zoneOf(z.engine, z.id("t")), "discard");
  assert.equal(influence(z.engine, P2), 10, "X = 0");
  const big = glad([{ key: "t", def: character({ name: "Big", strength: 9, life: 2 }), owner: P2, zone: "play" }]);
  gladPlay(big, ["t"]);
  assert.equal(influence(big.engine, P2), 19, "X = 9");
});
clause(GLAD, "1:rule", "a picked character controlled by one player but owned by the other: the controller's faction gains the influence", () => {
  const g = glad([{ key: "t", def: character({ name: "Lent", strength: 5 }), owner: P1, controller: P2, zone: "play" }]);
  gladPlay(g, ["t"]);
  assert.equal(zoneOf(g.engine, g.id("t")), "discard");
  assert.equal(influence(g.engine, P2), 15, "its controller (P2) gains X");
  assert.equal(influence(g.engine, P1), 10);
});

// ============================================================================
// Caracal Morphnus
// ============================================================================
const car = (extra: CardPlacement[] = [], tok = 5): G =>
  mk([{ key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: tok } }, ...fillers("dk", 8, P1, "deck"), ...extra]);

clause(CARACAL, "0:unique", "costs 6 with a single [G]: exact works, one short / icon short / spent-only refused", costBody(CARACAL, 6, 1));
clause(CARACAL, "0:unique", "is a 0/3/0 banker seraphim dragon character (before tokens)", statsBody(CARACAL, ["seraphim", "dragon"], 0, 3, 0));
clause(CARACAL, "0:unique", "a second Caracal entering for the same player: the controller chooses which to keep and the other is destroyed", () => {
  for (const keep of ["c1", "c2"] as const) {
    const g = mk([
      { key: "c1", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 5 } },
      { key: "c2", def: printing(CARACAL), owner: P1, zone: "hand" },
      ...bank("greed", 6, P1)
    ]);
    play(g.engine, P1, g.id("c2"));
    const pc = pending(g.engine);
    assert.equal(pc?.kind, "uniqueSurvivor");
    assert.equal(pc?.playerId, P1);
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id(keep) } } as never);
    drain(g.engine, declineAll);
    const gone = keep === "c1" ? "c2" : "c1";
    assert.equal(zoneOf(g.engine, g.id(keep)), "play", `${keep} kept`);
    assert.equal(zoneOf(g.engine, g.id(gone)), "discard", `${gone} destroyed`);
  }
});
clause(CARACAL, "0:unique", "the opponent controlling their own Caracal is fine; a different Unique identifier on my side is fine; any other card carrying UNIQUE CARACAL conflicts", () => {
  const opp = mk([
    { key: "o", def: printing(CARACAL), owner: P2, zone: "play", counters: { token: 5 } },
    { key: "c2", def: printing(CARACAL), owner: P1, zone: "hand" },
    ...bank("greed", 6, P1)
  ]);
  play(opp.engine, P1, opp.id("c2"));
  drain(opp.engine, declineAll);
  assert.equal(pending(opp.engine), undefined, "per player");
  assert.equal(zoneOf(opp.engine, opp.id("o")), "play");
  assert.equal(zoneOf(opp.engine, opp.id("c2")), "play");
  const other = mk([
    { key: "u", def: character({ name: "Other Unique", unique: "not-caracal" } as never), owner: P1, zone: "play" },
    { key: "c2", def: printing(CARACAL), owner: P1, zone: "hand" },
    ...bank("greed", 6, P1)
  ]);
  play(other.engine, P1, other.id("c2"));
  drain(other.engine, declineAll);
  assert.equal(pending(other.engine), undefined, "different identifier");
  assert.equal(zoneOf(other.engine, other.id("u")), "play");
  const same = mk([
    { key: "u", def: character({ name: "Other Caracal", unique: "caracal" } as never), owner: P1, zone: "play" },
    { key: "c2", def: printing(CARACAL), owner: P1, zone: "hand" },
    ...bank("greed", 6, P1)
  ]);
  play(same.engine, P1, same.id("c2"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor", "same identifier, different card");
});

clause(CARACAL, "1:rule", "entering play puts exactly 5 tokens on it (5/3/5); another character entering adds none", () => {
  const g = mk([
    { key: "c", def: printing(CARACAL), owner: P1, zone: "hand" },
    { key: "o", def: character({ name: "Other" }), owner: P1, zone: "hand" },
    ...bank("greed", 12, P1)
  ]);
  play(g.engine, P1, g.id("c"));
  drain(g.engine, declineAll);
  assert.equal(tokens(g.engine, g.id("c")), 5);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), 3);
  play(g.engine, P1, g.id("o"));
  drain(g.engine, declineAll);
  assert.equal(tokens(g.engine, g.id("c")), 5);
  assert.equal(tokens(g.engine, g.id("o")), 0);
});
clause(CARACAL, "2:rule", "gains 1 strength and 1 life per token on it, no speed; tokens on other cards and other counters don't count", () => {
  for (const n of [0, 1, 5, 8]) {
    const g = car([], n);
    assert.equal(g.engine.getStat(g.id("c"), "strength"), n, `${n} tokens: strength`);
    assert.equal(g.engine.getStat(g.id("c"), "life"), n, `${n} tokens: life`);
    assert.equal(g.engine.getStat(g.id("c"), "speed"), 3);
  }
  const g = car([{ key: "o", def: character({ name: "Other", strength: 1, life: 1 }), owner: P1, zone: "play", counters: { token: 4 } }], 2);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2, "tokens on another card don't count");
  assert.equal(g.engine.getStat(g.id("o"), "strength"), 1, "and Caracal's bonus isn't given to others");
  const w = mk([{ key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 2, wound: 3 } as never }]);
  assert.equal(w.engine.getStat(w.id("c"), "strength"), 2, "other counter kinds don't count");
  assert.equal(w.engine.getStat(w.id("c"), "life"), 2);
});
clause(CARACAL, "2:rule", "tracks token changes live and the bonus is gone once the card leaves play", () => {
  const g = car([tool("k", P1, "destroy")], 3);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 3);
  g.engine.state.cards[g.id("c")].counters = { token: 6 };
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 6);
  g.engine.state.cards[g.id("c")].counters = { token: 2 };
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
  use(g, "k", "c");
  assert.equal(zoneOf(g.engine, g.id("c")), "discard");
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 0, "static ability is off outside play");
  assert.equal(g.engine.getStat(g.id("c"), "life"), 0);
});

clause(CARACAL, "3:rule", "drawing N cards puts N tokens on it (1, then 3, then 2 more)", () => {
  const g = car([cantrip("t1", P1, 1), cantrip("t3", P1, 3), cantrip("t2", P1, 2)]);
  play(g.engine, P1, g.id("t1"));
  assert.equal(tokens(g.engine, g.id("c")), 6);
  play(g.engine, P1, g.id("t3"));
  assert.equal(tokens(g.engine, g.id("c")), 9);
  play(g.engine, P1, g.id("t2"));
  assert.equal(tokens(g.engine, g.id("c")), 11);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 11);
});
clause(CARACAL, "3:rule", "X is the number of cards actually drawn: drawing 3 from a 2-card deck adds 2; an empty deck adds 0", () => {
  const g = mk([{ key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 5 } }, ...fillers("dk", 2, P1, "deck"), cantrip("t3", P1, 3)]);
  const hand = g.engine.state.players[P1].hand.length;
  play(g.engine, P1, g.id("t3"));
  assert.equal(g.engine.state.players[P1].hand.length, hand - 1 + 2, "tactic left the hand, 2 drawn");
  assert.equal(tokens(g.engine, g.id("c")), 7, "2 cards drawn = 2 tokens");
  const e = mk([{ key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 5 } }, cantrip("t1", P1, 1)]);
  play(e.engine, P1, e.id("t1"));
  assert.equal(tokens(e.engine, e.id("c")), 5, "nothing drawn, nothing added");
});
clause(CARACAL, "3:rule", "the develop-rule draw counts too (1 token)", () => {
  const g = car();
  developDraw(g.engine, P1);
  assert.equal(tokens(g.engine, g.id("c")), 6);
});
clause(CARACAL, "3:rule", "only draws by its controller count: the opponent drawing adds nothing, and each player's Caracal counts only that player's draws", () => {
  const g = mk(
    [
      { key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 5 } },
      ...fillers("dk", 6, P1, "deck"),
      ...fillers("ek", 6, P2, "deck"),
      cantrip("t2", P2, 2)
    ],
    P2,
    2
  );
  play(g.engine, P2, g.id("t2"));
  assert.equal(g.engine.state.players[P2].hand.length, 2);
  assert.equal(tokens(g.engine, g.id("c")), 5, "opponent's draw adds nothing");
  const h = mk([
    { key: "c", def: printing(CARACAL), owner: P1, zone: "play", counters: { token: 5 } },
    { key: "oc", def: printing(CARACAL), owner: P2, zone: "play", counters: { token: 5 } },
    ...fillers("dk", 6, P1, "deck"),
    ...fillers("ek", 6, P2, "deck"),
    cantrip("t2", P1, 2)
  ]);
  play(h.engine, P1, h.id("t2"));
  assert.equal(tokens(h.engine, h.id("c")), 7);
  assert.equal(tokens(h.engine, h.id("oc")), 5, "the opponent's Caracal ignores my draw");
});

clause(CARACAL, "4:ability:morph", "removes 3 tokens as the cost and draws a card (which adds one token back): 5 tokens ends at 3 with one more card in hand", () => {
  const g = car([], 5);
  const hand = g.engine.state.players[P1].hand.length;
  activate(g.engine, P1, g.id("c"), "morph");
  assert.equal(g.engine.state.players[P1].hand.length, hand + 1, "drew exactly one card");
  assert.equal(tokens(g.engine, g.id("c")), 3, "5 - 3 + 1");
  assert.equal(g.engine.state.players[P2].hand.length, 0, "the opponent draws nothing");
  assert.equal(g.engine.state.cards[g.id("c")].depleted, false, "no deplete cost");
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "3 tokens left: life 3, still in play");
});
// CR 408.4 (RULES.md §3.1): a character is destroyed once its damage is >= its life, checked continuously. Removing the
// last 3 tokens as MORPH's cost leaves a 0/3/0 at 0 life with 0 damage (0 >= 0), so it is destroyed. The draw still resolves.
clause(CARACAL, "4:ability:morph", "MORPH paid with its last 3 tokens leaves it at 0 life, so it is destroyed (the draw still happens)", () => {
  const g = car([], 3);
  activate(g.engine, P1, g.id("c"), "morph");
  assert.equal(g.engine.state.players[P1].hand.length, 1, "the ability still draws");
  assert.notEqual(zoneOf(g.engine, g.id("c")), "play", "0 life, 0 damage: destroyed");
});
clause(CARACAL, "4:ability:morph", "needs the 3 tokens: exactly 3 can pay (it draws), 2 is refused with nothing drawn or removed", () => {
  const ok = car([], 3);
  activate(ok.engine, P1, ok.id("c"), "morph");
  assert.equal(ok.engine.state.players[P1].hand.length, 1, "exactly 3 tokens pays the cost and the card is drawn");
  const short = car([], 2);
  refused(() => activate(short.engine, P1, short.id("c"), "morph"), "only 2 tokens");
  assert.equal(short.engine.state.players[P1].hand.length, 0);
  assert.equal(tokens(short.engine, short.id("c")), 2, "nothing removed");
  const none = car([], 0);
  refused(() => activate(none.engine, P1, none.id("c"), "morph"), "no tokens");
  assert.equal(none.engine.state.players[P1].hand.length, 0);
});
clause(CARACAL, "4:ability:morph", "only its controller can use it", () => {
  const g = car([], 5);
  refused(() => activate(g.engine, P2, g.id("c"), "morph"), "the opponent cannot activate it");
  assert.equal(tokens(g.engine, g.id("c")), 5);
  assert.equal(g.engine.state.players[P2].hand.length, 0);
  assert.equal(g.engine.state.players[P1].hand.length, 0);
});

// ============================================================================
// Ceremonious Groomer
// ============================================================================
const groom = (extra: CardPlacement[] = [], over: Partial<CardPlacement> = {}): G =>
  mk([{ key: "g", def: printing(GROOMER), owner: P1, zone: "play", ...over }, tool("k", P1, "destroy"), ...extra]);

clause(GROOMER, "0:rule", "costs 3 with [G][G]: exact works, one short / one icon short / spent-only refused", costBody(GROOMER, 3, 2));
clause(GROOMER, "0:rule", "is a 2/3/3 banker mau character", statsBody(GROOMER, ["mau"], 2, 3, 3));
clause(GROOMER, "0:rule", "destroyed by an effect: it is not discarded but flipped face-down in play under its owner's control", () => {
  const g = groom();
  const before = ready(g.engine, P1);
  use(g, "k", "g");
  const c = g.engine.state.cards[g.id("g")];
  assert.equal(c.zone, "play", "stays in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.equal(c.controllerId, P1);
  assert.equal(c.ownerId, P1);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("g")), "not in the discard pile");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), before + 1, "a face-down card is a resource");
});
clause(GROOMER, "0:rule", "the opponent's Groomer is flipped face-down under ITS owner's control, too", () => {
  const g = groom([], { owner: P2 });
  use(g, "k", "g");
  const c = g.engine.state.cards[g.id("g")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P2);
  assert.ok(!discardOf(g.engine, P2).includes(g.id("g")), "!discardOf(g.engine, P2).includes(g.id(\"g\"))");
});
clause(GROOMER, "0:rule", "if someone else controls it when destroyed, it comes back face-down under its OWNER's control", () => {
  const g = groom([], { owner: P1, controller: P2 });
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P2);
  use(g, "k", "g");
  const c = g.engine.state.cards[g.id("g")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1, "owner's control");
  const h = groom([], { owner: P2, controller: P1 });
  use(h, "k", "g");
  const d = h.engine.state.cards[h.id("g")];
  assert.equal(d.faceDown, true);
  assert.equal(d.controllerId, P2, "its owner is P2");
  assert.equal(d.zone, "play");
});
clause(GROOMER, "0:rule", "lethal battle damage also flips it face-down instead of destroying it", () => {
  const g = mk(
    [
      { key: "g", def: printing(GROOMER), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A", strength: 5, life: 9 }), owner: P2, zone: "play" }
    ],
    P2,
    2
  );
  declareAttackBy(g.engine, P2, [g.id("a")]);
  declareBlockers(g.engine, P1, [g.id("g")]);
  finishBattle(g.engine);
  const c = g.engine.state.cards[g.id("g")];
  assert.equal(c.zone, "play", "not discarded");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("g")), "!discardOf(g.engine, P1).includes(g.id(\"g\"))");
});
clause(GROOMER, "0:rule", "only destruction is replaced: a Groomer moved to the discard pile or hand goes there, and other characters are destroyed normally", () => {
  const disc = groom([tool("kd", P1, "discard")]);
  use(disc, "kd", "g");
  assert.equal(zoneOf(disc.engine, disc.id("g")), "discard", "moved, not destroyed");
  assert.equal(disc.engine.state.cards[disc.id("g")].faceDown ?? false, false);
  const hand = groom([tool("kh", P1, "hand")]);
  use(hand, "kh", "g");
  assert.equal(zoneOf(hand.engine, hand.id("g")), "hand");
  const other = groom([{ key: "o", def: character({ name: "Plain" }), owner: P1, zone: "play" }]);
  use(other, "k", "o");
  assert.equal(zoneOf(other.engine, other.id("o")), "discard", "another character is destroyed normally");
  assert.equal(other.engine.state.cards[other.id("o")].faceDown ?? false, false);
  assert.equal(zoneOf(other.engine, other.id("g")), "play");
  assert.equal(other.engine.state.cards[other.id("g")].faceDown ?? false, false, "an unrelated Groomer is untouched");
});
clause(GROOMER, "0:rule", "a second Groomer is not flipped by the first one's destruction (each replaces only its own destruction)", () => {
  const g = groom([{ key: "g2", def: printing(GROOMER), owner: P1, zone: "play" }]);
  use(g, "k", "g");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("g2")].faceDown ?? false, false, "the other Groomer is not flipped");
  assert.equal(zoneOf(g.engine, g.id("g2")), "play");
});
