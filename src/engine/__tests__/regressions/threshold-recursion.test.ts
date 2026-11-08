// Thresholds are read by the very rules that depend on them: a paragraph that begins with threshold icons is active
// only while its controller meets them (CR 405.4), and some of those paragraphs switch rules text off ("[G][G][G][G][G]:
// this card loses all other rules text"). A game that also contains an icon-granting card ("each resource you control
// gains PROVIDES: [D]") and a card that grants rules text to others used to answer a threshold read by asking whether
// the granter was suppressed, which asked the suppressor's threshold condition, which read the thresholds again:
// "Maximum call stack size exceeded", reported by `checkAction` as an illegal action, so the game had no legal action.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bank, buildGame, cardDef, character, developFaction, P1, P2, volition } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import {
  ELIGIBLE_FACTIONS,
  SET_NAMES,
  playRandomGame,
  randomSetup
} from "../support/driver.js";
import type { CardDefinition, ContinuousAbility } from "../../../engine.js";

const loafers = () => cardDef("Holy Heist", "Espionage Loafers");
const bookkeeper = () => cardDef("2nd Edition", "Embezzling Bookkeeper");
const broker = () => cardDef("Decade of Deckadence", "Black Market Broker");
const florist = () => cardDef("Seed Saga", "Lodge Dock Florist");

type Icons = Partial<Record<string, number>>;

function game(cards: CardPlacement[]) {
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards });
}

const thresholds = (b: ReturnType<typeof game>, player = P1): Icons => ({ ...b.engine.getThresholds(player) });

describe("Espionage Loafers on Embezzling Bookkeeper, with a granter in play and an icon granter in the game", () => {
  // Lodge Dock Florist grants rules text to every character, so the engine asks whether it is suppressed; Black Market
  // Broker in a hand is enough to make the game one where resource icons can be granted.
  const board = (greed: number, loafersController = P1, extra: CardPlacement[] = []): CardPlacement[] => [
    { key: "bk", def: bookkeeper(), owner: loafersController },
    { key: "lo", def: loafers(), owner: loafersController, attachedToKey: "bk" },
    { key: "fl", def: florist(), owner: P2 },
    { key: "br", def: broker(), owner: P2, zone: "hand" },
    ...bank("greed", greed, loafersController),
    ...extra
  ];

  test("thresholds are exactly the printed icons the player controls", () => {
    assert.deepEqual(thresholds(game(board(5))), { greed: 5 });
    assert.deepEqual(thresholds(game(board(4))), { greed: 4 });
    assert.deepEqual(thresholds(game(board(0))), {});
  });

  test("the [G][G][G][G][G] paragraph is active at five Greed and not at four, and the read returns", () => {
    for (const [greed, suppressed] of [
      [4, []],
      [5, ["espionage-covert", "espionage-backfire"]]
    ] as const) {
      const b = game(board(greed));
      const lo = b.id("lo");
      assert.deepEqual([...b.engine.getSuppressedAbilityIds(lo)].sort(), [...suppressed].sort(), `${greed} Greed`);
      // The paragraph that does the suppressing is never itself suppressed, and keeps the host COVERT either way.
      assert.equal(b.engine.isAbilitySuppressed(lo, "espionage-icon"), false);
      assert.equal(b.engine.hasKeyword(b.id("bk"), "covert"), true, `${greed} Greed: the host has COVERT`);
    }
  });

  test("the Greed icons the suppressed card is read against are still counted", () => {
    const b = game(board(5));
    assert.equal(b.engine.getSuppressedAbilityIds(b.id("lo")).length, 2);
    assert.deepEqual(thresholds(b), { greed: 5 });
  });

  test("the Broker's icons count too: five Greed resources and a Broker are five Greed and five Deception", () => {
    const b = game(board(5, P1, [{ key: "brInPlay", def: broker(), owner: P1 }]));
    assert.deepEqual(thresholds(b), { greed: 5, deception: 5 });
    assert.equal(b.engine.getSuppressedAbilityIds(b.id("lo")).length, 2, "[G][G][G][G][G] is met");
  });

  test("playability that depends on those thresholds", () => {
    const needsDeception = character({ name: "Needs Five Deception", threshold: "ddddd", cost: 0 });
    const needsGreed = character({ name: "Needs Six Greed", threshold: "gggggg", cost: 0 });
    const hand = (): CardPlacement[] => [
      { key: "nd", def: needsDeception, owner: P1, zone: "hand" },
      { key: "ng", def: needsGreed, owner: P1, zone: "hand" },
      { key: "lo2", def: loafers(), owner: P1, zone: "hand" }
    ];

    const without = game(board(5, P1, hand()));
    assert.equal(without.engine.getCardPlayability(P1, without.id("nd")).thresholdMet, false, "no Broker, no [D]");
    assert.equal(without.engine.getCardPlayability(P1, without.id("ng")).thresholdMet, false, "five Greed is not six");
    const loafersPlay = without.engine.getCardPlayability(P1, without.id("lo2"));
    assert.equal(loafersPlay.thresholdMet, true, "Espionage Loafers needs [G][G]");
    assert.equal(loafersPlay.playable, true);

    const withBroker = game(board(5, P1, [...hand(), { key: "brInPlay", def: broker(), owner: P1 }]));
    assert.equal(withBroker.engine.getCardPlayability(P1, withBroker.id("nd")).thresholdMet, true, "the Broker gave each resource [D]");
    assert.equal(withBroker.engine.getCardPlayability(P1, withBroker.id("ng")).thresholdMet, false);

    const short = game(board(1, P1, hand()));
    const tooFew = short.engine.getCardPlayability(P1, short.id("lo2"));
    assert.equal(tooFew.thresholdMet, false, "one Greed is short of [G][G]");
    assert.equal(tooFew.playable, false);
  });

  test("the reverse arrangement: the opponent wears the Loafers, this player has the granter and the Broker", () => {
    const reversed: CardPlacement[] = [
      { key: "br", def: broker(), owner: P1 },
      { key: "fl", def: florist(), owner: P1 },
      ...bank("greed", 5, P2),
      { key: "lo", def: loafers(), owner: P2, attachedToKey: "bk" },
      { key: "bk", def: bookkeeper(), owner: P2 }
    ];
    const b = game(reversed);
    assert.deepEqual(thresholds(b, P2), { greed: 5 });
    assert.deepEqual(thresholds(b, P1), {});
    assert.equal(b.engine.getSuppressedAbilityIds(b.id("lo")).length, 2);
  });

  test("the Loafers worn by the opponent's character still reads the wearer's controller's thresholds", () => {
    const b = game([
      { key: "bk", def: bookkeeper(), owner: P2 },
      { key: "lo", def: loafers(), owner: P1, attachedToKey: "bk" },
      { key: "fl", def: florist(), owner: P2 },
      { key: "br", def: broker(), owner: P2, zone: "hand" },
      ...bank("greed", 5, P1),
      ...bank("greed", 2, P2)
    ]);
    assert.deepEqual(thresholds(b, P1), { greed: 5 });
    assert.deepEqual(thresholds(b, P2), { greed: 2 });
    assert.equal(b.engine.getSuppressedAbilityIds(b.id("lo")).length, 2, "its controller's five Greed count");
  });
});

describe("every threshold-gated 'loses all other rules text' paragraph, beside a granter and an icon granter", () => {
  const withGranter = (cards: CardPlacement[]) =>
    game([
      { key: "fl", def: florist(), owner: P2 },
      { key: "br", def: broker(), owner: P2, zone: "hand" },
      ...cards
    ]);

  test("Monstrous Lassitude: [V][V][V][V] (face-down resources)", () => {
    for (const set of ["Decade of Deckadence", "Shade of the Devoured Emperor"]) {
      const lassitude = () => cardDef(set, "Monstrous Lassitude");
      const four = withGranter([{ key: "ml", def: lassitude(), owner: P1 }, ...volition(4)]);
      assert.deepEqual(thresholds(four), { volition: 4 });
      assert.deepEqual(four.engine.getSuppressedAbilityIds(four.id("ml")), ["ml-skip"], set);
      const three = withGranter([{ key: "ml", def: lassitude(), owner: P1 }, ...volition(3)]);
      assert.deepEqual(thresholds(three), { volition: 3 });
      assert.deepEqual(three.engine.getSuppressedAbilityIds(three.id("ml")), [], set);
    }
  });

  test("Crimson Pandiatus: [R][R][R][R][R][R] gains 4 life and loses its other rules text", () => {
    const life = cardDef("Ungodly Mess", "Crimson Pandiatus").life!;
    const six = withGranter([{ key: "cp", def: cardDef("Ungodly Mess", "Crimson Pandiatus"), owner: P1 }, ...bank("rage", 6)]);
    assert.deepEqual(thresholds(six), { rage: 6 });
    assert.deepEqual(six.engine.getSuppressedAbilityIds(six.id("cp")), ["still"]);
    const five = withGranter([{ key: "cp", def: cardDef("Ungodly Mess", "Crimson Pandiatus"), owner: P1 }, ...bank("rage", 5)]);
    assert.deepEqual(thresholds(five), { rage: 5 });
    assert.deepEqual(five.engine.getSuppressedAbilityIds(five.id("cp")), []);
    assert.equal(five.engine.getStat(five.id("cp"), "life"), life);
  });

  test("Rushing Crushing Blockhead: [R][R][R][R][R][R] loses its rules text and 1 speed", () => {
    const def = () => cardDef("Shade of the Devoured Emperor", "Rushing Crushing Blockhead");
    const speed = def().speed!;
    const six = withGranter([{ key: "rc", def: def(), owner: P1 }, ...bank("rage", 6)]);
    assert.deepEqual(thresholds(six), { rage: 6 });
    assert.deepEqual([...six.engine.getSuppressedAbilityIds(six.id("rc"))].sort(), ["rcb-noblock", "rcb-recoil"]);
    assert.equal(six.engine.getStat(six.id("rc"), "speed"), Math.max(0, speed - 1));
    const five = withGranter([{ key: "rc", def: def(), owner: P1 }, ...bank("rage", 5)]);
    assert.deepEqual(five.engine.getSuppressedAbilityIds(five.id("rc")), []);
    assert.equal(five.engine.getStat(five.id("rc"), "speed"), speed);
  });
});

describe("synthetic cycles", () => {
  const thresholdGate = (threshold: string) => ({ type: "meetsThreshold", threshold }) as const;

  /** "Each resource you control gains PROVIDES: [D]", as Black Market Broker prints it. */
  const iconGranter = (name = "Icon Granter"): CardDefinition =>
    character({
      name,
      behavior: {
        abilities: [
          {
            id: "grant",
            type: "continuous",
            modifiers: [],
            providesGrants: [{ selector: { type: "resource", controller: "self" }, icon: "deception", onlyIfLacking: true }]
          } as ContinuousAbility
        ]
      }
    });

  /** "While you control [G][G]: all characters gain a rules paragraph" (the grant itself is irrelevant to icons). */
  const textGranter = (): CardDefinition =>
    character({
      name: "Text Granter",
      behavior: {
        abilities: [
          {
            id: "give-text",
            type: "continuous",
            condition: thresholdGate("gg"),
            modifiers: [],
            grantedAbilities: [
              { selector: { type: "character", controller: "any" }, abilities: [{ id: "nothing", type: "continuous", modifiers: [] }] }
            ]
          } as ContinuousAbility
        ]
      }
    });

  test("a granter whose own condition is a threshold does not recurse through the icon read", () => {
    const b = game([
      { key: "tg", def: textGranter(), owner: P1 },
      { key: "ig", def: iconGranter(), owner: P1 },
      ...bank("greed", 2)
    ]);
    assert.deepEqual(thresholds(b), { greed: 2, deception: 2 });
  });

  test("a suppressor that reaches the icon granter, gated on a threshold, settles", () => {
    const suppressor = (threshold: string): CardDefinition =>
      character({
        name: "Silencer",
        behavior: {
          abilities: [
            {
              id: "silence",
              type: "continuous",
              condition: thresholdGate(threshold),
              modifiers: [],
              suppressAllAbilities: { selector: { type: "character", name: "Icon Granter", controller: "any" } }
            } as ContinuousAbility
          ]
        }
      });
    const build = (greed: number) =>
      game([
        { key: "ig", def: iconGranter(), owner: P1 },
        { key: "sl", def: suppressor("gg"), owner: P1 },
        { key: "tg", def: textGranter(), owner: P1 },
        ...bank("greed", greed)
      ]);

    const met = build(2);
    assert.deepEqual(thresholds(met), { greed: 2 }, "[G][G] met: the icon granter is silenced, no [D]");
    assert.equal(met.engine.isAbilitySuppressed(met.id("ig")), true);

    const unmet = build(1);
    assert.deepEqual(thresholds(unmet), { greed: 1, deception: 1 }, "[G][G] not met: the icon granter works, the lone Greed gains [D]");
    assert.equal(unmet.engine.isAbilitySuppressed(unmet.id("ig")), false);
  });

  test("a granter that hands out the icon-granting ability, itself gated on a threshold, settles", () => {
    const handsOutIcons: CardDefinition = character({
      name: "Hands Out Icons",
      behavior: {
        abilities: [
          {
            id: "lend",
            type: "continuous",
            condition: thresholdGate("gg"),
            modifiers: [],
            grantedAbilities: [
              {
                selector: { type: "character", name: "Plain", controller: "self" },
                abilities: [
                  {
                    id: "lent-grant",
                    type: "continuous",
                    modifiers: [],
                    providesGrants: [{ selector: { type: "resource", controller: "self" }, icon: "deception", onlyIfLacking: true }]
                  } as ContinuousAbility
                ]
              }
            ]
          } as ContinuousAbility
        ]
      }
    });
    const build = (greed: number) =>
      game([
        { key: "ho", def: handsOutIcons, owner: P1 },
        { key: "pl", def: character({ name: "Plain" }), owner: P1 },
        ...bank("greed", greed)
      ]);
    assert.deepEqual(thresholds(build(2)), { greed: 2, deception: 2 }, "[G][G] is met, so Plain provides [D] to each resource");
    assert.deepEqual(thresholds(build(1)), { greed: 1 }, "[G][G] is not met, nothing is lent");
  });
});

describe("the random-play seed that found it", () => {
  // slot 30, setup seed 3002: Espionage Loafers worn by Embezzling Bookkeeper, Lodge Dock Florist in play, Black Market
  // Broker in a deck. The game used to end with no legal action ("Maximum call stack size exceeded" from `checkAction`).
  test("slot 30 / seed 3002 plays on instead of ending in a finding", () => {
    const slot = 30;
    const seed = 3002;
    const nf = ELIGIBLE_FACTIONS.length;
    const ns = SET_NAMES.length;
    const setup = JSON.parse(
      JSON.stringify(
        randomSetup(seed, {
          factions: [ELIGIBLE_FACTIONS[slot % nf], ELIGIBLE_FACTIONS[(slot + 13 + Math.floor(slot / nf)) % nf]],
          featuredSets: [SET_NAMES[slot % ns], SET_NAMES[(slot * 5 + 3 + Math.floor(slot / ns)) % ns]]
        })
      )
    );
    const result = playRandomGame(setup, Math.imul(seed, 2654435761) >>> 0, { maxActions: 450 });
    assert.notEqual(result.status, "finding", JSON.stringify(result.finding));
    assert.ok(result.actions.length > 121, "past the step where it used to stop");
  });
});
