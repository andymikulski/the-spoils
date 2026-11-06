// Batch r14-showdown, part 2 (docs/TESTING.md): the printed Showdown rules card, SD 8-SD 11
// (docs/rules/showdown-rules.md): claiming Hero cards and the Temptation Pile.
// Written from the wording of the rules, not from the engine. Synthetic fixtures only (r14-showdown.shared.ts).

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { ActivatedAbility, CardDefinition, SpoilsEngine } from "../../../engine.js";
import { redactStateFor } from "../../../engine.js";
import { character, item, location, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import {
  CHAMPION,
  giveResources,
  influenceOf,
  passTurn,
  place,
  resourcesOf,
  table,
  use,
  zoneOf
} from "./r14-showdown.shared.js";

/** Abilities that claim from the Hero Deck / Temptation Pile and move a Hero card, for a placed "operator" card. */
const claimTop = (id: string, count: number | "all"): ActivatedAbility => ({
  id,
  type: "activated",
  costs: [],
  effects: [{ type: "claimHeroCards", claimer: "controller", from: "heroDeckTop", count }]
});
const claimPile = (id: string, count: number | "all"): ActivatedAbility => ({
  id,
  type: "activated",
  costs: [],
  effects: [{ type: "claimHeroCards", claimer: "controller", from: "temptationPile", count }]
});
const OPERATOR = item({
  name: "Operator",
  behavior: {
    abilities: [
      claimTop("claim1", 1),
      claimTop("claim2", 2),
      claimTop("claim3", 3),
      claimPile("pile1", 1),
      claimPile("pileAll", "all"),
      { id: "tempt", type: "activated", costs: [], effects: [{ type: "heroDeckToTemptationPile" }] },
      { id: "tempt2", type: "activated", costs: [], effects: [{ type: "heroDeckToTemptationPile", count: 2 }] }
    ]
  }
});

/** "Enters play: its controller gains 4 influence": a Hero card whose trigger shows who put it into play. */
const GREETER = character({
  name: "Greeter",
  behavior: {
    abilities: [
      {
        id: "greet",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: { type: "sourceIsEventCard" },
        effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }]
      }
    ]
  }
});
const RELIC = item({ name: "Relic" });
const SHRINE = location({ name: "Shrine", structure: 5 });

/** A Hero tactic: costs 5 and needs [R][R][R], neither of which a resource-less Hero has; its effect is +5 influence for whoever plays it. */
const PEP_TALK = tactic({
  name: "Pep Talk",
  cost: 5,
  threshold: "rrr",
  behavior: { abilities: [{ id: "pep", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
});

/** A Hero tactic that has to pick a character, which cannot be played when no character is in play. */
const SMITE = tactic({
  name: "Smite",
  behavior: {
    abilities: [
      {
        id: "smite",
        type: "activated",
        costs: [],
        targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});

/** A Hero character with ways of leaving play: destroyed, returned to hand, put in its deck. */
const exits = (): ActivatedAbility[] => [
  { id: "die", type: "activated", costs: [], effects: [{ type: "destroy", target: "source" }] },
  { id: "bounce", type: "activated", costs: [], effects: [{ type: "moveCard", target: "source", to: "hand" }] },
  { id: "sink", type: "activated", costs: [], effects: [{ type: "moveCard", target: "source", to: "deck" }] }
];
const WANDERER = character({ name: "Wanderer", behavior: { abilities: exits() } });
/** An ordinary (not Hero) card with the same exits, as a control. */
const MORTAL = character({ name: "Mortal", behavior: { abilities: exits() } });

const operator = (engine: SpoilsEngine, playerId: string): string => place(engine, playerId, OPERATOR);

/** Puts the Hero Deck in the order of these card names (setup shuffles it), top first. */
function stack(engine: SpoilsEngine, ...names: string[]): void {
  const pile = engine.state.showdown!.heroDeck;
  pile.sort((x, y) => names.indexOf(engine.getDefinition(x).name) - names.indexOf(engine.getDefinition(y).name));
}

describe("SD 8 - claiming a Hero card that is not a tactic", () => {
  rule("SD 8", "a claimed character is put into play under the claiming player's control", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const [top] = engine.state.showdown!.heroDeck;
    assert.equal(zoneOf(engine, top), "table");
    use(engine, "h1", operator(engine, "h1"), "claim1");
    assert.equal(zoneOf(engine, top), "play");
    assert.equal(engine.state.cards[top].controllerId, "h1", "h1 claimed it, h1 controls it");
    assert.ok(engine.state.players.h1.play.includes(top), "it is among h1's cards in play");
    assert.ok(!engine.state.players.h2.play.includes(top), "and not h2's");
    assert.ok(!engine.state.players.v.play.includes(top), "nor the Villain's");
    assert.deepEqual(engine.state.showdown!.heroDeck, [], "it left the Hero Deck");
  });

  rule("SD 8", "whoever claims it controls it: the same card claimed by the other Hero on their turn is theirs", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const [top] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h2");
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "h2");
    use(engine, "h2", op, "claim1");
    assert.equal(engine.state.cards[top].controllerId, "h2");
  });

  rule("SD 8", "a Hero card of any non-tactic type can be claimed: item and location go into play too", () => {
    const { engine } = table({ heroes: 2, heroDeck: [RELIC, SHRINE], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const claimed = [...engine.state.showdown!.heroDeck];
    assert.equal(claimed.length, 2);
    use(engine, "h1", operator(engine, "h1"), "claim2");
    for (const id of claimed) {
      assert.equal(zoneOf(engine, id), "play", `${engine.getDefinition(id).name} is in play`);
      assert.equal(engine.state.cards[id].controllerId, "h1");
    }
  });

  rule("SD 8", "claiming is free: nothing is paid and the claimer's resources are untouched", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const op = operator(engine, "h1");
    giveResources(engine, "h1", 2);
    const before = resourcesOf(engine, "h1").map(id => engine.state.cards[id].depleted || engine.state.cards[id].attachedTo);
    const handBefore = engine.state.players.h1.hand.length;
    use(engine, "h1", op, "claim1");
    assert.deepEqual(resourcesOf(engine, "h1").map(id => engine.state.cards[id].depleted || engine.state.cards[id].attachedTo), before);
    assert.equal(engine.state.players.h1.hand.length, handBefore, "nothing came from the claimer's hand");
  });

  rule("SD 8", "a card put into play by a claim enters play: its enters-play ability triggers for the claimer", () => {
    const { engine } = table({ heroes: 2, heroDeck: [GREETER], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const op = operator(engine, "h1");
    const before = [influenceOf(engine, "h1"), influenceOf(engine, "h2"), influenceOf(engine, "v")];
    use(engine, "h1", op, "claim1");
    assert.deepEqual(
      [influenceOf(engine, "h1"), influenceOf(engine, "h2"), influenceOf(engine, "v")],
      [before[0] + 4, before[1], before[2]],
      "its controller (the claimer) gained 4"
    );
  });

  rule("SD 8", "the Villain can claim a Hero card as well: it enters play under the Villain", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION], extra: [OPERATOR], deckExtras: [OPERATOR], first: "v" });
    const [top] = engine.state.showdown!.heroDeck;
    use(engine, "v", operator(engine, "v"), "claim1");
    assert.equal(zoneOf(engine, top), "play");
    assert.equal(engine.state.cards[top].controllerId, "v");
  });

  rule("SD 8", "an empty Hero Deck leaves nothing to claim: the effect does nothing", () => {
    const { engine } = table({ heroes: 2, heroDeck: [], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const op = operator(engine, "h1");
    const playBefore = [...engine.state.players.h1.play];
    use(engine, "h1", op, "claim1");
    assert.deepEqual(engine.state.players.h1.play, playBefore);
  });
});

describe("SD 9 - claiming a Hero tactic", () => {
  const withTactic = (heroDeck: CardDefinition[]) =>
    table({ heroes: 2, heroDeck, extra: [OPERATOR], deckExtras: [OPERATOR] });

  rule("SD 9", "a claimed tactic is played by the claimer at once, for free, ignoring a threshold they cannot meet", () => {
    const { engine } = withTactic([PEP_TALK]);
    const [top] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    assert.equal(resourcesOf(engine, "h1").length, 0, "h1 has no resources: the tactic's cost 5 and [R][R][R] could not be met");
    const before = influenceOf(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: op, abilityId: "claim1" });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "deployForFree", "the claimer is asked to play it");
    assert.equal(pending.playerId, "h1");
    assert.deepEqual(pending.candidates, [top]);
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: top } });
    resolvePendingResponses(engine);
    assert.equal(influenceOf(engine, "h1"), before + 5, "the tactic resolved for the claimer");
    assert.equal(influenceOf(engine, "h2"), 20, "and only for the claimer");
    assert.equal(resourcesOf(engine, "h1").length, 0, "nothing was paid");
  });

  rule("SD 9", "the threshold is ignored but nothing else changes: a claimer who meets it pays nothing either", () => {
    const { engine } = withTactic([PEP_TALK]);
    const [top] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    giveResources(engine, "h1", 6);
    const resourcesBefore = resourcesOf(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: op, abilityId: "claim1" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: top } });
    resolvePendingResponses(engine);
    assert.deepEqual(resourcesOf(engine, "h1"), resourcesBefore, "the cost 5 was not paid from their 6 resources");
    assert.ok(resourcesBefore.every(id => !engine.state.cards[id].attachedTo), "no resource was attached to pay it");
  });

  rule("SD 9", "a tactic claimed from the Temptation Pile is played for free the same way", () => {
    const { engine } = withTactic([PEP_TALK]);
    const [top] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    use(engine, "h1", op, "tempt");
    assert.deepEqual(engine.state.showdown!.temptationPile, [top]);
    const before = influenceOf(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: op, abilityId: "pile1" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: top } });
    resolvePendingResponses(engine);
    assert.equal(influenceOf(engine, "h1"), before + 5);
  });

  rule("SD 9", "only a tactic is played: a claimed non-tactic is not offered for a free play, it just enters play", () => {
    const { engine } = withTactic([CHAMPION]);
    use(engine, "h1", operator(engine, "h1"), "claim1");
    assert.equal(engine.state.pendingChoice, undefined, "no free-play prompt");
  });

  rule("SD 9", "claimed together, a character and then a tactic: the character enters play and the tactic is played for free", () => {
    const { engine } = withTactic([CHAMPION, PEP_TALK]);
    stack(engine, "Champion", "Pep Talk");
    const [champion, tacticId] = engine.state.showdown!.heroDeck;
    const before = influenceOf(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: operator(engine, "h1"), abilityId: "claim2" });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, champion), "play", "the character is already in play");
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: tacticId } });
    resolvePendingResponses(engine);
    assert.equal(influenceOf(engine, "h1"), before + 5);
    assert.equal(zoneOf(engine, tacticId), "removed");
  });

  rule(["SD 8", "SD 9"],
    "claimed together, a tactic and then a character: the tactic is played and the character still enters play (none of the claim is lost)",
    () => {
      const { engine } = withTactic([PEP_TALK, CHAMPION, RELIC]);
      stack(engine, "Pep Talk", "Champion", "Relic");
      const [tacticId, champion, relic] = engine.state.showdown!.heroDeck;
      engine.perform({ type: "activateAbility", playerId: "h1", cardId: operator(engine, "h1"), abilityId: "claim3" });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
      engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: tacticId } });
      resolvePendingResponses(engine);
      assert.equal(zoneOf(engine, champion), "play", "the claimed character entered play");
      assert.equal(zoneOf(engine, relic), "play", "the claimed item entered play");
    }
  );

  rule(["SD 9", "SD 10"],
    "a claimed tactic that cannot be played (its required pick has no character to take) is removed from the game at once",
    () => {
      const { engine } = withTactic([SMITE]);
      const [top] = engine.state.showdown!.heroDeck;
      const op = operator(engine, "h1");
      assert.equal(
        Object.values(engine.state.cards).filter(c => c.zone === "play" && engine.getDefinition(c.id).type === "character").length,
        0,
        "no character anywhere"
      );
      use(engine, "h1", op, "claim1");
      assert.equal(zoneOf(engine, top), "removed", "it could not be played, so it is removed from the game");
      assert.equal(engine.state.pendingChoice, undefined, "and nobody is left holding a prompt about it");
    }
  );

  rule("SD 9", "a claimed tactic that can be played must be played: the claimer cannot decline it",
    () => {
      const { engine } = withTactic([PEP_TALK]);
      const [top] = engine.state.showdown!.heroDeck;
      const op = operator(engine, "h1");
      engine.perform({ type: "activateAbility", playerId: "h1", cardId: op, abilityId: "claim1" });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
      refused(
        () => engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree" } }),
        "declining a tactic the claimer can play"
      );
      assert.notEqual(zoneOf(engine, top), "removed", "it was not thrown away unplayed");
    }
  );
});

describe("SD 10 - Hero cards are removed from the game", () => {
  const withHero = (def: CardDefinition) =>
    table({ heroes: 2, heroDeck: [def], extra: [OPERATOR, MORTAL], deckExtras: [OPERATOR, MORTAL, MORTAL] });

  rule("SD 10", "a Hero card that is destroyed is removed from the game, not put in a discard pile", () => {
    const { engine } = withHero(WANDERER);
    const [hero] = engine.state.showdown!.heroDeck;
    use(engine, "h1", operator(engine, "h1"), "claim1");
    assert.equal(zoneOf(engine, hero), "play");
    use(engine, "h1", hero, "die");
    assert.equal(zoneOf(engine, hero), "removed");
    assert.ok(!engine.state.players.h1.discard.includes(hero), "not in h1's discard pile");
    assert.ok(!engine.state.players.v.discard.includes(hero), "nor the Villain's");
  });

  rule("SD 10", "a Hero card returned to a hand is removed from the game instead", () => {
    const { engine } = withHero(WANDERER);
    const [hero] = engine.state.showdown!.heroDeck;
    use(engine, "h1", operator(engine, "h1"), "claim1");
    use(engine, "h1", hero, "bounce");
    assert.equal(zoneOf(engine, hero), "removed");
    for (const player of Object.values(engine.state.players)) assert.ok(!player.hand.includes(hero), `not in ${player.id}'s hand`);
  });

  rule("SD 10", "a Hero card put into a deck is removed from the game instead", () => {
    const { engine } = withHero(WANDERER);
    const [hero] = engine.state.showdown!.heroDeck;
    use(engine, "h1", operator(engine, "h1"), "claim1");
    use(engine, "h1", hero, "sink");
    assert.equal(zoneOf(engine, hero), "removed");
    for (const player of Object.values(engine.state.players)) assert.ok(!player.deck.includes(hero), `not in ${player.id}'s deck`);
  });

  rule("SD 10", "control: an ordinary card leaving play in the same ways goes where it normally would", () => {
    const { engine } = withHero(WANDERER);
    const destroyed = place(engine, "h1", MORTAL);
    use(engine, "h1", destroyed, "die");
    assert.equal(zoneOf(engine, destroyed), "discard", "destroyed: discard pile");
    const returned = place(engine, "h1", MORTAL);
    use(engine, "h1", returned, "bounce");
    assert.equal(zoneOf(engine, returned), "hand", "returned to hand: hand");
  });

  rule("SD 10", "a Hero tactic is removed from the game when it is done resolving, not discarded", () => {
    const { engine } = table({ heroes: 2, heroDeck: [PEP_TALK], extra: [OPERATOR], deckExtras: [OPERATOR] });
    const [tacticId] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: op, abilityId: "claim1" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: tacticId } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, tacticId), "removed");
    assert.ok(!engine.state.players.h1.discard.includes(tacticId), "not in the discard pile");
  });

  rule("SD 10", "a removed Hero card is gone for good: it is not claimable again from the Hero Deck or the Temptation Pile", () => {
    const { engine } = withHero(WANDERER);
    const [hero] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    use(engine, "h1", op, "claim1");
    use(engine, "h1", hero, "die");
    assert.ok(!engine.state.showdown!.heroDeck.includes(hero), "not back in the Hero Deck");
    assert.ok(!engine.state.showdown!.temptationPile.includes(hero), "not in the Temptation Pile");
    use(engine, "h1", op, "pileAll");
    assert.equal(zoneOf(engine, hero), "removed");
  });
});

describe("SD 11 - the Temptation Pile", () => {
  const tempting = (heroDeck: CardDefinition[]) => table({ heroes: 2, heroDeck, extra: [OPERATOR], deckExtras: [OPERATOR] });

  rule("SD 11", "an effect puts the top Hero Deck card into the Temptation Pile, a group of cards that sits on the table", () => {
    const { engine } = tempting([CHAMPION, GREETER]);
    const [first, second] = engine.state.showdown!.heroDeck;
    assert.deepEqual(engine.state.showdown!.temptationPile, [], "it starts empty");
    use(engine, "h1", operator(engine, "h1"), "tempt");
    assert.deepEqual(engine.state.showdown!.temptationPile, [first]);
    assert.deepEqual(engine.state.showdown!.heroDeck, [second], "the card left the Hero Deck");
    assert.equal(zoneOf(engine, first), "table", "it sits on the table");
  });

  rule("SD 11", "the pile stays face-up: every viewer sees what is in it, while the Hero Deck stays hidden", () => {
    const { engine } = tempting([CHAMPION, GREETER]);
    const [first, second] = engine.state.showdown!.heroDeck;
    use(engine, "h1", operator(engine, "h1"), "tempt");
    for (const viewer of ["v", "h1", "h2", "spectator"] as const) {
      const seen = redactStateFor(engine.state, viewer);
      assert.equal(seen.cards[first].definitionId, engine.state.cards[first].definitionId, `${viewer} sees the pile card`);
      assert.notEqual(seen.cards[second].definitionId, engine.state.cards[second].definitionId, `${viewer} still cannot see the Hero Deck`);
    }
  });

  rule("SD 11", "the pile collects cards: several effects stack them in the order they were put there, and it persists across turns", () => {
    const { engine } = tempting([CHAMPION, GREETER, CHAMPION]);
    const [a, b, c] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    use(engine, "h1", op, "tempt");
    use(engine, "h1", op, "tempt2");
    assert.deepEqual(engine.state.showdown!.temptationPile, [a, b, c], "three cards, in order");
    passTurn(engine);
    passTurn(engine);
    assert.deepEqual(engine.state.showdown!.temptationPile, [a, b, c], "still there on a later turn");
  });

  rule("SD 11", "effects can take cards out of the pile: claiming one leaves the rest, claiming all empties it", () => {
    const { engine } = tempting([CHAMPION, RELIC, SHRINE]);
    const [a, b, c] = engine.state.showdown!.heroDeck;
    const op = operator(engine, "h1");
    use(engine, "h1", op, "tempt2");
    use(engine, "h1", op, "tempt");
    assert.deepEqual(engine.state.showdown!.temptationPile, [a, b, c]);
    use(engine, "h1", op, "pile1");
    assert.deepEqual(engine.state.showdown!.temptationPile, [b, c], "one card claimed");
    assert.equal(engine.state.cards[a].controllerId, "h1");
    use(engine, "h1", op, "pileAll");
    assert.deepEqual(engine.state.showdown!.temptationPile, [], "the rest claimed");
    for (const id of [b, c]) assert.equal(zoneOf(engine, id), "play");
  });

  rule("SD 11", "the pile is a shared table group, not any player's zone", () => {
    const { engine } = tempting([CHAMPION]);
    const [a] = engine.state.showdown!.heroDeck;
    use(engine, "h1", operator(engine, "h1"), "tempt");
    for (const player of Object.values(engine.state.players)) {
      for (const zone of [player.deck, player.hand, player.play, player.discard, player.void, player.removed]) {
        assert.ok(!zone.includes(a), `${a} is in ${player.id}'s zones`);
      }
    }
  });

  rule("SD 11", "with no Hero Deck cards left an effect that fills the pile adds nothing", () => {
    const { engine } = tempting([]);
    use(engine, "h1", operator(engine, "h1"), "tempt");
    assert.deepEqual(engine.state.showdown!.temptationPile, []);
  });
});
