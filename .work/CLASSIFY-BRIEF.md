# SotDE classification brief (shared by all 4 slices)

You are classifying cards from **Shade of the Devoured Emperor** for the
data-driven engine coverage effort. Read this whole file, then your assigned
slice file, then produce the output described at the bottom.

## What "classify" means

For each card, decide **how its printed text maps onto the engine's
data-driven ability vocabulary** — WITHOUT writing the final `behavior` JSON.
You are producing a plan + a gap list. Specifically:

- `behavior.shapes`: terse english-ish sketches of the ability shapes needed
  (e.g. `"triggered:cardEnteredPlay -> optional pick character -> deplete it"`,
  `"continuous aura: characters you control +1/+1 while depleted"`,
  `"activated: deplete self, pay 2 -> draw"`). One per ability/paragraph.
- `metadata`: `unique` (designation slug lowercased, e.g. `"pluck"` for
  "UNIQUE PLUCK"), `attachTo` (`"character"`/`"item"` if "ATTACH TO X"),
  `resourceProvides` (only for resource cards — none here), `keywords`
  (static keyword lines only: `covert`/`aggro`/`tactical`).
- `engineCapability`: list of capability ids this card NEEDS that are **not
  already implemented**. Check the "Already implemented vocabulary" list
  below AND `COVERAGE.md`'s capability table (all currently `implemented`)
  before adding one. If today's vocab covers it, this is `[]`.
- `proposedCapabilities`: for any id you put in `engineCapability` that is
  NOT already in `COVERAGE.md`, add an entry here: `{ id, kind, spec, why }`.
  `kind` = which `src/types` union(s) it extends (`effect`/`condition`/
  `cost`/`expression`/`ability`/`choice`/`state`/`ids`). `spec` = one
  paragraph a implementer can build from. Keep ids kebab-case.
- `parityGaps`: only if the card needs a whole game-format refactor
  (multiplayer, alternate win con, "outside the game"). Rare here.
- `confidence`: `high` (clean mapping), `medium` (a clause is fuzzy),
  `low` (genuine rules ambiguity — explain in `notes`).
- `notes`: rules questions, RULES.md cites, ambiguities. Cite RULES.md
  sections where a ruling matters. RULES.md is a distilled reference — for
  anything it doesn't settle, consult the real rules PDFs in `docs/`
  (`Comprehensive-Rules-2.5.pdf` = CR §NNN; `The-Spoils-Rules-FAQ-2.0.pdf`
  = FAQ; the Read tool opens PDFs via its `pages` param) and cite CR §/FAQ.
- `status`: `classified` normally; `blocked` if it needs an unbuilt
  capability; `wontImplement` (with a `notes` reason) if genuinely
  unmodellable in a 2-player single-game engine; `vanilla` if you conclude
  the text needs no behavior at all.
- `rulesAudited`: always `true` (you read the text against RULES.md).

Prefer **extending the closed vocab with a small new member** over
per-card logic. But do NOT invent a capability when an existing primitive
composes to the same result — note the composition in `shapes` instead.

## Already implemented vocabulary (do NOT propose these)

**Effects:** draw, playResource, dealDamage, modifyInfluence, moveCard
(to any zone, `position` top/bottom for deck), destroy, deplete, restore,
addCounter, removeCounter, createModifier (stat add/set/multiply, duration
permanent/untilEndOfTurn/whileSourceInPlay), takeControl, removeFromGame,
forEach (selector or prior selection), attachTo (re-attach), flipFaceDown,
putIntoPlay (from deck/discard/void, faceDown option), deployFromZone
(deploy a face-down/discard card for free, ignoreThreshold option),
grantResourceIcons (phantom icons to a PLAYER's threshold count, duration),
detach, preventDamage (reduce/redirect shield, amount), scheduleEffect
(startOfNextTurn/endOfTurn, condition), useAnyAbility, grantKeyword,
grantRestriction, if, shuffleDeck, lookAndReorder (top N, to top/bottom),
reduceNextCost (next card deploy this turn, optional cardType filter),
deployForFree (from hand, maxCost), distributeAmong, mill (to discard/
removed), rememberTarget, duplicate, partitionAndPick, retargetExtraCost,
setCardType (ADDS a type for a duration, optional grantStats), bind
(capture a NumberExpression into a variable), terminate (target/
othersOnStack/respondedItem), setRestoreLock, setDamage, removeFromBattle,
forEachPlayer, nameValue (kind subtype|cardName), mayPay (you-may-pay-then),
createTokens (inline TokenSpec), useTargetAbility (times), chooserSelectsTarget,
chooserSelectsOption (EffectOption[] with optional label), lookAndReorder.

**Costs:** payResources (NumberExpression amount), deplete, discard,
destroy, removeCounter, depleteSelected, sacrificeSelected, removeFromGame,
dealDamage (spend own structure), oneOf (auto-pays first payable branch).

**Conditions:** and/or/not, sourceInZone, sourceIsEventCard,
eventCardControlledBy, targetExists, cardTypeIs, cardTradeIs, hasUnique,
hasAbility, statCompare, counterCompare, numberCompare, inBattle,
sourceIsDamageSource, cardMovedFromZone, cardMovedToZone, battleRole,
eventPlayerIs, targetInSelection, eventOrdinal, deploySameNameThisTurn,
respondingTo (cardType, respondsTo card|ability), respondedToPicked,
deployedViaFlipUp, cardNameEquals, bottomedInMulligan, cardProvides
(icons on a card incl. temp grants), isStaple, cardDepleted, cardTypeEquals,
sharesBattlePartyWithSource, linkedCardInPlay, sourceIsFaceDown, isExtremum.

**NumberExpressions:** number, stat (live), counter, count (of a
CardSelector), add, multiply, variable (player-chosen X), random (min/max),
cardCost (printed numeric cost), printedStat (printed base stat),
resourceIcons (how many [X] a player controls — also the "control at least
[X][X]" idiom via numberCompare), divide (up/down), modulo, selectionCount,
conditional (if/then/else).

**TargetRef:** source, attachedTo, eventCard, {selected id}, {card id},
{random selector}, {deckPosition player/from/index}, {respondedToCard},
{factionOf player}, {remembered key}.

**PlayerRef:** controller, owner, activePlayer, opponent, {player id},
{ownerOf target}.

**CardSelector fields:** controller/owner (self/opponent/any), zone (DEFAULT
= in-play only; set explicitly for hand/deck/discard/void), type, name
(exact), subtype, subtypeVar, depleted, fromTop (top N of deck), staple,
faceDown (true = match face-down in-play by real type), conditions
(Condition[] with candidate bound to `{selected id:"__candidate"}`).

**Card-def siblings:** `flipUp:{cost,threshold,effects?}`, `unique`,
`attachTo`, `revealFromHand:{cost}`, `selfDisposition:{to,condition?}`,
`behavior.onPlay:{condition?,costs?,targets?,effects?}` (non-tactic EXTRA
COST / ETB), `behavior.keywords`.

**Ability knobs:** ActivatedAbility.{activationZone, usableBy anyPlayer,
threshold (icon gate), condition, costs, targets, effects, variables,
variableBounds, usesPerTurn, fromFaceDown}. TriggeredAbility.{event,
triggerZone, condition, targets, effects}. ContinuousAbility.{condition,
modifiers, keywords, suppressKeywords, restrictions, costModifiers,
damageModifiers, uniqueGrant, grantedAbilities (triggered bodies fire;
**activated/continuous/replacement granted bodies are NOT wired** — flag
`granted-activated-ability` etc. if needed), grantFlipUp}.
ReplacementAbility.{replaces (moveToZone{zone}/destroy, cardType,
controlledBy, by self|opponent|any), condition, optional, optionalCost,
effects}. **"damage would be inflicted" is NOT a replaceable event today.**

**Events:** turnStarted, turnEnding, cardPlayed, cardEnteredPlay, cardMoved,
cardDestroyed, cardDepleted, cardRestored, resourcePlayed, cardsDrawn,
damageDealt, abilityActivated, battleStarted, battleEnded, characterAttacked,
characterBlocked.

## SotDE mechanics already spotted (align to these — don't re-propose under new ids)

These recur across the set. Proposed capability ids to use consistently:

- **`grant-provides`** — "This turn, this card gains PROVIDES: [O][O][O]"
  (Anxious Imp, Discordant Cadencer, Elitistmajig, Goldmau Sacks Rep,
  Thabbashite Chemist "each face-down resource gains PROVIDES X"). A runtime
  card-level PROVIDES grant read by getResourceIcons/getThresholds/
  cardProvides, cleaned up like modifiers. (`grantResourceIcons` is
  PLAYER-level and can't be scoped to a card that may leave play or to
  "each face-down resource".) kind: effect,state.
- **`reduce-threshold-requirement`** — "reduce the threshold requirement of
  the next card you deploy by 1 of the named [icon]" (Clockman Skydocks).
  Parallel to reduceNextCost but for threshold icons. kind: effect,state.
- **`untargetable`** — "cannot be picked" / "cannot be picked by non-item
  cards or abilities" / "cannot be picked by locations" / conditional
  "while you control more characters than any opponent, cannot be picked"
  (Gloamspike-Gosche Bridge, Gigantitect's Giant Giant, Martial Arts
  Wannabe, Parkour Hoodlum). A Restriction + continuous form that removes a
  card from selector candidate pools, with an optional "by" scope
  (source card type / source ability). kind: ids,state.
- **`lose-rules-text`** — "This card loses all other rules text" ([V][V][V][V]
  on Monstrous Lassitude, Rushing Crushing Blockhead; Guileful Astucion
  option), "the attached character ... has no rules text" (Mittens). A
  continuous ability that suppresses all OTHER abilities on target/selector.
  kind: ability.
- **`granted-activated-ability`** — grant an *activated* ability body to a
  selector's cards (Jo Ciendeilio "each character you control gains
  'RESEARCH — ...'"). grantedAbilities only wires triggered today.
  kind: ability.
- **`attack-limit-per-turn`** — "This card can attack only once each turn" /
  "characters you control can attack only once each turn" (Pinguid
  Bodyguard, Skullcrush Steamroller, Torchlight District). A per-card
  per-turn attack counter + declareAttack gate; continuous/aura form.
  kind: ids,battle,state.
- **`add-to-battle`** — "add it to your attacking or blocking party"
  (Carnival Ringmaster ETB, Sneaker Attack!). Inverse of removeFromBattle.
  kind: effect,battle.
- **`player-play-restriction`** — "that player cannot play characters this
  turn" / "cannot play cards using FLIP UP this turn" / "opponents cannot
  respond to this card" (Study Disturbance, Surreptitious Larceny option,
  Swindle). A per-turn per-player deploy/response restriction.
  kind: effect,state.
- **`modal-card`** — "Choose one of the following as this card's rules
  text/effect: OPTION 1 / 2 / 3", where the chosen option carries its own
  EXTRA COST + targets + effect (Expedition Endeavour, Shriever Breeding
  Program, Surreptitious Larceny, Guileful Astucion, Contiguous Defalcating
  Machine's forced-choice-on-ETB is close but `chooserSelectsOption`
  covers that one). Needs the mode chosen BEFORE play-time costs/targets
  resolve. kind: cards,engine,choice.
- **`chooser-nominates-number`** — "That character's controller chooses a
  number for X" (Audacious Appraisal); an opponent (not the acting player)
  sets a `variable`. kind: choice,expression.
- **`remove-card-type`** — Frickin' Sweet Pogo-Bunny "it loses the
  'character' type"; `setCardType` only ADDS. A remove/clear-added-type
  effect. kind: effect,state.
- **`event-amount-expression`** — NumberExpression for "the amount of damage
  inflicted by this character" inside a damageDealt trigger (Totally Random
  Kid, Neuralyzer-ish). kind: expression.
- **`threshold-icon-count-expression`** — "X is the number of threshold
  icons of the character" (Thabbashite Warmonger). Printed threshold length
  of a card. kind: expression.
- **`repeat-until-decline`** — "Repeat this cost until you or that player
  does not pay" + "each player draws cards equal to the amount they paid"
  (Negotiation Ceremonies, Unexpected Codicil-ish). An iterated optional
  payment loop that tallies per player. kind: cost,effect,choice.
- **`name-resource-icon`** — `nameValue` extended to `valueKind:
  "resourceIcon"` (Thabbashite Chemist, Clockman Skydocks, Clockman City
  Shuffle names, Micromajig Recycling names? check). kind: choice.
- **`controller-of-event-card` PlayerRef** — `{ type: "controllerOf",
  target }` (Contiguous Defalcating Machine "its controller must choose").
  Small. kind: expression.
- **`skip-restore-rule`** — "on your next turn, skip your faction's RESTORE
  RULE" (Monstrous Lassitude). A scheduled per-player flag consulted in
  applyFactionStartOfTurn. Could compose from scheduleEffect if a
  restore-skip effect exists — it doesn't. kind: effect,state.
- **`cannot-take-control`** — "Opponents cannot take control of this card"
  (Gigantitect's Giant Giant). A flag `takeControl` checks. kind: ids.
- **`damage-redirect-continuous`** — "if the picked character would be dealt
  damage, deal damage to this card instead; if it would leave play, this
  card leaves play in that way instead" (6r4wny 60dy9u4rd5). Unbounded
  continuous redirect of both damage and leave-play, targeting another
  card. Distinct from preventDamage (bounded, self) and redirectDamage
  keyword (battle-only). kind: ability,effect.

If you find a mechanic NOT in either list, propose a new id with a clear
spec. If two of your cards need the same new thing, use the same id.

## Output

Write a JSON file `.work/classify-<N>.json` where `<N>` is your slice number
(1/2/3/4), an array with one object per card in your slice:

```json
[
  {
    "id": "<card id from the slice>",
    "name": "<card name>",
    "status": "classified",
    "rulesAudited": true,
    "behavior": {
      "needed": true,
      "shapes": ["...", "..."],
      "reusesProvenShape": true,
      "newTestNeeded": false
    },
    "metadata": { "unique": null, "attachTo": null, "resourceProvides": null, "keywords": [] },
    "engineCapability": [],
    "parityGaps": [],
    "confidence": "high",
    "notes": "..."
  }
]
```

Plus, if you proposed any capabilities, a second file
`.work/caps-<N>.json`: `[{ "id","kind":["effect"],"spec":"...","why":"card names + what breaks without it" }]`.

`reusesProvenShape` = false ONLY when the card needs a brand-new ability
SHAPE that will need its own `card-behaviors.test.ts` case (this also means
`newTestNeeded: true`). A card that just needs a new capability but a
conventional shape can stay `reusesProvenShape: true`.

Be precise and terse. This is a planning artifact, not prose.
