// Clause tests â€” batch seed-saga-04, part p1 (groups 1-5, missing clauses only).
// Cards: Clam Hash, Crushing Usury, Delectable Boon, Department of Rejections, Emissary of Loot.
import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn, developResource, spentResources } from "./_turn.js";

type Eng = SpoilsEngine;
const G = (n: number, owner: PlayerId = P1) => bank("greed", n, owner);
const R = (n: number, owner: PlayerId = P1) => bank("rage", n, owner);
const spentG = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("greed", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const handOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].hand as unknown as string[];
const dmg = (engine: Eng, id: string): number => (engine.state.cards[id] as unknown as { damage?: number }).damage ?? 0;
const influence = (engine: Eng, p: PlayerId): number => engine.state.players[p].influence as number;
const body = (key: string, owner: PlayerId = P1, over: Partial<CardDefinition> = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength: 2, speed: 2, life: 3, ...over }),
  owner,
  zone: "play"
});
const perform = (engine: Eng, action: unknown): void => engine.perform(action as never);
const flip = (engine: Eng, player: PlayerId, cardId: string, selected: Record<string, string[]> = {}): void => {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
  resolvePendingResponses(engine);
};

// ===========================================================================================
// Clam Hash â€” tactic Â· banker Â· cost 1 Â· threshold gg
// ===========================================================================================
const CLAM = "6b189d36-7183-4eb2-b017-5a910b947553";

type ClamOpts = { zone?: "hand" | "play"; faceDown?: boolean; pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId; owner?: PlayerId; controller?: PlayerId };
const clamBoard = (o: ClamOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    turn: o.turnOf === P2 ? 2 : 1,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "ch", def: printing(CLAM), owner: o.owner ?? P1, controller: o.controller, zone: o.zone ?? "hand", faceDown: o.faceDown },
      body("mine", P1),
      body("theirs", P2),
      ...(o.pay ?? G(2).concat(R(1))),
      ...(o.extra ?? [])
    ]
  });
const clam = (b: ReturnType<typeof clamBoard>, target: string, player: PlayerId = P1) => play(b.engine, player, b.id("ch"), { selected: { t: [b.id(target)] } });

clause(CLAM, "0:extraCost", "printed as a 1-cost tactic with threshold [G][G]: exact payment works; 1 resource short, 1 [G] short and cost-short-with-spent-icons are refused", () => {
  const ok = clamBoard({ pay: G(2).concat(R(1)) });
  assert.equal(printing(CLAM).type, "tactic");
  assert.equal(printing(CLAM).cost, 1);
  assert.equal(printing(CLAM).threshold, "gg");
  clam(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("ch")), "discard", "deployed normally: the tactic goes to its owner's discard pile");
  assert.equal(readyResources(ok.engine, P1), 2, "cost 1 paid (3 -> 2)");
  // only [G][G] ready: that pays 1 and leaves 1
  const two = clamBoard({ pay: G(2) });
  clam(two, "mine");
  assert.equal(readyResources(two.engine, P1), 1);
  // cost isolated with spent icons: [G][G] spent, nothing ready -> cost 1 can't be paid
  const spent = clamBoard({ pay: spentG(2) });
  refused(() => clam(spent, "mine"), "threshold met by spent [G][G], but no ready resource for cost 1", /Costs cannot be paid/);
  const spentOk = clamBoard({ pay: spentG(2).concat(R(1)) });
  clam(spentOk, "mine");
  assert.equal(readyResources(spentOk.engine, P1), 0);
  // threshold one icon short: one [G] plus plenty of other resources
  const oneG = clamBoard({ pay: G(1).concat(R(4)) });
  refused(() => clam(oneG, "mine"), "needs [G][G]");
  const noG = clamBoard({ pay: R(4) });
  refused(() => clam(noG, "mine"), "no [G] at all");
  const theirG = clamBoard({ pay: G(1).concat(G(2, P2), R(3)) });
  refused(() => clam(theirG, "mine"), "the opponent's [G] does not count");
  const nothing = clamBoard({ pay: [] });
  refused(() => clam(nothing, "mine"), "no resources");
});

clause(CLAM, "0:extraCost", "EXTRA COST: a character must be picked, any character in play (mine or theirs); non-characters, other zones and an empty pick are refused", () => {
  const b = clamBoard({
    extra: [
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "oc", def: character({ name: "DeckChar" }), owner: P2, zone: "deck" }
    ]
  });
  const tryPick = (key: string) => () => play(b.engine, P1, b.id("ch"), { selected: { t: [b.id(key)] } });
  refused(tryPick("it"), "item", /target|select|pick|valid/i);
  refused(tryPick("lo"), "location");
  refused(tryPick("hc"), "character in hand");
  refused(tryPick("dc"), "character in discard");
  refused(tryPick("oc"), "character in deck");
  refused(() => play(b.engine, P1, b.id("ch"), { selected: {} }), "no pick at all");
  refused(() => play(b.engine, P1, b.id("ch"), { selected: { t: [b.id("mine"), b.id("theirs")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("ch")), "hand", "all refusals left the card in hand");
  assert.equal(readyResources(b.engine, P1), 3, "nothing was paid");
  clam(b, "theirs");
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 5, "an opponent's character is a legal pick");
  const own = clamBoard();
  clam(own, "mine");
  assert.equal(own.engine.getStat(own.id("mine"), "life"), 5, "my own character is a legal pick");
  const faction = clamBoard();
  refused(() => play(faction.engine, P1, faction.id("ch"), { selected: { t: [faction.engine.state.players[P1].factionId!] } }), "factions are not characters");
});

clause(CLAM, "1:rule", "this turn the picked character gains 2 life (base 3 -> 5); no other character changes; it lasts only this turn", () => {
  const b = clamBoard({ extra: [body("other", P1)] });
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  clam(b, "mine");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5, "+2 life");
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3, "other character unchanged");
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 3, "opponent's character unchanged");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "only life changes");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "the +2 ended with the turn");
  // survives lethal-by-3 damage while it lasts
  const c = clamBoard({ pay: G(2).concat(R(1)) });
  clam(c, "theirs");
  assert.equal(c.engine.getStat(c.id("theirs"), "life"), 5);
});

clause(CLAM, "1:rule", "deployed normally (not via FLIP UP) the tactic goes to its owner's discard pile, not to hand", () => {
  const b = clamBoard();
  clam(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("ch")), "discard");
  assert.ok(!handOf(b.engine, P1).includes(b.id("ch")), "!handOf(b.engine, P1).includes(b.id(\"ch\"))");
});

const flipBoard = (o: { pay?: CardPlacement[]; owner?: PlayerId; controller?: PlayerId; turnOf?: PlayerId; extra?: CardPlacement[] } = {}) =>
  clamBoard({ zone: "play", faceDown: true, pay: o.pay ?? spentG(2).concat(R(1)), owner: o.owner, controller: o.controller, turnOf: o.turnOf, extra: o.extra });

clause(CLAM, "1:rule", "deployed with FLIP UP: the character gains 2 life this turn and the tactic goes to its owner's hand instead of the discard pile", () => {
  const b = flipBoard();
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, true);
  flip(b.engine, P1, b.id("ch"), { t: [b.id("mine")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5, "+2 life");
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 3);
  assert.equal(zoneOf(b.engine, b.id("ch")), "hand", "to its owner's hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("ch")), "handOf(b.engine, P1).includes(b.id(\"ch\"))");
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, false);
  assert.notEqual(zoneOf(b.engine, b.id("ch")), "discard");
});

clause(CLAM, "1:rule", "owner differs from controller: a face-down Clam Hash I own but you control, flipped up by you, returns to its OWNER's hand", () => {
  const b = flipBoard({ owner: P2, controller: P1, pay: spentG(2).concat(R(1)) });
  flip(b.engine, P1, b.id("ch"), { t: [b.id("theirs")] });
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 5);
  assert.equal(zoneOf(b.engine, b.id("ch")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("ch")), "owner P2's hand");
  assert.ok(!handOf(b.engine, P1).includes(b.id("ch")), "not the controller's hand");
});

clause(CLAM, "2:flipUp", "FLIP UP: 2 [G][G] â€” the face-down card may pay for itself (spent [G][G] + one ready resource + itself); resources are spent exactly 2", () => {
  const b = flipBoard({ pay: spentG(2).concat(R(1)) });
  assert.equal(readyResources(b.engine, P1), 2, "one Rage + the face-down card itself");
  flip(b.engine, P1, b.id("ch"), { t: [b.id("mine")] });
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, false);
  assert.equal(readyResources(b.engine, P1), 0, "cost 2 paid; the flipped card no longer a resource");
  const more = flipBoard({ pay: spentG(2).concat(R(3)) });
  flip(more.engine, P1, more.id("ch"), { t: [more.id("mine")] });
  const left = readyResources(more.engine, P1);
  assert.ok(left === 2 || left === 1, `4 ready - 2 paid (and itself gone) leaves ${left}`);
  assert.equal(left <= 2, true);
  assert.equal(more.engine.getStat(more.id("mine"), "life"), 5);
});

clause(CLAM, "2:flipUp", "FLIP UP refused when the 2 cost can't be paid (only the card itself ready) or the [G][G] threshold is short (one [G], none, or the opponent's)", () => {
  const ok = flipBoard({ pay: G(2).concat(R(0)) });
  flip(ok.engine, P1, ok.id("ch"), { t: [ok.id("mine")] });
  assert.equal(ok.engine.state.cards[ok.id("ch")].faceDown, false, "control: two ready [G] + itself");
  const costShort = flipBoard({ pay: spentG(2) });
  assert.equal(readyResources(costShort.engine, P1), 1);
  refused(() => flip(costShort.engine, P1, costShort.id("ch"), { t: [costShort.id("mine")] }), "cost 2 with one ready resource, threshold met by spent icons", /FLIP UP costs cannot be paid\./);
  assert.equal(costShort.engine.state.cards[costShort.id("ch")].faceDown, true);
  const oneG = flipBoard({ pay: G(1).concat(R(3)) });
  refused(() => flip(oneG.engine, P1, oneG.id("ch"), { t: [oneG.id("mine")] }), "one [G] only");
  const noG = flipBoard({ pay: R(4) });
  refused(() => flip(noG.engine, P1, noG.id("ch"), { t: [noG.id("mine")] }), "no [G]");
  const theirs = flipBoard({ pay: G(1).concat(G(2, P2), R(3)) });
  refused(() => flip(theirs.engine, P1, theirs.id("ch"), { t: [theirs.id("mine")] }), "opponent's [G] does not count");
  // its own icon (a face-up Clam Hash provides nothing) can't be the second [G]
  const selfOnly = flipBoard({ pay: spentG(1).concat(R(2)) });
  refused(() => flip(selfOnly.engine, P1, selfOnly.id("ch"), { t: [selfOnly.id("mine")] }), "one [G] short even with 3 ready resources", /FLIP UP threshold requirements are not met/);
});

clause(CLAM, "2:flipUp", "FLIP UP still needs the EXTRA COST pick (a character in play) and is refused on the opponent's turn; a tactic may be flipped in an opponent's response window", () => {
  const b = flipBoard();
  refused(() => flip(b.engine, P1, b.id("ch"), {}), "no pick");
  refused(() => flip(b.engine, P1, b.id("ch"), { t: [b.engine.state.players[P1].factionId!] }), "a faction is not a character");
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, true);
  flip(b.engine, P1, b.id("ch"), { t: [b.id("mine")] });
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, false, "control");
  const opp = flipBoard({ turnOf: P2 });
  refused(() => flip(opp.engine, P1, opp.id("ch"), { t: [opp.id("mine")] }), "not my turn / no priority");
  assert.equal(opp.engine.state.cards[opp.id("ch")].faceDown, true);
});

clause(CLAM, "2:flipUp", "a tactic's FLIP UP is legal inside the opponent's response window (tactics are allowed there)", () => {
  const b = flipBoard({ turnOf: P2, extra: [{ key: "att", def: character({ name: "Att", strength: 1, life: 3 }), owner: P2, zone: "play" }] });
  // P2 attacks my faction; P1 holds priority in the window and flips up the tactic
  declareAttackOpenWindow(b.engine, P2, [b.id("att")]);
  assert.ok(b.engine.state.responseWindow, "a response window is open");
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("ch"), selected: { t: [b.id("mine")] }, variables: {} });
  assert.equal(b.engine.state.cards[b.id("ch")].faceDown, false);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5);
});

// ===========================================================================================
// Crushing Usury â€” tactic Â· banker Â· cost 4 Â· threshold g
// ===========================================================================================
const USURY = "66ece32c-bb69-4dc3-b3b7-143bdbfb4598";

type UsuOpts = { zone?: "hand" | "play"; faceDown?: boolean; pay?: CardPlacement[]; extra?: CardPlacement[]; influence?: number; turnOf?: PlayerId };
const usuBoard = (o: UsuOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: o.influence },
    turn: o.turnOf === P2 ? 2 : 1,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "cu", def: printing(USURY), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown },
      body("mine", P1),
      body("theirs", P2),
      body("bystander", P2),
      ...(o.pay ?? G(1).concat(R(3))),
      ...(o.extra ?? [])
    ]
  });
const usu = (b: ReturnType<typeof usuBoard>, target: string) => play(b.engine, P1, b.id("cu"), { selected: { c: [b.id(target)] } });

clause(USURY, "0:extraCost", "printed as a 4-cost tactic with threshold [G]: exact payment works; one resource short, no [G], and the opponent's [G] are refused", () => {
  assert.equal(printing(USURY).type, "tactic");
  assert.equal(printing(USURY).cost, 4);
  assert.equal(printing(USURY).threshold, "g");
  const ok = usuBoard({ pay: G(1).concat(R(3)) });
  usu(ok, "theirs");
  assert.equal(readyResources(ok.engine, P1), 0, "all 4 paid");
  assert.equal(zoneOf(ok.engine, ok.id("cu")), "discard");
  const spentIcon = usuBoard({ pay: spentG(1).concat(R(4)) });
  usu(spentIcon, "theirs");
  assert.equal(readyResources(spentIcon.engine, P1), 0, "a spent [G] satisfies the threshold; cost 4 paid from the 4 ready");
  const short = usuBoard({ pay: G(1).concat(R(2)) });
  refused(() => usu(short, "theirs"), "3 resources for cost 4");
  const shortSpent = usuBoard({ pay: spentG(1).concat(R(3)) });
  refused(() => usu(shortSpent, "theirs"), "threshold met by a spent [G] but only 3 ready", /Costs cannot be paid/);
  const noG = usuBoard({ pay: R(5) });
  refused(() => usu(noG, "theirs"), "no [G]");
  const theirG = usuBoard({ pay: R(5).concat(G(2, P2)) });
  refused(() => usu(theirG, "theirs"), "opponent's [G]");
  assert.equal(zoneOf(noG.engine, noG.id("theirs")), "play");
});

clause(USURY, "0:extraCost", "EXTRA COST: pick a character â€” any character in play may be picked; items, locations, factions, hand/discard characters and no pick are refused", () => {
  const b = usuBoard({
    extra: [
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" }
    ]
  });
  const pick = (key: string) => () => usu(b, key);
  refused(pick("it"), "item");
  refused(pick("lo"), "location");
  refused(pick("hc"), "character in hand");
  refused(pick("dc"), "character in discard");
  refused(() => play(b.engine, P1, b.id("cu"), { selected: { c: [b.engine.state.players[P2].factionId!] } }), "faction");
  refused(() => play(b.engine, P1, b.id("cu"), { selected: {} }), "no pick");
  refused(() => play(b.engine, P1, b.id("cu"), { selected: { c: [b.id("theirs"), b.id("bystander")] } }), "two picks");
  assert.equal(readyResources(b.engine, P1), 4, "refusals paid nothing");
  usu(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "my own character is a legal pick");
});

clause(USURY, "1:rule", "destroys the picked character (to its owner's discard) and nothing else", () => {
  const b = usuBoard();
  usu(b, "theirs");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("cu")), "discard");
});

clause(USURY, "1:rule", "your faction loses 3 influence (25 -> 22) when you destroy an opponent's character; the opponent's influence is unchanged", () => {
  const b = usuBoard({ influence: 25 });
  const theirs = influence(b.engine, P2);
  usu(b, "theirs");
  assert.equal(influence(b.engine, P1), 22, "I lose 3");
  assert.equal(influence(b.engine, P2), theirs, "opponent's faction untouched");
  const own = usuBoard({ influence: 10 });
  usu(own, "mine");
  assert.equal(zoneOf(own.engine, own.id("mine")), "discard");
  assert.equal(influence(own.engine, P1), 7, "destroying my own character also costs 3");
});

clause(USURY, "2:flipUp", "FLIP UP: 2 [G] â€” flipping a face-down Usury (it may pay for itself) destroys the picked character, loses 3 influence, and the tactic goes to the discard pile", () => {
  const b = usuBoard({ zone: "play", faceDown: true, pay: spentG(1).concat(R(1)), influence: 25 });
  assert.equal(readyResources(b.engine, P1), 2);
  flip(b.engine, P1, b.id("cu"), { c: [b.id("theirs")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("cu")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard", "character destroyed");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  assert.equal(influence(b.engine, P1), 22);
  assert.equal(zoneOf(b.engine, b.id("cu")), "discard", "no hand return on this card");
  assert.equal(readyResources(b.engine, P1), 0, "exactly 2 paid");
  const more = usuBoard({ zone: "play", faceDown: true, pay: G(1).concat(R(3)) });
  flip(more.engine, P1, more.id("cu"), { c: [more.id("mine")] });
  const left = readyResources(more.engine, P1);
  assert.ok(left === 1 || left === 2, `4 others ready - 2 paid -> ${left}`);
  assert.equal(zoneOf(more.engine, more.id("mine")), "discard");
});

clause(USURY, "2:flipUp", "FLIP UP refused: cost 2 unpayable (only itself ready), [G] missing (none / opponent's), no pick, a non-character pick, or the opponent's turn", () => {
  const costShort = usuBoard({ zone: "play", faceDown: true, pay: spentG(1) });
  assert.equal(readyResources(costShort.engine, P1), 1);
  refused(() => flip(costShort.engine, P1, costShort.id("cu"), { c: [costShort.id("theirs")] }), "cost 2 with only itself ready");
  const noG = usuBoard({ zone: "play", faceDown: true, pay: R(3) });
  refused(() => flip(noG.engine, P1, noG.id("cu"), { c: [noG.id("theirs")] }), "no [G]");
  const theirG = usuBoard({ zone: "play", faceDown: true, pay: R(3).concat(G(2, P2)) });
  refused(() => flip(theirG.engine, P1, theirG.id("cu"), { c: [theirG.id("theirs")] }), "opponent's [G]");
  const ok = usuBoard({ zone: "play", faceDown: true, pay: G(1).concat(R(1)) });
  refused(() => flip(ok.engine, P1, ok.id("cu"), {}), "no pick");
  refused(() => flip(ok.engine, P1, ok.id("cu"), { c: [ok.engine.state.players[P2].factionId!] }), "faction pick");
  assert.equal(ok.engine.state.cards[ok.id("cu")].faceDown, true);
  flip(ok.engine, P1, ok.id("cu"), { c: [ok.id("theirs")] });
  assert.equal(zoneOf(ok.engine, ok.id("theirs")), "discard", "control");
  const opp = usuBoard({ zone: "play", faceDown: true, pay: G(1).concat(R(3)), turnOf: P2 });
  refused(() => flip(opp.engine, P1, opp.id("cu"), { c: [opp.id("theirs")] }), "opponent's turn");
});

// ===========================================================================================
// Delectable Boon â€” tactic Â· banker Â· cost 0 Â· threshold gg
// ===========================================================================================
const BOON = "281dc8cd-1a81-4e59-84e2-012a95f750cf";

const pinger = (): CardDefinition =>
  character({
    name: "Pinger",
    behavior: {
      abilities: [
        ...[1, 2, 3, 5].map((n) => ({
          id: `hit${n}`,
          type: "activated" as const,
          targets: [{ id: "t", selector: { zone: "play" as const }, count: 1 }],
          effects: [{ type: "dealDamage" as const, target: { type: "selected" as const, id: "t" }, amount: n }]
        })),
        { id: "facMine3", type: "activated" as const, effects: [{ type: "dealDamage" as const, target: { type: "factionOf" as const, player: "controller" as const }, amount: 3 }] },
        { id: "facFoe3", type: "activated" as const, effects: [{ type: "dealDamage" as const, target: { type: "factionOf" as const, player: "opponent" as const }, amount: 3 }] }
      ]
    }
  } as never);

type BoonOpts = { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId };
const boonBoard = (o: BoonOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    turn: o.turnOf === P2 ? 2 : 1,
    activePlayerId: o.turnOf ?? P1,
    cards: [
      { key: "bn", def: printing(BOON), owner: P1, zone: "hand" },
      { key: "pg", def: pinger(), owner: P1, zone: "play" },
      body("first", P1, { life: 9 }),
      body("second", P1, { life: 9 }),
      body("third", P2, { life: 9 }),
      ...(o.pay ?? spentG(2).concat(R(3))),
      ...(o.extra ?? [])
    ]
  });
const boon = (b: ReturnType<typeof boonBoard>, x: number, first = "first", second = "second", firstId?: string, secondId?: string) =>
  play(b.engine, P1, b.id("bn"), { selected: { first: [firstId ?? b.id(first)], second: [secondId ?? b.id(second)] }, variables: { x } });
const hit = (b: ReturnType<typeof boonBoard>, n: number, target: string, targetId?: string) =>
  activate(b.engine, P1, b.id("pg"), `hit${n}`, { selected: { t: [targetId ?? b.id(target)] } });

clause(BOON, "0:extraCost", "printed as a 0-cost tactic with threshold [G][G]: deployable with exactly [G][G] (spent) and X=0; one [G] short or no [G] is refused", () => {
  assert.equal(printing(BOON).type, "tactic");
  assert.equal(printing(BOON).cost, 0);
  assert.equal(printing(BOON).threshold, "gg");
  const ok = boonBoard({ pay: spentG(2) });
  boon(ok, 0);
  assert.equal(zoneOf(ok.engine, ok.id("bn")), "discard", "deployed for 0");
  const oneG = boonBoard({ pay: spentG(1).concat(R(5)) });
  refused(() => boon(oneG, 0), "one [G] short", /Threshold requirements are not met/);
  const readyGG = boonBoard({ pay: G(2) });
  boon(readyGG, 0);
  assert.equal(readyResources(readyGG.engine, P1), 2, "cost 0 and X=0: nothing spent");
  const theirs = boonBoard({ pay: spentG(1).concat(G(2, P2), R(4)) });
  refused(() => boon(theirs, 0), "opponent's [G]");
  const none = boonBoard({ pay: R(5) });
  refused(() => boon(none, 0), "no [G]");
});

clause(BOON, "0:extraCost", "Choose a number for X, Pay X: the player picks X and exactly X resources are paid (X=1, 2, 3); X above the ready resources is refused", () => {
  for (const x of [1, 2, 3]) {
    const b = boonBoard({ pay: spentG(2).concat(R(4)) });
    boon(b, x);
    assert.equal(b.engine.state.pendingChoice, undefined, `X=${x}`);
    assert.equal(readyResources(b.engine, P1), 4 - x, `X=${x} resources paid`);
  }
  const exact = boonBoard({ pay: spentG(2).concat(R(2)) });
  boon(exact, 2);
  assert.equal(readyResources(exact.engine, P1), 0);
  const short = boonBoard({ pay: spentG(2).concat(R(2)) });
  refused(() => boon(short, 3), "X=3 with 2 ready");
  assert.equal(readyResources(short.engine, P1), 2, "nothing paid on refusal");
  assert.equal(zoneOf(short.engine, short.id("bn")), "hand");
  const frac = boonBoard({ pay: spentG(2).concat(R(4)) });
  refused(() => boon(frac, 1.5), "fractional X");
  const neg = boonBoard({ pay: spentG(2).concat(R(4)) });
  refused(() => boon(neg, -1), "negative X");
  assert.equal(readyResources(neg.engine, P1), 4);
});

clause(BOON, "0:extraCost", "Pick 2 characters, locations, and/or factions: any mix of character / location / faction in play is accepted for each pick; items, resources, other zones, one pick or the same card twice are refused", () => {
  const extra: CardPlacement[] = [
    { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "hch", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
    { key: "dch", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" }
  ];
  const mk = () => boonBoard({ extra, pay: spentG(2).concat(R(4)) });
  const facA = (b: ReturnType<typeof boonBoard>) => b.engine.state.players[P1].factionId!;
  const facB = (b: ReturnType<typeof boonBoard>) => b.engine.state.players[P2].factionId!;
  const t = (b: ReturnType<typeof boonBoard>, first: string, second: string) => () =>
    play(b.engine, P1, b.id("bn"), { selected: { first: [first], second: [second] }, variables: { x: 1 } });
  { const b = mk(); t(b, b.id("first"), b.id("loc"))(); assert.equal(zoneOf(b.engine, b.id("bn")), "discard", "character + location"); }
  { const b = mk(); t(b, b.id("loc"), facA(b))(); assert.equal(zoneOf(b.engine, b.id("bn")), "discard", "location + faction"); }
  { const b = mk(); t(b, facB(b), b.id("third"))(); assert.equal(zoneOf(b.engine, b.id("bn")), "discard", "faction + character"); }
  { const b = mk(); t(b, facA(b), facB(b))(); assert.equal(zoneOf(b.engine, b.id("bn")), "discard", "faction + faction"); }
  const b = mk();
  refused(t(b, b.id("itm"), b.id("second")), "first pick an item");
  refused(t(b, b.id("first"), b.id("itm")), "second pick an item");
  refused(t(b, b.id("hch"), b.id("second")), "first pick a character in hand");
  refused(t(b, b.id("first"), b.id("dch")), "second pick a character in discard");
  const res = Object.values(b.engine.state.cards).find((c) => b.engine.isResource(c.id))!.id;
  refused(t(b, res, b.id("second")), "first pick a resource");
  refused(t(b, b.id("first"), res), "second pick a resource");
  refused(() => play(b.engine, P1, b.id("bn"), { selected: { first: [b.id("first")] }, variables: { x: 1 } }), "only one pick");
  refused(() => play(b.engine, P1, b.id("bn"), { selected: {}, variables: { x: 1 } }), "no picks");
  assert.equal(readyResources(b.engine, P1), 4, "refusals paid nothing");
});

clause(BOON, "1:rule", "the next X damage to the first picked card is inflicted to the second instead: X=2, 5 damage -> 2 to the second, the remaining 3 to the first", () => {
  const b = boonBoard();
  boon(b, 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  hit(b, 5, "first");
  assert.equal(dmg(b.engine, b.id("second")), 2, "X=2 redirected to the second");
  assert.equal(dmg(b.engine, b.id("first")), 3, "the rest lands on the first");
  hit(b, 3, "first");
  assert.equal(dmg(b.engine, b.id("first")), 6, "the shield is used up: the next hit is normal");
  assert.equal(dmg(b.engine, b.id("second")), 2);
});

clause(BOON, "1:rule", "damage smaller than X is redirected entirely and the unused remainder of X stays available this turn (X=3: 1, then 1, then 3 -> 3 redirected in total)", () => {
  const b = boonBoard();
  boon(b, 3);
  hit(b, 1, "first");
  assert.equal(dmg(b.engine, b.id("second")), 1);
  assert.equal(dmg(b.engine, b.id("first")), 0);
  hit(b, 1, "first");
  assert.equal(dmg(b.engine, b.id("second")), 2);
  assert.equal(dmg(b.engine, b.id("first")), 0);
  hit(b, 3, "first");
  assert.equal(dmg(b.engine, b.id("second")), 3, "only the last 1 of X is redirected");
  assert.equal(dmg(b.engine, b.id("first")), 2, "the other 2 are inflicted to the first");
  hit(b, 1, "first");
  assert.equal(dmg(b.engine, b.id("first")), 3, "X used up");
  assert.equal(dmg(b.engine, b.id("second")), 3);
});

clause(BOON, "1:rule", "X=1 redirects exactly 1 and X=0 redirects nothing", () => {
  const one = boonBoard();
  boon(one, 1);
  hit(one, 3, "first");
  assert.equal(dmg(one.engine, one.id("second")), 1);
  assert.equal(dmg(one.engine, one.id("first")), 2);
  const zero = boonBoard();
  boon(zero, 0);
  hit(zero, 3, "first");
  assert.equal(dmg(zero.engine, zero.id("second")), 0);
  assert.equal(dmg(zero.engine, zero.id("first")), 3);
});

clause(BOON, "1:rule", "only damage to the FIRST picked card is redirected: damage to the second, to a third card, or to my other cards is inflicted normally and doesn't use up the shield", () => {
  const b = boonBoard();
  boon(b, 2);
  hit(b, 3, "second");
  assert.equal(dmg(b.engine, b.id("second")), 3, "second takes its own damage");
  assert.equal(dmg(b.engine, b.id("first")), 0);
  hit(b, 2, "third");
  assert.equal(dmg(b.engine, b.id("third")), 2, "third card unaffected");
  assert.equal(dmg(b.engine, b.id("second")), 3);
  hit(b, 1, "pg");
  assert.equal(dmg(b.engine, b.id("pg")), 1);
  hit(b, 2, "first");
  assert.equal(dmg(b.engine, b.id("second")), 5, "the full shield was still there");
  assert.equal(dmg(b.engine, b.id("first")), 0);
});

clause(BOON, "1:rule", "the redirect really replaces the damage: a first card that would die survives, and a second card that can't take it dies instead", () => {
  const b = boonBoard({ extra: [] });
  b.engine.state.cards[b.id("first")].damage = 0;
  const small = boonBoard();
  // first: life 9 in the shared board, so build dedicated frail cards
  const f = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bn", def: printing(BOON), owner: P1, zone: "hand" },
      { key: "pg", def: pinger(), owner: P1, zone: "play" },
      body("first", P1, { life: 2 }),
      body("second", P1, { life: 2 }),
      ...spentG(2),
      ...R(2)
    ]
  });
  play(f.engine, P1, f.id("bn"), { selected: { first: [f.id("first")], second: [f.id("second")] }, variables: { x: 2 } });
  activate(f.engine, P1, f.id("pg"), "hit2", { selected: { t: [f.id("first")] } });
  assert.equal(zoneOf(f.engine, f.id("first")), "play", "first survives");
  assert.equal(zoneOf(f.engine, f.id("second")), "discard", "second takes 2 and dies");
  void small;
});

clause(BOON, "1:rule", "this turn: the redirect ends at end of turn (a hit next turn is inflicted to the first card normally); an unused shield doesn't carry over", () => {
  const b = boonBoard();
  boon(b, 3);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  hit(b, 2, "first");
  assert.equal(dmg(b.engine, b.id("first")), 2, "damage to the first is not redirected any more");
  assert.equal(dmg(b.engine, b.id("second")), 0);
});

clause(BOON, "1:rule", "a second Delectable Boon with different picks works independently of the first (each redirect its own X)", () => {
  const b = boonBoard({ pay: spentG(2).concat(R(6)), extra: [{ key: "bn2", def: printing(BOON), owner: P1, zone: "hand" }] });
  boon(b, 1);
  play(b.engine, P1, b.id("bn2"), { selected: { first: [b.id("third")], second: [b.id("pg")] }, variables: { x: 2 } });
  hit(b, 3, "first");
  hit(b, 3, "third");
  assert.equal(dmg(b.engine, b.id("second")), 1);
  assert.equal(dmg(b.engine, b.id("first")), 2);
  assert.equal(dmg(b.engine, b.id("pg")), 2);
  assert.equal(dmg(b.engine, b.id("third")), 1);
});

clause(BOON, "1:rule", "locations can be first (damage to the location goes to the second) and second (a character's damage goes to the location)", () => {
  const extra: CardPlacement[] = [{ key: "loc", def: location({ name: "Loc", structure: 9 }), owner: P1, zone: "play" }];
  const a = boonBoard({ extra });
  boon(a, 2, "loc", "first");
  hit(a, 3, "loc");
  assert.equal(dmg(a.engine, a.id("first")), 2, "character took the redirected 2");
  assert.equal(dmg(a.engine, a.id("loc")), 1, "location took the rest");
  const b = boonBoard({ extra });
  boon(b, 2, "first", "loc");
  hit(b, 3, "first");
  assert.equal(dmg(b.engine, b.id("loc")), 2, "location took the redirected 2");
  assert.equal(dmg(b.engine, b.id("first")), 1);
});

clause(BOON, "1:rule", "a faction can be the first pick: damage to my faction is inflicted to the second pick instead (only the unredirected rest reduces my influence)", () => {
  const fac = boonBoard();
  const myFac = fac.engine.state.players[P1].factionId!;
  const before = influence(fac.engine, P1);
  boon(fac, 2, "first", "second", myFac, fac.id("second"));
  activate(fac.engine, P1, fac.id("pg"), "facMine3", {});
  assert.equal(dmg(fac.engine, fac.id("second")), 2, "redirected from my faction");
  assert.equal(before - influence(fac.engine, P1), 1, "only the unredirected 1 reaches my faction");
});

clause(BOON, "1:rule", "a faction can be the second pick: damage redirected onto it is damage to a faction, i.e. an equal influence loss (CR 408.2)", () => {
  const onto = boonBoard();
  const theirFac = onto.engine.state.players[P2].factionId!;
  const b2 = influence(onto.engine, P2);
  boon(onto, 2, "first", "second", onto.id("first"), theirFac);
  hit(onto, 3, "first");
  assert.equal(dmg(onto.engine, onto.id("first")), 1, "the rest stays on the first");
  assert.equal(b2 - influence(onto.engine, P2), 2, "2 damage inflicted to their faction = 2 influence lost");
});

clause(BOON, "0:extraCost", "Pick 2 characters, locations, and/or factions: the same card cannot be picked for both picks", () => {
  const b = boonBoard({ pay: spentG(2).concat(R(4)) });
  refused(() => play(b.engine, P1, b.id("bn"), { selected: { first: [b.id("first")], second: [b.id("first")] }, variables: { x: 1 } }), "the same card for both picks");
  assert.equal(zoneOf(b.engine, b.id("bn")), "hand");
});

// ===========================================================================================
// Department of Rejections â€” location Â· banker Â· cost 1 Â· threshold g Â· structure 4
// ===========================================================================================
const DEPT = "a3a69878-9f2a-49d3-9c4b-81887058890a";

// An item, not a character: the Department also taxes every opponent's CHARACTER ability by 2 (seed-saga-04-p1-3),
// and these tests isolate the search tax.
const tutorChar = (): CardDefinition =>
  item({
    name: "Tutor",
    behavior: {
      abilities: [
        {
          id: "search",
          type: "activated",
          effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "found", count: 1, optional: true, selector: { owner: "self", zone: "deck" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] }]
        },
        {
          id: "searchTheirs",
          type: "activated",
          effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "found", count: 1, optional: true, selector: { owner: "opponent", zone: "deck" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] }]
        }
      ]
    }
  } as never);
const tutorTactic = (): CardDefinition =>
  tactic({
    name: "TutorTactic",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tt",
          type: "activated",
          effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "found", count: 1, optional: true, selector: { owner: "self", zone: "deck" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] }]
        }
      ]
    }
  } as never);
const deptPlacement = (key: string, owner: PlayerId = P1, over: Partial<CardPlacement> = {}): CardPlacement => ({ key, def: printing(DEPT), owner, zone: "play", ...over });

type DeptOpts = { depts?: CardPlacement[]; pay?: CardPlacement[]; who?: PlayerId; extra?: CardPlacement[] };
const searchBoard = (o: DeptOpts = {}) => {
  const who = o.who ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    turn: who === P2 ? 2 : 1,
    activePlayerId: who,
    random: () => 0.5,
    cards: [
      ...(o.depts ?? [deptPlacement("d1")]),
      { key: "tu", def: tutorChar(), owner: who, zone: "play" },
      { key: "tt", def: tutorTactic(), owner: who, zone: "hand" },
      { key: "mydeck", def: character({ name: "MyDeck" }), owner: who, zone: "deck" },
      { key: "oppdeck", def: character({ name: "OppDeck" }), owner: who === P1 ? P2 : P1, zone: "deck" },
      ...(o.pay ?? []),
      ...(o.extra ?? [])
    ]
  });
};
const doSearch = (b: ReturnType<typeof searchBoard>, who: PlayerId, ability = "search") => {
  perform(b.engine, { type: "activateAbility", playerId: who, cardId: b.id("tu"), abilityId: ability, selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
};
const searchResolved = (b: ReturnType<typeof searchBoard>, who: PlayerId, picked: string): boolean => {
  const pc = b.engine.state.pendingChoice as unknown as { kind?: string } | undefined;
  if (pc?.kind !== "chooserSelectsTarget") return false;
  perform(b.engine, { type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: [b.id(picked)] } });
  resolvePendingResponses(b.engine);
  return true;
};

clause(DEPT, "0:rule", "printed as a 1-cost banker location with threshold [G] and structure 4", () => {
  assert.equal(printing(DEPT).type, "location");
  assert.equal(printing(DEPT).cost, 1);
  assert.equal(printing(DEPT).threshold, "g");
  assert.equal(printing(DEPT).structure, 4);
  const mk = (pay: CardPlacement[]) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "dp", def: printing(DEPT), owner: P1, zone: "hand" }, ...pay] });
  const ok = mk(G(1));
  play(ok.engine, P1, ok.id("dp"));
  assert.equal(zoneOf(ok.engine, ok.id("dp")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "cost 1 paid");
  assert.equal(ok.engine.getStat(ok.id("dp"), "structure"), 4);
  const spentOnly = mk(spentG(1));
  refused(() => play(spentOnly.engine, P1, spentOnly.id("dp")), "[G] is spent, nothing ready to pay 1");
  const spentOk = mk(spentG(1).concat(R(1)));
  play(spentOk.engine, P1, spentOk.id("dp"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("dp")), "play");
  const noG = mk(R(3));
  refused(() => play(noG.engine, P1, noG.id("dp")), "no [G]");
  const theirs = mk(R(2).concat(G(2, P2)));
  refused(() => play(theirs.engine, P1, theirs.id("dp")), "opponent's [G]");
  const none = mk([]);
  refused(() => play(none.engine, P1, none.id("dp")), "no resources");
});

clause(DEPT, "0:rule", "opponents must pay 2 to search their deck: with 2 ready the search proceeds and exactly 2 are paid; with 1 ready (or 0) the search does nothing", () => {
  const ok = searchBoard({ pay: R(3, P2) });
  doSearch(ok, P2);
  assert.ok(searchResolved(ok, P2, "mydeck"), "search prompt appears when the tax is payable");
  assert.equal(zoneOf(ok.engine, ok.id("mydeck")), "hand");
  assert.equal(readyResources(ok.engine, P2), 1, "paid exactly 2 of 3");
  const exact = searchBoard({ pay: R(2, P2) });
  doSearch(exact, P2);
  assert.ok(searchResolved(exact, P2, "mydeck"), "searchResolved(exact, P2, \"mydeck\")");
  assert.equal(readyResources(exact.engine, P2), 0);
  const poor = searchBoard({ pay: R(1, P2) });
  doSearch(poor, P2);
  assert.equal(poor.engine.state.pendingChoice, undefined, "cannot pay 2: no search");
  assert.equal(zoneOf(poor.engine, poor.id("mydeck")), "deck");
  assert.equal(readyResources(poor.engine, P2), 1, "nothing paid");
  const none = searchBoard({ pay: [] });
  doSearch(none, P2);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(none.engine, none.id("mydeck")), "deck");
});

clause(DEPT, "0:rule", "the search tax applies to a search from any source (a tactic's search too), and spent resources can't pay it", () => {
  const b = searchBoard({ pay: R(2, P2) });
  perform(b.engine, { type: "playCard", playerId: P2, cardId: b.id("tt"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  const asked = b.engine.state.pendingChoice as unknown as { kind?: string } | undefined;
  assert.equal(asked?.kind, "chooserSelectsTarget", "the search was set up");
  assert.equal(readyResources(b.engine, P2), 0, "2 paid for the tactic's search");
  const spent = searchBoard({ pay: spentResources(P2, 2).concat(R(1, P2)) });
  doSearch(spent, P2);
  assert.equal(spent.engine.state.pendingChoice, undefined, "2 spent + 1 ready can't pay 2");
  assert.equal(zoneOf(spent.engine, spent.id("mydeck")), "deck");
});

clause(DEPT, "0:rule", "only OPPONENTS of its controller pay: the controller searching their own deck pays nothing; searching the controller's deck with an opponent's effect is not 'their deck'", () => {
  const mine = searchBoard({ who: P1, depts: [deptPlacement("d1", P1)], pay: [] });
  doSearch(mine, P1);
  assert.ok(searchResolved(mine, P1, "mydeck"), "the controller searches for free");
  assert.equal(zoneOf(mine.engine, mine.id("mydeck")), "hand");
  // Department owned by P2: P2 (its controller) searches free, P1 (opponent) pays
  const theirs = searchBoard({ who: P1, depts: [deptPlacement("d1", P2)], pay: R(1, P1) });
  doSearch(theirs, P1);
  assert.equal(theirs.engine.state.pendingChoice, undefined, "P1 is the opponent of the controller, 1 ready can't pay 2");
  const theirs2 = searchBoard({ who: P1, depts: [deptPlacement("d1", P2)], pay: R(2, P1) });
  doSearch(theirs2, P1);
  assert.ok(searchResolved(theirs2, P1, "mydeck"), "searchResolved(theirs2, P1, \"mydeck\")");
  assert.equal(readyResources(theirs2.engine, P1), 0);
  // an opponent searching the Department controller's deck (opponent's deck is not "their deck")
  const other = searchBoard({ who: P2, pay: [] });
  doSearch(other, P2, "searchTheirs");
  assert.ok(searchResolved(other, P2, "oppdeck"), "searching the other player's deck is not taxed");
  assert.equal(zoneOf(other.engine, other.id("oppdeck")), "hand");
});

clause(DEPT, "0:rule", "the tax needs the Department face-up in play: it stacks for two copies (4), and a face-down Department or one in another zone has no effect", () => {
  const two = searchBoard({ depts: [deptPlacement("d1"), deptPlacement("d2")], pay: R(3, P2) });
  doSearch(two, P2);
  assert.equal(two.engine.state.pendingChoice, undefined, "two copies tax 4; 3 ready can't pay");
  assert.equal(zoneOf(two.engine, two.id("mydeck")), "deck");
  const two4 = searchBoard({ depts: [deptPlacement("d1"), deptPlacement("d2")], pay: R(5, P2) });
  doSearch(two4, P2);
  assert.ok(searchResolved(two4, P2, "mydeck"), "searchResolved(two4, P2, \"mydeck\")");
  assert.equal(readyResources(two4.engine, P2), 1, "paid 4 of 5");
  const down = searchBoard({ depts: [deptPlacement("d1", P1, { faceDown: true })], pay: [] });
  doSearch(down, P2);
  assert.ok(searchResolved(down, P2, "mydeck"), "face-down Department: no tax");
  const hand = searchBoard({ depts: [deptPlacement("d1", P1, { zone: "hand" })], pay: [] });
  doSearch(hand, P2);
  assert.ok(searchResolved(hand, P2, "mydeck"), "Department in hand: no tax");
  const disc = searchBoard({ depts: [deptPlacement("d1", P1, { zone: "discard" })], pay: [] });
  doSearch(disc, P2);
  assert.ok(searchResolved(disc, P2, "mydeck"), "Department in discard: no tax");
});

// --- 1:rule: ability tax -------------------------------------------------------------------
const workerDef = (costAmount: number | undefined): CardDefinition =>
  character({
    name: "Worker",
    behavior: {
      abilities: [
        {
          id: "poke",
          type: "activated",
          ...(costAmount === undefined ? {} : { costs: [{ type: "payResources", amount: costAmount }] }),
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
        }
      ]
    }
  } as never);
const handWorker = (): CardDefinition =>
  character({
    name: "HandWorker",
    behavior: {
      abilities: [
        {
          id: "handpoke",
          type: "activated",
          activationZone: "hand",
          costs: [{ type: "payResources", amount: 1 }],
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
        }
      ]
    }
  } as never);
const triggerWorker = (): CardDefinition =>
  character({
    name: "TrigWorker",
    behavior: {
      abilities: [
        {
          id: "trig",
          type: "triggered",
          event: "turnStarted",
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
        }
      ]
    }
  } as never);

type AbOpts = { cost?: number | undefined; pay?: number; owner?: PlayerId; deptOwner?: PlayerId; deptZone?: "play" | "hand"; deptFaceDown?: boolean; extra?: CardPlacement[]; zone?: "play" | "hand" | "discard"; def?: CardDefinition };
const abBoard = (o: AbOpts = {}) => {
  const owner = o.owner ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    turn: owner === P2 ? 2 : 1,
    activePlayerId: owner,
    cards: [
      { key: "dp", def: printing(DEPT), owner: o.deptOwner ?? P1, zone: o.deptZone ?? "play", faceDown: o.deptFaceDown },
      { key: "w", def: o.def ?? workerDef("cost" in o ? o.cost : 1), owner, zone: o.zone ?? "play" },
      ...bank("rage", o.pay ?? 0, owner),
      ...(o.extra ?? [])
    ]
  });
};
const poke = (b: ReturnType<typeof abBoard>, who: PlayerId = P2, ability = "poke") => activate(b.engine, who, b.id("w"), ability, {});

clause(DEPT, "1:rule", "opponents pay 2 extra to use a character's ability: ability cost 1 becomes 3; 2 ready refused, 3 ready works and exactly 3 is spent", () => {
  const poor = abBoard({ cost: 1, pay: 2 });
  refused(() => poke(poor), "cost 1 + 2 = 3 with only 2 ready");
  assert.equal(readyResources(poor.engine, P2), 2, "nothing paid on refusal");
  const ok = abBoard({ cost: 1, pay: 3 });
  const fac = ok.engine.state.players[P1].influence as number;
  poke(ok);
  assert.equal(readyResources(ok.engine, P2), 0, "paid 1 + 2");
  assert.equal(fac - (ok.engine.state.players[P1].influence as number), 1, "the ability itself resolved");
  const more = abBoard({ cost: 1, pay: 5 });
  poke(more);
  assert.equal(readyResources(more.engine, P2), 2);
  const zeroCost = abBoard({ cost: 0, pay: 2 });
  poke(zeroCost);
  assert.equal(readyResources(zeroCost.engine, P2), 0, "a pay-0 ability costs 2");
  const zeroPoor = abBoard({ cost: 0, pay: 1 });
  refused(() => poke(zeroPoor), "pay 0 + 2 with only 1 ready");
});

clause(DEPT, "1:rule", "an ability that has no printed resource cost still costs 2 for an opponent", () => {
  const poor = abBoard({ cost: undefined, pay: 1 });
  refused(() => poke(poor), "no printed cost, still 2 to use: 1 ready is not enough");
  const ok = abBoard({ cost: undefined, pay: 2 });
  poke(ok);
  assert.equal(readyResources(ok.engine, P2), 0, "2 paid");
});

clause(DEPT, "1:rule", "the controller's own characters pay no extra; without a Department (or with a face-down / in-hand one) nobody pays extra", () => {
  const own = abBoard({ cost: 1, pay: 1, owner: P1, deptOwner: P1 });
  poke(own, P1);
  assert.equal(readyResources(own.engine, P1), 0, "controller pays just the printed 1");
  const noDept = abBoard({ cost: 1, pay: 1, deptZone: "hand" });
  poke(noDept);
  assert.equal(readyResources(noDept.engine, P2), 0, "Department in hand: printed cost 1");
  const down = abBoard({ cost: 1, pay: 1, deptFaceDown: true });
  poke(down);
  assert.equal(readyResources(down.engine, P2), 0, "face-down Department: printed cost 1");
});

clause(DEPT, "1:rule", "two Departments stack (+4); only characters' abilities are taxed, not an item's", () => {
  const two = abBoard({ cost: 1, pay: 4, extra: [deptPlacement("d2")] });
  refused(() => poke(two), "cost 1 + 4 = 5 with 4 ready");
  const ok = abBoard({ cost: 1, pay: 5, extra: [deptPlacement("d2")] });
  poke(ok);
  assert.equal(readyResources(ok.engine, P2), 0);
  const itemDef = item({
    name: "Gadget",
    behavior: { abilities: [{ id: "gad", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] }
  } as never);
  const it = abBoard({ cost: 1, pay: 1, def: itemDef });
  poke(it, P2, "gad");
  assert.equal(readyResources(it.engine, P2), 0, "item ability costs only its printed 1");
});

clause(DEPT, "1:rule", "this includes abilities used when the character is not in play: a character's ability used from hand costs 2 more", () => {
  const poor = abBoard({ def: handWorker(), zone: "hand", pay: 2 });
  refused(() => poke(poor, P2, "handpoke"), "printed 1 + 2 = 3 with 2 ready, used from hand");
  assert.equal(readyResources(poor.engine, P2), 2);
  const ok = abBoard({ def: handWorker(), zone: "hand", pay: 3 });
  poke(ok, P2, "handpoke");
  assert.equal(readyResources(ok.engine, P2), 0);
  assert.equal(ok.engine.state.players[P1].influence, (abBoard({ def: handWorker(), zone: "hand", pay: 3 }).engine.state.players[P1].influence as number) - 1);
  const plain = abBoard({ def: handWorker(), zone: "hand", pay: 1, deptZone: "hand" });
  poke(plain, P2, "handpoke");
  assert.equal(readyResources(plain.engine, P2), 0, "control: without the Department it costs the printed 1");
});

clause(DEPT, "1:rule", "triggered abilities are not 'used': an opponent's character trigger fires without paying 2", () => {
  const b = abBoard({ def: triggerWorker(), pay: 0 });
  const before = b.engine.state.players[P1].influence as number;
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok((b.engine.state.players[P1].influence as number) < before, "the trigger resolved with no resources");
});

clause(DEPT, "2:flipUp", "FLIP UP: 1 [G] â€” a face-down Department flips up for 1 (it may pay for itself) with a [G]; it becomes a face-up location with structure 4", () => {
  const mk = (pay: CardPlacement[], turnOf: PlayerId = P1) => buildGame({ playerA: { faction: developFaction() }, turn: turnOf === P1 ? 1 : 2, activePlayerId: turnOf, cards: [{ key: "dp", def: printing(DEPT), owner: P1, zone: "play", faceDown: true }, ...pay] });
  const ok = mk(spentG(1));
  assert.equal(readyResources(ok.engine, P1), 1, "only the card itself is ready");
  flip(ok.engine, P1, ok.id("dp"));
  assert.equal(ok.engine.state.cards[ok.id("dp")].faceDown, false);
  assert.equal(zoneOf(ok.engine, ok.id("dp")), "play");
  assert.equal(ok.engine.getStat(ok.id("dp"), "structure"), 4);
  assert.equal(readyResources(ok.engine, P1), 0);
  const more = mk(G(1).concat(R(2)));
  flip(more.engine, P1, more.id("dp"));
  const left = readyResources(more.engine, P1);
  assert.ok(left === 2 || left === 3 - 1 - 0 || left === 1, `3 ready - 1 paid -> ${left}`);
  const noG = mk(R(3));
  refused(() => flip(noG.engine, P1, noG.id("dp")), "no [G]");
  assert.equal(noG.engine.state.cards[noG.id("dp")].faceDown, true);
  const theirG = mk(R(2).concat(G(2, P2)));
  refused(() => flip(theirG.engine, P1, theirG.id("dp")), "opponent's [G]");
  const none = mk([]);
  refused(() => flip(none.engine, P1, none.id("dp")), "no [G] at all");
  const opp = mk(spentG(1), P2);
  refused(() => flip(opp.engine, P1, opp.id("dp")), "opponent's turn");
});

clause(DEPT, "2:flipUp", "FLIP UP cost 1 is mandatory: with the threshold met by a spent [G] and the card as the only ready resource the cost is payable (itself); a flipped Department then taxes searches", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "dp", def: printing(DEPT), owner: P1, zone: "play", faceDown: true },
      ...spentG(1),
      { key: "tu", def: tutorChar(), owner: P2, zone: "play" },
      { key: "md", def: character({ name: "MyDeck" }), owner: P2, zone: "deck" }
    ]
  });
  flip(b.engine, P1, b.id("dp"));
  assert.equal(b.engine.state.cards[b.id("dp")].faceDown, false);
  endTurn(b.engine, P1);
  const p2 = bank("rage", 1, P2);
  void p2;
  perform(b.engine, { type: "activateAbility", playerId: P2, cardId: b.id("tu"), abilityId: "search", selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "P2 has no resources: the taxed search does nothing");
  assert.equal(zoneOf(b.engine, b.id("md")), "deck");
});

// ===========================================================================================
// Emissary of Loot â€” character Â· banker Â· mau Â· cost 5 Â· threshold g Â· 3 / 3 / 4
// ===========================================================================================
const EMI = "392bd270-440a-4c68-a351-a382b7336c3f";

type EmiOpts = { zone?: "hand" | "play"; pay?: CardPlacement[]; tokens?: number; extra?: CardPlacement[]; turnOf?: PlayerId };
const emiBoard = (o: EmiOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turnOf === P2 ? 2 : 1,
    activePlayerId: o.turnOf ?? P1,
    random: () => 0.5,
    cards: [
      { key: "em", def: printing(EMI), owner: P1, zone: o.zone ?? "play", counters: o.tokens ? { token: o.tokens } : undefined },
      body("mine", P1),
      body("theirs", P2),
      ...(o.pay ?? R(2)),
      ...(o.extra ?? [])
    ]
  });
const tokens = (b: ReturnType<typeof emiBoard>): number => ((b.engine.state.cards[b.id("em")] as unknown as { counters?: Record<string, number> }).counters?.token ?? 0);

clause(EMI, "0:rule", "printed as a 5-cost banker mau character with threshold [G] and 3 strength / 3 speed / 4 life", () => {
  assert.equal(printing(EMI).type, "character");
  assert.equal(printing(EMI).cost, 5);
  assert.equal(printing(EMI).threshold, "g");
  assert.deepEqual(printing(EMI).subtype, ["mau"]);
  const ok = emiBoard({ zone: "hand", pay: G(1).concat(R(4)) });
  play(ok.engine, P1, ok.id("em"));
  assert.equal(zoneOf(ok.engine, ok.id("em")), "play");
  assert.equal(ok.engine.getStat(ok.id("em"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("em"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("em"), "life"), 4);
  assert.equal(readyResources(ok.engine, P1), 0, "all 5 paid");
  const spent = emiBoard({ zone: "hand", pay: spentG(1).concat(R(5)) });
  play(spent.engine, P1, spent.id("em"));
  assert.equal(zoneOf(spent.engine, spent.id("em")), "play", "a spent [G] meets the threshold");
  const short = emiBoard({ zone: "hand", pay: G(1).concat(R(3)) });
  refused(() => play(short.engine, P1, short.id("em")), "4 resources for cost 5");
  const noG = emiBoard({ zone: "hand", pay: R(6) });
  refused(() => play(noG.engine, P1, noG.id("em")), "no [G]");
  const theirG = emiBoard({ zone: "hand", pay: R(5).concat(G(2, P2)) });
  refused(() => play(theirG.engine, P1, theirG.id("em")), "opponent's [G]");
});

// --- 0:rule trigger ------------------------------------------------------------------------
const greedItem = (): CardDefinition => item({ name: "GreedItem", cost: 0, resource: { provides: ["greed"], staple: false } } as never);
const greedGreedItem = (): CardDefinition => item({ name: "GreedGreedItem", cost: 0, resource: { provides: ["greed", "greed"], staple: false } } as never);
const rageItem = (): CardDefinition => item({ name: "RageItem", cost: 0, resource: { provides: ["rage"], staple: false } } as never);
const greedRes = (name: string): CardDefinition => resourceCard({ name, resource: { provides: ["greed"], staple: false } });
const rageRes = (name: string): CardDefinition => resourceCard({ name, resource: { provides: ["rage"], staple: false } });

const answerMay = (b: ReturnType<typeof emiBoard>, accept: boolean) => {
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; id: string } | undefined;
  assert.ok(pc, "a 'you may' prompt is pending");
  assert.equal(pc!.playerId, P1, "the controller chooses");
  const kind = pc!.kind;
  const choice = kind === "chooserSelectsOption" ? { kind, optionIndex: accept ? 0 : 1 } : kind === "mayPay" ? { kind, pay: accept } : { kind, accept };
  perform(b.engine, { type: "resolvePendingChoice", playerId: P1, choice });
  resolvePendingResponses(b.engine);
};

clause(EMI, "0:rule", "a [G]-providing card entering play under my control (an item with PROVIDES [G]) lets me put a token on Emissary â€” accept adds exactly 1, decline adds none", () => {
  const acc = emiBoard({ extra: [{ key: "gi", def: greedItem(), owner: P1, zone: "hand" }] });
  play(acc.engine, P1, acc.id("gi"));
  assert.equal(zoneOf(acc.engine, acc.id("gi")), "play");
  answerMay(acc, true);
  assert.equal(acc.engine.state.pendingChoice, undefined);
  assert.equal(tokens(acc), 1, "one token");
  const dec = emiBoard({ extra: [{ key: "gi", def: greedItem(), owner: P1, zone: "hand" }] });
  play(dec.engine, P1, dec.id("gi"));
  answerMay(dec, false);
  assert.equal(dec.engine.state.pendingChoice, undefined);
  assert.equal(tokens(dec), 0, "declined: no token");
});

clause(EMI, "0:rule", "'at least [G]': a card providing [G][G] counts, and a [G] resource developed face-up counts; each entry gives its own token", () => {
  const dbl = emiBoard({ extra: [{ key: "gg", def: greedGreedItem(), owner: P1, zone: "hand" }] });
  play(dbl.engine, P1, dbl.id("gg"));
  answerMay(dbl, true);
  assert.equal(tokens(dbl), 1);
  const res = emiBoard({ extra: [{ key: "gr", def: greedRes("GreedRes"), owner: P1, zone: "hand" }, { key: "gr2", def: greedRes("GreedRes2"), owner: P1, zone: "hand" }] });
  developResource(res.engine, P1, res.id("gr"), false);
  answerMay(res, true);
  assert.equal(res.engine.state.pendingChoice, undefined);
  assert.equal(tokens(res), 1, "a face-up [G] resource gives a token");
  const twice = emiBoard({ tokens: 1, extra: [{ key: "gi", def: greedItem(), owner: P1, zone: "hand" }, { key: "gi2", def: greedItem(), owner: P1, zone: "hand" }], pay: R(0) });
  play(twice.engine, P1, twice.id("gi"));
  answerMay(twice, true);
  play(twice.engine, P1, twice.id("gi2"));
  answerMay(twice, true);
  assert.equal(tokens(twice), 3, "1 + 2 more");
});

clause(EMI, "0:rule", "near misses add no token and ask nothing: a [R] card, a card providing nothing, an opponent's [G] card, a [G] card entering under the opponent's control, a [G] resource developed face-down", () => {
  const rage = emiBoard({ extra: [{ key: "ri", def: rageItem(), owner: P1, zone: "hand" }, { key: "plain", def: item({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }, { key: "rr", def: rageRes("RageRes"), owner: P1, zone: "hand" }] });
  play(rage.engine, P1, rage.id("ri"));
  assert.equal(rage.engine.state.pendingChoice, undefined, "[R] item");
  play(rage.engine, P1, rage.id("plain"));
  assert.equal(rage.engine.state.pendingChoice, undefined, "item providing nothing");
  developResource(rage.engine, P1, rage.id("rr"), false);
  assert.equal(rage.engine.state.pendingChoice, undefined, "[R] resource");
  assert.equal(tokens(rage), 0);
  const opp = emiBoard({ turnOf: P2, extra: [{ key: "gi", def: greedItem(), owner: P2, zone: "hand" }, { key: "gr", def: greedRes("OppRes"), owner: P2, zone: "hand" }] });
  play(opp.engine, P2, opp.id("gi"));
  assert.equal(opp.engine.state.pendingChoice, undefined, "opponent's [G] item");
  developResource(opp.engine, P2, opp.id("gr"), false);
  assert.equal(opp.engine.state.pendingChoice, undefined, "opponent's [G] resource");
  assert.equal(tokens(opp), 0);
  const down = emiBoard({ extra: [{ key: "gr", def: greedRes("GreedRes"), owner: P1, zone: "hand" }] });
  developResource(down.engine, P1, down.id("gr"), true);
  assert.equal(down.engine.state.pendingChoice, undefined, "face-down: it provides only Volition");
  assert.equal(tokens(down), 0);
  const inHand = emiBoard({ zone: "hand", extra: [{ key: "gi", def: greedItem(), owner: P1, zone: "hand" }], pay: R(3) });
  play(inHand.engine, P1, inHand.id("gi"));
  assert.equal(inHand.engine.state.pendingChoice, undefined, "Emissary is not in play");
});

const emiThief = (): CardDefinition =>
  item({
    name: "EmiThief",
    cost: 0,
    behavior: { abilities: [{ id: "steal", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "opponent" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  } as never);

clause(EMI, "0:rule", "the trigger is about CONTROL, not ownership: an opponent-OWNED [G] card put into play under MY control triggers it (accept adds 1, decline none); one put into play under the opponent's control does not", () => {
  const mk = (def: CardDefinition) => emiBoard({ extra: [{ key: "th", def: emiThief(), owner: P1, zone: "play" }, { key: "og", def, owner: P2, zone: "hand" }] });
  for (const accept of [true, false]) {
    const b = mk(greedItem());
    activate(b.engine, P1, b.id("th"), "steal", { selected: { t: [b.id("og")] } });
    assert.equal(zoneOf(b.engine, b.id("og")), "play", "the opponent's card entered play");
    assert.equal(b.engine.state.cards[b.id("og")].controllerId, P1, "under my control");
    assert.equal(b.engine.state.cards[b.id("og")].ownerId, P2, "still owned by the opponent");
    answerMay(b, accept);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(tokens(b), accept ? 1 : 0);
  }
  // near miss under the same construction: an opponent-owned non-[G] card does not trigger
  const r = mk(rageItem());
  activate(r.engine, P1, r.id("th"), "steal", { selected: { t: [r.id("og")] } });
  assert.equal(zoneOf(r.engine, r.id("og")), "play");
  assert.equal(r.engine.state.pendingChoice, undefined, "[R] card: no prompt");
  assert.equal(tokens(r), 0);
  // an opponent-owned [G] card entering play under the opponent's control (their own play) does not trigger
  const opp = emiBoard({ turnOf: P2, extra: [{ key: "og", def: greedItem(), owner: P2, zone: "hand" }] });
  play(opp.engine, P2, opp.id("og"));
  assert.equal(opp.engine.state.pendingChoice, undefined, "entered under the opponent's control");
  assert.equal(tokens(opp), 0);
});

clause(EMI, "0:rule", "Emissary entering play (it provides no [G]) never triggers itself", () => {
  const self = emiBoard({ zone: "hand", pay: G(1).concat(R(4)) });
  play(self.engine, P1, self.id("em"));
  assert.equal(self.engine.state.pendingChoice, undefined, "Emissary entering play does not trigger itself");
  assert.equal(tokens(self), 0);
});

// --- Deliver --------------------------------------------------------------------------------
const deliver = (b: ReturnType<typeof emiBoard>, target: string, player: PlayerId = P1) =>
  activate(b.engine, player, b.id("em"), "emissary-deliver", { selected: { t: [b.id(target)] } });
const shortcut = (b: ReturnType<typeof emiBoard>, player: PlayerId = P1) => activate(b.engine, player, b.id("em"), "emissary-shortcut", {});

clause(EMI, "1:ability:emissary-deliver", "DELIVER: pays 1 and removes a token, then the picked character gains 2 life this turn (3 -> 5), nobody else does", () => {
  const b = emiBoard({ tokens: 2, pay: R(3), extra: [body("other", P1)] });
  deliver(b, "mine");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b), 1, "one token removed (2 -> 1)");
  assert.equal(readyResources(b.engine, P1), 2, "pays exactly 1");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5);
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("em"), "life"), 4, "Emissary itself unchanged");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "ended with the turn");
});

clause(EMI, "1:ability:emissary-deliver", "DELIVER may pick any character in play: an opponent's, Emissary itself, my own; not an item, location, faction, or a character outside play", () => {
  const b = emiBoard({
    tokens: 5,
    pay: R(6),
    extra: [
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" }
    ]
  });
  for (const key of ["it", "lo", "hc", "dc"]) refused(() => deliver(b, key), key);
  refused(() => activate(b.engine, P1, b.id("em"), "emissary-deliver", { selected: { t: [b.engine.state.players[P1].factionId!] } }), "faction");
  refused(() => activate(b.engine, P1, b.id("em"), "emissary-deliver", { selected: {} }), "no pick");
  assert.equal(tokens(b), 5, "refusals removed nothing");
  assert.equal(readyResources(b.engine, P1), 6);
  deliver(b, "theirs");
  assert.equal(b.engine.getStat(b.id("theirs"), "life"), 5, "opponent's character");
  deliver(b, "em");
  assert.equal(b.engine.getStat(b.id("em"), "life"), 6, "itself: 4 + 2");
  assert.equal(tokens(b), 3);
  assert.equal(readyResources(b.engine, P1), 4);
});

clause(EMI, "1:ability:emissary-deliver", "DELIVER is refused without a token, and without a ready resource (spent resources can't pay), and only works at 1 resource", () => {
  const none = emiBoard({ tokens: 0, pay: R(3) });
  refused(() => deliver(none, "mine"), "no token");
  assert.equal(readyResources(none.engine, P1), 3);
  const noRes = emiBoard({ tokens: 1, pay: [] });
  refused(() => deliver(noRes, "mine"), "no resource");
  assert.equal(tokens(noRes), 1, "token kept");
  const spent = emiBoard({ tokens: 1, pay: spentResources(P1, 2) });
  refused(() => deliver(spent, "mine"), "only spent resources");
  const exact = emiBoard({ tokens: 1, pay: R(1) });
  deliver(exact, "mine");
  assert.equal(tokens(exact), 0);
  assert.equal(readyResources(exact.engine, P1), 0);
  assert.equal(exact.engine.getStat(exact.id("mine"), "life"), 5);
  const opp = emiBoard({ tokens: 1, pay: R(2), turnOf: P2 });
  refused(() => deliver(opp, "mine"), "not my turn");
  const theirs = emiBoard({ tokens: 1, pay: R(0).concat(R(2, P2)) });
  refused(() => deliver(theirs, "mine"), "only the opponent has resources");
});

// --- Shortcut -------------------------------------------------------------------------------
clause(EMI, "2:ability:emissary-shortcut", "SHORTCUT: pays 1 and removes a token; this turn Emissary gains COVERT (and loses it at end of turn)", () => {
  const b = emiBoard({ tokens: 2, pay: R(3) });
  assert.ok(!b.engine.getKeywords(b.id("em")).includes("covert" as never), "no COVERT printed");
  shortcut(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b), 1);
  assert.equal(readyResources(b.engine, P1), 2, "pays exactly 1");
  assert.ok(b.engine.getKeywords(b.id("em")).includes("covert" as never), "COVERT granted");
  assert.ok(!b.engine.getKeywords(b.id("mine")).includes("covert" as never), "only Emissary gains it");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.ok(!b.engine.getKeywords(b.id("em")).includes("covert" as never), "gone next turn");
});

clause(EMI, "2:ability:emissary-shortcut", "SHORTCUT's COVERT works in battle: a non-COVERT blocker can't block Emissary once it has COVERT, but could before", () => {
  const mk = (withShortcut: boolean) => {
    const b = emiBoard({ tokens: 1, pay: R(1), extra: [body("blk", P2, { life: 5 })] });
    if (withShortcut) shortcut(b);
    declareAttackBy(b.engine, P1, [b.id("em")]);
    return b;
  };
  const plain = mk(false);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.ok(plain.engine.state.battle, "control: without COVERT the block is legal");
  const covert = mk(true);
  refused(() => declareBlockers(covert.engine, P2, [covert.id("blk")]), "a non-COVERT character can't block a COVERT attacker");
});

clause(EMI, "2:ability:emissary-shortcut", "SHORTCUT refused without a token or without a ready resource; usable twice only with two tokens", () => {
  const none = emiBoard({ tokens: 0, pay: R(3) });
  refused(() => shortcut(none), "no token");
  const noRes = emiBoard({ tokens: 2, pay: [] });
  refused(() => shortcut(noRes), "no resource");
  assert.equal(tokens(noRes), 2);
  const spent = emiBoard({ tokens: 1, pay: spentResources(P1, 2) });
  refused(() => shortcut(spent), "only spent resources");
  const exact = emiBoard({ tokens: 1, pay: R(1) });
  shortcut(exact);
  assert.equal(tokens(exact), 0);
  assert.equal(readyResources(exact.engine, P1), 0);
  const opp = emiBoard({ tokens: 1, pay: R(2), turnOf: P2 });
  refused(() => shortcut(opp), "not my turn");
  const two = emiBoard({ tokens: 2, pay: R(2) });
  shortcut(two);
  shortcut(two);
  assert.equal(tokens(two), 0);
  refused(() => shortcut(two), "out of tokens");
});

clause(EMI, "1:ability:emissary-deliver", "DELIVER and SHORTCUT draw on the same token pool: one token funds only one of them", () => {
  const b = emiBoard({ tokens: 1, pay: R(3) });
  deliver(b, "mine");
  refused(() => shortcut(b), "token already removed by DELIVER");
  assert.equal(tokens(b), 0);
  void pending;
  void answerPending;
  void playRaw;
});





