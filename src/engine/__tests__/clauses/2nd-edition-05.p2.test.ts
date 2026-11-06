// Clause tests for batch 2nd-edition-05, part p2 (groups 19-26): Ferrous Ferret,
// Fool's Gold, Forced Recruitment, Grand Theft All, Hangdog Alley, Heist Planner,
// Hyperphagic Sarcophyle, Jackmove.
//
// Each test is written from the PRINTED text; the engine's behavior JSON is used
// only to drive it. Findings: data/card-tests/findings/2nd-edition-05.p2.md.

import assert from "node:assert/strict";
import { buildGame, activate, character, developFaction, item, location, P1, P2, tactic, play, bank, resolvePendingResponses, resourceCard } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardSelector, SpoilsEngine } from "../../../engine.js";
import { clause, drain, declineAll, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, fight, fightThrough, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";

// ---------------------------------------------------------------------------
// Ferrous Ferret
// ---------------------------------------------------------------------------

const FERRET = "6038232b-1072-4827-865a-0852aa5e66d9"; // character · rogue · beast · cost 2 · dd · 1/4/1 -- Anything that can pick this card must pick it. -- If this card is picked, put a token on it. -- +1 strength and +1 life per token on it.

/** A synthetic character whose ability `pick` picks `count` cards matching `selector` and puts a "mark" counter on each (a harmless, observable effect). */
const pickerChar = (name: string, selector: CardSelector, opts: { count?: number; optional?: boolean } = {}): CardDefinition =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "pick",
          type: "activated",
          targets: [{ id: "t", selector, count: opts.count ?? 1, ...(opts.optional ? { optional: true } : {}) }],
          // `addCounter` resolves its single target ref to ONE card, so a multi-card pick marks each pick with a `forEach`.
          effects: [
            (opts.count ?? 1) > 1
              ? { type: "forEach", selected: "t", effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "mark", amount: 1 }] }
              : { type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }
          ]
        }
      ]
    }
  });

/** A synthetic item with the same picking ability. */
const pickerItem = (name: string, selector: CardSelector): CardDefinition =>
  item({
    name,
    behavior: {
      abilities: [
        {
          id: "pick",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }]
        }
      ]
    }
  });

/** A synthetic free tactic that picks one card matching `selector` and marks it. */
const pickerTactic = (name: string, selector: CardSelector): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pick",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }]
        }
      ]
    }
  });

/** A synthetic character with a "choose a card" effect: its controller picks via chooserSelectsTarget (not a declaration). */
const chooserChar = (name: string, selector: CardSelector): CardDefinition =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "pick",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "cs", selector, count: 1 },
              effects: [{ type: "addCounter", target: { type: "selected", id: "cs" }, counter: "mark", amount: 1 }]
            }
          ]
        }
      ]
    }
  });

/** A synthetic character with a triggered pick: when it enters play, its controller picks one card matching `selector`. */
const triggerPickerChar = (name: string, selector: CardSelector): CardDefinition =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "etbpick",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }]
        }
      ]
    }
  });

/** A free tactic that destroys one chosen character. */
const killChar = (): CardDefinition =>
  tactic({
    name: "Assassinate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const ANY_CHARACTER: CardSelector = { type: "character" };

/** Moves a card straight to `to` through the engine's (private) zone-move primitive: "the card left play". */
const moveCard = (engine: SpoilsEngine, cardId: string, to: string): void =>
  (engine as unknown as { moveCard(id: string, zone: string): void }).moveCard(cardId, to);
const marks = (engine: SpoilsEngine, id: string): number => engine.state.cards[id].counters?.mark ?? 0;

/**
 * P1 owns the Ferret and a plain "Mate"; P2 (the active player, so P2's abilities are usable)
 * owns a plain "Foe" and whatever `extra` adds.
 */
function ferretBoard(extra: CardPlacement[] = [], activePlayerId = P2) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId,
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}

clause(FERRET, "0:rule", "an opponent's ability that picks a character must pick the Ferret: every other character, on either side, is refused", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" }]);
  for (const other of ["mate", "foe", "src"]) {
    refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id(other)] } }), `${other} is refused while the Ferret can be picked`);
  }
  assert.equal(marks(engine, id("mate")) + marks(engine, id("foe")) + marks(engine, id("src")), 0, "no refused pick did anything");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1, "the Ferret itself can be picked");
});

clause(FERRET, "0:rule", "the pickable candidates collapse to the Ferret alone", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" }]);
  const candidates = engine.targetCandidates(ANY_CHARACTER, { sourceId: id("src"), controllerId: P2, abilityId: "pick", selected: {} }, P2).map((card) => card.id);
  assert.deepEqual(candidates, [id("ferret")]);
});

clause(FERRET, "0:rule", "applies to the Ferret's own controller too: their own ability must pick it", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("MyPicker", ANY_CHARACTER), owner: P1, zone: "play" }], P1);
  refused(() => activate(engine, P1, id("src"), "pick", { selected: { t: [id("mate")] } }), "their own pick of another character is refused");
  activate(engine, P1, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1);
  assert.equal(marks(engine, id("mate")), 0);
});

clause(FERRET, "0:rule", "anything: an item's ability and a tactic both must pick it", () => {
  const itemGame = ferretBoard([{ key: "src", def: pickerItem("PickerItem", ANY_CHARACTER), owner: P2, zone: "play" }]);
  refused(() => activate(itemGame.engine, P2, itemGame.id("src"), "pick", { selected: { t: [itemGame.id("foe")] } }), "an item may not pick another character");
  activate(itemGame.engine, P2, itemGame.id("src"), "pick", { selected: { t: [itemGame.id("ferret")] } });
  assert.equal(marks(itemGame.engine, itemGame.id("ferret")), 1);

  const tacticGame = ferretBoard([{ key: "src", def: pickerTactic("PickerTactic", ANY_CHARACTER), owner: P2, zone: "hand" }]);
  refused(() => play(tacticGame.engine, P2, tacticGame.id("src"), { selected: { t: [tacticGame.id("foe")] } }), "a tactic may not pick another character");
  assert.equal(zoneOf(tacticGame.engine, tacticGame.id("src")), "hand", "the refused tactic stays in hand");
  play(tacticGame.engine, P2, tacticGame.id("src"), { selected: { t: [tacticGame.id("ferret")] } });
  assert.equal(marks(tacticGame.engine, tacticGame.id("ferret")), 1);
  assert.equal(marks(tacticGame.engine, tacticGame.id("foe")), 0);
});

clause(FERRET, "0:rule", "anything: a location's ability must pick it", () => {
  const locationDef = location({
    name: "PickerLocation",
    behavior: {
      abilities: [
        {
          id: "pick",
          type: "activated",
          targets: [{ id: "t", selector: ANY_CHARACTER, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = ferretBoard([{ key: "src", def: locationDef, owner: P2, zone: "play" }]);
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id("foe")] } }), "a location may not pick another character");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1);
});

clause(FERRET, "0:rule", "a 'choose a target' effect (chooserSelectsTarget) must pick it", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: chooserChar("Chooser", ANY_CHARACTER), owner: P2, zone: "play" }]);
  activate(engine, P2, id("src"), "pick");
  const pc = pending(engine);
  if (pc) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id("foe")] } } as never),
      "the chooser may not pick another character",
      /pick|candidate|target|legal|select/i
    );
    answerPending(engine, "chooserSelectsTarget", { selected: [id("ferret")] });
  }
  assert.equal(pending(engine), undefined);
  assert.equal(marks(engine, id("ferret")), 1);
  assert.equal(marks(engine, id("foe")), 0);
});

clause(FERRET, "0:rule", "a triggered pick must pick it (the only legal pick is made for the player)", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: triggerPickerChar("TriggerPicker", ANY_CHARACTER), owner: P2, zone: "hand" }]);
  play(engine, P2, id("src"));
  assert.equal(zoneOf(engine, id("src")), "play");
  assert.equal(pending(engine), undefined, "nothing left to decide: only the Ferret is pickable");
  assert.equal(marks(engine, id("ferret")), 1);
  assert.equal(marks(engine, id("foe")) + marks(engine, id("mate")), 0);

  // control: without the Ferret the same trigger really does ask which character to pick
  const control = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "src", def: triggerPickerChar("TriggerPicker", ANY_CHARACTER), owner: P2, zone: "hand" }
    ]
  });
  play(control.engine, P2, control.id("src"));
  assert.equal(pending(control.engine)?.kind, "selectTargets", "control: a free choice is asked for");
});

clause(FERRET, "0:rule", "two Ferrets: the picker chooses which one to pick, but still not any other character", () => {
  const { engine, id } = ferretBoard([
    { key: "ferret2", def: printing(FERRET), owner: P1, zone: "play" },
    { key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" }
  ]);
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id("mate")] } }), "a non-Ferret is refused");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret2")] } });
  assert.equal(marks(engine, id("ferret2")), 1, "either Ferret satisfies the requirement");
  assert.equal(marks(engine, id("ferret")), 0);
});

clause(FERRET, "0:rule", "only a pick that CAN pick the Ferret is constrained: item-only, own-side-only and discard-pile picks are free", () => {
  const items = ferretBoard([
    { key: "src", def: pickerChar("ItemPicker", { type: "item" }), owner: P2, zone: "play" },
    { key: "itemA", def: item({ name: "ItemA" }), owner: P2, zone: "play" }
  ]);
  activate(items.engine, P2, items.id("src"), "pick", { selected: { t: [items.id("itemA")] } });
  assert.equal(marks(items.engine, items.id("itemA")), 1, "an 'item' pick is not forced onto the Ferret");

  const ownSide = ferretBoard([{ key: "src", def: pickerChar("OwnPicker", { type: "character", controller: "self" }), owner: P2, zone: "play" }]);
  activate(ownSide.engine, P2, ownSide.id("src"), "pick", { selected: { t: [ownSide.id("foe")] } });
  assert.equal(marks(ownSide.engine, ownSide.id("foe")), 1, "a pick of 'a character you control' can't pick the opponent's Ferret");

  const control = ferretBoard([{ key: "src", def: pickerChar("OwnPicker", { type: "character", controller: "self" }), owner: P2, zone: "play" }]);
  refused(
    () => activate(control.engine, P2, control.id("src"), "pick", { selected: { t: [control.id("ferret")] } }),
    "control: the Ferret itself is not a legal pick of 'a character you control'"
  );
});

clause(FERRET, "0:rule", "(This effect is only active while this card is in play): in the discard pile or hand it forces nothing", () => {
  const discardSel: CardSelector = { type: "character", zone: "discard", owner: "any" };
  const inDiscard = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "discard" },
      { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard" },
      { key: "src", def: pickerChar("Necro", discardSel), owner: P2, zone: "play" }
    ]
  });
  activate(inDiscard.engine, P2, inDiscard.id("src"), "pick", { selected: { t: [inDiscard.id("dead")] } });
  assert.equal(marks(inDiscard.engine, inDiscard.id("dead")), 1, "a discarded Ferret does not force the pick");
  assert.equal(marks(inDiscard.engine, inDiscard.id("ferret")), 0);

  const handSel: CardSelector = { type: "character", zone: "hand", owner: "any" };
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" },
      { key: "src", def: pickerChar("Peeker", handSel), owner: P2, zone: "play" }
    ]
  });
  activate(inHand.engine, P2, inHand.id("src"), "pick", { selected: { t: [inHand.id("other")] } });
  assert.equal(marks(inHand.engine, inHand.id("other")), 1, "a Ferret in hand does not force the pick");
});

clause(FERRET, "0:rule", "once the Ferret leaves play the requirement is off, and stays off", () => {
  const { engine, id } = ferretBoard([
    { key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" },
    { key: "src2", def: pickerChar("Picker2", ANY_CHARACTER), owner: P2, zone: "play" }
  ]);
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id("foe")] } }), "control: forced while the Ferret is in play");
  moveCard(engine, id("ferret"), "discard");
  assert.equal(zoneOf(engine, id("ferret")), "discard");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("foe")] } });
  assert.equal(marks(engine, id("foe")), 1, "any character may be picked once the Ferret is gone");
  activate(engine, P2, id("src2"), "pick", { selected: { t: [id("mate")] } });
  assert.equal(marks(engine, id("mate")), 1, "and again");
});

clause(FERRET, "0:rule", "a pick of two characters must include the Ferret (and may add one other character)", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("DoublePicker", ANY_CHARACTER, { count: 2 }), owner: P2, zone: "play" }]);
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id("mate"), id("foe")] } }), "two other characters, leaving the Ferret out, is refused");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret"), id("foe")] } });
  assert.equal(marks(engine, id("ferret")), 1);
  assert.equal(marks(engine, id("foe")), 1);
  assert.equal(marks(engine, id("mate")), 0);
  assert.equal(tokensOn(engine, id("ferret")), 1, "picked once: one token");
});

clause(FERRET, "0:rule", "an 'up to' pick still has to pick the Ferret: picking nothing is refused", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("OptionalPicker", ANY_CHARACTER, { optional: true }), owner: P2, zone: "play" }]);
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [id("foe")] } }), "picking another character instead");
  refused(() => activate(engine, P2, id("src"), "pick", { selected: { t: [] } }), "declining to pick while the Ferret can be picked");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1);
});

// ----- 1:rule

clause(FERRET, "1:rule", "picked by an opponent's ability: one token goes on the Ferret, none on anything else", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" }]);
  assert.equal(tokensOn(engine, id("ferret")), 0, "starts with no tokens");
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1, "control: the Ferret was picked");
  assert.equal(tokensOn(engine, id("ferret")), 1);
  assert.equal(tokensOn(engine, id("mate")) + tokensOn(engine, id("foe")) + tokensOn(engine, id("src")), 0);
});

clause(FERRET, "1:rule", "picked by its controller's own ability also gets a token", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("MyPicker", ANY_CHARACTER), owner: P1, zone: "play" }], P1);
  activate(engine, P1, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(tokensOn(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by a tactic gets a token", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerTactic("PickerTactic", ANY_CHARACTER), owner: P2, zone: "hand" }]);
  play(engine, P2, id("src"), { selected: { t: [id("ferret")] } });
  assert.equal(zoneOf(engine, id("src")), "discard", "the tactic resolved");
  assert.equal(marks(engine, id("ferret")), 1, "control: the Ferret was picked");
  assert.equal(tokensOn(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by a triggered ability gets a token", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: triggerPickerChar("TriggerPicker", ANY_CHARACTER), owner: P2, zone: "hand" }]);
  play(engine, P2, id("src"));
  assert.equal(pending(engine), undefined);
  assert.equal(marks(engine, id("ferret")), 1, "control: the Ferret was picked");
  assert.equal(tokensOn(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by a 'choose a target' effect (chooserSelectsTarget) gets a token", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: chooserChar("Chooser", ANY_CHARACTER), owner: P2, zone: "play" }]);
  activate(engine, P2, id("src"), "pick");
  if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [id("ferret")] });
  assert.equal(pending(engine), undefined);
  assert.equal(marks(engine, id("ferret")), 1, "control: the Ferret was picked");
  assert.equal(tokensOn(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "each pick adds a token: picked twice, two tokens", () => {
  const { engine, id } = ferretBoard([
    { key: "src", def: pickerChar("Picker", ANY_CHARACTER), owner: P2, zone: "play" },
    { key: "src2", def: pickerChar("Picker2", ANY_CHARACTER), owner: P2, zone: "play" }
  ]);
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(tokensOn(engine, id("ferret")), 1);
  activate(engine, P2, id("src2"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(tokensOn(engine, id("ferret")), 2);
});

clause(FERRET, "1:rule", "picked as one of several in a single pick: still one token", () => {
  const { engine, id } = ferretBoard([{ key: "src", def: pickerChar("DoublePicker", ANY_CHARACTER, { count: 2, optional: true }), owner: P2, zone: "play" }]);
  activate(engine, P2, id("src"), "pick", { selected: { t: [id("ferret")] } });
  assert.equal(marks(engine, id("ferret")), 1, "control: the Ferret was picked");
  assert.equal(tokensOn(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "not picked, no token: a pick that can't reach the Ferret, and an 'all characters' effect that doesn't pick", () => {
  const ownSide = ferretBoard([{ key: "src", def: pickerChar("OwnPicker", { type: "character", controller: "self" }), owner: P2, zone: "play" }]);
  activate(ownSide.engine, P2, ownSide.id("src"), "pick", { selected: { t: [ownSide.id("foe")] } });
  assert.equal(marks(ownSide.engine, ownSide.id("foe")), 1, "control: the pick happened");
  assert.equal(tokensOn(ownSide.engine, ownSide.id("ferret")), 0, "another card was picked");

  const sweepItem = item({
    name: "Sweeper",
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [
            {
              type: "forEach",
              selector: { type: "character", controller: "opponent" },
              effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "mark", amount: 1 }]
            }
          ]
        }
      ]
    }
  });
  const sweep = ferretBoard([{ key: "src", def: sweepItem, owner: P2, zone: "play" }]);
  activate(sweep.engine, P2, sweep.id("src"), "sweep");
  assert.equal(marks(sweep.engine, sweep.id("ferret")), 1, "control: the Ferret was affected by the sweep");
  assert.equal(tokensOn(sweep.engine, sweep.id("ferret")), 0, "affected is not picked");
});

// ----- 2:rule

const statsOf = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

clause(FERRET, "2:rule", "with no tokens it is its printed 1 strength / 1 life (speed 4)", () => {
  const { engine, id } = ferretBoard();
  assert.deepEqual(statsOf(engine, id("ferret")), [1, 1, 4]);
});

clause(FERRET, "2:rule", "+1 strength and +1 life for each token: 1, 2 and 3 tokens; speed is untouched", () => {
  for (const [tokens, expected] of [
    [1, [2, 2, 4]],
    [2, [3, 3, 4]],
    [3, [4, 4, 4]]
  ] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: { token: tokens } }]
    });
    assert.deepEqual(statsOf(engine, id("ferret")), expected, `${tokens} token(s)`);
  }
});

clause(FERRET, "2:rule", "only tokens count: other counters on it, and tokens on other cards, add nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: { mark: 4 } },
      { key: "ferret2", def: printing(FERRET), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play", counters: { token: 5 } }
    ]
  });
  assert.deepEqual(statsOf(engine, id("ferret")), [1, 1, 4], "four other counters, no tokens");
  assert.deepEqual(statsOf(engine, id("ferret2")), [3, 3, 4], "control: tokens on the card itself do count");
  assert.deepEqual([engine.getStat(id("mate"), "strength"), engine.getStat(id("mate"), "life")], [1, 3], "a plain character gains nothing from its tokens");
});

clause(FERRET, "2:rule", "the stats follow the token count as it changes (tokens added during the game)", () => {
  const tokenizer = item({
    name: "Tokenizer",
    behavior: {
      abilities: [
        {
          id: "grow",
          type: "activated",
          effects: [
            {
              type: "forEach",
              selector: { type: "character", controller: "opponent" },
              effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: 1 }]
            }
          ]
        }
      ]
    }
  });
  const { engine, id } = ferretBoard([{ key: "src", def: tokenizer, owner: P2, zone: "play" }]);
  assert.deepEqual(statsOf(engine, id("ferret")), [1, 1, 4]);
  activate(engine, P2, id("src"), "grow");
  assert.equal(tokensOn(engine, id("ferret")), 1);
  assert.deepEqual(statsOf(engine, id("ferret")), [2, 2, 4]);
  activate(engine, P2, id("src"), "grow");
  assert.deepEqual(statsOf(engine, id("ferret")), [3, 3, 4]);
  assert.deepEqual([engine.getStat(id("mate"), "strength"), engine.getStat(id("mate"), "life")], [1, 3], "control: a plain character with tokens gains nothing");
});

clause(FERRET, "2:rule", "the extra life is real: with 2 tokens (life 3) it survives 2 damage and is destroyed by the third", () => {
  const sweeper = (amount: number, name: string) =>
    item({
      name,
      behavior: {
        abilities: [
          {
            id: "sweep",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: { type: "character", controller: "opponent" },
                effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount }]
              }
            ]
          }
        ]
      }
    });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "plain", def: printing(FERRET), owner: P1, zone: "play" },
      { key: "two", def: sweeper(2, "Sweep2"), owner: P2, zone: "play" },
      { key: "one", def: sweeper(1, "Sweep1"), owner: P2, zone: "play" }
    ]
  });
  activate(engine, P2, id("two"), "sweep");
  assert.equal(zoneOf(engine, id("plain")), "discard", "control: the token-less Ferret (life 1) dies to 2 damage");
  assert.equal(zoneOf(engine, id("ferret")), "play", "life 3 survives 2 damage");
  assert.equal(engine.state.cards[id("ferret")].damage, 2);
  activate(engine, P2, id("one"), "sweep");
  assert.equal(zoneOf(engine, id("ferret")), "discard", "3 damage on life 3 destroys it");
});

clause(FERRET, "2:rule", "the extra strength is real: with 2 tokens an unblocked attack takes 3 influence, with none only 1", () => {
  for (const [tokens, lost] of [
    [0, 1],
    [2, 3]
  ] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [{ key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: { token: tokens } }]
    });
    const before = engine.state.players[P2].influence;
    fight(engine, P1, [id("ferret")], { type: "faction", playerId: P2 }, []);
    assert.equal(before - engine.state.players[P2].influence, lost, `${tokens} token(s)`);
  }
});

clause(FERRET, "2:rule", "tokens disappear when it leaves play, so it re-enters as a plain 1/1", () => {
  const revive = tactic({
    name: "Revive",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "revive",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "kill", def: killChar(), owner: P1, zone: "hand" },
      { key: "revive", def: revive, owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(statsOf(engine, id("ferret")), [3, 3, 4], "control: two tokens");
  play(engine, P1, id("kill"), { selected: { t: [id("ferret")] } });
  assert.equal(zoneOf(engine, id("ferret")), "discard", "the Ferret was destroyed");
  play(engine, P1, id("revive"), { selected: { t: [id("ferret")] } });
  assert.equal(zoneOf(engine, id("ferret")), "play", "and brought back");
  assert.equal(tokensOn(engine, id("ferret")), 0, "its tokens disappeared when it left play");
  assert.deepEqual(statsOf(engine, id("ferret")), [1, 1, 4]);
});

// ---------------------------------------------------------------------------
// Fool's Gold
// ---------------------------------------------------------------------------

const GOLD = "de8ebafc-aab1-4486-9f3a-92f53f9d6848"; // item · rogue · cost 2 · dd -- TRADE -- COST: Pick an item your opponent controls. Pay X, where X is its numeric cost. Destroy this card. -- EFFECT: Take control of the item.

/** An item with a free ability "ping" that marks itself: lets a test see who can use it. */
const gadget = (name: string, cost: number): CardDefinition =>
  item({
    name,
    cost,
    behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] }] }
  });

function goldBoard(extra: CardPlacement[] = [], resources = 5) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "gold", def: printing(GOLD), owner: P1, zone: "play" }, ...bank("rage", resources, P1), ...extra]
  });
}

const tradeFor = (engine: SpoilsEngine, id: (key: string) => string, key: string) =>
  activate(engine, P1, id("gold"), "trade", { selected: { pick: [id(key)] } });

clause(GOLD, "0:ability:trade", "picks an opponent's item, pays its numeric cost, destroys itself, and takes control of the item", () => {
  const { engine, id } = goldBoard([
    { key: "big", def: gadget("Big Gadget", 3), owner: P2, zone: "play" },
    { key: "small", def: gadget("Small Gadget", 1), owner: P2, zone: "play" }
  ]);
  const before = engine.getAvailableResourceCount(P1);
  tradeFor(engine, id, "big");
  assert.equal(pending(engine), undefined);
  assert.equal(before - engine.getAvailableResourceCount(P1), 3, "paid X = the picked item's cost (3), not the other item's");
  assert.equal(zoneOf(engine, id("gold")), "discard", "Fool's Gold destroyed itself");
  assert.equal(zoneOf(engine, id("big")), "play");
  assert.equal(engine.state.cards[id("big")].controllerId, P1, "control of the item taken");
  assert.equal(engine.state.cards[id("big")].ownerId, P2, "ownership never changes");
  assert.equal(engine.state.cards[id("small")].controllerId, P2, "only the picked item changed hands");
});

clause(GOLD, "0:ability:trade", "X is the picked item's cost for other values too: cost 1 pays 1, cost 5 pays 5, cost 0 pays nothing", () => {
  for (const cost of [0, 1, 5]) {
    const { engine, id } = goldBoard([{ key: "thing", def: gadget(`Gadget ${cost}`, cost), owner: P2, zone: "play" }], 5);
    const before = engine.getAvailableResourceCount(P1);
    tradeFor(engine, id, "thing");
    assert.equal(before - engine.getAvailableResourceCount(P1), cost, `cost ${cost}`);
    assert.equal(engine.state.cards[id("thing")].controllerId, P1, `cost ${cost}: control taken`);
    assert.equal(zoneOf(engine, id("gold")), "discard", `cost ${cost}: Fool's Gold destroyed`);
  }
});

clause(GOLD, "0:ability:trade", "cannot be used when X can't be paid: one resource short is refused and nothing happens", () => {
  const short = goldBoard([{ key: "big", def: gadget("Big Gadget", 3), owner: P2, zone: "play" }], 2);
  refused(() => tradeFor(short.engine, short.id, "big"), "pay 3 with only 2 resources", /costs cannot be paid/i);
  assert.equal(zoneOf(short.engine, short.id("gold")), "play", "Fool's Gold is still in play");
  assert.equal(short.engine.state.cards[short.id("big")].controllerId, P2, "the item stays with its controller");
  assert.equal(short.engine.getAvailableResourceCount(P1), 2, "no resource was spent");

  const exact = goldBoard([{ key: "big", def: gadget("Big Gadget", 3), owner: P2, zone: "play" }], 3);
  tradeFor(exact.engine, exact.id, "big");
  assert.equal(exact.engine.state.cards[exact.id("big")].controllerId, P1, "control: exactly 3 resources is enough");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
});

clause(GOLD, "0:ability:trade", "the pick must be an item: characters and locations of the opponent are refused", () => {
  const { engine, id } = goldBoard([
    { key: "guy", def: character({ name: "Guy", cost: 1 }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place", cost: 1 }), owner: P2, zone: "play" },
    { key: "thing", def: gadget("Gadget", 1), owner: P2, zone: "play" }
  ]);
  for (const bad of ["guy", "place"]) {
    refused(() => tradeFor(engine, id, bad), `${bad} is not an item`, /illegal target/i);
  }
  assert.equal(zoneOf(engine, id("gold")), "play", "nothing was paid or destroyed by the refusals");
  tradeFor(engine, id, "thing");
  assert.equal(engine.state.cards[id("thing")].controllerId, P1, "control: the item can be picked");
});

clause(GOLD, "0:ability:trade", "the item must be controlled by the opponent: your own items are refused; control, not ownership, decides", () => {
  const { engine, id } = goldBoard([
    { key: "mine", def: gadget("Mine", 1), owner: P1, zone: "play" },
    { key: "lent", def: gadget("Lent", 1), owner: P2, zone: "play", controller: P1 },
    { key: "stolen", def: gadget("Stolen", 2), owner: P1, zone: "play", controller: P2 }
  ]);
  refused(() => tradeFor(engine, id, "mine"), "your own item", /illegal target/i);
  refused(() => tradeFor(engine, id, "lent"), "an item the opponent owns but you control", /illegal target/i);
  refused(() => tradeFor(engine, id, "gold"), "Fool's Gold itself is your own item", /illegal target/i);
  assert.equal(zoneOf(engine, id("gold")), "play");
  tradeFor(engine, id, "stolen");
  assert.equal(engine.state.cards[id("stolen")].controllerId, P1, "control: an item you own but the opponent controls can be picked");
});

clause(GOLD, "0:ability:trade", "exactly one item must be picked: none and two are refused", () => {
  const { engine, id } = goldBoard([
    { key: "a", def: gadget("A", 1), owner: P2, zone: "play" },
    { key: "b", def: gadget("B", 1), owner: P2, zone: "play" }
  ]);
  refused(() => activate(engine, P1, id("gold"), "trade", { selected: { pick: [] } }), "no pick");
  refused(() => activate(engine, P1, id("gold"), "trade", { selected: { pick: [id("a"), id("b")] } }), "two picks");
  assert.equal(zoneOf(engine, id("gold")), "play");
  tradeFor(engine, id, "a");
  assert.equal(engine.state.cards[id("a")].controllerId, P1, "control: one pick works");
  assert.equal(engine.state.cards[id("b")].controllerId, P2);
});

clause(GOLD, "0:ability:trade", "with no opponent item in play there is nothing to pick, so it can't be used", () => {
  const { engine, id } = goldBoard([{ key: "mine", def: gadget("Mine", 1), owner: P1, zone: "play" }]);
  refused(() => activate(engine, P1, id("gold"), "trade", { selected: { pick: [] } }), "no legal pick");
  refused(() => tradeFor(engine, id, "mine"), "only your own item is in play", /illegal target/i);
  assert.equal(zoneOf(engine, id("gold")), "play");
});

clause(GOLD, "0:ability:trade", "the cost (resources paid, Fool's Gold destroyed) is paid when the ability is used, before it resolves; the control change comes with the effect", () => {
  const { engine, id } = goldBoard([{ key: "big", def: gadget("Big Gadget", 3), owner: P2, zone: "play" }]);
  const before = engine.getAvailableResourceCount(P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gold"), abilityId: "trade", selected: { pick: [id("big")] }, variables: {} });
  assert.equal(before - engine.getAvailableResourceCount(P1), 3, "resources already paid while the ability waits for responses");
  assert.equal(zoneOf(engine, id("gold")), "discard", "already destroyed");
  assert.equal(engine.state.cards[id("big")].controllerId, P2, "the effect has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("big")].controllerId, P1, "control changes when the ability resolves");
});

clause(GOLD, "0:ability:trade", "taking control is real: the new controller can use the item, the old one can't; it lasts", () => {
  const { engine, id } = goldBoard([
    { key: "big", def: gadget("Big Gadget", 2), owner: P2, zone: "play" },
    { key: "p2own", def: gadget("P2 Own", 0), owner: P2, zone: "play" }
  ]);
  const canUse = (player: string, key: string) => engine.getAvailableActivatedAbilities(player).some((a) => a.cardId === id(key) && a.ability.id === "ping");
  refused(() => activate(engine, P1, id("big"), "ping"), "before: P1 can't use the opponent's item", /controller|control|your/i);
  tradeFor(engine, id, "big");
  assert.equal(canUse(P1, "big"), true, "after: P1 can use it");
  activate(engine, P1, id("big"), "ping");
  assert.equal(marks(engine, id("big")), 1, "and does");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(canUse(P2, "p2own"), true, "control: on P2's turn P2 can use its own gadget");
  assert.equal(canUse(P2, "big"), false, "after: P2 can no longer use the item they lost");
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("big")].controllerId, P1, "still P1's a full turn later");
});

clause(GOLD, "0:ability:trade", "if the opponent destroys the picked item in response, there is nothing to take: the cost stays paid and I get nothing", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        { id: "smash", type: "activated", targets: [{ id: "t", selector: { type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
  const { engine, id } = goldBoard([
    { key: "big", def: gadget("Big Gadget", 3), owner: P2, zone: "play" },
    { key: "smash", def: smash, owner: P2, zone: "hand" }
  ]);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gold"), abilityId: "trade", selected: { pick: [id("big")] }, variables: {} });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("smash"), selected: { t: [id("big")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("big")), "discard", "control: the item was destroyed in response");
  assert.equal(engine.state.players[P2].discard.includes(id("big")), true, "it is in its owner's discard pile, not mine");
  assert.equal(engine.state.players[P1].play.includes(id("big")), false, "I did not take it");
  assert.equal(zoneOf(engine, id("gold")), "discard", "Fool's Gold was destroyed as a cost");
  assert.equal(engine.getAvailableResourceCount(P1), 2, "and the 3 resources stay paid");
});

// ---------------------------------------------------------------------------
// Forced Recruitment
// ---------------------------------------------------------------------------

const RECRUIT = "a94d37c5-7b7e-4db5-b291-73cb5ebe9042"; // tactic · rogue · cost 2 · dd -- COST: Play this only in response to a character being played. Pay X, where X is its numeric cost. -- EFFECT: The character enters play under your control.

/**
 * P2 (active) holds a cost-`charCost` character `victim` (and the resources to play it); P1 holds Forced
 * Recruitment with `deception` deception + `rage` rage resources.
 */
function recruitBoard(opts: { charCost?: number; deception?: number; rage?: number; victim?: CardDefinition; extra?: CardPlacement[] } = {}) {
  const charCost = opts.charCost ?? 3;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "recruit", def: printing(RECRUIT), owner: P1, zone: "hand" },
      { key: "victim", def: opts.victim ?? character({ name: "Victim", cost: charCost, strength: 2, life: 2 }), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 8, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("rage", 10, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 plays `victim`; its response window is left open for P1. */
const opponentPlays = (game: ReturnType<typeof recruitBoard>, key = "victim") => playRaw(game.engine, P2, game.id(key));
const respond = (game: ReturnType<typeof recruitBoard>) =>
  game.engine.perform({ type: "playCard", playerId: P1, cardId: game.id("recruit"), selected: {}, variables: {} } as never);

clause(RECRUIT, "0:ability", "in response to the opponent's character being played, the character enters play under your control", () => {
  const game = recruitBoard();
  const { engine, id } = game;
  opponentPlays(game);
  assert.equal(zoneOf(engine, id("victim")), "deploying", "control: the character is still being played");
  respond(game);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("victim")), "play", "the character entered play");
  assert.equal(engine.state.cards[id("victim")].controllerId, P1, "under my control");
  assert.equal(engine.state.cards[id("victim")].ownerId, P2, "still owned by the opponent");
  assert.equal(zoneOf(engine, id("recruit")), "discard", "the tactic is spent");
  assert.equal(engine.state.players[P2].discard.includes(id("victim")), false, "the character did not go to a discard pile");
  assert.equal(engine.state.players[P2].hand.includes(id("victim")), false, "nor back to the opponent's hand");
});

clause(RECRUIT, "0:ability", "the character is really mine: I can use its abilities, the opponent can't", () => {
  const pinger = character({
    name: "Pinger",
    cost: 3,
    behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] }] }
  });
  const game = recruitBoard({ victim: pinger });
  const { engine, id } = game;
  opponentPlays(game);
  respond(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("victim")].controllerId, P1);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.equal(engine.getAvailableActivatedAbilities(P2).some((a) => a.cardId === id("victim")), false, "the opponent can no longer use it, even on their own turn");
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  activate(engine, P1, id("victim"), "ping");
  assert.equal(marks(engine, id("victim")), 1, "I can");
});

clause(RECRUIT, "0:ability", "it enters play directly: it is never put into a discard pile on the way (a 'whenever a card is put into a discard pile' watcher sees only the spent tactic)", () => {
  const graveWatcher = item({
    name: "Grave Watcher",
    behavior: {
      abilities: [
        {
          id: "w-grave",
          type: "triggered",
          event: "cardMoved",
          condition: { type: "cardMovedToZone", zone: "discard" },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const game = recruitBoard({
    extra: [{ key: "watcher", def: graveWatcher, owner: P1, zone: "play" }, ...fillers("dA", 6, P1, "deck"), ...fillers("dB", 3, P2, "deck")]
  });
  const { engine, id } = game;
  const handBefore = engine.state.players[P1].hand.length;
  opponentPlays(game);
  respond(game);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("victim")), "play");
  assert.equal(zoneOf(engine, id("recruit")), "discard", "the spent tactic is in my discard pile");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "I played the tactic (-1) and my watcher saw exactly one card go to a discard pile, the tactic (+1)");
});

clause(RECRUIT, "0:ability", "its enters-play trigger belongs to the new controller", () => {
  const draws = character({
    name: "Dowser",
    cost: 2,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const game = recruitBoard({ victim: draws, extra: [...fillers("d1-", 3, P1, "deck"), ...fillers("d2-", 3, P2, "deck")] });
  const { engine, id } = game;
  const handsBefore = [engine.state.players[P1].hand.length, engine.state.players[P2].hand.length];
  opponentPlays(game);
  respond(game);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("victim")), "play");
  // P1 spent the tactic (-1); P2 spent the character (-1). The draw goes to whoever controls it.
  assert.equal(engine.state.players[P1].hand.length, handsBefore[0] - 1 + 1, "I (the controller) drew a card");
  assert.equal(engine.state.players[P2].hand.length, handsBefore[1] - 1, "the opponent drew nothing");
});

clause(RECRUIT, "0:ability", "cost: Pay X = the character's numeric cost, on top of the tactic's own cost 2 (cost 1 character: 3 total; cost 4 character: 6 total)", () => {
  for (const charCost of [1, 4]) {
    const game = recruitBoard({ charCost, deception: 10 });
    const { engine, id } = game;
    opponentPlays(game);
    const before = engine.getAvailableResourceCount(P1);
    respond(game);
    assert.equal(before - engine.getAvailableResourceCount(P1), 2 + charCost, `cost ${charCost}: 2 for the tactic + X=${charCost}`);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("victim")].controllerId, P1, `cost ${charCost}: it worked`);
  }
});

clause(RECRUIT, "0:ability", "cost: a free (cost 0) character makes X 0, so only the tactic's own 2 is paid", () => {
  const game = recruitBoard({ charCost: 0 });
  const { engine, id } = game;
  opponentPlays(game);
  const before = engine.getAvailableResourceCount(P1);
  respond(game);
  assert.equal(before - engine.getAvailableResourceCount(P1), 2);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("victim")].controllerId, P1);
});

clause(RECRUIT, "0:ability", "cost: X is paid when the tactic is played (before it resolves)", () => {
  const game = recruitBoard({ charCost: 3 });
  const { engine, id } = game;
  opponentPlays(game);
  const before = engine.getAvailableResourceCount(P1);
  respond(game);
  assert.equal(before - engine.getAvailableResourceCount(P1), 5, "all 5 resources are already paid while the tactic waits");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2, "the effect has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("victim")].controllerId, P1);
});

clause(RECRUIT, "0:ability", "cost: one resource short of 2 + X is refused and nothing is paid", () => {
  const short = recruitBoard({ charCost: 3, deception: 4 });
  opponentPlays(short);
  refused(() => respond(short), "4 resources for a 5 resource play", /pay|cost|resource|afford|enough/i);
  assert.equal(short.engine.getAvailableResourceCount(P1), 4, "nothing was spent");
  assert.equal(zoneOf(short.engine, short.id("recruit")), "hand", "the tactic stays in hand");
  resolvePendingResponses(short.engine);
  assert.equal(short.engine.state.cards[short.id("victim")].controllerId, P2, "the opponent's character entered under its own controller");

  const exact = recruitBoard({ charCost: 3, deception: 5 });
  opponentPlays(exact);
  respond(exact);
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.state.cards[exact.id("victim")].controllerId, P1, "control: exactly 5 is enough");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
});

clause(RECRUIT, "0:ability", "threshold dd: needs two deception icons (rage-only and a single deception are refused)", () => {
  const rageOnly = recruitBoard({ charCost: 1, deception: 0, rage: 8 });
  opponentPlays(rageOnly);
  refused(() => respond(rageOnly), "no deception icons", /threshold|icon|deception/i);

  const oneIcon = recruitBoard({ charCost: 1, deception: 1, rage: 7 });
  opponentPlays(oneIcon);
  refused(() => respond(oneIcon), "one deception icon", /threshold|icon|deception/i);

  const enough = recruitBoard({ charCost: 1, deception: 2, rage: 6 });
  opponentPlays(enough);
  respond(enough);
  resolvePendingResponses(enough.engine);
  assert.equal(enough.engine.state.cards[enough.id("victim")].controllerId, P1, "control: two deception icons is enough");
});

/** Control: the same response to a character being played works. */
const respondsToCharacter = (): void => {
  const control = recruitBoard();
  opponentPlays(control);
  respond(control);
  resolvePendingResponses(control.engine);
  assert.equal(control.engine.state.cards[control.id("victim")].controllerId, P1, "control: the response to a character works");
};

clause(RECRUIT, "0:ability", "play only in response: not on its own in my main phase, even with a character in the opponent's hand", () => {
  const game = recruitBoard();
  const { engine, id } = game;
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  refused(() => respond(game), "nothing is being played", /cannot be deployed right now/i);
  assert.equal(zoneOf(engine, id("recruit")), "hand");
});

clause(RECRUIT, "0:ability", "play only in response to a CHARACTER: an item, a location or a tactic being played can't be responded to with it", () => {
  const cases: [string, CardDefinition][] = [
    ["an item", item({ name: "Doodad", cost: 1 })],
    ["a location", location({ name: "Hovel", cost: 1 })],
    ["a tactic", tactic({ name: "Trick", cost: 1 })]
  ];
  for (const [label, def] of cases) {
    const game = recruitBoard({ victim: def });
    opponentPlays(game);
    assert.ok(game.engine.state.responseWindow, `${label} is on the stack`);
    refused(() => respond(game), `responding to ${label}`, /cannot be deployed right now/i);
    assert.equal(zoneOf(game.engine, game.id("recruit")), "hand", `${label}: the tactic stays in hand`);
  }
});

clause(RECRUIT, "0:ability", "play only in response to a card being PLAYED: an activated ability can't be responded to with it", () => {
  const pinger = character({
    name: "Pinger",
    behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] }] }
  });
  respondsToCharacter();
  const game = recruitBoard({ extra: [{ key: "pinger", def: pinger, owner: P2, zone: "play" }] });
  game.engine.perform({ type: "activateAbility", playerId: P2, cardId: game.id("pinger"), abilityId: "ping", selected: {}, variables: {} });
  assert.ok(game.engine.state.responseWindow, "the ability is on the stack");
  refused(() => respond(game), "responding to an ability", /cannot be deployed right now/i);
  assert.equal(zoneOf(game.engine, game.id("recruit")), "hand");
});

// ---------------------------------------------------------------------------
// Grand Theft All
// ---------------------------------------------------------------------------

const GTA = "799e4e63-e1ab-4f7e-bd5c-f5534b770686"; // tactic · rogue · cost 10 · dddd -- Put up to 4 non-tactic cards in your opponent's discard pile into play under your control.

/**
 * P1 holds Grand Theft All with `deception` deception + `rage` rage resources. P2's discard pile holds three
 * characters, an item, a location, a resource and a tactic; P1's discard pile, and P2's hand / deck / play zones,
 * each hold a card that must NOT be takeable.
 */
function gtaBoard(opts: { deception?: number; rage?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gta", def: printing(GTA), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      { key: "ch1", def: character({ name: "Dead One", strength: 2, life: 2 }), owner: P2, zone: "discard" },
      { key: "ch2", def: character({ name: "Dead Two", strength: 3, life: 3 }), owner: P2, zone: "discard" },
      { key: "ch3", def: character({ name: "Dead Three", strength: 1, life: 1 }), owner: P2, zone: "discard" },
      { key: "it", def: item({ name: "Dead Item" }), owner: P2, zone: "discard" },
      { key: "loc", def: location({ name: "Dead Place" }), owner: P2, zone: "discard" },
      { key: "res", def: resourceCard({ name: "Dead Resource" }), owner: P2, zone: "discard" },
      { key: "trick", def: tactic({ name: "Dead Trick" }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "My Dead" }), owner: P1, zone: "discard" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
      { key: "indeck", def: character({ name: "In Deck" }), owner: P2, zone: "deck" },
      { key: "inplay", def: character({ name: "In Play" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays Grand Theft All; returns the pending "choose up to 4" prompt's kind. */
const castGta = (game: ReturnType<typeof gtaBoard>) => {
  play(game.engine, P1, game.id("gta"));
  return pending(game.engine);
};

const submitPick = (game: ReturnType<typeof gtaBoard>, keys: string[]) =>
  game.engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => game.id(key)) }
  } as never);

const stolen = (game: ReturnType<typeof gtaBoard>, key: string) =>
  zoneOf(game.engine, game.id(key)) === "play" && game.engine.state.cards[game.id(key)].controllerId === P1;

clause(GTA, "0:rule", "puts 4 chosen non-tactic cards from the opponent's discard pile into play under my control, and leaves the rest", () => {
  const game = gtaBoard();
  const { engine, id } = game;
  assert.equal(castGta(game)?.kind, "chooserSelectsTarget", "I choose which cards");
  submitPick(game, ["ch2", "it", "loc", "ch1"]);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  for (const key of ["ch1", "ch2", "it", "loc"]) {
    assert.equal(zoneOf(engine, id(key)), "play", `${key} entered play`);
    assert.equal(engine.state.cards[id(key)].controllerId, P1, `${key} is under my control`);
    assert.equal(engine.state.cards[id(key)].ownerId, P2, `${key} is still owned by the opponent`);
  }
  for (const key of ["ch3", "res", "trick"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} was not chosen so it stays in the discard pile`);
  assert.equal(zoneOf(engine, id("mine")), "discard", "my own discard pile is untouched");
  assert.equal(zoneOf(engine, id("gta")), "discard", "the tactic is spent");
});

clause(GTA, "0:rule", "up to 4: 3, 1 and 0 cards also work (taking none is allowed)", () => {
  for (const picks of [["ch1", "ch2", "it"], ["loc"], []]) {
    const game = gtaBoard();
    castGta(game);
    submitPick(game, picks);
    resolvePendingResponses(game.engine);
    assert.equal(pending(game.engine), undefined, `${picks.length} picked`);
    for (const key of ["ch1", "ch2", "ch3", "it", "loc", "res"]) {
      assert.equal(stolen(game, key), picks.includes(key), `${picks.length} picked: ${key}`);
    }
    assert.equal(zoneOf(game.engine, game.id("gta")), "discard", `${picks.length} picked: the tactic resolved`);
  }
});

clause(GTA, "0:rule", "more than 4 is refused: 5 cards can't be taken", () => {
  const game = gtaBoard();
  castGta(game);
  refused(() => submitPick(game, ["ch1", "ch2", "ch3", "it", "loc"]), "5 cards", /select|pick|many|count|illegal/i);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  submitPick(game, ["ch1", "ch2", "ch3", "it"]);
  resolvePendingResponses(game.engine);
  assert.deepEqual(["ch1", "ch2", "ch3", "it"].map((key) => stolen(game, key)), [true, true, true, true], "control: 4 is fine");
  assert.equal(stolen(game, "loc"), false);
});

clause(GTA, "0:rule", "non-tactic: a tactic in the opponent's discard pile can't be taken", () => {
  const game = gtaBoard();
  castGta(game);
  refused(() => submitPick(game, ["trick"]), "a tactic", /select|pick|illegal|target|candidate/i);
  refused(() => submitPick(game, ["ch1", "trick"]), "a tactic among legal cards", /select|pick|illegal|target|candidate/i);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  submitPick(game, ["ch1"]);
  resolvePendingResponses(game.engine);
  assert.equal(stolen(game, "ch1"), true, "control: a non-tactic works");
  assert.equal(zoneOf(game.engine, game.id("trick")), "discard");
});

clause(GTA, "0:rule", "non-tactic includes every other type: characters, items, locations and resource cards can all be taken", () => {
  const game = gtaBoard();
  castGta(game);
  submitPick(game, ["ch3", "it", "loc", "res"]);
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine), undefined);
  for (const key of ["ch3", "it", "loc", "res"]) assert.equal(stolen(game, key), true, `${key} was taken`);
});

clause(GTA, "0:rule", "only the opponent's discard pile: my own discard pile, and the opponent's hand, deck and play zone, are not choosable", () => {
  const game = gtaBoard();
  castGta(game);
  for (const key of ["mine", "inhand", "indeck", "inplay", "gta"]) {
    refused(() => submitPick(game, [key]), `${key} is not in the opponent's discard pile`, /select|pick|illegal|target|candidate/i);
  }
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  submitPick(game, ["ch1"]);
  resolvePendingResponses(game.engine);
  assert.equal(stolen(game, "ch1"), true, "control: a card from the opponent's discard pile");
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("inhand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("indeck")), "deck");
});

clause(GTA, "0:rule", "the taken cards' own enters-play triggers belong to me", () => {
  const dowser = character({
    name: "Dead Dowser",
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const game = gtaBoard({
    extra: [{ key: "dowser", def: dowser, owner: P2, zone: "discard" }, ...fillers("d1-", 3, P1, "deck"), ...fillers("d2-", 3, P2, "deck")]
  });
  const mineBefore = game.engine.state.players[P1].hand.length;
  const theirsBefore = game.engine.state.players[P2].hand.length;
  castGta(game);
  submitPick(game, ["dowser"]);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(stolen(game, "dowser"), true);
  assert.equal(game.engine.state.players[P1].hand.length, mineBefore - 1 + 1, "I drew (the tactic left my hand)");
  assert.equal(game.engine.state.players[P2].hand.length, theirsBefore, "the opponent drew nothing");
});

clause(GTA, "0:rule", "an ATTACH TO card taken from the discard pile still gets a host (CR 507.2b)", () => {
  const booster = item({
    name: "Dead Booster",
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const game = gtaBoard({ extra: [{ key: "gear", def: booster, owner: P2, zone: "discard" }, { key: "host", def: character({ name: "Host", strength: 1 }), owner: P1, zone: "play" }] });
  castGta(game);
  submitPick(game, ["gear"]);
  resolvePendingResponses(game.engine);
  drain(game.engine, (pc) => {
    // whatever the host choice looks like, take my own character
    if (pc.kind === "selectTargets" || pc.kind === "chooserSelectsTarget" || pc.kind === "selectDeployTargets") {
      const declarations = (pc.declarations as { id: string }[] | undefined) ?? [{ id: "t" }];
      const selected: Record<string, string[]> = {};
      for (const d of declarations) selected[d.id] = [game.id("host")];
      return pc.kind === "chooserSelectsTarget" ? { kind: pc.kind, selected: [game.id("host")] } : { kind: pc.kind, selected };
    }
    return declineAll(pc);
  });
  assert.equal(pending(game.engine), undefined);
  assert.equal(stolen(game, "gear"), true, "the gear entered play under my control");
  assert.equal(game.engine.state.cards[game.id("gear")].attachedTo, game.id("host"), "attached to the character I picked");
  assert.equal(game.engine.getStat(game.id("host"), "strength"), 3, "and it works: 1 + 2");
});

clause(GTA, "0:rule", "cost 10: nine resources is refused; exactly ten is enough", () => {
  const short = gtaBoard({ deception: 9 });
  refused(() => play(short.engine, P1, short.id("gta")), "9 resources for a cost 10 tactic", /cannot be deployed|pay|cost|resource|afford/i);
  assert.equal(zoneOf(short.engine, short.id("gta")), "hand");
  assert.equal(short.engine.getAvailableResourceCount(P1), 9);

  const exact = gtaBoard({ deception: 10 });
  const before = exact.engine.getAvailableResourceCount(P1);
  castGta(exact);
  assert.equal(before - exact.engine.getAvailableResourceCount(P1), 10, "control: ten resources are paid");
});

clause(GTA, "0:rule", "threshold dddd: four deception icons are needed (three plus rage is refused, four works)", () => {
  const three = gtaBoard({ deception: 3, rage: 7 });
  refused(() => play(three.engine, P1, three.id("gta")), "three deception icons", /cannot be deployed|threshold|icon|deception/i);
  assert.equal(zoneOf(three.engine, three.id("gta")), "hand");

  const four = gtaBoard({ deception: 4, rage: 6 });
  castGta(four);
  submitPick(four, ["ch1"]);
  resolvePendingResponses(four.engine);
  assert.equal(stolen(four, "ch1"), true, "control: four deception icons and six rage cast it");
});

// ---------------------------------------------------------------------------
// Hangdog Alley
// ---------------------------------------------------------------------------

const ALLEY = "71fe683e-2924-4acc-91fa-2fca471e2d28"; // location · rogue · cost 3 · d · structure 2 -- If an attacking party is formed, it must have only 1 member.

const otherPlayer = (player: string): string => (player === P1 ? P2 : P1);

/** `attacker` is active with three characters a1-a3; the defender has d1-d2 and a location `base`. `alleyOwner` says who (if anyone) controls Hangdog Alley. */
function alleyBoard(opts: { alleyOwner?: string; attacker?: string; alleyFaceDown?: boolean; alleyCount?: number } = {}) {
  const attacker = opts.attacker ?? P1;
  const defender = otherPlayer(attacker);
  const alleys: CardPlacement[] = opts.alleyOwner
    ? Array.from({ length: opts.alleyCount ?? 1 }, (_, i) => ({ key: `alley${i}`, def: printing(ALLEY), owner: opts.alleyOwner as string, zone: "play" as const, faceDown: opts.alleyFaceDown }))
    : [];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "a1", def: character({ name: "A1" }), owner: attacker, zone: "play" },
      { key: "a2", def: character({ name: "A2" }), owner: attacker, zone: "play" },
      { key: "a3", def: character({ name: "A3" }), owner: attacker, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: defender, zone: "play" },
      { key: "d2", def: character({ name: "D2" }), owner: defender, zone: "play" },
      { key: "base", def: location({ name: "Base" }), owner: defender, zone: "play" },
      ...alleys
    ]
  });
}

const attackWith = (game: ReturnType<typeof alleyBoard>, attacker: string, keys: string[], target?: { type: "card"; cardId: string }) =>
  declareAttackBy(game.engine, attacker, keys.map((key) => game.id(key)), target);

clause(ALLEY, "0:rule", "with Hangdog Alley in play an attacking party of 2 or 3 is refused, and nothing is declared", () => {
  const one = alleyBoard({ alleyOwner: P1 });
  attackWith(one, P1, ["a1"]);
  assert.deepEqual(battleOf(one.engine)?.attackingParty, [one.id("a1")], "control: a lone attacker is a legal party");

  const two = alleyBoard({ alleyOwner: P1 });
  refused(() => attackWith(two, P1, ["a1", "a2"]), "a party of 2", /at most 1 member/i);
  assert.equal(battleOf(two.engine), undefined, "no battle started");
  const three = alleyBoard({ alleyOwner: P1 });
  refused(() => attackWith(three, P1, ["a1", "a2", "a3"]), "a party of 3", /at most 1 member/i);
  assert.equal(battleOf(three.engine), undefined);
  assert.equal(three.engine.state.cards[three.id("a1")].depleted, false, "the refused attackers were not depleted");
});

clause(ALLEY, "0:rule", "without Hangdog Alley the same party of 2 or 3 is allowed (control)", () => {
  const two = alleyBoard();
  attackWith(two, P1, ["a1", "a2"]);
  assert.deepEqual(battleOf(two.engine)?.attackingParty, [two.id("a1"), two.id("a2")]);
  const three = alleyBoard();
  attackWith(three, P1, ["a1", "a2", "a3"]);
  assert.equal(battleOf(three.engine)?.attackingParty.length, 3);
});

clause(ALLEY, "0:rule", "it applies to every player's attacking parties: the opponent's Alley limits me, and mine limits the opponent", () => {
  for (const attacker of [P1, P2]) {
    for (const alleyOwner of [P1, P2]) {
      const game = alleyBoard({ alleyOwner, attacker });
      refused(() => attackWith(game, attacker, ["a1", "a2"]), `${attacker} attacks with 2 under ${alleyOwner}'s Alley`, /at most 1 member/i);
      assert.equal(battleOf(game.engine), undefined);
      attackWith(game, attacker, ["a1"]);
      assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("a1")], `${attacker} attacks alone under ${alleyOwner}'s Alley`);
    }
  }
});

clause(ALLEY, "0:rule", "it limits attacks on a location the same as attacks on a faction", () => {
  const game = alleyBoard({ alleyOwner: P2 });
  const target = { type: "card" as const, cardId: game.id("base") };
  refused(() => attackWith(game, P1, ["a1", "a2"], target), "2 attackers against a location", /at most 1 member/i);
  attackWith(game, P1, ["a2"], target);
  assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("a2")], "control: one attacker against the location");
});

clause(ALLEY, "0:rule", "only ATTACKING parties are limited: a blocking party can have several members", () => {
  const game = alleyBoard({ alleyOwner: P1 });
  attackWith(game, P1, ["a1"]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("d1"), game.id("d2")] });
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("d1"), game.id("d2")], "two blockers block the lone attacker");
});

clause(ALLEY, "0:rule", "two Alleys: still 1 member", () => {
  const game = alleyBoard({ alleyOwner: P1, alleyCount: 2 });
  refused(() => attackWith(game, P1, ["a1", "a2"]), "2 attackers under two Alleys", /at most 1 member/i);
  attackWith(game, P1, ["a3"]);
  assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("a3")]);
});

clause(ALLEY, "0:rule", "the limit is a static rule: gone when the Alley is face-down (no abilities) or after it leaves play", () => {
  const faceDown = alleyBoard({ alleyOwner: P1, alleyFaceDown: true });
  attackWith(faceDown, P1, ["a1", "a2"]);
  assert.equal(battleOf(faceDown.engine)?.attackingParty.length, 2, "a face-down Alley limits nothing");

  const game = alleyBoard({ alleyOwner: P1 });
  refused(() => attackWith(game, P1, ["a1", "a2"]), "control: limited while in play", /at most 1 member/i);
  moveCard(game.engine, game.id("alley0"), "discard");
  assert.equal(zoneOf(game.engine, game.id("alley0")), "discard");
  attackWith(game, P1, ["a1", "a2"]);
  assert.equal(battleOf(game.engine)?.attackingParty.length, 2, "once the Alley has left play, parties of 2 are allowed again");
});

// ---------------------------------------------------------------------------
// Heist Planner
// ---------------------------------------------------------------------------

const PLANNER = "65ebb568-f0c8-4bd4-a75a-209ff0c36a7e"; // character · rogue · thief · cost 3 · dd · 2/3/1 -- When this card enters play, you may search your opponent's deck for up to 3 cards with different names and reveal them. If you do, put them into your opponent's discard pile.

const DECK_NAMES = ["Alpha", "Beta", "Gamma", "Alpha", "Delta", "Epsilon"]; // o0..o5: o0 and o3 share a name

/** A seeded RNG (so the shuffle is deterministic but not the identity). */
const seededRandom = (seed: number) => {
  let x = seed;
  return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
};

/** P1 holds the Planner and 3 resources (2 deception); P2's deck is o0..o5 above, with a card in hand, discard and play; P1 has a deck of its own. */
function plannerBoard(opts: { deception?: number; rage?: number; extra?: CardPlacement[]; plannerZone?: "hand" | "play" | "discard" } = {}) {
  return buildGame({
    random: seededRandom(12345),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "hp", def: printing(PLANNER), owner: P1, zone: opts.plannerZone ?? "hand" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...DECK_NAMES.map((name, i): CardPlacement => ({ key: `o${i}`, def: character({ name }), owner: P2, zone: "deck" })),
      { key: "oHand", def: character({ name: "Opp Hand" }), owner: P2, zone: "hand" },
      { key: "oDead", def: character({ name: "Opp Dead" }), owner: P2, zone: "discard" },
      ...fillers("m", 4, P1, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

const searchPick = (game: ReturnType<typeof plannerBoard>, keys: string[]) =>
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => game.id(key)) } } as never);

/** Deploys the Planner and returns once the search prompt is open. */
const deployPlanner = (game: ReturnType<typeof plannerBoard>) => {
  play(game.engine, P1, game.id("hp"));
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search prompt is open");
  assert.equal(pending(game.engine)?.playerId, P1, "its controller searches");
};

const finishSearch = (game: ReturnType<typeof plannerBoard>, keys: string[]) => {
  deployPlanner(game);
  searchPick(game, keys);
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine), undefined);
};

clause(PLANNER, "0:rule", "when it enters play I search the opponent's deck for up to 3 different-name cards, and they go to the OPPONENT's discard pile", () => {
  const game = plannerBoard();
  const { engine, id } = game;
  const oppDeckBefore = engine.state.players[P2].deck.length;
  finishSearch(game, ["o0", "o1", "o2"]);
  for (const key of ["o0", "o1", "o2"]) {
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} was put into a discard pile`);
    assert.equal(engine.state.players[P2].discard.includes(id(key)), true, `${key} is in the opponent's discard pile`);
    assert.equal(engine.state.players[P1].discard.includes(id(key)), false, `${key} is not in mine`);
  }
  assert.equal(engine.state.players[P2].deck.length, oppDeckBefore - 3, "exactly three left the deck");
  for (const key of ["o3", "o4", "o5"]) assert.equal(zoneOf(engine, id(key)), "deck", `${key} stays in the deck`);
  assert.equal(zoneOf(engine, id("oDead")), "discard", "the opponent's earlier discard is still there");
  assert.equal(engine.state.players[P2].discard.length, 4);
  assert.equal(zoneOf(engine, id("hp")), "play", "the Planner stays in play");
  assert.equal(engine.state.players[P1].deck.length, 4, "my own deck is untouched");
});

clause(PLANNER, "0:rule", "up to 3: 2, 1 and 0 cards also work; with none nothing changes zone", () => {
  for (const picks of [["o4", "o1"], ["o2"], []]) {
    const game = plannerBoard();
    finishSearch(game, picks);
    for (let i = 0; i < DECK_NAMES.length; i++) {
      assert.equal(zoneOf(game.engine, game.id(`o${i}`)), picks.includes(`o${i}`) ? "discard" : "deck", `${picks.length} picked: o${i}`);
    }
    assert.equal(game.engine.state.players[P2].discard.length, 1 + picks.length, `${picks.length} picked: discard size`);
    assert.equal(zoneOf(game.engine, game.id("hp")), "play");
  }
});

clause(PLANNER, "0:rule", "more than 3 is refused: four different-name cards can't be taken", () => {
  const game = plannerBoard();
  deployPlanner(game);
  refused(() => searchPick(game, ["o0", "o1", "o2", "o4"]), "4 cards", /select|pick|many|count|illegal|name/i);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still open");
  assert.equal(game.engine.state.players[P2].deck.length, DECK_NAMES.length, "nothing moved");
});

clause(PLANNER, "0:rule", "different names: two cards sharing a name are refused; two different names are fine", () => {
  const game = plannerBoard();
  deployPlanner(game);
  refused(() => searchPick(game, ["o0", "o3"]), "Alpha twice", /name|different|distinct/i);
  refused(() => searchPick(game, ["o0", "o3", "o1"]), "Alpha twice plus one more", /name|different|distinct/i);
  assert.equal(game.engine.state.players[P2].deck.length, DECK_NAMES.length, "nothing moved");
  searchPick(game, ["o3", "o1"]);
  resolvePendingResponses(game.engine);
  assert.deepEqual(["o3", "o1"].map((key) => zoneOf(game.engine, game.id(key))), ["discard", "discard"], "control: two different names work (the second Alpha)");
  assert.equal(zoneOf(game.engine, game.id("o0")), "deck", "the other Alpha stays");
});

clause(PLANNER, "0:rule", "only the opponent's deck is searched: my deck, their hand, discard pile and play zone are not choosable", () => {
  const game = plannerBoard({ extra: [{ key: "oPlay", def: character({ name: "Opp Play" }), owner: P2, zone: "play" }] });
  deployPlanner(game);
  for (const key of ["m0", "oHand", "oDead", "oPlay", "hp"]) {
    refused(() => searchPick(game, [key]), `${key} is not in the opponent's deck`, /select|pick|illegal|target|candidate/i);
  }
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  searchPick(game, ["o5"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("o5")), "discard", "control: a card from their deck");
  assert.equal(zoneOf(game.engine, game.id("m0")), "deck");
  assert.equal(zoneOf(game.engine, game.id("oHand")), "hand");
});

clause(PLANNER, "0:rule", "the found cards are revealed", () => {
  const game = plannerBoard();
  finishSearch(game, ["o1", "o4"]);
  const revealed = (game.engine.state.gameLog ?? [])
    .map((entry) => entry.event as { type: string; cardIds?: string[]; zone?: string; ownerId?: string } | undefined)
    .filter((event) => event?.type === "cardsRevealed");
  assert.equal(revealed.length, 1, "one reveal");
  assert.deepEqual([...(revealed[0]?.cardIds ?? [])].sort(), [game.id("o1"), game.id("o4")].sort(), "exactly the found cards");
  assert.equal(revealed[0]?.zone, "deck");
  assert.equal(revealed[0]?.ownerId, P2, "from the opponent's deck");
});

clause(PLANNER, "0:rule", "the searched deck is shuffled afterwards (CR 312.1); mine is not", () => {
  const game = plannerBoard();
  const oppBefore = [...game.engine.state.players[P2].deck];
  const mineBefore = [...game.engine.state.players[P1].deck];
  finishSearch(game, ["o0"]);
  const oppAfter = game.engine.state.players[P2].deck;
  const remaining = oppBefore.filter((cardId) => cardId !== game.id("o0"));
  assert.deepEqual([...oppAfter].sort(), [...remaining].sort(), "same cards remain");
  assert.notDeepEqual(oppAfter, remaining, "in a different order: the deck was shuffled");
  assert.deepEqual(game.engine.state.players[P1].deck, mineBefore, "my own deck was not shuffled");
});

clause(PLANNER, "0:rule", "it triggers on ITS entering play only: another card entering play while it is in play asks nothing", () => {
  const other = character({ name: "Other", cost: 0 });
  const game = plannerBoard({ plannerZone: "play", extra: [{ key: "other", def: other, owner: P1, zone: "hand" }] });
  assert.equal(pending(game.engine), undefined, "control: the Planner already in play searched nothing");
  play(game.engine, P1, game.id("other"));
  assert.equal(zoneOf(game.engine, game.id("other")), "play", "the other character entered play");
  assert.equal(pending(game.engine), undefined, "no search");
  assert.equal(game.engine.state.players[P2].deck.length, DECK_NAMES.length);
});

clause(PLANNER, "0:rule", "it also triggers when put into play by an effect rather than deployed", () => {
  const revive = tactic({
    name: "Revive",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "revive",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = plannerBoard({ plannerZone: "discard", extra: [{ key: "revive", def: revive, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("revive"), { selected: { t: [game.id("hp")] } });
  assert.equal(zoneOf(game.engine, game.id("hp")), "play");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search prompt opens");
  searchPick(game, ["o2"]);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("o2")), "discard");
});

clause(PLANNER, "0:rule", "printed body: deploys for 3 with two deception icons (2 resources is refused, no deception is refused); 2 strength / 3 speed / 1 life", () => {
  const short = plannerBoard({ deception: 2 });
  refused(() => play(short.engine, P1, short.id("hp")), "2 resources for cost 3", /cannot be deployed|pay|cost|resource|afford/i);
  assert.equal(zoneOf(short.engine, short.id("hp")), "hand");

  const noIcons = plannerBoard({ deception: 0, rage: 3 });
  refused(() => play(noIcons.engine, P1, noIcons.id("hp")), "no deception icons", /cannot be deployed|threshold|icon|deception/i);

  const oneIcon = plannerBoard({ deception: 1, rage: 2 });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("hp")), "one deception icon", /cannot be deployed|threshold|icon|deception/i);

  const ok = plannerBoard({ deception: 2, rage: 1 });
  const before = ok.engine.getAvailableResourceCount(P1);
  deployPlanner(ok);
  assert.equal(before - ok.engine.getAvailableResourceCount(P1), 3, "control: cost 3 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("hp"), "strength"), ok.engine.getStat(ok.id("hp"), "speed"), ok.engine.getStat(ok.id("hp"), "life")], [2, 3, 1]);
});

clause(PLANNER, "0:rule", "'your opponent's deck' follows the controller: a Planner put into play under the opponent's control searches MY deck", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "opponent" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = plannerBoard({ plannerZone: "discard", extra: [{ key: "steal", def: steal, owner: P2, zone: "hand" }] });
  game.engine.state.activePlayerId = P2;
  game.engine.state.priorityPlayerId = P2;
  play(game.engine, P2, game.id("steal"), { selected: { t: [game.id("hp")] } });
  assert.equal(game.engine.state.cards[game.id("hp")].controllerId, P2, "the opponent controls the Planner");
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "its new controller searches");
  game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("m0")] } } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("m0")), "discard", "a card from MY deck went to MY discard pile");
  assert.equal(game.engine.state.players[P1].discard.includes(game.id("m0")), true);
  assert.equal(zoneOf(game.engine, game.id("o0")), "deck", "their own deck was not searched");
});

// ---------------------------------------------------------------------------
// Hyperphagic Sarcophyle
// ---------------------------------------------------------------------------

const SARC = "150a4771-301e-4b9d-909b-c2f733100288"; // character · rogue · sarcophyle · cost 3 · dd · 2/2/2 -- If this card inflicts damage to a faction, you may put a token on it. -- This card gains 1 strength and 1 life for each token on it.

/** Answers the Sarcophyle's "may put a token" prompt (accepting or declining), counting how often it was asked. */
function tokenAnswers(accept: boolean) {
  const asked = { count: 0 };
  const answer = (pc: { kind: string; [key: string]: unknown }): unknown => {
    if (pc.kind === "chooserSelectsOption") {
      asked.count++;
      const options = (pc.options as { label: string }[]) ?? [];
      const index = options.findIndex((option) => (accept ? /token/i : /decline/i).test(option.label));
      return { kind: "chooserSelectsOption", index: index < 0 ? 0 : index };
    }
    return declineAll(pc);
  };
  return { asked, answer };
}

/** P1 (active) has Sarcophyle `sarc` (with `tokens` tokens); P2 has a sturdy blocker `wall` and a location `base`. */
function sarcBoard(opts: { tokens?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sarc", def: printing(SARC), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : {} },
      { key: "wall", def: character({ name: "Wall", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "base", def: location({ name: "Base", structure: 9 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const influenceOf = (engine: SpoilsEngine, player: string): number => engine.state.players[player].influence;
const attackFaction = (game: ReturnType<typeof sarcBoard>, attackers: string[], blockers: string[], answer: (pc: { kind: string; [key: string]: unknown }) => unknown) =>
  fightThrough(game.engine, P1, attackers.map((key) => game.id(key)), { type: "faction", playerId: P2 }, blockers.map((key) => game.id(key)), undefined, answer as never);

clause(SARC, "0:rule", "inflicting damage to a faction: I may put a token on it (accepted)", () => {
  const game = sarcBoard();
  const { asked, answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 2, "control: it hit the faction for its 2 strength");
  assert.equal(asked.count, 1, "asked once");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 1, "one token");
});

clause(SARC, "0:rule", "may: declining puts no token on it", () => {
  const game = sarcBoard();
  const { asked, answer } = tokenAnswers(false);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 2, "control: it hit the faction");
  assert.equal(asked.count, 1, "asked once");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 0, "declined: no token");
});

clause(SARC, "0:rule", "tokens add up: with 1 token it hits for 3 and ends with 2", () => {
  const game = sarcBoard({ tokens: 1 });
  const { answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 3);
  assert.equal(tokensOn(game.engine, game.id("sarc")), 2);
});

clause(SARC, "0:rule", "damage to a CHARACTER (blocked) is not damage to a faction: no prompt, no token", () => {
  const game = sarcBoard();
  const { asked, answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], ["wall"], answer);
  assert.equal(game.engine.state.cards[game.id("wall")].damage, 2, "control: it damaged the blocker");
  assert.equal(influenceOf(game.engine, P2), before, "the faction took nothing");
  assert.equal(asked.count, 0, "no prompt");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 0);
});

clause(SARC, "0:rule", "damage to a LOCATION is not damage to a faction: no prompt, no token", () => {
  const game = sarcBoard();
  const { asked, answer } = tokenAnswers(true);
  fightThrough(game.engine, P1, [game.id("sarc")], { type: "card", cardId: game.id("base") }, [], undefined, answer as never);
  assert.equal(game.engine.state.cards[game.id("base")].damage, 2, "control: it damaged the location");
  assert.equal(asked.count, 0, "no prompt");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 0);
});

clause(SARC, "0:rule", "it must be THIS card that inflicts it: another character's damage to a faction gives nothing", () => {
  const ally = character({ name: "Ally", strength: 1, life: 3 });
  const game = sarcBoard({ extra: [{ key: "ally", def: ally, owner: P1, zone: "play" }] });
  const { asked, answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["ally"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 1, "control: the ally hit the faction while the Sarcophyle stayed home");
  assert.equal(asked.count, 0, "no prompt");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 0);
});

clause(SARC, "0:rule", "attacking in a party: it still gets its own prompt and its own token, once", () => {
  const ally = character({ name: "Ally", strength: 1, life: 3 });
  const game = sarcBoard({ extra: [{ key: "ally", def: ally, owner: P1, zone: "play" }] });
  const { asked, answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc", "ally"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 3, "control: both hit the faction (2 + 1)");
  assert.equal(asked.count, 1, "asked once, for the Sarcophyle only");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 1);
});

clause(SARC, "0:rule", "two Sarcophyles each get their own token", () => {
  const game = sarcBoard({ extra: [{ key: "sarc2", def: printing(SARC), owner: P1, zone: "play" }] });
  const { asked, answer } = tokenAnswers(true);
  attackFaction(game, ["sarc", "sarc2"], [], answer);
  assert.equal(asked.count, 2, "each is asked");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 1);
  assert.equal(tokensOn(game.engine, game.id("sarc2")), 1);
});

clause(SARC, "0:rule", "0 damage is no damage (CR 408.1a): with its strength reduced to 0 it inflicts nothing, so there is no prompt", () => {
  const dampener = location({
    name: "Dampener",
    behavior: { abilities: [{ id: "damp", type: "continuous", modifiers: [{ selector: { type: "character", controller: "opponent" }, stat: "strength", operation: "add", value: -2 }] }] }
  });
  const game = sarcBoard({ extra: [{ key: "damp", def: dampener, owner: P2, zone: "play" }] });
  assert.equal(game.engine.getStat(game.id("sarc"), "strength"), 0, "control: strength is 0");
  const { asked, answer } = tokenAnswers(true);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(influenceOf(game.engine, P2), before, "no damage was inflicted");
  assert.equal(asked.count, 0, "no prompt");
  assert.equal(tokensOn(game.engine, game.id("sarc")), 0);
});

// ----- 1:rule

const sarcStats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

clause(SARC, "1:rule", "no tokens: printed 2 strength / 2 life (speed 2); each token adds 1 strength and 1 life (1, 2, 3 tokens), speed untouched", () => {
  for (const [tokens, expected] of [
    [0, [2, 2, 2]],
    [1, [3, 3, 2]],
    [2, [4, 4, 2]],
    [3, [5, 5, 2]]
  ] as const) {
    const game = sarcBoard({ tokens });
    assert.deepEqual(sarcStats(game.engine, game.id("sarc")), expected, `${tokens} token(s)`);
  }
});

clause(SARC, "1:rule", "only its own tokens count: other counters on it and tokens on other cards add nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sarc", def: printing(SARC), owner: P1, zone: "play", counters: { mark: 4 } },
      { key: "sarc2", def: printing(SARC), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play", counters: { token: 5 } }
    ]
  });
  assert.deepEqual(sarcStats(engine, id("sarc")), [2, 2, 2], "four other counters, no tokens");
  assert.deepEqual(sarcStats(engine, id("sarc2")), [4, 4, 2], "control: tokens on the card itself do count");
  assert.deepEqual([engine.getStat(id("mate"), "strength"), engine.getStat(id("mate"), "life")], [1, 3], "a plain character gains nothing from its tokens");
});

clause(SARC, "1:rule", "the stats follow the token count as it changes in play (a hit grows it, and the next hit hits harder)", () => {
  const game = sarcBoard();
  const { answer } = tokenAnswers(true);
  attackFaction(game, ["sarc"], [], answer);
  assert.deepEqual(sarcStats(game.engine, game.id("sarc")), [3, 3, 2], "after the first hit");
  game.engine.state.cards[game.id("sarc")].depleted = false;
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 3, "the second hit uses the grown strength");
  assert.deepEqual(sarcStats(game.engine, game.id("sarc")), [4, 4, 2], "after the second hit");
});

clause(SARC, "1:rule", "the extra life is real: with 2 tokens (life 4) it survives 3 damage and is destroyed by the fourth", () => {
  const sweeper = (amount: number, name: string) =>
    item({
      name,
      behavior: {
        abilities: [
          {
            id: "sweep",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: { type: "character", controller: "opponent" },
                effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount }]
              }
            ]
          }
        ]
      }
    });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sarc", def: printing(SARC), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "plain", def: printing(SARC), owner: P1, zone: "play" },
      { key: "three", def: sweeper(3, "Sweep3"), owner: P2, zone: "play" },
      { key: "one", def: sweeper(1, "Sweep1"), owner: P2, zone: "play" }
    ]
  });
  activate(engine, P2, id("three"), "sweep");
  assert.equal(zoneOf(engine, id("plain")), "discard", "control: the token-less Sarcophyle (life 2) dies to 3 damage");
  assert.equal(zoneOf(engine, id("sarc")), "play", "life 4 survives 3 damage");
  assert.equal(engine.state.cards[id("sarc")].damage, 3);
  activate(engine, P2, id("one"), "sweep");
  assert.equal(zoneOf(engine, id("sarc")), "discard", "4 damage on life 4 destroys it");
});

clause(SARC, "1:rule", "the extra strength is real: with 2 tokens an unblocked attack takes 4 influence", () => {
  const game = sarcBoard({ tokens: 2 });
  const { answer } = tokenAnswers(false);
  const before = influenceOf(game.engine, P2);
  attackFaction(game, ["sarc"], [], answer);
  assert.equal(before - influenceOf(game.engine, P2), 4);
});

clause(SARC, "1:rule", "its tokens disappear when it leaves play, so it re-enters as a plain 2/2", () => {
  const revive = tactic({
    name: "Revive",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "revive",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = sarcBoard({ tokens: 2, extra: [{ key: "kill", def: killChar(), owner: P1, zone: "hand" }, { key: "revive", def: revive, owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  assert.deepEqual(sarcStats(engine, id("sarc")), [4, 4, 2], "control: two tokens");
  play(engine, P1, id("kill"), { selected: { t: [id("sarc")] } });
  assert.equal(zoneOf(engine, id("sarc")), "discard", "destroyed");
  play(engine, P1, id("revive"), { selected: { t: [id("sarc")] } });
  assert.equal(zoneOf(engine, id("sarc")), "play", "brought back");
  assert.equal(tokensOn(engine, id("sarc")), 0, "its tokens disappeared when it left play");
  assert.deepEqual(sarcStats(engine, id("sarc")), [2, 2, 2]);
});

// ---------------------------------------------------------------------------
// Jackmove
// ---------------------------------------------------------------------------

const JACKMOVE = "37c534eb-781f-4386-b0be-afdb268efd05"; // tactic · rogue · cost 0 · ddddd -- COST: Choose a number for X. Pay X+X. -- EFFECT: Reveal up to the top X cards of your opponent's deck. Put all revealed characters and items into play under your control. Put the remaining cards into your opponent's discard pile.

/** P2's deck, top to bottom: d0 character, d1 item, d2 location, d3 tactic, d4 character, d5 item, d6 resource, d7 character. */
const JACK_DECK: [string, () => CardDefinition][] = [
  ["d0", () => character({ name: "Deck Char 1" })],
  ["d1", () => item({ name: "Deck Item 1" })],
  ["d2", () => location({ name: "Deck Place" })],
  ["d3", () => tactic({ name: "Deck Trick" })],
  ["d4", () => character({ name: "Deck Char 2" })],
  ["d5", () => item({ name: "Deck Item 2" })],
  ["d6", () => resourceCard({ name: "Deck Resource" })],
  ["d7", () => character({ name: "Deck Char 3" })]
];

function jackBoard(opts: { deception?: number; rage?: number; deck?: [string, () => CardDefinition][]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "jm", def: printing(JACKMOVE), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.deck ?? JACK_DECK).map(([key, def]): CardPlacement => ({ key, def: def(), owner: P2, zone: "deck" })),
      { key: "oDead", def: character({ name: "Opp Dead" }), owner: P2, zone: "discard" },
      ...fillers("m", 3, P1, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

const castJackmove = (game: ReturnType<typeof jackBoard>, x: number) => play(game.engine, P1, game.id("jm"), { variables: { x } });
const takenByMe = (game: ReturnType<typeof jackBoard>, key: string) =>
  zoneOf(game.engine, game.id(key)) === "play" && game.engine.state.cards[game.id(key)].controllerId === P1 && game.engine.state.cards[game.id(key)].ownerId === P2;

clause(JACKMOVE, "0:ability", "X=4 reveals the top 4: the character and item go into play under my control, the location and tactic go to the opponent's discard pile, the rest of the deck is untouched", () => {
  const game = jackBoard();
  const { engine, id } = game;
  castJackmove(game, 4);
  assert.equal(pending(engine), undefined);
  assert.equal(takenByMe(game, "d0"), true, "the top character is mine");
  assert.equal(takenByMe(game, "d1"), true, "the item is mine");
  for (const key of ["d2", "d3"]) {
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} (not a character or item) went to a discard pile`);
    assert.equal(engine.state.players[P2].discard.includes(id(key)), true, `${key} is in the opponent's discard pile`);
  }
  assert.deepEqual(engine.state.players[P2].deck, ["d4", "d5", "d6", "d7"].map(id), "the cards below the top 4 stay, in order");
  assert.equal(zoneOf(engine, id("oDead")), "discard", "the old discard pile is untouched");
  assert.equal(engine.state.players[P1].discard.includes(id("d2")), false, "nothing went to MY discard pile");
  assert.equal(engine.state.players[P1].deck.length, 3, "my own deck is untouched");
  assert.equal(zoneOf(engine, id("jm")), "discard", "the tactic is spent");
});

clause(JACKMOVE, "0:ability", "X=7 reaches the resource card too: every revealed character and item is mine, every other card (location, tactic, resource) is discarded", () => {
  const game = jackBoard({ deception: 14 });
  castJackmove(game, 7);
  for (const key of ["d0", "d1", "d4", "d5"]) assert.equal(takenByMe(game, key), true, `${key} is mine`);
  for (const key of ["d2", "d3", "d6"]) assert.equal(zoneOf(game.engine, game.id(key)), "discard", `${key} was discarded`);
  assert.deepEqual(game.engine.state.players[P2].deck, [game.id("d7")], "only the 8th card is left");
});

clause(JACKMOVE, "0:ability", "X=2 reveals only the top 2 (a character and an item); X=1 only the top card", () => {
  const two = jackBoard();
  castJackmove(two, 2);
  assert.deepEqual(["d0", "d1"].map((key) => takenByMe(two, key)), [true, true]);
  assert.deepEqual(two.engine.state.players[P2].deck, ["d2", "d3", "d4", "d5", "d6", "d7"].map(two.id), "the other six stay in order");
  assert.equal(two.engine.state.players[P2].discard.length, 1, "nothing was discarded");

  const one = jackBoard();
  castJackmove(one, 1);
  assert.equal(takenByMe(one, "d0"), true);
  assert.equal(zoneOf(one.engine, one.id("d1")), "deck", "the second card is not revealed");
  assert.equal(one.engine.state.players[P2].deck.length, 7);
});

clause(JACKMOVE, "0:ability", "X=0: nothing is paid, revealed or moved", () => {
  const game = jackBoard();
  const before = game.engine.getAvailableResourceCount(P1);
  const deckBefore = [...game.engine.state.players[P2].deck];
  castJackmove(game, 0);
  assert.equal(game.engine.getAvailableResourceCount(P1), before, "X+X = 0 is free");
  assert.deepEqual(game.engine.state.players[P2].deck, deckBefore);
  assert.equal(game.engine.state.players[P2].discard.length, 1);
  assert.equal(zoneOf(game.engine, game.id("jm")), "discard", "the tactic still resolved");
});

clause(JACKMOVE, "0:ability", "cost: Pay X+X (X=1 pays 2, X=3 pays 6, X=5 pays 10)", () => {
  for (const x of [1, 3, 5]) {
    const game = jackBoard();
    const before = game.engine.getAvailableResourceCount(P1);
    castJackmove(game, x);
    assert.equal(before - game.engine.getAvailableResourceCount(P1), 2 * x, `X=${x}`);
    assert.equal(takenByMe(game, "d0"), true, `X=${x}: it worked`);
  }
});

clause(JACKMOVE, "0:ability", "cost: X+X must be affordable: X=3 with 5 resources is refused (nothing paid or moved), with 6 it works", () => {
  const short = jackBoard({ deception: 5 });
  refused(() => castJackmove(short, 3), "pay 6 with 5 resources", /cannot be deployed|pay|cost|resource|afford/i);
  assert.equal(zoneOf(short.engine, short.id("jm")), "hand");
  assert.equal(short.engine.getAvailableResourceCount(P1), 5);
  assert.equal(short.engine.state.players[P2].deck.length, 8, "nothing was revealed");

  const exact = jackBoard({ deception: 6 });
  castJackmove(exact, 3);
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
  assert.equal(takenByMe(exact, "d0"), true, "control: exactly 6 is enough");
});

clause(JACKMOVE, "0:ability", "choose a number: X must be at least 0 (a negative X is refused)", () => {
  const game = jackBoard();
  refused(() => castJackmove(game, -1), "X=-1", /number|whole|integer|variable|minimum|at least/i);
  assert.equal(zoneOf(game.engine, game.id("jm")), "hand", "the tactic stays in hand");
  assert.equal(game.engine.state.players[P2].deck.length, 8, "nothing was revealed");
  castJackmove(game, 0);
  assert.equal(zoneOf(game.engine, game.id("jm")), "discard", "control: X=0 is a legal choice");
});

clause(JACKMOVE, "0:ability", "choose a number: X must be a whole number (a fractional X is refused)", () => {
  const game = jackBoard();
  refused(() => castJackmove(game, 1.5), "X=1.5", /number|whole|integer|variable/i);
  assert.equal(zoneOf(game.engine, game.id("jm")), "hand", "the tactic stays in hand");
  assert.equal(game.engine.state.players[P2].deck.length, 8, "nothing was revealed");
});

clause(JACKMOVE, "0:ability", "up to the top X: with a 3-card deck, X=5 reveals all 3 (and still pays 10)", () => {
  const smallDeck = JACK_DECK.slice(0, 3);
  const game = jackBoard({ deck: smallDeck, deception: 10 });
  const before = game.engine.getAvailableResourceCount(P1);
  castJackmove(game, 5);
  assert.equal(pending(game.engine), undefined);
  assert.equal(takenByMe(game, "d0"), true);
  assert.equal(takenByMe(game, "d1"), true);
  assert.equal(zoneOf(game.engine, game.id("d2")), "discard");
  assert.equal(game.engine.state.players[P2].deck.length, 0, "the deck is empty");
  assert.equal(before - game.engine.getAvailableResourceCount(P1), 10, "X+X is paid in full");
});

clause(JACKMOVE, "0:ability", "the revealed cards are revealed (the top X, from the opponent's deck)", () => {
  const game = jackBoard();
  castJackmove(game, 3);
  const revealed = (game.engine.state.gameLog ?? [])
    .map((entry) => entry.event as { type: string; cardIds?: string[]; zone?: string; ownerId?: string } | undefined)
    .filter((event) => event?.type === "cardsRevealed");
  assert.equal(revealed.length, 1, "one reveal");
  assert.deepEqual([...(revealed[0]?.cardIds ?? [])], ["d0", "d1", "d2"].map(game.id), "exactly the top 3, in order");
  assert.equal(revealed[0]?.zone, "deck");
  assert.equal(revealed[0]?.ownerId, P2);
});

clause(JACKMOVE, "0:ability", "the characters and items really are mine: their enters-play triggers go to me", () => {
  const dowser = character({
    name: "Deck Dowser",
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const game = jackBoard({ deck: [["d0", () => dowser], ...JACK_DECK.slice(1)], extra: [...fillers("dA", 3, P1, "deck"), ...fillers("dB", 3, P2, "deck")] });
  const mine = game.engine.state.players[P1].hand.length;
  const theirs = game.engine.state.players[P2].hand.length;
  castJackmove(game, 1);
  drain(game.engine, declineAll);
  assert.equal(takenByMe(game, "d0"), true);
  assert.equal(game.engine.state.players[P1].hand.length, mine - 1 + 1, "I drew (the tactic left my hand)");
  assert.equal(game.engine.state.players[P2].hand.length, theirs, "the opponent drew nothing");
});

clause(JACKMOVE, "0:ability", "a revealed ATTACH TO item is put into play under my control attached to a host (CR 507.2b)", () => {
  const booster = item({
    name: "Deck Booster",
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const game = jackBoard({
    deck: [["d0", () => booster], ...JACK_DECK.slice(1)],
    extra: [{ key: "host", def: character({ name: "Host", strength: 1 }), owner: P1, zone: "play" }]
  });
  castJackmove(game, 1);
  drain(game.engine, (pc) => {
    // whatever the host choice looks like, take my own character
    if (pc.kind === "selectTargets" || pc.kind === "chooserSelectsTarget" || pc.kind === "selectDeployTargets") {
      const declarations = (pc.declarations as { id: string }[] | undefined) ?? [{ id: "t" }];
      const selected: Record<string, string[]> = {};
      for (const d of declarations) selected[d.id] = [game.id("host")];
      return pc.kind === "chooserSelectsTarget" ? { kind: pc.kind, selected: [game.id("host")] } : { kind: pc.kind, selected };
    }
    return declineAll(pc);
  });
  assert.equal(pending(game.engine), undefined);
  assert.equal(takenByMe(game, "d0"), true, "the gear entered play under my control");
  assert.equal(game.engine.state.cards[game.id("d0")].attachedTo, game.id("host"), "attached to the character I picked");
  assert.equal(game.engine.getStat(game.id("host"), "strength"), 3, "and it works: 1 + 2");
});

clause(JACKMOVE, "0:ability", "threshold ddddd: needs five deception icons (four plus rage is refused, five works)", () => {
  const four = jackBoard({ deception: 4, rage: 6 });
  refused(() => castJackmove(four, 1), "four deception icons", /cannot be deployed|threshold|icon|deception/i);
  assert.equal(zoneOf(four.engine, four.id("jm")), "hand");

  const five = jackBoard({ deception: 5, rage: 5 });
  castJackmove(five, 2);
  assert.equal(takenByMe(five, "d0"), true, "control: five deception icons (and rage for the rest of the cost) is enough");
});

clause(JACKMOVE, "0:ability", "cost: X+X is paid when the tactic is played, before it resolves", () => {
  const game = jackBoard();
  const before = game.engine.getAvailableResourceCount(P1);
  playRaw(game.engine, P1, game.id("jm"), { variables: { x: 3 } });
  assert.equal(before - game.engine.getAvailableResourceCount(P1), 6, "all 6 are already paid while the tactic waits");
  assert.equal(zoneOf(game.engine, game.id("d0")), "deck", "nothing has been revealed or moved yet");
  resolvePendingResponses(game.engine);
  assert.equal(takenByMe(game, "d0"), true);
});

