import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  activate,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, printing, refused } from "./_clause.js";
import { declareAttackBy } from "./_battle.js";
import { fillers, pending } from "./_board.js";
import { attachedCount, endTurn, spentResources } from "./_turn.js";

const BONNET = "808bd2ba-7b76-4d81-b733-425078db481a"; // Extremely Tiny Bonnet of Invisibility
const FLESH = "94a4916f-0dcf-48d0-b1ab-62aa40c26070"; // Flesh Deliquesce
const BLESS = "f7215de9-64b6-44e6-b4f2-22749d93825f"; // God's Blessing of Foresight
const CHAMBER = "dd66ddb1-9ad2-40fa-921f-2ba487d3d453"; // Gosche's God Amplification Chamber

type Engine = ReturnType<typeof buildGame>["engine"];

const choose = (engine: Engine, playerId: string, selected: string[]) => {
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
};
const factionAttached = (engine: Engine, cardId: string, owner: string) =>
  engine.state.cards[cardId].attachedTo === engine.state.players[owner].factionId;
const keys = (ps: CardPlacement[]) => ps.map(p => p.key);

// A tactic that destroys any one card in play (used to remove attachments / locations / items).
const smash = (name: string, selector: Record<string, unknown>) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
const bounce = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  } as never);

/* ====================================================================== */
/* Extremely Tiny Bonnet of Invisibility — item · arcanist · gear · cost 0 · oo */
/* ====================================================================== */

function bonnetBoard(o: { obs?: number; rage?: number; p2Spent?: number; p2Ready?: number; p1Spent?: number; extra?: CardPlacement[]; turn?: number } = {}) {
  const p2Spent = spentResources(P2, o.p2Spent ?? 3);
  const p2Ready = bank("rage", o.p2Ready ?? 1, P2);
  const p1Spent = spentResources(P1, o.p1Spent ?? 0);
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    cards: [
      { key: "bon", def: printing(BONNET), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", o.obs ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...p2Spent,
      ...p2Ready,
      ...p1Spent,
      ...(o.extra ?? [])
    ]
  });
  return { ...g, p2Spent: keys(p2Spent), p2Ready: keys(p2Ready), p1Spent: keys(p1Spent) };
}
const castBonnet = (b: ReturnType<typeof bonnetBoard>, host = "host") => play(b.engine, P1, b.id("bon"), { selected: { attachTo: [b.id(host)] } });

clause(BONNET, "0:attach", "is an arcanist gear item with printed cost 0 and threshold oo", () => {
  const p = printing(BONNET);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "arcanist");
  assert.deepEqual(p.subtype, ["gear"]);
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "oo");
});

clause(BONNET, "0:attach", "deploys for cost 0 with oo (nothing is spent), attached to the chosen character you control", () => {
  const b = bonnetBoard({ obs: 2 });
  castBonnet(b);
  assert.equal(b.engine.state.pendingChoice === undefined || pending(b.engine)?.playerId === P2, true);
  if (pending(b.engine)) choose(b.engine, P2, []);
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bon")].attachedTo, b.id("host"));
  assert.equal(attachedCount(b.engine, P1), 0, "cost 0: none of the casting player's resources are spent");
});

clause(BONNET, "0:attach", "is refused with only one obsession resource (threshold oo short)", () => {
  const ok = bonnetBoard({ obs: 2 });
  castBonnet(ok);
  assert.equal(ok.engine.state.cards[ok.id("bon")].zone, "play", "control: oo deploys it");
  const b = bonnetBoard({ obs: 1 });
  refused(() => castBonnet(b), "o short of oo", /Threshold requirements are not met/);
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "hand");
});

clause(BONNET, "0:attach", "is refused with one obsession plus another icon (threshold needs both icons to be o)", () => {
  const b = bonnetBoard({ obs: 1, rage: 1 });
  refused(() => castBonnet(b), "o + r is not oo");
  const c = bonnetBoard({ obs: 0, rage: 3 });
  refused(() => castBonnet(c), "no o at all");
});

clause(BONNET, "0:attach", "cannot attach to an opponent's character", () => {
  const ok = bonnetBoard();
  castBonnet(ok, "host");
  assert.equal(ok.engine.state.cards[ok.id("bon")].attachedTo, ok.id("host"), "control");
  const b = bonnetBoard();
  refused(() => castBonnet(b, "foe"), "ATTACH TO CHARACTER YOU CONTROL");
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "hand");
});

clause(BONNET, "0:attach", "cannot attach to a non-character (an item or a location you control)", () => {
  const b = bonnetBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" }
    ]
  });
  refused(() => castBonnet(b, "itm"), "an item is not a character");
  refused(() => castBonnet(b, "loc"), "a location is not a character");
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "hand");
});

clause(BONNET, "1:extraCost", "the opponent chooses up to 2 of their faction-attached (spent) resources to detach; choosing two detaches exactly those two", () => {
  const b = bonnetBoard({ p2Spent: 3, p2Ready: 1 });
  castBonnet(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent (not the caster) makes the choice");
  const [s0, s1, s2] = b.p2Spent;
  choose(b.engine, P2, [b.id(s0), b.id(s2)]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(factionAttached(b.engine, b.id(s0), P2), false, "chosen resource detached");
  assert.equal(factionAttached(b.engine, b.id(s2), P2), false, "chosen resource detached");
  assert.equal(factionAttached(b.engine, b.id(s1), P2), true, "unchosen resource stays attached");
  assert.equal(attachedCount(b.engine, P2), 1);
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "play");
});

clause(BONNET, "1:extraCost", "the opponent may detach just one", () => {
  const b = bonnetBoard({ p2Spent: 3 });
  castBonnet(b);
  choose(b.engine, P2, [b.id(b.p2Spent[1])]);
  assert.equal(attachedCount(b.engine, P2), 2);
  assert.equal(factionAttached(b.engine, b.id(b.p2Spent[1]), P2), false);
});

clause(BONNET, "1:extraCost", "'may': the opponent can decline to detach anything, and the Bonnet is still deployed", () => {
  const b = bonnetBoard({ p2Spent: 3 });
  castBonnet(b);
  choose(b.engine, P2, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(b.engine, P2), 3, "nothing detached");
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bon")].attachedTo, b.id("host"));
});

clause(BONNET, "1:extraCost", "'up to 2': three resources cannot be chosen", () => {
  const b = bonnetBoard({ p2Spent: 3 });
  castBonnet(b);
  refused(() => choose(b.engine, P2, b.p2Spent.map(k => b.id(k))), "more than 2");
  choose(b.engine, P2, b.p2Spent.slice(0, 2).map(k => b.id(k)));
  assert.equal(attachedCount(b.engine, P2), 1, "control: two are fine");
});

clause(BONNET, "1:extraCost", "only resources attached to the opponent's faction are choosable: not their ready ones, not the caster's", () => {
  const b = bonnetBoard({ p2Spent: 2, p2Ready: 1, p1Spent: 1 });
  castBonnet(b);
  refused(() => choose(b.engine, P2, [b.id(b.p2Ready[0])]), "a never-spent (already detached) resource");
  refused(() => choose(b.engine, P2, [b.id(b.p1Spent[0])]), "the caster's own resource");
  refused(() => choose(b.engine, P2, [b.id("foe")]), "a non-resource");
  choose(b.engine, P2, [b.id(b.p2Spent[0])]);
  assert.equal(factionAttached(b.engine, b.id(b.p1Spent[0]), P1), true, "the caster's spent resource is untouched");
  assert.equal(factionAttached(b.engine, b.id(b.p2Spent[1]), P2), true);
});

clause(BONNET, "1:extraCost", "the caster's own spent resources are not detached by the cost", () => {
  const b = bonnetBoard({ p2Spent: 2, p1Spent: 2 });
  castBonnet(b);
  choose(b.engine, P2, b.p2Spent.map(k => b.id(k)));
  assert.equal(attachedCount(b.engine, P2), 0);
  assert.equal(attachedCount(b.engine, P1), 2);
});

clause(BONNET, "2:rule", "the attached character gains COVERT; other characters (yours and the opponent's) do not", () => {
  const b = bonnetBoard();
  assert.equal(b.engine.getKeywords(b.id("host")).includes("covert"), false, "before attaching");
  castBonnet(b);
  choose(b.engine, P2, []);
  assert.ok(b.engine.getKeywords(b.id("host")).includes("covert"), "b.engine.getKeywords(b.id(\"host\")).includes(\"covert\")");
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false);
  assert.equal(b.engine.getKeywords(b.id("foe")).includes("covert"), false);
});

clause(BONNET, "2:rule", "a COVERT attached character cannot be blocked by a non-COVERT character, but a COVERT blocker may block it", () => {
  const b = bonnetBoard({
    extra: [
      { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "Cov", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  castBonnet(b);
  choose(b.engine, P2, []);
  declareAttackBy(b.engine, P1, [b.id("host")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plain")] }), "non-covert cannot block", /covert/i);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("cov")] });
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("cov")]);
});

clause(BONNET, "2:rule", "without the Bonnet the same attacker can be blocked by a non-COVERT character (control)", () => {
  const b = bonnetBoard({ extra: [{ key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P1, [b.id("host")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plain")] });
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("plain")]);
});

clause(BONNET, "2:rule", "COVERT ends when the Bonnet leaves play, and stays off", () => {
  const b = bonnetBoard({ extra: [{ key: "sm", def: smash("SmashItem", { zone: "play", type: "item" }), owner: P1, zone: "hand" }] });
  castBonnet(b);
  choose(b.engine, P2, []);
  assert.ok(b.engine.getKeywords(b.id("host")).includes("covert"), "b.engine.getKeywords(b.id(\"host\")).includes(\"covert\")");
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bon")] } });
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "discard");
  assert.equal(b.engine.getKeywords(b.id("host")).includes("covert"), false);
  assert.equal(b.engine.state.cards[b.id("host")].zone, "play");
  assert.equal(b.engine.getKeywords(b.id("host")).includes("covert"), false);
});

clause(BONNET, "2:rule", "the Bonnet follows its host when the host is destroyed (COVERT gone with it)", () => {
  const b = bonnetBoard({ extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  castBonnet(b);
  choose(b.engine, P2, []);
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(b.engine.state.cards[b.id("host")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("bon")].zone, "discard");
});

/* ====================================================================== */
/* Flesh Deliquesce — tactic · arcanist · cost 4 · o                       */
/* ====================================================================== */

function fleshBoard(o: {
  obs?: number;
  rage?: number;
  foeStr?: number;
  oppReady?: number;
  oppSpent?: number;
  oppDown?: number;
  myIdle?: number;
  caster?: string;
  extra?: CardPlacement[];
} = {}) {
  const caster = o.caster ?? P1;
  const opp = caster === P1 ? P2 : P1;
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: caster,
    cards: [
      { key: "fd", def: printing(FLESH), owner: caster, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: o.foeStr ?? 3, life: 9 }), owner: opp, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9 }), owner: caster, zone: "play" },
      ...bank("obsession", o.obs ?? 4, caster),
      ...bank("rage", o.rage ?? 0, caster),
      ...bank("greed", o.myIdle ?? 0, caster),
      ...bank("rage", o.oppReady ?? 3, opp),
      ...spentResources(opp, o.oppSpent ?? 0),
      ...volition(o.oppDown ?? 0, opp),
      ...(o.extra ?? [])
    ]
  });
  return { ...g, caster, opp };
}
const castFlesh = (b: ReturnType<typeof fleshBoard>, target = "foe") => play(b.engine, b.caster, b.id("fd"), { selected: { c: [b.id(target)] } });
const zoneOfCard = (b: { engine: Engine; id: (k: string) => string }, k: string) => b.engine.state.cards[b.id(k)].zone;

clause(FLESH, "0:extraCost", "is an arcanist tactic with printed cost 4 and threshold o", () => {
  const p = printing(FLESH);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "arcanist");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "o");
});

clause(FLESH, "0:extraCost", "costs exactly 4: castable with 4 resources (one obsession), all 4 spent", () => {
  const b = fleshBoard({ obs: 1, rage: 3 });
  castFlesh(b);
  assert.equal(attachedCount(b.engine, P1), 4);
  assert.equal(zoneOfCard(b, "fd"), "discard");
});

clause(FLESH, "0:extraCost", "is refused with only 3 resources (cost short)", () => {
  const ok = fleshBoard({ obs: 4 });
  castFlesh(ok);
  assert.equal(zoneOfCard(ok, "fd"), "discard", "control: 4 resources work");
  const b = fleshBoard({ obs: 3 });
  refused(() => castFlesh(b), "cost 4 with 3 resources");
  assert.equal(zoneOfCard(b, "fd"), "hand");
});

clause(FLESH, "0:extraCost", "is refused with 4 resources and no obsession icon (threshold o short)", () => {
  const b = fleshBoard({ obs: 0, rage: 4 });
  refused(() => castFlesh(b), "threshold o short");
  assert.equal(zoneOfCard(b, "fd"), "hand");
});

clause(FLESH, "0:extraCost", "X counts the opponent's detached resources, not their faction-attached (spent) ones", () => {
  const hit = fleshBoard({ oppReady: 3, oppSpent: 4, foeStr: 3 });
  castFlesh(hit);
  assert.equal(zoneOfCard(hit, "foe"), "discard", "X = 3 (spent ones don't count): strength 3 <= 3");
  const miss = fleshBoard({ oppReady: 2, oppSpent: 4, foeStr: 3 });
  castFlesh(miss);
  assert.equal(zoneOfCard(miss, "foe"), "play", "X = 2 (not 6): strength 3 > 2");
});

clause(FLESH, "0:extraCost", "X counts the chosen opponent's resources only: the caster's own detached resources do not count", () => {
  const b = fleshBoard({ oppReady: 1, myIdle: 4, foeStr: 2 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "play", "X = 1 even though the caster has 4 other detached resources");
});

clause(FLESH, "0:extraCost", "X counts the opponent's face-down resources too", () => {
  const b = fleshBoard({ oppReady: 1, oppDown: 2, foeStr: 3 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "discard", "X = 1 face-up + 2 face-down = 3");
});

clause(FLESH, "0:extraCost", "works from the other seat: when P2 casts it, X counts P1's detached resources", () => {
  const b = fleshBoard({ caster: P2, oppReady: 3, myIdle: 0, foeStr: 3 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "discard");
  const c = fleshBoard({ caster: P2, oppReady: 2, foeStr: 3 });
  castFlesh(c);
  assert.equal(zoneOfCard(c, "foe"), "play");
});

clause(FLESH, "0:extraCost", "the picked character may be any character: including one you control", () => {
  const b = fleshBoard({ oppReady: 1 });
  castFlesh(b, "mine");
  assert.equal(zoneOfCard(b, "mine"), "discard", "own character with strength 1 <= X = 1 is destroyed");
  assert.equal(zoneOfCard(b, "foe"), "play");
});

clause(FLESH, "0:extraCost", "the pick must be a character: an item, a location and a faction are refused", () => {
  const b = fleshBoard({ extra: [
    { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" }
  ] });
  refused(() => castFlesh(b, "itm"), "item");
  refused(() => castFlesh(b, "loc"), "location");
  refused(() => play(b.engine, P1, b.id("fd"), { selected: { c: [b.engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(zoneOfCard(b, "fd"), "hand");
  castFlesh(b);
  assert.equal(zoneOfCard(b, "fd"), "discard", "control: a character is fine");
});

clause(FLESH, "1:rule", "destroys the character when its strength is equal to X", () => {
  const b = fleshBoard({ oppReady: 3, foeStr: 3 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "discard");
});

clause(FLESH, "1:rule", "destroys the character when its strength is below X", () => {
  const b = fleshBoard({ oppReady: 3, foeStr: 2 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "discard");
});

clause(FLESH, "1:rule", "does nothing when its strength is above X", () => {
  const b = fleshBoard({ oppReady: 3, foeStr: 4 });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "play");
  assert.equal(b.engine.state.cards[b.id("foe")].damage ?? 0, 0);
  assert.equal(zoneOfCard(b, "fd"), "discard", "the tactic is still spent");
});

clause(FLESH, "1:rule", "X = 0 destroys only a 0-strength character", () => {
  const zero = fleshBoard({ oppReady: 0, foeStr: 0 });
  castFlesh(zero);
  assert.equal(zoneOfCard(zero, "foe"), "discard");
  const one = fleshBoard({ oppReady: 0, foeStr: 1 });
  castFlesh(one);
  assert.equal(zoneOfCard(one, "foe"), "play");
});

clause(FLESH, "1:rule", "compares the character's current (modified) strength, not its printed strength", () => {
  const aura = () =>
    location({
      name: "Aura",
      behavior: { abilities: [{ id: "a", type: "continuous", modifiers: [{ selector: { type: "character" }, stat: "strength", operation: "add", value: 2 }] }] }
    } as never);
  const hit = fleshBoard({ oppReady: 2, foeStr: 0, extra: [{ key: "aura", def: aura(), owner: P2, zone: "play" }] });
  assert.equal(hit.engine.getStat(hit.id("foe"), "strength"), 2);
  castFlesh(hit);
  assert.equal(zoneOfCard(hit, "foe"), "discard", "current strength 2 <= X = 2");
  const miss = fleshBoard({ oppReady: 1, foeStr: 0, extra: [{ key: "aura", def: aura(), owner: P2, zone: "play" }] });
  castFlesh(miss);
  assert.equal(zoneOfCard(miss, "foe"), "play", "printed strength 0 would be <= 1, but current strength is 2");
});

clause(FLESH, "1:rule", "only the picked character is affected", () => {
  const b = fleshBoard({ oppReady: 5, foeStr: 1, extra: [{ key: "other", def: character({ name: "Other", strength: 1 }), owner: P2, zone: "play" }] });
  castFlesh(b);
  assert.equal(zoneOfCard(b, "foe"), "discard");
  assert.equal(zoneOfCard(b, "other"), "play");
  assert.equal(zoneOfCard(b, "mine"), "play");
});

clause(FLESH, "0:extraCost", "X is fixed when the card is cast: the opponent spending resources in response does not change it", () => {
  const rtac = tactic({ name: "Spend", cost: 1, threshold: "" } as never);
  const b = fleshBoard({ oppReady: 3, foeStr: 3, extra: [{ key: "resp", def: rtac, owner: P2, zone: "hand" }] });
  // X = 3 at cast. P2 responds by casting a cost-1 tactic, spending one of their resources (3 -> 2 detached).
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("fd"), selected: { c: [b.id("foe")] } } as never);
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("resp"), selected: {} } as never);
  assert.equal(attachedCount(b.engine, P2), 1, "P2 really spent a resource in response");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOfCard(b, "foe"), "discard", "X was 3 when cast");
});

/* ====================================================================== */
/* God's Blessing of Foresight — tactic · arcanist · mutation · cost 6 · ooo */
/* ====================================================================== */

function blessBoard(o: { obs?: number; rage?: number; turn?: number; active?: string; extra?: CardPlacement[]; attached?: string; tokens?: Record<string, number> } = {}) {
  const tok = o.tokens ?? {};
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      o.attached
        ? { key: "bl", def: printing(BLESS), owner: P1, zone: "play", attachedToKey: o.attached }
        : { key: "bl", def: printing(BLESS), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play", counters: tok.host ? { token: tok.host } : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play", counters: tok.ally ? { token: tok.ally } : undefined },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play", counters: tok.foe ? { token: tok.foe } : undefined },
      ...bank("obsession", o.obs ?? 6, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
  return g;
}
type BB = ReturnType<typeof blessBoard>;
const castBless = (b: BB, host = "host") => play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.id(host)] } });
const stat = (b: BB, k: string, s: "strength" | "speed" | "life") => b.engine.getStat(b.id(k), s);
const tokens = (b: BB, k: string) => b.engine.state.cards[b.id(k)].counters?.token ?? 0;
const covert = (b: BB, k: string) => b.engine.getKeywords(b.id(k)).includes("covert");

clause(BLESS, "0:unique", "is an arcanist mutation tactic with printed cost 6, threshold ooo, UNIQUE BLESSING", () => {
  const p = printing(BLESS);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "arcanist");
  assert.deepEqual(p.subtype, ["mutation"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "ooo");
  assert.equal((p as unknown as { unique?: string }).unique, "blessing");
});

clause(BLESS, "0:unique", "costs exactly 6: castable with 6 resources, all spent; refused with 5", () => {
  const b = blessBoard({ obs: 6 });
  castBless(b);
  assert.equal(attachedCount(b.engine, P1), 6);
  const s = blessBoard({ obs: 5 });
  refused(() => castBless(s), "cost 6 with 5 resources");
  assert.equal(s.engine.state.cards[s.id("bl")].zone, "hand");
});

clause(BLESS, "0:unique", "threshold ooo: three obsession among the six works, two does not", () => {
  const ok = blessBoard({ obs: 3, rage: 3 });
  castBless(ok);
  assert.equal(ok.engine.state.cards[ok.id("bl")].attachedTo, ok.id("host"), "control: 3 obsession + 3 rage");
  const b = blessBoard({ obs: 2, rage: 4 });
  refused(() => castBless(b), "oo short of ooo", /Threshold requirements are not met/);
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "hand");
  const none = blessBoard({ obs: 0, rage: 6 });
  refused(() => castBless(none), "no o at all");
});

clause(BLESS, "0:unique", "you cannot control two BLESSINGs: a second copy forces a choice and destroys the other", () => {
  const b = blessBoard({
    attached: "host",
    extra: [
      { key: "bl2", def: printing(BLESS), owner: P1, zone: "hand" },
      { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("bl"), b.id("bl2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl2") } } as never);
  assert.equal(b.engine.state.cards[b.id("bl2")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BLESS, "0:unique", "choosing the old Blessing keeps it and destroys the new one", () => {
  const b = blessBoard({
    attached: "host",
    extra: [
      { key: "bl2", def: printing(BLESS), owner: P1, zone: "hand" },
      { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl") } } as never);
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bl2")].zone, "discard");
});

clause(BLESS, "0:unique", "UNIQUE is per player: the opponent may control their own Blessing, and a different unique card is not a duplicate", () => {
  const other = blessBoard({
    attached: "host",
    extra: [{ key: "oth", def: item({ name: "OtherUnique", unique: "something else" } as never), owner: P1, zone: "play" }]
  });
  assert.equal(other.engine.state.pendingChoice, undefined);
  assert.equal(other.engine.state.cards[other.id("bl")].zone, "play");
  const b = blessBoard({
    attached: "host",
    turn: 3,
    active: P2,
    extra: [
      { key: "bl2", def: printing(BLESS), owner: P2, zone: "hand" },
      ...bank("obsession", 6, P2)
    ]
  });
  play(b.engine, P2, b.id("bl2"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bl2")].zone, "play");
});

clause(BLESS, "0:unique", "another card with the BLESSING designation counts as a duplicate", () => {
  const b = blessBoard({
    attached: "host",
    extra: [{ key: "fake", def: item({ name: "OtherBlessing", unique: "blessing" } as never), owner: P1, zone: "hand" }]
  });
  b.engine.state.cards[b.id("fake")].zone; // exists
  play(b.engine, P1, b.id("fake"), {});
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
});

clause(BLESS, "1:attach", "attaches to the chosen character and stays in play attached (does not go to the discard pile)", () => {
  const b = blessBoard();
  castBless(b);
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"));
});

clause(BLESS, "1:attach", "may attach to any character, including an opponent's", () => {
  const b = blessBoard();
  castBless(b, "foe");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "play");
});

clause(BLESS, "1:attach", "a Blessing attached to an opponent's character is still controlled by the player who cast it (CR 204.2a reading)", () => {
  const b = blessBoard();
  castBless(b, "foe");
  assert.equal(b.engine.state.cards[b.id("bl")].controllerId ?? P1, P1, "still controlled by its caster");
});

clause(BLESS, "1:attach", "cannot attach to a non-character", () => {
  const b = blessBoard({ extra: [
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" }
  ] });
  refused(() => castBless(b, "itm"), "item host");
  refused(() => castBless(b, "loc"), "location host");
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "hand");
  castBless(b);
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"), "control");
});

clause(BLESS, "2:rule", "the rules text applies only while attached: before casting nothing changes, after casting it does", () => {
  const b = blessBoard();
  assert.equal(stat(b, "ally", "speed"), 3);
  castBless(b);
  assert.equal(stat(b, "ally", "speed"), 2);
});

clause(BLESS, "2:rule", "the text is gone when the Blessing leaves play (destroyed), and stays gone", () => {
  const b = blessBoard({ attached: "host", extra: [{ key: "sm", def: smash("SmashBless", { zone: "play", type: "tactic" }), owner: P1, zone: "hand" }] });
  assert.equal(stat(b, "ally", "speed"), 2);
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "discard");
  assert.equal(stat(b, "ally", "speed"), 3);
  assert.equal(stat(b, "ally", "speed"), 3);
});

clause(BLESS, "2:rule", "the text leaves with the host: destroying the host sends the Blessing away and restores speed", () => {
  const b = blessBoard({ attached: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(b.engine.state.cards[b.id("host")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("bl")].zone, "discard");
  assert.equal(stat(b, "ally", "speed"), 3);
});

clause(BLESS, "2:rule", "the rules text is gained by the attached character only: a character without the Blessing has no turn-start trigger", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  endTurn(b.engine, P2);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  choose(b.engine, P1, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "exactly one trigger for the one Blessing");
});

clause(BLESS, "3.0:grant-rule", "at the start of your turn you may pick a character you control and put a token on it", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  choose(b.engine, P1, [b.id("ally")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b, "ally"), 1);
  assert.equal(tokens(b, "host"), 0);
  assert.equal(tokens(b, "foe"), 0);
});

clause(BLESS, "3.0:grant-rule", "the pick may be the attached character itself", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  endTurn(b.engine, P2);
  choose(b.engine, P1, [b.id("host")]);
  assert.equal(tokens(b, "host"), 1);
  assert.equal(tokens(b, "ally"), 0);
});

clause(BLESS, "3.0:grant-rule", "'may': declining the pick puts no token anywhere", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  endTurn(b.engine, P2);
  choose(b.engine, P1, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b, "host") + tokens(b, "ally") + tokens(b, "foe"), 0);
});

clause(BLESS, "3.0:grant-rule", "only a character you control can be picked: an opponent's character and two characters are refused", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  endTurn(b.engine, P2);
  refused(() => choose(b.engine, P1, [b.id("foe")]), "opponent's character");
  refused(() => choose(b.engine, P1, [b.id("host"), b.id("ally")]), "more than one");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the prompt is still open");
  choose(b.engine, P1, [b.id("ally")]);
  assert.equal(tokens(b, "ally"), 1);
});

clause(BLESS, "3.0:grant-rule", "it does not trigger at the start of the opponent's turn", () => {
  const b = blessBoard({ attached: "host", turn: 1, active: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b, "host") + tokens(b, "ally") + tokens(b, "foe"), 0);
});

clause(BLESS, "3.0:grant-rule", "it triggers every turn: tokens accumulate on the same character", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2, tokens: { ally: 1 } });
  endTurn(b.engine, P2);
  choose(b.engine, P1, [b.id("ally")]);
  assert.equal(tokens(b, "ally"), 2);
});

clause(BLESS, "3.0:grant-rule", "it stops triggering once the Blessing is gone", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2, extra: [{ key: "k", def: killTactic(), owner: P2, zone: "hand" }] });
  b.engine.state.cards[b.id("k")].zone; // exists
  // P2 (active) kills the host before ending the turn.
  play(b.engine, P2, b.id("k"), { selected: { t: [b.id("host")] } });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BLESS, "3.0:grant-rule", "'you' is the controller of the character that has the text: on an opponent's character, the opponent gets the trigger", () => {
  const b = blessBoard({ attached: "foe", turn: 1, active: P1, extra: [{ key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" }] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine)!;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  choose(b.engine, P2, [b.id("foe2")]);
  assert.equal(tokens(b, "foe2"), 1);
  assert.equal(tokens(b, "host"), 0);
});

clause(BLESS, "3.1:grant-rule", "all your characters lose 1 speed (including the host); the opponent's characters do not", () => {
  const b = blessBoard({ attached: "host" });
  assert.equal(stat(b, "host", "speed"), 2);
  assert.equal(stat(b, "ally", "speed"), 2);
  assert.equal(stat(b, "foe", "speed"), 3);
});

clause(BLESS, "3.1:grant-rule", "the speed loss is exactly 1 and affects a character entering later", () => {
  const b = blessBoard({ attached: "host", extra: [{ key: "late", def: character({ name: "Late", speed: 5 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("late"), {});
  assert.equal(b.engine.state.cards[b.id("late")].zone, "play");
  assert.equal(stat(b, "late", "speed"), 4);
});

clause(BLESS, "3.1:grant-rule", "speed does not go below 0", () => {
  const b = blessBoard({ attached: "host", extra: [{ key: "slow", def: character({ name: "Slow", speed: 0 }), owner: P1, zone: "play" }] });
  assert.equal(stat(b, "slow", "speed"), 0);
});

clause(BLESS, "3.1:grant-rule", "each character you control with a token gains 1 strength and COVERT", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 1 } });
  assert.equal(stat(b, "ally", "strength"), 3);
  assert.ok(covert(b, "ally"), "covert(b, \"ally\")");
  assert.equal(stat(b, "ally", "speed"), 2, "it also loses 1 speed");
});

clause(BLESS, "3.1:grant-rule", "a character you control without a token gains neither strength nor COVERT", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 1 } });
  assert.equal(stat(b, "host", "strength"), 2);
  assert.equal(covert(b, "host"), false);
});

clause(BLESS, "3.1:grant-rule", "the host itself gets strength and COVERT once it has a token", () => {
  const b = blessBoard({ attached: "host", tokens: { host: 1 } });
  assert.equal(stat(b, "host", "strength"), 3);
  assert.ok(covert(b, "host"), "covert(b, \"host\")");
});

clause(BLESS, "3.1:grant-rule", "several tokens on one character still give just +1 strength", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 3 } });
  assert.equal(stat(b, "ally", "strength"), 3);
});

clause(BLESS, "3.1:grant-rule", "an opponent's character with a token gets no strength and no COVERT", () => {
  const b = blessBoard({ attached: "host", tokens: { foe: 1 } });
  assert.equal(stat(b, "foe", "strength"), 2);
  assert.equal(covert(b, "foe"), false);
});

clause(BLESS, "3.1:grant-rule", "putting a token on a character turns the bonus on; it does not need a turn to pass", () => {
  const b = blessBoard({ attached: "host", turn: 2, active: P2 });
  assert.equal(stat(b, "ally", "strength"), 2);
  endTurn(b.engine, P2);
  choose(b.engine, P1, [b.id("ally")]);
  assert.equal(stat(b, "ally", "strength"), 3);
  assert.ok(covert(b, "ally"), "covert(b, \"ally\")");
});

clause(BLESS, "3.1:grant-rule", "the COVERT it grants makes the character unblockable by non-COVERT characters", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 1 } });
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] }), "non-covert cannot block", /covert/i);
});

clause(BLESS, "3.1:grant-rule", "a tokenless character is blockable by a non-COVERT character (control)", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 1 } });
  declareAttackBy(b.engine, P1, [b.id("host")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] });
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("foe")]);
});

clause(BLESS, "3.1:grant-rule", "'your' follows the character with the text: on an opponent's character, the opponent's characters are slowed and boosted, not the caster's", () => {
  const b = blessBoard({ attached: "foe", tokens: { foe: 1, ally: 1 } });
  assert.equal(stat(b, "foe", "speed"), 2, "the host's controller's characters lose speed");
  assert.equal(stat(b, "foe", "strength"), 3);
  assert.ok(covert(b, "foe"), "covert(b, \"foe\")");
  assert.equal(stat(b, "ally", "speed"), 3, "the caster's characters are not slowed");
  assert.equal(stat(b, "ally", "strength"), 2);
  assert.equal(covert(b, "ally"), false);
});

clause(BLESS, "3.1:grant-rule", "tokens and bonuses end with the text: tokened characters lose strength and COVERT when the Blessing leaves", () => {
  const b = blessBoard({ attached: "host", tokens: { ally: 1 }, extra: [{ key: "sm", def: smash("SmashBless", { zone: "play", type: "tactic" }), owner: P1, zone: "hand" }] });
  assert.equal(stat(b, "ally", "strength"), 3);
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  assert.equal(stat(b, "ally", "strength"), 2);
  assert.equal(covert(b, "ally"), false);
  assert.equal(tokens(b, "ally"), 1, "the token itself stays");
});

/* ====================================================================== */
/* Gosche's God Amplification Chamber — location · arcanist · cost 2 · o · structure 2 */
/* ====================================================================== */

function chamberBoard(o: { inPlay?: boolean; res?: number; owner?: string; extra?: CardPlacement[]; tokenHost?: boolean } = {}) {
  const owner = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ch", def: printing(CHAMBER), owner, zone: o.inPlay === false ? "hand" : "play" },
      { key: "tok", def: character({ name: "Tok", strength: 2, life: 9 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "foetok", def: character({ name: "FoeTok", strength: 2, life: 9 }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "k", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("obsession", o.res ?? 3, P1),
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type CB = ReturnType<typeof chamberBoard>;
const deckOf = (b: CB, p: string) => [...b.engine.state.players[p].deck];
const killIt = (b: CB, target: string) => play(b.engine, P1, b.id("k"), { selected: { t: [b.id(target)] } });
const seed = (b: CB, target: string, p = P1) => activate(b.engine, p, b.id("ch"), "seed", { selected: { c: [b.id(target)] } });

clause(CHAMBER, "0:rule", "is an arcanist location with printed cost 2, threshold o and structure 2", () => {
  const p = printing(CHAMBER);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "arcanist");
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "o");
  assert.equal(p.structure, 2);
  const b = chamberBoard({ inPlay: false, res: 2 });
  play(b.engine, P1, b.id("ch"), {});
  assert.equal(b.engine.state.cards[b.id("ch")].zone, "play");
  assert.equal(attachedCount(b.engine, P1), 2);
  assert.equal(b.engine.getStat(b.id("ch"), "structure"), 2);
});

clause(CHAMBER, "0:rule", "is refused with only 1 resource (cost 2 short)", () => {
  const b = chamberBoard({ inPlay: false, res: 1 });
  refused(() => play(b.engine, P1, b.id("ch"), {}), "cost short");
  assert.equal(b.engine.state.cards[b.id("ch")].zone, "hand");
});

clause(CHAMBER, "0:rule", "is refused with 2 resources and no obsession (threshold o short)", () => {
  const b = chamberBoard({ inPlay: false, res: 0, extra: bank("rage", 2, P1) });
  refused(() => play(b.engine, P1, b.id("ch"), {}), "threshold short");
  assert.equal(b.engine.state.cards[b.id("ch")].zone, "hand");
});

clause(CHAMBER, "0:rule", "when a character you control with a token leaves play (destroyed), you look at your top card: keeping it on top leaves the deck as it was", () => {
  const b = chamberBoard();
  const before = deckOf(b, P1);
  killIt(b, "tok");
  assert.equal(b.engine.state.cards[b.id("tok")].zone, "discard");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, [before[0]], "exactly the top card of YOUR deck");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [before[0]], bottom: [] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b, P1), before);
});

clause(CHAMBER, "0:rule", "'you may put it on the bottom': the looked-at card goes to the bottom, the rest keep their order", () => {
  const b = chamberBoard();
  const before = deckOf(b, P1);
  killIt(b, "tok");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [], bottom: [before[0]] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b, P1), [...before.slice(1), before[0]]);
  assert.deepEqual(deckOf(b, P2).length, 4, "the opponent's deck is untouched");
});

clause(CHAMBER, "0:rule", "only the top card is looked at: the prompt cannot be answered with a different card or two cards", () => {
  const b = chamberBoard();
  const before = deckOf(b, P1);
  killIt(b, "tok");
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [before[1]], bottom: [] } } as never),
    "wrong card"
  );
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [before[0], before[1]], bottom: [] } } as never),
    "two cards"
  );
});

clause(CHAMBER, "0:rule", "a character with a token that leaves play any other way (returned to hand) also triggers it", () => {
  const b = chamberBoard({ extra: [{ key: "bn", def: bounce(), owner: P1, zone: "hand" }] });
  const before = deckOf(b, P1);
  play(b.engine, P1, b.id("bn"), { selected: { t: [b.id("tok")] } });
  assert.equal(b.engine.state.cards[b.id("tok")].zone, "hand");
  const pc = pending(b.engine) as unknown as { kind: string; cardIds: string[] };
  assert.equal(pc?.kind, "reorderDeck");
  assert.deepEqual(pc.cardIds, [before[0]]);
});

clause(CHAMBER, "0:rule", "does not trigger when a character you control WITHOUT a token leaves play", () => {
  const b = chamberBoard();
  killIt(b, "plain");
  assert.equal(b.engine.state.cards[b.id("plain")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHAMBER, "0:rule", "does not trigger when an opponent's character with a token leaves play", () => {
  const b = chamberBoard();
  killIt(b, "foetok");
  assert.equal(b.engine.state.cards[b.id("foetok")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHAMBER, "0:rule", "a Chamber controlled by the opponent reacts to their characters, not to yours", () => {
  const b = chamberBoard({ owner: P2 });
  killIt(b, "tok");
  assert.equal(b.engine.state.cards[b.id("tok")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "P1's token character dying means nothing to P2's Chamber");
  const c = chamberBoard({ owner: P2 });
  killIt(c, "foetok");
  const pc = pending(c.engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc.playerId, P2);
  assert.deepEqual(pc.cardIds, [deckOf(c, P2)[0]], "P2's own top card");
});

clause(CHAMBER, "0:rule", "only CHARACTERS with a token trigger it: an item with a token leaving play does not", () => {
  const b = chamberBoard({
    extra: [
      { key: "itm", def: item({ name: "TokItem" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "ik", def: smash("SmashItem", { zone: "play", type: "item" }), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("itm")] } });
  assert.equal(b.engine.state.cards[b.id("itm")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "an item is not a character");
});

clause(CHAMBER, "0:rule", "stops working once the Chamber has left play", () => {
  const b = chamberBoard({ extra: [{ key: "lk", def: smash("SmashLoc", { zone: "play", type: "location" }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("lk"), { selected: { t: [b.id("ch")] } });
  assert.equal(b.engine.state.cards[b.id("ch")].zone, "discard");
  killIt(b, "tok");
  assert.equal(b.engine.state.cards[b.id("tok")].zone, "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHAMBER, "1:ability:seed", "TRANSITION: deplete this card, pay 2, and put a token on the chosen character you control", () => {
  const b = chamberBoard({ res: 3 });
  const def = b.engine.getDefinition(b.id("ch"));
  assert.equal(def.behavior?.abilities?.find(a => a.id === "seed")?.name, "Transition");
  seed(b, "plain");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ch")].depleted, true, "deplete this card");
  assert.equal(attachedCount(b.engine, P1), 2, "pay 2 (exactly two of the three resources)");
  assert.equal(b.engine.state.cards[b.id("plain")].counters?.token ?? 0, 1);
  assert.equal(b.engine.state.cards[b.id("tok")].counters?.token, 1, "other characters unchanged");
  assert.equal(b.engine.state.cards[b.id("foe")].counters?.token ?? 0, 0);
});

clause(CHAMBER, "1:ability:seed", "works with exactly 2 resources, refused with 1 (pay 2 short)", () => {
  const ok = chamberBoard({ res: 2 });
  seed(ok, "plain");
  assert.equal(ok.engine.state.cards[ok.id("plain")].counters?.token, 1, "control: exactly 2 resources");
  const b = chamberBoard({ res: 1 });
  refused(() => seed(b, "plain"), "pay 2 with 1 resource");
  assert.equal(b.engine.state.cards[b.id("plain")].counters?.token ?? 0, 0);
});

clause(CHAMBER, "1:ability:seed", "cannot be used while the Chamber is depleted", () => {
  const b = chamberBoard({ res: 3 });
  seed(b, "plain");
  const c = chamberBoard({ res: 3 });
  c.engine.state.cards[c.id("ch")].depleted = true;
  refused(() => seed(c, "plain"), "depleted", /costs cannot be paid/i);
  assert.equal(c.engine.state.cards[c.id("plain")].counters?.token ?? 0, 0);
  assert.equal(attachedCount(c.engine, P1), 0, "nothing paid");
});

clause(CHAMBER, "1:ability:seed", "the target must be a character you control: an opponent's character or an item is refused", () => {
  const b = chamberBoard({ res: 3, extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }] });
  refused(() => seed(b, "foe"), "opponent's character");
  refused(() => seed(b, "itm"), "item");
  assert.equal(b.engine.state.cards[b.id("foe")].counters?.token ?? 0, 0);
  assert.equal(b.engine.state.cards[b.id("itm")].counters?.token ?? 0, 0);
  seed(b, "plain");
  assert.equal(b.engine.state.cards[b.id("plain")].counters?.token, 1, "control");
});

clause(CHAMBER, "1:ability:seed", "can target a character that already has a token (tokens stack on a second use)", () => {
  const b = chamberBoard({ res: 4 });
  seed(b, "tok");
  assert.equal(b.engine.state.cards[b.id("tok")].counters?.token, 2);
  refused(() => seed(b, "tok"), "already depleted from the first use", /costs cannot be paid/i);
  b.engine.state.cards[b.id("ch")].depleted = false;
  seed(b, "tok");
  assert.equal(b.engine.state.cards[b.id("tok")].counters?.token, 3);
  assert.equal(attachedCount(b.engine, P1), 4);
});

clause(BLESS, "3.0:grant-rule", "a Blessing the caster cast onto an opponent's character: the granted text is used by the host's controller on THEIR turn, never by the caster (rules answer Q43)", () => {
  const b = blessBoard({ turn: 1, active: P1, extra: [{ key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" }] });
  castBless(b, "foe");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("foe"), "attached to the opponent's character");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine)!;
  assert.equal(pc?.kind, "chooserSelectsTarget", "the host's controller is offered the granted trigger");
  assert.equal(pc.playerId, P2, "the host's controller, not the Blessing's caster, makes the pick");
  refused(() => choose(b.engine, P2, [b.id("ally")]), "P2 can only pick characters P2 controls");
  choose(b.engine, P2, [b.id("foe2")]);
  assert.equal(tokens(b, "foe2"), 1, "the token went onto the host controller's character");
  assert.equal(tokens(b, "ally") + tokens(b, "host"), 0, "the caster's characters got nothing");
  // the other half (no trigger on the caster's own turn) is the open mismatch ungodly-mess-01-p2-3 below.
});

clause(CHAMBER, "1:ability:seed", "the opponent cannot use your Chamber", () => {
  const b = chamberBoard({ res: 3, extra: bank("greed", 3, P2) });
  refused(() => activate(b.engine, P2, b.id("ch"), "seed", { selected: { c: [b.id("foe")] } }), "not P2's card");
  assert.equal(b.engine.state.cards[b.id("foe")].counters?.token ?? 0, 0);
});

clause(BLESS, "3.0:grant-rule", "on an opponent's character it does not trigger at the start of the Blessing caster's turn (only the host controller's)", () => {
  const b = blessBoard({ attached: "foe", turn: 2, active: P2, extra: [{ key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" }] });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "P1's turn start is not the start of the host controller's (P2's) turn");
});
