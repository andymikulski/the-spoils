# Emergency Obfuscation: the seat swap

Resolved 2026-10-16. **Implemented**, and the card stays at fidelity `full`: both printings (1st Edition `9df5c987-d2c0-45d4-86ae-1d487cc7f937`, Open Beta `1999770c-5f2d-415d-8da1-8efe44ef3e41`) now swap the sides while in play. The only judgment call is how to read the card; that reading is described below, and the one alternative worth knowing about is costed at the end.

## What the printed text says

"You may play this card whenever you could play a tactic. -- While this card is in play, both players switch seats. Both players are in control of their opponent's side. If the game ends, the owner of the winning deck wins the game. -- At the start of your turn, you must put a token on this card. -- At the end of your turn, if there are at least 2 tokens on this card, destroy it." (The catalog's later wording, "each player moves 1 seat to the left. Each player is in control of that opponent's side", is the same thing with two players.) Before this change only TACTICAL, the start-of-turn token and the 2-token self-destruct were modeled.

## What the Comprehensive Rules say

Nothing about seats or sides: "seat" and "side" never occur in `Comprehensive-Rules-2.5.pdf` or the FAQ 2.0. The rules that bound any reading are:

- **§102.1**: a faction at 0 influence makes *the owner of that faction* lose. Ownership, not control, decides the result, which is exactly what "the owner of the winning deck wins" restates.
- **§407.1-407.3a**: you control the cards you play; "you" on a card is its current controller (§407.2); a control change lasts until the card leaves play or another effect takes control, and the most recent effect wins.
- **§407.4**: a character whose controller changes during a battle leaves the battle.
- **§407.7-407.8**: you own what started in your deck; ownership never changes.
- **§305.1, §403**: discarding, hands, decks and discard piles are defined by *owner*; only the play area has a controller.
- **§204.2a**: characters enter play under the control of the card's or effect's controller.

## The model

A player's **side** is the faction they hold plus every card in play under their control (resources included). The players stay the engine's players: turns, priority and who may act do not move.

- **State.** `ContinuousAbility.swapsSides?: boolean` (`src/types/cards.ts`); `GameState.seatSwap?: SeatSwapState` (`exchanged: [{ cardId, previousControllerId }]`, present exactly while swapped); the `seatsSwapped { swapped }` event; `GameFlowView.seatsSwapped`; `GameStateSnapshot.seatsSwapped`.
- **When.** `checkStateBasedActions` calls `syncSeatSwap` first in each pass. The swap is applied when an **odd** number of live `swapsSides` sources are in play (suppressed or face-down ones do not count) and lifted when that stops being true, so it takes hold the moment the card enters play and ends the moment it leaves. Two sources cancel.
- **Applying.** Every card in play, both factions and the source included, goes to the opponent of its controller (the same `reassignControl` bookkeeping `takeControl` uses, so the `play` arrays follow). A card with `cannotBeTakenControl` keeps its controller. The players also exchange `factionId` and `influence`, so everything keyed on "the player's faction" follows control: develop / restore / start-of-turn rules are the held faction's, paid resources attach to it, "your opponent's faction" is the one the other player holds.
- **Lifting.** Each exchanged card still in play and still under the controller the swap gave it goes back to its previous controller; the factions exchange back. Cards that entered play during the swap were never part of it and stay with whoever played them (§407.1). A permanent `takeControl` during the swap drops that card from the record, so the latest effect wins (§407.3a).
- **Hand, deck, discard, void, removed.** Untouched; they stay with their owners (§305.1, §403, §407.7). Each player still plays from their own hand, draws from their own deck and discards to their own pile. Costs are paid with the resources they now control, thresholds come from the cards they now control.
- **Turn and the token clock.** "Your turn" on a card is its controller's turn. EO is on the side it was played to and swaps with it, so after it resolves the *opponent* controls it and the clock runs on the opponent's turns: played in your own turn T it gets its tokens on T+1 and T+3 and is destroyed at the end of T+3 (the sides are back for T+4). Played as a tactic in the opponent's turn it is destroyed at the end of the opponent's second turn after that.
- **Winning.** The victory check reads the loser from the faction card's owner, not from the player holding it. The faction a player attacks is the one the other player holds, so with the seats swapped every attack lands on the *attacker's own* faction; if that kills it, its owner loses and the owner of the deck that did the attacking wins ("the owner of the winning deck wins").
- **Mid-battle.** Played as a tactic during a battle, it hands every party member to the other player (§407.4), the parties empty and the battle ends without damage.

## Alternatives considered

1. *A seat / pilot identity separate from the deck* (engine state keyed by deck, a pilot map at the action boundary). Keeps the owner-keyed state as is, but every surface that carries a `PlayerId` (priority, pending choices, events, the log, the flow view) would have to be translated, and the turn order then runs by side rather than by player. Much wider than needed.
2. *Swap everything, hands, decks and discard piles included.* See "If the full-zone reading is wanted" below. Rejected because nothing in the CR or the card supports taking a player's hand and deck from them (§305.1 and §403 define those by owner), it would reveal each hand to the opponent, and it costs the largest change for the least certain gain.
3. *Exempt the source from the swap* so the player who played it keeps the clock. More comfortable in play, but the card does not say it and §407.2 is clear that "your turn" belongs to the controller. Left as written.

## Files changed

- Types: `src/types/cards.ts`, `src/types/state.ts`, `src/types/events.ts`.
- Engine: `src/engine/SpoilsEngine.ts` (`syncSeatSwap`, `applySeatSwap`, `liftSeatSwap`, `exchangeFactionSeats`, `factionHolderId`, `factionOwnerId`; faction-damage influence now goes to the faction's holder; the victory check keys on the owner; the `takeControl` effect and `moveCard` keep `seatSwap.exchanged` honest; flow view, snapshot and log line).
- Data: both printings gained `{ id: "swap", type: "continuous", modifiers: [], swapsSides: true }` through `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/emergency-obfuscation.patch.cjs` (idempotent). `data/card-coverage.json`: the `seat-swap` parity gap became the implemented capability `seat-swap`; `COVERAGE.md` regenerated with `node scripts/build-coverage.cjs`.
- Docs: `RULES.md` (§12 "Seat swap", plus the §11 victory and state-based-check lines), `BEHAVIORS.md`.
- Tests: `src/engine/__tests__/seat-swap.test.ts` (23 engine tests, synthetic fixtures); `describe("card behavior: Emergency Obfuscation ...")` at the end of `card-behaviors.test.ts` (needed by the "new ability shape" integrity invariant); per-printing tests appended to `per-card/printed-variants.test.ts` (both printings: the TACTICAL item with the swap authored, the full lifecycle through real turns, and a tactic-speed play in response to an attack).

## Notes for spoils-game

- `state.players[p].factionId` / `.influence` / `.play` mean "the faction and cards player p controls"; use `card.ownerId` to know whose they really are. A board renderer can keep drawing `players[viewer]` as "mine" and label the swap from `getFlowView().seatsSwapped` or the `seatsSwapped` event.
- `GameFlowView.seatsSwapped` is a new required field (matters only to code that builds a `GameFlowView` by hand).
- Winner is still `PlayerId | "draw"`; with the seats swapped the winner can be the player whose own attack finished the other side's faction.

## If the full-zone reading is wanted

Also exchange `hand`, `deck`, `discard`, `void` and `removed` between the two `PlayerState`s in `applySeatSwap` / `liftSeatSwap`, and then every place that files a card by `card.ownerId` must file it by *the player currently holding the owner's side*: `moveCard` (`owner`, `toHolderId`, `zoneOwner`), `zoneHolderId` and `CardInstance.heldBy` (flip it on swap), the `ownerOf` target refs, the owner-keyed conditions and selectors, `removeFromAllPlayerZones` callers, mulligan bookkeeping, and `GameFlowView.revealed`. Roughly a dozen sites, plus a decision on hidden information (the opponent's hand becomes yours to read). The existing tests in `seat-swap.test.ts` would need the "stay with their owners" assertions inverted.

## Open items

- `CARD-AUDIT-PROGRESS.md` still lists this item as "running": it is done.
- No unrelated failures: `npm run typecheck` and the full `npm test` run were green at the end. A transient `printed-variants.test.ts(1433,53)` typecheck error from another session appeared mid-way and cleared by itself.
