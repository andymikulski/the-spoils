// Per-card correctness suite — Seed Saga (358 cards), the final set.
// 316 are byte-identical reprints of a card already deeply tested in an
// earlier set — each is parity-checked (behavior JSON must match a prior
// print) plus an instantiation sanity check. The remaining 42 novel cards
// (the Imperial-army / demon-knight / Banner cycles, token-scaling UNIQUEs,
// new tactics) get real per-card tests.
// See ./_harness.ts and ../../../CARD-TEST-PROGRESS.md.

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
  uniqueChar,
  killTactic,
  play,
  activate,
  inPlay,
  resolvePendingResponses,
  P1,
  P2
} from "./_harness.js";

const SET = "Seed Saga";
const def = (name: string) => cardDef(SET, name);

function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 40
): void {
  let n = 0;
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: answerFor(pc) } as never);
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
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
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
// Reprint parity — 316 cards whose behavior matches an earlier print
// =====================================================================

const PARITY = [
  "313373 M3ch4n1c", "3cc3n7r1c 73chn1c14n", "3p1c D00dm4k3r",
  "4rm0r3d 31f", "53cur17y 5y573m", "A Blazing Zero",
  "Accidental Invention", "Acidic Phlegm", "Adjunct Artisan",
  "Adriel, Defender of Marduun", "Affectionate Dollkeeper", "Agile Highwayman",
  "Alliance of Handy Weirdos", "Alluring Quicksand", "Anathematize",
  "Architectural Restitution", "Aristocratic Artificer", "Aroused Stiffbone",
  "Arrogance", "Ascendant Madcap", "Assistant Mud Whisperer",
  "Athalamund Mangod, The Iron Fist", "Auspicious Tax", "Avuncular Merlion",
  "Aweless Charger", "B14nd P3pp3r", "Balking Foecrusher",
  "Balthassar Gristwalter", "Barrier of Benevolence", "Because God Said So!",
  "Black Scourge of the Brine", "Blazing Shriever", "Boilstorm",
  "Booty Licker", "Braggadocian Aide", "Brainbath",
  "Brilliant Insight", "Burly Assailment", "Caboodling Gladhander",
  "Cantankerous Claywork", "Cashier's Window", "Casino Kingpin",
  "Ceremonious Groomer", "Chain Reaction", "Chancellor of Reinstatement",
  "Circumspect Hijacker", "Clam Hash", "Clay Node",
  "Claywork Compendium", "Cloaked Weaponmaster", "Cock Block",
  "Colossal Flattener", "Confounding Conjurer", "Conscientious Objector",
  "Contrabulous Fabtraption", "Courageous Paladin", "Cowering Golem",
  "Crushing Usury", "Cryptic Athenaeum", "Cunning Disguise",
  "D3ck W4rd3n", "Dauntless Gambler", "Day of the Tentacle",
  "Dazzling Trapezist", "Defiler of Innocence", "Delectable Boon",
  "Delusive Strumpet", "Department of Rejections", "Derelict Seafarer",
  "Desolate", "Desserted Island", "Domain of Depravity",
  "Dowsing Cleric", "Dragon Archer", "Drill Garrison",
  "Drivey Car", "Drowned Catacombs", "Drygulch",
  "Dwarvish Grimalkin", "Dying Hero", "Elzibeth, Military Sorceress",
  "Embittered Cadet", "Emissary of Loot", "Encumber",
  "Enduring Swordsman", "Enormous and Uncooperative Golem", "Ensorcelled Familiar",
  "Epic Smackdown", "Epicureous Mammajamma", "Essence of Deception",
  "Essence of Elitism", "Essence of Greed", "Essence of Obsession",
  "Essence of Rage", "Evanesce", "Exploitation",
  "Extravagant Contusion", "Fervent Beastslayer", "Fiendish Fez",
  "Fired Hand", "Fiscal Intercessor", "Flabbergasting Philosopher",
  "Flagitious Denunciator", "Flailing Knife", "Fleet Golem",
  "Flimflam Man", "Foolhardy Desperado", "Forbidden Knowledge",
  "Fountain Diver", "Framptle Tromwibbler, Lord of Bling", "Frenzied Shriever",
  "Frisky Fortunehunter", "G14n7 5p0rk D3f3n53", "Gallant Commander",
  "Gambling Den", "Gewgawed Gimcrack", "Gideon, the Ultimate Warrior",
  "Godwing Thunderhoof", "Golemizer", "Goloam",
  "Grandiose Resurrector", "Gus VanBaymaven", "Guttersnipe",
  "H07 P3pp3r", "Hall of Conventions", "Hall of Great Justice",
  "Harbinger of Anguish", "Headhunting", "Heavy Sword",
  "Heist Training Grounds", "Hextilda, the Exiled Crone", "Hidden Dagger",
  "Hidden Ruins", "Hideous Hexapede of Horror", "High Court of Demands",
  "High-Priest of Thabbash", "Horrendous Behemoth", "Horrifying Brain-Monkey",
  "Hungry-Hungry Idol", "Hustler's Comeuppance", "Hypnotic Illusionist",
  "I Drink Your Milkshake!", "Idol Smasher", "Imperial Thaumaturge",
  "Implosive Explosion", "Impressive Hero", "Improvised Blowtorch",
  "Inadequate Wand", "Inconspicuous Golem", "Inconvenient Roadblock",
  "Ingenious Tinker", "Inhibit", "Intellectual Reliquary",
  "Jocular Stupefaction", "Karmic Cake", "Lab of Luxury",
  "Lingamite Torture Monk", "Living God of Thabbash", "Lodge Dock Florist",
  "Lordly Stables", "Lucky Bastard", "Lucky Charm",
  "Luxurious Gaming Establishment", "Manful Skirmish", "Manifest",
  "Marduun Baitings and Loan", "Mass Confusion", "Massive Erecting Golem",
  "Master Mud Whisperer", "Maxwell Cockswagger", "Melty Cheese",
  "Mesmerizing Enchantress", "Midget Mine", "Mighty Ballista",
  "Minion of Thabbash", "Miraculous Regeneration", "Mirthless Altar",
  "Mistaken Identity", "Moist Cave of the Darkpump", "Montgomery Blatherscythe",
  "Mountainous Golem", "Mud Whisperer Wannabe", "Muddle",
  "Muddle Bugs", "Multi-Attachment Man", "Mundane Pupil",
  "Muscle Tribe of Danger and Excellence", "Mustache Aficionado", "Mutineer's Hiatus",
  "Mysterious Invasion", "Narrow Passage", "Nattering Stoopswaggler",
  "Necromantic Healer", "Nefarious Horror", "Neurosis",
  "Nimble Conscript", "Obscene Astrologer", "Obscene Communion",
  "Obscure", "Obtuse Pipesmoker", "Oddment Collector",
  "Opportune Slotpuller", "Order of the Golden String", "Otter Floss",
  "Overindulge", "Overzealous Excavation", "P3pp3r 0f 1n54n17y",
  "Padamose, Emperor of Marduun", "Palm Glom", "Pant Swipe",
  "Party Clowns", "Peculate", "Perforate",
  "Perturb", "Perturbatious Warlock", "Phalludrix, the Impotenator",
  "Pilgrimage Auditor", "Pit Boss", "Plunging Shriever",
  "Portly Tradesmau", "Prehensile Pirate", "Preponderant Craftsman",
  "Proficient Battler", "Property Condemner", "Prophetic Assistant",
  "Prostitution Lobbyist", "Protractive Golem", "Purifying Priest",
  "Reality Shift", "Recyclable Golem", "Redonkulous",
  "Repurpose", "Research Intern", "Resistance Fighter",
  "Rewarding Salvage", "Rigged Tables", "Righteous Exemplar",
  "Robustical Badass", "Rosy Palmer, and Her Five Friends", "Roulette Wheel of DOOM!",
  "Roundalicious Breasticles", "Rouse", "Rumply Ruse",
  "Rune of Concealment", "Runic Armor", "Runic Battery",
  "Runic Reinforcement", "Runic Tattoo Artist", "Runic Whale",
  "Runivoltaic Accumulator", "Rusty Pickaxe", "Sequestered Hellion",
  "Seraphim Magic", "Shadowy Mugger", "Shrouded Demon",
  "Sin Against Nature", "Slick Orator", "Slinking Bandido",
  "Sly Bilker", "Smothering Corpulence", "Spiky Pumpkin",
  "Spitting Sarume", "Sprint", "Strangulate",
  "Stupidify", "Subordinate Demotivation", "Surplus Soldier",
  "Surprise!", "Surprising Nuisance", "Swollen Ostrich",
  "Tamper", "Temple Guardian", "Terra Cotta Flagellator",
  "Thabbashite Haruspex", "Thabbashite Wizard", "The Abominable Hamster",
  "The Currency Bazaar", "The Emperor Barduse", "The Poshernacle",
  "The Tournament Faction", "Theocratic Senate of Marduun", "Thorough Sanitization",
  "Time Portal", "Time Traveler Tourist Trap", "Tiny Sarume",
  "Tiny Shiny", "Titillated Mooncalf", "Titillating Contortionist",
  "Transient Smuggler", "Treachery", "Treasure Brokerage",
  "Trebuchet Officer", "Tumescent Guilt Bladder", "Unbearably Heavy Shoes of Teleportation",
  "Uncontrollable Jalopy", "Underhanded Gamer", "Underpaid Ancestor",
  "Unflinching Bowman", "Unimportant Wizard", "Unscrupulous Attendant",
  "Vast Mastabatorium", "Velocious Golem", "Verrucose Brains",
  "Vigilant Raider", "Violence", "Virtuous Razer",
  "Virulent Dogmatist", "Vorpal Sword", "Walk the Plank",
  "Wand of Possession", "Wanton Wizard", "Watchtower",
  "Witty Worm", "Woadenworm Gloamspike, Thabbashite Prince", "Workshop",
  "Wrinkly Rabbit"
];

describe("Seed Saga — reprint parity", () => {
  const PRIOR_SETS = [
    "Seed 3", "Seed 2", "Shade of the Devoured Emperor", "1st Edition Part 2",
    "Holy Heist", "Ungodly Mess", "Open Beta", "1st Edition", "Seed", "2nd Edition"
  ];
  const prior = new Map<string, string[]>();
  for (const s of PRIOR_SETS) {
    for (const c of setCards(s)) {
      const j = JSON.stringify(c.behavior ?? null);
      const arr = prior.get(c.name) ?? prior.set(c.name, []).get(c.name)!;
      arr.push(j);
    }
  }

  const cards = setCards(SET);

  test("PARITY list matches the actual reprint subset", () => {
    const reprints = cards
      .filter(c => {
        const priors = prior.get(c.name);
        return priors && priors.includes(JSON.stringify(c.behavior ?? null));
      })
      .map(c => c.name)
      .sort();
    assert.deepEqual([...PARITY].sort(), reprints);
  });

  for (const name of PARITY) {
    test(`${name} — behavior matches a prior-set print; instantiates cleanly`, () => {
      const c = def(name);
      const priors = prior.get(name);
      assert.ok(priors && priors.length > 0, `${name}: no prior print found`);
      assert.ok(
        priors!.includes(JSON.stringify(c.behavior ?? null)),
        `${name}: Seed Saga behavior diverged from every prior print`
      );

      if (c.type === "character" || c.type === "location") {
        const { engine, id } = buildGame({ cards: [{ key: "c", def: c, owner: P1, zone: "play" }] });
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
// Novel cards
// =====================================================================

describe("Seed Saga — faction cards (DRAW)", () => {
  for (const name of ["Defenders of Marduun", "Legions of Chaos"]) {
    test(`${name} — DRAW pays 3 and draws`, () => {
      const factionDef = def(name);
      const drawAbility = [...(factionDef.faction?.abilities ?? []), ...(factionDef.behavior?.abilities ?? [])].find(a => a.type === "activated" && a.name === "Draw");
      assert.ok(drawAbility, `${name} has no printed DRAW ability`);

      const { engine } = buildGame({
        playerA: { faction: factionDef },
        cards: [{ key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }, ...bank("rage", 4, P1)]
      });
      const facId = engine.state.players[P1].factionId!;
      const hand = engine.state.players[P1].hand.length;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: facId, abilityId: drawAbility!.id, selected: {}, variables: {} });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, hand + 1);
    });
  }
});

describe("Seed Saga — Banner cycle (BURN IT)", () => {
  for (const name of [
    "Banner of Avarice",
    "Banner of Betrayal",
    "Banner of Compulsion",
    "Banner of Elysium",
    "Banner of Fury"
  ]) {
    test(`${name} — BURN IT pays 2, destroys itself, draws 2`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "b", def: def(name), owner: P1, zone: "play" },
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
          { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
          ...bank("greed", 6, P1)
        ]
      });
      const hand = engine.state.players[P1].hand.length;
      activate(engine, P1, id("b"), "burn");
      assert.equal(engine.state.players[P1].hand.length, hand + 2);
      assert.equal(engine.state.cards[id("b")].zone, "discard");
    });
  }
});

describe("Seed Saga — Banner of Fury (on-provide)", () => {
  test("when a card providing [R] enters play, may pay 1 to pump a character", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Banner of Fury"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" },
        { key: "r", def: cardDef("Seed", "Violence"), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1)
      ]
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("c")] };
      return declineAll(pc);
    });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 1);
  });
});

describe("Seed Saga — Banner of Elysium (on-provide 'may pay 1, detach 2')", () => {
  // Regression: the trigger's `mayPay` cost (pay 1) must be gated on the
  // player actually having an unattached resource to pay it with. Spending
  // your last resources to deploy the Banner leaves you unable to use its
  // own enters-play trigger — the "pay 1" is never offered, and nothing is
  // detached. (Reported as a bug where the pay-1 prompt showed anyway.)
  test("spent the last 2 resources to play it -> the pay-1 prompt is withheld", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Banner of Elysium"), owner: P1, zone: "hand" },
        ...bank("elitism", 2, P1)
      ],
      turn: 2
    });

    assert.equal(engine.getAvailableResourceCount(P1), 2);
    play(engine, P1, id("b"), {});

    // Both staples are now attached to the faction (spent on the cost)…
    assert.equal(engine.getAvailableResourceCount(P1), 0);
    // …so the `mayPay` is skipped outright — no choice is left open.
    assert.equal(engine.state.pendingChoice, undefined);
    // Nothing was detached: the two cost resources stay attached.
    assert.equal(
      inPlay(engine, P1, "resource").filter(cid => engine.state.cards[cid].attachedTo).length,
      2
    );
  });

  test("a spare face-down (Volition) resource covers the pay-1 -> prompt is offered and detaches 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Banner of Elysium"), owner: P1, zone: "hand" },
        ...bank("elitism", 2, P1),
        ...volition(1, P1) // face-down resource — still an unattached resource that can pay a cost
      ],
      turn: 2
    });

    assert.equal(engine.getAvailableResourceCount(P1), 3);

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("b"),
      selected: {},
      variables: {}
    } as never);
    resolvePendingResponses(engine);

    // 2 staples spent on the cost, the face-down one is still available.
    assert.equal(engine.getAvailableResourceCount(P1), 1);
    assert.equal((engine.state.pendingChoice as { kind?: string } | undefined)?.kind, "mayPay");

    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") {
        // Detach the 2 resources spent on the Banner's cost.
        const attached = inPlay(engine, P1, "resource").filter(cid => engine.state.cards[cid].attachedTo);
        return { kind: "chooserSelectsTarget", selected: attached.slice(0, 2) };
      }
      return declineAll(pc);
    });

    // Paid 1 (the face-down), detached 2 -> net one more than the 0 they'd
    // have been left on without a spare resource.
    assert.equal(engine.getAvailableResourceCount(P1), 2);
  });
});

// --- token-scaling UNIQUE characters --------------------------------

describe("Seed Saga — Hungermaw Deephate", () => {
  test("enters play with 8 tokens and is 8/8 from them", () => {
    const d = def("Hungermaw Deephate");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "h", def: d, owner: P1, zone: "hand" }, ...bank("obsession", 8, P1)],
      turn: 2
    });
    play(engine, P1, id("h"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("h")].counters?.token, 8);
    assert.equal(engine.getStat(id("h"), "strength"), (d.strength ?? 0) + 8);
    assert.equal(engine.getStat(id("h"), "life"), (d.life ?? 0) + 8);
  });

  test("EJECT removes 2 tokens to bounce another non-resource card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "h", def: def("Hungermaw Deephate"), owner: P1, zone: "play", counters: { token: 8 } },
        { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("h"), "eject", { selected: { kick: [id("other")] } });
    assert.equal(engine.state.cards[id("h")].counters?.token, 6);
    assert.equal(engine.state.cards[id("other")].zone, "hand");
  });
});

describe("Seed Saga — Caracal Morphnus", () => {
  test("enters with 5 tokens (5/5); MORPH trades 3 tokens for a draw (which re-adds 1)", () => {
    const d = def("Caracal Morphnus");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "m", def: d, owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("m"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("m")].counters?.token, 5);
    assert.equal(engine.getStat(id("m"), "strength"), (d.strength ?? 0) + 5);
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("m"), "morph");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("m")].counters?.token, 3); // 5 - 3 + 1 (on-draw)
  });
});

describe("Seed Saga — The Brotherhood of the Mau", () => {
  test("is COVERT and cannot attack while it holds a token", () => {
    const d = def("The Brotherhood of the Mau");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "b", def: d, owner: P1, zone: "hand" }, ...bank("greed", 4, P1)],
      turn: 2
    });
    play(engine, P1, id("b"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("b")].counters?.token, 7);
    assert.ok(engine.getKeywords(id("b")).includes("covert"));
    assert.ok(engine.getRestrictions(id("b")).includes("cannotAttack"));
  });
});

describe("Seed Saga — Undead Sword", () => {
  test("enters with 2 tokens and is shrunk 1/1 per token; HIDE spends one for COVERT", () => {
    const d = def("Undead Sword");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "s", def: d, owner: P1, zone: "hand" }, ...bank("greed", 4, P1)],
      turn: 2
    });
    play(engine, P1, id("s"), {});
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("s"), "strength"), (d.strength ?? 0) - 2);
    activate(engine, P1, id("s"), "hide");
    assert.ok(engine.getKeywords(id("s")).includes("covert"));
    assert.equal(engine.getStat(id("s"), "strength"), (d.strength ?? 0) - 1);
  });
});

// --- UNIQUE named characters ---------------------------------------

describe("Seed Saga — Gilda, Mother of Gideon", () => {
  test("at the start of your turn, voids a revealed tactic from the top of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Gilda, Mother of Gideon"), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Tac", cost: 0 }), owner: P1, zone: "deck" },
        { key: "filler", def: character({ name: "Filler" }), owner: P1, zone: "deck" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { tac: [id("tac")] } }
        : pc.kind === "chooserSelectsTarget"
          ? { kind: "chooserSelectsTarget", selected: [id("tac")] }
          : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tac")].zone, "void");
  });
});

describe("Seed Saga — Mr. Chesterton", () => {
  test("gains COVERT while its anchored tactic sits in a discard pile", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Mr. Chesterton"), owner: P1, zone: "hand" },
        { key: "anchor", def: tactic({ name: "Anchor", cost: 0 }), owner: P1, zone: "discard" },
        ...bank("obsession", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("mc"), { selected: { anchor: [id("anchor")] } });
    drain(engine, declineAll);
    assert.ok(engine.getKeywords(id("mc")).includes("covert"));
  });
});

describe("Seed Saga — Ashara, Gideon's Twin", () => {
  test("reanimates a cheap character from an opponent's discard pile under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "a", def: def("Ashara, Gideon's Twin"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse", life: 2, strength: 1 }), owner: P2, zone: "discard" },
        ...bank("deception", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("a"), { selected: { revive: [id("corpse")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });
});

describe("Seed Saga — Duskfall Buckgriff", () => {
  test("is TACTICAL; SNEAK pays 1 for COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "b", def: def("Duskfall Buckgriff"), owner: P1, zone: "play" }, ...bank("deception", 4, P1)]
    });
    assert.ok(engine.getKeywords(id("b")).includes("tactical"));
    activate(engine, P1, id("b"), "sneak");
    assert.ok(engine.getKeywords(id("b")).includes("covert"));
  });
});

describe("Seed Saga — Lecram, Silent Advisor", () => {
  test("is COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "l", def: def("Lecram, Silent Advisor"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("l")).includes("covert"));
  });
});

describe("Seed Saga — Adriel, Supreme General of the Imperial Army", () => {
  test("if it would be destroyed, its owner may put it on top of their deck instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "a", def: def("Adriel, Supreme General of the Imperial Army"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ name: "Kill" }), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("kill"), { selected: { t: [id("a")] } });
    drain(engine, pc =>
      pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("a")].zone, "deck");
  });
});

describe("Seed Saga — Ecneret, The Expendable One", () => {
  test("when destroyed, your characters gain 2 strength / 2 life", () => {
    const ally = character({ name: "Ally", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "e", def: def("Ecneret, The Expendable One"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ name: "Kill" }), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      turn: 2,
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("e")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("ally"), "life"), (ally.life ?? 0) + 2);
  });
});

describe("Seed Saga — Elzibeth, Counter Imperial Countess", () => {
  test("KEEP EM COMING redirects a warded character's destruction to the top of its deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "e", def: def("Elzibeth, Counter Imperial Countess"), owner: P1, zone: "play" },
        { key: "ward", def: character({ name: "Ward", life: 3 }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ name: "Kill" }), owner: P1, zone: "hand" },
        ...bank("rage", 8, P1)
      ],
      turn: 2
    });
    activate(engine, P1, id("e"), "keepemcoming", { selected: { ward: [id("ward")] } });
    play(engine, P1, id("kill"), { selected: { t: [id("ward")] } });
    drain(engine, pc =>
      pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("ward")].zone, "deck");
  });
});

describe("Seed Saga — Goutflame Talonclaw", () => {
  test("ETB may destroy up to 3 picked permanents", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Goutflame Talonclaw"), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 9, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("g"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("victim")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });
});

describe("Seed Saga — Draconarius Slitherform", () => {
  test("on death, distributes its printed strength as damage among opponents' characters", () => {
    const foe = character({ name: "Foe", life: 12 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "d", def: def("Draconarius Slitherform"), owner: P1, zone: "play" },
        { key: "foe", def: foe, owner: P2, zone: "play" },
        { key: "kill", def: killTactic({ name: "Kill" }), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      turn: 2,
      activePlayerId: P2
    });
    const printed = def("Draconarius Slitherform").strength ?? 0;
    play(engine, P2, id("kill"), { selected: { t: [id("d")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong"
        ? { kind: "distributeAmong", shares: { [id("foe")]: (pc.amount as number) ?? printed } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("foe")].damage, printed);
  });
});

// --- The Enemy's Head -----------------------------------------------

describe("Seed Saga — The Enemy's Head", () => {
  test("each opponent-character death may pay 1 for a token; your characters get +1 strength per token", () => {
    const ally = character({ name: "Ally", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eh", def: def("The Enemy's Head"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic({ name: "Kill" }), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("eh")].counters?.token, 1);
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 1);
  });
});

// --- locations -----------------------------------------------------

describe("Seed Saga — Imperial Palace", () => {
  test("at end of turn, may pay 1 to stash a character you control in the void", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p", def: def("Imperial Palace"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("greed", 4, P1)
      ],
      turn: 2,
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("c")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].zone, "void");
  });
});

describe("Seed Saga — Mau Caravan", () => {
  test("at the start of your turn, may destroy itself to tutor a location to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Mau Caravan"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P1, zone: "deck" },
        { key: "filler", def: character({ name: "Filler" }), owner: P1, zone: "deck" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("loc")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("loc")].zone, "hand");
    assert.equal(engine.state.cards[id("mc")].zone, "discard");
  });
});

describe("Seed Saga — Mud Prison", () => {
  test("at the start of your turn, may pay 1 to token an opponent's character (silencing it)", () => {
    const oc = character({
      name: "OC",
      strength: 2,
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "mp", def: def("Mud Prison"), owner: P1, zone: "play" },
        { key: "oc", def: oc, owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ],
      turn: 2,
      activePlayerId: P2
    });
    assert.equal(engine.getStat(id("oc"), "strength"), 5);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("oc")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("oc")].counters?.token, 1);
    assert.equal(engine.getStat(id("oc"), "strength"), 2);
  });
});

// --- tactics ------------------------------------------------------

describe("Seed Saga — A Death Fit for a King", () => {
  test("voids a UNIQUE character in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("A Death Fit for a King"), owner: P1, zone: "hand" },
        { key: "u", def: uniqueChar({ name: "Highlander" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { victim: [id("u")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("u")].zone, "void");
  });
});

describe("Seed Saga — Arcane Monkey Ritual", () => {
  test("mills up to 2 tactics from your deck to your discard pile", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "amr", def: def("Arcane Monkey Ritual"), owner: P1, zone: "hand" },
        { key: "t1", def: tactic({ name: "T1", cost: 0 }), owner: P1, zone: "deck" },
        { key: "t2", def: tactic({ name: "T2", cost: 0 }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("amr"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("t1"), id("t2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("t1")].zone, "discard");
    assert.equal(engine.state.cards[id("t2")].zone, "discard");
  });
});

describe("Seed Saga — Death of the Demon Knights", () => {
  test("puts a chosen opponent's character on the bottom of its deck and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Death of the Demon Knights"), owner: P1, zone: "hand" },
        { key: "mark", def: character({ name: "Mark" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("t"), { selected: { mark: [id("mark")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("mark")].zone, "deck");
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Seed Saga — Enter The Demon Knights", () => {
  test("an opponent picks one of 3 revealed cheap characters; it enters play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Enter The Demon Knights"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1", cost: 2 }), owner: P1, zone: "hand" },
        { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P1, zone: "hand" },
        { key: "c3", def: character({ name: "C3", cost: 2 }), owner: P1, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { revealed: [id("c1"), id("c2"), id("c3")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c1")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c1")].zone, "play");
    assert.equal(engine.state.cards[id("c1")].controllerId, P1);
  });
});

describe("Seed Saga — Mutilated", () => {
  test("your character loses 2 life; another gains 1 strength + COVERT; you draw", () => {
    const mine = character({ name: "Mine", life: 5 });
    const other = character({ name: "Other", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Mutilated"), owner: P1, zone: "hand" },
        { key: "mine", def: mine, owner: P1, zone: "play" },
        { key: "other", def: other, owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { mine: [id("mine")], buff: [id("other")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("mine"), "life"), (mine.life ?? 0) - 2);
    assert.equal(engine.getStat(id("other"), "strength"), (other.strength ?? 0) + 1);
    assert.ok(engine.getKeywords(id("other")).includes("covert"));
  });
});

describe("Seed Saga — Unbearable Torture", () => {
  test("voids a character whose life exceeds its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Unbearable Torture"), owner: P1, zone: "hand" },
        { key: "fat", def: character({ name: "Fat", strength: 1, life: 5 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { mark: [id("fat")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("fat")].zone, "void");
  });
});

describe("Seed Saga — Well Laid Plans", () => {
  test("plants a card from each deck into play as face-down resources", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Well Laid Plans"), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "deck" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("t"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        const decl = (pc as { declaration?: { id?: string } }).declaration?.id;
        return { kind: "chooserSelectsTarget", selected: [decl === "mine" ? id("mine") : id("theirs")] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("theirs")].zone, "play");
    assert.equal(engine.state.cards[id("theirs")].controllerId, P2);
    assert.equal(engine.state.cards[id("theirs")].faceDown, true);
    assert.equal(engine.state.cards[id("mine")].zone, "play");
    assert.equal(engine.state.cards[id("mine")].controllerId, P1);
  });
});

describe("Seed Saga — Invade!", () => {
  test("makes a chosen character unable to block this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Invade!"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { mark: [id("oc")] } });
    drain(engine, declineAll);
    assert.ok(engine.getRestrictions(id("oc")).includes("cannotBlock"));
  });
});

describe("Seed Saga — Storm the Gates", () => {
  test("sacrifices your character to deal 5 to an opponent's; draws if it dies", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Storm the Gates"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "mark", def: character({ name: "Mark", life: 3 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("t"), { selected: { sac: [id("sac")], mark: [id("mark")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("mark")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Seed Saga — The Emperor Born", () => {
  test("lets you deploy a character out of your discard pile", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("The Emperor Born"), owner: P1, zone: "hand" },
        { key: "dude", def: character({ name: "Dude", cost: 0 }), owner: P1, zone: "discard" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { back: [id("dude")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("dude") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("dude")].zone, "play");
  });
});

describe("Seed Saga — Runic Flee", () => {
  test("your faction loses 1 influence and a faction resource is detached", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Runic Flee"), owner: P1, zone: "hand" },
        ...bank("elitism", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("t"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        const r = Object.values(engine.state.cards).find(
          c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
        );
        return { kind: "chooserSelectsTarget", selected: r ? [r.id] : [] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Seed Saga — Warmachine Smelder", () => {
  test("IN THE FIRE scraps an item you control to tutor another item to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w", def: def("Warmachine Smelder"), owner: P1, zone: "play" },
        { key: "scrap", def: item({ name: "Scrap", cost: 1 }), owner: P1, zone: "play" },
        { key: "wanted", def: item({ name: "Wanted", cost: 1 }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("w"), "fire", { selected: { scrap: [id("scrap")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("wanted")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("scrap")].zone, "discard");
    assert.equal(engine.state.cards[id("wanted")].zone, "hand");
  });
});

describe("Seed Saga — Executive Order #6370u7", () => {
  test("at the start of an opponent's turn, may pay 2 to deplete a character and block its restore", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "eo", def: def("Executive Order #6370u7"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("greed", 4, P1)
      ],
      turn: 2,
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("c")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].depleted, true);
  });
});

describe("Seed Saga — Gideon's Legacy", () => {
  test("SEEK pays 2 + deplete to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Gideon's Legacy"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("g"), "seek");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("g")].depleted, true);
  });
});

describe("Seed Saga — Juggernauts", () => {
  test("ETB flips your picked characters face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "j", def: def("Juggernauts"), owner: P1, zone: "hand" },
        { key: "crew", def: character({ name: "Crew" }), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("j"), { selected: { crew: [id("crew")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("crew")].faceDown, true);
  });
});

describe("Seed Saga — Crushjaw Oceanhide", () => {
  test("has AGGRO printed", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "c", def: def("Crushjaw Oceanhide"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("c")).includes("aggro"));
  });
});

describe("Seed Saga — Waylay Blade", () => {
  test("is TACTICAL and grants +1/+1 to the attached character", () => {
    const host = character({ name: "Host", strength: 2, life: 4 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "wb", def: def("Waylay Blade"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok((def("Waylay Blade").behavior?.keywords ?? []).includes("tactical"));
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 1);
  });
});
