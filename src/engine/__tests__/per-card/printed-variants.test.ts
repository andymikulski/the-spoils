// Per-printing behavior: every printing plays exactly as printed on its own
// card, so reprints whose printed rules differ get different behavior
// (docs/CARD-DATA.md). The set
// files' reprint-parity checks skip printings whose printed rules differ;
// each such difference is covered here, one describe per card name, with the
// printing named in every test.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  setCards,
  printedRules,
  developFaction,
  bank,
  volition,
  character,
  item,
  location,
  tactic,
  killTactic,
  play,
  activate,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2,
  resourceCard, developDrawChoice } from "./_harness.js";

function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 40
): void {
  let n = 0;
  // End-of-turn triggers fire when the turn actually ends (CR 610.1a): close the response window first.
  if (!engine.state.pendingChoice && engine.state.responseWindow?.kind === "endTurn") resolvePendingResponses(engine);
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: developDrawChoice(pc) ?? answerFor(pc) } as never);
    resolvePendingResponses(engine);
  }
}

const declineAll = (pc: { kind: string; [k: string]: unknown }) => {
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: false };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: [] };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    default:
      return { kind: pc.kind, accept: false };
  }
};

describe("Blow Up — 1st Edition Part 2 / 2nd Edition print \"Your opponent's faction loses 3 influence\"", () => {
  for (const set of ["1st Edition Part 2", "2nd Edition"]) {
    test(`${set}: destroying your own item still costs your opponent 3 influence`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "bu", def: cardDef(set, "Blow Up"), owner: P1, zone: "hand" },
          { key: "mine", def: item({ name: "Mine" }), owner: P1, zone: "play" },
          ...bank("rage", 6, P1)
        ]
      });
      const mineBefore = engine.state.players[P1].influence;
      const theirsBefore = engine.state.players[P2].influence;
      play(engine, P1, id("bu"), { selected: { it: [id("mine")] } });
      assert.equal(engine.state.cards[id("mine")].zone, "discard");
      assert.equal(engine.state.players[P1].influence, mineBefore);
      assert.equal(engine.state.players[P2].influence, theirsBefore - 3);
    });
  }
});

describe("Caboodling Gladhander — Seed prints \"your opponent's faction\", Seed Saga prints \"that character's controller's faction\"", () => {
  const run = (set: string) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cg", def: cardDef(set, "Caboodling Gladhander"), owner: P1, zone: "hand" },
        { key: "own", def: character({ name: "Own", strength: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 10, P1)
      ]
    });
    const before = { mine: engine.state.players[P1].influence, theirs: engine.state.players[P2].influence };
    play(engine, P1, id("cg"), { selected: { c: [id("own")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("own")].zone, "discard");
    return { engine, before };
  };

  test("Seed: picking your own character gives your opponent the influence", () => {
    const { engine, before } = run("Seed");
    assert.equal(engine.state.players[P1].influence, before.mine);
    assert.equal(engine.state.players[P2].influence, before.theirs + 3);
  });

  test("Seed Saga: picking your own character gives you the influence", () => {
    const { engine, before } = run("Seed Saga");
    assert.equal(engine.state.players[P1].influence, before.mine + 3);
    assert.equal(engine.state.players[P2].influence, before.theirs);
  });
});

describe("Irresistible Bribe — every printing prints \"Your opponent's faction gains X influence\"", () => {
  for (const set of ["Open Beta", "1st Edition", "2nd Edition"]) {
    test(`${set}: bribing away your own character still pays your opponent`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "ib", def: cardDef(set, "Irresistible Bribe"), owner: P1, zone: "hand" },
          { key: "own", def: character({ name: "Own", strength: 2 }), owner: P1, zone: "play" },
          ...bank("greed", 6, P1)
        ]
      });
      const mineBefore = engine.state.players[P1].influence;
      const theirsBefore = engine.state.players[P2].influence;
      play(engine, P1, id("ib"), { selected: { c: [id("own")] } });
      assert.equal(engine.state.cards[id("own")].zone, "discard");
      assert.equal(engine.state.players[P1].influence, mineBefore);
      assert.equal(engine.state.players[P2].influence, theirsBefore + 2);
    });
  }
});

describe("Ritual of the Knob & Pull — 1st Edition Part 2 / 2nd Edition check \"your opponent\"'s face-down resources", () => {
  for (const set of ["1st Edition Part 2", "2nd Edition"]) {
    test(`${set}: your own character is destroyed when your opponent has enough face-down resources`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "rkp", def: cardDef(set, "Ritual of the Knob & Pull"), owner: P1, zone: "hand" },
          { key: "own", def: character({ name: "Own", strength: 2 }), owner: P1, zone: "play" },
          ...volition(3, P2),
          ...bank("obsession", 6, P1)
        ]
      });
      play(engine, P1, id("rkp"), { selected: { c: [id("own")] } });
      assert.equal(engine.state.cards[id("own")].zone, "discard");
    });
  }
});

describe("Redonkulous — Seed 2 prints \"your opponent\", Seed Saga prints \"that character's controller\"", () => {
  const run = (set: string) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: cardDef(set, "Redonkulous"), owner: P1, zone: "hand" },
        { key: "own", def: character({ name: "Own" }), owner: P1, zone: "play" },
        // P2 holds 4 cards (more than 3); P1's hand is otherwise empty.
        ...["a", "b", "c", "d"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "hand" as const })),
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { char: [id("own")] } });
    drain(engine, declineAll);
    return engine.state.cards[id("own")].zone;
  };

  test("Seed 2: your own character stays, because your opponent has more than 3 cards", () => {
    assert.equal(run("Seed 2"), "play");
  });

  test("Seed Saga: your own character is removed, because its controller (you) has 3 or fewer cards", () => {
    assert.equal(run("Seed Saga"), "removed");
  });
});

describe("Splattergun — 1st Edition Part 2 / 2nd Edition print \"Your opponent takes control of this card\"", () => {
  for (const set of ["1st Edition Part 2", "2nd Edition"]) {
    test(`${set}: UNLOAD on your own character still hands the gun to your opponent`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "sg", def: cardDef(set, "Splattergun"), owner: P1, zone: "play" },
          { key: "own", def: character({ name: "Own", life: 5 }), owner: P1, zone: "play" }
        ]
      });
      activate(engine, P1, id("sg"), "unload", { selected: { tgt: [id("own")] } });
      assert.equal(engine.state.cards[id("own")].damage, 3);
      assert.equal(engine.state.cards[id("sg")].controllerId, P2);
    });
  }
});

describe("Needless Beating — 1st Edition Part 2 / 2nd Edition print \"COST: Pick a character\" (any character)", () => {
  for (const set of ["1st Edition Part 2", "2nd Edition"]) {
    test(`${set}: your own character is a legal pick`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "nb", def: cardDef(set, "Needless Beating"), owner: P1, zone: "hand" },
          { key: "own", def: character({ name: "Own", life: 5 }), owner: P1, zone: "play" },
          ...bank("rage", 6, P1)
        ]
      });
      play(engine, P1, id("nb"), { selected: { c: [id("own")] } });
      assert.equal(engine.state.cards[id("own")].damage, 2);
    });
  }
});

describe("Mass Confusion — Seed prints \"Pick X characters\" (any characters)", () => {
  test("Seed: your own characters are legal picks; Y is still your opponent's count minus yours", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: cardDef("Seed", "Mass Confusion"), owner: P1, zone: "hand" },
        { key: "own", def: character({ name: "Own", life: 5 }), owner: P1, zone: "play" },
        ...["o1", "o2", "o3"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "play" as const })),
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("mc"), { variables: { x: 1 }, selected: { cs: [id("own")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("own")]: (pc.amount as number) ?? 0 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("own")].damage, 2); // 3 opposing characters - 1 own
  });
});

describe("Smothering Corpulence — Seed 2 prints \"Pick a character\" (any character)", () => {
  test("Seed 2: your own character is a legal pick", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: cardDef("Seed 2", "Smothering Corpulence"), owner: P1, zone: "hand" },
        { key: "own", def: character({ name: "Own", life: 5 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.doesNotThrow(() => play(engine, P1, id("sc"), { selected: { c: [id("own")] } }));
    assert.notEqual(engine.state.cards[id("sc")].zone, "hand");
  });
});

describe("Surprise! — the pick is an attacking character your opponent controls, never a location", () => {
  for (const set of ["Seed", "Seed Saga"]) {
    test(`${set}: a location you control is not a legal pick`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        cards: [
          { key: "sp", def: cardDef(set, "Surprise!"), owner: P1, zone: "hand" },
          { key: "loc", def: location({ name: "Loc", cost: 5 }), owner: P1, zone: "play" },
          { key: "atk", def: character({ name: "Atk", cost: 3, strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
          ...bank("deception", 6, P1)
        ],
        turn: 2,
        activePlayerId: P2
      });
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
      resolvePendingResponses(engine);
      engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
      while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
        engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
      }
      assert.throws(() =>
        engine.perform({ type: "playCard", playerId: P1, cardId: id("sp"), selected: { k: [id("loc")] } } as never)
      );
    });
  }
});

describe("Brainbath — every printing's \"Put a card ...\" and \"An opponent discards a card\" are mandatory", () => {
  test("Ungodly Mess shares the Seed Saga behavior", () => {
    assert.deepEqual(cardDef("Ungodly Mess", "Brainbath").behavior, cardDef("Seed Saga", "Brainbath").behavior);
  });
});

// ---------------------------------------------------------------------------
// G2 — printings with no "this turn": the effect outlasts the turn
// ---------------------------------------------------------------------------

const endTurn = (engine: ReturnType<typeof buildGame>["engine"], playerId: typeof P1) => {
  engine.perform({ type: "endTurn", playerId });
  resolvePendingResponses(engine);
  drain(engine, declineAll);
};

describe("A Series of Tubes — 1st Edition REDIRECT has no \"This turn\"; 2nd Edition has it", () => {
  const run = (set: string) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "tubes", def: cardDef(set, "A Series of Tubes"), owner: P1, zone: "play" },
        { key: "node", def: character({ name: "Node", subtype: ["node"], life: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("tubes"), "redirect", { selected: { c: [id("node")] } });
    drain(engine, declineAll);
    endTurn(engine, P1);
    return engine.state.damageShields.filter(shield => shield.targetId === id("node")).length;
  };

  test("1st Edition: the redirect shield is still waiting on the next turn", () => {
    assert.equal(run("1st Edition"), 1);
  });

  test("2nd Edition: the redirect shield lapses with the turn", () => {
    assert.equal(run("2nd Edition"), 0);
  });
});

describe("Clockman Skydocks — Shade prints no \"This turn\": the reduction waits for the next card you play", () => {
  test("Shade of the Devoured Emperor: BUSINESS DAY's reduction survives into the next turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "cs", def: cardDef("Shade of the Devoured Emperor", "Clockman Skydocks"), owner: P1, zone: "play" },
        ...volition(2, P1),
        ...bank("rage", 4, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cs"), abilityId: "cs-bday", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "nameValue" ? { kind: "nameValue", value: "rage" } : declineAll(pc)));
    endTurn(engine, P1);
    assert.deepEqual(
      engine.state.thresholdReductions.map(r => [r.playerId, r.icon, r.amount]),
      [[P1, "rage", 1]]
    );
  });
});

describe("Befuddling Beggar — Open Beta PANHANDLE has no \"This turn\"; later printings do", () => {
  const run = (set: string) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "bb", def: cardDef(set, "Befuddling Beggar"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("bb"), "panhandle", { selected: { c: [id("c")] } });
    drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)));
    endTurn(engine, P1);
    return engine.getStat(id("c"), "speed");
  };

  test("Open Beta: the +1 speed is still there next turn", () => {
    assert.equal(run("Open Beta"), 4);
  });

  test("1st Edition: the +1 speed lapses with the turn", () => {
    assert.equal(run("1st Edition"), 3);
  });
});

describe("Strength In Numbers / Fleshripping Scenepuller — printings without \"This turn\" grant lasting strength", () => {
  const durations = (set: string, name: string) => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (record.type === "createModifier") found.push((record.duration as { type: string }).type);
        Object.values(record).forEach(walk);
      }
    };
    walk(cardDef(set, name).behavior);
    return [...new Set(found)];
  };

  test("Strength In Numbers: Open Beta is permanent, 1st Edition is this turn", () => {
    assert.deepEqual(durations("Open Beta", "Strength In Numbers"), ["permanent"]);
    assert.deepEqual(durations("1st Edition", "Strength In Numbers"), ["untilEndOfTurn"]);
  });

  test("Fleshripping Scenepuller: 1st Edition Part 2 is permanent, 2nd Edition is this turn", () => {
    assert.deepEqual(durations("1st Edition Part 2", "Fleshripping Scenepuller"), ["permanent"]);
    assert.deepEqual(durations("2nd Edition", "Fleshripping Scenepuller"), ["untilEndOfTurn"]);
  });
});

// ---------------------------------------------------------------------------
// G3 — "only member of an attacking party" conditions
// ---------------------------------------------------------------------------

const attack = (engine: ReturnType<typeof buildGame>["engine"], attackerIds: string[], target: object) => {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds, target } as never);
  resolvePendingResponses(engine);
};

describe("Face in the Crowd — 1st Edition needs it to attack alone; 2nd Edition doesn't", () => {
  const unblockableWithPartner = (set: string) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fc", def: cardDef(set, "Face in the Crowd"), owner: P1, zone: "play" },
        { key: "pal", def: character({ name: "Pal" }), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "play" as const }))
      ],
      turn: 2
    });
    attack(engine, [id("fc"), id("pal")], { type: "faction", playerId: P2 });
    return engine.getKeywords(id("fc")).includes("cannotBeBlocked");
  };

  test("1st Edition: attacking with a partner, it can be blocked", () => {
    assert.equal(unblockableWithPartner("1st Edition"), false);
  });

  test("2nd Edition: attacking with a partner, it still cannot be blocked", () => {
    assert.equal(unblockableWithPartner("2nd Edition"), true);
  });
});

describe("Thundering Nilpha — 1st Edition Part 2 needs it to attack the location alone; 2nd Edition doesn't", () => {
  const run = (set: string) => {
    const d = cardDef(set, "Thundering Nilpha");
    const { engine, id } = buildGame({
      cards: [
        { key: "tn", def: d, owner: P1, zone: "play" },
        { key: "pal", def: character({ name: "Pal" }), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 10 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    attack(engine, [id("tn"), id("pal")], { type: "card", cardId: id("loc") });
    return { bonus: engine.getStat(id("tn"), "strength") - (d.strength ?? 0), unblockable: engine.getKeywords(id("tn")).includes("cannotBeBlocked") };
  };

  test("1st Edition Part 2: with a partner, no bonus and blockable", () => {
    assert.deepEqual(run("1st Edition Part 2"), { bonus: 0, unblockable: false });
  });

  test("2nd Edition: with a partner, +1 strength and unblockable", () => {
    assert.deepEqual(run("2nd Edition"), { bonus: 1, unblockable: true });
  });
});

describe("Schproingmajig — 1st Edition Part 2 SCHPROING! only works while it attacks alone", () => {
  const run = (withPartner: boolean) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sm", def: cardDef("1st Edition Part 2", "Schproingmajig"), owner: P1, zone: "play" },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "play" },
        { key: "pal", def: character({ name: "Pal" }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    activate(engine, P1, id("sm"), "schproing", { selected: { s: [id("fodder")] } });
    drain(engine, declineAll);
    attack(engine, withPartner ? [id("sm"), id("pal")] : [id("sm")], { type: "faction", playerId: P2 });
    return engine.getKeywords(id("sm")).includes("cannotBeBlocked");
  };

  test("attacking alone: cannot be blocked", () => {
    assert.equal(run(false), true);
  });

  test("attacking with a partner: can be blocked", () => {
    assert.equal(run(true), false);
  });
});

describe("Clockman Pickpocket / Cute Cutpurse — the item pick on faction damage is mandatory when possible", () => {
  for (const [set, name] of [
    ["1st Edition Part 2", "Clockman Pickpocket"],
    ["2nd Edition", "Clockman Pickpocket"],
    ["1st Edition Part 2", "Cute Cutpurse"],
    ["2nd Edition", "Cute Cutpurse"]
  ]) {
    test(`${name} (${set}): the pick cannot be declined`, () => {
      const json = JSON.stringify(cardDef(set, name).behavior);
      assert.ok(json.includes('"optional":false') && !json.includes('"optional":true'), "json.includes('\"optional\":false') && !json.includes('\"optional\":true')");
    });
  }
});

// ---------------------------------------------------------------------------
// G4 — Micromajig tokens are "majig" in every printing (rules answer Q48, 2026-10-20: the rules win over old reminder text)
// ---------------------------------------------------------------------------

describe("Micromajig tokens — Open Beta / 1st Edition / 1st Edition Part 2 tokens are \"majig\" like every later printing (rules answer Q48)", () => {
  const tokenSubtypes = (set: string, name: string) => {
    const found: string[][] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (record.type === "createTokens") found.push(((record.token as { subtype?: string[] }).subtype) ?? []);
        Object.values(record).forEach(walk);
      }
    };
    walk(cardDef(set, name).behavior);
    return found;
  };

  for (const name of ["Micromajig Avalanche", "Micromajig Factory", "Micromajig Maker", "Micromajig Master"]) {
    test(`${name}: Open Beta, 1st Edition and 2nd Edition tokens are all "majig"`, () => {
      for (const set of ["Open Beta", "1st Edition"]) assert.ok(tokenSubtypes(set, name).every(subtypes => subtypes.includes("majig")), set);
      if (name !== "Micromajig Factory") assert.ok(tokenSubtypes("2nd Edition", name).every(subtypes => subtypes.includes("majig")), "tokenSubtypes(\"2nd Edition\", name).every(subtypes => subtypes.includes(\"majig\"))");
    });
  }

  test("Micromajig Shipping Container (1st Edition Part 2): tokens are \"majig\"", () => {
    assert.ok(tokenSubtypes("1st Edition Part 2", "Micromajig Shipping Container").every(subtypes => subtypes.includes("majig")), "1st Edition Part 2 token has the majig subtype");
  });

  test("Micromajig Avalanche (1st Edition): a created token is a \"majig\" in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ma", def: cardDef("1st Edition", "Micromajig Avalanche"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]
    });
    play(engine, P1, id("ma"), { variables: { x: 1 } });
    drain(engine, declineAll);
    const tokens = Object.values(engine.state.cards).filter(card => card.isToken && card.zone === "play");
    assert.equal(tokens.length, 1);
    assert.deepEqual(engine.getDefinition(tokens[0].id).subtype, ["majig"]);
  });
});

// ---------------------------------------------------------------------------
// G6 — catalog text was another version of the card
// ---------------------------------------------------------------------------

describe("Redonkulous (Seed Saga) — FLIP UP: the picked character's controller discards 2", () => {
  test("picking your own character makes you discard 2 from your own hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: cardDef("Seed Saga", "Redonkulous"), owner: P1, faceDown: true },
        { key: "own", def: character({ name: "Own" }), owner: P1, zone: "play" },
        ...["h1", "h2", "h3"].map(k => ({ key: k, def: character({ name: k }), owner: P1, zone: "hand" as const })),
        ...["o1", "o2", "o3", "o4"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "hand" as const })),
        ...bank("obsession", 7, P1)
      ]
    });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("r"), selected: { char: [id("own")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("h1"), id("h2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
    assert.equal(engine.state.cards[id("h2")].zone, "discard");
    assert.equal(engine.state.players[P2].hand.length, 4);
    assert.equal(engine.state.cards[id("own")].zone, "removed"); // you now have 1 card in hand
  });
});

describe("Wasted Wickedness (Ungodly Mess) — pick a player; X = their staple types; FLIP UP 1 [O]", () => {
  const board = () =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ww", def: cardDef("Ungodly Mess", "Wasted Wickedness"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        ...["c1", "c2", "c3"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "play" as const })),
        ...bank("rage", 1, P2),
        ...bank("greed", 1, P2),
        ...bank("obsession", 6, P1)
      ]
    });

  test("picking your opponent: they return X = 2 of their non-resource cards (mandatory)", () => {
    const { engine, id } = board();
    play(engine, P1, id("ww"), { mode: 0 });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c1"), id("c2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c1")].zone, "hand");
    assert.equal(engine.state.cards[id("c2")].zone, "hand");
    assert.equal(engine.state.cards[id("c3")].zone, "play");
  });

  test("picking yourself: X counts your own staple types", () => {
    const { engine, id } = board();
    play(engine, P1, id("ww"), { mode: 1 });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("mine")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
  });

  test("has its printed FLIP UP – 1 [O]", () => {
    assert.deepEqual(cardDef("Ungodly Mess", "Wasted Wickedness").flipUp, { cost: 1, threshold: "o" });
  });
});

describe("Voidal Tactician (Ungodly Mess) — \"When this card is depleted, you may deploy a tactic in the void\"", () => {
  test("depleting it offers one tactic from your void; there is no ongoing void-play permission", () => {
    const def = cardDef("Ungodly Mess", "Voidal Tactician");
    assert.ok(!def.behavior!.abilities!.some(ability => ability.type === "continuous"), "!def.behavior!.abilities!.some(ability => ability.type === \"continuous\")");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "vt", def, owner: P1, zone: "play" },
        { key: "vtac", def: tactic({ name: "Void Tactic", cost: 0 }), owner: P1, zone: "void" },
        ...bank("obsession", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("vt")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("vt")].depleted, true);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("vtac")] }
        : pc.kind === "deployForFree"
          ? { kind: "deployForFree", cardId: id("vtac") }
          : declineAll(pc)
    );
    assert.notEqual(engine.state.cards[id("vtac")].zone, "void");
  });
});

describe("Corrosive Waste Dispenser (Ungodly Mess) — CONVERT costs Pay 1 and a picked non-\"micromajig\"; only opponents destroy", () => {
  test("CONVERT: pay 1, remove a token, destroy your picked character; your opponent destroys one of theirs; nothing else of yours", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cwd", def: cardDef("Ungodly Mess", "Corrosive Waste Dispenser"), owner: P1, zone: "play", counters: { token: 4 } },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        ...bank("elitism", 1, P1)
      ]
    });
    activate(engine, P1, id("cwd"), "convert", { selected: { sac: [id("sac")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("theirs")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("cwd")].counters?.token, 3);
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("theirs")].zone, "discard");
    assert.equal(engine.state.cards[id("keep")].zone, "play");
  });

  test("CONVERT can't be used without a resource to pay 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cwd", def: cardDef("Ungodly Mess", "Corrosive Waste Dispenser"), owner: P1, zone: "play", counters: { token: 4 } },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }
      ]
    });
    assert.throws(() => activate(engine, P1, id("cwd"), "convert", { selected: { sac: [id("sac")] } }));
  });
});

describe("Feckless Chronicler (Ungodly Mess) — has its printed FLIP UP – 2 [D]", () => {
  test("a face-down Feckless Chronicler can be flipped up for 2 with [D]", () => {
    const def = cardDef("Ungodly Mess", "Feckless Chronicler");
    assert.deepEqual(def.flipUp, { cost: 2, threshold: "d" });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fc", def, owner: P1, faceDown: true }, ...bank("deception", 3, P1)]
    });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fc"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("fc")].faceDown, false);
    assert.equal(engine.state.cards[id("fc")].zone, "play");
  });
});

describe("Efficacious Gunslinger (Ungodly Mess) — \"When this card inflicts damage to a character\" (any damage)", () => {
  test("the trigger has no battle-only condition", () => {
    const json = JSON.stringify(cardDef("Ungodly Mess", "Efficacious Gunslinger").behavior);
    assert.ok(json.includes('"event":"damageDealt"') && !json.includes("battleActive"), "json.includes('\"event\":\"damageDealt\"') && !json.includes(\"battleActive\")");
  });
});

describe("Gosche's Restoration Fortress (Ungodly Mess) — \"less strength than that character had\" (last-known strength)", () => {
  test("a token character's buffed strength counts after it has left play", () => {
    const grower = character({
      name: "Grower",
      strength: 1,
      behavior: {
        abilities: [
          { id: "g", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } }] }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gr", def: cardDef("Ungodly Mess", "Gosche's Restoration Fortress"), owner: P1, zone: "play" },
        { key: "tok", def: grower, owner: P1, zone: "play", counters: { token: 1 } },
        { key: "low", def: character({ name: "Low", strength: 1 }), owner: P1, zone: "play", depleted: true },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("tok"), "strength"), 2);
    play(engine, P1, id("kill"), { selected: { t: [id("tok")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("low")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("low")].depleted, false); // 1 < 2 (what it had), so it was a legal pick and got restored
  });
});

describe("Cicibeo, The Implicator (Ungodly Mess) — IMPLY takes control only if the revealed card is a character", () => {
  const run = (topIsCharacter: boolean) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cic", def: cardDef("Ungodly Mess", "Cicibeo, The Implicator"), owner: P1, zone: "play" },
        { key: "mark", def: character({ name: "Mark" }), owner: P2, zone: "play" },
        { key: "top", def: topIsCharacter ? character({ name: "Top" }) : tactic({ name: "Top" }), owner: P2, zone: "deck" }
      ]
    });
    activate(engine, P1, id("cic"), "imply", { selected: { c: [id("mark")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    return engine.state.cards[id("mark")].controllerId;
  };

  test("revealing a character: you take control of the picked character this turn", () => {
    assert.equal(run(true), P1);
  });

  test("revealing a non-character: no control change", () => {
    assert.equal(run(false), P2);
  });
});

describe("Elitist Upgrade (Holy Heist) — FLIP IT: Pay 5, any time; all Micromajigs gain 1/1", () => {
  test("flipping pays 5 and pumps every Micromajig (yours and your opponent's) but not other majigs", () => {
    const micro = character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1 });
    const otherMajig = character({ name: "Other Majig", subtype: ["majig"], strength: 1, life: 1 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eu", def: cardDef("Holy Heist", "Elitist Upgrade"), owner: P1, faceDown: true },
        { key: "mine", def: micro, owner: P1, zone: "play" },
        { key: "theirs", def: micro, owner: P2, zone: "play" },
        { key: "other", def: otherMajig, owner: P1, zone: "play" },
        ...bank("elitism", 5, P1)
      ]
    });
    activate(engine, P1, id("eu"), "flip-it");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("eu")].faceDown, false);
    assert.equal(engine.getStat(id("mine"), "strength"), 2);
    assert.equal(engine.getStat(id("theirs"), "strength"), 2);
    assert.equal(engine.getStat(id("other"), "strength"), 1);
  });

  test("it costs 5, not 4", () => {
    const json = JSON.stringify(cardDef("Holy Heist", "Elitist Upgrade").behavior);
    assert.ok(json.includes('{"type":"payResources","amount":5}') && !json.includes("battleActive"), "json.includes('{\"type\":\"payResources\",\"amount\":5}') && !json.includes(\"battleActive\")");
  });
});

describe("Mistaken Identity — both printings answer a card OR ability that picked a character as a cost", () => {
  const run = (set: string) => {
    const zapper = character({
      name: "Zapper",
      behavior: {
        abilities: [
          { id: "zap", name: "Zap", type: "activated", targets: [{ id: "v", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "v" } }] }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "zapper", def: zapper, owner: P2, zone: "play" },
        { key: "mi", def: cardDef(set, "Mistaken Identity"), owner: P1, zone: "hand" },
        { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
        { key: "chump", def: character({ name: "Chump", life: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("zapper"), abilityId: "zap", selected: { v: [id("ally")] }, variables: {} } as never);
    let played = true;
    try {
      engine.perform({ type: "playCard", playerId: P1, cardId: id("mi"), selected: { other: [id("chump")] } } as never);
    } catch {
      played = false;
    }
    resolvePendingResponses(engine);
    return { played, ally: engine.state.cards[id("ally")].zone, chump: engine.state.cards[id("chump")].zone };
  };

  test("Seed Saga: redirects the ability's pick to the other character", () => {
    assert.deepEqual(run("Seed Saga"), { played: true, ally: "play", chump: "discard" });
  });

  // The Seed 2 printing's markup also says "in response to a card or ability" (an earlier version of this test asserted it could not answer an ability).
  test("Seed 2: redirects the ability's pick to the other character", () => {
    assert.deepEqual(run("Seed 2"), { played: true, ally: "play", chump: "discard" });
  });
});

// ---------------------------------------------------------------------------
// G7 — one-off differences
// ---------------------------------------------------------------------------

describe("4p7 31f — 1st Edition Part 2 triggers whenever a gear becomes attached; 2nd Edition only when you play one attached", () => {
  const run = (set: string) => {
    const gear = item({
      name: "Gear Mover",
      subtype: ["gear"],
      behavior: {
        abilities: [
          {
            id: "move",
            name: "Move",
            type: "activated",
            targets: [{ id: "to", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "to" } }]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "apt", def: cardDef(set, "4p7 31f"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
        { key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "other" }
      ]
    });
    activate(engine, P1, id("gear"), "move", { selected: { to: [id("apt")] } });
    return engine.state.pendingChoice?.kind ?? null;
  };

  test("1st Edition Part 2: moving a gear onto it offers the detach", () => {
    assert.equal(run("1st Edition Part 2"), "chooserSelectsOption");
  });

  test("2nd Edition: moving a gear onto it does nothing", () => {
    assert.equal(run("2nd Edition"), null);
  });
});

// ---------------------------------------------------------------------------
// "Your hand" / "your deck" — the controller's, not the owner's
// ---------------------------------------------------------------------------

describe("\"your hand\" / \"your deck\" — printings that say it send a card you control but don't own to YOU; \"its owner's\" printings send it to the owner", () => {
  /** A face-up resource P2 owns that P1 controls (a take-control effect already happened). */
  const borrowed = () => ({
    key: "borrowed",
    def: resourceCard({ name: "Borrowed Resource" }),
    owner: P2,
    controller: P1,
    zone: "play" as const
  });

  const answerChooser = (engine: ReturnType<typeof buildGame>["engine"], selected: string[]) => {
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected, faceDown: false } } as never);
    resolvePendingResponses(engine);
  };

  describe("Maladjustment — 1st Edition Part 2 prints \"into your hand\", 2nd Edition \"into its owner's hand\"", () => {
    const run = (set: string) => {
      const def = cardDef(set, "Maladjustment");
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "mal", def, owner: P1, zone: "hand" }, borrowed(), ...bank("obsession", 3, P1)]
      });
      play(engine, P1, id("mal"), { selected: { res: [id("borrowed")] } });
      return { engine, id, def };
    };

    test("1st Edition Part 2: the borrowed resource goes into YOUR hand and you may play it", () => {
      const { engine, id, def } = run("1st Edition Part 2");
      assert.match(printedRules(def), /into your hand/);
      const card = engine.state.cards[id("borrowed")];
      assert.equal(card.zone, "hand");
      assert.equal(card.heldBy, P1);
      assert.equal(card.ownerId, P2);
      assert.ok(engine.state.players[P1].hand.includes(id("borrowed")), "engine.state.players[P1].hand.includes(id(\"borrowed\"))");
      assert.ok(!engine.state.players[P2].hand.includes(id("borrowed")), "!engine.state.players[P2].hand.includes(id(\"borrowed\"))");

      answerChooser(engine, [id("borrowed")]);
      assert.equal(card.zone, "play");
      assert.equal(card.controllerId, P1);
      assert.equal(card.ownerId, P2);
      assert.ok(engine.state.players[P1].play.includes(id("borrowed")), "engine.state.players[P1].play.includes(id(\"borrowed\"))");
    });

    test("1st Edition Part 2: declining the optional play keeps it in your hand", () => {
      const { engine, id } = run("1st Edition Part 2");
      answerChooser(engine, []);
      assert.equal(engine.state.cards[id("borrowed")].zone, "hand");
      assert.ok(engine.state.players[P1].hand.includes(id("borrowed")), "engine.state.players[P1].hand.includes(id(\"borrowed\"))");
    });

    test("2nd Edition: the borrowed resource goes to its OWNER's hand, so there is nothing of yours to play", () => {
      const { engine, id, def } = run("2nd Edition");
      assert.match(printedRules(def), /its owner's hand/);
      const card = engine.state.cards[id("borrowed")];
      assert.equal(card.zone, "hand");
      assert.equal(card.heldBy, undefined);
      assert.ok(engine.state.players[P2].hand.includes(id("borrowed")), "engine.state.players[P2].hand.includes(id(\"borrowed\"))");
      assert.ok(!engine.state.players[P1].hand.includes(id("borrowed")), "!engine.state.players[P1].hand.includes(id(\"borrowed\"))");
      assert.equal(engine.state.pendingChoice, undefined);
    });
  });

  describe("Recollection Bazaar — 1st Edition Part 2 prints \"into your hand\", 2nd Edition \"into it's owner's hand\"", () => {
    const run = (set: string) => {
      const def = cardDef(set, "Recollection Bazaar");
      const { engine, id } = buildGame({
        cards: [{ key: "rb", def, owner: P1, zone: "play" }, borrowed()]
      });
      activate(engine, P1, id("rb"), "recall", { selected: { res: [id("borrowed")] } });
      return { engine, id, def };
    };

    test("1st Edition Part 2: RECALL puts a resource you control but don't own into YOUR hand", () => {
      const { engine, id, def } = run("1st Edition Part 2");
      assert.match(printedRules(def), /into your hand/);
      const card = engine.state.cards[id("borrowed")];
      assert.equal(card.zone, "hand");
      assert.equal(card.heldBy, P1);
      assert.ok(engine.state.players[P1].hand.includes(id("borrowed")), "engine.state.players[P1].hand.includes(id(\"borrowed\"))");
      assert.ok(!engine.state.players[P2].hand.includes(id("borrowed")), "!engine.state.players[P2].hand.includes(id(\"borrowed\"))");
    });

    test("2nd Edition: RECALL puts it into its OWNER's hand", () => {
      const { engine, id, def } = run("2nd Edition");
      assert.match(printedRules(def), /owner's hand/);
      const card = engine.state.cards[id("borrowed")];
      assert.equal(card.zone, "hand");
      assert.equal(card.heldBy, undefined);
      assert.ok(engine.state.players[P2].hand.includes(id("borrowed")), "engine.state.players[P2].hand.includes(id(\"borrowed\"))");
      assert.ok(!engine.state.players[P1].hand.includes(id("borrowed")), "!engine.state.players[P1].hand.includes(id(\"borrowed\"))");
    });

    test("1st Edition Part 2: a resource you own still goes to your hand", () => {
      const def = cardDef("1st Edition Part 2", "Recollection Bazaar");
      const { engine, id } = buildGame({
        cards: [
          { key: "rb", def, owner: P1, zone: "play" },
          { key: "mine", def: resourceCard({ name: "Mine" }), owner: P1, zone: "play" }
        ]
      });
      activate(engine, P1, id("rb"), "recall", { selected: { res: [id("mine")] } });
      assert.equal(engine.state.cards[id("mine")].heldBy, undefined);
      assert.deepEqual(engine.state.players[P1].hand, [id("mine")]);
    });
  });

  describe("Foment (Seed 2) — prints \"into your hand\"", () => {
    test("the borrowed resource goes into YOUR hand, then you draw a card", () => {
      const def = cardDef("Seed 2", "Foment");
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "fo", def, owner: P1, zone: "hand" },
          borrowed(),
          { key: "d0", def: tactic({ name: "Top Card" }), owner: P1, zone: "deck" },
          ...bank("obsession", 3, P1)
        ]
      });
      assert.match(printedRules(def), /into your hand/);
      play(engine, P1, id("fo"), { selected: { res: [id("borrowed")] } });

      const card = engine.state.cards[id("borrowed")];
      assert.equal(card.zone, "hand");
      assert.equal(card.heldBy, P1);
      assert.equal(card.ownerId, P2);
      assert.ok(!engine.state.players[P2].hand.includes(id("borrowed")), "!engine.state.players[P2].hand.includes(id(\"borrowed\"))");
      assert.deepEqual([...engine.state.players[P1].hand].sort(), [id("borrowed"), id("d0")].sort());
    });
  });

  describe("Two-Headed Coin — 1st Edition Part 2 and 2nd Edition both print \"shuffle this card into your deck\"", () => {
    for (const set of ["1st Edition Part 2", "2nd Edition"]) {
      test(`${set}: a coin you control but don't own is shuffled into YOUR deck, not its owner's`, () => {
        const def = cardDef(set, "Two-Headed Coin");
        assert.match(printedRules(def), /into your deck/);
        const flipper = tactic({
          name: "Flippy",
          behavior: {
            abilities: [
              {
                id: "flip",
                type: "activated",
                effects: [
                  {
                    type: "flipCoin",
                    winEffects: [{ type: "modifyInfluence", player: "controller", amount: 1 }],
                    loseEffects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
                  }
                ]
              }
            ]
          }
        });
        let calls = 0;
        // The first flip loses (>= 0.5); every later roll (shuffle, reflip) is low.
        const { engine, id } = buildGame({
          cards: [
            { key: "coin", def, owner: P2, controller: P1, zone: "play" },
            { key: "flip", def: flipper, owner: P1, zone: "hand" },
            { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" },
            { key: "t0", def: tactic({ name: "T0" }), owner: P2, zone: "deck" }
          ],
          random: () => (calls++ === 0 ? 0.9 : 0.1)
        });
        const p2DeckBefore = [...engine.state.players[P2].deck];
        const influenceBefore = engine.state.players[P1].influence;

        engine.perform({ type: "playCard", playerId: P1, cardId: id("flip") });
        resolvePendingResponses(engine);
        assert.equal(engine.state.pendingChoice?.kind, "coinFlipReplace");
        engine.perform({
          type: "resolvePendingChoice",
          playerId: P1,
          choice: { kind: "coinFlipReplace", reflip: true }
        } as never);
        resolvePendingResponses(engine);

        const coin = engine.state.cards[id("coin")];
        assert.ok(["deck", "hand"].includes(coin.zone), "shuffled into a deck (then possibly drawn)");
        assert.equal(coin.heldBy, P1);
        assert.equal(coin.ownerId, P2);
        const p1Cards = [...engine.state.players[P1].deck, ...engine.state.players[P1].hand];
        assert.ok(p1Cards.includes(id("coin")), "p1Cards.includes(id(\"coin\"))");
        assert.deepEqual(engine.state.players[P2].deck, p2DeckBefore);
        assert.ok(!engine.state.players[P2].hand.includes(id("coin")), "!engine.state.players[P2].hand.includes(id(\"coin\"))");
        assert.equal(engine.state.players[P1].influence, influenceBefore + 1, "the reflip won");
      });
    }
  });
});

describe("Ecto-Distillation — Open Beta pulls every copy and you must take one; 1st/2nd Edition search any number", () => {
  const board = (set: string) => {
    const foo = character({ name: "Foo" });
    return buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ed", def: cardDef(set, "Ecto-Distillation"), owner: P1, zone: "hand" },
        { key: "f1", def: foo, owner: P1, zone: "deck" },
        { key: "f2", def: foo, owner: P1, zone: "deck" },
        { key: "f3", def: foo, owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
  };
  const zones = (engine: ReturnType<typeof buildGame>["engine"], ids: string[]) => ids.map(i => engine.state.cards[i].zone).sort();

  test("Open Beta: one copy to hand, every other copy to the discard pile", () => {
    const { engine, id } = board("Open Beta");
    play(engine, P1, id("ed"), {});
    drain(engine, pc =>
      pc.kind === "nameValue"
        ? { kind: "nameValue", value: "Foo" }
        : pc.kind === "chooserSelectsTarget"
          ? { kind: "chooserSelectsTarget", selected: [id("f1")] }
          : declineAll(pc)
    );
    assert.deepEqual(zones(engine, [id("f1"), id("f2"), id("f3")]), ["discard", "discard", "hand"]);
  });

  test("1st Edition: finding just one copy (and the opponent declining) leaves the others in the deck", () => {
    const { engine, id } = board("1st Edition");
    play(engine, P1, id("ed"), {});
    drain(engine, pc =>
      pc.kind === "nameValue"
        ? { kind: "nameValue", value: "Foo" }
        : pc.kind === "chooserSelectsTarget" && pc.playerId === P1
          ? { kind: "chooserSelectsTarget", selected: [id("f1")] }
          : declineAll(pc)
    );
    assert.deepEqual(zones(engine, [id("f1"), id("f2"), id("f3")]), ["deck", "deck", "hand"]);
  });

  test("1st Edition: the opponent may pull the remaining copies into the discard pile", () => {
    const { engine, id } = board("2nd Edition");
    play(engine, P1, id("ed"), {});
    drain(engine, pc =>
      pc.kind === "nameValue"
        ? { kind: "nameValue", value: "Foo" }
        : pc.kind === "chooserSelectsTarget" && pc.playerId === P1
          ? { kind: "chooserSelectsTarget", selected: [id("f1")] }
          : pc.kind === "chooserSelectsTarget"
            ? { kind: "chooserSelectsTarget", selected: [id("f2"), id("f3")] }
            : declineAll(pc)
    );
    assert.deepEqual(zones(engine, [id("f1"), id("f2"), id("f3")]), ["discard", "discard", "hand"]);
  });
});

describe("Flaming Cube (Shade) — at 6 tokens it is destroyed and only your opponents' factions lose 6", () => {
  test("the sixth token costs your opponent 6 influence and you nothing", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fc", def: cardDef("Shade of the Devoured Emperor", "Flaming Cube"), owner: P1, zone: "play", counters: { token: 5 } },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "play" }
      ]
    });
    const mine = engine.state.players[P1].influence;
    const theirs = engine.state.players[P2].influence;
    activate(engine, P1, id("fc"), "fc-control", { selected: { x: [id("fodder")] } });
    drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)));
    assert.equal(engine.state.cards[id("fc")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, mine);
    assert.equal(engine.state.players[P2].influence, theirs - 6);
  });
});

describe("Giada, the Elegant (Seed 3) — the printed replacement does not clear damage", () => {
  test("the replacement adds a token, depletes and removes her from battle, but leaves damage alone", () => {
    const effects = JSON.stringify(cardDef("Seed 3", "Giada, the Elegant").behavior);
    assert.ok(effects.includes('"removeFromBattle"') && !effects.includes('"setDamage"'), "effects.includes('\"removeFromBattle\"') && !effects.includes('\"setDamage\"')");
  });
});

describe("Hypnotic Plafond (1st Edition / Open Beta) — \"COVERT parties cannot attack your faction\"", () => {
  for (const set of ["1st Edition", "Open Beta"]) {
    test(`${set}: an all-COVERT party can't attack your faction; a mixed party can`, () => {
      const sneak = character({ name: "Sneak", behavior: { keywords: ["covert"] } } as never);
      const { engine, id } = buildGame({
        cards: [
          { key: "hp", def: cardDef(set, "Hypnotic Plafond"), owner: P1, zone: "play" },
          { key: "s1", def: sneak, owner: P2, zone: "play" },
          { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" }
        ],
        turn: 2,
        activePlayerId: P2
      });
      assert.throws(() =>
        engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("s1")], target: { type: "faction", playerId: P1 } } as never)
      );
      assert.doesNotThrow(() =>
        engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("s1"), id("plain")], target: { type: "faction", playerId: P1 } } as never)
      );
    });
  }
});

describe("I Drink Your Milkshake! — Seed 2 removes the card from the game; Seed Saga voids it", () => {
  const run = (set: string) => {
    const twin = character({ name: "Twin", cost: 1 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ms", def: cardDef(set, "I Drink Your Milkshake!"), owner: P1, zone: "hand" },
        { key: "dug", def: twin, owner: P2, zone: "deck" },
        { key: "theirs", def: twin, owner: P2, zone: "hand" },
        ...bank("deception", 8, P1),
        ...bank("rage", 3, P2)
      ]
    });
    play(engine, P1, id("ms"), { selected: { dig: [id("dug")] } });
    drain(engine, declineAll);
    const parked = engine.state.cards[id("dug")].zone;
    endTurn(engine, P1);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("dug")] }
        : pc.kind === "deployForFree"
          ? { kind: "deployForFree", cardId: id("dug") }
          : declineAll(pc)
    );
    return { parked, dug: engine.state.cards[id("dug")].zone, dugController: engine.state.cards[id("dug")].controllerId };
  };

  test("Seed 2: the dug card waits out of the game, then you deploy it when they play its twin", () => {
    assert.deepEqual(run("Seed 2"), { parked: "removed", dug: "play", dugController: P1 });
  });

  test("Seed Saga: the dug card waits in the void", () => {
    assert.equal(run("Seed Saga").parked, "void");
  });
});

describe("Jumping Screamspider — SCREAM is a this-turn aura on the opposing party; Open Beta once each turn", () => {
  const run = (set: string, uses: number) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "js", def: cardDef(set, "Jumping Screamspider"), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", speed: 5 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    let used = 0;
    for (let i = 0; i < uses; i++) {
      try {
        activate(engine, P1, id("js"), "scream");
        drain(engine, declineAll);
        used++;
      } catch {
        break;
      }
    }
    // SCREAM before the battle: the aura applies once the battle starts.
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("js")], target: { type: "faction", playerId: P2 } } as never);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe")] } as never);
    resolvePendingResponses(engine);
    return { used, foeSpeed: engine.getStat(id("foe"), "speed"), covert: engine.getKeywords(id("js")).includes("covert") };
  };

  test("1st Edition: two free SCREAMs before battle give the blocker -4 speed and no COVERT", () => {
    assert.deepEqual(run("1st Edition", 2), { used: 2, foeSpeed: 1, covert: false });
  });

  test("Open Beta: only one SCREAM per turn", () => {
    assert.deepEqual(run("Open Beta", 2), { used: 1, foeSpeed: 3, covert: false });
  });
});

describe("\"If this card would be destroyed … instead\" replacements only protect their own card", () => {
  test("every printing whose own text says \"if this card would be / is destroyed\" binds its destroy replacement to itself", () => {
    const loose: string[] = [];
    for (const set of ["Open Beta", "1st Edition", "1st Edition Part 2", "Seed", "Seed 2", "Seed 3", "2nd Edition", "Shade of the Devoured Emperor", "Holy Heist", "Ungodly Mess", "Seed Saga"]) {
      for (const card of setCards(set)) {
        if (!/if this card (would be|is) destroyed/i.test(printedRules(card))) continue;
        for (const ability of card.behavior?.abilities ?? []) {
          if (ability.type === "replacement" && (ability as { replaces: { event: string } }).replaces.event === "destroy" && !(ability as { condition?: unknown }).condition) {
            loose.push(`${card.name} (${set})`);
          }
        }
      }
    }
    assert.deepEqual(loose, []);
  });

  test("Fired Hand (Seed 2) does not flip an opponent's destroyed character face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fh", def: cardDef("Seed 2", "Fired Hand"), owner: P1, zone: "play" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });
});

describe("Lugubrious Node — \"cannot be destroyed by other \\\"node\\\" cards\" (1st Edition / Open Beta)", () => {
  test("a node card's destroy effect does nothing to it; a non-node one destroys it", () => {
    const zapper = (subtype: string[]) =>
      item({
        name: subtype.length ? "Node Zapper" : "Plain Zapper",
        subtype,
        behavior: { abilities: [{ id: "zap", name: "Zap", type: "activated", targets: [{ id: "t", selector: { type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
      });
    const run = (zapperSubtype: string[]) => {
      const { engine, id } = buildGame({
        cards: [
          { key: "ln", def: cardDef("1st Edition", "Lugubrious Node"), owner: P2, zone: "play" },
          { key: "z", def: zapper(zapperSubtype), owner: P1, zone: "play" }
        ]
      });
      activate(engine, P1, id("z"), "zap", { selected: { t: [id("ln")] } });
      drain(engine, declineAll);
      return engine.state.cards[id("ln")].zone;
    };
    assert.equal(run(["node"]), "play");
    assert.equal(run([]), "discard");
  });
});

describe("Martial Arts Master — 1st Edition Part 2 also gains strength unblocked (no opposing-character condition)", () => {
  const run = (set: string) => {
    const d = cardDef(set, "Martial Arts Master");
    const { engine, id } = buildGame({ cards: [{ key: "mam", def: d, owner: P1, zone: "play" }], turn: 2 });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mam")], target: { type: "faction", playerId: P2 } } as never);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
    resolvePendingResponses(engine);
    return engine.getStat(id("mam"), "strength") - (d.strength ?? 0);
  };

  test("1st Edition Part 2: unblocked, it gains its full speed as strength", () => {
    const d = cardDef("1st Edition Part 2", "Martial Arts Master");
    assert.equal(run("1st Edition Part 2"), d.speed);
  });

  test("2nd Edition: unblocked, no bonus", () => {
    assert.equal(run("2nd Edition"), 0);
  });
});

describe("Makeshift Contrivance (1st Edition) — \"Put a resource into play\" is not playing a resource", () => {
  test("the resource enters play without a resourcePlayed trigger", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "w", type: "triggered", event: "resourcePlayed", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: cardDef("1st Edition", "Makeshift Contrivance"), owner: P1, zone: "play" },
        { key: "w", def: watcher, owner: P1, zone: "play" },
        { key: "res", def: cardDef("1st Edition", "Elitism"), owner: P1, zone: "hand" },
        ...bank("elitism", 2, P1)
      ]
    });
    activate(engine, P1, id("mc"), "deploy");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("res")] }
        : pc.kind === "playResource"
          ? { kind: "playResource", faceDown: false }
          : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "play");
    assert.equal(engine.state.cards[id("w")].counters?.token ?? 0, 0);
  });
});

describe("Ravenous Wolf / Unexpected Boobysnake — \"If you do\" = whenever it was played at tactic speed", () => {
  const run = (asResponse: boolean) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wolf", def: cardDef("Open Beta", "Ravenous Wolf"), owner: P1, zone: "hand" },
        { key: "t", def: tactic({ name: "Fizz", cost: 0 }), owner: P1, zone: "hand" },
        { key: "t2", def: tactic({ name: "Fizz Back", cost: 0 }), owner: P2, zone: "hand" },
        ...bank("deception", 6, P1)
      ]
    });
    if (asResponse) {
      // Your own turn: you play a tactic, your opponent responds, and you answer with the Wolf at tactic speed.
      engine.perform({ type: "playCard", playerId: P1, cardId: id("t"), selected: {} } as never);
      engine.perform({ type: "playCard", playerId: P2, cardId: id("t2"), selected: {} } as never);
    }
    engine.perform({ type: "playCard", playerId: P1, cardId: id("wolf"), selected: {} } as never);
    resolvePendingResponses(engine);
    return engine.state.pendingChoice?.kind === "chooserSelectsTarget" || engine.state.cards[id("wolf")].zone !== "play";
  };

  test("Open Beta: answering your own tactic with it on your turn still costs a Deception (or the Wolf)", () => {
    assert.equal(run(true), true);
  });

  test("Open Beta: a normal main-phase deploy has no drawback", () => {
    assert.equal(run(false), false);
  });
});

describe("Sarcophyle Matriculation — 1st Edition replaces the destruction; Open Beta lets it be destroyed, then returns it", () => {
  const run = (set: string) => {
    const watcher = character({
      name: "Mourner",
      behavior: { abilities: [{ id: "m", type: "triggered", event: "cardDestroyed", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] } as never
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: cardDef(set, "Sarcophyle Matriculation"), owner: P1, zone: "hand" },
        { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "mourn", def: watcher, owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sm"), selected: { c: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    const atk = engine.state.cards[id("atk")];
    return { zone: atk.zone, controller: atk.controllerId, depleted: atk.depleted, destroyedTriggers: engine.state.cards[id("mourn")].counters?.token ?? 0 };
  };

  test("1st Edition: never destroyed; it ends up yours, depleted", () => {
    assert.deepEqual(run("1st Edition"), { zone: "play", controller: P1, depleted: true, destroyedTriggers: 0 });
  });

  test("Open Beta: destroyed first (destroy triggers fire), then put into play yours, depleted", () => {
    assert.deepEqual(run("Open Beta"), { zone: "play", controller: P1, depleted: true, destroyedTriggers: 1 });
  });
});

describe("Research Investment — Open Beta searches up to 5 staples; later printings up to 3", () => {
  test("search counts match the printings", () => {
    const count = (set: string) => JSON.stringify(cardDef(set, "Research Investment").behavior).match(/"id":"r","selector":\{[^}]*\},"count":(\d+)/)?.[1];
    assert.equal(count("Open Beta"), "5");
    assert.equal(count("1st Edition"), "3");
  });
});

describe("Study Disturbance / Tedious TriAdic Truculence (Shade) — buyouts on resolution as printed", () => {
  test("Tedious TriAdic Truculence: the 3 picks must have different names", () => {
    const twin = character({ name: "Same", strength: 1 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ttt", def: cardDef("Shade of the Devoured Emperor", "Tedious TriAdic Truculence"), owner: P1, zone: "hand" },
        { key: "a", def: twin, owner: P2, zone: "play" },
        { key: "b", def: twin, owner: P2, zone: "play" },
        { key: "c", def: character({ name: "Other", strength: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    assert.throws(() => play(engine, P1, id("ttt"), { selected: { picks: [id("a"), id("b"), id("c")] } }));
  });

  test("Study Disturbance: paying 2 shows you your top card and ends the card (no draw)", () => {
    const json = JSON.stringify(cardDef("Shade of the Devoured Emperor", "Study Disturbance").behavior);
    assert.ok(json.includes('"type":"reveal","of":"controller","zone":"deckTop"'), "json.includes('\"type\":\"reveal\",\"of\":\"controller\",\"zone\":\"deckTop\"')");
  });
});

describe("Subversion Matrix — 1st Edition has no ATTACH TO CHARACTER line", () => {
  test("1st Edition enters play unattached; 2nd Edition must attach", () => {
    assert.equal(cardDef("1st Edition", "Subversion Matrix").attachTo, undefined);
    assert.equal(cardDef("2nd Edition", "Subversion Matrix").attachTo, "character");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sm", def: cardDef("1st Edition", "Subversion Matrix"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    play(engine, P1, id("sm"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sm")].zone, "play");
  });
});

describe("The Emperor Barduse — Seed 2 counts \"dragon\" cards; Seed Saga counts dragon characters", () => {
  test("Seed 2's X counts a dragon item too; Seed Saga's does not", () => {
    const counter = (set: string) => JSON.stringify(cardDef(set, "The Emperor Barduse").behavior!.abilities![0]);
    assert.ok(counter("Seed 2").includes('"selector":{"controller":"self","zone":"play","subtype":"dragon"}'), "counter(\"Seed 2\").includes('\"selector\":{\"controller\":\"self\",\"zone\":\"play\",\"subtype\":\"dragon\"}')");
    assert.ok(counter("Seed Saga").includes('"selector":{"controller":"self","zone":"play","type":"character","subtype":"dragon"}'), "counter(\"Seed Saga\").includes('\"selector\":{\"controller\":\"self\",\"zone\":\"play\",\"type\":\"character\",\"subtype\":\"dragon\"}')");
  });
});

describe("Tri-Pole Magnet — 1st Edition / Open Beta only act if the attached character is still in play", () => {
  test("the GRAPPLE effect is gated on the host still being in play", () => {
    for (const set of ["1st Edition", "Open Beta"]) {
      const grapple = cardDef(set, "Tri-Pole Magnet").behavior!.abilities!.find(a => a.id === "grapple") as { effects: { type: string; condition?: { type: string } }[] };
      assert.equal(grapple.effects[0].type, "if", set);
      assert.equal(grapple.effects[0].condition?.type, "targetInZone", set);
    }
    const grapple2 = cardDef("2nd Edition", "Tri-Pole Magnet").behavior!.abilities!.find(a => a.id === "grapple") as { effects: { type: string }[] };
    assert.equal(grapple2.effects[0].type, "putIntoPlay");
  });
});

describe("Vander Malagut — Open Beta lets the character be destroyed, then returns it; 1st/2nd Edition replace the destruction", () => {
  test("Open Beta's harvest destroys, then puts the character into play under your control", () => {
    const harvest = (set: string) => JSON.stringify(cardDef(set, "Vander Malagut").behavior!.abilities!.find(a => a.id === "harvest"));
    assert.ok(harvest("Open Beta").includes('"effects":[{"type":"destroy"') && harvest("Open Beta").includes('"putIntoPlay"'), "harvest(\"Open Beta\").includes('\"effects\":[{\"type\":\"destroy\"') && harvest(\"Open Beta\").includes('\"putIntoPlay\"')");
    assert.ok(harvest("1st Edition").includes('"takeControl"') && !harvest("1st Edition").includes('"putIntoPlay"'), "harvest(\"1st Edition\").includes('\"takeControl\"') && !harvest(\"1st Edition\").includes('\"putIntoPlay\"')");
  });
});

describe("Emergency Obfuscation — while it is in play the players switch seats and each controls the other's side (Open Beta / 1st Edition)", () => {
  for (const set of ["Open Beta", "1st Edition"]) {
    const eo = () => cardDef(set, "Emergency Obfuscation");
    const owner = (engine: ReturnType<typeof buildGame>["engine"], cardId: string) => engine.state.cards[cardId].controllerId;
    const endTurn = (engine: ReturnType<typeof buildGame>["engine"], who: string) => {
      engine.perform({ type: "endTurn", playerId: who });
      drain(engine, declineAll);
      resolvePendingResponses(engine);
    };

    test(`${set}: it is a TACTICAL item with the seat swap authored`, () => {
      const def = eo();
      assert.deepEqual(def.behavior!.keywords, ["tactical"]);
      assert.ok(def.behavior!.abilities!.some(a => a.type === "continuous" && (a as { swapsSides?: boolean }).swapsSides === true), "def.behavior!.abilities!.some(a => a.type === \"continuous\" && (a as { swapsSides?: boolean }).swapsSides === true)");
    });

    test(`${set}: playing it swaps the sides; two of its controller's turns later it is destroyed and the sides come back`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "eo", def: eo(), owner: P1, zone: "hand" },
          { key: "hero", def: character({ name: "Hero" }), owner: P1 },
          { key: "guard", def: character({ name: "Guard" }), owner: P2 },
          ...bank("deception", 3, P1)
        ]
      });
      const factionA = engine.state.players[P1].factionId;
      play(engine, P1, id("eo"));

      // The swap takes hold the moment it enters play: P2 controls P1's old side (EO included), P1 controls P2's.
      assert.equal(engine.state.cards[id("eo")].zone, "play");
      assert.equal(owner(engine, id("hero")), P2);
      assert.equal(owner(engine, id("guard")), P1);
      assert.equal(owner(engine, id("eo")), P2);
      assert.equal(engine.state.cards[factionA!].controllerId, P2);
      assert.equal(engine.state.activePlayerId, P1, "the turn is still P1's");

      endTurn(engine, P1);
      // P2's turn: EO is P2's now, so P2 puts the first token on it.
      assert.equal(engine.state.activePlayerId, P2);
      assert.equal(engine.state.cards[id("eo")].counters.token, 1);
      endTurn(engine, P2);
      assert.equal(engine.state.cards[id("eo")].zone, "play", "one token is not enough to destroy it");
      assert.ok(engine.state.seatSwap, "engine.state.seatSwap");

      endTurn(engine, P1);
      assert.equal(engine.state.activePlayerId, P2);
      assert.equal(engine.state.cards[id("eo")].counters.token, 2);
      endTurn(engine, P2);

      // Second token: destroyed at the end of its controller's turn, and the seats go back.
      assert.equal(engine.state.cards[id("eo")].zone, "discard");
      assert.equal(engine.state.seatSwap, undefined);
      assert.equal(owner(engine, id("hero")), P1);
      assert.equal(owner(engine, id("guard")), P2);
      assert.equal(engine.state.cards[factionA!].controllerId, P1);
      assert.equal(engine.state.players[P1].factionId, factionA);
      assert.equal(engine.state.activePlayerId, P1);
    });

    test(`${set}: played as a tactic in response to an attack, it takes the attackers out of the fight`, () => {
      const { engine, id } = buildGame({
        playerB: { faction: developFaction(), influence: 4 },
        cards: [
          { key: "eo", def: eo(), owner: P2, zone: "hand" },
          { key: "hero", def: character({ name: "Hero", strength: 6 }), owner: P1 },
          { key: "guard", def: character({ name: "Guard" }), owner: P2 },
          ...bank("deception", 3, P2)
        ]
      });
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("hero")], target: { type: "faction", playerId: P2 } });
      engine.perform({ type: "passPriority", playerId: P1 });
      play(engine, P2, id("eo"));
      assert.ok(engine.state.seatSwap, "engine.state.seatSwap");
      assert.equal(owner(engine, id("hero")), P2);
      // The attack has no attackers left, so nobody is hurt. EO sits on P2's side, so P1 now controls it.
      for (let i = 0; engine.state.battle && i < 50; i++) engine.perform({ type: "advanceFlow" });
      assert.equal(engine.state.result, undefined);
      assert.equal(engine.state.players[P1].influence, 4, "P2's faction (held by P1) took no damage");
      assert.equal(owner(engine, id("eo")), P1);
    });
  }
});

describe("The Billionaire — 1st Edition and Open Beta play \"as though you were your opponent\"; 2nd Edition makes you pay the numeric cost yourself", () => {
  const borrowMode = (set: string) =>
    (cardDef(set, "The Billionaire").behavior!.abilities!.find(a => a.id === "borrow") as { canUseOpponentAbilities?: unknown })
      .canUseOpponentAbilities;

  test("each printing's behavior follows its printed text", () => {
    for (const set of ["1st Edition", "Open Beta"]) {
      assert.match(printedRules(cardDef(set, "The Billionaire")), /as though you were your opponent/i, set);
      assert.equal(borrowMode(set), "asOpponent", set);
    }
    assert.match(printedRules(cardDef("2nd Edition", "The Billionaire")), /numeric cost with your own resources/i);
    assert.equal(borrowMode("2nd Edition"), true);
  });

  /** P1's Billionaire (in play) next to an opponent machine whose ability costs 1 and draws a card for its controller. */
  const scenario = (set: string, mine: number, theirs: number) => {
    const machine = character({
      name: "Opp Machine",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            costs: [{ type: "payResources", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    return buildGame({
      cards: [
        { key: "tb", def: cardDef(set, "The Billionaire"), owner: P1, zone: "play" },
        { key: "o", def: machine, owner: P2, zone: "play" },
        ...bank("rage", mine, P1),
        ...bank("rage", theirs, P2),
        ...["d0", "d1"].map(key => ({ key, def: character({ name: key }), owner: P2, zone: "deck" as const }))
      ]
    });
  };
  const offered = ({ engine, id }: ReturnType<typeof scenario>) =>
    engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("o"));

  for (const set of ["1st Edition", "Open Beta"]) {
    test(`${set}: the opponent pays the numeric cost out of their own resources, and the effect is theirs`, () => {
      const built = scenario(set, 1, 1);
      const p1Hand = built.engine.state.players[P1].hand.length;
      const p2Hand = built.engine.state.players[P2].hand.length;
      activate(built.engine, P1, built.id("o"), "go");
      resolvePendingResponses(built.engine);
      assert.equal(built.engine.getAvailableResourceCount(P1), 1, "the Billionaire's controller spends nothing");
      assert.equal(built.engine.getAvailableResourceCount(P2), 0, "the opponent's resource paid for it");
      assert.equal(built.engine.state.players[P2].hand.length, p2Hand + 1, "the opponent draws");
      assert.equal(built.engine.state.players[P1].hand.length, p1Hand);
    });

    test(`${set}: it is not offered, and cannot be used, when the opponent cannot pay`, () => {
      const built = scenario(set, 1, 0);
      assert.equal(offered(built), false);
      assert.throws(() => activate(built.engine, P1, built.id("o"), "go"));
      assert.equal(built.engine.getAvailableResourceCount(P1), 1);
      assert.equal(offered(scenario(set, 0, 1)), true, "affordable by the opponent alone");
    });
  }

  test("2nd Edition: you pay the numeric cost out of your own resources; the effect is still the opponent's", () => {
    const built = scenario("2nd Edition", 1, 1);
    const p2Hand = built.engine.state.players[P2].hand.length;
    activate(built.engine, P1, built.id("o"), "go");
    resolvePendingResponses(built.engine);
    assert.equal(built.engine.getAvailableResourceCount(P1), 0);
    assert.equal(built.engine.getAvailableResourceCount(P2), 1);
    assert.equal(built.engine.state.players[P2].hand.length, p2Hand + 1);
  });

  test("2nd Edition: offered only when you can pay it, whatever the opponent holds", () => {
    assert.equal(offered(scenario("2nd Edition", 0, 1)), false);
    assert.equal(offered(scenario("2nd Edition", 1, 0)), true);
  });
});
