// Clause tests: holy-heist-09 part p1 (groups 1-4, missing clauses).
// Thabbashite Bowlegger, Twisted Cannoneer, Vicious Bruiser, The Tournament Faction (Holy Heist).

import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  activate,
  play,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, holdResourceFace } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { declareBlockers, pending, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, developOffers, endTurnRaw } from "./_turn.js";
import type { SpoilsEngine, CardDefinition } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";


type Player = typeof P1 | typeof P2;

const BOWLEGGER = "e76bbc29-bb2f-4f8c-a8e9-3d6fc921ef85"; // character cost 4 [R] 2/3/2
const CANNONEER = "d1ec10d9-7fac-4cf9-9a2f-c9f03d662179"; // character cost 6 [R] 4/3/4
const BRUISER = "97ccef0f-b39a-42d7-8521-0c7549cfef60"; // character cost 5 [R] 4/3/2
const TOURNAMENT = "4ac0cc5f-56d1-4a5e-8360-6a7457d7c9de";
const RAGE = "fe913bf8-b4eb-411a-a8b8-dcaf0095c90e";
const GREED = "1b675619-bee8-41ed-8562-d4d9c763ad05";
const DECEPTION = "e93094ca-311a-4302-bdc5-798905a0f809";
const ELITISM = "5a5250c1-a651-43e4-ac75-f2403860446d";
const OBSESSION = "dab6e897-b5be-4760-95c0-20c2795a9ae3";

const NOOP = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

// =============================================================================
// Thabbashite Bowlegger
// When a card that provides at least [V] enters play under your control, you may
// pick a character. If you do, that character gains 2 strength this turn.
// =============================================================================

const handRes = (key: string, owner: Player, icon: "greed" | "rage" | "volition" = "greed"): CardPlacement => ({
  key,
  def: resourceCard({ name: `Res ${key}`, resource: { provides: [icon], staple: icon !== "volition" } }),
  owner,
  zone: "hand"
});

function bowBoard(extra: CardPlacement[] = [], active: Player = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "bow", def: printing(BOWLEGGER), owner: P1, zone: "play" },
      { key: "buff", def: character({ name: "Buff", strength: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5 }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "hc2", def: character({ name: "Hand Char 2" }), owner: P1, zone: "hand" },
      handRes("hr", P1, "greed"),
      { key: "ohc", def: character({ name: "Opp Hand Char" }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

/** Drain every prompt; pick `key` (or nobody) for the Bowlegger pick `c`. Counts the `c` prompts. */
function pickingFor(id: (k: string) => string, key: string | null) {
  const counter = { prompts: 0 };
  const answer = (pc: any) => {
    if (pc.kind === "selectTargets") {
      counter.prompts++;
      return { kind: "selectTargets", selected: { c: key ? [id(key)] : [] } };
    }
    return declineAll(pc);
  };
  return { counter, answer };
}

clause(BOWLEGGER, "0:rule", "printed card: deploys for exactly 4 with [R] (3, or 5 without an [R], is refused) and is a 2/3/2 character", () => {
  const deployBoard = (rage: number, greed = 0) => buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "bow", def: printing(BOWLEGGER), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]
  });
  const noRage = deployBoard(0, 5);
  refused(() => play(noRage.engine, P1, noRage.id("bow")), "threshold [R] with no [R]", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("bow")), "hand");
  const short = deployBoard(3);
  refused(() => play(short.engine, P1, short.id("bow")), "one short of cost 4", /cost|afford|pay|resource/i);
  assert.equal(zoneOf(short.engine, short.id("bow")), "hand", "still in hand");
  assert.equal(short.engine.getAvailableResourceCount(P1), 3, "nothing paid");
  const ok = deployBoard(4);
  play(ok.engine, P1, ok.id("bow"));
  assert.equal(zoneOf(ok.engine, ok.id("bow")), "play", "control: exactly 4 deploys it");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "all 4 paid");
  assert.deepEqual(["strength", "speed", "life"].map((stat) => ok.engine.getStat(ok.id("bow"), stat as "strength")), [2, 3, 2]);
});

clause(BOWLEGGER, "0:rule", "a face-down card (provides Volition) developed under my control: I may pick a character and it gains exactly 2 strength", () => {
  const { engine, id } = bowBoard();
  developResource(engine, P1, id("hc"), true);
  const { counter, answer } = pickingFor(id, "buff");
  drain(engine, answer);
  assert.equal(pending(engine), undefined);
  assert.equal(counter.prompts, 1, "exactly one pick is offered for one card entering");
  assert.equal(engine.getStat(id("buff"), "strength"), 4, "2 printed + 2");
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "only the picked character");
  assert.equal(engine.getStat(id("bow"), "strength"), 2, "Bowlegger itself is not buffed");
  assert.equal(engine.getStat(id("buff"), "life"), 5, "only strength changes");
});

clause(BOWLEGGER, "0:rule", "the picked character may be ANY character: the opponent's, or Bowlegger itself", () => {
  const a = bowBoard();
  developResource(a.engine, P1, a.id("hc"), true);
  drain(a.engine, pickingFor(a.id, "foe").answer);
  assert.equal(a.engine.getStat(a.id("foe"), "strength"), 5, "opponent's character: 3 + 2");
  assert.equal(a.engine.getStat(a.id("buff"), "strength"), 2);
  const b = bowBoard();
  developResource(b.engine, P1, b.id("hc"), true);
  drain(b.engine, pickingFor(b.id, "bow").answer);
  assert.equal(b.engine.getStat(b.id("bow"), "strength"), 4, "Bowlegger itself: 2 + 2");
});

clause(BOWLEGGER, "0:rule", "'you may': declining the pick (picking nobody) gives no strength to anyone", () => {
  const { engine, id } = bowBoard();
  developResource(engine, P1, id("hc"), true);
  const { counter, answer } = pickingFor(id, null);
  drain(engine, answer);
  assert.equal(pending(engine), undefined);
  assert.equal(counter.prompts, 1, "I was asked");
  for (const [k, s] of [["buff", 2], ["foe", 3], ["bow", 2]] as const) assert.equal(engine.getStat(id(k), "strength"), s, k);
});

clause(BOWLEGGER, "0:rule", "the pick must be a character in play: an item, a card in hand, and a faction are refused", () => {
  const ok = bowBoard();
  developResource(ok.engine, P1, ok.id("hc"), true);
  drain(ok.engine, pickingFor(ok.id, "buff").answer);
  assert.equal(ok.engine.getStat(ok.id("buff"), "strength"), 4, "positive control");
  for (const bad of ["gadget", "hc2", "ohc"]) {
    const { engine, id } = bowBoard();
    developResource(engine, P1, id("hc"), true);
    refused(() => drain(engine, pickingFor(id, bad).answer), `${bad} is not a character in play`);
    assert.equal(engine.getStat(id("buff"), "strength"), 2, `${bad}: nothing was buffed`);
  }
  const f = bowBoard();
  developResource(f.engine, P1, f.id("hc"), true);
  refused(
    () => drain(f.engine, (pc: any) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { c: [f.engine.state.players[P2].factionId!] } } : declineAll(pc))),
    "a faction is not a character"
  );
});

clause(BOWLEGGER, "0:rule", "the strength lasts this turn only: it is gone after the turn ends (and does not come back)", () => {
  const { engine, id } = bowBoard();
  developResource(engine, P1, id("hc"), true);
  drain(engine, pickingFor(id, "buff").answer);
  assert.equal(engine.getStat(id("buff"), "strength"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("buff"), "strength"), 2, "back to printed strength when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("buff"), "strength"), 2, "and stays there next turn");
});

clause(BOWLEGGER, "0:rule", "a face-up resource that provides only a staple icon (not [V]) entering play does not trigger it", () => {
  const { engine, id } = bowBoard();
  developResource(engine, P1, id("hr"), false);
  assert.equal(zoneOf(engine, id("hr")), "play");
  assert.equal(pending(engine), undefined, "no pick is offered");
  assert.equal(engine.getStat(id("buff"), "strength"), 2);
  assert.equal(engine.getStat(id("bow"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "the same real resource card played face-down does trigger it (it then provides Volition)", () => {
  const { engine, id } = bowBoard();
  developResource(engine, P1, id("hr"), true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  drain(engine, pickingFor(id, "buff").answer);
  assert.equal(engine.getStat(id("buff"), "strength"), 4);
});

clause(BOWLEGGER, "0:rule", "'provides at least [V]': a face-up resource card that itself provides Volition triggers it", () => {
  const { engine, id } = bowBoard([handRes("vr", P1, "volition")]);
  developResource(engine, P1, id("vr"), false);
  assert.equal(engine.state.cards[id("vr")].faceDown, false);
  assert.equal(engine.getThresholds(P1).volition, 1, "it provides [V] face-up");
  const { counter, answer } = pickingFor(id, "buff");
  drain(engine, answer);
  assert.equal(counter.prompts, 1);
  assert.equal(engine.getStat(id("buff"), "strength"), 4);
});

clause(BOWLEGGER, "0:rule", "a character entering play face-up (deployed normally) does not provide [V], so it does not trigger it", () => {
  const { engine, id } = bowBoard([{ key: "cheap", def: character({ name: "Cheap", cost: 0 }), owner: P1, zone: "hand" }]);
  play(engine, P1, id("cheap"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cheap")), "play");
  assert.equal(pending(engine), undefined, "no pick is offered");
  assert.equal(engine.getStat(id("buff"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "'under your control': the opponent developing a face-down card does not trigger my Bowlegger", () => {
  const { engine, id } = bowBoard([], P2);
  developResource(engine, P2, id("ohc"), true);
  assert.equal(zoneOf(engine, id("ohc")), "play");
  assert.equal(engine.state.cards[id("ohc")].faceDown, true);
  assert.equal(pending(engine), undefined, "I am not asked to pick");
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
  assert.equal(engine.getStat(id("buff"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "the opponent's own Bowlegger does not trigger from MY face-down card (it is their control that counts)", () => {
  const { engine, id } = bowBoard([{ key: "obow", def: printing(BOWLEGGER), owner: P2, zone: "play" }]);
  developResource(engine, P1, id("hc"), true);
  // exactly one pick (mine); the opponent's Bowlegger adds none
  const { counter, answer } = pickingFor(id, "buff");
  drain(engine, answer);
  assert.equal(counter.prompts, 1, "only my Bowlegger triggered");
  assert.equal(engine.getStat(id("buff"), "strength"), 4);
  assert.equal(engine.getStat(id("obow"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "it works while Bowlegger is in play only: with it in my hand, a face-down card entering does nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bow", def: printing(BOWLEGGER), owner: P1, zone: "hand" },
      { key: "buff", def: character({ name: "Buff", strength: 2 }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" }
    ]
  });
  developResource(engine, P1, id("hc"), true);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("buff"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "a face-down card entering through a card effect (playResource) also triggers it", () => {
  const PR = tactic({
    name: "Play Res",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pr",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "playResource", target: { type: "selected", id: "t" }, faceDown: true, player: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = bowBoard([{ key: "pr", def: PR, owner: P1, zone: "hand" }]);
  play(engine, P1, id("pr"), { selected: { t: [id("hc")] } });
  assert.equal(zoneOf(engine, id("hc")), "play");
  assert.equal(engine.state.cards[id("hc")].faceDown, true);
  const { counter, answer } = pickingFor(id, "buff");
  drain(engine, answer);
  assert.equal(counter.prompts, 1, "a card entering play face-down provides [V], however it got there");
  assert.equal(engine.getStat(id("buff"), "strength"), 4);
});

clause(BOWLEGGER, "0:rule", "a card that provides [V] put into play by an effect under my control (even one the opponent owns) triggers it; my own non-[V] card put into play does not", () => {
  const REANIMATE = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const vres = resourceCard({ name: "Volition Res", resource: { provides: ["volition"], staple: false } });
  const gres = resourceCard({ name: "Greed Res", resource: { provides: ["greed"], staple: true } });
  const g = bowBoard([
    { key: "re", def: REANIMATE, owner: P1, zone: "hand" },
    { key: "ov", def: vres, owner: P2, zone: "discard" }
  ]);
  play(g.engine, P1, g.id("re"), { selected: { t: [g.id("ov")] } });
  assert.equal(zoneOf(g.engine, g.id("ov")), "play");
  assert.equal(g.engine.state.cards[g.id("ov")].controllerId, P1, "I control the opponent-owned card");
  const { counter, answer } = pickingFor(g.id, "buff");
  drain(g.engine, answer);
  assert.equal(counter.prompts, 1);
  assert.equal(g.engine.getStat(g.id("buff"), "strength"), 4);
  const h = bowBoard([
    { key: "re", def: REANIMATE, owner: P1, zone: "hand" },
    { key: "mg", def: gres, owner: P1, zone: "discard" }
  ]);
  play(h.engine, P1, h.id("re"), { selected: { t: [h.id("mg")] } });
  assert.equal(zoneOf(h.engine, h.id("mg")), "play");
  assert.equal(pending(h.engine), undefined, "a Greed-only card provides no [V]");
  assert.equal(h.engine.getStat(h.id("buff"), "strength"), 2);
});

clause(BOWLEGGER, "0:rule", "each qualifying card gives its own pick: two face-down cards in one turn stack to +4 on the same character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bow", def: printing(BOWLEGGER), owner: P1, zone: "play" },
      { key: "buff", def: character({ name: "Buff", strength: 2 }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "hc2", def: character({ name: "Hand Char 2" }), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1)
    ]
  });
  const { counter, answer } = pickingFor(id, "buff");
  developResource(engine, P1, id("hc"), true);
  drain(engine, answer);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: "tournament-resource", selected: { resource: [id("hc2")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  drain(engine, answer);
  assert.equal(counter.prompts, 2, "two cards, two picks");
  assert.equal(engine.getStat(id("buff"), "strength"), 6, "2 + 2 + 2");
});

// =============================================================================
// Twisted Cannoneer
// FIRE! -- COST: Use this only not during a battle. Pick a faction. Destroy a
// character you control. Pay 1. -- EFFECT: Inflict 1 damage to the faction.
// =============================================================================

function cannBoard(extra: CardPlacement[] = [], resources = 3, active: Player = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "cann", def: printing(CANNONEER), owner: P1, zone: "play" },
      { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
      { key: "sac2", def: character({ name: "Sac 2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      ...bank("rage", resources, P1),
      ...extra
    ]
  });
}

const facOf = (engine: SpoilsEngine, p: Player) => engine.state.players[p].factionId!;
const fire = (engine: SpoilsEngine, p: Player, f: string, sac: string, cardId: string) =>
  activate(engine, p, cardId, "twisted-cannoneer-fire", { selected: { f: [f], sac: [sac] } });

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "'Destroy' means destroyed: the sacrificed character's own 'when destroyed' trigger fires", () => {
  const LAST = character({
    name: "Last Words",
    behavior: { abilities: [{ id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = cannBoard([
    { key: "lw", def: LAST, owner: P1, zone: "play" },
    { key: "d0", def: character({ name: "Deck 0" }), owner: P1, zone: "deck" },
    { key: "d1", def: character({ name: "Deck 1" }), owner: P1, zone: "deck" }
  ]);
  fire(engine, P1, facOf(engine, P2), id("lw"), id("cann"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("lw")), "discard");
  assert.equal(zoneOf(engine, id("d0")), "hand", "its destroyed trigger drew exactly one card");
  assert.equal(zoneOf(engine, id("d1")), "deck");
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "'not during a battle' is the card's own restriction: a defender who could otherwise respond in the declaration window is refused too, while the same response outside a battle works", () => {
  const board = (withBattle: boolean) => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "att", def: character({ name: "Attacker", strength: 1, life: 9 }), owner: P1, zone: "play" },
        { key: "noop", def: NOOP, owner: P1, zone: "hand" },
        { key: "cann", def: printing(CANNONEER), owner: P2, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P2, zone: "play" },
        ...bank("rage", 3, P2)
      ]
    });
    if (withBattle) declareAttackOpenWindow(g.engine, P1, [g.id("att")]);
    else playRaw(g.engine, P1, g.id("noop"));
    return g;
  };
  const ctl = board(false);
  assert.equal(ctl.engine.state.battle, undefined, "no battle");
  assert.ok(ctl.engine.state.responseWindow, "the opponent may respond");
  const inf = ctl.engine.state.players[P1].influence;
  ctl.engine.perform({ type: "activateAbility", playerId: P2, cardId: ctl.id("cann"), abilityId: "twisted-cannoneer-fire", selected: { f: [facOf(ctl.engine, P1)], sac: [ctl.id("sac")] }, variables: {} } as never);
  resolvePendingResponses(ctl.engine);
  assert.equal(zoneOf(ctl.engine, ctl.id("sac")), "discard", "positive control: usable in a response outside a battle");
  assert.equal(ctl.engine.state.players[P1].influence, inf - 1);
  const b = board(true);
  assert.ok(b.engine.state.battle, "a battle is on");
  assert.ok(b.engine.state.responseWindow, "the defender holds priority");
  refused(
    () =>
      b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("cann"), abilityId: "twisted-cannoneer-fire", selected: { f: [facOf(b.engine, P1)], sac: [b.id("sac")] }, variables: {} } as never),
    "during a battle",
    /current timing|battle|condition/i
  );
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
  assert.equal(attachedCount(b.engine, P2), 0);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "destroys the chosen character I control, pays exactly 1 resource, and deals exactly 1 damage to the picked (opponent's) faction", () => {
  const { engine, id } = cannBoard();
  const oppInf = engine.state.players[P2].influence;
  const myInf = engine.state.players[P1].influence;
  fire(engine, P1, facOf(engine, P2), id("sac"), id("cann"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("sac")), "discard", "the sacrificed character is destroyed");
  assert.equal(zoneOf(engine, id("sac2")), "play", "other characters stay");
  assert.equal(zoneOf(engine, id("cann")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(attachedCount(engine, P1), 1, "Pay 1: exactly one resource is spent");
  assert.equal(readyCount(engine, P1), 2);
  assert.equal(engine.state.players[P2].influence, oppInf - 1, "1 damage to the picked faction");
  assert.equal(engine.state.players[P1].influence, myInf, "my faction is untouched");
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "'Pick a faction': it may be my own faction, which then takes the 1 damage instead", () => {
  const { engine, id } = cannBoard();
  const oppInf = engine.state.players[P2].influence;
  const myInf = engine.state.players[P1].influence;
  fire(engine, P1, facOf(engine, P1), id("sac"), id("cann"));
  assert.equal(engine.state.players[P1].influence, myInf - 1);
  assert.equal(engine.state.players[P2].influence, oppInf);
  assert.equal(zoneOf(engine, id("sac")), "discard");
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "the damaged thing must be a faction: a character, an item or a non-card id is refused", () => {
  const ctl = cannBoard();
  fire(ctl.engine, P1, facOf(ctl.engine, P2), ctl.id("sac"), ctl.id("cann"));
  assert.equal(zoneOf(ctl.engine, ctl.id("sac")), "discard", "positive control");
  for (const bad of ["foe", "sac2", "gadget"]) {
    const { engine, id } = cannBoard();
    refused(() => fire(engine, P1, id(bad), id("sac"), id("cann")), `${bad} is not a faction`);
    assert.equal(zoneOf(engine, id("sac")), "play", `${bad}: nothing was sacrificed`);
    assert.equal(attachedCount(engine, P1), 0, `${bad}: nothing was paid`);
  }
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "the destroyed card must be a character I control: the opponent's character, an item, and a faction are refused", () => {
  for (const bad of ["foe", "gadget"]) {
    const { engine, id } = cannBoard();
    const inf = engine.state.players[P2].influence;
    refused(() => fire(engine, P1, facOf(engine, P2), id(bad), id("cann")), `${bad} may not be sacrificed`);
    assert.equal(zoneOf(engine, id(bad)), "play", `${bad} stays in play`);
    assert.equal(engine.state.players[P2].influence, inf, `${bad}: no damage dealt`);
    assert.equal(attachedCount(engine, P1), 0);
  }
  const { engine, id } = cannBoard();
  refused(() => fire(engine, P1, facOf(engine, P2), facOf(engine, P1), id("cann")), "my own faction is not a character");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "'a character you control': Cannoneer itself may be the sacrifice, and control (not ownership) decides", () => {
  const self = cannBoard();
  const inf = self.engine.state.players[P2].influence;
  fire(self.engine, P1, facOf(self.engine, P2), self.id("cann"), self.id("cann"));
  assert.equal(zoneOf(self.engine, self.id("cann")), "discard", "it sacrificed itself");
  assert.equal(self.engine.state.players[P2].influence, inf - 1, "the effect still happened");
  // a character the opponent owns but I control may be sacrificed
  const stolen = cannBoard([{ key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, zone: "play" }]);
  fire(stolen.engine, P1, facOf(stolen.engine, P2), stolen.id("stolenIn"), stolen.id("cann"));
  assert.equal(zoneOf(stolen.engine, stolen.id("stolenIn")), "discard", "controlled by me");
  // a character I own but the opponent controls may not
  const lost = cannBoard([{ key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, zone: "play" }]);
  refused(() => fire(lost.engine, P1, facOf(lost.engine, P2), lost.id("stolenOut"), lost.id("cann")), "I do not control it");
  assert.equal(zoneOf(lost.engine, lost.id("stolenOut")), "play");
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "Pay 1: refused with no ready resource (nothing sacrificed, no damage), allowed with exactly 1, spent resources don't count", () => {
  const none = cannBoard([], 0);
  const inf = none.engine.state.players[P2].influence;
  refused(() => fire(none.engine, P1, facOf(none.engine, P2), none.id("sac"), none.id("cann")), "no resource to pay 1");
  assert.equal(zoneOf(none.engine, none.id("sac")), "play", "the character was not destroyed");
  assert.equal(none.engine.state.players[P2].influence, inf);
  const spent = cannBoard(bank("rage", 2, P1).map((p) => ({ ...p, key: `sp${p.key}`, attachedToKey: "__factionA" })), 0);
  assert.equal(readyCount(spent.engine, P1), 0);
  refused(() => fire(spent.engine, P1, facOf(spent.engine, P2), spent.id("sac"), spent.id("cann")), "spent resources cannot pay");
  assert.equal(zoneOf(spent.engine, spent.id("sac")), "play");
  const one = cannBoard([], 1);
  fire(one.engine, P1, facOf(one.engine, P2), one.id("sac"), one.id("cann"));
  assert.equal(zoneOf(one.engine, one.id("sac")), "discard", "exactly one resource is enough");
  assert.equal(readyCount(one.engine, P1), 0);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "any resource icon pays the 1 (it is generic)", () => {
  const { engine, id } = cannBoard(volition(1, P1), 0);
  fire(engine, P1, facOf(engine, P2), id("sac"), id("cann"));
  assert.equal(zoneOf(engine, id("sac")), "discard");
  assert.equal(readyCount(engine, P1), 0);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "'Use this only not during a battle': refused while a battle is on, allowed before it and after it ends", () => {
  const battle = cannBoard([{ key: "att", def: character({ name: "Attacker", strength: 1, life: 9 }), owner: P1, zone: "play" }]);
  const inf = battle.engine.state.players[P2].influence;
  declareAttackBy(battle.engine, P1, [battle.id("att")]);
  assert.ok(battle.engine.state.battle, "a battle is on");
  refused(() => fire(battle.engine, P1, facOf(battle.engine, P2), battle.id("sac"), battle.id("cann")), "during a battle", /current timing/i);
  assert.equal(zoneOf(battle.engine, battle.id("sac")), "play", "nothing was destroyed");
  assert.equal(attachedCount(battle.engine, P1), 0, "nothing was paid");
  assert.equal(battle.engine.state.players[P2].influence, inf);
  declareBlockers(battle.engine, P2, []);
  finishBattle(battle.engine);
  assert.equal(battle.engine.state.battle, undefined, "the battle is over");
  const after = battle.engine.state.players[P2].influence;
  fire(battle.engine, P1, facOf(battle.engine, P2), battle.id("sac"), battle.id("cann"));
  assert.equal(zoneOf(battle.engine, battle.id("sac")), "discard", "usable again once the battle ended");
  assert.equal(battle.engine.state.players[P2].influence, after - 1);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "can be used more than once a turn (no limit printed): each use destroys one character and costs 1", () => {
  const { engine, id } = cannBoard([], 3);
  const inf = engine.state.players[P2].influence;
  fire(engine, P1, facOf(engine, P2), id("sac"), id("cann"));
  fire(engine, P1, facOf(engine, P2), id("sac2"), id("cann"));
  assert.equal(zoneOf(engine, id("sac")), "discard");
  assert.equal(zoneOf(engine, id("sac2")), "discard");
  assert.equal(attachedCount(engine, P1), 2);
  assert.equal(engine.state.players[P2].influence, inf - 2);
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "not depleted by using it, and only its controller may use it", () => {
  const { engine, id } = cannBoard();
  fire(engine, P1, facOf(engine, P2), id("sac"), id("cann"));
  assert.equal(engine.state.cards[id("cann")].depleted, false, "no deplete cost is printed");
  const opp = cannBoard([...bank("rage", 3, P2)], 3, P2);
  refused(() => fire(opp.engine, P2, facOf(opp.engine, P1), opp.id("foe"), opp.id("cann")), "not my Cannoneer", /controller|not found|control|priority/i);
  assert.equal(zoneOf(opp.engine, opp.id("foe")), "play");
});

clause(CANNONEER, "0:ability:twisted-cannoneer-fire", "can only be used from play: refused while Cannoneer is in my hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cann", def: printing(CANNONEER), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  refused(() => fire(engine, P1, facOf(engine, P2), id("sac"), id("cann")), "Cannoneer is in hand");
  assert.equal(zoneOf(engine, id("sac")), "play");
});

// =============================================================================
// Vicious Bruiser -- [R][R][R][R][R][R]: This card gains 2 strength and 4 life.
// printed 4 / 3 / 2 (strength / speed / life)
// =============================================================================

function bruBoard(extra: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bru", def: printing(BRUISER), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 4, life: 2, speed: 3 }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}
const stats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "speed"), engine.getStat(cardId, "life")];

clause(BRUISER, "0:rule@rrrrrr", "with six [R] it gains exactly 2 strength and 4 life (6 / 3 / 6), speed unchanged", () => {
  const { engine, id } = bruBoard(bank("rage", 6, P1));
  assert.deepEqual(stats(engine, id("bru")), [6, 3, 6]);
});

clause(BRUISER, "0:rule@rrrrrr", "with five [R] (one short) it has its printed 4 / 3 / 2", () => {
  const { engine, id } = bruBoard(bank("rage", 5, P1));
  assert.deepEqual(stats(engine, id("bru")), [4, 3, 2]);
});

clause(BRUISER, "0:rule@rrrrrr", "with no resources at all it has its printed 4 / 3 / 2", () => {
  const { engine, id } = bruBoard([]);
  assert.deepEqual(stats(engine, id("bru")), [4, 3, 2]);
});

clause(BRUISER, "0:rule@rrrrrr", "more than six [R] does not stack the bonus (seven or twelve still 6 / 3 / 6)", () => {
  const seven = bruBoard(bank("rage", 7, P1));
  assert.deepEqual(stats(seven.engine, seven.id("bru")), [6, 3, 6]);
  const twelve = bruBoard(bank("rage", 12, P1));
  assert.deepEqual(stats(twelve.engine, twelve.id("bru")), [6, 3, 6]);
});

clause(BRUISER, "0:rule@rrrrrr", "the threshold needs six of [R] specifically: six of any other icon, or five [R] plus one other, does not count", () => {
  for (const icon of ["greed", "deception", "elitism", "obsession"] as const) {
    const g = bruBoard(bank(icon, 6, P1));
    assert.deepEqual(stats(g.engine, g.id("bru")), [4, 3, 2], `six ${icon}`);
  }
  const mixed = bruBoard([...bank("rage", 5, P1), ...bank("greed", 1, P1)]);
  assert.deepEqual(stats(mixed.engine, mixed.id("bru")), [4, 3, 2], "5 rage + 1 greed");
  const vol = bruBoard([...bank("rage", 5, P1), ...volition(1, P1)]);
  assert.deepEqual(stats(vol.engine, vol.id("bru")), [4, 3, 2], "5 rage + 1 volition");
  const ok = bruBoard([...bank("rage", 6, P1), ...bank("greed", 3, P1)]);
  assert.deepEqual(stats(ok.engine, ok.id("bru")), [6, 3, 6], "six rage among other resources");
});

clause(BRUISER, "0:rule@rrrrrr", "face-down Rage cards provide Volition, not [R]: they do not count toward the six", () => {
  const faceDown = [1, 2, 3].map((n) => ({ key: `fd${n}`, def: printing(RAGE), owner: P1, zone: "play" as const, faceDown: true }));
  const g = bruBoard([...bank("rage", 4, P1), ...faceDown.slice(0, 2)]);
  assert.deepEqual(stats(g.engine, g.id("bru")), [4, 3, 2], "4 face-up + 2 face-down Rage");
  const h = bruBoard([...bank("rage", 6, P1), ...faceDown]);
  assert.deepEqual(stats(h.engine, h.id("bru")), [6, 3, 6], "six face-up still counts");
});

clause(BRUISER, "0:rule@rrrrrr", "spent (attached) resources still provide their icon toward the threshold", () => {
  const spent = bank("rage", 6, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = bruBoard(spent);
  assert.equal(readyCount(g.engine, P1), 0);
  assert.deepEqual(stats(g.engine, g.id("bru")), [6, 3, 6]);
});

clause(BRUISER, "0:rule@rrrrrr", "only MY resources count: the opponent's six [R] do not buff my Bruiser, and my six do not buff theirs", () => {
  const g = bruBoard([...bank("rage", 5, P1), ...bank("rage", 6, P2)]);
  assert.deepEqual(stats(g.engine, g.id("bru")), [4, 3, 2]);
  const h = bruBoard([...bank("rage", 6, P1), { key: "obru", def: printing(BRUISER), owner: P2, zone: "play" }]);
  assert.deepEqual(stats(h.engine, h.id("obru")), [4, 3, 2], "the opponent's Bruiser with my resources only");
  assert.deepEqual(stats(h.engine, h.id("bru")), [6, 3, 6]);
});

clause(BRUISER, "0:rule@rrrrrr", "the bonus is on this card only: another character of mine stays at its stats with six [R]", () => {
  const g = bruBoard(bank("rage", 6, P1));
  assert.deepEqual(stats(g.engine, g.id("other")), [4, 3, 2]);
});

clause(BRUISER, "0:rule@rrrrrr", "it turns on when the sixth [R] arrives, and is off again below six", () => {
  const g = bruBoard([...bank("rage", 5, P1), { key: "hr", def: printing(RAGE), owner: P1, zone: "hand" }]);
  assert.deepEqual(stats(g.engine, g.id("bru")), [4, 3, 2]);
  developResource(g.engine, P1, g.id("hr"), false);
  assert.deepEqual(stats(g.engine, g.id("bru")), [6, 3, 6], "sixth Rage played");
  const h = bruBoard([...bank("rage", 5, P1), { key: "hr", def: printing(RAGE), owner: P1, zone: "hand" }]);
  developResource(h.engine, P1, h.id("hr"), true);
  assert.deepEqual(stats(h.engine, h.id("bru")), [4, 3, 2], "the sixth card face-down is Volition, not [R]");
});

clause(BRUISER, "0:rule@rrrrrr", "the extra life is real: damage that would kill the printed 2 life leaves it alive with six [R] but not with five", () => {
  const withSix = bruBoard([...bank("rage", 6, P1), { key: "dmg", def: character({ name: "Dmg" }), owner: P2, zone: "play" }]);
  withSix.engine.state.cards[withSix.id("bru")].damage = 5;
  assert.equal(withSix.engine.getStat(withSix.id("bru"), "life"), 6);
  assert.ok(withSix.engine.state.cards[withSix.id("bru")].damage < withSix.engine.getStat(withSix.id("bru"), "life"), "5 damage is survivable at 6 life");
  const five = bruBoard(bank("rage", 5, P1));
  assert.equal(five.engine.getStat(five.id("bru"), "life"), 2, "at 5 [R] 5 damage would be lethal");
});

// =============================================================================
// The Tournament Faction
// =============================================================================

const STAPLE_RAGE = printing(RAGE);
const STAPLE_GREED = printing(GREED);
const STAPLE_DECEPTION = printing(DECEPTION);
const STAPLE_ELITISM = printing(ELITISM);
const STAPLE_OBSESSION = printing(OBSESSION);
const ODD_RESOURCE = resourceCard({ id: "hh09p1-odd-resource", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "hh09p1-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

const PLAIN_OPP = factionCard({
  id: "hh09p1-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)];
const tournamentSeat = (deck?: CardDefinition[]) => ({ faction: printing(TOURNAMENT), deck: deck ?? [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)] });

const handSize = (engine: SpoilsEngine, player: Player): number => engine.state.players[player].hand.length;
const playCards = (engine: SpoilsEngine, player: Player): string[] => engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: string[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();

// --- STARTING RESOURCES: "Any 2 staple resources."

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "starts with exactly 2 staple resources in play, face-up, and no other starting cards", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, FILLER, STAPLE_GREED, STAPLE_RAGE, STAPLE_DECEPTION, STAPLE_ELITISM, STAPLE_OBSESSION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const cardId of mine) {
    assert.ok(["Rage", "Greed", "Deception", "Elitism", "Obsession"].includes(engine.getDefinition(cardId).name), `${engine.getDefinition(cardId).name} is a staple`);
    assert.equal(engine.state.cards[cardId].faceDown, false, "flipped face-up after setup");
  }
  const total = Object.values(engine.getThresholds(P1)).reduce((sum: number, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
  assert.equal(readyCount(engine, P1), 2, "both are resources I can pay with");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "a resource that is not a staple is never taken as a starting resource, even when it is first in the deck", () => {
  const engine = setupGame(tournamentSeat([ODD_RESOURCE, ODD_RESOURCE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the two staples may be of the same kind ('any 2', not 'different')", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the starting resources come out of my deck (they are not extra cards)", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.equal(engine.state.players[P1].deck.length, 42 - 2 - 8);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources, not mine", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "'Any': with the choose-starting-resources step on, I pick which 2 staples, from the staples in MY deck only", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_DECEPTION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "I am offered the choice");
  assert.equal(choice.count, 2);
  const deckStaples = engine.state.players[P1].deck.filter((cardId) => ["Rage", "Greed", "Deception"].includes(engine.getDefinition(cardId).name));
  assert.deepEqual([...choice.candidateCardIds].sort(), [...deckStaples].sort(), "exactly the 7 staples in my deck");
  const picked = [choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Deception")!, choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Greed")!];
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: picked });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Greed"], "exactly the staples I picked are in play");
  for (const cardId of picked) assert.equal(engine.state.cards[cardId].faceDown, false);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "I may pick two of the same kind", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { choose: true });
  const greeds = engine.getStartingResourceChoice(P1)!.candidateCardIds.filter((c) => engine.getDefinition(c).name === "Greed");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"]);
  assert.equal(engine.getThresholds(P1).greed, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staples from my deck: not 1, not 3, not a non-staple, not a character, not the same card twice", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [s1, s2, s3] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  const filler = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Filler")!;
  const choose = (cardIds: string[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  assert.throws(choose([s1]), "one is too few");
  assert.throws(choose([s1, s2, s3]), "three is too many");
  assert.throws(choose([s1, odd]), "a non-staple resource");
  assert.throws(choose([s1, filler]), "a character");
  assert.throws(choose([s1, s1]), "the same card twice");
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0, "nothing was put into play");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "I cannot choose the opponent's cards", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] },
    { choose: true }
  );
  const [s1] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const theirs = engine.state.players[P2].deck.find((c) => engine.getDefinition(c).name === "Elitism")!;
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [s1, theirs] }), "the opponent's staple");
  assert.equal(playCards(engine, P1).length, 0);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opening hand is drawn after the starting resources are chosen, so every staple in my deck can be chosen", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(handSize(engine, P1), 0, "nothing is drawn while the choice is pending");
  const candidates = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  assert.equal(candidates.length, 7, "all seven staples I own are still in the deck");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: candidates.slice(0, 2) });
  while (engine.state.setup.phase === "chooseStartingResources") {
    const setup = engine.state.setup as unknown as { order: Player[]; currentIndex: number };
    const seat = setup.order[setup.currentIndex];
    engine.perform({ type: "chooseStartingResources", playerId: seat, cardIds: engine.getStartingResourceChoice(seat)!.candidateCardIds.slice(0, 2) });
  }
  assert.equal(handSize(engine, P1), 8);
});

// --- STARTING DRAW: "8 going first, 9 going second."

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 8 cards going first", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 9 cards going second", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "also applies when the Tournament Faction is the second seat (P2): 8 first, 9 second", () => {
  const goingFirst = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P2 });
  assert.equal(handSize(goingFirst, P2), 8);
  const goingSecond = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P1 });
  assert.equal(handSize(goingSecond, P2), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 first / 8 second)", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "the cards are drawn from my deck and the starting resources are not part of the hand", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  for (const cardId of engine.state.players[P1].hand) assert.notEqual(engine.state.cards[cardId].zone, "play");
  assert.equal(engine.state.players[P1].hand.length + engine.state.players[P1].deck.length + playCards(engine, P1).length, 42, "no card appeared or vanished");
});

// --- RESTORE RULE: "At the start of your turn, restore all your depleted cards and detach all resources from your faction."

const topOfDeck = (label: string, owner: Player): CardPlacement[] =>
  Array.from({ length: 4 }, (_, i) => ({ key: `${label}${i}`, def: character({ name: `${label} ${i}` }), owner, zone: "deck" as const }));

const spentRage = (owner: Player, n: number): CardPlacement[] => bank("rage", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

function restoreBoard(active: Player) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentRage(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1),
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentRage(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}

clause(TOURNAMENT, "2:rule:RESTORE RULE", "at the start of my turn my depleted characters and items are restored", () => {
  const { engine, id } = restoreBoard(P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (the opponent owns it) is mine to restore");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "at the start of my turn every resource is detached from my faction (face-up and face-down), and all my resources are ready", () => {
  const { engine } = restoreBoard(P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  const { engine, id } = restoreBoard(P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "the opponent's resources stay attached");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true);
});

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

function developBoard(active: Player = P1) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may draw a card (the top of my deck)", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may play a resource card face-up from my hand", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1, "it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "I may play any card face-down as a resource (Volition), including an actual resource card", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  const real = developBoard();
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down it no longer provides its Greed");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "'draw a card or play a resource': one OR the other each turn, not both", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(a.engine, a.id("handRes")), "hand");
  const b = developBoard();
  const deckBefore = [...b.engine.state.players[P1].deck];
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(b.engine.state.players[P1].deck, deckBefore);
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it can be used only once per turn", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  const hand = handSize(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(a.engine, P1), hand);
  const b = developBoard();
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(b.engine, b.id("handRes2")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it can be used only on my own turn", () => {
  const { engine, id } = developBoard();
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "it is available again every turn, and skipping it costs nothing", () => {
  const { engine } = developBoard();
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  assert.equal(handSize(engine, P1), hand, "skipping it gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
});

// --- DRAW: "Pay 3. Draw a card."

function abilityBoard(resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function activateFaction(engine: SpoilsEngine, player: Player, abilityId: string, owner: Player = player, selected: Record<string, string[]> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId: factionOf(engine, owner), abilityId, selected, variables: {} } as never);
  resolvePendingResponses(engine);
}

clause(TOURNAMENT, "4:ability:tournament-draw", "pays exactly 3 resources (attached) and draws one card, the top of my deck", () => {
  const { engine, id } = abilityBoard(5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is refused when the 3 cannot be paid (2 resources; 1 ready with 2 spent; none) and nothing is half-paid", () => {
  const two = abilityBoard(2);
  assert.throws(() => activateFaction(two.engine, P1, "tournament-draw"));
  assert.equal(handSize(two.engine, P1), 2);
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  const spentSome = abilityBoard(3, spentRage(P1, 2));
  assert.equal(readyCount(spentSome.engine, P1), 3);
  const tight = abilityBoard(1, spentRage(P1, 2));
  assert.equal(readyCount(tight.engine, P1), 1);
  assert.throws(() => activateFaction(tight.engine, P1, "tournament-draw"), "resources already spent cannot pay again");
  const none = abilityBoard(0);
  assert.throws(() => activateFaction(none.engine, P1, "tournament-draw"));
});

clause(TOURNAMENT, "4:ability:tournament-draw", "works with exactly 3 resources of any icons", () => {
  const { engine, id } = abilityBoard(0, [...bank("greed", 1, P1), ...bank("deception", 1, P1), ...volition(1, P1)]);
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand");
  assert.equal(readyCount(engine, P1), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used again the same turn (no limit is printed)", () => {
  const { engine } = abilityBoard(7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, "tournament-draw");
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(handSize(engine, P1), handBefore + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is separate from the Develop Rule (using one leaves the other available)", () => {
  const a = abilityBoard(3);
  const base = handSize(a.engine, P1);
  activateFaction(a.engine, P1, "tournament-draw");
  assert.ok(developOffers(a.engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(a.engine, P1);
  assert.equal(handSize(a.engine, P1), base + 2);
  const b = abilityBoard(3);
  developDraw(b.engine, P1);
  activateFaction(b.engine, P1, "tournament-draw");
  assert.equal(handSize(b.engine, P1), base + 2);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "only its controller can use it", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...topOfDeck("theirdeck", P2)]
  });
  const theirHand = handSize(engine, P2);
  assert.throws(() => activateFaction(engine, P2, "tournament-draw", P1));
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used in response on the opponent's turn (any time I could use an ability)", () => {
  const { engine, id } = abilityBoard(3, [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }]);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  playRaw(engine, P2, id("noop"));
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  const handBefore = handSize(engine, P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: "tournament-draw", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(handSize(engine, P1), handBefore + 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "with an empty deck the cost is still paid and nothing is drawn; running out of cards does not lose the game", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 3, P1)]
  });
  assert.equal(engine.state.players[P1].deck.length, 0);
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(attachedCount(engine, P1), 3, "the 3 were paid");
  assert.equal(handSize(engine, P1), 0, "there was nothing to draw");
  assert.equal(engine.state.result, undefined, "no one lost");
});

// --- RESOURCE: "Pay 4. Play a resource."

const useResource = (board: ReturnType<typeof abilityBoard>, cardKey: string, player: Player = P1) =>
  activateFaction(board.engine, player, "tournament-resource", player, { resource: [board.id(cardKey)] });

clause(TOURNAMENT, "5:ability:tournament-resource", "pays exactly 4 resources and plays a resource card from my hand face-up, providing its icon", () => {
  const board = abilityBoard(6);
  const { engine, id } = board;
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  useResource(board, "handRes");
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "any card can be played as a resource: a non-resource goes in face-down (Volition)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handChar");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "'Play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2)", () => holdResourceFace(() => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handRes");
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(TOURNAMENT, "5:ability:tournament-resource", "the card must come from my own hand (not the opponent's hand, not my deck, not a card in play)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  for (const key of ["theirHand", "mydeck0"]) assert.throws(() => useResource(board, key), key);
  assert.throws(() => activateFaction(engine, P1, "tournament-resource", P1, { resource: [factionOf(engine, P1)] }), "my faction");
  assert.throws(() => activateFaction(engine, P1, "tournament-resource", P1, {}), "no card chosen");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid for a refused play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "exactly one resource: two cards chosen are refused", () => {
  const board = abilityBoard(4);
  assert.throws(() => activateFaction(board.engine, P1, "tournament-resource", P1, { resource: [board.id("handRes"), board.id("handChar")] }));
  assert.equal(zoneOf(board.engine, board.id("handRes")), "hand");
  assert.equal(attachedCount(board.engine, P1), 0);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is refused when the 4 cannot be paid (3 resources, none, or 3 ready with 3 spent), and no resource is played", () => {
  const three = abilityBoard(3);
  assert.throws(() => useResource(three, "handRes"));
  assert.equal(pending(three.engine), undefined);
  assert.equal(zoneOf(three.engine, three.id("handRes")), "hand");
  assert.equal(attachedCount(three.engine, P1), 0);
  const none = abilityBoard(0);
  assert.throws(() => useResource(none, "handRes"));
  const tight = abilityBoard(3, spentRage(P1, 3));
  assert.throws(() => useResource(tight, "handRes"), "spent resources cannot pay");
  const exact = abilityBoard(4);
  useResource(exact, "handRes");
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "exactly 4 is enough");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "can be used again the same turn (no limit is printed)", () => {
  const board = abilityBoard(8);
  const { engine, id } = board;
  useResource(board, "handRes");
  useResource(board, "handChar");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is separate from the Develop Rule (a resource played by the ability leaves the Develop Rule available)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handRes");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 8, P2), { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
  });
  assert.throws(() => activateFaction(engine, P2, "tournament-resource", P1, { resource: [id("theirHand")] }));
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
});
