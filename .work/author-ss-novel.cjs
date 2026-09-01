#!/usr/bin/env node
/* author-ss-novel.cjs — behaviour for the 40 genuinely-novel Seed Saga cards
 * (the Gideon / Demon Knights / Imperial Army / Mau / Banner era). Every
 * shape reuses the existing 219-capability vocabulary; documented
 * concessions on secondary clauses live in each card's coverage `notes`.
 *
 *   node .work/author-ss-novel.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CARDS_PATH = path.join(ROOT, "data", "cards.json");
const COV_PATH = path.join(ROOT, "data", "card-coverage.json");
const DRY = process.argv.includes("--dry");

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
const cov = JSON.parse(fs.readFileSync(COV_PATH, "utf8"));
const cardByName = new Map(cards.filter(c => c.set === "Seed Saga").map(c => [c.name, c]));
const covById = new Map(cov.cards.map(e => [e.id, e]));
const textHash = s =>
  crypto.createHash("sha1").update((s || "").replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 12);

// --- small builders -----------------------------------------------------
const pick = id => ({ type: "selected", id });
const cand = pick("__candidate");
const eot = { type: "untilEndOfTurn" };
const draw = (n = 1, player = "controller") => ({ type: "draw", player, amount: n });
const tgt = (id, selector, extra = {}) => ({ id, count: 1, selector: { zone: "play", ...selector }, ...extra });
const notResource = { type: "not", condition: { type: "cardTypeIs", target: cand, cardType: "resource" } };
const notSource = { type: "not", condition: { type: "isCard", target: cand, other: "source" } };
const deckSearch = (declId, selector, extra = {}) => ({
  type: "chooserSelectsTarget",
  chooser: "controller",
  declaration: { id: declId, selector: { controller: "self", zone: "deck", ...selector }, count: 1, optional: !!extra.optional },
  effects: [{ type: "moveCard", target: pick(declId), to: "hand" }]
});
const ifPicked = (id, effects) => ({ type: "if", condition: { type: "targetExists", target: pick(id) }, effects });

let applied = 0;
function V(name, cardPatch, cov0) {
  const c = cardByName.get(name);
  if (!c) throw new Error(`Seed Saga card not found: ${name}`);
  const e = covById.get(c.id);
  if (!DRY) {
    if (cardPatch.behavior) c.behavior = cardPatch.behavior;
    for (const k of ["unique", "attachTo", "flipUp", "selfDisposition", "resource", "subtype"]) {
      if (cardPatch[k] !== undefined) c[k] = cardPatch[k];
    }
    e.status = "verified";
    e.rulesAudited = true;
    e.textHash = textHash(c.text);
    e.behavior = { needed: true, shapes: cov0.shapes || [], reusesProvenShape: true, newTestNeeded: false };
    e.metadata = {
      unique: c.unique ?? null,
      attachTo: c.attachTo ?? null,
      resourceProvides: c.resource?.provides ?? null,
      keywords: c.behavior?.keywords ?? []
    };
    e.engineCapability = [];
    e.display = {};
    e.confidence = cov0.confidence || "high";
    e.notes = cov0.notes || "";
  }
  applied++;
}

// =====================================================================
// ARCANIST
// =====================================================================

V("A Death Fit for a King", {
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        targets: [tgt("victim", {
          zone: ["play", "discard"],
          type: "character",
          conditions: [{
            type: "or",
            conditions: [
              { type: "hasUnique", target: cand },
              { type: "targetInZone", target: cand, zone: "discard" }
            ]
          }]
        })],
        effects: [{ type: "moveCard", target: pick("victim"), to: "void" }]
      },
      {
        id: "recur",
        type: "activated",
        activationZone: "discard",
        threshold: "oo",
        costs: [{ type: "payResources", amount: 3 }, { type: "removeFromGame", target: "source" }],
        effects: [deckSearch("found", { type: "character", conditions: [{ type: "hasUnique", target: cand }] }, { optional: true })]
      }
    ]
  }
}, {
  shapes: [
    "tactic body: pick a UNIQUE character in play OR a character in a discard pile -> moveCard void",
    "RECUR [O][O] from discard: pay 3 + RFG self -> deck-search a UNIQUE character to hand"
  ],
  notes: "EXTRA COST uses a zone:['play','discard'] selector gated on or(hasUnique, targetInZone discard). CONCESSION: the discard branch isn't narrowed to an OPPONENT's discard (minor). RECUR is the standard activationZone:'discard' + removeFromGame idiom.",
  confidence: "medium"
});

V("Arcane Monkey Ritual", {
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "tacs", selector: { controller: "self", zone: "deck", type: "tactic" }, count: 2, optional: true },
          effects: [{ type: "forEach", selected: "tacs", effects: [{ type: "moveCard", target: cand, to: "discard" }] }]
        }]
      },
      {
        id: "recur",
        type: "activated",
        activationZone: "discard",
        threshold: "oooo",
        costs: [{ type: "payResources", amount: 4 }, { type: "removeFromGame", target: "source" }],
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "opponent",
          declaration: { id: "ditch", selector: { owner: "opponent", zone: "hand" }, count: 2 },
          effects: [{ type: "forEach", selected: "ditch", effects: [{ type: "moveCard", target: cand, to: "discard" }] }]
        }]
      }
    ]
  }
}, {
  shapes: [
    "tactic body: deck-search up to 2 tactics -> discard pile",
    "RECUR [O]x4 from discard: pay 4 + RFG self -> opponent discards 2"
  ],
  notes: "CONCESSION: 'Pick a player. That player discards 2' modelled as 'the opponent discards 2' (2-player — 'a player' is virtually always the opponent).",
  confidence: "medium"
});

V("Death of the Demon Knights", {
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        targets: [tgt("mark", { controller: "opponent", type: "character" })],
        effects: [
          {
            type: "mayPay",
            player: "controller",
            costs: [{ type: "payResources", amount: 2 }],
            effects: [{
              type: "chooserSelectsTarget",
              chooser: "opponent",
              declaration: {
                id: "extra",
                selector: { zone: "play", type: "character", controller: "opponent", conditions: [notSourceMark()] },
                count: 1,
                optional: true
              },
              effects: [{ type: "moveCard", target: pick("extra"), to: "deck", position: "bottom" }]
            }]
          },
          { type: "moveCard", target: pick("mark"), to: "deck", position: "bottom" },
          draw(1)
        ]
      }
    ]
  }
}, {
  shapes: ["tactic body: pick an opp character; mayPay 2 -> the opponent picks another of their characters; both to bottom of owner's deck; draw"],
  notes: "'that character's controller' = the opponent (they control 'mark'). Both cards moveCard to:'deck' position:'bottom' (owner-relative).",
  confidence: "medium"
});
function notSourceMark() {
  return { type: "not", condition: { type: "isCard", target: cand, other: pick("mark") } };
}

V("Enter The Demon Knights", {
  behavior: {
    abilities: [{
      id: "body",
      type: "activated",
      condition: { type: "not", condition: { type: "battleActive" } },
      targets: [{
        id: "revealed",
        selector: {
          owner: "self",
          zone: "hand",
          type: "character",
          conditions: [{ type: "numberCompare", left: { type: "cardCost", target: cand }, operator: "<=", right: 6 }]
        },
        count: 3
      }],
      effects: [
        {
          type: "chooserSelectsTarget",
          chooser: "opponent",
          declaration: {
            id: "chosen",
            selector: { zone: "any", type: "character", conditions: [{ type: "targetInSelection", target: cand, selection: "revealed" }] },
            count: 1
          },
          effects: [{ type: "putIntoPlay", target: pick("chosen"), controller: "controller" }]
        },
        {
          type: "forEach",
          selected: "revealed",
          effects: [{
            type: "if",
            condition: {
              type: "and",
              conditions: [
                { type: "not", condition: { type: "targetInSelection", target: cand, selection: "chosen" } },
                {
                  type: "or",
                  conditions: [
                    { type: "cardSubtypeIs", target: cand, subtype: "demon knight" },
                    { type: "uniqueIs", target: cand, designations: ["gloamspike"] }
                  ]
                }
              ]
            },
            effects: [{ type: "putIntoPlay", target: cand, controller: "controller" }]
          }]
        }
      ]
    }]
  }
}, {
  shapes: ["tactic body (not battleActive): reveal 3 hand characters cost<=6; opponent chooses 1 -> into play under you; any revealed 'demon knight' / UNIQUE GLOAMSPIKE also into play under you"],
  notes: "Reveal IS the target declaration (a 3-count hand pick); opponent picks one via targetInSelection over 'revealed'. CONCESSION: 'reveal' has no hidden-hand model. CONCESSION: 'pick an opponent' = the opponent.",
  confidence: "medium"
});

V("Gilda, Mother of Gideon", {
  unique: "gilda",
  behavior: {
    abilities: [
      {
        id: "peek",
        type: "triggered",
        event: "turnStarted",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "tac", selector: { controller: "self", zone: "deck", type: "tactic", fromTop: 2 }, count: 1, optional: true },
          effects: [{ type: "moveCard", target: pick("tac"), to: "void" }]
        }]
      },
      {
        id: "summons",
        type: "activated",
        costs: [{ type: "payResources", amount: 1 }],
        targets: [tgt("back", { owner: "self", zone: "void", type: "tactic" })],
        effects: [{ type: "deployFromZone", player: "controller", target: pick("back"), free: true }]
      }
    ]
  }
}, {
  shapes: [
    "UNIQUE. start-of-turn: look at top 2, may send a tactic among them to the void (rest stay on top)",
    "SEDUCTIVE SUMMONS: pay 1, pick a tactic in the void -> may deploy it for free"
  ],
  notes: "'look at the top 2' modelled with selector fromTop:2 (Jackmove idiom); unpicked cards keep deck order. CONCESSION: SUMMONS may deploy ANY tactic in your void, not only ones this card sent there.",
  confidence: "medium"
});

V("Hungermaw Deephate", {
  unique: "hungermaw",
  behavior: {
    abilities: [
      { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 8 }] },
      {
        id: "scale",
        type: "continuous",
        modifiers: [
          { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
          { target: "source", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
        ]
      },
      {
        id: "eject",
        type: "activated",
        costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 2 }],
        targets: [tgt("kick", { conditions: [notResource, notSource] })],
        effects: [{ type: "moveCard", target: pick("kick"), to: "hand" }]
      }
    ]
  }
}, {
  shapes: ["UNIQUE. enters with 8 tokens; +1/+1 per token; EJECT: remove 2 tokens, pick another non-resource card -> its owner's hand"],
  notes: "Enters-with-tokens (Knobby Stave) + tokens->stat (Berserker Corps) + removeCounter cost + bounce."
});

V("Mr. Chesterton", {
  behavior: {
    onPlay: {
      targets: [{ id: "anchor", selector: { zone: "discard", type: "tactic" }, count: 1 }],
      effects: [{ type: "rememberTarget", key: "anchor", target: pick("anchor") }]
    },
    abilities: [{
      id: "lurk",
      type: "continuous",
      condition: { type: "targetInZone", target: { type: "remembered", key: "anchor" }, zone: "discard" },
      keywords: [{ target: "source", keyword: "covert" }],
      modifiers: []
    }]
  }
}, {
  shapes: ["character EXTRA COST: pick a tactic in a discard pile; continuous: while that card is in a discard pile, this card has COVERT"],
  notes: "onPlay remembers the pick; the continuous COVERT is gated on targetInZone({remembered:'anchor'}, 'discard')."
});

V("Mutilated", {
  flipUp: { cost: [{ type: "payResources", amount: 2 }], threshold: "oo" },
  behavior: {
    abilities: [{
      id: "body",
      type: "activated",
      targets: [
        tgt("mine", { controller: "self", type: "character" }),
        tgt("buff", { type: "character", conditions: [{ type: "not", condition: { type: "isCard", target: cand, other: pick("mine") } }] })
      ],
      effects: [
        { type: "createModifier", target: pick("mine"), stat: "life", operation: "add", value: -2, duration: eot },
        { type: "createModifier", target: pick("buff"), stat: "strength", operation: "add", value: 1, duration: eot },
        { type: "grantKeyword", target: pick("buff"), keyword: "covert", duration: eot },
        draw(1)
      ]
    }]
  }
}, {
  shapes: ["tactic: pick a char you control (-2 life this turn); pick another char (+1 str + COVERT this turn); draw. FLIP UP 2 [O]"]
});

V("Unbearable Torture", {
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        targets: [tgt("mark", { type: "character" })],
        effects: [
          {
            type: "if",
            condition: { type: "statCompare", target: pick("mark"), stat: "life", operator: ">", value: { type: "stat", target: pick("mark"), stat: "strength" } },
            effects: [{ type: "moveCard", target: pick("mark"), to: "void" }]
          },
          draw(1)
        ]
      },
      {
        id: "recur",
        type: "activated",
        activationZone: "discard",
        threshold: "o",
        costs: [{ type: "payResources", amount: 2 }, { type: "removeFromGame", target: "source" }],
        targets: [tgt("rev", { owner: "any", zone: "void", type: "character" })],
        effects: [{ type: "moveCard", target: pick("rev"), to: "deck", position: "top" }]
      }
    ]
  }
}, {
  shapes: [
    "tactic: pick a char; if life > strength -> void; draw",
    "RECUR [O] from discard: pay 2 + RFG, pick a char in the void -> top of owner's deck"
  ],
  notes: "statCompare with value = a stat NumberExpression of the same target."
});

// =====================================================================
// BANKER
// =====================================================================

V("Caracal Morphnus", {
  unique: "caracal",
  behavior: {
    abilities: [
      { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 5 }] },
      {
        id: "scale",
        type: "continuous",
        modifiers: [
          { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } },
          { target: "source", stat: "life", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
        ]
      },
      { id: "ondraw", type: "triggered", event: "cardsDrawn", condition: { type: "eventPlayerIs", player: "controller" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "eventDrawAmount" } }] },
      { id: "morph", type: "activated", costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 3 }], effects: [draw(1)] }
    ]
  }
}, {
  shapes: ["UNIQUE. enters with 5 tokens; +1/+1 per token; on draw put X tokens (X=drawn); $$$ MORPH: remove 3 tokens -> draw"],
  notes: "cardsDrawn + eventDrawAmount (Open Beta)."
});

V("Executive Order #6370u7", {
  behavior: {
    abilities: [{
      id: "toll",
      type: "triggered",
      event: "turnStarted",
      condition: { type: "not", condition: { type: "eventPlayerIs", player: "controller" } },
      effects: [{
        type: "mayPay",
        player: "controller",
        costs: [{ type: "payResources", amount: 2 }],
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "mark", selector: { zone: "play", type: "character" }, count: 1, optional: true },
          effects: [
            { type: "deplete", target: pick("mark") },
            { type: "skipNextRestore", target: pick("mark") }
          ]
        }]
      }]
    }]
  }
}, {
  shapes: ["item, start of an opponent's turn: mayPay 2, pick a character -> deplete it and it skips its next RESTORE RULE restore"],
  notes: "'cannot be restored by its controller's faction's RESTORE RULE this turn' = skipNextRestore (SotDE)."
});

V("Gideon's Legacy", {
  behavior: {
    abilities: [
      { id: "seek", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }], effects: [draw(1)] },
      {
        id: "hide",
        type: "activated",
        targets: [tgt("card", { owner: "opponent", zone: "discard" })],
        costs: [{ type: "destroy", target: "source" }],
        effects: [
          { type: "bind", id: "x", value: { type: "cardCost", target: pick("card") } },
          { type: "moveCard", target: pick("card"), to: "deck", position: "bottom" },
          { type: "shuffleDeck", player: "opponent" },
          { type: "modifyInfluence", player: "opponent", amount: { type: "variable", id: "x" } }
        ]
      }
    ]
  }
}, {
  shapes: [
    "SEEK: pay 2 + deplete self -> draw",
    "HIDE: pick a card in the opponent's discard (X=its cost); destroy self -> shuffle it into that deck; opponent's faction +X influence"
  ],
  notes: "CONCESSION: 'Pick a player ... each other player's faction gains X influence' collapses to the opponent in 2-player.",
  confidence: "medium"
});

V("Imperial Palace", {
  behavior: {
    abilities: [{
      id: "stash",
      type: "triggered",
      event: "turnEnding",
      condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{
        type: "mayPay",
        player: "controller",
        costs: [{ type: "payResources", amount: 1 }],
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "hide", selector: { controller: "self", zone: "play", type: "character" }, count: 1, optional: true },
          effects: [
            { type: "rememberTarget", key: "stashed", target: pick("hide") },
            { type: "moveCard", target: pick("hide"), to: "void" },
            {
              type: "scheduleEffect",
              when: "startOfNextTurn",
              effects: [{ type: "putIntoPlay", target: { type: "remembered", key: "stashed" }, controller: "controller" }]
            }
          ]
        }]
      }]
    }]
  }
}, {
  shapes: ["location, end of your turn: mayPay 1, pick a char you control -> void; at the start of your next turn -> put it back into play under you"],
  notes: "scheduleEffect.when:'startOfNextTurn' = the source-controller's next turn; the delayed effect targets a {remembered} ref.",
  confidence: "medium"
});

V("Mau Caravan", {
  behavior: {
    abilities: [{
      id: "seek",
      type: "triggered",
      event: "turnStarted",
      condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{
        type: "mayPay",
        player: "controller",
        costs: [{ type: "destroy", target: "source" }],
        effects: [deckSearch("loc", { type: "location" }, { optional: true })]
      }]
    }]
  }
}, {
  shapes: ["location, start of your turn: you may destroy this -> deck-search a location to your hand"],
  notes: "'you may destroy this card. If you do, ...' = mayPay with a destroy(source) cost."
});

V("The Brotherhood of the Mau", {
  behavior: {
    keywords: ["covert"],
    abilities: [
      { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 7 }] },
      {
        id: "chained",
        type: "continuous",
        condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 },
        modifiers: [],
        restrictions: [{ target: "source", restriction: "cannotAttack" }]
      },
      {
        id: "share",
        type: "triggered",
        event: "turnStarted",
        effects: [{
          type: "chooserSelectsNumber",
          chooser: "controller",
          storeAs: "x",
          min: 0,
          max: { type: "counter", target: "source", counter: "token" },
          effects: [{
            type: "mayPay",
            player: "controller",
            costs: [{ type: "payResources", amount: { type: "variable", id: "x" } }],
            effects: [
              { type: "removeCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } },
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "ally", selector: { controller: "self", zone: "play", type: "character", conditions: [notSource] }, count: 1, optional: true },
                effects: [ifPicked("ally", [{ type: "createModifier", target: pick("ally"), stat: "life", operation: "add", value: { type: "variable", id: "x" }, duration: eot }])]
              }
            ]
          }]
        }]
      }
    ]
  }
}, {
  shapes: ["COVERT. enters with 7 tokens; while it has a token it cannot attack; at the start of EACH turn may pay X -> remove X tokens + pick another char -> that char +X life this turn"],
  notes: "'at the start of EACH turn' = a turnStarted trigger with no eventPlayerIs filter. X = chooserSelectsNumber (max = token count), spent via a mayPay payResources cost then removeCounter.",
  confidence: "medium"
});

V("Undead Sword", {
  unique: "giada",
  behavior: {
    abilities: [
      { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 2 }] },
      {
        id: "decay",
        type: "continuous",
        modifiers: [
          { target: "source", stat: "strength", operation: "add", value: { type: "multiply", values: [-1, { type: "counter", target: "source", counter: "token" }] } },
          { target: "source", stat: "life", operation: "add", value: { type: "multiply", values: [-1, { type: "counter", target: "source", counter: "token" }] } }
        ]
      },
      { id: "hide", type: "activated", costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }], effects: [{ type: "grantKeyword", target: "source", keyword: "covert", duration: eot }] }
    ]
  }
}, {
  shapes: ["UNIQUE. enters with 2 tokens; -1/-1 per token; HIDE AMONG THE CORPSES: remove a token -> COVERT this turn"],
  notes: "negative per-token modifier = -1 * counter (Giada, the Elegant idiom)."
});

// =====================================================================
// GEARSMITH
// =====================================================================

V("Crushjaw Oceanhide", {
  unique: "oceanhide",
  behavior: {
    keywords: ["aggro"],
    abilities: [{
      id: "warcry",
      type: "triggered",
      event: "damageDealt",
      condition: {
        type: "and",
        conditions: [
          { type: "sourceIsDamageSource" },
          { type: "cardTypeIs", target: "eventCard", cardType: "faction" },
          { type: "numberCompare", left: { type: "resourceIcons", player: "controller", icon: "elitism" }, operator: ">=", right: 5 }
        ]
      },
      effects: [{ type: "grantKeywordToPlayer", player: "controller", keyword: "aggro", duration: eot }]
    }]
  }
}, {
  shapes: ["AGGRO, UNIQUE. [E]x5 icon-gated: when this inflicts damage to a faction, this turn characters you control and deploy gain AGGRO"],
  notes: "grantKeywordToPlayer (Holy Heist) + icon gate via numberCompare(resourceIcons)."
});

V("Juggernauts", {
  behavior: {
    onPlay: {
      targets: [{ id: "crew", selector: { controller: "self", zone: "play", type: "character" }, count: 3, optional: true }],
      effects: [{ type: "forEach", selected: "crew", effects: [{ type: "flipFaceDown", target: cand }] }]
    },
    abilities: [{
      id: "trek",
      type: "activated",
      costs: [
        { type: "payResources", amount: 2 },
        { type: "discard", id: "fuel", player: "self", selector: { controller: "self", zone: "play", type: "resource", faceDown: true }, count: 1 }
      ],
      effects: [deckSearch("haul", {}, { optional: true })]
    }]
  }
}, {
  shapes: [
    "EXTRA COST: may pick up to 3 chars you control; ETB flip those face-down under their owner's control",
    "TREK: pay 2 + destroy a face-down resource you control -> deck-search a card to hand"
  ],
  notes: "Non-tactic EXTRA COST + ETB rider on behavior.onPlay. CONCESSION: 'Destroy a face-down resource' modelled as a discard cost over a faceDown resource selector.",
  confidence: "medium"
});

V("Mud Prison", {
  behavior: {
    abilities: [
      {
        id: "mire",
        type: "triggered",
        event: "turnStarted",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{
          type: "mayPay",
          player: "controller",
          costs: [{ type: "payResources", amount: 1 }],
          effects: [{
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "mark", selector: { controller: "opponent", zone: "play", type: "character" }, count: 1, optional: true },
            effects: [{ type: "addCounter", target: pick("mark"), counter: "token", amount: 1 }]
          }]
        }]
      },
      {
        id: "silence",
        type: "continuous",
        suppressAllAbilities: {
          selector: { controller: "opponent", type: "character", conditions: [{ type: "counterCompare", target: cand, counter: "token", operator: ">=", value: 1 }] }
        },
        modifiers: []
      }
    ]
  }
}, {
  shapes: [
    "location, start of your turn: mayPay 1, pick an opp character -> token on it",
    "continuous: opp characters with a token on them have no rules text"
  ],
  notes: "suppressAllAbilities (SotDE) with a selector gated on counterCompare."
});

V("Runic Flee", {
  flipUp: { cost: [{ type: "payResources", amount: 1 }], threshold: "e" },
  behavior: {
    abilities: [{
      id: "body",
      type: "activated",
      effects: [
        { type: "modifyInfluence", player: "controller", amount: -1 },
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "res", selector: { controller: "self", zone: "play", type: "resource", attachedToFaction: true }, count: 1 },
          effects: [{ type: "detach", target: pick("res") }]
        },
        {
          type: "if",
          condition: { type: "deployedViaFlipUp" },
          effects: [{
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "tok", selector: { zone: "play", conditions: [notResource] }, count: 1, optional: true },
            effects: [ifPicked("tok", [{ type: "addCounter", target: pick("tok"), counter: "token", amount: 1 }])]
          }]
        }
      ]
    }]
  }
}, {
  shapes: ["tactic: lose 1 influence; detach a resource; if FLIP UP -> may put a token on a non-resource card. FLIP UP 1 [E]"],
  notes: "CONCESSION: 'FLIP UP: 1 [E] and you may play a resource' — the bonus resource play on flip-up is left unmodelled (no flipUp bonus-develop hook); the influence/detach/token body is authored.",
  confidence: "medium"
});

V("Warmachine Smelder", {
  behavior: {
    abilities: [
      {
        id: "fire",
        type: "activated",
        costs: [{ type: "deplete", target: "source" }],
        targets: [tgt("scrap", { controller: "self", type: "item" })],
        effects: [{ type: "destroy", target: pick("scrap") }, deckSearch("hot", { type: "item" }, { optional: true })]
      },
      {
        id: "lifeswork",
        type: "activated",
        threshold: "eeeeee",
        costs: [{ type: "destroy", target: "source" }],
        targets: [tgt("scrap2", { controller: "self", type: "item" })],
        effects: [
          { type: "destroy", target: pick("scrap2") },
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: {
              id: "masterwork",
              selector: { controller: "self", zone: "deck", type: "item", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: cand }, operator: "<=", right: 7 }] },
              count: 1,
              optional: true
            },
            effects: [{ type: "deployFromZone", player: "controller", target: pick("masterwork"), free: true }]
          }
        ]
      }
    ]
  }
}, {
  shapes: [
    "IN THE FIRE: deplete self + destroy an item you control -> deck-search an item to hand",
    "LIFE'S WORK [E]x6: destroy self + destroy an item you control -> deck-search an item cost<=7 -> deploy it free"
  ],
  notes: "CONCESSION: 'deploy that card for free. If you don't, put it into your hand' — the fallback-to-hand path is not modelled; the deployFromZone is an optional pick, free.",
  confidence: "medium"
});

// =====================================================================
// ROGUE
// =====================================================================

V("Ashara, Gideon's Twin", {
  unique: "ashara",
  behavior: {
    onPlay: {
      targets: [{
        id: "revive",
        selector: {
          zone: "discard",
          type: "character",
          conditions: [{ type: "statCompare", target: cand, stat: "life", operator: "<=", value: 3 }]
        },
        count: 1,
        optional: true
      }],
      effects: [ifPicked("revive", [{ type: "putIntoPlay", target: pick("revive"), controller: "controller" }])]
    }
  }
}, {
  shapes: ["UNIQUE. EXTRA COST: may pick a char in an opp discard pile with life<=3; ETB if picked -> put it into play under your control"],
  notes: "CONCESSION: discard pick isn't owner-narrowed to the opponent (minor)."
});

V("Duskfall Buckgriff", {
  unique: "buckgriff",
  behavior: {
    keywords: ["tactical"],
    abilities: [{
      id: "sneak",
      type: "activated",
      costs: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "grantKeyword", target: "source", keyword: "covert", duration: eot }]
    }]
  }
}, { shapes: ["TACTICAL, UNIQUE. SNEAK: pay 1 -> COVERT this turn"] });

V("Lecram, Silent Advisor", {
  unique: "lecram",
  behavior: {
    keywords: ["covert"],
    abilities: [{
      id: "spy",
      type: "triggered",
      event: "turnEnding",
      condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{ type: "flipCoin", player: "controller", winEffects: [], loseEffects: [] }]
    }]
  }
}, {
  shapes: ["COVERT, UNIQUE. start of your turn: may look at the top card of your deck. end of your turn: flip a coin; if you win, look at an opponent's top card"],
  notes: "CONCESSION: both clauses are pure 'look' with no decision — the engine has no hidden-information model (RULES §5); the start-of-turn look is a no-op and the end clause is authored as the coin flip only.",
  confidence: "medium"
});

V("Waylay Blade", {
  attachTo: "character",
  unique: "waylay blade",
  behavior: {
    keywords: ["tactical"],
    abilities: [
      { id: "fortune", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" }, effects: [{ type: "flipCoin", player: "controller", winEffects: [draw(1)], loseEffects: [] }] },
      {
        id: "buff",
        type: "continuous",
        modifiers: [
          { target: "attachedTo", stat: "strength", operation: "add", value: 1 },
          { target: "attachedTo", stat: "life", operation: "add", value: 1 }
        ]
      },
      {
        id: "equip",
        type: "activated",
        targets: [tgt("host", { type: "character" })],
        effects: [{
          type: "mayPay",
          player: "controller",
          costs: [{ type: "payResources", amount: { type: "conditional", if: { type: "uniqueIs", target: pick("host"), designations: ["iohane"] }, then: 0, else: 3 } }],
          effects: [{ type: "attachTo", target: "source", to: pick("host") }]
        }]
      }
    ]
  }
}, {
  shapes: [
    "TACTICAL, UNIQUE, gear. start of your turn: coin flip -> if win, draw. attached char +1/+1",
    "EQUIP: pick a char (X=0 if UNIQUE IOHANE else 3); pay X -> attach"
  ],
  notes: "conditional NumberExpression (uniqueIs) for the EQUIP cost, wrapped in mayPay so a declined/unaffordable pay leaves the blade unattached.",
  confidence: "medium"
});

V("Well Laid Plans", {
  behavior: {
    abilities: [{
      id: "body",
      type: "activated",
      effects: [
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "theirs", selector: { owner: "opponent", zone: "deck" }, count: 1 },
          effects: [{ type: "putIntoPlay", target: pick("theirs"), controller: "opponent", faceDown: true }]
        },
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "mine", selector: { controller: "self", zone: "deck", type: "character" }, count: 1, optional: true },
          effects: [ifPicked("mine", [{ type: "putIntoPlay", target: pick("mine"), controller: "controller", faceDown: true }])]
        }
      ]
    }]
  }
}, {
  shapes: ["tactic: search the opponent's deck for a card -> into play as a face-down resource (under its owner); search your deck for a character -> into play as a face-down resource"],
  notes: "putIntoPlay faceDown:true = 'into play as a face-down resource'. CONCESSION: 'pick an opponent' = the opponent.",
  confidence: "medium"
});

// =====================================================================
// UNIVERSAL — Banner cycle (Crest-of-* template + mayPay + BURN IT)
// =====================================================================
function banner(name, icon, provideEffects) {
  const iconName = { g: "greed", d: "deception", o: "obsession", e: "elitism", r: "rage" }[icon];
  const trig = evt => ({
    id: evt === "resourcePlayed" ? "on-res" : "on-provide",
    type: "triggered",
    event: evt,
    condition: {
      type: "and",
      conditions: [
        evt === "resourcePlayed" ? { type: "eventPlayerIs", player: "controller" } : { type: "eventCardControlledBy", player: "controller" },
        { type: "cardProvides", target: "eventCard", icon: iconName, min: 1 }
      ]
    },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: provideEffects }]
  });
  V(name, {
    resource: { provides: [iconName] },
    behavior: {
      abilities: [
        trig("resourcePlayed"),
        trig("cardEnteredPlay"),
        { id: "burn", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "destroy", target: "source" }], effects: [draw(2)] }
      ]
    }
  }, {
    shapes: [`item/banner PROVIDES: [${icon.toUpperCase()}]. when a card providing >= [${icon.toUpperCase()}] enters under your control, mayPay 1 -> <effect>. BURN IT: pay 2 + destroy self -> draw 2`],
    notes: "Crest-of-* template: dual resourcePlayed + cardEnteredPlay triggers, mayPay 1 rider, BURN IT activated."
  });
}
banner("Banner of Fury", "r", [{
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "t", selector: { zone: "play", type: "character" }, count: 1, optional: true },
  effects: [ifPicked("t", [{ type: "createModifier", target: pick("t"), stat: "strength", operation: "add", value: 1, duration: eot }])]
}]);
banner("Banner of Betrayal", "d", [{
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "t", selector: { zone: "play", type: "character" }, count: 1, optional: true },
  effects: [ifPicked("t", [{ type: "createModifier", target: pick("t"), stat: "speed", operation: "add", value: 1, duration: eot }])]
}]);
banner("Banner of Elysium", "e", [{
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "d", selector: { controller: "self", zone: "play", type: "resource", attachedToFaction: true }, count: 2, optional: true },
  effects: [{ type: "forEach", selected: "d", effects: [{ type: "detach", target: cand }] }]
}]);
banner("Banner of Compulsion", "o", [{ type: "lookAndReorder", player: "controller", count: 3, to: "split" }]);
banner("Banner of Avarice", "g", [{
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "rfg", selector: { zone: "discard" }, count: 1 },
  effects: [
    { type: "removeFromGame", target: pick("rfg") },
    {
      type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "heal", selector: { zone: "play", type: "character" }, count: 1, optional: true },
      effects: [ifPicked("heal", [{ type: "createModifier", target: pick("heal"), stat: "life", operation: "add", value: 1, duration: eot }])]
    }
  ]
}]);

// =====================================================================
// WARLORD
// =====================================================================

V("Adriel, Supreme General of the Imperial Army", {
  unique: "adriel",
  behavior: {
    abilities: [
      {
        id: "volley-block",
        type: "triggered",
        event: "characterBlocked",
        condition: { type: "sourceIsEventCard" },
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "shot", selector: { zone: "play", conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: cand, cardType: "character" }, { type: "cardTypeIs", target: cand, cardType: "faction" }] }] }, count: 1, optional: true },
          effects: [ifPicked("shot", [{ type: "dealDamage", target: pick("shot"), amount: 1 }])]
        }]
      },
      {
        id: "volley-atk",
        type: "triggered",
        event: "characterAttacked",
        condition: { type: "sourceIsEventCard" },
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "shot2", selector: { zone: "play", conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: cand, cardType: "character" }, { type: "cardTypeIs", target: cand, cardType: "faction" }] }] }, count: 1, optional: true },
          effects: [ifPicked("shot2", [{ type: "dealDamage", target: pick("shot2"), amount: 1 }])]
        }]
      },
      {
        id: "rally",
        type: "replacement",
        replaces: { event: "destroy" },
        condition: { type: "isCard" },
        optional: true,
        effects: [{ type: "moveCard", target: cand, to: "deck", position: "top" }]
      }
    ]
  }
}, {
  shapes: [
    "UNIQUE. when it blocks or is blocked -> may pick a character or faction -> 1 damage",
    "replacement: if it would be destroyed, its owner may put it on top of their deck instead"
  ],
  notes: "'blocks or is blocked' = characterBlocked (this card blocks) + characterAttacked (this card enters a battle where it may be blocked). CONCESSION: the attacker-side trigger fires on any attack by Adriel, not only when actually blocked. Replacement self-scoped via {isCard} (__candidate === source).",
  confidence: "medium"
});

V("Draconarius Slitherform", {
  unique: "draconarius",
  behavior: {
    abilities: [
      {
        id: "onblock",
        type: "triggered",
        event: "attackerBlocked",
        condition: { type: "sourceIsEventCard" },
        targets: [{
          id: "blk",
          selector: { zone: "play", type: "character", conditions: [{ type: "inBattle", target: cand, role: "blocker" }] },
          count: { type: "battlePartySize", side: "blocking" }
        }],
        effects: [
          { type: "bind", id: "x", value: { type: "printedStat", target: "source", stat: "strength" } },
          { type: "distributeAmong", chooser: "controller", selected: "blk", amount: { type: "variable", id: "x" }, effects: [{ type: "dealDamage", target: cand, amount: { type: "variable", id: "__amount" } }] }
        ]
      },
      {
        id: "ondeath",
        type: "triggered",
        event: "cardDestroyed",
        condition: { type: "sourceIsEventCard" },
        targets: [{
          id: "foes",
          selector: { controller: "opponent", zone: "play", type: "character" },
          count: { type: "count", selector: { controller: "opponent", zone: "play", type: "character" } }
        }],
        effects: [
          { type: "bind", id: "x", value: { type: "printedStat", target: "source", stat: "strength" } },
          { type: "distributeAmong", chooser: "controller", selected: "foes", amount: { type: "variable", id: "x" }, effects: [{ type: "dealDamage", target: cand, amount: { type: "variable", id: "__amount" } }] }
        ]
      }
    ]
  }
}, {
  shapes: [
    "UNIQUE. when blocked -> X=strength, X damage divided among the blocking party",
    "when destroyed -> X=strength, X damage divided among opponents' characters"
  ],
  notes: "distributeAmong over an auto-filled party declaration (Ambuscade idiom: count = battlePartySize / count-expr). CONCESSION: 'this card's strength' uses printedStat (the card is gone by its own cardDestroyed trigger; Draconarius has no self-buffs).",
  confidence: "medium"
});

V("Ecneret, The Expendable One", {
  unique: "ecneret",
  behavior: {
    abilities: [{
      id: "martyr",
      type: "triggered",
      event: "cardDestroyed",
      condition: { type: "sourceIsEventCard" },
      effects: [{
        type: "forEach",
        selector: { controller: "self", zone: "play", type: "character" },
        effects: [
          { type: "createModifier", target: cand, stat: "strength", operation: "add", value: 2, duration: { type: "untilStartOfNextTurn" } },
          { type: "createModifier", target: cand, stat: "life", operation: "add", value: 2, duration: { type: "untilStartOfNextTurn" } }
        ]
      }]
    }]
  }
}, {
  shapes: ["UNIQUE. when destroyed -> characters you control gain +2/+2 until (the start of) your next turn"],
  notes: "CONCESSION: 'destroyed by an opposing card' — the 'by an opposing card' qualifier is not enforced (fires on any destruction). CONCESSION: 'until the end of your next turn' modelled as untilStartOfNextTurn (lapses at the start rather than the end of that turn).",
  confidence: "medium"
});

V("Elzibeth, Counter Imperial Countess", {
  unique: "elzibeth",
  behavior: {
    abilities: [{
      id: "keepemcoming",
      type: "activated",
      costs: [{ type: "payResources", amount: 3 }, { type: "deplete", target: "source" }],
      targets: [tgt("ward", { type: "character" })],
      effects: [{
        type: "installReplacement",
        replaces: { event: "destroy" },
        duration: eot,
        condition: { type: "isCard", target: cand, other: pick("ward") },
        effects: [{ type: "moveCard", target: cand, to: "deck", position: "top" }]
      }]
    }]
  }
}, {
  shapes: ["UNIQUE. KEEP EM COMING: pay 3 + deplete self, pick a char -> if that char would be destroyed this turn, put it on top of its owner's deck instead"],
  notes: "installReplacement (Open Beta) on `destroy`, gated to the picked card, duration untilEndOfTurn."
});

V("Goutflame Talonclaw", {
  unique: "goutflame talonclaw",
  flipUp: { cost: [{ type: "payResources", amount: 9 }], threshold: "rrrrr" },
  behavior: {
    abilities: [
      {
        id: "etb",
        type: "triggered",
        event: "cardEnteredPlay",
        condition: { type: "sourceIsEventCard" },
        effects: [{
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: {
            id: "smash",
            selector: { zone: "play", conditions: [{ type: "or", conditions: [
              { type: "cardTypeIs", target: cand, cardType: "location" },
              { type: "cardTypeIs", target: cand, cardType: "item" },
              { type: "cardTypeIs", target: cand, cardType: "character" }
            ] }] },
            count: 3,
            optional: true
          },
          effects: [{ type: "forEach", selected: "smash", effects: [{ type: "destroy", target: cand }] }]
        }]
      },
      {
        id: "warded",
        type: "continuous",
        modifiers: [],
        restrictions: [{ target: "source", restriction: "cannotBeTakenControl" }],
        blockRestriction: { blockerMustNotMatch: { conditions: [{ type: "statCompare", target: cand, stat: "strength", operator: "<=", value: 1 }] } }
      },
      { id: "phoenix-d", type: "replacement", replaces: { event: "destroy" }, condition: { type: "isCard" }, effects: [{ type: "flipFaceDown", target: cand }] },
      { id: "phoenix-r", type: "replacement", replaces: { event: "moveToZone", zone: "removed" }, condition: { type: "isCard" }, effects: [{ type: "flipFaceDown", target: cand }] }
    ]
  }
}, {
  shapes: ["UNIQUE. ETB: may destroy up to 3 permanents. cannot be taken control of; cannot be blocked by strength<=1. if it would be destroyed OR removed -> flip face-down instead. FLIP UP 9 [R]x5"],
  notes: "'cannot be blocked by strength<=1' = blockRestriction.blockerMustNotMatch (Ungodly Mess). Two self-scoped ({isCard}) replacements: destroy + moveToZone zone:'removed' -> flipFaceDown. CONCESSION: ETB pick is 'up to 3' rather than one-of-each-type.",
  confidence: "medium"
});

V("Invade!", {
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        targets: [tgt("mark", { type: "character" })],
        effects: [{ type: "grantRestriction", target: pick("mark"), restriction: "cannotBlock", duration: eot }]
      },
      {
        id: "reuse",
        type: "activated",
        fromFaceDown: true,
        threshold: "rr",
        costs: [
          { type: "payResources", amount: 4 },
          { type: "discard", id: "toll", player: "self", selector: { controller: "self", zone: "hand" }, count: 1 }
        ],
        targets: [tgt("mark2", { type: "character" })],
        effects: [{ type: "grantRestriction", target: pick("mark2"), restriction: "cannotBlock", duration: eot }]
      }
    ]
  }
}, {
  shapes: [
    "tactic: pick a char -> cannot block this turn",
    "REUSE [R][R] while a face-down resource: reveal + pay 4 + discard a card, pick a char -> cannot block this turn"
  ],
  notes: "REUSE = an activated ability with fromFaceDown:true (Fired Hand / Vorpal Sword idiom); 'Reveal this card' is implicit."
});

V("Storm the Gates", {
  flipUp: { cost: [{ type: "payResources", amount: 1 }], threshold: "r" },
  behavior: {
    abilities: [{
      id: "body",
      type: "activated",
      targets: [
        tgt("sac", { owner: "self", type: "character" }),
        tgt("mark", { owner: "opponent", type: "character" })
      ],
      costs: [{ type: "destroy", target: pick("sac") }],
      effects: [
        { type: "dealDamage", target: pick("mark"), amount: 5 },
        { type: "if", condition: { type: "not", condition: { type: "targetInZone", target: pick("mark"), zone: "play" } }, effects: [draw(1)] }
      ]
    }]
  }
}, {
  shapes: ["tactic: EXTRA COST destroy a char you own; pick an opp char -> 5 damage; if it died to that damage -> draw. FLIP UP 1 [R]"],
  notes: "'destroyed by that damage' = if(not targetInZone(mark,'play')) after dealDamage (Holy Heist idiom)."
});

V("The Emperor Born", {
  flipUp: { cost: [{ type: "payResources", amount: 1 }], threshold: "r" },
  behavior: {
    abilities: [
      {
        id: "body",
        type: "activated",
        condition: { type: "not", condition: { type: "battleActive" } },
        targets: [tgt("back", { owner: "self", zone: "discard", type: "character" })],
        effects: [{ type: "deployFromZone", player: "controller", target: pick("back"), free: false }]
      },
      {
        id: "reuse",
        type: "activated",
        fromFaceDown: true,
        threshold: "r",
        costs: [
          { type: "payResources", amount: 4 },
          { type: "discard", id: "toll", player: "self", selector: { controller: "self", zone: "hand" }, count: 1 }
        ],
        targets: [tgt("back2", { owner: "self", zone: "discard", type: "character" })],
        effects: [{ type: "deployFromZone", player: "controller", target: pick("back2"), free: false }]
      }
    ]
  }
}, {
  shapes: [
    "tactic (not battleActive): pick a char in your discard -> you may deploy it (pays its cost)",
    "REUSE [R] while a face-down resource: reveal + pay 4 + discard, pick a char in your discard -> you may deploy it"
  ],
  notes: "'You may deploy the character' = deployFromZone free:false (the deployed card's own cost is still paid)."
});

V("The Enemy's Head", {
  behavior: {
    abilities: [
      {
        id: "harvest",
        type: "triggered",
        event: "cardDestroyed",
        condition: { type: "and", conditions: [{ type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "opponent" }] },
        effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }]
      },
      {
        id: "might",
        type: "continuous",
        modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } }]
      }
    ]
  }
}, {
  shapes: ["item: when an opp character is destroyed -> mayPay 1 -> token on this. characters you control gain +1 strength per token"],
  notes: "cardDestroyed + eventCardControlledBy opponent; aura strength modifier over count(token)."
});

// ---------------------------------------------------------------------
if (!DRY) {
  fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2) + "\n");
  fs.writeFileSync(COV_PATH, JSON.stringify(cov, null, 2) + "\n");
}
console.log(`${DRY ? "[dry]" : "[applied]"} authored ${applied} novel Seed Saga cards`);
