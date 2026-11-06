// ungodly-mess-03, part p1 (groups 1-5, missing clauses): Eidolic Cove, Eustace, Expert Debater,
// Fade of the Devoured Emperor, Foreclosure Overseer.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate, bank, character, developFaction, item, location, P1, P2, play, resolvePendingResponses, resourceCard, tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle } from "./_battle.js";
import { answerPending, pending, tokensOn, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, settleState, flipUpNow } from "./_clause.js";
import { endTurn } from "./_turn.js";

const COVE = "cef7f9fa-aa53-4a62-b8ec-325f0b707c5c"; // location, cost 2, gg, structure 2
const EUSTACE = "1b7bb2f0-4fcd-4a93-8ccf-7a0142aca7a0"; // UNIQUE EUSTACE, cost 4, gggg, 1/3/4
const DEBATER = "14b602dd-2653-4ea0-ad52-74dc5fe28af4"; // cost 2, gg, 0/3/6, politician
const FADE = "6bd4948f-f4f7-4f17-94d7-7d4d49803479"; // vanilla, cost 5, g, 5/2/2, ghost mau
const OVERSEER = "d56e0e61-ff37-4424-b089-83d879c37d98"; // cost 4, gg, 2/3/4, employee mau

// ---------------------------------------------------------------- shared helpers

let tuid = 0;
/** A staple resource of a specific trade (bank() resources are all trade "universal"). */
function tres(trade: "banker" | "rogue" | "arcanist" | "gearsmith" | "warlord", icon: "rage" | "greed" | "deception" | "elitism" | "obsession", owner: PlayerId = P1, staple = true): CardPlacement {
  const n = tuid++;
  return { key: `tres${n}`, def: resourceCard({ id: `ung-tres-${n}`, name: `${trade} ${icon} ${n}`, trade, resource: { provides: [icon], staple } }), owner, zone: "play" };
}

const available = (engine: SpoilsEngine, p: PlayerId) => engine.getAvailableResourceCount(p);
const influenceOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const stateOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c];

function flipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
  resolvePendingResponses(engine);
}

function resolveChoice(engine: SpoilsEngine, player: PlayerId, choice: Record<string, unknown>): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);
  resolvePendingResponses(engine);
}

/** A free tactic that destroys any one card in play (decl `t`). */
const smash = (name = "Smash") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        { id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that deals `amount` damage to one character (decl `t`). */
const zap = (amount: number) =>
  tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "dmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });

function game(cards: CardPlacement[], over: { turn?: number; active?: PlayerId; influenceA?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), ...(over.influenceA !== undefined ? { influence: over.influenceA } : {}) },
    playerB: { faction: developFaction() },
    cards,
    turn: over.turn ?? 2,
    activePlayerId: over.active ?? P1
  });
}

// ===================================================================== EIDOLIC COVE

const coveHand = (extra: CardPlacement[] = []) =>
  game([{ key: "cove", def: printing(COVE), owner: P1, zone: "hand" }, ...extra]);

clause(COVE, "0:rule", "printed card: a location (structure 2) deployed for exactly 2 with gg; one resource short, or one [G] short, refuses", () => {
  const ok = coveHand(bank("greed", 3, P1));
  assert.equal(ok.engine.getDefinition(ok.id("cove")).type, "location");
  assert.equal(ok.engine.getDefinition(ok.id("cove")).cost, 2);
  assert.equal(ok.engine.getDefinition(ok.id("cove")).threshold, "gg");
  play(ok.engine, P1, ok.id("cove"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("cove")), "play");
  assert.equal(ok.engine.getStat(ok.id("cove"), "structure"), 2);
  assert.equal(available(ok.engine, P1), 1, "exactly 2 of 3 resources paid");
  const exact = coveHand(bank("greed", 2, P1));
  play(exact.engine, P1, exact.id("cove"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("cove")), "play");
  assert.equal(available(exact.engine, P1), 0);
  const short = coveHand(bank("greed", 1, P1));
  refused(() => play(short.engine, P1, short.id("cove")), "one resource short", /threshold|afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("cove")), "hand");
  const iconShort = coveHand([...bank("greed", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("cove")), "one [G] short (2 resources but one is rage)", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("cove")), "hand");
});

/** `n` greed resources for P1 that are already spent (attached to the faction): they count toward the threshold but cannot pay. */
const spentGreed = (n: number): CardPlacement[] =>
  bank("greed", n, P1).map((placement) => ({ ...placement, key: `spent-${placement.key}`, attachedToKey: "__factionA" }));

clause(COVE, "0:rule", "the printed cost 2 is isolated from the threshold gg: with [G][G] already spent (threshold met), 1 ready resource is refused for the COST and 2 ready resources deploy it", () => {
  const short = coveHand([...spentGreed(2), ...bank("rage", 1, P1)]);
  assert.equal(available(short.engine, P1), 1, "setup: only the one ready rage can pay");
  refused(() => play(short.engine, P1, short.id("cove")), "threshold [G][G] is met by the spent banks, but the cost 2 is one short", /afford|cost|pay|resource/i);
  assert.equal(zoneOf(short.engine, short.id("cove")), "hand");
  const exact = coveHand([...spentGreed(2), ...bank("rage", 2, P1)]);
  play(exact.engine, P1, exact.id("cove"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("cove")), "play", "control: same board with 2 ready resources deploys");
  assert.equal(available(exact.engine, P1), 0, "exactly 2 paid");
});

clause(COVE, "0:rule", "the threshold gg is isolated from the cost: 2 ready rage cannot deploy it with only one spent [G] (threshold one short), and one spent [G] plus a ready [G] meets it", () => {
  const iconShort = coveHand([...spentGreed(1), ...bank("rage", 2, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("cove")), "cost 2 payable but only one [G] icon in total", /threshold|icon/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("cove")), "hand");
  const ok = coveHand([...spentGreed(1), ...bank("greed", 1, P1), ...bank("rage", 1, P1)]);
  play(ok.engine, P1, ok.id("cove"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("cove")), "play", "control: [G] spent + [G] ready meets the threshold");
});

function coveEtbBoard() {
  return coveHand([
    ...bank("greed", 2, P1),
    { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
    { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
    { key: "oppLoc", def: location({ name: "OppLoc", structure: 3 }), owner: P2, zone: "play" },
    { key: "myLoc", def: location({ name: "MyLoc", structure: 3 }), owner: P1, zone: "play" },
    { key: "chr", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
    { key: "stolen", def: item({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }
  ]);
}

for (const [key, label] of [["oppItem", "an opponent's item"], ["myItem", "my own item"], ["oppLoc", "an opponent's location"], ["myLoc", "my own location"]] as const) {
  clause(COVE, "0:rule", `when it enters play I may pick ${label} and it is flipped face-down (still in play, still under its owner)`, () => {
    const { engine, id } = coveEtbBoard();
    play(engine, P1, id("cove"));
    const pc = pending(engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, P1, "the controller picks");
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(stateOf(engine, id(key)).faceDown, true, "flipped face-down");
    assert.equal(zoneOf(engine, id(key)), "play");
    for (const other of ["oppItem", "myItem", "oppLoc", "myLoc", "chr", "stolen"]) {
      if (other !== key) assert.notEqual(stateOf(engine, id(other)).faceDown, true, `${other} was not picked`);
    }
    assert.equal(zoneOf(engine, id("cove")), "play");
    assert.notEqual(stateOf(engine, id("cove")).faceDown, true, "Cove itself stays face-up");
  });
}

clause(COVE, "0:rule", "the flipped card stays under its OWNER's control (a stolen item goes back to its owner, face-down)", () => {
  const { engine, id } = coveEtbBoard();
  assert.equal(stateOf(engine, id("stolen")).controllerId, P1, "setup: P1 controls P2's item");
  play(engine, P1, id("cove"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("stolen")] });
  assert.equal(stateOf(engine, id("stolen")).faceDown, true);
  assert.equal(stateOf(engine, id("stolen")).controllerId, P2, "under its owner's control");
  assert.equal(stateOf(engine, id("stolen")).ownerId, P2);
});

clause(COVE, "0:rule", "'you may': declining the pick (empty selection) flips nothing", () => {
  const { engine, id } = coveEtbBoard();
  play(engine, P1, id("cove"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  for (const k of ["oppItem", "myItem", "oppLoc", "myLoc", "chr", "stolen"]) assert.notEqual(stateOf(engine, id(k)).faceDown, true, k);
  assert.equal(zoneOf(engine, id("cove")), "play");
});

clause(COVE, "0:rule", "only an item or location can be picked: a character is refused (positive control: an item is accepted)", () => {
  const { engine, id } = coveEtbBoard();
  play(engine, P1, id("cove"));
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("chr")] }), "a character is not an item or location");
  assert.notEqual(stateOf(engine, id("chr")).faceDown, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oppItem")] });
  assert.equal(stateOf(engine, id("oppItem")).faceDown, true);
});

clause(COVE, "0:rule", "'pick an item or location' is ONE card: picking two is refused", () => {
  const { engine, id } = coveEtbBoard();
  play(engine, P1, id("cove"));
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oppItem"), id("myItem")] }), "two picks");
  assert.notEqual(stateOf(engine, id("oppItem")).faceDown, true);
  assert.notEqual(stateOf(engine, id("myItem")).faceDown, true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("myItem")] });
  assert.equal(stateOf(engine, id("myItem")).faceDown, true);
});

clause(COVE, "0:rule", "only 'when THIS card enters play': another location entering play while Cove is in play offers no pick", () => {
  const b = game([
    { key: "cove", def: printing(COVE), owner: P1, zone: "play" },
    { key: "newLoc", def: location({ name: "NewLoc", cost: 0, structure: 3 }), owner: P1, zone: "hand" },
    { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("newLoc"));
  assert.equal(zoneOf(b.engine, b.id("newLoc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no trigger for another card");
  assert.notEqual(stateOf(b.engine, b.id("oppItem")).faceDown, true);
});

function coveInPlay(coveOwner: PlayerId = P1, coveController: PlayerId = coveOwner, active: PlayerId = P1) {
  return game(
    [
      { key: "cove", def: printing(COVE), owner: coveOwner, controller: coveController, zone: "play" },
      { key: "other", def: location({ name: "OtherLoc", structure: 3 }), owner: P1, zone: "play" },
      { key: "smash1", def: smash("SmashA"), owner: P1, zone: "hand" },
      { key: "smash2", def: smash("SmashB"), owner: P2, zone: "hand" }
    ],
    { active }
  );
}

clause(COVE, "1:rule", "when destroyed, my faction loses exactly 4 influence (the opponent's is untouched)", () => {
  const { engine, id } = coveInPlay();
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  play(engine, P1, id("smash1"), { selected: { t: [id("cove")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cove")), "discard");
  assert.equal(influenceOf(engine, P1), mine - 4);
  assert.equal(influenceOf(engine, P2), theirs);
});

clause(COVE, "1:rule", "destroyed by the OPPONENT's effect, still 'your faction' = the Cove's controller who loses 4", () => {
  const { engine, id } = coveInPlay(P1, P1, P2);
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  play(engine, P2, id("smash2"), { selected: { t: [id("cove")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cove")), "discard");
  assert.equal(influenceOf(engine, P1), mine - 4);
  assert.equal(influenceOf(engine, P2), theirs);
});

clause(COVE, "1:rule", "'your faction' is the controller's: a Cove owned by P2 but controlled by P1 costs P1 the 4 influence", () => {
  const { engine, id } = coveInPlay(P2, P1, P1);
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  play(engine, P1, id("smash1"), { selected: { t: [id("cove")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cove")), "discard");
  assert.equal(influenceOf(engine, P1), mine - 4, "the controller loses");
  assert.equal(influenceOf(engine, P2), theirs, "the owner does not");
});

clause(COVE, "1:rule", "only when THIS card is destroyed: destroying another location of mine while Cove stays in play costs nothing", () => {
  const { engine, id } = coveInPlay();
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("smash1"), { selected: { t: [id("other")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(zoneOf(engine, id("cove")), "play");
  assert.equal(influenceOf(engine, P1), mine);
});

clause(COVE, "1:rule", "it is lost through damage destruction too: 2 damage on a structure-2 Cove destroys it and costs 4 influence", () => {
  const { engine, id } = game([
    { key: "cove", def: printing(COVE), owner: P1, zone: "play" },
    {
      key: "hit",
      def: tactic({
        name: "LocHit",
        cost: 0,
        behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
      }),
      owner: P1,
      zone: "hand"
    }
  ]);
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("hit"), { selected: { t: [id("cove")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cove")), "discard");
  assert.equal(influenceOf(engine, P1), mine - 4);
});

const coveFaceDown = (extra: CardPlacement[] = [], over: { turn?: number; active?: PlayerId } = {}) =>
  game([{ key: "cove", def: printing(COVE), owner: P1, zone: "play", faceDown: true }, ...extra], over);

clause(COVE, "2:flipUp", "FLIP UP costs 2 and needs [G]: two greed flips it up and pays exactly 2; no other effect happens", () => {
  const { engine, id } = coveFaceDown(bank("greed", 3, P1));
  const inf = influenceOf(engine, P1);
  assert.equal(stateOf(engine, id("cove")).faceDown, true);
  flipUp(engine, P1, id("cove"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(stateOf(engine, id("cove")).faceDown, false);
  assert.equal(zoneOf(engine, id("cove")), "play");
  assert.equal(available(engine, P1), 1, "3 greed + the face-down Cove itself = 4 resources; 2 were paid, and the flipped Cove is no longer a resource");
  assert.equal(influenceOf(engine, P1), inf, "no other effect");
});

clause(COVE, "2:flipUp", "the face-down Cove may pay for its own FLIP UP (1 greed + itself = 2), but its own icon is not counted for the threshold", () => {
  const ok = coveFaceDown(bank("greed", 1, P1));
  flipUp(ok.engine, P1, ok.id("cove"));
  drain(ok.engine, declineAll);
  assert.equal(stateOf(ok.engine, ok.id("cove")).faceDown, false, "N-1 others + itself pays the cost");
  const alone = coveFaceDown([]);
  refused(() => flipUp(alone.engine, P1, alone.id("cove")), "only itself: 1 resource of the 2 cost", /threshold|afford|resource|pay|cost/i);
  assert.equal(stateOf(alone.engine, alone.id("cove")).faceDown, true);
});

clause(COVE, "2:flipUp", "FLIP UP refused one [G] short (cost payable, no greed icon among the resources)", () => {
  const ok = coveFaceDown(bank("greed", 1, P1));
  flipUp(ok.engine, P1, ok.id("cove"));
  drain(ok.engine, declineAll);
  assert.equal(stateOf(ok.engine, ok.id("cove")).faceDown, false, "control: one greed is enough");
  const noG = coveFaceDown(bank("rage", 2, P1));
  assert.equal(available(noG.engine, P1), 3, "cost is payable");
  refused(() => flipUp(noG.engine, P1, noG.id("cove")), "no [G]", /threshold|icon/i);
  assert.equal(stateOf(noG.engine, noG.id("cove")).faceDown, true);
  assert.equal(available(noG.engine, P1), 3, "nothing was paid");
});

clause(COVE, "2:flipUp", "a Cove deployed by FLIP UP enters play: its enters-play trigger runs (I may pick an item and it is flipped face-down)", () => {
  const { engine, id } = coveFaceDown([...bank("greed", 3, P1), { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "play" }]);
  flipUp(engine, P1, id("cove"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oppItem")] });
  assert.equal(stateOf(engine, id("oppItem")).faceDown, true);
  assert.equal(stateOf(engine, id("cove")).faceDown, false);
});

clause(COVE, "2:flipUp", "a face-up Cove can't be flipped up again", () => {
  const { engine, id } = game([{ key: "cove", def: printing(COVE), owner: P1, zone: "play" }, ...bank("greed", 3, P1)]);
  refused(() => flipUp(engine, P1, id("cove")), "already face-up");
});

clause(COVE, "2:flipUp", "FLIP UP of a non-tactic is refused inside the opponent's response window (positive control: allowed on my own turn)", () => {
  const own = coveFaceDown(bank("greed", 3, P1));
  flipUp(own.engine, P1, own.id("cove"));
  drain(own.engine, declineAll);
  assert.equal(stateOf(own.engine, own.id("cove")).faceDown, false, "control");
  const b = coveFaceDown(
    [...bank("greed", 3, P1), { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }],
    { active: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b.engine, P1, b.id("cove")), "opponent's response window", /response|window|turn|tactic|only/i);
  assert.equal(stateOf(b.engine, b.id("cove")).faceDown, true);
});

// ===================================================================== EUSTACE

function eustaceBoard(extra: CardPlacement[], over: { zone?: "hand" | "play"; influenceA?: number; active?: PlayerId } = {}) {
  return game([{ key: "eu", def: printing(EUSTACE), owner: P1, zone: over.zone ?? "play" }, ...extra], over);
}

clause(EUSTACE, "0:unique", "printed card: character 1/3/4 (blade of questionable morality), cost 4 gggg: exact deploys; a resource short and a [G] short refuse", () => {
  const exact = eustaceBoard(bank("greed", 4, P1), { zone: "hand" });
  const d = exact.engine.getDefinition(exact.id("eu"));
  assert.equal(d.type, "character");
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "gggg");
  play(exact.engine, P1, exact.id("eu"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("eu")), "play");
  assert.equal(exact.engine.getStat(exact.id("eu"), "strength"), 1);
  assert.equal(exact.engine.getStat(exact.id("eu"), "speed"), 3);
  assert.equal(exact.engine.getStat(exact.id("eu"), "life"), 4);
  assert.deepEqual([...(d.subtype ?? [])], ["eustace", "blade of questionable morality"]);
  assert.equal(available(exact.engine, P1), 0);
  const short = eustaceBoard(bank("greed", 3, P1), { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("eu")), "3 greed", /threshold|afford|resource|pay|cost/i);
  const iconShort = eustaceBoard([...bank("greed", 3, P1), ...bank("rage", 1, P1)], { zone: "hand" });
  refused(() => play(iconShort.engine, P1, iconShort.id("eu")), "3 greed + rage: one [G] short", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("eu")), "hand");
});

clause(EUSTACE, "0:unique", "UNIQUE EUSTACE: deploying a second card with the EUSTACE identifier makes me choose which to keep; the other is destroyed", () => {
  const other = () => character({ name: "Other Eustace Blade", unique: "eustace" });
  const b = eustaceBoard([{ key: "e2", def: other(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("e2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("eu"), b.id("e2")].sort());
  resolveChoice(b.engine, P1, { kind: "uniqueSurvivor", keep: b.id("eu") });
  assert.equal(zoneOf(b.engine, b.id("eu")), "play");
  assert.equal(zoneOf(b.engine, b.id("e2")), "discard");
  const c = eustaceBoard([{ key: "e2", def: other(), owner: P1, zone: "hand" }]);
  play(c.engine, P1, c.id("e2"));
  resolveChoice(c.engine, P1, { kind: "uniqueSurvivor", keep: c.id("e2") });
  assert.equal(zoneOf(c.engine, c.id("eu")), "discard");
  assert.equal(zoneOf(c.engine, c.id("e2")), "play");
});

clause(EUSTACE, "0:unique", "UNIQUE is per player and per identifier: the opponent's Eustace, or my card with another identifier, forces no choice", () => {
  const b = eustaceBoard([
    { key: "theirs", def: printing(EUSTACE), owner: P2, zone: "play" },
    { key: "mine2", def: character({ name: "Different Unique", unique: "somebody-else" }), owner: P1, zone: "play" }
  ]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("eu")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play");
});

const DISTINCT4 = (): CardPlacement[] => [tres("banker", "greed"), tres("rogue", "rage"), tres("arcanist", "deception"), tres("gearsmith", "elitism")];

clause(EUSTACE, "1:rule", "Fealty: in hand with 4 staples of different trades, cost 4 is payable with a single [G] (3 icons waived)", () => {
  const b = eustaceBoard(DISTINCT4(), { zone: "hand" });
  assert.equal(b.engine.getCardPlayability(P1, b.id("eu")).playable, true);
  play(b.engine, P1, b.id("eu"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("eu")), "play");
  assert.equal(available(b.engine, P1), 0, "the cost of 4 is still paid in full");
});

clause(EUSTACE, "1:rule", "Fealty: more than 4 different trades still qualifies ('at least 4')", () => {
  const b = eustaceBoard([...DISTINCT4(), tres("warlord", "obsession")], { zone: "hand" });
  play(b.engine, P1, b.id("eu"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("eu")), "play");
});

clause(EUSTACE, "1:rule", "Fealty: only 3 different trades among 4 staples does not reduce the threshold", () => {
  const b = eustaceBoard([tres("banker", "greed"), tres("banker", "rage"), tres("rogue", "deception"), tres("arcanist", "elitism")], { zone: "hand" });
  assert.equal(b.engine.getCardPlayability(P1, b.id("eu")).playable, false);
  refused(() => play(b.engine, P1, b.id("eu")), "3 distinct trades", /threshold|icon/i);
  assert.equal(zoneOf(b.engine, b.id("eu")), "hand");
});

clause(EUSTACE, "1:rule", "Fealty: only 3 icons are waived: 4 different trades but no [G] at all is still refused", () => {
  const b = eustaceBoard([tres("banker", "rage"), tres("rogue", "deception"), tres("arcanist", "elitism"), tres("gearsmith", "obsession")], { zone: "hand" });
  refused(() => play(b.engine, P1, b.id("eu")), "no greed icon", /threshold|icon/i);
  assert.equal(zoneOf(b.engine, b.id("eu")), "hand");
});

clause(EUSTACE, "1:rule", "Fealty counts STAPLE resources I control only: a non-staple resource of a fourth trade, or the opponent's staples, don't count", () => {
  const nonStaple = eustaceBoard([tres("banker", "greed"), tres("rogue", "rage"), tres("arcanist", "deception"), tres("gearsmith", "elitism", P1, false)], { zone: "hand" });
  refused(() => play(nonStaple.engine, P1, nonStaple.id("eu")), "non-staple resource doesn't count", /threshold|icon/i);
  const theirs = eustaceBoard(
    [tres("banker", "greed"), tres("banker", "rage"), tres("rogue", "deception"), tres("arcanist", "elitism"), tres("gearsmith", "elitism", P2)],
    { zone: "hand" }
  );
  refused(() => play(theirs.engine, P1, theirs.id("eu")), "opponent's staple doesn't count", /threshold|icon/i);
});

clause(EUSTACE, "1:rule", "Fealty only helps the numeric cost not at all: with 4 distinct trades but only 3 resources it is still unaffordable", () => {
  const b = eustaceBoard([tres("banker", "greed"), tres("rogue", "rage"), tres("arcanist", "deception")], { zone: "hand" });
  refused(() => play(b.engine, P1, b.id("eu")), "3 resources", /afford|resource|pay|cost|threshold|icon/i);
});

function attackWith(engine: SpoilsEngine, ids: CardInstanceId[]): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids, target: { type: "faction", playerId: P2 } } as never);
}

clause(EUSTACE, "2:rule", "when it attacks I may pay 3 influence: then it has +3 strength (4) and COVERT", () => {
  const b = eustaceBoard([]);
  const inf = influenceOf(b.engine, P1);
  attackWith(b.engine, [b.id("eu")]);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(influenceOf(b.engine, P1), inf - 3);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 4);
  assert.ok(b.engine.getKeywords(b.id("eu")).includes("covert"), "b.engine.getKeywords(b.id(\"eu\")).includes(\"covert\")");
  assert.equal(b.engine.getStat(b.id("eu"), "life"), 4, "only strength changes");
  assert.equal(b.engine.getStat(b.id("eu"), "speed"), 3);
});

clause(EUSTACE, "2:rule", "declining the payment: no influence lost, no strength, no COVERT", () => {
  const b = eustaceBoard([]);
  const inf = influenceOf(b.engine, P1);
  attackWith(b.engine, [b.id("eu")]);
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(influenceOf(b.engine, P1), inf);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1);
  assert.ok(!b.engine.getKeywords(b.id("eu")).includes("covert"), "!b.engine.getKeywords(b.id(\"eu\")).includes(\"covert\")");
});

clause(EUSTACE, "2:rule", "COVERT works: after paying, a plain character can't block Eustace; declining, it can", () => {
  const board = () => eustaceBoard([{ key: "blk", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" }]);
  const paid = board();
  attackWith(paid.engine, [paid.id("eu")]);
  answerPending(paid.engine, "mayPay", { pay: true });
  refused(() => paid.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [paid.id("blk")] }), "non-covert can't block a covert attacker", /covert/i);
  const unpaid = board();
  attackWith(unpaid.engine, [unpaid.id("eu")]);
  answerPending(unpaid.engine, "mayPay", { pay: false });
  unpaid.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [unpaid.id("blk")] });
  assert.equal(battleBlockers(unpaid.engine).includes(unpaid.id("blk")), true);
});

function battleBlockers(engine: SpoilsEngine): string[] {
  return [...(engine.state.battle?.blockingParty ?? [])];
}

clause(EUSTACE, "2:rule", "the +3 strength lands in the battle: paid Eustace deals 4 to the faction, declining deals 1", () => {
  const run = (pay: boolean) => {
    const b = eustaceBoard([]);
    const theirs = influenceOf(b.engine, P2);
    attackWith(b.engine, [b.id("eu")]);
    answerPending(b.engine, "mayPay", { pay });
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    finishBattle(b.engine);
    return theirs - influenceOf(b.engine, P2);
  };
  assert.equal(run(true), 4);
  assert.equal(run(false), 1);
});

clause(EUSTACE, "2:rule", "'this turn': the strength and COVERT are gone once the turn ends", () => {
  const b = eustaceBoard([]);
  attackWith(b.engine, [b.id("eu")]);
  answerPending(b.engine, "mayPay", { pay: true });
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 4, "still buffed this turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1);
  assert.ok(!b.engine.getKeywords(b.id("eu")).includes("covert"), "!b.engine.getKeywords(b.id(\"eu\")).includes(\"covert\")");
});

clause(EUSTACE, "2:rule", "the buff is for Eustace only: a character attacking alongside keeps its own strength", () => {
  const b = eustaceBoard([{ key: "ally", def: character({ name: "Ally", strength: 2 }), owner: P1, zone: "play" }]);
  attackWith(b.engine, [b.id("eu"), b.id("ally")]);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2);
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "!b.engine.getKeywords(b.id(\"ally\")).includes(\"covert\")");
});

clause(EUSTACE, "2:rule", "no trigger when ANOTHER character attacks and Eustace stays home", () => {
  const b = eustaceBoard([{ key: "ally", def: character({ name: "Ally", strength: 2 }), owner: P1, zone: "play" }]);
  attackWith(b.engine, [b.id("ally")]);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1);
});

clause(EUSTACE, "2:rule", "with less than 3 influence I can't pay: paying is not possible and he gets no buff (influence never goes below 0)", () => {
  const b = eustaceBoard([], { influenceA: 2 });
  attackWith(b.engine, [b.id("eu")]);
  const pc = pending(b.engine);
  if (pc?.kind === "mayPay") {
    try {
      answerPending(b.engine, "mayPay", { pay: true });
    } catch {
      /* refusing the payment is a valid outcome */
    }
  }
  assert.equal(influenceOf(b.engine, P1), 2, "influence not spent");
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1, "no strength without paying");
  assert.ok(!b.engine.getKeywords(b.id("eu")).includes("covert"), "!b.engine.getKeywords(b.id(\"eu\")).includes(\"covert\")");
});

function feastBoard(extra: CardPlacement[] = []) {
  return eustaceBoard(extra);
}

function attackDecline(engine: SpoilsEngine, ids: CardInstanceId[], blockers: CardInstanceId[]): void {
  attackWith(engine, ids);
  while (pending(engine)?.kind === "mayPay") answerPending(engine, "mayPay", { pay: false });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
  finishBattle(engine);
}

clause(EUSTACE, "3:rule", "when Eustace inflicts battle damage to a faction, my faction gains 3 influence (once)", () => {
  const b = feastBoard();
  const mine = influenceOf(b.engine, P1);
  const theirs = influenceOf(b.engine, P2);
  attackDecline(b.engine, [b.id("eu")], []);
  assert.equal(influenceOf(b.engine, P2), theirs - 1, "1 damage reached the faction");
  assert.equal(influenceOf(b.engine, P1), mine + 3);
});

clause(EUSTACE, "3:rule", "the gain is a flat 3, independent of the damage dealt (paid Eustace deals 4, my faction nets +3 -3 +3)", () => {
  const b = feastBoard();
  const mine = influenceOf(b.engine, P1);
  attackWith(b.engine, [b.id("eu")]);
  answerPending(b.engine, "mayPay", { pay: true });
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P1), mine - 3 + 3);
});

clause(EUSTACE, "3:rule", "no gain when the damage goes to a character instead (blocked)", () => {
  const b = feastBoard([{ key: "blk", def: character({ name: "Wall", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }]);
  const mine = influenceOf(b.engine, P1);
  const theirs = influenceOf(b.engine, P2);
  attackDecline(b.engine, [b.id("eu")], [b.id("blk")]);
  assert.equal(stateOf(b.engine, b.id("blk")).damage, 1, "the blocker took the damage");
  assert.equal(influenceOf(b.engine, P2), theirs);
  assert.equal(influenceOf(b.engine, P1), mine);
});

clause(EUSTACE, "3:rule", "no gain when ANOTHER of my characters damages the faction and Eustace stays home", () => {
  const b = feastBoard([{ key: "ally", def: character({ name: "Ally", strength: 2 }), owner: P1, zone: "play" }]);
  const mine = influenceOf(b.engine, P1);
  const theirs = influenceOf(b.engine, P2);
  attackDecline(b.engine, [b.id("ally")], []);
  assert.equal(influenceOf(b.engine, P2), theirs - 2);
  assert.equal(influenceOf(b.engine, P1), mine, "Eustace did not inflict it");
});

clause(EUSTACE, "3:rule", "attacking together with an ally: only Eustace's own damage counts, so +3 once", () => {
  const b = feastBoard([{ key: "ally", def: character({ name: "Ally", strength: 2 }), owner: P1, zone: "play" }]);
  const mine = influenceOf(b.engine, P1);
  const theirs = influenceOf(b.engine, P2);
  attackDecline(b.engine, [b.id("eu"), b.id("ally")], []);
  assert.equal(influenceOf(b.engine, P2), theirs - 3, "1 + 2 damage");
  assert.equal(influenceOf(b.engine, P1), mine + 3);
});

clause(EUSTACE, "3:rule", "the opponent's Eustace damaging MY faction gains the opponent 3, not me", () => {
  const b = game(
    [{ key: "eu2", def: printing(EUSTACE), owner: P2, zone: "play" }],
    { active: P2 }
  );
  const mine = influenceOf(b.engine, P1);
  const theirs = influenceOf(b.engine, P2);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("eu2")], target: { type: "faction", playerId: P1 } } as never);
  while (pending(b.engine)?.kind === "mayPay") answerPending(b.engine, "mayPay", { pay: false });
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P1), mine - 1);
  assert.equal(influenceOf(b.engine, P2), theirs + 3);
});

// ===================================================================== EXPERT DEBATER

const debaterIn = (zone: "play" | "hand" | "discard", extra: CardPlacement[] = [], over: { active?: PlayerId; owner?: PlayerId; tokens?: number } = {}) =>
  game(
    [{ key: "deb", def: printing(DEBATER), owner: over.owner ?? P1, zone, ...(over.tokens ? { counters: { token: over.tokens } } : {}) }, ...extra],
    { active: over.active }
  );

clause(DEBATER, "0:rule", "printed card: character 0/3/6 (politician), cost 2 gg: exact deploys; a resource short and a [G] short refuse", () => {
  const exact = debaterIn("hand", bank("greed", 2, P1));
  const d = exact.engine.getDefinition(exact.id("deb"));
  assert.equal(d.type, "character");
  assert.equal(d.cost, 2);
  assert.equal(d.threshold, "gg");
  assert.deepEqual([...(d.subtype ?? [])], ["politician"]);
  play(exact.engine, P1, exact.id("deb"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("deb")), "play");
  assert.equal(exact.engine.getStat(exact.id("deb"), "strength"), 0);
  assert.equal(exact.engine.getStat(exact.id("deb"), "speed"), 3);
  assert.equal(exact.engine.getStat(exact.id("deb"), "life"), 6);
  assert.equal(available(exact.engine, P1), 0);
  const short = debaterIn("hand", bank("greed", 1, P1));
  refused(() => play(short.engine, P1, short.id("deb")), "one resource short", /threshold|afford|resource|pay|cost/i);
  const iconShort = debaterIn("hand", [...bank("greed", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("deb")), "one [G] short", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("deb")), "hand");
});

clause(DEBATER, "0:rule", "loses 1 life per token on it: 0 tokens 6, 1 token 5, 2 tokens 4, 5 tokens 1", () => {
  for (const [tokens, life] of [[0, 6], [1, 5], [2, 4], [5, 1]] as const) {
    const b = debaterIn("play", [], { tokens });
    assert.equal(b.engine.getStat(b.id("deb"), "life"), life, `${tokens} tokens`);
    assert.equal(b.engine.getStat(b.id("deb"), "strength"), 0);
    assert.equal(b.engine.getStat(b.id("deb"), "speed"), 3);
  }
});

clause(DEBATER, "0:rule", "adding tokens lowers life as they come (live), and removing them gives it back", () => {
  const b = debaterIn("play", [{ key: "zapper", def: zap(1), owner: P1, zone: "hand" }], { tokens: 3 });
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 3);
  b.engine.state.cards[b.id("deb")].counters = { token: 1 };
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 5);
});

clause(DEBATER, "0:rule", "only tokens count (another counter type does not), and only tokens ON this card (a token on another character doesn't)", () => {
  const b = debaterIn("play", [{ key: "other", def: character({ name: "Other", life: 6 }), owner: P1, zone: "play", counters: { token: 3 } }], {});
  b.engine.state.cards[b.id("deb")].counters = { stamp: 4 } as never;
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 6, "a non-token counter doesn't count");
  b.engine.state.cards[b.id("deb")].counters = {};
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 6, "tokens on another card don't count");
  assert.equal(b.engine.getStat(b.id("other"), "life"), 6, "and Debater's rule is not a static aura on others");
});

clause(DEBATER, "0:rule", "with as many tokens as life (6) it has 0 life and is destroyed", () => {
  const b = debaterIn("play", [], { tokens: 6 });
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 0);
  settleState(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("deb")), "discard", "0 life destroys it");
});

/** P1 attacks with a `str`-strength attacker, P2's Debater blocks it. */
function debaterBlocks(str: number, extra: CardPlacement[] = []) {
  const b = game(
    [
      { key: "atk", def: character({ name: "Atk", strength: str, life: 20, speed: 1 }), owner: P1, zone: "play" },
      { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
      ...extra
    ]
  );
  const before = influenceOf(b.engine, P2);
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("deb")]);
  return Object.assign(b, { before });
}

clause(DEBATER, "1:rule", "while blocking, 3 battle damage becomes 3 tokens instead: no damage on it, life 6-3 = 3, it survives", () => {
  const b = debaterBlocks(3);
  assert.equal(stateOf(b.engine, b.id("deb")).damage ?? 0, 0, "the damage was not inflicted");
  assert.equal(tokensOn(b.engine, b.id("deb")), 3, "that many tokens");
  assert.equal(zoneOf(b.engine, b.id("deb")), "play");
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 3);
});

clause(DEBATER, "1:rule", "the token count equals the damage: 5 damage gives 5 tokens (life 1, still alive, no damage marker)", () => {
  const b = debaterBlocks(5);
  assert.equal(tokensOn(b.engine, b.id("deb")), 5);
  assert.equal(stateOf(b.engine, b.id("deb")).damage ?? 0, 0);
  assert.equal(zoneOf(b.engine, b.id("deb")), "play");
  assert.equal(b.engine.getStat(b.id("deb"), "life"), 1);
});

clause(DEBATER, "1:rule", "the number of tokens added equals the damage that would have been inflicted (1 damage -> 1 token, 2 damage -> 2 tokens)", () => {
  for (const str of [1, 2]) {
    const b = debaterBlocks(str);
    assert.equal(zoneOf(b.engine, b.id("deb")), "play");
    assert.equal(tokensOn(b.engine, b.id("deb")), str, `${str} damage`);
  }
});

clause(DEBATER, "1:rule", "the damage can still kill it through the tokens: 6 damage = 6 tokens = 0 life, destroyed", () => {
  const b = debaterBlocks(6);
  assert.equal(zoneOf(b.engine, b.id("deb")), "discard");
});

clause(DEBATER, "1:rule", "it only applies to damage inflicted TO this card: the attacker it blocked is damaged normally by its strength 0 (none) and the faction is unharmed", () => {
  const b = debaterBlocks(3);
  const theirs = b.before;
  assert.equal(stateOf(b.engine, b.id("atk")).damage ?? 0, 0, "Debater has 0 strength");
  assert.equal(influenceOf(b.engine, P2), theirs, "the blocked attacker did not reach the faction");
});

clause(DEBATER, "1:rule", "only while BLOCKING: damage to it while it attacks is ordinary damage markers, no tokens", () => {
  const b = game(
    [
      { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 20, speed: 1 }), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  fightThrough(b.engine, P2, [b.id("deb")], { type: "faction", playerId: P1 }, [b.id("blk")]);
  assert.equal(stateOf(b.engine, b.id("deb")).damage, 2, "ordinary damage");
  assert.equal(tokensOn(b.engine, b.id("deb")), 0);
});

clause(DEBATER, "1:rule", "only BATTLE damage: tactic damage to a blocker-capable Debater in play is a normal damage marker", () => {
  const b = game([
    { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
    { key: "zap", def: zap(2), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("deb")] } });
  drain(b.engine, declineAll);
  assert.equal(stateOf(b.engine, b.id("deb")).damage, 2);
  assert.equal(tokensOn(b.engine, b.id("deb")), 0);
});

clause(DEBATER, "1:rule", "only BATTLE damage, even mid-battle: while it is blocking, a tactic's damage to it is not battle damage and stays a damage marker (no tokens)", () => {
  const b = game([
    { key: "atk", def: character({ name: "Atk", strength: 0, life: 20, speed: 1 }), owner: P1, zone: "play" },
    { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
    { key: "zap", def: zap(2), owner: P1, zone: "hand" }
  ]);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("deb")] });
  assert.ok(b.engine.state.battle, "control: the battle is still going with the Debater blocking");
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("deb")] } });
  drain(b.engine, declineAll);
  assert.equal(stateOf(b.engine, b.id("deb")).damage, 2, "the tactic's damage is an ordinary damage marker even while blocking");
  assert.equal(tokensOn(b.engine, b.id("deb")), 0, "no tokens: the replacement is for battle damage only");
});

clause(DEBATER, "1:rule", "only the Debater itself: another blocker beside it takes ordinary damage, and no tokens go on it", () => {
  const b = game([
    { key: "atk", def: character({ name: "Atk", strength: 3, life: 20, speed: 1 }), owner: P1, zone: "play" },
    { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
    { key: "wall", def: character({ name: "Wall", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }
  ]);
  // the attacker is blocked by the wall alone this time: Debater is not blocking
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("wall")]);
  assert.equal(stateOf(b.engine, b.id("wall")).damage, 3, "the other blocker takes ordinary damage");
  assert.equal(tokensOn(b.engine, b.id("deb")), 0, "Debater was not blocking");
  assert.equal(tokensOn(b.engine, b.id("wall")), 0);
});

clause(DEBATER, "1:rule", "when it blocks beside another blocker, only the damage inflicted TO the Debater becomes tokens (1 of 4 damage -> 1 token; the other blocker takes 3 normally)", () => {
  const b = game([
    { key: "atk", def: character({ name: "Atk", strength: 4, life: 20, speed: 1 }), owner: P1, zone: "play" },
    { key: "deb", def: printing(DEBATER), owner: P2, zone: "play" },
    { key: "wall", def: character({ name: "Wall", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }
  ]);
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, [b.id("deb"), b.id("wall")], (source) => source.cardId !== b.id("atk") ? [] : [
    { sourceId: source.cardId, target: { type: "card", cardId: b.id("deb") }, amount: 1 },
    { sourceId: source.cardId, target: { type: "card", cardId: b.id("wall") }, amount: 3 }
  ]);
  assert.equal(tokensOn(b.engine, b.id("deb")), 1);
  assert.equal(stateOf(b.engine, b.id("wall")).damage, 3);
  assert.equal(tokensOn(b.engine, b.id("wall")), 0);
});

const recurBoard = (over: { greed?: number; rage?: number; zone?: "play" | "hand" | "discard"; owner?: PlayerId } = {}) =>
  debaterIn(over.zone ?? "discard", [
    { key: "tc", def: character({ name: "TokenHolder" }), owner: P2, zone: "play", counters: { token: 3 } },
    { key: "mine", def: character({ name: "MyHolder" }), owner: P1, zone: "play", counters: { token: 2 } },
    { key: "bare", def: character({ name: "Bare" }), owner: P1, zone: "play" },
    { key: "it", def: item({ name: "TokenItem" }), owner: P1, zone: "play", counters: { token: 2 } },
    ...bank("greed", over.greed ?? 2, P1),
    ...bank("rage", over.rage ?? 0, P1)
  ], { owner: over.owner });

clause(DEBATER, "2:ability:recur", "RECUR from my discard: pay 1, remove it from the game, pick a character and remove one token from it", () => {
  const b = recurBoard({ greed: 3 });
  const before = available(b.engine, P1);
  activate(b.engine, P1, b.id("deb"), "recur", { selected: { c: [b.id("tc")] } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("deb")), "removed", "removed from the game");
  assert.equal(tokensOn(b.engine, b.id("tc")), 2, "exactly one token removed");
  assert.equal(before - available(b.engine, P1), 1, "paid exactly 1");
  assert.equal(tokensOn(b.engine, b.id("mine")), 2, "other characters untouched");
});

clause(DEBATER, "2:ability:recur", "any character may be picked (mine too), and a Debater-free one with a single token goes to 0, never below", () => {
  const mine = recurBoard();
  activate(mine.engine, P1, mine.id("deb"), "recur", { selected: { c: [mine.id("mine")] } });
  assert.equal(tokensOn(mine.engine, mine.id("mine")), 1);
  assert.equal(tokensOn(mine.engine, mine.id("tc")), 3);
  const bare = recurBoard();
  activate(bare.engine, P1, bare.id("deb"), "recur", { selected: { c: [bare.id("bare")] } });
  assert.equal(zoneOf(bare.engine, bare.id("deb")), "removed");
  assert.equal(tokensOn(bare.engine, bare.id("bare")), 0, "nothing to remove, never negative");
});

clause(DEBATER, "2:ability:recur", "'Pick a character': an item can't be picked", () => {
  const b = recurBoard();
  refused(() => activate(b.engine, P1, b.id("deb"), "recur", { selected: { c: [b.id("it")] } }), "an item is not a character");
  assert.equal(zoneOf(b.engine, b.id("deb")), "discard", "no cost was paid");
  assert.equal(tokensOn(b.engine, b.id("it")), 2);
  activate(b.engine, P1, b.id("deb"), "recur", { selected: { c: [b.id("tc")] } });
  assert.equal(zoneOf(b.engine, b.id("deb")), "removed", "control: a character works");
});

clause(DEBATER, "2:ability:recur", "'Use this only if this card is in your discard pile': refused from play, from hand, and from the opponent's discard pile", () => {
  for (const zone of ["play", "hand"] as const) {
    const b = recurBoard({ zone });
    refused(() => activate(b.engine, P1, b.id("deb"), "recur", { selected: { c: [b.id("tc")] } }), `Debater in ${zone}`);
    assert.equal(tokensOn(b.engine, b.id("tc")), 3);
    assert.equal(zoneOf(b.engine, b.id("deb")), zone);
  }
  const theirs = recurBoard({ owner: P2 });
  assert.equal(zoneOf(theirs.engine, theirs.id("deb")), "discard");
  refused(() => activate(theirs.engine, P1, theirs.id("deb"), "recur", { selected: { c: [theirs.id("tc")] } }), "the opponent's discard pile is not mine");
  assert.equal(tokensOn(theirs.engine, theirs.id("tc")), 3);
});

clause(DEBATER, "2:ability:recur", "needs [G][G] and 1 resource to pay: one [G] (plus rage) refuses, no resources refuses", () => {
  const ok = recurBoard({ greed: 2 });
  activate(ok.engine, P1, ok.id("deb"), "recur", { selected: { c: [ok.id("tc")] } });
  assert.equal(zoneOf(ok.engine, ok.id("deb")), "removed", "control: gg works");
  const iconShort = recurBoard({ greed: 1, rage: 3 });
  refused(() => activate(iconShort.engine, P1, iconShort.id("deb"), "recur", { selected: { c: [iconShort.id("tc")] } }), "only one [G]", /threshold|icon/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("deb")), "discard");
  assert.equal(tokensOn(iconShort.engine, iconShort.id("tc")), 3);
  const none = recurBoard({ greed: 0 });
  refused(() => activate(none.engine, P1, none.id("deb"), "recur", { selected: { c: [none.id("tc")] } }), "no resources", /threshold|icon|afford|resource|pay/i);
  assert.equal(zoneOf(none.engine, none.id("deb")), "discard");
});

// ===================================================================== FADE OF THE DEVOURED EMPEROR

const fadeHand = (extra: CardPlacement[]) => game([{ key: "fade", def: printing(FADE), owner: P1, zone: "hand" }, ...extra]);

clause(FADE, "vanilla", "vanilla ghost/mau character 5/2/2: deploys for 5 with a [G]; refused one resource short and without [G]", () => {
  const exact = fadeHand([...bank("greed", 1, P1), ...bank("rage", 4, P1)]);
  const d = exact.engine.getDefinition(exact.id("fade"));
  assert.equal(d.type, "character");
  assert.equal(d.cost, 5);
  assert.equal(d.threshold, "g");
  assert.deepEqual([...(d.subtype ?? [])], ["ghost", "mau"]);
  play(exact.engine, P1, exact.id("fade"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("fade")), "play");
  assert.equal(exact.engine.getStat(exact.id("fade"), "strength"), 5);
  assert.equal(exact.engine.getStat(exact.id("fade"), "speed"), 2);
  assert.equal(exact.engine.getStat(exact.id("fade"), "life"), 2);
  assert.equal(available(exact.engine, P1), 0);
  const short = fadeHand([...bank("greed", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("fade")), "4 resources for cost 5", /threshold|afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("fade")), "hand");
  const noG = fadeHand(bank("rage", 5, P1));
  refused(() => play(noG.engine, P1, noG.id("fade")), "5 resources but no [G]", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("fade")), "hand");
  assert.equal(exact.engine.getKeywords(exact.id("fade")).length, 0, "no keywords");
});

// ===================================================================== FORECLOSURE OVERSEER

const C2 = () => character({ name: "Cheap Two", cost: 2 });

/** P1's Overseer in play (depleted unless told otherwise); P2 is active with a cost-2 character in hand and `p2res` resources. */
function overseerBoard(p2res: number, over: { depleted?: boolean; extra?: CardPlacement[]; second?: boolean } = {}) {
  return game(
    [
      { key: "fo", def: printing(OVERSEER), owner: P1, zone: "play", depleted: over.depleted ?? true },
      ...(over.second ? [{ key: "fo2", def: printing(OVERSEER), owner: P1, zone: "play" as const, depleted: true }] : []),
      { key: "c2", def: C2(), owner: P2, zone: "hand" },
      ...bank("greed", p2res, P2),
      ...(over.extra ?? [])
    ],
    { active: P2 }
  );
}

clause(OVERSEER, "0:rule", "printed card: character 2/3/4 (employee, mau), cost 4 gg: exact deploys; a resource short and a [G] short refuse", () => {
  const mk = (cards: CardPlacement[]) => game([{ key: "fo", def: printing(OVERSEER), owner: P1, zone: "hand" }, ...cards]);
  const exact = mk(bank("greed", 4, P1));
  const d = exact.engine.getDefinition(exact.id("fo"));
  assert.equal(d.type, "character");
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "gg");
  assert.deepEqual([...(d.subtype ?? [])], ["employee", "mau"]);
  play(exact.engine, P1, exact.id("fo"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("fo")), "play");
  assert.equal(exact.engine.getStat(exact.id("fo"), "strength"), 2);
  assert.equal(exact.engine.getStat(exact.id("fo"), "speed"), 3);
  assert.equal(exact.engine.getStat(exact.id("fo"), "life"), 4);
  assert.equal(available(exact.engine, P1), 0);
  const short = mk(bank("greed", 3, P1));
  refused(() => play(short.engine, P1, short.id("fo")), "3 resources", /threshold|afford|resource|pay|cost/i);
  const iconShort = mk([...bank("greed", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(iconShort.engine, P1, iconShort.id("fo")), "one [G] short", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(iconShort.engine, iconShort.id("fo")), "hand");
});

clause(OVERSEER, "0:rule", "while depleted, the opponent pays 1 more: a cost-2 character needs 3 resources (2 refused, 3 deploys and spends all 3)", () => {
  const two = overseerBoard(2);
  assert.equal(two.engine.getCardPlayability(P2, two.id("c2")).numericCost, 3);
  refused(() => play(two.engine, P2, two.id("c2")), "2 resources against the tax", /threshold|afford|resource|pay|cost/i);
  assert.equal(zoneOf(two.engine, two.id("c2")), "hand");
  const three = overseerBoard(3);
  play(three.engine, P2, three.id("c2"));
  drain(three.engine, declineAll);
  assert.equal(zoneOf(three.engine, three.id("c2")), "play");
  assert.equal(available(three.engine, P2), 0, "paid 2 + 1");
});

clause(OVERSEER, "0:rule", "not depleted: no tax (2 resources deploy the cost-2 character); depleting it turns the tax on, restoring turns it off", () => {
  const b = overseerBoard(2, { depleted: false });
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 2);
  b.engine.state.cards[b.id("fo")].depleted = true;
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 3, "depleted");
  b.engine.state.cards[b.id("fo")].depleted = false;
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 2, "restored");
  play(b.engine, P2, b.id("c2"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  assert.equal(available(b.engine, P2), 0);
});

clause(OVERSEER, "0:rule", "the tax applies to every card type deployed: free cards, items, locations and tactics each cost 1 more", () => {
  const b = overseerBoard(1, {
    extra: [
      { key: "free", def: character({ name: "Freebie", cost: 0 }), owner: P2, zone: "hand" },
      { key: "it", def: item({ name: "Gizmo", cost: 0 }), owner: P2, zone: "hand" },
      { key: "loc", def: location({ name: "Shack", cost: 0, structure: 2 }), owner: P2, zone: "hand" },
      { key: "tac", def: zap(1), owner: P2, zone: "hand" }
    ]
  });
  for (const k of ["free", "it", "loc", "tac"]) assert.equal(b.engine.getCardPlayability(P2, b.id(k)).numericCost, 1, `${k} costs 1`);
  const noRes = overseerBoard(0, { extra: [{ key: "free", def: character({ name: "Freebie", cost: 0 }), owner: P2, zone: "hand" }] });
  refused(() => play(noRes.engine, P2, noRes.id("free")), "free card, no resources", /threshold|afford|resource|pay|cost/i);
  play(b.engine, P2, b.id("free"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("free")), "play");
  assert.equal(available(b.engine, P2), 0);
});

clause(OVERSEER, "0:rule", "only my OPPONENTS pay: my own deploys while it is depleted cost the printed amount", () => {
  const b = game(
    [
      { key: "fo", def: printing(OVERSEER), owner: P1, zone: "play", depleted: true },
      { key: "mine", def: C2(), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ],
    { active: P1 }
  );
  assert.equal(b.engine.getCardPlayability(P1, b.id("mine")).numericCost, 2);
  play(b.engine, P1, b.id("mine"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(OVERSEER, "0:rule", "it is MY Overseer's tax: an Overseer controlled by the opponent taxes me, not them", () => {
  const b = game(
    [
      { key: "fo", def: printing(OVERSEER), owner: P2, zone: "play", depleted: true },
      { key: "mine", def: C2(), owner: P1, zone: "hand" },
      { key: "theirs", def: C2(), owner: P2, zone: "hand" }
    ],
    { active: P1 }
  );
  assert.equal(b.engine.getCardPlayability(P1, b.id("mine")).numericCost, 3);
  assert.equal(b.engine.getCardPlayability(P2, b.id("theirs")).numericCost, 2);
});

clause(OVERSEER, "0:rule", "the tax is attached to the card being in play: gone once the Overseer is destroyed", () => {
  const b = overseerBoard(2, { extra: [{ key: "smash", def: smash(), owner: P2, zone: "hand" }] });
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 3);
  play(b.engine, P2, b.id("smash"), { selected: { t: [b.id("fo")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("fo")), "discard");
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 2);
});

clause(OVERSEER, "0:rule", "two depleted Overseers each add 1 (the cost-2 character costs 4)", () => {
  const b = overseerBoard(4, { second: true });
  assert.equal(b.engine.getCardPlayability(P2, b.id("c2")).numericCost, 4);
});

clause(OVERSEER, "0:rule", "a card deployed with FLIP UP is deployed too: the face-down Cove costs 3 to flip while the Overseer is depleted", () => {
  const mk = (taxed: boolean, greed: number) =>
    game(
      [
        { key: "fo", def: printing(OVERSEER), owner: P1, zone: "play", depleted: taxed },
        { key: "cove", def: printing(COVE), owner: P2, zone: "play", faceDown: true },
        ...bank("greed", greed, P2)
      ],
      { active: P2 }
    );
  const free = mk(false, 1);
  flipUp(free.engine, P2, free.id("cove"));
  drain(free.engine, declineAll);
  assert.equal(stateOf(free.engine, free.id("cove")).faceDown, false, "control: 1 greed + itself, no tax");
  const taxedShort = mk(true, 1);
  refused(() => flipUp(taxedShort.engine, P2, taxedShort.id("cove")), "FLIP UP taxed", /threshold|afford|resource|pay|cost/i);
  assert.equal(stateOf(taxedShort.engine, taxedShort.id("cove")).faceDown, true);
  const taxedOk = mk(true, 2);
  flipUp(taxedOk.engine, P2, taxedOk.id("cove"));
  drain(taxedOk.engine, declineAll);
  assert.equal(stateOf(taxedOk.engine, taxedOk.id("cove")).faceDown, false);
  assert.equal(available(taxedOk.engine, P2), 0, "paid 3 of 3");
});

function overseerFlip(extra: CardPlacement[], greed = 4, rage = 0) {
  return game(
    [
      { key: "fo", def: printing(OVERSEER), owner: P1, zone: "play", faceDown: true },
      ...bank("greed", greed, P1),
      ...bank("rage", rage, P1),
      ...extra
    ]
  );
}

const locs = (): CardPlacement[] => [
  { key: "myLoc", def: location({ name: "MyLoc", structure: 4 }), owner: P1, zone: "play", damage: 2 },
  { key: "oppLoc", def: location({ name: "OppLoc", structure: 4 }), owner: P2, zone: "play", damage: 2 },
  { key: "fresh", def: location({ name: "Fresh", structure: 4 }), owner: P2, zone: "play" },
  { key: "chr", def: character({ name: "Bystander", life: 9 }), owner: P2, zone: "play" }
];

clause(OVERSEER, "1:flipUp", "FLIP UP costs 4 with [G][G]: 2 greed + 1 rage + itself pays exactly 4 and flips it up", () => {
  const b = overseerFlip(locs(), 2, 1);
  flipUp(b.engine, P1, b.id("fo"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "then I may pick a location");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(stateOf(b.engine, b.id("fo")).faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("fo")), "play");
  assert.equal(available(b.engine, P1), 0, "4 paid out of 2 greed + rage + itself");
});

clause(OVERSEER, "1:flipUp", "FLIP UP refused one resource short (2 greed + itself = 3 of 4) and one [G] short (1 greed + 2 rage + itself)", () => {
  const short = overseerFlip(locs(), 2);
  refused(() => flipUp(short.engine, P1, short.id("fo")), "3 resources for cost 4", /threshold|afford|resource|pay|cost/i);
  assert.equal(stateOf(short.engine, short.id("fo")).faceDown, true);
  const iconShort = overseerFlip(locs(), 1, 2);
  assert.equal(available(iconShort.engine, P1), 4, "cost is payable");
  refused(() => flipUp(iconShort.engine, P1, iconShort.id("fo")), "only one [G]", /threshold|icon/i);
  assert.equal(stateOf(iconShort.engine, iconShort.id("fo")).faceDown, true);
  assert.equal(available(iconShort.engine, P1), 4, "nothing paid");
});

clause(OVERSEER, "1:flipUp", "its own icon can't count for the threshold: Overseer is not a resource icon source (1 greed + 2 rage + itself is [G] short, see above), and a face-up Overseer can't be flipped", () => {
  const b = game([{ key: "fo", def: printing(OVERSEER), owner: P1, zone: "play" }, ...bank("greed", 4, P1)]);
  refused(() => flipUp(b.engine, P1, b.id("fo")), "already face-up");
});

function flipAndAdd(target: string, optionIndex: number) {
  const b = overseerFlip(locs());
  flipUp(b.engine, P1, b.id("fo"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(target)] });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex });
  assert.equal(b.engine.state.pendingChoice, undefined);
  return b;
}

clause(OVERSEER, "1:flipUp", "'and you may add ... a damage marker': pick my location, add: it gets one more marker (2 -> 3)", () => {
  const b = flipAndAdd("myLoc", 0);
  assert.equal(stateOf(b.engine, b.id("myLoc")).damage, 3);
  assert.equal(stateOf(b.engine, b.id("oppLoc")).damage, 2, "others untouched");
  assert.equal(stateOf(b.engine, b.id("fo")).faceDown, false);
});

clause(OVERSEER, "1:flipUp", "any location may be picked: the opponent's gets a marker (2 -> 3), an undamaged one 0 -> 1", () => {
  const opp = flipAndAdd("oppLoc", 0);
  assert.equal(stateOf(opp.engine, opp.id("oppLoc")).damage, 3);
  assert.equal(stateOf(opp.engine, opp.id("myLoc")).damage, 2);
  const fresh = flipAndAdd("fresh", 0);
  assert.equal(stateOf(fresh.engine, fresh.id("fresh")).damage, 1);
});

clause(OVERSEER, "1:flipUp", "'or remove': remove a damage marker (2 -> 1) from my location and from the opponent's", () => {
  const mine = flipAndAdd("myLoc", 1);
  assert.equal(stateOf(mine.engine, mine.id("myLoc")).damage ?? 0, 1);
  assert.equal(stateOf(mine.engine, mine.id("oppLoc")).damage, 2);
  const opp = flipAndAdd("oppLoc", 1);
  assert.equal(stateOf(opp.engine, opp.id("oppLoc")).damage ?? 0, 1);
});

clause(OVERSEER, "1:flipUp", "removing from an undamaged location leaves it at 0 (never negative)", () => {
  const b = flipAndAdd("fresh", 1);
  assert.equal(stateOf(b.engine, b.id("fresh")).damage ?? 0, 0);
});

clause(OVERSEER, "1:flipUp", "adding the last needed marker destroys the location (structure 3, damage 2 -> 3)", () => {
  const b = overseerFlip([{ key: "weak", def: location({ name: "Weak", structure: 3 }), owner: P2, zone: "play", damage: 2 }]);
  flipUp(b.engine, P1, b.id("fo"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("weak")] });
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
});

clause(OVERSEER, "1:flipUp", "'you may': declining the location pick changes no location, but the card is still flipped up", () => {
  const b = overseerFlip(locs());
  flipUp(b.engine, P1, b.id("fo"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(stateOf(b.engine, b.id("fo")).faceDown, false);
  assert.equal(stateOf(b.engine, b.id("myLoc")).damage, 2);
  assert.equal(stateOf(b.engine, b.id("oppLoc")).damage, 2);
});

clause(OVERSEER, "1:flipUp", "only a location can be picked: a character is refused (control: a location is accepted)", () => {
  const b = overseerFlip(locs());
  flipUp(b.engine, P1, b.id("fo"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("chr")] }), "a character is not a location");
  assert.equal(stateOf(b.engine, b.id("chr")).damage ?? 0, 0);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fresh")] });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(OVERSEER, "1:flipUp", "'a location' is ONE card: picking two locations is refused (control: one is accepted)", () => {
  const b = overseerFlip(locs());
  flipUp(b.engine, P1, b.id("fo"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("myLoc"), b.id("oppLoc")] }), "two locations picked");
  assert.equal(stateOf(b.engine, b.id("myLoc")).damage, 2, "nothing changed on the first location");
  assert.equal(stateOf(b.engine, b.id("oppLoc")).damage, 2, "nothing changed on the second location");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("myLoc")] });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "control: one location is accepted");
});

clause(OVERSEER, "1:flipUp", "FLIP UP of a non-tactic is refused inside the opponent's response window", () => {
  const b = game(
    [
      { key: "fo", def: printing(OVERSEER), owner: P1, zone: "play", faceDown: true },
      ...bank("greed", 4, P1),
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b.engine, P1, b.id("fo")), "opponent's response window", /response|window|turn|tactic|only/i);
  assert.equal(stateOf(b.engine, b.id("fo")).faceDown, true);
});

// keep unused helper imports referenced
void declareAttackBy;
void (null as unknown as CardDefinition);
