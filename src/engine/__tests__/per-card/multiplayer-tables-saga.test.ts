// Table matrix (docs/MULTIPLAYER-PLAN.md Phase 7): Seed Saga / Decade of Deckadence / Shade of the Devoured Emperor.
// Cards whose printed text names every seat's turn or "each player" / "both players" / "each opponent" are loaded from
// the real catalog and played at a real three-player table. The clause tests keep these cards at two seats (the extra
// seats sit out of the turn rotation there); here the third seat takes part and the printed reading is asserted.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  P1,
  P2,
  bank,
  buildGame,
  cardDef,
  character,
  killTactic,
  play,
  resolvePendingResponses,
  settleStartFirst
} from "./_harness.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";

const P3 = "p3";

/** A faction that restores nothing and offers no Develop choices: a turn start only raises the cards' own triggers. */
const barren = (): CardDefinition =>
  factionCard({
    faction: defaultFactionDefinition({
      turn: { restore: { detachResources: false, restoreNonResources: false }, develop: { choices: [] } }
    })
  });
const SEATS = [P1, P2, P3].map(id => ({ id, faction: barren() }));

type Game = ReturnType<typeof buildGame>;

/** A three-player table, p1's turn (or `active`'s). */
function table(cards: CardPlacement[], active: PlayerId = P1): Game {
  return buildGame({ players: SEATS, cards, activePlayerId: active, turn: SEATS.findIndex(s => s.id === active) + 1 });
}

const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as { kind: string; playerId: string; [k: string]: unknown } | undefined;
const zoneOf = (engine: SpoilsEngine, id: string) => engine.state.cards[id].zone;
const tokensOn = (engine: SpoilsEngine, id: string) => engine.state.cards[id].counters?.token ?? 0;
const influence = (engine: SpoilsEngine, id: PlayerId) => engine.state.players[id].influence;
const handOf = (engine: SpoilsEngine, id: PlayerId) => [...engine.state.players[id].hand];

/** Ends `playerId`'s turn and settles the next turn's Restore / Develop Rule, leaving a card's own prompt open. */
function endTurn(engine: SpoilsEngine, playerId: PlayerId): void {
  engine.perform({ type: "endTurn", playerId });
  resolvePendingResponses(engine);
  settleStartFirst(engine);
  resolvePendingResponses(engine);
}

/** Answers the open prompt `kind` for whoever it asks. */
function answer(engine: SpoilsEngine, kind: string, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected a ${kind} prompt, found none`);
  assert.equal(pc.kind, kind, `expected a ${kind} prompt, found ${pc.kind}`);
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind, ...choice } } as never);
  resolvePendingResponses(engine);
}

const cd = (set: string, name: string): CardDefinition => cardDef(set, name);
const factionOf = (engine: SpoilsEngine, id: PlayerId) => engine.state.players[id].factionId!;

describe("Corpse Churner (Decade of Deckadence): a token at the start of EACH turn", () => {
  test("every seat's turn start adds one, so a round of three seats adds three", () => {
    const g = table([{ key: "ch", def: cd("Decade of Deckadence", "Corpse Churner"), owner: P1, zone: "play" }]);
    endTurn(g.engine, P1);
    assert.equal(g.engine.state.activePlayerId, P2);
    assert.equal(tokensOn(g.engine, g.id("ch")), 1);
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P3);
    assert.equal(tokensOn(g.engine, g.id("ch")), 2, "the third seat's turn start counts too");
    endTurn(g.engine, P3);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(tokensOn(g.engine, g.id("ch")), 3);
  });
});

describe("Engorged Sarcophyle (Decade of Deckadence): 'pick an opponent', that player destroys a character they control", () => {
  const board = () =>
    table(
      [
        { key: "eng", def: cd("Decade of Deckadence", "Engorged Sarcophyle"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        { key: "a0", def: character({ name: "A0", life: 3 }), owner: P2, zone: "play" },
        { key: "a1", def: character({ name: "A1", life: 3 }), owner: P2, zone: "play" },
        { key: "b0", def: character({ name: "B0", life: 3 }), owner: P3, zone: "play" },
        { key: "b1", def: character({ name: "B1", life: 3 }), owner: P3, zone: "play" }
      ],
      P2
    );

  test("the controller picks among the opponents; only the picked one chooses and destroys a character of theirs", () => {
    const g = board();
    play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("eng")] }, opponentId: P1 } as never);
    assert.equal(zoneOf(g.engine, g.id("eng")), "discard");
    const pick = pending(g.engine)!;
    assert.equal(pick.kind, "selectTargets", "several opponents: the controller is asked which one");
    assert.equal(pick.playerId, P1);
    const decl = (pick.declarations as Array<{ id: string }>)[0].id;
    answer(g.engine, "selectTargets", { selected: { [decl]: [factionOf(g.engine, P3)] } });
    const choose = pending(g.engine)!;
    assert.equal(choose.kind, "chooserSelectsTarget");
    assert.equal(choose.playerId, P3, "the picked opponent chooses");
    answer(g.engine, "chooserSelectsTarget", { selected: [g.id("b1")] });
    assert.equal(zoneOf(g.engine, g.id("b1")), "discard");
    assert.equal(zoneOf(g.engine, g.id("b0")), "play");
    assert.equal(zoneOf(g.engine, g.id("a0")), "play", "the other opponent is untouched");
    assert.equal(zoneOf(g.engine, g.id("a1")), "play");
  });
});

describe("Obscene Communion: 'each player' (Seed Saga) reaches every seat, 'both players' (Seed) only the controller and the opponent", () => {
  const board = (set: string) =>
    table([
      { key: "c", def: cd(set, "Obscene Communion"), owner: P1, zone: "play" },
      ...[P1, P2, P3].flatMap(p => [0, 1].map(i => ({ key: `${p}h${i}`, def: character({ name: `${p}H${i}` }), owner: p, zone: "hand" as const })))
    ]);

  /** P2's turn starts, P2 picks OPTION 3 (discard a card), then every prompted player discards their first card. */
  function discardRound(g: Game): string[] {
    endTurn(g.engine, P1);
    assert.equal(g.engine.state.activePlayerId, P2);
    answer(g.engine, "chooserSelectsOption", { index: 2 });
    const asked: string[] = [];
    for (let n = 0; pending(g.engine) && n < 10; n++) {
      const pc = pending(g.engine)!;
      asked.push(pc.playerId);
      answer(g.engine, "chooserSelectsTarget", { selected: [handOf(g.engine, pc.playerId)[0]] });
    }
    return asked;
  }

  test("Seed Saga: every player, the third seat included, discards", () => {
    const g = board("Seed Saga");
    const asked = discardRound(g);
    assert.deepEqual([...asked].sort(), [P1, P2, P3]);
    for (const p of [P1, P2, P3]) assert.equal(handOf(g.engine, p).length, 1, `${p} discarded one`);
  });

  test("Seed: both players, the controller and the opponent whose turn it is, and the third seat keeps its hand", () => {
    const g = board("Seed");
    const asked = discardRound(g);
    assert.deepEqual([...asked].sort(), [P1, P2]);
    assert.equal(handOf(g.engine, P1).length, 1);
    assert.equal(handOf(g.engine, P2).length, 1);
    assert.equal(handOf(g.engine, P3).length, 2, "the third seat is not one of 'both players'");
  });
});

describe("P3pp3r 0f 1n54n17y (Seed Saga): restores the attached character at the start of each opponent's turn", () => {
  test("at both opponents' turn starts, never at the controller's own", () => {
    const g = table([
      { key: "host", def: character({ name: "Host", life: 3 }), owner: P1, zone: "play", depleted: true },
      { key: "pp", def: cd("Seed Saga", "P3pp3r 0f 1n54n17y"), owner: P1, zone: "play", attachedToKey: "host" }
    ]);
    const depleted = () => g.engine.state.cards[g.id("host")].depleted === true;
    endTurn(g.engine, P1);
    assert.equal(depleted(), false, "restored at P2's turn start");
    g.engine.state.cards[g.id("host")].depleted = true;
    endTurn(g.engine, P2);
    assert.equal(depleted(), false, "restored again at P3's turn start");
    g.engine.state.cards[g.id("host")].depleted = true;
    endTurn(g.engine, P3);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(depleted(), true, "not at its controller's own turn start");
  });
});

describe("Tumescent Guilt Bladder (Seed Saga): at the start of each turn with 3+ tokens an opponent takes control", () => {
  test("the opponent whose turn it is takes it (the third seat when it is theirs)", () => {
    const g = table(
      [{ key: "tgb", def: cd("Seed Saga", "Tumescent Guilt Bladder"), owner: P1, zone: "play", counters: { token: 3 } }],
      P2
    );
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P3);
    assert.equal(g.engine.state.cards[g.id("tgb")].controllerId, P3, "P3's turn starts: P3 takes control");
    assert.equal(tokensOn(g.engine, g.id("tgb")), 0);
    assert.equal(g.engine.state.cards[g.id("tgb")].ownerId, P1);
  });
});

describe("Braggadocian Aide (Seed Saga): the pick comes at the start of each opponent's turn", () => {
  test("offered at P2's and at P3's turn start, not at its controller's own", () => {
    const attached = (key: string): CardPlacement => ({
      key,
      def: character({ name: key, cost: 0 }),
      owner: P1,
      zone: "play",
      faceDown: true,
      attachedToKey: "__factionA"
    });
    const g = table([{ key: "aide", def: cd("Seed Saga", "Braggadocian Aide"), owner: P1, zone: "play" }, attached("r1"), attached("r2")]);
    const isAttached = (key: string) => g.engine.state.cards[g.id(key)].attachedTo !== undefined && g.engine.state.cards[g.id(key)].attachedTo !== null;
    endTurn(g.engine, P1);
    let pc = pending(g.engine)!;
    assert.equal(pc.kind, "selectTargets");
    assert.equal(pc.playerId, P1);
    answer(g.engine, "selectTargets", { selected: { res: [g.id("r1")] } });
    assert.equal(isAttached("r1"), false, "detached at P2's turn start");
    endTurn(g.engine, P2);
    pc = pending(g.engine)!;
    assert.equal(g.engine.state.activePlayerId, P3);
    assert.equal(pc.kind, "selectTargets", "offered again at P3's turn start");
    answer(g.engine, "selectTargets", { selected: { res: [g.id("r2")] } });
    assert.equal(isAttached("r2"), false);
    endTurn(g.engine, P3);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(pending(g.engine), undefined, "nothing at its controller's own turn start");
  });
});

describe("Stuttershy (Shade of the Devoured Emperor): each opponent's faction gains 1, a Micromajig for each influence gained", () => {
  test("two opponents gain 1 each and the controller may put two tokens into play", () => {
    const g = table(
      [
        { key: "st", def: cd("Shade of the Devoured Emperor", "Stuttershy"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
      ],
      P2
    );
    const before = [influence(g.engine, P1), influence(g.engine, P2), influence(g.engine, P3)];
    play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("st")] }, opponentId: P1 } as never);
    assert.equal(g.engine.state.cards[g.id("st")].faceDown, true, "flipped face-down instead of destroyed");
    assert.equal(influence(g.engine, P2) - before[1], 1);
    assert.equal(influence(g.engine, P3) - before[2], 1, "the third seat gains too");
    assert.equal(influence(g.engine, P1), before[0], "the controller does not");
    answer(g.engine, "chooserSelectsOption", { index: 1 });
    const tokens = Object.values(g.engine.state.cards).filter(card => card.isToken && card.zone === "play");
    assert.equal(tokens.length, 2, "one token per influence gained");
    for (const token of tokens) assert.equal(token.controllerId, P1);
  });
});

describe("Drill Instructor (Shade of the Devoured Emperor): +3 strength at the start of the NEXT turn only", () => {
  test("the next turn is the next seat's (P2), and it is over by P3's turn", () => {
    const g = table([
      { key: "di", def: cd("Shade of the Devoured Emperor", "Drill Instructor"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P3, zone: "play" },
      ...bank("rage", 3, P1)
    ]);
    play(g.engine, P1, g.id("di"), {});
    answer(g.engine, "selectTargets", { selected: { pick: [g.id("mine")] } });
    const strength = () => g.engine.getStat(g.id("mine"), "strength");
    assert.equal(strength(), 2);
    endTurn(g.engine, P1);
    assert.equal(g.engine.state.activePlayerId, P2);
    assert.equal(strength(), 5, "+3 during P2's turn");
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P3);
    assert.equal(strength(), 2, "over at P3's turn");
  });
});
