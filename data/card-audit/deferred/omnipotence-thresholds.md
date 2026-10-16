# Threshold paragraphs ignore OMNIPOTENCE (`meetsAllThresholds`)

CR 405.4 / 201.5d: a paragraph of rules text that begins with threshold icons
("[R][R][R]: This card gains 3 life.") is active only while its controller
**meets that threshold**. The Evil Alliance's OMNIPOTENCE ("You automatically
meet all thresholds, even if you don't control the proper resource icons") is
`FactionDefinition.meetsAllThresholds`. Deploying a card, using an ability with a
`threshold`, and FLIP UP already honored it (they go through the engine's
`meetsThreshold` check). Threshold paragraphs did not: they were authored as
`numberCompare(resourceIcons(controller, icon) >= N)`, which counts real icons
only, so for an OMNIPOTENCE player they stayed off unless the icons were really
there.

Status: **fixed.** 85 printings (64 cards) now gate their threshold paragraphs
on a new `meetsThreshold` condition.

## Design

One new concept, types first:

```ts
// src/types/conditions.ts
{ type: "meetsThreshold"; player?: PlayerRef; threshold: string }
```

- `threshold` is the card-threshold shorthand (`r g d e o v`; `"oovv"` needs two
  of each), so a mixed-icon paragraph is ONE condition, not an `and` of
  comparisons. `player` defaults to `"controller"`.
- Evaluated by `evaluateCondition` -> `SpoilsEngine.meetsParagraphThreshold`:
  true when the player's faction has `meetsAllThresholds` (new private
  `hasOmnipotence`, also used by the deploy check) OR they control at least the
  required count of every icon (`getThresholds`).
- The deploy-time check (`meetsThreshold`) is untouched apart from calling
  `hasOmnipotence`. `reduceThreshold` (Clockman Skydocks) and FEALTY slack are
  deploy-only and deliberately do NOT apply to a standing paragraph.

### Why a new condition rather than making `numberCompare` honor the flag

`resourceIcons` is also the counting expression: "X is the number of [O] you
control" (Wrinkly Rabbit, Pit Boss, Blazing Shriever, Boilstorm, Desolate, ...),
amounts, costs, `variableBounds`. Those must keep reading real icons under
OMNIPOTENCE (a player with no [R] still deals 0 damage "equal to the number of
[R] you control"). Detecting "this `numberCompare` is a threshold check" from the
comparison's shape (`resourceIcons >= literal`) would also catch the inline
"if you control at least [V][V][V]" sentences, so the data would have to
disambiguate anyway. An explicit `meetsThreshold` condition keeps the two
meanings apart in the type system and in the data, and handles mixed thresholds
as one node.

### Scope decision: inline "if you control [V][V][V]" is not a threshold

OMNIPOTENCE satisfies *thresholds*. CR 405 gives a threshold to a card, an
ability, or a paragraph. An inline "If you control [V][V][V], draw a card" is a
control check inside an effect, not a printed threshold, so these stay on real
icons (`numberCompare` over `resourceIcons`). They are pinned by tests so a
reversal is a deliberate decision. If the designers rule that OMNIPOTENCE also
satisfies these, the fix is to replace the comparison with
`{ type: "meetsThreshold", threshold: "vvv" }` on these nine printings:

| Card | Set | Printing id | Printed text |
|---|---|---|---|
| Additional Tribute | Holy Heist | `a64326fe-e6a2-4398-ad70-88e4584fb7af` | "If you control [V][V][V], you may look at the top card of your deck..." |
| Night-basking Basilisk | Holy Heist | `0350dd91-0ba4-43d6-b470-bb66d4746bef` | "EXTRA COST: If you control [O]x6, reduce the numeric cost of this card by 4." |
| Religious Rejection | Holy Heist | `efa822c3-c417-4513-ad18-4b40fc3649d5` | "If you control [V][V][V], draw a card." |
| I See You! | Holy Heist | `1866ab78-bc4c-4181-8556-73a0f675686e` | "If you control [V][V][V], this turn, the character loses 1 speed." |
| Suicide Smash | Holy Heist | `519a6b1a-f64e-4fe1-b586-39b32f7b328a` | "If you control [V][V][V], inflict 3 damage to an opponent's faction." |
| Ritual of the Double Monkey | Seed 2 | `e93a6fc4-da98-4698-b44f-3d1269903dfb` | "If you control [O][O][O], ... If you control [O]x8, ..." |
| Unscrupuls of Victory | Seed 3 | `b91d33d1-aeed-4953-b57b-463204b25bc6` | five "If you control at least [X][X], ..." sentences |
| Officially Offensive Overseer | Shade of the Devoured Emperor | `7e485e5b-2d3a-4013-98d9-f7c9e47ccb57` | "COST: If you control at least [O][O][O], you may pick a character or a location." |
| Community Chest | Seed 3 | `fe7095e0-d918-420c-9303-fbc5054d2564` | "If you control at least [D] and choose to put this card on the bottom of your deck as part of your mulligan..." |

## Also found: a stray `threshold` on a triggered ability

`Cicibeo, The Implicator` (`f0e7f09c-4354-4042-9454-0aea33e7d133`) prints
"[D][D][D][D]: When another "cicibeo" character enters play..." but its CONSPIRE
trigger carried `"threshold": "dddd"` as an ability field. Only *activated*
abilities read `threshold` (`activateAbility`), so the trigger fired with no
icons at all. It now has the `meetsThreshold` gate in its condition and the stray
field is gone. A catalog guard fails if any non-activated ability carries a
`threshold` field.

## How `threshold` fields are gated (checked)

86 activated abilities (counted across printings) carry `threshold` ("RECUR: [G]", "EXHUMATION: [O][O]").
`activateAbility` checks it through the deploy-side `meetsThreshold`, which
honors OMNIPOTENCE. FLIP UP (`flipUp.threshold`) and `revealFromHand.threshold`
use the same check. No change needed; tests added for the ability field and FLIP
UP.

## Printings migrated (85)

Selected as every printing whose printed text (`corrections.json` else `text`)
has a paragraph that begins with threshold icons followed by a colon (CR 405.4).
For each one, every ability-level `condition` (and `modes[].condition`), walking
through `and`, had its `resourceIcons >= N` gate(s) replaced by one
`meetsThreshold` carrying the printed icon letters. The patch aborts unwritten
unless each printing's resulting set of thresholds equals the set of its printed
leading-icon paragraphs. After the run no migrated printing reads `resourceIcons`
at all. 130 `meetsThreshold` nodes in total (a card with a continuous plus a
triggered ability for one paragraph, like Thabbashite Priest of Zig, has one per
ability).

The earlier "18 printings" fix (`threshold-paragraphs.md`) is a subset; the other
67 printings (54 cards) were already in the catalog as `continuous` / `triggered`
abilities or tactic `modes` gated on `resourceIcons`.

| Card | Set | Printing id | Printed threshold paragraph(s) |
|---|---|---|---|
| 0v3rw0rk3d 31f | Holy Heist | `7dd26a5f-d0dc-4231-b70a-d11b189f28db` | eeeeee |
| Affectionate Dollkeeper | Seed | `bf855ca9-e1ed-47ae-8c79-b625f3d50ffe` | ddd |
| Affectionate Dollkeeper | Seed Saga | `f72c5546-6a63-4146-b7f9-b4e40364ff4a` | ddd |
| Anxious Imp | Shade of the Devoured Emperor | `72661539-2086-49b7-a58d-b66a2ba45a30` | oooooo |
| Beefy Researcher | Ungodly Mess | `f7868f88-8581-4e71-bfb4-2e16b9f6c615` | eeeeee |
| Bloating Bask | Shade of the Devoured Emperor | `3db20240-f5a5-4fd9-925d-39b32cab7618` | rrrrrr |
| Boorish Boar | Holy Heist | `3176810c-984e-4104-8c5f-b1d8014dc36e` | rr rrr |
| Bursting Bask | Ungodly Mess | `51a2c73b-4459-4678-8e2e-d464f967a8fa` | rrrrrr |
| Candy Skull Commander | Ungodly Mess | `4897e844-426b-4333-bc8b-3377d4ff6339` | dddddd |
| Cicibeo the Swift | Shade of the Devoured Emperor | `8d77787d-29d9-405f-a8a7-5d42bd854c11` | dddddd |
| Cicibeo, The Implicator | Ungodly Mess | `f0e7f09c-4354-4042-9454-0aea33e7d133` | dddd |
| Circumspect Hijacker | Seed | `84f4481a-b22c-4c95-88a1-13cfbeb7d910` | ggg |
| Circumspect Hijacker | Seed Saga | `b9e1bbca-df8b-4b53-bdf3-096740b7313d` | ggg |
| Circumspect Hijacker | Ungodly Mess | `e02fe443-bd47-41e7-8790-1a57a237b8cf` | ggg |
| Crimson Pandiatus | Ungodly Mess | `5ce550a8-1829-4b9c-bde7-a1b7bb33c29f` | rrrrrr |
| Crushjaw Oceanhide | Seed Saga | `22a59555-9544-4e93-8728-64c15c7dc8c4` | eeeee |
| Cryptic Athenaeum | Seed | `12b6d2a3-5b34-4914-bcc4-20ddb1ad39ba` | ooo ooooo ooooooo |
| Cryptic Athenaeum | Seed Saga | `746d863d-9b90-4cca-8896-a111523d4f7a` | ooo ooooo ooooooo |
| Death Investor | Ungodly Mess | `b974a7f9-f347-4731-8e5c-f3f2a41d1877` | gggggg |
| Discordant Cadencer | Shade of the Devoured Emperor | `c842afad-8ee7-4e59-bb42-f06f51bf7bf6` | rrrrrr |
| Disposable Meatsack | Ungodly Mess | `583491b2-a17c-4fdc-9014-12b4c1250f67` | rrrrrr |
| Drill Garrison | Seed | `0dfc144b-12b2-472c-b7af-8c7bbf815a0e` | rrr rrrrr rrrrrrr |
| Drill Garrison | Seed Saga | `6d4b0079-550c-4cea-a2a0-ff889c523ab2` | rrr rrrrr rrrrrrr |
| Dwarvish Grimalkin | Seed 2 | `d39ed5bb-20a7-403c-99c5-1612f53abb4e` | gg ggggg ggggggggg |
| Dwarvish Grimalkin | Seed Saga | `af11ee70-afa0-483a-bf4d-57ebd80d432e` | gg ggggg ggggggggg |
| Dying Hero | Seed 2 | `5feab281-375b-4cc3-ac68-98682fef7738` | rrrrrrrrr |
| Dying Hero | Seed Saga | `9011295f-4992-45b6-bf28-73d1d80aa8dd` | rrrrrrrrr |
| Elitistmajig | Shade of the Devoured Emperor | `3a4918d7-7c70-4753-b070-0c6dd8799811` | eeeeee |
| Espionage Loafers | Holy Heist | `473c8d59-8f53-4454-8d9a-5186b0bc697a` | ggggg |
| Fanatical Shriever | Shade of the Devoured Emperor | `9eddb4f8-2055-48b8-8942-664e6c9a0f50` | rrrrrr |
| Feckless Chronicler | Ungodly Mess | `123ecdbd-dd93-4aff-a8b2-5841bd9af29e` | ddd |
| Fervent Beastslayer | Seed | `726aa869-bbaf-4c79-8dc7-eb3367282a88` | rrrrr |
| Fervent Beastslayer | Seed Saga | `a2557335-92fc-48da-b007-39f95c3beeea` | rrrrr |
| Fleet Majig | Ungodly Mess | `49eef7ab-5fec-40a7-968e-0731d97067c4` | eeeeee |
| Gewgawed Gimcrack | Seed 2 | `38060403-d6bc-450e-9644-94be30d5ddb9` | eee |
| Gewgawed Gimcrack | Seed Saga | `7b0362f7-a07b-430f-8730-99c7f07a602c` | eee |
| Ghosts of Loot | Ungodly Mess | `f536d2ec-e175-4834-a32c-643fecba715f` | vv vvvvv |
| Gloamspike-Gosche Bridge | Shade of the Devoured Emperor | `40c10ab8-454a-4bab-98a0-d0530c983344` | oooooooo |
| Guardbeast of Thabbash | Holy Heist | `f2890e06-fa66-41a2-b0f0-6e4b4807a907` | oooo vvvv |
| Hall of Conventions | Seed | `78d1d283-421a-41f1-9bd9-c6a30f391821` | eee eeeee eeeeeee |
| Hall of Conventions | Seed Saga | `087e9f67-d5d9-410c-b196-1ce6fd7edf41` | eee eeeee eeeeeee |
| Heavy Sword | Seed | `4f12295b-4ef4-458e-95bc-55998b69dc63` | rrrr |
| Heavy Sword | Seed Saga | `9baa43e5-86ec-48d6-850a-e7c76765da5d` | rrrr |
| Heist Training Grounds | Seed | `8791105b-7df3-4998-aa65-ab966d007869` | ddd ddddd ddddddd |
| Heist Training Grounds | Seed Saga | `6da2fd15-6bc5-4b73-b21c-d281e6b9b544` | ddd ddddd ddddddd |
| Horns of Thabbash | Holy Heist | `7e5943c6-1683-4ba0-a762-e0ac3dbdd6b8` | vvv |
| Leaping Sarume | Holy Heist | `3a90b12f-8ecf-42eb-b67b-9b1c5abf0ddf` | rrrrrr |
| Marduun Baitings and Loan | Seed | `30363637-822a-424d-84b4-4ec05b79c6b0` | ggg ggggg ggggggg |
| Marduun Baitings and Loan | Seed Saga | `b067403e-8030-42db-b481-c82e773bd83d` | ggg ggggg ggggggg |
| Monstrous Lassitude | Shade of the Devoured Emperor | `99ed6205-1f9e-4d62-a1ae-f9038449db17` | vvvv |
| Neuralyzer Agent | Shade of the Devoured Emperor | `0a7c01eb-92bd-4172-9c0d-24886de70287` | oooooo |
| Obtuse Pipesmoker | Seed | `6201f5e4-9b41-497c-9634-dc2ac6847ea2` | ddddd |
| Obtuse Pipesmoker | Seed Saga | `03134a22-581a-4bfb-9b80-1237542cff76` | ddddd |
| Party Crashers | Ungodly Mess | `0c04cd9f-7c2c-4cf9-9c00-01dd4edb543c` | eeee |
| Phantasmagoric Tollbooth | Holy Heist | `d70efc6c-9a6e-41ab-92a2-cb97662f172f` | rrrrrr |
| Protractive Golem | Seed | `d71bb0f8-8a73-4b9e-9b2c-e6feb31345d8` | eeeeee |
| Protractive Golem | Seed Saga | `507502a9-9011-489c-8a22-7d031d697078` | eeeeee |
| Righteous Exemplar | Seed | `ef7a641c-efb6-41e7-8648-45124a07681c` | rrrrr |
| Righteous Exemplar | Seed Saga | `dd895e2b-e38c-490f-b73a-5ee31dcd3233` | rrrrr |
| Robustical Badass | Seed | `1855fff6-56b5-45df-8792-3436ebb5c3ba` | rrr |
| Robustical Badass | Seed Saga | `c1cc2de0-3430-42e2-af02-ff9418a3bdd5` | rrr |
| Runic Armor | Seed | `d41f7e5e-6a4e-433b-9ae5-c0f29b451865` | eeeee |
| Runic Armor | Seed Saga | `6ae38ff9-786d-4ac3-8bf0-00d2903b4e74` | eeeee |
| Rushing Crushing Blockhead | Shade of the Devoured Emperor | `ef509645-3df1-44fb-955b-069fc0aebe35` | rrrrrr |
| Shrouded Demon | Seed | `db0e93b4-a1e1-41ef-b564-261d2b81085a` | ooo |
| Shrouded Demon | Seed Saga | `0fc2bf9c-fd6f-47d9-a53a-cb12558bd883` | ooo |
| Silent Sentinels | Ungodly Mess | `0038a68b-ae48-4fbf-93c2-4e7c15406815` | eee |
| Smokin' Hottie | Ungodly Mess | `59c7f2ec-2f3e-4260-b819-b90e859bdef9` | vvvv |
| Soulsearcher | Ungodly Mess | `8fef5e5f-e9ba-4738-808e-3f97577664e7` | o g e d r |
| Spry Archer | Seed 2 | `98321c0c-3aef-4820-8636-9353e3c8a3b0` | rrrr |
| Thabbashite Assailant | Shade of the Devoured Emperor | `f474ddf4-9fa8-44f2-b74c-9eebe554f125` | v vv vvv vvvv |
| Thabbashite Convert | Ungodly Mess | `c3c8d704-54ad-480b-98f5-6e4c5f621bf9` | eevv |
| Thabbashite Glutton | Ungodly Mess | `a0243e83-005c-4bec-8454-0bbb86489d3c` | ggvv |
| Thabbashite Host | Ungodly Mess | `4f0e52f0-eb5a-4f49-8606-1b722891ca4f` | rrvv |
| Thabbashite Priest of Zig | Ungodly Mess | `a68f9301-53c7-4b67-ac5b-dc61c6f689ed` | oovv |
| Thabbashite Seer | Ungodly Mess | `e9927400-459f-4c38-a223-4d3b958e70ae` | ddvv |
| Thabbashite Urchin | Holy Heist | `e4730213-75fc-4614-9466-1b3c1e42e630` | vvv |
| Thabbashite Warmonger | Shade of the Devoured Emperor | `f75a2be6-4c8f-43e2-b23f-28d1892062c0` | v |
| Thabbashite Weapons Expert | Ungodly Mess | `e8cd0ae5-9aba-4996-8a29-3f160b2d96f2` | vvvvv |
| The Abominable Hamster | Seed | `c6b5109e-0a98-45c3-907f-b15bd97c7a1b` | ooooo |
| The Abominable Hamster | Seed Saga | `728eb69a-f0c7-4787-86de-e4ebf544a136` | ooooo |
| Velocious Golem | Seed | `738bcd83-9c42-4913-a000-2d8ccab2d78e` | eee |
| Velocious Golem | Seed Saga | `4e97e2b1-7346-41ee-9e4c-41f59556816f` | eee |
| Vicious Bruiser | Holy Heist | `97ccef0f-b39a-42d7-8521-0c7549cfef60` | rrrrrr |
| Zenobia's Succor | Ungodly Mess | `f9372755-6c19-4d67-85ba-c73c259e6b2c` | o g e d r |

## What did NOT change

Everything else that reads `resourceIcons` (51 printings, 33 cards) keeps
counting real icons: the "X is the number of [icon] you control" family
(damage/draw/tokens/cost/`variableBounds`/stat modifiers: Wrinkly Rabbit, Pit
Boss, Warbeast of Thabbash, 3p1c D00dm4k3r, Blazing Shriever, Boilstorm,
Godwing Thunderhoof, Devilfang Thunderhoof, Thabbashite Temple, Zigalburgonglgr,
Walk the Plank, Chancellor of Reinstatement, Hypnotic Illusionist, Headhunting,
Drygulch, Horrifying Brain-Monkey, Desolate, 313373 M3ch4n1c, Obscene Astrologer,
President Model #16, Aroused Stiffbone, Fantastic Uber Kool Creator Majig, Fecal
Urgency), Ritual of the Knob & Pull ("at least X face-down resources"), and the
nine inline-control printings listed above.

## Tests

- `src/engine/__tests__/omnipotence-thresholds.test.ts` (new, 35 tests; synthetic
  fixtures plus real catalog cards):
  - synthetic paragraph: real icons meet it, wrong icons do not, no stacking past
    the threshold, an OMNIPOTENCE controller with zero icons meets it, with real
    icons it still applies once, the opponent's OMNIPOTENCE and icons do not help,
    a card under an OMNIPOTENCE player's control uses that player's faction,
    mixed `rrgg`, face-down Volition, `player: "opponent"`, `reduceThreshold` does
    not loosen a standing paragraph, keyword-granting paragraph;
  - triggered paragraph (enters-play draw) fires only when met, and for
    OMNIPOTENCE with no icons;
  - NOT affected: a "+1 strength per [R]" counting card stays at the real count
    (0 icons -> +0, 2 icons -> +2), an inline `resourceIcons >= 2` gate stays off
    for OMNIPOTENCE with no icons, and on one board a `meetsThreshold` paragraph is
    on while the counting gate is off;
  - other gates: an activated ability's `threshold` and FLIP UP honor OMNIPOTENCE;
  - real cards with the real The Evil Alliance: Fervent Beastslayer, Thabbashite
    Priest of Zig ([O][O][V][V]), Zenobia's Succor (the [R] mode is playable with
    no [R] only under OMNIPOTENCE), Cicibeo The Implicator (needs [D]x4 or
    OMNIPOTENCE), Boorish Boar (destroyed on entering play under OMNIPOTENCE, not
    with just [R][R]), Pit Boss (counts 0 / 2 real icons), Religious Rejection
    (inline [V][V][V] is not satisfied by OMNIPOTENCE);
  - catalog guards: each printing's `meetsThreshold` gates equal its printed
    leading-icon paragraphs, every threshold is icon letters, no leading-icon
    printing reads `resourceIcons`, no ability/mode `condition` is a bare
    `resourceIcons >= N` gate (Community Chest excepted: inline), and no
    non-activated ability carries `threshold`.
- `card-data-integrity.test.ts`: `meetsThreshold` added to the known type tags.
- `threshold-paragraphs.test.ts`: header comment only.
- Existing per-card suites (seed, holy-heist, ungodly-mess, ...) pass unchanged
  against the migrated data.

## Results

- `node --import tsx --test src/engine/__tests__/omnipotence-thresholds.test.ts`:
  35 pass, 0 fail.
- `npm test`: 5086 tests, 0 fail. (A baseline run before the change had 2 failures from other sessions' in-progress work: `4p7 31f` bad event `cardAttached`, and the Ecto-Distillation search-reveal check. Both were gone by the final run.)
- `npm run typecheck`: no errors from this change. The only errors are in another session's in-progress file `src/engine/__tests__/per-card/printed-variants.test.ts` (it moved between runs: an `attachedTo` placement field, a `"develop"` comparison, then a duplicate `printedRules` identifier).

## Docs

- `RULES.md` section 4 (threshold paragraphs authored as `meetsThreshold`, the
  OMNIPOTENCE rule, the inline-count scope decision) and section 3.6
  (`meetsAllThresholds`).
- `BEHAVIORS.md`: `meetsThreshold` condition entry, `resourceIcons` note,
  `destroysSource`, the Seed 2 idiom note, and the `meetsAllThresholds` bullet.
- `threshold-paragraphs.md`: "Known gap" replaced by a pointer here.
- `COVERAGE.md` / `data/card-coverage.json` untouched (its `faction-omnithreshold`
  line stays accurate).

## Patch module

`.work/patch-meets-threshold.cjs` (git-ignored scratch), applied with
`node scripts/card-audit/patch-cards.cjs .work/patch-meets-threshold.cjs`. It
derives the printings from printed text, asserts the per-printing threshold set,
and is safe to re-run (a second run finds no `resourceIcons` gates; the existing
`meetsThreshold` nodes already match, so every printing reports "unchanged").
