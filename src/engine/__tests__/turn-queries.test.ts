// Read-only queries for clients: getFlipUpPlayability, getAttackOptions,
// getBlockOptions, getEndTurnBlock. Each test is an AGREEMENT test: the query's
// answer is compared with what perform() does with the same action on a probe
// clone of the game (real catalog cards where the audit names them).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SpoilsEngine } from "../../engine.js";
import type { AttackTarget, CardInstanceId, GameAction, PlayerId } from "../../engine.js";
import { P1, P2, bank, buildGame, cardDef, character, resolvePendingResponses } from "./per-card/_harness.js";
import { autoResolveBattle } from "./support/fixtures.js";

/** A throw-away copy of the game: the probe perform() is tried on. */
function probe(engine: SpoilsEngine): SpoilsEngine {
  return new SpoilsEngine(Object.values(engine.definitions), structuredClone(engine.state), () => 0.5);
}

/** What perform() says to `action` on a probe clone: the refusal message, or `undefined` when it goes through. */
function refusal(engine: SpoilsEngine, action: GameAction): string | undefined {
  try {
    probe(engine).perform(action);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const faction = (playerId: PlayerId) => ({ type: "faction" as const, playerId });
const attackAction = (playerId: PlayerId, attackerIds: CardInstanceId[], target: AttackTarget): GameAction => ({
  type: "declareAttack",
  playerId,
  attackerIds,
  target
});

/** Spent (attached to the faction) resources still count toward thresholds but cannot pay. */
const spent = (icon: "greed" | "rage", n: number, owner: PlayerId = P1) =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

// ---------------------------------------------------------------------------
// getFlipUpPlayability
// ---------------------------------------------------------------------------

describe("getFlipUpPlayability agrees with perform({type: 'flipUp'})", () => {
  const rejections = () => cardDef("Seed", "Department of Rejections"); // FLIP UP: 1 [G]
  const overseer = () => cardDef("Ungodly Mess", "Foreclosure Overseer"); // while depleted, opponents pay 1 more to deploy
  const retire = () => cardDef("Shade of the Devoured Emperor", "Time to Retire"); // FLIP UP: 2 [V]
  const foment = () => cardDef("Seed 2", "Foment"); // FLIP UP: 1 [O][O] and play a resource

  /** A flipUp action; `selected` supplies the card's own EXTRA COST picks (the query does not cover those). */
  const flip = (
    playerId: PlayerId,
    cardId: CardInstanceId,
    flipUpOption?: number,
    selected?: Record<string, CardInstanceId[]>
  ): GameAction => ({
    type: "flipUp",
    playerId,
    cardId,
    ...(flipUpOption === undefined ? {} : { flipUpOption }),
    ...(selected ? { selected } : {})
  });
  const chum = { key: "ch", def: character({ name: "Chum" }), owner: P1, zone: "play" as const };

  test("a plain flip is playable, and the flipped card may pay for itself", () => {
    // The only greed is spent (it meets the threshold but cannot pay): the face-down card is the whole pool.
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1)
      ]
    });
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.deepEqual(q, {
      playable: true,
      legalTiming: true,
      thresholdMet: true,
      numericCost: 1,
      availableResources: 1,
      optionIndex: 0
    });
    assert.equal(refusal(engine, flip(P1, id("fd"))), undefined);

    engine.perform(flip(P1, id("fd")));
    assert.equal(engine.state.cards[id("fd")].faceDown, false);
  });

  test("under a cost-raising effect the cost goes up and the same flip is refused", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1),
        { key: "overseer", def: overseer(), owner: P2, zone: "play", depleted: true }
      ]
    });
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(q.numericCost, 2, "FLIP UP 1 + the Overseer's 1");
    assert.equal(q.availableResources, 1);
    assert.equal(q.playable, false);
    assert.equal(q.blockedBy, "cost");
    assert.match(refusal(engine, flip(P1, id("fd"))) ?? "", /cannot be paid/);

    // The effect ends (the Overseer is restored): back to cost 1, playable, accepted.
    engine.state.cards[id("overseer")].depleted = false;
    const after = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(after.numericCost, 1);
    assert.equal(after.playable, true);
    assert.equal(refusal(engine, flip(P1, id("fd"))), undefined);
  });

  test("a cost-raising effect still leaves a flip payable when the pool covers it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1),
        ...bank("rage", 1, P1),
        { key: "overseer", def: overseer(), owner: P2, zone: "play", depleted: true }
      ]
    });
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(q.numericCost, 2);
    assert.equal(q.availableResources, 2, "the rage resource plus the flipped card itself");
    assert.equal(q.playable, true);
    assert.equal(refusal(engine, flip(P1, id("fd"))), undefined);
  });

  test("a threshold met only by the flipped card's own icons is refused", () => {
    // Time to Retire needs [V]. A face-down resource provides Volition, but the flipped card's own does not count.
    const lonely = buildGame({
      cards: [
        { key: "fd", def: retire(), owner: P1, zone: "play", faceDown: true },
        chum,
        ...bank("rage", 3, P1)
      ]
    });
    const q = lonely.engine.getFlipUpPlayability(P1, lonely.id("fd"));
    assert.equal(q.thresholdMet, false);
    assert.equal(q.playable, false);
    assert.equal(q.blockedBy, "threshold");
    assert.equal(
      refusal(lonely.engine, flip(P1, lonely.id("fd"), undefined, { ch: [lonely.id("ch")] })),
      "FLIP UP threshold requirements are not met."
    );

    // Another face-down resource supplies the Volition: met, and playable.
    const helped = buildGame({
      cards: [
        { key: "fd", def: retire(), owner: P1, zone: "play", faceDown: true },
        { key: "other", def: { ...bank("rage", 1, P1)[0].def }, owner: P1, zone: "play", faceDown: true },
        chum,
        ...bank("rage", 3, P1)
      ]
    });
    const ok = helped.engine.getFlipUpPlayability(P1, helped.id("fd"));
    assert.equal(ok.thresholdMet, true);
    assert.equal(ok.playable, true);
    assert.equal(refusal(helped.engine, flip(P1, helped.id("fd"), undefined, { ch: [helped.id("ch")] })), undefined);
  });

  test("the flipped card pays for itself: the pool is exactly the cost", () => {
    // Cost 2: one other (face-down, Volition) resource + the flipped card. Nothing else is available.
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: retire(), owner: P1, zone: "play", faceDown: true },
        { key: "other", def: { ...bank("rage", 1, P1)[0].def }, owner: P1, zone: "play", faceDown: true },
        chum
      ]
    });
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(q.numericCost, 2);
    assert.equal(q.availableResources, 2);
    assert.equal(q.playable, true);
    const picks = { ch: [id("ch")] };
    assert.equal(refusal(engine, flip(P1, id("fd"), undefined, picks)), undefined);
    engine.perform(flip(P1, id("fd"), undefined, picks));
    assert.equal(engine.state.cards[id("fd")].faceDown, false);

    // Once the card is spent (attached) it cannot help pay any more.
    const short = buildGame({
      cards: [
        { key: "fd", def: retire(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
        { key: "other", def: { ...bank("rage", 1, P1)[0].def }, owner: P1, zone: "play", faceDown: true },
        chum
      ]
    });
    const s = short.engine.getFlipUpPlayability(P1, short.id("fd"));
    assert.equal(s.availableResources, 1);
    assert.equal(s.playable, false);
    assert.equal(s.blockedBy, "cost");
    assert.match(refusal(short.engine, flip(P1, short.id("fd"), undefined, { ch: [short.id("ch")] })) ?? "", /cannot be paid/);
  });

  test("timing: only the active player, and not during a battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1),
        { key: "opp", def: rejections(), owner: P2, zone: "play", faceDown: true },
        ...spent("greed", 1, P2),
        { key: "atk", def: character({ name: "Attacker" }), owner: P1 }
      ]
    });
    assert.equal(engine.getFlipUpPlayability(P2, id("opp")).blockedBy, "timing");
    assert.ok(refusal(engine, flip(P2, id("opp"))), "the inactive player cannot flip");
    assert.equal(engine.getFlipUpPlayability(P2, id("opp")).legalTiming, false);

    engine.perform(attackAction(P1, [id("atk")], faction(P2)));
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(q.legalTiming, false);
    assert.equal(q.blockedBy, "timing");
    assert.ok(refusal(engine, flip(P1, id("fd"))));
  });

  test("a FLIP UP ban refuses it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1)
      ]
    });
    engine.state.playRestrictions.push({
      id: "ban-1",
      playerId: P1,
      kind: "flipUp",
      duration: { type: "untilEndOfTurn" },
      createdTurn: engine.state.turn
    } as never);
    const q = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(q.blockedBy, "restriction");
    assert.equal(q.playable, false);
    assert.equal(refusal(engine, flip(P1, id("fd"))), "You cannot play cards using FLIP UP right now.");
  });

  test("a rider that plays a card from hand needs a card in hand", () => {
    const board = (hand: boolean) =>
      buildGame({
        cards: [
          { key: "fd", def: foment(), owner: P1, zone: "play", faceDown: true },
          ...bank("obsession", 3, P1).map((placement, i) => ({ ...placement, key: "ob" + i })),
          ...(hand ? [{ ...bank("rage", 1, P1)[0], key: "handcard", zone: "hand" as const }] : [])
        ]
      });
    const empty = board(false);
    const q = empty.engine.getFlipUpPlayability(P1, empty.id("fd"));
    assert.equal(q.thresholdMet, true);
    assert.equal(q.playable, false);
    assert.equal(q.blockedBy, "riderCard");
    assert.match(refusal(empty.engine, flip(P1, empty.id("fd"), undefined, { res: [empty.id("ob0")] })) ?? "", /no card in your hand/);

    const full = board(true);
    const ok = full.engine.getFlipUpPlayability(P1, full.id("fd"));
    assert.equal(ok.playable, true);
    // The probe stops at the rider's pick (a pending choice), it is not refused.
    assert.equal(refusal(full.engine, flip(P1, full.id("fd"), undefined, { res: [full.id("ob0")] })), undefined);
  });

  test("not a face-down card you control, and no FLIP UP at all", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "up", def: rejections(), owner: P1, zone: "play" },
        { key: "plain", def: { ...bank("rage", 1, P1)[0].def, id: "plain-fd", name: "Plain" }, owner: P1, zone: "play", faceDown: true },
        { key: "theirs", def: rejections(), owner: P2, zone: "play", faceDown: true },
        ...bank("rage", 2, P1)
      ]
    });
    assert.equal(engine.getFlipUpPlayability(P1, id("up")).blockedBy, "notFaceDown");
    assert.ok(refusal(engine, flip(P1, id("up"))));
    assert.equal(engine.getFlipUpPlayability(P1, id("theirs")).blockedBy, "notFaceDown");
    assert.ok(refusal(engine, flip(P1, id("theirs"))));
    assert.equal(engine.getFlipUpPlayability(P1, id("plain")).blockedBy, "noFlipUp");
    assert.ok(refusal(engine, flip(P1, id("plain"))));
  });

  test("a named option that does not exist is reported, not thrown", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1)
      ]
    });
    const q = engine.getFlipUpPlayability(P1, id("fd"), 3);
    assert.equal(q.blockedBy, "noFlipUp");
    assert.match(q.reason ?? "", /Unknown FLIP UP option 3/);
    assert.match(refusal(engine, flip(P1, id("fd"), 3)) ?? "", /Unknown FLIP UP option 3/);
    assert.equal(engine.getFlipUpPlayability(P1, id("fd"), 0).playable, true);
  });

  test("the query leaves the game untouched", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: rejections(), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1),
        { key: "overseer", def: overseer(), owner: P2, zone: "play", depleted: true }
      ]
    });
    const before = JSON.stringify(engine.state);
    engine.getFlipUpPlayability(P1, id("fd"));
    engine.getFlipUpPlayability(P1, id("fd"), 0);
    assert.equal(JSON.stringify(engine.state), before);
  });
});

// ---------------------------------------------------------------------------
// getAttackOptions / getEndTurnBlock
// ---------------------------------------------------------------------------

describe("getAttackOptions agrees with perform({type: 'declareAttack'})", () => {
  /** Every character in P1's play: is it a listed attacker, and does a declaration of it (with the must-attackers) go through? */
  function assertAttackersAgree(engine: SpoilsEngine, ids: CardInstanceId[]): void {
    const options = engine.getAttackOptions(P1);
    for (const attackerId of ids) {
      const party = [...new Set([...options.mustAttack, attackerId])];
      const accepted = refusal(engine, attackAction(P1, party, faction(P2))) === undefined;
      assert.equal(
        options.attackers.includes(attackerId),
        accepted,
        `${engine.getDefinition(attackerId).name}: listed=${options.attackers.includes(attackerId)} accepted=${accepted}`
      );
    }
  }

  test("a summoning-sick character is not an attacker", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ready", def: character({ name: "Ready" }), owner: P1 },
        { key: "sick", def: character({ name: "Sick" }), owner: P1, attackEligible: false }
      ]
    });
    const options = engine.getAttackOptions(P1);
    assert.deepEqual(options.attackers, [id("ready")]);
    assert.deepEqual(options.mustAttack, []);
    assert.equal(options.blockedReason, undefined);
    assert.match(refusal(engine, attackAction(P1, [id("sick")], faction(P2))) ?? "", /did not start the turn in play/);
    assertAttackersAgree(engine, [id("ready"), id("sick")]);
  });

  test("a depleted character and one with cannotAttack are left out", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ready", def: character({ name: "Ready" }), owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, depleted: true },
        { key: "pacifist", def: character({ name: "Pacifist" }), owner: P1 }
      ]
    });
    engine.state.restrictions.push({ id: "r1", targetId: id("pacifist"), restriction: "cannotAttack", duration: { type: "untilEndOfTurn" }, createdTurn: 1 } as never);
    const options = engine.getAttackOptions(P1);
    assert.deepEqual(options.attackers, [id("ready")]);
    assertAttackersAgree(engine, [id("ready"), id("tired"), id("pacifist")]);
  });

  test("a once-per-turn attacker (The Garbageman) is out once it has attacked", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "garbageman", def: cardDef("2nd Edition", "The Garbageman"), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1 }
      ]
    });
    assert.deepEqual(engine.getAttackOptions(P1).attackers.sort(), [id("garbageman"), id("other")].sort());

    // It attacked once and was restored (e.g. an effect): still the same turn.
    engine.state.attacksThisTurn[id("garbageman")] = 1;
    const options = engine.getAttackOptions(P1);
    assert.deepEqual(options.attackers, [id("other")]);
    assert.equal(refusal(engine, attackAction(P1, [id("garbageman")], faction(P2))), "This character can attack only once each turn.");
    assertAttackersAgree(engine, [id("garbageman"), id("other")]);
  });

  test("Silent Sentinels: every eligible character must attack, and the turn cannot end first", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sentinels", def: cardDef("Ungodly Mess", "Silent Sentinels"), owner: P1 },
        { key: "buddy", def: character({ name: "Buddy" }), owner: P1 },
        { key: "sick", def: character({ name: "Sick" }), owner: P1, attackEligible: false }
      ]
    });
    const options = engine.getAttackOptions(P1);
    assert.deepEqual([...options.mustAttack].sort(), [id("sentinels"), id("buddy")].sort());
    assert.ok(options.attackers.includes(id("sentinels")));
    assert.ok(!options.attackers.includes(id("sick")));

    // Leaving a must-attacker out is refused; naming all of them is accepted.
    assert.match(refusal(engine, attackAction(P1, [id("buddy")], faction(P2))) ?? "", /must attack if it can and was left out/);
    assert.equal(refusal(engine, attackAction(P1, options.mustAttack, faction(P2))), undefined);
    assertAttackersAgree(engine, [id("sentinels"), id("buddy"), id("sick")]);

    // The turn cannot end while one still can attack: same words as endTurn.
    const block = engine.getEndTurnBlock(P1);
    assert.ok(block);
    assert.match(block, /must attack if it can; the turn cannot end yet/);
    assert.equal(refusal(engine, { type: "endTurn", playerId: P1 }), block);
  });

  test("getEndTurnBlock is undefined exactly when endTurn goes through", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }]
    });
    assert.equal(engine.getEndTurnBlock(P1), undefined);
    assert.equal(refusal(engine, { type: "endTurn", playerId: P1 }), undefined);

    // Not the active player.
    const notYours = engine.getEndTurnBlock(P2);
    assert.equal(notYours, "Only the active player can end the turn.");
    assert.equal(refusal(engine, { type: "endTurn", playerId: P2 }), notYours);

    // During a battle.
    engine.perform(attackAction(P1, [id("a")], faction(P2)));
    const during = engine.getEndTurnBlock(P1);
    assert.ok(during);
    assert.equal(refusal(engine, { type: "endTurn", playerId: P1 }), during);
  });

  test("an attack tax (The Ministry of Other Smaller Ministries) is reported, and an unpayable one blocks", () => {
    const board = (resources: number) =>
      buildGame({
        activePlayerId: P2,
        cards: [
          { key: "ministry", def: cardDef("1st Edition", "The Ministry of Other Smaller Ministries"), owner: P1 },
          { key: "raider", def: character({ name: "Raider" }), owner: P2 },
          ...bank("rage", resources, P2)
        ]
      });

    const poor = board(1);
    const none = poor.engine.getAttackOptions(P2);
    assert.equal(none.tax, 2);
    assert.deepEqual(none.attackers, [poor.id("raider")]);
    assert.equal(none.blockedReason, "You must pay 2 to attack.");
    assert.equal(refusal(poor.engine, attackAction(P2, [poor.id("raider")], faction(P1))), "You must pay 2 to attack.");

    const rich = board(2);
    const ok = rich.engine.getAttackOptions(P2);
    assert.equal(ok.tax, 2);
    assert.equal(ok.blockedReason, undefined);
    assert.equal(refusal(rich.engine, attackAction(P2, [rich.id("raider")], faction(P1))), undefined);
    const before = rich.engine.getAvailableResourceCount(P2);
    rich.engine.perform(attackAction(P2, [rich.id("raider")], faction(P1)));
    assert.equal(before - rich.engine.getAvailableResourceCount(P2), 2, "the tax the query reported is the tax paid");
  });

  test("targets leave out a faction that cannot be attacked (High Court of Demands) but keep locations", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider" }), owner: P1 },
        { key: "court", def: cardDef("Seed", "High Court of Demands"), owner: P2 },
        { key: "fort", def: { ...cardDef("Seed", "High Court of Demands"), id: "fort", name: "Fort", behavior: undefined, text: "" }, owner: P2 }
      ]
    });
    const options = engine.getAttackOptions(P1);
    // (P2's faction: the extra seats at a bigger table have factions that can be attacked)
    assert.deepEqual(options.targets.filter((t) => t.type === "faction" && t.playerId === P2), [], "P2's faction is protected");
    const cardTargets = options.targets.flatMap((t) => (t.type === "card" ? [t.cardId] : []));
    assert.deepEqual(cardTargets.sort(), [id("court"), id("fort")].sort());

    assert.equal(refusal(engine, attackAction(P1, [id("raider")], faction(P2))), "That faction cannot be attacked.");
    for (const cardId of cardTargets) {
      assert.equal(refusal(engine, attackAction(P1, [id("raider")], { type: "card", cardId })), undefined);
    }
    assert.equal(options.blockedReason, undefined);
  });

  test("targets are exactly what perform accepts (own cards and non-locations are never offered)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider" }), owner: P1 },
        { key: "mine", def: { ...cardDef("Seed", "Narrow Passage"), id: "mine-loc" }, owner: P1 },
        { key: "theirs", def: { ...cardDef("Seed", "Narrow Passage"), id: "theirs-loc" }, owner: P2 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P2 }
      ]
    });
    const options = engine.getAttackOptions(P1);
    const candidates = [
      faction(P2),
      faction(P1),
      { type: "card" as const, cardId: id("mine") },
      { type: "card" as const, cardId: id("theirs") },
      { type: "card" as const, cardId: id("bystander") }
    ];
    for (const target of candidates) {
      const accepted = refusal(engine, attackAction(P1, [id("raider")], target)) === undefined;
      const listed = options.targets.some((t) => JSON.stringify(t) === JSON.stringify(target));
      assert.equal(listed, accepted, JSON.stringify(target));
    }
  });

  test("Narrow Passage: after one attack the rest of the turn is blocked, with the engine's words", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "passage", def: cardDef("Seed", "Narrow Passage"), owner: P2 },
        { key: "first", def: character({ name: "First" }), owner: P1 },
        { key: "second", def: character({ name: "Second" }), owner: P1 }
      ]
    });
    assert.equal(engine.getAttackOptions(P1).blockedReason, undefined);

    engine.perform(attackAction(P1, [id("first")], faction(P2)));
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.battle, undefined);

    const options = engine.getAttackOptions(P1);
    assert.deepEqual(options.attackers, []);
    assert.equal(options.blockedReason, "You have already attacked the maximum number of times this turn.");
    assert.equal(refusal(engine, attackAction(P1, [id("second")], faction(P2))), options.blockedReason);
  });

  test("not the active player, or a battle in progress", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }, { key: "b", def: character({ name: "B" }), owner: P2 }]
    });
    const notActive = engine.getAttackOptions(P2);
    assert.equal(notActive.blockedReason, "Only the active player may attack.");
    assert.deepEqual(notActive.attackers, []);
    assert.equal(refusal(engine, attackAction(P2, [id("b")], faction(P1))), notActive.blockedReason);

    engine.perform(attackAction(P1, [id("a")], faction(P2)));
    // A battle waiting in its attackers' response window, then in the blocking step: "Battle already in progress" both times.
    for (const step of ["response window", "blocking"]) {
      const inBattle = engine.getAttackOptions(P1);
      assert.equal(inBattle.blockedReason, "Battle already in progress.", step);
      assert.equal(refusal(engine, attackAction(P1, [id("a")], faction(P2))), inBattle.blockedReason, step);
      resolvePendingResponses(engine);
    }
  });

  test("the query leaves the game untouched", () => {
    const { engine } = buildGame({
      cards: [
        { key: "sentinels", def: cardDef("Ungodly Mess", "Silent Sentinels"), owner: P1 },
        { key: "ministry", def: cardDef("1st Edition", "The Ministry of Other Smaller Ministries"), owner: P2 }
      ]
    });
    const before = JSON.stringify(engine.state);
    engine.getAttackOptions(P1);
    engine.getEndTurnBlock(P1);
    assert.equal(JSON.stringify(engine.state), before);
  });
});

// ---------------------------------------------------------------------------
// getBlockOptions
// ---------------------------------------------------------------------------

describe("getBlockOptions agrees with perform({type: 'declareBlockers'})", () => {
  /** P1 declares `attackerKeys` against P2's faction and the game is driven to the blocking step. */
  function toBlocking(game: ReturnType<typeof buildGame>, attackerKeys: string[]): void {
    game.engine.perform(attackAction(P1, attackerKeys.map((k) => game.id(k)), faction(P2)));
    resolvePendingResponses(game.engine);
    assert.equal(game.engine.state.battle?.phase, "blocking");
  }

  const declare = (blockerIds: CardInstanceId[]): GameAction => ({ type: "declareBlockers", playerId: P2, blockerIds });

  /** Each of P2's characters: listed as a blocker iff declaring it (with the must-blockers) is accepted. */
  function assertBlockersAgree(engine: SpoilsEngine, ids: CardInstanceId[]): void {
    const options = engine.getBlockOptions()!;
    for (const blockerId of ids) {
      const party = [...new Set([...options.mustBlock, blockerId])];
      const accepted = refusal(engine, declare(party)) === undefined;
      assert.equal(
        options.blockers.includes(blockerId),
        accepted,
        `${engine.getDefinition(blockerId).name}: listed=${options.blockers.includes(blockerId)} accepted=${accepted}`
      );
    }
  }

  test("undefined when no battle is waiting for blockers", () => {
    const game = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    assert.equal(game.engine.getBlockOptions(), undefined);
    // Declared, but the attackers' response window is still open.
    game.engine.perform(attackAction(P1, [game.id("a")], faction(P2)));
    assert.equal(game.engine.getBlockOptions(), undefined);
    resolvePendingResponses(game.engine);
    assert.ok(game.engine.getBlockOptions());
    game.engine.perform(declare([]));
    assert.equal(game.engine.getBlockOptions(), undefined);
  });

  test("an ordinary board: every untapped character can block; declining is fine", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b1", def: character({ name: "B1" }), owner: P2 },
        { key: "b2", def: character({ name: "B2" }), owner: P2 }
      ]
    });
    toBlocking(game, ["a"]);
    const options = game.engine.getBlockOptions()!;
    assert.equal(options.playerId, P2);
    assert.deepEqual([...options.blockers].sort(), [game.id("b1"), game.id("b2")].sort());
    assert.deepEqual(options.mustBlock, []);
    assert.equal(options.canBlock, true);
    assert.equal(refusal(game.engine, declare([])), undefined);
    assertBlockersAgree(game.engine, [game.id("b1"), game.id("b2")]);
  });

  test("cannotBlock (Rapacious Soldier), a depleted and a face-down character cannot block", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "soldier", def: cardDef("Holy Heist", "Rapacious Soldier"), owner: P2 },
        { key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true },
        { key: "hidden", def: character({ name: "Hidden" }), owner: P2, faceDown: true },
        { key: "fine", def: character({ name: "Fine" }), owner: P2 }
      ]
    });
    toBlocking(game, ["a"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.blockers, [game.id("fine")]);
    assert.equal(refusal(game.engine, declare([game.id("soldier")])), "Character cannot block.");
    assert.equal(refusal(game.engine, declare([game.id("tired")])), "Depleted characters cannot block.");
    assert.equal(refusal(game.engine, declare([game.id("hidden")])), "A face-down resource cannot block.");
    assertBlockersAgree(game.engine, [game.id("soldier"), game.id("tired"), game.id("hidden"), game.id("fine")]);
  });

  test("a granted cannotBlock restriction takes a character out too", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "pinned", def: character({ name: "Pinned" }), owner: P2 },
        { key: "free", def: character({ name: "Free" }), owner: P2 }
      ]
    });
    game.engine.state.restrictions.push({ id: "r1", targetId: game.id("pinned"), restriction: "cannotBlock", duration: { type: "untilEndOfTurn" }, createdTurn: 1 } as never);
    toBlocking(game, ["a"]);
    assert.deepEqual(game.engine.getBlockOptions()!.blockers, [game.id("free")]);
    assertBlockersAgree(game.engine, [game.id("pinned"), game.id("free")]);
  });

  test("COVERT: a plain character cannot block a COVERT party; one that can block COVERT parties can", () => {
    const game = buildGame({
      cards: [
        { key: "oozling", def: cardDef("1st Edition", "Ominous Oozling"), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 },
        { key: "flashlight", def: cardDef("Holy Heist", "RC Flashlight"), owner: P2 },
        { key: "spider", def: cardDef("1st Edition", "Sneaking Spitspider"), owner: P2 }
      ]
    });
    toBlocking(game, ["oozling"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual([...options.blockers].sort(), [game.id("flashlight"), game.id("spider")].sort());
    assert.match(refusal(game.engine, declare([game.id("plain")])) ?? "", /COVERT attacking party can only be blocked by a COVERT party/);
    assertBlockersAgree(game.engine, [game.id("plain"), game.id("flashlight"), game.id("spider")]);
  });

  test("COVERT: a COVERT character cannot block a party that is not COVERT", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "spider", def: cardDef("1st Edition", "Sneaking Spitspider"), owner: P2 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
    toBlocking(game, ["a"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.blockers, [game.id("plain")]);
    assert.match(refusal(game.engine, declare([game.id("spider")])) ?? "", /COVERT character can only block a COVERT party/);
    assertBlockersAgree(game.engine, [game.id("spider"), game.id("plain")]);
  });

  test("must-block (Defense Attorney): listed, and a declaration that leaves it out is refused", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 },
        { key: "other", def: character({ name: "Other" }), owner: P2 }
      ]
    });
    toBlocking(game, ["a"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.mustBlock, [game.id("attorney")]);
    assert.ok(options.blockers.includes(game.id("attorney")));
    assert.match(refusal(game.engine, declare([])) ?? "", /'Defense Attorney' must block if it can and was left out/);
    assert.match(refusal(game.engine, declare([game.id("other")])) ?? "", /must block if it can and was left out/);
    assert.equal(refusal(game.engine, declare([game.id("attorney")])), undefined);
    assert.equal(refusal(game.engine, declare([game.id("attorney"), game.id("other")])), undefined);
    assertBlockersAgree(game.engine, [game.id("attorney"), game.id("other")]);
  });

  test("must-block is not owed when it has no legal block (COVERT attacker)", () => {
    const game = buildGame({
      cards: [
        { key: "oozling", def: cardDef("1st Edition", "Ominous Oozling"), owner: P1 },
        { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 }
      ]
    });
    toBlocking(game, ["oozling"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.mustBlock, []);
    assert.deepEqual(options.blockers, []);
    assert.equal(options.canBlock, false);
    assert.equal(refusal(game.engine, declare([])), undefined);
  });

  test("an unblockable party (RC Flashlight) leaves nobody, and declaring a blocker is refused", () => {
    const game = buildGame({
      cards: [
        { key: "flashlight", def: cardDef("Holy Heist", "RC Flashlight"), owner: P1 },
        { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 },
        { key: "other", def: character({ name: "Other" }), owner: P2 }
      ]
    });
    toBlocking(game, ["flashlight"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.blockers, []);
    assert.deepEqual(options.mustBlock, [], "an unblockable party owes no block");
    assert.equal(options.canBlock, false);
    assert.equal(options.reason, "The attacking party cannot be blocked.");
    assert.equal(refusal(game.engine, declare([game.id("other")])), options.reason);
    assert.equal(refusal(game.engine, declare([])), undefined);
  });

  test("a party that is only partly unblockable can still be blocked", () => {
    const game = buildGame({
      cards: [
        { key: "flashlight", def: cardDef("Holy Heist", "RC Flashlight"), owner: P1 },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P2 }
      ]
    });
    toBlocking(game, ["flashlight", "a"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.blockers, [game.id("other")]);
    assert.equal(refusal(game.engine, declare([game.id("other")])), undefined);
  });

  test("nobody able to block: canBlock is false with a reason, and declining is accepted", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true }
      ]
    });
    toBlocking(game, ["a"]);
    const options = game.engine.getBlockOptions()!;
    assert.deepEqual(options.blockers, []);
    assert.equal(options.canBlock, false);
    assert.equal(options.reason, "No character can block.");
    assert.equal(refusal(game.engine, declare([])), undefined);
  });

  test("the query leaves the game untouched", () => {
    const game = buildGame({
      cards: [
        { key: "oozling", def: cardDef("1st Edition", "Ominous Oozling"), owner: P1 },
        { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 }
      ]
    });
    toBlocking(game, ["oozling"]);
    const before = JSON.stringify(game.engine.state);
    game.engine.getBlockOptions();
    assert.equal(JSON.stringify(game.engine.state), before);
  });
});

describe("the cardPlayed event says when a card was flipped up (read-only data for clients)", () => {
  test("viaFlipUp is set on a FLIP UP and absent on a play from hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: cardDef("Seed", "Department of Rejections"), owner: P1, zone: "play", faceDown: true },
        ...spent("greed", 1),
        { key: "hand", def: character({ name: "Handy", cost: 0 }), owner: P1, zone: "hand" }
      ]
    });
    const playedEvents = () =>
      engine
        .getLog()
        .map((entry) => entry.event)
        .filter((event): event is Extract<NonNullable<typeof event>, { type: "cardPlayed" }> => event?.type === "cardPlayed");

    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("hand") });

    const [flipped, fromHand] = playedEvents();
    assert.equal(flipped?.cardId, id("fd"));
    assert.equal(flipped?.viaFlipUp, true);
    assert.equal(fromHand?.cardId, id("hand"));
    assert.equal(fromHand?.viaFlipUp, undefined);
  });
});
