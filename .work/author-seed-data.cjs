/* Seed per-card data. Loaded by author-seed.cjs (helpers come from its exports). */
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
const chr = id => S(id);

// =====================================================================
// CHARACTERS
// =====================================================================

// 313373 M3ch4n1c — REPAIR: choose X<=[E], pay X, destroy self, pick item in discard cost<=X -> into play
V("e212b965-7c46-440f-b45c-86fb5204f6dd", {
  shapes: ["activated REPAIR: variable x (<= [E] count); pay x + destroy self; pick item in discard with cost<=x -> putIntoPlay"],
  behavior: B([{
    id: "repair", type: "activated",
    variables: { x: 0 },
    variableBounds: { x: { min: 0, max: icons("elitism") } },
    costs: [payR({ type: "variable", id: "x" }), destroy("source")],
    targets: [pick("it", { type: "item", zone: "discard", owner: "self", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: { type: "variable", id: "x" } }] })],
    effects: [{ type: "putIntoPlay", target: S("it"), controller: "controller" }]
  }])
});

// Adjunct Artisan — FABRICATE: deplete self -> reduce next item/item-ability numeric cost by 2
V("6ecf173c-843f-4e00-b9f6-7ca6d1dc0843", {
  conf: "medium",
  notes: "Reduce next item cost by 2. CONCESSION: reduceNextCost has cardType:'item' for item deploys; 'or item's ability's numeric cost' is not separately gated (the reduction also applies to the next numeric cost paid, which covers the ability case loosely).",
  shapes: ["activated FABRICATE: deplete self -> reduceNextCost 2 (cardType item)"],
  behavior: B([{ id: "fabricate", type: "activated", costs: [deplete("source")], effects: [{ type: "reduceNextCost", player: "controller", amount: 2, cardType: "item" }] }])
});

// Adriel, Defender of Marduun — UNIQUE ADRIEL; while blocking, battle dmg to this -> 0
V("29b9fbb7-6123-40f4-b0ae-4dd814dbb2a2", {
  unique: "adriel",
  shapes: ["continuous: while inBattle(source, blocker), damageModifiers set battle damage to source to 0"],
  behavior: B([{
    id: "shield", type: "continuous",
    condition: { type: "inBattle", target: "source", role: "blocker" },
    modifiers: [],
    damageModifiers: [{ selector: { conditions: [{ type: "isCard", target: CAND, other: "source" }] }, battleOnly: true, delta: 0, minAmount: 1, setTo: 0 }]
  }])
});

// Affectionate Dollkeeper — [D][D][D]: when this inflicts dmg to a character, destroy that character
V("bf855ca9-e1ed-47ae-8c79-b625f3d50ffe", {
  shapes: ["triggered damageDealt by source to a character, gated [D][D][D] -> destroy that character"],
  behavior: B([{
    id: "deathtouch", type: "triggered", event: "damageDealt",
    condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, iconGate("deception", 3), { type: "cardTypeIs", target: "eventCard", cardType: "character" }] },
    effects: [destroy("eventCard")]
  }])
});

VANILLA("639b4566-af65-49ba-b3c7-1a310f5b1000"); // Agile Highwayman

// Aristocratic Artificer — SNUB: pay 1, deplete self -> search deck for a card named Elitism -> hand
V("9ccc40b6-2008-4e25-af2f-4ef6862c3687", {
  shapes: ["activated SNUB: pay1 + deplete self -> search deck for card named 'Elitism' -> hand"],
  behavior: B([{ id: "snub", type: "activated", costs: [payR(1), deplete("source")], effects: [searchToHand({ name: "Elitism" }, false)] }])
});

// Assistant Mud Whisperer — at start of each opp turn, may pick a character -> restore it
V("cf55d22c-3b57-4e63-bad2-4ec8ea6478d6", {
  shapes: ["triggered turnStarted (opponent) -> mayPick character -> restore"],
  behavior: B([startTurn("recharge", [mayPick("c", { type: "character" }, [restore(S("c"))])], { who: "opponent" })])
});

// Avuncular Merlion — ETB with 2 tokens; when a char you control -> discard from play, may pay1+rmTok -> that char into play deplete it
V("eb25b337-3ba7-4427-810c-0efd7df8c43e", {
  shapes: ["ETB addCounter token 2", "triggered cardMoved (char you control, play->discard) -> mayPay 1 + removeCounter token -> putIntoPlay that char, deplete"],
  behavior: B([
    etb([addTok("source", 2)]),
    {
      id: "reclaim", type: "triggered", event: "cardMoved",
      condition: { type: "and", conditions: [{ type: "cardMovedFromZone", zone: "play" }, { type: "cardMovedToZone", zone: "discard" }, { type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "controller" }] },
      effects: [{ type: "mayPay", player: "controller", costs: [payR(1), rmTok("source", 1)], effects: [{ type: "putIntoPlay", target: "eventCard", controller: "controller" }, deplete("eventCard")], elseEffects: [] }]
    }
  ])
});

// Aweless Charger — BORE: pay3 + deplete self + pick blocking char -> removeFromBattle + deplete it
V("67038135-53e7-41ae-9fec-f9c71090a8c1", {
  shapes: ["activated BORE: pay3 + deplete self; pick blocking char -> removeFromBattle + deplete"],
  behavior: B([{
    id: "bore", type: "activated", costs: [payR(3), deplete("source")],
    targets: [pick("b", { type: "character", conditions: [{ type: "inBattle", target: CAND, role: "blocker" }] })],
    effects: [{ type: "removeFromBattle", target: S("b") }, deplete(S("b"))]
  }])
});

// Balking Foecrusher — leaves play: 1 dmg to all chars + draw; CRUSH WAVE: pay2 + destroy self -> 1 dmg to all chars
V("0e93d480-f1ed-4752-8f2c-b5b169a229ca", {
  shapes: ["triggered leaves play -> forEach all characters dealDamage 1; draw 1", "activated CRUSH WAVE: pay2 + destroy self -> forEach all characters dealDamage 1"],
  behavior: B([
    leaves([{ type: "forEach", selector: { type: "character" }, effects: [dmg(CAND, 1)] }, draw(1)]),
    { id: "crush-wave", type: "activated", costs: [payR(2), destroy("source")], effects: [{ type: "forEach", selector: { type: "character" }, effects: [dmg(CAND, 1)] }] }
  ])
});

// Balthassar Gristwalter — UNIQUE BALTHASSAR; SCHMOOZE: deplete self -> draw
V("22b26c82-ef59-4885-8d11-e58a81c660da", {
  unique: "balthassar",
  shapes: ["activated SCHMOOZE: deplete self -> draw 1"],
  behavior: B([{ id: "schmooze", type: "activated", costs: [deplete("source")], effects: [draw(1)] }])
});

// Black Scourge of the Brine — ENCROACH [G]x5: pay1 -> this turn gains COVERT
V("7486055f-27a9-4a78-9d9f-3420e031dcdc", {
  shapes: ["activated ENCROACH (threshold [G]x5): pay1 -> grantKeyword covert UEOT to self"],
  behavior: B([{ id: "encroach", type: "activated", threshold: "ggggg", costs: [payR(1)], effects: [grantKw("source", "covert", UEOT)] }])
});

// Blazing Shriever — INFLAME: pay2 + destroy self + pick char/loc -> X dmg (X=[R] count)
V("8c45da38-c37a-41cc-8205-ac2b50fa8fd4", {
  shapes: ["activated INFLAME: pay2 + destroy self; pick char or location -> dealDamage X ([R] count)"],
  behavior: B([{
    id: "inflame", type: "activated", costs: [payR(2), destroy("source")],
    targets: [pick("t", { conditions: [{ type: "or", conditions: [{ type: "cardTypeIs", target: CAND, cardType: "character" }, { type: "cardTypeIs", target: CAND, cardType: "location" }] }] })],
    effects: [dmg(S("t"), icons("rage"))]
  }])
});

// Booty Licker — CLAIM: deplete self + pick item + pay X (X=its cost) -> take control; FLIP UP 2 [D][D][D]
V("00df2c7c-19b4-45c3-8a11-eab3ccf19052", {
  flipUp: { cost: 2, threshold: "ddd" },
  shapes: ["activated CLAIM: deplete self; pick item; pay cardCost(item) -> takeControl", "flip-up 2 [D][D][D]"],
  behavior: B([{
    id: "claim", type: "activated", costs: [deplete("source")],
    targets: [pick("it", { type: "item" })],
    effects: [{ type: "mayPay", player: "controller", costs: [payR(cardCost(S("it")))], effects: [{ type: "takeControl", target: S("it"), controller: "controller" }], elseEffects: [] }]
  }])
});

// Caboodling Gladhander — EXTRA COST may pick char; ETB if picked destroy it, its controller gains X influence (X=strength)
V("d75f8c4e-5fd7-4169-8daa-051c703fb089", {
  shapes: ["behavior.onPlay: may pick a character", "ETB: if picked, bind s=strength; destroy it; modifyInfluence {controllerOf picked, +s}"],
  behavior: {
    onPlay: { targets: [pick("c", { type: "character" }, 1, { optional: true })] },
    abilities: [etb([ifExists("c", [
      { type: "bind", id: "s", value: { type: "stat", target: S("c"), stat: "strength" } },
      destroy(S("c")),
      { type: "modifyInfluence", player: { type: "controllerOf", target: S("c") }, amount: { type: "variable", id: "s" } }
    ])])]
  }
});

VANILLA("54e4d0a0-0a00-4b1d-bbc8-9f0fa1e05144"); // Casino Kingpin

// Chancellor of Reinstatement — REINSTATE: pay4 + destroy self + pick char in discard -> into play if cost<=X ([G] count)
V("e512bf6c-96d0-4575-b8b7-9ebf61ed6d98", {
  shapes: ["activated REINSTATE: pay4 + destroy self; pick char in discard -> if cardCost<=[G] count, putIntoPlay"],
  behavior: B([{
    id: "reinstate", type: "activated", costs: [payR(4), destroy("source")],
    targets: [pick("c", { type: "character", zone: "discard", owner: "self" })],
    effects: [{ type: "if", condition: { type: "numberCompare", left: cardCost(S("c")), operator: "<=", right: icons("greed") }, effects: [{ type: "putIntoPlay", target: S("c"), controller: "controller" }] }]
  }])
});

// Circumspect Hijacker — reprint (Ungodly Mess). [G][G][G]: ETB draw; RETREAT: pay2 + destroy self -> draw
V("84f4481a-b22c-4c95-88a1-13cfbeb7d910", {
  notes: "Text-identical reprint of Circumspect Hijacker (Ungodly Mess).",
  shapes: ["triggered cardEnteredPlay gated [G][G][G] -> draw", "activated RETREAT: pay2 + destroy self -> draw"],
  behavior: B([
    { id: "ggg-etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, iconGate("greed", 3)] }, effects: [draw(1)] },
    { id: "retreat", type: "activated", costs: [payR(2), destroy("source")], effects: [draw(1)] }
  ])
});

// Cloaked Weaponmaster — you may deploy gear cards whenever you could deploy a tactic
V("cc4064e8-ba75-4eab-89bd-f1d90d44429b", {
  conf: "medium",
  notes: "'You may deploy gear cards whenever you could deploy a tactic' = grant TACTICAL to your gear cards in hand (ContinuousAbility.activeZone 'hand', keywords grant to selector {controller:self, zone:hand, subtype:gear}).",
  shapes: ["continuous activeZone hand: grant keyword tactical to {controller:self, subtype:gear} in hand"],
  behavior: B([{ id: "gear-instant", type: "continuous", activeZone: "hand", modifiers: [], keywords: [{ selector: { controller: "self", zone: "hand", subtype: "gear" }, keyword: "tactical" }] }])
});

// Colossal Flattener — while attacking, may assign battle dmg to attack target instead of blockers = redirectDamage keyword
KW("c0506479-0cf8-49f3-944e-15c3d75c5458", ["redirectDamage"], {
  notes: "'while attacking, may assign battle damage to the target of the attack instead of the blocking party' IS the redirectDamage keyword (getLegalBattleDamageTargets appends the attack target as an extra option)."
});

// Confounding Conjurer — EXTRA COST may pick char; ETB if picked bounce to owner hand
V("9559b131-09f2-4dfd-884e-8fd07106045e", {
  shapes: ["behavior.onPlay: may pick a character", "ETB: if picked, moveCard -> owner hand"],
  behavior: {
    onPlay: { targets: [pick("c", { type: "character" }, 1, { optional: true })] },
    abilities: [etb([ifExists("c", [moveTo(S("c"), "hand")])])]
  }
});

// Courageous Paladin — all battle dmg that could be assigned to this must be
V("85630d60-8a6f-457c-8f41-2d3e75a19d56", {
  caps: ["must-receive-battle-damage"],
  shapes: ["continuous: mustReceiveBattleDamage (damage magnet)"],
  behavior: B([{ id: "magnet", type: "continuous", modifiers: [], mustReceiveBattleDamage: true }])
});

// Cowering Golem — while in a battle, loses 1 str/1 life per member of opposing party
V("89471657-b806-44ed-a481-d0374566828d", {
  shapes: ["continuous: while inBattle(source), modifiers str/life -= battlePartySize(opposingParty)"],
  behavior: B([{
    id: "shrink", type: "continuous", condition: { type: "inBattle", target: "source" },
    modifiers: [
      mod("source", "strength", "add", { type: "multiply", values: [{ type: "battlePartySize", side: "opposingParty" }, -1] }),
      mod("source", "life", "add", { type: "multiply", values: [{ type: "battlePartySize", side: "opposingParty" }, -1] })
    ]
  }])
});

// D3ck W4rd3n — ETB faction loses 2 influence
V("7e0f3b4c-668a-4d4e-a82e-e6996cd6b0c2", {
  shapes: ["ETB: modifyInfluence -2"],
  behavior: B([etb([infl(-2)])])
});

// Dauntless Gambler — ETB may choose a card type; reveal top; if that type put a token; put top on bottom. While token, +1/+1
V("1a6323e1-ea9a-4ea0-acee-0eaa9b61a9c1", {
  conf: "medium",
  notes: "'choose a card type' modelled as chooserSelectsOption over the 5 types; each option reveals the top card (bind), checks cardTypeIs, conditionally addCounter, then bottoms the top card.",
  shapes: ["ETB: chooserSelectsOption(5 card types) each -> if top card is that type addCounter token; move top->bottom", "continuous while token: +1/+1"],
  behavior: B([
    etb([{
      type: "chooserSelectsOption", chooser: "controller",
      options: ["character", "item", "location", "tactic", "resource"].map(t => ({
        label: t,
        effects: [
          { type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: t }, effects: [addTok("source", 1)] },
          moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "deck", { position: "bottom" })
        ]
      }))
    }]),
    tokenBuff("token-buff", [mod("source", "strength", "add", 1), mod("source", "life", "add", 1)])
  ])
});

// Dazzling Trapezist — INSPIRE: put a hand card on top of deck + pick char -> this turn +1 speed
V("4fb63483-4a2d-4052-bebd-1806223eeb40", {
  shapes: ["activated INSPIRE: moveSelected hand->deck top; pick char -> createModifier speed +1 UEOT"],
  behavior: B([{
    id: "inspire", type: "activated",
    costs: [{ type: "moveSelected", id: "tuck", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1, to: "deck", position: "top" }],
    targets: [pick("c", { type: "character" })],
    effects: [cmod(S("c"), "speed", "add", 1, UEOT)]
  }])
});

// Defiler of Innocence — CORRUPT: pay2 + pick char -> this turn covert. DEFILE: deplete self -> opp discards a character from hand
V("0f0e1fc8-b7e1-462f-a912-60d2ca99d458", {
  shapes: ["activated CORRUPT: pay2; pick char -> grantKeyword covert UEOT", "activated DEFILE: deplete self -> discard a character from opp hand"],
  behavior: B([
    { id: "corrupt", type: "activated", costs: [payR(2)], targets: [pick("c", { type: "character" })], effects: [grantKw(S("c"), "covert", UEOT)] },
    { id: "defile", type: "activated", costs: [deplete("source")], effects: [discardFromOppHand([{ type: "cardTypeIs", target: CAND, cardType: "character" }])] }
  ])
});

// Dragon Archer — EXTRA COST may pick char; ETB if picked: X=that char str, Y=this str; X dmg to self, Y dmg to that char
V("93e4898c-75ad-4a4f-82c0-8c21ccf9fed5", {
  shapes: ["behavior.onPlay: may pick a character", "ETB: if picked, bind x=picked.str, y=source.str; dealDamage x to source; dealDamage y to picked"],
  behavior: {
    onPlay: { targets: [pick("c", { type: "character" }, 1, { optional: true })] },
    abilities: [etb([ifExists("c", [
      { type: "bind", id: "x", value: { type: "stat", target: S("c"), stat: "strength" } },
      { type: "bind", id: "y", value: { type: "stat", target: "source", stat: "strength" } },
      dmg("source", { type: "variable", id: "x" }),
      dmg(S("c"), { type: "variable", id: "y" })
    ])])]
  }
});

// Drivey Car — leaves play: put X Micromajig tokens into play, X = opp chars - your chars
V("16a1de58-a23b-49c4-a3da-c696b92a74c6", {
  shapes: ["triggered leaves play -> createTokens Micromajig, count = count(opp chars) - count(self chars)"],
  behavior: B([leaves([{
    type: "createTokens", controller: "controller",
    count: { type: "add", values: [{ type: "count", selector: { controller: "opponent", type: "character" } }, { type: "multiply", values: [{ type: "count", selector: { controller: "self", type: "character" } }, -1] }] },
    token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 }
  }])])
});

// Elzibeth, Military Sorceress — UNIQUE ELZIBETH; REANIMATE: pay2 + deplete self + pick char in discard -> top of owner deck
V("d4611011-17cd-42a7-a15e-53b0ba75e23d", {
  unique: "elzibeth",
  shapes: ["activated REANIMATE: pay2 + deplete self; pick char in discard -> moveCard deck top (owner)"],
  behavior: B([{
    id: "reanimate", type: "activated", costs: [payR(2), deplete("source")],
    targets: [pick("c", { type: "character", zone: "discard", owner: "self" })],
    effects: [moveTo(S("c"), "deck", { position: "top" })]
  }])
});

// Enduring Swordsman — leaves play: may pick char -> 1 dmg to it
V("c793f1b9-b4c4-48f4-b076-8074f2e6eb30", {
  shapes: ["triggered leaves play -> mayPick character -> dealDamage 1"],
  behavior: B([leaves([mayPick("c", { type: "character" }, [dmg(S("c"), 1)])])])
});

// Ensorcelled Familiar — ETB may search deck for tactic -> hand; RECUR [O][O][O] from discard: pay2 + exile self + pick tactic in discard -> hand
V("9d9e48cb-83f4-4b81-8a86-1a0c2b18e282", {
  shapes: ["ETB: search deck for a tactic -> hand", "RECUR [O][O][O]: pay2 + exile self; pick tactic in discard -> hand"],
  behavior: B([
    etb([searchToHand({ type: "tactic" }, true)]),
    recur("ooo", 2, [{ type: "forEach", selected: "rt", effects: [moveTo(CAND, "hand")] }], [pick("rt", { type: "tactic", zone: "discard", owner: "self" })])
  ])
});

// Fervent Beastslayer — [R]x5: this card gains 3 life
V("726aa869-bbaf-4c79-8dc7-eb3367282a88", {
  shapes: ["activated (threshold [R]x5): createModifier life +3 permanent"],
  behavior: B([iconPump("life", "rrrrr", [["life", "add", 3]])])
});

// Fiscal Intercessor — PLEAD: deplete self + pick char -> if dmg inflicted to it this turn, reduce by 1
V("bdb490e9-ab52-4417-86da-97928dbd394f", {
  conf: "medium",
  notes: "'If damage is inflicted to the character this turn, reduce the amount by 1' modelled as a preventDamage 'reduce' shield of 1 on the target (absorbs 1 point of the next damage this turn). CONCESSION: printed text arguably reduces every instance this turn, not just the next.",
  shapes: ["activated PLEAD: deplete self; pick char -> preventDamage reduce 1"],
  behavior: B([{ id: "plead", type: "activated", costs: [deplete("source")], targets: [pick("c", { type: "character" })], effects: [{ type: "preventDamage", target: S("c"), amount: 1, mode: "reduce" }] }])
});

// Flabbergasting Philosopher — TACTICAL; ETB faction gains 4 influence; FLIP UP 4 [G][G]
V("0c200267-b2b0-427b-980a-be56821251f5", {
  flipUp: { cost: 4, threshold: "gg" }, meta: { keywords: ["tactical"] },
  shapes: ["keyword tactical", "ETB: modifyInfluence +4", "flip-up 4 [G][G]"],
  behavior: { keywords: ["tactical"], abilities: [etb([infl(4)])] }
});

// Flagitious Denunciator — COVERT; DENOUNCE: pay2 + pick char + destroy self -> bounce char + discard a character from opp hand
V("cae163fe-b4bb-4dde-9227-05359c5961ac", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "activated DENOUNCE: pay2 + destroy self; pick char -> moveCard owner hand; discard a character from opp hand"],
  behavior: {
    keywords: ["covert"],
    abilities: [{
      id: "denounce", type: "activated", costs: [payR(2), destroy("source")],
      targets: [pick("c", { type: "character" })],
      effects: [moveTo(S("c"), "hand"), discardFromOppHand([{ type: "cardTypeIs", target: CAND, cardType: "character" }])]
    }]
  }
});

// Fleet Golem — ETB may pay5 -> token; while token, cannot be blocked
V("920611b1-1ee4-42a2-a1a1-ec4ef8d5e8ac", {
  shapes: ["ETB mayPay 5 -> addCounter token", "continuous while token: keyword cannotBeBlocked"],
  behavior: B([mayPayToken(5), tokenBuff("token-unblock", []) ])
});
P["920611b1-1ee4-42a2-a1a1-ec4ef8d5e8ac"].behavior.abilities[1] = { id: "token-unblock", type: "continuous", condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 }, modifiers: [], keywords: [{ target: "source", keyword: "cannotBeBlocked" }] };

// Flimflam Man — ETB may choose a card type; reveal top; if that type -> hand, else bottom
V("24de2269-2902-4800-a2f9-2ad2de1f1ee5", {
  conf: "medium",
  notes: "'choose a card type' modelled as chooserSelectsOption over the 5 types; each -> if top card is that type moveCard top->hand, else top->bottom.",
  shapes: ["ETB: chooserSelectsOption(5 card types) each -> if top is that type top->hand else top->bottom"],
  behavior: B([etb([{
    type: "chooserSelectsOption", chooser: "controller",
    options: ["character", "item", "location", "tactic", "resource"].map(t => ({
      label: t,
      effects: [{
        type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: t },
        effects: [moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "hand")]
      }, {
        type: "if", condition: { type: "not", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: t } },
        effects: [moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "deck", { position: "bottom" })]
      }]
    }))
  }])])
});

// Foolhardy Desperado — COVERT; when this inflicts battle damage, faction loses 2 influence
V("46809554-551a-484e-9c20-b505fabc6df1", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "triggered damageDealt by source (battle) -> modifyInfluence -2"],
  behavior: { keywords: ["covert"], abilities: [onDealBattleDmg("bleed", [infl(-2)])] }
});

// Foul Diviner — EXTRA COST: remove a tactic in discard from game
V("37df361e-ae24-4f59-9094-c638ffcec0e3", {
  shapes: ["behavior.onPlay cost: moveSelected tactic in discard -> removed"],
  behavior: { onPlay: { costs: [{ type: "moveSelected", id: "exile", player: "controller", selector: { owner: "self", zone: "discard", type: "tactic" }, count: 1, to: "removed" }] } }
});

// Fountain Diver — RECUR [G] from discard: pay1 + exile self + pick char -> this turn +3 life
V("a5439765-aa03-4443-8a26-5275e8e07370", {
  shapes: ["RECUR [G]: pay1 + exile self; pick char -> createModifier life +3 UEOT"],
  behavior: B([recur("g", 1, [cmod(S("rc"), "life", "add", 3, UEOT)], [pick("rc", { type: "character" })])])
});

// Frenzied Shriever — when this inflicts battle dmg to a character, +2
V("9c292d45-b266-4caf-9b7d-8fd31af4efc8", {
  shapes: ["continuous damageModifiers: sourceSelector self, target characters, battleOnly, +2"],
  behavior: B([{ id: "boost", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "character" }, sourceSelector: { conditions: [{ type: "isCard", target: CAND, other: "source" }] }, battleOnly: true, delta: 2 }] }])
});

// Frisky Fortunehunter — ETB faction loses 2; leaves play faction gains 4
V("3cc5ddb3-ea85-4582-9a11-e24ae0119237", {
  shapes: ["ETB: modifyInfluence -2", "triggered leaves play: modifyInfluence +4"],
  behavior: B([etb([infl(-2)]), leaves([infl(4)])])
});

// Gallant Commander — CHARGE!: pay2 + destroy self -> 3 dmg to an opponent's faction
V("53178e50-33bf-47f7-ace0-20f9e7e88c52", {
  shapes: ["activated CHARGE!: pay2 + destroy self -> dealDamage 3 to opponent faction"],
  behavior: B([{ id: "charge", type: "activated", costs: [payR(2), destroy("source")], effects: [dmg(factionOf("opponent"), 3)] }])
});

// Gideon, the Ultimate Warrior — UNIQUE GIDEON; while attacking battle dmg to this -> 0; when opp faction loses influence, +1
V("fefe5571-41c7-4a9b-844e-88e2232f6c28", {
  unique: "gideon",
  shapes: ["continuous while inBattle(source, attacker): damageModifiers battle dmg to source -> 0", "continuous influenceModifiers: opponent loss +1"],
  behavior: B([
    { id: "shield", type: "continuous", condition: { type: "inBattle", target: "source", role: "attacker" }, modifiers: [], damageModifiers: [{ selector: { conditions: [{ type: "isCard", target: CAND, other: "source" }] }, battleOnly: true, delta: 0, minAmount: 1, setTo: 0 }] },
    { id: "amplify", type: "continuous", modifiers: [], influenceModifiers: [{ player: "opponent", direction: "loss", delta: -1 }] }
  ])
});

// Godwing Thunderhoof — UNIQUE GODWING; when this attacks, may pick char -> X dmg (X=[R] count)
V("6d3f7916-4277-4fc3-b037-59859c50d7f9", {
  unique: "godwing",
  shapes: ["triggered characterAttacked (source) -> mayPick character -> dealDamage [R] count"],
  behavior: B([onAttack([mayPick("c", { type: "character" }, [dmg(S("c"), icons("rage"))])])])
});

// Guttersnipe — TACTICAL; FLIP UP 0 [D][D]
V("90765f47-153f-4924-82fc-ce39dadacaee", {
  flipUp: { cost: 0, threshold: "dd" }, meta: { keywords: ["tactical"] },
  shapes: ["keyword tactical", "flip-up 0 [D][D]"],
  behavior: { keywords: ["tactical"] }
});

// Harbinger of Anguish — DEMOTIVATE: pay1 + deplete self + pick char -> this turn -1 life
V("783bcae6-08af-475b-bd25-36c3d331b046", {
  shapes: ["activated DEMOTIVATE: pay1 + deplete self; pick char -> createModifier life -1 UEOT"],
  behavior: B([{ id: "demotivate", type: "activated", costs: [payR(1), deplete("source")], targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "life", "add", -1, UEOT)] }])
});

// High-Priest of Thabbash — UNIQUE GLOAMSPIKE; NEGATE: pay2 + deplete self + discard a card + pick a deploying card of same type -> terminate
V("c6f8eb7b-7bdb-46fd-b971-ec3846491423", {
  unique: "gloamspike",
  shapes: ["activated NEGATE: pay2 + deplete self + discard {id:disc}; pick a card in zone 'deploying' with cardTypeEquals(disc) -> terminate"],
  behavior: B([{
    id: "negate", type: "activated",
    costs: [payR(2), deplete("source"), { type: "discard", id: "disc", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }],
    targets: [pick("dep", { zone: "deploying", conditions: [{ type: "cardTypeEquals", target: CAND, other: S("disc") }] })],
    effects: [{ type: "terminate", target: S("dep") }]
  }])
});

// Horrendous Behemoth — while in a battle, opposing-party characters lose 1 str/1 speed
V("22822a80-f23d-4852-a1be-cea7fd5f0b37", {
  shapes: ["continuous while inBattle(source): aura str/speed -1 on {type:character, inBattle & not sharesBattlePartyWithSource}"],
  behavior: B([{
    id: "wither", type: "continuous", condition: { type: "inBattle", target: "source" },
    modifiers: ["strength", "speed"].map(stat => ({
      selector: { type: "character", conditions: [{ type: "inBattle", target: CAND }, { type: "not", condition: { type: "sharesBattlePartyWithSource", target: CAND } }] },
      stat, operation: "add", value: -1
    }))
  }])
});

// Horrifying Brain-Monkey — SLOBBER: pay4 + destroy self + pick char -> destroy if str<=X ([O] count)
V("dfdadbf6-492e-4d40-aa99-b4ca43399e61", {
  shapes: ["activated SLOBBER: pay4 + destroy self; pick char -> if statCompare(str<=[O] count) destroy"],
  behavior: B([{
    id: "slobber", type: "activated", costs: [payR(4), destroy("source")],
    targets: [pick("c", { type: "character" })],
    effects: [{ type: "if", condition: { type: "statCompare", target: S("c"), stat: "strength", operator: "<=", value: icons("obsession") }, effects: [destroy(S("c"))] }]
  }])
});

// Hypnotic Illusionist — HYPNOTIZE: pay5 + destroy self + pick char -> take control if cost<=X ([D] count)
V("30eb5290-a83b-476a-83dd-af1851cd9a9d", {
  shapes: ["activated HYPNOTIZE: pay5 + destroy self; pick char -> if cardCost<=[D] count takeControl"],
  behavior: B([{
    id: "hypnotize", type: "activated", costs: [payR(5), destroy("source")],
    targets: [pick("c", { type: "character" })],
    effects: [{ type: "if", condition: { type: "numberCompare", left: cardCost(S("c")), operator: "<=", right: icons("deception") }, effects: [{ type: "takeControl", target: S("c"), controller: "controller" }] }]
  }])
});

// Idol Smasher — EXTRA COST may pick item; ETB if picked destroy it
V("c7789461-b3e1-45af-9044-4caf5f63816e", {
  shapes: ["behavior.onPlay: may pick an item", "ETB: if picked, destroy it"],
  behavior: { onPlay: { targets: [pick("it", { type: "item" }, 1, { optional: true })] }, abilities: [etb([ifExists("it", [destroy(S("it"))])])] }
});

// Impressive Hero — EXTRA COST may pick char; ETB if picked deplete it
V("4c77f9cd-98d3-4a48-bdc9-81ae09b4867b", {
  shapes: ["behavior.onPlay: may pick a character", "ETB: if picked, deplete it"],
  behavior: { onPlay: { targets: [pick("c", { type: "character" }, 1, { optional: true })] }, abilities: [etb([ifExists("c", [deplete(S("c"))])])] }
});

// Inconspicuous Golem — ETB may pay1 -> token; while token, canBlockCovert
V("604aa4d1-2a70-436e-9b4e-20e08cf6b6b8", {
  shapes: ["ETB mayPay 1 -> addCounter token", "continuous while token: keyword canBlockCovert"],
  behavior: B([mayPayToken(1), { id: "token-block", type: "continuous", condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 }, modifiers: [], keywords: [{ target: "source", keyword: "canBlockCovert" }] }])
});

// Ingenious Tinker — ETB reduce next numeric cost by 3
V("827e74b0-ab0e-4dee-a998-80f556d831f6", {
  shapes: ["ETB: reduceNextCost 3"],
  behavior: B([etb([{ type: "reduceNextCost", player: "controller", amount: 3 }])])
});

// Lingamite Torture Monk — TORTURE: pick char you own + destroy self -> bounce to owner hand; RECUR [O][O]
V("50589b1c-62b6-4eaf-a098-6680ffb520c3", {
  shapes: ["activated TORTURE: destroy self; pick char you own -> moveCard owner hand", "RECUR [O][O]: pay2 + exile self; pick char you own -> owner hand"],
  behavior: B([
    { id: "torture", type: "activated", costs: [destroy("source")], targets: [pick("c", { type: "character", owner: "self" })], effects: [moveTo(S("c"), "hand")] },
    recur("oo", 2, [moveTo(S("rc"), "hand")], [pick("rc", { type: "character", owner: "self" })])
  ])
});

// Living God of Thabbash — when a char you control leaves play, opp discards a card; HIGHER CALLING: pay2 + pick char you control -> bounce
V("bc206d76-e136-4096-8ebb-a3abe1288b83", {
  shapes: ["triggered cardMoved (char you control leaves play) -> opp discards a card", "activated HIGHER CALLING: pay2; pick char you control -> moveCard owner hand"],
  behavior: B([
    { id: "toll", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "cardMovedFromZone", zone: "play" }, { type: "cardTypeIs", target: "eventCard", cardType: "character" }, { type: "eventCardControlledBy", player: "controller" }] }, effects: [oppDiscards(1)] },
    { id: "higher-calling", type: "activated", costs: [payR(2)], targets: [pick("c", { type: "character", controller: "self" })], effects: [moveTo(S("c"), "hand")] }
  ])
});

VANILLA("fe09a3da-fca9-4d80-b7d6-7f25d5e55e6b"); // Massive Erecting Golem

// Master Mud Whisperer — at start of each opp turn, may restore all characters you control
V("3256cb1c-e1b5-4b46-b7a7-7c5fad249ef4", {
  shapes: ["triggered turnStarted (opponent) -> chooserSelectsOption[decline / forEach {controller:self,type:character} restore]"],
  behavior: B([startTurn("recharge-all", [{
    type: "chooserSelectsOption", chooser: "controller",
    options: [{ label: "Decline", effects: [] }, { label: "Restore all", effects: [{ type: "forEach", selector: { controller: "self", type: "character" }, effects: [restore(CAND)] }] }]
  }], { who: "opponent" })])
});

// Maxwell Cockswagger — UNIQUE MAXWELL; STRUT: pay2 + pick char -> this turn +1 speed OR -1 life
V("01077dac-1b52-4af9-a73c-7b64f71058b0", {
  unique: "maxwell",
  shapes: ["activated STRUT: pay2; pick char -> chooserSelectsOption[+1 speed / -1 life] UEOT"],
  behavior: B([{
    id: "strut", type: "activated", costs: [payR(2)], targets: [pick("c", { type: "character" })],
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "+1 speed", effects: [cmod(S("c"), "speed", "add", 1, UEOT)] },
      { label: "-1 life", effects: [cmod(S("c"), "life", "add", -1, UEOT)] }
    ] }]
  }])
});

// Mesmerizing Enchantress — EXTRA COST may pick <=4 chars; ETB if picked they cannot attack until start of your next turn
V("21b1e122-c3d4-4364-9aed-863cab62ee53", {
  shapes: ["behavior.onPlay: may pick 4-or-fewer characters", "ETB: forEach picked -> grantRestriction cannotAttack untilStartOfNextTurn"],
  behavior: {
    onPlay: { targets: [pick("cs", { type: "character" }, 4, { optional: true })] },
    abilities: [etb([{ type: "forEach", selected: "cs", effects: [grantRes(CAND, "cannotAttack", USNT)] }])]
  }
});

// Montgomery Blatherscythe — UNIQUE MONTGOMERY; RESURRECT: pay1 + deplete self + pick char in discard cost<=2 -> into play
V("295d16d0-7923-4153-8ee2-c7d927fe68d8", {
  unique: "montgomery",
  shapes: ["activated RESURRECT: pay1 + deplete self; pick char in discard with cost<=2 -> putIntoPlay"],
  behavior: B([{
    id: "resurrect", type: "activated", costs: [payR(1), deplete("source")],
    targets: [pick("c", { type: "character", zone: "discard", owner: "self", conditions: [{ type: "numberCompare", left: cardCost(CAND), operator: "<=", right: 2 }] })],
    effects: [{ type: "putIntoPlay", target: S("c"), controller: "controller" }]
  }])
});

// Mountainous Golem — cannotBeTakenControl; when put into discard from anywhere -> removed; FLIP UP 13 [E][E]
V("c5262c5b-9ef2-40ed-9f16-29b391b39a11", {
  flipUp: { cost: 13, threshold: "ee" },
  shapes: ["continuous restriction cannotBeTakenControl (self)", "triggered cardMoved (self -> discard from any zone) -> removeFromGame", "flip-up 13 [E][E]"],
  behavior: B([
    { id: "no-steal", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBeTakenControl" }] },
    { id: "exile-on-discard", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedToZone", zone: "discard" }] }, effects: [rfg("source")] }
  ])
});

// Mud Whisperer Wannabe — when this blocks, may pick char -> restore it
V("7496f5a7-efcf-40d3-838e-417241f125af", {
  shapes: ["triggered characterBlocked (source) -> mayPick character -> restore"],
  behavior: B([onBlock([mayPick("c", { type: "character" }, [restore(S("c"))])])])
});

// Multi-Attachment Man — reprint (Ungodly Mess). when destroyed, may search deck for an item -> hand
V("db82f8c3-503c-405c-b067-223752b2cad3", {
  notes: "Text-identical reprint of Multi-Attachment Man (Ungodly Mess).",
  shapes: ["triggered cardDestroyed (source) -> search deck for an item -> hand"],
  behavior: B([{ id: "salvage", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [searchToHand({ type: "item" }, true)] }])
});

// Mundane Pupil — ETB may pay3 -> token; while token +1/+1
V("d0666557-9aec-453e-948a-abb32fa3cb10", {
  shapes: ["ETB mayPay 3 -> addCounter token", "continuous while token: +1/+1"],
  behavior: B([mayPayToken(3), tokenBuff("token-buff", [mod("source", "strength", "add", 1), mod("source", "life", "add", 1)])])
});

// Nefarious Horror — COVERT; while opp controls more chars than you, +2/+2 and loses COVERT
V("287fad39-5bc3-499b-9099-f95294af36e6", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "continuous while count(opp chars) > count(self chars): +2/+2, suppressKeywords covert"],
  behavior: {
    keywords: ["covert"],
    abilities: [{
      id: "enrage", type: "continuous",
      condition: { type: "numberCompare", left: { type: "count", selector: { controller: "opponent", type: "character" } }, operator: ">", right: { type: "count", selector: { controller: "self", type: "character" } } },
      modifiers: [mod("source", "strength", "add", 2), mod("source", "life", "add", 2)],
      suppressKeywords: [{ target: "source", keyword: "covert" }]
    }]
  }
});

VANILLA("1e3c2d25-0380-4d47-bd33-54b877476c3b"); // Nimble Conscript

// Obtuse Pipesmoker — [D]x5: +1/+1/+1
V("6201f5e4-9b41-497c-9634-dc2ac6847ea2", {
  shapes: ["activated (threshold [D]x5): createModifier str/life/speed +1 permanent"],
  behavior: B([iconPump("pump", "ddddd", [["strength", "add", 1], ["life", "add", 1], ["speed", "add", 1]])])
});

// Oddment Collector — ETB with 5 tokens; +1/+1 per token; when depleted rmTok; GATHER: pay1 + exile (item OR 2 cards) in discard -> addTok
V("90b08f5a-4e31-4d3a-b481-c4d4d51a93a4", {
  shapes: ["ETB addCounter token 5", "continuous: str/life += counter token", "triggered cardDepleted (source) -> removeCounter token 1", "activated GATHER: pay1 + oneOf(exile 1 item / 2 cards in discard) -> addCounter token 1"],
  behavior: B([
    etb([addTok("source", 5)]),
    { id: "grow", type: "continuous", modifiers: [mod("source", "strength", "add", cnt("source")), mod("source", "life", "add", cnt("source"))] },
    { id: "decay", type: "triggered", event: "cardDepleted", condition: { type: "sourceIsEventCard" }, effects: [rmTok("source", 1)] },
    { id: "gather", type: "activated", costs: [payR(1), { type: "oneOf", options: [
      [{ type: "moveSelected", id: "g1", player: "controller", selector: { owner: "self", zone: "discard", type: "item" }, count: 1, to: "removed" }],
      [{ type: "moveSelected", id: "g2", player: "controller", selector: { owner: "self", zone: "discard" }, count: 2, to: "removed" }]
    ] }], effects: [addTok("source", 1)] }
  ])
});

// Opportune Slotpuller — GAMBLE: pay1 + choose card type -> reveal top; if that type this turn +2 str -1 life; top->bottom
V("b176a78f-7145-4635-943c-4b41e21279bd", {
  conf: "medium",
  notes: "'choose a card type' as chooserSelectsOption over the 5 types.",
  shapes: ["activated GAMBLE: pay1 -> chooserSelectsOption(5 types) each -> if top is that type createModifier str+2/life-1 UEOT; top->bottom"],
  behavior: B([{
    id: "gamble", type: "activated", costs: [payR(1)],
    effects: [{
      type: "chooserSelectsOption", chooser: "controller",
      options: ["character", "item", "location", "tactic", "resource"].map(t => ({
        label: t,
        effects: [
          { type: "if", condition: { type: "cardTypeIs", target: { type: "deckPosition", player: "controller", from: "top", index: 0 }, cardType: t }, effects: [cmod("source", "strength", "add", 2, UEOT), cmod("source", "life", "add", -1, UEOT)] },
          moveTo({ type: "deckPosition", player: "controller", from: "top", index: 0 }, "deck", { position: "bottom" })
        ]
      }))
    }]
  }])
});

// Perturbatious Warlock — ETB an opponent puts a card from hand on top of their deck
V("7d385558-dd68-4c00-9c20-0a60daf86d86", {
  shapes: ["ETB: chooserSelectsTarget chooser opponent, hand card -> moveCard deck top"],
  behavior: B([etb([{
    type: "chooserSelectsTarget", chooser: "opponent",
    declaration: { id: "t", selector: { owner: "opponent", zone: "hand" }, count: 1, optional: false },
    effects: [{ type: "forEach", selected: "t", effects: [moveTo(CAND, "deck", { position: "top" })] }]
  }])])
});

// Pilgrimage Auditor — IMPEDE: deplete self + pick char -> deplete it
V("842d8014-282d-4ee0-8510-92c2c13a8291", {
  shapes: ["activated IMPEDE: deplete self; pick char -> deplete"],
  behavior: B([{ id: "impede", type: "activated", costs: [deplete("source")], targets: [pick("c", { type: "character" })], effects: [deplete(S("c"))] }])
});

// Pit Boss — +1 speed per [D] you control
V("2a855fa9-5c88-419f-b0ec-ba0451340de8", {
  shapes: ["continuous: speed += [D] count"],
  behavior: B([{ id: "hustle", type: "continuous", modifiers: [mod("source", "speed", "add", icons("deception"))] }])
});

// Portly Tradesmau — when this blocks, draw X (X = chars in attacking party)
V("1c974981-51dc-4a75-985c-116089fd9356", {
  shapes: ["triggered characterBlocked (source) -> draw battlePartySize(attacking)"],
  behavior: B([onBlock([draw({ type: "battlePartySize", side: "attacking" })])])
});

// Prehensile Pirate — EXTRA COST: remove 4 cards in discard from game
V("3969a272-2b6b-44b1-a95c-97303534163a", {
  shapes: ["behavior.onPlay cost: moveSelected 4 cards in discard -> removed"],
  behavior: { onPlay: { costs: [{ type: "moveSelected", id: "exile4", player: "controller", selector: { owner: "self", zone: "discard" }, count: 4, to: "removed" }] } }
});

// Preponderant Craftsman — CREATE: pay5 + deplete self -> deploy a character for free
V("6e230ad3-7373-4c32-a098-26cbb1530b4c", {
  shapes: ["activated CREATE: pay5 + deplete self -> deployForFree (character, maxCost large)"],
  behavior: B([{ id: "create", type: "activated", costs: [payR(5), deplete("source")], effects: [{ type: "deployForFree", player: "controller", maxCost: 99, selector: { type: "character" }, free: true }] }])
});

// Proficient Battler — FLIP UP 2 [R] only
V("c00a8848-aced-44df-a203-e4dfb0e3b0ad", { flipUp: { cost: 2, threshold: "r" }, shapes: ["flip-up 2 [R]"], behavior: {} });

// Property Condemner — ETB may pick location -> destroy it; FLIP UP 2 [G][G]
V("5c9f3b23-156b-4191-a722-d7e7c5dbf59b", {
  flipUp: { cost: 2, threshold: "gg" },
  shapes: ["ETB: mayPick location -> destroy", "flip-up 2 [G][G]"],
  behavior: B([etb([mayPick("l", { type: "location" }, [destroy(S("l"))])])])
});

// Prostitution Lobbyist — FLIP UP 0 [G] only
V("f3b487f0-f76a-4a72-ad51-030fb5a96c90", { flipUp: { cost: 0, threshold: "g" }, shapes: ["flip-up 0 [G]"], behavior: {} });

// Protractive Golem — [E]x6: +3 str/+3 life/-1 speed
V("d71bb0f8-8a73-4b9e-9b2c-e6feb31345d8", {
  shapes: ["activated (threshold [E]x6): createModifier str+3/life+3/speed-1 permanent"],
  behavior: B([iconPump("pump", "eeeeee", [["strength", "add", 3], ["life", "add", 3], ["speed", "add", -1]])])
});

// Purifying Priest — BANISH: pick location -> next 1 dmg to your faction this turn is redirected to that location
V("9108759f-9c6f-457d-a162-6fbf1204757c", {
  shapes: ["activated BANISH: pick location -> preventDamage on {factionOf controller} mode redirect amount 1 to location"],
  behavior: B([{
    id: "banish", type: "activated", targets: [pick("l", { type: "location" })],
    effects: [{ type: "preventDamage", target: factionOf("controller"), amount: 1, mode: "redirect", redirectTo: S("l") }]
  }])
});

// Righteous Exemplar — [R]x5: +1/+1
V("ef7a641c-efb6-41e7-8648-45124a07681c", {
  shapes: ["activated (threshold [R]x5): createModifier str/life +1 permanent"],
  behavior: B([iconPump("pump", "rrrrr", [["strength", "add", 1], ["life", "add", 1]])])
});

// Robustical Badass — [R][R][R]: at start of your turn, may inflict 1 dmg to an opponent's faction
V("1855fff6-56b5-45df-8792-3436ebb5c3ba", {
  shapes: ["triggered turnStarted (controller) gated [R][R][R] -> chooserSelectsOption[decline / dealDamage 1 to opp faction]"],
  behavior: B([startTurn("bombard", [{
    type: "chooserSelectsOption", chooser: "controller",
    options: [{ label: "Decline", effects: [] }, { label: "1 damage to opponent faction", effects: [dmg(factionOf("opponent"), 1)] }]
  }], { icon: "rage", n: 3 })])
});

// Runic Tattoo Artist — MARK: deplete self + pick char -> this turn +1/+1
V("268e8892-27bf-40dd-9ac0-11d95cd4e87c", {
  shapes: ["activated MARK: deplete self; pick char -> createModifier str/life +1 UEOT"],
  behavior: B([{ id: "mark", type: "activated", costs: [deplete("source")], targets: [pick("c", { type: "character" })], effects: [cmod(S("c"), "strength", "add", 1, UEOT), cmod(S("c"), "life", "add", 1, UEOT)] }])
});

// Runic Whale — ETB may pay3 -> token; while token +4/+4
V("0a66dd7a-c644-4cf1-a92f-1b297b2e3c3c", {
  shapes: ["ETB mayPay 3 -> addCounter token", "continuous while token: +4/+4"],
  behavior: B([mayPayToken(3), tokenBuff("token-buff", [mod("source", "strength", "add", 4), mod("source", "life", "add", 4)])])
});

// Sequestered Hellion — COVERT; FLIP UP 7 [O][O]
V("c5c02126-09fd-41ef-aa76-7f936b202d29", {
  flipUp: { cost: 7, threshold: "oo" }, meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "flip-up 7 [O][O]"],
  behavior: { keywords: ["covert"] }
});

// Shadowy Mugger — COVERT; ETB may search an opponent's deck for a card -> their discard
V("8c9857e6-ba59-4e6d-9459-148426e2bb4a", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "ETB: search opponent deck for any card -> their discard"],
  behavior: { keywords: ["covert"], abilities: [etb([searchOppDeck({}, "discard")])] }
});

// Shrouded Demon — COVERT; [O][O][O]: this card gains 2 life
V("db0e93b4-a1e1-41ef-b564-261d2b81085a", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "activated (threshold [O][O][O]): createModifier life +2 permanent"],
  behavior: { keywords: ["covert"], abilities: [iconPump("pump", "ooo", [["life", "add", 2]])] }
});

// Sin Against Nature — ETB pick a resource you control (incl face-down) -> owner hand
V("3a2d3843-d810-445d-84be-07069fbd5cd6", {
  shapes: ["ETB: pick a resource you control (zone play incl faceDown) -> moveCard owner hand"],
  behavior: B([etb([], [pick("r", { type: "resource", controller: "self", zone: "play" })])])
});
P["3a2d3843-d810-445d-84be-07069fbd5cd6"].behavior.abilities[0].effects = [moveTo(S("r"), "hand")];

// Slick Orator — RECUR [G][G] from discard: exile self -> draw
V("a0265ee4-8de2-46c6-b840-7b04ffdaae66", {
  shapes: ["RECUR [G][G]: exile self -> draw 1"],
  behavior: B([recur("gg", 0, [draw(1)])])
});

// Slinking Bandido — COVERT; when this inflicts dmg to a faction, addTok; +1 str per token
V("09e397f5-747d-48ad-9c40-e1b0b8095fe3", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "triggered damageDealt by source to a faction -> addCounter token 1", "continuous: str += counter token"],
  behavior: {
    keywords: ["covert"],
    abilities: [
      { id: "feed", type: "triggered", event: "damageDealt", condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "faction" }] }, effects: [addTok("source", 1)] },
      { id: "grow", type: "continuous", modifiers: [mod("source", "strength", "add", cnt("source"))] }
    ]
  }
});

// Sly Bilker — SIZE UP: pay1 -> look at the top card of either deck
V("36815079-5262-4a87-b922-cd06177f6ba5", {
  conf: "medium",
  notes: "'Look at the top card of either deck' = a peek modelled as lookAndReorder count 1 (look then leave). chooserSelectsOption picks which deck.",
  shapes: ["activated SIZE UP: pay1 -> chooserSelectsOption[look at your deck / look at opp deck] via lookAndReorder count 1"],
  behavior: B([{
    id: "size-up", type: "activated", costs: [payR(1)],
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "Your deck", effects: [{ type: "lookAndReorder", player: "controller", count: 1, to: "top" }] },
      { label: "Opponent deck", effects: [{ type: "lookAndReorder", player: "opponent", count: 1, to: "top", chooser: "controller" }] }
    ] }]
  }])
});

// Spitting Sarume — ETB 1 dmg to all chars an opponent controls; FLIP UP 3 [R]
V("47d63dba-085e-4cbc-ab0c-ecdbe65fded0", {
  flipUp: { cost: 3, threshold: "r" },
  shapes: ["ETB: forEach {controller:opponent, type:character} dealDamage 1", "flip-up 3 [R]"],
  behavior: B([etb([{ type: "forEach", selector: { controller: "opponent", type: "character" }, effects: [dmg(CAND, 1)] }])])
});

// Swollen Ostrich — TACTICAL; ETB may pick char -> this turn +1/+1; FLIP UP 1 [D][D]
V("bc2f780b-859d-475b-80d2-00e8c8fd2920", {
  flipUp: { cost: 1, threshold: "dd" }, meta: { keywords: ["tactical"] },
  shapes: ["keyword tactical", "ETB: mayPick character -> createModifier str/life +1 UEOT", "flip-up 1 [D][D]"],
  behavior: { keywords: ["tactical"], abilities: [etb([mayPick("c", { type: "character" }, [cmod(S("c"), "strength", "add", 1, UEOT), cmod(S("c"), "life", "add", 1, UEOT)])])] }
});

// Temple Guardian — DEFLECT: pay3 + deplete self + pick attacking char -> removeFromBattle
V("033bf619-7e24-4854-9716-91ba5e05df8b", {
  shapes: ["activated DEFLECT: pay3 + deplete self; pick attacking char -> removeFromBattle"],
  behavior: B([{
    id: "deflect", type: "activated", costs: [payR(3), deplete("source")],
    targets: [pick("c", { type: "character", conditions: [{ type: "inBattle", target: CAND, role: "attacker" }] })],
    effects: [{ type: "removeFromBattle", target: S("c") }]
  }])
});

VANILLA("19aa978a-01ec-4ded-8425-fb59a7073caf"); // Terra Cotta Flagellator

// Thabbashite Haruspex — when this enters OR leaves play, may draw; if you do, put a hand card on bottom of deck
V("f811f0b1-ff21-411d-9429-c12c7a2d4c7d", {
  shapes: ["triggered cardEnteredPlay + triggered leaves play: chooserSelectsOption[decline / draw 1 then moveSelected hand->deck bottom]"],
  behavior: B([
    { id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [haruspexOpt()] },
    { id: "leaves", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, effects: [haruspexOpt()] }
  ])
});
function haruspexOpt() {
  return {
    type: "chooserSelectsOption", chooser: "controller",
    options: [
      { label: "Decline", effects: [] },
      { label: "Draw then bottom a card", effects: [draw(1), { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "bt", selector: { owner: "self", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "bt", effects: [moveTo(CAND, "deck", { position: "bottom" })] }] }] }
    ]
  };
}

// Thabbashite Wizard — ETB each player may draw up to 2 cards
V("2c419c3a-cd05-4d6c-b6c4-6d2e64655218", {
  shapes: ["ETB: forEachPlayer -> chooserSelectsNumber 0..2 -> draw N"],
  behavior: B([etb([{ type: "forEachPlayer", effects: [
    { type: "chooserSelectsNumber", chooser: "activePlayer", storeAs: "n", min: 0, max: 2 },
    { type: "draw", player: "activePlayer", amount: { type: "variable", id: "n" } }
  ] }])])
});

// The Abominable Hamster — COVERT; [O]x5: +2 str
V("c6b5109e-0a98-45c3-907f-b15bd97c7a1b", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "activated (threshold [O]x5): createModifier str +2 permanent"],
  behavior: { keywords: ["covert"], abilities: [iconPump("pump", "ooooo", [["strength", "add", 2]])] }
});

// Tiny Sarume — FLIP UP 0 [R] only
V("1b403626-3a9d-4d09-a919-0fe1a6f5077a", { flipUp: { cost: 0, threshold: "r" }, shapes: ["flip-up 0 [R]"], behavior: {} });

// Titillating Contortionist — when this attacks, may pick char -> it must block this if it can this turn
V("770af571-0046-4a84-8f14-02c9da41c25d", {
  conf: "medium",
  notes: "CONCESSION: 'must block this card if it can' modelled as a generic mustBlock grant UEOT (the picked character must block the attacking party the source is in).",
  shapes: ["triggered characterAttacked (source) -> mayPick character -> grantRestriction mustBlock UEOT"],
  behavior: B([onAttack([mayPick("c", { type: "character" }, [grantRes(S("c"), "mustBlock", UEOT)])])])
});

// Transient Smuggler — SMUGGLE: deplete self + pick char with str<=2 -> this turn covert
V("f4d4810e-5fd1-48b8-8b6c-4bab1f5b287d", {
  shapes: ["activated SMUGGLE: deplete self; pick char with strength<=2 -> grantKeyword covert UEOT"],
  behavior: B([{ id: "smuggle", type: "activated", costs: [deplete("source")], targets: [pick("c", { type: "character", conditions: [{ type: "statCompare", target: CAND, stat: "strength", operator: "<=", value: 2 }] })], effects: [grantKw(S("c"), "covert", UEOT)] }])
});

// Trebuchet Officer — FIRE!: pay1 + pick location -> 1 dmg
V("9123e4dc-f84a-4d88-aae7-bb6cf97a4194", {
  shapes: ["activated FIRE!: pay1; pick location -> dealDamage 1"],
  behavior: B([{ id: "fire", type: "activated", costs: [payR(1)], targets: [pick("l", { type: "location" })], effects: [dmg(S("l"), 1)] }])
});

// Underhanded Gamer — OUTSMART: (only if opp controls more chars than you) pay3 -> this turn this card cannot be blocked
V("8c111617-ef44-42a4-a79e-b895dd8005c3", {
  shapes: ["activated OUTSMART: condition count(opp chars)>count(self chars); pay3 -> grantKeyword cannotBeBlocked UEOT (self)"],
  behavior: B([{
    id: "outsmart", type: "activated",
    condition: { type: "numberCompare", left: { type: "count", selector: { controller: "opponent", type: "character" } }, operator: ">", right: { type: "count", selector: { controller: "self", type: "character" } } },
    costs: [payR(3)], effects: [grantKw("source", "cannotBeBlocked", UEOT)]
  }])
});

// Underpaid Ancestor — when put into discard from play, may pay3 -> putIntoPlay under your control, deplete it
V("e747070f-874a-4653-aaaa-72ca26915593", {
  shapes: ["triggered cardMoved (self play->discard) -> mayPay 3 -> putIntoPlay self, deplete"],
  behavior: B([toDiscardFromPlay("recur", [{ type: "mayPay", player: "controller", costs: [payR(3)], effects: [{ type: "putIntoPlay", target: "source", controller: "controller" }, deplete("source")], elseEffects: [] }])])
});

// Unflinching Bowman — SHOOT: pay1 + pick char -> 1 dmg to it + 1 dmg to self
V("1b64b6c4-8b37-4b00-a78f-cdb82d53f038", {
  shapes: ["activated SHOOT: pay1; pick char -> dealDamage 1 to it + dealDamage 1 to source"],
  behavior: B([{ id: "shoot", type: "activated", costs: [payR(1)], targets: [pick("c", { type: "character" })], effects: [dmg(S("c"), 1), dmg("source", 1)] }])
});

// Unimportant Wizard — FLIP UP 0 [O] only
V("8637871a-630c-4b97-b96e-625906231092", { flipUp: { cost: 0, threshold: "o" }, shapes: ["flip-up 0 [O]"], behavior: {} });

// Unscrupulous Attendant — when a char you control blocks, it gains 1 life this turn
V("15baea7c-8f80-4afe-8348-7cd7bba42993", {
  shapes: ["triggered characterBlocked (controller) -> createModifier life +1 UEOT on eventCard"],
  behavior: B([{ id: "shore-up", type: "triggered", event: "characterBlocked", condition: { type: "eventCardControlledBy", player: "controller" }, effects: [cmod("eventCard", "life", "add", 1, UEOT)] }])
});

VANILLA("8e20ec27-25c0-48f1-8b88-0e08d7bd9736"); // Unstoppable Asskicker

// Velocious Golem — [E][E][E]: this card can attack even if not in play since start of turn (= AGGRO, icon-gated static)
V("738bcd83-9c42-4913-a000-2d8ccab2d78e", {
  shapes: ["continuous gated [E][E][E]: grant keyword aggro to self"],
  behavior: B([contIcon("charge", "elitism", 3, [], [{ target: "source", keyword: "aggro" }])])
});

// Vigilant Raider — ASSAIL: pay2 -> this turn +1 strength
V("b018e5a3-1786-45ac-880a-7820b75c40aa", {
  shapes: ["activated ASSAIL: pay2 -> createModifier str +1 UEOT (self)"],
  behavior: B([{ id: "assail", type: "activated", costs: [payR(2)], effects: [cmod("source", "strength", "add", 1, UEOT)] }])
});

// Virtuous Razer — when this inflicts battle dmg, may pick location -> same amount to it
V("05e52796-8712-458c-8cbb-c35efb9681ab", {
  shapes: ["triggered damageDealt by source (battle) -> mayPick location -> dealDamage eventDamageAmount"],
  behavior: B([onDealBattleDmg("echo", [mayPick("l", { type: "location" }, [dmg(S("l"), eventDmg())])])])
});

// Virulent Dogmatist — BERATE: pay2 + deplete self + pick char -> this turn -2 str OR -1 speed
V("aa714d4f-ff39-49a0-bd14-56abc772cbea", {
  shapes: ["activated BERATE: pay2 + deplete self; pick char -> chooserSelectsOption[-2 str / -1 speed] UEOT"],
  behavior: B([{
    id: "berate", type: "activated", costs: [payR(2), deplete("source")], targets: [pick("c", { type: "character" })],
    effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [
      { label: "-2 strength", effects: [cmod(S("c"), "strength", "add", -2, UEOT)] },
      { label: "-1 speed", effects: [cmod(S("c"), "speed", "add", -1, UEOT)] }
    ] }]
  }])
});

// Wanton Wizard — ETB may pick tactic in discard -> put into play as a face-down resource
V("6158af7e-bebf-4eff-8b76-d5d6f33fff36", {
  shapes: ["ETB: mayPick tactic in discard -> putIntoPlay faceDown (as resource)"],
  behavior: B([etb([mayPick("t", { type: "tactic", zone: "discard", owner: "self" }, [{ type: "putIntoPlay", target: S("t"), controller: "controller", faceDown: true }])])])
});

// Wrinkly Rabbit — COVERT; +1/+1 per [O] you control
V("a7bd787b-336f-43b4-9a0e-13a1f547c9bf", {
  meta: { keywords: ["covert"] },
  shapes: ["keyword covert", "continuous: str/life += [O] count"],
  behavior: { keywords: ["covert"], abilities: [{ id: "swell", type: "continuous", modifiers: [mod("source", "strength", "add", icons("obsession")), mod("source", "life", "add", icons("obsession"))] }] }
});

require("./author-seed-data2.cjs");
