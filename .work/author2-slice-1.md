# SotDE authoring round 2, slice 1 (18 cards)

### 6r4wny 60dy9u4rd5
- id: 8007e216-d21d-490c-ad3e-eae9677ee725 | character | trade warlord | cost 5 | threshold rr | str 3/life 5/spd 3 | subtype 31f,mercenary
- text: EXTRA COST: Pick a character you control. -- If the picked character would be dealt damage, deal damage to this card instead. If the picked character would leave play, this character leaves play in that way instead.
- classification notes: Unbounded continuous redirect of BOTH damage and leave-play from the warded character to this card, while both in play. CR §301.4-style 'leaves play the same way'. Needs the ward-redirect capability.
- shapes:
    - onPlay.targets: pick a character you control; rememberTarget 'ward'
    - continuous: damageRedirects [{from: remembered ward, to: source}]
    - replacement: any leave-play of remembered ward -> source leaves play the same way instead
- engineCapability (all implemented): [ward-redirect]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Anxious Imp
- id: 72661539-2086-49b7-a58d-b66a2ba45a30 | character | trade arcanist | cost 3 | threshold o | str 2/life 2/spd 3 | subtype familiar
- text: OBSESS -- COST: Pay 2. -- EFFECT: This turn, this card gains PROVIDES: [O][O][O] . -- [O][O][O][O][O][O]: This card gains COVERT.
- classification notes: PROVIDES gained this turn must be card-scoped (grant-provides), not the player-level grantResourceIcons. [O]x6 gate via numberCompare on resourceIcons.
- shapes:
    - activated OBSESS: costs [payResources 2] -> grantProvides(source, obsession, 3, untilEndOfTurn)
    - continuous: condition resourceIcons(controller,obsession) >= 6 -> keywords [{target:source, covert}]
- engineCapability (all implemented): [grant-provides]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Backdoor Brigand
- id: 766149f5-0021-41ca-bbc5-4dbf8484de40 | character | trade rogue | cost 3 | threshold d | str 2/life 3/spd 4 | subtype outcast
- text: EXIT STAGE RIGHT -- COST: Use this only if this card has not assigned damage this turn. Pay 1. -- EFFECT: Flip this card face-down under its owner's control. -- FLIP UP: 3 [D][D]
- classification notes: 'has not assigned damage this turn' needs the per-turn damage-history tracker. FLIP UP 3 [D][D].
- shapes:
    - activated EXIT STAGE RIGHT: condition not assignedDamageThisTurn(source); costs [payResources 1] -> flipFaceDown source
    - card.flipUp { cost:3, threshold:'dd' }
- engineCapability (all implemented): [damage-history-this-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Carnival Ringmaster
- id: fddf5886-b70a-4855-b338-422a4bad3cc3 | character | trade rogue | cost 4 | threshold ddd | str 1/life 1/spd 2 | subtype performer
- text: TACTICAL -- When this card enters play you may add it to your attacking or blocking party. All characters in that party gain 1 speed. -- When this card enters play you may pick a character. If you do, put a token on that card.
- classification notes: TACTICAL char that adds itself to a live battle. 'that party gains 1 speed' scoped via inBattle role after the add.
- shapes:
    - behavior.keywords [tactical]
    - triggered:cardEnteredPlay(sourceIsEventCard) -> addToBattle(source, choose) -> forEach character inBattle(same party) speed+1 EOT
    - triggered:cardEnteredPlay(sourceIsEventCard) -> optional pick character -> if(targetExists) addCounter token 1
- engineCapability (all implemented): [add-to-battle]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Discordant Cadencer
- id: c842afad-8ee7-4e59-bb42-f06f51bf7bf6 | character | trade warlord | cost 3 | threshold r | str 2/life 2/spd 3 | subtype soldier
- text: AGITATE -- COST: Pay 1. Lose 2 influence. -- EFFECT: This turn, this card gains " PROVIDES: [R][R][R] ". -- [R][R][R][R][R][R]: This card gains 2 strength.
- classification notes: 'Lose 2 influence' is an ability cost.
- shapes:
    - activated AGITATE: costs [payResources 1, loseInfluence 2] -> grantProvides(source, rage, 3, untilEndOfTurn)
    - continuous: resourceIcons(controller,rage) >= 6 -> str+2
- engineCapability (all implemented): [grant-provides, lose-influence-cost]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Elitistmajig
- id: 3a4918d7-7c70-4753-b070-0c6dd8799811 | character | trade gearsmith | cost 3 | threshold e | str 2/life 2/spd 3 | subtype majig
- text: CRUNCH -- COST: Destroy a Micromajig token you control. -- EFFECT: This turn, this card gains PROVIDES: [E][E][E] . -- [E][E][E][E][E][E]: This card gains 2 strength and 2 life.
- classification notes: 
- shapes:
    - activated CRUNCH: targets [{tok: {controller self, zone play, name 'Micromajig'} count 1}], costs [destroy {selected tok}] -> grantProvides(source, elitism, 3, untilEndOfTurn)
    - continuous: resourceIcons(controller,elitism) >= 6 -> str+2,life+2
- engineCapability (all implemented): [grant-provides]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Enlightened Mau
- id: 3e70504b-36ea-4600-afc5-70254e5dc13c | character | trade banker | cost 3 | threshold gg | str 3/life 2/spd 3 | subtype mau,pacifist
- text: All damage assigned to this card by characters with items attached to them is reduced to 0. -- TRANSCEND -- COST: Pay 5. -- EFFECT: This turn, this card gains COVERT.
- classification notes: 'damage assigned to this card BY characters with items attached' needs a source-side selector on damageModifiers.
- shapes:
    - continuous: damageModifiers [{selector:{type character} bind target=source, sourceSelector:{characters with an item attached}, delta:-999 (reduce to 0)}]
    - activated TRANSCEND: costs [payResources 5] -> grantKeyword(source, covert, untilEndOfTurn)
- engineCapability (all implemented): [damage-modifier-by-source]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Eustace Padamose-Gristwalter
- id: 3f574bdd-e7b7-4757-a955-2a33d19a250d | character | trade banker | cost 4 | threshold ggg | str 1/life 3/spd 3 | subtype eustace,blade of questionable morality
- text: UNIQUE EUSTACE -- FUTURE IMPLICATIONS -- COST: Pay 2. Your faction loses 1 influence. -- EFFECT: Draw a card. -- PAST TREPIDATIONS -- COST: Discard a card. -- EFFECT: This turn, this card gains 1 life. If the discarded card was a resource, this card also gains 1 strength this turn.
- classification notes: The discard cost's selected id is read back for the 'if the discarded card was a resource' branch.
- shapes:
    - activated FUTURE IMPLICATIONS: costs [payResources 2, loseInfluence 1] -> draw 1
    - activated PAST TREPIDATIONS: costs [discard 1 {zone hand}] -> createModifier life+1 EOT; if(cardTypeIs {discarded} resource) createModifier str+1 EOT
- engineCapability (all implemented): [lose-influence-cost]
- metadata: {"unique":"eustace","attachTo":null,"resourceProvides":null,"keywords":[]}

### Gang Weapon Dealer
- id: 53f1700e-6445-4b87-bf00-c69f88c6a278 | character | trade rogue | cost 5 | threshold dd | str 1/life 3/spd 4 | subtype gang member
- text: This card enters play with 2 tokens on it. -- This card gains 1 strength for each token on it. -- DELIVERY -- COST: Remove a token from this card. Deplete this card. Reveal a face-down "gear" card you control. -- EFFECT: You may deploy it even if you cannot meet its threshold. If its numeric cost is 4 or less, you may deploy it for free.
- classification notes: Two clauses: (1) may deploy ignoring threshold [paying cost], (2) if cost<=4 deploy for free. deployFromZone always frees the numeric cost today; needs a conditional-free toggle (or model as chooserSelectsOption). Added cap deploy-from-zone-conditional-free.
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> addCounter token 2
    - continuous: str+{counter token}
    - activated DELIVERY: costs [removeCounter token 1, deplete source] + targets [{g:{controller self, zone play, faceDown true, subtype 'gear'} count 1}] -> deployFromZone(controller, {g}, ignoreThreshold:true); if(cardCost {g} <= 4) it's for free
- engineCapability (all implemented): [deploy-from-zone-conditional-free]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Gigantitect's Giant Giant
- id: 2a13a6f0-29b9-4f5d-a155-2b6bdea55257 | character | trade gearsmith | cost 9 | threshold eeee | str 9/life 9/spd 3 | subtype warmachine
- text: This card cannot be picked by non-item cards or non-item abilities. -- Opponents cannot take control of this card.
- classification notes: 'cannot be picked by non-item cards or non-item abilities' = scoped untargetable. 'Opponents cannot take control' = takeControl skip.
- shapes:
    - continuous: restrictions [{target:source, cannotBePicked, by:'nonItemSource'}]
    - continuous: flag cannotBeTakenControl (by opponents)
- engineCapability (all implemented): [untargetable, cannot-take-control]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Goldmau Sacks Representative
- id: 94a47bcb-c174-47a9-a293-8183632b2fac | character | trade banker | cost 3 | threshold g | str 2/life 2/spd 3 | subtype mau,employee
- text: RAISE CAPITAL -- COST: Pay 1. Discard a card. -- EFFECT: This turn, this card gains PROVIDES: [G][G][G] . -- INVEST: [G][G][G][G][G][G] -- COST: Pay 2. -- EFFECT: Search your deck for a resource and reveal it. Put it into your hand.
- classification notes: 
- shapes:
    - activated RAISE CAPITAL: costs [payResources 1, discard 1] -> grantProvides(source, greed, 3, untilEndOfTurn)
    - activated INVEST [G]x6: costs [payResources 2] + target {zone deck, type resource} -> moveCard hand + shuffleDeck
- engineCapability (all implemented): [grant-provides]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Jo Ciendeilio, M07h3r 0f 1337
- id: f910cad2-4579-461a-ba39-6f4c322b979d | character | trade gearsmith | cost 5 | threshold eeee | str 1/life 2/spd 3 | subtype jo,blade of questionable morality
- text: UNIQUE JO -- Each character you control gains: -- "RESEARCH -- COST: Use this only if this card has been in play since the start of the turn. Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 1."
- classification notes: grantedAbilities only wires triggered bodies today; needs granted-activated. 'reduce the next numeric cost you pay' mapped to reduceNextCost (next card deploy).
- shapes:
    - continuous.grantedAbilities [{selector {controller self, zone play, type character}, abilities:[{id 'research', type 'activated', condition inPlaySinceTurnStart(source), costs [deplete source], effects [reduceNextCost(controller,1)]}]}]
- engineCapability (all implemented): [granted-activated-ability, in-play-since-turn-start-condition]
- metadata: {"unique":"jo","attachTo":null,"resourceProvides":null,"keywords":[]}

### Man Shark
- id: efc19e34-03c2-4673-a5da-9d1f19af2409 | character | trade arcanist | cost 3 | threshold oo | str 0/life 0/spd 3 | subtype lurker
- text: This card gains 1 strength and 1 life for each face-down resource each opponent controls. -- FOLLOW SUIT -- COST: Pay 3. Pick an opponent. -- EFFECT: That player puts a card from their hand face-down as a resource under their control.
- classification notes: playResource needs to resolve under the opponent, not the ability's controller.
- shapes:
    - continuous: str+{count {controller opponent, zone play, faceDown true}}, life same
    - activated FOLLOW SUIT: costs [payResources 3] -> chooserSelectsTarget(opponent, {controller opponent, zone hand} count 1) -> playResource({selected}, faceDown true, player: that opponent)
- engineCapability (all implemented): [play-resource-as-player]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Martial Arts Wannabe
- id: 53598621-abf6-4b9f-bc94-6c70bd77cb10 | character | trade rogue | cost 1 | threshold dd | str 1/life 1/spd 3 | subtype martial artist
- text: While you control more characters than any opponent, this card cannot be picked.
- classification notes: 
- shapes:
    - continuous: condition numberCompare(count{controller self,type character} > count{controller opponent,type character}) -> restrictions [{target:source, cannotBePicked}]
- engineCapability (all implemented): [untargetable]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Monstrous Lassitude
- id: 99ed6205-1f9e-4d62-a1ae-f9038449db17 | character | trade arcanist | cost 2 | threshold oo | str 4/life 4/spd 3 | subtype monstrosity
- text: When this card comes into play, on your next turn, skip your faction's RESTORE RULE. -- [V][V][V][V]: This card loses all other rules text.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> skipRestoreRule(controller, 1)
    - continuous: condition resourceIcons(controller,volition) >= 4 -> suppressAllAbilities {target:source}
- engineCapability (all implemented): [skip-restore-rule, lose-rules-text]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Numba 1 Stunna!
- id: 6a78db5e-1ae4-4a93-95ed-d93fac077196 | character | trade rogue | cost 3 | threshold d | str 1/life 4/spd 3 | subtype grifter
- text: TACTICAL -- When this card inflicts damage to a character, that character does not restore during its controller's next RESTORE RULE. -- FLIP UP: 3 [D][D]
- classification notes: One-shot restore skip (setRestoreLock persists too long). FLIP UP 3 [D][D].
- shapes:
    - behavior.keywords [tactical]
    - triggered:damageDealt condition and(sourceIsDamageSource, cardTypeIs eventCard character) -> skipNextRestore {eventCard}
    - card.flipUp { cost:3, threshold:'dd' }
- engineCapability (all implemented): [skip-next-restore]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Opportunistic Pirate
- id: 81f3e9be-87fd-4626-9206-c54b6d7be32e | character | trade rogue | cost 7 | threshold dd | str 4/life 1/spd 5 | subtype pirate
- text: TACTICAL -- EXTRA COST: You may remove up to 4 cards in an opponent's discard pile from the game. If you do, reduce this card's numeric cost by the number of cards removed.
- classification notes: 'reduce this card's numeric cost by the number of cards removed' — needs onPlay.costAdjust.
- shapes:
    - behavior.keywords [tactical]
    - onPlay.targets [{rem:{owner opponent, zone discard} count 4 optional}]; onPlay.costs [sacrificeSelected rem removeFromGame]; onPlay.costAdjust: -{selectionCount rem}
- engineCapability (all implemented): [onplay-cost-adjust]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Parkour Hoodlum
- id: f6404aff-0a09-46f8-b146-97f746546ff4 | character | trade rogue | cost 3 | threshold dd | str 3/life 1/spd 4 | subtype daredevil
- text: While this card is in your hand and there is a location in play, this card gains tactical. -- This card ignores all rules text on locations. (this card cannot be picked by locations and any effects from locations do not affect this card.)
- classification notes: 'ignores all rules text on locations' — the can't-be-picked-by-locations half maps to scoped untargetable; the 'location effects don't affect this card' half is out of scope (author the tactical-in-hand + untargetable, gap the rest).
- shapes:
    - continuous(activeZone hand): condition numberCompare(count{zone play, type location} >= 1) -> keywords [{target:source, tactical}]
    - continuous: restrictions [{target:source, cannotBePicked, by:'locationSource'}] + immune to location abilities
- engineCapability (all implemented): [continuous-from-hand, untargetable, dynamic-tactical-honored]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
