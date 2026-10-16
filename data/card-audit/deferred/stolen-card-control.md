# A stolen card that leaves play keeps the thief as controller

Status: **implemented.** A card outside play is controlled by whoever holds it.

## The bug

`moveCard` kept the last controller when a card left play by default (so the
card's own "leaves play" triggers could read it) and never put it back. A
character stolen with `takeControl` and then bounced to its owner's hand sat in
the owner's `hand` array with `controllerId` still the thief. The owner got
"You do not control that card." deploying it from their own hand (probe: P1
takes a P2 character, bounces it, P2 plays it). The same stale thief stayed on
cards sent to discard, deck, void and removed, and on a card that `heldBy`
had parked in the thief's hand and was then discarded.

CR §407.3: a player who takes control of a card keeps it "until it leaves
play, or until another effect takes control of it". CR §407.7–§407.8: ownership
never changes.

## The rule now

A card in a hand, deck, discard pile, the void, or out of the game is
controlled by its holder: `heldBy` when an effect put it in someone else's hand
or deck, otherwise its owner. `play` and `deploying` keep whoever is playing it.

## Engine changes (`src/engine/SpoilsEngine.ts`)

No type changes.

- `moveCard` ends with `releaseControlOutsidePlay(card)`: if the card now sits
  outside `play`/`deploying`, `controllerId = zoneHolderId(card)`. It runs after
  the move's events are emitted. `findTriggers` captures each trigger's
  controller when the event is emitted, so a card's own "when this leaves play"
  trigger and a watcher's `eventCardControlledBy` still see the controller the
  card had in play. The existing pre-emit reset for cards entering a hand/deck
  from outside play, or with `toPlayer`, is unchanged.
- `destroyCard` emits `cardDestroyed` after `moveCard`, i.e. after the release.
  The event already carried `controllerId` (the in-play controller), so a new
  `controllerAtEvent(event, card)` helper makes `findTriggers` (the trigger's
  `context.controllerId`) and the `eventCardControlledBy` condition read that
  field for the destroyed card. Octo-Ba-Ba style watchers ("a character an
  opponent controls is destroyed") keep judging the thief as the controller.
- `reassignControl` only changes a card in play, and `takeControl` returns early
  for a card that is not in play (before it records a timed `controlGrants`
  entry). Control is a property of cards in play, so a take-control effect
  aimed at a card in the discard pile or hand is a no-op instead of planting a
  stale controller. A timed grant is dropped when its card leaves play (already
  done in `moveCard`), so the start-of-turn revert sweep cannot touch it.
- RULES.md §2 ("Control ends when a card leaves play") and §8 (the
  `takeControl` note) describe it.

## What was checked

- Leaves-play timing: `cardMoved` triggers are found inside `moveCard`'s emit,
  before the release. `cardDestroyed` is the only event emitted after a card
  has left play (`destroyCard` is its sole emitter); it is covered above.
  Tokens are deleted on leaving play and judged from `departedTokens` as before.
- `deploying` is excluded so a face-down card flipped up from play
  (`deployCard` with `fromZone`) still finishes under the deployer.
- A trigger whose effects move the card again, or put it back into play under
  new control, is respected: the release reads the card's final zone after the
  emit and does nothing if it is back in `play`.
- Real data: no effect-level `controllerOf` / `eventCardControlledBy` reads the
  controller of a card that just left play; the ones in the catalog watch
  `cardEnteredPlay`, `cardDepleted` or `damageDealt`, where the card is in play.
  The ability-level `eventCardControlledBy` conditions are evaluated when the
  event is emitted. Every `takeControl` in the catalog targets a card in play:
  a selector with no zone (in play by default), `source`, `attachedTo`, or the
  `__candidate` of a would-be-destroyed replacement (still in play while the
  replacement runs).
- Full `npm test` before and after: 5083 passing before, all passing after
  (5106, which includes the 17 new tests and unrelated additions from other
  sessions). `npm run typecheck` is clean.

## Tests

`src/engine/__tests__/stolen-card-control.test.ts` (new, synthetic fixtures):

- Steal then bounce: the owner controls it, it is in the owner's hand with no
  `heldBy`, the owner deploys it (enters play under the owner), and the thief
  cannot.
- Top of deck, discard, destroy, void and `removeFromGame`: each lands in the
  owner's zone with the owner as controller; "your discard pile" selectors find
  it for the owner only; a stolen item and resource are released the same way.
- `toPlayer` borrow: a stolen card put into the thief's hand is controlled and
  held by the thief; discarding it goes to the owner's pile with the owner as
  controller and no `heldBy`; returning it to the owner's hand makes the owner
  its controller.
- Leaves-play abilities: its own `cardDestroyed` trigger and its own
  `cardMoved`-from-play trigger resolve for the thief; an opponent watcher's
  `eventCardControlledBy: "opponent"` on `cardDestroyed` still fires when the
  destroyed card was under the thief's control.
- Timed take-control: a card bounced during the grant stays the owner's through
  the start-of-turn sweep and the grant is gone; `takeControl` (with a duration)
  on a card in the discard pile or hand does nothing and records no grant.

The two trigger-reading cases fail if `controllerAtEvent` is replaced with the
card's live `controllerId`.

## spoils-game

`packages/web/src/ai/narration.ts` `possessive()` picked the holder of a card
outside play as `card.ownerId`. It now uses `card.heldBy ?? card.ownerId`
(`heldBy` is only ever set while the card is in a hand or deck). New test in
`packages/web/src/ai/__tests__/narration.test.ts`. No other spoils-game code
reads a card's owner as its holder. `npm run build` was run in spoils-db so the
game's `file:` dependency sees the new engine behavior; spoils-game's web
typecheck and the full `npm test` (87 files, 557 tests) pass.

## Not changed, noticed

- `revealCards` groups the cards it reveals by `card.ownerId`, and emits
  `cardsRevealed.ownerId` from that, so a borrowed card sitting in the thief's
  hand reads as revealed from the owner's hand (the web reveal toast and the
  engine log then name the owner). The `reveal` effect uses the zone's player
  instead and is right. Using `zoneHolderId(card)` in the grouping would match;
  left alone because it changes the event payload and it was outside this task.
- A `triggerZone: "discard"` ability on the stolen card itself, for the one
  `cardMoved` that puts it into the discard pile, still sees the in-play
  controller (the release comes after the emit). No printing relies on it.
