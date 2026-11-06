// Clause tests — batch holy-heist-03, part p3 (groups 11-17, missing clauses only). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-03 --groups 11-17 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { fight, fightThrough, playRaw } from "./_battle.js";
import { developResource, endTurn, factionOf } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

/** A plain character placement with an exact printed cost. */
const ch = (
  key: string,
  owner: PlayerId,
  cost: number,
  zone: CardPlacement["zone"] = "play",
  extra: Partial<CardPlacement> = {}
): CardPlacement => ({ key, def: character({ name: key, cost }), owner, zone, ...extra });

const discardOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => engine.state.players[p].discard;

// ============================================================================
// Mass Subjugation — tactic, cost 5, [G]
// ============================================================================
const MS = "8cf97959-4bda-43f0-b1c5-e2661c814c8c";

function msBoard(
  o: { greed?: number; rage?: number; oppGreed?: number; active?: PlayerId; extra?: CardPlacement[]; faceDown?: boolean } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      o.faceDown
        ? { key: "ms", def: printing(MS), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "ms", def: printing(MS), owner: P1, zone: "hand" as const },
      ...bank("greed", o.greed ?? 5, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.oppGreed ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}
type MsGame = ReturnType<typeof msBoard>;

const flipMs = (g: MsGame) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("ms"), selected: {}, variables: {} });

/** Opponent's turn: P2 has deployed a tactic, so P1 holds priority in the response window. P1 also holds a free bounce tactic ("ctl"). */
function msOppTurn(o: { faceDown?: boolean; greed?: number } = {}) {
  const g = msBoard({
    active: P2,
    faceDown: o.faceDown,
    greed: o.greed ?? 5,
    extra: [
      { key: "oppk", def: killTactic({ name: "Opp Kill" }), owner: P2, zone: "hand" },
      ch("dummy", P2, 4),
      ch("c2", P2, 2),
      { key: "ctl", def: bounceTactic({ name: "Control Bounce" }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(g.engine, P2, g.id("oppk"), { selected: { t: [g.id("dummy")] } });
  return g;
}

/** My turn: P1 has declared an attack, so a battle is active and P1 holds priority. P1 also holds a free bounce tactic ("ctl"). */
function msInBattle(o: { faceDown?: boolean; greed?: number } = {}) {
  const g = msBoard({
    faceDown: o.faceDown,
    greed: o.greed ?? 5,
    extra: [
      ch("atk", P1, 4),
      ch("c2", P2, 2),
      { key: "ctl", def: bounceTactic({ name: "Control Bounce" }), owner: P1, zone: "hand" }
    ]
  });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(g.engine.state.battle, "a battle is active");
  return g;
}

clause(MS, "0:extraCost", "on my own turn, outside a battle, it can be deployed (and resolves)", () => {
  const g = msBoard({ extra: [ch("c2", P2, 2)] });
  assert.equal(g.engine.state.battle, undefined);
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MS, "0:extraCost", "it cannot be deployed on the opponent's turn, even in a response window where I hold priority", () => {
  const control = msOppTurn();
  playRaw(control.engine, P1, control.id("ctl"), { selected: { t: [control.id("c2")] } });
  assert.equal(zoneOf(control.engine, control.id("ctl")) === "hand", false, "control: a plain tactic IS deployable in that window");

  const g = msOppTurn();
  refused(() => playRaw(g.engine, P1, g.id("ms")), "Mass Subjugation on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand", "still in hand");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play", "nothing was destroyed");
});

clause(MS, "0:extraCost", "it cannot be deployed during a battle on my own turn", () => {
  const control = msInBattle();
  playRaw(control.engine, P1, control.id("ctl"), { selected: { t: [control.id("c2")] } });
  assert.notEqual(zoneOf(control.engine, control.id("ctl")), "hand", "control: a plain tactic IS deployable during the battle");

  const g = msInBattle();
  refused(() => playRaw(g.engine, P1, g.id("ms")), "Mass Subjugation during a battle");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand", "still in hand");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(MS, "0:extraCost", "once the battle is over, it can be deployed again on my turn", () => {
  const g = msBoard({ extra: [ch("atk", P1, 4), ch("c2", P2, 2)] });
  fight(g.engine, P1, [g.id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("atk")), "play", "the cost-4 attacker survives");
});

clause(MS, "0:extraCost", "the restriction is deploy-timing only: it cannot be deployed on the opponent's turn, but my own turn is fine with the same resources", () => {
  const g = msBoard({ active: P2, extra: [ch("c2", P2, 2)] });
  refused(() => play(g.engine, P1, g.id("ms"), {}), "Mass Subjugation outside my turn");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
  assert.equal(readyResources(g.engine, P1), 5);
});

// --- printed cost 5 and threshold [G] (no separate clause: asserted with the rule) ----
clause(MS, "1:rule", "costs exactly 5: five [G] resources are all spent", () => {
  const g = msBoard({ greed: 5 });
  assert.equal(readyResources(g.engine, P1), 5);
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(readyResources(g.engine, P1), 0);
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MS, "1:rule", "cannot be deployed one resource short of its cost 5", () => {
  const g = msBoard({ greed: 4, extra: [ch("c2", P2, 2)] });
  refused(() => play(g.engine, P1, g.id("ms"), {}), "4 resources for a cost-5 tactic");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
  assert.equal(readyResources(g.engine, P1), 4, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(MS, "1:rule", "needs a [G] to deploy: five Rage resources are enough resources but not the threshold", () => {
  const g = msBoard({ greed: 0, rage: 5, extra: [ch("c2", P2, 2)] });
  refused(() => play(g.engine, P1, g.id("ms"), {}), "no [G] threshold");
  assert.equal(readyResources(g.engine, P1), 5);
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
});

clause(MS, "1:rule", "a single [G] among the resources meets the threshold (4 Rage + 1 Greed)", () => {
  const g = msBoard({ greed: 1, rage: 4, extra: [ch("c2", P2, 2)] });
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(MS, "1:rule", "the opponent's [G] do not meet the threshold", () => {
  const g = msBoard({ greed: 0, rage: 5, oppGreed: 3, extra: [ch("c2", P2, 2)] });
  refused(() => play(g.engine, P1, g.id("ms"), {}), "only the opponent has [G]");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
});

// --- the rule ----------------------------------------------------------------
clause(MS, "1:rule", "destroys EACH character of numeric cost 1, 2 and 3 (both players') and no others (cost 0, 4, 5 survive)", () => {
  const cards: CardPlacement[] = [];
  for (const c of [0, 1, 2, 3, 4, 5]) {
    cards.push(ch(`a${c}`, P1, c), ch(`b${c}`, P2, c));
  }
  const g = msBoard({ extra: cards });
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const c of [1, 2, 3]) {
    assert.equal(zoneOf(g.engine, g.id(`a${c}`)), "discard", `my cost-${c} character is destroyed`);
    assert.equal(zoneOf(g.engine, g.id(`b${c}`)), "discard", `the opponent's cost-${c} character is destroyed`);
    assert.ok(discardOf(g.engine, P1).includes(g.id(`a${c}`)), `a${c} is in its owner's discard pile`);
    assert.ok(discardOf(g.engine, P2).includes(g.id(`b${c}`)), `b${c} is in its owner's discard pile`);
  }
  for (const c of [0, 4, 5]) {
    assert.equal(zoneOf(g.engine, g.id(`a${c}`)), "play", `my cost-${c} character survives`);
    assert.equal(zoneOf(g.engine, g.id(`b${c}`)), "play", `the opponent's cost-${c} character survives`);
  }
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard", "the tactic itself is discarded after resolving");
});

clause(MS, "1:rule", "only CHARACTERS are destroyed: a cost-2 item and a cost-3 location in play survive", () => {
  const g = msBoard({
    extra: [
      { key: "itm", def: item({ name: "Gear", cost: 2 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place", cost: 3 }), owner: P2, zone: "play" },
      { key: "myitm", def: item({ name: "My Gear", cost: 1 }), owner: P1, zone: "play" },
      ch("c2", P2, 2)
    ]
  });
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard", "positive control: the character died");
  assert.equal(zoneOf(g.engine, g.id("itm")), "play");
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(zoneOf(g.engine, g.id("myitm")), "play");
  assert.equal(g.engine.state.cards[g.id("loc")].damage, 0);
});

clause(MS, "1:rule", "only characters IN PLAY are destroyed: cost 1-3 characters in hand, deck or discard pile stay where they are", () => {
  const g = msBoard({
    extra: [
      ch("h", P1, 2, "hand"),
      ch("oh", P2, 1, "hand"),
      ch("d", P2, 2, "deck"),
      ch("g", P1, 3, "discard"),
      ch("og", P2, 3, "discard"),
      ch("c2", P2, 2)
    ]
  });
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard", "positive control");
  assert.equal(zoneOf(g.engine, g.id("h")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oh")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d")), "deck");
  assert.equal(zoneOf(g.engine, g.id("g")), "discard");
  assert.equal(zoneOf(g.engine, g.id("og")), "discard");
});

clause(MS, "1:rule", "a face-down card is a resource, not a character: a face-down cost-2 character card is not destroyed", () => {
  const g = msBoard({
    extra: [
      ch("fd", P2, 2, "play", { faceDown: true }),
      ch("fdMine", P1, 3, "play", { faceDown: true }),
      ch("c2", P2, 2)
    ]
  });
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard", "positive control");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
  assert.equal(zoneOf(g.engine, g.id("fdMine")), "play");
});

clause(MS, "1:rule", "with no characters in play it still resolves: nothing happens and the tactic is discarded", () => {
  const g = msBoard({});
  play(g.engine, P1, g.id("ms"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MS, "1:rule", "destroys a damaged or depleted cost-1-3 character as well (no state saves it)", () => {
  const g = msBoard({ extra: [ch("dmg", P2, 3, "play", { damage: 1 }), ch("dep", P2, 1, "play", { depleted: true }), ch("mine", P1, 2, "play", { depleted: true })] });
  play(g.engine, P1, g.id("ms"), {});
  for (const k of ["dmg", "dep", "mine"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
});

// --- FLIP UP: 3 [G][G][G] ------------------------------------------------------
clause(MS, "2:flipUp", "a face-down Mass Subjugation flips up for 3 (not its normal 5) and resolves its rule", () => {
  const g = msBoard({ faceDown: true, greed: 4, extra: [ch("c1", P2, 1), ch("c3", P1, 3), ch("c4", P2, 4), ch("c0", P1, 0)] });
  assert.equal(readyResources(g.engine, P1), 5, "4 banks and the face-down tactic");
  flipMs(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(g.engine, P1), 1, "5 - 3 paid - 1 (the card stopped being a resource)");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c3")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c4")), "play");
  assert.equal(zoneOf(g.engine, g.id("c0")), "play");
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard", "the flipped-up tactic is discarded after resolving");
});

clause(MS, "2:flipUp", "with exactly three [G] banks, all three are spent", () => {
  const g = msBoard({ faceDown: true, greed: 3, extra: [ch("c2", P2, 2)] });
  flipMs(g);
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(MS, "2:flipUp", "needs three [G]: two [G] banks plus a Rage bank is not [G][G][G]", () => {
  const g = msBoard({ faceDown: true, greed: 2, rage: 1, extra: [ch("c2", P2, 2)] });
  refused(() => flipMs(g), "only two [G]");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true, "still face-down");
  assert.equal(zoneOf(g.engine, g.id("ms")), "play");
  assert.equal(readyResources(g.engine, P1), 4, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(MS, "2:flipUp", "refused when short of resources: two [G] banks plus the card itself are 3 resources but only [G][G]", () => {
  const g = msBoard({ faceDown: true, greed: 2, extra: [ch("c2", P2, 2)] });
  refused(() => flipMs(g), "2 banks");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true);
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(MS, "2:flipUp", "needs [G], not just 3 resources: five Rage banks are refused", () => {
  const g = msBoard({ faceDown: true, greed: 0, rage: 5, extra: [ch("c2", P2, 2)] });
  refused(() => flipMs(g), "no [G]");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true);
  assert.equal(readyResources(g.engine, P1), 6);
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(MS, "2:flipUp", "the opponent's [G] do not count toward [G][G][G]", () => {
  const g = msBoard({ faceDown: true, greed: 0, rage: 3, oppGreed: 3, extra: [ch("c2", P2, 2)] });
  refused(() => flipMs(g), "only the opponent has [G]");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true);
});

clause(MS, "2:flipUp", "a face-down tactic's own Volition does not provide [G]", () => {
  const g = msBoard({ faceDown: true, greed: 2, extra: [...volition(2, P1), ch("c2", P2, 2)] });
  refused(() => flipMs(g), "[G][G] + Volition");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true);
});

clause(MS, "2:flipUp", "the EXTRA COST still applies to a FLIP UP: refused on the opponent's turn", () => {
  const control = msOppTurn({ faceDown: true, greed: 4 });
  playRaw(control.engine, P1, control.id("ctl"), { selected: { t: [control.id("c2")] } });
  assert.notEqual(zoneOf(control.engine, control.id("ctl")), "hand", "control: a plain tactic IS deployable in that window");

  const g = msOppTurn({ faceDown: true, greed: 4 });
  refused(() => flipMs(g), "FLIP UP on the opponent's turn");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true, "still face-down");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(MS, "2:flipUp", "the EXTRA COST still applies to a FLIP UP: refused during a battle on my turn", () => {
  const control = msInBattle({ faceDown: true, greed: 4 });
  playRaw(control.engine, P1, control.id("ctl"), { selected: { t: [control.id("c2")] } });
  assert.notEqual(zoneOf(control.engine, control.id("ctl")), "hand", "control: a plain tactic IS deployable during the battle");

  const g = msInBattle({ faceDown: true, greed: 4 });
  refused(() => flipMs(g), "FLIP UP during a battle");
  assert.equal(g.engine.state.cards[g.id("ms")].faceDown, true, "still face-down");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

// ============================================================================
// Motivational Dancer — character, cost 3, [G][G][G], 2 str / 3 spd / 1 life
// ============================================================================
const MD = "140683e9-c454-48cd-9230-647becd02e66";

function mdBoard(o: { res?: number; influence?: number; extra?: CardPlacement[]; active?: PlayerId; mdDepleted?: boolean } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: o.influence !== undefined ? { faction: developFaction(), influence: o.influence } : { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "md", def: printing(MD), owner: P1, zone: "play", depleted: o.mdDepleted },
      ...bank("greed", o.res ?? 6, P1),
      ...(o.extra ?? [])
    ]
  });
}
type MdGame = ReturnType<typeof mdBoard>;

const dep = (g: MdGame, key: string) => g.engine.state.cards[g.id(key)].depleted;
const dancePick = (g: MdGame, key: string, ability = "motiv-dancer-private") =>
  activate(g.engine, P1, g.id("md"), ability, { selected: { c: [g.id(key)] } });

// --- PRIVATE DANCE -------------------------------------------------------------
clause(MD, "1:ability:motiv-dancer-private", "COST: pays 1 and depletes the Dancer; EFFECT: depletes the picked character (and nothing else)", () => {
  const g = mdBoard({ extra: [ch("t", P2, 2), ch("bystander", P2, 2)] });
  assert.equal(readyResources(g.engine, P1), 6);
  dancePick(g, "t");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(g.engine, P1), 5, "paid exactly 1");
  assert.equal(dep(g, "md"), true, "the Dancer is depleted (cost)");
  assert.equal(dep(g, "t"), true, "the picked character is depleted");
  assert.equal(dep(g, "bystander"), false, "other characters are untouched");
  assert.equal(g.engine.state.cards[g.id("t")].damage, 0, "PRIVATE DANCE deals no damage");
});

clause(MD, "1:ability:motiv-dancer-private", "can pick one of my own characters", () => {
  const g = mdBoard({ extra: [ch("mine", P1, 2)] });
  dancePick(g, "mine");
  assert.equal(dep(g, "mine"), true);
  assert.equal(dep(g, "md"), true);
  assert.equal(readyResources(g.engine, P1), 5);
});

clause(MD, "1:ability:motiv-dancer-private", "can pick the Dancer itself (the deplete is a cost, the pick is any character)", () => {
  const g = mdBoard({});
  dancePick(g, "md");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(dep(g, "md"), true);
  assert.equal(readyResources(g.engine, P1), 5);
});

clause(MD, "1:ability:motiv-dancer-private", "an already-depleted character can be picked; it stays depleted and the cost is still paid", () => {
  const g = mdBoard({ extra: [ch("t", P2, 2, "play", { depleted: true })] });
  dancePick(g, "t");
  assert.equal(dep(g, "t"), true);
  assert.equal(dep(g, "md"), true);
  assert.equal(readyResources(g.engine, P1), 5);
});

clause(MD, "1:ability:motiv-dancer-private", "the pick must be a character in play: items, locations, factions and characters in hand or discard are refused", () => {
  const g = mdBoard({
    extra: [
      { key: "itm", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ch("inHand", P2, 2, "hand"),
      ch("inDiscard", P2, 2, "discard"),
      ch("ok", P2, 2)
    ]
  });
  for (const bad of [g.id("itm"), g.id("loc"), g.id("inHand"), g.id("inDiscard"), factionOf(g.engine, P2)]) {
    refused(() => activate(g.engine, P1, g.id("md"), "motiv-dancer-private", { selected: { c: [bad] } }), `picking ${bad}`);
  }
  assert.equal(dep(g, "md"), false, "nothing was paid by the refused attempts");
  assert.equal(readyResources(g.engine, P1), 6);
  dancePick(g, "ok");
  assert.equal(dep(g, "ok"), true, "positive control");
});

clause(MD, "1:ability:motiv-dancer-private", "refused while the Dancer is depleted (it cannot pay 'Deplete this card')", () => {
  const g = mdBoard({ mdDepleted: true, extra: [ch("t", P2, 2)] });
  refused(() => dancePick(g, "t"), "depleted Dancer");
  assert.equal(dep(g, "t"), false);
  assert.equal(readyResources(g.engine, P1), 6);
  const control = mdBoard({ extra: [ch("t", P2, 2)] });
  dancePick(control, "t");
  assert.equal(dep(control, "t"), true, "control: a ready Dancer can");
});

clause(MD, "1:ability:motiv-dancer-private", "refused with no resource to pay 1", () => {
  const g = mdBoard({ res: 0, extra: [ch("t", P2, 2)] });
  refused(() => dancePick(g, "t"), "no resources");
  assert.equal(dep(g, "t"), false);
  assert.equal(dep(g, "md"), false, "the Dancer was not depleted either");
  const control = mdBoard({ res: 1, extra: [ch("t", P2, 2)] });
  dancePick(control, "t");
  assert.equal(dep(control, "t"), true, "control: one resource is enough");
  assert.equal(readyResources(control.engine, P1), 0);
});

// --- PAY UP --------------------------------------------------------------------
clause(MD, "2:ability:motiv-dancer-payup", "COST: pays 1, 1 damage to MY faction, depletes the Dancer; EFFECT: exactly 1 damage to the picked depleted character", () => {
  const g = mdBoard({ influence: 10, extra: [ch("t", P2, 2, "play", { depleted: true }), ch("bystander", P2, 2, "play", { depleted: true })] });
  const oppInfluence = g.engine.state.players[P2].influence;
  dancePick(g, "t", "motiv-dancer-payup");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(g.engine, P1), 5, "paid exactly 1");
  assert.equal(g.engine.state.players[P1].influence, 9, "my faction took exactly 1 damage");
  assert.equal(g.engine.state.players[P2].influence, oppInfluence, "the opponent's faction is untouched");
  assert.equal(dep(g, "md"), true, "the Dancer is depleted (cost)");
  assert.equal(g.engine.state.cards[g.id("t")].damage, 1, "exactly 1 damage on the target");
  assert.equal(zoneOf(g.engine, g.id("t")), "play", "a life-3 character survives 1 damage");
  assert.equal(g.engine.state.cards[g.id("bystander")].damage, 0, "other characters take nothing");
});

clause(MD, "2:ability:motiv-dancer-payup", "1 damage kills a 1-life character", () => {
  const g = mdBoard({ extra: [{ key: "t", def: character({ name: "T", cost: 2, life: 1 }), owner: P2, zone: "play", depleted: true }] });
  dancePick(g, "t", "motiv-dancer-payup");
  assert.equal(zoneOf(g.engine, g.id("t")), "discard");
});

clause(MD, "2:ability:motiv-dancer-payup", "can pick one of my own depleted characters", () => {
  const g = mdBoard({ extra: [ch("mine", P1, 2, "play", { depleted: true })] });
  dancePick(g, "mine", "motiv-dancer-payup");
  assert.equal(g.engine.state.cards[g.id("mine")].damage, 1);
  assert.equal(dep(g, "md"), true);
});

clause(MD, "2:ability:motiv-dancer-payup", "the pick must be DEPLETED: a ready character is refused (and nothing is paid)", () => {
  const g = mdBoard({ influence: 10, extra: [ch("ready", P2, 2), ch("tapped", P2, 2, "play", { depleted: true })] });
  refused(() => dancePick(g, "ready", "motiv-dancer-payup"), "a ready character");
  assert.equal(readyResources(g.engine, P1), 6, "nothing was paid");
  assert.equal(g.engine.state.players[P1].influence, 10, "no damage to my faction");
  assert.equal(dep(g, "md"), false);
  assert.equal(g.engine.state.cards[g.id("ready")].damage, 0);
  dancePick(g, "tapped", "motiv-dancer-payup");
  assert.equal(g.engine.state.cards[g.id("tapped")].damage, 1, "control: a depleted one is fine");
});

clause(MD, "2:ability:motiv-dancer-payup", "the pick must be a character in play: depleted items, locations, factions and characters in hand or discard are refused", () => {
  const g = mdBoard({
    extra: [
      { key: "itm", def: item({ name: "Gear" }), owner: P2, zone: "play", depleted: true },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play", depleted: true },
      ch("inHand", P2, 2, "hand", { depleted: true }),
      ch("inDiscard", P2, 2, "discard", { depleted: true }),
      ch("ok", P2, 2, "play", { depleted: true })
    ]
  });
  for (const bad of [g.id("itm"), g.id("loc"), g.id("inHand"), g.id("inDiscard"), factionOf(g.engine, P2)]) {
    refused(() => activate(g.engine, P1, g.id("md"), "motiv-dancer-payup", { selected: { c: [bad] } }), `picking ${bad}`);
  }
  assert.equal(readyResources(g.engine, P1), 6);
  dancePick(g, "ok", "motiv-dancer-payup");
  assert.equal(g.engine.state.cards[g.id("ok")].damage, 1, "positive control");
});

clause(MD, "2:ability:motiv-dancer-payup", "refused while the Dancer is depleted", () => {
  const g = mdBoard({ mdDepleted: true, extra: [ch("t", P2, 2, "play", { depleted: true })] });
  refused(() => dancePick(g, "t", "motiv-dancer-payup"), "depleted Dancer");
  assert.equal(g.engine.state.cards[g.id("t")].damage, 0);
  assert.equal(readyResources(g.engine, P1), 6);
});

clause(MD, "2:ability:motiv-dancer-payup", "refused with no resource to pay 1 (and no faction damage is dealt)", () => {
  const g = mdBoard({ res: 0, influence: 10, extra: [ch("t", P2, 2, "play", { depleted: true })] });
  refused(() => dancePick(g, "t", "motiv-dancer-payup"), "no resources");
  assert.equal(g.engine.state.players[P1].influence, 10);
  assert.equal(g.engine.state.cards[g.id("t")].damage, 0);
  assert.equal(dep(g, "md"), false);
});

clause(MD, "2:ability:motiv-dancer-payup", "the Dancer, depleted by its own cost, is a legal 'depleted character' pick (costs are paid in printed order: Deplete this card, THEN pick)", () => {
  const g = mdBoard({ influence: 10 });
  dancePick(g, "md", "motiv-dancer-payup");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.players[P1].influence, 9);
  assert.equal(readyResources(g.engine, P1), 5);
  assert.equal(zoneOf(g.engine, g.id("md")), "discard", "1 damage destroys the 1-life Dancer");
});

// --- end-of-turn trigger -------------------------------------------------------
/** End P1's turn and pay 1 / pick `key` at the Dancer's trigger; asserts nothing is left pending. */
function eotPick(g: MdGame, key: string) {
  endTurn(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });
  assert.equal(pending(g.engine), undefined);
}
function eotDecline(g: MdGame) {
  endTurn(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
}
function oppPasses(g: MdGame) {
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine), undefined);
}

clause(MD, "0:rule", "at the end of my turn it asks me whether to pay 1; accepting pays exactly 1 and then picks a character to deplete", () => {
  const g = mdBoard({ extra: [ch("oc", P2, 2), ch("bystander", P2, 2)] });
  const before = readyResources(g.engine, P1);
  endTurn(g.engine, P1);
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["mayPay", P1]);
  answerPending(g.engine, "mayPay", { pay: true });
  const pick = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pick.kind, pick.playerId], ["chooserSelectsTarget", P1]);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oc")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(dep(g, "oc"), true, "the picked character is depleted");
  assert.equal(dep(g, "bystander"), false);
  assert.equal(readyResources(g.engine, P1), before - 1, "paid exactly 1");
});

clause(MD, "0:rule", "declining the payment: nothing is paid, nothing is picked or depleted", () => {
  const g = mdBoard({ extra: [ch("oc", P2, 2), ch("mine", P1, 2)] });
  const before = readyResources(g.engine, P1);
  endTurn(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined, "no pick is offered");
  assert.equal(dep(g, "oc"), false);
  assert.equal(dep(g, "mine"), false);
  assert.equal(readyResources(g.engine, P1), before, "nothing was paid");
});

clause(MD, "0:rule", "can pick one of my own characters", () => {
  const g = mdBoard({ extra: [ch("mine", P1, 2)] });
  eotPick(g, "mine");
  assert.equal(dep(g, "mine"), true);
});

clause(MD, "0:rule", "can pick the Dancer itself", () => {
  const g = mdBoard({});
  eotPick(g, "md");
  assert.equal(dep(g, "md"), true);
});

clause(MD, "0:rule", "the pick is any character in play: items, locations, factions and characters in hand or discard are refused; an empty pick is refused (it is mandatory once paid)", () => {
  const g = mdBoard({
    extra: [
      { key: "itm", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ch("inHand", P2, 2, "hand"),
      ch("inDiscard", P2, 2, "discard"),
      ch("ok", P2, 2)
    ]
  });
  endTurn(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  for (const bad of [g.id("itm"), g.id("loc"), g.id("inHand"), g.id("inDiscard"), factionOf(g.engine, P2)]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [bad] }), `picking ${bad}`);
  }
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "an empty pick");
  assert.equal((pending(g.engine) as PendingChoiceLike).kind, "chooserSelectsTarget", "the pick is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ok")] });
  assert.equal(dep(g, "ok"), true, "positive control");
});

clause(MD, "0:rule", "it triggers even when the Dancer itself is depleted", () => {
  const g = mdBoard({ mdDepleted: true, extra: [ch("oc", P2, 2)] });
  eotPick(g, "oc");
  assert.equal(dep(g, "oc"), true);
});

clause(MD, "0:rule", "with no resource to pay 1 nothing can be paid or depleted", () => {
  const g = mdBoard({ res: 0, extra: [ch("oc", P2, 2)] });
  endTurn(g.engine, P1);
  const pc = pending(g.engine) as PendingChoiceLike | undefined;
  if (pc) {
    drain(g.engine, p => (p.kind === "mayPay" ? { kind: "mayPay", pay: true } : { kind: p.kind, selected: [g.id("oc")] }));
  }
  assert.equal(dep(g, "oc"), false, "no payment, no depletion");
});

clause(MD, "0:rule", "does NOT trigger at the end of the opponent's turn", () => {
  const g = mdBoard({ active: P2, extra: [ch("oc", P2, 2)] });
  const before = readyResources(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(dep(g, "oc"), false);
  assert.equal(readyResources(g.engine, P1), before);
});

clause(MD, "0:rule", "the picked opposing character is NOT restored by its controller's next Restore Rule, but is by the one after", () => {
  const g = mdBoard({ extra: [ch("oc", P2, 2), ch("od", P2, 2, "play", { depleted: true })] });
  eotPick(g, "oc");
  // P2's turn has begun: the Restore Rule ran for P2.
  assert.equal(dep(g, "od"), false, "control: another depleted opposing character WAS restored by that Restore Rule");
  assert.equal(dep(g, "oc"), true, "the picked character was not restored");
  oppPasses(g);
  eotDecline(g);
  assert.equal(dep(g, "oc"), false, "restored by the Restore Rule after that");
});

clause(MD, "0:rule", "the picked character of mine is NOT restored by my next Restore Rule, but is by the one after", () => {
  const g = mdBoard({ extra: [ch("mine", P1, 2), ch("mineDep", P1, 2, "play", { depleted: true })] });
  eotPick(g, "mine");
  assert.equal(dep(g, "mine"), true);
  oppPasses(g);
  // P1's turn has begun: my Restore Rule ran.
  assert.equal(dep(g, "mineDep"), false, "control: another depleted character of mine WAS restored");
  assert.equal(dep(g, "mine"), true, "the picked character was not restored");
  eotDecline(g);
  oppPasses(g);
  assert.equal(dep(g, "mine"), false, "restored by my Restore Rule after that");
});

clause(MD, "0:rule", "an already-depleted character that is picked still cannot be restored by its controller's next Restore Rule", () => {
  const g = mdBoard({ extra: [ch("oc", P2, 2, "play", { depleted: true }), ch("od", P2, 2, "play", { depleted: true })] });
  eotPick(g, "oc");
  assert.equal(dep(g, "od"), false, "control: the other depleted character was restored");
  assert.equal(dep(g, "oc"), true, "the picked (already depleted) character was not");
  oppPasses(g);
  eotDecline(g);
  assert.equal(dep(g, "oc"), false);
});

clause(MD, "0:rule", "'its controller's faction': a character I own but the opponent controls stays depleted through the OPPONENT's next Restore Rule", () => {
  const g = mdBoard({ extra: [ch("given", P1, 2, "play", { controller: P2 })] });
  eotPick(g, "given");
  assert.equal(dep(g, "given"), true, "not restored by its controller's (P2's) Restore Rule");
  oppPasses(g);
  eotDecline(g);
  assert.equal(dep(g, "given"), false, "restored by the controller's Restore Rule after that");
});

clause(MD, "0:rule", "'its controller's faction': a character the opponent owns but I control stays depleted through MY next Restore Rule", () => {
  const g = mdBoard({ extra: [ch("stolen", P2, 2, "play", { controller: P1 })] });
  eotPick(g, "stolen");
  oppPasses(g);
  assert.equal(dep(g, "stolen"), true, "not restored by its controller's (P1's) next Restore Rule");
  eotDecline(g);
  oppPasses(g);
  assert.equal(dep(g, "stolen"), false, "restored by my Restore Rule after that");
});

// ============================================================================
// Shared synthetic tactics (they only DRIVE the engine; expectations come from the printed text)
// ============================================================================
/** Free tactic: puts a character from my hand into play under my control (decl `t`). */
const putIntoPlayTactic = () =>
  tactic({
    name: "Put In Play",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
/** Free tactic: adds a token to one character in play (decl `t`). */
const tokenTactic = () =>
  tactic({
    name: "Add Token",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
/** Free tactic: destroys every character in play. */
const destroyAllTactic = () =>
  tactic({
    name: "Destroy All",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          effects: [
            {
              type: "forEach",
              selector: { zone: "play", type: "character" },
              effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
            }
          ]
        }
      ]
    }
  });
/** Free tactic: destroys one item in play (decl `t`). */
const itemKillTactic = () =>
  tactic({
    name: "Break Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "i",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
/** Free tactic: moves one character from my hand to my discard pile (decl `t`). */
const pitchTactic = () =>
  tactic({
    name: "Pitch",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "x",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", owner: "self" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });

// ============================================================================
// Personal God Shrine — location, cost 1, [G], structure 3
// ============================================================================
const PGS = "cec75dc5-9874-4e69-83a3-7557a34aa093";

function pgsBoard(o: { res?: number; shrine?: "play" | "hand" | "discard"; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "pgs", def: printing(PGS), owner: P1, zone: o.shrine ?? "play" },
      { key: "vres", def: character({ name: "Face-down Card", cost: 4 }), owner: P1, zone: "hand" },
      { key: "gres", def: resourceCard({ name: "Greed Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      ...bank("greed", o.res ?? 4, P1),
      ch("d1", P1, 2, "deck"),
      ch("d2", P1, 2, "deck"),
      ch("grave", P1, 2, "discard"),
      { key: "gloc", def: location({ name: "Grave Place", cost: 2 }), owner: P1, zone: "discard" },
      { key: "gitem", def: item({ name: "Grave Gear" }), owner: P1, zone: "discard" },
      { key: "gtac", def: bounceTactic({ name: "Grave Tactic" }), owner: P1, zone: "discard" },
      { key: "gresD", def: resourceCard({ name: "Grave Resource" }), owner: P1, zone: "discard" },
      ch("ograve", P2, 2, "discard"),
      ch("inHand", P1, 2, "hand"),
      ch("inPlay", P1, 2, "play"),
      ...(o.extra ?? [])
    ]
  });
}
type PgsGame = ReturnType<typeof pgsBoard>;

const pgsFaceDown = (g: PgsGame) => {
  developResource(g.engine, P1, g.id("vres"), true);
  resolvePendingResponses(g.engine);
};
/** Brings the shrine to its "pick" prompt: a face-down card enters play and I pay 3. */
const pgsToPick = (g: PgsGame) => {
  pgsFaceDown(g);
  answerPending(g.engine, "mayPay", { pay: true });
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsTarget", P1]);
};
const vProvider = (n: number) =>
  character({ name: `Provides ${n} V`, cost: 0, resource: { provides: Array.from({ length: n }, () => "volition" as const) } });

clause(PGS, "0:rule", "a face-down card (provides [V]) entering play under my control: pay 3, pick a character in my discard pile, it goes on top of my deck", () => {
  const g = pgsBoard();
  const deckBefore = [...g.engine.state.players[P1].deck];
  assert.equal(readyResources(g.engine, P1), 4);
  pgsFaceDown(g);
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["mayPay", P1]);
  answerPending(g.engine, "mayPay", { pay: true });
  const pick = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pick.kind, pick.playerId], ["chooserSelectsTarget", P1]);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("grave")] });
  assert.equal(pending(g.engine), undefined, "exactly one trigger: nothing else is pending");
  assert.equal(readyResources(g.engine, P1), 2, "4 banks + the new face-down resource - 3 paid");
  assert.deepEqual(g.engine.state.players[P1].deck, [g.id("grave"), ...deckBefore], "on TOP of the deck, the rest in order");
  assert.equal(zoneOf(g.engine, g.id("grave")), "deck");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("grave")), "no longer in the discard pile");
});

clause(PGS, "0:rule", "a LOCATION in my discard pile can be picked and goes on top of the deck", () => {
  const g = pgsBoard();
  const deckBefore = [...g.engine.state.players[P1].deck];
  pgsToPick(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("gloc")] });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(g.engine.state.players[P1].deck, [g.id("gloc"), ...deckBefore]);
  assert.equal(zoneOf(g.engine, g.id("gloc")), "deck");
});

clause(PGS, "0:rule", "only a character or location in MY discard pile can be picked: items, tactics, resources, the opponent's discard, and other zones are refused", () => {
  const g = pgsBoard();
  pgsToPick(g);
  for (const bad of ["gitem", "gtac", "gresD", "ograve", "inHand", "inPlay", "d1"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `picking ${bad}`);
  }
  assert.equal((pending(g.engine) as PendingChoiceLike).kind, "chooserSelectsTarget", "the pick is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("grave")] });
  assert.equal(zoneOf(g.engine, g.id("grave")), "deck", "positive control");
  for (const k of ["gitem", "gtac", "gresD", "ograve"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
});

clause(PGS, "0:rule", "it picks ONE card: two cards in one pick are refused", () => {
  const g = pgsBoard();
  pgsToPick(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("grave"), g.id("gloc")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gloc")), "discard");
});

clause(PGS, "0:rule", "'you may pick': after paying I can pick nothing; the 3 is still paid and nothing moves", () => {
  const g = pgsBoard();
  const deckBefore = [...g.engine.state.players[P1].deck];
  pgsToPick(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(readyResources(g.engine, P1), 2, "3 was paid");
  assert.deepEqual(g.engine.state.players[P1].deck, deckBefore);
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
});

clause(PGS, "0:rule", "declining to pay 3: nothing is paid, no pick is offered, nothing moves", () => {
  const g = pgsBoard();
  const deckBefore = [...g.engine.state.players[P1].deck];
  pgsFaceDown(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined, "no pick is offered");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid (4 banks + the new resource)");
  assert.deepEqual(g.engine.state.players[P1].deck, deckBefore);
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
});

clause(PGS, "0:rule", "the new face-down resource can help pay: 2 banks + the new resource is exactly the 3", () => {
  const g = pgsBoard({ res: 2 });
  pgsToPick(g);
  assert.equal(readyResources(g.engine, P1), 0);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("grave")] });
  assert.equal(zoneOf(g.engine, g.id("grave")), "deck");
});

clause(PGS, "0:rule", "with fewer than 3 resources available (1 bank + the new resource) the 3 cannot be paid and nothing moves", () => {
  const g = pgsBoard({ res: 1 });
  const deckBefore = [...g.engine.state.players[P1].deck];
  pgsFaceDown(g);
  if (pending(g.engine)) {
    refused(() => answerPending(g.engine, "mayPay", { pay: true }), "paying 3 with 2 resources");
    answerPending(g.engine, "mayPay", { pay: false });
  }
  assert.equal(pending(g.engine), undefined);
  assert.equal(readyResources(g.engine, P1), 2, "nothing was paid");
  assert.deepEqual(g.engine.state.players[P1].deck, deckBefore);
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
});

clause(PGS, "0:rule", "a card that itself provides [V] (not face-down) entering play also triggers it", () => {
  const g = pgsBoard({ extra: [{ key: "vp", def: vProvider(1), owner: P1, zone: "hand" }] });
  const deckBefore = [...g.engine.state.players[P1].deck];
  play(g.engine, P1, g.id("vp"), {});
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["mayPay", P1]);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("grave")] });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(g.engine.state.players[P1].deck, [g.id("grave"), ...deckBefore]);
  assert.equal(readyResources(g.engine, P1), 1, "4 banks - 3 paid");
});

clause(PGS, "0:rule", "'at least [V]': a card providing [V][V] also triggers it", () => {
  const g = pgsBoard({ extra: [{ key: "vp", def: vProvider(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("vp"), {});
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["mayPay", P1]);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
});

clause(PGS, "0:rule", "does NOT trigger for a card that provides no [V]: a face-up [G] resource, or an ordinary character", () => {
  const g = pgsBoard({ extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("plain"), {});
  assert.equal(pending(g.engine), undefined, "an ordinary character");
  developResource(g.engine, P1, g.id("gres"), false);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined, "a face-up Greed resource");
  assert.equal(g.engine.state.cards[g.id("gres")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("gres")), "play");
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
  const control = pgsBoard();
  pgsFaceDown(control);
  assert.equal((pending(control.engine) as PendingChoiceLike).kind, "mayPay", "control: the face-down resource DOES trigger it");
});

clause(PGS, "0:rule", "does NOT trigger for a [V] card entering play under the OPPONENT's control", () => {
  const g = pgsBoard({ active: P2, extra: [{ key: "ovp", def: vProvider(1), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("ovp"), {});
  assert.equal(zoneOf(g.engine, g.id("ovp")), "play", "it entered play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("grave")), "discard");
});

clause(PGS, "0:rule", "does nothing while the shrine is not in play (in hand or in the discard pile)", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = pgsBoard({ shrine: zone });
    pgsFaceDown(g);
    assert.equal(pending(g.engine), undefined, `shrine in ${zone}`);
  }
});

clause(PGS, "0:rule", "printed cost 1 / [G] / structure 3: deployable for one [G] resource, refused with none or without [G]", () => {
  const g = pgsBoard({ shrine: "hand", res: 1 });
  assert.equal(g.engine.getStat(g.id("pgs"), "structure"), 3);
  play(g.engine, P1, g.id("pgs"), {});
  assert.equal(zoneOf(g.engine, g.id("pgs")), "play");
  assert.equal(readyResources(g.engine, P1), 0);
  assert.equal(g.engine.getStat(g.id("pgs"), "structure"), 3);

  const none = pgsBoard({ shrine: "hand", res: 0 });
  refused(() => play(none.engine, P1, none.id("pgs"), {}), "no resources");
  const rage = pgsBoard({ shrine: "hand", res: 0, extra: bank("rage", 3, P1) });
  refused(() => play(rage.engine, P1, rage.id("pgs"), {}), "no [G]");
  assert.equal(zoneOf(rage.engine, rage.id("pgs")), "hand");
});

// ============================================================================
// President Model #16 — character, cost 5, [G][G], 8 str / 3 spd / 8 life
// ============================================================================
const PM = "b65432a8-bc4e-40d3-9dfa-78dcfb2403b6";

function pmHand(o: { greed: number; rage?: number; obs?: number; oppGreed?: number; vol?: number; extra?: CardPlacement[] }) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pm", def: printing(PM), owner: P1, zone: "hand" },
      ...bank("greed", o.greed, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("obsession", o.obs ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...bank("greed", o.oppGreed ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}
function pmPlay(tokens: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pm", def: printing(PM), owner: P1, zone: "play", counters: { token: tokens } },
      { key: "add", def: tokenTactic(), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "speed"),
  engine.getStat(cardId, "life")
];

clause(PM, "0:rule", "enters play with 9 - X tokens: five [G] (all spent on its cost, still controlled) gives 4 tokens", () => {
  const g = pmHand({ greed: 5 });
  play(g.engine, P1, g.id("pm"), {});
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(tokensOn(g.engine, g.id("pm")), 4);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [4, 3, 4]);
});

clause(PM, "0:rule", "seven [G] gives 2 tokens; nine [G] gives none", () => {
  const seven = pmHand({ greed: 7 });
  play(seven.engine, P1, seven.id("pm"), {});
  assert.equal(tokensOn(seven.engine, seven.id("pm")), 2);
  assert.deepEqual(statsOf(seven.engine, seven.id("pm")), [6, 3, 6]);
  const nine = pmHand({ greed: 9 });
  play(nine.engine, P1, nine.id("pm"), {});
  assert.equal(tokensOn(nine.engine, nine.id("pm")), 0);
  assert.deepEqual(statsOf(nine.engine, nine.id("pm")), [8, 3, 8]);
});

clause(PM, "0:rule", "with more than nine [G] it gets no tokens (never a negative count raising its stats)", () => {
  const g = pmHand({ greed: 12 });
  play(g.engine, P1, g.id("pm"), {});
  assert.equal(tokensOn(g.engine, g.id("pm")), 0);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [8, 3, 8]);
});

clause(PM, "0:rule", "the minimum legal board: two [G] + three Rage gives X = 2, so 7 tokens and a 1 / 3 / 1 character that survives", () => {
  const g = pmHand({ greed: 2, rage: 3 });
  play(g.engine, P1, g.id("pm"), {});
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(tokensOn(g.engine, g.id("pm")), 7);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [1, 3, 1]);
});

clause(PM, "0:rule", "X counts only [G]: Rage, Obsession and face-down Volition resources do not reduce the tokens", () => {
  const g = pmHand({ greed: 5, rage: 3, obs: 2, vol: 2 });
  play(g.engine, P1, g.id("pm"), {});
  assert.equal(tokensOn(g.engine, g.id("pm")), 4);
});

clause(PM, "0:rule", "X counts only [G] I control: the opponent's [G] do not reduce the tokens", () => {
  const g = pmHand({ greed: 5, oppGreed: 6 });
  play(g.engine, P1, g.id("pm"), {});
  assert.equal(tokensOn(g.engine, g.id("pm")), 4);
});

clause(PM, "0:rule", "it enters play with the tokens however it enters (put into play by an effect, nothing paid)", () => {
  const g = pmHand({ greed: 4, extra: [{ key: "put", def: putIntoPlayTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("pm")] } });
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(tokensOn(g.engine, g.id("pm")), 5);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [3, 3, 3]);
});

clause(PM, "0:rule", "printed cost 5 / [G][G]: refused one short, refused without two [G]", () => {
  const short = pmHand({ greed: 4 });
  refused(() => play(short.engine, P1, short.id("pm"), {}), "4 resources");
  assert.equal(zoneOf(short.engine, short.id("pm")), "hand");
  const oneG = pmHand({ greed: 1, rage: 4 });
  refused(() => play(oneG.engine, P1, oneG.id("pm"), {}), "one [G]");
  assert.equal(zoneOf(oneG.engine, oneG.id("pm")), "hand");
  const ok = pmHand({ greed: 2, rage: 3 });
  play(ok.engine, P1, ok.id("pm"), {});
  assert.equal(zoneOf(ok.engine, ok.id("pm")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(PM, "1:rule", "with no tokens it has its printed 8 / 3 / 8", () => {
  const g = pmPlay(0);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [8, 3, 8]);
});

clause(PM, "1:rule", "loses exactly 1 strength and 1 life for each token (speed is unchanged)", () => {
  for (const n of [1, 3, 5, 7]) {
    const g = pmPlay(n);
    assert.deepEqual(statsOf(g.engine, g.id("pm")), [8 - n, 3, 8 - n], `${n} tokens`);
  }
});

clause(PM, "1:rule", "a token added later shrinks it by one more, immediately", () => {
  const g = pmPlay(3);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [5, 3, 5]);
  play(g.engine, P1, g.id("add"), { selected: { t: [g.id("pm")] } });
  assert.equal(tokensOn(g.engine, g.id("pm")), 4);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [4, 3, 4]);
});

clause(PM, "1:rule", "only ITS tokens count: another character's tokens do not shrink it, and its tokens do not shrink another character", () => {
  const g = pmPlay(0, [{ key: "other", def: character({ name: "Other", cost: 1, strength: 4, life: 5 }), owner: P1, zone: "play", counters: { token: 3 } }]);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [8, 3, 8], "tokens on another character do not matter");
  const g2 = pmPlay(5, [{ key: "other", def: character({ name: "Other", cost: 1, strength: 4, life: 5 }), owner: P1, zone: "play" }]);
  assert.deepEqual(statsOf(g2.engine, g2.id("other")), [4, 1, 5], "its tokens do not shrink another character");
});

clause(PM, "1:rule", "a token count that brings its life to 0 destroys it (the eighth token)", () => {
  const g = pmPlay(7);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [1, 3, 1]);
  play(g.engine, P1, g.id("add"), { selected: { t: [g.id("pm")] } });
  assert.equal(zoneOf(g.engine, g.id("pm")), "discard", "8 tokens: life 8 - 8 = 0");
});

function pmCycleBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pm", def: printing(PM), owner: P1, zone: "hand" },
      { key: "put1", def: putIntoPlayTactic(), owner: P1, zone: "hand" },
      { key: "put2", def: putIntoPlayTactic(), owner: P1, zone: "hand" },
      { key: "bn", def: bounceTactic({ name: "Bounce" }), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
}

clause(PM, "0:rule", "put into play by an effect with 4 [G]: 5 tokens; when it leaves play its tokens disappear (CR 409.2)", () => {
  const g = pmCycleBoard();
  play(g.engine, P1, g.id("put1"), { selected: { t: [g.id("pm")] } });
  assert.equal(tokensOn(g.engine, g.id("pm")), 5);
  play(g.engine, P1, g.id("bn"), { selected: { t: [g.id("pm")] } });
  assert.equal(zoneOf(g.engine, g.id("pm")), "hand", "bounced to hand");
  assert.equal(tokensOn(g.engine, g.id("pm")), 0, "its tokens disappeared when it left play");
});

clause(PM, "0:rule", "every entry gets a fresh 9 - X: bounced and put back into play it has 5 tokens again, not 10", () => {
  const g = pmCycleBoard();
  play(g.engine, P1, g.id("put1"), { selected: { t: [g.id("pm")] } });
  play(g.engine, P1, g.id("bn"), { selected: { t: [g.id("pm")] } });
  play(g.engine, P1, g.id("put2"), { selected: { t: [g.id("pm")] } });
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(tokensOn(g.engine, g.id("pm")), 5);
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [3, 3, 3]);
});

// ============================================================================
// Public Defender Intern — character, cost 1, [G][G], 1 str / 3 spd / 1 life
// ============================================================================
const PDI = "44f451d3-23c1-40bd-8a79-095804ee5856";

function pdiBoard(o: { greed?: number; rage?: number; deckN?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pdi", def: printing(PDI), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...Array.from({ length: o.deckN ?? 3 }, (_, i) => ch(`d${i}`, P1, 2, "deck")),
      ...Array.from({ length: 3 }, (_, i) => ch(`od${i}`, P2, 2, "deck")),
      ...(o.extra ?? [])
    ]
  });
}
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;

clause(PDI, "0:rule", "when it enters play I draw exactly one card: the top card of my deck", () => {
  const g = pdiBoard();
  const deck = [...deckOf(g.engine, P1)];
  const oppHand = [...handOf(g.engine, P2)];
  const oppDeck = [...deckOf(g.engine, P2)];
  assert.equal(handOf(g.engine, P1).length, 1, "only the Intern is in hand");
  play(g.engine, P1, g.id("pdi"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pdi")), "play");
  assert.deepEqual(handOf(g.engine, P1), [deck[0]], "the old top card is now my whole hand");
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1), "exactly one card left the deck");
  assert.deepEqual(handOf(g.engine, P2), oppHand, "the opponent drew nothing");
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
});

clause(PDI, "0:rule", "it draws only when THIS card enters play: with an Intern in play, another character entering draws nothing", () => {
  const g = pdiBoard({ extra: [{ key: "pdi2", def: printing(PDI), owner: P1, zone: "play" }, ch("other", P1, 0, "hand")] });
  const deck = [...deckOf(g.engine, P1)];
  play(g.engine, P1, g.id("other"), {});
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.deepEqual(deckOf(g.engine, P1), deck, "nothing was drawn");
  assert.equal(handOf(g.engine, P1).includes(deck[0]), false);
  // and the second copy entering draws exactly one (control)
  play(g.engine, P1, g.id("pdi"), {});
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1), "the new Intern drew one, the one already in play drew nothing");
});

clause(PDI, "0:rule", "it draws however it enters play (put into play by an effect)", () => {
  const g = pdiBoard({ extra: [{ key: "put", def: putIntoPlayTactic(), owner: P1, zone: "hand" }] });
  const deck = [...deckOf(g.engine, P1)];
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("pdi")] } });
  assert.equal(zoneOf(g.engine, g.id("pdi")), "play");
  assert.deepEqual(handOf(g.engine, P1), [deck[0]]);
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1));
});

clause(PDI, "0:rule", "with an empty deck the draw simply does nothing (no error, no pending choice)", () => {
  const g = pdiBoard({ deckN: 0 });
  assert.equal(deckOf(g.engine, P1).length, 0);
  play(g.engine, P1, g.id("pdi"), {});
  assert.equal(zoneOf(g.engine, g.id("pdi")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(PDI, "0:rule", "printed cost 1 / [G][G] / 1 str 3 spd 1 life: one of two [G] is spent; refused with none, with one [G], or with no [G]", () => {
  const g = pdiBoard();
  play(g.engine, P1, g.id("pdi"), {});
  assert.equal(readyResources(g.engine, P1), 1, "paid exactly 1");
  assert.deepEqual(statsOf(g.engine, g.id("pdi")), [1, 3, 1]);

  const none = pdiBoard({ greed: 0 });
  refused(() => play(none.engine, P1, none.id("pdi"), {}), "no resources");
  const oneG = pdiBoard({ greed: 1 });
  refused(() => play(oneG.engine, P1, oneG.id("pdi"), {}), "one [G] only");
  const rage = pdiBoard({ greed: 0, rage: 3 });
  refused(() => play(rage.engine, P1, rage.id("pdi"), {}), "no [G]");
  for (const x of [none, oneG, rage]) {
    assert.equal(zoneOf(x.engine, x.id("pdi")), "hand");
    assert.equal(deckOf(x.engine, P1).length, 3, "nothing was drawn");
  }
  const oneGOneR = pdiBoard({ greed: 2, rage: 0 });
  assert.equal(readyResources(oneGOneR.engine, P1), 2);
});

// ============================================================================
// Religious Rejection — tactic, cost 5, [G]
// ============================================================================
const RR = "efa822c3-c417-4513-ad18-4b40fc3649d5";

function rrBoard(o: { greed?: number; rage?: number; obs?: number; vol?: number; oppVol?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rr", def: printing(RR), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 5, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("obsession", o.obs ?? 0, P1),
      ...volition(o.vol ?? 0, P1),
      ...volition(o.oppVol ?? 0, P2),
      ch("d0", P1, 2, "deck"),
      ch("d1", P1, 2, "deck"),
      ch("od0", P2, 2, "deck"),
      ch("tgt", P2, 2),
      ...(o.extra ?? [])
    ]
  });
}
type RrGame = ReturnType<typeof rrBoard>;
const rrCast = (g: RrGame, key = "tgt") => play(g.engine, P1, g.id("rr"), { selected: { c: [g.id(key)] } });
const withGear = (host: string, owner: PlayerId, key = "gear"): CardPlacement => ({
  key,
  def: item({ name: "Gear", attachTo: "character" }),
  owner,
  zone: "play",
  attachedToKey: host
});

clause(RR, "0:extraCost", "any character without an item attached can be picked: the opponent's and mine", () => {
  const g = rrBoard({ extra: [ch("mine", P1, 2)] });
  rrCast(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "my own character");
  const h = rrBoard();
  rrCast(h, "tgt");
  assert.equal(zoneOf(h.engine, h.id("tgt")), "discard", "the opponent's character");
});

clause(RR, "0:extraCost", "a character with an item attached cannot be picked, whoever owns the item; a character without one still can", () => {
  const g = rrBoard({ extra: [ch("bare", P2, 2), withGear("tgt", P2), ch("mine", P1, 2), withGear("mine", P1, "mygear")] });
  refused(() => rrCast(g, "tgt"), "an item on the opponent's character (opponent's item)");
  refused(() => rrCast(g, "mine"), "an item on my character (my item)");
  assert.equal(zoneOf(g.engine, g.id("rr")), "hand", "not deployed");
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  rrCast(g, "bare");
  assert.equal(zoneOf(g.engine, g.id("bare")), "discard", "positive control: a bare character in the same game");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(RR, "0:extraCost", "an item attached to some OTHER card does not stop a character being picked", () => {
  const g = rrBoard({ extra: [ch("host", P2, 2), withGear("host", P2)] });
  rrCast(g, "tgt");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.equal(zoneOf(g.engine, g.id("host")), "play");
});

clause(RR, "0:extraCost", "the pick must be a character in play: items, locations, factions and characters in hand or discard are refused", () => {
  const g = rrBoard({
    extra: [
      { key: "itm", def: item({ name: "Loose Gear" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ch("inHand", P2, 2, "hand"),
      ch("inDiscard", P2, 2, "discard")
    ]
  });
  for (const bad of [g.id("itm"), g.id("loc"), g.id("inHand"), g.id("inDiscard"), factionOf(g.engine, P2), factionOf(g.engine, P1)]) {
    refused(() => play(g.engine, P1, g.id("rr"), { selected: { c: [bad] } }), `picking ${bad}`);
  }
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid");
  rrCast(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard", "positive control");
});

clause(RR, "0:extraCost", "it picks exactly one character: two are refused", () => {
  const g = rrBoard({ extra: [ch("second", P2, 2)] });
  refused(() => play(g.engine, P1, g.id("rr"), { selected: { c: [g.id("tgt"), g.id("second")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("rr")), "hand");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play");
});

clause(RR, "0:extraCost", "with no legal pick (the only character has an item attached, or no character at all) it cannot be deployed", () => {
  const geared = rrBoard({ extra: [withGear("tgt", P2)] });
  refused(() => rrCast(geared), "only a geared character");
  assert.equal(zoneOf(geared.engine, geared.id("rr")), "hand");
  assert.equal(readyResources(geared.engine, P1), 5);
  const empty = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rr", def: printing(RR), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]
  });
  refused(() => play(empty.engine, P1, empty.id("rr"), {}), "no characters");
  assert.equal(zoneOf(empty.engine, empty.id("rr")), "hand");
  assert.equal(readyResources(empty.engine, P1), 5);
});

clause(RR, "0:extraCost", "the pick is made as part of deploying: while the tactic waits, the 5 is paid, the pick is fixed and the character is still in play", () => {
  const g = rrBoard();
  playRaw(g.engine, P1, g.id("rr"), { selected: { c: [g.id("tgt")] } });
  assert.notEqual(zoneOf(g.engine, g.id("rr")), "hand", "deployed");
  assert.equal(readyResources(g.engine, P1), 0, "the cost was already paid");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play", "not destroyed until it resolves");
});

clause(RR, "1:rule", "destroys the picked character (to its owner's discard pile) and nothing else", () => {
  const g = rrBoard({ extra: [ch("other", P2, 2), ch("mine", P1, 2)] });
  rrCast(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("tgt")), "discardOf(g.engine, P2).includes(g.id(\"tgt\"))");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("rr")), "discard", "the tactic is discarded");
});

clause(RR, "1:rule", "if I control [V][V][V] I draw a card: three face-down resources draw exactly the top card", () => {
  const g = rrBoard({ vol: 3 });
  const deck = [...deckOf(g.engine, P1)];
  const oppHand = [...handOf(g.engine, P2)];
  const handBefore = handOf(g.engine, P1).length;
  rrCast(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "rr left my hand, one card drawn");
  assert.ok(handOf(g.engine, P1).includes(deck[0]), "the top card of my deck");
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1));
  assert.deepEqual(handOf(g.engine, P2), oppHand, "the opponent drew nothing");
});

clause(RR, "1:rule", "with only [V][V] I do NOT draw (the character is still destroyed)", () => {
  const g = rrBoard({ vol: 2 });
  const deck = [...deckOf(g.engine, P1)];
  rrCast(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.deepEqual(deckOf(g.engine, P1), deck);
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(RR, "1:rule", "'a card': with more than three [V] I still draw exactly one", () => {
  const g = rrBoard({ vol: 5 });
  const deck = [...deckOf(g.engine, P1)];
  rrCast(g);
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1));
  assert.deepEqual(handOf(g.engine, P1), [deck[0]]);
});

clause(RR, "1:rule", "[V] means face-down Volition: three face-up non-Volition resources in addition to the 5 do not draw", () => {
  const g = rrBoard({ vol: 2, obs: 3 });
  const deck = [...deckOf(g.engine, P1)];
  rrCast(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.deepEqual(deckOf(g.engine, P1), deck);
});

clause(RR, "1:rule", "only MY [V] count: the opponent's three face-down resources do not draw me a card", () => {
  const g = rrBoard({ vol: 2, oppVol: 3 });
  const deck = [...deckOf(g.engine, P1)];
  rrCast(g);
  assert.deepEqual(deckOf(g.engine, P1), deck);
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(RR, "1:rule", "'control' includes resources spent on its own cost: two [G] + three Volition pay the 5 and still draw", () => {
  const g = rrBoard({ greed: 2, vol: 3 });
  const deck = [...deckOf(g.engine, P1)];
  assert.equal(readyResources(g.engine, P1), 5);
  rrCast(g);
  assert.equal(readyResources(g.engine, P1), 0, "all five were spent");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard");
  assert.deepEqual(handOf(g.engine, P1), [deck[0]], "drew with all three Volition spent");
});

clause(RR, "1:rule", "printed cost 5 / [G]: refused one short, refused without [G], accepted with a single [G] among the five", () => {
  const short = rrBoard({ greed: 4 });
  refused(() => rrCast(short), "4 resources");
  assert.equal(zoneOf(short.engine, short.id("rr")), "hand");
  assert.equal(zoneOf(short.engine, short.id("tgt")), "play");
  const rage = rrBoard({ greed: 0, rage: 5 });
  refused(() => rrCast(rage), "no [G]");
  assert.equal(zoneOf(rage.engine, rage.id("rr")), "hand");
  const ok = rrBoard({ greed: 1, rage: 4 });
  rrCast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("tgt")), "discard");
  assert.equal(readyResources(ok.engine, P1), 0);
});

// ============================================================================
// Resurrecting Necromorph — character, cost 1, [G][G][G], 2 str / 2 spd / 2 life
// ============================================================================
const RN = "f8c756cc-9ee5-4429-9b90-b38e2b8585fa";

function rnBoard(o: { res?: number; vol?: number; rn?: CardPlacement["zone"]; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "rn", def: printing(RN), owner: P1, zone: o.rn ?? "discard" },
      { key: "kill", def: killTactic({ name: "My Kill" }), owner: P1, zone: "hand" },
      ch("ally", P1, 2),
      ...bank("greed", o.res ?? 3, P1),
      ...volition(o.vol ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type RnGame = ReturnType<typeof rnBoard>;
const rnKill = (g: RnGame, key = "ally") => play(g.engine, P1, g.id("kill"), { selected: { t: [g.id(key)] } });
const payYes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

clause(RN, "0:rule", "when another character of mine goes from play to my discard pile, I may pay 1: the Necromorph enters play under my control, depleted", () => {
  const g = rnBoard();
  rnKill(g);
  const pc = pending(g.engine) as PendingChoiceLike;
  assert.deepEqual([pc.kind, pc.playerId], ["mayPay", P1]);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "the ally is in my discard pile");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "play");
  assert.equal(g.engine.state.cards[g.id("rn")].controllerId, P1, "under my control");
  assert.equal(g.engine.state.cards[g.id("rn")].depleted, true, "Deplete it");
  assert.equal(readyResources(g.engine, P1), 2, "paid exactly 1");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("rn")), "!discardOf(g.engine, P1).includes(g.id(\"rn\"))");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ally")), "discardOf(g.engine, P1).includes(g.id(\"ally\"))");
});

clause(RN, "0:rule", "declining: nothing is paid and the Necromorph stays in the discard pile", () => {
  const g = rnBoard();
  rnKill(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
  assert.equal(readyResources(g.engine, P1), 3, "nothing was paid");
});

clause(RN, "0:rule", "it is put into play, not deployed: no [G][G][G] needed (one face-down Volition resource pays the 1)", () => {
  const g = rnBoard({ res: 0, vol: 1 });
  rnKill(g);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("rn")), "play");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(RN, "0:rule", "with no resource to pay 1 it cannot come back", () => {
  const g = rnBoard({ res: 0 });
  rnKill(g);
  if (pending(g.engine)) {
    refused(() => answerPending(g.engine, "mayPay", { pay: true }), "paying 1 with no resources");
    answerPending(g.engine, "mayPay", { pay: false });
  }
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
});

clause(RN, "0:rule", "'if this card is in your discard pile': in hand, in the deck or already in play it does nothing when another character dies", () => {
  for (const zone of ["hand", "deck", "play"] as const) {
    const g = rnBoard({ rn: zone });
    rnKill(g);
    assert.equal(pending(g.engine), undefined, `Necromorph in ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("rn")), zone);
    assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "the ally did die");
  }
});

clause(RN, "0:rule", "'another character': the Necromorph itself dying does not bring it back", () => {
  const g = rnBoard({ rn: "play" });
  rnKill(g, "rn");
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
  assert.equal(pending(g.engine), undefined, "no prompt: it is not 'another' character");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(RN, "0:rule", "only characters of MINE: the opponent's character dying (into their discard pile) does not trigger it", () => {
  const g = rnBoard({ extra: [ch("enemy", P2, 2)] });
  rnKill(g, "enemy");
  assert.equal(zoneOf(g.engine, g.id("enemy")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
});

clause(RN, "0:rule", "only characters: an item of mine going from play to my discard pile does not trigger it", () => {
  const g = rnBoard({ extra: [{ key: "mygear", def: item({ name: "My Gear" }), owner: P1, zone: "play" }, { key: "brk", def: itemKillTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("brk"), { selected: { t: [g.id("mygear")] } });
  assert.equal(zoneOf(g.engine, g.id("mygear")), "discard", "the item went to my discard pile");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
});

clause(RN, "0:rule", "only 'from play': a character put into my discard pile from my hand does not trigger it", () => {
  const g = rnBoard({ extra: [ch("held", P1, 2, "hand"), { key: "pitch", def: pitchTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pitch"), { selected: { t: [g.id("held")] } });
  assert.equal(zoneOf(g.engine, g.id("held")), "discard", "the character went hand -> discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
});

clause(RN, "0:rule", "a character of mine that dies in battle also triggers it", () => {
  const g = rnBoard({
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", cost: 3, strength: 3, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("ally")], undefined, payYes);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "the blocker died in battle");
  assert.equal(zoneOf(g.engine, g.id("rn")), "play");
  assert.equal(g.engine.state.cards[g.id("rn")].depleted, true);
  assert.equal(readyResources(g.engine, P1), 2);
});

clause(RN, "0:rule", "'your discard pile' is the owner's: a character I own but the opponent controls dies into MY discard pile and triggers it", () => {
  const g = rnBoard({ extra: [ch("given", P1, 2, "play", { controller: P2 })] });
  rnKill(g, "given");
  assert.ok(discardOf(g.engine, P1).includes(g.id("given")), "it went to its owner's (my) discard pile");
  const pc = pending(g.engine) as PendingChoiceLike | undefined;
  assert.equal(pc?.kind, "mayPay", "the Necromorph offers to return");
});

clause(RN, "0:rule", "'your discard pile' is the owner's: a character the opponent owns but I control dies into THEIR discard pile and does not trigger it", () => {
  const g = rnBoard({ extra: [ch("stolen", P2, 2, "play", { controller: P1 })] });
  rnKill(g, "stolen");
  assert.ok(discardOf(g.engine, P2).includes(g.id("stolen")), "it went to its owner's (their) discard pile");
  assert.equal(pending(g.engine), undefined, "not put into MY discard pile");
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
});

clause(RN, "0:rule", "two characters dying at once bring it back only once: it is no longer in the discard pile for the second trigger", () => {
  const g = rnBoard({ res: 3, extra: [ch("ally2", P1, 2), { key: "all", def: destroyAllTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("all"), {});
  let prompts = 0;
  drain(g.engine, pc => {
    if (pc.kind === "mayPay") prompts++;
    return payYes(pc);
  });
  assert.equal(prompts, 1, "the Necromorph offers to return once (the second trigger sees it is no longer in the discard pile)");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ally2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("rn")), "play", "the Necromorph came back");
  assert.equal(readyResources(g.engine, P1), 2, "paid exactly 1 in total");
});

clause(RN, "0:rule", "'put into your discard pile': a character of mine that leaves play for my HAND (bounced) does not trigger it", () => {
  const g = rnBoard({ extra: [{ key: "bn", def: bounceTactic({ name: "Bounce" }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bn"), { selected: { t: [g.id("ally")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "hand", "the ally went to hand");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("rn")), "discard");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(RN, "0:rule", "printed cost 1 / [G][G][G] / 2 str 2 spd 2 life: deployable from hand for one resource, refused with none or without three [G]", () => {
  const g = rnBoard({ rn: "hand", res: 3 });
  play(g.engine, P1, g.id("rn"), {});
  assert.equal(zoneOf(g.engine, g.id("rn")), "play");
  assert.equal(readyResources(g.engine, P1), 2, "paid exactly 1");
  assert.deepEqual(statsOf(g.engine, g.id("rn")), [2, 2, 2]);
  const none = rnBoard({ rn: "hand", res: 0 });
  refused(() => play(none.engine, P1, none.id("rn"), {}), "no resources");
  const twoG = rnBoard({ rn: "hand", res: 2, extra: bank("rage", 2, P1) });
  refused(() => play(twoG.engine, P1, twoG.id("rn"), {}), "only two [G]");
  const rage = rnBoard({ rn: "hand", res: 0, extra: bank("rage", 3, P1) });
  refused(() => play(rage.engine, P1, rage.id("rn"), {}), "no [G]");
  for (const x of [none, twoG, rage]) assert.equal(zoneOf(x.engine, x.id("rn")), "hand");
});

clause(MD, "0:rule", "printed cost 3 / [G][G][G] / 2 str 3 spd 1 life: deployable for three resources with three [G], refused short or without three [G]", () => {
  const deploy = (greed: number, rage = 0) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "md2", def: printing(MD), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const ok = deploy(3);
  play(ok.engine, P1, ok.id("md2"), {});
  assert.equal(zoneOf(ok.engine, ok.id("md2")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 3");
  assert.deepEqual(statsOf(ok.engine, ok.id("md2")), [2, 3, 1]);
  const short = deploy(2);
  refused(() => play(short.engine, P1, short.id("md2"), {}), "2 resources");
  const twoG = deploy(2, 1);
  refused(() => play(twoG.engine, P1, twoG.id("md2"), {}), "only [G][G]");
  const rage = deploy(0, 4);
  refused(() => play(rage.engine, P1, rage.id("md2"), {}), "no [G]");
  for (const x of [short, twoG, rage]) assert.equal(zoneOf(x.engine, x.id("md2")), "hand");
  const spare = deploy(4);
  play(spare.engine, P1, spare.id("md2"), {});
  assert.equal(readyResources(spare.engine, P1), 1, "paid 3, not more");
});

clause(PM, "0:rule", "the tokens come only from its OWN entry: another character entering play puts none on it", () => {
  const g = pmPlay(0, [ch("newcomer", P1, 0, "hand")]);
  play(g.engine, P1, g.id("newcomer"), {});
  assert.equal(zoneOf(g.engine, g.id("newcomer")), "play");
  assert.equal(tokensOn(g.engine, g.id("pm")), 0);
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.deepEqual(statsOf(g.engine, g.id("pm")), [8, 3, 8]);
});
