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
- `data/cards.json` — the real card database (2101 cards). Used to verify
  and fill in mechanics the rules documents leave implicit (keyword names,
  ability shapes). Where a claim was cross-checked against real printed card
  text it is marked **(card-verified)**.
- `src/engine` itself, where a rule's current *implementation* resolves an
  ambiguity the source material leaves open, or where the note describes an
  engine-internal representation (a `pendingChoice` kind, a `GameState`
  field) rather than a game rule. Marked **(engine-derived)**. An
  engine-derived note is not a rule — if it contradicts the CR it is a bug.

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
  same time, the game is a **draw** between them.
- **(CR §102.1a / §306.2)** Running out of cards in your deck does **not**
  lose you the game — you simply fail to draw the cards you can't.
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
play). **(CR §411.3 / §411.4, FAQ)** Flipping a card face-up *or* face-down
counts as the card **leaving play and a brand-new card entering play** —
"leaves play" triggers fire on the flip, "enters play" triggers fire on the
result, and nothing about the old object (damage, tokens, temporary rules
text, attachments) carries over.

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
  faction.

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
  resource icons they control (`meetsThreshold` short-circuits).
- **`turn.startOfTurnEffects`** — effects run automatically at the start of
  the faction's controller's turn, after the core start-of-turn rules and
  the Restore Rule, with the faction card as `source` — Imperial Army's
  "reduce the numeric cost of the next character you play this turn by 2"
  (a `reduceNextCost` with `cardType: "character"`).
- **`turn.develop.usesPerTurn`** — how many times the Develop Rule may be
  used per turn (default 1; the Union of Unextraordinary Miners' "OVERTIME"
  clause is `2`).

Seed 3's non-tournament "EPIC" / "Showdown" faction cards (The Evil
Alliance, Imperial Army, ...) additionally reference format mechanics that
are **out of scope for a two-player engine** and are left unmodelled:
double-sided card-flipping (INTERNAL CONFLICT), Showdown multiplayer (the
X = number-of-opponents scaling, the Temptation Pile, the Hero deck), and
one faction rewriting another player's rules (The Knitting Coalition's
HIDDEN INFLUENCE / PULLING STRINGS).

### 3.7 Changing card types (CR §208)

- **(CR §208.1)** A card may have several types at once; "gains a type"
  keeps the existing ones.
- **(CR §208.2)** If an effect refers to a specific type but its target is
  no longer that type, the target is not affected by that effect.
- **(CR §208.3)** If a card loses the character type, it forgets all damage
  it received this turn (becoming a character again later does not restore
  it).
- **(CR §208.4)** If a card loses the character type *during a battle*, it
  is removed from the battle immediately (§8).

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
check so it fires whatever ended the grant.

**(engine-derived)** The CR does not settle whether a card that *gains* the
character type mid-turn can attack that turn (§204.3 "started the turn in
play" vs. §602.1c "in play under the active player's control ... eligible"),
so the engine takes the conservative reading: attack eligibility is fixed at
the start-of-turn instant for cards that are characters *then*, so an item
animated later this turn cannot attack until the following turn.

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
    that threshold, and turns off the instant they stop.
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

**(engine-derived)** Which cards each player set aside is recorded on
`GameState.mulligan` and read by the `bottomedInMulligan` condition.
*Community Chest* ("... choose to put this card on the bottom of your deck
as part of your mulligan ... you may reveal it. If you do, draw a card at
the start of your turn.") pairs that with a `turnStarted` trigger whose
`triggerZone` is `"deck"`, so it fires while the card sits in the deck; the
"you may reveal it" step is treated as automatic (there is no
hidden-deck-info model and revealing has no downside), and "control at
least [D]" gates the draw at trigger time rather than at game start, where
it could never be true.

## 6. Turn structure

**(CR §602) Start of turn** is a single simultaneous point in time — *not*
a phase or step, and these are not triggers:

- **(CR §602.1a)** All damage on characters is cleared to 0.
- **(CR §602.1b)** All "this turn" effects end.
- **(CR §602.1c / §608.1b)** Every character in play under the active
  player's control (and continuously so since the turn started) becomes
  eligible to attack this turn. A character that enters play mid-turn is
  **not** attack-eligible that turn unless it has **Aggro** (§9).

**(CR §602.2)** Then all "at the start of your turn" triggers happen; the
active player orders them (§7).

The faction's **Restore Rule (CR §202.7)** and **Develop Rule (CR §202.8)**
are sections of faction rules text, not built-in phases:

- The restore rule replenishes resources and cards each turn — for the
  Tournament Faction: detach this player's resources from the faction and
  restore (untap) their non-resource permanents. (Character-damage clearing
  is the core start-of-turn rule above, CR §602.1a, not part of the restore
  rule.)
- The develop rule usually lets you **draw 1 card *or* play 1 resource**,
  once per turn, at any point during your turn. **(FAQ)** you choose one,
  not both; **(FAQ)** it is *optional* ("you may"). Playing a resource is
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
  Driven by a `revealFromHand` payload on the `chooseDevelop` action's
  `playResource` choice.

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

**(engine-derived)** The develop rule is the `chooseDevelop` action — an
optional, once-per-turn move the active player may make any time during
their turn while nothing else is in flight (no battle, response window, or
pending choice). `GameState.developedThisTurn` guards the once-per-turn
limit and resets at the start-of-turn point; `SpoilsEngine.canDevelopNow`
is the query surface, surfaced as `GameFlowView.developAvailable`. There is
no develop phase and no ordering constraint — a deploy, ability, or attack
before (or instead of) developing is legal.

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
satisfied before it resolves. **(CR §503.4, FAQ)** When several triggers
happen at once: if all come from one player's cards, that player orders
them; if from both players' cards (or game-rule triggers), the **active
player** orders them. **(CR §503.4a, FAQ)** the order is chosen one trigger
at a time — resolve one, then decide the next — not fixed up front.

**(engine-derived)** Playing a card or activating an ability pushes a
`StackItem` onto `state.responseStack` and opens a `responseWindow` giving
the opponent priority; when responses stop, `advanceFlow()` pops and
resolves one stack item, then resumes the window's `continuation`.

**(engine-derived)** Every trigger found for one emitted event shares a
batch. While 2+ of a batch are still waiting, the engine pauses on
`GameState.pendingChoice` (kind `"orderTriggers"`, listing the remaining
`{sourceId, abilityId}` entries); the deciding player answers with a single
`next` pick (CR §503.4a). That one resolves fully, then — if 2+ still
remain — the choice is re-raised for the next pick; a lone leftover resolves
without prompting. `playerId` is the batch's sole controller if the cards
share one, otherwise the active player.

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
5. **(CR §608.1e) Response window** — attacker then defender.

### Resolving the battle (CR §609.1)

Repeating rounds, highest speed first, attacker before defender within a
round:

1. **(CR §609.1a)** Response window (attacker, then defender).
2. **(CR §609.1b / §609.1c)** X = the highest speed among battle characters
   that haven't yet assigned battle damage this battle. Every **attacker**
   at speed X assigns damage equal to its strength, divided as the attacker
   chooses among the blocking party — or, if no blocking-party members
   remain, among the target (faction/location).
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
  changes (CR §407.4), or if it loses the character type (CR §208.4). Any
  battle damage already assigned to it is **not** inflicted. **(CR §407.6)**
  An effect that would add a character you don't control to a party you do
  control is terminated. **(CR §407.5)** If the target of the attack is a
  location whose controller changes mid-battle, it stops being the target.

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
only writer of `CardInstance.controllerId`; it also moves the card between
the players' `play` arrays. `isCardStillInBattle` checks `controllerId`
against the attacker/defender, so party pruning falls out for free.

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
  card text governs per CR §101.1.)*
- **Unique X (CR §507.5).** You may not control more than one card carrying
  a given Unique identifier; if you do, you immediately choose one to keep
  and destroy the rest (**FAQ**: the controller chooses). The restriction is
  **per player** — your opponent controlling their own copy is fine. **(CR
  §507.5b)** If destroying an extra copy is prevented by an effect, Unique
  doesn't try again until the prevention ends.

  **(engine-derived)** The designation is `CardDefinition.unique?: string`
  (assigned at import). "Choose one to keep" pauses on
  `GameState.pendingChoice` (kind `"uniqueSurvivor"`, listing every
  candidate); everything else stays blocked until the affected player
  answers with `resolvePendingChoice`.

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
    the target.
  - **(CR §507.2e)** If the target later stops being type X, **destroy** the
    attached card immediately.
  - **(CR §301.4 / §301.4a / §301.4b)** If the target leaves play by any
    means (destroyed, removed, to hand, to deck), every card attached to it
    leaves play *the same way*; if the target's method of leaving play is
    replaced (§10), the attached card's is replaced too.

  **(engine-derived)** Declared via `CardDefinition.attachTo?: CardType`;
  playing the card adds a synthetic target declaration (reserved id
  `"attachTo"`). `CardInstance.attachedTo` is shared with the numeric-cost
  resource-attachment mechanic — the two never collide.

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
  per §7; cannot be responded to.
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
  recursion-guarded, and **skipped entirely** when the move/destroy is
  being done to pay an extra cost (CR §506.2) — the cost-payment paths pass
  `skipReplacement`. The **mandatory** form runs its `effects` inline; the
  **optional** "you may … instead" form pauses on a `replacementChoice`
  pending choice for the source's controller. Whenever a `destroy`
  replacement is *applied* (mandatory, or optional-accepted), the affected
  card's `damage` is reset to 0 (CR §506.6) so it doesn't re-die on the next
  state-based check. `replaces.controlledBy` filters on *whose card* is
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
  attached instead, CR §203.7).

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
  draw if more than one loses at once (CR §102.1 / §102.2). Checked last,
  after all destruction above settles.

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
  itself skipped.
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

**(CR §413)** A few effects have players *bid*: take turns naming an
increasing number or passing; a player who passes is out; the last player
in wins the bid. Bidding starts with the active player and goes clockwise.
