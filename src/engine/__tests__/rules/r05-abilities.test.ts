// Batch r05-abilities (docs/TESTING.md): CR 501 Italic Text, 502 Abilities.
// Written from the wording of the Comprehensive Rules, not from the engine.
// (Triggers: .p4; conditionals and requirements: .p2; replacements: .p3; temporary rules text: .p5.)

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule, ruleOpen } from "./_rule.js";

type Placement = NonNullable<BuildGameOptions["cards"]>[number];

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
const influence = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].influence;

/** Face-up rage resources owned by `owner`, keys `<tag>0`, `<tag>1`, ... */
function rageBank(count: number, tag = "bank", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));
}

/** Face-up greed resources owned by `owner`. */
function greedBank(count: number, tag = "greed", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["greed"], staple: true } }),
    owner
  }));
}

/** How many resources `playerId` has spent: cards attached to their faction. */
function spent(engine: SpoilsEngine, playerId: PlayerId): number {
  const factionId = engine.state.players[playerId].factionId;
  return Object.values(engine.state.cards).filter(card => card.attachedTo === factionId && card.zone === "play").length;
}

/** An activated ability that gives its controller `amount` influence. */
const gain = (amount: number, extra: Record<string, unknown> = {}) => ({
  id: "go",
  type: "activated" as const,
  effects: [{ type: "modifyInfluence" as const, player: "controller" as const, amount }],
  ...extra
});

/** A character whose only ability gains `amount` influence. */
const gainer = (name: string, amount = 1, extra: Record<string, unknown> = {}) =>
  character({ name, behavior: { abilities: [gain(amount, extra)] } });

const blank = (name: string) => tactic({ name });

/** A tactic that destroys the card picked for target `t`. */
const destroyer = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: {}, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const use = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, abilityId = "go") =>
  engine.perform({ type: "activateAbility", playerId, cardId, abilityId });

describe("CR 501 — italic text", () => {
  rule("CR 501.1", "descriptive (flavor) text is not rules text: a card's flavor text and subtitle give it no keyword, ability or stat", () => {
    const flavored = character({
      name: "Poet",
      strength: 1,
      text: "",
      flavorText: "It has TACTICAL and COVERT, and gains 5 strength. Draw 3 cards.",
      subtitle: "AGGRO. Destroy all characters."
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "poet", def: flavored, owner: P2, zone: "hand" },
        { key: "card", def: character({ name: "Card" }), owner: P2 }
      ]
    });
    assert.deepEqual(engine.getKeywords(id("card")), [], "control: a plain card has no keywords");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    refused(
      () => engine.perform({ type: "playCard", playerId: P2, cardId: id("poet") }),
      "a card whose flavor text says TACTICAL deployed as a response",
      /tactic|TACTICAL|respon/i
    );
    assert.equal(zoneOf(engine, id("poet")), "hand");
  });

  rule("CR 501.1", "a card whose flavor text names a keyword does not have it in play, and its stats are the printed ones", () => {
    const flavored = character({ name: "Poet", strength: 1, flavorText: "It has COVERT, and gains 5 strength.", subtitle: "Covert" });
    const { engine, id } = buildGame({ cards: [{ key: "poet", def: flavored, owner: P1 }] });
    assert.equal(engine.hasKeyword(id("poet"), "covert"), false, "no covert from italic text");
    assert.equal(engine.getStat(id("poet"), "strength"), 1, "printed strength only");
  });

  rule("CR 501.1", "italic flavor text is not rules text for a rule that reads a card's rules text (a [V] icon in rules text)", () => {
    // "Characters with a [V] icon in their rules text gain 2 strength": the only [V] sits in the italic flavor text.
    const lord = character({
      name: "Lord",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [
              {
                selector: { type: "character", conditions: [{ type: "textMentionsIcon", target: { type: "selected", id: "__candidate" }, icon: "volition" }] },
                stat: "strength",
                operation: "add",
                value: 2
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "lord", def: lord, owner: P1 },
        { key: "rules", def: character({ name: "In Rules", strength: 1, text: "Draw a card [V]." }), owner: P1 },
        { key: "flavor", def: character({ name: "In Flavor", strength: 1, text: "Draw a card.", flavorText: "A tale of [V] and woe." }), owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("rules"), "strength"), 3, "control: a [V] in the rules text counts");
    assert.equal(engine.getStat(id("flavor"), "strength"), 1, "a [V] only in italic flavor text does not count");
  });

  ruleOpen(
    "CR 501.1",
    "RQ-r05-abilities-1",
    "italic reminder text is not rules text: a [V] only inside reminder text does not count as a [V] in the card's rules text",
    () => {
      const lord = character({
        name: "Lord",
        behavior: {
          abilities: [
            {
              id: "aura",
              type: "continuous",
              modifiers: [
                {
                  selector: { type: "character", conditions: [{ type: "textMentionsIcon", target: { type: "selected", id: "__candidate" }, icon: "volition" }] },
                  stat: "strength",
                  operation: "add",
                  value: 2
                }
              ]
            }
          ]
        }
      });
      const reminded = character({
        name: "Reminded",
        strength: 1,
        text: "Draw a card. (A face-down card provides [V].)",
        markup: "<rule>Draw a card.<reminder>A face-down card provides [V].</reminder></rule>"
      });
      const { engine, id } = buildGame({
        cards: [
          { key: "lord", def: lord, owner: P1 },
          { key: "reminded", def: reminded, owner: P1 }
        ]
      });
      assert.equal(engine.getStat(id("reminded"), "strength"), 1, "a [V] only inside reminder text is not in the rules text");
    }
  );
});

describe("CR 502 — abilities", () => {
  rule("CR 502.1", "an ability has a cost section and an effect section: the cost is paid when it is used, the effect happens when it resolves", () => {
    const source = character({
      name: "Source",
      behavior: { abilities: [gain(2, { costs: [{ type: "deplete", target: "source" }] })] }
    });
    const { engine, id } = buildGame({ cards: [{ key: "source", def: source, owner: P1 }] });
    const before = influence(engine, P1);
    use(engine, P1, id("source"));
    assert.equal(engine.state.cards[id("source")]!.depleted, true, "the cost (deplete this card) is paid at once");
    assert.equal(influence(engine, P1), before, "the effect has not happened yet");
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), before + 2, "the effect happened when the ability resolved");
  });

  rule("CR 502.1", "an ability with a cost cannot be used for free: without the cost being payable nothing happens", () => {
    const source = character({
      name: "Source",
      behavior: { abilities: [gain(2, { costs: [{ type: "payResources", amount: 1 }] })] }
    });
    const none = buildGame({ cards: [{ key: "source", def: source, owner: P1 }] });
    refused(() => use(none.engine, P1, none.id("source")), "use an ability with an unpayable cost", /cannot be paid|enough|resource|cost/i);
    assert.equal(influence(none.engine, P1), 25, "no effect");
    const paid = buildGame({ cards: [{ key: "source", def: { ...source, id: "src2" }, owner: P1 }, ...rageBank(1)] });
    use(paid.engine, P1, paid.id("source"));
    resolvePendingResponses(paid.engine);
    assert.equal(influence(paid.engine, P1), 27, "control: with a resource to pay, the effect happens");
    assert.equal(spent(paid.engine, P1), 1, "and the cost of 1 was paid");
  });

  const thresholdSource = () =>
    character({
      name: "Source",
      behavior: { abilities: [gain(2, { threshold: "rr", costs: [{ type: "payResources", amount: 1 }] })] }
    });

  rule("CR 502.2", "an ability with a threshold can be used when the threshold is met and the costs can be satisfied; threshold icons are not spent", () => {
    const { engine, id } = buildGame({ cards: [{ key: "source", def: thresholdSource(), owner: P1 }, ...rageBank(2)] });
    use(engine, P1, id("source"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 27, "the ability resolved");
    assert.equal(spent(engine, P1), 1, "only the cost of 1 was paid, not the threshold");
  });

  rule("CR 502.2", "you can't use an ability unless you've met its threshold: one icon short is refused even though the cost is payable", () => {
    // One rage icon and two greed: 3 resources can pay the cost of 1, but only one [R] of the two required.
    const short = buildGame({ cards: [{ key: "source", def: thresholdSource(), owner: P1 }, ...rageBank(1), ...greedBank(2)] });
    refused(() => use(short.engine, P1, short.id("source")), "ability with an unmet threshold", /threshold/i);
    assert.equal(influence(short.engine, P1), 25);
    assert.equal(spent(short.engine, P1), 0, "nothing was paid");
    const exact = buildGame({ cards: [{ key: "source", def: thresholdSource(), owner: P1 }, ...rageBank(2), ...greedBank(1)] });
    use(exact.engine, P1, exact.id("source"));
    resolvePendingResponses(exact.engine);
    assert.equal(influence(exact.engine, P1), 27, "control: exactly two rage icons work");
  });

  rule("CR 502.2", "you can't use an ability unless you can satisfy all its costs, even when the threshold is met", () => {
    const costly = character({
      name: "Costly",
      behavior: { abilities: [gain(2, { threshold: "rr", costs: [{ type: "payResources", amount: 3 }] })] }
    });
    const short = buildGame({ cards: [{ key: "source", def: costly, owner: P1 }, ...rageBank(2)] });
    refused(() => use(short.engine, P1, short.id("source")), "threshold met but the cost of 3 is not payable with 2 resources", /cannot be paid|enough|resource|cost/i);
    assert.equal(spent(short.engine, P1), 0, "nothing was paid");
    const ok = buildGame({ cards: [{ key: "source", def: { ...costly, id: "costly2" }, owner: P1 }, ...rageBank(3)] });
    use(ok.engine, P1, ok.id("source"));
    resolvePendingResponses(ok.engine);
    assert.equal(influence(ok.engine, P1), 27, "control: with 3 resources the cost is payable");
  });

  rule("CR 502.2", "a threshold-less ability needs no icons: it works with no resources at all", () => {
    const { engine, id } = buildGame({ cards: [{ key: "source", def: gainer("Source", 2), owner: P1 }] });
    use(engine, P1, id("source"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 27);
  });

  rule("CR 502.2", "the threshold applies to either player: the opponent needs their own icons to use an ability in response", () => {
    const mine = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "source", def: thresholdSource(), owner: P2 },
        ...rageBank(1, "theirs", P2),
        ...rageBank(2, "mine", P1)
      ]
    });
    mine.engine.perform({ type: "playCard", playerId: P1, cardId: mine.id("opener") });
    refused(() => use(mine.engine, P2, mine.id("source")), "opponent with one rage icon uses a two-icon ability", /threshold/i);
    const ok = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "source", def: thresholdSource(), owner: P2 },
        ...rageBank(2, "theirs", P2)
      ]
    });
    ok.engine.perform({ type: "playCard", playerId: P1, cardId: ok.id("opener") });
    use(ok.engine, P2, ok.id("source"));
    resolvePendingResponses(ok.engine);
    assert.equal(influence(ok.engine, P2), 27, "control: with two rage icons the opponent's ability resolved");
  });

  rule("CR 502.3", "like a tactic, an ability can be used in response to the opponent's action on the opponent's turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "source", def: gainer("Source", 2), owner: P2 }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    use(engine, P2, id("source"));
    assert.equal(engine.state.responseStack.length, 2, "the ability sits on the stack above the opponent's card");
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P2), 27);
  });

  rule("CR 502.3", "outside a response, a non-active player cannot use an ability on the opponent's turn (control: the active player can)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: gainer("Mine", 2), owner: P1 },
        { key: "theirs", def: gainer("Theirs", 2), owner: P2 }
      ]
    });
    refused(() => use(engine, P2, id("theirs")), "the non-active player uses an ability with nothing to respond to", /timing|respon|turn/i);
    use(engine, P1, id("mine"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 27, "control: the active player used theirs on their own turn");
    assert.equal(influence(engine, P2), 25, "the refused ability did nothing");
  });

  rule("CR 502.3", "special times during battles: abilities can be used after attackers are declared (attacker, then defender)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: gainer("Attacker", 1), owner: P1 },
        { key: "b", def: gainer("Defender", 2), owner: P2, attackEligible: false }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")], target: { type: "faction", playerId: P2 } });
    refused(() => use(engine, P2, id("b")), "the defender acts before the attacker has passed", /priority|timing/);
    use(engine, P1, id("a"));
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the defender may respond to the attacker's ability");
    use(engine, P2, id("b"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 26, "the attacker's ability resolved");
    assert.equal(influence(engine, P2), 27, "the defender's ability resolved");
  });

  rule("CR 502.3", "special times during battles: abilities can be used after blockers are declared, before damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: gainer("Attacker", 1), owner: P1 },
        { key: "b", def: gainer("Defender", 2), owner: P2, attackEligible: false }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    assert.equal(engine.state.responseWindow?.kind, "battleBeforeDamage", "a window opens before damage");
    use(engine, P1, id("a"));
    use(engine, P2, id("b"));
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 26);
    assert.equal(influence(engine, P2), 27);
  });

  rule("CR 502.3", "abilities cannot be used at other times in a battle: while blockers are being declared or damage is being assigned", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: gainer("Attacker", 1), owner: P1 },
        { key: "b", def: gainer("Defender", 2), owner: P2, attackEligible: false }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.phase, "blocking");
    refused(() => use(engine, P1, id("a")), "attacker ability while blockers are being declared", /timing|respon/i);
    refused(() => use(engine, P2, id("b")), "defender ability while blockers are being declared", /timing|respon/i);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.phase, "attackerDamageAssignment");
    refused(() => use(engine, P1, id("a")), "attacker ability while damage is assigned", /timing|respon/i);
    assert.equal(influence(engine, P1), 25, "nothing happened");
  });

  rule("CR 502.4", "an ability resolves from the text it had when its cost was paid, even if its source has left play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "source", def: gainer("Source", 3, { costs: [{ type: "deplete", target: "source" }] }), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" }
      ]
    });
    use(engine, P1, id("source"));
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("source")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("source")), "discard", "the source left play before its ability resolved");
    assert.equal(influence(engine, P1), 28, "the ability still resolved as written");
  });

  rule("CR 502.4", "an ability resolves as written when its source's rules text has since been removed (control: a new use is then refused)", () => {
    const strip = tactic({
      name: "Strip",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "suppressAbilities", target: { type: "selected", id: "t" }, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "source", def: gainer("Source", 3), owner: P1 },
        { key: "strip", def: strip, owner: P2, zone: "hand" }
      ]
    });
    use(engine, P1, id("source"));
    engine.perform({ type: "playCard", playerId: P2, cardId: id("strip"), selected: { t: [id("source")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("source")), "play", "the source is still in play");
    assert.equal(influence(engine, P1), 28, "the ability already used still resolved as written");
    refused(() => use(engine, P1, id("source")), "a new use of the ability after its text was removed", /not found|timing/i);
  });

  rule("CR 502.4", "an ability resolves as written when its source was flipped face-down in response", () => {
    const flip = tactic({
      name: "Flip",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "source", def: gainer("Source", 3), owner: P1 },
        { key: "flip", def: flip, owner: P2, zone: "hand" }
      ]
    });
    use(engine, P1, id("source"));
    engine.perform({ type: "playCard", playerId: P2, cardId: id("flip"), selected: { t: [id("source")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("source")]!.faceDown, true, "the source is now a face-down card with no text");
    assert.equal(influence(engine, P1), 28, "the ability already used still resolved as written");
  });
});
