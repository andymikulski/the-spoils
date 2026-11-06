// Clause tests: shade-of-the-devoured-emperor-05, part p2 (groups 5-10, missing clauses only).
// Bottlebeard Brandyshanks, Bug Bite, Carnival Ringmaster, Cicibeo the Swift,
// Clockman City Shuffle, Drive By Boobing. Expectations come from the printed text.

import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, resourceCard, tactic, killTactic, P1, P2 } from "../per-card/_harness.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import { printedStats } from "./_printed.js";
import { clause, declineAll, drain, printing, refused, type PendingChoiceLike } from "./_clause.js";

const BB = "2b1308a7-014c-4924-b430-0448854cb6cc"; // Bottlebeard Brandyshanks: UNIQUE PLUCK -- top card of each opponents' deck revealed; if a character, +3 speed -- CHUG! COST: Pay 2. Pick an opponent. EFFECT: top card of that player's deck to the bottom
const BITE = "ccd054c5-3295-437d-b15e-012665c83059"; // Bug Bite: tactic 1 dd -- token on a character, destroy if tokens >= numeric cost -- RECUR (dd, from discard, pay 4, remove self): 2 tokens
const RM = "fddf5886-b70a-4855-b338-422a4bad3cc3"; // Carnival Ringmaster: TACTICAL -- ETB may join attacking/blocking party, party +1 speed -- ETB may pick a character: token
const CICI = "8d77787d-29d9-405f-a8a7-5d42bd854c11"; // Cicibeo the Swift: UNIQUE CICIBEO, TACTICAL, discard a non-resource Rogue card, [D]x6 take control on another cicibeo from hand
const SHUF = "0a841e49-928b-4a3e-b4fa-ffdb9349bcf0"; // Clockman City Shuffle: tactic 5 ddd -- this turn your characters +1/+1, opponents' -1/-1
const DBB = "475ce92c-8128-4eff-b8bd-a22626d8de1f"; // Drive By Boobing: tactic 3 dd -- pick a character that inflicted damage to your faction this turn, remove it from the game

const optIdx = (pc: PendingChoiceLike, re: RegExp): number => {
  const labels = ((pc.options as { label?: string }[] | undefined) ?? []).map((o) => o.label ?? "");
  const i = labels.findIndex((l) => re.test(l));
  assert.ok(i >= 0, `an option matching ${re} in [${labels.join(" | ")}]`);
  return i;
};

// ============================================================================
// Bottlebeard Brandyshanks
// ============================================================================

function bbBoard(o: { p2Top?: CardDefinition; resources?: number; extra?: CardPlacement[]; active?: PlayerId; bbOwner?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "bb", def: printing(BB), owner: o.bbOwner ?? P1, zone: "play" },
      ...bank("deception", o.resources ?? 4, P1),
      { key: "t0", def: o.p2Top ?? character({ name: "Top Character" }), owner: P2, zone: "deck" },
      { key: "t1", def: item({ name: "Second Item" }), owner: P2, zone: "deck" },
      { key: "t2", def: tactic({ name: "Third Tactic" }), owner: P2, zone: "deck" },
      { key: "m0", def: character({ name: "Mine Top" }), owner: P1, zone: "deck" },
      { key: "m1", def: character({ name: "Mine Second" }), owner: P1, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}
const revealedTop = (e: ReturnType<typeof bbBoard>["engine"]) => e.getFlowView().revealed.deckTop.map((x) => [x.playerId, x.cardId]);

clause(BB, "0:unique", "a second UNIQUE PLUCK Bottlebeard: the controller picks the one to keep, the other is destroyed", () => {
  for (const keepNew of [false, true]) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "old", def: printing(BB), owner: P1, zone: "play" },
        { key: "new", def: printing(BB), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("new"));
    const pc = pending(engine)!;
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [id("old"), id("new")].sort());
    answerPending(engine, "uniqueSurvivor", { keep: id(keepNew ? "new" : "old") });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("old")), keepNew ? "discard" : "play");
    assert.equal(zoneOf(engine, id("new")), keepNew ? "play" : "discard");
  }
});

clause(BB, "0:unique", "UNIQUE PLUCK conflicts with ANY other card carrying PLUCK, but not with a card carrying another UNIQUE", () => {
  const mk = (otherUnique: string) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "other", def: character({ name: "Other Unique", unique: otherUnique }), owner: P1, zone: "play" },
        { key: "bb", def: printing(BB), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1)
      ]
    });
  const clash = mk("pluck");
  play(clash.engine, P1, clash.id("bb"));
  const pc = pending(clash.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor", "another PLUCK card clashes");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [clash.id("other"), clash.id("bb")].sort());
  answerPending(clash.engine, "uniqueSurvivor", { keep: clash.id("other") });
  assert.equal(zoneOf(clash.engine, clash.id("bb")), "discard");
  assert.equal(zoneOf(clash.engine, clash.id("other")), "play");

  const fine = mk("something-else");
  play(fine.engine, P1, fine.id("bb"));
  assert.equal(pending(fine.engine), undefined, "a different UNIQUE identifier doesn't clash");
  assert.equal(zoneOf(fine.engine, fine.id("bb")), "play");
  assert.equal(zoneOf(fine.engine, fine.id("other")), "play");
});

clause(BB, "0:unique", "the restriction is per player: an opponent's own Bottlebeard doesn't clash", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "theirs", def: printing(BB), owner: P2, zone: "play" },
      { key: "mine", def: printing(BB), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("mine"));
  assert.equal(pending(engine), undefined, "no survivor choice");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(BB, "1:rule", "the top card of the opponent's deck (only theirs) is revealed, and the reveal follows the top card", () => {
  const { engine, id } = bbBoard();
  const deck = engine.state.players[P2].deck;
  assert.deepEqual(deck, [id("t0"), id("t1"), id("t2")], "precondition: deck order");
  assert.deepEqual(revealedTop(engine), [[P2, id("t0")]], "the opponent's top card is public; my own top card isn't");
  assert.equal(engine.getStat(id("bb"), "strength"), 3);
  assert.equal(engine.getStat(id("bb"), "life"), 3);
});

clause(BB, "0:unique", "Bottlebeard deploys for 4 with [D][D][D] (printed 3/1/3): refused with 3 resources, or with enough resources but only two D icons", () => {
  const mk = (extra: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "bb", def: printing(BB), owner: P1, zone: "hand" }, ...extra]
    });
  const ok = mk([...bank("deception", 3, P1), ...bank("rage", 1, P1)]);
  play(ok.engine, P1, ok.id("bb"));
  assert.equal(zoneOf(ok.engine, ok.id("bb")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "paid 4");
  assert.deepEqual([ok.engine.getStat(ok.id("bb"), "strength"), ok.engine.getStat(ok.id("bb"), "speed"), ok.engine.getStat(ok.id("bb"), "life")], [3, 1, 3]);
  const short = mk(bank("deception", 3, P1));
  refused(() => play(short.engine, P1, short.id("bb")), "3 resources can't pay 4");
  const twoIcons = mk([...bank("deception", 2, P1), ...bank("rage", 4, P1)]);
  refused(() => play(twoIcons.engine, P1, twoIcons.id("bb")), "only two D icons");
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("bb")), "hand");
});

clause(BB, "1:rule", "the reveal is on only while Bottlebeard is in play: off in hand, on in play, off again once it leaves", () => {
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BB), owner: P1, zone: "hand" },
      { key: "t0", def: character({ name: "Top" }), owner: P2, zone: "deck" }
    ]
  });
  assert.deepEqual(inHand.engine.getFlowView().revealed.deckTop, [], "Bottlebeard in hand: nothing revealed");

  const { engine, id } = bbBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(revealedTop(engine), [[P2, id("t0")]], "in play: revealed");
  play(engine, P1, id("kill"), { selected: { t: [id("bb")] } });
  assert.equal(zoneOf(engine, id("bb")), "discard");
  assert.deepEqual(engine.getFlowView().revealed.deckTop, [], "left play: no longer revealed");
});

clause(BB, "1:rule", "an opponent's Bottlebeard reveals MY deck top, not its own controller's", () => {
  const { engine, id } = bbBoard({ bbOwner: P2 });
  assert.deepEqual(revealedTop(engine), [[P1, id("m0")]], "only the deck of the Bottlebeard controller's opponent");
});

clause(BB, "1:rule", "if the revealed top card is a character, Bottlebeard gains 3 speed (1 -> 4)", () => {
  const { engine, id } = bbBoard();
  assert.equal(engine.getStat(id("bb"), "speed"), 4);
});

clause(BB, "1:rule", "no speed bonus while the revealed top card is an item, a tactic or a resource", () => {
  for (const [name, def] of [
    ["item", item({ name: "Top Item" })],
    ["tactic", tactic({ name: "Top Tactic" })],
    ["resource", resourceCard({ name: "Top Resource" })]
  ] as const) {
    const { engine, id } = bbBoard({ p2Top: def });
    assert.equal(engine.getStat(id("bb"), "speed"), 1, `top card is a ${name}: printed speed 1`);
  }
});

clause(BB, "1:rule", "a character that is NOT the top card (second in the deck), or in MY deck top, gives no speed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BB), owner: P1, zone: "play" },
      { key: "t0", def: item({ name: "Top Item" }), owner: P2, zone: "deck" },
      { key: "t1", def: character({ name: "Second Character" }), owner: P2, zone: "deck" },
      { key: "m0", def: character({ name: "My Top Character" }), owner: P1, zone: "deck" }
    ]
  });
  assert.deepEqual(engine.state.players[P2].deck, [id("t0"), id("t1")]);
  assert.equal(engine.getStat(id("bb"), "speed"), 1);
});

clause(BB, "1:rule", "an empty opponent deck gives no speed and reveals nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BB), owner: P1, zone: "play" },
      { key: "m0", def: character({ name: "My Top Character" }), owner: P1, zone: "deck" }
    ]
  });
  assert.equal(engine.getStat(id("bb"), "speed"), 1);
  assert.deepEqual(engine.getFlowView().revealed.deckTop, []);
});

clause(BB, "1:rule", "the speed bonus is only for Bottlebeard itself and only while it is in play (not other characters, not from the discard pile)", () => {
  const { engine, id } = bbBoard({
    extra: [
      { key: "ally", def: character({ name: "Ally", speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", speed: 2 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getStat(id("bb"), "speed"), 4);
  assert.equal(engine.getStat(id("ally"), "speed"), 2, "other characters don't gain speed");
  assert.equal(engine.getStat(id("foe"), "speed"), 2);
  play(engine, P1, id("kill"), { selected: { t: [id("bb")] } });
  assert.equal(zoneOf(engine, id("bb")), "discard");
  assert.equal(engine.getStat(id("ally"), "speed"), 2);
  assert.equal(engine.getStat(id("bb"), "speed"), 1, "out of play it reads the printed speed again");
});

clause(BB, "1:rule", "the speed bonus holds on the opponent's turn too (a continuous rule)", () => {
  const { engine, id } = bbBoard({ active: P2 });
  assert.equal(engine.getStat(id("bb"), "speed"), 4);
});

clause(BB, "2:ability:bottlebeard-chug", "CHUG!: pay 2, the opponent's top card goes to the bottom of their deck (mine is untouched)", () => {
  const { engine, id } = bbBoard();
  const mine = [...engine.state.players[P1].deck];
  assert.equal(engine.getAvailableResourceCount(P1), 4);
  activate(engine, P1, id("bb"), "bottlebeard-chug");
  assert.equal(pending(engine), undefined, "no further choice (the opponent is the only opponent)");
  assert.deepEqual(engine.state.players[P2].deck, [id("t1"), id("t2"), id("t0")], "t0 went from the top to the bottom");
  assert.deepEqual(engine.state.players[P1].deck, mine, "my deck is untouched");
  assert.equal(engine.getAvailableResourceCount(P1), 2, "Pay 2");
  assert.equal(engine.state.cards[id("bb")].depleted, false, "no deplete cost");
  assert.equal(zoneOf(engine, id("t0")), "deck", "the card stays in the deck");
});

clause(BB, "2:ability:bottlebeard-chug", "CHUG! can be used again and again (3 uses cycle the 3-card deck), the revealed card and the speed bonus follow the new top", () => {
  const { engine, id } = bbBoard({ resources: 6 });
  assert.equal(engine.getStat(id("bb"), "speed"), 4, "top is the character");
  activate(engine, P1, id("bb"), "bottlebeard-chug");
  assert.deepEqual(revealedTop(engine), [[P2, id("t1")]]);
  assert.equal(engine.getStat(id("bb"), "speed"), 1, "the new top is an item");
  activate(engine, P1, id("bb"), "bottlebeard-chug");
  assert.deepEqual(engine.state.players[P2].deck, [id("t2"), id("t0"), id("t1")]);
  assert.equal(engine.getStat(id("bb"), "speed"), 1, "the new top is a tactic");
  activate(engine, P1, id("bb"), "bottlebeard-chug");
  assert.deepEqual(engine.state.players[P2].deck, [id("t0"), id("t1"), id("t2")], "back where it began");
  assert.deepEqual(revealedTop(engine), [[P2, id("t0")]]);
  assert.equal(engine.getStat(id("bb"), "speed"), 4, "the character is on top again");
  assert.equal(engine.getAvailableResourceCount(P1), 0, "3 uses x 2");
});

clause(BB, "2:ability:bottlebeard-chug", "CHUG! needs 2 resources: refused with 1, works with exactly 2", () => {
  const poor = bbBoard({ resources: 1 });
  refused(() => activate(poor.engine, P1, poor.id("bb"), "bottlebeard-chug"), "only 1 resource to pay 2 with");
  assert.deepEqual(poor.engine.state.players[P2].deck, [poor.id("t0"), poor.id("t1"), poor.id("t2")], "nothing moved");
  const exact = bbBoard({ resources: 2 });
  activate(exact.engine, P1, exact.id("bb"), "bottlebeard-chug");
  assert.deepEqual(exact.engine.state.players[P2].deck, [exact.id("t1"), exact.id("t2"), exact.id("t0")]);
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
});

clause(BB, "2:ability:bottlebeard-chug", "CHUG! is Bottlebeard's controller's ability: the opponent can't use it", () => {
  const { engine, id } = bbBoard({ resources: 4, extra: bank("deception", 4, P2) });
  refused(() => activate(engine, P2, id("bb"), "bottlebeard-chug"), "not P2's card");
  assert.deepEqual(engine.state.players[P2].deck, [id("t0"), id("t1"), id("t2")], "nothing moved");
  activate(engine, P1, id("bb"), "bottlebeard-chug");
  assert.deepEqual(engine.state.players[P2].deck, [id("t1"), id("t2"), id("t0")], "control: the controller can");
});

clause(BB, "2:ability:bottlebeard-chug", "CHUG! on a 1-card deck leaves it as it is; on an empty deck it does nothing", () => {
  const one = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BB), owner: P1, zone: "play" },
      ...bank("deception", 2, P1),
      { key: "t0", def: character({ name: "Only Card" }), owner: P2, zone: "deck" }
    ]
  });
  activate(one.engine, P1, one.id("bb"), "bottlebeard-chug");
  assert.deepEqual(one.engine.state.players[P2].deck, [one.id("t0")]);
  const none = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "bb", def: printing(BB), owner: P1, zone: "play" }, ...bank("deception", 2, P1)]
  });
  activate(none.engine, P1, none.id("bb"), "bottlebeard-chug");
  assert.deepEqual(none.engine.state.players[P2].deck, []);
  assert.equal(pending(none.engine), undefined);
});

// ============================================================================
// Bug Bite
// ============================================================================

function biteBoard(o: { zone?: "hand" | "discard" | "deck"; resources?: number; icon?: "deception" | "rage"; extra?: CardPlacement[]; withTargets?: boolean } = {}) {
  const targets: CardPlacement[] =
    o.withTargets === false
      ? []
      : [
          { key: "c0", def: character({ name: "Cost0", cost: 0 }), owner: P2, zone: "play" },
          { key: "c1", def: character({ name: "Cost1", cost: 1 }), owner: P2, zone: "play" },
          { key: "c2", def: character({ name: "Cost2", cost: 2 }), owner: P1, zone: "play" },
          { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner: P2, zone: "play" },
          { key: "c5", def: character({ name: "Cost5", cost: 5 }), owner: P2, zone: "play" },
          { key: "bystander", def: character({ name: "Bystander", cost: 1 }), owner: P2, zone: "play" }
        ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bite", def: printing(BITE), owner: P1, zone: o.zone ?? "hand" },
      ...bank(o.icon ?? "deception", o.resources ?? 6, P1),
      ...targets,
      ...(o.extra ?? [])
    ]
  });
}
const tokens = (e: ReturnType<typeof biteBoard>["engine"], cardId: string) => e.state.cards[cardId].counters?.token ?? 0;

clause(BITE, "0:ability", "COST: pick a character; EFFECT: a token goes on it (it stays in play while tokens < its cost)", () => {
  const { engine, id } = biteBoard();
  play(engine, P1, id("bite"), { selected: { ch: [id("c3")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(tokens(engine, id("c3")), 1, "exactly one token");
  assert.equal(zoneOf(engine, id("c3")), "play", "1 token < cost 3: survives");
  assert.equal(tokens(engine, id("bystander")), 0, "other characters get nothing");
  assert.equal(tokens(engine, id("c5")), 0);
  assert.equal(zoneOf(engine, id("bite")), "discard", "the tactic ends in its owner's discard pile");
});

clause(BITE, "0:ability", "the picked character is destroyed when its tokens reach its numeric cost: cost 1 with the first token", () => {
  const { engine, id } = biteBoard();
  play(engine, P1, id("bite"), { selected: { ch: [id("c1")] } });
  assert.equal(zoneOf(engine, id("c1")), "discard", "1 token >= cost 1: destroyed");
  assert.equal(zoneOf(engine, id("bystander")), "play");
});

clause(BITE, "0:ability", "a cost-0 character is destroyed too (1 token >= 0)", () => {
  const { engine, id } = biteBoard();
  play(engine, P1, id("bite"), { selected: { ch: [id("c0")] } });
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(BITE, "0:ability", "tokens already on the character count: cost 2 with 1 token dies, cost 3 with 1 token only reaches 2", () => {
  const board = () =>
    biteBoard({
      withTargets: false,
      extra: [
        { key: "two", def: character({ name: "Cost2", cost: 2 }), owner: P2, zone: "play", counters: { token: 1 } },
        { key: "three", def: character({ name: "Cost3", cost: 3 }), owner: P2, zone: "play", counters: { token: 1 } }
      ]
    });
  const a = board();
  play(a.engine, P1, a.id("bite"), { selected: { ch: [a.id("two")] } });
  assert.equal(zoneOf(a.engine, a.id("two")), "discard", "1 + 1 = 2 >= cost 2");
  const b = board();
  play(b.engine, P1, b.id("bite"), { selected: { ch: [b.id("three")] } });
  assert.equal(zoneOf(b.engine, b.id("three")), "play", "1 + 1 = 2 < cost 3");
  assert.equal(tokens(b.engine, b.id("three")), 2);
});

clause(BITE, "0:ability", "any character in play can be picked: mine as well as the opponent's", () => {
  const { engine, id } = biteBoard();
  play(engine, P1, id("bite"), { selected: { ch: [id("c2")] } });
  assert.equal(tokens(engine, id("c2")), 1, "c2 is mine, cost 2");
  assert.equal(zoneOf(engine, id("c2")), "play");
});

clause(BITE, "0:ability", "only characters in play can be picked: not items, locations, cards in hand or discard, nor a faction", () => {
  const extra: CardPlacement[] = [
    { key: "it", def: item({ name: "Some Item" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Some Location", structure: 3 }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Hand Character", cost: 1 }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "Discard Character", cost: 1 }), owner: P2, zone: "discard" }
  ];
  for (const [what, key] of [
    ["an item", "it"],
    ["a location", "loc"],
    ["a character in hand", "hc"],
    ["a character in the discard pile", "dc"],
    ["the opponent's faction", "faction"]
  ] as const) {
    const b = biteBoard({ extra });
    const pick = key === "faction" ? b.engine.state.players[P2].factionId! : b.id(key);
    refused(() => play(b.engine, P1, b.id("bite"), { selected: { ch: [pick] } }), what);
    assert.equal(zoneOf(b.engine, b.id("bite")), "hand", `${what}: Bug Bite stays in hand`);
  }
  const ok = biteBoard({ extra });
  play(ok.engine, P1, ok.id("bite"), { selected: { ch: [ok.id("c3")] } });
  assert.equal(tokens(ok.engine, ok.id("c3")), 1, "control: a character in play works");
});

clause(BITE, "0:ability", "a pick is required: with no selection (or no character in play) it can't be played", () => {
  const none = biteBoard({ withTargets: false });
  refused(() => play(none.engine, P1, none.id("bite"), { selected: { ch: [] } }), "no character to pick");
  assert.equal(zoneOf(none.engine, none.id("bite")), "hand");
  const some = biteBoard();
  refused(() => play(some.engine, P1, some.id("bite"), { selected: { ch: [] } }), "picking nothing");
  const ok = biteBoard();
  play(ok.engine, P1, ok.id("bite"), { selected: { ch: [ok.id("c3")] } });
  assert.equal(zoneOf(ok.engine, ok.id("bite")), "discard", "control");
});

clause(BITE, "0:ability", "costs 1: one resource is spent; refused with the [D][D] threshold unmet or with no resource left to pay", () => {
  const ok = biteBoard({ resources: 2 });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 2);
  play(ok.engine, P1, ok.id("bite"), { selected: { ch: [ok.id("c3")] } });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 1, "paid exactly 1");

  const lowThreshold = biteBoard({ resources: 1 });
  refused(() => play(lowThreshold.engine, P1, lowThreshold.id("bite"), { selected: { ch: [lowThreshold.id("c3")] } }), "only one D icon: threshold dd unmet");
  const wrongIcon = biteBoard({ resources: 3, icon: "rage" });
  refused(() => play(wrongIcon.engine, P1, wrongIcon.id("bite"), { selected: { ch: [wrongIcon.id("c3")] } }), "3 rage resources have no D icons");
  const spent = biteBoard({ resources: 0, extra: bank("deception", 2, P1).map((c) => ({ ...c, attachedToKey: "__factionA" })) });
  refused(() => play(spent.engine, P1, spent.id("bite"), { selected: { ch: [spent.id("c3")] } }), "threshold [D][D] met by spent icons, but no ready resource left to pay the cost of 1 (control: a ready resource pays above)", /Costs cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("bite")), "hand");
});

clause(BITE, "1:ability:bug-bite-recur", "RECUR from the discard pile: pay 4, remove Bug Bite from the game, put 2 tokens on the picked character", () => {
  const { engine, id } = biteBoard({ zone: "discard" });
  assert.equal(engine.getAvailableResourceCount(P1), 6);
  activate(engine, P1, id("bite"), "bug-bite-recur", { selected: { ch2: [id("c5")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(tokens(engine, id("c5")), 2, "two tokens");
  assert.equal(zoneOf(engine, id("c5")), "play", "2 < cost 5");
  assert.equal(zoneOf(engine, id("bite")), "removed", "removed from the game, not back in the discard pile");
  assert.equal(engine.getAvailableResourceCount(P1), 2, "paid 4");
  assert.equal(tokens(engine, id("bystander")), 0);
});

clause(BITE, "1:ability:bug-bite-recur", "RECUR destroys the picked character when its tokens reach its cost: cost 2 (0 + 2), cost 1, cost 3 with 1 token already", () => {
  const two = biteBoard({ zone: "discard" });
  activate(two.engine, P1, two.id("bite"), "bug-bite-recur", { selected: { ch2: [two.id("c2")] } });
  assert.equal(zoneOf(two.engine, two.id("c2")), "discard", "2 tokens >= cost 2");
  const one = biteBoard({ zone: "discard" });
  activate(one.engine, P1, one.id("bite"), "bug-bite-recur", { selected: { ch2: [one.id("c1")] } });
  assert.equal(zoneOf(one.engine, one.id("c1")), "discard");
  const pre = biteBoard({ zone: "discard", withTargets: false, extra: [{ key: "t", def: character({ name: "Cost3", cost: 3 }), owner: P2, zone: "play", counters: { token: 1 } }] });
  activate(pre.engine, P1, pre.id("bite"), "bug-bite-recur", { selected: { ch2: [pre.id("t")] } });
  assert.equal(zoneOf(pre.engine, pre.id("t")), "discard", "1 + 2 = 3 >= cost 3");
  const three = biteBoard({ zone: "discard" });
  activate(three.engine, P1, three.id("bite"), "bug-bite-recur", { selected: { ch2: [three.id("c3")] } });
  assert.equal(zoneOf(three.engine, three.id("c3")), "play", "2 < cost 3");
  assert.equal(tokens(three.engine, three.id("c3")), 2);
});

clause(BITE, "1:ability:bug-bite-recur", "RECUR may pick any character in play (mine too) but nothing else", () => {
  const mine = biteBoard({ zone: "discard" });
  activate(mine.engine, P1, mine.id("bite"), "bug-bite-recur", { selected: { ch2: [mine.id("c2")] } });
  assert.equal(zoneOf(mine.engine, mine.id("c2")), "discard", "my own cost-2 character: destroyed");
  const extra: CardPlacement[] = [
    { key: "it", def: item({ name: "Some Item" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Hand Character", cost: 1 }), owner: P2, zone: "hand" }
  ];
  for (const k of ["it", "hc"]) {
    const b = biteBoard({ zone: "discard", extra });
    refused(() => activate(b.engine, P1, b.id("bite"), "bug-bite-recur", { selected: { ch2: [b.id(k)] } }), `picking ${k}`);
    assert.equal(zoneOf(b.engine, b.id("bite")), "discard", "still in the discard pile");
  }
  const none = biteBoard({ zone: "discard", withTargets: false });
  refused(() => activate(none.engine, P1, none.id("bite"), "bug-bite-recur", { selected: { ch2: [] } }), "no character to pick");
});

clause(BITE, "1:ability:bug-bite-recur", "RECUR can only be used while Bug Bite is in the discard pile: not from hand or deck", () => {
  for (const zone of ["hand", "deck"] as const) {
    const b = biteBoard({ zone });
    refused(() => activate(b.engine, P1, b.id("bite"), "bug-bite-recur", { selected: { ch2: [b.id("c5")] } }), `Bug Bite in ${zone}`);
    assert.equal(zoneOf(b.engine, b.id("bite")), zone);
    assert.equal(tokens(b.engine, b.id("c5")), 0);
  }
  const ok = biteBoard({ zone: "discard" });
  activate(ok.engine, P1, ok.id("bite"), "bug-bite-recur", { selected: { ch2: [ok.id("c5")] } });
  assert.equal(tokens(ok.engine, ok.id("c5")), 2, "control: from the discard pile it works");
});

clause(BITE, "1:ability:bug-bite-recur", "RECUR costs 4 and needs [D][D]: refused with 3 resources, or with 4+ resources lacking the D icons", () => {
  const short = biteBoard({ zone: "discard", resources: 3 });
  refused(() => activate(short.engine, P1, short.id("bite"), "bug-bite-recur", { selected: { ch2: [short.id("c5")] } }), "3 resources can't pay 4");
  assert.equal(zoneOf(short.engine, short.id("bite")), "discard");
  const noIcons = biteBoard({ zone: "discard", resources: 6, icon: "rage" });
  refused(() => activate(noIcons.engine, P1, noIcons.id("bite"), "bug-bite-recur", { selected: { ch2: [noIcons.id("c5")] } }), "6 rage resources have no D icons");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("bite")), "discard");
  const oneIcon = biteBoard({ zone: "discard", resources: 5, icon: "rage", extra: bank("deception", 1, P1) });
  refused(() => activate(oneIcon.engine, P1, oneIcon.id("bite"), "bug-bite-recur", { selected: { ch2: [oneIcon.id("c5")] } }), "six resources but only one D icon: [D][D] unmet");
  const mixed = biteBoard({ zone: "discard", resources: 4, icon: "rage", extra: bank("deception", 2, P1) });
  activate(mixed.engine, P1, mixed.id("bite"), "bug-bite-recur", { selected: { ch2: [mixed.id("c5")] } });
  assert.equal(tokens(mixed.engine, mixed.id("c5")), 2, "control: two D icons among six resources is enough");
  assert.equal(mixed.engine.getAvailableResourceCount(P1), 2);
  const exact = biteBoard({ zone: "discard", resources: 4 });
  activate(exact.engine, P1, exact.id("bite"), "bug-bite-recur", { selected: { ch2: [exact.id("c5")] } });
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0, "exactly 4 pays it");
  assert.equal(zoneOf(exact.engine, exact.id("bite")), "removed");
});

clause(BITE, "1:ability:bug-bite-recur", "play Bug Bite (1 token), then RECUR it from the discard pile the same turn (2 more tokens)", () => {
  const { engine, id } = biteBoard({ resources: 5 });
  play(engine, P1, id("bite"), { selected: { ch: [id("c5")] } });
  assert.equal(tokens(engine, id("c5")), 1);
  assert.equal(zoneOf(engine, id("bite")), "discard");
  activate(engine, P1, id("bite"), "bug-bite-recur", { selected: { ch2: [id("c5")] } });
  assert.equal(tokens(engine, id("c5")), 3, "1 + 2");
  assert.equal(zoneOf(engine, id("c5")), "play", "3 < cost 5");
  assert.equal(zoneOf(engine, id("bite")), "removed");
  assert.equal(engine.getAvailableResourceCount(P1), 0, "1 + 4");
  assert.equal(engine.state.players[P1].discard.includes(id("bite")), false);
});

// ============================================================================
// Clockman City Shuffle
// ============================================================================

function shufBoard(o: { resources?: number; icon?: "deception" | "rage"; extra?: CardPlacement[]; copies?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "shuf", def: printing(SHUF), owner: P1, zone: "hand" },
      ...(o.copies === 2 ? [{ key: "shuf2", def: printing(SHUF), owner: P1, zone: "hand" as const }] : []),
      ...bank(o.icon ?? "deception", o.resources ?? 5, P1),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 4, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 3, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs Two", strength: 5, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

clause(SHUF, "0:rule", "characters I control gain 1 strength and 1 life, characters my opponent controls lose 1 strength and 1 life", () => {
  const { engine, id } = shufBoard();
  play(engine, P1, id("shuf"));
  assert.equal(pending(engine), undefined, "no pick needed");
  assert.deepEqual([engine.getStat(id("mine"), "strength"), engine.getStat(id("mine"), "life")], [3, 3]);
  assert.deepEqual([engine.getStat(id("mine2"), "strength"), engine.getStat(id("mine2"), "life")], [5, 6], "every one of my characters");
  assert.deepEqual([engine.getStat(id("theirs"), "strength"), engine.getStat(id("theirs"), "life")], [2, 2]);
  assert.deepEqual([engine.getStat(id("theirs2"), "strength"), engine.getStat(id("theirs2"), "life")], [4, 5], "every one of theirs");
  assert.equal(engine.getStat(id("mine"), "speed"), 1, "speed is not touched");
  assert.equal(engine.getStat(id("theirs"), "speed"), 1);
  assert.equal(zoneOf(engine, id("shuf")), "discard");
});

clause(SHUF, "0:rule", "it follows CONTROL, not ownership: a character I took from the opponent gains, one the opponent took from me loses", () => {
  const { engine, id } = shufBoard({
    extra: [
      { key: "stolenByMe", def: character({ name: "Stolen By Me", strength: 2, life: 2 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenByThem", def: character({ name: "Stolen By Them", strength: 2, life: 2 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("shuf"));
  assert.deepEqual([engine.getStat(id("stolenByMe"), "strength"), engine.getStat(id("stolenByMe"), "life")], [3, 3]);
  assert.deepEqual([engine.getStat(id("stolenByThem"), "strength"), engine.getStat(id("stolenByThem"), "life")], [1, 1]);
});

clause(SHUF, "0:rule", "only characters in play are affected: not a character in hand, nor an item in play", () => {
  const { engine, id } = shufBoard({
    extra: [
      { key: "handChar", def: character({ name: "Hand Char", strength: 2, life: 2 }), owner: P1, zone: "hand" },
      { key: "theirHand", def: character({ name: "Their Hand Char", strength: 3, life: 3 }), owner: P2, zone: "hand" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" }
    ]
  });
  const gearBefore = [engine.getStat(id("gear"), "strength"), engine.getStat(id("gear"), "life")];
  play(engine, P1, id("shuf"));
  assert.deepEqual([engine.getStat(id("handChar"), "strength"), engine.getStat(id("handChar"), "life")], [2, 2], "my character in hand");
  assert.deepEqual([engine.getStat(id("theirHand"), "strength"), engine.getStat(id("theirHand"), "life")], [3, 3], "their character in hand");
  assert.deepEqual([engine.getStat(id("gear"), "strength"), engine.getStat(id("gear"), "life")], gearBefore, "an item in play");
});

clause(SHUF, "0:rule", "'This turn': the bonuses and penalties are gone once the turn ends", () => {
  const { engine, id } = shufBoard({ extra: [{ key: "padding", def: character({ name: "Pad" }), owner: P1, zone: "deck" }, { key: "padding2", def: character({ name: "Pad2" }), owner: P2, zone: "deck" }] });
  play(engine, P1, id("shuf"));
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "during the turn");
  endTurn(engine, P1);
  assert.deepEqual([engine.getStat(id("mine"), "strength"), engine.getStat(id("mine"), "life")], [2, 2], "after the turn: back to normal");
  assert.deepEqual([engine.getStat(id("theirs"), "strength"), engine.getStat(id("theirs"), "life")], [3, 3]);
  assert.deepEqual([engine.getStat(id("theirs2"), "strength"), engine.getStat(id("theirs2"), "life")], [5, 6]);
});

clause(SHUF, "0:rule", "the penalty can't push strength below 0 (a 0-strength character stays at 0)", () => {
  const { engine, id } = shufBoard({
    extra: [{ key: "weak", def: character({ name: "Weak", strength: 0, life: 3 }), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("shuf"));
  assert.equal(engine.getStat(id("weak"), "strength"), 0, "0 strength stays 0 (CR 410.4)");
  assert.equal(engine.getStat(id("weak"), "life"), 2, "its life still drops by 1");
  assert.equal(engine.getStat(id("theirs"), "strength"), 2, "a character with strength left just loses 1");
});

clause(SHUF, "0:rule", "a character reduced to 0 life is destroyed (1 life - 1), one with life left is not", () => {
  const { engine, id } = shufBoard({
    extra: [{ key: "frail", def: character({ name: "Frail", strength: 2, life: 1 }), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("shuf"));
  assert.equal(zoneOf(engine, id("frail")), "discard", "1 life - 1 = 0 life: destroyed");
  assert.equal(zoneOf(engine, id("theirs")), "play", "a character with life left isn't");
});

clause(SHUF, "0:rule", "characters that enter play after it resolves are not affected (the effect applies to the characters in play when it resolves)", () => {
  const { engine, id } = shufBoard({ extra: [{ key: "late", def: character({ name: "Late", strength: 2, life: 2, cost: 0 }), owner: P1, zone: "hand" }, ...bank("deception", 1, P1)] });
  play(engine, P1, id("shuf"));
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.deepEqual([engine.getStat(id("late"), "strength"), engine.getStat(id("late"), "life")], [2, 2]);
});

clause(SHUF, "0:rule", "two Shuffles stack: +2/+2 for mine, -2/-2 for theirs", () => {
  const { engine, id } = shufBoard({ resources: 10, copies: 2 });
  play(engine, P1, id("shuf"));
  play(engine, P1, id("shuf2"));
  assert.deepEqual([engine.getStat(id("mine"), "strength"), engine.getStat(id("mine"), "life")], [4, 4]);
  assert.deepEqual([engine.getStat(id("theirs"), "strength"), engine.getStat(id("theirs"), "life")], [1, 1]);
});

clause(SHUF, "0:rule", "in a battle: my boosted character survives, their weakened one dies (2/2 vs 2/2 becomes 3/3 vs 1/1)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "shuf", def: printing(SHUF), owner: P1, zone: "hand" },
      ...bank("deception", 5, P1),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 2, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  play(engine, P1, id("shuf"));
  assert.ok(battleOf(engine), "the battle is on");
  drain(engine, declineAll);
  declareBlockers(engine, P2, [id("theirs")]);
  finishBattle(engine);
  assert.equal(zoneOf(engine, id("theirs")), "discard", "1/1 takes 3 damage");
  assert.equal(zoneOf(engine, id("mine")), "play", "3/3 takes only 1 damage");
});

clause(SHUF, "0:rule", "costs 5: refused with 4 resources, with 5 rage resources (no [D][D][D]), and with the threshold met but the resources spent", () => {
  const ok = shufBoard({ resources: 5 });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 5);
  play(ok.engine, P1, ok.id("shuf"));
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "all 5 paid");
  assert.equal(ok.engine.getStat(ok.id("mine"), "strength"), 3);

  const short = shufBoard({ resources: 4 });
  refused(() => play(short.engine, P1, short.id("shuf")), "4 resources can't pay 5");
  assert.equal(short.engine.getStat(short.id("mine"), "strength"), 2, "nothing happened");
  const noIcons = shufBoard({ resources: 5, icon: "rage" });
  refused(() => play(noIcons.engine, P1, noIcons.id("shuf")), "5 rage resources have no D icons");
  const twoIcons = shufBoard({ resources: 0, extra: [...bank("deception", 2, P1), ...bank("rage", 4, P1)] });
  refused(() => play(twoIcons.engine, P1, twoIcons.id("shuf")), "six resources but only two D icons");
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("shuf")), "hand");
  const threeIcons = shufBoard({ resources: 0, extra: [...bank("deception", 3, P1), ...bank("rage", 2, P1)] });
  play(threeIcons.engine, P1, threeIcons.id("shuf"));
  assert.equal(threeIcons.engine.getStat(threeIcons.id("mine"), "strength"), 3, "control: three D icons are enough");
  const spent = shufBoard({ resources: 0, extra: bank("deception", 5, P1).map((c, i) => (i < 1 ? { ...c, attachedToKey: "__factionA" } : c)) });
  refused(() => play(spent.engine, P1, spent.id("shuf")), "threshold met by spent icons, but only 4 ready resources for cost 5", /Costs cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("shuf")), "hand");
});

// ============================================================================
// Cicibeo the Swift
// ============================================================================

const rogueChar = () => character({ name: "Rogue Char", trade: "rogue", cost: 1 });
const rogueItem = () => item({ name: "Rogue Item", trade: "rogue" });
const rogueTactic = () => tactic({ name: "Rogue Tactic", trade: "rogue" });
const rogueLoc = () => location({ name: "Rogue Loc", trade: "rogue", structure: 3 });
const rogueRes = () => resourceCard({ name: "Rogue Resource", trade: "rogue" });

function ciciBoard(o: { banks?: number; icon?: "deception" | "rage"; hand?: CardPlacement[]; inPlay?: CardPlacement[]; active?: PlayerId; cici?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "cb", def: printing(CICI), owner: P1, zone: o.cici ?? "hand" },
      ...bank(o.icon ?? "deception", o.banks ?? 4, P1),
      ...(o.hand ?? []),
      ...(o.inPlay ?? [])
    ]
  });
}
const rogueHand = (): CardPlacement[] => [
  { key: "rc", def: rogueChar(), owner: P1, zone: "hand" },
  { key: "ri", def: rogueItem(), owner: P1, zone: "hand" },
  { key: "rt", def: rogueTactic(), owner: P1, zone: "hand" },
  { key: "rl", def: rogueLoc(), owner: P1, zone: "hand" },
  { key: "rr", def: rogueRes(), owner: P1, zone: "hand" },
  { key: "wc", def: character({ name: "Warlord Char", trade: "warlord" }), owner: P1, zone: "hand" }
];

clause(CICI, "0:unique", "a second UNIQUE CICIBEO: the controller picks which to keep, the other is destroyed", () => {
  for (const keepNew of [false, true]) {
    const { engine, id } = ciciBoard({
      cici: "play",
      hand: [
        { key: "new", def: printing(CICI), owner: P1, zone: "hand" },
        { key: "rc", def: rogueChar(), owner: P1, zone: "hand" }
      ]
    });
    play(engine, P1, id("new"), { selected: { toss: [id("rc")] } });
    const pc = pending(engine)!;
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...(pc.candidates as string[])].sort(), [id("cb"), id("new")].sort());
    answerPending(engine, "uniqueSurvivor", { keep: id(keepNew ? "new" : "cb") });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("cb")), keepNew ? "discard" : "play");
    assert.equal(zoneOf(engine, id("new")), keepNew ? "play" : "discard");
  }
});

clause(CICI, "0:unique", "UNIQUE CICIBEO conflicts with ANY other card carrying CICIBEO, but not with a card carrying another UNIQUE", () => {
  const mk = (otherUnique: string) =>
    ciciBoard({
      hand: [{ key: "rc", def: rogueChar(), owner: P1, zone: "hand" }],
      inPlay: [{ key: "other", def: character({ name: "Other Unique", unique: otherUnique }), owner: P1, zone: "play" }]
    });
  const clash = mk("cicibeo");
  play(clash.engine, P1, clash.id("cb"), { selected: { toss: [clash.id("rc")] } });
  const pc = pending(clash.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor", "another CICIBEO card clashes");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [clash.id("cb"), clash.id("other")].sort());
  answerPending(clash.engine, "uniqueSurvivor", { keep: clash.id("other") });
  assert.equal(zoneOf(clash.engine, clash.id("cb")), "discard");
  assert.equal(zoneOf(clash.engine, clash.id("other")), "play");
  const fine = mk("something-else");
  play(fine.engine, P1, fine.id("cb"), { selected: { toss: [fine.id("rc")] } });
  assert.equal(pending(fine.engine), undefined, "a different UNIQUE identifier doesn't clash");
  assert.equal(zoneOf(fine.engine, fine.id("cb")), "play");
  assert.equal(zoneOf(fine.engine, fine.id("other")), "play");
});

clause(CICI, "0:unique", "the restriction is per player: the opponent's own Cicibeo doesn't clash", () => {
  const { engine, id } = ciciBoard({
    hand: [{ key: "rc", def: rogueChar(), owner: P1, zone: "hand" }],
    inPlay: [{ key: "theirs", def: printing(CICI), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("cb"), { selected: { toss: [id("rc")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cb")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(CICI, "1:kw:TACTICAL", "it has TACTICAL: on the opponent's turn I can deploy it inside a response window; an ordinary character can't be", () => {
  const { engine, id } = ciciBoard({
    active: P2,
    hand: [
      { key: "rc", def: rogueChar(), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
    ],
    inPlay: [{ key: "x", def: character({ name: "Raider", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" }]
  });
  assert.ok(engine.getKeywords(id("cb")).includes("tactical"), "engine.getKeywords(id(\"cb\")).includes(\"tactical\")");
  declareAttackOpenWindow(engine, P2, [id("x")]);
  refused(() => playRaw(engine, P1, id("plain")), "a non-TACTICAL character can't be deployed in the opponent's window");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  play(engine, P1, id("cb"), { selected: { toss: [id("rc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cb")), "play", "Cicibeo deployed at tactic timing");
  assert.equal(zoneOf(engine, id("rc")), "discard", "its discard cost was paid");
});

clause(CICI, "1:kw:TACTICAL", "with nothing to respond to on the opponent's turn it can't be deployed", () => {
  const { engine, id } = ciciBoard({ active: P2, hand: [{ key: "rc", def: rogueChar(), owner: P1, zone: "hand" }] });
  refused(() => playRaw(engine, P1, id("cb"), { selected: { toss: [id("rc")] } }), "no window is open for me");
  assert.equal(zoneOf(engine, id("cb")), "hand");
});

clause(CICI, "2:ability", "COST: discard a non-resource Rogue card: a Rogue character, item, tactic or location each works, and only that card is discarded", () => {
  for (const key of ["rc", "ri", "rt", "rl"]) {
    const { engine, id } = ciciBoard({ hand: rogueHand() });
    play(engine, P1, id("cb"), { selected: { toss: [id(key)] } });
    assert.equal(pending(engine), undefined, key);
    assert.equal(zoneOf(engine, id("cb")), "play", key);
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} was discarded`);
    for (const other of ["rc", "ri", "rt", "rl", "rr", "wc"].filter((k) => k !== key)) {
      assert.equal(zoneOf(engine, id(other)), "hand", `${other} stays in hand when ${key} is discarded`);
    }
  }
});

clause(CICI, "2:ability", "the discard must be a non-resource Rogue card from my hand: a non-Rogue card, a Rogue resource, a Rogue card in play and Cicibeo himself are refused", () => {
  const board = () => ciciBoard({ hand: rogueHand(), inPlay: [{ key: "rip", def: character({ name: "Rogue In Play", trade: "rogue" }), owner: P1, zone: "play" }] });
  for (const [what, key] of [
    ["a non-Rogue character", "wc"],
    ["a Rogue resource card", "rr"],
    ["a Rogue character that is in play, not in hand", "rip"]
  ] as const) {
    const b = board();
    refused(() => play(b.engine, P1, b.id("cb"), { selected: { toss: [b.id(key)] } }), what);
    assert.equal(zoneOf(b.engine, b.id("cb")), "hand", `${what}: Cicibeo stays in hand`);
    assert.equal(zoneOf(b.engine, b.id(key)), key === "rip" ? "play" : "hand", `${what}: untouched`);
  }
  const ok = board();
  play(ok.engine, P1, ok.id("cb"), { selected: { toss: [ok.id("rc")] } });
  assert.equal(zoneOf(ok.engine, ok.id("cb")), "play", "control: a Rogue character works");
});

clause(CICI, "2:ability", "Cicibeo can't discard himself to pay for himself: with only him in hand the cost is unaffordable", () => {
  const solo = ciciBoard({});
  refused(() => play(solo.engine, P1, solo.id("cb"), { selected: { toss: [solo.id("cb")] } }), "Cicibeo is being played; he isn't a card in hand to discard");
  assert.equal(zoneOf(solo.engine, solo.id("cb")), "hand", "he stays in hand");
  const withOther = ciciBoard({ hand: [{ key: "rc", def: rogueChar(), owner: P1, zone: "hand" }] });
  refused(() => play(withOther.engine, P1, withOther.id("cb"), { selected: { toss: [withOther.id("cb")] } }), "he still can't be the discarded card");
  assert.equal(zoneOf(withOther.engine, withOther.id("rc")), "hand");
});

clause(CICI, "2:ability", "without any non-resource Rogue card in hand Cicibeo can't be deployed (cost unaffordable), and the discard can't be skipped", () => {
  for (const [what, hand] of [
    ["an empty hand", [] as CardPlacement[]],
    ["only a non-Rogue card", [{ key: "wc", def: character({ name: "Warlord Char", trade: "warlord" }), owner: P1, zone: "hand" }] as CardPlacement[]],
    ["only a Rogue resource", [{ key: "rr", def: rogueRes(), owner: P1, zone: "hand" }] as CardPlacement[]]
  ] as const) {
    const b = ciciBoard({ hand: [...hand] });
    refused(() => play(b.engine, P1, b.id("cb"), { selected: { toss: [] } }), what);
    assert.equal(zoneOf(b.engine, b.id("cb")), "hand", what);
  }
  const skip = ciciBoard({ hand: rogueHand() });
  refused(() => play(skip.engine, P1, skip.id("cb"), { selected: { toss: [] } }), "a Rogue card is available but nothing was picked to discard");
  assert.equal(zoneOf(skip.engine, skip.id("cb")), "hand");
  const two = ciciBoard({ hand: rogueHand() });
  refused(() => play(two.engine, P1, two.id("cb"), { selected: { toss: [two.id("rc"), two.id("ri")] } }), "'Discard a card' means exactly one");
  assert.equal(zoneOf(two.engine, two.id("cb")), "hand");
  assert.equal(zoneOf(two.engine, two.id("rc")), "hand");
});

clause(CICI, "2:ability", "Cicibeo costs 0 but needs [D][D][D][D]: no resource is spent; refused with only three D icons", () => {
  const ok = ciciBoard({ banks: 4, hand: rogueHand() });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 4);
  play(ok.engine, P1, ok.id("cb"), { selected: { toss: [ok.id("rc")] } });
  assert.equal(zoneOf(ok.engine, ok.id("cb")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 4, "cost 0: nothing spent");
  assert.deepEqual([ok.engine.getStat(ok.id("cb"), "strength"), ok.engine.getStat(ok.id("cb"), "speed"), ok.engine.getStat(ok.id("cb"), "life")], [2, 4, 3]);

  const three = ciciBoard({ banks: 3, hand: rogueHand() });
  refused(() => play(three.engine, P1, three.id("cb"), { selected: { toss: [three.id("rc")] } }), "three D icons are short of dddd");
  assert.equal(zoneOf(three.engine, three.id("cb")), "hand");
  assert.equal(zoneOf(three.engine, three.id("rc")), "hand", "the discard cost wasn't paid");
  const rage = ciciBoard({ banks: 6, icon: "rage", hand: rogueHand() });
  refused(() => play(rage.engine, P1, rage.id("cb"), { selected: { toss: [rage.id("rc")] } }), "rage icons aren't D icons");
});

function ciciRule(o: { banks?: number; active?: PlayerId; extraPlay?: CardPlacement[]; cousinDef?: CardDefinition; cousinZone?: "hand" | "discard"; extraHand?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "cb", def: printing(CICI), owner: P1, zone: "play" },
      ...bank("deception", o.banks ?? 6, P1),
      ...bank("deception", 6, P2),
      { key: "cousin", def: o.cousinDef ?? character({ name: "Cicibeo Cousin", subtype: ["cicibeo"], cost: 0 }), owner: o.active === P2 ? P2 : P1, zone: o.cousinZone ?? "hand" },
      { key: "v1", def: character({ name: "Victim One", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "v2", def: character({ name: "Victim Two", strength: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "theirHand", def: character({ name: "Their Hand Char" }), owner: P2, zone: "hand" },
      { key: "p1deck", def: character({ name: "P1 Deck" }), owner: P1, zone: "deck" },
      { key: "p2deck", def: character({ name: "P2 Deck" }), owner: P2, zone: "deck" },
      ...(o.extraHand ?? []),
      ...(o.extraPlay ?? [])
    ]
  });
}
const controllerOf = (e: ReturnType<typeof ciciRule>["engine"], cardId: string) => e.state.cards[cardId].controllerId;

clause(CICI, "3:rule@dddddd", "with [D]x6, another cicibeo card entering play from my hand lets me pick a character and take control of it", () => {
  const { engine, id } = ciciRule();
  play(engine, P1, id("cousin"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("v1")] });
  assert.equal(pending(engine), undefined);
  assert.equal(controllerOf(engine, id("v1")), P1, "I control the picked character");
  assert.equal(engine.state.cards[id("v1")].ownerId, P2, "it is still owned by the opponent");
  assert.equal(controllerOf(engine, id("v2")), P2, "other characters are untouched");
  assert.equal(zoneOf(engine, id("v1")), "play");
  endTurn(engine, P1);
  assert.equal(controllerOf(engine, id("v1")), P1, "no duration: I keep it into the next turn");
});

clause(CICI, "3:rule@dddddd", "'you may': declining the pick leaves everything as it was", () => {
  const { engine, id } = ciciRule();
  play(engine, P1, id("cousin"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  for (const k of ["v1", "v2", "gear"]) assert.equal(controllerOf(engine, id(k)), P2, k);
  assert.equal(zoneOf(engine, id("cousin")), "play");
});

clause(CICI, "3:rule@dddddd", "any character in play can be picked (mine too); items and characters in hand can't", () => {
  const own = ciciRule();
  play(own.engine, P1, own.id("cousin"));
  answerPending(own.engine, "chooserSelectsTarget", { selected: [own.id("v2")] });
  assert.equal(controllerOf(own.engine, own.id("v2")), P1, "control: the other opponent character");
  for (const [what, key] of [
    ["an item", "gear"],
    ["a character in the opponent's hand", "theirHand"]
  ] as const) {
    const b = ciciRule();
    play(b.engine, P1, b.id("cousin"));
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] }), what);
    assert.equal(controllerOf(b.engine, b.id(key)), P2, `${what}: control didn't change`);
  }
});

clause(CICI, "3:rule@dddddd", "threshold-gated: with only five D icons the rule is off (no pick offered)", () => {
  const { engine, id } = ciciRule({ banks: 5 });
  play(engine, P1, id("cousin"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cousin")), "play");
  assert.equal(controllerOf(engine, id("v1")), P2);
  const rage = ciciRule({ banks: 0, extraPlay: bank("rage", 6, P1) });
  play(rage.engine, P1, rage.id("cousin"));
  assert.equal(pending(rage.engine), undefined, "six non-D resources don't count");
});

clause(CICI, "3:rule@dddddd", "only a card with the cicibeo subtype counts: a card merely named Cicibeo, or an unrelated card, doesn't trigger it", () => {
  for (const def of [
    character({ name: "Cicibeo Impostor", subtype: ["grifter"], cost: 0 }),
    character({ name: "Plain Character", cost: 0 })
  ]) {
    const { engine, id } = ciciRule({ cousinDef: def });
    play(engine, P1, id("cousin"));
    assert.equal(pending(engine), undefined, def.name);
    assert.equal(zoneOf(engine, id("cousin")), "play", def.name);
    assert.equal(controllerOf(engine, id("v1")), P2, def.name);
  }
});

clause(CICI, "3:rule@dddddd", "'another': Cicibeo himself entering play doesn't trigger his own rule", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "cb", def: printing(CICI), owner: P1, zone: "hand" },
      { key: "rc", def: rogueChar(), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1),
      { key: "v1", def: character({ name: "Victim One" }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("cb"), { selected: { toss: [id("rc")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cb")), "play");
  assert.equal(engine.state.cards[id("v1")].controllerId, P2);
});

clause(CICI, "3:rule@dddddd", "'your hand': a cicibeo card the OPPONENT puts into play doesn't trigger my Cicibeo", () => {
  const { engine, id } = ciciRule({ active: P2 });
  play(engine, P2, id("cousin"));
  assert.equal(zoneOf(engine, id("cousin")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(controllerOf(engine, id("v1")), P2);
  assert.equal(controllerOf(engine, id("mine")), P1);
});

const reviveTactic = (): CardDefinition =>
  tactic({
    name: "Revive",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

clause(CICI, "3:rule@dddddd", "'enters play from your hand': a cicibeo card entering play from the discard pile doesn't trigger it", () => {
  const { engine, id } = ciciRule({ cousinZone: "discard", extraHand: [{ key: "revive", def: reviveTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("revive"), { selected: { t: [id("cousin")] } });
  assert.equal(zoneOf(engine, id("cousin")), "play", "the cousin came back from the discard pile");
  assert.equal(pending(engine), undefined, "it did not come from my hand: no pick is offered");
  assert.equal(controllerOf(engine, id("v1")), P2);
});

// ============================================================================
// Carnival Ringmaster
// ============================================================================

function rmBoard(o: { active?: PlayerId; resources?: number; extra?: CardPlacement[]; rmZone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "rm", def: printing(RM), owner: P1, zone: o.rmZone ?? "hand" },
      ...bank("deception", o.resources ?? 6, P1),
      { key: "a1", def: character({ name: "A One", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "x", def: character({ name: "X Raider", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "d1", def: character({ name: "D One", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "fort", def: location({ name: "Fort", structure: 20 }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "Hand Char" }), owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}
type RmGame = ReturnType<typeof rmBoard>;
/** Answers Ringmaster's prompts: which party to join (by option label) and which character, if any, gets the token. */
function rmDrive(g: RmGame, o: { join?: RegExp; token?: string }) {
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: optIdx(pc, o.join ?? /not join/i) };
    if (pc.kind === "chooserSelectsTarget") return { kind: pc.kind, selected: o.token ? [o.token] : [] };
    return declineAll(pc);
  });
  assert.equal(pending(g.engine), undefined, "all prompts answered");
}
/** Answers prompts (declining the party) until the token pick is the open prompt. */
function rmToTokenPrompt(g: RmGame) {
  for (let i = 0; i < 6 && pending(g.engine) && pending(g.engine)!.kind !== "chooserSelectsTarget"; i++) {
    const pc = pending(g.engine)!;
    const choice = pc.kind === "chooserSelectsOption" ? { kind: pc.kind, index: optIdx(pc, /not join/i) } : declineAll(pc);
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  }
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
}
const speedOf = (g: RmGame, key: string) => g.engine.getStat(g.id(key), "speed");
const tokenOn = (g: RmGame, key: string) => g.engine.state.cards[g.id(key)].counters?.token ?? 0;
/** P1 attacks with a1 alone and then plays Ringmaster (tactic timing, attacker's priority). */
function rmAttacking(join: RegExp | undefined, token?: string, atFort = false) {
  const g = rmBoard();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("a1")], target: atFort ? { type: "card", cardId: g.id("fort") } : { type: "faction", playerId: P2 } });
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join, token: token ? g.id(token) : undefined });
  return g;
}

clause(RM, "0:kw:TACTICAL", "it has TACTICAL: on the opponent's turn I can deploy it in a response window (an ordinary character can't be)", () => {
  const g = rmBoard({ active: P2, extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  assert.ok(g.engine.getKeywords(g.id("rm")).includes("tactical"), "g.engine.getKeywords(g.id(\"rm\")).includes(\"tactical\")");
  declareAttackOpenWindow(g.engine, P2, [g.id("x")]);
  refused(() => playRaw(g.engine, P1, g.id("plain")), "a non-TACTICAL character can't be deployed here (the TACTICAL card deploys below)", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, {});
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
});

clause(RM, "0:kw:TACTICAL", "with no window open on the opponent's turn it can't be deployed", () => {
  const g = rmBoard({ active: P2 });
  refused(() => playRaw(g.engine, P1, g.id("rm")), "nothing to respond to");
  assert.equal(zoneOf(g.engine, g.id("rm")), "hand");
});

clause(RM, "0:kw:TACTICAL", "it deploys for 4 with [D][D][D] (printed 1/2/1): refused with 3 resources or without the D icons", () => {
  const ok = rmBoard({ resources: 4 });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 4);
  play(ok.engine, P1, ok.id("rm"));
  rmDrive(ok, {});
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "paid 4");
  assert.deepEqual([ok.engine.getStat(ok.id("rm"), "strength"), ok.engine.getStat(ok.id("rm"), "speed"), ok.engine.getStat(ok.id("rm"), "life")], [1, 2, 1]);
  const short = rmBoard({ resources: 3 });
  refused(() => play(short.engine, P1, short.id("rm")), "3 resources can't pay 4");
  assert.equal(zoneOf(short.engine, short.id("rm")), "hand");
  const rage = rmBoard({ resources: 0, extra: bank("rage", 6, P1) });
  refused(() => play(rage.engine, P1, rage.id("rm")), "rage resources have no D icons");
  const twoIcons = rmBoard({ resources: 0, extra: [...bank("deception", 2, P1), ...bank("rage", 4, P1)] });
  refused(() => play(twoIcons.engine, P1, twoIcons.id("rm")), "six resources but only two D icons");
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("rm")), "hand");
  const threeIcons = rmBoard({ resources: 0, extra: [...bank("deception", 3, P1), ...bank("rage", 3, P1)] });
  play(threeIcons.engine, P1, threeIcons.id("rm"));
  assert.equal(zoneOf(threeIcons.engine, threeIcons.id("rm")), "play", "control: three D icons are enough");
});

clause(RM, "1:rule", "attacking: it joins my attacking party and every character in that party (itself included) gains 1 speed", () => {
  const g = rmAttacking(/attacking/i);
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
  const b = battleOf(g.engine)!;
  assert.deepEqual([...b.attackingParty].sort(), [g.id("a1"), g.id("rm")].sort(), "Ringmaster is in the attacking party");
  assert.equal(speedOf(g, "a1"), 3, "2 + 1");
  assert.equal(speedOf(g, "rm"), 3, "2 + 1");
  assert.equal(speedOf(g, "ally"), 2, "not in the party: unchanged");
  assert.equal(speedOf(g, "x"), 2, "the opponent's characters are unchanged");
  assert.equal(speedOf(g, "d1"), 1);
});

clause(RM, "1:rule", "'you may': choosing not to join leaves the party and every speed as they were", () => {
  const g = rmAttacking(/not join/i);
  assert.equal(zoneOf(g.engine, g.id("rm")), "play", "Ringmaster still entered play");
  assert.deepEqual([...battleOf(g.engine)!.attackingParty], [g.id("a1")]);
  assert.equal(speedOf(g, "a1"), 2);
  assert.equal(speedOf(g, "rm"), 2);
});

clause(RM, "1:rule", "the +1 speed lasts until the end of the battle (user ruling): +1 during the battle, gone once the battle ends", () => {
  const g = rmAttacking(/attacking/i, undefined, true);
  assert.equal(speedOf(g, "a1"), 3);
  declareBlockers(g.engine, P2, []);
  assert.equal(speedOf(g, "a1"), 3, "a1 still has +1 speed during the battle");
  assert.equal(speedOf(g, "rm"), 3, "Ringmaster still has +1 speed during the battle");
  finishBattle(g.engine);
  assert.equal(battleOf(g.engine), undefined, "the battle is over");
  assert.equal(speedOf(g, "a1"), 2, "a1 loses the +1 speed once the battle ends");
  assert.equal(speedOf(g, "rm"), 2, "Ringmaster loses the +1 speed once the battle ends");
  assert.equal(speedOf(g, "ally"), 2, "a character outside the party never gained it");
});

clause(RM, "1:rule", "the joined party fights: Ringmaster's strength 1 is added to the attack (3 damage to the location instead of 2)", () => {
  const g = rmAttacking(/attacking/i, undefined, true);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("fort")].damage, 3, "a1's 2 + Ringmaster's 1");
  const none = rmAttacking(/not join/i, undefined, true);
  declareBlockers(none.engine, P2, []);
  finishBattle(none.engine);
  assert.equal(none.engine.state.cards[none.id("fort")].damage, 2, "control: without Ringmaster only a1's 2");
});

function speedRace(join: RegExp) {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "rm", def: printing(RM), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1),
      { key: "a", def: character({ name: "Fast Attacker", strength: 3, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Fast Defender", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("a")], target: { type: "faction", playerId: P2 } });
  play(g.engine, P1, g.id("rm"));
  rmDrive(g as unknown as RmGame, { join });
  declareBlockers(g.engine, P2, [g.id("d")]);
  finishBattle(g.engine);
  return g;
}

clause(RM, "1:rule", "the speed gain matters in the battle: with +1 my speed-2 attacker strikes together with the speed-3 blocker (both die); without it the blocker strikes first and survives", () => {
  const joined = speedRace(/attacking/i);
  assert.equal(zoneOf(joined.engine, joined.id("d")), "discard", "attacker (now speed 3) struck at the same time: 3 damage kills the 3-life blocker");
  assert.equal(zoneOf(joined.engine, joined.id("a")), "discard", "and the blocker's 2 damage killed the 2-life attacker");
  const alone = speedRace(/not join/i);
  assert.equal(zoneOf(alone.engine, alone.id("a")), "discard", "control: speed 2 is slower than speed 3 - the attacker dies first");
  assert.equal(zoneOf(alone.engine, alone.id("d")), "play", "control: and never strikes back");
});

clause(RM, "1:rule", "blocking: with blockers already declared it joins my blocking party and every character there gains 1 speed", () => {
  const g = rmBoard({ active: P2, extra: [{ key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("x")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /blocking/i });
  assert.deepEqual([...battleOf(g.engine)!.blockingParty].sort(), [g.id("blk"), g.id("rm")].sort(), "Ringmaster is in the blocking party");
  assert.equal(speedOf(g, "blk"), 2, "1 + 1");
  assert.equal(speedOf(g, "rm"), 3, "2 + 1");
  assert.equal(speedOf(g, "x"), 2, "the attacker is unchanged");
  assert.equal(speedOf(g, "ally"), 2, "a bystander of mine is unchanged");
});

clause(RM, "1:rule", "blocking, deployed before blockers are declared (CR 608.1c): with no blockers declared it becomes the blocking party", () => {
  const g = rmBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("x")]);
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /blocking/i });
  declareBlockers(g.engine, P1, []);
  assert.deepEqual([...(battleOf(g.engine)?.blockingParty ?? [])], [g.id("rm")], "Ringmaster alone is the blocking party");
  assert.equal(speedOf(g, "rm"), 3, "it gained the 1 speed");
});

clause(RM, "1:rule", "blocking, deployed before blockers are declared: it is added to the blocking party once the party forms (CR 608.1c)", () => {
  const g = rmBoard({ active: P2, extra: [{ key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("x")]);
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /blocking/i });
  declareBlockers(g.engine, P1, [g.id("blk")]);
  assert.deepEqual([...battleOf(g.engine)!.blockingParty].sort(), [g.id("blk"), g.id("rm")].sort(), "both block together");
  assert.equal(speedOf(g, "rm"), 3);
});

clause(RM, "1:rule", "the party is MINE: as the defender I can't use it on the attacking party (the attackers gain nothing, Ringmaster doesn't join them)", () => {
  const g = rmBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("x")]);
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /attacking/i });
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
  assert.deepEqual([...battleOf(g.engine)!.attackingParty], [g.id("x")], "Ringmaster isn't in the opponent's party");
  assert.equal(speedOf(g, "x"), 2, "the opponent's attacker gains no speed");
});

clause(RM, "1:rule", "the party is MINE: as the attacker I can't use it on the opponent's blocking party (the blockers gain nothing)", () => {
  const g = rmBoard();
  declareAttackBy(g.engine, P1, [g.id("a1")]);
  declareBlockers(g.engine, P2, [g.id("d1")]);
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /blocking/i });
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
  assert.deepEqual([...battleOf(g.engine)!.blockingParty], [g.id("d1")], "Ringmaster isn't in the opponent's party");
  assert.equal(speedOf(g, "d1"), 1, "the opponent's blocker gains no speed");
});

clause(RM, "1:rule", "outside a battle there's no party to join: nothing happens and no speed is gained", () => {
  const g = rmBoard();
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /attacking/i });
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
  assert.equal(battleOf(g.engine), undefined, "no battle was started");
  assert.equal(speedOf(g, "rm"), 2);
  assert.equal(speedOf(g, "a1"), 2);
});

clause(RM, "2:rule", "ETB 'you may pick a character. If you do, put a token on that card': my character, the opponent's, or Ringmaster himself", () => {
  for (const key of ["a1", "x", "rm"]) {
    const g = rmBoard();
    play(g.engine, P1, g.id("rm"));
    rmDrive(g, { token: g.id(key) });
    for (const k of ["a1", "ally", "x", "d1", "rm"]) {
      assert.equal(tokenOn(g, k), k === key ? 1 : 0, `${k} after picking ${key}`);
    }
  }
});

clause(RM, "2:rule", "declining the pick (the 'if you do' doesn't happen): no token anywhere", () => {
  const g = rmBoard();
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, {});
  assert.equal(zoneOf(g.engine, g.id("rm")), "play");
  for (const k of ["a1", "ally", "x", "d1", "rm"]) assert.equal(tokenOn(g, k), 0, k);
});

clause(RM, "2:rule", "only characters in play can be picked: not an item, not a character in hand", () => {
  for (const [what, key] of [
    ["an item", "gear"],
    ["a character in hand", "handChar"]
  ] as const) {
    const g = rmBoard();
    play(g.engine, P1, g.id("rm"));
    rmToTokenPrompt(g);
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), what);
    assert.equal(tokenOn(g, key), 0, what);
  }
});

clause(RM, "2:rule", "it triggers only when THIS card enters play: another character entering later doesn't", () => {
  const g = rmBoard({ rmZone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(pending(g.engine), undefined, "no prompt");
  for (const k of ["a1", "ally", "x", "d1", "rm", "newbie"]) assert.equal(tokenOn(g, k), 0, k);
});

clause(RM, "2:rule", "'when this card enters play' also covers being put into play by an effect (here from the discard pile): the pick is offered", () => {
  const h = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "rm", def: printing(RM), owner: P1, zone: "discard" },
      { key: "revive", def: reviveTactic(), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A One" }), owner: P1, zone: "play" }
    ]
  });
  play(h.engine, P1, h.id("revive"), { selected: { t: [h.id("rm")] } });
  assert.equal(zoneOf(h.engine, h.id("rm")), "play");
  rmToTokenPrompt(h as unknown as RmGame);
  answerPending(h.engine, "chooserSelectsTarget", { selected: [h.id("a1")] });
  assert.equal(h.engine.state.cards[h.id("a1")].counters?.token ?? 0, 1);
});

// ============================================================================
// Drive By Boobing
// ============================================================================

function dbbBoard(o: { resources?: number; icon?: "deception" | "rage"; extra?: CardPlacement[] } = {}) {
  const raider = (name: string, strength: number): CardDefinition => character({ name, strength, life: 6, speed: 1 });
  return buildGame({
    playerA: { faction: developFaction(), influence: 30 },
    playerB: { faction: developFaction(), influence: 30 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "dbb", def: printing(DBB), owner: P1, zone: "hand" },
      { key: "dbb2", def: printing(DBB), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank(o.icon ?? "deception", o.resources ?? 6, P1),
      { key: "x1", def: raider("X One", 2), owner: P2, zone: "play" },
      { key: "x2", def: raider("X Two", 1), owner: P2, zone: "play" },
      { key: "v0", def: raider("Zero", 0), owner: P2, zone: "play" },
      { key: "y", def: raider("Y Location Raider", 2), owner: P2, zone: "play" },
      { key: "w", def: raider("W Blocked Raider", 2), owner: P2, zone: "play" },
      { key: "q", def: raider("Q Fresh Attacker", 2), owner: P2, zone: "play" },
      { key: "z", def: raider("Z Idle", 2), owner: P2, zone: "play" },
      { key: "keep", def: location({ name: "Keep", structure: 20 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type DbbGame = ReturnType<typeof dbbBoard>;
/** On P2's turn: x1, x2 and v0 hit my faction (v0 has 0 strength), y hits my location, w is blocked by blk; then q attacks and I hold priority. */
function dbbHistory(g: DbbGame, upTo: "faction" | "all" = "all") {
  const { engine, id } = g;
  declareAttackBy(engine, P2, [id("x1"), id("x2"), id("v0")]);
  declareBlockers(engine, P1, []);
  finishBattle(engine);
  if (upTo === "all") {
    declareAttackBy(engine, P2, [id("y")], { type: "card", cardId: id("keep") });
    declareBlockers(engine, P1, []);
    finishBattle(engine);
    declareAttackBy(engine, P2, [id("w")]);
    declareBlockers(engine, P1, [id("blk")]);
    finishBattle(engine);
  }
  declareAttackOpenWindow(engine, P2, [id("q")]);
}

clause(DBB, "0:ability", "removes a character that inflicted damage to my faction this turn from the game (not to the discard pile); the other raiders stay", () => {
  const g = dbbBoard();
  dbbHistory(g);
  const { engine, id } = g;
  assert.equal(engine.getAvailableResourceCount(P1), 6);
  play(engine, P1, id("dbb"), { selected: { ch: [id("x1")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("x1")), "removed", "removed from the game");
  assert.equal(engine.state.players[P2].discard.includes(id("x1")), false, "not in the discard pile");
  assert.equal(zoneOf(engine, id("x2")), "play", "the other raider who also hit my faction is untouched");
  assert.equal(zoneOf(engine, id("q")), "play");
  assert.equal(engine.getAvailableResourceCount(P1), 3, "cost 3 paid");
  assert.equal(zoneOf(engine, id("dbb")), "discard", "the tactic goes to my discard pile");
});

clause(DBB, "0:ability", "every character of a party that hit my faction is pickable (the second raider too)", () => {
  const g = dbbBoard();
  dbbHistory(g);
  play(g.engine, P1, g.id("dbb"), { selected: { ch: [g.id("x2")] } });
  assert.equal(zoneOf(g.engine, g.id("x2")), "removed");
  assert.equal(zoneOf(g.engine, g.id("x1")), "play");
});

clause(DBB, "0:ability", "only a character that actually inflicted damage to MY FACTION can be picked: not an attacker who hit only a location, was blocked, dealt 0 damage, hasn't struck yet, did nothing, or is mine", () => {
  const targets = [
    ["a character whose damage went to my location", "y"],
    ["a character that was blocked (its damage went to my blocker)", "w"],
    ["a character with 0 strength (inflicted no damage)", "v0"],
    ["an attacker that has not dealt damage yet", "q"],
    ["a character that did not attack", "z"],
    ["my own character", "mine"],
    ["my own blocker", "blk"]
  ] as const;
  for (const [what, key] of targets) {
    const g = dbbBoard();
    dbbHistory(g);
    refused(() => play(g.engine, P1, g.id("dbb"), { selected: { ch: [g.id(key)] } }), what);
    assert.equal(zoneOf(g.engine, g.id("dbb")), "hand", `${what}: Drive By Boobing stays in hand`);
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${what}: untouched`);
  }
  const ok = dbbBoard();
  dbbHistory(ok);
  play(ok.engine, P1, ok.id("dbb"), { selected: { ch: [ok.id("x1")] } });
  assert.equal(zoneOf(ok.engine, ok.id("x1")), "removed", "control: a raider that hit my faction works");
});

clause(DBB, "0:ability", "a pick is required: with nobody having damaged my faction (or nothing picked) it can't be played", () => {
  const g = dbbBoard();
  declareAttackOpenWindow(g.engine, P2, [g.id("q")]);
  refused(() => play(g.engine, P1, g.id("dbb"), { selected: { ch: [] } }), "no pick");
  refused(() => play(g.engine, P1, g.id("dbb"), { selected: { ch: [g.id("q")] } }), "nobody has damaged my faction yet this turn");
  assert.equal(zoneOf(g.engine, g.id("dbb")), "hand");
  const ok = dbbBoard();
  dbbHistory(ok, "faction");
  play(ok.engine, P1, ok.id("dbb"), { selected: { ch: [ok.id("x1")] } });
  assert.equal(zoneOf(ok.engine, ok.id("x1")), "removed", "control");
});

clause(DBB, "0:ability", "'this turn': damage dealt on an earlier turn doesn't count, and damage to the OPPONENT's faction never counts", () => {
  const g = dbbBoard();
  dbbHistory(g, "faction");
  const { engine, id } = g;
  play(engine, P1, id("dbb"), { selected: { ch: [id("x2")] } });
  assert.equal(zoneOf(engine, id("x2")), "removed", "control: this turn, in the window");
  declareBlockers(engine, P1, []);
  finishBattle(engine);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my turn now");
  // Control: tactics can be played on my own turn.
  play(engine, P1, id("kill"), { selected: { t: [id("z")] } });
  assert.equal(zoneOf(engine, id("z")), "discard", "a tactic works on my turn");
  refused(() => play(engine, P1, id("dbb2"), { selected: { ch: [id("x1")] } }), "x1 hit my faction on the opponent's turn, not this turn");
  assert.equal(zoneOf(engine, id("x1")), "play");
  // My own raider hits the opponent's faction: that isn't damage to MY faction.
  declareAttackBy(engine, P1, [id("mine")]);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  refused(() => play(engine, P1, id("dbb2"), { selected: { ch: [id("mine")] } }), "my character damaged the opponent's faction, not mine");
  assert.equal(zoneOf(engine, id("dbb2")), "hand");
});

clause(DBB, "0:ability", "costs 3 and needs [D][D]: refused with 2 resources, or with 3 resources lacking the D icons", () => {
  const short = dbbBoard({ resources: 2 });
  dbbHistory(short);
  refused(() => play(short.engine, P1, short.id("dbb"), { selected: { ch: [short.id("x1")] } }), "2 resources can't pay 3");
  assert.equal(zoneOf(short.engine, short.id("x1")), "play");
  const rage = dbbBoard({ resources: 3, icon: "rage" });
  dbbHistory(rage);
  refused(() => play(rage.engine, P1, rage.id("dbb"), { selected: { ch: [rage.id("x1")] } }), "rage resources have no D icons");
  assert.equal(zoneOf(rage.engine, rage.id("x1")), "play");
  const oneIcon = dbbBoard({ resources: 0, extra: [...bank("deception", 1, P1), ...bank("rage", 4, P1)] });
  dbbHistory(oneIcon);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("dbb"), { selected: { ch: [oneIcon.id("x1")] } }), "five resources but only one D icon: [D][D] unmet");
  const twoIcons = dbbBoard({ resources: 0, extra: [...bank("deception", 2, P1), ...bank("rage", 1, P1)] });
  dbbHistory(twoIcons);
  play(twoIcons.engine, P1, twoIcons.id("dbb"), { selected: { ch: [twoIcons.id("x1")] } });
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("x1")), "removed", "control: exactly two D icons are enough");
  const exact = dbbBoard({ resources: 3 });
  dbbHistory(exact);
  play(exact.engine, P1, exact.id("dbb"), { selected: { ch: [exact.id("x1")] } });
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
  assert.equal(zoneOf(exact.engine, exact.id("x1")), "removed");
});

// ============================================================================
// T3c7 behavior-mutation pass: printed trade / subtype, who answers a prompt, pick counts, durations, control
// ============================================================================

clause(BB, "0:unique", "printed type / trade / subtype / stats: a Rogue character, Pluck Drunk, 3 strength / 1 speed / 3 life", () => {
  printedStats({ id: BB, type: "character", subtype: ["pluck", "drunk"], strength: 3, speed: 1, life: 3 });
  assert.equal(printing(BB).trade, "rogue", "Bottlebeard is a Rogue card");
});

clause(BITE, "0:ability", "printed type / trade / subtype: a Rogue tactic with no subtype", () => {
  printedStats({ id: BITE, type: "tactic", subtype: [] });
  assert.equal(printing(BITE).trade, "rogue", "Bug Bite is a Rogue card");
});

clause(RM, "0:kw:TACTICAL", "printed type / trade / subtype / stats: a Rogue character, Performer, 1 strength / 2 speed / 1 life", () => {
  printedStats({ id: RM, type: "character", subtype: ["performer"], strength: 1, speed: 2, life: 1 });
  assert.equal(printing(RM).trade, "rogue", "Ringmaster is a Rogue card");
});

clause(CICI, "0:unique", "printed type / trade / subtype / stats: a Rogue character, Grifter Cicibeo, 2 strength / 4 speed / 3 life", () => {
  printedStats({ id: CICI, type: "character", subtype: ["grifter", "cicibeo"], strength: 2, speed: 4, life: 3 });
  assert.equal(printing(CICI).trade, "rogue", "Cicibeo is a Rogue card");
});

clause(SHUF, "0:rule", "printed type / trade / subtype: a Rogue tactic with no subtype", () => {
  printedStats({ id: SHUF, type: "tactic", subtype: [] });
  assert.equal(printing(SHUF).trade, "rogue", "Clockman City Shuffle is a Rogue card");
});

clause(DBB, "0:ability", "printed type / trade / subtype: a Rogue tactic with no subtype", () => {
  printedStats({ id: DBB, type: "tactic", subtype: [] });
  assert.equal(printing(DBB).trade, "rogue", "Drive By Boobing is a Rogue card");
});

clause(RM, "1:rule", "both of Ringmaster's 'you may' prompts (join a party, pick a token target) are MINE to answer", () => {
  const g = rmBoard();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("a1")], target: { type: "faction", playerId: P2 } });
  play(g.engine, P1, g.id("rm"));
  const seen: string[] = [];
  for (let i = 0; i < 8 && pending(g.engine); i++) {
    const pc = pending(g.engine)!;
    if (pc.kind === "chooserSelectsOption" || pc.kind === "chooserSelectsTarget") {
      assert.equal(pc.playerId, P1, `${pc.kind} is answered by the Ringmaster's controller`);
      seen.push(pc.kind);
    }
    const choice = pc.kind === "chooserSelectsOption" ? { kind: pc.kind, index: optIdx(pc, /not join/i) } : declineAll(pc);
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  }
  assert.deepEqual([...seen].sort(), ["chooserSelectsOption", "chooserSelectsTarget"], "both prompts were shown");
});

clause(RM, "1:rule", "blocking: the +1 speed lasts until the end of the battle, then it is gone for the whole blocking party", () => {
  const g = rmBoard({ active: P2, extra: [{ key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("x")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  play(g.engine, P1, g.id("rm"));
  rmDrive(g, { join: /blocking/i });
  assert.equal(speedOf(g, "blk"), 2, "1 + 1 during the battle");
  assert.equal(speedOf(g, "rm"), 3, "2 + 1 during the battle");
  finishBattle(g.engine);
  assert.equal(battleOf(g.engine), undefined, "the battle is over");
  assert.equal(speedOf(g, "blk"), 1, "the blocker loses the +1 speed once the battle ends");
  assert.equal(speedOf(g, "rm"), 2, "Ringmaster loses the +1 speed once the battle ends");
});

clause(RM, "2:rule", "'pick a character' is exactly one: two characters at once are refused, the prompt stays open and no token is placed", () => {
  const g = rmBoard();
  play(g.engine, P1, g.id("rm"));
  rmToTokenPrompt(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1"), g.id("x")] }), "two characters");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  assert.equal(tokenOn(g, "a1") + tokenOn(g, "x"), 0, "no token was placed");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1")] });
  assert.equal(tokenOn(g, "a1"), 1, "control: one character is accepted");
});

clause(CICI, "3:rule@dddddd", "the pick may be my OWN character (any character in play, no controller restriction) and is exactly one character", () => {
  const b = ciciRule();
  play(b.engine, P1, b.id("cousin"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("v1"), b.id("v2")] }), "two characters at once");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  assert.equal(controllerOf(b.engine, b.id("v1")), P2, "nothing changed hands");
  assert.equal(controllerOf(b.engine, b.id("v2")), P2, "nothing changed hands");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mine")] });
  assert.equal(pending(b.engine), undefined, "my own character was accepted");
  assert.equal(controllerOf(b.engine, b.id("mine")), P1, "it stays under my control");
  assert.equal(controllerOf(b.engine, b.id("v1")), P2, "the opponent's characters are untouched");
});

clause(DBB, "0:ability", "the picked character need not be controlled by the opponent now: a raider I took control of after it hit my faction is still pickable", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const g = dbbBoard({ extra: [{ key: "steal", def: steal, owner: P1, zone: "hand" }] });
  dbbHistory(g);
  const { engine, id } = g;
  play(engine, P1, id("steal"), { selected: { t: [id("x1")] } });
  assert.equal(engine.state.cards[id("x1")].controllerId, P1, "precondition: I now control the raider");
  declareBlockers(engine, P1, []);
  engine.perform({ type: "passPriority", playerId: P2 });
  play(engine, P1, id("dbb"), { selected: { ch: [id("x1")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("x1")), "removed", "it inflicted damage to my faction this turn, so it can be picked whoever controls it now");
});
