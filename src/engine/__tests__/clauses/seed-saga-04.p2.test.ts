// Clause tests - batch seed-saga-04, part p2 (groups 6-10, missing clauses only).
// Cards: Essence of Greed, Executive Order #6370u7, Extravagant Contusion, Flabbergasting Philosopher, Foolhardy Desperado.
import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  fightThrough,
  playRaw
} from "./_battle.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";

type Eng = SpoilsEngine;
const G = (n: number, owner: PlayerId = P1) => bank("greed", n, owner);
const R = (n: number, owner: PlayerId = P1) => bank("rage", n, owner);
const spentG = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("greed", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const handOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].hand as unknown as string[];
const deckOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].deck as unknown as string[];
const influence = (engine: Eng, p: PlayerId): number => engine.state.players[p].influence as number;
const perform = (engine: Eng, action: unknown): void => engine.perform(action as never);
const hasKw = (engine: Eng, cardId: string, kw: string): boolean => (engine.getKeywords(cardId) as string[]).includes(kw);
const body = (key: string, owner: PlayerId = P1, over: Parameters<typeof character>[0] = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength: 2, speed: 2, life: 3, ...over }),
  owner,
  zone: "play"
});

// ===========================================================================================
// Essence of Greed - tactic - banker - cost 1 - threshold gg
// ===========================================================================================
const ESSENCE = "3accdb7a-e165-434f-b23b-beeb6ee03f9d";

const essBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[] } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "es", def: printing(ESSENCE), owner: P1, zone: "hand" },
      body("mine", P1),
      body("theirs", P2),
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.pay ?? G(2).concat(R(2))),
      ...(o.extra ?? [])
    ]
  });

clause(ESSENCE, "0:rule", "printed cost 1, threshold [G][G], tactic: payable with [G][G] + one more resource; refused with the cost short (spent [G][G] and nothing else), a [G] short, no [G], or the opponent's [G]", () => {
  const def = printing(ESSENCE);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "gg");
  assert.equal(def.subtype.length, 0);
  const ok = essBoard({ pay: spentG(2).concat(R(1)) });
  play(ok.engine, P1, ok.id("es"), { mode: 0 });
  assert.equal(zoneOf(ok.engine, ok.id("es")), "discard", "control: spent [G][G] + one ready Rage deploys it");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 1 paid");
  const costShort = essBoard({ pay: spentG(2) });
  refused(() => play(costShort.engine, P1, costShort.id("es"), { mode: 0 }), "threshold met by spent icons but no ready resource to pay 1", /Costs cannot be paid/);
  assert.equal(zoneOf(costShort.engine, costShort.id("es")), "hand");
  const oneG = essBoard({ pay: G(1).concat(R(3)) });
  refused(() => play(oneG.engine, P1, oneG.id("es"), { mode: 0 }), "one [G] only");
  const noG = essBoard({ pay: R(4) });
  refused(() => play(noG.engine, P1, noG.id("es"), { mode: 0 }), "no [G]");
  const theirs = essBoard({ pay: G(1).concat(G(2, P2), R(3)) });
  refused(() => play(theirs.engine, P1, theirs.id("es"), { mode: 0 }), "the opponent's [G] does not count");
});

clause(ESSENCE, "0:rule", "exactly one of the three options is the card's text: OPTION 1 does not gain influence or life, OPTION 2 does not draw or gain influence, OPTION 3 does not draw or give life; an out-of-range option is refused", () => {
  const draw = essBoard();
  play(draw.engine, P1, draw.id("es"), { mode: 0 });
  assert.equal(handOf(draw.engine, P1).length, 2, "hand: hc + drawn (es left the hand)");
  assert.equal(influence(draw.engine, P1), 20, "option 1 gains no influence");
  assert.equal(draw.engine.getStat(draw.id("mine"), "life"), 3);
  assert.equal(draw.engine.getStat(draw.id("theirs"), "life"), 3);
  const life = essBoard();
  play(life.engine, P1, life.id("es"), { mode: 1, selected: { c: [life.id("mine")] } });
  assert.equal(handOf(life.engine, P1).length, 1, "option 2 draws nothing (only hc in hand)");
  assert.equal(influence(life.engine, P1), 20);
  assert.equal(life.engine.getStat(life.id("mine"), "life"), 5);
  const inf = essBoard();
  play(inf.engine, P1, inf.id("es"), { mode: 2 });
  assert.equal(handOf(inf.engine, P1).length, 1, "option 3 draws nothing");
  assert.equal(inf.engine.getStat(inf.id("mine"), "life"), 3);
  assert.equal(inf.engine.getStat(inf.id("theirs"), "life"), 3);
  const bad = essBoard();
  refused(() => play(bad.engine, P1, bad.id("es"), { mode: 3 }), "there is no 4th option");
  assert.equal(zoneOf(bad.engine, bad.id("es")), "hand");
  assert.equal(readyResources(bad.engine, P1), 4, "nothing paid");
});

clause(ESSENCE, "1:option:OPTION 1", "OPTION 1: its controller draws exactly one card (the top card of their deck); the opponent's hand and deck are untouched; the tactic goes to the discard pile", () => {
  const b = essBoard();
  const top = deckOf(b.engine, P1)[0];
  const deckBefore = deckOf(b.engine, P1).length;
  const oppHand = handOf(b.engine, P2).length;
  const oppDeck = deckOf(b.engine, P2).length;
  const handBefore = handOf(b.engine, P1).length; // includes es
  play(b.engine, P1, b.id("es"), { mode: 0 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "es left, one card drawn");
  assert.ok(handOf(b.engine, P1).includes(top), "the top card was drawn");
  assert.equal(deckOf(b.engine, P1).length, deckBefore - 1);
  assert.equal(handOf(b.engine, P2).length, oppHand);
  assert.equal(deckOf(b.engine, P2).length, oppDeck);
  assert.equal(zoneOf(b.engine, b.id("es")), "discard");
  assert.equal(readyResources(b.engine, P1), 3, "cost 1 paid");
});

clause(ESSENCE, "2:option:OPTION 2", "OPTION 2: the picked character gains 2 life (mine, the opponent's, or one with damage); other characters are unaffected; it costs 1", () => {
  const mine = essBoard();
  play(mine.engine, P1, mine.id("es"), { mode: 1, selected: { c: [mine.id("mine")] } });
  assert.equal(mine.engine.state.pendingChoice, undefined);
  assert.equal(mine.engine.getStat(mine.id("mine"), "life"), 5, "3 + 2");
  assert.equal(mine.engine.getStat(mine.id("theirs"), "life"), 3, "the other character is unaffected");
  assert.equal(zoneOf(mine.engine, mine.id("es")), "discard");
  assert.equal(readyResources(mine.engine, P1), 3);
  const theirs = essBoard();
  play(theirs.engine, P1, theirs.id("es"), { mode: 1, selected: { c: [theirs.id("theirs")] } });
  assert.equal(theirs.engine.getStat(theirs.id("theirs"), "life"), 5, "any character, including the opponent's");
  assert.equal(theirs.engine.getStat(theirs.id("mine"), "life"), 3);
  const hurt = essBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "play", damage: 2 }] });
  play(hurt.engine, P1, hurt.id("es"), { mode: 1, selected: { c: [hurt.id("hurt")] } });
  assert.equal(hurt.engine.getStat(hurt.id("hurt"), "life"), 5);
  assert.equal(zoneOf(hurt.engine, hurt.id("hurt")), "play");
});

clause(ESSENCE, "2:option:OPTION 2", "OPTION 2 EXTRA COST: a character must be picked: no pick, a faction, an item, a location, a character in hand or discard, or two characters are all refused (nothing is paid)", () => {
  const b = essBoard();
  const fac = b.engine.state.players[P1].factionId!;
  const tryPick = (sel: Record<string, string[]>) => refused(() => play(b.engine, P1, b.id("es"), { mode: 1, selected: sel }), JSON.stringify(sel));
  tryPick({});
  tryPick({ c: [fac] });
  tryPick({ c: [b.id("it")] });
  tryPick({ c: [b.id("lo")] });
  tryPick({ c: [b.id("hc")] });
  tryPick({ c: [b.id("dc")] });
  tryPick({ c: [b.id("mine"), b.id("theirs")] });
  assert.equal(zoneOf(b.engine, b.id("es")), "hand");
  assert.equal(readyResources(b.engine, P1), 4, "refusals paid nothing");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  play(b.engine, P1, b.id("es"), { mode: 1, selected: { c: [b.id("mine")] } });
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5, "control");
});

clause(ESSENCE, "2:option:OPTION 2", "OPTION 2: the life bonus lasts only 'this turn': gone once the turn ends, but still there during the rest of the turn", () => {
  const b = essBoard();
  play(b.engine, P1, b.id("es"), { mode: 1, selected: { c: [b.id("theirs")] } });
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 5);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 3, "ended with the turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 3, "and does not come back");
});

clause(ESSENCE, "3:option:OPTION 3", "OPTION 3: its controller's faction gains 4 influence (not the opponent's); no card is drawn and no target is needed", () => {
  const b = essBoard();
  const oppInf = influence(b.engine, P2);
  play(b.engine, P1, b.id("es"), { mode: 2 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(influence(b.engine, P1), 24, "20 + 4");
  assert.equal(influence(b.engine, P2), oppInf, "the opponent's influence is untouched");
  assert.equal(zoneOf(b.engine, b.id("es")), "discard");
  assert.equal(readyResources(b.engine, P1), 3, "cost 1");
  assert.equal(handOf(b.engine, P1).length, 1, "nothing drawn");
});

// ===========================================================================================
// Executive Order #6370u7 - item - banker - cost 2 - threshold gg
// ===========================================================================================
const EXEC = "f3d514d8-0d1d-4796-97e5-7640bcffae6a";

type ExecOpts = { zone?: "hand" | "play"; pay?: CardPlacement[]; turnOf?: PlayerId; controller?: PlayerId; extra?: CardPlacement[]; noChars?: boolean; theirsDepleted?: boolean; mineDepleted?: boolean };
const execBoard = (o: ExecOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "eo", def: printing(EXEC), owner: P1, controller: o.controller, zone: o.zone ?? "play" },
      ...(o.noChars
        ? []
        : [
            { ...body("mine", P1), depleted: o.mineDepleted ?? false },
            { ...body("theirs", P2), depleted: o.theirsDepleted ?? false },
            { key: "it2", def: item({ name: "It2" }), owner: P2, zone: "play" as const },
            { key: "lo2", def: location({ name: "Lo2" }), owner: P2, zone: "play" as const },
            { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" as const },
            { key: "dc2", def: character({ name: "DiscChar2" }), owner: P2, zone: "discard" as const },
            { key: "hc1", def: character({ name: "HandChar1" }), owner: P1, zone: "hand" as const }
          ]),
      ...(o.pay ?? G(2).concat(R(2))),
      ...(o.extra ?? [])
    ]
  });

const execPay = (b: ReturnType<typeof execBoard>, who: PlayerId = P1) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, who);
  answerPending(b.engine, "mayPay", { pay: true });
};
const execPick = (b: ReturnType<typeof execBoard>, ids: string[]) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  answerPending(b.engine, "chooserSelectsTarget", { selected: ids });
};
const isDepleted = (b: ReturnType<typeof execBoard>, key: string): boolean => !!b.engine.state.cards[b.id(key)].depleted;

clause(EXEC, "0:rule", "printed cost 2, threshold [G][G], item: deployable with [G][G] + 2 ready resources; refused with the cost short (one ready), a [G] short, no [G], or the opponent's [G]", () => {
  const def = printing(EXEC);
  assert.equal(def.type, "item");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "gg");
  assert.equal(def.subtype.length, 0);
  const ok = execBoard({ zone: "hand", pay: spentG(2).concat(R(2)) });
  play(ok.engine, P1, ok.id("eo"));
  assert.equal(zoneOf(ok.engine, ok.id("eo")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 2 paid");
  const costShort = execBoard({ zone: "hand", pay: spentG(2).concat(R(1)) });
  refused(() => play(costShort.engine, P1, costShort.id("eo")), "one ready resource for cost 2");
  assert.equal(zoneOf(costShort.engine, costShort.id("eo")), "hand");
  const oneG = execBoard({ zone: "hand", pay: G(1).concat(R(3)) });
  refused(() => play(oneG.engine, P1, oneG.id("eo")), "one [G]");
  const noG = execBoard({ zone: "hand", pay: R(4) });
  refused(() => play(noG.engine, P1, noG.id("eo")), "no [G]");
  const theirs = execBoard({ zone: "hand", pay: G(1).concat(G(2, P2), R(3)) });
  refused(() => play(theirs.engine, P1, theirs.id("eo")), "the opponent's [G] does not count");
});

clause(EXEC, "0:rule", "at the start of an opponent's turn its controller is offered 'pay 2 and pick a character'; accepting pays exactly 2 and depletes the picked (ready) character", () => {
  const b = execBoard();
  assert.equal(isDepleted(b, "theirs"), false);
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay", "offered at the start of P2's turn");
  assert.equal(readyResources(b.engine, P1), 4);
  execPay(b);
  execPick(b, [b.id("theirs")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 2, "exactly 2 paid");
  assert.equal(isDepleted(b, "theirs"), true, "the picked character is depleted");
  assert.equal(isDepleted(b, "mine"), false, "other characters are not");
});

clause(EXEC, "0:rule", "'you may': declining pays nothing, depletes nothing, and the character is restored normally by the Restore Rule", () => {
  const b = execBoard({ theirsDepleted: true });
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 4, "nothing paid");
  assert.equal(isDepleted(b, "theirs"), false, "restored by P2's Restore Rule at the start of P2's turn");
  assert.equal(isDepleted(b, "mine"), false);
});

clause(EXEC, "0:rule", "the picked opponent's character that was depleted stays depleted through its controller's Restore Rule this turn, and is restored normally on their next turn", () => {
  const b = execBoard({ theirsDepleted: true });
  endTurn(b.engine, P1);
  execPay(b);
  execPick(b, [b.id("theirs")]);
  assert.equal(isDepleted(b, "theirs"), true, "not restored this turn");
  endTurn(b.engine, P2); // P1's turn: no offer on my own turn
  assert.equal(b.engine.state.pendingChoice, undefined, "no offer at the start of my own turn");
  assert.equal(isDepleted(b, "theirs"), true, "still depleted during my turn (nothing restores it)");
  endTurn(b.engine, P1); // P2's next turn: offered again
  assert.equal(pending(b.engine)?.kind, "mayPay");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(isDepleted(b, "theirs"), false, "'this turn' only: restored on their following turn");
});

clause(EXEC, "0:rule", "a character that is NOT the opponent's can be picked too (my own): it is depleted, and only 'this turn' is its Restore Rule blocked: my own Restore Rule on my next turn restores it", () => {
  const b = execBoard({ mineDepleted: true });
  endTurn(b.engine, P1);
  execPay(b);
  execPick(b, [b.id("mine")]);
  assert.equal(isDepleted(b, "mine"), true, "my picked character is depleted");
  assert.equal(isDepleted(b, "theirs"), false);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b, "mine"), false, "restored by my faction's Restore Rule at the start of my next turn (the block lasted 'this turn' only)");
});

clause(EXEC, "0:rule", "only characters in play can be picked: a faction, item, location, or a character in hand is refused; the offered payment is not consumed by the refusals", () => {
  const b = execBoard();
  endTurn(b.engine, P1);
  execPay(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  for (const bad of [b.engine.state.players[P2].factionId!, b.id("it2"), b.id("lo2"), b.id("hc"), b.id("dc2"), b.id("hc1")]) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [bad] }), bad);
  }
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("theirs"), b.id("mine")] }), "one character only");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  execPick(b, [b.id("theirs")]);
  assert.equal(isDepleted(b, "theirs"), true, "control");
});

clause(EXEC, "0:rule", "'pay 2 and pick a character': once you pay you must pick one (an empty pick is refused)", () => {
  const b = execBoard();
  endTurn(b.engine, P1);
  execPay(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "paid 2 but picked nothing");
  assert.equal(isDepleted(b, "theirs"), false);
  execPick(b, [b.id("theirs")]);
  assert.equal(isDepleted(b, "theirs"), true);
});

clause(EXEC, "0:rule", "not offered at the start of its controller's own turn (only an opponent's turn)", () => {
  const b = execBoard({ turnOf: P2 });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "P1's own turn start: no offer");
  assert.equal(readyResources(b.engine, P1), 4);
  assert.equal(isDepleted(b, "theirs"), false);
  assert.equal(isDepleted(b, "mine"), false);
});

clause(EXEC, "0:rule", "'an opponent's turn' is relative to the controller: an Executive Order owned by P1 but controlled by P2 is offered to P2 at the start of P1's turn, and paid from P2's resources", () => {
  const b = execBoard({ turnOf: P2, controller: P2, pay: G(2).concat(R(2)).concat(G(2, P2), R(3, P2)) });
  endTurn(b.engine, P2);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P2, "the controller is asked");
  const p1Ready = readyResources(b.engine, P1);
  const p2Ready = readyResources(b.engine, P2);
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mine")] });
  assert.equal(readyResources(b.engine, P2), p2Ready - 2, "P2 paid");
  assert.equal(readyResources(b.engine, P1), p1Ready, "P1 paid nothing");
  assert.equal(isDepleted(b, "mine"), true);
});

clause(EXEC, "0:rule", "does not work from the hand, only in play; and costs 2: with only 1 ready resource the payment can't be made", () => {
  const inHand = execBoard({ zone: "hand" });
  endTurn(inHand.engine, P1);
  assert.equal(inHand.engine.state.pendingChoice, undefined, "no offer while in hand");
  const poor = execBoard({ pay: spentG(2).concat(R(1)) });
  endTurn(poor.engine, P1);
  const pc = pending(poor.engine);
  if (pc) {
    refused(() => answerPending(poor.engine, "mayPay", { pay: true }), "only 1 ready resource for 'pay 2'");
    answerPending(poor.engine, "mayPay", { pay: false });
  }
  assert.equal(isDepleted(poor, "theirs"), false);
  assert.equal(readyResources(poor.engine, P1), 1);
  const exact = execBoard({ pay: spentG(2).concat(R(2)) });
  endTurn(exact.engine, P1);
  execPay(exact);
  execPick(exact, [exact.id("theirs")]);
  assert.equal(readyResources(exact.engine, P1), 0, "control: exactly 2 ready pays it");
  assert.equal(isDepleted(exact, "theirs"), true);
});

clause(EXEC, "0:rule", "with no character in play nothing can be paid for: no resources are lost", () => {
  const b = execBoard({ noChars: true });
  endTurn(b.engine, P1);
  const pc = pending(b.engine);
  if (pc?.kind === "mayPay") answerPending(b.engine, "mayPay", { pay: true });
  if (pending(b.engine)) resolvePendingResponses(b.engine);
  assert.equal(readyResources(b.engine, P1), 4, "no character to pick means the 2 is never paid");
});

clause(EXEC, "0:rule", "'you may pay 2 and pick a character': the controller (not the opponent) picks the character", () => {
  const b = execBoard();
  endTurn(b.engine, P1);
  execPay(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Executive Order's controller picks, not the active opponent");
  execPick(b, [b.id("theirs")]);
  const c = execBoard({ turnOf: P2, controller: P2, pay: G(2).concat(R(2)).concat(G(2, P2), R(3, P2)) });
  endTurn(c.engine, P2);
  execPay(c, P2);
  const pc2 = pending(c.engine)!;
  assert.equal(pc2.kind, "chooserSelectsTarget");
  assert.equal(pc2.playerId, P2, "when P2 controls it, P2 picks");
  execPick(c, [c.id("mine")]);
  assert.equal(isDepleted(c, "mine"), true);
});

clause(EXEC, "0:rule", "'this turn, it cannot be restored by its controller's faction's RESTORE RULE': the picked character carries exactly that restriction this turn, an unpicked one does not, and it is gone once the turn ends", () => {
  const b = execBoard({ theirsDepleted: true });
  endTurn(b.engine, P1);
  execPay(b);
  execPick(b, [b.id("theirs")]);
  assert.ok(b.engine.getRestrictions(b.id("theirs")).includes("cannotBeRestoredByRule"), "the picked character cannot be restored by the Restore Rule this turn");
  assert.deepEqual(b.engine.getRestrictions(b.id("theirs")), ["cannotBeRestoredByRule"], "nothing else is restricted (it can still attack, block, be picked)");
  assert.deepEqual(b.engine.getRestrictions(b.id("mine")), [], "an unpicked character has no such restriction");
  endTurn(b.engine, P2);
  assert.deepEqual(b.engine.getRestrictions(b.id("theirs")), [], "'this turn' only: the restriction ended with the turn");
});

// ===========================================================================================
// Extravagant Contusion - tactic - banker - cost 0 - threshold gg
// ===========================================================================================
const CONTUSION = "cfec41dd-d43c-468f-b0ea-1aae986755a8";

const conBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "xc", def: printing(CONTUSION), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0, life: 3 }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "C1", cost: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "C2", cost: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "C3", cost: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "c7", def: character({ name: "C7", cost: 7, life: 3 }), owner: P2, zone: "play" },
      { key: "m2", def: character({ name: "M2", cost: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It", cost: 0 }), owner: P2, zone: "play" },
      { key: "lo", def: location({ name: "Lo", cost: 0 }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HandChar", cost: 0 }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar", cost: 0 }), owner: P2, zone: "discard" },
      ...(o.pay ?? G(2).concat(R(5))),
      ...(o.extra ?? [])
    ]
  });
const cast = (b: ReturnType<typeof conBoard>, x: number, pick: string[]) =>
  play(b.engine, P1, b.id("xc"), { selected: { c: pick.map((k) => b.id(k)) }, variables: { x } });

clause(CONTUSION, "0:extraCost", "printed cost 0, threshold [G][G], tactic: castable for no resources with [G][G] in (even spent) icons at X=0; refused with a [G] short, no [G], or only the opponent's [G]", () => {
  const def = printing(CONTUSION);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 0);
  assert.equal(def.threshold, "gg");
  assert.equal(def.subtype.length, 0);
  const ok = conBoard({ pay: spentG(2) });
  assert.equal(readyResources(ok.engine, P1), 0);
  cast(ok, 0, ["c0"]);
  assert.equal(zoneOf(ok.engine, ok.id("c0")), "discard", "control: spent [G][G] and no ready resource suffices at cost 0, X=0");
  assert.equal(zoneOf(ok.engine, ok.id("xc")), "discard");
  const oneG = conBoard({ pay: spentG(1).concat(R(3)) });
  refused(() => cast(oneG, 0, ["c0"]), "one [G] short", /Threshold requirements are not met/);
  assert.equal(zoneOf(oneG.engine, oneG.id("c0")), "play");
  const noG = conBoard({ pay: R(5) });
  refused(() => cast(noG, 0, ["c0"]), "no [G]");
  const theirs = conBoard({ pay: spentG(1).concat(G(2, P2), R(3)) });
  refused(() => cast(theirs, 0, ["c0"]), "the opponent's [G] does not count");
});

clause(CONTUSION, "0:extraCost", "Choose a number for X, Pay X: X resources are spent (X=2 pays 2, X=3 pays 3, X=0 pays nothing)", () => {
  const two = conBoard();
  assert.equal(readyResources(two.engine, P1), 7);
  cast(two, 2, ["c2"]);
  assert.equal(two.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(two.engine, P1), 5, "X=2 paid 2");
  const three = conBoard();
  cast(three, 3, ["c3"]);
  assert.equal(readyResources(three.engine, P1), 4, "X=3 paid 3");
  const zero = conBoard();
  cast(zero, 0, ["c0"]);
  assert.equal(readyResources(zero.engine, P1), 7, "X=0 paid nothing");
  const all = conBoard();
  cast(all, 7, ["c7"]);
  assert.equal(readyResources(all.engine, P1), 0, "X=7 paid all 7");
  assert.equal(zoneOf(all.engine, all.id("c7")), "discard");
});

clause(CONTUSION, "0:extraCost", "X can't exceed what you can pay: X=8 with 7 ready resources is refused with nothing paid, and no target is lost", () => {
  const b = conBoard();
  refused(() => cast(b, 8, ["c7"]), "cannot pay 8 with 7 ready");
  assert.equal(readyResources(b.engine, P1), 7);
  assert.equal(zoneOf(b.engine, b.id("c7")), "play");
  assert.equal(zoneOf(b.engine, b.id("xc")), "hand");
  cast(b, 7, ["c7"]);
  assert.equal(zoneOf(b.engine, b.id("c7")), "discard", "control: X=7 is fine");
});

clause(CONTUSION, "0:extraCost", "X is a number you choose: a negative or fractional X is refused", () => {
  const b = conBoard();
  refused(() => cast(b, -1, ["c0"]), "negative X");
  refused(() => cast(b, 1.5, ["c1"]), "fractional X");
  assert.equal(readyResources(b.engine, P1), 7, "nothing paid");
  assert.equal(zoneOf(b.engine, b.id("c0")), "play");
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
  cast(b, 1, ["c1"]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard", "control: X=1");
});

clause(CONTUSION, "0:extraCost", "Pick a character with numeric cost X or less: cost == X, cost < X and cost 0 are pickable; cost X+1 is refused (X=2 vs a cost-3 character)", () => {
  const exact = conBoard();
  cast(exact, 2, ["c2"]);
  assert.equal(zoneOf(exact.engine, exact.id("c2")), "discard", "cost == X");
  const less = conBoard();
  cast(less, 2, ["c1"]);
  assert.equal(zoneOf(less.engine, less.id("c1")), "discard", "cost < X");
  const zero = conBoard();
  cast(zero, 2, ["c0"]);
  assert.equal(zoneOf(zero.engine, zero.id("c0")), "discard", "cost 0 <= 2");
  const over = conBoard();
  refused(() => cast(over, 2, ["c3"]), "cost 3 > X=2");
  refused(() => cast(over, 2, ["c7"]), "cost 7 > X=2");
  assert.equal(zoneOf(over.engine, over.id("c3")), "play");
  assert.equal(readyResources(over.engine, P1), 7, "nothing paid by the refusals");
  const x0 = conBoard();
  refused(() => cast(x0, 0, ["c1"]), "cost 1 > X=0");
  refused(() => cast(x0, 0, ["c2"]), "cost 2 > X=0");
  cast(x0, 0, ["c0"]);
  assert.equal(zoneOf(x0.engine, x0.id("c0")), "discard");
});

clause(CONTUSION, "0:extraCost", "a character with NO cost number has numeric cost 0 (CR 406.2): pickable at X=0 and any larger X; a cost-1 character is still refused at X=0", () => {
  const extra = (): CardPlacement[] => [{ key: "nc", def: character({ name: "NoCost", cost: undefined, life: 3 }), owner: P2, zone: "play" }];
  const probe = conBoard({ extra: extra() });
  assert.equal(probe.engine.getDefinition(probe.id("nc")).cost, undefined, "the fixture really has no cost number");
  for (const x of [0, 2]) {
    const b = conBoard({ extra: extra() });
    cast(b, x, ["nc"]);
    assert.equal(zoneOf(b.engine, b.id("nc")), "discard", `numeric cost 0 <= X=${x}`);
  }
  const ctl = conBoard({ extra: extra() });
  refused(() => cast(ctl, 0, ["c1"]), "control: cost 1 > X=0");
  assert.equal(zoneOf(ctl.engine, ctl.id("nc")), "play");
});

clause(CONTUSION, "0:extraCost", "the pick must be a character in play (mine or theirs): no pick, a faction, an item, a location, or a character in hand/discard is refused; two characters are refused; my own character is allowed", () => {
  const b = conBoard();
  const fac = b.engine.state.players[P2].factionId!;
  for (const sel of [[], [fac], ["it"], ["lo"], ["hc"], ["dc"], ["c0", "c1"]] as (string[])[]) {
    refused(() => play(b.engine, P1, b.id("xc"), { selected: { c: sel.map((k) => (k === fac ? k : k.length ? b.id(k) : k)) }, variables: { x: 3 } }), JSON.stringify(sel));
  }
  refused(() => play(b.engine, P1, b.id("xc"), { selected: {}, variables: { x: 3 } }), "no pick at all");
  assert.equal(zoneOf(b.engine, b.id("xc")), "hand");
  assert.equal(readyResources(b.engine, P1), 7);
  cast(b, 2, ["m2"]);
  assert.equal(zoneOf(b.engine, b.id("m2")), "discard", "my own character is a legal pick");
});

clause(CONTUSION, "1:rule", "Destroy the character: only the picked character goes to its owner's discard pile; other characters, items and locations stay; the tactic goes to the discard", () => {
  const b = conBoard();
  cast(b, 3, ["c3"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard");
  assert.ok((b.engine.state.players[P2].discard as unknown as string[]).includes(b.id("c3")), "the owner's discard pile");
  for (const k of ["c0", "c1", "c2", "c7", "m2", "it", "lo"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
  assert.equal(zoneOf(b.engine, b.id("xc")), "discard");
  const mine = conBoard();
  cast(mine, 2, ["m2"]);
  assert.ok((mine.engine.state.players[P1].discard as unknown as string[]).includes(mine.id("m2")), "my own destroyed character goes to my discard");
  assert.equal(zoneOf(mine.engine, mine.id("c2")), "play");
});

clause(CONTUSION, "1:rule", "the character is destroyed whatever its damage or life (a healthy one with damage 0)", () => {
  const b = conBoard({ extra: [{ key: "big", def: character({ name: "Big", cost: 1, strength: 9, speed: 9, life: 9 }), owner: P2, zone: "play" }] });
  cast(b, 1, ["big"]);
  assert.equal(zoneOf(b.engine, b.id("big")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CONTUSION, "0:extraCost", "the extra cost X is already paid while the tactic waits on the stack (before it resolves), and the target is still in play then", () => {
  const b = conBoard();
  playRaw(b.engine, P1, b.id("xc"), { selected: { c: [b.id("c2")] }, variables: { x: 2 } });
  assert.equal(readyResources(b.engine, P1), 5, "X already paid");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "not destroyed yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
});

// ===========================================================================================
// Flabbergasting Philosopher - character - banker - mau - cost 6 - threshold gg - 3/3/3
// ===========================================================================================
const PHIL = "cb7154fc-105e-427c-b905-99b9ce7c2fbc";

type PhilOpts = { zone?: "hand" | "play"; faceDown?: boolean; pay?: CardPlacement[]; turnOf?: PlayerId; extra?: CardPlacement[] };
const philBoard = (o: PhilOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "ph", def: printing(PHIL), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      { key: "nothing", def: tactic({ name: "Nothing", cost: 0 }), owner: P2, zone: "hand" },
      { ...body("att", P2, { strength: 1, life: 3 }) },
      ...(o.pay ?? spentG(2).concat(R(6))),
      ...(o.extra ?? [])
    ]
  });
const philFlip = (o: PhilOpts = {}) => philBoard({ zone: "play", faceDown: true, pay: spentG(2).concat(R(3)), ...o });
const flipUpRaw = (b: ReturnType<typeof philBoard>, player: PlayerId = P1) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("ph"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
};

clause(PHIL, "0:kw:TACTICAL", "printed cost 6, threshold [G][G], character, mau, 3 strength / 3 speed / 3 life; payable with [G][G] + 6 ready; refused with cost short, a [G] short, no [G], or only the opponent's [G]", () => {
  const def = printing(PHIL);
  assert.equal(def.type, "character");
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "gg");
  assert.deepEqual([...def.subtype], ["mau"]);
  const ok = philBoard();
  play(ok.engine, P1, ok.id("ph"));
  assert.equal(zoneOf(ok.engine, ok.id("ph")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 6 paid");
  assert.equal(ok.engine.getStat(ok.id("ph"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("ph"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ph"), "life"), 3);
  const costShort = philBoard({ pay: spentG(2).concat(R(5)) });
  refused(() => play(costShort.engine, P1, costShort.id("ph")), "5 ready for cost 6");
  const oneG = philBoard({ pay: G(1).concat(R(5)) });
  refused(() => play(oneG.engine, P1, oneG.id("ph")), "6 ready but one [G]");
  const noG = philBoard({ pay: R(8) });
  refused(() => play(noG.engine, P1, noG.id("ph")), "no [G]");
  const theirs = philBoard({ pay: G(1).concat(G(2, P2), R(5)) });
  refused(() => play(theirs.engine, P1, theirs.id("ph")), "the opponent's [G] does not count");
});

clause(PHIL, "0:kw:TACTICAL", "has TACTICAL (and no COVERT / AGGRO it does not print)", () => {
  const b = philBoard();
  assert.ok(hasKw(b.engine, b.id("ph"), "tactical"), "hasKw(b.engine, b.id(\"ph\"), \"tactical\")");
  assert.ok(!hasKw(b.engine, b.id("ph"), "covert"), "!hasKw(b.engine, b.id(\"ph\"), \"covert\")");
  assert.ok(!hasKw(b.engine, b.id("ph"), "aggro"), "!hasKw(b.engine, b.id(\"ph\"), \"aggro\")");
  const other = philBoard();
  assert.ok(!hasKw(other.engine, other.id("other"), "tactical"), "an ordinary character is not tactical");
});

clause(PHIL, "0:kw:TACTICAL", "TACTICAL: on the opponent's turn, in a response window (after they play a tactic), I can deploy it from hand; with nothing to respond to it cannot be deployed; an ordinary character cannot", () => {
  const b = philBoard({ turnOf: P2 });
  refused(() => playRaw(b.engine, P1, b.id("ph")), "no window is open for me");
  assert.equal(zoneOf(b.engine, b.id("ph")), "hand");
  playRaw(b.engine, P2, b.id("nothing"));
  refused(() => playRaw(b.engine, P1, b.id("other")), "an ordinary character cannot be deployed in a window");
  assert.equal(zoneOf(b.engine, b.id("other")), "hand");
  playRaw(b.engine, P1, b.id("ph"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ph")), "play", "tactical: enters play (not the discard pile)");
  assert.equal(b.engine.state.cards[b.id("ph")].controllerId, P1);
  assert.equal(influence(b.engine, P1), 24, "its enter-play trigger ran");
});

clause(PHIL, "0:kw:TACTICAL", "TACTICAL is active while it is a face-down resource: FLIP UP is legal in the opponent's response window", () => {
  const b = philFlip({ turnOf: P2 });
  perform(b.engine, { type: "declareAttack", playerId: P2, attackerIds: [b.id("att")], target: { type: "faction", playerId: P1 } });
  const w = b.engine.state.responseWindow as unknown as { priorityPlayerId?: PlayerId } | undefined;
  assert.ok(w, "a response window is open");
  if (w?.priorityPlayerId === P2) perform(b.engine, { type: "passPriority", playerId: P2 });
  assert.equal((b.engine.state.responseWindow as unknown as { priorityPlayerId?: PlayerId }).priorityPlayerId, P1);
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("ph"), selected: {}, variables: {} });
  assert.equal(b.engine.state.cards[b.id("ph")].faceDown, false, "flipped up in P2's window");
  assert.equal(zoneOf(b.engine, b.id("ph")), "play");
});

clause(PHIL, "1:rule", "when this card enters play (deployed) its controller's faction gains 4 influence; the opponent's influence is unchanged", () => {
  const b = philBoard();
  play(b.engine, P1, b.id("ph"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(influence(b.engine, P1), 24, "20 + 4");
  assert.equal(influence(b.engine, P2), 20);
});

clause(PHIL, "1:rule", "only when THIS card enters play: another character entering play does not give the influence, and the card sitting in play gives it only once", () => {
  const b = philBoard({ zone: "play", pay: spentG(2).concat(R(4)) });
  assert.equal(influence(b.engine, P1), 20, "it was placed, nothing triggered");
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(influence(b.engine, P1), 20, "another character entering gives nothing");
  const opp = philBoard({ zone: "play", pay: spentG(2).concat(R(4)), extra: [{ key: "oppc", def: character({ name: "OppC" }), owner: P2, zone: "hand" }] });
  assert.equal(influence(opp.engine, P1), 20);
});

clause(PHIL, "1:rule", "when it enters play deployed by FLIP UP the faction also gains 4 influence (flipping up deploys it)", () => {
  const b = philFlip();
  flipUpRaw(b);
  assert.equal(b.engine.state.cards[b.id("ph")].faceDown, false);
  assert.equal(influence(b.engine, P1), 24);
  assert.equal(influence(b.engine, P2), 20);
});

clause(PHIL, "2:flipUp", "FLIP UP: 4 [G][G]: pay 4 (the face-down card may pay for itself) with [G][G] met; it becomes a face-up 3/3/3 mau character controlled by me", () => {
  const b = philFlip({ pay: spentG(2).concat(R(3)) });
  assert.equal(readyResources(b.engine, P1), 4, "3 Rage + the face-down card itself");
  flipUpRaw(b);
  assert.equal(b.engine.state.cards[b.id("ph")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("ph")), "play");
  assert.equal(readyResources(b.engine, P1), 0, "cost 4 paid");
  assert.equal(b.engine.getStat(b.id("ph"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ph"), "life"), 3);
  const spare = philFlip({ pay: spentG(2).concat(R(6)) });
  flipUpRaw(spare);
  const left = readyResources(spare.engine, P1);
  assert.ok(left === 3 || left === 2, `7 ready - 4 paid (the flipped card no longer a resource) leaves ${left}`);
});

clause(PHIL, "2:flipUp", "FLIP UP refused when the 4 cost can't be paid (only 3 ready incl. itself) even though the threshold is met by spent [G][G]; and its own icon does not count toward the threshold", () => {
  const costShort = philFlip({ pay: spentG(2).concat(R(2)) });
  assert.equal(readyResources(costShort.engine, P1), 3);
  refused(() => flipUpRaw(costShort), "cost 4 with 3 ready");
  assert.equal(costShort.engine.state.cards[costShort.id("ph")].faceDown, true);
  const oneG = philFlip({ pay: spentG(1).concat(R(5)) });
  refused(() => flipUpRaw(oneG), "one [G] only; plenty of ready resources");
  const noG = philFlip({ pay: R(7) });
  refused(() => flipUpRaw(noG), "no [G]");
  const theirs = philFlip({ pay: spentG(1).concat(G(2, P2), R(5)) });
  refused(() => flipUpRaw(theirs), "the opponent's [G] does not count");
  assert.equal(theirs.engine.state.cards[theirs.id("ph")].faceDown, true);
  const ok = philFlip({ pay: G(2).concat(R(2)) });
  flipUpRaw(ok);
  assert.equal(ok.engine.state.cards[ok.id("ph")].faceDown, false, "control: two ready [G] + 2 Rage + itself pays 4");
});

clause(PHIL, "2:flipUp", "FLIP UP is legal on my turn with no window (a character may be flipped only on my own turn when not responding): refused on the opponent's turn outside any response window", () => {
  const b = philFlip({ turnOf: P2 });
  refused(() => flipUpRaw(b), "opponent's turn, no window");
  assert.equal(b.engine.state.cards[b.id("ph")].faceDown, true);
  const mine = philFlip();
  flipUpRaw(mine);
  assert.equal(mine.engine.state.cards[mine.id("ph")].faceDown, false, "control");
});

// ===========================================================================================
// Foolhardy Desperado - character - banker - pirate, mau - cost 3 - threshold gg - 3/2/4
// ===========================================================================================
const DESP = "5c248d12-320b-46ed-b93c-f926e5de372f";

type DespOpts = { zone?: "hand" | "play"; pay?: CardPlacement[]; turnOf?: PlayerId; extra?: CardPlacement[]; owner?: PlayerId };
const despBoard = (o: DespOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "ds", def: printing(DESP), owner: o.owner ?? P1, zone: o.zone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, speed: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, speed: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "cfoe", def: character({ name: "CFoe", strength: 1, speed: 1, life: 6, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "catt", def: character({ name: "CAtt", strength: 1, speed: 1, life: 6, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...(o.pay ?? []),
      ...(o.extra ?? [])
    ]
  });

clause(DESP, "0:kw:COVERT", "printed cost 3, threshold [G][G], character, pirate + mau, 3 strength / 2 speed / 4 life; payable with [G][G] + 3 ready; refused with cost short, a [G] short, no [G], or only the opponent's [G]", () => {
  const def = printing(DESP);
  assert.equal(def.type, "character");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "gg");
  assert.deepEqual([...def.subtype].sort(), ["mau", "pirate"]);
  const ok = despBoard({ zone: "hand", pay: spentG(2).concat(R(3)) });
  play(ok.engine, P1, ok.id("ds"));
  assert.equal(zoneOf(ok.engine, ok.id("ds")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 3 paid");
  assert.equal(ok.engine.getStat(ok.id("ds"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("ds"), "speed"), 2);
  assert.equal(ok.engine.getStat(ok.id("ds"), "life"), 4);
  const costShort = despBoard({ zone: "hand", pay: spentG(2).concat(R(2)) });
  refused(() => play(costShort.engine, P1, costShort.id("ds")), "2 ready for cost 3");
  const oneG = despBoard({ zone: "hand", pay: G(1).concat(R(3)) });
  refused(() => play(oneG.engine, P1, oneG.id("ds")), "one [G]");
  const noG = despBoard({ zone: "hand", pay: R(6) });
  refused(() => play(noG.engine, P1, noG.id("ds")), "no [G]");
  const theirs = despBoard({ zone: "hand", pay: G(1).concat(G(2, P2), R(3)) });
  refused(() => play(theirs.engine, P1, theirs.id("ds")), "the opponent's [G] does not count");
});

clause(DESP, "0:kw:COVERT", "has the COVERT keyword (and no TACTICAL / AGGRO it does not print)", () => {
  covertHasKeyword(DESP);
  const b = despBoard();
  assert.ok(!hasKw(b.engine, b.id("ds"), "tactical"), "!hasKw(b.engine, b.id(\"ds\"), \"tactical\")");
  assert.ok(!hasKw(b.engine, b.id("ds"), "aggro"), "!hasKw(b.engine, b.id(\"ds\"), \"aggro\")");
});
clause(DESP, "0:kw:COVERT", "COVERT: cannot be blocked by a non-covert character", () => covertCannotBeBlockedByNonCovert(DESP));
clause(DESP, "0:kw:COVERT", "COVERT: a party needs every member to be covert to be a covert party", () => covertPartyNeedsEveryMemberCovert(DESP));
clause(DESP, "0:kw:COVERT", "COVERT: covert characters block only covert parties", () => covertBlocksOnlyCovertParties(DESP));

const faction = (p: PlayerId) => ({ type: "faction" as const, playerId: p });

clause(DESP, "1:rule", "when it inflicts battle damage on the opposing faction (unblocked) its controller's faction loses 2 influence, on top of the damage the faction takes", () => {
  const b = despBoard();
  fightThrough(b.engine, P1, [b.id("ds")], faction(P2), []);
  assert.equal(influence(b.engine, P2), 17, "the defender took 3");
  assert.equal(influence(b.engine, P1), 18, "my faction lost 2");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(DESP, "1:rule", "when it inflicts battle damage on a blocking (covert) character the controller loses 2 influence, once; the opponent's influence is unchanged", () => {
  const b = despBoard();
  fightThrough(b.engine, P1, [b.id("ds")], faction(P2), [b.id("cfoe")]);
  assert.equal(influence(b.engine, P1), 18, "lost 2 influence for damaging the blocker");
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(b.engine.getStat(b.id("cfoe"), "life"), 6);
  assert.equal((b.engine.state.cards[b.id("cfoe")] as unknown as { damage?: number }).damage, 3, "3 damage inflicted");
});

clause(DESP, "1:rule", "when it inflicts battle damage while BLOCKING (as the defender) its controller's faction loses 2 influence", () => {
  const b = despBoard({ turnOf: P2 });
  fightThrough(b.engine, P2, [b.id("catt")], faction(P1), [b.id("ds")]);
  assert.equal(influence(b.engine, P1), 18, "Desperado blocked and inflicted damage");
  assert.equal(influence(b.engine, P2), 20, "the attacker's controller loses nothing");
});

clause(DESP, "1:rule", "it triggers once per battle even in a party: attacking with another character, the other's damage alone does not trigger, but Desperado's does, once (2 influence, not 4)", () => {
  const b = despBoard();
  fightThrough(b.engine, P1, [b.id("ds"), b.id("ally")], faction(P2), []);
  assert.equal(influence(b.engine, P2), 15, "3 + 2 damage to the faction");
  assert.equal(influence(b.engine, P1), 18, "exactly one 2-influence loss");
});

clause(DESP, "1:rule", "'this card': another character of mine inflicting battle damage does not cost me influence, and neither does damage dealt TO Desperado", () => {
  const b = despBoard({ turnOf: P1 });
  fightThrough(b.engine, P1, [b.id("ally")], faction(P2), []);
  assert.equal(influence(b.engine, P1), 20, "ally dealt the damage, not Desperado");
  assert.equal(influence(b.engine, P2), 18);
  // Desperado is at home; the opponent's covert attacker hits my faction unblocked
  const c = despBoard({ turnOf: P2 });
  fightThrough(c.engine, P2, [c.id("catt")], faction(P1), []);
  assert.equal(influence(c.engine, P1), 19, "took 1 from the attacker; no Desperado loss");
  assert.equal(influence(c.engine, P2), 20);
  // Desperado is damaged as a blocker by a character: only its own inflicted damage costs me influence once
  const d = despBoard({ turnOf: P2 });
  fightThrough(d.engine, P2, [d.id("catt")], faction(P1), [d.id("ds")]);
  assert.equal((d.engine.state.cards[d.id("ds")] as unknown as { damage?: number }).damage, 1, "it received 1");
  assert.equal(influence(d.engine, P1), 18, "just the one loss for what it inflicted");
});

clause(DESP, "1:rule", "'your faction' is its controller's: a Desperado owned by P2 (P2's turn) costs P2 the influence and P1 nothing", () => {
  const b = despBoard({ owner: P2, turnOf: P2 });
  fightThrough(b.engine, P2, [b.id("ds")], faction(P1), []);
  assert.equal(influence(b.engine, P2), 18, "its controller lost 2");
  assert.equal(influence(b.engine, P1), 17, "the defender took 3 from the attack only");
});

const weakenItem = (n: number): CardDefinition =>
  item({ name: `Weaken${n}`, cost: 0, behavior: { abilities: [{ id: "weaken", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -n }] }] } } as never);

clause(DESP, "1:rule", "striking with 0 strength inflicts 0 damage (CR 408.1: nothing is inflicted), so no influence is lost; the same attack with 1 strength inflicts 1 and costs 2", () => {
  for (const blockers of [[], ["cfoe"]]) {
    const z = despBoard({ extra: [{ key: "w", def: weakenItem(3), owner: P1, zone: "play", attachedToKey: "ds" }] });
    assert.equal(z.engine.getStat(z.id("ds"), "strength"), 0, "0 strength");
    fightThrough(z.engine, P1, [z.id("ds")], faction(P2), blockers.map((k) => z.id(k)));
    assert.equal(influence(z.engine, P1), 20, `no influence lost at 0 strength (blockers: ${blockers.length})`);
    assert.equal(influence(z.engine, P2), 20, "no damage to the faction");
    assert.equal((z.engine.state.cards[z.id("cfoe")] as unknown as { damage?: number }).damage ?? 0, 0, "no damage to the blocker");
  }
  const one = despBoard({ extra: [{ key: "w", def: weakenItem(2), owner: P1, zone: "play", attachedToKey: "ds" }] });
  assert.equal(one.engine.getStat(one.id("ds"), "strength"), 1);
  fightThrough(one.engine, P1, [one.id("ds")], faction(P2), []);
  assert.equal(influence(one.engine, P2), 19, "1 damage inflicted");
  assert.equal(influence(one.engine, P1), 18, "so the loss triggers");
});

clause(DESP, "1:rule", "no battle damage, no loss: attacking in a battle where it does not strike yet (declaration) costs nothing", () => {
  const b = despBoard();
  declareAttackBy(b.engine, P1, [b.id("ds")], faction(P2));
  assert.equal(influence(b.engine, P1), 20, "declaring the attack inflicts no damage");
  assert.equal(influence(b.engine, P2), 20);
});

clause(EXEC, "0:rule", "a character I control can be picked too (it is not limited to the opponent's): the picked own ready character is depleted, the opponent's is not", () => {
  const b = execBoard();
  endTurn(b.engine, P1);
  execPay(b);
  execPick(b, [b.id("mine")]);
  assert.equal(isDepleted(b, "mine"), true);
  assert.equal(isDepleted(b, "theirs"), false);
  assert.equal(readyResources(b.engine, P1), 2);
});
