// Multiplayer clause tests, seed-saga part 4: 3- and 4-seat tables, real catalog printings, public actions only.
// Spec: data/card-tests/mp-spec/seed-saga.json.
import assert from "node:assert/strict";
import { clause, clauseMismatch, declineAll, drain, refused } from "../_clause.js";
import { declareAttackBy } from "../_battle.js";
import { tokensOn } from "../_board.js";
import { activate, answer, askedPlayers, choosePlayer, deck, hand, many, pending, play, printing, res, table, zoneOf, P1, P2, P3, P4 } from "./_mp.js";
import type { CardPlacement } from "./_mp.js";
import { character, item, location, resourceCard, tactic } from "../../support/fixtures.js";
import { endTurn } from "../_turn.js";
import { buildGame, noDevelopFaction } from "../../support/fixtures.js";
import { autoResolveBattle } from "../../per-card/_harness.js";
import type { PlayerId } from "../../../../engine.js";

const seats = (count: number): PlayerId[] => (count === 3 ? [P1, P2, P3] : [P1, P2, P3, P4]);
const opponentsOf = (count: number): PlayerId[] => seats(count).slice(1);

// =====================================================================================
// Runivoltaic Accumulator
// =====================================================================================
const ACC = "c21dbc74-cf52-4375-a701-14c5052cf13e";

{
  const accTable = (active: PlayerId) =>
    table(
      3,
      [
        { key: "a", def: printing(ACC), owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "P1 body", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "P2 body", strength: 1, speed: 1, life: 3 }), owner: P2, zone: "play" },
        { key: "a3", def: character({ name: "P3 body", strength: 1, speed: 1, life: 3 }), owner: P3, zone: "play" }
      ],
      active
    );
  const body: Record<string, string> = { [P1]: "a1", [P2]: "a2", [P3]: "a3" };
  const attack = (t: ReturnType<typeof accTable>, attacker: PlayerId, defender: PlayerId) =>
    declareAttackBy(t.engine, attacker, [t.id(body[attacker]!)], { type: "faction", playerId: defender });

  clause(ACC, "0:rule", "3 seats: it triggers on any opponent's attack, whoever is attacked (P2 on P1, P3 on P2, P2 on P3); P1's own attack does not trigger it; each trigger offers a decline", () => {
    for (const [attacker, defender] of [[P2, P1], [P3, P2], [P2, P3], [P3, P1]] as const) {
      const t = accTable(attacker);
      attack(t, attacker, defender);
      const pc = pending(t.engine);
      assert.ok(pc, `${attacker} attacks ${defender}: the Accumulator's controller is asked`);
      assert.equal(pc.playerId, P1);
      assert.equal(pc.kind, "chooserSelectsOption");
      assert.deepEqual((pc.options as Array<{ label: string }>).map((o) => o.label), ["Decline", "Charge"]);
      answer(t.engine, "chooserSelectsOption", { index: 1 });
      assert.equal(tokensOn(t.engine, t.id("a")), 1, `${attacker} on ${defender}: the token is put on it`);
      assert.equal(pending(t.engine), undefined);
    }
    for (const [attacker, defender] of [[P2, P1], [P3, P2]] as const) {
      const t = accTable(attacker);
      attack(t, attacker, defender);
      answer(t.engine, "chooserSelectsOption", { index: 0 });
      assert.equal(tokensOn(t.engine, t.id("a")), 0, "declined: no token");
      assert.equal(pending(t.engine), undefined);
    }
    for (const defender of [P2, P3]) {
      const t = accTable(P1);
      attack(t, P1, defender);
      assert.equal(pending(t.engine), undefined, `P1 attacks ${defender}: no trigger`);
      assert.equal(tokensOn(t.engine, t.id("a")), 0);
    }
  });
}

// =====================================================================================
// Time Traveler Tourist Trap
// =====================================================================================
const TRAP = "03441b15-b428-4453-9d12-89fd64e73c58";

{
  const micromajigs = (t: ReturnType<typeof table>, owner: PlayerId) =>
    Object.values(t.engine.state.cards).filter((c) => c.isToken && c.zone === "play" && c.controllerId === owner && t.engine.getDefinition(c.id).name === "Micromajig");
  const trapTable = (decks: Record<string, number>) =>
    table(3, [
      { key: "trap", def: printing(TRAP), owner: P1, zone: "play", counters: { token: 20 } },
      ...res("elitism", 6, P1),
      ...many("d1-", 10, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...many("d2-", decks[P2]!, P2, "deck", (i) => character({ name: `P2 deck ${i}` })),
      ...many("d3-", decks[P3]!, P3, "deck", (i) => character({ name: `P3 deck ${i}` }))
    ]);

  clause(TRAP, "1:ability:micromajig-apocalypse", "3 seats: P1 names exactly one opponent as the ability is used; X is that opponent's deck size only (P2 25 cards: 25 tokens; P3 22 cards: 22 tokens), never the total", () => {
    for (const [chosen, size] of [[P2, 25], [P3, 22]] as const) {
      const t = trapTable({ [P2]: 25, [P3]: 22 });
      assert.deepEqual(
        askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("trap"), abilityId: "micromajig-apocalypse" }),
        [{ id: "opp", candidates: [P2, P3] }],
        "exactly one opponent is asked, between P2 and P3 (never P1)"
      );
      refused(() => activate(t.engine, P1, t.id("trap"), "micromajig-apocalypse"), "no opponent named");
      activate(t.engine, P1, t.id("trap"), "micromajig-apocalypse", { players: { opp: chosen } });
      assert.equal(zoneOf(t.engine, t.id("trap")), "discard", "the Trap is destroyed as the cost");
      assert.equal(micromajigs(t, P1).length, size, `${chosen} chosen: X is the size of ${chosen}'s deck`);
      assert.equal(micromajigs(t, P2).length + micromajigs(t, P3).length, 0, "the tokens are under P1's control");
      assert.equal(deck(t.engine, P2).length, 25, "no deck is touched");
      assert.equal(deck(t.engine, P3).length, 22);
    }
  });
}

// =====================================================================================
// Ashara, Gideon's Twin
// =====================================================================================
const ASH = "5d139b84-9808-49e5-8779-667c0ae91a29";

{
  const ashTable = () =>
    table(3, [
      { key: "a", def: printing(ASH), owner: P1, zone: "hand" },
      { key: "A", def: character({ name: "A life 3", life: 3 }), owner: P2, zone: "discard" },
      { key: "B", def: character({ name: "B life 2", life: 2 }), owner: P3, zone: "discard" },
      { key: "C", def: character({ name: "C life 4", life: 4 }), owner: P3, zone: "discard" },
      { key: "D", def: character({ name: "D life 1", life: 1 }), owner: P1, zone: "discard" },
      ...res("deception", 4, P1)
    ]);

  clause(ASH, "1:extraCost", "3 seats: the pick is any opponent's discard pile: A (P2, life 3) or B (P3, life 2); C (life 4) and D (own pile) are refused; no opponent is asked for", () => {
    const t = ashTable();
    assert.equal(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("a") }), undefined, "no opponent selection");
    refused(() => play(t.engine, P1, t.id("a"), { selected: { revive: [t.id("C")] } }), "life 4 is too much");
    refused(() => play(t.engine, P1, t.id("a"), { selected: { revive: [t.id("D")] } }), "own discard pile");
    assert.equal(zoneOf(t.engine, t.id("a")), "hand");
    play(t.engine, P1, t.id("a"), { selected: { revive: [t.id("B")] } });
    assert.equal(zoneOf(t.engine, t.id("a")), "play");
    assert.equal(zoneOf(t.engine, t.id("B")), "play", "B left P3's discard pile");
    assert.equal(zoneOf(t.engine, t.id("A")), "discard");
    assert.equal(pending(t.engine), undefined);
    const other = ashTable();
    play(other.engine, P1, other.id("a"), { selected: { revive: [other.id("A")] } });
    assert.equal(zoneOf(other.engine, other.id("A")), "play", "A (from P2's pile) is pickable as well");
    assert.equal(zoneOf(other.engine, other.id("B")), "discard");
  });

  clause(ASH, "2:rule", "3 seats: when Ashara enters play after P1 picked B from P3's discard pile, B enters play under P1's control; P2's discard pile is unchanged", () => {
    const t = ashTable();
    const p2Discard = [...t.engine.state.players[P2]!.discard];
    play(t.engine, P1, t.id("a"), { selected: { revive: [t.id("B")] } });
    assert.equal(zoneOf(t.engine, t.id("B")), "play");
    assert.equal(t.engine.state.cards[t.id("B")]!.controllerId, P1, "under P1's control");
    assert.equal(t.engine.state.cards[t.id("B")]!.ownerId, P3);
    assert.deepEqual([...t.engine.state.players[P2]!.discard], p2Discard);
  });
}

// =====================================================================================
// Essence of Deception
// =====================================================================================
const EOD = "6bccbbec-9b1d-4091-b711-33e05c00446c";

{
  const eodTable = (count: number, extra: CardPlacement[] = []) =>
    table(count, [
      { key: "eod", def: printing(EOD), owner: P1, zone: "hand" },
      ...res("deception", 2, P1),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      ...opponentsOf(count).flatMap((p) => [
        { key: `c-${p}`, def: character({ name: `${p} char`, strength: 1, life: 5, speed: 2 }), owner: p, zone: "play" as const },
        ...many(`d-${p}-`, 5, p, "deck", (i) => character({ name: `${p} deck ${i}` }))
      ]),
      ...extra
    ]);
  const ask = (t: ReturnType<typeof eodTable>, mode: number) => askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("eod"), mode });

  clause(EOD, "0:rule", "3 seats: P1 plays the card and chooses the option; P2 and P3 are not asked anything (options 2 and 3 ask for no opponent at all; option 1 only names one, and only P1 answers prompts)", () => {
    const t = eodTable(3);
    assert.equal(ask(t, 1), undefined, "OPTION 2 asks for no opponent");
    assert.equal(ask(t, 2), undefined, "OPTION 3 asks for no opponent");
    assert.deepEqual(ask(t, 0), [{ id: "opp", candidates: [P2, P3] }], "OPTION 1 names one opponent between P2 and P3 (never P1)");
    play(t.engine, P1, t.id("eod"), { mode: 1, selected: { c: [t.id("mine")] } });
    assert.equal(pending(t.engine), undefined, "nobody is asked anything after OPTION 2");
    const s = eodTable(3);
    play(s.engine, P1, s.id("eod"), { mode: 0, players: { opp: P2 } });
    assert.equal(pending(s.engine)?.playerId, P1, "only P1 answers during OPTION 1");
  });

  for (const count of [3, 4] as const) {
    clause(EOD, "1:option:OPTION 1", `${count} seats: P1 names one opponent with the play; P1 searches only that opponent's deck, the card goes to that opponent's discard pile and only that deck is shuffled; the other opponents' decks and discard piles are untouched`, () => {
      for (const chosen of opponentsOf(count)) {
        const t = eodTable(count);
        assert.deepEqual(ask(t, 0), [{ id: "opp", candidates: opponentsOf(count) }]);
        refused(() => play(t.engine, P1, t.id("eod"), { mode: 0 }), "no opponent named");
        const before = Object.fromEntries(opponentsOf(count).map((p) => [p, { deck: deck(t.engine, p), discard: [...t.engine.state.players[p]!.discard] }]));
        play(t.engine, P1, t.id("eod"), { mode: 0, players: { opp: chosen } });
        const pc = pending(t.engine)!;
        assert.equal(pc.kind, "chooserSelectsTarget");
        assert.equal(pc.playerId, P1, "P1 searches");
        const other = opponentsOf(count).find((p) => p !== chosen)!;
        refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`d-${other}-0`)] }), "another opponent's deck is not searched");
        refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("mine")] }), "not in the chosen opponent's deck");
        const pick = before[chosen]!.deck[2]!;
        answer(t.engine, "chooserSelectsTarget", { selected: [pick] });
        assert.equal(zoneOf(t.engine, pick), "discard");
        assert.deepEqual([...t.engine.state.players[chosen]!.discard], [...before[chosen]!.discard, pick], "in the chosen opponent's discard pile");
        assert.deepEqual([...deck(t.engine, chosen)].sort(), before[chosen]!.deck.filter((c) => c !== pick).sort());
        const reordered = deck(t.engine, chosen).some((c, i) => c !== before[chosen]!.deck.filter((x) => x !== pick)[i]);
        assert.ok(reordered, "the chosen opponent's deck was shuffled");
        for (const p of opponentsOf(count).filter((x) => x !== chosen)) {
          assert.deepEqual(deck(t.engine, p), before[p]!.deck, `${p}'s deck is neither searched nor shuffled`);
          assert.deepEqual([...t.engine.state.players[p]!.discard], before[p]!.discard, `${p}'s discard pile is unchanged`);
        }
        assert.equal(pending(t.engine), undefined);
      }
    });
  }

  clause(EOD, "2:option:OPTION 2", "3 seats: P1 chooses OPTION 2 and picks a character of any player: it gains 1 speed this turn; no opponent selection is offered", () => {
    for (const key of ["mine", `c-${P2}`, `c-${P3}`]) {
      const t = eodTable(3);
      play(t.engine, P1, t.id("eod"), { mode: 1, selected: { c: [t.id(key)] } });
      assert.equal(t.engine.getStat(t.id(key), "speed"), 3, `${key} gained 1 speed`);
      for (const other of ["mine", `c-${P2}`, `c-${P3}`].filter((k) => k !== key)) assert.equal(t.engine.getStat(t.id(other), "speed"), 2, `${other} unchanged`);
      assert.equal(pending(t.engine), undefined);
    }
  });

  clause(EOD, "3:option:OPTION 3", "3 seats: P1 chooses OPTION 3 and picks a character damaged this turn by a P2 card, a P3 card or P1's own card: it is destroyed; an undamaged character is not", () => {
    // the P1 attacker A is damaged by the blocker's controller (P2 or P3); that blocker is damaged by P1's own card
    for (const defender of [P2, P3]) {
      const attackTable = () =>
        eodTable(3, [
          { key: "A", def: character({ name: "A", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
          { key: "B", def: character({ name: "B", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" }
        ]);
      const fightIt = () => {
        const t = attackTable();
        declareAttackBy(t.engine, P1, [t.id("A")], { type: "faction", playerId: defender });
        t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id("B")] });
        autoResolveBattle(t.engine);
        assert.equal(t.engine.state.cards[t.id("A")]!.damage, 1, `A took 1 from ${defender}'s card`);
        assert.equal(t.engine.state.cards[t.id("B")]!.damage, 1, "B took 1 from P1's card");
        return t;
      };
      for (const [key, why] of [["A", `damaged by a ${defender} card`], ["B", "damaged by P1's own card"]] as const) {
        const t = fightIt();
        play(t.engine, P1, t.id("eod"), { mode: 2, selected: { c: [t.id(key)] } });
        assert.equal(zoneOf(t.engine, t.id(key)), "discard", `${key} (${why}) is destroyed`);
        assert.equal(zoneOf(t.engine, t.id("mine")), "play");
      }
      const t = fightIt();
      play(t.engine, P1, t.id("eod"), { mode: 2, selected: { c: [t.id("mine")] } });
      assert.equal(zoneOf(t.engine, t.id("mine")), "play", "an undamaged character is not destroyed");
      assert.equal(zoneOf(t.engine, t.id("A")), "play");
      assert.equal(zoneOf(t.engine, t.id("B")), "play");
    }
  });
}

// =====================================================================================
// Flailing Knife
// =====================================================================================
const KNIFE = "00186a1f-1215-4e64-9163-8f1ff603bbee";

{
  const killer = tactic({
    name: "Knife Killer",
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });
  const knifeTable = (hostKey = "h1") =>
    table(3, [
      { key: "h1", def: character({ name: "P1 host", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "h2", def: character({ name: "P2 host", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "h3", def: character({ name: "P3 host", strength: 2, life: 5, speed: 2 }), owner: P3, zone: "play" },
      { key: "knife", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: hostKey },
      { key: "top", def: character({ name: "Top", cost: 1 }), owner: P1, zone: "deck" },
      ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...many("o2-", 3, P2, "deck", (i) => character({ name: `P2 deck ${i}` })),
      ...many("o3-", 3, P3, "deck", (i) => character({ name: `P3 deck ${i}` })),
      { key: "killer", def: killer, owner: P1, zone: "hand" }
    ]);

  clause(KNIFE, "1:rule", "3 seats: the attached character gains 2 strength whoever controls it (P1's, P2's or P3's host) and only while attached", () => {
    for (const host of ["h1", "h2", "h3"]) {
      const t = knifeTable(host);
      for (const key of ["h1", "h2", "h3"]) assert.equal(t.engine.getStat(t.id(key), "strength"), key === host ? 4 : 2, `${key} with the knife on ${host}`);
      play(t.engine, P1, t.id("killer"), { selected: { t: [t.id("knife")] } });
      assert.equal(zoneOf(t.engine, t.id("knife")), "discard");
      assert.equal(t.engine.getStat(t.id(host), "strength"), 2, "the bonus ends once the knife has left play");
      const pc = pending(t.engine)!;
      answer(t.engine, "chooserSelectsOption", { index: (pc.options as Array<{ label: string }>).findIndex((o) => o.label === "Decline") });
    }
  });

  clause(KNIFE, "2:rule", "3 seats: the knife goes to P1's discard pile from play and P1 chooses a card type; P1's top card is revealed to all; on a hit the knife enters play attached to any character (P3's here); the top card goes to the bottom of P1's deck; P2's and P3's decks are untouched", () => {
    const t = knifeTable("h1");
    const mine = deck(t.engine, P1);
    const p2Deck = deck(t.engine, P2);
    const p3Deck = deck(t.engine, P3);
    assert.equal(mine[0], t.id("top"));
    play(t.engine, P1, t.id("killer"), { selected: { t: [t.id("knife")] } });
    assert.equal(zoneOf(t.engine, t.id("knife")), "discard");
    const pc = pending(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsOption");
    assert.equal(pc.playerId, P1, "P1 chooses the card type");
    const index = (pc.options as Array<{ label: string }>).findIndex((o) => o.label === "character");
    answer(t.engine, "chooserSelectsOption", { index });
    const reveal = t.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").map((e) => e.event as unknown as { cardIds: string[]; viewerId: string });
    assert.deepEqual(reveal.map((e) => e.cardIds), [[t.id("top")]], "exactly P1's top card is revealed");
    assert.equal(reveal[0]!.viewerId, "all", "P2 and P3 both see it");
    const host = pending(t.engine)!;
    assert.equal(host.kind, "chooserSelectsTarget");
    assert.equal(host.playerId, P1);
    answer(t.engine, "chooserSelectsTarget", { selected: [t.id("h3")] });
    assert.equal(zoneOf(t.engine, t.id("knife")), "play");
    assert.equal(t.engine.state.cards[t.id("knife")]!.attachedTo, t.id("h3"), "attached to P3's character");
    assert.equal(t.engine.getStat(t.id("h3"), "strength"), 4);
    const after = deck(t.engine, P1);
    assert.equal(after[after.length - 1], t.id("top"), "P1's top card went on the bottom of P1's deck");
    assert.deepEqual(after.slice(0, -1), mine.slice(1));
    assert.deepEqual(deck(t.engine, P2), p2Deck, "P2's deck untouched");
    assert.deepEqual(deck(t.engine, P3), p3Deck, "P3's deck untouched");
    assert.equal(pending(t.engine), undefined);
  });
}

// =====================================================================================
// Gambling Den
// =====================================================================================
const DEN = "0a6c2548-8c2a-4352-a8ea-b97257aa2ac7";

for (const count of [3, 4] as const) {
  const denTable = (topCost: number) =>
    table(
      count,
      [
        { key: "den", def: printing(DEN), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top", cost: topCost }), owner: P1, zone: "deck" },
        ...many("m-", 4, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
        ...seats(count).flatMap((p) => [
          ...many(`rs-${p}-`, 1, p, "hand", () => resourceCard({ name: `${p} resource` })),
          ...(p === P1 ? [] : many(`o-${p}-`, 4, p, "deck", (i) => character({ name: `${p} deck ${i}` })))
        ])
      ],
      seats(count)[count - 1]
    );
  const toP1Turn = (t: ReturnType<typeof denTable>) => endTurn(t.engine, seats(count)[count - 1]!);

  clause(DEN, "0:rule", `${count} seats: at the start of P1's turn the top card of P1's deck is revealed to all; cost 3 or less: P1, then each opponent in seat order, may draw a card, each accepting or declining on their own`, () => {
    const t = denTable(3);
    const decksBefore = Object.fromEntries(seats(count).map((p) => [p, deck(t.engine, p)]));
    const handsBefore = Object.fromEntries(seats(count).map((p) => [p, hand(t.engine, p).length]));
    toP1Turn(t);
    const reveals = t.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").map((e) => e.event as unknown as { cardIds: string[]; viewerId: string });
    assert.deepEqual(reveals.map((e) => e.cardIds), [[t.id("top")]], "P1's top card, once");
    assert.equal(reveals[0]!.viewerId, "all");
    const accepting = new Set([P1, P3]);
    for (const p of seats(count)) {
      const pc = pending(t.engine);
      assert.ok(pc, `${p} is offered the draw`);
      assert.equal(pc.kind, "chooserSelectsOption");
      assert.equal(pc.playerId, p, "seat order, P1 first");
      const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
      assert.ok(labels.includes("Draw") && !labels.includes("Play a resource"));
      answer(t.engine, "chooserSelectsOption", { index: labels.indexOf(accepting.has(p) ? "Draw" : "Decline") });
    }
    assert.equal(pending(t.engine), undefined);
    for (const p of seats(count)) {
      const drew = accepting.has(p) ? 1 : 0;
      assert.equal(hand(t.engine, p).length, handsBefore[p]! + drew, `${p} ${drew ? "drew" : "declined"}`);
      if (drew) assert.ok(hand(t.engine, p).includes(decksBefore[p]![0]!), "from the top of their own deck");
    }
  });

  clause(DEN, "0:rule", `${count} seats: cost 4 or more: P1, then each opponent in seat order, may play a resource instead (nobody draws)`, () => {
    const t = denTable(5);
    const handsBefore = Object.fromEntries(seats(count).map((p) => [p, hand(t.engine, p).length]));
    const playBefore = Object.fromEntries(seats(count).map((p) => [p, t.engine.state.players[p]!.play.length]));
    toP1Turn(t);
    const asked: PlayerId[] = [];
    for (const p of seats(count)) {
      const pc = pending(t.engine);
      assert.ok(pc, `${p} is offered a resource play`);
      assert.equal(pc.playerId, p, "seat order, P1 first");
      asked.push(pc.playerId as PlayerId);
      const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
      assert.ok(labels.includes("Play a resource") && !labels.includes("Draw"));
      answer(t.engine, "chooserSelectsOption", { index: labels.indexOf(p === P2 ? "Decline" : "Play a resource") });
      // a "play a resource" asks which card of the player's hand and its face
      let guard = 0;
      while (pending(t.engine) && pending(t.engine)!.playerId === p && guard++ < 4) {
        const next = pending(t.engine)!;
        if (next.kind === "chooserSelectsTarget") answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`rs-${p}-0`)] });
        else if (next.kind === "playResource") answer(t.engine, "playResource", { faceDown: false });
        else break;
      }
    }
    assert.deepEqual(asked, seats(count));
    assert.equal(pending(t.engine), undefined);
    for (const p of seats(count)) {
      const played = p === P2 ? 0 : 1;
      assert.equal(t.engine.state.players[p]!.play.length, playBefore[p]! + played, `${p} ${played ? "played" : "did not play"} a resource`);
      assert.equal(hand(t.engine, p).length, handsBefore[p]! - played, `${p}'s hand`);
    }
  });
}

// =====================================================================================
// Heist Training Grounds
// =====================================================================================
const HTG = "6da2fd15-6bc5-4b73-b21c-d281e6b9b544";

{
  type Seen = { kind: string; playerId: string; abilityId?: string; candidates?: PlayerId[]; declaration?: { id: string } };
  const htgTable = (dCount: number) =>
    table(
      3,
      [
        { key: "htg", def: printing(HTG), owner: P1, zone: "play" },
        ...res("deception", dCount, P1),
        { key: "c1", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
        { key: "c2", def: character({ name: "P2 char" }), owner: P2, zone: "play" },
        { key: "c3", def: character({ name: "P3 char" }), owner: P3, zone: "play" },
        ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
        ...[P2, P3].flatMap((p) => [
          ...many(`d-${p}-`, 5, p, "deck", (i) => character({ name: `${p} deck ${i}` })),
          ...many(`h-${p}-`, 4, p, "hand", (i) => character({ name: `${p} hand ${i}` }))
        ])
      ],
      P3
    );
  /** Ends P3's turn so that P1's turn starts, answering every prompt with `choose` (declining what it does not answer); returns what was asked. */
  const startP1Turn = (t: ReturnType<typeof htgTable>, choose: (pc: Seen) => Record<string, unknown> | undefined): Seen[] => {
    const seen: Seen[] = [];
    endTurn(t.engine, P3);
    drain(t.engine, (pc) => {
      seen.push(pc as unknown as Seen);
      if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
      return { kind: pc.kind, ...(choose(pc as unknown as Seen) ?? (declineAll(pc) as object)) };
    });
    return seen;
  };
  const noPick = () => ({ selected: [] });

  clause(HTG, "1:rule@ddd", "3 seats: at the start of P1's turn (with [D][D][D]) P1 may pick a character of any player: it gains COVERT this turn; P2 and P3 are asked nothing", () => {
    for (const key of ["c1", "c2", "c3"]) {
      const t = htgTable(3);
      const seen = startP1Turn(t, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id(key)] } : undefined));
      assert.deepEqual(seen.map((s) => [s.kind, s.playerId]), [["chooserSelectsTarget", P1]], "only P1 is asked, only for the pick");
      assert.ok(t.engine.getKeywords(t.id(key)).includes("covert" as never), `${key} gained COVERT`);
      for (const other of ["c1", "c2", "c3"].filter((k) => k !== key)) assert.ok(!t.engine.getKeywords(t.id(other)).includes("covert" as never), `${other} did not`);
    }
  });

  clause(HTG, "2:rule@ddddd", "3 seats: with [D] x5, P1 chooses the opponent (P2 or P3 only), searches only that opponent's deck for a card and puts it into that opponent's discard pile; that deck is shuffled; the other opponent's deck and discard pile are unchanged", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = htgTable(5);
      const chosenDeck = deck(t.engine, chosen);
      const otherDeck = deck(t.engine, other);
      const seen = startP1Turn(t, (pc) => {
        if (pc.kind === "choosePlayer") return { playerId: chosen };
        if (pc.kind === "chooserSelectsTarget" && pc.declaration?.id !== "c") return { selected: [chosenDeck[1]!] };
        return undefined;
      });
      const asks = seen.filter((s) => s.kind === "choosePlayer");
      assert.equal(asks.length, 1, "exactly one opponent is chosen");
      assert.equal(asks[0]!.playerId, P1);
      assert.deepEqual([...asks[0]!.candidates!].sort(), [P2, P3], "P1 is never offered");
      assert.ok(seen.every((s) => s.playerId === P1), "only P1 answers prompts");
      assert.equal(zoneOf(t.engine, chosenDeck[1]!), "discard");
      assert.deepEqual([...t.engine.state.players[chosen]!.discard], [chosenDeck[1]!], "in the chosen opponent's discard pile");
      const rest = chosenDeck.filter((c) => c !== chosenDeck[1]);
      assert.deepEqual(deck(t.engine, chosen).slice().sort(), rest.slice().sort());
      assert.ok(deck(t.engine, chosen).some((c, i) => c !== rest[i]), "the chosen opponent's deck was shuffled");
      assert.deepEqual(deck(t.engine, other), otherDeck, "the other opponent's deck is untouched (not shuffled)");
      assert.equal(t.engine.state.players[other]!.discard.length, 0);
    }
  });

  clause(HTG, "2:rule@ddddd", "3 seats: the search can only pick cards of the chosen opponent's deck", () => {
    const t = htgTable(5);
    const p2Deck = deck(t.engine, P2);
    const p3Deck = deck(t.engine, P3);
    let tried = false;
    startP1Turn(t, (pc) => {
      if (pc.kind === "choosePlayer") return { playerId: P2 };
      if (pc.kind === "chooserSelectsTarget" && pc.declaration?.id !== "c") {
        tried = true;
        refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [p3Deck[0]!] }), "P3's card while P2 is chosen");
        return { selected: [p2Deck[0]!] };
      }
      return undefined;
    });
    assert.ok(tried);
    assert.equal(zoneOf(t.engine, p2Deck[0]!), "discard");
    assert.equal(zoneOf(t.engine, p3Deck[0]!), "deck");
  });

  clause(HTG, "3:rule@ddddddd", "3 seats: with [D] x7, P1 chooses one opponent (P2 or P3 only); a card of that opponent's hand chosen at random is discarded (no choice for them); the other opponent's hand is unchanged", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = htgTable(7);
      const handBefore = hand(t.engine, chosen);
      const otherHand = hand(t.engine, other);
      const seen = startP1Turn(t, (pc) => {
        if (pc.kind === "choosePlayer") return pc.abilityId === "t7" ? { playerId: chosen } : { playerId: other };
        if (pc.kind === "chooserSelectsTarget" && pc.declaration?.id === "c") return noPick();
        if (pc.kind === "chooserSelectsTarget" && pc.declaration?.id === "__so") return noPick();
        return undefined;
      });
      const t7 = seen.filter((s) => s.kind === "choosePlayer" && s.abilityId === "t7");
      assert.equal(t7.length, 1, "exactly one opponent is chosen for the discard");
      assert.equal(t7[0]!.playerId, P1);
      assert.deepEqual([...t7[0]!.candidates!].sort(), [P2, P3]);
      assert.ok(seen.every((s) => s.playerId === P1), "the chosen opponent makes no choice (random)");
      const left = hand(t.engine, chosen);
      assert.equal(left.length, handBefore.length - 1, "one card of the chosen opponent's hand was discarded");
      const gone = handBefore.find((c) => !left.includes(c))!;
      assert.equal(zoneOf(t.engine, gone), "discard");
      assert.deepEqual(hand(t.engine, other), otherHand, "the other opponent's hand is unchanged");
    }
  });
}

// =====================================================================================
// I Drink Your Milkshake!
// =====================================================================================
const MILK = "83807d38-2e87-4c3e-9167-5488979e4267";

{
  const foo = (cost = 0) => character({ name: "Foo", cost, strength: 1, life: 2, speed: 1 });
  const milkTable = () =>
    table(3, [
      { key: "milk", def: printing(MILK), owner: P1, zone: "hand" },
      ...res("deception", 4, P1),
      ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...[P2, P3].flatMap((p) => [
        { key: `foo-${p}`, def: foo(), owner: p, zone: "deck" as const },
        ...many(`d-${p}-`, 4, p, "deck", (i) => character({ name: `${p} deck ${i}` })),
        { key: `hfoo-${p}`, def: foo(), owner: p, zone: "hand" as const }
      ])
    ]);
  const advanceTo = (t: ReturnType<typeof milkTable>, who: PlayerId) => {
    for (let guard = 0; guard < 6 && t.engine.state.activePlayerId !== who; guard++) endTurn(t.engine, t.engine.state.activePlayerId as PlayerId);
    assert.equal(t.engine.state.activePlayerId, who);
  };

  clause(MILK, "0:rule", "3 seats: P1 names one opponent with the play and searches only that opponent's deck: the card goes to the void face-down and only that deck is shuffled; another opponent's deck cannot be searched", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = milkTable();
      assert.deepEqual(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("milk") }), [{ id: "opp", candidates: [P2, P3] }]);
      refused(() => play(t.engine, P1, t.id("milk"), { selected: { dig: [t.id(`foo-${chosen}`)] } }), "no opponent named");
      refused(() => play(t.engine, P1, t.id("milk"), { players: { opp: chosen }, selected: { dig: [t.id(`foo-${other}`)] } }), "another opponent's deck");
      const chosenDeck = deck(t.engine, chosen).filter((c) => c !== t.id(`foo-${chosen}`));
      const otherDeck = deck(t.engine, other);
      play(t.engine, P1, t.id("milk"), { players: { opp: chosen }, selected: { dig: [t.id(`foo-${chosen}`)] } });
      const voided = t.engine.state.cards[t.id(`foo-${chosen}`)]!;
      assert.equal(voided.zone, "void");
      assert.equal(voided.faceDown, true);
      assert.deepEqual(deck(t.engine, chosen).slice().sort(), chosenDeck.slice().sort());
      assert.ok(deck(t.engine, chosen).some((c, i) => c !== chosenDeck[i]), "the chosen opponent's deck was shuffled");
      assert.deepEqual(deck(t.engine, other), otherDeck, "the other opponent's deck is neither searched nor shuffled");
      assert.equal(pending(t.engine), undefined);
    }
  });

  clause(MILK, "0:rule", "3 seats: for the rest of the game only the opponent whose deck was searched triggers it: with P2 chosen, P3 deploying 'Foo' does nothing and P2 deploying 'Foo' lets P1 reveal and deploy the voided 'Foo' free, terminating P2's card; with P3 chosen it is the other way round", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = milkTable();
      play(t.engine, P1, t.id("milk"), { players: { opp: chosen }, selected: { dig: [t.id(`foo-${chosen}`)] } });
      // the opponent who was not searched deploys "Foo": nothing happens for P1
      advanceTo(t, other);
      play(t.engine, other, t.id(`hfoo-${other}`));
      assert.equal(zoneOf(t.engine, t.id(`hfoo-${other}`)), "play");
      assert.equal(pending(t.engine), undefined, `${other} deploying Foo does not trigger it (no prompt at all)`);
      assert.equal(zoneOf(t.engine, t.id(`foo-${chosen}`)), "void");
      // the searched opponent deploys "Foo"
      advanceTo(t, chosen);
      play(t.engine, chosen, t.id(`hfoo-${chosen}`));
      const pc = pending(t.engine)!;
      assert.ok(pc, `${chosen} deploying Foo triggers it`);
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P1);
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`foo-${chosen}`)] });
      assert.equal(pending(t.engine)?.kind, "deployForFree");
      answer(t.engine, "deployForFree", { cardId: t.id(`foo-${chosen}`) });
      assert.equal(zoneOf(t.engine, t.id(`foo-${chosen}`)), "play", "deployed");
      assert.equal(t.engine.state.cards[t.id(`foo-${chosen}`)]!.controllerId, P1, "under P1's control");
      assert.equal(zoneOf(t.engine, t.id(`hfoo-${chosen}`)), "discard", "the searched opponent's card is terminated");
      assert.equal(zoneOf(t.engine, t.id(`hfoo-${other}`)), "play", "the other opponent's card stays");
    }
  });
}

// =====================================================================================
// Lecram, Silent Advisor
// =====================================================================================
const LECRAM = "52575cdb-9125-474c-8dea-0506f28f8ee0";

{
  /** `table` with a chosen random source (the coin flip is `random() < 0.5`). */
  const coinTable = (cards: CardPlacement[], random: () => number) => {
    const built = buildGame({
      playerA: { faction: noDevelopFaction() },
      playerB: { faction: noDevelopFaction() },
      extraPlayers: [{ faction: noDevelopFaction() }],
      activePlayerId: P1,
      turn: 1,
      random,
      cards
    });
    return { engine: built.engine, id: built.id };
  };
  const lecramCards = (): CardPlacement[] => [
    { key: "lec", def: printing(LECRAM), owner: P1, zone: "play" },
    ...many("a-", 4, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
    ...many("b-", 4, P2, "deck", (i) => character({ name: `P2 deck ${i}` })),
    ...many("c-", 4, P3, "deck", (i) => character({ name: `P3 deck ${i}` }))
  ];
  const coinFlips = (engine: ReturnType<typeof coinTable>["engine"]) =>
    engine.getLog().filter((e) => e.event?.type === "coinFlipped").map((e) => ({ playerId: (e.event as unknown as { playerId: string }).playerId, won: (e.event as unknown as { won: boolean }).won }));

  clauseMismatch(LECRAM, "2:rule", "MP-seed-saga-301", "3 seats: at the end of P1's turn only P1 flips a coin; on a win P1 chooses P2 or P3 and looks at the top card of that player's deck only (never the other deck); on a loss P1 looks at nothing", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = coinTable(lecramCards(), () => 0);
      const decks = Object.fromEntries([P1, P2, P3].map((p) => [p, deck(t.engine, p)]));
      endTurn(t.engine, P1);
      assert.deepEqual(coinFlips(t.engine), [{ playerId: P1, won: true }], "only P1 flips, once, and wins");
      const ask = pending(t.engine)!;
      assert.ok(ask, "P1 is asked which opponent's deck to look at");
      assert.equal(ask.kind, "choosePlayer");
      assert.equal(ask.playerId, P1);
      assert.deepEqual([...(ask.candidates as PlayerId[])].sort(), [P2, P3], "P1 is never offered");
      choosePlayer(t.engine, chosen);
      const look = pending(t.engine)!;
      assert.ok(look, "P1 looks at the top card");
      assert.equal(look.kind, "reorderDeck");
      assert.equal(look.playerId, P1, "P1 is the one who sees it");
      assert.equal(look.deckOwnerId, chosen, "the chosen opponent's deck");
      assert.deepEqual(look.cardIds, [decks[chosen]![0]!], "only the top card of that deck");
      answer(t.engine, "reorderDeck", { order: [decks[chosen]![0]!] });
      assert.equal(pending(t.engine), undefined);
      for (const p of [P1, P2, P3]) assert.deepEqual(deck(t.engine, p), decks[p], `${p}'s deck keeps its order`);
      assert.ok(other);
    }
    const lost = coinTable(lecramCards(), () => 0.99);
    endTurn(lost.engine, P1);
    assert.deepEqual(coinFlips(lost.engine), [{ playerId: P1, won: false }]);
    assert.equal(pending(lost.engine), undefined, "a loss: nobody is asked, nothing is looked at");
  });
}

// =====================================================================================
// Lucky Bastard
// =====================================================================================
const LUCKY = "4513085a-6185-4ef5-ba9c-7af3c3af30d4";

{
  const killer = tactic({
    name: "Bastard Killer",
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });

  clause(LUCKY, "0:rule", "3 seats: when Lucky Bastard enters play P1 draws a card; P2 and P3 draw nothing", () => {
    const t = table(3, [
      { key: "lb", def: printing(LUCKY), owner: P1, zone: "hand" },
      ...res("deception", 7, P1),
      ...seats(3).flatMap((p) => many(`d-${p}-`, 3, p, "deck", (i) => character({ name: `${p} deck ${i}` })))
    ]);
    const decks = Object.fromEntries(seats(3).map((p) => [p, deck(t.engine, p)]));
    const handsBefore = Object.fromEntries(seats(3).map((p) => [p, hand(t.engine, p).length]));
    play(t.engine, P1, t.id("lb"));
    assert.equal(zoneOf(t.engine, t.id("lb")), "play");
    assert.equal(pending(t.engine), undefined);
    assert.equal(hand(t.engine, P1).length, handsBefore[P1]! - 1 + 1, "P1 drew one card (and spent the Bastard from hand)");
    assert.ok(hand(t.engine, P1).includes(decks[P1]![0]!));
    for (const p of [P2, P3]) {
      assert.equal(hand(t.engine, p).length, handsBefore[p], `${p} drew nothing`);
      assert.deepEqual(deck(t.engine, p), decks[p]);
    }
  });

  for (const [count, scenarios] of [
    [3, [[[5, 4, 5], true], [[5, 4, 6], false], [[5, 3, 3], true], [[5, 6, 2], false]]],
    [4, [[[5, 4, 5, 3], true], [[5, 4, 3, 6], false], [[5, 5, 5, 5], true]]]
  ] as Array<[3 | 4, Array<[number[], boolean]>]>) {
    clause(LUCKY, "1:rule", `${count} seats: if it would be destroyed every player removes the top card of their own deck from the game; P1's card cost must be at least EVERY opponent's removed card cost (never summed, never against one opponent only): then P1 draws and the damage becomes 0, otherwise Lucky Bastard is removed from the game`, () => {
      for (const [costs, survives] of scenarios) {
        const t = table(count, [
          { key: "lb", def: printing(LUCKY), owner: P1, zone: "play", damage: 2 },
          { key: "killer", def: killer, owner: P1, zone: "hand" },
          ...seats(count).flatMap((p, i) => [
            { key: `top-${p}`, def: character({ name: `${p} top`, cost: costs[i]! }), owner: p, zone: "deck" as const },
            ...many(`d-${p}-`, 3, p, "deck", (n) => character({ name: `${p} deck ${n}`, cost: 0 }))
          ])
        ]);
        const handBefore = hand(t.engine, P1).length;
        const decksBefore = Object.fromEntries(seats(count).map((p) => [p, deck(t.engine, p)]));
        play(t.engine, P1, t.id("killer"), { selected: { t: [t.id("lb")] } });
        const label = `costs ${costs.join("/")}`;
        for (const p of seats(count)) assert.equal(zoneOf(t.engine, t.id(`top-${p}`)), "removed", `${label}: ${p}'s top card was removed from the game`);
        for (const p of seats(count)) assert.deepEqual(deck(t.engine, p), decksBefore[p]!.slice(p === P1 && survives ? 2 : 1), `${label}: only the top card of ${p}'s deck is gone${p === P1 && survives ? " (and the card P1 drew)" : ""}`);
        if (survives) {
          assert.equal(zoneOf(t.engine, t.id("lb")), "play", `${label}: it survives`);
          assert.equal(t.engine.state.cards[t.id("lb")]!.damage ?? 0, 0, `${label}: damage reduced to 0`);
          assert.equal(hand(t.engine, P1).length, handBefore - 1 + 1, `${label}: P1 drew a card (the killer left the hand)`);
        } else {
          assert.equal(zoneOf(t.engine, t.id("lb")), "removed", `${label}: removed from the game`);
          assert.equal(hand(t.engine, P1).length, handBefore - 1, `${label}: no card drawn`);
        }
      }
    });
  }
}

// =====================================================================================
// Lucky Charm
// =====================================================================================
const CHARM = "9db2e287-ca92-4304-814f-10b7eb99ef4b";

{
  const hit = tactic({
    name: "Charm Hit",
    cost: 0,
    behavior: { abilities: [{ id: "hit", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } as never
  });

  clause(CHARM, "0:rule", "3 seats: when Lucky Charm enters play P1 draws a card; P2 and P3 draw nothing", () => {
    const t = table(3, [
      { key: "charm", def: printing(CHARM), owner: P1, zone: "hand" },
      ...res("deception", 2, P1),
      ...seats(3).flatMap((p) => many(`d-${p}-`, 3, p, "deck", (i) => character({ name: `${p} deck ${i}` })))
    ]);
    const decks = Object.fromEntries(seats(3).map((p) => [p, deck(t.engine, p)]));
    play(t.engine, P1, t.id("charm"));
    assert.equal(zoneOf(t.engine, t.id("charm")), "play");
    assert.deepEqual(hand(t.engine, P1), [decks[P1]![0]!]);
    for (const p of [P2, P3]) {
      assert.equal(hand(t.engine, p).length, 0, `${p} drew nothing`);
      assert.deepEqual(deck(t.engine, p), decks[p]);
    }
  });

  for (const count of [3, 4] as const) {
    clause(CHARM, "1:rule", `${count} seats: every opponent of P1 must pay 1 to pick a character P1 controls; P1 picking its own character pays nothing; opponents picking each other's characters pay nothing`, () => {
      const board = (picker: PlayerId) =>
        table(
          count,
          [
            { key: "charm", def: printing(CHARM), owner: P1, zone: "play" },
            ...seats(count).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char`, life: 6 }), owner: p, zone: "play" as const })),
            { key: "hit", def: hit, owner: picker, zone: "hand" },
            ...res("rage", 3, picker)
          ],
          picker
        );
      const cost = (picker: PlayerId, victim: PlayerId): number => {
        const t = board(picker);
        const before = t.engine.getAvailableResourceCount(picker);
        play(t.engine, picker, t.id("hit"), { selected: { t: [t.id(`c-${victim}`)] } });
        assert.equal(t.engine.state.cards[t.id(`c-${victim}`)]!.damage, 1, `${picker}'s pick of ${victim}'s character landed`);
        return before - t.engine.getAvailableResourceCount(picker);
      };
      for (const picker of opponentsOf(count)) {
        assert.equal(cost(picker, P1), 1, `${picker} pays 1 to pick P1's character`);
        for (const other of opponentsOf(count).filter((p) => p !== picker)) assert.equal(cost(picker, other), 0, `${picker} picking ${other}'s character pays nothing`);
        assert.equal(cost(picker, picker), 0, `${picker} picking its own character pays nothing`);
        const broke = table(count, [
          { key: "charm", def: printing(CHARM), owner: P1, zone: "play" },
          { key: "c1", def: character({ name: "P1 char", life: 6 }), owner: P1, zone: "play" },
          { key: "hit", def: hit, owner: picker, zone: "hand" }
        ], picker);
        refused(() => play(broke.engine, picker, broke.id("hit"), { selected: { t: [broke.id("c1")] } }), `${picker} cannot pay the 1`);
      }
      assert.equal(cost(P1, P1), 0, "P1 picking its own character pays nothing");
      if (count === 3) assert.equal(cost(P1, P2), 0, "P1 picking an opponent's character pays nothing");
    });
  }
}

// =====================================================================================
// Mistaken Identity
// =====================================================================================
const MISTAKEN = "da95244d-134d-4648-bb5d-c4e1e4fbd6ff";

{
  const pickHit = tactic({
    name: "Pick Hit",
    cost: 0,
    behavior: { abilities: [{ id: "hit", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] } as never
  });
  const miTable = (caster: PlayerId) =>
    table(
      3,
      [
        { key: "mi", def: printing(MISTAKEN), owner: P1, zone: "hand" },
        ...res("deception", 2, P1),
        { key: "orig", def: pickHit, owner: caster, zone: "hand" },
        ...seats(3).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char`, life: 6 }), owner: p, zone: "play" as const }))
      ],
      caster
    );
  const dmg = (t: ReturnType<typeof miTable>, key: string): number => t.engine.state.cards[t.id(key)]!.damage ?? 0;

  clause(MISTAKEN, "1:rule", "3 seats: when P3 (or P2) plays a card that picked P2's character as a cost and P1 responds with Mistaken Identity picking another character, the card's effect happens as though its own controller had picked the other one; P1 is not asked to choose an opponent", () => {
    for (const caster of [P3, P2]) {
      for (const [picked, other] of [[P2, P1], [P2, P3], [P1, P2]] as Array<[PlayerId, PlayerId]>) {
        const t = miTable(caster);
        assert.equal(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("mi") }), undefined, "no opponent is asked for");
        t.engine.perform({ type: "playCard", playerId: caster, cardId: t.id("orig"), selected: { t: [t.id(`c-${picked}`)] }, variables: {} } as never);
        // pass priority until P1 holds it (P1 is the responder)
        for (let guard = 0; guard < 3 && t.engine.state.responseWindow?.priorityPlayerId !== P1; guard++) {
          t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
        }
        assert.equal(t.engine.state.responseWindow?.priorityPlayerId, P1, "P1 can respond");
        t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("mi"), selected: { other: [t.id(`c-${other}`)] }, variables: {} } as never);
        assert.equal(pending(t.engine), undefined, "no opponent selection is offered to P1");
        for (let guard = 0; guard < 8 && (t.engine.state.responseStack.length > 0 || t.engine.state.responseWindow); guard++) {
          if (pending(t.engine)) break;
          const win = t.engine.state.responseWindow;
          if (win?.phase === "acceptingResponses") t.engine.perform({ type: "passPriority", playerId: win.priorityPlayerId } as never);
          else t.engine.perform({ type: "advanceFlow" } as never);
        }
        assert.equal(pending(t.engine), undefined);
        assert.equal(zoneOf(t.engine, t.id("orig")), "discard", `${caster}'s card resolved`);
        assert.equal(dmg(t, `c-${other}`), 3, `${caster} picked ${picked}'s character, the effect hit ${other}'s instead`);
        for (const p of seats(3).filter((x) => x !== other)) assert.equal(dmg(t, `c-${p}`), 0, `${p}'s character is untouched`);
      }
    }
  });
}

// =====================================================================================
// Mustache Aficionado
// =====================================================================================
const MUSTACHE = "f276a0be-6c30-4276-a743-30e63619dc41";

{
  const costsOf: Record<string, number[]> = { [P1]: [5, 1, 1, 2, 2, 3], [P2]: [2, 2, 0, 1, 1, 1], [P3]: [4, 0, 3, 1, 1, 2], [P4]: [6, 6, 6, 1, 1, 1] };
  const mustacheTable = (count: number) =>
    table(count, [
      { key: "ma", def: printing(MUSTACHE), owner: P1, zone: "play" },
      ...seats(count).flatMap((p) => costsOf[p]!.map((cost, i) => ({ key: `${p}-${i}`, def: character({ name: `${p} card ${i}`, cost }), owner: p, zone: "deck" as const })))
    ]);

  for (const count of [3, 4] as const) {
    const run = (chosen: PlayerId) => {
      const t = mustacheTable(count);
      const decks = Object.fromEntries(seats(count).map((p) => [p, deck(t.engine, p)]));
      const asked = askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("ma"), abilityId: "mustache-showdown" });
      if (asked) {
        assert.deepEqual(asked, [{ id: asked[0]!.id, candidates: opponentsOf(count) }], "one opponent is named, between the real opponents only (never P1)");
        activate(t.engine, P1, t.id("ma"), "mustache-showdown", { players: { [asked[0]!.id]: chosen } });
      } else {
        // the opponent may instead be chosen by a prompt as the ability resolves
        activate(t.engine, P1, t.id("ma"), "mustache-showdown");
        const ask = pending(t.engine);
        assert.ok(ask, "one opponent is chosen");
        assert.equal(ask.kind, "choosePlayer");
        assert.equal(ask.playerId, P1);
        assert.deepEqual([...(ask.candidates as PlayerId[])].sort(), opponentsOf(count), "between the real opponents only (never P1)");
        choosePlayer(t.engine, chosen);
      }
      assert.equal(t.engine.state.cards[t.id("ma")]!.depleted, true, "the cost depletes it");
      const seen: Array<[string, string]> = [];
      const step = (kind: string, who: PlayerId, choice: Record<string, unknown>) => {
        const pc = pending(t.engine)!;
        assert.ok(pc, `${kind} for ${who} expected`);
        assert.equal(pc.kind, kind);
        assert.equal(pc.playerId, who);
        seen.push([kind, pc.playerId]);
        answer(t.engine, kind, choice);
      };
      const top = (p: PlayerId) => decks[p]!.slice(0, 3);
      const pc1 = pending(t.engine)!;
      assert.equal(pc1.kind, "partitionCards");
      assert.deepEqual(pc1.cardIds, top(P1), "P1 divides P1's own top 3");
      step("partitionCards", P1, { piles: [[top(P1)[0]!], [top(P1)[1]!, top(P1)[2]!]] });
      const pc2 = pending(t.engine)!;
      assert.equal(pc2.playerId, chosen, "then the chosen opponent divides their own top 3");
      assert.deepEqual(pc2.cardIds, top(chosen), "the chosen opponent's top 3");
      step("partitionCards", chosen, { piles: [[top(chosen)[0]!], [top(chosen)[1]!, top(chosen)[2]!]] });
      step("pickPile", P1, { index: 0 });
      step("pickPile", chosen, { index: 0 });
      drain(t.engine, (pc) => (pc.kind === "takeFromPile" ? { kind: "takeFromPile", cardIds: [] } : declineAll(pc)));
      assert.ok(seen.every(([, who]) => who === P1 || who === chosen), "no other opponent is asked anything");
      for (const p of opponentsOf(count).filter((x) => x !== chosen)) {
        assert.deepEqual(deck(t.engine, p), decks[p], `${p} is not involved: its deck is not looked at or shuffled, keeping its order`);
        assert.equal(hand(t.engine, p).length, 0);
      }
    };
    clause(MUSTACHE, "0:ability:mustache-showdown", `${count} seats: P1 activates MUSTACHE SHOWDOWN and names one opponent; only P1 and that opponent look at their own top 3, divide them, and choose a pile of the other; the remaining opponents are not involved and their decks are not touched`, () => {
      for (const chosen of opponentsOf(count)) run(chosen);
    });
  }
}

// =====================================================================================
// Pant Swipe
// =====================================================================================
const SWIPE = "3a9ab0e7-b3f3-4956-8f82-be8f0916a9da";

{
  const swipeTable = () =>
    table(3, [
      { key: "ps", def: printing(SWIPE), owner: P1, zone: "hand" },
      ...res("deception", 3, P1),
      ...res("rage", 6, P1),
      ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...[P2, P3].flatMap((p) => [
        ...many(`t-${p}-`, 6, p, "deck", (i) => character({ name: `${p} loot ${i}`, cost: 1, threshold: "ee" })),
        ...res("rage", 3, p)
      ])
    ]);

  clause(SWIPE, "0:rule", "3 seats: P1 names one opponent with the play; the top 4 cards of that opponent's deck go into the void face-down; the other opponent's deck is unchanged", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = swipeTable();
      assert.deepEqual(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("ps") }), [{ id: "opp", candidates: [P2, P3] }]);
      refused(() => play(t.engine, P1, t.id("ps")), "no opponent named");
      const chosenDeck = deck(t.engine, chosen);
      const otherDeck = deck(t.engine, other);
      play(t.engine, P1, t.id("ps"), { players: { opp: chosen } });
      for (const id of chosenDeck.slice(0, 4)) {
        assert.equal(t.engine.state.cards[id]!.zone, "void", "the top 4 are voided");
        assert.equal(t.engine.state.cards[id]!.faceDown, true, "face-down");
      }
      assert.deepEqual(deck(t.engine, chosen), chosenDeck.slice(4), "the rest of the chosen deck stays in order");
      assert.deepEqual(deck(t.engine, other), otherDeck, "the other opponent's deck is unchanged");
      assert.equal(pending(t.engine), undefined);
    }
  });

  clause(SWIPE, "1:rule", "3 seats: for the rest of the game P1 may deploy the voided cards as though in hand, ignoring thresholds; P2 and P3 cannot deploy them", () => {
    for (const chosen of [P2, P3]) {
      const t = swipeTable();
      const chosenDeck = deck(t.engine, chosen);
      play(t.engine, P1, t.id("ps"), { players: { opp: chosen } });
      const [first, second] = chosenDeck;
      // the other seats cannot deploy them, on their own turns
      endTurn(t.engine, P1);
      refused(() => play(t.engine, P2, first!), "P2 was not granted the permission");
      endTurn(t.engine, P2);
      refused(() => play(t.engine, P3, first!), "P3 was not granted the permission");
      endTurn(t.engine, P3);
      assert.equal(t.engine.state.cards[first!]!.zone, "void");
      play(t.engine, P1, first!);
      assert.equal(t.engine.state.cards[first!]!.zone, "play", "P1 deploys it without its [E][E] threshold");
      assert.equal(t.engine.state.cards[first!]!.controllerId, P1);
      play(t.engine, P1, second!);
      assert.equal(t.engine.state.cards[second!]!.zone, "play");
    }
  });
}

// =====================================================================================
// Peculate
// =====================================================================================
const PEC = "613fbe92-3cd5-479e-9381-438f6455f76a";

{
  const pecTable = () =>
    table(3, [
      { key: "pc", def: printing(PEC), owner: P1, zone: "hand" },
      ...res("deception", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...res("rage", 6, P1),
      { key: "A", def: character({ name: "A char", cost: 3 }), owner: P2, zone: "discard" },
      { key: "B", def: item({ name: "B item", cost: 2 }), owner: P3, zone: "discard" },
      { key: "C", def: location({ name: "C place", cost: 1 }), owner: P1, zone: "discard" }
    ]);

  clause(PEC, "0:extraCost", "3 seats: P1 may pick a character, item or location in any opponent's discard pile (A in P2's, B in P3's) and pays X, its numeric cost; C in P1's own pile cannot be picked; no opponent is asked for", () => {
    const t = pecTable();
    assert.equal(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("pc") }), undefined, "no chooseOpponent step");
    refused(() => play(t.engine, P1, t.id("pc"), { selected: { loot: [t.id("C")] } }), "own discard pile");
    assert.equal(zoneOf(t.engine, t.id("pc")), "hand");
    const before = t.engine.getAvailableResourceCount(P1);
    play(t.engine, P1, t.id("pc"), { selected: { loot: [t.id("B")] } });
    assert.equal(before - t.engine.getAvailableResourceCount(P1), 2, "P1 paid X = 2 (B's cost)");
    assert.equal(zoneOf(t.engine, t.id("B")), "play");
    assert.equal(zoneOf(t.engine, t.id("A")), "discard", "P2's discard pile is unchanged");
    const other = pecTable();
    const beforeA = other.engine.getAvailableResourceCount(P1);
    play(other.engine, P1, other.id("pc"), { selected: { loot: [other.id("A")] } });
    assert.equal(beforeA - other.engine.getAvailableResourceCount(P1), 3, "P1 paid X = 3 (A's cost)");
    assert.equal(zoneOf(other.engine, other.id("A")), "play");
    assert.equal(zoneOf(other.engine, other.id("B")), "discard");
  });

  clause(PEC, "1:rule", "3 seats: the picked card from P3's discard pile enters play under P1's control", () => {
    const t = pecTable();
    play(t.engine, P1, t.id("pc"), { selected: { loot: [t.id("B")] } });
    assert.equal(zoneOf(t.engine, t.id("B")), "play");
    assert.equal(t.engine.state.cards[t.id("B")]!.controllerId, P1, "under P1's control");
    assert.equal(t.engine.state.cards[t.id("B")]!.ownerId, P3);
    assert.ok(!t.engine.state.players[P3]!.discard.includes(t.id("B")));
  });
}

// =====================================================================================
// Rigged Tables
// =====================================================================================
const TABLES = "4c1790d7-4cc7-4df5-aa33-2e7369bd960d";

{
  const tablesTable = () =>
    table(3, [
      { key: "rt", def: printing(TABLES), owner: P1, zone: "play" },
      ...res("rage", 2, P1),
      ...seats(3).flatMap((p) => many(`d-${p}-`, 4, p, "deck", (i) => character({ name: `${p} deck ${i}` })))
    ]);
  const owners = () => seats(3);

  // "Any deck" is your own deck or one opponent's: the opponent option asks which opponent when it is chosen
  // (the spec lists three flat options; the data offers own / an opponent's and then names the opponent).
  const pickDeck = (t: ReturnType<typeof tablesTable>, abilityId: string, who: PlayerId) => {
    activate(t.engine, P1, t.id("rt"), abilityId);
    const pc = pending(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsOption");
    assert.equal(pc.playerId, P1);
    assert.equal((pc.options as unknown[]).length, 2, "your own deck, or an opponent's deck");
    if (who === P1) {
      answer(t.engine, "chooserSelectsOption", { index: 0 });
      assert.notEqual(pending(t.engine)?.kind, "choosePlayer", "no opponent is asked for when the own deck is picked");
    } else {
      answer(t.engine, "chooserSelectsOption", { index: 1 });
      const ask = pending(t.engine)!;
      assert.equal(ask.kind, "choosePlayer");
      assert.equal(ask.playerId, P1);
      assert.deepEqual([...(ask.candidates as string[])].sort(), [P2, P3], "only opponents are offered");
      answer(t.engine, "choosePlayer", { playerId: who });
    }
  };

  clause(TABLES, "0:ability:size-up", "3 seats: SIZE UP reaches every player's deck (own, P2's, P3's): the top card of the chosen deck only is looked at, no other deck is", () => {
    for (const who of owners()) {
      const t = tablesTable();
      pickDeck(t, "size-up", who);
      const look = pending(t.engine)!;
      assert.equal(look.kind, "reorderDeck", "P1 looks at the top card");
      assert.equal(look.playerId, P1);
      assert.equal(look.deckOwnerId, who);
      assert.deepEqual(look.cardIds, [deck(t.engine, who)[0]!], "the top card of that deck");
    }
  });

  clause(TABLES, "1:ability:rig", "3 seats: RIG reaches every player's deck (own, P2's, P3's): the top card of the chosen deck goes on the bottom of that deck; the other decks are unchanged", () => {
    for (const who of owners()) {
      const t = tablesTable();
      const before = Object.fromEntries(owners().map((p) => [p, deck(t.engine, p)]));
      pickDeck(t, "rig", who);
      for (const p of owners()) {
        if (p === who) assert.deepEqual(deck(t.engine, p), [...before[p]!.slice(1), before[p]![0]!], `${p}: its top card went to the bottom`);
        else assert.deepEqual(deck(t.engine, p), before[p], `${p}'s deck is unchanged`);
      }
    }
  });
}


// =====================================================================================
// Rosy Palmer, and Her Five Friends
// =====================================================================================
const ROSY = "fdfd2018-584b-4fa7-b9d9-e29f7961337a";

{
  const killer = tactic({
    name: "Rosy Killer",
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });
  type Seen = { kind: string; playerId: string; candidates?: PlayerId[]; cardIds?: string[] };
  const rosyTable = () =>
    table(3, [
      { key: "ro", def: printing(ROSY), owner: P1, zone: "play" },
      { key: "killer", def: killer, owner: P1, zone: "hand" },
      ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...[P2, P3].flatMap((p) =>
        many(`x-${p}-`, 8, p, "deck", (i) => (i === 1 ? item({ name: `${p} item` }) : character({ name: `${p} card ${i}` })))
      )
    ]);

  clause(ROSY, "1:rule", "3 seats: when Rosy is destroyed P1 chooses one opponent (P2 or P3); the top 5 cards of that deck are revealed to all players; P1 may put a revealed character into play under P1's control; that opponent (not the other) puts the remaining cards on the bottom of their deck in any order; the other deck is unchanged", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = rosyTable();
      const chosenDeck = deck(t.engine, chosen);
      const otherDeck = deck(t.engine, other);
      const grab = chosenDeck[2]!; // a character among the top 5 (the second card is an item)
      play(t.engine, P1, t.id("killer"), { selected: { t: [t.id("ro")] } });
      const seen: Seen[] = [];
      drain(t.engine, (pc) => {
        seen.push(pc as unknown as Seen);
        if (pc.kind === "choosePlayer") return { kind: "choosePlayer", playerId: chosen };
        if (pc.kind === "chooserSelectsTarget") {
          refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [chosenDeck[1]!] }), "an item is not a character");
          refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [chosenDeck[6]!] }), "not among the top 5");
          refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [otherDeck[0]!] }), "the other opponent's card");
          return { kind: "chooserSelectsTarget", selected: [grab] };
        }
        if (pc.kind === "reorderDeck") return { kind: "reorderDeck", order: [...(pc.cardIds as string[])].reverse() };
        return declineAll(pc);
      });
      const asks = seen.filter((s) => s.kind === "choosePlayer");
      assert.equal(asks.length, 1, "exactly one opponent is chosen");
      assert.equal(asks[0]!.playerId, P1);
      assert.deepEqual([...asks[0]!.candidates!].sort(), [P2, P3], "P1 is never offered");
      const reveals = t.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").map((e) => e.event as unknown as { cardIds: string[]; viewerId: string });
      assert.deepEqual(reveals.map((e) => e.cardIds), [chosenDeck.slice(0, 5)], "the top 5 of the chosen deck are revealed");
      assert.equal(reveals[0]!.viewerId, "all", "to all players (the other opponent too)");
      assert.equal(zoneOf(t.engine, grab), "play");
      assert.equal(t.engine.state.cards[grab]!.controllerId, P1, "under P1's control");
      const reorder = seen.find((s) => s.kind === "reorderDeck");
      assert.ok(reorder, "the remaining cards are put on the bottom");
      assert.equal(reorder.playerId, chosen, "by the chosen opponent");
      assert.equal(seen.filter((s) => s.playerId === other).length, 0, "the other opponent is never asked");
      const rest = chosenDeck.slice(0, 5).filter((c) => c !== grab).reverse();
      assert.deepEqual(deck(t.engine, chosen), [...chosenDeck.slice(5), ...rest], "the remaining four are at the bottom in the order the opponent gave");
      assert.deepEqual(deck(t.engine, other), otherDeck, "the other opponent's deck is unchanged");
    }
  });
}

// =====================================================================================
// Shadowy Mugger
// =====================================================================================
const MUG = "eda064a7-e82c-4939-81f1-9cf4896327b3";

{
  type Seen = { kind: string; playerId: string; candidates?: PlayerId[] };
  const mugTable = () =>
    table(3, [
      { key: "mug", def: printing(MUG), owner: P1, zone: "hand" },
      ...res("deception", 4, P1),
      ...many("m-", 3, P1, "deck", (i) => character({ name: `P1 deck ${i}` })),
      ...[P2, P3].flatMap((p) => many(`x-${p}-`, 6, p, "deck", (i) => character({ name: `${p} card ${i}` })))
    ]);

  clause(MUG, "1:rule", "3 seats: when it enters play P1 chooses one opponent (P2 or P3 only), searches only that opponent's deck and puts the card into that opponent's discard pile; that deck is shuffled; the other opponent's deck and discard pile are unchanged", () => {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = mugTable();
      const chosenDeck = deck(t.engine, chosen);
      const otherDeck = deck(t.engine, other);
      play(t.engine, P1, t.id("mug"));
      const seen: Seen[] = [];
      drain(t.engine, (pc) => {
        seen.push(pc as unknown as Seen);
        if (pc.kind === "choosePlayer") return { kind: "choosePlayer", playerId: chosen };
        if (pc.kind === "chooserSelectsTarget") {
          refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [otherDeck[0]!] }), "the other opponent's deck is not searched");
          return { kind: "chooserSelectsTarget", selected: [chosenDeck[3]!] };
        }
        return declineAll(pc);
      });
      assert.equal(zoneOf(t.engine, t.id("mug")), "play");
      const asks = seen.filter((s) => s.kind === "choosePlayer");
      assert.equal(asks.length, 1, "exactly one opponent is chosen");
      assert.equal(asks[0]!.playerId, P1);
      assert.deepEqual([...asks[0]!.candidates!].sort(), [P2, P3], "P1 is never offered");
      assert.ok(seen.every((s) => s.playerId === P1), "only P1 answers prompts");
      assert.equal(zoneOf(t.engine, chosenDeck[3]!), "discard");
      assert.deepEqual([...t.engine.state.players[chosen]!.discard], [chosenDeck[3]!], "in the chosen opponent's discard pile");
      const rest = chosenDeck.filter((c) => c !== chosenDeck[3]);
      assert.deepEqual(deck(t.engine, chosen).slice().sort(), rest.slice().sort());
      assert.ok(deck(t.engine, chosen).some((c, i) => c !== rest[i]), "the chosen opponent's deck was shuffled");
      assert.deepEqual(deck(t.engine, other), otherDeck, "the other opponent's deck is untouched");
      assert.equal(t.engine.state.players[other]!.discard.length, 0, "the other opponent's discard pile is unchanged");
    }
  });
}
