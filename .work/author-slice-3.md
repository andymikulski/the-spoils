# SotDE authoring slice 3 (23 cards)

### Voidal Trinket
- id: e7db74e2-02ff-4297-ac9a-860b2bd3c263 | item | trade arcanist | cost 1 | threshold oo
- text: AUGUR -- COST: Deplete this card. Choose a number for X that is 3 or less. Pick an opponent. That opponent may detach up to X resources from their faction. -- EFFECT: Look at the top X cards of your deck. You may put one of those cards on the top of your deck. Put the remaining cards on the bottom of your deck in any order.
- classification notes: Look-at-X, keep 1 on top, bottom the rest = Rosy Palmer composition.
- shapes:
    - activated AUGUR: costs [deplete source], variables x (player chosen), variableBounds x max 3 -> chooserSelectsTarget(opponent, {owner opponent, type resource, attached to faction} count {x} optional) -> forEach detach; target {controller self, zone deck, fromTop {x}} c1 optional -> moveCard(deck, position top); lookAndReorder(controller, {x}, to:bottom)
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Abandoned Testing Complex
- id: 90e8b87e-3c0f-4293-9b51-feb0919c8b18 | location | trade gearsmith | cost 4 | threshold eee | structure 6
- text: At the start of your turn, you may pay 3. If you do you may play a resource.
- classification notes: 
- shapes:
    - triggered:turnStarted(controller) -> mayPay {costs:[payResources 3], effects:[chooserSelectsTarget(controller, {zone hand} c1 optional) -> playResource]}
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Ancient and Disreputable Law Office
- id: 6283dc6d-d26b-4f08-9ded-17581481b6e6 | location | trade banker | cost 3 | threshold g | structure 3
- text: UNIQUE A & D LAW -- Characters with numeric cost 2 or less cannot attack.
- classification notes: 
- shapes:
    - continuous aura: restrictions {selector {zone play, type character, conditions:[numberCompare(cardCost(__candidate) <= 2)]}, cannotAttack}
- engineCapability: []  (all implemented)
- metadata: {"unique":"a & d law","attachTo":null,"resourceProvides":null,"keywords":[]}

### Underhanded Hang-Out
- id: 2f4973ca-ec4c-4a2d-a9a6-6b2d67dadaab | location | trade banker | cost 1 | threshold g | structure 2
- text: DIRTY DEALS -- COST: Pay 2. Pick a location you own and inflict 1 damage to it. -- EFFECT: Draw a card.
- classification notes: 
- shapes:
    - activated DIRTY DEALS: costs [payResources 2, dealDamage {selected loc} 1], targets [{loc:{owner self, zone play, type location}}] -> draw 1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Auspicious Arrival
- id: 353e341b-7e8a-4a9b-8b5e-caa53eaf3042 | tactic | trade banker | cost 2 | threshold ggg
- text: Look at the top 8 cards of your deck. You may choose a character among them with 1 strength or less and reveal it. If you do, put it into your hand. Shuffle your deck. -- FLIP UP: 3 [G]
- classification notes: 
- shapes:
    - tactic: target {controller self, zone deck, fromTop 8, type character, conditions:[statCompare strength <= 1]} c1 optional -> if(exists) moveCard hand; shuffleDeck
    - card.flipUp { cost:3, threshold:'g' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### B.A.S.E. Jump
- id: 2f5d63f6-0f6e-4af9-9732-c15f65606f96 | tactic | trade warlord | cost 3 | threshold r
- text: EXTRA COST: Pick a location. Pick a character. -- Inflict X damage to the character, where X is the location's structure. Draw a card. -- FLIP UP: 3 [R]
- classification notes: 
- shapes:
    - tactic: targets [{loc:location},{ch:character}] -> dealDamage({ch}, {stat {loc} structure}); draw 1
    - card.flipUp { cost:3, threshold:'r' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Bug Bite
- id: ccd054c5-3295-437d-b15e-012665c83059 | tactic | trade rogue | cost 1 | threshold dd
- text: EXTRA COST: Pick a character. -- Put a token on the character. Destroy it if it has at least X tokens on it, where X is its numeric cost. -- RECUR: [D][D] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game. Pick a character. -- EFFECT: Put 2 tokens on the character. Destroy it if it has at least X tokens on it, where X is its numeric cost.
- classification notes: 
- shapes:
    - tactic: targets [{ch:character}] -> addCounter {ch} token 1; if(counterCompare {ch} token >= cardCost {ch}) destroy {ch}
    - activated RECUR [D]x2: activationZone discard, costs [payResources 4, removeFromGame source], targets [{ch2:character}] -> addCounter token 2; if(...) destroy
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Clockman City Shuffle
- id: 0a841e49-928b-4a3e-b4fa-ffdb9349bcf0 | tactic | trade rogue | cost 5 | threshold ddd
- text: This turn, characters you control gain 1 strength and 1 life and characters your opponents control lose 1 strength and 1 life.
- classification notes: 
- shapes:
    - tactic: forEach {controller self, type character} createModifier str+1,life+1 EOT; forEach {controller opponent, type character} createModifier str-1,life-1 EOT
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Concentriculation
- id: c6595d11-cbd1-4731-a244-78cc20f36d19 | tactic | trade arcanist | cost 5 | threshold ooo
- text: EXTRA COST: Pick a non-resource card. -- Put the card on the top of its owner's deck. -- RECUR: [O][O][O] -- COST: Use this only if this card is in your discard pile. Pay 3. Pick a character. Remove this card from the game. -- EFFECT: Put the character into its owner's hand.
- classification notes: 
- shapes:
    - tactic: targets [{c:{zone play, conditions:[not resource]}}] -> moveCard {c} to deck position top
    - activated RECUR [O]x3: activationZone discard, costs [payResources 3, removeFromGame source], targets [{ch:character}] -> moveCard hand
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Confrontational Conflagration
- id: 25d8789e-b481-4c1d-aae5-8c3cb2d22786 | tactic | trade warlord | cost 1 | threshold r
- text: EXTRA COST: Deploy this only during your turn not during a battle. Pick a character you control. Pick a character an opponent controls. You may pick a location. -- If the picked character you control is a "dragon", X is 2 times its strength, otherwise X is its strength. Inflict X damage to each picked card. -- FLIP UP: 1 [R][R][R]
- classification notes: 'each picked card' ambiguous — leaning theirs+loc; note if it should also hit your own picked character.
- shapes:
    - tactic: condition and(isActivePlayer(controller), not battleActive); targets [{mine:{controller self, type character}},{theirs:{controller opponent, type character}},{loc:location optional}]
    - effects: bind x = conditional(cardSubtypeIs {mine} 'dragon', multiply(2, stat {mine} strength), stat {mine} strength); dealDamage {theirs} {x}; if(exists loc) dealDamage {loc} {x}  (and possibly {mine} too — 'each picked card')
    - card.flipUp { cost:1, threshold:'rrr' }
- engineCapability: [active-player-condition, battle-active-condition, card-subtype-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Contractual Execution
- id: fd6b9183-805b-44d0-a3c0-dbb0758bd4b8 | tactic | trade banker | cost 3 | threshold gg
- text: EXTRA COST: Pick a character. That character's controller picks a resource they control. Put the resource into its owners's hand. -- Flip the character face down under its owners's control.
- classification notes: 
- shapes:
    - tactic: targets [{ch:character}] -> chooserSelectsTarget({controllerOf ch}, {controller <that>, zone play, type resource} c1) -> moveCard hand; flipFaceDown {ch}
- engineCapability: [controller-of-playerref]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### EPM (Extra Powerful Magnetic) Pulse
- id: 53deaf6c-15e8-4ef6-b593-85745e2e61e8 | tactic | trade gearsmith | cost 6 | threshold ee
- text: Destroy all items and locations.
- classification notes: 
- shapes:
    - tactic: forEach {zone play, type item} destroy; forEach {zone play, type location} destroy
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Fistfight
- id: 5820f3c6-9768-4180-ba59-1afc35ea9bd7 | tactic | trade warlord | cost 1 | threshold rrr
- text: EXTRA COST: Deploy this only not during a battle. Pick a character you control. X is that character's strength. Destroy the character. Pick another character. -- Inflict X+1 damage to the character. -- FLIP UP: 3 [R]
- classification notes: 
- shapes:
    - tactic: condition not battleActive; targets [{a:{controller self, type character}},{b:{type character, conditions:[not __candidate==a]}}] -> bind x = stat {a} strength; destroy {a}; dealDamage {b} {add {x} 1}
    - card.flipUp { cost:3, threshold:'r' }
- engineCapability: [battle-active-condition]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Industrious Usage
- id: 5c7b79cb-4cf1-44e4-8729-d9a096f1dd7c | tactic | trade gearsmith | cost 4 | threshold ee
- text: EXTRA COST: Pick an item. -- Destroy the item. Put a Micromajig token into play under your control. -- FLIP UP: 2 [E][E]
- classification notes: 
- shapes:
    - tactic: targets [{it:item}] -> destroy {it}; createTokens(controller,1,Micromajig)
    - card.flipUp { cost:2, threshold:'ee' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### It's a Trap!
- id: fd9a88ec-982f-439b-9aa1-8d5db83960eb | tactic | trade gearsmith | cost 3 | threshold e
- text: EXTRA COST: Pick an item you control. Pick a character. -- Put the cards into their owner's hand. -- FLIP UP: 2 [E]
- classification notes: 
- shapes:
    - tactic: targets [{it:{controller self, type item}},{ch:character}] -> moveCard {it} hand; moveCard {ch} hand
    - card.flipUp { cost:2, threshold:'e' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Juice Sale!
- id: a5290ff5-114a-4ed7-804f-f751a1abf086 | tactic | trade warlord | cost 1 | threshold rr
- text: EXTRA COST: Pick an opponent's character with the highest strength. (If there is tie, you decide which character is picked.) -- This turn, the character cannot block. -- FLIP UP: 2 [R]
- classification notes: 
- shapes:
    - tactic: targets [{ch:{controller opponent, type character, conditions:[isExtremum strength max among {controller opponent, type character}]}}] -> grantRestriction {ch} cannotBlock EOT
    - card.flipUp { cost:2, threshold:'r' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Quotidian Transposition
- id: 5da75ce7-9ae6-484f-8bd5-ee7deeba9532 | tactic | trade arcanist | cost 0 | threshold ooo
- text: Each player picks a character they own and puts it into their hand.
- classification notes: 
- shapes:
    - tactic: forEachPlayer -> chooserSelectsTarget(controller[rebound], {owner <current>, zone play, type character} c1) -> moveCard hand
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Reluctant Reconciliation
- id: f1b6d378-94ee-487a-bf78-b529b2131c94 | tactic | trade gearsmith | cost 1 | threshold e
- text: EXTRA COST: Pick a character. -- Restore that character. This turn, it cannot attack.
- classification notes: 
- shapes:
    - tactic: targets [{ch:character}] -> restore {ch}; grantRestriction {ch} cannotAttack EOT
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### This, That, and the Other Thing
- id: 684d1547-6f13-461a-b03a-5c1cad4cd4bb | tactic | trade arcanist | cost 5 | threshold ooo
- text: EXTRA COST: Pick 3 tactics in your discard pile. -- Shuffle 1 of the tatics into your deck. Put 1 of the tatics into play under your control as a face-down resource. Put 1 of the tatics into your hand.
- classification notes: targetInSelection + selectionCount recipe from BEHAVIORS.
- shapes:
    - tactic: targets [{t:{zone discard, type tactic} count 3}] -> chooserSelectsTarget among selected t (targetInSelection) c1 -> moveCard deck + shuffleDeck; chooserSelectsTarget among remaining c1 -> putIntoPlay(faceDown); chooserSelectsTarget among remaining c1 -> moveCard hand
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Time to Retire
- id: 71389741-e470-4ab1-81b1-2629192813a2 | tactic | trade universal | cost 2 | threshold v
- text: EXTRA COST: Pick a character you control. -- You may put a resource you control into its owner's hand. Flip the character face-down under its owner's control. -- FLIP UP: 2 [V]
- classification notes: 
- shapes:
    - tactic: targets [{ch:{controller self, type character}}] -> chooserSelectsTarget(controller, {controller self, zone play, type resource} c1 optional) -> moveCard hand; flipFaceDown {ch}
    - card.flipUp { cost:2, threshold:'v' }
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Underwhelming Performance
- id: 734238ce-7a57-4fda-b9a8-86c4aef822c2 | tactic | trade arcanist | cost 3 | threshold oo
- text: EXTRA COST: Pick a character. That character's controller may detach up to 2 resources. -- This turn, the character loses 6 strength. Draw a card.
- classification notes: 
- shapes:
    - tactic: targets [{ch:character}] -> chooserSelectsTarget({controllerOf ch}, {owner <that>, type resource, attached to faction} count 2 optional) -> forEach detach; createModifier {ch} strength-6 EOT; draw 1
- engineCapability: [controller-of-playerref]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Violating Ritual
- id: ee97a193-2abc-4f68-880f-bb128a536f28 | tactic | trade arcanist | cost 3 | threshold ooo
- text: EXTRA COST: Pick an opponent. -- That opponent discards 2 cards. Draw a card.
- classification notes: 
- shapes:
    - tactic: chooserSelectsTarget(opponent, {zone hand} count 2) -> moveCard discard; draw 1
- engineCapability: []  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Words of Glory
- id: 10d5c7f3-17fe-423e-95c7-b73715b61bc6 | tactic | trade warlord | cost 7 | threshold rrrrrr
- text: EXTRA COST: Deploy this only during your turn and not during a battle. -- X is the total strength of all characters your opponents control. Inflict X-3 damage to all characters.
- classification notes: 
- shapes:
    - tactic: condition and(isActivePlayer(controller), not battleActive); bind x = sumStat({controller opponent, zone play, type character}, strength); forEach {zone play, type character} -> dealDamage {__candidate} {add {x} -3}
- engineCapability: [active-player-condition, battle-active-condition, sum-stat-expression]  (all implemented)
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
