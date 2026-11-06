// Clause tests — shade-of-the-devoured-emperor-01, part p3 (groups 13-19):
// Officially Offensive Overseer, Ping Konk, Quotidian Concealer, Quotidian Transposition,
// Study Disturbance, Tedious TriAdic Truculence, Thabbashite Chemist.
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
  volition
} from "../per-card/_harness.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { readyResources, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition } from "../../../engine.js";

type Board = ReturnType<typeof buildGame>;
type Eng = Board["engine"];
type Pid = typeof P1;
type Placement = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>[number];

const handOf = (e: Eng, p: Pid): string[] => e.state.players[p].hand;
const discardOf = (e: Eng, p: Pid): string[] => e.state.players[p].discard;
const hasKw = (e: Eng, cid: string, k: string): boolean => (e.getKeywords(cid) as string[]).includes(k);
const facOf = (e: Eng, p: Pid): string => e.state.players[p].factionId!;
const tokens = (e: Eng, cid: string): number => e.state.cards[cid].counters?.token ?? 0;
const noPending = (e: Eng): void => assert.equal(e.state.pendingChoice, undefined, "no choice left open");
type PC = { kind: string; playerId: Pid; [k: string]: unknown };
const pcOf = (e: Eng): PC => e.state.pendingChoice as unknown as PC;

/** A gear item that adds `amount` strength to the character it is attached to. */
function booster(amount: number): CardDefinition {
  return item({
    name: `Booster${amount}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });
}
/** A gear item that removes `amount` strength from the character it is attached to. */
const weakener = (amount: number): CardDefinition => {
  const d = booster(-amount);
  return { ...d, name: `Weakener${amount}` };
};

// ---------------------------------------------------------------------------------------------
// Officially Offensive Overseer — cost 4 · threshold "o" · str 3 / spd 3 / life 3
// ---------------------------------------------------------------------------------------------
const OVERSEER = "7e485e5b-2d3a-4013-98d9-f7c9e47ccb57";

/** P1 holds the Overseer, controls `obs` obsession resources and `vol` face-down resources, plus `extra`. */
const ov = (obs: number, vol: number, extra: Placement[] = []): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ov", def: printing(OVERSEER), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...volition(vol, P1), ...extra]
  });

/** Deploys the Overseer with the given picked card ids (none = no pick) and settles every prompt. */
function castOv(b: Board, picks: string[] = []): void {
  play(b.engine, P1, b.id("ov"), { selected: picks.length ? { p: picks } : {} });
  drain(b.engine, declineAll);
  noPending(b.engine);
}
const bigChar = (key: string, owner: Pid): Placement => ({ key, def: character({ name: `Big ${key}`, strength: 5, life: 5 }), owner, zone: "play" });

clause(OVERSEER, "0:ability", "controlling exactly [O][O][O] (3 obsession + 1 face-down to pay the 4): any character in play can be picked, whoever owns it; the cost of 4 is paid", () => {
  for (const owner of [P1, P2]) {
    const b = ov(3, 1, [bigChar("big", owner)]);
    assert.equal(readyResources(b.engine, P1), 4, "control: four ready resources");
    castOv(b, [b.id("big")]);
    assert.equal(zoneOf(b.engine, b.id("ov")), "play", `pick of a character owned by ${owner}: the Overseer is deployed`);
    assert.equal(readyResources(b.engine, P1), 0, "the cost of 4 was paid");
    assert.equal(zoneOf(b.engine, b.id("big")), "play", "a strength-5 pick is not returned (see the rule clause)");
    assert.deepEqual([b.engine.getStat(b.id("ov"), "strength"), b.engine.getStat(b.id("ov"), "speed"), b.engine.getStat(b.id("ov"), "life")], [3, 3, 3], "printed 3 / 3 / 3");
  }
});

clause(OVERSEER, "0:ability", "printed cost 4 and threshold [O]: refused with 3 resources, refused with 4 resources and no obsession icon", () => {
  const thin = ov(3, 0);
  refused(() => play(thin.engine, P1, thin.id("ov"), { selected: {} }), "three resources for a cost of 4");
  const none = ov(0, 4);
  assert.equal(readyResources(none.engine, P1), 4);
  refused(() => play(none.engine, P1, none.id("ov"), { selected: {} }), "four face-down resources provide no obsession");
  const ok = ov(1, 3);
  castOv(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ov")), "play", "control: one obsession icon and four resources deploy it");
});

clause(OVERSEER, "0:ability", "a location in play can be picked (either side's)", () => {
  for (const owner of [P1, P2]) {
    const b = ov(3, 1, [{ key: "loc", def: location({ name: "Fortress", structure: 5 }), owner, zone: "play" }]);
    castOv(b, [b.id("loc")]);
    assert.equal(zoneOf(b.engine, b.id("ov")), "play", `pick of a location owned by ${owner}`);
    assert.equal(zoneOf(b.engine, b.id("loc")), "play", "structure 5 stays");
  }
});

clause(OVERSEER, "0:ability", "the pick is optional: with [O][O][O] controlled it can be deployed without picking anything (a returnable character stays)", () => {
  const b = ov(3, 1, [{ key: "small", def: character({ name: "Small", strength: 1, life: 2 }), owner: P2, zone: "play" }]);
  castOv(b);
  assert.equal(zoneOf(b.engine, b.id("ov")), "play");
  assert.equal(readyResources(b.engine, P1), 0, "cost paid");
  assert.equal(zoneOf(b.engine, b.id("small")), "play", "nothing was picked, so nothing returns");
});

clause(OVERSEER, "0:ability", "only ONE card can be picked: a character and a location together are refused", () => {
  const mk = () => ov(3, 1, [bigChar("big", P2), { key: "loc", def: location({ name: "Fortress", structure: 5 }), owner: P2, zone: "play" }, bigChar("big2", P2)]);
  const ok = mk();
  castOv(ok, [ok.id("big")]);
  assert.equal(zoneOf(ok.engine, ok.id("ov")), "play", "control: one pick is fine");
  const b = mk();
  refused(() => play(b.engine, P1, b.id("ov"), { selected: { p: [b.id("big"), b.id("loc")] } }), "a character AND a location");
  const c = mk();
  refused(() => play(c.engine, P1, c.id("ov"), { selected: { p: [c.id("big"), c.id("big2")] } }), "two characters");
  assert.equal(zoneOf(c.engine, c.id("ov")), "hand");
  assert.equal(readyResources(c.engine, P1), 4, "nothing was paid by the refused attempts");
});

clause(OVERSEER, "0:ability", "only a character or a location IN PLAY can be picked: items, factions, cards in hand or discard, face-down cards and the Overseer itself are refused", () => {
  const extra: Placement[] = [
    { key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Hander", strength: 1 }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "Dead", strength: 1 }), owner: P2, zone: "discard" },
    { key: "fd", def: character({ name: "Hidden", strength: 1 }), owner: P2, zone: "play", faceDown: true },
    { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1, zone: "play" }
  ];
  const ctl = ov(3, 1, extra);
  castOv(ctl, [ctl.id("mine")]);
  assert.equal(zoneOf(ctl.engine, ctl.id("ov")), "play", "control: a character in play can be picked");
  const cases: Array<[string, (b: Board) => string]> = [
    ["an item in play", b => b.id("it")],
    ["a character in the opponent's hand", b => b.id("hc")],
    ["a character in the discard pile", b => b.id("dc")],
    ["a face-down card in play (a resource, not a character)", b => b.id("fd")],
    ["the opponent's faction", b => facOf(b.engine, P2)],
    ["its own faction", b => facOf(b.engine, P1)],
    ["the Overseer itself", b => b.id("ov")]
  ];
  for (const [why, pick] of cases) {
    const b = ov(3, 1, extra);
    refused(() => play(b.engine, P1, b.id("ov"), { selected: { p: [pick(b)] } }), why);
    assert.equal(zoneOf(b.engine, b.id("ov")), "hand", `${why}: the Overseer was not deployed`);
    assert.equal(readyResources(b.engine, P1), 4, `${why}: nothing was paid`);
  }
});

clause(OVERSEER, "0:ability", "without [O][O][O] nothing may be picked: 2 obsession (+2 face-down) or 1 obsession (+3 rage) refuse a pick, but the card still plays with no pick", () => {
  const small = (): Placement => ({ key: "small", def: character({ name: "Small", strength: 1, life: 2 }), owner: P2, zone: "play" });
  const boards: Array<[string, () => Board]> = [
    ["2 obsession + 2 face-down", () => ov(2, 2, [small()])],
    ["1 obsession + 3 rage", () => ov(1, 0, [small(), ...bank("rage", 3, P1)])]
  ];
  for (const [label, mk] of boards) {
    const b = mk();
    assert.equal(readyResources(b.engine, P1), 4, `${label}: the cost of 4 is affordable`);
    refused(() => play(b.engine, P1, b.id("ov"), { selected: { p: [b.id("small")] } }), `${label}: pick with fewer than [O][O][O]`);
    assert.equal(zoneOf(b.engine, b.id("ov")), "hand", `${label}: not deployed by the refused attempt`);
    const c = mk();
    castOv(c);
    assert.equal(zoneOf(c.engine, c.id("ov")), "play", `${label}: control: it deploys with no pick`);
    assert.equal(zoneOf(c.engine, c.id("small")), "play");
  }
  const four = ov(4, 0, [small()]);
  castOv(four, [four.id("small")]);
  assert.equal(zoneOf(four.engine, four.id("ov")), "play", "control: four obsession also qualifies");
  assert.equal(zoneOf(four.engine, four.id("small")), "hand", "and the pick is returned");
});

clause(OVERSEER, "1:rule", "a picked character with strength 3 or less is put into its owner's hand; an unpicked character with low strength stays", () => {
  for (const [str, owner] of [[3, P2], [2, P2], [1, P1]] as Array<[number, Pid]>) {
    const b = ov(3, 1, [
      { key: "target", def: character({ name: "Target", strength: str, life: 4 }), owner, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 4 }), owner: P2, zone: "play" }
    ]);
    const mine = handOf(b.engine, P1).length;
    castOv(b, [b.id("target")]);
    assert.equal(zoneOf(b.engine, b.id("ov")), "play");
    assert.equal(zoneOf(b.engine, b.id("target")), "hand", `strength ${str} (owner ${owner}) returns to hand`);
    assert.ok(handOf(b.engine, owner).includes(b.id("target")), "it is in its owner's hand");
    assert.equal(zoneOf(b.engine, b.id("bystander")), "play", "the unpicked character stays");
    assert.equal(handOf(b.engine, P1).length, owner === P1 ? mine : mine - 1, "the Overseer left the hand; only an own pick returns to it");
  }
});

clause(OVERSEER, "1:rule", "a picked character with strength 4 or more is NOT returned", () => {
  for (const str of [4, 6]) {
    const b = ov(3, 1, [{ key: "target", def: character({ name: "Target", strength: str, life: 4 }), owner: P2, zone: "play" }]);
    castOv(b, [b.id("target")]);
    assert.equal(zoneOf(b.engine, b.id("ov")), "play");
    assert.equal(zoneOf(b.engine, b.id("target")), "play", `strength ${str} stays in play`);
    assert.equal(handOf(b.engine, P2).length, 0);
  }
});

clause(OVERSEER, "1:rule", "'has strength 3 or less' reads the CURRENT strength: printed 5 weakened to 3 returns, printed 3 boosted to 4 stays", () => {
  const weak = ov(3, 1, [
    { key: "target", def: character({ name: "Target", strength: 5, life: 4 }), owner: P2, zone: "play" },
    { key: "wk", def: weakener(2), owner: P2, zone: "play", attachedToKey: "target" }
  ]);
  assert.equal(weak.engine.getStat(weak.id("target"), "strength"), 3, "control: weakened to 3");
  castOv(weak, [weak.id("target")]);
  assert.equal(zoneOf(weak.engine, weak.id("target")), "hand", "current strength 3 returns");
  const strong = ov(3, 1, [
    { key: "target", def: character({ name: "Target", strength: 3, life: 4 }), owner: P2, zone: "play" },
    { key: "bo", def: booster(1), owner: P2, zone: "play", attachedToKey: "target" }
  ]);
  assert.equal(strong.engine.getStat(strong.id("target"), "strength"), 4, "control: boosted to 4");
  castOv(strong, [strong.id("target")]);
  assert.equal(zoneOf(strong.engine, strong.id("target")), "play", "current strength 4 stays");
});

clause(OVERSEER, "1:rule", "a picked location with structure 3 or less is put into its owner's hand; structure 4 stays", () => {
  for (const [structure, owner, returns] of [[3, P2, true], [1, P1, true], [4, P2, false]] as Array<[number, Pid, boolean]>) {
    const b = ov(3, 1, [{ key: "loc", def: location({ name: "Fortress", structure }), owner, zone: "play" }]);
    castOv(b, [b.id("loc")]);
    assert.equal(zoneOf(b.engine, b.id("ov")), "play");
    assert.equal(zoneOf(b.engine, b.id("loc")), returns ? "hand" : "play", `structure ${structure}`);
    if (returns) assert.ok(handOf(b.engine, owner).includes(b.id("loc")), "into its owner's hand");
  }
});

clause(OVERSEER, "1:rule", "'its OWNER's hand': a character the opponent owns but you control returns to the opponent's hand", () => {
  const b = ov(3, 1, [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 3 }), owner: P2, controller: P1, zone: "play" }]);
  const mine = handOf(b.engine, P1).length;
  castOv(b, [b.id("stolen")]);
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "in the owner's (P2) hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), false, "not in the controller's hand");
  assert.equal(handOf(b.engine, P1).length, mine - 1, "only the Overseer left P1's hand");
});

clause(OVERSEER, "1:rule", "it happens when the Overseer ENTERS play, not when it is cast: the picked card is still in play while the Overseer waits", () => {
  const b = ov(3, 1, [{ key: "small", def: character({ name: "Small", strength: 1, life: 2 }), owner: P2, zone: "play" }]);
  playRaw(b.engine, P1, b.id("ov"), { selected: { p: [b.id("small")] } });
  assert.notEqual(zoneOf(b.engine, b.id("ov")), "play", "the Overseer has not entered play yet");
  assert.equal(zoneOf(b.engine, b.id("small")), "play", "so nothing has been returned yet");
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  noPending(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ov")), "play");
  assert.equal(zoneOf(b.engine, b.id("small")), "hand", "returned once the Overseer entered");
});

// ---------------------------------------------------------------------------------------------
// Ping Konk — cost 6 · threshold "oooo" · str 6 / spd 3 / life 6 · vanilla
// ---------------------------------------------------------------------------------------------
const PING = "5a009669-cb50-40d1-a7b3-a070121ba4af";
const pk = (obs: number, vol: number): Board =>
  buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "pk", def: printing(PING), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...volition(vol, P1)] });

clause(PING, "vanilla", "deploys for exactly its printed cost 6 with [O][O][O][O], and enters with the printed 6 / 3 / 6", () => {
  const b = pk(4, 2);
  assert.equal(readyResources(b.engine, P1), 6);
  play(b.engine, P1, b.id("pk"));
  assert.equal(zoneOf(b.engine, b.id("pk")), "play");
  assert.equal(readyResources(b.engine, P1), 0, "the cost of 6 was paid");
  assert.deepEqual([b.engine.getStat(b.id("pk"), "strength"), b.engine.getStat(b.id("pk"), "speed"), b.engine.getStat(b.id("pk"), "life")], [6, 3, 6]);
});

clause(PING, "vanilla", "refused one resource short of its cost (5 of 6), and refused with 6 resources but only [O][O][O]", () => {
  const short = pk(4, 1);
  refused(() => play(short.engine, P1, short.id("pk")), "5 resources for a cost of 6");
  assert.equal(zoneOf(short.engine, short.id("pk")), "hand");
  const noThreshold = pk(3, 3);
  assert.equal(readyResources(noThreshold.engine, P1), 6);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("pk")), "only three obsession icons for [O][O][O][O]");
  const ok = pk(5, 1);
  play(ok.engine, P1, ok.id("pk"));
  assert.equal(zoneOf(ok.engine, ok.id("pk")), "play", "control: five obsession + one more deploys it");
});

clause(PING, "vanilla", "no rules text: no keywords and no activated abilities in play", () => {
  const b = pk(4, 2);
  play(b.engine, P1, b.id("pk"));
  assert.deepEqual(b.engine.getKeywords(b.id("pk")), []);
  assert.deepEqual(b.engine.getAvailableActivatedAbilities(P1).filter(a => a.cardId === b.id("pk")), []);
  noPending(b.engine);
});

// ---------------------------------------------------------------------------------------------
// Quotidian Concealer — cost 2 · threshold "oo" · str 1 / spd 3 / life 1
// ---------------------------------------------------------------------------------------------
const CONCEALER = "db263f70-60f8-458d-bcd1-441f945f0617";
/** The Concealer is in play with `tok` tokens; `extra` cards on top. */
const conc = (tok: number, extra: Placement[] = [], turn?: number): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    turn,
    cards: [{ key: "qc", def: printing(CONCEALER), owner: P1, zone: "play", counters: tok ? { token: tok } : undefined }, ...extra]
  });
const ch = (key: string, owner: Pid, over: Partial<CardDefinition> = {}): Placement => ({ key, def: character({ name: `Char ${key}`, ...over }), owner, zone: "play" });

clause(CONCEALER, "0:rule", "enters play with exactly one token on it (none while in hand)", () => {
  const b = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "qc", def: printing(CONCEALER), owner: P1, zone: "hand" }, ...bank("obsession", 2, P1)] });
  assert.equal(tokens(b.engine, b.id("qc")), 0, "no token in hand");
  play(b.engine, P1, b.id("qc"));
  noPending(b.engine);
  assert.equal(zoneOf(b.engine, b.id("qc")), "play");
  assert.equal(tokens(b.engine, b.id("qc")), 1, "one token on entering play");
  assert.equal(readyResources(b.engine, P1), 0, "cost 2 paid");
  assert.deepEqual([b.engine.getStat(b.id("qc"), "strength"), b.engine.getStat(b.id("qc"), "speed"), b.engine.getStat(b.id("qc"), "life")], [1, 3, 1], "printed 1 / 3 / 1");
});

clause(CONCEALER, "0:rule", "printed cost 2 and threshold [O][O]: refused with one resource, refused with two resources but one obsession icon", () => {
  const mk = (obs: number, vol: number) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "qc", def: printing(CONCEALER), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...volition(vol, P1)] });
  const thin = mk(2, 0);
  const one = mk(1, 0);
  refused(() => play(one.engine, P1, one.id("qc")), "one resource for a cost of 2");
  const noThreshold = mk(1, 1);
  assert.equal(readyResources(noThreshold.engine, P1), 2);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("qc")), "[O][O] needs two obsession icons");
  play(thin.engine, P1, thin.id("qc"));
  assert.equal(zoneOf(thin.engine, thin.id("qc")), "play", "control: two obsession deploy it");
});

clause(CONCEALER, "0:rule", "only THIS card gets the token: another card entering play gets none, and does not add one to an existing Concealer", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qc", def: printing(CONCEALER), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "qc2", def: printing(CONCEALER), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(tokens(b.engine, b.id("other")), 0, "an ordinary character gets no token");
  assert.equal(tokens(b.engine, b.id("qc")), 1, "the Concealer already in play gains none");
  play(b.engine, P1, b.id("qc2"));
  assert.equal(tokens(b.engine, b.id("qc2")), 1, "a second Concealer enters with its own token");
  assert.equal(tokens(b.engine, b.id("qc")), 1, "the first is still at 1");
});

clause(CONCEALER, "0:rule", "a Concealer returned to hand and deployed again enters with ONE token (the old one does not carry over)", () => {
  const T = "5da75ce7-9ae6-484f-8bd5-ee7deeba9532"; // Quotidian Transposition: each player returns a character they own
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qc", def: printing(CONCEALER), owner: P1, zone: "hand" },
      { key: "qt", def: printing(T), owner: P1, zone: "hand" },
      ch("foe", P2),
      ...bank("obsession", 6, P1)
    ]
  });
  play(b.engine, P1, b.id("qc"));
  assert.equal(tokens(b.engine, b.id("qc")), 1);
  play(b.engine, P1, b.id("qt"));
  drain(b.engine, pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [pc.playerId === P1 ? b.id("qc") : b.id("foe")] } : declineAll(pc)));
  assert.equal(zoneOf(b.engine, b.id("qc")), "hand", "control: the Concealer was returned to hand");
  play(b.engine, P1, b.id("qc"));
  assert.equal(zoneOf(b.engine, b.id("qc")), "play");
  assert.equal(tokens(b.engine, b.id("qc")), 1, "exactly one token on re-entering play");
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "OBSCURE: removes one token from this card and the picked character (any controller, even the Concealer itself) gains COVERT", () => {
  for (const [label, owner, key] of [["own character", P1, "tgt"], ["opponent's character", P2, "tgt"], ["the Concealer itself", P1, "qc"]] as Array<[string, Pid, string]>) {
    const b = conc(1, [ch("tgt", owner, { cost: 0 }), ch("bystander", P1)]);
    assert.equal(hasKw(b.engine, b.id(key), "covert"), false, `${label}: control: no COVERT before`);
    activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [b.id(key)] } });
    noPending(b.engine);
    assert.equal(tokens(b.engine, b.id("qc")), 0, `${label}: the token was removed (cost)`);
    assert.equal(hasKw(b.engine, b.id(key), "covert"), true, `${label}: gains COVERT`);
    assert.equal(hasKw(b.engine, b.id("bystander"), "covert"), false, `${label}: an unpicked character does not`);
  }
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "OBSCURE costs ONLY a token: no resources, and it works while the Concealer is depleted", () => {
  const b = conc(1, [ch("tgt", P1)]);
  b.engine.state.cards[b.id("qc")].depleted = true;
  assert.equal(readyResources(b.engine, P1), 0);
  activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [b.id("tgt")] } });
  assert.equal(hasKw(b.engine, b.id("tgt"), "covert"), true, "usable with no resources while depleted");
  assert.equal(b.engine.state.cards[b.id("qc")].depleted, true);
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "OBSCURE needs a token: refused with none; each use spends exactly one (2 tokens = 2 uses)", () => {
  const none = conc(0, [ch("tgt", P1)]);
  refused(() => activate(none.engine, P1, none.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [none.id("tgt")] } }), "no token to remove");
  assert.equal(hasKw(none.engine, none.id("tgt"), "covert"), false, "nothing was granted");
  const two = conc(2, [ch("a", P1), ch("b", P2), ch("c", P1)]);
  activate(two.engine, P1, two.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [two.id("a")] } });
  assert.equal(tokens(two.engine, two.id("qc")), 1, "one token left after the first use");
  activate(two.engine, P1, two.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [two.id("b")] } });
  assert.equal(tokens(two.engine, two.id("qc")), 0);
  assert.deepEqual([hasKw(two.engine, two.id("a"), "covert"), hasKw(two.engine, two.id("b"), "covert"), hasKw(two.engine, two.id("c"), "covert")], [true, true, false]);
  refused(() => activate(two.engine, P1, two.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [two.id("c")] } }), "the third use has no token");
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "OBSCURE picks exactly one CHARACTER in play: items, cards in hand or discard, factions, face-down cards, two characters or none are refused (and no token is lost)", () => {
  const extra: Placement[] = [
    ch("ok", P1),
    ch("ok2", P2),
    { key: "it", def: item({ name: "Trinket" }), owner: P1, zone: "play" },
    { key: "hc", def: character({ name: "Hander" }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "Dead" }), owner: P1, zone: "discard" },
    { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
  ];
  const cases: Array<[string, (b: Board) => string[]]> = [
    ["an item", b => [b.id("it")]],
    ["a character in hand", b => [b.id("hc")]],
    ["a character in the discard pile", b => [b.id("dc")]],
    ["a face-down card in play", b => [b.id("fd")]],
    ["a faction", b => [facOf(b.engine, P2)]],
    ["two characters", b => [b.id("ok"), b.id("ok2")]],
    ["no pick at all", () => []]
  ];
  for (const [why, picks] of cases) {
    const b = conc(1, extra);
    refused(() => activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: picks(b) } }), why);
    assert.equal(tokens(b.engine, b.id("qc")), 1, `${why}: the refused use cost nothing`);
  }
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "COVERT lasts THIS TURN only: gone once the turn ends and still gone on the next turn", () => {
  const b = conc(1, [ch("tgt", P1)]);
  activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [b.id("tgt")] } });
  assert.equal(hasKw(b.engine, b.id("tgt"), "covert"), true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(hasKw(b.engine, b.id("tgt"), "covert"), false, "gone when the turn ends");
  endTurn(b.engine, P2);
  assert.equal(hasKw(b.engine, b.id("tgt"), "covert"), false, "and still gone on the next turn");
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "the granted COVERT really works: the party cannot be blocked by a non-covert character (and can without OBSCURE)", () => {
  const mk = () => conc(1, [ch("mine", P1, { strength: 2, life: 3 }), ch("foe", P2, { strength: 1, life: 3 })], 2);
  const plain = mk();
  declareAttackBy(plain.engine, P1, [plain.id("mine")]);
  plain.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [plain.id("foe")] });
  assert.deepEqual(battleOf(plain.engine)?.blockingParty, [plain.id("foe")], "control: without COVERT the foe can block");
  const b = mk();
  activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [b.id("mine")] } });
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  assert.throws(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] }), "a non-covert character cannot block a covert party");
});

// ---------------------------------------------------------------------------------------------
// Quotidian Transposition — tactic · cost 0 · threshold "ooo"
// ---------------------------------------------------------------------------------------------
const TRANSPOSITION = "5da75ce7-9ae6-484f-8bd5-ee7deeba9532";
const qt = (extra: Placement[], obs = 3): Board =>
  buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "qt", def: printing(TRANSPOSITION), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...extra] });
const qch = (key: string, owner: Pid, controller: Pid = owner): Placement => ({ key, def: character({ name: `Q ${key}`, strength: 2, life: 2 }), owner, controller, zone: "play" });
/** Every pick prompt is answered from `picks[playerId]`; records who was asked. */
function answerQt(b: Board, picks: Record<string, string[]>): Pid[] {
  const asked: Pid[] = [];
  drain(b.engine, pc => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    asked.push(pc.playerId as Pid);
    return { kind: "chooserSelectsTarget", selected: picks[pc.playerId] ?? [] };
  });
  noPending(b.engine);
  return asked;
}

clause(TRANSPOSITION, "0:rule", "each player picks one character they own and puts it into their hand; the unpicked ones stay; the tactic ends in the discard pile", () => {
  const b = qt([qch("a1", P1), qch("a2", P1), qch("b1", P2), qch("b2", P2)]);
  play(b.engine, P1, b.id("qt"));
  const asked = answerQt(b, { [P1]: [b.id("a1")], [P2]: [b.id("b1")] });
  assert.deepEqual([...asked].sort(), [P1, P2], "each player was asked exactly once");
  assert.ok(handOf(b.engine, P1).includes(b.id("a1")), "P1's pick is in P1's hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("b1")), "P2's pick is in P2's hand");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play", "P1's other character stays");
  assert.equal(zoneOf(b.engine, b.id("b2")), "play", "P2's other character stays");
  assert.equal(zoneOf(b.engine, b.id("qt")), "discard", "the tactic is spent");
});

clause(TRANSPOSITION, "0:rule", "a pick must be ONE character IN PLAY the picker OWNS: the other player's characters, items, locations, factions, face-down cards, hand and discard cards, or two characters are refused", () => {
  const cards: Placement[] = [];
  for (const o of [P1, P2]) {
    cards.push(
      qch(`c1${o}`, o), qch(`c2${o}`, o),
      { key: `it${o}`, def: item({ name: `Item ${o}` }), owner: o, zone: "play" },
      { key: `lo${o}`, def: location({ name: `Loc ${o}`, structure: 4 }), owner: o, zone: "play" },
      { key: `h${o}`, def: character({ name: `Hand ${o}` }), owner: o, zone: "hand" },
      { key: `d${o}`, def: character({ name: `Disc ${o}` }), owner: o, zone: "discard" },
      { key: `f${o}`, def: character({ name: `Fd ${o}` }), owner: o, zone: "play", faceDown: true }
    );
  }
  const b = qt(cards);
  play(b.engine, P1, b.id("qt"));
  const seen: Pid[] = [];
  while (b.engine.state.pendingChoice) {
    const pc = pcOf(b.engine);
    assert.equal(pc.kind, "chooserSelectsTarget");
    const me = pc.playerId;
    const other = me === P1 ? P2 : P1;
    seen.push(me);
    const bad: Array<[string, string[]]> = [
      ["the other player's character", [b.id(`c1${other}`)]],
      ["an item", [b.id(`it${me}`)]],
      ["a location", [b.id(`lo${me}`)]],
      ["a character in hand", [b.id(`h${me}`)]],
      ["a character in the discard pile", [b.id(`d${me}`)]],
      ["a face-down card", [b.id(`f${me}`)]],
      ["their own faction", [facOf(b.engine, me)]],
      ["two characters", [b.id(`c1${me}`), b.id(`c2${me}`)]]
    ];
    for (const [why, selected] of bad) {
      refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: me, choice: { kind: "chooserSelectsTarget", selected } } as never), `${me} picks ${why}`);
      assert.ok(b.engine.state.pendingChoice, `${why}: the prompt is still open`);
    }
    b.engine.perform({ type: "resolvePendingChoice", playerId: me, choice: { kind: "chooserSelectsTarget", selected: [b.id(`c2${me}`)] } } as never);
    resolvePendingResponses(b.engine);
  }
  assert.deepEqual([...seen].sort(), [P1, P2]);
  for (const o of [P1, P2]) {
    assert.equal(zoneOf(b.engine, b.id(`c2${o}`)), "hand", `${o}'s legal pick returned`);
    assert.equal(zoneOf(b.engine, b.id(`c1${o}`)), "play", `${o}'s other character stayed`);
    for (const k of [`it${o}`, `lo${o}`, `f${o}`]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} untouched`);
    assert.equal(zoneOf(b.engine, b.id(`d${o}`)), "discard");
  }
});

clause(TRANSPOSITION, "0:rule", "'a character they OWN': ownership decides, not control (an own character the opponent controls can be picked; one you control but don't own cannot)", () => {
  const b = qt([qch("a1", P1, P2), qch("a2", P1), qch("b1", P2, P1), qch("b2", P2)]);
  play(b.engine, P1, b.id("qt"));
  // The prompt for each player: try the character they only control (refused), then the one they own but don't control.
  const trial = (who: Pid, notOwned: string, owned: string): void => {
    const pc = pcOf(b.engine);
    assert.equal(pc.playerId, who, `it is ${who}'s pick`);
    refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: [b.id(notOwned)] } } as never), `${who} picks ${notOwned}, which they control but do not own`);
    b.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: [b.id(owned)] } } as never);
    resolvePendingResponses(b.engine);
  };
  const first = pcOf(b.engine).playerId;
  if (first === P1) {
    trial(P1, "b1", "a1");
    trial(P2, "a1", "b1");
  } else {
    trial(P2, "a1", "b1");
    trial(P1, "b1", "a1");
  }
  noPending(b.engine);
  assert.ok(handOf(b.engine, P1).includes(b.id("a1")), "a1 (owned by P1, controlled by P2) is in P1's hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("b1")), "b1 (owned by P2, controlled by P1) is in P2's hand");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play");
  assert.equal(zoneOf(b.engine, b.id("b2")), "play");
});

clause(TRANSPOSITION, "0:rule", "a player who owns no character in play simply doesn't pick; the other still does and nothing locks up", () => {
  for (const empty of [P2, P1]) {
    const full: Pid = empty === P1 ? P2 : P1;
    const b = qt([qch("x1", full), qch("x2", full), { key: "lo", def: location({ name: "Loc", structure: 4 }), owner: empty, zone: "play" }]);
    play(b.engine, P1, b.id("qt"));
    const asked = answerQt(b, { [full]: [b.id("x1")] });
    assert.deepEqual(asked, [full], `only ${full} had a pick to make`);
    assert.equal(zoneOf(b.engine, b.id("x1")), "hand");
    assert.equal(zoneOf(b.engine, b.id("x2")), "play");
    assert.equal(zoneOf(b.engine, b.id("lo")), "play", "the empty side's location is untouched");
    assert.equal(zoneOf(b.engine, b.id("qt")), "discard");
  }
});

clause(TRANSPOSITION, "0:rule", "costs 0 but needs [O][O][O]: playable for free with three obsession, refused with two", () => {
  const ok = qt([qch("a1", P1), qch("b1", P2)]);
  assert.equal(readyResources(ok.engine, P1), 3);
  play(ok.engine, P1, ok.id("qt"));
  answerQt(ok, { [P1]: [ok.id("a1")], [P2]: [ok.id("b1")] });
  assert.equal(readyResources(ok.engine, P1), 3, "nothing is paid");
  assert.equal(zoneOf(ok.engine, ok.id("qt")), "discard");
  const short = qt([qch("a1", P1), qch("b1", P2)], 2);
  refused(() => play(short.engine, P1, short.id("qt")), "only [O][O]");
  assert.equal(zoneOf(short.engine, short.id("qt")), "hand");
});

// ---------------------------------------------------------------------------------------------
// Study Disturbance — tactic · cost 1 · threshold "oo"
// ---------------------------------------------------------------------------------------------
const DISTURBANCE = "9107d563-b481-4bb2-8878-64589951e341";
const TAC_CHAR: CardDefinition = character({ name: "Tactical Guy", cost: 0, strength: 1, life: 2, speed: 1, behavior: { keywords: ["tactical"] } });
const TAC_ITEM: CardDefinition = item({ name: "Tactical Gadget", cost: 0, behavior: { keywords: ["tactical"] } });

/** P1 holds Study Disturbance + a 3-card deck; P1 has `p1Res` obsession, P2 has `p2Res` rage. Turn 2, so P1's character can attack. */
const sd = (p1Res: number, p2Res: number, extra: Placement[] = []): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sd", def: printing(DISTURBANCE), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "Deck One" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "Deck Two" }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "Deck Three" }), owner: P1, zone: "deck" },
      ...bank("obsession", p1Res, P1),
      ...bank("rage", p2Res, P2),
      ...extra
    ]
  });
/** Cards for the "can they still deploy?" probes. */
const probes = (): Placement[] => [
  ch("atk", P1, { strength: 2, life: 3 }),
  { key: "reg1", def: character({ name: "Regular One", cost: 0 }), owner: P1, zone: "hand" },
  { key: "reg2", def: character({ name: "Regular Two", cost: 0 }), owner: P2, zone: "hand" },
  { key: "tac", def: TAC_CHAR, owner: P2, zone: "hand" },
  { key: "tacItem", def: TAC_ITEM, owner: P2, zone: "hand" }
];
/** Casts Study Disturbance picking `pick`, checks that the PICKED player is the one asked, and answers that prompt with `pay`. */
function castSd(b: Board, pick: Pid, pay: boolean): PC {
  play(b.engine, P1, b.id("sd"), { selected: { p: [facOf(b.engine, pick)] } });
  const pc = { ...pcOf(b.engine) };
  assert.equal(pc.kind, "mayPay", "the picked player is asked whether to pay");
  assert.equal(pc.playerId, pick, "the PICKED player decides");
  b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  noPending(b.engine);
  return pc;
}
const reveals = (e: Eng) => e.getLog().filter(entry => entry.event?.type === "cardsRevealed").map(entry => entry.event as unknown as { cardIds: string[]; ownerId: string; viewerId: string; zone: string });
/** P1 attacks and P2, holding priority in the open window, tries to deploy `key` (stays inside the window). */
function p2DeploysInWindow(b: Board, key: string): void {
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id(key), selected: {} } as never);
}
const CANNOT_CHARS = /cannot play character cards/;

clause(DISTURBANCE, "0:ability", "COST: pick a player: the opponent or yourself can be picked, and that player is the one asked to pay; the tactic's own cost 1 is paid", () => {
  for (const pick of [P2, P1]) {
    const b = sd(5, 3);
    assert.equal(readyResources(b.engine, P1), 5);
    play(b.engine, P1, b.id("sd"), { selected: { p: [facOf(b.engine, pick)] } });
    assert.equal(pcOf(b.engine).kind, "mayPay", `picked ${pick}`);
    assert.equal(pcOf(b.engine).playerId, pick, "the picked player is asked");
    assert.equal(readyResources(b.engine, P1), 4, "cost 1 was paid");
  }
});

clause(DISTURBANCE, "0:ability", "COST: only one PLAYER can be picked: a character, an item, two players or nothing are refused (and nothing is paid)", () => {
  const extra = [...probes(), { key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" as const }];
  const cases: Array<[string, (b: Board) => string[]]> = [
    ["a character", b => [b.id("atk")]],
    ["an item", b => [b.id("it")]],
    ["two players", b => [facOf(b.engine, P1), facOf(b.engine, P2)]],
    ["nothing", () => []]
  ];
  for (const [why, picks] of cases) {
    const b = sd(3, 3, extra);
    refused(() => play(b.engine, P1, b.id("sd"), { selected: { p: picks(b) } }), why);
    assert.equal(zoneOf(b.engine, b.id("sd")), "hand", `${why}: not played`);
    assert.equal(readyResources(b.engine, P1), 3, `${why}: nothing paid`);
  }
});

clause(DISTURBANCE, "0:ability", "costs 1 with threshold [O][O]: refused with a single obsession, playable with two", () => {
  const short = sd(1, 3);
  refused(() => play(short.engine, P1, short.id("sd"), { selected: { p: [facOf(short.engine, P2)] } }), "one obsession icon");
  const ok = sd(2, 3);
  castSd(ok, P2, false);
  assert.equal(readyResources(ok.engine, P1), 1, "control: two obsession deploys it for 1");
});

clause(DISTURBANCE, "0:ability", "the picked player PAYS 2: the opponent's 2 resources are spent, the caster's are not", () => {
  const b = sd(3, 3);
  castSd(b, P2, true);
  assert.equal(readyResources(b.engine, P2), 1, "the picked player (P2) paid 2 of 3");
  assert.equal(readyResources(b.engine, P1), 2, "the caster paid only the card's own cost 1");
});

clause(DISTURBANCE, "0:ability", "if they pay: you look at the top card of YOUR deck (nothing is drawn or moved), and the card is terminated: no draw, no restriction, tactic in the discard pile", () => {
  const b = sd(3, 3, probes());
  const top = b.engine.state.players[P1].deck[0];
  const deckBefore = [...b.engine.state.players[P1].deck];
  const handBefore = handOf(b.engine, P1).length;
  castSd(b, P2, true);
  const seen = reveals(b.engine);
  assert.equal(seen.length, 1, "exactly one look");
  assert.deepEqual(seen[0].cardIds, [top], "the top card of the caster's deck");
  assert.deepEqual([seen[0].ownerId, seen[0].zone], [P1, "deck"]);
  assert.equal(seen[0].viewerId, P1, "the caster (you) looks");
  assert.deepEqual(b.engine.state.players[P1].deck, deckBefore, "the deck is untouched");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "no card drawn: the tactic left the hand and that is all");
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard", "the tactic is terminated into its owner's discard pile");
  // terminated => the Otherwise half never ran: P2 is not locked out of characters.
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  p2DeploysInWindow(b, "tac");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("tac")), "play", "P2 can still deploy a TACTICAL character this turn");
});

clause(DISTURBANCE, "0:ability", "if they don't pay: nothing is paid or looked at, and the CASTER draws exactly one card (the top of the deck)", () => {
  const b = sd(3, 3, probes());
  const top = b.engine.state.players[P1].deck[0];
  const deckLen = b.engine.state.players[P1].deck.length;
  const handBefore = handOf(b.engine, P1).length;
  const oppHand = handOf(b.engine, P2).length;
  castSd(b, P2, false);
  assert.equal(readyResources(b.engine, P2), 3, "the opponent paid nothing");
  assert.equal(reveals(b.engine).length, 0, "no look");
  assert.equal(handOf(b.engine, P1).length, handBefore, "the tactic left the hand and one card was drawn");
  assert.ok(handOf(b.engine, P1).includes(top), "the top card of the deck is the one drawn");
  assert.equal(b.engine.state.players[P1].deck.length, deckLen - 1, "exactly one card");
  assert.equal(handOf(b.engine, P2).length, oppHand, "the opponent drew nothing");
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard");
  play(b.engine, P1, b.id("reg1"));
  assert.equal(zoneOf(b.engine, b.id("reg1")), "play", "the caster is not restricted: they can deploy a character");
});

clause(DISTURBANCE, "0:ability", "if they don't pay: the picked opponent cannot play characters this turn (a TACTICAL character is refused in their response window), but can still play non-characters", () => {
  const control = sd(3, 3, probes());
  declareAttackOpenWindow(control.engine, P1, [control.id("atk")]);
  p2DeploysInWindow(control, "tac");
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("tac")), "play", "control: with no Study Disturbance the window deploy works");

  const b = sd(3, 3, probes());
  castSd(b, P2, false);
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  refused(() => p2DeploysInWindow(b, "tac"), "P2 may not play a character this turn", CANNOT_CHARS);
  assert.equal(zoneOf(b.engine, b.id("tac")), "hand");
  p2DeploysInWindow(b, "tacItem");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("tacItem")), "play", "a non-character is still allowed");
});

clause(DISTURBANCE, "0:ability", "'this turn': the restriction is gone on the opponent's own turn", () => {
  const b = sd(3, 3, probes());
  castSd(b, P2, false);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  play(b.engine, P2, b.id("reg2"));
  assert.equal(zoneOf(b.engine, b.id("reg2")), "play", "P2 deploys a character on their own turn");
});

clause(DISTURBANCE, "0:ability", "an opponent who cannot afford 2 can't pay: the Otherwise half happens (draw + no characters)", () => {
  const b = sd(3, 1, probes());
  const top = b.engine.state.players[P1].deck[0];
  play(b.engine, P1, b.id("sd"), { selected: { p: [facOf(b.engine, P2)] } });
  const pc = b.engine.state.pendingChoice as unknown as PC | undefined;
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } } as never), "paying 2 with one resource");
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: false } } as never);
  }
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  noPending(b.engine);
  assert.equal(readyResources(b.engine, P2), 1, "nothing was paid");
  assert.ok(handOf(b.engine, P1).includes(top), "the caster drew");
  assert.equal(reveals(b.engine).length, 0, "no look");
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  refused(() => p2DeploysInWindow(b, "tac"), "P2 may not play a character this turn", CANNOT_CHARS);
});

clause(DISTURBANCE, "0:ability", "picking YOURSELF: if you don't pay you draw and YOU can't play characters this turn (the opponent is not restricted)", () => {
  const control = sd(5, 3, probes());
  play(control.engine, P1, control.id("reg1"));
  assert.equal(zoneOf(control.engine, control.id("reg1")), "play", "control: normally the caster can deploy reg1");

  const b = sd(5, 3, probes());
  const top = b.engine.state.players[P1].deck[0];
  castSd(b, P1, false);
  assert.ok(handOf(b.engine, P1).includes(top), "the caster drew");
  assert.equal(readyResources(b.engine, P1), 4, "only the card's cost 1 was paid");
  refused(() => play(b.engine, P1, b.id("reg1")), "the picked player (the caster) cannot play characters", CANNOT_CHARS);
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  p2DeploysInWindow(b, "tac");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("tac")), "play", "the unpicked opponent is free to deploy");
});

clause(DISTURBANCE, "0:ability", "picking YOURSELF and paying: you pay 2, look at your own top card, nothing is drawn and you may still play characters", () => {
  const b = sd(5, 3, probes());
  const top = b.engine.state.players[P1].deck[0];
  const handBefore = handOf(b.engine, P1).length;
  castSd(b, P1, true);
  assert.equal(readyResources(b.engine, P1), 2, "1 for the card + 2 for the pay");
  const seen = reveals(b.engine);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].cardIds, seen[0].viewerId, seen[0].ownerId], [[top], P1, P1]);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "no draw");
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard");
  play(b.engine, P1, b.id("reg1"));
  assert.equal(zoneOf(b.engine, b.id("reg1")), "play", "no restriction");
});

// ---------------------------------------------------------------------------------------------
// Tedious TriAdic Truculence — tactic · cost 3 · threshold "ooo"
// ---------------------------------------------------------------------------------------------
const TRUC = "5379e1b4-5ccc-457d-8490-82d85615143e";
const tt = (p2Res: number, extra: Placement[] = [], obs = 3): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "tt", def: printing(TRUC), owner: P1, zone: "hand" },
      ...[1, 2, 3, 4, 5].map(i => ({ key: `d${i}`, def: character({ name: `Deck ${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("obsession", obs, P1),
      ...bank("rage", p2Res, P2),
      ...extra
    ]
  });
const tc = (key: string, owner: Pid, strength: number, name = `Tc ${key}`): Placement => ({ key, def: character({ name, strength, life: 4 }), owner, zone: "play" });
/** Casts Truculence on `picks`; the opponent answers the pay prompt with `pay`, a reorder prompt is answered by reversing the order. Returns the prompts seen. */
function runTt(b: Board, picks: string[], pay: boolean): PC[] {
  const seen: PC[] = [];
  play(b.engine, P1, b.id("tt"), { selected: { picks: picks.map(k => b.id(k)) } });
  drain(b.engine, pc => {
    seen.push({ ...pc } as PC);
    if (pc.kind === "mayPay") return { kind: "mayPay", pay };
    if (pc.kind === "reorderDeck") return { kind: "reorderDeck", order: [...(pc.cardIds as string[])].reverse() };
    return declineAll(pc);
  });
  noPending(b.engine);
  return seen;
}

clause(TRUC, "0:ability", "COST: pick 3 characters with different names (any side's, in play): mixed controllers are fine and the cost 3 is paid", () => {
  const b = tt(3, [tc("m", P1, 5), tc("a", P2, 5), tc("b", P2, 5)]);
  assert.equal(readyResources(b.engine, P1), 3);
  runTt(b, ["m", "a", "b"], false);
  assert.equal(zoneOf(b.engine, b.id("tt")), "discard");
  assert.equal(readyResources(b.engine, P1), 0, "cost 3 paid");
});

clause(TRUC, "0:ability", "COST: exactly 3, all different names, characters in play: two, four, duplicate names, items, hand/discard/face-down cards and factions are refused", () => {
  const extra: Placement[] = [
    tc("a", P2, 5), tc("b", P2, 5), tc("c", P1, 5), tc("d", P2, 5),
    tc("twin1", P2, 5, "Twin"), tc("twin2", P1, 5, "Twin"),
    { key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Hander" }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "Dead" }), owner: P2, zone: "discard" },
    { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
  ];
  const cases: Array<[string, (b: Board) => string[]]> = [
    ["two characters", b => [b.id("a"), b.id("b")]],
    ["four characters", b => [b.id("a"), b.id("b"), b.id("c"), b.id("d")]],
    ["two with the same name (one each side)", b => [b.id("twin1"), b.id("twin2"), b.id("a")]],
    ["an item as one of the three", b => [b.id("a"), b.id("b"), b.id("it")]],
    ["a character in hand", b => [b.id("a"), b.id("b"), b.id("hc")]],
    ["a character in the discard pile", b => [b.id("a"), b.id("b"), b.id("dc")]],
    ["a face-down card", b => [b.id("a"), b.id("b"), b.id("fd")]],
    ["a faction", b => [b.id("a"), b.id("b"), facOf(b.engine, P2)]],
    ["nothing", () => []]
  ];
  for (const [why, picks] of cases) {
    const b = tt(3, extra);
    refused(() => play(b.engine, P1, b.id("tt"), { selected: { picks: picks(b) } }), why);
    assert.equal(zoneOf(b.engine, b.id("tt")), "hand", `${why}: not played`);
    assert.equal(readyResources(b.engine, P1), 3, `${why}: nothing paid`);
  }
  const ok = tt(3, extra);
  runTt(ok, ["a", "b", "twin1"], false);
  assert.equal(zoneOf(ok.engine, ok.id("tt")), "discard", "control: three different names are accepted");
});

clause(TRUC, "0:ability", "costs 3 with threshold [O][O][O]: refused with two obsession, refused one resource short", () => {
  const picks = [tc("a", P2, 5), tc("b", P2, 5), tc("c", P2, 5)];
  const short = tt(3, [...picks, ...bank("rage", 1, P1)], 2);
  assert.equal(readyResources(short.engine, P1), 3, "the cost of 3 is affordable");
  refused(() => play(short.engine, P1, short.id("tt"), { selected: { picks: ["a", "b", "c"].map(k => short.id(k)) } }), "only [O][O] (plus a rage resource)");
  const thin = tt(3, [...picks], 2);
  assert.equal(readyResources(thin.engine, P1), 2);
  refused(() => play(thin.engine, P1, thin.id("tt"), { selected: { picks: ["a", "b", "c"].map(k => thin.id(k)) } }), "two resources for a cost of 3");
  const ok = tt(3, picks, 3);
  runTt(ok, ["a", "b", "c"], false);
  assert.equal(zoneOf(ok.engine, ok.id("tt")), "discard", "control: three obsession is enough");
});

clause(TRUC, "0:ability", "the opponent (never the caster) is asked to pay 3; if they decline, each picked character with strength 3 or less is destroyed and each above 3 survives; the tactic ends in the discard pile", () => {
  const b = tt(3, [tc("a", P2, 2), tc("b", P2, 3), tc("c", P2, 4), tc("bystander", P2, 1)]);
  const deckBefore = [...b.engine.state.players[P1].deck];
  const seen = runTt(b, ["a", "b", "c"], false);
  assert.deepEqual(seen.map(p => [p.kind, p.playerId]), [["mayPay", P2]], "only the opponent is asked, only to pay");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "strength 2 destroyed");
  assert.equal(zoneOf(b.engine, b.id("b")), "discard", "strength 3 destroyed");
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "strength 4 survives");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play", "an unpicked weak character survives");
  assert.equal(readyResources(b.engine, P2), 3, "the opponent paid nothing");
  assert.deepEqual(b.engine.state.players[P1].deck, deckBefore, "no deck look or reorder");
  assert.equal(zoneOf(b.engine, b.id("tt")), "discard");
});

clause(TRUC, "0:ability", "destroys the caster's own weak picked character too; all-strong picks destroy nothing", () => {
  const mixed = tt(3, [tc("mine", P1, 1), tc("big1", P2, 5), tc("big2", P2, 6)]);
  runTt(mixed, ["mine", "big1", "big2"], false);
  assert.equal(zoneOf(mixed.engine, mixed.id("mine")), "discard", "'each picked character' includes your own");
  assert.equal(zoneOf(mixed.engine, mixed.id("big1")), "play");
  assert.equal(zoneOf(mixed.engine, mixed.id("big2")), "play");
  const none = tt(3, [tc("x", P2, 4), tc("y", P2, 7), tc("z", P1, 5)]);
  runTt(none, ["x", "y", "z"], false);
  for (const k of ["x", "y", "z"]) assert.equal(zoneOf(none.engine, none.id(k)), "play", `${k}: strength above 3 survives`);
});

clause(TRUC, "0:ability", "'3 strength or less' reads the CURRENT strength: printed 5 weakened to 3 is destroyed, printed 3 boosted to 4 survives", () => {
  const b = tt(3, [
    tc("weak", P2, 5), { key: "wk", def: weakener(2), owner: P2, zone: "play", attachedToKey: "weak" },
    tc("strong", P2, 3), { key: "bo", def: booster(1), owner: P2, zone: "play", attachedToKey: "strong" },
    tc("plain", P2, 5)
  ]);
  assert.deepEqual([b.engine.getStat(b.id("weak"), "strength"), b.engine.getStat(b.id("strong"), "strength")], [3, 4], "control: current strengths");
  runTt(b, ["weak", "strong", "plain"], false);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  assert.equal(zoneOf(b.engine, b.id("strong")), "play");
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
});

clause(TRUC, "0:ability", "an opponent who cannot afford 3 can't pay: the picked weak characters are destroyed", () => {
  const b = tt(2, [tc("a", P2, 2), tc("b", P2, 3), tc("c", P2, 5)]);
  play(b.engine, P1, b.id("tt"), { selected: { picks: ["a", "b", "c"].map(k => b.id(k)) } });
  const pc = b.engine.state.pendingChoice as unknown as PC | undefined;
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } } as never), "paying 3 with two resources");
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: false } } as never);
  }
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  noPending(b.engine);
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(readyResources(b.engine, P2), 2);
});

clause(TRUC, "0:ability", "if the opponent pays 3: their 3 resources are spent, NONE of the picked characters is destroyed, the top 3 cards of the caster's deck are reordered (the 4th and 5th stay) and the card is terminated into the discard pile", () => {
  const b = tt(3, [tc("a", P2, 2), tc("b", P2, 3), tc("mine", P1, 1)]);
  const deck = [...b.engine.state.players[P1].deck];
  const seen = runTt(b, ["a", "b", "mine"], true);
  assert.deepEqual(seen.map(p => p.kind), ["mayPay", "reorderDeck"]);
  assert.equal(seen[0].playerId, P2, "the opponent is asked to pay");
  assert.deepEqual(seen[1].cardIds, deck.slice(0, 3), "the top 3 cards of the caster's deck are offered, in order");
  assert.equal(readyResources(b.engine, P2), 0, "the opponent paid 3");
  for (const k of ["a", "b", "mine"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} is not destroyed`);
  assert.deepEqual(b.engine.state.players[P1].deck, [deck[2], deck[1], deck[0], deck[3], deck[4]], "the top 3 are back in the chosen (reversed) order, the rest untouched");
  assert.equal(zoneOf(b.engine, b.id("tt")), "discard", "terminated");
});

clause(TRUC, "0:ability", "if the opponent pays 3, YOU (the caster) look at the top 3 cards of your deck and put them back in any order", () => {
  const b = tt(3, [tc("a", P2, 2), tc("b", P2, 3), tc("c", P2, 5)]);
  const seen = runTt(b, ["a", "b", "c"], true);
  const reorder = seen.find(p => p.kind === "reorderDeck");
  assert.ok(reorder, "a reorder prompt is raised");
  assert.equal(reorder.playerId, P1, "the caster ('you') looks at and reorders their own top 3");
});

// ---------------------------------------------------------------------------------------------
// Thabbashite Chemist — cost 2 · threshold "o" · str 1 / spd 3 / life 1
// ---------------------------------------------------------------------------------------------
const CHEMIST = "1aff6726-2aff-474e-92aa-bc997202f9b2";
/** The Chemist is in play; P1 controls `vol` face-down resources and `rage` face-up rage resources, plus `extra`. */
const chem = (vol: number, rage: number, extra: Placement[] = []): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "tc", def: printing(CHEMIST), owner: P1, zone: "play" }, ...volition(vol, P1), ...bank("rage", rage, P1), ...extra]
  });
const th = (b: Board, p: Pid, icon: string): number => (b.engine.getThresholds(p) as unknown as Record<string, number>)[icon] ?? 0;
/** Uses DELINIATE naming `x` as the threshold type. */
function deliniate(b: Board, x: string): void {
  activate(b.engine, P1, b.id("tc"), "tc-deliniate", {});
  drain(b.engine, pc => {
    if (pc.kind !== "nameValue") return declineAll(pc);
    assert.equal(pc.playerId, P1, "the Chemist's controller chooses the threshold type");
    return { kind: "nameValue", value: x };
  });
  noPending(b.engine);
}
const ICONS = ["rage", "greed", "deception", "elitism", "obsession", "volition"];

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: every face-down resource gains PROVIDES: X for the named type X, and only that type", () => {
  for (const x of ["greed", "elitism", "deception", "rage", "obsession"]) {
    const b = chem(3, 2);
    for (const i of ICONS) assert.equal(th(b, P1, i), i === "volition" ? 3 : i === "rage" ? 2 : 0, `control: ${i} before`);
    deliniate(b, x);
    for (const i of ICONS) {
      const expected = (i === "volition" ? 3 : i === "rage" ? 2 : 0) + (i === x ? 3 : 0);
      assert.equal(th(b, P1, i), expected, `X=${x}: ${i}`);
    }
  }
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: the granted icons really pay thresholds: a [G][G][G] character becomes deployable", () => {
  const greedy = character({ name: "Greedy", cost: 0, threshold: "ggg" });
  const mk = () => chem(3, 2, [{ key: "gr", def: greedy, owner: P1, zone: "hand" }]);
  const before = mk();
  refused(() => play(before.engine, P1, before.id("gr")), "no greed icons yet");
  const b = mk();
  deliniate(b, "greed");
  play(b.engine, P1, b.id("gr"));
  assert.equal(zoneOf(b.engine, b.id("gr")), "play", "three face-down resources now provide greed");
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: only FACE-DOWN resources gain it: face-up resources are unchanged (a face-up obsession resource stays one obsession)", () => {
  const b = chem(2, 2, bank("obsession", 2, P1));
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 2, "the 2 face-down resources, not the 4 resources");
  assert.equal(th(b, P1, "obsession"), 2, "face-up obsession resources keep just obsession");
  assert.equal(th(b, P1, "rage"), 2);
  const c = chem(2, 2, bank("obsession", 2, P1));
  deliniate(c, "obsession");
  assert.equal(th(c, P1, "obsession"), 4, "the 2 face-up obsession plus 2 face-down that gained obsession");
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: 'each face-down resource' is every face-down resource, the opponent's too", () => {
  const b = chem(2, 1, volition(2, P2));
  assert.equal(th(b, P2, "volition"), 2, "control: the opponent has two face-down resources");
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 2, "own face-down resources gain it");
  assert.equal(th(b, P2, "greed"), 2, "the printed text does not say 'your': the opponent's face-down resources gain it too");
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: a resource that already has PROVIDES: X gains nothing: using it twice for the same X does not double it", () => {
  const b = chem(3, 3);
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 3);
  b.engine.state.cards[b.id("tc")].depleted = false;
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 3, "the same X again: still one greed per face-down resource");
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: using it again with a DIFFERENT X adds that type and keeps the first", () => {
  const b = chem(3, 3);
  deliniate(b, "greed");
  b.engine.state.cards[b.id("tc")].depleted = false;
  deliniate(b, "elitism");
  assert.equal(th(b, P1, "elitism"), 3, "a different X adds that type");
  assert.equal(th(b, P1, "greed"), 3, "and keeps the first");
  assert.equal(th(b, P1, "volition"), 3, "volition is unchanged");
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT: naming Volition changes nothing, a face-down resource already provides Volition", () => {
  const b = chem(3, 2);
  deliniate(b, "volition");
  assert.equal(th(b, P1, "volition"), 3, "still one Volition per face-down resource");
  assert.equal(th(b, P1, "rage"), 2);
});

clause(CHEMIST, "0:ability:tc-deliniate", "EFFECT lasts THIS TURN only: gone as soon as the turn ends, and still gone on the next turn", () => {
  const b = chem(3, 2);
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 3);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(th(b, P1, "greed"), 0, "gone at the end of the turn");
  endTurn(b.engine, P2);
  assert.equal(th(b, P1, "greed"), 0, "and still gone on the controller's next turn");
});

clause(CHEMIST, "0:ability:tc-deliniate", "COST: pay 2 (two resources are spent) and deplete the Chemist, both on activation", () => {
  const b = chem(2, 4);
  assert.equal(readyResources(b.engine, P1), 6);
  assert.equal(b.engine.state.cards[b.id("tc")].depleted, false);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("tc"), abilityId: "tc-deliniate", selected: {}, variables: {} } as never);
  // "Choose a threshold type" is part of the cost: the costs are paid together once it is chosen.
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
  assert.equal(b.engine.state.cards[b.id("tc")].depleted, true, "the Chemist is depleted by the cost");
  assert.equal(readyResources(b.engine, P1), 4, "exactly 2 resources are spent by the cost");
});

clause(CHEMIST, "0:ability:tc-deliniate", "COST: 'Choose a threshold type. X is that type.' is part of the cost: it is asked on activation, before anything can respond", () => {
  const b = chem(2, 4);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("tc"), abilityId: "tc-deliniate", selected: {}, variables: {} } as never);
  const pc = b.engine.state.pendingChoice as unknown as PC | undefined;
  assert.ok(pc, "naming the threshold type is part of the cost, so it is asked before the opponent's response window");
  assert.equal(pc.kind, "nameValue");
  assert.equal(pc.playerId, P1);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(th(b, P1, "greed"), 2);
});

clause(CHEMIST, "0:ability:tc-deliniate", "COST: refused when the Chemist is already depleted, and refused when 2 resources can't be paid (a spent Chemist-use leaves 1 ready)", () => {
  const depleted = chem(2, 2);
  depleted.engine.state.cards[depleted.id("tc")].depleted = true;
  refused(() => activate(depleted.engine, P1, depleted.id("tc"), "tc-deliniate", {}), "already depleted");
  assert.equal(readyResources(depleted.engine, P1), 4, "nothing was paid");

  const poor = chem(2, 1);
  deliniate(poor, "greed");
  assert.equal(readyResources(poor.engine, P1), 1);
  poor.engine.state.cards[poor.id("tc")].depleted = false;
  refused(() => activate(poor.engine, P1, poor.id("tc"), "tc-deliniate", {}), "only 1 ready resource for 'Pay 2'");
  assert.equal(poor.engine.state.cards[poor.id("tc")].depleted, false, "and the Chemist wasn't depleted by the refused attempt");

  const rich = chem(2, 3);
  deliniate(rich, "greed");
  rich.engine.state.cards[rich.id("tc")].depleted = false;
  deliniate(rich, "elitism");
  assert.equal(th(rich, P1, "elitism"), 2, "control: with 3 ready left the second use works");
});

clause(CHEMIST, "0:ability:tc-deliniate", "threshold [V][V]: refused with a single face-down resource (or with any number of face-up ones), usable with exactly two", () => {
  const one = chem(1, 5);
  refused(() => activate(one.engine, P1, one.id("tc"), "tc-deliniate", {}), "one Volition icon");
  assert.equal(one.engine.state.cards[one.id("tc")].depleted, false);
  const faceUp = chem(0, 5, bank("greed", 3, P1));
  refused(() => activate(faceUp.engine, P1, faceUp.id("tc"), "tc-deliniate", {}), "no Volition at all");
  const two = chem(2, 0);
  deliniate(two, "greed");
  assert.equal(th(two, P1, "greed"), 2, "control: exactly two face-down resources are enough (and pay for the 2)");
});

clause(CHEMIST, "0:ability:tc-deliniate", "printed cost 2 and threshold [O]: deploys as 1 / 3 / 1, refused with one resource, refused with two non-obsession resources", () => {
  const mk = (obs: number, rage: number) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "tc", def: printing(CHEMIST), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...bank("rage", rage, P1)] });
  const ok = mk(1, 1);
  play(ok.engine, P1, ok.id("tc"));
  assert.equal(zoneOf(ok.engine, ok.id("tc")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "cost 2 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("tc"), "strength"), ok.engine.getStat(ok.id("tc"), "speed"), ok.engine.getStat(ok.id("tc"), "life")], [1, 3, 1]);
  const one = mk(1, 0);
  refused(() => play(one.engine, P1, one.id("tc")), "one resource for a cost of 2");
  const none = mk(0, 2);
  refused(() => play(none.engine, P1, none.id("tc")), "no obsession icon");
});

// ---------------------------------------------------------------------------------------------
// T3c9 mutation pass: printed type / trade / subtype, and durations that must outlast one battle
// ---------------------------------------------------------------------------------------------
const printedFields = (id: string): unknown[] => {
  const p = printing(id);
  return [p.type, p.trade, p.subtype, p.cost, p.threshold];
};
clause(OVERSEER, "0:ability", "(T3c9) printed: an arcanist ritualist character costing 4 with threshold [O]", () => {
  assert.deepEqual(printedFields(OVERSEER), ["character", "arcanist", ["ritualist"], 4, "o"]);
});
clause(PING, "vanilla", "(T3c9) printed: an arcanist monstrosity character costing 6 with threshold [O][O][O][O]", () => {
  assert.deepEqual(printedFields(PING), ["character", "arcanist", ["monstrosity"], 6, "oooo"]);
});
clause(CONCEALER, "0:rule", "(T3c9) printed: an arcanist ritualist character costing 2 with threshold [O][O]", () => {
  assert.deepEqual(printedFields(CONCEALER), ["character", "arcanist", ["ritualist"], 2, "oo"]);
});
clause(TRANSPOSITION, "0:rule", "(T3c9) printed: an arcanist tactic costing 0 with threshold [O][O][O]", () => {
  assert.deepEqual(printedFields(TRANSPOSITION), ["tactic", "arcanist", [], 0, "ooo"]);
});
clause(DISTURBANCE, "0:ability", "(T3c9) printed: an arcanist tactic costing 1 with threshold [O][O]", () => {
  assert.deepEqual(printedFields(DISTURBANCE), ["tactic", "arcanist", [], 1, "oo"]);
});
clause(TRUC, "0:ability", "(T3c9) printed: an arcanist tactic costing 3 with threshold [O][O][O]", () => {
  assert.deepEqual(printedFields(TRUC), ["tactic", "arcanist", [], 3, "ooo"]);
});
clause(CHEMIST, "0:ability:tc-deliniate", "(T3c9) printed: an arcanist ritualist character costing 2 with threshold [O]", () => {
  assert.deepEqual(printedFields(CHEMIST), ["character", "arcanist", ["ritualist"], 2, "o"]);
});

clause(CONCEALER, "1:ability:quotidian-concealer-obscure", "(T3c9) COVERT lasts the whole turn, not just one battle", () => {
  const b = conc(1, [ch("mine", P1, { strength: 2, life: 3 })], 2);
  activate(b.engine, P1, b.id("qc"), "quotidian-concealer-obscure", { selected: { ch: [b.id("mine")] } });
  fightThrough(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(hasKw(b.engine, b.id("mine"), "covert"), true, "still COVERT after the battle, this turn");
});

clause(DISTURBANCE, "0:ability", "(T3c9) 'this turn': the no-characters restriction lasts the whole turn, not just one battle", () => {
  const b = sd(3, 3, [...probes(), ch("atk2", P1, { strength: 2, life: 3 })]);
  castSd(b, P2, false);
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the first battle is over");
  declareAttackOpenWindow(b.engine, P1, [b.id("atk2")]);
  refused(() => p2DeploysInWindow(b, "tac"), "P2 still may not play a character in a later battle of the same turn", CANNOT_CHARS);
  assert.equal(zoneOf(b.engine, b.id("tac")), "hand");
});

clause(CHEMIST, "0:ability:tc-deliniate", "(T3c9) EFFECT lasts the whole turn, not just one battle", () => {
  const b = chem(3, 2, [ch("atk", P1, { strength: 2, life: 3 })]);
  deliniate(b, "greed");
  assert.equal(th(b, P1, "greed"), 3);
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(th(b, P1, "greed"), 3, "the granted icons are still there after the battle");
});
