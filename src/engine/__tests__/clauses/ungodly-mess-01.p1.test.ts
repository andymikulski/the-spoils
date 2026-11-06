// Clause tests: Ungodly Mess batch 01, part p1 (groups 1-6, missing clauses only).
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, resolvePendingResponses, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import { declareAttackOpenWindow, covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert } from "./_battle.js";
import { answerPending, pending, tokensOn, zoneOf } from "./_board.js";
import { clause, drain, declineAll, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn, factionOf } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
const ANY = /[\s\S]*/;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const isDepleted = (e: SpoilsEngine, id: string) => e.state.cards[id as never].depleted === true;
const handOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].deck] as string[];
const passTurn = (e: SpoilsEngine) => endTurn(e, e.state.activePlayerId as never);
const pick = (e: SpoilsEngine, ids: string[]) =>
  drain(e, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc)));
const answerChoice = (e: SpoilsEngine, choice: Record<string, unknown>) => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};

// ============================================================================
// Wily Circumvention
// EXTRA COST: Pick a depleted character. -- That character does not restore during its controller's next RESTORE RULE. -- FLIP UP: 1 [E]
// Tactic, gearsmith, cost 1, [E].
// ============================================================================
const WILY = "0beca33c-dd54-4470-a118-e07958ec3cba";

function wilyBoard(opts: { e?: number; greed?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "wily", def: printing(WILY), owner: P1, zone: "hand" },
      ...bank("elitism", opts.e ?? 1, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play", depleted: true },
      { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(WILY, "0:extraCost", "the card is a Gearsmith tactic, cost 1, threshold [E]: one Elitism resource deploys it, spending exactly 1", () => {
  const p = printing(WILY);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "gearsmith", 1, "e"]);
  const { engine, id } = wilyBoard({ e: 1 });
  assert.equal(ready(engine, P1), 1);
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("wily")), "discard");
  assert.equal(ready(engine, P1), 0, "1 paid");
});

clause(WILY, "0:extraCost", "only the printed cost of 1 is paid (a second Elitism resource stays ready)", () => {
  const { engine, id } = wilyBoard({ e: 2 });
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  assert.equal(ready(engine, P1), 1);
});

clause(WILY, "0:extraCost", "cannot be deployed with no resources, nor with plenty of resources but no [E]", () => {
  const none = wilyBoard({ e: 0 });
  refused(() => play(none.engine, P1, none.id("wily"), { selected: { c: [none.id("foe")] } }), "cost 1 unaffordable", ANY);
  assert.equal(zoneOf(none.engine, none.id("wily")), "hand");
  const noE = wilyBoard({ e: 0, greed: 4 });
  refused(() => play(noE.engine, P1, noE.id("wily"), { selected: { c: [noE.id("foe")] } }), "threshold [E] unmet", ANY);
  assert.equal(zoneOf(noE.engine, noE.id("wily")), "hand");
  assert.equal(ready(noE.engine, P1), 4, "nothing paid");
  const ok = wilyBoard({ e: 1, greed: 4 });
  play(ok.engine, P1, ok.id("wily"), { selected: { c: [ok.id("foe")] } });
  assert.equal(zoneOf(ok.engine, ok.id("wily")), "discard", "control: one [E] among other resources is enough");
});

clause(WILY, "0:extraCost", "the extra cost picks a depleted character: any controller, either side of the table", () => {
  for (const key of ["foe", "mine"]) {
    const { engine, id } = wilyBoard();
    play(engine, P1, id("wily"), { selected: { c: [id(key)] } });
    assert.equal(zoneOf(engine, id("wily")), "discard", `${key} may be picked`);
    assert.equal(ready(engine, P1), 0);
  }
});

clause(WILY, "0:extraCost", "a character that is not depleted cannot be picked", () => {
  const { engine, id } = wilyBoard();
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("fresh")] } }), "fresh character", ANY);
  assert.equal(zoneOf(engine, id("wily")), "hand");
  assert.equal(ready(engine, P1), 1, "nothing was paid");
});

clause(WILY, "0:extraCost", "a depleted non-character (item, location, faction) cannot be picked", () => {
  const { engine, id } = wilyBoard({
    extra: [
      { key: "ditem", def: item({ name: "DItem" }), owner: P2, zone: "play", depleted: true },
      { key: "dloc", def: location({ name: "DLoc" }), owner: P2, zone: "play", depleted: true }
    ]
  });
  const faction = engine.state.players[P2].factionId!;
  engine.state.cards[faction].depleted = true;
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("ditem")] } }), "depleted item", ANY);
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("dloc")] } }), "depleted location", ANY);
  refused(() => play(engine, P1, id("wily"), { selected: { c: [faction] } }), "depleted faction", ANY);
  assert.equal(zoneOf(engine, id("wily")), "hand");
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("wily")), "discard", "control: a depleted character works");
});

clause(WILY, "0:extraCost", "a depleted character that is not in play cannot be picked", () => {
  const { engine, id } = wilyBoard({
    extra: [
      { key: "inDisc", def: character({ name: "InDisc" }), owner: P2, zone: "discard", depleted: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand", depleted: true }
    ]
  });
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("inDisc")] } }), "discard pile", ANY);
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("inHand")] } }), "hand", ANY);
  assert.equal(zoneOf(engine, id("wily")), "hand");
});

clause(WILY, "0:extraCost", "with no depleted character in play it cannot be deployed at all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "wily", def: printing(WILY), owner: P1, zone: "hand" },
      ...bank("elitism", 3, P1),
      { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" }
    ]
  });
  refused(() => play(engine, P1, id("wily"), { selected: {} }), "no pick", ANY);
  refused(() => play(engine, P1, id("wily"), { selected: { c: [id("fresh")] } }), "fresh pick", ANY);
  assert.equal(zoneOf(engine, id("wily")), "hand");
  assert.equal(ready(engine, P1), 3);
});

clause(WILY, "1:rule", "an opponent's character does not restore at its controller's next RESTORE RULE, while another depleted one does", () => {
  const { engine, id } = wilyBoard();
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  assert.equal(isDepleted(engine, id("foe")), true);
  passTurn(engine);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("foe")), true, "skipped the restore");
  assert.equal(isDepleted(engine, id("foe2")), false, "control: another depleted character restores");
});

clause(WILY, "1:rule", "the character restores normally at the restore after that (only the next one is skipped)", () => {
  const { engine, id } = wilyBoard();
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  passTurn(engine);
  passTurn(engine);
  passTurn(engine);
  assert.equal(engine.state.turn, 4);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("foe")), false, "restored at its controller's second restore");
});

clause(WILY, "1:rule", "your own depleted character skips your next RESTORE RULE, not the opponent's turn start, and restores after", () => {
  const { engine, id } = wilyBoard();
  play(engine, P1, id("wily"), { selected: { c: [id("mine")] } });
  passTurn(engine);
  assert.equal(isDepleted(engine, id("mine")), true, "opponent's restore is not its controller's");
  passTurn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("mine")), true, "skipped at its controller's restore");
  assert.equal(isDepleted(engine, id("mine2")), false, "control: my other depleted character restored");
  passTurn(engine);
  passTurn(engine);
  assert.equal(engine.state.turn, 5);
  assert.equal(isDepleted(engine, id("mine")), false, "restored the time after");
});

clause(WILY, "1:rule", "'its controller': a character I own but the opponent controls skips the opponent's restore", () => {
  const { engine, id } = wilyBoard({
    extra: [
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play", depleted: true },
      { key: "lent2", def: character({ name: "Lent2" }), owner: P1, controller: P2, zone: "play", depleted: true }
    ]
  });
  play(engine, P1, id("wily"), { selected: { c: [id("lent")] } });
  passTurn(engine);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("lent")), true, "its controller (P2) did not restore it");
  assert.equal(isDepleted(engine, id("lent2")), false, "control: the same shape without Wily restores at P2's restore");
});

clause(WILY, "1:rule", "'its controller': a character the opponent owns but I control skips MY restore", () => {
  const { engine, id } = wilyBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play", depleted: true },
      { key: "stolen2", def: character({ name: "Stolen2" }), owner: P2, controller: P1, zone: "play", depleted: true }
    ]
  });
  play(engine, P1, id("wily"), { selected: { c: [id("stolen")] } });
  passTurn(engine);
  passTurn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("stolen")), true, "controller P1's restore skipped it");
  assert.equal(isDepleted(engine, id("stolen2")), false, "control: restored without Wily");
});

clause(WILY, "1:rule", "only the picked character is affected: the other depleted characters restore on schedule", () => {
  const { engine, id } = wilyBoard();
  play(engine, P1, id("wily"), { selected: { c: [id("foe")] } });
  passTurn(engine);
  assert.equal(isDepleted(engine, id("foe2")), false);
  passTurn(engine);
  assert.equal(isDepleted(engine, id("mine")), false, "my own depleted characters restore normally");
  assert.equal(isDepleted(engine, id("mine2")), false);
});

// --- FLIP UP: 1 [E] ---------------------------------------------------------
function wilyFlipBoard(opts: { e?: number; greed?: number; turn?: number; active?: typeof P1 | typeof P2; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "wily", def: printing(WILY), owner: P1, zone: "play", faceDown: true },
      ...bank("elitism", opts.e ?? 1, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play", depleted: true },
      { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}
const flipUp = (b: ReturnType<typeof wilyFlipBoard>, selected: Record<string, string[]>, player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("wily"), selected, variables: {} });

clause(WILY, "2:flipUp", "flipping up for 1 [E] resolves the tactic on the picked depleted character and discards it", () => {
  const b = wilyFlipBoard({ e: 2 });
  assert.equal(ready(b.engine, P1), 3, "two banks plus the face-down card");
  flipUp(b, { c: [b.id("foe")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("wily")), "discard");
  assert.equal(ready(b.engine, P1), 1, "exactly 1 paid (the face-down card is gone, one bank spent)");
  passTurn(b.engine);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "skipped the restore");
  assert.equal(isDepleted(b.engine, b.id("foe2")), false);
});

clause(WILY, "2:flipUp", "FLIP UP needs [E]: with only Greed resources it is refused and nothing is paid", () => {
  const b = wilyFlipBoard({ e: 0, greed: 4 });
  refused(() => flipUp(b, { c: [b.id("foe")] }), "threshold [E]", ANY);
  assert.equal(b.engine.state.cards[b.id("wily")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("wily")), "play");
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  const ok = wilyFlipBoard({ e: 1, greed: 4 });
  flipUp(ok, { c: [ok.id("foe")] });
  assert.equal(zoneOf(ok.engine, ok.id("wily")), "discard", "control: one [E] is enough");
});

clause(WILY, "2:flipUp", "FLIP UP still requires the extra cost: a non-depleted pick is refused", () => {
  const b = wilyFlipBoard({ e: 2 });
  refused(() => flipUp(b, { c: [b.id("fresh")] }), "fresh pick", ANY);
  refused(() => flipUp(b, {}), "no pick", ANY);
  assert.equal(b.engine.state.cards[b.id("wily")].faceDown, true);
  assert.equal(ready(b.engine, P1), 3);
});

clause(WILY, "2:flipUp", "as a tactic it can be flipped up inside the opponent's response window, on their just-depleted attacker", () => {
  const b = wilyFlipBoard({
    e: 2,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(isDepleted(b.engine, b.id("atk")), true, "attackers deplete");
  flipUp(b, { c: [b.id("atk")] });
  assert.equal(zoneOf(b.engine, b.id("wily")), "discard");
  assert.equal(ready(b.engine, P1), 1);
});

// ============================================================================
// Beefy Researcher
// RESEARCH -- COST: Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 1.
// [E][E][E][E][E][E]: This card gains 2 strength, 2 life and 2 speed.
// Character, gearsmith, subtype 31f, cost 1, [E][E][E], 1 str / 1 spd / 1 life.
// ============================================================================
const BEEFY = "f7868f88-8581-4e71-bfb4-2e16b9f6c615";
const c3 = (name: string) => character({ name, cost: 3 });
const BEEFY_PAY3 = item({
  name: "PayThree",
  behavior: { abilities: [{ id: "p3", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [] }] }
});

function beefyBoard(opts: { res?: number; extra?: Cards; beefy2?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "br", def: printing(BEEFY), owner: P1, zone: "play" },
      ...(opts.beefy2 ? [{ key: "br2", def: printing(BEEFY), owner: P1, zone: "play" as const }] : []),
      { key: "a", def: c3("A"), owner: P1, zone: "hand" },
      { key: "b", def: c3("B"), owner: P1, zone: "hand" },
      ...volition(opts.res ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BEEFY, "0:ability:research", "the card is a Gearsmith 31f character, cost 1, [E][E][E], printed 1 / 1 / 1", () => {
  const p = printing(BEEFY);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.subtype], ["character", "gearsmith", 1, "eee", ["31f"]]);
  assert.deepEqual([p.strength, p.speed, p.life], [1, 1, 1]);
  const mk = (e: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: printing(BEEFY), owner: P1, zone: "hand" }, ...bank("elitism", e, P1), ...bank("greed", greed, P1)]
    });
  const ok = mk(3, 0);
  play(ok.engine, P1, ok.id("br"));
  assert.equal(zoneOf(ok.engine, ok.id("br")), "play");
  assert.equal(ready(ok.engine, P1), 2, "cost 1 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("br"), "strength"), ok.engine.getStat(ok.id("br"), "speed"), ok.engine.getStat(ok.id("br"), "life")], [1, 1, 1]);
  const two = mk(2, 5);
  refused(() => play(two.engine, P1, two.id("br")), "only two [E]", ANY);
  assert.equal(zoneOf(two.engine, two.id("br")), "hand");
  const none = mk(0, 0);
  refused(() => play(none.engine, P1, none.id("br")), "no resources", ANY);
});

clause(BEEFY, "0:ability:research", "the COST is paid: using RESEARCH depletes the card, and it cannot be used again while depleted", () => {
  const { engine, id } = beefyBoard();
  assert.equal(isDepleted(engine, id("br")), false);
  activate(engine, P1, id("br"), "research");
  assert.equal(isDepleted(engine, id("br")), true);
  refused(() => activate(engine, P1, id("br"), "research"), "already depleted", ANY);
});

clause(BEEFY, "0:ability:research", "the next numeric cost paid is reduced by 1 (cost 3 pays 2)", () => {
  const { engine, id } = beefyBoard();
  const before = ready(engine, P1);
  activate(engine, P1, id("br"), "research");
  assert.equal(ready(engine, P1), before, "RESEARCH itself costs no resources");
  play(engine, P1, id("a"));
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(before - ready(engine, P1), 2);
});

clause(BEEFY, "0:ability:research", "only the NEXT cost: the cost after it is paid in full", () => {
  const { engine, id } = beefyBoard();
  activate(engine, P1, id("br"), "research");
  play(engine, P1, id("a"));
  const mid = ready(engine, P1);
  play(engine, P1, id("b"));
  assert.equal(mid - ready(engine, P1), 3);
});

clause(BEEFY, "0:ability:research", "without RESEARCH the same card costs its full 3 (control)", () => {
  const { engine, id } = beefyBoard();
  const before = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(before - ready(engine, P1), 3);
});

clause(BEEFY, "0:ability:research", "the reduction is real: a cost-3 card is deployable with only 2 resources after RESEARCH", () => {
  const { engine, id } = beefyBoard({ res: 2 });
  refused(() => play(engine, P1, id("a")), "3 needed, 2 ready", ANY);
  activate(engine, P1, id("br"), "research");
  play(engine, P1, id("a"));
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(ready(engine, P1), 0);
});

clause(BEEFY, "0:ability:research", "an ability's 'pay N' is a numeric cost too, and it is the next one paid (pay 3 costs 2)", () => {
  const { engine, id } = beefyBoard({ extra: [{ key: "p3", def: BEEFY_PAY3, owner: P1, zone: "play" }] });
  activate(engine, P1, id("br"), "research");
  const before = ready(engine, P1);
  activate(engine, P1, id("p3"), "p3");
  assert.equal(before - ready(engine, P1), 2);
  const mid = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(mid - ready(engine, P1), 3, "the reduction was used up by the ability cost");
});

clause(BEEFY, "0:ability:research", "'this turn': the reduction does not carry into a later turn", () => {
  const { engine, id } = beefyBoard();
  activate(engine, P1, id("br"), "research");
  passTurn(engine);
  passTurn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  const before = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(before - ready(engine, P1), 3, "full cost on the next turn");
});

clause(BEEFY, "0:ability:research", "'you pay': an opponent's cost paid in response is not reduced and does not use up my reduction", () => {
  const zap = tactic({ name: "Zap", cost: 2, behavior: { abilities: [{ id: "z", type: "activated", effects: [] }] } });
  const { engine, id } = beefyBoard({
    extra: [{ key: "zap", def: zap, owner: P2, zone: "hand" }, ...volition(5, P2)]
  });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("br"), abilityId: "research", selected: {}, variables: {} } as never);
  const theirs = ready(engine, P2);
  engine.perform({ type: "playCard", playerId: P2, cardId: id("zap"), selected: {}, variables: {} } as never);
  assert.equal(theirs - ready(engine, P2), 2, "the opponent pays Zap's full cost");
  resolvePendingResponses(engine);
  const mine = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(mine - ready(engine, P1), 2, "my reduction is still waiting for my next cost");
});

clause(BEEFY, "0:ability:research", "two RESEARCH activations both reduce the same next cost (cost 3 pays 1)", () => {
  const { engine, id } = beefyBoard({ beefy2: true });
  activate(engine, P1, id("br"), "research");
  activate(engine, P1, id("br2"), "research");
  const before = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(before - ready(engine, P1), 1);
  const mid = ready(engine, P1);
  play(engine, P1, id("b"));
  assert.equal(mid - ready(engine, P1), 3);
});

clause(BEEFY, "0:ability:research", "a cost can't be reduced below 0 (cost 0 stays free and the reduction is spent on it)", () => {
  const free = tactic({ name: "Free", cost: 0, behavior: { abilities: [{ id: "f", type: "activated", effects: [] }] } });
  const { engine, id } = beefyBoard({ extra: [{ key: "free", def: free, owner: P1, zone: "hand" }] });
  activate(engine, P1, id("br"), "research");
  const before = ready(engine, P1);
  play(engine, P1, id("free"));
  assert.equal(before - ready(engine, P1), 0, "cost 0 stays 0");
  const mid = ready(engine, P1);
  play(engine, P1, id("a"));
  assert.equal(mid - ready(engine, P1), 3, "the next numeric cost (0) used the reduction up");
});

function surgeBoard(e: number, others: number, opp = 0) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "br", def: printing(BEEFY), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      ...bank("elitism", e, P1),
      ...bank("greed", others, P1),
      ...bank("elitism", opp, P2)
    ]
  });
}
const statsOf = (b: ReturnType<typeof surgeBoard>, key: string) =>
  (["strength", "life", "speed"] as const).map((s) => b.engine.getStat(b.id(key), s));

clause(BEEFY, "1:rule@eeeeee", "with six [E] icons it gains +2 strength, +2 life and +2 speed (3 / 3 / 3)", () => {
  const b = surgeBoard(6, 0);
  assert.deepEqual(statsOf(b, "br"), [3, 3, 3]);
  const more = surgeBoard(8, 2);
  assert.deepEqual(statsOf(more, "br"), [3, 3, 3], "extra icons give no more than +2");
});

clause(BEEFY, "1:rule@eeeeee", "with only five [E] icons (even with other resources) it keeps its printed 1 / 1 / 1", () => {
  const b = surgeBoard(5, 4);
  assert.deepEqual(statsOf(b, "br"), [1, 1, 1]);
  const none = surgeBoard(0, 8);
  assert.deepEqual(statsOf(none, "br"), [1, 1, 1], "six non-[E] resources are not enough");
});

clause(BEEFY, "1:rule@eeeeee", "the opponent's [E] resources do not count toward my threshold", () => {
  const b = surgeBoard(3, 0, 6);
  assert.deepEqual(statsOf(b, "br"), [1, 1, 1]);
  const mix = surgeBoard(5, 0, 6);
  assert.deepEqual(statsOf(mix, "br"), [1, 1, 1]);
});

clause(BEEFY, "1:rule@eeeeee", "only this card gains the stats, not my other characters", () => {
  const b = surgeBoard(6, 0);
  assert.deepEqual(statsOf(b, "ally"), [1, 1, 1]);
});

clause(BEEFY, "1:rule@eeeeee", "face-down (Volition) resources do not supply [E] icons", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "br", def: printing(BEEFY), owner: P1, zone: "play" }, ...bank("elitism", 3, P1), ...volition(5, P1)]
  });
  assert.deepEqual([b.engine.getStat(b.id("br"), "strength"), b.engine.getStat(b.id("br"), "life"), b.engine.getStat(b.id("br"), "speed")], [1, 1, 1]);
});

// ============================================================================
// Arrakis Eternity
// COVERT -- RECUR: [O] -- COST: Use this only if this card is in your discard pile. Pay 2. Pick a player. Remove this card from the game.
// -- EFFECT: That player discards 3 cards.
// Character, arcanist, subtype monstrosity, cost 9, [O], 5 str / 3 spd / 5 life.
// ============================================================================
const ARRAKIS = "6ad7ed02-abe6-4b2a-a60a-1e12888c2e77";

clause(ARRAKIS, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(ARRAKIS));
clause(ARRAKIS, "0:kw:COVERT", "attacking, it cannot be blocked by a non-covert character", () => covertCannotBeBlockedByNonCovert(ARRAKIS));
clause(ARRAKIS, "0:kw:COVERT", "a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(ARRAKIS));
clause(ARRAKIS, "0:kw:COVERT", "as a blocker it can only block covert parties", () => covertBlocksOnlyCovertParties(ARRAKIS));

clause(ARRAKIS, "0:kw:COVERT", "the card is an Arcanist monstrosity character, cost 9, [O], printed 5 / 3 / 5", () => {
  const p = printing(ARRAKIS);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.subtype], ["character", "arcanist", 9, "o", ["monstrosity"]]);
  assert.deepEqual([p.strength, p.speed, p.life], [5, 3, 5]);
  const mk = (o: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ae", def: printing(ARRAKIS), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", greed, P1)]
    });
  const ok = mk(1, 8);
  play(ok.engine, P1, ok.id("ae"));
  assert.equal(zoneOf(ok.engine, ok.id("ae")), "play");
  assert.equal(ready(ok.engine, P1), 0, "9 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("ae"), "strength"), ok.engine.getStat(ok.id("ae"), "speed"), ok.engine.getStat(ok.id("ae"), "life")], [5, 3, 5]);
  const short = mk(1, 7);
  refused(() => play(short.engine, P1, short.id("ae")), "8 resources", ANY);
  assert.equal(zoneOf(short.engine, short.id("ae")), "hand");
  const noO = mk(0, 9);
  refused(() => play(noO.engine, P1, noO.id("ae")), "no [O]", ANY);
});

function recurBoard(opts: { o?: number; greed?: number; zone?: "discard" | "hand" | "play" | "deck"; myHand?: number; theirHand?: number } = {}) {
  const hand = (owner: typeof P1 | typeof P2, n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `${owner}h${i}`, def: character({ name: `${owner}H${i}` }), owner, zone: "hand" as const }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ae", def: printing(ARRAKIS), owner: P1, zone: opts.zone ?? "discard" },
      ...bank("obsession", opts.o ?? 2, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...hand(P1, opts.myHand ?? 5),
      ...hand(P2, opts.theirHand ?? 5)
    ]
  });
}
const h = (p: string, i: number) => `${p}h${i}`;

clause(ARRAKIS, "1:ability:recur", "from the discard pile with [O] and 2 resources: pays 2, removes this card from the game, the opponent discards 3 cards", () => {
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine, P1), 0, "pay 2");
  assert.equal(zoneOf(engine, id("ae")), "removed");
  assert.equal(handOf(engine, P2).length, 2, "the opponent discarded 3 of 5");
  assert.deepEqual([0, 1, 2].map((i) => zoneOf(engine, id(h(P2, i)))), ["discard", "discard", "discard"]);
  assert.deepEqual([3, 4].map((i) => zoneOf(engine, id(h(P2, i)))), ["hand", "hand"]);
  assert.equal(handOf(engine, P1).length, 5, "my hand is untouched");
});

clause(ARRAKIS, "1:ability:recur", "that player chooses which 3 cards to discard", () => {
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the discarding player chooses");
  pick(engine, [id(h(P2, 4)), id(h(P2, 3)), id(h(P2, 1))]);
  assert.deepEqual([4, 3, 1].map((i) => zoneOf(engine, id(h(P2, i)))), ["discard", "discard", "discard"]);
  assert.deepEqual([0, 2].map((i) => zoneOf(engine, id(h(P2, i)))), ["hand", "hand"]);
});

clause(ARRAKIS, "1:ability:recur", "the discarding player must discard exactly 3: choosing fewer (one card, none) is refused", () => {
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  refused(() => answerChoice(engine, { kind: "chooserSelectsTarget", selected: [id(h(P2, 0))] }), "one card", ANY);
  refused(() => answerChoice(engine, { kind: "chooserSelectsTarget", selected: [] }), "no cards", ANY);
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(handOf(engine, P2).length, 2);
});

clause(ARRAKIS, "1:ability:recur", "the discarding player cannot discard more than 3 (four cards are refused)", () => {
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  refused(() => answerChoice(engine, { kind: "chooserSelectsTarget", selected: [0, 1, 2, 3].map((i) => id(h(P2, i))) }), "four cards", ANY);
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(handOf(engine, P2).length, 2);
});

clause(ARRAKIS, "1:ability:recur", "[O] plus one other resource is enough for RECUR (the threshold is a single [O])", () => {
  const { engine, id } = recurBoard({ o: 1, greed: 1 });
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(zoneOf(engine, id("ae")), "removed");
  assert.equal(ready(engine, P1), 0);
});

clause(ARRAKIS, "1:ability:recur", "the discarding player can only discard from their own hand (the other player's cards are refused)", () => {
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  refused(() => answerChoice(engine, { kind: "chooserSelectsTarget", selected: [id(h(P1, 0)), id(h(P2, 0)), id(h(P2, 1))] }), "a card from the other hand", ANY);
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(handOf(engine, P2).length, 2);
  assert.equal(handOf(engine, P1).length, 5);
});

clause(ARRAKIS, "1:ability:recur", "a player with fewer than 3 cards discards what they have; with exactly 3 they discard all", () => {
  const two = recurBoard({ theirHand: 2 });
  activate(two.engine, P1, two.id("ae"), "recur", { selected: { p: [factionOf(two.engine, P2)] } });
  pick(two.engine, [two.id(h(P2, 0)), two.id(h(P2, 1))]);
  assert.equal(handOf(two.engine, P2).length, 0);
  const three = recurBoard({ theirHand: 3 });
  activate(three.engine, P1, three.id("ae"), "recur", { selected: { p: [factionOf(three.engine, P2)] } });
  pick(three.engine, [three.id(h(P2, 0)), three.id(h(P2, 1)), three.id(h(P2, 2))]);
  assert.equal(handOf(three.engine, P2).length, 0);
  assert.equal(pending(three.engine), undefined);
});

clause(ARRAKIS, "1:ability:recur", "'Pick a player': the controller can pick themselves, and then THEY discard 3 cards", () => {
  const { engine, id } = recurBoard();
  const me = engine.state.players[P1].factionId!;
  activate(engine, P1, id("ae"), "recur", { selected: { p: [me] } });
  pick(engine, [id(h(P1, 0)), id(h(P1, 1)), id(h(P1, 2))]);
  assert.equal(handOf(engine, P1).length, 2, "I (the picked player) discarded 3");
  assert.equal(handOf(engine, P2).length, 5, "the opponent discarded nothing");
});

clause(ARRAKIS, "1:ability:recur", "costs: exactly 2 resources, including an [O], are enough; one resource is not", () => {
  const short = recurBoard({ o: 1 });
  refused(() => activate(short.engine, P1, short.id("ae"), "recur", { selected: { p: [factionOf(short.engine, P2)] } }), "only 1 resource", ANY);
  assert.equal(zoneOf(short.engine, short.id("ae")), "discard");
  assert.equal(ready(short.engine, P1), 1);
  const spare = recurBoard({ o: 2, greed: 3 });
  activate(spare.engine, P1, spare.id("ae"), "recur", { selected: { p: [factionOf(spare.engine, P2)] } });
  pick(spare.engine, [spare.id(h(P2, 0)), spare.id(h(P2, 1)), spare.id(h(P2, 2))]);
  assert.equal(ready(spare.engine, P1), 3, "only 2 were paid");
});

clause(ARRAKIS, "1:ability:recur", "RECUR needs [O]: two Greed resources are enough to pay but not the threshold", () => {
  const { engine, id } = recurBoard({ o: 0, greed: 4 });
  refused(() => activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } }), "no [O]", ANY);
  assert.equal(zoneOf(engine, id("ae")), "discard");
  assert.equal(handOf(engine, P2).length, 5);
  assert.equal(ready(engine, P1), 4);
});

clause(ARRAKIS, "1:ability:recur", "'use this only if this card is in your discard pile': refused from hand, from play and from the deck", () => {
  for (const zone of ["hand", "play", "deck"] as const) {
    const { engine, id } = recurBoard({ zone });
    refused(() => activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } }), `in ${zone}`, ANY);
    assert.equal(zoneOf(engine, id("ae")), zone);
    assert.equal(handOf(engine, P2).length, 5);
    assert.equal(ready(engine, P1), 2);
  }
  const { engine, id } = recurBoard();
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  assert.ok(true, "control: works from the discard pile");
  void id;
});

clause(ARRAKIS, "1:ability:recur", "it is MY discard pile: Arrakis Eternity in the opponent's discard pile cannot be used by me", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "ae", def: printing(ARRAKIS), owner: P2, zone: "discard" }, ...bank("obsession", 2, P1)]
  });
  refused(() => activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } }), "opponent's discard", ANY);
  assert.equal(zoneOf(engine, id("ae")), "discard");
});

clause(ARRAKIS, "1:ability:recur", "it can only be used once: the card is removed from the game and cannot be used from the discard pile again", () => {
  const { engine, id } = recurBoard({ o: 2, greed: 4 });
  activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } });
  pick(engine, [id(h(P2, 0)), id(h(P2, 1)), id(h(P2, 2))]);
  assert.equal(zoneOf(engine, id("ae")), "removed");
  assert.equal(engine.state.players[P1].discard.includes(id("ae") as never), false);
  refused(() => activate(engine, P1, id("ae"), "recur", { selected: { p: [factionOf(engine, P2)] } }), "removed from the game", ANY);
});

// ============================================================================
// Deicidal Detonation
// Put a token on any number of non-resource cards. -- RECUR: [O] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game.
// -- EFFECT: Destroy each card with a token on it.
// Tactic, arcanist, cost 5, [O].
// ============================================================================
const DEICIDAL = "055f3424-00dc-4a20-8a2b-01c69014eeb6";

function ddBoard(opts: { o?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DEICIDAL), owner: P1, zone: "hand" },
      ...bank("obsession", opts.o ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc" }), owner: P2, zone: "discard" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" },
      ...volition(1, P2)
    ]
  });
}
const NONRES = ["mine", "foe", "foeItem", "myLoc"];

clause(DEICIDAL, "0:rule", "the card is an Arcanist tactic, cost 5, [O]: five resources with an [O] deploy it, spending exactly 5", () => {
  const p = printing(DEICIDAL);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 5, "o"]);
  const b = ddBoard({ o: 1, greed: 4 });
  play(b.engine, P1, b.id("dd"));
  pick(b.engine, []);
  assert.equal(zoneOf(b.engine, b.id("dd")), "discard");
  assert.equal(ready(b.engine, P1), 0);
  const spare = ddBoard({ o: 1, greed: 6 });
  play(spare.engine, P1, spare.id("dd"));
  pick(spare.engine, []);
  assert.equal(ready(spare.engine, P1), 2, "only 5 paid");
  const short = ddBoard({ o: 1, greed: 3 });
  refused(() => play(short.engine, P1, short.id("dd")), "4 resources", ANY);
  assert.equal(zoneOf(short.engine, short.id("dd")), "hand");
  const noO = ddBoard({ o: 0, greed: 8 });
  refused(() => play(noO.engine, P1, noO.id("dd")), "no [O]", ANY);
});

clause(DEICIDAL, "0:rule", "I may choose every non-resource card in play (either side, any type): each gets exactly one token", () => {
  const b = ddBoard();
  play(b.engine, P1, b.id("dd"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "I am asked which cards");
  assert.equal(pending(b.engine)?.playerId, P1, "the controller chooses");
  pick(b.engine, NONRES.map((k) => b.id(k)));
  for (const k of NONRES) assert.equal(tokensOn(b.engine, b.id(k)), 1, `${k} has one token`);
  for (const k of ["inHand", "inDisc", "inDeck"]) assert.equal(tokensOn(b.engine, b.id(k)), 0, `${k} untouched`);
  assert.equal(pending(b.engine), undefined);
});

clause(DEICIDAL, "0:rule", "any number: none, one or some of them; unchosen cards get no token", () => {
  const none = ddBoard();
  play(none.engine, P1, none.id("dd"));
  pick(none.engine, []);
  for (const k of NONRES) assert.equal(tokensOn(none.engine, none.id(k)), 0);
  assert.equal(zoneOf(none.engine, none.id("dd")), "discard", "it resolved with zero picks");
  const one = ddBoard();
  play(one.engine, P1, one.id("dd"));
  pick(one.engine, [one.id("foe")]);
  assert.deepEqual(NONRES.map((k) => tokensOn(one.engine, one.id(k))), [0, 1, 0, 0]);
  const two = ddBoard();
  play(two.engine, P1, two.id("dd"));
  pick(two.engine, [two.id("mine"), two.id("myLoc")]);
  assert.deepEqual(NONRES.map((k) => tokensOn(two.engine, two.id(k))), [1, 0, 0, 1]);
});

clause(DEICIDAL, "0:rule", "a resource (face-down) cannot receive a token", () => {
  const b = ddBoard();
  const res = Object.values(b.engine.state.cards).find((c) => c.controllerId === P2 && c.faceDown && c.zone === "play")!;
  play(b.engine, P1, b.id("dd"));
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [res.id] }), "a resource", ANY);
  pick(b.engine, [b.id("foe")]);
  assert.equal(tokensOn(b.engine, res.id as never), 0);
});

clause(DEICIDAL, "0:rule", "a face-up resource card in play cannot receive a token either", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DEICIDAL), owner: P1, zone: "hand" },
      ...bank("obsession", 6, P1),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  const resId = Object.values(b.engine.state.cards).find((c) => c.controllerId === P1 && c.zone === "play" && b.engine.getDefinition(c.id).type === "resource")!.id;
  play(b.engine, P1, b.id("dd"));
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [resId] }), "a resource card", ANY);
  pick(b.engine, [b.id("foe")]);
  assert.equal(tokensOn(b.engine, resId as never), 0);
});

clause(DEICIDAL, "0:rule", "a faction cannot receive a token (CR 202.9: it is not named)", () => {
  const b = ddBoard();
  const faction = b.engine.state.players[P2].factionId!;
  play(b.engine, P1, b.id("dd"));
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [faction] }), "a faction", ANY);
  pick(b.engine, [b.id("foe")]);
  assert.equal(tokensOn(b.engine, faction), 0);
});

clause(DEICIDAL, "0:rule", "only cards in play can receive tokens (CR 402.3): hand, discard and deck cards are refused", () => {
  const b = ddBoard();
  play(b.engine, P1, b.id("dd"));
  for (const k of ["inHand", "inDisc", "inDeck"]) {
    refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id(k)] }), `${k}`, ANY);
  }
  pick(b.engine, [b.id("foe")]);
  for (const k of ["inHand", "inDisc", "inDeck"]) assert.equal(tokensOn(b.engine, b.id(k)), 0);
});

clause(DEICIDAL, "0:rule", "the Detonation does not destroy anything by itself (tokens only)", () => {
  const b = ddBoard();
  play(b.engine, P1, b.id("dd"));
  pick(b.engine, NONRES.map((k) => b.id(k)));
  for (const k of NONRES) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});

function recurDdBoard(opts: { o?: number; greed?: number; zone?: "discard" | "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DEICIDAL), owner: P1, zone: opts.zone ?? "discard" },
      ...bank("obsession", opts.o ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      { key: "t1", def: character({ name: "T1" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "t2", def: character({ name: "T2" }), owner: P2, zone: "play", counters: { token: 2 } },
      { key: "tItem", def: item({ name: "TItem" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "tLoc", def: location({ name: "TLoc" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "clean", def: character({ name: "Clean" }), owner: P2, zone: "play" },
      { key: "cleanMine", def: character({ name: "CleanMine" }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play", counters: { shield: 1 } }
    ]
  });
}

clause(DEICIDAL, "1:ability:recur", "from the discard pile with [O] and 4 resources: pays 4, removes itself, destroys each card with a token on it", () => {
  const { engine, id } = recurDdBoard();
  activate(engine, P1, id("dd"), "recur");
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine, P1), 0, "pay 4");
  assert.equal(zoneOf(engine, id("dd")), "removed");
  for (const k of ["t1", "t2", "tItem", "tLoc"]) assert.equal(zoneOf(engine, id(k)), "discard", `${k} destroyed (whoever owns it, any type, any token count)`);
});

clause(DEICIDAL, "1:ability:recur", "cards with no token, or only another kind of counter, survive", () => {
  const { engine, id } = recurDdBoard();
  activate(engine, P1, id("dd"), "recur");
  for (const k of ["clean", "cleanMine", "other"]) assert.equal(zoneOf(engine, id(k)), "play", `${k} survives`);
});

clause(DEICIDAL, "1:ability:recur", "cost: exactly 4 resources (an [O] among them) is enough, 3 is refused, spare resources stay ready", () => {
  const short = recurDdBoard({ o: 3 });
  refused(() => activate(short.engine, P1, short.id("dd"), "recur"), "3 resources", ANY);
  assert.equal(zoneOf(short.engine, short.id("dd")), "discard");
  assert.equal(zoneOf(short.engine, short.id("t1")), "play");
  assert.equal(ready(short.engine, P1), 3);
  const spare = recurDdBoard({ o: 1, greed: 5 });
  activate(spare.engine, P1, spare.id("dd"), "recur");
  assert.equal(ready(spare.engine, P1), 2, "only 4 of 6 paid");
});

clause(DEICIDAL, "1:ability:recur", "RECUR needs [O]: four Greed resources are not enough", () => {
  const { engine, id } = recurDdBoard({ o: 0, greed: 6 });
  refused(() => activate(engine, P1, id("dd"), "recur"), "no [O]", ANY);
  assert.equal(zoneOf(engine, id("dd")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "play");
  assert.equal(ready(engine, P1), 6);
});

clause(DEICIDAL, "1:ability:recur", "usable only from the discard pile (refused from hand or play), and only once", () => {
  for (const zone of ["hand", "play"] as const) {
    const { engine, id } = recurDdBoard({ zone });
    refused(() => activate(engine, P1, id("dd"), "recur"), `in ${zone}`, ANY);
    assert.equal(zoneOf(engine, id("t1")), "play");
    assert.equal(ready(engine, P1), 4);
  }
  const { engine, id } = recurDdBoard({ o: 4, greed: 4 });
  activate(engine, P1, id("dd"), "recur");
  refused(() => activate(engine, P1, id("dd"), "recur"), "removed from the game", ANY);
});

clause(DEICIDAL, "1:ability:recur", "end to end: the tokens put on by the Detonation are what RECUR later destroys", () => {
  const b = ddBoard({ o: 5 });
  play(b.engine, P1, b.id("dd"));
  pick(b.engine, [b.id("foe"), b.id("myLoc")]);
  assert.equal(zoneOf(b.engine, b.id("dd")), "discard");
  // fresh resources for the recur (the 5 above are spent)
  const extra = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DEICIDAL), owner: P1, zone: "discard" },
      ...bank("obsession", 4, P1),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  activate(extra.engine, P1, extra.id("dd"), "recur");
  assert.equal(zoneOf(extra.engine, extra.id("foe")), "discard");
  assert.equal(zoneOf(extra.engine, extra.id("mine")), "play");
});

// ============================================================================
// Ecto-Agriolimax
// This card enters play with 2 tokens on it. -- SLITHER -- COST: Remove a token from this card. Pick an item or location. -- EFFECT: Put the card into its owner's hand.
// Character, arcanist, subtype insect, cost 3, [O][O], 1 str / 2 spd / 1 life.
// ============================================================================
const AGRIO = "0471df2b-e2f4-4e38-8053-7c60a0988ea3";

clause(AGRIO, "0:rule", "the card is an Arcanist insect, cost 3, [O][O], printed 1 / 2 / 1; deploying it spends exactly 3", () => {
  const p = printing(AGRIO);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.subtype], ["character", "arcanist", 3, "oo", ["insect"]]);
  assert.deepEqual([p.strength, p.speed, p.life], [1, 2, 1]);
  const mk = (o: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ea", def: printing(AGRIO), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", greed, P1)]
    });
  const ok = mk(2, 2);
  play(ok.engine, P1, ok.id("ea"));
  assert.equal(zoneOf(ok.engine, ok.id("ea")), "play");
  assert.equal(ready(ok.engine, P1), 1, "3 of 4 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("ea"), "strength"), ok.engine.getStat(ok.id("ea"), "speed"), ok.engine.getStat(ok.id("ea"), "life")], [1, 2, 1]);
  const two = mk(2, 0);
  refused(() => play(two.engine, P1, two.id("ea")), "2 resources", ANY);
  const oneO = mk(1, 5);
  refused(() => play(oneO.engine, P1, oneO.id("ea")), "only one [O]", ANY);
  assert.equal(zoneOf(oneO.engine, oneO.id("ea")), "hand");
});

clause(AGRIO, "0:rule", "deployed from hand it enters play with exactly 2 tokens on it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ea", def: printing(AGRIO), owner: P1, zone: "hand" }, ...bank("obsession", 3, P1)]
  });
  assert.equal(tokensOn(engine, id("ea")), 0, "no tokens in hand");
  play(engine, P1, id("ea"));
  assert.equal(zoneOf(engine, id("ea")), "play");
  assert.equal(tokensOn(engine, id("ea")), 2);
});

clause(AGRIO, "0:rule", "also when it enters play by an effect (put into play from the discard pile)", () => {
  const reanimate = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { owner: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(AGRIO), owner: P1, zone: "discard" },
      { key: "re", def: reanimate, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("re"), { selected: { t: [id("ea")] } });
  assert.equal(zoneOf(engine, id("ea")), "play");
  assert.equal(tokensOn(engine, id("ea")), 2);
});

clause(AGRIO, "0:rule", "only this card gets the tokens: a character entering play alongside it gets none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(AGRIO), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("ea"));
  assert.equal(tokensOn(engine, id("other")), 0);
});

clause(AGRIO, "0:rule", "tokens are added only when THIS card enters: other cards entering later do not give it more", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(AGRIO), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", cost: 0 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(engine, P1, id("ea"));
  play(engine, P1, id("mine"));
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(tokensOn(engine, id("ea")), 2, "my later character did not add tokens");
  assert.equal(tokensOn(engine, id("mine")), 0);
  passTurn(engine);
  play(engine, P2, id("theirs"));
  assert.equal(zoneOf(engine, id("theirs")), "play");
  assert.equal(tokensOn(engine, id("ea")), 2, "an opposing character did not add tokens");
});

function slitherBoard(tokens = 2) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(AGRIO), owner: P1, zone: "play", counters: tokens ? { token: tokens } : undefined },
      { key: "oItem", def: item({ name: "OItem" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "oLoc", def: location({ name: "OLoc" }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "oChar", def: character({ name: "OChar" }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "gone", def: item({ name: "Gone" }), owner: P2, zone: "discard" },
      { key: "held", def: item({ name: "Held" }), owner: P2, zone: "hand" },
      { key: "stolen", def: item({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: location({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }
    ]
  });
}

clause(AGRIO, "1:ability:slither", "removes a token from this card (2 to 1) and returns the picked opponent item to its owner's hand", () => {
  const { engine, id } = slitherBoard();
  activate(engine, P1, id("ea"), "slither", { selected: { c: [id("oItem")] } });
  assert.equal(tokensOn(engine, id("ea")), 1);
  assert.equal(zoneOf(engine, id("oItem")), "hand");
  assert.ok(handOf(engine, P2).includes(id("oItem")), "in its owner's hand");
});

clause(AGRIO, "1:ability:slither", "works on my own item, an opponent's location and my own location", () => {
  for (const [key, owner] of [["myItem", P1], ["oLoc", P2], ["myLoc", P1]] as const) {
    const { engine, id } = slitherBoard();
    activate(engine, P1, id("ea"), "slither", { selected: { c: [id(key)] } });
    assert.equal(zoneOf(engine, id(key)), "hand", key);
    assert.ok(handOf(engine, owner).includes(id(key)), `${key} in ${owner}'s hand`);
    assert.equal(tokensOn(engine, id("ea")), 1);
  }
});

clause(AGRIO, "1:ability:slither", "it goes to its OWNER's hand, not its controller's", () => {
  const a = slitherBoard();
  activate(a.engine, P1, a.id("ea"), "slither", { selected: { c: [a.id("stolen")] } });
  assert.ok(handOf(a.engine, P2).includes(a.id("stolen")), "owner P2");
  assert.equal(handOf(a.engine, P1).includes(a.id("stolen")), false);
  const b = slitherBoard();
  activate(b.engine, P1, b.id("ea"), "slither", { selected: { c: [b.id("lent")] } });
  assert.ok(handOf(b.engine, P1).includes(b.id("lent")), "owner P1");
  assert.equal(handOf(b.engine, P2).includes(b.id("lent")), false);
});

clause(AGRIO, "1:ability:slither", "only an item or location can be picked: characters (either side) are refused", () => {
  const { engine, id } = slitherBoard();
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("oChar")] } }), "opponent's character", ANY);
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("myChar")] } }), "my character", ANY);
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("ea")] } }), "itself", ANY);
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: {} }), "no pick", ANY);
  assert.equal(tokensOn(engine, id("ea")), 2, "no token was removed");
  assert.equal(zoneOf(engine, id("oChar")), "play");
});

clause(AGRIO, "1:ability:slither", "only cards in play can be picked: an item in the discard pile or hand is refused", () => {
  const { engine, id } = slitherBoard();
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("gone")] } }), "discarded item", ANY);
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("held")] } }), "item in hand", ANY);
  assert.equal(tokensOn(engine, id("ea")), 2);
  assert.equal(zoneOf(engine, id("gone")), "discard");
});

clause(AGRIO, "1:ability:slither", "the cost is a token: with no tokens it is refused, and each use removes exactly one", () => {
  const none = slitherBoard(0);
  refused(() => activate(none.engine, P1, none.id("ea"), "slither", { selected: { c: [none.id("oItem")] } }), "no tokens", ANY);
  assert.equal(zoneOf(none.engine, none.id("oItem")), "play");
  const { engine, id } = slitherBoard(2);
  activate(engine, P1, id("ea"), "slither", { selected: { c: [id("oItem")] } });
  activate(engine, P1, id("ea"), "slither", { selected: { c: [id("oLoc")] } });
  assert.equal(tokensOn(engine, id("ea")), 0);
  assert.deepEqual([zoneOf(engine, id("oItem")), zoneOf(engine, id("oLoc"))], ["hand", "hand"]);
  refused(() => activate(engine, P1, id("ea"), "slither", { selected: { c: [id("myItem")] } }), "tokens used up", ANY);
  assert.equal(zoneOf(engine, id("myItem")), "play");
});

clause(AGRIO, "1:ability:slither", "the token comes from this card, not from the picked card, and no depletion is needed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ea", def: printing(AGRIO), owner: P1, zone: "play", counters: { token: 1 }, depleted: true },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play", counters: { token: 3 } }
    ]
  });
  activate(engine, P1, id("ea"), "slither", { selected: { c: [id("it")] } });
  assert.equal(tokensOn(engine, id("ea")), 0);
  assert.equal(zoneOf(engine, id("it")), "hand");
  assert.equal(isDepleted(engine, id("ea")), true, "still depleted; it was usable while depleted");
});

// ============================================================================
// Ecto-Conduit
// At the start of your turn, you may draw three cards, then put two cards from your hand on top of your deck in any order.
// HARNESS -- COST: Destroy this card. -- EFFECT: Void the top card of your deck. If it is a tactic, you may deploy it as though it was in your hand even if you cannot meet its threshold.
// Item, arcanist, cost 3, [O][O][O].
// ============================================================================
const CONDUIT = "72521ca8-c28f-44c0-a843-79d8470ab975";

function conduitBoard(opts: { controller?: typeof P1 | typeof P2 } = {}) {
  const mk = (owner: typeof P1 | typeof P2, zone: "hand" | "deck", n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `${owner}${zone}${i}`, def: character({ name: `${owner}-${zone}-${i}` }), owner, zone }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ec", def: printing(CONDUIT), owner: P1, controller: opts.controller, zone: "play" },
      ...mk(P1, "hand", 3),
      ...mk(P1, "deck", 10),
      ...mk(P2, "hand", 3),
      ...mk(P2, "deck", 10)
    ]
  });
}
/** Passes P1's turn then P2's so the next turn start is P1's. */
const toP1Turn = (e: SpoilsEngine) => {
  passTurn(e);
  passTurn(e);
};

clause(CONDUIT, "0:rule", "the card is an Arcanist item, cost 3, [O][O][O]", () => {
  const p = printing(CONDUIT);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["item", "arcanist", 3, "ooo"]);
  const mk = (o: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ec", def: printing(CONDUIT), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", greed, P1)]
    });
  const ok = mk(3, 1);
  play(ok.engine, P1, ok.id("ec"));
  assert.equal(zoneOf(ok.engine, ok.id("ec")), "play");
  assert.equal(ready(ok.engine, P1), 1, "3 of 4 paid");
  const two = mk(2, 4);
  refused(() => play(two.engine, P1, two.id("ec")), "only two [O]", ANY);
  assert.equal(zoneOf(two.engine, two.id("ec")), "hand");
  const few = mk(2, 0);
  refused(() => play(few.engine, P1, few.id("ec")), "2 resources", ANY);
});

clause(CONDUIT, "0:rule", "at the start of my turn I am offered the choice; accepting draws exactly three cards", () => {
  const b = conduitBoard();
  const hand0 = handOf(b.engine, P1).length;
  const deck0 = deckOf(b.engine, P1).length;
  toP1Turn(b.engine);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay", "a 'you may' choice");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  assert.equal(handOf(b.engine, P1).length, hand0 + 3, "drew three");
  assert.equal(deckOf(b.engine, P1).length, deck0 - 3);
});

clause(CONDUIT, "0:rule", "after drawing I put exactly two cards from my hand on top of my deck", () => {
  const b = conduitBoard();
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  const hand = handOf(b.engine, P1);
  assert.equal(hand.length, 6);
  const [x, y] = [hand[0], hand[1]];
  pick(b.engine, [x, y]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(handOf(b.engine, P1).length, 4, "two left my hand");
  assert.equal(zoneOf(b.engine, x), "deck");
  assert.equal(zoneOf(b.engine, y), "deck");
  assert.deepEqual(new Set(deckOf(b.engine, P1).slice(0, 2)), new Set([x, y]), "they are the top two cards");
});

clause(CONDUIT, "0:rule", "I can put back the cards I just drew, and cards I already held", () => {
  const b = conduitBoard();
  const held = handOf(b.engine, P1);
  const top3 = deckOf(b.engine, P1).slice(0, 3);
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  pick(b.engine, [top3[0], top3[1]]);
  assert.deepEqual(new Set(deckOf(b.engine, P1).slice(0, 2)), new Set([top3[0], top3[1]]), "just-drawn cards go back");
  const c = conduitBoard();
  const held2 = handOf(c.engine, P1);
  toP1Turn(c.engine);
  answerChoice(c.engine, { kind: "mayPay", pay: true });
  pick(c.engine, [held2[0], held2[1]]);
  assert.deepEqual(new Set(deckOf(c.engine, P1).slice(0, 2)), new Set([held2[0], held2[1]]), "held cards go back");
  void held;
});

clause(CONDUIT, "0:rule", "'in any order': either order of the two cards can be achieved", () => {
  const order = (swap: boolean) => {
    const b = conduitBoard();
    toP1Turn(b.engine);
    answerChoice(b.engine, { kind: "mayPay", pay: true });
    const hand = handOf(b.engine, P1);
    pick(b.engine, swap ? [hand[1], hand[0]] : [hand[0], hand[1]]);
    return deckOf(b.engine, P1).slice(0, 2).map((c) => hand.indexOf(c));
  };
  const a = order(false);
  const b = order(true);
  assert.deepEqual([...a].sort(), [0, 1], "the two chosen cards are on top");
  assert.deepEqual(b, [a[1], a[0]], "choosing them in the other order reverses the top two");
});

clause(CONDUIT, "0:rule", "the put-back is mandatory: choosing fewer than two cards is refused", () => {
  const b = conduitBoard();
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  const hand = handOf(b.engine, P1);
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] }), "zero cards", ANY);
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [hand[0]] }), "one card", ANY);
  assert.equal(handOf(b.engine, P1).length, 6);
});

clause(CONDUIT, "0:rule", "only cards from my own hand can be put back", () => {
  const b = conduitBoard();
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  const hand = handOf(b.engine, P1);
  const theirs = handOf(b.engine, P2);
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [hand[0], theirs[0]] }), "opponent's hand card", ANY);
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [hand[0], b.id("ec")] }), "a card in play", ANY);
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(CONDUIT, "0:rule", "I cannot put back more than two cards (three are refused)", () => {
  const b = conduitBoard();
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  const hand = handOf(b.engine, P1);
  refused(() => answerChoice(b.engine, { kind: "chooserSelectsTarget", selected: [hand[0], hand[1], hand[2]] }), "three cards", ANY);
  pick(b.engine, [hand[0], hand[1]]);
  assert.equal(handOf(b.engine, P1).length, 4);
});

clause(CONDUIT, "0:rule", "declining ('may') draws nothing and puts nothing back", () => {
  const b = conduitBoard();
  const hand0 = handOf(b.engine, P1);
  const deck0 = deckOf(b.engine, P1);
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: false });
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(handOf(b.engine, P1), hand0);
  assert.deepEqual(deckOf(b.engine, P1), deck0);
});

clause(CONDUIT, "0:rule", "it does not fire at the start of the opponent's turn", () => {
  const b = conduitBoard();
  const hand0 = handOf(b.engine, P1);
  passTurn(b.engine);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined, "no prompt on the opponent's turn start");
  assert.deepEqual(handOf(b.engine, P1), hand0);
});

clause(CONDUIT, "0:rule", "'your turn' is its controller's: an Ecto-Conduit I own but the opponent controls fires on their turn, not mine", () => {
  const b = conduitBoard({ controller: P2 });
  const mine0 = handOf(b.engine, P1);
  passTurn(b.engine);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine)?.kind, "mayPay", "its controller is offered the draw at their turn start");
  assert.equal(pending(b.engine)?.playerId, P2);
  answerChoice(b.engine, { kind: "mayPay", pay: false });
  passTurn(b.engine);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine), undefined, "no prompt for me at my turn start: I do not control it");
  assert.deepEqual(handOf(b.engine, P1), mine0);
  const c = conduitBoard({ controller: P2 });
  const theirs0 = handOf(c.engine, P2).length;
  passTurn(c.engine);
  answerChoice(c.engine, { kind: "mayPay", pay: true });
  assert.equal(handOf(c.engine, P2).length, theirs0 + 3, "its controller draws");
});

clause(CONDUIT, "0:rule", "it fires every one of my turns, not only the first", () => {
  const b = conduitBoard();
  toP1Turn(b.engine);
  answerChoice(b.engine, { kind: "mayPay", pay: false });
  toP1Turn(b.engine);
  assert.equal(b.engine.state.turn, 5);
  assert.equal(pending(b.engine)?.kind, "mayPay");
});

function harnessBoard(topKind: "tactic" | "character" | "none", opts: { res?: number } = {}) {
  const zap = tactic({
    name: "Zap",
    cost: 2,
    threshold: "g",
    behavior: { abilities: [{ id: "z", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ec", def: printing(CONDUIT), owner: P1, zone: "play" },
      ...(topKind === "none" ? [] : [{ key: "top", def: topKind === "tactic" ? zap : character({ name: "TopChar" }), owner: P1, zone: "deck" as const }]),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      { key: "ot", def: character({ name: "OppTop" }), owner: P2, zone: "deck" },
      ...volition(opts.res ?? 2, P1)
    ]
  });
}

clause(CONDUIT, "1:ability:harness", "the COST destroys this card; the top card of my deck is voided, and only that card", () => {
  const { engine, id } = harnessBoard("character");
  activate(engine, P1, id("ec"), "harness");
  assert.equal(zoneOf(engine, id("ec")), "discard", "destroyed as the cost");
  assert.equal(zoneOf(engine, id("top")), "void");
  assert.equal(zoneOf(engine, id("d0")), "deck", "the second card is untouched");
  assert.equal(deckOf(engine, P1)[0], id("d0"));
  assert.equal(zoneOf(engine, id("ot")), "deck", "the opponent's deck is untouched");
  assert.equal(pending(engine), undefined, "a non-tactic offers no deploy");
});

clause(CONDUIT, "1:ability:harness", "it needs a card to destroy: not usable once it has left play", () => {
  const { engine, id } = harnessBoard("character");
  activate(engine, P1, id("ec"), "harness");
  refused(() => activate(engine, P1, id("ec"), "harness"), "already destroyed", ANY);
  assert.equal(zoneOf(engine, id("d0")), "deck", "a second void did not happen");
});

clause(CONDUIT, "1:ability:harness", "the voided card is the top of MY deck: the opponent's deck order is unchanged", () => {
  const { engine, id } = harnessBoard("character");
  const theirs = deckOf(engine, P2);
  activate(engine, P1, id("ec"), "harness");
  assert.deepEqual(deckOf(engine, P2), theirs);
});

clause(CONDUIT, "1:ability:harness", "a voided tactic can be deployed: accepting pays its cost (2), ignores its unmet [G] threshold and resolves it", () => {
  const { engine, id } = harnessBoard("tactic");
  const hand0 = handOf(engine, P1).length;
  activate(engine, P1, id("ec"), "harness");
  assert.equal(zoneOf(engine, id("top")), "void", "voided first");
  assert.equal(pending(engine)?.kind, "deployForFree", "I am offered the option to deploy it");
  answerChoice(engine, { kind: "deployForFree", cardId: id("top") });
  resolvePendingResponses(engine);
  assert.equal(ready(engine, P1), 0, "its cost of 2 was paid");
  assert.equal(handOf(engine, P1).length, hand0 + 1, "its effect (draw 1) resolved");
  assert.equal(zoneOf(engine, id("top")), "discard", "the deployed tactic is discarded");
});

clause(CONDUIT, "1:ability:harness", "declining the optional deploy leaves the tactic in the void and pays nothing", () => {
  const { engine, id } = harnessBoard("tactic");
  activate(engine, P1, id("ec"), "harness");
  assert.equal(pending(engine)?.kind, "deployForFree", "I am offered the option to deploy it");
  answerChoice(engine, { kind: "deployForFree" });
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("top")), "void");
  assert.equal(ready(engine, P1), 2);
});

clause(CONDUIT, "1:ability:harness", "the voided tactic still costs its numeric cost: with 1 resource it cannot be deployed", () => {
  const { engine, id } = harnessBoard("tactic", { res: 1 });
  activate(engine, P1, id("ec"), "harness");
  assert.equal(pending(engine)?.kind, "deployForFree", "the deploy option is still offered");
  refused(() => answerChoice(engine, { kind: "deployForFree", cardId: id("top") }), "cost 2 with 1 resource", /cannot be paid|Costs/i);
  assert.equal(zoneOf(engine, id("top")), "void");
  assert.equal(ready(engine, P1), 1, "nothing was paid");
});

clause(CONDUIT, "1:ability:harness", "with an empty deck the ability does nothing further (and nothing is pending)", () => {
  const { engine, id } = harnessBoard("none");
  for (const k of ["d0", "d1", "d2", "d3", "d4", "d5"]) engine.state.cards[id(k)].zone = "discard" as never;
  engine.state.players[P1].deck = [];
  activate(engine, P1, id("ec"), "harness");
  assert.equal(zoneOf(engine, id("ec")), "discard");
  assert.equal(pending(engine), undefined);
});

void answerPending;
