import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  inPlay,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  type StapleIcon
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackOpenWindow } from "./_battle.js";
import { pending, readyResources, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
type Game = ReturnType<typeof buildGame>;
type Engine = Game["engine"];

const BOUFFANT = "e2172d8d-8763-4e99-bbc5-11e029742f34"; // When this card enters play, you may destroy an item. -- FLIP UP: 6 [E]
const C31F = "f35d75e8-7031-4614-b933-cd1e3420c39c"; // While there is a location or item in play, this card gains 2 strength and 2 life.
const CUFFS = "7a43c5fd-16bd-4f30-880a-3064c0ca8d6e"; // ATTACH TO CHARACTER -- The attached character loses COVERT. If the attached character has a [V] icon in its rules text, treat the attached character as though it has no rules text. -- MOVE -- COST: Pick a character that is not in battle. Pay 2. -- EFFECT: Attach this card to the character. -- FLIP UP: 1 [E]
const DRAINBOW = "d99c85ec-5f5b-4afb-9059-c1c326bf8fdf"; // PROVIDES: [E][E] -- FLIP UP: 5 [E] and you may pick an item. If you do, destroy it.
const ENGINEER = "4483793f-611d-49f0-8e9e-dea88e64400a"; // This card gains 1 strength and 1 life for each different staple resource you control.
const EMM = "40bddb30-5bc1-4ff8-9daf-3d8afd8cfc91"; // UNIQUE EX MACHINA -- When this card enters play, all your characters gain 1 strength and 1 life this turn. -- When this card leaves play, you may put up to five Micromajigs into play.
const HOTTIE = "59c7f2ec-2f3e-4260-b819-b90e859bdef9"; // When this card enters play, your faction loses 2 influence. -- [V][V][V][V]: This card gains COVERT.

const sides = { playerA: { faction: developFaction() }, playerB: { faction: developFaction() } };
const FACTION_P1 = { type: "faction", playerId: P1 } as const;
const THRESHOLD_RE = /Threshold requirements are not met/;
const COST_RE = /Costs cannot be paid/;
const FU_THRESHOLD_RE = /FLIP UP threshold requirements are not met/;
const FU_COST_RE = /FLIP UP costs cannot be paid/;
const AB_COST_RE = /Ability costs cannot be paid/;

const ready = (engine: Engine) => readyResources(engine, P1);
const staple = (name: string, icon: StapleIcon) => resourceCard({ name, resource: { provides: [icon], staple: true } });
const hasCovert = (engine: Engine, cardId: string) => engine.getKeywords(cardId).includes("covert");
const grid = (engine: Engine, cardId: string) => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "speed"),
  engine.getStat(cardId, "life")
];

const flipUpRaw = (engine: Engine, player: string, cardId: string, selected: Record<string, string[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const flipUp = (engine: Engine, player: string, cardId: string, selected: Record<string, string[]> = {}) => {
  flipUpRaw(engine, player, cardId, selected);
  resolvePendingResponses(engine);
};
/** Answers the open chooserSelectsTarget choice (and drains responses). */
const pick = (engine: Engine, selected: string[], player: string = P1) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
};
const tryPick = (engine: Engine, selected: string[], player: string = P1) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);

/** A free tactic that destroys one picked card in play (decl `t`). */
const KILL = () =>
  tactic({
    name: "Kill",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
/** A free tactic that returns one picked card in play to its owner's hand. */
const BOUNCE = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  } as never);

const deployBoard = (id: string, banks: Cards, extra: Cards = []) =>
  buildGame({ ...sides, cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...banks, ...extra] });

// ============================================================================
// Billowing Bouffant -- character cost 6 [E], 5/3/6 monstrosity
// ============================================================================

const bouffantHand = (extra: Cards = [], banks: Cards = bank("elitism", 6, P1)) =>
  buildGame({ ...sides, cards: [{ key: "bb", def: printing(BOUFFANT), owner: P1, zone: "hand" }, ...banks, ...extra] });

clause(BOUFFANT, "0:rule", "printed as a Gearsmith monstrosity character, cost 6, threshold [E]", () => {
  const p = printing(BOUFFANT);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["monstrosity"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "e");
});

clause(BOUFFANT, "0:rule", "deploys for exactly 6 with one [E]: six Elitism pay all of it, and it enters as a 5/3/6", () => {
  const b = bouffantHand();
  play(b.engine, P1, b.id("bb"));
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  assert.equal(ready(b.engine), 0, "all six paid");
  assert.deepEqual(grid(b.engine, b.id("bb")), [5, 3, 6]);
});

clause(BOUFFANT, "0:rule", "one resource short of 6 is refused", () => {
  const b = bouffantHand([], bank("elitism", 5, P1));
  refused(() => play(b.engine, P1, b.id("bb")), "only five resources", COST_RE);
  assert.equal(zoneOf(b.engine, b.id("bb")), "hand");
});

clause(BOUFFANT, "0:rule", "threshold [E]: six non-Elitism resources are refused, five Rage plus one Elitism works", () => {
  const no = bouffantHand([], bank("rage", 6, P1));
  refused(() => play(no.engine, P1, no.id("bb")), "no [E] icon", THRESHOLD_RE);
  assert.equal(zoneOf(no.engine, no.id("bb")), "hand");
  const yes = bouffantHand([], [...bank("rage", 5, P1), ...bank("elitism", 1, P1)]);
  play(yes.engine, P1, yes.id("bb"));
  assert.equal(zoneOf(yes.engine, yes.id("bb")), "play");
});

clause(BOUFFANT, "0:rule", "ETB: I may destroy an opponent's item; it goes to its owner's discard", () => {
  const b = bouffantHand([{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("bb"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("it")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  assert.equal(b.engine.state.players[P2].discard.includes(b.id("it")), true);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
});

clause(BOUFFANT, "0:rule", "ETB: I may destroy one of my own items", () => {
  const b = bouffantHand([{ key: "mine", def: item({ name: "Mine" }), owner: P1, zone: "play" }, { key: "theirs", def: item({ name: "Theirs" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("bb"));
  pick(b.engine, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "only the picked item");
});

clause(BOUFFANT, "0:rule", "ETB 'may': declining the pick destroys nothing", () => {
  const b = bouffantHand([{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("bb"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
});

clause(BOUFFANT, "0:rule", "ETB: only an ITEM in play can be picked (not a character or a location), and only one", () => {
  const b = bouffantHand([
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
    { key: "it2", def: item({ name: "It2" }), owner: P2, zone: "play" },
    { key: "ch", def: character({ name: "Ch" }), owner: P2, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
    { key: "handIt", def: item({ name: "HandIt" }), owner: P2, zone: "hand" },
    { key: "discIt", def: item({ name: "DiscIt" }), owner: P2, zone: "discard" }
  ]);
  play(b.engine, P1, b.id("bb"));
  refused(tryPick(b.engine, [b.id("ch")]), "a character is not an item");
  refused(tryPick(b.engine, [b.id("lo")]), "a location is not an item");
  refused(tryPick(b.engine, [b.id("handIt")]), "an item in hand is not in play");
  refused(tryPick(b.engine, [b.id("discIt")]), "an item in the discard pile is not in play");
  refused(tryPick(b.engine, [b.id("it"), b.id("it2")]), "an item (one)");
  pick(b.engine, [b.id("it2")]);
  assert.equal(zoneOf(b.engine, b.id("it2")), "discard");
  for (const k of ["it", "ch", "lo"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
});

clause(BOUFFANT, "0:rule", "ETB with no item in play: nothing to pick, no prompt, no effect", () => {
  const b = bouffantHand([{ key: "ch", def: character({ name: "Ch" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("bb"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  assert.equal(zoneOf(b.engine, b.id("ch")), "play");
});

clause(BOUFFANT, "0:rule", "the trigger is only for THIS card entering: another character entering later gives no item prompt", () => {
  const b = bouffantHand([
    { key: "bbIn", def: printing(BOUFFANT), owner: P1, zone: "play" },
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
    { key: "late", def: character({ name: "Late", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("late"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
});

const bouffantFaceDown = (banks: Cards, extra: Cards = [], opts: Record<string, unknown> = {}) =>
  buildGame({ ...sides, ...opts, cards: [{ key: "bb", def: printing(BOUFFANT), owner: P1, zone: "play", faceDown: true }, ...banks, ...extra] });

clause(BOUFFANT, "1:flipUp", "FLIP UP 6 [E]: six Elitism others pay it and the card turns face-up", () => {
  const b = bouffantFaceDown(bank("elitism", 6, P1));
  flipUp(b.engine, P1, b.id("bb"));
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  assert.equal(ready(b.engine), 0, "six resources spent");
  assert.deepEqual(grid(b.engine, b.id("bb")), [5, 3, 6]);
});

clause(BOUFFANT, "1:flipUp", "FLIP UP cost may include the card itself: five Elitism others plus the face-down card pay the 6", () => {
  const b = bouffantFaceDown(bank("elitism", 5, P1));
  flipUp(b.engine, P1, b.id("bb"));
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
});

clause(BOUFFANT, "1:flipUp", "FLIP UP is refused one resource short (four others plus itself = 5 < 6)", () => {
  const b = bouffantFaceDown(bank("elitism", 4, P1));
  refused(() => flipUpRaw(b.engine, P1, b.id("bb")), "5 < 6", FU_COST_RE);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
});

clause(BOUFFANT, "1:flipUp", "FLIP UP threshold [E]: six Rage others are refused (itself is only Volition), one Elitism among them works", () => {
  const no = bouffantFaceDown(bank("rage", 6, P1));
  refused(() => flipUpRaw(no.engine, P1, no.id("bb")), "no [E] icon", FU_THRESHOLD_RE);
  assert.equal(no.engine.state.cards[no.id("bb")].faceDown, true);
  const yes = bouffantFaceDown([...bank("rage", 5, P1), ...bank("elitism", 1, P1)]);
  flipUp(yes.engine, P1, yes.id("bb"));
  assert.equal(yes.engine.state.cards[yes.id("bb")].faceDown, false);
});

clause(BOUFFANT, "0:rule", "a FLIP UP deploys it as though from hand (RULES FLIP UP): the ETB 'may destroy an item' fires and works", () => {
  const b = bouffantFaceDown(bank("elitism", 6, P1), [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  flipUp(b.engine, P1, b.id("bb"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("it")]);
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
});

clause(BOUFFANT, "1:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window (own turn works)", () => {
  const b = bouffantFaceDown(bank("elitism", 6, P1), [{ key: "oa", def: character({ name: "OA" }), owner: P2, zone: "play" }], { turn: 3, activePlayerId: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  refused(() => flipUpRaw(b.engine, P1, b.id("bb")), "character FLIP UP in the opponent's window");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  const own = bouffantFaceDown(bank("elitism", 6, P1));
  flipUp(own.engine, P1, own.id("bb"));
  assert.equal(own.engine.state.cards[own.id("bb")].faceDown, false);
});

// ============================================================================
// Customized 31f -- character cost 5 [EE], 4/1/4
// ============================================================================

const c31Board = (extra: Cards = []) => buildGame({ ...sides, cards: [{ key: "c31", def: printing(C31F), owner: P1, zone: "play" }, ...extra] });

clause(C31F, "0:rule", "printed as a Gearsmith '31f' character, cost 5, threshold [EE], base 4/1/4", () => {
  const p = printing(C31F);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["31f"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "ee");
  const b = c31Board();
  assert.deepEqual(grid(b.engine, b.id("c31")), [4, 1, 4], "no location or item: printed stats");
});

clause(C31F, "0:rule", "deploys for exactly 5 with [EE]; refused at 4 resources and with only one [E]", () => {
  const ok = deployBoard(C31F, bank("elitism", 5, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 0);
  const mixed = deployBoard(C31F, [...bank("elitism", 2, P1), ...bank("rage", 3, P1)]);
  play(mixed.engine, P1, mixed.id("c"));
  assert.equal(zoneOf(mixed.engine, mixed.id("c")), "play");
  const short = deployBoard(C31F, bank("elitism", 4, P1));
  refused(() => play(short.engine, P1, short.id("c")), "4 < 5", COST_RE);
  const oneIcon = deployBoard(C31F, [...bank("elitism", 1, P1), ...bank("rage", 4, P1)]);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("c")), "only one [E]", THRESHOLD_RE);
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("c")), "hand");
});

clause(C31F, "0:rule", "while an item is in play (mine): +2 strength and +2 life", () => {
  const b = c31Board([{ key: "it", def: item({ name: "It" }), owner: P1, zone: "play" }]);
  assert.deepEqual(grid(b.engine, b.id("c31")), [6, 1, 6]);
});

clause(C31F, "0:rule", "an opponent's item counts as well (any item in play)", () => {
  const b = c31Board([{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  assert.deepEqual(grid(b.engine, b.id("c31")), [6, 1, 6]);
});

clause(C31F, "0:rule", "a location in play (either player's) counts too", () => {
  const mine = c31Board([{ key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" }]);
  assert.deepEqual(grid(mine.engine, mine.id("c31")), [6, 1, 6]);
  const theirs = c31Board([{ key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" }]);
  assert.deepEqual(grid(theirs.engine, theirs.id("c31")), [6, 1, 6]);
});

clause(C31F, "0:rule", "the bonus is flat: an item and a location together (and several items) still give only +2/+2", () => {
  const b = c31Board([
    { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
    { key: "it2", def: item({ name: "It2" }), owner: P2, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" }
  ]);
  assert.deepEqual(grid(b.engine, b.id("c31")), [6, 1, 6]);
});

clause(C31F, "0:rule", "characters, and items/locations outside play, do not turn it on", () => {
  const b = c31Board([
    { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "play" },
    { key: "hi", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
    { key: "di", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" },
    { key: "dl", def: location({ name: "DeckLoc" }), owner: P2, zone: "deck" }
  ]);
  assert.deepEqual(grid(b.engine, b.id("c31")), [4, 1, 4]);
});

clause(C31F, "0:rule", "the bonus ends when the last item/location leaves, and returns when another arrives", () => {
  const b = c31Board([
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
    { key: "kill", def: KILL(), owner: P1, zone: "hand" },
    { key: "kill2", def: KILL(), owner: P1, zone: "hand" },
    { key: "back", def: item({ name: "Back", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(grid(b.engine, b.id("c31")), [6, 1, 6]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("it")] } });
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  assert.deepEqual(grid(b.engine, b.id("c31")), [4, 1, 4], "off again");
  play(b.engine, P1, b.id("back"));
  assert.deepEqual(grid(b.engine, b.id("c31")), [6, 1, 6], "on again");
});

clause(C31F, "0:rule", "only this card gains the bonus; the damage it has taken is untouched by it; it is off once the card is gone", () => {
  const b = c31Board([
    { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
    { key: "kill", def: KILL(), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [2, 2]);
  assert.deepEqual([b.engine.getStat(b.id("foe"), "strength"), b.engine.getStat(b.id("foe"), "life")], [2, 2]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("c31")] } });
  assert.equal(zoneOf(b.engine, b.id("c31")), "discard");
  assert.deepEqual([b.engine.getStat(b.id("c31"), "strength"), b.engine.getStat(b.id("c31"), "life")], [4, 4], "in the discard pile it reads printed stats");
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [2, 2]);
});

// ============================================================================
// Direstock Cuffs -- item (gear) cost 1 [E], ATTACH TO CHARACTER
// ============================================================================

const covertHost = (name: string) => character({ name, behavior: { keywords: ["covert"] } } as never);
const cuffsHand = (hostDef: ReturnType<typeof character>, hostOwner: string = P1, banks: Cards = bank("elitism", 1, P1), extra: Cards = []) =>
  buildGame({
    ...sides,
    cards: [
      { key: "cuffs", def: printing(CUFFS), owner: P1, zone: "hand" },
      { key: "host", def: hostDef, owner: hostOwner as never, zone: "play" },
      ...banks,
      ...extra
    ]
  });
const cuffsOn = (hosts: Array<[string, ReturnType<typeof character>]>, banks: Cards = bank("elitism", 2, P1), extra: Cards = [], opts: Record<string, unknown> = {}) =>
  buildGame({
    ...sides,
    ...opts,
    cards: [
      ...hosts.map(([key, def]) => ({ key, def, owner: P1, zone: "play" as const })),
      { key: "cuffs", def: printing(CUFFS), owner: P1, zone: "play", attachedToKey: hosts[0][0] },
      ...banks,
      ...extra
    ]
  });

clause(CUFFS, "0:attach", "printed as a Gearsmith gear item, cost 1, threshold [E]", () => {
  const p = printing(CUFFS);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["gear"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "e");
});

clause(CUFFS, "0:attach", "deploys for exactly 1 [E], attached to the chosen character; refused with no resource or with a non-Elitism one", () => {
  const ok = cuffsHand(covertHost("Host"));
  play(ok.engine, P1, ok.id("cuffs"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("cuffs")), "play");
  assert.equal(ok.engine.state.cards[ok.id("cuffs")].attachedTo, ok.id("host"));
  assert.equal(ready(ok.engine), 0, "the one resource was spent");
  const none = cuffsHand(covertHost("Host"), P1, []);
  refused(() => play(none.engine, P1, none.id("cuffs"), { selected: { attachTo: [none.id("host")] } }), "no resource", /Threshold requirements are not met|Costs cannot be paid/);
  const wrong = cuffsHand(covertHost("Host"), P1, bank("rage", 1, P1));
  refused(() => play(wrong.engine, P1, wrong.id("cuffs"), { selected: { attachTo: [wrong.id("host")] } }), "no [E] icon", THRESHOLD_RE);
  assert.equal(zoneOf(wrong.engine, wrong.id("cuffs")), "hand");
});

clause(CUFFS, "0:attach", "ATTACH TO CHARACTER: an opponent's character is a legal host", () => {
  const b = cuffsHand(covertHost("Host"), P2);
  play(b.engine, P1, b.id("cuffs"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("host"));
  assert.equal(hasCovert(b.engine, b.id("host")), false);
});

clause(CUFFS, "0:attach", "ATTACH TO CHARACTER: an item or a location is refused as a host, and so is no host at all", () => {
  const b = cuffsHand(character({ name: "Host" }), P1, bank("elitism", 1, P1), [
    { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" }
  ]);
  refused(() => play(b.engine, P1, b.id("cuffs"), { selected: { attachTo: [b.id("it")] } }), "an item host");
  refused(() => play(b.engine, P1, b.id("cuffs"), { selected: { attachTo: [b.id("lo")] } }), "a location host");
  refused(() => play(b.engine, P1, b.id("cuffs"), { selected: {} }), "no host");
  assert.equal(zoneOf(b.engine, b.id("cuffs")), "hand");
  play(b.engine, P1, b.id("cuffs"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("cuffs")), "play", "a character host works");
});

clause(CUFFS, "1:rule", "the attached character loses COVERT; without the Cuffs it has it; its other keywords stay", () => {
  const host = character({ name: "Host", behavior: { keywords: ["covert", "aggro"] } } as never);
  const bare = buildGame({ ...sides, cards: [{ key: "host", def: host, owner: P1, zone: "play" }] });
  assert.equal(hasCovert(bare.engine, bare.id("host")), true, "control: covert before the Cuffs");
  const b = cuffsOn([["host", host]]);
  assert.equal(hasCovert(b.engine, b.id("host")), false);
  assert.equal(b.engine.getKeywords(b.id("host")).includes("aggro" as never), true, "only COVERT is lost");
});

clause(CUFFS, "1:rule", "only the ATTACHED character loses COVERT: another covert character is unaffected", () => {
  const b = cuffsOn([["host", covertHost("Host")], ["other", covertHost("Other")]]);
  assert.equal(hasCovert(b.engine, b.id("host")), false);
  assert.equal(hasCovert(b.engine, b.id("other")), true);
});

clause(CUFFS, "1:rule", "the COVERT loss ends when the Cuffs leave play", () => {
  const b = cuffsOn([["host", covertHost("Host")]], bank("elitism", 2, P1), [{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]);
  assert.equal(hasCovert(b.engine, b.id("host")), false);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("cuffs")] } });
  assert.equal(zoneOf(b.engine, b.id("cuffs")), "discard");
  assert.equal(hasCovert(b.engine, b.id("host")), true, "covert is back");
});

const buffHost = (text: string) =>
  character({
    name: `Buffed ${text}`,
    text,
    strength: 1,
    life: 1,
    behavior: {
      abilities: [{ id: "buff", type: "continuous", modifiers: [{ type: "createModifier", target: "source", stat: "strength", operation: "add", value: 2, duration: { type: "whileSourceInPlay" } }] }]
    }
  } as never);

clause(CUFFS, "1:rule", "a host with a [V] icon in its rules text is treated as having NO rules text (its static ability stops), stats stay printed", () => {
  const free = buildGame({ ...sides, cards: [{ key: "host", def: buffHost("[V]: This card gains 2 strength."), owner: P1, zone: "play" }] });
  assert.equal(free.engine.getStat(free.id("host"), "strength"), 3, "control: the ability works without Cuffs");
  const b = cuffsOn([["host", buffHost("[V]: This card gains 2 strength.")]]);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1, "ability off");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 1);
});

clause(CUFFS, "1:rule", "a host WITHOUT a [V] icon in its text keeps its rules text", () => {
  const b = cuffsOn([["host", buffHost("This card gains 2 strength.")]]);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3, "ability still on");
});

clause(CUFFS, "1:rule", "the text loss is only for the attached character, and ends when the Cuffs leave", () => {
  const b = cuffsOn(
    [["host", buffHost("[V]: This card gains 2 strength.")], ["other", buffHost("[V]: Other gains 2 strength.")]],
    bank("elitism", 2, P1),
    [{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]
  );
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("other"), "strength"), 3, "an unattached [V] character keeps its text");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("cuffs")] } });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3, "text back");
});

clause(CUFFS, "1:rule", "a real [V] card (Hottie: static COVERT with four Volition) is stripped: not covert with the Cuffs, covert without", () => {
  const vol = (n: number): Cards => Array.from({ length: n }, (_, i) => ({ key: `fd${i}`, def: character({ name: `FD${i}` }), owner: P1, zone: "play" as const, faceDown: true }));
  const free = buildGame({ ...sides, cards: [{ key: "host", def: printing(HOTTIE), owner: P1, zone: "play" }, ...vol(4)] });
  assert.equal(hasCovert(free.engine, free.id("host")), true, "control: Hottie is covert with [V][V][V][V]");
  const b = buildGame({
    ...sides,
    cards: [{ key: "host", def: printing(HOTTIE), owner: P1, zone: "play" }, { key: "cuffs", def: printing(CUFFS), owner: P1, zone: "play", attachedToKey: "host" }, ...vol(4)]
  });
  assert.equal(hasCovert(b.engine, b.id("host")), false);
});

clause(CUFFS, "1:rule", "'no rules text' includes keywords: a [V] host's AGGRO is lost too", () => {
  const host = character({ name: "VAggro", text: "[V]: do nothing.", behavior: { keywords: ["aggro"] } } as never);
  const bare = buildGame({ ...sides, cards: [{ key: "host", def: host, owner: P1, zone: "play" }] });
  assert.equal(bare.engine.getKeywords(bare.id("host")).includes("aggro" as never), true, "control");
  const b = cuffsOn([["host", host]]);
  assert.equal(b.engine.getKeywords(b.id("host")).includes("aggro" as never), false);
});

clause(CUFFS, "2:ability:move", "MOVE: pays 2 and re-attaches the Cuffs to the picked character (old host regains COVERT, new host loses it)", () => {
  const b = cuffsOn([["h1", covertHost("H1")], ["h2", covertHost("H2")]]);
  assert.equal(hasCovert(b.engine, b.id("h1")), false);
  assert.equal(hasCovert(b.engine, b.id("h2")), true);
  activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("h2")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("h2"));
  assert.equal(zoneOf(b.engine, b.id("cuffs")), "play");
  assert.equal(ready(b.engine), 0, "Pay 2");
  assert.equal(hasCovert(b.engine, b.id("h1")), true);
  assert.equal(hasCovert(b.engine, b.id("h2")), false);
});

clause(CUFFS, "2:ability:move", "MOVE: an opponent's character is a legal pick", () => {
  const b = cuffsOn([["h1", covertHost("H1")]], bank("elitism", 2, P1), [{ key: "foe", def: covertHost("Foe"), owner: P2, zone: "play" }]);
  activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("foe"));
  assert.equal(hasCovert(b.engine, b.id("foe")), false);
});

clause(CUFFS, "2:ability:move", "MOVE costs 2: one resource is refused, exactly two works, extras stay ready", () => {
  const one = cuffsOn([["h1", covertHost("H1")], ["h2", covertHost("H2")]], bank("elitism", 1, P1));
  refused(() => activate(one.engine, P1, one.id("cuffs"), "move", { selected: { c: [one.id("h2")] } }), "1 < 2", AB_COST_RE);
  assert.equal(one.engine.state.cards[one.id("cuffs")].attachedTo, one.id("h1"));
  const three = cuffsOn([["h1", covertHost("H1")], ["h2", covertHost("H2")]], bank("rage", 3, P1));
  activate(three.engine, P1, three.id("cuffs"), "move", { selected: { c: [three.id("h2")] } });
  assert.equal(ready(three.engine), 1, "exactly 2 spent, any icons");
  assert.equal(three.engine.state.cards[three.id("cuffs")].attachedTo, three.id("h2"));
});

clause(CUFFS, "2:ability:move", "MOVE: only a CHARACTER can be picked (not an item or a location)", () => {
  const b = cuffsOn([["h1", covertHost("H1")]], bank("elitism", 2, P1), [
    { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" }
  ]);
  refused(() => activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("it")] } }), "an item");
  refused(() => activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("lo")] } }), "a location");
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("h1"));
  assert.equal(ready(b.engine), 2, "nothing was spent");
});

clause(CUFFS, "2:ability:move", "MOVE: a character in battle cannot be picked; one not in battle can (same window)", () => {
  const b = cuffsOn(
    [["h1", covertHost("H1")], ["calm", covertHost("Calm")]],
    bank("elitism", 4, P1),
    [{ key: "oa", def: character({ name: "OA" }), owner: P2, zone: "play" }],
    { turn: 3, activePlayerId: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  assert.equal(b.engine.state.battle !== undefined, true, "a battle is on");
  refused(() => activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("oa")] } }), "the attacker is in battle", /battle|target|select|valid|illegal/i);
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("h1"));
  activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("calm")] } });
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("calm"), "control: a non-battling character works");
});

clause(CUFFS, "2:ability:move", "MOVE: the character currently attached may be picked (nothing changes but the 2 paid)", () => {
  const b = cuffsOn([["h1", covertHost("H1")]]);
  activate(b.engine, P1, b.id("cuffs"), "move", { selected: { c: [b.id("h1")] } });
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("h1"));
  assert.equal(zoneOf(b.engine, b.id("cuffs")), "play");
  assert.equal(hasCovert(b.engine, b.id("h1")), false);
});

const cuffsFaceDown = (banks: Cards, extra: Cards = [], opts: Record<string, unknown> = {}) =>
  buildGame({
    ...sides,
    ...opts,
    cards: [
      { key: "host", def: covertHost("Host"), owner: P1, zone: "play" },
      { key: "cuffs", def: printing(CUFFS), owner: P1, zone: "play", faceDown: true },
      ...banks,
      ...extra
    ]
  });
const onHost = (b: Game) => ({ attachTo: [b.id("host")] });

clause(CUFFS, "3:flipUp", "FLIP UP 1 [E]: one Elitism pays it; the face-down Cuffs do nothing until flipped, then the host loses COVERT", () => {
  const b = cuffsFaceDown(bank("elitism", 1, P1));
  assert.equal(hasCovert(b.engine, b.id("host")), true, "face-down Cuffs have no rules text yet");
  flipUp(b.engine, P1, b.id("cuffs"), onHost(b));
  assert.equal(b.engine.state.cards[b.id("cuffs")].faceDown, false);
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("host"));
  assert.equal(ready(b.engine), 0);
  assert.equal(hasCovert(b.engine, b.id("host")), false);
});

clause(CUFFS, "3:flipUp", "FLIP UP cost may be paid by the Cuffs themselves, but their [E] threshold needs a real Elitism: Rage and nothing are refused", () => {
  const self = cuffsFaceDown([]);
  refused(() => flipUpRaw(self.engine, P1, self.id("cuffs"), onHost(self)), "itself = Volition, no [E] icon", FU_THRESHOLD_RE);
  const rage = cuffsFaceDown(bank("rage", 1, P1));
  refused(() => flipUpRaw(rage.engine, P1, rage.id("cuffs"), onHost(rage)), "Rage is not [E]", FU_THRESHOLD_RE);
  assert.equal(rage.engine.state.cards[rage.id("cuffs")].faceDown, true);
});

clause(CUFFS, "3:flipUp", "FLIP UP costs exactly 1: with the icon from a PROVIDES card, the face-down Cuffs alone pay it (cost 1, not more)", () => {
  const b = cuffsFaceDown([{ key: "dc", def: printing(DRAINBOW), owner: P1, zone: "play" }]);
  assert.equal(b.engine.getThresholds(P1).elitism, 2, "the provider supplies the [E]");
  flipUp(b.engine, P1, b.id("cuffs"), onHost(b));
  assert.equal(b.engine.state.cards[b.id("cuffs")].faceDown, false);
  assert.equal(b.engine.state.cards[b.id("cuffs")].attachedTo, b.id("host"));
});

clause(CUFFS, "3:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window (own turn works)", () => {
  const b = cuffsFaceDown(bank("elitism", 1, P1), [{ key: "oa", def: character({ name: "OA" }), owner: P2, zone: "play" }], { turn: 3, activePlayerId: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  refused(() => flipUpRaw(b.engine, P1, b.id("cuffs"), onHost(b)), "item FLIP UP in the opponent's window");
  assert.equal(b.engine.state.cards[b.id("cuffs")].faceDown, true);
  const own = cuffsFaceDown(bank("elitism", 1, P1));
  flipUp(own.engine, P1, own.id("cuffs"), onHost(own));
  assert.equal(own.engine.state.cards[own.id("cuffs")].faceDown, false);
});

// ============================================================================
// Drainbow Crash -- character cost 3 [E], 3/3/3 horsemajig, PROVIDES [E][E]
// ============================================================================

const drainBoard = (zone: "play" | "hand", threshold: string, others: Cards = []) =>
  buildGame({
    ...sides,
    cards: [
      { key: "dc", def: printing(DRAINBOW), owner: P1, zone },
      { key: "c", def: character({ name: `C-${threshold}`, cost: 1, threshold: threshold as never }), owner: P1, zone: "hand" },
      ...others
    ]
  });

clause(DRAINBOW, "0:provides", "printed as a Gearsmith horsemajig character, cost 3, threshold [E], 3/3/3", () => {
  const p = printing(DRAINBOW);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["horsemajig"]);
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "e");
});

clause(DRAINBOW, "0:provides", "deploys for exactly 3 with one [E] (3/3/3); refused one short and with no [E]", () => {
  const ok = deployBoard(DRAINBOW, bank("elitism", 3, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 0);
  assert.deepEqual(grid(ok.engine, ok.id("c")), [3, 3, 3]);
  const mixed = deployBoard(DRAINBOW, [...bank("elitism", 1, P1), ...bank("rage", 2, P1)]);
  play(mixed.engine, P1, mixed.id("c"));
  assert.equal(zoneOf(mixed.engine, mixed.id("c")), "play");
  const short = deployBoard(DRAINBOW, bank("elitism", 2, P1));
  refused(() => play(short.engine, P1, short.id("c")), "2 < 3", COST_RE);
  const wrong = deployBoard(DRAINBOW, bank("rage", 3, P1));
  refused(() => play(wrong.engine, P1, wrong.id("c")), "no [E] icon", THRESHOLD_RE);
  assert.equal(zoneOf(wrong.engine, wrong.id("c")), "hand");
});

clause(DRAINBOW, "0:provides", "in play it provides [E][E]: a cost-1 [EE] character is playable on a Greed bank", () => {
  const b = drainBoard("play", "ee", bank("greed", 1, P1));
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(ready(b.engine), 0, "the Greed bank paid");
});

clause(DRAINBOW, "0:provides", "control: with Drainbow in hand the same board is refused", () => {
  const b = drainBoard("hand", "ee", bank("greed", 1, P1));
  refused(() => play(b.engine, P1, b.id("c")), "no [E] icons", THRESHOLD_RE);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
});

clause(DRAINBOW, "0:provides", "it provides exactly TWO [E]: [EEE] needs one more Elitism (Greed refused, Elitism accepted)", () => {
  const no = drainBoard("play", "eee", bank("greed", 1, P1));
  refused(() => play(no.engine, P1, no.id("c")), "only two [E]", THRESHOLD_RE);
  const yes = drainBoard("play", "eee", bank("elitism", 1, P1));
  play(yes.engine, P1, yes.id("c"));
  assert.equal(zoneOf(yes.engine, yes.id("c")), "play");
});

clause(DRAINBOW, "0:provides", "it provides [E] and nothing else: a [R] threshold is still refused", () => {
  const b = drainBoard("play", "r", bank("greed", 1, P1));
  refused(() => play(b.engine, P1, b.id("c")), "no [R] icon", THRESHOLD_RE);
});

clause(DRAINBOW, "0:provides", "the icons only help meet thresholds: Drainbow alone cannot pay a cost", () => {
  const b = drainBoard("play", "e");
  assert.equal(ready(b.engine), 0);
  refused(() => play(b.engine, P1, b.id("c")), "nothing to pay with", COST_RE);
  assert.equal(b.engine.state.cards[b.id("dc")].depleted, false);
});

clause(DRAINBOW, "0:provides", "face-down it provides one Volition and no Elitism", () => {
  const b = buildGame({ ...sides, cards: [{ key: "dc", def: printing(DRAINBOW), owner: P1, zone: "play", faceDown: true }] });
  assert.equal(b.engine.getThresholds(P1).elitism ?? 0, 0);
  assert.equal(b.engine.getThresholds(P1).volition, 1);
});

clause(DRAINBOW, "0:provides", "face-up in play it provides two Elitism (getThresholds)", () => {
  const b = buildGame({ ...sides, cards: [{ key: "dc", def: printing(DRAINBOW), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getThresholds(P1).elitism, 2);
});

const drainFaceDown = (banks: Cards, extra: Cards = [], opts: Record<string, unknown> = {}) =>
  buildGame({ ...sides, ...opts, cards: [{ key: "dc", def: printing(DRAINBOW), owner: P1, zone: "play", faceDown: true }, ...banks, ...extra]});

clause(DRAINBOW, "1:flipUp", "FLIP UP 5 [E]: five Elitism others pay it; the card turns face-up", () => {
  const b = drainFaceDown(bank("elitism", 5, P1));
  flipUp(b.engine, P1, b.id("dc"));
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, false);
  assert.equal(ready(b.engine), 0, "five spent");
});

clause(DRAINBOW, "1:flipUp", "FLIP UP cost may include the card itself: four Elitism others plus the face-down card pay the 5", () => {
  const b = drainFaceDown(bank("elitism", 4, P1));
  flipUp(b.engine, P1, b.id("dc"));
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, false);
});

clause(DRAINBOW, "1:flipUp", "FLIP UP is refused one short (three others plus itself = 4 < 5)", () => {
  const b = drainFaceDown(bank("elitism", 3, P1));
  refused(() => flipUpRaw(b.engine, P1, b.id("dc")), "4 < 5", FU_COST_RE);
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, true);
});

clause(DRAINBOW, "1:flipUp", "FLIP UP threshold [E]: five Rage others are refused, one Elitism among them works", () => {
  const no = drainFaceDown(bank("rage", 5, P1));
  refused(() => flipUpRaw(no.engine, P1, no.id("dc")), "no [E] icon", FU_THRESHOLD_RE);
  assert.equal(no.engine.state.cards[no.id("dc")].faceDown, true);
  const yes = drainFaceDown([...bank("rage", 4, P1), ...bank("elitism", 1, P1)]);
  flipUp(yes.engine, P1, yes.id("dc"));
  if (pending(yes.engine)) pick(yes.engine, []);
  assert.equal(yes.engine.state.cards[yes.id("dc")].faceDown, false);
});

clause(DRAINBOW, "1:flipUp", "FLIP UP: I may pick an item and, if I do, destroy it (opponent's)", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  flipUp(b.engine, P1, b.id("dc"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("it")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc")), "play");
});

clause(DRAINBOW, "1:flipUp", "FLIP UP: my own item can be picked and destroyed, and only the picked one", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [
    { key: "mine", def: item({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "theirs", def: item({ name: "Theirs" }), owner: P2, zone: "play" }
  ]);
  flipUp(b.engine, P1, b.id("dc"));
  pick(b.engine, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

clause(DRAINBOW, "1:flipUp", "FLIP UP 'may': declining the pick destroys nothing (the card is still flipped up and the 5 paid)", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }]);
  flipUp(b.engine, P1, b.id("dc"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, false);
  assert.equal(ready(b.engine), 0);
});

clause(DRAINBOW, "1:flipUp", "FLIP UP: only an ITEM in play is pickable (no character, location, hand or discard item), and only one", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
    { key: "it2", def: item({ name: "It2" }), owner: P2, zone: "play" },
    { key: "ch", def: character({ name: "Ch" }), owner: P2, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
    { key: "handIt", def: item({ name: "HandIt" }), owner: P2, zone: "hand" },
    { key: "discIt", def: item({ name: "DiscIt" }), owner: P2, zone: "discard" }
  ]);
  flipUp(b.engine, P1, b.id("dc"));
  refused(tryPick(b.engine, [b.id("ch")]), "a character");
  refused(tryPick(b.engine, [b.id("lo")]), "a location");
  refused(tryPick(b.engine, [b.id("handIt")]), "an item in hand");
  refused(tryPick(b.engine, [b.id("discIt")]), "an item in the discard pile");
  refused(tryPick(b.engine, [b.id("it"), b.id("it2")]), "one item only");
  pick(b.engine, [b.id("it")]);
  for (const k of ["it2", "ch", "lo"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
});

clause(DRAINBOW, "1:flipUp", "FLIP UP with no item in play: nothing happens beyond flipping up", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [{ key: "ch", def: character({ name: "Ch" }), owner: P2, zone: "play" }]);
  flipUp(b.engine, P1, b.id("dc"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("ch")), "play");
});

clause(DRAINBOW, "1:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window (own turn works)", () => {
  const b = drainFaceDown(bank("elitism", 5, P1), [{ key: "oa", def: character({ name: "OA" }), owner: P2, zone: "play" }], { turn: 3, activePlayerId: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("oa")], FACTION_P1);
  refused(() => flipUpRaw(b.engine, P1, b.id("dc")), "character FLIP UP in the opponent's window");
  assert.equal(b.engine.state.cards[b.id("dc")].faceDown, true);
  const own = drainFaceDown(bank("elitism", 5, P1));
  flipUp(own.engine, P1, own.id("dc"));
  assert.equal(own.engine.state.cards[own.id("dc")].faceDown, false);
});

// ============================================================================
// Elite Acrolos Engineer -- character cost 2 [E], 1/3/1 inventor
// ============================================================================

const engBoard = (extra: Cards = []) => buildGame({ ...sides, cards: [{ key: "eng", def: printing(ENGINEER), owner: P1, zone: "play" }, ...extra] });
const sl = (b: Game, key = "eng") => [b.engine.getStat(b.id(key), "strength"), b.engine.getStat(b.id(key), "life")];

clause(ENGINEER, "0:rule", "printed as a Gearsmith inventor character, cost 2, threshold [E], base 1/3/1", () => {
  const p = printing(ENGINEER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["inventor"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "e");
  const b = engBoard();
  assert.deepEqual(grid(b.engine, b.id("eng")), [1, 3, 1], "no staple resource: printed stats");
});

clause(ENGINEER, "0:rule", "deploys for exactly 2 with one [E]; refused one short and with no [E]", () => {
  const ok = deployBoard(ENGINEER, bank("elitism", 2, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 0);
  const mixed = deployBoard(ENGINEER, [...bank("elitism", 1, P1), ...bank("rage", 1, P1)]);
  play(mixed.engine, P1, mixed.id("c"));
  assert.equal(zoneOf(mixed.engine, mixed.id("c")), "play");
  const short = deployBoard(ENGINEER, bank("elitism", 1, P1));
  refused(() => play(short.engine, P1, short.id("c")), "1 < 2", COST_RE);
  const wrong = deployBoard(ENGINEER, bank("rage", 2, P1));
  refused(() => play(wrong.engine, P1, wrong.id("c")), "no [E] icon", THRESHOLD_RE);
  assert.equal(zoneOf(wrong.engine, wrong.id("c")), "hand");
});

clause(ENGINEER, "0:rule", "+1 strength and +1 life per different staple I control: one staple = 2/2, then 3/3, up to 6/6 with all five", () => {
  const names: Array<[string, StapleIcon]> = [["Greed", "greed"], ["Rage", "rage"], ["Elitism", "elitism"], ["Deception", "deception"], ["Obsession", "obsession"]];
  for (let n = 1; n <= 5; n++) {
    const b = engBoard(names.slice(0, n).map(([nm, ic], i) => ({ key: `s${i}`, def: staple(nm, ic), owner: P1, zone: "play" as const })));
    assert.deepEqual(sl(b), [1 + n, 1 + n], `${n} different staples`);
  }
});

clause(ENGINEER, "0:rule", "'different': several copies of the SAME staple count once", () => {
  const b = engBoard([
    { key: "g1", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "g2", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "g3", def: staple("Greed", "greed"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(sl(b), [2, 2]);
  const two = engBoard([
    { key: "g1", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "g2", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "r1", def: staple("Rage", "rage"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(sl(two), [3, 3], "Greed x2 + Rage = 2 different");
});

clause(ENGINEER, "0:rule", "only STAPLE resources count: a non-staple resource card adds nothing", () => {
  const b = engBoard([
    { key: "g", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "ns", def: resourceCard({ name: "Fancy", resource: { provides: ["rage"], staple: false } }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(sl(b), [2, 2]);
  const onlyNon = engBoard([{ key: "ns", def: resourceCard({ name: "Fancy", resource: { provides: ["rage"], staple: false } }), owner: P1, zone: "play" }]);
  assert.deepEqual(sl(onlyNon), [1, 1]);
});

clause(ENGINEER, "0:rule", "only staples I CONTROL count: an opponent's staples add nothing", () => {
  const b = engBoard([
    { key: "g", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "og", def: staple("Rage", "rage"), owner: P2, zone: "play" },
    { key: "oe", def: staple("Elitism", "elitism"), owner: P2, zone: "play" }
  ]);
  assert.deepEqual(sl(b), [2, 2]);
});

clause(ENGINEER, "0:rule", "a staple I control but do not own counts (controller, not owner)", () => {
  const b = engBoard([
    { key: "g", def: staple("Greed", "greed"), owner: P2, controller: P1, zone: "play" },
    { key: "r", def: staple("Rage", "rage"), owner: P1, controller: P2, zone: "play" }
  ]);
  assert.deepEqual(sl(b), [2, 2]);
});

clause(ENGINEER, "0:rule", "staples in hand, deck or discard do not count", () => {
  const b = engBoard([
    { key: "h", def: staple("Greed", "greed"), owner: P1, zone: "hand" },
    { key: "d", def: staple("Rage", "rage"), owner: P1, zone: "deck" },
    { key: "x", def: staple("Elitism", "elitism"), owner: P1, zone: "discard" }
  ]);
  assert.deepEqual(sl(b), [1, 1]);
});

clause(ENGINEER, "0:rule", "a staple played FACE-DOWN is only a Volition resource, not a staple resource: it adds nothing", () => {
  const b = engBoard([
    { key: "fd", def: staple("Deception", "deception"), owner: P1, zone: "play", faceDown: true },
    { key: "g", def: staple("Greed", "greed"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(sl(b), [2, 2], "only the face-up Greed counts");
});

clause(ENGINEER, "0:rule", "spent (attached) staples still count", () => {
  const b = engBoard([...bank("greed", 1, P1), ...bank("rage", 1, P1)]);
  assert.deepEqual(sl(b), [3, 3]);
});

clause(ENGINEER, "0:rule", "the bonus follows the staples: it drops when a kind leaves, and applies only to this card", () => {
  const b = engBoard([
    { key: "g", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "r", def: staple("Rage", "rage"), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "kill", def: KILL(), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(sl(b), [3, 3]);
  assert.deepEqual(sl(b, "ally"), [2, 2], "only this card");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("r")] } });
  assert.deepEqual(sl(b), [2, 2]);
});

clause(ENGINEER, "0:rule", "the bonus is gone once the Engineer leaves play (printed stats)", () => {
  const b = engBoard([
    { key: "g", def: staple("Greed", "greed"), owner: P1, zone: "play" },
    { key: "kill", def: KILL(), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("eng")] } });
  assert.equal(zoneOf(b.engine, b.id("eng")), "discard");
  assert.deepEqual(sl(b), [1, 1]);
});

// ============================================================================
// Ex Machina Majig -- character cost 6 [EEE], 5/3/5 majig, UNIQUE EX MACHINA
// ============================================================================

const emmHand = (extra: Cards = [], banks: Cards = bank("elitism", 6, P1)) =>
  buildGame({ ...sides, cards: [{ key: "emm", def: printing(EMM), owner: P1, zone: "hand" }, ...banks, ...extra] });
const emmPlay = (extra: Cards = [], opts: Record<string, unknown> = {}) =>
  buildGame({ ...sides, ...opts, cards: [{ key: "emm", def: printing(EMM), owner: P1, zone: "play" }, ...extra] });
const micromajigs = (engine: Engine, controller: string = P1) =>
  Object.values(engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === controller && engine.getDefinition(c.id).name === "Micromajig");

clause(EMM, "0:unique", "printed as a Gearsmith majig character, cost 6, threshold [EEE], 5/3/5, UNIQUE EX MACHINA", () => {
  const p = printing(EMM);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["majig"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "eee");
  assert.equal((p as unknown as { unique?: string }).unique, "ex machina");
  const b = emmPlay();
  assert.deepEqual(grid(b.engine, b.id("emm")), [5, 3, 5]);
});

clause(EMM, "0:unique", "deploys for exactly 6 with [EEE]; refused at 5 resources and with only two [E]", () => {
  const ok = emmHand();
  play(ok.engine, P1, ok.id("emm"));
  assert.equal(zoneOf(ok.engine, ok.id("emm")), "play");
  assert.equal(ready(ok.engine), 0);
  const mixed = emmHand([], [...bank("elitism", 3, P1), ...bank("rage", 3, P1)]);
  play(mixed.engine, P1, mixed.id("emm"));
  assert.equal(zoneOf(mixed.engine, mixed.id("emm")), "play");
  const short = emmHand([], bank("elitism", 5, P1));
  refused(() => play(short.engine, P1, short.id("emm")), "5 < 6", COST_RE);
  const two = emmHand([], [...bank("elitism", 2, P1), ...bank("rage", 4, P1)]);
  refused(() => play(two.engine, P1, two.id("emm")), "only two [E]", THRESHOLD_RE);
  assert.equal(zoneOf(two.engine, two.id("emm")), "hand");
});

const uniqueBoard = () => emmHand([{ key: "old", def: printing(EMM), owner: P1, zone: "play" }]);
/** The LTB "you may put up to five Micromajigs into play" asks how many (0-5): these tests take all five. */
const takeFive = (pc: { kind: string; max?: unknown; [k: string]: unknown }) =>
  pc.kind === "chooseNumber" ? { kind: "chooseNumber", value: pc.max as number } : declineAll(pc as never);

/** Plays the second copy and answers the survivor prompt (the game must then be able to carry on). */
const uniqueChoose = (b: Game, keepKey: string) => {
  play(b.engine, P1, b.id("emm"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("emm"), b.id("old")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id(keepKey) } } as never);
  // the discarded copy's LTB asks how many Micromajigs to put into play: all five
  const ltb = pending(b.engine) as unknown as { kind: string; playerId: string; max: number } | undefined;
  if (ltb?.kind === "chooseNumber") b.engine.perform({ type: "resolvePendingChoice", playerId: ltb.playerId, choice: { kind: "chooseNumber", value: ltb.max } } as never);
};

clause(EMM, "0:unique", "UNIQUE: a second copy forces a choice; keeping the new one discards the old, and play continues", () => {
  const b = uniqueBoard();
  uniqueChoose(b, "emm");
  assert.equal(zoneOf(b.engine, b.id("emm")), "play");
  assert.equal(zoneOf(b.engine, b.id("old")), "discard");
  assert.equal(pending(b.engine), undefined);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
});

clause(EMM, "0:unique", "UNIQUE: keeping the old copy discards the new one, and play continues", () => {
  const b = uniqueBoard();
  uniqueChoose(b, "old");
  assert.equal(zoneOf(b.engine, b.id("old")), "play");
  assert.equal(zoneOf(b.engine, b.id("emm")), "discard");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
});

clause(EMM, "0:unique", "UNIQUE only binds ME: an opponent's Ex Machina Majig in play does not force a choice", () => {
  const b = emmHand([{ key: "theirs", def: printing(EMM), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("emm"));
  assert.notEqual(pending(b.engine)?.kind, "uniqueSurvivor");
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("emm")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

clause(EMM, "0:unique", "a different UNIQUE name does not collide (a plain character is no problem)", () => {
  const b = emmHand([{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("emm"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("emm")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(EMM, "1:rule", "ETB: all my characters (itself included) gain +1 strength and +1 life this turn", () => {
  const b = emmHand([
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "ally2", def: character({ name: "Ally2", strength: 4, life: 3 }), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("emm"));
  drain(b.engine, declineAll);
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [3, 3]);
  assert.deepEqual([b.engine.getStat(b.id("ally2"), "strength"), b.engine.getStat(b.id("ally2"), "life")], [5, 4]);
  assert.deepEqual([b.engine.getStat(b.id("emm"), "strength"), b.engine.getStat(b.id("emm"), "life")], [6, 6], "itself too");
  assert.equal(micromajigs(b.engine).length, 0, "entering play is not leaving play: no Micromajigs");
});

clause(EMM, "1:rule", "ETB: the opponent's characters and my non-characters are not affected; only +1, not more", () => {
  const b = emmHand([
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "stolen", def: character({ name: "Stolen", strength: 2, life: 2 }), owner: P2, controller: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("emm"));
  drain(b.engine, declineAll);
  assert.deepEqual([b.engine.getStat(b.id("foe"), "strength"), b.engine.getStat(b.id("foe"), "life")], [2, 2]);
  assert.deepEqual([b.engine.getStat(b.id("mine"), "strength"), b.engine.getStat(b.id("mine"), "life")], [3, 3]);
  assert.deepEqual([b.engine.getStat(b.id("stolen"), "strength"), b.engine.getStat(b.id("stolen"), "life")], [3, 3], "'your' = under my control");
});

clause(EMM, "1:rule", "ETB: only characters in play when it resolves — a character entering later this turn gets no bonus", () => {
  const b = emmHand([{ key: "late", def: character({ name: "Late", cost: 0, strength: 2, life: 2 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("emm"));
  drain(b.engine, declineAll);
  play(b.engine, P1, b.id("late"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.deepEqual([b.engine.getStat(b.id("late"), "strength"), b.engine.getStat(b.id("late"), "life")], [2, 2]);
});

clause(EMM, "1:rule", "ETB bonus lasts THIS turn only: it is gone once the turn ends", () => {
  const b = emmHand([{ key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("emm"));
  drain(b.engine, declineAll);
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [3, 3], "control: on this turn");
  endTurn(b.engine, P1);
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [2, 2]);
  assert.deepEqual([b.engine.getStat(b.id("emm"), "strength"), b.engine.getStat(b.id("emm"), "life")], [5, 5]);
});

clause(EMM, "1:rule", "ETB triggers only for THIS card: another character entering later fires no bonus (no prompt, no change)", () => {
  const b = emmPlay([
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "late", def: character({ name: "Late", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("late"));
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual([b.engine.getStat(b.id("ally"), "strength"), b.engine.getStat(b.id("ally"), "life")], [2, 2]);
});

clause(EMM, "2:rule", "LTB: when it is destroyed I put five Micromajigs (1/1/3 majig characters) into play under my control", () => {
  const b = emmPlay([{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]);
  assert.equal(micromajigs(b.engine).length, 0);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("emm")] } });
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : takeFive(pc)));
  assert.equal(zoneOf(b.engine, b.id("emm")), "discard");
  const ms = micromajigs(b.engine);
  assert.equal(ms.length, 5);
  for (const m of ms) {
    assert.deepEqual(grid(b.engine, m.id), [1, 3, 1]);
    assert.deepEqual(b.engine.getDefinition(m.id).subtype, ["majig"]);
  }
  assert.equal(micromajigs(b.engine, P2).length, 0, "none for the opponent");
});

clause(EMM, "2:rule", "LTB also fires when it leaves play to my hand (any 'leaves play')", () => {
  const b = emmPlay([{ key: "bounce", def: BOUNCE(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("emm")] } });
  drain(b.engine, takeFive);
  assert.equal(zoneOf(b.engine, b.id("emm")), "hand");
  assert.equal(micromajigs(b.engine).length, 5);
});

clause(EMM, "2:rule", "LTB is only for THIS card: another character of mine leaving play gives no Micromajigs", () => {
  const b = emmPlay([
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "kill", def: KILL(), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ally")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(micromajigs(b.engine).length, 0);
  assert.equal(zoneOf(b.engine, b.id("emm")), "play");
});

clause(EMM, "2:rule", "LTB goes to the controller at the time (a majig I control but do not own): the tokens are mine", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "emm", def: printing(EMM), owner: P2, controller: P1, zone: "play" },
      { key: "kill", def: KILL(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("emm")] } });
  drain(b.engine, takeFive);
  assert.equal(zoneOf(b.engine, b.id("emm")), "discard");
  assert.equal(micromajigs(b.engine, P1).length, 5);
  assert.equal(micromajigs(b.engine, P2).length, 0);
});

clause(EMM, "2:rule", "LTB after UNIQUE: the discarded copy still puts its five Micromajigs into play", () => {
  const b = uniqueBoard();
  uniqueChoose(b, "emm");
  assert.equal(zoneOf(b.engine, b.id("old")), "discard");
  assert.equal(micromajigs(b.engine).length, 5);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
});

clause(EMM, "2:rule", "LTB is for leaving PLAY only: moving the card between hand, discard pile and deck gives no Micromajigs", () => {
  const mover = (key: string, from: "hand" | "discard", to: "hand" | "discard") => {
    const b = buildGame({
      ...sides,
      cards: [
        { key: "emm", def: printing(EMM), owner: P1, zone: from },
        {
          key,
          def: tactic({
            name: "Mover",
            cost: 0,
            behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone: from }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }] }] }
          } as never),
          owner: P1,
          zone: "hand"
        }
      ]
    });
    play(b.engine, P1, b.id(key), { selected: { t: [b.id("emm")] } });
    drain(b.engine, takeFive);
    assert.equal(zoneOf(b.engine, b.id("emm")), to, `${from} -> ${to}`);
    assert.equal(micromajigs(b.engine).length, 0, `${from} -> ${to}: no tokens`);
  };
  mover("m1", "discard", "hand");
  mover("m2", "hand", "discard");
});

clause(EMM, "2:rule", "LTB 'you may ... up to five': I am offered the choice and can decline or take fewer", () => {
  const b = emmPlay([{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("emm")] } });
  assert.notEqual(pending(b.engine), undefined, "the player is asked how many Micromajigs (0-5) to put into play");
});

clause(EMM, "2:rule", "LTB 'you may ... up to five': the controller (not the opponent) is asked, and 0 (decline) or any number up to 5 is allowed, more is refused", () => {
  const ask = () => {
    const b = emmPlay([{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("emm")] } });
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; min: number; max: number };
    assert.deepEqual([pc.kind, pc.playerId, pc.min, pc.max], ["chooseNumber", P1, 0, 5]);
    return b;
  };
  const answerWith = (b: Game, value: number) => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never);
  const none = ask();
  answerWith(none, 0);
  assert.equal(pending(none.engine), undefined);
  assert.equal(micromajigs(none.engine).length, 0, "declined: no Micromajig");
  assert.equal(zoneOf(none.engine, none.id("emm")), "discard", "it still left play");
  const some = ask();
  answerWith(some, 2);
  assert.equal(micromajigs(some.engine).length, 2, "fewer than five");
  const tooMany = ask();
  refused(() => answerWith(tooMany, 6), "six is more than 'up to five'", /Choose an integer/);
  assert.equal(micromajigs(tooMany.engine).length, 0);
  answerWith(tooMany, 5); // control
  assert.equal(micromajigs(tooMany.engine).length, 5);
});

clause(EMM, "2:rule", "LTB Micromajigs are Gearsmith CHARACTER cards, like the real Micromajig", () => {
  const b = emmPlay([{ key: "kill", def: KILL(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("emm")] } });
  drain(b.engine, takeFive);
  const ms = micromajigs(b.engine);
  assert.equal(ms.length, 5);
  for (const m of ms) {
    assert.equal(inPlay(b.engine, P1, "character").includes(m.id), true, "a character card (type)");
    assert.equal(b.engine.getDefinition(m.id).trade, "gearsmith");
  }
});
