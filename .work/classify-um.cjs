#!/usr/bin/env node
/* Build .work/classify-um-all.json — one classification entry per Ungodly Mess
 * card, same shape the per-slice subagent outputs use. Solo pass (no subagents).
 * Helpers cover the repeated cycles (Gosche locations, FEALTY, God's Blessing,
 * Thabbashite [X][X][V][V], FLIP-UP-only, vanilla). */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const cards = (JSON.parse(fs.readFileSync(path.join(ROOT, "data/cards.json"), "utf8"))).cards
  || JSON.parse(fs.readFileSync(path.join(ROOT, "data/cards.json"), "utf8"));
const um = cards.filter(c => c.set === "Ungodly Mess");
const byName = {};
for (const c of um) (byName[c.name] ??= []).push(c);
const id = (name, i = 0) => {
  const list = byName[name];
  if (!list || !list[i]) throw new Error(`no card ${name}#${i}`);
  return list[i].id;
};

const out = [];
const M = (o = {}) => ({ unique: null, attachTo: null, resourceProvides: null, keywords: [], ...o });
function C(name, spec, i = 0) {
  out.push({
    id: id(name, i),
    name,
    status: spec.status ?? "classified",
    rulesAudited: true,
    behavior: spec.status === "vanilla"
      ? { needed: false, shapes: [], reusesProvenShape: null, newTestNeeded: false }
      : {
          needed: true,
          shapes: spec.shapes ?? [],
          reusesProvenShape: spec.new ? false : true,
          newTestNeeded: !!spec.new,
        },
    metadata: M(spec.meta),
    engineCapability: spec.caps ?? [],
    proposedCapabilities: [],
    parityGaps: spec.parityGaps ?? [],
    confidence: spec.confidence ?? "high",
    notes: spec.notes ?? "",
  });
}
const vanilla = (name, i, notes) => C(name, { status: "vanilla", notes }, i);
const wont = (name, notes, i = 0) =>
  C(name, { status: "wontImplement", shapes: [], notes }, i);

// ---- FEALTY cycle (blade of questionable morality) ---------------------------
const FEALTY = "CardDefinition.thresholdSlack {condition: numberCompare(distinctCount{controller:self,staple:true,type:resource,by:trade} >= 4), amount:3} — 'reduce threshold by any 3 icons' = up-to-3 total icon-deficit slack while in hand";

// ---- Gosche's ___ location cycle -------------------------------------------
function gosche(name, benefitShape, extra = {}) {
  C(name, {
    shapes: [
      `triggered:cardMoved — condition and(cardMovedFromZone play, eventCard controller self, counterCompare eventCard token >= 1) -> ${benefitShape}`,
      "activated <NAME>: costs [deplete source, payResources 2], targets [character controller:self], effects [addCounter picked token 1]",
    ],
    meta: extra.meta,
    caps: extra.caps ?? [],
    notes: extra.notes ?? "Gosche's ___ location cycle — token-leaves-play trigger + token-granting activated ability.",
  });
}

// ---- Thabbashite [X][X][V][V] icon-gated pair ------------------------------
function thabbaVV(name, xIcon, pairShapes, flipUp) {
  C(name, {
    shapes: [
      `icon gate G = and(resourceIcons self ${xIcon} >= 2, resourceIcons self volition >= 2); both abilities carry G as their condition`,
      ...pairShapes,
      `flipUp {cost:${flipUp.cost}, threshold:"${flipUp.threshold}"}`,
    ],
    notes: "Thabbashite [X][X][V][V] cycle — a continuous self-buff + a triggered ability, both gated on controlling 2 of the trade icon and 2 volition.",
  });
}

// =====================  CHARACTERS  =====================
C("Abram Ka-darbo Alkazin", { meta: { unique: "pluck" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], notes:
  `FEALTY: ${FEALTY}. MAKE VANISH: activated costs [deplete source, payResources 5] target [character] effect [moveCard -> void]. MAKE REAPPEAR: activated costs [deplete source, payResources 1] effect [putIntoPlay {target:{random selector {zone:void,type:character,owner:self}}, controller:controller}]. CONCESSION: 'a character voided by this card' modelled as any character in your void (void-origin not tracked).`,
  shapes: ["FEALTY thresholdSlack", "activated MAKE VANISH: deplete+pay5, pick character -> moveCard void", "activated MAKE REAPPEAR: deplete+pay1 -> putIntoPlay a character from your void under your control"] }, 0);
C("Abram Ka-darbo Alkazin", { meta: { unique: "pluck" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], notes: "Second printing — identical to the other Abram Ka-darbo Alkazin." ,
  shapes: ["FEALTY thresholdSlack", "activated MAKE VANISH: deplete+pay5, pick character -> moveCard void", "activated MAKE REAPPEAR: deplete+pay1 -> putIntoPlay a character from your void"] }, 1);

C("Abusive Major General", { shapes: [
  "activated BLEED: costs [destroy {resource controller:self}], targets [character with conditions:[inBattle __candidate]], effects [dealDamage picked 2]" ],
  notes: "'Pick a character in battle' = target selector conditions:[inBattle]. Destroy a resource you control = destroy cost." });

C("Animated Scrap Heap", { shapes: [
  "behavior.onPlay: variables {x:{variable x}} choose-a-number, costs [payResources {variable x}]; ETB effect addCounter source token {variable x}",
  "continuous self: +1 strength / +1 life per token — modifiers value {counter source token}",
  "activated EXPAND: costs [payResources 3], effects [addCounter source token 1]" ],
  notes: "Choose-a-number X as an EXTRA COST via onPlay.costs payResources {variable x}; enters with X tokens." });

C("Arrakis Eternity", { meta: { keywords: ["covert"] }, shapes: [
  "keyword covert",
  "activated RECUR: activationZone discard, threshold 'o', costs [payResources 2, removeFromGame source], targets [faction/player pick], effects [opponent discards 3] (2p: opponent)" ],
  notes: "RECUR from discard. 'Pick a player' degenerates to the one opponent." });

C("Beefy Researcher", { shapes: [
  "activated RESEARCH: costs [deplete source], effects [reduceNextCost {amount:1}] (reduce next numeric cost you pay this turn by 1)",
  "icon-gated continuous self: condition numberCompare(resourceIcons self elitism >= 6) -> +2 strength/+2 life/+2 speed" ] });

C("Big McLargehuge", { meta: { unique: "mclargehuge" }, shapes: [
  "behavior.onPlay.costs [destroy {resource controller:self} x2]",
  "triggered:cardMoved (from play, sourceIsEventCard) -> chooserSelectsOption [ {play a resource}, {pick opponent -> that player destroys a face-down resource they control} ]",
  "flipUp {cost:4, threshold:'r'}" ],
  notes: "'play a resource' branch = chooserSelectsTarget optional over hand -> playResource faceDown:auto (recurring UM idiom)." });

C("Billowing Bouffant", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> optional pick item -> destroy it",
  "flipUp {cost:6, threshold:'e'}" ] });

C("Bloodcrazed Berserker", { shapes: [
  "activated HEMORAGE: costs [destroy source], targets [faction or character], effects [dealDamage picked 4]",
  "flipUp {cost:4, threshold:'r'}" ],
  notes: "Explicitly picks a faction OR character (so faction is a legal pick here)." });

C("Bursting Bask", { shapes: [
  "icon-gated triggered: condition numberCompare(resourceIcons self rage >= 6); on cardEnteredPlay (sourceIsEventCard) -> optional pick character -> dealDamage 5",
  "flipUp {cost:4, threshold:'rrr'}" ] });

C("Camouflaged Urchin", { shapes: [
  "continuous self: condition cardDepleted source -> restriction cannotBePicked (relative to opponents)",
  "flipUp {cost:1, threshold:'d'}" ],
  notes: "'your opponents cannot pick this card' while depleted = cannotBePicked continuous gated on cardDepleted." });

C("Candy Skull Commander", { shapes: [
  "triggered:battleStarted — condition battleRole defender -> mayPay {costs:[payResources 2], effects:[flipCoin winEffects:[forEach {character controller:self} createModifier speed +1 untilEndOfTurn]]}",
  "icon-gated triggered: condition numberCompare(resourceIcons self deception >= 6); on coinFlipped -> mayPay {costs:[payResources 1], effects:[draw controller 1]}" ],
  notes: "'Whenever an opponent forms an attacking party' modelled as battleStarted + battleRole:defender (no attacker-less party-formed event). CONCESSION noted." });

C("Carnival Whipmaster", { meta: { keywords: ["tactical"] }, shapes: [
  "keyword tactical",
  "activated GRAND THEFT: costs [destroy source], targets [ {character controller:opponent} count 1, {item controller:opponent} count 1 ], effects [takeControl each -> controller]" ] });

C("Chosen Reaper of Thabbash", { shapes: [
  "activated CONSUME FORCE: costs [payResources 1, deplete {another character controller:self}], effects [createModifier source speed +1 untilEndOfTurn]",
  "flipUp {cost:4, threshold:'d'}" ] });

C("Cicibeo, The Implicator", { meta: { unique: "cicibeo" }, shapes: [
  "activated IMPLY: costs [deplete source], targets [character], effects [chooserSelectsOption by {controllerOf picked}: [ {deplete picked}, {reveal top of own deck; if character -> takeControl picked -> caster, duration untilEndOfTurn} ]]",
  "icon-gated triggered: condition numberCompare(resourceIcons self deception >= 4); on cardPlayed (eventCard subtype 'cicibeo', eventCard != source, eventCardControlledBy self) -> optional pick depleted character -> destroy" ],
  notes: "'reveals the top card of their deck and it's a character' — a conditional branch on a revealed card. 'deployed from your hand' = cardPlayed event (played from hand). Novel-ish IMPLY shape.", new: true });

C("Circumspect Hijacker", { shapes: [
  "icon-gated triggered: condition numberCompare(resourceIcons self greed >= 3); on cardEnteredPlay (sourceIsEventCard) -> draw controller 1",
  "activated RETREAT: costs [payResources 2, destroy source], effects [draw controller 1]" ] });

C("Conniving Puppeteer", { shapes: [
  "activated BETRAY: costs [destroy source], targets [{card zone:discard owner:opponent, conditions:[not cardTypeIs tactic]}], effects [putIntoPlay picked -> controller]" ] });

C("Contriving Engineer", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> optional search deck for {name:'Elitism'} -> putIntoPlay + attachTo {factionOf controller}" ],
  notes: "Deck search then reshuffle; attach the found Elitism to your faction (playResource-like). Compose: chooserSelectsTarget deck + putIntoPlay + attachTo + shuffleDeck." });

C("Crimson Pandiatus", { shapes: [
  "continuous self: restriction cannotAttack",
  "icon-gated continuous self: condition numberCompare(resourceIcons self rage >= 6) -> modifier life +4 AND suppressAllAbilities {target:source}" ],
  notes: "'gains 4 life and loses all other rules text' — the +4 life survives (it's on the suppressing ability itself)." });

vanilla("Crow With Fists", 0, "'You may include as many copies of this card in your deck as you want.' — a deckbuilding rule with no in-game effect. No behavior.");

C("Customized 31f", { shapes: [
  "continuous self: condition numberCompare(count{type:location, zone:play} + count{type:item, zone:play} >= 1) -> +2 strength / +2 life" ],
  notes: "'a location or item in play' = numberCompare of an add of two counts >= 1 (either-or)." });

C("Death Investor", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> optional pick {character zone:discard owner:self} -> moveCard deck position:top",
  "icon-gated continuous self: condition numberCompare(resourceIcons self greed >= 6) -> +3 strength / +3 life",
  "activated RECUR: activationZone discard, threshold 'g', costs [payResources 1, removeFromGame source], targets [{character zone:discard owner:self}], effects [putIntoPlay picked -> controller]" ] });

C("Desperate Defender", { meta: { keywords: ["covert"] }, shapes: [
  "keyword covert",
  "activated SHOW EVIDENCE: usesPerTurn 1, targets [character], effects [deplete picked]" ] });

C("Direstock Paratrooper", { shapes: ["flipUp {cost:1, threshold:'r'}"], notes: "FLIP UP only." });

C("Disposable Meatsack", { shapes: [
  "triggered:turnEnding (eventPlayerIs controller) — condition cardDepleted source -> destroy source",
  "icon-gated continuous self: condition numberCompare(resourceIcons self rage >= 6) -> +1 strength / +1 speed" ] });

C("Drainbow Crash", { meta: { resourceProvides: ["elitism", "elitism"] }, shapes: [
  "PROVIDES [E][E] (metadata.resourceProvides)",
  "flipUp {cost:5, threshold:'e', effects:[optional pick item -> destroy it]}" ] });

C("Ecto-Agriolimax", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> addCounter source token 2",
  "activated SLITHER: costs [removeCounter source token 1], targets [item or location], effects [moveCard picked -> hand]" ] });

C("Efficacious Gunslinger", { shapes: [
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard character, battleActive) -> destroy eventCard" ],
  notes: "'inflicts battle damage to a character' modelled as damageDealt + sourceIsDamageSource + battleActive (established corpus idiom — no isBattleDamage flag)." });

C("Elite Acrolos Engineer", { caps: ["distinct-count-expression"], shapes: [
  "continuous self: +1 strength / +1 life per distinctCount{controller:self, staple:true, type:resource, by:name}" ] });

C("Eustace, Sensible Glutton", { meta: { unique: "eustace" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], shapes: [
  "FEALTY thresholdSlack",
  "triggered:characterAttacked (sourceIsEventCard) -> mayPay {costs:[loseInfluence 3], effects:[createModifier source strength +3 untilEndOfTurn, grantKeyword source covert untilEndOfTurn]}",
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> modifyInfluence controller +3" ] });

C("Ex Machina Majig", { meta: { unique: "ex machina" }, shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> forEach {character controller:self} createModifier +1 strength/+1 life untilEndOfTurn",
  "triggered:cardMoved (from play, sourceIsEventCard) -> optional createTokens {name:'Micromajig', type:character, subtype:[majig], count:5}" ] });

C("Expert Debater", { shapes: [
  "continuous self: -1 life per token (modifier value {multiply:[{counter source token}, -1]})",
  "replacement: replaces damage would be inflicted to source while blocking -> add that many token counters instead (transformBattleDamage-adjacent)",
  "activated RECUR: activationZone discard, threshold 'gg', costs [payResources 1, removeFromGame source], targets [character], effects [removeCounter picked token 1]" ],
  notes: "'If battle damage would be inflicted to this card while it's blocking, add that many tokens instead' — model via transformBattleDamage {role:receiver, kind:setAmount 0} + a damageDealt/assignment rider addCounter = concession, OR a preventDamage.wholeInstance + addCounter. CONCESSION: token count = pre-mitigation damage. medium confidence.",
  confidence: "medium" });

C("Ezekial Cutpurse", { meta: { unique: "ezekial cutpurse" }, shapes: [
  "continuous aura: {character controller:self, cardCost <= 2} +1 strength",
  "continuous aura: {character controller:self, cardCost >= 4} +1 speed",
  "activated YOINK!: costs [destroy source], targets [{card subtype:gear}, {character}], effects [takeControl gear -> controller, attachTo gear -> character]" ] });

vanilla("Fade of the Devoured Emperor", 0, "No rules text.");

C("Feckless Chronicler", { caps: ["blocker-selector-restriction"], shapes: [
  "continuous self: blockRestriction {blockerMustNotMatch: {type:character, conditions:[textMentionsIcon volition]}}",
  "continuous self: +1 strength / +1 life per token",
  "icon-gated triggered: condition numberCompare(resourceIcons self deception >= 3); on cardDepleted (sourceIsEventCard) -> flipCoin winEffects:[addCounter source token 1]" ] });

C("Fleet Majig", { meta: { keywords: ["cannotBeBlocked"] }, shapes: [
  "keyword cannotBeBlocked",
  "icon-gated continuous self: condition numberCompare(resourceIcons self elitism >= 6) -> +2 strength / +2 life" ],
  notes: "'This card cannot be blocked' = cannotBeBlocked keyword." });

C("Foreclosure Overseer", { shapes: [
  "continuous: condition cardDepleted source -> costModifiers {player:opponents, delta:+1} (opponents pay 1 more to deploy cards)",
  "flipUp {cost:4, threshold:'gg', effects:[optional add or remove a damage marker from a location -> chooserSelectsOption addCounter/removeCounter 'damage' on picked location]}" ] });

C("Ghosts of Loot", { meta: { unique: "ghosts" }, shapes: [
  "triggered:characterBlocked (sourceIsEventCard) -> modifyInfluence controller -2, createModifier source life +4 untilEndOfTurn",
  "triggered:characterAttacked (sourceIsEventCard) -> modifyInfluence controller +1, createModifier source strength +2 untilEndOfTurn",
  "icon-gated triggered: numberCompare(resourceIcons self volition >= 2); cardEnteredPlay (sourceIsEventCard) -> draw controller 1",
  "icon-gated triggered: numberCompare(resourceIcons self volition >= 5); cardDestroyed (sourceIsEventCard) -> draw controller 4",
  "flipUp {cost:3, threshold:'g'}" ] });

C("Gor-blach the Endowed", { meta: { unique: "gor-blach" }, shapes: [
  "activated GET IN THERE: threshold 'vvv', variables {x:{stat picked strength}} (before costs), costs [deplete source, payResources {variable x}], targets [{character controller:self, conditions:[inBattle __candidate as blocked]}], effects [destroy picked, dealDamage {factionOf opponent} {variable x}, dealDamage source {variable x}]" ],
  notes: "'Pick a blocked character you control' — a target whose selector conditions include being an attacker that has been blocked. bind X = its strength before destroy.",
  confidence: "medium" });

C("Great Mau General", { shapes: [
  "triggered:damageDealt (sourceIsDamageSource) — condition numberCompare(influence of controller <= 10) -> modifyInfluence controller +2" ],
  notes: "'if your faction has 10 influence or less' — numberCompare on a faction-influence NumberExpression. Verify an influence NumberExpression exists (stat 'influence' on {factionOf controller}).",
  confidence: "medium" });

C("Ignatious, Tactician Crafter", { meta: { unique: "ignatious" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], shapes: [
  "FEALTY thresholdSlack",
  "continuous aura: {uniqueDesignation:'uhluhtc'} +3 strength / +3 life",
  "activated CIPHER: costs [payResources 2, deplete source], targets [{tactic zone:discard owner:self}], effects [deployFromZone picked] — rider: if it would go to discard, removeFromGame instead" ],
  notes: "CONCESSION: the 'remove from the game instead of discard' rider on CIPHER is not modelled (deployFromZone tactic resolves back to discard normally). 1 card; small strictly-worse concession.",
  confidence: "medium" });

C("Jo Ciendeilio, Iron Born", { meta: { unique: "jo" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], shapes: [
  "FEALTY thresholdSlack",
  "triggered:cardEnteredPlay (sourceIsEventCard) -> optional search deck for {type:item, trade:gearsmith} reveal -> moveCard hand",
  "triggered:cardMoved (from play, sourceIsEventCard) -> same search-to-hand" ],
  notes: "'enters or leaves play' = two triggers sharing the effect." });

C("Little God of Answers", { shapes: [
  "triggered:turnEnding (eventPlayerIs controller) — condition cardDepleted source -> mayPay {costs:[payResources 1], effects:[search deck {type:tactic} reveal -> moveCard hand]}" ] });

C("Malevolent Trooper", { shapes: [
  "activated PUSH: costs [payResources 1, deplete {character controller:self}], effects [createModifier source strength +2 untilEndOfTurn]" ] });

vanilla("Micromajig", 0, "Token character, no rules text.");
vanilla("Micromajig", 1, "Token character, no rules text.");
vanilla("Micromajig", 2, "Token character, no rules text.");

C("Multi-Attachment Man", { shapes: [
  "triggered:cardDestroyed (sourceIsEventCard) -> optional search deck {type:item} reveal -> moveCard hand" ] });

C("Noxious Gambler", { shapes: [
  "triggered:cardRestored (sourceIsEventCard) -> optional lookAndReorder own deck top 1 to:'split' (keep on top or put on bottom)" ],
  notes: "'look at the top card, you may put it on the bottom' = lookAndReorder top 1, to split." });

C("Omahkapi'si Pi'kssii", { meta: { unique: "omahkapi'si", keywords: ["tactical"] }, shapes: [
  "keyword tactical",
  "continuous self: condition numberCompare(count{zone:discard owner:opponent} >= 10) -> restriction cannotBePicked (relative to that opponent)",
  "activated FLEX: costs [payResources 2], targets [{card zone:discard owner:opponent}], effects [removeFromGame picked, createModifier source strength +2 untilEndOfTurn]" ] });

C("P0p", { shapes: [
  "activated BOLSTER: costs [deplete {another character controller:self}], effects [createModifier source +1 strength/+1 life untilEndOfTurn]",
  "activated TEAMWORK: usesPerTurn 1, costs [destroy {token micromajig you control}], targets [{name:'5n4p'},{name:'Cr4ck13'},{name:'P0p'} each count 1], effects [forEach selected -> createModifier +1/+1 untilEndOfTurn + grantKeyword cannotBeBlocked untilEndOfTurn]" ],
  notes: "Three name-pinned target declarations. 'micromajig token you control' destroy cost." });

C("Padamose Cultists", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) — condition deployedNonCharacterThisTurn (deployHistory: any non-character card deployed this turn by controller) -> draw controller 2" ],
  notes: "'if you have deployed a non-character card this turn' — needs a per-turn deploy-history check by card type. Verify: deploySameNameThisTurn exists but this is type-scoped. Likely reuse deploy-history state.",
  confidence: "medium" });

C("Pandering Politician", { shapes: [
  "activated PANDER: costs [deplete source], targets [character or item], effects [removeCounter picked token 1]" ] });

C("Party Crashers", { shapes: [
  "continuous self: condition battlePartySize ownParty >= 2 (attacking) -> modifier speed -1",
  "icon-gated triggered: numberCompare(resourceIcons self elitism >= 4); cardDestroyed (sourceIsEventCard) -> createTokens {name:'Micromajig', count:2} under controller" ] });

C("Pluck", { meta: { unique: "pluck" }, shapes: [
  "activated GRIFT: condition isActivePlayer, costs [payResources 5, deplete source], targets [{card zone:discard owner:opponent, conditions:[not cardTypeIs tactic]}], effects [putIntoPlay picked -> controller]" ] });

C("Pride of Goru-Goru Gidea", { shapes: [
  "activated RESIST: costs [payResources 1, loseInfluence 1], effects [preventDamage {target:source, amount:1, mode:reduce}]",
  "activated DISAPPEAR: costs [payResources 2], effects [grantKeyword source covert untilEndOfTurn]" ] });

C("Quipster D'Genie", { shapes: [
  "activated WISH: costs [payResources 2, destroy source], effects [search deck {type:tactic} reveal -> moveCard hand]" ] });

C("Readied Rifleman", { shapes: [
  "triggered:cardRestored (sourceIsEventCard) -> optional pick faction -> dealDamage 1" ] });

C("Redecorator Majig", { shapes: [
  "behavior.onPlay: optional pick location -> deplete it + rememberTarget key:'loc'",
  "continuous: condition linkedCardInPlay 'loc' -> restriction cannotBeRestoredByRule on {remembered loc}",
  "continuous self: condition and(linkedCardInPlay 'loc', cardDepleted {remembered loc}) -> +3 strength / +1 life",
  "flipUp {cost:4, threshold:'eee'}" ],
  notes: "rememberTarget + linkedCardInPlay pattern (Conscientious Objector precedent)." });

C("Rudo Mangod, Fightful Adonis", { meta: { unique: "rudolphus" }, caps: ["conditional-threshold-slack", "distinct-count-expression"], shapes: [
  "FEALTY thresholdSlack",
  "triggered:characterAttacked (sourceIsEventCard) -> mayPay {costs:[payResources 2], effects:[forEach {character controller:self} createModifier strength +2 untilEndOfTurn]}",
  "triggered:cardDestroyed (sourceIsEventCard) -> optional search deck {type:character, trade:warlord} reveal -> moveCard deck position:top" ],
  notes: "Designation is UNIQUE RUDOLPHUS (differs from card name Rudo Mangod)." });

C("Salvo Sarume", { shapes: [
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> optional pick {resource controller:self} -> moveCard hand; if picked -> forEach {character} dealDamage 1" ] });

C("Seance Ritualist", { shapes: [
  "activated VIOLATE: variables {x:{counter source token}} (before costs), costs [deplete source, payResources {variable x}], targets [player/opponent], effects [that player discards {variable x}, addCounter source token 1]",
  "activated BLUR: threshold 'ooo', costs [removeCounter source token 1], effects [grantKeyword source covert untilEndOfTurn]" ] });

C("Securitymajig Mark II", { meta: { keywords: ["canBlockCovert"] }, shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) — condition deployedViaFlipUp -> addCounter source token 3",
  "continuous self: +1 strength per token",
  "keyword canBlockCovert ('can block COVERT parties')",
  "flipUp {cost:5, threshold:'e'}" ] });

C("Silencer", { caps: ["blocker-selector-restriction"], shapes: [
  "continuous self: blockRestriction {blockerMustNotMatch: {type:character, conditions:[counterCompare __candidate token >= 1]}}",
  "triggered:cardEnteredPlay — condition eventCardControlledBy opponent -> mayPay {costs:[payResources 1], effects:[addCounter eventCard token 1]}" ] });

C("Silent Sentinels", { shapes: [
  "continuous aura: {type:character} restriction mustAttack ('all characters must attack if they can')",
  "icon-gated continuous self: numberCompare(resourceIcons self elitism >= 3) -> keyword aggro" ] });

C("Slippery Assailant", { shapes: [
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> moveCard source -> hand",
  "flipUp {cost:0, threshold:'r'}" ] });

C("Smokin' Hottie", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> modifyInfluence controller -2",
  "icon-gated continuous self: numberCompare(resourceIcons self volition >= 4) -> keyword covert" ],
  notes: "Printed '[V]V][V][V]' is a typo for [V][V][V][V]." });

C("Soulsearcher", { shapes: [
  "5 activated abilities, each threshold-gated by one icon, no resource cost: [O]->grantKeyword covert; [G]->+2 life; [E]->grantKeyword aggro; [D]->+1 speed; [R]->+2 strength (all untilEndOfTurn / permanent-this-instance per printed wording)" ],
  notes: "Bare '[X]:' ability cost = ActivatedAbility.threshold gate, no payResources (brief idiom)." });

thabbaVV("Thabbashite Convert", "elitism", [
  "continuous self (G): +1 strength / +1 life",
  "triggered (G): characterAttacked (sourceIsEventCard) -> optional pick {resource controller:self, faceDown:false} -> flipFaceDown" ], { cost: 4, threshold: "vvvv" });

C("Thabbashite Desert Creature", { meta: { keywords: ["covert"] }, shapes: [
  "keyword covert",
  "continuous activeZone:hand — condition (a [V]-provider entered play under your control this window): reveal + mayPay {costs:[payResources 2], effects:[deployForFree source free:false? no — 'pay 2 to deploy']}" ],
  notes: "Same shape as Holy Heist 'reveal from hand when a [V]-provider enters play' cycle — a cardEnteredPlay trigger with triggerZone:hand + cardProvides(eventCard, volition) + mayPay deploy-for-2. reusesProvenShape." });

thabbaVV("Thabbashite Glutton", "greed", [
  "triggered (G): cardDestroyed (sourceIsEventCard) -> draw controller 1",
  "triggered (G): characterAttacked (sourceIsEventCard) -> optional pick {card zone:discard} -> removeFromGame" ], { cost: 2, threshold: "vvvv" });

thabbaVV("Thabbashite Host", "rage", [
  "continuous self (G): +4 strength",
  "triggered (G): cardMoved (from play, sourceIsEventCard) -> optional pick character -> createModifier strength +4 untilEndOfTurn" ], { cost: 7, threshold: "vvvv" });

C("Thabbashite Penumbra", { caps: ["distinct-count-expression"], shapes: [
  "activated (the COST/EFFECT block): variables {x:{distinctCount controller:opponent staple:true type:resource by:name}} before costs, costs [payResources {add:[6, {multiply:[{variable x}, -1]}]}], effects [createModifier source life +1 untilEndOfTurn, grantKeyword source covert untilEndOfTurn]" ],
  notes: "'Pay 6-X' where X = opponent's distinct staples. No named ability label — a single activated ability." });

thabbaVV("Thabbashite Priest of Zig", "obsession", [
  "continuous self (G): keyword covert",
  "triggered (G): cardDestroyed (sourceIsEventCard) -> optional pick {non-resource card} -> moveCard hand" ], { cost: 3, threshold: "vvvv" });

thabbaVV("Thabbashite Seer", "deception", [
  "triggered (G): on cardEnteredPlay/cardMoved(from play)/characterAttacked/characterBlocked (sourceIsEventCard) -> optional lookAndReorder top 1 of any deck (chooser peek)" ], { cost: 1, threshold: "vvvv" });

C("Thabbashite Weapons Expert", { shapes: [
  "triggered:turnStarted (eventPlayerIs controller) -> bind x = {stat source strength}; mayPay {costs:[destroy source], effects:[chooserSelectsOption [ {forEach {faction controller:opponent} dealDamage {variable x}}, {pick item cardCost <= {variable x} -> destroy} ]]}",
  "icon-gated continuous self: numberCompare(resourceIcons self volition >= 5) -> +2 strength" ] });

C("Theological Opportunist", { shapes: [
  "continuous self: strength & life modifiers value {multiply:[{count zone:hand owner:any}, -1]}" ] });

C("Twisted Marionette", { shapes: [
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> mayPay {costs:[payResources 1], effects:[chooserSelectsTarget by {ownerOf eventCard}: pick {character controller: that player} -> moveCard hand]}" ] });

C("Unchained Sarcophyle", { shapes: ["flipUp {cost:8, threshold:'d'}"], notes: "FLIP UP only." });

vanilla("Unfortunate Fortune Hunter", 0, "No rules text.");

C("Unwise Encirclement", { meta: {}, shapes: [
  "behavior.onPlay: target [character]; effects [addCounter picked token 1, if deployedViaFlipUp -> addCounter picked token 4, dealDamage picked {counter picked token}]" ],
  notes: "type is bare 'character' (no subtype). EXTRA COST pick + conditional-on-FLIP-UP extra tokens + self-scaling damage.", meta: {} });

C("Vexillarius Dacian-Draco", { meta: { unique: "vexillarius" }, shapes: [
  "continuous aura: {character controller:self, not isCard source} +2 strength / +2 life",
  "triggered:cardDestroyed (sourceIsEventCard) -> forEach {type:character} createModifier -2 strength/-2 life untilEndOfTurn" ] });

C("Voidal Bask", { shapes: [
  "triggered:cardMoved (from play, sourceIsEventCard) -> chooserSelectsTarget pick {card zone:hand owner:opponent} -> moveCard discard" ],
  notes: "'look at an opponent's hand and choose a card' = chooser is controller, selector opponent hand (P2 idiom)." });

C("Voidal Tactician", { caps: ["continuous-void-play"], shapes: [
  "triggered:damageDealt — condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> mayPay {costs:[payResources 1], effects:[search {ownerOf eventCard} deck for {type:tactic} reveal -> moveCard void]}",
  "continuous self: condition cardDepleted source -> voidPlay {selector:{zone:void, type:tactic, owner:self}, ignoreThreshold:true}" ] });

C("War Racketeer", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> draw controller {count {type:character, zone:play, controller:any}}",
  "activated UNDER THE TABLE: costs [discard 1], effects [createModifier source life -1 untilEndOfTurn, createModifier source strength +1 untilEndOfTurn, grantKeyword source covert untilEndOfTurn]" ] });

C("Yenessa Shipping, LLP", { meta: { unique: "llp" }, shapes: [
  "continuous self: +2 strength / +2 life per {count type:item, controller:opponent}",
  "continuous grantedAbilities over {type:item}: a triggered turnStarted ability -> mayPay {costs:[payResources 1], elseEffects:[destroy self]}",
  "flipUp {cost:1, threshold:'ggg'}" ],
  notes: "'All items gain the rules text...' — grantedAbilities aura, triggered body only (already supported). Not granted-continuous." }, 0);
C("Yenessa Shipping, LLP", { meta: { unique: "llp" }, shapes: ["identical to other Yenessa Shipping, LLP printing"], notes: "Second printing — identical." }, 1);

C("Zenobia, Artificer", { meta: { unique: "zenobia" }, shapes: [
  "activated DISENCHANT: costs [deplete source, discard {item}], variables {x:{cardCost <discarded item>}} — captured via bind before discard, effects [addCounter source token {variable x}]",
  "activated CLAIRVOYANCE: variables {x} choose-number>0, variableBounds {x:{min:1, max:{counter source token}}}, costs [deplete source, removeCounter source token {variable x}], effects [search deck {cardCost <= {variable x}} reveal -> moveCard hand]" ],
  notes: "DISENCHANT: X = discarded item's numeric cost — bind X before the discard cost resolves (or read from the discard selection). medium confidence on ordering.", confidence: "medium" }, 0);
C("Zenobia, Artificer", { meta: { unique: "zenobia" }, shapes: ["identical to other Zenobia, Artificer printing"], notes: "Second printing — identical.", confidence: "medium" }, 1);

C("Zigalburgonglgr, the Stolen God", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> chooserSelectsTarget {count:{resourceIcons self volition}, optional} over {non-resource card} -> forEach selected addCounter token 1",
  "triggered:cardDestroyed (sourceIsEventCard) -> forEach {non-resource card, counterCompare __candidate token >= 1} -> destroy",
  "activated TURN TO MUSH: costs [payResources 2], targets [{card, counterCompare __candidate token >= 1}], effects [flipFaceDown picked]" ] });

// =====================  ITEMS  =====================
C("Corrosive Waste Dispenser", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> addCounter source token 4",
  "triggered:counterChanged (sourceIsEventCard) — condition counterCompare source token = 0 -> flipFaceDown source",
  "activated CONVERT: costs [removeCounter source token 1, destroy {character controller:self, not subtype micromajig}], effects [forEachPlayer opponents -> that player destroys a character they control (chooserSelectsTarget by that player)]" ] });

C("Direstock Cuffs", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "continuous: suppressKeywords covert on {attachedTo}",
  "continuous: condition textMentionsIcon {attachedTo} volition -> suppressAllAbilities {target:attachedTo}",
  "activated MOVE: costs [payResources 2], targets [{character, not inBattle}], effects [attachTo source -> picked]",
  "flipUp {cost:1, threshold:'e'}" ] });

C("Ecto-Conduit", { shapes: [
  "triggered:turnStarted (eventPlayerIs controller) -> optional {draw 3, then moveSelected 2 from hand -> deck position:top in chosen order} (lookAndReorder-style)",
  "activated HARNESS: costs [destroy source], effects [moveCard {deckPosition self top 0} -> void; if that card is a tactic -> grantVoidPlay {selected:that card, player:controller, ignoreThreshold:true}]" ] });

C("Expedition AutoBlind", { shapes: [
  "activated HUNKER DOWN: costs [payResources 1, deplete source], targets [{card zone:discard, type in [character,tactic]}], effects [removeFromGame picked, draw controller 1, then moveSelected 1 from hand -> deck bottom]",
  "activated BUY TIME: threshold 'ddd', costs [payResources 1], effects [restore source]",
  "flipUp {cost:1, threshold:'d'}" ] });

C("Extremely Tiny Bonnet of Invisibility", { meta: { attachTo: "character" }, shapes: [
  "attachTo character (you control)",
  "behavior.onPlay.costs: pick opponent -> that player may detach up to 2 resources from their faction (chooserSelectsTarget by that player, optional count 2, over {resource attachedToFaction:true owner: that player} -> detach)",
  "continuous: keyword covert on {attachedTo}" ],
  caps: ["resource-attachment-selector"] });

C("Fantastic Über Kool Creator Majig", { meta: { unique: "creator majig" }, shapes: [
  "behavior.onPlay.costAdjust {multiply:[{resourceIcons self elitism}, -1]}",
  "triggered:turnStarted (eventPlayerIs controller) -> optional play a resource (chooserSelectsTarget hand -> playResource auto)",
  "triggered:turnStarted (eventPlayerIs controller) -> optional {destroy {card controller:self, cardProvides __candidate elitism 1}; if done -> search deck for any card -> moveCard hand}" ] });

C("Gory Trick Box", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "continuous: {attachedTo} +2 strength / -2 speed" ] });

C("Key to the City", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "triggered:cardMoved (from play) on {attachedTo} -> optional search deck {type:resource} reveal -> moveCard hand",
  "activated UNLOCK POTENTIAL: activationZone hand, threshold 'g', costs [moveCard source hand->discard (discard from hand), payResources 2], effects [search deck {type:resource, name not among names you control} reveal -> moveCard hand]" ],
  notes: "'a resource with a name you don't control' — selector conditions: not cardNameEquals any in-play resource you control. May need a small selector predicate; treat as name-not-in-play. medium confidence.", confidence: "medium" });

C("Kitten Mittons", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "triggered:damageDealt — condition eventCardIs {attachedTo} -> modifyInfluence controller +{eventDamageAmount}" ] });

C("Lockbox of the Aeons", { caps: ["continuous-play-restriction", "continuous-return-to-hand-restriction"], shapes: [
  "continuous: playRestrictions [{player:opponent, kind:'flipUp'}]",
  "continuous: restrictReturnToHand {player:opponent, fromZones:['void','discard','play']}" ] }, 0);
C("Lockbox of the Aeons", { caps: ["continuous-play-restriction", "continuous-return-to-hand-restriction"], shapes: ["identical to other Lockbox of the Aeons printing"], notes: "Second printing — identical." }, 1);

C("Quilt of Old Banners", { meta: { unique: "quilt" }, shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) + triggered:turnStarted (eventPlayerIs controller) -> nameValue {valueKind:resourceIcon, non-volition} then grantProvides {target:source, icon:{fromNamed}, amount:1, duration:untilStartOfNextTurn}",
  "activated HAND IT DOWN: costs [payResources 1, moveSelected source -> deck shuffle:true], effects [draw controller 1]" ] });

C("Severed Limb", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "continuous: {attachedTo} +1 strength",
  "activated BULK UP: costs [payResources 1, destroy {card name:'Rage' owner:self}], effects [createModifier {attachedTo} strength +1 untilEndOfTurn]" ] });

C("Symmetrical Scimitar", { meta: { attachTo: "character" }, shapes: [
  "attachTo character",
  "continuous: condition {attachedTo} controller == source controller -> {attachedTo} +1 strength / +1 life",
  "continuous: condition {attachedTo} controller != source controller -> {attachedTo} -1 strength / -1 life" ] });

wont("Trickster's Globe",
  "Two out-of-scope clauses: (1) 'If you would inflict damage to an opponent's faction ... put that many cards from the top of its deck into the discard pile instead' needs a faction-damage replaceable-event class no other catalog card requires; (2) 'When a player has no cards in their deck, they lose the game' is an alternate loss condition (BEHAVIORS.md sanctions wontImplement for alternate win/lose conditions). Single uber-rare card.");

// =====================  LOCATIONS  =====================
C("Acrolosian Outpost #30016968A", { shapes: [
  "activated SNUB: costs [payResources 2, deplete source], effects [search deck {name:'Elitism'} reveal -> moveCard hand]" ] });

C("Apparition Alley", { shapes: [
  "activated WOOSH: costs [deplete source], targets [character], effects [createModifier picked speed +1 untilEndOfTurn]" ] });

C("Carnival Funhouse", { shapes: [
  "behavior.onPlay: targets [{character controller:opponent} count 1, {character controller:self} count 1]; effects [bind a_str/a_life/a_speed/b_str/b_life/b_speed from the two picks, then 6x createModifier operation:set duration:whileSourceInPlay swapping the captured values]" ],
  notes: "Stat swap = bind (snapshot) + 6 set-modifiers with whileSourceInPlay. CONCESSION: one-time snapshot swap; later stat changes to either character are not re-swapped.", new: true, confidence: "medium" });

C("Direstock Stronghold", { meta: { unique: "stronghold" }, shapes: [
  "triggered:turnEnding (eventPlayerIs controller) -> optional search deck {type:character, trade:warlord} reveal -> moveCard deck position:top",
  "triggered:cardPlayed (eventCard type character, eventCardControlledBy self) -> bind x = {cardCost eventCard}; optional pick faction -> dealDamage picked {variable x} + dealDamage source {variable x}" ] });

C("Doarden Flee Market", { shapes: [
  "activated HOCK: costs [payResources 1, deplete source, destroy {character owner:self}], effects [draw controller 1]",
  "activated WEEDLE: threshold 'gggggg', costs [payResources 2, deplete source, destroy {character owner:self}], effects [draw controller 3]" ] });

C("Eidolic Cove", { shapes: [
  "triggered:cardEnteredPlay (sourceIsEventCard) -> optional pick {item or location} -> flipFaceDown",
  "triggered:cardDestroyed (sourceIsEventCard) -> modifyInfluence controller -4",
  "flipUp {cost:2, threshold:'g'}" ] });

C("Geldale, City-Fortress", { caps: ["continuous-play-restriction"], shapes: [
  "continuous: playRestrictions [{player:opponent, kind:{cardType:'tactic'}, timing:'notActivePlayer'}] ('opponents may only play tactics during their own turn')" ] });

gosche("Gosche's God Amplification Chamber",
  "optional lookAndReorder own deck top 1 to:'split' (look, may bottom it)");
gosche("Gosche's Restoration Fortress",
  "optional pick {character, statCompare strength < strength of eventCard} -> restore");
gosche("Gosche's Retained Earnings Vault",
  "modifyInfluence controller +2");
gosche("Gosche's Solar Citadel",
  "optional createTokens {name:'Micromajig', count:1} under controller",
  { notes: "Gosche's cycle. Trigger also requires the leaving card be a non-token character (add condition not isToken eventCard)." });
gosche("Gosche's Spynarium",
  "optional pick character -> grantKeyword covert untilEndOfTurn");

C("PP&E", { shapes: [
  "activated PAY OFF: condition respondingTo {respondsTo:'card', cardType:'character'}, costs [deplete source, payResources 1, destroy source], effects [terminate {target:respondedToCard}]" ] });

C("Wasteland", { meta: { unique: "wasteland" }, shapes: [
  "triggered:damageDealt — condition and(eventCardIs source, cardTypeIs {damageSource} character) -> destroy {damageSource}",
  "triggered:turnStarted (eventPlayerIs controller) -> addCounter source token 1",
  "triggered:counterChanged (sourceIsEventCard) — condition counterCompare source token >= 3 -> forEach {non-resource card, zone:play} moveCard void" ] });

C("Zenobia's Tower", { meta: { unique: "watchtower" }, shapes: [
  "triggered:turnStarted (eventPlayerIs controller) -> optional lookAndReorder own deck top 2, to:'split' (1 to hand, 1 to bottom)",
  "triggered:cardDestroyed (sourceIsEventCard) -> optional search deck {name:\"Zenobia's Tower\"} reveal -> moveCard hand" ] });

// =====================  TACTICS  =====================
C("Arcane Ambush", { shapes: [
  "behavior.onPlay: condition isActivePlayer; target [faction]; effects [forEach {type:item} destroy, forEach {type:location} destroy, if (count each of uniqueDesignation jo/eustace/pluck/rudolphus/ignatious controller:self >= 1) -> dealDamage faction 15 + forEach {character controller:{controllerOf faction}} dealDamage 15]",
  "flipUp {cost:6, threshold:'ogedr'}" ],
  notes: "Reads the FEALTY Uniques via count of uniqueDesignation selectors — no capability. FLIP UP threshold is one of each icon except V." });

C("Auditory Adulation", { shapes: [
  "behavior.onPlay: condition not battleActive; target [character]; effects [createModifier picked strength +{cardCost picked} untilEndOfTurn, optional play a resource (chooserSelectsTarget hand -> playResource auto)]",
  "flipUp {cost:3, threshold:'r'}" ] });

C("Bank Rolled", { shapes: [
  "behavior.onPlay: variables {x} choose-number, costs [loseInfluence {variable x}]; target [{character, cardCost == {variable x}}]; effects [destroy picked]",
  "flipUp {cost:4, threshold:'gg', effects:[modifyInfluence controller +4]}" ] });

C("Brainbath", { shapes: [
  "tactic effects: draw controller 2, then moveSelected 1 from hand -> deck bottom",
  "activated RECUR: activationZone discard, threshold 'oo', costs [payResources 4, removeFromGame source], effects [opponent discards 1, draw controller 1]" ] });

C("Breath of the Barduse", { shapes: [
  "behavior.onPlay: condition isActivePlayer; effects [forEachPlayer -> mayPay? no — 'Each player destroys 2 characters they own. Otherwise destroy all of that player's characters.' = forEachPlayer: chooserSelectsTarget by that player {character owner: that player} count 2 required; if they cannot/decline -> forEach {character owner: that player} destroy]" ],
  notes: "'Each player destroys 2 ... Otherwise destroy all' — forEachPlayer with a mandatory 2-pick that falls back to a full wipe if <2 available or declined. medium confidence on the 'otherwise'.", confidence: "medium" });

C("Cunning Ruse", { shapes: [
  "behavior.onPlay: target [item]; effects [flipFaceDown picked under {controllerOf picked}'s... 'its opponent's control']" ],
  notes: "'Flip the item face-down under its opponent's control' — flipFaceDown normally flips under owner's control; here under the owner's OPPONENT. May need flipFaceDown {controller} param. medium confidence.", confidence: "medium" });

C("Deicidal Detonation", { shapes: [
  "tactic effects: chooserSelectsTarget {count: any, optional} over {non-resource card} -> forEach selected addCounter token 1",
  "activated RECUR: activationZone discard, threshold 'o', costs [payResources 4, removeFromGame source], effects [forEach {card, counterCompare __candidate token >= 1} destroy]" ],
  notes: "'any number of non-resource cards' — declaration count = {count {non-resource card}} with optional:true." });

C("Demolition Investment", { caps: ["resource-attachment-selector"], shapes: [
  "behavior.onPlay: costs [pick player, loseInfluence 3]; effects [that player reveals a face-down resource they control (chooserSelectsTarget by that player over {resource faceDown:true owner: that player}); modifyInfluence controller +{cardCost that resource}; destroy that resource]",
  "flipUp {cost:4, threshold:'g'}" ],
  notes: "Face-down resource reveal + value = its numeric cost (cardCost reads the real definition even while face-down)." });

C("Difference of Opinion", { shapes: [
  "tactic effects: optional pick character -> dealDamage 1; if battlePartySize ownParty(attacking) >= 2 -> optional pick character -> dealDamage 2",
  "flipUp {cost:4, threshold:'r', effects:[optional pick item -> destroy]}" ] });

C("Flesh Deliquesce", { caps: ["distinct-count-expression", "resource-attachment-selector"], shapes: [
  "behavior.onPlay: costs [pick opponent]; variables {x:{count {resource controller: that opponent, attachedToFaction:false}}}; target [character]; effects [if statCompare picked strength <= {variable x} -> destroy picked]" ],
  notes: "X = number of DETACHED resources that opponent controls (attachedToFaction:false selector predicate)." });

C("Frantic Jerryrigging", { shapes: [
  "behavior.onPlay: costs [destroy {item controller:self}]; bind x = {cardCost <destroyed item>}; effects [chooserSelectsOption [ {search deck {type:item, cardCost <= {add:[{variable x},2]}} reveal -> moveCard hand}, {pick {item controller:opponent, cardCost <= x+2} -> destroy} ]]" ] });

// God's Blessing cycle -----------------------------------------------------
function blessing(name, unique, grantedShapes, etb) {
  C(name, {
    meta: { unique: "blessing", attachTo: "character" },
    caps: ["granted-continuous-ability"],
    shapes: [
      "tactic/mutation, attachTo character — resolves into play attached (attach-tactic-resolves-into-play)",
      ...(etb ? [etb] : []),
      `continuous grantedAbilities over {isCard attachedTo}: grant the quoted rules text as [${grantedShapes}] — needs granted-continuous-ability for the aura/restriction members`,
    ],
    notes: "God's Blessing cycle. The quoted 'gains the following rules text' block mixes triggered + continuous + restriction members granted to the attached character (sourced on the recipient so 'all your characters' = the recipient's controller's team).",
    confidence: "medium",
  });
}
blessing("God's Blessing of Boost", "blessing",
  "triggered turnStarted -> forEach {character controller:self} dealDamage 1; continuous aura {character controller:self} +1 strength",
  "ETB: forEach {type:character} dealDamage 1");
blessing("God's Blessing of Foresight", "blessing",
  "triggered turnStarted -> optional pick {character controller:self} addCounter token 1; continuous aura {character controller:self} -1 speed; continuous aura {character controller:self, counterCompare token>=1} +1 strength + keyword covert");
blessing("God's Blessing of Moola", "blessing",
  "triggered cardRestored (controller:self) -> createModifier that char strength -1 untilEndOfTurn + draw 1; continuous aura {character controller:self} restriction cannotBeRestoredByRule; triggered turnStarted -> alternatingPayLoop-style repeat: inflict 1 to your faction + restore a character, once per character you control");
blessing("God's Blessing of Readiness", "blessing",
  "continuous aura {character controller:self} -1 strength +1 life; triggered turnStarted(opponent) -> optional forEach {character controller:self} restore");
blessing("God's Blessing of Transfiguration", "blessing",
  "continuous aura {character controller:self} +1 strength -1 life; triggered damageDealt (a character you control -> faction) -> mill {ownerOf eventCard} 1");

C("Gosche's Voidal Frequency Emission", { shapes: [
  "behavior.onPlay: target [{character zone:discard owner:self}]; effects [draw controller 1, chooserSelectsOption [ {moveCard picked -> deck position:top}, {putIntoPlay picked -> {ownerOf picked} faceDown:true} ]]",
  "flipUp {cost:2, threshold:'r'}" ] });

C("Haunting Execution", { shapes: [
  "behavior.onPlay: costAdjust {conditional: if (count {character zone:discard owner:self} >= 4) then -3 else 0}; target [character]; effects [destroy picked]",
  "activated RECUR: activationZone discard, threshold 'g', costs [payResources 2, removeFromGame source], targets [{character zone:discard owner:self}], effects [moveCard picked -> hand]" ] });

C("Headshot", { shapes: [
  "behavior.onPlay: target [character]; effects [dealDamage picked 1; then a 3-deep nested chain: if picked not in play (destroyed) -> optional pick another character -> dealDamage 1 -> ... repeat x3]",
  "flipUp {cost:4, threshold:'r'}" ],
  notes: "Cascading 'if it is destroyed by that damage, you may pick another' — nested if(not targetInZone play) + optional pick + dealDamage, 3 levels. reusesProvenShape (Suicide Smash / Headshot-style chains exist).", confidence: "medium" });

C("Interpret the Void", { shapes: [
  "tactic effects: chooserSelectsTarget up to 3 over own deck -> forEach moveCard void; if deployedViaFlipUp -> optional pick {tactic zone:void} -> moveCard hand",
  "flipUp {cost:5, threshold:'oo'}" ] });

C("Last Minute Weaponization", { shapes: [
  "behavior.onPlay: costs [destroy {item controller:self}]; bind x = {cardCost <destroyed>}; target [character]; effects [dealDamage picked {add:[{variable x},1]}, optional search deck {type:item, cardCost <= {variable x}} reveal -> moveCard hand]",
  "flipUp {cost:2, threshold:'eeee'}" ] });

C("Lead the Assault", { shapes: [
  "tactic effects: target [{character controller:self, conditions:[inBattle __candidate as attacker]}]; createModifier +2 strength/+2 life untilEndOfTurn; if battlePartySize ownParty(attacking) >= 2 -> +2/+2 more",
  "flipUp {cost:4, threshold:'e'}" ] });

C("Limited Liability", { caps: ["prevent-all-damage-window", "restrict-destruction-window"], shapes: [
  "tactic effects: [restrictDestruction {duration:untilEndOfTurn}, preventAllDamage {duration:untilEndOfTurn}]" ],
  notes: "'can only be destroyed by costs' = restrictDestruction window (the destroy EFFECT no-ops; destruction paid as a COST still works). 'all inflicted damage reduced to 0' = preventAllDamage window." });

wont("Lost on Floor 3",
  "'Play this only ... after you have declared the end of your turn ... in response to your opponent paying a cost at the end of your turn. Terminate your end of turn declaration.' Needs a cancellable end-of-turn declaration + a response-to-end-of-turn-cost play window — turn-structure machinery no other catalog card uses. Single rare tactic.");

C("Moment of Annihilation", { shapes: [
  "behavior.onPlay: costs [optional remove up to 3 {non-character card zone:discard owner:opponent} from game via sacrificeSelected/removeSelected]; costAdjust {multiply:[{selectionCount removed}, -1]}; target [character]; effects [if statCompare picked life <= 4 -> destroy picked]" ] });

C("Overindulge", { shapes: [
  "behavior.modes: [ {targets:[character], effects:[createModifier picked life -2 untilEndOfTurn]}, {targets:[character], effects:[createModifier picked life -1 untilEndOfTurn, draw controller 1]} ]" ],
  notes: "'Choose one of the following as this card's rules text' = behavior.modes." });

C("Purloining Performance", { shapes: [
  "behavior.onPlay: costs [pick opponent]; effects [lookAndReorder that opponent's deck top 4 (chooser:controller); if battlePartySize ownParty(attacking) >= 2 -> optional mill that opponent up to 3]",
  "flipUp {cost:4, threshold:'d'}" ] });

C("Quotidian Assassination", { shapes: [
  "behavior.onPlay: target [character]; effects [moveCard picked -> hand]" ],
  notes: "FAQ (RULES.md §1): cannot pick a faction. Existing coverage entry was already 'classified' — re-audited, confirmed." });

C("Quotidian Quagmire", { caps: ["resource-attachment-selector"], shapes: [
  "behavior.onPlay: target [character]; effects [{controllerOf picked} may detach up to 2 {resource attachedToFaction:true, owner: that player}; createModifier picked speed -1 untilEndOfTurn; draw controller 1]" ] });

C("Regroup & Reassess", { shapes: [
  "tactic effects: draw controller 2; if battlePartySize ownParty(attacking) >= 2 -> draw 2 more then moveSelected 1 from hand -> discard",
  "flipUp {cost:5, threshold:'g'}" ] });

C("Retreat to Mount Mulrich", { shapes: [
  "behavior.onPlay: target [character]; effects [scoped replacement on picked: if it would leave play this turn -> moveCard hand instead]",
  "flipUp {cost:1, threshold:'d'}" ],
  notes: "'If the character would leave play this turn, put it into its owner's hand instead' — a duration'd scoped moveToZone replacement on the pick. Retreat-to-hand idiom; reuse replacement machinery.", confidence: "medium" });

C("Ritual of the Sucking Skull", { shapes: [
  "behavior.onPlay: condition respondingTo {respondsTo:'card'} + the responded card was deployed via FLIP UP; bind x = {cardCost respondedToCard}; effects [terminate {target:respondedToCard}; if not deployedViaFlipUp (this card) -> {controllerOf respondedToCard} may detach up to {variable x} resources]",
  "flipUp {cost:4, threshold:'o'}" ],
  notes: "'in response to a card being deployed using FLIP UP' — needs respondingTo + a 'the responded card used FLIP UP' check. May need a small condition (respondedToCardViaFlipUp). medium confidence.", confidence: "medium" });

C("Ritualized Destruction", { shapes: [
  "behavior.onPlay: target [{non-resource card}]; effects [if textMentionsIcon picked volition -> moveCard void; else moveCard hand]",
  "flipUp {cost:3, threshold:'o'}" ] });

C("Servers Unavailable", { shapes: [
  "behavior.onPlay: condition respondingTo {respondsTo:'card'}; effects [terminate {target:respondedToCard}]",
  "flipUp {cost:5, threshold:'eee', effects:[createTokens {name:'Micromajig', count:1} under controller]}" ] });

C("Single Combat", { shapes: [
  "behavior.onPlay: target [{character or location}]; effects [if textMentionsIcon picked volition -> dealDamage picked 6; else dealDamage picked 2]",
  "flipUp {cost:1, threshold:'rr'}" ] }, 0);
C("Single Combat", { shapes: ["identical to other Single Combat printing"], notes: "Second printing — identical." }, 1);

C("Strategic Vision", { shapes: [
  "tactic effects: chooserSelectsTarget up to 2 over own deck {type:resource, staple:true, name != 'Greed'} with distinctNames -> forEach moveCard hand; modifyInfluence controller +1" ],
  notes: "'up to 2 different types of staple resources' = a distinctNames target declaration (count 2, optional). No new capability. 'not named Greed' = selector conditions not cardNameIs 'Greed'.",
  confidence: "high" });

C("Unaccustomed Inspection", { shapes: [
  "behavior.onPlay: target [{non-resource card}]; effects [if textMentionsIcon picked volition -> destroy picked; else modifyInfluence controller -{cardCost picked} + flipFaceDown picked]",
  "flipUp {cost:2, threshold:'gg'}" ] });

C("Undesirable Intrusion", { shapes: [
  "behavior.noResponse; behavior.onPlay: condition respondingTo {respondsTo:'ability', source is a character}; effects [terminate {target:respondedItem}, destroy {respondedAbilitySource}, createTokens {name:'Micromajig', count:1} under {controllerOf respondedAbilitySource}]",
  "flipUp {cost:2, threshold:'e'}" ] });

C("Volatile Communion", { shapes: [
  "behavior.onPlay: variables {x} choose-number, costs [depleteSelected x over {character controller:self}]; effects [lookAndReorder own deck top {add:[{variable x},2]}, to:'split' — 1 to hand, rest to bottom in chosen order]",
  "flipUp {cost:1, threshold:'o'}" ] });

C("Wary Reunion", { caps: ["distinct-count-expression"], shapes: [
  "behavior.onPlay: target [character]; variables {x:{distinctCount {controller:self}, by:trade}}; effects [if statCompare picked life <= {variable x} -> removeFromGame picked]",
  "flipUp {cost:2, threshold:'d'}" ] });

C("Wasted Wickedness", { caps: ["distinct-count-expression"], shapes: [
  "behavior.onPlay: costs [pick player]; variables {x:{distinctCount {controller: that player, staple:true, type:resource}, by:name}}; costs [payResources {add:[{variable x},{variable x}]}] (Pay X+X); effects [that player moves {variable x} non-resource cards they control -> their hand (chooserSelectsTarget by that player)]" ],
  notes: "'Pay X +X' printed oddly = Pay 2X (X = that player's distinct staples)." });

C("Whistleblower Policy", { caps: ["distinct-count-expression"], shapes: [
  "behavior.onPlay: costs [optional pick location -> rememberTarget 'loc']; effects [if picked a location -> addCounter {remembered loc} damage 3 (setDamage/dealDamage +3 markers); if deployedViaFlipUp -> draw controller {distinctCount {controller:self, staple:true, type:resource}, by:name}]",
  "flipUp {cost:3, threshold:'g'}" ] });

C("Wily Circumvention", { shapes: [
  "behavior.onPlay: target [{character depleted:true}]; effects [skipNextRestore picked]",
  "flipUp {cost:1, threshold:'e'}" ],
  notes: "'does not restore during its controller's next RESTORE RULE' = skipNextRestore (one-shot flag). Was already 'classified' in coverage — re-audited, upgraded shape to skipNextRestore." });

C("Zenobia's Intervention", { caps: ["distinct-count-expression"], shapes: [
  "behavior.onPlay: target [character]; effects [createModifier picked strength +{d} / life +{d} untilEndOfTurn where d = distinctCount {controller:self, staple:true, type:resource}, by:name]" ] });

C("Zenobia's Succor", { shapes: [
  "behavior.modes (5): each mode target [character] + threshold-gate condition on one icon: [O]->grantKeyword covert untilEndOfTurn; [G]->+2 life; [E]->grantKeyword aggro; [D]->+1 speed; [R]->+2 strength (all untilEndOfTurn)" ],
  notes: "Tactic version of Soulsearcher — modal with per-mode icon condition. medium confidence on whether modes gate cleanly on icon conditions.", confidence: "medium" });

C("Zenobian Mechanics Explained", { shapes: [
  "behavior.onPlay: target [{character controller:opponent}]; effects [moveCard picked -> hand; if battlePartySize ownParty(attacking) >= 2 -> {controllerOf picked} discards 1]",
  "flipUp {cost:4, threshold:'o'}" ] });

// ---- write -----------------------------------------------------------------
const path2 = path.join(ROOT, ".work", "classify-um-all.json");
fs.writeFileSync(path2, JSON.stringify(out, null, 2) + "\n");
const seen = new Set();
for (const e of out) {
  if (seen.has(e.id)) throw new Error(`dup id ${e.id} (${e.name})`);
  seen.add(e.id);
}
const umIds = new Set(um.map(c => c.id));
const missing = [...umIds].filter(x => !seen.has(x));
if (missing.length) {
  console.log("MISSING", missing.length, missing.map(x => um.find(c => c.id === x).name));
}
const byStatus = {};
for (const e of out) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
const caps = {};
for (const e of out) for (const c of e.engineCapability) caps[c] = (caps[c] || 0) + 1;
console.log("wrote", out.length, "entries;", JSON.stringify(byStatus));
console.log("capabilities:", JSON.stringify(caps, null, 0));
