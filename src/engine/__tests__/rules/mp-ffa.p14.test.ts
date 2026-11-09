// Multiplayer (free-for-all) rules, part 14: text written from another player's point of view at every table size
// (Meat of the Mountain, Free Trade Agreement in the converted data form), "cannot be blocked by that player", looking
// at an opponent's face-down resources, and "your opponent cannot respond" selecting its opponent with the play.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-other-pov, MPX-select, MPX-both, MPX-vocab-an,
// MPX-hidden, MPX-respond, MPX-attack.
// Every numbered point is tested at 3 and at 4 seats, with the two-seat reduction next to it.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { redactLogFor } from "../../../engine.js";
import cardsJson from "../../../data/cards.js";
import { buildGame, character, P1, P2, P3, resolvePendingResponses, resourceCard, tactic, type CardPlacement } from "../support/fixtures.js";
import { freeTradeInActingForm, meatInActingForm } from "../support/povForms.js";
import { rule } from "./_rule.js";
import { ACTIVATED, baseline, board, cast, lost, pending, plainSeats, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const ALL_TABLES = [2, ...TABLES] as const;
const named = (id: string) => ({ type: "chosenPlayer", id });
const realCard = (name: string): CardDefinition => {
  const found = (cardsJson as CardDefinition[]).find(card => card.name === name);
  assert.ok(found, `${name} is in the catalog`);
  return found;
};

/** Answers every prompt with `policy` (undefined: stop) and returns the kind and player of each prompt, in order. */
function drive(engine: SpoilsEngine, policy: (choice: NonNullable<SpoilsEngine["state"]["pendingChoice"]>) => unknown): Array<[string, PlayerId]> {
  const asked: Array<[string, PlayerId]> = [];
  for (let guard = 0; guard < 40; guard++) {
    resolvePendingResponses(engine);
    const choice = engine.state.pendingChoice;
    if (!choice) break;
    if (choice.kind === "orderTriggers") {
      engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "orderTriggers", next: choice.triggers[0] } } as never);
      continue;
    }
    const answer = policy(choice);
    if (answer === undefined) break;
    asked.push([choice.kind, choice.playerId]);
    engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: answer } as never);
  }
  return asked;
}
const optionIndex = (choice: { options?: unknown }, pattern: RegExp): number =>
  (choice.options as Array<{ label?: string }>).findIndex(option => pattern.test(option.label ?? ""));

// ---------------------------------------------------------------------------
// Meat of the Mountain: "that player's opponent discards a card" (MPQ-P10).
// ---------------------------------------------------------------------------

describe("opponentFrom acting — Meat of the Mountain in the converted data form", () => {
  const MEAT = meatInActingForm(realCard("Meat of the Mountain"));
  const DRAWER = character({ name: "Drawer", behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as CardDefinition["behavior"] });
  const hand = (t: Table, who: PlayerId) => t.engine.state.players[who]!.hand.length;

  /** P1 controls Meat with one token; P2 (the active player) draws; every seat has three cards in hand and in its deck. */
  function meatTable(count: number): Table {
    const seats = seatsFor(count);
    const cards: CardPlacement[] = [
      { key: "meat", def: MEAT, owner: P1, counters: { token: 1 } },
      { key: "drawer", def: DRAWER, owner: P2 },
      ...seats.flatMap(owner =>
        [1, 2, 3].flatMap(i => [
          { key: `h-${owner}-${i}`, def: tactic({ name: `Hand ${owner} ${i}` }), owner, zone: "hand" as const },
          { key: `d-${owner}-${i}`, def: character({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const }
        ])
      )
    ];
    const built = buildGame({ ...plainSeats(count), activePlayerId: P2, turn: 2, cards });
    return { engine: built.engine, id: built.id, seats };
  }

  /** P2 draws and removes the token (0 TOKENS: that player's opponent discards a card); `pickOpponent` answers who P2 selects. */
  function removeToken(t: Table, pickOpponent: PlayerId | undefined): Array<[string, PlayerId]> {
    t.engine.perform({ type: "activateAbility", playerId: P2, cardId: t.id("drawer"), abilityId: "dr" } as never);
    return drive(t.engine, choice => {
      if (choice.kind === "choosePlayer") return { kind: "choosePlayer", playerId: pickOpponent };
      if (choice.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: optionIndex(choice, /remove/i) };
      if (choice.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [t.engine.state.players[choice.playerId]!.hand[0]] };
      return undefined;
    });
  }

  for (const count of TABLES) {
    const seats = seatsFor(count);
    const others = seats.filter(seat => seat !== P2);
    for (const victim of others) {
      rule(["MPX-other-pov", "MPX-select"], `${count} seats: P2 draws and selects ${victim}, who is the one to discard (the card's controller only when selected)`, () => {
        const t = meatTable(count);
        const before = Object.fromEntries(seats.map(seat => [seat, hand(t, seat)]));
        const asked = removeToken(t, victim);
        assert.deepEqual(asked[0], ["choosePlayer", P2], "the drawer selects, not the card's controller");
        assert.deepEqual(asked.filter(([kind]) => kind === "choosePlayer").length, 1, "one selection per trigger");
        assert.deepEqual(asked.find(([kind]) => kind === "chooserSelectsTarget"), ["chooserSelectsTarget", victim], "the selected opponent discards");
        for (const seat of seats) {
          const drew = seat === P2 ? 1 : 0;
          const discarded = seat === victim ? 1 : 0;
          assert.equal(hand(t, seat), before[seat]! + drew - discarded, `${seat}'s hand`);
        }
      });
    }

    rule(["MPX-other-pov"], `${count} seats: the drawer's candidates are their own opponents, the card's controller included`, () => {
      const t = meatTable(count);
      t.engine.perform({ type: "activateAbility", playerId: P2, cardId: t.id("drawer"), abilityId: "dr" } as never);
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P2);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [...seats.slice(2), P1]);
    });
  }

  rule(["MPX-other-pov", "MPX-select"], "2 seats: P2 draws and nobody selects; P2's opponent, the card's controller, discards", () => {
    const t = meatTable(2);
    const before = { p1: hand(t, P1), p2: hand(t, P2) };
    const asked = removeToken(t, undefined);
    assert.deepEqual(asked.map(([kind]) => kind), ["chooserSelectsOption", "chooserSelectsTarget"]);
    assert.deepEqual(asked[0], ["chooserSelectsOption", P2], "the drawer decides about the token");
    assert.deepEqual(asked[1], ["chooserSelectsTarget", P1], "P2's opponent discards from their own hand");
    assert.equal(hand(t, P1), before.p1 - 1);
    assert.equal(hand(t, P2), before.p2 + 1);
  });

  rule(["MPX-other-pov"], "2 seats: the controller's own draw still names the controller's opponent", () => {
    const own =character({ name: "Own Drawer", behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as CardDefinition["behavior"] });
    const built = buildGame({ ...plainSeats(2), cards: [{ key: "meat", def: MEAT, owner: P1, counters: { token: 1 } }, { key: "own", def: own, owner: P1 }, ...[1, 2].map(i => ({ key: `dk-${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })), { key: "oh", def: tactic({ name: "Opp Hand" }), owner: P2, zone: "hand" }] });
    built.engine.perform({ type: "activateAbility", playerId: P1, cardId: built.id("own"), abilityId: "dr" } as never);
    const asked = drive(built.engine, choice =>
      choice.kind === "chooserSelectsOption"
        ? { kind: "chooserSelectsOption", index: optionIndex(choice, /remove/i) }
        : choice.kind === "chooserSelectsTarget"
          ? { kind: "chooserSelectsTarget", selected: [built.engine.state.players[choice.playerId]!.hand[0]] }
          : undefined
    );
    assert.deepEqual(asked[1], ["chooserSelectsTarget", P2]);
  });
});

// ---------------------------------------------------------------------------
// Free Trade Agreement in the converted data form: one selection per trigger.
// ---------------------------------------------------------------------------

describe("opponentFrom acting — Free Trade Agreement in the converted data form", () => {
  const AGREEMENT = freeTradeInActingForm(realCard("Free Trade Agreement"));
  const MENU = ["draw", "play", "pair draw", "pair play"];

  /** P1 controls the Agreement; P1 ends their turn so P2's turn starts; the option `option` (0-3) is chosen by P2. */
  function startOfP2Turn(count: number, option: number): { asked: Array<[string, PlayerId]>; t: Table } {
    const seats = seatsFor(count);
    const built = buildGame({
      ...plainSeats(count),
      cards: [
        { key: "fta", def: AGREEMENT, owner: P1 },
        ...seats.flatMap(owner =>
          [1, 2, 3, 4].flatMap(i => [
            { key: `h-${owner}-${i}`, def: tactic({ name: `Hand ${owner} ${i}` }), owner, zone: "hand" as const },
            { key: `d-${owner}-${i}`, def: character({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const }
          ])
        )
      ]
    });
    const t: Table = { engine: built.engine, id: built.id, seats };
    t.engine.perform({ type: "endTurn", playerId: P1 } as never);
    const asked = drive(t.engine, choice => {
      if (choice.kind === "choosePlayer") return { kind: "choosePlayer", playerId: (choice as unknown as { candidates: string[] }).candidates[0] };
      if (choice.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: option };
      if (choice.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (choice.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [] };
      return undefined;
    });
    return { asked, t };
  }

  for (const count of TABLES) {
    const seats = seatsFor(count);
    for (const option of [0, 1, 2, 3]) {
      rule(["MPX-other-pov", "MPX-select"], `${count} seats, option ${option + 1} (${MENU[option]}): the active player is asked for exactly one opponent, whichever option they take`, () => {
        const { asked, t } = startOfP2Turn(count, option);
        assert.equal(t.engine.state.activePlayerId, P2);
        const selections = asked.filter(([kind]) => kind === "choosePlayer");
        assert.deepEqual(selections, [["choosePlayer", P2]], "one selection, made by the player whose turn it is");
        assert.deepEqual(asked.find(([kind]) => kind === "chooserSelectsOption"), ["chooserSelectsOption", P2], "that player picks the option");
        const chosen = seats[2]!;
        const involved = new Set(asked.filter(([kind]) => kind !== "choosePlayer" && kind !== "chooserSelectsOption").map(([, who]) => who));
        // The chosen opponent (the first candidate, left of P2) takes part in the opponent options and in the pair options; nobody else does.
        for (const who of involved) assert.ok(who === P2 || who === chosen, `${who} took part`);
        if (option >= 2) assert.ok(involved.has(chosen), "both players of the pair act");
      });
    }
  }

  for (const option of [0, 1, 2, 3]) {
    rule(["MPX-other-pov"], `2 seats, option ${option + 1} (${MENU[option]}): nobody is asked for an opponent; the active player's one opponent is the other player`, () => {
      const { asked } = startOfP2Turn(2, option);
      assert.equal(asked.filter(([kind]) => kind === "choosePlayer").length, 0);
      assert.deepEqual(asked[0], ["chooserSelectsOption", P2]);
      const others = new Set(asked.slice(1).map(([, who]) => who));
      if (option === 0) assert.deepEqual([...others].sort(), [P1, P2], "P2 may draw and P1, their opponent, may play a resource");
      if (option === 1) assert.deepEqual([...others].sort(), [P1, P2], "P2 may play a resource and P1, their opponent, may draw");
      if (option >= 2) assert.deepEqual([...others].sort(), [P1, P2], "both players act");
    });
  }
});

// ---------------------------------------------------------------------------
// "This turn, this card cannot be blocked by those players" (MPX-attack, MPX-an-superlative).
// ---------------------------------------------------------------------------

describe("defendingPlayerIs — cannot be blocked by one player's characters", () => {
  const MORE_CHARACTERS = {
    type: "numberCompare",
    left: { type: "count", selector: { type: "character", controller: { type: "chosenPlayer", id: "__candidate" } } },
    operator: ">",
    right: { type: "count", selector: { type: "character", controller: "self" } }
  };
  /** "Use this only if an opponent controls more characters than you. This turn, this card cannot be blocked by that player's characters." */
  const GAMER = character({
    name: "Gamer",
    behavior: ACTIVATED({
      playerChoices: [{ id: "o", from: "opponents", condition: MORE_CHARACTERS }],
      effects: [{ type: "grantKeyword", target: "source", keyword: "cannotBeBlocked", duration: { type: "untilEndOfTurn" }, condition: { type: "defendingPlayerIs", player: named("o") } }]
    })
  });

  /** P1 has the Gamer alone; every opponent has two characters. The Gamer's player names `barred`, then attacks `target`. */
  function attackAfter(count: number, barred: PlayerId, target: PlayerId): Table {
    const seats = seatsFor(count);
    const built = buildGame({
      ...plainSeats(count),
      cards: [
        { key: "gamer", def: GAMER, owner: P1 },
        ...seats.slice(1).flatMap(owner => [1, 2].map(i => ({ key: `c-${owner}-${i}`, def: character({ name: `Char ${owner} ${i}` }), owner })))
      ]
    });
    const t: Table = { engine: built.engine, id: built.id, seats };
    const needs = t.engine.getActivatedAbilityStatuses(P1).find(entry => entry.cardId === t.id("gamer"))!;
    assert.equal(needs.available, true);
    t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("gamer"), abilityId: "go", ...(count > 2 ? { players: { o: barred } } : {}) } as never);
    resolvePendingResponses(t.engine);
    t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("gamer")], target: { type: "faction", playerId: target } } as never);
    resolvePendingResponses(t.engine);
    return t;
  }

  for (const count of TABLES) {
    const seats = seatsFor(count);
    const barred = seats[count - 1]!;
    rule(["MPX-attack", "MPX-an-superlative"], `${count} seats: the player named cannot block the Gamer`, () => {
      const t = attackAfter(count, barred, barred);
      assert.equal(t.engine.state.battle?.phase, "blocking");
      assert.deepEqual(t.engine.getBlockOptions()?.blockers ?? [], [], "the named player's characters cannot block");
    });

    rule(["MPX-attack", "MPX-an-superlative"], `${count} seats: another opponent may still block the Gamer`, () => {
      const t = attackAfter(count, barred, P2);
      assert.equal(t.engine.getBlockOptions()?.playerId, P2);
      assert.deepEqual(new Set(t.engine.getBlockOptions()?.blockers), new Set([t.id("c-p2-1"), t.id("c-p2-2")]));
    });

    rule(["MPX-vocab-an"], `${count} seats: the choice offers only the opponents with more characters, and the grant keeps the named player`, () => {
      const t = attackAfter(count, barred, barred);
      assert.deepEqual(t.engine.state.keywordGrants[0]!.chosenPlayers, { o: barred });
    });
  }

  rule(["MPX-attack"], "2 seats: the one opponent is named without asking and cannot block the Gamer", () => {
    const t = attackAfter(2, P2, P2);
    assert.deepEqual(t.engine.getBlockOptions()?.blockers ?? [], []);
  });
});

// ---------------------------------------------------------------------------
// Looking at an opponent's face-down resources (MPX-hidden).
// ---------------------------------------------------------------------------

describe("reveal faceDownResources — the looking player alone learns them", () => {
  const LOOK = ACTIVATED({
    playerChoices: [{ id: "o", from: "opponents" }],
    effects: [{ type: "reveal", of: named("o"), zone: "faceDownResources", viewer: "controller" }]
  });
  const table = (count: number): Table =>
    board(count, tactic({ name: "Look", behavior: LOOK }),
      seatsFor(count).slice(1).flatMap(owner => [1, 2].map(i => ({ key: `fd-${owner}-${i}`, def: resourceCard({ name: `Secret ${owner} ${i}` }), owner, faceDown: true }))));
  const log = (t: Table, viewer: PlayerId | "spectator") => redactLogFor(t.engine.getLog(), t.engine.state.cards, viewer, { revealed: t.engine.getFlowView().revealed }).map(entry => entry.message).join("\n");

  for (const count of ALL_TABLES) {
    const seats = seatsFor(count);
    const looked = seats[count - 1]!;
    rule(["MPX-hidden"], `${count} seats: only the looking player is told the chosen opponent's face-down resources, nobody else's`, () => {
      const t = table(count);
      cast(t, count > 2 ? { o: looked } : undefined);
      const secret = `Secret ${looked} 1`;
      assert.equal(log(t, P1).includes(secret), true, "the looker is told");
      assert.equal(log(t, P1).includes(`Secret ${looked} 2`), true);
      for (const seat of seats.slice(1)) {
        if (seat !== looked) assert.equal(log(t, P1).includes(`Secret ${seat} 1`), false, "another opponent's resources were not looked at");
        assert.equal(log(t, seat).includes(secret), false, `${seat} is not told`);
      }
      assert.equal(log(t, "spectator").includes(secret), false);
    });
  }
});

// ---------------------------------------------------------------------------
// "Your opponent cannot respond to this card" selects its opponent with the play (MPX-select, MPX-respond).
// ---------------------------------------------------------------------------

describe("noResponse opponent — the block's opponent is asked for with the play", () => {
  const SILENT = tactic({ name: "Silent", behavior: { noResponse: "opponent", abilities: [{ id: "go", type: "activated", effects: [] }] } as CardDefinition["behavior"] });
  /** Who is offered the chance to respond, in order, until the card resolves. */
  function responders(t: Table): PlayerId[] {
    const order: PlayerId[] = [];
    for (let guard = 0; guard < 6 && t.engine.state.responseWindow?.phase === "acceptingResponses"; guard++) {
      const who = t.engine.state.priorityPlayerId!;
      order.push(who);
      t.engine.perform({ type: "passPriority", playerId: who } as never);
    }
    return order;
  }

  for (const count of TABLES) {
    const seats = seatsFor(count);
    rule(["MPX-select", "MPX-respond"], `${count} seats: the opponent is part of the action, and only that player may not respond`, () => {
      const t = board(count, SILENT);
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), [{ kind: "players", choices: [{ id: "opponent", candidates: seats.slice(1) }] }]);
      t.engine.perform(play(t, { players: { opponent: P3 } }));
      assert.deepEqual(responders(t), seats.slice(1).filter(seat => seat !== P3), "every other opponent may respond, clockwise");
    });
  }

  rule(["MPX-select", "MPX-respond"], "2 seats: nobody is asked, and with the one opponent unable to respond the card resolves at once", () => {
    const t = board(2, SILENT);
    assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
    t.engine.perform(play(t));
    assert.equal(t.engine.state.responseWindow?.phase === "acceptingResponses", false);
  });
});
