/* Seed per-card data, part 3: tactics + PROVIDES resources. */
const H = require("./author-seed.cjs");
const {
  P, V, S, CAND, UEOT, PERM, USNT, cmod, mod, cnt, icons, iconGate, dmg, draw, infl, pick,
  grantKw, grantRes, moveTo, destroy, deplete, restore, addTok, factionOf, ifExists, cardCost,
  payR, rfg, etb, searchToHand, searchOppDeck, recur, oppDiscards, discardFromOppHand
} = H;
const V0 = { type: "variable", id: "x" };
const MICRO = { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 };

// tactic body: everything on abilities[0] (id "body"); behavior.onPlay is ignored for tactics
const T = (id, o) => V(id, {
  ...o.meta ? { meta: o.meta } : {},
  ...o.flipUp ? { flipUp: o.flipUp } : {},
  ...o.caps ? { caps: o.caps } : {},
  ...o.conf ? { conf: o.conf } : {},
  ...o.notes ? { notes: o.notes } : {},
  ...o.parityGaps ? { parityGaps: o.parityGaps } : {},
  ...o.newShape ? { newShape: true } : {},
  shapes: o.shapes,
  behavior: {
    abilities: [{
      id: "body", type: "activated",
      ...(o.condition ? { condition: o.condition } : {}),
      ...(o.variables ? { variables: o.variables } : {}),
      ...(o.variableBounds ? { variableBounds: o.variableBounds } : {}),
      ...(o.costs ? { costs: o.costs } : {}),
      ...(o.targets ? { targets: o.targets } : {}),
      effects: o.effects
    }]
  }
});
const MODAL = (id, o) => V(id, { ...o.meta ? { meta: o.meta } : {}, conf: o.conf || "high", ...o.notes ? { notes: o.notes } : {}, shapes: o.shapes, behavior: { modes: o.modes } });

// =====================================================================
// TACTICS
// =====================================================================

// Anathematize — EXTRA COST pick char; this turn -5 str; draw
T("63157c9a-b261-47c9-8894-7b9c94b9b383", {
  shapes: ["body: pick char -> createModifier str -5 UEOT; draw"],
  targets: [pick("c", { type: "character" })],
  effects: [cmod(S("c"), "strength", "add", -5, UEOT), draw(1)]
});

// Arcane Research — search deck for up to 4 tactics -> discard
T("977c039b-8303-449e-9305-bf95001af440", {
  shapes: ["body: chooserSelectsTarget deck tactics count 4 optional -> forEach moveCard discard"],
  effects: [{
    type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "t", selector: { owner: "self", zone: "deck", type: "tactic" }, count: 4, optional: true },
    effects: [{ type: "forEach", selected: "t", effects: [moveTo(CAND, "discard")] }, { type: "shuffleDeck", player: "controller" }]
  }]
});

// Architectural Restitution — EXTRA COST: defender-only + pick loc in discard -> put into play + redirect attack; FLIP UP 2 [G][G]
T("b4c72134-5c83-4a88-af75-e16482ccd0b1", {
  flipUp: { cost: 2, threshold: "gg" }, caps: ["redirect-attack-target"], newShape: true,
  shapes: ["body: condition battleRole defender; pick location in discard -> putIntoPlay under you; redirectAttackTarget to it", "flip-up 2 [G][G]"],
  condition: { type: "battleRole", role: "defender" },
  targets: [pick("l", { type: "location", zone: "discard", owner: "self" })],
  effects: [{ type: "putIntoPlay", target: S("l"), controller: "controller" }, { type: "redirectAttackTarget", to: S("l") }]
});

// Because God Said So! — EXTRA COST pick blocking char; this turn +5/+5
T("ee300a90-eb6b-4e31-a7a5-b93a60d8a8a7", {
  shapes: ["body: pick blocking char -> createModifier str/life +5 UEOT"],
  targets: [pick("c", { type: "character", conditions: [{ type: "inBattle", target: CAND, role: "blocker" }] })],
  effects: [cmod(S("c"), "strength", "add", 5, UEOT), cmod(S("c"), "life", "add", 5, UEOT)]
});

// Boilstorm — EXTRA COST pick <=3 chars; distributeAmong X ([R] count) dmg
T("cc9b928b-7c3b-49a8-91ce-afa973012814", {
  shapes: ["body: pick 3-or-fewer chars -> distributeAmong [R] count damage"],
  targets: [pick("cs", { type: "character" }, 3, { optional: true })],
  effects: [{ type: "distributeAmong", chooser: "controller", selected: "cs", amount: icons("rage"), effects: [dmg(CAND, { type: "variable", id: "__amount" })] }]
});

// Brainbath — reprint (Ungodly Mess). draw 2 + bottom a card; RECUR [O][O]: pay4 exile -> opp discards + draw
T("a037259c-6b3d-4e9a-ae5d-ca91c19c6817", {
  notes: "Text-identical reprint of Brainbath (Ungodly Mess).",
  shapes: ["body: draw 2; put a hand card on the bottom of your deck", "RECUR [O][O]: pay4 + exile self -> opp discards a card; draw"],
  effects: [draw(2), { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "b", selector: { owner: "self", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "b", effects: [moveTo(CAND, "deck", { position: "bottom" })] }] }]
});
P["a037259c-6b3d-4e9a-ae5d-ca91c19c6817"].behavior.abilities.push(recur("oo", 4, [oppDiscards(1), draw(1)]));

// Brilliant Insight — play up to 2 resources
T("fb828bc8-bc8d-463b-89c4-8d31488a5bbc", {
  shapes: ["body: chooserSelectsOption x2 [decline / playResource]"],
  effects: [
    { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Play a resource", effects: [{ type: "playResource", player: "controller" }] }] },
    { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Play a resource", effects: [{ type: "playResource", player: "controller" }] }] }
  ]
});

// Chain Reaction — EXTRA COST pick loc; 3 dmg; if destroyed may pick char 2 dmg; if that destroyed 1 dmg opp faction + draw; FLIP UP 1 [R]
T("2630e650-a402-4646-af6a-e8a47b033c5c", {
  flipUp: { cost: 1, threshold: "r" },
  shapes: ["body: pick location -> 3 dmg; if location left play -> mayPick char -> 2 dmg; if that char left play -> 1 dmg opp faction + draw"],
  targets: [pick("l", { type: "location" })],
  effects: [dmg(S("l"), 3), {
    type: "if", condition: { type: "not", condition: { type: "targetInZone", target: S("l"), zone: "play" } },
    effects: [{
      type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "c", selector: { type: "character" }, count: 1, optional: true },
      effects: [ifExists("c", [dmg(S("c"), 2), {
        type: "if", condition: { type: "not", condition: { type: "targetInZone", target: S("c"), zone: "play" } },
        effects: [dmg(factionOf("opponent"), 1), draw(1)]
      }])]
    }]
  }]
});

// Crushing Usury — EXTRA COST pick char; destroy; faction -3; FLIP UP 2 [G]
T("6337da3e-f649-40dc-880f-7023980f2d32", {
  flipUp: { cost: 2, threshold: "g" },
  shapes: ["body: pick char -> destroy; modifyInfluence -3", "flip-up 2 [G]"],
  targets: [pick("c", { type: "character" })],
  effects: [destroy(S("c")), infl(-3)]
});

// Day of the Tentacle — look opp hand, pick non-resource -> into play under opp as face-down resource
T("038bef7e-0d08-4751-ab48-0d1de31e3195", {
  shapes: ["body: chooserSelectsTarget opp hand non-resource -> putIntoPlay {controller: opponent, faceDown}"],
  effects: [{
    type: "chooserSelectsTarget", chooser: "controller",
    declaration: { id: "t", selector: { owner: "opponent", zone: "hand", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "resource" } }] }, count: 1, optional: false },
    effects: [{ type: "forEach", selected: "t", effects: [{ type: "putIntoPlay", target: CAND, controller: "opponent", faceDown: true }] }]
  }]
});

// Desserted Island — draw 3; RECUR [G][G]: pay1 exile -> draw
T("fdaacd43-878d-4f31-8235-d17fe4625bda", {
  shapes: ["body: draw 3", "RECUR [G][G]: pay1 + exile self -> draw"],
  effects: [draw(3)]
});
P["fdaacd43-878d-4f31-8235-d17fe4625bda"].behavior.abilities.push(recur("gg", 1, [draw(1)]));

// Encumber — EXTRA COST pick char/loc; bounce; RECUR [O]: pay2 exile -> discard non-resource from opp hand
T("f32de0a3-6f08-47c4-a798-679c5be50631", {
  shapes: ["body: pick char or location -> moveCard owner hand", "RECUR [O]: pay2 + exile self -> discard a non-resource from opp hand"],
  targets: [pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "cardTypeIs", target: CAND, cardType: "location" }] }] })],
  effects: [moveTo(S("t"), "hand")]
});
P["f32de0a3-6f08-47c4-a798-679c5be50631"].behavior.abilities.push(recur("o", 2, [discardFromOppHand([{ type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "resource" } }])]));

// Essence cycle (modal, 3 options each) --------------------------------
MODAL("01005d53-34a2-4a29-99f9-9a71dc23cdf0", { // Essence of Deception
  shapes: ["modal: [search opp deck -> discard] / [pick char -> +1 speed UEOT] / [pick char -> if damagedThisTurn destroy]"],
  modes: [
    { label: "Mill-tutor", effects: [searchOppDeck({}, "discard")] },
    { label: "+1 speed", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "speed", "add", 1, UEOT)] },
    { label: "Execute if damaged", targets: [pick("c", { type: "character" })], effects: [{ type: "if", condition: { type: "damagedThisTurn", target: S("c"), by: "any" }, effects: [destroy(S("c"))] }] }
  ]
});
MODAL("f58c2e29-ba33-4864-a6f9-87dd8e63a9d9", { // Essence of Elitism
  shapes: ["modal: [Micromajig token] / [pick covert char -> lose covert UEOT] / [pick item in discard -> hand]"],
  modes: [
    { label: "Micromajig", effects: [{ type: "createTokens", controller: "controller", count: 1, token: MICRO }] },
    { label: "Strip covert", targets: [pick("c", { type: "character", conditions: [{ type: "hasKeyword", target: CAND, keyword: "covert" }] })], effects: [{ type: "suppressKeyword", target: S("c"), keyword: "covert", duration: UEOT }] },
    { label: "Recur an item", targets: [pick("it", { type: "item", zone: "discard", owner: "self" })], effects: [moveTo(S("it"), "hand")] }
  ]
});
MODAL("f446634a-a9bb-45d9-b34f-7673bebff90a", { // Essence of Greed
  shapes: ["modal: [draw] / [pick char -> +2 life UEOT] / [+4 influence]"],
  modes: [
    { label: "Draw", effects: [draw(1)] },
    { label: "+2 life", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", 2, UEOT)] },
    { label: "+4 influence", effects: [infl(4)] }
  ]
});
MODAL("e4260352-6b62-41dc-a031-6dbc0faccb73", { // Essence of Obsession
  shapes: ["modal: [opp discards] / [pick char -> covert UEOT] / [pick char -> -2 str UEOT]"],
  modes: [
    { label: "Opp discards", effects: [oppDiscards(1)] },
    { label: "Covert", targets: [pick("c", { type: "character" })], effects: [grantKw(S("c"), "covert", UEOT)] },
    { label: "-2 strength", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", -2, UEOT)] }
  ]
});
MODAL("0f56196a-942c-4256-abe3-270ddc063a72", { // Essence of Rage
  shapes: ["modal: [pick char/faction -> 1 dmg] / [pick char -> +2 str UEOT] / [pick char -> deplete]"],
  modes: [
    { label: "1 damage", targets: [pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "cardTypeIs", target: CAND, cardType: "faction" }] }] })], effects: [dmg(S("t"), 1)] },
    { label: "+2 strength", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", 2, UEOT)] },
    { label: "Deplete", targets: [pick("c", { type: "character" })], effects: [deplete(S("c"))] }
  ]
});

// Evanesce — EXTRA COST pick char; bounce; FLIP UP 1 [O][O]
T("a4e374e2-a245-46c5-aae3-72c8a156144b", {
  flipUp: { cost: 1, threshold: "oo" },
  shapes: ["body: pick char -> moveCard owner hand", "flip-up 1 [O][O]"],
  targets: [pick("c", { type: "character" })], effects: [moveTo(S("c"), "hand")]
});

// Extravagant Contusion — EXTRA COST choose X pay X pick char cost<=X; destroy
T("7a5a5e6a-a551-4998-a33b-323287f64059", {
  shapes: ["body: variable x; pay x; pick char with cardCost<=x -> destroy"],
  variables: { x: 0 }, variableBounds: { x: { min: 0 } },
  costs: [payR(V0)],
  targets: [pick("c", { type: "character", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: V0 }] })],
  effects: [destroy(S("c"))]
});

// Forbidden Knowledge — may look opp hand/top/fd resources; draw; FLIP UP 0 [O][O]
T("40a1b99a-a5b6-4356-b84c-3cc41a5e6db2", {
  flipUp: { cost: 0, threshold: "oo" }, conf: "medium",
  notes: "'You may look at an opponent's hand, the top card of their deck, and their face-down resources' is pure information (no state change) — authored as a bare draw; the look is a UI/renderer affordance.",
  shapes: ["body: draw 1 (the 'look' is informational only)", "flip-up 0 [O][O]"],
  effects: [draw(1)]
});

// Headhunting — EXTRA COST respond to char cost<=X ([D] count) being deployed; the char enters play under your control
T("5275654c-1664-4342-811f-848e80019d9f", {
  shapes: ["body: condition and[respondingTo{card,character}, cardCost(respondedToCard)<=[D] count]; rememberTarget respondedToCard; terminate respondedItem; putIntoPlay remembered under you"],
  condition: { type: "and", conditions: [{ type: "respondingTo", respondsTo: "card", cardType: "character" }, { type: "numberCompare", left: cardCost({ type: "respondedToCard" }), operator: "<=", right: icons("deception") }] },
  effects: [
    { type: "rememberTarget", key: "stolen", target: { type: "respondedToCard" } },
    { type: "terminate", scope: "respondedItem" },
    { type: "putIntoPlay", target: { type: "remembered", key: "stolen" }, controller: "controller" }
  ]
});

// Heroic Deed — EXTRA COST pick <=2 chars; this turn cannot block; FLIP UP 9 [R]
T("f0dbe0a2-74e2-4cbb-b6d2-2d9908b6b97e", {
  flipUp: { cost: 9, threshold: "r" },
  shapes: ["body: pick 2-or-fewer chars -> forEach grantRestriction cannotBlock UEOT", "flip-up 9 [R]"],
  targets: [pick("cs", { type: "character" }, 2, { optional: true })],
  effects: [{ type: "forEach", selected: "cs", effects: [grantRes(CAND, "cannotBlock", UEOT)] }]
});

// Hustler's Comeuppance — destroy all chars that inflicted dmg to your faction this turn; FLIP UP 3 [D][D]
T("6bae74ee-4604-4f83-8f7d-6b5eed238ef9", {
  flipUp: { cost: 3, threshold: "dd" },
  shapes: ["body: forEach {type:character, inflictedDamageToFactionThisTurn(controller)} -> destroy", "flip-up 3 [D][D]"],
  effects: [{ type: "forEach", selector: { type: "character", conditions: [{ type: "inflictedDamageToFactionThisTurn", player: "controller", target: CAND }] }, effects: [destroy(CAND)] }]
});

// Improvised Blowtorch — EXTRA COST pick char; 2 dmg; FLIP UP 1 [R]
T("5d9a641c-b27b-49ab-ad03-e494b16f9774", {
  flipUp: { cost: 1, threshold: "r" },
  shapes: ["body: pick char -> 2 dmg", "flip-up 1 [R]"],
  targets: [pick("c", { type: "character" })], effects: [dmg(S("c"), 2)]
});

// Inconvenient Roadblock — EXTRA COST during battle; reduce all battle dmg this battle to 0 + draw; FLIP UP 1 [G]
T("82140912-9e21-4598-9c7b-6d45e3c50d83", {
  flipUp: { cost: 1, threshold: "g" },
  shapes: ["body: condition battleActive; preventAllDamage UEOT; draw", "flip-up 1 [G]"],
  condition: { type: "battleActive" },
  effects: [{ type: "preventAllDamage", duration: UEOT }, draw(1)]
});

// Inhibit — EXTRA COST pick non-resource card; until start of your next turn no rules text + draw
T("5032dc44-43e5-4ec7-b044-11d897cb2a49", {
  shapes: ["body: pick non-resource card -> suppressAbilities USNT; draw"],
  targets: [pick("c", { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "resource" } }] })],
  effects: [{ type: "suppressAbilities", target: S("c"), duration: USNT }, draw(1)]
});

// Jocular Stupefaction — EXTRA COST pick char with COVERT; destroy; FLIP UP 3 [E]
T("f8fbc218-d0fc-4880-9aa6-2068ae358079", {
  flipUp: { cost: 3, threshold: "e" },
  shapes: ["body: pick covert char -> destroy", "flip-up 3 [E]"],
  targets: [pick("c", { type: "character", conditions: [{ type: "hasKeyword", target: CAND, keyword: "covert" }] })],
  effects: [destroy(S("c"))]
});

// Karmic Cake — search deck for resource -> hand; RECUR [G]: pay2 exile -> search staple resource -> hand
T("ae3fd7e6-7886-4529-9d27-54617d25826c", {
  shapes: ["body: search deck for a resource -> hand", "RECUR [G]: pay2 + exile self -> search deck for a staple resource -> hand"],
  effects: [searchToHand({ type: "resource" }, false)]
});
P["ae3fd7e6-7886-4529-9d27-54617d25826c"].behavior.abilities.push(recur("g", 2, [searchToHand({ type: "resource", staple: true }, false)]));

// Manful Skirmish — EXTRA COST pick 3 chars; deplete one, 1 dmg to another, remaining +2 str this turn; draw
T("dc6290ab-38ea-452c-9f85-99dcc44271a5", {
  conf: "medium",
  notes: "'Deplete one / inflict 1 to another / the remaining gains +2 strength' — the three roles among the 3 picked are assigned by three sequential sub-picks from the selection.",
  shapes: ["body: pick 3 chars -> sub-pick(deplete) -> sub-pick(1 dmg) -> sub-pick(+2 str UEOT); draw"],
  targets: [pick("cs", { type: "character" }, 3)],
  effects: [
    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d1", selector: { conditions: [{ type: "targetInSelection", target: CAND, selection: "cs" }] }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d1", effects: [deplete(CAND)] }] },
    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d2", selector: { conditions: [{ type: "targetInSelection", target: CAND, selection: "cs" }] }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d2", effects: [dmg(CAND, 1)] }] },
    { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d3", selector: { conditions: [{ type: "targetInSelection", target: CAND, selection: "cs" }] }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d3", effects: [cmod(CAND, "strength", "add", 2, UEOT)] }] },
    draw(1)
  ]
});

// Mass Confusion — EXTRA COST choose X pay X pick player pick X chars that player controls; distributeAmong Y ([their chars]-[your chars]) dmg
T("48c4d2f0-8d0f-4203-a6ae-b81d9ebce2eb", {
  conf: "medium",
  notes: "'Pick a player. Pick X characters that player controls.' — degenerates to the one opponent in 2-player; the X picks are opponent characters. Y = count(opp chars) - count(self chars).",
  shapes: ["body: variable x; pay x; pick x opponent chars -> distributeAmong (count(opp chars)-count(self chars)) damage"],
  variables: { x: 0 }, variableBounds: { x: { min: 0 } },
  costs: [payR(V0)],
  targets: [pick("cs", { type: "character", controller: "opponent" }, V0)],
  effects: [{
    type: "distributeAmong", chooser: "controller", selected: "cs",
    amount: { type: "add", values: [{ type: "count", selector: { controller: "opponent", type: "character" } }, { type: "multiply", values: [{ type: "count", selector: { controller: "self", type: "character" } }, -1] }] },
    effects: [dmg(CAND, { type: "variable", id: "__amount" })]
  }]
});

// Mutineer's Hiatus — EXTRA COST destroy a char you own; draw 2; RECUR [G]: pay2 exile pick char you own -> destroy + draw
T("09e941f7-a0b9-4727-a30b-3783fca566eb", {
  shapes: ["body: destroy a char you own -> draw 2", "RECUR [G]: pay2 + exile self; pick char you own -> destroy + draw"],
  targets: [pick("c", { type: "character", owner: "self" })],
  costs: [destroy(S("c"))],
  effects: [draw(2)]
});
P["09e941f7-a0b9-4727-a30b-3783fca566eb"].behavior.abilities.push(recur("g", 2, [destroy(S("rc")), draw(1)], [pick("rc", { type: "character", owner: "self" })]));

// Noble Sacrifice — EXTRA COST pick char you own + char opp owns; destroy both; draw; FLIP UP 0 [R][R]
T("f013f5ae-5301-4cd1-9504-b2e50f1e4a48", {
  flipUp: { cost: 0, threshold: "rr" },
  shapes: ["body: pick char you own + char opp owns -> destroy both; draw", "flip-up 0 [R][R]"],
  targets: [pick("mine", { type: "character", owner: "self" }), pick("theirs", { type: "character", owner: "opponent" })],
  effects: [destroy(S("mine")), destroy(S("theirs")), draw(1)]
});

// Obscure — EXTRA COST pick char; this turn COVERT; FLIP UP 2 [O]
T("a71e2b60-e5b7-4c2a-ad73-027bc4ece93d", {
  flipUp: { cost: 2, threshold: "o" },
  shapes: ["body: pick char -> grantKeyword covert UEOT", "flip-up 2 [O]"],
  targets: [pick("c", { type: "character" })], effects: [grantKw(S("c"), "covert", UEOT)]
});

// Overindulge — reprint (Ungodly Mess). modal (2)
MODAL("30dd0075-1c8a-449d-9e73-b8a4d0f87f24", {
  notes: "Text-identical reprint of Overindulge (Ungodly Mess).",
  shapes: ["modal: [pick char -> -2 life UEOT] / [pick char -> -1 life UEOT; draw]"],
  modes: [
    { label: "-2 life", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", -2, UEOT)] },
    { label: "-1 life + draw", targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", -1, UEOT), draw(1)] }
  ]
});

// Palm Glom — EXTRA COST pick char/item; take control; draw
T("45336428-4e91-431e-900b-86b57002da3f", {
  shapes: ["body: pick char or item -> takeControl; draw"],
  targets: [pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "cardTypeIs", target: CAND, cardType: "item" }] }] })],
  effects: [{ type: "takeControl", target: S("t"), controller: "controller" }, draw(1)]
});

// Pant Swipe — top 4 opp deck -> void; deploy them from void ignoring threshold for the rest of the game; FLIP UP 5 [D][D][D]
T("0fae8376-e4e6-4f0c-ae33-8be60ca717a9", {
  flipUp: { cost: 5, threshold: "ddd" },
  notes: "Eccentric Inquisition idiom: a fromTop:4 target declaration -> forEach moveCard void -> grantVoidPlay {selected, ignoreThreshold}.",
  shapes: ["body: pick top 4 of opp deck {voided} -> forEach moveCard void; grantVoidPlay {selected: voided, ignoreThreshold}", "flip-up 5 [D][D][D]"],
  targets: [pick("voided", { owner: "opponent", zone: "deck", fromTop: 4 }, 4, { optional: true })],
  effects: [
    { type: "forEach", selected: "voided", effects: [moveTo(CAND, "void")] },
    { type: "grantVoidPlay", selected: "voided", player: "controller", ignoreThreshold: true }
  ]
});

// Perforate — EXTRA COST choose X pay X pick char; X dmg
T("3b0d80d3-3d79-4f84-81db-a805584534fb", {
  shapes: ["body: variable x; pay x; pick char -> dealDamage x"],
  variables: { x: 0 }, variableBounds: { x: { min: 0 } },
  costs: [payR(V0)],
  targets: [pick("c", { type: "character" })],
  effects: [dmg(S("c"), V0)]
});

// Reality Shift — bounce all your non-resource cards; deployForFree budget = sumCost of those
T("f0a05c35-7828-49ac-8a59-131b8287e02d", {
  caps: ["deploy-for-free-budget", "sum-cost-expression"], newShape: true,
  shapes: ["body: bind x = sumCost {controller:self, non-resource}; forEach {controller:self, non-resource in play} moveCard owner hand; deployForFree {budget: x, maxCost large}"],
  effects: [
    { type: "bind", id: "x", value: { type: "sumCost", selector: { controller: "self", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "resource" } }] } } },
    { type: "forEach", selector: { controller: "self", zone: "play", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "resource" } }, { type: "not", condition: { type: "cardTypeIs", target: CAND, cardType: "faction" } }] }, effects: [moveTo(CAND, "hand")] },
    { type: "deployForFree", player: "controller", maxCost: 99, budget: V0, free: true }
  ]
});

// Repurpose — EXTRA COST pick item; destroy; draw; FLIP UP 2 [E][E]
T("00f518f0-44df-4963-b387-9db6782cfe69", {
  flipUp: { cost: 2, threshold: "ee" },
  shapes: ["body: pick item -> destroy; draw", "flip-up 2 [E][E]"],
  targets: [pick("it", { type: "item" })], effects: [destroy(S("it")), draw(1)]
});

// Roulette Wheel of DOOM! — reveal top; may pick char with life<=X (cost of revealed); destroy; else draw 2
T("88812b6d-a80c-4271-88e0-d3bf47a8aeaf", {
  conf: "medium",
  notes: "'Reveal the top card' modelled as binding x = cardCost of the top card; the 'otherwise draw 2' is gated on whether a character was actually picked.",
  shapes: ["body: bind x = cardCost(top of deck); mayPick char with life<=x -> destroy; if not picked -> draw 2"],
  effects: [
    { type: "bind", id: "x", value: cardCost({ type: "deckPosition", player: "controller", from: "top", index: 0 }) },
    {
      type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "c", selector: { type: "character", conditions: [{ type: "statCompare", target: CAND, stat: "life", operator: "<=", value: V0 }] }, count: 1, optional: true },
      effects: [
        { type: "if", condition: { type: "targetExists", target: S("c") }, effects: [destroy(S("c"))] },
        { type: "if", condition: { type: "not", condition: { type: "targetExists", target: S("c") } }, effects: [draw(2)] }
      ]
    }
  ]
});

// Rouse — EXTRA COST pick tactic in discard -> top of deck; RECUR [O][O][O]: pay1 exile pick tactic in discard -> top of deck
T("bcd07cb8-7eea-49cf-a528-2efeba8bd486", {
  shapes: ["body: pick tactic in discard -> moveCard deck top", "RECUR [O][O][O]: pay1 + exile self; pick tactic in discard -> deck top"],
  targets: [pick("t", { type: "tactic", zone: "discard", owner: "self" })],
  effects: [moveTo(S("t"), "deck", { position: "top" })]
});
P["bcd07cb8-7eea-49cf-a528-2efeba8bd486"].behavior.abilities.push(recur("ooo", 1, [moveTo(S("rt"), "deck", { position: "top" })], [pick("rt", { type: "tactic", zone: "discard", owner: "self" })]));

// Rumply Ruse — EXTRA COST during battle; this turn all chars in your battle party +1 speed; FLIP UP 4 [D][D]
T("84772c38-fc39-4659-95ed-956ad8e7d7d7", {
  flipUp: { cost: 4, threshold: "dd" }, conf: "medium",
  notes: "'all characters in your party' = characters you control that are in the current battle.",
  shapes: ["body: condition battleActive; forEach {controller:self, type:character, inBattle} -> createModifier speed +1 UEOT", "flip-up 4 [D][D]"],
  condition: { type: "battleActive" },
  effects: [{ type: "forEach", selector: { controller: "self", type: "character", conditions: [{ type: "inBattle", target: CAND }] }, effects: [cmod(CAND, "speed", "add", 1, UEOT)] }]
});

// Runic Reinforcement — EXTRA COST pick char; this turn +3/+3
T("0b06263c-3ef0-43d5-9b86-4ac5d1cb4d5f", {
  shapes: ["body: pick char -> createModifier str/life +3 UEOT"],
  targets: [pick("c", { type: "character" })],
  effects: [cmod(S("c"), "strength", "add", 3, UEOT), cmod(S("c"), "life", "add", 3, UEOT)]
});

// Seraphim Magic — EXTRA COST pick char; this turn +3 str; draw
T("57a10d25-4f3b-4e6c-9a69-182583b30404", {
  shapes: ["body: pick char -> createModifier str +3 UEOT; draw"],
  targets: [pick("c", { type: "character" })],
  effects: [cmod(S("c"), "strength", "add", 3, UEOT), draw(1)]
});

// Strangulate — EXTRA COST pick char; if life<=4 destroy; FLIP UP 2 [D]
T("d59bdac3-b649-40ac-9c65-6e325c431211", {
  flipUp: { cost: 2, threshold: "d" },
  shapes: ["body: pick char -> if statCompare(life<=4) destroy", "flip-up 2 [D]"],
  targets: [pick("c", { type: "character" })],
  effects: [{ type: "if", condition: { type: "statCompare", target: S("c"), stat: "life", operator: "<=", value: 4 }, effects: [destroy(S("c"))] }]
});

// Stupidify — opp discards 2; RECUR [O]: pay2 exile -> opp discards 1
T("baef7715-05a4-4082-b546-c458ce97eeb2", {
  shapes: ["body: opp discards 2", "RECUR [O]: pay2 + exile self -> opp discards 1"],
  effects: [oppDiscards(2)]
});
P["baef7715-05a4-4082-b546-c458ce97eeb2"].behavior.abilities.push(recur("o", 2, [oppDiscards(1)]));

// Subordinate Demotivation — destroy the opp char with lowest numeric cost (tie you decide)
T("e99994ea-71f1-4143-98dd-c2782fc38ff7", {
  shapes: ["body: pick {controller:opponent, type:character, isExtremum cost min} -> destroy"],
  targets: [pick("c", { controller: "opponent", type: "character", conditions: [{ type: "isExtremum", target: CAND, metric: "cost", direction: "min", among: { controller: "opponent", type: "character" } }] })],
  effects: [destroy(S("c"))]
});

// Surprise! — EXTRA COST pick char attacking your faction OR loc you control; X=that char's cost; dig for a fitting char -> into blocking party
T("95ad5456-4279-4481-848b-933036e72684", {
  conf: "low", newShape: true,
  notes: "CONCESSION: no 'reveal from top until match' primitive. Modelled as: bind x = picked card's cardCost, then search the whole deck for a character with cardCost<=x, put it into play as a member of the blocking party. This is more permissive than the printed top-of-deck dig and does not shuffle non-matching revealed cards (nothing else is revealed).",
  shapes: ["body: pick char attacking your faction or a location you control; bind x = cardCost(picked); chooserSelectsTarget deck {type:character, cardCost<=x} -> putIntoPlay + addToBattle blocking"],
  condition: { type: "battleRole", role: "defender" },
  targets: [pick("k", { conditions: [{ type: "or", conditions: [{ type: "and", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "inBattle", target: CAND, role: "attacker" }] }, { type: "and", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "location" }, { type: "isCard", target: CAND, other: CAND }] }] }] })],
  effects: [
    { type: "bind", id: "x", value: cardCost(S("k")) },
    {
      type: "chooserSelectsTarget", chooser: "controller",
      declaration: { id: "rec", selector: { owner: "self", zone: "deck", type: "character", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: V0 }] }, count: 1, optional: true },
      effects: [ifExists("rec", [{ type: "putIntoPlay", target: S("rec"), controller: "controller" }, { type: "addToBattle", target: S("rec"), side: "blocking" }])]
    },
    { type: "shuffleDeck", player: "controller" }
  ]
});

// Surprising Nuisance — put 2 Micromajig tokens into play
T("0dfa9c30-242f-4663-bc0e-4fb59c368db6", {
  shapes: ["body: createTokens Micromajig 2"],
  effects: [{ type: "createTokens", controller: "controller", count: 2, token: MICRO }]
});

// Tamper — EXTRA COST pick char with an ability; destroy; FLIP UP 1 [E][E]
T("881a5cfb-d643-4e75-9cab-a5d00d27c32c", {
  flipUp: { cost: 1, threshold: "ee" },
  shapes: ["body: pick char with hasAbility -> destroy", "flip-up 1 [E][E]"],
  targets: [pick("c", { type: "character", conditions: [{ type: "hasAbility", target: CAND }] })],
  effects: [destroy(S("c"))]
});

// Walk the Plank — destroy all chars with cost<=X ([G] count)
T("55bbc252-d0dc-4226-9d7e-cfb8bd80755b", {
  shapes: ["body: forEach {type:character, cardCost<=[G] count} -> destroy"],
  effects: [{ type: "forEach", selector: { type: "character", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: icons("greed") }] }, effects: [destroy(CAND)] }]
});

// =====================================================================
// PROVIDES resources (upgrade from vanilla): ETB lose 1 influence + double-icon PROVIDES
// =====================================================================
const provRes = (id, icon) => V(id, {
  status: "verified", conf: "high",
  resource: { provides: [icon, icon], staple: false },
  meta: { keywords: [] },
  notes: "Seed 2 idiom: a face-up resource's 'when this card enters play' fires on `resourcePlayed` (playResourceCard does not emit cardEnteredPlay); a face-down play is inert.",
  shapes: ["resource PROVIDES [" + icon + "][" + icon + "]", "triggered resourcePlayed (self) -> modifyInfluence -1"],
  behavior: { abilities: [
    { id: "downside", type: "triggered", event: "resourcePlayed", condition: { type: "sourceIsEventCard" }, effects: [infl(-1)] },
    { id: "downside-etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [infl(-1)] }
  ] }
});
provRes("1e955cf5-ecf5-4f28-82dc-ab10179b2bba", "elitism");    // Arrogance
provRes("577159cb-d920-4526-bc82-28f74effc6ea", "greed");      // Exploitation
provRes("1e8e86ba-3643-4a1f-911f-91ea29b00d42", "obsession");  // Neurosis
provRes("c5cea326-3431-46dd-b5fb-7ada354f98eb", "deception");  // Treachery
provRes("c842bfd6-add5-4365-9401-22fab0bda5bc", "rage");       // Violence
