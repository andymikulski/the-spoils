import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  setCards,
  developFaction,
  character,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2
} from "./_harness.js";

// 2nd Edition is entirely reprints of Open Beta / 1st Edition / 1st Edition
// Part 2. Each card is parity-checked: its behavior JSON must byte-match a
// same-named card in one of those sets (which carry the deep functional
// tests), plus an instantiation sanity check. Smear Campaign gets a real
// test (its 2nd Ed print had drifted from the fixed recursion-guarded
// version and was re-synced).

const SET = "2nd Edition";
const def = (name: string) => cardDef(SET, name);

const NAMES = [
  "0p3r4710n 1337 H4x0rz", "12 Man Brunch of Doom", "1337!",
  "3p1ph4ny 31f", "4p7 31f", "633fy 31f",
  "700160x 31f", "A Series of Tubes", "Acuminous Gigantitect",
  "Adroit Marauder", "Air Travel", "All-Nighter",
  "Ambiguity Inhibitor", "Ambuscade", "Ameliorate",
  "Anesthetizing Opulence", "Arcana Department", "Arcana Experiment",
  "Arcanist's Almanac", "Arcanology Recruitment Officer", "Arena Quarter-Finalist",
  "Armored Keep", "Ashes of Zenobia", "Assimilation Center",
  "Auction House", "Barbaric Rifleman", "Basic Node",
  "Bask Bile", "Beatrix Winterbottom", "Befuddling Beggar",
  "Berserker Corps", "Bipolar Sarcophyle", "Bladefist Doomwing",
  "Bloodcurdling Bulldozer", "Blow Up", "Brummagem Jewelry",
  "Callow Liegeman", "Card Counter", "Carnival King",
  "Cash Out", "Catastrophic Betrayal", "Cheats McGuillicutty",
  "Clandestine Resort", "Class Action Defender", "Cloaked Creeper",
  "Clockman Pickpocket", "Concealed Goon", "Contriving Engineer",
  "Counter Attack", "Crazed Deputy", "Creaky Old Swordsman",
  "Cute Cutpurse", "Dandy Day-Trader", "Deadly Striker",
  "Deceptive Muddler", "Degenerate Molestation", "Dethmürderblüdgeon, the Craghammer",
  "Discommodiousness", "Dock Sentinel", "Downsizing",
  "Dragon Catheter", "Dragon Juice", "Dragon Rider",
  "Dragon Tank", "Dragon's Quarters", "Early Retirement",
  "Eccentric Inquisition", "Ecto-Distillation", "Ectological Hazard Suit",
  "Ectypal Stave", "Elbow Dropper", "Eldridge Gosche",
  "Elite Team Registration", "Embezzling Bookkeeper", "Emphatic Ecto-Manipulator",
  "Entangle", "Entrancing Harlot", "Entry-Level Employee",
  "Epic Turncoat Maneuver", "Epiphany Ball", "Erotic Assassin",
  "Escrow Office", "Executive Poaching", "Exploding Sock Puppet!",
  "Explosive Fury", "Extortify", "Eye Gouge",
  "Face in the Crowd", "Ferrous Ferret", "First Unified Market of Abstract Secure Theoreticals",
  "Flaming Barduse", "Fleshripping Scenepuller", "Fool's Gold",
  "Forced Recruitment", "Forcible Depredator", "Forget",
  "Free Trade Agreement", "Furtive Investor", "Fwing!",
  "Gargantuan Garbler", "Ghostly Auditor", "Gigamajig",
  "Gnat", "Gold Summit", "Gore Engine",
  "Grand Theft All", "Guardforce Alpha Prime 31f", "Guardforce Alpha Prime H4x0r",
  "Guardforce Morphmajig", "Hammer Smash", "Hangdog Alley",
  "Hasty Sarcophyle", "Headlong Purloiner", "Heavy Plating",
  "Heirloom Incinerator", "Heist Planner", "Hidden Sandwich",
  "Hidden Sniper", "Hired Goons", "Hollow Moose",
  "Horsemajig of the Apocalypse - Death", "Horsemajig of the Apocalypse - Famine", "Horsemajig of the Apocalypse - Pestilence",
  "Horsemajig of the Apocalypse - War", "Hub Node", "Hulking Vigilante",
  "Humiliating Torture Apparatus", "Hyperphagic Sarcophyle", "Impeccable Timing",
  "Impulsive Abductress", "Incriminating Photograph", "Insidious Ecto-Manipulator",
  "Invent", "Irresistible Bribe", "Jackmove",
  "Jacque's Trap", "Jo Ciendeilio", "Kaiser Wave",
  "Keen Stratagem", "Key Man", "Kinky Asp",
  "Land Shark", "Late Addition", "LeoKaiser",
  "Limited Liability", "Lugubrian Octopod", "Lugubrious Finger Trap",
  "Luteoderm Goliath", "Luteoderm Prototype", "Mafia Lawyer",
  "Maladjustment", "Manifold Quasi-Modal Steamwork", "Market Oracle",
  "Martial Artist", "Martial Arts Master", "Martial Arts Trainee",
  "Master Scavenger", "Master Thief", "Mau Party",
  "Mau Tough", "Menacing Mauler", "Mercenary's Creed",
  "Micromajig Avalanche", "Micromajig Maker", "Micromajig Master",
  "Micromajig Shipping Container", "Misappropriation Machine", "Moneychanger",
  "Morale Officer", "Murderous Commander", "Mutiny Grant",
  "Nasty Butler", "Nearby Serpent", "Needless Beating",
  "Obsessive Compulsion", "Odious Diva", "Ominous Oozling",
  "Omnidirectional Patrolmajig", "One-Legged Hopping Pogo-Bear", "Orgy Den Smoke Out",
  "Overinsured Figurehead", "Oversoon Lightfoot", "PantherKaiser",
  "Paralegal Prodigy", "Patent Enforcement", "Penetrate",
  "Pervasive Bodyguard", "Pettifogger", "Pillaging Pirate",
  "Pinch", "Plodding Brute", "Pluck",
  "Poisoned Blade", "Postmortem Debenture", "Precise Sabotage",
  "Prudent Thug", "Quotidian Assassination", "Quotidian Ejector",
  "Quotidian Misfire", "Quotidian Virtuoso", "Rabid Sarume",
  "Raging Bask", "Randolph von Macovawitz Spitoon III, Ltd.", "Rapine",
  "Real Estate Auctioneer", "Really Big Barduse", "Recapitulating Apparition",
  "Reckless Challenger", "Recollection Bazaar", "Red Raven",
  "Red Tape", "Reluctant Hiree", "Remember",
  "Repo Man", "Research Investment", "Resurrection Technician",
  "Reveille Tower", "Revivatate", "Ritual of the Knob & Pull",
  "Ritual of the Ominous Urn", "Ritual of the Shattering Teeth", "Rudo Mangod",
  "Rummaging Millipede", "Runic Cannon", "Runic Circuitry",
  "Runic Field Enhancer", "Ruthless Platoon", "Sadistic Colonel",
  "Samuel Gristwalter", "Scavengemajig", "Scout",
  "Scrag", "Secret Handshake", "Securitymajig",
  "Senior Research Assistant", "Servile Centipede", "Shocking Reappearance",
  "Shriever Attack", "Siege Machine", "Skewer",
  "Skimping Ecto-Manipulator", "Skin Suit", "Slingerang",
  "Smear Campaign", "Snake Eyes", "Sneaking Spitspider",
  "Sneaky Mansion", "Snooty Doorman", "Splattergun",
  "Spontaneous Displacement", "Stalwart Soldier", "Stolen Inspiration",
  "Subsection 5, Paragraph 12", "Subversion Matrix", "Sudden Osprey",
  "Suicide Squad", "Summary Judgment", "Swarm of Gnats",
  "Swashbuckler", "T Force 5 Megabrutemajig", "T Force 5 Megadudemajig",
  "T Force 5 Megascoutmajig", "Tactician Vacation", "Tad Disingenuous",
  "Target Practice", "Tax Attorney", "The Billionaire",
  "The Deranger", "The Garbageman", "The Ministry of Other Smaller Ministries",
  "The Whatever Device", "Thief Doyen", "Thundering Nilpha",
  "TigerKaiser", "Topplemajig", "Torrential Bleeder",
  "Toxic Cultivator", "Tremor Engine", "Tri-Pole Magnet",
  "Trip Wire", "Trophy Collector", "Two-Headed Coin",
  "Unexpected Boobysnake", "Union Leader", "Unnatural Alteration",
  "Unrelenting Ridicule", "Vander Malagut", "Venomous Sacspider",
  "Violating Anomaly", "Voidal Interference", "Voidal Nullification Chamber",
  "Voidal Observatory", "Voidal Perversion", "Voidal Poisoning",
  "Voidal Replication", "Warrior Prodigy", "Wild Boars",
  "Writ of Reclamation", "Wyrmfang Deathskull", "Yoink!"];

describe("2nd Edition — reprint parity", () => {
  const priorBySet = ["Open Beta", "1st Edition", "1st Edition Part 2"].flatMap(s =>
    setCards(s).map(c => [c.name, c] as const)
  );
  const prior = new Map<string, unknown[]>();
  for (const [name, c] of priorBySet) {
    (prior.get(name) ?? prior.set(name, []).get(name)!).push(c.behavior ?? null);
  }

  const cards = setCards(SET);

  test("NAMES list matches the actual 2nd Edition card set", () => {
    assert.deepEqual([...NAMES].sort(), cards.map(c => c.name).sort());
  });

  for (const c of cards) {
    test(`${c.name} — behavior matches a prior-set print; instantiates cleanly`, () => {
      const priors = prior.get(c.name);
      assert.ok(priors && priors.length > 0, `${c.name}: no Open Beta / 1st Edition / 1st Edition Part 2 print found`);
      const mine = JSON.stringify(c.behavior ?? null);
      assert.ok(
        priors!.some(b => JSON.stringify(b) === mine),
        `${c.name}: 2nd Edition behavior diverged from every prior print`
      );

      if (c.type === "character" || c.type === "location") {
        const { engine, id } = buildGame({
          cards: [{ key: "c", def: def(c.name), owner: P1, zone: "play" }]
        });
        for (const stat of ["strength", "life", "speed", "structure"] as const) {
          assert.equal(typeof engine.getStat(id("c"), stat), "number");
        }
        assert.doesNotThrow(() => engine.getKeywords(id("c")));
        assert.doesNotThrow(() => engine.getRestrictions(id("c")));
      }
    });
  }
});

describe("2nd Edition — Smear Campaign", () => {
  test("the attached character mirrors its damage to your faction exactly once", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "sc", def: def("Smear Campaign"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 8, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // host dealt 3 battle damage -> faction mirrors 3, and does NOT recurse
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});
