# Threshold paragraphs modeled as free activated abilities (G8)

CR 201.5d / 405.4: a paragraph of rules text that begins with threshold icons
("[R][R][R]: This card gains 3 life.") is a **static condition**, active only
while its controller meets that threshold. It is not an ability you activate.
Ten cards modeled those paragraphs as cost-free `activated` abilities with a
`threshold` gate, so they could be used any number of times (a probe took
Fervent Beastslayer 2 -> 5 -> 8 -> 11 -> 14 life over four free activations).

Status: **fixed** for all 10 cards, 18 printings. No other printing in the
catalog has the mistake.

## Printings fixed

Every printing was remodeled from its own printed text (`corrections.json[id].text`
if present, else `text`). All 18 print identical text to their sibling printing,
so Seed and Seed Saga share behavior. The patch asserts each printing's printed
text before touching it.

| Card | Set | Printing id |
|---|---|---|
| Boorish Boar | Holy Heist | `3176810c-984e-4104-8c5f-b1d8014dc36e` |
| Shrouded Demon | Seed | `db0e93b4-a1e1-41ef-b564-261d2b81085a` |
| Shrouded Demon | Seed Saga | `0fc2bf9c-fd6f-47d9-a53a-cb12558bd883` |
| The Abominable Hamster | Seed | `c6b5109e-0a98-45c3-907f-b15bd97c7a1b` |
| The Abominable Hamster | Seed Saga | `728eb69a-f0c7-4787-86de-e4ebf544a136` |
| Protractive Golem | Seed | `d71bb0f8-8a73-4b9e-9b2c-e6feb31345d8` |
| Protractive Golem | Seed Saga | `507502a9-9011-489c-8a22-7d031d697078` |
| Runic Armor | Seed | `d41f7e5e-6a4e-433b-9ae5-c0f29b451865` |
| Runic Armor | Seed Saga | `6ae38ff9-786d-4ac3-8bf0-00d2903b4e74` |
| Obtuse Pipesmoker | Seed | `6201f5e4-9b41-497c-9634-dc2ac6847ea2` |
| Obtuse Pipesmoker | Seed Saga | `03134a22-581a-4bfb-9b80-1237542cff76` |
| Fervent Beastslayer | Seed | `726aa869-bbaf-4c79-8dc7-eb3367282a88` |
| Fervent Beastslayer | Seed Saga | `a2557335-92fc-48da-b007-39f95c3beeea` |
| Heavy Sword | Seed | `4f12295b-4ef4-458e-95bc-55998b69dc63` |
| Heavy Sword | Seed Saga | `9baa43e5-86ec-48d6-850a-e7c76765da5d` |
| Righteous Exemplar | Seed | `ef7a641c-efb6-41e7-8648-45124a07681c` |
| Righteous Exemplar | Seed Saga | `dd895e2b-e38c-490f-b73a-5ee31dcd3233` |
| Soulsearcher | Ungodly Mess | `8fef5e5f-e9ba-4738-808e-3f97577664e7` |

## How they are modeled now

A `continuous` ability whose `condition` gates the bonus (`modifiers` or
`keywords`). It was first authored as `numberCompare` of `{ type:
"resourceIcons", player: "controller", icon }` `>=` the printed icon count; that
gate is now `{ type: "meetsThreshold", threshold }` (see
`omnipotence-thresholds.md`), and the Condition column below reads as that
threshold. Ability ids are unchanged; only `type` and the shape changed. Markup already
described these as `<rule when="...">` blocks, so it is untouched.

| Card | Condition | Static effect |
|---|---|---|
| Boorish Boar (RR) | rage >= 2 | +1 strength, -1 life on source |
| Boorish Boar (RRR) | rage >= 3 | `destroysSource: true` (see below) |
| Shrouded Demon | obsession >= 3 | +2 life (COVERT stays a printed keyword) |
| The Abominable Hamster | obsession >= 5 | +2 strength (COVERT stays printed) |
| Protractive Golem | elitism >= 6 | +3 strength, +3 life, -1 speed |
| Runic Armor | elitism >= 5 | `attachedTo` +2 strength, +1 life (on top of the unconditional +1/+2) |
| Obtuse Pipesmoker | deception >= 5 | +1 strength, +1 life, +1 speed |
| Fervent Beastslayer | rage >= 5 | +3 life |
| Heavy Sword | rage >= 4 | `attachedTo` +2 strength (on top of the unconditional +2); HANDOFF untouched |
| Righteous Exemplar | rage >= 5 | +1 strength, +1 life |
| Soulsearcher | obsession / greed / elitism / deception / rage >= 1 (five independent abilities) | COVERT / +2 life / AGGRO / +1 speed / +2 strength |

Because the bonus is a continuous modifier it applies once however many extra
icons the controller has, switches off the instant the threshold is lost, and
only the controller's icons count. Soulsearcher's old "until end of turn"
durations are gone: the paragraphs hold while the icon is controlled.

### Engine additions (needed for Boorish Boar)

"[R][R][R]: Destroy this card." has no existing representation (a static
paragraph that destroys its card). Added, types first:

- `ContinuousAbility.destroysSource?: boolean` (`src/types/cards.ts`). While
  its `condition` holds the source is destroyed by `checkStateBasedActions`
  (`hasActiveSelfDestruct` in `SpoilsEngine.ts`). Covers entering play with the
  condition already true. A replacement that keeps the card in play does not
  re-trigger the check forever.
- `chooseDevelop` now runs `checkStateBasedActions()` after the develop play. A
  resource played by the Develop Rule previously never triggered a state-based
  check, so a threshold change from it was not seen until the next action.
- RULES.md section 4 and BEHAVIORS.md describe both.

## Tests

- `src/engine/__tests__/per-card/seed.test.ts`: `thresholdParagraphSuite` runs
  for Fervent Beastslayer, Heavy Sword, Obtuse Pipesmoker, Protractive Golem,
  Righteous Exemplar, Runic Armor, Shrouded Demon and The Abominable Hamster,
  against both the Seed and Seed Saga printing. Each checks: bonus only at the
  threshold, no stacking with extra icons, only the controller's icons count,
  the old ability id is gone and activating it throws without changing stats,
  and the bonus turns on when a resource is played and off when one is
  destroyed. Demon and Hamster also keep a COVERT check.
- `per-card/holy-heist.test.ts`: Boorish Boar (RR static +1/-1, no abilities to
  activate, opponent's icons ignored, destroyed on reaching RRR with its death
  trigger dealing 2 damage, destroyed on entering play at RRR).
- `per-card/ungodly-mess.test.ts` and `ungodly-mess-smoke.test.ts`: Soulsearcher
  (each paragraph on/off, independence, no stacking, controller only, nothing to
  activate, on/off as resources enter and leave).
- `threshold-paragraphs.test.ts` (new, synthetic cards): `destroysSource`
  semantics, including the replacement-keeps-it-alive case.
- `card-data-integrity.test.ts`: the "frozen keywordless activated abilities"
  list lost the 15 entries for these cards (only Thabbashite Penumbra remains),
  and a new catalog-wide guard fails if any non-tactic printing whose printed
  text has an icon-led paragraph carries an unnamed, cost-free activated
  ability. Seed Saga's reprint-parity checks pass unchanged (same behavior as
  Seed).

## Catalog scan for other printings with the same mistake

Scanned all 2101 printings (printed text = corrections else `text`) for any
paragraph beginning with threshold icons (`[X]...:`, including mixed icons and
one-icon paragraphs), and separately for every non-tactic activated ability with
no costs. **No extra cards found.** Only the 10 cards above matched. Reviewed
near-misses that are correct and unchanged:

- Remains of Foreman Pete, the Clock Man: CLOCK OUT / WORK IT / CLOCK IN are
  printed named abilities with a threshold in the header; costs are real.
- Zenobia's Succor: a tactic whose icon-led lines are `modes` gated on
  `resourceIcons`.
- Every other icon-led paragraph (Vicious Bruiser, Bloating Bask, Thabbashite
  Assailant, Dying Hero, the "[icons]: When ..." triggered cards, ...) is already
  a gated `continuous` or `triggered` ability.

## Former known gap (fixed)

A `resourceIcons` comparison reads only the controller's counted icons, so it
ignored OMNIPOTENCE (`meetsAllThresholds`, The Evil Alliance). Fixed by the
`meetsThreshold` condition; every threshold paragraph in the catalog (85
printings, including these 18) now uses it. See
`data/card-audit/deferred/omnipotence-thresholds.md`.

## Patch module

`.work/patch-threshold-paragraphs.cjs` (git-ignored scratch, applied with
`node scripts/card-audit/patch-cards.cjs .work/patch-threshold-paragraphs.cjs`).
It is idempotent-safe: it asserts the expected printed text for each printing and
replaces the old activated abilities by id.
