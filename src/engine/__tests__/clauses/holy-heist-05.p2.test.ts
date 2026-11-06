// Clause tests: batch holy-heist-05, part p2 (groups 6-11).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, P1, P2, play, resourceCard, tactic } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, fight, playRaw, battleOf } from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf, readyResources } from "./_board.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { attachedCount, developResource, endTurn, factionOf, spentResources } from "./_turn.js";
import { printedStats } from "./_printed.js";
import { resolvePendingResponses } from "../per-card/_harness.js";

const SM = "7a303331-f7dd-4abc-b223-ef0b033db6b9"; // Subdermal Micromajig, tactic, cost 1, eee
const SD = "96441eaf-5037-4ffd-ae17-bdae465688cf"; // Surprising Dudes, tactic, cost 4, ee
const TF5 = "9adb9f40-de34-4ce7-8e43-6fd2845a4757"; // T Force 5 MegaManlyMajig, cost 8, eee, 8/3/6
const TO = "19c7a8ca-f41e-400a-9326-99404465a5c2"; // Thabbashite Organist, cost 3, e, 1/1/1
const UM = "f6c1b927-e75b-48af-a84b-b46d7da78f21"; // Unstable Modification, tactic, cost 1, e
const VL = "73d21c09-6bd0-4df5-9cae-72a34f702c43"; // Visible Loaf, item, cost 2, ee

type Board = ReturnType<typeof buildGame>;
const damageOf = (b: Board, key: string) => b.engine.state.cards[b.id(key)].damage ?? 0;
const inPlay = (b: Board, key: string) => b.engine.state.cards[b.id(key)]?.zone === "play";
const tokensOf = (b: Board, player: string) =>
  Object.values(b.engine.state.cards).filter(
    (c) => c.zone === "play" && c.controllerId === player && c.isToken && b.engine.getDefinition(c.id).name === "Micromajig"
  );
const attachedIds = (b: Board, player: string) =>
  b.engine.state.players[player].play.filter((cid) => b.engine.isResource(cid) && b.engine.state.cards[cid].attachedTo === b.engine.state.players[player].factionId);

// ============================================================================
// Subdermal Micromajig
// ============================================================================
function smBoard(over: { elitism?: number; extra?: CardPlacement[]; token?: boolean } = {}): Board {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(SM), owner: P1, zone: "hand" },
      { key: "tok", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "Raider One" }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "Raider Two" }), owner: P2, zone: "play" },
      { key: "by", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("elitism", over.elitism ?? 4, P1),
      ...(over.extra ?? [])
    ]
  });
  if (over.token !== false) b.engine.state.cards[b.id("tok")].isToken = true;
  return b;
}
const smSel = (b: Board, over: { p?: string[]; tok?: string[] } = {}) => ({
  p: over.p ?? [factionOf(b.engine, P2)],
  tok: over.tok ?? [b.id("tok")]
});
/** P2 attacks with `attackers`, P1 casts Subdermal Micromajig in the declaration window. */
function smCast(b: Board, attackers: string[], over: { p?: string[]; tok?: string[] } = {}): void {
  declareAttackOpenWindow(b.engine, P2, attackers.map((k) => b.id(k)));
  play(b.engine, P1, b.id("sm"), { selected: smSel(b, over) });
}

clause(SM, "0:extraCost", "Pick an opponent: the target must be the opponent's faction, never your own faction or nothing", () => {
  const ok = smBoard();
  smCast(ok, ["a1"]);
  answerPending(ok.engine, "chooserSelectsTarget", { selected: [ok.id("a1")] });
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "discard", "control: with the opponent picked the tactic resolves");

  const own = smBoard();
  declareAttackOpenWindow(own.engine, P2, [own.id("a1")]);
  refused(() => play(own.engine, P1, own.id("sm"), { selected: smSel(own, { p: [factionOf(own.engine, P1)] }) }), "picking yourself instead of an opponent");
  const none = smBoard();
  declareAttackOpenWindow(none.engine, P2, [none.id("a1")]);
  refused(() => play(none.engine, P1, none.id("sm"), { selected: { tok: [none.id("tok")] } }), "no opponent picked");
});

clause(SM, "0:extraCost", "Destroy a Micromajig token you control: the token is destroyed as part of the cost, and the 1 cost is paid", () => {
  const b = smBoard();
  declareAttackOpenWindow(b.engine, P2, [b.id("a1")]);
  const before = readyResources(b.engine, P1);
  playRaw(b.engine, P1, b.id("sm"), { selected: smSel(b) });
  assert.equal(inPlay(b, "tok"), false, "the token was destroyed as a cost, while the tactic still waits");
  assert.equal(inPlay(b, "mine"), true, "no other P1 character is destroyed");
  assert.equal(inPlay(b, "a1"), true, "the attacker is not yet destroyed while the tactic waits for responses");
  resolvePendingResponses(b.engine);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("a1")] });
  assert.equal(before - readyResources(b.engine, P1), 1, "cost 1 paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SM, "0:extraCost", "needs a Micromajig token you control: no token / the opponent's token / a non-Micromajig character / no token selected are refused", () => {
  const ok = smBoard();
  declareAttackOpenWindow(ok.engine, P2, [ok.id("a1")]);
  play(ok.engine, P1, ok.id("sm"), { selected: smSel(ok) });
  assert.equal(inPlay(ok, "tok"), false, "control: with a token it is playable");

  // No token selected at all.
  const noSel = smBoard();
  declareAttackOpenWindow(noSel.engine, P2, [noSel.id("a1")]);
  refused(() => play(noSel.engine, P1, noSel.id("sm"), { selected: { p: [factionOf(noSel.engine, P2)] } }), "no token selected for the cost");

  // No token in play: the only Micromajig-named character is... absent; remove the token.
  const none = smBoard({ token: false });
  none.engine.state.cards[none.id("tok")].zone = "discard" as never;
  none.engine.state.players[P1].play = none.engine.state.players[P1].play.filter((c) => c !== none.id("tok"));
  none.engine.state.players[P1].discard.push(none.id("tok"));
  declareAttackOpenWindow(none.engine, P2, [none.id("a1")]);
  refused(() => play(none.engine, P1, none.id("sm"), { selected: smSel(none) }), "no Micromajig token in play");

  // A non-Micromajig character you control.
  const wrong = smBoard();
  declareAttackOpenWindow(wrong.engine, P2, [wrong.id("a1")]);
  refused(() => play(wrong.engine, P1, wrong.id("sm"), { selected: smSel(wrong, { tok: [wrong.id("mine")] }) }), "a non-Micromajig character is an illegal pick for the token cost", /Illegal target/);

  // An opponent-controlled Micromajig token.
  const theirs = smBoard({
    extra: [{ key: "theirTok", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P2, zone: "play" }]
  });
  theirs.engine.state.cards[theirs.id("theirTok")].isToken = true;
  theirs.engine.state.cards[theirs.id("tok")].zone = "discard" as never;
  theirs.engine.state.players[P1].play = theirs.engine.state.players[P1].play.filter((c) => c !== theirs.id("tok"));
  declareAttackOpenWindow(theirs.engine, P2, [theirs.id("a1")]);
  refused(() => play(theirs.engine, P1, theirs.id("sm"), { selected: smSel(theirs, { tok: [theirs.id("theirTok")] }) }), "the opponent's Micromajig token is not one you control");
});

clause(SM, "0:extraCost", "a non-token character that merely has the name Micromajig cannot pay the cost", () => {
  const b = smBoard({ token: false }); // "tok" is a plain character card named Micromajig, not a token
  declareAttackOpenWindow(b.engine, P2, [b.id("a1")]);
  refused(() => play(b.engine, P1, b.id("sm"), { selected: smSel(b) }), "a card (not a token) named Micromajig is not a Micromajig token");
});

clause(SM, "0:extraCost", "costs 1 and threshold eee: refused without enough elitism or with other icons", () => {
  const ok = smBoard({ elitism: 3 });
  declareAttackOpenWindow(ok.engine, P2, [ok.id("a1")]);
  play(ok.engine, P1, ok.id("sm"), { selected: smSel(ok) });
  answerPending(ok.engine, "chooserSelectsTarget", { selected: [ok.id("a1")] });
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "discard", "control: 3 elitism is enough (cost 1, eee)");

  const two = smBoard({ elitism: 2 });
  declareAttackOpenWindow(two.engine, P2, [two.id("a1")]);
  refused(() => play(two.engine, P1, two.id("sm"), { selected: smSel(two) }), "only eE: below threshold eee");

  const rage = smBoard({ elitism: 0, extra: bank("rage", 5, P1) });
  declareAttackOpenWindow(rage.engine, P2, [rage.id("a1")]);
  refused(() => play(rage.engine, P1, rage.id("sm"), { selected: smSel(rage) }), "plenty of resources but the wrong icons");
});

clause(SM, "1:rule", "destroys the attacking character, and its controller puts a Micromajig token into play under their control", () => {
  const b = smBoard();
  smCast(b, ["a1"]);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the caster chooses the attacking character");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("a1")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "the attacker is destroyed");
  assert.equal(b.engine.state.players[P2].discard.includes(b.id("a1")), true);
  assert.equal(inPlay(b, "by"), true, "the non-attacking character is not destroyed");
  assert.equal(inPlay(b, "mine"), true);
  const theirs = tokensOf(b, P2);
  assert.equal(theirs.length, 1, "that player puts exactly one Micromajig token into play");
  assert.equal(theirs[0].controllerId, P2);
  assert.equal(tokensOf(b, P1).length, 0, "the caster gets no token (and their own token was spent on the cost)");
});

clause(SM, "1:rule", "with two attackers, only the chosen attacker is destroyed; a non-attacking character cannot be chosen", () => {
  const b = smBoard();
  smCast(b, ["a1", "a2"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("by")] } } as never),
    "a character that is not attacking cannot be the destroyed one"
  );
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("a2")] });
  assert.equal(zoneOf(b.engine, b.id("a2")), "discard", "the chosen attacker is destroyed");
  assert.equal(inPlay(b, "a1"), true, "the other attacker is untouched");
  assert.equal(inPlay(b, "by"), true);
  assert.equal(tokensOf(b, P2).length, 1, "one token only");
});

clause(SM, "1:rule", "an attacking character controlled by the caster is not destroyed (only the picked player's attackers)", () => {
  const b = smBoard();
  b.engine.state.activePlayerId = P1 as never;
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("mine")], target: { type: "faction", playerId: P2 } });
  play(b.engine, P1, b.id("sm"), { selected: smSel(b) });
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(inPlay(b, "mine"), true, "my own attacker survives");
  assert.equal(inPlay(b, "a1"), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SM, "1:rule", "with no attacking character of that player nothing is destroyed", () => {
  const b = smBoard();
  b.engine.state.activePlayerId = P1 as never;
  play(b.engine, P1, b.id("sm"), { selected: smSel(b) });
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  for (const k of ["a1", "a2", "by", "mine"]) assert.equal(inPlay(b, k), true, `${k} survives: nothing is attacking`);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// Literal reading: the second sentence ("That player puts a Micromajig token into play") does not depend on the first
// one having destroyed anything, so the picked player still gets the token when they have no attacking character.
clause(SM, "1:rule", "with no attacking character of that player, that player still puts a Micromajig token into play under their control", () => {
  const b = smBoard();
  b.engine.state.activePlayerId = P1 as never;
  assert.equal(tokensOf(b, P2).length, 0, "before: the opponent has no token");
  play(b.engine, P1, b.id("sm"), { selected: smSel(b) });
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["a1", "a2", "by", "mine"]) assert.equal(inPlay(b, k), true, `${k} survives: nothing is attacking`);
  const theirs = tokensOf(b, P2);
  assert.equal(theirs.length, 1, "the picked player still puts exactly one Micromajig token into play");
  assert.equal(theirs[0].controllerId, P2);
  assert.equal(tokensOf(b, P1).length, 0, "the caster gets no token (their own was destroyed for the cost)");
});

clause(SM, "1:rule", "the token is a character named Micromajig with 1 strength, 1 life, 3 speed and subtype majig", () => {
  const b = smBoard();
  smCast(b, ["a1"]);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("a1")] });
  const t = tokensOf(b, P2)[0];
  const def = b.engine.getDefinition(t.id);
  assert.equal(def.name, "Micromajig");
  assert.equal(def.type, "character");
  assert.deepEqual(def.subtype, ["majig"]);
  assert.equal(b.engine.getStat(t.id, "strength"), 1);
  assert.equal(b.engine.getStat(t.id, "life"), 1);
  assert.equal(b.engine.getStat(t.id, "speed"), 3);
});

clause(SM, "1:rule", "the token is a Gearsmith character card", () => {
  const b = smBoard();
  smCast(b, ["a1"]);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("a1")] });
  assert.equal(b.engine.getDefinition(tokensOf(b, P2)[0].id).trade, "gearsmith");
});

function smFlipBoard(over: { elitism?: number; rage?: number } = {}): Board {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SM), owner: P1, zone: "play", faceDown: true },
      { key: "tok", def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
      ...fillers("dk", 4, P1, "deck"),
      ...fillers("odk", 3, P2, "deck"),
      ...bank("elitism", over.elitism ?? 2, P1),
      ...(over.rage ? bank("rage", over.rage, P1) : [])
    ]
  });
  b.engine.state.cards[b.id("tok")].isToken = true;
  return b;
}
const flip = (b: Board, selected: Record<string, string[]>) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("sm"), selected });
/** The selections a FLIP UP of this card demands: it is played as though from the hand, so its regular extra costs (pick an opponent, destroy a Micromajig token) still apply (CR 507.4a / 507.4c; finding holy-heist-05-p2-3). */
const demanded = (b: Board) => ({ p: [factionOf(b.engine, P2)], tok: [b.id("tok")] });

clause(SM, "2:flipUp", "FLIP UP is playing the card as though from the hand (CR 507.4a), so its regular extra costs (pick an opponent, destroy a Micromajig token) still apply on top of '2 [E][E]'", () => {
  const refusedNoPick = smFlipBoard({ elitism: 2 });
  refused(() => flip(refusedNoPick, {}), "the extra cost pick is missing", /Target 'p' requires/);
  assert.equal(refusedNoPick.engine.state.cards[refusedNoPick.id("sm")].faceDown, true, "still face-down after the refusal");
  assert.equal(inPlay(refusedNoPick, "tok"), true, "nothing was paid");
  const b = smFlipBoard({ elitism: 2 });
  flip(b, demanded(b));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("sm")].faceDown, false, "turned face up");
  assert.equal(inPlay(b, "tok"), false, "the regular extra cost destroys a Micromajig token you control");
});

clause(SM, "2:flipUp", "FLIP UP for 2 [E][E] turns it face up, spends exactly 2 resources and draws exactly one card (the top one)", () => {
  const b = smFlipBoard({ elitism: 3 });
  const top = b.engine.state.players[P1].deck[0];
  const handBefore = b.engine.state.players[P1].hand.length;
  const deckBefore = b.engine.state.players[P1].deck.length;
  flip(b, demanded(b));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("sm")].faceDown, false, "turned face up");
  assert.equal(attachedCount(b.engine, P1), 2, "exactly 2 resources were spent");
  assert.equal(b.engine.state.players[P1].hand.length - handBefore, 1, "draws one card");
  assert.equal(deckBefore - b.engine.state.players[P1].deck.length, 1);
  assert.equal(b.engine.state.players[P1].hand.includes(top), true, "the top card is the one drawn");
  assert.equal(b.engine.state.players[P2].hand.length, 0, "the opponent draws nothing");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SM, "2:flipUp", "FLIP UP is refused with only 1 resource, and with 3 resources of the wrong icons", () => {
  const ok = smFlipBoard();
  flip(ok, demanded(ok));
  assert.equal(ok.engine.state.cards[ok.id("sm")].faceDown, false, "control: 2 elitism flips it");

  const short = smFlipBoard({ elitism: 1 });
  refused(() => flip(short, demanded(short)), "one elitism: below cost 2 and threshold ee");
  assert.equal(short.engine.state.cards[short.id("sm")].faceDown, true);

  const wrong = smFlipBoard({ elitism: 0, rage: 3 });
  refused(() => flip(wrong, demanded(wrong)), "3 rage meets the cost but not the ee threshold");
  assert.equal(wrong.engine.state.cards[wrong.id("sm")].faceDown, true);
  assert.equal(wrong.engine.state.players[P1].hand.length, 0, "no card drawn on a refused flip");
});

// ============================================================================
// Surprising Dudes
// ============================================================================
function sdDef(withCondition: boolean) {
  const d = structuredClone(printing(SD));
  if (!withCondition) {
    delete (d.behavior!.abilities![0] as { condition?: unknown }).condition;
    d.id = "sd-control";
  }
  return d;
}
function sdBoard(over: { elitism?: number; active?: string; def?: ReturnType<typeof sdDef>; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: over.active ?? P1,
    cards: [
      { key: "sd", def: over.def ?? printing(SD), owner: P1, zone: "hand" },
      { key: "raider", def: character({ name: "Raider" }), owner: P2, zone: "play" },
      ...bank("elitism", over.elitism ?? 6, P1),
      ...(over.extra ?? [])
    ]
  });
}

clause(SD, "0:extraCost", "can be deployed during your own turn", () => {
  const b = sdBoard();
  play(b.engine, P1, b.id("sd"), {});
  assert.equal(tokensOf(b, P1).length, 2);
});

clause(SD, "0:extraCost", "cannot be deployed during the opponent's turn (even in a response window where the same tactic without the restriction can)", () => {
  const ctrl = sdBoard({ active: P2, def: sdDef(false) });
  declareAttackOpenWindow(ctrl.engine, P2, [ctrl.id("raider")]);
  play(ctrl.engine, P1, ctrl.id("sd"), {});
  assert.equal(tokensOf(ctrl, P1).length, 2, "control: an identical tactic with no turn restriction is playable in this window");

  const b = sdBoard({ active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("raider")]);
  refused(() => play(b.engine, P1, b.id("sd"), {}), "Deploy this only during your turn");
  assert.equal(zoneOf(b.engine, b.id("sd")), "hand");
  assert.equal(tokensOf(b, P1).length, 0);
});

clause(SD, "1:rule", "puts exactly 2 Micromajig tokens (1/1/3 majig characters) into play under your control, none for the opponent", () => {
  const b = sdBoard();
  play(b.engine, P1, b.id("sd"), {});
  const mine = tokensOf(b, P1);
  assert.equal(mine.length, 2);
  assert.equal(tokensOf(b, P2).length, 0);
  for (const t of mine) {
    const def = b.engine.getDefinition(t.id);
    assert.equal(def.type, "character");
    assert.deepEqual(def.subtype, ["majig"]);
    assert.equal(b.engine.getStat(t.id, "strength"), 1);
    assert.equal(b.engine.getStat(t.id, "life"), 1);
    assert.equal(b.engine.getStat(t.id, "speed"), 3);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SD, "1:rule", "the tokens are Gearsmith character cards", () => {
  const b = sdBoard();
  play(b.engine, P1, b.id("sd"), {});
  for (const t of tokensOf(b, P1)) assert.equal(b.engine.getDefinition(t.id).trade, "gearsmith");
});

clause(SD, "1:rule", "this card goes into play under its owner's control as a face-down resource, not into the discard pile", () => {
  const b = sdBoard();
  play(b.engine, P1, b.id("sd"), {});
  const c = b.engine.state.cards[b.id("sd")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.equal(b.engine.isResource(b.id("sd")), true, "it is a resource");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("sd")), false, "not in the discard pile");
  assert.equal(b.engine.state.players[P1].play.includes(b.id("sd")), true);
  assert.equal(readyResources(b.engine, P1), 3, "6 resources - 4 paid + the new face-down resource");
});

/** SD owned by `owner`, currently controlled (and played) by `controller`, who has the 6 resources. */
function sdOwnedBy(owner: string, controller: string): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: controller,
    cards: [
      { key: "sd", def: printing(SD), owner, controller, zone: "hand" },
      ...bank("elitism", 6, controller)
    ]
  });
}

for (const [owner, controller] of [[P1, P2], [P2, P1]] as const) {
  clause(SD, "1:rule", `owner ${owner} / controller ${controller}: the tokens go to the player who plays it, the card itself becomes a face-down resource under its OWNER's control`, () => {
    const b = sdOwnedBy(owner, controller);
    const c0 = b.engine.state.cards[b.id("sd")];
    assert.equal(c0.ownerId, owner, "setup: owner");
    assert.equal(c0.controllerId, controller, "setup: controller");
    play(b.engine, controller, b.id("sd"), {});
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(tokensOf(b, controller).length, 2, "'put 2 Micromajig tokens into play under YOUR control': the player who played it");
    assert.equal(tokensOf(b, owner).length, 0, "the owner gets no tokens");
    const c = b.engine.state.cards[b.id("sd")];
    assert.equal(c.zone, "play");
    assert.equal(c.faceDown, true);
    assert.equal(c.ownerId, owner);
    assert.equal(c.controllerId, owner, "put into play under its OWNER's control");
    assert.equal(b.engine.isResource(b.id("sd")), true);
    assert.equal(b.engine.state.players[owner].play.includes(b.id("sd")), true, "it is in the owner's play area");
    assert.equal(b.engine.state.players[controller].play.includes(b.id("sd")), false, "not in the player-who-cast-it's play area");
    assert.equal(b.engine.state.players[owner].discard.includes(b.id("sd")), false);
    assert.equal(b.engine.state.players[controller].discard.includes(b.id("sd")), false);
    assert.equal(readyResources(b.engine, owner), 1, "the owner now has the new face-down resource to spend");
    assert.equal(readyResources(b.engine, controller), 2, "the caster paid 4 of 6 and got no new resource");
  });
}

clause(SD, "1:rule", "costs 4 with threshold ee: refused with 3 resources and with wrong icons", () => {
  const ok = sdBoard({ elitism: 4 });
  play(ok.engine, P1, ok.id("sd"), {});
  assert.equal(attachedCount(ok.engine, P1), 4, "control: 4 elitism pays exactly 4");

  const short = sdBoard({ elitism: 3 });
  refused(() => play(short.engine, P1, short.id("sd"), {}), "3 resources for a cost-4 card");
  const wrong = sdBoard({ elitism: 0, extra: bank("rage", 6, P1) });
  refused(() => play(wrong.engine, P1, wrong.id("sd"), {}), "6 rage does not meet ee");
  const oneE = sdBoard({ elitism: 1, extra: bank("rage", 5, P1) });
  refused(() => play(oneE.engine, P1, oneE.id("sd"), {}), "one elitism of the two required (ee)");
});

// ============================================================================
// T Force 5 MegaManlyMajig
// ============================================================================
function tfBoard(over: { elitism?: number; extra?: CardPlacement[]; inPlayTF?: boolean } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tf", def: printing(TF5), owner: P1, zone: "hand" },
      ...bank("elitism", over.elitism ?? 8, P1),
      ...(over.extra ?? [])
    ]
  });
}

clause(TF5, "0:rule", "deploys for its printed cost 8 / eee and has 8 strength, 3 speed, 6 life, subtypes t force 5 and majig", () => {
  const b = tfBoard();
  play(b.engine, P1, b.id("tf"), {});
  if (pending(b.engine)) answerPending(b.engine, "selectTargets", { selected: { det: [] } });
  assert.equal(zoneOf(b.engine, b.id("tf")), "play");
  assert.equal(b.engine.getStat(b.id("tf"), "strength"), 8);
  assert.equal(b.engine.getStat(b.id("tf"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("tf"), "life"), 6);
  assert.deepEqual(printing(TF5).subtype, ["t force 5", "majig"]);

  const short = tfBoard({ elitism: 7 });
  refused(() => play(short.engine, P1, short.id("tf"), {}), "7 resources for a cost-8 card");
  const wrong = tfBoard({ elitism: 0, extra: bank("rage", 8, P1) });
  refused(() => play(wrong.engine, P1, wrong.id("tf"), {}), "8 rage does not meet eee");
});

clause(TF5, "0:rule", "when it enters play you may detach up to 3 resources from your faction: 3, 2, 1 and 0 are all allowed", () => {
  for (const n of [3, 2, 1, 0]) {
    const b = tfBoard();
    play(b.engine, P1, b.id("tf"), {});
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "selectTargets", `n=${n}: the controller is offered the detach`);
    assert.equal(pc.playerId, P1);
    assert.equal(attachedCount(b.engine, P1), 8, "the 8 spent resources are attached to the faction");
    const chosen = attachedIds(b, P1).slice(0, n);
    answerPending(b.engine, "selectTargets", { selected: { det: chosen } });
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(attachedCount(b.engine, P1), 8 - n, `n=${n}: ${n} resources detached`);
    for (const cid of chosen) {
      assert.equal(b.engine.state.cards[cid].attachedTo === b.engine.state.players[P1].factionId, false, "the chosen resource is detached");
      assert.equal(zoneOf(b.engine, cid), "play", "a detached resource stays in play");
    }
    assert.equal(readyResources(b.engine, P1), n, `n=${n}: detached resources are available again`);
  }
});

clause(TF5, "0:rule", "you cannot detach more than 3, nor resources attached to the opponent's faction", () => {
  const b = tfBoard({ extra: spentResources(P2, 2) });
  play(b.engine, P1, b.id("tf"), {});
  const mine = attachedIds(b, P1);
  assert.equal(mine.length, 8);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { det: mine.slice(0, 4) } } } as never),
    "up to 3 only: 4 is refused"
  );
  const theirs = attachedIds(b, P2);
  assert.equal(theirs.length, 2);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { det: [theirs[0]] } } } as never),
    "resources of the opponent's faction cannot be detached (\"your faction\")"
  );
  answerPending(b.engine, "selectTargets", { selected: { det: mine.slice(0, 3) } });
  assert.equal(attachedCount(b.engine, P1), 5, "control: three of mine detach");
  assert.equal(attachedCount(b.engine, P2), 2, "the opponent's faction keeps its attached resources");
});

clause(TF5, "0:rule", "the trigger is only for this card entering play, not another character entering", () => {
  const b = tfBoard({ elitism: 0, extra: [
    { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
    { key: "tf2", def: printing(TF5), owner: P1, zone: "play" },
    ...spentResources(P1, 3),
    ...bank("elitism", 1, P1)
  ] });
  play(b.engine, P1, b.id("other"), {});
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no detach offer when another card enters");
  assert.equal(attachedCount(b.engine, P1), 4, "nothing was detached (3 earlier + 1 spent)");
});

// ============================================================================
// Thabbashite Organist
// ============================================================================
const vRes = () => resourceCard({ name: "V Source", resource: { provides: ["volition"], staple: false } as never });
function toBoard(over: { organist?: boolean; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(over.organist === false ? [] : [{ key: "to", def: printing(TO), owner: P1, zone: "play" as const }]),
      { key: "fd", def: character({ name: "Facedown Fodder" }), owner: P1, zone: "hand" },
      { key: "rage", def: resourceCard({ name: "Rage Source" }), owner: P1, zone: "hand" },
      { key: "vres", def: vRes(), owner: P1, zone: "hand" },
      { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
      { key: "big2", def: character({ name: "Big Two", cost: 4 }), owner: P1, zone: "hand" },
      { key: "small", def: character({ name: "Small", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("elitism", 8, P1),
      ...(over.extra ?? [])
    ]
  });
}
const costOf = (b: Board, key: string) => b.engine.getCardPlayability(P1, b.id(key)).numericCost;

clause(TO, "0:rule", "a face-down resource (provides [V]) entering play under your control reduces the next card's cost by 1, and the discount is really applied when paying", () => {
  const b = toBoard();
  assert.equal(costOf(b, "big"), 4, "before: full cost");
  developResource(b.engine, P1, b.id("fd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 3, "after: reduced by 1");
  const before = attachedCount(b.engine, P1);
  play(b.engine, P1, b.id("big"), {});
  assert.equal(zoneOf(b.engine, b.id("big")), "play");
  assert.equal(attachedCount(b.engine, P1) - before, 3, "3 resources were actually spent");
});

clause(TO, "0:rule", "a face-up resource card that provides [V] also triggers it", () => {
  const b = toBoard();
  developResource(b.engine, P1, b.id("vres"), false);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("vres")].faceDown, false);
  assert.equal(costOf(b, "big"), 3);
});

clause(TO, "0:rule", "a face-up resource that does not provide [V] does not trigger it", () => {
  const b = toBoard();
  developResource(b.engine, P1, b.id("rage"), false);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("rage")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("rage")), "play");
  assert.equal(costOf(b, "big"), 4, "no reduction");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TO, "0:rule", "without the Organist in play a face-down resource gives no discount (control)", () => {
  const b = toBoard({ organist: false });
  developResource(b.engine, P1, b.id("fd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 4);
});

clause(TO, "0:rule", "only the NEXT card is discounted", () => {
  const b = toBoard();
  developResource(b.engine, P1, b.id("fd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 3);
  play(b.engine, P1, b.id("big"), {});
  assert.equal(costOf(b, "big2"), 4, "the second card costs full price");
});

clause(TO, "0:rule", "an ordinary character (provides nothing) entering play under your control gives no discount", () => {
  const b = toBoard();
  play(b.engine, P1, b.id("small"), {});
  assert.equal(zoneOf(b.engine, b.id("small")), "play");
  assert.equal(costOf(b, "big"), 4);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TO, "0:rule", "a [V] card entering play by an effect (Surprising Dudes becoming a face-down resource) triggers it", () => {
  const b = toBoard({ extra: [{ key: "sd", def: printing(SD), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sd"), {});
  assert.equal(b.engine.state.cards[b.id("sd")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("sd")].zone, "play");
  assert.equal(costOf(b, "big"), 3, "the face-down resource that entered play gave the discount");
});

clause(TO, "0:rule", "a [V] card entering under the OPPONENT's control gives you no discount", () => {
  const b = toBoard({ extra: [{ key: "ofd", def: character({ name: "Opp Fodder" }), owner: P2, zone: "hand" }] });
  b.engine.state.activePlayerId = P2 as never;
  developResource(b.engine, P2, b.id("ofd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("ofd")].zone, "play");
  assert.equal(costOf(b, "big"), 4, "no discount for my next card");
});

clause(TO, "0:rule", "the discount lasts only this turn", () => {
  const b = toBoard();
  developResource(b.engine, P1, b.id("fd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 3);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "back on my next turn");
  assert.equal(costOf(b, "big"), 4, "the discount expired");
});

// Literal reading of "reduce the numeric cost of the next card you play this turn by 1": every trigger reduces the SAME
// next card by 1, so two triggers make it cost 2 less (the card is only "next" once; the reductions add up).
const MCON = "f5d12db2-7bfa-41ae-a99d-0994027c4584"; // Makeshift Contrivance (item, gearsmith, cost 6): Pay 1, deplete: play a resource from your hand

clause(TO, "0:rule", "two Thabbashite Organists in play: one [V] resource entering gives two reductions, so the next card costs 2 less", () => {
  const b = toBoard({ extra: [{ key: "to2", def: printing(TO), owner: P1, zone: "play" }] });
  assert.equal(costOf(b, "big"), 4, "before: full cost");
  developResource(b.engine, P1, b.id("fd"), true);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(costOf(b, "big"), 2, "two Organists triggered: 4 - 1 - 1");
  const before = attachedCount(b.engine, P1);
  play(b.engine, P1, b.id("big"), {});
  assert.equal(zoneOf(b.engine, b.id("big")), "play");
  assert.equal(attachedCount(b.engine, P1) - before, 2, "only 2 resources were actually spent");
  assert.equal(costOf(b, "big2"), 4, "both reductions were used up by that one card");
});

clause(TO, "0:rule", "an OPPONENT's Organist does not trigger on my resource: only my own Organist gives the -1 (control for the stacking test)", () => {
  const b = toBoard({ extra: [{ key: "to2", def: printing(TO), owner: P2, zone: "play" }] });
  developResource(b.engine, P1, b.id("fd"), true);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(costOf(b, "big"), 3, "an OPPONENT's Organist does not trigger on my resource: only my Organist gives -1");
});

clause(TO, "0:rule", "a [V] resource played face-up by a real card's effect (Makeshift Contrivance) after a develop gives a second reduction: next card costs 2 less", () => {
  const b = toBoard({
    extra: [
      { key: "mc", def: printing(MCON), owner: P1, zone: "play" },
      { key: "vres2", def: vRes(), owner: P1, zone: "hand" }
    ]
  });
  developResource(b.engine, P1, b.id("vres"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 3, "after the develop: -1");
  activate(b.engine, P1, b.id("mc"), "deploy", {});
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("vres2")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vres2")), "play", "the second [V] resource entered play under my control");
  assert.equal(costOf(b, "big"), 2, "a second [V] card entered: 4 - 1 - 1");
});

clause(TO, "0:rule", "Makeshift Contrivance's own ability cost is not reduced: the discount is for the next CARD played, not for an ability", () => {
  const b = toBoard({ extra: [{ key: "mc", def: printing(MCON), owner: P1, zone: "play" }] });
  developResource(b.engine, P1, b.id("fd"), true);
  resolvePendingResponses(b.engine);
  assert.equal(costOf(b, "big"), 3);
  const before = attachedCount(b.engine, P1);
  activate(b.engine, P1, b.id("mc"), "deploy", {});
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("rage")] });
  assert.equal(attachedCount(b.engine, P1) - before, 1, "the ability's 'Pay 1' is paid in full");
  assert.equal(costOf(b, "big"), 3, "the reduction is still waiting for the next card");
});

clause(TO, "0:rule", "deploys for its printed cost 3 / e and has 1/1/1", () => {
  const mk = (elitism: number, rage = 0) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "to", def: printing(TO), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)]
    });
  const ok = mk(3);
  play(ok.engine, P1, ok.id("to"), {});
  assert.equal(zoneOf(ok.engine, ok.id("to")), "play");
  assert.equal(ok.engine.getStat(ok.id("to"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("to"), "speed"), 1);
  assert.equal(ok.engine.getStat(ok.id("to"), "life"), 1);
  const short = mk(2);
  refused(() => play(short.engine, P1, short.id("to"), {}), "2 resources for cost 3");
  const wrong = mk(0, 3);
  refused(() => play(wrong.engine, P1, wrong.id("to"), {}), "no elitism for threshold e");
});

// ============================================================================
// Unstable Modification
// ============================================================================
const killer = () =>
  tactic({
    name: "Killer",
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
function umHandBoard(elitism = 1): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "um", def: printing(UM), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      { key: "kill", def: killer(), owner: P1, zone: "hand" },
      ...bank("elitism", elitism, P1)
    ]
  });
}

clause(UM, "0:attach", "is put into play attached to the chosen character (not discarded), costing 1, with no option active yet", () => {
  const b = umHandBoard();
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("um"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("um")), "play");
  assert.equal(b.engine.state.cards[b.id("um")].attachedTo, b.id("host"));
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("um")), false, "not in the discard pile");
  assert.equal(before - readyResources(b.engine, P1), 1, "cost 1 paid");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 2, "no option has been chosen yet");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UM, "0:attach", "can attach to an opponent's character too", () => {
  const b = umHandBoard();
  play(b.engine, P1, b.id("um"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("um")].attachedTo, b.id("foe"));
});

clause(UM, "0:attach", "cannot attach to a non-character (item, faction) or without a host", () => {
  const ok = umHandBoard();
  play(ok.engine, P1, ok.id("um"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("um")), "play", "control");

  const onItem = umHandBoard();
  refused(() => play(onItem.engine, P1, onItem.id("um"), { selected: { attachTo: [onItem.id("itm")] } }), "an item is not a character");
  const onFaction = umHandBoard();
  refused(() => play(onFaction.engine, P1, onFaction.id("um"), { selected: { attachTo: [factionOf(onFaction.engine, P1)] } }), "a faction is not a character");
  const none = umHandBoard();
  refused(() => play(none.engine, P1, none.id("um"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(none.engine, none.id("um")), "hand");
});

clause(UM, "0:attach", "costs 1 with threshold e: refused without elitism", () => {
  const none = umHandBoard(0);
  refused(() => play(none.engine, P1, none.id("um"), { selected: { attachTo: [none.id("host")] } }), "no resources");
  const rage = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "um", def: printing(UM), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  refused(() => play(rage.engine, P1, rage.id("um"), { selected: { attachTo: [rage.id("host")] } }), "rage does not meet threshold e");
});

clause(UM, "0:attach", "when its host leaves play the attached Modification goes to its owner's discard pile", () => {
  const b = umHandBoard(1);
  b.engine.state.cards[b.id("kill")].zone = "hand";
  play(b.engine, P1, b.id("um"), { selected: { attachTo: [b.id("foe")] } });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "host destroyed");
  assert.equal(zoneOf(b.engine, b.id("um")), "discard", "the attachment follows it out of play");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("um")), true, "into its owner's discard pile");
});

function umTurnBoard(over: { activeIsOwner?: boolean } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: over.activeIsOwner ? P1 : P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "um", def: printing(UM), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "cov", def: character({ name: "Covert Raider", behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain Raider" }), owner: P2, zone: "play" }
    ]
  });
}
const chooseOption = (b: Board, index: number) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "its controller chooses");
  answerPending(b.engine, "chooserSelectsOption", { index });
};

clause(UM, "1:rule", "at the start of YOUR turn you are offered the three options; at the opponent's turn start nothing happens", () => {
  const mine = umTurnBoard();
  endTurn(mine.engine, P2); // P1's turn begins
  const pc = pending(mine.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal((pc as unknown as { optionCount: number }).optionCount, 3, "choose one of three");
  chooseOption(mine, 0);

  const theirs = umTurnBoard({ activeIsOwner: true });
  endTurn(theirs.engine, P1); // P2's turn begins
  assert.equal(theirs.engine.state.pendingChoice, undefined, "no prompt at the opponent's turn start");
  assert.equal(theirs.engine.getStat(theirs.id("host"), "strength"), 2);
  assert.equal(theirs.engine.getStat(theirs.id("host"), "life"), 3);
});

clause(UM, "1:rule", "the chosen option lasts until the start of your next turn, then you choose again", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 0); // +1 strength
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  endTurn(b.engine, P1); // opponent's turn
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3, "still active through the opponent's turn");
  endTurn(b.engine, P2); // my next turn: choose again
  chooseOption(b, 1); // +1 life instead
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 2, "the first option ended");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 4, "the new option applies");
});

clause(UM, "2:option:OPTION 1", "OPTION 1: the attached character gains 1 strength (and nothing else changes)", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 0);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3, "life unchanged");
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 1, "speed unchanged");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UM, "2:option:OPTION 1", "OPTION 1 affects only the attached character", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2 }), owner: P1, zone: "play" },
      { key: "um", def: printing(UM), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  endTurn(b.engine, P2);
  chooseOption(b, 0);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2, "an unattached ally is not boosted");
});

clause(UM, "3:option:OPTION 2", "OPTION 2: the attached character gains 1 life (and nothing else changes)", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 1);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 2, "strength unchanged");
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 1);
});

clause(UM, "4:option:OPTION 3", "OPTION 3: the attached (non-covert) character can block a COVERT party", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 2);
  endTurn(b.engine, P1); // opponent's turn, option still active
  declareAttackBy(b.engine, P2, [b.id("cov")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("host")], "blocked a covert party");
});

clause(UM, "4:option:OPTION 3", "without OPTION 3 the same character cannot block a COVERT party (control), and OPTION 3 still lets it block a plain attacker", () => {
  const ctrl = umTurnBoard();
  endTurn(ctrl.engine, P2);
  chooseOption(ctrl, 0);
  endTurn(ctrl.engine, P1);
  declareAttackBy(ctrl.engine, P2, [ctrl.id("cov")]);
  refused(() => ctrl.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [ctrl.id("host")] }), "ordinary character vs covert party");

  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 2);
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("plain")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("host")], "it can still block an ordinary attacker");
});

clause(UM, "4:option:OPTION 3", "OPTION 3 ends at the start of your next turn", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  chooseOption(b, 0); // switch to strength
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("cov")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] }), "OPTION 3 ended with the new choice");
});

// ============================================================================
// Visible Loaf
// ============================================================================
const zap = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }]
    }
  } as never);
function vlBoard(over: { tokens?: number; resources?: number; depleted?: boolean; active?: string } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: over.active ?? P1,
    cards: [
      { key: "vl", def: printing(VL), owner: P1, zone: "play", counters: { token: over.tokens ?? 3 }, depleted: over.depleted },
      { key: "ally", def: character({ name: "Ally", life: 10 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 10, strength: 4 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      { key: "zap1", def: zap("Zap One"), owner: P1, zone: "hand" },
      { key: "zap2", def: zap("Zap Two"), owner: P1, zone: "hand" },
      ...bank("rage", over.resources ?? 5, P1)
    ]
  });
}
const deflect = (b: Board, target: string) => activate(b.engine, P1, b.id("vl"), "visible-loaf-deflect", { selected: { c: [b.id(target)] } });

clause(VL, "0:rule", "enters play with exactly 3 tokens on it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vl", def: printing(VL), owner: P1, zone: "hand" },
      { key: "other", def: item({ name: "Other Item", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("vl"), {});
  assert.equal(zoneOf(b.engine, b.id("vl")), "play");
  assert.equal(tokensOn(b.engine, b.id("vl")), 3);
  play(b.engine, P1, b.id("other"), {});
  assert.equal(tokensOn(b.engine, b.id("vl")), 3, "another item entering adds nothing");
  assert.equal(tokensOn(b.engine, b.id("other")), 0, "and gets no tokens itself");
});

clause(VL, "0:rule", "deploys for its printed cost 2 / ee: refused with 1 resource or without elitism", () => {
  const mk = (elitism: number, rage = 0) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "vl", def: printing(VL), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)]
    });
  const ok = mk(2);
  play(ok.engine, P1, ok.id("vl"), {});
  assert.equal(attachedCount(ok.engine, P1), 2, "cost 2 paid");
  const short = mk(1);
  refused(() => play(short.engine, P1, short.id("vl"), {}), "1 resource for cost 2");
  const wrong = mk(0, 4);
  refused(() => play(wrong.engine, P1, wrong.id("vl"), {}), "rage does not meet ee");
});

clause(VL, "1:ability:visible-loaf-deflect", "COST: pays 3, removes exactly one token and depletes the card", () => {
  const b = vlBoard();
  const before = readyResources(b.engine, P1);
  deflect(b, "ally");
  assert.equal(before - readyResources(b.engine, P1), 3, "Pay 3");
  assert.equal(tokensOn(b.engine, b.id("vl")), 2, "removed one token");
  assert.equal(b.engine.state.cards[b.id("vl")].depleted, true, "deplete");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VL, "1:ability:visible-loaf-deflect", "COST: refused when depleted, with no tokens, with 2 resources, or without a target", () => {
  const ok = vlBoard({ resources: 3 });
  deflect(ok, "ally");
  assert.equal(tokensOn(ok.engine, ok.id("vl")), 2, "control: exactly 3 resources, 3 tokens, ready");

  const dep = vlBoard({ depleted: true });
  refused(() => deflect(dep, "ally"), "already depleted");
  const empty = vlBoard({ tokens: 0 });
  refused(() => deflect(empty, "ally"), "no token to remove");
  const poor = vlBoard({ resources: 2 });
  refused(() => deflect(poor, "ally"), "cannot pay 3");
  assert.equal(tokensOn(poor.engine, poor.id("vl")), 3, "nothing was removed by the failed attempt");
  const noTarget = vlBoard();
  refused(() => activate(noTarget.engine, P1, noTarget.id("vl"), "visible-loaf-deflect", { selected: {} }), "no character picked");
});

clause(VL, "1:ability:visible-loaf-deflect", "COST: the pick must be a character (any controller); an item or a faction is refused", () => {
  const foe = vlBoard();
  deflect(foe, "foe");
  assert.equal(tokensOn(foe.engine, foe.id("vl")), 2, "an opponent's character is a legal pick");

  const onItem = vlBoard();
  refused(() => deflect(onItem, "itm"), "an item is not a character");
  const onFaction = vlBoard();
  refused(() => activate(onFaction.engine, P1, onFaction.id("vl"), "visible-loaf-deflect", { selected: { c: [factionOf(onFaction.engine, P1)] } }), "a faction is not a character");
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: the next damage to the chosen character this turn is reduced to 0", () => {
  const b = vlBoard();
  deflect(b, "ally");
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("ally")] } });
  assert.equal(zoneOf(b.engine, b.id("zap1")), "discard", "the zap resolved");
  assert.equal(damageOf(b, "ally"), 0, "4 damage reduced to 0");
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: only the NEXT damage is prevented; the one after lands", () => {
  const b = vlBoard();
  deflect(b, "ally");
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("ally")] } });
  assert.equal(damageOf(b, "ally"), 0);
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("ally")] } });
  assert.equal(damageOf(b, "ally"), 4, "the second instance is not prevented");
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: other characters are not protected, and the protected one is the chosen one", () => {
  const b = vlBoard();
  deflect(b, "ally");
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("foe")] } });
  assert.equal(damageOf(b, "foe"), 4, "an unchosen character takes the damage");
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("ally")] } });
  assert.equal(damageOf(b, "ally"), 0, "the protection on the chosen character was still waiting");
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: an opponent's character can be the protected one", () => {
  const b = vlBoard();
  deflect(b, "foe");
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("foe")] } });
  assert.equal(damageOf(b, "foe"), 0);
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: also prevents battle damage (the next damage inflicted to it)", () => {
  const b = vlBoard();
  deflect(b, "ally");
  fight(b.engine, P1, [b.id("ally")], { type: "faction", playerId: P2 }, [b.id("foe")]);
  assert.equal(damageOf(b, "ally"), 0, "the 4 battle damage dealt to the protected attacker was reduced to 0");
  assert.equal(damageOf(b, "foe"), 1, "the blocker still took the attacker's 1 damage");
});

clause(VL, "1:ability:visible-loaf-deflect", "EFFECT: 'This turn' - an unused protection is gone next turn", () => {
  const b = vlBoard();
  deflect(b, "ally");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("zap1"), { selected: { t: [b.id("ally")] } });
  assert.equal(damageOf(b, "ally"), 4, "the protection expired with the turn");
});

// ============================================================================
// Gap tests: exact thresholds with padding resources, printed subtypes, option durations
// ============================================================================
function thresholdFrame(printingId: string, cost: number, needE: number): void {
  const mk = (elitism: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)]
    });
  const exact = mk(needE, cost - needE);
  play(exact.engine, P1, exact.id("card"), printingId === TF5 ? { selected: { det: [] } } : {});
  while (pending(exact.engine)) answerPending(exact.engine, pending(exact.engine)!.kind, pending(exact.engine)!.kind === "chooserSelectsTarget" ? { selected: [] } : { index: 0, pay: false });
  assert.equal(zoneOf(exact.engine, exact.id("card")), "play", `exactly ${needE} elitism (+ rage for the rest of the cost ${cost}) is enough`);
  assert.equal(attachedCount(exact.engine, P1), cost, "exactly the printed cost was paid");
  const lacking = mk(needE - 1, cost + 2);
  refused(() => play(lacking.engine, P1, lacking.id("card"), {}), `${needE - 1} elitism do not meet a ${needE}-elitism threshold even with plenty of rage`);
}

clause(SD, "1:rule", "threshold ee is exactly two elitism: 2 elitism + 2 rage pays the cost 4; 1 elitism + 5 rage is refused", () => thresholdFrame(SD, 4, 2));
clause(TF5, "0:rule", "threshold eee is exactly three elitism: 3 elitism + 5 rage pays the cost 8; 2 elitism + 10 rage is refused", () => {
  thresholdFrame(TF5, 8, 3);
});
clause(TO, "0:rule", "threshold e is exactly one elitism: 1 elitism + 2 rage pays the cost 3; 0 elitism + 5 rage is refused; printed subtype monstrosity", () => {
  thresholdFrame(TO, 3, 1);
  const b = toBoard();
  assert.deepEqual(b.engine.getDefinition(b.id("to")).subtype, ["monstrosity"]);
});
clause(VL, "0:rule", "threshold ee is exactly two elitism: 2 elitism pays the cost 2; 1 elitism + 5 rage is refused", () => thresholdFrame(VL, 2, 2));
clause(SM, "0:extraCost", "threshold eee is exactly three elitism: 3 elitism pays the cost 1 (with the token); 2 elitism + 5 rage is refused", () => {
  const ok = smBoard({ elitism: 3 });
  smCast(ok, ["a1"]);
  answerPending(ok.engine, "chooserSelectsTarget", { selected: [ok.id("a1")] });
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "discard", "cast with 3 elitism");
  const lacking = smBoard({ elitism: 2, extra: bank("rage", 5, P1) });
  declareAttackOpenWindow(lacking.engine, P2, [lacking.id("a1")]);
  refused(() => play(lacking.engine, P1, lacking.id("sm"), { selected: smSel(lacking) }), "2 elitism do not meet eee");
});
clause(UM, "0:attach", "threshold e is exactly one elitism: a single elitism pays the cost 1; rage alone is refused", () => {
  const ok = umHandBoard(1);
  play(ok.engine, P1, ok.id("um"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("um")), "play");
  const lacking = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "um", def: printing(UM), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...bank("rage", 5, P1)
    ]
  });
  refused(() => play(lacking.engine, P1, lacking.id("um"), { selected: { attachTo: [lacking.id("host")] } }), "rage cannot meet an elitism threshold");
});

clause(UM, "3:option:OPTION 2", "OPTION 2's +1 life ends at the start of your next turn when you choose another option", () => {
  const b = umTurnBoard();
  endTurn(b.engine, P2);
  chooseOption(b, 1);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 4);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 4, "still active through the opponent's turn");
  endTurn(b.engine, P2);
  chooseOption(b, 0);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3, "the life bonus ended");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3, "and the new option applies");
});

clause(UM, "4:option:OPTION 3", "OPTION 3 only adds 'can block COVERT parties': a host that is itself covert still cannot block a plain party", () => {
  const mk = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      activePlayerId: P2,
      cards: [
        { key: "host", def: character({ name: "Covert Host", behavior: { keywords: ["covert"] } as never }), owner: P1, zone: "play" },
        { key: "um", def: printing(UM), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "cov", def: character({ name: "Covert Raider", behavior: { keywords: ["covert"] } as never }), owner: P2, zone: "play" },
        { key: "plain", def: character({ name: "Plain Raider" }), owner: P2, zone: "play" }
      ]
    });
  const b = mk();
  endTurn(b.engine, P2);
  chooseOption(b, 2);
  endTurn(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("plain")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] }), "a covert character may block only covert parties", /./);
  const c = mk();
  endTurn(c.engine, P2);
  chooseOption(c, 2);
  endTurn(c.engine, P1);
  declareAttackBy(c.engine, P2, [c.id("cov")]);
  c.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [c.id("host")] });
  assert.deepEqual(battleOf(c.engine)?.blockingParty, [c.id("host")], "positive control: it blocks the covert party");
});

// 73ch! (a real Gearsmith tactic) puts a card into play face-down under my control: it is a [V] card entering play.
const TECH = "91d07791-dd91-4862-9345-d06bbc73a06b"; // 73ch! (tactic, gearsmith, cost 4, eee)
clause(TO, "0:rule", "a card 73ch! puts into play face-down (provides [V]) gives the reduction: the next card costs 1 less, and a second 73ch! played after it uses that reduction up (t2 itself is the next card) and gives a fresh one", () => {
  const b = toBoard({
    extra: [
      { key: "t1", def: printing(TECH), owner: P1, zone: "hand" },
      { key: "t2", def: printing(TECH), owner: P1, zone: "hand" },
      { key: "g1", def: character({ name: "Gear One", trade: "gearsmith" } as never), owner: P1, zone: "deck" },
      { key: "g2", def: character({ name: "Gear Two", trade: "gearsmith" } as never), owner: P1, zone: "deck" }
    ]
  });
  play(b.engine, P1, b.id("t1"), { selected: { found: [b.id("g1")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("g1")), "play");
  assert.equal(b.engine.state.cards[b.id("g1")].faceDown, true, "it entered play face-down under my control");
  assert.equal(costOf(b, "big"), 3, "one [V] card entered: 4 - 1");
  // Playing t2 is itself "the next card you play this turn": it consumes the reduction g1 gave (CR 406.5),
  // and g2 entering then gives one new reduction, so "big" is 4 - 1 again, not 4 - 1 - 1.
  play(b.engine, P1, b.id("t2"), { selected: { found: [b.id("g2")] } });
  assert.equal(costOf(b, "big"), 3, "g2 entered: a fresh 4 - 1 (g1's reduction went to t2)");
});

// ============================================================================
// Mutation-pass additions (T3c3)
// ============================================================================

clause(UM, "0:attach", "is a tactic with the subtype mutation", () => printedStats({ id: UM, type: "tactic", subtype: ["mutation"] }));
