# 1st Edition Part 2 — classification brief (shared by all 3 slices)

You are classifying cards from **1st Edition Part 2** for the data-driven
engine coverage effort. Read this whole file, then your assigned slice file
(`.work/p2-slice-<N>.md`), then produce `.work/classify-p2-<N>.json` as
described at the bottom.

1st Edition Part 2 is an **early set** — mechanically simpler than the
Seed-era sets, but combat-heavy (lots of party / block / "when you are
attacked" text). ~85% of cards map straight onto existing vocabulary.

## What "classify" means

For each card decide **how its printed text maps onto the engine's
data-driven vocabulary** — WITHOUT writing final `behavior` JSON. You produce
a plan + a gap list per card:

- `behavior.shapes`: terse english-ish sketches, one per ability/paragraph
  (e.g. `"triggered:cardMoved(from play) + sourceIsEventCard -> opponent
  discards 1 (chooserSelectsTarget hand -> moveCard discard)"`,
  `"continuous aura: all your characters +1 life (selector {controller:self,
  type:character})"`, `"activated: deplete self, pick location -> healDamage
  2"`). Name the effect/condition/expression types you'd use.
- `metadata`: `unique` (designation slug lowercased — "UNIQUE ELDRIDGE" ->
  `"eldridge"`; "UNIQUE F.U.M.A.S.T." -> `"f.u.m.a.s.t."`), `attachTo`
  (`"character"`/`"item"` if "ATTACH TO X"), `resourceProvides` (only if a
  `PROVIDES:` line — none expected here), `keywords` (static keyword lines
  only: `covert`/`aggro`/`tactical`; **"can attack even if it has not been
  in play under your control since the start of the turn" IS the `aggro`
  keyword** — RULES.md §9, author as `behavior.keywords:["aggro"]`, not a
  capability).
- `engineCapability`: capability ids this card NEEDS that are **not already
  implemented**. Check "Already implemented vocabulary" AND "New
  capabilities this pass" below first. If existing vocab covers it (even by
  composition), `[]` and note the composition in `shapes`.
- `proposedCapabilities`: for any id in `engineCapability` NOT already in the
  two lists below, add `{ id, kind, spec, why }` (`kind` = which
  `src/types` union it extends; `spec` = one buildable paragraph;
  kebab-case id; reuse an id if two cards need the same thing). This should
  be rare — the list below is meant to be complete.
- `parityGaps`: only for a whole game-format refactor (true multiplayer,
  alternate win con, "outside the game"). "Pick X players" / "pick an
  opponent" in a 2-player engine just degenerates to the one opponent —
  NOT a parity gap.
- `confidence`: `high` / `medium` (a clause is fuzzy) / `low` (genuine rules
  ambiguity — explain in `notes`).
- `notes`: rules questions, `RULES.md` / CR cites, ambiguities, deviations,
  and any **concession** (an approximation the vocab forces). `RULES.md` is
  the distilled reference; for anything it doesn't settle read the PDFs in
  `docs/` (`Comprehensive-Rules-2.5.pdf` = CR §; `The-Spoils-Rules-FAQ-2.0.pdf`).
  The Read tool opens PDFs with `pages`.
- `status`: `classified` normally; `wontImplement` (+ `notes` reason) only if
  genuinely unmodellable in a 2-player single-game engine; `vanilla` if the
  text needs no behavior (plain keyword-only / french-vanilla stat line).
  Do NOT use `blocked` — if something needs a capability not in either list,
  propose it.
- `rulesAudited`: always `true`.

Prefer **extending the closed vocab with a small new member** over per-card
logic — but do NOT invent a capability when existing primitives compose.
Note the composition in `shapes` instead.

## Already implemented vocabulary (do NOT propose these)

**Effects:** draw, playResource (optional `player`), dealDamage,
modifyInfluence, moveCard (any zone; `position` top/bottom for deck),
destroy, deplete, restore, addCounter, removeCounter, createModifier (stat
add/set/multiply; duration permanent/untilEndOfTurn/untilStartOfNextTurn/
whileSourceInPlay), takeControl, removeFromGame, forEach (selector OR prior
`selected`), separateIntoPiles, grantVoidPlay, randomFromSelection, attachTo
(re-attach), flipFaceDown, putIntoPlay (from deck/discard/void; `faceDown`;
`borrowed`), deployFromZone (deploy a face-down/discard/deck card; `free?:
boolean | Condition`; `ignoreThreshold`), deployForFree (from hand, `maxCost`
— **numeric cost waived**, threshold + non-numeric EXTRA COSTs still apply),
grantResourceIcons, grantProvides, reduceThreshold, detach, preventDamage
(reduce/redirect shield; `wholeInstance`), scheduleEffect
(`startOfNextTurn`/`startOfOpponentNextTurn`/`endOfTurn`/`endOfBattle`,
`condition?`), useAnyAbility, useTargetAbility (`times`), grantKeyword,
grantRestriction, grantKeywordToPlayer, suppressKeyword, suppressAbilities,
transformBattleDamage (`setAmount`/`redirectToSelf`/`bounceOther`/
`bounceSelf`), restrictPlay (`cardType`/`flipUp`), modifyOutgoingDamage, if,
shuffleDeck, chooserSelectsTarget, chooserSelectsOption (EffectOption[] w/
optional `label`), chooserSelectsNumber, lookAndReorder (top N; `to`
top/bottom/split; `chooser`), reduceNextCost (`cardType?`), distributeAmong,
mill (`to` discard/removed), rememberTarget, duplicate, partitionAndPick,
retargetExtraCost, setCardType (ADDS a type for a duration; `grantStats`),
removeCardType, bind, terminate (`target`/`othersOnStack`/`respondedItem`),
setRestoreLock, setDamage, healDamage, removeFromBattle, addToBattle,
forEachPlayer, nameValue (`subtype`/`cardName`/`resourceIcon`/`trade`),
mayPay, anyPlayerMayPay, alternatingPayLoop, createTokens (inline TokenSpec;
`effects?` per token), skipRestoreRule, skipNextRestore, modifyNumericCost.

**Costs:** payResources (NumberExpression), deplete, discard, destroy,
removeCounter, depleteSelected, sacrificeSelected, removeFromGame, dealDamage
(spend own structure), loseInfluence, moveSelected (to any zone; `shuffle`),
shuffleDeck, oneOf (auto-pays first payable branch — "Pay 3 or shuffle your
deck", "discard a resource or destroy a resource you control").

**Conditions:** and/or/not, sourceInZone, isActivePlayer, battleActive,
battleRole (`attacker`/`defender` — the player's role; use for "deploy this
only while you are being attacked" = `battleRole:"defender"`), inBattle
(`target`, `role?`), sourceIsEventCard, eventCardIs, eventCardControlledBy,
eventPlayerIs, targetExists, targetInZone, targetInSelection, cardTypeIs,
cardTypeEquals, cardTradeIs, cardSubtypeIs, cardNameEquals, cardNameIs,
hasUnique, uniqueIs, hasAbility, hasKeyword, hasAttachment (`ofType?`,
`ofSubtype?`), statCompare, counterCompare, numberCompare, cardDepleted,
cardProvides, isStaple, isToken, isExtremum (`metric:"cost"|Stat`,
`direction`, `among` — "the character with the lowest cost"), textMentionsIcon,
sourceIsDamageSource, cardMovedFromZone, cardMovedToZone, eventOrdinal,
deploySameNameThisTurn, respondingTo (`cardType?`, `respondsTo:"card"|
"ability"`), respondedToPicked, deployedViaFlipUp, bottomedInMulligan,
sharesBattlePartyWithSource, linkedCardInPlay, sourceIsFaceDown,
inPlaySinceTurnStart, assignedDamageThisTurn, inflictedDamageToFactionThisTurn.

**NumberExpressions:** number, stat (live), printedStat, counter, count (of a
CardSelector), add, multiply, divide (up/down), modulo, variable (player X),
random (min/max — a coin flip is `{min:1,max:2}`), cardCost, resourceIcons,
selectionCount, sumStat (`selector`,`stat`), sumCounters, thresholdIconCount,
eventDamageAmount, conditional (if/then/else).

**TargetRef:** source, attachedTo (the card SOURCE is attached to),
eventCard, {selected id}, {card id}, {random selector}, {deckPosition
player/from/index}, respondedToCard, damageSource, {factionOf player},
{remembered key}, {respondedToPicked cardType}.

**PlayerRef:** controller, owner, activePlayer, opponent, {player id},
{ownerOf target}, {controllerOf target}.

**CardSelector:** controller/owner (self/opponent/any), zone (DEFAULT =
in-play only; may be `Zone[]` or `"any"`), type, name (exact),
uniqueDesignation (string|string[]), subtype, subtypeVar, tradeVar, depleted,
fromTop (top N of owner deck), staple, faceDown, conditions (Condition[] w/
candidate bound to `{selected id:"__candidate"}` — so put `inBattle`,
`hasKeyword`, `cardTradeIs`+`not`, `statCompare`, `sharesBattlePartyWithSource`
here for "an attacking character", "a non-Rogue character", etc.).

**Card-def siblings:** `flipUp:{cost,threshold,effects?}`, `unique`,
`attachTo`, `revealFromHand:{cost,threshold?,effects?}`,
`selfDisposition:{to:"faceDownResource"|"hand",condition?}`,
`behavior.keywords`, `behavior.onPlay:{condition?,costs?,targets?,effects?,
costAdjust?}` (non-tactic EXTRA COST / ETB — use for "EXTRA COST: pick ...;
When this card enters play, if you picked ..."), `behavior.noResponse`
("your opponents cannot respond to this card"), `behavior.modes`,
`behavior.developDrawReplacement`, `behavior.keepOnHostLeave`.

**Ability knobs:** ActivatedAbility.{activationZone, usableBy
("controller"|"anyPlayer"|"opponent"), threshold (icon gate), condition,
costs, targets, effects, variables (**evaluated BEFORE costs** — use for "X
is the number of tokens on this card" when the same activation then removes
them), variableBounds, usesPerTurn ("use this only once/N times each turn"),
fromFaceDown}. TriggeredAbility.{event, triggerZone, condition, targets,
effects}. ContinuousAbility.{activeZone, condition, modifiers, keywords,
suppressKeywords, suppressAllAbilities, restrictions, costModifiers (delta +
`minCost` — for "reduce the numeric cost of tactics you deploy by 1, to a
minimum of 1"), damageModifiers ({selector, sourceSelector?, battleOnly?,
delta}), redirects, ignoresRulesTextFrom, uniqueGrant, grantedAbilities,
grantFlipUp}. ReplacementAbility.{replaces ({event:"moveToZone",zone,
cardType?,controlledBy?,by?} | {event:"destroy",...}), condition, optional,
optionalCost, chooser, effects}.

**Events (triggered `event`):** turnStarted, turnEnding, cardPlayed,
cardEnteredPlay, cardMoved, cardDestroyed, cardDepleted, cardRestored,
resourcePlayed, cardsDrawn, cardsDiscarded, deckSearched, damageDealt,
abilityActivated, battleStarted, battleEnded, characterAttacked,
characterBlocked, attackerBlocked (carries `blockerCount`), blockingPartyFormed,
counterChanged.

## New capabilities this pass (reference these freely by id; do NOT
re-propose under a different id)

The engine team has pre-identified these gaps from a first read of the set.
If a card in your slice needs one, put its id in `engineCapability`. You do
NOT need a `proposedCapabilities` entry for these.

- **`battle-party-size-expression`** (expression) — `NumberExpression
  { type:"battlePartySize", side:"attacking"|"blocking"|"ownParty"|
  "opposingParty", of?:TargetRef }` = the member count of a battle party
  (relative to `of`, default `source`, for the `own`/`opposing` forms; also
  reads `attackerBlocked.blockerCount`). "in a party with more than 1
  member" (Callow Liegeman), "at least 2 other characters" (Sagacious 31f),
  "for each member in the opposing party" (Fleshripping Scenepuller), "X =
  the number of members in the attacking party" (Top-Secret Subterranean
  Goofarium, Trip Wire).
- **`extremum-stat-expression`** (expression) — `NumberExpression
  { type:"extremumStat", selector, stat, direction:"min"|"max" }` = the
  highest / lowest live `stat` over every in-play card matching `selector`
  (0 if none). Parallel to `sumStat`. "the highest speed among characters in
  the opposing party" (Martial Arts Master).
- **`party-composition-restriction`** (ability, battle) — a character whose
  presence in a *forming* attacking/blocking party constrains that party's
  legal composition. `ContinuousAbility.partyRestriction?: { role:"any"|
  "attacking"|"blocking"; minMembers?:NumberExpression; parity?:"even"|
  "odd" }` — enforced as a legality check in declareAttack / declareBlockers
  (the party including this card must satisfy it, or that declaration is
  rejected). "must have an even number of members" (Insect Appreciator),
  "must have at least 2 members" (Anxious Oaf).
- **`block-eligibility-restriction`** (ability, battle) — restrict WHICH
  characters may block a card / its party while a condition holds:
  `ContinuousAbility.blockRestriction?: { minBlockingPartySize?:
  NumberExpression; minBlockerSpeed?:NumberExpression; condition? }` +
  duration'd effect form `{ type:"restrictBlockers", target, minPartySize?,
  minSpeed?, duration }` for "this turn" grants. Enforced in
  declareBlockers. "only parties with at least 3 members can block it"
  (LeoKaiser), "only characters with at least X speed can block it, X =
  its speed" (Wild Boars). NOTE: whole-party "cannot be blocked" is already
  the `cannotBeBlocked` keyword — use that for Schproingmajig SCHPROING! /
  Thundering Nilpha.
- **`restrict-blockers-to-chosen`** (effect, battle) — `Effect
  { type:"restrictBlockersToChosen", chooser, declaration }` used on a
  `characterAttacked` trigger: `chooser` picks any number of characters they
  control; only those may block this battle, and each must block if able.
  Wyrmfang Deathskull. (Bundle with `block-eligibility-restriction` if
  convenient.)
- **`coin-flip`** (effect, event, ability-kind) — `Effect
  { type:"flipCoin", winEffects:Effect[], loseEffects:Effect[] }` that emits
  a `coinFlipped { playerId, won }` event, plus a `ReplacementAbility`
  hook `replaces:{event:"coinFlip", result:"lose"}` so a card can offer "if
  you would lose a coin flip, you may <cost> to reflip". Model a plain "flip
  a coin, if you win X" with `flipCoin` (or, where nothing hooks the flip,
  `random {min:1,max:2}` + `if` is fine — but Fwing! / Throatstabber should
  use `flipCoin` for consistency; Two-Headed Coin NEEDS the replacement).
- **`initiate-attack-effect`** (effect, battle, engine) — `Effect
  { type:"initiateAttack", attacker, target }` — declare and fully resolve
  one battle immediately, mid-effect, then continue. `attacker` a TargetRef
  (a character you control) or a target declaration; `target` a PlayerRef
  (their faction) or a picked location. Counter Attack ("Attack that player.
  ... resolve the battle immediately and before you draw the card").
- **`bid-auction`** (effect, choice, engine) — `Effect
  { type:"auctionForCard", reveal:{ player:"eachPlayer"|PlayerRef,
  until:"character" }, bidCurrency:"detachedResources", winnerPutsIntoPlay:
  true }` + a `PendingChoice` bid state machine (alternating bids starting
  with the active player, capped at each bidder's detached-resource count;
  the winner pays that many resources and puts the revealed character into
  play under their control; all other revealed cards shuffled back). Auction
  House.
- **`takecontrol-duration`** (effect) — `takeControl` gains
  `duration?: Duration` — control reverts to the previous controller when it
  expires (end of turn). "This turn, take control of the character. Restore
  it." (Mutiny Grant).
- **`selector-controller-of-target`** (selector) — `CardSelector.controllerOf?:
  TargetRef` — match only cards whose current controller is the controller
  of the referenced card. "if that character's controller controls at least
  X face-down resources" (Ritual of the Knob & Pull); "each character they
  control" gates where a PlayerRef isn't available.
- **`selector-is-card`** (condition) — `Condition { type:"isCard", target }`
  — true when `__candidate` is the SAME instance as `target`. Lets a
  `damageModifiers.selector` / aura pin to one card ("the attached
  character", "the picked character"). Swordchucks ("when damage is
  inflicted to the attached character, increase the amount by 2").
- **`attachment-host-of-target`** (expression) — `TargetRef
  { type:"attachmentHost", target }` — the card `target` is attached to
  (generalises `"attachedTo"`, which only works for `source`). "Inflict X
  damage to the character the gear card is attached to" (Scorching
  Runicution).
- **`name-var-selector`** (selector) — `CardSelector.nameVar?: string` —
  match `CardDefinition.name` against a `nameValue` (`valueKind:"cardName"`)
  stored on the source. "That player puts a card with the chosen name on the
  bottom of their deck" (Odious Diva).
- **`terminate-disposition`** (effect) — `terminate` gains
  `disposition?: "discard" | "hand"` (default `"discard"`). "Terminate the
  card, but put it into its owner's hand instead of their discard pile"
  (Voidal Interference).
- **`responded-ability-source`** (expression) — `TargetRef
  { type:"respondedAbilitySource" }` — the source card of the responded-to
  *ability* on the stack (parallel to `respondedToCard` for cards).
  "Terminate the ability. Destroy the character [whose ability it was]"
  (Exploding Sock Puppet!).
- **`lock-ability-this-turn`** (effect, state) — `Effect
  { type:"lockAbilityThisTurn", target:"respondedAbility"|TargetRef }` —
  the referenced activated ability cannot be activated again this turn.
  "Terminate the ability. It cannot be used again this turn" (Subsection 5,
  Paragraph 12).
- **`ability-cost-modifier`** (ability) — `ContinuousAbility.abilityCostModifiers?:
  { scope:"factionAbilities"|"self"|"controlledCharacters"; delta:
  NumberExpression; minCost?:number }` — a continuous discount/tax on the
  `payResources` portion of matching activated abilities. "Reduce the
  numeric cost of your faction's abilities by 1, to a minimum of 1"
  (F.U.M.A.S.T.).
- **`deploy-from-hand-paying-cost`** (effect) — `deployForFree` gains
  `free?: boolean` (default `true`; `false` = the player still pays the
  card's numeric cost) and `count?: NumberExpression` (up to N distinct
  picks, each optional). "You may deploy a character card from your hand.
  ... You still pay all the character's costs" (Late Addition); "deploy up
  to 4 non-tactic cards for free" (0p3r4710n 1337 H4x0rz).
- **`damaged-target-this-turn`** (condition, state) — `Condition
  { type:"damagedThisTurn", target, by?:TargetRef (default "source") }` —
  true when `by` has inflicted damage to `target` this turn (extends the
  `damageThisTurn` record already kept for `assignedDamageThisTurn`). "when
  a character is destroyed during a turn when this card damaged it" (Gore
  Engine).
- **`copy-rules-text`** (effect) — `Effect { type:"grantAbilitiesFrom",
  target, from }` — `target` gains, permanently, every ability in `from`'s
  `behavior.abilities` (snapshot; `from` is typically a card being removed
  from the game in the same effect). "The surviving character gains all
  rules text of the removed character" (Skin Suit). If Skin Suit's
  simultaneous-damage / "if only 1 would be destroyed, remove it instead"
  clause can't be modelled cleanly, note it as a concession and classify
  the card `classified` for the rest.

## Recurring 1st Edition Part 2 patterns (compose from existing vocab —
classify these the same way every time)

- **"Look at an opponent's hand and choose a card in it. That player
  discards that card."** — `chooserSelectsTarget { chooser:"controller",
  declaration:{ selector:{ owner:"opponent", zone:"hand" }, count:1 } }` ->
  `moveCard eventCard->discard` (bind to the declaration id). "Look at" is
  implicit (you're the chooser). Quotidian Virtuoso, The Deranger, Eldridge
  Gosche DISRUPT, Violating Anomaly, Odious Diva (+ nameVar filter).
- **"This card enters play with N tokens on it."** — `triggered
  cardEnteredPlay + sourceIsEventCard -> addCounter(source, "token", N)`.
- **"This card loses 1 strength and 1 life for each token on it."** —
  `continuous` self `modifiers` [{stat:"strength",op:"add",value:{multiply:
  [{counter source token}, -1]}}, same for life]. Proven shape (Seed 2
  INVEST cycle) — `reusesProvenShape:true`.
- **"INVEST — COST: Pay 2. EFFECT: Remove a token from this card."** —
  plain `activated` costs [payResources 2] effects [removeCounter source
  token 1]. "Pay X, where X is the number of tokens on this card" =
  ability `variables:{x:{counter source token}}` (before costs) + cost
  payResources {variable x}.
- **"When this card leaves play, ..."** — `triggered event:"cardMoved",
  condition and(sourceIsEventCard, cardMovedFromZone "play")`.
- **"When this card is destroyed, ..."** — `triggered event:"cardDestroyed"
  + sourceIsEventCard`.
- **"When you are attacked, you may ..."** — `triggered event:"battleStarted",
  condition { type:"battleRole", role:"defender" }` -> `mayPay` or
  `chooserSelectsOption` for the "you may". Class Action Defender,
  Omnidirectional Patrolmajig, Top-Secret Subterranean Goofarium.
- **"When an attacking party is formed including this card, ..."** —
  `triggered event:"characterAttacked", condition sourceIsEventCard` (fires
  per attacker at declareAttack; use `battlePartySize` for size gates).
  Sagacious 31f, Callow Liegeman, Lieutenant General.
- **"HANDOFF — COST: Pay N. Deplete a character you control that is not in
  a battle. EFFECT: Attach this card to the character."** — `activated`
  costs [payResources N, deplete {selected id}] targets [{ selector:{
  controller:"self", type:"character", conditions:[{not:{inBattle
  __candidate}}] }, count:1 }] effects [attachTo source -> that pick]. The
  gear's `attachTo:"character"` sibling handles the initial play.
- **"All your characters gain 1 X." / "All other <subtype> characters gain
  ..."** — `continuous` `modifiers` with `selector` (aura), no `target`.
  Not a one-shot.
- **"EXTRA COST: Pick a character you control. X is its strength. Destroy
  it. ... X ..."** — tactic first-ability (or `behavior.onPlay`) `targets`
  + `bind x = {stat target strength}` FIRST, then `destroy`, then use
  `{variable x}`. `bind` is what survives the destroy.
- **"EXTRA COST: Deploy this only during your turn / an opponent's turn /
  not during a battle / while you are being attacked."** —
  `isActivePlayer` / `not isActivePlayer` / `not battleActive` /
  `battleRole:"defender"` conditions on the tactic's first ability /
  `behavior.onPlay.condition`.
- **"That player takes control of this card."** (Inside Information, The
  Deranger, Epiphany Ball, Misappropriation Machine, Splattergun) —
  `takeControl { target:"source", controller:{ controllerOf/ownerOf ... } }`
  or `"opponent"`. Permanent (no duration) unless the text says "this turn".
- **"When this card inflicts damage to a faction, ..."** — `triggered
  event:"damageDealt", condition and(sourceIsDamageSource, { cardTypeIs
  target:"eventCard", cardType:"faction" })`.
- **"cannot be blocked" (whole card, this turn or static)** — the
  `cannotBeBlocked` keyword (static: `behavior.keywords`; "this turn":
  `grantKeyword`; conditional: `ContinuousAbility.keywords` +
  `condition`). In 2-player, "cannot be blocked by that player [who
  controls an item]" collapses to `cannotBeBlocked` gated on `numberCompare(
  count{opp items}, ">=", 1)` — note the collapse.
- **"enters play under an opponent's control"** (Hollow Moose) — `triggered
  cardEnteredPlay + sourceIsEventCard -> takeControl source -> "opponent"`.
  Note the one-frame flicker as a concession.

## Output

`.work/classify-p2-<N>.json` — a JSON array, one object per card in your
slice, EXACTLY this shape:

```json
[
  {
    "id": "<card id>",
    "name": "<card name>",
    "status": "classified",
    "rulesAudited": true,
    "behavior": { "needed": true, "shapes": ["...", "..."],
      "reusesProvenShape": true, "newTestNeeded": false },
    "metadata": { "unique": null, "attachTo": null,
      "resourceProvides": null, "keywords": [] },
    "engineCapability": [],
    "proposedCapabilities": [],
    "parityGaps": [],
    "confidence": "high",
    "notes": ""
  }
]
```

`reusesProvenShape: false` (=> also `newTestNeeded: true`) ONLY when the
card needs a brand-new ability SHAPE that warrants its own
`card-behaviors.test.ts` case (a genuinely novel composition, not just a new
capability used in a conventional way).

For a `vanilla` card use `"status":"vanilla"`, `"behavior":{"needed":false,
"shapes":[],"reusesProvenShape":null,"newTestNeeded":false}`.

Be precise and terse — this is a planning artifact. Report at the end: card
count, any card you could not classify confidently (+ why), and any
capability you proposed that wasn't on the list above.
