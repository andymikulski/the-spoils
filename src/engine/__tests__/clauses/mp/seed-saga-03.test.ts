// Multiplayer clause tests, seed-saga part 3: 3- and 4-seat tables, real catalog printings, public actions only.
// Spec: data/card-tests/mp-spec/seed-saga.json.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { clause, refused } from "../_clause.js";
import { activate, answer, askedPlayers, choosePlayer, declineAll, deck, drain, hand, influence, many, pending, play, printing, ready, res, table, zoneOf, P1, P2, P3, P4 } from "./_mp.js";
import type { CardPlacement } from "./_mp.js";
import { declareAttackBy, declareAttackOpenWindow } from "../_battle.js";
import { endTurn } from "../_turn.js";
import { character, item, location, tactic } from "../../support/fixtures.js";

const seats = (count: number): PlayerId[] => (count === 3 ? [P1, P2, P3] : [P1, P2, P3, P4]);
const others = (count: number, p: PlayerId): PlayerId[] => seats(count).filter((s) => s !== p);
const owned = (engine: SpoilsEngine, id: CardInstanceId): PlayerId => engine.state.cards[id]!.controllerId as PlayerId;

// ============================================================================
// Thabbashite Wizard
// ============================================================================
const WIZARD = "9470335e-1d2b-46a5-861e-04527371ffb2";

for (const count of [3, 4] as const) {
  clause(WIZARD, "0:rule", `${count} seats: each player is offered 'draw up to 2' in turn order from the active player, each draws from their own deck`, () => {
    for (const active of [P1, P2] as const) {
      const t = table(
        count,
        [
          { key: "c", def: printing(WIZARD), owner: active, zone: "hand" },
          ...res("obsession", 3, active),
          ...seats(count).flatMap((p) => many(`d-${p}-`, 5, p, "deck", (i) => character({ name: `${p} deck ${i}` })))
        ],
        active
      );
      const decks = new Map(seats(count).map((p) => [p, deck(t.engine, p)] as const));
      const order = seats(count);
      const expected = [...order.slice(order.indexOf(active)), ...order.slice(0, order.indexOf(active))];
      play(t.engine, active, t.id("c"));
      const asked: PlayerId[] = [];
      const want = new Map<PlayerId, number>(expected.map((p, i) => [p, i % 3] as const)); // 0, 1, 2, 0 cards
      while (pending(t.engine)) {
        const pc = pending(t.engine)!;
        assert.equal(pc.kind, "chooseNumber");
        asked.push(pc.playerId as PlayerId);
        answer(t.engine, "chooseNumber", { value: want.get(pc.playerId as PlayerId)! });
      }
      assert.deepEqual(asked, expected, "every player is asked once, in turn order from the active player");
      for (const p of seats(count)) {
        const n = want.get(p)!;
        assert.deepEqual(hand(t.engine, p), decks.get(p)!.slice(0, n), `${p} drew ${n} from their own deck`);
        assert.equal(deck(t.engine, p).length, 5 - n);
      }
    }
  });
}

// ============================================================================
// Tumescent Guilt Bladder
// ============================================================================
const TGB = "a7351707-259c-4414-b734-962d4dc33634";
const tokensOn = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id]!.counters?.token ?? 0;
const deckPad = (count: number): CardPlacement[] => seats(count).flatMap((p) => many(`d-${p}-`, 6, p, "deck", (i) => character({ name: `${p} deck ${i}` })));
const activeOf = (engine: SpoilsEngine): PlayerId => engine.state.activePlayerId as PlayerId;

const bladder = (count: number, o: { tokens?: number; active?: PlayerId } = {}) =>
  table(
    count,
    [
      { key: "b", def: printing(TGB), owner: P1, zone: "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      ...many("h", 2, P1, "hand", (i) => character({ name: `P1 hand ${i}` })),
      ...deckPad(count)
    ],
    o.active ?? P1
  );

for (const count of [3, 4] as const) {
  clause(TGB, "0:rule", `${count} seats: only the end of the controller's own turn adds a token and costs influence; no other seat's turn end does`, () => {
    const t = bladder(count);
    const before = new Map(seats(count).map((p) => [p, influence(t.engine, p)] as const));
    endTurn(t.engine, P1);
    const pc = pending(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", "the controller is offered the resource play");
    assert.equal(pc.playerId, P1);
    answer(t.engine, "chooserSelectsTarget", { selected: [] });
    assert.equal(tokensOn(t.engine, t.id("b")), 1);
    assert.equal(influence(t.engine, P1), before.get(P1)! - 1, "X = 1");
    for (const p of others(count, P1)) {
      assert.equal(activeOf(t.engine), p, `it is ${p}'s turn`);
      endTurn(t.engine, p);
      assert.equal(pending(t.engine), undefined, `ending ${p}'s turn raises nothing`);
      assert.equal(tokensOn(t.engine, t.id("b")), 1, `no token at the end of ${p}'s turn`);
      for (const q of seats(count)) assert.equal(influence(t.engine, q), q === P1 ? before.get(P1)! - 1 : before.get(q), `${q} influence after ${p}'s turn ended`);
    }
    assert.equal(activeOf(t.engine), P1);
  });

  clause(TGB, "1:rule", `${count} seats: with 3+ tokens at a turn start the controller picks ONE opponent (never themself); only that opponent takes control and the tokens go`, () => {
    for (const ending of [seats(count)[count - 1]!, P2] as const) {
      for (const chosen of others(count, P1)) {
        const t = bladder(count, { tokens: 3, active: ending });
        endTurn(t.engine, ending);
        const pc = pending(t.engine)!;
        assert.equal(pc.kind, "choosePlayer", "the opponent is chosen as the trigger resolves");
        assert.equal(pc.playerId, P1, "the Bladder's controller chooses");
        assert.deepEqual([...(pc.candidates as PlayerId[])].sort(), others(count, P1), "only opponents are offered");
        choosePlayer(t.engine, chosen);
        assert.equal(pending(t.engine), undefined);
        assert.equal(owned(t.engine, t.id("b")), chosen, `${chosen} took control`);
        assert.equal(tokensOn(t.engine, t.id("b")), 0, "all tokens removed");
        for (const p of others(count, P1).filter((q) => q !== chosen)) assert.notEqual(owned(t.engine, t.id("b")), p, `${p} did not take control`);
      }
    }
  });

  clause(TGB, "1:rule", `${count} seats: with fewer than 3 tokens nothing is asked and nobody takes control`, () => {
    const t = bladder(count, { tokens: 2, active: seats(count)[count - 1]! });
    endTurn(t.engine, seats(count)[count - 1]!);
    assert.equal(pending(t.engine), undefined);
    assert.equal(owned(t.engine, t.id("b")), P1);
    assert.equal(tokensOn(t.engine, t.id("b")), 2);
  });
}

// ============================================================================
// Unbearable Torture
// ============================================================================
const TORT = "36e74211-ebde-4634-a28b-9fdfec8d9ef6";

for (const count of [3, 4] as const) {
  clause(TORT, "2:ability:recur", `${count} seats: RECUR can pick a character in the void of any seat; it goes on top of its owner's deck; no opponent is chosen`, () => {
    for (const who of seats(count)) {
      const t = table(count, [
        { key: "t", def: printing(TORT), owner: P1, zone: "discard" },
        ...res("obsession", 2, P1),
        ...seats(count).map((p) => ({ key: `v-${p}`, def: character({ name: `${p} void` }), owner: p, zone: "void" as const })),
        ...deckPad(count)
      ]);
      assert.equal(askedPlayers(t.engine, { type: "activateAbility", playerId: P1, cardId: t.id("t"), abilityId: "recur" }), undefined, "no player is named");
      activate(t.engine, P1, t.id("t"), "recur", { selected: { rev: [t.id(`v-${who}`)] } });
      assert.equal(pending(t.engine), undefined);
      assert.equal(zoneOf(t.engine, t.id(`v-${who}`)), "deck");
      assert.equal(deck(t.engine, who)[0], t.id(`v-${who}`), `on top of ${who}'s deck`);
      for (const p of seats(count).filter((q) => q !== who)) {
        assert.equal(zoneOf(t.engine, t.id(`v-${p}`)), "void", `${p}'s character stays in the void`);
        assert.equal(deck(t.engine, p).length, 6, `${p}'s deck is untouched`);
      }
      assert.equal(zoneOf(t.engine, t.id("t")), "removed", "the tactic is removed from the game");
    }
  });
}

// ============================================================================
// Architectural Restitution
// ============================================================================
const AR = "6b38d626-997f-4869-8ee8-8188785a02f4";

/** P1 holds Architectural Restitution with a location in the discard; `active` has a character that can attack. */
const arTable = (count: number, active: PlayerId) =>
  table(
    count,
    [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Fallen Hall", structure: 5 }), owner: P1, zone: "discard" },
      { key: "ploc", def: location({ name: "Standing Hall", structure: 5 }), owner: P1, zone: "play" },
      ...seats(count).map((p) => ({ key: `atk-${p}`, def: character({ name: `${p} attacker`, strength: 2, life: 5, speed: 3 }), owner: p, zone: "play" as const })),
      ...res("greed", 2, P1),
      ...res("rage", 2, P1),
      ...deckPad(count)
    ],
    active
  );
/** Seats ahead of `player` in the open response window pass, until `player` holds priority. */
function passUntilPriority(engine: SpoilsEngine, player: PlayerId): void {
  for (let guard = 0; guard < 10 && engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player; guard++) {
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId } as never);
  }
}
const target = (engine: SpoilsEngine) => engine.state.battle?.target as { type: string; cardId?: string; playerId?: string } | undefined;
const arCast = (t: ReturnType<typeof arTable>) => play(t.engine, P1, t.id("ar"), { selected: { l: [t.id("loc")] } });

for (const count of [3, 4] as const) {
  clause(AR, "0:extraCost", `${count} seats: may be deployed while ANY opponent attacks P1 (faction or location); refused when the attack is on another seat or P1 attacks`, () => {
    for (const attacker of others(count, P1)) {
      const faction = arTable(count, attacker);
      declareAttackOpenWindow(faction.engine, attacker, [faction.id(`atk-${attacker}`)], { type: "faction", playerId: P1 });
      arCast(faction);
      assert.equal(zoneOf(faction.engine, faction.id("loc")), "play", `${attacker} attacks P1's faction: deployed`);
      const loc = arTable(count, attacker);
      declareAttackOpenWindow(loc.engine, attacker, [loc.id(`atk-${attacker}`)], { type: "card", cardId: loc.id("ploc") });
      arCast(loc);
      assert.equal(zoneOf(loc.engine, loc.id("loc")), "play", `${attacker} attacks P1's location: deployed`);
    }
    // an attack that is not on P1 (an opponent attacks another opponent): P1 is not being attacked
    for (const attacker of others(count, P1)) {
      for (const victim of others(count, P1).filter((p) => p !== attacker)) {
        const t = arTable(count, attacker);
        declareAttackOpenWindow(t.engine, attacker, [t.id(`atk-${attacker}`)], { type: "faction", playerId: victim });
        assert.ok(t.engine.state.battle, "the attack is on");
        passUntilPriority(t.engine, P1); // the victim (and any other seat in front of P1) pass, so P1 holds priority
        assert.equal(t.engine.state.responseWindow?.priorityPlayerId, P1);
        refused(() => arCast(t), `${attacker} attacks ${victim}, P1 is not attacked`);
        assert.equal(zoneOf(t.engine, t.id("ar")), "hand");
        assert.equal(zoneOf(t.engine, t.id("loc")), "discard");
      }
    }
    // P1 attacking is not "an opponent attacking you"
    const mine = arTable(count, P1);
    mine.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [mine.id(`atk-${P1}`)], target: { type: "faction", playerId: P2 } });
    assert.equal(mine.engine.state.responseWindow?.priorityPlayerId, P1, "P1 holds priority as the attacker");
    refused(() => arCast(mine), "P1 is the attacker");
    assert.equal(zoneOf(mine.engine, mine.id("ar")), "hand");
  });

  clause(AR, "1:rule", `${count} seats: only the attack on P1 is redirected to the location; other attackers and their characters are unaffected`, () => {
    for (const attacker of others(count, P1)) {
      const t = arTable(count, attacker);
      declareAttackOpenWindow(t.engine, attacker, [t.id(`atk-${attacker}`)], { type: "faction", playerId: P1 });
      const battle = t.engine.state.battle!;
      assert.equal(battle.attackerPlayerId, attacker);
      arCast(t);
      assert.equal(zoneOf(t.engine, t.id("loc")), "play");
      assert.equal(owned(t.engine, t.id("loc")), P1, "the location enters under P1's control");
      assert.deepEqual(target(t.engine), { type: "card", cardId: t.id("loc") }, `${attacker}'s attack now targets the location`);
      assert.equal(t.engine.state.battle!.attackerPlayerId, attacker, "the same battle, the same attacker");
      assert.equal(t.engine.state.battle!.defenderPlayerId, P1);
      for (const p of others(count, P1).filter((q) => q !== attacker)) assert.equal(zoneOf(t.engine, t.id(`atk-${p}`)), "play", `${p}'s characters are unaffected`);
    }
  });
}

// ============================================================================
// Department of Rejections
// ============================================================================
const DEPT = "a3a69878-9f2a-49d3-9c4b-81887058890a";

/** An item whose SEARCH ability lets its controller pick a card of their own deck (a search of their own deck). */
const tutorItem = (): CardDefinition =>
  item({
    name: "Tutor",
    behavior: {
      abilities: [
        {
          id: "search",
          type: "activated",
          effects: [
            { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "found", count: 1, optional: true, selector: { owner: "self", zone: "deck" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] }
          ]
        }
      ]
    }
  } as never);
/** A character with an ability costing 1 (draws a card), usable from play or, for `from: "discard"`, from the discard pile. */
const workerChar = (from: "play" | "discard" = "play"): CardDefinition =>
  character({
    name: "Worker",
    behavior: { abilities: [{ id: "work", type: "activated", ...(from === "discard" ? { activationZone: "discard" } : {}), costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);

const deptTable = (count: number, who: PlayerId, cards: CardPlacement[]) =>
  table(count, [{ key: "dept", def: printing(DEPT), owner: P1, zone: "play" }, ...cards, ...deckPad(count)], who);
const searchOffered = (t: ReturnType<typeof table>, who: PlayerId): boolean => {
  activate(t.engine, who, t.id("tu"), "search");
  const pc = pending(t.engine);
  if (!pc) return false;
  assert.equal(pc.kind, "chooserSelectsTarget", "the search prompt, not an opponent prompt");
  assert.equal(pc.playerId, who);
  return true;
};

for (const count of [3, 4] as const) {
  clause(DEPT, "0:rule", `${count} seats: EVERY opponent pays 2 to search their own deck, with no opponent chosen; the controller searches free`, () => {
    for (const who of seats(count)) {
      const tu = { key: "tu", def: tutorItem(), owner: who, zone: "play" as const };
      const tax = who === P1 ? 0 : 2;
      const exact = deptTable(count, who, [tu, ...res("rage", 2, who)]);
      assert.equal(searchOffered(exact, who), true, `${who} with 2 ready can search`);
      assert.equal(ready(exact.engine, who), 2 - tax, `${who} paid ${tax}`);
      if (who !== P1) {
        const poor = deptTable(count, who, [tu, ...res("rage", 1, who)]);
        assert.equal(searchOffered(poor, who), false, `${who} with 1 ready cannot pay the 2 tax`);
        assert.equal(ready(poor.engine, who), 1, "nothing paid");
      } else {
        const none = deptTable(count, who, [tu]);
        assert.equal(searchOffered(none, who), true, "the controller searches with nothing to pay");
      }
    }
  });

  clause(DEPT, "1:rule", `${count} seats: EVERY opponent pays 2 extra for a character's ability (also from the discard pile); the controller pays nothing extra`, () => {
    for (const who of seats(count)) {
      const tax = who === P1 ? 0 : 2;
      for (const from of ["play", "discard"] as const) {
        const w = { key: "w", def: workerChar(from), owner: who, zone: from };
        const enough = deptTable(count, who, [w, ...res("rage", 1 + tax, who)]);
        activate(enough.engine, who, enough.id("w"), "work");
        assert.equal(ready(enough.engine, who), 0, `${who} paid 1 + ${tax} (${from})`);
        assert.equal(hand(enough.engine, who).length, 1, "the ability resolved");
        if (tax > 0) {
          const poor = deptTable(count, who, [w, ...res("rage", tax, who)]);
          refused(() => activate(poor.engine, who, poor.id("w"), "work"), `${who}: ${tax} ready is one short of 1 + ${tax} (${from})`, /Costs cannot be paid|pay|afford|resource/i);
          assert.equal(ready(poor.engine, who), tax, "nothing paid on refusal");
        }
      }
    }
  });
}

// ============================================================================
// Executive Order #6370u7
// ============================================================================
const EXEC = "f3d514d8-0d1d-4796-97e5-7640bcffae6a";
const isDepleted = (engine: SpoilsEngine, id: CardInstanceId): boolean => engine.state.cards[id]!.depleted === true;

for (const count of [3, 4] as const) {
  clause(EXEC, "0:rule", `${count} seats: at the start of EVERY opponent's turn P1 is offered pay 2 + pick; the picked character stays depleted through its controller's Restore Rule; nothing on P1's own turn`, () => {
    const t = table(count, [
      { key: "eo", def: printing(EXEC), owner: P1, zone: "play" },
      ...res("rage", 2 * (count - 1), P1),
      { key: "mine", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
      ...seats(count)
        .slice(1)
        .flatMap((p) => [
          { key: `pick-${p}`, def: character({ name: `${p} picked` }), owner: p, zone: "play" as const, depleted: true },
          { key: `other-${p}`, def: character({ name: `${p} other` }), owner: p, zone: "play" as const, depleted: true }
        ]),
      ...deckPad(count)
    ]);
    for (const p of others(count, P1)) {
      endTurn(t.engine, activeOf(t.engine));
      assert.equal(activeOf(t.engine), p, `it is ${p}'s turn`);
      const offer = pending(t.engine)!;
      assert.equal(offer.kind, "mayPay", `P1 is offered it at the start of ${p}'s turn`);
      assert.equal(offer.playerId, P1);
      const before = ready(t.engine, P1);
      answer(t.engine, "mayPay", { pay: true });
      const pick = pending(t.engine)!;
      assert.equal(pick.kind, "chooserSelectsTarget");
      assert.equal(pick.playerId, P1);
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`pick-${p}`)] });
      assert.equal(pending(t.engine), undefined);
      assert.equal(ready(t.engine, P1), before - 2, "exactly 2 paid");
      assert.equal(isDepleted(t.engine, t.id(`pick-${p}`)), true, `${p}'s picked character is depleted and not restored by ${p}'s Restore Rule`);
      assert.equal(isDepleted(t.engine, t.id(`other-${p}`)), false, `${p}'s other character was restored normally`);
      for (const q of others(count, P1).filter((x) => x !== p)) assert.equal(isDepleted(t.engine, t.id(`pick-${q}`)), true, `${q}'s characters are not touched during ${p}'s turn`);
    }
    endTurn(t.engine, activeOf(t.engine));
    assert.equal(activeOf(t.engine), P1);
    assert.equal(pending(t.engine), undefined, "no offer at the start of P1's own turn");
  });
}

// ============================================================================
// Gideon's Legacy
// ============================================================================
const LEGACY = "05cfbc47-195f-4da5-81d0-f6e7f1da6b15";

for (const count of [3, 4] as const) {
  clause(LEGACY, "1:ability:hide", `${count} seats: HIDE gives every player except the picked card's owner X influence; the owner gets none`, () => {
    for (const [owner, cost] of [[P2, 3], [P1, 3], [P3, 2], ...(count === 4 ? ([[P4, 4]] as const) : [])] as Array<[PlayerId, number]>) {
      const t = table(count, [
        { key: "g", def: printing(LEGACY), owner: P1, zone: "play" },
        ...seats(count).map((p) => ({ key: `dc-${p}`, def: character({ name: `${p} discard`, cost: p === owner ? cost : 7 }), owner: p, zone: "discard" as const })),
        ...deckPad(count)
      ]);
      const before = new Map(seats(count).map((p) => [p, influence(t.engine, p)] as const));
      activate(t.engine, P1, t.id("g"), "hide", { selected: { card: [t.id(`dc-${owner}`)] } });
      assert.equal(pending(t.engine), undefined);
      assert.equal(zoneOf(t.engine, t.id("g")), "discard", "Gideon's Legacy is destroyed");
      assert.equal(zoneOf(t.engine, t.id(`dc-${owner}`)), "deck", "the card is shuffled into its owner's deck");
      assert.ok(deck(t.engine, owner).includes(t.id(`dc-${owner}`)));
      for (const p of seats(count)) {
        assert.equal(influence(t.engine, p) - before.get(p)!, p === owner ? 0 : cost, `${p} after picking ${owner}'s card of cost ${cost}`);
      }
    }
  });
}

// ============================================================================
// High Court of Demands / Theocratic Senate of Marduun: "your opponents cannot attack your faction"
// ============================================================================
const COURT = "47bfebb7-3e70-4011-b960-9409a7d6dbfe";
const SENATE = "01fc9f16-7ec3-4ace-a6f4-47689cb8e3ed";

/** P1 controls `guard`; every seat has one character able to attack; P1 and P2 each own a location. */
const guardTable = (count: number, guard: string, active: PlayerId) =>
  table(
    count,
    [
      { key: "guard", def: printing(guard), owner: P1, zone: "play" },
      { key: "ploc", def: location({ name: "P1 hall", structure: 5 }), owner: P1, zone: "play" },
      ...seats(count).map((p) => ({ key: `atk-${p}`, def: character({ name: `${p} attacker`, strength: 2, life: 5, speed: 3 }), owner: p, zone: "play" as const })),
      ...deckPad(count)
    ],
    active
  );

for (const [card, key, name] of [[COURT, "1:rule", "High Court of Demands"], [SENATE, "1:rule", "Theocratic Senate of Marduun"]] as const) {
  for (const count of [3, 4] as const) {
    clause(card, key, `${count} seats: no opponent can attack P1's faction (${name}); opponents attack each other, P1 attacks them, and P1's location stays attackable`, () => {
      for (const attacker of others(count, P1)) {
        const t = guardTable(count, card, attacker);
        refused(() => declareAttackBy(t.engine, attacker, [t.id(`atk-${attacker}`)], { type: "faction", playerId: P1 }), `${attacker} cannot attack P1's faction`, /faction|attack/i);
        assert.equal(t.engine.state.battle, undefined, "no battle began");
        for (const victim of others(count, P1).filter((p) => p !== attacker)) {
          const other = guardTable(count, card, attacker);
          declareAttackBy(other.engine, attacker, [other.id(`atk-${attacker}`)], { type: "faction", playerId: victim });
          assert.ok(other.engine.state.battle, `${attacker} can attack ${victim}'s faction`);
          assert.equal(other.engine.state.battle!.defenderPlayerId, victim);
        }
        const loc = guardTable(count, card, attacker);
        declareAttackBy(loc.engine, attacker, [loc.id(`atk-${attacker}`)], { type: "card", cardId: loc.id("ploc") });
        assert.ok(loc.engine.state.battle, `${attacker} can attack P1's location`);
      }
      for (const victim of others(count, P1)) {
        const mine = guardTable(count, card, P1);
        declareAttackBy(mine.engine, P1, [mine.id(`atk-${P1}`)], { type: "faction", playerId: victim });
        assert.ok(mine.engine.state.battle, `P1 can attack ${victim}'s faction`);
      }
    });
  }
}

// ============================================================================
// Subordinate Demotivation
// ============================================================================
const DEMOT = "4d54e821-c642-4b77-86a2-58514c2f1173";

const demotTable = (count: number, costs: Record<string, number[]>) =>
  table(count, [
    { key: "sd", def: printing(DEMOT), owner: P1, zone: "hand" },
    ...res("greed", 3, P1),
    ...Object.entries(costs).flatMap(([p, list]) => list.map((cost, i) => ({ key: `${p}-${i}`, def: character({ name: `${p} cost ${cost} #${i}`, cost }), owner: p as PlayerId, zone: "play" as const }))),
    ...deckPad(count)
  ]);
const alive = (t: ReturnType<typeof table>, key: string): boolean => zoneOf(t.engine, t.id(key)) === "play";

for (const count of [3, 4] as const) {
  clause(DEMOT, "0:rule", `${count} seats: P1 chooses exactly one opponent; the lowest numeric cost is found among that opponent's characters only`, () => {
    const costs: Record<string, number[]> = { [P1]: [1], [P2]: [3, 5], [P3]: [2, 6], ...(count === 4 ? { [P4]: [4, 8] } : {}) };
    const lowest: Record<string, number> = { [P2]: 0, [P3]: 0, [P4]: 0 };
    for (const chosen of others(count, P1)) {
      const t = demotTable(count, costs);
      assert.deepEqual(askedPlayers(t.engine, { type: "playCard", playerId: P1, cardId: t.id("sd") }), [{ id: "opp", candidates: others(count, P1) }], "one opponent is asked for, never P1");
      refused(() => play(t.engine, P1, t.id("sd")), "no opponent named");
      play(t.engine, P1, t.id("sd"), { players: { opp: chosen } });
      assert.equal(pending(t.engine), undefined, "no tie: nothing left to decide");
      for (const [p, list] of Object.entries(costs)) {
        list.forEach((_, i) => {
          const expectDead = p === chosen && i === lowest[p]!;
          assert.equal(alive(t, `${p}-${i}`), !expectDead, `${p}'s character #${i} (cost ${list[i]}) with ${chosen} chosen`);
        });
      }
    }
  });

  clause(DEMOT, "0:rule", `${count} seats: a tie among the chosen opponent's characters is decided by P1, from that opponent's tied characters only; a tie across opponents is irrelevant`, () => {
    // tie inside P2: both cost 2; P3 also has a cost 2 character that is never a candidate
    const tie = demotTable(count, { [P1]: [1], [P2]: [2, 2, 5], [P3]: [2, 4], ...(count === 4 ? { [P4]: [2] } : {}) });
    play(tie.engine, P1, tie.id("sd"), { players: { opp: P2 } });
    const pc = pending(tie.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", "P1 decides the tie");
    assert.equal(pc.playerId, P1);
    refused(() => answer(tie.engine, "chooserSelectsTarget", { selected: [tie.id(`${P3}-0`)] }), "another opponent's tied character");
    refused(() => answer(tie.engine, "chooserSelectsTarget", { selected: [tie.id(`${P2}-2`)] }), "the chosen opponent's character that is not tied");
    answer(tie.engine, "chooserSelectsTarget", { selected: [tie.id(`${P2}-1`)] });
    assert.equal(alive(tie, `${P2}-1`), false, "the picked tied character is destroyed");
    assert.equal(alive(tie, `${P2}-0`), true, "the other tied character stays");
    assert.equal(alive(tie, `${P3}-0`), true, "the other opponent's cost 2 character stays");
    // a tie only ACROSS opponents (both lowest cost 3): choosing P2 destroys P2's, with no prompt
    const across = demotTable(count, { [P1]: [1], [P2]: [3, 5], [P3]: [3, 6], ...(count === 4 ? { [P4]: [3] } : {}) });
    play(across.engine, P1, across.id("sd"), { players: { opp: P2 } });
    assert.equal(pending(across.engine), undefined, "no prompt: the chosen opponent has one lowest character");
    assert.equal(alive(across, `${P2}-0`), false);
    assert.equal(alive(across, `${P3}-0`), true);
  });
}

// ============================================================================
// Assistant Mud Whisperer / Master Mud Whisperer / Braggadocian Aide / P3pp3r 0f 1n54n17y:
// "At the start of each opponent's turn ..."
// ============================================================================
const ASSISTANT = "d6aaf1ff-0e80-48b4-b130-e023480d140c";
const MASTER = "d105de07-198b-4f0d-a8e6-681f0afb9e61";
const AIDE = "23bc4bf8-9ea9-486a-8fcb-24ed798a3f11";
const PEPPER = "3cd39b3f-5db3-4d53-95de-16b2b502890c";

/** Ends the active player's turn (the next seat's turn start raises whatever it raises). */
const next = (engine: SpoilsEngine): void => endTurn(engine, activeOf(engine));

for (const count of [3, 4] as const) {
  clause(ASSISTANT, "0:rule", `${count} seats: at the start of EACH opponent's turn P1 is offered a separate pick-and-restore; not at the start of P1's own turn`, () => {
    const t = table(count, [
      { key: "mud", def: printing(ASSISTANT), owner: P1, zone: "play" },
      ...many("own", count - 1, P1, "play", (i) => character({ name: `P1 char ${i}` })).map((c) => ({ ...c, depleted: true })),
      ...deckPad(count)
    ]);
    others(count, P1).forEach((p, i) => {
      next(t.engine);
      assert.equal(activeOf(t.engine), p);
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget", `offered at the start of ${p}'s turn`);
      assert.equal(pc.playerId, P1);
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`own${i}`)] });
      assert.equal(pending(t.engine), undefined);
      for (let j = 0; j < count - 1; j++) assert.equal(t.engine.state.cards[t.id(`own${j}`)]!.depleted === true, j > i, `own${j} after ${p}'s turn start`);
    });
    next(t.engine);
    assert.equal(activeOf(t.engine), P1);
    assert.equal(pending(t.engine), undefined, "no offer at the start of P1's own turn");
  });

  clause(MASTER, "0:rule", `${count} seats: at the start of EACH opponent's turn P1 may restore all their characters; not on P1's own turn`, () => {
    for (let accept = 0; accept < count - 1; accept++) {
      const t = table(count, [
        { key: "mud", def: printing(MASTER), owner: P1, zone: "play", depleted: true },
        ...many("own", 2, P1, "play", (i) => character({ name: `P1 char ${i}` })).map((c) => ({ ...c, depleted: true })),
        ...deckPad(count)
      ]);
      const allDepleted = (): boolean => ["mud", "own0", "own1"].every((k) => t.engine.state.cards[t.id(k)]!.depleted === true);
      for (const [i, p] of others(count, P1).entries()) {
        next(t.engine);
        assert.equal(activeOf(t.engine), p);
        const pc = pending(t.engine)!;
        assert.equal(pc.kind, "chooserSelectsOption", `offered at the start of ${p}'s turn`);
        assert.equal(pc.playerId, P1);
        if (i < accept) {
          answer(t.engine, "chooserSelectsOption", { index: 0 });
          assert.equal(allDepleted(), true, "declining restores nothing");
        } else if (i === accept) {
          answer(t.engine, "chooserSelectsOption", { index: 1 });
          for (const k of ["mud", "own0", "own1"]) assert.equal(t.engine.state.cards[t.id(k)]!.depleted === true, false, `${k} restored at ${p}'s turn start`);
          break;
        }
      }
    }
    const own = table(count, [{ key: "mud", def: printing(MASTER), owner: P1, zone: "play" }, ...deckPad(count)], seats(count)[count - 1]!);
    next(own.engine);
    assert.equal(activeOf(own.engine), P1);
    assert.equal(pending(own.engine), undefined, "no offer at the start of P1's own turn");
  });

  clause(AIDE, "0:provides", `${count} seats: the Aide provides [E] to P1's faction only; no opponent's faction gains it`, () => {
    for (const who of seats(count)) {
      const t = table(
        count,
        [
          { key: "aide", def: printing(AIDE), owner: P1, zone: "play" },
          { key: "needE", def: character({ name: "Needs E", cost: 0, threshold: "e" } as never), owner: who, zone: "hand" },
          ...res("rage", 2, who),
          ...deckPad(count)
        ],
        who
      );
      if (who === P1) {
        play(t.engine, P1, t.id("needE"));
        assert.equal(zoneOf(t.engine, t.id("needE")), "play", "P1's [E]-threshold card is deployable on the Aide's [E]");
      } else {
        refused(() => play(t.engine, who, t.id("needE")), `${who} gets no [E] from P1's Aide`);
        assert.equal(zoneOf(t.engine, t.id("needE")), "hand");
      }
    }
  });

  clause(AIDE, "1:rule", `${count} seats: at the start of EACH opponent's turn P1 may pick a resource attached to P1's faction and detach it; not on P1's own turn`, () => {
    const attachedRes = (key: string): CardPlacement => ({ key, def: item({ name: key, cost: 0 }), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" });
    const t = table(count, [
      { key: "aide", def: printing(AIDE), owner: P1, zone: "play" },
      ...Array.from({ length: count - 1 }, (_, i) => attachedRes(`sp${i}`)),
      ...deckPad(count)
    ]);
    const attached = (k: string): boolean => {
      const a = t.engine.state.cards[t.id(k)]!.attachedTo;
      return a !== undefined && a !== null;
    };
    others(count, P1).forEach((p, i) => {
      next(t.engine);
      assert.equal(activeOf(t.engine), p);
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "selectTargets", `offered at the start of ${p}'s turn`);
      assert.equal(pc.playerId, P1);
      answer(t.engine, "selectTargets", { selected: { res: [t.id(`sp${i}`)] } });
      assert.equal(pending(t.engine), undefined);
      for (let j = 0; j < count - 1; j++) assert.equal(attached(`sp${j}`), j > i, `sp${j} after ${p}'s turn start`);
    });
    next(t.engine);
    assert.equal(activeOf(t.engine), P1);
    assert.equal(pending(t.engine), undefined, "no offer at the start of P1's own turn");
  });

  clause(PEPPER, "1:rule", `${count} seats: the attached character gains 3 strength and 3 life whoever controls it; unattached characters gain nothing`, () => {
    const t = table(count, [
      { key: "h1", def: character({ name: "P1 host" }), owner: P1, zone: "play" },
      { key: "pp1", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "h1" },
      ...seats(count)
        .slice(1)
        .flatMap((p) => [
          { key: `h-${p}`, def: character({ name: `${p} host` }), owner: p, zone: "play" as const },
          { key: `pp-${p}`, def: printing(PEPPER), owner: P1, zone: "play" as const, attachedToKey: `h-${p}` },
          { key: `plain-${p}`, def: character({ name: `${p} plain` }), owner: p, zone: "play" as const }
        ]),
      ...deckPad(count)
    ]);
    const stats = (k: string): number[] => [t.engine.getStat(t.id(k), "strength"), t.engine.getStat(t.id(k), "life")];
    assert.deepEqual(stats("h1"), [4, 6], "P1's host");
    for (const p of others(count, P1)) {
      assert.deepEqual(stats(`h-${p}`), [4, 6], `${p}'s host gains it too`);
      assert.deepEqual(stats(`plain-${p}`), [1, 3], `${p}'s unattached character gains nothing`);
    }
  });

  clause(PEPPER, "2:rule", `${count} seats: at the start of EACH opponent's turn the attached character is restored; not at the start of P1's own turn`, () => {
    // the host belongs to P1: every opponent's turn start restores it (P1's Restore Rule is not what does it)
    for (const s of others(count, P1)) {
      const prev = seats(count)[seats(count).indexOf(s) - 1]!;
      const t = table(
        count,
        [
          { key: "h", def: character({ name: "P1 host" }), owner: P1, zone: "play", depleted: true },
          { key: "pp", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "h" },
          { key: "loose", def: character({ name: "P1 loose" }), owner: P1, zone: "play", depleted: true },
          ...deckPad(count)
        ],
        prev
      );
      next(t.engine);
      assert.equal(activeOf(t.engine), s);
      assert.equal(t.engine.state.cards[t.id("h")]!.depleted === true, false, `the host is restored at the start of ${s}'s turn`);
      assert.equal(t.engine.state.cards[t.id("loose")]!.depleted === true, true, "a character without the Pepper is not restored");
    }
    // the host belongs to P2: the Pepper (P1's) still restores it at the start of the other opponents' turns, but not on P1's own turn
    for (const s of [...others(count, P1).filter((p) => p !== P2), P1]) {
      const prev = seats(count)[(seats(count).indexOf(s) + count - 1) % count]!;
      const t = table(
        count,
        [
          { key: "h", def: character({ name: "P2 host" }), owner: P2, zone: "play", depleted: true },
          { key: "pp", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "h" },
          ...deckPad(count)
        ],
        prev
      );
      next(t.engine);
      assert.equal(activeOf(t.engine), s);
      assert.equal(t.engine.state.cards[t.id("h")]!.depleted === true, s === P1, s === P1 ? "P1's own turn start: the Pepper does not restore it" : `restored at the start of ${s}'s turn`);
    }
  });
}

// ============================================================================
// Drivey Car
// ============================================================================
const CAR = "d74d373d-baab-4886-b893-93cc0f1f84ed";

const smite = (): CardDefinition =>
  tactic({
    name: "Smite",
    cost: 0,
    behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
const micromajigs = (engine: SpoilsEngine, controller: PlayerId): CardInstanceId[] =>
  Object.keys(engine.state.cards).filter((id) => {
    const card = engine.state.cards[id]!;
    return card.zone === "play" && card.controllerId === controller && engine.getDefinition(id).name === "Micromajig";
  });

for (const count of [3, 4] as const) {
  clause(CAR, "0:rule", `${count} seats: P1 chooses one opponent as the Car leaves play; X counts only that opponent's characters minus P1's`, () => {
    const sizes: Record<string, number> = { [P1]: 1, [P2]: 4, [P3]: 2, [P4]: 3 };
    for (const chosen of others(count, P1)) {
      const t = table(count, [
        { key: "car", def: printing(CAR), owner: P1, zone: "play" },
        { key: "smite", def: smite(), owner: P1, zone: "hand" },
        ...seats(count).flatMap((p) => many(`c-${p}-`, sizes[p]!, p, "play", (i) => character({ name: `${p} char ${i}`, strength: 1, life: 5 }))),
        ...deckPad(count)
      ]);
      play(t.engine, P1, t.id("smite"), { selected: { t: [t.id("car")] } });
      assert.equal(zoneOf(t.engine, t.id("car")), "discard");
      const pc = pending(t.engine)!;
      assert.equal(pc.kind, "choosePlayer", "the opponent is chosen as the ability resolves");
      assert.equal(pc.playerId, P1);
      assert.deepEqual([...(pc.candidates as PlayerId[])].sort(), others(count, P1));
      choosePlayer(t.engine, chosen);
      assert.equal(pending(t.engine), undefined);
      const x = sizes[chosen]! - sizes[P1]!;
      assert.equal(micromajigs(t.engine, P1).length, x, `${chosen} chosen: ${sizes[chosen]} - ${sizes[P1]} = ${x} tokens`);
      for (const p of others(count, P1)) assert.equal(micromajigs(t.engine, p).length, 0, `none for ${p}`);
    }
  });
}

// ============================================================================
// Mountainous Golem
// ============================================================================
const GOLEM = "fe48adc4-e74d-46ce-9b4c-c94ff00f932b";

const thief = (): CardDefinition =>
  item({
    name: "Thief",
    cost: 0,
    behavior: { abilities: [{ id: "steal", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  } as never);

for (const count of [3, 4] as const) {
  clause(GOLEM, "0:rule", `${count} seats: no opponent can take control of the Golem; P1 keeps control throughout (an ordinary character can be taken)`, () => {
    for (const who of others(count, P1)) {
      const t = table(
        count,
        [
          { key: "golem", def: printing(GOLEM), owner: P1, zone: "play" },
          { key: "plain", def: character({ name: "P1 plain" }), owner: P1, zone: "play" },
          { key: "th", def: thief(), owner: who, zone: "play" },
          ...deckPad(count)
        ],
        who
      );
      activate(t.engine, who, t.id("th"), "steal", { selected: { t: [t.id("golem")] } });
      drain(t.engine, declineAll);
      assert.equal(owned(t.engine, t.id("golem")), P1, `${who}'s effect fails to take the Golem`);
      assert.equal(zoneOf(t.engine, t.id("golem")), "play");
      const control = table(
        count,
        [
          { key: "golem", def: printing(GOLEM), owner: P1, zone: "play" },
          { key: "plain", def: character({ name: "P1 plain" }), owner: P1, zone: "play" },
          { key: "th", def: thief(), owner: who, zone: "play" },
          ...deckPad(count)
        ],
        who
      );
      activate(control.engine, who, control.id("th"), "steal", { selected: { t: [control.id("plain")] } });
      assert.equal(owned(control.engine, control.id("plain")), who, `control: ${who} does take an ordinary character`);
    }
  });
}

// ============================================================================
// Mud Prison
// ============================================================================
const PRISON = "73aa24ca-a9d9-480b-a83e-efa6571a5307";

for (const count of [3, 4] as const) {
  clause(PRISON, "0:rule", `${count} seats: at the start of P1's turn the pick may be ANY opponent's character (never P1's); no opponent is chosen; only the picked one gets a token`, () => {
    const last = seats(count)[count - 1]!;
    for (const chosen of others(count, P1)) {
      const t = table(
        count,
        [
          { key: "mp", def: printing(PRISON), owner: P1, zone: "play" },
          { key: "mine", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
          ...seats(count).slice(1).map((p) => ({ key: `c-${p}`, def: character({ name: `${p} char` }), owner: p, zone: "play" as const })),
          ...res("rage", 2, P1),
          ...deckPad(count)
        ],
        last
      );
      next(t.engine);
      assert.equal(activeOf(t.engine), P1);
      const pay = pending(t.engine)!;
      assert.equal(pay.kind, "mayPay");
      assert.equal(pay.playerId, P1);
      const before = ready(t.engine, P1);
      answer(t.engine, "mayPay", { pay: true });
      const pick = pending(t.engine)!;
      assert.equal(pick.kind, "chooserSelectsTarget", "the pick comes straight after the payment: no opponent is chosen first");
      assert.equal(pick.playerId, P1);
      refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("mine")] }), "P1's own character");
      answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`c-${chosen}`)] });
      assert.equal(pending(t.engine), undefined);
      assert.equal(ready(t.engine, P1), before - 1, "1 paid");
      assert.equal(tokensOn(t.engine, t.id(`c-${chosen}`)), 1, `${chosen}'s character got the token`);
      for (const p of others(count, P1).filter((q) => q !== chosen)) assert.equal(tokensOn(t.engine, t.id(`c-${p}`)), 0, `${p}'s character got none`);
      assert.equal(tokensOn(t.engine, t.id("mine")), 0);
    }
  });

  clause(PRISON, "1:rule", `${count} seats: characters of EVERY opponent with a token have no rules text; untokened ones and P1's own tokened one keep theirs`, () => {
    const brute = (name: string): CardDefinition =>
      character({
        name,
        strength: 2,
        life: 3,
        behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }] }] }
      } as never);
    const t = table(count, [
      { key: "mp", def: printing(PRISON), owner: P1, zone: "play" },
      ...seats(count).flatMap((p) => [
        { key: `tok-${p}`, def: brute(`${p} tokened`), owner: p, zone: "play" as const, counters: { token: 1 } },
        { key: `plain-${p}`, def: brute(`${p} plain`), owner: p, zone: "play" as const }
      ]),
      ...deckPad(count)
    ]);
    const strength = (k: string): number => t.engine.getStat(t.id(k), "strength");
    for (const p of others(count, P1)) {
      assert.equal(strength(`tok-${p}`), 2, `${p}'s tokened character has no rules text (printed 2 only)`);
      assert.equal(strength(`plain-${p}`), 5, `${p}'s untokened character keeps its text`);
    }
    assert.equal(strength(`tok-${P1}`), 5, "P1's own tokened character keeps its text");
    assert.equal(strength(`plain-${P1}`), 5);
  });
}
// @@END
