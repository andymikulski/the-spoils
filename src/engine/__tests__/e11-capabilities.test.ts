import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, developFaction, play, resolvePendingResponses, P1, P2 } from "./per-card/_harness.js";
import { answerPending, pending, zoneOf } from "./clauses/_board.js";
import type { CardDefinition } from "../../engine.js";

/**
 * Q53 (user ruling, 2026-10-21): the UNIQUE keep-one choice (CR 507.5) is enforced immediately, BEFORE the new
 * copy's "when this enters play" trigger. Keeping the new copy lets that trigger continue; if the new copy is the
 * one removed (destroyed, or flipped face-down by its own replacement) it never entered play: no trigger.
 */

const ENTERS_DRAW = {
  id: "etb",
  type: "triggered",
  event: "cardEnteredPlay",
  condition: { type: "sourceIsEventCard" },
  effects: [{ type: "draw", player: "controller", amount: 1 }]
};
const ENTERS_PICK = {
  id: "etb",
  type: "triggered",
  event: "cardEnteredPlay",
  condition: { type: "sourceIsEventCard" },
  targets: [{ id: "pick", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1, optional: true }],
  effects: []
};
/** "If this card would be destroyed, flip it face-down under its owner's control instead" (the Talonclaw shape). */
const FLIP_INSTEAD = {
  id: "phoenix-d",
  type: "replacement",
  replaces: { event: "destroy" },
  condition: { type: "isCard" },
  effects: [{ type: "flipFaceDown", target: { type: "selected", id: "__candidate" } }]
};

const uniqueDoer = (name: string, abilities: unknown[]): CardDefinition =>
  character({ name, unique: "q53", life: 5, behavior: { abilities } as never });

const board = (abilities: unknown[], extra: { key: string; def: CardDefinition; owner: string; zone: "play" | "hand" | "deck" }[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "old", def: uniqueDoer("Dup", abilities), owner: P1, zone: "play" },
      { key: "new", def: uniqueDoer("Dup", abilities), owner: P1, zone: "hand" },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `Deck${i}` }), owner: P1, zone: "deck" as const })),
      ...(extra as never[])
    ]
  });

const handSize = (engine: ReturnType<typeof board>["engine"]) => engine.state.players[P1].hand.length;

describe("E11 engine capabilities: UNIQUE is enforced before the new copy's enters-play trigger (Q53)", () => {
  test("the keep-one choice is the first prompt: the new copy's enters-play trigger has not resolved yet", () => {
    const { engine, id } = board([ENTERS_DRAW]);
    play(engine, P1, id("new"));
    const before = handSize(engine);
    const pc = pending(engine) as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.equal(handSize(engine), before, "its draw has not happened while the UNIQUE choice is open");
  });

  test("keeping the NEW copy destroys the old one and the new copy's enters-play trigger then continues", () => {
    const { engine, id } = board([ENTERS_DRAW]);
    play(engine, P1, id("new"));
    const before = handSize(engine);
    answerPending(engine, "uniqueSurvivor", { keep: id("new") });
    assert.equal(zoneOf(engine, id("new")), "play");
    assert.equal(zoneOf(engine, id("old")), "discard");
    assert.equal(handSize(engine), before + 1, "the kept new copy drew its card");
    assert.equal(pending(engine), undefined);
  });

  test("keeping the OLD copy destroys the new one, which never entered play: its enters-play trigger does not happen", () => {
    const { engine, id } = board([ENTERS_DRAW]);
    play(engine, P1, id("new"));
    const before = handSize(engine);
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    assert.equal(zoneOf(engine, id("old")), "play");
    assert.equal(zoneOf(engine, id("new")), "discard");
    assert.equal(handSize(engine), before, "no draw");
    assert.equal(pending(engine), undefined, "nothing left to resolve");
  });

  test("a new copy flipped face-down by its own would-be-destroyed replacement never entered play: no enters-play trigger", () => {
    const { engine, id } = board([ENTERS_DRAW, FLIP_INSTEAD]);
    play(engine, P1, id("new"));
    const before = handSize(engine);
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    assert.equal(zoneOf(engine, id("new")), "play");
    assert.equal(engine.state.cards[id("new")].faceDown, true, "flipped face-down instead of destroyed");
    assert.equal(handSize(engine), before, "its enters-play draw did not happen");
    assert.equal(pending(engine), undefined);
  });

  test("keeping the new copy of a flip-instead card flips the OLD one face-down and the new copy's trigger still fires", () => {
    const { engine, id } = board([ENTERS_DRAW, FLIP_INSTEAD]);
    play(engine, P1, id("new"));
    const before = handSize(engine);
    answerPending(engine, "uniqueSurvivor", { keep: id("new") });
    assert.equal(engine.state.cards[id("old")].faceDown, true);
    assert.equal(engine.state.cards[id("new")].faceDown, false);
    assert.equal(handSize(engine), before + 1);
  });

  test("an enters-play PICK also waits for the keep-one choice, and is offered only if the new copy is kept", () => {
    const opp = { key: "opp", def: character({ name: "Opp" }), owner: P2, zone: "play" as const };
    const keepNew = board([ENTERS_PICK], [opp]);
    play(keepNew.engine, P1, keepNew.id("new"));
    assert.equal((pending(keepNew.engine) as unknown as { kind: string }).kind, "uniqueSurvivor", "the keep-one choice comes before the pick");
    answerPending(keepNew.engine, "uniqueSurvivor", { keep: keepNew.id("new") });
    assert.equal((pending(keepNew.engine) as unknown as { kind: string }).kind, "selectTargets", "then the kept copy's pick");

    const keepOld = board([ENTERS_PICK], [opp]);
    play(keepOld.engine, P1, keepOld.id("new"));
    answerPending(keepOld.engine, "uniqueSurvivor", { keep: keepOld.id("old") });
    assert.equal(pending(keepOld.engine), undefined, "the destroyed new copy's pick is never offered");
  });

  test("no conflict (the opponent controls the other copy): the enters-play trigger fires at once, no UNIQUE choice", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "theirs", def: uniqueDoer("Dup", [ENTERS_DRAW]), owner: P2, zone: "play" },
        { key: "new", def: uniqueDoer("Dup", [ENTERS_DRAW]), owner: P1, zone: "hand" },
        { key: "d0", def: character({ name: "Deck0" }), owner: P1, zone: "deck" }
      ]
    });
    const before = g.engine.state.players[P1].hand.length;
    play(g.engine, P1, g.id("new"));
    assert.equal(pending(g.engine), undefined);
    assert.equal(g.engine.state.players[P1].hand.length, before - 1 + 1, "played one card from hand, drew one");
  });
});

/**
 * Q53 follow-up (user ruling): a NEW copy the UNIQUE rule removes is treated as never having entered play, so its
 * destruction triggers nothing at all: not its own "when this card is destroyed / leaves play", not anyone else's
 * "whenever a character is destroyed". The old copy, if it is the one removed, is destroyed normally.
 */
const GAIN = { type: "modifyInfluence", player: "controller", amount: 1 };
const SELF_DESTROYED = { id: "self-d", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [GAIN] };
const SELF_LEAVES = {
  id: "self-l",
  type: "triggered",
  event: "cardMoved",
  condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
  effects: [GAIN]
};
/** "Whenever any character is destroyed, I gain 1 influence" (an observer; not the Dup card). */
const ANY_DESTROYED = { id: "any-d", type: "triggered", event: "cardDestroyed", effects: [GAIN] };
const OBSERVER = { key: "obs", def: character({ name: "Observer", behavior: { abilities: [ANY_DESTROYED] } as never }), owner: P2, zone: "play" as const };
const influence = (engine: ReturnType<typeof board>["engine"], p: string) => engine.state.players[p as typeof P1].influence;

/** Settle simultaneous triggers: answer any "order your triggers" prompt (first first) and resolve the responses. */
const settle = (engine: ReturnType<typeof board>["engine"]): void => {
  for (let guard = 0; guard < 10; guard++) {
    resolvePendingResponses(engine);
    const pc = pending(engine) as unknown as { kind: string; triggers?: { sourceId: string; abilityId: string }[] } | undefined;
    if (pc?.kind !== "orderTriggers") return;
    answerPending(engine, "orderTriggers", { next: pc.triggers![0] });
  }
};

describe("E11b: a UNIQUE-removed NEW copy never entered play, so its destruction triggers nothing (Q53 follow-up)", () => {
  test("keeping the OLD copy: the new copy's own 'when destroyed' and 'leaves play' abilities do not fire", () => {
    const { engine, id } = board([SELF_DESTROYED, SELF_LEAVES]);
    play(engine, P1, id("new"));
    const before = influence(engine, P1);
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    settle(engine);
    assert.equal(zoneOf(engine, id("new")), "discard");
    assert.equal(influence(engine, P1), before, "no own destroy / leaves-play trigger");
  });

  test("keeping the OLD copy: another card's 'whenever a character is destroyed' does not fire for the new copy", () => {
    const { engine, id } = board([], [OBSERVER]);
    play(engine, P1, id("new"));
    const before = influence(engine, P2);
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    settle(engine);
    assert.equal(zoneOf(engine, id("new")), "discard");
    assert.equal(influence(engine, P2), before, "the observer saw no destruction");
  });

  test("keeping the NEW copy: the OLD copy is destroyed normally, so its own and observers' triggers fire", () => {
    const { engine, id } = board([SELF_DESTROYED, SELF_LEAVES], [OBSERVER]);
    play(engine, P1, id("new"));
    const mine = influence(engine, P1);
    const theirs = influence(engine, P2);
    answerPending(engine, "uniqueSurvivor", { keep: id("new") });
    settle(engine);
    assert.equal(zoneOf(engine, id("old")), "discard");
    assert.equal(zoneOf(engine, id("new")), "play");
    assert.equal(influence(engine, P1), mine + 2, "the old copy's 'destroyed' and 'leaves play' triggers fired");
    assert.equal(influence(engine, P2), theirs + 1, "the observer saw the old copy destroyed");
  });

  test("a Talonclaw-style replacement still flips the removed new copy face-down, silently", () => {
    const { engine, id } = board([SELF_DESTROYED, SELF_LEAVES, FLIP_INSTEAD], [OBSERVER]);
    play(engine, P1, id("new"));
    const mine = influence(engine, P1);
    const theirs = influence(engine, P2);
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    settle(engine);
    assert.equal(zoneOf(engine, id("new")), "play");
    assert.equal(engine.state.cards[id("new")].faceDown, true, "flipped face-down instead of destroyed");
    assert.equal(influence(engine, P1), mine, "its leaves-play trigger did not fire for the flip");
    assert.equal(influence(engine, P2), theirs);
  });

  test("the silence does not outlive the removal: a later destruction of the survivor triggers normally", () => {
    const { engine, id } = board([SELF_DESTROYED], [OBSERVER]);
    play(engine, P1, id("new"));
    answerPending(engine, "uniqueSurvivor", { keep: id("old") });
    settle(engine);
    const mine = influence(engine, P1);
    const theirs = influence(engine, P2);
    (engine as unknown as { destroyCard(id: string): void }).destroyCard(id("old"));
    settle(engine);
    assert.equal(influence(engine, P1), mine + 1);
    assert.equal(influence(engine, P2), theirs + 1);
  });

  test("two copies already in play from before (neither is new): the removed one is destroyed normally", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "a", def: uniqueDoer("Dup", [SELF_DESTROYED]), owner: P1, zone: "play" },
        { key: "b", def: uniqueDoer("Dup", [SELF_DESTROYED]), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "Mover" }), owner: P1, zone: "hand" }
      ]
    });
    play(g.engine, P1, g.id("c"));
    const before = influence(g.engine, P1);
    answerPending(g.engine, "uniqueSurvivor", { keep: g.id("a") });
    assert.equal(zoneOf(g.engine, g.id("b")), "discard");
    assert.equal(influence(g.engine, P1), before + 1, "a copy that was not new keeps its destroy trigger");
  });
});
