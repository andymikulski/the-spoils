// Batch r10-card-types (docs/TESTING.md), part 1: CR 201 Parts of a Card.
// Written from the wording of the Comprehensive Rules, not from the engine.
// Printed layout (art, frame, collector info) has no engine behavior and is exempted below;
// everything with engine-visible behavior (cost, threshold, types, trades, subtypes, rules-text
// timing, stats, structure, name identity) is tested.

import { describe } from "node:test";
import assert from "node:assert/strict";
import { findDeckConstructionIssues, getMaxCopies } from "../../../engine.js";
import type { CardDefinition, ResolutionContext, SpoilsEngine, Trade } from "../../../engine.js";
import {
  buildGame,
  character,
  factionCard,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";

const resource = (name: string, icon: "rage" | "greed" | "deception" = "rage") =>
  resourceCard({ name, resource: { provides: [icon] } });

/** `n` face-up resources providing `icon`, controlled by `owner`. */
function bank(prefix: string, n: number, owner: string = P1, icon: "rage" | "greed" | "deception" = "rage"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: resource(`${prefix} ${i}`, icon), owner }));
}

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

/** The kind of the open pending choice, read through a function so earlier assertions do not narrow it. */
const pendingKind = (engine: SpoilsEngine) => engine.state.pendingChoice?.kind;

const ctx = (engine: SpoilsEngine, sourceId: string): ResolutionContext => ({ sourceId, controllerId: P1, selected: {} });

/** Deploys a card and lets every response window close. */
function deploy(engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
  resolvePendingResponses(engine);
}

/** A tactic that destroys the picked card matching `selector`. */
const destroyer = (name: string, selector: Record<string, unknown> = { type: "character" }) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const makers: Array<[string, (o?: Partial<CardDefinition>) => CardDefinition]> = [
  ["character", character],
  ["item", item],
  ["location", location],
  ["tactic", tactic]
];

describe("CR 201.1 — name", () => {
  ruleExempt(
    "CR 201.1a",
    "Where the name and subtitle are printed on the card is physical layout; the name's engine meaning (identity) is tested under CR 201.1b."
  );

  rule("CR 201.1b", "a name selector picks a card of that name whatever printing it is (cost, set, rarity and stats differ)", () => {
    const wolfA = character({ name: "Wolf", set: "Alpha", cost: 1, rarity: "common", strength: 2, life: 2 });
    const wolfB = character({ name: "Wolf", set: "Beta", cost: 4, rarity: "rare", strength: 5, life: 5, speed: 3 });
    const bear = character({ name: "Bear", set: "Alpha", cost: 1, rarity: "common", strength: 2, life: 2 });
    const game = () =>
      buildGame({
        cards: [
          { key: "smite", def: destroyer("Smite", { name: "Wolf" }), owner: P1, zone: "hand" },
          { key: "wolfA", def: wolfA, owner: P2 },
          { key: "wolfB", def: wolfB, owner: P2 },
          { key: "bear", def: bear, owner: P2 }
        ]
      });

    for (const pick of ["wolfA", "wolfB"]) {
      const { engine, id } = game();
      deploy(engine, P1, id("smite"), { selected: { t: [id(pick)] } });
      assert.equal(zone(engine, id(pick)), "discard", `${pick} is "a Wolf" whichever printing it is`);
      assert.equal(zone(engine, id("bear")), "play", "a different name is a different card");
    }

    const { engine, id } = game();
    refused(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("smite"), selected: { t: [id("bear")] } }),
      "Bear is not a card named Wolf, although its printed characteristics equal Wolf's"
    );
  });

  rule("CR 201.1b", "two cards with the same name are the same card even when every other characteristic differs; equal characteristics under another name are not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wolf", def: character({ name: "Wolf", cost: 2, strength: 3, life: 3, speed: 2, set: "Alpha" }), owner: P1 },
        { key: "wolf2", def: character({ name: "Wolf", cost: 9, strength: 1, life: 1, speed: 0, set: "Omega", rarity: "ultra rare" }), owner: P2 },
        { key: "twin", def: character({ name: "Hound", cost: 2, strength: 3, life: 3, speed: 2, set: "Alpha" }), owner: P2 }
      ]
    });
    const sameCard = (a: string, b: string) =>
      engine.evaluateCondition({ type: "cardNameEquals", target: { type: "selected", id: "a" }, other: { type: "selected", id: "b" } }, {
        ...ctx(engine, id(a)),
        selected: { a: [id(a)], b: [id(b)] }
      });
    assert.equal(sameCard("wolf", "wolf2"), true, "both printings of Wolf are the same card");
    assert.equal(sameCard("wolf", "twin"), false, "a Hound with Wolf's exact characteristics is another card");
    const matches = (name: string) =>
      engine.queryCards({ name, zone: "play", type: "character" }, ctx(engine, id("wolf"))).map(card => card.id);
    assert.deepEqual(matches("Wolf").sort(), [id("wolf"), id("wolf2")].sort(), "a name query finds every printing of the name");
    assert.deepEqual(matches("Hound"), [id("twin")], "Hound matches only Hound");
  });

  rule("CR 201.1b", "the copy limit is judged per card: 4 copies of one name and 4 of another is legal, 5 of one printing is not", () => {
    const wolfA = character({ name: "Wolf", set: "Alpha", cost: 1 });
    const bear = character({ name: "Bear", set: "Alpha", cost: 1 });
    const faction = factionCard({ name: "F" });
    const times = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
    const copyIssues = (cards: CardDefinition[]) =>
      findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false }).filter(issue => issue.kind === "copyLimit");
    assert.equal(copyIssues([faction, ...times(wolfA, 4), ...times(bear, 4)]).length, 0, "4 Wolf and 4 Bear is legal");
    assert.equal(copyIssues([faction, ...times(wolfA, 4)]).length, 0, "4 copies is exactly the limit");
    assert.equal(copyIssues([faction, ...times(wolfA, 5)]).length, 1, "5 copies of one printing is over the limit");
  });

  rule("CR 201.1b", "cards of the same name are the same card, so a deck may hold 4 copies in total across printings", () => {
    const wolfA = character({ name: "Wolf", set: "Alpha", cost: 1 });
    const wolfB = character({ name: "Wolf", set: "Beta", cost: 2, rarity: "rare" });
    const faction = factionCard({ name: "F" });
    const times = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
    const copyIssues = (cards: CardDefinition[]) =>
      findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false }).filter(issue => issue.kind === "copyLimit");
    assert.equal(copyIssues([faction, ...times(wolfA, 2), ...times(wolfB, 2)]).length, 0, "4 cards named Wolf across two printings is exactly the limit");
    assert.equal(
      copyIssues([faction, ...times(wolfA, 3), ...times(wolfB, 2)]).length > 0,
      true,
      "5 cards named Wolf across two printings is over the 4-copy limit (the printings are the same card)"
    );
    assert.equal(copyIssues([faction, ...times(wolfA, 4), ...times(wolfB, 4)]).length > 0, true, "8 cards named Wolf across two printings is over the limit");
  });
});

describe("CR 201.2 — cost number", () => {
  for (const [label, make] of makers) {
    rule("CR 201.2a", `a cost-2 ${label} needs exactly 2 resources: playable with 2, refused with 1`, () => {
      const enough = buildGame({
        cards: [...bank("r", 2), { key: "c", def: make({ name: "C", cost: 2 }), owner: P1, zone: "hand" }]
      });
      assert.equal(enough.engine.getCardPlayability(P1, enough.id("c")).playable, true, "2 resources pay a cost of 2");
      enough.engine.perform({ type: "playCard", playerId: P1, cardId: enough.id("c") });
      assert.equal(zone(enough.engine, enough.id("c")), "deploying", "the card is being deployed");

      const short = buildGame({
        cards: [...bank("r", 1), { key: "c", def: make({ name: "C", cost: 2 }), owner: P1, zone: "hand" }]
      });
      const view = short.engine.getCardPlayability(P1, short.id("c"));
      assert.equal(view.numericCost, 2, "the cost number is the printed 2");
      assert.equal(view.playable, false, "one resource is too few");
      refused(
        () => short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("c") }),
        "a cost-2 card with a single resource",
        /cannot be paid|cannot be deployed/
      );
      assert.equal(zone(short.engine, short.id("c")), "hand", "the refused card stays in hand");
    });
  }

  rule("CR 201.2a", "a cost of 0 needs no resources", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C", cost: 0 }), owner: P1, zone: "hand" }] });
    assert.equal(engine.getAvailableResourceCount(P1), 0, "no resources in play");
    deploy(engine, P1, id("c"));
    assert.equal(zone(engine, id("c")), "play", "a free card is deployed with nothing to pay");
  });

  rule("CR 201.2a", "paying a cost of N spends exactly N resources and leaves the rest ready", () => {
    for (const cost of [1, 2, 3]) {
      const { engine, id } = buildGame({
        cards: [...bank("r", 4), { key: "c", def: item({ name: "C", cost }), owner: P1, zone: "hand" }]
      });
      deploy(engine, P1, id("c"));
      assert.equal(engine.getAvailableResourceCount(P1), 4 - cost, `a cost of ${cost} spends ${cost} of 4 resources`);
    }
  });

  rule("CR 201.2a", "the resources needed are the opponent-independent printed number: the opponent's resources do not pay", () => {
    const { engine, id } = buildGame({
      cards: [...bank("theirs", 3, P2), { key: "c", def: character({ name: "C", cost: 1 }), owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("c")).playable, false, "only the opponent has resources");
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "paying with the opponent's resources", /cannot be paid|cannot be deployed/);
  });
});

describe("CR 201.3 — threshold icons", () => {
  rule("CR 201.3a", "a card whose threshold is unmet cannot be played even at cost 0; one icon short is refused, exactly enough is accepted", () => {
    const def = () => character({ name: "Needy", cost: 0, threshold: "rr" });
    const none = buildGame({ cards: [{ key: "c", def: def(), owner: P1, zone: "hand" }] });
    assert.equal(none.engine.getCardPlayability(P1, none.id("c")).thresholdMet, false, "no icons");
    refused(() => none.engine.perform({ type: "playCard", playerId: P1, cardId: none.id("c") }), "no icons", /Threshold/);

    const one = buildGame({ cards: [...bank("r", 1), { key: "c", def: def(), owner: P1, zone: "hand" }] });
    assert.equal(one.engine.getCardPlayability(P1, one.id("c")).thresholdMet, false, "one icon short");
    refused(() => one.engine.perform({ type: "playCard", playerId: P1, cardId: one.id("c") }), "one icon short", /Threshold/);

    const exact = buildGame({ cards: [...bank("r", 2), { key: "c", def: def(), owner: P1, zone: "hand" }] });
    assert.equal(exact.engine.getCardPlayability(P1, exact.id("c")).thresholdMet, true, "exactly the icons");
    deploy(exact.engine, P1, exact.id("c"));
    assert.equal(zone(exact.engine, exact.id("c")), "play", "met threshold plays");
  });

  rule("CR 201.3a", "every icon of a mixed threshold must be controlled: two Rage do not make up for a missing Greed", () => {
    const def = () => item({ name: "Mixed", cost: 0, threshold: "rg" });
    const wrong = buildGame({ cards: [...bank("r", 2), { key: "c", def: def(), owner: P1, zone: "hand" }] });
    assert.equal(wrong.engine.getCardPlayability(P1, wrong.id("c")).thresholdMet, false, "two Rage, no Greed");
    refused(() => wrong.engine.perform({ type: "playCard", playerId: P1, cardId: wrong.id("c") }), "missing Greed", /Threshold/);

    const right = buildGame({
      cards: [...bank("r", 1), ...bank("g", 1, P1, "greed"), { key: "c", def: def(), owner: P1, zone: "hand" }]
    });
    assert.equal(right.engine.getCardPlayability(P1, right.id("c")).thresholdMet, true, "Rage and Greed");
    deploy(right.engine, P1, right.id("c"));
    assert.equal(zone(right.engine, right.id("c")), "play", "mixed threshold met");
  });

  rule("CR 201.3a", "only icons you control count: the opponent's icons do not meet your threshold", () => {
    const { engine, id } = buildGame({
      cards: [...bank("theirs", 3, P2), { key: "c", def: tactic({ name: "T", cost: 0, threshold: "r" }), owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("c")).thresholdMet, false, "the opponent's Rage is not mine");
  });

  rule("CR 201.3a", "resource icons are never spent to meet threshold: after playing a 'rr' card both Rage resources are still ready and still count", () => {
    const { engine, id } = buildGame({
      cards: [
        ...bank("r", 2),
        { key: "a", def: character({ name: "A", cost: 0, threshold: "rr" }), owner: P1, zone: "hand" },
        { key: "b", def: character({ name: "B", cost: 0, threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });
    deploy(engine, P1, id("a"));
    assert.equal(engine.getAvailableResourceCount(P1), 2, "meeting a threshold spends nothing");
    assert.equal(engine.getThresholds(P1).rage, 2, "the icons are still controlled");
    deploy(engine, P1, id("b"));
    assert.equal(zone(engine, id("b")), "play", "a second card with the same threshold is playable right after");
  });

  rule("CR 201.3a", "a resource that pays the cost still counts toward the threshold: cost 1 + threshold 'r' with a single Rage resource", () => {
    const { engine, id } = buildGame({
      cards: [...bank("r", 1), { key: "c", def: character({ name: "C", cost: 1, threshold: "r" }), owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("c")).playable, true, "one resource both pays and shows the icon");
    deploy(engine, P1, id("c"));
    assert.equal(zone(engine, id("c")), "play", "deployed");
    assert.equal(engine.getAvailableResourceCount(P1), 0, "the resource was spent on the cost");
    assert.equal(engine.getThresholds(P1).rage, 1, "yet its icon is still controlled");
  });

  rule("CR 201.3a", "a threshold of 0 (none printed) is always met", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: item({ name: "C", cost: 0, threshold: 0 }), owner: P1, zone: "hand" }] });
    assert.equal(engine.getCardPlayability(P1, id("c")).thresholdMet, true, "no icons required");
  });
});

describe("CR 201.4 — type line", () => {
  ruleExempt(
    "CR 201.4a",
    "Where the trade, supertype, type and subtypes are printed is physical layout; each field's engine behavior is tested under CR 201.4b-e."
  );

  rule("CR 201.4b", "a subtype named by an effect selects exactly the cards with that subtype (and only whole words)", () => {
    const hoard = character({
      name: "Hoard",
      strength: 1,
      life: 1,
      behavior: {
        abilities: [
          {
            id: "grow",
            type: "continuous",
            modifiers: [
              { target: "source", stat: "strength", operation: "add", value: { type: "count", selector: { controller: "self", subtype: "dragon" } } },
              { target: "source", stat: "life", operation: "add", value: { type: "count", selector: { controller: "self", subtype: "dragon" } } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "hoard", def: hoard, owner: P1 },
        { key: "d1", def: character({ name: "D1", subtype: ["dragon"] }), owner: P1 },
        { key: "d2", def: item({ name: "D2", subtype: ["dragon", "relic"] }), owner: P1 },
        { key: "fly", def: character({ name: "Fly", subtype: ["dragonfly"] }), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs", subtype: ["dragon"] }), owner: P2 }
      ]
    });
    assert.equal(engine.getStat(id("hoard"), "strength"), 3, "1 strength plus 1 for each of my two 'dragon' cards");
    assert.equal(engine.getStat(id("hoard"), "life"), 3, "1 life plus 1 for each of my two 'dragon' cards");
  });

  rule("CR 201.4b", "subtypes carry no rules of their own: a subtype changes no stat, keyword or playability", () => {
    const bare = buildGame({ cards: [{ key: "c", def: character({ name: "C", cost: 0, strength: 2, life: 3, speed: 4 }), owner: P1 }] });
    const typed = buildGame({
      cards: [{ key: "c", def: character({ name: "C", cost: 0, strength: 2, life: 3, speed: 4, subtype: ["dragon", "mau", "majig"] }), owner: P1 }]
    });
    for (const stat of ["strength", "life", "speed"] as const) {
      assert.equal(typed.engine.getStat(typed.id("c"), stat), bare.engine.getStat(bare.id("c"), stat), `${stat} is unaffected by subtypes`);
    }
    assert.deepEqual(typed.engine.getKeywords(typed.id("c")), bare.engine.getKeywords(bare.id("c")), "no keywords come from a subtype");
    assert.deepEqual(typed.engine.getSubtypes(typed.id("c")), ["dragon", "mau", "majig"], "the subtypes are listed for effects that name them");
  });

  rule("CR 201.4b", "not every card has subtypes", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1 }] });
    assert.deepEqual(engine.getSubtypes(id("c")), [], "a card without subtypes has none");
  });

  rule("CR 201.4c", "the staple supertype: staple resources may be included in unlimited copies, other cards only 4", () => {
    const staple = resource("Rage");
    const plain = resourceCard({ name: "Odd", resource: { provides: ["rage"], staple: false } });
    assert.equal(getMaxCopies(staple), null, "a staple has no copy limit");
    assert.equal(getMaxCopies(plain), 4, "a non-staple resource is limited to 4");
    assert.equal(getMaxCopies(character({ name: "C" })), 4, "a character is limited to 4");
    const copies = (card: CardDefinition, n: number) =>
      findDeckConstructionIssues([factionCard({ name: "F" }), ...Array.from({ length: n }, () => card)], { minimumSize: false, factionRules: false }).filter(
        issue => issue.kind === "copyLimit"
      );
    assert.equal(copies(staple, 30).length, 0, "30 copies of a staple is legal");
    assert.equal(copies(plain, 5).length, 1, "5 copies of a non-staple is not");
  });

  rule("CR 201.4c", "the staple supertype is what a 'staple' selector looks for", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "staple", def: resource("Rage"), owner: P1 },
        { key: "odd", def: resourceCard({ name: "Odd", resource: { provides: ["greed"], staple: false } }), owner: P1 }
      ]
    });
    const found = (staple: boolean) =>
      engine.queryCards({ type: "resource", staple, controller: "self" }, ctx(engine, id("staple"))).map(card => card.id);
    assert.deepEqual(found(true), [id("staple")], "only the staple");
    assert.deepEqual(found(false), [id("odd")], "only the non-staple");
  });

  rule("CR 201.4c", "the Unique supertype affects the rules of the card: a second Unique card with the same designation forces a choice of one to keep", () => {
    const king = (name: string) => character({ name, cost: 0, unique: "king" });
    const { engine, id } = buildGame({
      cards: [
        { key: "old", def: king("King A"), owner: P1 },
        { key: "new", def: king("King B"), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other", cost: 0, unique: "queen" }), owner: P1, zone: "hand" }
      ]
    });
    deploy(engine, P1, id("other"));
    assert.equal(engine.state.pendingChoice, undefined, "control: a different designation raises no choice");
    assert.equal(zone(engine, id("other")), "play", "control: it simply enters play");

    engine.perform({ type: "playCard", playerId: P1, cardId: id("new") });
    resolvePendingResponses(engine);
    assert.equal(pendingKind(engine), "uniqueSurvivor", "two UNIQUE KING cards: pick the one to keep");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("old") } });
    assert.equal(zone(engine, id("old")), "play", "the kept card stays");
    assert.equal(zone(engine, id("new")), "discard", "the other is destroyed");
  });

  rule("CR 201.4d", "each of the six trades is a trade a card can belong to, and trade tests tell them apart", () => {
    const trades: Trade[] = ["gearsmith", "warlord", "banker", "rogue", "arcanist", "universal"];
    const { engine, id } = buildGame({
      cards: trades.map((trade) => ({ key: trade, def: character({ name: `T-${trade}`, trade }), owner: P1 }))
    });
    for (const trade of trades) {
      for (const probe of trades) {
        const result = engine.evaluateCondition({ type: "cardTradeIs", target: "source", trade: probe }, ctx(engine, id(trade)));
        assert.equal(result, trade === probe, `a ${trade} card ${trade === probe ? "is" : "is not"} a ${probe} card`);
      }
    }
  });

  for (const type of ["resource", "tactic", "character", "location", "item", "faction"] as const) {
    rule("CR 201.4e", `${type} is a card type: a ${type} card has exactly that type`, () => {
      const def =
        type === "resource" ? resource("R") : type === "faction" ? factionCard({ name: "Fac" }) : makers.find(([label]) => label === type)![1]({ name: "X" });
      const { engine, id } = buildGame({ cards: [{ key: "x", def, owner: P1, zone: type === "faction" || type === "resource" ? "play" : "hand" }] });
      assert.deepEqual(engine.getCardTypes(id("x")), [type], `its only type is ${type}`);
      assert.equal(engine.hasCardType(id("x"), type), true, `it has the ${type} type`);
    });
  }

  rule("CR 201.4e", "types can be gained: an item that gains the character type has both", () => {
    const grant = tactic({
      name: "Animate",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "item" }, count: 1 }],
            effects: [{ type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 1, life: 3, speed: 1 }, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "animate", def: grant, owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P1 }
      ]
    });
    assert.deepEqual(engine.getCardTypes(id("gear")), ["item"], "before: only an item");
    deploy(engine, P1, id("animate"), { selected: { t: [id("gear")] } });
    assert.deepEqual([...engine.getCardTypes(id("gear"))].sort(), ["character", "item"], "after: an item and a character");
    assert.equal(zone(engine, id("gear")), "play", "it stays in play as a character with stats");
  });

  rule("CR 201.4e", "types can be lost: removing the gained character type leaves the item", () => {
    const flip = (kind: "setCardType" | "removeCardType") =>
      tactic({
        name: kind,
        behavior: {
          abilities: [
            {
              id: "a",
              type: "activated",
              targets: [{ id: "t", selector: { type: "item" }, count: 1 }],
              effects: [
                kind === "setCardType"
                  ? { type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 1, life: 3, speed: 1 }, duration: { type: "permanent" } }
                  : { type: "removeCardType", target: { type: "selected", id: "t" }, cardType: "character" }
              ]
            }
          ]
        }
      });
    const { engine, id } = buildGame({
      cards: [
        { key: "gain", def: flip("setCardType"), owner: P1, zone: "hand" },
        { key: "lose", def: flip("removeCardType"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear" }), owner: P1 }
      ]
    });
    deploy(engine, P1, id("gain"), { selected: { t: [id("gear")] } });
    assert.equal(engine.hasCardType(id("gear"), "character"), true, "gained");
    assert.equal(zone(engine, id("gear")), "play", "still in play");
    deploy(engine, P1, id("lose"), { selected: { t: [id("gear")] } });
    assert.equal(engine.hasCardType(id("gear"), "character"), false, "lost again");
    assert.deepEqual(engine.getCardTypes(id("gear")), ["item"], "back to its printed type");
  });
});
