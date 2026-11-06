// Batch r14-showdown, part 3 (docs/TESTING.md): the printed Showdown rules card, SD 12-SD 15
// (docs/rules/showdown-rules.md): Heroes attacking each other and who "your opponent" is.
// Written from the wording of the rules, not from the engine; docs/MULTIPLAYER-PLAN.md D7 (only the defending
// player blocks) and D4 (an opponent is bound once per block of rules text). Synthetic fixtures only.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { getLoyalty, opponentsOf } from "../../../engine.js";
import { autoResolveBattle, character, resolvePendingResponses } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { influenceOf, passTurn, passTurnsTo, place, table, use, type Table, type TableOptions } from "./r14-showdown.shared.js";

const BRUISER = character({ name: "Bruiser", strength: 3, life: 4 });
const WALL = character({ name: "Wall", strength: 1, life: 6 });

/** "Your opponent loses 2 influence." / "You and your opponent each lose 1." / "Turn every Allegiance card face-up." */
const AGENT = character({
  name: "Agent",
  behavior: {
    abilities: [
      { id: "drain", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] },
      {
        id: "both",
        type: "activated",
        costs: [],
        effects: [
          { type: "modifyInfluence", player: "controller", amount: -1 },
          { type: "modifyInfluence", player: "opponent", amount: -1 }
        ]
      },
      { id: "reveal", type: "activated", costs: [], effects: [{ type: "revealAllegiances" }] }
    ]
  }
});

const DECK = { deckExtras: [BRUISER, WALL, WALL, AGENT, AGENT] } satisfies TableOptions;

/** A table where `want` holds, trying seeds until the random Allegiance deal suits the scenario. */
function tableWhere(options: TableOptions, want: (t: Table) => boolean): Table {
  for (let seed = 1; seed < 200; seed++) {
    const t = table({ ...DECK, ...options, seed });
    if (want(t)) return t;
  }
  throw new Error("no seed produced the wanted Allegiance deal");
}

const loyaltyOf = (t: Table, id: PlayerId) => getLoyalty(t.engine.state, id);

function attack(engine: SpoilsEngine, playerId: PlayerId, attackers: CardInstanceId[], target: PlayerId): void {
  engine.perform({ type: "declareAttack", playerId, attackerIds: attackers, target: { type: "faction", playerId: target } });
  resolvePendingResponses(engine);
}

const opponentRequirement = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, abilityId: string) =>
  engine.getPlayRequirements({ type: "activateAbility", playerId, cardId, abilityId }).find(r => r.kind === "opponent");

describe("SD 12 - Heroes may attack each other", () => {
  rule("SD 12", "a Hero attacks another Hero's faction: that Hero is the defender and loses influence equal to the unblocked strength", () => {
    const { engine } = table({ ...DECK, heroes: 2, allegiance: ["heroes", "heroes", "heroes"] });
    const bruiser = place(engine, "h1", BRUISER);
    attack(engine, "h1", [bruiser], "h2");
    assert.equal(engine.state.battle?.attackerPlayerId, "h1");
    assert.equal(engine.state.battle?.defenderPlayerId, "h2", "the other Hero is the defender");
    engine.perform({ type: "declareBlockers", playerId: "h2", blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(influenceOf(engine, "h2"), 20 - 3);
    assert.equal(influenceOf(engine, "h1"), 20, "the attacker is untouched");
    assert.equal(influenceOf(engine, "v"), 35, "and the Villain is not involved");
  });

  rule("SD 12", "it works whichever Hero has the turn: on their turn the other Hero attacks back", () => {
    const { engine } = table({ ...DECK, heroes: 2, allegiance: ["heroes", "heroes", "heroes"] });
    const first = place(engine, "h1", BRUISER);
    const second = place(engine, "h2", BRUISER);
    attack(engine, "h1", [first], "h2");
    engine.perform({ type: "declareBlockers", playerId: "h2", blockerIds: [] });
    autoResolveBattle(engine);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "h2");
    engine.state.cards[second].attackEligibleTurn = engine.state.turn;
    attack(engine, "h2", [second], "h1");
    assert.equal(engine.state.battle?.defenderPlayerId, "h1");
    engine.perform({ type: "declareBlockers", playerId: "h1", blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(influenceOf(engine, "h1"), 20 - 3);
  });

  rule("SD 12", "Heroes loyal to the Heroes' side may attack each other too: nothing about the allegiance cards forbids it", () => {
    const loyal = table({ ...DECK, heroes: 3, allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    assert.deepEqual(["h1", "h2", "h3"].map(id => loyaltyOf(loyal, id)), ["heroes", "heroes", "heroes"]);
    const bruiser = place(loyal.engine, "h1", BRUISER);
    attack(loyal.engine, "h1", [bruiser], "h3");
    assert.equal(loyal.engine.state.battle?.defenderPlayerId, "h3");
  });

  rule("SD 12", "a Hero cannot attack their own faction (control: the attack on another Hero is accepted)", () => {
    const { engine } = table({ ...DECK, heroes: 2 });
    const bruiser = place(engine, "h1", BRUISER);
    refused(
      () => engine.perform({ type: "declareAttack", playerId: "h1", attackerIds: [bruiser], target: { type: "faction", playerId: "h1" } }),
      "attacking yourself",
      /own faction/
    );
    attack(engine, "h1", [bruiser], "h2");
    assert.equal(engine.state.battle?.defenderPlayerId, "h2");
  });

  rule("SD 12", "Heroes may attack the Villain as well as each other, and the Villain may attack a Hero", () => {
    const { engine } = table({ ...DECK, heroes: 2 });
    const bruiser = place(engine, "h1", BRUISER);
    attack(engine, "h1", [bruiser], "v");
    assert.equal(engine.state.battle?.defenderPlayerId, "v");
    engine.perform({ type: "declareBlockers", playerId: "v", blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(influenceOf(engine, "v"), 35 - 3);
    passTurn(engine);
    passTurnsTo(engine, "v");
    const villainous = place(engine, "v", BRUISER);
    attack(engine, "v", [villainous], "h2");
    assert.equal(engine.state.battle?.defenderPlayerId, "h2");
  });

  rule("SD 12", "D7: when one Hero attacks another, only the defending Hero blocks: no other Hero or the Villain may declare blockers", () => {
    const { engine } = table({ ...DECK, heroes: 3, allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    const bruiser = place(engine, "h1", BRUISER);
    const defendingWall = place(engine, "h2", WALL);
    const bystanderWall = place(engine, "h3", WALL);
    const villainWall = place(engine, "v", WALL);
    attack(engine, "h1", [bruiser], "h2");
    assert.equal(engine.state.battle?.phase, "blocking");
    const options = engine.getBlockOptions();
    assert.equal(options?.playerId, "h2", "the defender is who blocks");
    assert.deepEqual(options?.blockers, [defendingWall], "only the defender's characters can block");
    refused(
      () => engine.perform({ type: "declareBlockers", playerId: "h3", blockerIds: [bystanderWall] }),
      "a third Hero blocking for the defender",
      /Only the defending player/
    );
    refused(
      () => engine.perform({ type: "declareBlockers", playerId: "v", blockerIds: [villainWall] }),
      "the Villain blocking for a Hero",
      /Only the defending player/
    );
    refused(
      () => engine.perform({ type: "declareBlockers", playerId: "h1", blockerIds: [bruiser] }),
      "the attacker declaring blockers",
      /Only the defending player/
    );
    engine.perform({ type: "declareBlockers", playerId: "h2", blockerIds: [defendingWall] });
    autoResolveBattle(engine);
    assert.equal(influenceOf(engine, "h2"), 20, "the block protected the faction");
    assert.equal(engine.state.cards[defendingWall].damage, 3, "the defender's blocker took the hit");
    assert.equal(engine.state.cards[bystanderWall].damage, 0, "the bystander's character was not involved");
  });
});

describe("SD 13 - the Villain selects one of the Heroes as their opponent", () => {
  rule("SD 13", "a Villain's card that says 'your opponent' offers every Hero, and the one selected is the only one affected", () => {
    const { engine } = table({ ...DECK, heroes: 3, first: "v", allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    const agent = place(engine, "v", AGENT);
    assert.deepEqual(opponentRequirement(engine, "v", agent, "drain"), { kind: "opponent", candidates: ["h1", "h2", "h3"] });
    refused(() => use(engine, "v", agent, "drain"), "the Villain has not selected an opponent", /Choose which opponent/);
    use(engine, "v", agent, "drain", undefined, "h2");
    assert.equal(influenceOf(engine, "h2"), 18, "the selected Hero lost 2");
    assert.equal(influenceOf(engine, "h1"), 20, "no other Hero did");
    assert.equal(influenceOf(engine, "h3"), 20);
  });

  rule("SD 13", "the selection is made for each block of rules text: the next use may select a different Hero", () => {
    const { engine } = table({ ...DECK, heroes: 3, first: "v" });
    const agent = place(engine, "v", AGENT);
    use(engine, "v", agent, "drain", undefined, "h1");
    use(engine, "v", agent, "drain", undefined, "h3");
    assert.deepEqual(["h1", "h2", "h3"].map(id => influenceOf(engine, id)), [18, 20, 18]);
  });

  rule("SD 13", "'both players' means the Villain and the one Hero selected: only they are affected", () => {
    const { engine } = table({ ...DECK, heroes: 3, first: "v" });
    const agent = place(engine, "v", AGENT);
    use(engine, "v", agent, "both", undefined, "h3");
    assert.equal(influenceOf(engine, "v"), 44, "the Villain lost 1 (45 with three Heroes)");
    assert.equal(influenceOf(engine, "h3"), 19, "the selected Hero lost 1");
    assert.equal(influenceOf(engine, "h1"), 20);
    assert.equal(influenceOf(engine, "h2"), 20);
  });

  rule("SD 13", "the Villain can select any Hero, including one secretly loyal to the Villain's side", () => {
    const { engine } = table({ ...DECK, heroes: 2, first: "v", allegiance: ["villain", "villain", "villain"] });
    const agent = place(engine, "v", AGENT);
    assert.deepEqual(opponentRequirement(engine, "v", agent, "drain"), { kind: "opponent", candidates: ["h1", "h2"] });
    use(engine, "v", agent, "drain", undefined, "h1");
    assert.equal(influenceOf(engine, "h1"), 18);
  });

  rule("SD 13", "the Villain cannot select themselves or a player who is not a Hero", () => {
    const { engine } = table({ ...DECK, heroes: 2, first: "v" });
    const agent = place(engine, "v", AGENT);
    refused(() => use(engine, "v", agent, "drain", undefined, "v"), "the Villain naming themselves", /not one of your opponents/);
    assert.equal(influenceOf(engine, "v"), 35);
    assert.deepEqual(opponentsOf(engine.state, "v"), ["h1", "h2"]);
  });

  rule("SD 13", "a Hero who is out of the game is no longer one of the Heroes the Villain can select", () => {
    const { engine } = table({ ...DECK, heroes: 3, allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    engine.state.players.h2.influence = 0;
    passTurn(engine);
    assert.ok(engine.state.players.h2.eliminated, "h2 was eliminated");
    passTurnsTo(engine, "v");
    const agent = place(engine, "v", AGENT);
    assert.deepEqual(opponentRequirement(engine, "v", agent, "drain"), { kind: "opponent", candidates: ["h1", "h3"] });
  });
});

describe("SD 14 - a Hero's opponent is the Villain", () => {
  rule("SD 14", "a Hero's 'your opponent' is the Villain: there is nothing to select, and only the Villain is affected", () => {
    const { engine } = table({ ...DECK, heroes: 3, allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    const agent = place(engine, "h1", AGENT);
    assert.equal(opponentRequirement(engine, "h1", agent, "drain"), undefined, "no opponent to choose");
    use(engine, "h1", agent, "drain");
    assert.equal(influenceOf(engine, "v"), 43, "the Villain lost 2 (45 with three Heroes)");
    assert.equal(influenceOf(engine, "h2"), 20, "the other Heroes did not");
    assert.equal(influenceOf(engine, "h3"), 20);
    assert.equal(influenceOf(engine, "h1"), 20);
  });

  rule("SD 14", "'both players' for a Hero is the Hero and the Villain", () => {
    const { engine } = table({ ...DECK, heroes: 2 });
    const agent = place(engine, "h1", AGENT);
    use(engine, "h1", agent, "both");
    assert.equal(influenceOf(engine, "h1"), 19);
    assert.equal(influenceOf(engine, "v"), 34);
    assert.equal(influenceOf(engine, "h2"), 20);
  });

  rule("SD 14", "every Hero has the Villain as opponent, not just one: each Hero's opponents are exactly the Villain", () => {
    const { engine } = table({ ...DECK, heroes: 3, allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    for (const id of ["h1", "h2", "h3"]) assert.deepEqual(opponentsOf(engine.state, id), ["v"], id);
  });

  rule("SD 14", "a Hero cannot take another Hero as their opponent while their loyalty is not revealed (even a secret traitor)", () => {
    const t = tableWhere({ heroes: 2, allegiance: ["villain", "heroes", "heroes"] }, c => loyaltyOf(c, "h1") === "villain");
    assert.equal(loyaltyOf(t, "h1"), "villain", "h1 is secretly loyal to the Villain");
    assert.deepEqual(opponentsOf(t.engine.state, "h1"), ["v"], "but, face-down, their opponent is still the Villain");
    const agent = place(t.engine, "h1", AGENT);
    refused(() => use(t.engine, "h1", agent, "drain", undefined, "h2"), "naming another Hero while face-down", /not one of your opponents/);
    use(t.engine, "h1", agent, "drain");
    assert.equal(influenceOf(t.engine, "v"), 33);
  });
});

describe("SD 15 - a revealed Villain-loyal Hero's opponent is one of the other Heroes", () => {
  const revealed = (options: TableOptions & { heroes: number }): Table => {
    const t = tableWhere(options, c => loyaltyOf(c, "h1") === "villain");
    use(t.engine, "h1", place(t.engine, "h1", AGENT), "reveal");
    assert.equal(t.engine.state.showdown!.allegiance.h1.faceUp, true, "h1's card is face-up");
    return t;
  };

  rule("SD 15", "once revealed, a traitor's opponent must be one of the other Heroes: they are offered all of them and never the Villain", () => {
    const t = revealed({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] });
    assert.deepEqual(opponentsOf(t.engine.state, "h1"), ["h2", "h3"]);
    const agent = place(t.engine, "h1", AGENT);
    assert.deepEqual(opponentRequirement(t.engine, "h1", agent, "drain"), { kind: "opponent", candidates: ["h2", "h3"] });
  });

  rule("SD 15", "the traitor's text affects the Hero they select and not the Villain", () => {
    const t = revealed({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] });
    const agent = place(t.engine, "h1", AGENT);
    use(t.engine, "h1", agent, "drain", undefined, "h3");
    assert.equal(influenceOf(t.engine, "h3"), 18, "the selected Hero lost 2");
    assert.equal(influenceOf(t.engine, "h2"), 20);
    assert.equal(influenceOf(t.engine, "v"), 45, "the Villain, their side, was not the opponent");
  });

  rule("SD 15", "the traitor cannot take the Villain as opponent once revealed", () => {
    const t = revealed({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] });
    const agent = place(t.engine, "h1", AGENT);
    refused(() => use(t.engine, "h1", agent, "drain", undefined, "v"), "naming the Villain", /not one of your opponents/);
    assert.equal(influenceOf(t.engine, "v"), 45);
  });

  rule("SD 15", "with only one other Hero left to choose, a revealed traitor's opponent is simply that Hero", () => {
    const t = revealed({ heroes: 2, allegiance: ["villain", "heroes", "heroes"] });
    const agent = place(t.engine, "h1", AGENT);
    assert.equal(opponentRequirement(t.engine, "h1", agent, "drain"), undefined, "one candidate: no prompt");
    use(t.engine, "h1", agent, "drain");
    assert.equal(influenceOf(t.engine, "h2"), 18);
    assert.equal(influenceOf(t.engine, "v"), 35);
  });

  rule("SD 15", "a revealed Hero loyal to the Heroes keeps the Villain as their opponent (control)", () => {
    const t = tableWhere({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] }, c => loyaltyOf(c, "h1") === "heroes");
    use(t.engine, "h1", place(t.engine, "h1", AGENT), "reveal");
    assert.equal(t.engine.state.showdown!.allegiance.h1.faceUp, true);
    assert.deepEqual(opponentsOf(t.engine.state, "h1"), ["v"]);
  });

  rule("SD 15", "the revealed traitor's opponents are the other Heroes whatever their own loyalties: another revealed traitor is a candidate too", () => {
    const t = revealed({ heroes: 3, allegiance: ["villain", "villain", "villain", "villain"] });
    assert.equal(loyaltyOf(t, "h2"), "villain");
    assert.deepEqual(opponentsOf(t.engine.state, "h1"), ["h2", "h3"], "h2 is a Hero too, revealed or not");
  });
});
