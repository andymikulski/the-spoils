#!/usr/bin/env node
/* Merge .work/classify-p2-{1,2,3}.json into data/card-coverage.json:
 *  - flip each 1st Edition Part 2 card to its classified/vanilla entry
 *  - register every referenced engine capability in `capabilities`
 * Re-runnable. Writes JSON.stringify(_, null, 2) + "\n".
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const COV = path.join(ROOT, "data", "card-coverage.json");

const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const covById = new Map(cov.cards.map(e => [e.id, e]));

const entries = ["1", "2", "3"].flatMap(n =>
  JSON.parse(fs.readFileSync(path.join(ROOT, ".work", `classify-p2-${n}.json`), "utf8"))
);

// --- capability registry: id -> {kind, spec}. All start `unimplemented`;
//     the engine pass flips each to `implemented` as it lands. -------------
const CAPS = {
  "battle-party-size-expression": { kind: ["expression"], spec: "NumberExpression { type:'battlePartySize', side:'attacking'|'blocking'|'ownParty'|'opposingParty', of?:TargetRef } = the member count of a battle party. `ownParty`/`opposingParty` are relative to `of` (default 'source'). 0 with no battle / card not in one. Callow Liegeman, Sagacious 31f, Fleshripping Scenepuller, Top-Secret Subterranean Goofarium, Trip Wire, LeoKaiser." },
  "extremum-stat-expression": { kind: ["expression"], spec: "NumberExpression { type:'extremumStat', selector:CardSelector, stat:Stat, direction:'min'|'max' } = the highest / lowest live `stat` over every in-play card matching `selector` (0 if none). Parallel to sumStat. Martial Arts Master ('the highest speed among characters in the opposing party')." },
  "selector-is-card": { kind: ["condition"], spec: "Condition { type:'isCard', target:TargetRef } — true when the candidate (`__candidate`) is the SAME instance as `target`. Pins a damageModifiers/aura/grantedAbilities selector to one card ('the attached character', 'another item or character you control' via not). Swordchucks, Top-Secret Subterranean Goofarium, Hollow Moose, Lieutenant General, Dethmurderbludgeon." },
  "attachment-host-of-target": { kind: ["expression"], spec: "TargetRef { type:'attachmentHost', target:TargetRef } — the card `target` is attached to (generalises 'attachedTo', which only resolves for 'source'). Scorching Runicution ('Inflict X damage to the character the gear card is attached to')." },
  "name-var-selector": { kind: ["selector"], spec: "CardSelector.nameVar?: string — match CardDefinition.name against a `nameValue` (valueKind:'cardName') stored on the source card. Odious Diva ('That player puts a card with the chosen name on the bottom of their deck')." },
  "responded-ability-source": { kind: ["expression"], spec: "TargetRef { type:'respondedAbilitySource' } — the source card of the responded-to *ability* on the stack (parallel to respondedToCard for cards). Exploding Sock Puppet! ('destroy the character [whose ability it was]'), Subsection 5 ('an ability that's source was not a faction')." },
  "terminate-disposition": { kind: ["effect"], spec: "terminate effect gains disposition?: 'discard' | 'hand' (default 'discard'). 'Terminate the card, but put it into its owner's hand instead of their discard pile' (Voidal Interference)." },
  "damaged-target-this-turn": { kind: ["condition", "state"], spec: "Condition { type:'damagedThisTurn', target:TargetRef, by?:TargetRef (default 'source') } — true when `by` has inflicted damage to `target` this turn. Extends the per-card GameState.damageThisTurn record (currently { assigned, toFactionOf }) with a `byCards: CardInstanceId[]` list populated on damageDealt. Gore Engine." },
  "destroyed-by-battle-damage": { kind: ["condition", "event"], spec: "Condition { type:'destroyedByBattleDamage', target?:TargetRef (default 'source') } — true inside a cardDestroyed trigger when the lethal instance was battle damage. cardDestroyed event gains byBattleDamage?: boolean, set true when the destroy is raised from inflictLockedBattleDamage's summed assignment. Venomous Sacspider." },
  "lock-ability-this-turn": { kind: ["effect", "state"], spec: "Effect { type:'lockAbilityThisTurn', target:'respondedAbility' | TargetRef } — the referenced activated ability cannot be activated again this turn (a per-turn tally entry set to Infinity in GameState.abilityUsesThisTurn, checked next to usesPerTurn). Subsection 5, Paragraph 12 ('It cannot be used again this turn')." },
  "deploy-from-hand-paying-cost": { kind: ["effect"], spec: "deployForFree gains free?: boolean (default true; false = the player still pays the card's numeric cost) and count?: NumberExpression (up to N distinct optional picks). Late Addition ('You may deploy a character card from your hand. ... You still pay all the character's costs'), 0p3r4710n 1337 H4x0rz ('deploy up to 4 non-tactic cards for free')." },
  "conditional-damage-prevention": { kind: ["ability", "effect"], spec: "DamageModifierDefinition gains minAmount?: NumberExpression and setTo?: NumberExpression (default 0). In the same pre-inflict pass that sums `delta` (damageDeltaFor / inflictLockedBattleDamage, before SBA): after flat `delta`, if the incoming amount to a matching card is >= minAmount, clamp it to setTo. Standing, per-instance, no expiry. Class Action Defender ('When any amount of damage greater than 4 is inflicted to this card, reduce it to 0' = minAmount:5, setTo:0)." },
  "party-composition-restriction": { kind: ["ability", "battle"], spec: "ContinuousAbility.partyRestriction?: { role:'any'|'attacking'|'blocking'; minMembers?:NumberExpression; parity?:'even'|'odd' } — while the source is in play, a *forming* attacking/blocking party that includes the source must satisfy the constraint or that declareAttack/declareBlockers is rejected. Insect Appreciator ('even number of members'), Anxious Oaf ('at least 2 members')." },
  "block-eligibility-restriction": { kind: ["ability", "battle"], spec: "ContinuousAbility.blockRestriction?: { minBlockingPartySize?:NumberExpression; minBlockerSpeed?:NumberExpression; condition?:Condition } + duration'd Effect { type:'restrictBlockers', target, minPartySize?, minSpeed?, duration }. Enforced in declareBlockers against a block on the source (or its attacking party). LeoKaiser ('only parties with at least 3 members can block it'), Wild Boars ('only characters with at least X speed'). Whole-party 'cannot be blocked' stays the cannotBeBlocked keyword." },
  "restrict-blockers-to-chosen": { kind: ["effect", "battle", "choice"], spec: "Effect { type:'restrictBlockersToChosen', chooser:PlayerRef, declaration:TargetDeclaration } — on a characterAttacked trigger: `chooser` picks any number of characters they control; for the rest of this battle only those may block, and each must block if able. GameState.battle gains chosenBlockers?: CardInstanceId[]. Wyrmfang Deathskull." },
  "coin-flip": { kind: ["effect", "event", "ability-kind"], spec: "Effect { type:'flipCoin', winEffects:Effect[], loseEffects:Effect[] } — resolves a fair coin (seeded RNG), emits coinFlipped { playerId, won }, runs the matching branch. ReplacementAbility replaces:{ event:'coinFlip', result:'lose' } with optional/optionalCost lets a card offer 'if you would lose a coin flip, you may <cost> to reflip and use that result'. Fwing!, Throatstabber, Two-Headed Coin." },
  "takecontrol-duration": { kind: ["effect", "state"], spec: "takeControl effect gains duration?: Duration. A durationed grant is recorded on GameState.controlGrants [{ cardId, previousControllerId, duration, createdTurn }] and reverted (with the play-array bookkeeping mirrored) when it expires in applyFactionStartOfTurn's sweep. Mutiny Grant ('This turn, take control of the character. Restore it')." },
  "ability-cost-modifier": { kind: ["ability"], spec: "ContinuousAbility.abilityCostModifiers?: { scope:'factionAbilities'|'self'|'controlledCharacters'; delta:NumberExpression; minCost?:number } — a continuous discount/tax on the payResources portion of matching activated abilities (getCardActivatedAbilities cost math + the real payment in activateAbility). First Unified Market of Abstract Secure Theoreticals ('Reduce the numeric cost of your faction's abilities by 1, to a minimum of 1')." },
  "copy-rules-text": { kind: ["effect"], spec: "Effect { type:'grantAbilitiesFrom', target:TargetRef, from:TargetRef } — `target` permanently gains every ability in `from`'s behavior.abilities (snapshot onto GameState.abilityGrants [{ cardId, abilities, sourceId }], merged by getDefinition-adjacent ability lookups). Skin Suit ('The surviving character gains all rules text of the removed character'). Concession: the 'inflict X and Y simultaneously' / 'if only 1 would be destroyed, remove it instead' clauses are not modelled (sequential damage, no would-be-destroyed hook) — noted per-card." },
  "initiate-attack-effect": { kind: ["effect", "battle", "engine"], spec: "Effect { type:'initiateAttack', attackerSelection:string (a prior TargetDeclaration id), target:PlayerRef } — declares and resolves one battle immediately, mid-effect, bypassing the normal turn/eligibility timing (the chosen characters deplete and form the attacking party; the battle runs through the standard flow). The current effect frame's remaining effects resume after battleEnded. Counter Attack ('Attack that player. ... resolve the battle immediately and before you draw the card')." },
  "bid-auction": { kind: ["effect", "choice", "engine"], spec: "Effect { type:'auctionForCard', revealFor:PlayerRef } + a PendingChoice 'auctionBid' state machine. Reveal cards from the top of `revealFor`'s deck until a character or the deck runs out; if a character turns up, players alternately bid (active player first) up to their detached-resource count; the winner pays that many resources and puts the character into play under their control; all other revealed cards are shuffled back. Auction House." },
};

// which cards each capability id was cited on (for the registry `cards` list)
const capCards = {};
for (const e of entries) {
  for (const id of e.engineCapability ?? []) {
    (capCards[id] ??= []).push(e.id);
  }
}

let flipped = 0;
for (const e of entries) {
  const cur = covById.get(e.id);
  if (!cur) throw new Error(`coverage has no entry for ${e.id} (${e.name})`);
  cur.status = e.status;
  cur.rulesAudited = true;
  cur.behavior = e.behavior;
  cur.metadata = e.metadata;
  cur.engineCapability = e.engineCapability ?? [];
  cur.parityGaps = e.parityGaps ?? [];
  cur.confidence = e.confidence ?? null;
  cur.notes = e.notes ?? "";
  if (!cur.display) cur.display = {};
  flipped++;
}

for (const [id, meta] of Object.entries(CAPS)) {
  const existing = cov.capabilities[id];
  cov.capabilities[id] = {
    status: existing?.status ?? "unimplemented",
    kind: meta.kind,
    spec: meta.spec,
    cards: [...new Set(capCards[id] ?? existing?.cards ?? [])],
  };
}

fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`flipped ${flipped} coverage entries`);
console.log(`registered ${Object.keys(CAPS).length} capabilities`);
const unimpl = Object.entries(cov.capabilities).filter(([, c]) => c.status !== "implemented");
console.log(`capabilities not yet implemented (${unimpl.length}):`, unimpl.map(([k]) => k).join(", "));
