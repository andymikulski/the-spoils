# Behavior worklist (phase 4)

Every printing plays exactly as printed on its own card. Each `[ ]` below is a printing whose card text differs in meaning from the catalog text that its behavior was written from.

Per printing:
1. Read its printed text: `corrections.json[id].text` (or the scan in `data/card-audit/scans/`), and open the image if anything is unclear.
2. Read its `behavior` in `data/cards.json` and decide whether it already plays as printed.
3. If it doesn't, change **that printing's** behavior only. Other printings of the name may differ. Prefer extending the effect/condition vocabulary over one-off code (spoils-db CLAUDE.md).
4. Add or adjust its per-card test in `src/engine/__tests__/per-card/<set>.test.ts`. The `def(name)` in that file picks the set's printing.
5. `npm run sync-cards`, run the set test, tick the box, and log one line under Decisions in CARD-AUDIT-PROGRESS.md.

Mark `[x]` when fixed or confirmed already correct, with a short note.

## G1 — "your opponent" / "your hand" / "your deck" vs the target's controller/owner

The card names the opponent (or you) where the catalog says the picked card's controller/owner. That only differs when you pick your own card. The behavior must name the player the card names.

- [x] **Blow Up** — 1st Edition Part 2 `efa9c2c1-5448-4733-a6c4-471f7d625c02` — fixed: influence loss → opponent (printed-variants test)
- [x] **Blow Up** — 2nd Edition `be0aa55a-b127-4a2c-af8e-dca2724e15b6` — fixed: influence loss → opponent
- [x] **Caboodling Gladhander** — Seed `d75f8c4e-5fd7-4169-8daa-051c703fb089` — fixed: influence gain → opponent; Seed Saga printing keeps controller (tested)
- [x] **Irresistible Bribe** — 1st Edition `5b3672b9-2bfe-4b64-87a0-eb3a1dfb085e` — fixed: ownerOf → opponent
- [x] **Irresistible Bribe** — 2nd Edition `4779dd8b-22b8-45ea-adfc-aaf6c9ce11d8` — fixed: ownerOf → opponent
- [x] **Irresistible Bribe** — Open Beta `8e36b4a0-419d-413d-9512-b539e37681aa` — fixed: ownerOf → opponent
- [x] **Redonkulous** — Seed 2 `464b99b7-c1b7-43ae-9248-68f7614fd2cb` — already correct (behavior used opponent); the Seed Saga printing was the wrong one → fixed to controllerOf(char) (tested)
- [x] **Ritual of the Knob & Pull** — 1st Edition Part 2 `dbc439b3-5628-43ef-bbc1-ea7523e85fb0` — fixed: counts opponent's face-down resources
- [x] **Ritual of the Knob & Pull** — 2nd Edition `87b8eec4-0dec-4ab0-a8da-c7cf70740890` — fixed: counts opponent's face-down resources
- [x] **Scrag** — 1st Edition `98f6844e-bafe-43e9-9782-9c45b40339fb` — already correct (counts opponent's discard pile)
- [x] **Scrag** — 2nd Edition `a41131b1-d9ab-404b-bd55-1fa9d9c77dcf` — already correct
- [x] **Scrag** — Open Beta `c0b6851e-1ad8-4079-8f81-5e5ff07f9187` — already correct
- [x] **Splattergun** — 1st Edition Part 2 `69c99fee-c4fd-45ff-9d04-da0cc01ecd54` — fixed: control goes to opponent (tested)
- [x] **Splattergun** — 2nd Edition `324adb64-5b1e-4e8f-bd5c-f21a4f03f197` — fixed: control goes to opponent (tested)
- [x] **Needless Beating** — 1st Edition Part 2 `3ea9bbe2-4b32-4f04-9e2c-7a1201b655b9` — fixed: pick any character (tested)
- [x] **Needless Beating** — 2nd Edition `06b104b7-eb32-4a44-9b33-587c0345715d` — fixed: pick any character (tested)
- [x] **Mass Confusion** — Seed `48c4d2f0-8d0f-4203-a6ae-b81d9ebce2eb` — fixed: pick any characters (tested); Seed Saga 'pick a player' kept opponent-only (picking yourself gives Y=0, 2-player equivalent)
- [x] **Smothering Corpulence** — Seed 2 `48ac4062-dca5-469f-8b39-54f4519e137d` — fixed: pick any character (tested)
- [x] **Surprise!** — Seed `95ad5456-4279-4481-848b-933036e72684` — fixed: attacking opponent character only; Seed Saga had the same misparse (accepted any location) — fixed too (tested)
- [x] **Underhanded Gamer** — Seed `8c111617-ef44-42a4-a79e-b895dd8005c3` — no change: 'your opponent' vs 'an opponent … by those players' is identical in a 2-player game
- [x] **Maladjustment** — 1st Edition Part 2 `556c61ec-857e-4773-80fb-b180513696f4` — FIXED by sub-agent: toPlayer controller (deferred/your-hand-zones.md)
- [x] **Recollection Bazaar** — 1st Edition Part 2 `e5a8f861-fbbd-4c45-8b1d-2ddec10120bd` — FIXED by sub-agent (as Maladjustment)
- [x] **Foment** — Seed 2 `cccbf037-ad87-4626-952d-22351b64d91c` — FIXED by sub-agent (as Maladjustment)
- [x] **Two-Headed Coin** — 2nd Edition `90a28359-1bad-419f-bd94-1566b810853f` — FIXED by sub-agent: toPlayer controller; reflip now payable

## G2 — duration ("this turn") on the card vs not

The card has no "this turn" where the catalog does, or the reverse. Effects last as printed.

- [x] **A Series of Tubes** — 1st Edition `9d3a3159-52c7-428a-b4ed-db2719792304` — fixed: REDIRECT shield is persistent (new preventDamage.persistent) (tested)
- [x] **Befuddling Beggar** — Open Beta `a68bfa26-c188-47b6-bdc3-a39cb829f5c2` — fixed: speed change is permanent (tested)
- [x] **Clockman Skydocks** — Shade of the Devoured Emperor `0146d330-33ea-4847-8d52-25810a946e40` — fixed: threshold reduction persists to the next card played (new reduceThreshold.persistent) (tested); 'up to 6' = 6 (reducing less never helps)
- [x] **Fleshripping Scenepuller** — 1st Edition Part 2 `c8037ec2-03ca-464f-83d1-a00f45db5873` — fixed: strength gain is permanent (tested)
- [x] **Strength In Numbers** — Open Beta `2328f545-4af5-4ff4-b9f8-5878f89de654` — fixed: gains are permanent (tested)

## G3 — "only member of an attacking party" conditions

The card requires this card to be the only member of the attacking party, and the catalog dropped that condition.

- [x] **Clockman Pickpocket** — 1st Edition Part 2 `cc55231b-da46-435a-95ef-d26fc8de31c0` — fixed: unblockable only as sole attacker; item pick mandatory (2E printing's pick made mandatory too: 'if they can') (tested)
- [x] **Cute Cutpurse** — 1st Edition Part 2 `46d4519b-b2ff-4306-9489-9ce28ecc3a5b` — fixed: sole attacker; pick mandatory (2E too) (tested)
- [x] **Face in the Crowd** — 1st Edition `9eefa81d-6214-47bf-af77-7bb5ca92c8d4` — fixed: sole attacker (tested)
- [x] **Schproingmajig** — 1st Edition Part 2 `8041780e-69a0-458a-8563-eabfa164ac2f` — fixed: SCHPROING! grant only while sole attacker (new grantKeyword.condition) (tested)
- [x] **Thundering Nilpha** — 1st Edition Part 2 `a297d28b-8f81-411b-8d1f-6d39f467952d` — fixed: sole attacker attacking a location (tested)

## G4 — Micromajig tokens without the majig subtype

Old reminder text gives tokens 1/1/3 and no subtype. The catalog adds "majig".

- [x] **Micromajig Avalanche** — 1st Edition `f81f97e9-1583-438a-9afd-216644040796` — fixed: tokens have no subtype (tested)
- [x] **Micromajig Avalanche** — Open Beta `b6aa3573-a252-4bbf-9237-906d2cdde193` — fixed: tokens have no subtype
- [x] **Micromajig Factory** — 1st Edition `bba8a718-d685-4731-bf6e-3acdc92f7a75` — fixed: tokens have no subtype
- [x] **Micromajig Factory** — Open Beta `040f72fb-1b6a-4b7b-aa30-904f1199fc66` — fixed: tokens have no subtype
- [x] **Micromajig Maker** — 1st Edition `81afa3d9-1060-46cc-8986-e992f8277ebe` — fixed: tokens have no subtype
- [x] **Micromajig Maker** — Open Beta `497ffcb2-6a2e-40ee-a91d-1d608ecd7225` — fixed: tokens have no subtype
- [x] **Micromajig Master** — 1st Edition `d0ce5f33-bb41-40c1-9b4e-36677c5ef390` — fixed: tokens have no subtype
- [x] **Micromajig Master** — Open Beta `71148cc0-f98a-4636-a0ed-2c5c0b206cae` — fixed: tokens have no subtype; OVERWORK vs TINY SACRIFICES is only the ability name (markup shows the printed name)
- [x] **Micromajig Shipping Container** — 1st Edition Part 2 `c466319c-2c2d-48eb-8511-4033385a6c30` — fixed: tokens have no subtype (tested)

## G5 — reveal / "up to" / "either deck"

The catalog adds a reveal or "up to", or rewords which deck. Check which printings of the name print the same thing, because some scanners rated identical changes as `wording`.

- [x] **700160x 31f** — 1st Edition `98e1b892-4da0-4b36-b877-23b5fae6dd79` — no change: the found gear goes into play (public), so 'reveal' is moot
- [x] **Cheats McGuillicutty** — 1st Edition Part 2 `0af6286e-db1d-44c2-9e23-38ccc3f558e9` — no change: top card is revealed at all times anyway; CHANGE COSTUME's card goes into play; resources can't be played from the top by rule (2E reminder text)
- [x] **Cheats McGuillicutty** — 2nd Edition `078b8b9a-b559-44b9-b86d-7cee8727b3ad` — no change (as 1E2)
- [x] **Contriving Engineer** — 1st Edition Part 2 `e6209034-2b54-4889-8789-15b12c330056` — no change: Elitism goes into play (public); UM printing's equivalent behavior unified with 2E
- [x] **Heist Planner** — 1st Edition `89a84630-93c8-4461-b625-5f32380b3ed4` — no change: cards go to the discard pile (public), reveal is moot
- [x] **Heist Planner** — Open Beta `5f93b923-bd32-4591-9a90-67c68a1e7c88` — no change (as 1E)
- [x] **Master Ritualist** — Open Beta `fbbffe5f-fa1f-43b7-bd89-264a17a09cb3` — no change: search reveals aren't modeled engine-wide (follow-up)
- [x] **Arcanist's Almanac** — 1st Edition `fbfb201f-0928-4dd4-a6a1-c378fbfd3bb1` — already correct: behavior looks at exactly the top 5 (as printed); 'either deck' = 'any one deck'
- [x] **Arcanist's Almanac** — Open Beta `f09cc7b1-96fd-47e5-946d-324962b9efe9` — already correct (as 1E)
- [x] **Nearby Serpent** — 1st Edition `26186aa1-0ff0-4f34-9a82-8ec01ffb3eef` — already correct (exact top 5)
- [x] **Zenobia's Spyglass** — 1st Edition `d1f42443-f291-4303-bf7a-490ec6c82b50` — already correct (exact top X+X)
- [x] **Zenobia's Spyglass** — Open Beta `50279c47-609a-444f-89c9-492d97711e1e` — already correct (exact top X+X)
- [x] **Jackmove** — 1st Edition `66b79f2b-629d-4f94-9b59-598b2abfd05b` — already correct: reveals exactly the top X
- [x] **Jackmove** — Open Beta `63358d71-4e67-40e8-811c-6d1d8ce36f3f` — already correct (exact top X)
- [x] **1337!** — 1st Edition `64b33dfe-3811-4466-a7b4-5ffa7a680687` — no change: 'up to 4 less' — reducing by less is never better and the reduction is consumed either way
- [x] **Jo Ciendeilio** — 1st Edition `4e071253-4a43-404c-aad5-15aa1e953501` — no change ('up to 3 less', as 1337!)
- [x] **Research Assistant** — 1st Edition `84935011-df3b-435a-a801-792df8da41f0` — no change ('up to 1 less')
- [x] **Runic Circuitry** — 1st Edition `0384d364-6144-4bfa-bde2-2d8e62ba94ac` — no change ('up to 3 less')
- [x] **Towering Researchmajig** — 1st Edition `d5a23b94-241d-4353-a454-3cd6cf96907a` — no change ('up to 1 less')

## G6 — wrong-version or misprinted catalog text in later sets

The catalog carries a different version of the card than the one printed.

- [x] **Corrosive Waste Dispenser** — Ungodly Mess `083e0cca-f86f-4922-9bf5-04d254ebfc4e` — fixed: CONVERT costs Pay 1 + a player-picked non-micromajig (was random); effect now opponents only (forEachPlayer made you destroy one too) (tested)
- [x] **Headshot** — Ungodly Mess `e98c5fe5-ad44-4541-94fe-ddc9eca924c7` — already correct: the 4-step chain = 'repeat this effect up to three more times'
- [x] **Voidal Tactician** — Ungodly Mess `a59feec7-7291-40f8-af99-8ca84aa2cb8c` — fixed: 'when this card is depleted' one-shot trigger to deploy a void tactic ignoring threshold (was an ongoing permission while depleted); search targets the faction's owner = controller (tested)
- [x] **Wasted Wickedness** — Ungodly Mess `feb21afe-1749-4041-b5b0-0586c4bc4964` — fixed: two modes (pick opponent / pick yourself), X = that player's staple types, mandatory return, factions excluded; added FLIP UP 1 [O] (tested)
- [x] **Feckless Chronicler** — Ungodly Mess `123ecdbd-dd93-4aff-a8b2-5841bd9af29e` — fixed: added FLIP UP 2 [D] (tested)
- [x] **Lockbox of the Aeons** — Ungodly Mess `0049c804-79a6-4981-85fe-3137949e3970` — already correct (as the rare printing)
- [x] **Lockbox of the Aeons** — Ungodly Mess `2475968c-7bb5-43c1-8225-1bf9d8fdc059` — already correct: restriction applies while you control it; 'returned to their hands' = from void/discard/play
- [x] **Cunning Ruse** — Ungodly Mess `19fa3b83-2708-4d40-9928-0a02f46c7cb0` — already correct: flipFaceDown is under the owner's control, as printed
- [x] **Efficacious Gunslinger** — Ungodly Mess `357c2e36-8f77-4126-bcda-afc6ac1ef485` — fixed: any damage (removed battle-only condition) (tested)
- [x] **Cicibeo, The Implicator** — Ungodly Mess `f0e7f09c-4354-4042-9454-0aea33e7d133` — already correct for 'card' trigger scope; ALSO fixed IMPLY: take control only if the revealed top card is a character (was a free choice) (tested)
- [x] **Gosche's Restoration Fortress** — Ungodly Mess `2585fca5-dea5-4753-a6ca-80c53328ec76` — fixed via engine: last-known stats for the event card ('strength that character had') (tested)
- [x] **Frantic Jerryrigging** — Ungodly Mess `a9c7ba1c-1080-4a81-932a-ab573c7a193f` — no change: the card never defines X (misprint); X = the destroyed item's numeric cost is the only workable reading
- [x] **Thabbashite Penumbra** — Ungodly Mess `8817125b-0cc8-43ba-a08e-c6711a79ecaa` — already correct ('different types of staple resources' = distinct staples; OBFUSCATE name shown via markup)
- [x] **Elitist Upgrade** — Holy Heist `9b20e73f-8eef-41a0-82d5-8942987fe044` — fixed: FLIP IT Pay 5, usable during battle, pumps all Micromajigs (any controller) (tested)
- [x] **Seriously Weird Crystalline Artefact** — Holy Heist `a341e5b6-b513-45f6-b25b-d27edbe20305` — no change: 'UNIQUE IGNATIUS' is a misspelling of the UNIQUE IGNATIOUS designation (Ignatius Gloamspike); matched as the same unique
- [x] **Mistaken Identity** — Seed Saga `da95244d-134d-4648-bb5d-c4e1e4fbd6ff` — fixed: Seed Saga also answers abilities whose COST picked a character; Seed 2 stays card-only (tested both)

## G7 — one-off mechanics (older printings and individual cards)

Each needs its own reading of the card. Includes reminder-text-only and 2-player-equivalent cases, which may need no behavior change. Record that decision too.

- [x] **4p7 31f** — 1st Edition Part 2 `f98c69dc-d771-430d-95f0-69461bc3c1ee` — fixed: also triggers on cardAttached (gear attached later), not only entering play attached (tested vs 2E)
- [x] **Barracks of Precipitancy** — Shade of the Devoured Emperor `ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca` — no change: printed 'if it leaves play … remove it from the game' ends the same as the borrowed (removed-instead) model
- [x] **Beatrix Winterbottom** — Open Beta `bb64ac1b-8361-475a-8598-0dd67ce6222b` — no change: 'if you would draw … instead you don't draw' = the engine's draw prevention ('cannot draw')
- [x] **Counter Attack** — 2nd Edition `17565f9a-fdd4-488c-889f-03fa430f358b` — no change: reminder text only ('immediately' is how the engine resolves it anyway)
- [x] **Ecto-Distillation** — Open Beta `37f34e7c-dbb2-4393-ad6a-bac2a3571ba9` — fixed: every copy comes out, you must take one (tested)
- [x] **Emergency Obfuscation** — 1st Edition `9df5c987-d2c0-45d4-86ae-1d487cc7f937` — 2-player equivalent wording; the seat swap itself was never modeled in ANY printing → delegated (deferred/emergency-obfuscation.md)
- [x] **Emergency Obfuscation** — Open Beta `1999770c-5f2d-415d-8da1-8efe44ef3e41` — as 1E (delegated)
- [x] **Flailing Knife** — Seed `e7405d47-49f3-4b3a-adb5-1444fc726135` — no change: an ATTACH TO CHARACTER item entering play must attach, so 'put this card into play' = 'attached to a character'
- [x] **Flaming Cube** — Shade of the Devoured Emperor `de91eacd-1b08-4595-a238-f4654e554ab8` — fixed: unconditional destroy + only opponents lose 6 (forEachPlayer+opponent hit both factions) (tested)
- [x] **Giada, the Elegant** — Seed 3 `0b67c755-4053-4bfb-9aef-e3a990501e0d` — fixed: no damage reset (not printed) (tested)
- [x] **Gold Summit** — Open Beta `1a988e25-bd1f-47e0-995e-1a7a72306961` — no change: +1 per card drawn totals the same as +X per draw
- [x] **Guardforce Morphmajig** — 1st Edition Part 2 `6af508e9-b4a9-473d-80fc-4c1ecbdd5781` — no change: the missing reminder text doesn't change the rule (resource plays aren't card plays)
- [x] **Hidden Sandwich** — 2nd Edition `0254473b-3a7a-418f-b541-74a3a57d2978` — no change: 'is destroyed … instead' is still the replacement; 'treat as no damage' = damage reset
- [x] **Hilarious Refrigerator Alarm** — Seed 3 `febadb33-11cf-4dec-815b-5e86d03488f0` — no change: 'all unresolved cards' can't include the resolving card itself; 'up to 2' tokens never worse than 2
- [x] **Hypnotic Plafond** — 1st Edition `db63215e-f4a2-465d-8c0a-efdd3b6e79b7` — fixed: COVERT parties can't attack your faction (preventsAttackOnFaction.partyAllMatch) (tested)
- [x] **Hypnotic Plafond** — Open Beta `97b1e279-1f9e-4787-8f3b-997293a6e928` — fixed (as 1E)
- [x] **I Drink Your Milkshake!** — Seed 2 `6f1bdb80-2506-4724-bf83-950a81cc531a` — fixed: removed from the game (not void); echo deploy now works (engine fix) (tested)
- [x] **Imperial Army** — Seed 3 `2ce14e80-b0c6-4a3a-999b-c240b4fff9d5` — no change: the tournament-play sentence is meta text, not on this side
- [x] **Jumping Screamspider** — 1st Edition `bb218756-23cf-43e5-bb27-c18398a251c1` — fixed: SCREAM is now a this-turn aura (stacking per use; was a snapshot of the current battle, useless before combat) (tested)
- [x] **Jumping Screamspider** — Open Beta `f06da0b2-9539-4171-b968-38dfb9ae9523` — fixed: as 1E plus once each turn (tested)
- [x] **Kettinger** — Open Beta `90a923f7-847e-4b87-9a28-eab4b3cd4340` — fixed: +3 strength as printed (tested)
- [x] **Limited Liability** — 1st Edition `1fe85217-bff3-488c-967e-8ce08470070c` — no change: 'no damage can be inflicted' = reduced to 0 (CR 408.1: 0 damage is no damage); cost destruction still allowed
- [x] **Limited Liability** — 2nd Edition `5f4ac8a0-c748-40dd-b591-1afabeb306fa` — no change (as 1E)
- [x] **Limited Liability** — Open Beta `61a6b51d-fd2d-459f-acef-261b08962694` — no change (as 1E)
- [x] **Lugubrious Node** — 1st Edition `eff724e3-e824-45ed-a8a3-43d8379e75b3` — fixed: added the missing 'cannot be destroyed by other node cards' (new replaces.bySource) (tested)
- [x] **Makeshift Contrivance** — 1st Edition `f5d12db2-7bfa-41ae-a99d-0994027c4584` — fixed: 'put a resource into play' (new playResource.putIntoPlay, no resourcePlayed) (tested)
- [x] **Martial Arts Master** — 1st Edition Part 2 `9a90a89c-c3ef-4c6c-b185-b34813a75b54` — fixed: no opposing-character condition; unblocked gains its speed (tested)
- [x] **Quipmajig** — 1st Edition Part 2 `04a9990f-2c23-4788-96da-17e120fa53b7` — no change: 'cannot inflict damage' = damage reduced to 0 (CR 408.1)
- [x] **Raging Bask** — 1st Edition `2a9daa10-ec29-4d9f-b578-f86028adcce3` — no change: 'if blocked, assign damage to the attack's target' = redirectDamage
- [x] **Raging Bask** — Open Beta `52d7cbbb-e848-441e-95d5-2cb4006f5195` — no change (as 1E)
- [x] **Ravenous Wolf** — 1st Edition `dd3e5e68-1f1c-478a-a743-992b59b6b847` — fixed: drawback whenever played at tactic speed (new deployedAsResponse condition) (tested)
- [x] **Ravenous Wolf** — Open Beta `8ccb3e92-e728-48e0-a631-c2b87c06e5f6` — fixed (as 1E) (tested)
- [x] **Research Investment** — Open Beta `828a6b95-9e5f-4035-b348-6258c1937c87` — fixed: up to 5 staples (tested)
- [x] **Samuel Gristwalter** — 1st Edition `50923614-01ee-46c0-9296-8e937fc99c62` — no change: 'no damage can be inflicted' = reduced to 0 (CR 408.1)
- [x] **Sarcophyle Matriculation** — 1st Edition `4c74c015-d20e-4558-95d0-e5d31d414b5b` — fixed: replacement now also depletes it (tested)
- [x] **Sarcophyle Matriculation** — Open Beta `e53172ad-eba1-453f-949d-910e4aba0bd6` — fixed: it IS destroyed, then put into play under your control, depleted (tested)
- [x] **Scavengemajig** — Open Beta `acf84206-ef48-4274-8d7d-fd3b38e6152a` — fixed: puts the item into play under your control (was: to hand) (tested)
- [x] **Shocking Reappearance** — Open Beta `b06ca42b-097e-4f1e-a28f-1994b264a2c2` — fixed: only once you are blocking (a blocking party exists); 1E printing same (tested)
- [x] **Skin Suit** — 1st Edition Part 2 `421c7d4c-d711-4a05-9955-d3834655f5fa` — no change: sequential damage + destroyed→removed + permanent text grant matches the printing
- [x] **Spiky Atlasphere** — 1st Edition `9ea55dc6-c610-42f3-b680-ab2d0e24bb99` — already correct: 'inflicts no damage this battle' is unconditional in the behavior, as printed
- [x] **Study Disturbance** — Shade of the Devoured Emperor `9107d563-b481-4bb2-8878-64589951e341` — fixed: pay-2 branch looks at your top card; buyout-on-resolution IS the printed timing → fidelity raised partial→full (tested)
- [x] **Subversion Matrix** — 1st Edition `66044076-6088-4eba-ab7d-5319ee1db663` — fixed: no ATTACH TO (enters unattached, attaches via MOVE) (tested)
- [x] **Tactician Vacation** — 1st Edition `f5b4db56-d972-48de-b1b5-7f16b7d427aa` — no change: 'that tactic has no effect' = terminate; restriction applies to everyone this turn
- [x] **Tactician Vacation** — Open Beta `5ca25182-e910-4f21-97d0-b30298e7d4af` — no change (as 1E)
- [x] **Tedious TriAdic Truculence** — Shade of the Devoured Emperor `5379e1b4-5ccc-457d-8490-82d85615143e` — fixed: 3 picks with different names; buyout on resolution as printed → fidelity full (tested)
- [x] **The Billionaire** — 1st Edition `ff195e18-a459-4594-b155-8572b869f368` — FIXED by sub-agent: canUseOpponentAbilities "asOpponent" — every cost paid as the opponent (deferred/billionaire-and-reveal-holder.md)
- [x] **The Billionaire** — Open Beta `2ec131a8-26eb-4dd7-914d-ced1ca9e770c` — FIXED by sub-agent (as 1E)
- [x] **The Emperor Barduse** — Seed 2 `48201447-079d-4a67-814c-dfbf44e91ad4` — fixed: counts dragon cards of any type (tested)
- [x] **The Ministry of Other Smaller Ministries** — Open Beta `c8f335c2-c065-4e48-befe-ce99752073f1` — no change: each attack forms one party, so 'pay 2 for each party' = 'pay 2 to attack'
- [x] **The Society of Magical Propriety** — Seed 3 `ce1ccf05-7a09-4363-b3b2-67d3d28b1973` — already correct: the faction's ENCYCLOPEDIC KNOWLEDGE already has threshold oo as printed
- [x] **Tri-Pole Magnet** — 1st Edition `790b1c64-e1b4-4bc4-b1b2-261272b75953` — fixed: GRAPPLE only if the attached character is still in play (tested)
- [x] **Tri-Pole Magnet** — Open Beta `a4d88aa2-42b4-454d-9964-bb55c6927142` — fixed (as 1E); subtype gear already set (tested)
- [x] **Unexpected Boobysnake** — 1st Edition Part 2 `19cf503e-f872-4199-beef-e832d1ee833c` — fixed: deployedAsResponse
- [x] **Unexpected Boobysnake** — 2nd Edition `0da66705-4bbd-49c7-981a-3bf32eb437b7` — fixed: deployedAsResponse
- [x] **Vander Malagut** — Open Beta `2e954d06-4902-495d-8a31-37d9ecd3ee96` — fixed: destroyed first, then put into play under your control as a sarcophyle (tested)

## G8 — threshold paragraphs modeled as free activated abilities (known engine bug) — DELEGATED to a sub-agent (see deferred/threshold-paragraphs.md)

CR 201.5d / 405.4: a paragraph that starts with threshold icons is a static condition, not a repeatable ability. A probe showed Fervent Beastslayer gaining life four times for free.

- [x] **Boorish Boar** (all printings) — fixed by sub-agent: continuous + new destroysSource (deferred/threshold-paragraphs.md)
- [x] **Shrouded Demon** (all printings) — fixed by sub-agent (Seed + Seed Saga)
- [x] **The Abominable Hamster** (all printings) — fixed by sub-agent
- [x] **Protractive Golem** (all printings) — fixed by sub-agent
- [x] **Runic Armor** (all printings) — fixed by sub-agent
- [x] **Obtuse Pipesmoker** (all printings) — fixed by sub-agent
- [x] **Fervent Beastslayer** (all printings) — fixed by sub-agent
- [x] **Heavy Sword** (all printings) — fixed by sub-agent
- [x] **Righteous Exemplar** (all printings) — fixed by sub-agent
- [x] **Soulsearcher** (all printings) — fixed by sub-agent

## G9 — names whose printings carry different behavior (all involve an Ungodly Mess reprint)

Check each printing's behavior against its own printed text. Different behavior is now allowed, as long as each printing matches its card.

- [x] **Quotidian Assassination** — settled: identical printed text everywhere; the UM behavior is an equivalent re-authoring (selector defaults to in-play)
- [x] **Pluck** — settled: equivalent re-authoring (field order only)
- [x] **Contriving Engineer** — settled: all three printings now share one behavior (UM's form was equivalent)
- [x] **Zigalburgonglgr, the Stolen God** — settled: equivalent (HH picks at trigger time, UM at resolution; same choices)
- [x] **Brainbath** — fixed: Ungodly Mess made 'put a card' and 'opponent discards' optional; now shares Seed Saga's mandatory behavior (tested)
- [x] **Circumspect Hijacker** — settled: equivalent (ability id only); all now gated by meetsThreshold
- [x] **Overindulge** — settled: equivalent (mode labels only)

## G10 — item modifier badges vs behavior

`findings.md` → Field differences lists each item's printed STR/SPD/LIFE badges ("item badges … check behavior"). Confirm each attach modifier in `behavior` matches. Kettinger (Open Beta) already disagrees: +3 STR printed, catalog says 2.

- [x] Go through every "item badges" entry in findings.md — done: all 41 printings with badges match their attach modifiers (Kettinger OB was the one mismatch, fixed)

## G11 — manual review

- [ ] **Some Crazy Ornery Unfriendly Thug** (Holy Heist `49ba7019-9706-4ea4-b958-630a4400ef8c`). The content filter blocks scanners on it. A human needs to read its subtitle, flavor and rules from the image. Its flavor is unset, and its text still comes from the catalog.
