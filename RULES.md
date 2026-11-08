# The Spoils — Rules Reference

This document is the reference against which `src/engine` is tested for
correctness. It describes **the game's rules**, independent of how the
engine happens to implement them today. When a test fails, the question to
ask is "does the engine match this document?" — not "does the engine match
itself?"

## Sources

- **The Spoils™ Comprehensive Rules Reference, v2.5** (last updated
  2016‑05‑19), Tenacious Games — the authoritative rules text. Copy in
  `docs/Comprehensive-Rules-2.5.pdf`. Cited below as **(CR §NNN)** using its
  own numbered sections. Where anything in this file conflicts with the CR,
  **the CR wins** and this file is wrong and should be fixed.
- **The Spoils USA™ Rules FAQ, v2.0**, Tenacious Games — judge-facing
  clarifications of common interactions. Copy in
  `docs/The-Spoils-Rules-FAQ-2.0.pdf`. Cited as **(FAQ)**.
- `data/cards/` — the real card database (every printing of every set). Used to verify
  and fill in mechanics the rules documents leave implicit (keyword names,
  ability shapes). Where a claim was cross-checked against real printed card
  text it is marked **(card-verified)**.
- `src/engine` itself, where a rule's current *implementation* resolves an
  ambiguity the source material leaves open, or where the note describes an
  engine-internal representation (a `pendingChoice` kind, a `GameState`
  field) rather than a game rule. Marked **(engine-derived)**. An
  engine-derived note is not a rule — if it contradicts the CR it is a bug.
- `data/rule-tests/rulings.md` — the project's rulings on questions the CR
  and FAQ leave open, numbered Q1–Q53. Cited as **(ruling Qn)** or
  **(user ruling Qn, date)**; the ruling's substance is restated where it is
  cited. Questions still awaiting a ruling are listed in
  `data/rule-tests/QUESTIONS.md`.

**Most Important Rule (CR §101.1):** if a card's text directly contradicts
these rules, the card wins.

Anything not covered by these sources should be treated as undecided —
flag it rather than guessing.

## 1. Objective

**(CR §102)** The object of the game is to reduce your opponent's faction's
influence to 0. The rule is phrased as a *loss* condition: **if at any time
a faction's influence is 0, that faction's owner immediately loses.** The
other player then wins.

- **(CR §102.2 / §306.4)** If every player still in the game loses at the
  same time, the game is a **draw** between them. **(user ruling RQ-r11-2,
  2026-11-07)** "At the same time" means within one *unit*: one resolving
  card or ability's own effects, one triggered ability's own effects, or one
  batch of simultaneous battle damage. A triggered ability set off while a
  unit resolves is its own, later unit, even though the engine runs it in the
  middle of that resolution. The game is decided by the first unit in which
  any faction reached 0, when that unit ends: every player who reached 0
  within it loses together (all of them: a draw; one: the other player wins),
  and losses in any other unit do not count, because the game was already
  over. A tactic that takes P2 to 0 and a trigger it sets off that takes P1 to
  0: P1 wins. Effect 1 takes P2 to 0, a trigger runs, effect 2 takes P1 to 0:
  a draw. This holds however an ability is written (two influence effects,
  `forEachPlayer`, `forEach` over the factions) and whichever faction fell
  first. **(user ruling RQ-r11-4, 2026-11-07)** A player who reached 0 inside
  the unit loses when it ends even if a later effect of the unit raises their
  influence again: a faction at 0 gets no chance to recover. Costs are not part
  of a resolution: a cost that takes your faction to 0 loses at once.
- **(CR §102.1a / §306.2)** Running out of cards in your deck does **not**
  lose you the game — you simply fail to draw the cards you can't. *Trickster's
  Globe* overrides this while it is in play (CR §101.1; §12 Ungodly Mess
  additions).
- **(CR §408.3 / §408.3b)** Influence lost through a "loses N influence"
  effect is **not** damage: nothing that modifies or triggers off *damage*
  interacts with it. Combat damage to a faction is different — see §8.
- **(CR §202.9 / §402.9)** A faction is not affected by an effect unless the
  effect specifically says it applies to factions; in particular a faction
  cannot be *picked* unless an effect explicitly picks a faction
  **(FAQ:** *Quotidian Assassination* cannot pick a faction; *Bask Bile*
  can**)**.

**(engine-derived)** Surfaced as `GameState.winner` / `GameFlowView.winner`
(`PlayerId | "draw"`), set by the same continuous check as everything else
in §11; `GameFlowView.mode` becomes `"gameOver"`. Once set, `perform()`
rejects anything that would start a new action but still lets whatever was
already in flight (an open response window, an in-progress battle) drain to
a clean stop, since a lethal blow is often struck mid-battle-resolution.

## 2. Game areas (zones)

**(CR §403)** The game areas are: Deck, Hand, Being Deployed, In Play,
Discard Pile, Out of Game, and Void. The engine's `Zone` values map to them:

| Zone (`Zone`) | CR area | Meaning |
|---|---|---|
| `deck` | Deck (CR §403.1) | The player's draw pile. Hidden, ordered. No one may look through it or shuffle it unless an effect says so. Searched decks are shuffled afterward (CR §312.1). |
| `hand` | Hand (CR §403.2) | Cards you have access to, hidden from the opponent. No hand-size limit (CR §403.2b). |
| `deploying` | Being Deployed (CR §403.3) | Where a non-resource card sits after you play it from hand, cost paid, while the opponent may respond, until it resolves. Exists so responses can be raised against it before it lands. |
| `play` | In Play (CR §403.4) | Characters, items, locations, and the faction card live here while active. Resources (face-up or face-down) also live here, attached to the controller's faction. |
| `discard` | Discard Pile (CR §403.5) | Destroyed permanents (CR §304.1) and resolved tactics (CR §205.2) land here, face-up. Order need not be maintained (CR §403.5b). |
| `removed` | Out of Game (CR §403.6) | "Removed from the game" — the card is set aside face-up for the rest of the game. Nothing in the effect vocabulary moves a card back out, by design. Reached via `removeFromGame`. |
| `void` **(card-verified)** | Void (CR §403.7) | A distinct set-aside zone. A card is sent there face-up or face-down depending on the effect (CR §403.7a). Cards return from the void only via effects that explicitly reference it (e.g. *Eldridge Gosche, Godstealer*, *Deity Delimitation Device*). **(CR §403.7b)** You may not pick or choose a face-down card in the void unless an effect specifically picks/chooses a face-down card in the void. Ordinary destruction goes to `discard`, never the void. |

**Damage / depletion are In-Play-only.** **(CR §408.9)** When a card changes
game areas, all damage it has received is reduced to 0. **(CR §409.2)**
tokens on it disappear. Depletion likewise has no meaning outside `play`.
So any card leaving `play` for any reason (bounced to hand, discarded, put
in the void, removed) sheds `damage`, `depleted`, `faceDown`, and
`attachedTo` immediately. This matters even for a location, whose damage
otherwise persists turn to turn while it stays in play (§3): that
persistence stops the instant it leaves play **(CR §207.5b)**, so a bounced
or returned location doesn't carry old damage into a fresh stint in play.

**Face-down cards and flipping.** **(CR §411.1)** Every face-down card in
play is a resource providing one Volition icon (cards in the void are not in
play). It has **no other characteristics** — no name, no non-resource type,
and no rules text — until it is flipped face-up. So a face-down card is not
a "character" / "item" / "location" for a type-checking selector, condition,
or cost ("destroy another character or item you control" can't pick a
face-down resource; `getCardTypes` returns `["resource"]` for it), and any
triggered ability printed on it is **dormant**: a card that leaves play
*while face-down* (destroyed, bounced, milled, or flipped face-up to be
deployed — §411.3) fires **no** "when this leaves play" trigger of its own,
because the thing that left play was an anonymous resource. Tactical is the
one keyword that still works face-down, and only because CR §507.6b says so
explicitly (`hasKeyword` / `getKeywords` report the printed tactical of a
face-down card in play). A plain void selector (no `faceDown`) never matches
a face-down card in the void **(CR §403.7b)**; only a selector with
`faceDown: true` can.
**(CR §411.3 / §411.4, FAQ)** Flipping a card face-up *or* face-down counts
as the card **leaving play and a brand-new card entering play** — "enters
play" triggers fire on the result. A `cardMoved` (leaves play) event is
emitted for every flip: other cards' "a card leaves play" triggers see it.
The flipped card's *own* "leaves play" triggers fire only when the card that
left was face-**up** (its real self, e.g. a `flipFaceDown` effect on an
in-play character); the event of a face-down resource being flipped up
carries `faceDown: true`, so its dormant printed triggers stay quiet.
Nothing about the old object (damage, tokens, depletion, the faction
attachment of a spent resource, temporary rules text, effects on it) carries
over: the face-up card is a completely new card. Temporary rules text such as
a granted keyword also ends when its card leaves play (CR §508.1). **(CR §301.4 / §301.4a, user ruling 2026-10-27)** Flipping a
host face-down is a way of leaving play, so every card attached to it is
flipped face-down too (each becomes its own anonymous resource under its
owner's control) instead of being destroyed — Node in a Box ("would be destroyed..."
flip instead) carrying Luteoderm Prototype leaves two face-down resources, and
Luteoderm's "attached character leaves play" trigger still fires. A card with
`keepOnHostLeave` stays in play unattached.

**(engine-derived)** `moveCard` clears `CardInstance.faceDown` as part of
the zone change, *before* it emits the `cardMoved` / `cardDestroyed` event,
so the leaving-play card's live `faceDown` is already stale by the time
`findTriggers` runs. The event therefore carries a `faceDown` snapshot
(also set for the `deployCard` flip-up case, where the caller cleared the
flag first); `findTriggers` reads that snapshot — not `card.faceDown` — to
decide whether a leaving-play source's own trigger is dormant.

**(engine-derived)** A card removed from the game is still tracked as a real
`Zone` value (`PlayerState.removed`) rather than deleted from
`GameState.cards`, purely so ordinary bookkeeping (search exclusions,
discard-pile counts) doesn't have to special-case a card that stopped
existing.

**(CR §402.3 / §402.3a, FAQ)** An effect that does not name a game area
affects only the In-Play area — "pick a character" means a character *in
play*. **(engine-derived)** A `CardSelector` with no `zone` filter therefore
matches only the `play` zone; a selector reaches `hand` / `deck` / `discard`
/ `void` only by naming it. A handful of internal contexts that legitimately
span zones — a `deployForFree` targeting a hand card, a `CostModifier`
matching a card being deployed, a chooser picking among a prior deck search —
carry an explicit `zone: "any"` to opt out of the In-Play default.

**Whose hand or deck.** **(CR §301.4a / §305.1)** A card put into a hand or
deck goes to its **owner's** by default, and discard / void / out-of-game are
always the owner's; **(CR §407.7–§407.8)** ownership never changes. **(card-verified)**
A few printings instead say "put the resource into **your** hand" / "shuffle
this card into **your** deck" (Maladjustment and Recollection Bazaar, 1st
Edition Part 2; Foment; Two-Headed Coin) — the controller of the effect, which
only differs for a card you control but don't own. **(engine-derived)**
`moveCard.toPlayer` / `moveSelected.toPlayer` name the receiving player; the
card sits in *that* player's `hand` / `deck` array, they control it
(`controllerId`), and `CardInstance.heldBy` records the holder (absent = the
owner). Consequences, all implemented in `moveCard` / `matchesSelector`:
`owner: "self" | "opponent"` on a card in a hand or deck means its **holder**
(so "a card in your hand" finds it and the holder can deploy or play it);
discarding it puts it in its **owner's** discard pile; any later move out of
the hand/deck clears `heldBy`, and a move with no `toPlayer` goes to the
owner's hand/deck; a same-zone move with no `toPlayer` stays put (a deck move
repositions within the holder's deck); a replacement window or restriction on
"a player's hand" (Quotidian Misfire, Lockbox of the Aeons) is judged against
the **receiving** player, not the owner. A search or `fromTop` count over a
deck reads the holder's deck. Ownership-based conditions (`targetOwnedBy`)
still read the true owner.

**Control ends when a card leaves play.** **(CR §407.3)** A player who takes
control of a card keeps it only until it leaves play. **(engine-derived)**
`moveCard` therefore hands a card that ends up in a hand, deck, discard pile,
the void or out of the game to whoever holds it (`heldBy`, else the owner):
`controllerId` is never a stale thief there. A stolen character bounced to its
owner's hand is the owner's to deploy, and `controller: "self"` selectors on
"your discard pile" find it for the owner. The release happens *after* the
move's `cardMoved` is emitted, so the card's own "leaves play" triggers (and a
watcher's `eventCardControlledBy`) still see the controller it had in play;
`cardDestroyed` is emitted after the move and carries that controller in its
`controllerId`, which `findTriggers` and `eventCardControlledBy` read. A card
in `deploying` keeps whoever is deploying it. `takeControl` only affects a card
in play (a card in any other zone is left alone), and a timed grant is dropped
when its card leaves play.

## 3. Card types

**(CR §201.4e)** The six types are Resource, Tactic, Character, Location,
Item, and Faction. Types can be gained or lost, and a card can hold more
than one at once (§3.7).

### 3.1 Character (CR §204)

- Has strength (battle damage dealt), life (damage it can absorb before
  dying), and speed (battle damage ordering); may have abilities/keywords.
- **(CR §204.3)** Can attack only if it started the turn in play under your
  control (see §6); it can always *block* while in play.
- **(CR §204.3a)** It may use its abilities the first turn it is in play
  under your control, even though it can't attack.
- **(CR §204.3b)** A character *put into play by a start-of-turn effect*
  can't attack that turn — it wasn't in play at the instant the turn
  actually started. (The **Aggro** keyword, §9, lifts the "started the turn
  in play" restriction.)
- **(CR §204.5 / §408.4)** Destroyed immediately once the damage it has
  received *this turn* is ≥ its life. Checked continuously (§11), not only at
  end of battle.
- **(CR §204.4c, FAQ)** Speed decides *when* its damage is inflicted in
  battle. A 0-speed character still assigns and deals damage normally — 0 is
  just the lowest speed, so it assigns last.
- Only playable on the controller's own turn unless an effect deploys it or
  it has **Tactical** (CR §204.1, §507.6).

### 3.2 Item (CR §206)

Persistent; may modify stats/effects of itself or another card (including
via **Attach to X**, §9). Never depletes on its own. When it resolves, it is
put into play. Only playable on your own turn unless deployed by an effect
or **Tactical**.

### 3.3 Location (CR §207)

Persistent; has a **structure** value (upper-right, in place of battle
stats — CR §201.8) = the damage markers it takes to destroy it.

- **(CR §207.3)** Your opponent can attack your locations instead of your
  faction.
- **(CR §207.5 / §408.5)** Destroyed immediately once its accumulated damage
  markers are ≥ its structure.
- **(CR §207.5b / §408.9)** If a location leaves play, all its damage
  markers disappear — accumulation does not survive a trip out of play.
- **(CR §207.6 / §408.5b)** An effect that removes damage markers adjusts
  the running total accordingly.

**(engine-derived)** A location's capacity is `CardDefinition.structure`,
not `life`. `checkStateBasedActions` destroys characters and locations the
same way (damage ≥ capacity), reading `life` for a character and
`structure` for a location. All 140 real location cards carry a numeric
`structure`; `card-data-integrity.test.ts` enforces it. Engine-rules tests
use synthetic location fixtures with an explicit `structure`, on purpose.

### 3.4 Tactic (CR §205)

One-shot effect; when it resolves, follow its instructions and put it into
its owner's discard pile. **(CR §205.1)** May be deployed on your turn, in
response to the opponent's actions on either player's turn, and at the
special response points within a battle (§8).

### 3.5 Resource (CR §203)

Provides resource icons while in play, attached to the controller's faction.
**(CR §203.1)** You may play a resource **only when an effect instructs you
to** (usually your faction's develop rule). **(CR §203.7)** Resources never
deplete; when used to pay, they are attached to your faction and stay
attached until detached (typically by the faction's turn-start restore
rule).

- **(CR §203.2)** When you play a resource you choose face-up or face-down.
  Any card may be played face-down; only actual resource cards may be played
  face-up.
- **(CR §203.5)** The five staple resources are Obsession, Greed, Elitism,
  Deception, Rage; each provides one icon of its type. Any number may be
  included in a constructed deck (CR §103.1c).
- **(CR §203.4a / §405.5)** Every face-down card provides one **Volition**
  icon regardless of what it really is.

### 3.6 Faction (CR §202)

The player's avatar. Not part of the deck; one is chosen (or supplied) at
setup and starts the game in play (CR §202.2). Its rules text defines:
starting influence (CR §202.3a), Starting Resources (CR §202.5), Starting
Draw — usually different for first vs. second player (CR §202.6), the
Restore Rule (CR §202.7), and the Develop Rule (CR §202.8). It may also
carry activated abilities, usable any time you could use an ability
**(FAQ)**.

- **(CR §202.4 / §408.3)** Damage inflicted on a faction makes it lose an
  equal amount of influence (see §8 for how damage modification interacts).
- **(CR §202.9 / §402.9)** A faction is unaffected by effects that don't
  name factions, and cannot be picked unless an effect explicitly picks a
  faction. **(engine-derived)** `matchesSelector` drops any card with the
  `faction` type unless the `CardSelector` explicitly admits factions —
  either `type: "faction"` ("pick an opponent", "any one deck", a
  faction-target damage modifier) or a positive `cardTypeIs: "faction"` in
  its `conditions` (the "character or faction" `or`-group — Bask Bile,
  Boorish Boar). So a generic pick ("a non-resource card", "a character",
  a bare "a card") never reaches the faction card, and neither do the
  aggregate `count` / `forEach` / aura selectors built on the same
  matcher.

**(engine-derived)** The faction card's mechanical rules text lives in
`FactionDefinition`:

- **`abilities`** — activated abilities printed on the faction card,
  activatable through `activateAbility` with the faction card's id, any time
  its controller could use an ability (e.g. The Open R&D Faction's "DRAW —
  Pay 3 — Draw a card"). An ability with `usableBy: "anyPlayer"` (The
  Knitting Coalition — "Both players may use this ability") is offered to
  the opponent too and resolves under whoever activates it.
- **`meetsAllThresholds`** — OMNIPOTENCE (The Evil Alliance): the
  controller automatically satisfies every threshold regardless of which
  resource icons they control: the deploy / ability / FLIP UP threshold
  check short-circuits, and so does the `meetsThreshold` condition that
  gates a threshold paragraph (§4).
- **`turn.startOfTurnEffects`** — effects run automatically at the start of
  the faction's controller's turn, after the core start-of-turn rules and
  the Restore Rule, with the faction card as `source` — Imperial Army's
  "reduce the numeric cost of the next character you play this turn by 2"
  (a `reduceNextCost` with `cardType: "character"`).
- **`turn.develop.usesPerTurn`** — how many times the Develop Rule may be
  used per turn (default 1; the Union of Unextraordinary Miners' "OVERTIME"
  clause is `2`).
- **`overridesOpponent`** — while this faction card is in play it rewrites
  specific sub-rules of the **opponent's** faction (The Knitting Coalition):
  `startingDraw` makes the opponent's opening hand use *this* faction's
  `setup.openingHand` sizes (HIDDEN INFLUENCE — resolved in
  `createTwoPlayerFactionGame`), `suppressDevelop` gives the opponent no
  Develop Rule at all (PULLING STRINGS — `getDevelopChoices` returns `[]`
  for them). 2-player only.
- **`setup.startingResources`** beyond the flat `{ count, names?,
  stapleOnly? }` — `slots` is a per-slot program (a `"resource"` slot puts a
  face-up resource, unless its own `faceDown: true` puts it into play
  face-down instead — The Primitive Tribes of Thabbash's "1 face-down
  Obsession, 1 staple resource"; an `"anyCard"` slot puts any card and turns
  it face-down if it is not a resource — The Society of Magical Propriety's
  "Any 1 resource, Any 1 card"); `distinctStaples` requires the `count`
  starting staples to be different kinds (Unlikely Heroes, Defenders of
  Marduun — "Any N different staple resources"); `chosenStaples: { min, max,
  plus? }` is a setup-chosen count of staples plus fixed extras (The Union of
  Unextraordinary Miners' MONEY FOR NOTHING — X comes from
  `FactionGameSetupOptions.startingResourceX`, clamped to `[min, max]`,
  default `min`); `matchOpponentCount` tops the **opponent** up with staples
  until both players hold the same number of starting resources. As with the
  flat form the engine picks cards in deck order — the player does not choose
  *which* staple / card.
  **(engine-derived)** What the deck must hold for setup: the rules are silent
  on deck legality here, so `findDeckConstructionIssues` reports a
  `factionRule` issue exactly where setup would stop: a *named* resource
  ("1 Obsession", "...and 1 Deception", "2 Greed") or a staple slot ("1 staple
  resource", the Union's X staples at the smallest X) with no card of its own.
  Every slot is a different card, so the Union's X staples and its Deception
  never share one (a lone Deception is never taken as one of the X) and a deck
  of one Obsession cannot fill "1 Obsession, 1 staple resource". "Any 1
  resource", "Any 1 card" and the flat "Any 2 staple resources" are searches
  that may find fewer (CR 312.2); setup carries them out as far as the deck
  allows (CR 402.5) and they ask nothing of the deck. The Union's X above the
  smallest is limited to the staples the deck can still supply.
- **`setup.startingDrawSearch`** — an extra Starting Draw step: the first
  card in deck order matching `selector` whose `CardDefinitionId` differs
  from every starting resource just placed goes to hand, before the opening
  hand is drawn (Unlikely Heroes — "you may search your deck for a staple
  resource that is not any of your starting resources ... put it into your
  hand"). Always taken automatically, the same "no real choice, so no
  interactive phase" treatment the engine gives every other starting-resource
  pick — declining a free, strictly-beneficial card is never correct.
- **`flipUpTax`** — `{ amount, cardType? }` adds `amount` to a card's printed
  FLIP UP cost for every flip-up deploy by this faction's controller,
  `cardType`-scoped (The Primitive Tribes of Thabbash — "you must pay 2 to
  deploy tactics using FLIP UP"). Parallel to `ContinuousAbility.searchTax`,
  but for flip-up deployment instead of deck searches.

Two small additions to the general ability vocabulary exist only to support
faction cards so far: `TargetDeclaration.distinctTrades` (every selection in
one declaration must have a distinct printed `trade` — Defenders of
Marduun's RALLY, "3 characters that don't share a trade", parallel to
`distinctNames`) and the `sharesTradeWithAny` condition (`target`'s trade
equals the trade of at least one card matching `among` — Legions of Chaos'
"a character that does not share a trade with any characters you control" is
`not` + this).

**Double-sided faction cards** — Imperial Army and Counter-Imperial Army are
the same physical card printed on two sides (INTERNAL CONFLICT / CONSTANT
IN-FIGHTING: "At the end of your turn, flip a coin. If you win, turn this
card over. (Only the face-up side is active.)"). `FactionDefinition.flipsTo`
names the other side's `CardDefinitionId`; the `flipFactionCard` effect
(wrapped in the existing `flipCoin` effect, run from
`turn.endOfTurnEffects`) reassigns the in-play `CardInstance.definitionId`
to it — the same card object, its other face now active. Every faction
lookup (`getFactionDefinition`, abilities, thresholds, restore/develop
rules) reads through `getDefinition`, so the new side governs immediately
with no further bookkeeping. Both sides' `CardDefinition`s must be
registered with the engine for the flip to take effect (loading the full
catalog, as every real consumer does, guarantees this).

Seed 3's non-tournament "EPIC" / "Showdown" faction cards (The Evil
Alliance, Imperial Army, ...) additionally reference Showdown multiplayer
format mechanics that are **out of scope for a two-player engine** and are
left unmodelled: the X = number-of-opponents scaling, the Temptation Pile,
the Hero deck.

### 3.7 Changing card types (CR §208)

- **(CR §208.1)** A card may have several types at once; "gains a type"
  keeps the existing ones.
- **(CR §208.2)** If an effect refers to a specific type but its target is
  no longer that type, the target is not affected by that effect.
- **(CR §208.3)** If a card loses the character type, it forgets all damage
  it received this turn (becoming a character again later does not restore
  it).
- **(CR §208.4)** If a card loses the character type *during a battle*, it
  is removed from the battle immediately (§8) — this also covers a
  character flipped **face-down** mid-battle (§4: a face-down card is only a
  resource), e.g. *Backdoor Brigand*'s EXIT STAGE RIGHT.

**(engine-derived)** A temporary type change is the `setCardType` effect
("this turn, the item is a golem character ..." — Contrabulous Fabtraption,
RUNE OF ANIMATION). Per **CR §208.1 / §208.1a** the new type is **added**,
not substituted — the card keeps its printed type as well (the §208.3
example still calls the card "an item" while it "becomes a character").
`hasCardType` / `getCardTypes` report the added type, and every rules
decision keyed off type consults them: typed `CardSelector`s (the card
matches *both* a "character" and an "item" selector while the grant holds),
the lethal-damage and "Attach to X" state-based checks, battle attack/block
legality and the mid-battle removal above, the `cardTypeIs` condition, and
the start-of-turn damage-clear / attack-eligibility rules. Optional `grantStats` ride along as
`set` stat modifiers with the same duration. When the grant ends and the
card is no longer a character it forgets this-turn damage (§208.3, applied
at the next start-of-turn); §208.4 removal runs through the state-based
check so it fires whatever ended the grant — a lapsed `setCardType`, the
grant's source leaving play, or a `flipFaceDown` on the card itself (the
state-based check makes an exception to its "skip face-down cards" rule for
this one removal).

**(user ruling Q28, 2026-10-20)** §204.3 is read literally: a card that was in
play under its controller when the turn began (as any face-up permanent) and
*gains* the character type mid-turn started the turn in play, so it can attack
that turn (Contrabulous Fabtraption's animated item). The engine records this
as `CardInstance.startedTurnInPlay` for both players' face-up permanents at
every turn start; a card that entered play, was flipped up or changed
controller this turn does not have it.

### 3.8 Ignoring rules text from a card type (engine-derived)

**Parkour Hoodlum** — "This card ignores all rules text on locations. (this
card cannot be picked by locations and any effects from locations do not
affect this card.)" — is a `ContinuousAbility` with
`ignoresRulesTextFrom: "location"`. While it is in play (and the ability's
`condition`, if any, holds):

- it is dropped from the legal-candidate set of any target declaration
  whose resolving source is a card of that type (`targetCandidates`,
  scoped on the *picking* source, parallel to the `cannotBePicked`
  restriction);
- a single-target mutating **effect** (damage, destroy, deplete, a
  modifier, a keyword / restriction grant, take-control, move, counters,
  …) whose resolving `source` is a card of that type is a no-op against it;
- a continuous **aura** (stat / keyword / restriction) whose source is a
  card of that type skips it during recompute.

Aggregate "all X" / `count` selectors still see it (a "cannot be
picked"-style exclusion only blocks *choosing*, per §12). Not modelled: a
deploy-cost or damage-amount modifier sourced from an ignored card type
(no card needs it).

### 3.9 Continuous PROVIDES grants (engine-derived; CR §311, §411.1)

**Black Market Broker** — "Each resource you control that doesn't have
"PROVIDES: [D]", gains "PROVIDES: [D]"." — is a `ContinuousAbility` with
`providesGrants` (`selector` + `icon`, optional `amount` / `onlyIfLacking`).
While the source is in play face-up (and its `condition` holds, and it is not
suppressed), every in-play card the selector matches provides the extra icon.
It is a standing effect, re-read every time icons are counted (thresholds for
deploying, FLIP UP and gated abilities, the `cardProvides` condition, the
`resourceIcons` expression), so it:

- reaches a resource that enters later (developed, played face-down, flipped
  face-down) and stops reaching one that flips face-up (a face-up character is
  not a resource, CR §411.3);
- counts **face-down** resources: each is a resource (CR §411.1) providing [V]
  and lacking any other icon, so it gains [D]; a face-up staple that already
  provides [D] gains nothing (`onlyIfLacking`; two Brokers still give a lacking
  resource one [D]);
- follows control: "you" is the source's controller, so a resource an opponent
  takes stops getting it, and if the Broker changes controller its new
  controller's resources get it;
- ends when the source leaves play or is flipped face-down (no rules text,
  CR §411.1);
- never counts a FLIP UP card's own granted icon toward its own FLIP UP
  threshold (it is checked after the flip, when the card is no longer a
  resource).
- is read before, and independent of, every rules paragraph that is gated on a
  threshold (CR §405.4): counting icons looks only at abilities that carry
  `providesGrants`, never at whether an unrelated card's paragraph is active or
  suppressed. A "[G][G][G][G][G]: this card loses all other rules text"
  paragraph (Espionage Loafers, Monstrous Lassitude, Crimson Pandiatus,
  Rushing Crushing Blockhead) therefore needs the icons without being needed by
  them. Where an icon grant really depends on a threshold paragraph (a
  suppressor reaching the Broker, a `grantedAbilities` block that hands out a
  `providesGrants` ability), the threshold read made while that paragraph is
  being evaluated counts icons without that one grant (a grant cannot bootstrap
  off its own evaluation); the rules do not say how such a circular pair
  settles. A suppressor's condition is consulted only for cards it reaches.

"Pay N" costs never read icons (any resource pays), so payment options are
unaffected.

### 3.10 Ignoring "this card" enters / leaves-play triggers (engine-derived)

**Unwelcome Hero** — "While this card is in play, ignore all triggers that
begin with "when this card enters play" or "when this card leaves play"." — is
a `ContinuousAbility` with `ignoresTriggers: ["thisCardEntersPlay",
"thisCardLeavesPlay"]`. **Reading implemented (literal):** while the Hero is in
play face-up, the engine creates no such trigger for **any** card in the game,
either player's. "Enters play" = a `cardEnteredPlay` triggered ability that
requires `sourceIsEventCard`; "leaves play" = a `cardMoved` ability that
requires `sourceIsEventCard` and a move from play with no destination named. A
printed combined "enters or leaves play" trigger begins with neither quoted phrase, so it is NOT
ignored: its two authored abilities carry `printedLead: "entersOrLeavesPlay"` (user ruling 2026-10-29, literal reading).
Different words still fire: "when this card is destroyed", "when this card is
put into your discard pile from play", "when a card enters play" (not "this
card"), Develop / Restore and start-of-turn text. The Hero must be in play when
the event happens: an already-created trigger is not recalled, and a card
leaving play is judged against the cards in play after it left, except cards
that leave together in one "destroy all" `forEach` (CR 305.2), which are judged against the board
before the first of them moved (user ruling 2026-10-29). The remaining open alternative is to scope the
trigger to one player's cards.

### 3.11 Standing "this turn" stat changes over a player's cards (engine-derived)

**Rasputin Unleashed** — "This turn, the speed of all characters that opponent controls is reduced to 0." — is a `createAreaModifier` effect (user ruling 2026-10-29, the literal reading). The effect stays true for the whole turn: its selector ("characters the opponent controls") is re-matched every time a stat is read, so a character the opponent puts into play, or takes control of, later the same turn also has speed 0. It is not a snapshot of the characters in play when the trigger resolved. Only "opponent" is fixed at resolution (to the controller's opponent); it ends at the start-of-turn sweep like any "this turn" modifier, and combines with other stat modifiers in the order they were created.

## 4. Resources, thresholds, and costs

- **Trades (CR §201.4d):** Gearsmith, Warlord, Banker, Rogue, Arcanist, and
  Universal. The staple-resource icons pair with the first five —
  Arcanist ↔ Obsession, Banker ↔ Greed, Gearsmith ↔ Elitism,
  Rogue ↔ Deception, Warlord ↔ Rage. `Universal` is not a trade with its
  own resource; it marks cards any faction may play.
- **Threshold (CR §201.3a / §405):** the resource-*icon* requirement printed
  under the cost number. To meet it you must **control** cards providing
  those icons. **(CR §405.6)** Icons are never *spent* — threshold is a
  gate, not a cost, and satisfying it doesn't limit how many
  threshold-gated cards you can play.
  - **(CR §405.3 / §502.2)** An ability may print its own threshold after
    its name (the "RECUR: [G][G]" / "EXHUMATION: [O][O]" clause); you can't
    use the ability unless you meet it.
  - **(CR §405.4 / §201.5d)** A *paragraph* of rules text may begin with
    threshold icons; it is active only while its controller currently meets
    that threshold, and turns off the instant they stop. It is a static
    condition, **not** an ability you activate: it is authored as a
    `continuous` ability whose `condition` is `{ type: "meetsThreshold",
    threshold: "<printed icon letters>" }` (a triggered ability's
    `condition` for "[icons]: When ..." paragraphs; a modal tactic's
    `modes[].condition` for one paragraph per mode). A mixed threshold
    ("[O][O][V][V]") is one condition (`"oovv"`). A bonus therefore applies
    once however many extra icons you control and can never be repeated for
    free (*Fervent Beastslayer*'s "[R]x5: This card gains 3 life" is +3
    life while you control five [R], not +3 per use).
  - **(OMNIPOTENCE, engine-derived)** `meetsThreshold` is true for a
    controller whose faction has `meetsAllThresholds` (The Evil Alliance:
    "You automatically meet all thresholds"), so their threshold paragraphs
    are on with no icons, and a "[R][R][R]: Destroy this card." paragraph
    destroys the card the moment it is in play. The player is the paragraph's
    **controller** (a card under another player's control uses that player's
    faction). Reading `getThresholds` for a *count* is the other idiom and
    never sees OMNIPOTENCE: "X is the number of [O] you control" and an
    inline "if you control [V][V][V], ..." (*Religious Rejection*, *Ritual of
    the Double Monkey*, *Unscrupuls of Victory*) are `numberCompare` /
    amounts over `resourceIcons`, which read the real icons. Those inline
    checks are not printed thresholds (CR §405 gives a threshold to a card,
    an ability, or a paragraph), so OMNIPOTENCE does not satisfy them. A
    FLIP UP / ability / card threshold already goes through the deploy
    check, which honors OMNIPOTENCE; `reduceThreshold` and FEALTY slack
    apply to deploying a card only, never to a standing paragraph.
    "[icons]: Destroy this card." (*Boorish Boar*) is
    `ContinuousAbility.destroysSource`: a state-based check, so the card is
    destroyed the moment the condition holds — including on entering play,
    and right after a Develop Rule resource play.
- **Volition (CR §405.5, card-verified):** the sixth icon, provided by every
  face-down resource. This is why `"v"` threshold requirements appear only
  on `Universal`-trade cards in the real data (e.g. *Zigalburgonglgr, the
  Stolen God* at `"vvvvvv"`) — they're meant to be paid for by face-down
  resources from any deck. `Threshold`/`ResourceIcon` therefore has six
  members (`rage, greed, deception, elitism, obsession, volition`);
  `getResourceIcons` implements `card.faceDown → ["volition"]`.
- **Numeric cost (CR §406):**
  - **(CR §406.1 / §406.2)** Outside of being played, a card's numeric cost
    is its printed cost number, or 0 if it has none.
  - **(CR §406.3)** While a card is being played you keep a running total:
    start at the cost number; as you satisfy extra costs, a "pay N" extra
    cost *adds* N to the total rather than being paid on the spot; then
    apply **all cost increases** (any order), then **all cost reductions**
    (any order); the result is what you pay, and **(CR §406.3a)** numeric
    costs are always paid *last*.
  - **(CR §406.6 / §410.4)** A numeric cost can never go below 0. **(CR
    §410.5)** "reduced to a minimum of N" doesn't apply if the value was
    already below N.
  - **(CR §308.1)** Playing something "for free" sets its cost number to 0
    for that deploy but does **not** waive its threshold or its extra costs.
  - **(CR §406.5)** An effect that says "pay N" *is* a numeric cost, so
    generic "reduce the next numeric cost you pay" effects apply to it —
    but **(CR §406.5b)** card-type-specific reductions ("your items cost 1
    less") do not, because that N isn't "an item's numeric cost."
- **Paying a numeric cost (CR §203.3 / §309.1):** attach that many of your
  in-play resources to your faction. **(CR §203.3a / §309.1a)** Only
  resources not already attached to anything may be attached. **(CR
  §309.1b)** "pay" never refers to a faction losing influence.
- **No floating (FAQ):** you must be able to satisfy a card's or ability's
  entire cost *at once*, when you attempt it. There is no window during
  payment to use abilities or detach resources, so a resource already spent
  on a card cannot be freed and reused for the same card.
- **Non-numeric ability costs** (deplete a card, destroy a card, discard N
  cards) that name a specific card require the player to have already chosen
  it — there's no auto-pick. **(engine-derived)** A "discard N" cost carries
  its own `id` (`Cost` with `type: "discard"`) and is satisfied like a
  target declaration: via `selected[cost.id]`, supplied up front in the
  `activateAbility` action, checked for legality (right zone/controller, no
  duplicates, exactly N) before the ability can be paid for.
- **Playing a resource:** either (a) put an actual resource card from hand
  into play face-up, providing its printed icon, or (b) put *any* card from
  hand into play face-down as a resource (Volition).

## 5. Setup (CR §601)

1. **(CR §601.1a)** Each faction card starts in play; its printed starting
   influence becomes that player's influence total.
2. **(CR §601.1b)** Each player searches their deck for the resources listed
   under their faction's *Starting Resources* and puts them into play
   **face-down**, then shuffles (Tournament Faction: 2 staple resources).
3. **(CR §601.1c)** Randomly determine which player decides turn order; that
   player chooses who goes first.
4. **(CR §601.1d)** All players flip their starting resources **face-up**.
5. **(CR §601.1e)** Each player draws their faction's *Starting Draw* count
   — first- and second-player amounts usually differ to offset going first
   (Tournament Faction: 8 / 9).
6. **(CR §601.1f / §601.1g)** The first player may mulligan: set aside any
   number of hand cards to the bottom of the deck in an order of their
   choosing and draw that many replacements. Then each other player, in
   turn order, does the same. Once per player only.
7. **(CR §601.1h)** The first turn begins (see §6).

**(engine-derived)** Step 3 runs in the engine when the setup option
`chooseFirstPlayer` is on (ruling RQ-r08-turn-deploy-1): once every starting
resource is in play, the game's seeded RNG picks the deciding player
(`firstPlayerDecider` event) and setup pauses in the `chooseFirstPlayer`
phase until that player's `chooseFirstPlayer` action names either player
(`firstPlayerChosen`). `getFirstPlayerChoice()` reports the decider and each
player's opening draw for either answer. The draw is not a card's coin flip:
nothing that reacts to `coinFlipped` sees it. A caller that already knows the
first player passes `firstPlayerId` instead (no draw, no prompt); with
neither, player A goes first.

**(engine-derived)** Which cards each player set aside is recorded on
`GameState.mulligan` and read by the `bottomedInMulligan` condition.
*Community Chest* ("... choose to put this card on the bottom of your deck
as part of your mulligan ... you may reveal it. If you do, draw a card at
the start of your turn.") carries two `triggerZone: "deck"` triggers. The
reveal fires on the `cardsMulliganed` event a mulligan emits once its cards
are on the bottom of the deck (before the replacements are drawn): if the
card was bottomed and its controller then controls at least [D] — their
starting resources are already face-up — it emits `cardsRevealed` to
everyone. The "you may reveal it" step is treated as automatic (the engine
has perfect information — see §12 "Fidelity pass" — and revealing has no
downside). The draw is a `turnStarted` trigger, and "control at least [D]"
gates it at trigger time rather than only at game start; it does not check
that the reveal happened.

## 6. Turn structure

**(CR §602) Start of turn** is a single simultaneous point in time — *not*
a phase or step, and these are not triggers:

- **(CR §602.1a)** All damage on characters is cleared to 0.
- **(CR §602.1b)** All "this turn" effects end.
- **(CR §602.1c / §608.1b)** Every character in play under the active
  player's control (and continuously so since the turn started) becomes
  eligible to attack this turn. A character that enters play mid-turn is
  **not** attack-eligible that turn unless it has **Aggro** (§9).
  "Attack your opponent" (Counter Attack) does not waive this either (Q28):
  only characters that started the turn in play under their controller, or have
  Aggro, can be sent to attack, on either player's turn.

**(CR §602.2)** Then all "at the start of your turn" triggers happen; the
active player orders them (§7).

The faction's **Restore Rule (CR §202.7)** and **Develop Rule (CR §202.8)**
are sections of faction rules text, not built-in phases. **(user ruling
2026-10-27)** Both are start-of-turn requirements that work as triggered
abilities of the faction card: at the start of the turn they go in the same
batch as every other "at the start of your turn" trigger, and their controller
orders them all (§7) — which is why a card like Poshernacle works. **(engine-
derived)** `factionStartTriggers` queues them with the `turnStarted` event
(abilityIds `restoreRule` / `developRule`, effects `restoreRule` /
`developRule`); there is no `chooseDevelop` action — the Develop Rule is
carried out when its trigger resolves (below). "At the start of your next turn"
delayed effects wait until the whole wave has settled (`startingTurnFor`).

- The restore rule replenishes resources and cards each turn — for the
  Tournament Faction: detach this player's resources from the faction and
  restore (untap) their non-resource permanents. (Character-damage clearing
  is the core start-of-turn rule above, CR §602.1a, not part of the restore
  rule.)
- The develop rule usually lets you **draw 1 card *or* play 1 resource**,
  once per turn. **(FAQ 2.0)** a player "must choose to either draw a card or play a resource, not both"; it is
  required (CR 202.8, FAQ 2.0): when its trigger resolves the `developRule` effect
  raises a `chooserSelectsOption` — "Draw N card(s)" or "Play a resource" (only
  with a card in hand); there is no skipping it — and the resource play is
  the ordinary `playResource` effect (pick, face-up/face-down, reveal
  prompts). `usesPerTurn: 2` offers the options a second time. Playing a resource is
  otherwise impossible: **(CR §603.2)** it is not one of the turn's actions,
  and **(CR §203.1)** only an effect can let you play one.

  **(engine-derived — reveal-from-hand alt deploy)** A card with
  `CardDefinition.revealFromHand` ("While this card is in your hand you may
  reveal this card as you are playing a resource. If you do, you may deploy
  this card for N." — Witty Worm) offers a third option *for that turn's
  resource play*: instead of playing a resource you reveal the card from
  hand and deploy it for the flat numeric cost `revealFromHand.cost`. It
  still checks the card's printed threshold and pays any EXTRA COSTs; only
  the numeric cost is replaced (no cost modifiers / reductions apply). It
  consumes the develop rule for the turn just like a normal resource play.
  Offered by the `resourceReveal` prompt of the Develop Rule's `playResource`. A resource played by an EFFECT (a faction's RESOURCE
  ability, "you may play a resource", Witty Worm's own enters-play step) offers
  the same reveal as a `resourceReveal` prompt (CR 605.1c): after the card is
  chosen and before it enters play. Accepting deploys the revealed card for its
  flat cost with no response window and the chosen resource still enters play;
  the prompt repeats for any other card that can be revealed. "Put a resource
  into play" (`putIntoPlay`) does not offer it.

  **(engine-derived — develop-draw replacement)** A card with
  `behavior.developDrawReplacement` (Arcane Escrow — "If you would draw a
  card as part of your Develop Rule, you may put a card voided by this card
  into its owner's hand instead") intercepts the `draw` develop option
  while the developing player controls it in play: instead of drawing, a
  `mayPay` is offered (payer = the developer, `costs` = its optional
  `cost`, `effects` = the substitution, `elseEffects` = the draw). The
  option is consumed either way. Arcane Escrow's substitution is
  modelled as "a card in your void" — the *this-card-voided-it* origin is
  not tracked.

**(CR §603) During the turn** the active player may take these actions in
any order, any number of times:

- **(CR §603.2a)** Deploy a card (§ below).
- **(CR §603.2b)** Use an ability (§10).
- **(CR §603.2c)** Attack (§8).
- **(CR §603.2d)** End the turn — **at most once**.

**(CR §610)** Ending the turn: when the active player announces it, the turn
doesn't end until the opponent has finished responding; then end-of-turn
triggers fire "at the moment the turn actually ends" (CR §610.1a).

**Deploying a card (CR §604.1):** selection → threshold check (CR §604.1b;
fail here and you can't play it) → put the card face-up into Being Deployed
→ satisfy costs, extra costs first then numeric cost (CR §604.1d) →
legality (CR §604.1e; can't pay ⇒ the deploy was illegal, undo everything,
terminate any triggers it caused) → pending triggers resolve (CR §604.1f) →
opponent responds (CR §604.1g) → resolution: a character/item/location goes
into play under your control, a tactic follows its text then goes to its
owner's discard (CR §604.1h).

**(CR §402.8 / §402.8a) "Deploy" ≠ "put into play."** An effect that *puts*
a card into play is not deploying it, so anything that triggers "when a card
is deployed" does not fire. **(FAQ)** A card is *being deployed* once its
costs are paid and it sits in Being Deployed with the opponent able to
respond; it *enters play* when it resolves (no more responses, but
enters-play triggers fire). A card *put into play* was never "being
played."

**(engine-derived)** The develop rule is the `developRule` effect of the
faction's start-of-turn trigger (see §6 above) — an optional, once-per-turn
choice made when that trigger resolves. There is no develop phase and no
`chooseDevelop` action; the player's only say is where it falls among the
turn's other start-of-turn triggers and which option they pick.

## 7. Responding to actions (CR §607)

**(CR §607.1)** You may respond **only to your opponent**, and only when
they:

- finish paying for a card they are deploying (before it resolves), or
- finish paying for an ability (before its effects run), or
- announce they are ending their turn.

You can never respond to your own action **(CR §607.1)**.

**(CR §607.2)** A response is a **tactic** or an **ability** (and any card
with the **Tactical** keyword, CR §507.6 — see §9). When you have a chance
to respond you may make one; once it resolves you may make another, any
number of times; when you stop, the action you were responding to resolves.
**(CR §607.2a)** Your opponent may respond to each of your responses in the
same way, so a chain can nest indefinitely; nested responses resolve
**last-in, first-out** in effect.

**(CR §607.2b / §607.2c)** There is no priority-passing system and no formal
stack in The Spoils — because you can't respond to your own actions, the
non-acting player simply drives a series of responses, each resolving before
the next is made. Many things that would go on a stack elsewhere (notably
triggers) cannot be responded to here.

**Terminate (CR §314, card-verified).** To terminate a card or ability is to
stop it before it resolves — cease all its instructions immediately; a
terminated *card* goes to its owner's discard (CR §314.1). To terminate an
*effect* is to stop its impact entirely (CR §314.2). A card can be
terminated in the same instant it is played, by a `cardPlayed`-triggered
ability (e.g. *The Great Wall of Keeping Stuff Out*). **(engine-derived)**
the `cardPlayed` event and the stack push happen as one batched step so
such a trigger sees the card already on the stack.

**Triggers are not responses (CR §503).** **(CR §503.1)** A trigger begins
with *if*, *when*, or *at*; it fires automatically the instant its condition
is met, using its text as written *at that instant* even if you're mid-way
through resolving something else or its source has since left play. **(CR
§503.2)** Players cannot respond to it. **(CR §503.3)** A trigger that
happens while a player is paying a cost waits until the cost is fully
satisfied before it resolves: `payCosts` queues the triggers of every cost step
and, once the last step is paid, they happen together as one batch (CR §604.1f,
§606.1e; one ordering choice, none when they are copies of one ability on one
card); a payment that stops to ask another player a question leaves them queued
for the re-run, and a payment that fails terminates them (CR §604.1e, §606.1d).
**(CR §503.4, FAQ)** When several triggers
happen at once: if all come from one player's cards, that player orders
them; if from both players' cards (or game-rule triggers), the **active
player** orders them. **(CR §503.4a, FAQ)** the order is chosen one trigger
at a time — resolve one, then decide the next — not fixed up front.

**(user ruling 2026-10-27)** A trigger on *a* card entering play ("When a
card that provides at least [O] enters play under your control", "When a
character enters play under your control") needs its source **already in
play** when that card enters, so it never fires for its own source's entry.
Deploying a Crest of Obsession provides [O][O] and nothing triggers; the next
[O] card entering play does. The same holds for the Banners and Merbegon.
Only a "when **this card** enters play" trigger fires for the source itself.
In the engine, `findTriggers` skips a `cardEnteredPlay` ability for its own
source unless its condition contains `sourceIsEventCard`.

**(engine-derived)** Playing a card or activating an ability pushes a
`StackItem` onto `state.responseStack` and opens a `responseWindow`. The
window tracks a single `priorityPlayerId` — the one player entitled to act
right now. **There is no priority-passing / two-pass close** (CR §607.2b):
while the stack has items, `priorityPlayerId` is always the *opponent of the
top item's controller* — you are never handed a pass on your own action
(CR §607.1). A `passPriority` from that player flips the window to
`resolving`; `advanceFlow()` pops and resolves exactly one item, then the
window re-opens (`priorityPlayerId` recomputed for the new top item) so the
next response can be made (CR §607.2 "once this response resolves you may
make another"). Once the stack drains and no responder is left, the window
closes and its `continuation` resumes. An `action` window (a main-phase
deploy / ability) has no top-level responder queue — it is driven entirely
by its stack item and closes the instant that item resolves, with no pass
from the acting player. An `endTurn` window carries a one-entry queue
(`[opponent-of-turn-ender]`); a battle response window carries
`[attacker, defender]` (CR §608.1c / §609.1a — the attacker acts as many
times as they want, then the defender), each shifted off when that player
passes with an empty stack. `noResponse` (Swindle — "your opponents cannot
respond to this card") resolves its item inline with no window of its own.

**(engine-derived)** Every trigger found for one emitted event shares a
batch. While 2+ of a batch are still waiting, the engine pauses on
`GameState.pendingChoice` (kind `"orderTriggers"`, listing the remaining
`{sourceId, abilityId}` entries); the deciding player answers with a single
`next` pick (CR §503.4a). That one resolves fully, then — if 2+ still
remain — the choice is re-raised for the next pick; a lone leftover resolves
without prompting. `playerId` is the batch's sole controller if the cards
share one, otherwise the active player; it is fixed when the batch's first
prompt is raised (`TriggerResolution.orderedBy`), so the same player orders the
rest of the batch even when the triggers left all belong to one player
(CR §503.4a; MPX-order).

**(engine-derived)** A batch is *everything found for one emitted event* —
not everything in one simultaneous game action. Two characters destroyed
together by the same round of battle damage (§8) each get their own "left
play" event, so their "when this leaves play" triggers do **not** share an
`orderTriggers` batch; each resolves fully, in turn, queued behind the
others emitted in that instant.

**(engine-derived — retarget an extra-cost pick)** *Mistaken Identity*
("Deploy this only in response to a card or ability that picked a character
as an extra cost. Pick another character ... its effect happens as though
your opponent had picked the other character instead.") is a response whose
effect *rewrites the responded-to stack item's stored selection*: the
in-play character it had picked as an EXTRA COST is swapped for the new
pick everywhere it appears under that item's `context.selected`, so when the
item resolves (after Mistaken Identity, LIFO) its effects hit the swapped-in
card. The `respondedToPicked` condition gates the response on the
responded-to item actually holding such a pick; the `retargetExtraCost`
effect does the swap (no-op if there is nothing to swap or the same card is
re-picked). "Another character that could be picked by that card or ability"
is enforced only as "any in-play character."

**(engine-derived)** When a triggered ability's target declaration has more
legal candidates than it needs, the engine pauses on
`GameState.pendingChoice` (kind `"selectTargets"`). A declaration with *too
few* candidates is an unplayable trigger, a hard failure, not a choice.

**(engine-derived — a chosen player pays to fizzle a tactic)** *Study
Disturbance* ("EXTRA COST: Pick a player. That player may pay 2. If they do,
look at the top card of your deck then terminate this card.") and *Tedious
TriAdic Truculence* ("Any opponent may pay 3. If they do, look at the top 3
cards of your deck and put them back in any order then terminate this
card.") are modelled with a `mayPay` as the tactic's *first and only*
effect: `elseEffects` is the tactic's real body, and paying runs the peek
(nothing / a `lookAndReorder`) and skips the body — the tactic still goes to
the discard when it finishes resolving, which is the "terminate this card."
Two supporting engine points: `mayPay` charges the **resolved** `effect.player`
(the picked player / the opponent), not always the ability's controller
(mirrors `anyPlayerMayPay`); and `lookAndReorder` takes an optional
`chooser` so "any opponent looks at the top 3 cards of *your* deck and
reorders them" resolves as the opponent reordering the caster's deck.
**Concession:** the buyout is offered when the tactic resolves rather than
truly before it hits the response stack; for these two cards the timing
difference does not matter.

**A note on pending choices generally.** `GameState.pendingChoice` extends
the engine's "pause here until told to continue" idiom to moments not tied
to one player action: a state-based check or a batch of triggers can decide
a real decision is needed. While it's set, `perform()` rejects everything
except a matching `resolvePendingChoice`. Kinds today: `uniqueSurvivor`
(§9), `selectTargets` / `orderTriggers` (this section), the chooser-effect
pauses (`chooserSelectsTarget`, `chooserSelectsOption`, `reorderDeck`,
`deployForFree`, `distributeAmong`), and `replacementChoice` (§10),
`mayPay`, `nameValue`, `useTargetAbility`. `GameFlowView.mode` becomes
`"pendingChoice"`.

**(engine-derived — a resource's entry trigger can pause the Develop Rule, EU1)** When a
trigger (or any effect) set off by a resource entering play pauses on a choice, every
effect still waiting behind it, the trigger's own remaining effects and the
effects of whatever was resolving when it fired, stays parked until that
choice is answered. Example: "When a resource enters play under your
control, name an icon. This turn this card gains PROVIDES: that icon" fires
while the Develop Rule's resource is entering; the grant waits for the name.
Answering the resource's face-up/face-down choice therefore resumes the parked frames only if no new
choice is outstanding (the `"playResource"` case of `resolvePendingChoice`); the answer of the trigger's own
choice resumes them in order. (A global guard in `resumeEffectFrames` was tried and broke the Witty Worm
resource-reveal flow, so the guard lives at that one call site.)

## 8. Battle (CR §608–§609)

### Declaring the attack (CR §608.1)

1. **(CR §608.1a) Announcement.** The active player names a faction or
   location they don't control as the target. If they forget, the target
   defaults to the opponent's faction. An attack can only be announced under
   legal circumstances — **if there are no possible attackers, or an effect
   prevents attacking, the battle ends here before anything can trigger off
   the attack.**
2. **(CR §608.1b) Attackers.** Choose one or more characters you control
   that can attack — each not depleted and controlled by you continuously
   since the start of the turn (§6; **Aggro** waives the latter). **Declaring
   depletes them.** They form the attacking party.
3. **(CR §507.3 / §302.11)** If *every* attacker has **Covert**, the
   attacking party is a **covert party**.
4. **(CR §608.1c) Response window** — the attacker may play tactics / use
   abilities as much as they want, then the defender may. If an effect adds
   characters to "the blocking party" during this step, the party isn't
   formed yet; those characters join once it forms in the next step (or
   become the blocking party if none forms — but "formation" effects don't
   fire in that case).

### Declaring blockers (CR §608.1d)

1. The defending player may choose any number of non-depleted characters
   they control to block; they form the blocking party. Declaring does
   **not** deplete blockers.
2. **(CR §507.3b / §507.3c)** Only covert characters may block a covert
   party, and covert characters may block *only* covert parties. **(CR
   §302.11b)** Whether the party is covert is locked when blocking is
   declared — later keyword changes don't retroactively legalize or void a
   block.
3. **(CR §412) Unblockable.** While every member of a battle party is
   "cannot be blocked," the defender may not form a blocking party at all.
   (Effects that *add* a character into the blocking party still work.)
   **(engine-derived)** the `cannotBeBlocked` keyword; `declareBlockers`
   rejects a non-empty defender-declared blocking party while the whole
   attacking party has it.
4. Face-down cards (resources) are not characters and cannot block.
5. **(engine-derived) Party-composition / block-eligibility restrictions.**
   - A character in a *forming* party (attacking or blocking) can constrain
     that party's legal size or parity — `ContinuousAbility.partyRestriction
     { role, minMembers?, parity? }`. `declareAttack` / `declareBlockers`
     reject a declaration that violates it. "must have an even number of
     members" (Insect Appreciator), "at least 2 members" (Anxious Oaf).
     When several requirements bear on one attack and cannot all be met
     (two "must attack" characters under a one-member limit; Hangdog Alley
     with Arcana Department, FAQ 20), the attacking party must satisfy at
     least one and as many as any other attack could (CR §505.2, 505.2c);
     a lone unmet requirement still refuses the attack (CR §505.1).
   - An *attacker* can constrain who may block it / its party —
     `ContinuousAbility.blockRestriction { minBlockingPartySize?,
     minBlockerSpeed? }` (static, gated by `ability.condition`), or the
     `restrictBlockers` effect (a "this turn" grant with its own
     `condition`). "only parties with at least 3 members can block it"
     (LeoKaiser), "only characters with at least X speed" (Wild Boars).
   - `restrictBlockersToChosen` (on a `characterAttacked` trigger) lets the
     attacker's controller-of-the-target pick the *only* characters that may
     block this battle; each of them that legally can, must (Wyrmfang
     Deathskull). Stored as `BattleState.chosenBlockers`.
6. **(CR §608.1e)** Once blockers are declared the battle is *resolved*
   (§609). CR 2.5 opens **no** dedicated response window between the block
   declaration and resolution — the first battle-resolution response
   window is §609.1a below. **(engine-derived)** `declareBlockers` runs
   its `characterBlocked` / `blockingPartyFormed` / `attackerBlocked`
   triggers and then goes straight into the §609.1a window for the first
   speed group.

### Resolving the battle (CR §609.1)

Repeating rounds, highest speed first, attacker before defender within a
round:

1. **(CR §609.1a)** Response window (attacker, then defender).
2. **(CR §609.1b / §609.1c)** X = the highest speed among battle characters
   that haven't yet assigned battle damage this battle. **X is fixed here,
   *after* the §609.1a window** — a speed change made during that window
   still counts. **(engine-derived)** `enterDamageAssignment` computes X
   once the window closes (not when the round was set up), so an
   instant-speed pump/debuff played in the window moves the character
   between speed groups as expected. Every **attacker** at speed X assigns
   damage equal to its strength, divided as the attacker chooses among the
   blocking party — or, if no blocking-party members remain, among the
   target (faction/location).
3. **(CR §609.1d)** Every **blocker** at speed X assigns damage equal to its
   strength, divided as the defender chooses among the attacking party.
4. **(CR §609.1e)** Response window (attacker, then defender).
5. **(CR §609.1f)** All damage assigned this round is inflicted
   simultaneously. **If several instances hit the same target, their sum is
   inflicted as a single amount.**
6. **(CR §609.1g)** Repeat from step 1 until every character in the battle
   has either assigned battle damage once or is no longer in play / in the
   battle.
7. **(CR §609.1h)** Deplete all surviving characters that were in the
   battle.

**(CR §609.2 / §407.5a / §408.1b / §408.2a)** If a character has nothing
left to assign to (its target was destroyed earlier in the battle, a
targeted location's controller changed, or the assigned amount came out to
0), it does nothing but still counts as "having assigned" for ending the
loop — the resolution loop never repeats infinitely.

**(engine-derived)** The amount a character assigns is its strength
**floored at 0** (CR §410.4 — a value pushed below 0 stays at 0): a
character debuffed to 0 or negative strength assigns nothing and still
counts as having assigned. `getBattleView().damageSources[].strength` and
the `assignBattleDamage` "must assign exactly N" check both use
`max(0, strength)`.

### Damage (CR §408)

- **Character:** destroyed once its damage *this turn* is ≥ its life,
  checked continuously (CR §408.4; §11). **(CR §408.8)** it is considered
  destroyed *by* the damage instance that pushed it over.
- **Location:** destroyed once its accumulated damage markers are ≥ its
  structure (CR §408.5).
- **Faction:** **(CR §408.3)** damage inflicted on a faction makes it lose
  an equal amount of influence. This *is* damage — **(CR §408.2)** damage
  increase and reduction effects apply to it, and "when damage is inflicted"
  triggers fire — and only the influence-loss half is exempt from
  damage-modification. **(CR §408.3b)** A *direct* "loses N influence"
  effect is not damage and ignores all damage modification. **(CR §309.1b)**
  "pay" is never influence loss.
- **(CR §408.1 / §408.1a)** An attempt to inflict 0 damage inflicts nothing
  and triggers nothing (but a battle-damage source still counts as having
  assigned, CR §408.1b).
- **(CR §408.6, FAQ) Battle damage** is *only* the damage inflicted through
  the battle-resolution steps above. Damage dealt by a tactic, ability, or
  trigger *during* a battle is **not** battle damage and doesn't interact
  with battle-damage-specific rules or cards.
- **(CR §408.7)** The source of inflicted damage is the card that inflicted
  it; for battle damage, the character that assigned it.
- **Removed from battle (CR §302.15).** A character leaves the
  attacking/blocking party immediately if it is destroyed, if its control
  changes (CR §407.4), or if it loses the character type (CR §208.4) —
  including being turned **face-down** mid-battle (a face-down card is only
  a resource, §4 / CR §411.1), e.g. an attacker using its own *Backdoor
  Brigand* EXIT STAGE RIGHT "in response to its own attack". Any battle
  damage already assigned to **or by** it is **not** inflicted; the removed
  character never becomes a battle-damage source. If that empties the
  attacking party the battle just ends (no blocker step against nothing).
  A brief `characterLeftBattle` event is emitted so a log/UI can show why
  an attacker or blocker vanished (a bare face-down flip is otherwise a
  silent `play -> play` move). **(CR §407.6)** An effect that would add a
  character you don't control to a party you do control is terminated.
  **(CR §407.5)** If the target of the attack is a location whose
  controller changes mid-battle, it stops being the target.

**(engine-derived)** Per CR §609.1f + §408.2, battle damage from several
characters to one target in a speed group is summed first, then
`ContinuousAbility.damageModifiers` ("reduce battle damage to your
characters by 2") acts *once* on that sum, floored at 0
(`inflictLockedBattleDamage`). The summed final amount then applies — as
damage to a character/location, or as influence loss for a faction, which
runs through the same modifier pass before it converts (CR §408.3). Only a
direct "loses N influence" effect bypasses it (CR §408.3b). Each
contributing character still emits its own `damageDealt` (CR §408.7), with
the final amount distributed across them.

**(engine-derived)** "Control changes" is the `takeControl` effect — the
only thing that gives a card in play a different controller (a card leaving
play is released to its holder, §2); it also moves the card between
the players' `play` arrays, and drops the card from both battle parties on
the spot (`reassignControl`, CR §407.4). `isCardStillInBattle` also checks
`controllerId` against the attacker/defender **and** that the card is still
a character (`hasCardType`), so party pruning covers a type loss /
face-down flip too. `inflictLockedBattleDamage` skips any assigned damage
whose target is no longer in a party (CR §302.15, §407.4a), or whose
location target's controller has changed (CR §407.5:
`getAttackTargetAsBattleDamageTarget` offers no target then, the attackers
still count as having assigned). A control change also clears attack
eligibility (CR §608.1b: a character that left your control and came back
this turn cannot attack). A permanent `takeControl` is the most recent
control effect (CR §407.3a) and cancels any older timed grab's reversion,
even when it changes nothing. An activated ability used by its card's
controller (`StackItem.followsSourceController`) resolves under whoever
controls the card at resolution (CR §407.1a). The face-down / type-loss case is
also caught eagerly by `checkStateBasedActions` (which now inspects
face-down cards for this one check), so the party shrinks the instant the
flip resolves rather than at the next battle step.

## 9. Keywords (CR §507)

**(CR §507.1)** A card has a keyword when it's printed in bold on the card
or granted one by an effect ("gains a keyword" = temporary rules text, CR
§508.2). Merely *mentioning* a keyword in text doesn't grant it.

- **Covert (CR §507.3).** A party of all-covert attackers is a covert party
  (§8). **(CR §507.3d)** "gains covert" means the character genuinely has
  the keyword. **(CR §507.3e)** A card can't hold two instances of covert —
  extra copies vanish. **(CR §302.11a)** if any member of a covert party
  loses covert mid-battle the party stops being covert immediately (but
  existing blocks stand, CR §302.11b).
- **Tactical (CR §507.6, card-verified).** The card may be deployed any time
  you could deploy a tactic, whatever its real type. **(CR §507.6b)**
  Tactical is active even while the card is a face-down resource or in your
  hand. Once in play it obeys its type's normal rules (a Tactical character
  still needs a legal target and resolves into `play`, not `discard`).
- **Aggro (card-verified).** Exempts the character from the "must have
  started this turn under your control" attack-eligibility rule (§6); a card
  that enters play this turn with Aggro may still attack this turn. *(Not
  enumerated in CR §507's keyword list — a 2016-era omission; the printed
  card text governs per CR §101.1.)* **(engine-derived)** a card whose whole
  text is the haste clause ("can attack even if it has not been in play
  under your control since the start of the turn"; Guardforce Aggromajig) is
  authored as `aggro`. "Characters you control and deploy can attack …"
  (Hasty Pursuit) is the `grantKeywordToPlayer` effect — a turn-scoped grant
  of `aggro` to *every* character its controller has, including ones
  deployed later.
- **canBlockCovert / canBlockAnyParty (card-verified, engine-derived
  keywords).** `canBlockCovert` lets a non-Covert character help form a
  legal blocking party against a Covert attack (counts as Covert for that
  check only; Recyclable Golem). `canBlockAnyParty` is that *plus* an
  exemption from CR §302.11's "a Covert character may block only a Covert
  party" — so a character that is itself Covert (e.g. via an icon clause)
  can still block a non-Covert attack (Guardbeast of Thabbash — "can block
  COVERT parties and non-COVERT parties").
- **Unique X (CR §507.5).** You may not control more than one card carrying
  a given Unique identifier; if you do, you immediately choose one to keep
  and destroy the rest (**FAQ**: the controller chooses). The restriction is
  **per player** — your opponent controlling their own copy is fine. **(CR
  §507.5b)** If destroying an extra copy is prevented by an effect, Unique
  doesn't try again until the prevention ends. **(engine-derived)** The engine
  remembers which effect (a card in play, or a runtime replacement) took over
  the destruction and leaves that copy out of the Unique check until that
  effect is gone. One `uniqueSurvivor` answer destroys every other copy; the
  copies being destroyed no longer count, so no second question opens.

  **(engine-derived)** The designation is `CardDefinition.unique?: string`
  (assigned at import). "Choose one to keep" pauses on
  `GameState.pendingChoice` (kind `"uniqueSurvivor"`, listing every
  candidate); everything else stays blocked until the affected player
  answers with `resolvePendingChoice`.

  **Timing (user ruling Q53, 2026-10-21).** Unique is enforced *immediately*:
  the keep-one choice is asked as soon as the second copy is in play, BEFORE
  that copy's own "when this card enters play" trigger (and before that
  trigger's pick prompt) resolves. If you keep the new copy, its enters-play
  trigger then continues normally. If the new copy is the one removed
  (destroyed, or flipped face-down by its own "would be destroyed ... instead"
  replacement), it is treated as never having entered play: its enters-play
  trigger does not happen. The engine enforces this in
  `processImmediateQueue` (the check runs before any queued trigger) and in
  the `uniqueSurvivor` handler, which lifts the displaced copy's queued
  `cardEnteredPlay` triggers out of the queue.

  **Follow-up ruling (user, 2026-10-21).** A NEW copy (one that entered play
  during the current action) that the Unique rule removes is treated *as if it
  had never entered play*, so its removal triggers nothing at all: not its own
  "when this card is destroyed / leaves play" abilities, and not other cards'
  "whenever a card/character is destroyed / leaves play" triggers. It still
  ends up where the destroy (or its own "would be destroyed ... instead"
  replacement, e.g. flipping face-down) puts it. If the OLD copy is the one
  removed it is destroyed normally and every such trigger fires. **(engine-
  derived)** `recentlyEntered` (filled in `emit` on `cardEnteredPlay`, cleared
  at the start of each action except a `resolvePendingChoice` answer) identifies
  the new copies; `silentDepartures` marks the one being removed so `emit`
  raises no triggers (and no per-turn tally) for its `cardDestroyed` /
  `cardMoved`-from-play events.

- **Attach to X (CR §507.2).**
  - **(CR §507.2a)** Picking a legal target of type X is the *first extra
    cost* of playing the card; on resolution it enters play attached to that
    target.
  - **(CR §507.2b)** If it's put into play without a specified target, pick
    one as it enters.
  - **(CR §507.2c)** If there is no legal target to pick, or the chosen
    target is gone by the time the card would enter play, put the card into
    its owner's **discard pile** instead (it is *not* "destroyed").
  - **(CR §507.2d)** A card entering play simultaneously can be chosen as
    the target. **(engine-derived)** A `forEach` that puts several cards into
    play puts the Attach-to cards in after the others, so the others are in
    play when the host is picked.
  - **(CR §507.2e)** If the target later stops being type X, **destroy** the
    attached card immediately.
  - **(CR §301.4 / §301.4a / §301.4b)** If the target leaves play by any
    means (destroyed, removed, to hand, to deck), every card attached to it
    leaves play *the same way*; if the target's method of leaving play is
    replaced (§10), the attached card's is replaced too.

  **(engine-derived)** Declared via `CardDefinition.attachTo?: CardType`;
  playing the card adds a synthetic target declaration (reserved id
  `"attachTo"`). `CardInstance.attachedTo` is shared with the numeric-cost
  resource-attachment mechanic — the two never collide. A **tactic** with
  `attachTo` set (and no `selfDisposition`) resolves *into play attached* to
  the host it picked, instead of into the discard pile — "put this card into
  play attached to that character instead of into its owner's discard pile"
  (Infectious Pustulio, Ocular Dispersal, Unstable Modification, Will of a
  Living God); its triggered/continuous abilities are then live.
  `behavior.keepOnHostLeave: true` overrides CR §507.2c/§301.4 for that one
  card: when its host leaves play it stays in play, unattached, instead of
  going to the discard pile (Everlasting Blade of Light).

## 10. Abilities (CR §502–§506)

- **Activated (CR §502 / §606).** A named ability with a cost and an effect;
  only its controller may use it, at any time they could use an ability
  (including in response and at battle response points, CR §502.3). **(CR
  §606.1c)** all its costs must be satisfiable *at once* — no partial
  payment. **(CR §606.1a)** the ability may sit on a card you *own but don't
  have in play* — the "RECUR" / "EXHUMATION" abilities used from the discard
  pile. **(FAQ)** using such an ability is *not* "playing a tactic"; RECUR
  is an ability (it has a name, a cost, and an effect) regardless of the
  card type it's printed on. **(CR §502.4)** an ability resolves using its
  text *as written when you paid the cost*, even if the text later changes
  or its source leaves play.
- **EXTRA COST (CR §401.3, card-verified).** Any instruction in the cost
  section. Extra costs are completed in printed order (except "pay"
  instructions, which fold into the numeric total per CR §406.3). **(CR
  §401.3b)** a "lose X" extra cost can't be paid unless the card has X. A
  printed "EXTRA COST: …" on a card being *played* is a hard requirement: if
  it can't be paid, the card can't be played. It may be conditional —
  *Anatidaephobia*'s "if you did not deploy this using FLIP UP, pay X …"
  collapses to 0 when `deployedViaFlipUp`. **(engine-derived)** carried by
  the tactic-first-ability / `behavior.onPlay` cost convention.
- **Triggered (CR §503).** Keyed to *if / when / at*; fires automatically
  per §7; cannot be responded to. **(engine-derived)** "Once per turn, when
  ..." is `TriggeredAbility.usesPerTurn`: the trigger fires for the first
  matching event of the turn only (an event that fails its condition does not
  use it up); it is counted per card, resets every turn, and resets when the
  card enters play (a new object).
- **"Destroyed this turn" counts (engine-derived).** `destroyedThisTurn`
  counts the face-up cards destroyed since the turn began, by any cause and
  controller, including before the card reading it came into play ("X is the
  number of characters that were destroyed this turn" — Tempered Rage; CR
  §410.2 variables are explained by the card). A destruction a replacement
  turned into something else is not a destruction; a face-down card is a
  resource with no type to match (CR §411.1).
- **Continuous / Conditional (CR §504).** Always on while the source is in
  play; a "while X" conditional turns on and off the instant X becomes
  true/false, leaving no lingering state.
- **Replacement (CR §506, card-verified).** "if <X> would happen, instead
  <Y>" (*The Stone of Shame*, *Giada, the Elegant*). Checked *before* the
  event it replaces; when it applies, the original event never happens and
  the replacement runs in its place.
  - **(CR §506.2)** Replacements do **not** apply to things happening as
    part of an *extra cost* — destroying a card as a cost is not replaced by
    "if this would be destroyed…". **(CR §506.2a)** but a replacement on a
    card *attached* to that card still applies.
  - **(CR §506.3)** "the next …" replacements are *delayed* — they wait for
    the thing to happen.
  - **(CR §506.4)** If several replacements apply to the same event at once,
    the controller (or, across players, the active player) picks one; the
    rest are ignored — except an unchosen *delayed* replacement, which keeps
    waiting.
  - **(CR §506.5)** Infinite replacement recursion is prevented: each
    replacement may be applied to a given instance only once (two identical
    copies each get one application).
  - **(CR §506.6 / §408.4b / §408.5c)** A replacement that replaces a card's
    *destruction* reduces to 0 all damage that card received from the source
    of that destruction.

  **(engine-derived)** `ReplacementAbility` — consulted from inside
  `moveCard` (a card leaving `play` for a matched `zone`) and `destroyCard`,
  and **skipped entirely** when the move/destroy is
  being done to pay an extra cost (CR §506.2) — the cost-payment paths pass
  `skipReplacement`. The **mandatory** form runs its `effects` inline; the
  **optional** "you may … instead" form pauses on a `replacementChoice`
  pending choice for the source's controller. When two or more *different*
  replacements (and installed `installReplacement` ones) apply to one event,
  the engine pauses on a `chooseReplacement` pending choice (answer
  `{ kind: "chooseReplacement", index }`) for their one controller, or the
  active player when they differ (CR §506.4); identically worded ones (copies
  of a card) are not a choice. An installed `once` ("the next …") replacement
  is spent only when it is the one that applies (or is offered as an optional
  one), so an unchosen one keeps waiting. Each replacement applies at most
  once to the same card's event chain (CR §506.5): while one runs, it is not
  offered again for that card, but other replacements are (destroy → put into
  hand → destroy). Whenever a `destroy` replacement is *applied* (mandatory,
  or optional-accepted), the damage the affected card took from the source of
  the destruction is reduced to 0 (CR §506.6): damage is tallied per source
  card, a lethal-damage destruction is attributed to whoever dealt the last
  damage (all contributors of one battle damage step), and any other
  destruction to the card whose effect destroys it (which reduces nothing
  unless that card also damaged it). Damage the engine has no record of (a
  card set up already damaged) is all cleared on a lethal replaced
  destruction. `replaces.controlledBy` filters on *whose card* is
  affected; `replaces.by` (`"self" | "opponent" | "any"`) filters on *who
  initiated* the event — an unknown initiator (a bare state-based check)
  satisfies neither `"self"` nor `"opponent"`.
- **FLIP UP (CR §507.4, card-verified).** A card printed with "FLIP UP:
  <cost>" that you control face-down as a resource can be played as though
  from your hand by paying that cost and flipping it face-up, then meeting
  its Flip Up threshold (printed next to the keyword). **(CR §507.4b)** you
  pay the Flip Up cost *before* flipping, so the card may pay for its own
  Flip Up. **(CR §507.4c)** Flip Up extra costs are satisfied directly
  before the card's regular extra costs. **(CR §507.4d)** Flip Up does not
  change *when* a type may be deployed — a character still only on your
  turn, unless the card's own text says otherwise. **(CR §406.7 / §507.4e)**
  its numeric cost uses the normal running total but seeded at the Flip Up
  cost value, and at the end you pay the total *minus* the already-paid Flip
  Up cost. Its own text may branch on "if you deployed this card using FLIP
  UP." **(engine-derived)** the `flipUp` action + `deployedViaFlipUp` on the
  resolution context; flipping up opens no response window, but its effects
  run through the same suspendable effect-frame path as everything else.
- **Depleting / restoring (CR §303).** A card used to pay a deplete cost, or
  that attacks, becomes depleted and **(CR §303.2)** can't be depleted again
  until restored — and can't be restored unless currently depleted.
  Restoring normally happens via the controlling faction's turn-start
  restore rule or an explicit effect. Resources are never depleted (they're
  attached instead, CR §203.7): a `deplete` effect aimed at a resource (a
  face-down card included) does nothing.

**(engine-derived)** Damage and depletion are play-zone concepts (§2): any
card leaving `play` for any reason clears both `damage` and `depleted`
immediately, the same way it sheds `faceDown` / `attachedTo`. **(CR
§208.3)** losing the character type mid-turn also forgets that turn's
damage.

## 11. Continuous ("state-based") checks

**(CR §204.5, §207.5, §408.3a, §507.2e, §507.5a)** These are checked
*immediately* / continuously — the CR phrases each as its own "destroy it
immediately" rule rather than as one batched pass, but the effect is the
same: after every effect or resolution, in a loop until nothing changes —

- The seats are swapped while an odd number of `swapsSides` sources are in
  play, and swapped back when that stops being true (§12 "Seat swap"). This
  runs first, before anything below is judged against who controls what.
- Any character whose damage this turn is ≥ its life is destroyed (CR
  §408.4).
- Any location whose damage markers are ≥ its structure is destroyed (CR
  §408.5).
- Any player controlling more than one card sharing a Unique identifier
  reduces to one — by that player's choice (§9), not automatically; and not
  again while a prevention effect is suppressing the destruction (CR
  §507.5b).
- A card with **Attach to X** whose host is still in play but no longer type
  X is **destroyed** (CR §507.2e). If instead it has *no* host at all (none
  was pickable on entry, or the host has left play), it is **put into its
  owner's discard pile** — a move, not a destruction (CR §507.2c), which
  fires "put into a discard pile" triggers and honours discard
  replacements.
- Any faction at 0 influence loses the game for its owner immediately — a
  draw if more than one loses at once (CR §102.1 / §102.2). "At once" is one
  unit (§1): the check is made after every effect, but the game is decided
  when the unit in which a faction first reached 0 has ended, for everyone
  found out within that unit (`GameState.pendingLoss`, which also survives a
  save while the unit is parked on a player choice). While an
  `emptyDeckLoses` ability (Trickster's Globe) is live, a player with an
  empty deck loses in the same check. Checked last,
  after all destruction above settles. The owner is read from the faction
  card, not from the player currently holding it (a seat swap, §12).

**(engine-derived)** The whole check is skipped while a `pendingChoice` is
outstanding — the engine is frozen awaiting input, and an *optional
replacement* awaiting accept/decline deliberately leaves its
would-be-destroyed card sitting with lethal damage; re-running the check
would re-offer the replacement forever. Every `resolvePendingChoice` branch
re-runs the check once it has settled.

## 12. Miscellaneous rulings

- **(CR §101.1)** A card that directly contradicts the rules wins.
- **(CR §402.7 / §402.7a)** `"cannot"` always beats `"can"`. A "can do X"
  permission and an actual instruction to do X are different: "characters
  cannot be destroyed" makes every "destroy a character" instruction be
  ignored. **(No engine primitive — guidance for authoring structured
  `Condition`/`Effect` data.)**
- **(CR §402.6)** When one ongoing effect grants a property and another
  removes it, the *lose* effect wins.
- **(CR §402.5)** An instruction you can't fully carry out is carried out as
  far as possible and the rest ignored — it does not invalidate the whole
  effect. **(CR §402.5a)** effects never "fizzle" just because their target
  left play. **(CR §402.5b)** but an instruction that *depends* on an
  earlier one you skipped/replaced (typically an "If you do …" clause) is
  itself skipped. **(CR §402.5 / §409.2 / §409.3a, engine-derived)** A card
  an effect names that no longer exists — a token that left play disappears
  — is simply not affected: damage, depletion, counters, control, moves,
  keyword grants and the like against it do nothing, and the rest of the
  resolution carries on. An Attach-to card whose target is gone when it tries
  to enter play goes to its owner's discard pile (§9, CR §507.2c).
- **(CR §402.4)** When a card changes game areas, unresolved effects that
  meant to act on it in the old area lose track of it (a character
  destroyed in response to "put it into your hand from play" is not then
  fetched from the discard pile).
- **(CR §402.2 / §305.2 / §306.3)** When an effect makes several players act
  "at the same time," the active player acts first, then clockwise.
  Discarding multiple cards, or drawing multiple, happens as one group event
  — **(FAQ)** but repeated separate triggers ("draw a card" three times from
  *Dwarvish Grimalkin*) are three distinct events, each separately
  modifiable.
- **(CR §410.4 / §406.6)** Any number an effect would push below 0 stays at
  0. **(CR §410.5)** "to a minimum of N" doesn't raise a value that was
  already below N. **(CR §410.2)** chosen variable numbers must be whole
  numbers (0 counts).
- A cost variable (`X`, …) never assigned because the card was played for
  free defaults to 0. **(engine-derived)** not yet exercised —
  `NumberExpression` has no "unassigned variable" form today.
- **(CR §312.2)** You may always choose to *fail* a search that has specific
  criteria ("search for an item"), even if a legal card is present; an
  unconditional "search for a card" must find one if the deck has any.
- **(CR §313.2)** "Shuffle X into a deck" only shuffles if at least one card
  is added.
- **(CR §505.2, FAQ)** When several requirements apply to one action, do the
  one that satisfies the most of them; if tied, you choose (**FAQ**:
  *Hangdog Alley* + *Arcana Department*; two cards each forcing "must pick
  this" — pick one, ignore the other, and only the picked one counts as
  picked). Not taking the action at all is never a valid way to "satisfy"
  its requirements (CR §505.2c).
- **(FAQ)** *Tactician Vacation* closes the tactic-play window for the rest
  of the turn, which also closes every "can be played whenever you could
  play a tactic" (Tactical) window — though such a card can still be played
  at the times it *normally* could be.
- **(engine-derived — MUSTACHE SHOWDOWN)** *Mustache Aficionado* ("You and
  an opponent look at the top 3 cards of your decks and divide them into 2
  face-down piles ... Each of you choose one of their opponent's piles.
  Reveal ... the owner of the higher-total-cost pile may put one card into
  their hand. Shuffle the remaining cards into their owner's deck.") is the
  `partitionAndPick` effect. Sequence, one player at a time (controller
  first): each reveals the top *N* of their own deck and splits them into
  *K* non-empty piles (`partitionCards`); each picks one of the *other*
  player's piles (`pickPile`); the two chosen piles' total numeric `cost`
  is compared; if one is strictly higher its **owner** may move up to
  `winnerTakes` of its cards to hand (`takeFromPile`); a tie means nobody
  takes. Every card not taken stays where it was (on top of its owner's
  deck) and both decks are then reshuffled. The revealed cards never leave
  the deck zone — only a taken card moves (to hand).
- **(engine-derived — reveal top N, pick, bottom the rest)** *Rosy Palmer,
  and Her Five Friends* ("reveal the top 5 cards of an opponent's deck. You
  may choose a revealed character ... put it into play ... That player puts
  the remaining cards on the bottom of their deck in any order.") composes
  from a `CardSelector.fromTop: 5` (a `chooserSelectsTarget` whose
  candidates are only characters among the opponent's top 5) → `putIntoPlay`
  → `lookAndReorder` with `to: "bottom"` and `count` = 5 − (cards taken),
  driven by that deck's owner. The un-revealed cards below the top 5 keep
  their positions; only a taken card and the bottomed leftovers move.
  `lookAndReorder` also takes an optional `chooser` (default = the deck's
  owner) so a card can have *another* player reorder your top cards.
- **(engine-derived — a deck search as an event)** "Search your deck for
  ..." has no dedicated action, so the engine treats a `chooserSelectsTarget`
  effect whose declaration selector names the `deck` zone as a search and
  emits a `deckSearched { playerId }` event (`playerId` = the deck's owner)
  once the pick is the outstanding choice — so a trigger on it resolves
  right BEFORE the pick is offered (E10e, so a trigger's prompt is answered
  first, then the pick runs). *Golden Charm* ("If a player would search
  their deck you may pay 1 instead. If you do, draw a card and then that
  player searches their deck.") is a `deckSearched` trigger → `mayPay`
  (pay 1 → draw 1); the draw happens before the search, so a card the draw
  takes can't be found. A search whose card is named up front (`targets` on
  the `deck` zone, no `fromTop`: Goldmau INVEST, SERAPHIM FUSION) emits it
  when the ability starts resolving, and the picks' zones are recorded
  after the trigger resolves.

**(engine-derived)** Every *effect* (post-cost, already-committed) that
resolves a `TargetRef`/destination silently no-ops instead of throwing when
the reference doesn't resolve to a card — a `{type:"random", selector}` ref
matching nothing, a `destroy`/`removeFromGame` whose target a sibling effect
already handled. This is **not** extended to cost payment: a `destroy`
**cost** still throws if its target isn't a legal in-play card, since an
unpayable cost must block the whole activation (§4/§10).

**(engine-derived — Volition-era additions, all in `BEHAVIORS.md` → "Shade
of the Devoured Emperor additions")**

- **CR §408.3 for non-battle damage.** The `dealDamage` *effect* (and cost)
  now converts damage dealt to a faction card into an equal influence loss
  immediately — a faction never accumulates damage markers (it did nothing
  before; battle damage already did this). The damage-modification pass
  (`damageModifiers`, shields) still runs first; a direct `loseInfluence`
  cost bypasses it (CR §408.3b).
- **"loses all other rules text."** A `ContinuousAbility.suppressAllAbilities`
  turns off every *other* ability of the matched card(s) — the CR §402.6
  "lose beats grant" principle applied at the ability level. The suppressing
  ability itself is exempt, so "loses all other rules text **and** loses 1
  speed" keeps its own −1 speed.
- **"cannot be picked" (§9/§12).** A `cannotBePicked` restriction removes a
  card from the legal-candidate set of every player-or-chooser *target
  declaration*, but not from `forEach` / `count` / aura selectors or random
  selection — "cannot be picked" blocks *choosing*, not being swept up.
- **"can attack only once each turn."** `attackOncePerTurn` — `declareAttack`
  rejects a character that has already been declared as an attacker this
  turn (tracked in `GameState.attacksThisTurn`, reset each turn), regardless
  of whether it has since been restored.
- **"opponents cannot take control of this card."** `cannotBeTakenControl`
  — a `takeControl` that would change the controller is skipped.
- **Redirect (6r4wny 60dy9u4rd5).** `ContinuousAbility.redirects: [{ from,
  to }]` — while active, damage that would be dealt to `from`, and any way
  `from` would leave play, is applied to `to` instead (and `from` is
  spared). CR §301.4-style "leaves play the same way": `moveCard` /
  `destroyCard` re-issue the identical event on `to`.
- **Borrowed entrance (Barracks of Precipitancy — GO TIME).** A
  `putIntoPlay` with `borrowed: true` sets a per-instance flag; `moveCard`
  redirects any leave-play of that card to `removed`, and it is removed from
  the game outright if still in play at end of turn.
- **Threshold reduction (Clockman Skydocks).** `reduceThreshold` lowers the
  *next* deploy's printed-threshold requirement of one named icon by N for
  its controller (a per-player one-shot, cleared by the next deploy and at
  end of turn); the numeric cost is untouched (that's `reduceNextCost`).
- **Modal tactic.** `behavior.modes` — the `playCard` action's `mode` index
  selects which of "Choose one of the following as this card's rules text"
  blocks supplies the play-time condition / costs / targets / effects. The
  unchosen modes' EXTRA COSTs and targets never apply.

**(engine-derived — 1st Edition Part 2 additions, all in `BEHAVIORS.md` →
"1st Edition Part 2 additions")**

- **Coin flips.** `flipCoin` resolves a fair coin off the seeded RNG and
  runs `winEffects` / `loseEffects`; it emits `coinFlipped { playerId,
  won }`. A `ReplacementAbility` `replaces: { event: "coinFlip", result:
  "lose" }` (optional + `optionalCost`) may intercept the *loss* for that
  player: the engine re-rolls once, adopts the new result, then runs the
  replacement's `effects` as a rider (Two-Headed Coin — "shuffle this card
  into its deck, reflip, and use that result instead, and draw a card").
- **Damage-amount clamp.** `DamageModifierDefinition.minAmount` / `setTo` —
  in the same pre-inflict pass as `delta`, an incoming amount `>= minAmount`
  to a matching card is set to `setTo` (default 0). Distinct from
  `preventDamage.wholeInstance` (a one-shot pre-registered shield). "any
  amount of damage greater than 4 … reduce it to 0" (Class Action Defender —
  `minAmount: 5`).
- **`destroyedByBattleDamage`.** `cardDestroyed` now carries
  `byBattleDamage?` (set when the lethal instance came through
  `inflictLockedBattleDamage`), read by the same-named condition
  (Venomous Sacspider).
- **Timed take-control.** `takeControl` gains `duration?`; the reversion
  target is captured before the grab and control snaps back at the
  start-of-turn sweep (Mutiny Grant — "This turn, take control …").
- **Ability cost modifier.** `ContinuousAbility.abilityCostModifiers` tunes
  the `payResources` portion of matching activated abilities (`scope`:
  `factionAbilities` / `self` / `controlledCharacters`), floored at each
  modifier's `minCost` (F.U.M.A.S.T. — "reduce your faction's abilities'
  cost by 1, to a minimum of 1"). Deploy cost is still `costModifiers` /
  `reduceNextCost`.
- **Copy rules text.** `grantAbilitiesFrom` snapshots a card's printed
  activated/triggered abilities onto another card, live while the recipient
  is in play (Skin Suit). Continuous / replacement text isn't copied.
- **Out-of-turn attack.** `initiateAttack` declares and fully resolves one
  battle mid-effect, bypassing turn/eligibility timing; the effect list's
  remainder runs as an `endOfBattle` rider (Counter Attack — "Attack that
  player. … resolve the battle immediately and before you draw the card").
- **Bidding (Auction House).** `auctionForCard` reveals from the top of a
  deck until a character, then takes bids clockwise from the active player
  across every player still in the game (MPX-bid), skipping players who have
  passed, each capped at the bidder's detached-resource count; it ends when
  every player but the high bidder has passed, and the winner pays that many
  (attach to faction) and puts the character into play; the rest reshuffle.
  `auctionBid` pending choice, `{ bid: 0 }` = pass. The first bidder
  passing, and everyone passing, are open points (RQ-r11-3) at every table
  size: a player who is not the high bidder and has not passed is still
  asked, and if everyone passes the character returns to the deck.

### Ungodly Mess additions

- **Distinct counting.** `{ type: "distinctCount", selector, by }` — the
  number of distinct `name` / `trade` / `subtype` / `type` values across the
  matched cards. "for each different staple resource you control" (Elite
  Acrolos Engineer); "different trades among cards you control" (Wary
  Reunion).
- **Resource attachment selector.** `CardSelector.attachedToFaction` filters
  resources by whether they're attached to a faction (spent this turn) or
  detached (available). "the number of detached resources that player
  controls" (Flesh Deliquesce) = `count { type: "resource", attachedToFaction:
  false }`.
- **FEALTY threshold slack.** `CardDefinition.thresholdSlack { condition,
  amount }` — while `condition` holds and the card is in hand, its printed
  threshold is met whenever the holder is at most `amount` icons short in
  **total** across all icon types ("reduce this card's threshold requirement
  by any N resource icons"; no per-icon choice — CR treats it as a flat
  deficit allowance). The blade-of-questionable-morality Uniques.
- **Granted continuous text.** A `ContinuousAbility.grantedAbilities` block's
  **continuous** members are now honored (previously only triggered /
  activated), sourced on the recipient card — so a granted aura like "All
  your characters gain 1 strength" scopes to the recipient's controller and
  ends when the recipient or grantor leaves play. The "God's Blessing of
  ___" attach-mutation cycle.
- **Blocker exclusion.** `blockRestriction.blockerMustNotMatch` — a
  character matching this selector is not a legal blocker against the source
  (Feckless Chronicler, Silencer). Whole-party "cannot be blocked" stays the
  `cannotBeBlocked` keyword.
- **Standing play grants / restrictions.** `ContinuousAbility.voidPlay`
  (deploy matching void cards as though from hand while `condition` holds —
  Voidal Tactician), `playRestrictions` (standing "cannot play X" / "cannot
  use FLIP UP", optionally only while the target is not the active player —
  Lockbox of the Aeons, Geldale), `restrictReturnToHand` (a card owned by
  the named player can't be moved to a hand from the listed zones — the move
  fizzles; Lockbox of the Aeons).
- **Blanket windows (Limited Liability).** `preventAllDamage` — every damage
  instance is reduced to 0 for the duration. `restrictDestruction` — the
  `destroy` *effect* is inert for the duration, and so is lethal-damage
  state-based destruction (a character left with damage >= life waits until
  the window ends); a `destroy` *cost* and `removeFromGame` are unaffected
  ("cards … can only be destroyed by costs"). Damage inflicted as a *cost*
  ignores a `preventAllDamage` window authored with `exceptCosts: true`
  ("this does not affect paying costs" — Open Beta / 1st Edition); the 2nd
  Edition and Ungodly Mess wording has no such exception, so cost damage is
  reduced to 0 there.
- **Terminating an end-of-turn announcement (Lost on Floor 3).** The
  condition `endOfTurnDeclared` holds while the player's announced end of
  turn (CR §610.1) is pending — an open `endTurn` response window for them,
  or a battle started inside one (`BattleState.resumeEndTurn`). Only the
  opponent responds to the announcement (CR §607.1), so a card gated on it
  can only be played in response to one of the opponent's cards or
  abilities — the card's reminder text. The `terminateEndOfTurn` effect
  cancels the announcement (CR §314.2): the window becomes a plain `action`
  window with no queued responders, so once the chain in it resolves the
  turn goes on, and a battle started in it no longer re-opens the end-of-
  turn window when it ends. The player may announce the end of the turn
  again later — the terminated announcement did not end the turn
  (CR §603.2d). **(engine-derived)** A FLIP UP of the card keeps its
  EXTRA COST timing like any deploy.
- **Mill instead of faction damage (Trickster's Globe).**
  `ContinuousAbility.millInsteadOfFactionDamage`: damage its controller would
  inflict to an opponent's faction — a battle damage step's amount for that
  faction, or a `dealDamage` effect of theirs — pauses on a
  `millInsteadOfDamage` choice once the amount is final (after damage
  modifiers and other damage replacements, before prevention shields).
  **(engine-derived)** "for each damage ... up to that many cards" is read
  per point: the controller picks a count from 0 to the amount (capped at
  the cards in the faction owner's deck); that many cards go from the top of
  the owner's deck to their discard pile and the rest of the damage is
  inflicted. A battle step waits for the answer before any of its damage
  lands (`BattleState.factionMill` holds it); an effect's remaining
  instructions run after the answer. Damage paid as a cost is not offered.
- **Empty deck loses (Trickster's Globe).** `ContinuousAbility.
  emptyDeckLoses`: while live, the §11 victory check also makes every player
  whose deck is empty lose — the card overrides CR §102.1a (§1). It is
  checked together with 0 influence (two losers at once = a draw) and is not
  shielded by `preventsDefeat`, which only covers 0 influence.

### Open Beta additions

- **Influence-loss modifiers (`engine-derived`).** `ContinuousAbility.
  influenceModifiers` tunes the magnitude of an influence change to a
  faction, floored so a loss can't flip to a gain. It is applied to the
  `modifyInfluence` effect and every CR §408.3 damage→influence path (via a
  single `applyInfluenceDelta` choke) **and** to influence paid as an
  explicit `loseInfluence` cost (user ruling Q24, 2026-10-20: "loses
  influence" has no exception for costs, so a 3-influence cost costs 2 under
  Tax Attorney and 3 costs 4 under Gideon; the modified amount must be
  affordable). "When your faction loses influence, reduce the amount by
  1" (Tax Attorney).
- **Influence lost this turn, and "set your influence" (`engine-derived`).**
  `GameState.influenceLostThisTurn` (per player, cleared each turn) records the
  influence a faction actually lost, at the `applyInfluenceDelta` choke and in
  the `loseInfluence` cost: damage (CR §408.3), a negative `modifyInfluence`,
  an influence cost; after `influenceModifiers` and the floor at 0 (CR
  §410.4). Read by `lostInfluenceThisTurn` ("if an opponent's faction lost
  influence this turn", Shriever General). `setInfluence` + `factionStartingInfluence`
  ("set your influence to your faction's starting influence", Siluriformes
  Incarnate; the printed number on the face-up side, CR §202.3a): the CR has no
  rule for "set", so it is read literally -- the influence becomes exactly that
  number, which is neither a "gain" nor a "loses influence" (no
  `influenceModifiers`, not counted by `lostInfluenceThisTurn`).
- **A replacement sees a resolving tactic (`engine-derived`).** `moveCard` consults
  every `moveToZone` replacement for a card leaving `deploying` for any zone but
  play, so "if a card would go to a discard pile from anywhere, void it instead"
  (Purifier of the Fallen) voids a tactic that finishes resolving (CR §205.2) as
  well as a destroyed or discarded card; `replaces.from` (`play`, `hand`) still
  excludes it. Before, only runtime replacements saw that move.
- **Suppressing the 0-influence loss (`card-verified`).**
  `ContinuousAbility.preventsDefeat` removes the matching faction from the
  "faction at ≤ 0 influence loses" state-based check while the source is in
  play. "You do not lose the game because your faction has 0 influence"
  (Armored Keep). It suppresses an existing loss condition — it does not add
  a new win/lose condition.
- **Attack tax (`card-verified`).** `ContinuousAbility.attackTax` — the
  matching player pays N resources as part of declaring an attack (charged
  in `declareAttack`, before anything depletes); if unpayable the attack is
  illegal. "Each opponent must pay 2 to attack" (The Ministry of Other
  Smaller Ministries).
- **Draw modifiers (`card-verified`).** `ContinuousAbility.drawModifiers`
  changes how many cards a player draws (only for a real draw — amount > 0),
  or prevents drawing entirely. Beatrix Winterbottom.
- **Runtime replacements (`engine-derived`).** The `installReplacement`
  effect registers a "would-X-instead-Y" replacement for a `duration` (incl.
  `endOfBattle`), consulted alongside card `ReplacementAbility`s. "If the
  character would be destroyed during this battle, take control of it
  instead" (Sarcophyle Matriculation) — the one-shot form of Vander
  Malagut's continuous replacement. A `destroy` one takes the same
  `controlledBy` / `by` / `bySource` scoping as a card's own replacement,
  relative to the installer (its controller when the effect resolved, even if
  the source card is gone): "This turn, characters you control cannot be
  destroyed by cards or abilities your opponents control" (Escort Ally) is
  `{ event: "destroy", cardType: "character", controlledBy: "self", by:
  "opponent" }` with no `effects` (the destruction just does not happen).
  The cause is the engine's `currentCause` / `currentCauseSourceId`: every
  effect (so a tactic, an ability, a trigger, a "destroy" option) sets it to
  its own controller and source card as it resolves; a player's action sets
  the acting player; lethal damage is attributed to whoever dealt it (battle
  damage has a player but no source card); the destructions the
  state-based check performs by itself state their own cause (a
  self-destroying threshold paragraph: its own controller and card; a
  wrongly attached card, CR §507.2e, and the Unique rule, CR §507.5: none,
  the game rules). A replacement's own effects do not leak their cause into
  the replaced event. A destroy paid as a cost is not replaced (CR §506.2).
  **(rules reading, open)** lethal battle damage dealt by an opposing
  character counts as destroyed "by cards or abilities" an opponent
  controls (`by: "opponent"`, as for Giada): CR §408.7 makes the assigning
  character the source of battle damage and §408.8 says a card is destroyed
  by the damage that put it over its limit. The narrower reading (effects
  only, `bySource`) leaves battle damage through; see the beh-11 notes
  `rulesQuestions`.
- **Hand-move redirect (`card-verified`).** `redirectHandMoves` — a runtime
  window sending any card that would enter a hand (from any zone) to another
  zone instead. "if a card would be put into a player's hand, put it into
  their discard pile instead" (Quotidian Misfire).
- **Borrowing opponent abilities (`card-verified`).**
  `ContinuousAbility.canUseOpponentAbilities` lets the controller activate
  activated abilities on the opponent's cards. The effect, the threshold and
  every non-numeric cost resolve with the opponent as the ability's
  controller. Who pays the numeric (`payResources`) cost is per printing, as
  The Billionaire prints it. `true` (2nd Edition: "you must pay any numeric
  cost with your own resources. Any additional costs must be satisfied as
  though your opponent is using the ability"): the activator's resources.
  `"asOpponent"` (1st Edition and Open Beta: "as though you were your
  opponent. (The effect still happens to your opponent.)"): every cost,
  numeric included, is paid as the opponent, out of the opponent's resources
  and cards, matching CR §401.2a ("satisfy a cost as though you were your
  opponent"). Either way `getAvailableActivatedAbilities` lists the ability
  only when its costs can be paid by whoever pays them. CR §401.2a's limit
  ("only with the knowledge you currently have") is enforced for hands: the
  borrowed use's context carries `payerId` (the activator), and a `discard` /
  hand-zone pick from the opponent's hand (`costPickCandidates`) has no
  candidates unless an ongoing `grantsReveal` effect currently reveals that
  hand.
  When live sources disagree, `true` wins. Duplicating a tactic (`duplicate`) asks the
  duplicator for the copy's play-time target picks anew (CR 307.1: the copy has all
  the rules text, extra costs included) and, for a modal tactic (`behavior.modes`),
  for a new option (CR 307.2) together with that option's own picks. The copy also
  pays the tactic's extra costs again, through the ordered cost list: the duplicator
  makes the cost's own picks (discard / move / destroy a card, name a value), the
  `payCosts` effect rehearses and pays the steps (numeric cost last), and a copy whose
  costs cannot be paid is invalid and has no effect (CR 307.1). The copy's numeric cost
  is 0, its X is the original's. While the duplicator is restricted from playing
  tactics (`restrictPlay` of tactics, a standing play restriction), a duplicate they
  create is terminated immediately and does nothing (CR 307.3).
- **Seat swap (`engine-derived`).** The CR defines neither "seat" nor
  "side", so this is the engine's reading of Emergency Obfuscation (TACTICAL
  item): "While this card is in play, both players switch seats. Both
  players are in control of their opponent's side. If the game ends, the
  owner of the winning deck wins the game."
  - A *side* is a faction plus every card in play under one player's
    control (resources included). `ContinuousAbility.swapsSides` is checked
    with the state-based actions (§11), so it takes hold the moment the
    source enters play and ends the moment it leaves: while an **odd**
    number of live sources are in play (`GameState.seatSwap`, the
    `seatsSwapped` event, `GameFlowView.seatsSwapped`), control of every
    card in play — both factions and the source itself — has passed to the
    other player; two sources cancel. A card that "cannot be taken control
    of" (Gigantitect's Giant Giant) keeps its controller.
  - The players also exchange `factionId` / `influence`, so "your faction"
    is the faction you hold: its develop / restore / start-of-turn rules
    are the ones that apply to you, resources you pay are attached to it,
    and "your opponent's faction" is the one the other player holds.
  - Ownership never changes (CR §407.8). Hands, decks, discard piles, the
    void and the removed zone stay with their owners (CR §305.1, §403,
    §407.7): each player still plays cards from their own hand, draws from
    their own deck, and discards to their own pile. The turn, priority and
    who may act are by player and unaffected; "your turn" on a card is its
    controller's turn (CR §407.2), so the source's own token clock runs on
    the *other* player's turns once it has swapped sides.
  - A control change takes a character out of a battle (CR §407.4), so a
    swap in the middle of one empties both parties.
  - A faction at 0 influence still loses the game for its **owner** (CR
    §102.1; §11 victory check) — "the owner of the winning deck wins". An
    attack therefore always lands on the faction the *attacker* owns.
  - A card that enters play while swapped is controlled by whoever plays it
    (CR §204.2a, §407.1) and is not part of the exchange; lifting the swap
    returns only the cards it exchanged that are still in play under the
    controller it gave them, and a later permanent "take control" wins over
    it (CR §407.3a).

### 1st Edition additions

- **`restrictParty` effect (`card-verified`).** The "this turn" form of a
  party-composition restriction (min/max members, parity) scoped to a
  forming party that includes a target card — parallel to `restrictBlockers`
  vs `blockRestriction`. Carnival King (CONGA LINE).
- **`partyRestriction` scope `"attachedParty"` (`card-verified`).** A gear
  item's `partyRestriction` bites a forming party that includes its *host*.
  Spiky Atlasphere.
- **Discard replacement scope (`engine-derived`).** Resurrection Emporium's
  "if a character would be put into your discard pile, remove it from the
  game instead" is authored as a `moveToZone` `zone: "discard"`
  `ReplacementAbility`; it fires only for a character leaving *play* (the
  `applyReplacement` `from === "play"` guard), not one milled straight from
  the deck — a documented concession.

### Seed additions

- **`ContinuousAbility.preventsAttackOnFaction` (`card-verified`).** While
  the source is in play, `declareAttack` against the matching faction is
  illegal. High Court of Demands, Theocratic Senate of Marduun ("your
  opponents cannot attack your faction").
- **`ContinuousAbility.attackLimitPerTurn` (`card-verified`).** A per-player
  cap on how many separate attacks may be declared in a turn
  (`GameState.attackDeclarationsThisTurn`, reset at the start-of-turn
  point). Narrow Passage ("players can attack only once each turn"). A
  `runInitiatedAttack` (Counter Attack) does not count against it.
- **`ContinuousAbility.mustReceiveBattleDamage` (`card-verified`).** A
  battle-damage magnet: while a magnet is in a party being assigned into,
  `getLegalBattleDamageTargets` narrows the legal set to the magnets only
  (and drops the `redirectDamage` "assign past the blockers" option).
  Courageous Paladin.
- **`ContinuousAbility.searchTax` (`card-verified`).** A player pays
  `amount` resources each time an effect would have them search their *own*
  deck (`chooserSelectsTarget` on an owned-deck selector); an unaffordable
  tax makes the search do nothing. Department of Rejections ("your opponents
  must pay 2 to search their deck").
- **`abilityCostModifiers` scope `"opponentCharacters"` (`card-verified`).**
  Adds `delta` to the `payResources` portion of any activated ability on a
  character the source-controller's opponent controls — including abilities
  used while the character is out of play. Department of Rejections ("your
  opponents must pay 2 to use a character's ability").
- **`attackTax` — `player: "activePlayer"` + `requiresAttackerMatch`
  (`card-verified`).** The tax is charged to whoever declares the attack
  (regardless of the source's controller), and only when the declared party
  contains a card matching the selector. Auspicious Tax ("the attached
  character's controller must pay 3 to attack with it").
- **`redirectAttackTarget` effect (`card-verified`).** Repoints
  `GameState.battle.target` at an in-play card (and updates
  `defenderPlayerId`). Architectural Restitution ("change the target of that
  attack to the location").
- **`deployForFree.budget` (`card-verified`).** "Deploy any number of cards
  for free with total numeric cost X or less" — after each free deploy the
  choice is re-issued with the pool reduced by the deployed card's printed
  cost, until it's spent / nothing in hand fits / the player declines (or a
  deployed card's own resolution needs a further choice). Reality Shift.
  An effect that lets you deploy a card (`deployForFree`, `deployFromZone`) never
  offers or accepts a resource card (CR 604.2, 605.2).
- **Pick no longer the declared type (CR 208.2).** Like a pick that left its zone
  (CR 402.5), a pick that is no longer the card type its target declaration named
  when the stack item begins resolving (`ResolutionContext.pickTypeLost`) is not
  affected by the effect (destroy, deal damage, deplete, add counter, move ...).
- **"While you play a resource" timing (CR 605.1c).** The `resourcePlayed` triggers
  resolve after the card is selected but before it enters play, so the played card
  is still in the hand. An `attachTo` aimed at the played card in that window
  takes hold as it enters play (Vilghame Manewaft).
- **`sumCost` expression (`card-verified`).** Sum of printed numeric `cost`
  over every in-play card matching a selector — parallel to `sumStat`.
  Reality Shift ("X is the total numeric cost of all non-resource cards you
  control").
- **Concessions.** Lucky Charm's "opponents must pay 1 to pick a character
  you control" is not modelled (its ETB draw is authored). Titillating
  Contortionist's "must block *this card*" is authored as a generic
  `mustBlock` grant (the picked character must block the attacking party the
  source is in). Runic Battery's "detach up to X resources from your
  faction" uses the `detach` effect's existing semantics.

### Fidelity pass (hidden information / reveal)

- **Perfect information (engine-derived).** The engine has no per-seat
  hidden zones — the deck is an ordered list it can always read, and no
  rule keys off whether a card has been "revealed". "Search your deck for X
  and reveal it", "look at an opponent's hand and choose a card" etc. model
  the *state change* (the search/choice); the "reveal" / "look" verb is
  carried only for a renderer.
- **`ContinuousAbility.grantsReveal` (`card-verified`).** "The top card of
  your deck is revealed at all times" (Cheats McGuillicutty), "each
  opponent's hand is revealed at all times" (Odious Diva), Bottlebeard,
  Axeclaw. `{ zone: "deckTop" | "hand", of: PlayerRef }` populates
  `GameFlowView.revealed` (`{ deckTop: [{playerId, cardId}], hands:
  [playerId] }`) so a renderer can show the zone face-up. No rule reads it
  (cards that buff off "the revealed top card" read `deckPosition`
  directly).
- **`reveal` / `cardsRevealed` (`engine-derived`).** A one-shot `reveal`
  effect emits `cardsRevealed { cardIds, zone, ownerId, viewerId }` and
  changes nothing else — for a renderer / event log. `ownerId` is the holder
  of the zone the cards are shown from (`heldBy ?? ownerId` for a hand or
  deck), so a card held in a non-owner's hand or deck is revealed from that
  player's zone; a reveal spanning several holders emits one event each.
- **Search-and-reveal (`engine-derived`).** "Search your deck for X, reveal
  it, and put it into your hand" carries a `revealCards` effect between the
  pick and the move (`selected: <declaration id>`, or `selector` for "all
  copies"), so `cardsRevealed` reaches the opponent before the card
  disappears into a hidden zone. It is per printing: only a printing whose
  *printed* text (`corrections.json` text, else the card's `text`) says
  "reveal" carries it — a reprint that drops the word does not.
  `FactionDefinition.setup.startingDrawSearch.reveal` does the same for
  Unlikely Heroes' STARTING DRAW search.
- **Other reveals (`engine-derived`).** Every reveal the printed text names
  emits `cardsRevealed`, again per printing: "reveal the top N cards of a
  deck" and "reveals their hand" carry a `reveal` effect placed where the
  text reveals (after a "choose a card type" decision, after a shuffle); "look
  at the top N, choose X and reveal it" and "reveals a face-down resource"
  carry a `revealCards` for the pick; `moveSelected.reveal` reveals a cost
  pick. A reveal printed as a COST on an ability or tactic whose pick is a
  target declaration (Manifest, Gang Weapon Dealer ...) is emitted as the
  first effect, i.e. at resolution. The engine emits the rest without card
  data: using a `fromFaceDown` ability reveals the face-down source ("Reveal
  this card" - FLIP IT, REUSE ...), a `revealFromHand` deploy reveals the
  card from the hand (Witty Worm), Auction House reveals the cards it turns
  over and Mustache Showdown the two chosen piles; Community Chest reveals
  itself off the mulligan's `cardsMulliganed` event. Gap: Slightly Less Evil
  Alliance's Showdown text.
- **`cardsRevealed.knownToRevealer` (`engine-derived`).** Set when the player
  who caused the reveal (the controller of `byCardId`) already knew every
  card in the event: a search or cost pick (anything but another player's
  face-down card in play), their own hand, their own face-down resource, the
  pile they split in Mustache Showdown, the starting-draw search. Absent
  when they learn the cards from the reveal: the top of a deck (their own or
  an opponent's), the cards Auction House or `revealFromTopUntil` turn over,
  an opponent's hand, an opponent's face-down resource, the opponent's
  Showdown pile. A renderer shows a public reveal to everyone, and to the
  revealer unless the flag is set.
- **`GameState.gameLog` (`engine-derived`).** A running, ordered list of
  `GameLogEntry` — every emitted event plus `responseWindowOpened` /
  `priorityPassed` / `stackItemResolving` / `triggerResolving` /
  `blockersDeclared` / `battleDamageAssigned` markers — each stamped with
  the response-stack `depth` it happened at, so a renderer can indent
  responses (and responses to responses) under what they answer and show
  the LIFO unwind. Every player action lands a line: a `priorityPassed`
  names what the decline was against (the attack, a pending stack item, a
  named battle-damage step) so the three back-to-back battle windows don't
  read as one stuck loop; declaring an empty blocking party and each
  battle-damage assignment get their own marker. A resolved tactic's trip
  out of the `deploying` waypoint to its owner's discard pile (or, via
  `selfDisposition`, their hand) is logged — only the `play -> deploying`
  open and a permanent's `deploying -> play` (already covered by
  `cardEnteredPlay`) are suppressed as noise. An "Attach to X" card's
  `cardEnteredPlay` line names the host it attached to; a standalone
  `attachTo` effect that re-homes an already-in-play card (Kettinger's
  HANDOFF) emits `cardAttached { cardId, hostId }`. A non-damage influence
  change (`modifyInfluence` effect, influence lost/paid as a cost — but
  *not* battle damage to a faction, which `damageDealt` already carries)
  emits `influenceChanged { playerId, delta, total }`; a one-shot
  `createModifier` stat change emits `statModified { cardId, stat,
  operation, value }` (continuous-ability / attached-item buffs are
  recomputed live and stay unlogged); the game reaching a result emits
  `gameEnded { winnerId }`. All informational — no triggered ability keys
  off any of them yet. Purely informational; no
  rule reads it. `emit()` appends unless `SpoilsEngine.setLogEnabled(false)`;
  `getLog()` / `formatLog()` read it. Excluded from the `canPayCosts`
  affordability-probe clone.
- **`revealFromTopUntil` effect (`card-verified`).** Turn cards over from
  the top of a deck until one satisfies `match` or the deck is exhausted;
  bind the match to `bindAs` and run `onMatch`; `rest` shuffles / bottoms /
  discards / voids the other revealed cards. Surprise! ("Reveal cards from
  the top of your deck until a character with numeric cost X or less is
  revealed ... Shuffle all other revealed cards into your deck").
- **`targetOwnedBy` condition (`card-verified`).** True when the candidate
  (or `target`) is owned by the resolved player — for "a UNIQUE character
  in play OR a character in an *opponent's* discard pile" (A Death Fit for a
  King), which a single `CardSelector.owner` can't express alongside other
  `conditions`.
- **`moveCard` same-zone deck reposition (engine bug fix).** "Put the top
  card of your deck on the bottom" (Cheats McGuillicutty BOTTOM DEAL,
  Bottlebeard CHUG!, Flimflam Man, …) previously no-op'd because `moveCard`
  early-returns when `from === to`; it now repositions within `owner.deck`
  when both are the (ordered) deck.
- **`CARD_FIDELITY`.** `data/card-fidelity.json` (generated) + the `"./data"`
  export grade every card `full` / `partial` / `stub`. `partial` (3 cards:
  Gilda SUMMONS scope, Study Disturbance / Tedious TriAdic Truculence
  buyout timing) and `stub` (the 2 `wontImplement`) each carry a note.

## 13. Tokens (CR §409)

**(CR §409.1)** A token is a marker placed on an in-play card; it has no
inherent meaning — the card's text defines what its tokens do. **(CR
§409.2)** If the card leaves play, its tokens disappear. **(CR §409.3)** A
*Card Token* (e.g. a Micromajig — a Gearsmith character with 1/1/3 and the
"majig" subtype, CR §409.3c) that leaves play takes its attached cards with
it, then disappears; its owner is whoever controlled the effect that
created it.

## 14. Action loops (CR §414)

**(CR §414.1)** If cards create an infinitely repeating loop that neither
player can voluntarily stop, the game ends as a **draw**. **(CR §414.2 /
§414.3)** A voluntary loop can be shortcut: demonstrate it, choose a finite
repeat count (infinity is not allowed), and the opponent may break in to
respond at any chosen iteration.

**(engine-derived)** The engine detects a mandatory loop deterministically: triggers
resolving inside one another more than 200 deep, 5000 trigger resolutions in a
row, or a `repeatWhile` that outlasts its `maxPasses` with its condition still
true. `perform` then drops whatever was still resolving (queue, stack, battle,
pending choices) and sets `winner: "draw"` (emitting `gameEnded`). At any
table size that draw is between every player still in the game (MPX-loop).

**(CR §413)** A few effects have players *bid*: take turns naming an
increasing number or passing; a player who passes is out; the last player
in wins the bid. Bidding starts with the active player and goes clockwise;
every player in the game takes part, and a player who has passed is skipped.

## 15. Multiplayer: "your opponent" (MP 2–4, MPX-select, MPX-lasting)

**(MP 2, MP 4)** A block of rules text that says "your opponent" (one activated ability, one triggered
ability, one paragraph of continuous text, or the effect text of one card) selects one other player in the
game as its opponent, once per block and anew each time the block is followed. **(MP 3)** "Both players" is
the controller and that same opponent. **(MPX-select (3))** With exactly one opponent left nobody is asked and
nothing extra is stored: every binding reads that player, so a two-player game plays as it always has.

**(engine-derived)** In card data the player word `"opponent"` is the block's opponent; `"opponents"` is every
opponent ("each opponent"), selects nobody, and in a condition holds for any opponent. A block names its
opponent when its data holds `"opponent"` or a `forEachPlayer` over `"pair"`.

- **Played cards and abilities (MPX-select (2)):** the opponent is part of the action (`players.opponent`),
  required at two or more opponents, refused if it is yourself, a player who has lost or a non-player, and
  listed first by `getPlayRequirements` (`kind: "players"`), because the legal picks depend on it. A
  `playerChoices` entry names any other player the same way and `{ type: "chosenPlayer", id }` reads it; a
  `choosePlayer` effect asks at resolution. A player choice is not a pick (CR 405).
- **Triggers and replacements:** asked through a `choosePlayer` prompt when the trigger is about to be followed
  (before its targets) and at the moment a replacement applies (MPQ-P3).
- **`opponentFrom`:** a trigger whose condition names the opponent through the event's player is met by any
  opponent's event and that opponent is the block's opponent (`"event"`, MPQ-P5); text only a battle the
  controller is in can set off (a `battleRole` gate, "when this card attacks / is blocked", damage to a faction
  by this card) takes the other side of the battle (`"battle"`, MPQ-P8); `"respondedTo"` is the controller of
  the card or ability answered (MPQ-P4); `"acting"` is text written from another player's point of view: the
  acting player (the event's player, else the active player) selects one of their own opponents and "both
  players" is that player plus the selection (MPQ-P10). Written, the field wins; absent, the engine derives it.
- **Continuous text (RQ-mp-5, RQ-mp-10, MPQ-P2):** selected by the controller as the text starts applying and
  kept on the card (`boundOpponents`); until then the text does not apply. When the selected player is
  eliminated the controller selects again (the only opponent left is taken without asking); when control of the
  card changes the new controller selects again, even if the old selection is a valid opponent for them.
  Lasting records a block creates (area modifiers, conditional keyword grants, replacements, hand redirects,
  delayed effects) keep reading the opponent the block selected and are re-selected when that player is out.
- **Iteration (CR 402.2):** `forEachPlayer` runs for the active player first, then clockwise, players still in the
  game only; `players` picks `all` (default), `opponents`, `others`, `pair` or `selfAndOpponents`, and `except`
  leaves one player out (MPQ-P11). `anyPlayerMayPay` offers "any opponent" clockwise from the controller's left
  and "any player" from the active player; the first to pay settles it, otherwise `elseEffects` (MPQ-P7).
- **`noResponse: "opponent"`:** only the block's opponent may not respond; with nobody else able to, it
  resolves at once like `true`.
- **Open reading (RQ-mp-3 and MPX-select (4)):** a stack item whose selected opponent is eliminated before it
  resolves keeps naming that player (their cards are gone, so nothing of theirs is affected).
