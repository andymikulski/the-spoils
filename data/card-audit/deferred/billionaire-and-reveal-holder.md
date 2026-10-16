# The Billionaire's older printings, and `cardsRevealed` by zone holder

Status: **implemented.** Two deferred items from the card audit.

## 1. The Billionaire: 1st Edition and Open Beta play "as though you were your opponent"

Printed text checked from `corrections.json[id].text`, else `text`.

| Printing | Id | Printed | `borrow.canUseOpponentAbilities` |
|---|---|---|---|
| 1st Edition | `ff195e18-a459-4594-b155-8572b869f368` | "You may use abilities on your opponent's cards as though you were your opponent. (The effect still happens to your opponent.)" | `"asOpponent"` (was `true`) |
| Open Beta | `2ec131a8-26eb-4dd7-914d-ced1ca9e770c` | same | `"asOpponent"` (was `true`) |
| 2nd Edition | `fb604d54-0aa5-40b5-9430-9d163e03fcc9` | "...but you must pay any numeric cost with your own resources. Any additional costs must be satisfied as though your opponent is using the ability. The ability's effect happens as if your opponent used it." | `true` (unchanged) |

### What the engine did before

`canUseOpponentAbilities: true` implemented the **2nd Edition** wording only: the
numeric (`payResources`) cost was split off and charged to the activator, every
other cost and the effect ran with the opponent as `context.controllerId`. All
three printings shared it, so 1E and OB were playing a rule they do not print.

### The ruling

"As though you were your opponent" applies to **every** cost, numeric included:
the opponent's resources pay `payResources`, the opponent's hand pays a discard,
and the effect resolves as the opponent's. Basis:

- CR 2.5 §401.2a: "If you are trying to satisfy a cost as though you were your
  opponent, you can only do so with the knowledge you currently have about the
  game state. For example, if you must satisfy a cost that says 'discard a
  character' you can only do so if your opponent's hand is currently revealed."
  The rule treats the opponent as the one satisfying the cost; it makes no
  exception for numeric costs.
- The 2nd Edition text spells out the opposite for the numeric cost
  ("with your own resources"), which reads as the later clarification that
  changed the older behavior, not as a restatement of it.

Consequence: under 1E/OB the Billionaire's controller can only use an ability the
**opponent** can afford, and using it spends the opponent's resources.

CR §401.2a's knowledge limit is not enforced. The engine has perfect information
(RULES.md §5); a client offers only cards the player may see. This applies to the
2nd Edition's "additional costs" wording equally and is unchanged.

### Changes

- `src/types/cards.ts`: `ContinuousAbility.canUseOpponentAbilities?: boolean | "asOpponent"`,
  documented per value.
- `src/engine/SpoilsEngine.ts`:
  - `opponentAbilityBorrowMode(playerId)` returns `"ownNumeric"` (`true`),
    `"asOpponent"` or `undefined`; when live sources disagree `"ownNumeric"` wins.
    (The Billionaire is UNIQUE, so two printings of it never coexist; this only
    makes mixed sources deterministic.)
  - `borrowedAbilityMode(playerId, card, ability)` decides if a use is a borrowed
    one (not their own card, and not `usableBy: "anyPlayer" | "opponent"`).
  - `splitBorrowedNumericCost` is the shared "numeric total vs the rest" split.
  - `activateAbility`: only `"ownNumeric"` charges the numeric cost to the activator.
    `"asOpponent"` leaves every cost to `payCosts` under the opponent's context.
  - `getAvailableActivatedAbilities` now judges affordability by whoever pays.
- Cards: `data/card-audit/deferred/billionaire.patch.cjs`, applied with
  `node scripts/card-audit/patch-cards.cjs` (1E and OB to `"asOpponent"`, 2E left
  as `true`; idempotent).
- Docs: RULES.md (borrowing paragraph), BEHAVIORS.md (field entry),
  `data/card-coverage.json` (1E/OB shapes + notes, capability spec) and COVERAGE.md
  (regenerated with `scripts/build-coverage.cjs`).

### Two listing bugs fixed on the way

`getAvailableActivatedAbilities` checked the whole cost against the **opponent**
for every borrowed ability, even though 2nd Edition makes the borrower pay the
numeric part:

- a borrowed ability the borrower could pay for was hidden when the opponent had
  no resources, and one the borrower could not pay for was offered when the
  opponent had some (activation then refused);
- an ability marked `usableBy: "opponent"` (iDumb De-Itemizer RESET) was judged as
  the card's controller in the listing but activated as the borrower.

Both now match what `activateAbility` does.

### Tests

- `src/engine/__tests__/open-beta-caps.test.ts`, "canUseOpponentAbilities - who
  pays" (synthetic fixtures): both modes' payer, listing and refusal; a discard
  cost comes from the opponent's hand under `"asOpponent"`; mixed sources
  (order-independent); `usableBy: "opponent"` in both modes.
- `src/engine/__tests__/per-card/printed-variants.test.ts`, "The Billionaire - 1st
  Edition and Open Beta play ...": real printings, printed text vs behavior, who
  pays, and listing/refusal for all three.
- `src/engine/__tests__/open-beta-smoke.test.ts`: the Open Beta Billionaire smoke
  test asserted the 2nd Edition rule against the Open Beta printing; it now
  asserts the opponent pays.

### Not changed

- Choices inside a borrowed ability's effect (`chooser: "controller"`) go to the
  opponent, the effect's controller, as they did before. Whether the borrower
  should make them is a separate question.
- CHANGE COSTUME on 1E/OB already matched the older text (no reveal, no
  `revealCards`).

## 2. `cardsRevealed` names the zone holder, not the owner

`emitReveal` (behind `revealCards`, `moveSelected.reveal`, Auction House,
Mustache Showdown, `revealFromHand`, a revealed face-down resource) grouped cards
by `card.ownerId`, so a card held in a non-owner's hand or deck
(`CardInstance.heldBy`, see `your-hand-zones.md`) was reported as revealed from
the owner's zone.

### Change

- `emitReveal` groups by `zoneHolderId(card)` (`heldBy ?? ownerId` while the card
  is in a hand or deck, else the owner). One event per holder + zone.
- The event keeps its shape: **`ownerId` now means "the player whose zone the
  cards are shown from"**. It equals the card owner except for a held card, so
  every consumer that reads `ownerId` as "whose hand / deck" is now right without
  changes. The doc comment on `cardsRevealed` (`src/types/events.ts`) says so.
- Auction House sets the cards aside (`deploying`) before the reveal, which drops
  the holder information, so `emitReveal`'s override argument is now
  `shownFrom?: { zone, holderId }` and `beginAuction` passes the deck it turned
  the cards over from.
- The other emitters (`reveal` effect, `revealFromTopUntil`, faction setup) already
  used the player whose array they read, so they were right.

### spoils-game

`useTableEventQueue.ts` uses `event.ownerId` for "revealed from your hand" vs
"<name> reveals ... from <zone>", which is the holder reading. No spoils-game
change. After `npm run build` in spoils-db: `typecheck` is clean for `core`,
`server` and `web`, and `TableEventQueue.test.tsx` passes (9 tests).

### Tests

`src/engine/__tests__/other-reveals.test.ts`, "a reveal names the zone holder, not
the card owner": a held card revealed from the holder's hand and from the
holder's deck; the same card moved without `toPlayer` still reveals from its
owner's hand; one reveal across both hands groups by holder (the borrowed card
joins the holder's own cards); Auction House with a borrowed card on top of the
revealing player's deck.
