// The `concede` action (RULES.md §15.2, MPX-concede): a player forfeits and loses at once, by the one loss procedure.
// At two seats the other player wins; at three or more the player is eliminated as MPX-elim says and the rest play on.
// Never offered by any query of what a player may do; only accepted through `perform` / `checkAction`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../data.js";
import {
  createFactionGame,
  getSaveSummary,
  loadGame,
  logMessageFor,
  redactFlowViewFor,
  redactLogFor,
  redactStateFor,
  saveGame,
  type CardDefinition,
  type GameAction,
  type PlayerId,
  type SpoilsEngine
} from "../engine.js";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../engine/__tests__/support/fixtures.js";
import { autoResolveBattle } from "../engine/__tests__/support/fixtures.js";
import { canonicalJson, digestState } from "../engine/__tests__/support/digest.js";

const SEATS = [P1, P2, P3, P4];
const concede = (playerId: PlayerId): GameAction => ({ type: "concede", playerId });
const eliminated = (engine: SpoilsEngine, playerId: PlayerId): boolean => engine.state.players[playerId]!.eliminated !== undefined;
const events = (engine: SpoilsEngine, type: string) => engine.getLog().filter(entry => entry.event?.type === type);
const concessions = (engine: SpoilsEngine) => engine.getLog().filter(entry => entry.marker === "playerConceded");
const standing = (engine: SpoilsEngine): PlayerId[] => engine.getPlayersInSeatOrder();
const ownedBy = (engine: SpoilsEngine, playerId: PlayerId) => Object.values(engine.state.cards).filter(card => card.ownerId === playerId);

/** A synthetic table of `count` seats whose factions have no develop rule, so turns pass without prompts. */
function table(count: number, cards: Parameters<typeof buildGame>[0] extends infer O ? (O extends { cards?: infer C } ? C : never) : never = [], activePlayerId?: PlayerId) {
  return buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
    cards: [
      ...SEATS.slice(0, count).map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `res-${i}`, def: resourceCard({ name: `Res ${i}` }), owner: P1 })),
      ...cards
    ],
    ...(activePlayerId ? { activePlayerId } : {})
  });
}

/** The active player ends their turn and every window closes. */
function endTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  resolvePendingResponses(engine);
}

const answerPlayer = (playerId: PlayerId, chosen: PlayerId): GameAction => ({
  type: "resolvePendingChoice",
  playerId,
  choice: { kind: "choosePlayer", playerId: chosen }
});

/** A game that can be rebuilt exactly (same seed, same decks), for replay and save/load comparisons. */
const rebuild = (engine: SpoilsEngine): SpoilsEngine =>
  loadGame(JSON.parse(JSON.stringify(saveGame(engine))), Object.values(engine.definitions).filter(def => !def.id.startsWith("token-def_")));
const plain = (engine: SpoilsEngine): unknown => JSON.parse(canonicalJson(engine.state));

describe("concede — two seats", () => {
  for (const [loser, winner] of [[P1, P2], [P2, P1]] as const) {
    it(`${loser} concedes and ${winner} wins`, () => {
      const { engine } = table(2);
      engine.perform(concede(loser));
      assert.equal(engine.state.winner, winner);
      assert.equal(engine.getFlowView().mode, "gameOver");
      assert.equal(engine.getFlowView().winner, winner);
      assert.equal(concessions(engine).length, 1);
      assert.match(concessions(engine)[0]!.message, /^(Alice|Bob) concedes$/);
      assert.deepEqual(events(engine, "gameEnded").map(entry => entry.event), [{ type: "gameEnded", winnerId: winner }]);
      assert.equal(events(engine, "playerEliminated").length, 0, "at two seats nobody is marked eliminated");
    });
  }

  it("the player who is not active, and a player in the middle of a response window, may concede", () => {
    const spell = tactic({ name: "Idle" });
    const { engine, id } = table(2, [{ key: "spell", def: spell, owner: P1, zone: "hand" }]);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    engine.perform(concede(P2));
    assert.equal(engine.state.winner, P1);
  });
});

for (const count of [3, 4]) {
  const seats = SEATS.slice(0, count);
  const lastSeat = seats[count - 1]!;

  describe(`concede — ${count} seats`, () => {
    it("on their own turn: they are eliminated, everything of theirs leaves, and the next seat's turn starts", () => {
      const { engine, id } = table(count);
      const turn = engine.state.turn;
      engine.perform(concede(P1));
      assert.ok(eliminated(engine, P1));
      assert.equal(engine.state.winner, undefined);
      assert.deepEqual(standing(engine), seats.slice(1));
      assert.equal(engine.state.activePlayerId, P2, "their turn ended at once");
      assert.equal(engine.state.turn, turn + 1);
      assert.ok(ownedBy(engine, P1).every(card => card.zone === "removed"), "every card they own is out of the game");
      assert.equal(engine.state.cards[id("c-p2")]!.zone, "play");
      assert.equal(concessions(engine).length, 1);
      assert.equal(events(engine, "playerEliminated").length, 1);
      assert.equal(events(engine, "gameEnded").length, 0);
      assert.equal(engine.getFlowView().mode, "main");
      // the game plays on: turns pass through the seats still in it
      const order: PlayerId[] = [];
      for (let i = 0; i < count * 2; i++) {
        order.push(engine.state.activePlayerId);
        endTurn(engine);
      }
      assert.ok(!order.includes(P1));
      assert.deepEqual(order.slice(0, count - 1), seats.slice(1));
    });

    it("on another player's turn: the turn is not interrupted and their seat is skipped afterwards", () => {
      const { engine, id } = table(count);
      engine.perform(concede(lastSeat));
      assert.ok(eliminated(engine, lastSeat));
      assert.equal(engine.state.activePlayerId, P1);
      assert.equal(engine.state.cards[id(`c-${lastSeat}`)]!.zone, "removed");
      assert.equal(engine.getFlowView().mode, "main");
      const order: PlayerId[] = [];
      for (let i = 0; i < count; i++) {
        order.push(engine.state.activePlayerId);
        endTurn(engine);
      }
      assert.deepEqual(order, [...seats.slice(0, -1), P1]);
      assert.equal(engine.state.activePlayerId, P2);
    });

    it("a card they control but do not own goes back to its owner", () => {
      const { engine, id } = table(count, [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P3 }]);
      engine.perform(concede(P3));
      assert.equal(engine.state.cards[id("stolen")]!.zone, "play");
      assert.equal(engine.state.cards[id("stolen")]!.controllerId, P2);
    });

    it("while holding priority in a response window: the offer moves on and the window still closes", () => {
      const spell = tactic({ name: "Idle" });
      const { engine, id } = table(count, [{ key: "spell", def: spell, owner: P1, zone: "hand" }]);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
      const holder = engine.state.responseWindow!.priorityPlayerId;
      assert.equal(holder, P2);
      engine.perform(concede(holder));
      assert.ok(eliminated(engine, holder));
      const next = engine.state.responseWindow!.priorityPlayerId;
      assert.notEqual(next, holder);
      assert.ok(!eliminated(engine, next));
      resolvePendingResponses(engine);
      assert.equal(engine.state.responseWindow, undefined);
      assert.equal(engine.state.cards[id("spell")]!.zone, "discard", "the tactic resolved");
      assert.equal(engine.getFlowView().mode, "main");
      assert.equal(engine.state.activePlayerId, P1);
    });

    it("while someone else holds priority: the window is unchanged for the holder", () => {
      const spell = tactic({ name: "Idle" });
      const { engine, id } = table(count, [{ key: "spell", def: spell, owner: P1, zone: "hand" }]);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
      assert.equal(engine.state.responseWindow!.priorityPlayerId, P2);
      engine.perform(concede(lastSeat));
      assert.equal(engine.state.responseWindow!.priorityPlayerId, P2);
      assert.ok(!engine.state.responseWindow!.pendingResponders.includes(lastSeat));
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("spell")]!.zone, "discard");
      assert.equal(engine.state.winner, undefined);
    });

    it("the player who has a spell on the stack concedes: the spell is removed without resolving", () => {
      const spell = tactic({ name: "Idle" });
      const { engine, id } = table(count, [{ key: "spell", def: spell, owner: P1, zone: "hand" }]);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
      engine.perform(concede(P1));
      assert.equal(engine.state.responseStack.length, 0);
      assert.equal(engine.state.responseWindow, undefined);
      assert.equal(engine.state.activePlayerId, P2);
      assert.equal(engine.state.cards[id("spell")]!.zone, "removed");
    });

    describe("while holding a pending choice", () => {
      // A replacement's controller selects an opponent: the prompt is P2's while P1's action is still resolving.
      const lucky = character({
        name: "Lucky",
        behavior: {
          abilities: [{ id: "luck", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }]
        } as CardDefinition["behavior"]
      });
      const kill = tactic({
        name: "Kill",
        behavior: {
          abilities: [{
            id: "go",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", name: "Lucky" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }]
        } as CardDefinition["behavior"]
      });
      const open = () => {
        const built = table(count, [
          { key: "kill", def: kill, owner: P1, zone: "hand" },
          { key: "lucky", def: lucky, owner: P2 }
        ]);
        built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("kill"), selected: { t: [built.id("lucky")] } });
        resolvePendingResponses(built.engine);
        assert.equal(built.engine.state.pendingChoice?.kind, "choosePlayer");
        assert.equal(built.engine.state.pendingChoice?.playerId, P2);
        return built;
      };

      it("a player who is not active: the choice goes away and the game goes on", () => {
        const { engine, id } = open();
        engine.perform(concede(P2));
        assert.ok(eliminated(engine, P2));
        assert.equal(engine.state.pendingChoice, undefined);
        resolvePendingResponses(engine);
        assert.equal(engine.state.responseWindow, undefined);
        assert.equal(engine.state.activePlayerId, P1);
        assert.equal(engine.getFlowView().mode, "main");
        assert.equal(engine.state.cards[id("lucky")]!.zone, "removed");
        assert.equal(engine.state.cards[id("kill")]!.zone, "discard", "the other player's tactic finished resolving");
        endTurn(engine);
        assert.equal(engine.state.activePlayerId, P3);
      });

      it("another player concedes while it is open: the prompt stays for its holder", () => {
        const { engine } = open();
        const prompt = engine.state.pendingChoice;
        engine.perform(concede(lastSeat));
        assert.deepEqual(engine.state.pendingChoice?.playerId, prompt?.playerId);
        assert.equal(engine.state.pendingChoice?.kind, "choosePlayer");
        engine.perform(answerPlayer(P2, P1));
        resolvePendingResponses(engine);
        assert.equal(engine.state.pendingChoice, undefined);
        assert.equal(engine.getFlowView().mode, "main");
      });

      it("the active player holds a trigger's choice and concedes: their turn ends", () => {
        const watcher = character({
          name: "Watcher",
          strength: 0,
          behavior: {
            abilities: [{
              id: "tr",
              type: "triggered",
              event: "cardPlayed",
              condition: { type: "eventPlayerIs", player: "controller" },
              effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
            }]
          } as CardDefinition["behavior"]
        });
        const { engine, id } = table(count, [
          { key: "watcher", def: watcher, owner: P1 },
          { key: "idle", def: tactic({ name: "Idle" }), owner: P1, zone: "hand" }
        ]);
        engine.perform({ type: "playCard", playerId: P1, cardId: id("idle") });
        assert.equal(engine.state.pendingChoice?.playerId, P1);
        engine.perform(concede(P1));
        assert.equal(engine.state.pendingChoice, undefined);
        assert.equal(engine.state.activePlayerId, P2);
        assert.equal(engine.state.responseStack.length, 0);
        assert.equal(engine.getFlowView().mode, "main");
      });
    });

    describe("in a battle", () => {
      const attack = (engine: SpoilsEngine, attackerId: string, defender: PlayerId) =>
        engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [attackerId], target: { type: "faction", playerId: defender } });
      const toBlocking = (engine: SpoilsEngine) => {
        resolvePendingResponses(engine);
        assert.equal(engine.state.battle?.phase, "blocking");
      };

      it("the attacker concedes while the attack is announced: the battle ends and the turn passes", () => {
        const { engine, id } = table(count);
        attack(engine, id("c-p1"), P2);
        assert.ok(engine.state.battle);
        engine.perform(concede(P1));
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.responseWindow, undefined);
        assert.equal(engine.state.activePlayerId, P2);
        assert.equal(engine.getFlowView().mode, "main");
      });

      it("the attacker concedes while blockers are awaited", () => {
        const { engine, id } = table(count);
        attack(engine, id("c-p1"), P2);
        toBlocking(engine);
        engine.perform(concede(P1));
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.activePlayerId, P2);
        assert.equal(engine.getFlowView().mode, "main");
      });

      it("the defender concedes while the attack is announced: the battle goes on without blockers", () => {
        const { engine, id } = table(count);
        attack(engine, id("c-p1"), P2);
        engine.perform(concede(P2));
        resolvePendingResponses(engine);
        autoResolveBattle(engine);
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.activePlayerId, P1, "the attacker's turn is not interrupted");
        assert.equal(engine.getFlowView().mode, "main");
        assert.equal(engine.state.winner, undefined);
        endTurn(engine);
        assert.equal(engine.state.activePlayerId, P3);
      });

      it("the defender concedes while blockers are awaited", () => {
        const { engine, id } = table(count);
        attack(engine, id("c-p1"), P2);
        toBlocking(engine);
        engine.perform(concede(P2));
        resolvePendingResponses(engine);
        autoResolveBattle(engine);
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.activePlayerId, P1);
        assert.equal(engine.getFlowView().mode, "main");
      });

      it("the defender concedes while assigning damage as the blocking side", () => {
        const { engine, id } = table(count, [{ key: "guard", def: character({ name: "Guard", speed: 1 }), owner: P2 }]);
        attack(engine, id("c-p1"), P2);
        toBlocking(engine);
        engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] });
        for (let guard = 0; engine.state.battle?.phase !== "defenderDamageAssignment"; guard++) {
          assert.ok(guard < 50, "the battle reaches the defender's damage assignment");
          if (engine.state.responseWindow) {
            resolvePendingResponses(engine);
          } else if (engine.state.battle?.phase === "attackerDamageAssignment") {
            const view = engine.getBattleView()!;
            engine.perform({
              type: "assignBattleDamage",
              playerId: view.actingPlayerId!,
              assignments: view.damageSources.flatMap(source =>
                source.legalTargets.length > 0 && source.strength > 0
                  ? [{ sourceId: source.cardId, target: source.legalTargets[0]!, amount: source.strength }]
                  : []
              )
            });
          } else {
            break;
          }
        }
        assert.equal(engine.state.battle?.phase, "defenderDamageAssignment");
        assert.equal(engine.state.battle?.defenderPlayerId, P2);
        engine.perform(concede(P2));
        resolvePendingResponses(engine);
        autoResolveBattle(engine);
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.activePlayerId, P1);
        assert.equal(engine.getFlowView().mode, "main");
      });

      it("a third player concedes during a battle between two others: the battle is unaffected", () => {
        const { engine, id } = table(count);
        attack(engine, id("c-p1"), P2);
        engine.perform(concede(lastSeat));
        const battle = engine.state.battle;
        assert.equal(battle?.attackerPlayerId, P1);
        assert.equal(battle?.defenderPlayerId, P2);
        resolvePendingResponses(engine);
        engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
        autoResolveBattle(engine);
        assert.equal(engine.state.battle, undefined);
        assert.equal(engine.state.activePlayerId, P1);
      });
    });

    it("conceding down to one player ends the game with that player as the winner", () => {
      const { engine } = table(count);
      const out = seats.slice(1);
      for (const [i, who] of out.entries()) {
        assert.equal(engine.state.winner, undefined);
        engine.perform(concede(who));
        if (i < out.length - 1) assert.ok(eliminated(engine, who));
      }
      assert.equal(engine.state.winner, P1);
      assert.equal(engine.getFlowView().mode, "gameOver");
      assert.equal(events(engine, "gameEnded").length, 1);
      assert.equal(concessions(engine).length, out.length);
    });

    it("everyone but a non-active player concedes: the survivor wins whoever is active", () => {
      const { engine } = table(count);
      for (const who of seats) {
        if (who !== P2) engine.perform(concede(who));
      }
      assert.equal(engine.state.winner, P2);
    });

    it("an eliminated player and a finished game refuse concede, and any other action", () => {
      const { engine } = table(count);
      engine.perform(concede(P2));
      assert.throws(() => engine.perform(concede(P2)), /out of the game/);
      assert.equal(engine.checkAction(concede(P2)).ok, false);
      assert.throws(() => engine.perform({ type: "endTurn", playerId: P2 }), /out of the game/);
      for (const who of seats.slice(2)) engine.perform(concede(who));
      assert.equal(engine.state.winner, P1);
      const before = plain(engine);
      for (const who of seats) {
        assert.throws(() => engine.perform(concede(who)));
        const checked = engine.checkAction(concede(who));
        assert.equal(checked.ok, false);
      }
      assert.deepEqual(plain(engine), before, "a refused concession changes nothing");
    });

    it("checkAction accepts it without changing the game, and perform does not write into the action", () => {
      const { engine } = table(count);
      const before = plain(engine);
      const action = Object.freeze(concede(P2));
      assert.deepEqual(engine.checkAction(action), { ok: true });
      assert.deepEqual(plain(engine), before);
      engine.perform(action);
      assert.ok(eliminated(engine, P2));
    });

    it("the log line is public and the redacted views of the game still work", () => {
      const { engine } = table(count);
      engine.perform(concede(P2));
      const entry = concessions(engine)[0]!;
      assert.equal(entry.redacted, undefined);
      assert.equal(logMessageFor(entry, null), "Bob concedes");
      for (const viewer of [...seats, "spectator"] as const) {
        const log = redactLogFor(engine.getLog(), engine.state.cards, viewer);
        assert.ok(log.some(line => line.marker === "playerConceded" && /concedes/.test(line.message)), `${viewer} reads it`);
        const view = redactStateFor(engine.state, viewer);
        assert.ok(view.players[P2]!.eliminated);
        redactFlowViewFor(engine.getFlowView(), viewer);
      }
    });

    it("saves and loads: before the concession, after it, and mid-way through the game", () => {
      const { engine } = table(count);
      const before = rebuild(engine);
      engine.perform(concede(P2));
      before.perform(concede(P2));
      assert.deepEqual(plain(before), plain(engine), "a game loaded before the concession ends the same way");
      const after = rebuild(engine);
      assert.deepEqual(plain(after), plain(engine), "a game loaded after it is the same game");
      assert.ok(eliminated(after, P2));
      assert.equal(getSaveSummary(after).winner, undefined);
      for (const g of [engine, after]) {
        endTurn(g);
        g.perform(concede(P1));
      }
      assert.deepEqual(plain(after), plain(engine));
      if (count === 4) {
        assert.equal(engine.state.activePlayerId, P3, "p3 is now up");
        assert.deepEqual(standing(engine), [P3, P4]);
        for (const g of [engine, after]) g.perform(concede(P4));
      }
      for (const g of [engine, after]) assert.equal(g.state.winner, P3);
      assert.deepEqual(plain(after), plain(engine));
      assert.equal(rebuild(engine).state.winner, engine.state.winner);
    });

    it("a log of actions with a concession replays to the same state", () => {
      const spell = tactic({ name: "Idle" });
      const cards = [{ key: "spell", def: spell, owner: P1, zone: "hand" as const }];
      const live = table(count, cards);
      const log: GameAction[] = [
        { type: "playCard", playerId: P1, cardId: live.id("spell") },
        { type: "passPriority", playerId: P2 },
        concede(lastSeat),
        concede(P2)
      ];
      const replayed = { engine: rebuild(live.engine) };
      for (const [i, action] of log.entries()) {
        for (const g of [live.engine, replayed.engine]) {
          try {
            g.perform(action);
          } catch (error) {
            assert.fail(`action ${i} ${JSON.stringify(action)}: ${(error as Error).message}`);
          }
        }
        assert.equal(digestState(live.engine.state), digestState(replayed.engine.state), `after action ${i}`);
      }
      assert.ok(eliminated(live.engine, lastSeat));
      if (count === 3) assert.equal(live.engine.state.winner, P1);
      else assert.ok(eliminated(live.engine, P2));
      assert.equal(replayed.engine.state.winner, live.engine.state.winner);
    });
  });
}

describe("concede — never offered", () => {
  it("is in no query of what a player may do, at any moment of a game", () => {
    const spell = tactic({ name: "Idle" });
    const { engine, id } = table(3, [{ key: "spell", def: spell, owner: P1, zone: "hand" }]);
    const offered = (): string => {
      const parts: unknown[] = [engine.getFlowView(), engine.getEndTurnBlock?.(engine.state.activePlayerId)];
      for (const who of SEATS.slice(0, 3)) {
        parts.push(engine.getAttackOptions(who), engine.getPlayableHandCards(who), engine.getPlayableFromOutsideHand(who));
        parts.push(engine.getAvailableActivatedAbilities(who), engine.getActivatedAbilityStatuses(who));
      }
      parts.push(engine.getBlockOptions());
      return JSON.stringify(parts);
    };
    assert.ok(!offered().includes("concede"), "main phase");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    assert.ok(!offered().includes("concede"), "response window");
    resolvePendingResponses(engine);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c-p1")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(!offered().includes("concede"), "blocking");
  });
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const named = (name: string, type: string): CardDefinition => {
  const found = CARD_CATALOG.find(card => card.name === name && card.type === type);
  assert.ok(found, `catalog has ${name}`);
  return found;
};
const TOURNAMENT = named("The Tournament Faction", "faction");
const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"].map(name => named(name, "resource"));

interface SetupOptions {
  factions?: CardDefinition[];
  chooseStartingResources?: boolean;
  chooseFirstPlayer?: boolean;
  firstPlayerId?: PlayerId;
}

function setupGame(count: number, options: SetupOptions = {}): SpoilsEngine {
  const factions = options.factions ?? Array<CardDefinition>(count).fill(TOURNAMENT);
  const definitions = [...new Set([...factions, ...STAPLES])];
  return createFactionGame(definitions, {
    players: factions.map((faction, seat) => ({
      id: SEATS[seat]!,
      name: `Player ${seat + 1}`,
      deckDefinitionIds: [faction.id, ...STAPLES.flatMap(staple => Array<string>(8).fill(staple.id))]
    })),
    seed: 11,
    ...(options.chooseStartingResources ? { chooseStartingResources: true } : {}),
    ...(options.chooseFirstPlayer ? { chooseFirstPlayer: true } : {}),
    ...(options.firstPlayerId ? { firstPlayerId: options.firstPlayerId } : {})
  });
}

/** Whose answer setup is waiting for, if anybody's. */
function waitingFor(engine: SpoilsEngine): PlayerId | undefined {
  return engine.getFlowView().actingPlayerId;
}

/** Answers every setup prompt in the plainest way until play starts; returns the players who answered, in order. */
function finishSetup(engine: SpoilsEngine): PlayerId[] {
  const answered: PlayerId[] = [];
  for (let guard = 0; engine.state.setup.phase !== "complete"; guard++) {
    assert.ok(guard < 100, "setup finishes");
    const setup = engine.state.setup;
    const choice = engine.state.pendingChoice;
    if (choice) {
      answered.push(choice.playerId);
      if (choice.kind === "choosePlayer") engine.perform(answerPlayer(choice.playerId, choice.candidates[0]!));
      else if (choice.kind === "chooserSelectsTarget") engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } });
      else assert.fail(`unexpected prompt ${choice.kind}`);
      continue;
    }
    switch (setup.phase) {
      case "mulligan": {
        const who = setup.order[setup.currentIndex]!;
        answered.push(who);
        engine.perform({ type: "mulligan", playerId: who, cardIds: [] });
        break;
      }
      case "chooseStartingResources": {
        const who = setup.order[setup.currentIndex]!;
        answered.push(who);
        const pick = engine.getStartingResourceChoice(who)!;
        engine.perform({ type: "chooseStartingResources", playerId: who, cardIds: pick.candidateCardIds.slice(0, pick.count) });
        break;
      }
      case "chooseFirstPlayer": {
        const who = setup.order[setup.currentIndex]!;
        answered.push(who);
        engine.perform({ type: "chooseFirstPlayer", playerId: who, firstPlayerId: who });
        break;
      }
      default:
        assert.fail(`setup stuck in ${setup.phase}`);
    }
  }
  return answered;
}

/** After setup: play has started, nobody out is up, and the turns pass through the seats still in the game. */
function assertPlaysOn(engine: SpoilsEngine, out: PlayerId[]): void {
  assert.equal(engine.state.setup.phase, "complete");
  assert.equal(engine.state.started, true);
  assert.equal(engine.state.winner, undefined);
  assert.ok(!out.includes(engine.state.activePlayerId), "a player who is out does not take the first turn");
  assert.equal(engine.state.priorityPlayerId, engine.state.activePlayerId);
  const order: PlayerId[] = [];
  for (let i = 0; i < 6; i++) {
    const active = engine.state.activePlayerId;
    order.push(active);
    // Develop and restore prompts of the first turns are answered with the plainest choice.
    for (let guard = 0; engine.state.pendingChoice && guard < 20; guard++) {
      const choice = engine.state.pendingChoice;
      if (choice.kind === "orderTriggers") engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "orderTriggers", next: choice.triggers[0]! } });
      else break;
    }
    if (engine.state.pendingChoice) return;
    engine.perform({ type: "endTurn", playerId: active });
    resolvePendingResponses(engine);
  }
  for (const who of order) assert.ok(!out.includes(who), `${who} is out and was given a turn`);
}

describe("concede — during setup", () => {
  for (const count of [3, 4]) {
    const seats = SEATS.slice(0, count);

    it(`${count} seats, mulligans: a player who has not decided yet, the one deciding, and the last one`, () => {
      for (const conceder of seats) {
        const engine = setupGame(count);
        assert.equal(engine.state.setup.phase, "mulligan");
        const order = engine.state.setup.phase === "mulligan" ? engine.state.setup.order : [];
        engine.perform(concede(conceder));
        assert.ok(eliminated(engine, conceder));
        assert.equal(engine.state.winner, undefined);
        if (engine.state.setup.phase === "mulligan") assert.ok(!engine.state.setup.order.includes(conceder));
        const answered = finishSetup(engine);
        assert.ok(!answered.includes(conceder));
        assert.deepEqual(answered.sort(), order.filter(id => id !== conceder).sort(), `${conceder}: everyone left was asked once`);
        assertPlaysOn(engine, [conceder]);
      }
    });

    it(`${count} seats, mulligans: the player deciding now concedes, and the next one is up`, () => {
      const engine = setupGame(count);
      engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
      assert.equal(waitingFor(engine), P2);
      engine.perform(concede(P2));
      assert.equal(waitingFor(engine), P3);
      finishSetup(engine);
      assertPlaysOn(engine, [P2]);
      assert.equal(engine.state.activePlayerId, P1);
    });

    it(`${count} seats, mulligans: the last one to decide concedes and play starts`, () => {
      const engine = setupGame(count);
      for (const who of seats.slice(0, -1)) engine.perform({ type: "mulligan", playerId: who, cardIds: [] });
      assert.equal(waitingFor(engine), seats[count - 1]);
      engine.perform(concede(seats[count - 1]!));
      assert.equal(engine.state.setup.phase, "complete");
      assertPlaysOn(engine, [seats[count - 1]!]);
    });

    it(`${count} seats, mulligans: the player who was to go first concedes, and the next seat goes first`, () => {
      const engine = setupGame(count, { firstPlayerId: P2 });
      engine.perform(concede(P2));
      finishSetup(engine);
      assert.equal(engine.state.activePlayerId, P3);
      assertPlaysOn(engine, [P2]);
    });

    it(`${count} seats, starting resources: a seat that has not chosen, the one choosing, and the last one`, () => {
      for (const conceder of seats) {
        const engine = setupGame(count, { chooseStartingResources: true });
        assert.equal(engine.state.setup.phase, "chooseStartingResources");
        const order = engine.state.setup.phase === "chooseStartingResources" ? [...engine.state.setup.order] : [];
        engine.perform(concede(conceder));
        assert.ok(eliminated(engine, conceder));
        const answered = finishSetup(engine);
        assert.ok(!answered.includes(conceder), `${conceder} is not asked again`);
        assert.ok(order.filter(id => id !== conceder).every(id => answered.includes(id)), `${conceder}: every other seat chose`);
        for (const who of seats.filter(id => id !== conceder)) {
          const player = engine.state.players[who]!;
          assert.ok(player.play.some(cardId => engine.getDefinition(cardId).type === "resource"), `${who} has starting resources`);
          assert.ok(player.hand.length > 0, `${who} has an opening hand`);
        }
        assertPlaysOn(engine, [conceder]);
      }
    });

    it(`${count} seats, starting resources: the last seat to choose concedes`, () => {
      const engine = setupGame(count, { chooseStartingResources: true });
      const setup = engine.state.setup;
      assert.ok(setup.phase === "chooseStartingResources");
      const last = setup.order[setup.order.length - 1]!;
      for (const who of setup.order.slice(0, -1)) {
        const pick = engine.getStartingResourceChoice(who)!;
        engine.perform({ type: "chooseStartingResources", playerId: who, cardIds: pick.candidateCardIds.slice(0, pick.count) });
      }
      assert.equal(waitingFor(engine), last);
      engine.perform(concede(last));
      assert.notEqual(engine.state.setup.phase, "chooseStartingResources");
      finishSetup(engine);
      assertPlaysOn(engine, [last]);
    });

    it(`${count} seats, who goes first: the player deciding concedes and another decides; nobody may name them`, () => {
      const engine = setupGame(count, { chooseFirstPlayer: true });
      assert.equal(engine.state.setup.phase, "chooseFirstPlayer");
      const decider = waitingFor(engine)!;
      engine.perform(concede(decider));
      assert.equal(engine.state.setup.phase, "chooseFirstPlayer");
      const next = waitingFor(engine)!;
      assert.notEqual(next, decider);
      assert.ok(!eliminated(engine, next));
      assert.throws(() => engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: next }), /out of the game/);
      assert.throws(() => engine.perform({ type: "chooseFirstPlayer", playerId: next, firstPlayerId: decider }), /out of the game/);
      engine.perform({ type: "chooseFirstPlayer", playerId: next, firstPlayerId: next });
      assert.equal(engine.state.activePlayerId, next);
      finishSetup(engine);
      assertPlaysOn(engine, [decider]);
    });

    it(`${count} seats, who goes first: another player concedes before the decision`, () => {
      const engine = setupGame(count, { chooseFirstPlayer: true });
      const decider = waitingFor(engine)!;
      const other = seats.find(id => id !== decider)!;
      engine.perform(concede(other));
      assert.equal(waitingFor(engine), decider);
      assert.throws(() => engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: other }), /out of the game/);
      engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: decider });
      finishSetup(engine);
      assertPlaysOn(engine, [other]);
    });

    it(`${count} seats, who goes first: they concede before the starting resources are chosen`, () => {
      const engine = setupGame(count, { chooseFirstPlayer: true, chooseStartingResources: true });
      assert.equal(engine.state.setup.phase, "chooseStartingResources");
      engine.perform(concede(P3));
      finishSetup(engine);
      assertPlaysOn(engine, [P3]);
    });
  }

  it("two seats: conceding during setup ends the game", () => {
    const engine = setupGame(2);
    assert.equal(engine.state.setup.phase, "mulligan");
    engine.perform(concede(P2));
    assert.equal(engine.state.winner, P1);
    assert.throws(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }));
  });

  it("the three players left after a concession in setup can play out the game to the end", () => {
    const engine = setupGame(4);
    engine.perform(concede(P4));
    finishSetup(engine);
    engine.perform(concede(P1));
    assert.equal(engine.state.activePlayerId, P2);
    engine.perform(concede(P3));
    assert.equal(engine.state.winner, P2);
  });

  describe("factions with a setup prompt of their own", () => {
    const UNLIKELY = CARD_CATALOG.find(card => card.name === "Unlikely Heroes" && card.type === "faction");
    const MINERS = CARD_CATALOG.find(card => card.name === "The Union of Unextraordinary Miners" && card.type === "faction");

    it("a STARTING DRAW search being offered: the player asked concedes and the next seat is asked", { skip: !UNLIKELY }, () => {
      const engine = setupGame(3, { factions: [UNLIKELY!, UNLIKELY!, UNLIKELY!], chooseStartingResources: true });
      for (let guard = 0; engine.state.setup.phase !== "startingDrawSearch"; guard++) {
        assert.ok(guard < 30, "the search step is reached");
        const setup = engine.state.setup;
        assert.ok(setup.phase === "chooseStartingResources");
        const who = setup.order[setup.currentIndex]!;
        const pick = engine.getStartingResourceChoice(who)!;
        const distinct = new Map(pick.candidateCardIds.map(cardId => [engine.getDefinition(cardId).id, cardId]));
        engine.perform({ type: "chooseStartingResources", playerId: who, cardIds: [...distinct.values()].slice(0, pick.count) });
      }
      const asked = engine.state.pendingChoice!.playerId;
      assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
      engine.perform(concede(asked));
      assert.ok(eliminated(engine, asked));
      const setup = engine.state.setup;
      if (setup.phase === "startingDrawSearch") {
        assert.notEqual(engine.state.pendingChoice?.playerId, asked);
        assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
      }
      finishSetup(engine);
      assertPlaysOn(engine, [asked]);
    });

    it("a player who has not been asked about a STARTING DRAW search concedes", { skip: !UNLIKELY }, () => {
      const engine = setupGame(3, { factions: [UNLIKELY!, UNLIKELY!, UNLIKELY!], chooseStartingResources: true });
      for (let guard = 0; engine.state.setup.phase !== "startingDrawSearch"; guard++) {
        assert.ok(guard < 30);
        const setup = engine.state.setup;
        assert.ok(setup.phase === "chooseStartingResources");
        const who = setup.order[setup.currentIndex]!;
        const pick = engine.getStartingResourceChoice(who)!;
        const distinct = new Map(pick.candidateCardIds.map(cardId => [engine.getDefinition(cardId).id, cardId]));
        engine.perform({ type: "chooseStartingResources", playerId: who, cardIds: [...distinct.values()].slice(0, pick.count) });
      }
      const setup = engine.state.setup;
      assert.ok(setup.phase === "startingDrawSearch");
      const later = setup.order[setup.order.length - 1]!;
      const asked = engine.state.pendingChoice!.playerId;
      assert.notEqual(later, asked);
      engine.perform(concede(later));
      assert.equal(engine.state.pendingChoice?.playerId, asked, "the prompt of the player asked stays");
      finishSetup(engine);
      assertPlaysOn(engine, [later]);
    });

    it("an opponent selection being made: the selector concedes, and the opponent they named concedes", { skip: !MINERS }, () => {
      for (const conceder of [P1, P2, P3, P4]) {
        const engine = setupGame(4, { factions: [MINERS!, TOURNAMENT, MINERS!, TOURNAMENT] });
        assert.equal(engine.state.setup.phase, "chooseMatchOpponent");
        const asked = engine.state.pendingChoice!.playerId;
        engine.perform(concede(conceder));
        assert.ok(eliminated(engine, conceder));
        const prompt = engine.state.pendingChoice;
        if (prompt) {
          assert.notEqual(prompt.playerId, conceder);
          assert.ok(prompt.kind === "choosePlayer" && !prompt.candidates.includes(conceder), "the prompt names nobody who is out");
        }
        const answered = finishSetup(engine);
        assert.ok(!answered.includes(conceder), `${conceder} (asked first: ${asked}) is not asked again`);
        assertPlaysOn(engine, [conceder]);
      }
    });

    // The selection is made, the other players are still choosing their starting resources, and the player selected concedes.
    const resources = (engine: SpoilsEngine, who: PlayerId): number =>
      engine.state.players[who]!.play.filter(cardId => engine.getDefinition(cardId).type === "resource").length;
    const choosingWithSelection = (count: number, selected: PlayerId): SpoilsEngine => {
      const engine = setupGame(count, { factions: [MINERS!, ...Array<CardDefinition>(count - 1).fill(TOURNAMENT)], chooseStartingResources: true });
      const first = engine.state.pendingChoice!;
      assert.equal(first.kind === "choosePlayer" && first.bind?.type, "matchOpponent");
      engine.perform(answerPlayer(P1, selected));
      assert.equal(engine.state.setup.phase, "chooseStartingResources");
      return engine;
    };
    const chooseAll = (engine: SpoilsEngine): void => {
      while (engine.state.setup.phase === "chooseStartingResources") {
        const setup = engine.state.setup;
        const who = setup.order[setup.currentIndex]!;
        const pick = engine.getStartingResourceChoice(who)!;
        engine.perform({ type: "chooseStartingResources", playerId: who, cardIds: pick.candidateCardIds.slice(0, pick.count) });
      }
    };

    for (const count of [3, 4]) {
      const seats = SEATS.slice(0, count);
      const lastSeat = seats[count - 1]!;

      // With three seats the selected opponent's concession leaves one opponent (the next test).
      if (count === 4) it(`${count} seats: the selected opponent concedes after the selection and more than one opponent is left: the Miners player is asked again`, { skip: !MINERS }, () => {
        const engine = choosingWithSelection(count, lastSeat);
        engine.perform(concede(lastSeat));
        assert.equal(engine.state.setup.phase, "chooseStartingResources");
        assert.equal(engine.state.pendingChoice, undefined, "the others still choose their starting resources first");
        chooseAll(engine);
        const prompt = engine.state.pendingChoice!;
        assert.equal(engine.state.setup.phase, "chooseMatchOpponent");
        assert.ok(prompt.kind === "choosePlayer" && prompt.bind?.type === "matchOpponent", "the same prompt as at setup");
        assert.equal(prompt.playerId, P1);
        assert.deepEqual((prompt as { candidates: PlayerId[] }).candidates, seats.slice(1, -1), "only players still in the game");
        assert.throws(() => engine.perform(answerPlayer(P1, lastSeat)));
        engine.perform(answerPlayer(P1, P2));
        finishSetup(engine);
        assertPlaysOn(engine, [lastSeat]);
        assert.ok(resources(engine, P2) >= resources(engine, P1), "the top-up matched the opponent selected the second time");
      });

      it(`${count} seats: the selected opponent concedes and one opponent is left: that player is bound without a question`, { skip: !MINERS }, () => {
        const engine = choosingWithSelection(count, lastSeat);
        for (const who of seats.slice(1, -1).slice(1)) engine.perform(concede(who));
        engine.perform(concede(lastSeat));
        assert.equal(standing(engine).length, 2);
        chooseAll(engine);
        assert.equal(engine.state.pendingChoice, undefined, "nobody is asked");
        assert.notEqual(engine.state.setup.phase, "chooseMatchOpponent");
        finishSetup(engine);
        assert.equal(engine.state.setup.phase, "complete");
        assert.ok(resources(engine, P2) >= resources(engine, P1), "the top-up matched the only opponent left");
        assertPlaysOn(engine, seats.slice(2));
      });

      it(`${count} seats: the Miners player concedes after selecting, and the selection is not asked for again`, { skip: !MINERS }, () => {
        const engine = choosingWithSelection(count, lastSeat);
        engine.perform(concede(P1));
        chooseAll(engine);
        finishSetup(engine);
        assertPlaysOn(engine, [P1]);
      });
    }

    it("an opponent selection that was made names the player who then concedes: the selection is made again or no longer needed", { skip: !MINERS }, () => {
      const engine = setupGame(4, { factions: [MINERS!, TOURNAMENT, MINERS!, TOURNAMENT] });
      const first = engine.state.pendingChoice!;
      assert.equal(first.kind, "choosePlayer");
      engine.perform(answerPlayer(first.playerId, P4));
      engine.perform(concede(P4));
      finishSetup(engine);
      assertPlaysOn(engine, [P4]);
    });
  });
});
