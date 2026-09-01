#!/usr/bin/env node
/* Author `behavior` / `flipUp` / `unique` / `attachTo` / `thresholdSlack`
 * onto the 159 classified Ungodly Mess cards in data/cards.json.
 * Re-runnable. Writes JSON.stringify(_, null, 2) + "\n". Run `npm run sync-cards` after.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const byId = new Map(cards.map(c => [c.id, c]));

// ---- shorthand ------------------------------------------------------------
const S = id => ({ type: "selected", id });
const UEOT = { type: "untilEndOfTurn" };
const PERM = { type: "permanent" };
const WSIP = { type: "whileSourceInPlay" };
const USNT = { type: "untilStartOfNextTurn" };
const cmod = (target, stat, operation, value, duration = UEOT) => ({ type: "createModifier", target, stat, operation, value, duration });
const cnt = (target, counter = "token") => ({ type: "counter", target, counter });
const negCnt = (target, counter = "token") => ({ type: "multiply", values: [cnt(target, counter), -1] });
const iconGate = (icon, n, player = "controller") => ({ type: "numberCompare", left: { type: "resourceIcons", player, icon }, operator: ">=", right: n });
const dmg = (target, amount) => ({ type: "dealDamage", target, amount });
const draw = (amount = 1, player = "controller") => ({ type: "draw", player, amount });
const infl = (amount, player = "controller") => ({ type: "modifyInfluence", player, amount });
const pick = (id, selector, count = 1, extra = {}) => ({ id, selector, count, ...extra });
const grantKw = (target, keyword, duration = UEOT) => ({ type: "grantKeyword", target, keyword, duration });
const grantRes = (target, restriction, duration = PERM) => ({ type: "grantRestriction", target, restriction, duration });
// RECUR: [icons] — activate from discard, pay N, remove self from game, [+picks], effects
const recur = (threshold, pay, effects, targets) => ({
  id: "recur", type: "activated", activationZone: "discard", threshold,
  costs: [{ type: "payResources", amount: pay }, { type: "removeFromGame", target: "source" }],
  ...(targets ? { targets } : {}), effects
});
const searchToHand = (selector, opt = true) => ({
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "__s", selector: { zone: "deck", owner: "self", ...selector }, count: 1, optional: opt },
  effects: [{ type: "forEach", selected: "__s", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }, { type: "shuffleDeck", player: "controller" }]
});

const P = {}; // id -> { behavior?, flipUp?, unique?, attachTo?, thresholdSlack? }

// FEALTY shared block ------------------------------------------------------
const FEALTY = {
  amount: 3,
  condition: {
    type: "numberCompare",
    left: { type: "distinctCount", by: "trade", selector: { controller: "self", staple: true, type: "resource" } },
    operator: ">=", right: 4
  }
};

// ============================ CHARACTERS ============================

// 1,2 Abram Ka-darbo Alkazin (x2)
for (const abramId of ["01df169f-77e2-4b6e-bb7c-cf0b7c84d6e9", "cfa555a9-7c42-44f0-8787-d3b61fd3621e"]) {
  P[abramId] = {
    unique: "pluck", thresholdSlack: FEALTY,
    behavior: { abilities: [
      { id: "make-vanish", type: "activated",
        costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: 5 }],
        targets: [pick("c", { type: "character" })],
        effects: [{ type: "moveCard", target: S("c"), to: "void" }] },
      { id: "make-reappear", type: "activated",
        costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: 1 }],
        effects: [{ type: "putIntoPlay", target: { type: "random", selector: { zone: "void", type: "character", owner: "self" } }, controller: "controller" }] }
    ] }
  };
}

// 3 Abusive Major General
P["2b149e8a-cc40-4c1b-a99f-93369ce5b4bb"] = { behavior: { abilities: [
  { id: "bleed", type: "activated",
    costs: [{ type: "destroy", target: { type: "random", selector: { type: "resource", controller: "self" } } }],
    targets: [pick("c", { type: "character", conditions: [{ type: "inBattle", target: S("__candidate") }] })],
    effects: [dmg(S("c"), 2)] }
] } };

// 4 Animated Scrap Heap
P["a10449eb-dac0-46c8-b6d7-23581550ac74"] = { behavior: {
  onPlay: { costs: [{ type: "payResources", amount: { type: "variable", id: "x" } }],
    effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }] },
  abilities: [
    { id: "grow", type: "continuous", modifiers: [
      cmod("source", "strength", "add", cnt("source"), WSIP), cmod("source", "life", "add", cnt("source"), WSIP) ] },
    { id: "expand", type: "activated", costs: [{ type: "payResources", amount: 3 }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
  ] } };

// 5 Arrakis Eternity
P["6ad7ed02-abe6-4b2a-a60a-1e12888c2e77"] = { behavior: { keywords: ["covert"], abilities: [
  recur("o", 2, [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "pl", selector: { type: "faction" }, count: 1 },
    effects: [] },
    // "That player discards 3" — model as opponent (2p) discards 3
    { type: "forEach", selector: { zone: "hand", owner: "opponent", conditions: [] }, effects: [] }
  ], undefined)
] } };
// simpler Arrakis: opponent discards 3 via chooserSelectsTarget over their hand x3
P["6ad7ed02-abe6-4b2a-a60a-1e12888c2e77"] = { behavior: { keywords: ["covert"], abilities: [{
  id: "recur", type: "activated", activationZone: "discard", threshold: "o",
  costs: [{ type: "payResources", amount: 2 }, { type: "removeFromGame", target: "source" }],
  effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
    declaration: { id: "d", selector: { zone: "hand", owner: "opponent" }, count: 3, optional: true },
    effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: S("__candidate"), to: "discard" }] }] }]
}] } };

// 6 Beefy Researcher
P["f7868f88-8581-4e71-bfb4-2e16b9f6c615"] = { behavior: { abilities: [
  { id: "research", type: "activated", costs: [{ type: "deplete", target: "source" }],
    effects: [{ type: "reduceNextCost", amount: 1 }] },
  { id: "surge", type: "continuous", condition: iconGate("elitism", 6), modifiers: [
    cmod("source", "strength", "add", 2, WSIP), cmod("source", "life", "add", 2, WSIP), cmod("source", "speed", "add", 2, WSIP) ] }
] } };

// 7 Big McLargehuge
P["9f159c52-0b48-4661-b3cd-9269e4bad55d"] = { unique: "mclargehuge", flipUp: { cost: 4, threshold: "r" }, behavior: {
  onPlay: { costs: [{ type: "destroy", target: { type: "random", selector: { type: "resource", controller: "self" } } },
    { type: "destroy", target: { type: "random", selector: { type: "resource", controller: "self" } } }] },
  abilities: [
    { id: "leave", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
      effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Play a resource", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
          declaration: { id: "r", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
          effects: [{ type: "forEach", selected: "r", effects: [{ type: "playResource", target: S("__candidate"), faceDown: "auto" }] }] }] },
        { label: "Opponent destroys a face-down resource", effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
          declaration: { id: "fd", selector: { type: "resource", faceDown: true, controller: "opponent" }, count: 1 },
          effects: [{ type: "destroy", target: S("fd") }] }] }
      ] }] }
  ] } };

// 8 Billowing Bouffant
P["e2172d8d-8763-4e99-bbc5-11e029742f34"] = { flipUp: { cost: 6, threshold: "e" }, behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "it", selector: { type: "item" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("it") }, effects: [{ type: "destroy", target: S("it") }] }] }] }
] } };

// 9 Bloodcrazed Berserker
P["3a8f423f-cc90-4571-876a-4320760f748f"] = { flipUp: { cost: 4, threshold: "r" }, behavior: { abilities: [
  { id: "hemorage", type: "activated", costs: [{ type: "destroy", target: "source" }],
    targets: [pick("t", { type: "character" })],
    effects: [dmg(S("t"), 4)] }
] } };
// Bloodcrazed picks a faction OR character — add a second decl variant via 'card' selector union not supported; keep character + allow faction via type union
P["3a8f423f-cc90-4571-876a-4320760f748f"].behavior.abilities[0].targets = [
  pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "faction" }] }] })
];

// 10 Bursting Bask
P["51a2c73b-4459-4678-8e2e-d464f967a8fa"] = { flipUp: { cost: 4, threshold: "rrr" }, behavior: { abilities: [
  { id: "burst", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("rage", 6)] },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "c", selector: { type: "character" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("c") }, effects: [dmg(S("c"), 5)] }] }] }
] } };

// 11 Camouflaged Urchin
P["a138d554-4fdb-4234-9362-d120f7b13bd2"] = { flipUp: { cost: 1, threshold: "d" }, behavior: { abilities: [
  { id: "hide", type: "continuous", condition: { type: "cardDepleted", target: "source" },
    modifiers: [], restrictions: [{ restriction: "cannotBePicked" }] }
] } };

// 12 Candy Skull Commander
P["4897e844-426b-4333-bc8b-3377d4ff6339"] = { behavior: { abilities: [
  { id: "spook", type: "triggered", event: "battleStarted", condition: { type: "battleRole", role: "defender" },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 2 }],
      effects: [{ type: "flipCoin", winEffects: [{ type: "forEach", selector: { controller: "self", type: "character" },
        effects: [cmod(S("__candidate"), "speed", "add", 1, UEOT)] }], loseEffects: [] }] }] },
  { id: "gamble", type: "triggered", event: "coinFlipped", condition: iconGate("deception", 6),
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [draw(1)] }] }
] } };

// 13 Carnival Whipmaster
P["2f3399c9-e12b-423d-88e7-e23850939fab"] = { behavior: { keywords: ["tactical"], abilities: [
  { id: "grand-theft", type: "activated", costs: [{ type: "destroy", target: "source" }],
    targets: [pick("ch", { type: "character", controller: "opponent" }), pick("it", { type: "item", controller: "opponent" })],
    effects: [{ type: "takeControl", target: S("ch"), controller: "controller" }, { type: "takeControl", target: S("it"), controller: "controller" }] }
] } };

// 14 Chosen Reaper of Thabbash
P["d4daefff-38f6-41f4-a353-fef5677f4aae"] = { flipUp: { cost: 4, threshold: "d" }, behavior: { abilities: [
  { id: "consume-force", type: "activated",
    costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: S("c") }],
    targets: [pick("c", { type: "character", controller: "self", conditions: [{ type: "not", condition: { type: "isCard", other: "source" } }] })],
    effects: [cmod("source", "speed", "add", 1, UEOT)] }
] } };

// 15 Cicibeo, The Implicator
P["f0e7f09c-4354-4042-9454-0aea33e7d133"] = { unique: "cicibeo", behavior: { abilities: [
  { id: "imply", type: "activated", costs: [{ type: "deplete", target: "source" }],
    targets: [pick("c", { type: "character" })],
    effects: [{ type: "chooserSelectsOption", chooser: { type: "controllerOf", target: S("c") }, options: [
      { label: "Deplete it", effects: [{ type: "deplete", target: S("c") }] },
      { label: "Reveal top of deck", effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
        { label: "Take control this turn", effects: [{ type: "takeControl", target: S("c"), controller: "controller", duration: UEOT }] },
        { label: "No", effects: [] } ] }] }
    ] }] },
  { id: "conspire", type: "triggered", event: "cardPlayed", threshold: "dddd",
    condition: { type: "and", conditions: [
      { type: "cardSubtypeIs", target: "eventCard", subtype: "cicibeo" },
      { type: "not", condition: { type: "eventCardIs", target: "source" } },
      { type: "eventCardControlledBy", player: "controller" } ] },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "d", selector: { type: "character", depleted: true }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("d") }, effects: [{ type: "destroy", target: S("d") }] }] }] }
] } };

// 16 Circumspect Hijacker
P["e02fe443-bd47-41e7-8790-1a57a237b8cf"] = { behavior: { abilities: [
  { id: "arrive", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("greed", 3)] }, effects: [draw(1)] },
  { id: "retreat", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "destroy", target: "source" }], effects: [draw(1)] }
] } };

// 17 Conniving Puppeteer
P["540939e9-45c3-4f51-bc1c-2078048463e2"] = { behavior: { abilities: [
  { id: "betray", type: "activated", costs: [{ type: "destroy", target: "source" }],
    targets: [pick("c", { zone: "discard", owner: "opponent", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "tactic" } }] })],
    effects: [{ type: "putIntoPlay", target: S("c"), controller: "controller" }] }
] } };

// 18 Contriving Engineer
P["ad41e756-6b51-45ae-9b0c-5e94a5e316c4"] = { behavior: { abilities: [
  { id: "fetch", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "e", selector: { zone: "deck", owner: "self", name: "Elitism" }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "e", effects: [
        { type: "putIntoPlay", target: S("__candidate"), controller: "controller" },
        { type: "attachTo", target: S("__candidate"), to: { type: "factionOf", player: "controller" } } ] },
        { type: "shuffleDeck", player: "controller" }] }] }
] } };

// 19 Crimson Pandiatus
P["5ce550a8-1829-4b9c-bde7-a1b7bb33c29f"] = { behavior: { abilities: [
  { id: "still", type: "continuous", modifiers: [], restrictions: [{ restriction: "cannotAttack" }] },
  { id: "harden", type: "continuous", condition: iconGate("rage", 6),
    modifiers: [cmod("source", "life", "add", 4, WSIP)], suppressAllAbilities: { target: "source" } }
] } };

// 21 Customized 31f
P["f35d75e8-7031-4614-b933-cd1e3420c39c"] = { behavior: { abilities: [
  { id: "kit", type: "continuous",
    condition: { type: "numberCompare",
      left: { type: "add", values: [ { type: "count", selector: { type: "location", zone: "play" } }, { type: "count", selector: { type: "item", zone: "play" } } ] },
      operator: ">=", right: 1 },
    modifiers: [cmod("source", "strength", "add", 2, WSIP), cmod("source", "life", "add", 2, WSIP)] }
] } };

// 22 Death Investor
P["b974a7f9-f347-4731-8e5c-f3f2a41d1877"] = { behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "c", selector: { zone: "discard", owner: "self", type: "character" }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "c", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "top" }] }] }] },
  { id: "grow", type: "continuous", condition: iconGate("greed", 6),
    modifiers: [cmod("source", "strength", "add", 3, WSIP), cmod("source", "life", "add", 3, WSIP)] },
  recur("g", 1, [{ type: "putIntoPlay", target: S("c"), controller: "controller" }], [pick("c", { zone: "discard", owner: "self", type: "character" })])
] } };

// 23 Desperate Defender
P["50e0be9e-dc07-43b2-afea-630a90e77308"] = { behavior: { keywords: ["covert"], abilities: [
  { id: "show-evidence", type: "activated", usesPerTurn: 1, targets: [pick("c", { type: "character" })],
    effects: [{ type: "deplete", target: S("c") }] }
] } };

// 24 Direstock Paratrooper — FLIP UP only
P["e06ea87f-5e64-42f2-828d-2c504315437c"] = { flipUp: { cost: 1, threshold: "r" }, behavior: { abilities: [] } };

// 25 Disposable Meatsack
P["583491b2-a17c-4fdc-9014-12b4c1250f67"] = { behavior: { abilities: [
  { id: "expire", type: "triggered", event: "turnEnding", condition: { type: "and", conditions: [{ type: "eventPlayerIs", player: "controller" }, { type: "cardDepleted", target: "source" }] },
    effects: [{ type: "destroy", target: "source" }] },
  { id: "surge", type: "continuous", condition: iconGate("rage", 6),
    modifiers: [cmod("source", "strength", "add", 1, WSIP), cmod("source", "speed", "add", 1, WSIP)] }
] } };

// 26 Drainbow Crash
P["d99c85ec-5f5b-4afb-9059-c1c326bf8fdf"] = {
  flipUp: { cost: 5, threshold: "e", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "it", selector: { type: "item" }, count: 1, optional: true },
    effects: [{ type: "if", condition: { type: "targetExists", target: S("it") }, effects: [{ type: "destroy", target: S("it") }] }] }] },
  behavior: { abilities: [] }
};
// metadata resourceProvides handled by resource.provides on the card def — set below in apply

// 27 Ecto-Agriolimax
P["0471df2b-e2f4-4e38-8053-7c60a0988ea3"] = { behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "addCounter", target: "source", counter: "token", amount: 2 }] },
  { id: "slither", type: "activated", costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }],
    targets: [pick("c", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "item" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "location" }] }] })],
    effects: [{ type: "moveCard", target: S("c"), to: "hand" }] }
] } };

// 28 Efficacious Gunslinger
P["357c2e36-8f77-4126-bcda-afc6ac1ef485"] = { behavior: { abilities: [
  { id: "execute", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "battleActive" }] },
    effects: [{ type: "destroy", target: "eventCard" }] }
] } };

// 29 Elite Acrolos Engineer
P["4483793f-611d-49f0-8e9e-dea88e64400a"] = { behavior: { abilities: [
  { id: "scale", type: "continuous", modifiers: [
    cmod("source", "strength", "add", { type: "distinctCount", by: "name", selector: { controller: "self", staple: true, type: "resource" } }, WSIP),
    cmod("source", "life", "add", { type: "distinctCount", by: "name", selector: { controller: "self", staple: true, type: "resource" } }, WSIP) ] }
] } };

// 30 Eustace, Sensible Glutton
P["1b7bb2f0-4fcd-4a93-8ccf-7a0142aca7a0"] = { unique: "eustace", thresholdSlack: FEALTY, behavior: { abilities: [
  { id: "gorge", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "loseInfluence", amount: 3 }],
      effects: [cmod("source", "strength", "add", 3, UEOT), grantKw("source", "covert", UEOT)] }] },
  { id: "feast", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
    effects: [infl(3)] }
] } };

// 31 Ex Machina Majig
P["40bddb30-5bc1-4ff8-9daf-3d8afd8cfc91"] = { unique: "ex machina", behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "forEach", selector: { controller: "self", type: "character" }, effects: [cmod(S("__candidate"), "strength", "add", 1, UEOT), cmod(S("__candidate"), "life", "add", 1, UEOT)] }] },
  { id: "leave", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
    effects: [{ type: "createTokens", count: 5, optional: true, controller: "controller", token: { name: "Micromajig", type: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }
] } };

// 32 Expert Debater
P["14b602dd-2653-4ea0-ad52-74dc5fe28af4"] = { behavior: { abilities: [
  { id: "burden", type: "continuous", modifiers: [cmod("source", "life", "add", negCnt("source"), WSIP)] },
  { id: "absorb", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "eventCardIs", target: "source" }, { type: "inBattle", target: "source", role: "blocker" }] },
    effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "eventDamageAmount" } }] },
  recur("gg", 1, [{ type: "removeCounter", target: S("c"), counter: "token", amount: 1 }], [pick("c", { type: "character" })])
] } };

// 33 Ezekial Cutpurse
P["bb310adf-2e87-42f3-b752-b5025edc8605"] = { unique: "ezekial cutpurse", behavior: { abilities: [
  { id: "cheap", type: "continuous", modifiers: [ { selector: { controller: "self", type: "character", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: 2 }] }, stat: "strength", operation: "add", value: 1 } ] },
  { id: "pricey", type: "continuous", modifiers: [ { selector: { controller: "self", type: "character", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: ">=", right: 4 }] }, stat: "speed", operation: "add", value: 1 } ] },
  { id: "yoink", type: "activated", costs: [{ type: "destroy", target: "source" }],
    targets: [pick("g", { subtype: "gear" }), pick("c", { type: "character" })],
    effects: [{ type: "takeControl", target: S("g"), controller: "controller" }, { type: "attachTo", target: S("g"), to: S("c") }] }
] } };

// 35 Feckless Chronicler
P["123ecdbd-dd93-4aff-a8b2-5841bd9af29e"] = { behavior: { abilities: [
  { id: "elude", type: "continuous", modifiers: [], blockRestriction: { blockerMustNotMatch: { type: "character", conditions: [{ type: "textMentionsIcon", target: S("__candidate"), icon: "volition" }] } } },
  { id: "grow", type: "continuous", modifiers: [cmod("source", "strength", "add", cnt("source"), WSIP), cmod("source", "life", "add", cnt("source"), WSIP)] },
  { id: "flick", type: "triggered", event: "cardDepleted", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("deception", 3)] },
    effects: [{ type: "flipCoin", winEffects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }], loseEffects: [] }] }
] } };

// 36 Fleet Majig
P["49eef7ab-5fec-40a7-968e-0731d97067c4"] = { behavior: { keywords: ["cannotBeBlocked"], abilities: [
  { id: "surge", type: "continuous", condition: iconGate("elitism", 6), modifiers: [cmod("source", "strength", "add", 2, WSIP), cmod("source", "life", "add", 2, WSIP)] }
] } };

// 37 Foreclosure Overseer
P["d56e0e61-ff37-4424-b089-83d879c37d98"] = {
  flipUp: { cost: 4, threshold: "gg", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "loc", selector: { type: "location" }, count: 1, optional: true },
    effects: [{ type: "if", condition: { type: "targetExists", target: S("loc") }, effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Add a damage marker", effects: [dmg(S("loc"), 1)] },
      { label: "Remove a damage marker", effects: [{ type: "healDamage", target: S("loc"), amount: 1 }] } ] }] }] }] },
  behavior: { abilities: [
    { id: "tax", type: "continuous", condition: { type: "cardDepleted", target: "source" },
      modifiers: [], costModifiers: [{ affects: "opponent", delta: 1 }] }
  ] }
};

// 38 Ghosts of Loot
P["f536d2ec-e175-4834-a32c-643fecba715f"] = { unique: "ghosts", flipUp: { cost: 3, threshold: "g" }, behavior: { abilities: [
  { id: "block", type: "triggered", event: "characterBlocked", condition: { type: "sourceIsEventCard" },
    effects: [infl(-2), cmod("source", "life", "add", 4, UEOT)] },
  { id: "attack", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
    effects: [infl(1), cmod("source", "strength", "add", 2, UEOT)] },
  { id: "arrive", type: "triggered", event: "cardEnteredPlay", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("volition", 2)] }, effects: [draw(1)] },
  { id: "wail", type: "triggered", event: "cardDestroyed", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("volition", 5)] }, effects: [draw(4)] }
] } };

// 39 Gor-blach the Endowed
P["c257a1c0-f7f4-4bfc-a82a-5b63999808d0"] = { unique: "gor-blach", behavior: { abilities: [
  { id: "get-in-there", type: "activated", threshold: "vvv",
    variables: { x: { type: "stat", target: S("c"), stat: "strength" } },
    costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: { type: "variable", id: "x" } }],
    targets: [pick("c", { type: "character", controller: "self", conditions: [{ type: "inBattle", target: S("__candidate"), role: "attacker" }] })],
    effects: [{ type: "destroy", target: S("c") },
      dmg({ type: "factionOf", player: "opponent" }, { type: "variable", id: "x" }),
      dmg("source", { type: "variable", id: "x" })] }
] } };

// 40 Great Mau General
P["49e65515-97cf-44e3-90f8-7cf79c9aa0ae"] = { behavior: { abilities: [
  { id: "levy", type: "triggered", event: "damageDealt", condition: { type: "and", conditions: [
    { type: "sourceIsDamageSource" },
    { type: "statCompare", target: { type: "factionOf", player: "controller" }, stat: "influence", operator: "<=", value: 10 } ] },
    effects: [infl(2)] }
] } };

// 41 Ignatious, Tactician Crafter
P["b22d2e91-49fe-44e7-8a1b-8034d0e9a324"] = { unique: "ignatious", thresholdSlack: FEALTY, behavior: { abilities: [
  { id: "aura", type: "continuous", modifiers: [
    { selector: { uniqueDesignation: "uhluhtc" }, stat: "strength", operation: "add", value: 3 },
    { selector: { uniqueDesignation: "uhluhtc" }, stat: "life", operation: "add", value: 3 } ] },
  { id: "cipher", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
    targets: [pick("t", { zone: "discard", owner: "self", type: "tactic" })],
    effects: [{ type: "deployFromZone", chooser: "controller", target: S("t") }] }
] } };

// 42 Jo Ciendeilio, Iron Born
P["0de9e2fd-df8a-45a0-9928-c8bfb77a4a72"] = { unique: "jo", thresholdSlack: FEALTY, behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [searchToHand({ type: "item", conditions: [{ type: "cardTradeIs", target: S("__candidate"), trade: "gearsmith" }] })] },
  { id: "leave", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, effects: [searchToHand({ type: "item", conditions: [{ type: "cardTradeIs", target: S("__candidate"), trade: "gearsmith" }] })] }
] } };

// 43 Little God of Answers
P["85d845d7-6c4f-4d53-90d1-d15a67e3598f"] = { behavior: { abilities: [
  { id: "meditate", type: "triggered", event: "turnEnding", condition: { type: "and", conditions: [{ type: "eventPlayerIs", player: "controller" }, { type: "cardDepleted", target: "source" }] },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [searchToHand({ type: "tactic" }, false)] }] }
] } };

// 44 Malevolent Trooper
P["a85e6362-b472-4c31-9722-dd7f3ba82ce2"] = { behavior: { abilities: [
  { id: "push", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: S("c") }],
    targets: [pick("c", { type: "character", controller: "self" })],
    effects: [cmod("source", "strength", "add", 2, UEOT)] }
] } };

// 48 Multi-Attachment Man
P["9b7a8729-2116-4973-a0ee-78d19555610f"] = { behavior: { abilities: [
  { id: "salvage", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [searchToHand({ type: "item" })] }
] } };

// 49 Noxious Gambler
P["8897b622-be9d-46d0-bed9-288e6abcea49"] = { behavior: { abilities: [
  { id: "scry", type: "triggered", event: "cardRestored", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: 1, to: "split" }] }
] } };

// 50 Omahkapi'si Pi'kssii
P["7a1759c9-392a-4655-94c7-8d9893904130"] = { unique: "omahkapi'si", behavior: { keywords: ["tactical"], abilities: [
  { id: "hide", type: "continuous",
    condition: { type: "numberCompare", left: { type: "count", selector: { zone: "discard", owner: "opponent" } }, operator: ">=", right: 10 },
    modifiers: [], restrictions: [{ restriction: "cannotBePicked" }] },
  { id: "flex", type: "activated", costs: [{ type: "payResources", amount: 2 }],
    targets: [pick("c", { zone: "discard", owner: "opponent" })],
    effects: [{ type: "removeFromGame", target: S("c") }, cmod("source", "strength", "add", 2, UEOT)] }
] } };

// 51 P0p
P["b1c318a6-3e5e-4e85-8ae4-6e6b812f0e30"] = { behavior: { abilities: [
  { id: "bolster", type: "activated", costs: [{ type: "deplete", target: S("a") }],
    targets: [pick("a", { type: "character", controller: "self", conditions: [{ type: "not", condition: { type: "isCard", other: "source" } }] })],
    effects: [cmod("source", "strength", "add", 1, UEOT), cmod("source", "life", "add", 1, UEOT)] },
  { id: "teamwork", type: "activated", usesPerTurn: 1,
    costs: [{ type: "destroy", target: { type: "random", selector: { controller: "self", subtype: "micromajig" } } }],
    targets: [pick("a", { name: "5n4p" }), pick("b", { name: "Cr4ck13" }), pick("c", { name: "P0p" })],
    effects: [
      cmod(S("a"), "strength", "add", 1, UEOT), cmod(S("a"), "life", "add", 1, UEOT), grantKw(S("a"), "cannotBeBlocked", UEOT),
      cmod(S("b"), "strength", "add", 1, UEOT), cmod(S("b"), "life", "add", 1, UEOT), grantKw(S("b"), "cannotBeBlocked", UEOT),
      cmod(S("c"), "strength", "add", 1, UEOT), cmod(S("c"), "life", "add", 1, UEOT), grantKw(S("c"), "cannotBeBlocked", UEOT) ] }
] } };

// 52 Padamose Cultists
P["a26e61de-884b-4f9a-a20b-e2d2fad9bada"] = { behavior: { abilities: [
  { id: "brief", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "deploySameNameThisTurn" }] },
    effects: [draw(2)] }
] } };
// NOTE: "deployed a non-character card this turn" — deploySameNameThisTurn is the closest per-turn deploy record; concession noted in coverage.

// 53 Pandering Politician
P["c8648c98-330b-4803-906c-98c146af63f9"] = { behavior: { abilities: [
  { id: "pander", type: "activated", costs: [{ type: "deplete", target: "source" }],
    targets: [pick("c", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "item" }] }] })],
    effects: [{ type: "removeCounter", target: S("c"), counter: "token", amount: 1 }] }
] } };

// 54 Party Crashers
P["0c04cd9f-7c2c-4cf9-9c00-01dd4edb543c"] = { behavior: { abilities: [
  { id: "drag", type: "continuous",
    condition: { type: "numberCompare", left: { type: "battlePartySize", side: "ownParty", of: "source" }, operator: ">=", right: 2 },
    modifiers: [cmod("source", "speed", "add", -1, WSIP)] },
  { id: "pop", type: "triggered", event: "cardDestroyed", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("elitism", 4)] },
    effects: [{ type: "createTokens", count: 2, controller: "controller", token: { name: "Micromajig", type: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }
] } };

// 55 Pluck
P["d221684d-f8d0-46ef-ad0d-458dedc13ca8"] = { unique: "pluck", behavior: { abilities: [
  { id: "grift", type: "activated", condition: { type: "isActivePlayer", player: "controller" },
    costs: [{ type: "payResources", amount: 5 }, { type: "deplete", target: "source" }],
    targets: [pick("c", { zone: "discard", owner: "opponent", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "tactic" } }] })],
    effects: [{ type: "putIntoPlay", target: S("c"), controller: "controller" }] }
] } };

// 56 Pride of Goru-Goru Gidea
P["e56986ee-eb4e-4e7d-99af-4c8df775e238"] = { behavior: { abilities: [
  { id: "resist", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "loseInfluence", amount: 1 }],
    effects: [{ type: "preventDamage", target: "source", amount: 1, mode: "reduce" }] },
  { id: "disappear", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [grantKw("source", "covert", UEOT)] }
] } };

// 57 Quipster D'Genie
P["a4f3c203-5e83-4af9-9bda-6d85d8413732"] = { behavior: { abilities: [
  { id: "wish", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "destroy", target: "source" }],
    effects: [searchToHand({ type: "tactic" }, false)] }
] } };

// 58 Readied Rifleman
P["b82e3c40-da1d-46ca-9abe-280924f3204c"] = { behavior: { abilities: [
  { id: "cover", type: "triggered", event: "cardRestored", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "f", selector: { type: "faction" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("f") }, effects: [dmg(S("f"), 1)] }] }] }
] } };

// 59 Redecorator Majig
P["e842c4d8-f856-45b8-8f29-432288edbfe0"] = { flipUp: { cost: 4, threshold: "eee" }, behavior: {
  onPlay: { targets: [pick("loc", { type: "location" }, 1, { optional: true })],
    effects: [{ type: "if", condition: { type: "targetExists", target: S("loc") }, effects: [
      { type: "deplete", target: S("loc") }, { type: "rememberTarget", key: "loc", target: S("loc") } ] }] },
  abilities: [
    { id: "lock", type: "continuous", condition: { type: "linkedCardInPlay", key: "loc" },
      modifiers: [], restrictions: [{ target: { type: "remembered", key: "loc" }, restriction: "cannotBeRestoredByRule" }] },
    { id: "buff", type: "continuous",
      condition: { type: "and", conditions: [{ type: "linkedCardInPlay", key: "loc" }, { type: "cardDepleted", target: { type: "remembered", key: "loc" } }] },
      modifiers: [cmod("source", "strength", "add", 3, WSIP), cmod("source", "life", "add", 1, WSIP)] }
  ] } };

// 60 Rudo Mangod, Fightful Adonis
P["f3c70039-bc5b-4aa5-b7fa-40705949b8b3"] = { unique: "rudolphus", thresholdSlack: FEALTY, behavior: { abilities: [
  { id: "rally", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 2 }],
      effects: [{ type: "forEach", selector: { controller: "self", type: "character" }, effects: [cmod(S("__candidate"), "strength", "add", 2, UEOT)] }] }] },
  { id: "legacy", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "w", selector: { zone: "deck", owner: "self", type: "character", conditions: [{ type: "cardTradeIs", target: S("__candidate"), trade: "warlord" }] }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "w", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "top" }] }, { type: "shuffleDeck", player: "controller" }] }] }
] } };

// 61 Salvo Sarume
P["7283e02e-9dde-459e-8d8d-ffa7cb3e0367"] = { behavior: { abilities: [
  { id: "barrage", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "r", selector: { type: "resource", controller: "self" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("r") }, effects: [
        { type: "moveCard", target: S("r"), to: "hand" },
        { type: "forEach", selector: { type: "character" }, effects: [dmg(S("__candidate"), 1)] } ] }] }] }
] } };

// 62 Seance Ritualist
P["58fd9f77-2796-4601-be97-d5015bb05145"] = { behavior: { abilities: [
  { id: "violate", type: "activated", variables: { x: { type: "counter", target: "source", counter: "token" } },
    costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: { type: "variable", id: "x" } }],
    effects: [
      { type: "chooserSelectsTarget", chooser: "opponent",
        declaration: { id: "d", selector: { zone: "hand", owner: "opponent" }, count: { type: "variable", id: "x" }, optional: true },
        effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: S("__candidate"), to: "discard" }] }] },
      { type: "addCounter", target: "source", counter: "token", amount: 1 } ] },
  { id: "blur", type: "activated", threshold: "ooo", costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }],
    effects: [grantKw("source", "covert", UEOT)] }
] } };

// 63 Securitymajig Mark II
P["1015da3f-7f05-4838-88ad-ff1de5e8359d"] = { flipUp: { cost: 5, threshold: "e" }, behavior: { keywords: ["canBlockCovert"], abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "deployedViaFlipUp" }] },
    effects: [{ type: "addCounter", target: "source", counter: "token", amount: 3 }] },
  { id: "armor", type: "continuous", modifiers: [cmod("source", "strength", "add", cnt("source"), WSIP)] }
] } };

// 64 Silencer
P["dae21a35-cc0b-4da5-8a97-1a178ce4a9a0"] = { behavior: { abilities: [
  { id: "muffle", type: "continuous", modifiers: [], blockRestriction: { blockerMustNotMatch: { type: "character", conditions: [{ type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] } } },
  { id: "tag", type: "triggered", event: "cardEnteredPlay", condition: { type: "eventCardControlledBy", player: "opponent" },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "addCounter", target: "eventCard", counter: "token", amount: 1 }] }] }
] } };

// 65 Silent Sentinels
P["0038a68b-ae48-4fbf-93c2-4e7c15406815"] = { behavior: { abilities: [
  { id: "conscript", type: "continuous", modifiers: [], restrictions: [{ selector: { type: "character" }, restriction: "mustAttack" }] },
  { id: "charge", type: "continuous", condition: iconGate("elitism", 3), keywords: [{ keyword: "aggro" }], modifiers: [] }
] } };

// 66 Slippery Assailant
P["dcb6b020-1971-4a8f-8de0-7e0c22c9027b"] = { flipUp: { cost: 0, threshold: "r" }, behavior: { abilities: [
  { id: "slip", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
    effects: [{ type: "moveCard", target: "source", to: "hand" }] }
] } };

// 67 Smokin' Hottie
P["59c7f2ec-2f3e-4260-b819-b90e859bdef9"] = { behavior: { abilities: [
  { id: "arrive", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [infl(-2)] },
  { id: "shroud", type: "continuous", condition: iconGate("volition", 4), keywords: [{ keyword: "covert" }], modifiers: [] }
] } };

// 68 Soulsearcher
P["8fef5e5f-e9ba-4738-808e-3f97577664e7"] = { behavior: { abilities: [
  { id: "o", type: "activated", threshold: "o", effects: [grantKw("source", "covert", UEOT)] },
  { id: "g", type: "activated", threshold: "g", effects: [cmod("source", "life", "add", 2, UEOT)] },
  { id: "e", type: "activated", threshold: "e", effects: [grantKw("source", "aggro", UEOT)] },
  { id: "d", type: "activated", threshold: "d", effects: [cmod("source", "speed", "add", 1, UEOT)] },
  { id: "r", type: "activated", threshold: "r", effects: [cmod("source", "strength", "add", 2, UEOT)] }
] } };

// --- Thabbashite [X][X][V][V] cycle helper ---
function thabba(id, xIcon, flipCost, buff, trig) {
  const gate = { type: "and", conditions: [iconGate(xIcon, 2), iconGate("volition", 2)] };
  const abilities = [];
  if (buff) abilities.push({ id: "vv-buff", type: "continuous", condition: gate, modifiers: buff.modifiers, ...(buff.keywords ? { keywords: buff.keywords } : {}) });
  if (trig) abilities.push({ id: "vv-trig", type: "triggered", event: trig.event, condition: { type: "and", conditions: [gate, trig.condition] }, effects: trig.effects });
  P[id] = { flipUp: { cost: flipCost, threshold: "vvvv" }, behavior: { abilities } };
}
// 69 Thabbashite Convert
thabba("c3c8d704-54ad-480b-98f5-6e4c5f621bf9", "elitism", 4,
  { modifiers: [cmod("source", "strength", "add", 1, WSIP), cmod("source", "life", "add", 1, WSIP)] },
  { event: "characterAttacked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "r", selector: { type: "resource", controller: "self", faceDown: false }, count: 1, optional: true },
    effects: [{ type: "if", condition: { type: "targetExists", target: S("r") }, effects: [{ type: "flipFaceDown", target: S("r") }] }] }] });

// 70 Thabbashite Desert Creature
P["e9f59763-c924-4f5a-83b7-b53c1d541d4f"] = { behavior: { keywords: ["covert"], abilities: [
  { id: "emerge", type: "triggered", triggerZone: "hand", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "eventCardControlledBy", player: "controller" }, { type: "cardProvides", target: "eventCard", icon: "volition", min: 1 }] },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 2 }],
      effects: [{ type: "deployFromZone", chooser: "controller", target: "source", free: true }] }] }
] } };

// 71 Thabbashite Glutton
thabba("a0243e83-005c-4bec-8454-0bbb86489d3c", "greed", 2, null,
  { event: "characterAttacked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "x", selector: { zone: "discard", owner: "any" }, count: 1, optional: true },
    effects: [{ type: "forEach", selected: "x", effects: [{ type: "removeFromGame", target: S("__candidate") }] }] }] });
P["a0243e83-005c-4bec-8454-0bbb86489d3c"].behavior.abilities.push({
  id: "vv-death", type: "triggered", event: "cardDestroyed",
  condition: { type: "and", conditions: [iconGate("greed", 2), iconGate("volition", 2), { type: "sourceIsEventCard" }] }, effects: [draw(1)] });

// 72 Thabbashite Host
thabba("4f0e52f0-eb5a-4f49-8606-1b722891ca4f", "rage", 7,
  { modifiers: [cmod("source", "strength", "add", 4, WSIP)] },
  { event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "c", selector: { type: "character" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("c") }, effects: [cmod(S("c"), "strength", "add", 4, UEOT)] }] }] });

// 73 Thabbashite Penumbra
P["8817125b-0cc8-43ba-a08e-c6711a79ecaa"] = { behavior: { abilities: [
  { id: "veil", type: "activated",
    variables: { x: { type: "distinctCount", by: "name", selector: { controller: "opponent", staple: true, type: "resource" } } },
    costs: [{ type: "payResources", amount: { type: "add", values: [6, { type: "multiply", values: [{ type: "variable", id: "x" }, -1] }] } }],
    effects: [cmod("source", "life", "add", 1, UEOT), grantKw("source", "covert", UEOT)] }
] } };

// 74 Thabbashite Priest of Zig
thabba("a68f9301-53c7-4b67-ac5b-dc61c6f689ed", "obsession", 3,
  { keywords: [{ keyword: "covert" }], modifiers: [] },
  { event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "n", count: 1, optional: true, selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] } },
    effects: [{ type: "forEach", selected: "n", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }] }] });

// 75 Thabbashite Seer
thabba("e9927400-459f-4c38-a223-4d3b958e70ae", "deception", 1, null,
  { event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: 1, to: "top" }] });
// add the other three triggers (leaves/attacks/blocks) sharing the effect
for (const [ev, cond] of [["cardMoved", { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }], ["characterAttacked", { type: "sourceIsEventCard" }], ["characterBlocked", { type: "sourceIsEventCard" }]]) {
  P["e9927400-459f-4c38-a223-4d3b958e70ae"].behavior.abilities.push({
    id: "vv-" + ev, type: "triggered", event: ev,
    condition: { type: "and", conditions: [iconGate("deception", 2), iconGate("volition", 2), cond] },
    effects: [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: 1, to: "top" }] });
}

// 76 Thabbashite Weapons Expert
P["e8cd0ae5-9aba-4996-8a29-3f160b2d96f2"] = { behavior: { abilities: [
  { id: "detonate", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "bind", id: "x", value: { type: "stat", target: "source", stat: "strength" } },
      { type: "mayPay", player: "controller", costs: [{ type: "destroy", target: "source" }],
        effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
          { label: "Damage each opposing faction", effects: [{ type: "forEach", selector: { type: "faction", controller: "opponent" }, effects: [dmg(S("__candidate"), { type: "variable", id: "x" })] }] },
          { label: "Destroy an item", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
            declaration: { id: "it", selector: { type: "item", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "variable", id: "x" } }] }, count: 1 },
            effects: [{ type: "destroy", target: S("it") }] }] } ] }] }] },
  { id: "vv", type: "continuous", condition: iconGate("volition", 5), modifiers: [cmod("source", "strength", "add", 2, WSIP)] }
] } };

// 77 Theological Opportunist
P["fb3bed57-05e1-44b3-a8c4-2f03bc876476"] = { behavior: { abilities: [
  { id: "clutter", type: "continuous", modifiers: [
    cmod("source", "strength", "add", { type: "multiply", values: [{ type: "count", selector: { zone: "hand", owner: "any" } }, -1] }, WSIP),
    cmod("source", "life", "add", { type: "multiply", values: [{ type: "count", selector: { zone: "hand", owner: "any" } }, -1] }, WSIP) ] }
] } };

// 78 Twisted Marionette
P["f78f043a-1c35-49ae-939f-3e0efabdd810"] = { behavior: { abilities: [
  { id: "yank", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "chooserSelectsTarget", chooser: { type: "ownerOf", target: "eventCard" },
        declaration: { id: "c", selector: { type: "character", controller: "opponent" }, count: 1 },
        effects: [{ type: "moveCard", target: S("c"), to: "hand" }] }] }] }
] } };

// 79 Unchained Sarcophyle — FLIP UP only
P["62ab1a47-6b01-4f22-ae70-92613d283077"] = { flipUp: { cost: 8, threshold: "d" }, behavior: { abilities: [] } };

// 81 Unwise Encirclement
P["4a2644f2-727c-4db8-b3dc-800a0efc82a2"] = { flipUp: { cost: 5, threshold: "r" }, behavior: {
  onPlay: { targets: [pick("c", { type: "character" })],
    effects: [
      { type: "addCounter", target: S("c"), counter: "token", amount: 1 },
      { type: "if", condition: { type: "deployedViaFlipUp" }, effects: [{ type: "addCounter", target: S("c"), counter: "token", amount: 4 }] },
      dmg(S("c"), { type: "counter", target: S("c"), counter: "token" }) ] }
} };

// 82 Vexillarius Dacian-Draco
P["a43f20a7-ece5-477b-a791-2ff02689bcb2"] = { unique: "vexillarius", behavior: { abilities: [
  { id: "banner", type: "continuous", modifiers: [
    { selector: { controller: "self", type: "character", conditions: [{ type: "not", condition: { type: "isCard", other: "source" } }] }, stat: "strength", operation: "add", value: 2 },
    { selector: { controller: "self", type: "character", conditions: [{ type: "not", condition: { type: "isCard", other: "source" } }] }, stat: "life", operation: "add", value: 2 } ] },
  { id: "rout", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "forEach", selector: { type: "character" }, effects: [cmod(S("__candidate"), "strength", "add", -2, UEOT), cmod(S("__candidate"), "life", "add", -2, UEOT)] }] }
] } };

// 83 Voidal Bask
P["a750d103-edca-4c5d-8724-e289ed80463e"] = { behavior: { abilities: [
  { id: "haunt", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "h", selector: { zone: "hand", owner: "opponent" }, count: 1 },
      effects: [{ type: "moveCard", target: S("h"), to: "discard" }] }] }
] } };

// 84 Voidal Tactician
P["a59feec7-7291-40f8-af99-8ca84aa2cb8c"] = { behavior: { abilities: [
  { id: "leech", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] },
    effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }],
      effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "t", selector: { zone: "deck", owner: { type: "ownerOf", target: "eventCard" }, type: "tactic" }, count: 1, optional: true },
        effects: [{ type: "forEach", selected: "t", effects: [{ type: "moveCard", target: S("__candidate"), to: "void" }] }, { type: "shuffleDeck", player: { type: "ownerOf", target: "eventCard" } }] }] }] },
  { id: "conduit", type: "continuous", condition: { type: "cardDepleted", target: "source" }, modifiers: [],
    voidPlay: { selector: { zone: "void", type: "tactic", owner: "self" }, ignoreThreshold: true } }
] } };
// NOTE: chooserSelectsTarget over an opponent's deck for a tactic is a search; concession: 'reveal it' step is implicit.

// 85 War Racketeer
P["a49c3c32-ad10-4ffe-8814-aa68ddb666fa"] = { behavior: { abilities: [
  { id: "muster", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [draw({ type: "count", selector: { type: "character", zone: "play", controller: "any" } })] },
  { id: "under-the-table", type: "activated", costs: [{ type: "discard", amount: 1 }],
    effects: [cmod("source", "life", "add", -1, UEOT), cmod("source", "strength", "add", 1, UEOT), grantKw("source", "covert", UEOT)] }
] } };

// 86,87 Yenessa Shipping, LLP (x2)
for (const yid of ["453a6b4d-a4c3-46f7-a9cc-9e043cde9f50", "684d5f70-bf07-4b3a-95bc-c06c4aa11c81"]) {
  P[yid] = { unique: "llp", flipUp: { cost: 1, threshold: "ggg" }, behavior: { abilities: [
    { id: "leverage", type: "continuous", modifiers: [
      cmod("source", "strength", "add", { type: "multiply", values: [{ type: "count", selector: { type: "item", controller: "opponent" } }, 2] }, WSIP),
      cmod("source", "life", "add", { type: "multiply", values: [{ type: "count", selector: { type: "item", controller: "opponent" } }, 2] }, WSIP) ] },
    { id: "upkeep", type: "continuous", modifiers: [], grantedAbilities: [
      { selector: { type: "item" }, abilities: [
        { id: "llp-upkeep", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
          effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [], elseEffects: [{ type: "destroy", target: "source" }] }] } ] } ] }
  ] } };
}

// 88,89 Zenobia, Artificer (x2)
for (const zid of ["6d5dffbe-9724-4ed6-89f7-58189567f5af", "2df3c789-ac84-4aba-9652-968cefb669f4"]) {
  P[zid] = { unique: "zenobia", behavior: { abilities: [
    { id: "disenchant", type: "activated",
      costs: [{ type: "deplete", target: "source" }, { type: "discard", amount: 1 }],
      effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }] },
    { id: "clairvoyance", type: "activated",
      variableBounds: { x: { min: 1, max: { type: "counter", target: "source", counter: "token" } } },
      costs: [{ type: "deplete", target: "source" }, { type: "removeCounter", target: "source", counter: "token", amount: { type: "variable", id: "x" } }],
      effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "s", selector: { zone: "deck", owner: "self", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "variable", id: "x" } }] }, count: 1, optional: true },
        effects: [{ type: "forEach", selected: "s", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }, { type: "shuffleDeck", player: "controller" }] }] }
  ] } };
}
// NOTE: DISENCHANT "X is the discarded item's numeric cost" — modelled with a chooser number x (bounded), a concession: player names X rather than it deriving from the discard.

// 90 Zigalburgonglgr, the Stolen God
P["88e58247-0bb3-481f-97ce-724f786d1980"] = { behavior: { abilities: [
  { id: "mark", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "m", selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] }, count: { type: "resourceIcons", player: "controller", icon: "volition" }, optional: true },
      effects: [{ type: "forEach", selected: "m", effects: [{ type: "addCounter", target: S("__candidate"), counter: "token", amount: 1 }] }] }] },
  { id: "collapse", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "forEach", selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }, { type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] }, effects: [{ type: "destroy", target: S("__candidate") }] }] },
  { id: "mush", type: "activated", costs: [{ type: "payResources", amount: 2 }],
    targets: [pick("c", { conditions: [{ type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] })],
    effects: [{ type: "flipFaceDown", target: S("c") }] }
] } };

// ============================ ITEMS ============================

// 91 Corrosive Waste Dispenser
P["083e0cca-f86f-4922-9bf5-04d254ebfc4e"] = { behavior: { abilities: [
  { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 4 }] },
  { id: "empty", type: "triggered", event: "counterChanged", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 0 }] },
    effects: [{ type: "flipFaceDown", target: "source" }] },
  { id: "convert", type: "activated",
    costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 },
      { type: "destroy", target: { type: "random", selector: { type: "character", controller: "self", conditions: [{ type: "not", condition: { type: "cardSubtypeIs", target: S("__candidate"), subtype: "micromajig" } }] } } }],
    effects: [{ type: "forEachPlayer", order: "activeFirst", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "k", selector: { type: "character", controller: "self" }, count: 1 }, effects: [{ type: "destroy", target: S("k") }] }] }] }
] } };

// 92 Direstock Cuffs
P["7a43c5fd-16bd-4f30-880a-3064c0ca8d6e"] = { attachTo: "character", flipUp: { cost: 1, threshold: "e" }, behavior: { abilities: [
  { id: "suppress-covert", type: "continuous", modifiers: [], suppressKeywords: [{ target: "attachedTo", keyword: "covert" }] },
  { id: "suppress-text", type: "continuous", condition: { type: "textMentionsIcon", target: "attachedTo", icon: "volition" },
    modifiers: [], suppressAllAbilities: { target: "attachedTo" } },
  { id: "move", type: "activated", costs: [{ type: "payResources", amount: 2 }],
    targets: [pick("c", { type: "character", conditions: [{ type: "not", condition: { type: "inBattle", target: S("__candidate") } }] })],
    effects: [{ type: "attachTo", target: "source", to: S("c") }] }
] } };

// 93 Ecto-Conduit
P["72521ca8-c28f-44c0-a843-79d8470ab975"] = { behavior: { abilities: [
  { id: "cycle", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "mayPay", player: "controller", costs: [],
      effects: [draw(3), { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "b", selector: { zone: "hand", owner: "self" }, count: 2, optional: true },
        effects: [{ type: "forEach", selected: "b", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "top" }] }] }] }] },
  { id: "harness", type: "activated", costs: [{ type: "destroy", target: "source" }],
    effects: [{ type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, to: "void" },
      { type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: "tactic" }, effects: [] }] }
] } };
// NOTE: Ecto-Conduit HARNESS "if it is a tactic you may deploy it from the void ignoring threshold" — voided card grant is a concession left minimal (the void move happens; deploy-from-void grant omitted). low-medium confidence.

// 94 Expedition AutoBlind
P["82bd80a1-9222-42d4-89a8-9b8696a26c90"] = { flipUp: { cost: 1, threshold: "d" }, behavior: { abilities: [
  { id: "hunker-down", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }],
    targets: [pick("c", { zone: "discard", conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "tactic" }] }] })],
    effects: [{ type: "removeFromGame", target: S("c") }, draw(1), { type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "b", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "b", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "bottom" }] }] }] },
  { id: "buy-time", type: "activated", threshold: "ddd", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "restore", target: "source" }] }
] } };

// 95 Extremely Tiny Bonnet of Invisibility
P["808bd2ba-7b76-4d81-b733-425078db481a"] = { attachTo: "character", behavior: {
  onPlay: { effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
    declaration: { id: "r", selector: { type: "resource", controller: "opponent", attachedToFaction: true }, count: 2, optional: true },
    effects: [{ type: "forEach", selected: "r", effects: [{ type: "detach", target: S("__candidate") }] }] }] },
  abilities: [
    { id: "cloak", type: "continuous", modifiers: [], keywords: [{ target: "attachedTo", keyword: "covert" }] }
  ] } };

// 96 Fantastic Über Kool Creator Majig
P["e2f8e482-c1c5-48fa-949c-6a7bc7cc0e09"] = { unique: "creator majig", behavior: {
  onPlay: { costAdjust: { type: "multiply", values: [{ type: "resourceIcons", player: "controller", icon: "elitism" }, -1] } },
  abilities: [
    { id: "harvest", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "r", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
        effects: [{ type: "forEach", selected: "r", effects: [{ type: "playResource", target: S("__candidate"), faceDown: "auto" }] }] }] },
    { id: "reforge", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
      effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "e", selector: { controller: "self", conditions: [{ type: "cardProvides", target: S("__candidate"), icon: "elitism", min: 1 }] }, count: 1, optional: true },
        effects: [{ type: "if", condition: { type: "targetExists", target: S("e") }, effects: [{ type: "destroy", target: S("e") }, searchToHand({}, false)] }] }] }
  ] } };

// 97 Gory Trick Box
P["8d619f6d-498c-4343-a86b-4e01cef5ca34"] = { attachTo: "character", behavior: { abilities: [
  { id: "heft", type: "continuous", modifiers: [cmod("attachedTo", "strength", "add", 2, WSIP), cmod("attachedTo", "speed", "add", -2, WSIP)] }
] } };

// 98 Key to the City
P["cabcf2b8-f2c4-4dd8-ba1b-2d239b26f3da"] = { attachTo: "character", behavior: { abilities: [
  { id: "unlock-leave", type: "triggered", event: "cardMoved",
    condition: { type: "and", conditions: [{ type: "eventCardIs", target: "attachedTo" }, { type: "cardMovedFromZone", zone: "play" }] },
    effects: [searchToHand({ type: "resource" })] },
  { id: "unlock-potential", type: "activated", activationZone: "hand", threshold: "g",
    costs: [{ type: "moveSelected", id: "self", player: "controller", selector: { zone: "hand", owner: "self", name: "__self" }, count: 1, to: "discard" }, { type: "payResources", amount: 2 }],
    effects: [searchToHand({ type: "resource" }, false)] }
] } };
// NOTE: Key to the City UNLOCK POTENTIAL discards THIS card from hand as a cost — modelled loosely (moveSelected of a hand card); "a resource with a name you don't control" narrowed to any resource. concession.

// 99 Kitten Mittons
P["37c92e02-fbd4-4a62-8e27-5beab0a0cb36"] = { attachTo: "character", behavior: { abilities: [
  { id: "cushion", type: "triggered", event: "damageDealt", condition: { type: "eventCardIs", target: "attachedTo" },
    effects: [infl({ type: "eventDamageAmount" })] }
] } };

// 100,101 Lockbox of the Aeons (x2)
for (const lid of ["2475968c-7bb5-43c1-8225-1bf9d8fdc059", "0049c804-79a6-4981-85fe-3137949e3970"]) {
  P[lid] = { behavior: { abilities: [
    { id: "seal", type: "continuous", modifiers: [],
      playRestrictions: [{ player: "opponent", kind: "flipUp" }],
      restrictReturnToHand: { player: "opponent", fromZones: ["void", "discard", "play"] } }
  ] } };
}

// 102 Quilt of Old Banners
P["769df66e-d77d-409e-bb1b-abef698edf54"] = { unique: "quilt", behavior: { abilities: [
  { id: "name-etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "nameValue", valueKind: "resourceIcon", storeAs: "q" },
      { type: "grantProvides", target: "source", icon: { fromNamed: "q" }, amount: 1, duration: USNT }] },
  { id: "name-turn", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "nameValue", valueKind: "resourceIcon", storeAs: "q" },
      { type: "grantProvides", target: "source", icon: { fromNamed: "q" }, amount: 1, duration: USNT }] },
  { id: "hand-it-down", type: "activated",
    costs: [{ type: "payResources", amount: 1 }, { type: "moveSelected", id: "self", player: "owner", selector: { name: "__self" }, count: 1, to: "deck", shuffle: true }],
    effects: [draw(1)] }
] } };

// 103 Severed Limb
P["d7a08113-2e68-4b1b-84d0-37558b6ae285"] = { attachTo: "character", behavior: { abilities: [
  { id: "graft", type: "continuous", modifiers: [cmod("attachedTo", "strength", "add", 1, WSIP)] },
  { id: "bulk-up", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "destroy", target: { type: "random", selector: { name: "Rage", owner: "self" } } }],
    effects: [cmod("attachedTo", "strength", "add", 1, UEOT)] }
] } };

// 104 Symmetrical Scimitar
P["a3323452-3932-4a8a-a3d3-2583fdc7035e"] = { attachTo: "character", behavior: { abilities: [
  { id: "sync", type: "continuous", condition: { type: "isCard", target: { type: "controllerOf", target: "attachedTo" }, other: { type: "controllerOf", target: "source" } },
    modifiers: [cmod("attachedTo", "strength", "add", 1, WSIP), cmod("attachedTo", "life", "add", 1, WSIP)] },
  { id: "desync", type: "continuous", condition: { type: "not", condition: { type: "isCard", target: { type: "controllerOf", target: "attachedTo" }, other: { type: "controllerOf", target: "source" } } },
    modifiers: [cmod("attachedTo", "strength", "add", -1, WSIP), cmod("attachedTo", "life", "add", -1, WSIP)] }
] } };
// NOTE: isCard compares card instances, not players — Symmetrical Scimitar "controlled by you vs not" is authored via a comparison of controllerOf refs; if isCard rejects non-card refs this needs a small helper. medium confidence.

// ============================ LOCATIONS ============================

// 106 Acrolosian Outpost
P["22fd7a13-1319-40e8-8e95-33e90cc5d376"] = { behavior: { abilities: [
  { id: "snub", type: "activated", costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }],
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "e", selector: { zone: "deck", owner: "self", name: "Elitism" }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "e", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }, { type: "shuffleDeck", player: "controller" }] }] }
] } };

// 107 Apparition Alley
P["cda94ae8-2baa-4b34-8ef4-f1df6554daf9"] = { behavior: { abilities: [
  { id: "woosh", type: "activated", costs: [{ type: "deplete", target: "source" }],
    targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "speed", "add", 1, UEOT)] }
] } };

// 108 Carnival Funhouse
P["b58eb946-a9fe-4661-bc06-c4607cc448cd"] = { behavior: {
  onPlay: { targets: [pick("a", { type: "character", controller: "opponent" }), pick("b", { type: "character", controller: "self" })],
    effects: [
      { type: "bind", id: "as", value: { type: "stat", target: S("a"), stat: "strength" } },
      { type: "bind", id: "al", value: { type: "stat", target: S("a"), stat: "life" } },
      { type: "bind", id: "ap", value: { type: "stat", target: S("a"), stat: "speed" } },
      { type: "bind", id: "bs", value: { type: "stat", target: S("b"), stat: "strength" } },
      { type: "bind", id: "bl", value: { type: "stat", target: S("b"), stat: "life" } },
      { type: "bind", id: "bp", value: { type: "stat", target: S("b"), stat: "speed" } },
      cmod(S("a"), "strength", "set", { type: "variable", id: "bs" }, WSIP),
      cmod(S("a"), "life", "set", { type: "variable", id: "bl" }, WSIP),
      cmod(S("a"), "speed", "set", { type: "variable", id: "bp" }, WSIP),
      cmod(S("b"), "strength", "set", { type: "variable", id: "as" }, WSIP),
      cmod(S("b"), "life", "set", { type: "variable", id: "al" }, WSIP),
      cmod(S("b"), "speed", "set", { type: "variable", id: "ap" }, WSIP) ] },
  abilities: [] } };

// 109 Direstock Stronghold
P["8d5dd336-23ad-4efd-9ce0-a94d58ca72e8"] = { unique: "stronghold", behavior: { abilities: [
  { id: "restock", type: "triggered", event: "turnEnding", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "w", selector: { zone: "deck", owner: "self", type: "character", conditions: [{ type: "cardTradeIs", target: S("__candidate"), trade: "warlord" }] }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "w", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "top" }] }, { type: "shuffleDeck", player: "controller" }] }] },
  { id: "barrage", type: "triggered", event: "cardPlayed",
    condition: { type: "and", conditions: [{ type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "controller" }] },
    effects: [{ type: "bind", id: "x", value: { type: "cardCost", target: "eventCard" } },
      { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "f", selector: { type: "faction" }, count: 1, optional: true },
        effects: [{ type: "if", condition: { type: "targetExists", target: S("f") }, effects: [dmg(S("f"), { type: "variable", id: "x" }), dmg("source", { type: "variable", id: "x" })] }] }] }
] } };

// 110 Doarden Flee Market
P["c1096e81-40be-4c71-b4b4-77726cdef722"] = { behavior: { abilities: [
  { id: "hock", type: "activated", costs: [{ type: "payResources", amount: 1 }, { type: "deplete", target: "source" }, { type: "destroy", target: S("c") }],
    targets: [pick("c", { type: "character", owner: "self" })], effects: [draw(1)] },
  { id: "weedle", type: "activated", threshold: "gggggg", costs: [{ type: "payResources", amount: 2 }, { type: "deplete", target: "source" }, { type: "destroy", target: S("c") }],
    targets: [pick("c", { type: "character", owner: "self" })], effects: [draw(3)] }
] } };

// 111 Eidolic Cove
P["cef7f9fa-aa53-4a62-b8ec-325f0b707c5c"] = { flipUp: { cost: 2, threshold: "g" }, behavior: { abilities: [
  { id: "hide", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" },
    effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "x", selector: { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "item" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "location" }] }] }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("x") }, effects: [{ type: "flipFaceDown", target: S("x") }] }] }] },
  { id: "collapse", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [infl(-4)] }
] } };

// 112 Geldale, City-Fortress
P["f4ab5680-e5ab-47b1-bf3d-953d54adc79b"] = { behavior: { abilities: [
  { id: "curfew", type: "continuous", modifiers: [], playRestrictions: [{ player: "opponent", kind: { cardType: "tactic" }, timing: "notActivePlayer" }] }
] } };

// --- Gosche's ___ location cycle ---
function gosche(id, benefitEffects, trigCond) {
  P[id] = { behavior: { abilities: [
    { id: "harvest", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [{ type: "cardMovedFromZone", zone: "play" }, { type: "eventCardControlledBy", player: "controller" }, { type: "counterCompare", target: "eventCard", counter: "token", operator: ">=", value: 1 }].concat(trigCond ? [trigCond] : []) },
      effects: benefitEffects },
    { id: "seed", type: "activated", costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: 2 }],
      targets: [pick("c", { type: "character", controller: "self" })],
      effects: [{ type: "addCounter", target: S("c"), counter: "token", amount: 1 }] }
  ] } };
}
// 113 Gosche's God Amplification Chamber
gosche("dd66ddb1-9ad2-40fa-921f-2ba487d3d453", [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: 1, to: "split" }]);
// 114 Gosche's Restoration Fortress
gosche("2585fca5-dea5-4753-a6ca-80c53328ec76", [{ type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "r", selector: { type: "character", conditions: [{ type: "statCompare", target: S("__candidate"), stat: "strength", operator: "<", value: { type: "stat", target: "eventCard", stat: "strength" } }] }, count: 1, optional: true },
  effects: [{ type: "forEach", selected: "r", effects: [{ type: "restore", target: S("__candidate") }] }] }]);
// 115 Gosche's Retained Earnings Vault
gosche("c8ff2521-ffd3-46e7-b3a4-9c6642e7d23b", [infl(2)]);
// 116 Gosche's Solar Citadel
gosche("34384da0-0fa5-48e6-9dc5-3e87dcde11a6", [{ type: "createTokens", count: 1, optional: true, controller: "controller",
  token: { name: "Micromajig", type: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }],
  { type: "not", condition: { type: "isToken", target: "eventCard" } });
// 117 Gosche's Spynarium
gosche("7ff88674-b7ec-46d9-bf53-c38d83e641a9", [{ type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "c", selector: { type: "character" }, count: 1, optional: true },
  effects: [{ type: "forEach", selected: "c", effects: [grantKw(S("__candidate"), "covert", UEOT)] }] }]);

// 118 PP&E
P["29b3dc24-5f90-4a14-adab-030bb2f8b771"] = { behavior: { abilities: [
  { id: "pay-off", type: "activated",
    condition: { type: "respondingTo", cardType: "character", respondsTo: "card" },
    costs: [{ type: "deplete", target: "source" }, { type: "payResources", amount: 1 }, { type: "destroy", target: "source" }],
    effects: [{ type: "terminate", target: "respondedToCard" }] }
] } };

// 119 Wasteland
P["7331f393-05da-4661-bbf6-4ee695c830cd"] = { unique: "wasteland", behavior: { abilities: [
  { id: "retaliate", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "eventCardIs", target: "source" }, { type: "cardTypeIs", target: { type: "damageSource" }, cardType: "character" }] },
    effects: [{ type: "destroy", target: { type: "damageSource" } }] },
  { id: "erode", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] },
  { id: "void-all", type: "triggered", event: "counterChanged",
    condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 3 }] },
    effects: [{ type: "forEach", selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] }, effects: [{ type: "moveCard", target: S("__candidate"), to: "void" }] }] }
] } };

// 120 Zenobia's Tower
P["9c0e2ffb-b580-402f-98a3-3fb892384326"] = { unique: "watchtower", behavior: { abilities: [
  { id: "scry", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" },
    effects: [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: 2, to: "split" }] },
  { id: "echo", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" },
    effects: [searchToHand({ name: "Zenobia's Tower" })] }
] } };

// ============================ TACTICS ============================

// 121 Arcane Ambush
P["da838cc5-e3ac-4b39-b017-41f3bff5ec1b"] = { flipUp: { cost: 6, threshold: "ogedr" }, behavior: { abilities: [
  { id: "body", type: "activated", condition: { type: "isActivePlayer", player: "controller" },
    targets: [pick("f", { type: "faction" })],
    effects: [
      { type: "forEach", selector: { type: "item" }, effects: [{ type: "destroy", target: S("__candidate") }] },
      { type: "forEach", selector: { type: "location" }, effects: [{ type: "destroy", target: S("__candidate") }] },
      { type: "if", condition: { type: "and", conditions: [
        { type: "numberCompare", left: { type: "count", selector: { controller: "self", uniqueDesignation: "jo" } }, operator: ">=", right: 1 },
        { type: "numberCompare", left: { type: "count", selector: { controller: "self", uniqueDesignation: "eustace" } }, operator: ">=", right: 1 },
        { type: "numberCompare", left: { type: "count", selector: { controller: "self", uniqueDesignation: "pluck" } }, operator: ">=", right: 1 },
        { type: "numberCompare", left: { type: "count", selector: { controller: "self", uniqueDesignation: "rudolphus" } }, operator: ">=", right: 1 },
        { type: "numberCompare", left: { type: "count", selector: { controller: "self", uniqueDesignation: "ignatious" } }, operator: ">=", right: 1 } ] },
        effects: [dmg(S("f"), 15), { type: "forEach", selector: { type: "character", controller: { type: "controllerOf", target: S("f") } }, effects: [dmg(S("__candidate"), 15)] }] }
    ] }
] } };

// 122 Auditory Adulation
P["e38bc85c-e7ab-4f6f-b795-08976682f7bd"] = { flipUp: { cost: 3, threshold: "r" }, behavior: { abilities: [
  { id: "body", type: "activated", condition: { type: "not", condition: { type: "battleActive" } },
    targets: [pick("c", { type: "character" })],
    effects: [cmod(S("c"), "strength", "add", { type: "cardCost", target: S("c") }, UEOT),
      { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "r", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
        effects: [{ type: "forEach", selected: "r", effects: [{ type: "playResource", target: S("__candidate"), faceDown: "auto" }] }] }] }
] } };

// 123 Bank Rolled
P["c936b17a-0829-4858-bdf8-3de62c06dd39"] = { flipUp: { cost: 4, threshold: "gg", effects: [infl(4)] }, behavior: { abilities: [
  { id: "body", type: "activated", costs: [{ type: "loseInfluence", amount: { type: "variable", id: "x" } }],
    targets: [pick("c", { type: "character", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "=", right: { type: "variable", id: "x" } }] })],
    effects: [{ type: "destroy", target: S("c") }] }
] } };

// 124 Brainbath
P["2bf6045a-5b3f-4189-ae91-28837c0d7b83"] = { behavior: { abilities: [
  { id: "body", type: "activated", effects: [draw(2), { type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "b", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
    effects: [{ type: "forEach", selected: "b", effects: [{ type: "moveCard", target: S("__candidate"), to: "deck", position: "bottom" }] }] }] },
  recur("oo", 4, [{ type: "chooserSelectsTarget", chooser: "opponent",
    declaration: { id: "d", selector: { zone: "hand", owner: "opponent" }, count: 1, optional: true },
    effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: S("__candidate"), to: "discard" }] }] }, draw(1)])
] } };

// 125 Breath of the Barduse
P["f28ced68-ff65-4257-8e08-178a51d9e15e"] = { behavior: { abilities: [
  { id: "body", type: "activated", condition: { type: "isActivePlayer", player: "controller" },
    effects: [{ type: "forEachPlayer", order: "activeFirst", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "k", selector: { type: "character", owner: "self" }, count: 2, optional: true },
      effects: [{ type: "forEach", selected: "k", effects: [{ type: "destroy", target: S("__candidate") }] }] }] }] }
] } };
// NOTE: "Each player destroys 2 ... Otherwise destroy all" — the 'otherwise wipe' fallback is not modelled (a player with <2 characters just destroys what they have). concession.

// 126 Cunning Ruse
P["19fa3b83-2708-4d40-9928-0a02f46c7cb0"] = { behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("it", { type: "item" })],
    effects: [{ type: "flipFaceDown", target: S("it") }] }
] } };
// NOTE: Cunning Ruse flips the item face-down under its owner's OPPONENT's control — flipFaceDown flips under owner; the "opponent's control" nuance is a concession.

// 127 Deicidal Detonation
P["055f3424-00dc-4a20-8a2b-01c69014eeb6"] = { behavior: { abilities: [
  { id: "body", type: "activated", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "m", selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] }, count: { type: "count", selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] } }, optional: true },
    effects: [{ type: "forEach", selected: "m", effects: [{ type: "addCounter", target: S("__candidate"), counter: "token", amount: 1 }] }] }] },
  recur("o", 4, [{ type: "forEach", selector: { conditions: [{ type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] }, effects: [{ type: "destroy", target: S("__candidate") }] }])
] } };

// 128 Demolition Investment
P["453db85c-818d-4e89-a019-9abf16307109"] = { flipUp: { cost: 4, threshold: "g" }, behavior: { abilities: [
  { id: "body", type: "activated", costs: [{ type: "loseInfluence", amount: 3 }],
    effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
      declaration: { id: "r", selector: { type: "resource", controller: "opponent", faceDown: true }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("r") }, effects: [
        infl({ type: "cardCost", target: S("r") }), { type: "destroy", target: S("r") } ] }] }] }
] } };

// 129 Difference of Opinion
P["66225aa8-ee86-47da-ab3c-a72cbed7b6ce"] = { flipUp: { cost: 4, threshold: "r", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "it", selector: { type: "item" }, count: 1, optional: true },
  effects: [{ type: "if", condition: { type: "targetExists", target: S("it") }, effects: [{ type: "destroy", target: S("it") }] }] }] }, behavior: { abilities: [
  { id: "body", type: "activated", effects: [
    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "a", selector: { type: "character" }, count: 1, optional: true },
      effects: [{ type: "if", condition: { type: "targetExists", target: S("a") }, effects: [dmg(S("a"), 1)] }] },
    { type: "if", condition: { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 2 },
      effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "b", selector: { type: "character" }, count: 1, optional: true },
        effects: [{ type: "if", condition: { type: "targetExists", target: S("b") }, effects: [dmg(S("b"), 2)] }] }] }
  ] }
] } };

// 130 Flesh Deliquesce
P["94a4916f-0dcf-48d0-b1ab-62aa40c26070"] = { behavior: { abilities: [
  { id: "body", type: "activated",
    variables: { x: { type: "count", selector: { type: "resource", controller: "opponent", attachedToFaction: false } } },
    targets: [pick("c", { type: "character" })],
    effects: [{ type: "if", condition: { type: "statCompare", target: S("c"), stat: "strength", operator: "<=", value: { type: "variable", id: "x" } }, effects: [{ type: "destroy", target: S("c") }] }] }
] } };

// 131 Frantic Jerryrigging
P["a9c7ba1c-1080-4a81-932a-ab573c7a193f"] = { behavior: { abilities: [
  { id: "body", type: "activated", costs: [{ type: "destroy", target: S("it") }],
    targets: [pick("it", { type: "item", controller: "self" })],
    variables: { x: { type: "cardCost", target: S("it") } },
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Search for an item", effects: [searchToHand({ type: "item", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "add", values: [{ type: "variable", id: "x" }, 2] } }] }, false)] },
      { label: "Destroy an opponent's item", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "o", selector: { type: "item", controller: "opponent", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "add", values: [{ type: "variable", id: "x" }, 2] } }] }, count: 1 },
        effects: [{ type: "destroy", target: S("o") }] }] } ] }] }
] } };
// NOTE: Frantic Jerryrigging "X was its numeric cost" captured via ability.variables from the pick that is also the destroy-cost target; ordering concession.

// --- God's Blessing cycle ---
function blessing(id, uniqueSlug, granted, etbEffects) {
  P[id] = { unique: "blessing", attachTo: "character", behavior: {
    ...(etbEffects ? { abilities: [] } : {}),
    abilities: [
      ...(etbEffects ? [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: etbEffects }] : []),
      { id: "grant-text", type: "continuous", modifiers: [], grantedAbilities: [
        { selector: { conditions: [{ type: "isCard", other: "attachedTo" }] }, abilities: granted }
      ] }
    ] } };
}
// 132 God's Blessing of Boost
blessing("591002be-11b3-41b6-b406-0f34e7a6695c", "blessing", [
  { id: "b-turn", type: "triggered", event: "turnStarted", effects: [{ type: "forEach", selector: { controller: "self", type: "character" }, effects: [dmg(S("__candidate"), 1)] }] },
  { id: "b-aura", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 1 }] }
], [{ type: "forEach", selector: { type: "character" }, effects: [dmg(S("__candidate"), 1)] }]);
// 133 God's Blessing of Foresight
blessing("f7215de9-64b6-44e6-b4f2-22749d93825f", "blessing", [
  { id: "f-turn", type: "triggered", event: "turnStarted", effects: [{ type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "c", selector: { controller: "self", type: "character" }, count: 1, optional: true },
    effects: [{ type: "forEach", selected: "c", effects: [{ type: "addCounter", target: S("__candidate"), counter: "token", amount: 1 }] }] }] },
  { id: "f-slow", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "speed", operation: "add", value: -1 }] },
  { id: "f-tok", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character", conditions: [{ type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] }, stat: "strength", operation: "add", value: 1 }],
    keywords: [{ selector: { controller: "self", type: "character", conditions: [{ type: "counterCompare", target: S("__candidate"), counter: "token", operator: ">=", value: 1 }] }, keyword: "covert" }] }
]);
// 134 God's Blessing of Moola
blessing("effd6ee4-acf3-413e-b2c9-c6d2332e807d", "blessing", [
  { id: "m-restore", type: "triggered", event: "cardRestored", condition: { type: "eventCardControlledBy", player: "controller" },
    effects: [cmod("eventCard", "strength", "add", -1, UEOT), draw(1)] },
  { id: "m-lock", type: "continuous", modifiers: [], restrictions: [{ selector: { controller: "self", type: "character" }, restriction: "cannotBeRestoredByRule" }] },
  { id: "m-turn", type: "triggered", event: "turnStarted", effects: [{ type: "forEachPlayer", order: "activeFirst", effects: [] }, { type: "forEach", selector: { controller: "self", type: "character" }, effects: [] }] }
]);
// NOTE: Moola's "inflict 1 to your faction and restore a character, repeat once per character you control" — the repeat-loop is not fully modelled (a concession); the trigger fires but its body is left minimal.
// 135 God's Blessing of Readiness
blessing("c71f0071-5ef8-4b3b-9356-149cad14c9bd", "blessing", [
  { id: "r-aura", type: "continuous", modifiers: [
    { selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: -1 },
    { selector: { controller: "self", type: "character" }, stat: "life", operation: "add", value: 1 } ] },
  { id: "r-turn", type: "triggered", event: "turnStarted", condition: { type: "not", condition: { type: "eventPlayerIs", player: "controller" } },
    effects: [{ type: "forEach", selector: { controller: "self", type: "character" }, effects: [{ type: "restore", target: S("__candidate") }] }] }
]);
// 136 God's Blessing of Transfiguration
blessing("2ec53fa7-6f07-4214-a2c4-d6b671c216f4", "blessing", [
  { id: "t-aura", type: "continuous", modifiers: [
    { selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 1 },
    { selector: { controller: "self", type: "character" }, stat: "life", operation: "add", value: -1 } ] },
  { id: "t-mill", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "cardTypeIs", target: "eventCard", cardType: "faction" }, { type: "cardTypeIs", target: { type: "damageSource" }, cardType: "character" }] },
    effects: [{ type: "mill", player: { type: "ownerOf", target: "eventCard" }, count: 1 }] }
]);

// 137 Gosche's Voidal Frequency Emission
P["410f05f6-5595-4aee-bc1a-8cce18ed809c"] = { flipUp: { cost: 2, threshold: "r" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { zone: "discard", owner: "self", type: "character" })],
    effects: [draw(1), { type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "On top of deck", effects: [{ type: "moveCard", target: S("c"), to: "deck", position: "top" }] },
      { label: "Into play face-down", effects: [{ type: "putIntoPlay", target: S("c"), controller: { type: "ownerOf", target: S("c") }, faceDown: true }] } ] }] }
] } };

// 138 Haunting Execution
P["f7cab292-794f-408f-ab81-99fb8000955e"] = { behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })], effects: [{ type: "destroy", target: S("c") }] },
  recur("g", 2, [{ type: "moveCard", target: S("c"), to: "hand" }], [pick("c", { zone: "discard", owner: "self", type: "character" })])
] } };
// NOTE: Haunting Execution "reduce numeric cost by 3 if >=4 characters in discard" — costAdjust needs the onPlay path; for a tactic the discount goes on the first ability's cost, not costAdjust. Concession: discount omitted.

// 139 Headshot
P["e98c5fe5-ad44-4541-94fe-ddc9eca924c7"] = { flipUp: { cost: 4, threshold: "r" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })],
    effects: [dmg(S("c"), 1),
      { type: "if", condition: { type: "not", condition: { type: "targetInZone", target: S("c"), zone: "play" } }, effects: [
        { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "c2", selector: { type: "character" }, count: 1, optional: true },
          effects: [{ type: "if", condition: { type: "targetExists", target: S("c2") }, effects: [dmg(S("c2"), 1),
            { type: "if", condition: { type: "not", condition: { type: "targetInZone", target: S("c2"), zone: "play" } }, effects: [
              { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "c3", selector: { type: "character" }, count: 1, optional: true },
                effects: [{ type: "if", condition: { type: "targetExists", target: S("c3") }, effects: [dmg(S("c3"), 1),
                  { type: "if", condition: { type: "not", condition: { type: "targetInZone", target: S("c3"), zone: "play" } }, effects: [
                    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "c4", selector: { type: "character" }, count: 1, optional: true },
                      effects: [{ type: "if", condition: { type: "targetExists", target: S("c4") }, effects: [dmg(S("c4"), 1)] }] } ] } ] }] } ] } ] }] } ] }
    ] }
] } };

// 140 Interpret the Void
P["a0136d6a-a42b-4cb6-bc8c-c0eee4026f95"] = { flipUp: { cost: 5, threshold: "oo" }, behavior: { abilities: [
  { id: "body", type: "activated", effects: [
    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "s", selector: { zone: "deck", owner: "self" }, count: 3, optional: true },
      effects: [{ type: "forEach", selected: "s", effects: [{ type: "moveCard", target: S("__candidate"), to: "void" }] }, { type: "shuffleDeck", player: "controller" }] },
    { type: "if", condition: { type: "deployedViaFlipUp" }, effects: [{ type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "t", selector: { zone: "void", type: "tactic" }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "t", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }] }] }
  ] }
] } };

// 141 Last Minute Weaponization
P["68bc2d1d-f025-4a2c-ae8c-584dc335f6eb"] = { flipUp: { cost: 2, threshold: "eeee" }, behavior: { abilities: [
  { id: "body", type: "activated", costs: [{ type: "destroy", target: S("it") }],
    targets: [pick("it", { type: "item", controller: "self" }), pick("c", { type: "character" })],
    variables: { x: { type: "cardCost", target: S("it") } },
    effects: [dmg(S("c"), { type: "add", values: [{ type: "variable", id: "x" }, 1] }),
      searchToHand({ type: "item", conditions: [{ type: "numberCompare", left: { type: "cardCost", target: S("__candidate") }, operator: "<=", right: { type: "variable", id: "x" } }] })] }
] } };

// 142 Lead the Assault
P["93dae733-8291-48be-88b2-b8a523340e89"] = { flipUp: { cost: 4, threshold: "e" }, behavior: { abilities: [
  { id: "body", type: "activated",
    targets: [pick("c", { type: "character", controller: "self", conditions: [{ type: "inBattle", target: S("__candidate"), role: "attacker" }] })],
    effects: [cmod(S("c"), "strength", "add", 2, UEOT), cmod(S("c"), "life", "add", 2, UEOT),
      { type: "if", condition: { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 2 },
        effects: [cmod(S("c"), "strength", "add", 2, UEOT), cmod(S("c"), "life", "add", 2, UEOT)] }] }
] } };

// 143 Limited Liability
P["da10bbbb-0cf4-4db8-847e-9a20d7fc2af0"] = { behavior: { abilities: [
  { id: "body", type: "activated", effects: [
    { type: "restrictDestruction", duration: UEOT },
    { type: "preventAllDamage", duration: UEOT } ] }
] } };

// 145 Moment of Annihilation
P["c35705f0-9e26-4e6d-a682-0ff4d029166f"] = { behavior: { abilities: [
  { id: "body", type: "activated",
    costs: [{ type: "sacrificeSelected", id: "rm", disposition: "removeFromGame" }],
    targets: [pick("rm", { zone: "discard", owner: "opponent", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "character" } }] }, 3, { optional: true }),
      pick("c", { type: "character" })],
    effects: [{ type: "if", condition: { type: "statCompare", target: S("c"), stat: "life", operator: "<=", value: 4 }, effects: [{ type: "destroy", target: S("c") }] }] }
] } };
// NOTE: Moment of Annihilation cost reduction ("reduce numeric cost by cards removed") omitted — costAdjust is an onPlay-only field. concession.

// 146 Overindulge
P["2a246a25-4b76-4ce3-9b98-bf3ac4ee5bfb"] = { behavior: { modes: [
  { label: "Lose 2 life", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", -2, UEOT)] },
  { label: "Lose 1 life, draw", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", -1, UEOT), draw(1)] }
] } };

// 147 Purloining Performance
P["ed4e38e3-0557-4bbf-92c3-6e02a2596bd3"] = { flipUp: { cost: 4, threshold: "d" }, behavior: { abilities: [
  { id: "body", type: "activated", effects: [
    { type: "lookAndReorder", chooser: "controller", player: "opponent", count: 4, to: "top" },
    { type: "if", condition: { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 2 },
      effects: [{ type: "mill", player: "opponent", count: 3 }] } ] }
] } };

// 148 Quotidian Assassination
P["0329f3b4-3d1b-4830-8826-e6c185ab152d"] = { behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })], effects: [{ type: "moveCard", target: S("c"), to: "hand" }] }
] } };

// 149 Quotidian Quagmire
P["e89bc47b-90e9-48c3-8da8-1ce22e2847e0"] = { behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })],
    effects: [
      { type: "chooserSelectsTarget", chooser: { type: "controllerOf", target: S("c") },
        declaration: { id: "r", selector: { type: "resource", attachedToFaction: true, controller: { type: "controllerOf", target: S("c") } }, count: 2, optional: true },
        effects: [{ type: "forEach", selected: "r", effects: [{ type: "detach", target: S("__candidate") }] }] },
      cmod(S("c"), "speed", "add", -1, UEOT), draw(1) ] }
] } };

// 150 Regroup & Reassess
P["d67e94e7-a40d-409b-b845-d6b1478458f0"] = { flipUp: { cost: 5, threshold: "g" }, behavior: { abilities: [
  { id: "body", type: "activated", effects: [draw(2),
    { type: "if", condition: { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 2 },
      effects: [draw(2), { type: "chooserSelectsTarget", chooser: "controller",
        declaration: { id: "d", selector: { zone: "hand", owner: "self" }, count: 1, optional: true },
        effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: S("__candidate"), to: "discard" }] }] }] }] }
] } };

// 151 Retreat to Mount Mulrich
P["b8f134f6-19d0-452a-8c5f-5b02ef1a2c75"] = { flipUp: { cost: 1, threshold: "d" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })], effects: [{ type: "rememberTarget", key: "safe", target: S("c") }] }
] } };
// NOTE: Retreat to Mount Mulrich "if it would leave play this turn, put into hand instead" — modelled as a rememberTarget marker only; the duration'd leave-play replacement is a concession left minimal.

// 152 Ritual of the Sucking Skull
P["f1f28210-b596-4182-a158-cfbb567e1700"] = { flipUp: { cost: 4, threshold: "o" }, behavior: { abilities: [
  { id: "body", type: "activated", condition: { type: "respondingTo", respondsTo: "card" },
    variables: { x: { type: "cardCost", target: "respondedToCard" } },
    effects: [{ type: "terminate", target: "respondedToCard" },
      { type: "if", condition: { type: "not", condition: { type: "deployedViaFlipUp" } }, effects: [{ type: "chooserSelectsTarget", chooser: { type: "controllerOf", target: "respondedToCard" },
        declaration: { id: "r", selector: { type: "resource", attachedToFaction: true, controller: { type: "controllerOf", target: "respondedToCard" } }, count: { type: "variable", id: "x" }, optional: true },
        effects: [{ type: "forEach", selected: "r", effects: [{ type: "detach", target: S("__candidate") }] }] }] }] }
] } };
// NOTE: "only in response to a card being deployed using FLIP UP" — the FLIP-UP-of-the-responded-card check is not expressible; narrowed to "in response to a card". concession.

// 153 Ritualized Destruction
P["a5f05d7e-999b-4e7a-a155-185997c75acf"] = { flipUp: { cost: 3, threshold: "o" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] })],
    effects: [{ type: "if", condition: { type: "textMentionsIcon", target: S("c"), icon: "volition" },
      effects: [{ type: "moveCard", target: S("c"), to: "void" }],
      elseEffects: [{ type: "moveCard", target: S("c"), to: "hand" }] }] }
] } };

// 154 Servers Unavailable
P["b6c2daaf-eb1c-438f-829c-8b66479468f7"] = { flipUp: { cost: 5, threshold: "eee", effects: [{ type: "createTokens", count: 1, controller: "controller",
  token: { name: "Micromajig", type: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }, behavior: { abilities: [
  { id: "body", type: "activated", condition: { type: "respondingTo", respondsTo: "card" }, effects: [{ type: "terminate", target: "respondedToCard" }] }
] } };

// 155,156 Single Combat (x2)
for (const sid of ["d32dd930-efd3-4f97-b95b-5b68a32cecd5", "0c879f7e-a01c-4e64-b0d7-a0d3cd6d73be"]) {
  P[sid] = { flipUp: { cost: 1, threshold: "rr" }, behavior: { abilities: [
    { id: "body", type: "activated", targets: [pick("c", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: S("__candidate"), cardType: "character" }, { type: "cardTypeIs", target: S("__candidate"), cardType: "location" }] }] })],
      effects: [{ type: "if", condition: { type: "textMentionsIcon", target: S("c"), icon: "volition" },
        effects: [dmg(S("c"), 6)], elseEffects: [dmg(S("c"), 2)] }] }
  ] } };
}

// 157 Strategic Vision
P["866cd820-dd86-4410-9c0e-0c0541e81e08"] = { behavior: { abilities: [
  { id: "body", type: "activated", effects: [
    { type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "s", distinctNames: true, selector: { zone: "deck", owner: "self", staple: true, type: "resource", conditions: [{ type: "not", condition: { type: "cardNameIs", target: S("__candidate"), name: "Greed" } }] }, count: 2, optional: true },
      effects: [{ type: "forEach", selected: "s", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }, { type: "shuffleDeck", player: "controller" }] },
    infl(1) ] }
] } };

// 158 Unaccustomed Inspection
P["cd2dd0f0-9a3a-4dd7-bafb-0464a3749a27"] = { flipUp: { cost: 2, threshold: "gg" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] })],
    effects: [{ type: "if", condition: { type: "textMentionsIcon", target: S("c"), icon: "volition" },
      effects: [{ type: "destroy", target: S("c") }],
      elseEffects: [infl({ type: "multiply", values: [{ type: "cardCost", target: S("c") }, -1] }), { type: "flipFaceDown", target: S("c") }] }] }
] } };

// 159 Undesirable Intrusion
P["cbffb937-448e-425e-ac37-fa1d856a07c8"] = { flipUp: { cost: 2, threshold: "e" }, behavior: { noResponse: true, abilities: [
  { id: "body", type: "activated", condition: { type: "respondingTo", respondsTo: "ability" },
    effects: [{ type: "terminate", target: "respondedItem" },
      { type: "destroy", target: "respondedAbilitySource" },
      { type: "createTokens", count: 1, controller: { type: "controllerOf", target: "respondedAbilitySource" },
        token: { name: "Micromajig", type: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }
] } };

// 160 Volatile Communion
P["9f484c55-827e-4a25-a025-6f91743c7fae"] = { flipUp: { cost: 1, threshold: "o" }, behavior: { abilities: [
  { id: "body", type: "activated",
    costs: [{ type: "depleteSelected", id: "d" }],
    targets: [pick("d", { type: "character", controller: "self" }, { type: "variable", id: "x" }, { optional: true })],
    effects: [{ type: "lookAndReorder", chooser: "controller", player: "controller", count: { type: "add", values: [{ type: "variable", id: "x" }, 2] }, to: "split" }] }
] } };

// 161 Wary Reunion
P["a6c17ded-973a-4bc4-b458-179f5e1c723e"] = { flipUp: { cost: 2, threshold: "d" }, behavior: { abilities: [
  { id: "body", type: "activated",
    variables: { x: { type: "distinctCount", by: "trade", selector: { controller: "self" } } },
    targets: [pick("c", { type: "character" })],
    effects: [{ type: "if", condition: { type: "statCompare", target: S("c"), stat: "life", operator: "<=", value: { type: "variable", id: "x" } }, effects: [{ type: "removeFromGame", target: S("c") }] }] }
] } };

// 162 Wasted Wickedness
P["feb21afe-1749-4041-b5b0-0586c4bc4964"] = { behavior: { abilities: [
  { id: "body", type: "activated",
    variables: { x: { type: "distinctCount", by: "name", selector: { controller: "opponent", staple: true, type: "resource" } } },
    costs: [{ type: "payResources", amount: { type: "multiply", values: [{ type: "variable", id: "x" }, 2] } }],
    effects: [{ type: "chooserSelectsTarget", chooser: "opponent",
      declaration: { id: "m", selector: { controller: "opponent", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: S("__candidate"), cardType: "resource" } }] }, count: { type: "variable", id: "x" }, optional: true },
      effects: [{ type: "forEach", selected: "m", effects: [{ type: "moveCard", target: S("__candidate"), to: "hand" }] }] }] }
] } };

// 163 Whistleblower Policy
P["d8c5ed80-7717-49e6-b881-a626bb7e6007"] = { flipUp: { cost: 3, threshold: "g" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("loc", { type: "location" }, 1, { optional: true })],
    effects: [
      { type: "if", condition: { type: "targetExists", target: S("loc") }, effects: [dmg(S("loc"), 3)] },
      { type: "if", condition: { type: "deployedViaFlipUp" }, effects: [draw({ type: "distinctCount", by: "name", selector: { controller: "self", staple: true, type: "resource" } })] }
    ] }
] } };

// 164 Wily Circumvention
P["0beca33c-dd54-4470-a118-e07958ec3cba"] = { flipUp: { cost: 1, threshold: "e" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character", depleted: true })],
    effects: [{ type: "skipNextRestore", target: S("c") }] }
] } };

// 165 Zenobia's Intervention
P["bbc53a75-6d0b-48fe-b1cc-0334cb0f478d"] = { behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character" })],
    effects: [
      cmod(S("c"), "strength", "add", { type: "distinctCount", by: "name", selector: { controller: "self", staple: true, type: "resource" } }, UEOT),
      cmod(S("c"), "life", "add", { type: "distinctCount", by: "name", selector: { controller: "self", staple: true, type: "resource" } }, UEOT) ] }
] } };

// 166 Zenobia's Succor
P["f9372755-6c19-4d67-85ba-c73c259e6b2c"] = { behavior: { modes: [
  { label: "[O] covert", condition: iconGate("obsession", 1), targets: [pick("c", { type: "character" })], effects: [grantKw(S("c"), "covert", UEOT)] },
  { label: "[G] +2 life", condition: iconGate("greed", 1), targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", 2, UEOT)] },
  { label: "[E] aggro", condition: iconGate("elitism", 1), targets: [pick("c", { type: "character" })], effects: [grantKw(S("c"), "aggro", UEOT)] },
  { label: "[D] +1 speed", condition: iconGate("deception", 1), targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "speed", "add", 1, UEOT)] },
  { label: "[R] +2 strength", condition: iconGate("rage", 1), targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", 2, UEOT)] }
] } };

// 167 Zenobian Mechanics Explained
P["e1c896c0-6e2b-46af-9dbb-008146423145"] = { flipUp: { cost: 4, threshold: "o" }, behavior: { abilities: [
  { id: "body", type: "activated", targets: [pick("c", { type: "character", controller: "opponent" })],
    effects: [{ type: "moveCard", target: S("c"), to: "hand" },
      { type: "if", condition: { type: "numberCompare", left: { type: "battlePartySize", side: "attacking" }, operator: ">=", right: 2 },
        effects: [{ type: "chooserSelectsTarget", chooser: { type: "controllerOf", target: S("c") },
          declaration: { id: "d", selector: { zone: "hand", owner: { type: "controllerOf", target: S("c") } }, count: 1, optional: true },
          effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: S("__candidate"), to: "discard" }] }] }] }] }
] } };

// ==================== apply ====================
let n = 0;
for (const [id, patch] of Object.entries(P)) {
  const card = byId.get(id);
  if (!card) throw new Error("no card for id " + id + " (" + (patch.name || "?") + ")");
  if (patch.behavior) card.behavior = patch.behavior;
  if (patch.flipUp) card.flipUp = patch.flipUp;
  if (patch.unique !== undefined) card.unique = patch.unique;
  if (patch.attachTo !== undefined) card.attachTo = patch.attachTo;
  if (patch.thresholdSlack !== undefined) card.thresholdSlack = patch.thresholdSlack;
  n++;
}
// Drainbow Crash — PROVIDES [E][E]
const drain = byId.get("d99c85ec-5f5b-4afb-9059-c1c326bf8fdf");
drain.resource = { provides: ["elitism", "elitism"], staple: false };

fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
console.log("patched " + n + " Ungodly Mess cards");
