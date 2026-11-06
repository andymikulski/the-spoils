// Clause tests, batch seed-saga-06 part p2 (groups 4-7, clauses not yet covered).
// Expected behavior comes from the PRINTED text (see docs/TESTING.md).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, location, play, resourceCard, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, printing, refused } from "./_clause.js";
import { pending, readyResources, tokensOn } from "./_board.js";
import { battleOf, declareAttackBy, fightThrough, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** `n` elitism resources for `owner`, already spent (attached to the faction): they count toward thresholds but cannot pay. */
function spentElitism(owner: PlayerId, n: number): CardPlacement[] {
  return bank("elitism", n, owner).map((placement) => ({ ...placement, key: `sp_${placement.key}`, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

/** Answers an open `chooserSelectsTarget` pick for `player` with `selected`, then drains the response windows. */
function pick(engine: SpoilsEngine, player: PlayerId, selected: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, player, "the right player makes the pick");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  let guard = 0;
  while (engine.state.responseWindow && !engine.state.pendingChoice && guard++ < 50) {
    const window = engine.state.responseWindow;
    engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
}

/** Micromajig tokens `owner` controls in play. */
function micromajigs(engine: SpoilsEngine, controller: PlayerId): CardInstanceId[] {
  return Object.keys(engine.state.cards).filter((cardId) => {
    const card = engine.state.cards[cardId];
    return card.zone === "play" && card.controllerId === controller && engine.getDefinition(cardId).name === "Micromajig";
  });
}

const smiteTactic = (): CardDefinition =>
  tactic({
    name: "Smite",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "smite",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const vanishTactic = (): CardDefinition =>
  tactic({
    name: "Vanish",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "vanish",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// =====================================================================================
// Contrabulous Fabtraption
// =====================================================================================
const FAB = "400e77cc-a31e-4aa2-9a40-46e420cff872"; // item, gearsmith, cost 2, threshold eee -- six RUNE abilities, each costing "Destroy this card"

function fabBoard(extra: CardPlacement[] = [], random: () => number = () => 0.5) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random,
    cards: [
      { key: "fab", def: printing(FAB), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1, trade: "gearsmith" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1, trade: "warlord" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyAnvil", cost: 4, trade: "gearsmith" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirCrate", cost: 2, trade: "gearsmith" }), owner: P2, zone: "play" },
      { key: "myPlain", def: item({ name: "MyPlain", cost: 1, trade: "warlord" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", trade: "gearsmith" }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

function fabHandBoard(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "fab", def: printing(FAB), owner: P1, zone: "hand" }, ...resources]
  });
}

clause(FAB, "0:ability:rune-of-enhancement", "printed cost 2, threshold eee, item / gearsmith: deploys with exactly enough, refused one short on cost or on an icon", () => {
  const def = printing(FAB);
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["item", "gearsmith", 2, "eee"]);
  // exact: 2 ready + 1 spent elitism (threshold 3 icons via the spent one, cost 2 paid)
  const ok = fabHandBoard([...bank("elitism", 2, P1), ...spentElitism(P1, 1)]);
  play(ok.engine, P1, ok.id("fab"));
  assert.equal(zoneOf(ok.engine, ok.id("fab")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "cost 2 paid");
  // one short on the cost (threshold still met by spent icons)
  const costShort = fabHandBoard([...bank("elitism", 1, P1), ...spentElitism(P1, 2)]);
  refused(() => play(costShort.engine, P1, costShort.id("fab")), "cost short by one", /afford|resource|cost|pay/i);
  assert.equal(zoneOf(costShort.engine, costShort.id("fab")), "hand");
  // one icon short (3 ready resources, only 2 elitism)
  const iconShort = fabHandBoard([...bank("elitism", 2, P1), ...bank("rage", 1, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("fab")), "threshold short by one icon", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("fab")), "hand");
  // control: three ready elitism deploys it
  const three = fabHandBoard(bank("elitism", 3, P1));
  play(three.engine, P1, three.id("fab"));
  assert.equal(zoneOf(three.engine, three.id("fab")), "play");
  assert.equal(readyResources(three.engine, P1), 1);
});

clause(FAB, "0:ability:rune-of-enhancement", "destroys itself as the cost, then this turn the picked character gains 2 strength and 2 life (either side's character)", () => {
  const { engine, id } = fabBoard();
  assert.deepEqual(statsOf(engine, id("mine")), [2, 3, 1]);
  activate(engine, P1, id("fab"), "rune-of-enhancement", { selected: { ch: [id("mine")] } });
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  assert.equal(engine.getStat(id("mine"), "strength"), 4, "+2 strength");
  assert.equal(engine.getStat(id("mine"), "life"), 5, "+2 life");
  assert.equal(engine.getStat(id("mine"), "speed"), 1, "speed unchanged");
  assert.deepEqual(statsOf(engine, id("foe")), [1, 4, 1], "the other character is untouched");

  const b = fabBoard();
  activate(b.engine, P1, b.id("fab"), "rune-of-enhancement", { selected: { ch: [b.id("foe")] } });
  assert.deepEqual(statsOf(b.engine, b.id("foe")), [3, 6, 1], "an opponent's character can be picked too");
  assert.deepEqual(statsOf(b.engine, b.id("mine")), [2, 3, 1]);
});

clause(FAB, "0:ability:rune-of-enhancement", "the bonus lasts only this turn; the pick must be a character in play (not an item or location)", () => {
  const { engine, id } = fabBoard();
  activate(engine, P1, id("fab"), "rune-of-enhancement", { selected: { ch: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  endTurn(engine, P1);
  assert.deepEqual(statsOf(engine, id("mine")), [2, 3, 1], "after the turn the bonus is gone");
  endTurn(engine, P2);
  assert.deepEqual(statsOf(engine, id("mine")), [2, 3, 1], "and stays gone");

  const b = fabBoard();
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-enhancement", { selected: { ch: [b.id("myItem")] } }), "an item is not a character", /target|character|select|invalid|legal/i);
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-enhancement", { selected: { ch: [b.id("myLoc")] } }), "a location is not a character", /target|character|select|invalid|legal/i);
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-enhancement", { selected: {} }), "a character must be picked", /target|character|select|pick|legal/i);
  assert.equal(zoneOf(b.engine, b.id("fab")), "play", "the refused activations did not pay the cost");
  activate(b.engine, P1, b.id("fab"), "rune-of-enhancement", { selected: { ch: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("fab")), "discard", "control: a character pick works");
});

clause(FAB, "1:ability:rune-of-summoning", "destroys itself, then puts exactly 2 Micromajig tokens (1/1 speed 3 majig characters) into play under its controller", () => {
  const { engine, id } = fabBoard();
  assert.equal(micromajigs(engine, P1).length, 0);
  activate(engine, P1, id("fab"), "rune-of-summoning");
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 2, "exactly 2 tokens under my control");
  assert.equal(micromajigs(engine, P2).length, 0, "none for the opponent");
  for (const t of tokens) {
    assert.deepEqual(statsOf(engine, t), [1, 1, 3]);
    assert.deepEqual(engine.getSubtypes(t), ["majig"]);
    assert.ok(engine.getCardTypes(t).includes("character"), "engine.getCardTypes(t).includes(\"character\")");
    assert.equal(engine.state.cards[t].ownerId, P1);
  }
});

clause(FAB, "1:ability:rune-of-summoning", "the Micromajig tokens are Gearsmith characters (a Micromajig is a Gearsmith card)", () => {
  const { engine, id } = fabBoard();
  activate(engine, P1, id("fab"), "rune-of-summoning");
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 2);
  for (const t of tokens) assert.equal(engine.getDefinition(t).trade, "gearsmith");
});

clause(FAB, "2:ability:rune-of-animation", "destroys itself, then this turn the picked item is a golem character with strength and life equal to its numeric cost and 3 speed", () => {
  const { engine, id } = fabBoard();
  assert.deepEqual(engine.getCardTypes(id("myItem")), ["item"]);
  activate(engine, P1, id("fab"), "rune-of-animation", { selected: { it: [id("myItem")] } });
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  assert.ok(engine.getCardTypes(id("myItem")).includes("character"), "now a character");
  assert.deepEqual(statsOf(engine, id("myItem")), [4, 4, 3], "cost-4 item: strength 4, life 4, speed 3");

  const b = fabBoard();
  activate(b.engine, P1, b.id("fab"), "rune-of-animation", { selected: { it: [b.id("theirItem")] } });
  assert.deepEqual(statsOf(b.engine, b.id("theirItem")), [2, 2, 3], "an opponent's cost-2 item: 2/2, speed 3");
  assert.equal(b.engine.getCardTypes(b.id("myItem")).includes("character"), false, "the other item is not a character");
});

clause(FAB, "2:ability:rune-of-animation", "the golem character lasts only this turn; only an item can be picked (not a character or location)", () => {
  const { engine, id } = fabBoard();
  activate(engine, P1, id("fab"), "rune-of-animation", { selected: { it: [id("myItem")] } });
  endTurn(engine, P1);
  assert.equal(engine.getCardTypes(id("myItem")).includes("character"), false, "no longer a character after the turn");
  assert.equal(engine.getSubtypes(id("myItem")).includes("golem"), false, "no longer a golem");
  assert.equal(zoneOf(engine, id("myItem")), "play");

  const b = fabBoard();
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-animation", { selected: { it: [b.id("mine")] } }), "a character is not an item", /target|item|select|invalid|legal/i);
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-animation", { selected: { it: [b.id("myLoc")] } }), "a location is not an item", /target|item|select|invalid|legal/i);
  refused(() => activate(b.engine, P1, b.id("fab"), "rune-of-animation", { selected: {} }), "an item must be picked", /target|item|select|pick|legal/i);
  assert.equal(zoneOf(b.engine, b.id("fab")), "play");
});

clause(FAB, "2:ability:rune-of-animation", "the Fabtraption itself cannot be the picked item (it is destroyed first as the cost)", () => {
  const { engine, id } = fabBoard();
  refused(() => activate(engine, P1, id("fab"), "rune-of-animation", { selected: { it: [id("fab")] } }), "the destroyed source cannot be the pick", /target|item|select|invalid|legal|play/i);
  assert.equal(zoneOf(engine, id("fab")), "play", "refused, nothing paid");
});

// --- RUNE OF ACCELERATION ---
const elitism = (name = "Elitism") => resourceCard({ name, resource: { provides: ["elitism"], staple: true } });
const accelDeck = (extra: CardPlacement[] = []): CardPlacement[] => [
  { key: "elit1", def: elitism(), owner: P1, zone: "deck" },
  { key: "elit2", def: elitism(), owner: P1, zone: "deck" },
  { key: "near", def: elitism("Elitist"), owner: P1, zone: "deck" },
  ...Array.from({ length: 5 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
  { key: "theirElit", def: elitism(), owner: P2, zone: "deck" },
  ...extra
];

clause(FAB, "3:ability:rune-of-acceleration", "destroys itself, searches its controller's own deck: the controller picks a card named Elitism and it enters play (the near-miss name and the opponent's deck are not pickable)", () => {
  for (const seed of [0, 0.3, 0.99]) {
    const { engine, id } = fabBoard(accelDeck(), () => seed);
    const before = readyResources(engine, P1);
    activate(engine, P1, id("fab"), "rune-of-acceleration");
    assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
    const pc = pending(engine);
    assert.ok(pc, "the controller picks the Elitism");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    for (const bad of ["near", "theirElit", "dk0"]) {
      refused(
        () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(bad)] } } as never),
        `${bad} is not a legal pick`,
        /target|select|invalid|legal|choice|name|zone/i
      );
      assert.ok(pending(engine), "the pick is still pending");
    }
    pick(engine, P1, [id("elit2")]);
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("elit2")), "play", "the chosen Elitism is in play");
    assert.equal(engine.state.cards[id("elit2")].controllerId, P1);
    assert.equal(Boolean(engine.state.cards[id("elit2")].faceDown), false);
    assert.equal(zoneOf(engine, id("elit1")), "deck", "the other copy stays in the deck");
    assert.equal(zoneOf(engine, id("theirElit")), "deck");
    assert.equal(readyResources(engine, P1), before + 1, "it works as a resource");
  }
});

clause(FAB, "3:ability:rune-of-acceleration", "CR 312.1: after a successful search the deck is shuffled (same cards, new order)", () => {
  const found = fabBoard(accelDeck(), () => 0);
  const deckBefore = [...found.engine.state.players[P1].deck];
  activate(found.engine, P1, found.id("fab"), "rune-of-acceleration");
  pick(found.engine, P1, [found.id("elit2")]);
  assert.equal(zoneOf(found.engine, found.id("elit2")), "play");
  const unshuffled = deckBefore.filter((c) => c !== found.id("elit2"));
  assert.deepEqual([...found.engine.state.players[P1].deck].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.notDeepEqual(found.engine.state.players[P1].deck, unshuffled, "but their order changed: the deck was shuffled");
});

clause(FAB, "3:ability:rune-of-acceleration", "CR 312.1: a search that finds no Elitism still shuffles the deck", () => {
  const none = fabBoard([
    { key: "near", def: elitism("Elitist"), owner: P1, zone: "deck" },
    { key: "dk0", def: character({ name: "Dk0" }), owner: P1, zone: "deck" },
    { key: "dk1", def: character({ name: "Dk1" }), owner: P1, zone: "deck" }
  ], () => 0);
  const noneBefore = [...none.engine.state.players[P1].deck];
  activate(none.engine, P1, none.id("fab"), "rune-of-acceleration");
  assert.equal(pending(none.engine), undefined, "nothing to pick");
  assert.deepEqual([...none.engine.state.players[P1].deck].sort(), [...noneBefore].sort(), "same cards");
  assert.notDeepEqual(none.engine.state.players[P1].deck, noneBefore, "a failed search still shuffles the deck");
});

clause(FAB, "3:ability:rune-of-acceleration", "if you do, at the end of the turn the Elitism is destroyed; it stays until then and the opponent's Elitism is untouched", () => {
  const { engine, id } = fabBoard(accelDeck([{ key: "theirInPlay", def: elitism(), owner: P2, zone: "play" }]));
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  pick(engine, P1, [id("elit1")]);
  assert.equal(zoneOf(engine, id("elit1")), "play", "still in play during the turn");
  endTurn(engine, P1);
  pick(engine, P1, [id("elit1")]); // "destroy a card named Elitism you control" is the controller's own pick (Q16)
  assert.equal(zoneOf(engine, id("elit1")), "discard", "destroyed at the end of the turn");
  assert.equal(zoneOf(engine, id("elit2")), "deck");
  assert.equal(zoneOf(engine, id("theirInPlay")), "play", "'you control': the opponent's Elitism survives");
});

clause(FAB, "3:ability:rune-of-acceleration", "no Elitism in the deck: nothing enters play and (no 'if you do') an Elitism already in play survives the end of the turn", () => {
  const cards: CardPlacement[] = [
    { key: "near", def: elitism("Elitist"), owner: P1, zone: "deck" },
    { key: "dk0", def: character({ name: "Dk0" }), owner: P1, zone: "deck" },
    { key: "theirElit", def: elitism(), owner: P2, zone: "deck" },
    { key: "oldE", def: elitism(), owner: P1, zone: "play" }
  ];
  const { engine, id } = fabBoard(cards);
  const deckBefore = engine.state.players[P1].deck.length;
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  assert.equal(zoneOf(engine, id("fab")), "discard", "the cost is paid even when the search fails");
  assert.equal(pending(engine), undefined, "nothing to pick");
  assert.equal(engine.state.players[P1].deck.length, deckBefore, "no card left the deck");
  assert.equal(zoneOf(engine, id("theirElit")), "deck");
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("oldE")), "play", "'if you do' not met: nothing destroyed at end of turn");
});

clause(FAB, "3:ability:rune-of-acceleration", "the end-of-turn 'destroy a card named Elitism you control' is chosen by its controller", () => {
  const { engine, id } = fabBoard(accelDeck([{ key: "oldE", def: elitism(), owner: P1, zone: "play" }]));
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  pick(engine, P1, [id("elit1")]);
  endTurn(engine, P1);
  const pc = pending(engine);
  assert.ok(pc, "the controller is asked which Elitism to destroy");
  assert.equal(pc.playerId, P1);
  pick(engine, P1, [id("oldE")]);
  assert.equal(zoneOf(engine, id("oldE")), "discard");
  assert.equal(zoneOf(engine, id("elit1")), "play");
});

clause(FAB, "0:ability:rune-of-enhancement", "the printed item has no subtype", () => {
  assert.deepEqual(printing(FAB).subtype, [], "Contrabulous Fabtraption prints no subtype");
});

clause(FAB, "3:ability:rune-of-acceleration", "'a card named Elitism': exactly one card is searched for, so picking two Elitism is refused", () => {
  const { engine, id } = fabBoard(accelDeck());
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("elit1"), id("elit2")] } } as never),
    "two cards is more than 'a card'",
    /target|select|invalid|legal|choice|name|zone|count|many/i
  );
  assert.ok(pending(engine), "the pick is still pending");
  pick(engine, P1, [id("elit1")]);
  assert.equal(zoneOf(engine, id("elit1")), "play", "control: one Elitism works");
  assert.equal(zoneOf(engine, id("elit2")), "deck", "the second Elitism stays in the deck");
});

clause(FAB, "3:ability:rune-of-acceleration", "the search may come up empty on purpose: picking nothing puts nothing into play and the end-of-turn destroy does not happen ('if you do')", () => {
  const { engine, id } = fabBoard(accelDeck([{ key: "oldE", def: elitism(), owner: P1, zone: "play" }]));
  const deckBefore = engine.state.players[P1].deck.length;
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  pick(engine, P1, []);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("elit1")), "deck");
  assert.equal(zoneOf(engine, id("elit2")), "deck");
  assert.equal(engine.state.players[P1].deck.length, deckBefore, "no card left the deck");
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined, "nothing to destroy: no prompt");
  assert.equal(zoneOf(engine, id("oldE")), "play", "'if you do' not met: the Elitism already in play survives");
});

clause(FAB, "3:ability:rune-of-acceleration", "the end-of-turn destroy is mandatory and only a card named Elitism I control can be picked", () => {
  const { engine, id } = fabBoard(accelDeck([{ key: "oldE", def: elitism(), owner: P1, zone: "play" }]));
  activate(engine, P1, id("fab"), "rune-of-acceleration");
  pick(engine, P1, [id("elit1")]);
  endTurn(engine, P1);
  assert.ok(pending(engine), "asked which Elitism to destroy");
  const answer = (selected: CardInstanceId[]) =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  refused(() => answer([]), "'destroy a card named Elitism you control' is not optional", /target|select|invalid|legal|choice|name|zone|required|optional|count/i);
  refused(() => answer([id("mine")]), "a character that is not named Elitism cannot be picked", /target|select|invalid|legal|choice|name|zone/i);
  refused(() => answer([id("myItem")]), "an item that is not named Elitism cannot be picked", /target|select|invalid|legal|choice|name|zone/i);
  assert.ok(pending(engine), "still waiting for a legal pick");
  pick(engine, P1, [id("oldE")]);
  assert.equal(zoneOf(engine, id("oldE")), "discard", "control: the named Elitism is destroyed");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("myItem")), "play");
});


clause(FAB, "4:ability:rune-of-overclocking", "destroys itself, then puts a token on the picked Gearsmith card you control (character or item); two activations stack", () => {
  const { engine, id } = fabBoard([{ key: "fab2", def: printing(FAB), owner: P1, zone: "play" }]);
  assert.equal(tokensOn(engine, id("mine")), 0);
  activate(engine, P1, id("fab"), "rune-of-overclocking", { selected: { gs: [id("mine")] } });
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  assert.equal(tokensOn(engine, id("mine")), 1, "exactly one token");
  assert.equal(tokensOn(engine, id("foe")), 0);
  activate(engine, P1, id("fab2"), "rune-of-overclocking", { selected: { gs: [id("mine")] } });
  assert.equal(tokensOn(engine, id("mine")), 2, "a second activation adds another");

  const b = fabBoard();
  activate(b.engine, P1, b.id("fab"), "rune-of-overclocking", { selected: { gs: [b.id("myItem")] } });
  assert.equal(tokensOn(b.engine, b.id("myItem")), 1, "a Gearsmith item is a legal pick");
  const c = fabBoard();
  activate(c.engine, P1, c.id("fab"), "rune-of-overclocking", { selected: { gs: [c.id("myLoc")] } });
  assert.equal(tokensOn(c.engine, c.id("myLoc")), 1, "a Gearsmith location is a legal pick");
});

clause(FAB, "4:ability:rune-of-overclocking", "only a Gearsmith card you control can be picked (not another trade, not the opponent's)", () => {
  const { engine, id } = fabBoard();
  const sel = (key: string) => ({ selected: { gs: [id(key)] } });
  refused(() => activate(engine, P1, id("fab"), "rune-of-overclocking", sel("foe")), "opponent's non-gearsmith", /target|select|invalid|legal|control/i);
  refused(() => activate(engine, P1, id("fab"), "rune-of-overclocking", sel("theirItem")), "an opponent's Gearsmith card", /target|select|invalid|legal|control/i);
  refused(() => activate(engine, P1, id("fab"), "rune-of-overclocking", sel("myPlain")), "my own non-Gearsmith card", /target|select|invalid|legal|trade/i);
  refused(() => activate(engine, P1, id("fab"), "rune-of-overclocking", { selected: {} }), "a card must be picked", /target|select|pick|legal/i);
  assert.equal(zoneOf(engine, id("fab")), "play", "no refused attempt paid the cost");
  activate(engine, P1, id("fab"), "rune-of-overclocking", sel("mine"));
  assert.equal(tokensOn(engine, id("mine")), 1, "control: a Gearsmith card I control works");
});

clause(FAB, "5:ability:rune-of-destruction", "destroys itself, then removes the picked item (either side's) from the game", () => {
  const { engine, id } = fabBoard();
  activate(engine, P1, id("fab"), "rune-of-destruction", { selected: { it: [id("theirItem")] } });
  assert.equal(zoneOf(engine, id("fab")), "discard", "COST: destroy this card");
  assert.equal(zoneOf(engine, id("theirItem")), "removed", "removed from the game, not destroyed");
  assert.equal(zoneOf(engine, id("myItem")), "play");

  const b = fabBoard();
  activate(b.engine, P1, b.id("fab"), "rune-of-destruction", { selected: { it: [b.id("myItem")] } });
  assert.equal(zoneOf(b.engine, b.id("myItem")), "removed", "my own item can be picked");
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "play");
});

clause(FAB, "5:ability:rune-of-destruction", "only an item can be picked (not a character or location), and a pick is required", () => {
  const { engine, id } = fabBoard();
  refused(() => activate(engine, P1, id("fab"), "rune-of-destruction", { selected: { it: [id("mine")] } }), "a character is not an item", /target|item|select|invalid|legal/i);
  refused(() => activate(engine, P1, id("fab"), "rune-of-destruction", { selected: { it: [id("myLoc")] } }), "a location is not an item", /target|item|select|invalid|legal/i);
  refused(() => activate(engine, P1, id("fab"), "rune-of-destruction", { selected: {} }), "an item must be picked", /target|item|select|pick|legal/i);
  assert.equal(zoneOf(engine, id("fab")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
});


clause(FAB, "2:ability:rune-of-animation", "the animated item is a 'golem' (subtype golem), a golem character", () => {
  const { engine, id } = fabBoard();
  activate(engine, P1, id("fab"), "rune-of-animation", { selected: { it: [id("myItem")] } });
  assert.ok(engine.getCardTypes(id("myItem")).includes("character"), "engine.getCardTypes(id(\"myItem\")).includes(\"character\")");
  assert.ok(engine.getSubtypes(id("myItem")).includes("golem"), "now a golem");
});

clause(FAB, "4:ability:rune-of-overclocking", "the Fabtraption itself cannot be the picked Gearsmith card (it is destroyed first as the cost)", () => {
  const { engine, id } = fabBoard();
  refused(() => activate(engine, P1, id("fab"), "rune-of-overclocking", { selected: { gs: [id("fab")] } }), "the destroyed source cannot be the pick", /target|select|invalid|legal|play/i);
  assert.equal(zoneOf(engine, id("fab")), "play", "refused, nothing paid");
});

clause(FAB, "5:ability:rune-of-destruction", "the Fabtraption itself cannot be the picked item (it is destroyed first as the cost)", () => {
  const { engine, id } = fabBoard();
  refused(() => activate(engine, P1, id("fab"), "rune-of-destruction", { selected: { it: [id("fab")] } }), "the destroyed source cannot be the pick", /target|item|select|invalid|legal|play/i);
  assert.equal(zoneOf(engine, id("fab")), "play", "refused, nothing paid");
});

// =====================================================================================
// Crushjaw Oceanhide
// =====================================================================================
const CRUSH = "22a59555-9544-4e93-8728-64c15c7dc8c4"; // character gearsmith seraphim/dragon, cost 5 · e · str 4 / spd 3 / life 4 -- AGGRO, UNIQUE OCEANHIDE -- [E]x5: when it inflicts damage to a faction, this turn characters you control and deploy gain AGGRO

function crushBoard(opts: { elitism?: number; rage?: number; active?: PlayerId; owner?: PlayerId; extra?: CardPlacement[]; crushEligible?: boolean } = {}) {
  const owner = opts.owner ?? P1;
  const foe = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    random: () => 0.5,
    cards: [
      { key: "cj", def: printing(CRUSH), owner, zone: "play", attackEligible: opts.crushEligible ?? true },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5 }), owner, zone: "play", attackEligible: false },
      { key: "foeChar", def: character({ name: "FoeChar", strength: 1, life: 9 }), owner: foe, zone: "play", attackEligible: false },
      { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner, zone: "hand" },
      { key: "foeNewbie", def: character({ name: "FoeNewbie", cost: 0 }), owner: foe, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 5, owner),
      ...bank("rage", opts.rage ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

const hasAggro = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId).includes("aggro");
const faction = (player: PlayerId) => ({ type: "faction" as const, playerId: player });

function crushHandBoard(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "cj", def: printing(CRUSH), owner: P1, zone: "hand" }, ...resources]
  });
}

clause(CRUSH, "0:kw:AGGRO", "printed cost 5, threshold e, stats 4/3/4, gearsmith seraphim dragon; deploys with exactly enough, refused one short or without the icon", () => {
  const def = printing(CRUSH);
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.subtype], ["character", "gearsmith", 5, "e", ["seraphim", "dragon"]]);
  const ok = crushHandBoard([...bank("elitism", 1, P1), ...bank("rage", 4, P1)]);
  play(ok.engine, P1, ok.id("cj"));
  assert.equal(zoneOf(ok.engine, ok.id("cj")), "play");
  assert.deepEqual(statsOf(ok.engine, ok.id("cj")), [4, 4, 3]);
  assert.equal(readyResources(ok.engine, P1), 0, "cost 5 paid");
  const short = crushHandBoard([...bank("elitism", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("cj")), "cost short by one", /afford|resource|cost|pay/i);
  const noIcon = crushHandBoard(bank("rage", 5, P1));
  refused(() => play(noIcon.engine, P1, noIcon.id("cj")), "threshold e missing", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("cj")), "hand");
});

clause(CRUSH, "0:kw:AGGRO", "AGGRO: it can attack the turn it entered play; a plain character in the same spot cannot", () => {
  const { engine, id } = crushBoard({ crushEligible: false });
  assert.ok(hasAggro(engine, id("cj")), "AGGRO keyword");
  declareAttackBy(engine, P1, [id("cj")]);
  assert.ok(battleOf(engine), "Crushjaw attacks without having started the turn in play");
  const c = crushBoard({ crushEligible: false });
  refused(() => declareAttackBy(c.engine, P1, [c.id("ally")]), "a plain summoning-sick character cannot attack", /attack|turn|eligible|control|began|start/i);
  assert.equal(battleOf(c.engine), undefined);
});

clause(CRUSH, "0:unique", "UNIQUE OCEANHIDE: a second copy under one player's control forces a keep-one choice; the other is destroyed", () => {
  for (const keepFirst of [true, false]) {
    const { engine, id } = crushBoard({ elitism: 1, rage: 4, extra: [{ key: "cj2", def: printing(CRUSH), owner: P1, zone: "hand" }] });
    play(engine, P1, id("cj2"));
    const pc = pending(engine);
    assert.ok(pc, "keep-one choice");
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    const keep = keepFirst ? id("cj") : id("cj2");
    const lose = keepFirst ? id("cj2") : id("cj");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);
    assert.equal(zoneOf(engine, keep), "play");
    assert.equal(zoneOf(engine, lose), "discard", "the extra copy is destroyed");
  }
});

clause(CRUSH, "0:unique", "the UNIQUE identifier is OCEANHIDE: any other card of mine with that identifier forces a keep-one choice, one with another identifier does not", () => {
  const board = (identifier: string) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "twin", def: character({ name: "Imposter", unique: identifier } as Partial<CardDefinition>), owner: P1, zone: "play" },
        { key: "cj2", def: printing(CRUSH), owner: P1, zone: "hand" },
        ...bank("elitism", 1, P1),
        ...bank("rage", 4, P1)
      ]
    });
  const same = board("oceanhide");
  play(same.engine, P1, same.id("cj2"));
  const pc = pending(same.engine);
  assert.ok(pc, "a different card carrying UNIQUE OCEANHIDE conflicts with Crushjaw");
  assert.equal(pc.kind, "uniqueSurvivor");
  const other = board("somethingelse");
  play(other.engine, P1, other.id("cj2"));
  assert.equal(pending(other.engine), undefined, "UNIQUE with another identifier does not conflict");
  assert.equal(zoneOf(other.engine, other.id("twin")), "play");
  assert.equal(zoneOf(other.engine, other.id("cj2")), "play");
});


clause(CRUSH, "0:unique", "UNIQUE is per player: an opponent's own Oceanhide is fine; a copy I control but the opponent owns still counts against me", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "theirCj", def: printing(CRUSH), owner: P2, zone: "play" },
      { key: "mine", def: printing(CRUSH), owner: P1, zone: "hand" },
      ...bank("elitism", 1, P1),
      ...bank("rage", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("mine"));
  assert.equal(pending(b.engine), undefined, "no keep-one prompt: different controllers");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirCj")), "play");
  // owner != controller: a P2-owned copy that P1 controls
  const c = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "borrowed", def: printing(CRUSH), owner: P2, controller: P1, zone: "play" },
      { key: "mine", def: printing(CRUSH), owner: P1, zone: "hand" },
      ...bank("elitism", 1, P1),
      ...bank("rage", 4, P1)
    ]
  });
  play(c.engine, P1, c.id("mine"));
  const pc = pending(c.engine);
  assert.ok(pc, "I control two copies");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: c.id("mine") } } as never);
  assert.equal(zoneOf(c.engine, c.id("borrowed")), "discard");
});

clause(CRUSH, "1:rule@eeeee", "with 5 elitism icons, damaging a faction gives my characters (existing and later-deployed) AGGRO this turn, and not the opponent's", () => {
  const { engine, id } = crushBoard();
  assert.equal(hasAggro(engine, id("ally")), false, "before: no AGGRO");
  const inf0 = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("cj")], faction(P2), []);
  assert.ok(engine.state.players[P2].influence < inf0, "the faction was damaged");
  assert.ok(hasAggro(engine, id("ally")), "my character gained AGGRO");
  assert.equal(hasAggro(engine, id("foeChar")), false, "the opponent's character did not");
  play(engine, P1, id("newbie"));
  assert.ok(hasAggro(engine, id("newbie")), "a character I deploy afterwards gains AGGRO");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(hasAggro(engine, id("ally")), false, "AGGRO ends with the turn");
  assert.equal(hasAggro(engine, id("newbie")), false);
});

clause(CRUSH, "1:rule@eeeee", "without 5 elitism icons (4 elitism + 1 other) the damage grants nothing", () => {
  const { engine, id } = crushBoard({ elitism: 4, rage: 1 });
  const inf0 = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("cj")], faction(P2), []);
  assert.ok(engine.state.players[P2].influence < inf0, "the faction was damaged");
  assert.equal(hasAggro(engine, id("ally")), false);
  play(engine, P1, id("newbie"));
  assert.equal(hasAggro(engine, id("newbie")), false);
  const full = crushBoard({ elitism: 5 });
  fightThrough(full.engine, P1, [full.id("cj")], faction(P2), []);
  assert.ok(hasAggro(full.engine, full.id("ally")), "control: with 5 it works");
});

clause(CRUSH, "1:rule@eeeee", "only damage this card inflicts to a faction counts: blocked, aimed at a location, or dealt by another character does nothing", () => {
  // blocked: Crushjaw damages the blocker, not the faction
  const blocked = crushBoard({ extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 9 }), owner: P2, zone: "play" }] });
  fightThrough(blocked.engine, P1, [blocked.id("cj")], faction(P2), [blocked.id("wall")]);
  assert.equal(hasAggro(blocked.engine, blocked.id("ally")), false, "damage to a character does not trigger it");
  // attacks a location
  const loc = crushBoard({ extra: [{ key: "tower", def: location({ name: "Tower", structure: 3 }), owner: P2, zone: "play" }] });
  fightThrough(loc.engine, P1, [loc.id("cj")], { type: "card", cardId: loc.id("tower") }, []);
  assert.equal(hasAggro(loc.engine, loc.id("ally")), false, "damage to a location does not trigger it");
  // another character hits the faction
  const other = crushBoard({ extra: [{ key: "striker", def: character({ name: "Striker", strength: 2, life: 4 }), owner: P1, zone: "play" }] });
  const inf1 = other.engine.state.players[P2].influence;
  fightThrough(other.engine, P1, [other.id("striker")], faction(P2), []);
  assert.ok(other.engine.state.players[P2].influence < inf1, "other.engine.state.players[P2].influence < inf1");
  assert.equal(hasAggro(other.engine, other.id("ally")), false, "damage by another character does not trigger it");
  assert.equal(pending(other.engine), undefined);
});

clause(CRUSH, "1:rule@eeeee", "'characters YOU control': with the opponent controlling Crushjaw, their characters gain AGGRO and mine do not", () => {
  const { engine, id } = crushBoard({ owner: P2, active: P2 });
  fightThrough(engine, P2, [id("cj")], faction(P1), []);
  assert.ok(hasAggro(engine, id("ally")), "P2's character (the Crushjaw controller's) gained AGGRO");
  assert.equal(hasAggro(engine, id("foeChar")), false, "P1's character did not");
  play(engine, P2, id("newbie"));
  assert.ok(hasAggro(engine, id("newbie")), "hasAggro(engine, id(\"newbie\"))");
  assert.equal(hasAggro(engine, id("foeNewbie")), false);
});

// =====================================================================================
// Drivey Car
// =====================================================================================
const CAR = "d74d373d-baab-4886-b893-93cc0f1f84ed"; // character gearsmith vehicle, cost 1, ee, 1/3/1 -- when it leaves play: X Micromajig tokens, X = opp characters - my characters

function carBoard(opts: { mine?: number; theirs?: number; active?: PlayerId; carController?: PlayerId; extra?: CardPlacement[] } = {}) {
  const cards: CardPlacement[] = [
    { key: "car", def: printing(CAR), owner: P1, zone: "play", ...(opts.carController ? { controller: opts.carController } : {}) },
    { key: "smite", def: smiteTactic(), owner: P1, zone: "hand" },
    { key: "vanish", def: vanishTactic(), owner: P1, zone: "hand" },
    { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
    { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
    { key: "theirLoc", def: location({ name: "TheirLoc" }), owner: P2, zone: "play" }
  ];
  for (let i = 0; i < (opts.mine ?? 1); i++) cards.push({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1, zone: "play" });
  for (let i = 0; i < (opts.theirs ?? 4); i++) cards.push({ key: `t${i}`, def: character({ name: `T${i}`, strength: 5, life: 5 }), owner: P2, zone: "play" });
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 2, activePlayerId: opts.active ?? P1, random: () => 0.5, cards: [...cards, ...(opts.extra ?? [])] });
}

clause(CAR, "0:rule", "printed cost 1, threshold ee, stats 1/3/1, gearsmith vehicle: deploys with exactly enough, refused one short or with one icon short", () => {
  const def = printing(CAR);
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.subtype], ["character", "gearsmith", 1, "ee", ["vehicle"]]);
  const handBoard = (res: CardPlacement[]) => buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 2, activePlayerId: P1, cards: [{ key: "car", def: printing(CAR), owner: P1, zone: "hand" }, ...res] });
  const ok = handBoard([...bank("elitism", 1, P1), ...spentElitism(P1, 1)]);
  play(ok.engine, P1, ok.id("car"));
  assert.equal(zoneOf(ok.engine, ok.id("car")), "play");
  assert.deepEqual(statsOf(ok.engine, ok.id("car")), [1, 1, 3]);
  assert.equal(readyResources(ok.engine, P1), 0, "cost 1 paid");
  const costShort = handBoard(spentElitism(P1, 2));
  refused(() => play(costShort.engine, P1, costShort.id("car")), "cost short", /afford|resource|cost|pay/i);
  const iconShort = handBoard([...bank("elitism", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("car")), "one icon short", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("car")), "hand");
});

clause(CAR, "0:rule", "destroyed: puts X Micromajig tokens under its controller, X = characters the opponent controls minus characters I control (the Car already gone)", () => {
  const { engine, id } = carBoard({ mine: 1, theirs: 4 });
  play(engine, P1, id("smite"), { selected: { t: [id("car")] } });
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(pending(engine), undefined);
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 3, "4 opposing characters - 1 of mine = 3 tokens");
  assert.equal(micromajigs(engine, P2).length, 0, "none for the opponent");
  for (const t of tokens) {
    assert.deepEqual(statsOf(engine, t), [1, 1, 3]);
    assert.deepEqual(engine.getSubtypes(t), ["majig"]);
  }
  // a different X
  const b = carBoard({ mine: 0, theirs: 2 });
  play(b.engine, P1, b.id("smite"), { selected: { t: [b.id("car")] } });
  assert.equal(micromajigs(b.engine, P1).length, 2, "2 - 0 = 2");
});

clause(CAR, "0:rule", "X counts only characters (items, locations ignored); opponent-controlled characters I own and my-controlled ones they own count by controller", () => {
  const { engine, id } = carBoard({
    mine: 1,
    theirs: 3,
    extra: [
      { key: "lentOut", def: character({ name: "LentOut" }), owner: P1, zone: "play", controller: P2 },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }
    ]
  });
  // opponent controls t0..t2 + lentOut = 4; I control m0 + stolen = 2 (the Car is gone) -> X = 2
  play(engine, P1, id("smite"), { selected: { t: [id("car")] } });
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(CAR, "0:rule", "X of zero or less makes no tokens (and no error)", () => {
  const eq = carBoard({ mine: 2, theirs: 2 });
  play(eq.engine, P1, eq.id("smite"), { selected: { t: [eq.id("car")] } });
  assert.equal(zoneOf(eq.engine, eq.id("car")), "discard");
  assert.equal(micromajigs(eq.engine, P1).length, 0, "2 - 2 = 0 tokens");
  assert.equal(pending(eq.engine), undefined);
  const neg = carBoard({ mine: 3, theirs: 1 });
  play(neg.engine, P1, neg.id("smite"), { selected: { t: [neg.id("car")] } });
  assert.equal(micromajigs(neg.engine, P1).length, 0, "1 - 3 is negative: no tokens");
  assert.equal(micromajigs(neg.engine, P2).length, 0);
  assert.equal(pending(neg.engine), undefined);
});

clause(CAR, "0:rule", "any way of leaving play triggers it: removed from the game, or killed in battle", () => {
  const rem = carBoard({ mine: 1, theirs: 3 });
  play(rem.engine, P1, rem.id("vanish"), { selected: { t: [rem.id("car")] } });
  assert.equal(zoneOf(rem.engine, rem.id("car")), "removed");
  assert.equal(micromajigs(rem.engine, P1).length, 2, "3 - 1 = 2 tokens");

  // killed in battle: P2 attacks, the Car blocks and dies (strength 5 vs life 1)
  const { engine, id } = carBoard({ mine: 1, theirs: 4, active: P2 });
  fightThrough(engine, P2, [id("t0")], faction(P1), [id("car")]);
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(micromajigs(engine, P1).length, 3, "4 - 1 = 3 tokens");
});

clause(CAR, "0:rule", "does not trigger while it stays in play, and the tokens go to the Car's controller, not its owner", () => {
  const stay = carBoard({ mine: 1, theirs: 4 });
  play(stay.engine, P1, stay.id("smite"), { selected: { t: [stay.id("m0")] } });
  assert.equal(zoneOf(stay.engine, stay.id("car")), "play");
  assert.equal(micromajigs(stay.engine, P1).length, 0, "another character dying does not trigger the Car");

  // the Car is owned by P1 but controlled by P2: P2 gets the tokens (X: P1 controls m0 -> 1 opponent-of-P2 character; P2 controls t0..t1 + the Car)
  const { engine, id } = carBoard({ mine: 3, theirs: 1, carController: P2 });
  play(engine, P1, id("smite"), { selected: { t: [id("car")] } });
  assert.equal(zoneOf(engine, id("car")), "discard");
  // controller is P2: opponent (P1) controls 3 characters, P2 controls 1 -> X = 2
  assert.equal(micromajigs(engine, P2).length, 2, "the controller (P2) gets the tokens");
  assert.equal(micromajigs(engine, P1).length, 0, "not the owner");
});

// =====================================================================================
// Enormous and Uncooperative Golem
// =====================================================================================
const GOLEM = "01186631-824e-4ec8-979b-69f6e3db5750"; // character gearsmith golem, cost 1, ee, 1/3/1 -- EXTRA COST: choose X, pay X. Enters with X tokens; remove one at start of your turn; with a token +5/+5

function golemHand(res: CardPlacement[]) {
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 2, activePlayerId: P1, random: () => 0.5, cards: [{ key: "golem", def: printing(GOLEM), owner: P1, zone: "hand" }, ...res] });
}

function golemPlay(tokens: number, owner: PlayerId = P1, active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [{ key: "golem", def: printing(GOLEM), owner, zone: "play", counters: tokens ? { token: tokens } : undefined }]
  });
}

clause(GOLEM, "0:extraCost", "printed cost 1, threshold ee, 1/3/1 golem; X is chosen and paid on top of the cost (cost 1 + X resources)", () => {
  const def = printing(GOLEM);
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.subtype], ["character", "gearsmith", 1, "ee", ["golem"]]);
  // X=0: cost 1 only; threshold met via a spent icon
  const zero = golemHand([...bank("elitism", 1, P1), ...spentElitism(P1, 1)]);
  play(zero.engine, P1, zero.id("golem"), { variables: { x: 0 } });
  assert.equal(zoneOf(zero.engine, zero.id("golem")), "play");
  assert.equal(readyResources(zero.engine, P1), 0, "X=0: only the printed cost 1");
  // X=2: 3 resources
  const two = golemHand(bank("elitism", 4, P1));
  play(two.engine, P1, two.id("golem"), { variables: { x: 2 } });
  assert.equal(zoneOf(two.engine, two.id("golem")), "play");
  assert.equal(readyResources(two.engine, P1), 1, "X=2: cost 1 + 2 paid");
  // X=3 with 4 ready
  const three = golemHand(bank("elitism", 4, P1));
  play(three.engine, P1, three.id("golem"), { variables: { x: 3 } });
  assert.equal(readyResources(three.engine, P1), 0, "X=3: cost 1 + 3 paid");
});

clause(GOLEM, "0:extraCost", "refused when X plus the printed cost cannot be paid, or an icon is short", () => {
  const cost0 = golemHand(spentElitism(P1, 2));
  refused(() => play(cost0.engine, P1, cost0.id("golem"), { variables: { x: 0 } }), "no ready resource for cost 1", /afford|resource|cost|pay/i);
  const short = golemHand(bank("elitism", 2, P1));
  refused(() => play(short.engine, P1, short.id("golem"), { variables: { x: 2 } }), "X=2 needs 3 resources, only 2", /afford|resource|cost|pay/i);
  assert.equal(zoneOf(short.engine, short.id("golem")), "hand");
  const ok = golemHand(bank("elitism", 2, P1));
  play(ok.engine, P1, ok.id("golem"), { variables: { x: 1 } });
  assert.equal(zoneOf(ok.engine, ok.id("golem")), "play", "control: X=1 with 2 resources works");
  const icon = golemHand([...bank("elitism", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => play(icon.engine, P1, icon.id("golem"), { variables: { x: 2 } }), "threshold ee: one elitism icon short", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(icon.engine, icon.id("golem")), "hand");
});

clause(GOLEM, "0:extraCost", "X must be a whole number of at least 0 (a negative or fractional X is refused)", () => {
  const neg = golemHand(bank("elitism", 4, P1));
  refused(() => play(neg.engine, P1, neg.id("golem"), { variables: { x: -1 } }), "negative X", /cost|pay|x|variable|bound|number|invalid/i);
  assert.equal(zoneOf(neg.engine, neg.id("golem")), "hand");
  const frac = golemHand(bank("elitism", 4, P1));
  refused(() => play(frac.engine, P1, frac.id("golem"), { variables: { x: 1.5 } }), "fractional X", /cost|pay|x|variable|bound|number|invalid|integer/i);
  assert.equal(zoneOf(frac.engine, frac.id("golem")), "hand");
});

clause(GOLEM, "1:rule", "enters play with X tokens on it (X=0: none; X=1; X=3) and only then is it big", () => {
  for (const x of [0, 1, 3]) {
    const b = golemHand(bank("elitism", 4, P1));
    play(b.engine, P1, b.id("golem"), { variables: { x } });
    assert.equal(zoneOf(b.engine, b.id("golem")), "play");
    assert.equal(tokensOn(b.engine, b.id("golem")), x, `X=${x} tokens`);
    assert.deepEqual(statsOf(b.engine, b.id("golem")), x ? [6, 6, 3] : [1, 1, 3], `X=${x} stats`);
  }
});

clause(GOLEM, "2:rule", "at the start of MY turn one token is removed; the opponent's turn start removes nothing; it stops at 0", () => {
  const { engine, id } = golemPlay(2);
  endTurn(engine, P1); // start of P2's turn
  assert.equal(tokensOn(engine, id("golem")), 2, "the opponent's turn start removes nothing");
  endTurn(engine, P2); // start of P1's turn
  assert.equal(tokensOn(engine, id("golem")), 1, "my turn start removes one token");
  endTurn(engine, P1);
  assert.equal(tokensOn(engine, id("golem")), 1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("golem")), 0, "next turn start removes the last");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("golem")), 0, "never goes below 0");
  assert.equal(pending(engine), undefined);
});

clause(GOLEM, "2:rule", "'your turn' follows the controller: a P1-owned Golem controlled by P2 sheds at P2's turn start, not P1's", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [{ key: "golem", def: printing(GOLEM), owner: P1, controller: P2, zone: "play", counters: { token: 2 } }]
  });
  endTurn(b.engine, P2); // start of P1's turn
  assert.equal(tokensOn(b.engine, b.id("golem")), 2, "the owner's turn start does not shed");
  endTurn(b.engine, P1); // start of P2's turn
  assert.equal(tokensOn(b.engine, b.id("golem")), 1, "the controller's turn start sheds");
});

clause(GOLEM, "3:rule", "while there is a token it gains 5 strength and 5 life; with none it is 1/1; any number of tokens gives exactly +5/+5", () => {
  const none = golemPlay(0);
  assert.deepEqual(statsOf(none.engine, none.id("golem")), [1, 1, 3], "no tokens: printed 1/1");
  const one = golemPlay(1);
  assert.deepEqual(statsOf(one.engine, one.id("golem")), [6, 6, 3], "one token: +5/+5, speed unchanged");
  const three = golemPlay(3);
  assert.deepEqual(statsOf(three.engine, three.id("golem")), [6, 6, 3], "three tokens: still just +5/+5");
  // the bonus switches off when the last token goes, and a token arriving switches it on
  endTurn(one.engine, P1);
  endTurn(one.engine, P2);
  assert.equal(tokensOn(one.engine, one.id("golem")), 0);
  assert.deepEqual(statsOf(one.engine, one.id("golem")), [1, 1, 3], "last token gone: back to 1/1");
  one.engine.state.cards[one.id("golem")].counters = { token: 1 };
  assert.deepEqual(statsOf(one.engine, one.id("golem")), [6, 6, 3], "a token again: +5/+5 again");
  // the opponent's Golem also gets it
  const theirs = golemPlay(1, P2, P1);
  assert.deepEqual(statsOf(theirs.engine, theirs.id("golem")), [6, 6, 3]);
});
