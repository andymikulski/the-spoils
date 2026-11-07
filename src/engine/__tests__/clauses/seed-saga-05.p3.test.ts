// Clause tests, batch seed-saga-05, part p3 (groups 14-20, missing clauses only).
// Undead Sword, Underpaid Ancestor, Unscrupulous Attendant, Accidental Invention,
// Adjunct Artisan, Assistant Mud Whisperer, Braggadocian Aide.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  resourceCard,
  killTactic,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle } from "./_battle.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";

const SWORD = "44086c7e-b01d-416f-8afa-cf6f38acb8f6"; // character banker cost 4 "g" 3/3/3 UNIQUE GIADA -- enters with 2 tokens; -1 str/-1 life per token; HIDE: remove a token, covert this turn
const ANCESTOR = "d3e578e5-d265-4f4d-bda0-017ede7c0d69"; // character banker cost 5 "g" 3/2/4 -- put into your discard from play: may pay 3, put into play under your control, deplete
const ATTENDANT = "a7a34bc7-3003-4334-bc14-8dbeaa98e462"; // character banker cost 4 "g" 2/2/3 -- when a character you control blocks, it gains 1 life this turn
const INVENTION = "2f3de5dd-f373-4e08-bb93-e5451a96d275"; // tactic gearsmith cost 1 "e" -- EXTRA COST reveal a face-down item; may deploy it; draw; discard-pile recursion; FLIP UP 1 [E]
const ARTISAN = "0b084d3b-90e0-4d6b-96e5-ef446ee6ac23"; // character gearsmith cost 3 "e" 0/2/1 -- FABRICATE: deplete, reduce next item / item ability numeric cost by 2
const MUD = "d6aaf1ff-0e80-48b4-b130-e023480d140c"; // character gearsmith cost 5 "e" 3/2/4 -- start of each opponent's turn: may pick a character, restore it
const AIDE = "23bc4bf8-9ea9-486a-8fcb-24ed798a3f11"; // character gearsmith cost 4 "e" 2/3/3 PROVIDES [E] -- start of each opponent's turn: may pick a resource attached to your faction, detach it

const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);
const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const dmg = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].damage ?? 0;
const stat = (engine: SpoilsEngine, id: CardInstanceId, s: "strength" | "life" | "speed") => engine.getStat(id, s);
const hasKw = (engine: SpoilsEngine, id: CardInstanceId, kw: string): boolean =>
  [...(engine.getKeywords(id) as Iterable<unknown>)].some((k) => String(typeof k === "object" && k ? (k as { keyword?: string }).keyword : k) === kw);
const payAnswer = (pay: boolean) => (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc));
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const revealsOf = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

const base = (cards: CardPlacement[], active: PlayerId = P1, extra: Record<string, unknown> = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [...fillers("d1_", 6, P1, "deck"), ...fillers("d2_", 6, P2, "deck"), ...cards],
    ...extra
  } as never);

/** A free tactic that deals `amount` damage to one chosen character in play. */
const zapTactic = (amount: number) =>
  tactic({
    name: "Zap",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic that moves one chosen card from `from` to `to`. */
const moveTactic = (from: "hand" | "play", to: "hand" | "deck" | "discard") =>
  tactic({
    name: "Mover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "m",
          type: "activated",
          targets: [{ id: "t", selector: { zone: from, type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }]
        }
      ]
    }
  });

/** A free tactic that puts one chosen character from hand into play (not a deploy). */
const putTactic = () =>
  tactic({
    name: "Putter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

// ============================================================================
// Undead Sword
// ============================================================================

interface SwordOpts {
  greed?: number;
  rage?: number;
  inPlay?: boolean;
  tokens?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}
function swordBoard(o: SwordOpts = {}) {
  const sw: CardPlacement = o.inPlay
    ? { key: "sw", def: printing(SWORD), owner: P1, zone: "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) }
    : { key: "sw", def: printing(SWORD), owner: P1, zone: "hand" };
  return base(
    [
      sw,
      { key: "blk", def: character({ name: "Blk", strength: 1, speed: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "pal", def: character({ name: "Pal", strength: 1, speed: 1, life: 6 }), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    o.active ?? P1
  );
}

clause(SWORD, "0:unique", "printed as a banker necromorph character: cost 4, threshold [G], 3/3/3 (speed 3), UNIQUE GIADA", () => {
  const c = printing(SWORD);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.deepEqual(c.subtype, ["necromorph"]);
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "g");
  assert.equal(c.strength, 3);
  assert.equal(c.speed, 3);
  assert.equal(c.life, 3);
  assert.equal(c.unique, "giada");
});

clause(SWORD, "0:unique", "deploys for exactly 4 resources with [G]; speed is 3 on the table", () => {
  const g = swordBoard({ greed: 4 });
  assert.equal(ready(g.engine, P1), 4);
  play(g.engine, P1, g.id("sw"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sw")), "play");
  assert.equal(ready(g.engine, P1), 0, "all 4 paid");
  assert.equal(stat(g.engine, g.id("sw"), "speed"), 3);
});

clause(SWORD, "0:unique", "refused one short (3 resources) and refused with 4 resources but no [G]; [G] plus 3 others works", () => {
  const short = swordBoard({ greed: 3 });
  refused(() => play(short.engine, P1, short.id("sw")), "3 resources, cost is 4");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
  assert.equal(ready(short.engine, P1), 3, "nothing paid");
  const noG = swordBoard({ rage: 4 });
  refused(() => play(noG.engine, P1, noG.id("sw")), "4 resources, none [G]");
  assert.equal(zoneOf(noG.engine, noG.id("sw")), "hand");
  assert.equal(ready(noG.engine, P1), 4, "nothing paid");
  const mixed = swordBoard({ greed: 1, rage: 3 });
  play(mixed.engine, P1, mixed.id("sw"));
  assert.equal(zoneOf(mixed.engine, mixed.id("sw")), "play", "control: one [G] is enough");
});

clause(SWORD, "0:unique", "a spent [G] still satisfies the threshold but cannot pay: [G] spent + 3 ready deploys, [G] spent + 2 ready is refused", () => {
  const spentG = (): CardPlacement[] => bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const ok = swordBoard({ rage: 4, extra: spentG() });
  play(ok.engine, P1, ok.id("sw"));
  assert.equal(zoneOf(ok.engine, ok.id("sw")), "play");
  const short = swordBoard({ rage: 3, extra: spentG() });
  refused(() => play(short.engine, P1, short.id("sw")), "only 3 ready");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
});

clause(SWORD, "0:unique", "a second copy under the same controller: the controller chooses which to keep and the other is destroyed (keep the old)", () => {
  const g = swordBoard({ greed: 4, inPlay: true, extra: [{ key: "sw2", def: printing(SWORD), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("sw2"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("sw") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sw")), "play");
  assert.equal(zoneOf(g.engine, g.id("sw2")), "discard");
});

clause(SWORD, "0:unique", "a second copy under the same controller: keep the new one and the old one is destroyed", () => {
  const g = swordBoard({ greed: 4, inPlay: true, extra: [{ key: "sw2", def: printing(SWORD), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("sw2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("sw2") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sw2")), "play");
  assert.equal(zoneOf(g.engine, g.id("sw")), "discard");
});

clause(SWORD, "0:unique", "UNIQUE is per player: the opponent controlling their own Sword does not conflict, and no choice appears", () => {
  const g = swordBoard({ greed: 4, extra: [{ key: "foe", def: printing(SWORD), owner: P2, zone: "play" }] });
  play(g.engine, P1, g.id("sw"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sw")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(SWORD, "0:unique", "UNIQUE counts control, not ownership: a Sword P2 owns but P1 controls conflicts with P1's own Sword", () => {
  const g = swordBoard({ greed: 4, extra: [{ key: "stolen", def: printing(SWORD), owner: P2, controller: P1, zone: "play" }] });
  play(g.engine, P1, g.id("sw"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("sw") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sw")), "play");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
});

clause(SWORD, "1:rule", "enters play with exactly 2 tokens when deployed (none while in hand)", () => {
  const g = swordBoard({ greed: 4 });
  assert.equal(tokensOn(g.engine, g.id("sw")), 0, "none in hand");
  play(g.engine, P1, g.id("sw"));
  assert.equal(tokensOn(g.engine, g.id("sw")), 2);
});

clause(SWORD, "1:rule", "enters play with 2 tokens when put into play by an effect too", () => {
  const g = swordBoard({ extra: [{ key: "put", def: putTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("sw")] } });
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sw")), "play");
  assert.equal(tokensOn(g.engine, g.id("sw")), 2);
});

clause(SWORD, "1:rule", "only the Sword itself entering gets tokens: another card entering leaves a Sword in play at its current count", () => {
  const g = swordBoard({
    inPlay: true,
    tokens: 1,
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(tokensOn(g.engine, g.id("sw")), 1, "unchanged");
  assert.equal(tokensOn(g.engine, g.id("newbie")), 0, "the other card gets no tokens");
});

clause(SWORD, "2:rule", "loses 1 strength and 1 life per token: 0 tokens 3/3, 1 token 2/2, 2 tokens 1/1; speed unchanged", () => {
  for (const [tokens, str, life] of [
    [0, 3, 3],
    [1, 2, 2],
    [2, 1, 1]
  ] as const) {
    const g = swordBoard({ inPlay: true, tokens });
    assert.equal(stat(g.engine, g.id("sw"), "strength"), str, `strength with ${tokens} tokens`);
    assert.equal(stat(g.engine, g.id("sw"), "life"), life, `life with ${tokens} tokens`);
    assert.equal(stat(g.engine, g.id("sw"), "speed"), 3, `speed with ${tokens} tokens`);
  }
});

clause(SWORD, "2:rule", "a freshly deployed Sword is 1/3/1 (2 tokens) in play", () => {
  const g = swordBoard({ greed: 4 });
  play(g.engine, P1, g.id("sw"));
  assert.equal(stat(g.engine, g.id("sw"), "strength"), 1);
  assert.equal(stat(g.engine, g.id("sw"), "life"), 1);
  assert.equal(stat(g.engine, g.id("sw"), "speed"), 3);
});

clause(SWORD, "2:rule", "only the Sword's OWN tokens count: another character's tokens change nothing on it, and its tokens change nothing on others", () => {
  const g = swordBoard({
    inPlay: true,
    tokens: 0,
    extra: [{ key: "other", def: character({ name: "Other", strength: 3, speed: 3, life: 3 }), owner: P2, zone: "play", counters: { token: 2 } }]
  });
  assert.equal(stat(g.engine, g.id("sw"), "strength"), 3);
  assert.equal(stat(g.engine, g.id("sw"), "life"), 3);
  assert.equal(stat(g.engine, g.id("other"), "strength"), 3, "no token penalty on a plain character");
  assert.equal(stat(g.engine, g.id("other"), "life"), 3);
  const h = swordBoard({
    inPlay: true,
    tokens: 2,
    extra: [{ key: "other", def: character({ name: "Other", strength: 3, speed: 3, life: 3 }), owner: P2, zone: "play" }]
  });
  assert.equal(stat(h.engine, h.id("sw"), "life"), 1);
  assert.equal(stat(h.engine, h.id("other"), "strength"), 3, "unaffected by the Sword's tokens");
  assert.equal(stat(h.engine, h.id("other"), "life"), 3);
});

clause(SWORD, "2:rule", "the reduced life matters: 1 damage destroys a 2-token Sword; a 1-token Sword (life 2) and a 0-token Sword survive 1 damage", () => {
  for (const [tokens, dies] of [
    [2, true],
    [1, false],
    [0, false]
  ] as const) {
    const g = swordBoard({ inPlay: true, tokens, extra: [{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("sw")] } });
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("sw")), dies ? "discard" : "play", `${tokens} tokens, 1 damage`);
    if (!dies) assert.equal(dmg(g.engine, g.id("sw")), 1);
  }
});

clause(SWORD, "2:rule", "the penalty shrinks as tokens are removed (HIDE): 2 tokens 1/1, then 1 token 2/2, then 0 tokens 3/3", () => {
  const g = swordBoard({ inPlay: true, tokens: 2 });
  activate(g.engine, P1, g.id("sw"), "hide");
  assert.equal(stat(g.engine, g.id("sw"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("sw"), "life"), 2);
  activate(g.engine, P1, g.id("sw"), "hide");
  assert.equal(stat(g.engine, g.id("sw"), "strength"), 3);
  assert.equal(stat(g.engine, g.id("sw"), "life"), 3);
});

clause(SWORD, "3:ability:hide", "COST removes exactly one token and EFFECT gives this card COVERT; neither before nor on others", () => {
  const g = swordBoard({ inPlay: true, tokens: 2 });
  assert.equal(hasKw(g.engine, g.id("sw"), "covert"), false, "no COVERT before");
  activate(g.engine, P1, g.id("sw"), "hide");
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("sw")), 1, "exactly one token removed");
  assert.equal(hasKw(g.engine, g.id("sw"), "covert"), true);
  assert.equal(hasKw(g.engine, g.id("pal"), "covert"), false, "only this card");
  assert.equal(hasKw(g.engine, g.id("blk"), "covert"), false);
});

clause(SWORD, "3:ability:hide", "can't be used with no tokens left; the third use after two is refused, a 1-token Sword can still use it", () => {
  const none = swordBoard({ inPlay: true, tokens: 0 });
  refused(() => activate(none.engine, P1, none.id("sw"), "hide"), "no token to remove");
  assert.equal(hasKw(none.engine, none.id("sw"), "covert"), false);
  const one = swordBoard({ inPlay: true, tokens: 1 });
  activate(one.engine, P1, one.id("sw"), "hide");
  assert.equal(tokensOn(one.engine, one.id("sw")), 0);
  assert.equal(hasKw(one.engine, one.id("sw"), "covert"), true, "control: one token is enough");
  refused(() => activate(one.engine, P1, one.id("sw"), "hide"), "tokens are gone");
});

clause(SWORD, "3:ability:hide", "a covert Sword can't be blocked by a non-covert character; without HIDE the same blocker may block", () => {
  const plain = swordBoard({ inPlay: true, tokens: 2 });
  declareAttackBy(plain.engine, P1, [plain.id("sw")]);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.deepEqual(plain.engine.state.battle?.blockingParty, [plain.id("blk")], "control: blockable without COVERT");
  const g = swordBoard({ inPlay: true, tokens: 2 });
  activate(g.engine, P1, g.id("sw"), "hide");
  declareAttackBy(g.engine, P1, [g.id("sw")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("blk")]), "a non-covert character can't block a covert attacker");
});

clause(SWORD, "3:ability:hide", "COVERT lasts only this turn: gone once the turn ends", () => {
  const g = swordBoard({ inPlay: true, tokens: 2 });
  activate(g.engine, P1, g.id("sw"), "hide");
  assert.equal(hasKw(g.engine, g.id("sw"), "covert"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(hasKw(g.engine, g.id("sw"), "covert"), false, "gone at the start of the next turn");
  endTurn(g.engine, P2);
  assert.equal(hasKw(g.engine, g.id("sw"), "covert"), false, "and stays gone");
  assert.equal(tokensOn(g.engine, g.id("sw")), 1, "the token stays removed");
});

clause(SWORD, "3:ability:hide", "only the Sword's controller can use it", () => {
  const g = swordBoard({ inPlay: true, tokens: 2 });
  refused(() => activate(g.engine, P2, g.id("sw"), "hide"), "the opponent can't use my Sword's ability");
  assert.equal(tokensOn(g.engine, g.id("sw")), 2);
  activate(g.engine, P1, g.id("sw"), "hide");
  assert.equal(tokensOn(g.engine, g.id("sw")), 1, "control: the controller can");
});

// ============================================================================
// Underpaid Ancestor
// ============================================================================

interface AncOpts {
  greed?: number;
  rage?: number;
  zone?: "play" | "hand";
  owner?: PlayerId;
  controller?: PlayerId;
  extra?: CardPlacement[];
  active?: PlayerId;
}
function ancBoard(o: AncOpts = {}) {
  return base(
    [
      { key: "anc", def: printing(ANCESTOR), owner: o.owner ?? P1, controller: o.controller ?? o.owner ?? P1, zone: o.zone ?? "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    o.active ?? P1
  );
}
const killAnc = (g: ReturnType<typeof ancBoard>) => {
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("anc")] } });
};

clause(ANCESTOR, "0:rule", "printed as a banker ghost mau character: cost 5, threshold [G], 3/2/4", () => {
  const c = printing(ANCESTOR);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.deepEqual(c.subtype, ["ghost", "mau"]);
  assert.equal(c.cost, 5);
  assert.equal(c.threshold, "g");
  assert.equal(c.strength, 3);
  assert.equal(c.speed, 2);
  assert.equal(c.life, 4);
});

clause(ANCESTOR, "0:rule", "deploys for exactly 5 with [G]; refused with 4 greed, refused with 5 rage and no [G]", () => {
  const ok = ancBoard({ zone: "hand", greed: 5 });
  play(ok.engine, P1, ok.id("anc"));
  assert.equal(zoneOf(ok.engine, ok.id("anc")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = ancBoard({ zone: "hand", greed: 4 });
  refused(() => play(short.engine, P1, short.id("anc")), "4 resources, cost 5");
  assert.equal(zoneOf(short.engine, short.id("anc")), "hand");
  assert.equal(ready(short.engine, P1), 4);
  const noG = ancBoard({ zone: "hand", rage: 5 });
  refused(() => play(noG.engine, P1, noG.id("anc")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("anc")), "hand");
  const spentG = ancBoard({
    zone: "hand",
    rage: 4,
    extra: bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  });
  refused(() => play(spentG.engine, P1, spentG.id("anc")), "spent [G] satisfies the threshold but 4 ready is short");
  const spentOk = ancBoard({
    zone: "hand",
    rage: 5,
    extra: bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  });
  play(spentOk.engine, P1, spentOk.id("anc"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("anc")), "play", "control: 5 ready + spent [G]");
});

clause(ANCESTOR, "0:rule", "destroyed in play, the controller may pay 3: it returns to play under their control, depleted, and 3 resources are paid", () => {
  const g = ancBoard({ greed: 5 });
  killAnc(g);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  assert.equal(pending(g.engine)?.playerId, P1);
  assert.equal(zoneOf(g.engine, g.id("anc")), "discard", "waits in the discard while the prompt is open");
  drain(g.engine, payAnswer(true));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("anc")), "play");
  assert.equal(g.engine.state.cards[g.id("anc")].controllerId, P1);
  assert.equal(g.engine.state.cards[g.id("anc")].depleted, true, "Deplete it");
  assert.equal(dmg(g.engine, g.id("anc")), 0, "comes back without damage");
  assert.equal(attachedCount(g.engine, P1), 3, "paid exactly 3");
  assert.equal(ready(g.engine, P1), 2);
});

clause(ANCESTOR, "0:rule", "declining the payment leaves it in the discard pile and pays nothing", () => {
  const g = ancBoard({ greed: 5 });
  killAnc(g);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  drain(g.engine, payAnswer(false));
  assert.equal(zoneOf(g.engine, g.id("anc")), "discard");
  assert.equal(attachedCount(g.engine, P1), 0);
  assert.equal(ready(g.engine, P1), 5);
});

clause(ANCESTOR, "0:rule", "needs 3 to pay: with exactly 3 it returns; with only 2 it cannot be paid and stays in the discard", () => {
  const exact = ancBoard({ greed: 3 });
  killAnc(exact);
  drain(exact.engine, payAnswer(true));
  assert.equal(zoneOf(exact.engine, exact.id("anc")), "play", "exactly 3 is enough");
  assert.equal(ready(exact.engine, P1), 0);
  const short = ancBoard({ greed: 2 });
  killAnc(short);
  if (pending(short.engine)) {
    refused(() => answerPending(short.engine, "mayPay", { pay: true }), "only 2 resources can't pay 3");
    drain(short.engine, payAnswer(false));
  }
  assert.equal(pending(short.engine), undefined);
  assert.equal(zoneOf(short.engine, short.id("anc")), "discard");
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
});

clause(ANCESTOR, "0:rule", "it recurs every time: destroyed again after returning, it offers payment again", () => {
  const g = ancBoard({ greed: 6, extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  killAnc(g);
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("anc")), "play");
  play(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("anc")] } });
  assert.equal(pending(g.engine)?.kind, "mayPay", "asks again");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("anc")), "play");
  assert.equal(g.engine.state.cards[g.id("anc")].depleted, true);
  assert.equal(attachedCount(g.engine, P1), 6, "3 paid each time");
});

clause(ANCESTOR, "0:rule", "also works when it dies in battle", () => {
  const g = base(
    [
      { key: "anc", def: printing(ANCESTOR), owner: P1, zone: "play" },
      { key: "big", def: character({ name: "Big", strength: 9, speed: 1, life: 9 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ],
    P2
  );
  declareAttackBy(g.engine, P2, [g.id("big")]);
  declareBlockers(g.engine, P1, [g.id("anc")]);
  finishBattle(g.engine, undefined, payAnswer(true));
  drain(g.engine, payAnswer(true));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("anc")), "play", "returned after dying in battle");
  assert.equal(g.engine.state.cards[g.id("anc")].depleted, true);
  assert.equal(ready(g.engine, P1), 0, "3 paid");
});

clause(ANCESTOR, "0:rule", "only from play to the discard pile: discarded from hand, returned to hand, or put on the deck does not trigger", () => {
  const fromHand = ancBoard({ zone: "hand", greed: 3, extra: [{ key: "mv", def: moveTactic("hand", "discard"), owner: P1, zone: "hand" }] });
  play(fromHand.engine, P1, fromHand.id("mv"), { selected: { t: [fromHand.id("anc")] } });
  assert.equal(pending(fromHand.engine), undefined, "hand to discard: no trigger");
  assert.equal(zoneOf(fromHand.engine, fromHand.id("anc")), "discard");
  const toHand = ancBoard({ greed: 3, extra: [{ key: "mv", def: moveTactic("play", "hand"), owner: P1, zone: "hand" }] });
  play(toHand.engine, P1, toHand.id("mv"), { selected: { t: [toHand.id("anc")] } });
  assert.equal(pending(toHand.engine), undefined, "play to hand: no trigger");
  assert.equal(zoneOf(toHand.engine, toHand.id("anc")), "hand");
  const toDeck = ancBoard({ greed: 3, extra: [{ key: "mv", def: moveTactic("play", "deck"), owner: P1, zone: "hand" }] });
  play(toDeck.engine, P1, toDeck.id("mv"), { selected: { t: [toDeck.id("anc")] } });
  assert.equal(pending(toDeck.engine), undefined, "play to deck: no trigger");
  assert.equal(zoneOf(toDeck.engine, toDeck.id("anc")), "deck");
  const control = ancBoard({ greed: 3, extra: [{ key: "mv", def: moveTactic("play", "discard"), owner: P1, zone: "hand" }] });
  play(control.engine, P1, control.id("mv"), { selected: { t: [control.id("anc")] } });
  assert.equal(pending(control.engine)?.kind, "mayPay", "control: play to discard does trigger");
});

clause(ANCESTOR, "0:rule", "only for itself: another character of mine dying does not return the Ancestor or prompt", () => {
  const g = ancBoard({ greed: 3, extra: [{ key: "pal", def: character({ name: "Pal", life: 1 }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("pal")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("pal")), "discard");
  assert.equal(zoneOf(g.engine, g.id("anc")), "play");
});

clause(ANCESTOR, "0:rule", "an Ancestor stolen from the opponent goes to ITS OWNER's discard pile, not 'your' discard pile: no recursion prompt", () => {
  const g = ancBoard({ owner: P2, controller: P1, greed: 3 });
  killAnc(g);
  assert.equal(zoneOf(g.engine, g.id("anc")), "discard");
  assert.ok(g.engine.state.players[P2].discard.includes(g.id("anc")), "in its owner's discard pile");
  assert.equal(pending(g.engine), undefined, "it was not put into the controller's discard pile");
  assert.equal(zoneOf(g.engine, g.id("anc")), "discard");
});

// ============================================================================
// Unscrupulous Attendant
// ============================================================================

interface AttOpts {
  /** who controls the Attendant */
  attCtl?: PlayerId;
  attOwner?: PlayerId;
  extra?: CardPlacement[];
}
/** P1 attacks with `atk` (str 1 speed 1 life 9); P2 has blockers b1, b2 (str 1 life 2) and an idle character. */
function attBoardAttackOnP2(o: AttOpts = {}) {
  const ctl = o.attCtl ?? P2;
  return base(
    [
      { key: "att", def: printing(ATTENDANT), owner: o.attOwner ?? ctl, controller: ctl, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, speed: 1, life: 2 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, speed: 1, life: 2 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, speed: 1, life: 2 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    P1
  );
}
/** P2 attacks; P1 has blockers b1, b2 and an idle character. */
function attBoardAttackOnP1(o: AttOpts = {}) {
  const ctl = o.attCtl ?? P1;
  return base(
    [
      { key: "att", def: printing(ATTENDANT), owner: o.attOwner ?? ctl, controller: ctl, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, speed: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, speed: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, speed: 1, life: 2 }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ],
    P2
  );
}
const blockWith = (g: { engine: SpoilsEngine; id: (k: string) => CardInstanceId }, attacker: PlayerId, blockerKeys: string[]) => {
  declareAttackBy(g.engine, attacker, [g.id("atk")]);
  declareBlockers(g.engine, attacker === P1 ? P2 : P1, blockerKeys.map((k) => g.id(k)));
  drain(g.engine, declineAll);
  resolvePendingResponses(g.engine);
};

clause(ATTENDANT, "0:rule", "printed as a banker attendant: cost 4, threshold [G], 2/2/3; deploys for exactly 4 with [G] and is refused short", () => {
  const c = printing(ATTENDANT);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "banker");
  assert.deepEqual(c.subtype, ["attendant"]);
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "g");
  assert.equal(c.strength, 2);
  assert.equal(c.speed, 2);
  assert.equal(c.life, 3);
  const mk = (cards: CardPlacement[]) => base([{ key: "att", def: printing(ATTENDANT), owner: P1, zone: "hand" }, ...cards]);
  const ok = mk(bank("greed", 4, P1));
  play(ok.engine, P1, ok.id("att"));
  assert.equal(zoneOf(ok.engine, ok.id("att")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = mk(bank("greed", 3, P1));
  refused(() => play(short.engine, P1, short.id("att")), "3 resources, cost 4");
  assert.equal(zoneOf(short.engine, short.id("att")), "hand");
  const noG = mk(bank("rage", 4, P1));
  refused(() => play(noG.engine, P1, noG.id("att")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("att")), "hand");
  const spentOnly = mk([...bank("rage", 3, P1), ...bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]);
  refused(() => play(spentOnly.engine, P1, spentOnly.id("att")), "a spent [G] meets the threshold but 3 ready is short");
});

clause(ATTENDANT, "0:rule", "a character I control that blocks gains 1 life this turn; a non-blocking character of mine does not", () => {
  const g = attBoardAttackOnP2();
  blockWith(g, P1, ["b1"]);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("b1")]);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 3, "2 + 1");
  assert.equal(stat(g.engine, g.id("idle"), "life"), 2, "idle character unchanged");
  assert.equal(stat(g.engine, g.id("att"), "life"), 3, "the Attendant itself is not blocking");
  assert.equal(stat(g.engine, g.id("atk"), "life"), 9, "the attacker is not a blocker");
});

clause(ATTENDANT, "0:rule", "the Attendant itself gains the life when it blocks (it is a character I control)", () => {
  const g = attBoardAttackOnP2();
  blockWith(g, P1, ["att"]);
  assert.equal(stat(g.engine, g.id("att"), "life"), 4, "3 + 1");
});

clause(ATTENDANT, "0:rule", "every blocker gains 1 life: two blockers each get +1, and the gain is exactly 1", () => {
  const g = attBoardAttackOnP2();
  blockWith(g, P1, ["b1", "b2"]);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 3);
  assert.equal(stat(g.engine, g.id("b2"), "life"), 3);
  assert.equal(stat(g.engine, g.id("idle"), "life"), 2);
});

clause(ATTENDANT, "0:rule", "works for the player on either side: my Attendant boosts my blockers when the OPPONENT attacks", () => {
  const g = attBoardAttackOnP1();
  blockWith(g, P2, ["b1"]);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 3);
  assert.equal(stat(g.engine, g.id("idle"), "life"), 2);
});

clause(ATTENDANT, "0:rule", "a blocker the opponent controls gets nothing from my Attendant", () => {
  const g = attBoardAttackOnP2({ attCtl: P1 });
  blockWith(g, P1, ["b1"]);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("b1")]);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 2, "P2's blocker is not a character I control");
  assert.equal(stat(g.engine, g.id("atk"), "life"), 9, "my attacker is not a blocker either");
});

clause(ATTENDANT, "0:rule", "'you control' means controller: an Attendant P2 owns but P1 controls boosts P1's blockers; a blocker P2 owns but P1 controls also gains", () => {
  const g = attBoardAttackOnP1({
    attOwner: P2,
    extra: [{ key: "borrowed", def: character({ name: "Borrowed", strength: 1, speed: 1, life: 2 }), owner: P2, controller: P1, zone: "play" }]
  });
  blockWith(g, P2, ["borrowed"]);
  assert.equal(stat(g.engine, g.id("borrowed"), "life"), 3, "controlled blocker gains");
  const h = attBoardAttackOnP1({ attOwner: P2, attCtl: P2 });
  declareAttackBy(h.engine, P2, [h.id("atk")]);
  declareBlockers(h.engine, P1, [h.id("b1")]);
  drain(h.engine, declineAll);
  assert.equal(stat(h.engine, h.id("b1"), "life"), 2, "an Attendant P2 controls does not boost P1's blocker");
});

clause(ATTENDANT, "0:rule", "the extra life is real: a 2-life blocker survives 2 damage with an Attendant, but dies without one", () => {
  const strong = (extra: CardPlacement[], withAttendant: boolean) =>
    base(
      [
        ...(withAttendant ? [{ key: "att", def: printing(ATTENDANT), owner: P2, zone: "play" } as CardPlacement] : []),
        { key: "atk", def: character({ name: "Atk", strength: 2, speed: 1, life: 9 }), owner: P1, zone: "play" },
        { key: "b1", def: character({ name: "B1", strength: 1, speed: 1, life: 2 }), owner: P2, zone: "play" },
        ...extra
      ],
      P1
    );
  const a = strong([], true);
  declareAttackBy(a.engine, P1, [a.id("atk")]);
  declareBlockers(a.engine, P2, [a.id("b1")]);
  finishBattle(a.engine);
  assert.equal(zoneOf(a.engine, a.id("b1")), "play", "survives with the Attendant");
  assert.equal(dmg(a.engine, a.id("b1")), 2);
  const b = strong([], false);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("b1")), "discard", "control: dies without it");
});

clause(ATTENDANT, "0:rule", "the gain lasts only this turn: gone when the turn ends", () => {
  const g = attBoardAttackOnP2();
  blockWith(g, P1, ["b1"]);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 3);
  finishBattle(g.engine);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 3, "still this turn after the battle");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 2, "back to printed life next turn");
});

clause(ATTENDANT, "0:rule", "two Attendants each trigger: the blocker gains 2 life", () => {
  const g = attBoardAttackOnP2({ extra: [{ key: "att2", def: printing(ATTENDANT), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("b1")]);
  drain(g.engine, declineAll);
  resolvePendingResponses(g.engine);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 4, "2 + 1 + 1");
});

clause(ATTENDANT, "0:rule", "does not trigger when nothing blocks or the Attendant is not in play", () => {
  const g = attBoardAttackOnP2();
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, []);
  drain(g.engine, declineAll);
  assert.equal(stat(g.engine, g.id("b1"), "life"), 2);
  assert.equal(stat(g.engine, g.id("att"), "life"), 3);
  const h = base(
    [
      { key: "att", def: printing(ATTENDANT), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, speed: 1, life: 2 }), owner: P2, zone: "play" }
    ],
    P1
  );
  declareAttackBy(h.engine, P1, [h.id("atk")]);
  declareBlockers(h.engine, P2, [h.id("b1")]);
  drain(h.engine, declineAll);
  assert.equal(stat(h.engine, h.id("b1"), "life"), 2, "an Attendant in hand does nothing");
});

// ============================================================================
// Accidental Invention
// ============================================================================

const GIZMO = (cost = 2, threshold?: string) =>
  item({ name: "Gizmo", cost, trade: "gearsmith", ...(threshold ? { threshold } : {}) } as never);
const PROVIDER = (icons: string[], name = "Prov") => character({ name, cost: 0, resource: { provides: icons } } as never);
const spent = (icon: "rage" | "elitism" | "greed", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

interface InvOpts {
  elit?: number;
  rage?: number;
  greed?: number;
  invZone?: "hand" | "play" | "discard" | "deck";
  gizmoCost?: number;
  gizmoThreshold?: string;
  gizmoSpent?: boolean;
  noGizmo?: boolean;
  extra?: CardPlacement[];
  active?: PlayerId;
}
function invBoard(o: InvOpts = {}) {
  const invZone = o.invZone ?? "hand";
  return base(
    [
      invZone === "play"
        ? { key: "inv", def: printing(INVENTION), owner: P1, zone: "play", faceDown: true }
        : { key: "inv", def: printing(INVENTION), owner: P1, zone: invZone },
      ...(o.noGizmo
        ? []
        : [
            {
              key: "gz",
              def: GIZMO(o.gizmoCost ?? 2, o.gizmoThreshold),
              owner: P1,
              zone: "play",
              faceDown: true,
              ...(o.gizmoSpent ? { attachedToKey: "__factionA" } : {})
            } as CardPlacement
          ]),
      ...bank("elitism", o.elit ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ],
    o.active ?? P1
  );
}
type InvGame = ReturnType<typeof invBoard>;
const playInv = (g: InvGame, target = "gz") => play(g.engine, P1, g.id("inv"), { selected: { revealed: [g.id(target)] } });
const deployAnswer = (cardId: CardInstanceId | undefined) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "deployForFree" ? { kind: "deployForFree", cardId } : declineAll(pc);

clause(INVENTION, "0:extraCost", "printed as a gearsmith tactic: cost 1, threshold [E]", () => {
  const c = printing(INVENTION);
  assert.equal(c.type, "tactic");
  assert.equal(c.trade, "gearsmith");
  assert.equal(c.cost, 1);
  assert.equal(c.threshold, "e");
});

clause(INVENTION, "0:extraCost", "deploys for exactly 1 resource with [E] (cost 1): with an exact board the tactic is spent", () => {
  const g = invBoard({ elit: 1, gizmoSpent: true });
  assert.equal(ready(g.engine, P1), 1, "setup: just the [E] resource is ready");
  playInv(g);
  drain(g.engine, deployAnswer(undefined));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
  assert.equal(ready(g.engine, P1), 0, "cost 1 paid");
});

clause(INVENTION, "0:extraCost", "refused with nothing ready (cost 1 unaffordable) even though [E] is among the spent resources", () => {
  const g = invBoard({ gizmoSpent: true, extra: spent("elitism", 1) });
  assert.equal(ready(g.engine, P1), 0);
  refused(() => playInv(g), "no ready resource to pay 1");
  assert.equal(zoneOf(g.engine, g.id("inv")), "hand");
  const ok = invBoard({ gizmoSpent: true, elit: 1 });
  playInv(ok);
  drain(ok.engine, deployAnswer(undefined));
  assert.equal(zoneOf(ok.engine, ok.id("inv")), "discard", "control: one ready [E]");
});

clause(INVENTION, "0:extraCost", "refused without [E]: plenty of Rage and a face-down item are not enough", () => {
  const g = invBoard({ rage: 3 });
  refused(() => playInv(g), "no [E] icon");
  assert.equal(zoneOf(g.engine, g.id("inv")), "hand");
  assert.equal(ready(g.engine, P1), 4, "nothing paid (3 Rage + the face-down item)");
  const ok = invBoard({ rage: 2, elit: 1 });
  playInv(ok);
  drain(ok.engine, deployAnswer(undefined));
  assert.equal(zoneOf(ok.engine, ok.id("inv")), "discard", "control: with an [E]");
});

clause(INVENTION, "0:extraCost", "the revealed card must be a face-down item I control: face-up item, face-down character, opponent's face-down item and no pick are all refused", () => {
  const mk = () =>
    invBoard({
      elit: 2,
      extra: [
        { key: "up", def: item({ name: "UpItem", cost: 1 }), owner: P1, zone: "play" },
        { key: "fdc", def: character({ name: "FdChar" }), owner: P1, zone: "play", faceDown: true },
        { key: "opp", def: item({ name: "OppItem", cost: 1 }), owner: P2, zone: "play", faceDown: true }
      ]
    });
  for (const key of ["up", "fdc", "opp"]) {
    const g = mk();
    refused(() => playInv(g, key), `${key} is not a face-down item I control`);
    assert.equal(zoneOf(g.engine, g.id("inv")), "hand", `${key}: tactic not played`);
    assert.equal(ready(g.engine, P1), 4, `${key}: nothing paid (2 [E], the Gizmo and the face-down character are ready)`);
  }
  const none = mk();
  refused(() => play(none.engine, P1, none.id("inv"), { selected: { revealed: [] } }), "no item revealed");
  assert.equal(zoneOf(none.engine, none.id("inv")), "hand");
  const ok = mk();
  playInv(ok);
  drain(ok.engine, deployAnswer(undefined));
  assert.equal(zoneOf(ok.engine, ok.id("inv")), "discard", "control: a face-down item I control");
});

clause(INVENTION, "0:extraCost", "no face-down item at all: cannot be deployed", () => {
  const g = invBoard({ elit: 2, noGizmo: true });
  refused(() => play(g.engine, P1, g.id("inv"), { selected: { revealed: [] } }), "nothing to reveal");
  assert.equal(zoneOf(g.engine, g.id("inv")), "hand");
});

clause(INVENTION, "0:extraCost", "the item is revealed (a cardsRevealed event is logged) and a revealed item stays where it is (face-down in play) when not deployed", () => {
  const g = invBoard({ elit: 2 });
  playInv(g);
  drain(g.engine, deployAnswer(undefined));
  assert.equal(revealsOf(g.engine).length, 1);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, true);
});

clause(INVENTION, "1:rule", "'You may deploy the item': accepting deploys it face-up as an item", () => {
  const g = invBoard({ elit: 2, rage: 4, gizmoCost: 2 });
  playInv(g);
  assert.equal(pending(g.engine)?.kind, "deployForFree");
  assert.equal(pending(g.engine)?.playerId, P1);
  drain(g.engine, deployAnswer(g.id("gz")));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, false, "now face-up");
  assert.equal(g.engine.getDefinition(g.id("gz")).type, "item");
});

clause(INVENTION, "1:rule", "a plain 'deploy' pays the item's numeric cost (2) on top of the tactic's 1", () => {
  const g = invBoard({ elit: 2, rage: 4, gizmoCost: 2, gizmoSpent: true });
  const before = ready(g.engine, P1);
  playInv(g);
  drain(g.engine, deployAnswer(g.id("gz")));
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, false);
  assert.equal(before - ready(g.engine, P1), 3, "1 for the tactic + 2 for the Gizmo");
});

clause(INVENTION, "1:rule", "declining the deploy: the item stays face-down in play, and the card is still drawn", () => {
  const g = invBoard({ elit: 2 });
  const top = deckOf(g.engine, P1)[0];
  playInv(g);
  assert.equal(pending(g.engine)?.kind, "deployForFree");
  drain(g.engine, deployAnswer(undefined));
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, true);
  assert.ok(handOf(g.engine, P1).includes(top), "drew the top card");
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(INVENTION, "1:rule", "Draw a card: exactly one card from the top of my deck, deploy or not; the opponent draws nothing", () => {
  const accepted = invBoard({ elit: 2, rage: 4 });
  const deckBefore = [...deckOf(accepted.engine, P1)];
  const oppBefore = handOf(accepted.engine, P2).length;
  playInv(accepted);
  drain(accepted.engine, deployAnswer(accepted.id("gz")));
  assert.deepEqual(handOf(accepted.engine, P1), [deckBefore[0]]);
  assert.deepEqual(deckOf(accepted.engine, P1), deckBefore.slice(1));
  assert.equal(handOf(accepted.engine, P2).length, oppBefore);
});

clause(INVENTION, "1:rule", "the item's threshold still applies: a [R] item can't be deployed without [R]; it can with one", () => {
  const no = invBoard({ elit: 2, gizmoCost: 1, gizmoThreshold: "r" });
  playInv(no);
  assert.equal(pending(no.engine)?.kind, "deployForFree");
  refused(() => drain(no.engine, deployAnswer(no.id("gz")), 1), "no [R] icon for the item");
  assert.equal(no.engine.state.cards[no.id("gz")].faceDown, true);
  drain(no.engine, deployAnswer(undefined));
  assert.equal(no.engine.state.cards[no.id("gz")].faceDown, true);
  const yes = invBoard({ elit: 2, rage: 1, gizmoCost: 1, gizmoThreshold: "r" });
  playInv(yes);
  drain(yes.engine, deployAnswer(yes.id("gz")));
  assert.equal(yes.engine.state.cards[yes.id("gz")].faceDown, false, "control: with [R]");
});

clause(INVENTION, "1:rule", "the tactic itself is spent after resolving (goes to the discard pile)", () => {
  const g = invBoard({ elit: 2 });
  playInv(g);
  drain(g.engine, deployAnswer(undefined));
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
});

// -- discard-pile recursion -------------------------------------------------

const provPlay = (g: InvGame, key: string, player: PlayerId = P1) => play(g.engine, player, g.id(key));
const recurBoard = (o: InvOpts = {}, icons: string[] = ["elitism"]) =>
  invBoard({
    invZone: "discard",
    noGizmo: true,
    rage: 3,
    ...o,
    extra: [{ key: "prov", def: PROVIDER(icons), owner: P1, zone: "hand" }, ...(o.extra ?? [])]
  });

clause(INVENTION, "2:rule", "from the discard pile, a card providing [E] entering play under my control offers to pay 2: paying puts it into play face-down as a resource", () => {
  const g = recurBoard();
  provPlay(g, "prov");
  assert.equal(zoneOf(g.engine, g.id("prov")), "play");
  assert.equal(pending(g.engine)?.kind, "mayPay");
  assert.equal(pending(g.engine)?.playerId, P1);
  drain(g.engine, payAnswer(true));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("inv")), "play");
  assert.equal(g.engine.state.cards[g.id("inv")].faceDown, true, "face-down");
  assert.equal(g.engine.state.cards[g.id("inv")].controllerId, P1);
  assert.equal(attachedCount(g.engine, P1), 2, "paid exactly 2");
});

clause(INVENTION, "2:rule", "declining leaves it in the discard pile and pays nothing", () => {
  const g = recurBoard();
  provPlay(g, "prov");
  assert.equal(pending(g.engine)?.kind, "mayPay");
  drain(g.engine, payAnswer(false));
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(INVENTION, "2:rule", "needs 2: exactly 2 ready works, 1 ready can't pay", () => {
  const exact = recurBoard({ rage: 2 });
  provPlay(exact, "prov");
  drain(exact.engine, payAnswer(true));
  assert.equal(zoneOf(exact.engine, exact.id("inv")), "play", "exactly 2");
  const short = recurBoard({ rage: 1 });
  provPlay(short, "prov");
  if (pending(short.engine)) {
    refused(() => answerPending(short.engine, "mayPay", { pay: true }), "1 resource can't pay 2");
    drain(short.engine, payAnswer(false));
  }
  assert.equal(pending(short.engine), undefined);
  assert.equal(zoneOf(short.engine, short.id("inv")), "discard");
  assert.equal(ready(short.engine, P1), 1);
});

clause(INVENTION, "2:rule", "'provides at least [E]': a card providing [E] and [R], or [E][E], qualifies; one providing only [R] or [G] does not", () => {
  for (const icons of [["elitism", "rage"], ["elitism", "elitism"]]) {
    const g = recurBoard({}, icons);
    provPlay(g, "prov");
    assert.equal(pending(g.engine)?.kind, "mayPay", `provides ${icons}`);
  }
  for (const icons of [["rage"], ["greed"], ["obsession"], ["deception"]]) {
    const g = recurBoard({}, icons);
    provPlay(g, "prov");
    assert.equal(pending(g.engine), undefined, `provides ${icons}: no trigger`);
    assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
  }
  const none = recurBoard({}, []);
  provPlay(none, "prov");
  assert.equal(pending(none.engine), undefined, "provides nothing: no trigger");
});

clause(INVENTION, "2:rule", "also fires for the real Braggadocian Aide (PROVIDES [E]) entering play", () => {
  const g = base([
    { key: "inv", def: printing(INVENTION), owner: P1, zone: "discard" },
    { key: "aide", def: printing(AIDE), owner: P1, zone: "hand" },
    ...bank("elitism", 6, P1)
  ]);
  play(g.engine, P1, g.id("aide"));
  assert.equal(pending(g.engine)?.kind, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("inv")), "play");
  assert.equal(g.engine.state.cards[g.id("inv")].faceDown, true);
});

clause(INVENTION, "2:rule", "only for cards entering under MY control: the opponent's [E] provider entering does not trigger it", () => {
  const g = invBoard({
    invZone: "discard",
    noGizmo: true,
    rage: 3,
    active: P2,
    extra: [{ key: "oprov", def: PROVIDER(["elitism"], "OppProv"), owner: P2, zone: "hand" }]
  });
  provPlay(g, "oprov", P2);
  assert.equal(zoneOf(g.engine, g.id("oprov")), "play");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
});

clause(INVENTION, "2:rule", "also triggers when the provider is put into play by an effect rather than deployed", () => {
  const g = invBoard({ invZone: "discard", noGizmo: true, rage: 3, extra: [{ key: "put", def: putTactic(), owner: P1, zone: "hand" }, { key: "prov", def: PROVIDER(["elitism"]), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("prov")] } });
  assert.equal(pending(g.engine)?.kind, "mayPay");
  drain(g.engine, payAnswer(true));
  assert.equal(zoneOf(g.engine, g.id("inv")), "play");
});

clause(INVENTION, "2:rule", "'under your control' follows control, not ownership: a provider P2 owns but I control triggers; one I own but P2 controls does not", () => {
  const mine = invBoard({ invZone: "discard", noGizmo: true, rage: 3, extra: [{ key: "bprov", def: PROVIDER(["elitism"], "Borrowed"), owner: P2, controller: P1, zone: "hand" }] });
  play(mine.engine, P1, mine.id("bprov"));
  assert.equal(mine.engine.state.cards[mine.id("bprov")].controllerId, P1);
  assert.equal(pending(mine.engine)?.kind, "mayPay", "entered under my control");
  const theirs = invBoard({ invZone: "discard", noGizmo: true, rage: 3, active: P2, extra: [{ key: "lent", def: PROVIDER(["elitism"], "Lent"), owner: P1, controller: P2, zone: "hand" }] });
  play(theirs.engine, P2, theirs.id("lent"));
  assert.equal(theirs.engine.state.cards[theirs.id("lent")].controllerId, P2);
  assert.equal(pending(theirs.engine), undefined, "entered under the opponent's control");
  assert.equal(zoneOf(theirs.engine, theirs.id("inv")), "discard");
});

clause(INVENTION, "2:rule", "only while in the discard pile: in hand, in the deck or face-down in play it does nothing", () => {
  for (const invZone of ["hand", "deck", "play"] as const) {
    const g = recurBoard({ invZone });
    provPlay(g, "prov");
    assert.equal(zoneOf(g.engine, g.id("prov")), "play");
    assert.equal(pending(g.engine), undefined, `${invZone}: no trigger`);
    assert.equal(zoneOf(g.engine, g.id("inv")), invZone);
  }
});

clause(INVENTION, "2:rule", "a face-down card entering play provides only Volition: developing an [E] provider face-down does not trigger", () => {
  const down = recurBoard();
  developResource(down.engine, P1, down.id("prov"), true);
  assert.equal(zoneOf(down.engine, down.id("prov")), "play");
  assert.equal(pending(down.engine), undefined, "face-down provides Volition only");
  assert.equal(zoneOf(down.engine, down.id("inv")), "discard");
});

clause(INVENTION, "2:rule", "an [E] resource developed face-up enters play providing [E]: the recursion offer appears", () => {
  const up = recurBoard({
    extra: [{ key: "rprov", def: resourceCard({ name: "ElitProv", resource: { provides: ["elitism"] } } as never), owner: P1, zone: "hand" }]
  });
  developResource(up.engine, P1, up.id("rprov"), false);
  assert.equal(zoneOf(up.engine, up.id("rprov")), "play");
  assert.equal(pending(up.engine)?.kind, "mayPay", "face-up resource provides [E]");
});

clause(INVENTION, "2:rule", "the card put into play is Accidental Invention itself, a tactic face-down: it counts as a resource and can be flipped up later", () => {
  const g = recurBoard({ rage: 3 });
  provPlay(g, "prov");
  const before = ready(g.engine, P1);
  drain(g.engine, payAnswer(true));
  assert.equal(g.engine.getDefinition(g.id("inv")).type, "tactic");
  assert.equal(ready(g.engine, P1), before - 2 + 1, "2 paid, but the new face-down resource is ready");
});

// -- FLIP UP -----------------------------------------------------------------

clause(INVENTION, "3:flipUp", "a face-down Invention flips up for 1 with [E] among the others: reveals the item, may deploy it, draws a card, and goes to the discard pile", () => {
  const g = invBoard({ invZone: "play", elit: 1, rage: 1 });
  const top = deckOf(g.engine, P1)[0];
  rawFlipUp(g.engine, P1, g.id("inv"), { revealed: [g.id("gz")] });
  drain(g.engine, deployAnswer(undefined));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
  assert.ok(handOf(g.engine, P1).includes(top), "drew a card");
  assert.equal(revealsOf(g.engine).length, 1, "the item was revealed");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, true, "declined to deploy");
});

clause(INVENTION, "3:flipUp", "FLIP UP can deploy the revealed item too", () => {
  const g = invBoard({ invZone: "play", elit: 1, rage: 3, gizmoCost: 1 });
  rawFlipUp(g.engine, P1, g.id("inv"), { revealed: [g.id("gz")] });
  assert.equal(pending(g.engine)?.kind, "deployForFree");
  drain(g.engine, deployAnswer(g.id("gz")));
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
});

clause(INVENTION, "3:flipUp", "flips up for exactly 1 [E] + itself: an exact board (spent [E], itself the only ready resource) works", () => {
  const g = invBoard({ invZone: "play", gizmoSpent: true, extra: spent("elitism", 1) });
  assert.equal(ready(g.engine, P1), 1, "only the Invention itself is ready");
  rawFlipUp(g.engine, P1, g.id("inv"), { revealed: [g.id("gz")] });
  drain(g.engine, deployAnswer(undefined));
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard", "the card may pay for its own FLIP UP cost");
});

clause(INVENTION, "3:flipUp", "FLIP UP costs 1, not the printed 1 plus more: the cost is paid from ready resources (2 spare stay)", () => {
  const g = invBoard({ invZone: "play", elit: 1, rage: 3 });
  const before = ready(g.engine, P1);
  rawFlipUp(g.engine, P1, g.id("inv"), { revealed: [g.id("gz")] });
  drain(g.engine, deployAnswer(undefined));
  const after = ready(g.engine, P1);
  // The Invention leaves play (a face-down resource goes away), so the pool shrinks by one for that, plus 1 paid unless it paid for itself.
  assert.ok(after === before - 1 || after === before - 2, `paid exactly 1: before ${before}, after ${after}`);
});

clause(INVENTION, "3:flipUp", "refused without an [E] among the other resources (Rage only; and its own Volition doesn't count)", () => {
  const rageOnly = invBoard({ invZone: "play", rage: 5 });
  refused(() => rawFlipUp(rageOnly.engine, P1, rageOnly.id("inv"), { revealed: [rageOnly.id("gz")] }), "no [E]");
  assert.equal(rageOnly.engine.state.cards[rageOnly.id("inv")].faceDown, true);
  const alone = invBoard({ invZone: "play" });
  refused(() => rawFlipUp(alone.engine, P1, alone.id("inv"), { revealed: [alone.id("gz")] }), "alone");
  assert.equal(alone.engine.state.cards[alone.id("inv")].faceDown, true);
  const ok = invBoard({ invZone: "play", elit: 1 });
  rawFlipUp(ok.engine, P1, ok.id("inv"), { revealed: [ok.id("gz")] });
  drain(ok.engine, deployAnswer(undefined));
  assert.equal(zoneOf(ok.engine, ok.id("inv")), "discard", "control: one [E] is enough");
});

clause(INVENTION, "3:flipUp", "FLIP UP still needs the extra cost: a face-down item to reveal (none, a face-up item or a character is refused)", () => {
  const none = invBoard({ invZone: "play", elit: 2, noGizmo: true });
  refused(() => rawFlipUp(none.engine, P1, none.id("inv"), { revealed: [] }), "nothing to reveal");
  assert.equal(none.engine.state.cards[none.id("inv")].faceDown, true);
  const up = invBoard({ invZone: "play", elit: 2, noGizmo: true, extra: [{ key: "up", def: item({ name: "UpItem", cost: 1 }), owner: P1, zone: "play" }] });
  refused(() => rawFlipUp(up.engine, P1, up.id("inv"), { revealed: [up.id("up")] }), "face-up item");
  assert.equal(up.engine.state.cards[up.id("inv")].faceDown, true);
});

clause(INVENTION, "3:flipUp", "as a tactic it may be flipped up in an opponent's response window", () => {
  const g = invBoard({ invZone: "play", elit: 1, rage: 1, active: P2, extra: [{ key: "foe", def: character({ name: "Foe", strength: 1, speed: 1, life: 4 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  rawFlipUp(g.engine, P1, g.id("inv"), { revealed: [g.id("gz")] });
  drain(g.engine, deployAnswer(undefined));
  assert.equal(zoneOf(g.engine, g.id("inv")), "discard");
});

// ============================================================================
// Adjunct Artisan
// ============================================================================

interface ArtOpts {
  rage?: number;
  extra?: CardPlacement[];
}
function artBoard(o: ArtOpts = {}) {
  return base([
    { key: "art", def: printing(ARTISAN), owner: P1, zone: "play" },
    ...bank("rage", o.rage ?? 0, P1),
    ...(o.extra ?? [])
  ]);
}
type ArtGame = ReturnType<typeof artBoard>;
/** Ready resources paid by `fn`: the increase in attached resources. */
const paid = (g: ArtGame, fn: () => void): number => {
  const before = attachedCount(g.engine, P1);
  fn();
  return attachedCount(g.engine, P1) - before;
};
const itemOf = (key: string, cost: number, extra: Record<string, unknown> = {}): CardPlacement => ({
  key,
  def: item({ name: key, cost, ...extra } as never),
  owner: P1,
  zone: "hand"
});

clause(ARTISAN, "0:ability:fabricate", "printed as a gearsmith craftsman: cost 3, threshold [E], 0/2/1; deploys for exactly 3 with [E], refused one short or without [E]", () => {
  const c = printing(ARTISAN);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "gearsmith");
  assert.deepEqual(c.subtype, ["craftsman"]);
  assert.equal(c.cost, 3);
  assert.equal(c.threshold, "e");
  assert.equal(c.strength, 0);
  assert.equal(c.speed, 2);
  assert.equal(c.life, 1);
  const mk = (cards: CardPlacement[]) => base([{ key: "art", def: printing(ARTISAN), owner: P1, zone: "hand" }, ...cards]);
  const ok = mk(bank("elitism", 3, P1));
  play(ok.engine, P1, ok.id("art"));
  assert.equal(zoneOf(ok.engine, ok.id("art")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = mk(bank("elitism", 2, P1));
  refused(() => play(short.engine, P1, short.id("art")), "2 resources, cost 3");
  assert.equal(zoneOf(short.engine, short.id("art")), "hand");
  const noE = mk(bank("rage", 3, P1));
  refused(() => play(noE.engine, P1, noE.id("art")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("art")), "hand");
  const spentE = mk([...bank("rage", 2, P1), ...spent("elitism", 1)]);
  refused(() => play(spentE.engine, P1, spentE.id("art")), "spent [E] meets the threshold but 2 ready is short");
  const spentOk = mk([...bank("rage", 3, P1), ...spent("elitism", 1)]);
  play(spentOk.engine, P1, spentOk.id("art"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("art")), "play", "control: 3 ready + spent [E]");
});

clause(ARTISAN, "0:ability:fabricate", "COST: deplete this card; it can't be used while depleted", () => {
  const g = artBoard();
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(g.engine.state.cards[g.id("art")].depleted, true);
  refused(() => activate(g.engine, P1, g.id("art"), "fabricate"), "already depleted");
  const d = artBoard();
  d.engine.state.cards[d.id("art")].depleted = true;
  refused(() => activate(d.engine, P1, d.id("art"), "fabricate"), "depleted from the start");
});

clause(ARTISAN, "0:ability:fabricate", "only the controller can use it", () => {
  const g = artBoard();
  refused(() => activate(g.engine, P2, g.id("art"), "fabricate"), "opponent");
  assert.equal(g.engine.state.cards[g.id("art")].depleted, false);
});

clause(ARTISAN, "0:ability:fabricate", "the next item costs 2 less: a cost-3 item costs 1", () => {
  const g = artBoard({ rage: 5, extra: [itemOf("gz", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 1);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
});

clause(ARTISAN, "0:ability:fabricate", "without FABRICATE the same item costs its full 3", () => {
  const g = artBoard({ rage: 5, extra: [itemOf("gz", 3)] });
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 3);
});

clause(ARTISAN, "0:ability:fabricate", "the reduction never takes a cost below 0: cost-2 costs 0, cost-1 costs 0", () => {
  const two = artBoard({ rage: 5, extra: [itemOf("gz", 2)] });
  activate(two.engine, P1, two.id("art"), "fabricate");
  assert.equal(paid(two, () => play(two.engine, P1, two.id("gz"))), 0);
  assert.equal(zoneOf(two.engine, two.id("gz")), "play");
  const one = artBoard({ rage: 5, extra: [itemOf("gz", 1)] });
  activate(one.engine, P1, one.id("art"), "fabricate");
  assert.equal(paid(one, () => play(one.engine, P1, one.id("gz"))), 0);
  assert.equal(zoneOf(one.engine, one.id("gz")), "play");
});

clause(ARTISAN, "0:ability:fabricate", "affordability uses the reduced cost: a cost-3 item deploys with only 1 resource after FABRICATE, not before", () => {
  const no = artBoard({ rage: 1, extra: [itemOf("gz", 3)] });
  refused(() => play(no.engine, P1, no.id("gz")), "1 resource, cost 3");
  const g = artBoard({ rage: 1, extra: [itemOf("gz", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  play(g.engine, P1, g.id("gz"));
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(ready(g.engine, P1), 0);
});

clause(ARTISAN, "0:ability:fabricate", "only the NEXT item: the second item pays full price", () => {
  const g = artBoard({ rage: 8, extra: [itemOf("a", 3), itemOf("b", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("a"))), 1);
  assert.equal(paid(g, () => play(g.engine, P1, g.id("b"))), 3);
});

clause(ARTISAN, "0:ability:fabricate", "not a character or tactic: deploying them pays full price and does NOT use up the reduction", () => {
  const g = artBoard({
    rage: 9,
    extra: [
      { key: "ch", def: character({ name: "Ch", cost: 3 }), owner: P1, zone: "hand" },
      { key: "ta", def: tactic({ name: "Ta", cost: 3 }), owner: P1, zone: "hand" },
      itemOf("gz", 3)
    ]
  });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("ch"))), 3, "character full price");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("ta"))), 3, "tactic full price");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 1, "the item still gets the reduction");
});

clause(ARTISAN, "0:ability:fabricate", "the reduction does not reduce the item's threshold: an item needing [R] still needs a [R]", () => {
  const g = artBoard({ rage: 0, extra: [itemOf("gz", 1, { threshold: "r" }), ...bank("greed", 3, P1)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  refused(() => play(g.engine, P1, g.id("gz")), "no [R] icon");
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand");
});

clause(ARTISAN, "0:ability:fabricate", "'item ability': the next activation of an item's ability that pays 3 pays 1 instead; the one after pays full", () => {
  const gadget = item({
    name: "Gadget",
    cost: 0,
    behavior: {
      abilities: [{ id: "gad", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  } as never);
  const g = artBoard({ rage: 8, extra: [{ key: "gad", def: gadget, owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("gad"), "gad")), 1, "reduced by 2");
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("gad"), "gad")), 3, "the next one is full price");
});

clause(ARTISAN, "0:ability:fabricate", "without FABRICATE the item's ability costs its full 3", () => {
  const gadget = item({
    name: "Gadget",
    cost: 0,
    behavior: {
      abilities: [{ id: "gad", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  } as never);
  const g = artBoard({ rage: 8, extra: [{ key: "gad", def: gadget, owner: P1, zone: "play" }] });
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("gad"), "gad")), 3);
});

clause(ARTISAN, "0:ability:fabricate", "'next item or item ability': whichever comes first uses the reduction, the other pays full (item first, then ability)", () => {
  const gadget = item({
    name: "Gadget",
    cost: 3,
    behavior: {
      abilities: [{ id: "gad", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  } as never);
  const g = artBoard({ rage: 10, extra: [{ key: "gad", def: gadget, owner: P1, zone: "hand" }] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gad"))), 1, "the item deploy takes the reduction");
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("gad"), "gad")), 3, "so its ability pays full");
});

clause(ARTISAN, "0:ability:fabricate", "ability first, then item: the ability takes the reduction and the item pays full", () => {
  const gadget = item({
    name: "Gadget",
    cost: 0,
    behavior: {
      abilities: [{ id: "gad", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  } as never);
  const g = artBoard({ rage: 10, extra: [{ key: "gad", def: gadget, owner: P1, zone: "play" }, itemOf("gz", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("gad"), "gad")), 1);
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 3);
});

clause(ARTISAN, "0:ability:fabricate", "a non-item ability that pays 3 is not reduced and doesn't use up the reduction", () => {
  const npc = character({
    name: "Npc",
    behavior: {
      abilities: [{ id: "npc", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  } as never);
  const g = artBoard({ rage: 9, extra: [{ key: "npc", def: npc, owner: P1, zone: "play" }, itemOf("gz", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  assert.equal(paid(g, () => activate(g.engine, P1, g.id("npc"), "npc")), 3, "character ability full price");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 1, "item still reduced");
});

clause(ARTISAN, "0:ability:fabricate", "two Artisans stack: both FABRICATEs reduce the next item by 4 (cost 5 pays 1)", () => {
  const g = artBoard({ rage: 6, extra: [{ key: "art2", def: printing(ARTISAN), owner: P1, zone: "play" }, itemOf("gz", 5)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  activate(g.engine, P1, g.id("art2"), "fabricate");
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 1);
});

clause(ARTISAN, "0:ability:fabricate", "'this turn': an unused reduction is gone next turn", () => {
  const g = artBoard({ rage: 4, extra: [itemOf("gz", 3)] });
  activate(g.engine, P1, g.id("art"), "fabricate");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(paid(g, () => play(g.engine, P1, g.id("gz"))), 3, "full price a turn later");
});

// ============================================================================
// Assistant Mud Whisperer
// ============================================================================

interface MudOpts {
  mudCtl?: PlayerId;
  mudZone?: "play" | "hand";
  active?: PlayerId;
  extra?: CardPlacement[];
}
function mudBoard(o: MudOpts = {}) {
  const ctl = o.mudCtl ?? P1;
  return base(
    [
      { key: "mud", def: printing(MUD), owner: ctl, controller: ctl, zone: o.mudZone ?? "play" },
      { key: "own", def: character({ name: "Own" }), owner: P1, zone: "play", depleted: true },
      { key: "own2", def: character({ name: "Own2" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "itm", def: item({ name: "Itm", cost: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "gone", def: character({ name: "Gone" }), owner: P1, zone: "discard", depleted: true },
      ...(o.extra ?? [])
    ],
    o.active ?? P1
  );
}
type MudGame = ReturnType<typeof mudBoard>;
const depleted = (g: MudGame, key: string) => g.engine.state.cards[g.id(key)].depleted === true;
const pickTarget = (g: MudGame, key: string) => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });

clause(MUD, "0:rule", "printed as a gearsmith character: cost 5, threshold [E], 3/2/4 (mud whisperer, 31f); deploys for exactly 5 with [E], refused one short or without [E]", () => {
  const c = printing(MUD);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "gearsmith");
  assert.deepEqual(c.subtype, ["mud whisperer", "31f"]);
  assert.equal(c.cost, 5);
  assert.equal(c.threshold, "e");
  assert.equal(c.strength, 3);
  assert.equal(c.speed, 2);
  assert.equal(c.life, 4);
  const mk = (cards: CardPlacement[]) => base([{ key: "mud", def: printing(MUD), owner: P1, zone: "hand" }, ...cards]);
  const ok = mk(bank("elitism", 5, P1));
  play(ok.engine, P1, ok.id("mud"));
  assert.equal(zoneOf(ok.engine, ok.id("mud")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = mk(bank("elitism", 4, P1));
  refused(() => play(short.engine, P1, short.id("mud")), "4 resources, cost 5");
  assert.equal(zoneOf(short.engine, short.id("mud")), "hand");
  const noE = mk(bank("rage", 5, P1));
  refused(() => play(noE.engine, P1, noE.id("mud")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("mud")), "hand");
  const spentE = mk([...bank("rage", 4, P1), ...spent("elitism", 1)]);
  refused(() => play(spentE.engine, P1, spentE.id("mud")), "spent [E] meets the threshold but 4 ready is short");
  const spentOk = mk([...bank("rage", 5, P1), ...spent("elitism", 1)]);
  play(spentOk.engine, P1, spentOk.id("mud"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("mud")), "play", "control: 5 ready + spent [E]");
});

clause(MUD, "0:rule", "at the start of the opponent's turn its controller may pick a character; picking my depleted character restores it (only that one)", () => {
  const g = mudBoard();
  assert.equal(depleted(g, "own"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Whisperer's controller picks");
  pickTarget(g, "own");
  assert.equal(pending(g.engine), undefined);
  assert.equal(depleted(g, "own"), false, "restored");
  assert.equal(depleted(g, "own2"), true, "only the picked character");
  assert.equal(depleted(g, "mud"), false);
});

clause(MUD, "0:rule", "declining the pick restores nothing", () => {
  const g = mudBoard();
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(depleted(g, "own"), true);
  assert.equal(depleted(g, "own2"), true);
});

clause(MUD, "0:rule", "any character may be picked, including the Whisperer itself and an opponent's character", () => {
  const self = mudBoard({ extra: [] });
  self.engine.state.cards[self.id("mud")].depleted = true;
  endTurn(self.engine, P1);
  pickTarget(self, "mud");
  assert.equal(depleted(self, "mud"), false, "the Whisperer can restore itself");
  const foe = mudBoard();
  endTurn(foe.engine, P1);
  pickTarget(foe, "foe");
  assert.equal(pending(foe.engine), undefined);
  assert.equal(depleted(foe, "foe"), false, "an opponent's character is a legal pick");
  assert.equal(depleted(foe, "own"), true);
});

clause(MUD, "0:rule", "must be a character in play: an item, a character in the discard pile, or two characters at once are refused", () => {
  const g = mudBoard();
  endTurn(g.engine, P1);
  refused(() => pickTarget(g, "itm"), "an item is not a character");
  refused(() => pickTarget(g, "gone"), "a character in the discard pile is not in play");
  refused(
    () => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("own"), g.id("own2")] }),
    "only one character"
  );
  assert.equal(depleted(g, "own"), true, "nothing restored by the refused picks");
  assert.equal(depleted(g, "itm"), true);
  pickTarget(g, "own");
  assert.equal(depleted(g, "own"), false, "control: a character in play");
});

clause(MUD, "0:rule", "does not trigger at the start of MY OWN turn: no prompt", () => {
  const g = mudBoard({ active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined);
});

clause(MUD, "0:rule", "'each opponent's turn': it prompts again at every opponent turn start, not just once", () => {
  const g = mudBoard();
  endTurn(g.engine, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined, "not on my own turn");
  g.engine.state.cards[g.id("own2")].depleted = true;
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "asks again at the next opponent turn");
  pickTarget(g, "own2");
  assert.equal(depleted(g, "own2"), false);
});

clause(MUD, "0:rule", "controller, not owner: a Whisperer P2 owns but P1 controls prompts P1; one P1 owns but P2 controls prompts P2", () => {
  const mine = mudBoard({ extra: [] });
  mine.engine.state.cards[mine.id("mud")].ownerId = P2;
  endTurn(mine.engine, P1);
  assert.equal(pending(mine.engine)?.playerId, P1, "P1 controls it, so P1 picks at P2's turn start");
  answerPending(mine.engine, "chooserSelectsTarget", { selected: [] });
  const theirs = mudBoard({ mudCtl: P2, active: P2 });
  endTurn(theirs.engine, P2);
  assert.equal(theirs.engine.state.activePlayerId, P1);
  assert.equal(pending(theirs.engine)?.playerId, P2, "P2 controls it, so P2 picks at P1's turn start");
});

clause(MUD, "0:rule", "a Whisperer controlled by the opponent does not prompt me at their own turn start", () => {
  const g = mudBoard({ mudCtl: P2, active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
});

clause(MUD, "0:rule", "two Whisperers each trigger: two characters can be restored", () => {
  const g = mudBoard({ extra: [{ key: "mud2", def: printing(MUD), owner: P1, zone: "play" }] });
  endTurn(g.engine, P1);
  const picks = ["own", "own2"];
  drain(g.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id(picks.shift() ?? "mud")] } : declineAll(pc)));
  assert.equal(depleted(g, "own"), false);
  assert.equal(depleted(g, "own2"), false);
});

clause(MUD, "0:rule", "only while in play: a Whisperer in my hand does nothing at the opponent's turn start", () => {
  const g = mudBoard({ mudZone: "hand" });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
  assert.equal(depleted(g, "own"), true);
});

// ============================================================================
// Braggadocian Aide
// ============================================================================

// The Aide triggers at the start of EACH opponent's turn: at a bigger table an extra seat's turn start is one too and
// would offer the controller its pick before the turn the clause is about. The extra seats sit out of the turn rotation
// here; multiplayer-tables-saga.test.ts plays it at a real bigger table.
function aideBoard(o: { extra?: CardPlacement[]; active?: PlayerId; aideZone?: "play" | "hand"; aideCtl?: PlayerId } = {}) {
  const ctl = o.aideCtl ?? P1;
  const game = base(
    [
      { key: "aide", def: printing(AIDE), owner: ctl, controller: ctl, zone: o.aideZone ?? "play" },
      { key: "needE", def: character({ name: "NeedE", cost: 0, threshold: "e" } as never), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ],
    o.active ?? P1
  );
  game.engine.state.turnOrder = game.engine.state.turnOrder.filter((id) => id === P1 || id === P2);
  return game;
}
type AideGame = ReturnType<typeof aideBoard>;
const attachedTo = (g: AideGame, key: string): boolean => {
  const att = g.engine.state.cards[g.id(key)].attachedTo;
  return att !== undefined && att !== null;
};
const resCards = (prefix: string, n: number, owner: PlayerId, attachedToKey?: string): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: item({ name: `${prefix}${i}`, cost: 0 }) as never,
    owner,
    zone: "play",
    faceDown: true,
    ...(attachedToKey ? { attachedToKey } : {})
  })) as CardPlacement[];
const pickRes = (g: AideGame, key: string) => answerPending(g.engine, "selectTargets", { selected: { res: [g.id(key)] } });

clause(AIDE, "0:provides", "printed as a gearsmith craftsman: cost 4, threshold [E], 2/3/3; deploys for exactly 4 with [E], refused one short or without [E]", () => {
  const c = printing(AIDE);
  assert.equal(c.type, "character");
  assert.equal(c.trade, "gearsmith");
  assert.deepEqual(c.subtype, ["craftsman"]);
  assert.equal(c.cost, 4);
  assert.equal(c.threshold, "e");
  assert.equal(c.strength, 2);
  assert.equal(c.speed, 3);
  assert.equal(c.life, 3);
  const mk = (cards: CardPlacement[]) => base([{ key: "aide", def: printing(AIDE), owner: P1, zone: "hand" }, ...cards]);
  const ok = mk(bank("elitism", 4, P1));
  play(ok.engine, P1, ok.id("aide"));
  assert.equal(zoneOf(ok.engine, ok.id("aide")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = mk(bank("elitism", 3, P1));
  refused(() => play(short.engine, P1, short.id("aide")), "3 resources, cost 4");
  assert.equal(zoneOf(short.engine, short.id("aide")), "hand");
  const noE = mk(bank("rage", 4, P1));
  refused(() => play(noE.engine, P1, noE.id("aide")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("aide")), "hand");
  const spentE = mk([...bank("rage", 3, P1), ...spent("elitism", 1)]);
  refused(() => play(spentE.engine, P1, spentE.id("aide")), "spent [E] meets the threshold but 3 ready is short");
  const spentOk = mk([...bank("rage", 4, P1), ...spent("elitism", 1)]);
  play(spentOk.engine, P1, spentOk.id("aide"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("aide")), "play", "control: 4 ready + spent [E]");
});

const needE = (cost: number): CardPlacement => ({
  key: "needE",
  def: character({ name: "NeedE", cost, threshold: "e" } as never),
  owner: P1,
  zone: "hand"
});

clause(AIDE, "0:provides", "in play it PROVIDES [E]: an [E]-threshold card becomes deployable with only Rage; without the Aide in play it isn't", () => {
  const without = base([needE(1), ...bank("rage", 2, P1)]);
  refused(() => play(without.engine, P1, without.id("needE")), "no [E] icon");
  assert.equal(zoneOf(without.engine, without.id("needE")), "hand");
  const g = base([needE(1), { key: "aide", def: printing(AIDE), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]);
  play(g.engine, P1, g.id("needE"));
  assert.equal(zoneOf(g.engine, g.id("needE")), "play", "the Aide's [E] satisfied the threshold");
});

clause(AIDE, "0:provides", "the provided [E] counts toward thresholds only: it is not a resource that can pay (cost 1 with nothing ready is refused)", () => {
  const g = base([needE(1), { key: "aide", def: printing(AIDE), owner: P1, zone: "play" }]);
  assert.equal(ready(g.engine, P1), 0, "the Aide is not a ready resource");
  refused(() => play(g.engine, P1, g.id("needE")), "nothing to pay with");
  assert.equal(zoneOf(g.engine, g.id("needE")), "hand");
  const ok = base([needE(1), { key: "aide", def: printing(AIDE), owner: P1, zone: "play" }, ...bank("rage", 1, P1)]);
  play(ok.engine, P1, ok.id("needE"));
  assert.equal(zoneOf(ok.engine, ok.id("needE")), "play", "control: one Rage pays");
});

clause(AIDE, "0:provides", "not while in hand or in the discard pile, and not for the opponent's Aide", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = base([needE(1), { key: "aide", def: printing(AIDE), owner: P1, zone }, ...bank("rage", 2, P1)]);
    refused(() => play(g.engine, P1, g.id("needE")), `Aide in ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("needE")), "hand");
  }
  const opp = base([needE(1), { key: "aide", def: printing(AIDE), owner: P2, zone: "play" }, ...bank("rage", 2, P1)]);
  refused(() => play(opp.engine, P1, opp.id("needE")), "the opponent's Aide provides to the opponent");
  assert.equal(zoneOf(opp.engine, opp.id("needE")), "hand");
});

clause(AIDE, "0:provides", "face-down in play it is just a Volition resource and provides no [E]", () => {
  const g = base([needE(1), { key: "aide", def: printing(AIDE), owner: P1, zone: "play", faceDown: true }, ...bank("rage", 2, P1)]);
  refused(() => play(g.engine, P1, g.id("needE")), "face-down provides Volition only");
  assert.equal(zoneOf(g.engine, g.id("needE")), "hand");
});

clause(AIDE, "0:provides", "provides exactly one [E] icon (and nothing else): printed resource data", () => {
  const c = printing(AIDE);
  const r = (c as unknown as { resource?: { provides?: string[] } }).resource;
  assert.deepEqual(r?.provides, ["elitism"]);
});

clause(AIDE, "1:rule", "at the start of the opponent's turn I may pick a resource attached to my faction and detach it", () => {
  const g = aideBoard({ extra: [...resCards("sp", 2, P1, "__factionA"), ...resCards("rd", 1, P1)] });
  assert.equal(attachedTo(g, "sp0"), true);
  assert.equal(attachedTo(g, "rd0"), false);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P1);
  pickRes(g, "sp0");
  assert.equal(pending(g.engine), undefined);
  assert.equal(attachedTo(g, "sp0"), false, "detached");
  assert.equal(attachedTo(g, "sp1"), true, "only the picked one");
});

clause(AIDE, "1:rule", "declining the pick detaches nothing", () => {
  const g = aideBoard({ extra: resCards("sp", 2, P1, "__factionA") });
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  answerPending(g.engine, "selectTargets", { selected: { res: [] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(attachedTo(g, "sp0"), true);
  assert.equal(attachedTo(g, "sp1"), true);
});

clause(AIDE, "1:rule", "picking a detached resource isn't allowed: only resources attached to my faction can be picked", () => {
  const g = aideBoard({ extra: [...resCards("sp", 1, P1, "__factionA"), ...resCards("rd", 1, P1)] });
  endTurn(g.engine, P1);
  refused(() => pickRes(g, "rd0"), "a ready (detached) resource is not attached to my faction");
  assert.equal(attachedTo(g, "sp0"), true);
  pickRes(g, "sp0");
  assert.equal(attachedTo(g, "sp0"), false, "control: an attached resource");
});

clause(AIDE, "1:rule", "an opponent's resource can't be picked (theirs are already detached by their own Restore Rule when the trigger resolves)", () => {
  const g = aideBoard({ extra: [...resCards("sp", 1, P1, "__factionA"), ...resCards("op", 1, P2, "__factionB")] });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  refused(() => pickRes(g, "op0"), "opponent's resource");
  pickRes(g, "sp0");
  assert.equal(attachedTo(g, "sp0"), false, "control: my own attached resource");
});

clause(AIDE, "1:rule", "the controller check alone refuses an opponent's resource: one still attached (to my faction) at the trigger, identical to a resource of mine except for its controller", () => {
  // The opponent's own Restore Rule cannot have detached "ox0": it hangs off MY faction. Only the controller differs between ox0 and mx0.
  const mk2 = () => aideBoard({ extra: [...resCards("mx", 1, P1, "__factionA"), ...resCards("ox", 1, P2, "__factionA")] });
  const g = mk2();
  assert.equal(attachedTo(g, "ox0"), true, "attached before the turn change");
  assert.equal(attachedTo(g, "mx0"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  assert.equal(attachedTo(g, "ox0"), true, "still attached when I am asked (their Restore Rule did not touch it)");
  refused(() => pickRes(g, "ox0"), "the opponent's resource (controller check)", /target|select|valid|controller|pick/i);
  assert.equal(attachedTo(g, "ox0"), true, "nothing detached");
  assert.equal(pending(g.engine)?.kind, "selectTargets", "the pick is still open");
  const ctl = mk2();
  endTurn(ctl.engine, P1);
  pickRes(ctl, "mx0");
  assert.equal(attachedTo(ctl, "mx0"), false, "control: the same shape under MY control is detached");
  assert.equal(attachedTo(ctl, "ox0"), true, "theirs stays");
});

clause(AIDE, "1:rule", "a resource attached to one of my characters (not to my faction) can't be picked", () => {
  const g = aideBoard({
    extra: [
      ...resCards("sp", 1, P1, "__factionA"),
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...resCards("onChar", 1, P1, "host")
    ]
  });
  endTurn(g.engine, P1);
  refused(() => pickRes(g, "onChar0"), "attached to a character, not the faction");
  assert.equal(attachedTo(g, "onChar0"), true);
});

clause(AIDE, "1:rule", "a non-resource card (an item in play) can't be picked", () => {
  const g = aideBoard({
    extra: [...resCards("sp", 1, P1, "__factionA"), { key: "up", def: item({ name: "Up", cost: 1 }), owner: P1, zone: "play" }]
  });
  endTurn(g.engine, P1);
  refused(() => pickRes(g, "up"), "an item is not a resource");
  pickRes(g, "sp0");
  assert.equal(attachedTo(g, "sp0"), false, "control");
});

clause(AIDE, "1:rule", "only one resource: picking two at once is refused", () => {
  const g = aideBoard({ extra: resCards("sp", 2, P1, "__factionA") });
  endTurn(g.engine, P1);
  refused(() => answerPending(g.engine, "selectTargets", { selected: { res: [g.id("sp0"), g.id("sp1")] } }), "one resource only");
  assert.equal(attachedTo(g, "sp0"), true);
  assert.equal(attachedTo(g, "sp1"), true);
});

clause(AIDE, "1:rule", "does not trigger at the start of MY turn", () => {
  const g = aideBoard({ active: P2, extra: resCards("sp", 2, P1, "__factionA") });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine), undefined);
});

clause(AIDE, "1:rule", "an opponent-controlled Aide does not prompt me at their turn start; it prompts them at mine", () => {
  const g = aideBoard({ aideCtl: P2, active: P1, extra: resCards("sp", 1, P1, "__factionA") });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
  const h = aideBoard({ aideCtl: P2, active: P2, extra: resCards("op", 1, P2, "__factionB") });
  endTurn(h.engine, P2);
  assert.equal(h.engine.state.activePlayerId, P1);
  assert.equal(pending(h.engine)?.playerId, P2, "its controller picks");
  pickRes(h, "op0");
  assert.equal(attachedTo(h, "op0"), false);
});

clause(AIDE, "1:rule", "only while in play: an Aide in hand does nothing", () => {
  const g = aideBoard({ aideZone: "hand", extra: resCards("sp", 1, P1, "__factionA") });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined);
  assert.equal(attachedTo(g, "sp0"), true);
});

clause(AIDE, "1:rule", "two Aides each trigger: two resources can be detached", () => {
  const g = aideBoard({ extra: [{ key: "aide2", def: printing(AIDE), owner: P1, zone: "play" }, ...resCards("sp", 3, P1, "__factionA")] });
  endTurn(g.engine, P1);
  const picks = ["sp0", "sp1"];
  drain(g.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { res: [g.id(picks.shift() ?? "sp2")] } } : declineAll(pc)));
  assert.equal(attachedTo(g, "sp0"), false);
  assert.equal(attachedTo(g, "sp1"), false);
  assert.equal(attachedTo(g, "sp2"), true);
});

void deployAnswer;
void spent;
void handOf;
void moveTactic;
