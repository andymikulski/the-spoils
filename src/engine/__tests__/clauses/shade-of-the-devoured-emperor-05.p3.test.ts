// Clause tests: shade-of-the-devoured-emperor-05, part p3 (groups 11-16, missing clauses only).
// Elusive Wolf, Gang Weapon Dealer, Gassy Gastornis, Guileful Astucion, Martial Arts Wannabe,
// Murderous Kleptomaniac. Expectations come from the printed text, RULES.md and the CR.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, tactic, P1, P2 } from "../per-card/_harness.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  finishBattle
} from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, endTurn } from "./_turn.js";
import { printedCost, printedStats } from "./_printed.js";
import { clause, declineAll, printing, refused, flipUpNow } from "./_clause.js";

const WOLF = "77e72f4c-f1c8-4d81-8133-0562dc061b65"; // Elusive Wolf: char 4 d, 2/4/2 -- HOWL (destroy a Deception you own: token) -- PROWL (remove a token: COVERT this turn)
const GWD = "53f1700e-6445-4b87-bf00-c69f88c6a278"; // Gang Weapon Dealer: char 5 dd, 1/4/3 -- enters with 2 tokens -- +1 str per token -- DELIVERY (remove token, deplete, reveal face-down gear: play it, ignore threshold, free if cost <= 4)
const GAS = "d0d5fc5e-9675-458e-98bc-0a7296d115d5"; // Gassy Gastornis: char 6 d, 3/3/4 -- TACTICAL
const GA = "af563041-e0fc-43bd-a340-cda2eb36117b"; // Guileful Astucion: tactic 2 dd -- pick a character; choose: -1 cost / +1 cost / +1 speed this turn; draw
const MAW = "53598621-abf6-4b9f-bc94-6c70bd77cb10"; // Martial Arts Wannabe: char 1 dd, 1/3/1 -- cannot be picked while you control more characters than any opponent
const MK = "0f7da7ec-f232-4403-816e-f635a2b475c9"; // Murderous Kleptomaniac: char 6 dd, 3/3/3 -- COVERT -- dies: may remove a char/item/location -- KLEPT (10 d, pay 4, pick char/item: take control)
const BITE = "ccd054c5-3295-437d-b15e-012665c83059"; // Bug Bite (probe): tactic 1 dd -- token on a character; destroy it if tokens >= its numeric cost

// --- shared helpers (this file only) ----------------------------------------------------------

type Ids = (key: string) => CardInstanceId;
type Board = { engine: SpoilsEngine; id: Ids };
type Icon = Parameters<typeof bank>[0];

const duo = (cards: CardPlacement[], o: { turn?: number; active?: PlayerId } = {}): Board =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: o.turn, activePlayerId: o.active, cards });

/** `n` staple resources with stable keys `<prefix>0..`. */
const named = (prefix: string, icon: Icon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p, i) => ({ ...p, key: `${prefix}${i}` }));

/** One more staple Deception card (a resource named "Deception") as a free-standing placement. */
const decCard = (key: string, owner: PlayerId, zone: CardPlacement["zone"], over: Partial<CardPlacement> = {}): CardPlacement => ({
  ...bank("deception", 1, owner)[0],
  key,
  zone,
  ...over
});

const revealedIds = (b: Board): string[] =>
  b.engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);

/** A zero-cost tactic that destroys the character it is aimed at (played by `owner`). */
const killer = tactic({
  name: "Character Killer",
  cost: 0,
  behavior: {
    abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
  }
});
/** A zero-cost tactic that picks a character and puts a token on it. */
const picker = (name: string): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pk",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
/** A zero-cost tactic that destroys EVERY character in play (no pick involved). */
const sweeper = tactic({
  name: "Sweep",
  cost: 0,
  behavior: {
    abilities: [{ id: "sw", type: "activated", effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }]
  }
});

// =====================================================================================
// Elusive Wolf — character, rogue, beast, cost 4, [D], 2/4/2
// HOWL -- COST: Destroy a card named "Deception" you own. -- EFFECT: Put a token on this card.
// PROWL -- COST: Remove a token from this card. -- EFFECT: This turn, this card gains COVERT.
// =====================================================================================

const HOWL = "elusive-wolf-howl";
const PROWL = "elusive-wolf-prowl";

function wolfBoard(o: { dec?: number; tokens?: number; wolf?: Partial<CardPlacement>; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}): Board {
  return duo(
    [
      { key: "wolf", def: printing(WOLF), owner: P1, zone: "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}), ...o.wolf },
      ...named("dec", "deception", o.dec ?? 2, P1),
      ...(o.extra ?? [])
    ],
    o
  );
}
const howl = (b: Board, pick: string) => activate(b.engine, P1, b.id("wolf"), HOWL, { selected: { dec: [b.id(pick)] } });
const prowl = (b: Board) => activate(b.engine, P1, b.id("wolf"), PROWL);
const isCovert = (b: Board, key = "wolf") => b.engine.getKeywords(b.id(key)).includes("covert");

clause(WOLF, "0:ability:elusive-wolf-howl", "COST destroys the picked Deception I own (it goes to the discard pile); EFFECT puts exactly one token on the Wolf; the other Deception stays", () => {
  const b = wolfBoard({ dec: 3 });
  assert.equal(tokensOn(b.engine, b.id("wolf")), 0, "precondition: no tokens");
  howl(b, "dec1");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dec1")), "discard", "COST: the picked Deception is destroyed");
  assert.equal(zoneOf(b.engine, b.id("dec0")), "play", "the other Deceptions are untouched");
  assert.equal(zoneOf(b.engine, b.id("dec2")), "play");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1, "EFFECT: one token on this card");
  assert.equal(zoneOf(b.engine, b.id("wolf")), "play");
  assert.equal(b.engine.state.cards[b.id("wolf")].depleted, false, "HOWL does not deplete the Wolf");
});

clause(WOLF, "0:ability:elusive-wolf-howl", "it can be used again: each use destroys one more Deception and adds one more token", () => {
  const b = wolfBoard({ dec: 3 });
  howl(b, "dec0");
  howl(b, "dec2");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 2);
  assert.deepEqual([zoneOf(b.engine, b.id("dec0")), zoneOf(b.engine, b.id("dec1")), zoneOf(b.engine, b.id("dec2"))], ["discard", "play", "discard"]);
});

clause(WOLF, "0:ability:elusive-wolf-howl", "only a card NAMED Deception that I OWN can be picked (not another staple, my opponent's Deception, a card in hand / discard, or the Wolf itself)", () => {
  const b = wolfBoard({
    dec: 1,
    extra: [
      ...named("greed", "greed", 1, P1),
      ...named("foeDec", "deception", 1, P2),
      decCard("handDec", P1, "hand"),
      decCard("discDec", P1, "discard"),
      { ...decCard("loan", P2, "play"), controller: P1 }
    ]
  });
  for (const bad of ["greed0", "foeDec0", "handDec", "discDec", "wolf", "loan"]) {
    refused(() => howl(b, bad), `${bad} is not a Deception I own in play`, /Illegal target/);
    assert.equal(tokensOn(b.engine, b.id("wolf")), 0, `${bad}: no token was given`);
  }
  assert.deepEqual(
    ["greed0", "foeDec0", "handDec", "discDec", "wolf", "loan"].map((k) => zoneOf(b.engine, b.id(k))),
    ["play", "play", "hand", "discard", "play", "play"],
    "nothing was destroyed by the refused attempts"
  );
  howl(b, "dec0");
  assert.equal(zoneOf(b.engine, b.id("dec0")), "discard", "control: my own Deception is a legal pick");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1);
});

clause(WOLF, "0:ability:elusive-wolf-howl", "'you own' means ownership, not control: a Deception I own that my opponent controls is a legal pick", () => {
  const b = wolfBoard({ dec: 0, extra: [{ ...decCard("stolen", P1, "play"), controller: P2 }] });
  howl(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1);
});

clause(WOLF, "0:ability:elusive-wolf-howl", "a face-down card has no name (CR 411.1): a face-down card whose front is a Deception cannot be picked", () => {
  const b = wolfBoard({ dec: 1, extra: [decCard("fd", P1, "play", { faceDown: true })] });
  refused(() => howl(b, "fd"), "a face-down card is not named Deception");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 0);
  howl(b, "dec0");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1, "control: the face-up Deception works");
});

clause(WOLF, "0:ability:elusive-wolf-howl", "with no Deception of mine in play it cannot be used; a depleted Wolf can still use it (the cost has no deplete)", () => {
  const none = wolfBoard({ dec: 0, extra: named("greed", "greed", 2, P1) });
  refused(() => howl(none, "greed0"), "no Deception to destroy");
  assert.equal(tokensOn(none.engine, none.id("wolf")), 0);
  const depleted = wolfBoard({ dec: 1, wolf: { depleted: true } });
  howl(depleted, "dec0");
  assert.equal(tokensOn(depleted.engine, depleted.id("wolf")), 1, "a depleted Wolf still HOWLs");
  assert.equal(depleted.engine.state.cards[depleted.id("wolf")].depleted, true);
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "COST removes one token; EFFECT gives the Wolf (before: not covert) COVERT", () => {
  const b = wolfBoard({ tokens: 2 });
  assert.equal(isCovert(b), false, "precondition: the Wolf is not covert by itself");
  prowl(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1, "COST: exactly one token removed");
  assert.equal(isCovert(b), true, "EFFECT: COVERT");
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "without a token it cannot be used", () => {
  const none = wolfBoard({ tokens: 0 });
  refused(() => prowl(none), "no token to remove");
  assert.equal(isCovert(none), false);
  const one = wolfBoard({ tokens: 1 });
  prowl(one);
  assert.equal(tokensOn(one.engine, one.id("wolf")), 0, "control: with one token it works and uses it up");
  assert.equal(isCovert(one), true);
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "the COVERT lasts this turn only: gone once the turn ends", () => {
  const b = wolfBoard({ tokens: 2 });
  prowl(b);
  assert.equal(isCovert(b), true);
  endTurn(b.engine, P1);
  assert.equal(isCovert(b), false, "the next turn the Wolf is no longer covert");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1, "the leftover token stays");
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "only 'this card' gains COVERT: another character of mine does not", () => {
  const b = wolfBoard({ tokens: 1, extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }] });
  prowl(b);
  assert.equal(isCovert(b), true);
  assert.equal(isCovert(b, "ally"), false);
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "the granted COVERT works in battle: a non-covert character cannot block the Wolf, a covert one can; without it anyone can block", () => {
  const cards = (): CardPlacement[] => [
    { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
    { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
  ];
  const withProwl = wolfBoard({ tokens: 1, extra: cards(), turn: 2, active: P1 });
  prowl(withProwl);
  declareAttackBy(withProwl.engine, P1, [withProwl.id("wolf")]);
  refused(() => withProwl.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [withProwl.id("plainBlocker")] }), "a non-covert character cannot block a covert Wolf");
  withProwl.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [withProwl.id("covertBlocker")] });
  assert.deepEqual(withProwl.engine.state.battle?.blockingParty, [withProwl.id("covertBlocker")]);

  const without = wolfBoard({ tokens: 1, extra: cards(), turn: 2, active: P1 });
  declareAttackBy(without.engine, P1, [without.id("wolf")]);
  without.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [without.id("plainBlocker")] });
  assert.deepEqual(without.engine.state.battle?.blockingParty, [without.id("plainBlocker")], "control: without PROWL a plain character blocks it");
});

clause(WOLF, "1:ability:elusive-wolf-prowl", "HOWL feeds PROWL: a Wolf with no token HOWLs, then PROWLs with that token; using PROWL twice needs two tokens", () => {
  const b = wolfBoard({ dec: 2 });
  refused(() => prowl(b), "no token yet");
  howl(b, "dec0");
  prowl(b);
  assert.equal(tokensOn(b.engine, b.id("wolf")), 0);
  assert.equal(isCovert(b), true);
  refused(() => prowl(b), "the token is used up");
  howl(b, "dec1");
  prowl(b);
  assert.equal(tokensOn(b.engine, b.id("wolf")), 0);
  assert.equal(isCovert(b), true, "still covert");
});

// =====================================================================================
// Gang Weapon Dealer — character, rogue, gang member, cost 5, [D][D], 1/4/3
// This card enters play with 2 tokens on it. -- This card gains 1 strength for each token on it.
// DELIVERY -- COST: Remove a token from this card. Deplete this card. Reveal a face-down "gear" card you control.
//   EFFECT: You may play it even if you cannot meet its threshold. If its numeric cost is 4 or less, you may play it for free.
// =====================================================================================

const DELIVERY = "gwd-delivery";

const gearDef = (cost: number, threshold = "ddddd", over: Partial<CardDefinition> = {}): CardDefinition =>
  item({ name: `Gear${cost}`, cost, threshold, subtype: ["gear"], ...over });

function gwdBoard(o: { tokens?: number; rage?: number; gearCost?: number; gearThreshold?: string; gwd?: Partial<CardPlacement>; extra?: CardPlacement[]; noGear?: boolean; turn?: number; active?: PlayerId } = {}): Board {
  return duo(
    [
      { key: "gwd", def: printing(GWD), owner: P1, zone: "play", counters: { token: o.tokens ?? 2 }, ...o.gwd },
      ...(o.noGear ? [] : [{ key: "gear", def: gearDef(o.gearCost ?? 3, o.gearThreshold ?? "ddddd"), owner: P1, zone: "play" as const, faceDown: true }]),
      ...named("rage", "rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    o
  );
}
const deliver = (b: Board, pick = "gear") => activate(b.engine, P1, b.id("gwd"), DELIVERY, { selected: { g: [b.id(pick)] } });
const acceptDeploy = (b: Board, pick = "gear") => answerPending(b.engine, "deployForFree", { cardId: b.id(pick) });
const declineDeploy = (b: Board) => answerPending(b.engine, "deployForFree", {});
const gwdTokens = (b: Board, key = "gwd") => tokensOn(b.engine, b.id(key));

clause(GWD, "0:rule", "deployed from hand (cost 5, [D][D]) it enters play with exactly 2 tokens", () => {
  const b = duo([{ key: "gwd", def: printing(GWD), owner: P1, zone: "hand" }, ...named("dec", "deception", 5, P1)]);
  assert.equal(attachedCount(b.engine, P1), 0);
  play(b.engine, P1, b.id("gwd"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("gwd")), "play");
  assert.equal(attachedCount(b.engine, P1), 5, "deployed at its printed cost 5");
  assert.equal(gwdTokens(b), 2, "enters with 2 tokens");
});

clause(GWD, "0:rule", "only the card that enters gets the tokens: a Dealer already in play (no tokens) and any other character entering play stay token-free", () => {
  const b = duo([
    { key: "old", def: printing(GWD), owner: P1, zone: "play" },
    { key: "newGwd", def: printing(GWD), owner: P1, zone: "hand" },
    { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" },
    ...named("dec", "deception", 5, P1)
  ]);
  assert.equal(gwdTokens(b, "old"), 0, "precondition: the placed Dealer has no tokens");
  play(b.engine, P1, b.id("other"));
  assert.equal(gwdTokens(b, "old"), 0, "another character entering play does not give the Dealer tokens");
  assert.equal(gwdTokens(b, "other"), 0, "...and gets none itself");
  play(b.engine, P1, b.id("newGwd"));
  assert.equal(gwdTokens(b, "newGwd"), 2, "the entering Dealer gets 2");
  assert.equal(gwdTokens(b, "old"), 0, "the Dealer already in play is not affected by a second Dealer entering");
});

clause(GWD, "0:rule", "entering play by an effect (a free deploy from hand) also gives it 2 tokens", () => {
  const redeploy = tactic({
    name: "Redeploy",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rd",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "deployFromZone", player: "controller", target: { type: "selected", id: "t" }, free: true }]
        }
      ]
    }
  });
  const b = duo([
    { key: "gwd", def: printing(GWD), owner: P1, zone: "hand" },
    { key: "rd", def: redeploy, owner: P1, zone: "hand" },
    ...named("dec", "deception", 2, P1) // "for free" does not waive the [D][D] threshold (CR 308.1)
  ]);
  play(b.engine, P1, b.id("rd"), { selected: { t: [b.id("gwd")] } });
  acceptDeploy(b, "gwd");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("gwd")), "play");
  assert.equal(attachedCount(b.engine, P1), 0, "it was free");
  assert.equal(gwdTokens(b), 2);
});

clause(GWD, "0:rule", "a Dealer that dies and later re-enters play (from the discard pile, via an effect) enters with exactly 2 tokens, not 2 plus leftovers", () => {
  const reanimate = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "deployFromZone", player: "controller", target: { type: "selected", id: "t" }, free: true }]
        }
      ]
    }
  });
  const b = duo(
    [
      { key: "gwd", def: printing(GWD), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "kill", def: killer, owner: P1, zone: "hand" },
      { key: "re", def: reanimate, owner: P1, zone: "hand" },
      ...named("dec", "deception", 2, P1)
    ],
    { turn: 2, active: P1 }
  );
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("gwd")] } });
  assert.equal(zoneOf(b.engine, b.id("gwd")), "discard");
  play(b.engine, P1, b.id("re"), { selected: { t: [b.id("gwd")] } });
  acceptDeploy(b, "gwd");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("gwd")), "play", "it re-entered play");
  assert.equal(gwdTokens(b), 2, "a fresh Dealer: exactly 2 tokens");
  assert.equal(b.engine.getStat(b.id("gwd"), "strength"), 3);
});

clause(GWD, "1:rule", "it gets +1 strength per token: printed 1 with 0 tokens, 2 with 1, 3 with 2, 6 with 5", () => {
  for (const [tokens, strength] of [[0, 1], [1, 2], [2, 3], [5, 6]] as const) {
    const b = gwdBoard({ tokens, noGear: true });
    assert.equal(b.engine.getStat(b.id("gwd"), "strength"), strength, `${tokens} tokens`);
    assert.equal(b.engine.getStat(b.id("gwd"), "life"), 3, "life is not affected");
    assert.equal(b.engine.getStat(b.id("gwd"), "speed"), 4, "speed is not affected");
  }
});

clause(GWD, "1:rule", "the bonus follows the token count live: using DELIVERY (which removes a token) lowers the strength from 3 to 2", () => {
  const b = gwdBoard({ tokens: 2, gearCost: 0 });
  assert.equal(b.engine.getStat(b.id("gwd"), "strength"), 3);
  deliver(b);
  declineDeploy(b);
  assert.equal(gwdTokens(b), 1);
  assert.equal(b.engine.getStat(b.id("gwd"), "strength"), 2);
});

clause(GWD, "1:rule", "only the tokens on THIS card count: tokens on other cards, including another Dealer, do not", () => {
  const b = gwdBoard({
    tokens: 2,
    noGear: true,
    extra: [
      { key: "gwd2", def: printing(GWD), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", counters: { token: 3 } }
    ]
  });
  assert.equal(b.engine.getStat(b.id("gwd"), "strength"), 3, "2 tokens -> 1 + 2");
  assert.equal(b.engine.getStat(b.id("gwd2"), "strength"), 5, "4 tokens -> 1 + 4");
});

clause(GWD, "1:rule", "once it leaves play its tokens disappear (CR 409.2) and the bonus is gone", () => {
  const b = duo(
    [
      { key: "gwd", def: printing(GWD), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "kill", def: killer, owner: P2, zone: "hand" }
    ],
    { turn: 2, active: P2 }
  );
  assert.equal(b.engine.getStat(b.id("gwd"), "strength"), 3);
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("gwd")] } });
  assert.equal(zoneOf(b.engine, b.id("gwd")), "discard");
  assert.equal(gwdTokens(b), 0, "its tokens disappeared with it");
});

clause(GWD, "2:ability:gwd-delivery", "COST: removes a token, depletes the Dealer and reveals the gear (all paid before the play choice); the gear is then played face-up for free", () => {
  const b = gwdBoard({ tokens: 2, gearCost: 3 });
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true);
  deliver(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "deployForFree", "the play is offered");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.candidates, [b.id("gear")], "the revealed gear is the only candidate");
  assert.equal(gwdTokens(b), 1, "COST: one token removed");
  assert.equal(b.engine.state.cards[b.id("gwd")].depleted, true, "COST: the Dealer is depleted");
  assert.ok(revealedIds(b).includes(b.id("gear")), "COST: the face-down gear card is revealed");
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true, "still face-down until it is played");
  acceptDeploy(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, false, "played face-up");
  assert.equal(zoneOf(b.engine, b.id("gear")), "play");
  assert.equal(attachedCount(b.engine, P1), 0, "free: no resources spent");
});

clause(GWD, "2:ability:gwd-delivery", "'you may play it': declining leaves the gear face-down, but the costs (token, deplete, reveal) are already paid", () => {
  const b = gwdBoard({ tokens: 2, gearCost: 3 });
  deliver(b);
  declineDeploy(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true, "the gear stays a face-down resource");
  assert.equal(gwdTokens(b), 1);
  assert.equal(b.engine.state.cards[b.id("gwd")].depleted, true);
  assert.ok(revealedIds(b).includes(b.id("gear")), "it was revealed all the same");
});

clause(GWD, "2:ability:gwd-delivery", "numeric cost 4 or less is free (0, 3 and the boundary 4), even when its threshold [D][D][D][D][D] is not met", () => {
  for (const cost of [0, 3, 4]) {
    const b = gwdBoard({ tokens: 2, gearCost: cost, rage: 6 });
    deliver(b);
    acceptDeploy(b);
    assert.equal(pending(b.engine), undefined, `cost ${cost}`);
    assert.equal(b.engine.state.cards[b.id("gear")].faceDown, false, `cost ${cost}: played`);
    assert.equal(zoneOf(b.engine, b.id("gear")), "play");
    assert.equal(attachedCount(b.engine, P1), 0, `cost ${cost}: played for free, even with 6 resources available`);
  }
});

clause(GWD, "2:ability:gwd-delivery", "numeric cost 5 or more is NOT free: it is paid in full (5 and 6), but the threshold is still ignored", () => {
  for (const cost of [5, 6]) {
    const b = gwdBoard({ tokens: 2, gearCost: cost, gearThreshold: "ddddd", rage: cost });
    deliver(b);
    acceptDeploy(b);
    assert.equal(pending(b.engine), undefined, `cost ${cost}`);
    assert.equal(b.engine.state.cards[b.id("gear")].faceDown, false, `cost ${cost}: played despite the unmet threshold`);
    assert.equal(zoneOf(b.engine, b.id("gear")), "play");
    assert.equal(attachedCount(b.engine, P1), cost, `cost ${cost}: ${cost} resources paid`);
  }
});

clause(GWD, "2:ability:gwd-delivery", "a cost-5 gear that I cannot pay for (4 resources) cannot be played; the choice can still be declined", () => {
  const b = gwdBoard({ tokens: 2, gearCost: 5, rage: 4 });
  deliver(b);
  refused(() => acceptDeploy(b), "5 to pay, only 4 resources", /pay|afford|resource/i);
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true, "still face-down");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing was paid");
  declineDeploy(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true);
});

clause(GWD, "2:ability:gwd-delivery", "the revealed card must be a FACE-DOWN card with subtype gear that I control", () => {
  const b = gwdBoard({
    tokens: 2,
    noGear: true,
    extra: [
      { key: "gearOk", def: gearDef(2), owner: P1, zone: "play", faceDown: true },
      { key: "gearUp", def: gearDef(2, "d", { name: "FaceUpGear" }), owner: P1, zone: "play" },
      { key: "tool", def: item({ name: "Tool", cost: 2, subtype: ["tool"] }), owner: P1, zone: "play", faceDown: true },
      { key: "foeGear", def: gearDef(2, "d", { name: "FoeGear" }), owner: P2, zone: "play", faceDown: true },
      { key: "handGear", def: gearDef(2, "d", { name: "HandGear" }), owner: P1, zone: "hand" },
      { key: "gearChar", def: character({ name: "GearChar", cost: 2, subtype: ["gear"] }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  for (const bad of ["gearUp", "tool", "foeGear", "handGear"]) {
    refused(() => deliver(b, bad), `${bad} is not a face-down gear card I control`, /Illegal target/);
    assert.equal(gwdTokens(b), 2, `${bad}: no token removed`);
    assert.equal(b.engine.state.cards[b.id("gwd")].depleted, false, `${bad}: not depleted`);
  }
  deliver(b, "gearOk");
  acceptDeploy(b, "gearOk");
  assert.equal(b.engine.state.cards[b.id("gearOk")].faceDown, false, "control: a face-down gear card of mine is a legal pick");
  assert.equal(b.engine.state.cards[b.id("gearUp")].faceDown, false);
});

clause(GWD, "2:ability:gwd-delivery", "unpayable costs: no token, or a depleted Dealer, refuses DELIVERY; a Dealer with exactly one token spends it", () => {
  const noTokens = gwdBoard({ tokens: 0 });
  refused(() => deliver(noTokens), "no token to remove");
  assert.equal(noTokens.engine.state.cards[noTokens.id("gwd")].depleted, false);
  const depleted = gwdBoard({ tokens: 2, gwd: { depleted: true } });
  refused(() => deliver(depleted), "the Dealer is already depleted");
  assert.equal(gwdTokens(depleted), 2, "the token was not taken");
  const one = gwdBoard({ tokens: 1, gearCost: 0 });
  deliver(one);
  acceptDeploy(one);
  assert.equal(gwdTokens(one), 0, "control: with one token it works and uses it up");
  assert.equal(one.engine.state.cards[one.id("gear")].faceDown, false);
});

// =====================================================================================
// Gassy Gastornis — character, rogue, beast, cost 6, [D], 3/3/4
// TACTICAL
// =====================================================================================

function gasBoard(o: { dec?: number; rage?: number; foeTurn?: boolean; gas?: Partial<CardPlacement>; extra?: CardPlacement[] } = {}): Board {
  const cards: CardPlacement[] = [
    { key: "gas", def: printing(GAS), owner: P1, zone: "hand", ...o.gas },
    { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
    { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
    ...named("dec", "deception", o.dec ?? 6, P1),
    ...named("rage", "rage", o.rage ?? 0, P1),
    ...(o.extra ?? [])
  ];
  return o.foeTurn ? duo(cards, { turn: 2, active: P2 }) : duo(cards);
}

clause(GAS, "0:kw:TACTICAL", "has the TACTICAL keyword (an ordinary character does not)", () => {
  const b = gasBoard({ extra: [] });
  assert.ok(b.engine.getKeywords(b.id("gas")).includes("tactical"), "b.engine.getKeywords(b.id(\"gas\")).includes(\"tactical\")");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("tactical"), false, "control: a plain character is not TACTICAL");
});

clause(GAS, "0:kw:TACTICAL", "an ordinary character can only be deployed on my own turn; TACTICAL lets Gastornis be deployed in the opponent's response window, at its printed cost 6", () => {
  const b = gasBoard({ foeTurn: true });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain")), "an ordinary character cannot be deployed in the opponent's window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  play(b.engine, P1, b.id("gas"));
  assert.equal(zoneOf(b.engine, b.id("gas")), "play", "Gastornis is deployed");
  assert.equal(attachedCount(b.engine, P1), 6, "it still costs 6");
});

clause(GAS, "0:kw:TACTICAL", "TACTICAL changes the timing only: cost 6 and the [D] threshold are still required (refused with 5 resources, refused with 6 resources and no [D])", () => {
  const short = gasBoard({ foeTurn: true, dec: 5 });
  declareAttackOpenWindow(short.engine, P2, [short.id("atk")]);
  refused(() => play(short.engine, P1, short.id("gas")), "5 resources for a cost-6 card");
  assert.equal(zoneOf(short.engine, short.id("gas")), "hand");
  const noIcon = gasBoard({ foeTurn: true, dec: 0, rage: 6 });
  declareAttackOpenWindow(noIcon.engine, P2, [noIcon.id("atk")]);
  refused(() => play(noIcon.engine, P1, noIcon.id("gas")), "6 resources but no [D]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("gas")), "hand");
  const ok = gasBoard({ foeTurn: true, dec: 1, rage: 5 });
  declareAttackOpenWindow(ok.engine, P2, [ok.id("atk")]);
  play(ok.engine, P1, ok.id("gas"));
  assert.equal(zoneOf(ok.engine, ok.id("gas")), "play", "control: 6 resources with one [D] is enough");
});

clause(GAS, "0:kw:TACTICAL", "on my own turn it deploys normally (cost 6, printed 3/3/4); TACTICAL does not make it a tactic that is discarded", () => {
  const short = gasBoard({ dec: 5 });
  refused(() => play(short.engine, P1, short.id("gas")), "5 resources for a cost-6 card");
  const b = gasBoard();
  play(b.engine, P1, b.id("gas"));
  assert.equal(zoneOf(b.engine, b.id("gas")), "play", "a TACTICAL character resolves into play");
  assert.equal(attachedCount(b.engine, P1), 6);
  assert.deepEqual([b.engine.getStat(b.id("gas"), "strength"), b.engine.getStat(b.id("gas"), "speed"), b.engine.getStat(b.id("gas"), "life")], [3, 3, 4]);
});

clause(GAS, "0:kw:TACTICAL", "its whole text is TACTICAL: no FLIP UP, so a face-down Gastornis cannot be flipped up, not even in the opponent's window", () => {
  const flip = (b: Board) => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("gas"), selected: {}, variables: {} });
  const own = gasBoard({ gas: { zone: "play", faceDown: true } });
  refused(() => flip(own), "no FLIP UP on the card");
  assert.equal(own.engine.state.cards[own.id("gas")].faceDown, true);
  const foe = gasBoard({ foeTurn: true, gas: { zone: "play", faceDown: true } });
  declareAttackOpenWindow(foe.engine, P2, [foe.id("atk")]);
  refused(() => flip(foe), "no FLIP UP on the card");
  assert.equal(foe.engine.state.cards[foe.id("gas")].faceDown, true);
});

// =====================================================================================
// Guileful Astucion — tactic, rogue, cost 2, [D][D]
// COST: Pick a character. EFFECT: Choose one of the following as this card's effect:
// OPTION 1: This turn, the character loses 1 numeric cost. Draw a card.
// OPTION 2: This turn, the character gains 1 numeric cost. Draw a card.
// OPTION 3: This turn, the character gains 1 speed. Draw a card.
// =====================================================================================

function gaBoard(o: { dec?: number; rage?: number; mineCost?: number; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}): Board {
  return duo(
    [
      { key: "ga", def: printing(GA), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", cost: o.mineCost ?? 3, speed: 2, strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 4, speed: 3, strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "trinket", def: item({ name: "Trinket" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...named("dec", "deception", o.dec ?? 3, P1),
      ...named("rage", "rage", o.rage ?? 0, P1),
      ...fillers("d", 4, P1, "deck"),
      ...(o.extra ?? [])
    ],
    o
  );
}
const gaPlay = (b: Board, pick: string) => play(b.engine, P1, b.id("ga"), { selected: { ch: [b.id(pick)] } });
const gaChoose = (b: Board, pick: string, index: number) => {
  gaPlay(b, pick);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  answerPending(b.engine, "chooserSelectsOption", { index });
  assert.equal(pending(b.engine), undefined);
};
const numericCost = (b: Board, key: string, who: PlayerId = P1) => b.engine.getCardPlayability(who, b.id(key)).numericCost;
const handOf = (b: Board) => [...b.engine.state.players[P1].hand];
const deckOf = (b: Board) => [...b.engine.state.players[P1].deck];

clause(GA, "0:ability", "COST: the 2 resources are paid and a character is picked; then I (the controller) am offered exactly 3 options; the tactic goes to the discard pile after", () => {
  const b = gaBoard();
  gaPlay(b, "mine");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption", "choose one of the following");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.equal((pc.options as unknown[]).length, 3, "three options");
  assert.equal(attachedCount(b.engine, P1), 2, "COST: 2 resources already paid");
  answerPending(b.engine, "chooserSelectsOption", { index: 2 });
  assert.equal(zoneOf(b.engine, b.id("ga")), "discard");
});

clause(GA, "0:ability", "any character in play can be picked, mine or the opponent's; the other character is not affected", () => {
  for (const [pick, other] of [["mine", "foe"], ["foe", "mine"]] as const) {
    const b = gaBoard();
    const speedPick = b.engine.getStat(b.id(pick), "speed");
    const speedOther = b.engine.getStat(b.id(other), "speed");
    gaChoose(b, pick, 2);
    assert.equal(b.engine.getStat(b.id(pick), "speed"), speedPick + 1, `${pick} was picked`);
    assert.equal(b.engine.getStat(b.id(other), "speed"), speedOther, `${other} was not picked`);
  }
});

clause(GA, "0:ability", "only a character in play can be picked: not an item, a location, a resource, a faction, a character in hand, or nothing", () => {
  const b = gaBoard();
  const factions = [b.engine.state.players[P1].factionId!, b.engine.state.players[P2].factionId!];
  for (const bad of ["trinket", "place", "handChar", "dec0"]) {
    refused(() => gaPlay(b, bad), `${bad} is not a character in play`, /Illegal target/);
    assert.equal(zoneOf(b.engine, b.id("ga")), "hand", `${bad}: still in hand`);
  }
  for (const f of factions) {
    refused(() => play(b.engine, P1, b.id("ga"), { selected: { ch: [f] } }), "a faction is not a character");
  }
  refused(() => play(b.engine, P1, b.id("ga"), { selected: {} }), "no pick");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing was paid by the refused attempts");
  assert.equal(pending(b.engine), undefined);
  gaChoose(b, "mine", 2);
  assert.equal(zoneOf(b.engine, b.id("ga")), "discard", "control: a character in play works");
});

clause(GA, "0:ability", "costs 2 with [D][D]: refused with 1 resource, refused with 2 resources lacking [D][D]; 2 Deception works", () => {
  const short = gaBoard({ dec: 1 });
  refused(() => gaPlay(short, "mine"), "1 resource for a cost-2 card");
  const noIcon = gaBoard({ dec: 0, rage: 3 });
  refused(() => gaPlay(noIcon, "mine"), "enough resources but no [D][D]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ga")), "hand");
  const oneIcon = gaBoard({ dec: 1, rage: 2 });
  refused(() => gaPlay(oneIcon, "mine"), "only one [D]");
  const ok = gaBoard({ dec: 2 });
  gaChoose(ok, "mine", 0);
  assert.equal(attachedCount(ok.engine, P1), 2, "control: 2 Deception pay for it");
});

clause(GA, "1:option:OPTION 1", "the picked character loses 1 numeric cost this turn (3 -> 2; the opponent's other character is unchanged) and I draw exactly one card", () => {
  const b = gaBoard();
  const top = deckOf(b)[0];
  const handBefore = handOf(b);
  assert.equal(numericCost(b, "mine"), 3, "precondition");
  assert.equal(numericCost(b, "foe", P2), 4, "precondition");
  gaChoose(b, "mine", 0);
  assert.equal(numericCost(b, "mine"), 2, "loses 1 numeric cost");
  assert.equal(numericCost(b, "foe", P2), 4, "the other character is unchanged");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "no speed change (that is OPTION 3)");
  assert.deepEqual(handOf(b), [...handBefore.filter((c) => c !== b.id("ga")), top], "draw a card: the top card of my deck, and nothing else");
  assert.equal(deckOf(b).length, 3);
});

clause(GA, "1:option:OPTION 1", "a numeric cost never goes below 0: a cost-0 character picked for OPTION 1 stays at 0", () => {
  const b = gaBoard({ mineCost: 0 });
  gaChoose(b, "mine", 0);
  assert.equal(numericCost(b, "mine"), 0);
});

clause(GA, "1:option:OPTION 1", "'this turn': the numeric cost reduction ends with the turn", () => {
  const b = gaBoard();
  gaChoose(b, "mine", 0);
  assert.equal(numericCost(b, "mine"), 2);
  endTurn(b.engine, P1);
  assert.equal(numericCost(b, "mine"), 3, "back to the printed cost on the next turn");
});

clause(GA, "1:option:OPTION 1", "the reduced numeric cost is what the game reads for the character in play (Bug Bite destroys a cost-2 character with 1 token once it costs 1)", () => {
  const mk = () =>
    gaBoard({
      mineCost: 2,
      dec: 4,
      extra: [{ key: "bite", def: printing(BITE), owner: P1, zone: "hand" }]
    });
  const control = mk();
  play(control.engine, P1, control.id("bite"), { selected: { ch: [control.id("mine")] } });
  assert.equal(zoneOf(control.engine, control.id("mine")), "play", "control: 1 token on a cost-2 character does not destroy it");
  const b = mk();
  gaChoose(b, "mine", 0);
  play(b.engine, P1, b.id("bite"), { selected: { ch: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "its numeric cost is 1 this turn, so 1 token is enough");
});

clause(GA, "2:option:OPTION 2", "the picked character gains 1 numeric cost this turn (3 -> 4; the other character unchanged) and I draw exactly one card", () => {
  const b = gaBoard();
  const top = deckOf(b)[0];
  const handBefore = handOf(b);
  gaChoose(b, "mine", 1);
  assert.equal(numericCost(b, "mine"), 4, "gains 1 numeric cost");
  assert.equal(numericCost(b, "foe", P2), 4, "the other character is unchanged");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "no speed change");
  assert.deepEqual(handOf(b), [...handBefore.filter((c) => c !== b.id("ga")), top]);
  assert.equal(deckOf(b).length, 3);
});

clause(GA, "2:option:OPTION 2", "it can raise the opponent's character too, and the raise ends with the turn", () => {
  const b = gaBoard();
  gaChoose(b, "foe", 1);
  assert.equal(numericCost(b, "foe", P2), 5);
  assert.equal(numericCost(b, "mine"), 3);
  endTurn(b.engine, P1);
  assert.equal(numericCost(b, "foe", P2), 4, "back to the printed cost");
});

clause(GA, "2:option:OPTION 2", "the raised numeric cost is what the game reads for the character in play (Bug Bite does not destroy a cost-1 character with 1 token once it costs 2)", () => {
  const mk = () =>
    gaBoard({ mineCost: 1, dec: 4, extra: [{ key: "bite", def: printing(BITE), owner: P1, zone: "hand" }] });
  const control = mk();
  play(control.engine, P1, control.id("bite"), { selected: { ch: [control.id("mine")] } });
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: 1 token destroys a cost-1 character");
  const b = mk();
  gaChoose(b, "mine", 1);
  play(b.engine, P1, b.id("bite"), { selected: { ch: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "its numeric cost is 2 this turn, so 1 token is not enough");
});

clause(GA, "3:option:OPTION 3", "the picked character gains 1 speed this turn (2 -> 3; the other character unchanged; numeric costs unchanged) and I draw exactly one card", () => {
  const b = gaBoard();
  const top = deckOf(b)[0];
  const handBefore = handOf(b);
  gaChoose(b, "mine", 2);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3, "+1 speed");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3, "the other character is unchanged");
  assert.equal(numericCost(b, "mine"), 3, "no numeric cost change (that is OPTION 1 / 2)");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
  assert.deepEqual(handOf(b), [...handBefore.filter((c) => c !== b.id("ga")), top]);
  assert.equal(deckOf(b).length, 3);
});

clause(GA, "3:option:OPTION 3", "'this turn': the speed bonus ends with the turn", () => {
  const b = gaBoard();
  gaChoose(b, "mine", 2);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "printed speed again");
});

// =====================================================================================
// Martial Arts Wannabe — character, rogue, martial artist, cost 1, [D][D], 1/3/1
// If you control more characters than any opponent, this card cannot be picked.
// =====================================================================================

type MawOpts = { mine?: number; foes?: number; mawController?: PlayerId; extra?: CardPlacement[]; active?: PlayerId };
function mawBoard(o: MawOpts = {}): Board {
  return duo(
    [
      { key: "maw", def: printing(MAW), owner: P1, zone: "play", ...(o.mawController ? { controller: o.mawController } : {}) },
      ...Array.from({ length: o.mine ?? 0 }, (_, i): CardPlacement => ({ key: `m${i}`, def: character({ name: `Mine${i}` }), owner: P1, zone: "play" })),
      ...Array.from({ length: o.foes ?? 0 }, (_, i): CardPlacement => ({ key: `f${i}`, def: character({ name: `Foe${i}` }), owner: P2, zone: "play" })),
      { key: "pickP1", def: picker("P1 Picker"), owner: P1, zone: "hand" },
      { key: "pickP2", def: picker("P2 Picker"), owner: P2, zone: "hand" },
      { key: "pick2P1", def: picker("P1 Picker 2"), owner: P1, zone: "hand" },
      { key: "pick2P2", def: picker("P2 Picker 2"), owner: P2, zone: "hand" },
      { key: "killP1", def: killer, owner: P1, zone: "hand" },
      { key: "killP2", def: killer, owner: P2, zone: "hand" },
      { key: "sweepP2", def: sweeper, owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ],
    { turn: 2, active: o.active ?? P1 }
  );
}
const pickWith = (b: Board, by: PlayerId, target: string, second = false) =>
  play(b.engine, by, b.id(`pick${second ? "2" : ""}${by === P1 ? "P1" : "P2"}`), { selected: { t: [b.id(target)] } });
const killWith = (b: Board, by: PlayerId, target: string) => play(b.engine, by, b.id(`kill${by === P1 ? "P1" : "P2"}`), { selected: { t: [b.id(target)] } });

/** Runs `check` with the picker being each player in turn (the card can't be picked by anybody). */
const eachPicker = (o: MawOpts, check: (b: Board, by: PlayerId) => void) => {
  for (const by of [P1, P2] as const) check(mawBoard({ ...o, active: by }), by);
};
const assertHidden = (b: Board, by: PlayerId, target = "maw") => {
  refused(() => pickWith(b, by, target), `${target} cannot be picked by ${by}`, /Illegal target/);
  assert.equal(tokensOn(b.engine, b.id(target)), 0, `${target} got no token`);
};
const assertPickable = (b: Board, by: PlayerId, target = "maw") => {
  pickWith(b, by, target);
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id(target)), 1, `${target} was picked by ${by}`);
};

clause(MAW, "0:rule", "I control more characters than the opponent (1 vs 0): nobody can pick it, neither I nor the opponent", () => {
  eachPicker({ mine: 0, foes: 0 }, (b, by) => assertHidden(b, by));
});

clause(MAW, "0:rule", "more characters than any opponent (3 vs 1): it cannot be picked, while my other characters and the opponent's can be", () => {
  eachPicker({ mine: 2, foes: 1 }, (b, by) => {
    assertHidden(b, by);
    assertPickable(b, by, "m0");
  });
  eachPicker({ mine: 2, foes: 1 }, (b, by) => assertPickable(b, by, "f0"));
});

clause(MAW, "0:rule", "equal character counts (1 vs 1, 2 vs 2): it can be picked", () => {
  eachPicker({ mine: 0, foes: 1 }, (b, by) => assertPickable(b, by));
  eachPicker({ mine: 1, foes: 2 }, (b, by) => assertPickable(b, by));
});

clause(MAW, "0:rule", "fewer characters than the opponent (1 vs 3): it can be picked", () => {
  eachPicker({ mine: 0, foes: 3 }, (b, by) => assertPickable(b, by));
});

clause(MAW, "0:rule", "only CHARACTERS are counted: my items / locations / resources / hand characters do not make it hidden; the opponent's items do not make it pickable", () => {
  eachPicker(
    {
      foes: 1,
      extra: [
        { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
        { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
        { key: "myHand", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
        ...named("res", "rage", 3, P1)
      ]
    },
    (b, by) => assertPickable(b, by)
  );
  eachPicker(
    {
      foes: 0,
      extra: [
        { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
        { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
        { key: "foeHand", def: character({ name: "FoeHand" }), owner: P2, zone: "hand" },
        ...named("fres", "rage", 3, P2)
      ]
    },
    (b, by) => assertHidden(b, by)
  );
});

clause(MAW, "0:rule", "face-down cards are not characters (CR 411.1): face-down character cards don't count for either side", () => {
  const mineFd: CardPlacement = { key: "fdMine", def: character({ name: "FdMine" }), owner: P1, zone: "play", faceDown: true };
  const foeFd: CardPlacement = { key: "fdFoe", def: character({ name: "FdFoe" }), owner: P2, zone: "play", faceDown: true };
  // 1 vs 1 real character: my face-down card must not make it 2 vs 1.
  eachPicker({ foes: 1, extra: [mineFd] }, (b, by) => assertPickable(b, by));
  // 1 vs 0 real characters: the opponent's face-down card must not make it 1 vs 1.
  eachPicker({ foes: 0, extra: [foeFd] }, (b, by) => assertHidden(b, by));
});

clause(MAW, "0:rule", "the count is live: killing the opponent's last character hides it, and killing my other character shows it again", () => {
  const hide = mawBoard({ foes: 1, active: P1 });
  assertPickable(hide, P1);
  killWith(hide, P1, "f0");
  assert.equal(zoneOf(hide.engine, hide.id("f0")), "discard");
  refused(() => pickWith(hide, P1, "maw", true), "the opponent's last character is gone: 1 vs 0");
  assert.equal(tokensOn(hide.engine, hide.id("maw")), 1, "no second token");

  const show = mawBoard({ mine: 1, foes: 1, active: P1 });
  refused(() => pickWith(show, P1, "maw"), "2 vs 1: hidden");
  killWith(show, P1, "m0");
  assert.equal(zoneOf(show.engine, show.id("m0")), "discard");
  assertPickable(show, P1, "maw");
});

clause(MAW, "0:rule", "'you' is its controller: when the opponent controls it (owner P1) the comparison is made for the opponent", () => {
  // P2 controls the Wannabe (1 character) and P1 controls none: P2 has more characters.
  const hidden = mawBoard({ mawController: P2, mine: 0, foes: 0, active: P1 });
  assertHidden(hidden, P1);
  // P2 controls it (1) while P1 controls two: P2 does NOT have more, so it can be picked.
  const open = mawBoard({ mawController: P2, mine: 2, foes: 0, active: P1 });
  assertPickable(open, P1);
});

clause(MAW, "0:rule", "it only blocks PICKING: an effect that sweeps every character (no pick) still destroys it", () => {
  const b = mawBoard({ mine: 1, foes: 0, active: P2 });
  assertHidden(b, P2);
  play(b.engine, P2, b.id("sweepP2"));
  assert.equal(zoneOf(b.engine, b.id("maw")), "discard", "destroyed by a non-picking effect");
  assert.equal(zoneOf(b.engine, b.id("m0")), "discard");
});

clause(MAW, "0:rule", "the restriction is off when it is not in play (in hand, or after it dies)", () => {
  const inHand = duo(
    [
      { key: "maw", def: printing(MAW), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "Mine0" }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P1 }
  );
  assert.equal(inHand.engine.getRestrictions(inHand.id("maw")).includes("cannotBePicked"), false, "in hand: no restriction");
  const b = mawBoard({ mine: 1, foes: 0, active: P2 });
  assert.ok(b.engine.getRestrictions(b.id("maw")).includes("cannotBePicked"), "in play with 2 vs 0: restricted");
  killWith(b, P2, "m0");
  play(b.engine, P2, b.id("sweepP2"));
  assert.equal(zoneOf(b.engine, b.id("maw")), "discard");
  assert.equal(b.engine.getRestrictions(b.id("maw")).includes("cannotBePicked"), false, "in the discard pile: no restriction");
});

// =====================================================================================
// Murderous Kleptomaniac — character, rogue, vigilante, cost 6, [D][D], 3/3/3
// COVERT
// If this card is put into a discard pile from play, you may pick a character, item, or location. If you do, remove that card from the game.
// KLEPT: [D]x10 -- COST: Pay 4. Pick a character or item. -- EFFECT: Take control of that card.
// =====================================================================================

const KLEPT = "murderous-kleptomaniac-klept";

function mkBoard(o: { dec?: number; spent?: number; mk?: Partial<CardPlacement>; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}): Board {
  return duo(
    [
      { key: "mk", def: printing(MK), owner: P1, zone: "play", ...o.mk },
      ...named("dec", "deception", o.dec ?? 10, P1).map((p, i) => (i < (o.spent ?? 0) ? { ...p, attachedToKey: "__factionA" } : p)),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mineItem", def: item({ name: "MineItem" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "fdItem", def: item({ name: "FdItem" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "kill", def: killer, owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ],
    o
  );
}
const klept = (b: Board, pick: string) => activate(b.engine, P1, b.id("mk"), KLEPT, { selected: { grab: [b.id(pick)] } });
const controllerOf = (b: Board, key: string) => b.engine.state.cards[b.id(key)].controllerId;

clause(MK, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(MK));
clause(MK, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(MK));
clause(MK, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(MK));
clause(MK, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(MK));

// --- the death trigger ------------------------------------------------------------------------

/** The opponent destroys the Kleptomaniac (on their own turn). */
const killMk = (b: Board) => play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("mk")] } });
const deathBoard = (o: { mk?: Partial<CardPlacement>; extra?: CardPlacement[]; bare?: boolean } = {}): Board =>
  o.bare
    ? duo([{ key: "mk", def: printing(MK), owner: P1, zone: "play", ...o.mk }, { key: "kill", def: killer, owner: P2, zone: "hand" }, ...(o.extra ?? [])], { turn: 2, active: P2 })
    : mkBoard({ dec: 3, mk: o.mk, extra: o.extra, turn: 2, active: P2 });
const exilePick = (b: Board, victim: string) => answerPending(b.engine, "selectTargets", { selected: { victim: [b.id(victim)] } });

clause(MK, "1:rule", "when it is destroyed in play, I (its controller) may pick a character: accepting removes that card from the game (not to the discard pile)", () => {
  const b = deathBoard();
  killMk(b);
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "selectTargets", "the pick is offered");
  assert.equal(pc.playerId, P1, "its controller picks");
  exilePick(b, "foe");
  assert.equal(pending(b.engine), undefined);
  assert.notEqual(zoneOf(b.engine, b.id("foe")), "play");
  assert.notEqual(zoneOf(b.engine, b.id("foe")), "discard", "removed from the game, not destroyed");
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard", "the Kleptomaniac itself stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "nothing else was removed");
});

clause(MK, "1:rule", "'may': declining the pick removes nothing", () => {
  const b = deathBoard();
  killMk(b);
  answerPending(b.engine, "selectTargets", { selected: { victim: [] } });
  assert.equal(pending(b.engine), undefined);
  for (const k of ["mine", "mineItem", "foe", "foeItem", "foeLoc"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard");
});

clause(MK, "1:rule", "an item and a location can be picked and removed too, whoever controls them (mine included)", () => {
  for (const victim of ["foeItem", "foeLoc", "mineItem", "mine"]) {
    const b = deathBoard();
    killMk(b);
    exilePick(b, victim);
    assert.equal(pending(b.engine), undefined, victim);
    assert.notEqual(zoneOf(b.engine, b.id(victim)), "play", `${victim} left play`);
    assert.notEqual(zoneOf(b.engine, b.id(victim)), "discard", `${victim} was removed from the game, not discarded`);
    for (const other of ["mine", "mineItem", "foe", "foeItem", "foeLoc"].filter((k) => k !== victim)) {
      assert.equal(zoneOf(b.engine, b.id(other)), "play", `${victim}: ${other} untouched`);
    }
  }
});

clause(MK, "1:rule", "only a character, item or location in play can be picked: not a resource, a faction, a face-down card or a card in hand", () => {
  const b = deathBoard();
  killMk(b);
  const factions = [b.engine.state.players[P1].factionId!, b.engine.state.players[P2].factionId!];
  for (const bad of [b.id("dec0"), b.id("fdItem"), b.id("handChar"), b.id("mk"), ...factions]) {
    refused(() => answerPending(b.engine, "selectTargets", { selected: { victim: [bad] } }), `${bad} is not a legal pick`, /Illegal target/);
  }
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the choice is still open after the refused picks");
  exilePick(b, "foeLoc");
  assert.notEqual(zoneOf(b.engine, b.id("foeLoc")), "play", "control: a location is a legal pick");
  assert.equal(zoneOf(b.engine, b.id("fdItem")), "play");
  assert.equal(zoneOf(b.engine, b.id("handChar")), "hand");
});

clause(MK, "1:rule", "it also triggers when it dies in battle (lethal damage), not only when a tactic destroys it", () => {
  const b = mkBoard({
    dec: 3,
    turn: 2,
    active: P1,
    extra: [{ key: "bigCovert", def: character({ name: "BigCovert", strength: 6, life: 6, speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P1, [b.id("mk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("bigCovert")] });
  let offered = false;
  finishBattle(b.engine, undefined, (pc) => {
    if (pc.kind === "selectTargets") {
      offered = true;
      assert.equal(pc.playerId, P1, "its controller picks");
      return { kind: "selectTargets", selected: { victim: [b.id("foeItem")] } };
    }
    return declineAll(pc);
  });
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard", "it died in the battle");
  assert.equal(offered, true, "the pick was offered");
  assert.notEqual(zoneOf(b.engine, b.id("foeItem")), "play");
  assert.notEqual(zoneOf(b.engine, b.id("foeItem")), "discard", "removed from the game");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(MK, "1:rule", "with nothing else to pick it just dies (no prompt)", () => {
  const b = deathBoard({ bare: true });
  killMk(b);
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(MK, "1:rule", "it triggers only for its own death: another character being destroyed while it is in play does not offer a pick", () => {
  const b = deathBoard();
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(pending(b.engine), undefined, "no pick for somebody else's death");
  assert.equal(zoneOf(b.engine, b.id("mk")), "play");
});

clause(MK, "1:rule", "it needs 'from play': a Kleptomaniac that leaves play by being removed from the game (not discarded) offers no pick", () => {
  const exiler = tactic({
    name: "Exiler",
    cost: 0,
    behavior: {
      abilities: [{ id: "ex", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
  const b = deathBoard({ extra: [{ key: "exiler", def: exiler, owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("exiler"), { selected: { t: [b.id("mk")] } });
  assert.notEqual(zoneOf(b.engine, b.id("mk")), "play");
  assert.notEqual(zoneOf(b.engine, b.id("mk")), "discard");
  assert.equal(pending(b.engine), undefined, "it never went to a discard pile");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(MK, "1:rule", "the controller at the time picks, not the owner: a Kleptomaniac I own that my opponent controls offers the pick to the opponent", () => {
  const b = deathBoard({ mk: { controller: P2 } });
  killMk(b);
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard");
  const pc = pending(b.engine)!;
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P2, "its controller (P2) picks");
});

// --- KLEPT ------------------------------------------------------------------------------------

clause(MK, "2:ability:murderous-kleptomaniac-klept", "with [D]x10: COST pays 4 resources; EFFECT takes control of the picked opponent character, which stays mine", () => {
  const b = mkBoard();
  assert.equal(controllerOf(b, "foe"), P2);
  assert.equal(attachedCount(b.engine, P1), 0);
  klept(b, "foe");
  assert.equal(pending(b.engine), undefined);
  assert.equal(attachedCount(b.engine, P1), 4, "COST: pay 4");
  assert.equal(b.engine.getAvailableResourceCount(P1), 6, "6 resources left");
  assert.equal(controllerOf(b, "foe"), P1, "I control it now");
  assert.equal(b.engine.state.cards[b.id("foe")].ownerId, P2, "its owner is unchanged");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("foe")), "b.engine.state.players[P1].play.includes(b.id(\"foe\"))");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(controllerOf(b, "foe"), P1, "control has no end date");
});

clause(MK, "2:ability:murderous-kleptomaniac-klept", "an item can be taken as well; the Kleptomaniac can use it while depleted (no deplete in the cost)", () => {
  const b = mkBoard({ mk: { depleted: true } });
  klept(b, "foeItem");
  assert.equal(controllerOf(b, "foeItem"), P1);
  assert.equal(b.engine.state.cards[b.id("foeItem")].ownerId, P2);
  assert.equal(attachedCount(b.engine, P1), 4);
});

clause(MK, "2:ability:murderous-kleptomaniac-klept", "only a character or item in play can be picked: not a location, a resource, a faction, a face-down card or a card in hand", () => {
  const b = mkBoard();
  const factions = [b.engine.state.players[P1].factionId!, b.engine.state.players[P2].factionId!];
  for (const bad of ["foeLoc", "dec0", "fdItem", "handChar"]) {
    refused(() => klept(b, bad), `${bad} is not a character or item in play`, /Illegal target/);
    assert.equal(attachedCount(b.engine, P1), 0, `${bad}: nothing was paid`);
  }
  for (const f of factions) refused(() => activate(b.engine, P1, b.id("mk"), KLEPT, { selected: { grab: [f] } }), "a faction is not a character or item");
  assert.equal(controllerOf(b, "foeLoc"), P2);
  klept(b, "foe");
  assert.equal(controllerOf(b, "foe"), P1, "control: a character works");
});

clause(MK, "2:ability:murderous-kleptomaniac-klept", "the threshold is [D]x10: with only 9 Deception (plus another resource) it is refused", () => {
  const short = mkBoard({ dec: 9, extra: named("rage", "rage", 3, P1) });
  assert.equal(short.engine.getAvailableResourceCount(P1), 12, "plenty of resources to pay 4");
  refused(() => klept(short, "foe"), "only 9 [D]");
  assert.equal(controllerOf(short, "foe"), P2);
  assert.equal(attachedCount(short.engine, P1), 0);
  const ok = mkBoard({ dec: 10 });
  klept(ok, "foe");
  assert.equal(controllerOf(ok, "foe"), P1, "control: exactly 10 [D] is enough");
});

clause(MK, "2:ability:murderous-kleptomaniac-klept", "an unaffordable 'Pay 4' is refused: 10 [D] on the table but only 3 of them still ready", () => {
  const b = mkBoard({ dec: 10, spent: 7 });
  assert.equal(b.engine.getAvailableResourceCount(P1), 3);
  refused(() => klept(b, "foe"), "3 ready resources cannot pay 4");
  assert.equal(controllerOf(b, "foe"), P2);
  assert.equal(attachedCount(b.engine, P1), 7, "nothing more was spent");
  const ok = mkBoard({ dec: 10, spent: 6 });
  klept(ok, "foe");
  assert.equal(controllerOf(ok, "foe"), P1, "control: exactly 4 ready resources pay for it");
  assert.equal(attachedCount(ok.engine, P1), 10);
});

// =====================================================================================
// T3c7 behavior-mutation pass: printed numbers, trade / subtype, mandatory picks, no phantom keywords
// =====================================================================================

clause(WOLF, "0:ability:elusive-wolf-howl", "printed type / trade / subtype / stats / cost 4 / threshold [D]: a Rogue Beast, 2 strength / 4 speed / 2 life", () => {
  printedStats({ id: WOLF, type: "character", subtype: ["beast"], strength: 2, speed: 4, life: 2 });
  assert.equal(printing(WOLF).trade, "rogue", "the Wolf is a Rogue card");
  printedCost({ id: WOLF, cost: 4, threshold: "d" });
});

clause(WOLF, "0:ability:elusive-wolf-howl", "the Deception to destroy is a required pick: activating HOWL with nothing picked is refused and nothing changes", () => {
  const b = wolfBoard({ dec: 2 });
  refused(() => activate(b.engine, P1, b.id("wolf"), HOWL, { selected: { dec: [] } }), "no Deception picked");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 0, "no token was added");
  assert.equal(zoneOf(b.engine, b.id("dec0")), "play", "no Deception was destroyed");
  assert.equal(zoneOf(b.engine, b.id("dec1")), "play", "no Deception was destroyed");
  howl(b, "dec0");
  assert.equal(tokensOn(b.engine, b.id("wolf")), 1, "control: with a Deception picked it works");
});

clause(GWD, "0:rule", "printed type / trade / subtype / stats / cost 5 / threshold [D][D]: a Rogue Gang Member, 1 strength / 4 speed / 3 life", () => {
  printedStats({ id: GWD, type: "character", subtype: ["gang member"], strength: 1, speed: 4, life: 3 });
  assert.equal(printing(GWD).trade, "rogue", "the Dealer is a Rogue card");
  printedCost({ id: GWD, cost: 5, threshold: "dd" });
});

clause(GWD, "2:ability:gwd-delivery", "the face-down gear to reveal is a required pick: DELIVERY with nothing picked is refused and nothing is paid", () => {
  const b = gwdBoard({ tokens: 2 });
  refused(() => activate(b.engine, P1, b.id("gwd"), DELIVERY, { selected: { g: [] } }), "no face-down gear picked");
  assert.equal(gwdTokens(b), 2, "no token was removed");
  assert.equal(b.engine.state.cards[b.id("gwd")].depleted, false, "the Dealer was not depleted");
  assert.equal(b.engine.state.cards[b.id("gear")].faceDown, true, "the gear stays face-down");
});

clause(GAS, "0:kw:TACTICAL", "printed type / trade / subtype / stats: a Rogue Beast, 3 strength / 3 speed / 4 life, and TACTICAL is its only keyword (no AGGRO)", () => {
  printedStats({ id: GAS, type: "character", subtype: ["beast"], strength: 3, speed: 3, life: 4 });
  assert.equal(printing(GAS).trade, "rogue", "Gastornis is a Rogue card");
  const b = duo([{ key: "gas", def: printing(GAS), owner: P1, zone: "play", attackEligible: false }]);
  assert.deepEqual([...b.engine.getKeywords(b.id("gas"))], ["tactical"], "TACTICAL and nothing else");
  refused(() => declareAttackBy(b.engine, P1, [b.id("gas")]), "a character that just entered cannot attack without AGGRO", /AGGRO/);
});

clause(GA, "0:ability", "printed type / trade / subtype: a Rogue tactic with no subtype", () => {
  printedStats({ id: GA, type: "tactic", subtype: [] });
  assert.equal(printing(GA).trade, "rogue", "Guileful Astucion is a Rogue card");
});

clause(MAW, "0:rule", "printed type / trade / subtype / stats / cost 1 / threshold [D][D]: a Rogue Martial Artist, 1 strength / 3 speed / 1 life", () => {
  printedStats({ id: MAW, type: "character", subtype: ["martial artist"], strength: 1, speed: 3, life: 1 });
  assert.equal(printing(MAW).trade, "rogue", "the Wannabe is a Rogue card");
  printedCost({ id: MAW, cost: 1, threshold: "dd" });
});

clause(MK, "0:kw:COVERT", "printed type / trade / subtype / stats / cost 6 / threshold [D][D]: a Rogue Vigilante, 3 strength / 3 speed / 3 life", () => {
  printedStats({ id: MK, type: "character", subtype: ["vigilante"], strength: 3, speed: 3, life: 3 });
  assert.equal(printing(MK).trade, "rogue", "the Kleptomaniac is a Rogue card");
  printedCost({ id: MK, cost: 6, threshold: "dd" });
});

clause(MK, "1:rule", "'pick a character, item, or location' is exactly one card: two at once are refused, the prompt stays open and nothing is removed", () => {
  const b = deathBoard();
  killMk(b);
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the pick is offered");
  refused(() => answerPending(b.engine, "selectTargets", { selected: { victim: [b.id("foe"), b.id("foeItem")] } }), "two cards at once");
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the prompt is still open");
  for (const k of ["foe", "foeItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} was not removed`);
  exilePick(b, "foe");
  assert.notEqual(zoneOf(b.engine, b.id("foe")), "play", "control: one card is accepted");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "play", "the other card stays");
});

clause(MK, "2:ability:murderous-kleptomaniac-klept", "the pick is required (nothing picked is refused, nothing paid) and may be one of my own cards (no controller restriction)", () => {
  const b = mkBoard();
  const before = b.engine.getAvailableResourceCount(P1);
  refused(() => activate(b.engine, P1, b.id("mk"), KLEPT, { selected: { grab: [] } }), "no card picked");
  assert.equal(b.engine.getAvailableResourceCount(P1), before, "nothing was paid");
  klept(b, "mine");
  assert.equal(pending(b.engine), undefined);
  assert.equal(controllerOf(b, "mine"), P1, "my own character was a legal pick and stays mine");
  assert.equal(b.engine.getAvailableResourceCount(P1), before - 4, "the 4 were paid for the legal pick");
});
