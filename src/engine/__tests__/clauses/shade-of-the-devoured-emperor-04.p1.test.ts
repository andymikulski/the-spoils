// Clause tests — batch shade-of-the-devoured-emperor-04, part p1 (groups 1-6, missing clauses).
// Expectations come from each card's PRINTED text, RULES.md and the Comprehensive Rules / FAQ;
// engine data (ability ids, target declaration ids, choice kinds) is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as buildGameBase,
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
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, drain, declineAll, printing, refused, flipUpNow } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { BuildGameOptions, CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------------

/** A small deterministic LCG, so every shuffle / random pick in every test is reproducible. */
function seededRandom(seed = 20261019): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const buildGame = (options: BuildGameOptions = {}) => buildGameBase({ ...options, random: options.random ?? seededRandom() });
type Board = ReturnType<typeof buildGame>;
type Icons = Partial<Record<StapleIcon, number>>;
type Abilities = NonNullable<CardDefinition["behavior"]>["abilities"];

/** Staple resources for `owner`, e.g. `res({ elitism: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);
const typesOf = (b: Board, key: string) => [...b.engine.getCardTypes(b.id(key))].sort();
const ctl = (b: Board, key: string) => b.engine.state.cards[b.id(key)].controllerId;
const abilityNameOf = (b: Board, key: string, abilityId: string, who: PlayerId = P1) =>
  b.engine.getAvailableActivatedAbilities(who).find((a) => a.cardId === b.id(key) && a.ability.id === abilityId)?.ability.name;

/** A free tactic that picks one character and depletes it — a generic "non-item card that picks". */
const prodAbilities = (): Abilities => [
  {
    id: "prod",
    type: "activated",
    targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
    effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
  }
];

/** A free tactic that destroys one character. */
const killChar = (name = "Kill") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// =================================================================================
// Frickin' Sweet Pogo-Bunny
// RAAR! -- COST: Use this only if this card is not a character and only once each turn. Pay 1.
//          EFFECT: This turn, this card gains the "character" type, and gains 2 strength, 2 life, and 3 speed.
// HIDE! -- COST: Pay 1. EFFECT: If this card is a character, it loses the "character" type. Deplete this card.
// INTO THE RABBIT HOLE? -- COST: Pay 3. EFFECT: Flip this card face-down under its owner's control.
// Item (Gearsmith), cost 1, [E][E].
// =================================================================================

const POGO = "92a594d3-0560-4f4a-b872-5ed8a376967a";

type PogoOpts = { icons?: Icons; oppIcons?: Icons; pogo?: Partial<CardPlacement>; turn?: number; active?: PlayerId; extra?: CardPlacement[] };

function pogoBoard(opts: PogoOpts = {}) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pogo", def: printing(POGO), owner: P1, zone: "play", ...opts.pogo },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      {
        key: "morph",
        def: tactic({
          name: "Morph",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "morph",
                type: "activated",
                targets: [{ id: "i", selector: { zone: "play", type: "item" }, count: 1 }],
                effects: [{ type: "setCardType", target: { type: "selected", id: "i" }, cardType: "character", grantStats: { strength: 2, life: 2, speed: 3 }, duration: { type: "untilEndOfTurn" } }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      },
      ...res(opts.icons ?? { greed: 5 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const raar = (b: Board) => activate(b.engine, P1, b.id("pogo"), "pogo-raar");
const hide = (b: Board) => activate(b.engine, P1, b.id("pogo"), "pogo-hide");
const hole = (b: Board, who: PlayerId = P1) => activate(b.engine, who, b.id("pogo"), "pogo-hole");
/** Makes the Pogo-Bunny a character WITHOUT using RAAR! (so its once-per-turn use is untouched). */
const morphPogo = (b: Board) => play(b.engine, P1, b.id("morph"), { selected: { i: [b.id("pogo")] } });

// --- RAAR! ---------------------------------------------------------------------

clause(POGO, "0:ability:pogo-raar", "pays exactly 1; the item becomes a character (and stays an item) with exactly 2 strength, 2 life and 3 speed; other cards are untouched", () => {
  const b = pogoBoard();
  assert.deepEqual(typesOf(b, "pogo"), ["item"], "control: before RAAR! it is an item and not a character");
  const before = ready(b.engine);
  raar(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1, "Pay 1");
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  assert.equal(b.engine.getStat(b.id("pogo"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("pogo"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("pogo"), "speed"), 3);
  assert.deepEqual(typesOf(b, "mine"), ["character"]);
  assert.deepEqual([b.engine.getStat(b.id("mine"), "strength"), b.engine.getStat(b.id("mine"), "life"), b.engine.getStat(b.id("mine"), "speed")], [1, 5, 1], "no other card gained anything");
  assert.equal(zoneOf(b.engine, b.id("pogo")), "play");
});

clause(POGO, "0:ability:pogo-raar", "the ability is named RAAR!", () => {
  const b = pogoBoard();
  assert.equal(abilityNameOf(b, "pogo", "pogo-raar")?.toLowerCase(), "raar!");
});

clause(POGO, "0:ability:pogo-raar", "gaining the character type is real: an item cannot be declared as an attacker, the RAAR!-ed Pogo-Bunny can", () => {
  const b = pogoBoard();
  refused(() => declareAttackBy(b.engine, P1, [b.id("pogo")]), "an item cannot attack");
  assert.equal(battleOf(b.engine), undefined, "no battle started");
  raar(b);
  declareAttackBy(b.engine, P1, [b.id("pogo")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("pogo")], "as a character it attacks");
});

clause(POGO, "0:ability:pogo-raar", "it lasts only this turn: when the turn ends the Pogo-Bunny is just an item again, and RAAR! can be used again on the next turn", () => {
  const b = pogoBoard();
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  endTurn(b.engine, P1);
  assert.deepEqual(typesOf(b, "pogo"), ["item"], "back to an item once the turn is over");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  assert.deepEqual(typesOf(b, "pogo"), ["item"], "still just an item");
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"], "once each turn: a new turn allows it again");
  assert.equal(b.engine.getStat(b.id("pogo"), "speed"), 3);
});

clause(POGO, "0:ability:pogo-raar", "only once each turn: after RAAR! and HIDE! (so it is not a character again) a second RAAR! this turn is refused", () => {
  const b = pogoBoard();
  raar(b);
  hide(b);
  assert.deepEqual(typesOf(b, "pogo"), ["item"], "control: no longer a character, so only the once-per-turn limit can refuse");
  refused(() => raar(b), "second RAAR! in one turn", /1 time/);
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
});

clause(POGO, "0:ability:pogo-raar", "use this only if this card is not a character: refused while it is a character by other means, and not used up by the refusal", () => {
  const b = pogoBoard();
  morphPogo(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"], "control: it is a character without having used RAAR!");
  const before = ready(b.engine);
  refused(() => raar(b), "already a character");
  assert.equal(before, ready(b.engine), "nothing was paid by the refused attempt");
  hide(b);
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"], "once it is not a character, RAAR! works (it had not been used)");
});

clause(POGO, "0:ability:pogo-raar", "Pay 1 is a real cost: refused with no resources, allowed with exactly 1", () => {
  const none = pogoBoard({ icons: {} });
  refused(() => raar(none), "no resources");
  assert.deepEqual(typesOf(none, "pogo"), ["item"]);
  const one = pogoBoard({ icons: { greed: 1 } });
  raar(one);
  assert.deepEqual(typesOf(one, "pogo"), ["character", "item"]);
  assert.equal(ready(one.engine), 0);
});

clause(POGO, "0:ability:pogo-raar", "its cost does not require the card to be ready: a depleted Pogo-Bunny can still RAAR! and stays depleted", () => {
  const b = pogoBoard({ pogo: { depleted: true } });
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true, "RAAR! does not restore it");
});

clause(POGO, "0:ability:pogo-raar", "only its controller can use it: the opponent cannot RAAR! my Pogo-Bunny", () => {
  const b = pogoBoard({ turn: 2, active: P2, oppIcons: { greed: 4 } });
  refused(() => activate(b.engine, P2, b.id("pogo"), "pogo-raar"), "the opponent is not its controller");
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
  assert.equal(ready(b.engine, P2), 4, "nothing was paid");
});

// --- HIDE! ---------------------------------------------------------------------

clause(POGO, "1:ability:pogo-hide", "pays exactly 1; a character Pogo-Bunny loses the character type (stays an item) and is depleted", () => {
  const b = pogoBoard();
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"], "control: it is a character");
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, false);
  const before = ready(b.engine);
  hide(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1, "Pay 1");
  assert.deepEqual(typesOf(b, "pogo"), ["item"], "loses the character type");
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true, "and is depleted");
  assert.equal(zoneOf(b.engine, b.id("pogo")), "play");
});

clause(POGO, "1:ability:pogo-hide", "the type is lost whatever gave it: a character made by another effect loses the character type too", () => {
  const b = pogoBoard();
  morphPogo(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  hide(b);
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true);
});

clause(POGO, "1:ability:pogo-hide", "if it is not a character nothing changes type-wise, but the card is still depleted", () => {
  const b = pogoBoard();
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, false);
  const before = ready(b.engine);
  hide(b);
  assert.equal(before - ready(b.engine), 1, "Pay 1 even when there is nothing to lose");
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true, "Deplete this card is unconditional");
});

clause(POGO, "1:ability:pogo-hide", "HIDE! on a non-character takes nothing away for good: a character type gained afterwards this turn (RAAR! or another effect) is kept", () => {
  const viaRaar = pogoBoard();
  hide(viaRaar);
  raar(viaRaar);
  assert.deepEqual(typesOf(viaRaar, "pogo"), ["character", "item"], "RAAR! after a pointless HIDE!");
  assert.equal(viaRaar.engine.getStat(viaRaar.id("pogo"), "speed"), 3);
  const viaMorph = pogoBoard();
  hide(viaMorph);
  morphPogo(viaMorph);
  assert.deepEqual(typesOf(viaMorph, "pogo"), ["character", "item"], "another effect's character type after a pointless HIDE!");
});

clause(POGO, "1:ability:pogo-hide", "an already depleted Pogo-Bunny can still HIDE! (the cost is only Pay 1): the type is still lost", () => {
  const b = pogoBoard({ pogo: { depleted: true } });
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  hide(b);
  assert.deepEqual(typesOf(b, "pogo"), ["item"]);
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true);
});

clause(POGO, "1:ability:pogo-hide", "Pay 1 is a real cost: refused with no resources (the type is kept), allowed with exactly 1", () => {
  const none = pogoBoard({ icons: { greed: 1 } });
  raar(none);
  assert.equal(ready(none.engine), 0);
  refused(() => hide(none), "no resources left");
  assert.deepEqual(typesOf(none, "pogo"), ["character", "item"], "still a character");
  assert.equal(none.engine.state.cards[none.id("pogo")].depleted, false, "and not depleted");
  const one = pogoBoard({ icons: { greed: 2 } });
  raar(one);
  hide(one);
  assert.deepEqual(typesOf(one, "pogo"), ["item"]);
});

clause(POGO, "1:ability:pogo-hide", "it only affects this card: other characters keep their type and stay ready", () => {
  const b = pogoBoard();
  raar(b);
  hide(b);
  for (const key of ["mine", "foe"]) {
    assert.deepEqual(typesOf(b, key), ["character"], `${key} is still a character`);
    assert.equal(b.engine.state.cards[b.id(key)].depleted, false, `${key} stays ready`);
  }
});

clause(POGO, "1:ability:pogo-hide", "the ability is named HIDE!", () => {
  const b = pogoBoard();
  assert.equal(abilityNameOf(b, "pogo", "pogo-hide")?.toLowerCase(), "hide!");
});

// --- INTO THE RABBIT HOLE? --------------------------------------------------------

clause(POGO, "2:ability:pogo-hole", "pays exactly 3; the card is flipped face-down: still in play, as a face-down resource under its owner's control", () => {
  const b = pogoBoard();
  assert.equal(b.engine.isResource(b.id("pogo")), false, "control: a face-up item is not a resource");
  const before = ready(b.engine);
  hole(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const card = b.engine.state.cards[b.id("pogo")];
  assert.equal(card.faceDown, true);
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1);
  assert.equal(b.engine.isResource(b.id("pogo")), true, "a face-down card in play is a resource (CR 411.1)");
  assert.equal(before - ready(b.engine), 2, "3 paid, and the new face-down resource provides 1 Volition");
});

clause(POGO, "2:ability:pogo-hole", "under its OWNER's control: when the opponent controls it, flipping it face-down returns it to its owner", () => {
  const b = pogoBoard({ turn: 2, active: P2, pogo: { controller: P2 }, icons: {}, oppIcons: { greed: 3 } });
  assert.equal(ctl(b, "pogo"), P2, "control: the opponent controls my Pogo-Bunny");
  hole(b, P2);
  const card = b.engine.state.cards[b.id("pogo")];
  assert.equal(card.faceDown, true);
  assert.equal(card.ownerId, P1);
  assert.equal(card.controllerId, P1, "it is now my face-down resource");
  assert.equal(ready(b.engine, P2), 0, "the opponent paid the 3");
});

clause(POGO, "2:ability:pogo-hole", "Pay 3 is a real cost: refused with 2 resources (still face-up), allowed with exactly 3", () => {
  const two = pogoBoard({ icons: { greed: 2 } });
  refused(() => hole(two), "2 resources");
  assert.equal(two.engine.state.cards[two.id("pogo")].faceDown, false);
  assert.equal(ready(two.engine), 2, "nothing was paid");
  const three = pogoBoard({ icons: { greed: 3 } });
  hole(three);
  assert.equal(three.engine.state.cards[three.id("pogo")].faceDown, true);
});

clause(POGO, "2:ability:pogo-hole", "it flips only this card: other cards stay face-up, and a RAAR!-ed Pogo-Bunny is no longer a character once it is a face-down resource", () => {
  const b = pogoBoard();
  raar(b);
  assert.deepEqual(typesOf(b, "pogo"), ["character", "item"]);
  hole(b);
  assert.equal(b.engine.state.cards[b.id("pogo")].faceDown, true);
  assert.equal(typesOf(b, "pogo").includes("character"), false, "a face-down resource is not a character");
  for (const key of ["mine", "foe"]) assert.equal(b.engine.state.cards[b.id(key)].faceDown, false, `${key} stays face-up`);
});

clause(POGO, "2:ability:pogo-hole", "the ability is named INTO THE RABBIT HOLE?", () => {
  const b = pogoBoard();
  assert.equal(abilityNameOf(b, "pogo", "pogo-hole")?.toLowerCase(), "into the rabbit hole?");
});

// =================================================================================
// Gigantitect's Giant Giant
// This card cannot be picked by non-item cards or non-item abilities.
// Opponents cannot take control of this card.
// Character (Gearsmith, warmachine), cost 9, [E][E][E][E], 9/3/9.
// =================================================================================

const GGG = "2a13a6f0-29b9-4f5d-a155-2b6bdea55257";
const TRAP = "fd9a88ec-982f-439b-9aa1-8d5db83960eb"; // It's a Trap!

function gggBoard(opts: { giantOwner?: PlayerId; extra?: CardPlacement[]; icons?: Icons } = {}) {
  const giantOwner = opts.giantOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "giant", def: printing(GGG), owner: giantOwner, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "prodT", def: tactic({ name: "ProdT", cost: 0, behavior: { abilities: prodAbilities() } }), owner: P1, zone: "hand" },
      { key: "prodC", def: character({ name: "ProdC", life: 5, behavior: { abilities: prodAbilities() } }), owner: P1, zone: "play" },
      { key: "prodL", def: location({ name: "ProdL", behavior: { abilities: prodAbilities() } }), owner: P1, zone: "play" },
      { key: "prodI", def: item({ name: "ProdI", behavior: { abilities: prodAbilities() } }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "trap", def: printing(TRAP), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

const gggTargets = (b: Board) => [b.id("giant"), b.id("mine")];

clause(GGG, "0:rule", "a non-item card (a tactic) cannot pick it, whether I own it or the opponent does; an ordinary character can be picked by the same tactic", () => {
  for (const giantOwner of [P1, P2]) {
    const b = gggBoard({ giantOwner });
    refused(() => playRaw(b.engine, P1, b.id("prodT"), { selected: { t: [b.id("giant")] } }), `picking the ${giantOwner}-owned giant with a tactic`);
    assert.equal(zoneOf(b.engine, b.id("prodT")), "hand", "the tactic was not played");
    assert.equal(b.engine.state.cards[b.id("giant")].depleted, false);
    play(b.engine, P1, b.id("prodT"), { selected: { t: [b.id("mine")] } });
    assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, "control: the tactic does pick an ordinary character");
  }
});

clause(GGG, "0:rule", "a real non-item card, It's a Trap!, cannot pick it as its character", () => {
  const b = gggBoard();
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: { it: [b.id("myItem")], ch: [b.id("giant")] } }), "It's a Trap! picking the giant");
  assert.equal(zoneOf(b.engine, b.id("trap")), "hand");
  assert.equal(zoneOf(b.engine, b.id("giant")), "play");
  play(b.engine, P1, b.id("trap"), { selected: { it: [b.id("myItem")], ch: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "control: the same card works on an ordinary character");
});

clause(GGG, "0:rule", "non-item abilities cannot pick it: a character's and a location's activated abilities are refused, an ordinary character is pickable", () => {
  for (const source of ["prodC", "prodL"]) {
    const b = gggBoard();
    refused(() => activate(b.engine, P1, b.id(source), "prod", { selected: { t: [b.id("giant")] } }), `${source} picking the giant`);
    assert.equal(b.engine.state.cards[b.id("giant")].depleted, false);
    activate(b.engine, P1, b.id(source), "prod", { selected: { t: [b.id("mine")] } });
    assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, `control: ${source} picks an ordinary character`);
  }
});

clause(GGG, "0:rule", "ITEMS can pick it: an item's activated ability picks the giant (only NON-item cards and abilities are barred)", () => {
  const b = gggBoard();
  activate(b.engine, P1, b.id("prodI"), "prod", { selected: { t: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, "control: the item ability picks an ordinary character");
  activate(b.engine, P1, b.id("prodI"), "prod", { selected: { t: [b.id("giant")] } });
  assert.equal(b.engine.state.cards[b.id("giant")].depleted, true, "an item ability may pick it");
});

clause(GGG, "0:rule", "ITEM cards can pick it: an ATTACH TO item deploys onto the giant (the item card picks its host)", () => {
  const gear = item({
    name: "Gear",
    cost: 0,
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] }
  });
  const b = gggBoard({ extra: [{ key: "gear", def: gear, owner: P1, zone: "hand" }, { key: "gear2", def: gear, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("gear2"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(b.engine.state.cards[b.id("gear2")].attachedTo, b.id("mine"), "control: the item attaches to an ordinary character");
  play(b.engine, P1, b.id("gear"), { selected: { attachTo: [b.id("giant")] } });
  assert.equal(zoneOf(b.engine, b.id("gear")), "play");
  assert.equal(b.engine.state.cards[b.id("gear")].attachedTo, b.id("giant"));
});

clause(GGG, "0:rule", "it is only unpickable, not untouchable: an effect that does not pick (damage to each character) still hits it", () => {
  const sweep = tactic({
    name: "Sweep",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 2 }] }]
        }
      ]
    }
  });
  const b = gggBoard({ extra: [{ key: "sweep", def: sweep, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sweep"));
  assert.equal(b.engine.state.cards[b.id("giant")].damage, 2, "the giant took the area damage");
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 2);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 2);
});

// --- Opponents cannot take control ------------------------------------------------

const stealTactic = (duration?: { type: "untilEndOfTurn" }) =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          effects: [
            {
              type: "takeControl",
              target: { type: "random", selector: { zone: "play", type: "character", controller: "opponent" } },
              controller: "controller",
              ...(duration ? { duration } : {})
            }
          ]
        }
      ]
    }
  });

clause(GGG, "1:rule", "an opponent's take-control effect on it fizzles (permanent or for the turn); the same effect takes an ordinary character", () => {
  for (const duration of [undefined, { type: "untilEndOfTurn" as const }]) {
    const giant = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "giant", def: printing(GGG), owner: P2, zone: "play" },
        { key: "steal", def: stealTactic(duration), owner: P1, zone: "hand" }
      ]
    });
    play(giant.engine, P1, giant.id("steal"));
    assert.equal(ctl(giant, "giant"), P2, `the giant stays with its controller (${duration ? "this turn" : "permanent"})`);
    const plain = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        { key: "steal", def: stealTactic(duration), owner: P1, zone: "hand" }
      ]
    });
    play(plain.engine, P1, plain.id("steal"));
    assert.equal(ctl(plain, "foe"), P1, "control: an ordinary character is taken");
  }
});

// =================================================================================
// Shared FLIP UP / board helpers for the two tactics below
// =================================================================================

const flipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

/** Staple resources of P1 that are already spent (attached to the faction): they count for thresholds but cannot pay. */
const spentRes = (icons: Icons): CardPlacement[] => res(icons).map((p) => ({ ...p, attachedToKey: "__factionA" }));

/** Resource cards of `owner` (non-staple count) attached to their faction, i.e. spent. */
const spentOf = (engine: SpoilsEngine, owner: PlayerId = P1) =>
  engine.state.players[owner].play.filter((cid) => engine.isResource(cid) && engine.state.cards[cid].attachedTo === engine.state.players[owner].factionId).length;

const micromajigs = (b: Board) =>
  Object.values(b.engine.state.cards)
    .filter((c) => c.zone === "play" && b.engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);

const smashItem = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "smash",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// =================================================================================
// Industrious Usage
// COST: Pick an item. -- EFFECT: Destroy the item. Put a Micromajig token into play under your control.
// FLIP UP: 2 [E][E]
// Tactic (Gearsmith), cost 4, [E][E].
// =================================================================================

const IU = "5c7b79cb-4cf1-44e4-8729-d9a096f1dd7c";

type IuOpts = { iu?: "hand" | "faceDown"; icons?: Icons; oppIcons?: Icons; turn?: number; active?: PlayerId; noItems?: boolean; extra?: CardPlacement[] };

function iuBoard(opts: IuOpts = {}) {
  const where = opts.iu ?? "hand";
  const items: CardPlacement[] = opts.noItems
    ? []
    : [
        { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
        { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
        { key: "stolenItem", def: item({ name: "StolenItem" }), owner: P2, controller: P1, zone: "play" }
      ];
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "iu", def: printing(IU), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...items,
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fdItem", def: item({ name: "FaceDownItem" }), owner: P2, zone: "play", faceDown: true },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P2, zone: "hand" },
      { key: "discItem", def: item({ name: "DiscItem" }), owner: P2, zone: "discard" },
      { key: "smash", def: smashItem(), owner: P2, zone: "hand" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const useIu = (b: Board, target: string) => play(b.engine, P1, b.id("iu"), { selected: { it: [b.id(target)] } });

clause(IU, "0:ability", "pays exactly 4; the picked item is destroyed (only that one), a Micromajig token enters play under my control, and Industrious Usage ends in my discard pile", () => {
  const b = iuBoard();
  const before = ready(b.engine);
  useIu(b, "foeItem");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("foeItem")), "an item goes to its owner's discard pile");
  for (const key of ["myItem", "stolenItem", "mine", "foe", "foePlace"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays in play`);
  assert.equal(zoneOf(b.engine, b.id("iu")), "discard");
  const tokens = micromajigs(b);
  assert.equal(tokens.length, 1, "exactly one token");
  assert.equal(b.engine.state.cards[tokens[0]].controllerId, P1, "under MY control, although the destroyed item was the opponent's");
});

clause(IU, "0:ability", "the Micromajig token is a character with 1 strength, 1 life, 3 speed and the majig subtype, owned by the player whose effect made it (CR 409.3b, 409.3c)", () => {
  const b = iuBoard();
  useIu(b, "myItem");
  const [token] = micromajigs(b);
  assert.ok(token, "a token exists");
  assert.deepEqual([...b.engine.getCardTypes(token)], ["character"]);
  assert.equal(b.engine.getStat(token, "strength"), 1);
  assert.equal(b.engine.getStat(token, "life"), 1);
  assert.equal(b.engine.getStat(token, "speed"), 3);
  assert.ok(b.engine.getDefinition(token).subtype.includes("majig"), "subtype majig");
  assert.equal(b.engine.state.cards[token].ownerId, P1, "CR 409.3b");
  assert.equal(b.engine.state.cards[token].controllerId, P1);
});

clause(IU, "0:ability", "the Micromajig token is a Gearsmith character (CR 409.3c)", () => {
  const b = iuBoard();
  useIu(b, "myItem");
  const [token] = micromajigs(b);
  assert.equal(b.engine.getDefinition(token).trade, "gearsmith");
});

clause(IU, "0:ability", "my own item can be picked: it is destroyed into my discard pile and the token is still mine", () => {
  const b = iuBoard();
  useIu(b, "myItem");
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("myItem")), "b.engine.state.players[P1].discard.includes(b.id(\"myItem\"))");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "play");
  assert.equal(micromajigs(b).length, 1);
});

clause(IU, "0:ability", "an item I control but do not own goes to its OWNER's discard pile", () => {
  const b = iuBoard();
  useIu(b, "stolenItem");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("stolenItem")), "b.engine.state.players[P2].discard.includes(b.id(\"stolenItem\"))");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("stolenItem")), false);
});

clause(IU, "0:ability", "the pick is the cost, the destroying and the token are the effect: while it waits for responses the item is still in play, no token exists, and 4 are already paid", () => {
  const b = iuBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("iu"), { selected: { it: [b.id("foeItem")] } });
  assert.equal(before - ready(b.engine), 4, "paid when played");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "play", "not destroyed yet");
  assert.equal(micromajigs(b).length, 0, "no token yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard");
  assert.equal(micromajigs(b).length, 1);
});

clause(IU, "0:ability", "ONLY an item in play can be picked: a character, location, faction, face-down card, and items in a hand or discard pile are refused", () => {
  const b = iuBoard();
  const attempt = (target: CardInstanceId) => () => playRaw(b.engine, P1, b.id("iu"), { selected: { it: [target] } });
  refused(attempt(b.id("mine")), "my character");
  refused(attempt(b.id("foe")), "their character");
  refused(attempt(b.id("foePlace")), "a location");
  refused(attempt(b.engine.state.players[P2].factionId!), "their faction");
  refused(attempt(b.engine.state.players[P1].factionId!), "my faction");
  refused(attempt(b.id("fdItem")), "a face-down card (a resource, not an item)");
  refused(attempt(b.id("handItem")), "an item in their hand");
  refused(attempt(b.id("discItem")), "an item in their discard pile");
  assert.equal(zoneOf(b.engine, b.id("iu")), "hand", "nothing was played");
  assert.equal(ready(b.engine), 4, "nothing was paid");
  attempt(b.id("foeItem"))();
  assert.ok(b.engine.state.responseWindow, "control: an item in play is accepted");
});

clause(IU, "0:ability", "needs exactly one pick: none or two are refused", () => {
  const b = iuBoard();
  refused(() => playRaw(b.engine, P1, b.id("iu"), { selected: {} }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("iu"), { selected: { it: [b.id("myItem"), b.id("foeItem")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("iu")), "hand");
  assert.equal(ready(b.engine), 4);
});

clause(IU, "0:ability", "with no item in play the cost cannot be paid: refused (control: allowed once an item is in play)", () => {
  const none = iuBoard({ noItems: true });
  refused(() => playRaw(none.engine, P1, none.id("iu"), { selected: {} }), "no items at all");
  refused(() => playRaw(none.engine, P1, none.id("iu"), { selected: { it: [none.id("mine")] } }), "a character is not an item");
  assert.equal(zoneOf(none.engine, none.id("iu")), "hand");
  assert.equal(micromajigs(none).length, 0);
  const some = iuBoard();
  useIu(some, "myItem");
  assert.equal(micromajigs(some).length, 1);
});

clause(IU, "0:ability", "costs 4 with [E][E]: refused with 3 resources, refused without two Elitism, accepted with exactly two Elitism and 4 resources", () => {
  const short = iuBoard({ icons: { elitism: 3 } });
  refused(() => useIu(short, "foeItem"), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("iu")), "hand");
  const noThreshold = iuBoard({ icons: { greed: 4 } });
  refused(() => useIu(noThreshold, "foeItem"), "no [E]");
  const oneThreshold = iuBoard({ icons: { elitism: 1, greed: 3 } });
  refused(() => useIu(oneThreshold, "foeItem"), "only one [E]");
  const theirs = iuBoard({ icons: { greed: 4 }, oppIcons: { elitism: 4 } });
  refused(() => useIu(theirs, "foeItem"), "the opponent's [E] do not count");
  const exact = iuBoard({ icons: { elitism: 2, greed: 2 } });
  useIu(exact, "foeItem");
  assert.equal(zoneOf(exact.engine, exact.id("foeItem")), "discard");
  assert.equal(ready(exact.engine), 0);
});

clause(IU, "0:ability", "if the picked item is destroyed in response, the item is simply gone and the token is still put into play (the second sentence does not depend on the first)", () => {
  const b = iuBoard();
  playRaw(b.engine, P1, b.id("iu"), { selected: { it: [b.id("foeItem")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("smash"), selected: { t: [b.id("foeItem")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("iu")), "discard");
  assert.equal(micromajigs(b).length, 1, "the token is still created");
});

// --- FLIP UP -------------------------------------------------------------------

clause(IU, "1:flipUp", "a face-down Industrious Usage is a resource: it provides Volition and is in the resource pool until it is flipped", () => {
  const b = iuBoard({ iu: "faceDown", icons: { elitism: 2 } });
  assert.equal(b.engine.isResource(b.id("iu")), true);
  assert.equal(ready(b.engine), 3, "two Elitism plus the face-down card");
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(IU, "1:flipUp", "flipping it up resolves it as the tactic: the picked item is destroyed, a Micromajig appears under my control, and the card ends in my discard pile", () => {
  const b = iuBoard({ iu: "faceDown", icons: { elitism: 2, greed: 3 } });
  flipUp(b.engine, P1, b.id("iu"), { it: [b.id("foeItem")] });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard");
  assert.equal(zoneOf(b.engine, b.id("myItem")), "play");
  assert.equal(zoneOf(b.engine, b.id("iu")), "discard");
  assert.equal(b.engine.state.cards[b.id("iu")].faceDown, false);
  const tokens = micromajigs(b);
  assert.equal(tokens.length, 1);
  assert.equal(b.engine.state.cards[tokens[0]].controllerId, P1);
});

clause(IU, "1:flipUp", "it pays only the FLIP UP cost of 2 (not the card's cost of 4): at least one other resource and at most two are spent", () => {
  const b = iuBoard({ iu: "faceDown", icons: { elitism: 2, greed: 3 } });
  assert.equal(ready(b.engine), 6, "five resources plus the face-down card");
  flipUp(b.engine, P1, b.id("iu"), { it: [b.id("foeItem")] });
  resolvePendingResponses(b.engine);
  const spent = spentOf(b.engine);
  // The card itself may pay part of its own FLIP UP cost (CR 507.4b), so 1 or 2 of the other resources are attached.
  assert.ok(spent === 1 || spent === 2, `expected 1 or 2 other resources spent (cost 2), got ${spent}`);
  assert.equal(ready(b.engine), 5 - spent, "the flipped card is no longer a resource and the rest are untouched");
});

clause(IU, "1:flipUp", "FLIP UP needs [E][E]: one [E] among many other resources is refused (the card stays face-down), two are accepted", () => {
  const one = iuBoard({ iu: "faceDown", icons: { elitism: 1, greed: 6 } });
  refused(() => flipUp(one.engine, P1, one.id("iu"), { it: [one.id("foeItem")] }), "one [E]");
  assert.equal(one.engine.state.cards[one.id("iu")].faceDown, true, "still face-down");
  assert.equal(zoneOf(one.engine, one.id("foeItem")), "play");
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = iuBoard({ iu: "faceDown", icons: { greed: 6 } });
  refused(() => flipUp(none.engine, P1, none.id("iu"), { it: [none.id("foeItem")] }), "no [E]");
  const two = iuBoard({ iu: "faceDown", icons: { elitism: 2 } });
  flipUp(two.engine, P1, two.id("iu"), { it: [two.id("foeItem")] });
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("foeItem")), "discard", "two [E] and the card itself are enough");
});

clause(IU, "1:flipUp", "FLIP UP costs 2 resources, not 1: with both [E] spent (they still count for the threshold but cannot pay) only the card itself is ready, so it is refused; one more ready resource makes it work", () => {
  const short = iuBoard({ iu: "faceDown", icons: {}, extra: spentRes({ elitism: 2 }) });
  assert.equal(ready(short.engine), 1, "only the face-down card itself is ready");
  refused(() => flipUp(short.engine, P1, short.id("iu"), { it: [short.id("foeItem")] }), "Pay 2 with one ready resource");
  assert.equal(short.engine.state.cards[short.id("iu")].faceDown, true, "still face-down");
  assert.equal(zoneOf(short.engine, short.id("foeItem")), "play");
  const enough = iuBoard({ iu: "faceDown", icons: { greed: 1 }, extra: spentRes({ elitism: 2 }) });
  flipUp(enough.engine, P1, enough.id("iu"), { it: [enough.id("foeItem")] });
  resolvePendingResponses(enough.engine);
  assert.equal(zoneOf(enough.engine, enough.id("foeItem")), "discard", "control: two ready resources (the card and one more) are enough");
});

clause(IU, "1:flipUp", "the card's own Volition does not provide an [E], and the opponent's [E] do not count", () => {
  const onlyVolition = iuBoard({ iu: "faceDown", icons: { greed: 3 } });
  refused(() => flipUp(onlyVolition.engine, P1, onlyVolition.id("iu"), { it: [onlyVolition.id("foeItem")] }), "no [E] anywhere");
  const theirs = iuBoard({ iu: "faceDown", icons: { greed: 3 }, oppIcons: { elitism: 4 } });
  refused(() => flipUp(theirs.engine, P1, theirs.id("iu"), { it: [theirs.id("foeItem")] }), "only the opponent has [E]");
  assert.equal(theirs.engine.state.cards[theirs.id("iu")].faceDown, true);
});

clause(IU, "1:flipUp", "the pick restrictions still apply when flipped: only an item in play, exactly one", () => {
  const b = iuBoard({ iu: "faceDown", icons: { elitism: 4 } });
  const attempt = (target?: CardInstanceId) => () => flipUp(b.engine, P1, b.id("iu"), target ? { it: [target] } : {});
  refused(attempt(b.id("mine")), "a character");
  refused(attempt(b.id("foePlace")), "a location");
  refused(attempt(b.engine.state.players[P2].factionId!), "a faction");
  refused(attempt(b.id("fdItem")), "a face-down card");
  refused(attempt(b.id("handItem")), "an item in a hand");
  refused(attempt(undefined), "no pick");
  assert.equal(b.engine.state.cards[b.id("iu")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(b.engine), 5, "nothing was paid by the refused attempts");
  attempt(b.id("foeItem"))();
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard", "control: an item is accepted");
});

clause(IU, "1:flipUp", "only its controller can flip it, and only while it is a face-down card in play (not from the hand)", () => {
  const theirs = iuBoard({ iu: "faceDown", icons: { elitism: 4 }, oppIcons: { elitism: 4 } });
  refused(() => flipUp(theirs.engine, P2, theirs.id("iu"), { it: [theirs.id("foeItem")] }), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("iu")].faceDown, true);
  const inHand = iuBoard({ iu: "hand", icons: { elitism: 4 } });
  refused(() => flipUp(inHand.engine, P1, inHand.id("iu"), { it: [inHand.id("foeItem")] }), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("iu")), "hand");
});

clause(IU, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const b = iuBoard({ iu: "faceDown", icons: { elitism: 4 }, turn: 2, active: P2, extra: [] });
  refused(() => flipUp(b.engine, P1, b.id("iu"), { it: [b.id("foeItem")] }), "nothing to respond to yet");
  assert.equal(b.engine.state.cards[b.id("iu")].faceDown, true);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  flipUp(b.engine, P1, b.id("iu"), { it: [b.id("foeItem")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard", "flipped up in response to the attack");
});

// =================================================================================
// It's a Trap!
// COST: Pick an item you control. Pick a character. -- EFFECT: Put the cards into their owner's hand.
// FLIP UP: 2 [E]
// Tactic (Gearsmith), cost 3, [E].
// =================================================================================

type TrapOpts = { trap?: "hand" | "faceDown"; icons?: Icons; oppIcons?: Icons; turn?: number; active?: PlayerId; noMyItems?: boolean; noChars?: boolean; extra?: CardPlacement[] };

function trapBoard(opts: TrapOpts = {}) {
  const where = opts.trap ?? "hand";
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "trap", def: printing(TRAP), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...(opts.noMyItems
        ? []
        : ([
            { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
            { key: "stolenItem", def: item({ name: "StolenItem" }), owner: P2, controller: P1, zone: "play" }
          ] as CardPlacement[])),
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      ...(opts.noChars
        ? []
        : ([
            { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
            { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
            { key: "stolenChar", def: character({ name: "StolenChar" }), owner: P2, controller: P1, zone: "play" },
            { key: "fdChar", def: character({ name: "FaceDownChar" }), owner: P2, zone: "play", faceDown: true }
          ] as CardPlacement[])),
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 3 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const useTrap = (b: Board, it: string, ch: string) => play(b.engine, P1, b.id("trap"), { selected: { it: [b.id(it)], ch: [b.id(ch)] } });
const trapPicks = (b: Board, it?: CardInstanceId, ch?: CardInstanceId) => ({ ...(it ? { it: [it] } : {}), ...(ch ? { ch: [ch] } : {}) });

clause(TRAP, "0:ability", "pays exactly 3; my item goes to my hand and the picked character to its owner's hand; the tactic ends in the discard pile and nothing else moves", () => {
  const b = trapBoard();
  const before = ready(b.engine);
  useTrap(b, "myItem", "foe");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3");
  assert.ok(handOf(b.engine, P1).includes(b.id("myItem")), "my item is back in my hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("foe")), "their character is back in their hand");
  assert.equal(zoneOf(b.engine, b.id("myItem")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  for (const key of ["mine", "stolenItem", "stolenChar", "foeItem", "foePlace"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(b.engine, b.id("trap")), "discard");
});

clause(TRAP, "0:ability", "my own character can be the second pick: both cards go to my hand", () => {
  const b = trapBoard();
  useTrap(b, "myItem", "mine");
  assert.ok(handOf(b.engine, P1).includes(b.id("myItem")), "handOf(b.engine, P1).includes(b.id(\"myItem\"))");
  assert.ok(handOf(b.engine, P1).includes(b.id("mine")), "handOf(b.engine, P1).includes(b.id(\"mine\"))");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(TRAP, "0:ability", "each card goes to its OWNER's hand: an item and a character I control but do not own go to the opponent's hand", () => {
  const b = trapBoard();
  useTrap(b, "stolenItem", "stolenChar");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolenItem")), "the item goes to its owner");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolenChar")), "the character goes to its owner");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolenItem")), false);
  assert.equal(handOf(b.engine, P1).includes(b.id("stolenChar")), false);
});

clause(TRAP, "0:ability", "the picks are the cost, the move is the effect: while it waits for responses both cards are still in play and 3 are already paid", () => {
  const b = trapBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("trap"), { selected: { it: [b.id("myItem")], ch: [b.id("foe")] } });
  assert.equal(before - ready(b.engine), 3, "paid when played");
  assert.equal(zoneOf(b.engine, b.id("myItem")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("myItem")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
});

clause(TRAP, "0:ability", "the first pick must be an ITEM I CONTROL: the opponent's item, a character, a location, a faction, a face-down card and an item in my hand are refused", () => {
  const b = trapBoard();
  const attempt = (it: CardInstanceId) => () => playRaw(b.engine, P1, b.id("trap"), { selected: trapPicks(b, it, b.id("foe")) });
  refused(attempt(b.id("foeItem")), "the opponent's item");
  refused(attempt(b.id("mine")), "a character");
  refused(attempt(b.id("foePlace")), "a location");
  refused(attempt(b.engine.state.players[P1].factionId!), "my faction");
  refused(attempt(b.id("fdChar")), "a face-down card");
  refused(attempt(b.id("handItem")), "an item in my hand");
  assert.equal(zoneOf(b.engine, b.id("trap")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  attempt(b.id("myItem"))();
  assert.ok(b.engine.state.responseWindow, "control: an item I control is accepted");
});

clause(TRAP, "0:ability", "the second pick must be a CHARACTER in play: an item, a location, a faction, a face-down card and a character in a hand are refused", () => {
  const b = trapBoard();
  const attempt = (ch: CardInstanceId) => () => playRaw(b.engine, P1, b.id("trap"), { selected: trapPicks(b, b.id("myItem"), ch) });
  refused(attempt(b.id("foeItem")), "an item");
  refused(attempt(b.id("foePlace")), "a location");
  refused(attempt(b.engine.state.players[P2].factionId!), "their faction");
  refused(attempt(b.engine.state.players[P1].factionId!), "my faction");
  refused(attempt(b.id("fdChar")), "a face-down card");
  refused(attempt(b.id("handChar")), "a character in my hand");
  assert.equal(zoneOf(b.engine, b.id("trap")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  attempt(b.id("foe"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(TRAP, "0:ability", "both picks are required, one of each: only the item, only the character, or two characters are refused", () => {
  const b = trapBoard();
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: trapPicks(b, b.id("myItem")) }), "no character");
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: trapPicks(b, undefined, b.id("foe")) }), "no item");
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: {} }), "nothing");
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: { it: [b.id("myItem")], ch: [b.id("foe"), b.id("mine")] } }), "two characters");
  refused(() => playRaw(b.engine, P1, b.id("trap"), { selected: { it: [b.id("myItem"), b.id("stolenItem")], ch: [b.id("foe")] } }), "two items");
  assert.equal(zoneOf(b.engine, b.id("trap")), "hand");
  assert.equal(ready(b.engine), 3);
});

clause(TRAP, "0:ability", "needs an item I control in play (the opponent's item does not do) and a character in play: refused without either", () => {
  const noItem = trapBoard({ noMyItems: true });
  refused(() => playRaw(noItem.engine, P1, noItem.id("trap"), { selected: trapPicks(noItem, noItem.id("foeItem"), noItem.id("foe")) }), "only the opponent has an item");
  assert.equal(zoneOf(noItem.engine, noItem.id("trap")), "hand");
  const noChar = trapBoard({ noChars: true });
  refused(() => playRaw(noChar.engine, P1, noChar.id("trap"), { selected: trapPicks(noChar, noChar.id("myItem")) }), "no character in play");
  assert.equal(zoneOf(noChar.engine, noChar.id("trap")), "hand");
  const both = trapBoard();
  useTrap(both, "myItem", "mine");
  assert.equal(zoneOf(both.engine, both.id("myItem")), "hand", "control: with both available it works");
});

clause(TRAP, "0:ability", "costs 3 with [E]: refused with 2 resources, refused without any Elitism, accepted with one Elitism and 3 resources", () => {
  const short = trapBoard({ icons: { elitism: 2 } });
  refused(() => useTrap(short, "myItem", "foe"), "2 resources");
  assert.equal(zoneOf(short.engine, short.id("trap")), "hand");
  const noThreshold = trapBoard({ icons: { greed: 3 } });
  refused(() => useTrap(noThreshold, "myItem", "foe"), "no [E]");
  const theirs = trapBoard({ icons: { greed: 3 }, oppIcons: { elitism: 3 } });
  refused(() => useTrap(theirs, "myItem", "foe"), "the opponent's [E] does not count");
  const exact = trapBoard({ icons: { elitism: 1, greed: 2 } });
  useTrap(exact, "myItem", "foe");
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(TRAP, "0:ability", "a Pogo-Bunny that has become a character counts as a character AND as an item: it can be the character pick (but not before RAAR!), or the item pick", () => {
  const pogo: CardPlacement = { key: "pogo", def: printing(POGO), owner: P1, zone: "play" };
  const asChar = trapBoard({ extra: [pogo, ...res({ greed: 1 })] });
  refused(() => playRaw(asChar.engine, P1, asChar.id("trap"), { selected: trapPicks(asChar, asChar.id("myItem"), asChar.id("pogo")) }), "an item that is not a character yet");
  activate(asChar.engine, P1, asChar.id("pogo"), "pogo-raar");
  useTrap(asChar, "myItem", "pogo");
  assert.ok(handOf(asChar.engine, P1).includes(asChar.id("pogo")), "as the character pick");
  assert.ok(handOf(asChar.engine, P1).includes(asChar.id("myItem")), "handOf(asChar.engine, P1).includes(asChar.id(\"myItem\"))");
  const asItem = trapBoard({ extra: [pogo] });
  useTrap(asItem, "pogo", "mine");
  assert.ok(handOf(asItem.engine, P1).includes(asItem.id("pogo")), "as the item pick");
  assert.ok(handOf(asItem.engine, P1).includes(asItem.id("mine")), "handOf(asItem.engine, P1).includes(asItem.id(\"mine\"))");
});

// --- FLIP UP -------------------------------------------------------------------

clause(TRAP, "1:flipUp", "flipping it up resolves it as the tactic: my item and the picked character go to their owners' hands and the card ends in my discard pile", () => {
  const b = trapBoard({ trap: "faceDown", icons: { elitism: 2, greed: 2 } });
  flipUp(b.engine, P1, b.id("trap"), { it: [b.id("myItem")], ch: [b.id("foe")] });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(handOf(b.engine, P1).includes(b.id("myItem")), "handOf(b.engine, P1).includes(b.id(\"myItem\"))");
  assert.ok(handOf(b.engine, P2).includes(b.id("foe")), "handOf(b.engine, P2).includes(b.id(\"foe\"))");
  assert.equal(zoneOf(b.engine, b.id("trap")), "discard");
  assert.equal(b.engine.state.cards[b.id("trap")].faceDown, false);
  for (const key of ["mine", "stolenItem", "foeItem"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays`);
});

clause(TRAP, "1:flipUp", "it pays only the FLIP UP cost of 2 (not the card's cost of 3): with exactly one Elitism and the card itself it can be flipped, using up both", () => {
  const b = trapBoard({ trap: "faceDown", icons: { elitism: 1 } });
  assert.equal(ready(b.engine), 2, "one Elitism plus the face-down card");
  flipUp(b.engine, P1, b.id("trap"), { it: [b.id("myItem")], ch: [b.id("foe")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(ready(b.engine), 0, "two resources, both gone: the card and the Elitism");
  const more = trapBoard({ trap: "faceDown", icons: { elitism: 1, greed: 4 } });
  flipUp(more.engine, P1, more.id("trap"), { it: [more.id("myItem")], ch: [more.id("foe")] });
  resolvePendingResponses(more.engine);
  const spent = spentOf(more.engine);
  assert.ok(spent === 1 || spent === 2, `expected 1 or 2 other resources spent (cost 2), got ${spent}`);
  assert.equal(ready(more.engine), 5 - spent);
});

clause(TRAP, "1:flipUp", "FLIP UP needs an [E]: with no Elitism (however many other resources) it is refused and the card stays face-down; the opponent's [E] does not count", () => {
  const none = trapBoard({ trap: "faceDown", icons: { greed: 6 } });
  refused(() => flipUp(none.engine, P1, none.id("trap"), { it: [none.id("myItem")], ch: [none.id("foe")] }), "no [E]");
  assert.equal(none.engine.state.cards[none.id("trap")].faceDown, true);
  assert.equal(zoneOf(none.engine, none.id("foe")), "play");
  assert.equal(ready(none.engine), 7, "nothing was paid");
  const theirs = trapBoard({ trap: "faceDown", icons: { greed: 3 }, oppIcons: { elitism: 4 } });
  refused(() => flipUp(theirs.engine, P1, theirs.id("trap"), { it: [theirs.id("myItem")], ch: [theirs.id("foe")] }), "only the opponent has [E]");
  assert.equal(theirs.engine.state.cards[theirs.id("trap")].faceDown, true);
});

clause(TRAP, "1:flipUp", "FLIP UP costs 2 resources, not 1: with the [E] spent (it still counts for the threshold but cannot pay) only the card itself is ready, so it is refused; one more ready resource makes it work", () => {
  const short = trapBoard({ trap: "faceDown", icons: {}, extra: spentRes({ elitism: 1 }) });
  assert.equal(ready(short.engine), 1, "only the face-down card itself is ready");
  refused(() => flipUp(short.engine, P1, short.id("trap"), { it: [short.id("myItem")], ch: [short.id("foe")] }), "Pay 2 with one ready resource");
  assert.equal(short.engine.state.cards[short.id("trap")].faceDown, true, "still face-down");
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");
  const enough = trapBoard({ trap: "faceDown", icons: { greed: 1 }, extra: spentRes({ elitism: 1 }) });
  flipUp(enough.engine, P1, enough.id("trap"), { it: [enough.id("myItem")], ch: [enough.id("foe")] });
  resolvePendingResponses(enough.engine);
  assert.equal(zoneOf(enough.engine, enough.id("foe")), "hand", "control: two ready resources (the card and one more) are enough");
});

clause(TRAP, "1:flipUp", "the pick restrictions still apply when flipped: the item must be mine and in play, the second pick a character in play, and both are required", () => {
  const b = trapBoard({ trap: "faceDown", icons: { elitism: 3 } });
  const attempt = (it?: CardInstanceId, ch?: CardInstanceId) => () => flipUp(b.engine, P1, b.id("trap"), trapPicks(b, it, ch));
  refused(attempt(b.id("foeItem"), b.id("foe")), "the opponent's item");
  refused(attempt(b.id("mine"), b.id("foe")), "a character as the item");
  refused(attempt(b.id("myItem"), b.id("foeItem")), "an item as the character");
  refused(attempt(b.id("myItem"), b.id("fdChar")), "a face-down card as the character");
  refused(attempt(b.id("myItem"), undefined), "no character");
  refused(attempt(undefined, b.id("foe")), "no item");
  assert.equal(b.engine.state.cards[b.id("trap")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(b.engine), 4, "nothing was paid by the refused attempts");
  attempt(b.id("myItem"), b.id("foe"))();
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "control: legal picks are accepted");
});

clause(TRAP, "1:flipUp", "only its controller can flip it, and only while it is a face-down card in play (not from the hand)", () => {
  const theirs = trapBoard({ trap: "faceDown", icons: { elitism: 3 }, oppIcons: { elitism: 3 } });
  refused(() => flipUp(theirs.engine, P2, theirs.id("trap"), { it: [theirs.id("myItem")], ch: [theirs.id("foe")] }), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("trap")].faceDown, true);
  const inHand = trapBoard({ trap: "hand", icons: { elitism: 3 } });
  refused(() => flipUp(inHand.engine, P1, inHand.id("trap"), { it: [inHand.id("myItem")], ch: [inHand.id("foe")] }), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("trap")), "hand");
});

clause(TRAP, "1:flipUp", "FLIP UP does not change when a tactic can be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const b = trapBoard({ trap: "faceDown", icons: { elitism: 3 }, turn: 2, active: P2 });
  refused(() => flipUp(b.engine, P1, b.id("trap"), { it: [b.id("myItem")], ch: [b.id("foe")] }), "nothing to respond to yet");
  assert.equal(b.engine.state.cards[b.id("trap")].faceDown, true);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  flipUp(b.engine, P1, b.id("trap"), { it: [b.id("myItem")], ch: [b.id("foe")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "the attacker was sent home in response");
});

// =================================================================================
// Jo Ciendeilio, M07h3r 0f 1337
// UNIQUE JO
// Each character you control gains the following rules text:
//   "WORKING -- COST: Use this only if this card has been in play since the start of the turn.
//    Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 1."
// Character (Gearsmith, jo / blade of questionable morality), cost 5, [E][E][E][E], 1/3/2.
// =================================================================================

const JO = "f910cad2-4579-461a-ba39-6f4c322b979d";

type JoOpts = { icons?: Icons; oppIcons?: Icons; turn?: number; active?: PlayerId; jo?: Partial<CardPlacement> | null; extra?: CardPlacement[] };

function joBoard(opts: JoOpts = {}) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(opts.jo === null ? [] : ([{ key: "jo", def: printing(JO), owner: P1, zone: "play", ...(opts.jo ?? {}) }] as CardPlacement[])),
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 5 }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", life: 5 }), owner: P2, controller: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "two", def: character({ name: "Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "three", def: character({ name: "Three", cost: 3 }), owner: P1, zone: "hand" },
      { key: "kill", def: killChar(), owner: P1, zone: "hand" },
      {
        key: "payer",
        def: item({ name: "Payer", behavior: { abilities: [{ id: "pay3", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [] }] } }),
        owner: P1,
        zone: "play"
      },
      ...res(opts.icons ?? { greed: 14 }),
      ...res(opts.oppIcons ?? { greed: 8 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const working = (b: Board, key: string, who: PlayerId = P1) => activate(b.engine, who, b.id(key), "jo-research");
const hasWorking = (b: Board, key: string, who: PlayerId = P1) => b.engine.getAvailableActivatedAbilities(who).some((a) => a.cardId === b.id(key) && a.ability.id === "jo-research");
const NOT_FOUND = /Activated ability not found/;
/** Resources spent by playing `key` from `who`'s hand. */
function spentBy(b: Board, key: string, who: PlayerId = P1): number {
  const before = ready(b.engine, who);
  play(b.engine, who, b.id(key));
  return before - ready(b.engine, who);
}

// --- UNIQUE JO --------------------------------------------------------------------

function twoJos(opts: { second?: "hand" | "oppPlay" } = {}) {
  return joBoard({
    icons: { elitism: 8 },
    extra:
      opts.second === "oppPlay"
        ? [{ key: "jo2", def: printing(JO), owner: P2, zone: "play" }]
        : [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }]
  });
}

clause(JO, "0:unique", "deploying a second Jo while I control one forces me to choose which to keep (keep the new one: the old one is destroyed)", () => {
  const b = twoJos();
  play(b.engine, P1, b.id("jo2"));
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("jo"), b.id("jo2")].sort());
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("jo2") });
  assert.equal(zoneOf(b.engine, b.id("jo2")), "play");
  assert.equal(zoneOf(b.engine, b.id("jo")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(JO, "0:unique", "keeping the old copy destroys the new one", () => {
  const b = twoJos();
  play(b.engine, P1, b.id("jo2"));
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("jo") });
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(zoneOf(b.engine, b.id("jo2")), "discard");
});

clause(JO, "0:unique", "after the survivor choice the game carries on: no choice or response window is left open and the turn can be ended", () => {
  const b = twoJos();
  play(b.engine, P1, b.id("jo2"));
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("jo2") });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the turn passed to the opponent");
});

clause(JO, "0:unique", "UNIQUE only concerns my own cards: the opponent may have their own Jo in play with no choice and no destruction", () => {
  const b = twoJos({ second: "oppPlay" });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(zoneOf(b.engine, b.id("jo2")), "play");
});

clause(JO, "0:unique", "the opponent deploying their own Jo while I control one is fine", () => {
  const b = joBoard({ turn: 2, active: P2, oppIcons: { elitism: 6 }, extra: [{ key: "jo2", def: printing(JO), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("jo2"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no unique prompt for the opponent");
  assert.equal(zoneOf(b.engine, b.id("jo2")), "play");
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
});

clause(JO, "0:unique", "the designation is what counts, not the name: another card with the same UNIQUE designation conflicts, one with a different designation does not", () => {
  const same = joBoard({ extra: [{ key: "other", def: character({ name: "Totally Different Name", unique: "jo" }), owner: P1, zone: "hand" }] });
  play(same.engine, P1, same.id("other"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor", "same designation: a choice");
  const different = joBoard({ extra: [{ key: "other", def: character({ name: "Another Unique", unique: "somethingelse" }), owner: P1, zone: "hand" }] });
  play(different.engine, P1, different.id("other"));
  assert.equal(different.engine.state.pendingChoice, undefined, "different designation: no choice");
  assert.equal(zoneOf(different.engine, different.id("other")), "play");
  assert.equal(zoneOf(different.engine, different.id("jo")), "play");
});

// --- Each character you control gains the following rules text ---------------------

clause(JO, "1:rule", "every character I control has WORKING: Jo herself, my other characters and a character I control but do not own", () => {
  const b = joBoard();
  for (const key of ["jo", "mine", "mine2", "stolen"]) assert.equal(hasWorking(b, key), true, `${key} has WORKING`);
});

clause(JO, "1:rule", "only characters gain it: my item and my location do not (the ability is not found on them)", () => {
  const b = joBoard();
  assert.equal(hasWorking(b, "mine"), true, "control: a character has it");
  for (const key of ["myItem", "myPlace"]) {
    assert.equal(hasWorking(b, key), false, `${key} does not have WORKING`);
    refused(() => working(b, key), `${key} using WORKING`, NOT_FOUND);
  }
});

clause(JO, "1:rule", "only characters I CONTROL gain it: the opponent's characters do not, and my Jo does not help them", () => {
  const b = joBoard({ turn: 2, active: P2 });
  refused(() => working(b, "foe", P2), "the opponent's character under my Jo", NOT_FOUND);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  const theirs = joBoard({ turn: 2, active: P2, extra: [{ key: "foeJo", def: printing(JO), owner: P2, zone: "play" }] });
  working(theirs, "foe", P2);
  assert.equal(theirs.engine.state.cards[theirs.id("foe")].depleted, true, "control: with THEIR Jo in play their character has it");
});

clause(JO, "1:rule", "the opponent's Jo does not give WORKING to my characters", () => {
  const b = joBoard({ jo: null, extra: [{ key: "foeJo", def: printing(JO), owner: P2, zone: "play" }] });
  refused(() => working(b, "mine"), "my character under their Jo", NOT_FOUND);
  assert.equal(hasWorking(b, "mine"), false);
});

clause(JO, "1:rule", "a Pogo-Bunny gains it only while it is a character: not as an item, yes after RAAR!", () => {
  const b = joBoard({ extra: [{ key: "pogo", def: printing(POGO), owner: P1, zone: "play" }] });
  assert.equal(hasWorking(b, "pogo"), false, "an item does not have it");
  refused(() => working(b, "pogo"), "the Pogo-Bunny as an item", NOT_FOUND);
  activate(b.engine, P1, b.id("pogo"), "pogo-raar");
  assert.equal(hasWorking(b, "pogo"), true, "a character I control has it");
  working(b, "pogo");
  assert.equal(b.engine.state.cards[b.id("pogo")].depleted, true);
});

clause(JO, "1:rule", "the rules text is given by Jo in play: with Jo in my hand or in the discard pile nobody has it, and when Jo is destroyed the others lose it", () => {
  for (const zone of ["hand", "discard"] as const) {
    const b = joBoard({ jo: { zone } });
    assert.equal(hasWorking(b, "mine"), false, `Jo in ${zone}: no WORKING`);
    refused(() => working(b, "mine"), `Jo in ${zone}`, NOT_FOUND);
  }
  const b = joBoard();
  assert.equal(hasWorking(b, "mine"), true, "control: with Jo in play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("jo")] } });
  assert.equal(zoneOf(b.engine, b.id("jo")), "discard");
  assert.equal(hasWorking(b, "mine"), false, "Jo is gone, so is the rules text");
  refused(() => working(b, "mine"), "after Jo left play", NOT_FOUND);
  refused(() => working(b, "mine2"), "after Jo left play", NOT_FOUND);
});

// --- WORKING ------------------------------------------------------------------------

clause(JO, "2.0:grant-ability", "the granted ability is named WORKING", () => {
  const b = joBoard();
  assert.equal(abilityNameOf(b, "mine", "jo-research")?.toLowerCase(), "working");
});

clause(JO, "2.0:grant-ability", "the cost is depleting the character (no resources are paid) and the effect cuts the next numeric cost by 1: a cost-2 character then costs 1", () => {
  const b = joBoard();
  const before = ready(b.engine);
  working(b, "mine");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, "COST: deplete this card");
  assert.equal(b.engine.state.cards[b.id("mine2")].depleted, false, "only the user");
  assert.equal(b.engine.state.cards[b.id("jo")].depleted, false, "not Jo");
  assert.equal(ready(b.engine), before, "no resources paid");
  assert.equal(spentBy(b, "two"), 1, "cost 2 minus 1");
  assert.equal(zoneOf(b.engine, b.id("two")), "play");
});

clause(JO, "2.0:grant-ability", "Jo herself can use WORKING", () => {
  const b = joBoard();
  working(b, "jo");
  assert.equal(b.engine.state.cards[b.id("jo")].depleted, true);
  assert.equal(spentBy(b, "three"), 2, "cost 3 minus 1");
});

clause(JO, "2.0:grant-ability", "a character I control but do not own can use it too", () => {
  const b = joBoard();
  working(b, "stolen");
  assert.equal(b.engine.state.cards[b.id("stolen")].depleted, true);
  assert.equal(spentBy(b, "three"), 2);
});

clause(JO, "2.0:grant-ability", "it is only the NEXT numeric cost: the card after that pays full price", () => {
  const b = joBoard();
  working(b, "mine");
  assert.equal(spentBy(b, "three"), 2, "the next cost: 3 minus 1");
  assert.equal(spentBy(b, "two"), 2, "the one after pays in full");
});

clause(JO, "2.0:grant-ability", "a numeric cost never goes below 0: a cost-1 character is free, and that uses the reduction up", () => {
  const b = joBoard();
  working(b, "mine");
  assert.equal(spentBy(b, "one"), 0, "cost 1 minus 1");
  assert.equal(spentBy(b, "two"), 2, "used up: the next card pays in full");
});

clause(JO, "2.0:grant-ability", "it needs no resources: usable with none in play", () => {
  const b = joBoard({ icons: {} });
  working(b, "mine");
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true);
});

clause(JO, "2.0:grant-ability", "Deplete this card is a real cost: a depleted character cannot use it, and a character uses it once (it is depleted afterwards)", () => {
  const b = joBoard({ extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  refused(() => working(b, "tired"), "already depleted");
  assert.equal(spentBy(b, "three"), 3, "nothing was reduced by the refused attempt");
  working(b, "mine");
  refused(() => working(b, "mine"), "depleted by the first use");
  assert.equal(spentBy(b, "two"), 1, "only one reduction came from the two attempts on the same character");
});

clause(JO, "2.0:grant-ability", "use this only if the character has been in play since the start of the turn: refused on a character deployed this turn, allowed on it next turn", () => {
  const b = joBoard();
  play(b.engine, P1, b.id("one"));
  assert.equal(zoneOf(b.engine, b.id("one")), "play");
  refused(() => working(b, "one"), "deployed this turn");
  assert.equal(b.engine.state.cards[b.id("one")].depleted, false, "nothing was depleted");
  working(b, "mine");
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, "control: a character already in play works");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  working(b, "one");
  assert.equal(b.engine.state.cards[b.id("one")].depleted, true, "now it has been in play since the start of the turn");
});

clause(JO, "2.0:grant-ability", "two characters using it stack on the same next cost: with two reductions a cost-3 card costs 1", () => {
  const b = joBoard();
  working(b, "mine");
  working(b, "mine2");
  assert.equal(spentBy(b, "three"), 1, "3 minus 1 minus 1");
});

clause(JO, "2.0:grant-ability", "an ability's 'pay N' is a numeric cost too (CR 406.5): the next ability cost is reduced (Pay 3 costs 2)", () => {
  const b = joBoard();
  working(b, "mine");
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("payer"), "pay3");
  assert.equal(before - ready(b.engine), 2, "Pay 3 minus 1");
});

clause(JO, "2.0:grant-ability", "...and that uses the reduction up: the card deployed afterwards costs full price", () => {
  const b = joBoard();
  working(b, "mine");
  activate(b.engine, P1, b.id("payer"), "pay3");
  assert.equal(spentBy(b, "two"), 2, "the reduction was used by the ability's Pay 3");
});

clause(JO, "2.0:grant-ability", "'this turn': an unused reduction ends with the turn: on my next turn a cost-2 character costs 2", () => {
  const b = joBoard();
  working(b, "mine");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  assert.equal(spentBy(b, "two"), 2, "the reduction did not carry over");
});

clause(JO, "2.0:grant-ability", "'this turn': it does not carry into the opponent's turn either: my response there costs full price", () => {
  const b = joBoard({
    extra: [{ key: "resp", def: tactic({ name: "Resp", cost: 2, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" }]
  });
  working(b, "mine");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  const before = ready(b.engine);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("resp"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(before - ready(b.engine), 2, "no leftover reduction on the opponent's turn");
});

clause(JO, "2.0:grant-ability", "'you pay': it reduces MY next cost, not the opponent's: their response during my attack costs full price and my reduction is still waiting afterwards", () => {
  const b = joBoard({
    extra: [{ key: "ptac", def: tactic({ name: "PTac", cost: 1, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  working(b, "mine");
  declareAttackOpenWindow(b.engine, P1, [b.id("mine2")]);
  const before = ready(b.engine, P2);
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("ptac"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(before - ready(b.engine, P2), 1, "the opponent pays the full 1");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(spentBy(b, "two"), 1, "my own reduction was not used up by their payment");
});

// =================================================================================
// M3CHm4n1c 31f
// When this card enters play, you may pay 2. If you do, you may put a token on up to 2 different
// non-resource cards.
// While there is a token on this card, it gains 2 strength and 2 life.
// Character (Gearsmith, mechanic / 31f), cost 2, [E][E], 1/3/1.
// =================================================================================

const MECH = "f6da3761-a0bd-463b-9571-aba48ccf95cd";

function mechBoard(opts: { mech?: "hand" | "play"; mechOver?: Partial<CardPlacement>; icons?: Icons; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mech", def: printing(MECH), owner: P1, zone: opts.mech ?? "hand", ...opts.mechOver },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handC", def: character({ name: "HandC" }), owner: P2, zone: "hand" },
      { key: "discC", def: character({ name: "DiscC" }), owner: P1, zone: "discard" },
      { key: "deckC", def: character({ name: "DeckC" }), owner: P1, zone: "deck" },
      { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const MECH_KEYS = ["mech", "mine", "foe", "myItem", "foePlace", "fd"];
const deployMech = (b: Board) => play(b.engine, P1, b.id("mech"));
const acceptPay = (b: Board) => answerPending(b.engine, "mayPay", { pay: true });
const declinePay = (b: Board) => answerPending(b.engine, "mayPay", { pay: false });
const pickTokens = (b: Board, ids: CardInstanceId[]) => answerPending(b.engine, "chooserSelectsTarget", { selected: ids });
const withTokens = (b: Board, keys = MECH_KEYS) => keys.filter((k) => tokensOn(b.engine, b.id(k)) > 0).sort();
const mechStats = (b: Board) => [b.engine.getStat(b.id("mech"), "strength"), b.engine.getStat(b.id("mech"), "speed"), b.engine.getStat(b.id("mech"), "life")];

clause(MECH, "0:rule", "entering play offers me to pay 2 more; paying 2 and picking two cards puts one token on each of them (mine and the opponent's), and nowhere else", () => {
  const b = mechBoard();
  const before = ready(b.engine);
  deployMech(b);
  const offer = pending(b.engine);
  assert.equal(offer?.kind, "mayPay", "a 'may pay' choice is offered");
  assert.equal(offer?.playerId, P1);
  acceptPay(b);
  const picker = pending(b.engine);
  assert.equal(picker?.kind, "chooserSelectsTarget", "then I choose the cards");
  assert.equal(picker?.playerId, P1);
  pickTokens(b, [b.id("mine"), b.id("foe")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 4, "2 to deploy it and 2 for the ability");
  assert.deepEqual(withTokens(b), ["foe", "mine"]);
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
  assert.equal(tokensOn(b.engine, b.id("foe")), 1);
  assert.equal(zoneOf(b.engine, b.id("mech")), "play");
});

clause(MECH, "0:rule", "I may decline to pay: only the deploy cost is paid and no token is placed", () => {
  const b = mechBoard();
  const before = ready(b.engine);
  deployMech(b);
  declinePay(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no 'put a token' choice follows a refusal");
  assert.equal(before - ready(b.engine), 2, "only the deploy cost");
  assert.deepEqual(withTokens(b), []);
  assert.equal(zoneOf(b.engine, b.id("mech")), "play");
});

clause(MECH, "0:rule", "if I cannot afford the 2 the 'may pay' is not offered and no token is placed; with exactly 4 resources in all it is offered", () => {
  for (const elitism of [2, 3]) {
    const b = mechBoard({ icons: { elitism } });
    deployMech(b);
    assert.equal(b.engine.state.pendingChoice, undefined, `${elitism} resources: nothing left to pay with`);
    assert.deepEqual(withTokens(b), []);
    assert.equal(zoneOf(b.engine, b.id("mech")), "play");
  }
  const b = mechBoard({ icons: { elitism: 4 } });
  deployMech(b);
  assert.equal(pending(b.engine)?.kind, "mayPay", "control: 2 + 2 is exactly affordable");
});

clause(MECH, "0:rule", "'up to 2': two, one or none are all allowed (the 2 is paid either way); three are refused", () => {
  const two = mechBoard();
  deployMech(two);
  acceptPay(two);
  pickTokens(two, [two.id("mine"), two.id("foe")]);
  assert.equal(withTokens(two).length, 2);
  const one = mechBoard();
  deployMech(one);
  acceptPay(one);
  pickTokens(one, [one.id("foe")]);
  assert.deepEqual(withTokens(one), ["foe"]);
  const none = mechBoard();
  const before = ready(none.engine);
  deployMech(none);
  acceptPay(none);
  pickTokens(none, []);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.deepEqual(withTokens(none), []);
  assert.equal(before - ready(none.engine), 4, "the 2 was paid even though no token was placed");
  const three = mechBoard();
  deployMech(three);
  acceptPay(three);
  refused(() => pickTokens(three, [three.id("mine"), three.id("foe"), three.id("myItem")]), "three cards");
  assert.deepEqual(withTokens(three), [], "nothing was placed by the refused answer");
  assert.equal(pending(three.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pickTokens(three, [three.id("mine"), three.id("foe")]);
  assert.deepEqual(withTokens(three), ["foe", "mine"]);
});

clause(MECH, "0:rule", "'2 different' cards: the same card twice is refused", () => {
  const b = mechBoard();
  deployMech(b);
  acceptPay(b);
  refused(() => pickTokens(b, [b.id("mine"), b.id("mine")]), "the same card twice");
  assert.equal(tokensOn(b.engine, b.id("mine")), 0, "no token was placed");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickTokens(b, [b.id("mine"), b.id("foe")]);
  assert.equal(tokensOn(b.engine, b.id("mine")), 1, "control: two different cards are accepted");
});

clause(MECH, "0:rule", "any non-resource card in play may get a token: my or their character, my item, their location, and M3CHm4n1c itself", () => {
  for (const key of ["mine", "foe", "myItem", "foePlace", "mech"]) {
    const b = mechBoard();
    deployMech(b);
    acceptPay(b);
    pickTokens(b, [b.id(key)]);
    assert.deepEqual(withTokens(b), [key], `${key} got the token`);
    assert.equal(tokensOn(b.engine, b.id(key)), 1);
  }
});

clause(MECH, "0:rule", "only NON-resource cards IN PLAY: a face-up resource, a face-down card, the factions and cards in a hand, discard pile or deck are refused", () => {
  const b = mechBoard({ extra: [{ key: "res1", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" }] });
  deployMech(b);
  acceptPay(b);
  const attempt = (id: CardInstanceId) => () => pickTokens(b, [id]);
  refused(attempt(b.id("res1")), "a face-up resource");
  refused(attempt(b.id("fd")), "a face-down card (a resource)");
  refused(attempt(b.engine.state.players[P1].factionId!), "my faction");
  refused(attempt(b.engine.state.players[P2].factionId!), "their faction");
  refused(attempt(b.id("handC")), "a card in their hand");
  refused(attempt(b.id("discC")), "a card in my discard pile");
  refused(attempt(b.id("deckC")), "a card in my deck");
  for (const key of [...MECH_KEYS, "res1", "handC", "discC", "deckC"]) assert.equal(tokensOn(b.engine, b.id(key)), 0, `${key} got nothing`);
  assert.equal(tokensOn(b.engine, b.engine.state.players[P2].factionId!), 0, "their faction got nothing");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pickTokens(b, [b.id("mine")]);
  assert.equal(tokensOn(b.engine, b.id("mine")), 1, "control: an in-play non-resource card is accepted");
});

clause(MECH, "0:rule", "the effect says 'put a token on' (it never says pick), so Gigantitect's Giant Giant ('cannot be picked') can still get a token (CR 310.1)", () => {
  const b = mechBoard({ extra: [{ key: "giant", def: printing(GGG), owner: P2, zone: "play" }] });
  deployMech(b);
  acceptPay(b);
  pickTokens(b, [b.id("giant"), b.id("mine")]);
  assert.equal(tokensOn(b.engine, b.id("giant")), 1, "choosing a card is not picking it");
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
});

clause(MECH, "0:rule", "it triggers only for ITSELF entering play: another card entering play offers nothing", () => {
  const b = mechBoard({ mech: "play" });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no 'may pay' for another card's entrance");
  assert.deepEqual(withTokens(b, [...MECH_KEYS, "other"]), []);
});

clause(MECH, "0:rule", "it triggers however it enters play, not just when deployed: put into play by an effect it still offers the payment", () => {
  const summon = tactic({
    name: "Summon",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "summon",
          type: "activated",
          targets: [{ id: "h", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = mechBoard({ extra: [{ key: "summon", def: summon, owner: P1, zone: "hand" }] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("summon"), { selected: { h: [b.id("mech")] } });
  assert.equal(zoneOf(b.engine, b.id("mech")), "play", "control: it was put into play");
  assert.equal(pending(b.engine)?.kind, "mayPay", "the entrance trigger fires");
  acceptPay(b);
  pickTokens(b, [b.id("foe")]);
  assert.equal(before - ready(b.engine), 2, "only the ability's 2 (the effect deployed it for free)");
  assert.equal(tokensOn(b.engine, b.id("foe")), 1);
});

// --- While there is a token on this card, it gains 2 strength and 2 life --------------

clause(MECH, "1:rule", "with no token it is 1 strength / 3 speed / 1 life; with a token it is 3 / 3 / 3; a second token adds nothing more", () => {
  const stats: Array<[number, number[]]> = [
    [0, [1, 3, 1]],
    [1, [3, 3, 3]],
    [2, [3, 3, 3]]
  ];
  for (const [n, expected] of stats) {
    const b = mechBoard({ mech: "play", mechOver: n ? { counters: { token: n } } : {} });
    assert.deepEqual(mechStats(b), expected, `${n} token(s): [strength, speed, life]`);
  }
});

clause(MECH, "1:rule", "only a TOKEN ON THIS CARD counts: a token on another card, or a different kind of counter on it, changes nothing", () => {
  const elsewhere = mechBoard({ mech: "play", extra: [{ key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play", counters: { token: 2 } }] });
  assert.deepEqual(mechStats(elsewhere), [1, 3, 1], "the token is on a different card");
  const otherKind = mechBoard({ mech: "play", mechOver: { counters: { other: 2 } } });
  assert.deepEqual(mechStats(otherKind), [1, 3, 1], "a counter that is not a token");
});

clause(MECH, "1:rule", "the bonus follows the token: it appears when a token is added and goes when the last token is removed", () => {
  const b = mechBoard({ mech: "play" });
  assert.deepEqual(mechStats(b), [1, 3, 1]);
  b.engine.state.cards[b.id("mech")].counters = { token: 1 };
  assert.deepEqual(mechStats(b), [3, 3, 3], "token added: on");
  b.engine.state.cards[b.id("mech")].counters = {};
  assert.deepEqual(mechStats(b), [1, 3, 1], "token removed: off");
  b.engine.state.cards[b.id("mech")].counters = { token: 1 };
  assert.deepEqual(mechStats(b), [3, 3, 3], "token back: on again");
});

clause(MECH, "1:rule", "putting the token on M3CHm4n1c itself through its own entrance ability gives it 3 strength and 3 life at once", () => {
  const b = mechBoard();
  deployMech(b);
  assert.deepEqual(mechStats(b), [1, 3, 1], "control: no token yet");
  acceptPay(b);
  pickTokens(b, [b.id("mech")]);
  assert.deepEqual(mechStats(b), [3, 3, 3]);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 1, "nothing else gained anything");
});

// @@END
