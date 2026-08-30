#!/usr/bin/env node
/* Applies the Shade of the Devoured Emperor classification pass to
 * data/card-coverage.json:
 *   - patches each unclassified SotDE entry with behavior.shapes / metadata /
 *     engineCapability / confidence / notes / status
 *   - merges the new capability specs into the top-level `capabilities` map
 * Throwaway. Re-runnable (idempotent by id / capability key).
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const COV = path.join(ROOT, "data", "card-coverage.json");
const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const byId = new Map(cov.cards.map(e => [e.id, e]));

// --- new capability specs (SotDE pass) --------------------------------------
// status: "implemented" once the engine change + fixture test + RULES/BEHAVIORS
// update lands; "unimplemented" while it's still just a spec.
const CAPS = {
  "active-player-condition": {
    status: "unimplemented", kind: ["condition"],
    spec: "Condition { type:'isActivePlayer', player?:PlayerRef (default 'controller') } — true when the resolved player is GameState.activePlayerId. Gates 'use this only during your turn' activated abilities / 'deploy this only during your turn' tactics. Hassan-i HARASH, Banana Peel, Confrontational Conflagration, Words of Glory, Shriever Breeding Program, Study Disturbance."
  },
  "battle-active-condition": {
    status: "unimplemented", kind: ["condition"],
    spec: "Condition { type:'battleActive' } — true while GameState.battle is set and not finished. Compose with `not` for 'deploy this only NOT during a battle'. Drill Instructor, Fanatical Shriever, Fistfight, Confrontational Conflagration, Words of Glory, Sneaker Attack! (needs it true)."
  },
  "controller-of-playerref": {
    status: "unimplemented", kind: ["expression"],
    spec: "PlayerRef { type:'controllerOf', target:TargetRef } — the current controller of a targeted card (parallel to the existing 'ownerOf'). 'That character's controller ...' / 'its controller must choose ...'. Contiguous Defalcating Machine, Audacious Appraisal, Contractual Execution, Underwhelming Performance, Thabbashite Warmonger, The Lugubrian Council."
  },
  "card-subtype-condition": {
    status: "unimplemented", kind: ["condition"],
    spec: "Condition { type:'cardSubtypeIs', target:TargetRef, subtype:string } — true when target's CardDefinition.subtype includes `subtype`. For eventCard subtype checks a CardSelector can't reach ('when another \"cicibeo\"/\"gear\"/\"horsemajig\" card enters play', 'if the picked character is a \"dragon\"'). Cicibeo the Swift, Draconic Luteoderm Suit, Pwny Bomb, Confrontational Conflagration."
  },
  "unique-designation-selector": {
    status: "unimplemented", kind: ["expression", "condition"],
    spec: "CardSelector.uniqueDesignation?: string | string[] (match CardDefinition.unique) + Condition { type:'uniqueIs', target, designations:string[] }. 'search for a UNIQUE JO', 'all UNIQUE EUSTACE gain +3/+3', 'a character you control with UNIQUE EUSTACE'. Shade of the Devoured Emperor, Siluriformes Flaxenscale, Testudine Autoframe, Draconic Luteoderm Suit, Golden Charm."
  },
  "lose-influence-cost": {
    status: "unimplemented", kind: ["cost"],
    spec: "Cost { type:'loseInfluence', amount:NumberExpression, player?:PlayerRef (default 'controller') } — 'Your faction loses N influence' as an activated-ability / EXTRA cost (distinct from the modifyInfluence effect; must be payable = influence not driven below 0? per CR influence can't be paid you don't have — treat as always payable, clamp at 0). Discordant Cadencer, Eustace Padamose-Gristwalter, Thabbashite Armorer, Thabbashite Financier."
  },
  "grant-provides": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'grantProvides', target:TargetRef, icon:ResourceIcon | { fromNamed:string }, amount:NumberExpression, duration:Duration } + GameState.provideGrants: RuntimeProvideGrant[] (cardId, icon, amount, duration, createdTurn), consulted by getResourceIcons (so getThresholds / cardProvides / resourceIcons all see it) and cleared like modifiers. Card-level, unlike the player-level grantResourceIcons — survives-scoped to the card, works on 'each face-down resource'. Anxious Imp, Discordant Cadencer, Elitistmajig, Goldmau Sacks Representative, Thabbashite Chemist."
  },
  "name-resource-icon": {
    status: "unimplemented", kind: ["choice"],
    spec: "nameValue effect + PendingNameValueChoice gain valueKind 'resourceIcon' (name one of rage/greed/deception/elitism/obsession/volition). The stored string is read by grantProvides.icon.fromNamed / reduceThreshold.icon.fromNamed. Thabbashite Chemist, Clockman Skydocks."
  },
  "reduce-threshold-requirement": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'reduceThreshold', player:PlayerRef, icon:ResourceIcon | { fromNamed:string }, amount:NumberExpression } + GameState.thresholdReductions (playerId, icon, amount, createdTurn), consumed by the next successful deploy this turn (like reduceNextCost), consulted in meetsThreshold. Clockman Skydocks BUSINESS DAY / OVERTIME."
  },
  "in-play-since-turn-start-condition": {
    status: "unimplemented", kind: ["condition"],
    spec: "Condition { type:'inPlaySinceTurnStart', target?:TargetRef (default 'source') } — true when the card's attackEligibleTurn === GameState.turn (i.e. it has been in play under its controller since the start of this turn). 'Use this only if this card has been in play since the start of the turn.' Jo Ciendeilio's granted RESEARCH ability."
  },
  "attack-limit-per-turn": {
    status: "unimplemented", kind: ["ids", "battle", "state"],
    spec: "Restriction 'attackOncePerTurn' (granted statically via behavior or as a continuous aura) + GameState.attacksThisTurn: Record<CardInstanceId, number>, incremented in declareAttack, reset each turn; declareAttack rejects a character that already attacked this turn while it has the restriction. 'This card can attack only once each turn' / 'Characters you control can attack only once each turn.' Pinguid Bodyguard, Skullcrush Steamroller, Torchlight District."
  },
  "restore-at-end-of-battle": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "scheduleEffect gains when:'endOfBattle' — fired as the current battle ends (battleEnded), then discarded. Lets 'when this attacks, restore it at the end of the battle' be a characterAttacked trigger that schedules a `restore` of the event card. Pinguid Bodyguard, Torchlight District; Barracks of Precipitancy (partial)."
  },
  "add-to-battle": {
    status: "unimplemented", kind: ["effect", "battle"],
    spec: "Effect { type:'addToBattle', target:TargetRef, side:'attacking' | 'blocking' | 'choose' } — insert an in-play character into the current battle's attacking/blocking party (inverse of removeFromBattle). 'choose' pauses on a chooserSelectsOption. No-op with no active battle. Does not deplete / re-check AGGRO (it's being added by an effect). Carnival Ringmaster, Sneaker Attack!."
  },
  "lose-rules-text": {
    status: "unimplemented", kind: ["ability"],
    spec: "ContinuousAbility.suppressAllAbilities?: { target?:TargetRef; selector?:CardSelector } — while `condition` holds, the target/selector cards lose every OTHER ability (activated / triggered / continuous / replacement / granted), keeping only THIS ability. hasAbility / getActivatableAbilities / findTriggers / continuous recompute all skip a suppressed card's other abilities. Monstrous Lassitude, Rushing Crushing Blockhead, Mittens of Muffled Thought."
  },
  "untargetable": {
    status: "unimplemented", kind: ["ids", "state"],
    spec: "Restriction 'cannotBePicked' (continuous / conditional) — a card with it is removed from the candidate list of any player-or-chooser TARGET declaration (validateTargetDeclarations / autoSelectTargets / findUnresolvedTargetDeclarations / selectTargets pending choice / chooserSelectsTarget), but NOT from forEach / count / aura selectors. Optional scope { by?: 'nonItemSource' } for 'cannot be picked by non-item cards or abilities' (checks the resolving source's card type) — deferred if only Gigantitect needs it. Gigantitect's Giant Giant, Martial Arts Wannabe (conditional), Gloamspike-Gosche Bridge, Parkour Hoodlum (by locations — deferred scope)."
  },
  "remove-card-type": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'removeCardType', target:TargetRef, cardType:CardType } — clears a cardType previously ADDED by setCardType (removes matching GameState.cardTypeGrants entries for that card). No-op on the printed type. 'If this card is a character, it loses the \"character\" type.' Frickin' Sweet Pogo-Bunny."
  },
  "player-play-restriction": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'restrictPlay', player:PlayerRef, kind:'cardType' | 'flipUp' | 'response', cardType?:CardType, duration:Duration } + GameState.playRestrictions[]. assertCanDeployAtCurrentTiming / the flipUp action / the response-window opener consult it. 'That player cannot play characters this turn', '... may not play cards using FLIP UP', 'Your opponents cannot respond to this card' (response -> a stack-item flag, see cannot-be-responded-to). Study Disturbance, Surreptitious Larceny, Swindle."
  },
  "sum-stat-expression": {
    status: "unimplemented", kind: ["expression"],
    spec: "NumberExpression { type:'sumStat', selector:CardSelector, stat:Stat } — sum of `stat` (live value) over every card matching selector. 'X is the total strength of all characters your opponents control.' Words of Glory."
  },
  "event-damage-amount-expression": {
    status: "unimplemented", kind: ["expression"],
    spec: "NumberExpression { type:'eventDamageAmount' } — the damage amount of the current `damageDealt` triggering event (0 outside one). 'put the top X cards ... where X is the amount of damage inflicted by this character.' Totally Random Kid."
  },
  "event-damage-source-targetref": {
    status: "unimplemented", kind: ["expression"],
    spec: "TargetRef { type:'damageSource' } — the source card of the current `damageDealt` event (event.sourceId), parallel to 'eventCard' resolving to its target. 'X is the number of threshold icons of the character [that dealt the damage]'. Thabbashite Warmonger."
  },
  "threshold-icon-count-expression": {
    status: "unimplemented", kind: ["expression"],
    spec: "NumberExpression { type:'thresholdIconCount', target:TargetRef } — the number of icons in a card's printed threshold (length of the normalized threshold string / sum of a numeric threshold). 'X is the number of threshold icons of the character.' Thabbashite Warmonger."
  },
  "counter-threshold-trigger": {
    status: "unimplemented", kind: ["ability", "state"],
    spec: "TriggeredAbility event 'counterChanged' (emitted by addCounter/removeCounter with { cardId, counter }) + condition counterCompare on source, so 'when there are at least/no tokens on this card, ...' fires immediately. Alternatively a state-based check. Flaming Cube, Runic Map ('when there are no tokens, destroy it')."
  },
  "chooser-nominates-number": {
    status: "unimplemented", kind: ["choice", "expression"],
    spec: "Effect { type:'chooserSelectsNumber', chooser:PlayerRef, storeAs:string, min?:NumberExpression, max?:NumberExpression, effects:Effect[] } — pauses for `chooser` (not the acting player) to pick an integer, bound into context.variables[storeAs] for `effects`. 'That character's controller chooses a number for X.' Audacious Appraisal."
  },
  "damage-history-this-turn": {
    status: "unimplemented", kind: ["state", "condition"],
    spec: "GameState.damageThisTurn: per-card record { assignedDamage:boolean; toFactionOf:PlayerId[] } populated on damageDealt, reset each turn. Conditions { type:'assignedDamageThisTurn', target? } and { type:'inflictedDamageToFactionThisTurn', player:PlayerRef, target? }. Backdoor Brigand ('has not assigned damage this turn'), Drive By Boobing ('a character that inflicted damage to your faction this turn')."
  },
  "modal-card": {
    status: "unimplemented", kind: ["cards", "engine", "choice"],
    spec: "CardDefinition.behavior.modes?: Array<{ label?; condition?; costs?; targets?; effects?; onPlay?: same shape }> — 'Choose one of the following as this card's rules text'. The controller picks a mode at play time (a `mode` field on the playCard action, or a pre-play PendingChoice) BEFORE the chosen mode's EXTRA COST / targets / condition are evaluated; only that mode's effects resolve. Distinct from chooserSelectsOption (which needs shared cost/targets). Expedition Endeavour, Shriever Breeding Program, Surreptitious Larceny."
  },
  "temp-numeric-cost-modifier": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'modifyNumericCost', target:TargetRef, delta:NumberExpression, duration:Duration } + GameState.numericCostModifiers (per card), consulted wherever a card's numeric cost is read (getCardPlayability, deployCard, cardCost expression? — no, printed only). 'This turn, the character loses/gains 1 numeric cost.' Guileful Astucion."
  },
  "play-resource-as-player": {
    status: "unimplemented", kind: ["effect"],
    spec: "playResource effect gains player?:PlayerRef (default context.controllerId) so 'that player puts a card from their hand face-down as a resource under their control' resolves under the right player. Man Shark, Forgotten Tentacle."
  },
  "opponent-may-pay-to-counter": {
    status: "unimplemented", kind: ["cost", "choice"],
    spec: "An EXTRA-COST clause on a tactic: a picked player may pay N; if they do, an effect resolves (peek top card(s) / reorder) and THIS card is terminated before resolving. Model as the tactic's first-ability `costs`/effects prelude: chooserSelectsOption(chooser=picked) [decline] / [mayPay N -> lookAndReorder + terminate self]. May need a `terminate self mid-play` path. Study Disturbance, Tedious TriAdic Truculence."
  },
  "borrowed-until-end-of-turn": {
    status: "unimplemented", kind: ["effect"],
    spec: "putIntoPlay gains borrowed?:boolean — the card is removed from the game if it would leave play OR at end of turn (whichever first), via a scoped replacement + endOfTurn scheduled effect on that instance. 'put that card into play ... If that character would leave play or is in play at the end of the turn, remove it from the game instead.' Barracks of Precipitancy."
  },
  "damage-modifier-by-source": {
    status: "unimplemented", kind: ["ability"],
    spec: "DamageModifierDefinition gains sourceSelector?:CardSelector matching the damage DEALER (not just the target). 'All damage assigned to this card by characters with items attached to them is reduced to 0.' Enlightened Mau."
  },
  "outgoing-damage-modifier": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'modifyOutgoingDamage', source:TargetRef, delta:NumberExpression, duration:Duration } — a runtime list keyed on the damage SOURCE that tunes damage it deals this turn (floored at 0). 'This turn, if damage is inflicted to a character or faction by this card, reduce the amount by 1.' Sockem Bot (usableBy anyPlayer)."
  },
  "skip-restore-rule": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'skipRestoreRule', player:PlayerRef, turns?:number (default 1) } — the player's faction Restore Rule is skipped on their next N turns (a per-player counter consulted in applyFactionStartOfTurn). 'On your next turn, skip your faction's RESTORE RULE.' Monstrous Lassitude."
  },
  "skip-next-restore": {
    status: "unimplemented", kind: ["effect", "state"],
    spec: "Effect { type:'skipNextRestore', target:TargetRef } — a one-shot flag on a card so its controller's NEXT faction Restore Rule skips it once (then clears), unlike setRestoreLock which persists while in play. 'that character does not restore during its controller's next RESTORE RULE.' Numba 1 Stunna!."
  },
  "cannot-take-control": {
    status: "unimplemented", kind: ["ids"],
    spec: "Restriction / continuous flag 'cannotBeTakenControl' — the takeControl effect skips a card that has it (relative to who's taking control — 'Opponents cannot take control of this card'). Gigantitect's Giant Giant."
  },
  "continuous-from-hand": {
    status: "unimplemented", kind: ["ability"],
    spec: "ContinuousAbility.activeZone?: Zone (default 'play') — the ability is live while its source sits in that zone (parallel to TriggeredAbility.triggerZone). 'While this card is in your hand and there is a location in play, this card gains tactical.' Parkour Hoodlum."
  },
  "dynamic-tactical-honored": {
    status: "unimplemented", kind: ["engine"],
    spec: "assertCanDeployAtCurrentTiming's TACTICAL check must consult hasKeyword (dynamic grants) not just definitionHasKeyword, so a granted/aura TACTICAL lets a card be deployed in a response window. Needs a CardInstanceId in scope at that call site. Gloamspike-Gosche Bridge (aura over hand), Parkour Hoodlum."
  },
  "aura-over-hand-zone": {
    status: "unimplemented", kind: ["ability"],
    spec: "A ContinuousAbility aura (keywords/modifiers) whose selector names zone:'hand' must actually be evaluated for cards in hand — today auras are recomputed only over in-play cards. 'All characters in your hand gain TACTICAL.' Gloamspike-Gosche Bridge."
  },
  "any-player-may-pay": {
    status: "unimplemented", kind: ["effect", "choice"],
    spec: "Effect { type:'anyPlayerMayPay', costs:Cost[], effects:Effect[], order?:'activeFirst' } — offer an optional paid effect to each player in turn until one accepts (or all decline). 'any player may pay 4 to put that card on top of its owner's deck.' Recycling Scheme Facility."
  },
  "granted-activated-ability": {
    status: "unimplemented", kind: ["ability"],
    spec: "Wire ContinuousAbility.grantedAbilities ACTIVATED bodies: getActivatableAbilities / activateAbility resolve an ability granted to an in-play card by a selector, with source = the recipient. (Triggered granted bodies already work.) Jo Ciendeilio, M07h3r 0f 1337."
  },
  "create-token-then-effect": {
    status: "unimplemented", kind: ["effect"],
    spec: "createTokens gains effects?:Effect[] resolved once per created token with it bound to { type:'selected', id:'__candidate' } — e.g. shield the just-made token ('all damage inflicted to that token is reduced to 0 this turn'). Micromajigmakermachinemajig, Micromajig Recycling Station (Micromajig damage immunity)."
  },
  "triggered-variable-prompt": {
    status: "unimplemented", kind: ["choice"],
    spec: "TriggeredAbility.variablePrompt?: { id:string; min?:NumberExpression; max?:NumberExpression } — a triggered ability that first pauses for its controller to pick a number (bound to context.variables[id]) before targets/effects, so a trigger can do 'choose a number for X and destroy X tokens'. Micromajig Recycling Station."
  },
  "reveal-from-hand-rider": {
    status: "unimplemented", kind: ["cards"],
    spec: "CardDefinition.revealFromHand gains threshold?:string|number and effects?:Effect[] (a rider: 'your faction loses 2 influence', extra icon gate). 'FINE PRINT: [G][G][G][G] EXTRA COST: Reveal this card from your hand. Your faction loses 2 influence. Pay 2. EFFECT: Draw a card.' Unexpected Codicil."
  },
  "cannot-be-responded-to": {
    status: "unimplemented", kind: ["state"],
    spec: "A flag on the StackItem (set by a tactic's EXTRA COST clause) that suppresses the opponent's response window for that item — it resolves without giving priority. 'Your opponents cannot respond to this card.' Swindle."
  },
  "search-interception": {
    status: "unimplemented", kind: ["ability"],
    spec: "A replacement-style hook on 'a player would search their deck' — an optional pay-and-draw that still lets the search happen. Niche; only Golden Charm (self) and (loosely) Arcane Escrow's develop-draw swap. Candidate for wontImplement-partial if it stays a 2-card ask."
  },
  "develop-draw-replacement": {
    status: "unimplemented", kind: ["ability"],
    spec: "An optional replacement of a Develop Rule draw with 'put a card from <void pile> into hand instead'. Only Arcane Escrow. Candidate for wontImplement-partial (author the rest of the card, gap this clause)."
  },
  "onplay-cost-adjust": {
    status: "unimplemented", kind: ["engine"],
    spec: "behavior.onPlay gains costAdjust?:NumberExpression evaluated in the play context and added (usually negative) to the numeric cost actually paid, floored at 0 — 'reduce this card's numeric cost by the number of cards removed [as an extra cost].' Opportunistic Pirate."
  },
  "attacker-blocked-trigger": {
    status: "unimplemented", kind: ["event"],
    spec: "An event / condition for 'when this attacking character becomes blocked' (declareBlockers, mapped to the attacker whose block was declared) — characterBlocked currently maps only to the blocker. 'When this card is blocked by an opposing party of 2 or more characters ...' Timid Mau."
  },
  "ward-redirect": {
    status: "unimplemented", kind: ["ability", "effect"],
    spec: "An EXTRA-COST pick + a continuous, unbounded redirect: while both the picked card and this card are in play, (a) damage that would be dealt to the picked card is dealt to this card instead, and (b) if the picked card would leave play by any means, THIS card leaves play in that way instead. Distinct from preventDamage (bounded/self), the redirectDamage keyword (battle-only), and setCardType. Needs ContinuousAbility.damageRedirects?: [{ from, to }] hooked in dealDamage AND a replacement that mirrors any leave-play of `from` onto `to`. 6r4wny 60dy9u4rd5."
  }
};

for (const [id, cap] of Object.entries(CAPS)) {
  if (!cov.capabilities[id]) cov.capabilities[id] = cap;
  else {
    // keep an already-implemented status; refresh spec/kind
    cov.capabilities[id].spec = cap.spec;
    cov.capabilities[id].kind = cap.kind;
  }
}

// --- per-card classification ----------------------------------------------
// c(id, { shapes, caps, meta, conf, notes, status?, newShape? })
function c(id, o) {
  const e = byId.get(id);
  if (!e) throw new Error("no coverage entry for " + id);
  e.status = o.status || "classified";
  e.rulesAudited = true;
  e.behavior.needed = o.vanilla ? false : true;
  e.behavior.shapes = o.shapes || [];
  e.behavior.reusesProvenShape = o.newShape ? false : true;
  e.behavior.newTestNeeded = !!o.newShape;
  if (o.meta) e.metadata = { ...e.metadata, ...o.meta };
  e.engineCapability = o.caps || [];
  e.confidence = o.conf || "medium";
  e.notes = o.notes || "";
  if (o.gaps) e.parityGaps = o.gaps;
}

// ---- CHARACTERS ----
c("1082ff2c-afd3-4c84-89ae-1002579977df", {
  shapes: ["triggered:cardRestored (sourceIsEventCard) -> createTokens(controller,1,Micromajig)"],
  caps: [], conf: "high",
  notes: "cardRestored trigger + createTokens. Micromajig TokenSpec 0/1/1 subtype [micromajig] (matches Seed 3 authoring)."
});
c("8007e216-d21d-490c-ad3e-eae9677ee725", {
  shapes: [
    "onPlay.targets: pick a character you control; rememberTarget 'ward'",
    "continuous: damageRedirects [{from: remembered ward, to: source}]",
    "replacement: any leave-play of remembered ward -> source leaves play the same way instead"
  ],
  caps: ["ward-redirect"], conf: "medium", newShape: true,
  notes: "Unbounded continuous redirect of BOTH damage and leave-play from the warded character to this card, while both in play. CR §301.4-style 'leaves play the same way'. Needs the ward-redirect capability."
});
c("f235f7f5-ae5d-4b85-a187-6bfaf9d454cd", {
  shapes: [
    "triggered:turnStarted(controller) -> mayPay {costs:[payResources {counter token of source}], effects:[], elseEffects:[destroy source]}",
    "triggered:turnEnding(controller) -> addCounter token 1",
    "activated FEED: costs [payResources 3] -> removeCounter token 1"
  ],
  caps: [], conf: "high",
  notes: "mayPay auto-declines when unaffordable, falling through to destroy = 'if you don't, destroy this card'. payResources amount is a NumberExpression = counter('token')."
});
c("72661539-2086-49b7-a58d-b66a2ba45a30", {
  shapes: [
    "activated OBSESS: costs [payResources 2] -> grantProvides(source, obsession, 3, untilEndOfTurn)",
    "continuous: condition resourceIcons(controller,obsession) >= 6 -> keywords [{target:source, covert}]"
  ],
  caps: ["grant-provides"], conf: "high",
  notes: "PROVIDES gained this turn must be card-scoped (grant-provides), not the player-level grantResourceIcons. [O]x6 gate via numberCompare on resourceIcons."
});
c("766149f5-0021-41ca-bbc5-4dbf8484de40", {
  shapes: [
    "activated EXIT STAGE RIGHT: condition not assignedDamageThisTurn(source); costs [payResources 1] -> flipFaceDown source",
    "card.flipUp { cost:3, threshold:'dd' }"
  ],
  caps: ["damage-history-this-turn"], conf: "high",
  notes: "'has not assigned damage this turn' needs the per-turn damage-history tracker. FLIP UP 3 [D][D]."
});
c("1ce692f6-4dff-4d0e-a195-d0df9de5eb47", {
  shapes: ["triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(targetExists) deplete"],
  caps: [], conf: "high", notes: "Proven optional-ETB shape."
});
c("3db20240-f5a5-4fd9-925d-39b32cab7618", {
  shapes: ["continuous: condition resourceIcons(controller,rage) >= 6 -> modifiers str+1,life+1,speed+1"],
  caps: [], conf: "high", notes: "Volition-style [R]x6 paragraph. Proven shape (Dying Hero)."
});
c("2b1308a7-014c-4924-b430-0448854cb6cc", {
  shapes: [
    "display: top card of each opponent's deck revealed at all times (renderer hint only)",
    "continuous: condition cardTypeIs({deckPosition opponent top}, character) -> modifiers speed+3",
    "activated CHUG!: costs [payResources 2] -> moveCard({deckPosition opponent top}, deck, position:bottom)"
  ],
  meta: { unique: "pluck" }, caps: [], conf: "high",
  notes: "'Pick an opponent' collapses to PlayerRef 'opponent' in 2p. deckPosition + cardTypeIs + moveCard all exist. UNIQUE PLUCK."
});
c("fddf5886-b70a-4855-b338-422a4bad3cc3", {
  shapes: [
    "behavior.keywords [tactical]",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> addToBattle(source, choose) -> forEach character inBattle(same party) speed+1 EOT",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(targetExists) addCounter token 1"
  ],
  caps: ["add-to-battle"], conf: "medium", newShape: true,
  notes: "TACTICAL char that adds itself to a live battle. 'that party gains 1 speed' scoped via inBattle role after the add."
});
c("8d77787d-29d9-405f-a8a7-5d42bd854c11", {
  shapes: [
    "behavior.keywords [tactical]",
    "onPlay.costs: discard 1 {zone hand, conditions:[cardTradeIs rogue, not cardTypeIs resource]}",
    "activated-as-triggered [D]x6: triggered:cardEnteredPlay condition and(not sourceIsEventCard, cardSubtypeIs eventCard 'cicibeo', resourceIcons(controller,deception)>=6, <entered from hand>) -> optional pick character -> takeControl controller"
  ],
  meta: { unique: "cicibeo" }, caps: ["card-subtype-condition"], conf: "medium", newShape: true,
  notes: "'if it was deployed from your hand' — cardEnteredPlay doesn't distinguish source zone today; approximate by dropping that clause or add an entered-from-hand flag (flagged in notes, not a separate cap). Subtype 'cicibeo' assumed (names carry it in quotes)."
});
c("f8953a4a-6a5a-4104-bfbc-4626645dc766", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone deck, type item} -> if(exists) putIntoPlay(faceDown) + shuffleDeck",
    "activated TRASH [E]x6: costs [payResources 1, destroy source] + targets pick item -> destroy picked"
  ],
  caps: [], conf: "high", notes: "putIntoPlay from deck faceDown exists. threshold 'eeeeee'."
});
c("c842afad-8ee7-4e59-bb42-f06f51bf7bf6", {
  shapes: [
    "activated AGITATE: costs [payResources 1, loseInfluence 2] -> grantProvides(source, rage, 3, untilEndOfTurn)",
    "continuous: resourceIcons(controller,rage) >= 6 -> str+2"
  ],
  caps: ["grant-provides", "lose-influence-cost"], conf: "high", notes: "'Lose 2 influence' is an ability cost."
});
c("6a477977-867b-4cdc-acc0-1d3f00923031", {
  shapes: [
    "behavior.keywords [tactical]",
    "onPlay.condition: not battleActive",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> pick another character; rememberTarget; scheduleEffect(startOfNextTurn, condition linkedCardInPlay) -> createModifier str+3 untilEndOfTurn"
  ],
  caps: ["battle-active-condition"], conf: "medium",
  notes: "'the next turn' modelled as scheduleEffect startOfNextTurn (source controller's next turn). If it should fire on the opponent's turn instead, needs schedule-any-next-turn — noted, not blocking."
});
c("d1e9f12e-abc7-4768-9155-2eb23f0def8c", {
  shapes: [
    "triggered:cardEnteredPlay condition and(eventCardControlledBy controller, cardProvides(eventCard, rage, 1)) -> chooserSelectsOption [decline]/[addCounter token 1]",
    "continuous: str+{counter token}, life+{counter token}"
  ],
  caps: [], conf: "high", notes: "Exact Seed 2 card-provides-icon pattern."
});
c("42d337d5-bba5-48bb-be0a-ff19f295699a", {
  shapes: ["triggered:cardDestroyed(sourceIsEventCard) -> moveCard(source, hand); chooserSelectsTarget(controller, {zone hand} count 1) -> moveCard(discard)"],
  caps: [], conf: "high", notes: "Recover-to-hand then discard a card. Order: destroy resolves (card in discard) then trigger moves it to hand."
});
c("3a4918d7-7c70-4753-b070-0c6dd8799811", {
  shapes: [
    "activated CRUNCH: targets [{tok: {controller self, zone play, name 'Micromajig'} count 1}], costs [destroy {selected tok}] -> grantProvides(source, elitism, 3, untilEndOfTurn)",
    "continuous: resourceIcons(controller,elitism) >= 6 -> str+2,life+2"
  ],
  caps: ["grant-provides"], conf: "high"
});
c("77e72f4c-f1c8-4d81-8133-0562dc061b65", {
  shapes: [
    "activated HOWL: targets [{d: {owner self, name 'Deception'} count 1}], costs [destroy {selected d}] -> addCounter token 1",
    "activated PROWL: costs [removeCounter token 1] -> grantKeyword(source, covert, untilEndOfTurn)"
  ],
  caps: [], conf: "high", notes: "'a card named Deception you own' — default zone play (face-down resource) matches by definition.name."
});
c("3e70504b-36ea-4600-afc5-70254e5dc13c", {
  shapes: [
    "continuous: damageModifiers [{selector:{type character} bind target=source, sourceSelector:{characters with an item attached}, delta:-999 (reduce to 0)}]",
    "activated TRANSCEND: costs [payResources 5] -> grantKeyword(source, covert, untilEndOfTurn)"
  ],
  caps: ["damage-modifier-by-source"], conf: "medium",
  notes: "'damage assigned to this card BY characters with items attached' needs a source-side selector on damageModifiers."
});
c("3f574bdd-e7b7-4757-a955-2a33d19a250d", {
  shapes: [
    "activated FUTURE IMPLICATIONS: costs [payResources 2, loseInfluence 1] -> draw 1",
    "activated PAST TREPIDATIONS: costs [discard 1 {zone hand}] -> createModifier life+1 EOT; if(cardTypeIs {discarded} resource) createModifier str+1 EOT"
  ],
  meta: { unique: "eustace" }, caps: ["lose-influence-cost"], conf: "high",
  notes: "The discard cost's selected id is read back for the 'if the discarded card was a resource' branch."
});
c("9eddb4f8-2055-48b8-8942-664e6c9a0f50", {
  shapes: [
    "behavior.keywords [tactical]",
    "onPlay.condition: not battleActive; onPlay.targets [{it:{zone play, type item} optional}]; onPlay.effects: if(targetExists it) destroy {it}",
    "triggered:cardEnteredPlay condition and(sourceIsEventCard, resourceIcons(controller,rage)>=6) -> optional pick location -> if(exists) dealDamage 2"
  ],
  caps: ["battle-active-condition"], conf: "high"
});
c("53f1700e-6445-4b87-bf00-c69f88c6a278", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 2",
    "continuous: str+{counter token}",
    "activated DELIVERY: costs [removeCounter token 1, deplete source] + targets [{g:{controller self, zone play, faceDown true, subtype 'gear'} count 1}] -> deployFromZone(controller, {g}, ignoreThreshold:true); if(cardCost {g} <= 4) it's for free"
  ],
  caps: ["deploy-from-zone-conditional-free"], conf: "medium",
  notes: "Two clauses: (1) may deploy ignoring threshold [paying cost], (2) if cost<=4 deploy for free. deployFromZone always frees the numeric cost today; needs a conditional-free toggle (or model as chooserSelectsOption). Added cap deploy-from-zone-conditional-free."
});
CAPS["deploy-from-zone-conditional-free"] = {
  status: "unimplemented", kind: ["effect"],
  spec: "deployFromZone/deployForFree gain free?:'always'|'never'|Condition — deploy the revealed card paying its own numeric cost unless the condition holds (then waive it). 'You may deploy it even if you cannot meet its threshold. If its numeric cost is 4 or less, you may deploy it for free.' Gang Weapon Dealer."
};
if (!cov.capabilities["deploy-from-zone-conditional-free"]) cov.capabilities["deploy-from-zone-conditional-free"] = CAPS["deploy-from-zone-conditional-free"];
c("2a13a6f0-29b9-4f5d-a155-2b6bdea55257", {
  shapes: [
    "continuous: restrictions [{target:source, cannotBePicked, by:'nonItemSource'}]",
    "continuous: flag cannotBeTakenControl (by opponents)"
  ],
  caps: ["untargetable", "cannot-take-control"], conf: "medium",
  notes: "'cannot be picked by non-item cards or non-item abilities' = scoped untargetable. 'Opponents cannot take control' = takeControl skip."
});
c("94a47bcb-c174-47a9-a293-8183632b2fac", {
  shapes: [
    "activated RAISE CAPITAL: costs [payResources 1, discard 1] -> grantProvides(source, greed, 3, untilEndOfTurn)",
    "activated INVEST [G]x6: costs [payResources 2] + target {zone deck, type resource} -> moveCard hand + shuffleDeck"
  ],
  caps: ["grant-provides"], conf: "high"
});
c("337f6b9c-02ac-4c53-aaf2-e8301635cc03", {
  shapes: [
    "triggered:cardDestroyed(sourceIsEventCard) -> chooserSelectsTarget(opponent, {controller opponent, zone play, type character} count 1) -> destroy",
    "activated HARASH [V]x3: activationZone 'discard', condition isActivePlayer(controller); costs [payResources 1, destroy {face-down resource you control}] -> putIntoPlay(source, controller)"
  ],
  caps: ["active-player-condition"], conf: "high",
  notes: "'each opponent must destroy' is mandatory chooser target (not optional). HARASH from discard, only on your turn."
});
c("be86071b-9c40-443e-8675-79ac4f8657e6", {
  shapes: [
    "onPlay.targets [{loc:{owner self, zone play, type location} optional}]; onPlay.costs oneOf [[dealDamage {loc} 2],[payResources 3]]",
    "continuous aura: modifiers {selector {controller self, zone play, type location}, structure, add 1}",
    "activated PROSTRATE: costs [deplete {selected myLoc}] + targets [{myLoc:{controller self, zone play, type location}},{ch: character}] -> deplete {ch}"
  ],
  caps: [], conf: "medium",
  notes: "oneOf auto-pays first payable branch (no player choice) — a player with a location is forced into the damage branch. Acceptable approximation."
});
c("f910cad2-4579-461a-ba39-6f4c322b979d", {
  shapes: [
    "continuous.grantedAbilities [{selector {controller self, zone play, type character}, abilities:[{id 'research', type 'activated', condition inPlaySinceTurnStart(source), costs [deplete source], effects [reduceNextCost(controller,1)]}]}]"
  ],
  meta: { unique: "jo" }, caps: ["granted-activated-ability", "in-play-since-turn-start-condition"], conf: "medium", newShape: true,
  notes: "grantedAbilities only wires triggered bodies today; needs granted-activated. 'reduce the next numeric cost you pay' mapped to reduceNextCost (next card deploy)."
});
c("ecba9157-e8c2-4237-8e99-0a39f6750044", {
  shapes: ["triggered:cardRestored(sourceIsEventCard) -> grantKeyword(source, covert, untilEndOfTurn)"],
  caps: [], conf: "high"
});
c("f6da3761-a0bd-463b-9571-aba48ccf95cd", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> mayPay {costs:[payResources 2], effects:[chooserSelectsTarget(controller, {zone play, conditions:[not resource]} count 2 optional) -> forEach addCounter token 1]}",
    "continuous: condition counterCompare(source, token, >=, 1) -> str+2,life+2"
  ],
  caps: [], conf: "high", notes: "'up to 2 different non-resource cards' = count-2 optional declaration."
});
c("efc19e34-03c2-4673-a5da-9d1f19af2409", {
  shapes: [
    "continuous: str+{count {controller opponent, zone play, faceDown true}}, life same",
    "activated FOLLOW SUIT: costs [payResources 3] -> chooserSelectsTarget(opponent, {controller opponent, zone hand} count 1) -> playResource({selected}, faceDown true, player: that opponent)"
  ],
  caps: ["play-resource-as-player"], conf: "medium",
  notes: "playResource needs to resolve under the opponent, not the ability's controller."
});
c("739a2839-d98f-4ac4-8c2d-8717353f384c", {
  shapes: [
    "onPlay.targets: pick a character you control; onPlay.effects: destroy {selected}",
    "replacement: replaces {moveToZone, zone:discard, controlledBy:self} condition sourceIsEventCard -> moveCard(__candidate, deck) + shuffleDeck"
  ],
  caps: [], conf: "high", notes: "Destination-based moveToZone replacement covers 'to your discard from anywhere'."
});
c("53598621-abf6-4b9f-bc94-6c70bd77cb10", {
  shapes: ["continuous: condition numberCompare(count{controller self,type character} > count{controller opponent,type character}) -> restrictions [{target:source, cannotBePicked}]"],
  caps: ["untargetable"], conf: "medium"
});
c("e0b38a11-024e-47b7-a886-a22221328fea", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone deck, type resource, staple true} -> if(exists) moveCard hand + shuffleDeck",
    "triggered:cardDestroyed(sourceIsEventCard) -> chooserSelectsOption [decline]/[draw 1]"
  ],
  caps: [], conf: "high"
});
c("99ed6205-1f9e-4d62-a1ae-f9038449db17", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> skipRestoreRule(controller, 1)",
    "continuous: condition resourceIcons(controller,volition) >= 4 -> suppressAllAbilities {target:source}"
  ],
  caps: ["skip-restore-rule", "lose-rules-text"], conf: "medium"
});
c("78e8d502-b066-4f29-a690-dd202713bcc8", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone discard} -> if(exists) removeFromGame + draw 1",
    "activated GOOD DEAL: costs [deplete source], targets [{t1:{zone discard} c1},{t2:{zone discard, conditions:[cardTypeEquals(__candidate,{selected t1})]} c1}], costs [sacrificeSelected t1 removeFromGame, sacrificeSelected t2 removeFromGame] -> target {zone deck, conditions:[cardTypeEquals(__candidate,{selected t1})]} -> moveCard hand + shuffleDeck"
  ],
  meta: { unique: "pluck" }, caps: [], conf: "medium",
  notes: "'2 cards of the same type' modelled as two declarations chained by cardTypeEquals. UNIQUE PLUCK."
});
c("0f7da7ec-f232-4403-816e-f635a2b475c9", {
  shapes: [
    "behavior.keywords [covert]",
    "triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play, cardMovedToZone discard) -> optional pick {zone play, conditions:[not resource, not faction, not tactic]} -> removeFromGame",
    "activated KLEPT [D]x10: costs [payResources 4] + targets pick {zone play, conditions:[or char,item]} -> takeControl controller"
  ],
  caps: [], conf: "medium", notes: "threshold 'dddddddddd' (10 icons). 'character, item, or location' via selector.conditions or/not composition."
});
c("d68c6b4d-ed0c-4896-a9e2-f6c91e5c951e", {
  shapes: ["triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(exists) createModifier life+2 EOT"],
  caps: [], conf: "high"
});
c("0a7c01eb-92bd-4172-9c0d-24886de70287", {
  shapes: [
    "triggered:characterAttacked(sourceIsEventCard) -> chooserSelectsTarget(opponent, {zone hand} c1) -> moveCard discard",
    "triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction, eventCardControlledBy opponent, resourceIcons(controller,obsession)>=6) -> chooserSelectsTarget({ownerOf eventCard}, {zone hand} c1) -> moveCard discard"
  ],
  caps: [], conf: "medium",
  notes: "'inflicts battle damage' — battle damage to a faction already emits damageDealt; if a battle-only gate is needed it isn't available, note as minor."
});
c("6a78db5e-1ae4-4a93-95ed-d93fac077196", {
  shapes: [
    "behavior.keywords [tactical]",
    "triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard character) -> skipNextRestore {eventCard}",
    "card.flipUp { cost:3, threshold:'dd' }"
  ],
  caps: ["skip-next-restore"], conf: "medium",
  notes: "One-shot restore skip (setRestoreLock persists too long). FLIP UP 3 [D][D]."
});
c("7e485e5b-2d3a-4013-98d9-f7c9e47ccb57", {
  shapes: [
    "onPlay.targets [{p:{zone play, conditions:[or(cardTypeIs char, cardTypeIs location), numberCompare(resourceIcons(self,obsession) >= 3)]} count 1 optional}]",
    "onPlay.effects: if(and(targetExists p, or(statCompare {p} strength <= 3, statCompare {p} structure <= 3))) -> moveCard {p} hand"
  ],
  caps: [], conf: "medium", notes: "The [O][O][O] gate folded into the selector via a global numberCompare condition."
});
c("81f3e9be-87fd-4626-9206-c54b6d7be32e", {
  shapes: [
    "behavior.keywords [tactical]",
    "onPlay.targets [{rem:{owner opponent, zone discard} count 4 optional}]; onPlay.costs [sacrificeSelected rem removeFromGame]; onPlay.costAdjust: -{selectionCount rem}"
  ],
  caps: ["onplay-cost-adjust"], conf: "medium",
  notes: "'reduce this card's numeric cost by the number of cards removed' — needs onPlay.costAdjust."
});
c("f6404aff-0a09-46f8-b146-97f746546ff4", {
  shapes: [
    "continuous(activeZone hand): condition numberCompare(count{zone play, type location} >= 1) -> keywords [{target:source, tactical}]",
    "continuous: restrictions [{target:source, cannotBePicked, by:'locationSource'}] + immune to location abilities"
  ],
  caps: ["continuous-from-hand", "untargetable", "dynamic-tactical-honored"], conf: "low",
  notes: "'ignores all rules text on locations' — the can't-be-picked-by-locations half maps to scoped untargetable; the 'location effects don't affect this card' half is out of scope (author the tactical-in-hand + untargetable, gap the rest)."
});
c("3ab1c632-f0ab-4bc6-bbf4-85162d896459", {
  shapes: [
    "triggered:characterAttacked(sourceIsEventCard) -> scheduleEffect(endOfBattle) -> restore source",
    "static restriction attackOncePerTurn on source",
    "activated PROTECT: costs [deplete source] + targets pick character -> createModifier life+2 EOT"
  ],
  caps: ["restore-at-end-of-battle", "attack-limit-per-turn"], conf: "medium"
});
c("66e67194-792c-4d2c-b47b-f410627c1c43", {
  shapes: [
    "continuous: str+{counter token}, life+{counter token}",
    "activated PUSH OVERBOARD AND LOOT: targets [{v:{owner self, zone play, type character}}], costs [payResources 1, destroy {selected v}] -> addCounter token 1"
  ],
  caps: [], conf: "high"
});
c("db263f70-60f8-458d-bcd1-441f945f0617", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 1",
    "activated OBSCURE: costs [removeCounter token 1] + targets pick character -> grantKeyword(covert, untilEndOfTurn)"
  ],
  caps: [], conf: "high"
});
c("969e0f4d-8320-4a06-8fb0-2502da819c8e", {
  shapes: [
    "behavior.keywords [aggro]  (== 'can attack even if not in play since start of turn')",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> mayPay {costs:[payResources 2], effects:[addCounter token 1]}",
    "continuous: counterCompare(source,token,>=,1) -> str+1,life+1",
    "activated P3PP3R 61457: costs [removeCounter token 1], usesPerTurn 1 -> createModifier str+1,life+1 EOT; restore source"
  ],
  caps: [], conf: "high", notes: "AGGRO's only mechanical effect (RULES §9) is the attack-eligibility exemption, exactly this line."
});
c("39d69cc2-0af9-4e69-b31f-b7cc964353bb", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> forEach {controller self, zone play, type character, conditions:[not __candidate==source]} -> deplete + setRestoreLock true",
    "continuous: str +{count {controller self, zone play, type character, depleted true, conditions:[cardTradeIs warlord]}}"
  ],
  meta: { unique: "rudolphus" }, caps: [], conf: "high"
});
c("ef509645-3df1-44fb-955b-069fc0aebe35", {
  shapes: [
    "triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> destroy source; dealDamage {factionOf controller} 2",
    "continuous: restrictions [{target:source, cannotBlock}]",
    "continuous: condition resourceIcons(controller,rage) >= 6 -> suppressAllAbilities {target:source} + modifiers speed-1"
  ],
  caps: ["lose-rules-text"], conf: "high",
  notes: "suppressAllAbilities must exempt its own ability so the speed-1 from the same continuous still applies."
});
c("506f383f-ef35-467b-8554-dd6b4b9729df", {
  shapes: [
    "triggered:turnEnding condition eventPlayerIs(opponent) -> mayPay {costs:[removeFromGame source], effects:[ target {zone deck (any player's), uniqueDesignation:[jo,eustace,pluck,rudolphus,ignatious]} -> putIntoPlay(controller) + shuffleDeck ]}",
    "card.flipUp { cost:2, threshold:'vvvv' }"
  ],
  meta: { unique: "padamose" }, caps: ["unique-designation-selector"], conf: "medium", newShape: true,
  notes: "'choose a player and search their deck' — model as a deck target picked via a faction-card selection or 'any deck'. FLIP UP 2 [V]x4."
});
c("6b29fb62-bd69-49ef-9f20-dc8712205d4f", {
  shapes: [
    "continuous aura: modifiers {selector {uniqueDesignation:'eustace'}, str+3}, {... life+3}",
    "activated NUMISMATIC EMISSION: costs [payResources 5] -> draw 2; modifyInfluence(controller,+2)",
    "activated AURIFEROUS AUGMENTAION: costs [discard 2] -> createModifier str+2,life+2 EOT"
  ],
  meta: { unique: "siluriformes" }, caps: ["unique-designation-selector"], conf: "high"
});
c("ac14455c-c744-4c57-b53b-430450666fac", {
  shapes: [
    "continuous: restrictions [{target:source, cannotBeRestored}]",
    "static restriction attackOncePerTurn on source",
    "activated ASSIST: costs [payResources 2, deplete {selected other}], targets [{other:{controller self, zone play, type character}}] -> restore source"
  ],
  caps: ["attack-limit-per-turn"], conf: "high"
});
c("a981c172-6c40-43d4-b941-0a336e4924fb", {
  shapes: ["activated PAY OFF: usableBy anyPlayer, costs [payResources 1] -> modifyOutgoingDamage(source, -1, untilEndOfTurn)"],
  caps: ["outgoing-damage-modifier"], conf: "medium"
});
c("fd095fbd-7566-4b39-832e-0f40a0181289", {
  shapes: [
    "replacement: replaces {destroy} condition sourceIsEventCard -> flipFaceDown {__candidate}; forEachPlayer(opponents) modifyInfluence(+1); createTokens(controller, {count opponents}, Micromajig)"
  ],
  caps: [], conf: "medium", newShape: true,
  notes: "'when this is flipped down' folded into the replacement's own effects (the only way this card flips). External-flip edge (someone else flips it) left unmodelled — noted."
});
c("f83b3af9-a7cb-4945-9632-bdfab77a111a", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {controller self, zone play, uniqueDesignation:'jo'} -> if(exists) moveCard(void) + rememberTarget 'voidedJo' + forEach {controller self, zone play, type character, not source} createModifier str+1,life+1 EOT",
    "continuous aura: keywords [{selector {controller self, zone play, type character}, aggro}]",
    "triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play) -> putIntoPlay({remembered voidedJo}, controller)"
  ],
  meta: { unique: "testudine" }, caps: ["unique-designation-selector"], conf: "medium", newShape: true,
  notes: "linkedTargets clear on leaving play may race the leaves-play trigger — flag; may need remembered-target-survives-leave. AGGRO aura = the 'can attack even if not in play since start of turn' clause."
});
c("18d50b0d-08aa-4c7a-a37f-bacfd8585be0", {
  shapes: [
    "activated FOR THABBASH [V]x3: costs [payResources 2] -> createModifier str+1,life+1 EOT",
    "activated TAMESHIGIRI [V]x6: costs [payResources 2, loseInfluence 2] -> createModifier str+2,life+2 EOT"
  ],
  caps: ["lose-influence-cost"], conf: "high"
});
c("f474ddf4-9fa8-44f2-b74c-9eebe554f125", {
  shapes: [
    "continuous x4: condition resourceIcons(controller,volition) >= 1 -> life+1; >=2 -> str+1; >=3 -> speed+1; >=4 -> life+1,str+1,speed+1"
  ],
  caps: [], conf: "high", notes: "Cumulative [V] paragraphs, 4 separate continuous abilities."
});
c("1aff6726-2aff-474e-92aa-bc997202f9b2", {
  shapes: [
    "activated DELINIATE [V]x2: costs [payResources 2, deplete source]; nameValue(controller, resourceIcon, 'x'); forEach {zone play, faceDown true, type resource} -> grantProvides({__candidate}, {fromNamed x}, 1, untilEndOfTurn)"
  ],
  caps: ["grant-provides", "name-resource-icon"], conf: "medium"
});
c("3444240c-6824-4a70-83bc-2fff722afaf6", {
  shapes: ["activated BLOOD GOLD [V]x2: costs [payResources 2, loseInfluence 1] -> chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource({selected}, faceDown true)"],
  caps: ["lose-influence-cost"], conf: "high", notes: "Extra face-down resource play outside the Develop Rule."
});
c("f75a2be6-4c8f-43e2-b23f-28d1892062c0", {
  shapes: [
    "triggered:damageDealt condition and(resourceIcons(controller,volition)>=1, cardTypeIs eventCard faction, cardTypeIs {damageSource} character) -> bind x = thresholdIconCount({damageSource}); dealDamage({factionOf {controllerOf {damageSource}}}, {x})"
  ],
  caps: ["threshold-icon-count-expression", "event-damage-source-targetref", "controller-of-playerref"], conf: "medium", newShape: true,
  notes: "[V] gate on a triggered ability. 'that character's controller's faction' needs controllerOf + damageSource + thresholdIconCount."
});
c("e2b65004-fb6d-40f2-8f4c-18ee79e934fd", {
  shapes: [
    "activated CONVENE: costs [payResources 2, discard 2] -> addCounter token 2",
    "activated CAST VOTE: costs [payResources 2, removeCounter token 2] -> target {zone deck, type tactic} -> moveCard hand + shuffleDeck",
    "activated PASS: variables x = cardCost({selected t}); costs [payResources 2, discard {t:{zone hand, type tactic}}], targets [{v:{controller opponent, zone play, type character, conditions:[statCompare strength <= {x}]}}] -> moveCard {v} hand; chooserSelectsTarget({ownerOf v}, {owner <that>, type resource, attached to faction} count {x} optional) -> forEach detach"
  ],
  meta: { unique: "council" }, caps: [], conf: "medium",
  notes: "X = discarded tactic's cost via ability variables (selected 't' available from the discard cost). 'that character's controller may detach' uses existing ownerOf."
});
c("18dc6ee3-84de-4bf8-888f-f8c09a2b12e3", {
  shapes: ["triggered:<attacker becomes blocked> condition and(sourceIsEventCard, numberCompare(count{inBattle role blocker} >= 2)) -> createModifier speed-1 EOT"],
  caps: ["attacker-blocked-trigger"], conf: "medium",
  notes: "characterBlocked maps to the blocker today; need an attacker-blocked trigger/condition."
});
c("fc31573d-7f46-4e68-ab94-9ea36a3dbe90", {
  shapes: [
    "triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> bind x = eventDamageAmount; mill({ownerOf eventCard}, {x}); optional target {zone play, type item, conditions:[cardCost <= {x}]} -> destroy"
  ],
  caps: ["event-damage-amount-expression"], conf: "medium", newShape: true
});
c("0070ffff-bc96-4245-a7e8-d376941be247", {
  shapes: [
    "behavior.keywords [covert]",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> chooserSelectsTarget(opponent, {owner opponent, type resource, attached to opp faction} count 3 optional) -> forEach detach"
  ],
  caps: [], conf: "high"
});
c("3c9d8aef-10a8-4834-af0f-fb3b3e4683c8", {
  shapes: [
    "activated TO BEAR ARMS: costs [payResources 1, destroy {selected sac}], targets [{vic:character},{sac:{controller self, zone play, type character, depleted false}}] -> dealDamage {vic} 2",
    "activated JUST UNBEARABLE [R]x6: costs [payResources 2, destroy {selected sac}], targets [...] -> dealDamage {vic} 5"
  ],
  caps: [], conf: "high", notes: "'restored character' = depleted:false."
});
c("445dfe70-c2f5-4ec9-8e44-385cb5cc24ff", {
  shapes: ["continuous: str+{resourceIcons controller volition}, life+{resourceIcons controller volition}"],
  caps: [], conf: "high"
});

// ---- ITEMS ----
c("ae2a8991-a53d-4ac4-a5d8-707b812babae", {
  shapes: [
    "replacement: replaces {moveToZone, zone discard, controlledBy self} optional -> moveCard(__candidate, void) + set faceDown",
    "GAP: 'if you would draw a card as part of your Develop Rule, you may put a voided card into hand instead'",
    "activated WITHDRAW: costs [payResources 1] -> draw 1; discard 2",
    "card.flipUp { cost:1, threshold:'gg' }"
  ],
  caps: ["develop-draw-replacement"], conf: "low",
  notes: "Author the discard->void replacement + WITHDRAW + FLIP UP; the develop-draw swap is a niche capability (or parity gap)."
});
c("386bbf0c-3e4d-4db2-b476-70ce87b7e228", {
  shapes: [
    "behavior.keywords [tactical]",
    "onPlay.effects: if(not isActivePlayer(controller)) -> mayPay {costs:[payResources 1], effects:[], elseEffects:[terminate source]}",
    "activated SLIP: costs [destroy source], targets [{atk:{zone play, type character, conditions:[inBattle role attacker]}}] -> flipFaceDown {atk}; draw 1",
    "card.flipUp { cost:3, threshold:'ddd' }"
  ],
  caps: ["active-player-condition"], conf: "medium"
});
c("25ba52f8-62c9-4e2c-8daa-7e6d841f6c76", {
  shapes: [
    "triggered:cardEnteredPlay condition cardTypeIs(eventCard, character) -> chooserSelectsOption(chooser={controllerOf eventCard}) [1: chooserSelectsTarget(that player, {controller <that>, zone play, type resource} c1) -> moveCard hand] [2: destroy {eventCard}] [3: modifyInfluence({controllerOf eventCard}, -3)]"
  ],
  meta: { unique: "contiguous defalcating machine" }, caps: ["controller-of-playerref"], conf: "high"
});
c("63ad03b6-2fbb-46b0-9f86-f264cc1479fe", {
  shapes: [
    "continuous: modifiers {target attachedTo, str+2, life+2}",
    "triggered:cardPlayed condition and(not sourceIsEventCard, cardSubtypeIs eventCard 'gear') -> chooserSelectsOption [decline]/[draw 1]",
    "activated SERAPHIM FUSION: condition uniqueIs({attachedTo},[jo]); costs [payResources 3, destroy source] -> target {zone deck, name 'Testudine Autoframe'} -> putIntoPlay(controller) + shuffleDeck",
    "activated EQUIP: targets [{ch:character}], variables x=conditional(uniqueIs({ch},[jo]),0,2), costs [payResources {x}] -> attachTo(source, {ch})"
  ],
  meta: { unique: "draconic lutedoderm suit", attachTo: "character" },
  caps: ["card-subtype-condition", "unique-designation-selector"], conf: "medium"
});
c("de91eacd-1b08-4595-a238-f4654e554ab8", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 3",
    "triggered:turnStarted(controller) -> addCounter token 1",
    "triggered:counterChanged(source) condition counterCompare(source,token,>=,6) -> destroy source; forEachPlayer(opponents) modifyInfluence(-6)",
    "triggered:counterChanged(source) condition counterCompare(source,token,=,0) -> destroy source",
    "activated CONTROL THE FLAME!: usableBy anyPlayer, costs [destroy {selected}], targets [{x:{controller self, zone play, conditions:[or char,item]}}] -> chooserSelectsOption [addCounter token 1]/[removeCounter token 1]"
  ],
  caps: ["counter-threshold-trigger"], conf: "medium"
});
c("92a594d3-0560-4f4a-b872-5ed8a376967a", {
  shapes: [
    "activated RAAR!: condition not cardTypeIs(source, character), usesPerTurn 1, costs [payResources 1] -> setCardType(source, character, grantStats {strength:2,life:2,speed:3}, untilEndOfTurn)",
    "activated HIDE!: costs [payResources 1] -> if(cardTypeIs source character) removeCardType(source, character); deplete source",
    "activated INTO THE RABBIT HOLE?: costs [payResources 3] -> flipFaceDown source"
  ],
  caps: ["remove-card-type"], conf: "medium"
});
c("b36130ca-d095-4cda-98b4-e6a1de823e40", {
  shapes: [
    "GAP: 'if a player would search their deck you may pay 1 -> draw a card, then they search instead' (search interception)",
    "activated SERAPHIM FUSION: costs [payResources 4, destroy source], targets [{e:{controller self, zone play, type character, uniqueDesignation:'eustace'}}] -> target {zone deck, name 'Siluriformes Flaxenscale'} -> putIntoPlay(controller) + shuffleDeck"
  ],
  meta: { unique: "charm" }, caps: ["search-interception", "unique-designation-selector"], conf: "low",
  notes: "Author SERAPHIM FUSION; the search-interception clause is niche (2 cards) — candidate wontImplement-partial / parity note."
});
c("24e987c9-c089-4ba4-a616-ff2b2fb4592a", {
  shapes: [
    "continuous: modifiers {target attachedTo, life+2}",
    "activated COUGH UP [G]x3: costs [destroy source] -> draw 1"
  ],
  meta: { attachTo: "character" }, caps: [], conf: "high"
});
c("f3e623c0-c080-4744-9599-eb4134c83662", {
  shapes: ["triggered:turnStarted(controller) -> optional pick character -> if(exists) createModifier str+1 EOT"],
  caps: [], conf: "high"
});
c("67fe9bf8-04c3-4ea0-bbde-0ec94e33b56e", {
  shapes: [
    "activated RELEASE THE MAJIGS!: costs [deplete source] -> chooserSelectsOption(opponent) [decline]/[createTokens({player opponent},1,Micromajig) with effects:[preventDamage(__candidate, 999, reduce, EOT)]]; createTokens(controller,1,Micromajig)",
    "activated PREPARE: costs [payResources 2] -> restore source"
  ],
  caps: ["create-token-then-effect"], conf: "medium",
  notes: "'damage to that token reduced to 0 this turn' needs createTokens to expose the new token for a follow-up preventDamage."
});
c("1c7ffb60-714a-4497-ae9f-13d9980158e6", {
  shapes: [
    "continuous: restrictions [{target attachedTo, cannotAttack}]; suppressAllAbilities {target: attachedTo}",
    "activated MOVE: targets [{ch:{type character, conditions:[not inBattle]}}], costs [payResources 3] -> attachTo(source, {ch})"
  ],
  meta: { attachTo: "character" }, caps: ["lose-rules-text"], conf: "high"
});
c("f3c30c8a-69ce-443b-baed-afaed7170725", {
  shapes: [
    "continuous: modifiers {target attachedTo, str+1, life+1}",
    "triggered:cardEnteredPlay condition and(eventCardControlledBy controller, or(cardNameEquals? name 'Micromajig', cardSubtypeIs eventCard 'horsemajig')) -> chooserSelectsOption [decline]/[attachTo(source, {eventCard})]",
    "activated PWNED: costs [destroy source], targets [{host: <the card this is attached to>},{ch:character}] -> dealDamage 7 to host and ch",
    "activated MOVE: targets [{ch:{controller self, zone play, type character}}], costs [payResources 3] -> attachTo(source, {ch})"
  ],
  meta: { attachTo: "character" }, caps: ["card-subtype-condition"], conf: "medium"
});
c("ef8e7666-c491-4bdd-96e8-880193a5b01b", {
  shapes: [
    "activated CLOCK IN [V]x3: costs [discard 1 {staple resource}, payResources 2] -> draw 1",
    "activated WORK IT [V]x2: costs [payResources 2], targets [{fd:{controller self, zone play, faceDown true, type resource}}] -> moveCard {fd} hand; chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource",
    "activated CLOCK OUT [V]: effects [flipFaceDown source; detach {a resource attached to your faction}]"
  ],
  meta: { unique: "foreman pete" }, caps: [], conf: "high",
  notes: "CLOCK OUT's 'COST: Flip this card face-down' modelled as the first effect (always possible, so no distinct cost needed)."
});
c("1dd0bbbc-1202-41c2-9073-5ce87acaf67e", {
  shapes: [
    "behavior.keywords [tactical]",
    "activated NO EJECT!: costs [destroy source], targets [{mine:{owner self, type character}},{theirs:{controller opponent, type character}}] -> destroy both; if(or(inBattle {mine} attacker, inBattle {theirs} attacker)) forEach {zone play, type character, conditions:[inBattle role attacker]} destroy",
    "card.flipUp { cost:4, threshold:'ee' }"
  ],
  caps: [], conf: "medium", notes: "'that party' approximated as the current attacking party."
});
c("12b25597-1514-4fc3-9a33-3b32fc436ecb", {
  shapes: [
    "triggered:turnStarted(controller) -> mayPay {costs:[payResources 4], effects:[ if(numberCompare(count{controller self, zone play, faceDown true, type resource} >= 2)) -> chooserSelectsTarget(opponent, {controller self, zone play, faceDown true} c1) -> if(faceDown real type char|item) deployFromZone(controller, {selected}) ]}"
  ],
  caps: [], conf: "medium"
});
c("ba4a554e-4fbb-42b4-8e63-3f5f200104e5", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 2",
    "triggered:counterChanged(source) condition counterCompare(source,token,=,0) -> destroy source",
    "activated PLAN: costs [payResources 1, removeCounter token 1] -> target {zone deck, name 'Elitism'} -> moveCard hand + shuffleDeck",
    "activated FOLLOW PLAN: costs [payResources 2, removeCounter token 1] -> chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource",
    "activated NEW PLAN: costs [destroy {selected fd}], targets [{fd:{controller self, zone play, faceDown true, type resource}}] -> addCounter token 1"
  ],
  caps: ["counter-threshold-trigger"], conf: "medium"
});
c("c6e93f75-e05d-4dfb-a77d-c74b662a7c02", {
  shapes: [
    "continuous: modifiers {target attachedTo, str+2}",
    "activated UNFOLD: costs [payResources 2, deplete {attachedTo}] -> reveal top card (display); if(cardCost {deckPosition top} >= 5) forEach {controller opponent, type character} createModifier life-1 permanent; if(and(cardCost {deckPosition top} <= 4, not cardTypeIs {deckPosition top} resource)) destroy {attachedTo}; if(cardTypeIs {deckPosition top} resource) destroy {attachedTo} + forEach {controller opponent, type character} destroy"
  ],
  meta: { attachTo: "character" }, caps: [], conf: "medium"
});
c("3d8bb343-be8d-48d8-b3f2-523a3564ffeb", {
  shapes: [
    "behavior.keywords [tactical]",
    "triggered:cardEnteredPlay(sourceIsEventCard) -> if(numberCompare(random 1..2 = 1)) takeControl({attachedTo}, controller) else moveCard(source, hand)",
    "triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play) -> takeControl({attachedTo}, {ownerOf attachedTo})"
  ],
  meta: { attachTo: "item" }, caps: [], conf: "high",
  notes: "Coin flip inline via numberCompare(random). No triggered `variables` needed."
});
c("43b9dddc-f557-4efa-86f9-6ce9ca46a277", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(exists) dealDamage 2",
    "replacement: replaces {destroy} condition sourceIsEventCard, optional, optionalCost [payResources 2] -> flipFaceDown {__candidate}",
    "activated MOVE: targets [{ch:character}], costs [payResources 2] -> attachTo(source, {ch})",
    "card.flipUp { cost:2, threshold:'r' }"
  ],
  caps: [], conf: "high", notes: "Not ATTACH-on-play (attaches only via MOVE) so no attachTo metadata."
});
c("e7db74e2-02ff-4297-ac9a-860b2bd3c263", {
  shapes: [
    "activated AUGUR: costs [deplete source], variables x (player chosen), variableBounds x max 3 -> chooserSelectsTarget(opponent, {owner opponent, type resource, attached to faction} count {x} optional) -> forEach detach; target {controller self, zone deck, fromTop {x}} c1 optional -> moveCard(deck, position top); lookAndReorder(controller, {x}, to:bottom)"
  ],
  caps: [], conf: "medium", notes: "Look-at-X, keep 1 on top, bottom the rest = Rosy Palmer composition."
});

// ---- LOCATIONS ----
c("90e8b87e-3c0f-4293-9b51-feb0919c8b18", {
  shapes: ["triggered:turnStarted(controller) -> mayPay {costs:[payResources 3], effects:[chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource]}"],
  caps: [], conf: "high"
});
c("6283dc6d-d26b-4f08-9ded-17581481b6e6", {
  shapes: ["continuous aura: restrictions {selector {zone play, type character, conditions:[numberCompare(cardCost(__candidate) <= 2)]}, cannotAttack}"],
  meta: { unique: "a & d law" }, caps: [], conf: "high"
});
c("ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca", {
  shapes: [
    "activated GO TIME!: costs [deplete source] -> shuffleDeck; if(cardTypeIs {deckPosition top} character) putIntoPlay({deckPosition top}, controller, borrowed:true) + grantKeyword(that, aggro, EOT)",
    "activated AT ANY COST!: costs [payResources 2, dealDamage source 3] -> restore source"
  ],
  caps: ["borrowed-until-end-of-turn"], conf: "medium", newShape: true,
  notes: "'remove it from the game if it would leave play or is in play at end of turn' = borrowed putIntoPlay."
});
c("0146d330-33ea-4847-8d52-25810a946e40", {
  shapes: [
    "activated BUSINESS DAY: costs [payResources 1, deplete source]; nameValue(controller, resourceIcon, 'x') -> reduceThreshold(controller, {fromNamed x}, 1)",
    "activated OVERTIME [V]x5: costs [payResources 2, deplete source]; nameValue(controller, resourceIcon, 'x') -> reduceThreshold(controller, {fromNamed x}, 6)"
  ],
  meta: { unique: "skydocks" }, caps: ["reduce-threshold-requirement", "name-resource-icon"], conf: "medium"
});
c("40c10ab8-454a-4bab-98a0-d0530c983344", {
  shapes: [
    "continuous: restrictions [{target:source, cannotBePicked}]",
    "continuous aura(hand): keywords {selector {controller self, zone hand, type character}, tactical}",
    "continuous aura(hand) gated [O]x8: keywords {selector {controller self, zone hand, type item OR location}, tactical}"
  ],
  caps: ["untargetable", "aura-over-hand-zone", "dynamic-tactical-honored"], conf: "medium"
});
c("5e70e380-c62f-44a8-9b2c-abccb8f508ef", {
  shapes: [
    "triggered:turnStarted(controller) with variablePrompt {id x, max count{controller self, zone play, name 'Micromajig'}} -> targets [{m:{controller self, zone play, name 'Micromajig'} count {x}}], costs [sacrificeSelected m destroy] -> reduceNextCost(controller, {add {selectionCount m} 1})"
  ],
  caps: ["triggered-variable-prompt"], conf: "medium", newShape: true
});
c("fd3fea1f-448c-405d-96c3-e6aa6e1395ef", {
  shapes: [
    "triggered:cardEnteredPlay(sourceIsEventCard) -> chooserSelectsOption [decline]/[draw 1]",
    "triggered:cardMoved condition and(cardTypeIs eventCard character, cardMovedToZone discard) -> anyPlayerMayPay {costs:[payResources 4], effects:[moveCard({eventCard}, deck, position top)]}"
  ],
  caps: ["any-player-may-pay"], conf: "medium"
});
c("eeb9ea10-f9e7-4450-93eb-92e8efa7b074", {
  shapes: [
    "triggered:characterAttacked condition and(eventCardControlledBy controller, statCompare {eventCard} speed <= 3) -> scheduleEffect(endOfBattle) -> restore {eventCard}",
    "continuous aura: restriction attackOncePerTurn {selector {controller self, zone play, type character}}"
  ],
  caps: ["restore-at-end-of-battle", "attack-limit-per-turn"], conf: "medium"
});
c("2f4973ca-ec4c-4a2d-a9a6-6b2d67dadaab", {
  shapes: ["activated DIRTY DEALS: costs [payResources 2, dealDamage {selected loc} 1], targets [{loc:{owner self, zone play, type location}}] -> draw 1"],
  caps: [], conf: "high"
});

// ---- TACTICS ----
c("0a308026-4ef1-4c86-ad13-64df84f0f6cd", {
  shapes: [
    "tactic: targets [{ch:character}] -> chooserSelectsNumber(chooser={controllerOf ch}, storeAs x) -> chooserSelectsOption(controller) [1: modifyInfluence({controllerOf ch}, -{x})] [2: destroy {ch}; modifyInfluence(controller, -({x}+{x}))]"
  ],
  caps: ["chooser-nominates-number", "controller-of-playerref"], conf: "medium", newShape: true
});
c("353e341b-7e8a-4a9b-8b5e-caa53eaf3042", {
  shapes: [
    "tactic: target {controller self, zone deck, fromTop 8, type character, conditions:[statCompare strength <= 1]} c1 optional -> if(exists) moveCard hand; shuffleDeck",
    "card.flipUp { cost:3, threshold:'g' }"
  ],
  caps: [], conf: "high"
});
c("2f5d63f6-0f6e-4af9-9732-c15f65606f96", {
  shapes: [
    "tactic: targets [{loc:location},{ch:character}] -> dealDamage({ch}, {stat {loc} structure}); draw 1",
    "card.flipUp { cost:3, threshold:'r' }"
  ],
  caps: [], conf: "high"
});
c("ccd054c5-3295-437d-b15e-012665c83059", {
  shapes: [
    "tactic: targets [{ch:character}] -> addCounter {ch} token 1; if(counterCompare {ch} token >= cardCost {ch}) destroy {ch}",
    "activated RECUR [D]x2: activationZone discard, costs [payResources 4, removeFromGame source], targets [{ch2:character}] -> addCounter token 2; if(...) destroy"
  ],
  caps: [], conf: "high"
});
c("0a841e49-928b-4a3e-b4fa-ffdb9349bcf0", {
  shapes: ["tactic: forEach {controller self, type character} createModifier str+1,life+1 EOT; forEach {controller opponent, type character} createModifier str-1,life-1 EOT"],
  caps: [], conf: "high"
});
c("c6595d11-cbd1-4731-a244-78cc20f36d19", {
  shapes: [
    "tactic: targets [{c:{zone play, conditions:[not resource]}}] -> moveCard {c} to deck position top",
    "activated RECUR [O]x3: activationZone discard, costs [payResources 3, removeFromGame source], targets [{ch:character}] -> moveCard hand"
  ],
  caps: [], conf: "high"
});
c("25d8789e-b481-4c1d-aae5-8c3cb2d22786", {
  shapes: [
    "tactic: condition and(isActivePlayer(controller), not battleActive); targets [{mine:{controller self, type character}},{theirs:{controller opponent, type character}},{loc:location optional}]",
    "effects: bind x = conditional(cardSubtypeIs {mine} 'dragon', multiply(2, stat {mine} strength), stat {mine} strength); dealDamage {theirs} {x}; if(exists loc) dealDamage {loc} {x}  (and possibly {mine} too — 'each picked card')",
    "card.flipUp { cost:1, threshold:'rrr' }"
  ],
  caps: ["active-player-condition", "battle-active-condition", "card-subtype-condition"], conf: "medium",
  notes: "'each picked card' ambiguous — leaning theirs+loc; note if it should also hit your own picked character."
});
c("fd6b9183-805b-44d0-a3c0-dbb0758bd4b8", {
  shapes: [
    "tactic: targets [{ch:character}] -> chooserSelectsTarget({controllerOf ch}, {controller <that>, zone play, type resource} c1) -> moveCard hand; flipFaceDown {ch}"
  ],
  caps: ["controller-of-playerref"], conf: "high"
});
c("475ce92c-8128-4eff-b8bd-a22626d8de1f", {
  shapes: ["tactic: targets [{ch:{zone play, type character, conditions:[inflictedDamageToFactionThisTurn(controller)]}}] -> removeFromGame {ch}"],
  caps: ["damage-history-this-turn"], conf: "medium"
});
c("53deaf6c-15e8-4ef6-b593-85745e2e61e8", {
  shapes: ["tactic: forEach {zone play, type item} destroy; forEach {zone play, type location} destroy"],
  caps: [], conf: "high"
});
c("e0a7e6af-da4e-4442-ade8-d1b0547deb11", {
  shapes: [
    "modal-card, 3 modes:",
    "  1: EXTRA COST opponent may detach up to 3; EFFECT optional search deck {Arcanist character} -> hand + shuffle",
    "  2: EXTRA COST choose X, depleteSelected X characters you control; EFFECT detach X+3 resources from your faction",
    "  3: EXTRA COST pick a character; EFFECT grantKeyword covert EOT"
  ],
  caps: ["modal-card"], conf: "medium", newShape: true
});
c("5820f3c6-9768-4180-ba59-1afc35ea9bd7", {
  shapes: [
    "tactic: condition not battleActive; targets [{a:{controller self, type character}},{b:{type character, conditions:[not __candidate==a]}}] -> bind x = stat {a} strength; destroy {a}; dealDamage {b} {add {x} 1}",
    "card.flipUp { cost:3, threshold:'r' }"
  ],
  caps: ["battle-active-condition"], conf: "high"
});
c("2eb0069f-52fc-4ab6-a0a0-86919ba57118", {
  shapes: [
    "tactic: targets [{fd:{controller opponent, zone play, faceDown true, type resource}}] -> chooserSelectsOption [decline]/[destroy {fd}; chooserSelectsOption(opponent)[decline]/[draw 1]; chooserSelectsOption(opponent)[decline]/[playResource for opponent]]"
  ],
  caps: ["play-resource-as-player"], conf: "medium"
});
c("af563041-e0fc-43bd-a340-cda2eb36117b", {
  shapes: [
    "tactic: targets [{ch:character}] -> chooserSelectsOption(controller) [1: modifyNumericCost({ch}, -1, EOT); draw 1] [2: modifyNumericCost({ch}, +1, EOT); draw 1] [3: createModifier {ch} speed+1 EOT; draw 1]"
  ],
  caps: ["temp-numeric-cost-modifier"], conf: "medium",
  notes: "Shared EXTRA COST + target, only the effect differs -> plain chooserSelectsOption, not modal-card."
});
c("5c7b79cb-4cf1-44e4-8729-d9a096f1dd7c", {
  shapes: [
    "tactic: targets [{it:item}] -> destroy {it}; createTokens(controller,1,Micromajig)",
    "card.flipUp { cost:2, threshold:'ee' }"
  ],
  caps: [], conf: "high"
});
c("fd9a88ec-982f-439b-9aa1-8d5db83960eb", {
  shapes: [
    "tactic: targets [{it:{controller self, type item}},{ch:character}] -> moveCard {it} hand; moveCard {ch} hand",
    "card.flipUp { cost:2, threshold:'e' }"
  ],
  caps: [], conf: "high"
});
c("a5290ff5-114a-4ed7-804f-f751a1abf086", {
  shapes: [
    "tactic: targets [{ch:{controller opponent, type character, conditions:[isExtremum strength max among {controller opponent, type character}]}}] -> grantRestriction {ch} cannotBlock EOT",
    "card.flipUp { cost:2, threshold:'r' }"
  ],
  caps: [], conf: "high"
});
c("fc6ce67c-25c7-48b2-911c-fec7572c8154", {
  shapes: ["tactic: pick opponent; iterated optional payment loop (you pay 1, then they pay 1, repeat until a decline); each player draws = amount they paid"],
  caps: ["repeat-until-decline"], conf: "medium", newShape: true
});
CAPS["repeat-until-decline"] = {
  status: "unimplemented", kind: ["cost", "effect", "choice"],
  spec: "Effect { type:'alternatingPayLoop', players:[PlayerRef,PlayerRef], cost:Cost[], onEnd:Effect[] } — alternately offer each player the cost; each acceptance tallies (context.variables 'paidBy<player>'); stop at the first decline; then run onEnd (which reads the tallies). 'You may pay 1. If you do, that opponent may pay 1. Repeat until someone doesn't. Each player draws cards equal to the amount they paid.' Negotiation Ceremonies."
};
if (!cov.capabilities["repeat-until-decline"]) cov.capabilities["repeat-until-decline"] = CAPS["repeat-until-decline"];
c("5da75ce7-9ae6-484f-8bd5-ee7deeba9532", {
  shapes: ["tactic: forEachPlayer -> chooserSelectsTarget(controller[rebound], {owner <current>, zone play, type character} c1) -> moveCard hand"],
  caps: [], conf: "high"
});
c("f1b6d378-94ee-487a-bf78-b529b2131c94", {
  shapes: ["tactic: targets [{ch:character}] -> restore {ch}; grantRestriction {ch} cannotAttack EOT"],
  caps: [], conf: "high"
});
c("cb39b1ed-d160-4760-8c2d-5337b9ea74ec", {
  shapes: [
    "modal-card, 2 modes:",
    "  1: EXTRA COST deploy only during your turn; EFFECT optional search deck {subtype dragon} -> hand + shuffle",
    "  2: EXTRA COST deploy only during your turn; pick a character; EFFECT deplete it; draw 1"
  ],
  caps: ["modal-card", "active-player-condition"], conf: "medium", newShape: true
});
c("b324c5df-afe7-4ed3-8f10-7f0a7488bdfb", {
  shapes: [
    "tactic: condition battleActive; targets [{ch:{controller self, zone play, type character, conditions:[not inBattle]}}], costs [depleteSelected ch] -> addToBattle({ch}, choose); createModifier {ch} speed+1 EOT",
    "card.flipUp { cost:2, threshold:'dd' }"
  ],
  caps: ["battle-active-condition", "add-to-battle"], conf: "medium"
});
c("9107d563-b481-4bb2-8878-64589951e341", {
  shapes: [
    "tactic: pick a player; EXTRA COST clause: that player may pay 2 -> look at top card of your deck + terminate this card",
    "effects: restrictPlay(pickedPlayer, cardType:character, EOT); draw 1"
  ],
  caps: ["opponent-may-pay-to-counter", "player-play-restriction"], conf: "medium", newShape: true
});
c("d2d83970-7b96-41ba-affd-ac69466455e4", {
  shapes: [
    "modal-card, 3 modes:",
    "  1: EXTRA COST pick a player -> restrictPlay(that player, flipUp, EOT); EFFECT lookAndReorder any deck top 1 (peek)",
    "  2: EXTRA COST pick a character; EFFECT grantKeyword covert EOT; draw 1",
    "  3: EXTRA COST pick a 'gear' card + a character; EFFECT attachTo + suppressAllAbilities the gear EOT"
  ],
  caps: ["modal-card", "player-play-restriction"], conf: "medium", newShape: true
});
c("f84cac2d-0eb2-4fc8-af31-9a6754c889d6", {
  shapes: [
    "tactic: onPlay marker cannotBeRespondedTo",
    "effects: chooserSelectsTarget(opponent, {owner opponent, zone play, faceDown true / type resource, not attached} c1) -> attachTo({selected}, {factionOf opponent}); draw 1; discard 1"
  ],
  caps: ["cannot-be-responded-to"], conf: "medium"
});
c("5379e1b4-5ccc-457d-8490-82d85615143e", {
  shapes: [
    "tactic: targets [{picks:character count 3}]; EXTRA COST clause: any opponent may pay 3 -> lookAndReorder(deck, top 3) + terminate this card",
    "effects: forEach selected picks -> if(statCompare strength <= 3) destroy"
  ],
  caps: ["opponent-may-pay-to-counter"], conf: "medium"
});
c("684d1547-6f13-461a-b03a-5c1cad4cd4bb", {
  shapes: [
    "tactic: targets [{t:{zone discard, type tactic} count 3}] -> chooserSelectsTarget among selected t (targetInSelection) c1 -> moveCard deck + shuffleDeck; chooserSelectsTarget among remaining c1 -> putIntoPlay(faceDown); chooserSelectsTarget among remaining c1 -> moveCard hand"
  ],
  caps: [], conf: "medium", notes: "targetInSelection + selectionCount recipe from BEHAVIORS."
});
c("71389741-e470-4ab1-81b1-2629192813a2", {
  shapes: [
    "tactic: targets [{ch:{controller self, type character}}] -> chooserSelectsTarget(controller, {controller self, zone play, type resource} c1 optional) -> moveCard hand; flipFaceDown {ch}",
    "card.flipUp { cost:2, threshold:'v' }"
  ],
  caps: [], conf: "high"
});
c("734238ce-7a57-4fda-b9a8-86c4aef822c2", {
  shapes: ["tactic: targets [{ch:character}] -> chooserSelectsTarget({controllerOf ch}, {owner <that>, type resource, attached to faction} count 2 optional) -> forEach detach; createModifier {ch} strength-6 EOT; draw 1"],
  caps: ["controller-of-playerref"], conf: "high"
});
c("9407541a-9b2b-44cd-b1b4-e0979f192ebb", {
  shapes: [
    "tactic: variables x, variableBounds; costs [discard count {x}, payResources {conditional(x>=2, x-2, 0)}] -> draw {x}",
    "FINE PRINT: card.revealFromHand { cost:2, threshold:'gggg', effects:[loseInfluence 2] } -> draw 1"
  ],
  caps: ["reveal-from-hand-rider", "lose-influence-cost"], conf: "medium",
  notes: "Primary mode fully expressible. FINE PRINT is an alt reveal-from-hand deploy with a threshold + influence rider."
});
c("ee97a193-2abc-4f68-880f-bb128a536f28", {
  shapes: ["tactic: chooserSelectsTarget(opponent, {zone hand} count 2) -> moveCard discard; draw 1"],
  caps: [], conf: "high"
});
c("10d5c7f3-17fe-423e-95c7-b73715b61bc6", {
  shapes: [
    "tactic: condition and(isActivePlayer(controller), not battleActive); bind x = sumStat({controller opponent, zone play, type character}, strength); forEach {zone play, type character} -> dealDamage {__candidate} {add {x} -3}"
  ],
  caps: ["active-player-condition", "battle-active-condition", "sum-stat-expression"], conf: "medium"
});

// re-merge any caps added mid-file
for (const [id, cap] of Object.entries(CAPS)) {
  if (!cov.capabilities[id]) cov.capabilities[id] = cap;
}

fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
const done = cov.cards.filter(e => e.set === "Shade of the Devoured Emperor");
const st = {};
for (const e of done) st[e.status] = (st[e.status] || 0) + 1;
console.log("SotDE statuses:", JSON.stringify(st));
console.log("capabilities in registry:", Object.keys(cov.capabilities).length);
