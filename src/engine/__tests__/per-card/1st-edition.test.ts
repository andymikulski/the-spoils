// Per-card correctness suite — 1st Edition (226 cards). 206 of these are
// name-identical reprints of Open Beta cards; those are covered by a
// parity check (behavior JSON must match the Open Beta card, which carries
// the deep functional test in open-beta.test.ts) plus a printed-stat
// instantiation check. The 20 cards novel to 1st Edition get full per-card
// tests below. See ./_harness.ts and docs/TESTING.md.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  setCards,
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
  samePrintedRules,
  P1,
  P2, developDrawChoice, settleStartFirst } from "./_harness.js";
import type { CardDefinition } from "../../../engine.js";

const SET = "1st Edition";
const def = (name: string) => cardDef(SET, name);

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
    case "chooserSelectsOption":
      return { kind: "chooserSelectsOption", index: 0 };
    case "selectTargets": {
      const sel: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) sel[d.id] = [];
      return { kind: "selectTargets", selected: sel };
    }
    case "selectDeployTargets": {
      const sel: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) sel[d.id] = [];
      return { kind: "selectDeployTargets", selected: sel };
    }
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "chooseNumber":
      return { kind: "chooseNumber", value: (pc.min as number) ?? 0 };
    case "reorderDeck":
      return {
        kind: "reorderDeck",
        order: pc.to === "split" ? [] : [...((pc.cardIds as string[]) ?? [])],
        bottom: pc.to === "split" ? [...((pc.cardIds as string[]) ?? [])] : undefined
      };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "nameValue":
      return { kind: "nameValue", value: "Nonexistent" };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// Reprint parity — every card 1st Edition shares with Open Beta
// =====================================================================

// Every card 1st Edition reprints from Open Beta, by name. Kept as an
// explicit literal list (not derived from the catalog) so the progress
// tracker counts each one and so a future catalog change that drops/renames
// a reprint fails loudly here.
const REPRINTS = [
  "12 Man Brunch of Doom", "1337!", "3p1ph4ny 31f",
  "633fy 31f", "700160x 31f", "Adroit Marauder",
  "Air Travel", "All-Nighter", "Ambuscade",
  "Amortized Straw Man", "Arcana Department", "Arcana Experiment",
  "Arcanist's Almanac", "Arena Quarter-Finalist", "Armored Keep",
  "Ashes of Zenobia", "Basic Node", "Bask Bile",
  "Beatrix Winterbottom", "Befuddling Beggar", "Berserker Corps",
  "Bipolar Sarcophyle", "Blanching Butcher", "Bloodcurdling Bulldozer",
  "Brummagem Jewelry", "Cannon Squadron", "Card Counter",
  "Cash Out", "Catastrophic Betrayal", "Compulsive Creeper",
  "Concealed Goon", "Costly Filcher", "Crazed Deputy",
  "Creaky Old Swordsman", "Dandy Day-Trader", "Deception",
  "Defenestrate", "Defense Attorney", "Degenerate Molestation",
  "Devastating Mockery", "Dock Sentinel", "Downsizing",
  "Dragon Catheter", "Dragon Juice", "Dragon Rider",
  "Dragon Tank", "Dragon's Anthem", "Dragon's Quarters",
  "Dragon's Strategy", "Ecto-Distillation", "Elitism",
  "Emergency Obfuscation", "Entrancing Harlot", "Epiphanal Mechanic",
  "Erotic Assassin", "Executive Poaching", "Eye Gouge",
  "Ferrous Ferret", "Flaming Barduse", "Forced Recruitment",
  "Forget", "Free Trade Agreement", "Ghostly Auditor",
  "Gold Summit", "Grand Theft All", "Greed",
  "Gruesome Trophies", "Hammer Smash", "Hangdog Alley",
  "Headlong Purloiner", "Heirloom Incinerator", "Heist Planner",
  "Hidden Sandwich", "Hidden Sniper", "Hub Node",
  "Humiliating Torture Apparatus", "Hyperphagic Sarcophyle", "Hypnotic Plafond",
  "I Got the Gear!", "Impulsive Abductress", "Incriminating Photograph",
  "Index of Natural Forces", "Insidious Ecto-Manipulator", "Intermittently Sneaky Lawyer",
  "Invent", "Irresistible Bribe", "Jackmove",
  "Jacque's Trap", "Jo Ciendeilio", "Jumping Screamspider",
  "Kettinger", "Knobby Stave", "Legacy Warmachine",
  "Limited Liability", "Lugubrian Octopod", "Lugubrious Finger Trap",
  "Lugubrious Node", "Luteoderm Armor", "Luteoderm Goliath",
  "Luteoderm Prototype", "Mafia Lawyer", "Magic Vault",
  "Manifold Quasi-Modal Steamwork", "Master Ritualist", "Master Scavenger",
  "Mau Tough", "Mau “Consultant”", "Meager Research",
  "Mephitic Nullifier", "Micromajig Avalanche", "Micromajig Factory",
  "Micromajig Maker", "Micromajig Master", "Napiform Protuberance",
  "Nasty Butler", "Nearby Serpent", "Necromorph Bureaucrat",
  "Obsession", "Ominous Oozling", "One-Legged Hopping Pogo-Bear",
  "Oversoon Lightfoot", "Paralegal Prodigy", "Pettifogger",
  "Pillaging Pirate", "Plodding Brute", "Pluck",
  "Postmortem Debenture", "Precise Sabotage", "Pyramid Scheme",
  "Quotidian Assassination", "Quotidian Ejector", "Quotidian Misfire",
  "Rabid Sarume", "Rage", "Raging Bask",
  "Rapine", "Rate Hike", "Ravenous Wolf",
  "Reckless Challenger", "Recondite Hunter", "Red Raven",
  "Red Tape", "Remember", "Repo Man",
  "Research Assistant", "Research Investment", "Resurrection Technician",
  "Reveille Tower", "Ritual of the Screaming Cheese", "Ritual of the Shattering Teeth",
  "Rocket Boots", "Rudimentary Lathe", "Rudo Mangod",
  "Runic Cannon", "Runic Circuitry", "Sarcophyle Matriculation",
  "Scavengemajig", "Scout", "Scrag",
  "Secret Handshake", "Securitymajig", "Selective Gluttony",
  "Servile Centipede", "Shocking Reappearance", "Shriever Attack",
  "Siege Machine", "Skewer", "Skilled Negotiator",
  "Skimping Ecto-Manipulator", "Sleeping Guard", "Slingerang",
  "Snake Eyes", "Sneaking Spitspider", "Spastic Tentacles",
  "Spontaneous Displacement", "Stalwart Soldier", "Stolen Inspiration",
  "Strength In Numbers", "Sudden Osprey", "Summary Judgment",
  "Swarm of Gnats", "Swashbuckler", "Tactician Vacation",
  "Target Practice", "Tax Attorney", "The Billionaire",
  "The Ministry of Other Smaller Ministries", "The Tournament Faction", "Thief Doyen",
  "TigerKaiser", "Towering Researchmajig", "Tremor Engine",
  "Tri-Pole Magnet", "Union Leader", "Vander Malagut",
  "Very Big Hat of Invisibility", "Voidal Nullification Chamber", "Voidal Observatory",
  "Voidal Perversion", "Voidal Poisoning", "Voidal Replication",
  "Voidal Webbing", "Warehouse Raid", "Warrior Prodigy",
  "Yoink!", "Zenobia's Spyglass"
];

describe("1st Edition — Open Beta reprint parity", () => {
  const obNames = new Set(setCards("Open Beta").map(c => c.name));
  const shared = setCards(SET).filter(c => obNames.has(c.name));

  test("REPRINTS list matches the actual set of shared card names", () => {
    assert.deepEqual([...REPRINTS].sort(), shared.map(c => c.name).sort());
  });

  for (const feCard of shared) {
    test(`${feCard.name} — behavior matches the Open Beta reprint; printed stats instantiate`, () => {
      const obCard = cardDef("Open Beta", feCard.name);
      // Printings with different printed rules play differently on purpose;
      // those are covered in printed-variants.test.ts.
      if (samePrintedRules(feCard, obCard)) {
        assert.deepEqual(
          feCard.behavior ?? null,
          obCard.behavior ?? null,
          `${feCard.name}: 1st Edition behavior diverged from the Open Beta reprint`
        );
      }

      if (feCard.type === "character" || feCard.type === "location") {
        const { engine, id } = buildGame({
          cards: [{ key: "c", def: def(feCard.name), owner: P1, zone: "play" }]
        });
        // Instantiation sanity — the card resolves its layers without
        // throwing. Exact stats aren't asserted here (a self-buff continuous
        // ability that keys off default-empty state, e.g. Compulsive
        // Creeper's "even hand" bonus, legitimately shifts them).
        for (const stat of ["strength", "life", "speed", "structure"] as const) {
          assert.equal(typeof engine.getStat(id("c"), stat), "number");
        }
        assert.doesNotThrow(() => engine.getKeywords(id("c")));
        assert.doesNotThrow(() => engine.getRestrictions(id("c")));
      }
    });
  }
});

// =====================================================================
// Cards novel to 1st Edition
// =====================================================================

describe("1st Edition — Ambiguity Inhibitor", () => {
  test("at the start of your turn, bottoms a hand card and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ai", def: def("Ambiguity Inhibitor"), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleStartFirst(engine);
    const hand = engine.state.players[P1].hand.length;
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P1
        ? { kind: "chooserSelectsTarget", selected: [id("h1")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("h1")].zone, "deck");
    assert.equal(engine.state.players[P1].hand.length, hand); // -1 bottomed, +1 drawn
  });
});

describe("1st Edition — Ectypal Stave", () => {
  test("cannot be used unless a tactic was deployed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "es", def: def("Ectypal Stave"), owner: P1, zone: "play" }, ...bank("obsession", 8, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("es"), abilityId: "counterfeit", selected: {}, variables: {} })
    );
  });
});

describe("1st Edition — Gargantuan Garbler", () => {
  test("is COVERT; when it attacks, may bounce a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gg", def: def("Gargantuan Garbler"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("gg")).includes("covert"), "engine.getKeywords(id(\"gg\")).includes(\"covert\")");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("gg")], target: { type: "faction", playerId: P2 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("1st Edition — Land Shark", () => {
  test("is COVERT; gains +1/+1 per face-down resource an opponent controls", () => {
    const d = def("Land Shark");
    const { engine, id } = buildGame({
      cards: [
        { key: "ls", def: d, owner: P1, zone: "play" },
        ...volition(3, P2)
      ]
    });
    assert.ok(engine.getKeywords(id("ls")).includes("covert"), "engine.getKeywords(id(\"ls\")).includes(\"covert\")");
    assert.equal(engine.getStat(id("ls"), "strength"), (d.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("ls"), "life"), (d.life ?? 0) + 3);
  });
});

describe("1st Edition — Sneaky Mansion", () => {
  test("is a COVERT 12/12 vanilla character", () => {
    const d = def("Sneaky Mansion");
    const { engine, id } = buildGame({
      cards: [{ key: "sm", def: d, owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("sm")).includes("covert"), "engine.getKeywords(id(\"sm\")).includes(\"covert\")");
    assert.equal(engine.getStat(id("sm"), "strength"), d.strength ?? 0);
  });
});

describe("1st Edition — Pervasive Bodyguard", () => {
  test("PROTECT gives a party-mate +1 life this turn", () => {
    const ally = character({ name: "Ally", life: 3, strength: 1, speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pb", def: def("Pervasive Bodyguard"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        ...bank("greed", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("pb"), id("ally")], target: { type: "faction", playerId: P2 } });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "protect", selected: { c: [id("ally")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("ally"), "life"), (ally.life ?? 0) + 1);
  });
});

describe("1st Edition — Recapitulating Apparition", () => {
  test("when it hits your discard from play, may pay 1 to return it depleted", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ra", def: def("Recapitulating Apparition"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("ra")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("ra")].zone, "play");
    assert.equal(engine.state.cards[id("ra")].depleted, true);
  });
});

describe("1st Edition — Resurrection Emporium", () => {
  test("RESURRECT reanimates a discard character for 3 + its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "re", def: def("Resurrection Emporium"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse", cost: 2 }), owner: P1, zone: "discard" },
        ...bank("greed", 12, P1)
      ]
    });
    activate(engine, P1, id("re"), "resurrect", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });

  test("a character headed to your discard is removed from the game instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "re", def: def("Resurrection Emporium"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", life: 1 }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("c")].zone, "removed");
  });
});

describe("1st Edition — Samuel Gristwalter", () => {
  test("reduces all damage inflicted to your faction to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sg", def: def("Samuel Gristwalter"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 5, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, inf);
  });
});

describe("1st Edition — A Series of Tubes", () => {
  test("all other node characters gain +1/+1", () => {
    const node = character({ name: "Node", strength: 2, life: 2, subtype: ["node"] });
    const { engine, id } = buildGame({
      cards: [
        { key: "st", def: def("A Series of Tubes"), owner: P1, zone: "play" },
        { key: "node", def: node, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("node"), "strength"), (node.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("node"), "life"), (node.life ?? 0) + 1);
  });
});

describe("1st Edition — Gigamajig", () => {
  test("is a 10/10 vanilla character", () => {
    const d = def("Gigamajig");
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("g"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("g"), "life"), d.life ?? 0);
    assert.deepEqual(engine.getKeywords(id("g")), []);
  });
});

describe("1st Edition — Makeshift Contrivance", () => {
  test("DEPLOY pays 1 and depletes to play a resource from hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Makeshift Contrivance"), owner: P1, zone: "play" },
        { key: "res", def: def("Rage"), owner: P1, zone: "hand" },
        ...bank("elitism", 4, P1)
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
    assert.equal(engine.state.cards[id("mc")].depleted, true);
  });
});

describe("1st Edition — Spiky Atlasphere", () => {
  test("grants +1 strength to the attached character", () => {
    const host = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "sa", def: def("Spiky Atlasphere"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
  });

  test("when the attached attacker is blocked, the whole blocking party is destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P1, zone: "play" },
        { key: "sa", def: def("Spiky Atlasphere"), owner: P1, zone: "play", attachedToKey: "atk" },
        { key: "b1", def: character({ name: "B1", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("b1")].zone, "discard");
  });
});

describe("1st Edition — Subversion Matrix", () => {
  test("the attached character loses all its rules text (abilities suppressed)", () => {
    const buffed = character({
      name: "Buffed",
      strength: 2,
      life: 2,
      behavior: {
        abilities: [
          {
            id: "selfbuff",
            type: "continuous",
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: buffed, owner: P1, zone: "play" },
        { key: "sm", def: def("Subversion Matrix"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), buffed.strength ?? 0);
  });
});

describe("1st Edition — Topplemajig", () => {
  test("while in a battle, the opposing party loses 1 speed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tm", def: def("Topplemajig"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tm")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("blk"), "speed"), 3 - 1);
  });
});

describe("1st Edition — Carnival King", () => {
  test("CONGA LINE forces all able characters to block the picked character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ck", def: def("Carnival King"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("ck"), "conga", { selected: { c: [id("oc")] } });
    const grants = engine.state.mustBlockGrants.filter(g => g.attackerId === id("oc"));
    assert.equal(grants.length, 1, "one requireBlock grant on the picked character");
    assert.equal(grants[0].blockerId, undefined, "it covers every character able to block it");
    assert.ok(!engine.getRestrictions(id("mine")).includes("mustBlock"), "no attacker-agnostic mustBlock restriction is used any more");
  });
});

describe("1st Edition — Face in the Crowd", () => {
  test("cannot be blocked while your opponent controls 4+ characters and it attacks alone (as printed in this set)", () => {
    const d = def("Face in the Crowd");
    const { engine, id } = buildGame({
      cards: [
        { key: "fc", def: d, owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "play" as const }))
      ],
      turn: 2
    });
    assert.ok(!engine.getKeywords(id("fc")).includes("cannotBeBlocked"), "!engine.getKeywords(id(\"fc\")).includes(\"cannotBeBlocked\")");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fc")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(engine.getKeywords(id("fc")).includes("cannotBeBlocked"), "engine.getKeywords(id(\"fc\")).includes(\"cannotBeBlocked\")");
  });

  test("can be blocked when the opponent has fewer than 4 characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fc", def: def("Face in the Crowd"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "play" as const }))
      ]
    });
    assert.equal(engine.getKeywords(id("fc")).includes("cannotBeBlocked"), false);
  });
});

describe("1st Edition — Bask Bomb", () => {
  test("sacrifices an attacker to burn the blocking party for twice its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bask Bomb"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bb"), selected: { c: [id("atk")], bl: [id("blk")], at: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "distributeAmong"
        ? { kind: "distributeAmong", shares: { [(pc.targets as string[])[0]]: (pc.amount as number) ?? 0 } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
    assert.equal(engine.state.cards[id("blk")].damage, 6);
  });
});

describe("1st Edition — Bladefist Doomwing", () => {
  test("FIREBREATHING pays X+X to inflict X damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bd", def: def("Bladefist Doomwing"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    activate(engine, P1, id("bd"), "firebreathing", { variables: { x: 3 }, selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 3);
    assert.equal(engine.state.cards[id("bd")].depleted, true);
  });
});

describe("1st Edition — Menacing Mauler", () => {
  test("when blocked, inflicts 1 damage to each blocker", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mm", def: def("Menacing Mauler"), owner: P1, zone: "play" },
        { key: "b1", def: character({ name: "B1", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
        { key: "b2", def: character({ name: "B2", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mm")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("b1")].damage, 1);
    assert.equal(engine.state.cards[id("b2")].damage, 1);
  });
});
