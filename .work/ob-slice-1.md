# Open Beta — classification slice 1  (arcanist + warlord, 33 cards)

Read `.work/OB-BRIEF.md` first. Produce `.work/classify-ob-1.json` (and `.work/caps-ob-1.json` if you proposed any capability NOT in the brief).

---

### Arcana Department
id: bcac170a-c55d-4c35-a3a3-b7d167445e5b
location · arcanist · cost 3 · threshold "ooo" | struct 5

When an attacking or blocking party is formed, it must have an even number of members.

### Ashes of Zenobia
id: b3c323b0-c7ea-4970-a286-92df7d2fe2f3
item · arcanist · cost 7 · threshold "oooo"

UNIQUE ASHES OF ZENOBIA
At the start of your turn, draw a card.
NULLIFY
COST: Pay 5.
EFFECT: Each player puts a character they control into its owner's hand.

### Degenerate Molestation
id: f77f9b48-ebfb-4f8f-a32d-46a0309da781
tactic · arcanist · cost 10 · threshold "oooo"

EXTRA COST: Your opponents cannot respond to this card. Pick an opponent.
That player discards a card. You may deploy a non-resource card with numeric cost X or less for free, where X is the numeric cost of the discarded card. (You still need to meet its threshold and satisfy its extra costs.) Repeat this card's effect until that player has no cards in their hand.

### Ecto-Distillation
id: 37f34e7c-dbb2-4393-ad6a-bac2a3571ba9
tactic · arcanist · cost 4 · threshold "ooo"

EXTRA COST: Name a card.
Search your deck for any number of copies of the card and reveal them. Put 1 into your hand and the rest into your discard pile. An opponent may search your deck for any number of copies of the card. If they do, put them into your discard pile.

### Insidious Ecto-Manipulator
id: c46cdf47-bad8-411c-a89f-387d69c1e115
character · arcanist · cost 4 · threshold "oo" | 2/2 spd3 | ecto-manipulator

COVERT
At the start of your turn, you may pick a non-resource card you control. If you do, put a token on it.

### Knobby Stave
id: bb153366-ff1b-44f8-8e82-f005d31120a2
item · arcanist · cost 0 · threshold "oo"

This card enters play with 2 tokens on it.
DISRUPT
COST: Remove 2 tokens from this card.
EFFECT: An opponent discards a card.

### Lugubrian Octopod
id: 9637226d-3115-48cd-bf92-b6946d7eafed
character · arcanist · cost 4 · threshold "oooo" | 1/1 spd1 | lurker

COVERT
When this card inflicts damage to a faction, that faction's controller discards 2 cards.

### Master Ritualist
id: fbbffe5f-fa1f-43b7-bd89-264a17a09cb3
character · arcanist · cost 9 · threshold "oo" | 1/1 spd3 | ritualist

QUOTIDIAN INSTRUCTION
COST: Deplete this card.
EFFECT: Search your deck for a tactic and reveal it. Put it into your hand.

### Nearby Serpent
id: 9b13c156-b7f9-4678-93ff-062a78e3bc5a
character · arcanist · cost 3 · threshold "ooo" | 2/1 spd1 | lurker

COVERT
When this card enters play, look at up to the top 5 cards of any one deck. Put them back in any order.

### Quotidian Misfire
id: ea372d50-f915-41fc-b170-267e0e430132
tactic · arcanist · cost 2 · threshold "oo"

This turn, if a card would be put into a player's hand, put it into their discard pile instead.

### Ritual of the Shattering Teeth
id: a9d3f161-920e-4d8c-aa3d-9b1174f2fb6a
tactic · arcanist · cost 0 · threshold "ooo"

EXTRA COST: Choose a number for X. Pay X+X.
Look at an opponent's hand and choose X or fewer cards in it. That player discards those cards.

### Skimping Ecto-Manipulator
id: 246e090f-0e1b-47fb-8ee1-d8bce0c865f6
character · arcanist · cost 2 · threshold "o" | 1/1 spd3 | ecto-manipulator

ENERGIZE
COST: Deplete this card. Pick a non-resource card you control.
EFFECT: Put a token on the card.

### Spastic Tentacles
id: 9b955719-5c5a-4401-8a40-d41c7390829e
character · arcanist · cost 3 · threshold "oo" | 2/2 spd3 | lurker

When this card enters play, each player puts a resource they control into its owner's hand.

### Voidal Nullification Chamber
id: d8b3e45e-33a3-4604-ab15-f4fa79418127
location · arcanist · cost 4 · threshold "ooo" | struct 2

At the start of your turn, you may put a token on this card.
ENERGIZE
COST: Pay 2.
EFFECT: Put a token on this card.
DISSOLVE
COST: Use this only if there are an even number of characters in play. Remove 4 tokens from this card. Pick a character.
EFFECT: Destroy the character.

### Voidal Poisoning
id: fed9a0cc-cd8d-4633-ba92-d05a94e6acda
tactic · arcanist · cost 3 · threshold "ooo"

You may remove any number of tokens from cards you control. Use the tokens to generate the following effects any number of times:
1 TOKEN: Pick a character. Inflict 1 damage to it.
2 TOKENS: Draw a card.
2 TOKENS: An opponent discards a card.
3 TOKENS: Search your deck for a card and put it into your hand.

### Voidal Replication
id: b9e94612-3cbd-44ff-9aac-a553a49c0955
tactic · arcanist · cost 3 · threshold "ooo"

EXTRA COST: Your opponents cannot respond to this card. Deploy this only if a tactic has been deployed this turn.
Duplicate the last tactic deployed this turn.

### Zenobia's Spyglass
id: 50279c47-609a-444f-89c9-492d97711e1e
item · arcanist · cost 0 · threshold "o"

FORESIGHT
COST: Choose a number for X. Pay X.
EFFECT: Look at up to the top X+X cards of your deck. Put them back in any order.

### Bask Bile
id: 50782d20-e33e-4e94-9f96-43e6b575c4c1
tactic · warlord · cost 7 · threshold "rr"

EXTRA COST: Pick a character or faction.
Inflict 5 damage to the character or faction.

### Crazed Deputy
id: 0739c1ee-433e-4103-903f-0405c7aee707
character · warlord · cost 1 · threshold "r" | 1/1 spd3 | tyrant

When this card is blocked, it gains 2 strength and 2 life this turn.

### Dragon Catheter
id: 2fcbb91a-300a-4efb-b045-1de22cb5ca2d
item · warlord · cost 3 · threshold "rr"

At the start of your turn, put a token on the character with the highest strength. If there is a tie, you decide which character gets the token.
All characters gain 1 strength for each token on them.

### Dragon Rider
id: f1baed39-da6d-4ef7-ae62-de3a84b2c159
character · warlord · cost 5 · threshold "rr" | 3/3 spd3 | rider

This card gains 1 strength and 1 life for each dragon card you control.

### Dragon Tank
id: e055ac0a-49d8-4bb0-914b-b039336c5e97
character · warlord · cost 12 · threshold "rrrrr" | 10/10 spd4 | dragon

At the start of your turn, you may pick a character an opponent controls. If you do, destroy it. Otherwise, destroy this card.

### Dragon's Quarters
id: 77196b4c-63df-4c4a-a016-c7f41217c1c8
location · warlord · cost 2 · threshold "rrr" | struct 4

At the start of your turn, you may pick a character. If you do, this card inflicts X+1 damage to it, where X is the number of dragon cards you control.

### Flaming Barduse
id: 6e28ba40-77e6-471f-9872-ec49f0a8e4e8
character · warlord · cost 3 · threshold "rr" | 1/1 spd2 | dragon

EXTRA COST: You may pick 2 or fewer characters.
When this card enters play, if you picked characters as part of its cost, inflict up to 2 damage divided however you want to those characters.

### Gruesome Trophies
id: 03f31f27-dfd2-4802-acd0-340f65683e89
item · warlord · cost 6 · threshold "r"

At the start of your turn, you may pick a character. If you do, deplete it.

### Humiliating Torture Apparatus
id: 30012fd1-7785-4090-8787-ae61fc48f2dd
item · warlord · cost 4 · threshold "rrr"

When a card is depleted, that card's controller's faction loses 1 influence. (Resources don't deplete when used; they attach to your faction.)

### Rabid Sarume
id: 06dceb26-b7b7-49c4-b66c-9fd1b93ef09a
character · warlord · cost 5 · threshold "rrr" | 4/2 spd3 | dragon

When this card enters play, inflict 1 damage to all your opponent's characters.

### Reckless Challenger
id: 93e4cad7-05bb-4273-acdd-61af6f0f7072
character · warlord · cost 4 · threshold "r" | 7/1 spd3 | fighter

At the end of your turn, if this card started the turn under your control and did not attack this turn, destroy it.

### Reveille Tower
id: 6dcca61c-61da-4e12-957a-bd2c073d1646
location · warlord · cost 2 · threshold "rrrr" | struct 5

All your characters gain 1 strength.

### Rudo Mangod
id: 51827cec-b647-4048-bf85-e6f84a66ae17
character · warlord · cost 5 · threshold "rrr" | 4/3 spd3 | fighter

UNIQUE RUDOLPHUS
PUNCH
COST: Pay 2. Deplete this card. Pick a character. X is its strength. Y is this card's strength.
EFFECT: Inflict X damage to this card. Inflict Y damage to the character.

### Shriever Attack
id: da97b625-3ba0-4b07-bddd-f5239b29f5a2
tactic · warlord · cost 4 · threshold "rr"

Inflict 2 damage to all characters.

### Siege Machine
id: 5c02a5f8-543e-456b-8ee2-075fd1f6bff9
item · warlord · cost 0 · threshold "rrrr"

BATTERING RAM
COST: Pay 2. Destroy a resource you control.
EFFECT: An opponent's faction loses 1 influence.

### Tactician Vacation
id: 5ca25182-e910-4f21-97d0-b30298e7d4af
tactic · warlord · cost 4 · threshold "r"

EXTRA COST: Your opponents cannot respond to this card.
If you deployed this card in response to a tactic, terminate the tactic. This turn, tactics cannot be deployed.
