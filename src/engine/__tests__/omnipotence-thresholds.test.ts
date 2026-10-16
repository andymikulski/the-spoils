// CR §405.4 / §201.5d: a paragraph that begins with threshold icons is active
// only while its controller MEETS that threshold. The `meetsThreshold`
// condition is that gate: real icons OR OMNIPOTENCE (`meetsAllThresholds`,
// The Evil Alliance: "You automatically meet all thresholds, even if you don't
// control the proper resource icons"). Counting a number of icons (`resourceIcons`
// in an amount, or an inline "if you control [V][V][V]") always reads the REAL
// icons — OMNIPOTENCE does not inflate them. RULES.md §4.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  factionCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import { bank, cardDef, play, printedRules, volition } from "./per-card/_harness.js";
import cardsJson from "../../data/cards.js";
import type { CardDefinition, Condition, NumberExpression } from "../../engine.js";

const faction = (over: Partial<CardDefinition> & { omnipotent?: boolean } = {}): CardDefinition => {
  const { omnipotent, ...rest } = over;
  return factionCard({
    name: omnipotent ? "OmniFaction" : "PlainFaction",
    id: `omni-test-${omnipotent ? "omni" : "plain"}-${Math.random()}`,
    faction: {
      startingInfluence: 30,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "draw", count: 1 }] }
      },
      ...(omnipotent ? { meetsAllThresholds: true } : {})
    },
    ...rest
  });
};

const OMNI = () => faction({ omnipotent: true });
const PLAIN = () => faction();

const meets = (threshold: string, player?: "controller" | "opponent"): Condition => ({
  type: "meetsThreshold",
  threshold,
  ...(player ? { player } : {})
});

const rageIcons: NumberExpression = { type: "resourceIcons", player: "controller", icon: "rage" };

/** A character with one continuous paragraph: +3 life while `condition` holds. */
const paragraph = (condition: Condition): CardDefinition =>
  character({
    name: "Paragraph",
    strength: 1,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "para",
          type: "continuous",
          condition,
          modifiers: [{ target: "source", stat: "life", operation: "add", value: 3 }]
        }
      ]
    }
  });

const lifeWith = (
  def: CardDefinition,
  setup: { me?: CardDefinition; them?: CardDefinition; cards?: CardPlacement[] }
): number => {
  const { engine, id } = buildGame({
    playerA: { faction: setup.me ?? PLAIN() },
    playerB: { faction: setup.them ?? PLAIN() },
    cards: [{ key: "card", def, owner: P1, zone: "play" }, ...(setup.cards ?? [])]
  });
  return engine.getStat(id("card"), "life");
};

describe("meetsThreshold: a threshold paragraph needs real icons, or OMNIPOTENCE", () => {
  const rrr = paragraph(meets("rrr"));

  test("without OMNIPOTENCE it is on only at the threshold, and does not stack past it", () => {
    assert.equal(lifeWith(rrr, { cards: bank("rage", 2) }), 3);
    assert.equal(lifeWith(rrr, { cards: bank("rage", 3) }), 6);
    assert.equal(lifeWith(rrr, { cards: bank("rage", 7) }), 6);
  });

  test("the wrong icons do not meet it", () => {
    assert.equal(lifeWith(rrr, { cards: [...bank("greed", 5), ...bank("obsession", 5)] }), 3);
  });

  test("an OMNIPOTENCE controller meets it with no icons at all", () => {
    assert.equal(lifeWith(rrr, { me: OMNI() }), 6);
  });

  test("an OMNIPOTENCE controller with real icons still gets it once, not stacked", () => {
    assert.equal(lifeWith(rrr, { me: OMNI(), cards: bank("rage", 9) }), 6);
  });

  test("only the controller's faction grants it: the opponent's OMNIPOTENCE does not help", () => {
    assert.equal(lifeWith(rrr, { me: PLAIN(), them: OMNI() }), 3);
  });

  test("the opponent's icons never count for the controller", () => {
    assert.equal(lifeWith(rrr, { cards: bank("rage", 5, P2) }), 3);
  });

  test("a card under an OMNIPOTENCE player's control uses that player's faction, not its owner's", () => {
    const { engine, id } = buildGame({
      playerA: { faction: PLAIN() },
      playerB: { faction: OMNI() },
      cards: [{ key: "card", def: rrr, owner: P1, controller: P2, zone: "play" }]
    });
    assert.equal(engine.getStat(id("card"), "life"), 6);
  });

  test("a mixed-icon threshold needs every icon, unless OMNIPOTENCE", () => {
    const rrgg = paragraph(meets("rrgg"));
    assert.equal(lifeWith(rrgg, { cards: [...bank("rage", 2), ...bank("greed", 1)] }), 3);
    assert.equal(lifeWith(rrgg, { cards: [...bank("rage", 1), ...bank("greed", 5)] }), 3);
    assert.equal(lifeWith(rrgg, { cards: [...bank("rage", 2), ...bank("greed", 2)] }), 6);
    assert.equal(lifeWith(rrgg, { me: OMNI() }), 6);
  });

  test("face-down resources provide Volition toward a [V] threshold", () => {
    const vv = paragraph(meets("vv"));
    assert.equal(lifeWith(vv, { cards: volition(1) }), 3);
    assert.equal(lifeWith(vv, { cards: volition(2) }), 6);
    assert.equal(lifeWith(vv, { me: OMNI() }), 6);
  });

  test("`player: \"opponent\"` reads the opponent's icons and the opponent's OMNIPOTENCE", () => {
    const theirRR = paragraph(meets("rr", "opponent"));
    assert.equal(lifeWith(theirRR, {}), 3);
    assert.equal(lifeWith(theirRR, { cards: bank("rage", 2, P2) }), 6);
    assert.equal(lifeWith(theirRR, { them: OMNI() }), 6);
    assert.equal(lifeWith(theirRR, { me: OMNI() }), 3);
  });

  test("a printed-threshold reduction for the next deploy does not loosen a standing paragraph", () => {
    const { engine, id } = buildGame({
      playerA: { faction: PLAIN() },
      cards: [{ key: "card", def: rrr, owner: P1, zone: "play" }, ...bank("rage", 2)]
    });
    engine.state.thresholdReductions.push({
      id: "reduce-1",
      playerId: P1,
      icon: "rage",
      amount: 1,
      createdTurn: engine.state.turn
    });
    assert.equal(engine.getStat(id("card"), "life"), 3);
  });

  test("it grants a keyword the same way", () => {
    const covert = character({
      name: "Covert",
      behavior: {
        abilities: [
          {
            id: "kw",
            type: "continuous",
            condition: meets("ooo"),
            modifiers: [],
            keywords: [{ keyword: "covert" }]
          }
        ]
      }
    });
    const build = (me: CardDefinition) =>
      buildGame({ playerA: { faction: me }, cards: [{ key: "card", def: covert, owner: P1, zone: "play" }] });
    const plain = build(PLAIN());
    const omni = build(OMNI());
    assert.equal(plain.engine.hasKeyword(plain.id("card"), "covert"), false);
    assert.equal(omni.engine.hasKeyword(omni.id("card"), "covert"), true);
  });
});

describe("meetsThreshold: a triggered threshold paragraph", () => {
  const arrives = character({
    name: "Arrives",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "arrive",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, meets("rr")] },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });

  const drawsOnEntering = (me: CardDefinition, icons: ReturnType<typeof bank>): number => {
    const { engine, id } = buildGame({
      playerA: { faction: me },
      cards: [
        { key: "card", def: arrives, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...icons
      ]
    });
    const before = engine.state.players[P1].hand.length;
    play(engine, P1, id("card"));
    assert.equal(engine.state.cards[id("card")].zone, "play");
    return engine.state.players[P1].hand.length - (before - 1);
  };

  test("fires only when the threshold is met", () => {
    assert.equal(drawsOnEntering(PLAIN(), bank("rage", 1)), 0);
    assert.equal(drawsOnEntering(PLAIN(), bank("rage", 2)), 1);
  });

  test("fires for an OMNIPOTENCE controller with no icons", () => {
    assert.equal(drawsOnEntering(OMNI(), []), 1);
  });
});

describe("counting icons is NOT affected by OMNIPOTENCE", () => {
  test("\"gains 1 strength for each [R] you control\" counts real icons only", () => {
    const perIcon = character({
      name: "PerIcon",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "per",
            type: "continuous",
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: rageIcons }]
          }
        ]
      }
    });
    const strengthWith = (me: CardDefinition, icons: ReturnType<typeof bank>) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [{ key: "card", def: perIcon, owner: P1, zone: "play" }, ...icons]
      });
      return engine.getStat(id("card"), "strength");
    };
    assert.equal(strengthWith(OMNI(), []), 1, "OMNIPOTENCE with no icons counts zero");
    assert.equal(strengthWith(OMNI(), bank("rage", 2)), 3, "OMNIPOTENCE with two icons counts two");
    assert.equal(strengthWith(PLAIN(), bank("rage", 2)), 3);
  });

  test("an inline \"if you control at least [R][R]\" comparison stays on real icons", () => {
    const inline = paragraph({ type: "numberCompare", left: rageIcons, operator: ">=", right: 2 });
    assert.equal(lifeWith(inline, { me: OMNI() }), 3, "no real [R] icons: off even with OMNIPOTENCE");
    assert.equal(lifeWith(inline, { me: OMNI(), cards: bank("rage", 2) }), 6);
    assert.equal(lifeWith(inline, { cards: bank("rage", 2) }), 6);
  });

  test("on one OMNIPOTENCE board the paragraph is on and the counting gate is off", () => {
    const { engine, id } = buildGame({
      playerA: { faction: OMNI() },
      cards: [
        { key: "para", def: paragraph(meets("rr")), owner: P1, zone: "play" },
        { key: "count", def: paragraph({ type: "numberCompare", left: rageIcons, operator: ">=", right: 2 }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("para"), "life"), 6);
    assert.equal(engine.getStat(id("count"), "life"), 3);
  });
});

describe("meetsThreshold: evaluateCondition", () => {
  test("an empty threshold is always met", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }] });
    assert.equal(engine.evaluateCondition(meets(""), { sourceId: id("c"), controllerId: P1, selected: {} }), true);
  });
});

describe("the other threshold gates honor OMNIPOTENCE", () => {
  test("an activated ability's own `threshold` (RECUR / EXHUMATION style)", () => {
    const gated = character({
      name: "Gated",
      behavior: {
        abilities: [
          { id: "go", type: "activated", threshold: "ooo", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }
        ]
      }
    });
    const drawn = (me: CardDefinition) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "card", def: gated, owner: P1, zone: "play" },
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
        ]
      });
      const before = engine.state.players[P1].hand.length;
      try {
        engine.perform({ type: "activateAbility", playerId: P1, cardId: id("card"), abilityId: "go", selected: {}, variables: {} });
        resolvePendingResponses(engine);
      } catch {
        return 0;
      }
      return engine.state.players[P1].hand.length - before;
    };
    assert.equal(drawn(PLAIN()), 0);
    assert.equal(drawn(OMNI()), 1);
  });

  test("a card's FLIP UP threshold", () => {
    const flippable = character({ name: "Flippable", flipUp: { cost: 1, threshold: "eee" } });
    const flipped = (me: CardDefinition) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "card", def: flippable, owner: P1, faceDown: true },
          ...bank("rage", 2)
        ]
      });
      try {
        engine.perform({ type: "flipUp", playerId: P1, cardId: id("card"), selected: {} });
        resolvePendingResponses(engine);
      } catch {
        return false;
      }
      return engine.state.cards[id("card")].faceDown === false;
    };
    assert.equal(flipped(PLAIN()), false);
    assert.equal(flipped(OMNI()), true);
  });
});

// ---------------------------------------------------------------------------
// Real cards
// ---------------------------------------------------------------------------

describe("OMNIPOTENCE with real catalog cards", () => {
  const EVIL_ALLIANCE = () => cardDef("Seed 3", "The Evil Alliance");

  test("The Evil Alliance carries the OMNIPOTENCE flag", () => {
    assert.equal(EVIL_ALLIANCE().faction?.meetsAllThresholds, true);
  });

  test("Fervent Beastslayer ([R]x5: +3 life) is on for The Evil Alliance with no resources", () => {
    const def = cardDef("Seed", "Fervent Beastslayer");
    const lifeFor = (me: CardDefinition) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [{ key: "card", def, owner: P1, zone: "play" }]
      });
      return engine.getStat(id("card"), "life");
    };
    assert.equal(lifeFor(PLAIN()), def.life);
    assert.equal(lifeFor(EVIL_ALLIANCE()), (def.life ?? 0) + 3);
  });

  test("Thabbashite Priest of Zig ([O][O][V][V]: COVERT) needs both icons, or OMNIPOTENCE", () => {
    const def = cardDef("Ungodly Mess", "Thabbashite Priest of Zig");
    const covert = (me: CardDefinition, extra: CardPlacement[] = []) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [{ key: "card", def, owner: P1, zone: "play" }, ...extra]
      });
      return engine.hasKeyword(id("card"), "covert");
    };
    assert.equal(covert(PLAIN()), false);
    assert.equal(covert(PLAIN(), [...bank("obsession", 2), ...volition(1)]), false);
    assert.equal(covert(PLAIN(), [...bank("obsession", 2), ...volition(2)]), true);
    assert.equal(covert(EVIL_ALLIANCE()), true);
  });

  test("Zenobia's Succor: the [R] mode is playable with no [R] only under OMNIPOTENCE", () => {
    const def = cardDef("Ungodly Mess", "Zenobia's Succor");
    const target = character({ name: "Target", strength: 2 });
    const run = (me: CardDefinition) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "zs", def, owner: P1, zone: "hand" },
          { key: "c", def: target, owner: P1, zone: "play" },
          ...bank("greed", 2)
        ]
      });
      return { engine, id };
    };
    const plain = run(PLAIN());
    assert.throws(
      () => play(plain.engine, P1, plain.id("zs"), { mode: 4, selected: { c: [plain.id("c")] } }),
      /cannot be deployed right now/
    );
    assert.equal(plain.engine.getStat(plain.id("c"), "strength"), 2);

    const omni = run(EVIL_ALLIANCE());
    play(omni.engine, P1, omni.id("zs"), { mode: 4, selected: { c: [omni.id("c")] } });
    assert.equal(omni.engine.getStat(omni.id("c"), "strength"), 4);
  });

  describe("Cicibeo, The Implicator ([D][D][D][D]: a triggered paragraph)", () => {
    const def = cardDef("Ungodly Mess", "Cicibeo, The Implicator");
    const sibling = () =>
      character({ name: "Cicibeo Kin", subtype: ["cicibeo"], cost: 0 });

    /** True when CONSPIRE destroyed the depleted victim after a "cicibeo" character was deployed from hand. */
    const conspires = (me: CardDefinition, icons: ReturnType<typeof bank>): boolean => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "imp", def, owner: P1, zone: "play" },
          { key: "kin", def: sibling(), owner: P1, zone: "hand" },
          { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play", depleted: true },
          ...icons
        ]
      });
      play(engine, P1, id("kin"));
      let guard = 0;
      while (engine.state.pendingChoice && guard++ < 10) {
        const pc = engine.state.pendingChoice as { kind: string; playerId: string };
        engine.perform({
          type: "resolvePendingChoice",
          playerId: pc.playerId,
          choice:
            pc.kind === "chooserSelectsTarget"
              ? { kind: "chooserSelectsTarget", selected: [id("victim")] }
              : { kind: pc.kind }
        } as never);
        resolvePendingResponses(engine);
      }
      return engine.state.cards[id("victim")].zone === "discard";
    };

    test("does nothing without the icons", () => {
      assert.equal(conspires(PLAIN(), bank("deception", 3)), false);
    });

    test("fires with [D]x4", () => {
      assert.equal(conspires(PLAIN(), bank("deception", 4)), true);
    });

    test("fires for The Evil Alliance with no icons", () => {
      assert.equal(conspires(cardDef("Seed 3", "The Evil Alliance"), []), true);
    });
  });

  test("Boorish Boar ([R][R]: +1/-1, [R][R][R]: Destroy this card) follows the controller's meets-all-thresholds", () => {
    const def = cardDef("Holy Heist", "Boorish Boar");
    const deploy = (me: CardDefinition, icons: ReturnType<typeof bank>) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "boar", def, owner: P1, zone: "hand" },
          ...icons,
          ...bank("greed", 3)
        ]
      });
      play(engine, P1, id("boar"));
      return { engine, id };
    };

    const plain = deploy(PLAIN(), bank("rage", 2));
    assert.equal(plain.engine.state.cards[plain.id("boar")].zone, "play", "[R][R] only: not destroyed");
    assert.equal(plain.engine.getStat(plain.id("boar"), "strength"), (def.strength ?? 0) + 1);

    const omni = deploy(cardDef("Seed 3", "The Evil Alliance"), []);
    assert.equal(omni.engine.state.cards[omni.id("boar")].zone, "discard", "meets [R][R][R] automatically: destroyed on entering");
  });

  test("Pit Boss (+1 speed for each [D] you control) counts real icons under OMNIPOTENCE", () => {
    const def = cardDef("Seed", "Pit Boss");
    const speedFor = (me: CardDefinition, icons: ReturnType<typeof bank>) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [{ key: "card", def, owner: P1, zone: "play" }, ...icons]
      });
      return engine.getStat(id("card"), "speed");
    };
    const base = def.speed ?? 0;
    assert.equal(speedFor(cardDef("Seed 3", "The Evil Alliance"), []), base);
    assert.equal(speedFor(cardDef("Seed 3", "The Evil Alliance"), bank("deception", 2)), base + 2);
  });

  test("Religious Rejection's inline \"if you control [V][V][V], draw\" is still a real-icon count", () => {
    const def = cardDef("Holy Heist", "Religious Rejection");
    const drawnFor = (me: CardDefinition, icons: ReturnType<typeof volition>) => {
      const { engine, id } = buildGame({
        playerA: { faction: me },
        cards: [
          { key: "rr", def, owner: P1, zone: "hand" },
          { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
          ...icons,
          ...bank("greed", 5)
        ]
      });
      const before = engine.state.players[P1].hand.length;
      play(engine, P1, id("rr"), { selected: { c: [id("victim")] } });
      assert.equal(engine.state.cards[id("victim")].zone, "discard");
      return engine.state.players[P1].hand.length - (before - 1);
    };
    const evil = () => cardDef("Seed 3", "The Evil Alliance");
    assert.equal(drawnFor(evil(), []), 0, "OMNIPOTENCE does not conjure [V] for an inline count");
    assert.equal(drawnFor(PLAIN(), volition(3)), 1);
    assert.equal(drawnFor(evil(), volition(3)), 1);
  });
});

// ---------------------------------------------------------------------------
// Catalog guards
// ---------------------------------------------------------------------------

describe("catalog: threshold paragraphs use meetsThreshold", () => {
  const catalog = cardsJson as CardDefinition[];
  const PARAGRAPH = /(?:^|--\s*)((?:\[[ORGEDV]\])+)\s*:/g;
  const sorted = (letters: string) => [...letters].sort().join("");

  const visit = (node: unknown, fn: (n: Record<string, unknown>) => void): void => {
    if (Array.isArray(node)) node.forEach(child => visit(child, fn));
    else if (node && typeof node === "object") {
      fn(node as Record<string, unknown>);
      Object.values(node).forEach(child => visit(child, fn));
    }
  };

  const printedParagraphs = (card: CardDefinition): string[] =>
    [...printedRules(card).replace(/\s+/g, " ").matchAll(PARAGRAPH)].map(m =>
      [...m[1].matchAll(/\[(.)\]/g)].map(x => x[1].toLowerCase()).join("")
    );

  test("every printing's meetsThreshold gates are exactly its printed leading-icon paragraphs", () => {
    const wrong: string[] = [];
    for (const card of catalog) {
      const gates = new Set<string>();
      visit(card.behavior, n => {
        if (n.type === "meetsThreshold") gates.add(sorted(String(n.threshold)));
      });
      const printed = new Set(printedParagraphs(card).map(sorted));
      const want = [...printed].sort().join(",");
      const have = [...gates].sort().join(",");
      if (want !== have) wrong.push(`${card.name} (${card.set}, ${card.id}): printed [${want}] vs gates [${have}]`);
    }
    assert.deepEqual(wrong, []);
  });

  test("every meetsThreshold threshold is a non-empty string of icon letters", () => {
    const bad: string[] = [];
    for (const card of catalog) {
      visit(card.behavior, n => {
        if (n.type === "meetsThreshold" && !/^[rgdeov]+$/.test(String(n.threshold))) {
          bad.push(`${card.name} (${card.id}): ${JSON.stringify(n.threshold)}`);
        }
      });
    }
    assert.deepEqual(bad, []);
  });

  test("a printing with a leading-icon paragraph never gates one on a raw resourceIcons count", () => {
    const bad: string[] = [];
    for (const card of catalog) {
      if (!printedParagraphs(card).length) continue;
      visit(card.behavior, n => {
        if (n.type === "resourceIcons") bad.push(`${card.name} (${card.set}, ${card.id})`);
      });
    }
    assert.deepEqual(bad, []);
  });

  test("an ability-level condition is never a bare `resourceIcons >= N` gate", () => {
    const bad: string[] = [];
    const isGate = (c: unknown): boolean => {
      const n = c as { type?: string; operator?: string; left?: { type?: string }; right?: unknown; conditions?: unknown[] };
      if (!n || typeof n !== "object") return false;
      if (n.type === "numberCompare") return n.left?.type === "resourceIcons" && n.operator === ">=" && typeof n.right === "number";
      return n.type === "and" && !!n.conditions?.some(isGate);
    };
    for (const card of catalog) {
      const holders = [...(card.behavior?.abilities ?? []), ...(card.behavior?.modes ?? [])] as Array<{ condition?: Condition }>;
      if (holders.some(h => isGate(h.condition))) bad.push(`${card.name} (${card.set}, ${card.id})`);
    }
    // Community Chest: "If you control at least [D] and choose to put this card on the
    // bottom of your deck as part of your mulligan" is an inline control check, not a paragraph.
    assert.deepEqual(bad.filter(b => !b.startsWith("Community Chest (")), []);
  });

  test("only activated abilities carry a `threshold` field (the engine ignores it elsewhere)", () => {
    const bad: string[] = [];
    for (const card of catalog) {
      for (const ability of (card.behavior?.abilities ?? []) as Array<{ id: string; type: string; threshold?: unknown }>) {
        if (ability.type !== "activated" && ability.threshold !== undefined) {
          bad.push(`${card.name} (${card.set}, ${card.id}): ${ability.type} ${ability.id}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});
