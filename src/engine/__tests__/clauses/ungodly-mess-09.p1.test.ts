// Clause tests, batch ungodly-mess-09, part p1 (groups 1-7, only clauses not yet covered).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, killTactic, P1, P2, play, resolvePendingResponses, tactic } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn, spentResources, settleStartFirst } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { PlayerId } from "../../../engine.js";

type Game = ReturnType<typeof buildGame>;
const other = (p: PlayerId): PlayerId => (p === P1 ? P2 : P1);
const dmg = (g: Game, key: string): number => g.engine.state.cards[g.id(key)].damage ?? 0;
const pickT = (...ids: string[]) => (pc: PendingChoiceLike) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);
const answerT = (g: Game, ids: string[]) => {
  const pc = pending(g.engine)!;
  g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(g.engine);
  settleStartFirst(g.engine); // the pick was at the end of my turn: the opponent's turn start follows
};
/** Answers each successive chooserSelectsTarget with picks[i] (null = decline); returns the number of prompts seen. */
function runPicks(g: Game, picks: (string | null)[]): number {
  let n = 0;
  while (pending(g.engine) && n < 8) {
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", "only target picks expected");
    const pick = picks[n++] ?? null;
    answerT(g, pick ? [g.id(pick)] : []);
  }
  assert.equal(pending(g.engine), undefined, "no pending choice left");
  return n;
}
const flipUp = (g: Game, key: string, player: PlayerId = P1) => {
  flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id(key), selected: {}, variables: {} });
  resolvePendingResponses(g.engine);
};
/** Deterministic rng so shuffles are reproducible. */
const lcg = (seed = 7) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ready = (g: Game, p: PlayerId = P1) => readyResources(g.engine, p);
const turnOf = (active: PlayerId) => (active === P1 ? 3 : 2);
const faction = (g: Game, p: PlayerId) => g.engine.state.players[p].factionId!;

/** A board with the card under test in hand and `banks` for P1. */
function handBoard(id: string, banks: CardPlacement[], extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P1,
    cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...banks, ...extra]
  });
}
const rageBanks = (n: number): CardPlacement[] => bank("rage", n, P1);
const mixedBanks = (rage: number, greed: number): CardPlacement[] => [...bank("rage", rage, P1), ...bank("greed", greed, P1)];

// =====================================================================
// Corrosive Waste Dispenser — item, warlord, cost 3, [R][R][R]
// =====================================================================
const CWD = "083e0cca-f86f-4922-9bf5-04d254ebfc4e";

function cwdBoard(o: { rage?: number; tokens?: number; owner?: PlayerId; controller?: PlayerId; active?: PlayerId; faceDown?: boolean; oppChars?: number; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  const opp = other(active);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      { key: "cwd", def: printing(CWD), owner: o.owner ?? active, controller: o.controller ?? active, zone: "play", counters: { token: o.tokens ?? 4 }, faceDown: o.faceDown },
      { key: "sac", def: character({ name: "Sac", life: 3 }), owner: active, zone: "play" },
      { key: "sac2", def: character({ name: "Sac2", life: 3 }), owner: active, zone: "play" },
      { key: "oppItem", def: item({ name: "OppItem" }), owner: opp, zone: "play" },
      ...Array.from({ length: o.oppChars ?? 2 }, (_, i) => ({ key: `opp${i}`, def: character({ name: `Opp${i}`, life: 5 }), owner: opp, zone: "play" as const })),
      ...bank("rage", o.rage ?? 4, active),
      ...(o.extra ?? [])
    ]
  });
}
const convert = (g: Game, sac: string, player: PlayerId = P1) => activate(g.engine, player, g.id("cwd"), "convert", { selected: { sac: [g.id(sac)] } });

clause(CWD, "0:rule", "type item, printed cost 3: deploys with exactly 3 resources (cost isolated by spent [R] icons), refused with 2", () => {
  const def = printing(CWD);
  assert.equal(def.type, "item");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "rrr");
  assert.equal(def.trade, "warlord");
  const ok = handBoard(CWD, [...spentResources(P1, 3), ...rageBanks(3)]);
  play(ok.engine, P1, ok.id("c"), {});
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.deepEqual(ok.engine.getCardTypes(ok.id("c")), ["item"]);
  assert.equal(ready(ok), 0, "exactly 3 paid");
  const short = handBoard(CWD, [...spentResources(P1, 3), ...rageBanks(2)]);
  refused(() => play(short.engine, P1, short.id("c"), {}), "cost short by 1");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
});

clause(CWD, "0:rule", "threshold [R][R][R]: three resources with only two [R] icons are refused", () => {
  const short = handBoard(CWD, mixedBanks(2, 1));
  refused(() => play(short.engine, P1, short.id("c"), {}), "threshold short by one icon");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  const ok = handBoard(CWD, mixedBanks(3, 1));
  play(ok.engine, P1, ok.id("c"), {});
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  const opp = handBoard(CWD, [...mixedBanks(2, 1), ...bank("rage", 1, P2)]);
  refused(() => play(opp.engine, P1, opp.id("c"), {}), "the opponent's [R] does not count");
});

clause(CWD, "0:rule", "enters play with exactly 4 tokens on it", () => {
  const g = handBoard(CWD, rageBanks(3));
  assert.equal(tokensOn(g.engine, g.id("c")), 0, "none in hand");
  play(g.engine, P1, g.id("c"), {});
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(tokensOn(g.engine, g.id("c")), 4);
  assert.equal(g.engine.state.cards[g.id("c")].faceDown, false, "still face-up");
});

clause(CWD, "0:rule", "other cards entering play do not give it tokens", () => {
  const g = cwdBoard({ tokens: 2, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"), {});
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(tokensOn(g.engine, g.id("cwd")), 2, "unchanged");
});

clause(CWD, "1:rule", "when its last token is removed it flips face-down (an owner-controlled resource)", () => {
  const g = cwdBoard({ tokens: 1 });
  convert(g, "sac");
  answerT(g, [g.id("opp0")]);
  const c = g.engine.state.cards[g.id("cwd")];
  assert.equal(c.counters?.token ?? 0, 0);
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true, "flipped face-down");
  assert.equal(g.engine.isResource(g.id("cwd")), true, "a face-down card is a resource");
  assert.equal(c.controllerId, P1);
});

clause(CWD, "1:rule", "it flips face-down 'under its owner's control': a stolen dispenser returns to its owner", () => {
  const g = cwdBoard({ tokens: 1, owner: P1, controller: P2, active: P2 });
  convert(g, "sac", P2);
  answerT(g, [g.id("opp0")]);
  const c = g.engine.state.cards[g.id("cwd")];
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1, "controlled by its owner P1, not P2");
  assert.equal(c.zone, "play");
});

clause(CWD, "1:rule", "with a token left (2 -> 1) it stays face-up; the next use flips it", () => {
  const g = cwdBoard({ tokens: 2 });
  convert(g, "sac");
  answerT(g, [g.id("opp0")]);
  assert.equal(tokensOn(g.engine, g.id("cwd")), 1);
  assert.equal(g.engine.state.cards[g.id("cwd")].faceDown, false);
  convert(g, "sac2");
  answerT(g, [g.id("opp1")]);
  assert.equal(tokensOn(g.engine, g.id("cwd")), 0);
  assert.equal(g.engine.state.cards[g.id("cwd")].faceDown, true);
});

clause(CWD, "1:rule", "another card running out of tokens does not flip the dispenser", () => {
  const drainer = item({
    name: "Drainer",
    behavior: { abilities: [{ id: "rm", type: "activated", effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] }] }
  });
  const g = cwdBoard({ tokens: 3, extra: [{ key: "dr", def: drainer, owner: P1, zone: "play", counters: { token: 1 } }] });
  activate(g.engine, P1, g.id("dr"), "rm", {});
  assert.equal(tokensOn(g.engine, g.id("dr")), 0);
  assert.equal(g.engine.state.cards[g.id("cwd")].faceDown, false);
  assert.equal(tokensOn(g.engine, g.id("cwd")), 3);
});

clause(CWD, "1:rule", "a dispenser already at 0 tokens is not flipped by some other card's counters changing", () => {
  const drainer = item({
    name: "Drainer",
    behavior: { abilities: [{ id: "rm", type: "activated", effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] }] }
  });
  const g = cwdBoard({ tokens: 0, extra: [{ key: "dr", def: drainer, owner: P1, zone: "play", counters: { token: 1 } }] });
  activate(g.engine, P1, g.id("dr"), "rm", {});
  assert.equal(tokensOn(g.engine, g.id("dr")), 0);
  assert.equal(g.engine.state.cards[g.id("cwd")].faceDown, false);
});

clause(CWD, "2:ability:convert", "pays 1, removes one token, destroys the chosen character; the opponent then destroys a character of their choice", () => {
  const g = cwdBoard();
  const before = ready(g);
  convert(g, "sac");
  assert.equal(before - ready(g), 1, "pay 1");
  assert.equal(tokensOn(g.engine, g.id("cwd")), 3, "one token removed");
  assert.equal(zoneOf(g.engine, g.id("sac")), "discard", "cost: my chosen character destroyed");
  assert.equal(zoneOf(g.engine, g.id("sac2")), "play", "only the chosen one");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  answerT(g, [g.id("opp1")]);
  assert.equal(zoneOf(g.engine, g.id("opp1")), "discard", "the opponent's pick is destroyed");
  assert.equal(zoneOf(g.engine, g.id("opp0")), "play", "their other character survives");
  assert.equal(zoneOf(g.engine, g.id("sac2")), "play");
  assert.equal(pending(g.engine), undefined);
});

clause(CWD, "2:ability:convert", "the opponent may only destroy a character THEY control (not one of mine)", () => {
  const g = cwdBoard();
  convert(g, "sac");
  refused(() => answerT(g, [g.id("sac2")]), "my remaining character is not a legal pick for the opponent");
  assert.equal(zoneOf(g.engine, g.id("sac2")), "play");
  answerT(g, [g.id("opp0")]);
  assert.equal(zoneOf(g.engine, g.id("opp0")), "discard");
});

clause(CWD, "2:ability:convert", "the opponent must destroy a CHARACTER: their item is not a legal pick", () => {
  const g = cwdBoard();
  convert(g, "sac");
  refused(() => answerT(g, [g.id("oppItem")]), "an item");
  assert.equal(zoneOf(g.engine, g.id("oppItem")), "play");
  answerT(g, [g.id("opp0")]);
  assert.equal(zoneOf(g.engine, g.id("opp0")), "discard");
});

clause(CWD, "2:ability:convert", "the opponent's destroy is mandatory: declining the pick is refused", () => {
  const g = cwdBoard();
  convert(g, "sac");
  refused(() => answerT(g, []), "mandatory destroy");
  assert.ok(pending(g.engine), "still waiting for the pick");
});

clause(CWD, "2:ability:convert", "with an opponent who has only one character, that character is destroyed", () => {
  const g = cwdBoard({ oppChars: 1 });
  convert(g, "sac");
  if (pending(g.engine)) answerT(g, [g.id("opp0")]);
  assert.equal(zoneOf(g.engine, g.id("opp0")), "discard");
  assert.equal(pending(g.engine), undefined);
});

clause(CWD, "2:ability:convert", "an opponent with no characters: the costs are still paid and nothing hangs", () => {
  const g = cwdBoard({ oppChars: 0 });
  convert(g, "sac");
  if (pending(g.engine)) drain(g.engine, pickT());
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sac")), "discard");
  assert.equal(tokensOn(g.engine, g.id("cwd")), 3);
});

clause(CWD, "2:ability:convert", "refused with no resource to pay 1 (positive control with 1)", () => {
  const none = cwdBoard({ rage: 0 });
  refused(() => convert(none, "sac"), "cannot pay 1");
  assert.equal(zoneOf(none.engine, none.id("sac")), "play");
  assert.equal(tokensOn(none.engine, none.id("cwd")), 4);
  const one = cwdBoard({ rage: 1 });
  convert(one, "sac");
  answerT(one, [one.id("opp0")]);
  assert.equal(zoneOf(one.engine, one.id("sac")), "discard");
});

clause(CWD, "2:ability:convert", "refused when the dispenser has no token to remove", () => {
  const g = cwdBoard({ tokens: 0 });
  refused(() => convert(g, "sac"), "no token");
  assert.equal(zoneOf(g.engine, g.id("sac")), "play");
  assert.equal(ready(g), 4, "nothing was paid");
});

clause(CWD, "2:ability:convert", "the sacrificed character must be mine: an opponent's character is refused", () => {
  const g = cwdBoard();
  refused(() => convert(g, "opp0"), "opponent's character");
  assert.equal(zoneOf(g.engine, g.id("opp0")), "play");
  assert.equal(tokensOn(g.engine, g.id("cwd")), 4);
});

clause(CWD, "2:ability:convert", "the sacrificed card must be a character: my item is refused", () => {
  const g = cwdBoard({ extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }] });
  refused(() => convert(g, "itm"), "an item");
  assert.equal(zoneOf(g.engine, g.id("itm")), "play");
});

clause(CWD, "2:ability:convert", "'you control' means control, not ownership: a character I control but the opponent owns can be sacrificed; one I own but they control cannot", () => {
  const g = cwdBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  refused(() => convert(g, "lent"), "controlled by the opponent");
  assert.equal(zoneOf(g.engine, g.id("lent")), "play");
  convert(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
});

clause(CWD, "2:ability:convert", "a Micromajig token (subtype majig) cannot be the sacrifice (a non-micromajig character can)", () => {
  const g = cwdBoard({ extra: [{ key: "mm", def: character({ name: "Micromajig", subtype: ["majig"] }), owner: P1, zone: "play" }] });
  g.engine.state.cards[g.id("mm")].isToken = true;
  refused(() => convert(g, "mm"), "micromajig");
  assert.equal(zoneOf(g.engine, g.id("mm")), "play");
  assert.equal(tokensOn(g.engine, g.id("cwd")), 4);
  convert(g, "sac");
  assert.equal(zoneOf(g.engine, g.id("sac")), "discard");
});

clause(CWD, "2:ability:convert", "only a Micromajig is excluded: another kind of token (not majig) and a non-token character of subtype majig named differently can both be the sacrifice", () => {
  const spirit = cwdBoard({ extra: [{ key: "spirit", def: character({ name: "Spirit", subtype: ["ghost"] }), owner: P1, zone: "play" }] });
  spirit.engine.state.cards[spirit.id("spirit")].isToken = true;
  convert(spirit, "spirit");
  answerT(spirit, [spirit.id("opp0")]);
  assert.notEqual(spirit.engine.state.cards[spirit.id("spirit")]?.zone, "play", "a non-Micromajig token is a valid sacrifice (it left play)");
  assert.equal(zoneOf(spirit.engine, spirit.id("opp0")), "discard", "and the opponent destroyed a character");
  const gadget = cwdBoard({ extra: [{ key: "gadget", def: character({ name: "Gadget", subtype: ["majig"] }), owner: P1, zone: "play" }] });
  convert(gadget, "gadget");
  answerT(gadget, [gadget.id("opp0")]);
  assert.equal(zoneOf(gadget.engine, gadget.id("gadget")), "discard", "a majig-subtype character that is not a token is a valid sacrifice");
});

clause(CWD, "2:ability:convert", "a real Micromajig token cannot be the sacrifice", () => {
  const AVALANCHE = "650c9fb9-8190-466f-b142-5d010659eed3"; // 2nd Edition: its token is a "majig" (the 1st Edition reminder text gives no subtype)
  const g = cwdBoard({
    extra: [{ key: "av", def: printing(AVALANCHE), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
  });
  play(g.engine, P1, g.id("av"), { variables: { x: 1 } });
  drain(g.engine, declineAll);
  const tokens = Object.values(g.engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === P1 && g.engine.getDefinition(c.id).name === "Micromajig");
  assert.equal(tokens.length, 1, "one Micromajig token");
  refused(() => activate(g.engine, P1, g.id("cwd"), "convert", { selected: { sac: [tokens[0].id] } }), "a Micromajig token is a micromajig");
  assert.equal(zoneOf(g.engine, tokens[0].id), "play");
});

// =====================================================================
// Crimson Pandiatus — character, warlord, subtype beast, cost 2, [R], 5/3/1
// =====================================================================
const PAN = "5ce550a8-1829-4b9c-bde7-a1b7bb33c29f";

function panBoard(o: { rage?: number; spent?: number; greed?: number; oppRage?: number; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      { key: "pan", def: printing(PAN), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 4 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.spent ? spentResources(P1, o.spent) : []),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.oppRage ?? 0, P2)
    ]
  });
}
const attackRaw = (g: Game, player: PlayerId, keys: string[]) =>
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: keys.map((k) => g.id(k)), target: { type: "faction", playerId: other(player) } });
const attack = (g: Game, player: PlayerId, keys: string[]) => {
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: keys.map((k) => g.id(k)), target: { type: "faction", playerId: other(player) } });
  resolvePendingResponses(g.engine);
};

clause(PAN, "0:rule", "printed cost 2, [R], character beast 5 strength / 3 speed / 1 life; deploys with exactly 2, refused with 1 or without [R]", () => {
  const def = printing(PAN);
  assert.deepEqual([def.type, def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], ["character", 2, "r", 5, 3, 1, ["beast"]]);
  const ok = handBoard(PAN, rageBanks(2));
  play(ok.engine, P1, ok.id("c"), {});
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok), 0, "exactly 2 paid");
  assert.equal(ok.engine.getStat(ok.id("c"), "strength"), 5);
  assert.equal(ok.engine.getStat(ok.id("c"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("c"), "life"), 1);
  const short = handBoard(PAN, rageBanks(1));
  refused(() => play(short.engine, P1, short.id("c"), {}), "one short");
  const noIcon = handBoard(PAN, mixedBanks(0, 2));
  refused(() => play(noIcon.engine, P1, noIcon.id("c"), {}), "no [R]");
  const spentOnly = handBoard(PAN, [...spentResources(P1, 1), ...rageBanks(1)]);
  refused(() => play(spentOnly.engine, P1, spentOnly.id("c"), {}), "cost 2 is short (1 ready) even though a spent [R] gives the threshold");
  const iso = handBoard(PAN, [...spentResources(P1, 1), ...rageBanks(2)]);
  play(iso.engine, P1, iso.id("c"), {});
  assert.equal(zoneOf(iso.engine, iso.id("c")), "play");
});

clause(PAN, "0:rule", "this character cannot attack, alone or in a party; other characters can", () => {
  const g = panBoard();
  assert.ok(g.engine.getRestrictions(g.id("pan")).includes("cannotAttack"), "g.engine.getRestrictions(g.id(\"pan\")).includes(\"cannotAttack\")");
  refused(() => attack(g, P1, ["pan"]), "Pandiatus attacking alone", /attack/i);
  assert.equal(g.engine.state.battle, undefined);
  refused(() => attack(g, P1, ["pan", "ally"]), "Pandiatus in a party", /attack/i);
  assert.equal(g.engine.state.battle, undefined);
  attack(g, P1, ["ally"]);
  assert.ok(g.engine.state.battle, "positive control: the ally attacks");
});

clause(PAN, "0:rule", "it can still block (only attacking is forbidden)", () => {
  const g = panBoard({ active: P2 });
  attack(g, P2, ["foe"]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("pan")] });
  assert.ok(g.engine.state.battle, "blocker accepted");
});

clause(PAN, "1:rule@rrrrrr", "with six [R]: gains 4 life (1 -> 5); strength and speed unchanged", () => {
  const g = panBoard({ rage: 6 });
  assert.equal(g.engine.getStat(g.id("pan"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("pan"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("pan"), "speed"), 3);
});

clause(PAN, "1:rule@rrrrrr", "with five [R], or [R] plus other icons, or only the opponent's [R], it gets no life", () => {
  const five = panBoard({ rage: 5 });
  assert.equal(five.engine.getStat(five.id("pan"), "life"), 1);
  const greed = panBoard({ rage: 5, greed: 3 });
  assert.equal(greed.engine.getStat(greed.id("pan"), "life"), 1, "5 [R] plus other icons is still short");
  const opp = panBoard({ rage: 5, oppRage: 4 });
  assert.equal(opp.engine.getStat(opp.id("pan"), "life"), 1, "the opponent's [R] do not count");
});

clause(PAN, "1:rule@rrrrrr", "spent [R] resources still count toward the six", () => {
  const g = panBoard({ spent: 3, rage: 3 });
  assert.equal(g.engine.getStat(g.id("pan"), "life"), 5);
});

clause(PAN, "1:rule@rrrrrr", "with six [R] it loses all other rules text: it can attack; with five it still cannot", () => {
  const six = panBoard({ rage: 6 });
  assert.equal(six.engine.getRestrictions(six.id("pan")).includes("cannotAttack"), false, "restriction text gone");
  attack(six, P1, ["pan"]);
  assert.ok(six.engine.state.battle, "Pandiatus attacks with six [R]");
  const five = panBoard({ rage: 5 });
  assert.ok(five.engine.getRestrictions(five.id("pan")).includes("cannotAttack"), "five.engine.getRestrictions(five.id(\"pan\")).includes(\"cannotAttack\")");
  refused(() => attack(five, P1, ["pan"]), "five [R]: still cannot attack", /attack/i);
});

// =====================================================================
// Difference of Opinion — tactic, warlord, cost 2, [R][R][R]
// =====================================================================
const DOO = "66225aa8-ee86-47da-ab3c-a72cbed7b6ce";

function dooBoard(o: { banks?: CardPlacement[]; faceDown?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      { key: "doo", def: printing(DOO), owner: P1, zone: o.faceDown ? "play" : "hand", faceDown: o.faceDown },
      { key: "a1", def: character({ name: "A1", life: 6 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", life: 6 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", life: 6 }), owner: P1, zone: "play" },
      { key: "t1", def: character({ name: "T1", life: 6 }), owner: P2, zone: "play" },
      { key: "t2", def: character({ name: "T2", life: 6 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      ...(o.banks ?? rageBanks(6)),
      ...(o.extra ?? [])
    ]
  });
}

clause(DOO, "0:rule", "type tactic, printed cost 2, [R][R][R]: plays with exactly 2 ready (cost isolated by a spent [R]); refused with 1 ready; refused with only two [R] icons", () => {
  const def = printing(DOO);
  assert.deepEqual([def.type, def.cost, def.threshold, def.trade], ["tactic", 2, "rrr", "warlord"]);
  const ok = dooBoard({ banks: [...spentResources(P1, 1), ...rageBanks(2)] });
  play(ok.engine, P1, ok.id("doo"), {});
  assert.equal(ready(ok), 0, "exactly 2 paid");
  runPicks(ok, [null]);
  assert.equal(zoneOf(ok.engine, ok.id("doo")), "discard");
  const costShort = dooBoard({ banks: [...spentResources(P1, 2), ...rageBanks(1)] });
  refused(() => play(costShort.engine, P1, costShort.id("doo"), {}), "cost short by 1");
  assert.equal(zoneOf(costShort.engine, costShort.id("doo")), "hand");
  const iconShort = dooBoard({ banks: rageBanks(2) });
  refused(() => play(iconShort.engine, P1, iconShort.id("doo"), {}), "two [R] only");
  const iconShort2 = dooBoard({ banks: mixedBanks(2, 1) });
  refused(() => play(iconShort2.engine, P1, iconShort2.id("doo"), {}), "[R][R] plus a greed");
});

clause(DOO, "0:rule", "outside combat: pick a character, it takes exactly 1 damage, and only one pick is offered", () => {
  const g = dooBoard();
  play(g.engine, P1, g.id("doo"), {});
  assert.equal(runPicks(g, ["t1"]), 1, "a single prompt");
  assert.equal(dmg(g, "t1"), 1);
  assert.equal(dmg(g, "t2"), 0);
  assert.equal(dmg(g, "a1"), 0);
});

clause(DOO, "0:rule", "the character may be one of mine (any character)", () => {
  const g = dooBoard();
  play(g.engine, P1, g.id("doo"), {});
  runPicks(g, ["a2"]);
  assert.equal(dmg(g, "a2"), 1);
});

clause(DOO, "0:rule", "'you may': declining the pick deals no damage to anyone", () => {
  const g = dooBoard();
  play(g.engine, P1, g.id("doo"), {});
  assert.equal(runPicks(g, [null]), 1);
  for (const k of ["a1", "a2", "a3", "t1", "t2", "weak"]) assert.equal(dmg(g, k), 0, k);
  assert.equal(zoneOf(g.engine, g.id("doo")), "discard", "the tactic still resolved");
});

clause(DOO, "0:rule", "1 damage destroys a 1-life character", () => {
  const g = dooBoard();
  play(g.engine, P1, g.id("doo"), {});
  runPicks(g, ["weak"]);
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard");
});

clause(DOO, "0:rule", "only characters can be picked: items and factions are refused", () => {
  const g = dooBoard();
  play(g.engine, P1, g.id("doo"), {});
  refused(() => answerT(g, [g.id("myItem")]), "an item");
  refused(() => answerT(g, [g.id("theirItem")]), "their item");
  refused(() => answerT(g, [faction(g, P2)]), "a faction");
  assert.ok(pending(g.engine), "still waiting");
  answerT(g, [g.id("t1")]);
  assert.equal(dmg(g, "t1"), 1);
});

clause(DOO, "0:rule", "an attacking party of exactly 1 member: no second pick, still only 1 damage", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1"]);
  play(g.engine, P1, g.id("doo"), {});
  assert.equal(runPicks(g, ["t1"]), 1);
  assert.equal(dmg(g, "t1"), 1);
});

clause(DOO, "0:rule", "I control an attacking party of 2: a second pick deals 2 damage (1 to the first pick, 2 to the second)", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2"]);
  play(g.engine, P1, g.id("doo"), {});
  assert.equal(runPicks(g, ["t1", "t2"]), 2);
  assert.equal(dmg(g, "t1"), 1);
  assert.equal(dmg(g, "t2"), 2);
  assert.equal(dmg(g, "a1"), 0);
});

clause(DOO, "0:rule", "its controller makes both picks, and each pick is ONE character (two cards in one pick are refused)", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2"]);
  play(g.engine, P1, g.id("doo"), {});
  const first = pending(g.engine)!;
  assert.equal(first.kind, "chooserSelectsTarget", "first pick");
  assert.equal(first.playerId, P1, "the tactic's controller picks");
  refused(() => answerT(g, [g.id("t1"), g.id("t2")]), "two cards in the first pick");
  assert.equal(dmg(g, "t1") + dmg(g, "t2"), 0, "nothing was damaged by the refused pick");
  answerT(g, [g.id("t1")]);
  const second = pending(g.engine)!;
  assert.equal(second.kind, "chooserSelectsTarget", "second pick");
  assert.equal(second.playerId, P1, "the controller makes the second pick too");
  refused(() => answerT(g, [g.id("t1"), g.id("t2")]), "two cards in the second pick");
  assert.equal(dmg(g, "t1"), 1, "only the first pick's damage so far");
  assert.equal(dmg(g, "t2"), 0, "t2 untouched by the refused pick");
  answerT(g, [g.id("t2")]);
  assert.equal(dmg(g, "t2"), 2, "control: one character takes the 2 damage");
});

clause(DOO, "0:rule", "both picks may be the same character (1 + 2 = 3 damage)", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2"]);
  play(g.engine, P1, g.id("doo"), {});
  runPicks(g, ["t1", "t1"]);
  assert.equal(dmg(g, "t1"), 3);
});

clause(DOO, "0:rule", "party of 2: each pick is optional (decline the first, take the second; and the reverse; and both)", () => {
  const a = dooBoard();
  attackRaw(a, P1, ["a1", "a2"]);
  play(a.engine, P1, a.id("doo"), {});
  assert.equal(runPicks(a, [null, "t2"]), 2);
  assert.equal(dmg(a, "t2"), 2);
  assert.equal(dmg(a, "t1"), 0);
  const b = dooBoard();
  attackRaw(b, P1, ["a1", "a2"]);
  play(b.engine, P1, b.id("doo"), {});
  assert.equal(runPicks(b, ["t1", null]), 2);
  assert.equal(dmg(b, "t1"), 1);
  assert.equal(dmg(b, "t2"), 0);
  const c = dooBoard();
  attackRaw(c, P1, ["a1", "a2"]);
  play(c.engine, P1, c.id("doo"), {});
  assert.equal(runPicks(c, [null, null]), 2);
  assert.equal(dmg(c, "t1") + dmg(c, "t2"), 0);
});

clause(DOO, "0:rule", "the second pick may be a character of mine (any character), 2 damage", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2"]);
  play(g.engine, P1, g.id("doo"), {});
  runPicks(g, ["t1", "a3"]);
  assert.equal(dmg(g, "a3"), 2);
  assert.equal(dmg(g, "t1"), 1);
});

clause(DOO, "0:rule", "a party of 3 (at least 2) also gets the second pick", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2", "a3"]);
  play(g.engine, P1, g.id("doo"), {});
  assert.equal(runPicks(g, ["t1", "t2"]), 2);
  assert.equal(dmg(g, "t2"), 2);
});

clause(DOO, "0:rule", "the second pick refuses items and factions", () => {
  const g = dooBoard();
  attackRaw(g, P1, ["a1", "a2"]);
  play(g.engine, P1, g.id("doo"), {});
  answerT(g, [g.id("t1")]);
  assert.ok(pending(g.engine), "second prompt");
  refused(() => answerT(g, [g.id("theirItem")]), "an item");
  refused(() => answerT(g, [faction(g, P2)]), "a faction");
  answerT(g, [g.id("t2")]);
  assert.equal(dmg(g, "t2"), 2);
});

clause(DOO, "0:rule", "an attacking party I do NOT control does not count: the opponent plays it against my party of 2 and gets one pick only", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P1,
    cards: [
      { key: "doo", def: printing(DOO), owner: P2, zone: "hand" },
      { key: "a1", def: character({ name: "A1", life: 6 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", life: 6 }), owner: P1, zone: "play" },
      { key: "t1", def: character({ name: "T1", life: 6 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P2)
    ]
  });
  declareAttackOpenWindow(g.engine, P1, [g.id("a1"), g.id("a2")]);
  play(g.engine, P2, g.id("doo"), {});
  assert.equal(runPicks(g, ["a1", "a2"]), 1, "no second pick: P2 does not control the attacking party");
  assert.equal(dmg(g, "a1"), 1);
  assert.equal(dmg(g, "a2"), 0);
});

// --- FLIP UP: 4 [R] and you may pick an item. If you do, destroy it.
clause(DOO, "1:flipUp", "FLIP UP costs exactly 4: done with 4 [R] resources; refused with 2 others + itself (3)", () => {
  const ok = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(ok, "doo");
  assert.equal(ready(ok), 0, "4 paid");
  runPicks(ok, [null]);
  const short = dooBoard({ faceDown: true, banks: [...spentResources(P1, 1), ...rageBanks(2)] });
  refused(() => flipUp(short, "doo"), "2 ready + itself = 3 only");
  assert.equal(short.engine.state.cards[short.id("doo")].faceDown, true);
  assert.equal(zoneOf(short.engine, short.id("doo")), "play");
});

clause(DOO, "1:flipUp", "the card may help pay its own FLIP UP cost: 3 other [R] resources plus itself", () => {
  const g = dooBoard({ faceDown: true, banks: rageBanks(3) });
  flipUp(g, "doo");
  runPicks(g, [null]);
  assert.equal(zoneOf(g.engine, g.id("doo")), "discard", "resolved");
});

clause(DOO, "1:flipUp", "the threshold [R] must come from other resources: 4 non-[R] resources are refused, a single [R] among them suffices", () => {
  const none = dooBoard({ faceDown: true, banks: bank("greed", 4, P1) });
  refused(() => flipUp(none, "doo"), "no [R]");
  assert.equal(zoneOf(none.engine, none.id("doo")), "play");
  const one = dooBoard({ faceDown: true, banks: mixedBanks(1, 3) });
  flipUp(one, "doo");
  runPicks(one, [null]);
  assert.equal(zoneOf(one.engine, one.id("doo")), "discard");
  const opp = dooBoard({ faceDown: true, banks: [...bank("greed", 4, P1), ...bank("rage", 3, P2)] });
  refused(() => flipUp(opp, "doo"), "the opponent's [R] do not count");
});

clause(DOO, "1:flipUp", "may pick an item and destroy it (mine or theirs); characters and factions are not pickable", () => {
  const theirs = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(theirs, "doo");
  refused(() => answerT(theirs, [theirs.id("t1")]), "a character");
  refused(() => answerT(theirs, [faction(theirs, P2)]), "a faction");
  answerT(theirs, [theirs.id("theirItem")]);
  assert.equal(zoneOf(theirs.engine, theirs.id("theirItem")), "discard");
  assert.equal(zoneOf(theirs.engine, theirs.id("myItem")), "play");
  const mine = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(mine, "doo");
  answerT(mine, [mine.id("myItem")]);
  assert.equal(zoneOf(mine.engine, mine.id("myItem")), "discard");
  assert.equal(zoneOf(mine.engine, mine.id("theirItem")), "play");
});

clause(DOO, "1:flipUp", "the item pick is made by the FLIP UP's controller and is ONE item (two items are refused)", () => {
  const g = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(g, "doo");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget", "the item pick is open");
  assert.equal(pc.playerId, P1, "the controller picks");
  refused(() => answerT(g, [g.id("myItem"), g.id("theirItem")]), "two items in one pick");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play", "my item survives the refused pick");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play", "their item survives the refused pick");
  answerT(g, [g.id("theirItem")]);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard", "control: one item is destroyed");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play", "the other stays");
});

clause(DOO, "1:flipUp", "'you may': declining the item pick destroys nothing (the played tactic's own character pick is declined too: no damage)", () => {
  const g = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(g, "doo");
  assert.equal(runPicks(g, [null, null]), 2, "the item prompt, then the tactic's own character prompt (played as though from hand)");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
  for (const k of ["a1", "t1", "t2", "weak"]) assert.equal(dmg(g, k), 0, k);
});

clause(DOO, "1:flipUp", "FLIP UP plays the card as though from hand: its normal text also resolves (character pick, 1 damage; no party, so no second pick)", () => {
  const g = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(g, "doo");
  assert.equal(runPicks(g, ["theirItem", "t1"]), 2);
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard");
  assert.equal(dmg(g, "t1"), 1);
  assert.equal(dmg(g, "t2"), 0);
});

clause(DOO, "1:flipUp", "a flipped-up tactic leaves play afterward and cannot be flipped by the opponent", () => {
  const g = dooBoard({ faceDown: true, banks: rageBanks(4) });
  flipUp(g, "doo");
  runPicks(g, ["theirItem"]);
  assert.equal(zoneOf(g.engine, g.id("doo")), "discard");
  const opp = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "doo", def: printing(DOO), owner: P1, zone: "play", faceDown: true }, ...bank("rage", 6, P2), ...bank("rage", 6, P1)]
  });
  refused(() => flipUp(opp, "doo", P2), "not their card");
});

// =====================================================================
// Direstock Paratrooper — character, warlord, soldier, cost 3, [R][R], 3/3/2; FLIP UP 1 [R]
// =====================================================================
const PARA = "e06ea87f-5e64-42f2-828d-2c504315437c";

function paraBoard(o: { banks?: CardPlacement[]; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      { key: "pt", def: printing(PARA), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...(o.banks ?? rageBanks(1))
    ]
  });
}

clause(PARA, "0:flipUp", "printed: soldier character, cost 3, [R][R], 3 strength / 3 speed / 2 life; deploys with exactly 3, refused with 2 or one [R]", () => {
  const def = printing(PARA);
  assert.deepEqual([def.type, def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], ["character", 3, "rr", 3, 3, 2, ["soldier"]]);
  const ok = handBoard(PARA, rageBanks(3));
  play(ok.engine, P1, ok.id("c"), {});
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok), 0);
  assert.equal(ok.engine.getStat(ok.id("c"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("c"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("c"), "life"), 2);
  assert.deepEqual(ok.engine.getKeywords(ok.id("c")), []);
  const short = handBoard(PARA, rageBanks(2));
  refused(() => play(short.engine, P1, short.id("c"), {}), "cost short");
  const oneIcon = handBoard(PARA, mixedBanks(1, 2));
  refused(() => play(oneIcon.engine, P1, oneIcon.id("c"), {}), "one [R] only");
  const twoIcon = handBoard(PARA, mixedBanks(2, 1));
  play(twoIcon.engine, P1, twoIcon.id("c"), {});
  assert.equal(zoneOf(twoIcon.engine, twoIcon.id("c")), "play");
});

clause(PARA, "0:flipUp", "FLIP UP: pays exactly 1 and flips up into a face-up character with its printed stats", () => {
  const g = paraBoard({ banks: rageBanks(3) });
  assert.equal(g.engine.isResource(g.id("pt")), true);
  const before = ready(g);
  flipUp(g, "pt");
  const c = g.engine.state.cards[g.id("pt")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("pt")), ["character"]);
  assert.equal(g.engine.getStat(g.id("pt"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("pt"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("pt"), "life"), 2);
  assert.equal(before - ready(g), 2, "1 paid + it stopped being a ready resource itself");
});

clause(PARA, "0:flipUp", "FLIP UP is refused with no [R] among the other resources and with nothing to pay with", () => {
  const nothing = paraBoard({ banks: [] });
  refused(() => flipUp(nothing, "pt"), "no resources");
  assert.equal(nothing.engine.state.cards[nothing.id("pt")].faceDown, true);
  const greed = paraBoard({ banks: bank("greed", 3, P1) });
  refused(() => flipUp(greed, "pt"), "no [R]");
  assert.equal(greed.engine.state.cards[greed.id("pt")].faceDown, true);
  const opp = paraBoard({ banks: bank("rage", 3, P2) });
  refused(() => flipUp(opp, "pt"), "the opponent's [R] do not count");
  const ok = paraBoard({ banks: rageBanks(1) });
  flipUp(ok, "pt");
  assert.equal(ok.engine.state.cards[ok.id("pt")].faceDown, false);
});

clause(PARA, "0:flipUp", "the card may pay its own FLIP UP cost of 1 (CR 507.4b): a spent [R] supplies the threshold, itself pays", () => {
  const g = paraBoard({ banks: spentResources(P1, 1) });
  flipUp(g, "pt");
  assert.equal(g.engine.state.cards[g.id("pt")].faceDown, false);
});

clause(PARA, "0:flipUp", "its own icon never meets the threshold: with only a non-[R] resource besides itself it is refused", () => {
  const g = paraBoard({ banks: bank("greed", 1, P1) });
  refused(() => flipUp(g, "pt"), "threshold needs another [R]");
  assert.equal(g.engine.state.cards[g.id("pt")].faceDown, true);
});

clause(PARA, "0:flipUp", "a non-tactic FLIP UP is refused on the opponent's turn (and allowed on mine)", () => {
  const theirTurn = paraBoard({ active: P2, banks: rageBanks(3) });
  refused(() => flipUp(theirTurn, "pt"), "opponent's turn");
  assert.equal(theirTurn.engine.state.cards[theirTurn.id("pt")].faceDown, true);
  const mine = paraBoard({ active: P1, banks: rageBanks(3) });
  flipUp(mine, "pt");
  assert.equal(mine.engine.state.cards[mine.id("pt")].faceDown, false, "positive control: my own turn");
});

clause(PARA, "0:flipUp", "a non-tactic FLIP UP is refused inside an opponent's response window", () => {
  const win = paraBoard({ active: P2, banks: rageBanks(3) });
  declareAttackOpenWindow(win.engine, P2, [win.id("atk")]);
  refused(() => flipUp(win, "pt"), "inside the opponent's response window");
  assert.equal(win.engine.state.cards[win.id("pt")].faceDown, true);
});

// =====================================================================
// Direstock Stronghold — UNIQUE STRONGHOLD location, warlord, cost 6, [R]x6, structure 12
// =====================================================================
const SH = "8d5dd336-23ad-4efd-9ce0-a94d58ca72e8";

function shBoard(o: { deck?: CardPlacement[]; hand?: CardPlacement[]; banks?: CardPlacement[]; damage?: number; active?: PlayerId; extra?: CardPlacement[]; seed?: number } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    random: lcg(o.seed ?? 7),
    cards: [
      { key: "sh", def: printing(SH), owner: P1, zone: "play", damage: o.damage },
      ...fillers("d1_", 3, P1, "deck"),
      ...fillers("d2_", 5, P2, "deck"),
      ...(o.deck ?? []),
      ...(o.hand ?? []),
      ...(o.banks ?? rageBanks(8)),
      ...(o.extra ?? [])
    ]
  });
}
const warlordChar = (name: string) => character({ name, trade: "warlord", cost: 1 });
const deckCards = (): CardPlacement[] => [
  { key: "plain", def: character({ name: "Plain", trade: "gearsmith" }), owner: P1, zone: "deck" },
  { key: "wItem", def: item({ name: "WItem", trade: "warlord" }), owner: P1, zone: "deck" },
  { key: "w1", def: warlordChar("W1"), owner: P1, zone: "deck" },
  { key: "plain2", def: character({ name: "Plain2", trade: "universal" as never }), owner: P1, zone: "deck" },
  { key: "w2", def: warlordChar("W2"), owner: P1, zone: "deck" }
];
const revealedIds = (g: Game): string[] =>
  g.engine.getLog().flatMap((e) => (e.event?.type === "cardsRevealed" ? (e.event.cardIds as string[]) : []));

clause(SH, "0:unique", "type location, cost 6, [R]x6, structure 12: deploys with exactly 6, refused with 5 ready (cost isolated) or 5 [R] icons", () => {
  const def = printing(SH);
  assert.deepEqual([def.type, def.cost, def.threshold, def.structure, def.trade, def.unique], ["location", 6, "rrrrrr", 12, "warlord", "stronghold"]);
  const ok = handBoard(SH, rageBanks(6));
  play(ok.engine, P1, ok.id("c"), {});
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.deepEqual(ok.engine.getCardTypes(ok.id("c")), ["location"]);
  assert.equal(ready(ok), 0);
  assert.equal(ok.engine.getStat(ok.id("c"), "structure"), 12);
  const costShort = handBoard(SH, [...spentResources(P1, 1), ...rageBanks(5)]);
  refused(() => play(costShort.engine, P1, costShort.id("c"), {}), "cost short with the threshold met");
  assert.equal(zoneOf(costShort.engine, costShort.id("c")), "hand");
  const iconShort = handBoard(SH, mixedBanks(5, 1));
  refused(() => play(iconShort.engine, P1, iconShort.id("c"), {}), "five [R] icons");
  const spentIso = handBoard(SH, [...spentResources(P1, 3), ...rageBanks(6)]);
  play(spentIso.engine, P1, spentIso.id("c"), {});
  assert.equal(zoneOf(spentIso.engine, spentIso.id("c")), "play");
});

clause(SH, "0:unique", "UNIQUE: deploying a second Stronghold makes me keep one and destroy the other", () => {
  const second = (): CardPlacement => ({ key: "sh2", def: printing(SH), owner: P1, zone: "hand" });
  const g = shBoard({ hand: [second()] });
  play(g.engine, P1, g.id("sh2"), {});
  assert.equal(pending(g.engine)!.kind, "uniqueSurvivor");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("sh") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sh")), "play");
  assert.equal(zoneOf(g.engine, g.id("sh2")), "discard");
  const h = shBoard({ hand: [second()] });
  play(h.engine, P1, h.id("sh2"), {});
  h.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: h.id("sh2") } } as never);
  resolvePendingResponses(h.engine);
  assert.equal(zoneOf(h.engine, h.id("sh")), "discard");
  assert.equal(zoneOf(h.engine, h.id("sh2")), "play");
});

clause(SH, "0:unique", "UNIQUE is per player: the opponent may control their own Stronghold", () => {
  const g = shBoard({ extra: [{ key: "oppSh", def: printing(SH), owner: P2, zone: "play" }] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sh")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppSh")), "play");
});

clause(SH, "1:rule", "at the end of my turn I may search my deck for a warlord character, reveal it and put it on top of my deck", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = shBoard({ deck: deckCards(), seed });
    endTurn(g.engine, P1);
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    answerT(g, [g.id("w1")]);
    assert.equal(pending(g.engine), undefined);
    assert.equal(zoneOf(g.engine, g.id("w1")), "deck");
    assert.ok(revealedIds(g).includes(g.id("w1")), "W1 was revealed");
    assert.equal(g.engine.state.players[P1].deck[0], g.id("w1"), `W1 is on top of my deck (rng seed ${seed})`);
  }
});

clause(SH, "1:rule", "the search finds ONE card: picking two warlords is refused (control: one is accepted)", () => {
  const g = shBoard({ deck: deckCards() });
  endTurn(g.engine, P1);
  refused(() => answerT(g, [g.id("w1"), g.id("w2")]), "two warlords in one search");
  assert.ok(pending(g.engine), "the search is still open");
  assert.equal(revealedIds(g).length, 0, "nothing was revealed by the refused pick");
  answerT(g, [g.id("w2")]);
  assert.equal(g.engine.state.players[P1].deck[0], g.id("w2"), "control: the one pick is on top");
});

clause(SH, "1:rule", "the search shuffles the deck (CR 312.1): below the found warlord the cards are not left in their old order (some seed reorders them), none lost", () => {
  let reordered = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = shBoard({ deck: deckCards(), seed });
    const before = [...g.engine.state.players[P1].deck];
    endTurn(g.engine, P1);
    answerT(g, [g.id("w1")]);
    const after = [...g.engine.state.players[P1].deck];
    assert.equal(after[0], g.id("w1"), `the warlord is on top (seed ${seed})`);
    assert.deepEqual([...after].sort(), [...before].sort(), `no card lost (seed ${seed})`);
    if (after.slice(1).join() !== before.filter((c) => c !== g.id("w1")).join()) reordered = true;
  }
  assert.ok(reordered, "the deck was shuffled: at least one seed leaves the other cards in a different order");
});

clause(SH, "1:rule", "the search moves no cards out of the deck and loses none (the pick stays in the deck)", () => {
  const g = shBoard({ deck: deckCards() });
  const before = [...g.engine.state.players[P1].deck];
  endTurn(g.engine, P1);
  answerT(g, [g.id("w2")]);
  const after = g.engine.state.players[P1].deck;
  assert.equal(zoneOf(g.engine, g.id("w2")), "deck");
  assert.equal(after.length, before.length);
  assert.deepEqual([...after].sort(), [...before].sort());
});

clause(SH, "1:rule", "only warlord CHARACTERS are pickable: non-warlord characters, a warlord item and the opponent's deck are refused", () => {
  const g = shBoard({ deck: deckCards(), extra: [{ key: "oppW", def: warlordChar("OppW"), owner: P2, zone: "deck" }] });
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine)!.playerId, P1, "I choose the card");
  refused(() => answerT(g, [g.id("plain")]), "non-warlord character");
  refused(() => answerT(g, [g.id("plain2")]), "other-trade character");
  refused(() => answerT(g, [g.id("wItem")]), "warlord item");
  refused(() => answerT(g, [g.id("oppW")]), "opponent's warlord");
  assert.ok(pending(g.engine), "pending(g.engine)");
  answerT(g, [g.id("w1")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(revealedIds(g).includes(g.id("w1")), "revealedIds(g).includes(g.id(\"w1\"))");
});

clause(SH, "1:rule", "'you may': declining puts no warlord on top and reveals nothing", () => {
  const g = shBoard({ deck: deckCards() });
  endTurn(g.engine, P1);
  answerT(g, []);
  assert.equal(pending(g.engine), undefined);
  assert.equal(revealedIds(g).length, 0, "nothing revealed");
  assert.ok(["w1", "w2"].every((k) => zoneOf(g.engine, g.id(k)) === "deck"), "[\"w1\", \"w2\"].every((k) => zoneOf(g.engine, g.id(k)) === \"deck\")");
});

clause(SH, "1:rule", "a deck with no warlord character: nothing is found and nothing is lost", () => {
  const g = shBoard({ deck: deckCards().filter((c) => c.key === "plain" || c.key === "wItem" || c.key === "plain2") });
  const before = [...g.engine.state.players[P1].deck].sort();
  endTurn(g.engine, P1);
  if (pending(g.engine)) drain(g.engine, pickT());
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual([...g.engine.state.players[P1].deck].sort(), before);
  assert.equal(revealedIds(g).length, 0);
});

clause(SH, "1:rule", "only at the end of MY turn: the end of the opponent's turn does not trigger it", () => {
  const g = shBoard({ deck: deckCards(), active: P2 });
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine), undefined);
});

clause(SH, "1:rule", "'your turn' follows control: a Stronghold the opponent controls does not trigger at the end of my turn", () => {
  const g = shBoard({ deck: deckCards(), active: P1 });
  g.engine.state.cards[g.id("sh")].controllerId = P2;
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine), undefined, "P1 does not control it");
});

clause(SH, "2:rule", "when I deploy a character: X is its cost (3); picking a faction deals X to it and puts X damage on the Stronghold", () => {
  const g = shBoard({ hand: [{ key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }] });
  const inf2 = g.engine.state.players[P2].influence;
  const inf1 = g.engine.state.players[P1].influence;
  play(g.engine, P1, g.id("guy"), {});
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerT(g, [faction(g, P2)]);
  assert.equal(g.engine.state.players[P2].influence, inf2 - 3);
  assert.equal(g.engine.state.players[P1].influence, inf1, "mine untouched");
  assert.equal(dmg(g, "sh"), 3, "3 damage markers on the Stronghold");
  assert.equal(zoneOf(g.engine, g.id("guy")), "play");
});

for (const x of [2, 5]) {
  clause(SH, "2:rule", `X is the deployed character's cost: cost ${x} deals ${x}`, () => {
    const g = shBoard({ hand: [{ key: "guy", def: character({ name: "Guy", cost: x }), owner: P1, zone: "hand" }] });
    const inf2 = g.engine.state.players[P2].influence;
    play(g.engine, P1, g.id("guy"), {});
    answerT(g, [faction(g, P2)]);
    assert.equal(g.engine.state.players[P2].influence, inf2 - x);
    assert.equal(dmg(g, "sh"), x);
  });
}

clause(SH, "2:rule", "any faction may be picked, including my own (the Stronghold still takes X)", () => {
  const g = shBoard({ hand: [{ key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P1, zone: "hand" }] });
  const inf1 = g.engine.state.players[P1].influence;
  const inf2 = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("guy"), {});
  answerT(g, [faction(g, P1)]);
  assert.equal(g.engine.state.players[P1].influence, inf1 - 2);
  assert.equal(g.engine.state.players[P2].influence, inf2);
  assert.equal(dmg(g, "sh"), 2);
});

clause(SH, "2:rule", "'you may pick a faction': declining does nothing (no damage to anyone, no markers)", () => {
  const g = shBoard({ hand: [{ key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }] });
  const inf1 = g.engine.state.players[P1].influence;
  const inf2 = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("guy"), {});
  answerT(g, []);
  assert.equal(g.engine.state.players[P1].influence, inf1);
  assert.equal(g.engine.state.players[P2].influence, inf2);
  assert.equal(dmg(g, "sh"), 0);
  assert.equal(pending(g.engine), undefined);
});

clause(SH, "2:rule", "the pick must be a faction: a character is refused", () => {
  const g = shBoard({
    hand: [{ key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }],
    extra: [{ key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" }]
  });
  play(g.engine, P1, g.id("guy"), {});
  refused(() => answerT(g, [g.id("foe")]), "a character");
  refused(() => answerT(g, [g.id("guy")]), "the deployed character");
  assert.equal(dmg(g, "foe"), 0);
  answerT(g, [faction(g, P2)]);
  assert.equal(dmg(g, "sh"), 3);
});

clause(SH, "2:rule", "'a faction': ONE faction only, picking both factions is refused (control: one is accepted)", () => {
  const g = shBoard({ hand: [{ key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }] });
  const inf1 = g.engine.state.players[P1].influence;
  const inf2 = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("guy"), {});
  refused(() => answerT(g, [faction(g, P1), faction(g, P2)]), "two factions in one pick");
  assert.equal(g.engine.state.players[P1].influence, inf1, "my faction untouched by the refused pick");
  assert.equal(g.engine.state.players[P2].influence, inf2, "their faction untouched by the refused pick");
  assert.equal(dmg(g, "sh"), 0, "no markers on the Stronghold");
  answerT(g, [faction(g, P2)]);
  assert.equal(g.engine.state.players[P2].influence, inf2 - 3, "control: one faction takes X");
});

clause(SH, "2:rule", "it triggers per deployment and the markers accumulate (3 then 2 = 5)", () => {
  const g = shBoard({
    hand: [
      { key: "g1", def: character({ name: "G1", cost: 3 }), owner: P1, zone: "hand" },
      { key: "g2", def: character({ name: "G2", cost: 2 }), owner: P1, zone: "hand" }
    ]
  });
  const inf2 = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("g1"), {});
  answerT(g, [faction(g, P2)]);
  play(g.engine, P1, g.id("g2"), {});
  answerT(g, [faction(g, P2)]);
  assert.equal(dmg(g, "sh"), 5);
  assert.equal(g.engine.state.players[P2].influence, inf2 - 5);
});

clause(SH, "2:rule", "the markers can destroy the Stronghold (structure 12): 9 + 3 = 12 destroys it, 9 + 2 = 11 does not", () => {
  const boom = shBoard({ damage: 9, hand: [{ key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }] });
  play(boom.engine, P1, boom.id("guy"), {});
  answerT(boom, [faction(boom, P2)]);
  assert.equal(zoneOf(boom.engine, boom.id("sh")), "discard");
  const safe = shBoard({ damage: 9, hand: [{ key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P1, zone: "hand" }] });
  play(safe.engine, P1, safe.id("guy"), {});
  answerT(safe, [faction(safe, P2)]);
  assert.equal(zoneOf(safe.engine, safe.id("sh")), "play");
  assert.equal(dmg(safe, "sh"), 11);
});

clause(SH, "2:rule", "only characters I deploy count: items, tactics and the opponent's characters do not trigger it", () => {
  const g = shBoard({
    hand: [
      { key: "itm", def: item({ name: "Itm", cost: 2 }), owner: P1, zone: "hand" },
      { key: "tac", def: killTactic({ name: "Tac", cost: 1 }), owner: P1, zone: "hand" }
    ],
    extra: [{ key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" }]
  });
  const inf2 = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("itm"), {});
  assert.equal(pending(g.engine), undefined, "item: no trigger");
  play(g.engine, P1, g.id("tac"), { selected: { t: [g.id("foe")] } });
  assert.equal(pending(g.engine), undefined, "tactic: no trigger");
  assert.equal(dmg(g, "sh"), 0);
  assert.equal(g.engine.state.players[P2].influence, inf2);
  const o = shBoard({
    active: P2,
    extra: [{ key: "theirs", def: character({ name: "Theirs", cost: 2 }), owner: P2, zone: "hand" }, ...bank("rage", 4, P2)]
  });
  play(o.engine, P2, o.id("theirs"), {});
  assert.equal(pending(o.engine), undefined, "the opponent's deploy does not trigger my Stronghold");
  assert.equal(dmg(o, "sh"), 0);
});

// =====================================================================
// Disposable Meatsack — character, warlord, soldier, cost 1, [R], 2/2/2
// =====================================================================
const MEAT = "583491b2-a17c-4fdc-9014-12b4c1250f67";

function meatBoard(o: { rage?: number; spent?: number; greed?: number; oppRage?: number; depleted?: boolean; active?: PlayerId; owner?: PlayerId; controller?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      { key: "ms", def: printing(MEAT), owner: o.owner ?? P1, controller: o.controller ?? o.owner ?? P1, zone: "play", depleted: o.depleted },
      ...fillers("d1_", 4, P1, "deck"),
      ...fillers("d2_", 4, P2, "deck"),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.spent ? spentResources(P1, o.spent) : []),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.oppRage ?? 0, P2)
    ]
  });
}

clause(MEAT, "0:rule", "printed: soldier character, cost 1, [R], 2/2/2; deploys with exactly 1 [R], refused with none, a non-[R] resource, or a spent-only [R] (cost isolated)", () => {
  const def = printing(MEAT);
  assert.deepEqual([def.type, def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], ["character", 1, "r", 2, 2, 2, ["soldier"]]);
  const ok = handBoard(MEAT, rageBanks(1));
  play(ok.engine, P1, ok.id("c"), {});
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok), 0);
  assert.equal(ok.engine.getStat(ok.id("c"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("c"), "speed"), 2);
  assert.equal(ok.engine.getStat(ok.id("c"), "life"), 2);
  const none = handBoard(MEAT, []);
  refused(() => play(none.engine, P1, none.id("c"), {}), "no resources");
  const greed = handBoard(MEAT, bank("greed", 1, P1));
  refused(() => play(greed.engine, P1, greed.id("c"), {}), "no [R]");
  const spentOnly = handBoard(MEAT, spentResources(P1, 1));
  refused(() => play(spentOnly.engine, P1, spentOnly.id("c"), {}), "threshold met by a spent [R] but nothing ready to pay 1", /Costs cannot be paid/);
  const iso = handBoard(MEAT, [...spentResources(P1, 1), ...bank("greed", 1, P1)]);
  play(iso.engine, P1, iso.id("c"), {});
  assert.equal(zoneOf(iso.engine, iso.id("c")), "play");
});

clause(MEAT, "0:rule", "at the end of my turn, a depleted Meatsack is destroyed", () => {
  const g = meatBoard({ depleted: true });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MEAT, "0:rule", "at the end of my turn, a ready (not depleted) Meatsack stays", () => {
  const g = meatBoard({ depleted: false });
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("ms")), "play");
});

clause(MEAT, "0:rule", "a Meatsack that attacked (survivors are depleted) is destroyed at the end of my turn", () => {
  const g = meatBoard();
  fight(g.engine, P1, [g.id("ms")], { type: "faction", playerId: P2 }, []);
  assert.equal(zoneOf(g.engine, g.id("ms")), "play", "survived the battle");
  assert.equal(g.engine.state.cards[g.id("ms")].depleted, true);
  endTurn(g.engine, P1);
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MEAT, "0:rule", "only at the end of MY turn: it is not destroyed at the end of the opponent's turn", () => {
  const g = meatBoard({ depleted: true, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(zoneOf(g.engine, g.id("ms")), "play");
});

clause(MEAT, "0:rule", "'your turn' follows control: an opponent-controlled Meatsack survives the end of my turn and dies at the end of theirs", () => {
  const mine = meatBoard({ depleted: true, owner: P1, controller: P2, active: P1 });
  endTurn(mine.engine, P1);
  assert.equal(zoneOf(mine.engine, mine.id("ms")), "play");
  const theirs = meatBoard({ depleted: true, owner: P1, controller: P2, active: P2 });
  endTurn(theirs.engine, P2);
  assert.equal(zoneOf(theirs.engine, theirs.id("ms")), "discard");
});

clause(MEAT, "1:rule@rrrrrr", "with six [R]: +1 strength and +1 speed (3/3), life unchanged", () => {
  const g = meatBoard({ rage: 6 });
  assert.equal(g.engine.getStat(g.id("ms"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("ms"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ms"), "life"), 2);
});

clause(MEAT, "1:rule@rrrrrr", "five [R], [R] plus other icons, or only the opponent's [R] give no bonus; spent [R] still count", () => {
  const five = meatBoard({ rage: 5 });
  assert.equal(five.engine.getStat(five.id("ms"), "strength"), 2);
  assert.equal(five.engine.getStat(five.id("ms"), "speed"), 2);
  const mixed = meatBoard({ rage: 5, greed: 4 });
  assert.equal(mixed.engine.getStat(mixed.id("ms"), "strength"), 2);
  assert.equal(mixed.engine.getStat(mixed.id("ms"), "speed"), 2);
  const opp = meatBoard({ rage: 5, oppRage: 4 });
  assert.equal(opp.engine.getStat(opp.id("ms"), "strength"), 2);
  assert.equal(opp.engine.getStat(opp.id("ms"), "speed"), 2);
  const spent = meatBoard({ rage: 3, spent: 3 });
  assert.equal(spent.engine.getStat(spent.id("ms"), "strength"), 3);
  assert.equal(spent.engine.getStat(spent.id("ms"), "speed"), 3);
});

// =====================================================================
// Geldale, City-Fortress — location, warlord, cost 3, [R][R], structure 5
// =====================================================================
const GELD = "f4ab5680-e5ab-47b1-bf3d-953d54adc79b";

function geldBoard(o: { geldale?: boolean; geldOwner?: PlayerId; geldController?: PlayerId; active?: PlayerId; faceDownTactic?: boolean } = {}) {
  const active = o.active ?? P1;
  const withGeld = o.geldale ?? true;
  const zap = tactic({
    name: "Zap",
    cost: 0,
    behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf(active),
    activePlayerId: active,
    cards: [
      ...(withGeld ? [{ key: "geld", def: printing(GELD), owner: o.geldOwner ?? P1, controller: o.geldController ?? o.geldOwner ?? P1, zone: "play" as const }] : []),
      { key: "dummy", def: character({ name: "Dummy", life: 20 }), owner: P1, zone: "play" },
      { key: "dummy2", def: character({ name: "Dummy2", life: 20 }), owner: P2, zone: "play" },
      { key: "mine", def: killTactic({ name: "Mine" }), owner: P1, zone: "hand" },
      { key: "theirs", def: killTactic({ name: "Theirs" }), owner: P2, zone: "hand" },
      { key: "mine2", def: killTactic({ name: "Mine2" }), owner: P1, zone: "hand" },
      { key: "zap", def: zap, owner: P1, zone: "hand" },
      {
        key: "abil",
        def: item({ name: "Abil", behavior: { abilities: [{ id: "poke", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }),
        owner: P2,
        zone: "play"
      },
      ...(o.faceDownTactic ? [{ key: "fd", def: printing(DOO), owner: P2, zone: "play" as const, faceDown: true }] : []),
      ...bank("rage", 6, P1),
      ...bank("rage", 6, P2)
    ]
  });
}
const playTac = (g: Game, player: PlayerId, key: string, target = "dummy", raw = false) =>
  (raw ? playRaw : play)(g.engine, player, g.id(key), { selected: { t: [g.id(target)] } });
const TAC_REFUSAL = /tactic|turn|cannot|only|restrict/i;

clause(GELD, "0:rule", "printed: location, cost 3, [R][R], structure 5; deploys with exactly 3, refused with 2 or with one [R] icon", () => {
  const def = printing(GELD);
  assert.deepEqual([def.type, def.cost, def.threshold, def.structure, def.trade], ["location", 3, "rr", 5, "warlord"]);
  const ok = handBoard(GELD, rageBanks(3));
  play(ok.engine, P1, ok.id("c"), {});
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.deepEqual(ok.engine.getCardTypes(ok.id("c")), ["location"]);
  assert.equal(ok.engine.getStat(ok.id("c"), "structure"), 5);
  assert.equal(ready(ok), 0);
  const short = handBoard(GELD, rageBanks(2));
  refused(() => play(short.engine, P1, short.id("c"), {}), "cost short");
  const oneIcon = handBoard(GELD, mixedBanks(1, 2));
  refused(() => play(oneIcon.engine, P1, oneIcon.id("c"), {}), "one [R]");
});

clause(GELD, "0:rule", "without Geldale an opponent can respond to my tactic with a tactic (positive control)", () => {
  const g = geldBoard({ geldale: false });
  playTac(g, P1, "mine", "dummy", true);
  playTac(g, P2, "theirs", "dummy2");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
});

clause(GELD, "0:rule", "with Geldale, the opponent cannot play a tactic during MY turn (in response to mine)", () => {
  const g = geldBoard();
  playTac(g, P1, "mine", "dummy", true);
  refused(() => playTac(g, P2, "theirs", "dummy2"), "opponent's tactic on my turn", TAC_REFUSAL);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dummy2")), "play");
});

clause(GELD, "0:rule", "with Geldale, the opponent cannot play a tactic in a response window of my attack either", () => {
  const g = geldBoard();
  declareAttackOpenWindow(g.engine, P1, [g.id("dummy")]);
  refused(() => playTac(g, P2, "theirs", "dummy2"), "opponent's tactic during my battle", TAC_REFUSAL);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
});

clause(GELD, "0:rule", "the opponent MAY play tactics during their own turn", () => {
  const g = geldBoard({ active: P2 });
  playTac(g, P2, "theirs", "dummy");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dummy")), "discard", "its effect happened");
});

clause(GELD, "0:rule", "'your opponents' only: I can still play tactics on their turn", () => {
  const g = geldBoard({ active: P2 });
  playTac(g, P2, "theirs", "dummy", true);
  playTac(g, P1, "mine", "dummy2");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(GELD, "0:rule", "I can play tactics on my own turn too", () => {
  const g = geldBoard();
  playTac(g, P1, "mine");
  playTac(g, P1, "mine2", "dummy2");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "discard");
});

clause(GELD, "0:rule", "only tactics are restricted: the opponent can still use an ability during my turn's response window", () => {
  const g = geldBoard();
  declareAttackOpenWindow(g.engine, P1, [g.id("dummy")]);
  activate(g.engine, P2, g.id("abil"), "poke", { selected: { t: [g.id("dummy")] } });
  assert.equal(dmg(g, "dummy"), 1);
});

clause(GELD, "0:rule", "'your opponents' follows control: a Geldale I own but P2 controls restricts me on their turn, not them", () => {
  const g = geldBoard({ geldOwner: P1, geldController: P2, active: P2 });
  playTac(g, P2, "theirs", "dummy", true);
  refused(() => playTac(g, P1, "mine", "dummy2"), "I am the controller's opponent", TAC_REFUSAL);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  const h = geldBoard({ geldOwner: P1, geldController: P2, active: P1 });
  playTac(h, P1, "mine", "dummy", true);
  playTac(h, P2, "theirs", "dummy2");
  assert.equal(zoneOf(h.engine, h.id("theirs")), "discard", "the controller is not restricted");
});

clause(GELD, "0:rule", "the restriction ends when Geldale leaves play", () => {
  const g = geldBoard();
  playTac(g, P1, "mine", "dummy", true);
  refused(() => playTac(g, P2, "theirs", "dummy2"), "while Geldale is in play", TAC_REFUSAL);
  const h = geldBoard();
  play(h.engine, P1, h.id("zap"), { selected: { t: [h.id("geld")] } });
  assert.equal(zoneOf(h.engine, h.id("geld")), "discard", "Geldale destroyed");
  playTac(h, P1, "mine", "dummy", true);
  playTac(h, P2, "theirs", "dummy2");
  assert.equal(zoneOf(h.engine, h.id("theirs")), "discard", "the opponent can respond again");
});

clause(GELD, "0:rule", "a tactic played by the opponent through FLIP UP on my turn is also a tactic play", () => {
  const free = geldBoard({ geldale: false, faceDownTactic: true });
  playTac(free, P1, "mine", "dummy", true);
  flipUp(free, "fd", P2);
  assert.equal(free.engine.state.cards[free.id("fd")].faceDown, false, "positive control: without Geldale the flip-up goes through");
  const g = geldBoard({ faceDownTactic: true });
  playTac(g, P1, "mine", "dummy", true);
  refused(() => flipUp(g, "fd", P2), "FLIP UP of a tactic during my turn", TAC_REFUSAL);
  assert.equal(g.engine.state.cards[g.id("fd")].faceDown, true);
});
