# "Your hand / your deck" vs the owner's zones

Status: **implemented.** The engine can now put a card into the effect
controller's hand or deck. The five printings that print "your hand" / "your
deck" use it; every other printing keeps owner behavior.

## The limitation

`moveCard` always sent a card to its **owner's** hand/deck (`ownerId`). Some
older printings say **your** (the controller of the effect), which only differs
for a card you control but don't own (after a take-control effect). CR
§407.7-§407.8: ownership never changes.

## Printings switched

Printed text checked from `corrections.json[id].text`, else `text`.

| Card | Printing | Printed | Change |
|---|---|---|---|
| Maladjustment | 1st Edition Part 2 `556c61ec-857e-4773-80fb-b180513696f4` | "Put the resource into your hand." | `moveCard` gets `toPlayer: "controller"` |
| Recollection Bazaar | 1st Edition Part 2 `e5a8f861-fbbd-4c45-8b1d-2ddec10120bd` | "Put the resource into your hand." | same |
| Foment | Seed 2 `cccbf037-ad87-4626-952d-22351b64d91c` | "Put the resource into your hand." | same |
| Two-Headed Coin | 1st Edition Part 2 `f4244678-8524-446d-8c1c-65f126c9df4a` | "shuffle this card into your deck." | `moveSelected` cost gets `toPlayer: "controller"`, selector name `__self` (see below) |
| Two-Headed Coin | 2nd Edition `90a28359-1bad-419f-bd94-1566b810853f` | "shuffle this card into your deck." | same |

Left alone on purpose: Maladjustment 2nd Edition `ebdd4312-...` and Recollection
Bazaar 2nd Edition `c9b3b2df-...` print "its owner's hand" / "it's owner's hand"
and keep owner behavior (tests assert both sides). No other Foment or
Two-Headed Coin printing exists.

Applied with `node scripts/card-audit/patch-cards.cjs <module>` (module kept
outside the repo; it only touches `moveCard`/`moveSelected` nodes it finds under
those five ids).

### Bonus finding: the Two-Headed Coin reflip was never offered

The Coin's reflip cost named the card by name (`selector.name: "Two-Headed
Coin"`). A replacement's `optionalCost` has no activation to supply a selection,
so `canPayCosts` always failed and the engine never offered the reflip. A real
catalog probe confirmed no `coinFlipReplace` choice appeared. The existing
caps test used a synthetic Coin with a `deplete` cost, so it never caught this.
The patch now uses the `__self` sentinel (as Key to the City and Quilt of Old
Banners do), so the reflip works for both printings. The draw-and-reflip
wording differences the corrections note (printed text doesn't say the new
result is used) are a separate behavior question and were not touched.

## How it works

Types first:

- `CardInstance.heldBy?: PlayerId` (`src/types/state.ts`): the player whose hand
  or deck holds the card when that isn't its owner. Set only while `zone` is
  `hand`/`deck`.
- `Effect` `moveCard.toPlayer?: PlayerRef` and `Cost` `moveSelected.toPlayer?:
  PlayerRef`: whose hand/deck receives the card. Omitted means the owner.
  Ignored for discard/void/removed (always the owner's).

Engine (`src/engine/SpoilsEngine.ts`):

- `moveCard(..., toPlayerId?)` puts a hand/deck destination in the named
  player's array, sets `heldBy` (cleared by every other move), and sets
  `controllerId` to the holder when the card comes from outside play or
  `toPlayer` is given. A default bounce out of play still keeps the last
  controller, because the card's own "leaves play" triggers read it.
- `zoneHolderId(card)` = `heldBy ?? ownerId` for hand/deck cards, else owner.
  Used by: the `owner:` selector test, `fromTop`, same-zone deck reposition,
  `cardsDiscarded.playerId`, the deck-search owner (`deckSearched`, search tax),
  and `playResourceCard`'s "in this player's hand" check (which now also sets
  `controllerId` to the player who plays it).
- Lockbox of the Aeons (`restrictReturnToHand`) and Quotidian Misfire
  (`redirectHandMoves`) are judged against the **receiving** player, not the
  owner. Putting a borrowed card into your own hand is not "into an opponent's
  hand".
- Same-zone moves with no `toPlayer` stay a no-op (deck: reposition within the
  holder's deck). Only an explicit `toPlayer` naming a different player moves a
  card between two hands/decks.
- A `moveSelected` cost with `shuffle: true` now shuffles the deck(s) the cards
  actually went into (before, it always shuffled the payer's deck, which was
  wrong whenever the card went to a different owner's deck, e.g. a stolen
  Cheats McGuillicutty's CHANGE COSTUME).

## What was checked and why nothing else breaks

The per-player arrays (`deck`, `hand`, ...) stay the source of truth for
drawing, shuffling, searching, milling, revealing, mulligans and every effect
that names a `PlayerRef`. Those never look at the card's owner, so a foreign
card in your hand or deck behaves like any other card there.

- Drawing: `player.deck` -> `player.hand`, same player, `heldBy` is preserved.
- Discard: leaves hand for the **owner's** discard (CR §305.1); `heldBy` clears.
- Deck-out: there is no deck-out loss (CR §102.1a / §306.2), nothing to count.
- End of game: influence only; no zone counting.
- Hidden information: the engine has perfect information and renderers hide
  zones by the per-player arrays, which the foreign card sits in correctly.
- Persistence/save: `heldBy` is plain optional data in `GameState`, no schema.
- `targetOwnedBy` (ownership condition) still reads the true owner, correctly.

## Tests

- `src/engine/__tests__/destination-player.test.ts` (new, synthetic fixtures):
  `toPlayer` to hand/deck, default-to-owner, ignored for owner-only zones, owner
  selector/`fromTop`/search see the holder, play-as-resource and deploy by the
  holder, discard to the owner's pile with the holder as discarder, return to
  owner, explicit hand-to-hand transfer, deck reposition, Lockbox and
  Misfire scoping, `moveSelected` shuffle target (both with and without
  `toPlayer`).
- `src/engine/__tests__/per-card/printed-variants.test.ts` (appended describe
  at the end): Maladjustment (1st Ed Part 2 vs 2nd Ed), Recollection Bazaar (1st
  Ed Part 2 vs 2nd Ed, plus an owned resource), Foment, and both Two-Headed Coin
  printings with the real catalog cards. Each asserts the printed text first.
- `RULES.md` §2 has a new "Whose hand or deck" paragraph.

## Remaining / follow-ups (not done, not part of this task)

- **Done later** (`deferred/stolen-card-control.md`): a stolen card that leaves
  play by default to its owner's hand used to keep the thief as `controllerId`
  ("You do not control that card." when the owner deployed it). `moveCard` now
  releases control to the holder after emitting the move.
- **Done later:** spoils-game `packages/web/src/ai/narration.ts` now picks the
  holder of a non-play card as `card.heldBy ?? card.ownerId`.
- Stale notes about the old limit: `data/card-audit/behavior-worklist.md` lines
  38-41 ("no change (engine limit)") and `CARD-AUDIT-PROGRESS.md` line ~239
  ("Engine limit (accepted)") are now out of date. The deferred-table row for this
  item still says "running".
- Cheats McGuillicutty's CHANGE COSTUME prints "its owner's deck" and keeps owner
  behavior; its cost uses the same by-name selector but is an activated ability,
  so its selection is supplied by the activation.

## Unrelated failures seen (not mine, not fixed)

- `card-data-integrity.test.ts`: 4p7 31f `detach-on-attach` has bad event
  `"cardAttached"`.
- `search-reveal.test.ts`: Ecto-Distillation (1st/2nd Edition) printings lack the
  reveal effect.
- `tsc` on the tests: `printed-variants.test.ts` ~line 823 passes `attachedTo`
  where `CardPlacement` wants `attachedToKey` (the 4p7 31f test).
