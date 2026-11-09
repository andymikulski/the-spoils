// Multiplayer clause tests for Shade of the Devoured Emperor, part 3: effects over every opponent, "an opponent" picks,
// the one-opponent superlatives (MPQ-P9), Stuttershy and Flaming Cube.
import assert from "node:assert/strict";
import { character, resourceCard, tactic } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import { mpClause, printing, refused } from "../_clause.js";
import { 
  alive, choosePlayer, controllerOf, doom, filler, go, hand, infl, needs, offered, pcOf, pickCandidates, pickCards, pickOption, play, settleOrder, stat, table, tokens, unit, use, zone, P1, P2, P3, P4, type Board, type Pid, type Placement
 } from "./_shade.js";
import { resolvePendingResponses } from "../../support/fixtures.js";

const STUTTERSHY = "fd095fbd-7566-4b39-832e-0f40a0181289";
const CLOCKMAN_CITY_SHUFFLE = "0a841e49-928b-4a3e-b4fa-ffdb9349bcf0";
const MARTIAL_ARTS_WANNABE = "53598621-abf6-4b9f-bc94-6c70bd77cb10";
const OPPORTUNISTIC_PIRATE = "81f3e9be-87fd-4626-9206-c54b6d7be32e";
const SHARPEY = "c6e93f75-e05d-4dfb-a77d-c74b662a7c02";
const CONFLAGRATION = "25d8789e-b481-4c1d-aae5-8c3cb2d22786";
const FLAMING_CUBE = "de91eacd-1b08-4595-a238-f4654e554ab8";
const JUICE_SALE = "a5290ff5-114a-4ed7-804f-f751a1abf086";
const WORDS_OF_GLORY = "10d5c7f3-17fe-423e-95c7-b73715b61bc6";
const CONTIGUOUS_MACHINE = "25ba52f8-62c9-4e2c-8daa-7e6d841f6c76";

const damageOf = (b: Board, key: string): number => b.engine.state.cards[b.id(key)]!.damage;
const majigs = (b: Board, who: Pid): number =>
  Object.values(b.engine.state.cards).filter((card) => card.zone === "play" && card.controllerId === who && b.engine.getDefinition(card.id).name === "Micromajig").length;

// --- Stuttershy --------------------------------------------------------------------------------

const slayStutter = (owner: Pid): Placement => ({
  key: "slay",
  owner,
  zone: "hand",
  def: tactic({ name: "Slay it", behavior: { abilities: [{ id: "slay", type: "activated", targets: [{ id: "t", selector: { type: "character", name: "Stuttershy" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } })
});

mpClause(STUTTERSHY, "0:rule", 3, "3 seats: destroyed by P2's effect it is flipped face down under its owner's control instead; nobody is asked which opponent", () => {
  const b = table(3, [{ key: "stutter", def: printing(STUTTERSHY), owner: P1, zone: "play" }, slayStutter(P2)], { active: P2, turn: 2 });
  go(b, play(b, P2, "slay", { selected: { t: [b.id("stutter")] } }));
  assert.equal(zone(b, "stutter"), "play", "not destroyed");
  assert.equal(b.engine.state.cards[b.id("stutter")]!.faceDown, true, "flipped face down");
  assert.equal(controllerOf(b, "stutter"), P1, "under its owner's control");
  assert.notEqual(pcOf(b.engine)?.kind, "choosePlayer");
  assert.equal(pcOf(b.engine)?.playerId, P1, "only the controller is asked (about the tokens)");
});
mpClause(STUTTERSHY, "1:rule", 3, "3 seats: flipped down, P2's and P3's factions each gain 1 influence (not P1's); P1 may then put one Micromajig token per influence gained (2) under P1's control", () => {
  const b = table(3, [{ key: "stutter", def: printing(STUTTERSHY), owner: P1, zone: "play" }, slayStutter(P2)], { active: P2, turn: 2 });
  const before = [P1, P2, P3].map((p) => infl(b.engine, p));
  go(b, play(b, P2, "slay", { selected: { t: [b.id("stutter")] } }));
  assert.deepEqual([P1, P2, P3].map((p) => infl(b.engine, p)), [before[0], before[1]! + 1, before[2]! + 1]);
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsOption");
  assert.equal(pcOf(b.engine)?.playerId, P1);
  pickOption(b, P1, 1);
  assert.deepEqual([majigs(b, P1), majigs(b, P2), majigs(b, P3)], [2, 0, 0], "two tokens for P1 only");
  const declined = table(3, [{ key: "stutter", def: printing(STUTTERSHY), owner: P1, zone: "play" }, slayStutter(P2)], { active: P2, turn: 2 });
  go(declined, play(declined, P2, "slay", { selected: { t: [declined.id("stutter")] } }));
  pickOption(declined, P1, 0);
  assert.equal(majigs(declined, P1), 0, "declining puts none");
});
mpClause(STUTTERSHY, "1:rule", 4, "4 seats: all three opponents' factions gain 1 and P1 may put 3 tokens; if P4 is eliminated first only 2 factions gain and 2 tokens come", () => {
  const board = () =>
    table(4, [{ key: "stutter", def: printing(STUTTERSHY), owner: P1, zone: "play" }, slayStutter(P1), doom(P4)]);
  const b = board();
  go(b, play(b, P1, "slay", { selected: { t: [b.id("stutter")] } }));
  assert.deepEqual([P1, P2, P3, P4].map((p) => infl(b.engine, p)), [25, 26, 26, 26]);
  pickOption(b, P1, 1);
  assert.equal(majigs(b, P1), 3);
  const thin = board();
  go(thin, play(thin, P1, "doom"));
  assert.equal(alive(thin.engine, P4), false);
  go(thin, play(thin, P1, "slay", { selected: { t: [thin.id("stutter")] } }));
  assert.deepEqual([P1, P2, P3].map((p) => infl(thin.engine, p)), [25, 26, 26]);
  pickOption(thin, P1, 1);
  assert.equal(majigs(thin, P1), 2, "one token per faction that gained");
});

// --- Clockman City Shuffle ---------------------------------------------------------------------

mpClause(CLOCKMAN_CITY_SHUFFLE, "0:rule", 3, "3 seats: P1's characters gain 1/1 and every character of P2 and of P3 loses 1/1 this turn, then it wears off", () => {
  const b = table(3, [
    { key: "ccs", def: printing(CLOCKMAN_CITY_SHUFFLE), owner: P1, zone: "hand" },
    ...bank("deception", 5, P1),
    unit(P1, "c1", { strength: 3, life: 3 }),
    unit(P2, "c2", { strength: 3, life: 3 }),
    unit(P2, "c2b", { strength: 3, life: 3 }),
    unit(P3, "c3", { strength: 3, life: 3 })
  ]);
  const read = (key: string) => [stat(b, key, "strength"), stat(b, key, "life")];
  go(b, play(b, P1, "ccs"));
  assert.deepEqual(read("c1"), [4, 4]);
  for (const key of ["c2", "c2b", "c3"]) assert.deepEqual(read(key), [2, 2], key);
  b.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(b.engine);
  assert.deepEqual(read("c1"), [3, 3], "the effect ended with the turn");
  assert.deepEqual(read("c3"), [3, 3]);
});
mpClause(CLOCKMAN_CITY_SHUFFLE, "0:rule", 4, "4 seats: the characters of P2, P3 and P4 all lose 1/1; only P1's gain", () => {
  const b = table(4, [
    { key: "ccs", def: printing(CLOCKMAN_CITY_SHUFFLE), owner: P1, zone: "hand" },
    ...bank("deception", 5, P1),
    unit(P1, "c1", { strength: 3, life: 3 }),
    unit(P2, "c2", { strength: 3, life: 3 }),
    unit(P3, "c3", { strength: 3, life: 3 }),
    unit(P4, "c4", { strength: 3, life: 3 })
  ]);
  go(b, play(b, P1, "ccs"));
  assert.deepEqual(["c1", "c2", "c3", "c4"].map((key) => stat(b, key, "strength")), [4, 2, 2, 2]);
  assert.deepEqual(["c1", "c2", "c3", "c4"].map((key) => stat(b, key, "life")), [4, 2, 2, 2]);
});

// --- Martial Arts Wannabe ----------------------------------------------------------------------

mpClause(MARTIAL_ARTS_WANNABE, "0:rule", 3, "3 seats: one opponent is chosen and the character counts are compared with that opponent alone (never the total of both opponents)", () => {
  const poke = (): Placement => ({
    key: "poke",
    owner: P1,
    zone: "hand",
    def: tactic({ name: "Poke", behavior: { abilities: [{ id: "poke", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [] }] } })
  });
  const run = (counts: Record<Pid, number>, chosen: Pid) => {
    const b = table(3, [
      { key: "maw", def: printing(MARTIAL_ARTS_WANNABE), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      poke(),
      ...Array.from({ length: counts[P1] - 1 }, (_, i) => unit(P1, `m${i}`)),
      ...Array.from({ length: counts[P2] }, (_, i) => unit(P2, `o2-${i}`)),
      ...Array.from({ length: counts[P3] }, (_, i) => unit(P3, `o3-${i}`))
    ]);
    go(b, play(b, P1, "maw"));
    assert.equal(pcOf(b.engine)?.kind, "choosePlayer", "the controller selects the opponent when the text starts applying");
    assert.equal(pcOf(b.engine)?.playerId, P1);
    assert.deepEqual((pcOf(b.engine) as unknown as { candidates: Pid[] }).candidates, [P2, P3], "P2 and P3 are offered, not P1");
    choosePlayer(b, P1, chosen);
    assert.equal(pcOf(b.engine), undefined);
    return pickCandidates(b, play(b, P1, "poke")).includes(b.id("maw"));
  };
  assert.equal(run({ [P1]: 3, [P2]: 2, [P3]: 3, [P4]: 0 }, P2), false, "3 against P2's 2: it cannot be picked");
  assert.equal(run({ [P1]: 3, [P2]: 2, [P3]: 3, [P4]: 0 }, P3), true, "3 against P3's 3: it can be picked (the total 5 is never used)");
  assert.equal(run({ [P1]: 3, [P2]: 2, [P3]: 2, [P4]: 0 }, P2), false, "3 against 2: hidden");
  assert.equal(run({ [P1]: 3, [P2]: 2, [P3]: 2, [P4]: 0 }, P3), false, "3 against 2: hidden either way");
});

// --- Opportunistic Pirate ----------------------------------------------------------------------

mpClause(OPPORTUNISTIC_PIRATE, "1:ability", 3, "3 seats: the controller names one opponent; the up-to-4 removed cards come from that opponent's discard pile only, and each cuts the cost by 1", () => {
  for (const [named, other] of [[P3, P2], [P2, P3]] as const) {
    const b = table(3, [
      { key: "pirate", def: printing(OPPORTUNISTIC_PIRATE), owner: P1, zone: "hand" },
      ...bank("deception", 7, P1),
      ...filler(P1, "discard", 2),
      ...filler(P2, "discard", 4),
      ...filler(P3, "discard", 4)
    ]);
    assert.deepEqual(needs(b, play(b, P1, "pirate"))[0], { kind: "players", choices: [{ id: "opponent", candidates: [P2, P3] }] }, "the opponent is named first");
    const withOpp = play(b, P1, "pirate", { players: { opponent: named } });
    assert.deepEqual(new Set(pickCandidates(b, withOpp, "rem")), new Set([0, 1, 2, 3].map((i) => b.id(`discard-${named}-${i}`))), "only the named opponent's discard pile");
    refused(() => b.engine.perform(play(b, P1, "pirate", { players: { opponent: named }, selected: { rem: [b.id(`discard-${other}-0`)] } })), "a card from the other opponent's pile");
    refused(() => b.engine.perform(play(b, P1, "pirate", { players: { opponent: named }, selected: { rem: [b.id(`discard-${named}-0`), b.id(`discard-${other}-1`)] } })), "cards from two piles");
    refused(() => b.engine.perform(play(b, P1, "pirate", { players: { opponent: named }, selected: { rem: [b.id("discard-p1-0")] } })), "the controller's own pile");
    go(b, play(b, P1, "pirate", { players: { opponent: named }, selected: { rem: [0, 1, 2].map((i) => b.id(`discard-${named}-${i}`)) } }));
    assert.equal(zone(b, "pirate"), "play");
    for (const i of [0, 1, 2]) assert.notEqual(zone(b, `discard-${named}-${i}`), "discard", "removed from the game");
    assert.equal(zone(b, `discard-${named}-3`), "discard");
    for (const i of [0, 1, 2, 3]) assert.equal(zone(b, `discard-${other}-${i}`), "discard", "the other opponent's pile is unchanged");
    assert.equal(b.engine.getAvailableResourceCount(P1), 3, "7 minus 3 removed = 4 paid, 3 resources left");
  }
});

// --- Sharpey Pointy Lethal Army Tool -----------------------------------------------------------

function sharpey(seats: 3 | 4, top: Placement): Board {
  return table(seats, [
    { key: "host", def: character({ name: "Host", strength: 2, life: 4 }), owner: P1, zone: "play" },
    { key: "sharpey", def: printing(SHARPEY), owner: P1, zone: "play", attachedToKey: "host" },
    ...bank("deception", 2, P1),
    top,
    ...filler(P1, "deck", 2),
    unit(P1, "own", { life: 4 }),
    ...([P2, P3, P4] as Pid[]).slice(0, seats - 1).map((owner) => unit(owner, `c${owner.slice(1)}`, { life: 4 }))
  ]);
}
const topCard = (kind: "big" | "small" | "resource"): Placement => ({
  key: "top",
  owner: P1,
  zone: "deck",
  def: kind === "resource" ? resourceCard({ name: "Top resource" }) : character({ name: `Top ${kind}`, cost: kind === "big" ? 5 : 2 })
});
const unfold = (b: Board) => go(b, use(b, P1, "sharpey", "sharpey-unfold"));
mpClause(SHARPEY, "2:ability:sharpey-unfold", 3, "3 seats: a revealed cost of 5 or more gives every character of P2 and of P3 -1 life, not P1's; a cost of 0-4 destroys the attached character only; a resource also destroys all opponents' characters", () => {
  const big = sharpey(3, topCard("big"));
  unfold(big);
  assert.deepEqual(["c2", "c3", "own", "host"].map((key) => stat(big, key, "life")), [3, 3, 4, 4]);
  assert.equal(zone(big, "host"), "play");
  const small = sharpey(3, topCard("small"));
  unfold(small);
  assert.deepEqual(["host", "own", "c2", "c3"].map((key) => zone(small, key)), ["discard", "play", "play", "play"]);
  assert.deepEqual(["c2", "c3"].map((key) => stat(small, key, "life")), [4, 4]);
  const res = sharpey(3, topCard("resource"));
  unfold(res);
  assert.deepEqual(["host", "own", "c2", "c3"].map((key) => zone(res, key)), ["discard", "play", "discard", "discard"]);
});
mpClause(SHARPEY, "2:ability:sharpey-unfold", 4, "4 seats: the cost-5 result gives all three opponents' characters -1 life; the resource result destroys all of them", () => {
  const big = sharpey(4, topCard("big"));
  unfold(big);
  assert.deepEqual(["c2", "c3", "c4", "own"].map((key) => stat(big, key, "life")), [3, 3, 3, 4]);
  const res = sharpey(4, topCard("resource"));
  unfold(res);
  assert.deepEqual(["c2", "c3", "c4", "own", "host"].map((key) => zone(res, key)), ["discard", "discard", "discard", "play", "discard"]);
});

// --- Confrontational Conflagration -------------------------------------------------------------

mpClause(CONFLAGRATION, "0:ability", 3, "3 seats: the second pick may be a character of either opponent (not the controller's); only the picked one is damaged", () => {
  for (const [picked, other] of [[P3, P2], [P2, P3]] as const) {
    const b = table(3, [
      { key: "cc", def: printing(CONFLAGRATION), owner: P1, zone: "hand" },
      ...bank("rage", 1, P1),
      unit(P1, "mine", { strength: 3, life: 6 }),
      unit(P1, "mine2", { strength: 3, life: 6 }),
      unit(P2, "t2", { life: 6 }),
      unit(P2, "t2b", { life: 6 }),
      unit(P3, "t3", { life: 6 })
    ]);
    const action = play(b, P1, "cc");
    assert.equal(needs(b, action).some((r) => r.kind === "players"), false, "no opponent is asked: the pick settles which one");
    assert.deepEqual(new Set(pickCandidates(b, action, "theirs")), new Set([b.id("t2"), b.id("t2b"), b.id("t3")]), "characters of both opponents, none of the controller's");
    const key = `t${picked.slice(1)}`;
    go(b, play(b, P1, "cc", { selected: { mine: [b.id("mine")], theirs: [b.id(key)] } }));
    assert.equal(damageOf(b, "mine"), 3, "X = the strength of the controller's character");
    assert.equal(damageOf(b, key), 3);
    assert.equal(damageOf(b, "mine2"), 0);
    for (const k of ["t2", "t2b", "t3"].filter((k) => k !== key)) assert.equal(damageOf(b, k), 0, `${k} untouched`);
    void other;
  }
});

// --- Juice Sale! -------------------------------------------------------------------------------

function juice(): Board {
  return table(3, [
    { key: "js", def: printing(JUICE_SALE), owner: P1, zone: "hand" },
    ...bank("rage", 2, P1),
    unit(P1, "mine", { strength: 9 }),
    unit(P2, "p2-3", { strength: 3 }),
    unit(P2, "p2-2", { strength: 2 }),
    unit(P3, "p3-5", { strength: 5 }),
    unit(P3, "p3-1", { strength: 1 })
  ]);
}
mpClause(JUICE_SALE, "0:ability", 3, "3 seats: the controller picks one opponent and the pick is that opponent's highest-strength character; never the other opponent's, never the controller's", () => {
  const b = juice();
  assert.deepEqual(needs(b, play(b, P1, "js"))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] });
  assert.deepEqual(pickCandidates(b, play(b, P1, "js", { players: { picked: P2 } })), [b.id("p2-3")], "P2's strength-3 character");
  assert.deepEqual(pickCandidates(b, play(b, P1, "js", { players: { picked: P3 } })), [b.id("p3-5")], "P3's strength-5 character");
  refused(() => b.engine.perform(play(b, P1, "js", { players: { picked: P2 }, selected: { ch: [b.id("p3-5")] } })), "the other opponent's highest character");
  refused(() => b.engine.perform(play(b, P1, "js", { players: { picked: P3 }, selected: { ch: [b.id("p3-1")] } })), "a lower-strength character of the picked opponent");
});
mpClause(JUICE_SALE, "0:ability", 3, "3 seats: each opponent's strength is compared only within their own characters (equal strengths of different opponents are no tie); a tie within one opponent is the controller's to decide; the picked character cannot block", () => {
  const b = table(3, [
    { key: "js", def: printing(JUICE_SALE), owner: P1, zone: "hand" },
    ...bank("rage", 2, P1),
    unit(P1, "att", { strength: 2 }),
    unit(P2, "p2-a", { strength: 3 }),
    unit(P2, "p2-b", { strength: 3 }),
    unit(P3, "p3-a", { strength: 3 }),
    unit(P3, "p3-b", { strength: 1 })
  ]);
  assert.deepEqual(new Set(pickCandidates(b, play(b, P1, "js", { players: { picked: P2 } }))), new Set([b.id("p2-a"), b.id("p2-b")]), "tie inside P2's characters: both eligible");
  assert.deepEqual(pickCandidates(b, play(b, P1, "js", { players: { picked: P3 } })), [b.id("p3-a")], "P3's own highest: a P2 character of equal strength is no tie");
  go(b, play(b, P1, "js", { players: { picked: P3 }, selected: { ch: [b.id("p3-a")] } }));
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("att")], target: { type: "faction", playerId: P3 } });
  resolvePendingResponses(b.engine);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P3, blockerIds: [b.id("p3-a")] }), "the picked character cannot block");
  b.engine.perform({ type: "declareBlockers", playerId: P3, blockerIds: [b.id("p3-b")] });
});

// --- Words of Glory ----------------------------------------------------------------------------

mpClause(WORDS_OF_GLORY, "0:ability", 3, "3 seats: X is the total strength of all characters P2 and P3 control (not P1's); X-3 damage to every character, P1's included", () => {
  const b = table(3, [
    { key: "wog", def: printing(WORDS_OF_GLORY), owner: P1, zone: "hand" },
    ...bank("rage", 7, P1),
    unit(P1, "c1", { strength: 6, life: 30 }),
    unit(P2, "c2a", { strength: 4, life: 30 }),
    unit(P2, "c2b", { strength: 3, life: 30 }),
    unit(P3, "c3", { strength: 5, life: 30 })
  ]);
  go(b, play(b, P1, "wog"));
  assert.deepEqual(["c1", "c2a", "c2b", "c3"].map((key) => damageOf(b, key)), [9, 9, 9, 9], "X = 12, 9 damage to all");
});
mpClause(WORDS_OF_GLORY, "0:ability", 4, "4 seats: X totals all three opponents' characters (16); 13 damage to all characters; the controller's own never count toward X", () => {
  const b = table(4, [
    { key: "wog", def: printing(WORDS_OF_GLORY), owner: P1, zone: "hand" },
    ...bank("rage", 7, P1),
    unit(P1, "c1", { strength: 6, life: 30 }),
    unit(P2, "c2a", { strength: 4, life: 30 }),
    unit(P2, "c2b", { strength: 3, life: 30 }),
    unit(P3, "c3", { strength: 5, life: 30 }),
    unit(P4, "c4a", { strength: 2, life: 30 }),
    unit(P4, "c4b", { strength: 2, life: 30 })
  ]);
  go(b, play(b, P1, "wog"));
  assert.deepEqual(["c1", "c2a", "c2b", "c3", "c4a", "c4b"].map((key) => damageOf(b, key)), [13, 13, 13, 13, 13, 13]);
});

// --- Flaming Cube ------------------------------------------------------------------------------

const cube = (seats: 3 | 4, tokenCount: number, extra: Placement[] = [], options: Parameters<typeof table>[2] = {}): Board =>
  table(seats, [{ key: "cube", def: printing(FLAMING_CUBE), owner: P1, zone: "play", counters: { token: tokenCount } }, ...extra], options);
const endTurnOf = (b: Board, who: Pid): void => {
  b.engine.perform({ type: "endTurn", playerId: who });
  resolvePendingResponses(b.engine);
  settleOrder(b);
};

mpClause(FLAMING_CUBE, "0:rule", 3, "3 seats: it enters play with 3 tokens, whatever the number of opponents", () => {
  const b = table(3, [{ key: "cube", def: printing(FLAMING_CUBE), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]);
  go(b, play(b, P1, "cube"));
  assert.equal(zone(b, "cube"), "play");
  assert.equal(tokens(b, "cube"), 3);
});
mpClause(FLAMING_CUBE, "1:rule", 3, "3 seats: a token is put on it at the start of P1's turn only, not at the start of P2's or P3's", () => {
  const b = cube(3, 3);
  endTurnOf(b, P1);
  assert.equal(tokens(b, "cube"), 3, "P2's turn starts: nothing");
  endTurnOf(b, P2);
  assert.equal(tokens(b, "cube"), 3, "P3's turn starts: nothing");
  endTurnOf(b, P3);
  assert.equal(tokens(b, "cube"), 4, "P1's turn starts: a token");
});
mpClause(FLAMING_CUBE, "2:rule", 3, "3 seats: at 6 tokens it is destroyed and the factions of P2 and P3 each lose 6 influence, not P1's; P3 at 6 is eliminated, P2 survives", () => {
  const b = cube(3, 5, [], { active: P3, turn: 3, influence: { [P2]: 20, [P3]: 6 } });
  endTurnOf(b, P3);
  assert.equal(zone(b, "cube"), "discard");
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], [25, 14]);
  assert.equal(alive(b.engine, P3), false, "P3 reached 0");
  assert.equal(alive(b.engine, P2), true);
  assert.equal(b.engine.state.winner, undefined, "P1 and P2 play on");
});
mpClause(FLAMING_CUBE, "2:rule", 3, "3 seats: both opponents at 6 or less reach 0 in the same unit and P1 wins as the only survivor", () => {
  const b = cube(3, 5, [], { active: P3, turn: 3, influence: { [P2]: 6, [P3]: 4 } });
  endTurnOf(b, P3);
  assert.deepEqual([infl(b.engine, P2) <= 0, infl(b.engine, P3) <= 0, infl(b.engine, P1)], [true, true, 25], "both reached 0 in the same unit, P1's faction is untouched");
  assert.equal(b.engine.state.winner, P1);
});
mpClause(FLAMING_CUBE, "2:rule", 4, "4 seats: all three opponents' factions lose 6; P2 at 20 survives, P3 and P4 at 6 are eliminated together, P1 and P2 play on", () => {
  const b = cube(4, 5, [], { active: P4, turn: 4, influence: { [P2]: 20, [P3]: 6, [P4]: 6 } });
  endTurnOf(b, P4);
  assert.equal(zone(b, "cube"), "discard");
  assert.deepEqual([alive(b.engine, P1), alive(b.engine, P2), alive(b.engine, P3), alive(b.engine, P4)], [true, true, false, false]);
  assert.equal(infl(b.engine, P2), 14);
  assert.equal(infl(b.engine, P1), 25);
  assert.equal(b.engine.state.winner, undefined);
});
mpClause(FLAMING_CUBE, "3:rule", 3, "3 seats: with no tokens left it is destroyed and no faction loses influence", () => {
  const b = cube(3, 1, [unit(P2, "x2")], { active: P2, turn: 2 });
  go(b, use(b, P2, "cube", "fc-control", { selected: { x: [b.id("x2")] } }));
  pickOption(b, P2, 1);
  assert.equal(zone(b, "cube"), "discard");
  assert.deepEqual([P1, P2, P3].map((p) => infl(b.engine, p)), [25, 25, 25]);
});
mpClause(FLAMING_CUBE, "4:ability:fc-control", 3, "3 seats: P1, P2 and P3 can each use CONTROL THE FLAME!, each destroying only a character or item of their own as the cost", () => {
  for (const user of [P1, P2, P3]) {
    const b = cube(3, 3, [unit(P1, "x1"), unit(P2, "x2"), unit(P3, "x3")], { active: user, turn: [P1, P2, P3].indexOf(user) + 1 });
    const action = use(b, user, "cube", "fc-control");
    const mine = `x${user.slice(1)}`;
    const ownCards = user === P1 ? [b.id(mine), b.id("cube")] : [b.id(mine)];
    assert.deepEqual(new Set(pickCandidates(b, action, "x")), new Set(ownCards), `${user} may only pick characters and items they control (the Cube is P1's)`);
    go(b, use(b, user, "cube", "fc-control", { selected: { x: [b.id(mine)] } }));
    pickOption(b, user, 0);
    assert.equal(tokens(b, "cube"), 4);
    assert.equal(zone(b, mine), "discard");
    for (const other of [P1, P2, P3].filter((p) => p !== user)) assert.equal(zone(b, `x${other.slice(1)}`), "play");
  }
});

// --- Contiguous Defalcating Machine ------------------------------------------------------------

function machine(entering: Pid): Board {
  const seats: Pid[] = [P1, P2, P3];
  return table(
    3,
    [
      { key: "machine", def: printing(CONTIGUOUS_MACHINE), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: entering, zone: "hand" },
      ...seats.flatMap((owner) => [0, 1].map((i): Placement => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner, zone: "play" }))),
      { key: "res-loaned", def: resourceCard({ name: "Loaned" }), owner: P3, controller: P2, zone: "play" }
    ],
    { active: entering, turn: seats.indexOf(entering) + 1 }
  );
}
for (const entering of [P1, P2, P3]) {
  mpClause(CONTIGUOUS_MACHINE, "1:rule", 3, `3 seats: a character entering play under ${entering}'s control: ${entering} alone chooses one of the three options`, () => {
    const b = machine(entering);
    go(b, play(b, entering, "newbie"));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsOption");
    assert.equal(pcOf(b.engine)?.playerId, entering, "the entering character's controller, nobody else");
    assert.equal((pcOf(b.engine) as unknown as { optionCount: number }).optionCount, 3);
  });
}
mpClause(CONTIGUOUS_MACHINE, "2:option:OPTION 1", 3, "3 seats: P2's character enters and P2 picks OPTION 1: P2 picks one resource P2 controls, which goes to its owner's hand (a loaned resource goes to P3's hand)", () => {
  const b = machine(P2);
  go(b, play(b, P2, "newbie"));
  pickOption(b, P2, 0);
  assert.equal(pcOf(b.engine)?.playerId, P2);
  assert.deepEqual(new Set(offered(b)), new Set([b.id("res-p2-0"), b.id("res-p2-1"), b.id("res-loaned")]), "only resources P2 controls");
  pickCards(b, P2, ["res-loaned"]);
  assert.equal(hand(b.engine, P3).includes(b.id("res-loaned")), true, "to its owner's hand");
  assert.equal(zone(b, "res-p1-0"), "play");
  assert.equal(zone(b, "res-p3-0"), "play");
});
mpClause(CONTIGUOUS_MACHINE, "2:option:OPTION 1", 3, "3 seats: with P3's character entering, P3 picks among resources P3 controls; with P1's character entering, P1 picks among P1's", () => {
  for (const entering of [P3, P1]) {
    const b = machine(entering);
    go(b, play(b, entering, "newbie"));
    pickOption(b, entering, 0);
    assert.equal(pcOf(b.engine)?.playerId, entering);
    const own = [0, 1].map((i) => b.id(`res-${entering}-${i}`));
    assert.deepEqual(new Set(offered(b)), new Set(own), "only the entering character's controller's resources");
  }
});
mpClause(CONTIGUOUS_MACHINE, "3:option:OPTION 2", 3, "3 seats: a P3-controlled character enters and P3 picks OPTION 2: that character is destroyed; P1's and P2's cards stay", () => {
  const b = machine(P3);
  go(b, play(b, P3, "newbie"));
  pickOption(b, P3, 1);
  assert.equal(zone(b, "newbie"), "discard");
  assert.equal(zone(b, "machine"), "play");
  assert.equal(zone(b, "res-p1-0"), "play");
});
mpClause(CONTIGUOUS_MACHINE, "4:option:OPTION 3", 3, "3 seats: a P2-controlled character enters and P2 picks OPTION 3: P2's faction loses 3 influence; P1's and P3's do not", () => {
  const b = machine(P2);
  go(b, play(b, P2, "newbie"));
  pickOption(b, P2, 2);
  assert.deepEqual([P1, P2, P3].map((p) => infl(b.engine, p)), [25, 22, 25]);
});

// <<END>>
