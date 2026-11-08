// An item that resolves after the card it picked has gone: CR 402.5a (an effect never "fizzles" because
// the thing it was trying to affect left play), CR 409.3 / 409.2 (a token that leaves play disappears),
// CR 507.2c (an ATTACH TO card whose target is no longer in play when it tries to enter play goes to its
// owner's discard pile), CR 507.2e (a host that stops being the right type destroys the attached card).
//
// Found by the random-play driver: slot 42 / seed 4205 (Storm the Gates picked a token that was
// sacrificed in response, with Tri-Pole Magnet's attach below it on the stack).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  tactic,
  resolvePendingResponses,
  P1,
  P2
} from "../support/fixtures.js";
import {
  ELIGIBLE_FACTIONS,
  SET_NAMES,
  playRandomGame,
  randomSetup,
  type GameSetupInputs
} from "../support/driver.js";
import type { CardDefinition, Effect, CardInstanceId } from "../../../engine.js";

type Built = ReturnType<typeof buildGame>;

const PICK = { type: "selected", id: "t" } as const;

/** A free tactic with one picked in-play character (declaration `t`) that runs `effects`. */
function pickTactic(name: string, effects: Effect[]): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects
        }
      ]
    }
  });
}

const killer = () => pickTactic("Kill", [{ type: "destroy", target: PICK }]);
const bouncer = () => pickTactic("Bounce", [{ type: "moveCard", target: PICK, to: "hand" }]);
const flipper = () => pickTactic("Flip", [{ type: "flipFaceDown", target: PICK }]);
const grabber = () => pickTactic("Grab", [{ type: "takeControl", target: PICK, controller: "controller" }]);

const gear = () => item({ name: "Gear", cost: 0, attachTo: "character" });

/** P2 answers P1's play with `response` aimed at `at`, then everything resolves. */
function respond(engine: Built["engine"], response: CardInstanceId, at: CardInstanceId): void {
  engine.perform({
    type: "playCard",
    playerId: P2,
    cardId: response,
    selected: { t: [at] },
    variables: {}
  } as never);
  resolvePendingResponses(engine);
}

function playFromHand(engine: Built["engine"], cardId: CardInstanceId, selected: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "playCard", playerId: P1, cardId, selected, variables: {} } as never);
}

/** The game is back in ordinary turn flow with the acting player able to act. */
function assertFlowContinues(engine: Built["engine"]): void {
  assert.equal(engine.state.responseWindow, undefined, "the response window closed");
  assert.equal(engine.state.responseStack.length, 0, "the stack is empty");
  assert.equal(engine.state.pendingChoice, undefined, "no choice is left open");
  const flow = engine.getFlowView();
  assert.equal(flow.mode, "main");
  assert.equal(flow.actingPlayerId, P1);
  assert.deepEqual(engine.checkAction({ type: "endTurn", playerId: P1 } as never), { ok: true });
}

describe("an ATTACH TO card whose host is gone when it resolves (CR 507.2c)", () => {
  function board(hostKey: "token" | "card", response: () => CardDefinition) {
    const built = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
        { key: "gear", def: gear(), owner: P1, zone: "hand" },
        { key: "resp", def: response(), owner: P2, zone: "hand" }
      ]
    });
    if (hostKey === "token") built.engine.state.cards[built.id("host")].isToken = true;
    return built;
  }

  test("a token host destroyed in response: the gear goes to its owner's discard pile and the game continues", () => {
    const { engine, id } = board("token", killer);
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")], undefined, "the token ceased to exist");
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].attachedTo, undefined);
    assert.ok(engine.state.players[P1].discard.includes(id("gear")));
    assertFlowContinues(engine);
  });

  test("a token host bounced in response ceases to exist too: the gear goes to the discard pile", () => {
    const { engine, id } = board("token", bouncer);
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")], undefined);
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assertFlowContinues(engine);
  });

  test("a non-token host destroyed in response: the gear goes to the discard pile (not destroyed, not in play)", () => {
    const { engine, id } = board("card", killer);
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].attachedTo, undefined);
    assertFlowContinues(engine);
  });

  test("a non-token host returned to hand in response: the gear goes to the discard pile", () => {
    const { engine, id } = board("card", bouncer);
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")].zone, "hand");
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assertFlowContinues(engine);
  });

  test("control: a host that survives the response keeps the gear attached in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
        { key: "gear", def: gear(), owner: P1, zone: "hand" },
        { key: "resp", def: killer(), owner: P2, zone: "hand" }
      ]
    });
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("bystander"));

    assert.equal(engine.state.cards[id("bystander")].zone, "discard");
    assert.equal(engine.state.cards[id("host")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
    assertFlowContinues(engine);
  });

  test("a host that changes controller in response is still a host: the gear enters attached to it", () => {
    const built = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "gear", def: gear(), owner: P1, zone: "hand" },
        { key: "resp", def: grabber(), owner: P2, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")].controllerId, P2);
    assert.equal(engine.state.cards[id("gear")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
    assertFlowContinues(engine);
  });

  test("a host that is still in play but no longer a character is the wrong type: the gear is destroyed (CR 507.2e)", () => {
    const { engine, id } = board("card", flipper);
    playFromHand(engine, id("gear"), { attachTo: [id("host")] });
    respond(engine, id("resp"), id("host"));

    assert.equal(engine.state.cards[id("host")].zone, "play");
    assert.equal(engine.state.cards[id("host")].faceDown, true);
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].attachedTo, undefined);
    assertFlowContinues(engine);
  });
});

describe("an effect whose picked card ceased to exist before it resolved is carried out as far as possible (CR 402.5a)", () => {
  const effects: Array<[string, Effect]> = [
    ["dealDamage", { type: "dealDamage", target: PICK, amount: 2 }],
    ["deplete", { type: "deplete", target: PICK }],
    ["restore", { type: "restore", target: PICK }],
    ["addCounter", { type: "addCounter", target: PICK, counter: "x", amount: 1 }],
    ["removeCounter", { type: "removeCounter", target: PICK, counter: "x", amount: 1 }],
    ["takeControl", { type: "takeControl", target: PICK, controller: "controller" }],
    ["moveCard", { type: "moveCard", target: PICK, to: "hand" }],
    ["grantKeyword", { type: "grantKeyword", target: PICK, keyword: "aggro", duration: { type: "untilEndOfTurn" } }],
    ["createModifier", { type: "createModifier", target: PICK, stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }],
    ["destroy", { type: "destroy", target: PICK }]
  ];

  for (const [name, effect] of effects) {
    test(`${name} on a token sacrificed in response does nothing, and the game continues`, () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "token", def: character({ name: "Token" }), owner: P2, zone: "play" },
          { key: "spell", def: pickTactic("Spell", [effect]), owner: P1, zone: "hand" },
          { key: "resp", def: killer(), owner: P2, zone: "hand" }
        ]
      });
      engine.state.cards[id("token")].isToken = true;

      playFromHand(engine, id("spell"), { t: [id("token")] });
      respond(engine, id("resp"), id("token"));

      assert.equal(engine.state.cards[id("token")], undefined);
      assert.equal(engine.state.cards[id("spell")].zone, "discard");
      assertFlowContinues(engine);
    });
  }

  test("Storm the Gates shape: a damage tactic over a gear attach, both aimed at one token that is removed in response", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "token", def: character({ name: "Token" }), owner: P2, zone: "play" },
        { key: "gear", def: gear(), owner: P2, zone: "hand" },
        { key: "burn", def: pickTactic("Burn", [{ type: "dealDamage", target: PICK, amount: 5 }]), owner: P1, zone: "hand" },
        { key: "resp", def: killer(), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    engine.state.cards[id("token")].isToken = true;

    engine.perform({ type: "playCard", playerId: P2, cardId: id("gear"), selected: { attachTo: [id("token")] }, variables: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("burn"), selected: { t: [id("token")] }, variables: {} } as never);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("resp"), selected: { t: [id("token")] }, variables: {} } as never);
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("token")], undefined);
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assert.equal(engine.state.cards[id("burn")].zone, "discard");
    assert.equal(engine.state.responseWindow, undefined);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.getFlowView().mode, "main");
    assert.equal(engine.getFlowView().actingPlayerId, P2);
  });
});

describe("an effect that puts a gear card into play attached to a picked host whose host is gone (Tri-Pole Magnet's GRAPPLE)", () => {
  test("a token host removed in response: the gear card goes to its owner's discard pile", () => {
    const grapple = tactic({
      name: "Grapple",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [
              { id: "t", selector: { zone: "play", type: "character" }, count: 1 },
              { id: "g", selector: { owner: "self", zone: "discard", subtype: "gear" }, count: 1 }
            ],
            effects: [
              {
                type: "putIntoPlay",
                target: { type: "selected", id: "g" },
                controller: "controller",
                attachTo: PICK
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "token", def: character({ name: "Token" }), owner: P2, zone: "play" },
        { key: "gear", def: item({ name: "Gear", cost: 0, subtype: ["gear"], attachTo: "character" }), owner: P1, zone: "discard" },
        { key: "grapple", def: grapple, owner: P1, zone: "hand" },
        { key: "resp", def: killer(), owner: P2, zone: "hand" }
      ]
    });
    engine.state.cards[id("token")].isToken = true;

    playFromHand(engine, id("grapple"), { t: [id("token")], g: [id("gear")] });
    respond(engine, id("resp"), id("token"));

    assert.equal(engine.state.cards[id("token")], undefined);
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].attachedTo, undefined);
    assertFlowContinues(engine);
  });
});

describe("random-play driver finding: slot 42 / seed 4205", () => {
  test("the game no longer ends in a finding", () => {
    const slot = 42;
    const seed = 4205;
    const nf = ELIGIBLE_FACTIONS.length;
    const ns = SET_NAMES.length;
    const setup: GameSetupInputs = JSON.parse(
      JSON.stringify(
        randomSetup(seed, {
          factions: [ELIGIBLE_FACTIONS[slot % nf], ELIGIBLE_FACTIONS[(slot + 13 + Math.floor(slot / nf)) % nf]],
          featuredSets: [SET_NAMES[slot % ns], SET_NAMES[(slot * 5 + 3 + Math.floor(slot / ns)) % ns]]
        })
      )
    );
    const result = playRandomGame(setup, Math.imul(seed, 2654435761) >>> 0, { maxActions: 450 });
    assert.notEqual(result.status, "finding", JSON.stringify(result.finding));
  });
});
