// Multiplayer clause tests, seed-saga part 5: 3- and 4-seat tables, real catalog printings, public actions only.
// Spec: data/card-tests/mp-spec/seed-saga.json.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { clause, refused, declineAll, drain } from "../_clause.js";
import { endTurn } from "../_turn.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle } from "../_battle.js";
import { activate, askedPlayers, answer, choosePlayer, deck, hand, many, pending, play, printing, ready, res, table, zoneOf, P1, P2, P3, P4 } from "./_mp.js";
import type { CardPlacement, Table } from "./_mp.js";
import { character, item, location, tactic } from "../../support/fixtures.js";

const SMO = "6c49725e-d71b-43b3-a85f-38ec7396911d"; // tactic: EXTRA COST pick an opponent's character; both remove top card; X = their cost - mine
const SURPRISE = "82f7c006-8b9f-4668-b3db-9507ce0bd479"; // tactic: pick a character attacking your faction or a location you control

const seats = (count: number): PlayerId[] => (count === 3 ? [P1, P2, P3] : [P1, P2, P3, P4]);
const foes = (count: number): PlayerId[] => seats(count).slice(1);
const life = (t: Table, key: string): number => t.engine.getStat(t.id(key), "life");

// ============================================================================
// Smothering Corpulence
// ============================================================================

for (const count of [3, 4] as const) {
  const smo = () =>
    table(count, [
      { key: "smo", def: printing(SMO), owner: P1, zone: "hand" },
      ...res("deception", 2, P1),
      ...res("rage", 2, P1),
      ...foes(count).flatMap((p, i) => [
        { key: `ch-${p}`, def: character({ name: `Char ${p}`, life: 6 }), owner: p, zone: "play" as const },
        { key: `top-${p}`, def: character({ name: `Top ${p}`, cost: 5 + i }), owner: p, zone: "deck" as const },
        { key: `under-${p}`, def: character({ name: `Under ${p}`, cost: 9 }), owner: p, zone: "deck" as const }
      ]),
      { key: "top-me", def: character({ name: "Top me", cost: 2 }), owner: P1, zone: "deck" },
      { key: "under-me", def: character({ name: "Under me", cost: 8 }), owner: P1, zone: "deck" },
      { key: "under-me2", def: character({ name: "Under me 2", cost: 8 }), owner: P1, zone: "deck" }
    ]);

  clause(SMO, "0:extraCost", `${count} seats: the picked character's controller and I remove the top card of our decks; the other opponents' decks are untouched`, () => {
    for (const chosen of foes(count)) {
      const t = smo();
      assert.equal(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("smo") }), undefined, "the pick settles the opponent: no player is asked");
      const before = Object.fromEntries(seats(count).map((p) => [p, deck(t.engine, p).length]));
      play(t.engine, P1, t.id("smo"), { selected: { c: [t.id(`ch-${chosen}`)] } });
      assert.equal(zoneOf(t.engine, t.id(`top-${chosen}`)), "removed", "the picked character's controller removed their top card");
      assert.equal(zoneOf(t.engine, t.id("top-me")), "removed", "my top card is removed");
      assert.equal(deck(t.engine, chosen).length, before[chosen]! - 1);
      for (const other of foes(count).filter((p) => p !== chosen)) {
        assert.equal(zoneOf(t.engine, t.id(`top-${other}`)), "deck", `${other}'s top card stays`);
        assert.equal(deck(t.engine, other).length, before[other]!, `${other}'s deck untouched`);
      }
    }
  });

  clause(SMO, "1:rule", `${count} seats: X is read from the picked character's controller's removed card; only that character loses X life and I draw a card`, () => {
    for (const [index, chosen] of foes(count).entries()) {
      const t = smo();
      const handBefore = hand(t.engine, P1).length;
      play(t.engine, P1, t.id("smo"), { selected: { c: [t.id(`ch-${chosen}`)] } });
      const x = 5 + index - 2;
      assert.equal(life(t, `ch-${chosen}`), 6 - x, `X = ${5 + index} - 2`);
      for (const other of foes(count).filter((p) => p !== chosen)) assert.equal(life(t, `ch-${other}`), 6, `${other}'s character is not affected`);
      assert.equal(hand(t.engine, P1).length, handBefore - 1 + 1, "the tactic left my hand and I drew one card");
      for (const other of foes(count)) assert.equal(hand(t.engine, other).length, 0, "no opponent draws");
    }
  });
}

// ============================================================================
// Surprise!
// ============================================================================

for (const count of [3, 4] as const) {
  /** P1 defends: `ownAtk` attacks P1's faction or `locAtk` P1's location; a third attacker hits another opponent. */
  const surprise = (attacker: PlayerId, targetKind: "faction" | "location") => {
    const others = foes(count).filter((p) => p !== attacker);
    const t = table(
      count,
      [
        { key: "sur", def: printing(SURPRISE), owner: P1, zone: "hand" },
        ...res("deception", 3, P1),
        { key: "mine", def: character({ name: "Mine", cost: 1, life: 6 }), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", cost: 3, strength: 2, life: 3 }), owner: attacker, zone: "play" },
        ...others.flatMap((p) => [
          { key: `c-${p}`, def: character({ name: `Char ${p}`, cost: 4, strength: 2, life: 3 }), owner: p, zone: "play" as const },
          { key: `f-${p}`, def: character({ name: `Fodder ${p}`, cost: 1 }), owner: p, zone: "play" as const }
        ]),
        { key: "d0", def: character({ name: "Big", cost: 5 }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "Hit", cost: 3 }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "Spare", cost: 2 }), owner: P1, zone: "deck" },
        ...foes(count).map((p) => ({ key: `od-${p}`, def: character({ name: `OD ${p}`, cost: 1 }), owner: p, zone: "deck" as const }))
      ],
      attacker
    );
    declareAttackOpenWindow(t.engine, attacker, [t.id("atk")], targetKind === "faction" ? { type: "faction", playerId: P1 } : { type: "card", cardId: t.id("loc") });
    return t;
  };
  const cast = (t: Table, pick: string) => play(t.engine, P1, t.id("sur"), { selected: { k: [t.id(pick)] } });

  clause(SURPRISE, "0:extraCost", `${count} seats: I can pick the character of any opponent attacking my faction or my location; not one attacking someone else, nor my own`, () => {
    for (const attacker of foes(count)) {
      for (const kind of ["faction", "location"] as const) {
        const t = surprise(attacker, kind);
        for (const other of foes(count).filter((p) => p !== attacker)) refused(() => cast(t, `c-${other}`), `${other}'s character is not attacking me`);
        refused(() => cast(t, "mine"), "my own character");
        assert.equal(zoneOf(t.engine, t.id("sur")), "hand");
        cast(t, "atk");
        assert.equal(zoneOf(t.engine, t.id("sur")), "discard", `${attacker}'s attacker on my ${kind} was a legal pick`);
      }
    }
  });

  clause(SURPRISE, "0:extraCost", `${count} seats: an attacker that attacks another opponent's faction is not a legal pick (I am not defending)`, () => {
    const attacker = P2;
    const victim = foes(count).find((p) => p !== attacker)!;
    const t = table(
      count,
      [
        { key: "sur", def: printing(SURPRISE), owner: P1, zone: "hand" },
        ...res("deception", 3, P1),
        { key: "atk", def: character({ name: "Atk", cost: 3, strength: 2, life: 3 }), owner: attacker, zone: "play" },
        { key: "d0", def: character({ name: "Hit", cost: 3 }), owner: P1, zone: "deck" }
      ],
      attacker
    );
    declareAttackOpenWindow(t.engine, attacker, [t.id("atk")], { type: "faction", playerId: victim });
    refused(() => cast(t, "atk"), "P1 is not the defending player", /priority/);
    assert.equal(zoneOf(t.engine, t.id("sur")), "hand");
    assert.equal(zoneOf(t.engine, t.id("d0")), "deck");
  });

  clause(SURPRISE, "1:rule", `${count} seats: X is the picked attacker's cost; my deck is revealed, the character enters under my control and no opponent's deck changes`, () => {
    for (const attacker of foes(count)) {
      const t = surprise(attacker, "faction");
      const oppDecks = Object.fromEntries(foes(count).map((p) => [p, [...deck(t.engine, p)]]));
      cast(t, "atk");
      assert.equal(zoneOf(t.engine, t.id("d1")), "play", "Hit (cost 3 = X) enters play");
      assert.equal(t.engine.state.cards[t.id("d1")]!.controllerId, P1, "under my control");
      assert.equal(zoneOf(t.engine, t.id("d0")), "deck", "Big (cost 5 > X) was shuffled back");
      assert.ok(t.engine.state.battle?.blockingParty.includes(t.id("d1")) ?? false, "a member of the blocking party");
      for (const p of foes(count)) assert.deepEqual(deck(t.engine, p), oppDecks[p], `${p}'s deck unchanged`);
    }
  });
}
// ============================================================================
// Underhanded Gamer
// ============================================================================

const GAMER = "8bed01de-3627-4ae9-92dc-fc065e9e5de7"; // character: OUTSMART (use only if an opponent controls more characters than you; pay 3; cannot be blocked by those players)

for (const count of [3, 4] as const) {
  /** P1 controls the Gamer plus `mine - 1` others; each opponent controls the given number of characters. */
  const gamer = (mine: number, theirs: Record<string, number>) =>
    table(count, [
      { key: "g", def: printing(GAMER), owner: P1, zone: "play" },
      ...many("my", mine - 1, P1, "play", (i) => character({ name: `Mine ${i}` })),
      ...foes(count).flatMap((p) => many(`c-${p}-`, theirs[p] ?? 0, p, "play", (i) => character({ name: `${p} char ${i}`, life: 9 }))),
      ...res("rage", 3, P1)
    ]);
  const outsmart = (t: Table, chosen?: PlayerId) => {
    activate(t.engine, P1, t.id("g"), "outsmart");
    if (chosen !== undefined) choosePlayer(t.engine, chosen);
  };

  clause(GAMER, "0:ability:outsmart", `${count} seats: the use needs some opponent with more characters than I have; "those players" is one opponent chosen among those who control more, never one with fewer or as many`, () => {
    // two opponents control more than my 2 characters (P2 and P3), any further opponent controls fewer
    const counts = Object.fromEntries(foes(count).map((p, i) => [p, i < 2 ? 3 : 1]));
    const t = gamer(2, counts);
    activate(t.engine, P1, t.id("g"), "outsmart");
    assert.equal(ready(t.engine, P1), 0, "paid 3: P2 and P3 control more than I do");
    const ask = pending(t.engine)!;
    assert.equal(ask.kind, "choosePlayer");
    assert.equal(ask.playerId, P1, "the controller chooses");
    assert.deepEqual([...(ask.candidates as PlayerId[])].sort(), [P2, P3], "only opponents controlling more characters than I do are offered");
    choosePlayer(t.engine, P3);
    assert.equal(pending(t.engine), undefined);
    // exactly one opponent controls more: it is taken without asking
    const solo = gamer(2, Object.fromEntries(foes(count).map((p, i) => [p, i === 1 ? 3 : 1])));
    activate(solo.engine, P1, solo.id("g"), "outsmart");
    assert.equal(ready(solo.engine, P1), 0);
    assert.equal(pending(solo.engine), undefined, "a single qualifying opponent is not asked about");
    // no opponent controls more than I do: the ability cannot be used
    const none = gamer(3, Object.fromEntries(foes(count).map((p) => [p, 2])));
    refused(() => activate(none.engine, P1, none.id("g"), "outsmart"), "no opponent controls more characters");
    assert.equal(ready(none.engine, P1), 3, "nothing is paid");
  });

  clause(GAMER, "0:ability:outsmart", `${count} seats: this turn the Gamer cannot be blocked by the chosen opponent's characters, but the other opponents' characters can still block it`, () => {
    const counts = Object.fromEntries(foes(count).map((p) => [p, 3]));
    for (const chosen of foes(count)) {
      for (const defender of foes(count)) {
        const t = gamer(2, counts);
        outsmart(t, chosen);
        declareAttackBy(t.engine, P1, [t.id("g")], { type: "faction", playerId: defender });
        const blocker = t.id(`c-${defender}-0`);
        if (defender === chosen) {
          refused(() => t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [blocker] }), `${defender}'s characters cannot block the Gamer`, /block/i);
        } else {
          t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [blocker] });
          assert.deepEqual(t.engine.state.battle!.blockingParty, [blocker], `${defender} was not chosen: its character can still block`);
        }
      }
    }
  });
}

// ============================================================================
// Vast Mastabatorium
// ============================================================================

const MAST = "6f8bd62f-fdaa-49b6-8de8-d66c0ec28437"; // location: YOU KNOW YOU WANT TO... draw a card; at the end of the turn a token goes on it and an opponent takes control of it

for (const count of [3, 4] as const) {
  const mast = () =>
    table(count, [
      { key: "loc", def: printing(MAST), owner: P1, zone: "play" },
      ...many("d", 6, P1, "deck", (i) => character({ name: `Deck ${i}` })),
      ...res("rage", 3, P1)
    ]);
  const use = (t: Table, opponent: PlayerId) => {
    // the opponent is named with the use when the engine asks for it there, and otherwise when the end-of-turn effect resolves
    const asked = askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("loc"), abilityId: "you-know-you-want-to" });
    activate(t.engine, P1, t.id("loc"), "you-know-you-want-to", asked ? { players: { [asked[0]!.id]: opponent } } : {});
  };
  const endOfTurn = (t: Table, opponent: PlayerId) => {
    t.engine.perform({ type: "endTurn", playerId: P1 });
    drain(t.engine, (pc) => (pc.kind === "choosePlayer" ? { kind: "choosePlayer", playerId: opponent } : declineAll(pc)));
  };

  clause(MAST, "0:ability:you-know-you-want-to", `${count} seats: at the end of the turn a token goes on it and only the chosen opponent takes control of it`, () => {
    for (const chosen of foes(count)) {
      const t = mast();
      use(t, chosen);
      assert.equal(hand(t.engine, P1).length, 1, "I drew a card");
      assert.equal(t.engine.state.cards[t.id("loc")]!.controllerId, P1, "still mine until the end of the turn");
      endOfTurn(t, chosen);
      const card = t.engine.state.cards[t.id("loc")]!;
      assert.equal(card.counters?.token ?? 0, 1, "a token was put on it");
      assert.equal(card.controllerId, chosen, "the chosen opponent controls it");
      for (const other of foes(count).filter((p) => p !== chosen)) assert.ok(!t.engine.state.players[other]!.play.includes(t.id("loc")), `${other} does not control it`);
      assert.ok(!t.engine.state.players[P1]!.play.includes(t.id("loc")), "no longer mine");
    }
  });

  clause(MAST, "0:ability:you-know-you-want-to", `${count} seats: the opponent is chosen as the end-of-turn effect resolves, not with the use`, () => {
    const t = mast();
    assert.equal(askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("loc"), abilityId: "you-know-you-want-to" }), undefined, "nothing is asked at the use");
    activate(t.engine, P1, t.id("loc"), "you-know-you-want-to");
    t.engine.perform({ type: "endTurn", playerId: P1 });
    drain(t.engine, (pc) => (pc.kind === "choosePlayer" ? { kind: "choosePlayer", playerId: P2 } : declineAll(pc)));
    assert.equal(t.engine.state.cards[t.id("loc")]!.controllerId, P2);
  });
}

// ============================================================================
// Well Laid Plans
// ============================================================================

const WLP = "5989ea37-35f7-443c-9b79-64ce0475309c"; // tactic: EXTRA COST pick an opponent; search that player's deck for a card, face-down resource under its owner's control; search your deck for a character, same

for (const count of [3, 4] as const) {
  const wlp = () =>
    table(count, [
      { key: "t", def: printing(WLP), owner: P1, zone: "hand" },
      ...res("deception", 4, P1),
      ...foes(count).flatMap((p) => [
        { key: `o1-${p}`, def: character({ name: `${p} one` }), owner: p, zone: "deck" as const },
        { key: `o2-${p}`, def: item({ name: `${p} item` }), owner: p, zone: "deck" as const },
        ...many(`op-${p}-`, 4, p, "deck", (i) => item({ name: `${p} pad ${i}` }))
      ]),
      { key: "m1", def: character({ name: "Mine one" }), owner: P1, zone: "deck" },
      { key: "m2", def: item({ name: "Mine item" }), owner: P1, zone: "deck" },
      { key: "m3", def: character({ name: "Mine three" }), owner: P1, zone: "deck" },
      ...many("mp", 4, P1, "deck", (i) => item({ name: `Mine pad ${i}` }))
    ]);
  const open = (t: Table) => (pending(t.engine) as unknown as { declaration?: { id: string } } | undefined)?.declaration?.id;
  const act = { type: "playCard", playerId: P1 } as const;

  clause(WLP, "0:extraCost", `${count} seats: the extra cost picks one opponent, offered among the opponents only`, () => {
    const t = wlp();
    assert.deepEqual(askedPlayers(t.engine, { ...act, cardId: t.id("t") }), [{ id: "picked", candidates: foes(count) }]);
    refused(() => play(t.engine, P1, t.id("t")), "no opponent picked");
    refused(() => play(t.engine, P1, t.id("t"), { players: { picked: P1 } }), "I cannot pick myself");
    assert.equal(zoneOf(t.engine, t.id("t")), "hand");
    assert.equal(ready(t.engine, P1), 4, "nothing paid");
  });

  clause(WLP, "1:rule", `${count} seats: I search the picked opponent's deck; the found card enters under its owner's control as a face-down resource; other opponents' decks are untouched`, () => {
    for (const picked of foes(count)) {
      const t = wlp();
      const others = foes(count).filter((p) => p !== picked);
      const otherDecks = Object.fromEntries(others.map((p) => [p, [...deck(t.engine, p)]]));
      const readyBefore = Object.fromEntries(foes(count).map((p) => [p, t.engine.getAvailableResourceCount(p)]));
      play(t.engine, P1, t.id("t"), { players: { picked } });
      assert.equal(open(t), "theirs", "the first search is of the picked opponent's deck");
      for (const other of others) refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`o1-${other}`)] }), `${other}'s deck is not the picked opponent's`);
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("m1")] }), "my own deck is not the picked opponent's");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`o2-${picked}`)] });
      const found = t.engine.state.cards[t.id(`o2-${picked}`)]!;
      assert.equal(found.zone, "play");
      assert.equal(found.faceDown, true, "face-down resource");
      assert.equal(found.controllerId, picked, "under its owner's control");
      assert.equal(t.engine.getAvailableResourceCount(picked), readyBefore[picked]! + 1, "the picked opponent has one more resource");
      for (const other of others) {
        assert.deepEqual(deck(t.engine, other), otherDecks[other], `${other}'s deck untouched`);
        assert.equal(t.engine.getAvailableResourceCount(other), readyBefore[other], `${other} gained no resource`);
      }
      if (open(t) === "mine") answer(t.engine, "chooserSelectsTarget", { selected: [] });
    }
  });

  clause(WLP, "2:rule", `${count} seats: I search my own deck for a character; it enters under my control as a face-down resource; no other opponent's deck changes`, () => {
    for (const picked of foes(count)) {
      const t = wlp();
      const foeDecks = Object.fromEntries(foes(count).map((p) => [p, deck(t.engine, p).length]));
      play(t.engine, P1, t.id("t"), { players: { picked } });
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`o1-${picked}`)] });
      assert.equal(open(t), "mine", "then the search of my own deck");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("m2")] }), "an item is not a character");
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`o1-${foes(count).find((p) => p !== picked)}`)] }), "another player's card");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id("m3")] });
      const mine = t.engine.state.cards[t.id("m3")]!;
      assert.equal(mine.zone, "play");
      assert.equal(mine.faceDown, true);
      assert.equal(mine.controllerId, P1);
      assert.equal(ready(t.engine, P1), 1, "cost 4 paid, my new resource is ready");
      for (const p of foes(count)) assert.equal(deck(t.engine, p).length, foeDecks[p]! - (p === picked ? 1 : 0), `${p}'s deck`);
    }
  });
}

// ============================================================================
// Chain Reaction
// ============================================================================

const CR = "f84bb22e-e599-4eb5-88ed-03519f86366b"; // tactic: inflict 3 damage to a location; if destroyed pick a character, 2 damage; if destroyed 1 damage to an opponent's faction and draw
const influenceOf = (t: Table, p: PlayerId): number => t.engine.state.players[p]!.influence;

for (const count of [3, 4] as const) {
  /** P2 owns the location (structure 3), P3 owns a life-2 character, P1 has a deck to draw from. */
  const chain = (locStructure = 3, charLife = 2) =>
    table(count, [
      { key: "cr", def: printing(CR), owner: P1, zone: "hand" },
      ...res("rage", 1, P1),
      { key: "loc", def: location({ name: "Loc", structure: locStructure }), owner: P2, zone: "play" },
      { key: "ploc", def: location({ name: "P3 loc", structure: 3 }), owner: P3, zone: "play" },
      { key: "mloc", def: location({ name: "My loc", structure: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: charLife }), owner: P3, zone: "play" },
      ...many("d", 3, P1, "deck", (i) => character({ name: `Deck ${i}` }))
    ]);
  const crAction = (t: Table, loc: string) => ({ type: "playCard", playerId: P1, cardId: t.id("cr"), selected: { l: [t.id(loc)] } });
  /** The opponent is named with the play when the engine asks for it there; otherwise the controller is asked when the sentence resolves. */
  const cast = (t: Table, chosen: PlayerId, loc = "loc", pick: string | undefined = "foe") => {
    const asked = askedPlayers(t.engine, crAction(t, loc));
    play(t.engine, P1, t.id("cr"), { selected: { l: [t.id(loc)] }, ...(asked ? { players: { [asked[0]!.id]: chosen } } : {}) });
    drain(t.engine, (pc) =>
      pc.kind === "choosePlayer" ? { kind: "choosePlayer", playerId: chosen } : pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: pick ? [t.id(pick)] : [] } : declineAll(pc)
    );
  };

  clause(CR, "0:extraCost", `${count} seats: the location may be any player's: an opponent's, another opponent's and my own all work`, () => {
    for (const loc of ["loc", "ploc", "mloc"]) {
      const t = chain();
      cast(t, P2, loc, undefined);
      assert.equal(zoneOf(t.engine, t.id(loc)), "discard", `${loc} was picked and destroyed by 3 damage`);
      assert.equal(zoneOf(t.engine, t.id("cr")), "discard");
    }
  });

  clause(CR, "1:rule", `${count} seats: when the character is destroyed I draw a card and 1 damage goes to the chosen opponent's faction only`, () => {
    for (const chosen of foes(count)) {
      const t = chain();
      const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(t, p)]));
      const handBefore = hand(t.engine, P1).length;
      cast(t, chosen);
      assert.equal(zoneOf(t.engine, t.id("loc")), "discard", "the location was destroyed");
      assert.equal(zoneOf(t.engine, t.id("foe")), "discard", "the character was destroyed");
      assert.equal(influenceOf(t, chosen), before[chosen]! - 1, `${chosen}'s faction took 1 damage`);
      for (const other of seats(count).filter((p) => p !== chosen)) assert.equal(influenceOf(t, other), before[other], `${other}'s faction is unchanged`);
      assert.equal(hand(t.engine, P1).length, handBefore - 1 + 1, "I drew a card");
    }
  });

  clause(CR, "1:rule", `${count} seats: no opponent is chosen when the location or the character survives (the opponent is only needed when it resolves that far)`, () => {
    const t = chain(5);
    assert.equal(askedPlayers(t.engine, crAction(t, "loc")), undefined, "nothing is asked when the play is announced");
    play(t.engine, P1, t.id("cr"), { selected: { l: [t.id("loc")] } });
    assert.equal(zoneOf(t.engine, t.id("loc")), "play", "the location survived 3 damage");
    assert.equal(pending(t.engine), undefined, "no character pick, no opponent choice");
    const survives = chain(3, 3);
    const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(survives, p)]));
    assert.deepEqual(askedPlayers(survives.engine, crAction(survives, "loc")), undefined, "still nothing asked when the play is announced");
    play(survives.engine, P1, survives.id("cr"), { selected: { l: [survives.id("loc")] } });
    drain(survives.engine, (pc) => {
      assert.notEqual(pc.kind, "choosePlayer", "no opponent is chosen when the character survives");
      return pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [survives.id("foe")] } : declineAll(pc);
    });
    assert.equal(zoneOf(survives.engine, survives.id("foe")), "play", "the character survived 2 damage");
    for (const p of seats(count)) assert.equal(influenceOf(survives, p), before[p], `${p}'s faction untouched`);
  });
}

// ============================================================================
// Draconarius Slitherform
// ============================================================================

const DS = "b6a07adb-0334-454a-a8d4-019dabbdcc8b"; // character 4/3/3: when blocked, X damage divided among the blocking party; when destroyed, X damage divided among your opponents' characters

const killer = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 99 }] }] }
  } as never);
const damageOf = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.damage ?? 0;
const distribute = (shares: Record<string, number>) => (pc: { kind: string; [key: string]: unknown }) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares } : declineAll(pc));

for (const count of [3, 4] as const) {
  clause(DS, "1:rule", `${count} seats: when blocked by two characters of the defending opponent I divide X among the blocking party; other opponents' characters take none`, () => {
    for (const defender of foes(count)) {
      const t = table(count, [
        { key: "ds", def: printing(DS), owner: P1, zone: "play" },
        ...foes(count).flatMap((p) => many(`c-${p}-`, 3, p, "play", (i) => character({ name: `${p} char ${i}`, life: 10, strength: 1, speed: 1 })))
      ]);
      declareAttackBy(t.engine, P1, [t.id("ds")], { type: "faction", playerId: defender });
      t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`c-${defender}-0`), t.id(`c-${defender}-1`)] });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "distributeAmong");
      assert.equal(pc.playerId, P1, "I divide the damage");
      assert.equal(pc.amount, 4);
      for (const other of foes(count).filter((p) => p !== defender)) {
        refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [t.id(`c-${other}-0`)]: 4 } } } as never), `${other}'s character is not in the blocking party`);
      }
      refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [t.id(`c-${defender}-2`)]: 4 } } } as never), "a non-blocking character");
      drain(t.engine, distribute({ [t.id(`c-${defender}-0`)]: 3, [t.id(`c-${defender}-1`)]: 1 }));
      assert.equal(damageOf(t, `c-${defender}-0`), 3);
      assert.equal(damageOf(t, `c-${defender}-1`), 1);
      for (const p of foes(count)) for (const i of [0, 1, 2]) if (p !== defender || i === 2) assert.equal(damageOf(t, `c-${p}-${i}`), 0, `${p} char ${i} untouched`);
    }
  });

  clause(DS, "2:rule", `${count} seats: when destroyed I divide X among the characters of all my opponents, no opponent is chosen, my own characters are not eligible`, () => {
    const t = table(
      count,
      [
        { key: "ds", def: printing(DS), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine", life: 10 }), owner: P1, zone: "play" },
        { key: "kill", def: killer("Kill"), owner: P2, zone: "hand" },
        ...foes(count).flatMap((p) => many(`c-${p}-`, p === P2 ? 2 : 1, p, "play", (i) => character({ name: `${p} char ${i}`, life: 10 })))
      ],
      P2
    );
    play(t.engine, P2, t.id("kill"), { selected: { t: [t.id("ds")] } });
    assert.equal(zoneOf(t.engine, t.id("ds")), "discard");
    const pc = pending(t.engine)!;
    assert.equal(pc.kind, "distributeAmong", "no opponent is asked for first");
    assert.equal(pc.playerId, P1);
    assert.equal(pc.amount, 4);
    refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [t.id("mine")]: 4 } } } as never), "my own character");
    const shares: Record<string, number> = { [t.id(`c-${P2}-0`)]: 1, [t.id(`c-${P2}-1`)]: 1, [t.id(`c-${P3}-0`)]: 2 };
    if (count === 4) {
      delete shares[t.id(`c-${P2}-1`)];
      shares[t.id(`c-${P4}-0`)] = 1;
    }
    drain(t.engine, distribute(shares));
    for (const [id, n] of Object.entries(shares)) assert.equal(t.engine.state.cards[id as CardInstanceId]!.damage ?? 0, n);
    assert.equal(damageOf(t, "mine"), 0);
    if (count === 3) assert.equal(damageOf(t, `c-${P2}-1`), 1, "P2's second character took its share too");
  });
}

// ============================================================================
// Drill Garrison
// ============================================================================

const DG = "6d4b0079-550c-4cea-a2a0-ff889c523ab2"; // location: [R][R][R] 1 damage to an opponent's faction; [R]x5 deplete a character; [R]x7 2 damage to a character (each at the start of your turn)

type Prompt = { kind: string; playerId: string; [key: string]: unknown };

for (const count of [3, 4] as const) {
  const last = seats(count)[count - 1]!;
  const garrison = (rage: number) =>
    table(
      count,
      [
        { key: "dg", def: printing(DG), owner: P1, zone: "play" },
        ...res("rage", rage, P1),
        ...foes(count).flatMap((p) => many(`c-${p}-`, 2, p, "play", (i) => character({ name: `${p} char ${i}`, life: 6 }))),
        ...many("d", 6, P1, "deck", (i) => character({ name: `Deck ${i}` }))
      ],
      last
    );
  /** Starts P1's turn and answers every prompt of the garrison: `inflict` picks the damage option, `pick` the character, `opponent` the chosen player. */
  const startTurn = (t: Table, plan: { inflict: boolean; opponent?: PlayerId; pick?: string }): string[] => {
    const seen: string[] = [];
    t.engine.perform({ type: "endTurn", playerId: last });
    drain(t.engine, (raw) => {
      const pc = raw as Prompt;
      seen.push(pc.kind);
      if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as string[])[0] };
      if (pc.kind === "choosePlayer") return { kind: "choosePlayer", playerId: plan.opponent ?? P2 };
      if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: plan.inflict ? 1 : 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: pc.kind, selected: plan.pick ? [t.id(plan.pick)] : [] };
      return declineAll(pc);
    });
    return seen;
  };

  clause(DG, "1:rule@rrr", `${count} seats: at the start of my turn I may inflict 1 damage to one opponent's faction; only the chosen opponent loses influence`, () => {
    for (const chosen of foes(count)) {
      const t = garrison(3);
      const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(t, p)]));
      const seen = startTurn(t, { inflict: true, opponent: chosen });
      assert.equal(t.engine.state.activePlayerId, P1);
      assert.equal(seen.filter((k) => k === "choosePlayer").length, 1, "exactly one opponent is chosen");
      assert.equal(influenceOf(t, chosen), before[chosen]! - 1, `${chosen} took 1 damage`);
      for (const other of seats(count).filter((p) => p !== chosen)) assert.equal(influenceOf(t, other), before[other], `${other} unchanged`);
    }
    const declined = garrison(3);
    const before = foes(count).map((p) => influenceOf(declined, p));
    startTurn(declined, { inflict: false });
    assert.deepEqual(foes(count).map((p) => influenceOf(declined, p)), before, "declined: nobody is damaged");
  });

  clause(DG, "2:rule@rrrrr", `${count} seats: with [R] x5 I may deplete any player's character; no opponent is chosen for it`, () => {
    for (const target of [`c-${P3}-0`, `c-${P2}-1`]) {
      const t = garrison(5);
      const before = foes(count).map((p) => influenceOf(t, p));
      startTurn(t, { inflict: false, pick: target });
      assert.equal(t.engine.state.cards[t.id(target)]!.depleted ?? false, true, "the picked character is depleted");
      for (const p of foes(count)) {
        for (const i of [0, 1]) {
          if (`c-${p}-${i}` !== target) assert.equal(t.engine.state.cards[t.id(`c-${p}-${i}`)]!.depleted ?? false, false, `c-${p}-${i} is not depleted`);
        }
      }
      assert.deepEqual(foes(count).map((p) => influenceOf(t, p)), before, "no faction damage");
    }
  });

  clause(DG, "3:rule@rrrrrrr", `${count} seats: with [R] x7 I may pick any player's character and it takes 2 damage; no opponent is chosen for it`, () => {
    for (const target of [`c-${P2}-0`, `c-${P3}-1`]) {
      const t = garrison(7);
      startTurn(t, { inflict: false, pick: target });
      assert.equal(damageOf(t, target), 2);
      for (const p of foes(count)) for (const i of [0, 1]) if (`c-${p}-${i}` !== target) assert.equal(damageOf(t, `c-${p}-${i}`), 0);
    }
  });
}

// ============================================================================
// Epic Smackdown
// ============================================================================

const ES = "74da08f9-ea6b-4ac6-af80-2734f1860cae"; // tactic: EXTRA COST choose X, destroy X characters you control; each opponent with at least X characters destroys X of theirs, otherwise all of theirs; draw a card

const charKeys = (t: Table, p: PlayerId): string[] => Object.keys(t.engine.state.cards).filter((id) => t.engine.state.cards[id as CardInstanceId]!.zone === "play" && t.engine.state.cards[id as CardInstanceId]!.controllerId === p && t.engine.getDefinition(id as CardInstanceId).type === "character");

for (const count of [3, 4] as const) {
  /** P1 controls 3 characters; P2 controls 3; P3 controls 1; P4 (when seated) controls 2. */
  const smack = (active: PlayerId = P1) =>
    table(
      count,
      [
        { key: "es", def: printing(ES), owner: P1, zone: "hand" },
        ...res("rage", 3, P1),
        ...many("a", 3, P1, "play", (i) => character({ name: `Own ${i}` })),
        ...many("b", 3, P2, "play", (i) => character({ name: `P2 char ${i}` })),
        ...many("c", 1, P3, "play", (i) => character({ name: `P3 char ${i}` })),
        ...(count === 4 ? many("e", 2, P4, "play", (i) => character({ name: `P4 char ${i}` })) : []),
        ...many("d", 4, P1, "deck", (i) => character({ name: `Deck ${i}` }))
      ],
      active
    );
  const owned = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.ownerId as PlayerId;
  /** Plays X = 2 (destroying a0, a1); the engine's own opponent naming (if it asks for one) is answered with P2. */
  const cast = (t: Table, raw = false) => {
    const action = { type: "playCard", playerId: P1, cardId: t.id("es"), selected: { sacX: [t.id("a0"), t.id("a1")] }, variables: { x: 2 } };
    const asked = askedPlayers(t.engine, action);
    const opts = { selected: action.selected, variables: action.variables, ...(asked ? { players: { [asked[0]!.id]: P2 } } : {}) };
    if (raw) return opts;
    play(t.engine, P1, t.id("es"), opts);
    return opts;
  };
  /** Answers every prompt: each prompted opponent destroys the first X of their own characters; records who was prompted. */
  const answerAll = (t: Table, prompted: PlayerId[]) => (pc: { kind: string; playerId: string; [key: string]: unknown }) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    prompted.push(pc.playerId as PlayerId);
    return { kind: "chooserSelectsTarget", selected: charKeys(t, pc.playerId as PlayerId).slice(0, 2) };
  };

  clause(ES, "0:extraCost", `${count} seats: the extra cost destroys X characters I control; only my own characters can be chosen`, () => {
    const t = smack();
    const opts = cast(t, true);
    refused(() => play(t.engine, P1, t.id("es"), { ...opts, selected: { sacX: [t.id("b0"), t.id("b1")] } }), "an opponent's character cannot be sacrificed");
    assert.equal(zoneOf(t.engine, t.id("es")), "hand");
    assert.equal(ready(t.engine, P1), 3, "nothing paid");
    play(t.engine, P1, t.id("es"), opts);
    drain(t.engine, answerAll(t, []));
    assert.equal(zoneOf(t.engine, t.id("a0")), "discard");
    assert.equal(zoneOf(t.engine, t.id("a1")), "discard");
    assert.equal(zoneOf(t.engine, t.id("a2")), "play", "my third character is untouched");
  });

  clause(ES, "1:rule", `${count} seats: each opponent with at least X characters destroys X of theirs, the others lose all of theirs, in turn order; I draw exactly one card`, () => {
    const t = smack();
    const handBefore = hand(t.engine, P1).length;
    const prompted: PlayerId[] = [];
    play(t.engine, P1, t.id("es"), { selected: { sacX: [t.id("a0"), t.id("a1")] }, variables: { x: 2 } });
    drain(t.engine, answerAll(t, prompted));
    assert.equal(charKeys(t, P2).length, 1, "P2 had 3 and destroyed 2");
    assert.equal(charKeys(t, P3).length, 0, "P3 had fewer than X: all of its characters are destroyed");
    if (count === 4) assert.equal(charKeys(t, P4).length, 0, "P4 had exactly X: it destroyed both");
    assert.deepEqual(prompted.filter((p, i) => prompted.indexOf(p) === i), count === 3 ? [P2] : [P2, P4], "each opponent with at least X characters chooses its own");
    assert.equal(charKeys(t, P1).length, 1, "my remaining character is untouched");
    assert.equal(hand(t.engine, P1).length, handBefore - 1 + 1, "I draw exactly one card, not one per opponent");
  });

  if (count === 4) {
    clause(ES, "1:rule", "4 seats: the opponents are handled in turn order starting with the active player, skipping the controller (P4 active: P4, P2, P3)", () => {
      const t = table(
        4,
        [
          { key: "es", def: printing(ES), owner: P1, zone: "hand" },
          ...res("rage", 3, P1),
          ...many("a", 3, P1, "play", (i) => character({ name: `Own ${i}` })),
          ...many("b", 3, P2, "play", (i) => character({ name: `P2 char ${i}` })),
          ...many("c", 3, P3, "play", (i) => character({ name: `P3 char ${i}` })),
          ...many("e", 3, P4, "play", (i) => character({ name: `P4 char ${i}` })),
          { key: "atk", def: character({ name: "Attacker", strength: 1 }), owner: P4, zone: "play" },
          ...many("d", 4, P1, "deck", (i) => character({ name: `Deck ${i}` }))
        ],
        P4
      );
      declareAttackOpenWindow(t.engine, P4, [t.id("atk")], { type: "faction", playerId: P1 });
      const prompted: PlayerId[] = [];
      play(t.engine, P1, t.id("es"), { selected: { sacX: [t.id("a0"), t.id("a1")] }, variables: { x: 2 } });
      drain(t.engine, answerAll(t, prompted));
      assert.deepEqual(prompted, [P4, P2, P3]);
    });
  }
}

// ============================================================================
// Gallant Commander
// ============================================================================

const GC = "256a568b-8fe3-4eee-b50a-52026ccd5b5a"; // character: CHARGE! pay 2, destroy this card: inflict 3 damage to an opponent's faction

for (const count of [3, 4] as const) {
  const commander = () =>
    table(count, [
      { key: "gc", def: printing(GC), owner: P1, zone: "play" },
      ...res("rage", 2, P1),
      ...foes(count).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char` }), owner: p, zone: "play" as const }))
    ]);

  clause(GC, "0:ability:charge", `${count} seats: one opponent is chosen with the use; only that opponent's faction takes 3 damage`, () => {
    for (const chosen of foes(count)) {
      const t = commander();
      assert.deepEqual(askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("gc"), abilityId: "charge" }), [{ id: "opp", candidates: foes(count) }]);
      refused(() => activate(t.engine, P1, t.id("gc"), "charge"), "no opponent named");
      refused(() => activate(t.engine, P1, t.id("gc"), "charge", { players: { opp: P1 } }), "I am not an opponent");
      assert.equal(zoneOf(t.engine, t.id("gc")), "play", "nothing was paid or destroyed by the refusals");
      const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(t, p)]));
      activate(t.engine, P1, t.id("gc"), "charge", { players: { opp: chosen } });
      assert.equal(zoneOf(t.engine, t.id("gc")), "discard", "the Commander was destroyed as a cost");
      assert.equal(ready(t.engine, P1), 0, "2 paid");
      assert.equal(influenceOf(t, chosen), before[chosen]! - 3, `${chosen}'s faction took 3 damage`);
      for (const other of seats(count).filter((p) => p !== chosen)) assert.equal(influenceOf(t, other), before[other], `${other}'s faction unchanged`);
    }
  });
}

// ============================================================================
// Gideon, the Ultimate Warrior
// ============================================================================

const GD = "7d2c17ee-25ba-4523-813c-145587e15cae"; // character: attacking, battle damage to it is reduced to 0; an opponent's faction losing influence loses 1 more

for (const count of [3, 4] as const) {
  clause(GD, "1:rule", `${count} seats: while Gideon attacks any opponent, battle damage to him is reduced to 0; while he blocks he takes the full damage`, () => {
    for (const defender of foes(count)) {
      const t = table(count, [
        { key: "gd", def: printing(GD), owner: P1, zone: "play" },
        ...foes(count).map((p) => ({ key: `big-${p}`, def: character({ name: `Big ${p}`, strength: 5, speed: 3, life: 10 }), owner: p, zone: "play" as const }))
      ]);
      declareAttackBy(t.engine, P1, [t.id("gd")], { type: "faction", playerId: defender });
      t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`big-${defender}`)] });
      finishBattle(t.engine);
      assert.equal(damageOf(t, "gd"), 0, `attacking ${defender}: the 5 battle damage is reduced to 0`);
      assert.equal(zoneOf(t.engine, t.id("gd")), "play");
      assert.equal(damageOf(t, `big-${defender}`), 2, "Gideon still strikes back");
    }
    // not attacking: P2 attacks P1's faction and Gideon blocks
    const b = table(
      count,
      [
        { key: "gd", def: printing(GD), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, speed: 3, life: 10 }), owner: P2, zone: "play" }
      ],
      P2
    );
    declareAttackBy(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 });
    b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("gd")] });
    finishBattle(b.engine);
    assert.equal(damageOf(b, "gd"), 2, "blocking: the full battle damage");
  });

  clause(GD, "2:rule", `${count} seats: every opponent's faction loses 1 more influence; my own faction does not`, () => {
    // P2 and P3 activate Gallant Commanders (3 damage) against each seat in turn, Gideon being P1's
    for (const [user, victim] of [[P2, P3], [P3, P2], [P2, P1], [P3, P1]] as const) {
      const t = table(
        count,
        [
          { key: "gd", def: printing(GD), owner: P1, zone: "play" },
          { key: "gc", def: printing(GC), owner: user, zone: "play" },
          ...res("rage", 2, user)
        ],
        user
      );
      const before = influenceOf(t, victim);
      activate(t.engine, user, t.id("gc"), "charge", { players: { opp: victim } });
      assert.equal(before - influenceOf(t, victim), victim === P1 ? 3 : 4, victim === P1 ? "my faction loses the plain 3" : `${victim}'s faction loses 3 + 1`);
    }
    // P1's own Commander: P2 and P3 each lose 4, the Commander's own controller is not hurt
    for (const victim of foes(count)) {
      const t = table(count, [
        { key: "gd", def: printing(GD), owner: P1, zone: "play" },
        { key: "gc", def: printing(GC), owner: P1, zone: "play" },
        ...res("rage", 2, P1),
        ...foes(count).map((p) => ({ key: `x-${p}`, def: character({ name: `${p} char` }), owner: p, zone: "play" as const }))
      ]);
      const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(t, p)]));
      activate(t.engine, P1, t.id("gc"), "charge", { players: { opp: victim } });
      assert.equal(before[victim]! - influenceOf(t, victim), 4, `${victim}'s faction loses 4`);
      for (const other of seats(count).filter((p) => p !== victim)) assert.equal(influenceOf(t, other), before[other], `${other} unchanged`);
    }
  });
}

// ============================================================================
// Goutflame Talonclaw
// ============================================================================

const GT = "cb503376-78b8-447c-9119-734f992429c9"; // character: opponents cannot take control of it, it cannot be blocked by characters with 1 strength or less

const stealer = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  } as never);

for (const count of [3, 4] as const) {
  clause(GT, "2:rule", `${count} seats: no opponent can take control of it; the same effect takes an ordinary character`, () => {
    for (const thief of foes(count)) {
      const t = table(
        count,
        [
          { key: "gt", def: printing(GT), owner: P1, zone: "play" },
          { key: "other", def: character({ name: "Control check" }), owner: P1, zone: "play" },
          { key: "steal", def: stealer("Mutiny"), owner: thief, zone: "hand" },
          { key: "steal2", def: stealer("Mutiny 2"), owner: thief, zone: "hand" }
        ],
        thief
      );
      play(t.engine, thief, t.id("steal"), { selected: { t: [t.id("gt")] } });
      assert.equal(t.engine.state.cards[t.id("gt")]!.controllerId, P1, `${thief} could not take it`);
      assert.equal(zoneOf(t.engine, t.id("gt")), "play");
      play(t.engine, thief, t.id("steal2"), { selected: { t: [t.id("other")] } });
      assert.equal(t.engine.state.cards[t.id("other")]!.controllerId, thief, "positive control: an ordinary character is taken");
    }
  });

  clause(GT, "2:rule", `${count} seats: it cannot be blocked by a 1-strength character of whichever opponent it attacks; a 2-strength one can block`, () => {
    for (const defender of foes(count)) {
      const small = table(count, [
        { key: "gt", def: printing(GT), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Weak", strength: 1, life: 3 }), owner: defender, zone: "play" }
      ]);
      declareAttackBy(small.engine, P1, [small.id("gt")], { type: "faction", playerId: defender });
      refused(() => small.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [small.id("blk")] }), `${defender}'s 1-strength character cannot block`, /block/i);
      const big = table(count, [
        { key: "gt", def: printing(GT), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Strong", strength: 2, life: 3 }), owner: defender, zone: "play" }
      ]);
      declareAttackBy(big.engine, P1, [big.id("gt")], { type: "faction", playerId: defender });
      big.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [big.id("blk")] });
      assert.deepEqual(big.engine.state.battle!.blockingParty, [big.id("blk")], `${defender}'s 2-strength character blocks`);
    }
  });
}

// ============================================================================
// Mass Confusion
// ============================================================================

const MC = "da25a463-78da-4428-8d6b-eab6a76ade7c"; // tactic: EXTRA COST choose X, pay X, pick a player, pick X characters that player controls; Y damage divided, Y = their count - mine

for (const count of [3, 4] as const) {
  /** P1 controls 1 character, P2 5, P3 4 (and P4 3). */
  const confusion = () =>
    table(count, [
      { key: "t", def: printing(MC), owner: P1, zone: "hand" },
      ...res("rage", 4, P1),
      ...many("m", 1, P1, "play", (i) => character({ name: `Mine ${i}`, life: 9 })),
      ...many("b", 5, P2, "play", (i) => character({ name: `P2 char ${i}`, life: 9 })),
      ...many("c", 4, P3, "play", (i) => character({ name: `P3 char ${i}`, life: 9 })),
      ...(count === 4 ? many("e", 3, P4, "play", (i) => character({ name: `P4 char ${i}`, life: 9 })) : [])
    ]);
  const prefix: Record<string, string> = { [P1]: "m", [P2]: "b", [P3]: "c", [P4]: "e" };
  const sel = (t: Table, who: PlayerId, n: number) => ({ pl: [t.engine.state.players[who]!.factionId!], cs: Array.from({ length: n }, (_, i) => t.id(`${prefix[who]}${i}`)) });
  const run = (t: Table, who: PlayerId, x: number, shares?: number[]) => {
    const s = sel(t, who, x);
    play(t.engine, P1, t.id("t"), { selected: s, variables: { x } });
    let seen: number | undefined;
    drain(t.engine, (pc) => {
      if (pc.kind === "distributeAmong") {
        seen = pc.amount as number;
        return { kind: "distributeAmong", shares: Object.fromEntries(s.cs.map((id, i) => [id, shares ? (shares[i] ?? 0) : i === 0 ? (pc.amount as number) : 0])) };
      }
      return declineAll(pc);
    });
    return seen;
  };
  const dmgs = (t: Table, who: PlayerId, n: number) => Array.from({ length: n }, (_, i) => damageOf(t, `${prefix[who]}${i}`));

  clause(MC, "0:extraCost", `${count} seats: I pick any one player and then X characters that player controls; another player's characters are refused`, () => {
    for (const who of seats(count)) {
      const t = confusion();
      for (const wrong of seats(count).filter((p) => p !== who)) {
        refused(() => play(t.engine, P1, t.id("t"), { selected: { ...sel(t, who, 1), cs: [t.id(`${prefix[wrong]}0`), t.id(`${prefix[who]}0`)] }, variables: { x: 2 } }), `a ${wrong} character while the picked player is ${who}`);
      }
      assert.equal(zoneOf(t.engine, t.id("t")), "hand");
      assert.equal(ready(t.engine, P1), 4, "nothing paid");
      run(t, who, who === P1 ? 1 : 2);
      assert.equal(zoneOf(t.engine, t.id("t")), "discard", `${who} was a legal pick`);
    }
  });

  clause(MC, "1:rule", `${count} seats: Y is the picked player's character count minus mine, whichever player was picked; the other players' counts are ignored`, () => {
    const p3 = confusion();
    assert.equal(run(p3, P3, 2, [2, 1]), 3, "P3 controls 4, I control 1: Y = 3");
    assert.deepEqual(dmgs(p3, P3, 4), [2, 1, 0, 0]);
    assert.deepEqual(dmgs(p3, P2, 5), [0, 0, 0, 0, 0], "P2's characters take nothing");
    const p2 = confusion();
    assert.equal(run(p2, P2, 2, [3, 1]), 4, "P2 controls 5: Y = 4");
    assert.deepEqual(dmgs(p2, P2, 5), [3, 1, 0, 0, 0]);
    assert.deepEqual(dmgs(p2, P3, 4), [0, 0, 0, 0]);
    const me = confusion();
    run(me, P1, 1, [1]);
    assert.deepEqual(dmgs(me, P1, 1), [0], "picking myself: Y = 1 - 1 = 0, no damage");
    if (count === 4) {
      const p4 = confusion();
      assert.equal(run(p4, P4, 1, [2]), 2, "P4 controls 3: Y = 2");
      assert.deepEqual(dmgs(p4, P4, 3), [2, 0, 0]);
    }
  });
}

// ============================================================================
// Phalludrix, the Impotenator
// ============================================================================

const PH = "513334b0-8ed9-4d1b-9eea-86af96f9247e"; // item: opponent-caused discards may be put back; EQUIP; attached character +2 strength; restore it at the start of each opponent's turn

/** A free tactic by which its caster discards one card from the hand of an opponent of the caster. */
const stripOpponent = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "opponents" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
  } as never);
/** A free tactic by which its caster discards one card from its own hand. */
const stripSelf = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
  } as never);

for (const count of [3, 4] as const) {
  clause(PH, "1:rule", `${count} seats: a discard caused by an effect any opponent controls lets me put the cards back; my own effect does not`, () => {
    for (const striker of foes(count)) {
      const t = table(
        count,
        [
          { key: "ph", def: printing(PH), owner: P1, zone: "play", attachedToKey: "host" },
          { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
          ...many("h", 2, P1, "hand", (i) => character({ name: `Hand ${i}` })),
          { key: "strip", def: stripOpponent("Strip"), owner: striker, zone: "hand" }
        ],
        striker
      );
      play(t.engine, striker, t.id("strip"), { selected: { t: [t.id("h0")] } });
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "replacementChoice", `${striker}'s effect: I may put the card back`);
      assert.equal(pc.playerId, P1);
      answer(t.engine, "replacementChoice", { apply: true });
      drain(t.engine, declineAll);
      assert.equal(zoneOf(t.engine, t.id("h0")), "hand", "put back into my hand");
      assert.equal(zoneOf(t.engine, t.id("h1")), "hand");
    }
    const own = table(count, [
      { key: "ph", def: printing(PH), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...many("h", 2, P1, "hand", (i) => character({ name: `Hand ${i}` })),
      { key: "strip", def: stripSelf("Strip self"), owner: P1, zone: "hand" }
    ]);
    play(own.engine, P1, own.id("strip"), { selected: { t: [own.id("h0")] } });
    assert.equal(pending(own.engine), undefined, "my own effect: no choice");
    assert.equal(zoneOf(own.engine, own.id("h0")), "discard");
  });

  clause(PH, "2:ability", `${count} seats: only its controller activates EQUIP; X is 3 for a non-adriel character, whoever controls it`, () => {
    for (const host of foes(count)) {
      const t = table(count, [
        { key: "ph", def: printing(PH), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe" }), owner: host, zone: "play" },
        ...res("rage", 3, P1),
        ...res("rage", 3, host)
      ]);
      refused(() => activate(t.engine, host, t.id("ph"), "equip", { selected: { eq: [t.id("foe")] } }), "only the controller can use EQUIP");
      activate(t.engine, P1, t.id("ph"), "equip", { selected: { eq: [t.id("foe")] } });
      assert.equal(t.engine.state.cards[t.id("ph")]!.attachedTo, t.id("foe"), `attached to ${host}'s character`);
      assert.equal(ready(t.engine, P1), 0, "X = 3 paid");
    }
  });

  clause(PH, "3:rule", `${count} seats: the attached character gains 2 strength whichever player controls it`, () => {
    for (const host of seats(count)) {
      const t = table(count, [
        { key: "ph", def: printing(PH), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "host", def: character({ name: "Host", strength: 1 }), owner: host, zone: "play" },
        { key: "other", def: character({ name: "Other", strength: 1 }), owner: host, zone: "play" }
      ]);
      assert.equal(t.engine.getStat(t.id("host"), "strength"), 3, `${host}'s attached character: 1 + 2`);
      assert.equal(t.engine.getStat(t.id("other"), "strength"), 1);
    }
  });

  clause(PH, "4:rule", `${count} seats: at the start of each opponent's turn I may restore the attached character; no offer at the start of my own turn`, () => {
    const t = table(count, [
      { key: "ph", def: printing(PH), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play", depleted: true },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", depleted: true }
    ]);
    const offer = (turnOf: PlayerId, accept: boolean) => {
      t.engine.state.cards[t.id("host")]!.depleted = true;
      endTurn(t.engine, turnOf === P2 ? P1 : seats(count)[seats(count).indexOf(turnOf) - 1]!);
      assert.equal(t.engine.state.activePlayerId, turnOf);
      const pc = pending(t.engine);
      assert.equal(pc?.kind, "chooserSelectsOption", `offered at the start of ${turnOf}'s turn`);
      assert.equal(pc?.playerId, P1);
      answer(t.engine, "chooserSelectsOption", { index: accept ? 1 : 0 });
      drain(t.engine, declineAll);
      assert.equal(t.engine.state.cards[t.id("host")]!.depleted, accept ? false : true, accept ? "restored" : "declined: still depleted");
    };
    offer(P2, true);
    assert.equal(t.engine.state.cards[t.id("other")]!.depleted, true, "other characters are not restored");
    for (const p of foes(count).slice(1)) offer(p, true);
    t.engine.state.cards[t.id("host")]!.depleted = true;
    endTurn(t.engine, seats(count)[count - 1]!);
    assert.equal(t.engine.state.activePlayerId, P1);
    assert.equal(pending(t.engine), undefined, "no offer at the start of my own turn");
  });
}

// ============================================================================
// Plunging Shriever
// ============================================================================

const PS = "ec2a5b27-94ff-4b64-912b-b4fef8895da7"; // character: FLY AWAY remove an item in an opponent's discard pile from the game; flip this card face-down

for (const count of [3, 4] as const) {
  const shriever = () =>
    table(count, [
      { key: "ps", def: printing(PS), owner: P1, zone: "play" },
      { key: "mine", def: item({ name: "My discarded item" }), owner: P1, zone: "discard" },
      ...foes(count).flatMap((p) => [
        { key: `i-${p}`, def: item({ name: `${p} discarded item` }), owner: p, zone: "discard" as const },
        { key: `ch-${p}`, def: character({ name: `${p} discarded character` }), owner: p, zone: "discard" as const }
      ])
    ]);

  clause(PS, "1:ability:fly-away", `${count} seats: the cost removes an item from any opponent's discard pile (no opponent is chosen); my own pile and non-items are not eligible`, () => {
    const probe = shriever();
    assert.equal(askedPlayers(probe.engine, { type: "activateAbility", playerId: P1, cardId: probe.id("ps"), abilityId: "fly-away", selected: { gone: [probe.id(`i-${P3}`)] } }), undefined, "no player is asked for");
    refused(() => activate(probe.engine, P1, probe.id("ps"), "fly-away", { selected: { gone: [probe.id("mine")] } }), "my own discard pile");
    refused(() => activate(probe.engine, P1, probe.id("ps"), "fly-away", { selected: { gone: [probe.id(`ch-${P2}`)] } }), "a character is not an item");
    assert.equal(probe.engine.state.cards[probe.id("ps")]!.faceDown ?? false, false, "refusals flip nothing");
    for (const picked of foes(count)) {
      const t = shriever();
      const before = Object.fromEntries(foes(count).map((p) => [p, [...t.engine.state.players[p]!.discard]]));
      activate(t.engine, P1, t.id("ps"), "fly-away", { selected: { gone: [t.id(`i-${picked}`)] } });
      assert.equal(zoneOf(t.engine, t.id(`i-${picked}`)), "removed", `${picked}'s item was removed from the game`);
      assert.deepEqual(t.engine.state.players[picked]!.discard, before[picked]!.filter((id) => id !== t.id(`i-${picked}`)));
      for (const other of foes(count).filter((p) => p !== picked)) assert.deepEqual(t.engine.state.players[other]!.discard, before[other], `${other}'s discard pile unchanged`);
      assert.equal(t.engine.state.cards[t.id("ps")]!.faceDown, true, "the Shriever flipped face-down");
      assert.equal(t.engine.state.cards[t.id("ps")]!.controllerId, P1, "under its owner's control");
    }
  });
}

// ============================================================================
// Robustical Badass
// ============================================================================

const RB = "c1cc2de0-3430-42e2-af02-ff9418a3bdd5"; // character: [R][R][R]: at the start of your turn you may inflict 1 damage to an opponent's faction

for (const count of [3, 4] as const) {
  const last = seats(count)[count - 1]!;
  const badass = () =>
    table(
      count,
      [
        { key: "rb", def: printing(RB), owner: P1, zone: "play" },
        ...res("rage", 3, P1),
        ...many("d", 6, P1, "deck", (i) => character({ name: `Deck ${i}` }))
      ],
      last
    );
  const startTurn = (t: Table, plan: { inflict: boolean; opponent?: PlayerId }): string[] => {
    const seen: string[] = [];
    t.engine.perform({ type: "endTurn", playerId: last });
    drain(t.engine, (raw) => {
      const pc = raw as { kind: string; [key: string]: unknown };
      seen.push(pc.kind);
      if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as string[])[0] };
      if (pc.kind === "choosePlayer") return { kind: "choosePlayer", playerId: plan.opponent ?? P2 };
      if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: plan.inflict ? 1 : 0 };
      return declineAll(pc);
    });
    return seen;
  };

  clause(RB, "0:rule@rrr", `${count} seats: at the start of my turn I may inflict 1 damage to one opponent's faction; only the chosen opponent loses influence`, () => {
    for (const chosen of foes(count)) {
      const t = badass();
      const before = Object.fromEntries(seats(count).map((p) => [p, influenceOf(t, p)]));
      const seen = startTurn(t, { inflict: true, opponent: chosen });
      assert.equal(t.engine.state.activePlayerId, P1);
      assert.equal(seen.filter((k) => k === "choosePlayer").length, 1, "exactly one opponent is chosen");
      assert.equal(influenceOf(t, chosen), before[chosen]! - 1, `${chosen} took 1 damage`);
      for (const other of seats(count).filter((p) => p !== chosen)) assert.equal(influenceOf(t, other), before[other], `${other} unchanged`);
    }
    const declined = badass();
    const before = foes(count).map((p) => influenceOf(declined, p));
    startTurn(declined, { inflict: false });
    assert.deepEqual(foes(count).map((p) => influenceOf(declined, p)), before, "declined: nobody is damaged");
  });
}

// ============================================================================
// Spitting Sarume
// ============================================================================

const SS = "ece06645-25f1-4680-9785-30a0a22b7837"; // character: when it enters play, inflict 1 damage to all characters an opponent controls

for (const count of [3, 4] as const) {
  const sarume = () =>
    table(count, [
      { key: "ss", def: printing(SS), owner: P1, zone: "hand" },
      ...res("rage", 5, P1),
      { key: "d", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      ...foes(count).flatMap((p) => many(`c-${p}-`, p === P2 ? 2 : 1, p, "play", (i) => character({ name: `${p} char ${i}`, life: 3 })))
    ]);

  clause(SS, "0:rule", `${count} seats: one opponent is chosen when the trigger resolves; all of that opponent's characters take 1 damage and nobody else's`, () => {
    for (const chosen of foes(count)) {
      const t = sarume();
      let chosenCount = 0;
      play(t.engine, P1, t.id("ss"));
      drain(t.engine, (pc) => {
        if (pc.kind === "choosePlayer") {
          chosenCount++;
          return { kind: "choosePlayer", playerId: chosen };
        }
        return declineAll(pc);
      });
      assert.equal(zoneOf(t.engine, t.id("ss")), "play");
      assert.equal(chosenCount, 1, "exactly one opponent is chosen");
      for (const p of foes(count)) for (let i = 0; i < (p === P2 ? 2 : 1); i++) assert.equal(damageOf(t, `c-${p}-${i}`), p === chosen ? 1 : 0, `${p} char ${i}`);
      assert.equal(damageOf(t, "d"), 0, "my own character takes none");
      assert.equal(damageOf(t, "ss"), 0, "the Sarume itself takes none");
    }
  });
}

// ============================================================================
// Storm the Gates
// ============================================================================

const STORM = "6e733b56-222d-4d95-9be4-9c0a2056b1fa"; // tactic: EXTRA COST destroy a character you own, pick a character your opponent owns; 5 damage to it; if destroyed draw a card

for (const count of [3, 4] as const) {
  const storm = (markLife = 3) =>
    table(count, [
      { key: "t", def: printing(STORM), owner: P1, zone: "hand" },
      ...res("rage", 2, P1),
      { key: "sac", def: character({ name: "Sac", life: 2 }), owner: P1, zone: "play" },
      ...foes(count).flatMap((p) => [
        { key: `mark-${p}`, def: character({ name: `${p} mark`, life: markLife }), owner: p, zone: "play" as const },
        { key: `big-${p}`, def: character({ name: `${p} big`, life: 9 }), owner: p, zone: "play" as const }
      ]),
      ...many("d", 3, P1, "deck", (i) => character({ name: `Deck ${i}` }))
    ]);
  const sel = (t: Table, chosen: PlayerId, mark = `mark-${chosen}`) => ({ sac: [t.id("sac")], mark: [t.id(mark)] });

  clause(STORM, "0:extraCost", `${count} seats: one opponent is chosen with the play; I destroy a character I own and pick a character only the chosen opponent owns`, () => {
    for (const chosen of foes(count)) {
      const t = storm();
      assert.deepEqual(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("t"), selected: sel(t, chosen) }), [{ id: "opponent", candidates: foes(count) }]);
      refused(() => play(t.engine, P1, t.id("t"), { selected: sel(t, chosen) }), "no opponent chosen");
      for (const other of foes(count).filter((p) => p !== chosen)) {
        refused(() => play(t.engine, P1, t.id("t"), { selected: sel(t, other), players: { opponent: chosen } }), `${other}'s character while ${chosen} is the chosen opponent`);
      }
      assert.equal(zoneOf(t.engine, t.id("t")), "hand");
      assert.equal(zoneOf(t.engine, t.id("sac")), "play", "nothing was destroyed by the refusals");
      assert.equal(ready(t.engine, P1), 2, "nothing paid by the refusals");
      play(t.engine, P1, t.id("t"), { selected: sel(t, chosen), players: { opponent: chosen } });
      assert.equal(zoneOf(t.engine, t.id("t")), "discard");
      assert.equal(zoneOf(t.engine, t.id("sac")), "discard", "my character was destroyed as the cost");
    }
  });

  clause(STORM, "1:rule", `${count} seats: 5 damage goes to the picked character of the chosen opponent; if it is destroyed I draw a card; the other opponents' characters are untouched`, () => {
    for (const chosen of foes(count)) {
      const t = storm();
      play(t.engine, P1, t.id("t"), { selected: sel(t, chosen), players: { opponent: chosen } });
      assert.equal(zoneOf(t.engine, t.id(`mark-${chosen}`)), "discard", "life 3 is destroyed by 5 damage");
      assert.equal(hand(t.engine, P1).length, 1, "I drew a card");
      for (const other of foes(count).filter((p) => p !== chosen)) {
        assert.equal(zoneOf(t.engine, t.id(`mark-${other}`)), "play");
        assert.equal(damageOf(t, `mark-${other}`), 0);
      }
      assert.equal(damageOf(t, `big-${chosen}`), 0, "the chosen opponent's other characters are untouched");
    }
    const survivor = storm();
    play(survivor.engine, P1, survivor.id("t"), { selected: sel(survivor, P2, `big-${P2}`), players: { opponent: P2 } });
    assert.equal(damageOf(survivor, `big-${P2}`), 5);
    assert.equal(hand(survivor.engine, P1).length, 0, "not destroyed: no card drawn");
  });
}

// ============================================================================
// The Enemy's Head
// ============================================================================

const HEAD = "bfd10394-2019-4c7c-87b5-11cf033a2869"; // item: when a character an opponent controls is destroyed you may pay 1 and put a token on this card; your characters gain 1 strength per token

const killAny = () =>
  tactic({
    name: "KillAny",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
const tokensOn = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.counters?.token ?? 0;
const payAnswer = (pay: boolean) => (pc: { kind: string; [key: string]: unknown }) => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc));

for (const count of [3, 4] as const) {
  const head = () =>
    table(count, [
      { key: "h", def: printing(HEAD), owner: P1, zone: "play" },
      ...res("rage", 4, P1),
      { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1, zone: "play" },
      ...foes(count).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char`, strength: 1 }), owner: p, zone: "play" as const })),
      ...many("k", 4, P1, "hand", () => killAny())
    ]);
  const kill = (t: Table, n: number, victim: string, pay = true) => {
    play(t.engine, P1, t.id(`k${n}`), { selected: { t: [t.id(victim)] } });
    drain(t.engine, payAnswer(pay));
  };

  clause(HEAD, "0:rule", `${count} seats: a character of any opponent being destroyed lets me pay 1 for a token; my own character being destroyed does not`, () => {
    for (const p of foes(count)) {
      const t = head();
      kill(t, 0, `c-${p}`);
      assert.equal(zoneOf(t.engine, t.id(`c-${p}`)), "discard");
      assert.equal(tokensOn(t, "h"), 1, `${p}'s character: a token`);
      assert.equal(ready(t.engine, P1), 3, "exactly 1 paid");
    }
    const own = head();
    kill(own, 0, "mine");
    assert.equal(zoneOf(own.engine, own.id("mine")), "discard");
    assert.equal(tokensOn(own, "h"), 0, "my own character: no trigger");
    assert.equal(ready(own.engine, P1), 4, "nothing paid");
    const declined = head();
    kill(declined, 0, `c-${P2}`, false);
    assert.equal(tokensOn(declined, "h"), 0, "declined: no token");
  });

  clause(HEAD, "1:rule", `${count} seats: my characters gain 1 strength per token; no opponent's character gains anything`, () => {
    const t = head();
    for (const [n, p] of foes(count).entries()) kill(t, n, `c-${p}`);
    assert.equal(tokensOn(t, "h"), count - 1);
    assert.equal(t.engine.getStat(t.id("mine"), "strength"), 1 + (count - 1), "my character: +1 per token");
    for (const p of foes(count)) {
      // the destroyed characters are gone; a fresh opposing character gains nothing
      assert.equal(zoneOf(t.engine, t.id(`c-${p}`)), "discard");
    }
    const probe = table(count, [
      { key: "h", def: printing(HEAD), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1, zone: "play" },
      ...foes(count).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char`, strength: 1 }), owner: p, zone: "play" as const }))
    ]);
    assert.equal(probe.engine.getStat(probe.id("mine"), "strength"), 3);
    for (const p of foes(count)) assert.equal(probe.engine.getStat(probe.id(`c-${p}`), "strength"), 1, `${p}'s character gains nothing`);
  });
}

// ============================================================================
// Watchtower
// ============================================================================

const TOWER = "59b277a8-0b23-4bc6-8325-eca973a06a2e"; // location: when a character enters play under an opponent's control, inflict 1 damage to it

for (const count of [3, 4] as const) {
  clause(TOWER, "1:rule", `${count} seats: a character entering play under any opponent's control takes 1 damage; one entering under mine takes none`, () => {
    for (const who of seats(count)) {
      const t = table(
        count,
        [
          { key: "tower", def: printing(TOWER), owner: P1, zone: "play" },
          { key: "newcomer", def: character({ name: "Newcomer", cost: 0, life: 4 }), owner: who, zone: "hand" }
        ],
        who
      );
      play(t.engine, who, t.id("newcomer"));
      assert.equal(zoneOf(t.engine, t.id("newcomer")), "play");
      assert.equal(damageOf(t, "newcomer"), who === P1 ? 0 : 1, who === P1 ? "under my control: no damage" : `entering under ${who}'s control: 1 damage`);
    }
  });
}
