# Open Beta — classification brief (shared by all 4 slices)

You are classifying cards from **Open Beta** for the data-driven engine
coverage effort. Read this whole file, then your assigned slice file
(`.work/ob-slice-<N>.md`), then produce `.work/classify-ob-<N>.json` as
described at the bottom.

Open Beta is the **oldest** set — mechanically the simplest in the catalog,
but full of quirky one-offs and combat/hand-attack text. ~85% of cards map
straight onto existing vocabulary. Six large sets are already fully
implemented (Seed 2/3, SotDE, 1st Edition Part 2, Holy Heist, Ungodly Mess),
exercising ~190 capabilities — you should almost always be reusing that
vocabulary.

## What "classify" means

For each card decide **how its printed text maps onto the engine's
data-driven vocabulary** — WITHOUT writing final `behavior` JSON. You produce
a plan + a gap list per card:

- `behavior.shapes`: terse english-ish sketches, one per ability/paragraph
  (e.g. `"triggered:cardEnteredPlay + sourceIsEventCard -> optional pick
  character -> deplete it"`, `"continuous aura: all your lawyer characters
  +1/+1 (selector {controller:self,type:character,tradeVar? no -> subtype})"`,
  `"activated: deplete self -> search deck {type:tactic} -> moveCard hand +
  shuffleDeck"`). Name the effect/condition/expression types you'd use.
- `metadata`: `unique` (designation slug lowercased — "UNIQUE PLUCK" ->
  `"pluck"`, "UNIQUE ASHES OF ZENOBIA" -> `"ashes of zenobia"`), `attachTo`
  (`"character"`/`"item"` if "ATTACH TO X"), `resourceProvides` (only if a
  `PROVIDES:` line — none expected here), `keywords` (static keyword lines
  only: `covert`/`aggro`/`tactical`; **"can attack even if it has not been
  in play under your control since the start of the turn" IS the `aggro`
  keyword** — RULES.md §9, author as `keywords:["aggro"]`, not a capability;
  **"cannot be blocked" as a permanent printed line IS the `cannotBeBlocked`
  keyword**).
- `engineCapability`: capability ids this card NEEDS that are **not already
  implemented**. Check "Already implemented vocabulary" AND "New capabilities
  this pass" below first. If existing vocab covers it (even by composition),
  `[]` and note the composition in `shapes`.
- `proposedCapabilities`: for any id in `engineCapability` NOT already in the
  two lists below, add `{ id, kind, spec, why }` (`kind` = which `src/types`
  union it extends; `spec` = one buildable paragraph; kebab-case id; reuse
  an id if two cards need the same thing). This should be **rare** — the
  list below is meant to be complete for this set.
- `parityGaps`: only for a whole game-format refactor (true multiplayer,
  alternate win con, "outside the game", seat/side swap). "Pick an opponent"
  in a 2-player engine just degenerates to the one opponent — NOT a parity
  gap.
- `confidence`: `high` / `medium` (a clause is fuzzy) / `low` (genuine rules
  ambiguity — explain in `notes`).
- `notes`: rules questions, `RULES.md` / CR cites, ambiguities, deviations,
  and any **concession** (an approximation the vocab forces). `RULES.md` is
  the distilled reference; for anything it doesn't settle read the PDFs in
  `docs/` (`Comprehensive-Rules-2.5.pdf` = CR §; `The-Spoils-Rules-FAQ-2.0.pdf`).
  The Read tool opens PDFs with `pages`.
- `status`: `classified` normally; `wontImplement` (+ `notes` reason) only if
  genuinely unmodellable in a 2-player single-game engine (alternate
  win/lose conditions, "outside the game", multiplayer politics); `vanilla`
  if the text needs no behavior (plain keyword-only / french-vanilla stat
  line). Do NOT use `blocked` — if something needs a capability not in
  either list, propose it in `proposedCapabilities` and keep `classified`.
- `rulesAudited`: always `true`.

Prefer **extending the closed vocab with a small new member** over per-card
logic — but do NOT invent a capability when existing primitives compose.
Note the composition in `shapes` instead.

## Already implemented vocabulary (do NOT propose these)

**Effects:** draw (`amount` NumberExpression, `player`), playResource
(optional `player`), dealDamage, modifyInfluence, moveCard (any zone;
`position` top/bottom for deck), destroy, deplete, restore, addCounter,
removeCounter, createModifier (stat add/set/multiply; duration
permanent/untilEndOfTurn/untilStartOfNextTurn/whileSourceInPlay),
takeControl (`duration?`), removeFromGame, forEach (selector OR prior
`selected`), forEachPlayer, separateIntoPiles, grantVoidPlay,
randomFromSelection, attachTo (re-attach), flipFaceDown, putIntoPlay (from
deck/discard/void; `faceDown`; `borrowed`), deployFromZone (deploy a
face-down/discard/deck card; `free?: boolean | Condition`; `ignoreThreshold`),
deployForFree (from hand; `maxCost`; `free?: boolean` — `false` = still pay
numeric cost; `count?` — up to N distinct picks), grantResourceIcons,
grantProvides, reduceThreshold, detach, preventDamage (reduce/redirect
shield; `wholeInstance`), preventAllDamage (this-turn window),
restrictDestruction (this-turn window), scheduleEffect
(`startOfNextTurn`/`startOfOpponentNextTurn`/`endOfTurn`/`endOfBattle`,
`condition?`), useAnyAbility, useTargetAbility (`times`), grantKeyword,
grantRestriction (incl. `mustAttack`/`mustBlock`/`cannotAttack`/
`cannotBlock`/`attackOncePerTurn`/`cannotBePicked`/`mustBePicked`/
`cannotUseAbilities`/`cannotBeRestored`/`cannotBeTakenControl`),
grantKeywordToPlayer, suppressKeyword, suppressAbilities, transformBattleDamage,
restrictPlay (`cardType`/`flipUp`/`response`), modifyOutgoingDamage,
modifyNumericCost, if, shuffleDeck, chooserSelectsTarget, chooserSelectsOption
(EffectOption[] w/ optional `label`), chooserSelectsNumber (`chooser`,
`storeAs`, `min`/`max`), lookAndReorder (top N; `to` top/bottom/split;
`chooser`), reduceNextCost (`cardType?`), distributeAmong, mill (`to`
discard/removed), rememberTarget, duplicate, partitionAndPick,
retargetExtraCost, setCardType (ADDS a type for a duration; `grantStats`),
removeCardType, bind (capture a NumberExpression into a variable), terminate
(`target`/`othersOnStack`/`respondedItem`; `disposition` discard/hand),
setRestoreLock, skipRestoreRule, skipNextRestore, setDamage, healDamage,
removeFromBattle, addToBattle, nameValue (`subtype`/`cardName`/
`resourceIcon`/`trade`), mayPay (you-may-pay-then; charges the resolved
`player`), anyPlayerMayPay, alternatingPayLoop, createTokens (inline
TokenSpec; `effects?` per token), auctionForCard, flipCoin (`winEffects`/
`loseEffects`; emits `coinFlipped`), initiateAttack, grantAbilitiesFrom
(copy rules text), lockAbilityThisTurn.

**Costs:** payResources (NumberExpression), deplete, discard, destroy,
removeCounter, depleteSelected, sacrificeSelected, removeFromGame, dealDamage
(spend own structure), loseInfluence, moveSelected (to any zone; `shuffle`),
shuffleDeck, oneOf (auto-pays the first payable branch — "Pay 3 or destroy a
resource you control").

**Conditions:** and/or/not, sourceInZone, isActivePlayer, battleActive,
battleRole (`attacker`/`defender` — the player's role; "deploy this only
while you are being attacked" = `battleRole:"defender"`, "while you are
attacking" = `battleRole:"attacker"`), inBattle (`target`, `role?`),
sourceIsEventCard, eventCardIs, eventCardControlledBy, eventPlayerIs,
targetExists, targetInZone, targetInSelection, cardTypeIs, cardTypeEquals,
cardTradeIs, cardSubtypeIs, cardNameEquals, cardNameIs, hasUnique, uniqueIs,
hasAbility, hasKeyword, hasAttachment (`ofType?`, `ofSubtype?`), statCompare,
counterCompare, numberCompare, cardDepleted, cardProvides, isStaple, isToken,
isExtremum (`metric:"cost"|Stat`, `direction`, `among` — "the character with
the highest numeric cost"), textMentionsIcon, sourceIsDamageSource,
cardMovedFromZone, cardMovedToZone, eventOrdinal, deploySameNameThisTurn,
respondingTo (`cardType?`, `respondsTo:"card"|"ability"`), respondedToPicked,
deployedViaFlipUp, bottomedInMulligan, sharesBattlePartyWithSource,
linkedCardInPlay, sourceIsFaceDown, inPlaySinceTurnStart,
assignedDamageThisTurn, inflictedDamageToFactionThisTurn, damagedThisTurn
(`target`, `by?` default source — "a character that has received damage this
turn" = `damagedThisTurn {target, by:<any>}`? NO — `by` defaults to source;
for "received damage this turn from anyone" see New capabilities).

**NumberExpressions:** number, stat (live), printedStat, counter, count (of a
CardSelector), add, multiply, divide (up/down), modulo, variable (player X;
`variableBounds`), random (min/max — a coin flip is `{min:1,max:2}`),
cardCost (printed numeric cost), resourceIcons (how many [X] a player
controls — also the "control at least [X][X]" idiom via numberCompare),
selectionCount, sumStat (`selector`,`stat`), sumCounters, thresholdIconCount,
extremumStat (`selector`,`stat`,`direction`), battlePartySize
(`side:"attacking"|"blocking"|"ownParty"|"opposingParty"`, `of?`),
eventDamageAmount, distinctCount (`selector`,`by:"name"|"trade"|"subtype"|
"type"`), conditional (if/then/else).

**TargetRef:** source, attachedTo (the card SOURCE is attached to),
attachmentHost (`target` — the card ANOTHER card is attached to), eventCard,
{selected id}, {card id}, {random selector}, {deckPosition player/from/index},
respondedToCard, respondedAbilitySource, damageSource, {factionOf player},
{remembered key}, {respondedToPicked cardType}.

**PlayerRef:** controller, owner, activePlayer, opponent, {player id},
{ownerOf target}, {controllerOf target}.

**CardSelector:** controller/owner (self/opponent/any), zone (DEFAULT =
in-play only; may be `Zone[]` or `"any"`), type, name (exact),
uniqueDesignation (string|string[]), subtype, subtypeVar, nameVar, tradeVar,
depleted, fromTop (top N of owner deck), staple, faceDown, attachedToFaction,
conditions (Condition[] w/ candidate bound to `{selected id:"__candidate"}` —
so put `inBattle`, `hasKeyword`, `cardTradeIs`+`not`, `statCompare`,
`isExtremum`, `sharesBattlePartyWithSource` here for "an attacking
character", "a non-Rogue character", "the highest-cost character", etc.).

**Card-def siblings:** `flipUp:{cost,threshold,effects?}`, `unique`,
`attachTo`, `revealFromHand:{cost,threshold?,effects?}`,
`selfDisposition:{to:"faceDownResource"|"hand",condition?}`,
`behavior.keywords`, `behavior.onPlay:{condition?,costs?,targets?,effects?,
costAdjust?}` (non-tactic EXTRA COST / ETB — "EXTRA COST: pick ...; When this
card enters play, if you picked ..."), `behavior.noResponse` ("your
opponents cannot respond to this card"), `behavior.modes` (modal card —
"choose one of the following as this card's rules text"),
`behavior.developDrawReplacement`, `behavior.keepOnHostLeave`,
`thresholdSlack:{condition,amount}`.

**Ability knobs:** ActivatedAbility.{activationZone ("play"|"hand"|"discard"|
"void"), usableBy ("controller"|"anyPlayer"|"opponent"), threshold (icon
gate), condition, costs, targets, effects, variables (**evaluated BEFORE
costs** — use for "X is the number of tokens on this card" when the same
activation removes them), variableBounds, usesPerTurn ("use this only
once/N times each turn"), fromFaceDown}. TriggeredAbility.{event,
triggerZone, condition, targets, effects}. ContinuousAbility.{activeZone,
condition, modifiers, keywords, suppressKeywords, suppressAllAbilities,
restrictions, costModifiers (delta + `minCost`), damageModifiers ({selector,
sourceSelector?, battleOnly?, delta, minAmount?, setTo?}), abilityCostModifiers,
redirects, ignoresRulesTextFrom, uniqueGrant, grantedAbilities (triggered +
activated + continuous bodies all wired), partyRestriction ({role, minMembers?,
parity?}), blockRestriction ({minBlockingPartySize?, minBlockerSpeed?,
blockerMustNotMatch?, condition?}), playRestrictions, voidPlay,
restrictReturnToHand, grantFlipUp}. ReplacementAbility.{replaces
({event:"moveToZone",zone,cardType?,controlledBy?,by?} | {event:"destroy",
...} | {event:"coinFlip",result:"lose"}), condition, optional, optionalCost,
chooser, effects}.

**Events (triggered `event`):** turnStarted, turnEnding, cardPlayed,
cardEnteredPlay, cardMoved, cardDestroyed, cardDepleted, cardRestored,
resourcePlayed, cardsDrawn (carries `count`), cardsDiscarded, deckSearched,
damageDealt, abilityActivated, battleStarted, battleEnded, characterAttacked,
characterBlocked, attackerBlocked (carries `blockerCount`),
blockingPartyFormed, counterChanged, coinFlipped.

## New capabilities this pass (reference these freely by id; do NOT
re-propose under a different id)

The engine team has pre-identified these gaps from a first read of Open
Beta. If a card in your slice needs one, put its id in `engineCapability`.
You do NOT need a `proposedCapabilities` entry for these.

- **`put-into-hand-replacement`** (ability-kind, engine) — today a
  `moveToZone` replacement only fires when the card is leaving **play**
  (`from === "play"`). Extend it so `replaces:{event:"moveToZone",
  zone:"hand"}` fires whenever a card would ENTER a hand from ANY zone
  (deck/discard/void/play), with `controlledBy?`/`by?` scoping. "This turn,
  if a card would be put into a player's hand, put it into their discard
  pile instead" (Quotidian Misfire — a duration'd grant via a
  `scheduleEffect`-style this-turn replacement window, or classify the
  this-turn replacement as its own effect if cleaner).
- **`draw-count-modifier`** (ability, effect, state) — a continuous /
  duration'd modifier that changes the NUMBER of cards a `player` draws
  from any draw (`delta:NumberExpression`, floored at 0). Consulted in the
  draw resolution. "When you draw any number of cards, increase the amount
  by 1" (Beatrix Winterbottom); "increase the amount by X" (Gold Summit is
  influence not draw — see below). Continuous form on an in-play card +
  one-shot `Effect { type:"modifyDrawCount", player, delta, duration }`.
- **`cannot-draw-restriction`** (ability, state) — a player-scoped
  conditional "this player cannot draw cards" (draw resolves to 0). Model
  as `ContinuousAbility` with a new player-scoped restriction, or
  `Restriction "cannotDraw"` applied to the faction. "While you have at
  least 10 cards in your hand, you cannot draw cards" (Beatrix — condition
  `numberCompare(count{owner:self,zone:hand}, ">=", 10)`).
- **`event-draw-amount-expression`** (expression) — `NumberExpression
  { type:"eventDrawAmount" }` = the `count` of the current `cardsDrawn`
  event (0 outside one). Parallel to `eventDamageAmount`. "your faction
  gains X influence, where X is the number of cards drawn" (Gold Summit).
- **`influence-change-modifier`** (ability, effect, state) — a continuous /
  duration'd modifier on influence CHANGES to a faction:
  `ContinuousAbility.influenceModifiers?: { player:"self"|"opponent"|"any";
  direction:"loss"|"gain"|"any"; delta:NumberExpression; minAmount?:number }`
  applied wherever `modifyInfluence` / influence-loss-from-damage commits.
  "When your faction loses influence, reduce the amount by 1" (Tax
  Attorney). Distinct from the `loseInfluence` cost and `modifyInfluence`
  effect.
- **`cannot-lose-at-zero-influence`** (cards, state) — a flag (continuous /
  card-level) that suppresses the standard "faction at 0 influence loses
  the game" state-based check for that faction while the source is in play.
  "You do not lose the game because your faction has 0 influence" (Armored
  Keep — `TACTICAL` `UNIQUE`). NOT `wontImplement`: it suppresses an
  existing loss check, it doesn't add a new win/lose condition.
- **`play-restriction-by-name`** (effect, state) — extend `restrictPlay` /
  `playRestrictions` with `kind:{ named:string }` reading a stored
  `nameValue` (`valueKind:"cardName"`) — "the named card cannot be
  deployed" for a `duration` (Incriminating Photograph — `duration` is
  effectively permanent / "for the rest of the game": use
  `whileSourceInPlay`).
- **`attack-tax`** (ability, battle, state) — `ContinuousAbility.attackTax?:
  { player:"opponent"|"any"; amount:NumberExpression }` — while the source
  is in play, the named player must pay `amount` resources to declare an
  attack (a cost checked/charged in `declareAttack`; if unpayable the
  attack is illegal). "Each opponent must pay 2 to attack" (The Ministry of
  Other Smaller Ministries).
- **`grant-subtype`** (effect, state) — `Effect { type:"grantSubtype",
  target, subtype:string, duration:Duration }` + `GameState.subtypeGrants`,
  consulted by every subtype selector/condition (`cardSubtypeIs`,
  `subtype` selector, `distinctCount by:"subtype"`). "It gains the
  sarcophyle subtype" (Sarcophyle Matriculation, Vander Malagut).
- **`take-control-instead-of-destroy`** (composition, note only) — "If the
  character would be destroyed [this battle / this turn], take control of
  it instead" is `replacement-effect` (`replaces:{event:"destroy"}`) with
  `effects:[takeControl, healDamage/setDamage 0, grantSubtype]`; the
  battle-scoped form uses `condition:{battleActive}` + a
  `scheduleEffect:endOfBattle` to end the replacement, the turn-scoped
  continuous form (Vander Malagut) uses `condition:{damagedThisTurn
  {target:__candidate, by:source}}`. Put `grant-subtype` in
  `engineCapability`; the rest composes.
- **`last-deployed-tactic-ref`** (expression, state) — `TargetRef
  { type:"lastDeployedTactic", thisTurn:true }` = the most recently
  RESOLVED tactic card this turn (tracked in a small per-turn
  `GameState.lastDeployedTacticId`). "Duplicate the last tactic deployed
  this turn" (Voidal Replication).
- **`repeat-effect-until-condition`** (effect, choice) — `Effect
  { type:"repeatUntil", condition:Condition, maxIterations:number,
  effects:Effect[] }` — run `effects` repeatedly until `condition` is true
  (or the cap). "Repeat this card's effect until that player has no cards
  in their hand" (Degenerate Molestation). Guard with a hard cap.
- **`spend-counters-menu`** (effect, choice, state) — `Effect
  { type:"spendCountersMenu", source:TargetRef, counter:string,
  options:Array<{ cost:number; label?:string; effects:Effect[] }> }` — the
  player repeatedly removes `cost` tokens from `source` to fire an option's
  `effects`, any number of times, in any mix, until they stop or can't
  pay. "Remove any number of tokens ... 1 TOKEN: inflict 1 damage /
  2 TOKENS: draw a card / 3 TOKENS: search deck" (Voidal Poisoning).
- **`deployed-type-this-turn-condition`** (condition, state) — `Condition
  { type:"deployedTypeThisTurn", player:PlayerRef, cardType?:CardType,
  subtype?:string }` — true when `player` deployed at least one matching
  card this turn (extend the existing per-turn deploy tally used by
  `deploySameNameThisTurn`). "only if an opponent deployed a character this
  turn" (Slingerang CHEAP SHOT, Jacque's Trap).
- **`activate-opponents-abilities`** (ability, state) — `ContinuousAbility.
  grantsUseOfOpponentAbilities?: boolean` — while the source is in play,
  the controller may activate activated abilities on cards their OPPONENT
  controls, paying the numeric cost with their own resources and resolving
  the effect as if the opponent used it (non-numeric costs paid as though
  the opponent is paying). "You may use abilities on your opponent's
  cards..." (The Billionaire). If this proves too invasive to build in
  this pass, classify The Billionaire `classified` with the CHANGE COSTUME
  ability authored and this clause noted as a concession — flag it in
  `notes` and still list the id.

## Parity gaps (use these ids; card stays `classified`, lists the gap id)

- **`seat-swap`** — "each player moves 1 seat to the left. Each player is in
  control of that opponent's side. If the game ends, the owner of the
  winning deck wins the game." (Emergency Obfuscation). A full
  seat/side/deck-ownership swap — different game-state model. In 2-player
  this is "swap control of everything including hands/decks", still a large
  refactor. Author the token-accrual + self-destruct clauses; list
  `seat-swap` in `parityGaps`.

## Recurring Open Beta patterns (compose from existing vocab — classify the
same way every time)

- **"When this card enters play, your faction loses N influence."** —
  `triggered:cardEnteredPlay + sourceIsEventCard -> modifyInfluence
  {player:"controller", amount:-N}`. Vanilla-ish downside on a beefy body.
- **"When this card enters play, draw a card." / "search your deck for
  <X>, reveal it, put it into your hand."** — `triggered:cardEnteredPlay`
  -> `draw` / `chooserSelectsTarget {zone:"deck", ...}` -> `moveCard hand`
  + `shuffleDeck`. "reveal" is cosmetic.
- **"This card enters play with N tokens on it."** — `triggered:
  cardEnteredPlay + sourceIsEventCard -> addCounter(source,"token",N)`.
- **"This card gains 1 strength and 1 life for each token on it."** —
  `continuous` self `modifiers` [{stat:"strength",op:"add",value:{counter
  source token}}, same for life]. Proven shape — `reusesProvenShape:true`.
- **"This card loses 1 strength and 1 life for each token on it."** — same
  with `value:{multiply:[{counter source token}, -1]}`.
- **HANDOFF / TELEPORT / etc. activated abilities on items/characters** —
  plain `activated` with `costs` + `targets` + `effects`. "Deplete a
  character you control that is not in a battle" = cost `deplete {selected
  id}` + target `{selector:{controller:"self",type:"character",conditions:
  [{not:{inBattle:{...__candidate}}}]}}`.
- **"ATTACH TO CHARACTER — The attached character gains X strength and Y
  life."** — `attachTo:"character"` sibling + a `continuous` with `target:
  "attachedTo"` (or selector `isCard {attachedTo}`) `modifiers`.
- **"Reduce the next numeric cost you pay this turn by N."** (RESEARCH /
  DEVELOPMENT cycle) — `reduceNextCost {amount:N}`.
- **"Search your deck for a <type> and reveal it. Put it into your hand."**
  — `chooserSelectsTarget {chooser:"controller", declaration:{selector:
  {owner:"self",zone:"deck",type:<t>}, count:1, optional:true}}` ->
  `moveCard eventCard->hand` + `shuffleDeck`.
- **"Put the top N cards of an opponent's deck into their discard pile."**
  — `mill {player:"opponent", count:N}`.
- **"Look at an opponent's hand and choose a card in it. That player
  discards that card."** — `chooserSelectsTarget {chooser:"controller",
  declaration:{selector:{owner:"opponent",zone:"hand"},count:1}}` ->
  `moveCard ->discard`. "Look at" is implicit.
- **"An opponent discards a card."** — `chooserSelectsTarget
  {chooser:"opponent" (or {ownerOf/controllerOf}), declaration:{selector:
  {owner:"opponent",zone:"hand"},count:1}}` -> `moveCard ->discard`.
  "discards a card at random" -> `randomFromSelection` over the hand.
- **"When this card blocks / is blocked, it gains N strength and N life
  this turn."** — `triggered:characterBlocked + sourceIsEventCard ->
  createModifier str/life +N untilEndOfTurn`.
- **"Flip a coin. If you win, X is A. Otherwise, X is B."** — `flipCoin
  {winEffects:[bind x=A, ...], loseEffects:[bind x=B, ...]}` (or nest the
  X-dependent effects in each branch).
- **"When a coin is flipped, you may put a token on this card."** —
  `triggered:coinFlipped -> chooserSelectsOption [decline]/[addCounter
  token 1]`.
- **"When an attacking/blocking party is formed [including this card], it
  must have <even / only 1 / at least N> members."** —
  `ContinuousAbility.partyRestriction {role, minMembers?/parity?}` (cap
  `party-composition-restriction`, already implemented). For a location
  that constrains ALL parties (Arcana Department, Hangdog Alley) use
  `partyRestriction` with no self-membership requirement — note it in
  `shapes`; if the engine's partyRestriction requires the source to be a
  party member, flag a `party-composition-restriction` extension in
  `proposedCapabilities` (`role` gains an "unconditional" scope).
- **"You do not lose the game because your faction has 0 influence."** —
  `cannot-lose-at-zero-influence` (new).
- **"Take control of the picked character."** (permanent unless "this
  turn") — `takeControl {target:{selected id}, controller:"controller"}`;
  "this turn" -> add `duration:{type:"endOfTurn"}` (cap
  `takecontrol-duration`).
- **"This turn, cards ... can only be destroyed by costs, and all inflicted
  damage is reduced to 0."** (Limited Liability) — `restrictDestruction` +
  `preventAllDamage`, both already implemented.
- **Micromajig tokens** — `createTokens` inline TokenSpec (name
  "Micromajig", cardType "character", subtype ["majig"] (per printed
  reminder text — check the exact subtype word), strength 1, life 1, speed
  3). "Put X Micromajig tokens into play" -> `createTokens {count:{...}}`.
- **"can attack only once each turn"** — `grantRestriction
  "attackOncePerTurn"` (static via `ContinuousAbility.restrictions` or
  `behavior`), cap `attack-limit-per-turn` (implemented).
- **"must block if it can" / "must attack if it can"** —
  `grantRestriction "mustBlock"` / `"mustAttack"` (cap `combat-restrictions`,
  implemented).
- **"Destroy the character an opponent controls with the highest numeric
  cost. Tie -> you decide."** — target `{selector:{controller:"opponent",
  type:"character",conditions:[{isExtremum ... metric:"cost" direction:
  "max" among:{...}}]}, count:1}` -> `destroy`.

## Output

`.work/classify-ob-<N>.json` — a JSON array, one object per card in your
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

If you proposed any capability NOT in this brief, also write
`.work/caps-ob-<N>.json`: `[{ "id","kind":["effect"],"spec":"...","why":
"card names + what breaks without it" }]`.

Report at the end: card count, any card you could not classify confidently
(+ why), and any capability you proposed that wasn't in this brief.
Be precise and terse — this is a planning artifact, not prose.
