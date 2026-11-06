import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, buildGame, character, developFaction, P1, P2, play } from "./per-card/_harness.js";
import { CATALOG } from "./clauses/_manifest.js";
import type { CardDefinition, ContinuousAbility, TriggeredAbility } from "../../engine.js";

// Two refinements of ContinuousAbility.ignoresTriggers (Unwelcome Hero), from decade-of-deckadence-06-2 / -06-3:
//   TriggeredAbility.printedLead  a printed "When this card enters OR leaves play" trigger begins with neither quoted
//                                 phrase, so it is not ignored
//   simultaneous destruction      "destroy all ..." takes its cards out together (CR 305.2): the ignore source was
//                                 still in play when the others left, whichever of them the engine moves first

const infl = (b: { engine: { state: { players: Record<string, { influence: number }> } } }, p: string) => b.engine.state.players[p].influence;

const hero = (): CardDefinition =>
  character({
    name: "Hero",
    life: 3,
    behavior: {
      abilities: [{ id: "ignore", type: "continuous", modifiers: [], ignoresTriggers: ["thisCardEntersPlay", "thisCardLeavesPlay"] } as ContinuousAbility]
    }
  });

/** "When this card enters play / leaves play, lose 1 influence", as two authored halves; `lead` marks them one combined printed trigger. */
const halves = (name: string, lead?: "entersOrLeavesPlay"): CardDefinition =>
  character({
    name,
    cost: 0,
    life: 4,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }],
          ...(lead ? { printedLead: lead } : {})
        } as TriggeredAbility,
        {
          id: "ltp",
          type: "triggered",
          event: "cardMoved",
          condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
          effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }],
          ...(lead ? { printedLead: lead } : {})
        } as TriggeredAbility
      ]
    }
  });

/** "Destroy all characters." as an activated ability. */
const sweeper = (): CardDefinition =>
  character({
    name: "Sweeper",
    cost: 0,
    life: 9,
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        } as never
      ]
    }
  });

function board(cards: Array<{ key: string; def: CardDefinition; owner: string; zone?: string }>) {
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, activePlayerId: P1, cards: cards as never });
}

describe("printedLead: a combined 'enters or leaves play' trigger is not ignored", () => {
  test("control: two halves without a printed lead are both ignored (enters and leaves)", () => {
    const b = board([
      { key: "hero", def: hero(), owner: P1 },
      { key: "c", def: halves("Plain"), owner: P1, zone: "hand" },
      { key: "sw", def: sweeper(), owner: P1 }
    ]);
    const start = infl(b, P1);
    play(b.engine, P1, b.id("c"));
    assert.equal(infl(b, P1), start, "enters half ignored");
    activate(b.engine, P1, b.id("sw"), "sweep");
    assert.equal(b.engine.state.cards[b.id("c")].zone, "discard");
    assert.equal(infl(b, P1), start, "leaves half ignored");
  });

  test("with printedLead 'entersOrLeavesPlay' neither half is ignored", () => {
    const b = board([
      { key: "hero", def: hero(), owner: P1 },
      { key: "c", def: halves("Combined", "entersOrLeavesPlay"), owner: P1, zone: "hand" },
      { key: "sw", def: sweeper(), owner: P1 }
    ]);
    const start = infl(b, P1);
    play(b.engine, P1, b.id("c"));
    assert.equal(infl(b, P1), start - 1, "enters half fires");
    activate(b.engine, P1, b.id("sw"), "sweep");
    assert.equal(b.engine.state.cards[b.id("c")].zone, "discard");
    assert.equal(infl(b, P1), start - 2, "leaves half fires, even though the Hero was destroyed with it");
  });

  test("every catalog printing whose rules text says 'enters or leaves play' marks both authored halves", () => {
    const combined = CATALOG.filter(card => /when this card enters or leaves play/i.test(card.text ?? ""));
    assert.ok(combined.length >= 5, "Scavengemajig, Swarm of Gnats, Thabbashite Haruspex, Dowsing Cleric, Jo Ciendeilio");
    for (const card of combined) {
      const marked = (card.behavior?.abilities ?? []).filter(a => a.type === "triggered" && (a as TriggeredAbility).printedLead === "entersOrLeavesPlay");
      assert.equal(marked.length, 2, `${card.name} (${card.set})`);
    }
  });
});

describe("a 'destroy all' effect takes its cards out together (CR 305.2)", () => {
  for (const heroFirst of [true, false]) {
    test(`the other card's leaves-play trigger is ignored whichever is first in play (hero first: ${heroFirst})`, () => {
      const heroP = { key: "hero", def: hero(), owner: P1 };
      const leaverP = { key: "leaver", def: halves("Leaver"), owner: P2 };
      const b = board([...(heroFirst ? [heroP, leaverP] : [leaverP, heroP]), { key: "sw", def: sweeper(), owner: P1 }]);
      const start = infl(b, P2);
      activate(b.engine, P1, b.id("sw"), "sweep");
      assert.equal(b.engine.state.cards[b.id("hero")].zone, "discard");
      assert.equal(b.engine.state.cards[b.id("leaver")].zone, "discard");
      assert.equal(infl(b, P2), start, "ignored");
    });
  }

  test("without the Hero the same sweep fires the leaves-play trigger", () => {
    const b = board([
      { key: "leaver", def: halves("Leaver"), owner: P2 },
      { key: "sw", def: sweeper(), owner: P1 }
    ]);
    const start = infl(b, P2);
    activate(b.engine, P1, b.id("sw"), "sweep");
    assert.equal(infl(b, P2), start - 1);
  });

  test("the snapshot is only for that sweep: once it is over and the Hero is gone, later departures trigger", () => {
    const b = board([
      { key: "hero", def: hero(), owner: P1 },
      { key: "sw", def: sweeper(), owner: P1 },
      { key: "late", def: halves("Late"), owner: P1, zone: "hand" }
    ]);
    activate(b.engine, P1, b.id("sw"), "sweep");
    assert.equal(b.engine.state.cards[b.id("hero")].zone, "discard");
    const start = infl(b, P1);
    play(b.engine, P1, b.id("late"));
    assert.equal(infl(b, P1), start - 1, "the Hero is gone, so an enters-play trigger fires again");
  });
});
