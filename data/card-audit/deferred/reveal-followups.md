# Reveal follow-ups

Status: done. Two items deferred from [search-reveal.md](search-reveal.md) and [other-reveals.md](other-reveals.md).

## 1. The revealer sees a reveal that teaches them something

`useTableEventQueue` (spoils-game) skipped the controller of `byCardId` for every public reveal, on the assumption that
they already know what is shown. That holds for a search pick or their own hand, and fails for the top of a deck (their
own or an opponent's), an opponent's hand, an opponent's face-down resource and the like.

### Event field

`cardsRevealed.knownToRevealer?: boolean` (`src/types/events.ts`): set when the player who caused the reveal already
knew every card in the event, absent otherwise. Absent is the safe default (the moment is shown). `emitReveal` takes a
predicate and sets the flag only when every card in an event qualifies.

| Reveal | `knownToRevealer` |
| --- | --- |
| `revealCards` (search pick, "look at the top N, choose X and reveal it", a target pick, `target: "source"`) | set, unless the card is another player's face-down card in play |
| `moveSelected.reveal` cost | same rule |
| `fromFaceDown` ability reveals its source, `revealFromHand` deploy | set (their own resource / hand card) |
| `reveal` effect, zone `hand` | set when the hand is the controller's own, absent for an opponent's hand |
| `reveal` effect, zone `deckTop` | absent (their own or the opponent's top card is news) |
| `revealFromTopUntil`, Auction House | absent |
| Mustache Showdown chosen piles | set for the controller's own pile, absent for the opponent's |
| Unlikely Heroes' `startingDrawSearch` | set (the faction searched for it) |
| Demolition Investment (the opponent picks their own face-down resource) | absent: the revealer did not pick or see it |
| Community Chest's mulligan reveal | set (the player just chose to bottom it) |

### spoils-game rule (`packages/web/src/useTableEventQueue.ts`)

A reveal is shown to its `viewerId`, or, when `viewerId` is `"all"`, to everyone except a revealer whose
`knownToRevealer` is set. A private look (`viewerId` is a player) is still only for that player.

Tests (`packages/web/src/__tests__/TableEventQueue.test.tsx`, `reveals`): a search reveal is shown to the opponent and
not to the searcher (the event carries `knownToRevealer`); the revealer sees the opponent's deck top, their own deck top
(and the opponent sees it too), and the opponent's hand; the revealer does not see their own hand reveal but the
opponent does; a private look is shown to the looker only; an opponent-only reveal is not shown to the revealer.

Engine tests: `src/engine/__tests__/reveal-knowledge.test.ts` (`knownToRevealer` on each real printing and engine path
in the table above).

## 2. Community Chest's mulligan reveal

Printed (Seed 3, `fe7095e0-d918-420c-9303-fbc5054d2564`): "If you control at least [D] and choose to put this card on the
bottom of your deck as part of your mulligan at the start of a game, you may reveal it. If you do, draw a card at the
start of your turn."

The hook was contained, so it is modeled:

- New event `cardsMulliganed { playerId, cardIds }` (`src/types/events.ts`), emitted by `SpoilsEngine.mulligan` once the
  cards are on the bottom of the deck and recorded on `GameState.mulligan`, before the replacements are drawn. It has a
  log line ("X puts N cards on the bottom of their deck in the mulligan"; the count only, not which cards).
- New triggered ability `chest-mulligan-reveal` (`triggerZone: "deck"`, `event: "cardsMulliganed"`): the event is the
  controller's, the card was bottomed in the mulligan, and the controller has at least one [D] resource icon. Its effect is
  `revealCards { target: "source" }`. The [D] gate is read at mulligan time, as printed; starting resources are already
  face-up then.
- "You may reveal it" is taken automatically, the same treatment RULES.md section 5 already gave it.
- Card data through `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/community-chest.patch.cjs`
  (idempotent). Community Chest left `UNMODELED` in `other-reveals.test.ts`.

Not changed: the existing `chest-mulligan-draw` still checks [D] at the start of each turn and does not require the
reveal to have happened, so a Chest bottomed without [D] at the mulligan but with [D] later still draws. Gating the draw on
the reveal would need a recorded "revealed" flag; left as is.

Tests (`reveal-knowledge.test.ts`): through `createTwoPlayerFactionGame` with the real printing, bottoming the Chest with
a [D] starting resource reveals it from the deck to everyone, after `cardsMulliganed` and before the replacement draw;
the other player's mulligan does not reveal it again; keeping it, no [D] among the starting resources, or bottoming only
other cards reveals nothing.

## Files

spoils-db:
- `src/types/events.ts` (`cardsRevealed.knownToRevealer`, `cardsMulliganed`)
- `src/engine/SpoilsEngine.ts` (`emitReveal` predicate and `pickedByRevealer`, each reveal site, `mulligan`,
  `describeEvent`), `src/engine/factionSetup.ts` (`startingDrawSearch`)
- `data/card-audit/deferred/community-chest.patch.cjs`; `data/cards.json` and `src/data/cards.js` via the locked tool only
- `src/engine/__tests__/reveal-knowledge.test.ts` (new), `other-reveals.test.ts` (`UNMODELED`),
  `card-data-integrity.test.ts` (`cardsMulliganed` in the known event types)
- `RULES.md`, `BEHAVIORS.md`

spoils-game:
- `packages/web/src/useTableEventQueue.ts`, `packages/web/src/__tests__/TableEventQueue.test.tsx`
