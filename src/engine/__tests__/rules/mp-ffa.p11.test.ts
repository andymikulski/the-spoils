// Multiplayer (free-for-all) rules, part 11: what every viewer may see, at three and four seats, including after an
// elimination; the public queries; and the game log from every vantage.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-hidden, MPX-elim, MPX-select, MPX-seat,
// MPX-attack, MPX-respond, MP 2; CR 403.1a, CR 403.2a, CR 403.6a.
// Every numbered point is tested at 3 and at 4 seats.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId, SpoilsEngine, Viewer } from "../../../engine.js";
import { HIDDEN_DEFINITION_ID, redactFlowViewFor, redactLogFor, redactStateFor } from "../../../engine.js";
import { buildGame, character, location, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { developPlay } from "../support/develop.js";
import { playRandomGame, randomSetup } from "../support/driver.js";
import { rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, board, intoPlay, pending, plainSeats, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const viewersOf = (count: number): Viewer[] => [...seatsFor(count), "spectator"];

const lose = (who: PlayerId, amount: number) => ({ type: "modifyInfluence" as const, player: { type: "player" as const, id: who }, amount: -amount });

/** The state `viewer` is sent, built the way a server builds it: with the engine's own reveal and void-sight answers. */
function viewFor(engine: SpoilsEngine, viewer: Viewer) {
  return redactStateFor(engine.state, viewer, {
    revealed: engine.getFlowView().revealed,
    canSeeVoided: cardId => (viewer === "spectator" ? false : engine.canViewerSeeVoidedCard(viewer, cardId))
  });
}

/** Whether `viewer` is sent a masked stand-in for card `key`. */
const maskedFor = (t: Table, viewer: Viewer, key: string): boolean => viewFor(t.engine, viewer).cards[t.id(key)]!.definitionId === HIDDEN_DEFINITION_ID;

/** The log `viewer` reads, as one text. */
const logFor = (engine: SpoilsEngine, viewer: Viewer): string =>
  redactLogFor(engine.getLog(), engine.state.cards, viewer, { revealed: engine.getFlowView().revealed })
    .map(entry => entry.message)
    .join("\n");

/** A table with a hand card, a deck card and a face-down resource for every seat, plus `extra`. */
function hiddenTable(count: number, spell: CardDefinition, extra: Parameters<typeof board>[2] = []): Table {
  const seats = seatsFor(count);
  return board(count, spell, [
    ...seats.flatMap(owner => [
      { key: `hand-${owner}`, def: tactic({ name: `Hand Card Of ${owner}` }), owner, zone: "hand" as const },
      { key: `deck-${owner}`, def: tactic({ name: `Deck Card Of ${owner}` }), owner, zone: "deck" as const },
      { key: `down-${owner}`, def: resourceCard({ name: `Face Down Of ${owner}` }), owner, zone: "play" as const, faceDown: true }
    ]),
    ...extra
  ]);
}

// ---------------------------------------------------------------------------
// After an elimination.
// ---------------------------------------------------------------------------

describe("MPX-hidden / MPX-elim — every viewer's state after a player has been eliminated", () => {
  const FINISH = tactic({ name: "Finish", behavior: ACTIVATED({ effects: [lose(P2, 99)] }) });
  const eliminated = (count: number): Table => {
    const t = hiddenTable(count, FINISH);
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    assert.ok(t.engine.state.players[P2]!.eliminated, "P2 is out");
    return t;
  };

  for (const count of TABLES) {
    rule(["MPX-hidden", "MPX-elim", "CR 403.6a"], `${count} seats: the eliminated player's cards are set aside face-up, so every viewer, the eliminated player included, sees them`, () => {
      const t = eliminated(count);
      for (const key of ["hand-p2", "deck-p2", "down-p2"]) {
        assert.equal(t.engine.state.cards[t.id(key)]!.zone, "removed", `${key} left the game`);
        for (const viewer of viewersOf(count)) assert.equal(maskedFor(t, viewer, key), false, `${viewer} sees ${key}`);
      }
    });

    rule(["MPX-hidden", "MPX-elim"], `${count} seats: after the elimination every other player's hidden cards are still hidden from every viewer but their holder, the eliminated player's own view included`, () => {
      const t = eliminated(count);
      for (const viewer of viewersOf(count)) {
        for (const owner of seatsFor(count).filter(seat => seat !== P2)) {
          assert.equal(maskedFor(t, viewer, `hand-${owner}`), viewer !== owner, `${viewer} looking at ${owner}'s hand`);
          assert.equal(maskedFor(t, viewer, `deck-${owner}`), true, `${viewer} looking at ${owner}'s deck`);
          assert.equal(maskedFor(t, viewer, `down-${owner}`), viewer !== owner, `${viewer} looking at ${owner}'s face-down resource`);
        }
      }
    });

    rule(["MPX-hidden", "MPX-elim"], `${count} seats: an eliminated player is never the one a flow view waits on, and has nothing to decide`, () => {
      const t = eliminated(count);
      const flow = t.engine.getFlowView();
      assert.notEqual(flow.actingPlayerId, P2);
      assert.notEqual(flow.priorityPlayerId, P2);
      assert.equal(t.engine.getPlayableHandCards(P2).length, 0, "nothing in their hand is playable (it is gone)");
      assert.equal(t.engine.getAttackOptions(P2).attackers.length, 0);
      assert.equal(t.engine.getAttackOptions(P2).targets.length, 0);
      assert.equal(t.engine.getActivatedAbilityStatuses(P2).filter(status => status.available).length, 0);
      assert.equal(t.engine.getPlayableFromOutsideHand(P2).length, 0);
      assert.equal(typeof t.engine.getEndTurnBlock(P2), "string", "they cannot end a turn");
    });

    rule(["MPX-elim", "MPX-hidden"], `${count} seats: a reveal that covers every opponent no longer lists the eliminated player`, () => {
      const lamp = character({
        name: "Lamp",
        behavior: { abilities: [{ id: "lamp", type: "continuous", modifiers: [], grantsReveal: { zone: "hand", of: "opponents" } }] } as CardDefinition["behavior"]
      });
      const t = hiddenTable(count, FINISH, [{ key: "lamp", def: lamp, owner: P1, zone: "play" }]);
      assert.deepEqual(t.engine.getFlowView().revealed.hands, seatsFor(count).slice(1));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.deepEqual(t.engine.getFlowView().revealed.hands, seatsFor(count).filter(seat => seat !== P1 && seat !== P2));
      for (const viewer of viewersOf(count)) {
        for (const owner of seatsFor(count).filter(seat => seat !== P1 && seat !== P2)) {
          assert.equal(maskedFor(t, viewer, `hand-${owner}`), false, `${viewer} sees the revealed hand of ${owner}`);
        }
        assert.equal(maskedFor(t, viewer, "hand-p1"), viewer !== P1, `${viewer} and the controller's own hand`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Reveals granted by a card, and who may look at what the cards set aside.
// ---------------------------------------------------------------------------

describe("MPX-hidden — what a card makes public is public to the players the text names", () => {
  const lamp = (of: "opponent" | "opponents" | "self") =>
    character({
      name: "Lamp",
      behavior: { abilities: [{ id: "lamp", type: "continuous", modifiers: [], grantsReveal: { zone: "hand", of } }] } as CardDefinition["behavior"]
    });

  for (const count of TABLES) {
    rule(["MPX-hidden", "MPX-lasting"], `${count} seats: "your opponent's hand is revealed" shows the selected opponent's hand and no other, and nothing until one is selected`, () => {
      const t = hiddenTable(count, lamp("opponent"));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.deepEqual(t.engine.getFlowView().revealed.hands, [], "until the selection nobody's hand is public");
      for (const viewer of viewersOf(count)) assert.equal(maskedFor(t, viewer, "hand-p3"), viewer !== P3, `${viewer} before the selection`);
      answerPlayer(t, P1, P3);
      assert.deepEqual(t.engine.getFlowView().revealed.hands, [P3]);
      for (const viewer of viewersOf(count)) {
        assert.equal(maskedFor(t, viewer, "hand-p3"), false, `${viewer} sees the selected opponent's hand`);
        assert.equal(maskedFor(t, viewer, "hand-p2"), viewer !== P2, `${viewer} and the other opponent's hand`);
        assert.equal(maskedFor(t, viewer, "hand-p1"), viewer !== P1, `${viewer} and the controller's hand`);
      }
    });

    rule(["MPX-hidden", "MPX-vocab-each"], `${count} seats: "each opponent's hand is revealed" shows every opponent's hand and not the controller's`, () => {
      const t = hiddenTable(count, lamp("self"), []);
      intoPlay(t);
      const everyone = hiddenTable(count, lamp("opponents"));
      intoPlay(everyone);
      assert.deepEqual(everyone.engine.getFlowView().revealed.hands, seatsFor(count).slice(1));
      for (const viewer of viewersOf(count)) {
        for (const owner of seatsFor(count).slice(1)) assert.equal(maskedFor(everyone, viewer, `hand-${owner}`), false, `${viewer} sees ${owner}'s hand`);
        assert.equal(maskedFor(everyone, viewer, "hand-p1"), viewer !== P1, `${viewer} and the controller's hand`);
      }
      assert.deepEqual(t.engine.getFlowView().revealed.hands, [P1], "the 'your hand' form shows only the controller's");
    });

    rule(["MPX-hidden", "CR 403.7a"], `${count} seats: a card that may look at the cards it set aside lets its controller, and the player who set them aside, look and nobody else`, () => {
      const escrow = character({
        name: "Escrow",
        behavior: { abilities: [{ id: "esc", type: "continuous", modifiers: [], mayLookAtVoided: { selector: { zone: "void", faceDown: true } } }] } as CardDefinition["behavior"]
      });
      const t = hiddenTable(count, tactic({ name: "Idle" }), [
        { key: "escrow", def: escrow, owner: P3, zone: "play" },
        { key: "voided", def: character({ name: "Voided Secret" }), owner: P2, zone: "void", faceDown: true }
      ]);
      t.engine.state.cards[t.id("voided")]!.faceDownBy = P1;
      for (const viewer of seatsFor(count)) {
        const sees = viewer === P1 || viewer === P3;
        assert.equal(t.engine.canViewerSeeVoidedCard(viewer, t.id("voided")), sees, `engine: ${viewer}`);
        assert.equal(maskedFor(t, viewer, "voided"), !sees, `redacted state: ${viewer}`);
      }
      assert.equal(maskedFor(t, "spectator", "voided"), true, "a spectator never sees it");
    });
  }
});

// ---------------------------------------------------------------------------
// Pending choices and the players requirement.
// ---------------------------------------------------------------------------

describe("MPX-hidden / MP 2 — a choice is shown in full to the player who makes it and to nobody else", () => {
  const WARDEN = {
    abilities: [{ id: "ward", type: "continuous", modifiers: [], drawModifiers: [{ player: "opponent", prevent: true }] }]
  } as CardDefinition["behavior"];

  for (const count of TABLES) {
    rule(["MPX-hidden", "MP 2"], `${count} seats: the player choosing an opponent sees the candidates; every other viewer sees only what is being decided and by whom`, () => {
      const t = board(count, character({ name: "Warden", behavior: WARDEN }));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      const choice = pending(t)!;
      assert.equal(choice.kind, "choosePlayer");
      assert.deepEqual(t.engine.getFlowView().pendingChoice, choice);
      assert.equal(t.engine.getFlowView().mode, "pendingChoice");
      assert.equal(t.engine.getFlowView().actingPlayerId, P1);
      for (const viewer of viewersOf(count)) {
        const fromState = viewFor(t.engine, viewer).pendingChoice;
        const fromFlow = redactFlowViewFor(t.engine.getFlowView(), viewer).pendingChoice;
        for (const shown of [fromState, fromFlow]) {
          if (viewer === P1) assert.deepEqual(shown, choice, "the chooser sees the whole prompt");
          else assert.deepEqual(shown, { id: choice.id, kind: "choosePlayer", playerId: P1 }, `${viewer} sees the minimal form`);
        }
      }
    });

    rule(["MPX-hidden", "MPX-elim"], `${count} seats: a prompt addressed to a player who is then eliminated is removed for every viewer`, () => {
      const finish = tactic({ name: "Finish P1", behavior: ACTIVATED({ effects: [lose(P1, 99)] }) });
      const t = board(count, character({ name: "Warden", behavior: WARDEN }), [{ key: "finish", def: finish, owner: P2, zone: "hand" }]);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.playerId, P1);
      t.engine.state.pendingChoice = undefined;
      t.engine.state.players[P1]!.eliminated = { turn: 1 };
      for (const viewer of viewersOf(count)) assert.equal(viewFor(t.engine, viewer).pendingChoice, undefined, `${viewer}`);
      assert.equal(redactFlowViewFor(t.engine.getFlowView(), P2).pendingChoice, undefined);
    });
  }
});

describe("MP 2 / MPX-select — the players requirement and the attack options, from each seat", () => {
  const CULL = tactic({
    name: "Cull",
    behavior: ACTIVATED({
      targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
      effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
    })
  });

  for (const count of TABLES) {
    rule(["MP 2", "MPX-select"], `${count} seats: the requirement lists the players still in the game clockwise from the seat after the player, and shrinks as players are eliminated`, () => {
      const t = board(count, CULL);
      const requirement = () => t.engine.getPlayRequirements(play(t) as never)[0];
      const first = requirement();
      assert.equal(first?.kind, "players");
      if (first?.kind !== "players") return;
      assert.deepEqual(first.choices, [{ id: "opponent", candidates: t.seats.slice(1) }]);
      t.engine.state.players[P2]!.eliminated = { turn: 1 };
      const second = requirement();
      if (count === 3) {
        assert.equal(second?.kind, "pick", "one opponent left: nothing to select, the picks follow at once");
        if (second?.kind === "pick") assert.deepEqual(second.candidates, [t.id("c-p3")]);
      } else {
        assert.equal(second?.kind, "players");
        if (second?.kind === "players") assert.deepEqual(second.choices, [{ id: "opponent", candidates: [P3, P4] }]);
      }
    });

    rule(["MPX-attack", "CR 608.1a"], `${count} seats: the attack options name every opponent still in the game and every location an opponent controls, and nothing of an eliminated player`, () => {
      const t = board(count, tactic({ name: "Idle" }), [
        ...seatsFor(count).map(owner => ({ key: `loc-${owner}`, def: location({ name: `Loc ${owner}` }), owner })),
        { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 2 }), owner: P1 }
      ]);
      const targets = () => t.engine.getAttackOptions(P1).targets.map(target => (target.type === "faction" ? `faction:${target.playerId}` : `card:${target.cardId}`));
      const expected = (live: PlayerId[]) => [...live.map(seat => `faction:${seat}`), ...live.map(seat => `card:${t.id(`loc-${seat}`)}`)].sort();
      assert.deepEqual(targets().sort(), expected(seatsFor(count).slice(1)));
      for (const seat of t.seats.slice(1)) {
        assert.deepEqual(t.engine.getAttackOptions(seat).targets, [], `${seat} is not the active player: nothing to attack with`);
      }
      // P2 is eliminated: their locations leave the game with them.
      t.engine.state.players[P2]!.eliminated = { turn: 1 };
      for (const card of Object.values(t.engine.state.cards)) if (card.ownerId === P2 && card.zone !== "removed") card.zone = "removed";
      assert.deepEqual(targets().sort(), expected(seatsFor(count).slice(2)));
    });
  }
});

// ---------------------------------------------------------------------------
// The log, from every vantage.
// ---------------------------------------------------------------------------

describe("MPX-hidden / MPX-elim — the log tells each viewer only what they may know", () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);

    rule(["MPX-elim", "MPX-hidden"], `${count} seats: an elimination reads the same to every viewer and names the player who is out`, () => {
      const t = hiddenTable(count, tactic({ name: "Finish", behavior: ACTIVATED({ effects: [lose(P3, 99)] }) }));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.ok(t.engine.state.players[P3]!.eliminated, "P3 is out");
      const lines = (viewer: Viewer) => logFor(t.engine, viewer).split("\n").filter(line => /out of the game/.test(line));
      for (const viewer of viewersOf(count)) assert.deepEqual(lines(viewer), [`${t.engine.state.players[P3]!.name} is out of the game`], `${viewer}`);
      const entry = t.engine.getLog().find(candidate => candidate.event?.type === "playerEliminated")!;
      assert.equal(entry.redacted, undefined, "no per-vantage text: nothing in the line is hidden");
    });

    rule(["MPX-hidden"], `${count} seats: when every player draws, each viewer is told the name of the card they drew and of nobody else's`, () => {
      const drawAll = tactic({
        name: "Draw All",
        behavior: ACTIVATED({ effects: [{ type: "forEachPlayer", players: "all", effects: [{ type: "draw", player: "controller", amount: 1 }] }] })
      });
      const t = board(count, drawAll, seats.map(owner => ({ key: `top-${owner}`, def: tactic({ name: `Secret Of ${owner}` }), owner, zone: "deck" as const })));
      for (const seat of seats) t.engine.state.players[seat]!.deck = [t.id(`top-${seat}`)];
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      for (const seat of seats) assert.deepEqual(t.engine.state.players[seat]!.hand.includes(t.id(`top-${seat}`)), true, `${seat} drew it`);
      for (const viewer of viewersOf(count)) {
        const text = logFor(t.engine, viewer);
        for (const owner of seats) {
          assert.equal(text.includes(`Secret Of ${owner}`), viewer === owner, `${viewer} reading about ${owner}'s draw`);
        }
      }
      assert.equal((logFor(t.engine, "spectator").match(/a card moves from deck to hand/g) ?? []).length, count, "the public line says only that a card moved");
    });

    rule(["MPX-hidden", "CR 411.2"], `${count} seats: a face-down resource is named in the log to its controller only`, () => {
      const active = seats[count - 1]!;
      const faction = noDevelopFaction();
      void faction;
      const built = buildGame({
        ...plainSeats(count),
        playerA: {
          faction: {
            ...noDevelopFaction(),
            faction: {
              ...noDevelopFaction().faction!,
              turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] } }
            }
          } as CardDefinition
        },
        cards: [{ key: "gem", def: resourceCard({ name: "Hidden Gem" }), owner: P1, zone: "hand" }]
      });
      developPlay(built.engine, P1, built.id("gem"), true);
      void active;
      for (const viewer of viewersOf(count)) {
        const text = logFor(built.engine, viewer);
        assert.equal(text.includes("Hidden Gem"), viewer === P1, `${viewer}`);
        if (viewer !== P1) assert.match(text, /a face-down card/);
      }
    });

    rule(["MPX-hidden", "MP 2"], `${count} seats: a look at the selected opponent's hand is named to the looker and the hand's owner; every other seat learns only that a look happened`, () => {
      const peek = tactic({
        name: "Peek",
        behavior: ACTIVATED({ effects: [{ type: "reveal", of: "opponent", zone: "hand", viewer: "controller" }] })
      });
      const t = hiddenTable(count, peek);
      const chosen = seats[count - 1]!;
      t.engine.perform(play(t, { players: { opponent: chosen } }));
      resolvePendingResponses(t.engine);
      const secret = `Hand Card Of ${chosen}`;
      for (const viewer of seats) {
        const mayKnow = viewer === P1 || viewer === chosen;
        assert.equal(logFor(t.engine, viewer).includes(secret), mayKnow, `${viewer}`);
      }
      assert.equal(logFor(t.engine, "spectator").includes(secret), false, "a spectator is not shown it");
      const bystander = seats.find(seat => seat !== P1 && seat !== chosen);
      if (bystander) assert.match(logFor(t.engine, bystander), /looks at 1 card from \S+'s hand/, "a bystander learns that a look happened");
      assert.equal(logFor(t.engine, P1).includes(`Hand Card Of ${bystander ?? "none"}`), false, "the looker saw only the selected opponent's hand");
    });
  }
});

describe("MP 2 / MPX-select — the log says who was selected", () => {
  const selectionLines = (engine: SpoilsEngine, viewer: Viewer): string[] => logFor(engine, viewer).split("\n").filter(line => / selects | chooses /.test(line));
  const nameOf = (t: Table, who: PlayerId): string => t.engine.state.players[who]!.name;
  const DRAIN = tactic({ name: "Drain", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }) });

  for (const count of TABLES) {
    rule(["MP 2", "MPX-select"], `${count} seats: a card played with a selected opponent says so in the log, in the same words for every viewer, after the line that says it was played`, () => {
      const t = board(count, DRAIN);
      t.engine.perform(play(t, { players: { opponent: P3 } }));
      resolvePendingResponses(t.engine);
      const expected = [`${nameOf(t, P1)} selects ${nameOf(t, P3)} as their opponent`];
      for (const viewer of viewersOf(count)) assert.deepEqual(selectionLines(t.engine, viewer), expected, `${viewer}`);
      const lines = logFor(t.engine, P2).split("\n");
      assert.ok(lines.findIndex(line => /plays Drain/.test(line)) < lines.indexOf(expected[0]!), "the card is played first");
    });

    rule(["MP 2", "MPX-select"], `${count} seats: a player named for a card's text is in the log as chosen`, () => {
      const named = tactic({
        name: "Named",
        behavior: ACTIVATED({
          playerChoices: [{ id: "victim", from: "opponents" }],
          effects: [{ type: "modifyInfluence", player: { type: "chosenPlayer", id: "victim" }, amount: -3 }]
        })
      });
      const t = board(count, named);
      t.engine.perform(play(t, { players: { victim: P3 } }));
      resolvePendingResponses(t.engine);
      for (const viewer of viewersOf(count)) assert.deepEqual(selectionLines(t.engine, viewer), [`${nameOf(t, P1)} chooses ${nameOf(t, P3)}`], `${viewer}`);
    });

    rule(["MP 2", "MPX-select"], `${count} seats: a selection made at a prompt reaches the log when it is answered, not before`, () => {
      const watcher = character({
        name: "Watcher",
        strength: 0,
        behavior: {
          abilities: [
            {
              id: "tr",
              type: "triggered",
              event: "cardPlayed",
              condition: { type: "eventPlayerIs", player: "controller" },
              effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
            }
          ]
        } as CardDefinition["behavior"]
      });
      const t = board(count, watcher, [{ key: "idle", def: tactic({ name: "Idle" }), owner: P1, zone: "hand" }]);
      intoPlay(t);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
      assert.equal(pending(t)?.kind, "choosePlayer");
      for (const viewer of viewersOf(count)) assert.deepEqual(selectionLines(t.engine, viewer), [], `${viewer} before the answer`);
      answerPlayer(t, P1, P2);
      for (const viewer of viewersOf(count)) assert.deepEqual(selectionLines(t.engine, viewer), [`${nameOf(t, P1)} selects ${nameOf(t, P2)} as their opponent`], `${viewer} after the answer`);
    });

    rule(["MP 2", "MPX-select", "MPX-lasting"], `${count} seats: a selection for text that keeps applying, and the new selection after the old one is eliminated, are in the log`, () => {
      const warden = character({
        name: "Warden",
        behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], drawModifiers: [{ player: "opponent", prevent: true }] }] } as CardDefinition["behavior"]
      });
      const finish = tactic({ name: "Finish P2", behavior: ACTIVATED({ effects: [lose(P2, 99)] }) });
      const t = board(count, warden, [{ key: "finish", def: finish, owner: P1, zone: "hand" }]);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P2);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("finish") });
      resolvePendingResponses(t.engine);
      const expected = [`${nameOf(t, P1)} selects ${nameOf(t, P2)} as their opponent`];
      if (count === 4) {
        assert.equal(pending(t)?.kind, "choosePlayer", "P2 is out: the controller selects again");
        answerPlayer(t, P1, P4);
        expected.push(`${nameOf(t, P1)} selects ${nameOf(t, P4)} as their opponent`);
      }
      for (const viewer of viewersOf(count)) assert.deepEqual(selectionLines(t.engine, viewer), expected, `${viewer}`);
    });
  }

  rule(["MPX-select"], "2 seats: the only opponent is nobody's selection, so the log has none", () => {
    const t = board(2, DRAIN);
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    assert.deepEqual(selectionLines(t.engine, P1), []);
    assert.equal(t.engine.getLog().some(entry => entry.marker === "playerSelected"), false);
  });
});

// ---------------------------------------------------------------------------
// Every viewer, over a whole game.
// ---------------------------------------------------------------------------

describe("MPX-hidden — no viewer's state names a card that is hidden from them, over whole games", () => {
  for (const count of TABLES) {
    rule(["MPX-hidden", "MPX-elim", "CR 403.2a"], `${count} seats: after every action of a real-deck game, no viewer is sent the name of a card hidden from them`, () => {
      const setup = randomSetup(70 + count, { seats: count });
      let checks = 0;
      const result = playRandomGame(setup, 5, {
        maxActions: 140,
        onAction(engine, action, index) {
          if (index % 4 !== 0) return;
          const flow = engine.getFlowView();
          for (const viewer of viewersOf(count)) {
            const view = redactStateFor(engine.state, viewer, {
              revealed: flow.revealed,
              canSeeVoided: cardId => (viewer === "spectator" ? false : engine.canViewerSeeVoidedCard(viewer, cardId))
            });
            const shownDefinitions = new Set(Object.values(view.cards).filter(card => card.definitionId !== HIDDEN_DEFINITION_ID).map(card => card.definitionId));
            const text = JSON.stringify(Object.values(view.cards)) + JSON.stringify(redactFlowViewFor(flow, viewer).pendingChoice ?? null);
            for (const card of Object.values(view.cards)) {
              if (card.definitionId !== HIDDEN_DEFINITION_ID) continue;
              const real = engine.state.cards[card.id]!;
              if (shownDefinitions.has(real.definitionId)) continue;
              assert.equal(text.includes(JSON.stringify(real.definitionId)), false, `${viewer}: card ${card.id} leaked its definition after action ${index} (${action.type})`);
            }
            checks++;
          }
        }
      });
      assert.notEqual(result.status, "finding", JSON.stringify(result.finding));
      assert.ok(checks > 100, `${checks} views were checked`);
    });
  }
});
