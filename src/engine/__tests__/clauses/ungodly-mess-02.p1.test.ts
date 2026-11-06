// Clause tests: Ungodly Mess batch 02, part p1 (groups 1-8, missing clauses only).
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import {
  buildGame,
  activate, bank, character, developFaction, item, killTactic, bounceTactic, location, play, resolvePendingResponses,
  resourceCard, volition, P1, P2
} from "../per-card/_harness.js";
import { declareAttackBy, declareAttackOpenWindow, covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert, finishBattle } from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { clause, drain, declineAll, printing, refused, type PendingChoiceLike, flipUpNow } from "./_clause.js";
import { developResource, endTurn, factionOf } from "./_turn.js";
import { developDraw } from "../support/develop.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
type Def = ReturnType<typeof character>;
const ANY = /[\s\S]*/;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const handOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].hand] as string[];
const discardOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].discard] as string[];
const pickIds = (ids: string[]) => (pc: PendingChoiceLike) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>) => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};
const withWhy = <T>(why: string, fn: () => T): T => {
  try { return fn(); } catch (e) { throw new Error(`${why}: ${(e as Error).message}`); }
};
const noTextChar = (name: string, over: Partial<Def> = {}) => character({ name, text: "no icons", ...over });

// ============================================================================
// Ritualized Destruction
// EXTRA COST: Pick a non-resource card. -- If the card has a [V] icon in its rules text, put the card into the void.
// Otherwise, put the card into its owner's hand. -- FLIP UP: 3 [O]
// Tactic, arcanist, cost 4, [O].
// ============================================================================
const RD = "a5f05d7e-999b-4e7a-a155-185997c75acf";

function rdBoard(o: { o?: number; greed?: number; extra?: Cards; flip?: boolean; turn?: number; active?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "rd", def: printing(RD), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("obsession", o.o ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      { key: "foe", def: noTextChar("Foe"), owner: P2, zone: "play" },
      { key: "mine", def: noTextChar("Mine"), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const rdPlay = (b: ReturnType<typeof rdBoard>, c: string[]) => play(b.engine, P1, b.id("rd"), { selected: { c } });
const rdFlip = (b: ReturnType<typeof rdBoard>, c: string[], player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("rd"), selected: { c }, variables: {} });

clause(RD, "0:extraCost", "the card is an Arcanist tactic, cost 4, threshold [O]: exactly 4 Obsession resources deploy it and spend exactly 4", () => {
  const p = printing(RD);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 4, "o"]);
  const b = rdBoard({ o: 5 });
  assert.equal(ready(b.engine, P1), 5);
  rdPlay(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  assert.equal(ready(b.engine, P1), 1, "exactly 4 paid");
});

clause(RD, "0:extraCost", "one resource short of the cost is refused and nothing is paid; the same board with 4 works", () => {
  const b = rdBoard({ o: 3 });
  refused(() => rdPlay(b, [b.id("foe")]), "3 resources for cost 4", ANY);
  assert.equal(zoneOf(b.engine, b.id("rd")), "hand");
  assert.equal(ready(b.engine, P1), 3);
  const ok = rdBoard({ o: 4 });
  rdPlay(ok, [ok.id("foe")]);
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard");
});

clause(RD, "0:extraCost", "the threshold [O] is required: 4 Greed resources (no Obsession icon) are refused; 1 Obsession + 3 Greed works", () => {
  const b = rdBoard({ o: 0, greed: 4 });
  refused(() => rdPlay(b, [b.id("foe")]), "no [O] icon", ANY);
  assert.equal(zoneOf(b.engine, b.id("rd")), "hand");
  assert.equal(ready(b.engine, P1), 4);
  const ok = rdBoard({ o: 1, greed: 3 });
  rdPlay(ok, [ok.id("foe")]);
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard");
});

clause(RD, "0:extraCost", "the picked card can be a character, item or location of either player in play (pick defaults to cards in play); cards in a hand or discard pile are refused", () => {
  const cases: Array<[string, Def, "play" | "hand" | "discard", typeof P1 | typeof P2]> = [
    ["P2 character in play", noTextChar("A"), "play", P2],
    ["P1 character in play", noTextChar("B"), "play", P1],
    ["P2 item in play", item({ name: "I", text: "no icons" }), "play", P2],
    ["P1 location in play", location({ name: "L", text: "no icons" }), "play", P1]
  ];
  for (const [why, zone] of [["P2 character in discard", "discard"], ["P2 character in hand", "hand"]] as const) {
    const b = rdBoard({ extra: [{ key: "t", def: noTextChar("Z"), owner: P2, zone }] });
    refused(() => rdPlay(b, [b.id("t")]), why, ANY);
    assert.equal(zoneOf(b.engine, b.id("rd")), "hand", `${why}: not played`);
    assert.equal(ready(b.engine, P1), 4, `${why}: nothing paid`);
  }
  for (const [why, def, zone, owner] of cases) {
    const b = rdBoard({ extra: [{ key: "t", def, owner, zone }] });
    withWhy(why, () => rdPlay(b, [b.id("t")]));
    assert.equal(zoneOf(b.engine, b.id("rd")), "discard", why);
    assert.equal(b.engine.state.pendingChoice, undefined, why);
    assert.equal(b.engine.state.players[owner].hand.includes(b.id("t") as never), true, `${why}: ends in its owner's hand`);
  }
});

clause(RD, "0:extraCost", "resources cannot be picked: a face-up staple, a face-down card, and a resource card in hand are all refused (control: a character works)", () => {
  const faceUp = bank("greed", 1, P2);
  const down = volition(1, P2);
  const b = rdBoard({
    extra: [...faceUp, ...down, { key: "resHand", def: resourceCard({ name: "ResHand", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
  });
  for (const [why, key] of [["face-up staple", faceUp[0].key], ["face-down card", down[0].key], ["resource card in hand", "resHand"]] as const) {
    refused(() => rdPlay(b, [b.id(key)]), why, ANY);
    assert.equal(zoneOf(b.engine, b.id("rd")), "hand", `${why}: not played`);
    assert.equal(ready(b.engine, P1), 4, `${why}: nothing paid`);
  }
  rdPlay(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
});

clause(RD, "0:extraCost", "a faction cannot be picked (CR 202.9); an opponent's faction and my own are refused", () => {
  const b = rdBoard();
  refused(() => rdPlay(b, [factionOf(b.engine, P2)]), "opponent faction", ANY);
  refused(() => rdPlay(b, [factionOf(b.engine, P1)]), "own faction", ANY);
  assert.equal(zoneOf(b.engine, b.id("rd")), "hand");
  assert.equal(zoneOf(b.engine, factionOf(b.engine, P2)), "play", "faction still in play");
  rdPlay(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
});

clause(RD, "0:extraCost", "a card must be picked (none refused) and exactly one (two refused); the extra cost is paid before the effect", () => {
  const b = rdBoard();
  refused(() => play(b.engine, P1, b.id("rd"), { selected: {} }), "no pick", ANY);
  refused(() => rdPlay(b, [b.id("foe"), b.id("mine")]), "two picks", ANY);
  assert.equal(zoneOf(b.engine, b.id("rd")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  rdPlay(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "only the picked card is affected");
});

// --- rule: [V] -> void, otherwise owner's hand -------------------------------
function rdResolve(def: Def, over: { owner?: typeof P1 | typeof P2; zone?: "play" | "hand" | "discard"; controller?: typeof P1 | typeof P2 } = {}) {
  const b = rdBoard({ extra: [{ key: "t", def, owner: over.owner ?? P2, zone: over.zone ?? "play", controller: over.controller }] });
  withWhy(`${def.name} ${over.zone ?? "play"}`, () => rdPlay(b, [b.id("t")]));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  return b;
}

clause(RD, "1:rule", "a card with a [V] icon in its rules text is put into the void (character, item, location)", () => {
  const cases: Array<[string, Def, "play" | "hand" | "discard"]> = [
    ["character", character({ name: "VC", text: "Pay [V] to do something." }), "play"],
    ["item", item({ name: "VI", text: "[V]: gain life" }), "play"],
    ["location", location({ name: "VL", text: "Gains [V] resources." }), "play"],
    ["second character", character({ name: "VT", text: "Only [V]." }), "play"]
  ];
  for (const [why, def, zone] of cases) {
    const b = rdResolve(def, { zone });
    assert.equal(zoneOf(b.engine, b.id("t")), "void", why);
    assert.equal(b.engine.state.players[P2].hand.includes(b.id("t") as never), false, `${why}: not in a hand`);
  }
});

clause(RD, "1:rule", "a card without a [V] icon is put into its owner's hand (character, item, location)", () => {
  const cases: Array<[string, Def, "play" | "discard"]> = [
    ["character", noTextChar("NC"), "play"],
    ["item", item({ name: "NI", text: "no icons" }), "play"],
    ["location", location({ name: "NL", text: "no icons" }), "play"]
  ];
  for (const [why, def, zone] of cases) {
    const b = rdResolve(def, { zone });
    assert.equal(zoneOf(b.engine, b.id("t")), "hand", why);
    assert.deepEqual(handOf(b.engine, P2).filter((x) => x === b.id("t")), [b.id("t")], `${why}: in the owner's hand`);
  }
});

clause(RD, "1:rule", "only the [V] icon counts: other icons, the word Volition, or a bare V in the rules text (or [V] only in the name) still go to hand", () => {
  const cases: Array<[string, Def]> = [
    ["other icons", character({ name: "OI", text: "[O][R][G][D][E]: do a thing" })],
    ["word Volition", character({ name: "WV", text: "Volition and V and (V) and v." })],
    ["[V] only in the name", character({ name: "[V] Named", text: "no icons" })]
  ];
  for (const [why, def] of cases) {
    const b = rdResolve(def);
    assert.equal(zoneOf(b.engine, b.id("t")), "hand", why);
  }
});

clause(RD, "1:rule", "the card goes to its OWNER's hand / void, not its controller's (a card I control but the opponent owns)", () => {
  const plain = rdResolve(noTextChar("Stolen"), { owner: P2, controller: P1 });
  assert.equal(zoneOf(plain.engine, plain.id("t")), "hand");
  assert.equal(handOf(plain.engine, P2).includes(plain.id("t")), true, "owner's hand");
  assert.equal(handOf(plain.engine, P1).includes(plain.id("t")), false, "not the controller's hand");
  const v = rdResolve(character({ name: "StolenV", text: "[V]" }), { owner: P2, controller: P1 });
  assert.equal(zoneOf(v.engine, v.id("t")), "void");
  assert.equal(v.engine.state.cards[v.id("t") as never].ownerId, P2);
  const mine = rdResolve(noTextChar("Mine2"), { owner: P1 });
  assert.equal(handOf(mine.engine, P1).includes(mine.id("t")), true, "my own card returns to my hand");
});

clause(RD, "1:rule", "only the picked card is moved: another [V] card stays put", () => {
  const b = rdBoard({ extra: [
    { key: "v1", def: character({ name: "V1", text: "[V]" }), owner: P2, zone: "play" },
    { key: "v2", def: character({ name: "V2", text: "[V]" }), owner: P2, zone: "play" }
  ] });
  rdPlay(b, [b.id("v1")]);
  assert.equal(zoneOf(b.engine, b.id("v1")), "void");
  assert.equal(zoneOf(b.engine, b.id("v2")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

// --- FLIP UP: 3 [O] -----------------------------------------------------------
clause(RD, "2:flipUp", "flipping up for 3 resolves the tactic on the picked card and discards it; the face-down card itself may pay (self + 2 others)", () => {
  const b = rdBoard({ flip: true, o: 1, greed: 1 });
  assert.equal(ready(b.engine, P1), 3, "the face-down card plus two resources");
  rdFlip(b, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(ready(b.engine, P1), 0, "all three paid (self included)");
});

clause(RD, "2:flipUp", "FLIP UP costs exactly 3, not the printed 4: with 5 other resources only 3 get spent", () => {
  const b = rdBoard({ flip: true, o: 5 });
  assert.equal(ready(b.engine, P1), 6);
  rdFlip(b, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  assert.equal(ready(b.engine, P1), 2, "6 ready, 3 paid, and the flipped card is no longer a resource");
});

clause(RD, "2:flipUp", "FLIP UP is refused one resource short (self + 1 other = 2 ready), with nothing paid; self + 2 others works", () => {
  const b = rdBoard({ flip: true, o: 1 });
  assert.equal(ready(b.engine, P1), 2);
  refused(() => rdFlip(b, [b.id("foe")]), "2 ready for cost 3", ANY);
  assert.equal(b.engine.state.cards[b.id("rd")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("rd")), "play");
  assert.equal(ready(b.engine, P1), 2, "nothing paid");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(RD, "2:flipUp", "FLIP UP needs an [O] icon after flipping: three Greed resources are refused; the face-down card's own Volition does not count; one Obsession works", () => {
  const b = rdBoard({ flip: true, o: 0, greed: 3 });
  assert.equal(ready(b.engine, P1), 4);
  refused(() => rdFlip(b, [b.id("foe")]), "no [O]", ANY);
  assert.equal(b.engine.state.cards[b.id("rd")].faceDown, true);
  assert.equal(ready(b.engine, P1), 4, "nothing paid");
  const ok = rdBoard({ flip: true, o: 1, greed: 2 });
  rdFlip(ok, [ok.id("foe")]);
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard", "control: one [O] suffices");
});

clause(RD, "2:flipUp", "FLIP UP still needs the extra cost: no pick, a resource pick and a faction pick are refused", () => {
  const down = volition(1, P2);
  const b = rdBoard({ flip: true, o: 3, extra: down });
  refused(() => rdFlip(b, []), "no pick", ANY);
  refused(() => rdFlip(b, [down[0].key].map((k) => b.id(k))), "resource pick", ANY);
  refused(() => rdFlip(b, [factionOf(b.engine, P2)]), "faction pick", ANY);
  assert.equal(b.engine.state.cards[b.id("rd")].faceDown, true);
  assert.equal(ready(b.engine, P1), 4);
  rdFlip(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
});

clause(RD, "2:flipUp", "a flipped-up RD applies the rule too: a [V] card is voided, others bounce", () => {
  const b = rdBoard({ flip: true, o: 3, extra: [{ key: "v", def: character({ name: "V", text: "[V]" }), owner: P2, zone: "play" }] });
  rdFlip(b, [b.id("v")]);
  assert.equal(zoneOf(b.engine, b.id("v")), "void");
  const c = rdBoard({ flip: true, o: 3 });
  rdFlip(c, [c.id("foe")]);
  assert.equal(zoneOf(c.engine, c.id("foe")), "hand");
});

clause(RD, "2:flipUp", "as a tactic it can be flipped up inside the opponent's response window", () => {
  const b = rdBoard({ flip: true, o: 3, turn: 2, active: P2, extra: [{ key: "atk", def: noTextChar("Atk"), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  rdFlip(b, [b.id("atk")]);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("atk")), "hand");
});

// ============================================================================
// Seance Ritualist
// VIOLATE -- COST: Deplete this card. Pick an opponent. X is the number of tokens on this card. Pay X.
//   EFFECT: That player discards X cards. Put a token on this card.
// BLUR: [O][O][O] -- COST: Remove a token from this card. -- EFFECT: This turn, this card gains COVERT.
// Character, arcanist, ritualist, cost 5, [O], 4 str / 1 spd / 2 life.
// ============================================================================
const SR = "58fd9f77-2796-4601-be97-d5015bb05145";

function srBoard(o: { tokens?: number; res?: number; oppHand?: number; turn?: number; active?: typeof P1 | typeof P2; extra?: Cards; obs?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "sr", def: printing(SR), owner: P1, zone: "play", counters: o.tokens ? { token: o.tokens } : undefined },
      ...bank("obsession", (o.res ?? 0) + (o.obs ?? 0), P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
      ...fillers("mh", 2, P1, "hand"),
      { key: "oppPlay", def: noTextChar("OppPlay"), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const violate = (b: ReturnType<typeof srBoard>, player: string = P1) => activate(b.engine, player as never, b.id("sr"), "violate");

clause(SR, "0:ability:violate", "the card is an Arcanist ritualist character, cost 5, [O], 4 str / 1 spd / 2 life: 5 Obsession deploy it, 4 are refused, 5 Greed are refused", () => {
  const p = printing(SR);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["ritualist"], 5, "o", 4, 1, 2]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sr", def: printing(SR), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(6, 0);
  play(ok.engine, P1, ok.id("sr"));
  assert.equal(zoneOf(ok.engine, ok.id("sr")), "play");
  assert.equal(ready(ok.engine, P1), 1, "exactly 5 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("sr"), "strength"), ok.engine.getStat(ok.id("sr"), "speed"), ok.engine.getStat(ok.id("sr"), "life")], [4, 1, 2]);
  const short = mk(4, 0);
  refused(() => play(short.engine, P1, short.id("sr")), "4 for cost 5", ANY);
  assert.equal(zoneOf(short.engine, short.id("sr")), "hand");
  const noIcon = mk(0, 5);
  refused(() => play(noIcon.engine, P1, noIcon.id("sr")), "no [O]", ANY);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sr")), "hand");
  const oneO = mk(1, 4);
  play(oneO.engine, P1, oneO.id("sr"));
  assert.equal(zoneOf(oneO.engine, oneO.id("sr")), "play", "control: a single [O] meets the threshold");
});

clause(SR, "0:ability:violate", "first use (0 tokens): X is 0 so nothing is paid and nobody discards; it depletes and gets a token (other cards' tokens are not counted)", () => {
  const b = srBoard({ res: 2, extra: [{ key: "other", def: noTextChar("Other"), owner: P1, zone: "play", counters: { token: 5 } }] });
  violate(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt for X = 0");
  assert.equal(b.engine.state.cards[b.id("sr")].depleted, true, "COST: deplete this card");
  assert.equal(tokensOn(b.engine, b.id("sr")), 1, "EFFECT: a token is put on this card");
  assert.equal(tokensOn(b.engine, b.id("other")), 5, "another card's tokens untouched");
  assert.equal(ready(b.engine, P1), 2, "Pay 0");
  assert.equal(handOf(b.engine, P2).length, 3, "opponent discards nothing");
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(SR, "0:ability:violate", "with 1 token X is 1: pay exactly 1, the OPPONENT chooses and discards exactly 1 card from their hand, and a second token is added", () => {
  const b = srBoard({ tokens: 1, res: 3 });
  violate(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the discarding player chooses");
  assert.equal(ready(b.engine, P1), 2, "Pay X = 1");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh1")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh1")]);
  assert.deepEqual(handOf(b.engine, P2).sort(), [b.id("oh0"), b.id("oh2")].sort());
  assert.equal(handOf(b.engine, P1).length, 2, "my hand is untouched");
  assert.equal(tokensOn(b.engine, b.id("sr")), 2);
  assert.equal(b.engine.state.cards[b.id("sr")].depleted, true);
});

clause(SR, "0:ability:violate", "with 2 tokens X is 2: pay exactly 2, the opponent discards exactly the 2 cards they chose, token becomes 3", () => {
  const b = srBoard({ tokens: 2, res: 3, oppHand: 4 });
  violate(b);
  assert.equal(pending(b.engine)?.playerId, P2);
  assert.equal(ready(b.engine, P1), 1, "Pay X = 2");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh3")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P2).sort(), [b.id("oh0"), b.id("oh3")].sort());
  assert.deepEqual(handOf(b.engine, P2).sort(), [b.id("oh1"), b.id("oh2")].sort());
  assert.equal(tokensOn(b.engine, b.id("sr")), 3);
});

clause(SR, "0:ability:violate", "the opponent must discard X cards: choosing fewer than X is refused", () => {
  const b = srBoard({ tokens: 2, res: 3, oppHand: 4 });
  violate(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0")] }), "1 of 2", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for the full discard");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "0 of 2", ANY);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(SR, "0:ability:violate", "the discards come only from the opponent's hand: my hand cards, their in-play card, and too many cards are refused", () => {
  const b = srBoard({ tokens: 1, res: 3 });
  violate(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh0")] }), "my hand card", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oppPlay")] }), "card in play", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1")] }), "two for X = 1", ANY);
  assert.equal(discardOf(b.engine, P2).length, 0);
  assert.equal(handOf(b.engine, P1).length, 2);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh2")] });
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh2")], "control");
});

clause(SR, "0:ability:violate", "when X exceeds the opponent's hand they discard all of it; an empty hand discards nothing; both still pay X and gain the token", () => {
  const b = srBoard({ tokens: 3, res: 3, oppHand: 2 });
  violate(b);
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P2).length, 0, "whole hand discarded");
  assert.equal(discardOf(b.engine, P2).length, 2);
  assert.equal(ready(b.engine, P1), 0, "Pay X = 3");
  assert.equal(tokensOn(b.engine, b.id("sr")), 4);
  const e = srBoard({ tokens: 1, res: 1, oppHand: 0 });
  violate(e);
  assert.equal(e.engine.state.pendingChoice, undefined, "no soft-lock on an empty hand");
  assert.equal(tokensOn(e.engine, e.id("sr")), 2);
  assert.equal(ready(e.engine, P1), 0);
});

clause(SR, "0:ability:violate", "Pay X is a real cost: one resource short of X is refused (nothing changes); exactly X works", () => {
  const b = srBoard({ tokens: 2, res: 1 });
  refused(() => violate(b), "X = 2 with 1 resource", ANY);
  assert.equal(b.engine.state.cards[b.id("sr")].depleted, false, "not depleted");
  assert.equal(tokensOn(b.engine, b.id("sr")), 2, "no token added");
  assert.equal(ready(b.engine, P1), 1);
  assert.equal(handOf(b.engine, P2).length, 3);
  const ok = srBoard({ tokens: 2, res: 2 });
  violate(ok);
  assert.equal(pending(ok.engine)?.playerId, P2, "control: with exactly X it goes ahead");
});

clause(SR, "0:ability:violate", "VIOLATE cannot be used while this card is depleted, and only by its controller", () => {
  const b = srBoard({ tokens: 1, res: 3 });
  b.engine.state.cards[b.id("sr")].depleted = true;
  refused(() => violate(b), "depleted", ANY);
  assert.equal(tokensOn(b.engine, b.id("sr")), 1);
  assert.equal(ready(b.engine, P1), 3);
  const c = srBoard({ tokens: 1, res: 3 });
  refused(() => violate(c, P2), "opponent cannot use it", ANY);
  assert.equal(tokensOn(c.engine, c.id("sr")), 1);
  violate(c);
  assert.equal(pending(c.engine)?.kind, "chooserSelectsTarget", "control");
});

clause(SR, "0:ability:violate", "each use raises X: 0, then 1, then 2 cards (restoring in between), tokens 1, 2, 3", () => {
  const b = srBoard({ tokens: 0, res: 3, oppHand: 5 });
  const restore = () => { b.engine.state.cards[b.id("sr")].depleted = false; };
  violate(b);
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] }); // X = 0 (see ungodly-mess-02-p1-2)
  assert.equal(tokensOn(b.engine, b.id("sr")), 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  restore();
  violate(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0")] });
  assert.equal(tokensOn(b.engine, b.id("sr")), 2);
  restore();
  violate(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh1"), b.id("oh2")] });
  assert.equal(tokensOn(b.engine, b.id("sr")), 3);
  assert.equal(discardOf(b.engine, P2).length, 3);
  assert.equal(ready(b.engine, P1), 0, "paid 0 + 1 + 2");
});

// --- BLUR ----------------------------------------------------------------
const blur = (b: ReturnType<typeof srBoard>, player: string = P1) => activate(b.engine, player as never, b.id("sr"), "blur");

clause(SR, "1:ability:blur", "with [O][O][O] and a token: removes exactly one token, pays no resources, and the card gains COVERT", () => {
  const b = srBoard({ tokens: 2, obs: 3 });
  assert.equal(b.engine.getKeywords(b.id("sr")).includes("covert"), false);
  blur(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("sr")), 1, "COST: remove a token");
  assert.equal(ready(b.engine, P1), 3, "the threshold is not a cost");
  assert.ok(b.engine.getKeywords(b.id("sr")).includes("covert"), "b.engine.getKeywords(b.id(\"sr\")).includes(\"covert\")");
  assert.equal(b.engine.state.cards[b.id("sr")].depleted, false, "BLUR does not deplete");
});

clause(SR, "1:ability:blur", "BLUR is refused with no token on the card (other cards' tokens do not count); with one token it works", () => {
  const b = srBoard({ tokens: 0, obs: 3, extra: [{ key: "other", def: noTextChar("Other"), owner: P1, zone: "play", counters: { token: 4 } }] });
  refused(() => blur(b), "no token", ANY);
  assert.equal(b.engine.getKeywords(b.id("sr")).includes("covert"), false);
  assert.equal(tokensOn(b.engine, b.id("other")), 4, "the other card's tokens were not removed");
  const ok = srBoard({ tokens: 1, obs: 3 });
  blur(ok);
  assert.equal(tokensOn(ok.engine, ok.id("sr")), 0);
});

clause(SR, "1:ability:blur", "BLUR needs [O][O][O]: two Obsession (or three Greed) are refused with the token kept; three work", () => {
  const two = srBoard({ tokens: 1, obs: 2 });
  refused(() => blur(two), "[O][O] only", ANY);
  assert.equal(tokensOn(two.engine, two.id("sr")), 1);
  assert.equal(two.engine.getKeywords(two.id("sr")).includes("covert"), false);
  const greed = srBoard({ tokens: 1, obs: 0, greed: 3 });
  refused(() => blur(greed), "no [O]", ANY);
  assert.equal(tokensOn(greed.engine, greed.id("sr")), 1);
  const mixed = srBoard({ tokens: 1, obs: 2, greed: 3 });
  refused(() => blur(mixed), "[O][O] + Greed", ANY);
  const ok = srBoard({ tokens: 1, obs: 3 });
  blur(ok);
  assert.ok(ok.engine.getKeywords(ok.id("sr")).includes("covert"), "ok.engine.getKeywords(ok.id(\"sr\")).includes(\"covert\")");
});

clause(SR, "1:ability:blur", "the COVERT lasts this turn only and applies to this card alone", () => {
  const b = srBoard({ tokens: 1, obs: 3, extra: [{ key: "ally", def: noTextChar("Ally"), owner: P1, zone: "play" }] });
  blur(b);
  assert.ok(b.engine.getKeywords(b.id("sr")).includes("covert"), "b.engine.getKeywords(b.id(\"sr\")).includes(\"covert\")");
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false, "an ally does not gain it");
  assert.equal(b.engine.getKeywords(b.id("oppPlay")).includes("covert"), false);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getKeywords(b.id("sr")).includes("covert"), false, "gone after this turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getKeywords(b.id("sr")).includes("covert"), false, "and stays gone");
});

clause(SR, "1:ability:blur", "the granted COVERT really works: a plain blocker cannot block, a covert one can", () => {
  const b = srBoard({
    tokens: 1, obs: 3, turn: 2, active: P1,
    extra: [{ key: "plainB", def: noTextChar("PlainB"), owner: P2, zone: "play" },
            { key: "covB", def: character({ name: "CovB", text: "no icons", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]
  });
  blur(b);
  declareAttackBy(b.engine, P1, [b.id("sr")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainB")] }), "non-covert blocker", ANY);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covB")] });
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("covB")]);
});

clause(SR, "1:ability:blur", "BLUR can be used by its controller only", () => {
  const b = srBoard({ tokens: 1, obs: 3 });
  refused(() => blur(b, P2), "opponent", ANY);
  assert.equal(tokensOn(b.engine, b.id("sr")), 1);
});

// ============================================================================
// Thabbashite Desert Creature
// COVERT -- While this card is in your hand, you may reveal this card when a card that provides [V] enters play under
// your control. If you do, you may pay 2 to deploy this card.
// Character, arcanist, monstrosity, cost 5, [O], 3 str / 3 spd / 2 life.
// ============================================================================
const TDC = "e9f59763-c924-4f5a-83b7-b53c1d541d4f";

clause(TDC, "0:kw:COVERT", "has the COVERT keyword and is an Arcanist monstrosity: cost 5, [O], 3 str / 3 spd / 2 life (5 Obsession deploy, 4 refused, 5 Greed refused)", () => {
  const p = printing(TDC);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["monstrosity"], 5, "o", 3, 3, 2]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(TDC), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(5, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(zoneOf(ok.engine, ok.id("t")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "speed"), ok.engine.getStat(ok.id("t"), "life")], [3, 3, 2]);
  assert.ok(ok.engine.getKeywords(ok.id("t")).includes("covert"), "ok.engine.getKeywords(ok.id(\"t\")).includes(\"covert\")");
  const short = mk(4, 0);
  refused(() => play(short.engine, P1, short.id("t")), "4 for cost 5", ANY);
  const noIcon = mk(0, 5);
  refused(() => play(noIcon.engine, P1, noIcon.id("t")), "no [O]", ANY);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("t")), "hand");
});
clause(TDC, "0:kw:COVERT", "COVERT: has the keyword (an ordinary character does not)", () => covertHasKeyword(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: cannot be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: as a blocker it blocks only covert parties", () => covertBlocksOnlyCovertParties(TDC));

const PROVIDER = () => character({ name: "VProvider", cost: 1, text: "PROVIDES [V]", resource: { provides: ["volition"], staple: false } } as never);

function tdcBoard(o: { obs?: number; greed?: number; spentO?: number; tdcZone?: "hand" | "discard" | "deck" | "play"; active?: typeof P1 | typeof P2; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active,
    turn: o.active === P2 ? 2 : undefined,
    cards: [
      { key: "tdc", def: printing(TDC), owner: P1, zone: o.tdcZone ?? "hand" },
      { key: "prov", def: PROVIDER(), owner: P1, zone: "hand" },
      { key: "resO", def: resourceCard({ name: "ResO", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resV", def: resourceCard({ name: "ResV", resource: { provides: ["volition"], staple: false } }), owner: P1, zone: "hand" },
      { key: "fd", def: noTextChar("Fd"), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Chr", cost: 1, text: "no icons" }), owner: P1, zone: "hand" },
      { key: "oprov", def: PROVIDER(), owner: P2, zone: "hand" },
      ...bank("obsession", o.obs ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("obsession", o.spentO ?? 0, P1).map((x) => ({ ...x, attachedToKey: "__factionA" })),
      ...bank("greed", 3, P2),
      ...fillers("dk", 3, P1, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
const tdcOffered = (b: ReturnType<typeof tdcBoard>) => {
  const pc = pending(b.engine);
  return pc?.kind === "mayPay" && pc.playerId === P1;
};
/** Accept the offered pay-2 deploy, swallowing a refusal/crash so the caller can assert the resulting board. */
const tdcAcceptStrict = (b: ReturnType<typeof tdcBoard>) => {
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  if (pending(b.engine)?.kind === "deployForFree") resolveChoice(b.engine, { kind: "deployForFree", cardId: b.id("tdc") });
  resolvePendingResponses(b.engine);
};
const tdcAccept = (b: ReturnType<typeof tdcBoard>) => {
  try { tdcAcceptStrict(b); } catch { /* inspected via the board */ }
};

clause(TDC, "1:rule", "a card that provides [V] being deployed under my control while this is in my hand offers me a 'may pay' choice", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  assert.equal(zoneOf(b.engine, b.id("prov")), "play");
  assert.ok(tdcOffered(b), "a mayPay for me");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand", "still in hand until I decide");
});

clause(TDC, "1:rule", "declining the offer leaves it in hand and nothing is paid", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  const r1 = ready(b.engine, P1);
  assert.ok(tdcOffered(b), "tdcOffered(b)");
  resolveChoice(b.engine, { kind: "mayPay", pay: false });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
  assert.equal(ready(b.engine, P1), r1, "nothing paid");
});

clause(TDC, "1:rule", "accepting: it is revealed, I pay exactly 2 (not the printed 5) and it is deployed", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  const r1 = ready(b.engine, P1);
  assert.ok(tdcOffered(b), "tdcOffered(b)");
  tdcAcceptStrict(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tdc")), "play", "deployed");
  assert.equal(ready(b.engine, P1), r1 - 2, "paid exactly 2");
  assert.ok(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length >= 1, "the card was revealed");
});

clause(TDC, "1:rule", "'pay 2' is a real cost: with fewer than 2 ready resources the deploy cannot happen, with 2 it can", () => {
  const short = tdcBoard({ obs: 2 });
  play(short.engine, P1, short.id("prov"));
  assert.equal(ready(short.engine, P1), 1);
  if (pending(short.engine)?.kind === "mayPay") tdcAccept(short);
  assert.equal(zoneOf(short.engine, short.id("tdc")), "hand", "could not pay 2 with 1 ready resource");
  assert.equal(ready(short.engine, P1), 1, "nothing was paid");
  const ok = tdcBoard({ obs: 3 });
  play(ok.engine, P1, ok.id("prov"));
  assert.equal(ready(ok.engine, P1), 2);
  tdcAcceptStrict(ok);
  assert.equal(zoneOf(ok.engine, ok.id("tdc")), "play", "control: exactly 2 is enough");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(TDC, "1:rule", "deploying this way still needs the printed threshold [O] (only the numeric cost is replaced by 2)", () => {
  const noO = tdcBoard({ obs: 0, greed: 4 });
  play(noO.engine, P1, noO.id("prov"));
  if (pending(noO.engine)?.kind === "mayPay") tdcAccept(noO);
  assert.equal(zoneOf(noO.engine, noO.id("tdc")), "hand", "no [O] icon: it cannot be deployed");
  const ok = tdcBoard({ obs: 0, greed: 4, spentO: 1 });
  play(ok.engine, P1, ok.id("prov"));
  if (pending(ok.engine)?.kind === "mayPay") tdcAccept(ok);
  assert.equal(zoneOf(ok.engine, ok.id("tdc")), "play", "control: with an [O] icon it is deployed");
});

clause(TDC, "1:rule", "a face-down card developed as a resource (it provides [V]) entering play under my control offers the pay-2 deploy", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("fd"), true);
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
  assert.equal(b.engine.getThresholds(P1).volition, 1, "it provides [V]");
  assert.ok(tdcOffered(b), "a mayPay for me");
});

clause(TDC, "1:rule", "a face-up resource that provides [V], developed into play, also offers the pay-2 deploy", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("resV"), false);
  assert.equal(b.engine.state.cards[b.id("resV")].faceDown, false);
  assert.equal(b.engine.getThresholds(P1).volition, 1, "it provides [V]");
  assert.ok(tdcOffered(b), "a mayPay for me");
});

clause(TDC, "1:rule", "a card that does NOT provide [V] entering play (a face-up Obsession staple, a deployed character) does not trigger it", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("resO"), false);
  assert.equal((b.engine.getThresholds(P1).obsession ?? 0) >= 1, true, "it provides [O], not [V]");
  assert.equal(b.engine.state.pendingChoice, undefined, "face-up staple: no [V]");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
  const c = tdcBoard();
  play(c.engine, P1, c.id("chr"));
  assert.equal(zoneOf(c.engine, c.id("chr")), "play");
  assert.equal(c.engine.state.pendingChoice, undefined, "a character provides no [V]");
  assert.equal(zoneOf(c.engine, c.id("tdc")), "hand");
});

clause(TDC, "1:rule", "only cards entering play under MY control: the opponent deploying a [V] provider does not offer it to me", () => {
  const b = tdcBoard({ active: P2 });
  play(b.engine, P2, b.id("oprov"));
  assert.equal(zoneOf(b.engine, b.id("oprov")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
});

clause(TDC, "1:rule", "it only works while in my hand: in the discard pile, deck or already in play it is not offered", () => {
  for (const zone of ["discard", "deck", "play"] as const) {
    const b = tdcBoard({ tdcZone: zone });
    play(b.engine, P1, b.id("prov"));
    assert.equal(zoneOf(b.engine, b.id("prov")), "play", zone);
    assert.equal(b.engine.state.pendingChoice, undefined, zone);
    assert.equal(zoneOf(b.engine, b.id("tdc")), zone, zone);
  }
});

// ============================================================================
// Thabbashite Penumbra
// OBFUSCATE -- COST: Pick an opponent. X is the number of different types of staple resources that player controls. Pay 6-X.
// EFFECT: This turn, this card gains 1 life and COVERT.
// Character, arcanist, sorceress, cost 3, [O], 2 str / 3 spd / 2 life.
// ============================================================================
const PEN = "8817125b-0cc8-43ba-a08e-c6711a79ecaa";
const ICONS = ["rage", "greed", "deception", "elitism", "obsession"] as const;

function penBoard(o: { mine?: number; oppTypes?: number; extra?: Cards; turn?: number; active?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "pen", def: printing(PEN), owner: P1, zone: "play" },
      { key: "ally", def: noTextChar("Ally"), owner: P1, zone: "play" },
      ...bank("obsession", o.mine ?? 6, P1),
      ...ICONS.slice(0, o.oppTypes ?? 0).flatMap((i) => bank(i, 1, P2)),
      ...(o.extra ?? [])
    ]
  });
}
const veil = (b: ReturnType<typeof penBoard>) => activate(b.engine, P1, b.id("pen"), "veil");

clause(PEN, "0:ability:veil", "the card is an Arcanist sorceress, cost 3, [O], 2 str / 3 spd / 2 life: 3 Obsession deploy it, 2 are refused, 3 Greed are refused", () => {
  const p = printing(PEN);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["sorceress"], 3, "o", 2, 3, 2]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(PEN), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(4, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(ready(ok.engine, P1), 1, "exactly 3 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "speed"), ok.engine.getStat(ok.id("t"), "life")], [2, 3, 2]);
  const short = mk(2, 0);
  refused(() => play(short.engine, P1, short.id("t")), "2 for cost 3", ANY);
  const noIcon = mk(0, 3);
  refused(() => play(noIcon.engine, P1, noIcon.id("t")), "no [O]", ANY);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("t")), "hand");
});

clause(PEN, "0:ability:veil", "Pay 6-X: with X = 0..5 different opponent staple types the cost is 6, 5, 4, 3, 2, 1 exactly, and one less is refused", () => {
  for (let x = 0; x <= 5; x++) {
    const need = 6 - x;
    const ok = penBoard({ mine: need + 1, oppTypes: x });
    veil(ok);
    assert.equal(ready(ok.engine, P1), 1, `X=${x}: paid exactly ${need}`);
    assert.equal(ok.engine.getStat(ok.id("pen"), "life"), 3, `X=${x}: effect applied`);
    if (need >= 1) {
      const short = penBoard({ mine: need - 1, oppTypes: x });
      refused(() => veil(short), `X=${x}: ${need - 1} is one short`, ANY);
      assert.equal(short.engine.getStat(short.id("pen"), "life"), 2);
      assert.equal(ready(short.engine, P1), need - 1);
    }
  }
});

clause(PEN, "0:ability:veil", "'different types': several staples of the same type count once (3 Rage staples = 1 type, so it costs 5)", () => {
  const b = penBoard({ mine: 6, extra: bank("rage", 3, P2) });
  veil(b);
  assert.equal(ready(b.engine, P1), 1, "paid 6 - 1 = 5");
  const s = penBoard({ mine: 4, extra: bank("rage", 3, P2) });
  refused(() => veil(s), "4 < 5", ANY);
  const two = penBoard({ mine: 6, extra: [...bank("rage", 2, P2), ...bank("greed", 3, P2)] });
  veil(two);
  assert.equal(ready(two.engine, P1), 2, "two types: paid 4");
});

clause(PEN, "0:ability:veil", "only STAPLE resources count: a non-staple resource does not reduce the cost", () => {
  const fancy = resourceCard({ name: "Fancy", resource: { provides: ["rage"], staple: false } });
  const b = penBoard({ mine: 6, extra: [{ key: "fancy", def: fancy, owner: P2, zone: "play" }] });
  veil(b);
  assert.equal(ready(b.engine, P1), 0, "still pays 6");
  const s = penBoard({ mine: 5, extra: [{ key: "fancy", def: fancy, owner: P2, zone: "play" }] });
  refused(() => veil(s), "5 is short when only a non-staple is around", ANY);
  assert.equal(s.engine.getStat(s.id("pen"), "life"), 2);
  const fd = penBoard({ mine: 6, extra: [{ key: "fdc", def: character({ name: "FdC", text: "x" }), owner: P2, zone: "play", faceDown: true }] });
  veil(fd);
  assert.equal(ready(fd.engine, P1), 0, "a face-down non-staple card is not a staple either");
});

clause(PEN, "0:ability:veil", "a face-down card is a Volition resource, not a staple: face-down cards (even staple cards played face-down) do not reduce the cost", () => {
  const b = penBoard({ mine: 6, extra: volition(2, P2) });
  veil(b);
  assert.equal(ready(b.engine, P1), 0, "still pays 6");
  const s = penBoard({ mine: 5, extra: volition(2, P2) });
  refused(() => veil(s), "5 is short when the opponent only has face-down cards", ANY);
});

clause(PEN, "0:ability:veil", "only the OPPONENT's staples count: my own staples of many types do not reduce my cost", () => {
  const b = penBoard({ mine: 0, extra: [...ICONS.flatMap((i) => bank(i, 1, P1))] });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => veil(b), "5 own resources, none of the opponent's", ANY);
  const ok = penBoard({ mine: 0, extra: [...ICONS.flatMap((i) => bank(i, 1, P1)), ...bank("rage", 1, P2), ...bank("greed", 1, P2)] });
  veil(ok);
  assert.equal(ready(ok.engine, P1), 1, "6 - 2 = 4 paid out of 5");
});

clause(PEN, "0:ability:veil", "'controls', not owns: a staple the opponent owns but I control does not count; one I own but the opponent controls does; depleted ones still count", () => {
  const theirsMine = bank("rage", 1, P2).map((x) => ({ ...x, controller: P1 }));
  const b = penBoard({ mine: 5, extra: theirsMine });
  assert.equal(ready(b.engine, P1), 6, "five of mine plus the one I control");
  veil(b);
  assert.equal(ready(b.engine, P1), 0, "an opponent-owned staple that I control does not count: pays 6");
  const mineTheirs = bank("rage", 1, P1).map((x) => ({ ...x, controller: P2 }));
  const c = penBoard({ mine: 5, extra: mineTheirs });
  assert.equal(ready(c.engine, P1), 5);
  veil(c);
  assert.equal(ready(c.engine, P1), 0, "I own it but the opponent controls it: counts, pays 5");
  const dep = penBoard({ mine: 5, extra: bank("greed", 1, P2).map((x) => ({ ...x, attachedToKey: "__factionB" })) });
  veil(dep);
  assert.equal(ready(dep.engine, P1), 0, "a spent staple still counts: pays 5");
});

clause(PEN, "0:ability:veil", "EFFECT: gains exactly 1 life (strength and speed unchanged) and COVERT this turn; both end at end of turn", () => {
  const b = penBoard({ mine: 6 });
  assert.equal(b.engine.getKeywords(b.id("pen")).includes("covert"), false);
  veil(b);
  assert.equal(b.engine.getStat(b.id("pen"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("pen"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("pen"), "speed"), 3);
  assert.ok(b.engine.getKeywords(b.id("pen")).includes("covert"), "b.engine.getKeywords(b.id(\"pen\")).includes(\"covert\")");
});

clause(PEN, "0:ability:veil", "the bonus is for this card only and ends with the turn", () => {
  const b = penBoard({ mine: 6 });
  const allyLife = b.engine.getStat(b.id("ally"), "life");
  veil(b);
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false, "ally gets no COVERT");
  assert.equal(b.engine.getStat(b.id("ally"), "life"), allyLife, "ally gets no life");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("pen"), "life"), 2, "life bonus gone");
  assert.equal(b.engine.getKeywords(b.id("pen")).includes("covert"), false, "COVERT gone");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("pen"), "life"), 2);
  assert.equal(b.engine.getKeywords(b.id("pen")).includes("covert"), false);
});

clause(PEN, "0:ability:veil", "using it twice pays twice and gives +2 life", () => {
  const b = penBoard({ mine: 12 });
  veil(b);
  veil(b);
  assert.equal(ready(b.engine, P1), 0);
  assert.equal(b.engine.getStat(b.id("pen"), "life"), 4);
});

clause(PEN, "0:ability:veil", "the granted COVERT works in battle: a plain blocker cannot block, a covert one can", () => {
  const b = penBoard({
    mine: 6, turn: 2, active: P1,
    extra: [{ key: "plainB", def: noTextChar("PlainB"), owner: P2, zone: "play" },
            { key: "covB", def: character({ name: "CovB", text: "no icons", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]
  });
  veil(b);
  declareAttackBy(b.engine, P1, [b.id("pen")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainB")] }), "non-covert blocker", ANY);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covB")] });
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("covB")]);
});

// ============================================================================
// Thabbashite Priest of Zig
// [O][O][V][V]: This card gains COVERT. When this card is destroyed, you may pick a non-resource card. If you do,
// put that card into its owner's hand. -- FLIP UP: 3 [V][V][V][V]
// Character, arcanist, priest, cost 4, [O], 3 str / 1 spd / 3 life.
// ============================================================================
const POZ = "a68f9301-53c7-4b67-ac5b-dc61c6f689ed";

function pozBoard(o: { obs?: number; vol?: number; greed?: number; extra?: Cards; turn?: number; active?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "poz", def: printing(POZ), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("obsession", o.obs ?? 2, P1),
      ...volition(o.vol ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      { key: "foe", def: noTextChar("Foe"), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const killPoz = (b: ReturnType<typeof pozBoard>, target = "poz") => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(target)] } });

clause(POZ, "0:rule@oovv", "the card is an Arcanist priest, cost 4, [O], 3 str / 1 spd / 3 life: 4 Obsession deploy it, 3 refused, 4 Greed refused", () => {
  const p = printing(POZ);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["priest"], 4, "o", 3, 1, 3]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(POZ), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(5, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(ready(ok.engine, P1), 1, "exactly 4 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "speed"), ok.engine.getStat(ok.id("t"), "life")], [3, 1, 3]);
  assert.equal(ok.engine.getKeywords(ok.id("t")).includes("covert"), false, "no COVERT without [O][O][V][V]");
  const short = mk(3, 0);
  refused(() => play(short.engine, P1, short.id("t")), "3 for cost 4", ANY);
  const noIcon = mk(0, 4);
  refused(() => play(noIcon.engine, P1, noIcon.id("t")), "no [O]", ANY);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("t")), "hand");
});

clause(POZ, "0:rule@oovv", "with [O][O][V][V] it has COVERT; without it (one [V], one [O], or Greed instead) it does not", () => {
  const on = pozBoard({ obs: 2, vol: 2 });
  assert.ok(on.engine.getKeywords(on.id("poz")).includes("covert"), "on.engine.getKeywords(on.id(\"poz\")).includes(\"covert\")");
  const cases: Array<[string, number, number, number]> = [
    ["one [V]", 2, 1, 0], ["one [O]", 1, 2, 0], ["no [V]", 2, 0, 2], ["no [O]", 0, 2, 2], ["nothing", 0, 0, 0]
  ];
  for (const [why, obs, vol, greed] of cases) {
    const b = pozBoard({ obs, vol, greed });
    assert.equal(b.engine.getKeywords(b.id("poz")).includes("covert"), false, why);
  }
  const more = pozBoard({ obs: 3, vol: 3 });
  assert.ok(more.engine.getKeywords(more.id("poz")).includes("covert"), "more than needed still works");
});

clause(POZ, "0:rule@oovv", "COVERT is only for this card and works in battle only with the threshold", () => {
  const b = pozBoard({ turn: 2, active: P1, extra: [
    { key: "ally", def: noTextChar("Ally"), owner: P1, zone: "play" },
    { key: "plainB", def: noTextChar("PlainB"), owner: P2, zone: "play" }
  ] });
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false);
  declareAttackBy(b.engine, P1, [b.id("poz")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainB")] }), "covert party", ANY);
  const c = pozBoard({ vol: 1, turn: 2, active: P1, extra: [{ key: "plainB", def: noTextChar("PlainB"), owner: P2, zone: "play" }] });
  declareAttackBy(c.engine, P1, [c.id("poz")]);
  c.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [c.id("plainB")] });
  assert.deepEqual(c.engine.state.battle?.blockingParty, [c.id("plainB")], "control: without the threshold anyone may block");
});

clause(POZ, "0:rule@oovv", "the COVERT is gone again once the card has left play", () => {
  const b = pozBoard();
  killPoz(b);
  drain(b.engine, pickIds([]));
  assert.equal(zoneOf(b.engine, b.id("poz")), "discard");
  assert.equal(b.engine.getKeywords(b.id("poz")).includes("covert"), false);
});

clause(POZ, "0:rule@oovv", "when destroyed (with [O][O][V][V]) I am asked to pick a non-resource card and it goes to its owner's hand", () => {
  const b = pozBoard();
  killPoz(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  assert.equal(zoneOf(b.engine, b.id("poz")), "discard");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("foe")), true, "its owner's hand");
});

clause(POZ, "0:rule@oovv", "'may': picking nothing leaves everything where it is", () => {
  const b = pozBoard();
  killPoz(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("poz")), "discard");
});

clause(POZ, "0:rule@oovv", "pickable: my own character in play, an item, a location; controller != owner returns to the OWNER's hand; cards in a discard pile or hand are not in play so are refused", () => {
  const cases: Array<[string, Cards[number]]> = [
    ["my character", { key: "t", def: noTextChar("T"), owner: P1, zone: "play" }],
    ["opponent item", { key: "t", def: item({ name: "I", text: "no icons" }), owner: P2, zone: "play" }],
    ["opponent location", { key: "t", def: location({ name: "L", text: "no icons" }), owner: P2, zone: "play" }],
    ["stolen character", { key: "t", def: noTextChar("T"), owner: P2, zone: "play", controller: P1 }]
  ];
  for (const [why, placement] of cases) {
    const b = pozBoard({ extra: [placement] });
    killPoz(b);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t")] });
    assert.equal(zoneOf(b.engine, b.id("t")), "hand", why);
    assert.equal(handOf(b.engine, placement.owner).includes(b.id("t")), true, `${why}: owner's hand`);
  }
  for (const zone of ["discard", "hand"] as const) {
    const b = pozBoard({ extra: [{ key: "t", def: noTextChar("T"), owner: P2, zone }] });
    killPoz(b);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t")] }), `card in ${zone}`, ANY);
    assert.equal(zoneOf(b.engine, b.id("t")), zone);
  }
});

clause(POZ, "0:rule@oovv", "the destroyed Priest itself is already in the discard pile, so it cannot be picked (pick means a card in play)", () => {
  const b = pozBoard();
  killPoz(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("poz")] }), "the Priest in the discard pile", ANY);
  assert.equal(zoneOf(b.engine, b.id("poz")), "discard");
});

clause(POZ, "0:rule@oovv", "resources and factions cannot be picked; two cards cannot be picked (control: one character works)", () => {
  const oppRes = bank("greed", 1, P2);
  const down = volition(1, P2);
  const b = pozBoard({ extra: [...oppRes, ...down, { key: "mine", def: noTextChar("Mine"), owner: P1, zone: "play" }] });
  killPoz(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(oppRes[0].key)] }), "face-up staple", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(down[0].key)] }), "face-down card", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, P2)] }), "faction", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe"), b.id("mine")] }), "two cards", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(POZ, "0:rule@oovv", "no trigger when destroyed without [O][O][V][V] (one [V] short), nor when another character is destroyed", () => {
  const b = pozBoard({ vol: 1 });
  killPoz(b);
  assert.equal(zoneOf(b.engine, b.id("poz")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "threshold not met at destruction");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const c = pozBoard();
  killPoz(c, "foe");
  assert.equal(zoneOf(c.engine, c.id("foe")), "discard");
  assert.equal(c.engine.state.pendingChoice, undefined, "another character's death does not trigger it");
});

clause(POZ, "0:rule@oovv", "'when this card is destroyed' only: with [O][O][V][V], leaving play by being returned to hand does not trigger it", () => {
  const b = pozBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("poz")] } });
  assert.equal(zoneOf(b.engine, b.id("poz")), "hand");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick offered");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

// --- FLIP UP: 3 [V][V][V][V] ----------------------------------------------------
function pozFlipBoard(o: { others?: number; depletedOthers?: number; obs?: number; turn?: number; active?: typeof P1 | typeof P2; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "poz", def: printing(POZ), owner: P1, zone: "play", faceDown: true },
      ...volition(o.others ?? 4, P1),
      ...volition(o.depletedOthers ?? 0, P1).map((x) => ({ ...x, attachedToKey: "__factionA" })),
      ...bank("obsession", o.obs ?? 0, P1),
      { key: "atk", def: noTextChar("Atk"), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const pozFlip = (b: ReturnType<typeof pozFlipBoard>, player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("poz"), selected: {}, variables: {} });

clause(POZ, "1:flipUp", "flipping up with 4 other face-down cards pays exactly 3 and the Priest ends face-up in play", () => {
  const b = pozFlipBoard({ others: 4, obs: 1 });
  const r0 = ready(b.engine, P1);
  assert.equal(r0, 6, "self + 4 face-down + 1 bank");
  pozFlip(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("poz")), "play");
  assert.equal(b.engine.state.cards[b.id("poz")].faceDown, false);
  assert.equal(ready(b.engine, P1), r0 - 1 - 3, "3 paid, and the card is no longer a resource");
});

clause(POZ, "1:flipUp", "FLIP UP cost is 3: with the card + 4 other [V] cards but only 2 of them ready it is refused; 3 ready works", () => {
  const short = pozFlipBoard({ others: 1, depletedOthers: 3 });
  assert.equal(ready(short.engine, P1), 2, "self + 1 other ready");
  refused(() => pozFlip(short), "2 ready for cost 3", ANY);
  assert.equal(short.engine.state.cards[short.id("poz")].faceDown, true);
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
  const ok = pozFlipBoard({ others: 2, depletedOthers: 2 });
  assert.equal(ready(ok.engine, P1), 3);
  pozFlip(ok);
  assert.equal(ok.engine.state.cards[ok.id("poz")].faceDown, false, "control: self + 2 others pays 3");
});

clause(POZ, "1:flipUp", "FLIP UP threshold is [V][V][V][V] met after flipping: 4 OTHER face-down cards work; only 3 others (the card's own Volition does not count) is refused", () => {
  const three = pozFlipBoard({ others: 3, obs: 2 });
  assert.equal(ready(three.engine, P1), 6);
  refused(() => pozFlip(three), "only 3 other [V]", ANY);
  assert.equal(three.engine.state.cards[three.id("poz")].faceDown, true);
  assert.equal(ready(three.engine, P1), 6, "nothing paid");
  const four = pozFlipBoard({ others: 4, obs: 2 });
  pozFlip(four);
  assert.equal(four.engine.state.cards[four.id("poz")].faceDown, false, "control: four others");
});

clause(POZ, "1:flipUp", "FLIP UP with only 2 other face-down cards (3 [V] icons even counting itself) is refused with nothing paid", () => {
  const b = pozFlipBoard({ others: 2, obs: 3 });
  assert.equal(ready(b.engine, P1), 6);
  refused(() => pozFlip(b), "3 [V] icons < 4", ANY);
  assert.equal(b.engine.state.cards[b.id("poz")].faceDown, true);
  assert.equal(ready(b.engine, P1), 6, "nothing paid");
});

clause(POZ, "1:flipUp", "FLIP UP needs [V] icons, not any resources: four Obsession staples are refused", () => {
  const b = pozFlipBoard({ others: 0, obs: 4 });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => pozFlip(b), "no [V]", ANY);
  assert.equal(b.engine.state.cards[b.id("poz")].faceDown, true);
  assert.equal(ready(b.engine, P1), 5);
});

clause(POZ, "1:flipUp", "a non-tactic FLIP UP (character) is refused inside an opponent's response window, but works on my own turn", () => {
  const b = pozFlipBoard({ others: 4, obs: 1, turn: 2, active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => pozFlip(b), "non-tactic in the opponent's response window", ANY);
  assert.equal(b.engine.state.cards[b.id("poz")].faceDown, true);
  assert.equal(ready(b.engine, P1), 6, "nothing paid");
  const own = pozFlipBoard({ others: 4, obs: 1 });
  pozFlip(own);
  assert.equal(own.engine.state.cards[own.id("poz")].faceDown, false, "control: on my own turn it works");
});

// ============================================================================
// Theological Opportunist
// This card loses strength and life equal to the number of cards in all hands.
// Character, arcanist, priest, cost 4, [O][O], 8 str / 3 spd / 8 life.
// ============================================================================
const TO = "fb3bed57-05e1-44b3-a8c4-2f03bc876476";

function toBoard(mine: number, theirs: number, o: { extra?: Cards; owner?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "to", def: printing(TO), owner: o.owner ?? P1, zone: "play" },
      ...fillers("mh", mine, P1, "hand"),
      ...fillers("th", theirs, P2, "hand"),
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("dd", 2, P2, "discard"),
      ...(o.extra ?? [])
    ]
  });
}
const stats = (b: ReturnType<typeof toBoard>) => [b.engine.getStat(b.id("to"), "strength"), b.engine.getStat(b.id("to"), "life")];

clause(TO, "0:rule", "the card is an Arcanist priest, cost 4, [O][O], 8 str / 3 spd / 8 life: 4 Obsession deploy it; 3, or one [O] + Greed, are refused", () => {
  const p = printing(TO);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["priest"], 4, "oo", 8, 3, 8]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(TO), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(5, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(zoneOf(ok.engine, ok.id("t")), "play");
  assert.equal(ready(ok.engine, P1), 1, "exactly 4 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "life"), ok.engine.getStat(ok.id("t"), "speed")], [8, 8, 3], "hands are empty: no loss");
  const short = mk(3, 0);
  refused(() => play(short.engine, P1, short.id("t")), "3 for cost 4", ANY);
  const oneO = mk(1, 3);
  refused(() => play(oneO.engine, P1, oneO.id("t")), "[O][O] needs two", ANY);
  assert.equal(zoneOf(oneO.engine, oneO.id("t")), "hand");
  const twoO = mk(2, 2);
  play(twoO.engine, P1, twoO.id("t"));
  assert.equal(zoneOf(twoO.engine, twoO.id("t")), "play", "control: two [O] + two Greed");
});

clause(TO, "0:rule", "with no cards in any hand it keeps its full 8 strength and 8 life", () => {
  const b = toBoard(0, 0);
  assert.deepEqual(stats(b), [8, 8]);
});

clause(TO, "0:rule", "it loses BOTH strength and life equal to the cards in ALL hands (mine and the opponent's together)", () => {
  assert.deepEqual(stats(toBoard(1, 0)), [7, 7]);
  assert.deepEqual(stats(toBoard(0, 1)), [7, 7]);
  assert.deepEqual(stats(toBoard(2, 3)), [3, 3]);
  assert.deepEqual(stats(toBoard(4, 0)), [4, 4]);
  const b = toBoard(2, 3);
  assert.equal(b.engine.getStat(b.id("to"), "speed"), 3, "speed is unaffected");
});

clause(TO, "0:rule", "only hands count: cards in decks, discards and in play do not", () => {
  const b = toBoard(1, 1, { extra: [...fillers("pl", 3, P1, "play"), ...fillers("pl2", 3, P2, "play")] });
  assert.deepEqual(stats(b), [6, 6], "2 hand cards only (decks and discards and play ignored)");
});

clause(TO, "0:rule", "the loss tracks the hands live: drawing a card lowers it by 1, discarding raises it", () => {
  const b = toBoard(2, 2);
  assert.deepEqual(stats(b), [4, 4]);
  developDraw(b.engine, P1);
  assert.deepEqual(stats(b), [3, 3], "one more card in hand");
});

clause(TO, "0:rule", "it counts the hands even when the opponent controls it (all hands, not 'your' hand)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "to", def: printing(TO), owner: P1, zone: "play", controller: P2 },
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("th", 1, P2, "hand")
    ]
  });
  assert.deepEqual([b.engine.getStat(b.id("to"), "strength"), b.engine.getStat(b.id("to"), "life")], [5, 5]);
});

clause(TO, "0:rule", "the penalty applies only while it is in play: in hand or the discard pile it reads its printed stats, and it affects no other character", () => {
  const b = toBoard(3, 0, { extra: [{ key: "other", def: noTextChar("Other", { strength: 2, life: 4 }), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("other"), "strength"), 2, "another character is unaffected");
  assert.equal(b.engine.getStat(b.id("other"), "life"), 4);
  const h = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "to", def: printing(TO), owner: P1, zone: "hand" }, ...fillers("mh", 3, P1, "hand")] });
  assert.deepEqual([h.engine.getStat(h.id("to"), "strength"), h.engine.getStat(h.id("to"), "life")], [8, 8], "in hand: printed stats");
});

clause(TO, "0:rule", "strength and life cannot drop below 0 (CR 410.4): with 10 cards in hands it has 0 strength and 0 life", () => {
  const b = toBoard(5, 5);
  assert.deepEqual(stats(b), [0, 0]);
});

clause(TO, "0:rule", "when the hands total 8 its life is 0 and it dies", () => {
  const b = toBoard(7, 0);
  assert.deepEqual(stats(b), [1, 1]);
  developDraw(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("to")), "discard", "0 life: destroyed");
});

// ============================================================================
// Twisted Marionette
// When this card inflicts battle damage to a faction, you may pay 1. If you do, that faction's controller puts a
// character they control into its owner's hand.
// Character, arcanist, doll, cost 4, [O][O], 3 str / 3 spd / 2 life.
// ============================================================================
const TM = "f78f043a-1c35-49ae-939f-3e0efabdd810";

function tmBoard(o: { res?: number; extra?: Cards; foes?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "tm", def: printing(TM), owner: P1, zone: "play" },
      { key: "mine", def: noTextChar("Mine"), owner: P1, zone: "play" },
      ...bank("obsession", o.res ?? 3, P1),
      ...Array.from({ length: o.foes ?? 2 }, (_, i) => ({ key: `c${i + 1}`, def: noTextChar(`C${i + 1}`), owner: P2, zone: "play" as const })),
      ...(o.extra ?? [])
    ]
  });
}
/** TM attacks the faction unblocked; every mayPay is answered with `pay`, and a P2 pick with `pickIds`. */
function tmHit(b: ReturnType<typeof tmBoard>, pay: boolean, picks: string[], attackers: string[] = ["tm"]) {
  declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)));
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  const seen: string[] = [];
  finishBattle(b.engine, undefined, (pc) => {
    seen.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "mayPay") return { kind: "mayPay", pay };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: picks.map((k) => b.id(k)) };
    return declineAll(pc);
  });
  return seen;
}

clause(TM, "0:rule", "the card is an Arcanist doll, cost 4, [O][O], 3 str / 3 spd / 2 life: 4 Obsession deploy it; 3, or one [O] + Greed, are refused", () => {
  const p = printing(TM);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["doll"], 4, "oo", 3, 3, 2]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(TM), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(5, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(ready(ok.engine, P1), 1, "exactly 4 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "speed"), ok.engine.getStat(ok.id("t"), "life")], [3, 3, 2]);
  const short = mk(3, 0);
  refused(() => play(short.engine, P1, short.id("t")), "3 for cost 4", ANY);
  const oneO = mk(1, 3);
  refused(() => play(oneO.engine, P1, oneO.id("t")), "[O][O] needs two", ANY);
  assert.equal(zoneOf(oneO.engine, oneO.id("t")), "hand");
});

clause(TM, "0:rule", "unblocked on the faction: I am offered 'may pay 1'; paying exactly 1 makes the FACTION'S CONTROLLER (the opponent) choose one of their characters, which goes to hand", () => {
  const b = tmBoard();
  const seen = tmHit(b, true, ["c2"]);
  assert.deepEqual(seen, [`mayPay:${P1}`, `chooserSelectsTarget:${P2}`], "I decide; the opponent picks");
  assert.equal(zoneOf(b.engine, b.id("c2")), "hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("c2")), true);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play", "only the one they chose");
  assert.equal(zoneOf(b.engine, b.id("tm")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(ready(b.engine, P1), 2, "paid exactly 1");
});

clause(TM, "0:rule", "declining the payment: no character moves and nothing is paid", () => {
  const b = tmBoard();
  const seen = tmHit(b, false, ["c1"]);
  assert.deepEqual(seen, [`mayPay:${P1}`]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  assert.equal(ready(b.engine, P1), 3);
});

clause(TM, "0:rule", "the opponent can pick only a character THEY control: my character, an item of theirs, and a second pick are refused", () => {
  const b = tmBoard({ extra: [{ key: "itm", def: item({ name: "Itm", text: "no icons" }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P1, [b.id("tm")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  let checked = false;
  finishBattle(b.engine, undefined, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mine")] }), "my character", ANY);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("itm")] }), "item", ANY);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("c1"), b.id("c2")] }), "two", ANY);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "must pick (not optional)", ANY);
    assert.equal(zoneOf(b.engine, b.id("mine")), "play");
    checked = true;
    return { kind: "chooserSelectsTarget", selected: [b.id("c1")] };
  });
  assert.ok(checked, "checked");
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand", "control");
});

clause(TM, "0:rule", "the character returns to its OWNER's hand: a character the opponent controls but I own goes to MY hand", () => {
  const b = tmBoard({ foes: 0, extra: [{ key: "lent", def: noTextChar("Lent"), owner: P1, zone: "play", controller: P2 }] });
  tmHit(b, true, ["lent"]);
  assert.equal(zoneOf(b.engine, b.id("lent")), "hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("lent")), true, "owner's hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("lent")), false);
});

clause(TM, "0:rule", "if the opponent controls no character the payment resolves without a pick (no soft-lock)", () => {
  const b = tmBoard({ foes: 0 });
  const seen = tmHit(b, true, []);
  assert.deepEqual(seen, [`mayPay:${P1}`]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(TM, "0:rule", "I cannot pay 1 without a ready resource: with none, no character is bounced", () => {
  const b = tmBoard({ res: 0 });
  assert.equal(ready(b.engine, P1), 0);
  const seen = tmHit(b, true, ["c1"]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play", `no payment possible (saw ${seen.join(",")})`);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(TM, "0:rule", "no trigger when it is blocked and damages a character instead of the faction", () => {
  const b = tmBoard();
  declareAttackBy(b.engine, P1, [b.id("tm")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("c1")] });
  const seen: string[] = [];
  finishBattle(b.engine, undefined, (pc) => { seen.push(pc.kind); return declineAll(pc); });
  assert.equal(seen.includes("mayPay"), false, "battle damage to a character is not damage to a faction");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  assert.equal(ready(b.engine, P1), 3);
});

clause(TM, "0:rule", "no trigger when ANOTHER of my characters hits the faction while the Marionette stays home", () => {
  const b = tmBoard();
  const seen = tmHit(b, true, ["c1"], ["mine"]);
  assert.equal(seen.includes(`mayPay:${P1}`), false, "this card did not inflict the damage");
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
  assert.equal(ready(b.engine, P1), 3);
});

// ============================================================================
// Voidal Bask
// When this card leaves play, look at an opponent's hand and choose a card in it. That player discards that card.
// Character, arcanist, dragon, cost 6, [O], 4 str / 2 spd / 3 life.
// ============================================================================
const VB = "a750d103-edca-4c5d-8724-e289ed80463e";

function vbBoard(o: { oppHand?: number; extra?: Cards; vbController?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vb", def: printing(VB), owner: P1, zone: "play", controller: o.vbController },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "ally", def: noTextChar("Ally"), owner: P1, zone: "play" },
      ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
      ...fillers("mh", 2, P1, "hand"),
      { key: "oppPlay", def: noTextChar("OppPlay"), owner: P2, zone: "play" },
      ...fillers("od", 2, P2, "deck"),
      ...fillers("odd", 2, P2, "discard"),
      ...(o.extra ?? [])
    ]
  });
}
const vbKill = (b: ReturnType<typeof vbBoard>, t = "vb") => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(t)] } });

clause(VB, "0:rule", "the card is an Arcanist dragon, cost 6, [O], 4 str / 2 spd / 3 life: 6 Obsession deploy it, 5 refused, 6 Greed refused", () => {
  const p = printing(VB);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["dragon"], 6, "o", 4, 2, 3]);
  const mk = (o: number, g: number) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: printing(VB), owner: P1, zone: "hand" }, ...bank("obsession", o, P1), ...bank("greed", g, P1)]
  });
  const ok = mk(7, 0);
  play(ok.engine, P1, ok.id("t"));
  assert.equal(ready(ok.engine, P1), 1, "exactly 6 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("t"), "strength"), ok.engine.getStat(ok.id("t"), "speed"), ok.engine.getStat(ok.id("t"), "life")], [4, 2, 3]);
  const short = mk(5, 0);
  refused(() => play(short.engine, P1, short.id("t")), "5 for cost 6", ANY);
  const noIcon = mk(0, 6);
  refused(() => play(noIcon.engine, P1, noIcon.id("t")), "no [O]", ANY);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("t")), "hand");
});

clause(VB, "0:rule", "when destroyed I (its controller) choose a card in the opponent's hand and that player discards exactly that card", () => {
  const b = vbBoard();
  vbKill(b);
  assert.equal(zoneOf(b.engine, b.id("vb")), "discard");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose, not the opponent");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh1")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P2).filter((x) => x.startsWith("oh") || x === b.id("oh1")), [b.id("oh1")], "the chosen card is discarded");
  assert.deepEqual(handOf(b.engine, P2).sort(), [b.id("oh0"), b.id("oh2")].sort(), "the rest stay");
  assert.equal(handOf(b.engine, P1).length, 3, "my hand is untouched (two fillers + the bounce tactic)");
});

clause(VB, "0:rule", "it triggers on any way of leaving play, not just destruction (bounced to hand)", () => {
  const b = vbBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("vb")] } });
  assert.equal(zoneOf(b.engine, b.id("vb")), "hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh2")] });
  assert.deepEqual(handOf(b.engine, P2).sort(), [b.id("oh0"), b.id("oh1")].sort());
  assert.equal(discardOf(b.engine, P2).includes(b.id("oh2")), true);
});

clause(VB, "0:rule", "the choice is exactly one card of the opponent's HAND: my hand, their deck/discard/play, none and two are all refused", () => {
  const b = vbBoard();
  vbKill(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh0")] }), "my hand", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("od0")] }), "their deck", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("odd0")] }), "their discard", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oppPlay")] }), "their play", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1")] }), "two cards", ANY);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "none", ANY);
  assert.equal(handOf(b.engine, P2).length, 3);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0")] });
  assert.equal(handOf(b.engine, P2).length, 2, "control");
});

clause(VB, "0:rule", "an empty opposing hand: nothing to choose and no soft-lock", () => {
  const b = vbBoard({ oppHand: 0 });
  vbKill(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vb")), "discard");
  assert.equal(handOf(b.engine, P1).length, 3);
});

clause(VB, "0:rule", "it does not trigger when it ENTERS play (only when it leaves)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "vb", def: printing(VB), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1), ...fillers("oh", 3, P2, "hand")]
  });
  play(b.engine, P1, b.id("vb"));
  assert.equal(zoneOf(b.engine, b.id("vb")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(VB, "0:rule", "it does not trigger when another character leaves play", () => {
  const b = vbBoard();
  vbKill(b, "ally");
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(zoneOf(b.engine, b.id("vb")), "play");
});

clause(VB, "0:rule", "'an opponent' is relative to its controller: controlled by the opponent, the opponent chooses and the card comes from MY (owner's) hand", () => {
  const b = vbBoard({ vbController: P2 });
  vbKill(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "its controller chooses");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0")] }), "controller's own hand", ANY);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh1")] });
  assert.equal(discardOf(b.engine, P1).includes(b.id("mh1")), true);
  assert.equal(handOf(b.engine, P2).length, 3, "their own hand untouched");
});
