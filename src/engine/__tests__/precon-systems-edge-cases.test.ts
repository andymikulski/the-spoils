// Hand-scripted (not bot-driven — see full-game.test.ts for that) games built
// from the real arcanist/warlord precon card definitions, aimed squarely at
// engine *systems* that a bot playing towards a win rarely exercises deeply:
// several independent battles inside one main phase (including a direct
// attack on a location), a response window with a long back-and-forth chain
// of tactics/abilities before it resolves, a battle spanning multiple
// speed-group rounds with a keyword that offers an extra battle-damage
// target, enter/leave-play triggers firing off real playCard/ability actions
// rather than pre-placed board state, a continuous attachment moving between
// bearers mid-turn, and a turn-start trigger recurring correctly across
// several turns (and staying quiet on the turns that aren't its
// controller's). Every card used here is a real card from
// src/data/decks/{arcanist,warlord}-ids.js — this is deliberately not about
// whether any *one* of these cards behaves correctly in isolation (that's
// card-behaviors.test.ts/keywords.test.ts's job), it's about whether the
// engine holds up when several of them collide in the same battle/turn.
//
// Board states are constructed directly via buildGame() (as every other
// rules-test file does) rather than dealt from a shuffled deck, so each test
// can put precisely the cards it needs on the board without wading through
// mulligans/mainphase RNG — full-game.test.ts already proves the engine can
// reach a real board from a real opening hand.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import cardsJson from "../../data/cards.js";
import type { CardDefinition, CardDefinitionId } from "../../engine.js";
import { autoResolveBattle, buildGame, P1, P2, resolvePendingResponses } from "./support/fixtures.js";

const CARD_CATALOG = cardsJson as CardDefinition[];
const CARDS_BY_ID = new Map(CARD_CATALOG.map(c => [c.id, c]));

/** Look up a real card definition from data/cards.json by id (see full-game.test.ts's definitionsFor for the same pattern). */
function card(id: CardDefinitionId): CardDefinition {
  const definition = CARDS_BY_ID.get(id);
  assert.ok(definition, `data/cards.json is missing referenced card '${id}'.`);
  return definition!;
}

// Both precons' faction card (src/data/decks/{arcanist,warlord}.json list the
// same id) — identical setup/turn/behavior for either side.
const TOURNAMENT_FACTION = card("c6ea7e77-6ac0-4baa-9ba2-866726230426" as CardDefinitionId);
const OBSESSION = card("0c287282-82cf-4602-b37d-35d1bbea519c" as CardDefinitionId); // arcanist resource ("o")
const RAGE = card("3be26b3f-2c78-4d0c-8849-0b4ca48951fd" as CardDefinitionId); // warlord resource ("r")

// Arcanist (P1)
const OMINOUS_OOZLING = card("975a3794-1969-4b92-b3ff-bb91a0817d39" as CardDefinitionId); // 5/4/3 covert
const SNEAKING_SPITSPIDER = card("37693f37-621a-404c-b2ca-b11070e98782" as CardDefinitionId); // 2/2/3 covert
const MEPHITIC_NULLIFIER = card("3145aa6b-d8c6-4b7b-88cf-3a3e3e5cd9c2" as CardDefinitionId); // 2/2/3, Flash-Bang
const QUOTIDIAN_EJECTOR = card("93a19b9e-4943-4e8b-b5e1-b73202812019" as CardDefinitionId); // 1/1/3, Eject
const VOIDAL_OBSERVATORY = card("309b38b2-6cad-44f7-bddc-e55846d912bc" as CardDefinitionId); // location, structure 5
const SERVILE_CENTIPEDE = card("5f6c6574-27db-4149-a19b-fd67dc589c1b" as CardDefinitionId); // 1/3/3, not covert
const AIR_TRAVEL = card("c45a94f4-651e-43c0-9472-f5d8f48725f3" as CardDefinitionId); // tactic
const SWARM_OF_GNATS = card("e0abaa9e-7077-451b-a7e0-48d2f603dc28" as CardDefinitionId); // 2/3/2, enter/leave discard

// Warlord (P2)
const PLODDING_BRUTE = card("2e1c148e-b056-4dc9-adc4-89232ff6cb50" as CardDefinitionId); // 5/3/2
const ARENA_QUARTER_FINALIST = card("c8a04083-3f59-49b0-92d4-d2932e76a7d0" as CardDefinitionId); // 7/5/3
const SCOUT = card("8e22ced3-6d0a-44d6-9f6e-0fa24b9a8872" as CardDefinitionId); // 3/3/4
const RAGING_BASK = card("2a9daa10-ec29-4d9f-b578-f86028adcce3" as CardDefinitionId); // 4/4/3, redirectDamage
const CREAKY_OLD_SWORDSMAN = card("7bf1038d-38f7-4300-8922-e3f7884ef712" as CardDefinitionId); // 3/2/2
const HIDDEN_SNIPER = card("4fdcb48c-e495-429b-9d44-b3cb15e1f381" as CardDefinitionId); // 0/1/3, Sharpshoot
const CANNON_SQUADRON = card("91bc411b-c8f7-48dd-b544-7232d091b9de" as CardDefinitionId); // 1/1/3, Fire!
const KETTINGER = card("5bec2993-a7b0-4ad5-9561-ff218c61de11" as CardDefinitionId); // item, +2 str + Handoff
const BERSERKER_CORPS = card("f1a9e770-6efd-4b5c-ac3a-bea69ec68d11" as CardDefinitionId); // sacrifice-for-tokens

describe("systems: several independent battles inside one main phase", () => {
  test("a full turn can carry two separate attacks, and the next player's turn mirrors it, including a direct attack on a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      turn: 1,
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        { key: "oozling", def: OMINOUS_OOZLING, owner: P1 },
        { key: "spitspider", def: SNEAKING_SPITSPIDER, owner: P1 },
        { key: "nullifier", def: MEPHITIC_NULLIFIER, owner: P1 },
        { key: "observatory", def: VOIDAL_OBSERVATORY, owner: P1 },
        { key: "brute", def: PLODDING_BRUTE, owner: P2 },
        { key: "arenaFinalist", def: ARENA_QUARTER_FINALIST, owner: P2 },
        // Deck filler so P2's turn-2 develop draw has something to draw.
        { key: "p2deck1", def: RAGE, owner: P2, zone: "deck" }
      ]
    });

    const p1Start = engine.state.players[P1].influence;
    const p2Start = engine.state.players[P2].influence;

    // --- Turn 1, battle #1: a fully Covert party attacks the faction. ---
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("oozling"), id("spitspider")],
      target: { type: "faction", playerId: P2 }
    });
    assert.equal(engine.state.cards[id("oozling")].depleted, true);
    assert.equal(engine.state.cards[id("spitspider")].depleted, true);

    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.phase, "blocking");

    // Plodding Brute isn't Covert — RULES.md §8/§9: only a Covert character
    // may block a Covert party.
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("brute")] })
    );

    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.battle, undefined);
    assert.equal(engine.state.players[P2].influence, p2Start - (5 + 2));
    // A battle doesn't end the turn or change phase by itself.
    assert.equal(engine.state.turn, 1);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.turnPhase, "main");

    // --- Turn 1, battle #2: a second, independent attack with a different,
    // still-undepleted party. Nothing about declareAttack limits a player to
    // one attack per turn — only "is this specific character depleted?" —
    // so this must succeed even though battle #1 already happened this turn.
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("nullifier")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("brute")] });
    autoResolveBattle(engine);

    // Blocked: no further faction damage from battle #2...
    assert.equal(engine.state.players[P2].influence, p2Start - 7);
    // ...but the two characters that fought still traded blows: Nullifier
    // (str 2) couldn't kill Brute (life 3), Brute (str 5) killed Nullifier
    // (life 2), and the survivor became depleted per RULES.md §8 step 7.
    assert.equal(engine.state.cards[id("nullifier")].zone, "discard");
    assert.equal(engine.state.cards[id("brute")].damage, 2);
    assert.equal(engine.state.cards[id("brute")].depleted, true);

    // --- Turn passes to P2. ---
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.turn, 2);
    assert.equal(engine.state.activePlayerId, P2);

    engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });
    assert.equal(engine.state.turnPhase, "main");

    // Turn 2's restore only touches the new active player's own board —
    // Plodding Brute (P2's) is undepleted/undamaged again; Nullifier stays
    // gone, it was destroyed, not merely tapped.
    assert.equal(engine.state.cards[id("brute")].damage, 0);
    assert.equal(engine.state.cards[id("brute")].depleted, false);

    // --- Turn 2, battle #1: attacking a location directly, not the faction. ---
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("arenaFinalist")],
      target: { type: "card", cardId: id("observatory") }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);

    // 7 damage to a 5-structure location destroys it; the faction takes none.
    assert.equal(engine.state.cards[id("observatory")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, p1Start);

    // --- Turn 2, battle #2: same active player, a second independent attack,
    // this time at the faction directly (mirrors turn 1's shape for P2). ---
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("brute")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P1].influence, p1Start - 5);
    assert.equal(engine.state.battle, undefined);
    assert.equal(engine.state.turn, 2);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.turnPhase, "main");
  });
});

describe("systems: a battle spanning multiple speed-group rounds", () => {
  test("each round opens its own response window, a redirect-damage keyword offers an extra target, and a character destroyed mid-battle still fires its own leave-play trigger", () => {
    // Attacking party has three distinct speeds (4, 3, 2) so this battle runs
    // three full rounds (RULES.md §8's "repeat from step 1" loop) rather than
    // resolving in one pass. Two different blockers (also two different
    // speeds) mean the redirect-eligible attacker (Raging Bask) still has a
    // real "blocker vs. original target" choice when its round comes up.
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      activePlayerId: P2,
      turnPhase: "main",
      cards: [
        { key: "scout", def: SCOUT, owner: P2 }, // str3 speed4
        { key: "bask", def: RAGING_BASK, owner: P2 }, // str4 speed3, redirectDamage
        { key: "brute", def: PLODDING_BRUTE, owner: P2 }, // str5 speed2
        { key: "gnat", def: SWARM_OF_GNATS, owner: P1 }, // life3 speed2
        { key: "centipede", def: SERVILE_CENTIPEDE, owner: P1 }, // str1 life3 speed3, not covert
        { key: "p2h1", def: RAGE, owner: P2, zone: "hand" },
        { key: "p2h2", def: RAGE, owner: P2, zone: "hand" }
      ]
    });

    const p1Start = engine.state.players[P1].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("scout"), id("bask"), id("brute")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("gnat"), id("centipede")] });

    // Round 1 (speed 4): only Scout qualifies to assign. Both blockers are
    // still legal targets; dump the full 3 onto the Swarm of Gnats — exactly
    // lethal (life 3).
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.speed, 4);
    engine.perform({
      type: "assignBattleDamage",
      playerId: P2,
      assignments: [{ sourceId: id("scout"), target: { type: "card", cardId: id("gnat") }, amount: 3 }]
    });
    resolvePendingResponses(engine);

    // The Gnat's own leave-play trigger fired on its own — a single trigger
    // with no siblings resolves immediately (RULES.md §7) rather than
    // pausing for an ordering choice; it still needs its "opponent chooses
    // which card" sub-decision answered.
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.cards[id("gnat")].zone, "discard");
    const p2HandBeforeDiscard = [...engine.state.players[P2].hand];
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      const pending = engine.state.pendingChoice;
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [p2HandBeforeDiscard[0]] }
      });
    }
    assert.equal(engine.state.players[P2].hand.length, p2HandBeforeDiscard.length - 1);
    resolvePendingResponses(engine);

    // Round 2 (speed 3): Bask (attacker) and Centipede (blocker) both
    // qualify. Centipede is still a legal blocker-target for Bask, but
    // Bask's redirectDamage keyword offers the original target (P1's
    // faction) as an extra option — choose that instead of hitting the
    // blocker.
    assert.equal(engine.state.battle?.speed, 3);
    const view = engine.getBattleView();
    const baskSource = view?.damageSources.find(source => source.cardId === id("bask"));
    assert.ok(baskSource, "Raging Bask should be a damage source in round 2.");
    assert.deepEqual(
      new Set(baskSource!.legalTargets.map(t => (t.type === "faction" ? "faction" : t.cardId))),
      new Set(["faction", id("centipede")])
    );

    engine.perform({
      type: "assignBattleDamage",
      playerId: P2,
      assignments: [{ sourceId: id("bask"), target: { type: "faction", playerId: P1 }, amount: 4 }]
    });
    // Centipede (blocker) still gets to swing back at Bask in the same
    // round, even though Bask sent its own damage elsewhere.
    engine.perform({
      type: "assignBattleDamage",
      playerId: P1,
      assignments: [{ sourceId: id("centipede"), target: { type: "card", cardId: id("bask") }, amount: 1 }]
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, p1Start - 4);
    // Bask took Centipede's 1 damage but survives (life 4) — the redirect
    // was a choice, not a way to dodge return fire.
    assert.equal(engine.state.cards[id("bask")].zone, "play");
    assert.equal(engine.state.cards[id("bask")].damage, 1);

    // Round 3 (speed 2): only Brute qualifies now (Scout and Bask already
    // assigned). Centipede is still the sole blocker, so Brute's damage must
    // go to it, not the faction — no redirect keyword on Brute.
    assert.equal(engine.state.battle?.speed, 2);
    const finalView = engine.getBattleView();
    const bruteSource = finalView?.damageSources.find(source => source.cardId === id("brute"));
    assert.deepEqual(bruteSource?.legalTargets, [{ type: "card", cardId: id("centipede") }]);

    engine.perform({
      type: "assignBattleDamage",
      playerId: P2,
      assignments: [{ sourceId: id("brute"), target: { type: "card", cardId: id("centipede") }, amount: 5 }]
    });
    autoResolveBattle(engine);

    assert.equal(engine.state.battle, undefined);
    assert.equal(engine.state.cards[id("centipede")].zone, "discard");
    // Total faction damage this battle came only from Bask's redirected 4 —
    // Scout and Brute both spent their damage on blockers.
    assert.equal(engine.state.players[P1].influence, p1Start - 4);
  });
});

describe("systems: simultaneous deaths each fire their own trigger, independently and in full", () => {
  test("two Swarm of Gnats destroyed by the same round's battle damage each force their own separate discard — neither trigger is lost", () => {
    // Two characters' "leaves play" triggers are two separate emitted events
    // (each keyed to that specific card being the event's own subject), not
    // one shared event two abilities react to — so this never raises an
    // orderTriggers choice (RULES.md §7's ordering choice is for multiple
    // abilities reacting to the *same* event; see trigger-ordering.test.ts).
    // Instead the engine must resolve each trigger's own chooser sub-choice
    // one at a time, in turn, without either one clobbering the other —
    // regression coverage for exactly that: the first pause pauses the
    // whole queue, not just its own frame, so a second already-queued
    // trigger from the same batched destruction can never overwrite an
    // unanswered pendingChoice before anyone gets to answer it.
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      activePlayerId: P2,
      turnPhase: "main",
      cards: [
        { key: "brute", def: PLODDING_BRUTE, owner: P2 }, // str5 speed2
        { key: "creaky", def: CREAKY_OLD_SWORDSMAN, owner: P2 }, // str3 life2 speed2
        { key: "gnat1", def: SWARM_OF_GNATS, owner: P1 }, // str2 life3 speed2
        { key: "gnat2", def: SWARM_OF_GNATS, owner: P1 }, // str2 life3 speed2
        { key: "p2h1", def: RAGE, owner: P2, zone: "hand" },
        { key: "p2h2", def: RAGE, owner: P2, zone: "hand" }
      ]
    });

    const p2HandBefore = [...engine.state.players[P2].hand];

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("brute"), id("creaky")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("gnat1"), id("gnat2")] });

    // Single round — everyone here is speed 2. Brute (5) and Creaky (3)
    // each individually assign their own full strength, split so both
    // Gnats end up lethal (life 3): Brute alone onto Gnat1, Creaky alone
    // onto Gnat2. The Gnats swing back for 2 each, killing Creaky (life 2)
    // too — three characters (both Gnats and Creaky) die from the very same
    // batch of simultaneous damage (RULES.md §8 step 5).
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.speed, 2);
    engine.perform({
      type: "assignBattleDamage",
      playerId: P2,
      assignments: [
        { sourceId: id("brute"), target: { type: "card", cardId: id("gnat1") }, amount: 5 },
        { sourceId: id("creaky"), target: { type: "card", cardId: id("gnat2") }, amount: 3 }
      ]
    });
    engine.perform({
      type: "assignBattleDamage",
      playerId: P1,
      assignments: [
        { sourceId: id("gnat1"), target: { type: "card", cardId: id("creaky") }, amount: 2 },
        { sourceId: id("gnat2"), target: { type: "card", cardId: id("brute") }, amount: 2 }
      ]
    });

    // Draining resolves the round's damage, destroys all three characters
    // together, and pauses on the first Gnat's own "opponent chooses which
    // card" sub-decision.
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("gnat1")].zone, "discard");
    assert.equal(engine.state.cards[id("gnat2")].zone, "discard");
    assert.equal(engine.state.cards[id("creaky")].zone, "discard");

    const firstPick = engine.state.pendingChoice;
    assert.equal(firstPick?.kind, "chooserSelectsTarget");
    if (firstPick?.kind === "chooserSelectsTarget") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: firstPick.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [p2HandBefore[0]] }
      });
    }

    // The second Gnat's trigger is still there, untouched, waiting its turn
    // — not silently dropped by the first one resolving.
    resolvePendingResponses(engine);
    const secondPick = engine.state.pendingChoice;
    assert.equal(secondPick?.kind, "chooserSelectsTarget");
    if (secondPick?.kind === "chooserSelectsTarget") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: secondPick.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [p2HandBefore[1]] }
      });
    }
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.battle?.phase, "finished");
    engine.perform({ type: "advanceFlow" });

    assert.equal(engine.state.battle, undefined);
    // Both discards actually happened — P2's whole hand is gone, not just
    // one card's worth.
    assert.equal(engine.state.players[P2].hand.length, 0);
    assert.ok(engine.state.players[P2].discard.includes(p2HandBefore[0]));
    assert.ok(engine.state.players[P2].discard.includes(p2HandBefore[1]));
  });
});

describe("systems: a response window can carry a long back-and-forth chain before it resolves", () => {
  test("five alternating tactics/abilities stack up in one response window and resolve LIFO, and the attacker survives to still land its hit", () => {
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        { key: "oozling", def: OMINOUS_OOZLING, owner: P1 }, // str5 life4 speed3 — the attacker
        { key: "spitspider", def: SNEAKING_SPITSPIDER, owner: P1 }, // bystander, Flash-Bang's bounce target
        { key: "nullifier", def: MEPHITIC_NULLIFIER, owner: P1 },
        { key: "ejector", def: QUOTIDIAN_EJECTOR, owner: P1, counters: { token: 2 } },
        { key: "obsession1", def: OBSESSION, owner: P1 },
        { key: "obsession2", def: OBSESSION, owner: P1 },
        { key: "obsession3", def: OBSESSION, owner: P1 },
        { key: "airTravel", def: AIR_TRAVEL, owner: P1, zone: "hand" },
        { key: "p1deck1", def: OBSESSION, owner: P1, zone: "deck" },
        { key: "sniper", def: HIDDEN_SNIPER, owner: P2 },
        { key: "cannon", def: CANNON_SQUADRON, owner: P2 },
        { key: "rage1", def: RAGE, owner: P2 }
      ]
    });

    const p1HandBefore = engine.state.players[P1].hand.length;
    const p2Start = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("oozling")],
      target: { type: "faction", playerId: P2 }
    });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);

    // 1) P1 opens with a buff/utility tactic.
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("airTravel"),
      selected: { target: [id("oozling")] }
    });
    // 2) P2 answers with instant removal.
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("sniper"),
      abilityId: "hidden-sniper-sharpshoot",
      selected: { target: [id("oozling")] }
    });
    // 3) P1 answers back, punishing the card that just fired.
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("ejector"),
      abilityId: "quotidian-ejector-eject",
      selected: { target: [id("sniper")] }
    });
    // 4) P2 piles on more removal.
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("cannon"),
      abilityId: "cannon-squadron-fire",
      selected: { picked: [id("oozling")] }
    });
    // 5) P1 closes with an unrelated, self-destructive utility play.
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("nullifier"),
      abilityId: "mephitic-nullifier-flash-bang",
      selected: { target: [id("spitspider")] }
    });

    // All five responses stacked up before anyone resolved anything.
    assert.equal(engine.state.responseStack.length, 5);

    // Draining resolves LIFO and pauses once for Cannon Squadron's Fire! —
    // "distribute up to 2 among up to 2 characters" needs the activating
    // player's own share choice.
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "distributeAmong");
    if (engine.state.pendingChoice?.kind === "distributeAmong") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: engine.state.pendingChoice.playerId,
        choice: { kind: "distributeAmong", shares: { [id("oozling")]: 2 } }
      });
    }
    resolvePendingResponses(engine);

    assert.equal(engine.state.responseStack.length, 0);
    assert.equal(engine.state.responseWindow, undefined);

    // Flash-Bang: Nullifier destroyed itself, Spitspider bounced home to its
    // owner P1's hand.
    assert.equal(engine.state.cards[id("nullifier")].zone, "discard");
    assert.equal(engine.state.cards[id("spitspider")].zone, "hand");
    assert.ok(engine.state.players[P1].hand.includes(id("spitspider")));
    // Eject: Hidden Sniper got sent home to its owner P2's hand after it had
    // already fired.
    assert.equal(engine.state.cards[id("sniper")].zone, "hand");
    assert.ok(engine.state.players[P2].hand.includes(id("sniper")));
    // Air Travel: spent from hand, drew a card, and Spitspider came home —
    // net +1 versus where P1's hand started.
    assert.equal(engine.state.players[P1].hand.length, p1HandBefore - 1 + 1 + 1);
    // Sharpshoot (1) + Fire! (2) landed on the attacker, but it's still
    // well short of lethal (life 4).
    assert.equal(engine.state.cards[id("oozling")].damage, 3);
    assert.equal(engine.state.cards[id("oozling")].zone, "play");

    // The battle itself never got touched by any of this — it's still
    // waiting on blockers.
    assert.equal(engine.state.battle?.phase, "blocking");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P2].influence, p2Start - 5);
    assert.equal(engine.state.cards[id("oozling")].zone, "play");
  });
});

describe("systems: enter/leave-play triggers fire off real playCard/ability actions, not just battle deaths", () => {
  test("Swarm of Gnats forces an opponent-chosen discard both when it enters and when a later effect removes it from play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        { key: "nullifier", def: MEPHITIC_NULLIFIER, owner: P1 },
        { key: "obsession1", def: OBSESSION, owner: P1 },
        { key: "obsession2", def: OBSESSION, owner: P1 },
        { key: "obsession3", def: OBSESSION, owner: P1 },
        { key: "obsession4", def: OBSESSION, owner: P1 },
        { key: "gnats", def: SWARM_OF_GNATS, owner: P1, zone: "hand" },
        { key: "p2h1", def: RAGE, owner: P2, zone: "hand" },
        { key: "p2h2", def: RAGE, owner: P2, zone: "hand" }
      ]
    });

    const p2HandStart = engine.state.players[P2].hand.length;

    // Played from hand — unlike every other test in this file, this card
    // actually enters play through the normal action, so its "enters play"
    // trigger (skipped by every other test's pre-placed board state) fires
    // for real here.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gnats") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      const pending = engine.state.pendingChoice;
      const candidates = engine.queryCards(pending.declaration.selector, pending.context);
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [candidates[0].id] }
      });
    }
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gnats")].zone, "play");
    assert.equal(engine.state.players[P2].hand.length, p2HandStart - 1);

    // Bounced back out of play (Flash-Bang doesn't care that it isn't its
    // own card — "a character you control" matches anything P1 controls).
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("nullifier"),
      abilityId: "mephitic-nullifier-flash-bang",
      selected: { target: [id("gnats")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      const pending = engine.state.pendingChoice;
      const candidates = engine.queryCards(pending.declaration.selector, pending.context);
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [candidates[0].id] }
      });
    }
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gnats")].zone, "hand");
    assert.equal(engine.state.cards[id("nullifier")].zone, "discard");
    assert.equal(engine.state.players[P2].hand.length, p2HandStart - 2);
  });
});

describe("systems: a continuous attachment can move between bearers mid-turn", () => {
  test("Handoff detaches an item from one character and reattaches it to another, carrying its continuous bonus along", () => {
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      activePlayerId: P2,
      turnPhase: "main",
      cards: [
        { key: "scout", def: SCOUT, owner: P2 }, // base str 3
        { key: "kettinger", def: KETTINGER, owner: P2, attachedToKey: "scout" }, // +2 str continuous
        { key: "creaky", def: CREAKY_OLD_SWORDSMAN, owner: P2 }, // base str 3, undepleted, not in battle
        { key: "rage1", def: RAGE, owner: P2 },
        { key: "rage2", def: RAGE, owner: P2 },
        { key: "rage3", def: RAGE, owner: P2 }
      ]
    });

    assert.equal(engine.getStat(id("scout"), "strength"), 5);
    assert.equal(engine.getStat(id("creaky"), "strength"), 3);
    assert.equal(engine.state.cards[id("kettinger")].attachedTo, id("scout"));

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("kettinger"),
      abilityId: "kettinger-handoff",
      selected: { newWearer: [id("creaky")] }
    });
    resolvePendingResponses(engine);

    // The item followed the ability's target, not the other way around.
    assert.equal(engine.state.cards[id("kettinger")].attachedTo, id("creaky"));
    assert.equal(engine.getStat(id("scout"), "strength"), 3);
    assert.equal(engine.getStat(id("creaky"), "strength"), 5);

    // Handoff's own cost ("pay 3, deplete a character you control that is
    // not in a battle") depletes the *new* wearer, not the old one.
    assert.equal(engine.state.cards[id("creaky")].depleted, true);
    assert.equal(engine.state.cards[id("scout")].depleted, false);
  });
});

describe("systems: turn-start triggers recur every one of their controller's turns, and only theirs", () => {
  test("a self-sacrifice-for-tokens trigger and a location's optional-token trigger each fire only on their own controller's turns, across several turns", () => {
    const { engine, id } = buildGame({
      playerA: { faction: TOURNAMENT_FACTION },
      playerB: { faction: TOURNAMENT_FACTION },
      turn: 1,
      activePlayerId: P1,
      turnPhase: "main",
      cards: [
        { key: "observatory", def: VOIDAL_OBSERVATORY, owner: P1 },
        { key: "berserker", def: BERSERKER_CORPS, owner: P2 }, // base str 5
        { key: "fodder", def: PLODDING_BRUTE, owner: P2 }, // str 5, sacrifice fuel
        { key: "p1deck1", def: OBSESSION, owner: P1, zone: "deck" },
        { key: "p1deck2", def: OBSESSION, owner: P1, zone: "deck" },
        { key: "p2deck1", def: RAGE, owner: P2, zone: "deck" },
        { key: "p2deck2", def: RAGE, owner: P2, zone: "deck" },
        { key: "p2deck3", def: RAGE, owner: P2, zone: "deck" }
      ]
    });

    assert.equal(engine.getStat(id("berserker"), "strength"), 5);

    // --- Turn 1 -> 2 (P1 -> P2): Berserker Corps' own "start of my turn"
    // trigger fires; Voidal Observatory's doesn't (it isn't P1's turn).
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.turn, 2);
    assert.equal(engine.state.activePlayerId, P2);
    const berserkerPickTurn2 = engine.state.pendingChoice;
    assert.equal(berserkerPickTurn2?.kind, "selectTargets");
    if (berserkerPickTurn2?.kind === "selectTargets") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "selectTargets", selected: { picked: [id("fodder")] } }
      });
    }
    resolvePendingResponses(engine);

    // Fodder's strength (5) becomes tokens on Berserker Corps, which adds 1
    // strength per token via its own continuous ability.
    assert.equal(engine.state.cards[id("fodder")].zone, "discard");
    assert.equal(engine.state.cards[id("berserker")].counters?.token, 5);
    assert.equal(engine.getStat(id("berserker"), "strength"), 10);
    // Voidal Observatory never got a chance to act this turn.
    assert.equal(engine.state.cards[id("observatory")].counters?.token ?? 0, 0);

    engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });

    // --- Turn 2 -> 3 (P2 -> P1): now it's Voidal Observatory's turn to
    // fire; Berserker Corps stays quiet (it isn't P2's... wait, P1's turn).
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.turn, 3);
    assert.equal(engine.state.activePlayerId, P1);
    const observatoryPick = engine.state.pendingChoice;
    assert.equal(observatoryPick?.kind, "chooserSelectsOption");
    if (observatoryPick?.kind === "chooserSelectsOption") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsOption", index: 1 } // take the token
      });
    }
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("observatory")].counters?.token, 1);
    // Berserker Corps' strength is untouched — its trigger didn't fire.
    assert.equal(engine.getStat(id("berserker"), "strength"), 10);

    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    // --- Turn 3 -> 4 (P1 -> P2): Berserker Corps' trigger recurs. This
    // time, with no fodder left besides itself, decline the (optional)
    // sacrifice — its own text then applies: "Otherwise, destroy this card."
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.turn, 4);
    assert.equal(engine.state.activePlayerId, P2);
    const berserkerPickTurn4 = engine.state.pendingChoice;
    assert.equal(berserkerPickTurn4?.kind, "selectTargets");
    if (berserkerPickTurn4?.kind === "selectTargets") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "selectTargets", selected: { picked: [] } }
      });
    }
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("berserker")].zone, "discard");
  });
});
