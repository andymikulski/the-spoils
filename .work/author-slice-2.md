# SotDE authoring slice 2 (25 cards)

### R3p347 0ff3nd3r
- id: 969e0f4d-8320-4a06-8fb0-2502da819c8e | character | trade gearsmith | cost 3 | threshold eee | str 2/life 2/spd 3 | subtype guardforce,31f
- text: This card can attack even if it has not been in play under your control since the start of the turn. -- When this card enters play, you may pay 2. If you do, put a token on it. -- While there is a token on this card, it gains 1 strength and 1 life. -- P3PP3R 61457 -- COST: Remove a token from this card. Use this only once per turn. -- EFFECT: This turn, this character gains 1 strength and 1 life. Restore it.
- classification notes: AGGRO's only mechanical effect (RULES §9) is the attack-eligibility exemption, exactly this line.
- shapes:
    - behavior.keywords [aggro]  (== 'can attack even if not in play since start of turn')
    - triggered:cardEnteredPlay(sourceIsEventCard) -> mayPay {costs:[payResources 2], effects:[addCounter token 1]}
    - continuous: counterCompare(source,token,>=,1) -> str+1,life+1
    - activated P3PP3R 61457: costs [removeCounter token 1], usesPerTurn 1 -> createModifier str+1,life+1 EOT; restore source
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Rudo Mangod, Dragonweight Champion
- id: 39d69cc2-0af9-4e69-b31f-b7cc964353bb | character | trade warlord | cost 4 | threshold rrrr | str 5/life 5/spd 3 | subtype rudo,fighter
- text: UNIQUE RUDOLPHUS -- When this card enters play, deplete all other characters you control. They cannot be restored by your faction's RESTORE RULE. -- This character gains 1 strength for each depleted warlord character you control.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> forEach {controller self, zone play, type character, conditions:[not __candidate==source]} -> deplete + setRestoreLock true
    - continuous: str +{count {controller self, zone play, type character, depleted true, conditions:[cardTradeIs warlord]}}
- engineCapability: []  (all implemented)
- metadata: {"unique":"rudolphus","attachTo":null,"resourceProvides":null,"keywords":[]}

### Shade of the Devoured Emperor
- id: 506f383f-ef35-467b-8554-dd6b4b9729df | character | trade warlord | cost 2 | threshold vvvv | str 0/life 1/spd 0 | subtype padamose,emperor,mau
- text: UNIQUE PADAMOSE -- At the end of an opponent's turn, you may remove this card from the game, then choose a player and search their deck for a UNIQUE JO, UNIQUE EUSTACE, UNIQUE PLUCK, UNIQUE RUDOLPHUS, or UNIQUE IGNATIOUS and reveal it. If you do, put it into play under your control. -- FLIP UP: 2 [V][V][V][V]
- classification notes: 'choose a player and search their deck' — model as a deck target picked via a faction-card selection or 'any deck'. FLIP UP 2 [V]x4.
- shapes:
    - triggered:turnEnding condition eventPlayerIs(opponent) -> mayPay {costs:[removeFromGame source], effects:[ target {zone deck (any player's), uniqueDesignation:[jo,eustace,pluck,rudolphus,ignatious]} -> putIntoPlay(controller) + shuffleDeck ]}
    - card.flipUp { cost:2, threshold:'vvvv' }
- engineCapability: [unique-designation-selector]  (all implemented)
- metadata: {"unique":"padamose","attachTo":null,"resourceProvides":null,"keywords":[]}

### Siluriformes Flaxenscale
- id: 6b29fb62-bd69-49ef-9f20-dc8712205d4f | character | trade banker | cost 7 | threshold gggg | str 4/life 5/spd 3 | subtype siluriformes,seraphim,dragon
- text: UNIQUE SILURIFORMES -- All UNIQUE EUSTACE gain 3 strength and 3 life. -- NUMISMATIC EMISSION -- COST: Pay 5. -- EFFECT: Draw 2 cards. Gain 2 influence. -- AURIFEROUS AUGMENTAION -- COST: Discard 2 cards. -- EFFECT: This turn, this character gains 2 strength and 2 life.
- classification notes: 
- shapes:
    - continuous aura: modifiers {selector {uniqueDesignation:'eustace'}, str+3}, {... life+3}
    - activated NUMISMATIC EMISSION: costs [payResources 5] -> draw 2; modifyInfluence(controller,+2)
    - activated AURIFEROUS AUGMENTAION: costs [discard 2] -> createModifier str+2,life+2 EOT
- engineCapability: [unique-designation-selector]  (all implemented)
- metadata: {"unique":"siluriformes","attachTo":null,"resourceProvides":null,"keywords":[]}

### Stuttershy
- id: fd095fbd-7566-4b39-832e-0f40a0181289 | character | trade gearsmith | cost 1 | threshold ee | str 0/life 1/spd 3 | subtype horsemajig
- text: If this card would be destroyed, flip it face-down under its owner's control instead. -- When this card is flipped down, each opponent's faction gains 1 influence and you may put a Micromajig token into play under your control for each influence gained this way.
- classification notes: 'when this is flipped down' folded into the replacement's own effects (the only way this card flips). External-flip edge (someone else flips it) left unmodelled — noted.
- shapes:
    - replacement: replaces {destroy} condition sourceIsEventCard -> flipFaceDown {__candidate}; forEachPlayer(opponents) modifyInfluence(+1); createTokens(controller, {count opponents}, Micromajig)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Testudine Autoframe
- id: f83b3af9-a7cb-4945-9632-bdfab77a111a | character | trade gearsmith | cost 7 | threshold eeee | str 5/life 3/spd 4 | subtype testudine,seraphim,dragon
- text: UNIQUE TESTUDINE -- When this card enters play, you may put a UNIQUE JO you control into the void. If you do, this turn, each other character you control gains 1 strength and 1 life. -- All characters you control can attack even if they have not been in play under your control since the start of the turn. -- When this card leaves play, put a UNIQUE JO that was voided by this card into play under your control.
- classification notes: linkedTargets clear on leaving play may race the leaves-play trigger — flag; may need remembered-target-survives-leave. AGGRO aura = the 'can attack even if not in play since start of turn' clause.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional target {controller self, zone play, uniqueDesignation:'jo'} -> if(exists) moveCard(void) + rememberTarget 'voidedJo' + forEach {controller self, zone play, type character, not source} createModifier str+1,life+1 EOT
    - continuous aura: keywords [{selector {controller self, zone play, type character}, aggro}]
    - triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play) -> putIntoPlay({remembered voidedJo}, controller)
- engineCapability: [unique-designation-selector]  (all implemented)
- metadata: {"unique":"testudine","attachTo":null,"resourceProvides":null,"keywords":[]}

### Thabbashite Assailant
- id: f474ddf4-9fa8-44f2-b74c-9eebe554f125 | character | trade rogue | cost 1 | threshold d | str 1/life 1/spd 3 | subtype assassin
- text: [V]: This card gains 1 life. -- [V][V]: This card gains 1 strength. -- [V][V][V]: This card gains 1 speed. -- [V][V][V][V]: This card gains 1 life, 1 strength, and 1 speed.
- classification notes: Cumulative [V] paragraphs, 4 separate continuous abilities.
- shapes:
    - continuous x4: condition resourceIcons(controller,volition) >= 1 -> life+1; >=2 -> str+1; >=3 -> speed+1; >=4 -> life+1,str+1,speed+1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Thabbashite Warmonger
- id: f75a2be6-4c8f-43e2-b23f-28d1892062c0 | character | trade warlord | cost 1 | threshold r | str 1/life 2/spd 3 | subtype tyrant
- text: [V]: When a character inflicts battle damage to a faction, X is the number of threshold icons of the character. Inflict X damage to that character's controller's faction.
- classification notes: [V] gate on a triggered ability. 'that character's controller's faction' needs controllerOf + damageSource + thresholdIconCount.
- shapes:
    - triggered:damageDealt condition and(resourceIcons(controller,volition)>=1, cardTypeIs eventCard faction, cardTypeIs {damageSource} character) -> bind x = thresholdIconCount({damageSource}); dealDamage({factionOf {controllerOf {damageSource}}}, {x})
- engineCapability: [threshold-icon-count-expression, event-damage-source-targetref, controller-of-playerref]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### The Lugubrian Council of Quotidian Affairs
- id: e2b65004-fb6d-40f2-8f4c-18ee79e934fd | character | trade arcanist | cost 2 | threshold oooo | str 2/life 2/spd 3 | subtype advisor
- text: UNIQUE COUNCIL -- CONVENE -- COST: Pay 2. Discard 2 cards. -- EFFECT: Put 2 tokens on this card. -- CAST VOTE -- COST: Pay 2. Remove 2 tokens from this card. -- EFFECT: Search your deck for a tactic and reveal it. Put it into your hand. -- PASS -- COST: Pay 2. Discard a tactic from your hand. X is that tactic's numeric cost. Pick an opponent's character with strength X or less. -- EFFECT: Put the character into its owner's hand. That character's controller may detach up to X resources from their faction.
- classification notes: X = discarded tactic's cost via ability variables (selected 't' available from the discard cost). 'that character's controller may detach' uses existing ownerOf.
- shapes:
    - activated CONVENE: costs [payResources 2, discard 2] -> addCounter token 2
    - activated CAST VOTE: costs [payResources 2, removeCounter token 2] -> target {zone deck, type tactic} -> moveCard hand + shuffleDeck
    - activated PASS: variables x = cardCost({selected t}); costs [payResources 2, discard {t:{zone hand, type tactic}}], targets [{v:{controller opponent, zone play, type character, conditions:[statCompare strength <= {x}]}}] -> moveCard {v} hand; chooserSelectsTarget({ownerOf v}, {owner <that>, type resource, attached to faction} count {x} optional) -> forEach detach
- engineCapability: []  (all implemented)
- metadata: {"unique":"council","attachTo":null,"resourceProvides":null,"keywords":[]}

### Totally Random Kid
- id: fc31573d-7f46-4e68-ab94-9ea36a3dbe90 | character | trade rogue | cost 2 | threshold d | str 1/life 1/spd 4 | subtype outcast
- text: When this character inflicts battle damage to a faction, put the top X cards of that opponent's deck into their discard pile where X is the amount of damage inflicted by this character. You may pick an item with X or less numeric cost and destroy it.
- classification notes: 
- shapes:
    - triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard faction) -> bind x = eventDamageAmount; mill({ownerOf eventCard}, {x}); optional target {zone play, type item, conditions:[cardCost <= {x}]} -> destroy
- engineCapability: [event-damage-amount-expression]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Undevoted Gargantuan
- id: 0070ffff-bc96-4245-a7e8-d376941be247 | character | trade arcanist | cost 5 | threshold oooo | str 5/life 5/spd 3 | subtype monstrosity
- text: COVERT -- When this card enters play, each opponent may detach up to 3 resources from their faction.
- classification notes: 
- shapes:
    - behavior.keywords [covert]
    - triggered:cardEnteredPlay(sourceIsEventCard) -> chooserSelectsTarget(opponent, {owner opponent, type resource, attached to opp faction} count 3 optional) -> forEach detach
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Ursine Assassin
- id: 3c9d8aef-10a8-4834-af0f-fb3b3e4683c8 | character | trade warlord | cost 4 | threshold rr | str 4/life 2/spd 3 | subtype warbeast
- text: TO BEAR ARMS -- COST: Pay 1. Pick a character. Destroy a restored character you control. -- EFFECT: Inflict 2 damage to the character. -- JUST UNBEARABLE: [R][R][R][R][R][R] -- COST: Pay 2. Pick a character. Destroy a restored character you control. -- EFFECT: Inflict 5 damage to the character.
- classification notes: 'restored character' = depleted:false.
- shapes:
    - activated TO BEAR ARMS: costs [payResources 1, destroy {selected sac}], targets [{vic:character},{sac:{controller self, zone play, type character, depleted false}}] -> dealDamage {vic} 2
    - activated JUST UNBEARABLE [R]x6: costs [payResources 2, destroy {selected sac}], targets [...] -> dealDamage {vic} 5
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Warbeast of Thabbash
- id: 445dfe70-c2f5-4ec9-8e44-385cb5cc24ff | character | trade warlord | cost 5 | threshold r | str 0/life 0/spd 3 | subtype warbeast
- text: This card gains 1 strength and 1 life for each [V] you control.
- classification notes: 
- shapes:
    - continuous: str+{resourceIcons controller volition}, life+{resourceIcons controller volition}
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Banana Peel
- id: 386bbf0c-3e4d-4db2-b476-70ce87b7e228 | item | trade rogue | cost 3 | threshold dd
- text: TACTICAL -- EXTRA COST: If you deployed this card during an opponent's turn you may pay 1. If you don't, terminate it. -- SLIP -- COST: Pick an attacking character. Destroy this card. -- EFFECT: Flip that card face-down under its owner's control. Draw a card. -- FLIP UP: 3 [D][D][D]
- classification notes: 
- shapes:
    - behavior.keywords [tactical]
    - onPlay.effects: if(not isActivePlayer(controller)) -> mayPay {costs:[payResources 1], effects:[], elseEffects:[terminate source]}
    - activated SLIP: costs [destroy source], targets [{atk:{zone play, type character, conditions:[inBattle role attacker]}}] -> flipFaceDown {atk}; draw 1
    - card.flipUp { cost:3, threshold:'ddd' }
- engineCapability: [active-player-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Contiguous Defalcating Machine
- id: 25ba52f8-62c9-4e2c-8daa-7e6d841f6c76 | item | trade arcanist | cost 5 | threshold oo
- text: UNIQUE CONTIGUOUS DEFALCATING MACHINE -- When a character enters play, its controller must choose one of the following: -- OPTION 1 -- Put a resource they control into its owners's hand. -- OPTION 2 -- Destroy that character. -- OPTION 3 -- Their faction loses 3 influence.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay condition cardTypeIs(eventCard, character) -> chooserSelectsOption(chooser={controllerOf eventCard}) [1: chooserSelectsTarget(that player, {controller <that>, zone play, type resource} c1) -> moveCard hand] [2: destroy {eventCard}] [3: modifyInfluence({controllerOf eventCard}, -3)]
- engineCapability: [controller-of-playerref]  (all implemented)
- metadata: {"unique":"contiguous defalcating machine","attachTo":null,"resourceProvides":null,"keywords":[]}

### Draconic Luteoderm Suit
- id: 63ad03b6-2fbb-46b0-9f86-f264cc1479fe | item | trade gearsmith | cost 4 | threshold ee | subtype gear
- text: UNIQUE DRACONIC LUTEDODERM SUIT -- The attached character gains 2 strength and 2 life. -- When any other "gear" card is deployed, you may draw a card. -- SERAPHIM FUSION -- COST: Use this only if this card is attached to a UNIQUE JO. Pay 3. Destroy this card. -- EFFECT: Search your deck for a card named "Testudine Autoframe" and put it into play. -- EQUIP -- COST: Pick a character. If it is a UNIQUE JO then X is 0, otherwise X is 2. Pay X. -- EFFECT: Attach this card to the character.
- classification notes: 
- shapes:
    - continuous: modifiers {target attachedTo, str+2, life+2}
    - triggered:cardPlayed condition and(not sourceIsEventCard, cardSubtypeIs eventCard 'gear') -> chooserSelectsOption [decline]/[draw 1]
    - activated SERAPHIM FUSION: condition uniqueIs({attachedTo},[jo]); costs [payResources 3, destroy source] -> target {zone deck, name 'Testudine Autoframe'} -> putIntoPlay(controller) + shuffleDeck
    - activated EQUIP: targets [{ch:character}], variables x=conditional(uniqueIs({ch},[jo]),0,2), costs [payResources {x}] -> attachTo(source, {ch})
- engineCapability: [card-subtype-condition, unique-designation-selector]  (all implemented)
- metadata: {"unique":"draconic lutedoderm suit","attachTo":"character","resourceProvides":null,"keywords":[]}

### Impressionistic Furball
- id: 24e987c9-c089-4ba4-a616-ff2b2fb4592a | item | trade banker | cost 1 | threshold gg | subtype gear
- text: ATTACH TO CHARACTER -- Attached character gains 2 life. -- COUGH UP: [G][G][G] -- COST: Destroy this card. -- EFFECT: Draw a card.
- classification notes: 
- shapes:
    - continuous: modifiers {target attachedTo, life+2}
    - activated COUGH UP [G]x3: costs [destroy source] -> draw 1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":"character","resourceProvides":null,"keywords":[]}

### Juice Closet
- id: f3e623c0-c080-4744-9599-eb4134c83662 | item | trade warlord | cost 2 | threshold r
- text: At the start of your turn you may pick a character. If you do, that character gains 1 strength this turn.
- classification notes: 
- shapes:
    - triggered:turnStarted(controller) -> optional pick character -> if(exists) createModifier str+1 EOT
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Pwny Bomb
- id: f3c30c8a-69ce-443b-baed-afaed7170725 | item | trade gearsmith | cost 0 | threshold e | subtype gear
- text: The attached character gains 1 strength and 1 life. -- When a Micromajig token or "horsemajig" character enters play under your control, you may attach this card to it. -- PWNED -- COST: Pick a Micromajig token or "horsemajig" character that this card is attached to. Pick a character. Destroy this card. -- EFFECT: Inflict 7 damage to the picked characters. -- MOVE -- COST: Pick a character you control. Pay 3. -- EFFECT: Attach this card to the character if you can.
- classification notes: 
- shapes:
    - continuous: modifiers {target attachedTo, str+1, life+1}
    - triggered:cardEnteredPlay condition and(eventCardControlledBy controller, or(cardNameEquals? name 'Micromajig', cardSubtypeIs eventCard 'horsemajig')) -> chooserSelectsOption [decline]/[attachTo(source, {eventCard})]
    - activated PWNED: costs [destroy source], targets [{host: <the card this is attached to>},{ch:character}] -> dealDamage 7 to host and ch
    - activated MOVE: targets [{ch:{controller self, zone play, type character}}], costs [payResources 3] -> attachTo(source, {ch})
- engineCapability: [card-subtype-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":"character","resourceProvides":null,"keywords":[]}

### Remains of Foreman Pete, the Clock Man
- id: ef8e7666-c491-4bdd-96e8-880193a5b01b | item | trade universal | cost 3 | threshold vv
- text: UNIQUE FOREMAN PETE -- CLOCK IN: [V][V][V] -- COST: Discard a staple resource. Pay 2. -- EFFECT: Draw a card. -- WORK IT: [V][V] -- COST: Pick a face-down resource you control. Pay 2. -- EFFECT: Put that card into your hand. You may play a resource. -- CLOCK OUT: [V] -- COST: Flip this card face-down under its owner's control. -- EFFECT: Detach a resource from your faction.
- classification notes: CLOCK OUT's 'COST: Flip this card face-down' modelled as the first effect (always possible, so no distinct cost needed).
- shapes:
    - activated CLOCK IN [V]x3: costs [discard 1 {staple resource}, payResources 2] -> draw 1
    - activated WORK IT [V]x2: costs [payResources 2], targets [{fd:{controller self, zone play, faceDown true, type resource}}] -> moveCard {fd} hand; chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource
    - activated CLOCK OUT [V]: effects [flipFaceDown source; detach {a resource attached to your faction}]
- engineCapability: []  (all implemented)
- metadata: {"unique":"foreman pete","attachTo":null,"resourceProvides":null,"keywords":[]}

### Rocket Lawnchair
- id: 1dd0bbbc-1202-41c2-9073-5ce87acaf67e | item | trade gearsmith | cost 4 | threshold ee
- text: TACTICAL -- NO EJECT! -- COST: Pick a character you own. Pick a character an opponent controls. Destroy this card. -- EFFECT: Destroy the characters. If either character was a member of an opponent's attacking party, destroy all characters in that party. -- FLIP UP: 4 [E][E]
- classification notes: 'that party' approximated as the current attacking party.
- shapes:
    - behavior.keywords [tactical]
    - activated NO EJECT!: costs [destroy source], targets [{mine:{owner self, type character}},{theirs:{controller opponent, type character}}] -> destroy both; if(or(inBattle {mine} attacker, inBattle {theirs} attacker)) forEach {zone play, type character, conditions:[inBattle role attacker]} destroy
    - card.flipUp { cost:4, threshold:'ee' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Runic Junker
- id: 12b25597-1514-4fc3-9a33-3b32fc436ecb | item | trade gearsmith | cost 2 | threshold eee
- text: At start of your turn you may pay 4. If you do and you control atleast 2 face-down resources, pick an opponent. That player must pick a face-down resource you control. If the face-down resource is a character or an item you may deploy it for free. (You still need to meet its threshold and satisfy its extra costs.)
- classification notes: 
- shapes:
    - triggered:turnStarted(controller) -> mayPay {costs:[payResources 4], effects:[ if(numberCompare(count{controller self, zone play, faceDown true, type resource} >= 2)) -> chooserSelectsTarget(opponent, {controller self, zone play, faceDown true} c1) -> if(faceDown real type char|item) deployFromZone(controller, {selected}) ]}
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Sharpey Pointy Lethal Army Tool
- id: c6e93f75-e05d-4dfb-a77d-c74b662a7c02 | item | trade rogue | cost 2 | threshold d | subtype gear
- text: ATTACH TO CHARACTER YOU CONTROL -- The attached character gains 2 strength. -- UNFOLD -- COST: Pay 2. Deplete the attached character. Reveal the top card of your deck. -- EFFECT: If the revealed card has a numeric cost of 5 or higher, all characters your opponents control lose 1 life. If the revealed card has a numeric cost of 0-4, destroy the attached character. If the revealed card is a resource, destroy the attached character and destroy all characters your opponents control.
- classification notes: 
- shapes:
    - continuous: modifiers {target attachedTo, str+2}
    - activated UNFOLD: costs [payResources 2, deplete {attachedTo}] -> reveal top card (display); if(cardCost {deckPosition top} >= 5) forEach {controller opponent, type character} createModifier life-1 permanent; if(and(cardCost {deckPosition top} <= 4, not cardTypeIs {deckPosition top} resource)) destroy {attachedTo}; if(cardTypeIs {deckPosition top} resource) destroy {attachedTo} + forEach {controller opponent, type character} destroy
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":"character","resourceProvides":null,"keywords":[]}

### Sticky Stealy Hand
- id: 3d8bb343-be8d-48d8-b3f2-523a3564ffeb | item | trade rogue | cost 2 | threshold dd
- text: TACTICAL -- ATTACH TO ITEM -- When this card enters play, flip a coin. If you win, take control of the attached item. If you lose, put this card into its owner's hand. -- When this card leaves play, the attached item's owner takes control of the item.
- classification notes: Coin flip inline via numberCompare(random). No triggered `variables` needed.
- shapes:
    - behavior.keywords [tactical]
    - triggered:cardEnteredPlay(sourceIsEventCard) -> if(numberCompare(random 1..2 = 1)) takeControl({attachedTo}, controller) else moveCard(source, hand)
    - triggered:cardMoved condition and(sourceIsEventCard, cardMovedFromZone play) -> takeControl({attachedTo}, {ownerOf attachedTo})
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":"item","resourceProvides":null,"keywords":[]}

### Super Shiny Caltrops of DOOM!
- id: 43b9dddc-f557-4efa-86f9-6ce9ca46a277 | item | trade warlord | cost 2 | threshold r | subtype gear
- text: When this card enters play, you may pick a character. If you do, inflict 2 damage to the character. -- If this card would be destroyed, you may pay 2. If you do, put it into play as a face-down resource under its owners's control instead. -- MOVE -- COST: Pay 2. Pick a character. -- EFFECT: Attach this card to the character if you can. (if you can't, this card remains in play) -- FLIP UP: 2 [R]
- classification notes: Not ATTACH-on-play (attaches only via MOVE) so no attachTo metadata.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(exists) dealDamage 2
    - replacement: replaces {destroy} condition sourceIsEventCard, optional, optionalCost [payResources 2] -> flipFaceDown {__candidate}
    - activated MOVE: targets [{ch:character}], costs [payResources 2] -> attachTo(source, {ch})
    - card.flipUp { cost:2, threshold:'r' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
