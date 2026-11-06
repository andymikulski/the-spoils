// `getPlayRequirements`, `getSelectionRequirements`, `answerPlayRequirement`, `declinedKey`.
// Synthetic cards pin each rule one at a time; the real catalog cards are in client-queries.test.ts.
// Includes the cases a hand-written client-side requirements helper tends to get wrong (Q19 `mustBePicked`,
// `attachToController`, a cost-bound optional pick, `forced`, distinct flags).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { answerPlayRequirement, declinedKey } from "../../engine.js";
import type { ActivatedAbility, CardDefinition, PickStep, PlayAction, PlayRequirement } from "../../engine.js";
import { buildGame, character, item, P1, P2, resourceCard, tactic } from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import { cardDef, developFaction, bank } from "./per-card/_harness.js";

const anyCharacter = { type: "character" as const, zone: "play" as const };
const sel = (id: string) => ({ type: "selected" as const, id });

function ability(overrides: Partial<ActivatedAbility> & Pick<ActivatedAbility, "id">): ActivatedAbility {
  return { type: "activated", effects: [], ...overrides };
}

function playTactic(name: string, abilities: ActivatedAbility[], overrides: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({ name, behavior: { abilities }, ...overrides });
}

const picks = (requirements: PlayRequirement[]): PickStep[] =>
  requirements.filter((requirement): requirement is PickStep => requirement.kind === "pick");

const resources = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `res${owner}${i}`, def: resourceCard({ name: `Res${owner}${i}` }), owner }));

const play = (cardId: string): PlayAction => ({ type: "playCard", playerId: P1, cardId });
const use = (cardId: string, abilityId = "go"): PlayAction => ({ type: "activateAbility", playerId: P1, cardId, abilityId });

describe("getPlayRequirements: picks written after a cost step (E3a)", () => {
  // Rapine's shape: "Destroy a character or item you control. Pick a character." The sacrifice is destroyed first,
  // so the pick that follows must not offer it.
  const rapine = playTactic("Rapine", [
    ability({
      id: "body",
      targets: [
        { id: "sac", selector: { controller: "self", zone: "play", type: "character" }, count: 1 },
        { id: "c", selector: anyCharacter, count: 1 }
      ],
      costs: [{ type: "destroy", target: sel("sac") }, { type: "pick", declarationId: "c" }]
    })
  ]);

  test("asks the sacrifice first, then offers every character EXCEPT the one the cost destroys", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "spare", def: character({ name: "Spare" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 },
        { key: "rapine", def: rapine, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("rapine"));

    const first = picks(engine.getPlayRequirements(action));
    assert.deepEqual(first.map((step) => step.requirement.id), ["sac", "c"], "cost order: the sacrifice, then the pick");
    assert.equal(first[1].requirement.afterCost, true);
    assert.ok(first[0].candidates.includes(id("mine")) && first[0].candidates.includes(id("spare")));
    assert.ok(!first[0].candidates.includes(id("theirs")), "the sacrifice is your own character");

    // Answer the sacrifice: `c` is now judged AFTER it is destroyed.
    const answered = answerPlayRequirement(action, { kind: "pick", id: "sac", cardIds: [id("mine")] });
    const [second] = picks(engine.getPlayRequirements(answered));
    assert.equal(second.requirement.id, "c");
    assert.ok(!second.candidates.includes(id("mine")), "the destroyed card is not offered");
    assert.ok(second.candidates.includes(id("spare")) && second.candidates.includes(id("theirs")));

    // Both picks in: nothing is missing, and the engine agrees.
    const done = answerPlayRequirement(answered, { kind: "pick", id: "c", cardIds: [id("theirs")] });
    assert.deepEqual(engine.getPlayRequirements(done), []);
    assert.deepEqual(engine.checkAction(done), { ok: true });
    // Picking the destroyed card for `c` is exactly what the offered list rules out, and the engine refuses it too.
    const bad = answerPlayRequirement(answered, { kind: "pick", id: "c", cardIds: [id("mine")] });
    assert.equal(engine.checkAction(bad).ok, false);
  });

  // Tri-Pole Magnet's shape: "Deplete this card. Pick a depleted character." The cost makes THIS card a legal pick.
  test("a pick after 'deplete this card' offers the card itself, though it isn't depleted yet", () => {
    const magnet = character({
      name: "Magnet",
      behavior: {
        abilities: [
          ability({
            id: "pull",
            targets: [{ id: "d", selector: { ...anyCharacter, depleted: true }, count: 1 }],
            costs: [{ type: "deplete", target: "source" }, { type: "pick", declarationId: "d" }]
          })
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "m", def: magnet, owner: P1 }] });
    const [step] = picks(engine.getPlayRequirements(use(id("m"), "pull")));
    assert.equal(step.requirement.afterCost, true);
    assert.deepEqual(step.candidates, [id("m")]);
  });

  test("the pick list is the very list getPickCandidates gives for that declaration", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 },
        { key: "rapine", def: rapine, owner: P1, zone: "hand" }
      ]
    });
    const action = answerPlayRequirement(play(id("rapine")), { kind: "pick", id: "sac", cardIds: [id("mine")] });
    const [step] = picks(engine.getPlayRequirements(action));
    assert.deepEqual(step.candidates, engine.getPickCandidates(action, "c"));
  });
});

describe("getPlayRequirements: gates and counts", () => {
  test("a modal card asks for its mode first and lists nothing else until it is answered", () => {
    const modal = tactic({
      name: "Modal",
      behavior: {
        modes: [
          { label: "Smash", targets: [{ id: "t", selector: anyCharacter, count: 1 }], effects: [] },
          { label: "Nothing", effects: [] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "modal", def: modal, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("modal"));

    assert.deepEqual(engine.getPlayRequirements(action), [
      {
        kind: "mode",
        options: [
          { index: 0, label: "Smash" },
          { index: 1, label: "Nothing" }
        ]
      }
    ]);
    assert.deepEqual(
      picks(engine.getPlayRequirements(answerPlayRequirement(action, { kind: "mode", index: 0 }))).map((s) => s.requirement.id),
      ["t"]
    );
    assert.deepEqual(engine.getPlayRequirements(answerPlayRequirement(action, { kind: "mode", index: 1 })), [], "the second mode needs nothing");
    // The engine refuses the unanswered mode too: the gate and `perform` agree.
    assert.match((engine.checkAction(action) as { error: string }).error, /modal/);
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "mode", index: 1 })).ok, true);
    // A mode the card does not have asks nothing: the play itself is refused.
    assert.deepEqual(engine.getPlayRequirements({ ...action, mode: 5 } as PlayAction), []);
  });

  test("X is asked first (0 is legal), with the engine's bounds, and it sizes a discard cost's count", () => {
    const x = { type: "variable" as const, id: "x" };
    const discardX = playTactic("Discard X", [
      ability({
        id: "go",
        variableBounds: { x: { min: 0, max: 3 } },
        costs: [{ type: "discard", id: "d", player: "controller", selector: {}, count: x }]
      })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "hand" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "hand" },
        { key: "dx", def: discardX, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("dx"));

    assert.deepEqual(engine.getPlayRequirements(action), [{ kind: "variables", variables: [{ id: "x", min: 0, max: 3 }] }]);
    // X = 0: "discard 0 cards" is not a prompt.
    assert.deepEqual(engine.getPlayRequirements(answerPlayRequirement(action, { kind: "variables", values: { x: 0 } })), []);
    // X = 2: pick two cards from the hand, never the card being played.
    const withX = answerPlayRequirement(action, { kind: "variables", values: { x: 2 } });
    const [discard] = picks(engine.getPlayRequirements(withX));
    assert.equal(discard.requirement.source, "discardCost");
    assert.equal(discard.requirement.count, 2);
    assert.deepEqual([...discard.candidates].sort(), [id("a"), id("b")].sort());
    assert.equal(discard.min, 2);
    assert.deepEqual(engine.checkAction(answerPlayRequirement(withX, { kind: "pick", id: "d", cardIds: [id("a"), id("b")] })), { ok: true });
    // An X over its bound is refused by the engine, which the gate's max said up front.
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "variables", values: { x: 4 } })).ok, false);
  });

  test("moveSelected costs are picks too, but a 'this card' move is not", () => {
    const shuffleIn = playTactic("Shuffle in", [
      ability({
        id: "go",
        costs: [
          { type: "moveSelected", id: "m", player: "controller", selector: { type: "resource" }, count: 1, to: "deck", shuffle: true },
          { type: "moveSelected", id: "self", player: "controller", selector: { name: "__self" }, count: 1, to: "deck" }
        ]
      })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "spare", def: resourceCard({ name: "Spare" }), owner: P1 },
        { key: "si", def: shuffleIn, owner: P1, zone: "hand" }
      ]
    });
    const steps = picks(engine.getPlayRequirements(play(id("si"))));
    assert.deepEqual(steps.map((step) => step.requirement.id), ["m"]);
    assert.equal(steps[0].requirement.source, "moveCost");
    assert.equal(steps[0].requirement.costLabel, "shuffle into your deck");
    assert.deepEqual(steps[0].candidates, [id("spare")]);
  });

  test("which numbers the player chooses is the engine's rule: bound by a cost step, rolled, or a placeholder", () => {
    const x = { type: "variable" as const, id: "x" };
    const asked = (source: Partial<ActivatedAbility>): string[] => {
      const card = playTactic("X", [ability({ id: "go", ...source })]);
      const { engine, id } = buildGame({ cards: [{ key: "c", def: card, owner: P1, zone: "hand" }, ...resources(2)] });
      return engine
        .getPlayRequirements(play(id("c")))
        .flatMap((requirement) => (requirement.kind === "variables" ? requirement.variables.map((variable) => variable.id) : []));
    };
    // "X is its strength" is computed by the cost: never asked.
    assert.deepEqual(asked({ costs: [{ type: "bindVariable", id: "x", value: 3 }, { type: "payResources", amount: x }] }), []);
    // No bounds, no `variables` entry: the cost reads X, so the player chooses it.
    assert.deepEqual(asked({ costs: [{ type: "payResources", amount: x }] }), ["x"]);
    // A bare number in `variables` is only a placeholder and still chosen; a roll is the engine's.
    assert.deepEqual(asked({ costs: [{ type: "payResources", amount: x }], variables: { x: 0 } }), ["x"]);
    assert.deepEqual(asked({ costs: [{ type: "payResources", amount: x }], variables: { x: { type: "random", min: 1, max: 2 } } }), []);
    // An id starting `__` belongs to the engine.
    assert.deepEqual(asked({ costs: [{ type: "payResources", amount: { type: "variable", id: "__amount" } }] }), []);
  });

  test("an X bound that reads the board is evaluated for the gate", () => {
    const capped = playTactic("Capped", [
      ability({
        id: "go",
        variableBounds: { x: { min: 1, max: { type: "count", selector: { controller: "self", zone: "play", type: "character" } } } },
        costs: [{ type: "payResources", amount: { type: "variable", id: "x" } }]
      })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "c", def: capped, owner: P1, zone: "hand" },
        ...resources(4)
      ]
    });
    assert.deepEqual(engine.getPlayRequirements(play(id("c"))), [{ kind: "variables", variables: [{ id: "x", min: 1, max: 2 }] }]);
    const ok = answerPlayRequirement(play(id("c")), { kind: "variables", values: { x: 2 } });
    assert.deepEqual(engine.checkAction(ok), { ok: true });
    assert.equal(engine.checkAction(answerPlayRequirement(play(id("c")), { kind: "variables", values: { x: 3 } })).ok, false);
    assert.equal(engine.checkAction(answerPlayRequirement(play(id("c")), { kind: "variables", values: { x: 0 } })).ok, false);
  });

  test("'Pick 2' as two single declarations: the first pick is not offered for the second", () => {
    const boon = playTactic("Boon", [
      ability({
        id: "go",
        targets: [
          { id: "first", selector: anyCharacter, count: 1, distinctPicks: true },
          { id: "second", selector: anyCharacter, count: 1, distinctPicks: true }
        ]
      })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P2 },
        { key: "boon", def: boon, owner: P1, zone: "hand" }
      ]
    });
    const action = answerPlayRequirement(play(id("boon")), { kind: "pick", id: "first", cardIds: [id("a")] });
    const [second] = picks(engine.getPlayRequirements(action));
    assert.equal(second.requirement.id, "second");
    assert.deepEqual(second.candidates, [id("b")]);
    assert.deepEqual(second.blocked, [id("a")]);
    assert.equal(second.forced, true, "one card left, mandatory");
    // The engine agrees both ways.
    assert.deepEqual(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "second", cardIds: [id("b")] })), { ok: true });
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "second", cardIds: [id("a")] })).ok, false);
  });

  test("an optional deck search can be declined (no search, no shuffle), which is not the same as finding nothing", () => {
    const search = playTactic("Search", [
      ability({ id: "go", targets: [{ id: "s", selector: { zone: "deck", owner: "self" }, count: 1, optional: true }] })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "in", def: character({ name: "In deck" }), owner: P1, zone: "deck" },
        { key: "s", def: search, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("s"));
    const [step] = picks(engine.getPlayRequirements(action));
    assert.equal(step.declinable, true);
    assert.equal(step.min, 0);
    assert.equal(step.forced, false, "an optional pick is never forced");

    const declined = answerPlayRequirement(action, { kind: "pick", id: "s", cardIds: [], declined: true });
    assert.deepEqual(declined.selected, { s: [], [declinedKey("s")]: [] });
    assert.deepEqual(engine.getPlayRequirements(declined), []);

    const foundNothing = answerPlayRequirement(action, { kind: "pick", id: "s", cardIds: [] });
    assert.deepEqual(foundNothing.selected, { s: [] }, "no decline marker: the engine will shuffle");
    assert.deepEqual(engine.getPlayRequirements(foundNothing), []);
  });

  test("a random-sized pick (Hammer Smash) is left to the engine; an optional pick with nothing to pick asks nobody", () => {
    const smash = playTactic("Smash", [
      ability({
        id: "go",
        variables: { x: { type: "coinFlip", win: 2, lose: 1 } },
        targets: [{ id: "picked", selector: { zone: "play", type: "item" }, count: { type: "variable", id: "x" }, optional: true }]
      })
    ]);
    const a = buildGame({ cards: [{ key: "s", def: smash, owner: P1, zone: "hand" }, { key: "i", def: item({ name: "Thing" }), owner: P2 }] });
    assert.deepEqual(a.engine.getPlayRequirements(play(a.id("s"))), []);

    const optional = playTactic("Maybe", [ability({ id: "go", targets: [{ id: "t", selector: anyCharacter, count: 1, optional: true }] })]);
    const b = buildGame({ cards: [{ key: "o", def: optional, owner: P1, zone: "hand" }] });
    assert.deepEqual(b.engine.getPlayRequirements(play(b.id("o"))), []);
  });

  test("an implied pick (Verrucose Brains) with no real choice is not asked; with a tie it is", () => {
    const brains = playTactic("Brains", [
      ability({
        id: "go",
        targets: [
          {
            id: "lowest",
            count: 1,
            impliedPick: true,
            selector: {
              ...anyCharacter,
              conditions: [{ type: "isExtremum", target: sel("__candidate"), metric: "cost", direction: "min", among: anyCharacter }]
            }
          }
        ]
      })
    ]);
    const only = buildGame({
      cards: [
        { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P2 },
        { key: "dear", def: character({ name: "Dear", cost: 5 }), owner: P2 },
        { key: "b", def: brains, owner: P1, zone: "hand" }
      ]
    });
    assert.deepEqual(only.engine.getPlayRequirements(play(only.id("b"))), []);
    assert.deepEqual(only.engine.checkAction(play(only.id("b"))), { ok: true }, "the engine fills it in itself");

    const tie = buildGame({
      cards: [
        { key: "one", def: character({ name: "One", cost: 1 }), owner: P2 },
        { key: "two", def: character({ name: "Two", cost: 1 }), owner: P2 },
        { key: "b", def: brains, owner: P1, zone: "hand" }
      ]
    });
    const [step] = picks(tie.engine.getPlayRequirements(play(tie.id("b"))));
    assert.deepEqual([...step.candidates].sort(), [tie.id("one"), tie.id("two")].sort());
    assert.equal(step.requirement.impliedPick, true);
  });

  test("a permanent's EXTRA COST pick (onPlay) is asked like a tactic's", () => {
    const plain = character({
      name: "Plain",
      behavior: { onPlay: { targets: [{ id: "t", selector: { controller: "self", zone: "hand" }, count: 1 }] } }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "h", def: character({ name: "Other in hand" }), owner: P1, zone: "hand" },
        { key: "p", def: plain, owner: P1, zone: "hand" }
      ]
    });
    const [step] = picks(engine.getPlayRequirements(play(id("p"))));
    assert.deepEqual(step.candidates, [id("h")], "the card being played is never offered");
  });
});

describe("getPlayRequirements: what the old client helper got wrong", () => {
  test("Q19: an optional pick has to take a card that must be picked; the offer collapses onto it", () => {
    const ferret = cardDef("1st Edition", "Ferrous Ferret");
    const maybe = playTactic("Maybe", [
      ability({ id: "go", targets: [{ id: "t", selector: anyCharacter, count: 1, optional: true }] })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "ferret", def: ferret, owner: P2 },
        { key: "other", def: character({ name: "Other" }), owner: P2 },
        { key: "m", def: maybe, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("m"));
    const [step] = picks(engine.getPlayRequirements(action));
    assert.deepEqual(step.candidates, [id("ferret")], "a single pick collapses onto the card that must be picked");
    assert.deepEqual(step.blocked, [id("other")]);
    assert.equal(step.min, 1, "the optional pick is no longer optional while that card is a legal pick");
    assert.equal(step.forced, true);
    // The engine agrees: declining is refused, picking it is accepted.
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [] })).ok, false);
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [id("other")] })).ok, false);
    assert.deepEqual(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [id("ferret")] })), { ok: true });
  });

  test("Q19: a bigger pick keeps the whole pool but still has to include the forced card", () => {
    const ferret = cardDef("1st Edition", "Ferrous Ferret");
    const two = playTactic("Two", [ability({ id: "go", targets: [{ id: "t", selector: anyCharacter, count: 2 }] })]);
    const { engine, id } = buildGame({
      cards: [
        { key: "ferret", def: ferret, owner: P2 },
        { key: "a", def: character({ name: "A" }), owner: P2 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "two", def: two, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("two"));
    const [step] = picks(engine.getPlayRequirements(action));
    assert.equal(step.candidates.length, 3);
    assert.equal(step.min, 2);
    // Not what the offered list alone says: the engine also wants the forced card among the two.
    assert.equal(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [id("a"), id("b")] })).ok, false);
    assert.deepEqual(engine.checkAction(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [id("ferret"), id("b")] })), { ok: true });
  });

  test("a pick that feeds a cost stays mandatory even when it is written optional (the count is an expression)", () => {
    const x = { type: "variable" as const, id: "x" };
    const ritual = playTactic("Ritual", [
      ability({
        id: "go",
        variableBounds: { x: { min: 0, max: 2 } },
        targets: [{ id: "d", selector: { controller: "self", zone: "play", type: "character" }, count: x, optional: true }],
        costs: [{ type: "depleteSelected", declarationId: "d" }]
      })
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "r", def: ritual, owner: P1, zone: "hand" }
      ]
    });
    const withX = answerPlayRequirement(play(id("r")), { kind: "variables", values: { x: 2 } });
    const [step] = picks(engine.getPlayRequirements(withX));
    assert.equal(step.requirement.optional, true);
    assert.equal(step.min, 2, "a short pick cannot pay the cost");
    assert.equal(step.forced, true);
    assert.equal(engine.checkAction(answerPlayRequirement(withX, { kind: "pick", id: "d", cardIds: [id("a")] })).ok, false);
    assert.deepEqual(engine.checkAction(answerPlayRequirement(withX, { kind: "pick", id: "d", cardIds: [id("a"), id("b")] })), { ok: true });
  });

  test("an attach-to card offers only what its `attachToController` allows", () => {
    const sharpey = cardDef("Shade of the Devoured Emperor", "Sharpey Pointy Lethal Army Tool");
    assert.ok(sharpey.attachToController, "the card carries the controller restriction");
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 },
        { key: "s", def: sharpey, owner: P1, zone: "hand" },
        { key: "plain", def: item({ name: "Plain Attach", attachTo: "character" }), owner: P1, zone: "hand" }
      ]
    });
    const [restricted] = picks(engine.getPlayRequirements(play(id("s"))));
    assert.equal(restricted.requirement.id, "attachTo");
    const expected = sharpey.attachToController === "self" ? [id("mine")] : [id("theirs")];
    assert.deepEqual(restricted.candidates, expected);
    const [open] = picks(engine.getPlayRequirements(play(id("plain"))));
    assert.deepEqual([...open.candidates].sort(), [id("mine"), id("theirs")].sort());
  });

  test("the card being played is never offered, in the hand or anywhere", () => {
    const inHand = playTactic("Hand pick", [ability({ id: "go", targets: [{ id: "t", selector: { controller: "self", zone: "hand" }, count: 1 }] })]);
    const { engine, id } = buildGame({
      cards: [
        { key: "h", def: character({ name: "Other" }), owner: P1, zone: "hand" },
        { key: "t", def: inHand, owner: P1, zone: "hand" }
      ]
    });
    const [step] = picks(engine.getPlayRequirements(play(id("t"))));
    assert.deepEqual(step.candidates, [id("h")]);
    assert.ok(!step.blocked.includes(id("t")));
    // An ability's own source IS a legal pick for its own ability.
    const self = character({
      name: "Self picker",
      behavior: { abilities: [ability({ id: "go", targets: [{ id: "t", selector: anyCharacter, count: 1 }] })] }
    });
    const b = buildGame({ cards: [{ key: "s", def: self, owner: P1 }] });
    const [own] = picks(b.engine.getPlayRequirements(use(b.id("s"))));
    assert.deepEqual(own.candidates, [b.id("s")]);
  });
});

describe("pick steps carry their own distinct and forced info", () => {
  test("distinct names / trades / types are flagged on the step, and a flagged pick is never forced", () => {
    const make = (flag: "distinctNames" | "distinctTrades" | "distinctTypes") =>
      playTactic(`Flag ${flag}`, [ability({ id: "go", targets: [{ id: "t", selector: { zone: "play" }, count: 2, [flag]: true }] })]);
    for (const flag of ["distinctNames", "distinctTrades", "distinctTypes"] as const) {
      const card = make(flag);
      // Exactly two cards to pick from: an unflagged pick would be forced.
      const { engine, id } = buildGame({
        cards: [
          { key: "a", def: character({ name: "A", trade: "rogue" }), owner: P1 },
          { key: "b", def: item({ name: "B", trade: "banker" }), owner: P1 },
          { key: "c", def: card, owner: P1, zone: "hand" }
        ]
      });
      const [step] = picks(engine.getPlayRequirements(play(id("c"))));
      assert.equal(step.distinctNames, flag === "distinctNames");
      assert.equal(step.distinctTrades, flag === "distinctTrades");
      assert.equal(step.distinctTypes, flag === "distinctTypes");
      assert.equal(step.requirement.count, 2);
      assert.equal(step.forced, false, `${flag}: the engine can still refuse the pair`);
    }
    const plain = playTactic("Plain two", [ability({ id: "go", targets: [{ id: "t", selector: { zone: "play" }, count: 2 }] })]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: item({ name: "B" }), owner: P1 },
        { key: "c", def: plain, owner: P1, zone: "hand" }
      ]
    });
    const [step] = picks(engine.getPlayRequirements(play(id("c"))));
    assert.deepEqual([step.distinctNames, step.distinctTrades, step.distinctTypes], [false, false, false]);
    assert.equal(step.forced, true, "both candidates are needed, nothing else to choose");
  });

  test("a real distinct-names card: the picker offers it, the engine refuses a clashing pair", () => {
    const truculence = cardDef("Shade of the Devoured Emperor", "Tedious TriAdic Truculence");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "a1", def: character({ name: "Twin" }), owner: P1 },
        { key: "a2", def: character({ name: "Twin" }), owner: P1 },
        { key: "a3", def: character({ name: "Solo" }), owner: P1 },
        { key: "b1", def: character({ name: "Other" }), owner: P2 },
        ...bank("obsession", 6, P1),
        { key: "t", def: truculence, owner: P1, zone: "hand" }
      ]
    });
    const action = play(id("t"));
    const [step] = picks(engine.getPlayRequirements(action));
    assert.equal(step.distinctNames, true);
    assert.equal(step.min, 3);
    const clash = answerPlayRequirement(action, { kind: "pick", id: "picks", cardIds: [id("a1"), id("a2"), id("a3")] });
    assert.match((engine.checkAction(clash) as { error: string }).error, /different names/);
    const fine = answerPlayRequirement(action, { kind: "pick", id: "picks", cardIds: [id("a1"), id("a3"), id("b1")] });
    assert.deepEqual(engine.checkAction(fine), { ok: true });
  });
});

describe("FLIP UP: the option gate", () => {
  const GLOAM = "Woadenworm Gloamspike, Thabbashite Prince";
  const twoWays = () => ({
    ...tactic({ name: "Two Ways", cost: 3, threshold: "o", flipUp: { cost: 1, threshold: "o" } }),
    id: "api-req-two-ways"
  });
  const board = (obsession: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "g", def: cardDef("Seed 2", GLOAM), owner: P1 },
        { key: "fd", def: twoWays(), owner: P1, faceDown: true },
        ...bank("obsession", obsession, P1)
      ]
    });
  const flip = (cardId: string): PlayAction => ({ type: "flipUp", playerId: P1, cardId });

  test("two usable options are asked, each with its cost, threshold and availability", () => {
    const { engine, id } = board(6);
    const [gate] = engine.getPlayRequirements(flip(id("fd")));
    assert.equal(gate.kind, "flipUpOption");
    if (gate.kind !== "flipUpOption") return;
    assert.deepEqual(gate.options.map((o) => [o.index, o.cost, o.available]), [[0, 1, true], [1, 3, true]]);
    // Naming an option settles it, and the engine takes either.
    for (const index of [0, 1]) {
      const named = answerPlayRequirement(flip(id("fd")), { kind: "flipUpOption", index });
      assert.deepEqual(engine.getPlayRequirements(named), []);
      assert.deepEqual(engine.checkAction(named), { ok: true });
    }
  });

  test("with only one option payable there is nothing to ask, and the engine refuses the other", () => {
    const { engine, id } = board(1); // 1 [O] + the face-down card itself: the printed cost (1) fits, the granted one (3) does not
    assert.deepEqual(engine.getPlayRequirements(flip(id("fd"))), []);
    assert.deepEqual(engine.checkAction(flip(id("fd"))), { ok: true });
    assert.equal(engine.checkAction({ type: "flipUp", playerId: P1, cardId: id("fd"), flipUpOption: 1 }).ok, false);
  });

  test("api-fix: each option's availability and reason are getFlipUpPlayability's answer, and agree with the engine", () => {
    for (const obsession of [1, 6]) {
      const { engine, id } = board(obsession);
      const options = engine.getFlipUpOptions(id("fd"));
      assert.equal(options.length, 2);
      const gate = engine.getPlayRequirements(flip(id("fd")))[0];
      options.forEach((_, index) => {
        const playability = engine.getFlipUpPlayability(P1, id("fd"), index);
        if (gate?.kind === "flipUpOption") {
          assert.equal(gate.options[index].available, playability.playable, `option ${index} with ${obsession} [O]`);
          assert.equal(gate.options[index].reason, playability.playable ? undefined : playability.reason);
        }
        assert.equal(engine.checkAction({ type: "flipUp", playerId: P1, cardId: id("fd"), flipUpOption: index }).ok, playability.playable, `option ${index} with ${obsession} [O]`);
      });
      // With 1 [O] only the printed option is payable; with 6 both are, and the gate is raised.
      assert.equal(gate?.kind === "flipUpOption", obsession === 6);
    }
  });
  test("a FLIP UP ban leaves no option to ask about, and the engine refuses the flip", () => {
    const { engine, id } = board(6);
    engine.state.playRestrictions.push({ playerId: P1, kind: "flipUp" } as never);
    assert.deepEqual(engine.getPlayRequirements(flip(id("fd"))), []);
    assert.match((engine.checkAction(flip(id("fd"))) as { error: string }).error, /FLIP UP/);
  });
});

describe("getSelectionRequirements: picks of a pending choice", () => {
  test("a chooser's pick is judged for the chooser, with the same min / max / candidates the engine accepts", () => {
    const defenders = cardDef("Seed Saga", "Defenders of Marduun");
    const { engine, id } = buildGame({
      playerA: { faction: defenders },
      cards: [
        { key: "h1", def: character({ name: "Hand A" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "Hand B" }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const factionId = engine.state.players[P1].factionId!;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "defenders-resource" });
    // The ability's own response window: let it resolve.
    while (engine.state.responseWindow && !engine.state.pendingChoice) {
      const window = engine.state.responseWindow;
      engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
    }
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooserSelectsTarget");
    if (pending?.kind !== "chooserSelectsTarget") return;

    const [step] = picks(
      engine.getSelectionRequirements({
        sourceId: pending.context.sourceId,
        controllerId: pending.context.controllerId,
        pickerId: pending.playerId,
        abilityId: pending.context.abilityId,
        declarations: [pending.declaration],
        costs: [],
        selected: pending.context.selected,
        variables: pending.context.variables ?? {}
      })
    );
    assert.deepEqual([...step.candidates].sort(), [id("h1"), id("h2")].sort());
    assert.equal(step.min, 1);
    assert.equal(step.max, 1);
    // Every offered card is accepted, a card outside the offer is refused.
    for (const cardId of step.candidates) {
      assert.deepEqual(engine.checkAction({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsTarget", selected: [cardId] } }), { ok: true });
    }
    assert.equal(
      engine.checkAction({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsTarget", selected: [factionId] } }).ok,
      false
    );
  });

  test("a random-sized pick (Hammer Smash) is asked once the engine has rolled, and the answer is checked the same way", () => {
    const smash = cardDef("1st Edition", "Hammer Smash");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      random: () => 0.1, // the coin is won: X = 2
      cards: [
        { key: "i1", def: item({ name: "Item 1" }), owner: P2 },
        { key: "i2", def: item({ name: "Item 2" }), owner: P2 },
        { key: "i3", def: item({ name: "Item 3" }), owner: P1 },
        { key: "c", def: character({ name: "Not an item" }), owner: P2 },
        ...bank("rage", 4, P1),
        { key: "s", def: smash, owner: P1, zone: "hand" }
      ]
    });
    assert.deepEqual(engine.getPlayRequirements(play(id("s"))), [], "nothing to ask before the roll");
    engine.perform(play(id("s")));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "selectDeployTargets");
    if (pending?.kind !== "selectDeployTargets") return;

    const [step] = picks(
      engine.getSelectionRequirements({
        sourceId: pending.sourceId,
        controllerId: pending.playerId,
        declarations: pending.declarations,
        costs: [],
        selected: pending.selected,
        variables: pending.variables
      })
    );
    assert.equal(step.requirement.id, "picked");
    assert.equal(step.max, pending.variables.x, "sized by the roll the engine made");
    assert.deepEqual([...step.candidates].sort(), [id("i1"), id("i2"), id("i3")].sort());
    assert.deepEqual(step.blocked, [], "the selector only matches items");
    const answer = (selected: string[]) =>
      engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: selected } } });
    assert.deepEqual(answer([]), { ok: true }, "optional");
    assert.deepEqual(answer(step.candidates.slice(0, step.max)), { ok: true });
    assert.equal(answer(step.candidates).ok, step.candidates.length <= step.max);
    assert.equal(answer([id("c")]).ok, false);
  });

  test("the numbers a pending ability asks for come with variableSource; without it only picks are listed", () => {
    const x = { type: "variable" as const, id: "x" };
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 }
      ]
    });
    const base = {
      sourceId: id("a"),
      controllerId: P1,
      declarations: [{ id: "t", selector: { controller: "self" as const, zone: "play" as const, type: "character" as const }, count: x }],
      costs: [],
      selected: {}
    };
    const source = { variableBounds: { x: { min: 1, max: 2 } } };
    assert.deepEqual(engine.getSelectionRequirements({ ...base, variables: {}, variableSource: source }), [
      { kind: "variables", variables: [{ id: "x", min: 1, max: 2 }] }
    ]);
    const [step] = picks(engine.getSelectionRequirements({ ...base, variables: { x: 2 }, variableSource: source }));
    assert.equal(step.requirement.count, 2);
    assert.equal(step.min, 2);
    assert.deepEqual(engine.getSelectionRequirements({ ...base, variables: {} }).filter((r) => r.kind === "variables"), []);
  });

  test("an answered pick is not asked again, and cost-sourced picks work without a play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "hand" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "hand" },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    const declarations = [{ id: "t", selector: { controller: "self" as const, zone: "hand" as const }, count: 1 }];
    const input = { sourceId: id("src"), controllerId: P1, declarations, costs: [], variables: {} };
    assert.equal(picks(engine.getSelectionRequirements({ ...input, selected: {} })).length, 1);
    assert.deepEqual(engine.getSelectionRequirements({ ...input, selected: { t: [id("a")] } }), []);
    const discard = [{ type: "discard" as const, id: "d", player: "controller" as const, selector: {}, count: 1 }];
    const [step] = picks(engine.getSelectionRequirements({ ...input, declarations: [], costs: discard, selected: {} }));
    assert.equal(step.requirement.source, "discardCost");
    assert.deepEqual([...step.candidates].sort(), [id("a"), id("b")].sort());
  });
});

describe("answerPlayRequirement and declinedKey", () => {
  const action: PlayAction = { type: "playCard", playerId: P1, cardId: "c1" };

  test("folds each answer into a copy and leaves the action alone", () => {
    const frozen = JSON.stringify(action);
    assert.deepEqual(answerPlayRequirement(action, { kind: "mode", index: 1 }), { ...action, mode: 1 });
    assert.deepEqual(answerPlayRequirement(action, { kind: "variables", values: { x: 2 } }), { ...action, variables: { x: 2 } });
    assert.deepEqual(
      answerPlayRequirement({ ...action, variables: { x: 2 } }, { kind: "variables", values: { y: 1 } }).variables,
      { x: 2, y: 1 },
      "answers accumulate"
    );
    assert.deepEqual(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: ["a"] }).selected, { t: ["a"] });
    assert.deepEqual(answerPlayRequirement(action, { kind: "pick", id: "t", cardIds: [], declined: true }).selected, { t: [], [declinedKey("t")]: [] });
    assert.equal(JSON.stringify(action), frozen);
  });

  test("a mode does not apply to an ability, nor a FLIP UP option to a play", () => {
    const ability: PlayAction = { type: "activateAbility", playerId: P1, cardId: "c1", abilityId: "a" };
    assert.deepEqual(answerPlayRequirement(ability, { kind: "mode", index: 1 }), ability);
    assert.deepEqual(answerPlayRequirement(action, { kind: "flipUpOption", index: 1 }), action);
    const flip: PlayAction = { type: "flipUp", playerId: P1, cardId: "c1" };
    assert.deepEqual(answerPlayRequirement(flip, { kind: "flipUpOption", index: 1 }), { ...flip, flipUpOption: 1 });
  });

  test("declinedKey is the reserved selected key", () => {
    assert.equal(declinedKey("s"), "__declined:s");
  });
});
