// Clause tests, batch holy-heist-05, part p1 (groups 1-5, missing clauses only).
// Node in a Box, Prime Titan, RC Flashlight, Runic Distribulator, Scrapple-Jack.
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { answerPending, declareBlockers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, finishBattle, playRaw } from "./_battle.js";

const NODEBOX = "15172964-a78f-4d08-bf1c-5b80eb02f544"; // character gearsmith node cost 2 "e" 1/1/2 -- ETB tutor node; flip instead of destroyed; destroy all other nodes
const TITAN = "904f34cf-c340-4bfd-941b-3d1bb9178843"; // character gearsmith warmachine cost 6 "ee" 4/4/4 -- UNIQUE PT; +1/+1 per token; LOAD; UNLOAD
const FLASH = "4025a8f7-ffbe-45b0-ae3c-41624ea54b33"; // character gearsmith machine cost 3 "ee" 1/3/3 -- cannot be blocked; can block COVERT parties
const RUNIC = "5da0f895-473d-45a1-a6a7-5fd1293344fd"; // item gearsmith cost 0 "eee" -- LOAD; GATHER; SPREAD OUT!
const SCRAP = "758adb58-e5d6-47c2-9545-a06561dfc92a"; // character gearsmith horsemajig cost 1 "ee" 1/3/1 -- EXTRA COST destroy a Micromajig token; ETB item back

// --- shared helpers -------------------------------------------------------------

/** A Micromajig token (a 1/1/3 'majig' character). Keys starting with "mm" are flagged isToken by `board`. */
const micro = (key: string, owner = P1): CardPlacement => ({
  key,
  def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }),
  owner,
  zone: "play"
});

const board = (cards: CardPlacement[], extra: { turn?: number; activePlayerId?: string } = {}) => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards,
    ...(extra as object)
  } as never);
  for (const card of cards) if (card.key.startsWith("mm")) game.engine.state.cards[game.id(card.key)].isToken = true;
  return game;
};

const inPlayNamed = (engine: SpoilsEngine, player: string, name: string) =>
  engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).name === name);

const smite = (): CardDefinition =>
  tactic({
    name: "Smite",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "smite",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  } as never);

const zap = (amount: number): CardDefinition =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  } as never);

const payYes = (pc: { kind: string; [key: string]: unknown }): unknown =>
  pc.kind === "mayPay"
    ? { kind: "mayPay", pay: true }
    : pc.kind === "replacementChoice"
      ? { kind: "replacementChoice", apply: true }
      : declineAll(pc);

const pickWith = (selected: string[]) => (pc: { kind: string; [key: string]: unknown }): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc);

// =====================================================================================
// Node in a Box — character (gearsmith, node), cost 2, threshold [E], 1 strength / 1 speed / 2 life
// =====================================================================================

const nbBoard = (extra: CardPlacement[] = [], resources = 6) =>
  board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "hand" },
    { key: "node1", def: character({ name: "Node One", subtype: ["node"] }), owner: P1, zone: "deck" },
    { key: "node2", def: character({ name: "Node Two", subtype: ["node"] }), owner: P1, zone: "deck" },
    { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "deck" },
    { key: "enemyNode", def: character({ name: "Enemy Node", subtype: ["node"] }), owner: P2, zone: "deck" },
    ...bank("elitism", resources, P1),
    ...extra
  ]);

clause(NODEBOX, "0:rule", "entering play lets me search my deck for a node card: it is revealed and goes to my hand", () => {
  const { engine, id } = nbBoard();
  const deckBefore = engine.state.players[P1].deck.length;
  const resBefore = readyResources(engine, P1);
  play(engine, P1, id("nb"));
  assert.equal(resBefore - readyResources(engine, P1), 2, "printed cost 2 is paid");
  const pc = pending(engine);
  assert.ok(pc, "I am asked to pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  drain(engine, pickWith([id("node1")]));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("nb")), "play");
  assert.equal(zoneOf(engine, id("node1")), "hand", "the node card is in my hand");
  assert.equal(engine.state.players[P1].deck.length, deckBefore - 1, "only one card left the deck");
  assert.equal(zoneOf(engine, id("node2")), "deck", "the other node stays in the deck");
  assert.equal(zoneOf(engine, id("plain")), "deck");
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("node1")], "the found card is revealed");
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(NODEBOX, "0:rule", "the search is optional (I may find nothing): no card moves", () => {
  const { engine, id } = nbBoard();
  const deckBefore = [...engine.state.players[P1].deck].sort();
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("nb"));
  assert.ok(pending(engine), "pending(engine)");
  drain(engine, pickWith([]));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("nb")), "play");
  assert.deepEqual([...engine.state.players[P1].deck].sort(), deckBefore, "deck keeps every card");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1, "only the played card left my hand");
  assert.equal(engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").length, 0, "nothing revealed");
});

clause(NODEBOX, "0:rule", "only node cards in MY deck can be found: a non-node, the opponent's node, and a node in my hand or discard are refused", () => {
  const { engine, id } = nbBoard([
    { key: "handNode", def: character({ name: "Hand Node", subtype: ["node"] }), owner: P1, zone: "hand" },
    { key: "discNode", def: character({ name: "Disc Node", subtype: ["node"] }), owner: P1, zone: "discard" }
  ]);
  play(engine, P1, id("nb"));
  const resolve = (cardId: string) =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(() => resolve(id("plain")), "a non-node card", /./);
  refused(() => resolve(id("enemyNode")), "the opponent's node", /./);
  refused(() => resolve(id("handNode")), "a node in hand", /./);
  refused(() => resolve(id("discNode")), "a node in discard", /./);
  assert.ok(pending(engine), "still waiting for a legal pick");
  resolve(id("node2"));
  assert.equal(zoneOf(engine, id("node2")), "hand", "a real node is accepted (positive control)");
});

clause(NODEBOX, "0:rule", "only when THIS card enters play: another card entering play does not trigger the search", () => {
  const { engine, id } = nbBoard([{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }]);
  play(engine, P1, id("nb"));
  drain(engine, pickWith([]));
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(pending(engine), undefined, "no search for the second card");
});

// -- replacement: pay 1 to flip face-down instead of being destroyed -----------

clause(NODEBOX, "0:rule", "a node card: only ONE can be picked ('a \"node\" card'): picking two is refused", () => {
  const { engine, id } = nbBoard();
  play(engine, P1, id("nb"));
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("node1"), id("node2")] } } as never),
    "two node cards",
    /./
  );
  assert.equal(zoneOf(engine, id("node1")), "deck");
  assert.equal(zoneOf(engine, id("node2")), "deck");
  drain(engine, pickWith([id("node1")]));
  assert.equal(zoneOf(engine, id("node1")), "hand", "one node is fine (positive control)");
  assert.equal(zoneOf(engine, id("node2")), "deck");
});

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const shuffleBoard = () =>
  board(
    [
      { key: "nb", def: printing(NODEBOX), owner: P1, zone: "hand" },
      { key: "node1", def: character({ name: "Node One", subtype: ["node"] }), owner: P1, zone: "deck" },
      ...Array.from({ length: 12 }, (_, i): CardPlacement => ({ key: `mine${i}`, def: character({ name: `Mine ${i}` }), owner: P1, zone: "deck" })),
      ...Array.from({ length: 12 }, (_, i): CardPlacement => ({ key: `opp${i}`, def: character({ name: `Opp ${i}` }), owner: P2, zone: "deck" })),
      ...bank("elitism", 6, P1)
    ],
    { random: seeded(12345) } as never
  );

clause(NODEBOX, "0:rule", "a searched deck is shuffled afterward (CR 312.1): my deck changes order, the opponent's deck does not", () => {
  const { engine, id } = shuffleBoard();
  const mineBefore = engine.state.players[P1].deck.filter((c) => c !== id("node1"));
  const oppBefore = [...engine.state.players[P2].deck];
  play(engine, P1, id("nb"));
  drain(engine, pickWith([id("node1")]));
  assert.equal(zoneOf(engine, id("node1")), "hand");
  const mineAfter = [...engine.state.players[P1].deck];
  assert.deepEqual([...mineAfter].sort(), [...mineBefore].sort(), "the same cards remain");
  assert.notDeepEqual(mineAfter, mineBefore, "my deck was shuffled");
  assert.deepEqual(engine.state.players[P2].deck, oppBefore, "the opponent's deck was not touched");
});

clause(NODEBOX, "0:rule", "searching and finding nothing still shuffles my deck (CR 312.1), the opponent's deck is untouched", () => {
  const { engine, id } = shuffleBoard();
  const mineBefore = [...engine.state.players[P1].deck];
  const oppBefore = [...engine.state.players[P2].deck];
  play(engine, P1, id("nb"));
  drain(engine, pickWith([]));
  assert.equal(zoneOf(engine, id("node1")), "deck", "nothing was taken");
  assert.notDeepEqual(engine.state.players[P1].deck, mineBefore, "the searched deck was shuffled");
  assert.deepEqual(engine.state.players[P2].deck, oppBefore);
});

const nbInPlay = (resources: number, extra: CardPlacement[] = []) =>
  board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play" },
    { key: "sm", def: smite(), owner: P1, zone: "hand" },
    ...(resources > 0 ? bank("elitism", resources, P1) : []),
    ...extra
  ]);

clause(NODEBOX, "1:rule", "only Node in a Box itself is replaced: another card of mine (or the opponent's) being destroyed offers no flip and spends nothing", () => {
  const { engine, id } = nbInPlay(3, [
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
    { key: "sm2", def: smite(), owner: P1, zone: "hand" }
  ]);
  const before = readyResources(engine, P1);
  play(engine, P1, id("sm"), { selected: { t: [id("mine")] } });
  assert.equal(pending(engine), undefined, "no replacement offered for another card");
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(engine.state.cards[id("mine")].faceDown, false);
  assert.equal(readyResources(engine, P1), before, "nothing paid");
  play(engine, P1, id("sm2"), { selected: { t: [id("theirs")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.equal(zoneOf(engine, id("nb")), "play", "Node in a Box is untouched");
  assert.equal(engine.state.cards[id("nb")].faceDown, false);
});

clause(NODEBOX, "1:rule", "destroyed with 1 resource available and I pay: it is flipped face-down in play instead, 1 resource spent", () => {
  const { engine, id } = nbInPlay(3);
  const before = readyResources(engine, P1);
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  const pc = pending(engine);
  assert.ok(pc, "I am offered the replacement");
  assert.equal(pc.kind, "replacementChoice");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "replacementChoice", { apply: true });
  drain(engine, payYes);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("nb")), "play", "it was not destroyed");
  assert.equal(engine.state.cards[id("nb")].faceDown, true, "it is face-down");
  assert.equal(engine.state.players[P1].discard.includes(id("nb")), false);
  // the face-down card itself becomes a Volition resource, so the net change is: -1 paid, +1 for the new face-down resource
  assert.equal(readyResources(engine, P1), before - 1 + 1, "exactly 1 resource paid (and the face-down card counts as a resource)");
});

clause(NODEBOX, "1:rule", "I decline to pay: it is destroyed normally and no resource is spent", () => {
  const { engine, id } = nbInPlay(3);
  const before = readyResources(engine, P1);
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  assert.equal(pending(engine)?.kind, "replacementChoice");
  answerPending(engine, "replacementChoice", { apply: false });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("nb")), "discard", "destroyed");
  assert.equal(engine.state.cards[id("nb")].faceDown, false);
  assert.equal(readyResources(engine, P1), before, "nothing was paid");
});

clause(NODEBOX, "1:rule", "with no resource to pay I am not offered the flip and it is destroyed", () => {
  const { engine, id } = nbInPlay(0);
  assert.equal(readyResources(engine, P1), 0);
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("nb")), "discard");
  assert.equal(engine.state.cards[id("nb")].faceDown, false);
});

clause(NODEBOX, "1:rule", "it also replaces destruction by lethal damage from an effect", () => {
  const { engine, id } = board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play" },
    { key: "zp", def: zap(2), owner: P1, zone: "hand" },
    ...bank("elitism", 3, P1)
  ]);
  play(engine, P1, id("zp"), { selected: { t: [id("nb")] } });
  assert.equal(pending(engine)?.kind, "replacementChoice", "the lethal damage offers the replacement");
  answerPending(engine, "replacementChoice", { apply: true });
  drain(engine, payYes);
  assert.equal(zoneOf(engine, id("nb")), "play");
  assert.equal(engine.state.cards[id("nb")].faceDown, true);
});

clause(NODEBOX, "1:rule", "it also replaces destruction in battle: a lethal blocker is flipped face-down instead", () => {
  const { engine, id } = board(
    [
      { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play" },
      { key: "att", def: character({ name: "Attacker", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", 3, P1)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(engine, P2, [id("att")]);
  declareBlockers(engine, P1, [id("nb")]);
  finishBattle(engine, undefined, payYes);
  assert.equal(zoneOf(engine, id("nb")), "play", "survived by flipping");
  assert.equal(engine.state.cards[id("nb")].faceDown, true);
});

clause(NODEBOX, "1:rule", "it is flipped face-down under its OWNER's control, even if someone else controlled it", () => {
  const { engine, id } = board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play", controller: P2 },
    { key: "sm", def: smite(), owner: P2, zone: "hand" },
    ...bank("elitism", 3, P2)
  ], { turn: 2, activePlayerId: P2 });
  assert.equal(engine.state.cards[id("nb")].controllerId, P2, "setup: P2 controls P1's card");
  play(engine, P2, id("sm"), { selected: { t: [id("nb")] } });
  drain(engine, payYes);
  assert.equal(zoneOf(engine, id("nb")), "play");
  assert.equal(engine.state.cards[id("nb")].faceDown, true);
  assert.equal(engine.state.cards[id("nb")].controllerId, P1, "flipped under its owner's control");
});

// -- destroyed: destroy all other node cards -------------------------------------

const deathBoard = (resources = 0) =>
  board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play" },
    { key: "sm", def: smite(), owner: P1, zone: "hand" },
    { key: "n1", def: character({ name: "Node Mine", subtype: ["node"] }), owner: P1, zone: "play" },
    { key: "n2", def: character({ name: "Node Theirs", subtype: ["node"] }), owner: P2, zone: "play" },
    { key: "nItem", def: item({ name: "Node Item", subtype: ["node"] }), owner: P2, zone: "play" },
    { key: "nLoc", def: location({ name: "Node Place", subtype: ["node"] }), owner: P1, zone: "play" },
    { key: "non", def: character({ name: "Not A Node", subtype: ["majig"] }), owner: P1, zone: "play" },
    { key: "nHand", def: character({ name: "Node Hand", subtype: ["node"] }), owner: P1, zone: "hand" },
    { key: "nDeck", def: character({ name: "Node Deck", subtype: ["node"] }), owner: P1, zone: "deck" },
    { key: "nDisc", def: character({ name: "Node Disc", subtype: ["node"] }), owner: P1, zone: "discard" },
    ...(resources > 0 ? bank("elitism", resources, P1) : [])
  ]);

clause(NODEBOX, "2:rule", "when it is destroyed every other node card in play (any type, any controller) is destroyed; non-nodes and cards in other zones are not", () => {
  const { engine, id } = deathBoard();
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("nb")), "discard");
  for (const key of ["n1", "n2", "nItem", "nLoc"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} destroyed`);
  assert.equal(zoneOf(engine, id("non")), "play", "a non-node survives");
  assert.equal(zoneOf(engine, id("nHand")), "hand");
  assert.equal(zoneOf(engine, id("nDeck")), "deck");
  assert.equal(zoneOf(engine, id("nDisc")), "discard");
  assert.equal(engine.state.players[P1].discard.includes(id("nHand")), false);
});

clause(NODEBOX, "2:rule", "no one else dies when it is saved by the face-down replacement (it was not destroyed)", () => {
  const { engine, id } = deathBoard(3);
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  drain(engine, payYes);
  assert.equal(zoneOf(engine, id("nb")), "play");
  for (const key of ["n1", "n2", "nItem", "nLoc", "non"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} untouched`);
});

clause(NODEBOX, "2:rule", "it triggers only on its own destruction: another node being destroyed leaves it in play", () => {
  const { engine, id } = deathBoard();
  play(engine, P1, id("sm"), { selected: { t: [id("n1")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n1")), "discard");
  assert.equal(zoneOf(engine, id("nb")), "play", "Node in a Box itself is not destroyed");
  assert.equal(zoneOf(engine, id("n2")), "play");
  assert.equal(pending(engine), undefined);
});

clause(NODEBOX, "2:rule", "a second Node in a Box is another node card and is destroyed too", () => {
  const { engine, id } = board([
    { key: "nb", def: printing(NODEBOX), owner: P1, zone: "play" },
    { key: "nb2", def: printing(NODEBOX), owner: P2, zone: "play" },
    { key: "sm", def: smite(), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("sm"), { selected: { t: [id("nb")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("nb")), "discard");
  assert.equal(zoneOf(engine, id("nb2")), "discard", "the other copy is an 'other node card'");
});

// =====================================================================================
// Prime Titan — character (gearsmith, warmachine), cost 6, threshold [E][E], 4 strength / 4 speed / 4 life
// =====================================================================================

const titanBoard = (extra: CardPlacement[], resources = 8, tokens = 0) =>
  board([
    { key: "pt", def: printing(TITAN), owner: P1, zone: "play", ...(tokens ? { counters: { token: tokens } } : {}) },
    ...(resources > 0 ? bank("elitism", resources, P1) : []),
    ...extra
  ]);

const stats = (engine: SpoilsEngine, cardId: string) => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

clause(TITAN, "0:unique", "a second Prime Titan makes me choose which to keep: the chosen one stays, the other is destroyed", () => {
  for (const keep of ["pt1", "pt2"]) {
    const { engine, id } = board([
      { key: "pt1", def: printing(TITAN), owner: P1, zone: "play" },
      { key: "pt2", def: printing(TITAN), owner: P1, zone: "hand" },
      ...bank("elitism", 8, P1)
    ]);
    play(engine, P1, id("pt2"));
    const pc = pending(engine);
    assert.ok(pc, "asked");
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    answerPending(engine, "uniqueSurvivor", { keep: id(keep) });
    const gone = keep === "pt1" ? "pt2" : "pt1";
    assert.equal(zoneOf(engine, id(keep)), "play");
    assert.equal(zoneOf(engine, id(gone)), "discard");
  }
});

clause(TITAN, "0:unique", "the opponent controlling their own Prime Titan is no conflict (only my own copies count)", () => {
  const { engine, id } = board([
    { key: "pt1", def: printing(TITAN), owner: P1, zone: "play" },
    { key: "pt2", def: printing(TITAN), owner: P2, zone: "play" }
  ]);
  assert.equal(zoneOf(engine, id("pt1")), "play");
  assert.equal(zoneOf(engine, id("pt2")), "play");
  assert.equal(pending(engine), undefined);
});

clause(TITAN, "1:rule", "gains 1 strength and 1 life per token on it; speed is unchanged", () => {
  const cases: Array<[number, number[]]> = [
    [0, [4, 4, 4]],
    [1, [5, 5, 4]],
    [3, [7, 7, 4]]
  ];
  for (const [tokens, expected] of cases) {
    const { engine, id } = titanBoard([], 0, tokens);
    assert.deepEqual(stats(engine, id("pt")), expected, `${tokens} tokens`);
  }
});

clause(TITAN, "1:rule", "tokens on other cards do not count; removing tokens takes the bonus away; off again after it leaves play", () => {
  const { engine, id } = titanBoard([{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", counters: { token: 5 } }], 0, 2);
  assert.deepEqual(stats(engine, id("pt")), [6, 6, 4]);
  engine.state.cards[id("pt")].counters.token = 0;
  assert.deepEqual(stats(engine, id("pt")), [4, 4, 4], "bonus gone with the tokens");
  assert.equal(engine.getStat(id("ally"), "strength"), 1, "the ally with tokens gains nothing (printed stat of the fixture)");
});

clause(TITAN, "1:rule", "a token-laden opposing Prime Titan does not boost mine", () => {
  const { engine, id } = board([
    { key: "pt", def: printing(TITAN), owner: P1, zone: "play" },
    { key: "pt2", def: printing(TITAN), owner: P2, zone: "play", counters: { token: 4 } }
  ]);
  assert.deepEqual(stats(engine, id("pt")), [4, 4, 4]);
  assert.deepEqual(stats(engine, id("pt2")), [8, 8, 4]);
});

// -- MICROMAJIG LOAD ---------------------------------------------------------------

clause(TITAN, "2:ability:prime-titan-load", "pays 1, destroys one Micromajig token I control, and puts a token on Prime Titan", () => {
  const { engine, id } = titanBoard([micro("mm1"), micro("mm2")], 4);
  const before = readyResources(engine, P1);
  activate(engine, P1, id("pt"), "prime-titan-load");
  assert.equal(pending(engine), undefined);
  assert.equal(before - readyResources(engine, P1), 1, "paid 1");
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 1, "exactly one Micromajig token destroyed");
  assert.equal(tokensOn(engine, id("pt")), 1, "a token on Prime Titan");
  assert.deepEqual(stats(engine, id("pt")), [5, 5, 4]);
  activate(engine, P1, id("pt"), "prime-titan-load");
  assert.equal(tokensOn(engine, id("pt")), 2, "usable again, stacks");
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 0);
  assert.equal(before - readyResources(engine, P1), 2);
});

clause(TITAN, "2:ability:prime-titan-load", "refused with no Micromajig token to destroy (resources available)", () => {
  const { engine, id } = titanBoard([], 4);
  refused(() => activate(engine, P1, id("pt"), "prime-titan-load"), "no Micromajig token", /./);
  assert.equal(tokensOn(engine, id("pt")), 0);
  const ok = titanBoard([micro("mm1")], 4);
  activate(ok.engine, P1, ok.id("pt"), "prime-titan-load");
  assert.equal(tokensOn(ok.engine, ok.id("pt")), 1, "positive control");
});

clause(TITAN, "2:ability:prime-titan-load", "refused when I cannot pay 1", () => {
  const { engine, id } = titanBoard([micro("mm1")], 0);
  assert.equal(readyResources(engine, P1), 0);
  refused(() => activate(engine, P1, id("pt"), "prime-titan-load"), "no resource to pay", /./);
  assert.equal(tokensOn(engine, id("pt")), 0);
  assert.equal(inPlayNamed(engine, P1, "Micromajig").length, 1, "the token was not destroyed");
});

clause(TITAN, "2:ability:prime-titan-load", "only MY Micromajig tokens: the opponent's token cannot pay the cost and is not destroyed", () => {
  const { engine, id } = titanBoard([micro("mmEnemy", P2)], 4);
  refused(() => activate(engine, P1, id("pt"), "prime-titan-load"), "only an enemy token", /./);
  assert.equal(inPlayNamed(engine, P2, "Micromajig").length, 1);
});

clause(TITAN, "2:ability:prime-titan-load", "a token with another name is not a Micromajig: it is not destroyed and cannot pay the cost", () => {
  const { engine, id } = titanBoard([{ key: "mmOther", def: character({ name: "Other Token", subtype: ["majig"] }), owner: P1, zone: "play" }], 4);
  refused(() => activate(engine, P1, id("pt"), "prime-titan-load"), "no Micromajig token", /./);
  assert.equal(zoneOf(engine, id("mmOther")), "play");
  assert.equal(tokensOn(engine, id("pt")), 0);
});

clause(TITAN, "2:ability:prime-titan-load", "a real card (not a token) named Micromajig cannot pay the cost", () => {
  const { engine, id } = titanBoard([{ key: "plainMicro", def: character({ name: "Micromajig" }), owner: P1, zone: "play" }], 4);
  refused(() => activate(engine, P1, id("pt"), "prime-titan-load"), "not a token", /./);
  assert.equal(zoneOf(engine, id("plainMicro")), "play");
  assert.equal(tokensOn(engine, id("pt")), 0);
});

clause(TITAN, "2:ability:prime-titan-load", "no deplete cost: usable while Prime Titan is depleted", () => {
  const { engine, id } = titanBoard([micro("mm1")], 4);
  engine.state.cards[id("pt")].depleted = true;
  activate(engine, P1, id("pt"), "prime-titan-load");
  assert.equal(tokensOn(engine, id("pt")), 1);
});

// -- MICROMAJIG UNLOAD -------------------------------------------------------------

const victim = (life = 5): CardPlacement => ({ key: "vic", def: character({ name: "Victim", strength: 1, life, speed: 1 }), owner: P2, zone: "play" });
const unload = (engine: SpoilsEngine, id: (key: string) => string, target: string, x: number) =>
  activate(engine, P1, id("pt"), "prime-titan-unload", { selected: { t: [id(target)] }, variables: { x } });

clause(TITAN, "3:ability:prime-titan-unload", "X=2 of 3 tokens: depletes it, removes 2 tokens, pays 2, inflicts 2 damage to the picked character", () => {
  const { engine, id } = titanBoard([victim()], 8, 3);
  const before = readyResources(engine, P1);
  unload(engine, id, "vic", 2);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.cards[id("pt")].depleted, true, "deplete");
  assert.equal(tokensOn(engine, id("pt")), 1, "3 - 2 tokens");
  assert.equal(before - readyResources(engine, P1), 2, "paid X = 2");
  assert.equal(engine.state.cards[id("vic")].damage, 2, "2 damage to the victim");
  assert.equal(zoneOf(engine, id("vic")), "play");
  assert.deepEqual(stats(engine, id("pt")), [5, 5, 4], "its own bonus follows the remaining token");
});

clause(TITAN, "3:ability:prime-titan-unload", "X=1 and X=3 give 1 and 3 damage; lethal X destroys the character", () => {
  for (const x of [1, 3]) {
    const { engine, id } = titanBoard([victim(5)], 8, 3);
    const before = readyResources(engine, P1);
    unload(engine, id, "vic", x);
    assert.equal(engine.state.cards[id("vic")].damage, x, `${x} damage`);
    assert.equal(tokensOn(engine, id("pt")), 3 - x);
    assert.equal(before - readyResources(engine, P1), x, `paid ${x}`);
  }
  const lethal = titanBoard([victim(2)], 8, 3);
  unload(lethal.engine, lethal.id, "vic", 2);
  assert.equal(zoneOf(lethal.engine, lethal.id("vic")), "discard", "2 damage kills a 2-life character");
});

clause(TITAN, "3:ability:prime-titan-unload", "can pick my own character, a location, or a faction; the damage lands on exactly that card", () => {
  const own = titanBoard([{ key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" }], 8, 2);
  unload(own.engine, own.id, "mine", 2);
  assert.equal(own.engine.state.cards[own.id("mine")].damage, 2, "my own character");

  const loc = titanBoard([{ key: "loc", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }], 8, 2);
  unload(loc.engine, loc.id, "loc", 2);
  assert.equal(loc.engine.state.cards[loc.id("loc")].damage, 2, "a location");

  const fac = titanBoard([], 8, 2);
  const factionId = fac.engine.state.players[P2].factionId as string;
  const infBefore = fac.engine.state.players[P2].influence;
  activate(fac.engine, P1, fac.id("pt"), "prime-titan-unload", { selected: { t: [factionId] }, variables: { x: 2 } });
  assert.equal(fac.engine.state.players[P2].influence, infBefore - 2, "the opponent's faction takes 2 damage (influence)");
  assert.equal(fac.engine.state.players[P1].influence, 30, "my own faction is untouched");
});

clause(TITAN, "3:ability:prime-titan-unload", "an item, a tactic, or a resource cannot be picked (a character is the positive control)", () => {
  const { engine, id } = titanBoard(
    [
      victim(),
      { key: "itm", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" }
    ],
    8,
    2
  );
  refused(() => unload(engine, id, "itm", 1), "an item", /./);
  refused(() => unload(engine, id, "res", 1), "a resource", /./);
  assert.equal(tokensOn(engine, id("pt")), 2, "refusals cost nothing");
  unload(engine, id, "vic", 1);
  assert.equal(engine.state.cards[id("vic")].damage, 1);
});

clause(TITAN, "3:ability:prime-titan-unload", "X cannot exceed the tokens on it, and 5 [E] are needed", () => {
  const { engine, id } = titanBoard([victim()], 8, 2);
  refused(() => unload(engine, id, "vic", 3), "X above the token count", /./);
  assert.equal(tokensOn(engine, id("pt")), 2);
  assert.equal(engine.state.cards[id("vic")].damage ?? 0, 0);

  const short = board([
    { key: "pt", def: printing(TITAN), owner: P1, zone: "play", counters: { token: 2 } },
    victim(),
    ...bank("elitism", 4, P1),
    ...bank("rage", 3, P1)
  ]);
  refused(() => unload(short.engine, short.id, "vic", 1), "only 4 elitism icons", /./);
  assert.equal(tokensOn(short.engine, short.id("pt")), 2);
  const enough = board([
    { key: "pt", def: printing(TITAN), owner: P1, zone: "play", counters: { token: 2 } },
    victim(),
    ...bank("elitism", 5, P1),
    ...bank("rage", 3, P1)
  ]);
  unload(enough.engine, enough.id, "vic", 1);
  assert.equal(enough.engine.state.cards[enough.id("vic")].damage, 1, "5 elitism icons is enough");
});

clause(TITAN, "3:ability:prime-titan-unload", "refused while depleted (the cost is 'deplete this card')", () => {
  const { engine, id } = titanBoard([victim()], 8, 2);
  engine.state.cards[id("pt")].depleted = true;
  refused(() => unload(engine, id, "vic", 1), "already depleted", /./);
  assert.equal(tokensOn(engine, id("pt")), 2);
  engine.state.cards[id("pt")].depleted = false;
  unload(engine, id, "vic", 1);
  assert.equal(engine.state.cards[id("vic")].damage, 1, "ready again, works");
});

clause(TITAN, "3:ability:prime-titan-unload", "'Pay X' must be affordable: X=6 with only 5 resources is refused and nothing is spent", () => {
  const { engine, id } = titanBoard([victim(9)], 5, 6);
  refused(() => unload(engine, id, "vic", 6), "cannot pay 6 with 5 resources", /./);
  assert.equal(tokensOn(engine, id("pt")), 6, "tokens untouched");
  assert.equal(engine.state.cards[id("pt")].depleted, false);
  assert.equal(engine.state.cards[id("vic")].damage ?? 0, 0);
  unload(engine, id, "vic", 5);
  assert.equal(engine.state.cards[id("vic")].damage, 5, "X=5 works");
});

clause(TITAN, "3:ability:prime-titan-unload", "X=0 is legal: deplete only, no tokens removed, no resources paid, no damage", () => {
  const { engine, id } = titanBoard([victim()], 8, 2);
  const before = readyResources(engine, P1);
  unload(engine, id, "vic", 0);
  assert.equal(engine.state.cards[id("pt")].depleted, true);
  assert.equal(tokensOn(engine, id("pt")), 2);
  assert.equal(readyResources(engine, P1), before);
  assert.equal(engine.state.cards[id("vic")].damage ?? 0, 0);
});

// =====================================================================================
// RC Flashlight — character (gearsmith, machine), cost 3, threshold [E][E], 1 strength / 3 speed / 3 life
// =====================================================================================

const flashAttack = () =>
  board(
    [
      { key: "rc", def: printing(FLASH), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P1 }
  );

clause(FLASH, "0:rule", "cannot be blocked: the defender may not block it", () => {
  const { engine, id } = flashAttack();
  declareAttackBy(engine, P1, [id("rc")]);
  refused(() => declareBlockers(engine, P2, [id("blk")]), "RC Flashlight cannot be blocked", /./);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(engine.state.cards[id("blk")].damage ?? 0, 0);
});

clause(FLASH, "0:rule", "an ordinary attacker CAN be blocked (positive control) and a party with a blockable member can be blocked (CR 412)", () => {
  const plain = flashAttack();
  declareAttackBy(plain.engine, P1, [plain.id("ally")]);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.ok(plain.engine.state.battle, "the block was legal");

  const party = flashAttack();
  declareAttackBy(party.engine, P1, [party.id("rc"), party.id("ally")]);
  declareBlockers(party.engine, P2, [party.id("blk")]);
  assert.ok(party.engine.state.battle, "RC Flashlight + a blockable ally: the party can be blocked");
});

clause(FLASH, "0:rule", "unblocked, it deals its 1 strength to the defending faction", () => {
  const { engine, id } = flashAttack();
  const before = engine.state.players[P2].influence;
  declareAttackBy(engine, P1, [id("rc")]);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(engine.state.players[P2].influence, before - 1);
});

const covertDefence = () =>
  board(
    [
      { key: "rc", def: printing(FLASH), owner: P1, zone: "play" },
      { key: "plainDef", def: character({ name: "Plain Defender", life: 3 }), owner: P1, zone: "play" },
      { key: "covAtk", def: character({ name: "Covert Attacker", strength: 1, life: 4, speed: 1, behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" },
      { key: "plainAtk", def: character({ name: "Plain Attacker", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );

clause(FLASH, "1:rule", "it can block a COVERT party, while an ordinary character cannot", () => {
  const { engine, id } = covertDefence();
  declareAttackBy(engine, P2, [id("covAtk")]);
  refused(() => declareBlockers(engine, P1, [id("plainDef")]), "a non-covert blocker against a covert party", /./);
  declareBlockers(engine, P1, [id("rc")]);
  assert.ok(engine.state.battle, "the block stands");
  finishBattle(engine);
  assert.equal(engine.state.cards[id("covAtk")].damage, 1, "RC Flashlight dealt its 1 strength to the covert attacker");
  assert.equal(engine.state.cards[id("rc")].damage, 1, "and took 1 back");
});

clause(FLASH, "1:rule", "it can still block an ordinary (non-covert) party", () => {
  const { engine, id } = covertDefence();
  declareAttackBy(engine, P2, [id("plainAtk")]);
  declareBlockers(engine, P1, [id("rc")]);
  assert.ok(engine.state.battle, "engine.state.battle");
  finishBattle(engine);
  assert.equal(engine.state.cards[id("plainAtk")].damage, 1);
});

// Literal reading: "This card can block COVERT parties" lets RC Flashlight itself block a covert party; it does
// not turn a plain character into a legal blocker. CR 507.3b: only covert characters may block a covert party, so
// a blocking party that also holds a plain character is illegal, while RC Flashlight (+ a covert character) is fine.
const mixedDefence = () =>
  board(
    [
      { key: "rc", def: printing(FLASH), owner: P1, zone: "play" },
      { key: "plainDef", def: character({ name: "Plain Defender", life: 3 }), owner: P1, zone: "play" },
      { key: "covDef", def: character({ name: "Covert Defender", life: 3, behavior: { keywords: ["covert"] } as never }), owner: P1, zone: "play" },
      { key: "covAtk", def: character({ name: "Covert Attacker", strength: 1, life: 4, speed: 1, behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" },
      { key: "covAtk2", def: character({ name: "Covert Attacker Two", strength: 1, life: 4, speed: 1, behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" },
      { key: "plainAtk", def: character({ name: "Plain Attacker", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );

clause(FLASH, "1:rule", "a blocking party of RC Flashlight + a plain character cannot block a COVERT party (only RC Flashlight may); RC Flashlight alone can", () => {
  const { engine, id } = mixedDefence();
  declareAttackBy(engine, P2, [id("covAtk")]);
  refused(() => declareBlockers(engine, P1, [id("rc"), id("plainDef")]), "the plain character is not allowed to block a covert party, so the mixed party is illegal", /./);
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], [], "nothing was recorded for the refused block");
  declareBlockers(engine, P1, [id("rc")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("rc")], "positive control: RC Flashlight alone blocks the same covert party");
});

clause(FLASH, "1:rule", "RC Flashlight + a covert character may block a covert party together; two covert attackers are one covert party", () => {
  const { engine, id } = mixedDefence();
  declareAttackBy(engine, P2, [id("covAtk"), id("covAtk2")]);
  declareBlockers(engine, P1, [id("rc"), id("covDef")]);
  assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [id("rc"), id("covDef")].sort());
});

clause(FLASH, "1:rule", "a covert + non-covert attacking party is not a covert party: RC Flashlight + a plain character may block it", () => {
  const { engine, id } = mixedDefence();
  declareAttackBy(engine, P2, [id("covAtk"), id("plainAtk")]);
  declareBlockers(engine, P1, [id("rc"), id("plainDef")]);
  assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [id("rc"), id("plainDef")].sort());
});

clause(FLASH, "1:rule", "against a plain attacker RC Flashlight + a plain character may block together (it is not itself covert)", () => {
  const { engine, id } = mixedDefence();
  declareAttackBy(engine, P2, [id("plainAtk")]);
  declareBlockers(engine, P1, [id("rc"), id("plainDef")]);
  assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [id("rc"), id("plainDef")].sort());
});

// =====================================================================================
// Runic Distribulator — item (gearsmith), cost 0, threshold [E][E][E]
// =====================================================================================

const rdBoard = (extra: CardPlacement[] = [], resources = 6, tokens = 0) =>
  board([
    { key: "rd", def: printing(RUNIC), owner: P1, zone: "play", ...(tokens ? { counters: { token: tokens } } : {}) },
    ...(resources > 0 ? bank("elitism", resources, P1) : []),
    ...extra
  ]);

clause(RUNIC, "0:ability:runic-load", "pay 2: puts one token on it (stacking on repeat uses)", () => {
  const { engine, id } = rdBoard();
  const before = readyResources(engine, P1);
  activate(engine, P1, id("rd"), "runic-load");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("rd")), 1);
  assert.equal(before - readyResources(engine, P1), 2, "paid 2");
  activate(engine, P1, id("rd"), "runic-load");
  assert.equal(tokensOn(engine, id("rd")), 2);
  assert.equal(before - readyResources(engine, P1), 4);
});

clause(RUNIC, "0:ability:runic-load", "refused with only 1 resource", () => {
  const { engine, id } = rdBoard([], 1);
  refused(() => activate(engine, P1, id("rd"), "runic-load"), "one short", /./);
  assert.equal(tokensOn(engine, id("rd")), 0);
  const ok = rdBoard([], 2);
  activate(ok.engine, P1, ok.id("rd"), "runic-load");
  assert.equal(tokensOn(ok.engine, ok.id("rd")), 1, "exactly 2 is enough");
});

// D5: driver updated: X and the card losing the tokens are COST choices, so they are made when the ability is used (variables + selected), not in prompts at resolution.
const gather = (engine: SpoilsEngine, id: (key: string) => string, x: number, from: string) => {
  activate(engine, P1, id("rd"), "runic-gather", { variables: { x }, selected: { src: [id(from)] } });
};

const src = (tokens: number): CardPlacement => ({ key: "src", def: character({ name: "Source", life: 5 }), owner: P1, zone: "play", counters: { token: tokens } });

clause(RUNIC, "1:ability:runic-gather", "X=2: pays X+1 = 3, removes 2 tokens from a card I control, puts 2 tokens on this card", () => {
  const { engine, id } = rdBoard([src(3)], 6);
  const before = readyResources(engine, P1);
  gather(engine, id, 2, "src");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("src")), 1, "2 removed from the source");
  assert.equal(tokensOn(engine, id("rd")), 2, "2 put on the Distribulator");
  assert.equal(before - readyResources(engine, P1), 3, "Pay X+1 = 3");
});

clause(RUNIC, "1:ability:runic-gather", "X=2 and X=3 move exactly X tokens from the source to the Distribulator (existing tokens kept)", () => {
  for (const x of [2, 3]) {
    const { engine, id } = rdBoard([src(4)], 8, 1);
    gather(engine, id, x, "src");
    assert.equal(pending(engine), undefined);
    assert.equal(tokensOn(engine, id("src")), 4 - x, `${x} removed`);
    assert.equal(tokensOn(engine, id("rd")), 1 + x, `${x} added`);
  }
});

clause(RUNIC, "1:ability:runic-gather", "X=1 moves one token (source and Distribulator tokens change by exactly X)", () => {
  const { engine, id } = rdBoard([src(4)], 6);
  gather(engine, id, 1, "src");
  assert.equal(tokensOn(engine, id("src")), 3);
  assert.equal(tokensOn(engine, id("rd")), 1);
});

clause(RUNIC, "1:ability:runic-gather", "X+1 must be affordable: X=2 with only 2 resources is refused and moves nothing", () => {
  const { engine, id } = rdBoard([src(3)], 2);
  refused(() => gather(engine, id, 2, "src"), "cannot pay X+1 = 3 with 2 resources", /./);
  assert.equal(tokensOn(engine, id("src")), 3);
  assert.equal(tokensOn(engine, id("rd")), 0);
});

clause(RUNIC, "1:ability:runic-gather", "the source must have X tokens to remove: X=3 from a card with 1 token is refused", () => {
  const { engine, id } = rdBoard([src(1)], 8);
  refused(() => gather(engine, id, 3, "src"), "cannot remove 3 tokens from a card with 1", /./);
  assert.equal(tokensOn(engine, id("rd")), 0, "no tokens created from nothing");
  assert.equal(tokensOn(engine, id("src")), 1);
});

clause(RUNIC, "1:ability:runic-gather", "the tokens come from a card I control: the opponent's token-bearing card is not a legal source", () => {
  const { engine, id } = rdBoard(
    [src(1), { key: "enemy", def: character({ name: "Enemy" }), owner: P2, zone: "play", counters: { token: 4 } }],
    6
  );
  refused(() => activate(engine, P1, id("rd"), "runic-gather", { variables: { x: 1 }, selected: { src: [id("enemy")] } }), "the opponent's card", /./);
  gather(engine, id, 1, "src");
  assert.equal(tokensOn(engine, id("enemy")), 4, "the opponent's tokens are untouched");
  assert.equal(tokensOn(engine, id("src")), 0);
  assert.equal(tokensOn(engine, id("rd")), 1);
});

const spreadBoard = (tokens: number, resources = 6, withRes = false) =>
  rdBoard(
    [
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(withRes ? [{ key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" as const }] : [])
    ],
    resources,
    tokens
  );

const spread = (engine: SpoilsEngine, id: (key: string) => string, targets: string[], shares: Record<string, number>) => {
  activate(engine, P1, id("rd"), "runic-spread", { selected: { spread: targets.map(id) } });
  const pc = pending(engine);
  if (pc) {
    assert.equal(pc.kind, "distributeAmong");
    assert.equal(pc.playerId, P1);
    answerPending(engine, "distributeAmong", { shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [id(k), v])) });
  }
};

clause(RUNIC, "2:ability:runic-spread", "pay 3 and destroy it: its 4 tokens are divided as I choose between two cards", () => {
  const { engine, id } = spreadBoard(4);
  const before = readyResources(engine, P1);
  spread(engine, id, ["a", "b"], { a: 3, b: 1 });
  assert.equal(pending(engine), undefined);
  assert.equal(before - readyResources(engine, P1), 3, "paid 3");
  assert.equal(zoneOf(engine, id("rd")), "discard", "destroyed as a cost");
  assert.equal(tokensOn(engine, id("a")), 3);
  assert.equal(tokensOn(engine, id("b")), 1);
});

clause(RUNIC, "2:ability:runic-spread", "the split is up to me: all on one card, and an uneven split across a location and an item", () => {
  const one = spreadBoard(3);
  spread(one.engine, one.id, ["a"], { a: 3 });
  assert.equal(tokensOn(one.engine, one.id("a")), 3);

  const mix = spreadBoard(5);
  spread(mix.engine, mix.id, ["a", "loc", "gadget"], { a: 1, loc: 1, gadget: 3 });
  assert.equal(tokensOn(mix.engine, mix.id("a")), 1);
  assert.equal(tokensOn(mix.engine, mix.id("loc")), 1, "a location is a non-resource card");
  assert.equal(tokensOn(mix.engine, mix.id("gadget")), 3, "an item is a non-resource card");
});

clause(RUNIC, "2:ability:runic-spread", "only non-resource cards I control: a resource and the opponent's card cannot be picked", () => {
  const { engine, id } = spreadBoard(2, 6, true);
  refused(() => spread(engine, id, ["res"], { res: 2 }), "a resource", /./);
  refused(() => spread(engine, id, ["foe"], { foe: 2 }), "the opponent's card", /./);
  assert.equal(zoneOf(engine, id("rd")), "play", "refusals cost nothing");
  assert.equal(tokensOn(engine, id("rd")), 2);
  spread(engine, id, ["a"], { a: 2 });
  assert.equal(tokensOn(engine, id("a")), 2, "positive control");
  assert.equal(tokensOn(engine, id("foe")), 0);
});

clause(RUNIC, "2:ability:runic-spread", "X is the number of tokens on it: 1 token spreads exactly 1 (over-dividing is refused)", () => {
  const one = spreadBoard(1);
  spread(one.engine, one.id, ["a", "b"], { a: 1 });
  assert.equal(tokensOn(one.engine, one.id("a")) + tokensOn(one.engine, one.id("b")), 1);

  const over = spreadBoard(4);
  activate(over.engine, P1, over.id("rd"), "runic-spread", { selected: { spread: [over.id("a"), over.id("b")] } });
  refused(
    () => answerPending(over.engine, "distributeAmong", { shares: { [over.id("a")]: 3, [over.id("b")]: 3 } }),
    "over-dividing 4 tokens as 6",
    /./
  );
  answerPending(over.engine, "distributeAmong", { shares: { [over.id("a")]: 3, [over.id("b")]: 1 } });
  assert.equal(tokensOn(over.engine, over.id("a")) + tokensOn(over.engine, over.id("b")), 4);
});

clause(RUNIC, "2:ability:runic-spread", "all X tokens must be placed: dividing 4 tokens as 1+1 is refused", () => {
  const under = spreadBoard(4);
  activate(under.engine, P1, under.id("rd"), "runic-spread", { selected: { spread: [under.id("a"), under.id("b")] } });
  refused(
    () => answerPending(under.engine, "distributeAmong", { shares: { [under.id("a")]: 1, [under.id("b")]: 1 } }),
    "under-dividing 4 tokens as 2",
    /./
  );
});

clause(RUNIC, "2:ability:runic-spread", "refused with only 2 resources (needs 3)", () => {
  const { engine, id } = spreadBoard(2, 2);
  refused(() => spread(engine, id, ["a"], { a: 2 }), "one short of 3", /./);
  assert.equal(zoneOf(engine, id("rd")), "play");
  const ok = spreadBoard(2, 3);
  spread(ok.engine, ok.id, ["a"], { a: 2 });
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard", "exactly 3 is enough");
});

clause(RUNIC, "2:ability:runic-spread", "with no tokens on it X is 0: it is still paid for and destroyed, and nothing gains tokens", () => {
  const { engine, id } = spreadBoard(0);
  const before = readyResources(engine, P1);
  spread(engine, id, ["a"], { a: 0 });
  assert.equal(zoneOf(engine, id("rd")), "discard");
  assert.equal(before - readyResources(engine, P1), 3);
  assert.equal(tokensOn(engine, id("a")), 0);
});

// =====================================================================================
// Scrapple-Jack — character (gearsmith, horsemajig), cost 1, threshold [E][E], 1 strength / 3 speed / 1 life
// =====================================================================================

const sjBoard = (withToken = true, extra: CardPlacement[] = []) =>
  board([
    { key: "sj", def: printing(SCRAP), owner: P1, zone: "hand" },
    ...(withToken ? [micro("mm1")] : []),
    { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "discard" },
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "discard" },
    { key: "grunt", def: character({ name: "Grunt" }), owner: P1, zone: "discard" },
    { key: "enemyItem", def: item({ name: "Enemy Item" }), owner: P2, zone: "discard" },
    ...bank("elitism", 4, P1),
    ...extra
  ]);

/** Plays Scrapple-Jack and answers whatever it asks: destroy the token (or not) and which item to take. */
// D5: driver updated: the optional token is an EXTRA COST picked when the card is played (selected.tok), not an enters-play prompt.
const castScrap = (game: ReturnType<typeof sjBoard>, destroyToken: boolean, take: string[], tokenKey = "mm1") => {
  play(game.engine, P1, game.id("sj"), destroyToken ? { selected: { tok: [game.id(tokenKey)] } } : {});
  drain(game.engine, (pc) => {
    assert.equal(pc.playerId, P1, "every Scrapple-Jack decision is mine");
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: destroyToken ? 1 : 0 };
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: destroyToken };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: take.map(game.id) };
    return declineAll(pc);
  });
};

clause(SCRAP, "0:extraCost", "I may destroy a Micromajig token as an extra cost: accepting destroys it; the base cost 1 is still paid", () => {
  const game = sjBoard();
  const before = readyResources(game.engine, P1);
  castScrap(game, true, ["gadget"]);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("sj")), "play");
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0, "the token was destroyed");
  assert.equal(before - readyResources(game.engine, P1), 1, "only the printed cost of 1 in resources");
});

clause(SCRAP, "0:extraCost", "it is optional: declining keeps the token and still deploys the card for 1", () => {
  const game = sjBoard();
  const before = readyResources(game.engine, P1);
  castScrap(game, false, []);
  assert.equal(zoneOf(game.engine, game.id("sj")), "play");
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 1, "token still there");
  assert.equal(before - readyResources(game.engine, P1), 1);
});

clause(SCRAP, "0:extraCost", "it can be cast without any Micromajig token, and an opponent's token is never destroyed", () => {
  const game = sjBoard(false, [micro("mmEnemy", P2)]);
  castScrap(game, false, []);
  assert.equal(zoneOf(game.engine, game.id("sj")), "play");
  assert.equal(inPlayNamed(game.engine, P2, "Micromajig").length, 1);
  const hostile = sjBoard(false, [micro("mmEnemy", P2)]);
  refused(() => castScrap(hostile, true, ["gadget"], "mmEnemy"), "the opponent's token cannot be picked for my extra cost", /./);
  assert.equal(inPlayNamed(hostile.engine, P2, "Micromajig").length, 1, "the opponent's token cannot be destroyed for my extra cost");
});

clause(SCRAP, "0:extraCost", "the token is destroyed as part of casting (an extra COST), before Scrapple-Jack enters play", () => {
  const game = sjBoard();
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 1, "setup: the token is in play");
  playRaw(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1")] } });
  // Casting is waiting for responses (SYS-2): the extra cost must already have been paid by now.
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0, "the token was destroyed while Scrapple-Jack still waits for responses");
  assert.equal(game.engine.state.cards[game.id("sj")].zone, "deploying");
});

clause(SCRAP, "1:rule", "entering after destroying a token: I may pick an item from my discard pile and put it into my hand", () => {
  const game = sjBoard();
  castScrap(game, true, ["gadget"]);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "hand", "the item is in my hand");
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard", "only the picked one moved");
  assert.equal(zoneOf(game.engine, game.id("sj")), "play");
});

clause(SCRAP, "1:rule", "'may': I can pick nothing, and the token is still destroyed", () => {
  const game = sjBoard();
  castScrap(game, true, []);
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 0);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard");
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard");
});

clause(SCRAP, "1:rule", "only an ITEM in MY discard pile: a character or the opponent's item cannot be picked", () => {
  const game = sjBoard();
  play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1")] } });
  drain(game.engine, declineAll);
  // wrong picks must be refused while the item prompt is open
  const game2 = sjBoard();
  play(game2.engine, P1, game2.id("sj"), { selected: { tok: [game2.id("mm1")] } });
  let sawPick = false;
  let guard = 0;
  while (game2.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(game2.engine)!;
    if (pc.kind === "chooserSelectsOption") {
      answerPending(game2.engine, "chooserSelectsOption", { index: 1 });
    } else if (pc.kind === "chooserSelectsTarget") {
      sawPick = true;
      refused(() => answerPending(game2.engine, "chooserSelectsTarget", { selected: [game2.id("grunt")] }), "a character in the discard pile", /./);
      refused(() => answerPending(game2.engine, "chooserSelectsTarget", { selected: [game2.id("enemyItem")] }), "the opponent's item", /./);
      answerPending(game2.engine, "chooserSelectsTarget", { selected: [game2.id("gizmo")] });
    } else {
      answerPending(game2.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
    }
  }
  assert.ok(sawPick, "I was asked to pick an item");
  assert.equal(zoneOf(game2.engine, game2.id("gizmo")), "hand", "positive control");
  assert.equal(zoneOf(game2.engine, game2.id("grunt")), "discard");
  assert.equal(zoneOf(game2.engine, game2.id("enemyItem")), "discard");
});

clause(SCRAP, "1:rule", "declining the token: no item is returned (no pick offered, discard unchanged)", () => {
  const game = sjBoard();
  play(game.engine, P1, game.id("sj"));
  let sawPick = false;
  drain(game.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") sawPick = true;
    return declineAll(pc);
  });
  assert.equal(sawPick, false, "no item prompt without a destroyed token");
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard");
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard");
});

clause(SCRAP, "1:rule", "with no Micromajig token to destroy I do not get an item back", () => {
  const game = sjBoard(false);
  play(game.engine, P1, game.id("sj"));
  drain(game.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [game.id("gadget")] };
    return declineAll(pc);
  });
  assert.equal(zoneOf(game.engine, game.id("sj")), "play");
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard", "no token was destroyed, so nothing returns");
});

clause(SCRAP, "1:rule", "only when Scrapple-Jack itself enters play: a different card entering later returns nothing", () => {
  const game = sjBoard(true, [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }]);
  castScrap(game, false, []);
  play(game.engine, P1, game.id("other"));
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard");
});

// -- 'an item' = exactly one: picking two items from the discard pile is refused ----------

clause(SCRAP, "1:rule", "'an item': only ONE item can be taken; picking two is refused and both stay in the discard pile", () => {
  const game = sjBoard();
  play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1")] } });
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked to pick an item");
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("gadget"), game.id("gizmo")] } } as never),
    "two items",
    /./
  );
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard");
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("gadget")] });
  assert.equal(zoneOf(game.engine, game.id("gadget")), "hand", "one item is fine (positive control)");
  assert.equal(zoneOf(game.engine, game.id("gizmo")), "discard");
});

// -- printed cost / threshold / stats / subtype of the five characters and the item ------

/** Deploys `printingId` for exactly `cost` of `icons`; refused one short and with the wrong icons; then checks the printed stats. */
function printedFrame(
  printingId: string,
  spec: { cost: number; threshold: number; stats?: { strength: number; speed: number; life: number }; subtype?: string[]; type: "character" | "item" }
): void {
  const mk = (elitism: number, rage: number) =>
    board([
      { key: "card", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("elitism", elitism, P1),
      ...bank("rage", rage, P1)
    ]);
  const settle = (engine: SpoilsEngine) =>
    drain(engine, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)));
  const total = Math.max(spec.cost, spec.threshold);
  const ok = mk(total, 0);
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("card"));
  settle(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("card")), "play", "deployed with the right icons");
  assert.equal(before - readyResources(ok.engine, P1), spec.cost, `exactly the printed cost ${spec.cost} was paid`);
  const def = ok.engine.getDefinition(ok.id("card"));
  assert.equal(def.type, spec.type);
  if (spec.subtype) assert.deepEqual(def.subtype, spec.subtype);
  if (spec.stats) {
    assert.equal(ok.engine.getStat(ok.id("card"), "strength"), spec.stats.strength, "strength");
    assert.equal(ok.engine.getStat(ok.id("card"), "speed"), spec.stats.speed, "speed");
    assert.equal(ok.engine.getStat(ok.id("card"), "life"), spec.stats.life, "life");
  }
  if (spec.cost > 0) {
    // one ready resource short of the printed cost; spent [E] top the threshold up so only the cost can refuse
    const short = board([
      { key: "card", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("elitism", spec.cost - 1, P1),
      ...bank("elitism", Math.max(0, spec.threshold - (spec.cost - 1)), P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
    ]);
    refused(() => play(short.engine, P1, short.id("card")), `${spec.cost - 1} ready elitism cannot pay the cost (threshold met)`, /Costs cannot be paid/);
  }
  // the threshold is exactly this many elitism: that many, padded with rage up to the cost, is enough
  const exactIcons = mk(spec.threshold, Math.max(0, spec.cost - spec.threshold));
  play(exactIcons.engine, P1, exactIcons.id("card"));
  settle(exactIcons.engine);
  assert.equal(zoneOf(exactIcons.engine, exactIcons.id("card")), "play", `exactly ${spec.threshold} elitism plus rage for the rest is enough`);
  // the threshold needs ALL its icons: one fewer elitism (padded with rage to the full cost) is refused
  const lacking = mk(spec.threshold - 1, Math.max(spec.cost, spec.threshold));
  refused(() => play(lacking.engine, P1, lacking.id("card")), `${spec.threshold - 1} elitism do not meet the threshold`);
  const none = mk(0, 8);
  refused(() => play(none.engine, P1, none.id("card")), "rage cannot meet an elitism threshold");
}

clause(NODEBOX, "0:rule", "deploys for its printed cost 2 / threshold [E] and has 1 strength, 1 speed, 2 life, subtype node", () =>
  printedFrame(NODEBOX, { cost: 2, threshold: 1, stats: { strength: 1, speed: 1, life: 2 }, subtype: ["node"], type: "character" })
);
clause(TITAN, "0:unique", "deploys for its printed cost 6 / threshold [E][E] and has 4 strength, 4 speed, 4 life, subtype warmachine", () =>
  printedFrame(TITAN, { cost: 6, threshold: 2, stats: { strength: 4, speed: 4, life: 4 }, subtype: ["warmachine"], type: "character" })
);
clause(FLASH, "0:rule", "deploys for its printed cost 3 / threshold [E][E] and has 1 strength, 3 speed, 3 life, subtype machine", () =>
  printedFrame(FLASH, { cost: 3, threshold: 2, stats: { strength: 1, speed: 3, life: 3 }, subtype: ["machine"], type: "character" })
);
clause(RUNIC, "0:ability:runic-load", "deploys for its printed cost 0 / threshold [E][E][E]: free, but only with three elitism", () =>
  printedFrame(RUNIC, { cost: 0, threshold: 3, type: "item" })
);
clause(SCRAP, "0:extraCost", "deploys for its printed cost 1 / threshold [E][E] and has 1 strength, 3 speed, 1 life, subtype horsemajig", () =>
  printedFrame(SCRAP, { cost: 1, threshold: 2, stats: { strength: 1, speed: 3, life: 1 }, subtype: ["horsemajig"], type: "character" })
);

// ============================================================================
// Mutation-pass additions (T3c3)
// ============================================================================

clause(TITAN, "0:unique", "the designation is PT: another UNIQUE PT card I control makes me keep one", () => {
  const { engine, id } = board([
    { key: "pt", def: printing(TITAN), owner: P1, zone: "hand" },
    { key: "other", def: character({ name: "Not Titan", unique: "pt" } as never), owner: P1, zone: "play" },
    ...bank("elitism", 6, P1)
  ]);
  play(engine, P1, id("pt"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "a differently named card with the PT designation counts");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("pt"), id("other")].sort());
});

clause(FLASH, "0:rule", "its only keywords are the two printed rules: no COVERT, AGGRO or TACTICAL", () => {
  const { engine, id } = board([{ key: "fl", def: printing(FLASH), owner: P1, zone: "play", attackEligible: false }], { turn: 2 });
  const keywords = engine.getKeywords(id("fl"));
  for (const phantom of ["covert", "aggro", "tactical"]) assert.equal(keywords.includes(phantom as never), false, `no ${phantom}`);
  assert.throws(
    () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fl")], target: { type: "faction", playerId: P2 } }),
    "without AGGRO it cannot attack the turn it enters play"
  );
});

clause(RUNIC, "1:ability:runic-gather", "the tokens can come from any card I control: an item, a location or a character (not only a character)", () => {
  for (const [label, def] of [
    ["item", item({ name: "Tokened Item" })],
    ["location", location({ name: "Tokened Place", structure: 4 })],
    ["character", character({ name: "Tokened Guy" })]
  ] as const) {
    const { engine, id } = rdBoard([{ key: "src", def, owner: P1, zone: "play", counters: { token: 3 } }], 6);
    gather(engine, id, 2, "src");
    assert.equal(pending(engine), undefined);
    assert.equal(tokensOn(engine, id("src")), 1, `2 removed from the ${label}`);
    assert.equal(tokensOn(engine, id("rd")), 2, `2 put on the Distribulator from the ${label}`);
  }
});

clause(RUNIC, "1:ability:runic-gather", "X=0 is a legal number: pays 1, moves no tokens", () => {
  const { engine, id } = rdBoard([src(2)], 6, 1);
  const before = readyResources(engine, P1);
  gather(engine, id, 0, "src");
  assert.equal(pending(engine), undefined);
  assert.equal(before - readyResources(engine, P1), 1, "Pay X+1 = 1");
  assert.equal(tokensOn(engine, id("src")), 2, "no token left the source");
  assert.equal(tokensOn(engine, id("rd")), 1, "no token arrived");
});

clause(SCRAP, "0:extraCost", "a real (non-token) card named Micromajig cannot be destroyed for the extra cost", () => {
  const game = sjBoard(false, [
    { key: "real", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" }
  ]);
  refused(() => play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("real")] } }), "a card that is not a token");
  assert.equal(zoneOf(game.engine, game.id("real")), "play", "the real card stays in play");
  assert.equal(zoneOf(game.engine, game.id("sj")), "hand");
});

clause(SCRAP, "0:extraCost", "destroys exactly one token: picking two tokens is refused and both stay", () => {
  const game = sjBoard(true, [micro("mm2")]);
  refused(() => play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1"), game.id("mm2")] } }), "two tokens for one 'a token'");
  assert.equal(zoneOf(game.engine, game.id("mm1")), "play");
  assert.equal(zoneOf(game.engine, game.id("mm2")), "play");
  assert.equal(zoneOf(game.engine, game.id("sj")), "hand");
  play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1")] } });
  assert.equal(inPlayNamed(game.engine, P1, "Micromajig").length, 1, "one token destroyed, the other kept");
});

clause(SCRAP, "0:extraCost", "the token is DESTROYED (a destroy event happens), not just discarded", () => {
  const game = sjBoard();
  const before = game.engine.state.turnEventTally["cardDestroyed"] ?? 0;
  castScrap(game, true, []);
  assert.equal((game.engine.state.turnEventTally["cardDestroyed"] ?? 0) - before, 1, "exactly one card was destroyed: the token");
});

clause(SCRAP, "1:rule", "a second Scrapple-Jack already in play does not return an item when another one enters: exactly one item comes back", () => {
  const game = sjBoard(true, [{ key: "sj0", def: printing(SCRAP), owner: P1, zone: "play" }]);
  play(game.engine, P1, game.id("sj"), { selected: { tok: [game.id("mm1")] } });
  let prompts = 0;
  drain(game.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      prompts++;
      const left = ["gadget", "gizmo"].find((k) => zoneOf(game.engine, game.id(k)) === "discard")!;
      return { kind: "chooserSelectsTarget", selected: [game.id(left)] };
    }
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    return declineAll(pc);
  });
  assert.equal(prompts, 1, "only the entering Scrapple-Jack asks for an item");
  const back = ["gadget", "gizmo"].filter((k) => zoneOf(game.engine, game.id(k)) === "hand");
  assert.equal(back.length, 1, "exactly one item went back to my hand");
});
