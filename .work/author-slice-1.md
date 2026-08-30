# SotDE authoring slice 1 (25 cards)

### 5n4p
- id: 1082ff2c-afd3-4c84-89ae-1002579977df | character | trade gearsmith | cost 5 | threshold ee | str 2/life 5/spd 2 | subtype 31f
- text: When this card restores, put a Micromajig token into play under your control.
- classification notes: cardRestored trigger + createTokens. Micromajig TokenSpec 0/1/1 subtype [micromajig] (matches Seed 3 authoring).
- shapes:
    - triggered:cardRestored (sourceIsEventCard) -> createTokens(controller,1,Micromajig)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Accumulation Majig
- id: f235f7f5-ae5d-4b85-a187-6bfaf9d454cd | character | trade gearsmith | cost 4 | threshold e | str 4/life 4/spd 4 | subtype majig
- text: At the start of your turn, you may pay 1 for each token on this card. If you don't, destroy this card. -- At the end of your turn put a token on this card. -- FEED -- COST: Pay 3. -- EFFECT: Remove a token from this card.
- classification notes: mayPay auto-declines when unaffordable, falling through to destroy = 'if you don't, destroy this card'. payResources amount is a NumberExpression = counter('token').
- shapes:
    - triggered:turnStarted(controller) -> mayPay {costs:[payResources {counter token of source}], effects:[], elseEffects:[destroy source]}
    - triggered:turnEnding(controller) -> addCounter token 1
    - activated FEED: costs [payResources 3] -> removeCounter token 1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Battle-Ready Back-Breaker
- id: 1ce692f6-4dff-4d0e-a195-d0df9de5eb47 | character | trade warlord | cost 4 | threshold rr | str 3/life 2/spd 3 | subtype berserker
- text: When this card enters play you may pick a character. If you do, deplete that character.
- classification notes: Proven optional-ETB shape.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(targetExists) deplete
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Bloating Bask
- id: 3db20240-f5a5-4fd9-925d-39b32cab7618 | character | trade warlord | cost 4 | threshold r | str 4/life 3/spd 2 | subtype dragon
- text: [R][R][R][R][R][R]: This card gains 1 strength, 1 life and 1 speed.
- classification notes: Volition-style [R]x6 paragraph. Proven shape (Dying Hero).
- shapes:
    - continuous: condition resourceIcons(controller,rage) >= 6 -> modifiers str+1,life+1,speed+1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Bottlebeard Brandyshanks
- id: 2b1308a7-014c-4924-b430-0448854cb6cc | character | trade rogue | cost 4 | threshold ddd | str 3/life 3/spd 1 | subtype pluck,drunk
- text: UNIQUE PLUCK -- The top card of each opponent's deck is revealed at all times. If any of those cards are a character, this card gains 3 speed. -- CHUG! -- COST: Pay 2. Pick an opponent. -- EFFECT: Put the top card of that player's deck on the bottom of their deck.
- classification notes: 'Pick an opponent' collapses to PlayerRef 'opponent' in 2p. deckPosition + cardTypeIs + moveCard all exist. UNIQUE PLUCK.
- shapes:
    - display: top card of each opponent's deck revealed at all times (renderer hint only)
    - continuous: condition cardTypeIs({deckPosition opponent top}, character) -> modifiers speed+3
    - activated CHUG!: costs [payResources 2] -> moveCard({deckPosition opponent top}, deck, position:bottom)
- engineCapability: []  (all implemented)
- metadata: {"unique":"pluck","attachTo":null,"resourceProvides":null,"keywords":[]}

### Cicibeo the Swift
- id: 8d77787d-29d9-405f-a8a7-5d42bd854c11 | character | trade rogue | cost 0 | threshold dddd | str 2/life 3/spd 4 | subtype grifter,cicibeo
- text: UNIQUE CICIBEO -- TACTICAL -- EXTRA COST: Discard a non-resource Rogue card. -- [D][D][D][D][D][D]: When another "cicibeo" card enters play, if it was deployed from your hand, you may pick a character and take control of it.
- classification notes: 'if it was deployed from your hand' — cardEnteredPlay doesn't distinguish source zone today; approximate by dropping that clause or add an entered-from-hand flag (flagged in notes, not a separate cap). Subtype 'cicibeo' assumed (names carry it in quotes).
- shapes:
    - behavior.keywords [tactical]
    - onPlay.costs: discard 1 {zone hand, conditions:[cardTradeIs rogue, not cardTypeIs resource]}
    - activated-as-triggered [D]x6: triggered:cardEnteredPlay condition and(not sourceIsEventCard, cardSubtypeIs eventCard 'cicibeo', resourceIcons(controller,deception)>=6, <entered from hand>) -> optional pick character -> takeControl controller
- engineCapability: [card-subtype-condition]  (all implemented)
- metadata: {"unique":"cicibeo","attachTo":null,"resourceProvides":null,"keywords":[]}

### Clockman Junk Picker
- id: f8953a4a-6a5a-4104-bfbc-4626645dc766 | character | trade gearsmith | cost 4 | threshold ee | str 2/life 1/spd 3 | subtype mechanic
- text: When this card enters play, you may search your deck for an item and reveal it. If you do, put it into play as a face-down resource. -- TRASH: [E][E][E][E][E][E] -- COST: Pay 1. Pick an item. Destroy this card. -- EFFECT: Destroy that card.
- classification notes: putIntoPlay from deck faceDown exists. threshold 'eeeeee'.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone deck, type item} -> if(exists) putIntoPlay(faceDown) + shuffleDeck
    - activated TRASH [E]x6: costs [payResources 1, destroy source] + targets pick item -> destroy picked
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Drill Instructor
- id: 6a477977-867b-4cdc-acc0-1d3f00923031 | character | trade warlord | cost 3 | threshold r | str 2/life 2/spd 3 | subtype soldier
- text: TACTICAL -- EXTRA COST: Deploy this only not during a battle. -- When this card enters play, pick another character. At the start of the next turn that character gains 3 strength for that turn.
- classification notes: 'the next turn' modelled as scheduleEffect startOfNextTurn (source controller's next turn). If it should fire on the opponent's turn instead, needs schedule-any-next-turn — noted, not blocking.
- shapes:
    - behavior.keywords [tactical]
    - onPlay.condition: not battleActive
    - triggered:cardEnteredPlay(sourceIsEventCard) -> pick another character; rememberTarget; scheduleEffect(startOfNextTurn, condition linkedCardInPlay) -> createModifier str+3 untilEndOfTurn
- engineCapability: [battle-active-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Duelist of Surfeit
- id: d1e9f12e-abc7-4768-9155-2eb23f0def8c | character | trade warlord | cost 3 | threshold r | str 1/life 1/spd 3 | subtype fighter
- text: When a card that provides at least [R] enters play under your control, you may put a token on this card. -- This card gains 1 strength and 1 life for each token on it.
- classification notes: Exact Seed 2 card-provides-icon pattern.
- shapes:
    - triggered:cardEnteredPlay condition and(eventCardControlledBy controller, cardProvides(eventCard, rage, 1)) -> chooserSelectsOption [decline]/[addCounter token 1]
    - continuous: str+{counter token}, life+{counter token}
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Elementary Elemental
- id: 42d337d5-bba5-48bb-be0a-ff19f295699a | character | trade arcanist | cost 1 | threshold o | str 1/life 2/spd 3 | subtype lurker
- text: When this card is destroyed, put it into its owner's hand, then discard a card.
- classification notes: Recover-to-hand then discard a card. Order: destroy resolves (card in discard) then trigger moves it to hand.
- shapes:
    - triggered:cardDestroyed(sourceIsEventCard) -> moveCard(source, hand); chooserSelectsTarget(controller, {zone hand} count 1) -> moveCard(discard)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Elusive Wolf
- id: 77e72f4c-f1c8-4d81-8133-0562dc061b65 | character | trade rogue | cost 4 | threshold d | str 2/life 2/spd 4 | subtype beast
- text: HOWL -- COST: Destroy a card named "Deception" you own. -- EFFECT: Put a token on this card. -- PROWL -- COST: Remove a token from this card. -- EFFECT: This turn, this card gains COVERT.
- classification notes: 'a card named Deception you own' — default zone play (face-down resource) matches by definition.name.
- shapes:
    - activated HOWL: targets [{d: {owner self, name 'Deception'} count 1}], costs [destroy {selected d}] -> addCounter token 1
    - activated PROWL: costs [removeCounter token 1] -> grantKeyword(source, covert, untilEndOfTurn)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Fanatical Shriever
- id: 9eddb4f8-2055-48b8-8942-664e6c9a0f50 | character | trade warlord | cost 5 | threshold rr | str 3/life 3/spd 3 | subtype dragon
- text: TACTICAL -- EXTRA COST: Deploy this only not during a battle. You may pick an item. -- When this card enters play, if you picked an item as part of its cost, destroy that item. -- [R][R][R][R][R][R]: When this card enters play you may pick a location. If you do, inflict 2 damage to that card.
- classification notes: 
- shapes:
    - behavior.keywords [tactical]
    - onPlay.condition: not battleActive; onPlay.targets [{it:{zone play, type item} optional}]; onPlay.effects: if(targetExists it) destroy {it}
    - triggered:cardEnteredPlay condition and(sourceIsEventCard, resourceIcons(controller,rage)>=6) -> optional pick location -> if(exists) dealDamage 2
- engineCapability: [battle-active-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Hassan-i of Thabbash
- id: 337f6b9c-02ac-4c53-aaf2-e8301635cc03 | character | trade banker | cost 5 | threshold ggg | str 2/life 2/spd 3 | subtype assassin
- text: When this card is destroyed, each opponent must destroy a character they control. -- HARASH: [V][V][V] -- COST: Use this only if this card is in your discard pile and only during your turn. Pay 1. Destroy a face-down resource you control. -- EFFECT: Put this card into play under your control.
- classification notes: 'each opponent must destroy' is mandatory chooser target (not optional). HARASH from discard, only on your turn.
- shapes:
    - triggered:cardDestroyed(sourceIsEventCard) -> chooserSelectsTarget(opponent, {controller opponent, zone play, type character} count 1) -> destroy
    - activated HARASH [V]x3: activationZone 'discard', condition isActivePlayer(controller); costs [payResources 1, destroy {face-down resource you control}] -> putIntoPlay(source, controller)
- engineCapability: [active-player-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Homewrecker
- id: be86071b-9c40-443e-8675-79ac4f8657e6 | character | trade banker | cost 2 | threshold g | str 3/life 3/spd 3 | subtype mau,assassin
- text: EXTRA COST: Inflict 2 damage to a location you own or pay 3. -- Locations you control gain 1 structure. -- PROSTRATE -- COST: Deplete a location you control. Pick a character. -- EFFECT: Deplete that card.
- classification notes: oneOf auto-pays first payable branch (no player choice) — a player with a location is forced into the damage branch. Acceptable approximation.
- shapes:
    - onPlay.targets [{loc:{owner self, zone play, type location} optional}]; onPlay.costs oneOf [[dealDamage {loc} 2],[payResources 3]]
    - continuous aura: modifiers {selector {controller self, zone play, type location}, structure, add 1}
    - activated PROSTRATE: costs [deplete {selected myLoc}] + targets [{myLoc:{controller self, zone play, type location}},{ch: character}] -> deplete {ch}
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Lugubrian Poacher
- id: ecba9157-e8c2-4237-8e99-0a39f6750044 | character | trade arcanist | cost 3 | threshold oo | str 2/life 4/spd 2 | subtype lurker
- text: When this card restores, it gains COVERT this turn.
- classification notes: 
- shapes:
    - triggered:cardRestored(sourceIsEventCard) -> grantKeyword(source, covert, untilEndOfTurn)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### M3CHm4n1c 31f
- id: f6da3761-a0bd-463b-9571-aba48ccf95cd | character | trade gearsmith | cost 2 | threshold ee | str 1/life 1/spd 3 | subtype mechanic,31f
- text: When this card enters play, you may pay 2. If you do, you may put a token on up to 2 different non-resource cards. -- While there is a token on this card, it gains 2 strength and 2 life.
- classification notes: 'up to 2 different non-resource cards' = count-2 optional declaration.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> mayPay {costs:[payResources 2], effects:[chooserSelectsTarget(controller, {zone play, conditions:[not resource]} count 2 optional) -> forEach addCounter token 1]}
    - continuous: condition counterCompare(source, token, >=, 1) -> str+2,life+2
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Marauding Madster
- id: 739a2839-d98f-4ac4-8c2d-8717353f384c | character | trade warlord | cost 1 | threshold rrrr | str 3/life 4/spd 3 | subtype berserker
- text: EXTRA COST: Pick a character you control. -- When this card enters play, destroy the picked character. -- If this character would be put into your discard pile from anywhere, shuffle it into your deck instead.
- classification notes: Destination-based moveToZone replacement covers 'to your discard from anywhere'.
- shapes:
    - onPlay.targets: pick a character you control; onPlay.effects: destroy {selected}
    - replacement: replaces {moveToZone, zone:discard, controlledBy:self} condition sourceIsEventCard -> moveCard(__candidate, deck) + shuffleDeck
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Mau Strategist
- id: e0b38a11-024e-47b7-a886-a22221328fea | character | trade banker | cost 3 | threshold gg | str 1/life 1/spd 3 | subtype mau,bureaucrat
- text: When this card enters play, you may search your deck for a staple resource, reveal it, and put it into your hand. -- When this card is destroyed, you may draw a card.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone deck, type resource, staple true} -> if(exists) moveCard hand + shuffleDeck
    - triggered:cardDestroyed(sourceIsEventCard) -> chooserSelectsOption [decline]/[draw 1]
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Mr. Fetch
- id: 78e8d502-b066-4f29-a690-dd202713bcc8 | character | trade banker | cost 4 | threshold gg | str 1/life 2/spd 3 | subtype pluck,grifter
- text: UNIQUE PLUCK -- When this card enters play, you may remove a card in your discard pile from the game. If you do, draw a card. -- GOOD DEAL -- COST: Deplete this card. Pick 2 cards of the same type in your discard pile. Remove them from the game. -- EFFECT: Search your deck for a card with the same type as the picked cards and reveal it. If you do, put it into your hand.
- classification notes: '2 cards of the same type' modelled as two declarations chained by cardTypeEquals. UNIQUE PLUCK.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {zone discard} -> if(exists) removeFromGame + draw 1
    - activated GOOD DEAL: costs [deplete source], targets [{t1:{zone discard} c1},{t2:{zone discard, conditions:[cardTypeEquals(__candidate,{selected t1})]} c1}], costs [sacrificeSelected t1 removeFromGame, sacrificeSelected t2 removeFromGame] -> target {zone deck, conditions:[cardTypeEquals(__candidate,{selected t1})]} -> moveCard hand + shuffleDeck
- engineCapability: []  (all implemented)
- metadata: {"unique":"pluck","attachTo":null,"resourceProvides":null,"keywords":[]}

### Murderous Kleptomaniac
- id: 0f7da7ec-f232-4403-816e-f635a2b475c9 | character | trade rogue | cost 6 | threshold dd | str 3/life 3/spd 3 | subtype vigilante
- text: COVERT -- When this card is put into a discard pile from play, you may pick a character, item, or location. If you do, remove that card from the game. -- KLEPT: [D][D][D][D][D][D][D][D][D][D] -- COST: Pay 4. Pick a character or item. -- EFFECT: Take control of that card.
- classification notes: threshold 'dddddddddd' (10 icons). 'character, item, or location' via selector.conditions or/not composition.
- shapes:
    - behavior.keywords [covert]
    - triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play, cardMovedToZone discard) -> optional pick {zone play, conditions:[not resource, not faction, not tactic]} -> removeFromGame
    - activated KLEPT [D]x10: costs [payResources 4] + targets pick {zone play, conditions:[or char,item]} -> takeControl controller
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Mushroom Merchant
- id: d68c6b4d-ed0c-4896-a9e2-f6c91e5c951e | character | trade banker | cost 4 | threshold gg | str 2/life 4/spd 3 | subtype mau,merchant
- text: When this card enters play, you may pick a character. If you do, this turn, that character gains 2 life.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(exists) createModifier life+2 EOT
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Neuralyzer Agent
- id: 0a7c01eb-92bd-4172-9c0d-24886de70287 | character | trade arcanist | cost 5 | threshold oo | str 3/life 3/spd 3 | subtype muddler
- text: When this card attacks, pick an opponent. That player discards a card. -- [O][O][O][O][O][O]: When this card inflicts battle damage to an opponent's faction, that faction's owner discards a card.
- classification notes: 'inflicts battle damage' — battle damage to a faction already emits damageDealt; if a battle-only gate is needed it isn't available, note as minor.
- shapes:
    - triggered:characterAttacked(sourceIsEventCard) -> chooserSelectsTarget(opponent, {zone hand} c1) -> moveCard discard
    - triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction, eventCardControlledBy opponent, resourceIcons(controller,obsession)>=6) -> chooserSelectsTarget({ownerOf eventCard}, {zone hand} c1) -> moveCard discard
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Officially Offensive Overseer
- id: 7e485e5b-2d3a-4013-98d9-f7c9e47ccb57 | character | trade arcanist | cost 4 | threshold o | str 3/life 3/spd 3 | subtype ritualist
- text: EXTRA COST: If you control at least [O][O][O], you may pick a character or a location. -- When this card enters play, if you picked a character or location as part of its cost and the character has strength 3 or less or the location has structure 3 or less, put that card into its owners's hand.
- classification notes: The [O][O][O] gate folded into the selector via a global numberCompare condition.
- shapes:
    - onPlay.targets [{p:{zone play, conditions:[or(cardTypeIs char, cardTypeIs location), numberCompare(resourceIcons(self,obsession) >= 3)]} count 1 optional}]
    - onPlay.effects: if(and(targetExists p, or(statCompare {p} strength <= 3, statCompare {p} structure <= 3))) -> moveCard {p} hand
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Purloinering Pirate
- id: 66e67194-792c-4d2c-b47b-f410627c1c43 | character | trade banker | cost 3 | threshold g | str 2/life 2/spd 3 | subtype pirate
- text: This card gains 1 strength and 1 life for each token on it. -- PUSH OVERBOARD AND LOOT -- COST: Pay 1. Destroy a character you own. -- EFFECT: Put a token on this card.
- classification notes: 
- shapes:
    - continuous: str+{counter token}, life+{counter token}
    - activated PUSH OVERBOARD AND LOOT: targets [{v:{owner self, zone play, type character}}], costs [payResources 1, destroy {selected v}] -> addCounter token 1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Quotidian Concealer
- id: db263f70-60f8-458d-bcd1-441f945f0617 | character | trade arcanist | cost 2 | threshold oo | str 1/life 1/spd 3 | subtype ritualist
- text: This card enters play with a token on it. -- OBSCURE -- COST: Remove a token from this card. Pick a character. -- EFFECT: This turn, the character gains COVERT.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 1
    - activated OBSCURE: costs [removeCounter token 1] + targets pick character -> grantKeyword(covert, untilEndOfTurn)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
