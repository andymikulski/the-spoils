#!/usr/bin/env node
/* Author `behavior` (+ unique / attachTo) onto the 160 classified
 * 1st Edition Part 2 cards in data/cards.json, per .work/p2-author-worksheet.txt.
 * Re-runnable. Writes JSON.stringify(_, null, 2) + "\n". Run `npm run sync-cards` after.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");

const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const byId = new Map(cards.map(c => [c.id, c]));

// --- shorthand builders --------------------------------------------------
const S = id => ({ type: "selected", id });
const cmod = (target, stat, operation, value, duration) => ({
  type: "createModifier", target, stat, operation, value, duration
});
const UEOT = { type: "untilEndOfTurn" };
const PERM = { type: "permanent" };
const WSIP = { type: "whileSourceInPlay" };
const counter = (target, c = "token") => ({ type: "counter", target, counter: c });
const negCounter = target => ({ type: "multiply", values: [counter(target), -1] });

const P = {};  // id -> patch { behavior, unique?, attachTo? }

// ======================================================================
// ARCANIST
// ======================================================================

P["88ddad6c-4df5-4baa-b1b8-c7492f67d42e"] = { // Ambiguity Embiggener
  behavior: { abilities: [
    { id: "wheel", type: "triggered", event: "turnStarted", effects: [
      { type: "chooserSelectsNumber", chooser: "activePlayer", storeAs: "x", min: 0, max: 99, effects: [
        { type: "forEachPlayer", effects: [
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "bot", selector: { owner: "self", zone: "hand" }, count: { type: "variable", id: "x" }, optional: true },
            effects: [ { type: "forEach", selected: "bot", effects: [
              { type: "moveCard", target: S("__candidate"), to: "deck", position: "bottom" } ] } ] },
          { type: "draw", player: "controller", amount: { type: "selectionCount", id: "bot" } }
        ] }
      ] }
    ] }
  ] }
};

P["5a6a4268-1c9c-4a97-8d54-3c247dc82e72"] = { // Ameliorate
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "bot", selector: { owner: "self", zone: "hand" }, count: { type: "count", selector: { owner: "self", zone: "hand" } }, optional: true },
        effects: [ { type: "forEach", selected: "bot", effects: [
          { type: "moveCard", target: S("__candidate"), to: "deck", position: "bottom" } ] } ] },
      { type: "draw", player: "controller", amount: { type: "add", values: [ { type: "selectionCount", id: "bot" }, 1 ] } }
    ] }
  ] }
};

P["7b05e4a8-cff1-441c-91bc-de6f671f8b12"] = { // Arcanology Recruitment Officer
  behavior: { abilities: [
    { id: "cloak", type: "triggered", event: "turnStarted",
      condition: { type: "isActivePlayer", player: "controller" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "c", selector: { controller: "opponent", type: "character" }, count: 1 },
        effects: [ { type: "grantKeyword", target: S("c"), keyword: "covert", duration: { type: "untilStartOfNextTurn" } } ] } ] }
  ] }
};

P["2437c2d0-0578-4d66-826b-c1184c9bd72d"] = { // Cloaked Creeper
  behavior: { keywords: ["covert"], abilities: [
    { id: "party", type: "continuous",
      condition: { type: "inBattle", target: "source", role: "attacker" },
      modifiers: [],
      keywords: [ { selector: { type: "character", conditions: [ { type: "sharesBattlePartyWithSource", target: S("__candidate") } ] }, keyword: "covert" } ] }
  ] }
};

P["b28841ab-18e2-4a2e-aeb1-94b124f7baae"] = { // Deceptive Muddler
  behavior: { keywords: ["covert"], abilities: [
    { id: "topdeck", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" } ] },
      effects: [ { type: "chooserSelectsTarget", chooser: { type: "controllerOf", target: "eventCard" },
        declaration: { id: "h", selector: { owner: { type: "ownerOf", target: "eventCard" }, zone: "hand" }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("h"), to: "deck", position: "top" } ] } ] }
  ] }
};

P["79146bd7-cc3c-4a56-9071-feca013f73a8"] = { // Dimensional Rift
  behavior: { abilities: [
    { id: "teleport", type: "activated",
      costs: [ { type: "payResources", amount: 4 }, { type: "deplete", target: "source" } ],
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] }
  ] }
};

P["847cd807-e515-4c1f-8c4d-fa0ffd7b217d"] = { // Eccentric Inquisition
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "voided", selector: { owner: "opponent", zone: "deck", fromTop: 7, type: "tactic" }, count: 7, optional: true } ],
      effects: [
        { type: "forEach", selected: "voided", effects: [ { type: "moveCard", target: S("__candidate"), to: "void" } ] },
        { type: "lookAndReorder", player: "opponent", chooser: "controller", to: "bottom",
          count: { type: "add", values: [ 7, { type: "multiply", values: [ { type: "selectionCount", id: "voided" }, -1 ] } ] } },
        { type: "grantVoidPlay", selected: "voided", player: "controller", ignoreThreshold: true }
      ] }
  ] }
};

P["e667dbee-fc6b-4353-b580-ab4c38a3aeb7"] = { // Ectological Hazard Suit
  attachTo: "character",
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "addCounter", target: "attachedTo", counter: "token", amount: 1 } ] },
    { id: "buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: counter("attachedTo") },
      { target: "attachedTo", stat: "life", operation: "add", value: counter("attachedTo") } ] },
    { id: "handoff", type: "activated",
      costs: [ { type: "payResources", amount: 1 }, { type: "deplete", target: S("w") } ],
      targets: [ { id: "w", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1 } ],
      effects: [ { type: "attachTo", target: "source", to: S("w") } ] }
  ] }
};

P["11f9caf2-79de-478a-a87f-c2fcfb90e11a"] = { // Eldridge Gosche
  unique: "eldridge",
  behavior: { abilities: [
    { id: "sot", type: "triggered", event: "turnStarted", condition: { type: "isActivePlayer", player: "controller" },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Distribute tokens", effects: [
          { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "picks", selector: { controller: "self", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 2, optional: true },
            effects: [
              { type: "chooserSelectsNumber", chooser: "controller", storeAs: "t", min: 0, max: 2, effects: [
                { type: "distributeAmong", chooser: "controller", selected: "picks", amount: { type: "variable", id: "t" },
                  effects: [ { type: "addCounter", target: S("__candidate"), counter: "token", amount: { type: "variable", id: "__amount" } } ] } ] }
            ] } ] },
        { label: "Decline", effects: [] } ] } ] },
    { id: "eject", type: "activated",
      costs: [ { type: "removeCounter", target: "source", counter: "token", amount: 3 } ],
      targets: [ { id: "c", selector: { conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 1 } ],
      effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] },
    { id: "disrupt", type: "activated",
      costs: [ { type: "removeCounter", target: "source", counter: "token", amount: 3 } ],
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "h", selector: { owner: "opponent", zone: "hand" }, count: 1 },
        effects: [ { type: "moveCard", target: S("h"), to: "discard" } ] } ] }
  ] }
};

P["3d8e8296-ede6-4d43-bbe3-9f94c74d65f2"] = { // Emphatic Ecto-Manipulator
  behavior: { onPlay: {
    targets: [ { id: "pick", selector: { controller: "self", type: "character" }, count: 1, optional: true } ],
    effects: [ { type: "if", condition: { type: "targetExists", target: S("pick") },
      effects: [ { type: "addCounter", target: S("pick"), counter: "token", amount: 2 } ] } ]
  } }
};

P["51e17074-b46e-4ba5-963b-34e1585e3208"] = { // Entangle
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "picks", selector: { type: "character" }, count: 2, optional: true } ],
      effects: [
        { type: "forEach", selected: "picks", effects: [ cmod(S("__candidate"), "speed", "add", -1, UEOT) ] },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

P["d65c3554-ba90-45e8-ab26-4f8d42d498b7"] = { // Gnat
  behavior: { abilities: [
    { id: "leave", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" } ] },
      effects: [ { type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "h", selector: { owner: "opponent", zone: "hand" }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("h"), to: "discard" } ] } ] }
  ] }
};

P["ab4bed28-7665-4017-b829-4c95c366a61e"] = { // Infatuated Armchair
  behavior: { abilities: [
    { id: "leave", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" } ] },
      effects: [
        { type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Look at your deck", effects: [ { type: "lookAndReorder", player: "controller", count: 2, to: "split" } ] },
          { label: "Look at an opponent's deck", effects: [ { type: "lookAndReorder", player: "opponent", chooser: "controller", count: 2, to: "split" } ] },
          { label: "Decline", effects: [] } ] },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

P["43276113-4afd-4e0f-a4c6-ff41c9a51cb2"] = { // Insect Appreciator
  behavior: { abilities: [
    { id: "even", type: "continuous", modifiers: [], partyRestriction: { role: "any", parity: "even" } }
  ] }
};

P["556c61ec-857e-4773-80fb-b180513696f4"] = { // Maladjustment
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "res", selector: { controller: "self", type: "resource" }, count: 1 } ],
      effects: [
        { type: "moveCard", target: S("res"), to: "hand" },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "play", selector: { owner: "self", zone: "hand" }, count: 1, optional: true },
          effects: [ { type: "playResource", target: S("play"), faceDown: "auto", player: "controller" } ] }
      ] }
  ] }
};

P["2d436db8-8973-4f0b-b830-a343ab068908"] = { // Obsessive Compulsion
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "lookAndReorder", player: "controller", count: 3, to: "split" },
      { type: "draw", player: "controller", amount: 1 }
    ] }
  ] }
};

P["b7c7b011-86ef-46db-8b26-c659ad1f24c1"] = { // Odious Diva
  behavior: { abilities: [
    { id: "disapprove", type: "activated",
      costs: [ { type: "payResources", amount: 2 } ],
      effects: [
        { type: "nameValue", chooser: "controller", valueKind: "cardName", storeAs: "named" },
        { type: "chooserSelectsTarget", chooser: "opponent",
          declaration: { id: "x", selector: { owner: "opponent", zone: "hand", nameVar: "named" }, count: 1, optional: true },
          effects: [
            { type: "moveCard", target: S("x"), to: "deck", position: "bottom" },
            { type: "draw", player: "opponent", amount: 1 }
          ] }
      ] }
  ] }
};

P["7c522a1a-aa18-4afa-955e-2a047ff91ecb"] = { // Quotidian Disappearance
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "c", selector: { controller: "opponent", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] }
    ] }
  ] }
};

P["b1f959d9-c5cd-4a7c-9b1b-dfcac62fd6a6"] = { // Quotidian Virtuoso
  behavior: { abilities: [
    { id: "disrupt", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "h", selector: { owner: "opponent", zone: "hand" }, count: 1 },
        effects: [ { type: "moveCard", target: S("h"), to: "discard" } ] } ] }
  ] }
};

P["e5a8f861-fbbd-4c45-8b1d-2ddec10120bd"] = { // Recollection Bazaar
  behavior: { abilities: [
    { id: "recall", type: "activated",
      targets: [ { id: "res", selector: { controller: "self", type: "resource" }, count: 1 } ],
      effects: [ { type: "moveCard", target: S("res"), to: "hand" } ] }
  ] }
};

P["dbc439b3-5628-43ef-bbc1-ea7523e85fb0"] = { // Ritual of the Knob & Pull
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "stat", target: S("c"), stat: "strength" } },
        { type: "if", condition: { type: "numberCompare",
          left: { type: "resourceIcons", player: { type: "controllerOf", target: S("c") }, icon: "volition" },
          operator: ">=", right: { type: "variable", id: "x" } },
          effects: [ { type: "destroy", target: S("c") } ] }
      ] }
  ] }
};

P["8bdf8634-d49d-43f6-b267-15978fab6227"] = { // Ritual of the Ominous Urn
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "disc", selector: { owner: "opponent", zone: "hand" }, count: 1, optional: true },
        effects: [
          { type: "moveCard", target: S("disc"), to: "discard" },
          { type: "rememberTarget", key: "disc", target: S("disc") }
        ] },
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "found", selector: { owner: "self", zone: "deck", conditions: [ { type: "cardTypeEquals", target: S("__candidate"), other: { type: "remembered", key: "disc" } } ] }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("found"), to: "hand" } ] }
    ] }
  ] }
};

P["91748250-8687-4e0b-84a4-4380bc3c2bab"] = { // Rummaging Millipede
  behavior: { keywords: ["covert"], abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "t", selector: { owner: "self", zone: "discard", type: "tactic" }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("t"), to: "hand" } ] } ] }
  ] }
};

P["cebf2a7c-905e-433d-b6ab-bcdc2aafacbf"] = { // The Deranger
  behavior: { abilities: [
    { id: "lobotomize", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "h", selector: { owner: "opponent", zone: "hand", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 2, optional: true },
          effects: [ { type: "forEach", selected: "h", effects: [ { type: "moveCard", target: S("__candidate"), to: "discard" } ] } ] },
        { type: "takeControl", target: "source", controller: "opponent" }
      ] }
  ] }
};

P["0467bfd8-73bc-425e-9f6e-44a7f28ff00a"] = { // Toxic Cultivator
  behavior: { abilities: [
    { id: "cheap", type: "continuous",
      condition: { type: "numberCompare", left: { type: "modulo", value: { type: "count", selector: { controller: "self", type: "character" } }, by: 2 }, operator: "=", right: 0 },
      modifiers: [],
      costModifiers: [ { affects: "controller", selector: { type: "tactic" }, delta: -1, minCost: 1 } ] }
  ] }
};

P["c1c2efc5-f032-4c05-89fa-ab3c97a73aba"] = { // Unnatural Alteration
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "and", conditions: [ { type: "isActivePlayer", player: "controller" }, { type: "not", condition: { type: "battleActive" } } ] },
      targets: [ { id: "c", selector: { controller: "self", type: "character" }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "cardCost", target: S("c") } },
        { type: "destroy", target: S("c") },
        { type: "if", condition: { type: "targetInZone", target: S("c"), zone: "discard" },
          effects: [ { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "found", selector: { owner: "self", zone: "deck", type: "character", conditions: [ { type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "add", values: [ { type: "variable", id: "x" }, 3 ] } } ] }, count: 1, optional: true },
            effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
              { label: "Deploy it for free", effects: [ { type: "deployFromZone", player: "controller", target: S("found") } ] },
              { label: "Put it into your hand", effects: [ { type: "moveCard", target: S("found"), to: "hand" } ] } ] } ] } ] }
      ] }
  ] }
};

P["b374445f-2ac5-40b2-bfc5-5ee47771db6c"] = { // Venomous Sacspider
  behavior: { abilities: [
    { id: "spite", type: "triggered", event: "cardDestroyed",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "destroyedByBattleDamage" } ] },
      effects: [ { type: "forEach", selector: { owner: "opponent", zone: "hand" },
        effects: [ { type: "moveCard", target: S("__candidate"), to: "discard" } ] } ] }
  ] }
};

P["973827cb-fb59-4ce8-9681-1263a14d2e62"] = { // Violating Anomaly
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "h", selector: { owner: "opponent", zone: "hand" }, count: 1 },
        effects: [ { type: "moveCard", target: S("h"), to: "discard" } ] } ] },
    { id: "leave", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" } ] },
      effects: [
        { type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Bounce a non-resource card", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "c", selector: { conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 1 },
            effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] } ] },
          { label: "Decline", effects: [] } ] },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

P["73269637-6bcc-4f27-9770-d42b0f146f4b"] = { // Voidal Interference
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "respondingTo", respondsTo: "card" },
      effects: [
        { type: "terminate", scope: "respondedItem", disposition: "hand" },
        { type: "chooserSelectsTarget", chooser: { type: "ownerOf", target: { type: "respondedToCard" } },
          declaration: { id: "h", selector: { owner: { type: "ownerOf", target: { type: "respondedToCard" } }, zone: "hand" }, count: 1, optional: true },
          effects: [ { type: "moveCard", target: S("h"), to: "deck", position: "top" } ] }
      ] }
  ] }
};

// ======================================================================
// GEARSMITH
// ======================================================================

P["45a1bfe0-f338-454c-b3ee-7dc5b6b55235"] = { // 0p3r4710n 1337 H4x0rz
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "isActivePlayer", player: "controller" },
      effects: Array.from({ length: 4 }, () => ({
        type: "deployForFree", player: "controller", free: true, maxCost: 999,
        selector: { conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "tactic" } } ] }
      })) }
  ] }
};

P["f98c69dc-d771-430d-95f0-69461bc3c1ee"] = { // 4p7 31f
  behavior: { abilities: [
    { id: "detach", type: "triggered", event: "cardEnteredPlay",
      condition: { type: "and", conditions: [ { type: "cardSubtypeIs", target: "eventCard", subtype: "gear" }, { type: "hasAttachment", target: "source", ofSubtype: "gear" } ] },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Detach a resource from your faction", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { controller: "self", type: "resource" }, count: 1 },
          effects: [ { type: "detach", target: S("r") } ] } ] },
        { label: "Decline", effects: [] } ] } ] },
    { id: "buff", type: "continuous",
      condition: { type: "hasAttachment", target: "source", ofSubtype: "gear" },
      modifiers: [
        { target: "source", stat: "strength", operation: "add", value: 1 },
        { target: "source", stat: "life", operation: "add", value: 1 } ] }
  ] }
};

P["43b52d42-fc5b-426d-8188-0390a4272f6c"] = { // Acuminous Gigantitect
  behavior: { abilities: [
    { id: "grand", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "reduceNextCost", player: "controller", amount: 6 } ] }
  ] }
};

P["e6209034-2b54-4889-8789-15b12c330056"] = { // Contriving Engineer
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "e", selector: { owner: "self", zone: "deck", name: "Elitism" }, count: 1, optional: true },
        effects: [ { type: "putIntoPlay", target: S("e"), controller: "controller" } ] } ] }
  ] }
};

P["42334135-ad09-4e14-b243-597d4a44384e"] = { // Discommodiousness
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "bind", id: "x", value: { type: "count", selector: { owner: "opponent", zone: "hand", type: "tactic" } } },
      { type: "forEach", selector: { owner: "opponent", zone: "hand", type: "tactic" }, effects: [ { type: "moveCard", target: S("__candidate"), to: "deck" } ] },
      { type: "shuffleDeck", player: "opponent" },
      { type: "draw", player: "opponent", amount: { type: "variable", id: "x" } },
      { type: "draw", player: "controller", amount: 1 }
    ] }
  ] }
};

P["3dd0c05f-dd1d-49a2-b7b5-ab17f0ee8bd3"] = { // Elite Team Registration
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "g", selector: { owner: "self", zone: "deck", type: "character", conditions: [ { type: "cardTradeIs", target: S("__candidate"), trade: "gearsmith" } ] }, count: 2, optional: true, distinctNames: true },
        effects: [ { type: "forEach", selected: "g", effects: [ { type: "moveCard", target: S("__candidate"), to: "hand" } ] } ] }
    ] }
  ] }
};

P["5f6c7c41-3be8-44ce-9293-454a35772c0f"] = { // Epiphany Ball
  behavior: { abilities: [
    { id: "insight", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "c", selector: { owner: "self", zone: "deck" }, count: 1 },
          effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] },
        { type: "takeControl", target: "source", controller: "opponent" }
      ] }
  ] }
};

P["ab111049-6ba1-430e-8d27-f647bcd5ac35"] = { // Exploding Sock Puppet!
  behavior: { noResponse: true, abilities: [
    { id: "body", type: "activated",
      condition: { type: "respondingTo", respondsTo: "ability", cardType: "character" },
      effects: [
        { type: "terminate", scope: "respondedItem" },
        { type: "destroy", target: { type: "respondedAbilitySource" } }
      ] }
  ] }
};

P["d8b8dada-5302-4ef8-b226-59688a14f294"] = { behavior: { keywords: ["aggro"] } }; // Guardforce Alpha Prime 31f

P["0d08df2b-8e38-40d5-ad9b-f90d4af1fb7c"] = { // Guardforce Alpha Prime H4x0r
  unique: "guardforce alpha prime h4x0r",
  behavior: { keywords: ["aggro"], abilities: [
    { id: "res", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" } ] },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Play a resource", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { owner: "self", zone: "hand" }, count: 1, optional: true },
          effects: [ { type: "playResource", target: S("r"), faceDown: "auto", player: "controller" } ] } ] },
        { label: "Decline", effects: [] } ] } ] }
  ] }
};

P["6af508e9-b4a9-473d-80fc-4c1ecbdd5781"] = { // Guardforce Morphmajig
  behavior: { keywords: ["aggro"], abilities: [
    { id: "gain", type: "triggered", event: "cardPlayed", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 1 } ] },
    { id: "lose", type: "triggered", event: "cardPlayed", condition: { type: "eventPlayerIs", player: "opponent" },
      effects: [ { type: "removeCounter", target: "source", counter: "token", amount: 1 } ] },
    { id: "buff", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: counter("source") },
      { target: "source", stat: "life", operation: "add", value: counter("source") } ] }
  ] }
};

P["8dfc4763-6428-4c32-a5bd-366f65dd5b80"] = { // Heavy Plating
  attachTo: "character",
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Detach up to 2 resources", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { controller: "self", type: "resource" }, count: 2, optional: true },
          effects: [ { type: "forEach", selected: "r", effects: [ { type: "detach", target: S("__candidate") } ] } ] } ] },
        { label: "Decline", effects: [] } ] } ] },
    { id: "buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: 4 },
      { target: "attachedTo", stat: "life", operation: "add", value: 4 },
      { target: "attachedTo", stat: "speed", operation: "add", value: -1 } ] },
    { id: "handoff", type: "activated",
      costs: [ { type: "payResources", amount: 5 }, { type: "deplete", target: S("w") } ],
      targets: [ { id: "w", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1 } ],
      effects: [ { type: "attachTo", target: "source", to: S("w") } ] }
  ] }
};

// Horsemajig aura helper
const horsemajigAura = (statList) => ({
  behavior: { abilities: [
    { id: "aura", type: "continuous", modifiers: statList.map(stat => ({
      selector: { type: "character", subtype: "horsemajig", conditions: [ { type: "not", condition: { type: "cardNameEquals", target: S("__candidate"), other: "source" } } ] },
      stat, operation: "add", value: 1 })) }
  ] }
});
P["864e66a1-9fb7-404d-9576-fcc0c5e4901a"] = horsemajigAura(["strength", "life", "speed"]); // Death
P["143db371-4e9a-474a-b536-1d7f8efe26e6"] = horsemajigAura(["speed"]); // Famine
P["2f4a7db5-598c-445d-a4f6-d45c7e740582"] = horsemajigAura(["life"]); // Pestilence
P["d6015ff5-c210-4133-89a3-c539461b0db0"] = horsemajigAura(["strength"]); // War

P["03ff491b-019b-444d-bbf4-3cdbf5323a10"] = { // Kaiser Wave
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [
        cmod(S("c"), "strength", "add", { type: "add", values: [ 1, { type: "count", selector: { subtype: "kaiser" } }, { type: "conditional", if: { type: "cardSubtypeIs", target: S("c"), subtype: "kaiser" }, then: 1, else: 0 } ] }, UEOT),
        cmod(S("c"), "life", "add", { type: "add", values: [ 1, { type: "count", selector: { subtype: "kaiser" } }, { type: "conditional", if: { type: "cardSubtypeIs", target: S("c"), subtype: "kaiser" }, then: 1, else: 0 } ] }, UEOT)
      ] }
  ] }
};

P["48a4905f-236a-436e-b066-714b7cdbb70e"] = { // LeoKaiser
  behavior: { abilities: [
    { id: "mega", type: "activated",
      targets: [
        { id: "pk", selector: { controller: "self", name: "PantherKaiser" }, count: 1 },
        { id: "tk", selector: { controller: "self", name: "TigerKaiser" }, count: 1 } ],
      costs: [ { type: "deplete", target: S("pk") }, { type: "deplete", target: S("tk") } ],
      effects: [
        cmod("source", "strength", "add", 8, UEOT),
        cmod("source", "life", "add", 8, UEOT),
        cmod("source", "speed", "add", 2, UEOT),
        { type: "restrictBlockers", target: "source", minPartySize: 3, duration: UEOT,
          condition: { type: "numberCompare", left: { type: "battlePartySize", side: "ownParty", of: "source" }, operator: "=", right: 1 } }
      ] }
  ] }
};

P["c466319c-2c2d-48eb-8511-4033385a6c30"] = { // Micromajig Shipping Container
  behavior: { abilities: [
    { id: "burst", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "createTokens", controller: "controller", count: 5,
        token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } } ] }
  ] }
};

P["118e132f-9ad3-45c7-825e-88b00941f8ef"] = { // Omnidirectional Patrolmajig
  behavior: { abilities: [
    { id: "brace", type: "triggered", event: "battleStarted", condition: { type: "battleRole", role: "defender" },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Restore this card", effects: [ { type: "restore", target: "source" } ] },
        { label: "Decline", effects: [] } ] } ] }
  ] }
};

P["eb3eb01d-cb76-4159-a269-b9d1bbe3b973"] = { // PantherKaiser
  behavior: { abilities: [
    { id: "shield", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "deplete", target: "source" } ],
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ cmod(S("c"), "life", "add", 3, UEOT) ] }
  ] }
};

P["b3ed1ba4-1a95-4da5-94d0-f8dc5f59b36d"] = { // Patent Enforcement
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "respondingTo", respondsTo: "card", cardType: "item" },
      costs: [ { type: "payResources", amount: { type: "cardCost", target: { type: "respondedToCard" } } } ],
      effects: [
        { type: "rememberTarget", key: "stolen", target: { type: "respondedToCard" } },
        { type: "terminate", scope: "respondedItem" },
        { type: "putIntoPlay", target: { type: "remembered", key: "stolen" }, controller: "controller" }
      ] }
  ] }
};

P["04a9990f-2c23-4788-96da-17e120fa53b7"] = { // Quipmajig
  behavior: { abilities: [
    { id: "insult", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "c", selector: { type: "character", conditions: [ { type: "hasKeyword", target: S("__candidate"), keyword: "covert" } ] }, count: 1 } ],
      effects: [
        { type: "deplete", target: S("c") },
        { type: "modifyOutgoingDamage", source: S("c"), delta: -999, duration: UEOT }
      ] }
  ] }
};

P["35a182a8-dfd2-42c7-b5a3-f2a10dff9f40"] = { // Runic Field Enhancer
  unique: "runic field enhancer",
  behavior: { abilities: [
    { id: "aura", type: "continuous", modifiers: [
      { selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: { type: "count", selector: { controller: "self", subtype: "gear" } } },
      { selector: { controller: "self", type: "character" }, stat: "life", operation: "add", value: { type: "count", selector: { controller: "self", subtype: "gear" } } } ] }
  ] }
};

P["ac010020-67ca-4fbe-b1fa-74e261a76c84"] = { // Sagacious 31f
  behavior: { abilities: [
    { id: "scout", type: "triggered", event: "characterAttacked",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 3 } ] },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Search your deck for a card", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "c", selector: { owner: "self", zone: "deck" }, count: 1, optional: true },
          effects: [ { type: "moveCard", target: S("c"), to: "hand" } ] } ] },
        { label: "Decline", effects: [] } ] } ] }
  ] }
};

P["8041780e-69a0-458a-8563-eabfa164ac2f"] = { // Schproingmajig
  behavior: { abilities: [
    { id: "pumpup", type: "activated",
      targets: [ { id: "o", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "cardNameEquals", target: S("__candidate"), other: "source" } } ] }, count: 1 } ],
      costs: [ { type: "deplete", target: S("o") } ],
      effects: [ cmod("source", "strength", "add", 2, UEOT), cmod("source", "life", "add", 2, UEOT) ] },
    { id: "schproing", type: "activated",
      targets: [ { id: "s", selector: { controller: "self", type: "character" }, count: 1 } ],
      costs: [ { type: "destroy", target: S("s") } ],
      effects: [ { type: "grantKeyword", target: "source", keyword: "cannotBeBlocked", duration: UEOT } ] }
  ] }
};

P["c56085da-7855-456e-81cf-5c822300ca3e"] = { // Scorching Runicution
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "g", selector: { conditions: [ { type: "cardSubtypeIs", target: S("__candidate"), subtype: "gear" } ] }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "cardCost", target: S("g") } },
        { type: "dealDamage", target: { type: "attachmentHost", target: S("g") }, amount: { type: "variable", id: "x" } },
        { type: "destroy", target: S("g") }
      ] }
  ] }
};

P["c1d2e319-7435-40aa-a215-76bd52b37d78"] = { // Senior Research Assistant
  behavior: { abilities: [
    { id: "research", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      effects: [ { type: "reduceNextCost", player: "controller", amount: 2 } ] }
  ] }
};

P["ee76ecf6-a635-4d63-9357-fb78a53b3052"] = { // Spackle
  behavior: { abilities: [
    { id: "repair", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "loc", selector: { type: "location" }, count: 1 } ],
      effects: [ { type: "healDamage", target: S("loc"), amount: 2 } ] }
  ] }
};

const tforce5Detach = {
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Detach up to 2 resources", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { controller: "self", type: "resource" }, count: 2, optional: true },
          effects: [ { type: "forEach", selected: "r", effects: [ { type: "detach", target: S("__candidate") } ] } ] } ] },
        { label: "Decline", effects: [] } ] } ] }
  ] }
};
P["8039fd38-e699-489c-949b-0de160346cb2"] = tforce5Detach; // Megabrutemajig
P["8ec43855-13bb-4b04-9504-c0e6a275acc6"] = tforce5Detach; // Megadudemajig
P["dfd1b21a-d461-4031-a3db-6c56557d771b"] = tforce5Detach; // Megascoutmajig

P["8ac37971-303b-4ec6-bf9b-a09c1883a44a"] = { // The Whatever Device
  behavior: { abilities: [
    { id: "thankgod", type: "activated",
      variableBounds: { x: { min: 0 } },
      costs: [ { type: "payResources", amount: { type: "variable", id: "x" } }, { type: "destroy", target: "source" } ],
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "found", selector: { owner: "self", zone: "deck", type: "item", conditions: [ { type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "variable", id: "x" } } ] }, count: 1, optional: true },
        effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Deploy it for free", effects: [ { type: "deployFromZone", player: "controller", target: S("found") } ] },
          { label: "Put it into your hand", effects: [ { type: "moveCard", target: S("found"), to: "hand" } ] } ] } ] } ] }
  ] }
};

P["5c340546-b7ed-4cfd-805d-7abdbf465bcd"] = { // Top-Secret Subterranean Goofarium
  behavior: { abilities: [
    { id: "shield", type: "continuous", modifiers: [],
      damageModifiers: [ { selector: { conditions: [ { type: "isCard", other: "source" } ] }, sourceSelector: { conditions: [ { type: "hasKeyword", target: S("__candidate"), keyword: "covert" } ] }, delta: -999 } ] },
    { id: "brace", type: "triggered", event: "battleStarted", condition: { type: "battleRole", role: "defender" },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Detach resources", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { controller: "self", type: "resource" }, count: { type: "battlePartySize", side: "attacking" }, optional: true },
          effects: [ { type: "forEach", selected: "r", effects: [ { type: "detach", target: S("__candidate") } ] } ] } ] },
        { label: "Decline", effects: [] } ] } ] }
  ] }
};

P["1bfa9585-adaf-4228-985e-16ace4b9cecb"] = { // Unrelenting Ridicule
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character", conditions: [ { type: "hasKeyword", target: S("__candidate"), keyword: "covert" } ] }, count: 1 } ],
      effects: [ { type: "destroy", target: S("c") } ] }
  ] }
};

// ======================================================================
// BANKER
// ======================================================================

P["9540ce6d-7f45-4fd9-8f71-093a8e438d50"] = { // Anesthetizing Opulence
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "destroy", target: S("c") }, { type: "draw", player: "opponent", amount: 1 } ] }
  ] }
};

P["9ee4edbf-5c5a-4730-8e47-1208cacab083"] = { // Clandestine Resort
  behavior: { abilities: [
    { id: "aura", type: "continuous", modifiers: [ { selector: { controller: "self", type: "character" }, stat: "life", operation: "add", value: 1 } ] }
  ] }
};

P["727008d3-b9eb-4add-9e67-72ec4d1b6937"] = { // Class Action Defender
  behavior: { abilities: [
    { id: "cap", type: "continuous", modifiers: [],
      damageModifiers: [ { selector: { conditions: [ { type: "isCard", other: "source" } ] }, delta: 0, minAmount: 5, setTo: 0 } ] },
    { id: "brace", type: "triggered", event: "battleStarted", condition: { type: "battleRole", role: "defender" },
      effects: [ { type: "mayPay", player: "controller", costs: [ { type: "payResources", amount: 2 } ],
        effects: [ { type: "restore", target: "source" } ] } ] }
  ] }
};

P["b4c2aed3-d9f8-4ac6-b4a0-8b97136f20b0"] = { // Club Mau Bouncer
  behavior: { abilities: [
    { id: "retaliate", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardTypeIs", target: { type: "damageSource" }, cardType: "character" } ] },
      effects: [ { type: "dealDamage", target: { type: "damageSource" }, amount: 1 } ] }
  ] }
};

P["4c23d2e0-da0c-4cd6-9a6c-23c43f83d5d8"] = { // Crooked Appraiser
  behavior: { abilities: [
    { id: "inspect", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "loc", selector: { type: "location" }, count: 1 } ],
      effects: [ { type: "dealDamage", target: S("loc"), amount: 2 } ] }
  ] }
};

P["56c1a7f7-7146-43d5-8bd4-2bad9e9522e7"] = { // Embezzling Bookkeeper
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "draw", player: "opponent", amount: 1 } ] }
  ] }
};

const investTokenLoser = (statList, initial, investCost) => ({
  behavior: { abilities: [
    { id: "seed", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: initial } ] },
    { id: "debuff", type: "continuous", modifiers: statList.map(stat => ({ target: "source", stat, operation: "add", value: negCounter("source") })) },
    { id: "invest", type: "activated", costs: investCost, effects: [ { type: "removeCounter", target: "source", counter: "token", amount: 1 } ] }
  ] }
});
P["2eb2b684-8786-4248-8daf-ca614b8286a0"] = investTokenLoser(["strength", "life"], 2, [ { type: "payResources", amount: 2 } ]); // Entry-Level Employee

P["d81cec8e-35a3-47e2-bb47-a4144a0d36d8"] = { // Escrow Office
  behavior: { abilities: [
    { id: "deposit", type: "activated", costs: [ { type: "payResources", amount: 1 } ],
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 1 } ] },
    { id: "withdraw", type: "activated",
      variables: { x: counter("source") },
      costs: [ { type: "removeCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } } ],
      effects: [ { type: "reduceNextCost", player: "controller", amount: { type: "variable", id: "x" } } ] }
  ] }
};

P["004d96b5-d33a-4f8c-905c-c7aa61ba1756"] = { // Extortify
  behavior: { abilities: [ { id: "body", type: "activated", effects: [ { type: "modifyInfluence", player: "controller", amount: 8 } ] } ] }
};

P["57657edf-5653-4d4f-91a1-78a2542578ec"] = { // Fat Pants
  attachTo: "character",
  behavior: { abilities: [
    { id: "buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: 1 },
      { target: "attachedTo", stat: "life", operation: "add", value: 2 } ] },
    { id: "handoff", type: "activated",
      costs: [ { type: "payResources", amount: 1 }, { type: "deplete", target: S("w") } ],
      targets: [ { id: "w", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1 } ],
      effects: [ { type: "attachTo", target: "source", to: S("w") } ] }
  ] }
};

P["914713f6-1e21-4a63-bee9-aeee7a99355b"] = { // First Unified Market of Abstract Secure Theoreticals
  unique: "f.u.m.a.s.t.",
  behavior: { abilities: [
    { id: "discount", type: "continuous", modifiers: [], abilityCostModifiers: [ { scope: "factionAbilities", delta: -1, minCost: 1 } ] }
  ] }
};

P["63394a45-b039-47ad-86ff-9853ceedf6df"] = { // Furtive Investor
  behavior: { keywords: ["covert"], abilities: [
    { id: "seed", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 2 } ] },
    { id: "debuff", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: negCounter("source") },
      { target: "source", stat: "life", operation: "add", value: negCounter("source") } ] },
    { id: "sot", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "pick", selector: { controller: "self", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 1, optional: true },
        effects: [ { type: "removeCounter", target: S("pick"), counter: "token", amount: 1 } ] } ] }
  ] }
};

P["b4d02b5b-bfb5-4384-addd-ba8f738b9940"] = { // Hired Goons
  behavior: { keywords: ["covert"], abilities: [
    { id: "sot", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "mayPay", player: "controller", costs: [ { type: "payResources", amount: 2 } ], effects: [],
        elseEffects: [ { type: "takeControl", target: "source", controller: "opponent" } ] } ] }
  ] }
};

P["ce20a6a6-4cf6-4b28-96d1-8b68c1441c10"] = { // Inside Information
  behavior: { abilities: [
    { id: "profit", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      effects: [ { type: "draw", player: "controller", amount: 4 }, { type: "takeControl", target: "source", controller: "opponent" } ] }
  ] }
};

P["210c93ab-9cc2-45a8-9e8e-0aec15e38f54"] = { // Keen Stratagem
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "r", selector: { controller: "self", zone: "deck", type: "resource", staple: true }, count: 1, optional: true },
        effects: [ { type: "moveCard", target: S("r"), to: "hand" } ] },
      { type: "shuffleDeck", player: "controller" }
    ] }
  ] }
};

P["062c99df-9e9b-4667-b615-a0e936efa356"] = { // Key Man
  behavior: { abilities: [
    { id: "leave", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" } ] },
      effects: [ { type: "draw", player: "controller", amount: 1 } ] }
  ] }
};

P["2d521705-d7e3-4c99-a5a8-682dd96ac1c6"] = { // Market Oracle
  behavior: { abilities: [
    { id: "invest", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "pick", selector: { controller: "self", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } } ] }, count: 1 } ],
      effects: [ { type: "removeCounter", target: S("pick"), counter: "token", amount: 1 } ] }
  ] }
};

P["2a3fa1ac-c90a-439b-b7fa-1343702dc16f"] = { // Mau Party
  behavior: { abilities: [
    { id: "body", type: "activated", condition: { type: "isActivePlayer", player: "controller" },
      effects: [ { type: "draw", player: "controller", amount: 5 }, { type: "modifyInfluence", player: "controller", amount: 2 } ] }
  ] }
};

P["6bf1518b-c908-4a50-86d8-371d138e13d5"] = { // Moneychanger
  behavior: { abilities: [
    { id: "debuff", type: "continuous", modifiers: [
      { target: "source", stat: "strength", operation: "add", value: negCounter("source") },
      { target: "source", stat: "life", operation: "add", value: negCounter("source") } ] },
    { id: "exchange", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 1 }, { type: "draw", player: "controller", amount: 1 } ] }
  ] }
};

P["a2816b7a-7843-44e8-b9ef-0327e17ce16d"] = { // Motivational Speaker
  behavior: { abilities: [
    { id: "block", type: "triggered", event: "characterBlocked", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "forEach", selector: { type: "character", conditions: [ { type: "sharesBattlePartyWithSource", target: S("__candidate") } ] },
        effects: [ cmod(S("__candidate"), "strength", "add", 2, UEOT), cmod(S("__candidate"), "life", "add", 2, UEOT) ] } ] }
  ] }
};

P["1dc62434-5a69-44ce-acde-488436a14de8"] = { // Mutiny Grant
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "pick", selector: { controller: "opponent", type: "character" }, count: 1 } ],
      costs: [ { type: "loseInfluence", player: "controller", amount: { type: "cardCost", target: S("pick") } } ],
      effects: [
        { type: "takeControl", target: S("pick"), controller: "controller", duration: UEOT },
        { type: "restore", target: S("pick") }
      ] }
  ] }
};

P["e8b58fc9-9ab5-4476-8a49-f35db8424e8a"] = { // Officious Obstructionist
  behavior: { abilities: [
    { id: "stubborn", type: "activated", costs: [ { type: "payResources", amount: 1 } ],
      effects: [ cmod("source", "life", "add", 1, UEOT) ] }
  ] }
};

P["80039582-f99b-4d7f-9f35-96c725c9d4d9"] = { // Overinsured Figurehead
  behavior: { abilities: [
    { id: "leave", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" } ] },
      effects: [ { type: "draw", player: "controller", amount: 2 } ] }
  ] }
};

P["02c2f936-b92e-4051-badb-c9a15d0371c1"] = { // Prudent Thug
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "modifyInfluence", player: "controller", amount: -3 } ] },
    { id: "debuff", type: "continuous",
      modifiers: [
        { target: "source", stat: "strength", operation: "add", value: negCounter("source") },
        { target: "source", stat: "life", operation: "add", value: negCounter("source") } ],
      restrictions: [ { target: "source", restriction: "attackOncePerTurn" } ] },
    { id: "restore", type: "activated", costs: [ { type: "payResources", amount: 1 } ],
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 1 }, { type: "restore", target: "source" } ] }
  ] }
};

P["cb4a80c5-060f-4738-bfb6-fa94e726f169"] = { // Pugnacious Publicist
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "forEach", selector: { controller: "self", type: "character" },
        effects: [ cmod(S("__candidate"), "life", "add", 1, UEOT) ] } ] }
  ] }
};

P["61a6a464-9af8-4ffd-8519-90de271c5500"] = { // Randolph von Macovawitz Spitoon III, Ltd.
  unique: "randolph",
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "draw", player: "controller", amount: 1 } ] },
    { id: "payday", type: "activated",
      costs: [ { type: "payResources", amount: 1 }, { type: "oneOf", options: [
        [ { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand", type: "resource" }, count: 1 } ],
        [ { type: "destroy", target: S("r") } ] ] } ],
      targets: [ { id: "r", selector: { controller: "self", type: "resource" }, count: 1, optional: true } ],
      effects: [ { type: "draw", player: "controller", amount: 1 } ] }
  ] }
};

P["07fac91d-0244-4ce4-a97e-64659aa234ad"] = { // Real Estate Auctioneer
  behavior: { abilities: [
    { id: "liquidate", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "draw", player: "controller", amount: 2 } ] }
  ] }
};

P["3c2c57b8-43a8-46ef-9f6d-0e105783d92d"] = { // Reluctant Hiree
  behavior: { abilities: [
    { id: "seed", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 3 } ] },
    { id: "debuff", type: "continuous", modifiers: [ { target: "source", stat: "strength", operation: "add", value: negCounter("source") } ] },
    { id: "invest", type: "activated",
      variables: { x: counter("source") },
      costs: [ { type: "payResources", amount: { type: "variable", id: "x" } } ],
      effects: [ { type: "removeCounter", target: "source", counter: "token", amount: 1 } ] }
  ] }
};

P["a0e2b30c-c763-4182-9c34-84c3d407d60d"] = { // Revivatate
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "isActivePlayer", player: "controller" },
      targets: [ { id: "picks", selector: { controller: "self", zone: "discard", type: "character" }, count: 2 } ],
      effects: [
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "toPlay", selector: { zone: "discard", conditions: [ { type: "targetInSelection", target: S("__candidate"), selection: "picks" } ] }, count: 1 },
          effects: [ { type: "putIntoPlay", target: S("toPlay"), controller: "controller" } ] },
        { type: "forEach", selector: { owner: "self", zone: "discard", type: "character", conditions: [ { type: "targetInSelection", target: S("__candidate"), selection: "picks" } ] },
          effects: [ { type: "moveCard", target: S("__candidate"), to: "hand" } ] }
      ] }
  ] }
};

P["00255313-8ec6-4597-8cfb-f92c227061ce"] = { // Short Term Investment
  behavior: { abilities: [
    { id: "seed", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: 2 } ] },
    { id: "tick", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "removeCounter", target: "source", counter: "token", amount: 1 } ] },
    { id: "return", type: "activated",
      condition: { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 0 },
      costs: [ { type: "destroy", target: "source" } ],
      effects: [ { type: "draw", player: "controller", amount: 3 } ] }
  ] }
};

P["338fa9ec-5021-4909-bfe3-0d71fcbebd3e"] = { // Smear Campaign
  attachTo: "character",
  behavior: { abilities: [
    { id: "grant", type: "continuous", modifiers: [], grantedAbilities: [
      { selector: { type: "character", conditions: [ { type: "isCard", other: "attachedTo" } ] },
        abilities: [ { id: "smear", type: "triggered", event: "damageDealt", condition: { type: "sourceIsDamageSource" },
          effects: [ { type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: { type: "eventDamageAmount" } } ] } ] } ] }
  ] }
};

P["72439f0b-d9fe-4ea9-b701-e2f535669484"] = { // Snooty Doorman
  behavior: { abilities: [
    { id: "denied", type: "activated",
      condition: { type: "respondingTo", respondsTo: "card", cardType: "character" },
      costs: [ { type: "destroy", target: "source" } ],
      effects: [ { type: "terminate", target: { type: "respondedToCard" } } ] }
  ] }
};

P["8fbf09c1-9f8e-4c2e-8695-fd6f95a4fa8a"] = { // Subsection 5, Paragraph 12
  behavior: { noResponse: true, abilities: [
    { id: "body", type: "activated",
      condition: { type: "and", conditions: [
        { type: "respondingTo", respondsTo: "ability" },
        { type: "not", condition: { type: "cardTypeIs", target: { type: "respondedAbilitySource" }, cardType: "faction" } } ] },
      effects: [
        { type: "terminate", scope: "respondedItem" },
        { type: "lockAbilityThisTurn", target: "respondedAbility" },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

P["6ff3de61-5058-4ff5-91fd-a44cf03d1a0e"] = { // Tad Disingenuous
  behavior: { abilities: [
    { id: "deal", type: "activated",
      costs: [ { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 } ],
      effects: [ { type: "grantKeyword", target: "source", keyword: "covert", duration: UEOT } ] }
  ] }
};

P["4fcedeb9-466a-4f77-b3a0-6808cc8e9d31"] = { // The Garbageman
  behavior: { abilities: [
    { id: "once", type: "continuous", modifiers: [], restrictions: [ { target: "source", restriction: "attackOncePerTurn" } ] },
    { id: "sift", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      effects: [
        { type: "draw", player: "controller", amount: 1 },
        { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "d", selector: { owner: "self", zone: "hand" }, count: 1 },
          effects: [ { type: "moveCard", target: S("d"), to: "discard" } ] }
      ] },
    { id: "rummage", type: "activated",
      targets: [ { id: "rfg", selector: { owner: "self", zone: "discard" }, count: 3 } ],
      costs: [ { type: "payResources", amount: 2 }, { type: "sacrificeSelected", declarationId: "rfg", disposition: "removeFromGame" } ],
      effects: [ { type: "restore", target: "source" } ] }
  ] }
};

P["9c1910b5-891f-4b4c-944d-45499fb00e50"] = { // Writ of Reclamation
  behavior: { abilities: [
    { id: "body", type: "activated",
      variables: { x: { type: "variable", id: "x" } },
      variableBounds: { x: { min: 0, max: 3 } },
      targets: [
        { id: "rfg", selector: { controller: "self", zone: "discard" }, count: { type: "variable", id: "x" } },
        { id: "others", selector: { controller: "self", zone: "discard", conditions: [ { type: "not", condition: { type: "targetInSelection", target: S("__candidate"), selection: "rfg" } } ] }, count: { type: "variable", id: "x" } } ],
      costs: [ { type: "sacrificeSelected", declarationId: "rfg", disposition: "removeFromGame" } ],
      effects: [
        { type: "forEach", selected: "others", effects: [ { type: "moveCard", target: S("__candidate"), to: "deck" } ] },
        { type: "shuffleDeck", player: "controller" },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

// ======================================================================
// ROGUE
// ======================================================================

P["71886432-9edb-44a6-b9aa-7890b3267cf3"] = { // Auction House
  behavior: { abilities: [
    { id: "auction", type: "triggered", event: "turnStarted",
      effects: [ { type: "auctionForCard", revealFor: "activePlayer" } ] }
  ] }
};

P["0af6286e-db1d-44c2-9e23-38ccc3f558e9"] = { // Cheats McGuillicutty
  unique: "pluck",
  behavior: { abilities: [
    { id: "bottomdeal", type: "activated", costs: [ { type: "payResources", amount: 1 } ],
      effects: [ { type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, to: "deck", position: "bottom" } ] },
    { id: "cheat", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      effects: [ { type: "deployFromZone", player: "controller", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, free: false } ] },
    { id: "costume", type: "activated",
      costs: [ { type: "payResources", amount: 3 }, { type: "moveSelected", id: "self", player: "controller", selector: { controller: "self", name: "Cheats McGuillicutty", zone: "play" }, count: 1, to: "deck", shuffle: true } ],
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "p", selector: { controller: "self", zone: "deck", subtype: "pluck", conditions: [ { type: "not", condition: { type: "cardNameEquals", target: S("__candidate"), other: "source" } } ] }, count: 1, optional: true },
        effects: [ { type: "putIntoPlay", target: S("p"), controller: "controller" } ] } ] }
  ] }
};

const cannotBlockWhileOppHasItem = { id: "unblock", type: "continuous", modifiers: [],
  condition: { type: "numberCompare", left: { type: "count", selector: { controller: "opponent", type: "item" } }, operator: ">=", right: 1 },
  keywords: [ { target: "source", keyword: "cannotBeBlocked" } ] };

P["cc55231b-da46-435a-95ef-d26fc8de31c0"] = { // Clockman Pickpocket
  behavior: { abilities: [
    cannotBlockWhileOppHasItem,
    { id: "steal", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" } ] },
      effects: [ { type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "it", selector: { controller: "opponent", type: "item" }, count: 1, optional: true },
        effects: [
          { type: "takeControl", target: S("it"), controller: "controller" },
          { type: "destroy", target: "source" }
        ] } ] }
  ] }
};

P["65bd9386-5d61-415a-be45-5d50b5b369a5"] = { // Counter Attack
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "and", conditions: [
        { type: "not", condition: { type: "isActivePlayer", player: "controller" } },
        { type: "not", condition: { type: "battleActive" } } ] },
      targets: [ { id: "atk", selector: { controller: "self", type: "character" }, count: 9, optional: true } ],
      effects: [
        { type: "initiateAttack", attackerSelection: "atk", target: "activePlayer" },
        { type: "draw", player: "controller", amount: 1 }
      ] }
  ] }
};

P["46d4519b-b2ff-4306-9489-9ce28ecc3a5b"] = { // Cute Cutpurse
  behavior: { abilities: [
    cannotBlockWhileOppHasItem,
    { id: "smash", type: "triggered", event: "damageDealt",
      condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" } ] },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "it", selector: { controller: "opponent", type: "item" }, count: 1, optional: true },
        effects: [ { type: "destroy", target: S("it") } ] } ] }
  ] }
};

P["bc40724d-186f-4cf2-88da-ca8b8e648865"] = { // Early Retirement
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "pick", selector: { controller: "self", type: "character" }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "stat", target: S("pick"), stat: "strength" } },
        { type: "destroy", target: S("pick") },
        { type: "draw", player: "controller", amount: { type: "variable", id: "x" } }
      ] }
  ] }
};

P["613f3fc5-6ef5-49e9-aec2-2c69cd9ffcdd"] = { // Epic Turncoat Maneuver
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [
        { id: "sac", selector: { controller: "self", type: "character" }, count: 2 },
        { id: "picks", selector: { type: "character" }, count: 4, optional: true } ],
      costs: [ { type: "sacrificeSelected", declarationId: "sac", disposition: "destroy" } ],
      effects: [ { type: "forEach", selected: "picks", effects: [ { type: "takeControl", target: S("__candidate"), controller: "controller" } ] } ] }
  ] }
};

P["d2ef3385-bff6-42cf-8045-e5568e59efdf"] = { // Fool's Gold
  behavior: { abilities: [
    { id: "trade", type: "activated",
      targets: [ { id: "pick", selector: { controller: "opponent", type: "item" }, count: 1 } ],
      costs: [ { type: "payResources", amount: { type: "cardCost", target: S("pick") } }, { type: "destroy", target: "source" } ],
      effects: [ { type: "takeControl", target: S("pick"), controller: "controller" } ] }
  ] }
};

P["a1716f04-f2d4-454f-917f-0b55eb9fbb73"] = { // Forcible Depredator
  behavior: { abilities: [
    { id: "plunder", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "mill", player: "opponent", count: 3, to: "discard" } ] }
  ] }
};

P["e3d4cdea-9072-43f9-945d-e651067608d2"] = { // Fwing!
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "pick", selector: { type: "character" }, count: 1 } ],
      effects: [
        cmod(S("pick"), "speed", "add", 1, UEOT),
        { type: "flipCoin", winEffects: [ cmod(S("pick"), "strength", "add", 1, UEOT) ], loseEffects: [] }
      ] }
  ] }
};

P["7c184d94-6d66-4d27-947d-87e6bb03d997"] = { // Gang Leader
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "forEach", selector: { controller: "self", type: "character" },
        effects: [ cmod(S("__candidate"), "speed", "add", 1, UEOT) ] } ] }
  ] }
};

P["9fb327c0-257b-4685-98ca-de282c1dc6d7"] = { // Hollow Moose
  behavior: { abilities: [
    { id: "flip", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "takeControl", target: "source", controller: "opponent" } ] },
    { id: "drain", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "modifyInfluence", player: "controller", amount: -1 } ] },
    { id: "infiltrate", type: "activated",
      targets: [ { id: "sac", selector: { controller: "self", conditions: [
        { type: "or", conditions: [ { type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "item" } ] },
        { type: "not", condition: { type: "isCard", other: "source" } } ] }, count: 1 } ],
      costs: [ { type: "destroy", target: S("sac") } ],
      effects: [ { type: "takeControl", target: "source", controller: "opponent" } ] }
  ] }
};

P["fb4fb0b3-e4ee-42f9-9a28-b184729fce40"] = { // Hulking Vigilante
  behavior: { abilities: [
    { id: "loner", type: "triggered", event: "cardEnteredPlay",
      effects: [ { type: "if", condition: { type: "numberCompare", left: { type: "count", selector: { owner: "self", controller: "self", type: "character" } }, operator: ">=", right: 2 },
        effects: [ { type: "destroy", target: "source" } ] } ] }
  ] }
};

P["5d4a643f-9f1a-4d2c-815b-0c720598045f"] = { // Impeccable Timing
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "pick", selector: { type: "character", depleted: true }, count: 1 } ],
      effects: [ { type: "if", condition: { type: "statCompare", target: S("pick"), stat: "life", operator: "<=", value: 4 },
        effects: [ { type: "destroy", target: S("pick") } ] } ] }
  ] }
};

P["e987b8e3-7218-4978-bf82-1fe8fc39627c"] = { // Late Addition
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "deployForFree", player: "controller", free: false, maxCost: 999, selector: { type: "character" } },
      { type: "draw", player: "controller", amount: 1 }
    ] }
  ] }
};

const cannotBePicked = { behavior: { abilities: [
  { id: "elusive", type: "continuous", modifiers: [], restrictions: [ { target: "source", restriction: "cannotBePicked" } ] }
] } };
P["b2ceefd9-cf5e-459b-adba-6c0f3a806c58"] = cannotBePicked; // Martial Artist
P["3142de68-bfda-45ce-b3a6-c1b085f51664"] = cannotBePicked; // Martial Arts Trainee

P["9a90a89c-c3ef-4c6c-b185-b34813a75b54"] = { // Martial Arts Master
  behavior: { abilities: [
    { id: "flow", type: "continuous",
      condition: { type: "and", conditions: [
        { type: "inBattle", target: "source" },
        { type: "numberCompare", left: { type: "count", selector: { type: "character", conditions: [ { type: "inBattle", target: S("__candidate") }, { type: "not", condition: { type: "sharesBattlePartyWithSource", target: S("__candidate") } } ] } }, operator: ">=", right: 1 } ] },
      modifiers: [ { target: "source", stat: "strength", operation: "add", value: { type: "add", values: [
        { type: "stat", target: "source", stat: "speed" },
        { type: "multiply", values: [ { type: "extremumStat", selector: { type: "character", conditions: [ { type: "inBattle", target: S("__candidate") }, { type: "not", condition: { type: "sharesBattlePartyWithSource", target: S("__candidate") } } ] }, stat: "speed", direction: "max" }, -1 ] } ] } } ] }
  ] }
};

P["bfe0fbb0-079e-4f9a-ada8-b0d18e2be880"] = { // Master Thief
  behavior: { abilities: [
    { id: "heist", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "pick", selector: { owner: "opponent", zone: "discard", conditions: [ { type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "tactic" } } ] }, count: 1, optional: true },
        effects: [ { type: "putIntoPlay", target: S("pick"), controller: "controller" } ] } ] }
  ] }
};

P["fd6ca900-19ab-4786-b4db-7e3c7dbac204"] = { // Mendacious Brigand
  behavior: { abilities: [
    { id: "swap", type: "triggered", event: "attackerBlocked", condition: { type: "sourceIsEventCard" },
      targets: [
        { id: "blk", selector: { type: "character", conditions: [ { type: "inBattle", target: S("__candidate"), role: "blocker" } ] }, count: 1, optional: true },
        { id: "add", selector: { controller: "opponent", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1, optional: true } ],
      effects: [ { type: "if", condition: { type: "and", conditions: [ { type: "targetExists", target: S("blk") }, { type: "targetExists", target: S("add") } ] },
        effects: [
          { type: "removeFromBattle", target: S("blk") },
          { type: "addToBattle", target: S("add"), side: "blocking" }
        ] } ] }
  ] }
};

P["837d5a93-213d-4e5d-af65-0a6c14c55c7c"] = { // Mercenary's Creed
  attachTo: "character",
  behavior: { abilities: [
    { id: "bribe", type: "activated", usableBy: "anyPlayer",
      costs: [ { type: "payResources", amount: 3 } ],
      effects: [ { type: "takeControl", target: "attachedTo", controller: "controller" } ] },
    { id: "blackmail", type: "activated",
      costs: [ { type: "payResources", amount: 2 } ],
      effects: [ { type: "takeControl", target: "attachedTo", controller: "controller" } ] }
  ] }
};

P["5afd2312-a6aa-4aca-bc1e-2fb4eb78183d"] = { // Misappropriation Machine
  behavior: { abilities: [
    { id: "steal", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "pick", selector: { owner: "opponent", zone: "discard", conditions: [
        { type: "or", conditions: [ { type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "item" } ] } ] }, count: 1 } ],
      effects: [
        { type: "putIntoPlay", target: S("pick"), controller: "controller" },
        { type: "takeControl", target: "source", controller: { type: "ownerOf", target: S("pick") } }
      ] }
  ] }
};

P["92083650-6785-4b9a-ba1c-542a348b22aa"] = { // Orgy Den Smoke Out
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "pool", selector: { owner: "opponent", zone: "hand" }, count: { type: "count", selector: { owner: "opponent", zone: "hand" } }, optional: true } ],
      effects: [
        { type: "randomFromSelection", selected: "pool", count: 1, effects: [ { type: "moveCard", target: S("__candidate"), to: "discard" } ] },
        { type: "mill", player: "opponent", count: 2, to: "discard" }
      ] }
  ] }
};

P["239caecc-f9ed-4cf3-bcd1-aed627b6bbab"] = { // Poisoned Blade
  attachTo: "character",
  behavior: { abilities: [
    { id: "grant", type: "continuous", modifiers: [], grantedAbilities: [
      { selector: { type: "character", conditions: [ { type: "isCard", other: "attachedTo" } ] },
        abilities: [ { id: "poison", type: "triggered", event: "damageDealt",
          condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "character" } ] },
          effects: [ { type: "destroy", target: "eventCard" } ] } ] } ] },
    { id: "handoff", type: "activated",
      costs: [ { type: "deplete", target: S("w") } ],
      targets: [ { id: "w", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1 } ],
      effects: [ { type: "attachTo", target: "source", to: S("w") } ] }
  ] }
};

P["bad0a682-9807-466b-8d9b-3ac48a34cdb2"] = { // Recreant Cad
  behavior: { abilities: [
    { id: "sneak", type: "activated",
      condition: { type: "numberCompare", left: { type: "count", selector: { owner: "opponent", zone: "discard" } }, operator: ">=", right: 10 },
      targets: [ { id: "rfg", selector: { owner: "opponent", zone: "discard" }, count: 2 } ],
      costs: [ { type: "payResources", amount: 1 }, { type: "sacrificeSelected", declarationId: "rfg", disposition: "removeFromGame" } ],
      effects: [ { type: "grantKeyword", target: "source", keyword: "covert", duration: UEOT } ] }
  ] }
};

P["7710da84-2994-4019-957f-0fc998917104"] = { // Throatstabber
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "flipCoin", winEffects: [], loseEffects: [ { type: "deplete", target: "source" } ] } ] }
  ] }
};

P["f4244678-8524-446d-8c1c-65f126c9df4a"] = { // Two-Headed Coin
  behavior: { abilities: [
    { id: "reflip", type: "replacement", replaces: { event: "coinFlip", result: "lose" }, optional: true,
      optionalCost: [ { type: "moveSelected", id: "self", player: "controller", selector: { controller: "self", name: "Two-Headed Coin", zone: "play" }, count: 1, to: "deck", shuffle: true } ],
      effects: [ { type: "draw", player: "controller", amount: 1 } ] }
  ] }
};

P["19cf503e-f872-4199-beef-e832d1ee833c"] = { // Unexpected Boobysnake
  behavior: { keywords: ["tactical"], abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "not", condition: { type: "isActivePlayer", player: "controller" } } ] },
      effects: [ { type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Discard a card", effects: [ { type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "d", selector: { owner: "self", zone: "hand" }, count: 1 },
          effects: [ { type: "moveCard", target: S("d"), to: "discard" } ] } ] },
        { label: "Destroy this card", effects: [ { type: "destroy", target: "source" } ] } ] } ] }
  ] }
};

P["03dfc9f9-28cf-451f-a141-ace62ab3f1be"] = { // Wild Boars
  behavior: { abilities: [
    { id: "swift", type: "continuous", modifiers: [],
      condition: { type: "and", conditions: [
        { type: "inBattle", target: "source", role: "attacker" },
        { type: "numberCompare", left: { type: "battlePartySize", side: "ownParty", of: "source" }, operator: "=", right: 1 } ] },
      blockRestriction: { minBlockerSpeed: { type: "stat", target: "source", stat: "speed" } } }
  ] }
};

// ======================================================================
// WARLORD
// ======================================================================

P["5ceba10d-9cdd-4abd-9de9-13cc1cbbbe5a"] = { // Anxious Oaf
  behavior: { abilities: [
    { id: "pack", type: "continuous", modifiers: [], partyRestriction: { role: "any", minMembers: 2 } }
  ] }
};

P["b0760e4d-f149-4fc6-a698-8e405e825036"] = { // Assimilation Center
  behavior: { abilities: [
    { id: "recruit", type: "activated",
      costs: [ { type: "payResources", amount: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "c", selector: { owner: "self", zone: "deck", type: "character" }, count: 1, optional: true },
        effects: [
          { type: "shuffleDeck", player: "controller" },
          { type: "moveCard", target: S("c"), to: "deck", position: "top" }
        ] } ] }
  ] }
};

P["ad4fc0ee-cc07-4927-93ab-c1daeb97798c"] = { // Barbaric Rifleman
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 } ] }
  ] }
};

P["1a6c1f62-30b3-46cb-a83f-4c6fc0cdc9f0"] = { // Battle Surge
  behavior: { abilities: [
    { id: "body", type: "activated", effects: [
      { type: "forEach", selector: { controller: "self", type: "character" }, effects: [ cmod(S("__candidate"), "strength", "add", 1, UEOT) ] }
    ] }
  ] }
};

P["efa9c2c1-5448-4733-a6c4-471f7d625c02"] = { // Blow Up
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "it", selector: { type: "item" }, count: 1 } ],
      effects: [
        { type: "destroy", target: S("it") },
        { type: "modifyInfluence", player: { type: "controllerOf", target: S("it") }, amount: -3 }
      ] }
  ] }
};

P["4cd88c6e-b5be-4383-952a-a3a7944aff55"] = { // Callow Liegeman
  behavior: { abilities: [
    { id: "rally", type: "triggered", event: "characterAttacked",
      condition: { type: "and", conditions: [ { type: "sourceIsEventCard" }, { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">", right: 1 } ] },
      effects: [ cmod("source", "strength", "add", 1, UEOT), cmod("source", "life", "add", 1, UEOT) ] }
  ] }
};

P["46d213bf-f9f2-4e68-93c5-07e004b72e50"] = { // Deadly Striker
  behavior: { abilities: [
    { id: "spite", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "modifyInfluence", player: "opponent", amount: -4 } ] }
  ] }
};

P["43a51ff8-16f5-4752-aa41-94d0977d219d"] = { // Dethmürderblüdgeon, the Craghammer
  unique: "dethmürderblüdgeon", attachTo: "character",
  behavior: { abilities: [
    { id: "buff", type: "continuous", modifiers: [
      { target: "attachedTo", stat: "strength", operation: "add", value: 2 },
      { target: "attachedTo", stat: "life", operation: "add", value: 2 } ] },
    { id: "blocked", type: "triggered", event: "attackerBlocked", condition: { type: "eventCardIs", target: "attachedTo" },
      effects: [ { type: "modifyInfluence", player: "opponent", amount: -2 } ] },
    { id: "grant", type: "continuous", modifiers: [], grantedAbilities: [
      { selector: { type: "character", conditions: [ { type: "isCard", other: "attachedTo" } ] },
        abilities: [ { id: "bludgeon", type: "triggered", event: "damageDealt",
          condition: { type: "and", conditions: [ { type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" } ] },
          targets: [ { id: "c", selector: { type: "character" }, count: 1, optional: true } ],
          effects: [ { type: "if", condition: { type: "targetExists", target: S("c") }, effects: [ { type: "dealDamage", target: S("c"), amount: 2 } ] } ] } ] } ] },
    { id: "recur", type: "replacement", replaces: { event: "moveToZone", zone: "discard" },
      condition: { type: "sourceInZone", zone: "play" },
      effects: [ { type: "moveCard", target: "source", to: "hand" } ] }
  ] }
};

P["61c0d007-ee61-41da-9b15-8fdd7c15720e"] = { // Distraction
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "deplete", target: S("c") } ] }
  ] }
};

P["1c35f70e-ae5e-44b0-ac2b-8c0f52b00f4a"] = { // Elbow Dropper
  behavior: { abilities: [
    { id: "offtop", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "grantRestriction", target: S("c"), restriction: "cannotBlock", duration: UEOT } ] }
  ] }
};

P["408d18d4-f420-4222-8fcb-4d08f499f6fc"] = { // Explosive Fury
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [
        { id: "sac", selector: { controller: "self", type: "character" }, count: 1 },
        { id: "victim", selector: { type: "character" }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "stat", target: S("sac"), stat: "strength" } },
        { type: "destroy", target: S("sac") },
        { type: "dealDamage", target: S("victim"), amount: { type: "variable", id: "x" } }
      ] }
  ] }
};

P["c8037ec2-03ca-464f-83d1-a00f45db5873"] = { // Fleshripping Scenepuller
  behavior: { abilities: [
    { id: "rage", type: "triggered", event: "attackerBlocked", condition: { type: "sourceIsEventCard" },
      effects: [ cmod("source", "strength", "add", { type: "multiply", values: [ 4, { type: "battlePartySize", side: "opposingParty", of: "source" } ] }, UEOT) ] }
  ] }
};

P["45ce54bf-af20-4972-83e5-62985455e308"] = { // Gore Engine
  behavior: { abilities: [
    { id: "feed", type: "triggered", event: "cardDestroyed",
      condition: { type: "damagedThisTurn", target: "eventCard", by: "source" },
      effects: [ { type: "addCounter", target: "source", counter: "token", amount: { type: "printedStat", target: "eventCard", stat: "strength" } } ] },
    { id: "grow", type: "continuous", modifiers: [ { target: "source", stat: "strength", operation: "add", value: counter("source") } ] },
    { id: "impale", type: "activated",
      costs: [ { type: "oneOf", options: [ [ { type: "payResources", amount: 2 } ], [ { type: "removeCounter", target: "source", counter: "token", amount: 2 } ] ] } ],
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "grantRestriction", target: S("c"), restriction: "mustBlock", duration: UEOT } ] }
  ] }
};

P["914fa597-fa3b-4b90-8368-2754eafbb3f7"] = { // Infuriator
  behavior: { abilities: [
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "forEach", selector: { controller: "self", type: "character" },
        effects: [ cmod(S("__candidate"), "strength", "add", 1, UEOT) ] } ] }
  ] }
};

P["8b093762-8619-4a8a-b990-80b11f352c1f"] = { // Lieutenant General
  behavior: { abilities: [
    { id: "order", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "forEach", selector: { type: "character", subtype: "soldier", conditions: [
        { type: "sharesBattlePartyWithSource", target: S("__candidate") },
        { type: "not", condition: { type: "isCard", other: "source" } } ] },
        effects: [ cmod(S("__candidate"), "life", "add", 1, UEOT) ] } ] }
  ] }
};

P["bac1cee2-b00b-40f5-80d4-3aee69dc1726"] = { // Morale Officer
  behavior: { abilities: [
    { id: "convince", type: "activated", costs: [ { type: "deplete", target: "source" } ],
      effects: [ { type: "forEach", selector: { controller: "self", type: "character", subtype: "soldier" },
        effects: [ cmod(S("__candidate"), "strength", "add", 1, UEOT) ] } ] }
  ] }
};

P["84515285-34dc-4b75-95d4-51a6c072b970"] = { // Murderous Commander
  behavior: { abilities: [
    { id: "plan", type: "activated",
      costs: [ { type: "payResources", amount: 2 }, { type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }, { type: "deplete", target: "source" } ],
      effects: [ { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 } ] }
  ] }
};

P["3ea9bbe2-4b32-4f04-9e2c-7a1201b655b9"] = { // Needless Beating
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { controller: "opponent", type: "character" }, count: 1 } ],
      effects: [
        { type: "dealDamage", target: S("c"), amount: 2 },
        { type: "if", condition: { type: "statCompare", target: { type: "factionOf", player: "opponent" }, stat: "influence", operator: "<=", value: 15 },
          effects: [ { type: "dealDamage", target: S("c"), amount: 1 } ] },
        { type: "if", condition: { type: "statCompare", target: { type: "factionOf", player: "opponent" }, stat: "influence", operator: "<=", value: 10 },
          effects: [ { type: "forEach", selector: { controller: "opponent", type: "character" }, effects: [ { type: "dealDamage", target: S("__candidate"), amount: 1 } ] } ] },
        { type: "if", condition: { type: "statCompare", target: { type: "factionOf", player: "opponent" }, stat: "influence", operator: "<=", value: 5 },
          effects: [ { type: "draw", player: "controller", amount: 1 } ] }
      ] }
  ] }
};

P["cbe794c6-519d-4454-a695-004fb18232b1"] = { // Penetrate
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "atk", selector: { controller: "self", type: "character", conditions: [ { type: "inBattle", target: S("__candidate"), role: "attacker" } ] }, count: 1 } ],
      effects: [ { type: "grantKeyword", target: S("atk"), keyword: "redirectDamage", duration: UEOT } ] }
  ] }
};

P["d96fbfac-9ca9-484b-9e05-59a435d4a2bb"] = { // Pinch
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "dealDamage", target: S("c"), amount: 1 } ] }
  ] }
};

P["7f0cfd7d-c9a5-48ff-bafa-a5781a91b5bf"] = { // Really Big Barduse
  behavior: { onPlay: {
    targets: [ { id: "picks", selector: { type: "character" }, count: 2, optional: true } ],
    effects: [ { type: "if", condition: { type: "targetExists", target: S("picks") },
      effects: [ { type: "distributeAmong", chooser: "controller", selected: "picks", amount: 5,
        effects: [ { type: "dealDamage", target: S("__candidate"), amount: { type: "variable", id: "__amount" } } ] } ] } ]
  } }
};

P["5610a488-daad-4dd0-b7e0-b0860be16e8c"] = { // Ruthless Platoon
  behavior: { abilities: [
    { id: "cannibalize", type: "activated",
      targets: [ { id: "sac", selector: { controller: "self", type: "character" }, count: 1 } ],
      costs: [ { type: "destroy", target: S("sac") } ],
      effects: [ cmod("source", "strength", "add", 2, UEOT) ] }
  ] }
};

P["9bb9052b-c497-4c4c-a22e-e0c2f0edf534"] = { // Sadistic Colonel
  behavior: { abilities: [
    { id: "punish", type: "triggered", event: "cardPlayed",
      condition: { type: "and", conditions: [ { type: "eventPlayerIs", player: "opponent" }, { type: "cardTypeIs", target: "eventCard", cardType: "tactic" } ] },
      effects: [ { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 } ] }
  ] }
};

P["421c7d4c-d711-4a05-9955-d3834655f5fa"] = { // Skin Suit
  behavior: { abilities: [
    { id: "body", type: "activated",
      targets: [
        { id: "mine", selector: { controller: "self", type: "character" }, count: 1 },
        { id: "theirs", selector: { controller: "opponent", type: "character" }, count: 1 } ],
      effects: [
        { type: "bind", id: "x", value: { type: "stat", target: S("mine"), stat: "strength" } },
        { type: "bind", id: "y", value: { type: "stat", target: S("theirs"), stat: "strength" } },
        { type: "dealDamage", target: S("theirs"), amount: { type: "variable", id: "x" } },
        { type: "dealDamage", target: S("mine"), amount: { type: "variable", id: "y" } },
        { type: "if", condition: { type: "and", conditions: [ { type: "targetInZone", target: S("mine"), zone: "discard" }, { type: "not", condition: { type: "targetInZone", target: S("theirs"), zone: "discard" } } ] },
          effects: [ { type: "removeFromGame", target: S("mine") }, { type: "grantAbilitiesFrom", target: S("theirs"), from: S("mine") } ] },
        { type: "if", condition: { type: "and", conditions: [ { type: "targetInZone", target: S("theirs"), zone: "discard" }, { type: "not", condition: { type: "targetInZone", target: S("mine"), zone: "discard" } } ] },
          effects: [ { type: "removeFromGame", target: S("theirs") }, { type: "grantAbilitiesFrom", target: S("mine"), from: S("theirs") } ] }
      ] }
  ] }
};

P["69c99fee-c4fd-45ff-9d04-da0cc01ecd54"] = { // Splattergun
  behavior: { abilities: [
    { id: "unload", type: "activated",
      costs: [ { type: "deplete", target: "source" } ],
      targets: [ { id: "tgt", selector: { conditions: [
        { type: "or", conditions: [ { type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "faction" } ] } ] }, count: 1 } ],
      effects: [
        { type: "dealDamage", target: S("tgt"), amount: 3 },
        { type: "takeControl", target: "source", controller: { type: "controllerOf", target: S("tgt") } }
      ] }
  ] }
};

P["dbbaecf5-23e2-4c78-b0de-ae8c856e8d0b"] = { // Suicide Squad
  behavior: { abilities: [
    { id: "sacrifice", type: "activated",
      variables: { x: { type: "stat", target: "source", stat: "strength" } },
      costs: [ { type: "destroy", target: "source" } ],
      targets: [ { id: "c", selector: { type: "character" }, count: 1 } ],
      effects: [ { type: "dealDamage", target: S("c"), amount: { type: "variable", id: "x" } } ] }
  ] }
};

P["9fec08e2-6f2f-40ba-876d-6f5aacd32806"] = { // Swordchucks
  attachTo: "character",
  behavior: { abilities: [
    { id: "buff", type: "continuous", modifiers: [ { target: "attachedTo", stat: "strength", operation: "add", value: 4 } ] },
    { id: "brittle", type: "continuous", modifiers: [],
      damageModifiers: [ { selector: { conditions: [ { type: "isCard", other: "attachedTo" } ] }, delta: 2 } ] },
    { id: "handoff", type: "activated",
      costs: [ { type: "payResources", amount: 3 }, { type: "deplete", target: S("w") } ],
      targets: [ { id: "w", selector: { controller: "self", type: "character", conditions: [ { type: "not", condition: { type: "inBattle", target: S("__candidate") } } ] }, count: 1 } ],
      effects: [ { type: "attachTo", target: "source", to: S("w") } ] }
  ] }
};

P["a297d28b-8f81-411b-8d1f-6d39f467952d"] = { // Thundering Nilpha
  behavior: { abilities: [
    { id: "siege", type: "continuous",
      condition: { type: "and", conditions: [ { type: "inBattle", target: "source", role: "attacker" }, { type: "battleTargetIs", cardType: "location" } ] },
      modifiers: [ { target: "source", stat: "strength", operation: "add", value: 1 } ],
      keywords: [ { target: "source", keyword: "cannotBeBlocked" } ] }
  ] }
};

P["5d437e57-b35a-4881-a2ed-c02eefe1a57d"] = { // Torrential Bleeder
  behavior: { abilities: [
    { id: "bleed", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [ { type: "forEach", selector: { type: "character" }, effects: [ { type: "dealDamage", target: S("__candidate"), amount: 1 } ] } ] }
  ] }
};

P["ebf61cdf-35d0-4bf7-9a54-e4927bfa3247"] = { // Trip Wire
  behavior: { abilities: [
    { id: "body", type: "activated",
      condition: { type: "battleRole", role: "defender" },
      targets: [ { id: "atk", selector: { type: "character", conditions: [ { type: "inBattle", target: S("__candidate"), role: "attacker" } ] }, count: { type: "battlePartySize", side: "attacking" } } ],
      effects: [ { type: "distributeAmong", chooser: "controller", selected: "atk", amount: 3,
        effects: [ { type: "dealDamage", target: S("__candidate"), amount: { type: "variable", id: "__amount" } } ] } ] }
  ] }
};

P["33e392bd-4d5d-475c-9cfe-a5dac86bfd2f"] = { // Trophy Collector
  behavior: { onPlay: {
    condition: { type: "statCompare", target: { type: "factionOf", player: "opponent" }, stat: "influence", operator: "<=", value: 10 }
  } }
};

P["b5fbadf6-df3d-42bd-b55a-daaa1321b076"] = { // Wyrmfang Deathskull
  unique: "wyrmfang",
  behavior: { abilities: [
    { id: "dictate", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
      effects: [ { type: "restrictBlockersToChosen", chooser: "opponent",
        declaration: { id: "blk", selector: { controller: "self", type: "character" }, count: 99, optional: true } } ] }
  ] }
};

// ======================================================================
// apply
// ======================================================================
let n = 0;
for (const [id, patch] of Object.entries(P)) {
  const card = byId.get(id);
  if (!card) throw new Error("no card for id " + id);
  if (patch.behavior) card.behavior = patch.behavior;
  if (patch.unique !== undefined) card.unique = patch.unique;
  if (patch.attachTo !== undefined) card.attachTo = patch.attachTo;
  n++;
}
fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
console.log("patched " + n + " cards");
