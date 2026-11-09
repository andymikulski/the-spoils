// Multiplayer clause tests for Shade of the Devoured Emperor, part 1: every clause the multiplayer spec
// (data/card-tests/mp-spec/shade-of-the-devoured-emperor.json) marks "changes" for the cards that name an opponent.
// Real catalog printings on real 3- and 4-seat games, played through `perform`. P1 controls the card under test.
import assert from "node:assert/strict";
import { character, resourceCard, tactic } from "../../support/fixtures.js";
import { bank, volition } from "../../per-card/_harness.js";
import { mpClause, printing, refused } from "../_clause.js";
import { 
  alive, choosePlayer, controllerOf, deck, doom, filler, fight, go, hand, needs, offered, pay, pcOf, pickCandidates, pickCards, pickOption, play, stat, table, use, zone, P1, P2, P3, P4, type Pid, type Placement
 } from "./_shade.js";

const FORGOTTEN_TENTACLE = "2eb0069f-52fc-4ab6-a0a0-86919ba57118";
const MAN_SHARK = "efc19e34-03c2-4673-a5da-9d1f19af2409";
const NEURALYZER = "0a7c01eb-92bd-4172-9c0d-24886de70287";
const VIOLATING_RITUAL = "ee97a193-2abc-4f68-880f-bb128a536f28";
const VOIDAL_TRINKET = "e7db74e2-02ff-4297-ac9a-860b2bd3c263";
const MICROMAJIG_MAKER = "67fe9bf8-04c3-4ea0-bbde-0ec94e33b56e";
const NEGOTIATION = "fc6ce67c-25c7-48b2-911c-fec7572c8154";
const BOTTLEBEARD = "2b1308a7-014c-4924-b430-0448854cb6cc";

const faceDown = (owner: Pid, key: string): Placement => ({ ...volition(1, owner)[0]!, key });

// --- Forgotten Tentacle ------------------------------------------------------------------------

mpClause(FORGOTTEN_TENTACLE, "0:ability", 3, "3 seats: the controller picks which opponent; only that opponent's face-down resources are offered and only that opponent draws and plays", () => {
  for (const [chosen, other] of [[P3, P2], [P2, P3]] as const) {
    const b = table(3, [
      { key: "ft", def: printing(FORGOTTEN_TENTACLE), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1),
      faceDown(P1, "fd-p1"),
      faceDown(P2, "fd-p2"),
      faceDown(P3, "fd-p3"),
      { key: "d2", def: character({ name: "Deck P2" }), owner: P2, zone: "deck" },
      { key: "d3", def: character({ name: "Deck P3" }), owner: P3, zone: "deck" },
      { key: "h2", def: resourceCard({ name: "Hand res P2" }), owner: P2, zone: "hand" },
      { key: "h3", def: resourceCard({ name: "Hand res P3" }), owner: P3, zone: "hand" }
    ]);
    const asks = needs(b, play(b, P1, "ft"));
    assert.deepEqual(asks[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] }, "the opponent is asked first, P1 is not a candidate");
    assert.deepEqual(pickCandidates(b, play(b, P1, "ft", { players: { picked: chosen } })), [b.id(`fd-${chosen}`)], "only the chosen opponent's face-down resources are offered");
    refused(() => b.engine.perform(play(b, P1, "ft", { players: { picked: chosen }, selected: { fd: [b.id(`fd-${other}`)] } })), "a face-down resource of the other opponent");
    refused(() => b.engine.perform(play(b, P1, "ft", { players: { picked: chosen }, selected: { fd: [b.id("fd-p1")] } })), "the controller's own face-down resource");
    go(b, play(b, P1, "ft", { players: { picked: chosen }, selected: { fd: [b.id(`fd-${chosen}`)] } }));
    assert.equal(pcOf(b.engine)?.playerId, P1);
    pickOption(b, P1, 1);
    assert.equal(zone(b, `fd-${chosen}`), "discard", "the picked resource is destroyed");
    assert.equal(zone(b, `fd-${other}`), "play");
    assert.equal(zone(b, "fd-p1"), "play");
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsOption");
    assert.equal(pcOf(b.engine)?.playerId, chosen, "that player (not the other opponent) decides whether to draw");
    pickOption(b, chosen, 1);
    assert.equal(hand(b.engine, chosen).includes(b.id(`d${chosen.slice(1)}`)), true, "that player drew");
    assert.equal(deck(b.engine, other).length, 1, "the other opponent did not");
    assert.equal(pcOf(b.engine)?.playerId, chosen, "that player may play a resource");
    assert.deepEqual(new Set(offered(b)), new Set(hand(b.engine, chosen)), "exactly that player's own hand is offered (the drawn card included)");
    pickCards(b, chosen, [`h${chosen.slice(1)}`]);
    assert.equal(zone(b, `h${chosen.slice(1)}`), "play", "the chosen opponent played their resource");
    assert.equal(zone(b, `h${other.slice(1)}`), "hand", "the other opponent's hand is untouched");
    assert.equal(pcOf(b.engine), undefined);
  }
});

// --- Man Shark ---------------------------------------------------------------------------------

const sharkBoard = (seats: 3 | 4, faceDowns: Partial<Record<Pid, number>>, extra: Placement[] = []) =>
  table(seats, [
    { key: "shark", def: printing(MAN_SHARK), owner: P1, zone: "play" },
    ...([P1, P2, P3, P4] as Pid[]).flatMap((owner) => Array.from({ length: faceDowns[owner] ?? 0 }, (_, i) => faceDown(owner, `fd-${owner}-${i}`))),
    ...extra
  ]);

mpClause(MAN_SHARK, "0:rule", 3, "3 seats: +1 strength and +1 life for each face-down resource all opponents control together; the controller's own do not count", () => {
  const base = printing(MAN_SHARK);
  const b = sharkBoard(3, { [P1]: 4, [P2]: 2, [P3]: 3 });
  assert.deepEqual([stat(b, "shark", "strength"), stat(b, "shark", "life")], [base.strength! + 5, base.life! + 5]);
  const lessB = sharkBoard(3, { [P1]: 4, [P2]: 2, [P3]: 2 });
  assert.deepEqual([stat(lessB, "shark", "strength"), stat(lessB, "shark", "life")], [base.strength! + 4, base.life! + 4]);
  const none = sharkBoard(3, { [P1]: 4 });
  assert.deepEqual([stat(none, "shark", "strength"), stat(none, "shark", "life")], [base.strength!, base.life!]);
});
mpClause(MAN_SHARK, "0:rule", 4, "4 seats: the face-down resources of all three opponents count; an eliminated opponent's stop counting", () => {
  const base = printing(MAN_SHARK);
  const b = sharkBoard(4, { [P1]: 5, [P2]: 2, [P3]: 3, [P4]: 1 }, [doom(P4)]);
  assert.deepEqual([stat(b, "shark", "strength"), stat(b, "shark", "life")], [base.strength! + 6, base.life! + 6]);
  go(b, play(b, P1, "doom"));
  assert.equal(alive(b.engine, P4), false);
  assert.deepEqual([stat(b, "shark", "strength"), stat(b, "shark", "life")], [base.strength! + 5, base.life! + 5]);
});
mpClause(MAN_SHARK, "1:ability:ms-follow", 3, "3 seats: the controller picks the opponent; only that opponent picks a card from their hand and puts it face-down under their control", () => {
  for (const [chosen, other] of [[P3, P2], [P2, P3]] as const) {
    const b = sharkBoard(3, {}, [...bank("rage", 3, P1), ...filler(P2, "hand", 2), ...filler(P3, "hand", 2)]);
    const action = use(b, P1, "shark", "ms-follow");
    assert.deepEqual(needs(b, action)[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] });
    go(b, use(b, P1, "shark", "ms-follow", { players: { picked: chosen } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, chosen, "the picked opponent chooses");
    assert.deepEqual(new Set(offered(b)), new Set(hand(b.engine, chosen)), "only that opponent's hand is offered");
    pickCards(b, chosen, [`hand-${chosen}-0`]);
    assert.equal(zone(b, `hand-${chosen}-0`), "play");
    assert.equal(b.engine.state.cards[b.id(`hand-${chosen}-0`)]!.faceDown, true, "put face-down as a resource");
    assert.equal(controllerOf(b, `hand-${chosen}-0`), chosen, "under their own control");
    assert.equal(hand(b.engine, other).length, 2, "the other opponent's hand is unchanged");
    assert.equal(hand(b.engine, P1).length, 0);
  }
});

// --- Neuralyzer Agent --------------------------------------------------------------------------

const neuralyzerBoard = (extra: Placement[] = [], threshold = false) =>
  table(3, [
    { key: "agent", def: printing(NEURALYZER), owner: P1, zone: "play" },
    ...(threshold ? bank("obsession", 6, P1) : []),
    ...filler(P2, "hand", 2),
    ...filler(P3, "hand", 2),
    ...filler(P1, "hand", 2),
    ...extra
  ]);

mpClause(NEURALYZER, "0:rule", 3, "3 seats: when the Agent attacks the controller picks an opponent (need not be the attacked player); only that opponent discards a card of their choice", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = neuralyzerBoard();
    b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("agent")], target: { type: "faction", playerId: P3 } });
    assert.equal(pcOf(b.engine)?.kind, "choosePlayer", "the controller is asked which opponent");
    assert.equal(pcOf(b.engine)?.playerId, P1);
    assert.deepEqual((pcOf(b.engine) as unknown as { candidates: Pid[] }).candidates, [P2, P3]);
    choosePlayer(b, P1, picked);
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, picked, "the picked opponent chooses the card");
    assert.deepEqual(new Set(offered(b)), new Set(hand(b.engine, picked)), "from their own hand only");
    pickCards(b, picked, [`hand-${picked}-1`]);
    assert.equal(zone(b, `hand-${picked}-1`), "discard");
    assert.equal(hand(b.engine, picked).length, 1);
    assert.equal(hand(b.engine, other).length, 2, "the other opponent discards nothing");
    assert.equal(hand(b.engine, P1).length, 2, "the controller discards nothing");
  }
});
mpClause(NEURALYZER, "1:rule@oooooo", 3, "3 seats: battle damage to an opponent's faction makes that faction's owner discard; nobody is asked to choose an opponent", () => {
  for (const [victim, bystander] of [[P3, P2], [P2, P3]] as const) {
    const b = neuralyzerBoard([], true);
    b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("agent")], target: { type: "faction", playerId: victim } });
    let discarder: Pid | undefined;
    let opponentPrompts = 0;
    fight(b, (pc) => {
      if (pc.kind === "choosePlayer") {
        opponentPrompts++;
        return { kind: "choosePlayer", playerId: victim };
      }
      if (pc.kind === "chooserSelectsTarget" && discarder === undefined) discarder = pc.playerId;
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [hand(b.engine, pc.playerId)[0]] };
      return undefined;
    });
    assert.equal(opponentPrompts, 1, "only the attack trigger asks for an opponent; the damage trigger asks nobody");
    assert.equal(discarder, victim, "the damaged faction's owner discards");
    assert.equal(hand(b.engine, victim).length, 0, "attack trigger and damage trigger: one discard each");
    assert.equal(hand(b.engine, bystander).length, 2, "the other opponent is untouched");
  }
});

// --- Violating Ritual --------------------------------------------------------------------------

mpClause(VIOLATING_RITUAL, "0:ability", 3, "3 seats: the controller picks an opponent as part of the cost; only that opponent discards 2 cards of their choice, then the controller draws a card", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = table(3, [
      { key: "vr", def: printing(VIOLATING_RITUAL), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...filler(P1, "deck", 2),
      ...filler(P2, "hand", 3),
      ...filler(P3, "hand", 3)
    ]);
    assert.deepEqual(needs(b, play(b, P1, "vr"))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] }, "P1 is not a candidate");
    refused(() => b.engine.perform(play(b, P1, "vr", { players: { picked: P1 } })), "the controller as the picked opponent");
    go(b, play(b, P1, "vr", { players: { picked } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, picked, "that opponent chooses the discards");
    assert.deepEqual(new Set(offered(b)), new Set(hand(b.engine, picked)), "from their own hand only");
    pickCards(b, picked, [`hand-${picked}-0`, `hand-${picked}-2`]);
    assert.equal(hand(b.engine, picked).length, 1, "two discarded");
    assert.equal(hand(b.engine, other).length, 3, "the other opponent's hand is unchanged");
    assert.equal(hand(b.engine, P1).length, 1, "the controller drew a card");
    assert.equal(pcOf(b.engine), undefined);
  }
});

// --- Voidal Trinket ----------------------------------------------------------------------------

mpClause(VOIDAL_TRINKET, "0:ability:voidal-trinket-augur", 3, "3 seats: the controller picks the opponent; only that opponent may detach up to X of their own resources from their faction", () => {
  for (const [picked, other] of [[P3, P2], [P2, P3]] as const) {
    const attached = (owner: Pid, faction: string): Placement[] =>
      [0, 1, 2].map((i) => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner, attachedToKey: faction }));
    const b = table(3, [
      { key: "vt", def: printing(VOIDAL_TRINKET), owner: P1, zone: "play" },
      ...filler(P1, "deck", 4),
      ...attached(P2, "__factionB"),
      ...attached(P3, "__faction_p3"),
      ...attached(P1, "__factionA")
    ]);
    const base = { variables: { x: 2 }, selected: { keep: [] as string[] } };
    assert.deepEqual(needs(b, use(b, P1, "vt", "voidal-trinket-augur", base))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] });
    go(b, use(b, P1, "vt", "voidal-trinket-augur", { ...base, players: { picked } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, picked, "the picked opponent decides the detach");
    assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2].map((i) => b.id(`res-${picked}-${i}`))), "only that opponent's resources on their faction are offered");
    pickCards(b, picked, [`res-${picked}-0`, `res-${picked}-1`]);
    const attachedTo = (key: string) => b.engine.state.cards[b.id(key)]!.attachedTo;
    assert.equal(attachedTo(`res-${picked}-0`), undefined, "detached");
    assert.equal(attachedTo(`res-${picked}-1`), undefined, "detached");
    assert.equal(attachedTo(`res-${picked}-2`) !== undefined, true, "only X = 2 of them");
    for (const i of [0, 1, 2]) assert.notEqual(attachedTo(`res-${other}-${i}`), undefined, "the other opponent's resources stay attached");
    for (const i of [0, 1, 2]) assert.notEqual(attachedTo(`res-${P1}-${i}`), undefined, "the controller's own stay attached");
    assert.equal(b.engine.state.cards[b.id("vt")]!.depleted, true, "the Trinket is depleted as the cost");
    // the controller then looks at the top 2 cards of their own deck
    assert.equal(pcOf(b.engine)?.kind, "reorderDeck");
    assert.equal(pcOf(b.engine)?.playerId, P1);
    assert.deepEqual((pcOf(b.engine) as unknown as { cardIds: string[] }).cardIds, deck(b.engine, P1).slice(0, 2), "the top 2 cards of the controller's own deck");
  }
});

// --- Micromajigmakermachinemajig ---------------------------------------------------------------

const majigsOf = (b: ReturnType<typeof table>, who: Pid): number =>
  Object.values(b.engine.state.cards).filter((card) => card.zone === "play" && card.controllerId === who && b.engine.getDefinition(card.id).name === "Micromajig").length;

mpClause(MICROMAJIG_MAKER, "0:ability:mmm-release", 3, "3 seats: the controller picks the opponent; only that opponent may put a Micromajig token under their control, then the controller puts one under theirs", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = table(3, [{ key: "mmm", def: printing(MICROMAJIG_MAKER), owner: P1, zone: "play" }]);
    assert.deepEqual(needs(b, use(b, P1, "mmm", "mmm-release"))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] });
    go(b, use(b, P1, "mmm", "mmm-release", { players: { picked } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsOption", "a yes / no question");
    assert.equal(pcOf(b.engine)?.playerId, picked, "put to the picked opponent only");
    pickOption(b, picked, 1);
    assert.equal(majigsOf(b, picked), 1, "the picked opponent got a token under their control");
    assert.equal(majigsOf(b, other), 0, "the other opponent gets none");
    assert.equal(majigsOf(b, P1), 1, "the controller gets one too");
    assert.equal(pcOf(b.engine), undefined);
  }
  const declined = table(3, [{ key: "mmm", def: printing(MICROMAJIG_MAKER), owner: P1, zone: "play" }]);
  go(declined, use(declined, P1, "mmm", "mmm-release", { players: { picked: P3 } }));
  pickOption(declined, P3, 0);
  assert.deepEqual([majigsOf(declined, P2), majigsOf(declined, P3), majigsOf(declined, P1)], [0, 0, 1], "a declining picked opponent gets no token");
});

// --- Negotiation Ceremonies --------------------------------------------------------------------

function negotiation(seats: 3 | 4, picked: Pid, payments: boolean[]): ReturnType<typeof table> {
  const b = table(seats, [
    { key: "nc", def: printing(NEGOTIATION), owner: P1, zone: "hand" },
    ...bank("greed", 2, P1),
    ...bank("rage", 6, P1),
    ...bank("rage", 6, P2),
    ...bank("rage", 6, P3),
    ...(seats === 4 ? bank("rage", 6, P4) : []),
    ...([P1, P2, P3, P4] as Pid[]).slice(0, seats).flatMap((owner) => filler(owner, "deck", 6))
  ]);
  go(b, play(b, P1, "nc", { players: { picked } }));
  const order: Pid[] = [];
  for (const yes of payments) {
    const pc = pcOf(b.engine);
    assert.equal(pc?.kind, "alternatingPay");
    order.push(pc!.playerId);
    pay(b, pc!.playerId, yes, "alternatingPay");
  }
  assert.deepEqual(order, payments.map((_, i) => (i % 2 === 0 ? P1 : picked)), "the payment alternates between the controller and the picked opponent only");
  return b;
}

mpClause(NEGOTIATION, "0:ability", 3, "3 seats: the payment alternates between the controller and the picked opponent only; each of the two draws what they paid, the third player neither pays nor draws", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = negotiation(3, picked, [true, true, true, true, true, false]);
    assert.equal(hand(b.engine, P1).length, 3, "the controller paid 3 and draws 3");
    assert.equal(hand(b.engine, picked).length, 2, "the picked opponent paid 2 and draws 2");
    assert.equal(hand(b.engine, other).length, 0, "the other opponent draws nothing");
    assert.equal(pcOf(b.engine), undefined);
  }
  const none = negotiation(3, P2, [false]);
  assert.deepEqual([hand(none.engine, P1).length, hand(none.engine, P2).length, hand(none.engine, P3).length], [0, 0, 0], "nothing paid, nobody draws");
});
mpClause(NEGOTIATION, "0:ability", 4, "4 seats: the controller picks P3; P2 and P4 never pay or draw", () => {
  const b = negotiation(4, P3, [true, true, true, false]);
  assert.deepEqual([hand(b.engine, P1).length, hand(b.engine, P2).length, hand(b.engine, P3).length, hand(b.engine, P4).length], [2, 0, 1, 0]);
  const b2 = table(4, [{ key: "nc", def: printing(NEGOTIATION), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]);
  assert.deepEqual(needs(b2, play(b2, P1, "nc"))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3, P4] }] });
});

// --- Bottlebeard Brandyshanks ------------------------------------------------------------------

const topOf = (kind: "character" | "tactic", owner: Pid): Placement[] => [
  { key: `top-${owner}`, def: kind === "character" ? character({ name: `Top ${owner}` }) : tactic({ name: `Top ${owner}` }), owner, zone: "deck" },
  ...filler(owner, "deck", 2)
];
function bottlebeard(seats: 3 | 4, tops: Partial<Record<Pid, "character" | "tactic">>, extra: Placement[] = []) {
  return table(seats, [
    { key: "bb", def: printing(BOTTLEBEARD), owner: P1, zone: "play" },
    ...([P1, P2, P3, P4] as Pid[]).slice(0, seats).flatMap((owner) => topOf(tops[owner] ?? "tactic", owner)),
    ...extra
  ]);
}
const revealedTops = (b: ReturnType<typeof table>): Pid[] =>
  b.engine.getFlowView().revealed.deckTop.map((entry: { playerId: Pid }) => entry.playerId).sort();

mpClause(BOTTLEBEARD, "1:rule", 3, "3 seats: the top card of every opponent's deck is revealed (not the controller's); +3 speed if any of those cards is a character, once", () => {
  const speed = printing(BOTTLEBEARD).speed!;
  const cases: Array<[Partial<Record<Pid, "character" | "tactic">>, number]> = [
    [{ [P2]: "character", [P3]: "tactic" }, 3],
    [{ [P2]: "tactic", [P3]: "tactic" }, 0],
    [{ [P2]: "tactic", [P3]: "character" }, 3],
    [{ [P2]: "character", [P3]: "character" }, 3],
    [{ [P1]: "character", [P2]: "tactic", [P3]: "tactic" }, 0]
  ];
  for (const [tops, bonus] of cases) {
    const b = bottlebeard(3, tops);
    assert.deepEqual(revealedTops(b), [P2, P3], JSON.stringify(tops));
    assert.equal(stat(b, "bb", "speed"), speed + bonus, JSON.stringify(tops));
  }
});
mpClause(BOTTLEBEARD, "1:rule", 4, "4 seats: the tops of all three opponents' decks are revealed; one character among them gives +3 speed; the controller's deck top never counts", () => {
  const speed = printing(BOTTLEBEARD).speed!;
  const only4 = bottlebeard(4, { [P2]: "tactic", [P3]: "tactic", [P4]: "character" });
  assert.deepEqual(revealedTops(only4), [P2, P3, P4]);
  assert.equal(stat(only4, "bb", "speed"), speed + 3);
  const none = bottlebeard(4, { [P1]: "character", [P2]: "tactic", [P3]: "tactic", [P4]: "tactic" });
  assert.equal(stat(none, "bb", "speed"), speed);
});
mpClause(BOTTLEBEARD, "2:ability:bottlebeard-chug", 3, "3 seats: the controller picks the opponent; only that opponent's top card goes to the bottom of their deck", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = bottlebeard(3, {}, [...bank("deception", 2, P1)]);
    const pickedBefore = deck(b.engine, picked).slice();
    const otherBefore = deck(b.engine, other).slice();
    assert.deepEqual(needs(b, use(b, P1, "bb", "bottlebeard-chug"))[0], { kind: "players", choices: [{ id: "picked", candidates: [P2, P3] }] });
    go(b, use(b, P1, "bb", "bottlebeard-chug", { players: { picked } }));
    assert.deepEqual(deck(b.engine, picked), [...pickedBefore.slice(1), pickedBefore[0]], "the picked opponent's top card is now the bottom");
    assert.deepEqual(deck(b.engine, other), otherBefore, "the other opponent's deck is unchanged");
  }
});

// <<END>>
