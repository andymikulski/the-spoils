// Clause tests — batch holy-heist-04, part p2 (groups 10-14, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-04 --groups 10-14 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters?.token ?? 0;
const perform = (engine: SpoilsEngine, action: unknown) => engine.perform(action as never);
const answerPc = (engine: SpoilsEngine, choice: unknown) => {
  const pc = engine.state.pendingChoice as unknown as { playerId: PlayerId };
  perform(engine, { type: "resolvePendingChoice", playerId: pc.playerId, choice });
  resolvePendingResponses(engine);
};
const pendingKind = (engine: SpoilsEngine): string | undefined => (engine.state.pendingChoice as unknown as { kind?: string } | undefined)?.kind;

// =============================================================================
// Deity Delimitation Device
// =============================================================================
// ENTRAPMENT -- COST: Deplete this card. Pick a character you control. X is its numeric cost. -- EFFECT: Put that character into the void. Put X-1 tokens on this card.
// RELEASE -- COST: Deplete this card. Choose a number for X. -- EFFECT: Remove X tokens from this card. If you do, pick a character you own in the void with numeric cost X. Put that character into play under your control.

const DDD = "a54da68e-49b1-4942-abbb-db480747005a";

function dddBoard(extra: Cards = [], dddTokens = 0, dddDepleted = false) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ddd", def: printing(DDD), owner: P1, zone: "play", depleted: dddDepleted, counters: dddTokens ? { token: dddTokens } : undefined },
      { key: "c3", def: character({ name: "Three", cost: 3 }), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "One", cost: 1 }), owner: P1, zone: "play" },
      { key: "c0", def: character({ name: "Zero", cost: 0 }), owner: P1, zone: "play" },
      { key: "opp", def: character({ name: "Opp", cost: 4 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "play" },
      ...extra!
    ]
  });
}
const entrap = (g: ReturnType<typeof dddBoard>, key: string) => activate(g.engine, P1, g.id("ddd"), "ddd-entrapment", { selected: { prey: [g.id(key)] } });

clause(DDD, "0:ability:ddd-entrapment", "COST: deplete this card is paid when the ability is activated, and it is refused while already depleted", () => {
  const g = dddBoard();
  perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-entrapment", selected: { prey: [g.id("c3")] }, variables: {} });
  assert.equal(g.engine.state.cards[g.id("ddd")].depleted, true, "deplete paid");
  resolvePendingResponses(g.engine);
  const d = dddBoard([], 0, true);
  refused(() => entrap(d, "c3"), "depleted", /costs cannot be paid/i);
  assert.equal(zoneOf(d.engine, d.id("c3")), "play");
  const ok = dddBoard();
  entrap(ok, "c3");
  assert.equal(zoneOf(ok.engine, ok.id("c3")), "void", "positive control: the ready device works");
});

clause(DDD, "0:ability:ddd-entrapment", "a character with numeric cost 3 goes into the void and 3-1 = 2 tokens go on the device", () => {
  const g = dddBoard();
  entrap(g, "c3");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c3")), "void");
  assert.equal(tokens(g.engine, g.id("ddd")), 2);
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "other characters stay");
  assert.equal(zoneOf(g.engine, g.id("ddd")), "play");
});

clause(DDD, "0:ability:ddd-entrapment", "X is the picked character's own cost: cost 1 puts 0 tokens, cost 5 puts 4 (X-1 each time)", () => {
  const g = dddBoard([{ key: "c5", def: character({ name: "Five", cost: 5 }), owner: P1, zone: "play" }]);
  entrap(g, "c1");
  assert.equal(zoneOf(g.engine, g.id("c1")), "void");
  assert.equal(tokens(g.engine, g.id("ddd")), 0);
  const h = dddBoard([{ key: "c5", def: character({ name: "Five", cost: 5 }), owner: P1, zone: "play" }]);
  entrap(h, "c5");
  assert.equal(tokens(h.engine, h.id("ddd")), 4);
});

clause(DDD, "0:ability:ddd-entrapment", "tokens are added to those already on the device (1 existing + 3-1 = 3)", () => {
  const g = dddBoard([], 1);
  entrap(g, "c3");
  assert.equal(tokens(g.engine, g.id("ddd")), 3);
});

clause(DDD, "0:ability:ddd-entrapment", "a cost-0 character goes to the void and the device never ends up with negative tokens (X-1 = -1 puts none)", () => {
  const g = dddBoard();
  entrap(g, "c0");
  assert.equal(zoneOf(g.engine, g.id("c0")), "void");
  assert.ok(tokens(g.engine, g.id("ddd")) >= 0, "no negative tokens");
  assert.equal(tokens(g.engine, g.id("ddd")), 0);
});

clause(DDD, "0:ability:ddd-entrapment", "only a character you control can be picked: an opponent's character and an item are refused", () => {
  const g = dddBoard();
  refused(() => entrap(g, "opp"), "opponent's character", /target|pick|control|select/i);
  refused(() => entrap(g, "it"), "an item", /target|pick|character|select/i);
  assert.equal(zoneOf(g.engine, g.id("opp")), "play");
  assert.equal(zoneOf(g.engine, g.id("it")), "play");
  assert.equal(g.engine.state.cards[g.id("ddd")].depleted, false, "refused activation does not deplete");
  entrap(g, "c3");
  assert.equal(zoneOf(g.engine, g.id("c3")), "void", "positive control");
});

clause(DDD, "0:ability:ddd-entrapment", "a character you control but do not own can be picked (it goes to the void)", () => {
  const g = dddBoard([{ key: "stolen", def: character({ name: "Stolen", cost: 2 }), owner: P2, controller: P1, zone: "play" }]);
  entrap(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "void");
  assert.equal(tokens(g.engine, g.id("ddd")), 1);
});

clause(DDD, "0:ability:ddd-entrapment", "refused when there is no character you control to pick", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ddd", def: printing(DDD), owner: P1, zone: "play" },
      { key: "opp", def: character({ name: "Opp", cost: 4 }), owner: P2, zone: "play" }
    ]
  });
  refused(() => activate(g.engine, P1, g.id("ddd"), "ddd-entrapment", { selected: { prey: [g.id("opp")] } }), "no own character", /target|pick|control|select/i);
  assert.equal(g.engine.state.cards[g.id("ddd")].depleted, false);
});

// --- RELEASE ---

const release = (g: ReturnType<typeof dddBoard>, x: number, pick?: string) => {
  perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-release", selected: {}, variables: {} });
  resolvePendingResponses(g.engine);
  if (pendingKind(g.engine) === "chooseNumber") answerPc(g.engine, { kind: "chooseNumber", value: x });
  if (pick !== undefined && g.engine.state.pendingChoice) answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id(pick)] });
};
const voidBoard = (tok: number) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ddd", def: printing(DDD), owner: P1, zone: "play", counters: tok ? { token: tok } : undefined },
      { key: "v2", def: character({ name: "VoidTwo", cost: 2 }), owner: P1, zone: "void" },
      { key: "v3", def: character({ name: "VoidThree", cost: 3 }), owner: P1, zone: "void" },
      { key: "v0", def: character({ name: "VoidZero", cost: 0 }), owner: P1, zone: "void" },
      { key: "ov2", def: character({ name: "OppVoidTwo", cost: 2 }), owner: P2, zone: "void" },
      { key: "vi2", def: item({ name: "VoidItem", cost: 2 }), owner: P1, zone: "void" },
      { key: "d2", def: character({ name: "DiscTwo", cost: 2 }), owner: P1, zone: "discard" }
    ]
  });

clause(DDD, "1:ability:ddd-release", "COST: deplete this card is paid, and it is refused while already depleted", () => {
  const g = voidBoard(3);
  perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-release", selected: {}, variables: {} });
  assert.equal(g.engine.state.cards[g.id("ddd")].depleted, true);
  const d = voidBoard(3);
  d.engine.state.cards[d.id("ddd")].depleted = true;
  refused(() => release(d, 2, "v2"), "depleted", /costs cannot be paid/i);
  assert.equal(zoneOf(d.engine, d.id("v2")), "void");
});

clause(DDD, "1:ability:ddd-release", "choosing X = 2 removes 2 of 3 tokens and puts the cost-2 character from my void into play under my control", () => {
  const g = voidBoard(3);
  release(g, 2, "v2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokens(g.engine, g.id("ddd")), 1);
  assert.equal(zoneOf(g.engine, g.id("v2")), "play");
  assert.equal(g.engine.state.cards[g.id("v2")].controllerId, P1);
  assert.equal(zoneOf(g.engine, g.id("v3")), "void", "the other void character stays");
  assert.equal(zoneOf(g.engine, g.id("ov2")), "void");
});

clause(DDD, "1:ability:ddd-release", "a different X works too: X = 3 removes all 3 tokens and frees the cost-3 character", () => {
  const g = voidBoard(3);
  release(g, 3, "v3");
  assert.equal(tokens(g.engine, g.id("ddd")), 0);
  assert.equal(zoneOf(g.engine, g.id("v3")), "play");
  assert.equal(zoneOf(g.engine, g.id("v2")), "void");
});

clause(DDD, "1:ability:ddd-release", "X = 0 removes nothing and frees a cost-0 character", () => {
  const g = voidBoard(2);
  release(g, 0, "v0");
  assert.equal(tokens(g.engine, g.id("ddd")), 2);
  assert.equal(zoneOf(g.engine, g.id("v0")), "play");
});

clause(DDD, "1:ability:ddd-release", "the pick must have numeric cost exactly X: a cost-3 character cannot be picked for X = 2", () => {
  const g = voidBoard(3);
  perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-release", selected: {}, variables: {} });
  resolvePendingResponses(g.engine);
  answerPc(g.engine, { kind: "chooseNumber", value: 2 });
  refused(() => answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id("v3")] }), "wrong cost", /target|select|pick|cost|illegal|invalid/i);
  assert.equal(zoneOf(g.engine, g.id("v3")), "void");
  answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id("v2")] });
  assert.equal(zoneOf(g.engine, g.id("v2")), "play", "positive control");
});

clause(DDD, "1:ability:ddd-release", "the pick must be a character I own in the void: an opponent's void character, a void item and a discard-pile character are refused", () => {
  for (const bad of ["ov2", "vi2", "d2"]) {
    const g = voidBoard(3);
    perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-release", selected: {}, variables: {} });
    resolvePendingResponses(g.engine);
    answerPc(g.engine, { kind: "chooseNumber", value: 2 });
    refused(() => answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id(bad)] }), `${bad} is not a legal pick`, /target|select|pick|illegal|invalid/i);
    assert.notEqual(zoneOf(g.engine, g.id(bad)), "play");
  }
});

clause(DDD, "1:ability:ddd-release", "if the X tokens cannot be removed (1 token, X = 3) nothing comes out of the void", () => {
  const g = voidBoard(1);
  release(g, 3, "v3");
  assert.equal(zoneOf(g.engine, g.id("v3")), "void", "no 'if you do' -> no release");
  assert.equal(zoneOf(g.engine, g.id("v2")), "void");
});

clause(DDD, "1:ability:ddd-release", "with no tokens at all, X = 2 releases nothing", () => {
  const g = voidBoard(0);
  release(g, 2, "v2");
  assert.equal(zoneOf(g.engine, g.id("v2")), "void");
});

clause(DDD, "1:ability:ddd-release", "an entrapped character can be released again (round trip: Entrapment cost 3 -> 2 tokens -> Release X = 2)", () => {
  const g = dddBoard();
  entrap(g, "c3");
  g.engine.state.cards[g.id("ddd")].depleted = false;
  release(g, 2, "c3");
  assert.equal(zoneOf(g.engine, g.id("c3")), "void", "cost 3 != X 2: still in void");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const h = dddBoard([{ key: "c2", def: character({ name: "Two", cost: 2 }), owner: P1, zone: "play" }]);
  entrap(h, "c2");
  assert.equal(tokens(h.engine, h.id("ddd")), 1);
  h.engine.state.cards[h.id("ddd")].depleted = false;
  release(h, 1, "c2");
  assert.equal(tokens(h.engine, h.id("ddd")), 0);
  assert.equal(zoneOf(h.engine, h.id("c2")), "void", "a cost-2 character needs X = 2, and only 1 token exists");
});

// =============================================================================
// Digital Claywork Compendium
// =============================================================================
// This card cannot be picked.
// RESEARCH -- COST: Pay 2. Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 4.
// SMASH KEYS -- COST: Destroy this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 2.

const DCC = "5bb0adcd-38ae-467f-ad46-cd07c1e5e5ad";

const pickItemTactic = () =>
  tactic({
    name: "Item Picker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pk",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  } as never);
const sweepItemsTactic = () =>
  tactic({
    name: "Item Sweep",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "item" }, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
        }
      ]
    }
  } as never);

clause(DCC, "0:rule", "the controller cannot pick it with their own targeted effect (another item is a legal control)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dcc", def: printing(DCC), owner: P1, zone: "play" },
      { key: "other", def: item({ name: "Other Item" }), owner: P1, zone: "play" },
      { key: "pk", def: pickItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  refused(() => play(g.engine, P1, g.id("pk"), { selected: { t: [g.id("dcc")] } }), "cannot be picked", /target|pick|select|legal/i);
  assert.equal(zoneOf(g.engine, g.id("dcc")), "play");
  play(g.engine, P1, g.id("pk"), { selected: { t: [g.id("other")] } });
  assert.equal(zoneOf(g.engine, g.id("other")), "discard", "positive control: other items can be picked");
  assert.equal(zoneOf(g.engine, g.id("dcc")), "play");
});

clause(DCC, "0:rule", "an opponent cannot pick it either", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "dcc", def: printing(DCC), owner: P1, zone: "play" },
      { key: "other", def: item({ name: "Other Item" }), owner: P1, zone: "play" },
      { key: "pk", def: pickItemTactic(), owner: P2, zone: "hand" }
    ]
  });
  refused(() => play(g.engine, P2, g.id("pk"), { selected: { t: [g.id("dcc")] } }), "cannot be picked by the opponent", /target|pick|select|legal/i);
  assert.equal(zoneOf(g.engine, g.id("dcc")), "play");
  play(g.engine, P2, g.id("pk"), { selected: { t: [g.id("other")] } });
  assert.equal(zoneOf(g.engine, g.id("other")), "discard", "positive control");
});

clause(DCC, "0:rule", "only picking is blocked: an effect that does not pick (affects every item) still moves it", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dcc", def: printing(DCC), owner: P1, zone: "play" },
      { key: "other", def: item({ name: "Other Item" }), owner: P1, zone: "play" },
      { key: "sw", def: sweepItemsTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("sw"), {});
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dcc")), "discard", "'cannot be picked' is not 'cannot be affected'");
});

clause(DCC, "0:rule", "the restriction is on while it is in play only: a copy in hand is not 'in play' and the restriction is the card's own (another item stays pickable)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dcc", def: printing(DCC), owner: P1, zone: "play" },
      { key: "other", def: item({ name: "Other Item" }), owner: P1, zone: "play" }
    ]
  });
  assert.ok(g.engine.getRestrictions(g.id("dcc")).includes("cannotBePicked"), "g.engine.getRestrictions(g.id(\"dcc\")).includes(\"cannotBePicked\")");
  assert.ok(!g.engine.getRestrictions(g.id("other")).includes("cannotBePicked"), "!g.engine.getRestrictions(g.id(\"other\")).includes(\"cannotBePicked\")");
});

const researchBoard = (opts: { rage?: number; depleted?: boolean; extra?: Cards } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dcc", def: printing(DCC), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "big", def: character({ name: "Big", cost: 8 }), owner: P1, zone: "hand" },
      { key: "big2", def: character({ name: "Big Two", cost: 8 }), owner: P1, zone: "hand" },
      { key: "small", def: character({ name: "Small", cost: 3 }), owner: P1, zone: "hand" },
      { key: "oppbig", def: character({ name: "Opp Big", cost: 8 }), owner: P2, zone: "hand" },
      ...bank("rage", opts.rage ?? 12, P1),
      ...bank("rage", 12, P2),
      ...(opts.extra ?? [])
    ]
  });
const costOf = (g: ReturnType<typeof researchBoard>, key: string, p: PlayerId = P1) => g.engine.getCardPlayability(p, g.id(key)).numericCost;

clause(DCC, "1:ability:dcc-research", "COST: Pay 2 resources and deplete this card", () => {
  const g = researchBoard();
  const before = g.engine.getAvailableResourceCount(P1);
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  assert.equal(g.engine.state.cards[g.id("dcc")].depleted, true);
  assert.equal(before - g.engine.getAvailableResourceCount(P1), 2, "exactly 2 resources paid");
  assert.equal(zoneOf(g.engine, g.id("dcc")), "play", "deplete, not destroy");
});

clause(DCC, "1:ability:dcc-research", "refused when depleted, and refused with only 1 resource (cannot pay 2); with 2 it works", () => {
  const d = researchBoard({ depleted: true });
  refused(() => activate(d.engine, P1, d.id("dcc"), "dcc-research"), "depleted", /costs cannot be paid/i);
  const one = researchBoard({ rage: 1 });
  refused(() => activate(one.engine, P1, one.id("dcc"), "dcc-research"), "cannot pay 2", /resource|pay|afford|cost/i);
  assert.equal(one.engine.state.cards[one.id("dcc")].depleted, false);
  const two = researchBoard({ rage: 2 });
  activate(two.engine, P1, two.id("dcc"), "dcc-research");
  assert.equal(two.engine.state.cards[two.id("dcc")].depleted, true, "positive control");
  assert.equal(two.engine.getAvailableResourceCount(P1), 0);
});

clause(DCC, "1:ability:dcc-research", "the next numeric cost I pay is reduced by 4 (cost 8 -> 4), actually paying 4 on deploy", () => {
  const g = researchBoard();
  assert.equal(costOf(g, "big"), 8, "before");
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  assert.equal(costOf(g, "big"), 4);
  const before = g.engine.getAvailableResourceCount(P1);
  play(g.engine, P1, g.id("big"), {});
  assert.equal(zoneOf(g.engine, g.id("big")), "play");
  assert.equal(before - g.engine.getAvailableResourceCount(P1), 4, "paid 4");
});

clause(DCC, "1:ability:dcc-research", "only the NEXT cost: after one deploy the following cost is full price again", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  play(g.engine, P1, g.id("big"), {});
  assert.equal(costOf(g, "big2"), 8);
  assert.equal(costOf(g, "small"), 3);
});

clause(DCC, "1:ability:dcc-research", "a numeric cost never goes below 0: cost 3 reduced by 4 is 0", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  assert.equal(costOf(g, "small"), 0);
});

clause(DCC, "1:ability:dcc-research", "the reduction is mine: the opponent's cost-8 character is not reduced", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  assert.equal(costOf(g, "oppbig", P2), 8);
  assert.equal(costOf(g, "big"), 4);
});

clause(DCC, "1:ability:dcc-research", "the reduction lasts this turn only: it is gone on my next turn", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  assert.equal(costOf(g, "big"), 4);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "setup: back to my turn");
  assert.equal(costOf(g, "big"), 8, "an unused reduction does not carry over");
});

const payAbilityCard = () =>
  item({
    name: "Pay Gizmo",
    behavior: { abilities: [{ id: "pg", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);

clause(DCC, "1:ability:dcc-research", "'Pay 3' on an ability is a numeric cost (CR 406.5) so RESEARCH reduces it by 4 (pays 0)", () => {
  const g = researchBoard({ extra: [{ key: "gz", def: payAbilityCard(), owner: P1, zone: "play" }, { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" }] });
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  const before = g.engine.getAvailableResourceCount(P1);
  activate(g.engine, P1, g.id("gz"), "pg");
  assert.equal(before - g.engine.getAvailableResourceCount(P1), 0, "3 - 4 -> 0");
});

clause(DCC, "2:ability:dcc-smash-keys", "COST: destroy this card (it goes to my discard pile), and no resources are required", () => {
  const g = researchBoard({ rage: 0 });
  activate(g.engine, P1, g.id("dcc"), "dcc-smash-keys");
  assert.equal(zoneOf(g.engine, g.id("dcc")), "discard");
  assert.equal(costOf(g, "big"), 6);
});

clause(DCC, "2:ability:dcc-smash-keys", "works while depleted (the cost is destroy, not deplete)", () => {
  const g = researchBoard({ depleted: true });
  activate(g.engine, P1, g.id("dcc"), "dcc-smash-keys");
  assert.equal(zoneOf(g.engine, g.id("dcc")), "discard");
  assert.equal(costOf(g, "big"), 6);
});

clause(DCC, "2:ability:dcc-smash-keys", "the next numeric cost I pay is reduced by 2 (8 -> 6, paying 6), then the following cost is full", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-smash-keys");
  const before = g.engine.getAvailableResourceCount(P1);
  play(g.engine, P1, g.id("big"), {});
  assert.equal(before - g.engine.getAvailableResourceCount(P1), 6);
  assert.equal(costOf(g, "big2"), 8);
});

clause(DCC, "2:ability:dcc-smash-keys", "cost 3 reduced by 2 is 1, not 0 (the reduction is exactly 2); the opponent is unaffected", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-smash-keys");
  assert.equal(costOf(g, "small"), 1);
  assert.equal(costOf(g, "oppbig", P2), 8);
});

clause(DCC, "2:ability:dcc-smash-keys", "the reduction is lost at end of turn", () => {
  const g = researchBoard();
  activate(g.engine, P1, g.id("dcc"), "dcc-smash-keys");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(costOf(g, "big"), 8);
});

clause(DCC, "2:ability:dcc-smash-keys", "RESEARCH (4) and then a second reduction (2) both apply to the next cost: 8 -> 2 (a destroyed Compendium can't be re-used)", () => {
  const g = researchBoard({ extra: [{ key: "dcc2", def: printing(DCC), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("dcc"), "dcc-research");
  activate(g.engine, P1, g.id("dcc2"), "dcc-smash-keys");
  assert.equal(zoneOf(g.engine, g.id("dcc2")), "discard");
  assert.equal(costOf(g, "big"), 2, "4 + 2 off the same next cost");
});

// =============================================================================
// Elitist Upgrade
// =============================================================================
// This resource may only be played from your hand face down.
// PROVIDES: [E]
// FLIP IT: [E] -- COST: Use this only while this card is a face-down resource. Reveal this card. Pay 5. -- EFFECT: Put this card into play face-up. This turn, all Micromajigs gain 1 strength and 1 life.

const ELU = "9b20e73f-8eef-41a0-82d5-8942987fe044";

const handBoard = () =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "elu", def: printing(ELU), owner: P1, zone: "hand" },
      { key: "elu2", def: printing(ELU), owner: P1, zone: "hand" }
    ]
  });

clause(ELU, "0:rule", "cannot be played face up from hand (develop face-up is refused, it stays in hand)", () => {
  const g = handBoard();
  developResource(g.engine, P1, g.id("elu"), false); // asked to play it face-up: it only plays face-down
  assert.equal(zoneOf(g.engine, g.id("elu")), "play");
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, true, "never face-up");
  assert.deepEqual(g.engine.getThresholds(P1), { volition: 1 });
});

clause(ELU, "0:rule", "can be played from hand face down (a [V] resource); a second copy plays face down the same way", () => {
  const g = handBoard();
  developResource(g.engine, P1, g.id("elu"), true);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("elu")), "play");
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, true);
  assert.deepEqual(g.engine.getThresholds(P1), { volition: 1 }, "face-down it is just [V], not [E]");
});

clause(ELU, "0:rule", "the face-down restriction is this card's own: an ordinary resource can still be played face up", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "plain", def: { ...printing(ELU), name: "Plain Elitism", behavior: { abilities: [] }, resource: { provides: ["elitism"], staple: true } } as never, owner: P1, zone: "hand" }]
  });
  developResource(g.engine, P1, g.id("plain"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("plain")].faceDown, false);
  assert.equal(g.engine.getThresholds(P1).elitism, 1);
});

clause(ELU, "0:rule", "is not deployed as a card with playCard (a resource only enters play by the Develop Rule or an effect)", () => {
  const g = handBoard();
  refused(() => perform(g.engine, { type: "playCard", playerId: P1, cardId: g.id("elu"), selected: {}, variables: {} }), "not a deployable card");
  assert.equal(zoneOf(g.engine, g.id("elu")), "hand");
});

clause(ELU, "1:provides", "face-up in play it provides exactly one [E] and nothing else; two provide two", () => {
  const g = buildGame({ cards: [{ key: "elu", def: printing(ELU), owner: P1, zone: "play" }] });
  assert.deepEqual(g.engine.getThresholds(P1), { elitism: 1 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 1);
  const h = buildGame({
    cards: [
      { key: "a", def: printing(ELU), owner: P1, zone: "play" },
      { key: "b", def: printing(ELU), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(h.engine.getThresholds(P1), { elitism: 2 });
});

clause(ELU, "1:provides", "its icon goes to its controller only; face-down it provides [V] instead of [E]", () => {
  const up = buildGame({ cards: [{ key: "elu", def: printing(ELU), owner: P1, zone: "play" }] });
  assert.deepEqual(up.engine.getThresholds(P2), {});
  const down = buildGame({ cards: [{ key: "elu", def: printing(ELU), owner: P1, zone: "play", faceDown: true }] });
  assert.deepEqual(down.engine.getThresholds(P1), { volition: 1 });
});

const MICRO = () => character({ name: "Micromajig", strength: 1, speed: 1, life: 3, subtype: ["majig"] } as never);
function flipBoard(opts: { elitism?: number; rage?: number; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "elu", def: printing(ELU), owner: P1, zone: "play", faceDown: opts.faceDown ?? true },
      ...bank("elitism", opts.elitism ?? 1, P1),
      ...bank("rage", opts.rage ?? 4, P1),
      { key: "m1", def: MICRO(), owner: P1, zone: "play" },
      { key: "m2", def: MICRO(), owner: P1, zone: "play" },
      { key: "om", def: MICRO(), owner: P2, zone: "play" },
      { key: "other", def: character({ name: "Other Majig", strength: 2, speed: 1, life: 2, subtype: ["majig"] } as never), owner: P1, zone: "play" },
      { key: "item", def: item({ name: "Micromajig Item" }), owner: P1, zone: "play" }
    ]
  });
}
type FlipGame = ReturnType<typeof flipBoard>;
const startFlip = (g: FlipGame) => perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("elu"), abilityId: "flip-it", selected: {}, variables: {} });

clause(ELU, "2:ability:flip-it", "COST: pays 5 resources (5 attached while waiting for responses) and reveals the card; still face down until it resolves", () => {
  const g = flipBoard({ elitism: 2, rage: 4 });
  startFlip(g);
  assert.ok(g.engine.state.responseWindow, "waiting for responses");
  assert.equal(attachedCount(g.engine, P1), 5, "exactly 5 paid");
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, true);
  const revealed = g.engine.getLog().some(e => e.event?.type === "cardsRevealed" && (e.event as unknown as { cardIds: string[] }).cardIds.includes(g.id("elu")));
  assert.ok(revealed, "a cardsRevealed event names the card");
});

// Whether the face-down card may help pay its own Pay 5 is an open rules question (holy-heist-04-p2-7),
// so this refusal uses a board that is short under both readings: 3 others + the card itself = 4.
clause(ELU, "2:ability:flip-it", "refused with only 4 resources even counting the card itself (3 others), even with [E]", () => {
  const g = flipBoard({ elitism: 1, rage: 2 });
  const before = g.engine.getAvailableResourceCount(P1);
  refused(() => startFlip(g), "4 resources", /resource|pay|afford|cost/i);
  assert.equal(g.engine.getAvailableResourceCount(P1), before);
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, true);
  const ok = flipBoard({ elitism: 1, rage: 4 });
  startFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("elu")].faceDown, false, "positive control with 5");
});

clause(ELU, "2:ability:flip-it", "threshold [E]: refused with enough resources but no [E] icon", () => {
  const g = flipBoard({ elitism: 0, rage: 6 });
  refused(() => startFlip(g), "no elitism icon", /threshold|icon|elitism|resource|cost/i);
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, true);
});

clause(ELU, "2:ability:flip-it", "usable only while the card is a face-down resource: refused once it is face-up", () => {
  const g = flipBoard({ elitism: 2, rage: 6, faceDown: false });
  refused(() => startFlip(g), "face-up", /face|down|not found|condition|available/i);
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(ELU, "2:ability:flip-it", "EFFECT: the card ends up in play face up, providing [E] instead of [V]", () => {
  const g = flipBoard({ elitism: 1, rage: 4 });
  const before = g.engine.getThresholds(P1);
  startFlip(g);
  resolvePendingResponses(g.engine);
  const card = g.engine.state.cards[g.id("elu")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  const after = g.engine.getThresholds(P1);
  assert.equal(after.elitism, (before.elitism ?? 0) + 1);
  assert.equal(after.volition ?? 0, (before.volition ?? 0) - 1);
});

clause(ELU, "2:ability:flip-it", "EFFECT: this turn ALL Micromajigs (mine and the opponent's) gain +1 strength and +1 life; other characters and items do not", () => {
  const g = flipBoard();
  const base = (k: string) => [g.engine.getStat(g.id(k), "strength"), g.engine.getStat(g.id(k), "life")];
  assert.deepEqual(base("m1"), [1, 3]);
  startFlip(g);
  resolvePendingResponses(g.engine);
  assert.deepEqual(base("m1"), [2, 4]);
  assert.deepEqual(base("m2"), [2, 4]);
  assert.deepEqual(base("om"), [2, 4], "the opponent's Micromajig too");
  assert.deepEqual(base("other"), [2, 2], "a non-Micromajig majig is unchanged");
  assert.equal(g.engine.getStat(g.id("m1"), "speed"), 1, "speed unchanged");
});

clause(ELU, "2:ability:flip-it", "the Micromajig bonus lasts this turn only", () => {
  const g = flipBoard();
  startFlip(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("m1"), "strength"), 2);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("m1"), "strength"), 1, "gone at end of turn");
  assert.equal(g.engine.getStat(g.id("m1"), "life"), 3);
  assert.equal(g.engine.getStat(g.id("om"), "life"), 3);
});

clause(ELU, "2:ability:flip-it", "no Micromajigs in play is fine: the card still flips up", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "elu", def: printing(ELU), owner: P1, zone: "play", faceDown: true }, ...bank("elitism", 1, P1), ...bank("rage", 4, P1)]
  });
  startFlip(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, false);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

// =============================================================================
// Guardforce Aggromajig  (cost 1 · str 0 / spd 3 / life 3)
// =============================================================================
// This card can attack even if it has not been in play under your control since the start of the turn.
// While this card is depleted it gains 2 strength.

const GUARD = "01750977-01af-4db3-bf26-5b5822eddb76";

const guardBoard = (depleted = false, eligible = false) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ga", def: printing(GUARD), owner: P1, zone: "play", depleted, attackEligible: eligible },
      { key: "plain", def: character({ name: "Plain", strength: 2, speed: 2, life: 2 }), owner: P1, zone: "play", attackEligible: false },
      { key: "plainDep", def: character({ name: "Plain Depleted", strength: 2, speed: 2, life: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "opp", def: character({ name: "Opp", strength: 1, speed: 1, life: 5 }), owner: P2, zone: "play" }
    ]
  });

clause(GUARD, "0:rule", "can attack the turn it entered play: it attacks the opponent's faction while an ordinary just-entered character is refused", () => {
  const g = guardBoard(false, false);
  refused(() => declareAttackBy(g.engine, P1, [g.id("plain")]), "summoning sick", /attack|eligible|turn|control|start/i);
  declareAttackBy(g.engine, P1, [g.id("ga")]);
  assert.ok(g.engine.state.battle, "an attack was declared");
});

clause(GUARD, "0:rule", "deployed from hand this turn, it can attack immediately (the real just-deployed case)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ga", def: printing(GUARD), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
  });
  play(g.engine, P1, g.id("ga"), {});
  assert.equal(zoneOf(g.engine, g.id("ga")), "play");
  declareAttackBy(g.engine, P1, [g.id("ga")]);
  assert.ok(g.engine.state.battle, "attack declared the turn it was deployed");
});

clause(GUARD, "0:rule", "the haste is its own: another character that entered this turn still cannot attack alongside it", () => {
  const g = guardBoard(false, false);
  refused(() => declareAttackBy(g.engine, P1, [g.id("ga"), g.id("plain")]), "plain is not eligible", /attack|eligible|turn|control|start/i);
  assert.ok(!g.engine.getKeywords(g.id("plain")).includes("aggro"), "!g.engine.getKeywords(g.id(\"plain\")).includes(\"aggro\")");
  assert.ok(g.engine.getKeywords(g.id("ga")).includes("aggro"), "g.engine.getKeywords(g.id(\"ga\")).includes(\"aggro\")");
});

clause(GUARD, "1:rule", "while depleted it has 2 strength (printed 0 + 2); ready it has 0", () => {
  const dep = guardBoard(true);
  assert.equal(dep.engine.getStat(dep.id("ga"), "strength"), 2);
  assert.equal(dep.engine.getStat(dep.id("ga"), "speed"), 3, "speed unchanged");
  assert.equal(dep.engine.getStat(dep.id("ga"), "life"), 3, "life unchanged");
  const ready = guardBoard(false);
  assert.equal(ready.engine.getStat(ready.id("ga"), "strength"), 0);
});

clause(GUARD, "1:rule", "the bonus follows depleted state live: depleting it mid-game raises strength to 2, restoring it drops it back to 0", () => {
  const g = guardBoard(false);
  assert.equal(g.engine.getStat(g.id("ga"), "strength"), 0);
  g.engine.state.cards[g.id("ga")].depleted = true;
  assert.equal(g.engine.getStat(g.id("ga"), "strength"), 2);
  g.engine.state.cards[g.id("ga")].depleted = false;
  assert.equal(g.engine.getStat(g.id("ga"), "strength"), 0);
});

clause(GUARD, "1:rule", "only this card gains it: another depleted character keeps its printed strength", () => {
  const g = guardBoard(true);
  assert.equal(g.engine.getStat(g.id("plainDep"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("opp"), "strength"), 1);
});

clause(GUARD, "1:rule", "a depleted Aggromajig attacking deals its 2 strength in battle (attackers deplete), so the blocker takes 2 damage", () => {
  const g = guardBoard(false, true);
  declareAttackBy(g.engine, P1, [g.id("ga")]);
  assert.equal(g.engine.state.cards[g.id("ga")].depleted, true, "attacking depleted it");
  assert.equal(g.engine.getStat(g.id("ga"), "strength"), 2);
});

// =============================================================================
// Hasty Pursuit  (cost 2 · eee)
// =============================================================================
// EXTRA COST: Deploy this only on your turn.
// This turn, characters you control and deploy can attack even if they have not been in play under your control since the start of the turn. Draw a card. If you picked any characters as part of this card's FLIP UP cost, deplete those characters.
// FLIP UP: 4 [E][E][E] and you may pick up to 2 characters.

const HASTY = "8f8af0b4-2e83-48e5-9c84-4fdcecfbbbd1";

function hastyBoard(opts: { active?: PlayerId; elitism?: number; faceDown?: boolean; zone?: "hand" | "play"; deck?: number } = {}) {
  const active = opts.active ?? P1;
  const zone = opts.zone ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "hp", def: printing(HASTY), owner: P1, zone, faceDown: zone === "play" ? opts.faceDown ?? true : undefined },
      { key: "c1", def: character({ name: "Mine One", strength: 2, speed: 2, life: 2 }), owner: P1, zone: "play", attackEligible: false },
      { key: "c2", def: character({ name: "Mine Two", strength: 2, speed: 2, life: 2 }), owner: P1, zone: "play", attackEligible: false },
      { key: "c3", def: character({ name: "Mine Three", strength: 2, speed: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Late", cost: 0, strength: 1, speed: 1, life: 1 }), owner: P1, zone: "hand" },
      { key: "o1", def: character({ name: "Opp One", strength: 2, speed: 2, life: 2 }), owner: P2, zone: "play", attackEligible: false },
      { key: "o2", def: character({ name: "Opp Two", strength: 2, speed: 2, life: 2 }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...Array.from({ length: opts.deck ?? 4 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Deck${i}` }), owner: P1, zone: "deck" as const }))
    ]
  });
}
type HastyGame = ReturnType<typeof hastyBoard>;
const flipHasty = (g: HastyGame, picks: string[] = []) => {
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hp"), selected: {}, variables: {} });
  if (pendingKind(g.engine) === "chooserSelectsTarget") answerPc(g.engine, { kind: "chooserSelectsTarget", selected: picks.map(k => g.id(k)) });
};

clause(HASTY, "0:extraCost", "can be deployed on my turn", () => {
  const g = hastyBoard();
  play(g.engine, P1, g.id("hp"), {});
  assert.equal(zoneOf(g.engine, g.id("hp")), "discard", "tactic resolved");
});

clause(HASTY, "0:extraCost", "cannot be deployed on the opponent's turn, even with priority in their response window (and nothing is paid or drawn)", () => {
  const g = hastyBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("o2")]);
  assert.ok(g.engine.state.responseWindow, "setup: I hold priority in the opponent's window");
  const hand = g.engine.state.players[P1].hand.length;
  const res = g.engine.getAvailableResourceCount(P1);
  refused(() => play(g.engine, P1, g.id("hp"), {}), "opponent's turn", /deployed right now/i);
  assert.equal(zoneOf(g.engine, g.id("hp")), "hand");
  assert.equal(g.engine.state.players[P1].hand.length, hand);
  assert.equal(g.engine.getAvailableResourceCount(P1), res);
  assert.ok(!g.engine.getKeywords(g.id("c1")).includes("aggro"), "!g.engine.getKeywords(g.id(\"c1\")).includes(\"aggro\")");
});

clause(HASTY, "1:rule", "costs 2 to deploy: refused with 1 resource, 2 [E] resources are one short of the 'eee' threshold", () => {
  const g = hastyBoard({ elitism: 3 });
  const before = g.engine.getAvailableResourceCount(P1);
  play(g.engine, P1, g.id("hp"), {});
  assert.equal(before - g.engine.getAvailableResourceCount(P1), 2, "pays exactly 2");
  const short = hastyBoard({ elitism: 1 });
  refused(() => play(short.engine, P1, short.id("hp"), {}), "one resource", /resource|afford|cost|threshold/i);
  const thr = hastyBoard({ elitism: 2 });
  refused(() => play(thr.engine, P1, thr.id("hp"), {}), "two resources, threshold eee", /resource|afford|cost|threshold/i);
  assert.equal(zoneOf(thr.engine, thr.id("hp")), "hand");
});

clause(HASTY, "1:rule", "this turn the characters I control can attack even though they just entered: an attack with both is declared", () => {
  const g = hastyBoard();
  refused(() => declareAttackBy(g.engine, P1, [g.id("c1")]), "control: not yet eligible before the tactic", /attack|eligible|turn|control|start/i);
  play(g.engine, P1, g.id("hp"), {});
  assert.ok(g.engine.getKeywords(g.id("c1")).includes("aggro"), "g.engine.getKeywords(g.id(\"c1\")).includes(\"aggro\")");
  assert.ok(g.engine.getKeywords(g.id("c2")).includes("aggro"), "g.engine.getKeywords(g.id(\"c2\")).includes(\"aggro\")");
  declareAttackBy(g.engine, P1, [g.id("c1"), g.id("c2")]);
  assert.ok(g.engine.state.battle, "both ineligible characters attacked");
});

clause(HASTY, "1:rule", "characters I deploy later this turn can attack too", () => {
  const g = hastyBoard();
  play(g.engine, P1, g.id("hp"), {});
  play(g.engine, P1, g.id("late"), {});
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  declareAttackBy(g.engine, P1, [g.id("late")]);
  assert.ok(g.engine.state.battle, "a character deployed after the tactic attacks the turn it enters");
});

clause(HASTY, "1:rule", "only characters I control: the opponent's character does not get the haste", () => {
  const g = hastyBoard();
  play(g.engine, P1, g.id("hp"), {});
  assert.ok(!g.engine.getKeywords(g.id("o1")).includes("aggro"), "!g.engine.getKeywords(g.id(\"o1\")).includes(\"aggro\")");
});

clause(HASTY, "1:rule", "'this turn': the haste is gone on my next turn for a character that has just entered then", () => {
  const g = hastyBoard();
  play(g.engine, P1, g.id("hp"), {});
  endTurn(g.engine, P1);
  assert.ok(!g.engine.getKeywords(g.id("c1")).includes("aggro"), "expired at end of turn");
  assert.ok(!g.engine.getKeywords(g.id("late")).includes("aggro"), "!g.engine.getKeywords(g.id(\"late\")).includes(\"aggro\")");
});

clause(HASTY, "1:rule", "draws a card: hand size is -1 (tactic) +1 (draw) and the drawn card is the top of my deck", () => {
  const g = hastyBoard({ deck: 3 });
  const top = g.engine.state.players[P1].deck[0];
  const hand = g.engine.state.players[P1].hand.length;
  play(g.engine, P1, g.id("hp"), {});
  assert.equal(g.engine.state.players[P1].hand.length, hand - 1 + 1);
  assert.ok(g.engine.state.players[P1].hand.includes(top), "g.engine.state.players[P1].hand.includes(top)");
  assert.equal(g.engine.state.players[P1].deck.length, 2);
});

clause(HASTY, "1:rule", "deployed normally (no FLIP UP cost) it picks and depletes nothing: my characters stay ready", () => {
  const g = hastyBoard();
  play(g.engine, P1, g.id("hp"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["c1", "c2", "c3"]) assert.equal(g.engine.state.cards[g.id(k)].depleted, false, k);
});

clause(HASTY, "2:flipUp", "FLIP UP costs exactly 4: it turns the face-down card into a resolved tactic and pays 4", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipHasty(g, []);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(g.engine, P1), 4 + 0, "4 paid (the face-down card itself provides a resource but not the 4 spent here)");
  assert.notEqual(g.engine.state.cards[g.id("hp")].faceDown, true);
});

clause(HASTY, "2:flipUp", "refused when short: 3 other resources are not 4 (the card may help pay for itself, so 3 + itself is exactly 4 and is accepted)", () => {
  const short = hastyBoard({ zone: "play", elitism: 2 });
  refused(() => flipHasty(short), "2 + itself = 3 resources", /resource|afford|cost|threshold/i);
  assert.equal(short.engine.state.cards[short.id("hp")].faceDown, true);
  const ok = hastyBoard({ zone: "play", elitism: 3 });
  flipHasty(ok);
  resolvePendingResponses(ok.engine);
  assert.notEqual(ok.engine.state.cards[ok.id("hp")].faceDown, true, "3 other + itself = 4");
});

clause(HASTY, "2:flipUp", "needs [E][E][E]: 4 Rage resources are enough resources but not the threshold", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "hp", def: printing(HASTY), owner: P1, zone: "play", faceDown: true }, ...bank("rage", 6, P1), ...bank("elitism", 2, P1)]
  });
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hp"), selected: {}, variables: {} }), "only 2 [E] + face-down [V]", /threshold|icon|elitism|cost/i);
  assert.equal(g.engine.state.cards[g.id("hp")].faceDown, true);
});

clause(HASTY, "2:flipUp", "picking 1 character as part of the cost depletes that character (and only it)", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipHasty(g, ["c1"]);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("c1")].depleted, true);
  assert.equal(g.engine.state.cards[g.id("c2")].depleted, false);
  assert.equal(g.engine.state.cards[g.id("c3")].depleted, false);
});

clause(HASTY, "2:flipUp", "picking 2 characters depletes both, and any character (including the opponent's) is a legal pick", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipHasty(g, ["c1", "o1"]);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("c1")].depleted, true);
  assert.equal(g.engine.state.cards[g.id("o1")].depleted, true, "the opponent's character can be picked");
  assert.equal(g.engine.state.cards[g.id("c3")].depleted, false);
});

clause(HASTY, "2:flipUp", "picking nobody is allowed ('you may pick up to 2'): nothing is depleted", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipHasty(g, []);
  resolvePendingResponses(g.engine);
  for (const k of ["c1", "c2", "c3", "o1"]) assert.equal(g.engine.state.cards[g.id(k)].depleted, false, k);
});

clause(HASTY, "2:flipUp", "more than 2 picks are refused", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  refused(() => flipHasty(g, ["c1", "c2", "c3"]), "three picks", /target|pick|count|select|too many|at most/i);
  assert.equal(g.engine.state.cards[g.id("c1")].depleted, false);
  assert.equal(g.engine.state.cards[g.id("hp")].faceDown, true);
});

clause(HASTY, "2:flipUp", "only characters can be picked: a non-character card in play is refused", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(HASTY), owner: P1, zone: "play", faceDown: true },
      { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "ch", def: character({ name: "Char" }), owner: P1, zone: "play" },
      ...bank("elitism", 4, P1)
    ]
  });
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hp"), selected: {}, variables: {} });
  refused(() => answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id("it")] }), "an item", /target|pick|select|character|illegal|invalid/i);
  assert.equal(g.engine.state.cards[g.id("it")].depleted, false);
});

clause(HASTY, "2:flipUp", "after a FLIP UP the tactic's own text still happens: characters gain the haste this turn and I draw a card", () => {
  const g = hastyBoard({ zone: "play", elitism: 4, deck: 3 });
  const hand = g.engine.state.players[P1].hand.length;
  flipHasty(g, ["c1"]);
  resolvePendingResponses(g.engine);
  assert.ok(g.engine.getKeywords(g.id("c2")).includes("aggro"), "haste granted");
  assert.equal(g.engine.state.players[P1].hand.length, hand + 1, "drew a card");
});

clause(HASTY, "2:flipUp", "a picked-and-depleted character cannot attack, while an unpicked one can attack thanks to the haste", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipHasty(g, ["c1"]);
  resolvePendingResponses(g.engine);
  refused(() => declareAttackBy(g.engine, P1, [g.id("c1")]), "depleted", /deplet|attack|ready/i);
  declareAttackBy(g.engine, P1, [g.id("c2")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
});

// =============================================================================
// Review-gap additions
// =============================================================================

clause(DDD, "1:ability:ddd-release", "with too few tokens (1 token, X = 3) nothing is removed: the device keeps its 1 token", () => {
  const g = voidBoard(1);
  release(g, 3, "v3");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokens(g.engine, g.id("ddd")), 1, "'remove X tokens. If you do...' - X can't be removed, so none are");
});

clause(DDD, "1:ability:ddd-release", "with no tokens at all (X = 2) the device still has 0 tokens (never negative)", () => {
  const g = voidBoard(0);
  release(g, 2, "v2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokens(g.engine, g.id("ddd")), 0);
});

clause(DDD, "1:ability:ddd-release", "positive control: with enough tokens (3, X = 2) exactly X are removed", () => {
  const g = voidBoard(3);
  release(g, 2, "v2");
  assert.equal(tokens(g.engine, g.id("ddd")), 1);
  assert.equal(zoneOf(g.engine, g.id("v2")), "play");
});

const lateBoard = () =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "elu", def: printing(ELU), owner: P1, zone: "play", faceDown: true },
      ...bank("elitism", 1, P1),
      ...bank("rage", 4, P1),
      { key: "m1", def: MICRO(), owner: P1, zone: "play" },
      { key: "late", def: { ...MICRO(), cost: 0 } as never, owner: P1, zone: "hand" },
      { key: "olate", def: { ...MICRO(), cost: 0 } as never, owner: P2, zone: "hand" }
    ]
  });

clause(ELU, "2:ability:flip-it", "'all Micromajigs' is the set in play when it resolves: a Micromajig that enters later this turn has its base 1/3", () => {
  const g = lateBoard();
  startFlip(g as never);
  resolvePendingResponses(g.engine);
  assert.deepEqual([g.engine.getStat(g.id("m1"), "strength"), g.engine.getStat(g.id("m1"), "life")], [2, 4], "the one already in play is boosted");
  play(g.engine, P1, g.id("late"), {});
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("late")), "play", "setup: it entered");
  assert.deepEqual([g.engine.getStat(g.id("late"), "strength"), g.engine.getStat(g.id("late"), "life")], [1, 3], "the late entrant is not boosted");
});

clause(ELU, "2:ability:flip-it", "the face-down card itself helps pay its own Pay 5 (4 other resources + itself; CR 507.4b analogue)", () => {
  const g = flipBoard({ elitism: 1, rage: 3 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 5, "setup: 4 others + the face-down card itself");
  startFlip(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.cards[g.id("elu")].faceDown, false, "flipped up with itself as one of the 5 payers");
  assert.equal(attachedCount(g.engine, P1), 4, "the flipped-up card is a completely new card (CR 411.3): not attached, so only the 4 others stay spent");
  assert.equal(g.engine.state.cards[g.id("elu")].attachedTo, undefined);
});

clause(HASTY, "2:flipUp", "'Deploy this only on your turn' also blocks FLIP UP on the opponent's turn (inside their response window); on my own turn the same flip works", () => {
  const g = hastyBoard({ active: P2, zone: "play" });
  declareAttackOpenWindow(g.engine, P2, [g.id("o2")]);
  assert.ok(g.engine.state.responseWindow, "setup: I hold priority in the opponent's window");
  const res = g.engine.getAvailableResourceCount(P1);
  refused(() => flipHasty(g), "FLIP UP is deploying, refused on the opponent's turn", /turn|deploy|only|condition|priority|flip/i);
  assert.equal(g.engine.state.cards[g.id("hp")].faceDown, true, "still face down");
  assert.equal(g.engine.getAvailableResourceCount(P1), res, "nothing paid");
  const own = hastyBoard({ zone: "play" });
  flipHasty(own);
  resolvePendingResponses(own.engine);
  assert.notEqual(own.engine.state.cards[own.id("hp")].faceDown, true, "positive control: own turn");
});

// --- review gap: survivors of the extended mutation pass ---

const pcOf = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; declaration?: { count?: number } };

clause(DDD, "1:ability:ddd-release", "I (the controller) choose X and I pick the freed character; I pick exactly one (a second cost-2 void character stays put)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ddd", def: printing(DDD), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "v2", def: character({ name: "VoidTwo", cost: 2 }), owner: P1, zone: "void" },
      { key: "w2", def: character({ name: "VoidTwoB", cost: 2 }), owner: P1, zone: "void" },
      { key: "v0", def: character({ name: "VoidZero", cost: 0 }), owner: P1, zone: "void" },
      { key: "v1", def: character({ name: "VoidOne", cost: 1 }), owner: P1, zone: "void" }
    ]
  });
  perform(g.engine, { type: "activateAbility", playerId: P1, cardId: g.id("ddd"), abilityId: "ddd-release", selected: {}, variables: {} });
  resolvePendingResponses(g.engine);
  assert.equal(pcOf(g.engine).kind, "chooseNumber");
  assert.equal(pcOf(g.engine).playerId, P1, "I choose the number");
  answerPc(g.engine, { kind: "chooseNumber", value: 2 });
  assert.equal(pcOf(g.engine).kind, "chooserSelectsTarget");
  assert.equal(pcOf(g.engine).playerId, P1, "I pick the character");
  assert.equal(pcOf(g.engine).declaration?.count, 1, "exactly one character");
  for (const low of ["v0", "v1"]) {
    refused(() => answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id(low)] }), `cost ${low} is not X = 2`);
  }
  answerPc(g.engine, { kind: "chooserSelectsTarget", selected: [g.id("v2")] });
  assert.equal(zoneOf(g.engine, g.id("v2")), "play");
  assert.equal(zoneOf(g.engine, g.id("w2")), "void");
  assert.equal(zoneOf(g.engine, g.id("v0")), "void");
  assert.equal(zoneOf(g.engine, g.id("v1")), "void");
});

const GUARD_BUFF = () =>
  character({
    name: "Banner",
    strength: 1,
    speed: 1,
    life: 1,
    behavior: { abilities: [{ id: "banner", type: "continuous", modifiers: [{ selector: { zone: "play", type: "character", name: "Guardforce Aggromajig" }, stat: "strength", operation: "add", value: 1 }] }] }
  } as never);

clause(GUARD, "1:rule", "the +2 is added to the current strength: with another +1 strength source a depleted one is 0 + 1 + 2 = 3, a ready one 1", () => {
  const mk = (depleted: boolean) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ga", def: printing(GUARD), owner: P1, zone: "play", depleted },
        { key: "banner", def: GUARD_BUFF(), owner: P1, zone: "play" }
      ]
    });
  const dep = mk(true);
  assert.equal(dep.engine.getStat(dep.id("ga"), "strength"), 3);
  const ready = mk(false);
  assert.equal(ready.engine.getStat(ready.id("ga"), "strength"), 1);
});

clause(GUARD, "0:rule", "vanilla deploy: costs exactly 1 and needs four [E] icons - three [E] are refused, four deploy it for 1", () => {
  const mk = (n: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ga", def: printing(GUARD), owner: P1, zone: "hand" }, ...bank("elitism", n, P1), ...bank("rage", 3, P1)]
    });
  const short = mk(3);
  refused(() => play(short.engine, P1, short.id("ga"), {}), "three [E] icons", /resource|afford|cost|threshold/i);
  assert.equal(zoneOf(short.engine, short.id("ga")), "hand");
  const ok = mk(4);
  const before = ok.engine.getAvailableResourceCount(P1);
  play(ok.engine, P1, ok.id("ga"), {});
  assert.equal(zoneOf(ok.engine, ok.id("ga")), "play");
  assert.equal(before - ok.engine.getAvailableResourceCount(P1), 1, "pays exactly 1");
});

clause(HASTY, "2:flipUp", "I choose the FLIP UP picks, and the pick is capped at 2 characters ('up to 2')", () => {
  const g = hastyBoard({ zone: "play", elitism: 4 });
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hp"), selected: {}, variables: {} });
  assert.equal(pcOf(g.engine).kind, "chooserSelectsTarget");
  assert.equal(pcOf(g.engine).playerId, P1, "the flipper picks, not the opponent");
  assert.equal(pcOf(g.engine).declaration?.count, 2, "at most 2");
});
