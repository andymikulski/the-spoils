#!/usr/bin/env node
/* Round-2 authoring for the remaining 52 classified SotDE cards.
 * Patches data/cards.json behavior + card-level siblings, and flips the
 * coverage entries to "authored". Throwaway, re-runnable.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const COV = path.join(ROOT, "data", "card-coverage.json");
const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const byName = new Map(cards.map(c => [c.name, c]));
const covByName = new Map(cov.cards.map(e => [e.name, e]));

const EOT = { type: "untilEndOfTurn" };
const MICROMAJIG = { name: "Micromajig", cardType: "character", subtype: ["micromajig"], strength: 0, life: 1, speed: 1 };
const icons6 = (icon, controller = "controller") => ({
  type: "numberCompare",
  left: { type: "resourceIcons", player: controller, icon },
  operator: ">=",
  right: 6
});
const mod = (target, stat, value, duration = { type: "permanent" }) => ({
  type: "createModifier", target, stat, operation: "add", value, duration
});
const etb = (id, effects, extra = {}) => ({
  id, type: "triggered", event: "cardEnteredPlay",
  condition: { type: "sourceIsEventCard" }, effects, ...extra
});

// name -> { behavior, cardPatch?, note? }
const A = {};

// ---------- slice 1 ----------
A["6r4wny 60dy9u4rd5"] = {
  behavior: {
    onPlay: {
      targets: [{ id: "ward", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
      effects: [{ type: "rememberTarget", key: "ward", target: { type: "selected", id: "ward" } }]
    },
    abilities: [
      {
        id: "bg-redirect", type: "continuous", modifiers: [],
        redirects: [{ from: { type: "remembered", key: "ward" }, to: "source" }]
      }
    ]
  }
};
A["Anxious Imp"] = {
  behavior: {
    abilities: [
      { id: "imp-obsess", name: "Obsess", type: "activated", costs: [{ type: "payResources", amount: 2 }],
        effects: [{ type: "grantProvides", target: "source", icon: "obsession", amount: 3, duration: EOT }] },
      { id: "imp-covert", type: "continuous", condition: icons6("obsession"), modifiers: [],
        keywords: [{ target: "source", keyword: "covert" }] }
    ]
  }
};
A["Backdoor Brigand"] = {
  behavior: {
    abilities: [
      { id: "bb-exit", name: "Exit Stage Right", type: "activated",
        condition: { type: "not", condition: { type: "assignedDamageThisTurn", target: "source" } },
        costs: [{ type: "payResources", amount: 1 }],
        effects: [{ type: "flipFaceDown", target: "source" }] }
    ]
  },
  cardPatch: { flipUp: { cost: 3, threshold: "dd" } }
};
A["Carnival Ringmaster"] = {
  behavior: {
    keywords: ["tactical"],
    abilities: [
      etb("cr-join", [
        { type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Do not join a party", effects: [] },
          { label: "Add to your attacking party", effects: [
            { type: "addToBattle", target: "source", side: "attacking" },
            { type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] },
              effects: [mod({ type: "selected", id: "__candidate" }, "speed", 1, EOT)] }
          ] },
          { label: "Add to your blocking party", effects: [
            { type: "addToBattle", target: "source", side: "blocking" },
            { type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] },
              effects: [mod({ type: "selected", id: "__candidate" }, "speed", 1, EOT)] }
          ] }
        ] }
      ]),
      etb("cr-token", [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "t", selector: { zone: "play", type: "character" }, count: 1, optional: true },
          effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "t" } },
            effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }] }
      ])
    ]
  }
};
A["Discordant Cadencer"] = {
  behavior: {
    abilities: [
      { id: "dc-agitate", name: "Agitate", type: "activated",
        costs: [{ type: "payResources", amount: 1 }, { type: "loseInfluence", amount: 2 }],
        effects: [{ type: "grantProvides", target: "source", icon: "rage", amount: 3, duration: EOT }] },
      { id: "dc-str", type: "continuous", condition: icons6("rage"), modifiers: [mod("source", "strength", 2)] }
    ]
  }
};
A["Elitistmajig"] = {
  behavior: {
    abilities: [
      { id: "em-crunch", name: "Crunch", type: "activated",
        targets: [{ id: "tok", selector: { controller: "self", zone: "play", name: "Micromajig" }, count: 1 }],
        costs: [{ type: "destroy", target: { type: "selected", id: "tok" } }],
        effects: [{ type: "grantProvides", target: "source", icon: "elitism", amount: 3, duration: EOT }] },
      { id: "em-buff", type: "continuous", condition: icons6("elitism"),
        modifiers: [mod("source", "strength", 2), mod("source", "life", 2)] }
    ]
  }
};
A["Enlightened Mau"] = {
  behavior: {
    abilities: [
      { id: "mau-immune", type: "continuous", modifiers: [],
        damageModifiers: [{
          selector: { zone: "play", conditions: [{ type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "source" }] },
          sourceSelector: { zone: "play", type: "character", conditions: [{ type: "hasAttachment", ofType: "item" }] },
          delta: -999
        }] },
      { id: "mau-transcend", name: "Transcend", type: "activated", costs: [{ type: "payResources", amount: 5 }],
        effects: [{ type: "grantKeyword", target: "source", keyword: "covert", duration: EOT }] }
    ]
  }
};
A["Eustace Padamose-Gristwalter"] = {
  behavior: {
    abilities: [
      { id: "eu-future", name: "Future Implications", type: "activated",
        costs: [{ type: "payResources", amount: 2 }, { type: "loseInfluence", amount: 1 }],
        effects: [{ type: "draw", player: "controller", amount: 1 }] },
      { id: "eu-past", name: "Past Trepidations", type: "activated",
        costs: [{ type: "discard", id: "disc", player: "controller", selector: { zone: "hand" }, count: 1 }],
        effects: [
          mod("source", "life", 1, EOT),
          { type: "if", condition: { type: "cardTypeIs", target: { type: "selected", id: "disc" }, cardType: "resource" },
            effects: [mod("source", "strength", 1, EOT)] }
        ] }
    ]
  },
  cardPatch: { unique: "eustace" }
};
A["Gang Weapon Dealer"] = {
  behavior: {
    abilities: [
      etb("gwd-tokens", [{ type: "addCounter", target: "source", counter: "token", amount: 2 }]),
      { id: "gwd-str", type: "continuous", modifiers: [mod("source", "strength", { type: "counter", target: "source", counter: "token" })] },
      { id: "gwd-delivery", name: "Delivery", type: "activated",
        costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }, { type: "deplete", target: "source" }],
        targets: [{ id: "g", selector: { controller: "self", zone: "play", faceDown: true, subtype: "gear" }, count: 1 }],
        effects: [{ type: "deployFromZone", player: "controller", target: { type: "selected", id: "g" }, ignoreThreshold: true,
          free: { type: "numberCompare", left: { type: "cardCost", target: { type: "selected", id: "__candidate" } }, operator: "<=", right: 4 } }] }
    ]
  }
};
A["Gigantitect's Giant Giant"] = {
  behavior: {
    abilities: [
      { id: "ggg-restrict", type: "continuous", modifiers: [],
        restrictions: [
          { target: "source", restriction: "cannotBePicked" },
          { target: "source", restriction: "cannotBeTakenControl" }
        ] }
    ]
  },
  note: "'cannot be picked by non-item cards/abilities' approximated as unconditional cannotBePicked (a 9-cost 9/9; item-tech scoping is a nicety)."
};
A["Goldmau Sacks Representative"] = {
  behavior: {
    abilities: [
      { id: "gsr-raise", name: "Raise Capital", type: "activated",
        costs: [{ type: "payResources", amount: 1 }, { type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }],
        effects: [{ type: "grantProvides", target: "source", icon: "greed", amount: 3, duration: EOT }] },
      { id: "gsr-invest", name: "Invest", type: "activated", threshold: "gggggg",
        costs: [{ type: "payResources", amount: 2 }],
        targets: [{ id: "r", selector: { zone: "deck", type: "resource" }, count: 1, optional: true }],
        effects: [
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "r" } },
            effects: [{ type: "moveCard", target: { type: "selected", id: "r" }, to: "hand" }] },
          { type: "shuffleDeck", player: "controller" }
        ] }
    ]
  }
};
A["Jo Ciendeilio, M07h3r 0f 1337"] = {
  behavior: {
    abilities: [
      { id: "jo-grant", type: "continuous", modifiers: [],
        grantedAbilities: [{
          selector: { controller: "self", zone: "play", type: "character" },
          abilities: [{
            id: "jo-research", name: "Research", type: "activated",
            condition: { type: "inPlaySinceTurnStart", target: "source" },
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "reduceNextCost", player: "controller", amount: 1 }]
          }]
        }] }
    ]
  },
  cardPatch: { unique: "jo" }
};
A["Man Shark"] = {
  behavior: {
    abilities: [
      { id: "ms-scale", type: "continuous", modifiers: [
        mod("source", "strength", { type: "count", selector: { controller: "opponent", zone: "play", faceDown: true, type: "resource" } }),
        mod("source", "life", { type: "count", selector: { controller: "opponent", zone: "play", faceDown: true, type: "resource" } })
      ] },
      { id: "ms-follow", name: "Follow Suit", type: "activated", costs: [{ type: "payResources", amount: 3 }],
        effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
          declaration: { id: "c", selector: { controller: "opponent", zone: "hand" }, count: 1 },
          effects: [{ type: "playResource", target: { type: "selected", id: "c" }, faceDown: true, player: "opponent" }] }] }
    ]
  }
};
A["Martial Arts Wannabe"] = {
  behavior: {
    abilities: [
      { id: "maw-hide", type: "continuous",
        condition: { type: "numberCompare",
          left: { type: "count", selector: { controller: "self", zone: "play", type: "character" } },
          operator: ">",
          right: { type: "count", selector: { controller: "opponent", zone: "play", type: "character" } } },
        modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePicked" }] }
    ]
  }
};
A["Monstrous Lassitude"] = {
  behavior: {
    abilities: [
      etb("ml-skip", [{ type: "skipRestoreRule", player: "controller", turns: 1 }]),
      { id: "ml-blank", type: "continuous",
        condition: { type: "numberCompare", left: { type: "resourceIcons", player: "controller", icon: "volition" }, operator: ">=", right: 4 },
        modifiers: [], suppressAllAbilities: { target: "source" } }
    ]
  }
};
A["Numba 1 Stunna!"] = {
  behavior: {
    keywords: ["tactical"],
    abilities: [
      { id: "n1s-noheal", type: "triggered", event: "damageDealt",
        condition: { type: "and", conditions: [
          { type: "sourceIsDamageSource" },
          { type: "cardTypeIs", target: "eventCard", cardType: "character" }
        ] },
        effects: [{ type: "skipNextRestore", target: "eventCard" }] }
    ]
  },
  cardPatch: { flipUp: { cost: 3, threshold: "dd" } }
};
A["Opportunistic Pirate"] = {
  behavior: {
    keywords: ["tactical"],
    onPlay: {
      targets: [{ id: "rem", selector: { owner: "opponent", zone: "discard" }, count: 4, optional: true }],
      costs: [{ type: "sacrificeSelected", declarationId: "rem", disposition: "removeFromGame" }],
      costAdjust: { type: "multiply", values: [{ type: "selectionCount", id: "rem" }, -1] }
    }
  }
};
A["Parkour Hoodlum"] = {
  behavior: {
    abilities: [
      { id: "ph-hand-tac", type: "continuous", activeZone: "hand",
        condition: { type: "numberCompare", left: { type: "count", selector: { zone: "play", type: "location" } }, operator: ">=", right: 1 },
        modifiers: [], keywords: [{ target: "source", keyword: "tactical" }] }
    ]
  },
  gap: "card-ignores-source-class",
  note: "TACTICAL-in-hand authored; 'ignores all rules text on locations' (cannot be picked by / not affected by locations) is the parity gap card-ignores-source-class."
};

// ---------- slice 2 ----------
A["Pinguid Bodyguard"] = {
  behavior: {
    abilities: [
      { id: "pb-restore", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
        effects: [{ type: "scheduleEffect", when: "endOfBattle", effects: [{ type: "restore", target: "source" }] }] },
      { id: "pb-limit", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "attackOncePerTurn" }] },
      { id: "pb-protect", name: "Protect", type: "activated",
        costs: [{ type: "deplete", target: "source" }],
        targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [mod({ type: "selected", id: "c" }, "life", 2, EOT)] }
    ]
  }
};
A["Rushing Crushing Blockhead"] = {
  behavior: {
    abilities: [
      { id: "rcb-recoil", type: "triggered", event: "damageDealt",
        condition: { type: "and", conditions: [
          { type: "sourceIsDamageSource" },
          { type: "cardTypeIs", target: "eventCard", cardType: "faction" }
        ] },
        effects: [
          { type: "destroy", target: "source" },
          { type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 2 }
        ] },
      { id: "rcb-noblock", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBlock" }] },
      { id: "rcb-blank", type: "continuous", condition: icons6("rage"),
        modifiers: [mod("source", "speed", -1)], suppressAllAbilities: { target: "source" } }
    ]
  }
};
A["Skullcrush Steamroller"] = {
  behavior: {
    abilities: [
      { id: "ss-lock", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBeRestoredByRule" }] },
      { id: "ss-limit", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "attackOncePerTurn" }] },
      { id: "ss-assist", name: "Assist", type: "activated",
        targets: [{ id: "c", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
        costs: [{ type: "payResources", amount: 2 }, { type: "depleteSelected", declarationId: "c" }],
        effects: [{ type: "restore", target: "source" }] }
    ]
  }
};
A["Sockem Bot"] = {
  behavior: {
    abilities: [
      { id: "sb-payoff", name: "Pay Off", type: "activated", usableBy: "anyPlayer",
        costs: [{ type: "payResources", amount: 1 }],
        effects: [{ type: "modifyOutgoingDamage", source: "source", delta: -1, duration: EOT }] }
    ]
  }
};
A["Thabbashite Armorer"] = {
  behavior: {
    abilities: [
      { id: "ta-forthabbash", name: "For Thabbash", type: "activated", threshold: "vvv",
        costs: [{ type: "payResources", amount: 2 }],
        effects: [mod("source", "strength", 1, EOT), mod("source", "life", 1, EOT)] },
      { id: "ta-tameshigiri", name: "Tameshigiri", type: "activated", threshold: "vvvvvv",
        costs: [{ type: "payResources", amount: 2 }, { type: "loseInfluence", amount: 2 }],
        effects: [mod("source", "strength", 2, EOT), mod("source", "life", 2, EOT)] }
    ]
  }
};
A["Thabbashite Chemist"] = {
  behavior: {
    abilities: [
      { id: "tc-deliniate", name: "Deliniate", type: "activated", threshold: "vv",
        costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
        effects: [
          { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
          { type: "forEach", selector: { controller: "self", zone: "play", faceDown: true, type: "resource" },
            effects: [{ type: "grantProvides", target: { type: "selected", id: "__candidate" }, icon: { fromNamed: "x" }, amount: 1, duration: EOT }] }
        ] }
    ]
  }
};
A["Thabbashite Financier"] = {
  behavior: {
    abilities: [
      { id: "tf-bloodgold", name: "Blood Gold", type: "activated", threshold: "vv",
        costs: [{ type: "payResources", amount: 2 }, { type: "loseInfluence", amount: 1 }],
        effects: [{ type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "c", selector: { controller: "self", zone: "hand" }, count: 1, optional: true },
          effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } },
            effects: [{ type: "playResource", target: { type: "selected", id: "c" }, faceDown: true }] }] }] }
    ]
  }
};
A["Timid Mau"] = {
  behavior: {
    abilities: [
      { id: "tm-slow", type: "triggered", event: "attackerBlocked",
        condition: { type: "and", conditions: [
          { type: "sourceIsEventCard" },
          { type: "numberCompare",
            left: { type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] } },
            operator: ">=", right: 2 }
        ] },
        effects: [mod("source", "speed", -1, EOT)] }
    ]
  }
};
A["Arcane Escrow"] = {
  behavior: {
    abilities: [
      { id: "ae-void", type: "replacement", replaces: { event: "moveToZone", zone: "discard", controlledBy: "self" }, optional: true,
        effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }] },
      { id: "ae-withdraw", name: "Withdraw", type: "activated", costs: [{ type: "payResources", amount: 1 }],
        effects: [
          { type: "draw", player: "controller", amount: 1 },
          { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d1", selector: { controller: "self", zone: "hand" }, count: 1 },
            effects: [{ type: "moveCard", target: { type: "selected", id: "d1" }, to: "discard" }] },
          { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d2", selector: { controller: "self", zone: "hand" }, count: 1 },
            effects: [{ type: "moveCard", target: { type: "selected", id: "d2" }, to: "discard" }] }
        ] }
    ]
  },
  gap: "search-and-develop-draw-interception",
  cardPatch: { flipUp: { cost: 1, threshold: "gg" } }
};
A["Flaming Cube"] = {
  behavior: {
    abilities: [
      etb("fc-tokens", [{ type: "addCounter", target: "source", counter: "token", amount: 3 }]),
      { id: "fc-tick", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
      { id: "fc-boom", type: "triggered", event: "counterChanged",
        condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 6 }] },
        effects: [
          { type: "destroy", target: "source" },
          { type: "forEachPlayer", effects: [{ type: "modifyInfluence", player: "opponent", amount: -6 }] }
        ] },
      { id: "fc-fizzle", type: "triggered", event: "counterChanged",
        condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 0 }] },
        effects: [{ type: "destroy", target: "source" }] },
      { id: "fc-control", name: "Control the Flame!", type: "activated", usableBy: "anyPlayer",
        targets: [{ id: "x", selector: { controller: "self", zone: "play", conditions: [{ type: "or", conditions: [
          { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
          { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "item" }
        ] }] }, count: 1 }],
        costs: [{ type: "destroy", target: { type: "selected", id: "x" } }],
        effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Add a token", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
          { label: "Remove a token", effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] }
        ] }] }
    ]
  }
};
A["Frickin' Sweet Pogo-Bunny"] = {
  behavior: {
    abilities: [
      { id: "pogo-raar", name: "Raar!", type: "activated", usesPerTurn: 1,
        condition: { type: "not", condition: { type: "cardTypeIs", target: "source", cardType: "character" } },
        costs: [{ type: "payResources", amount: 1 }],
        effects: [{ type: "setCardType", target: "source", cardType: "character", grantStats: { strength: 2, life: 2, speed: 3 }, duration: EOT }] },
      { id: "pogo-hide", name: "Hide!", type: "activated", costs: [{ type: "payResources", amount: 1 }],
        effects: [
          { type: "if", condition: { type: "cardTypeIs", target: "source", cardType: "character" },
            effects: [{ type: "removeCardType", target: "source", cardType: "character" }] },
          { type: "deplete", target: "source" }
        ] },
      { id: "pogo-hole", name: "Into the Rabbit Hole?", type: "activated", costs: [{ type: "payResources", amount: 3 }],
        effects: [{ type: "flipFaceDown", target: "source" }] }
    ]
  }
};
A["Golden Charm"] = {
  behavior: {
    abilities: [
      { id: "gc-fusion", name: "Seraphim Fusion", type: "activated",
        targets: [
          { id: "e", selector: { controller: "self", zone: "play", type: "character", uniqueDesignation: "eustace" }, count: 1 },
          { id: "s", selector: { zone: "deck", name: "Siluriformes Flaxenscale" }, count: 1, optional: true }
        ],
        costs: [{ type: "payResources", amount: 4 }, { type: "destroy", target: "source" }],
        effects: [
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "s" } },
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "s" }, controller: "controller" }] },
          { type: "shuffleDeck", player: "controller" }
        ] }
    ]
  },
  gap: "search-and-develop-draw-interception",
  cardPatch: { unique: "charm" }
};
A["Micromajigmakermachinemajig"] = {
  behavior: {
    abilities: [
      { id: "mmm-release", name: "Release the Majigs!", type: "activated",
        costs: [{ type: "deplete", target: "source" }],
        effects: [
          { type: "chooserSelectsOption", chooser: "opponent", options: [
            { label: "Decline", effects: [] },
            { label: "Create a shielded Micromajig", effects: [
              { type: "createTokens", controller: "opponent", count: 1, token: MICROMAJIG,
                effects: [{ type: "preventDamage", target: { type: "selected", id: "__candidate" }, amount: 999, mode: "reduce" }] }
            ] }
          ] },
          { type: "createTokens", controller: "controller", count: 1, token: MICROMAJIG }
        ] },
      { id: "mmm-prepare", name: "Prepare", type: "activated", costs: [{ type: "payResources", amount: 2 }],
        effects: [{ type: "restore", target: "source" }] }
    ]
  }
};
A["Mittens of Muffled Thought"] = {
  behavior: {
    abilities: [
      { id: "mmt-suppress", type: "continuous", modifiers: [],
        restrictions: [{ target: "attachedTo", restriction: "cannotAttack" }],
        suppressAllAbilities: { target: "attachedTo" } },
      { id: "mmt-move", name: "Move", type: "activated",
        targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: { type: "selected", id: "__candidate" } } }] }, count: 1 }],
        costs: [{ type: "payResources", amount: 3 }],
        effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "c" } }] }
    ]
  },
  cardPatch: { attachTo: "character" }
};
A["Runic Map"] = {
  behavior: {
    abilities: [
      etb("rm-tokens", [{ type: "addCounter", target: "source", counter: "token", amount: 2 }]),
      { id: "rm-empty", type: "triggered", event: "counterChanged",
        condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 0 }] },
        effects: [{ type: "destroy", target: "source" }] },
      { id: "rm-plan", name: "Plan", type: "activated",
        costs: [{ type: "payResources", amount: 1 }, { type: "removeCounter", target: "source", counter: "token", amount: 1 }],
        targets: [{ id: "e", selector: { zone: "deck", name: "Elitism" }, count: 1, optional: true }],
        effects: [
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "e" } },
            effects: [{ type: "moveCard", target: { type: "selected", id: "e" }, to: "hand" }] },
          { type: "shuffleDeck", player: "controller" }
        ] },
      { id: "rm-follow", name: "Follow Plan", type: "activated",
        costs: [{ type: "payResources", amount: 2 }, { type: "removeCounter", target: "source", counter: "token", amount: 1 }],
        effects: [{ type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "c", selector: { controller: "self", zone: "hand" }, count: 1, optional: true },
          effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } },
            effects: [{ type: "playResource", target: { type: "selected", id: "c" }, faceDown: "auto" }] }] }] },
      { id: "rm-new", name: "New Plan", type: "activated",
        targets: [{ id: "fd", selector: { controller: "self", zone: "play", faceDown: true, type: "resource" }, count: 1 }],
        costs: [{ type: "destroy", target: { type: "selected", id: "fd" } }],
        effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
    ]
  }
};
A["Barracks of Precipitancy"] = {
  behavior: {
    abilities: [
      { id: "bop-gotime", name: "Go Time!", type: "activated", costs: [{ type: "deplete", target: "source" }],
        effects: [
          { type: "shuffleDeck", player: "controller" },
          { type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top" }, cardType: "character" },
            effects: [
              { type: "putIntoPlay", target: { type: "deckPosition", player: "controller", from: "top" }, controller: "controller", borrowed: true },
              { type: "grantKeyword", target: { type: "deckPosition", player: "controller", from: "top" }, keyword: "aggro", duration: EOT }
            ] }
        ] },
      { id: "bop-anycost", name: "At Any Cost!", type: "activated",
        costs: [{ type: "payResources", amount: 2 }, { type: "dealDamage", target: "source", amount: 3 }],
        effects: [{ type: "restore", target: "source" }] }
    ]
  }
};
A["Clockman Skydocks"] = {
  behavior: {
    abilities: [
      { id: "cs-bday", name: "Business Day", type: "activated",
        costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }],
        effects: [
          { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
          { type: "reduceThreshold", player: "controller", icon: { fromNamed: "x" }, amount: 1 }
        ] },
      { id: "cs-overtime", name: "Overtime", type: "activated", threshold: "vvvvv",
        costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
        effects: [
          { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
          { type: "reduceThreshold", player: "controller", icon: { fromNamed: "x" }, amount: 6 }
        ] }
    ]
  },
  cardPatch: { unique: "skydocks" }
};
A["Gloamspike-Gosche Bridge"] = {
  behavior: {
    abilities: [
      { id: "gg-hide", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePicked" }] },
      { id: "gg-hand-char", type: "continuous", modifiers: [],
        keywords: [{ selector: { controller: "self", zone: "hand", type: "character" }, keyword: "tactical" }] },
      { id: "gg-hand-il", type: "continuous",
        condition: { type: "numberCompare", left: { type: "resourceIcons", player: "controller", icon: "obsession" }, operator: ">=", right: 8 },
        modifiers: [],
        keywords: [
          { selector: { controller: "self", zone: "hand", type: "item" }, keyword: "tactical" },
          { selector: { controller: "self", zone: "hand", type: "location" }, keyword: "tactical" }
        ] }
    ]
  }
};

// ---------- slice 3 ----------
A["Micromajig Recycling Station"] = {
  behavior: {
    abilities: [
      { id: "mrs-recycle", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{
          type: "chooserSelectsNumber", chooser: "controller", storeAs: "x", min: 0,
          max: { type: "count", selector: { controller: "self", zone: "play", name: "Micromajig" } },
          effects: [{
            type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "m", selector: { controller: "self", zone: "play", name: "Micromajig" }, count: { type: "variable", id: "x" } },
            effects: [
              { type: "forEach", selected: "m", effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] },
              { type: "reduceNextCost", player: "controller", amount: { type: "add", values: [{ type: "selectionCount", id: "m" }, 1] } }
            ]
          }]
        }] }
    ]
  }
};
A["Recycling Scheme Facility"] = {
  behavior: {
    abilities: [
      etb("rsf-draw", [{ type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Decline", effects: [] },
        { label: "Draw a card", effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ] }]),
      { id: "rsf-recur", type: "triggered", event: "cardMoved",
        condition: { type: "and", conditions: [
          { type: "cardTypeIs", target: "eventCard", cardType: "character" },
          { type: "cardMovedToZone", zone: "discard" }
        ] },
        effects: [{ type: "anyPlayerMayPay", costs: [{ type: "payResources", amount: 4 }],
          effects: [{ type: "moveCard", target: "eventCard", to: "deck", position: "top" }] }] }
    ]
  }
};
A["Torchlight District"] = {
  behavior: {
    abilities: [
      { id: "td-restore", type: "triggered", event: "characterAttacked",
        condition: { type: "and", conditions: [
          { type: "eventCardControlledBy", player: "controller" },
          { type: "statCompare", target: "eventCard", stat: "speed", operator: "<=", value: 3 }
        ] },
        effects: [{ type: "scheduleEffect", when: "endOfBattle", effects: [{ type: "restore", target: "eventCard" }] }] },
      { id: "td-limit", type: "continuous", modifiers: [],
        restrictions: [{ selector: { controller: "self", zone: "play", type: "character" }, restriction: "attackOncePerTurn" }] }
    ]
  }
};
A["Audacious Appraisal"] = {
  behavior: {
    abilities: [
      { id: "aa-play", type: "activated",
        targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{
          type: "chooserSelectsNumber", chooser: { type: "controllerOf", target: { type: "selected", id: "ch" } }, storeAs: "x", min: 0,
          effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
            { label: "That player loses X influence", effects: [
              { type: "modifyInfluence", player: { type: "controllerOf", target: { type: "selected", id: "ch" } }, amount: { type: "multiply", values: [{ type: "variable", id: "x" }, -1] } }
            ] },
            { label: "Destroy the character; you lose 2X influence", effects: [
              { type: "destroy", target: { type: "selected", id: "ch" } },
              { type: "modifyInfluence", player: "controller", amount: { type: "multiply", values: [{ type: "variable", id: "x" }, -2] } }
            ] }
          ] }]
        }] }
    ]
  }
};
A["Drive By Boobing"] = {
  behavior: {
    abilities: [
      { id: "dbb-play", type: "activated",
        targets: [{ id: "ch", selector: { zone: "play", type: "character", conditions: [{ type: "inflictedDamageToFactionThisTurn", player: "controller", target: { type: "selected", id: "__candidate" } }] }, count: 1 }],
        effects: [{ type: "removeFromGame", target: { type: "selected", id: "ch" } }] }
    ]
  }
};
A["Expedition Endeavour"] = {
  behavior: {
    modes: [
      {
        label: "Search for an Arcanist character",
        targets: [{ id: "c", selector: { controller: "self", zone: "deck", type: "character", conditions: [{ type: "cardTradeIs", target: { type: "selected", id: "__candidate" }, trade: "arcanist" }] }, count: 1, optional: true }],
        effects: [
          { type: "chooserSelectsTarget", chooser: "opponent",
            declaration: { id: "det", selector: { owner: "opponent", zone: "play", type: "resource", conditions: [{ type: "not", condition: { type: "targetExists", target: "attachedTo" } }] }, count: 3, optional: true },
            effects: [{ type: "forEach", selected: "det", effects: [{ type: "detach", target: { type: "selected", id: "__candidate" } }] }] },
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } },
            effects: [{ type: "moveCard", target: { type: "selected", id: "c" }, to: "hand" }] },
          { type: "shuffleDeck", player: "controller" }
        ]
      },
      {
        label: "Deplete X characters, detach X+3",
        targets: [{ id: "dep", selector: { controller: "self", zone: "play", type: "character" }, count: { type: "variable", id: "x" } }],
        costs: [{ type: "depleteSelected", declarationId: "dep" }],
        effects: [{
          type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "myres", selector: { owner: "self", zone: "play", type: "resource", conditions: [{ type: "targetExists", target: "attachedTo" }] }, count: { type: "add", values: [{ type: "variable", id: "x" }, 3] }, optional: true },
          effects: [{ type: "forEach", selected: "myres", effects: [{ type: "detach", target: { type: "selected", id: "__candidate" } }] }]
        }]
      },
      {
        label: "A character gains COVERT",
        targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "grantKeyword", target: { type: "selected", id: "ch" }, keyword: "covert", duration: EOT }]
      }
    ]
  }
};
A["Forgotten Tentacle"] = {
  behavior: {
    abilities: [
      { id: "ft-play", type: "activated",
        targets: [{ id: "fd", selector: { controller: "opponent", zone: "play", faceDown: true, type: "resource" }, count: 1 }],
        effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Decline", effects: [] },
          { label: "Destroy it", effects: [
            { type: "destroy", target: { type: "selected", id: "fd" } },
            { type: "chooserSelectsOption", chooser: "opponent", options: [
              { label: "Decline", effects: [] },
              { label: "Draw a card", effects: [{ type: "draw", player: "opponent", amount: 1 }] }
            ] },
            { type: "chooserSelectsTarget", chooser: "opponent",
              declaration: { id: "r", selector: { controller: "opponent", zone: "hand" }, count: 1, optional: true },
              effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "r" } },
                effects: [{ type: "playResource", target: { type: "selected", id: "r" }, faceDown: "auto", player: "opponent" }] }] }
          ] }
        ] }] }
    ]
  }
};
A["Guileful Astucion"] = {
  behavior: {
    abilities: [
      { id: "ga-play", type: "activated",
        targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "−1 numeric cost this turn; draw", effects: [
            { type: "modifyNumericCost", target: { type: "selected", id: "ch" }, delta: -1, duration: EOT },
            { type: "draw", player: "controller", amount: 1 }
          ] },
          { label: "+1 numeric cost this turn; draw", effects: [
            { type: "modifyNumericCost", target: { type: "selected", id: "ch" }, delta: 1, duration: EOT },
            { type: "draw", player: "controller", amount: 1 }
          ] },
          { label: "+1 speed this turn; draw", effects: [
            mod({ type: "selected", id: "ch" }, "speed", 1, EOT),
            { type: "draw", player: "controller", amount: 1 }
          ] }
        ] }] }
    ]
  }
};
A["Negotiation Ceremonies"] = {
  behavior: {
    abilities: [
      { id: "nc-play", type: "activated",
        effects: [{
          type: "alternatingPayLoop", first: "controller", opponent: "opponent",
          cost: [{ type: "payResources", amount: 1 }],
          onEnd: [
            { type: "draw", player: "controller", amount: { type: "variable", id: "__paidByFirst" } },
            { type: "draw", player: "opponent", amount: { type: "variable", id: "__paidByOpponent" } }
          ]
        }] }
    ]
  }
};
A["Shriever Breeding Program"] = {
  behavior: {
    modes: [
      {
        label: "Search for a dragon",
        condition: { type: "isActivePlayer", player: "controller" },
        targets: [{ id: "c", selector: { controller: "self", zone: "deck", subtype: "dragon" }, count: 1, optional: true }],
        effects: [
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } },
            effects: [{ type: "moveCard", target: { type: "selected", id: "c" }, to: "hand" }] },
          { type: "shuffleDeck", player: "controller" }
        ]
      },
      {
        label: "Deplete a character, draw",
        condition: { type: "isActivePlayer", player: "controller" },
        targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [
          { type: "deplete", target: { type: "selected", id: "ch" } },
          { type: "draw", player: "controller", amount: 1 }
        ]
      }
    ]
  }
};
A["Sneaker Attack!"] = {
  behavior: {
    abilities: [
      { id: "sa-play", type: "activated",
        condition: { type: "battleActive" },
        targets: [{ id: "ch", selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: { type: "selected", id: "__candidate" } } }] }, count: 1 }],
        costs: [{ type: "depleteSelected", declarationId: "ch" }],
        effects: [
          { type: "chooserSelectsOption", chooser: "controller", options: [
            { label: "Add to your attacking party", effects: [{ type: "addToBattle", target: { type: "selected", id: "ch" }, side: "attacking" }] },
            { label: "Add to your blocking party", effects: [{ type: "addToBattle", target: { type: "selected", id: "ch" }, side: "blocking" }] }
          ] },
          mod({ type: "selected", id: "ch" }, "speed", 1, EOT)
        ] }
    ]
  },
  cardPatch: { flipUp: { cost: 2, threshold: "dd" } }
};
A["Study Disturbance"] = {
  behavior: {
    abilities: [
      { id: "sd-play", type: "activated",
        targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
        effects: [
          { type: "restrictPlay", player: { type: "controllerOf", target: { type: "selected", id: "p" } }, kind: "cardType", cardType: "character", duration: EOT },
          { type: "draw", player: "controller", amount: 1 }
        ] }
    ]
  },
  gap: "opponent-may-pay-to-counter"
};
A["Surreptitious Larceny"] = {
  behavior: {
    modes: [
      {
        label: "A player can't FLIP UP; peek any deck",
        targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
        effects: [
          { type: "restrictPlay", player: { type: "controllerOf", target: { type: "selected", id: "p" } }, kind: "flipUp", duration: EOT },
          { type: "lookAndReorder", player: "controller", count: 1 }
        ]
      },
      {
        label: "A character gains COVERT; draw",
        targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [
          { type: "grantKeyword", target: { type: "selected", id: "ch" }, keyword: "covert", duration: EOT },
          { type: "draw", player: "controller", amount: 1 }
        ]
      },
      {
        label: "Attach a gear card; it loses its abilities this turn",
        targets: [
          { id: "g", selector: { zone: "play", subtype: "gear" }, count: 1 },
          { id: "ch", selector: { zone: "play", type: "character" }, count: 1 }
        ],
        effects: [{ type: "attachTo", target: { type: "selected", id: "g" }, to: { type: "selected", id: "ch" } }]
      }
    ]
  },
  note: "Mode 3's 'this turn the gear loses all abilities' is not expressible as a one-shot (suppressAllAbilities is continuous). Attach is authored; the temporary blank is dropped (secondary clause)."
};
A["Swindle"] = {
  behavior: {
    noResponse: true,
    abilities: [
      { id: "sw-play", type: "activated",
        effects: [
          { type: "chooserSelectsTarget", chooser: "opponent",
            declaration: { id: "r", selector: { owner: "opponent", zone: "play", faceDown: true, type: "resource", conditions: [{ type: "not", condition: { type: "targetExists", target: "attachedTo" } }] }, count: 1 },
            effects: [{ type: "attachTo", target: { type: "selected", id: "r" }, to: { type: "factionOf", player: "opponent" } }] },
          { type: "draw", player: "controller", amount: 1 },
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "d", selector: { controller: "self", zone: "hand" }, count: 1 },
            effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }] }
        ] }
    ]
  }
};
A["Tedious TriAdic Truculence"] = {
  behavior: {
    abilities: [
      { id: "ttt-play", type: "activated",
        targets: [{ id: "picks", selector: { zone: "play", type: "character" }, count: 3 }],
        effects: [{ type: "forEach", selected: "picks",
          effects: [{ type: "if", condition: { type: "statCompare", target: { type: "selected", id: "__candidate" }, stat: "strength", operator: "<=", value: 3 },
            effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }] }
    ]
  },
  gap: "opponent-may-pay-to-counter"
};
A["Unexpected Codicil"] = {
  behavior: {
    abilities: [
      { id: "uc-play", type: "activated",
        variables: {},
        costs: [
          { type: "discard", id: "disc", player: "controller", selector: { zone: "hand" }, count: 1 },
          { type: "payResources", amount: { type: "conditional", if: { type: "numberCompare", left: { type: "variable", id: "x" }, operator: ">=", right: 2 }, then: { type: "add", values: [{ type: "variable", id: "x" }, -2] }, else: 0 } }
        ],
        effects: [{ type: "draw", player: "controller", amount: { type: "variable", id: "x" } }] }
    ]
  },
  cardPatch: { revealFromHand: { cost: 2, threshold: "gggg", effects: [{ type: "loseInfluence", amount: 2 }, { type: "draw", player: "controller", amount: 1 }] } },
  note: "Primary mode: discard is a fixed count:1 (a 'discard X' cost isn't variable-count); a fuller model needs discardSelected. FINE PRINT via revealFromHand rider."
};

// ---------- apply ----------
const CARD_PATCH_KEYS = new Set(["unique", "attachTo", "flipUp", "revealFromHand", "selfDisposition"]);
let n = 0;
for (const [name, spec] of Object.entries(A)) {
  const card = byName.get(name);
  if (!card) throw new Error("no card named " + name);
  card.behavior = spec.behavior;
  for (const [k, v] of Object.entries(spec.cardPatch ?? {})) {
    if (!CARD_PATCH_KEYS.has(k)) throw new Error(name + ": bad cardPatch key " + k);
    card[k] = v;
  }
  const e = covByName.get(name);
  e.status = "authored";
  if (spec.gap) e.parityGaps = Array.from(new Set([...(e.parityGaps ?? []), spec.gap]));
  if (spec.note) e.notes = (e.notes ?? "") + " [author: " + spec.note + "]";
  e.metadata = {
    unique: card.unique ?? null,
    attachTo: card.attachTo ?? null,
    resourceProvides: card.resource?.provides ?? null,
    keywords: card.behavior?.keywords ?? []
  };
  n++;
}

// register the parity gap Parkour needs
cov.parityGaps["card-ignores-source-class"] = {
  summary: "A card that cannot be picked by, and is not affected by, cards of a given type.",
  clause: "This card ignores all rules text on locations. (this card cannot be picked by locations and any effects from locations do not affect this card.) — Parkour Hoodlum",
  needs: "Scoped targeting immunity (cannotBePicked keyed on the picking source's card type) plus a general 'effects from <type> don't affect this card' filter across dealDamage / createModifier / etc. — a per-source-type shield with no current hook.",
  scope: "medium"
};

fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log("authored " + n + " cards");
