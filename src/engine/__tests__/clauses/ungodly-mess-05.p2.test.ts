import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

const CIT = "34384da0-0fa5-48e6-9dc5-3e87dcde11a6"; // Gosche's Solar Citadel
const JO = "0de9e2fd-df8a-45a0-9928-c8bfb77a4a72"; // Jo Ciendeilio, Iron Born
const LMW = "68bc2d1d-f025-4a2c-ae8c-584dc335f6eb"; // Last Minute Weaponization
const LTA = "93dae733-8291-48be-88b2-b8a523340e89"; // Lead the Assault
const POP = "b1c318a6-3e5e-4e85-8ae4-6e6b812f0e30"; // P0p
const PARTY = "0c04cd9f-7c2c-4cf9-9c00-01dd4edb543c"; // Party Crashers

type Engine = ReturnType<typeof buildGame>["engine"];
type Cards = CardPlacement[];

const factionKey = (owner: string) => (owner === P1 ? "__factionA" : "__factionB");
/** `n` already-spent (attached to the faction) resources of `icon`. */
const spent = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", n: number, owner: string = P1): Cards =>
  bank(icon, n, owner as never).map((p) => ({ ...p, attachedToKey: factionKey(owner) }));
const ready = (e: Engine, p: string = P1) => e.getAvailableResourceCount(p as never);
const handOf = (e: Engine, p: string = P1) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: Engine, p: string = P1) => [...e.state.players[p as never].deck] as string[];
const pick = (e: Engine, ids: string[], mayIndex = 1) =>
  drain(e, (pc) =>
    pc.kind === "chooserSelectsTarget"
      ? { kind: "chooserSelectsTarget", selected: ids }
      : pc.kind === "chooserSelectsOption"
        ? { kind: "chooserSelectsOption", index: mayIndex }
        : declineAll(pc)
  );
const revealedIds = (e: Engine) =>
  e.getLog().filter((entry) => entry.event?.type === "cardsRevealed").flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
/** A staple/non-staple resource card with an explicit icon and trade. */
const res = (key: string, icon: string, trade: string, owner: string = P1, staple = true): CardPlacement => ({
  key,
  def: resourceCard({ id: `p2-res-${key}`, name: `Res ${key}`, trade, resource: { provides: [icon], staple } } as never),
  owner: owner as never,
  zone: "play"
});
const killTactic = (name = "Kill") =>
  tactic({
    name,
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
  } as never);
/** Returns the picked card to its owner's hand (it leaves play without being destroyed). */
const bounceTactic = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  } as never);
/** Discards the picked card from hand. */
const discardTactic = () =>
  tactic({
    name: "Discarder",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  } as never);
/** While set, spawned tokens ALSO carry the subtype "micromajig" that TEAMWORK's cost selector asks for (see ungodly-mess-05-p2-7). */
let STAND = false;
const withStandIn = (fn: () => void) => () => {
  STAND = true;
  try {
    fn();
  } finally {
    STAND = false;
  }
};
/** Puts one Micromajig token (the printed 1/1/3 majig token) into play under the caster's control. */
const spawnTactic = (who: "controller" | "opponent" = "controller") =>
  tactic({
    name: "Spawn",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          effects: [
            {
              type: "createTokens",
              count: 1,
              controller: who,
              token: { name: "Micromajig", cardType: "character", subtype: STAND ? ["majig", "micromajig"] : ["majig"], strength: 1, life: 1, speed: 3 }
            }
          ]
        }
      ]
    }
  } as never);
const micros = (e: Engine, p: string = P1) =>
  Object.values(e.state.cards).filter((c) => c.zone === "play" && c.controllerId === p && e.getDefinition(c.id).name === "Micromajig");

// ============================================================================
// Gosche's Solar Citadel — location, gearsmith, cost 2, threshold e, structure 2
// ============================================================================
const citBoard = (extra: Cards = [], opts: { turn?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    cards: [{ key: "cit", def: printing(CIT), owner: P1, zone: "play" }, ...extra]
  });
const citHand = (extra: Cards) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "cit", def: printing(CIT), owner: P1, zone: "hand" }, ...extra]
  });

clause(CIT, "0:rule", "printed card: gearsmith location, cost 2, threshold e, structure 2", () => {
  const d = printing(CIT);
  assert.equal(d.type, "location");
  assert.equal(d.trade, "gearsmith");
  assert.equal(d.cost, 2);
  assert.equal(d.threshold, "e");
  const b = citBoard();
  assert.equal(b.engine.getStat(b.id("cit"), "structure"), 2);
});

clause(CIT, "0:rule", "deploys for exactly 2 (one elitism + one other), both spent; refused with 1 resource or with no elitism icon", () => {
  const b = citHand([...bank("elitism", 1), ...bank("rage", 1)]);
  play(b.engine, P1, b.id("cit"));
  assert.equal(zoneOf(b.engine, b.id("cit")), "play");
  assert.equal(ready(b.engine), 0, "both resources spent");
  const short = citHand([...bank("elitism", 1)]);
  refused(() => play(short.engine, P1, short.id("cit")), "cost 2 with one resource");
  assert.equal(zoneOf(short.engine, short.id("cit")), "hand");
  const noIcon = citHand([...bank("rage", 3)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("cit")), "threshold e with no elitism");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("cit")), "hand");
});

clause(CIT, "0:rule", "the elitism for the threshold may be a spent resource, but the cost needs 2 READY ones", () => {
  const ok = citHand([...spent("elitism", 1), ...bank("rage", 2)]);
  play(ok.engine, P1, ok.id("cit"));
  assert.equal(zoneOf(ok.engine, ok.id("cit")), "play", "spent elitism satisfies the threshold, two ready rage pay");
  const short = citHand([...spent("elitism", 1), ...bank("rage", 1)]);
  refused(() => play(short.engine, P1, short.id("cit")), "only 1 ready resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("cit")), "hand");
});

/** The Citadel's "you may put a micromajig token into play" is a yes/no prompt (mayIndex 1 = yes). */
const citPick = (e: Engine, ids: string[], mayIndex = 1) =>
  drain(e, (pc) =>
    pc.kind === "chooserSelectsTarget"
      ? { kind: "chooserSelectsTarget", selected: ids }
      : pc.kind === "mayPay"
        ? { kind: "mayPay", pay: mayIndex === 1 }
        : declineAll(pc)
  );

const harvestBoard = (extra: Cards = [], citInPlay = true) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(citInPlay ? [{ key: "cit", def: printing(CIT), owner: P1, zone: "play" } as CardPlacement] : [{ key: "cit", def: printing(CIT), owner: P1, zone: "discard" } as CardPlacement]),
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "plain", def: character({ name: "Plain", life: 3 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...extra
    ]
  });
const killIt = (b: ReturnType<typeof harvestBoard>, target: string, mayIndex = 1) => {
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(target)] } });
  citPick(b.engine, [], mayIndex);
};

clause(CIT, "0:rule", "a non-token character I control with a token on it dies: I may accept and get exactly one Micromajig token under my control", () => {
  const b = harvestBoard();
  killIt(b, "mine", 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  const m = micros(b.engine);
  assert.equal(m.length, 1, "exactly one token");
  assert.equal(micros(b.engine, P2).length, 0, "none for the opponent");
  assert.equal(b.engine.getStat(m[0].id, "strength"), 1);
  assert.equal(b.engine.getStat(m[0].id, "life"), 1);
  assert.equal(b.engine.getStat(m[0].id, "speed"), 3);
});

clause(CIT, "0:rule", "the Micromajig token is a Gearsmith character (RULES §13)", () => {
  const b = harvestBoard();
  killIt(b, "mine", 1);
  const m = micros(b.engine);
  assert.equal(m.length, 1);
  assert.equal(b.engine.getDefinition(m[0].id).trade, "gearsmith");
  assert.ok((b.engine.getDefinition(m[0].id).subtype ?? []).includes("majig"), "(b.engine.getDefinition(m[0].id).subtype ?? []).includes(\"majig\")");
});

clause(CIT, "0:rule", "'you may': I am asked, and declining puts no token into play", () => {
  const b = harvestBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc, "the controller is asked whether to put the token into play");
  assert.equal(pc.playerId, P1);
  drain(b.engine, (q) => (q.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(q)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(micros(b.engine).length, 0, "declined: no token");
});

clause(CIT, "0:rule", "the token it puts into play is a character (can be picked as one)", () => {
  const b = harvestBoard([{ key: "kill2", def: killTactic("Kill2"), owner: P1, zone: "hand" } as CardPlacement]);
  killIt(b, "mine", 1);
  const m = micros(b.engine);
  assert.equal(m.length, 1);
  assert.equal(b.engine.getDefinition(m[0].id).type, "character");
  play(b.engine, P1, b.id("kill2"), { selected: { t: [m[0].id] } });
  assert.equal(micros(b.engine).length, 0, "a character-selecting tactic can destroy it");
});

clause(CIT, "0:rule", "leaving play by any route counts: a bounced token-carrying character also gives the token", () => {
  const b = harvestBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine")] } });
  citPick(b.engine, [], 1);
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
  assert.equal(micros(b.engine).length, 1);
});

clause(CIT, "0:rule", "a character with NO token on it leaving play gives nothing", () => {
  const b = harvestBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("plain")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("plain")), "discard");
  assert.equal(micros(b.engine).length, 0);
});

clause(CIT, "0:rule", "an opponent's character with a token leaving play gives nothing", () => {
  const b = harvestBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("theirs")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  assert.equal(micros(b.engine).length, 0);
  assert.equal(micros(b.engine, P2).length, 0);
});

clause(CIT, "0:rule", "'you control', not 'you own': my character owned by the opponent counts; an opponent-controlled one of mine does not", () => {
  const b = harvestBoard([
    { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play", counters: { token: 1 } } as CardPlacement,
    { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play", counters: { token: 1 } } as CardPlacement
  ]);
  killIt(b, "stolen", 1);
  assert.equal(micros(b.engine).length, 1, "controlled by me: token");
  const c = harvestBoard([{ key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play", counters: { token: 1 } } as CardPlacement]);
  play(c.engine, P1, c.id("kill"), { selected: { t: [c.id("lent")] } });
  assert.equal(c.engine.state.pendingChoice, undefined);
  assert.equal(micros(c.engine).length, 0, "controlled by the opponent: nothing");
});

clause(CIT, "0:rule", "a TOKEN character with a token on it leaving play gives nothing (non-token only)", () => {
  const b = harvestBoard([{ key: "spawn", def: spawnTactic(), owner: P1, zone: "hand" } as CardPlacement]);
  play(b.engine, P1, b.id("spawn"));
  const m = micros(b.engine);
  assert.equal(m.length, 1);
  b.engine.state.cards[m[0].id].counters = { ...(b.engine.state.cards[m[0].id].counters ?? {}), token: 1 };
  play(b.engine, P1, b.id("kill"), { selected: { t: [m[0].id] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 0, "the dead token is gone and no replacement token appeared");
});

clause(CIT, "0:rule", "the Citadel must be in play: with it in the discard pile nothing triggers", () => {
  const b = harvestBoard([], false);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 0);
});

clause(CIT, "0:rule", "a token-carrying card leaving the HAND (not play) does not trigger", () => {
  const b = harvestBoard([
    { key: "disc", def: discardTactic(), owner: P1, zone: "hand" } as CardPlacement,
    { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand", counters: { token: 1 } } as CardPlacement
  ]);
  play(b.engine, P1, b.id("disc"), { selected: { t: [b.id("hc")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hc")), "discard");
  assert.equal(micros(b.engine).length, 0);
});

clause(CIT, "0:rule", "two Citadels trigger independently: a death gives a token for each one accepted", () => {
  const b = harvestBoard([{ key: "cit2", def: printing(CIT), owner: P1, zone: "play" } as CardPlacement]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  drain(b.engine, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    if (pc.kind === "orderTriggers") return declineAll(pc);
    return declineAll(pc);
  });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 2);
});

// --- PROCESS ---
const seedBoard = (opts: { rage?: number; depleted?: boolean; extra?: Cards } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cit", def: printing(CIT), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play", depleted: true },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "myitem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
const seed = (b: ReturnType<typeof seedBoard>, target: string) => activate(b.engine, P1, b.id("cit"), "seed", { selected: { c: [b.id(target)] } });

clause(CIT, "1:ability:seed", "PROCESS depletes the Citadel, pays exactly 2 and puts exactly one token on the picked character", () => {
  const b = seedBoard({ rage: 3 });
  seed(b, "mine");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("cit")].depleted, true, "COST: deplete this card");
  assert.equal(ready(b.engine), 1, "COST: pay 2 (3 -> 1)");
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
  assert.equal(tokensOn(b.engine, b.id("mine2")), 0, "no other character gets one");
  assert.equal(tokensOn(b.engine, b.id("theirs")), 0);
});

clause(CIT, "1:ability:seed", "needs the Citadel ready: refused while depleted (and works with the same board when ready)", () => {
  const b = seedBoard({ depleted: true });
  refused(() => seed(b, "mine"), "depleted");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
  assert.equal(ready(b.engine), 2, "nothing was paid");
  const ok = seedBoard();
  seed(ok, "mine");
  assert.equal(tokensOn(ok.engine, ok.id("mine")), 1);
});

clause(CIT, "1:ability:seed", "pay 2: refused with only 1 ready resource, nothing deplete or paid", () => {
  const b = seedBoard({ rage: 1 });
  refused(() => seed(b, "mine"), "pay 2 with 1");
  assert.equal(b.engine.state.cards[b.id("cit")].depleted, false);
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
  const ok = seedBoard({ rage: 2 });
  seed(ok, "mine");
  assert.equal(ready(ok.engine), 0, "exactly 2 paid");
});

clause(CIT, "1:ability:seed", "the pick must be a character I control: opponent's character and my item are refused", () => {
  const b = seedBoard();
  refused(() => seed(b, "theirs"), "opponent's character");
  refused(() => seed(b, "myitem"), "an item");
  assert.equal(tokensOn(b.engine, b.id("theirs")), 0);
  assert.equal(tokensOn(b.engine, b.id("myitem")), 0);
  assert.equal(b.engine.state.cards[b.id("cit")].depleted, false);
  assert.equal(ready(b.engine), 2);
  const ok = seedBoard();
  seed(ok, "mine2");
  assert.equal(tokensOn(ok.engine, ok.id("mine2")), 1, "a depleted character of mine is fine");
});

clause(CIT, "1:ability:seed", "tokens accumulate: a second use (next turn) puts a second token on the same character", () => {
  const b = seedBoard({ rage: 4 });
  seed(b, "mine");
  b.engine.state.cards[b.id("cit")].depleted = false;
  seed(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
  assert.equal(ready(b.engine), 0);
});

clause(CIT, "1:ability:seed", "PROCESS then HARVEST: the token it placed makes that character's death pay out a Micromajig", () => {
  const b = seedBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" } as CardPlacement] });
  seed(b, "mine");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  citPick(b.engine, [], 1);
  assert.equal(micros(b.engine).length, 1);
});

// ============================================================================
// Jo Ciendeilio, Iron Born — UNIQUE JO / FEALTY / ETB-LTB gearsmith item tutor
// ============================================================================
const joHand = (extra: Cards = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "jo", def: printing(JO), owner: P1, zone: "hand" }, ...extra]
  });
const joPlay = (extra: Cards = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "jo", def: printing(JO), owner: P1, zone: "play" }, ...extra]
  });

clause(JO, "0:unique", "printed card: gearsmith character, subtypes jo + blade of questionable morality, cost 3, threshold eeee, 1 str / 3 spd / 1 life", () => {
  const d = printing(JO);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "gearsmith");
  assert.equal(d.cost, 3);
  assert.equal(d.threshold, "eeee");
  assert.deepEqual([...(d.subtype ?? [])], ["jo", "blade of questionable morality"]);
  assert.equal((d as unknown as { unique?: string }).unique, "jo");
  const b = joPlay();
  assert.equal(b.engine.getStat(b.id("jo"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("jo"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("jo"), "life"), 1);
});

clause(JO, "0:unique", "costs exactly 3: 4 elitism deploy it and 3 are spent; 2 spent + 2 ready elitism is refused (cost short)", () => {
  const b = joHand([...bank("elitism", 4)]);
  play(b.engine, P1, b.id("jo"));
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(ready(b.engine), 1, "cost 3 of 4 paid");
  const iso = joHand([...spent("elitism", 1), ...bank("elitism", 3)]);
  play(iso.engine, P1, iso.id("jo"));
  assert.equal(zoneOf(iso.engine, iso.id("jo")), "play", "spent elitism counts for the threshold, 3 ready pay the cost");
  assert.equal(ready(iso.engine), 0);
  const short = joHand([...spent("elitism", 2), ...bank("elitism", 2)]);
  refused(() => play(short.engine, P1, short.id("jo")), "only 2 ready for cost 3");
  assert.equal(zoneOf(short.engine, short.id("jo")), "hand");
});

clause(JO, "0:unique", "threshold eeee: three elitism + a rage (4 resources) is refused", () => {
  const b = joHand([...bank("elitism", 3), ...bank("rage", 1)]);
  refused(() => play(b.engine, P1, b.id("jo")), "one icon short of eeee");
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
  const c = joHand([...bank("elitism", 3), ...bank("rage", 3)]);
  refused(() => play(c.engine, P1, c.id("jo")), "plenty of resources but only 3 elitism");
  assert.equal(zoneOf(c.engine, c.id("jo")), "hand");
  const ok = joHand([...bank("elitism", 4), ...bank("rage", 1)]);
  play(ok.engine, P1, ok.id("jo"));
  assert.equal(zoneOf(ok.engine, ok.id("jo")), "play");
});

clause(JO, "0:unique", "I cannot control two JOs: a second copy forces a survivor choice, the loser is destroyed", () => {
  const b = joHand([
    { key: "jo2", def: printing(JO), owner: P1, zone: "play" } as CardPlacement,
    ...bank("elitism", 4)
  ]);
  play(b.engine, P1, b.id("jo"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("jo"), b.id("jo2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("jo") } } as never);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(zoneOf(b.engine, b.id("jo2")), "discard");
});

clause(JO, "0:unique", "UNIQUE is per player (the opponent's own Jo is fine) and a different designation is not a duplicate", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jo", def: printing(JO), owner: P1, zone: "play" },
      { key: "theirs", def: printing(JO), owner: P2, zone: "play" },
      { key: "other", def: character({ name: "Other", unique: "someone else" } as never), owner: P1, zone: "play" }
    ]
  });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["jo", "theirs", "other"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});

// --- FEALTY ---
const distinct4 = (): Cards => [
  res("fo", "elitism", "warlord"),
  res("fr", "rage", "rogue"),
  res("fg", "greed", "banker"),
  res("fd", "deception", "arcanist")
];

clause(JO, "1:fealty", "with 4 staple resources of 4 different trades, one elitism icon is enough for eeee (cost 3 still paid)", () => {
  const b = joHand(distinct4());
  play(b.engine, P1, b.id("jo"));
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(ready(b.engine), 1, "exactly the printed cost 3 is paid");
});

clause(JO, "1:fealty", "the reduction is only 3 icons: 4 different trades but no elitism icon at all is still refused", () => {
  const b = joHand([res("fr", "rage", "rogue"), res("fg", "greed", "banker"), res("fd", "deception", "arcanist"), res("fo", "obsession", "warlord")]);
  refused(() => play(b.engine, P1, b.id("jo")), "0 elitism icons");
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
});

clause(JO, "1:fealty", "only 3 different trades among my staples gives no reduction", () => {
  const b = joHand([res("fo", "elitism", "warlord"), res("fr", "rage", "rogue"), res("fg", "greed", "rogue"), res("fd", "deception", "banker")]);
  refused(() => play(b.engine, P1, b.id("jo")), "3 trades");
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
});

clause(JO, "1:fealty", "the resources must be staples: a non-staple resource does not count as a 4th trade", () => {
  const b = joHand([res("fo", "elitism", "warlord"), res("fr", "rage", "rogue"), res("fg", "greed", "banker"), res("fd", "deception", "arcanist", P1, false)]);
  refused(() => play(b.engine, P1, b.id("jo")), "non-staple 4th trade");
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
});

clause(JO, "1:fealty", "only resources I control count: an opponent's staple of the 4th trade gives no reduction", () => {
  const b = joHand([res("fo", "elitism", "warlord"), res("fr", "rage", "rogue"), res("fg", "greed", "rogue"), res("fd", "deception", "banker"), res("theirs", "deception", "arcanist", P2)]);
  refused(() => play(b.engine, P1, b.id("jo")), "opponent's resource");
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
});

clause(JO, "1:fealty", "the reduction is 'any 3 icons': any three of the four required icons are waived, not only specific ones", () => {
  const b = joHand([res("fo", "elitism", "warlord"), res("fr", "elitism", "rogue"), res("fg", "greed", "banker"), res("fd", "deception", "arcanist")]);
  play(b.engine, P1, b.id("jo"));
  assert.equal(zoneOf(b.engine, b.id("jo")), "play", "two elitism among four trades is fine too");
});

// --- ETB / LTB tutor ---
const tutorCards = (): Cards => [
  { key: "tool", def: item({ name: "Tool", trade: "gearsmith" } as never), owner: P1, zone: "deck" },
  { key: "tool2", def: item({ name: "Tool2", trade: "gearsmith" } as never), owner: P1, zone: "deck" },
  { key: "rogueItem", def: item({ name: "RogueItem", trade: "rogue" } as never), owner: P1, zone: "deck" },
  { key: "gearChar", def: character({ name: "GearChar", trade: "gearsmith" } as never), owner: P1, zone: "deck" },
  { key: "theirTool", def: item({ name: "TheirTool", trade: "gearsmith" } as never), owner: P2, zone: "deck" },
  { key: "discTool", def: item({ name: "DiscTool", trade: "gearsmith" } as never), owner: P1, zone: "discard" },
  { key: "handTool", def: item({ name: "HandTool", trade: "gearsmith" } as never), owner: P1, zone: "hand" }
];
/** Answers the tutor: the chooser picks `ids` (empty = decline). */
const tutor = (e: Engine, ids: string[]) => drain(e, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc)));
const jo = (extra: Cards = []) => joHand([...tutorCards(), ...extra, ...bank("elitism", 4)]);

clause(JO, "2:rule", "enters play: I search for a gearsmith item, reveal it, and it goes to my hand (the other deck cards stay)", () => {
  const b = jo();
  const before = deckOf(b.engine).length;
  play(b.engine, P1, b.id("jo"));
  tutor(b.engine, [b.id("tool")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tool")), "hand");
  assert.ok(handOf(b.engine).includes(b.id("tool")), "handOf(b.engine).includes(b.id(\"tool\"))");
  assert.equal(deckOf(b.engine).length, before - 1);
  assert.ok(deckOf(b.engine).includes(b.id("tool2")), "the other gearsmith item is still in the deck");
  assert.deepEqual(revealedIds(b.engine), [b.id("tool")], "the found item is revealed");
});

clause(JO, "2:rule", "'you may': declining the search leaves every item in the deck and reveals nothing", () => {
  const b = jo();
  play(b.engine, P1, b.id("jo"));
  tutor(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tool")), "deck");
  assert.equal(zoneOf(b.engine, b.id("tool2")), "deck");
  assert.deepEqual(revealedIds(b.engine), []);
});

clause(JO, "2:rule", "only a GEARSMITH ITEM in MY DECK can be found: a rogue item, a gearsmith character, the opponent's item and cards in discard or hand are refused", () => {
  for (const bad of ["rogueItem", "gearChar", "theirTool", "discTool", "handTool"]) {
    const b = jo();
    play(b.engine, P1, b.id("jo"));
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${bad}: a search prompt`);
    refused(() => tutor(b.engine, [b.id(bad)]), `${bad} cannot be chosen`);
    assert.equal(zoneOf(b.engine, b.id(bad)) === "hand" && bad !== "handTool", false, `${bad} was not moved to hand`);
  }
  const ok = jo();
  play(ok.engine, P1, ok.id("jo"));
  tutor(ok.engine, [ok.id("tool")]);
  assert.equal(zoneOf(ok.engine, ok.id("tool")), "hand", "control: a gearsmith item in my deck");
});

clause(JO, "2:rule", "leaves play: the same search happens when Jo is destroyed", () => {
  const b = joPlay([...tutorCards(), { key: "kill", def: killTactic(), owner: P1, zone: "hand" } as CardPlacement]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("jo")] } });
  tutor(b.engine, [b.id("tool2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("jo")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tool2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("tool")), "deck");
  assert.deepEqual(revealedIds(b.engine), [b.id("tool2")]);
});

clause(JO, "2:rule", "leaves play by returning to hand also searches; declining finds nothing", () => {
  const b = joPlay([...tutorCards(), { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" } as CardPlacement]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("jo")] } });
  const pc = pending(b.engine) as unknown as { kind: string };
  assert.equal(pc.kind, "chooserSelectsTarget", "a search prompt appears when Jo bounces");
  tutor(b.engine, []);
  assert.equal(zoneOf(b.engine, b.id("jo")), "hand");
  assert.equal(zoneOf(b.engine, b.id("tool")), "deck");
});

clause(JO, "2:rule", "no gearsmith item in the deck: nothing is found and the game is not stuck", () => {
  const b = joHand([{ key: "rogueItem", def: item({ name: "RogueItem", trade: "rogue" } as never), owner: P1, zone: "deck" } as CardPlacement, ...bank("elitism", 4)]);
  play(b.engine, P1, b.id("jo"));
  tutor(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(zoneOf(b.engine, b.id("rogueItem")), "deck");
});

clause(JO, "2:rule", "other cards entering or leaving play do not trigger Jo's search", () => {
  const b = joPlay([
    ...tutorCards(),
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" } as CardPlacement,
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" } as CardPlacement,
    { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" } as CardPlacement
  ]);
  play(b.engine, P1, b.id("newbie"));
  assert.equal(b.engine.state.pendingChoice, undefined, "another character entering");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ally")] } });
  assert.equal(b.engine.state.pendingChoice, undefined, "another character leaving");
  assert.equal(zoneOf(b.engine, b.id("tool")), "deck");
});

// ============================================================================
// Last Minute Weaponization — tactic, gearsmith, cost 1, threshold eeee
// ============================================================================
const lmwCards = (): Cards => [
  { key: "it0", def: item({ name: "It0", cost: 0 }), owner: P1, zone: "play" },
  { key: "it1", def: item({ name: "It1", cost: 1 }), owner: P1, zone: "play" },
  { key: "it3", def: item({ name: "It3", cost: 3 }), owner: P1, zone: "play" },
  { key: "theirIt", def: item({ name: "TheirIt", cost: 2 }), owner: P2, zone: "play" },
  { key: "handIt", def: item({ name: "HandIt", cost: 2 }), owner: P1, zone: "hand" },
  { key: "foe", def: character({ name: "Foe", life: 10 }), owner: P2, zone: "play" },
  { key: "mine", def: character({ name: "Mine", life: 10 }), owner: P1, zone: "play" },
  { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
  { key: "handChar", def: character({ name: "HandChar", life: 10 }), owner: P2, zone: "hand" },
  { key: "d0", def: item({ name: "D0", cost: 0 }), owner: P1, zone: "deck" },
  { key: "d1", def: item({ name: "D1", cost: 1 }), owner: P1, zone: "deck" },
  { key: "d2", def: item({ name: "D2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "d3", def: item({ name: "D3", cost: 3 }), owner: P1, zone: "deck" },
  { key: "d5", def: item({ name: "D5", cost: 5 }), owner: P1, zone: "deck" },
  { key: "dchar", def: character({ name: "DChar", cost: 0 }), owner: P1, zone: "deck" },
  { key: "theirDeck", def: item({ name: "TheirDeck", cost: 0 }), owner: P2, zone: "deck" },
  { key: "discIt", def: item({ name: "DiscIt", cost: 0 }), owner: P1, zone: "discard" }
];
const lmwBoard = (res: Cards = bank("elitism", 5), zone: "hand" | "play" = "hand", extra: Cards = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "lmw", def: printing(LMW), owner: P1, zone, faceDown: zone === "play" ? true : undefined }, ...lmwCards(), ...res, ...extra]
  });
type LmwBoard = ReturnType<typeof lmwBoard>;
const lmwSel = (b: LmwBoard, it: string, c: string) => ({ it: [b.id(it)], c: [b.id(c)] });
const lmwCast = (b: LmwBoard, it: string, c: string) => play(b.engine, P1, b.id("lmw"), { selected: lmwSel(b, it, c) });
const lmwFlip = (b: LmwBoard, it: string, c: string) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("lmw"), selected: lmwSel(b, it, c), variables: {} });
  resolvePendingResponses(b.engine);
};
const dmg = (b: LmwBoard, k: string) => b.engine.state.cards[b.id(k)].damage;
const x2 = (): CardPlacement => ({ key: "x2", def: item({ name: "X2", cost: 2 }), owner: P1, zone: "play" });

clause(LMW, "0:extraCost", "printed card: gearsmith tactic, cost 1, threshold eeee", () => {
  const d = printing(LMW);
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "gearsmith");
  assert.equal(d.cost, 1);
  assert.equal(d.threshold, "eeee");
});

clause(LMW, "0:extraCost", "costs exactly 1: 3 spent + 1 ready elitism casts it; 4 spent elitism and no ready resource is refused", () => {
  const ok = lmwBoard([...spent("elitism", 3), ...bank("elitism", 1)]);
  lmwCast(ok, "it0", "foe");
  tutor(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("lmw")), "discard");
  assert.equal(ready(ok.engine), 0, "the single ready resource paid the cost 1");
  const none = lmwBoard([...spent("elitism", 4)]);
  refused(() => lmwCast(none, "it0", "foe"), "no ready resource for cost 1");
  assert.equal(zoneOf(none.engine, none.id("lmw")), "hand");
  assert.equal(zoneOf(none.engine, none.id("it0")), "play", "the item was not destroyed");
});

clause(LMW, "0:extraCost", "threshold eeee: three elitism + a rage is refused, nothing destroyed or paid", () => {
  const b = lmwBoard([...bank("elitism", 3), ...bank("rage", 1)]);
  refused(() => lmwCast(b, "it0", "foe"), "one elitism short", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("lmw")), "hand");
  assert.equal(zoneOf(b.engine, b.id("it0")), "play");
  assert.equal(ready(b.engine), 4);
  const ok = lmwBoard([...bank("elitism", 4)]);
  lmwCast(ok, "it0", "foe");
  tutor(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("lmw")), "discard");
});

clause(LMW, "0:extraCost", "the extra cost destroys the picked item I control (to my discard pile) as the tactic is cast; the damage waits for it to resolve", () => {
  const b = lmwBoard();
  playRaw(b.engine, P1, b.id("lmw"), { selected: lmwSel(b, "it3", "foe") });
  assert.equal(zoneOf(b.engine, b.id("it3")), "discard", "item already destroyed as a cost");
  assert.equal(dmg(b, "foe"), 0, "damage not yet inflicted");
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "foe"), 4, "X=3: 3+1 damage");
});

clause(LMW, "0:extraCost", "the item must be an ITEM I CONTROL in play: the opponent's item, a character and an item in hand are refused", () => {
  const b = lmwBoard();
  refused(() => lmwCast(b, "theirIt", "foe"), "the opponent's item");
  refused(() => lmwCast(b, "mine", "foe"), "a character as the item");
  refused(() => lmwCast(b, "handIt", "foe"), "an item in hand");
  assert.equal(zoneOf(b.engine, b.id("theirIt")), "play");
  assert.equal(zoneOf(b.engine, b.id("lmw")), "hand");
  assert.equal(dmg(b, "foe"), 0);
  lmwCast(b, "it1", "foe");
  assert.equal(zoneOf(b.engine, b.id("it1")), "discard", "control");
});

clause(LMW, "0:extraCost", "the picked card must be a character in play: an item, a character in hand and a faction are refused; my own character and the opponent's are fine", () => {
  const b = lmwBoard();
  refused(() => lmwCast(b, "it0", "theirIt"), "an item");
  refused(() => lmwCast(b, "it0", "handChar"), "a character in hand");
  refused(
    () => play(b.engine, P1, b.id("lmw"), { selected: { it: [b.id("it0")], c: [b.engine.state.players[P2].factionId!] } }),
    "a faction"
  );
  assert.equal(zoneOf(b.engine, b.id("it0")), "play", "nothing was destroyed by the refused casts");
  const mine = lmwBoard();
  lmwCast(mine, "it0", "mine");
  assert.equal(dmg(mine, "mine"), 1, "my own character may be picked");
  const foe = lmwBoard();
  lmwCast(foe, "it0", "foe");
  assert.equal(dmg(foe, "foe"), 1);
});

clause(LMW, "0:extraCost", "with no item I control in play it cannot be cast (the opponent's item is no substitute)", () => {
  const c = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "lmw", def: printing(LMW), owner: P1, zone: "hand" },
      { key: "theirIt", def: item({ name: "TheirIt", cost: 2 }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 10 }), owner: P2, zone: "play" },
      ...bank("elitism", 5)
    ]
  });
  refused(() => play(c.engine, P1, c.id("lmw"), { selected: { it: [c.id("theirIt")], c: [c.id("foe")] } }), "no item of mine");
  assert.equal(zoneOf(c.engine, c.id("lmw")), "hand");
  assert.equal(zoneOf(c.engine, c.id("theirIt")), "play");
});

clause(LMW, "1:rule", "inflicts X+1 damage to the character: X=3 gives 4, X=1 gives 2, X=0 gives 1", () => {
  for (const [it, n] of [["it3", 4], ["it1", 2], ["it0", 1]] as const) {
    const b = lmwBoard();
    lmwCast(b, it, "foe");
    tutor(b.engine, []);
    assert.equal(dmg(b, "foe"), n, `${it}`);
    assert.equal(dmg(b, "mine"), 0);
    assert.equal(zoneOf(b.engine, b.id("lmw")), "discard");
  }
});

clause(LMW, "1:rule", "the damage can kill: X=1 (2 damage) destroys a 2-life character; X=0 (1 damage) does not", () => {
  const b = lmwBoard();
  lmwCast(b, "it1", "weak");
  tutor(b.engine, []);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  const c = lmwBoard();
  lmwCast(c, "it0", "weak");
  tutor(c.engine, []);
  assert.equal(zoneOf(c.engine, c.id("weak")), "play");
  assert.equal(dmg(c, "weak"), 1);
});

clause(LMW, "1:rule", "'you may search': the item found has cost X or less (X=2: costs 0, 1, 2 allowed; 3, 5, a character, the opponent's and a discarded one refused), goes to my hand revealed", () => {
  for (const ok of ["d0", "d1", "d2"]) {
    const b = lmwBoard(bank("elitism", 5), "hand", [x2()]);
    lmwCast(b, "x2", "foe");
    tutor(b.engine, [b.id(ok)]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(ok)), "hand", ok);
    assert.deepEqual(revealedIds(b.engine), [b.id(ok)], `${ok} revealed`);
    assert.equal(dmg(b, "foe"), 3, "X+1 = 3 damage as well");
  }
  for (const bad of ["d3", "d5", "dchar", "theirDeck", "discIt"]) {
    const b = lmwBoard(bank("elitism", 5), "hand", [x2()]);
    lmwCast(b, "x2", "foe");
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${bad}: asked`);
    refused(() => tutor(b.engine, [b.id(bad)]), `${bad} is not a legal search result`);
  }
});

clause(LMW, "1:rule", "X is the destroyed item's cost: X=0 can only find cost-0 items; X=3 can find cost 3 but not 5", () => {
  const zero = lmwBoard();
  lmwCast(zero, "it0", "foe");
  refused(() => tutor(zero.engine, [zero.id("d1")]), "cost 1 > X=0");
  const z = lmwBoard();
  lmwCast(z, "it0", "foe");
  tutor(z.engine, [z.id("d0")]);
  assert.equal(zoneOf(z.engine, z.id("d0")), "hand");
  const three = lmwBoard();
  lmwCast(three, "it3", "foe");
  refused(() => tutor(three.engine, [three.id("d5")]), "cost 5 > X=3");
  const t = lmwBoard();
  lmwCast(t, "it3", "foe");
  tutor(t.engine, [t.id("d3")]);
  assert.equal(zoneOf(t.engine, t.id("d3")), "hand");
});

clause(LMW, "1:rule", "'you may': declining the search leaves the deck as it was; the damage still happened", () => {
  const b = lmwBoard();
  const before = deckOf(b.engine).length;
  lmwCast(b, "it3", "foe");
  tutor(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(b.engine).length, before);
  assert.deepEqual(revealedIds(b.engine), []);
  assert.equal(dmg(b, "foe"), 4);
});

clause(LMW, "1:rule", "both halves happen: damage, then the optional search; the destroyed item and the tactic end in the discard pile", () => {
  const b = lmwBoard();
  lmwCast(b, "it3", "foe");
  tutor(b.engine, [b.id("d3")]);
  assert.equal(dmg(b, "foe"), 4);
  assert.equal(zoneOf(b.engine, b.id("d3")), "hand");
  assert.equal(zoneOf(b.engine, b.id("it3")), "discard");
  assert.equal(zoneOf(b.engine, b.id("lmw")), "discard");
});

// --- FLIP UP: 2 [E][E][E][E] ---
clause(LMW, "2:flipUp", "FLIP UP for 2 with eeee flips it, pays the extra cost and resolves the same effect", () => {
  const b = lmwBoard([...spent("elitism", 2), ...bank("elitism", 2)], "play");
  lmwFlip(b, "it3", "foe");
  tutor(b.engine, [b.id("d3")]);
  assert.equal(zoneOf(b.engine, b.id("it3")), "discard", "extra cost still paid");
  assert.equal(dmg(b, "foe"), 4);
  assert.equal(zoneOf(b.engine, b.id("d3")), "hand");
  assert.equal(zoneOf(b.engine, b.id("lmw")), "discard");
  assert.equal(ready(b.engine), 0, "exactly the FLIP UP cost 2 was paid");
});

clause(LMW, "2:flipUp", "FLIP UP cost is 2: with every other resource spent, the face-down card alone (1 ready) is refused", () => {
  const b = lmwBoard([...spent("elitism", 4)], "play");
  refused(() => lmwFlip(b, "it0", "foe"), "only 1 ready for cost 2");
  assert.equal(b.engine.state.cards[b.id("lmw")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("it0")), "play");
});

clause(LMW, "2:flipUp", "FLIP UP threshold eeee: three elitism + rage is refused (one icon short)", () => {
  const b = lmwBoard([...bank("elitism", 3), ...bank("rage", 1)], "play");
  refused(() => lmwFlip(b, "it0", "foe"), "threshold");
  assert.equal(b.engine.state.cards[b.id("lmw")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("it0")), "play");
  assert.equal(ready(b.engine), 5, "nothing paid (4 resources + the face-down card itself)");
});

clause(LMW, "2:flipUp", "FLIP UP may be paid with the card itself (cost before flipping), but its own face-down value never helps the threshold", () => {
  const ok = lmwBoard([...spent("elitism", 3), ...bank("elitism", 1)], "play");
  lmwFlip(ok, "it0", "foe");
  tutor(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("lmw")), "discard", "1 ready elitism + itself paid cost 2; 4 elitism icons met the threshold");
  const short = lmwBoard([...bank("elitism", 3)], "play");
  refused(() => lmwFlip(short, "it0", "foe"), "3 elitism + itself: the card's own face-down value is not a 4th elitism icon");
  assert.equal(short.engine.state.cards[short.id("lmw")].faceDown, true);
});

clause(LMW, "2:flipUp", "FLIP UP still needs the extra cost: the opponent's item is not a legal pick", () => {
  const b = lmwBoard(bank("elitism", 5), "play");
  refused(() => lmwFlip(b, "theirIt", "foe"), "the opponent's item is not a legal extra-cost pick");
  assert.equal(b.engine.state.cards[b.id("lmw")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("theirIt")), "play");
});

// ============================================================================
// Lead the Assault — tactic, gearsmith, cost 2, threshold eee; FLIP UP 4 [E]
// ============================================================================
const ltaCards = (): Cards => [
  { key: "a", def: character({ name: "A", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
  { key: "b", def: character({ name: "B", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
  { key: "c", def: character({ name: "C", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
  { key: "idle", def: character({ name: "Idle", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
  { key: "blk", def: character({ name: "Blk", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" }
];
/** `attackers` attack the opponent's faction, no blockers are declared; the tactic can be played afterwards. */
const ltaBoard = (res: Cards, attackers: string[], zone: "hand" | "play" = "hand") => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "lta", def: printing(LTA), owner: P1, zone, faceDown: zone === "play" ? true : undefined }, ...ltaCards(), ...res]
  });
  if (attackers.length) {
    declareAttackBy(
      b.engine,
      P1,
      attackers.map((k) => b.id(k))
    );
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  }
  return b;
};
type LtaBoard = ReturnType<typeof ltaBoard>;
const ltaCast = (b: LtaBoard, target: string) => {
  play(b.engine, P1, b.id("lta"), { selected: { c: [b.id(target)] } });
};
const ltaFlip = (b: LtaBoard, target: string) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("lta"), selected: { c: [b.id(target)] }, variables: {} });
  resolvePendingResponses(b.engine);
};
const st = (b: LtaBoard, k: string, stat: "strength" | "life" | "speed") => b.engine.getStat(b.id(k), stat);

clause(LTA, "0:rule", "printed card: gearsmith tactic, cost 2, threshold eee", () => {
  const d = printing(LTA);
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "gearsmith");
  assert.equal(d.cost, 2);
  assert.equal(d.threshold, "eee");
});

clause(LTA, "0:rule", "costs exactly 2: 3 elitism cast it (1 left); 1 spent + 2 ready elitism cast it; 2 spent + 1 ready is refused", () => {
  const a = ltaBoard(bank("elitism", 3), ["a"]);
  ltaCast(a, "a");
  assert.equal(zoneOf(a.engine, a.id("lta")), "discard");
  assert.equal(ready(a.engine), 1, "only 2 paid");
  const iso = ltaBoard([...spent("elitism", 1), ...bank("elitism", 2)], ["a"]);
  ltaCast(iso, "a");
  assert.equal(zoneOf(iso.engine, iso.id("lta")), "discard");
  assert.equal(ready(iso.engine), 0);
  const short = ltaBoard([...spent("elitism", 2), ...bank("elitism", 1)], ["a"]);
  refused(() => ltaCast(short, "a"), "1 ready for cost 2");
  assert.equal(zoneOf(short.engine, short.id("lta")), "hand");
  assert.equal(st(short, "a", "strength"), 2);
});

clause(LTA, "0:rule", "threshold eee: two elitism + a rage (3 resources) is refused", () => {
  const b = ltaBoard([...bank("elitism", 2), ...bank("rage", 1)], ["a"]);
  refused(() => ltaCast(b, "a"), "one elitism short", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("lta")), "hand");
  assert.equal(ready(b.engine), 3);
  const many = ltaBoard([...bank("elitism", 2), ...bank("rage", 4)], ["a"]);
  refused(() => ltaCast(many, "a"), "plenty of resources but only two elitism");
});

clause(LTA, "0:rule", "a lone attacker gains exactly 2 strength and 2 life; nothing else changes", () => {
  const b = ltaBoard(bank("elitism", 4), ["a"]);
  ltaCast(b, "a");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(st(b, "a", "strength"), 4);
  assert.equal(st(b, "a", "life"), 6);
  assert.equal(st(b, "a", "speed"), 3, "speed untouched");
  for (const k of ["idle", "b", "c"]) {
    assert.equal(st(b, k, "strength"), 2, k);
    assert.equal(st(b, k, "life"), 4, k);
  }
  assert.equal(b.engine.getStat(b.id("blk"), "strength"), 1);
});

clause(LTA, "0:rule", "an attacking party of 2: the picked character gains 4 strength and 4 life, its partner nothing", () => {
  const b = ltaBoard(bank("elitism", 4), ["a", "b"]);
  ltaCast(b, "b");
  assert.equal(st(b, "b", "strength"), 6);
  assert.equal(st(b, "b", "life"), 8);
  assert.equal(st(b, "a", "strength"), 2);
  assert.equal(st(b, "a", "life"), 4);
});

clause(LTA, "0:rule", "a party of 3 also gets just the additional +2/+2 (total +4/+4), not more", () => {
  const b = ltaBoard(bank("elitism", 4), ["a", "b", "c"]);
  ltaCast(b, "a");
  assert.equal(st(b, "a", "strength"), 6);
  assert.equal(st(b, "a", "life"), 8);
  for (const k of ["b", "c"]) assert.equal(st(b, k, "strength"), 2, k);
});

clause(LTA, "0:rule", "the pick must be an ATTACKING character I control: an idle character of mine and the opponent's blocker are refused, and so is any pick outside a battle", () => {
  const b = ltaBoard(bank("elitism", 4), ["a"]);
  refused(() => ltaCast(b, "idle"), "a non-attacking character of mine");
  refused(() => ltaCast(b, "blk"), "the opponent's character");
  assert.equal(zoneOf(b.engine, b.id("lta")), "hand");
  assert.equal(ready(b.engine), 4, "nothing paid");
  ltaCast(b, "a");
  assert.equal(st(b, "a", "strength"), 4, "control");
  const none = ltaBoard(bank("elitism", 4), []);
  refused(() => ltaCast(none, "a"), "no battle");
  assert.equal(zoneOf(none.engine, none.id("lta")), "hand");
});

clause(LTA, "0:rule", "'this turn': the bonus survives the end of the battle and is gone once the turn ends", () => {
  const b = ltaBoard(bank("elitism", 4), ["a", "b"]);
  ltaCast(b, "a");
  assert.equal(st(b, "a", "strength"), 6);
  finishBattle(b.engine);
  assert.equal(st(b, "a", "strength"), 6, "still this turn after the battle");
  assert.equal(st(b, "a", "life"), 8);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(st(b, "a", "strength"), 2, "gone next turn");
  assert.equal(st(b, "a", "life"), 4);
});

clause(LTA, "1:flipUp", "FLIP UP for 4 with a single elitism: flips and gives the same +2/+2 (+4/+4 in a party of 2)", () => {
  const solo = ltaBoard([...bank("elitism", 1), ...bank("rage", 3)], ["a"], "play");
  ltaFlip(solo, "a");
  assert.equal(st(solo, "a", "strength"), 4);
  assert.equal(st(solo, "a", "life"), 6);
  assert.equal(zoneOf(solo.engine, solo.id("lta")), "discard");
  assert.equal(ready(solo.engine), 0, "exactly 4 paid");
  const duo = ltaBoard([...bank("elitism", 1), ...bank("rage", 3)], ["a", "b"], "play");
  ltaFlip(duo, "b");
  assert.equal(st(duo, "b", "strength"), 6);
  assert.equal(st(duo, "b", "life"), 8);
  assert.equal(st(duo, "a", "strength"), 2);
});

clause(LTA, "1:flipUp", "FLIP UP cost is 4: two ready rage + the face-down card itself (3 ready, a spent elitism) is refused", () => {
  const b = ltaBoard([...spent("elitism", 1), ...bank("rage", 2)], ["a"], "play");
  refused(() => ltaFlip(b, "a"), "3 ready for cost 4");
  assert.equal(b.engine.state.cards[b.id("lta")].faceDown, true);
  assert.equal(st(b, "a", "strength"), 2);
});

clause(LTA, "1:flipUp", "FLIP UP threshold [E]: four rage and no elitism is refused", () => {
  const b = ltaBoard(bank("rage", 4), ["a"], "play");
  refused(() => ltaFlip(b, "a"), "no elitism icon");
  assert.equal(b.engine.state.cards[b.id("lta")].faceDown, true);
  assert.equal(ready(b.engine), 5, "4 rage + the face-down card itself");
});

clause(LTA, "1:flipUp", "FLIP UP may be paid with the card itself, but its own face-down value is not the [E] icon", () => {
  const ok = ltaBoard([...bank("elitism", 1), ...bank("rage", 2)], ["a"], "play");
  ltaFlip(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("lta")), "discard", "1 elitism + 2 rage + itself pays 4");
  const noIcon = ltaBoard(bank("rage", 3), ["a"], "play");
  refused(() => ltaFlip(noIcon, "a"), "3 rage + itself has 4 to pay but no elitism icon");
  assert.equal(noIcon.engine.state.cards[noIcon.id("lta")].faceDown, true);
});

clause(LTA, "1:flipUp", "FLIP UP keeps the target restriction: a non-attacking character is refused", () => {
  const b = ltaBoard(bank("elitism", 4), ["a"], "play");
  refused(() => ltaFlip(b, "idle"), "not attacking");
  assert.equal(b.engine.state.cards[b.id("lta")].faceDown, true);
  assert.equal(st(b, "idle", "strength"), 2);
});

// ============================================================================
// P0p — character, gearsmith, subtype 31f, cost 3, threshold ee, 2 str / 3 spd / 2 life
// ============================================================================
const popCards = (): Cards => [
  { key: "pop", def: printing(POP), owner: P1, zone: "play" },
  { key: "snap", def: character({ name: "5n4p", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
  { key: "crack", def: character({ name: "Cr4ck13", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
  { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
  { key: "ally2", def: character({ name: "Ally2", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
  { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
  { key: "blk", def: character({ name: "Blk", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
  { key: "myitem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
  { key: "sp1", def: spawnTactic(), owner: P1, zone: "hand" },
  { key: "sp2", def: spawnTactic(), owner: P1, zone: "hand" },
  { key: "sp3", def: spawnTactic(), owner: P1, zone: "hand" }
];
const popBoard = (extra: Cards = [], turn?: number) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn, cards: [...popCards(), ...extra] });
type PopBoard = ReturnType<typeof popBoard>;
const pst = (b: PopBoard, k: string, stat: "strength" | "life" | "speed") => b.engine.getStat(b.id(k), stat);
const bolster = (b: PopBoard, target: string) => activate(b.engine, P1, b.id("pop"), "bolster", { selected: { a: [b.id(target)] } });
const teamwork = (b: PopBoard, sel: { a?: string; b?: string; c?: string } = {}) =>
  activate(b.engine, P1, b.id("pop"), "teamwork", {
    selected: { a: [b.id(sel.a ?? "snap")], b: [b.id(sel.b ?? "crack")], c: [b.id(sel.c ?? "pop")] }
  });
const mkTokens = (b: PopBoard, n: number) => {
  for (let i = 1; i <= n; i++) play(b.engine, P1, b.id(`sp${i}`));
  assert.equal(micros(b.engine).length, n);
};

clause(POP, "0:ability:bolster", "printed card: gearsmith character, subtype 31f, cost 3, threshold ee, 2 str / 3 spd / 2 life", () => {
  const d = printing(POP);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "gearsmith");
  assert.deepEqual([...(d.subtype ?? [])], ["31f"]);
  assert.equal(d.cost, 3);
  assert.equal(d.threshold, "ee");
  const b = popBoard();
  assert.equal(pst(b, "pop", "strength"), 2);
  assert.equal(pst(b, "pop", "speed"), 3);
  assert.equal(pst(b, "pop", "life"), 2);
});

clause(POP, "0:ability:bolster", "deploys for exactly 3 with ee: two elitism + a rage works (all spent); two elitism alone, or one elitism + two rage, is refused", () => {
  const hand = (res: Cards) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "p", def: printing(POP), owner: P1, zone: "hand" }, ...res]
    });
  const ok = hand([...bank("elitism", 2), ...bank("rage", 1)]);
  play(ok.engine, P1, ok.id("p"));
  assert.equal(zoneOf(ok.engine, ok.id("p")), "play");
  assert.equal(ready(ok.engine), 0);
  const cost = hand([...bank("elitism", 2)]);
  refused(() => play(cost.engine, P1, cost.id("p")), "cost 3 with 2 resources");
  assert.equal(zoneOf(cost.engine, cost.id("p")), "hand");
  const th = hand([...bank("elitism", 1), ...bank("rage", 2)]);
  refused(() => play(th.engine, P1, th.id("p")), "one elitism short", /Threshold requirements are not met/);
  assert.equal(zoneOf(th.engine, th.id("p")), "hand");
  const none = hand([...bank("rage", 4)]);
  refused(() => play(none.engine, P1, none.id("p")), "no elitism");
  const iso = hand([...spent("elitism", 2), ...bank("rage", 2)]);
  refused(() => play(iso.engine, P1, iso.id("p")), "2 ready for cost 3");
});

clause(POP, "0:ability:bolster", "BOLSTER depletes the picked other character of mine and gives THIS card exactly +1 strength and +1 life", () => {
  const b = popBoard();
  bolster(b, "ally");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, true, "COST: deplete the picked character");
  assert.equal(b.engine.state.cards[b.id("pop")].depleted, false, "P0p itself is not depleted");
  assert.equal(pst(b, "pop", "strength"), 3);
  assert.equal(pst(b, "pop", "life"), 3);
  assert.equal(pst(b, "pop", "speed"), 3, "speed untouched");
  assert.equal(pst(b, "ally", "strength"), 2, "the depleted character gains nothing");
  assert.equal(pst(b, "ally", "life"), 2);
  assert.equal(pst(b, "ally2", "strength"), 2);
  assert.equal(b.engine.state.cards[b.id("ally2")].depleted, false);
});

clause(POP, "0:ability:bolster", "the cost target must be ANOTHER character I control: itself, the opponent's character, an item, and an already depleted character are refused", () => {
  const b = popBoard();
  refused(() => bolster(b, "pop"), "itself");
  refused(() => bolster(b, "theirs"), "the opponent's character");
  refused(() => bolster(b, "myitem"), "an item");
  assert.equal(pst(b, "pop", "strength"), 2, "no bonus from refused attempts");
  assert.equal(b.engine.state.cards[b.id("pop")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("theirs")].depleted, false);
  b.engine.state.cards[b.id("ally")].depleted = true;
  refused(() => bolster(b, "ally"), "already depleted cannot be depleted again");
  assert.equal(pst(b, "pop", "strength"), 2);
  bolster(b, "ally2");
  assert.equal(pst(b, "pop", "strength"), 3, "control: a ready character");
});

clause(POP, "0:ability:bolster", "BOLSTER stacks (once per depleted character) and needs nothing from P0p itself: a depleted P0p can still use it", () => {
  const b = popBoard();
  b.engine.state.cards[b.id("pop")].depleted = true;
  bolster(b, "ally");
  bolster(b, "ally2");
  assert.equal(pst(b, "pop", "strength"), 4);
  assert.equal(pst(b, "pop", "life"), 4);
});

clause(POP, "0:ability:bolster", "the bonus lasts this turn only", () => {
  const b = popBoard();
  bolster(b, "ally");
  assert.equal(pst(b, "pop", "strength"), 3);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pst(b, "pop", "strength"), 2);
  assert.equal(pst(b, "pop", "life"), 2);
});

clause(POP, "1:ability:teamwork", "TEAMWORK destroys one Micromajig token I control and gives each of the three picked cards +1 strength and +1 life", () => {
  const b = popBoard();
  mkTokens(b, 1);
  teamwork(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 0, "COST: the token was destroyed");
  for (const k of ["pop", "snap", "crack"]) {
    assert.equal(pst(b, k, "strength"), k === "pop" ? 3 : 2, `${k} strength`);
    assert.equal(pst(b, k, "life"), k === "pop" ? 3 : 2, `${k} life`);
    assert.equal(pst(b, k, "speed"), 3, `${k} speed untouched`);
  }
  for (const k of ["ally", "ally2"]) {
    assert.equal(pst(b, k, "strength"), 2, `${k} unaffected`);
    assert.equal(pst(b, k, "life"), 2, `${k} unaffected`);
  }
  assert.equal(pst(b, "theirs", "strength"), 2);
});

clause(POP, "1:ability:teamwork", "the three characters cannot be blocked this turn (a block is refused; the same attack by a normal character can be blocked)", () => {
  const b = popBoard([], 2);
  mkTokens(b, 1);
  teamwork(b);
  declareAttackBy(b.engine, P1, [b.id("pop"), b.id("snap"), b.id("crack")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] } as never), "unblockable", /block/i);
  const control = popBoard([], 2);
  declareAttackBy(control.engine, P1, [control.id("pop"), control.id("snap"), control.id("crack")]);
  control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("blk")] } as never);
  assert.ok(control.engine.state.battle, "control: without TEAMWORK the block is legal");
});

clause(POP, "1:ability:teamwork", "the bonus and the unblockable status last this turn only", () => {
  const b = popBoard();
  mkTokens(b, 1);
  teamwork(b);
  assert.equal(pst(b, "snap", "strength"), 2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  for (const k of ["pop", "snap", "crack"]) {
    assert.equal(pst(b, k, "strength"), k === "pop" ? 2 : 1, `${k} back to printed`);
    assert.equal(pst(b, k, "life"), k === "pop" ? 2 : 1, `${k} back to printed`);
  }
  assert.ok(!b.engine.getKeywords(b.id("snap")).includes("cannotBeBlocked" as never), "no longer unblockable");
});

clause(POP, "1:ability:teamwork", "cost: I must control a Micromajig TOKEN: none at all, only the opponent's token, or only a non-token card named Micromajig is refused", () => {
  const none = popBoard();
  refused(() => teamwork(none), "no token");
  assert.equal(pst(none, "snap", "strength"), 1, "nothing happened");
  const theirs = popBoard([{ key: "xsp", def: spawnTactic("opponent"), owner: P1, zone: "hand" } as CardPlacement]);
  play(theirs.engine, P1, theirs.id("xsp"));
  assert.equal(micros(theirs.engine, P2).length, 1);
  refused(() => teamwork(theirs), "the opponent's token");
  assert.equal(micros(theirs.engine, P2).length, 1, "their token untouched");
  const card = popBoard([
    { key: "realMicro", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" } as CardPlacement
  ]);
  refused(() => teamwork(card), "a non-token card named Micromajig");
  assert.equal(zoneOf(card.engine, card.id("realMicro")), "play");
  const ok = popBoard();
  mkTokens(ok, 1);
  teamwork(ok);
  assert.equal(pst(ok, "snap", "strength"), 2, "control: with a token");
});

clause(POP, "1:ability:teamwork", "cost: with several tokens exactly ONE is destroyed, and only mine (the opponent's survives)", () => {
  const b = popBoard([{ key: "xsp", def: spawnTactic("opponent"), owner: P1, zone: "hand" } as CardPlacement]);
  mkTokens(b, 2);
  play(b.engine, P1, b.id("xsp"));
  teamwork(b);
  assert.equal(micros(b.engine).length, 1, "one of my two tokens destroyed");
  assert.equal(micros(b.engine, P2).length, 1, "the opponent's token untouched");
});

clause(POP, "1:ability:teamwork", "cost: I choose which Micromajig token to destroy (not a random one)", () => holdCostChoices(() => {
  const outcomes = new Set<string>();
  for (const roll of [0, 0.99]) {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => roll,
      cards: [...popCards()]
    });
    mkTokens(b, 2);
    const [t1, t2] = micros(b.engine).map((c) => c.id);
    b.engine.state.cards[t2].counters = { token: 1 };
    activate(b.engine, P1, b.id("pop"), "teamwork", { selected: { a: [b.id("snap")], b: [b.id("crack")], c: [b.id("pop")] } });
    const pc = pending(b.engine);
    assert.ok(pc && pc.playerId === P1, "I am asked which token to destroy");
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t2] } } as never);
    resolvePendingResponses(b.engine);
    outcomes.add(`${roll}:${zoneOf(b.engine, t1)}/${b.engine.state.cards[t2] ? zoneOf(b.engine, t2) : "gone"}`);
    assert.equal(b.engine.state.cards[t2], undefined, "the token I chose is the one destroyed");
    assert.equal(zoneOf(b.engine, t1), "play", "the other token is untouched");
  }
}));

clause(POP, "1:ability:teamwork", "the three picks must be named 5n4p, Cr4ck13 and P0p: a wrong name in any slot is refused and the token is not destroyed", () => {
  const b = popBoard();
  mkTokens(b, 1);
  refused(() => teamwork(b, { a: "ally" }), "slot a must be 5n4p");
  refused(() => teamwork(b, { b: "ally" }), "slot b must be Cr4ck13");
  refused(() => teamwork(b, { c: "ally" }), "slot c must be P0p");
  refused(() => teamwork(b, { a: "crack", b: "snap" }), "names swapped between slots");
  assert.equal(micros(b.engine).length, 1, "the token survives refused attempts");
  assert.equal(pst(b, "snap", "strength"), 1);
  teamwork(b);
  assert.equal(pst(b, "snap", "strength"), 2, "control");
});

clause(POP, "1:ability:teamwork", "the P0p pick may be another card named P0p instead of this one", () => {
  const b = popBoard([{ key: "pop2", def: printing(POP), owner: P1, zone: "play" } as CardPlacement]);
  mkTokens(b, 1);
  teamwork(b, { c: "pop2" });
  assert.equal(pst(b, "pop2", "strength"), 3);
  assert.equal(pst(b, "pop2", "life"), 3);
  assert.equal(pst(b, "pop", "strength"), 2, "only the picked P0p gains");
  assert.equal(pst(b, "snap", "strength"), 2);
});

clause(POP, "1:ability:teamwork", "use this only once per turn: a second use the same turn is refused, and it is available again next turn", () => {
  const b = popBoard();
  mkTokens(b, 2);
  teamwork(b);
  refused(() => teamwork(b), "second use this turn");
  assert.equal(micros(b.engine).length, 1, "the second token was not destroyed");
  assert.equal(pst(b, "snap", "strength"), 2, "no second bonus");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  teamwork(b);
  assert.equal(micros(b.engine).length, 0);
  assert.equal(pst(b, "snap", "strength"), 2, "bonus from the new turn's use");
});

clause(POP, "1:ability:teamwork", "TEAMWORK destroys one Micromajig token I control and gives each of the three picked cards +1 strength and +1 life (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard();
  mkTokens(b, 1);
  teamwork(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 0, "COST: the token was destroyed");
  for (const k of ["pop", "snap", "crack"]) {
    assert.equal(pst(b, k, "strength"), k === "pop" ? 3 : 2, `${k} strength`);
    assert.equal(pst(b, k, "life"), k === "pop" ? 3 : 2, `${k} life`);
    assert.equal(pst(b, k, "speed"), 3, `${k} speed untouched`);
  }
  for (const k of ["ally", "ally2"]) {
    assert.equal(pst(b, k, "strength"), 2, `${k} unaffected`);
    assert.equal(pst(b, k, "life"), 2, `${k} unaffected`);
  }
  assert.equal(pst(b, "theirs", "strength"), 2);
}));

clause(POP, "1:ability:teamwork", "the three characters cannot be blocked this turn (a block is refused; the same attack by a normal character can be blocked) (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard([], 2);
  mkTokens(b, 1);
  teamwork(b);
  declareAttackBy(b.engine, P1, [b.id("pop"), b.id("snap"), b.id("crack")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] } as never), "unblockable", /block/i);
  const control = popBoard([], 2);
  declareAttackBy(control.engine, P1, [control.id("pop"), control.id("snap"), control.id("crack")]);
  control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("blk")] } as never);
  assert.ok(control.engine.state.battle, "control: without TEAMWORK the block is legal");
}));

clause(POP, "1:ability:teamwork", "the bonus and the unblockable status last this turn only (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard();
  mkTokens(b, 1);
  teamwork(b);
  assert.equal(pst(b, "snap", "strength"), 2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  for (const k of ["pop", "snap", "crack"]) {
    assert.equal(pst(b, k, "strength"), k === "pop" ? 2 : 1, `${k} back to printed`);
    assert.equal(pst(b, k, "life"), k === "pop" ? 2 : 1, `${k} back to printed`);
  }
  assert.ok(!b.engine.getKeywords(b.id("snap")).includes("cannotBeBlocked" as never), "no longer unblockable");
}));

clause(POP, "1:ability:teamwork", "cost: I must control a Micromajig TOKEN: none at all, only the opponent's token, or only a non-token card named Micromajig is refused (with a stand-in token the cost selector can see)", withStandIn(() => {
  const none = popBoard();
  refused(() => teamwork(none), "no token");
  assert.equal(pst(none, "snap", "strength"), 1, "nothing happened");
  const theirs = popBoard([{ key: "xsp", def: spawnTactic("opponent"), owner: P1, zone: "hand" } as CardPlacement]);
  play(theirs.engine, P1, theirs.id("xsp"));
  assert.equal(micros(theirs.engine, P2).length, 1);
  refused(() => teamwork(theirs), "the opponent's token");
  assert.equal(micros(theirs.engine, P2).length, 1, "their token untouched");
  const card = popBoard([
    { key: "realMicro", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" } as CardPlacement
  ]);
  refused(() => teamwork(card), "a non-token card named Micromajig");
  assert.equal(zoneOf(card.engine, card.id("realMicro")), "play");
  const ok = popBoard();
  mkTokens(ok, 1);
  teamwork(ok);
  assert.equal(pst(ok, "snap", "strength"), 2, "control: with a token");
}));

clause(POP, "1:ability:teamwork", "cost: with several tokens exactly ONE is destroyed, and only mine (the opponent's survives) (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard([{ key: "xsp", def: spawnTactic("opponent"), owner: P1, zone: "hand" } as CardPlacement]);
  mkTokens(b, 2);
  play(b.engine, P1, b.id("xsp"));
  teamwork(b);
  assert.equal(micros(b.engine).length, 1, "one of my two tokens destroyed");
  assert.equal(micros(b.engine, P2).length, 1, "the opponent's token untouched");
}));

clause(POP, "1:ability:teamwork", "the three picks must be named 5n4p, Cr4ck13 and P0p: a wrong name in any slot is refused and the token is not destroyed (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard();
  mkTokens(b, 1);
  refused(() => teamwork(b, { a: "ally" }), "slot a must be 5n4p");
  refused(() => teamwork(b, { b: "ally" }), "slot b must be Cr4ck13");
  refused(() => teamwork(b, { c: "ally" }), "slot c must be P0p");
  refused(() => teamwork(b, { a: "crack", b: "snap" }), "names swapped between slots");
  assert.equal(micros(b.engine).length, 1, "the token survives refused attempts");
  assert.equal(pst(b, "snap", "strength"), 1);
  teamwork(b);
  assert.equal(pst(b, "snap", "strength"), 2, "control");
}));

clause(POP, "1:ability:teamwork", "the P0p pick may be another card named P0p instead of this one (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard([{ key: "pop2", def: printing(POP), owner: P1, zone: "play" } as CardPlacement]);
  mkTokens(b, 1);
  teamwork(b, { c: "pop2" });
  assert.equal(pst(b, "pop2", "strength"), 3);
  assert.equal(pst(b, "pop2", "life"), 3);
  assert.equal(pst(b, "pop", "strength"), 2, "only the picked P0p gains");
  assert.equal(pst(b, "snap", "strength"), 2);
}));

clause(POP, "1:ability:teamwork", "use this only once per turn: a second use the same turn is refused, and it is available again next turn (with a stand-in token the cost selector can see)", withStandIn(() => {
  const b = popBoard();
  mkTokens(b, 2);
  teamwork(b);
  refused(() => teamwork(b), "second use this turn");
  assert.equal(micros(b.engine).length, 1, "the second token was not destroyed");
  assert.equal(pst(b, "snap", "strength"), 2, "no second bonus");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  teamwork(b);
  assert.equal(micros(b.engine).length, 0);
  assert.equal(pst(b, "snap", "strength"), 2, "bonus from the new turn's use");
}));

// ============================================================================
// Party Crashers — majig character, gearsmith, cost 4, threshold e, 3 str / 3 spd / 4 life
// ============================================================================
const pcBoard = (extra: Cards = [], opts: { turn?: number; active?: typeof P1 | typeof P2 } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "pc", def: printing(PARTY), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "ally2", def: character({ name: "Ally2", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
      ...extra
    ]
  });
type PcBoard = ReturnType<typeof pcBoard>;
const spd = (b: PcBoard, k: string) => b.engine.getStat(b.id(k), "speed");

clause(PARTY, "0:rule", "printed card: gearsmith majig character, cost 4, threshold e, 3 str / 3 spd / 4 life", () => {
  const d = printing(PARTY);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "gearsmith");
  assert.deepEqual([...(d.subtype ?? [])], ["majig"]);
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "e");
  const b = pcBoard();
  assert.equal(b.engine.getStat(b.id("pc"), "strength"), 3);
  assert.equal(spd(b, "pc"), 3);
  assert.equal(b.engine.getStat(b.id("pc"), "life"), 4);
});

clause(PARTY, "0:rule", "deploys for exactly 4 with one elitism: 1 elitism + 3 rage works (all spent); 3 resources, or 4 with no elitism, is refused", () => {
  const hand = (res: Cards) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "p", def: printing(PARTY), owner: P1, zone: "hand" }, ...res]
    });
  const ok = hand([...bank("elitism", 1), ...bank("rage", 3)]);
  play(ok.engine, P1, ok.id("p"));
  assert.equal(zoneOf(ok.engine, ok.id("p")), "play");
  assert.equal(ready(ok.engine), 0);
  const cost = hand([...bank("elitism", 3)]);
  refused(() => play(cost.engine, P1, cost.id("p")), "cost 4 with 3 resources");
  assert.equal(zoneOf(cost.engine, cost.id("p")), "hand");
  const th = hand([...bank("rage", 4)]);
  refused(() => play(th.engine, P1, th.id("p")), "no elitism icon");
  assert.equal(zoneOf(th.engine, th.id("p")), "hand");
  const iso = hand([...spent("elitism", 1), ...bank("rage", 3)]);
  refused(() => play(iso.engine, P1, iso.id("p")), "spent elitism satisfies the threshold but 3 ready cannot pay 4");
});

clause(PARTY, "0:rule", "in an attacking party of 2 it loses exactly 1 speed (its partner does not)", () => {
  const b = pcBoard([], { turn: 2 });
  declareAttackBy(b.engine, P1, [b.id("pc"), b.id("ally")]);
  assert.equal(spd(b, "pc"), 2);
  assert.equal(spd(b, "ally"), 3);
  assert.equal(b.engine.getStat(b.id("pc"), "strength"), 3, "only speed changes");
  assert.equal(b.engine.getStat(b.id("pc"), "life"), 4);
});

clause(PARTY, "0:rule", "a bigger attacking party (3) still costs just 1 speed", () => {
  const b = pcBoard([], { turn: 2 });
  declareAttackBy(b.engine, P1, [b.id("pc"), b.id("ally"), b.id("ally2")]);
  assert.equal(spd(b, "pc"), 2);
});

clause(PARTY, "0:rule", "attacking alone, or not attacking at all (even next to other characters), it keeps its speed", () => {
  const solo = pcBoard([], { turn: 2 });
  assert.equal(spd(solo, "pc"), 3, "not attacking");
  declareAttackBy(solo.engine, P1, [solo.id("pc")]);
  assert.equal(spd(solo, "pc"), 3, "attacking alone");
  assert.equal(spd(solo, "ally"), 3);
});

clause(PARTY, "0:rule", "the penalty ends with the battle", () => {
  const b = pcBoard([], { turn: 2 });
  declareAttackBy(b.engine, P1, [b.id("pc"), b.id("ally")]);
  assert.equal(spd(b, "pc"), 2);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(b.engine);
  assert.equal(spd(b, "pc"), 3, "back to 3 after the battle");
});

clause(PARTY, "0:rule", "a party of BLOCKERS is not an attacking party: blocking together with another character keeps speed 3", () => {
  const b = pcBoard(
    [{ key: "foeAtk", def: character({ name: "FoeAtk", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" } as CardPlacement],
    { turn: 2, active: P2 }
  );
  declareAttackBy(b.engine, P2, [b.id("foeAtk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("pc"), b.id("ally")] } as never);
  assert.equal(spd(b, "pc"), 3);
});

clause(PARTY, "0:rule", "the opponent's Party Crashers slows itself the same way when it attacks in a party", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pc", def: printing(PARTY), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("pc"), b.id("ally")]);
  assert.equal(b.engine.getStat(b.id("pc"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("ally"), "speed"), 3);
});

const pcKill = (): Cards => [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }];
const killPc = (b: PcBoard) => {
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("pc")] } });
  drain(b.engine, declineAll);
};

clause(PARTY, "1:rule@eeee", "with eeee, destroying it puts exactly 2 Micromajig tokens (1/1/3) into play under my control", () => {
  const b = pcBoard([...pcKill(), ...bank("elitism", 4)]);
  killPc(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("pc")), "discard");
  const m = micros(b.engine);
  assert.equal(m.length, 2);
  assert.equal(micros(b.engine, P2).length, 0);
  for (const t of m) {
    assert.equal(b.engine.getStat(t.id, "strength"), 1);
    assert.equal(b.engine.getStat(t.id, "life"), 1);
    assert.equal(b.engine.getStat(t.id, "speed"), 3);
    assert.ok((b.engine.getDefinition(t.id).subtype ?? []).includes("majig"), "(b.engine.getDefinition(t.id).subtype ?? []).includes(\"majig\")");
  }
});

clause(PARTY, "1:rule@eeee", "the Micromajig tokens it makes are characters (can be picked as one)", () => {
  const b = pcBoard([...pcKill(), { key: "kill2", def: killTactic("Kill2"), owner: P1, zone: "hand" } as CardPlacement, ...bank("elitism", 4)]);
  killPc(b);
  const m = micros(b.engine);
  assert.equal(m.length, 2);
  assert.equal(b.engine.getDefinition(m[0].id).type, "character");
  play(b.engine, P1, b.id("kill2"), { selected: { t: [m[0].id] } });
  assert.equal(micros(b.engine).length, 1, "a character-selecting tactic can destroy one");
});

clause(PARTY, "1:rule@eeee", "the Micromajig tokens it makes are Gearsmith characters (RULES §13)", () => {
  const b = pcBoard([...pcKill(), ...bank("elitism", 4)]);
  killPc(b);
  const m = micros(b.engine);
  assert.equal(m.length, 2);
  for (const t of m) assert.equal(b.engine.getDefinition(t.id).trade, "gearsmith");
});

clause(PARTY, "1:rule@eeee", "more than eeee still gives just 2 tokens", () => {
  const b = pcBoard([...pcKill(), ...bank("elitism", 6)]);
  killPc(b);
  assert.equal(micros(b.engine).length, 2);
});

clause(PARTY, "1:rule@eeee", "spent elitism resources still count toward eeee", () => {
  const b = pcBoard([...pcKill(), ...spent("elitism", 2), ...bank("elitism", 2)]);
  killPc(b);
  assert.equal(micros(b.engine).length, 2);
});

clause(PARTY, "1:rule@eeee", "without eeee (three elitism + rage, or only rage) there are no tokens and no prompt", () => {
  const b = pcBoard([...pcKill(), ...bank("elitism", 3), ...bank("rage", 3)]);
  killPc(b);
  assert.equal(zoneOf(b.engine, b.id("pc")), "discard");
  assert.equal(micros(b.engine).length, 0);
  const c = pcBoard([...pcKill()]);
  killPc(c);
  assert.equal(zoneOf(c.engine, c.id("pc")), "discard");
  assert.equal(micros(c.engine).length, 0);
});

clause(PARTY, "1:rule@eeee", "only MY elitism counts: two of mine + two of the opponent's gives no tokens", () => {
  const b = pcBoard([...pcKill(), ...bank("elitism", 2), ...bank("elitism", 2, P2)]);
  killPc(b);
  assert.equal(micros(b.engine).length, 0);
});

clause(PARTY, "1:rule@eeee", "it must be DESTROYED: another character being destroyed makes no tokens, and returned to hand it makes none either", () => {
  const b = pcBoard([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" } as CardPlacement, ...pcKill(), ...bank("elitism", 4)]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ally")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(micros(b.engine).length, 0, "another character dying makes none");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("pc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("pc")), "hand");
  assert.equal(micros(b.engine).length, 0);
});

clause(PARTY, "1:rule@eeee", "dying in battle works too: the tokens appear after it is destroyed by a blocker", () => {
  const b = pcBoard([{ key: "big", def: character({ name: "Big", strength: 5, life: 10, speed: 3 }), owner: P2, zone: "play" } as CardPlacement, ...bank("elitism", 4)], { turn: 2 });
  fightThrough(b.engine, P1, [b.id("pc")], { type: "faction", playerId: P2 }, [b.id("big")]);
  assert.equal(zoneOf(b.engine, b.id("pc")), "discard");
  assert.equal(micros(b.engine).length, 2);
});


clause(JO, "2:rule", "only ONE item is found: choosing two is refused (enter and leave)", () => {
  const b = jo();
  play(b.engine, P1, b.id("jo"));
  refused(() => tutor(b.engine, [b.id("tool"), b.id("tool2")]), "two items");
  assert.equal(zoneOf(b.engine, b.id("tool")), "deck");
  const c = joPlay([...tutorCards(), { key: "kill", def: killTactic(), owner: P1, zone: "hand" } as CardPlacement]);
  play(c.engine, P1, c.id("kill"), { selected: { t: [c.id("jo")] } });
  refused(() => tutor(c.engine, [c.id("tool"), c.id("tool2")]), "two items on leaving");
});

clause(JO, "2:rule", "leaving play: a rogue item, a gearsmith character, the opponent's item and discard/hand cards cannot be found either", () => {
  for (const bad of ["rogueItem", "gearChar", "theirTool", "discTool", "handTool"]) {
    const b = joPlay([...tutorCards(), { key: "kill", def: killTactic(), owner: P1, zone: "hand" } as CardPlacement]);
    play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("jo")] } });
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${bad}: a search prompt`);
    refused(() => tutor(b.engine, [b.id(bad)]), `${bad} cannot be chosen`);
  }
});

clause(LMW, "1:rule", "only ONE item is found: choosing two eligible items is refused", () => {
  const b = lmwBoard();
  lmwCast(b, "it3", "foe");
  refused(() => tutor(b.engine, [b.id("d0"), b.id("d1")]), "two items");
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck");
});

clause(LTA, "0:rule", "an attacking character of the OPPONENT's cannot be picked (it is not 'you control')", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "lta", def: printing(LTA), owner: P1, zone: "hand" },
      { key: "theirAtk", def: character({ name: "TheirAtk", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "myBlk", def: character({ name: "MyBlk", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      ...bank("elitism", 4)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("theirAtk")]);
  refused(() => play(b.engine, P1, b.id("lta"), { selected: { c: [b.id("theirAtk")] } }), "the attacker is the opponent's", /Illegal target|target/i);
  assert.equal(b.engine.getStat(b.id("theirAtk"), "strength"), 2);
  assert.equal(zoneOf(b.engine, b.id("lta")), "hand");
});

// @@END
