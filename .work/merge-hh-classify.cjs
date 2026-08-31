#!/usr/bin/env node
/* Merge .work/classify-hh-{1,2,3}.json into data/card-coverage.json:
 *  - flip each of the 132 Holy Heist cards to its classified entry
 *  - register every referenced engine capability in `capabilities`
 * Re-runnable. Writes JSON.stringify(_, null, 2) + "\n".
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const COV = path.join(ROOT, "data", "card-coverage.json");

const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const covById = new Map(cov.cards.map(e => [e.id, e]));

const slices = ["1", "2", "3"].map(n =>
  JSON.parse(fs.readFileSync(path.join(ROOT, ".work", `classify-hh-${n}.json`), "utf8"))
);
const entries = slices.flat();

// --- capability registry: every id the classification referenced, all now
//     implemented (directly, or noted as a composition). kind + spec + the
//     card ids that use it are filled from the slice data below. -----------
const CAPS = {
  "heal-damage": { kind: ["effect"], spec: "Effect { type:'healDamage', target, amount } removes up to `amount` damage markers (floor 0). 'Remove 2 damage markers from the card' (Asbestos Drywall). Distinct from the absolute `setDamage`." },
  "duration-until-next-turn": { kind: ["ids"], spec: "Duration { type:'untilStartOfNextTurn' } — survives the opponent's intervening turn, swept at the start of the source controller's next turn (createdTurn <= turn-2). Unstable Modification's per-turn modal choice." },
  "grant-keyword-to-player": { kind: ["effect", "state"], spec: "Effect { type:'grantKeywordToPlayer', player, keyword, duration } — every character `player` controls (now and deployed later while live) has `keyword`. Consulted by hasKeyword; swept like keywordGrants. Hasty Pursuit / Change of Tactics grant `aggro`." },
  "has-keyword-condition": { kind: ["condition"], spec: "Condition { type:'hasKeyword', target?, keyword } — true when an in-play `target` (default source) currently has `keyword` (printed/granted/aura). Torchlight Sarcophyle, Predatory Lamp, I See You!." },
  "schedule-opponent-turn": { kind: ["effect", "state"], spec: "scheduleEffect.when gains 'startOfOpponentNextTurn' — fires at the start of the turn immediately after it was scheduled (the scheduler's opponent's turn). Final Countdown." },
  "cards-discarded-event": { kind: ["event"], spec: "GameEvent cardsDiscarded { playerId, count } — a hand->discard move, emitted once per card (count always 1); a '+X for each discarded' trigger applies per event and sums. Bewilderbeast." },
  "text-mentions-icon": { kind: ["condition"], spec: "Condition { type:'textMentionsIcon', target?, icon } — true when `target`'s printed `text` contains that resource icon's bracket token ([V] etc.). Marduun Ruins aura selector." },
  "usable-by-opponent": { kind: ["ability"], spec: "ActivatedAbility.usableBy gains 'opponent' — only the opponent may activate (hidden from the controller, resolved under the opponent). iDumb De-Itemizer RESET." },
  "must-be-picked": { kind: ["ids", "state"], spec: "Restriction 'mustBePicked' — inverse of cannotBePicked: whenever a target declaration's legal candidate pool contains one or more mustBePicked cards it collapses to just those (forces which card, not whether to pick for a fully-optional declaration). Ferret Oil Coating." },
  "persistent-attachment": { kind: ["cards", "state"], spec: "CardDefinition.behavior.keepOnHostLeave — an 'Attach to X' card whose host leaves play stays in play unattached instead of going to the discard pile (state-based check). Everlasting Blade of Light." },
  "prevent-next-damage-instance": { kind: ["effect", "state"], spec: "preventDamage.wholeInstance — a `mode:'reduce'` shield that absorbs the entire next damage instance regardless of size, then is spent. Visible Loaf ('reduce it to 0')." },
  "suppress-abilities-effect": { kind: ["effect", "state"], spec: "Effect { type:'suppressAbilities', target, duration } — the duration'd counterpart of ContinuousAbility.suppressAllAbilities; every ability on `target` goes inert until the grant expires. iDumb De-Itemizer RESET ('this turn, this card loses all rules text')." },
  "has-attachment-subtype": { kind: ["condition"], spec: "hasAttachment condition gains `ofSubtype?: string` — also require an attached card to list that subtype in its printed subtype array (composes with `ofType`). Damascus Sword Swinger, Rudo Mangod ('a gear card attached')." },
  "is-token-condition": { kind: ["condition"], spec: "Condition { type:'isToken', target? } — true when `target` (default source) resolves to a token permanent. Compose with `not` for 'non-token character' (Phantasmagoric Tollbooth)." },
  "event-card-is-target": { kind: ["condition"], spec: "Condition { type:'eventCardIs', target } — true when getEventCardId(event) equals `target` (the general form of sourceIsEventCard). Scopes an attachment's battle/leave-play trigger to its host via target:'attachedTo'. Infectious Pustulio." },
  "target-in-zone-condition": { kind: ["condition"], spec: "Condition { type:'targetInZone', target, zone } — true when `target` resolves to a card currently in `zone` (general form of sourceInZone). 'If it is destroyed by that damage' = `if` gated by not(targetInZone play) after the dealDamage + SBA. Suicide Smash." },
  "battle-target-condition": { kind: ["condition"], spec: "Condition { type:'battleTargetIs', controlledBy?, cardType? } — true while a battle is in progress (not finished) whose target is a card matching the filters. 'a location you control is being attacked' (Gargoyle of Cathedrale de Mau)." },
  "battle-damage-not-yet-assigned": { kind: ["condition"], spec: "Condition { type:'battleDamageAssigned', operator, value } — compares BattleState.assignedDamageBy.length to `value`. 'before any damage is assigned during this battle' = operator '=' value 0 (Change of Tactics). False with no battle." },
  "responded-to-picked-target": { kind: ["expression"], spec: "TargetRef { type:'respondedToPicked', cardType } — resolves to the in-play card of `cardType` the responded-to stack item picked as an extra cost (read side of the respondedToPicked condition). Catastrophic Caper." },
  "sum-counters-expression": { kind: ["expression"], spec: "NumberExpression { type:'sumCounters', selector, counter } — total of `counter` markers across every in-play card matching `selector` (parallel to sumStat). Bounds a chosen X to available tokens. Voidal Humour Redistribution." },
  "suppress-keyword-effect": { kind: ["effect", "state"], spec: "Effect { type:'suppressKeyword', target, keyword, duration } — removes `keyword` from `target` for the duration (lose beats grant; the duration'd mirror of ContinuousAbility.suppressKeywords). I See You! ('this turn, the character loses COVERT')." },
  "distinct-names-target": { kind: ["expression", "choice"], spec: "TargetDeclaration.distinctNames — every selection must have a distinct printed name. Enforced in playCard/activateAbility, selectTargets and chooserSelectsTarget. Cheats ('4 cards with different names'), Profane Proposal ('5 cards with different names')." },
  "separate-into-piles": { kind: ["choice", "effect"], spec: "Effect { type:'separateIntoPiles', splitter, selected, pile1, pile2 } + a `pileAssignment` pending choice — `splitter` partitions an existing `selected` set into two piles (either may be empty), then `pile1` effects run per card in the first pile and `pile2` per card in the second (card bound to __candidate). Profane Proposal ('separates into two piles; one pile to your hand, shuffle the other into your deck')." },
  "random-from-selection": { kind: ["effect", "choice"], spec: "Effect { type:'randomFromSelection', selected, count, effects } — resolve `effects` for `count` uniformly-random members of an existing `selected` set (seeded RNG). 'randomly put 2 of those [4 revealed] cards into their discard pile' (Cheats)." },
  "deploy-from-void-permission": { kind: ["cards", "state", "engine"], spec: "Effect { type:'grantVoidPlay', selected, player, ignoreThreshold? } + GameState.voidPlayGrants — a persistent per-card grant letting `player` deploy a voided card as though from hand (optionally ignoring threshold). playCard/deployCard honour it; the grant is pruned when the card leaves the void. Cheats." },
  "name-trade": { kind: ["choice", "selector"], spec: "nameValue.valueKind gains 'trade' + CardSelector.tradeVar (string | string[]) matching a card's printed trade against one/more stored named values (case-insensitive). Gathering of Unlikely Heroes ('names 2 non-Universal trades')." },
  "restrict-ability-activation": { kind: ["ids", "state"], spec: "Restriction 'cannotUseAbilities' — no player may activate an activated ability whose source has it (triggered/continuous/replacement unaffected). Granted as a continuous aura. 0v3rw0rk3d 31f ('Abilities on locations cannot be used')." },
  "keyword-block-any-party": { kind: ["ids", "battle"], spec: "Keyword 'canBlockAnyParty' — like canBlockCovert (may block a COVERT party) AND exempts the character from 'a COVERT character may block only a COVERT party', so a self-Covert character can still block a non-Covert attack. Guardbeast of Thabbash." },
  "blocking-party-formed-event": { kind: ["event"], spec: "GameEvent blockingPartyFormed { playerId, blockerCount } — one event for the whole party at declareBlockers (playerId = defender), before the per-blocker events. Microdefense Autosystem." },
  "look-reorder-partial-bottom": { kind: ["effect", "choice"], spec: "lookAndReorder.to gains 'split' — the chooser sends any number of the looked-at cards to the deck bottom and keeps the rest on top, each pile in a chosen order (reorderDeck choice gains a `bottom` array). Ignatius Gloamspike, Confessions of Countless Souls." },
  "move-selected-cost": { kind: ["cost"], spec: "Cost { type:'moveSelected', id, player, selector, count, to, position?, shuffle? } — paid like `discard` but moving the chosen card(s) to any zone (hand, or deck with reshuffle). Uhluhtc Niudla (PREVAIL UPON / AVAIL ANEW)." },
  "replacement-affected-chooses": { kind: ["ability", "choice"], spec: "ReplacementAbility.chooser?: PlayerRef resolved relative to the affected card's controller — that player makes the optional choice and pays optionalCost; effects resolve under whoever answered. Unloyal Necromorph ('any opponent may pay 2 -> takes control'). (Phantasmagoric Tollbooth's enters-play form is modelled as a cardEnteredPlay trigger + mayPay — a documented concession: the ETB fires before the possible bounce.)" },
  "battle-damage-assignment-replacement": { kind: ["ability", "battle", "effect"], spec: "Effect { type:'transformBattleDamage', target, role:'dealer'|'receiver', kind:'setAmount'|'redirectToSelf'|'bounceOther'|'bounceSelf', amount?, duration } + GameState.battleDamageTransforms, applied to locked assignments in inflictLockedBattleDamage. Don't Trip (redirectToSelf), Ocular Dispersal (setAmount = host cardCost), Vexing Nullifier (bounceOther + bounceSelf)." },
  "attach-tactic-resolves-into-play": { kind: ["cards", "engine"], spec: "applyTacticDisposition: a resolving tactic whose CardDefinition.attachTo is set (and with no selfDisposition) enters play attached to the host picked as its reserved `attachTo` extra-cost target, instead of going to the discard pile; its triggered/continuous abilities are then live. Falls through to discard if no legal host survived. Infectious Pustulio, Ocular Dispersal, Unstable Modification, Will of a Living God." },
  "damage-reduction-optional-cost": { kind: ["ability", "effect"], spec: "Composed from a `damageDealt` trigger + `mayPay` (player = controller, cost = loseInfluence) + `healDamage` on the eventCard. 'When damage is inflicted to a location/expensive character you control, you may reduce the amount by 1; if you do, your faction loses 1 influence' (Cathedrale de Mau). CONCESSION: modelled as a post-damage heal, so it cannot rescue a card from a lethal hit." },
  "exile-if-leaves-play-this-turn": { kind: ["effect", "state"], spec: "Composed from putIntoPlay.borrowed (leave-play -> removed) + a scheduleEffect(endOfBattle) removeFromGame on the source. 'If that card or this card would leave play this turn, remove both from the game instead' (Spurious Anthropologist). CONCESSION: borrowed also exiles at end of turn, and the linkage is one-directional (the pulled character is borrowed; Spurious self-exiles at end of battle)." },
  "deploy-from-deck": { kind: ["effect"], spec: "deployFromZone already accepts a `deck`-zone target (typically one just found by a search) — it deploys for free (numeric cost waived; threshold + non-numeric extra costs still apply) as a nested consequence; author a `shuffleDeck` alongside for the search reshuffle. Unexpected Transformation." }
};

// attach the referencing card ids
const capCards = {};
for (const e of entries) {
  for (const id of e.engineCapability || []) {
    (capCards[id] = capCards[id] || []).push(e.id);
  }
}

let unknown = [];
for (const id of Object.keys(capCards)) {
  if (!CAPS[id]) unknown.push(id);
}
if (unknown.length) {
  console.error("Unregistered capability ids referenced by the classification:", unknown);
  process.exit(2);
}

for (const [id, meta] of Object.entries(CAPS)) {
  cov.capabilities[id] = {
    status: "implemented",
    kind: meta.kind,
    spec: meta.spec,
    cards: capCards[id] || []
  };
}

// --- merge the per-card classification ---------------------------------
let merged = 0;
for (const e of entries) {
  const ce = covById.get(e.id);
  if (!ce) throw new Error(`classify-hh: unknown card id ${e.id} (${e.name})`);
  ce.status = e.status;
  ce.rulesAudited = e.rulesAudited !== false;
  ce.confidence = e.confidence ?? ce.confidence ?? "medium";
  ce.notes = e.notes ?? "";
  ce.engineCapability = e.engineCapability || [];
  ce.parityGaps = e.parityGaps || [];
  ce.behavior = {
    needed: e.behavior?.needed !== false,
    shapes: e.behavior?.shapes || [],
    reusesProvenShape: e.behavior?.reusesProvenShape ?? true,
    newTestNeeded: e.behavior?.newTestNeeded ?? false
  };
  if (e.metadata) {
    ce.metadata = {
      unique: e.metadata.unique ?? null,
      attachTo: e.metadata.attachTo ?? null,
      resourceProvides: e.metadata.resourceProvides ?? null,
      keywords: e.metadata.keywords ?? []
    };
  }
  merged++;
}

fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`merged ${merged} classified HH cards; registered ${Object.keys(CAPS).length} capabilities as implemented`);
