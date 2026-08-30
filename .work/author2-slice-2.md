# SotDE authoring round 2, slice 2 (18 cards)

### Pinguid Bodyguard
- id: 3ab1c632-f0ab-4bc6-bbf4-85162d896459 | character | trade banker | cost 6 | threshold gg | str 3/life 4/spd 3 | subtype mercenary,mau
- text: When this card attacks, restore it at the end of the battle. -- This card can only attack once each turn. -- PROTECT -- COST: Deplete this card. Pick a character. -- EFFECT: This turn, the character gains 2 life.
- classification notes: 
- shapes:
    - triggered:characterAttacked(sourceIsEventCard) -> scheduleEffect(endOfBattle) -> restore source
    - static restriction attackOncePerTurn on source
    - activated PROTECT: costs [deplete source] + targets pick character -> createModifier life+2 EOT
- engineCapability (all implemented): [restore-at-end-of-battle, attack-limit-per-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Rushing Crushing Blockhead
- id: ef509645-3df1-44fb-955b-069fc0aebe35 | character | trade warlord | cost 3 | threshold r | str 4/life 2/spd 4 | subtype berserker
- text: When this card inflicts damage to a faction, destroy this card and inflict 2 damage to your faction. -- This character cannot block. -- [R][R][R][R][R][R]: This card loses all other rules text and loses 1 speed.
- classification notes: suppressAllAbilities must exempt its own ability so the speed-1 from the same continuous still applies.
- shapes:
    - triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> destroy source; dealDamage {factionOf controller} 2
    - continuous: restrictions [{target:source, cannotBlock}]
    - continuous: condition resourceIcons(controller,rage) >= 6 -> suppressAllAbilities {target:source} + modifiers speed-1
- engineCapability (all implemented): [lose-rules-text]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Skullcrush Steamroller
- id: ac14455c-c744-4c57-b53b-430450666fac | character | trade warlord | cost 3 | threshold rrr | str 4/life 5/spd 3 | subtype warmachine
- text: This card cannot be restored by your faction's RESTORE RULE. -- This card can attack only once each turn. -- ASSIST -- COST: Pay 2. Deplete a character you control. -- EFFECT: Restore this card.
- classification notes: 
- shapes:
    - continuous: restrictions [{target:source, cannotBeRestored}]
    - static restriction attackOncePerTurn on source
    - activated ASSIST: costs [payResources 2, deplete {selected other}], targets [{other:{controller self, zone play, type character}}] -> restore source
- engineCapability (all implemented): [attack-limit-per-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Sockem Bot
- id: a981c172-6c40-43d4-b941-0a336e4924fb | character | trade gearsmith | cost 6 | threshold eee | str 8/life 6/spd 2 | subtype warmachine
- text: PAY OFF -- COST: Any player may use this ability. Pay 1. -- EFFECT: This turn, if damage is inflicted to a character or faction by this card, reduce the amount by 1.
- classification notes: 
- shapes:
    - activated PAY OFF: usableBy anyPlayer, costs [payResources 1] -> modifyOutgoingDamage(source, -1, untilEndOfTurn)
- engineCapability (all implemented): [outgoing-damage-modifier]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Thabbashite Armorer
- id: 18d50b0d-08aa-4c7a-a37f-bacfd8585be0 | character | trade gearsmith | cost 4 | threshold e | str 2/life 2/spd 3 | subtype craftsman
- text: FOR THABBASH: [V][V][V] -- COST: Pay 2. -- EFFECT: This turn, this card gains 1 strength and 1 life. -- TAMESHIGIRI: [V][V][V][V][V][V] -- COST: Pay 2. Your faction loses 2 influence. -- EFFECT: This turn, this card gains 2 strength and 2 life.
- classification notes: 
- shapes:
    - activated FOR THABBASH [V]x3: costs [payResources 2] -> createModifier str+1,life+1 EOT
    - activated TAMESHIGIRI [V]x6: costs [payResources 2, loseInfluence 2] -> createModifier str+2,life+2 EOT
- engineCapability (all implemented): [lose-influence-cost]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Thabbashite Chemist
- id: 1aff6726-2aff-474e-92aa-bc997202f9b2 | character | trade arcanist | cost 2 | threshold o | str 1/life 1/spd 3 | subtype ritualist
- text: DELINIATE: [V][V] -- COST: Pay 2. Deplete this card. Name a threshold icon. X is that icon. -- EFFECT: This turn, each face-down resource that doesn't have PROVIDES X, gains PROVIDES X.
- classification notes: 
- shapes:
    - activated DELINIATE [V]x2: costs [payResources 2, deplete source]; nameValue(controller, resourceIcon, 'x'); forEach {zone play, faceDown true, type resource} -> grantProvides({__candidate}, {fromNamed x}, 1, untilEndOfTurn)
- engineCapability (all implemented): [grant-provides, name-resource-icon]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Thabbashite Financier
- id: 3444240c-6824-4a70-83bc-2fff722afaf6 | character | trade banker | cost 5 | threshold g | str 3/life 3/spd 2 | subtype merchant
- text: BLOOD GOLD: [V][V] -- COST: Pay 2. Lose 1 influence. -- EFFECT: You may play a card as a face-down resource.
- classification notes: Extra face-down resource play outside the Develop Rule.
- shapes:
    - activated BLOOD GOLD [V]x2: costs [payResources 2, loseInfluence 1] -> chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource({selected}, faceDown true)
- engineCapability (all implemented): [lose-influence-cost]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Timid Mau
- id: 18dc6ee3-84de-4bf8-888f-f8c09a2b12e3 | character | trade banker | cost 5 | threshold gg | str 4/life 5/spd 3 | subtype mau
- text: When this card is blocked by an opposing party of 2 or more characters, it loses 1 speed this turn.
- classification notes: characterBlocked maps to the blocker today; need an attacker-blocked trigger/condition.
- shapes:
    - triggered:<attacker becomes blocked> condition and(sourceIsEventCard, numberCompare(count{inBattle role blocker} >= 2)) -> createModifier speed-1 EOT
- engineCapability (all implemented): [attacker-blocked-trigger]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Arcane Escrow
- id: ae2a8991-a53d-4ac4-a5d8-707b812babae | item | trade banker | cost 2 | threshold gg
- text: If you would discard a card, you may put it in the void face-down instead. -- You may look at cards voided by this card. -- If you would draw a card as part of your Develop Rule, you may put a card voided by this card into its owner's hand instead. -- WITHDRAW -- COST: Pay 1. -- EFFECT: Draw a card. Discard 2 cards. -- FLIP UP: 1 [G][G]
- classification notes: Author the discard->void replacement + WITHDRAW + FLIP UP; the develop-draw swap is a niche capability (or parity gap). [merge: the develop-draw-replacement clause is a parity gap (search-and-develop-draw-interception); the rest of the card is in scope.]
- shapes:
    - replacement: replaces {moveToZone, zone discard, controlledBy self} optional -> moveCard(__candidate, void) + set faceDown
    - GAP: 'if you would draw a card as part of your Develop Rule, you may put a voided card into hand instead'
    - activated WITHDRAW: costs [payResources 1] -> draw 1; discard 2
    - card.flipUp { cost:1, threshold:'gg' }
- engineCapability (all implemented): []
- parityGaps (author the rest, skip these clauses): search-and-develop-draw-interception
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Flaming Cube
- id: de91eacd-1b08-4595-a238-f4654e554ab8 | item | trade warlord | cost 6 | threshold rrr
- text: This card enters play with 3 tokens on it. -- At the start of your turn put a token on this card. -- When there are at least 6 tokens on this card, destroy it. If you do, each opponents' faction loses 6 influence. -- When there are no tokens on this card destroy it. -- CONTROL THE FLAME! -- COST: Any player may use this ability. Destroy a character or item you control. -- EFFECT: Add or remove a token from this card.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 3
    - triggered:turnStarted(controller) -> addCounter token 1
    - triggered:counterChanged(source) condition counterCompare(source,token,>=,6) -> destroy source; forEachPlayer(opponents) modifyInfluence(-6)
    - triggered:counterChanged(source) condition counterCompare(source,token,=,0) -> destroy source
    - activated CONTROL THE FLAME!: usableBy anyPlayer, costs [destroy {selected}], targets [{x:{controller self, zone play, conditions:[or char,item]}}] -> chooserSelectsOption [addCounter token 1]/[removeCounter token 1]
- engineCapability (all implemented): [counter-threshold-trigger]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Frickin' Sweet Pogo-Bunny
- id: 92a594d3-0560-4f4a-b872-5ed8a376967a | item | trade gearsmith | cost 1 | threshold ee
- text: RAAR! -- COST: Use this only if this card is not a character and only once each turn. Pay 1. -- EFFECT: This turn, this card gains the "character" type, and gains 2 strength, 2 life, and 3 speed. -- HIDE! -- COST: Pay 1. -- EFFECT: If this card is a character, it loses the "character" type. Deplete this card. -- INTO THE RABBIT HOLE? -- COST: Pay 3. -- EFFECT: Flip this card face-down under its owner's control.
- classification notes: 
- shapes:
    - activated RAAR!: condition not cardTypeIs(source, character), usesPerTurn 1, costs [payResources 1] -> setCardType(source, character, grantStats {strength:2,life:2,speed:3}, untilEndOfTurn)
    - activated HIDE!: costs [payResources 1] -> if(cardTypeIs source character) removeCardType(source, character); deplete source
    - activated INTO THE RABBIT HOLE?: costs [payResources 3] -> flipFaceDown source
- engineCapability (all implemented): [remove-card-type]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Golden Charm
- id: b36130ca-d095-4cda-98b4-e6a1de823e40 | item | trade banker | cost 3 | threshold g
- text: UNIQUE CHARM -- If a player would search their deck you may pay 1. If you do, draw a card and then that player searches their deck instead. -- SERAPHIM FUSION -- COST: Pay 4. Pick a character you control with UNIQUE EUSTACE. Destroy this card. -- EFFECT: Search your deck for a card named Siluriformes Flaxenscale and put it into play.
- classification notes: Author SERAPHIM FUSION; the search-interception clause is niche (2 cards) — candidate wontImplement-partial / parity note. [merge: the search-interception clause is a parity gap (search-and-develop-draw-interception); the rest of the card is in scope.]
- shapes:
    - GAP: 'if a player would search their deck you may pay 1 -> draw a card, then they search instead' (search interception)
    - activated SERAPHIM FUSION: costs [payResources 4, destroy source], targets [{e:{controller self, zone play, type character, uniqueDesignation:'eustace'}}] -> target {zone deck, name 'Siluriformes Flaxenscale'} -> putIntoPlay(controller) + shuffleDeck
- engineCapability (all implemented): [unique-designation-selector]
- parityGaps (author the rest, skip these clauses): search-and-develop-draw-interception
- metadata: {"unique":"charm","attachTo":null,"resourceProvides":null,"keywords":[]}

### Micromajigmakermachinemajig
- id: 67fe9bf8-04c3-4ea0-bbde-0ec94e33b56e | item | trade gearsmith | cost 1 | threshold ee
- text: RELEASE THE MAJIGS! -- COST: Deplete this card. Pick an opponent. That player may put a Micromajig token into play under their control. This turn, all damage inflicted to that token is reduced to 0. -- EFFECT: Put a Micromajig token into play under your control. -- PREPARE -- COST: Pay 2. -- EFFECT: Restore this card.
- classification notes: 'damage to that token reduced to 0 this turn' needs createTokens to expose the new token for a follow-up preventDamage.
- shapes:
    - activated RELEASE THE MAJIGS!: costs [deplete source] -> chooserSelectsOption(opponent) [decline]/[createTokens({player opponent},1,Micromajig) with effects:[preventDamage(__candidate, 999, reduce, EOT)]]; createTokens(controller,1,Micromajig)
    - activated PREPARE: costs [payResources 2] -> restore source
- engineCapability (all implemented): [create-token-then-effect]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Mittens of Muffled Thought
- id: 1c7ffb60-714a-4497-ae9f-13d9980158e6 | item | trade arcanist | cost 3 | threshold o | subtype gear
- text: ATTACH TO CHARACTER -- The attached character cannot attack and has no rules text. -- MOVE -- COST: Pick a character that is not in battle. Pay 3. -- EFFECT: Attach this card to the character.
- classification notes: 
- shapes:
    - continuous: restrictions [{target attachedTo, cannotAttack}]; suppressAllAbilities {target: attachedTo}
    - activated MOVE: targets [{ch:{type character, conditions:[not inBattle]}}], costs [payResources 3] -> attachTo(source, {ch})
- engineCapability (all implemented): [lose-rules-text]
- metadata: {"unique":null,"attachTo":"character","resourceProvides":null,"keywords":[]}

### Runic Map
- id: ba4a554e-4fbb-42b4-8e63-3f5f200104e5 | item | trade gearsmith | cost 2 | threshold ee
- text: This card enters play with 2 tokens on it. -- When there are no tokens on this card destroy it. -- PLAN -- COST: Pay 1. Remove a token from this card. -- EFFECT: Search your deck for a card named "Elitism" and reveal it. Put it into your hand. -- FOLLOW PLAN -- COST: Pay 2. Remove a token from this card. -- EFFECT: You may play a resource. -- NEW PLAN -- COST: Destroy a face-down resource you control. -- EFFECT: Add a token to this card.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 2
    - triggered:counterChanged(source) condition counterCompare(source,token,=,0) -> destroy source
    - activated PLAN: costs [payResources 1, removeCounter token 1] -> target {zone deck, name 'Elitism'} -> moveCard hand + shuffleDeck
    - activated FOLLOW PLAN: costs [payResources 2, removeCounter token 1] -> chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource
    - activated NEW PLAN: costs [destroy {selected fd}], targets [{fd:{controller self, zone play, faceDown true, type resource}}] -> addCounter token 1
- engineCapability (all implemented): [counter-threshold-trigger]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Barracks of Precipitancy
- id: ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca | location | trade warlord | cost 4 | threshold rrr | structure 5
- text: GO TIME! -- COST: Deplete this card. -- EFFECT: Shuffle your deck and then reveal the top card. If the revealed card is a character, put that card into play, otherwise put it on the bottom of your deck. The character can attack even if it has not been in play under your control since the start of the turn. If that character would leave play or is in play at the end of the turn, remove it from the game instead. -- AT ANY COST! -- COST: Pay 2. Inflict 3 damage to this card. -- EFFECT: Restore this card.
- classification notes: 'remove it from the game if it would leave play or is in play at end of turn' = borrowed putIntoPlay.
- shapes:
    - activated GO TIME!: costs [deplete source] -> shuffleDeck; if(cardTypeIs {deckPosition top} character) putIntoPlay({deckPosition top}, controller, borrowed:true) + grantKeyword(that, aggro, EOT)
    - activated AT ANY COST!: costs [payResources 2, dealDamage source 3] -> restore source
- engineCapability (all implemented): [borrowed-until-end-of-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Clockman Skydocks
- id: 0146d330-33ea-4847-8d52-25810a946e40 | location | trade universal | cost 1 | threshold v | structure 4
- text: UNIQUE SKYDOCKS -- BUSINESS DAY -- COST: Pay 1. Deplete this card. Name a resource icon. -- EFFECT: This turn, reduce the threshold requirement of the next card you deploy by 1 of the named resource icon. -- OVERTIME: [V][V][V][V][V] -- COST: Pay 2. Deplete this card. Name a resource icon. -- EFFECT: This turn, reduce the threshold requirement of the next card you deploy by up to 6 of the named resource icon.
- classification notes: 
- shapes:
    - activated BUSINESS DAY: costs [payResources 1, deplete source]; nameValue(controller, resourceIcon, 'x') -> reduceThreshold(controller, {fromNamed x}, 1)
    - activated OVERTIME [V]x5: costs [payResources 2, deplete source]; nameValue(controller, resourceIcon, 'x') -> reduceThreshold(controller, {fromNamed x}, 6)
- engineCapability (all implemented): [reduce-threshold-requirement, name-resource-icon]
- metadata: {"unique":"skydocks","attachTo":null,"resourceProvides":null,"keywords":[]}

### Gloamspike-Gosche Bridge
- id: 40c10ab8-454a-4bab-98a0-d0530c983344 | location | trade arcanist | cost 6 | threshold oooo | structure 5
- text: This card cannot be picked. -- All characters in your hand gain TACTICAL. -- [O][O][O][O][O][O][O][O]: All items and locations in your hand gain TACTICAL.
- classification notes: 
- shapes:
    - continuous: restrictions [{target:source, cannotBePicked}]
    - continuous aura(hand): keywords {selector {controller self, zone hand, type character}, tactical}
    - continuous aura(hand) gated [O]x8: keywords {selector {controller self, zone hand, type item OR location}, tactical}
- engineCapability (all implemented): [untargetable, aura-over-hand-zone, dynamic-tactical-honored]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
