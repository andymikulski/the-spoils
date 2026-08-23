# The Spoils — Rules Reference

This document is the reference against which `src/engine` is tested for
correctness. It describes **the game's rules**, independent of how the
engine happens to implement them today. When a test fails, the question to
ask is "does the engine match this document?" — not "does the engine match
itself?"

## Sources

- *The Spoils CCG Rulebook* (Basic Rules, v2.2), Tenacious Games — covers
  core mechanics: turn actions, resources/threshold, card types, zones,
  priority/responses, battle, abilities, victory. Archived at
  [archive.org/details/TheSpoilsCCGRulebook](https://archive.org/details/TheSpoilsCCGRulebook).
- `data/cards.json` — the real card database (2101 cards). Used to verify
  and fill in mechanics the v2.2 basic rulebook doesn't cover (it predates
  later card pools). Where the two disagree, the card text wins, since it's
  what actually shipped. Every claim below marked **(card-verified)** was
  cross-checked against real printed card text, not just the rulebook.
- `src/engine` itself, where a rule's current *implementation* clarifies an
  ambiguity in the source material (e.g. exactly what "provides a resource
  icon" means for a face-down card). Marked **(engine-derived)**.

Anything not covered by these sources should be treated as undecided —
flag it rather than guessing.

## 1. Objective

A player wins when their opponent's faction reaches 0 influence. If both
factions hit 0 influence from the same event, the game is a draw. Influence
loss is tracked separately from character/location damage — effects that
key off "damage" do not fire from influence loss, and vice versa.

> **Known engine gap:** as of this writing, nothing in `SpoilsEngine` checks
> for 0 influence and ends the game. This is a priority target for tests —
> they should fail until a win/loss/draw check exists.

## 2. Zones

| Zone | Meaning |
|---|---|
| `deck` | The player's draw pile. Hidden, ordered. Searched only when a card explicitly allows it, and reshuffled after a search. |
| `hand` | Cards drawn but not yet played. Hidden from the opponent. |
| `deploying` | Transient zone a card occupies while it is being played — cost paid, but not yet resolved / not yet in play. Exists so responses can be raised against it before it lands. |
| `play` | Characters, items, locations, and the faction card live here while active. Resources (face-up or face-down) also live here, attached to the controller's faction. |
| `discard` | Destroyed permanents and resolved tactics land here. Recoverable by effects that say so. |
| `void` **(card-verified)** | A zone for cards set aside by specific effects, distinct from both `discard` and being "removed from the game." Cards in the void can be returned to play/hand only by effects that explicitly reference the void (e.g. *Eldridge Gosche, Godstealer*'s "pick a tactic you own in the void", *Deity Delimitation Device*'s "release"). Default trajectory (destruction) does **not** send cards to the void — only effects that say "put into the void" do. |

"Removed from the game" (seen on cards like *Master Scavenger*, *Swashbuckler*,
*Resurrection Emporium*) is **not** a zone the engine needs to track as a
place — a card removed from the game is gone; nothing can retrieve it. This
is different from `void`, where cards remain referenceable.

## 3. Card types

- **Character** — has strength (battle damage dealt), life (damage it can
  absorb before dying), speed (battle damage ordering), and may have
  abilities/keywords. Can attack and block. Only playable on the
  controller's own turn (unless it has the **Tactical** keyword).
- **Item** — persistent, may modify stats/effects of itself or another card
  (including via "Attach to X"). Never depletes on its own. Only playable
  on the controller's own turn (unless **Tactical**).
- **Location** — persistent, has a damage capacity ("structure") and
  ongoing effects. Can be attacked directly instead of the controller's
  faction. Damage persists turn to turn (does not clear at end of turn the
  way character damage does) and destroys the location once accumulated
  damage ≥ structure. Only playable on the controller's own turn (unless
  **Tactical**).

  > **Known data/engine gap:** `data/cards.json` does not currently carry a
  > structure value for location cards (life/strength/speed all come back
  > empty), and `checkStateBasedActions` only ever destroys cards of type
  > `"character"` — a location can accumulate lethal damage and never be
  > destroyed. Rule stands regardless of data completeness; tests should
  > use synthetic location fixtures with an explicit structure value (engine
  > stores this as the `life` stat — see below) and are expected to fail
  > until state-based actions cover locations too.
- **Tactic** — one-shot effect; resolves then goes to `discard`. Can always
  be played as a response (that's the entire point of the type), during
  battle response windows, or as a normal turn action.
- **Resource** — provides one resource icon while in play, attached to the
  controller's faction. Never depletes; only becomes usable again via a
  faction's restore rule detaching it.
- **Faction** — the player's avatar. Not included in a deck; one is chosen
  (or supplied) at setup. Defines: starting influence, starting resources,
  opening hand size (first vs. second player), whether/how a mulligan is
  offered, the turn-start restore rule, and the develop-step choices
  available each turn. May also carry its own activated abilities.

## 4. Resources, thresholds, and costs

- **Trades**: Arcanist (Obsession), Banker (Greed), Gearsmith (Elitism),
  Rogue (Deception), Warlord (Rage) — five trades, five matching resource
  icons. `Universal` is not a trade with its own resource; it marks cards
  playable by any faction (staples, and — per the real card pool — a body
  of "Story"/crossover cards keyed off the Volition icon, see below).
- **Threshold** is the *icon* requirement printed on a card (shorthand: a
  string of letters, e.g. `"rr"` = two Rage icons required). It is a gate,
  not a cost: once satisfied by resources in play, it isn't consumed and
  doesn't limit how many threshold-gated cards can be played.
- **Numeric cost** is paid by attaching that many of your in-play,
  unattached resources to your faction. Attached resources can't be reused
  until detached (typically by the controlling faction's turn-start restore
  rule). Playing something "for free" skips the numeric cost but not the
  threshold or any other listed cost.
- **Playing a resource**: either (a) put an actual resource card from hand
  into play face-up, providing its printed icon, or (b) put *any* card from
  hand into play face-down as a resource.
- **Volition (card-verified, engine-derived)** — the icon a face-down
  resource provides, regardless of what the card actually is. This is why
  `"v"` threshold requirements appear only on `Universal`-trade cards in the
  real data (e.g. *Zigalburgonglgr, the Stolen God* at `"vvvvvv"`) — those
  cards are designed to be paid for by face-down resources from any deck,
  not by a dedicated Volition resource card. `Threshold`/`ResourceIcon` in
  the type system therefore has six members (`rage, greed, deception,
  elitism, obsession, volition`), not five — this is intentional, not a
  typo, and the engine's `getResourceIcons` already implements it correctly
  (`card.faceDown → ["volition"]`).

## 5. Setup

1. Each player's faction enters play; its printed starting influence
   becomes that player's influence total.
2. Each player finds their faction's required starting resources in their
   deck and puts them into play (per the Tournament Faction: 2 staple
   resources), then shuffles.
3. Determine turn order (first/second player).
4. Each player draws their faction's starting-draw count — first player and
   second player amounts usually differ (Tournament Faction: 8 / 9) to
   offset the advantage of going first.
5. If the faction offers a mulligan, each player in turn order may set aside
   any number of hand cards to the bottom of the deck (in an order of their
   choosing) and draw that many replacements. This can only happen once per
   player — no rummaging through it again.
6. Turn 1 begins in the develop step for the first player.

## 6. Turn structure

A turn has two steps:

1. **Develop** — the active player must resolve exactly one of the choices
   their faction's develop rule offers (Tournament Faction: draw 1 card, or
   play 1 resource). This is a required, one-time decision at the start of
   the turn, not an optional action repeated later.
2. **Main** — the active player may, in any order and any number of times:
   play a card, use an ability, declare an attack, and finally end the
   turn. Ending the turn is the one action that can happen at most once.

At the start of a player's turn, before develop:
- Every character that both (a) is not face-down and (b) has been
  continuously under that player's control in `play` becomes attack-eligible
  for the turn. A character that enters play mid-turn is **not**
  attack-eligible that turn unless it has **Aggro**.
- The faction's restore rule then applies (Tournament Faction: clear all
  character damage, detach resources from the faction, restore/untap all
  non-resource permanents).

## 7. Priority and the response window ("stack")

Whenever a player:
- finishes paying the cost for a card (before it resolves/enters play),
- finishes paying the cost for an ability (before its effects execute), or
- declares they are ending their turn,

...the opponent gets a chance to respond. A response window stays open as
long as either player keeps adding responses; it closes only once both
players have had a chance to respond and neither adds one (two consecutive
passes). Once closed, everything added during the window resolves — most
recently added first (LIFO) — and then the original action/effect that
opened the window proceeds.

Only two kinds of things can be played *into* a response window: **Tactics**,
and any other card type that has the **Tactical** keyword. Activated
abilities can also be used in a response window, following the same
priority rules.

**Triggered abilities are not responses.** They fire automatically the
instant their condition becomes true, cannot be responded to as a discrete
action, and use the game state at the moment they fired even if something
about the source changes afterward. Multiple triggers firing at once from
one player's cards are ordered by that player; across both players (or
game-rule triggers), the active player chooses the order.

## 8. Battle

**Declaring the attack**
1. Active player picks characters to attack with — each must be
   attack-eligible (see §6) and not depleted. Declaring depletes them.
2. Active player names a target: an opponent's faction, or an opponent's
   location in play. (If unspecified, default to the opponent's faction.)
3. If every attacking character has **Covert**, the attacking party is
   Covert — it can be blocked only by Covert characters.

A response window opens after attackers are declared (both players may play
tactics/abilities).

**Declaring blockers**
1. Defending player may pick any number of non-depleted characters they
   control to block. Declaring does **not** deplete blockers.
2. A Covert character may only block a Covert attacking party; conversely
   only Covert characters may block a Covert party. Whether a party "is"
   Covert is locked in at the moment blocking is declared — later keyword
   changes don't retroactively legalize/void the block.
3. Face-down cards (resources) cannot block.

A response window opens after blockers are declared.

**Resolving damage — speed groups**

Battle damage resolves in repeating rounds, highest speed first, attacker
before defender within a round:

1. Response window (attacker, then defender).
2. Let X = the highest speed among attacking characters that haven't yet
   assigned damage this battle. All attackers at speed X simultaneously
   assign damage equal to their strength, split however the attacker
   chooses among the blocking party (if any) or the target (faction/
   location) if unblocked.
3. Let X = the highest speed among blocking characters that haven't yet
   assigned damage this battle. All blockers at speed X simultaneously
   assign damage equal to their strength, split however the defender
   chooses among the attacking party.
4. Response window (attacker, then defender).
5. All damage assigned in this round is inflicted simultaneously; multiple
   instances hitting the same target sum into one application.
6. Repeat from step 1 until every character in the battle has either
   assigned damage once or been removed from the battle.
7. Surviving characters that took part in the battle become depleted.

**Damage resolution:**
- Character: destroyed once its accumulated damage this turn ≥ its life
  (checked continuously as a state-based action, not just at end of
  battle).
- Location: destroyed once its accumulated damage (persists across turns)
  ≥ its structure.
- Faction: damage directly reduces influence by the same amount — this is
  the *only* normal way influence changes from combat, and it is not
  "damage" for the purposes of damage-prevention/redirection effects.
- A character removed from the battle (destroyed, or its control changes)
  is immediately pulled from the attacking/blocking party.

## 9. Keywords

- **Covert** — see battle rules (§8) for the blocking restriction. A card
  can gain Covert temporarily via an effect, same rules apply while it has
  the keyword.
- **Tactical (card-verified)** — the card can be played during a response
  window (as if it were a Tactic) regardless of its actual card type. It's
  still subject to the type's normal rules once in play (a Tactical
  character still needs a legal target/etc., and still resolves into
  `play` rather than `discard` the way a Tactic does).
- **Aggro (card-verified)** — the character is exempt from the "must have
  started this turn under your control" attack-eligibility rule (§6). A
  character with Aggro that enters play this turn may still attack this
  turn.
- **Unique X** — a player may not control more than one card carrying a
  given Unique designation; if they somehow do, they immediately choose one
  to keep and destroy the rest. The opponent controlling a copy of the same
  Unique card at the same time is fine — the restriction is per-player.
- **Attach to X** — the card must have a legal target of type X chosen as
  part of playing it, and enters play attached to that target. If the
  target is missing, or later leaves play / stops qualifying as type X, the
  attached card is destroyed (items/tactics attached this way go to
  discard). If the target itself leaves play for any reason, everything
  attached to it leaves the same way.

## 10. Abilities

- **Activated** — has a cost and effects; only its controller may use it;
  requires priority (see §7) the same as any other stack action. All listed
  costs must be payable simultaneously or the ability cannot be activated
  at all (no partial payment).
- **Triggered** — keyed to "if/when/at" wording; fires automatically per §7,
  cannot be responded to directly.
- **Continuous** — always-on while the source is in play; a "while X"
  conditional continuous ability turns on/off immediately as the condition
  becomes true/false, with no lingering state.
- **Depleting** ("tapping") — a card used to pay a deplete cost, or that
  attacks, becomes depleted and can't be depleted again until restored.
  Resources are never depleted (they're attached instead).
- **Restoring** ("untapping") — reverses depletion; normally happens via
  the controlling faction's turn-start restore rule, or an explicit effect.

## 11. State-based actions

Checked continuously (after every effect/stack resolution, not just once
per turn):

- Any character with accumulated damage this turn ≥ life is destroyed.
- Any location with accumulated damage ≥ structure is destroyed. *(not yet
  implemented — see §3)*
- Any faction at 0 influence ends the game for that player, immediately.
  *(not yet implemented — see §1)*
- Any player controlling more than one card sharing a Unique designation
  must reduce to one immediately.

## 12. Miscellaneous rulings

- `"cannot"` always overrides `"can"`.
- An instruction that's impossible to fully carry out (destroy a card no
  longer in play, discard from an empty hand, etc.) is carried out as far
  as possible and the rest is ignored — it does not invalidate the whole
  effect.
- A cost variable (`X`, etc.) that's never assigned because the card was
  played for free defaults to 0.
