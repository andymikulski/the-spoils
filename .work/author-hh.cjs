#!/usr/bin/env node
/* Author `behavior` JSON onto Holy Heist cards in data/cards.json, and flip
 * their coverage entries to "authored".  Re-runnable.  Normalizes
 * data/cards.json to JSON.stringify(_, null, 2) + "\n".
 *
 *   node .work/author-hh.cjs
 *
 * PATCH is keyed by card id: { behavior, cardPatch?, verified? }.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const COV = path.join(ROOT, "data", "card-coverage.json");

const CARD_PATCH_KEYS = new Set([
  "unique",
  "attachTo",
  "flipUp",
  "revealFromHand",
  "selfDisposition",
  "resource"
]);

const MICROMAJIG = {
  name: "Micromajig",
  cardType: "character",
  subtype: ["micromajig"],
  strength: 0,
  life: 1,
  speed: 1
};

// Common condition helpers
const provV = target => ({ type: "cardProvides", target, icon: "volition", min: 1 });
// "When a card that provides at least [V] enters play under <player>'s
// control, ..." — the recurring Holy Heist cycle. Per the Seed 2 idiom this
// is TWO triggers: `resourcePlayed` (any resource — a [V] resource, or any
// face-down resource = Volition) + `cardEnteredPlay` (a non-resource card
// with PROVIDES: [V]). `who` is "controller" or "opponent".
const vCycle = (idBase, who, effects, targets) => {
  const mk = (suffix, event, cond) => {
    const a = { id: `${idBase}-${suffix}`, type: "triggered", event, condition: cond, effects };
    if (targets) a.targets = targets;
    return a;
  };
  return [
    mk("res", "resourcePlayed", { type: "and", conditions: [{ type: "eventPlayerIs", player: who }, provV("eventCard")] }),
    mk("etb", "cardEnteredPlay", { type: "and", conditions: [{ type: "eventCardControlledBy", player: who }, provV("eventCard")] })
  ];
};
const num = (left, operator, right) => ({ type: "numberCompare", left, operator, right });
const rIcons = (player, icon) => ({ type: "resourceIcons", player, icon });
const iconGate = (icon, n, modifiers) => ({
  type: "continuous",
  condition: num(rIcons("controller", icon), ">=", n),
  modifiers
});
const selfIsEvent = { type: "sourceIsEventCard" };

const PATCH = {};

// ============================================================ batch 1 ===

// 0v3rw0rk3d 31f
PATCH["7dd26a5f-d0dc-4231-b70a-d11b189f28db"] = {
  behavior: {
    abilities: [
      {
        id: "overworked-elf-jam",
        type: "continuous",
        modifiers: [],
        restrictions: [
          { selector: { zone: "play", type: "location" }, restriction: "cannotUseAbilities" }
        ]
      },
      {
        id: "overworked-elf-crush",
        type: "continuous",
        condition: num(rIcons("controller", "elitism"), ">=", 6),
        modifiers: [
          {
            selector: { controller: "opponent", zone: "play", type: "location" },
            stat: "structure",
            operation: "add",
            value: -1
          }
        ]
      }
    ]
  },
  cardPatch: { flipUp: { cost: 2, threshold: "ee" } }
};

// 73ch!
PATCH["91d07791-dd91-4862-9345-d06bbc73a06b"] = {
  behavior: {
    abilities: [
      {
        id: "tech-search",
        type: "activated",
        targets: [
          {
            id: "found",
            selector: {
              owner: "self",
              zone: "deck",
              conditions: [
                { type: "cardTradeIs", target: { type: "selected", id: "__candidate" }, trade: "gearsmith" }
              ]
            },
            count: 1,
            optional: true
          }
        ],
        effects: [
          {
            type: "if",
            condition: { type: "targetExists", target: { type: "selected", id: "found" } },
            effects: [
              { type: "putIntoPlay", target: { type: "selected", id: "found" }, controller: "controller", faceDown: true }
            ]
          },
          { type: "shuffleDeck", player: "controller" }
        ]
      }
    ]
  }
};

// A Boy and His Toy
PATCH["cb769940-1672-4f8a-bb37-9de5487e56e2"] = {
  behavior: {
    abilities: [
      {
        id: "boy-toy-etb",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: selfIsEvent,
        effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICROMAJIG }]
      }
    ]
  }
};

// Abecedarian Investor
PATCH["f1be6c74-f6b8-4dee-8b3b-c276ed72382f"] = {
  behavior: {
    onPlay: {
      targets: [{ id: "picked", selector: { zone: "play" }, count: 1, optional: true }]
    },
    abilities: [
      {
        id: "abecedarian-etb",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: selfIsEvent,
        effects: [
          {
            type: "if",
            condition: { type: "targetExists", target: { type: "selected", id: "picked" } },
            effects: [{ type: "removeCounter", target: { type: "selected", id: "picked" }, counter: "token", amount: 1 }]
          }
        ]
      }
    ]
  }
};

// Abused 31f Conveyer
PATCH["28ef7fe5-9418-4a10-b0ae-be6a8165e9b8"] = {
  behavior: {
    abilities: [
      {
        id: "abused-conveyer-etb",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: selfIsEvent,
        targets: [{ id: "buff", selector: { zone: "play", type: "character" }, count: 1, optional: true }],
        effects: [
          {
            type: "if",
            condition: { type: "targetExists", target: { type: "selected", id: "buff" } },
            effects: [
              { type: "createModifier", target: { type: "selected", id: "buff" }, stat: "strength", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } },
              { type: "createModifier", target: { type: "selected", id: "buff" }, stat: "life", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    ]
  }
};

// Additional Tribute
PATCH["a64326fe-e6a2-4398-ad70-88e4584fb7af"] = {
  behavior: {
    abilities: [
      {
        id: "additional-tribute",
        type: "activated",
        condition: {
          type: "and",
          conditions: [
            { type: "respondingTo" },
            { type: "not", condition: { type: "respondingTo", cardType: "tactic" } }
          ]
        },
        effects: [
          {
            type: "if",
            condition: num(rIcons("controller", "volition"), ">=", 3),
            effects: [
              {
                type: "chooserSelectsOption",
                chooser: "controller",
                options: [
                  { label: "Leave it on top", effects: [] },
                  {
                    label: "Put the top card on the bottom",
                    effects: [
                      { type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top" }, to: "deck", position: "bottom" }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: "mayPay",
            player: "opponent",
            costs: [{ type: "payResources", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }],
            elseEffects: [{ type: "terminate", scope: "respondedItem" }]
          }
        ]
      }
    ]
  }
};

// Akashic Coin
PATCH["21274c5d-a966-4303-a9e6-9db01061d7a0"] = {
  behavior: {
    abilities: vCycle("akashic-coin", "opponent", [
      {
        type: "mayPay",
        player: "opponent",
        costs: [{ type: "payResources", amount: 2 }],
        effects: [],
        elseEffects: [
          {
            type: "mayPay",
            player: "controller",
            costs: [{ type: "loseInfluence", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }],
            elseEffects: [{ type: "flipFaceDown", target: "source" }]
          }
        ]
      }
    ])
  },
  cardPatch: { unique: "akashic object", flipUp: { cost: 3, threshold: "g" } }
};

// Akashic Notes
PATCH["27d42a55-adb9-43ca-95b6-6778af1648f0"] = {
  behavior: {
    abilities: vCycle("akashic-notes", "opponent", [
      {
        type: "mayPay",
        player: "controller",
        costs: [{ type: "payResources", amount: 1 }],
        effects: [
          { type: "playResource", target: { type: "random", selector: { controller: "self", zone: "hand" } }, faceDown: true, player: "controller" }
        ],
        elseEffects: [{ type: "flipFaceDown", target: "source" }]
      }
    ])
  },
  cardPatch: { unique: "akashic object", flipUp: { cost: 3, threshold: "vv" } }
};

// Asbestos Drywall
PATCH["f44b8c88-1aa5-4422-ad4d-29d49c252959"] = {
  behavior: {
    abilities: [
      {
        id: "asbestos-drywall",
        type: "activated",
        targets: [{ id: "loc", selector: { zone: "play", type: "location" }, count: 1 }],
        effects: [
          {
            type: "chooserSelectsOption",
            chooser: "controller",
            options: [
              { label: "Remove 2 damage markers", effects: [{ type: "healDamage", target: { type: "selected", id: "loc" }, amount: 2 }] },
              { label: "Add 2 damage markers", effects: [{ type: "dealDamage", target: { type: "selected", id: "loc" }, amount: 2 }] }
            ]
          }
        ]
      }
    ]
  },
  cardPatch: { flipUp: { cost: 3, threshold: "gg" } }
};

// Bewilderbeast
PATCH["61af506c-d6e4-4b48-aa10-e959b670aaa3"] = {
  behavior: {
    abilities: [
      {
        id: "bewilderbeast-feed",
        type: "triggered",
        event: "cardsDiscarded",
        condition: { type: "eventPlayerIs", player: "opponent" },
        effects: [
          { type: "createModifier", target: "source", stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } },
          { type: "createModifier", target: "source", stat: "life", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }
        ]
      }
    ]
  }
};

// Blitz of Destruction
PATCH["3f5aab3e-81e1-46be-98e7-b55fbd60c047"] = {
  behavior: {
    abilities: [
      {
        id: "blitz-of-destruction",
        type: "activated",
        condition: num(
          { type: "count", selector: { owner: "opponent", zone: "play", type: "resource" } },
          ">",
          { type: "count", selector: { owner: "self", zone: "play", type: "resource" } }
        ),
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "opponent",
            declaration: {
              id: "doomed",
              selector: { controller: "opponent", zone: "play", type: "resource", faceDown: true },
              count: 1
            },
            effects: [{ type: "destroy", target: { type: "selected", id: "doomed" } }]
          }
        ]
      }
    ]
  },
  cardPatch: { flipUp: { cost: 4, threshold: "r" } }
};

// Boorish Boar
PATCH["3176810c-984e-4104-8c5f-b1d8014dc36e"] = {
  behavior: {
    abilities: [
      {
        id: "boorish-boar-pump",
        type: "activated",
        threshold: "rr",
        effects: [
          { type: "createModifier", target: "source", stat: "strength", operation: "add", value: 1, duration: { type: "permanent" } },
          { type: "createModifier", target: "source", stat: "life", operation: "add", value: -1, duration: { type: "permanent" } }
        ]
      },
      {
        id: "boorish-boar-pop",
        type: "activated",
        threshold: "rrr",
        effects: [{ type: "destroy", target: "source" }]
      },
      {
        id: "boorish-boar-death",
        type: "triggered",
        event: "cardDestroyed",
        condition: selfIsEvent,
        targets: [
          {
            id: "victims",
            selector: {
              zone: "play",
              conditions: [
                {
                  type: "or",
                  conditions: [
                    { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
                    { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" }
                  ]
                }
              ]
            },
            count: 2,
            optional: true
          }
        ],
        effects: [
          {
            type: "if",
            condition: { type: "targetExists", target: { type: "selected", id: "victims" } },
            effects: [
              {
                type: "distributeAmong",
                chooser: "controller",
                selected: "victims",
                amount: 2,
                effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: { type: "variable", id: "__amount" } }]
              }
            ]
          }
        ]
      }
    ]
  }
};

// Canny Bailiff
PATCH["efac6670-d61f-42ba-aee9-e897b774e395"] = {
  behavior: {
    abilities: [
      {
        id: "canny-bailiff-tax",
        type: "continuous",
        modifiers: [],
        costModifiers: [
          { affects: "opponent", delta: 0, minCost: 3, selector: { type: "tactic" } }
        ]
      }
    ]
  }
};

// Catastrophic Caper
PATCH["e91b8651-6e73-4d29-af1e-82bef2e72932"] = {
  behavior: {
    abilities: [
      {
        id: "catastrophic-caper",
        type: "activated",
        condition: { type: "respondedToPicked", cardType: "character" },
        effects: [
          { type: "moveCard", target: { type: "respondedToPicked", cardType: "character" }, to: "hand" },
          {
            type: "if",
            condition: { type: "uniqueIs", target: { type: "respondedToPicked", cardType: "character" }, designations: ["pluck"] },
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    ]
  },
  cardPatch: { flipUp: { cost: 1, threshold: "d" } }
};

// Cathédrale de Mau
PATCH["f5bf92d7-3153-4600-b5df-3d669ece9404"] = {
  behavior: {
    abilities: [
      {
        id: "cathedrale-ward-location",
        type: "triggered",
        event: "damageDealt",
        condition: {
          type: "and",
          conditions: [
            { type: "cardTypeIs", target: "eventCard", cardType: "location" },
            { type: "eventCardControlledBy", player: "controller" }
          ]
        },
        effects: [
          {
            type: "mayPay",
            player: "controller",
            costs: [{ type: "loseInfluence", amount: 1 }],
            effects: [{ type: "healDamage", target: "eventCard", amount: 1 }]
          }
        ]
      },
      {
        id: "cathedrale-ward-bigchar",
        type: "triggered",
        event: "damageDealt",
        condition: {
          type: "and",
          conditions: [
            { type: "cardTypeIs", target: "eventCard", cardType: "character" },
            { type: "eventCardControlledBy", player: "controller" },
            num({ type: "cardCost", target: "eventCard" }, ">=", 6)
          ]
        },
        effects: [
          {
            type: "mayPay",
            player: "controller",
            costs: [{ type: "loseInfluence", amount: 1 }],
            effects: [{ type: "healDamage", target: "eventCard", amount: 1 }]
          }
        ]
      }
    ]
  },
  cardPatch: { unique: "cathedral" }
};

// Close Call
PATCH["9d26a50a-5978-4efd-8b94-df7bd81b226c"] = {
  behavior: {
    abilities: [
      {
        id: "close-call",
        type: "activated",
        targets: [{ id: "c", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "moveCard", target: { type: "selected", id: "c" }, to: "hand" }]
      }
    ]
  },
  cardPatch: { selfDisposition: { to: "faceDownResource" } }
};

// Cr4ck13
PATCH["5604d122-d915-448d-9c96-0927c0590781"] = {
  behavior: {
    abilities: [
      {
        id: "crackle-absorb",
        type: "triggered",
        event: "damageDealt",
        condition: selfIsEvent,
        effects: [
          { type: "createTokens", controller: "controller", count: { type: "eventDamageAmount" }, token: MICROMAJIG }
        ]
      }
    ]
  }
};

// Craniata Nester
PATCH["1a1d1224-d3ac-4a6f-bf31-01cd5477f1d7"] = {
  behavior: {
    abilities: [
      ...vCycle("craniata-nester", "controller", [
        {
          type: "chooserSelectsOption",
          chooser: "controller",
          options: [
            { label: "Decline", effects: [] },
            { label: "Mill the opponent's top card", effects: [{ type: "mill", player: "opponent", count: 1 }] }
          ]
        }
      ]),
      {
        id: "craniata-nester-grow",
        type: "continuous",
        modifiers: [
          { target: "source", stat: "strength", operation: "add", value: { type: "count", selector: { owner: "opponent", zone: "discard", type: "character" } } },
          { target: "source", stat: "life", operation: "add", value: { type: "count", selector: { owner: "opponent", zone: "discard", type: "character" } } }
        ]
      }
    ]
  }
};

// Crazed Executioner
PATCH["6d43bba3-c357-4a51-ae41-2c65f1a1cfe0"] = {
  behavior: {
    abilities: [
      {
        id: "crazed-executioner-etb",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: selfIsEvent,
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1, optional: true }],
        effects: [
          {
            type: "if",
            condition: { type: "targetExists", target: { type: "selected", id: "t" } },
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          }
        ]
      }
    ]
  }
};

// Crematory Cache
PATCH["9c2008d3-32d2-495d-9147-203f5c33aa36"] = {
  behavior: {
    abilities: [
      {
        id: "crematory-cache",
        type: "triggered",
        event: "cardDestroyed",
        condition: { type: "cardTypeIs", target: "eventCard", cardType: "character" },
        effects: [
          {
            type: "chooserSelectsOption",
            chooser: "controller",
            options: [
              { label: "Decline", effects: [] },
              { label: "Gain 1 influence", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
            ]
          }
        ]
      }
    ]
  }
};

// Damascus Sword Swinger
PATCH["1fef50ff-5467-4464-a48b-544c9a8020bd"] = {
  behavior: {
    abilities: [
      {
        id: "damascus-gear-buff",
        type: "continuous",
        condition: { type: "hasAttachment", target: "source", ofSubtype: "gear" },
        modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }]
      }
    ]
  }
};

// Deceitful Mortgage Underwriter
PATCH["4f005a62-ff7c-4afa-8d65-0b5ca43259da"] = {
  behavior: {
    abilities: [
      {
        id: "dmu-tokens",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: selfIsEvent,
        effects: [{ type: "addCounter", target: "source", counter: "token", amount: 3 }]
      },
      {
        id: "dmu-shrink",
        type: "continuous",
        modifiers: [
          { target: "source", stat: "strength", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } },
          { target: "source", stat: "life", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } }
        ]
      },
      {
        id: "dmu-extra-interest",
        type: "activated",
        costs: [
          { type: "payResources", amount: 1 },
          { type: "removeCounter", target: "source", counter: "token", amount: 1 }
        ],
        targets: [{ id: "loc", selector: { zone: "play", type: "location" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "loc" }, amount: 1 }]
      }
    ]
  },
  cardPatch: { flipUp: { cost: 4, threshold: "ggg" } }
};

// Defalcating Accountant
PATCH["62983c63-97cf-43ce-b6c2-ef4f3c708977"] = {
  behavior: {
    abilities: [
      {
        id: "defalcating-restore-draw",
        type: "triggered",
        event: "cardRestored",
        condition: selfIsEvent,
        effects: [
          {
            type: "chooserSelectsOption",
            chooser: "controller",
            options: [
              { label: "Decline", effects: [] },
              { label: "Draw a card", effects: [{ type: "draw", player: "controller", amount: 1 }] }
            ]
          }
        ]
      }
    ]
  }
};

// Deity Delimitation Device
PATCH["a54da68e-49b1-4942-abbb-db480747005a"] = {
  behavior: {
    abilities: [
      {
        id: "ddd-entrapment",
        type: "activated",
        costs: [{ type: "deplete", target: "source" }],
        targets: [{ id: "prey", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
        effects: [
          { type: "bind", id: "x", value: { type: "cardCost", target: { type: "selected", id: "prey" } } },
          { type: "moveCard", target: { type: "selected", id: "prey" }, to: "void" },
          { type: "addCounter", target: "source", counter: "token", amount: { type: "add", values: [{ type: "variable", id: "x" }, -1] } }
        ]
      },
      {
        id: "ddd-release",
        type: "activated",
        costs: [{ type: "deplete", target: "source" }],
        effects: [
          {
            type: "chooserSelectsNumber",
            chooser: "controller",
            storeAs: "x",
            effects: [
              { type: "removeCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } },
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "freed",
                  selector: {
                    owner: "self",
                    zone: "void",
                    type: "character",
                    conditions: [num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "=", { type: "variable", id: "x" })]
                  },
                  count: 1
                },
                effects: [{ type: "putIntoPlay", target: { type: "selected", id: "freed" }, controller: "controller" }]
              }
            ]
          }
        ]
      }
    ]
  }
};

// Digital Claywork Compendium
PATCH["5bb0adcd-38ae-467f-ad46-cd07c1e5e5ad"] = {
  behavior: {
    abilities: [
      {
        id: "dcc-untouchable",
        type: "continuous",
        modifiers: [],
        restrictions: [{ target: "source", restriction: "cannotBePicked" }]
      },
      {
        id: "dcc-research",
        type: "activated",
        costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
        effects: [{ type: "reduceNextCost", player: "controller", amount: 4 }]
      },
      {
        id: "dcc-smash-keys",
        type: "activated",
        costs: [{ type: "destroy", target: "source" }],
        effects: [{ type: "reduceNextCost", player: "controller", amount: 2 }]
      }
    ]
  }
};

// ============================================================ batch 2 ===

const optPickThen = (tid, selector, effects, extra = {}) => ({
  id: "etb-" + tid, type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
  targets: [{ id: tid, selector, count: 1, optional: true, ...extra }],
  effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: tid } }, effects }]
});
const charLoc = { type: "or", conditions: [
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "location" }
] };
const factionLoc = { type: "or", conditions: [
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" },
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "location" }
] };
const factionChar = { type: "or", conditions: [
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
  { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" }
] };

// Dizzying Blow
PATCH["b6b6b202-7629-49e6-a451-7b2e3feb6c11"] = {
  behavior: { abilities: [{
    id: "dizzying-blow", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] }, count: 1 }],
    effects: [
      { type: "dealDamage", target: { type: "selected", id: "c" }, amount: 1 },
      { type: "removeFromBattle", target: { type: "selected", id: "c" } },
      { type: "draw", player: "controller", amount: 1 }
    ]
  }] }
};

// Don't Trip
PATCH["1cb45623-65ab-4331-a189-68a57d0e9cdc"] = {
  behavior: { abilities: [{
    id: "dont-trip", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] }, count: 1 }],
    effects: [{ type: "transformBattleDamage", target: { type: "selected", id: "c" }, role: "dealer", kind: "redirectToSelf", duration: { type: "untilEndOfTurn" } }]
  }] },
  cardPatch: { flipUp: { cost: 3, threshold: "d" } }
};

// Dweedle Tee
PATCH["3714b3c6-39af-4c56-a508-ad389be90933"] = {
  behavior: { abilities: [
    { id: "dweedle-grow", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
      { target: "source", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
    ] },
    { id: "dweedle-bulge", type: "activated", threshold: "vvv",
      costs: [{ type: "oneOf", options: [[{ type: "payResources", amount: 3 }], [{ type: "shuffleDeck", player: "controller" }]] }, { type: "deplete", target: "source" }],
      effects: [
        { type: "bind", id: "y", value: { type: "thresholdIconCount", target: { type: "deckPosition", player: "controller", from: "top" } } },
        { type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top" }, to: "discard" },
        { type: "addCounter", target: "source", counter: "token", amount: { type: "variable", id: "y" } }
      ] }
  ] }
};

// Early Investment
PATCH["0178a457-888f-4e19-93c8-6475173566b4"] = {
  behavior: { abilities: [{
    id: "early-investment", type: "activated",
    targets: [{ id: "r", selector: { controller: "self", zone: "deck", type: "resource" }, count: 1, optional: true }],
    effects: [
      { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "r" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "r" }, to: "hand" }] },
      { type: "shuffleDeck", player: "controller" }
    ]
  }] },
  cardPatch: { selfDisposition: { to: "faceDownResource" } }
};

// Eldridge Gosche, Godstealer
const eldridgeBody = {
  targets: [{ id: "sprinkle", selector: { controller: "self", zone: "play", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "resource" } }] }, count: 3, optional: true }],
  effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "sprinkle" } }, effects: [
    { type: "chooserSelectsNumber", chooser: "controller", storeAs: "n", min: 0, max: 3, effects: [
      { type: "distributeAmong", chooser: "controller", selected: "sprinkle", amount: { type: "variable", id: "n" }, effects: [
        { type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: { type: "variable", id: "__amount" } }
      ] }
    ] }
  ] }]
};
PATCH["6d511d44-9e80-443b-b67c-ae9625d671dd"] = {
  behavior: { abilities: [
    { id: "eldridge-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, ...eldridgeBody },
    { id: "eldridge-death", type: "triggered", event: "cardDestroyed", condition: selfIsEvent, ...eldridgeBody },
    { id: "eldridge-rite", type: "activated",
      costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 2 }],
      targets: [{ id: "t", selector: { owner: "self", zone: ["void", "discard"], type: "tactic" }, count: 1 }],
      effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] },
    { id: "eldridge-tribute", type: "activated",
      costs: [{ type: "payResources", amount: 1 }, { type: "destroy", target: "source" }],
      targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
      effects: [
        { type: "chooserSelectsTarget", chooser: { type: "ownerOf", target: { type: "selected", id: "p" } },
          declaration: { id: "disc", selector: { owner: { type: "ownerOf", target: { type: "selected", id: "p" } }, zone: "hand" }, count: 2 },
          effects: [{ type: "forEach", selected: "disc", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }] },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] },
  cardPatch: { unique: "eldridge" }
};

// Espionage Loafers
PATCH["473c8d59-8f53-4454-8d9a-5186b0bc697a"] = {
  behavior: { abilities: [
    { id: "espionage-covert", type: "continuous",
      keywords: [{ target: "attachedTo", keyword: "covert" }],
      modifiers: [],
      grantedAbilities: [{ selector: { zone: "play", conditions: [{ type: "eventCardIs", target: "attachedTo" }] }, abilities: [
        { id: "espionage-backfire", type: "triggered", event: "damageDealt",
          condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: { type: "eventDamageAmount" } }] }
      ] }]
    },
    { id: "espionage-icon", type: "continuous", condition: num(rIcons("controller", "greed"), ">=", 5),
      keywords: [{ target: "attachedTo", keyword: "covert" }],
      modifiers: [],
      suppressAllAbilities: { target: "source" } }
  ] },
  cardPatch: { attachTo: "character" }
};

// Everlasting Blade of Light
PATCH["f83fd73a-13b6-46b8-a933-a46db57df8f7"] = {
  behavior: {
    keepOnHostLeave: true,
    abilities: [
      { id: "ebol-buff", type: "continuous", modifiers: [
        { target: "attachedTo", stat: "strength", operation: "add", value: 3 },
        { target: "attachedTo", stat: "life", operation: "add", value: 3 }
      ] },
      { id: "ebol-equip", type: "activated",
        targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
        variables: { x: { type: "conditional", if: { type: "uniqueIs", target: { type: "selected", id: "c" }, designations: ["rudolphus"] }, then: 0, else: 2 } },
        costs: [{ type: "payResources", amount: { type: "variable", id: "x" } }],
        effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "c" } }] },
      { id: "ebol-fusion", type: "activated",
        condition: { type: "uniqueIs", target: "attachedTo", designations: ["rudolphus"] },
        costs: [{ type: "payResources", amount: 1 }, { type: "destroy", target: "source" }],
        targets: [{ id: "tut", selector: { owner: "self", zone: "deck", name: "Vexillarius Dacian-Draco" }, count: 1 }],
        effects: [{ type: "putIntoPlay", target: { type: "selected", id: "tut" }, controller: "controller" }, { type: "shuffleDeck", player: "controller" }] }
    ]
  },
  cardPatch: { unique: "blade of light" }
};

// Expedition Advisor
const drawDiscard2 = [
  { type: "draw", player: "controller", amount: 2 },
  { type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "ditch", selector: { controller: "self", zone: "hand" }, count: 2 },
    effects: [{ type: "forEach", selected: "ditch", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }] }
];
PATCH["b2676ad4-73d9-4c30-abed-d197a93c03f3"] = {
  behavior: { abilities: [
    { id: "expedition-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [
      { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Decline", effects: [] },
        { label: "Draw 2, then discard 2", effects: drawDiscard2 }
      ] }
    ] },
    { id: "expedition-recur", type: "activated", activationZone: "discard", threshold: "ggg",
      costs: [{ type: "payResources", amount: 1 }, { type: "removeFromGame", target: "source" }],
      effects: drawDiscard2 }
  ] }
};

// Ferret Oil Coating
PATCH["e92ff486-08f4-48c6-b76e-1d866108f1f0"] = {
  behavior: { abilities: [{
    id: "ferret-oil", type: "continuous", modifiers: [],
    restrictions: [{ target: "attachedTo", restriction: "mustBePicked" }]
  }] },
  cardPatch: { attachTo: "character", flipUp: { cost: 1, threshold: "dd" } }
};

// Final Countdown
PATCH["66238cd1-a654-4900-8cb0-775bb6df6c17"] = {
  behavior: { abilities: [{
    id: "final-countdown", type: "activated",
    condition: { type: "isActivePlayer", player: "controller" },
    effects: [
      { type: "draw", player: "controller", amount: 4 },
      { type: "scheduleEffect", when: "startOfOpponentNextTurn", effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "det", selector: { controller: "self", zone: "play", type: "resource", staple: true }, count: 3, optional: true },
          effects: [{ type: "forEach", selected: "det", effects: [{ type: "detach", target: { type: "selected", id: "__candidate" } }] }] },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "buff", selector: { controller: "self", zone: "play", type: "character" }, count: 1 },
          effects: [{ type: "createModifier", target: { type: "selected", id: "buff" }, stat: "life", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }] },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "res", selector: { controller: "self", zone: "play", type: "character" }, count: 1 },
          effects: [{ type: "restore", target: { type: "selected", id: "res" } }] }
      ] }
    ]
  }] }
};

// Fire Tail Kamikaze
PATCH["6ca40ab8-482e-4340-80f1-5c63fba1f8fd"] = {
  behavior: { abilities: [
    { ...optPickThen("t", { zone: "play", type: "character" }, [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]), id: "ftk-etb" },
    { id: "ftk-death", type: "triggered", event: "cardDestroyed", condition: selfIsEvent,
      targets: [{ id: "d", selector: { zone: "play", conditions: [factionLoc] }, count: 1, optional: true }],
      effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "d" } }, effects: [{ type: "dealDamage", target: { type: "selected", id: "d" }, amount: 3 }] }] }
  ] }
};

// Fire Tail Kocktail
PATCH["6261ae53-c180-4ae6-8027-c2ad3ab8ebea"] = {
  behavior: { abilities: [{
    id: "fire-tail-kocktail", type: "activated",
    condition: { type: "not", condition: { type: "battleActive" } },
    targets: [{ id: "c", selector: { zone: "play", conditions: [charLoc] }, count: 1 }],
    effects: [{ type: "dealDamage", target: { type: "selected", id: "c" }, amount: 2 }, { type: "draw", player: "controller", amount: 1 }]
  }] }
};

// Flashy Bangs
PATCH["5c78097b-5ba3-4417-96af-a465cd276977"] = {
  behavior: { abilities: [{
    id: "flashy-bangs-burst", type: "activated",
    costs: [{ type: "destroy", target: "source" }],
    targets: [{ id: "b", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] }, count: 1 }],
    effects: [{ type: "removeFromBattle", target: { type: "selected", id: "b" } }, { type: "deplete", target: { type: "selected", id: "b" } }]
  }] },
  cardPatch: { flipUp: { cost: 1, threshold: "dd" } }
};

// Forbidden Bibliotheca
PATCH["dd781007-94ae-48b3-a0dc-7a3a3d983bcf"] = {
  behavior: { abilities: [
    { id: "bib-tokens", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 3 }] },
    { id: "bib-structure", type: "continuous", modifiers: [{ target: "source", stat: "structure", operation: "add", value: { type: "counter", target: "source", counter: "token" } }] },
    { id: "bib-research", type: "activated",
      costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: 2 }],
      effects: [
        { type: "addCounter", target: "source", counter: "token", amount: 1 },
        { type: "draw", player: "controller", amount: 2 },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "bot", selector: { controller: "self", zone: "hand" }, count: 1 },
          effects: [{ type: "moveCard", target: { type: "selected", id: "bot" }, to: "deck", position: "bottom" }] }
      ] },
    { id: "bib-checkout", type: "activated",
      costs: [{ type: "deplete", target: "source" }, { type: "removeCounter", target: "source", counter: "token", amount: 2 }],
      effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "od", selector: { controller: "opponent", zone: "hand" }, count: 2 },
        effects: [{ type: "forEach", selected: "od", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }] }] }
  ] },
  cardPatch: { unique: "bibliotheca" }
};

// Form 37-Ohhhhh
PATCH["e08c5f24-ac13-407b-acc6-dce6be5e415d"] = {
  behavior: { abilities: [
    { id: "form37-covert", type: "continuous",
      condition: num({ type: "count", selector: { controller: "self", zone: "play", type: "character" } }, "=", 1),
      keywords: [{ target: "attachedTo", keyword: "covert" }], modifiers: [] },
    { id: "form37-draw", type: "continuous", modifiers: [],
      grantedAbilities: [{ selector: { zone: "play", conditions: [{ type: "eventCardIs", target: "attachedTo" }] }, abilities: [
        { id: "form37-granted", type: "triggered", event: "damageDealt",
          condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
          effects: [{ type: "draw", player: "controller", amount: 2 }] }
      ] }] }
  ] },
  cardPatch: { attachTo: "character" }
};

// Fwing Snipe
PATCH["60944019-3b31-486d-8016-0da9a4f68221"] = {
  behavior: {
    keywords: ["tactical"],
    abilities: [{
      id: "fwing-snipe-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1, optional: true }],
      effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } }, effects: [
        { type: "createModifier", target: { type: "selected", id: "c" }, stat: "speed", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } },
        { type: "if", condition: num({ type: "random", min: 1, max: 2 }, "=", 1), effects: [
          { type: "createModifier", target: { type: "selected", id: "c" }, stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }
        ] }
      ] }]
    }]
  }
};

// Gargoyle of Cathédrale de Mau
PATCH["3613d871-43b0-4239-8dbd-3eee381d6a61"] = {
  behavior: {
    onPlay: { costs: [{ type: "loseInfluence", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 3 }] },
    abilities: [
      { id: "gargoyle-tactical", type: "continuous", activeZone: "hand",
        condition: { type: "battleTargetIs", controlledBy: "controller", cardType: "location" },
        keywords: [{ target: "source", keyword: "tactical" }], modifiers: [] },
      { id: "gargoyle-no", type: "activated",
        costs: [{ type: "discard", id: "no-d", player: "controller", selector: { controller: "self", zone: "hand" }, count: 2 }],
        effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }, { type: "moveCard", target: "source", to: "hand" }] }
    ]
  }
};

// Gathering of Unlikely Heroes
PATCH["b8166db8-01ba-4103-bfee-dfece934c330"] = {
  behavior: { abilities: [{
    id: "gathering-heroes", type: "activated",
    condition: { type: "and", conditions: [{ type: "isActivePlayer", player: "controller" }, { type: "not", condition: { type: "battleActive" } }] },
    targets: [{ id: "p", selector: { owner: "opponent", zone: "play", type: "faction" }, count: 1 }],
    effects: [
      { type: "nameValue", chooser: { type: "ownerOf", target: { type: "selected", id: "p" } }, valueKind: "trade", storeAs: "t1" },
      { type: "nameValue", chooser: { type: "ownerOf", target: { type: "selected", id: "p" } }, valueKind: "trade", storeAs: "t2" },
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "hero", selector: { controller: "self", zone: "deck", type: "character", tradeVar: ["t1", "t2"] }, count: 1, optional: true },
        effects: [{ type: "moveCard", target: { type: "selected", id: "hero" }, to: "hand" }] },
      { type: "shuffleDeck", player: "controller" },
      { type: "draw", player: "controller", amount: 1 }
    ]
  }] }
};

// Gnarling Lupine
PATCH["b05d2a5d-9ffc-471a-a1df-47ceacfded10"] = {
  behavior: { abilities: [{
    id: "gnarling-rend", type: "activated", usesPerTurn: 1,
    costs: [{ type: "destroy", target: { type: "random", selector: { controller: "self", zone: "play", type: "resource", faceDown: true } } }],
    effects: [
      { type: "createModifier", target: "source", stat: "strength", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } },
      { type: "createModifier", target: "source", stat: "life", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } },
      { type: "createModifier", target: "source", stat: "speed", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }
    ]
  }] }
};

// Gruesome Sand Beaver
PATCH["b06870bd-3309-497b-83ca-6a2bbed38391"] = {
  behavior: {
    keywords: ["covert"],
    onPlay: {
      targets: [{ id: "fd", selector: { controller: "self", zone: "play", type: "resource", faceDown: true }, count: 1 }],
      effects: [{ type: "moveCard", target: { type: "selected", id: "fd" }, to: "hand" }]
    }
  }
};

// Guardbeast of Thabbash
PATCH["f2890e06-fa66-41a2-b0f0-6e4b4807a907"] = {
  behavior: { abilities: [
    { id: "guardbeast-covert", type: "continuous", condition: num(rIcons("controller", "obsession"), ">=", 4),
      keywords: [{ target: "source", keyword: "covert" }], modifiers: [] },
    { id: "guardbeast-block", type: "continuous", condition: num(rIcons("controller", "volition"), ">=", 4),
      keywords: [{ target: "source", keyword: "canBlockAnyParty" }], modifiers: [] }
  ] }
};

// Guardforce Aggromajig
PATCH["01750977-01af-4db3-bf26-5b5822eddb76"] = {
  behavior: {
    keywords: ["aggro"],
    abilities: [{ id: "guardforce-depleted", type: "continuous",
      condition: { type: "cardDepleted", target: "source" },
      modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }]
  }
};

// Hasty Pursuit
PATCH["8f8af0b4-2e83-48e5-9c84-4fdcecfbbbd1"] = {
  behavior: { abilities: [{
    id: "hasty-pursuit", type: "activated",
    condition: { type: "isActivePlayer", player: "controller" },
    effects: [
      { type: "grantKeywordToPlayer", player: "controller", keyword: "aggro", duration: { type: "untilEndOfTurn" } },
      { type: "draw", player: "controller", amount: 1 }
    ]
  }] },
  cardPatch: { flipUp: { cost: 4, threshold: "eee", effects: [
    { type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "dep", selector: { zone: "play", type: "character" }, count: 2, optional: true },
      effects: [{ type: "forEach", selected: "dep", effects: [{ type: "deplete", target: { type: "selected", id: "__candidate" } }] }] }
  ] } }
};

// Hate of Man
PATCH["57e9f3a9-92c5-4e35-8a1b-31c27b204cfc"] = {
  behavior: { abilities: [
    { id: "hate-of-man-aura", type: "continuous", modifiers: [
      { target: "source", stat: "life", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } },
      { selector: { zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "cardTradeIs", target: { type: "selected", id: "__candidate" }, trade: "arcanist" } }] },
        stat: "strength", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } }
    ] },
    { id: "hate-of-man-spread", type: "activated",
      costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
  ] }
};

// Heavy Fists of Robotic Pounding
PATCH["5a6b4473-eb1d-4e71-86ee-49f9462d9d35"] = {
  behavior: { abilities: [
    { id: "heavy-fists-buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: 3 },
      { target: "attachedTo", stat: "life", operation: "add", value: 3 }
    ] },
    { id: "heavy-fists-mute", type: "continuous", modifiers: [], suppressAllAbilities: { target: "attachedTo" } },
    { id: "heavy-fists-handoff", type: "activated",
      costs: [{ type: "payResources", amount: 2 }, { type: "depleteSelected", declarationId: "hf" }],
      targets: [{ id: "hf", selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: { type: "selected", id: "__candidate" } } }] }, count: 1 }],
      effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "hf" } }] }
  ] },
  cardPatch: { attachTo: "character" }
};

// Horns of Thabbash
PATCH["7e5943c6-1683-4ba0-a762-e0ac3dbdd6b8"] = {
  behavior: { abilities: [
    { id: "horns-buff", type: "continuous",
      modifiers: [
        { target: "attachedTo", stat: "strength", operation: "add", value: 1 },
        { target: "attachedTo", stat: "life", operation: "add", value: 1 }
      ],
      restrictions: [{ target: "attachedTo", restriction: "cannotBlock" }] },
    { id: "horns-icon", type: "continuous", condition: num(rIcons("controller", "volition"), ">=", 3),
      modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 3 }] }
  ] },
  cardPatch: { attachTo: "character" }
};

// I See You!
PATCH["1866ab78-bc4c-4181-8556-73a0f675686e"] = {
  behavior: { abilities: [{
    id: "i-see-you", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "hasKeyword", target: { type: "selected", id: "__candidate" }, keyword: "covert" }] }, count: 1 }],
    effects: [
      { type: "suppressKeyword", target: { type: "selected", id: "c" }, keyword: "covert", duration: { type: "untilEndOfTurn" } },
      { type: "if", condition: num(rIcons("controller", "volition"), ">=", 3), effects: [
        { type: "createModifier", target: { type: "selected", id: "c" }, stat: "speed", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }
      ] }
    ]
  }] },
  cardPatch: {
    selfDisposition: { to: "faceDownResource" },
    flipUp: { cost: 3, threshold: "ee", effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "burn", selector: { controller: "self", zone: "play", type: "resource" }, count: 1 },
        effects: [{ type: "destroy", target: { type: "selected", id: "burn" } }] }
    ] }
  }
};

// iDumb De-Itemizer
PATCH["a0403283-f513-4822-9e8d-afc862ff08b3"] = {
  behavior: { abilities: [
    { id: "idumb-mute", type: "continuous", modifiers: [], suppressAllAbilities: { target: "attachedTo" } },
    { id: "idumb-reset", type: "activated", usableBy: "opponent",
      costs: [{ type: "payResources", amount: 3 }],
      effects: [{ type: "suppressAbilities", target: "source", duration: { type: "untilEndOfTurn" } }] }
  ] },
  cardPatch: { attachTo: "item", flipUp: { cost: 2, threshold: "g" } }
};

// Ignatius Gloamspike
PATCH["7b6a4bfc-b116-4695-a4d8-86f59e0b140c"] = {
  behavior: { abilities: [
    { id: "ignatius-attack", type: "triggered", event: "characterAttacked", condition: selfIsEvent,
      effects: [{ type: "lookAndReorder", player: "controller", count: 2, to: "split" }] },
    { id: "ignatius-faction", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
      effects: [
        { type: "lookAndReorder", player: { type: "ownerOf", target: "eventCard" }, chooser: "controller", count: 2, to: "split" },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] },
  cardPatch: { unique: "ignatious" }
};

// Impeccable Triggerman
PATCH["adf72007-3003-45a5-91ab-432b2502a403"] = {
  behavior: { abilities: [
    { id: "triggerman-enters-depleted", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "deplete", target: "source" }] },
    { id: "triggerman-assassinate", type: "activated",
      costs: [{ type: "deplete", target: "source" }],
      targets: [{ id: "v", selector: { zone: "play", type: "character", depleted: true }, count: 1 }],
      effects: [{ type: "if", condition: { type: "statCompare", target: { type: "selected", id: "v" }, stat: "life", operator: "<=", value: 4 }, effects: [{ type: "destroy", target: { type: "selected", id: "v" } }] }] },
    { id: "triggerman-reload", type: "activated",
      costs: [{ type: "payResources", amount: 3 }],
      effects: [{ type: "restore", target: "source" }, { type: "grantRestriction", target: "source", restriction: "cannotAttack", duration: { type: "untilEndOfTurn" } }] }
  ] }
};

// Improved Micromajig
PATCH["fd7b002f-06a7-4a9e-b9ee-cdbd9897a7c9"] = {
  behavior: { abilities: [
    { id: "improved-mm-grow", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
      { target: "source", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
    ] },
    { id: "improved-mm-assemble", type: "activated",
      costs: [{ type: "payResources", amount: 2 }, { type: "destroy", target: { type: "random", selector: { controller: "self", zone: "play", name: "Micromajig" } } }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
    { id: "improved-mm-detach", type: "activated",
      costs: [{ type: "payResources", amount: 2 }, { type: "removeCounter", target: "source", counter: "token", amount: 1 }],
      effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICROMAJIG }] }
  ] }
};

// Inebriated Defenestration
PATCH["ebac9b53-26af-491e-b251-a43a908d992f"] = {
  behavior: { abilities: [{
    id: "inebriated-defenestration", type: "activated",
    effects: [{ type: "mill", player: "opponent", count: 5 }, { type: "draw", player: "controller", amount: 2 }]
  }] }
};

// Infectious Pustulio
PATCH["d8bbaab9-b156-48c4-abb7-967d8fdfb82b"] = {
  behavior: { abilities: [{
    id: "infectious-pustulio", type: "activated",
    condition: { type: "not", condition: { type: "battleActive" } },
    effects: []
  }, {
    id: "infectious-pustulio-blocked", type: "triggered", event: "attackerBlocked",
    condition: { type: "eventCardIs", target: "attachedTo" },
    effects: [{ type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] },
      effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }]
  }] },
  cardPatch: { attachTo: "character" }
};

// ============================================================ batch 3 ===

const notInBattle = { type: "not", condition: { type: "battleActive" } };
const notResource = c => ({ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: c || "__candidate" }, cardType: "resource" } });

// Keep Pushing
PATCH["742847e8-f11d-4f8c-9fba-e5e891d6f308"] = {
  behavior: { abilities: [{
    id: "keep-pushing", type: "activated",
    condition: notInBattle,
    costs: [{ type: "destroy", target: { type: "selected", id: "res" } }],
    targets: [
      { id: "res", selector: { controller: "self", zone: "play", type: "resource" }, count: 1 },
      { id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "statCompare", target: { type: "selected", id: "__candidate" }, stat: "strength", operator: "<=", value: 3 }] }, count: 1 }
    ],
    effects: [{ type: "restore", target: { type: "selected", id: "c" } }, { type: "draw", player: "controller", amount: 1 }]
  }] }
};

// Leaping Sarume
PATCH["3a90b12f-8ecf-42eb-b67b-9b1c5abf0ddf"] = {
  behavior: {
    keywords: ["tactical"],
    onPlay: { condition: notInBattle },
    abilities: [
      { id: "leaping-sarume-aoe", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
        effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }] },
      { id: "leaping-sarume-icon-aoe", type: "triggered", event: "cardEnteredPlay",
        condition: { type: "and", conditions: [selfIsEvent, num(rIcons("controller", "rage"), ">=", 6)] },
        effects: [{ type: "forEach", selector: { controller: "opponent", zone: "play", type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }] }
    ]
  }
};

// Lingamite Descendant
PATCH["15670fc7-d664-47a4-8b52-6d4945e48efc"] = {
  behavior: { abilities: [{
    id: "lingamite-descendant", type: "continuous", modifiers: [],
    damageModifiers: [{
      selector: { zone: "play", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }, { type: "eventCardIs", target: "source" }] },
      battleOnly: true, delta: -999
    }]
  }] }
};

// Low-hanging Clothesline
PATCH["40b073e3-5e51-45c4-b95e-4a1dfc06f3c1"] = {
  behavior: { abilities: [{
    id: "low-hanging-clothesline", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character", depleted: true }, count: 1 }],
    effects: [{ type: "if", condition: { type: "statCompare", target: { type: "selected", id: "c" }, stat: "life", operator: ">=", value: 5 }, effects: [{ type: "destroy", target: { type: "selected", id: "c" } }] }]
  }] }
};

// Loyal Companion
PATCH["66f28631-377f-4671-a133-429f9b3dc309"] = {
  behavior: {
    keywords: ["tactical"],
    abilities: [
      { id: "loyal-helping-paw", type: "activated", activationZone: "hand", threshold: "d",
        costs: [{ type: "discard", id: "lc-self", player: "controller", selector: { controller: "self", zone: "hand", name: "Loyal Companion" }, count: 1 }, { type: "payResources", amount: 4 }],
        targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" } }] }, count: 1 }],
        effects: [
          { type: "createModifier", target: { type: "selected", id: "c" }, stat: "strength", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } },
          { type: "createModifier", target: { type: "selected", id: "c" }, stat: "life", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } }
        ] },
      { id: "loyal-nine-lives", type: "activated", activationZone: "discard", threshold: "d",
        costs: [{ type: "payResources", amount: 5 }],
        effects: [{ type: "putIntoPlay", target: "source", controller: "controller" }] }
    ]
  }
};

// Lunk Nut
PATCH["f2e09c65-9f7c-4826-bec1-d1cdb59fa0ea"] = {
  behavior: { abilities: [{
    id: "lunk-nut-restore", type: "triggered", event: "turnStarted",
    condition: { type: "eventPlayerIs", player: "opponent" },
    effects: [{ type: "restore", target: "source" }]
  }] }
};

// Marduun Ruins
PATCH["9290edea-a120-4ac9-8b9b-74a86fdb2797"] = {
  behavior: { abilities: [{
    id: "marduun-ruins-aura", type: "continuous",
    modifiers: [
      { selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "textMentionsIcon", target: { type: "selected", id: "__candidate" }, icon: "volition" }] }, stat: "strength", operation: "add", value: 2 },
      { selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "textMentionsIcon", target: { type: "selected", id: "__candidate" }, icon: "volition" }] }, stat: "life", operation: "add", value: 2 }
    ]
  }] },
  cardPatch: { unique: "marduun ruins" }
};

// Mass Subjugation
PATCH["8cf97959-4bda-43f0-b1c5-e2661c814c8c"] = {
  behavior: { abilities: [{
    id: "mass-subjugation", type: "activated",
    condition: { type: "and", conditions: [{ type: "isActivePlayer", player: "controller" }, notInBattle] },
    effects: [{ type: "forEach", selector: { zone: "play", type: "character", conditions: [num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, ">=", 1), num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "<=", 3)] }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
  }] },
  cardPatch: { flipUp: { cost: 3, threshold: "ggg" } }
};

// Meh, another Living God
PATCH["ac36f169-a54b-4992-aa1e-b9a4cf2aac70"] = {
  behavior: {},
  cardPatch: { flipUp: { cost: 7, threshold: "o" } }
};

// Microdefense Autosystem
PATCH["bb150c67-60c5-4582-8712-224ea083393f"] = {
  behavior: { abilities: [{
    id: "microdefense-autosystem", type: "triggered", event: "blockingPartyFormed",
    condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{
      type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICROMAJIG, effects: [{ type: "addToBattle", target: { type: "selected", id: "__candidate" }, side: "blocking" }] }]
    }]
  }] }
};

// Motivational Dancer
PATCH["140683e9-c454-48cd-9230-647becd02e66"] = {
  behavior: { abilities: [
    { id: "motiv-dancer-eot", type: "triggered", event: "turnEnding", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "d", selector: { zone: "play", type: "character" }, count: 1 },
          effects: [{ type: "deplete", target: { type: "selected", id: "d" } }, { type: "skipNextRestore", target: { type: "selected", id: "d" } }] }
      ] }] },
    { id: "motiv-dancer-private", type: "activated",
      costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }],
      targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
      effects: [{ type: "deplete", target: { type: "selected", id: "c" } }] },
    { id: "motiv-dancer-payup", type: "activated",
      costs: [{ type: "payResources", amount: 1 }, { type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 1 }, { type: "deplete", target: "source" }],
      targets: [{ id: "c", selector: { zone: "play", type: "character", depleted: true }, count: 1 }],
      effects: [{ type: "dealDamage", target: { type: "selected", id: "c" }, amount: 1 }] }
  ] }
};

// Night-basking Basilisk
PATCH["0350dd91-0ba4-43d6-b470-bb66d4746bef"] = {
  behavior: {
    keywords: ["covert"],
    onPlay: { costAdjust: { type: "conditional", if: num(rIcons("controller", "obsession"), ">=", 6), then: -4, else: 0 } }
  }
};

// Node in a Box
PATCH["15172964-a78f-4d08-bf1c-5b80eb02f544"] = {
  behavior: { abilities: [
    { id: "node-box-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "node", selector: { controller: "self", zone: "deck", subtype: "node" }, count: 1, optional: true },
        effects: [{ type: "moveCard", target: { type: "selected", id: "node" }, to: "hand" }, { type: "shuffleDeck", player: "controller" }] }] },
    { id: "node-box-flip", type: "replacement", replaces: { event: "destroy", controlledBy: "self" },
      optional: true, optionalCost: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "flipFaceDown", target: { type: "selected", id: "__candidate" } }] },
    { id: "node-box-death", type: "triggered", event: "cardDestroyed", condition: selfIsEvent,
      effects: [{ type: "forEach", selector: { zone: "play", subtype: "node", conditions: [{ type: "not", condition: { type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "source" } }] }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }
  ] }
};

// Ocular Dispersal
PATCH["5668c682-8404-49c1-ae1c-0a73ee46ca1c"] = {
  behavior: { abilities: [
    { id: "ocular-dispersal-attach", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{ type: "transformBattleDamage", target: "attachedTo", role: "dealer", kind: "setAmount", amount: { type: "cardCost", target: "attachedTo" }, duration: { type: "whileSourceInPlay" } }] },
    { id: "ocular-dispersal-flip", type: "replacement", replaces: { event: "destroy" },
      effects: [{ type: "flipFaceDown", target: { type: "selected", id: "__candidate" } }] }
  ] },
  cardPatch: { attachTo: "character" }
};

// Offering of False Friendship
PATCH["7e7c80fc-1697-426e-b962-768196f6f2da"] = {
  behavior: { abilities: [{
    id: "offering-false-friendship", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
    effects: [{
      type: "mayPay", player: "opponent", costs: [{ type: "payResources", amount: 2 }],
      effects: [],
      elseEffects: [{ type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: { type: "selected", id: "c" } }] }, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "deck", position: "bottom" }] }]
    }]
  }] }
};

// Overly Eager Exemplar
PATCH["5f7c48c3-2413-4f85-87f3-8c9ed04046ec"] = {
  behavior: { abilities: [{
    id: "for-my-brothers", type: "activated",
    costs: [{ type: "payResources", amount: 1 }, { type: "destroy", target: "source" }],
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "s", selector: { controller: "self", zone: "deck", subtype: "soldier" }, count: 1, optional: true },
      effects: [{ type: "moveCard", target: { type: "selected", id: "s" }, to: "hand" }, { type: "shuffleDeck", player: "controller" }] }]
  }] }
};

// Personal God Shrine
PATCH["cec75dc5-9874-4e69-83a3-7557a34aa093"] = {
  behavior: { abilities: vCycle("personal-god-shrine", "controller", [
    { type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 3 }], effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "g", selector: { owner: "self", zone: "discard", conditions: [charLoc] }, count: 1, optional: true },
        effects: [{ type: "moveCard", target: { type: "selected", id: "g" }, to: "deck", position: "top" }] }
    ] }
  ]) }
};

// Phantasmagoric Tollbooth
// CONCESSION: "if a non-token character would enter play under an opponent's
// control" is a true enters-play replacement, which the engine does not
// model (moveToZone replacements only fire on LEAVING play). Authored as a
// `cardEnteredPlay` trigger + `mayPay` — the character enters play, then its
// controller pays 1 or it is put into its owner's discard pile. The only
// fidelity loss is that the entering character's own ETB resolves before
// the possible discard.
PATCH["d70efc6c-9a6e-41ab-92a2-cb97662f172f"] = {
  behavior: { abilities: [
    { id: "tollbooth-gate", type: "triggered", event: "cardEnteredPlay",
      condition: { type: "and", conditions: [
        { type: "cardTypeIs", target: "eventCard", cardType: "character" },
        { type: "eventCardControlledBy", player: "opponent" },
        { type: "not", condition: { type: "isToken", target: "eventCard" } }
      ] },
      effects: [{ type: "mayPay", player: { type: "controllerOf", target: "eventCard" },
        costs: [{ type: "payResources", amount: 1 }],
        effects: [],
        elseEffects: [{ type: "moveCard", target: "eventCard", to: "discard" }] }] },
    { id: "tollbooth-toll", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [
        num(rIcons("controller", "rage"), ">=", 6),
        { type: "cardMovedToZone", zone: "discard" },
        { type: "cardTypeIs", target: "eventCard", cardType: "character" },
        { type: "eventCardControlledBy", player: "opponent" }
      ] },
      effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "f", selector: { zone: "play", type: "faction" }, count: 1 },
          effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 1 }] }
      ] }] }
  ] },
  cardPatch: { unique: "tollbooth" }
};

// Predatory Lamp
PATCH["81210e8c-62b8-4536-b078-00611f6542fd"] = {
  behavior: {
    keywords: ["covert"],
    abilities: [
      { id: "predatory-lamp-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
        targets: [{ id: "v", selector: { zone: "play", type: "character", conditions: [{ type: "hasKeyword", target: { type: "selected", id: "__candidate" }, keyword: "covert" }] }, count: 1, optional: true }],
        effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "v" } }, effects: [{ type: "rememberTarget", key: "victim", target: { type: "selected", id: "v" } }] }] },
      { id: "predatory-lamp-mute", type: "continuous", modifiers: [],
        suppressKeywords: [{ target: { type: "remembered", key: "victim" }, keyword: "covert" }] }
    ]
  }
};

// President Model #16
PATCH["b65432a8-bc4e-40d3-9dfa-78dcfb2403b6"] = {
  behavior: { abilities: [
    { id: "president-16-tokens", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "add", values: [9, { type: "multiply", values: [{ type: "resourceIcons", player: "controller", icon: "greed" }, -1] }] } }] },
    { id: "president-16-shrink", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } },
      { target: "source", stat: "life", operation: "add", value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] } }
    ] }
  ] }
};

// Prime Titan
PATCH["904f34cf-c340-4bfd-941b-3d1bb9178843"] = {
  behavior: { abilities: [
    { id: "prime-titan-grow", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
      { target: "source", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
    ] },
    { id: "prime-titan-load", type: "activated",
      costs: [{ type: "payResources", amount: 1 }, { type: "destroy", target: { type: "random", selector: { controller: "self", zone: "play", name: "Micromajig" } } }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
    { id: "prime-titan-unload", type: "activated", threshold: "eeeee",
      variables: { x: 0 },
      variableBounds: { x: { min: 0, max: { type: "counter", target: "source", counter: "token" } } },
      costs: [{ type: "deplete", target: "source" }, { type: "removeCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }, { type: "payResources", amount: { type: "variable", id: "x" } }],
      targets: [{ id: "t", selector: { zone: "play", conditions: [{ type: "or", conditions: [
        { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "location" },
        { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
        { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" }
      ] }] }, count: 1 }],
      effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: { type: "variable", id: "x" } }] }
  ] },
  cardPatch: { unique: "pt" }
};

// Profane Proposal
PATCH["7f75ce4c-b81e-45a9-973a-1bbe50fb43e4"] = {
  behavior: { abilities: [{
    id: "profane-proposal", type: "activated",
    targets: [
      { id: "p", selector: { owner: "opponent", zone: "play", type: "faction" }, count: 1 },
      { id: "found", selector: { controller: "self", zone: "deck" }, count: 5, distinctNames: true }
    ],
    effects: [
      { type: "separateIntoPiles", splitter: { type: "ownerOf", target: { type: "selected", id: "p" } }, selected: "found",
        pile1: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }],
        pile2: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "deck", position: "bottom" }] },
      { type: "shuffleDeck", player: "controller" }
    ]
  }] }
};

// Public Defender Intern
PATCH["44f451d3-23c1-40bd-8a79-095804ee5856"] = {
  behavior: { abilities: [{ id: "public-defender-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
};

// Puerile Ecto-Manipulator
PATCH["2a429a6d-402e-4d98-8479-58eb348335d7"] = {
  behavior: { abilities: [{
    ...optPickThen("nr", { zone: "play", conditions: [notResource()] }, [{ type: "addCounter", target: { type: "selected", id: "nr" }, counter: "token", amount: 1 }]),
    id: "puerile-ecto-etb"
  }] }
};

// Rapacious Soldier
PATCH["b1ca8db9-a359-46d8-a656-cb5ffadd68a4"] = {
  behavior: { abilities: [{ id: "rapacious-soldier", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBlock" }] }] }
};

// RC Flashlight
PATCH["4025a8f7-ffbe-45b0-ae3c-41624ea54b33"] = {
  behavior: { keywords: ["cannotBeBlocked", "canBlockCovert"] }
};

// Religious Rejection
PATCH["efa822c3-c417-4513-ad18-4b40fc3649d5"] = {
  behavior: { abilities: [{
    id: "religious-rejection", type: "activated",
    targets: [{ id: "c", selector: { zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "hasAttachment", target: { type: "selected", id: "__candidate" }, ofType: "item" } }] }, count: 1 }],
    effects: [
      { type: "destroy", target: { type: "selected", id: "c" } },
      { type: "if", condition: num(rIcons("controller", "volition"), ">=", 3), effects: [{ type: "draw", player: "controller", amount: 1 }] }
    ]
  }] }
};

// Resurrecting Necromorph
PATCH["f8c756cc-9ee5-4429-9b90-b38e2b8585fa"] = {
  behavior: { abilities: [{
    id: "resurrecting-necromorph", type: "triggered", event: "cardMoved", triggerZone: "discard",
    condition: { type: "and", conditions: [
      { type: "sourceInZone", zone: "discard" },
      { type: "cardMovedFromZone", zone: "play" },
      { type: "cardMovedToZone", zone: "discard" },
      { type: "cardTypeIs", target: "eventCard", cardType: "character" },
      { type: "eventCardControlledBy", player: "controller" },
      { type: "not", condition: { type: "eventCardIs", target: "source" } }
    ] },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [
      { type: "putIntoPlay", target: "source", controller: "controller" },
      { type: "deplete", target: "source" }
    ] }]
  }] }
};

// Rudo Mangod, Holder of Light
PATCH["baa7224f-39ee-4e4b-8788-1f190dbb38f0"] = {
  behavior: { abilities: [
    { id: "rudo-mangod-aura", type: "continuous",
      condition: { type: "not", condition: { type: "cardDepleted", target: "source" } },
      modifiers: [
        { selector: { controller: "self", zone: "play", type: "character" }, stat: "strength", operation: "add", value: 1 },
        { selector: { controller: "self", zone: "play", type: "character" }, stat: "life", operation: "add", value: 1 }
      ] },
    { id: "rudo-mangod-restore", type: "triggered", event: "turnStarted",
      condition: { type: "hasAttachment", target: "source", ofSubtype: "gear" },
      effects: [{ type: "restore", target: "source" }] }
  ] },
  cardPatch: { unique: "rudolphus" }
};

// Runic Distribulator
PATCH["5da0f895-473d-45a1-a6a7-5fd1293344fd"] = {
  behavior: { abilities: [
    { id: "runic-load", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
    { id: "runic-gather", type: "activated",
      effects: [{ type: "chooserSelectsNumber", chooser: "controller", storeAs: "x", effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "src", selector: { controller: "self", zone: "play" }, count: 1 },
          effects: [{ type: "removeCounter", target: { type: "selected", id: "src" }, counter: "token", amount: { type: "variable", id: "x" } }] },
        { type: "addCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }
      ] }],
      costs: [] },
    { id: "runic-spread", type: "activated",
      costs: [{ type: "payResources", amount: 3 }, { type: "destroy", target: "source" }],
      targets: [{ id: "spread", selector: { controller: "self", zone: "play", conditions: [notResource()] }, count: 99, optional: true }],
      effects: [{ type: "bind", id: "x", value: { type: "counter", target: "source", counter: "token" } },
        { type: "distributeAmong", chooser: "controller", selected: "spread", amount: { type: "variable", id: "x" }, effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: { type: "variable", id: "__amount" } }] }] }
  ] }
};

// Scrapple-Jack
PATCH["758adb58-e5d6-47c2-9545-a06561dfc92a"] = {
  behavior: { abilities: [{
    id: "scrapple-jack-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Decline", effects: [] },
      { label: "Destroy a Micromajig token, then grab an item from your discard", effects: [
        { type: "destroy", target: { type: "random", selector: { controller: "self", zone: "play", name: "Micromajig" } } },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "it", selector: { owner: "self", zone: "discard", type: "item" }, count: 1, optional: true },
          effects: [{ type: "moveCard", target: { type: "selected", id: "it" }, to: "hand" }] }
      ] }
    ] }]
  }] }
};

// Seance Sensor
PATCH["5a8d4a87-61b2-4e20-899c-250830e15eca"] = {
  behavior: { abilities: [
    { id: "seance-tokens", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 2 }] },
    { id: "seance-seize", type: "activated",
      costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }, { type: "deplete", target: "source" }],
      targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
      effects: [{ type: "chooserSelectsTarget", chooser: { type: "ownerOf", target: { type: "selected", id: "p" } },
        declaration: { id: "d", selector: { owner: { type: "ownerOf", target: { type: "selected", id: "p" } }, zone: "hand" }, count: 1 },
        effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }] }] },
    { id: "seance-absorb", type: "activated",
      costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
  ] }
};

// Seriously Weird Crystalline Artefact
PATCH["a341e5b6-b513-45f6-b25b-d27edbe20305"] = {
  behavior: { abilities: [
    { id: "swca-recycle", type: "activated",
      costs: [{ type: "payResources", amount: 3 }],
      targets: [{ id: "junk", selector: { owner: "self", zone: "discard", conditions: [notResource()] }, count: 1 }],
      effects: [
        { type: "rememberTarget", key: "junk", target: { type: "selected", id: "junk" } },
        { type: "bind", id: "x", value: { type: "cardCost", target: { type: "selected", id: "junk" } } },
        { type: "removeFromGame", target: { type: "selected", id: "junk" } },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "tut", selector: { controller: "self", zone: "deck", conditions: [
            { type: "cardTypeEquals", target: { type: "selected", id: "__candidate" }, other: { type: "remembered", key: "junk" } },
            num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "<=", { type: "variable", id: "x" })
          ] }, count: 1, optional: true },
          effects: [{ type: "moveCard", target: { type: "selected", id: "tut" }, to: "discard" }] },
        { type: "shuffleDeck", player: "controller" },
        { type: "draw", player: "controller", amount: 1 }
      ] },
    { id: "swca-fusion", type: "activated",
      costs: [{ type: "payResources", amount: 4 }, { type: "destroy", target: "source" }],
      targets: [
        { id: "ign", selector: { controller: "self", zone: "play", uniqueDesignation: "ignatious" }, count: 1 },
        { id: "tut2", selector: { owner: "self", zone: "deck", name: "Uhluhtc Niudla" }, count: 1 }
      ],
      effects: [{ type: "putIntoPlay", target: { type: "selected", id: "tut2" }, controller: "controller" }, { type: "shuffleDeck", player: "controller" }] }
  ] }
};

// Serpentine Scepter
PATCH["03d18824-daf1-4546-88bc-bc8e0a8d2502"] = {
  behavior: { abilities: [
    { id: "serpentine-drain", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "deplete", target: "attachedTo" }] },
    { id: "serpentine-charge", type: "activated", usesPerTurn: 1, costs: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "restore", target: "attachedTo" }, { type: "grantRestriction", target: "attachedTo", restriction: "cannotAttack", duration: { type: "untilEndOfTurn" } }] }
  ] },
  cardPatch: { attachTo: "character" }
};

// ============================================================ batch 4 ===

// "[V] enters play under your control -> optional pick a character -> <effects>"
const vTrigOptChar = (idBase, effects) => vCycle(idBase, "controller",
  [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "c" } }, effects }],
  [{ id: "c", selector: { zone: "play", type: "character" }, count: 1, optional: true }]
);

// Change of Tactics  (NEW-SHAPE -> card-behaviors test)
PATCH["19d82093-9a5c-4671-844c-f6bf751580e5"] = {
  behavior: { abilities: [{
    id: "change-of-tactics", type: "activated",
    condition: { type: "and", conditions: [
      { type: "battleRole", role: "attacker" },
      num({ type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }] } }, ">=", 1),
      { type: "battleDamageAssigned", operator: "=", value: 0 }
    ] },
    targets: [{ id: "dep", selector: { controller: "self", zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" } }] },
      count: { type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] } } }],
    costs: [{ type: "depleteSelected", declarationId: "dep" }],
    effects: [
      { type: "forEach", selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] }, effects: [{ type: "removeFromBattle", target: { type: "selected", id: "__candidate" } }] },
      { type: "forEach", selected: "dep", effects: [{ type: "addToBattle", target: { type: "selected", id: "__candidate" }, side: "attacking" }] },
      { type: "draw", player: "controller", amount: 1 }
    ]
  }] },
  cardPatch: { flipUp: { cost: 4, threshold: "rr", effects: [
    { type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Decline", effects: [] },
      { label: "Play a resource", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "pr", selector: { controller: "self", zone: "hand" }, count: 1 },
        effects: [{ type: "playResource", target: { type: "selected", id: "pr" }, faceDown: "auto", player: "controller" }] }] }
    ] }
  ] } }
};

// Changing Boothmajig
PATCH["5c84be16-72c8-4890-9b04-9520ff2d798a"] = {
  behavior: { abilities: [{
    id: "wardrobe-change", type: "activated",
    costs: [{ type: "deplete", target: "source" }],
    targets: [
      { id: "wearer", selector: { zone: "play", type: "character" }, count: 1 },
      { id: "gear", selector: { controller: "self", zone: "play", type: "item", subtype: "gear" }, count: 1 }
    ],
    effects: [{ type: "attachTo", target: { type: "selected", id: "gear" }, to: { type: "selected", id: "wearer" } }]
  }] }
};

// Cheats, the Dirty Rotten  (NEW-SHAPE -> card-behaviors test)
PATCH["6d385d6a-39e5-4b8f-b68b-3519ca99268a"] = {
  behavior: {
    onPlay: { targets: [{ id: "opp", selector: { owner: "opponent", zone: "play", type: "faction" }, count: 1 }] },
    abilities: [{
      id: "cheats-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{
        type: "if", condition: { type: "targetExists", target: { type: "selected", id: "opp" } }, effects: [
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "loot", selector: { owner: "opponent", zone: "deck", conditions: [notResource()] }, count: 4, distinctNames: true },
            effects: [
              { type: "forEach", selected: "loot", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }] },
              { type: "randomFromSelection", selected: "loot", count: 2, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] },
              { type: "grantVoidPlay", selected: "loot", player: "controller", ignoreThreshold: true }
            ] },
          { type: "shuffleDeck", player: "opponent" }
        ]
      }]
    }]
  },
  cardPatch: { unique: "pluck" }
};

// Chum, the Ugliest Sarume
PATCH["30b358cd-6c60-4e9e-b341-7d04fd80e135"] = {
  behavior: {
    keywords: ["tactical"],
    onPlay: { targets: [{ id: "pick", selector: { owner: "any", zone: "discard" }, count: 1 }] },
    abilities: [
      { id: "chum-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{
        type: "if", condition: { type: "targetExists", target: { type: "selected", id: "pick" } }, effects: [
          { type: "bind", id: "x", value: { type: "cardCost", target: { type: "selected", id: "pick" } } },
          { type: "removeFromGame", target: { type: "selected", id: "pick" } },
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "tut", selector: { owner: "opponent", zone: "deck", conditions: [num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "<=", { type: "variable", id: "x" })] }, count: 1, optional: true },
            effects: [{ type: "moveCard", target: { type: "selected", id: "tut" }, to: "discard" }] },
          { type: "shuffleDeck", player: "opponent" }
        ]
      }] },
      { id: "chum-fusion", type: "activated",
        costs: [{ type: "payResources", amount: 4 }, { type: "destroy", target: "source" }],
        targets: [
          { id: "pluck", selector: { controller: "self", zone: "play", uniqueDesignation: "pluck" }, count: 1 },
          { id: "tut2", selector: { owner: "self", zone: "deck", name: "Omahkapi'si Pi'kssii" }, count: 1 }
        ],
        effects: [{ type: "putIntoPlay", target: { type: "selected", id: "tut2" }, controller: "controller" }, { type: "shuffleDeck", player: "controller" }] }
    ]
  },
  cardPatch: { unique: "chum" }
};

// Confessions of Countless Souls  (NEW-SHAPE -> card-behaviors test)
PATCH["dd583c2e-106b-4186-8614-cb320e838015"] = {
  behavior: { abilities: [{
    id: "confessions-of-countless-souls", type: "activated",
    variables: {},
    targets: [
      { id: "tovoid", selector: { controller: "self", zone: "play", type: "character" }, count: { type: "variable", id: "x" } },
      { id: "bounce", selector: { zone: "play", type: "character" }, count: { type: "add", values: [{ type: "variable", id: "x" }, 1] } }
    ],
    effects: [
      { type: "forEach", selected: "tovoid", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }] },
      { type: "forEach", selected: "bounce", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] },
      { type: "lookAndReorder", player: "controller", count: { type: "add", values: [{ type: "variable", id: "x" }, 1] }, to: "split" }
    ]
  }] }
};

// Skilled Bannerman  (character with a card-level PROVIDES line)
PATCH["8b65f186-200b-4642-bf4a-a4055a9f5372"] = {
  behavior: {},
  cardPatch: { resource: { provides: ["rage"] } }
};

// Sneaky Sarco
PATCH["745b2a35-f814-4f40-a5fb-f072e281e756"] = {
  behavior: { abilities: [
    { id: "sneaky-sarco-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{ type: "if", condition: num({ type: "random", min: 1, max: 2 }, "=", 1), effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] },
    { id: "sneaky-sarco-covert", type: "continuous", condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 },
      keywords: [{ target: "source", keyword: "covert" }], modifiers: [] },
    { id: "sneaky-sarco-feed", type: "activated",
      costs: [{ type: "payResources", amount: 1 }, { type: "removeCounter", target: "source", counter: "token", amount: 1 }],
      effects: [
        { type: "createModifier", target: "source", stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } },
        { type: "createModifier", target: "source", stat: "life", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }
      ] }
  ] }
};

// Special Forces
PATCH["fa0943ab-fc48-4768-aab5-aee0b8aa3f37"] = {
  behavior: { abilities: [{
    id: "undercovert-operations", type: "activated",
    costs: [{ type: "payResources", amount: 3 }],
    effects: [
      { type: "grantKeyword", target: "source", keyword: "covert", duration: { type: "untilEndOfTurn" } },
      { type: "createModifier", target: "source", stat: "life", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }
    ]
  }] }
};

// Spurious Anthropologist
PATCH["b129604c-b993-48ff-8380-9a85297a75c9"] = {
  behavior: {
    keywords: ["tactical"],
    abilities: [
      { id: "spurious-block", type: "triggered", event: "characterBlocked", condition: selfIsEvent,
        targets: [{ id: "ally", selector: { owner: "self", zone: "discard", type: "character" }, count: 1, optional: true }],
        effects: [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "ally" } }, effects: [
          { type: "putIntoPlay", target: { type: "selected", id: "ally" }, controller: "controller", borrowed: true },
          { type: "addToBattle", target: { type: "selected", id: "ally" }, side: "blocking" }
        ] }] },
      { id: "spurious-eob", type: "triggered", event: "battleEnded", condition: { type: "inBattle", target: "source", role: "blocker" },
        effects: [{ type: "removeFromGame", target: "source" }] }
    ]
  },
  cardPatch: { flipUp: { cost: 1, threshold: "ggg" } }
};

// Stern But Fair Backhand
PATCH["d0ebba3a-1150-497d-85cd-9299abdf9f38"] = {
  behavior: { abilities: [{
    id: "stern-but-fair-backhand", type: "activated",
    effects: [{ type: "if", condition: { type: "respondingTo", cardType: "tactic" }, effects: [{ type: "terminate", scope: "respondedItem" }] }]
  }] },
  cardPatch: { selfDisposition: { to: "faceDownResource" } }
};

// Subdermal Micromajig
PATCH["7a303331-f7dd-4abc-b223-ef0b033db6b9"] = {
  behavior: { abilities: [{
    id: "subdermal-micromajig", type: "activated",
    targets: [
      { id: "p", selector: { owner: "opponent", zone: "play", type: "faction" }, count: 1 },
      { id: "tok", selector: { controller: "self", zone: "play", name: "Micromajig" }, count: 1 }
    ],
    costs: [{ type: "destroy", target: { type: "selected", id: "tok" } }],
    effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "atk", selector: { controller: "opponent", zone: "play", type: "character", conditions: [{ type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "attacker" }] }, count: 1 },
        effects: [{ type: "destroy", target: { type: "selected", id: "atk" } }] },
      { type: "createTokens", controller: { type: "ownerOf", target: { type: "selected", id: "p" } }, count: 1, token: MICROMAJIG }
    ]
  }] },
  cardPatch: { flipUp: { cost: 2, threshold: "ee", effects: [{ type: "draw", player: "controller", amount: 1 }] } }
};

// Suicide Smash  (NEW-SHAPE -> caps test covers target-in-zone)
PATCH["519a6b1a-f64e-4fe1-b586-39b32f7b328a"] = {
  behavior: { abilities: [{
    id: "suicide-smash", type: "activated",
    targets: [
      { id: "sac", selector: { controller: "self", zone: "play", type: "character" }, count: 1 },
      { id: "loc", selector: { zone: "play", type: "location" }, count: 1 }
    ],
    effects: [
      { type: "bind", id: "x", value: { type: "stat", target: { type: "selected", id: "sac" }, stat: "strength" } },
      { type: "destroy", target: { type: "selected", id: "sac" } },
      { type: "if", condition: num(rIcons("controller", "volition"), ">=", 3), effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 }] },
      { type: "dealDamage", target: { type: "selected", id: "loc" }, amount: { type: "variable", id: "x" } },
      { type: "if", condition: { type: "not", condition: { type: "targetInZone", target: { type: "selected", id: "loc" }, zone: "play" } }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
    ]
  }] },
  cardPatch: { flipUp: { cost: 3, threshold: "r" } }
};

// Super Slingerang XL200
PATCH["469e7907-ded7-4533-8174-02ef735808f6"] = {
  behavior: { abilities: [
    { id: "slingerang-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Decline", effects: [] },
        { label: "Discard at random, then maybe destroy a character", effects: [
          { type: "moveCard", target: { type: "random", selector: { controller: "self", zone: "hand" } }, to: "discard" },
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "kill", selector: { zone: "play", type: "character" }, count: 1, optional: true },
            effects: [{ type: "destroy", target: { type: "selected", id: "kill" } }] }
        ] }
      ] }] },
    { id: "slingerang-sling", type: "activated",
      costs: [{ type: "payResources", amount: 3 }, { type: "destroy", target: "source" }],
      targets: [{ id: "it", selector: { zone: "play", type: "item" }, count: 1 }],
      effects: [{ type: "destroy", target: { type: "selected", id: "it" } }] },
    { id: "slingerang-rang", type: "activated",
      costs: [{ type: "oneOf", options: [
        [{ type: "payResources", amount: 4 }],
        [{ type: "discard", id: "rang-d", player: "controller", selector: { controller: "self", zone: "hand", conditions: [notResource(), { type: "cardTradeIs", target: { type: "selected", id: "__candidate" }, trade: "rogue" }] }, count: 1 }]
      ] }],
      effects: [{ type: "moveCard", target: "source", to: "hand" }] }
  ] },
  cardPatch: { flipUp: { cost: 1, threshold: "d" } }
};

// Surprising Dudes
PATCH["96441eaf-5037-4ffd-ae17-bdae465688cf"] = {
  behavior: { abilities: [{
    id: "surprising-dudes", type: "activated",
    condition: { type: "isActivePlayer", player: "controller" },
    effects: [{ type: "createTokens", controller: "controller", count: 2, token: MICROMAJIG }]
  }] },
  cardPatch: { selfDisposition: { to: "faceDownResource" } }
};

// T Force 5 MegaManlyMajig
PATCH["9adb9f40-de34-4ce7-8e43-6fd2845a4757"] = {
  behavior: { abilities: [{
    id: "tforce5-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
    targets: [{ id: "det", selector: { owner: "self", zone: "play", type: "resource" }, count: 3, optional: true }],
    effects: [{ type: "forEach", selected: "det", effects: [{ type: "detach", target: { type: "selected", id: "__candidate" } }] }]
  }] }
};

// Thabbashite Barbeque
PATCH["cb0c54e5-f40b-4fb7-aeb2-01d0ab697f4f"] = {
  behavior: { abilities: [{
    id: "thabbashite-barbeque", type: "activated",
    targets: [{ id: "picked", selector: { zone: "play", conditions: [notResource()] }, count: 1 }],
    effects: [{
      type: "mayPay", player: "opponent", costs: [{ type: "payResources", amount: 2 }],
      effects: [{ type: "moveCard", target: "source", to: "hand" }],
      elseEffects: [
        { type: "moveCard", target: { type: "selected", id: "picked" }, to: "hand" },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "d", selector: { owner: "opponent", zone: "hand", conditions: [notResource()] }, count: 1 },
          effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }] }
      ]
    }]
  }] }
};

// Thabbashite Bowlegger
PATCH["e76bbc29-bb2f-4f8c-a8e9-3d6fc921ef85"] = {
  behavior: { abilities: vTrigOptChar("thabb-bowlegger", [{ type: "createModifier", target: { type: "selected", id: "c" }, stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }]) }
};

// Thabbashite Communicant
PATCH["aa6ad3ba-84aa-417a-9e0c-538d4faa34ca"] = {
  behavior: { abilities: vCycle("thabb-communicant", "controller", [{ type: "lookAndReorder", player: "controller", count: 1, to: "bottom" }]) }
};

// Thabbashite Dartist
PATCH["ad2abdfd-c8dc-42fb-9e2c-e3627c2073c4"] = {
  behavior: { abilities: vTrigOptChar("thabb-dartist", [{ type: "createModifier", target: { type: "selected", id: "c" }, stat: "life", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }]) }
};

// Thabbashite Deacon
PATCH["4c4df8dd-da26-4d4c-b84a-24e2b31b7008"] = {
  behavior: { abilities: vCycle("thabb-deacon", "controller",
    [{ type: "if", condition: { type: "targetExists", target: { type: "selected", id: "f" } }, effects: [{ type: "modifyInfluence", player: { type: "ownerOf", target: { type: "selected", id: "f" } }, amount: 1 }] }],
    [{ id: "f", selector: { zone: "play", type: "faction" }, count: 1, optional: true }]
  ) }
};

// Thabbashite Organist
PATCH["19c7a8ca-f41e-400a-9326-99404465a5c2"] = {
  behavior: { abilities: vCycle("thabb-organist", "controller", [{ type: "reduceNextCost", player: "controller", amount: 1 }]) }
};

// Thabbashite Temple
PATCH["9b446e06-feec-456a-a2e5-399ef156a523"] = {
  behavior: { abilities: [
    { id: "temple-call", type: "activated",
      variables: { x: { type: "resourceIcons", player: "controller", icon: "volition" } },
      costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: { type: "add", values: [10, { type: "multiply", values: [{ type: "variable", id: "x" }, -1] }] } }],
      targets: [{ id: "found", selector: { controller: "self", zone: "deck", type: "character", conditions: [num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "<=", { type: "variable", id: "x" })] }, count: 1 }],
      effects: [{ type: "putIntoPlay", target: { type: "selected", id: "found" }, controller: "controller" }, { type: "deplete", target: { type: "selected", id: "found" } }, { type: "shuffleDeck", player: "controller" }] },
    { id: "temple-volate", type: "activated",
      costs: [{ type: "payResources", amount: 2 }],
      targets: [{ id: "res", selector: { controller: "self", zone: "play", type: "resource", faceDown: false }, count: 1 }],
      effects: [{ type: "flipFaceDown", target: { type: "selected", id: "res" } }] }
  ] }
};

// Thabbashite Urchin
PATCH["e4730213-75fc-4614-9466-1b3c1e42e630"] = {
  behavior: { abilities: [{
    id: "thabb-urchin", type: "continuous",
    condition: { type: "and", conditions: [num(rIcons("controller", "volition"), ">=", 3), num({ type: "count", selector: { controller: "opponent", zone: "play", type: "item" } }, ">=", 1)] },
    keywords: [{ target: "source", keyword: "cannotBeBlocked" }], modifiers: []
  }] }
};

// Theological Theft
PATCH["9d9b004f-6491-4e6e-a79b-dd2a479c637f"] = {
  behavior: { abilities: [{
    id: "theological-theft", type: "activated",
    variables: {},
    variableBounds: { x: { min: 0, max: { type: "count", selector: { zone: "play", type: "faction" } } } },
    targets: [
      { id: "players", selector: { zone: "play", type: "faction" }, count: { type: "variable", id: "x" } },
      { id: "chars", selector: { owner: "opponent", zone: "discard", type: "character" }, count: { type: "variable", id: "x" } }
    ],
    effects: [
      { type: "forEach", selected: "players", effects: [{ type: "mill", player: { type: "ownerOf", target: { type: "selected", id: "__candidate" } }, count: 10 }] },
      { type: "forEach", selected: "chars", effects: [{ type: "putIntoPlay", target: { type: "selected", id: "__candidate" }, controller: "controller" }] }
    ]
  }] },
  cardPatch: { flipUp: { cost: 7, threshold: "dddd" } }
};

// Thieving Casino
PATCH["c1fdf3be-4790-4560-a4a0-920a951833a4"] = {
  behavior: { abilities: [
    { id: "thieving-casino-sot", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{ type: "bind", id: "coin", value: { type: "random", min: 1, max: 2 } },
        { type: "if", condition: num({ type: "variable", id: "coin" }, "=", 1), effects: [
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "p", selector: { zone: "play", type: "faction" }, count: 1 },
            effects: [{ type: "mill", player: { type: "ownerOf", target: { type: "selected", id: "p" } }, count: 4 }] }
        ] }] },
    { id: "thieving-casino-cashout", type: "activated",
      costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: { type: "add", values: [{ type: "cardCost", target: { type: "selected", id: "ch" } }, 4] } }],
      targets: [{ id: "ch", selector: { owner: "opponent", zone: "discard", type: "character" }, count: 1 }],
      effects: [{ type: "putIntoPlay", target: { type: "selected", id: "ch" }, controller: "controller" }] }
  ] }
};

// Torchlight Safehouse
PATCH["ebd86598-fdf0-424d-b867-53b714ac6db9"] = {
  behavior: { abilities: [
    { id: "torchlight-safehouse-death", type: "triggered", event: "cardDestroyed", condition: selfIsEvent, effects: [{ type: "modifyInfluence", player: "controller", amount: -3 }] },
    { id: "torchlight-safehouse-sot", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      targets: [{ id: "picked", selector: { controller: "self", zone: "play", type: "character" }, count: 3, optional: true }],
      effects: [{ type: "forEach", selected: "picked", effects: [{ type: "grantKeyword", target: { type: "selected", id: "__candidate" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }] }] }
  ] }
};

// Torchlight Sarcophyle
PATCH["b6bc3557-e0d3-4bfc-9bc1-138d0d27fb31"] = {
  behavior: { abilities: [{
    id: "torchlight-sarcophyle", type: "continuous",
    condition: num({ type: "count", selector: { zone: "play", type: "character", conditions: [{ type: "hasKeyword", target: { type: "selected", id: "__candidate" }, keyword: "covert" }] } }, ">=", 1),
    keywords: [{ target: "source", keyword: "covert" }], modifiers: []
  }] }
};

// Twisted Cannoneer
PATCH["d1ec10d9-7fac-4cf9-9a2f-c9f03d662179"] = {
  behavior: { abilities: [{
    id: "twisted-cannoneer-fire", type: "activated",
    condition: notInBattle,
    targets: [
      { id: "f", selector: { zone: "play", type: "faction" }, count: 1 },
      { id: "sac", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }
    ],
    costs: [{ type: "sacrificeSelected", declarationId: "sac", disposition: "destroy" }, { type: "payResources", amount: 1 }],
    effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 1 }]
  }] }
};

// Uhluhtc Niudla  (NEW-SHAPE -> caps test covers moveSelected)
PATCH["7be95bf9-e696-4f1d-82cd-e9f23c94f346"] = {
  behavior: { abilities: [
    { id: "uhluhtc-prevail", type: "activated",
      costs: [
        { type: "moveSelected", id: "spent", player: "controller", selector: { controller: "self", zone: "play", type: "resource" }, count: 1, to: "hand" },
        { type: "payResources", amount: 1 }
      ],
      targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
      effects: [{ type: "chooserSelectsTarget", chooser: { type: "ownerOf", target: { type: "selected", id: "p" } },
        declaration: { id: "fd", selector: { controller: { type: "ownerOf", target: { type: "selected", id: "p" } }, zone: "play", type: "resource", faceDown: true }, count: 1 },
        effects: [{ type: "moveCard", target: { type: "selected", id: "fd" }, to: "hand" }] }] },
    { id: "uhluhtc-avail", type: "activated",
      costs: [
        { type: "moveSelected", id: "rev", player: "controller", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1, to: "deck", shuffle: true },
        { type: "payResources", amount: 1 }
      ],
      effects: [
        { type: "if", condition: { type: "cardNameIs", target: { type: "selected", id: "rev" }, name: "Obsession" }, effects: [{ type: "grantKeyword", target: "source", keyword: "covert", duration: { type: "untilEndOfTurn" } }] },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] },
  cardPatch: { unique: "uhluhtc" }
};

// Underdog
PATCH["d000169f-1416-41e4-a603-3fc3bed83e46"] = {
  behavior: { abilities: [{
    id: "underdog", type: "continuous",
    modifiers: [{ target: "source", stat: "strength", operation: "add", value: { type: "count", selector: { owner: "opponent", zone: "play", type: "character" } } }]
  }] }
};

// Unexpected Transformation  (NEW-SHAPE -> caps covers deploy-from-deck via deployFromZone)
PATCH["1debbb17-6f36-47b4-85d7-cf4d91d320d7"] = {
  behavior: { abilities: [{
    id: "unexpected-transformation", type: "activated",
    variables: {},
    targets: [
      { id: "c", selector: { controller: "self", zone: "play", type: "character" }, count: 1 },
      { id: "found", selector: { controller: "self", zone: "deck", type: "character", conditions: [num({ type: "cardCost", target: { type: "selected", id: "__candidate" } }, "<=", { type: "variable", id: "y" })] }, count: 1, optional: true }
    ],
    costs: [{ type: "payResources", amount: { type: "add", values: [{ type: "variable", id: "y" }, { type: "multiply", values: [{ type: "cardCost", target: { type: "selected", id: "c" } }, -1] }] } }],
    effects: [
      { type: "moveCard", target: { type: "selected", id: "c" }, to: "deck", position: "bottom" },
      { type: "shuffleDeck", player: "controller" },
      { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "found" } }, effects: [
        { type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Deploy it for free", effects: [{ type: "deployFromZone", player: "controller", target: { type: "selected", id: "found" }, free: true }] },
          { label: "Put it on top of your deck", effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "deck", position: "top" }] }
        ] }
      ] }
    ]
  }] }
};

// Unloyal Necromorph
PATCH["420418bb-f8a7-435a-a0eb-1dec094e3805"] = {
  behavior: { abilities: [{
    id: "unloyal-necromorph", type: "replacement", replaces: { event: "destroy" },
    optional: true, optionalCost: [{ type: "payResources", amount: 2 }], chooser: "opponent",
    effects: [
      { type: "takeControl", target: { type: "selected", id: "__candidate" }, controller: "controller" },
      { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }
    ]
  }] }
};

// Unstable Modification  (NEW-SHAPE -> caps covers untilStartOfNextTurn + attach-tactic)
PATCH["f6c1b927-e75b-48af-a84b-b46d7da78f21"] = {
  behavior: { abilities: [{
    id: "unstable-modification", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "OPTION 1 — +1 strength", effects: [{ type: "createModifier", target: "attachedTo", stat: "strength", operation: "add", value: 1, duration: { type: "untilStartOfNextTurn" } }] },
      { label: "OPTION 2 — +1 life", effects: [{ type: "createModifier", target: "attachedTo", stat: "life", operation: "add", value: 1, duration: { type: "untilStartOfNextTurn" } }] },
      { label: "OPTION 3 — can block COVERT parties", effects: [{ type: "grantKeyword", target: "attachedTo", keyword: "canBlockCovert", duration: { type: "untilStartOfNextTurn" } }] }
    ] }]
  }] },
  cardPatch: { attachTo: "character" }
};

// Vexing Nullifier
PATCH["63bfbe3f-f1ad-48f7-a905-81dd2ce8b0ac"] = {
  behavior: { abilities: [{
    id: "vexing-nullifier-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
    effects: [
      { type: "transformBattleDamage", target: "source", role: "dealer", kind: "bounceOther", duration: { type: "whileSourceInPlay" } },
      { type: "transformBattleDamage", target: "source", role: "receiver", kind: "bounceSelf", duration: { type: "whileSourceInPlay" } }
    ]
  }] }
};

// Vicious Bruiser
PATCH["97ccef0f-b39a-42d7-8521-0c7549cfef60"] = {
  behavior: { abilities: [iconGate("rage", 6, [
    { target: "source", stat: "strength", operation: "add", value: 2 },
    { target: "source", stat: "life", operation: "add", value: 4 }
  ])] }
};
PATCH["97ccef0f-b39a-42d7-8521-0c7549cfef60"].behavior.abilities[0].id = "vicious-bruiser";

// Visible Loaf
PATCH["73d21c09-6bd0-4df5-9cae-72a34f702c43"] = {
  behavior: { abilities: [
    { id: "visible-loaf-tokens", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 3 }] },
    { id: "visible-loaf-deflect", type: "activated",
      costs: [{ type: "payResources", amount: 3 }, { type: "removeCounter", target: "source", counter: "token", amount: 1 }, { type: "deplete", target: "source" }],
      targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
      effects: [{ type: "preventDamage", target: { type: "selected", id: "c" }, amount: 0, mode: "reduce", wholeInstance: true }] }
  ] }
};

// Voidal Humour Redistribution  (NEW-SHAPE -> caps covers sumCounters)
PATCH["cdaffb25-1b2d-4ecd-9c1e-472bbb07e44b"] = {
  behavior: { abilities: [{
    id: "voidal-humour-redistribution", type: "activated",
    variables: {},
    variableBounds: { x: { min: 0, max: { type: "sumCounters", selector: { controller: "self", zone: "play" }, counter: "token" } } },
    targets: [
      { id: "src", selector: { controller: "self", zone: "play", conditions: [{ type: "counterCompare", target: { type: "selected", id: "__candidate" }, counter: "token", operator: ">=", value: 1 }] }, count: 99, optional: true },
      { id: "dest", selector: { zone: "play", conditions: [notResource()] }, count: 99, optional: true }
    ],
    effects: [
      { type: "distributeAmong", chooser: "controller", selected: "src", amount: { type: "variable", id: "x" }, effects: [{ type: "removeCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: { type: "variable", id: "__amount" } }] },
      { type: "distributeAmong", chooser: "controller", selected: "dest", amount: { type: "variable", id: "x" }, effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: { type: "variable", id: "__amount" } }] },
      { type: "draw", player: "controller", amount: 1 }
    ]
  }] }
};

// Warehouse Sentinel
PATCH["82130389-515b-4a5d-92dd-188d3f97c9ff"] = {
  behavior: { abilities: [{
    id: "warehouse-sentinel-recur", type: "activated", activationZone: "discard", threshold: "ddd",
    costs: [{ type: "payResources", amount: 1 }, { type: "removeFromGame", target: "source" }],
    targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
    effects: [{ type: "if", condition: { type: "cardDepleted", target: { type: "selected", id: "c" } }, effects: [{ type: "destroy", target: { type: "selected", id: "c" } }] }]
  }] }
};

// Will of a Living God
PATCH["ea29b4da-eebf-4020-ba8e-bf61d58445c8"] = {
  behavior: { abilities: [
    { id: "wolg-tokens", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 3 }] },
    { id: "wolg-buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
      { target: "attachedTo", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
    ] },
    { id: "wolg-sot", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [
        { type: "bind", id: "tk", value: { type: "counter", target: "source", counter: "token" } },
        { type: "if", condition: num({ type: "variable", id: "tk" }, ">=", 1), effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }] },
        { type: "if", condition: num({ type: "variable", id: "tk" }, "=", 0), effects: [{ type: "destroy", target: "attachedTo" }] }
      ] }
  ] },
  cardPatch: { attachTo: "character" }
};

// Zigalburgonglgr, the Stolen God
PATCH["9fc239ec-9f39-4fd0-ae5d-4bbd4e116f66"] = {
  behavior: { abilities: [
    { id: "zigal-etb", type: "triggered", event: "cardEnteredPlay", condition: selfIsEvent,
      targets: [{ id: "marks", selector: { zone: "play", conditions: [notResource()] }, count: { type: "resourceIcons", player: "controller", icon: "volition" }, optional: true }],
      effects: [{ type: "forEach", selected: "marks", effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: 1 }] }] },
    { id: "zigal-death", type: "triggered", event: "cardDestroyed", condition: selfIsEvent,
      effects: [{ type: "forEach", selector: { zone: "play", conditions: [notResource(), { type: "counterCompare", target: { type: "selected", id: "__candidate" }, counter: "token", operator: ">=", value: 1 }] }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] },
    { id: "zigal-mush", type: "activated",
      costs: [{ type: "payResources", amount: 2 }],
      targets: [{ id: "m", selector: { zone: "play", conditions: [{ type: "counterCompare", target: { type: "selected", id: "__candidate" }, counter: "token", operator: ">=", value: 1 }] }, count: 1 }],
      effects: [{ type: "flipFaceDown", target: { type: "selected", id: "m" } }] }
  ] }
};

// ============================================================ apply ===

function main() {
  const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
  const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
  const cardById = new Map(cards.map(c => [c.id, c]));
  const covById = new Map(cov.cards.map(e => [e.id, e]));

  let n = 0;
  const verified = [];
  for (const [id, entry] of Object.entries(PATCH)) {
    const card = cardById.get(id);
    if (!card) throw new Error(`author-hh: unknown card id ${id}`);
    if (!entry.behavior) throw new Error(`${card.name}: no behavior`);
    card.behavior = entry.behavior;
    for (const [k, v] of Object.entries(entry.cardPatch ?? {})) {
      if (!CARD_PATCH_KEYS.has(k)) throw new Error(`${card.name}: illegal cardPatch key ${k}`);
      card[k] = v;
    }
    const ce = covById.get(id);
    ce.status = entry.verified ? "verified" : "authored";
    if (entry.verified) verified.push(card.name);
    ce.metadata = {
      unique: card.unique ?? null,
      attachTo: card.attachTo ?? null,
      resourceProvides: card.resource?.provides ?? null,
      keywords: card.behavior?.keywords ?? []
    };
    n++;
  }

  fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
  fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
  console.log(`authored ${n} Holy Heist cards (${verified.length} verified)`);
}

main();
