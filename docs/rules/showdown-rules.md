# Showdown Rules

Transcribed verbatim from the printed rules insert card
(`source/showdown_rules.jpg`), followed by the printed text of the two
Showdown faction cards (Seed 3, rarity "E-SLE"). Atom ids (`SD n`,
`SD-EA n`, `SD-SLE n`) are stable and are cited from `RULES.md` and the
rules test suite (`data/rule-tests/source/multiplayer.txt`).

## Verbatim text

> **Overview** – The Showdown style of play puts you in the role of game
> designer. Your goal is to create two decks for a multi-player game with
> your friends. One player takes on the role of a Villain who will face
> multiple Hero opponents.
>
> **The Villain Deck** – The Villain uses The Evil Alliance faction and a
> Villain Deck. This deck should be designed with this style of game play in
> mind. It must follow all normal Constructed deck rules.
>
> **The Hero Deck** – The Heroes have access to the Hero Deck through various
> effects. It should contain several powerful Characters, Tactics, and
> anything else you'd like to add to make things interesting. We recommend a
> Sword of Great Justice theme, but you should experiment with designs of
> your own. It's important to balance the cards in the two decks so that you
> and your friends all have a good time playing together and neither deck is
> too dominant.
>
> **Slightly Less Evil Alliance** – The Heroes may use whatever faction they
> choose for their individual deck. However, they all have access to the
> Slightly Less Evil Alliance faction as well.
>
> **Allegiance Cards** – Before the game starts, each Hero is given an
> Allegiance card at random, face-down. It determines their hidden loyalty.
> Usually it's the Heroes versus the Villain, but occasionally a Hero may be
> secretly loyal to the Villain's side. The Villain may look at Allegiance
> cards at any time.
>
> **Claiming Hero Cards** – If an effect instructs a player to claim a Hero
> card, they put that card into play under their control. If it's a tactic,
> that player plays it for free if they can *(ignoring threshold)*. Hero
> cards are removed from the game when they leave play, or when they are done
> resolving *(or if they cannot be played)*.
>
> **The Temptation Pile** – The Temptation Pile is a group of cards that stay
> face-up on the table. Certain effects manipulate this pile.
>
> **Attacking** – Heroes can attack each other if they choose to do so.
>
> **Defining Your Opponent** – If you are the Villain, and a card refers to
> your opponent, or both players, select one of the Heroes as your opponent
> for the current block of rules text. If you are a Hero, the Villain is your
> opponent. However, if you have a revealed Allegiance card that shows your
> loyalty is to the Villain, then your opponent must be one of the other
> Heroes.
>
> *Questions? Check out the Comprehensive Rules at www.thespoils.com/rules,
> or ask about it in our forums at www.thespoils.com/forums.*

## Faction cards (printed text, from `data/cards/seed-3.json`)

### The Evil Alliance (`9dc309f4-d43f-4515-841e-ed982ce026e7`)

> INFLUENCE = 15+(10*X)
> X is the number of opponents you have at the start of the game. *(You start
> with 15 + 10 times X influence.)*
> **STARTING RESOURCES** — Any 1+X staple resources
> **STARTING DRAW** — 7 going first, 8 going second
> **RESTORE RULE** — At the start of your turn, restore all your depleted
> cards and detach all resources from your faction.
> **DEVELOP RULE** — At the start of your turn, draw a card or play a
> resource. Repeat this X-1 times.
> **DRAW** — COST: Pay 3. EFFECT: Draw a card.
> **RESOURCE** — COST: Pay 3. EFFECT: Play a resource.
> **ENTICEMENT** — COST: Use this only during your turn, and only once per
> turn. EFFECT: Draw X-1 cards. Play a resource. Put the top card of the Hero
> deck into the Temptation Pile.
> **DARING GAMBIT** — If a Hero inflicts at least 7 damage to another Hero
> this turn, the damaging Hero claims the entire Temptation Pile.
> **OMNIPOTENCE** — You automatically meet all thresholds, even if you don't
> control the proper resource icons.
> *(See the included Showdown rules card for more details.)*

### Slightly Less Evil Alliance (`089a2d63-c9b9-4ad7-8c51-1d0d79a0dfbb`), subtitle "(of Justice)"

> All Heroes can use abilities on this card.
> **GIVE IN TO TEMPTATION** — COST: Use this only during your turn and only
> once per turn. Pay 2. Pick a character another Hero controls. EFFECT: The
> Villain takes control of the character. Claim one card in the Temptation
> Pile.
> **SPRING FORTH MY BURLY PROTECTOR!** — COST: Pay 6. EFFECT: Reveal the top
> card of the Hero deck and claim it.
> **TEAMWORK** — COST: Pay 2. Pick a card you control. Choose another player.
> EFFECT: The player takes control of the card.
> **YOUR TRUE COLORS ARE REVEALED** — At the start of the Villain's turn, put
> a token on this card. If there are 7 tokens on this card, all Heroes turn
> their Allegiance cards face-up.
> *(See the included Showdown rules card for more details.)*

## Atoms

### Rules card

- **SD 1** — One player is the Villain; every other player is a Hero.
- **SD 2** — The Villain uses The Evil Alliance faction and a Villain Deck
  that follows all normal Constructed deck rules.
- **SD 3** — There is a single shared Hero Deck. Heroes access it only
  through effects (it is not any player's deck).
- **SD 4** — Each Hero uses a faction of their choice for their own deck.
- **SD 5** — Every Hero also has access to the Slightly Less Evil Alliance
  faction (a shared faction, in addition to their own).
- **SD 6** — Before the game starts, each Hero is dealt one Allegiance card at
  random, face-down. It determines that Hero's hidden loyalty (to the Heroes,
  or secretly to the Villain).
- **SD 7** — The Villain may look at every Allegiance card at any time.
- **SD 8** — To claim a Hero card: a non-tactic is put into play under the
  claiming player's control.
- **SD 9** — To claim a Hero tactic: the claiming player plays it for free if
  they can, ignoring threshold.
- **SD 10** — A Hero card is removed from the game when it leaves play, when
  it is done resolving, or if it cannot be played.
- **SD 11** — The Temptation Pile is a group of face-up cards on the table,
  manipulated by certain effects.
- **SD 12** — Heroes may attack each other.
- **SD 13** — The Villain's opponent: when a card refers to "your opponent"
  or "both players", the Villain selects one Hero as opponent for the current
  block of rules text.
- **SD 14** — A Hero's opponent is the Villain.
- **SD 15** — A Hero whose revealed Allegiance card shows loyalty to the
  Villain must select one of the other Heroes as opponent.

### The Evil Alliance

- **SD-EA 1** — X is the number of opponents the Villain has at the start of
  the game.
- **SD-EA 2** — Starting influence is 15 + 10·X.
- **SD-EA 3** — Starting resources: any 1+X staple resources.
- **SD-EA 4** — Starting draw: 7 going first, 8 going second.
- **SD-EA 5** — Restore rule: at the start of your turn, restore all your
  depleted cards and detach all resources from your faction.
- **SD-EA 6** — Develop rule: at the start of your turn, draw a card or play
  a resource; repeat X-1 times (X develop choices in total).
- **SD-EA 7** — DRAW: pay 3, draw a card.
- **SD-EA 8** — RESOURCE: pay 3, play a resource.
- **SD-EA 9** — ENTICEMENT: only during your turn, once per turn; draw X-1
  cards, play a resource, put the top card of the Hero Deck into the
  Temptation Pile.
- **SD-EA 10** — DARING GAMBIT: if a Hero inflicts at least 7 damage to
  another Hero in a turn, the damaging Hero claims the entire Temptation
  Pile.
- **SD-EA 11** — OMNIPOTENCE: the Villain automatically meets all
  thresholds.

### Slightly Less Evil Alliance

- **SD-SLE 1** — Every Hero can use the abilities on this card.
- **SD-SLE 2** — GIVE IN TO TEMPTATION: only during your turn, once per turn;
  pay 2 and pick a character another Hero controls; the Villain takes control
  of it, and you claim one card in the Temptation Pile.
- **SD-SLE 3** — SPRING FORTH MY BURLY PROTECTOR!: pay 6; reveal the top card
  of the Hero Deck and claim it.
- **SD-SLE 4** — TEAMWORK: pay 2, pick a card you control, choose another
  player; that player takes control of the card.
- **SD-SLE 5** — YOUR TRUE COLORS ARE REVEALED: at the start of the Villain's
  turn, put a token on this card; at 7 tokens, all Heroes turn their
  Allegiance cards face-up.

## Unspecified by any source (resolved as engine-derived; see `docs/MULTIPLAYER-PLAN.md`)

- The composition of the Allegiance deck (how many Villain-loyal cards).
- Win conditions and elimination.
- Whether Heroes may block for one another.
- Whose turn-scoped limits apply to the shared Slightly Less Evil Alliance
  ("once per turn" is tracked per activating Hero).
