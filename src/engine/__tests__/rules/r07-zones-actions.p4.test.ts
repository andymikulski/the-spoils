// Batch r07-zones-actions, part 4 (docs/TESTING.md): CR 403 Game Areas (deck, hand, being deployed, in play, discard
// pile, out of game, void). Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect, GameEvent, SpoilsEngine, TargetDeclaration } from "../../../engine.js";
import { createFactionGame } from "../../../engine.js";
import { logMessageFor } from "../../../types/log.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";
import { developPlay, settleTurnStart } from "../support/develop.js";

const pick = (id: string) => ({ type: "selected" as const, id });

const spell = (name: string, effects: Effect[], targets: TargetDeclaration[] = []): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", targets, effects }] } });

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const events = (engine: SpoilsEngine, type: GameEvent["type"]) =>
  engine.getLog().filter(entry => entry.event?.type === type).map(entry => entry.event!);

function cast(built: ReturnType<typeof buildGame>, key: string, selected: Record<string, string[]> = {}, player = P1): void {
  built.engine.perform({ type: "playCard", playerId: player, cardId: built.id(key), selected });
  resolvePendingResponses(built.engine);
  assert.equal(built.engine.state.pendingChoice, undefined, "the spell needed no further answer");
}

const deckOf = (n: number, owner = P1, prefix = "d"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

/** A faction whose Develop Rule offers draw or play-a-resource. */
const developFaction = (): CardDefinition =>
  factionCard({
    faction: defaultFactionDefinition({
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
      }
    })
  });

describe("CR 403.1 — deck", () => {
  rule("CR 403.1a", "the deck is the pile of cards brought to the game EXCLUDING the faction: the faction starts in play, not in the deck", () => {
    const filler = character({ name: "Filler", life: 2 });
    const faction = factionCard({ name: "Plain", faction: defaultFactionDefinition() });
    const engine = createFactionGame(
      [faction, filler],
      [{ id: P1, name: "Alice", factionDefinitionId: faction.id, deckDefinitionIds: Array(10).fill(filler.id) },
      { id: P2, name: "Bob", factionDefinitionId: faction.id, deckDefinitionIds: Array(10).fill(filler.id) }],
      { firstPlayerId: P1, seed: 99 }
    );
    for (const player of [P1, P2]) {
      const state = engine.state.players[player]!;
      const factionId = state.factionId!;
      assert.ok(factionId, `${player} has a faction card`);
      assert.equal(zone(engine, factionId), "play", "the faction is in play");
      assert.ok(!state.deck.includes(factionId), "and not in the deck");
      const cards = Object.values(engine.state.cards).filter(card => card.ownerId === player);
      assert.equal(cards.length, 11, "ten deck cards plus the faction");
      assert.equal(
        cards.filter(card => card.zone === "deck" || card.zone === "hand").length,
        10,
        "all ten non-faction cards are in the deck or opening hand"
      );
      assert.ok(
        state.deck.every(cardId => engine.getDefinition(cardId).type !== "faction"),
        "no faction card anywhere in the deck"
      );
    }
  });

  rule("CR 403.1a", "no player action looks through or shuffles a deck: shuffling happens only when an instruction says so", () => {
    const built = buildGame({
      random: () => 0.37,
      cards: [{ key: "idle", def: spell("Idle", []), owner: P1, zone: "hand" }, ...deckOf(8), ...deckOf(8, P2, "o")]
    });
    const { engine } = built;
    const mine = [...engine.state.players[P1].deck];
    const theirs = [...engine.state.players[P2].deck];
    // The action vocabulary has no "shuffle" or "look" action: whether an unknown action is refused or ignored, nothing happens.
    for (const type of ["shuffleDeck", "lookAtDeck", "searchDeck"]) {
      try {
        engine.perform({ type, playerId: P1 } as never);
      } catch {
        /* refused is fine */
      }
    }
    assert.deepEqual(engine.state.players[P1].deck, mine, "no player action reordered the deck");
    assert.equal(events(engine, "deckShuffled").length, 0, "and none shuffled it");
    cast(built, "idle");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2, "the turn passed");
    assert.deepEqual(engine.state.players[P1].deck, mine, "my deck order never changed");
    assert.deepEqual(engine.state.players[P2].deck, theirs, "their deck order never changed");
    assert.equal(events(engine, "deckShuffled").length, 0, "no shuffle was recorded");
  });

  rule("CR 403.1a", "control: an instruction to shuffle does shuffle the deck", () => {
    const built = buildGame({
      random: () => 0.37,
      cards: [{ key: "mix", def: spell("Mix", [{ type: "shuffleDeck", player: "controller" }]), owner: P1, zone: "hand" }, ...deckOf(8)]
    });
    cast(built, "mix");
    assert.equal(events(built.engine, "deckShuffled").length, 1);
  });

  ruleExempt("CR 403.1b", "Only defines the word 'deck' for the whole tournament selection including the faction, outside a game; no engine behavior (deck construction rules are CR 103, batch r11).");
});

describe("CR 403.2 — hand", () => {
  rule("CR 403.2a", "the front of a card in your hand is hidden from your opponent: a drawn card is named to its holder only", () => {
    const built = buildGame({
      cards: [
        { key: "draw", def: spell("Draw", [{ type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" },
        { key: "secret", def: character({ name: "Secret Weapon" }), owner: P1, zone: "deck" }
      ]
    });
    cast(built, "draw");
    const moved = built.engine.getLog().find(entry => entry.event?.type === "cardMoved" && (entry.event as { to: string }).to === "hand");
    assert.ok(moved, "a draw is logged");
    assert.match(logMessageFor(moved!, P1), /Secret Weapon/, "the holder sees the card");
    assert.doesNotMatch(logMessageFor(moved!, P2), /Secret Weapon/, "the opponent does not");
    assert.doesNotMatch(logMessageFor(moved!, null), /Secret Weapon/, "nor does a spectator");
  });

  rule("CR 403.2a", "a card in the opponent's hand is hidden from you, but a reveal shows it to the people the effect names", () => {
    const peek = spell("Peek", [{ type: "reveal", of: "opponent", zone: "hand", viewer: "controller" }]);
    const built = buildGame({ cards: [{ key: "peek", def: peek, owner: P1, zone: "hand" }, { key: "held", def: character({ name: "Held Card" }), owner: P2, zone: "hand" }] });
    cast(built, "peek");
    const entry = built.engine.getLog().find(e => e.event?.type === "cardsRevealed");
    assert.ok(entry, "the look is logged");
    assert.match(logMessageFor(entry!, P1), /Held Card/, "the looker sees the card");
    assert.doesNotMatch(logMessageFor(entry!, null), /Held Card/, "the public line does not name it");
  });

  rule("CR 403.2b", "there is no hand-size limit: a hand of 25 cards stays whole through the end of the turn", () => {
    const cards: CardPlacement[] = Array.from({ length: 25 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const }));
    const built = buildGame({ cards });
    const { engine } = built;
    assert.equal(engine.state.players[P1].hand.length, 25);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.pendingChoice, undefined, "no discard-down prompt");
    assert.equal(engine.state.players[P1].hand.length, 25, "no card was discarded for hand size");
    assert.equal(engine.state.players[P1].discard.length, 0);
  });

  rule("CR 403.2b", "drawing past any particular size is allowed: draw 12 into a hand of 12 for 24", () => {
    const built = buildGame({
      cards: [
        { key: "draw", def: spell("Draw12", [{ type: "draw", player: "controller", amount: 12 }]), owner: P1, zone: "hand" },
        ...Array.from({ length: 11 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
        ...deckOf(12)
      ]
    });
    cast(built, "draw");
    assert.equal(built.engine.state.players[P1].hand.length, 11 + 12, "the whole draw went into the hand");
    assert.equal(built.engine.state.players[P1].discard.length, 1, "only the played spell is in the discard pile");
  });
});

describe("CR 403.3 — being deployed", () => {
  rule("CR 403.3a", "a non-resource card played from hand goes to Being Deployed and stays until the opponent is done responding", () => {
    const built = buildGame({ cards: [{ key: "t", def: spell("T", []), owner: P1, zone: "hand" }, { key: "reply", def: spell("Reply", []), owner: P2, zone: "hand" }] });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    assert.equal(zone(engine, id("t")), "deploying", "in the Being Deployed area");
    assert.ok(!engine.state.players[P1].hand.includes(id("t")), "no longer in hand");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(zone(engine, id("t")), "deploying", "still there while the opponent responds");
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(zone(engine, id("reply")), "discard", "the response resolved");
    assert.equal(zone(engine, id("t")), "deploying", "and the original still waits for the opponent to finish");
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("t")), "discard", "it resolved once the opponent was done");
  });

  rule("CR 403.3a", "a character deploys through Being Deployed and then enters play", () => {
    const built = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(zone(engine, id("c")), "deploying");
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("c")), "play");
  });

  rule("CR 403.3a", "a card being deployed has not entered play yet: its abilities cannot be used (control: they can once in play)", () => {
    const worker = () =>
      character({ name: "Worker", behavior: { abilities: [{ id: "w", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] } });
    const built = buildGame({ cards: [{ key: "w", def: worker(), owner: P1, zone: "hand" }] });
    engine_deployWait(built);
    refused(
      () => built.engine.perform({ type: "activateAbility", playerId: P1, cardId: built.id("w"), abilityId: "w" }),
      "use an ability of a card still being deployed"
    );
    resolvePendingResponses(built.engine);
    built.engine.perform({ type: "activateAbility", playerId: P1, cardId: built.id("w"), abilityId: "w" });
    assert.equal(built.engine.state.responseStack.length, 1, "control: in play, the ability can be used");
  });

  rule("CR 403.3a", "only NON-resource cards are deployed: a resource card played as a resource goes straight to play", () => {
    const built = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "r", def: resourceCard({ name: "Rage" }), owner: P1, zone: "hand" }]
    });
    developPlay(built.engine, P1, built.id("r"));
    assert.equal(zone(built.engine, built.id("r")), "play", "straight into play");
    assert.equal(built.engine.state.responseStack.length, 0, "never on the stack, nothing to respond to");
  });
});

describe("CR 403.4 — in play", () => {
  rule("CR 403.4a", "cards in play can act: a character's activated ability works in play and is refused from hand", () => {
    const worker = () =>
      character({ name: "Worker", behavior: { abilities: [{ id: "w", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] } });
    const inPlay = buildGame({ cards: [{ key: "w", def: worker(), owner: P1 }] });
    inPlay.engine.perform({ type: "activateAbility", playerId: P1, cardId: inPlay.id("w"), abilityId: "w" });
    resolvePendingResponses(inPlay.engine);
    assert.equal(inPlay.engine.state.players[P1].influence, 26, "control: in play it works");
    for (const where of ["hand", "deck", "discard"] as const) {
      const away = buildGame({ cards: [{ key: "w", def: worker(), owner: P1, zone: where }] });
      refused(
        () => away.engine.perform({ type: "activateAbility", playerId: P1, cardId: away.id("w"), abilityId: "w" }),
        `use an ability of a card in the ${where}`
      );
    }
  });

  rule("CR 403.4a", "most cards do nothing until in play: a +2 strength aura only works from play, not from hand", () => {
    const lord = () =>
      character({
        name: "Lord",
        behavior: {
          abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }]
        }
      });
    const inPlay = buildGame({ cards: [{ key: "l", def: lord(), owner: P1 }] });
    assert.equal(inPlay.engine.getStat(inPlay.id("l"), "strength"), 3, "1 printed + 2 while in play");
    const inHand = buildGame({ cards: [{ key: "l", def: lord(), owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C", strength: 1 }), owner: P1 }] });
    assert.equal(inHand.engine.getStat(inHand.id("c"), "strength"), 1, "an unrelated card is unaffected by the one in hand");
  });

  rule("CR 403.4a", "a triggered ability of a card in hand does not fire; the same card in play does", () => {
    const watcher = () =>
      character({
        name: "Watcher",
        behavior: { abilities: [{ id: "t", type: "triggered", event: "turnEnding", effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
      });
    const run = (where: "play" | "hand") => {
      const built = buildGame({ cards: [{ key: "w", def: watcher(), owner: P1, zone: where }] });
      const before = built.engine.state.players[P1].influence;
      const turn = built.engine.state.turn;
      built.engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(built.engine);
      // The trigger fires at the end of every turn; seats between P1 and P2 end turns of their own: count the gain per turn ended.
      return (built.engine.state.players[P1].influence - before) / (built.engine.state.turn - turn);
    };
    assert.equal(run("play"), 5, "control: in play it triggers");
    assert.equal(run("hand"), 0, "in hand it does nothing");
  });

  rule("CR 403.4a", "cards put into play (not deployed) are in play too: a card moved there is in the play area", () => {
    const put = spell("Put", [{ type: "putIntoPlay", target: pick("t"), controller: "controller" }], [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }]);
    const built = buildGame({ cards: [{ key: "put", def: put, owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C" }), owner: P1, zone: "discard" }] });
    cast(built, "put", { t: [built.id("c")] });
    assert.equal(zone(built.engine, built.id("c")), "play");
    assert.ok(built.engine.state.players[P1].play.includes(built.id("c")), "listed in the player's play area");
  });
});

describe("CR 403.5 — discard pile", () => {
  rule("CR 403.5a", "destroyed cards go to their owner's discard pile, face-up: both players can read the name", () => {
    const built = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Doomed Knight" }), owner: P2 },
        { key: "kill", def: spell("Kill", [{ type: "destroy", target: pick("t") }], [{ id: "t", selector: {}, count: 1 }]), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "kill", { t: [built.id("victim")] });
    assert.ok(built.engine.state.players[P2].discard.includes(built.id("victim")), "in its owner's pile");
    assert.equal(built.engine.state.cards[built.id("victim")]!.faceDown, false, "face-up");
    const line = built.engine.getLog().find(entry => entry.event?.type === "cardDestroyed" || (entry.event?.type === "cardMoved" && (entry.event as { to: string }).to === "discard"));
    assert.ok(line, "the move is logged");
    for (const viewer of [P1, P2, null] as const) {
      assert.match(logMessageFor(line!, viewer), /Doomed Knight/, `${String(viewer)} can read the destroyed card`);
    }
  });

  rule("CR 403.5a", "discarded cards go to the discard pile and are public: the opponent reads the name of a card discarded from hand", () => {
    const disc = spell("Disc", [{ type: "moveCard", target: pick("t"), to: "discard" }], [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }]);
    const built = buildGame({ cards: [{ key: "d", def: disc, owner: P1, zone: "hand" }, { key: "h", def: character({ name: "Cast Away" }), owner: P1, zone: "hand" }] });
    cast(built, "d", { t: [built.id("h")] });
    assert.ok(built.engine.state.players[P1].discard.includes(built.id("h")), "the card is in its owner's discard pile");
    const line = built.engine.getLog().find(
      entry => entry.event?.type === "cardMoved" && (entry.event as { cardId: string; to: string }).cardId === built.id("h") && (entry.event as { to: string }).to === "discard"
    );
    assert.ok(line, "the discard is logged");
    assert.match(logMessageFor(line!, P2), /Cast Away/, "the opponent can read what was discarded");
    assert.match(logMessageFor(line!, null), /Cast Away/, "and so can a spectator");
  });

  rule("CR 403.5b", "the order of the discard pile does not matter: the oldest and the newest card can each be picked from it", () => {
    const fetch = () =>
      spell("Fetch", [{ type: "moveCard", target: pick("t"), to: "hand" }], [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }]);
    const piles = () =>
      [
        { key: "first", def: character({ name: "First" }), owner: P1, zone: "discard" },
        { key: "middle", def: character({ name: "Middle" }), owner: P1, zone: "discard" },
        { key: "last", def: character({ name: "Last" }), owner: P1, zone: "discard" },
        { key: "f", def: fetch(), owner: P1, zone: "hand" }
      ] as CardPlacement[];
    for (const target of ["first", "middle", "last"]) {
      const built = buildGame({ cards: piles() });
      cast(built, "f", { t: [built.id(target)] });
      assert.equal(zone(built.engine, built.id(target)), "hand", `${target} could be taken whatever its position`);
    }
  });
});

describe("CR 403.6 — out of game", () => {
  const withTarget = [{ id: "t", selector: {}, count: 1 }] as TargetDeclaration[];

  rule("CR 403.6a", "a card removed from the game goes to the out-of-game area, face-up and visible to everyone", () => {
    const built = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Exiled Mage" }), owner: P2 },
        { key: "b", def: spell("Banish", [{ type: "removeFromGame", target: pick("t") }], withTarget), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "b", { t: [built.id("victim")] });
    const { engine, id } = built;
    assert.equal(zone(engine, id("victim")), "removed");
    assert.equal(engine.state.cards[id("victim")]!.faceDown, false, "set aside face-up");
    assert.ok(!engine.state.players[P2].play.includes(id("victim")), "no longer in play");
    assert.ok(!engine.state.players[P2].discard.includes(id("victim")), "and not in the discard pile");
    const line = engine.getLog().find(entry => entry.event?.type === "cardMoved" && (entry.event as { to: string }).to === "removed");
    assert.ok(line, "the removal is logged");
    assert.match(logMessageFor(line!, P1), /Exiled Mage/);
    assert.match(logMessageFor(line!, null), /Exiled Mage/);
  });

  rule("CR 403.6a", "a removed card stays set aside: the discard pile's selectors cannot reach it (control: they reach a discarded card)", () => {
    const retrieve = () =>
      spell("Retrieve", [{ type: "moveCard", target: pick("t"), to: "hand" }], [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }]);
    const make = () =>
      buildGame({
        cards: [
          { key: "gone", def: character({ name: "Gone" }), owner: P1, zone: "removed" },
          { key: "binned", def: character({ name: "Binned" }), owner: P1, zone: "discard" },
          { key: "r", def: retrieve(), owner: P1, zone: "hand" }
        ]
      });
    const control = make();
    cast(control, "r", { t: [control.id("binned")] });
    assert.equal(zone(control.engine, control.id("binned")), "hand", "control: a discarded card can be fetched");
    const built = make();
    refused(
      () => built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("r"), selected: { t: [built.id("gone")] } }),
      "fetch a removed card from the discard pile"
    );
    assert.equal(zone(built.engine, built.id("gone")), "removed", "still out of the game");
  });

  rule("CR 403.6a", "the out-of-game area is separate from the discard pile (a removed card is not a discarded one)", () => {
    const built = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: spell("Banish", [{ type: "removeFromGame", target: pick("t") }], withTarget), owner: P1, zone: "hand" },
        { key: "k", def: spell("Kill", [{ type: "destroy", target: pick("t") }], withTarget), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1 }
      ]
    });
    cast(built, "b", { t: [built.id("a")] });
    cast(built, "k", { t: [built.id("c")] });
    assert.equal(zone(built.engine, built.id("a")), "removed");
    assert.equal(zone(built.engine, built.id("c")), "discard");
  });
});

describe("CR 403.7 — void", () => {
  const toVoid = (faceDown?: boolean) =>
    spell("ToVoid", [{ type: "moveCard", target: pick("t"), to: "void", ...(faceDown ? { faceDown: true } : {}) }], [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }]);

  rule("CR 403.7a", "a card sent to the Void goes to the void zone, not the discard pile or out of the game", () => {
    const built = buildGame({ cards: [{ key: "v", def: toVoid(), owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    cast(built, "v", { t: [built.id("c")] });
    assert.equal(zone(built.engine, built.id("c")), "void");
    assert.ok(!built.engine.state.players[P1].discard.includes(built.id("c")), "not in the discard pile");
  });

  rule("CR 403.7a", "the Void can receive a card face-up (by default)", () => {
    const built = buildGame({ cards: [{ key: "v", def: toVoid(), owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    cast(built, "v", { t: [built.id("c")] });
    assert.equal(built.engine.state.cards[built.id("c")]!.faceDown, false, "face-up");
  });

  rule("CR 403.7a", "the Void can receive a card face-down when the rules that put it there say so", () => {
    const built = buildGame({ cards: [{ key: "v", def: toVoid(true), owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    cast(built, "v", { t: [built.id("c")] });
    assert.equal(zone(built.engine, built.id("c")), "void");
    assert.equal(built.engine.state.cards[built.id("c")]!.faceDown, true, "face-down in the Void");
  });

  const fetchFromVoid = (selector: TargetDeclaration["selector"]) =>
    spell("Fetch", [{ type: "moveCard", target: pick("t"), to: "hand" }], [{ id: "t", selector: { zone: "void", owner: "self", ...selector }, count: 1 }]);
  const voidBoard = () =>
    buildGame({
      cards: [
        { key: "up", def: character({ name: "Up" }), owner: P1, zone: "void" },
        { key: "down", def: character({ name: "Down" }), owner: P1, zone: "void", faceDown: true },
        { key: "plain", def: fetchFromVoid({}), owner: P1, zone: "hand" },
        { key: "downOnly", def: fetchFromVoid({ faceDown: true }), owner: P1, zone: "hand" }
      ]
    });

  rule("CR 403.7b", "control: a face-up card in the void can be picked", () => {
    const built = voidBoard();
    cast(built, "plain", { t: [built.id("up")] });
    assert.equal(zone(built.engine, built.id("up")), "hand");
  });

  rule("CR 403.7b", "a face-down card in the void cannot be picked or chosen by an effect that does not specify a face-down card in the void",
    () => {
      const built = voidBoard();
      refused(
        () => built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("plain"), selected: { t: [built.id("down")] } }),
        "pick a face-down card in the void with a plain void selector"
      );
      assert.equal(zone(built.engine, built.id("down")), "void", "it stays in the void");
    }
  );

  rule("CR 403.7b", "an effect that specifies a face-down card in the void can pick it", () => {
    const built = voidBoard();
    cast(built, "downOnly", { t: [built.id("down")] });
    assert.equal(zone(built.engine, built.id("down")), "hand", "picked because the effect asked for a face-down card");
  });

  rule("CR 403.7b", "an effect that specifies a face-down card in the void does not pick a face-up one", () => {
    const built = voidBoard();
    refused(
      () => built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("downOnly"), selected: { t: [built.id("up")] } }),
      "pick a face-up card with a face-down-only selector"
    );
    assert.equal(zone(built.engine, built.id("up")), "void");
  });
});

/** Plays `w` from hand and stops with it still being deployed (the opponent may respond). */
function engine_deployWait(built: ReturnType<typeof buildGame>): void {
  built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("w") });
  assert.equal(zone(built.engine, built.id("w")), "deploying", "setup: the card is being deployed");
}
