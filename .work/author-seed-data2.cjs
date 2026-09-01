/* Seed per-card data, part 2: locations, items, tactics, PROVIDES resources. */
const H = require("./author-seed.cjs");
const {
  P, V, VANILLA, KW, S, CAND, UEOT, PERM, WSIP, USNT, cmod, mod, cnt, negCnt, icons, iconGate,
  dmg, draw, infl, pick, grantKw, suppressKw, grantRes, moveTo, destroy, deplete, restore,
  addTok, rmTok, factionOf, ifExists, cardCost, eventDmg, payR, rfg, etb, leaves, toDiscardFromPlay,
  onAttack, onBlock, onDealBattleDmg, startTurn, startEachTurn, mayPick, oppMayDraw, youMayDraw,
  oppDiscards, discardFromOppHand, searchToHand, searchOppDeck, recur, iconPump, contIcon,
  mayPayToken, tokenBuff
} = H;
const B = abilities => ({ abilities });
const MICRO = { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 };
// "[icons]: At the start of your turn, <effects>" tier on a location
const tier = (id, icon, n, effects) => startTurn(id, effects, { icon, n });

// =====================================================================
// LOCATIONS
// =====================================================================

// 53cur17y 5y573m — COVERT parties can be blocked by non-COVERT characters; FLIP UP 2 [E]
V("7e73ff48-a894-408a-a176-76bedfebc97d", {
  flipUp: { cost: 2, threshold: "e" },
  notes: "'COVERT parties can be blocked by characters without COVERT' = grant canBlockCovert to every character.",
  shapes: ["continuous: grant keyword canBlockCovert to {type:character, controller:any}", "flip-up 2 [E]"],
  behavior: B([{ id: "open-covert", type: "continuous", modifiers: [], keywords: [{ selector: { type: "character", controller: "any" }, keyword: "canBlockCovert" }] }])
});

// Cryptic Athenaeum — UNIQUE; 3 start-of-turn tiers ([O][O][O] / x5 / x7)
V("12b6d2a3-5b34-4914-bcc4-20ddb1ad39ba", {
  unique: "cryptic athenaeum",
  shapes: ["3 turnStarted (controller) tiers gated [O]x3/x5/x7: (may draw -> opp may draw) / (opp discards a card) / (may pick char -> owner hand)"],
  behavior: B([
    tier("t3", "obsession", 3, [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Draw", effects: [draw(1), oppMayDraw(1)] }] }]),
    tier("t5", "obsession", 5, [oppDiscards(1)]),
    tier("t7", "obsession", 7, [mayPick("c", { type: "character" }, [moveTo(S("c"), "hand")])])
  ])
});

// Department of Rejections — opponents pay 2 to search their deck / to use a character's ability; FLIP UP 1 [G]
V("0b6dc892-f833-4ab1-b1c5-c185ff0ca0f1", {
  flipUp: { cost: 1, threshold: "g" },
  caps: ["search-tax", "ability-cost-modifier-opponent-characters"],
  shapes: ["continuous searchTax {opponent, 2}", "continuous abilityCostModifiers [{scope:opponentCharacters, delta:2}]", "flip-up 1 [G]"],
  behavior: B([{
    id: "red-tape", type: "continuous", modifiers: [],
    searchTax: { player: "opponent", amount: 2 },
    abilityCostModifiers: [{ scope: "opponentCharacters", delta: 2 }]
  }])
});

// Domain of Depravity — start of your turn may pick char -> token; all chars lose 1/1/1 per token on them
V("4424b7eb-6283-4fdc-9852-a820d5405f48", {
  shapes: ["turnStarted (controller) -> mayPick character -> addCounter token", "continuous aura: all characters str/life/speed -= counter(token on __candidate)"],
  behavior: B([
    startTurn("mark", [mayPick("c", { type: "character" }, [addTok(S("c"), 1)])], {}),
    { id: "drag", type: "continuous", modifiers: ["strength", "life", "speed"].map(stat => ({ selector: { type: "character" }, stat, operation: "add", value: negCnt(CAND, "token") })) }
  ])
});

// Drill Garrison — UNIQUE; 3 tiers ([R]x3/x5/x7)
V("0dfc144b-12b2-472c-b7af-8c7bbf815a0e", {
  unique: "drill garrison",
  shapes: ["3 turnStarted (controller) tiers gated [R]x3/x5/x7: (may 1 dmg to opp faction) / (may pick char -> deplete) / (may pick char -> 2 dmg)"],
  behavior: B([
    tier("t3", "rage", 3, [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "1 damage", effects: [dmg(factionOf("opponent"), 1)] }] }]),
    tier("t5", "rage", 5, [mayPick("c", { type: "character" }, [deplete(S("c"))])]),
    tier("t7", "rage", 7, [mayPick("c", { type: "character" }, [dmg(S("c"), 2)])])
  ])
});

// Gambling Den — start of your turn: reveal top; if cost<=3 each player may draw, else each player may play a resource
V("ee8821d4-4933-4e4b-a632-c4db1b91ea95", {
  shapes: ["turnStarted (controller): if cardCost(top)<=3 -> forEachPlayer chooserSelectsOption[draw]; else forEachPlayer chooserSelectsOption[playResource]"],
  behavior: B([startTurn("wheel", [
    { type: "if", condition: { type: "numberCompare", left: cardCost({ type: "deckPosition", player: "controller", from: "top", index: 0 }), operator: "<=", right: 3 },
      effects: [{ type: "forEachPlayer", effects: [{ type: "chooserSelectsOption", chooser: "activePlayer", options: [{ label: "Decline", effects: [] }, { label: "Draw", effects: [draw(1, "activePlayer")] }] }] }] },
    { type: "if", condition: { type: "numberCompare", left: cardCost({ type: "deckPosition", player: "controller", from: "top", index: 0 }), operator: ">", right: 3 },
      effects: [{ type: "forEachPlayer", effects: [{ type: "chooserSelectsOption", chooser: "activePlayer", options: [{ label: "Decline", effects: [] }, { label: "Play a resource", effects: [{ type: "playResource", player: "activePlayer" }] }] }] }] }
  ], {})])
});

// Hall of Conventions — UNIQUE; 3 tiers ([E]x3/x5/x7)
V("78d1d283-421a-41f1-9bd9-c6a30f391821", {
  unique: "hall of conventions",
  shapes: ["3 turnStarted (controller) tiers gated [E]x3/x5/x7: reduceNextCost 1 / (may pick char -> +2/+2 UEOT) / (may play a resource)"],
  behavior: B([
    tier("t3", "elitism", 3, [{ type: "reduceNextCost", player: "controller", amount: 1 }]),
    tier("t5", "elitism", 5, [mayPick("c", { type: "character" }, [cmod(S("c"), "strength", "add", 2, UEOT), cmod(S("c"), "life", "add", 2, UEOT)])]),
    tier("t7", "elitism", 7, [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Play a resource", effects: [{ type: "playResource", player: "controller" }] }] }])
  ])
});

// Heist Training Grounds — UNIQUE; 3 tiers ([D]x3/x5/x7)
V("8791105b-7df3-4998-aa65-ab966d007869", {
  unique: "heist training grounds",
  shapes: ["3 turnStarted (controller) tiers gated [D]x3/x5/x7: (may pick char -> covert UEOT) / (may search opp deck -> their discard) / (opp discards at random)"],
  behavior: B([
    tier("t3", "deception", 3, [mayPick("c", { type: "character" }, [grantKw(S("c"), "covert", UEOT)])]),
    tier("t5", "deception", 5, [searchOppDeck({}, "discard")]),
    tier("t7", "deception", 7, [oppDiscards(1, true)])
  ])
});

// High Court of Demands — ETB draw; opponents cannot attack your faction
V("61688c92-96d1-40ae-ac64-2975d292b0d9", {
  caps: ["prevent-attack-on-faction"],
  shapes: ["ETB: draw 1", "continuous preventsAttackOnFaction {self}"],
  behavior: B([etb([draw(1)]), { id: "no-fac-attack", type: "continuous", modifiers: [], preventsAttackOnFaction: { player: "self" } }])
});

// Lordly Stables — when an attacking char you control inflicts battle dmg to a char, +1
V("7e50ae37-dd2d-49f6-825d-91ab278e3a4e", {
  shapes: ["continuous damageModifiers: sourceSelector {controller:self, attacker}, target characters, battleOnly, +1"],
  behavior: B([{ id: "rally", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "character" }, sourceSelector: { controller: "self", type: "character", conditions: [{ type: "inBattle", target: CAND, role: "attacker" }] }, battleOnly: true, delta: 1 }] }])
});

// Luxurious Gaming Establishment — start of your turn may pick char -> -1 speed this turn
V("f1451fa0-b4bf-4b88-a0c7-f18629af4abd", {
  shapes: ["turnStarted (controller) -> mayPick character -> createModifier speed -1 UEOT"],
  behavior: B([startTurn("slow", [mayPick("c", { type: "character" }, [cmod(S("c"), "speed", "add", -1, UEOT)])], {})])
});

// Marduun Baitings and Loan — UNIQUE; 3 tiers ([G]x3/x5/x7)
V("30363637-822a-424d-84b4-4ec05b79c6b0", {
  unique: "marduun baitings and loan",
  shapes: ["3 turnStarted (controller) tiers gated [G]x3/x5/x7: (+2 influence) / (draw 1, discard 1) / (draw 1)"],
  behavior: B([
    tier("t3", "greed", 3, [infl(2)]),
    tier("t5", "greed", 5, [draw(1), { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d", selector: { owner: "self", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d", effects: [moveTo(CAND, "discard")] }] }]),
    tier("t7", "greed", 7, [draw(1)])
  ])
});

// Mighty Ballista — enters depleted; FIRE!: choose X, pay X, deplete self, pick char/loc -> X dmg to it + X dmg to this
V("d1ac8d42-b086-471a-8d66-e4ef475f9558", {
  shapes: ["ETB: deplete self (enters depleted)", "activated FIRE!: variable x; pay x + deplete self; pick char/loc -> dealDamage x to it + dealDamage x to source"],
  behavior: B([
    etb([deplete("source")]),
    {
      id: "fire", type: "activated",
      variables: { x: 0 },
      variableBounds: { x: { min: 0 } },
      costs: [payR({ type: "variable", id: "x" }), deplete("source")],
      targets: [pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "cardTypeIs", target: CAND, cardType: "location" }] }] })],
      effects: [dmg(S("t"), { type: "variable", id: "x" }), dmg("source", { type: "variable", id: "x" })]
    }
  ])
});

// Mirthless Altar — start of each player's turn, may pick char -> -1 strength this turn
V("9e0f839e-f482-42b1-b6d4-4c19dbdcd70a", {
  shapes: ["turnStarted (any) -> mayPick character -> createModifier strength -1 UEOT"],
  behavior: B([startEachTurn("weaken", [mayPick("c", { type: "character" }, [cmod(S("c"), "strength", "add", -1, UEOT)])])])
});

// Narrow Passage — players can attack only once each turn
V("a29a0fb1-c505-410f-8a78-55380f603326", {
  caps: ["player-attack-limit"],
  shapes: ["continuous attackLimitPerTurn 1"],
  behavior: B([{ id: "chokepoint", type: "continuous", modifiers: [], attackLimitPerTurn: 1 }])
});

// The Currency Bazaar — TRADE: pay1 + discard a resource -> search deck for a staple resource -> hand; RECUR [G]
V("46d55ff2-289d-4722-8ce0-6c5aba7e46c6", {
  shapes: ["activated TRADE: pay1 + discard a resource -> search deck for a staple resource -> hand", "RECUR [G]: pay3 + exile self -> search deck for card named 'The Currency Bazaar' -> hand"],
  behavior: B([
    { id: "trade", type: "activated", costs: [payR(1), { type: "discard", id: "dr", player: "controller", selector: { owner: "self", zone: "hand", type: "resource" }, count: 1 }], effects: [searchToHand({ type: "resource", staple: true }, false)] },
    recur("g", 3, [searchToHand({ name: "The Currency Bazaar" }, false)])
  ])
});

// Theocratic Senate of Marduun — UNIQUE; opponents cannot attack your faction; when a char inflicts dmg to this, same dmg back
V("9f06b372-48a0-49eb-a2df-a4c5c923694b", {
  unique: "theocratic senate of marduun",
  caps: ["prevent-attack-on-faction"],
  shapes: ["continuous preventsAttackOnFaction {self}", "triggered damageDealt to source by a character -> dealDamage eventDamageAmount back to that character"],
  behavior: B([
    { id: "no-fac-attack", type: "continuous", modifiers: [], preventsAttackOnFaction: { player: "self" } },
    { id: "retort", type: "triggered", event: "damageDealt", condition: { type: "and", conditions: [{ type: "eventCardIs", target: "source" }, { type: "cardTypeIs", target: { type: "damageSource" }, cardType: "character" }] }, effects: [dmg({ type: "damageSource" }, eventDmg())] }
  ])
});

// Time Portal — start of your turn, may put a Micromajig token into play
V("74fbda20-68db-4e19-91e9-d621f0bee9f7", {
  shapes: ["turnStarted (controller) -> chooserSelectsOption[decline / createTokens Micromajig 1]"],
  behavior: B([startTurn("spawn", [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Make a Micromajig", effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICRO }] }] }], {})])
});

// Treasure Brokerage — when a char enters play under your control, may pay1 -> search deck for a staple resource -> hand
V("a691d84a-b0b0-4590-9333-698c448e3062", {
  shapes: ["triggered cardEnteredPlay (char, controller) -> mayPay 1 -> search deck for a staple resource -> hand"],
  behavior: B([{
    id: "broker", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "controller" }] },
    effects: [{ type: "mayPay", player: "controller", costs: [payR(1)], effects: [searchToHand({ type: "resource", staple: true }, false)], elseEffects: [] }]
  }])
});

// Watchtower — UNIQUE; when a char enters play under an opponent's control, 1 dmg to it
V("b92743d8-0593-4d1a-87c2-9dc5b4520945", {
  unique: "watchtower",
  shapes: ["triggered cardEnteredPlay (char, opponent) -> dealDamage 1 to eventCard"],
  behavior: B([{
    id: "sniper", type: "triggered", event: "cardEnteredPlay",
    condition: { type: "and", conditions: [{ type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "opponent" }] },
    effects: [dmg("eventCard", 1)]
  }])
});

// Workshop — CONSTRUCT: pay3 + exile a card in discard -> may search deck for a card of same type -> top of deck
V("3ef1aa24-c030-4c3f-8970-1c291e8c8a79", {
  shapes: ["activated CONSTRUCT: pay3 + moveSelected {id:rem} discard->removed; search deck for a card with cardTypeEquals(rem) -> deck top"],
  behavior: B([{
    id: "construct", type: "activated",
    costs: [payR(3), { type: "moveSelected", id: "rem", player: "controller", selector: { owner: "self", zone: "discard" }, count: 1, to: "removed" }],
    effects: [{
      type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "found", selector: { owner: "self", zone: "deck", conditions: [{ type: "cardTypeEquals", target: CAND, other: S("rem") }] }, count: 1, optional: true },
      effects: [{ type: "forEach", selected: "found", effects: [moveTo(CAND, "deck", { position: "top" })] }, { type: "shuffleDeck", player: "controller" }]
    }]
  }])
});

// =====================================================================
// ITEMS
// =====================================================================

// Auspicious Tax — ATTACH TO CHARACTER; attached char's controller must pay 3 to attack with it
V("95b246cb-d25a-44c2-84ae-fc1e5ec73389", {
  attachTo: "character", caps: ["attack-tax-attacker-scope"],
  shapes: ["attachTo character", "continuous attackTax {activePlayer, 3, requiresAttackerMatch: isCard(candidate, attachedTo)}"],
  behavior: B([{
    id: "toll", type: "continuous", modifiers: [],
    attackTax: { player: "activePlayer", amount: 3, requiresAttackerMatch: { conditions: [{ type: "isCard", target: CAND, other: "attachedTo" }] } }
  }])
});

// B14nd P3pp3r — ATTACH: +1/+1; SPIT OUT: destroy self + pick char -> this turn +1/+1
V("cf351c97-aab8-46a2-bbe2-450bcde65738", {
  attachTo: "character",
  shapes: ["attachTo character; continuous +1/+1 on attachedTo", "activated SPIT OUT: destroy self; pick char -> +1/+1 UEOT"],
  behavior: B([
    { id: "boost", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 1), mod("attachedTo", "life", "add", 1)] },
    { id: "spit", type: "activated", costs: [destroy("source")], targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", 1, UEOT), cmod(S("c"), "life", "add", 1, UEOT)] }
  ])
});

// Cashier's Window — CASH IN: destroy a character you control + deplete self -> draw
V("0fc953a8-49f8-4b24-a053-502c3fb923ac", {
  shapes: ["activated CASH IN: destroy a character you control + deplete self -> draw 1"],
  behavior: B([{
    id: "cash-in", type: "activated",
    targets: [pick("c", { type: "character", controller: "self" })],
    costs: [destroy(S("c")), deplete("source")],
    effects: [draw(1)]
  }])
});

// Claywork Compendium — RESEARCH: deplete self -> reduce next numeric cost by 2; FLIP UP 5 [E][E]
V("60bc13df-5cc4-49a6-b6a4-8b986c4cbbfc", {
  flipUp: { cost: 5, threshold: "ee" },
  shapes: ["activated RESEARCH: deplete self -> reduceNextCost 2", "flip-up 5 [E][E]"],
  behavior: B([{ id: "research", type: "activated", costs: [deplete("source")], effects: [{ type: "reduceNextCost", player: "controller", amount: 2 }] }])
});

// Cunning Disguise — ATTACH: -1/-1, gain COVERT; FLIP UP 0 [D][D]
V("e6906da0-c721-455f-ba6a-7a4496d85264", {
  attachTo: "character", flipUp: { cost: 0, threshold: "dd" },
  shapes: ["attachTo character; continuous str/life -1 + keyword covert on attachedTo", "flip-up 0 [D][D]"],
  behavior: B([{ id: "cloak", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", -1), mod("attachedTo", "life", "add", -1)], keywords: [{ target: "attachedTo", keyword: "covert" }] }])
});

// Fiendish Fez — ATTACH: -2 str, cannot attack; MOVE: (not during battle) pay3 + pick char -> re-attach
V("0b55606d-d7fe-4e34-810d-7d86cce077e7", {
  attachTo: "character",
  shapes: ["attachTo character; continuous str -2 + restriction cannotAttack on attachedTo", "activated MOVE: condition !battleActive; pay3; pick char -> attachTo"],
  behavior: B([
    { id: "hex", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", -2)], restrictions: [{ target: "attachedTo", restriction: "cannotAttack" }] },
    { id: "move", type: "activated", condition: { type: "not", condition: { type: "battleActive" } }, costs: [payR(3)], targets: [pick("c", { type: "character" })], effects: [{ type: "attachTo", target: "source", to: S("c") }] }
  ])
});

// Flailing Knife — ATTACH: +2 str; when put into discard from play, may choose card type -> reveal top; if that type re-attach; top->bottom
V("e7405d47-49f3-4b3a-adb5-1444fc726135", {
  attachTo: "character", conf: "medium",
  notes: "'choose a card type' as chooserSelectsOption over the 5 types; each -> if top card is that type, put this into play attached to a chosen character; top->bottom.",
  shapes: ["attachTo character; continuous str +2 on attachedTo", "triggered cardMoved (self play->discard) -> chooserSelectsOption(5 types) each -> if top is that type, deployFromZone self attached + pick a character; top->bottom"],
  behavior: B([
    { id: "edge", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 2)] },
    toDiscardFromPlay("reattach", [{
      type: "chooserSelectsOption", chooser: "controller",
      options: ["character", "item", "location", "tactic", "resource"].map(t => ({
        label: t,
        effects: [
          { type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: t }, effects: [
            { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "host", selector: { type: "character" }, count: 1, optional: true }, effects: [ifExists("host", [{ type: "putIntoPlay", target: "source", controller: "controller" }, { type: "attachTo", target: "source", to: S("host") }])] }
          ] },
          moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "deck", { position: "bottom" })
        ]
      }))
    }])
  ])
});

// H07 P3pp3r — ATTACH: +2/+2; SPIT OUT: destroy self + pick <=2 chars -> restore them
V("63913bf7-a277-4eda-970c-b0f060d46d23", {
  attachTo: "character",
  shapes: ["attachTo character; continuous +2/+2 on attachedTo", "activated SPIT OUT: destroy self; pick 2-or-fewer chars -> restore each"],
  behavior: B([
    { id: "boost", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 2), mod("attachedTo", "life", "add", 2)] },
    { id: "spit", type: "activated", costs: [destroy("source")], targets: [pick("cs", { type: "character" }, 2, { optional: true })], effects: [{ type: "forEach", selected: "cs", effects: [restore(CAND)] }] }
  ])
});

// Heavy Sword — ATTACH: +2 str; [R]x4: attached +2 str; HANDOFF: pay4 + deplete a char not in battle -> re-attach
V("4f12295b-4ef4-458e-95bc-55998b69dc63", {
  attachTo: "character",
  shapes: ["attachTo character; continuous str +2 on attachedTo", "activated (threshold [R]x4): createModifier str +2 permanent on attachedTo", "activated HANDOFF: pay4 + deplete a controlled char not in battle -> attachTo"],
  behavior: B([
    { id: "edge", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 2)] },
    { id: "sharpen", type: "activated", threshold: "rrrr", effects: [cmod("attachedTo", "strength", "add", 2, PERM)] },
    { id: "handoff", type: "activated", targets: [pick("h", { type: "character", controller: "self", conditions: [{ type: "not", condition: { type: "inBattle", target: CAND } }] })], costs: [payR(4), deplete(S("h"))], effects: [{ type: "attachTo", target: "source", to: S("h") }] }
  ])
});

// Hidden Dagger — ATTACH TACTICAL: +1 str; HANDOFF: deplete a char not in battle -> re-attach; FLIP UP 1 [D]
V("7ff74ee6-da99-4240-8186-c04dda01a4d7", {
  attachTo: "character", flipUp: { cost: 1, threshold: "d" }, meta: { keywords: ["tactical"] },
  shapes: ["attachTo character; keyword tactical; continuous str +1 on attachedTo", "activated HANDOFF: deplete a controlled char not in battle -> attachTo", "flip-up 1 [D]"],
  behavior: {
    keywords: ["tactical"],
    abilities: [
      { id: "edge", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 1)] },
      { id: "handoff", type: "activated", targets: [pick("h", { type: "character", controller: "self", conditions: [{ type: "not", condition: { type: "inBattle", target: CAND } }] })], costs: [deplete(S("h"))], effects: [{ type: "attachTo", target: "source", to: S("h") }] }
    ]
  }
});

// Hungry-Hungry Idol — FEED: pay1 + pick char -> this turn +1 life; faction loses 1 influence
V("eb9b7351-5790-4ae9-928a-c2669a44f349", {
  shapes: ["activated FEED: pay1; pick char -> createModifier life +1 UEOT; modifyInfluence -1"],
  behavior: B([{ id: "feed", type: "activated", costs: [payR(1)], targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", 1, UEOT), infl(-1)] }])
});

// Intellectual Reliquary — IMBIBE: pay1 + deplete self -> look at top 3, may take a tactic -> hand, rest to bottom
V("32c1ba5b-4c61-4b63-9bb8-305910aa6202", {
  conf: "medium",
  notes: "'Look at the top 3, you may choose a tactic among them -> hand, remaining on bottom in any order' modelled as lookAndReorder count 3 to:'bottom' (scry) — CONCESSION: the specific 'take a tactic to hand' pick is approximated by the reorder-to-bottom (player still sees all 3 and orders them).",
  shapes: ["activated IMBIBE: pay1 + deplete self -> lookAndReorder count 3 to:bottom"],
  behavior: B([{ id: "imbibe", type: "activated", costs: [payR(1), deplete("source")], effects: [{ type: "lookAndReorder", player: "controller", count: 3, to: "bottom" }] }])
});

// Lucky Charm — ETB draw; opponents must pay 1 to pick a character you control (CONCESSION: pick-tax unmodelled)
V("209f6903-153c-455b-b211-b7fa87571220", {
  conf: "medium", parityGaps: [],
  notes: "CONCESSION: 'Your opponents must pay 1 to pick a character you control' is not modelled (no per-pick resource-tax hook). ETB draw is authored. See capabilities backlog 'pick-tax'.",
  shapes: ["ETB: draw 1", "CONCESSION: opponent pick-tax unmodelled"],
  behavior: B([etb([draw(1)])])
});

// Muddle Bugs — BINGE: deplete self + pick char -> token on it; destroy if it has >= cardCost tokens
V("0602ab86-73eb-4ca4-bf7f-c6149e75b88b", {
  shapes: ["activated BINGE: deplete self; pick char -> addCounter token; if counterCompare(token >= cardCost) destroy"],
  behavior: B([{
    id: "binge", type: "activated", costs: [deplete("source")], targets: [pick("c", { type: "character" })],
    effects: [addTok(S("c"), 1), { type: "if", condition: { type: "counterCompare", target: S("c"), counter: "token", operator: ">=", value: cardCost(S("c")) }, effects: [destroy(S("c"))] }]
  }])
});

// Mysterious Invasion — OVERWHELM: deplete self + destroy 2 chars you control + pick char -> destroy it
V("4a1b7a38-e010-4d55-9ba4-5d5ebacc4775", {
  shapes: ["activated OVERWHELM: deplete self + sacrificeSelected 2 chars you control (destroy); pick char -> destroy"],
  behavior: B([{
    id: "overwhelm", type: "activated",
    targets: [pick("kill", { type: "character" }), pick("fodder", { type: "character", controller: "self" }, 2)],
    costs: [deplete("source"), { type: "sacrificeSelected", declarationId: "fodder", disposition: "destroy" }],
    effects: [destroy(S("kill"))]
  }])
});

// Obscene Communion — start of each player's turn, that player chooses one of 4 options (each: forEachPlayer ...)
V("604a992d-9d16-41db-b9f7-7face9e9a3da", {
  shapes: ["triggered turnStarted (any) -> chooserSelectsOption(4) chooser activePlayer: opt1 each draw+bottom / opt2 each resource->hand + may play resource / opt3 each discard / opt4 each top-a-card"],
  behavior: B([startEachTurn("communion", [{
    type: "chooserSelectsOption", chooser: "activePlayer",
    options: [
      { label: "Draw & bottom", effects: [{ type: "forEachPlayer", effects: [draw(1, "activePlayer"), { type: "chooserSelectsTarget", chooser: "activePlayer", declaration: { id: "b", selector: { owner: "activePlayer", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "b", effects: [moveTo(CAND, "deck", { position: "bottom" })] }] }] }] },
      { label: "Bounce a resource, may replay", effects: [{ type: "forEachPlayer", effects: [{ type: "chooserSelectsTarget", chooser: "activePlayer", declaration: { id: "r", selector: { owner: "activePlayer", type: "resource", zone: "play" }, count: 1, optional: true }, effects: [{ type: "forEach", selected: "r", effects: [moveTo(CAND, "hand")] }] }, { type: "chooserSelectsOption", chooser: "activePlayer", options: [{ label: "Decline", effects: [] }, { label: "Play a resource", effects: [{ type: "playResource", player: "activePlayer" }] }] }] }] },
      { label: "Each discards", effects: [{ type: "forEachPlayer", effects: [{ type: "chooserSelectsTarget", chooser: "activePlayer", declaration: { id: "d", selector: { owner: "activePlayer", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d", effects: [moveTo(CAND, "discard")] }] }] }] },
      { label: "Each tops a card", effects: [{ type: "forEachPlayer", effects: [{ type: "chooserSelectsTarget", chooser: "activePlayer", declaration: { id: "t", selector: { owner: "activePlayer", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "t", effects: [moveTo(CAND, "deck", { position: "top" })] }] }] }] }
    ]
  }])])
});

// P3pp3r 0f 1n54n17y — ATTACH: +3/+3; at start of each opp turn restore attached char; SPIT OUT: destroy self + pick char -> +3/+3 UEOT + restore
V("85f2ffda-8d98-4da2-80c6-3d7f0d0b0a6b", {
  attachTo: "character",
  shapes: ["attachTo character; continuous +3/+3 on attachedTo", "triggered turnStarted (opponent) -> restore attachedTo", "activated SPIT OUT: destroy self; pick char -> +3/+3 UEOT + restore"],
  behavior: B([
    { id: "boost", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 3), mod("attachedTo", "life", "add", 3)] },
    startTurn("recharge", [restore("attachedTo")], { who: "opponent" }),
    { id: "spit", type: "activated", costs: [destroy("source")], targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", 3, UEOT), cmod(S("c"), "life", "add", 3, UEOT), restore(S("c"))] }
  ])
});

// Phalludrix, the Impotenator — UNIQUE; discard-redirect replacement; EQUIP; +2 str; start of each opp turn may restore
V("b0ad296c-f76a-4df7-be3a-639662c664b5", {
  unique: "phalludrix", attachTo: "character", conf: "medium",
  notes: "'When an effect controlled by an opponent causes you to discard any number of cards, you may put them back' = a ReplacementAbility on moveToZone zone:hand? modelled as replaces moveToZone zone:'discard', controlledBy:'self', by:'opponent', optional -> moveCard back to hand. EQUIP: conditional X cost (0 if adriel, else 3).",
  shapes: ["replacement moveToZone discard (self card, by opponent), optional -> moveCard hand", "attachTo character (EQUIP): variable x = 0 if adriel else 3; pay x -> attachTo", "continuous str +2 on attachedTo", "triggered turnStarted (opponent) -> chooserSelectsOption[decline / restore attachedTo]"],
  behavior: {
    onPlay: {
      targets: [pick("eq", { type: "character" })],
      costs: [payR({ type: "conditional", if: { type: "cardSubtypeIs", target: S("eq"), subtype: "adriel" }, then: 0, else: 3 })],
      effects: []
    },
    abilities: [
      { id: "equip", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "attachTo", target: "source", to: S("eq") }] },
      { id: "boost", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 2)] },
      startTurn("recharge", [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Restore", effects: [restore("attachedTo")] }] }], { who: "opponent" }),
      { id: "clawback", type: "replacement", replaces: { event: "moveToZone", zone: "discard", controlledBy: "self", by: "opponent" }, optional: true, effects: [moveTo(CAND, "hand")] }
    ]
  }
});

// Rigged Tables — SIZE UP: deplete self -> peek top of any deck; RIG: pay1 -> top of any deck to bottom; WALK AWAY: pay1 + destroy self -> draw
V("48f100ed-f3bb-4dcd-b4b7-78ac791fe579", {
  conf: "medium",
  notes: "'Look at the top card of any deck' / 'Put the top card of any deck on the bottom' — chooserSelectsOption picks which deck; peek via lookAndReorder count 1.",
  shapes: ["activated SIZE UP: deplete self -> chooserSelectsOption[peek your deck / opp deck]", "activated RIG: pay1 -> chooserSelectsOption[your top->bottom / opp top->bottom]", "activated WALK AWAY: pay1 + destroy self -> draw"],
  behavior: B([
    { id: "size-up", type: "activated", costs: [deplete("source")], effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Your deck", effects: [{ type: "lookAndReorder", player: "controller", count: 1, to: "top" }] },
      { label: "Opponent deck", effects: [{ type: "lookAndReorder", player: "opponent", count: 1, to: "top", chooser: "controller" }] }
    ] }] },
    { id: "rig", type: "activated", costs: [payR(1)], effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Your deck", effects: [moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "deck", { position: "bottom" })] },
      { label: "Opponent deck", effects: [moveTo({ type: "deckPosition", player: "opponent", from: "top", index: 0 }, "deck", { position: "bottom" })] }
    ] }] },
    { id: "walk-away", type: "activated", costs: [payR(1), destroy("source")], effects: [draw(1)] }
  ])
});

// Rune of Concealment — PROTECT: pay2 + deplete self + pick char -> installReplacement: next time it would be destroyed by battle damage, may destroy this instead, set its damage to 0; FLIP UP 0 [E][E]
V("6b1dcc23-68e3-42cc-aa7b-593437096cd9", {
  flipUp: { cost: 0, threshold: "ee" }, conf: "medium",
  notes: "CONCESSION: installReplacement has no optional/optionalCost — 'you may destroy this instead' is modelled as a mandatory one-shot: the first time the picked character would be destroyed by battle damage this turn, destroy the Rune instead and set the character's damage to 0.",
  shapes: ["activated PROTECT: pay2 + deplete self; pick char -> installReplacement {replaces destroy, condition (isCard candidate==picked & destroyedByBattleDamage), duration UEOT, effects: [destroy source, setDamage candidate 0]}", "flip-up 0 [E][E]"],
  behavior: B([{
    id: "protect", type: "activated", costs: [payR(2), deplete("source")], targets: [pick("c", { type: "character" })],
    effects: [{
      type: "installReplacement", duration: UEOT,
      replaces: { event: "destroy" },
      condition: { type: "and", conditions: [{ type: "isCard", target: CAND, other: S("c") }, { type: "destroyedByBattleDamage", target: CAND }] },
      effects: [destroy("source"), { type: "setDamage", target: CAND, amount: 0 }]
    }]
  }])
});

// Runic Armor — ATTACH: +1 str/+2 life; [E]x5: attached +2 str/+1 life
V("d41f7e5e-6a4e-433b-9ae5-c0f29b451865", {
  attachTo: "character",
  shapes: ["attachTo character; continuous str+1/life+2 on attachedTo", "activated (threshold [E]x5): createModifier str+2/life+1 permanent on attachedTo"],
  behavior: B([
    { id: "plate", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", 1), mod("attachedTo", "life", "add", 2)] },
    { id: "reinforce", type: "activated", threshold: "eeeee", effects: [cmod("attachedTo", "strength", "add", 2, PERM), cmod("attachedTo", "life", "add", 1, PERM)] }
  ])
});

// Runic Battery — ETB may pay3 -> token; DISCHARGE: X=5 if token else 2; destroy self -> detach up to X resources from your faction; draw
V("5b75b908-991f-417f-bed3-a4ab604b6372", {
  conf: "medium",
  notes: "'Detach up to X resources from your faction' via the detach effect over picked resources attached to your faction (X = 5 if token else 2).",
  shapes: ["ETB mayPay 3 -> addCounter token", "activated DISCHARGE: variable x = conditional(token?5:2); destroy self; pick up to x resources you control -> forEach detach; draw 1"],
  behavior: B([
    mayPayToken(3),
    {
      id: "discharge", type: "activated",
      variables: { x: { type: "conditional", if: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 }, then: 5, else: 2 } },
      costs: [destroy("source")],
      targets: [pick("rs", { type: "resource", controller: "self", zone: "play" }, { type: "variable", id: "x" }, { optional: true })],
      effects: [{ type: "forEach", selected: "rs", effects: [{ type: "detach", target: CAND }] }, draw(1)]
    }
  ])
});

// Runivoltaic Accumulator — when an opponent attacks, may put a token; ENERGIZE: pay2 -> token; DISCHARGE: pick char cost<=tokens + destroy self -> destroy it
V("6f9876af-52c0-46e5-a06f-22e488ba54a8", {
  shapes: ["triggered battleStarted (role defender) -> chooserSelectsOption[decline / addCounter token]", "activated ENERGIZE: pay2 -> addCounter token", "activated DISCHARGE: pick char with cardCost<=counter(token); destroy self -> destroy it"],
  behavior: B([
    { id: "charge-up", type: "triggered", event: "battleStarted", condition: { type: "battleRole", role: "defender" }, effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Charge", effects: [addTok("source", 1)] }] }] },
    { id: "energize", type: "activated", costs: [payR(2)], effects: [addTok("source", 1)] },
    { id: "discharge", type: "activated", targets: [pick("c", { type: "character", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: cnt("source") }] })], costs: [destroy("source")], effects: [destroy(S("c"))] }
  ])
});

// Scintillating Chamber Pot — TANTALIZE: pay1 + deplete self + pick char -> this turn its dmg to your faction reduced to 0; cannotBeRestored until start of your next turn
V("be3ec86a-1535-4fbf-a293-777c47743caa", {
  notes: "CONCESSION: modifyOutgoingDamage is source-scoped, not target-scoped — this reduces ALL of the character's inflicted damage this turn to ~0, not only damage to your faction. Plus cannotBeRestored until the start of your next turn.",
  shapes: ["activated TANTALIZE: pay1 + deplete self; pick char -> modifyOutgoingDamage {source: char, delta -999} UEOT; grantRestriction cannotBeRestored USNT"],
  behavior: B([{
    id: "tantalize", type: "activated", costs: [payR(1), deplete("source")], targets: [pick("c", { type: "character" })],
    effects: [
      { type: "modifyOutgoingDamage", source: S("c"), delta: -999, duration: UEOT },
      grantRes(S("c"), "cannotBeRestored", USNT)
    ]
  }])
});

// Unbearably Heavy Shoes of Teleportation — ATTACH: -2 str, cannot be blocked; FLIP UP 5 [E][E][E]
V("051b8a3c-3b1c-48e5-a288-1f699e6aae5c", {
  attachTo: "character", flipUp: { cost: 5, threshold: "eee" },
  shapes: ["attachTo character; continuous str -2 + keyword cannotBeBlocked on attachedTo", "flip-up 5 [E][E][E]"],
  behavior: B([{ id: "teleport", type: "continuous", modifiers: [mod("attachedTo", "strength", "add", -2)], keywords: [{ target: "attachedTo", keyword: "cannotBeBlocked" }] }])
});

// Wand of Possession — POSSESS: pay2 + deplete self -> createTokens Micromajig with COVERT
V("377f9b57-2c1d-4009-8e3a-8e9739e1d0c4", {
  shapes: ["activated POSSESS: pay2 + deplete self -> createTokens Micromajig 1, per-token grantKeyword covert PERM"],
  behavior: B([{ id: "possess", type: "activated", costs: [payR(2), deplete("source")], effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICRO, effects: [grantKw(CAND, "covert", PERM)] }] }])
});

require("./author-seed-data3.cjs");
