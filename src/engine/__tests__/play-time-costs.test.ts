// E3a: costs are paid when a card is played / an ability is used, in written order, numeric cost last, picks judged
// after the earlier cost steps, X and friends locked by the cost. These tests drive synthetic cards through every step
// kind (see BEHAVIORS.md "E3 cost model"); the printed cards have their own clause tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import type { SpoilsEngine } from "../../engine.js";

type AnyDef = ReturnType<typeof character>;

const sel = (id: string) => ({ type: "selected", id });
const ready = (engine: SpoilsEngine) => engine.getAvailableResourceCount(P1);
const resources = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));
const zone = (engine: SpoilsEngine, id: string) => engine.state.cards[id].zone;

/** A character with one activated ability. */
function withAbility(name: string, ability: Record<string, unknown>, over: Partial<AnyDef> = {}): AnyDef {
  return character({ name, strength: 2, life: 3, ...over, behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...ability }] } as never });
}
const activate = (engine: SpoilsEngine, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "activateAbility", playerId: P1, cardId, abilityId: "go", ...extra } as never);
const playCard = (engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);

describe("E3a — a pick is judged after the cost steps written before it (Q15, SYS-16)", () => {
  const board = (ability: Record<string, unknown>, extra: CardPlacement[] = []) =>
    buildGame({
      cards: [
        { key: "src", def: withAbility("Src", ability), owner: P1 },
        { key: "other", def: character({ name: "Other", life: 5 }), owner: P2 },
        ...resources(3),
        ...extra
      ]
    });
  const target = { id: "t", selector: { type: "character" }, count: 1 };
  const dmg = [{ type: "dealDamage", target: sel("t"), amount: 1 }];

  test("'Destroy this card. Pick a character' cannot pick the card just destroyed", () => {
    const { engine, id } = board({ costs: [{ type: "destroy", target: "source" }, { type: "pick", declarationId: "t" }], targets: [target], effects: dmg });
    assert.throws(() => activate(engine, id("src"), { selected: { t: [id("src")] } }), /Illegal target/);
    assert.equal(zone(engine, id("src")), "play", "a refused activation destroyed nothing");
    activate(engine, id("src"), { selected: { t: [id("other")] } });
    assert.equal(zone(engine, id("src")), "discard", "the cost was paid at activation, before any response");
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("other")].damage, 1);
  });

  test("without a `pick` step the pick is judged first (legacy order): 'Pick a character. Destroy this card' may pick this card", () => {
    const { engine, id } = board({ costs: [{ type: "destroy", target: "source" }], targets: [target], effects: dmg });
    activate(engine, id("src"), { selected: { t: [id("src")] } });
    assert.equal(zone(engine, id("src")), "discard");
  });

  test("'Deplete this card. Pick a depleted character' can pick this card, which the deplete just made legal", () => {
    const depleted = { id: "v", selector: { type: "character", depleted: true }, count: 1 };
    const { engine, id } = board({ costs: [{ type: "deplete", target: "source" }, { type: "pick", declarationId: "v" }], targets: [depleted], effects: [{ type: "dealDamage", target: sel("v"), amount: 1 }] });
    activate(engine, id("src"), { selected: { v: [id("src")] } });
    assert.equal(engine.state.cards[id("src")].depleted, true);
    assert.deepEqual(engine.getPickCandidates({ type: "activateAbility", playerId: P1, cardId: id("src"), abilityId: "go" }, "v"), [id("src")], "the UI is offered the card that only becomes legal after the cost");
  });

  test("getPickCandidates offers the pick as the cost order leaves the board", () => {
    const { engine, id } = board({ costs: [{ type: "destroy", target: "source" }, { type: "pick", declarationId: "t" }], targets: [target], effects: dmg });
    const offered = engine.getPickCandidates({ type: "activateAbility", playerId: P1, cardId: id("src"), abilityId: "go" }, "t");
    assert.deepEqual(offered, [id("other")], "the card the cost destroys is not offered");
  });

  test("a used-from-the-discard ability that removes itself first cannot pick itself ('Remove this card from the game. Pick a tactic in your discard pile')", () => {
    const rouse = tactic({
      name: "Rouse",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            activationZone: "discard",
            costs: [{ type: "removeFromGame", target: "source" }, { type: "pick", declarationId: "t" }],
            targets: [{ id: "t", selector: { type: "tactic", zone: "discard", owner: "self" }, count: 1 }],
            effects: [{ type: "moveCard", target: sel("t"), to: "deck", position: "top" }]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "rouse", def: rouse, owner: P1, zone: "discard" },
        { key: "t2", def: tactic({ name: "Other" }), owner: P1, zone: "discard" }
      ]
    });
    assert.throws(() => activate(engine, id("rouse"), { selected: { t: [id("rouse")] } }), /Illegal target/);
    activate(engine, id("rouse"), { selected: { t: [id("t2")] } });
    assert.equal(zone(engine, id("rouse")), "removed");
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("t2")), "deck");
  });
});

describe("E3a — X printed in the COST is locked when the cost is paid (Q8)", () => {
  test("bindVariable fixes X at play time: a response that pumps the picked character does not change it", () => {
    const bribe = tactic({
      name: "Bribe",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
            costs: [{ type: "bindVariable", id: "x", value: { type: "stat", target: sel("c"), stat: "strength" } }],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: { type: "variable", id: "x" } }]
          }
        ]
      } as never
    });
    const pump = tactic({
      name: "Pump",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "createModifier", target: sel("t"), stat: "strength", operation: "add", value: 5, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bribe", def: bribe, owner: P1, zone: "hand" },
        { key: "pump", def: pump, owner: P2, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", strength: 2, life: 9 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    playCard(engine, P1, id("bribe"), { selected: { c: [id("victim")] } });
    assert.equal(engine.state.responseStack[0].context.variables?.x, 2, "X is already known while the opponent decides whether to respond");
    playCard(engine, P2, id("pump"), { selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("victim"), "strength"), 7, "the response did pump the character");
    assert.equal(engine.state.players[P2].influence - before, 2, "but X stayed 2");
  });

  test("a client cannot overwrite a bound X by passing variables", () => {
    const bribe = tactic({
      name: "Bribe",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
            costs: [{ type: "bindVariable", id: "x", value: { type: "stat", target: sel("c"), stat: "strength" } }],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: { type: "variable", id: "x" } }]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bribe", def: bribe, owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", strength: 2, life: 9 }), owner: P2 }
      ]
    });
    playCard(engine, P1, id("bribe"), { selected: { c: [id("victim")] }, variables: { x: 99 } });
    assert.equal(engine.state.responseStack[0].context.variables?.x, 2);
  });
});

describe("E3a — effects as cost steps (coin, reveal, token, draw)", () => {
  test("a coin flipped as a cost is flipped when the card is played, and X is fixed by it", () => {
    const raid = tactic({
      name: "Raid",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            costs: [
              {
                type: "effects",
                effects: [
                  {
                    type: "flipCoin",
                    player: "controller",
                    winEffects: [{ type: "bind", id: "x", value: 2 }],
                    loseEffects: [{ type: "bind", id: "x", value: 1 }]
                  }
                ]
              }
            ],
            effects: [{ type: "draw", player: "controller", amount: { type: "variable", id: "x" } }]
          }
        ]
      } as never
    });
    const deck = (n: number): CardPlacement[] => Array.from({ length: n }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }));
    for (const [random, expected] of [[() => 0.1, 2], [() => 0.9, 1]] as const) {
      const { engine, id } = buildGame({ random, cards: [{ key: "raid", def: raid, owner: P1, zone: "hand" }, ...deck(4)] });
      playCard(engine, P1, id("raid"));
      const flips = engine.getLog().filter(entry => entry.event?.type === "coinFlipped");
      assert.equal(flips.length, 1, "the flip happened at play time, before any response");
      assert.equal(engine.state.responseStack[0].context.variables?.x, expected);
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, expected, "X cards drawn");
    }
  });

  test("a token put on this card as a cost is there before the opponent can respond, and stays if the ability is terminated", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: withAbility("Src", { costs: [{ type: "effects", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }, { type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, id("src"));
    assert.equal(engine.state.cards[id("src")].counters?.token, 1, "the token is already on the card");
    assert.equal(engine.state.players[P1].hand.length, 0, "the draw waits for resolution");
  });

  test("a reveal is a cost: it is logged when the card is played", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: withAbility("Src", { targets: [{ id: "rev", selector: { controller: "self", zone: "play", type: "character", faceDown: true }, count: 1 }], costs: [{ type: "effects", effects: [{ type: "revealCards", selected: "rev" }] }] }), owner: P1 },
        { key: "fd", def: character({ name: "Hidden" }), owner: P1, faceDown: true }
      ]
    });
    activate(engine, id("src"), { selected: { rev: [id("fd")] } });
    assert.equal(engine.getLog().filter(entry => entry.event?.type === "cardsRevealed").length, 1);
  });

  test("a cost step cannot ask a question: an effect that opens a prompt makes the play illegal and changes nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: withAbility("Src", { costs: [{ type: "deplete", target: "source" }, { type: "effects", effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "a", effects: [] }, { label: "b", effects: [] }] }] }] }), owner: P1 }
      ]
    });
    assert.throws(() => activate(engine, id("src")));
    assert.equal(engine.state.cards[id("src")].depleted, false, "nothing was paid");
    assert.equal(engine.state.pendingChoice, undefined);
  });
});

describe("E3a — the numeric cost is paid last (SYS-23)", () => {
  const siege = (resourcesCount: number) =>
    buildGame({
      cards: [
        {
          key: "ram",
          def: withAbility("Ram", {
            costs: [{ type: "payResources", amount: 2 }, { type: "destroy", target: { type: "random", selector: { type: "resource", controller: "self" } } }],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
          }),
          owner: P1
        },
        ...resources(resourcesCount)
      ]
    });

  test("a resource destroyed by another cost cannot also pay the numeric cost: 'Pay 2. Destroy a resource' needs 3", () => {
    const two = siege(2);
    assert.throws(() => activate(two.engine, two.id("ram")), /Ability costs cannot be paid/);
    assert.equal(ready(two.engine), 2, "nothing was paid");
    const three = siege(3);
    activate(three.engine, three.id("ram"));
    // "Destroy a resource you control": the payer chooses which one (a prompt before anything is paid).
    const pc = three.engine.state.pendingChoice;
    assert.equal(pc?.kind, "chooserSelectsTarget");
    const choice = three.engine.targetCandidates(pc.declaration.selector, pc.context, P1)[0];
    three.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [choice.id] } } as never);
    resolvePendingResponses(three.engine);
    assert.equal(ready(three.engine), 0, "one destroyed, two paid");
  });
});

describe("E3a — nameValue: a name given as part of the cost", () => {
  const diva = () =>
    buildGame({
      cards: [
        { key: "src", def: withAbility("Diva", { costs: [{ type: "payResources", amount: 2 }, { type: "nameValue", valueKind: "cardName", storeAs: "named" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...resources(2)
      ]
    });

  test("the prompt comes at activation, nothing is paid while it is open, and answering pays everything and uses the ability", () => {
    const { engine, id } = diva();
    activate(engine, id("src"));
    const pc = engine.state.pendingChoice;
    assert.equal(pc?.kind, "nameValue");
    assert.equal(pc.playerId, P1);
    assert.ok("resumeAction" in pc && pc.resumeAction, "answering re-runs the activation");
    assert.equal(ready(engine), 2, "nothing is paid while the name is still to be given");
    assert.equal(engine.state.responseWindow, undefined, "the opponent has no window yet");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "Target" } } as never);
    assert.equal(ready(engine), 0, "now it is paid");
    assert.equal(engine.state.cards[id("src")].namedValues?.named, "Target");
    assert.ok(engine.state.responseWindow, "and the opponent may respond");
  });

  test("the name may be supplied with the action (`named`): no prompt", () => {
    const { engine, id } = diva();
    activate(engine, id("src"), { named: { named: "Target" } });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(ready(engine), 0);
  });

  test("an unaffordable ability is refused before it asks for a name", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "src", def: withAbility("Diva", { costs: [{ type: "payResources", amount: 2 }, { type: "nameValue", valueKind: "cardName", storeAs: "named" }] }), owner: P1 }, ...resources(1)]
    });
    assert.throws(() => activate(engine, id("src")));
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("a refused name (an icon that is not an icon) leaves the prompt open", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "src", def: withAbility("Clock", { costs: [{ type: "nameValue", valueKind: "resourceIcon", storeAs: "x" }] }), owner: P1 }]
    });
    activate(engine, id("src"));
    assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "banana" } } as never));
    assert.equal(engine.state.pendingChoice?.kind, "nameValue", "still asking");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "greed" } } as never);
    assert.equal(engine.state.pendingChoice, undefined);
  });
});

describe("E3a — atomic plays and Being Deployed", () => {
  test("a play that fails on a later step changes nothing, however many earlier steps could have been paid", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: withAbility("Src", { costs: [{ type: "effects", effects: [{ type: "draw", player: "controller", amount: 1 }] }, { type: "deplete", target: "source" }, { type: "payResources", amount: 5 }] }), owner: P1 },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
        ...resources(1)
      ]
    });
    assert.throws(() => activate(engine, id("src")));
    assert.equal(engine.state.players[P1].hand.length, 0, "no card was drawn");
    assert.equal(engine.state.cards[id("src")].depleted, false, "not depleted");
    assert.equal(ready(engine), 1, "nothing paid");
  });

  test("the card being played cannot discard itself to pay its own cost (it is Being Deployed, not in the hand)", () => {
    const doyen = character({
      name: "Doyen",
      cost: 0,
      behavior: {
        onPlay: {
          targets: [{ id: "d", selector: { owner: "self", zone: "hand" }, count: 1 }],
          costs: [{ type: "sacrificeSelected", declarationId: "d", disposition: "discard" }, { type: "bindVariable", id: "x", value: { type: "cardCost", target: sel("d") } }],
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }]
        }
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "doyen", def: doyen, owner: P1, zone: "hand" },
        { key: "fodder", def: character({ name: "Fodder", cost: 3 }), owner: P1, zone: "hand" }
      ]
    });
    assert.throws(() => playCard(engine, P1, id("doyen"), { selected: { d: [id("doyen")] } }), /Illegal target/);
    assert.equal(zone(engine, id("doyen")), "hand");
    playCard(engine, P1, id("doyen"), { selected: { d: [id("fodder")] } });
    assert.equal(zone(engine, id("fodder")), "discard", "discarded when played, before any response");
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("doyen")].counters?.token, 3, "X was the discarded card's cost");
  });
});

describe("E3a — a choice among labelled cost branches", () => {
  test("oneOf with labels asks the payer, and the branch's bindVariable fixes the choice", () => {
    const types = ["character", "item"];
    const { engine, id } = buildGame({
      cards: [
        {
          key: "src",
          def: withAbility("Gambler", {
            costs: [{ type: "oneOf", labels: types, options: types.map((_, i) => [{ type: "bindVariable", id: "t", value: i }]) }],
            effects: [{ type: "draw", player: "controller", amount: { type: "variable", id: "t" } }]
          }),
          owner: P1
        },
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, id("src"));
    const pc = engine.state.pendingChoice;
    assert.equal(pc?.kind, "chooserSelectsOption");
    assert.deepEqual((pc.options as Array<{ label: string }>).map(o => o.label), types);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
    assert.equal(engine.state.responseStack[0].context.variables?.t, 1);
  });
});
