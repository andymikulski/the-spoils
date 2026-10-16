# Other reveals (not searches)

Status: done. 51 printings carry a new reveal in card data, 18 more reveal through the engine. Follow-up to
[search-reveal.md](search-reveal.md), which left these out.

## What counts

A printing whose printed text (`corrections.json[id].text`, else `text`) says "reveal" but whose behavior emitted no
`cardsRevealed`. The scan of all printings with "reveal" in the text found 65 such printings, none via `reveal` /
`revealCards` / `revealFromTopUntil` / `grantsReveal`. Only the printing's own text decides: Cheats McGuillicutty
1st Edition Part 2 says "look at and play" so it is untouched, the 2nd Edition says "Reveal the top card" so it reveals.

## Kinds of reveal and how each is emitted

| Printed text | Printings | Mechanism |
| --- | --- | --- |
| Reveal the top N cards of a deck: Jackmove (X), Eccentric Inquisition (7), Rosy Palmer (5), Meager Research (1, first sentence) | 3 + 2 + 2 + 2 | `reveal { of: "opponent", zone: "deckTop", count, viewer: "all" }` as the first effect |
| Reveal the top card of your deck: Roulette Wheel of DOOM!, Gambling Den, Dweedle Tee, Sharpey Pointy, Prophetic Assistant (inside its mayPay), Cheats McGuillicutty (2nd Ed), Barracks of Precipitancy (right after its shuffle) | 2 + 2 + 1 + 1 + 2 + 1 + 1 | `reveal { of: "controller", zone: "deckTop", count: 1 }` where the text reveals |
| "Choose a card type. If you do, reveal the top card": Dauntless Gambler, Flailing Knife, Flimflam Man, Opportune Slotpuller | 2 + 2 + 2 + 2 | the same `reveal`, first effect of every `chooserSelectsOption` option (after the choice) |
| Reveals their hand: Discommodiousness, Spatchcocking (RECUR) | 2 + 1 | `reveal { of: "opponent", zone: "hand" }` first effect |
| Look at the top N, choose X and reveal it: Intellectual Reliquary, Gilda, Auspicious Arrival | 2 + 1 + 1 | `revealCards { selected: <pick> }` right before the effect that moves the pick |
| A pick that is revealed: Demolition Investment (the opponent's face-down resource), I Drink Your Milkshake! (the removed/voided card) | 1 + 2 | `revealCards { selected }` before the effect that uses the pick |
| COST/EXTRA COST reveals of a target pick: Manifest, Hidden Ruins, Accidental Invention, Burly Assailment, Implosive Explosion, Gang Weapon Dealer, Enter The Demon Knights | 2 + 2 + 2 + 2 + 2 + 1 + 1 | `revealCards { selected }` as the first effect |
| Reveal this card from hand: Thabbashite Desert Creature | 1 | new `revealCards { target: "source" }` at the start of its mayPay |
| COST: reveal a resource from hand and shuffle it away: Uhluhtc Niudla AVAIL ANEW | 1 | new `moveSelected.reveal: true` (emitted as the cost is paid, from the hand) |
| "Reveal this card" on a face-down resource: FLIP IT x5, REUSE, PETTY VENGEANCE, SNICKER SNACK | 11 | engine: using any `fromFaceDown` ability emits `cardsRevealed` for the source after the costs are paid |
| Reveal this card from your hand as you play a resource: Witty Worm, Unexpected Codicil (FINE PRINT) | 3 | engine: the `revealFromHand` develop play emits it |
| Auction House: reveal from the top until a character | 2 | engine: `beginAuction` emits the cards turned over (zone `deck`) |
| Mustache Showdown: "Reveal the chosen piles" | 2 | engine: `settleMustacheShowdown` emits the two chosen piles |

Engine additions (all additive): `revealCards.target?: TargetRef` (types/effects.ts), `moveSelected.reveal?: boolean`
(types/costs.ts), a private `emitReveal` helper in `SpoilsEngine.ts` (also now behind `revealCards`), and the four
engine-side emissions above. Timing note: a cost-time reveal whose pick is a `targets` declaration (the COST/EXTRA COST row)
is emitted when the ability or tactic resolves, because the existing effects cannot run at cost payment.

## Gaps (printed "reveal" with no reveal)

- Slightly Less Evil Alliance: Showdown (hero/villain) text; the faction has no abilities modeled.

It is listed in `UNMODELED` in the test, which fails once it starts revealing so the entry gets dropped.
Community Chest's mulligan reveal was a second gap; it is modeled now, see [reveal-followups.md](reveal-followups.md).

## For spoils-game

`useTableEventQueue` used to skip the controller of `byCardId` for every public reveal, which was wrong whenever the
revealer learns the card (an opponent's deck top or hand, the top of their own deck). `cardsRevealed.knownToRevealer`
now says when they already knew; see [reveal-followups.md](reveal-followups.md).

## Files

- `data/card-audit/deferred/other-reveals.patch.cjs` - the rules (card name + the sentence that must be printed +
  the edit); idempotent, throws if a behavior no longer has the expected shape:
  `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/other-reveals.patch.cjs`
- `data/cards.json`, `src/data/cards.js` via the locked tool only
- `src/types/effects.ts`, `src/types/costs.ts`, `src/engine/SpoilsEngine.ts`
- `src/engine/__tests__/other-reveals.test.ts` (new)
- `RULES.md`, `BEHAVIORS.md`

## Tests (`other-reveals.test.ts`)

- Real printings end to end: Roulette Wheel of DOOM! (own deck top, before the pick), Meager Research (opponent's top card
  and then the searched card, in that order, reveal before the move), Discommodiousness (whole opposing hand, before the
  shuffle), Intellectual Reliquary (taken tactic revealed from the deck; none taken reveals nothing), Cheats McGuillicutty
  (2nd Edition reveals, 1st Edition Part 2 does not), Elitist Upgrade FLIP IT (face-down source revealed as it is paid
  for), Uhluhtc Niudla (reveal as a cost, once, from the hand).
- Engine: face-down ability reveals the source (a face-up one does not), Witty Worm reveal from hand, `revealCards.target`,
  Auction House (cards through the first character; the whole deck without one), Mustache Showdown (the two chosen piles,
  only after both picks).
- Data: every printing whose text says reveal has a reveal mechanism bar the two gaps; only a printing whose text says
  reveal carries a public `reveal` / `revealCards` / `moveSelected.reveal` (a private "look at" viewer is allowed);
  every `fromFaceDown` / `revealFromHand` printing prints "Reveal this card"; every `revealCards` pick names an existing
  declaration; re-applying every patch rule to its printings is a no-op; per-name checks that every printing of
  Jackmove, Eccentric Inquisition, Rosy Palmer, Meager Research, Intellectual Reliquary, Gilda, Auspicious Arrival,
  Discommodiousness, Spatchcocking, Roulette Wheel, Dauntless Gambler, Auction House and Mustache Aficionado reveals.

If another session rewrites a card behavior and drops a reveal, the data tests fail; re-run the patch module.

## Printings changed in card data (51)

**1st Edition** (2)

- 300b1274-898a-4769-8422-ab07c00ca51e Meager Research
- 66b79f2b-629d-4f94-9b59-598b2abfd05b Jackmove

**1st Edition Part 2** (2)

- 847cd807-e515-4c1f-8c4d-fa0ffd7b217d Eccentric Inquisition
- 42334135-ad09-4e14-b243-597d4a44384e Discommodiousness

**2nd Edition** (4)

- 9dadce7a-caff-45f9-9c42-a4b0a38e6298 Eccentric Inquisition
- 02d85379-a5cb-40ae-bbd4-dd6337f680a1 Discommodiousness
- 078b8b9a-b559-44b9-b86d-7cee8727b3ad Cheats McGuillicutty
- 37c534eb-781f-4386-b0be-afdb268efd05 Jackmove

**Holy Heist** (2)

- 7be95bf9-e696-4f1d-82cd-e9f23c94f346 Uhluhtc Niudla
- 3714b3c6-39af-4c56-a508-ad389be90933 Dweedle Tee

**Open Beta** (2)

- d25a15e6-3f64-484a-bc42-5121528329c7 Meager Research
- 63358d71-4e67-40e8-811c-6d1d8ce36f3f Jackmove

**Seed** (7)

- 32c1ba5b-4c61-4b63-9bb8-305910aa6202 Intellectual Reliquary
- 1a6323e1-ea9a-4ea0-acee-0eaa9b61a9c1 Dauntless Gambler
- e7405d47-49f3-4b3a-adb5-1444fc726135 Flailing Knife
- 24de2269-2902-4800-a2f9-2ad2de1f1ee5 Flimflam Man
- ee8821d4-4933-4e4b-a632-c4db1b91ea95 Gambling Den
- b176a78f-7145-4635-943c-4b41e21279bd Opportune Slotpuller
- 88812b6d-a80c-4271-88e0-d3bf47a8aeaf Roulette Wheel of DOOM!

**Seed 2** (8)

- c60f04b2-f629-4183-8daf-9219af91bb4a Manifest
- 6331bedf-cb85-42f9-a5b6-b84aee290627 Hidden Ruins
- a9d9be90-b1ba-4cea-9abb-1b570317441d Prophetic Assistant
- e3ca7aad-a38b-4181-a743-e70c6e2f119b Accidental Invention
- 1c5c411a-4655-4284-b1b2-b38a73713292 Burly Assailment
- 6f1bdb80-2506-4724-bf83-950a81cc531a I Drink Your Milkshake!
- 4d801a32-d054-413d-9eaf-d915a82139b1 Rosy Palmer, and Her Five Friends
- 5384f0ca-4c8b-42a9-870b-de4ffb5229be Implosive Explosion

**Seed 3** (1)

- d23a3fbd-0bf3-4937-9b29-570c55a418b8 Spatchcocking

**Seed Saga** (17)

- 1848963f-93a8-4eae-8977-f76b2547bce5 Enter The Demon Knights
- 6b78870c-5993-46f0-b782-47154a18a681 Gilda, Mother of Gideon
- 0f42a647-6978-4794-a208-c69a737fc5f6 Intellectual Reliquary
- ee4f6ce1-1bbd-4b1e-9801-cab64259568d Manifest
- 18787e03-08d6-4264-a4b6-a31734b66ac3 Hidden Ruins
- d15348e5-338a-4e07-9387-c8036a0640be Prophetic Assistant
- 2f3de5dd-f373-4e08-bb93-e5451a96d275 Accidental Invention
- 380fbd91-5070-4bde-bce2-806dd4045968 Burly Assailment
- 095baa26-832e-42fe-ad55-9d38b1c9c66a Dauntless Gambler
- 00186a1f-1215-4e64-9163-8f1ff603bbee Flailing Knife
- b4b364e2-652f-4102-a7f7-a485f25a8efe Flimflam Man
- 0a6c2548-8c2a-4352-a8ea-b97257aa2ac7 Gambling Den
- 83807d38-2e87-4c3e-9167-5488979e4267 I Drink Your Milkshake!
- a7b5a023-4311-4102-96eb-05f19a671e01 Opportune Slotpuller
- fdfd2018-584b-4fa7-b9d9-e29f7961337a Rosy Palmer, and Her Five Friends
- a4ef4ba6-ae09-4901-b784-58c4e2db1b76 Roulette Wheel of DOOM!
- 8dc6d0cb-f250-44fc-a963-486bf5a196f7 Implosive Explosion

**Shade of the Devoured Emperor** (4)

- 353e341b-7e8a-4a9b-8b5e-caa53eaf3042 Auspicious Arrival
- 53f1700e-6445-4b87-bf00-c69f88c6a278 Gang Weapon Dealer
- c6e93f75-e05d-4dfb-a77d-c74b662a7c02 Sharpey Pointy Lethal Army Tool
- ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca Barracks of Precipitancy

**Ungodly Mess** (2)

- e9f59763-c924-4f5a-83b7-b53c1d541d4f Thabbashite Desert Creature
- 453db85c-818d-4e89-a019-9abf16307109 Demolition Investment

## Printings that reveal through the engine (18, no card edit)

- 71886432-9edb-44a6-b9aa-7890b3267cf3 Auction House (1st Edition Part 2) [auction]
- ae9ae5db-e784-4193-ad45-400f7ba900bc Auction House (2nd Edition) [auction]
- 91a709fd-3225-4576-a200-e4bac342bdda Obsessive Concentration (Holy Heist) [fromFaceDown]
- a261f7b6-de13-4e76-ad41-f34ce4c4da16 Greedy Profiteering (Holy Heist) [fromFaceDown]
- 9b20e73f-8eef-41a0-82d5-8942987fe044 Elitist Upgrade (Holy Heist) [fromFaceDown]
- 969913a5-1444-4d50-9225-9e82a30a56a6 Deceptive Domain (Holy Heist) [fromFaceDown]
- 9192b2fa-b568-4ac1-bfd9-b9cb31d8fa42 Raging Ferocity (Holy Heist) [fromFaceDown]
- 5161057f-2ee8-4f52-be3d-1c983ac1e2e0 Witty Worm (Seed 2) [revealFromHand]
- ce1bd138-b938-4d98-b69a-cc0ecf05d7d3 Fired Hand (Seed 2) [fromFaceDown]
- 1dffc074-b158-4134-b52e-9e6e56541cf0 Mustache Aficionado (Seed 2) [mustache]
- 8012f792-69c0-4a16-88dd-9209463f4f58 Vorpal Sword (Seed 2) [fromFaceDown]
- 81fc1a08-8f87-4ae8-9c5a-ce904b9e0847 Witty Worm (Seed Saga) [revealFromHand]
- 01ee5f0f-1c90-4fe0-9d79-2c8d081e59ae Fired Hand (Seed Saga) [fromFaceDown]
- f276a0be-6c30-4276-a743-30e63619dc41 Mustache Aficionado (Seed Saga) [mustache]
- f98061c7-7dd2-4163-947f-a59367118f57 Invade! (Seed Saga) [fromFaceDown]
- f41f27d3-af88-4782-b024-39c8a6e9620a The Emperor Born (Seed Saga) [fromFaceDown]
- 2bcf9af1-212c-4b0b-84d9-1f0e9d2e79e5 Vorpal Sword (Seed Saga) [fromFaceDown]
- 9407541a-9b2b-44cd-b1b4-e0979f192ebb Unexpected Codicil (Shade of the Devoured Emperor) [revealFromHand]
